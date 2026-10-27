import { P8SCII_TABLE } from '../../../formats/p8scii-table.js'
import { unicodeToP8scii } from '../../../formats/p8scii.js'

/**
 * How code (a p8str: one char per byte) is shown in the editor. Bytes 0x80+ and the control codes
 * 1..8 are displayed as their P8SCII glyphs, so the document the user edits is ordinary Unicode
 * text and copying it into PICO-8 works. A few glyphs (the cat, the face, the O button) are outside
 * the BMP and take two UTF-16 units, so offsets differ between the two forms: `OffsetMap` converts.
 */

/** Bytes whose glyph is a surrogate pair. */
const WIDE = new Set(P8SCII_TABLE.flatMap((ch, byte) => (ch.length > 1 ? [byte] : [])))

/**
 * p8str -> text for the editor.
 * @param {string} p8
 * @returns {string}
 */
export function toDisplay(p8) {
  let out = ''
  let chunk = 0
  for (let i = 0; i < p8.length; i++) {
    const c = p8.charCodeAt(i)
    if (c >= 0x20 && c < 0x7f) continue
    if (c === 10 || c === 9) continue
    out += p8.slice(chunk, i) + (P8SCII_TABLE[c] ?? p8[i])
    chunk = i + 1
  }
  return chunk === 0 ? p8 : out + p8.slice(chunk)
}

/**
 * Text from the editor -> p8str. Characters PICO-8 doesn't have become their UTF-8 bytes.
 * @param {string} text
 * @returns {string}
 */
export function fromDisplay(text) {
  return unicodeToP8scii(text)
}

/**
 * Converts offsets between a p8str and its display form.
 */
export class OffsetMap {
  /** @param {string} p8 */
  constructor(p8) {
    /** p8 indexes of the chars that display as two units, ascending @type {number[]} */
    this.wide = []
    for (let i = 0; i < p8.length; i++) if (WIDE.has(p8.charCodeAt(i))) this.wide.push(i)
  }

  /**
   * @param {number} p8Offset
   * @returns {number} offset in the display text
   */
  toDisplay(p8Offset) {
    return p8Offset + this.#count(p8Offset)
  }

  /**
   * @param {number} displayOffset
   * @returns {number} offset in the p8str (inside a pair it rounds down)
   */
  toP8(displayOffset) {
    if (!this.wide.length) return displayOffset
    // the k-th wide char starts at display index wide[k] + k
    let lo = 0
    let hi = this.wide.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.wide[mid] + mid < displayOffset) lo = mid + 1
      else hi = mid
    }
    // `lo` wide chars start before displayOffset; each added one extra unit (a char that contains
    // displayOffset in its middle rounds down to its own index, which this also yields)
    return displayOffset - lo
  }

  /** Number of wide chars strictly before a p8 index. @param {number} p8Offset */
  #count(p8Offset) {
    let lo = 0
    let hi = this.wide.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.wide[mid] < p8Offset) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}
