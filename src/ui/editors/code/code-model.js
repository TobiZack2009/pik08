import { LuaSyntaxError } from '../../../lua/errors.js'
import { parse } from '../../../lua/parser.js'
import { tokenizeTolerant } from '../../../lua/tokens.js'
import { highlight, matchBracket } from './highlight.js'
import { OffsetMap, fromDisplay, toDisplay } from './p8scii-view.js'

/** @import { Segment, Lexed } from './highlight.js' */

/**
 * The editor's document is the display form of the code (see `p8scii-view.js`). Everything the
 * editor needs to know about it (the p8str, the offset conversion, tokens, highlight segments)
 * comes from `analyze`, so it can be tested without a DOM.
 *
 * @typedef {Object} Analysis
 * @property {string} p8       the code as a p8str
 * @property {OffsetMap} map   p8 offset <-> display offset
 * @property {Lexed} lexed
 * @property {Segment[]} segments
 */

/**
 * Text that is typed or pasted gets the form it will have after a round trip through PICO-8:
 * characters outside its charset become their UTF-8 bytes (shown as glyphs). That keeps the
 * document and the p8str one character apart only for the two-unit glyphs, which `OffsetMap` knows.
 * @param {string} text
 * @returns {string}
 */
export function normalizeInsert(text) {
  return toDisplay(fromDisplay(text))
}

/**
 * @param {string} doc  the editor text
 * @returns {Analysis}
 */
export function analyze(doc) {
  const p8 = fromDisplay(doc)
  const lexed = tokenizeTolerant(p8)
  return { p8, map: new OffsetMap(p8), lexed, segments: highlight(p8, lexed) }
}

/**
 * The bracket pair at the cursor, as display offsets.
 * @param {Analysis} analysis
 * @param {number} cursor  display offset
 * @returns {{ ranges: { from: number, to: number }[], matched: boolean } | null}
 */
export function bracketsAt(analysis, cursor) {
  const { map, lexed } = analysis
  const found = matchBracket(lexed.tokens, map.toP8(cursor))
  if (!found) return null
  const range = (/** @type {{ pos: number, end: number }} */ t) => ({ from: map.toDisplay(t.pos), to: map.toDisplay(t.end) })
  return { ranges: [range(found.bracket), ...(found.match ? [range(found.match)] : [])], matched: found.match !== null }
}

/**
 * The first syntax error of the code, if any.
 * @param {string} p8
 * @returns {{ message: string, line: number, col: number, pos: number } | null}
 */
export function syntaxProblem(p8) {
  try {
    parse(p8)
    return null
  } catch (e) {
    if (!(e instanceof LuaSyntaxError)) throw e
    return { message: e.message, line: e.line, col: e.col, pos: e.pos ?? lineColToOffset(p8, e.line, e.col) }
  }
}

/**
 * @param {string} p8
 * @param {number} line  1-based
 * @param {number} col   1-based
 * @returns {number} offset, kept inside the line
 */
export function lineColToOffset(p8, line, col) {
  let start = 0
  for (let n = 1; n < line; n++) {
    const nl = p8.indexOf('\n', start)
    if (nl < 0) return p8.length
    start = nl + 1
  }
  const nl = p8.indexOf('\n', start)
  const end = nl < 0 ? p8.length : nl
  return Math.min(start + Math.max(0, col - 1), end)
}

/**
 * Where to mark a problem in the document: a range of display offsets, at least one character
 * wide unless the document is empty.
 * @param {Analysis} analysis
 * @param {number} p8Pos
 * @returns {{ from: number, to: number }}
 */
export function markRange({ p8, map }, p8Pos) {
  let end = p8Pos
  while (end < p8.length && /[\w\x80-\xff]/.test(p8[end])) end++
  if (end === p8Pos) end = Math.min(p8.length, p8Pos + 1)
  if (end === p8Pos) return { from: map.toDisplay(Math.max(0, p8Pos - 1)), to: map.toDisplay(p8Pos) }
  return { from: map.toDisplay(p8Pos), to: map.toDisplay(end) }
}
