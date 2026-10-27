/** @import { Token } from '../lua/lexer.js' */

/**
 * What the cursor is in, for completion, hover and signature help. Works on the tokens of
 * half-typed code and never throws. Offsets are offsets into the p8str.
 *
 * @typedef {Object} Source
 * @property {string} p8
 * @property {{ tokens: readonly Token[] }} lexed
 * @property {readonly { from: number, to: number, cls: string }[]} segments
 *
 * @typedef {Object} Context
 * @property {'comment' | 'string' | 'number' | 'member' | 'name'} kind
 * @property {string} prefix       the part of the word before the cursor
 * @property {number} from         where the word starts (the cursor when there is none)
 * @property {string} [receiver]   for `member`: the name before the `.` or `:`, when there is one
 * @property {boolean} [method]    for `member`: the separator was `:`
 *
 * @typedef {Object} Call
 * @property {string} name
 * @property {string} [receiver]
 * @property {boolean} member     written `obj.name(` or `obj:name(`
 * @property {boolean} method     written `obj:name(`
 * @property {number} index       which argument the cursor is in, from 0
 * @property {number} open        offset of the `(`
 * @property {number} callee      offset of the callee's name
 */

/** Keywords that end the search for the call a cursor is in. */
const STATEMENT_KEYWORDS = new Set(['local', 'if', 'for', 'while', 'repeat', 'until', 'return', 'end', 'else', 'elseif', 'then', 'do'])

/**
 * The number of tokens that start before `offset`.
 * @param {readonly Token[]} tokens
 * @param {number} offset
 */
function countBefore(tokens, offset) {
  let lo = 0
  let hi = tokens.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (tokens[mid].pos < offset) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** @param {Token | undefined} t @param {string} value */
const isPunct = (t, value) => t !== undefined && t.type === 'punct' && t.value === value

/**
 * The name or keyword token the cursor is in or right after.
 * @param {Source} source
 * @param {number} offset
 * @returns {Token | null}
 */
export function wordAt(source, offset) {
  const tokens = source.lexed.tokens
  const n = countBefore(tokens, offset)
  const t = tokens[n - 1]
  if (t && (t.type === 'name' || t.type === 'keyword') && offset <= t.end) return t
  const next = tokens[n]
  if (next && (next.type === 'name' || next.type === 'keyword') && next.pos === offset) return next
  return null
}

/**
 * The name token covering `offset` for hover: the cursor may be anywhere in it, including its ends.
 * @param {Source} source
 * @param {number} offset
 * @returns {{ token: Token, receiver?: string, member: boolean, method: boolean } | null}
 */
export function nameAt(source, offset) {
  const token = wordAt(source, offset)
  if (!token || token.type !== 'name') return null
  const tokens = source.lexed.tokens
  const i = tokens.indexOf(token)
  const sep = tokens[i - 1]
  if (isPunct(sep, '.') || isPunct(sep, ':')) {
    const before = tokens[i - 2]
    return { token, receiver: before && before.type === 'name' ? /** @type {string} */ (before.value) : undefined, member: true, method: sep.value === ':' }
  }
  return { token, member: false, method: false }
}

/**
 * @param {Source} source
 * @param {number} offset
 * @returns {Context}
 */
export function contextAt(source, offset) {
  const { p8, segments } = source
  const tokens = source.lexed.tokens

  for (const s of segments) {
    if (s.from >= offset) break
    if (s.cls === 'comment') {
      const closed = p8.startsWith('--[[', s.from) && p8.slice(s.from, s.to).endsWith(']]') && s.to - s.from >= 6
      if (offset < s.to || (offset === s.to && !closed)) return { kind: 'comment', prefix: '', from: offset }
    } else if (s.cls === 'string') {
      if (offset < s.to) return { kind: 'string', prefix: '', from: offset }
    } else if (s.cls === 'error' && (p8[s.from] === '"' || p8[s.from] === "'") && offset <= s.to) {
      return { kind: 'string', prefix: '', from: offset }
    }
  }

  const n = countBefore(tokens, offset)
  const last = tokens[n - 1]
  if (last && last.type === 'number' && offset <= last.end) return { kind: 'number', prefix: '', from: offset }

  const word = wordAt(source, offset)
  const from = word ? word.pos : offset
  const prefix = word ? p8.slice(word.pos, offset) : ''
  const i = word ? tokens.indexOf(word) : n
  const sep = tokens[i - 1]
  if (isPunct(sep, '.') || isPunct(sep, ':')) {
    const before = tokens[i - 2]
    return {
      kind: 'member',
      prefix,
      from,
      receiver: before && before.type === 'name' ? /** @type {string} */ (before.value) : undefined,
      method: sep.value === ':',
    }
  }
  return { kind: 'name', prefix, from }
}

/**
 * The call whose argument list the cursor is in: the innermost unclosed `(` that follows a name.
 * @param {Source} source
 * @param {number} offset
 * @returns {Call | null}
 */
export function callAt(source, offset) {
  const tokens = source.lexed.tokens
  let depth = 0
  let commas = 0
  for (let k = countBefore(tokens, offset) - 1; k >= 0; k--) {
    const t = tokens[k]
    if (t.end > offset) continue // the cursor is inside this token
    if (t.type === 'keyword' && depth === 0 && STATEMENT_KEYWORDS.has(/** @type {string} */ (t.value))) return null
    if (t.type !== 'punct') continue
    const v = t.value
    if (v === ')' || v === ']' || v === '}') depth++
    else if (v === '(' || v === '[' || v === '{') {
      if (depth > 0) {
        depth--
        continue
      }
      const callee = tokens[k - 1]
      if (v === '(' && callee && callee.type === 'name') {
        const sep = tokens[k - 2]
        const member = isPunct(sep, '.') || isPunct(sep, ':')
        const before = tokens[k - 3]
        return {
          name: /** @type {string} */ (callee.value),
          receiver: member && before && before.type === 'name' ? /** @type {string} */ (before.value) : undefined,
          member,
          method: member && sep.value === ':',
          index: commas,
          open: t.pos,
          callee: callee.pos,
        }
      }
      commas = 0 // a table, an index or a grouping: the arguments counted so far were not the call's
    } else if (v === ',' && depth === 0) {
      commas++
    }
  }
  return null
}
