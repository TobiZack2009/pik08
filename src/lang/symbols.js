/** @import { Token } from '../lua/lexer.js' */

/**
 * The declarations of a program, found by a scan of its tokens. It does not parse: half-typed
 * code (an unclosed `function`, a trailing `local x =`) just yields fewer or looser scopes, and it
 * never throws. Lua's scoping is followed closely enough for completion and go-to-definition:
 * blocks are tracked with a keyword stack, and PICO-8's shorthand `if (c) stmt` opens no block.
 * Offsets are offsets into the p8str.
 *
 * @typedef {Object} Decl
 * @property {string} name
 * @property {'local' | 'function' | 'param' | 'for' | 'global'} kind
 * @property {number} pos          where the name is
 * @property {number} end
 * @property {number} scopeStart   the name can be used from here ...
 * @property {number} scopeEnd     ... to here
 * @property {number} depth        how many blocks deep it was declared; 0 at the top level
 * @property {ParamName[]} [params]    for functions
 * @property {string} [doc]            the comment block above a function
 *
 * @typedef {Object} Field
 * @property {string} name
 * @property {string} owner        the name of the table it was found on (`p` for `p.x = 1`)
 * @property {number} pos
 * @property {number} end
 * @property {ParamName[]} [params]
 * @property {boolean} [method]    declared with `:`, so `self` is implied
 * @property {string} [doc]
 *
 * @typedef {{ name: string, optional?: boolean }} ParamName
 *
 * @typedef {Object} Scope
 * @property {string} kind   the keyword that opened the block
 * @property {number} start
 * @property {number} end
 *
 * @typedef {Object} Symbols
 * @property {Decl[]} decls
 * @property {Field[]} fields
 * @property {Scope[]} scopes
 *
 * @typedef {Object} Source
 * @property {string} p8
 * @property {{ tokens: readonly Token[] }} lexed
 */

const STATEMENT_KEYWORDS = new Set([
  'local', 'function', 'if', 'for', 'while', 'repeat', 'return', 'do', 'break', 'goto', 'end', 'else', 'elseif', 'until',
])
const OPERAND_KEYWORDS = new Set(['true', 'false', 'nil', 'end'])
const CLOSERS = new Set(['end', 'else', 'elseif', 'until'])

/** @param {Token | undefined} t @param {string} value */
const isPunct = (t, value) => t !== undefined && t.type === 'punct' && t.value === value
/** @param {Token | undefined} t @param {string} value */
const isKeyword = (t, value) => t !== undefined && t.type === 'keyword' && t.value === value

/** Whether the token ends an operand, so that a name after it must start a new statement. @param {Token | undefined} t */
function endsOperand(t) {
  if (!t) return false
  if (t.type === 'name' || t.type === 'number' || t.type === 'string') return true
  if (t.type === 'keyword') return OPERAND_KEYWORDS.has(/** @type {string} */ (t.value))
  return t.type === 'punct' && (t.value === ')' || t.value === ']' || t.value === '}' || t.value === '...')
}

/** @param {Token} t */
function startsStatement(t) {
  if (t.type === 'name') return true
  if (t.type === 'keyword') return STATEMENT_KEYWORDS.has(/** @type {string} */ (t.value))
  return t.type === 'punct' && (t.value === '::' || t.value === '?')
}

/**
 * The `--` (or `//`) comment lines directly above the line holding `pos`, without their markers.
 * @param {string} p8
 * @param {number} pos
 * @returns {string | undefined}
 */
export function docAbove(p8, pos) {
  let lineStart = p8.lastIndexOf('\n', pos - 1) + 1
  if (p8.slice(lineStart, pos).trim() !== '') return undefined
  /** @type {string[]} */
  const lines = []
  while (lineStart > 0) {
    const prevStart = p8.lastIndexOf('\n', lineStart - 2) + 1
    const text = p8.slice(prevStart, lineStart - 1).trim()
    const m = /^(?:--|\/\/)(?!\[\[)\s?(.*)$/.exec(text)
    if (!m) break
    lines.unshift(m[1].trim())
    lineStart = prevStart
  }
  return lines.length ? lines.join('\n') : undefined
}

/**
 * @param {Source} source
 * @returns {Symbols}
 */
export function scanSymbols(source) {
  const { p8 } = source
  const tokens = source.lexed.tokens
  const length = p8.length

  /** @type {Decl[]} */
  const decls = []
  /** @type {Field[]} */
  const fields = []
  /** @type {Scope[]} */
  const scopes = []

  /** @typedef {{ kind: string, start: number, decls: Decl[] }} Frame */
  /** @type {Frame[]} */
  const frames = [{ kind: 'chunk', start: 0, decls: [] }]
  /** Locals whose scope starts when their statement ends. @type {{ decl: Decl, depth: number, brackets: number }[]} */
  let pending = []
  /** Loop variables waiting for the `do` of their loop. @type {{ decls: Decl[], depth: number, brackets: number } | null} */
  let pendingFor = null
  let brackets = 0
  let skipThen = false

  /** @param {Omit<Decl, 'depth'>} made @returns {Decl} */
  const add = (made) => {
    const decl = Object.assign(made, { depth: frames.length - 1 })
    decls.push(decl)
    frames[frames.length - 1].decls.push(decl)
    return decl
  }

  /** @param {number} at */
  const resolvePending = (at) => {
    for (const p of pending) p.decl.scopeStart = at
    pending = []
  }

  /** @param {Frame} frame @param {number} end */
  const closeFrame = (frame, end) => {
    for (const d of frame.decls) d.scopeEnd = end
    scopes.push({ kind: frame.kind, start: frame.start, end })
  }

  /**
   * Reads `name, name, ...` (and `...`) from `from`. Stops at the first token that is not part of the list.
   * @param {number} from
   * @returns {{ names: Token[], next: number }}
   */
  const nameList = (from) => {
    /** @type {Token[]} */
    const names = []
    let j = from
    for (;;) {
      const t = tokens[j]
      if (t && t.type === 'name') names.push(t)
      else if (!isPunct(t, '...')) break
      j++
      if (!isPunct(tokens[j], ',')) break
      j++
    }
    return { names, next: j }
  }

  /** @param {Token[]} names @returns {ParamName[]} */
  const toParams = (names) => names.map((t) => ({ name: /** @type {string} */ (t.value) }))

  /**
   * `function` at index `i`: reads the name and the parameters, opens the function's block.
   * @param {number} i
   * @param {number} docAt   where the declaration starts, for the comment above it
   * @param {Decl | null} target  the declaration of `local function name`, made by the caller
   * @returns {number} index of the last token read
   */
  const functionAt = (i, docAt, target) => {
    /** @type {Token[]} */
    const chain = []
    /** @type {string[]} */
    const seps = []
    let j = i + 1 + (target ? 1 : 0) // a `local function` name was read by the caller
    if (!target && tokens[j]?.type === 'name') {
      chain.push(tokens[j++])
      while ((isPunct(tokens[j], '.') || isPunct(tokens[j], ':')) && tokens[j + 1]?.type === 'name') {
        seps.push(/** @type {string} */ (tokens[j].value))
        chain.push(tokens[j + 1])
        j += 2
      }
    }
    /** @type {ParamName[]} */
    let params = []
    /** @type {Token[]} */
    let paramToks = []
    /** @type {Token | null} */
    let open = null
    if (isPunct(tokens[j], '(')) {
      open = tokens[j]
      const list = nameList(j + 1)
      paramToks = list.names
      params = toParams(list.names)
      j = list.next
      if (isPunct(tokens[j], ')')) j++
      j-- // the last token read
    } else {
      j--
    }
    const doc = docAbove(p8, docAt)
    const method = seps.at(-1) === ':'
    if (target) {
      target.params = params
      if (doc) target.doc = doc
    } else if (chain.length === 1) {
      const t = chain[0]
      /** @type {Omit<Decl, 'depth'>} */
      const decl = { name: /** @type {string} */ (t.value), kind: 'function', pos: t.pos, end: t.end, scopeStart: 0, scopeEnd: length, params }
      if (doc) decl.doc = doc
      add(decl)
    } else if (chain.length > 1) {
      const t = chain[chain.length - 1]
      /** @type {Field} */
      const field = { name: /** @type {string} */ (t.value), owner: /** @type {string} */ (chain[chain.length - 2].value), pos: t.pos, end: t.end, params }
      if (method) field.method = true
      if (doc) field.doc = doc
      fields.push(field)
    } else if (isPunct(tokens[i - 1], '=') && tokens[i - 2]?.type === 'name') {
      // name = function(...)
      const named = tokens[i - 2]
      const decl = decls.findLast((d) => d.pos === named.pos)
      if (decl) {
        decl.params = params
        const d = docAbove(p8, tokens[i - 3] && isKeyword(tokens[i - 3], 'local') ? tokens[i - 3].pos : named.pos)
        if (d) decl.doc = d
      }
    }
    const frame = { kind: 'function', start: tokens[i].pos, decls: /** @type {Decl[]} */ ([]) }
    frames.push(frame)
    const from = open ? open.end : tokens[i].end
    if (method) frame.decls.push({ name: 'self', kind: 'param', pos: from, end: from, scopeStart: from, scopeEnd: length, depth: frames.length - 1 })
    for (const t of paramToks) {
      const decl = { name: /** @type {string} */ (t.value), kind: /** @type {const} */ ('param'), pos: t.pos, end: t.end, scopeStart: from, scopeEnd: length, depth: frames.length - 1 }
      frame.decls.push(decl)
    }
    for (const d of frame.decls) decls.push(d)
    return Math.max(i, j)
  }

  /**
   * Records the keys of a table constructor whose `{` is at index `open` as fields of `owner`.
   * @param {number} open
   * @param {string} owner
   */
  const constructorFields = (open, owner) => {
    let depth = 0
    for (let j = open; j < tokens.length; j++) {
      const t = tokens[j]
      if (t.type === 'punct' && (t.value === '{' || t.value === '(' || t.value === '[')) depth++
      else if (t.type === 'punct' && (t.value === '}' || t.value === ')' || t.value === ']')) {
        if (--depth <= 0) return
      } else if (depth === 1 && t.type === 'name' && isPunct(tokens[j + 1], '=')) {
        const before = tokens[j - 1]
        if (!(isPunct(before, '{') || isPunct(before, ',') || isPunct(before, ';'))) continue
        /** @type {Field} */
        const field = { name: /** @type {string} */ (t.value), owner, pos: t.pos, end: t.end }
        if (isKeyword(tokens[j + 2], 'function') && isPunct(tokens[j + 3], '(')) {
          field.params = toParams(nameList(j + 4).names)
        }
        fields.push(field)
      }
    }
  }

  /** @param {string} name @param {number} at */
  const isLocal = (name, at) => frames.some((f) => f.decls.some((d) => d.name === name && d.kind !== 'global' && d.kind !== 'function' && d.scopeStart <= at))

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const prev = tokens[i - 1]

    if (pending.length) {
      const p = pending[0]
      const closing = t.type === 'keyword' && CLOSERS.has(/** @type {string} */ (t.value))
      if (p.depth === frames.length && p.brackets === brackets && endsOperand(prev) && (startsStatement(t) || closing)) {
        resolvePending(prev.end)
      } else if (p.depth > frames.length) {
        resolvePending(prev ? prev.end : t.pos)
      }
    }

    if (t.type === 'punct') {
      const v = t.value
      if (v === '(' || v === '[' || v === '{') brackets++
      else if ((v === ')' || v === ']' || v === '}') && brackets > 0) brackets--
      continue
    }

    if (t.type === 'name') {
      // statement start: name = ...   and   name.field... = ...
      const statementStart =
        !prev || endsOperand(prev) || isPunct(prev, ';') || (prev.type === 'keyword' && ['do', 'then', 'else', 'repeat'].includes(/** @type {string} */ (prev.value)))
      if (!statementStart || brackets > 0) continue
      const name = /** @type {string} */ (t.value)
      let j = i + 1
      let owner = name
      let last = t
      let dotted = false
      while (isPunct(tokens[j], '.') && tokens[j + 1]?.type === 'name') {
        owner = /** @type {string} */ (last.value)
        last = tokens[j + 1]
        dotted = true
        j += 2
      }
      if (!isPunct(tokens[j], '=')) continue
      if (dotted) {
        fields.push({ name: /** @type {string} */ (last.value), owner, pos: last.pos, end: last.end })
        if (isPunct(tokens[j + 1], '{')) constructorFields(j + 1, /** @type {string} */ (last.value))
      } else if (!isLocal(name, t.pos) && !decls.some((d) => d.name === name && d.scopeStart === 0)) {
        decls.push({ name, kind: 'global', pos: t.pos, end: t.end, scopeStart: 0, scopeEnd: length, depth: frames.length - 1 })
        if (isPunct(tokens[j + 1], '{')) constructorFields(j + 1, name)
      }
      i = j - 1
      continue
    }

    if (t.type !== 'keyword') continue

    switch (t.value) {
      case 'local': {
        if (isKeyword(tokens[i + 1], 'function') && tokens[i + 2]?.type === 'name') {
          const n = tokens[i + 2]
          const decl = add({ name: /** @type {string} */ (n.value), kind: 'local', pos: n.pos, end: n.end, scopeStart: n.pos, scopeEnd: length })
          i = functionAt(i + 1, t.pos, decl)
          break
        }
        const { names, next } = nameList(i + 1)
        const hasValue = isPunct(tokens[next], '=')
        const made = names
          .filter((n) => n.type === 'name')
          .map((n) => add({ name: /** @type {string} */ (n.value), kind: 'local', pos: n.pos, end: n.end, scopeStart: hasValue ? Infinity : n.end, scopeEnd: length }))
        if (hasValue) {
          for (const decl of made) pending.push({ decl, depth: frames.length, brackets })
          if (made.length === 1 && isPunct(tokens[next + 1], '{')) constructorFields(next + 1, made[0].name)
        }
        i = next - 1
        break
      }
      case 'function':
        i = functionAt(i, t.pos, null)
        break
      case 'for': {
        const { names, next } = nameList(i + 1)
        const vars = names.map((n) => ({ name: /** @type {string} */ (n.value), kind: /** @type {const} */ ('for'), pos: n.pos, end: n.end, scopeStart: Infinity, scopeEnd: length, depth: frames.length }))
        pendingFor = { decls: vars, depth: frames.length, brackets }
        i = next - 1
        break
      }
      case 'do': {
        frames.push({ kind: 'do', start: t.pos, decls: [] })
        if (pendingFor && pendingFor.depth === frames.length - 1 && pendingFor.brackets === brackets) {
          const frame = frames[frames.length - 1]
          for (const d of pendingFor.decls) {
            d.scopeStart = t.end
            frame.decls.push(d)
            decls.push(d)
          }
          pendingFor = null
        }
        break
      }
      case 'elseif':
        skipThen = true
        break
      case 'then':
        if (skipThen) skipThen = false
        else frames.push({ kind: 'then', start: t.pos, decls: [] })
        break
      case 'repeat':
        frames.push({ kind: 'repeat', start: t.pos, decls: [] })
        break
      case 'end':
      case 'until':
        if (frames.length > 1) {
          const frame = /** @type {Frame} */ (frames.pop())
          closeFrame(frame, t.pos)
        }
        break
    }
  }

  const last = tokens[tokens.length - 1]
  if (pending.length) resolvePending(last ? last.end : 0)
  while (frames.length > 1) closeFrame(/** @type {Frame} */ (frames.pop()), length)
  for (const d of decls) if (d.scopeStart === Infinity) d.scopeStart = length
  return { decls, fields, scopes }
}

/**
 * The declarations that can be used at `offset`, nearest first, with shadowed ones left out.
 * @param {Symbols} symbols
 * @param {number} offset
 * @returns {Decl[]}
 */
export function visibleAt(symbols, offset) {
  const inScope = symbols.decls.filter((d) => d.scopeStart <= offset && offset <= d.scopeEnd)
  inScope.sort((a, b) => b.scopeStart - a.scopeStart || b.pos - a.pos)
  const seen = new Set()
  return inScope.filter((d) => !seen.has(d.name) && seen.add(d.name))
}

/**
 * The declaration `name` refers to at `offset`.
 * @param {Symbols} symbols
 * @param {string} name
 * @param {number} offset
 * @returns {Decl | undefined}
 */
export function lookup(symbols, name, offset) {
  return visibleAt(symbols, offset).find((d) => d.name === name)
}
