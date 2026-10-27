import { API, ENTRY_POINTS, KEYWORDS, KEYWORD_DOCS, SNIPPETS, formatSignature } from './api-docs.js'
import { callAt, contextAt, nameAt, wordAt } from './context.js'
import { lookup, scanSymbols, visibleAt } from './symbols.js'

/** @import { ApiDoc, ParamDoc } from './api-docs.js' */
/** @import { Source } from './context.js' */
/** @import { Decl, Field, Symbols } from './symbols.js' */

/**
 * The language service: what the editor asks about a program. It takes an analysis (the p8str,
 * its tokens and highlight segments) and offsets into the p8str, and returns plain data, so it can
 * be tested without a DOM. Results of the scan are cached per analysis.
 *
 * @typedef {Object} CompletionItem
 * @property {string} label
 * @property {'variable' | 'function' | 'method' | 'property' | 'keyword' | 'text'} type
 * @property {string} [detail]     a short note shown beside the label
 * @property {string} [doc]
 * @property {string} [snippet]    a template to insert instead of the label
 * @property {number} rank         lower sorts first
 *
 * @typedef {Object} Completions
 * @property {number} from
 * @property {'name' | 'member'} kind   what is being completed: a name, or a field after `.` or `:`
 * @property {CompletionItem[]} items
 *
 * @typedef {Object} Hover
 * @property {number} from
 * @property {number} to
 * @property {string} title        the signature or the declaration
 * @property {string} [doc]
 * @property {string} [returns]
 * @property {ParamDoc[]} [params]
 * @property {'api' | 'file' | 'keyword'} origin
 *
 * @typedef {Object} SignatureHelp
 * @property {string} name
 * @property {ParamDoc[]} params
 * @property {number} active       index of the parameter the cursor is at, -1 for none
 * @property {number} open         offset of the `(`
 * @property {string} [doc]
 * @property {string} [returns]
 *
 * @typedef {Object} OutlineItem
 * @property {string} name
 * @property {'function' | 'variable'} kind
 * @property {string} [detail]
 * @property {number} pos
 * @property {number} end
 */

/** @type {WeakMap<object, Symbols>} */
const cache = new WeakMap()

/**
 * The declarations of the program, scanned once per analysis.
 * @param {Source} source
 * @returns {Symbols}
 */
export function symbolsOf(source) {
  let symbols = cache.get(source)
  if (!symbols) cache.set(source, (symbols = scanSymbols(source)))
  return symbols
}

/** @param {string} prefix @param {string} label */
const matches = (prefix, label) => label.toLowerCase().startsWith(prefix.toLowerCase())

/** @param {readonly { name: string, optional?: boolean }[] | undefined} params */
const paramDocs = (params) => (params ?? []).map((p) => /** @type {ParamDoc} */ ({ name: p.name, ...(p.optional ? { optional: true } : {}) }))

// ---- completion ----------------------------------------------------------------------------------

/**
 * @param {Source} source
 * @param {number} offset
 * @returns {Completions | null}
 */
export function completions(source, offset) {
  const ctx = contextAt(source, offset)
  if (ctx.kind === 'comment' || ctx.kind === 'string' || ctx.kind === 'number') return null
  const symbols = symbolsOf(source)
  /** @type {CompletionItem[]} */
  const items = []
  const taken = new Set()
  /** @param {CompletionItem} item */
  const push = (item) => {
    if (taken.has(item.label) || !matches(ctx.prefix, item.label)) return
    taken.add(item.label)
    items.push(item)
  }

  if (ctx.kind === 'member') {
    const own = symbols.fields.filter((f) => f.owner === ctx.receiver)
    const pool = ctx.receiver === undefined || ctx.receiver === 'self' || own.length === 0 ? symbols.fields : own
    for (const f of pool) {
      if (f.pos === ctx.from) continue // the field being typed
      push({
        label: f.name,
        type: f.params ? 'method' : 'property',
        detail: f.params ? formatSignature(f.name, f.params) : undefined,
        doc: f.doc,
        rank: 0,
      })
    }
    return { from: ctx.from, kind: 'member', items }
  }

  for (const d of visibleAt(symbols, offset)) {
    if (d.pos === ctx.from) continue // the name being declared
    const isLocal = d.scopeStart > 0
    push({
      label: d.name,
      type: d.params ? 'function' : 'variable',
      detail: d.params ? formatSignature(d.name, d.params) : d.kind === 'param' ? 'parameter' : isLocal ? 'local' : 'global',
      doc: d.doc,
      rank: isLocal ? 0 : 1,
    })
  }
  for (const [name, doc] of Object.entries({ ...ENTRY_POINTS, ...API })) {
    const snippet = SNIPPETS.find((s) => s.label === name)?.template
    push({ label: name, type: 'function', detail: formatSignature(name, doc.params), doc: doc.doc, snippet, rank: 2 })
  }
  for (const s of SNIPPETS) push({ label: s.label, type: 'keyword', detail: 'snippet', doc: s.doc, snippet: s.template, rank: 3 })
  for (const k of KEYWORDS) push({ label: k, type: 'keyword', doc: KEYWORD_DOCS[k], rank: 3 })
  return { from: ctx.from, kind: 'name', items }
}

// ---- resolving names -------------------------------------------------------------------------------

/**
 * The fields a member access may refer to: those of the receiver, else any with that name.
 * @param {Symbols} symbols
 * @param {string} name
 * @param {string | undefined} receiver
 * @returns {Field | undefined}
 */
function findField(symbols, name, receiver) {
  const named = symbols.fields.filter((f) => f.name === name)
  return named.find((f) => f.owner === receiver) ?? named[0]
}

/**
 * What a name refers to, as a declaration of the program or as API documentation.
 * @param {Source} source
 * @param {string} name
 * @param {number} offset
 * @param {{ receiver?: string, member: boolean }} how
 * @returns {{ file: Decl | Field } | { api: ApiDoc } | null}
 */
function resolve(source, name, offset, how) {
  const symbols = symbolsOf(source)
  if (how.member) {
    const field = findField(symbols, name, how.receiver)
    return field ? { file: field } : null
  }
  const decl = lookup(symbols, name, offset)
  if (decl) return { file: decl }
  const api = ENTRY_POINTS[name] ?? (Object.hasOwn(API, name) ? API[name] : undefined)
  return api ? { api } : null
}

// ---- hover ---------------------------------------------------------------------------------------

/**
 * @param {Source} source
 * @param {number} offset
 * @returns {Hover | null}
 */
export function hover(source, offset) {
  const word = wordAt(source, offset)
  if (!word) return null
  const ctx = contextAt(source, word.pos + 1)
  if (ctx.kind === 'comment' || ctx.kind === 'string') return null
  const range = { from: word.pos, to: word.end }
  const name = /** @type {string} */ (word.value)
  if (word.type === 'keyword') {
    const doc = KEYWORD_DOCS[name]
    return doc ? { ...range, title: name, doc, origin: 'keyword' } : null
  }
  const at = nameAt(source, offset)
  const found = resolve(source, name, word.pos, { receiver: at?.receiver, member: at?.member ?? false })
  if (!found) return null
  if ('api' in found) {
    const api = found.api
    return { ...range, title: formatSignature(name, api.params), doc: api.doc, returns: api.returns, params: api.params, origin: 'api' }
  }
  const d = found.file
  const doc = d.doc ?? ('owner' in d ? undefined : ENTRY_POINTS[name]?.doc)
  const kind = 'owner' in d ? 'field' : d.kind === 'param' ? 'parameter' : d.kind === 'for' ? 'loop variable' : d.kind
  return {
    ...range,
    title: d.params ? formatSignature(name, d.params) : `${kind} ${name}`,
    doc,
    params: d.params ? paramDocs(d.params) : undefined,
    origin: 'file',
  }
}

// ---- signature help ------------------------------------------------------------------------------

/**
 * @param {Source} source
 * @param {number} offset
 * @returns {SignatureHelp | null}
 */
export function signature(source, offset) {
  const call = callAt(source, offset)
  if (!call) return null
  const found = resolve(source, call.name, call.callee, { receiver: call.receiver, member: call.member })
  if (!found) return null
  /** @type {ParamDoc[]} */
  let params
  let doc
  let returns
  if ('api' in found) {
    params = found.api.params
    doc = found.api.doc
    returns = found.api.returns
  } else {
    if (!found.file.params) return null
    params = paramDocs(found.file.params)
    doc = found.file.doc
  }
  if (call.method && params[0]?.name === 'self') params = params.slice(1)
  const variadic = params.length > 0 && params[params.length - 1].name === '...'
  const active = call.index < params.length ? call.index : variadic ? params.length - 1 : -1
  return { name: call.name, params, active, open: call.open, doc, returns }
}

// ---- go to definition ------------------------------------------------------------------------------

/**
 * Where the name at `offset` is declared.
 * @param {Source} source
 * @param {number} offset
 * @returns {{ from: number, to: number } | null}
 */
export function definition(source, offset) {
  const at = nameAt(source, offset)
  if (!at) return null
  const name = /** @type {string} */ (at.token.value)
  const found = resolve(source, name, at.token.pos, { receiver: at.receiver, member: at.member })
  if (!found || !('file' in found)) return null
  return { from: found.file.pos, to: found.file.end }
}

// ---- outline -------------------------------------------------------------------------------------

/**
 * The functions of the program, then its top-level variables, each in source order.
 * @param {Source} source
 * @returns {OutlineItem[]}
 */
export function outline(source) {
  const { decls, fields } = symbolsOf(source)
  /** @type {OutlineItem[]} */
  const functions = []
  /** @type {OutlineItem[]} */
  const variables = []
  for (const d of decls) {
    if (d.kind === 'param' || d.kind === 'for') continue
    if (d.params) {
      if (d.kind === 'function' || d.depth === 0) functions.push({ name: d.name, kind: 'function', detail: formatSignature(d.name, d.params), pos: d.pos, end: d.end })
    } else if (d.depth === 0 && !variables.some((v) => v.name === d.name)) {
      variables.push({ name: d.name, kind: 'variable', detail: d.kind === 'global' ? 'global' : 'local', pos: d.pos, end: d.end })
    }
  }
  for (const f of fields) {
    if (!f.params) continue
    const name = `${f.owner}${f.method ? ':' : '.'}${f.name}`
    functions.push({ name, kind: 'function', detail: formatSignature(name, f.params), pos: f.pos, end: f.end })
  }
  functions.sort((a, b) => a.pos - b.pos)
  variables.sort((a, b) => a.pos - b.pos)
  return [...functions, ...variables]
}
