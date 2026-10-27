import { P8SCII_TABLE, UNICAP_FIRST_CODEPOINT, VARIANT_SELECTOR_BYTES } from './p8scii-table.js'

/**
 * Conversion between Unicode text (what `.p8` files contain, as UTF-8) and PICO-8 "p8str"s,
 * which this project represents as binary strings: one JS char per byte, char code 0..255.
 */

const VARIATION_SELECTOR_16 = 0xfe0f

/** @type {Map<number, number>} base code point -> P8SCII byte */
const REVERSE = new Map()
P8SCII_TABLE.forEach((ch, byte) => REVERSE.set(/** @type {number} */ (ch.codePointAt(0)), byte))
// PICO-8 copies capital letters as italic code points; accept them on the way in.
for (let i = 0; i < 26; i++) REVERSE.set(UNICAP_FIRST_CODEPOINT + i, 0x41 + i)

const VARIANT_BYTES = new Set(VARIANT_SELECTOR_BYTES)
const utf8 = new TextEncoder()

/**
 * Unicode text -> p8str. Code points outside the PICO-8 charset are reinterpreted as their
 * UTF-8 bytes, which is what PICO-8 itself does with characters it doesn't understand.
 * @param {string} text
 * @returns {string}
 */
export function unicodeToP8scii(text) {
  let out = ''
  for (const ch of text) {
    const cp = /** @type {number} */ (ch.codePointAt(0))
    if (cp < 0x80) {
      out += ch
    } else if (cp === VARIATION_SELECTOR_16) {
      // Emoji-presentation selector: already implied by the glyph that precedes it.
    } else {
      const byte = REVERSE.get(cp)
      if (byte !== undefined) out += String.fromCharCode(byte)
      else for (const b of utf8.encode(ch)) out += String.fromCharCode(b)
    }
  }
  return out
}

/**
 * p8str -> Unicode text, as PICO-8 writes it into `.p8` files.
 * @param {string} p8str
 * @returns {string}
 */
export function p8sciiToUnicode(p8str) {
  let out = ''
  for (let i = 0; i < p8str.length; i++) {
    const byte = p8str.charCodeAt(i)
    if (byte > 0xff) throw new RangeError(`not a p8str: char code ${byte} at index ${i}`)
    out += P8SCII_TABLE[byte]
    if (VARIANT_BYTES.has(byte)) out += '\ufe0f'
  }
  return out
}
