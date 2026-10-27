import { tokenizeTolerant } from '../../../lua/tokens.js'

/** @import { Token } from '../../../lua/lexer.js' */
/** @import { LexError } from '../../../lua/tokens.js' */

/**
 * Syntax highlighting for PICO-8 Lua, built on the real lexer (so `//` comments, `0b` numbers,
 * glyph names and the extra operators come out right) and tolerant of half-typed code.
 *
 * @typedef {'keyword' | 'atom' | 'def' | 'property' | 'builtin' | 'glyph' | 'number' | 'string'
 *   | 'operator' | 'punct' | 'comment' | 'error'} HighlightClass
 * @typedef {{ from: number, to: number, cls: HighlightClass }} Segment
 * @typedef {{ tokens: Token[], errors: LexError[] }} Lexed
 */

/** Global functions and callbacks that are part of the PICO-8 API. */
export const BUILTINS = new Set(
  (
    'abs add all assert atan2 band bnot bor btn btnp bxor camera cartdata ceil chr circ circfill clip cls color ' +
    'cocreate coresume costatus count cos cstore cursor del deli dget dset extcmd fget fillp flip flr foreach ' +
    'getmetatable inext ipairs line lshr map max memcpy memset menuitem mget mid min mset music next ord pack ' +
    'pairs pal palt peek peek2 peek4 pget poke poke2 poke4 print printh pset rawequal rawget rawlen rawset rect ' +
    'rectfill reload reset rnd rotl rotr run select serial setmetatable sfx sget sgn shl shr sin split spr sqrt ' +
    'srand sset sspr stat stop sub time t tline tonum tostr tostring type unpack yield ' +
    '_init _update _update60 _draw _G _ENV'
  ).split(' '),
)

const ATOMS = new Set(['true', 'false', 'nil'])
const BRACKETS = new Set(['(', ')', '[', ']', '{', '}'])
const PUNCT = new Set(['(', ')', '[', ']', '{', '}', ',', ';', '.', ':', '::'])

/**
 * @param {string} src  a p8str
 * @param {Lexed} [lexed]  the result of `tokenizeTolerant(src)`, if the caller has it
 * @returns {Segment[]} ordered, non-overlapping; plain text (names, spaces) has no segment
 */
export function highlight(src, lexed = tokenizeTolerant(src)) {
  /** @type {Segment[]} */
  const out = []
  const { tokens, errors } = lexed

  let i = 0 // next token
  let j = 0 // next error
  let pos = 0 // text before this is done
  /** After `function`, names up to the `(` are the function's own name. */
  let inFunctionName = false

  while (i < tokens.length || j < errors.length) {
    const t = i < tokens.length ? tokens[i] : null
    const e = j < errors.length ? errors[j] : null
    if (e && (!t || e.pos <= t.pos)) {
      j++
      let from = e.pos
      /** @type {HighlightClass} */
      let cls = 'error'
      if (e.message.startsWith('unfinished long comment')) {
        from = e.pos - 2 // the error points at the bracket, after the dashes
        cls = 'comment'
      } else if (e.message.startsWith('unfinished long string')) {
        cls = 'string'
      }
      scanGap(src, pos, from, out)
      out.push({ from, to: e.end, cls })
      pos = e.end
      continue
    }
    if (!t) break
    const token = /** @type {Token} */ (t)
    i++
    scanGap(src, pos, token.pos, out)
    pos = token.end
    const prev = tokens[i - 2]
    /** @type {HighlightClass | null} */
    let cls = null
    switch (token.type) {
      case 'keyword': {
        const word = /** @type {string} */ (token.value)
        cls = ATOMS.has(word) ? 'atom' : 'keyword'
        inFunctionName = word === 'function'
        break
      }
      case 'name': {
        const word = /** @type {string} */ (token.value)
        if (inFunctionName) cls = 'def'
        else if (prev && prev.type === 'punct' && (prev.value === '.' || prev.value === ':')) cls = 'property'
        else if (BUILTINS.has(word)) cls = 'builtin'
        else if (word.charCodeAt(0) >= 0x80) cls = 'glyph'
        break
      }
      case 'number':
        cls = 'number'
        inFunctionName = false
        break
      case 'string':
        cls = 'string'
        inFunctionName = false
        break
      case 'punct': {
        const p = /** @type {string} */ (token.value)
        cls = PUNCT.has(p) ? 'punct' : 'operator'
        if (p !== '.' && p !== ':') inFunctionName = false
        break
      }
    }
    if (cls) out.push({ from: token.pos, to: token.end, cls })
  }
  scanGap(src, pos, src.length, out)
  return out
}

/**
 * Finds the comments in the stretch between two tokens (the lexer drops them).
 * @param {string} src
 * @param {number} from
 * @param {number} to
 * @param {Segment[]} out
 */
function scanGap(src, from, to, out) {
  let i = from
  while (i < to) {
    const c = src.charCodeAt(i)
    if (c === 32 || (c >= 9 && c <= 13)) {
      i++
      continue
    }
    const dashes = c === 45 && src.charCodeAt(i + 1) === 45
    const slashes = c === 47 && src.charCodeAt(i + 1) === 47
    if (dashes || slashes) {
      let end
      if (dashes && src.startsWith('[[', i + 2)) {
        const close = src.indexOf(']]', i + 4)
        end = close < 0 || close + 2 > to ? to : close + 2
      } else {
        const nl = src.indexOf('\n', i)
        end = nl < 0 || nl > to ? to : nl
      }
      out.push({ from: i, to: end, cls: 'comment' })
      i = end
      continue
    }
    out.push({ from: i, to: i + 1, cls: 'error' }) // not something the lexer would skip
    i++
  }
}

/**
 * The bracket next to the cursor and the one it pairs with, found from the token list so brackets
 * in strings and comments are ignored.
 * @param {readonly Token[]} tokens
 * @param {number} cursor  offset in the p8str
 * @returns {{ bracket: Token, match: Token | null } | null}
 */
export function matchBracket(tokens, cursor) {
  let atIndex = -1
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]
    if (t.type !== 'punct' || !BRACKETS.has(/** @type {string} */ (t.value))) continue
    if (t.end === cursor) atIndex = k // the bracket before the cursor wins
    else if (t.pos === cursor && atIndex < 0) atIndex = k
    if (t.pos > cursor) break
  }
  if (atIndex < 0) return null
  const bracket = tokens[atIndex]
  const open = '([{'.indexOf(/** @type {string} */ (bracket.value))
  if (open >= 0) {
    const want = ')]}'[open]
    let depth = 0
    for (let k = atIndex; k < tokens.length; k++) {
      const t = tokens[k]
      if (t.type !== 'punct') continue
      if (t.value === bracket.value) depth++
      else if (t.value === want && --depth === 0) return { bracket, match: t }
    }
    return { bracket, match: null }
  }
  const close = ')]}'.indexOf(/** @type {string} */ (bracket.value))
  const want = '([{'[close]
  let depth = 0
  for (let k = atIndex; k >= 0; k--) {
    const t = tokens[k]
    if (t.type !== 'punct') continue
    if (t.value === bracket.value) depth++
    else if (t.value === want && --depth === 0) return { bracket, match: t }
  }
  return { bracket, match: null }
}
