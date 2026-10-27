import { createCart } from '../core/cart.js'
import { pico8Profile } from '../profiles/pico8/index.js'
import { FormatError } from './errors.js'
import { p8sciiToUnicode, unicodeToP8scii } from './p8scii.js'

/** @import { Cart } from '../core/cart.js' */
/** @import { Profile } from '../core/profile.js' */

/**
 * The `.p8` text cartridge format:
 *
 *     pico-8 cartridge // http://www.pico-8.com
 *     version 41
 *     __lua__
 *     ...code...
 *     __gfx__        128 rows x 128 hex digits, one digit per pixel (left pixel = LOW nibble of the byte)
 *     __label__      128 rows x 128 digits 0-9a-v (palette index 0..31)
 *     __gff__        rows of 256 hex digits (128 bytes: sprite flags)
 *     __map__        32 rows x 256 hex digits (128 bytes per row)
 *     __sfx__        64 rows: 8 hex header digits + 32 notes x 5 digits (pitch2 wave1 vol1 fx1)
 *     __music__      64 rows: "FF AABBCCDD" (flags, then 4 channel bytes with bit 7 stripped)
 *
 * Every section after `__lua__` may be missing or end early; absent rows have the value of a new
 * cart (`profile.cart.createRom()`: zero, except music patterns and sfx speeds). Our writer drops
 * trailing rows that are at that value, and with them empty sections.
 */

const HEADER = 'pico-8 cartridge // http://www.pico-8.com'
const SECTION_RE = /^__([a-z0-9:_]+?)__$/i

const GFX_ROW_BYTES = 64
const MAP_ROW_BYTES = 128
const FLAG_ROW_BYTES = 128
const SFX_SIZE = 68
const SFX_NOTES = 32
const SFX_NOTE_OFFSET_HEADER = SFX_NOTES * 2
const MUSIC_SIZE = 4
const LABEL_DIGITS = '0123456789abcdefghijklmnopqrstuv'

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))
const HEX_RE = /^[0-9a-f]*$/i

/**
 * @param {string} row
 * @param {string} section
 * @param {number} lineNo  1-based line number in the file
 */
function checkHex(row, section, lineNo) {
  if (!HEX_RE.test(row)) throw new FormatError(`line ${lineNo}: invalid hex digit in __${section}__`)
}

/**
 * Parse `.p8` text into a cart.
 * @param {string} text
 * @param {Profile} [profile]
 * @returns {Cart}
 */
export function parseP8(text, profile = pico8Profile) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop() // the terminator of the last line

  if (!lines[0] || !lines[0].startsWith('pico-8 cartridge')) throw new FormatError('not a .p8 cartridge: missing header')

  const cart = createCart(profile)

  /** @type {{ name: string, firstLine: number, lines: string[] }[]} */
  const sections = []
  for (let i = 1; i < lines.length; i++) {
    const marker = SECTION_RE.exec(lines[i])
    if (marker) {
      sections.push({ name: marker[1].toLowerCase(), firstLine: i + 2, lines: [] })
    } else if (sections.length) {
      sections[sections.length - 1].lines.push(lines[i])
    } else {
      const v = /^version\s+(\d+)/.exec(lines[i])
      if (v) cart.version = Number(v[1])
    }
  }

  const { regions } = profile.memory
  for (const { name, firstLine, lines: rows } of sections) {
    switch (name) {
      case 'lua':
        cart.code = unicodeToP8scii(rows.join('\n'))
        break
      case 'gfx':
        parseGfx(rows, firstLine, cart.rom.subarray(...regions.gfx))
        break
      case 'gff':
        parseHexRows(rows, firstLine, 'gff', FLAG_ROW_BYTES, cart.rom.subarray(...regions.flags))
        break
      case 'map':
        parseHexRows(rows, firstLine, 'map', MAP_ROW_BYTES, cart.rom.subarray(...regions.map))
        break
      case 'label':
        cart.label = parseLabel(rows, firstLine, profile.display.width, profile.display.height)
        break
      case 'sfx':
        parseSfx(rows, firstLine, cart.rom.subarray(...regions.sfx))
        break
      case 'music':
        parseMusic(rows, firstLine, cart.rom.subarray(...regions.music))
        break
      default:
        cart.extra[name] = rows
    }
  }
  return cart
}

/**
 * @param {string[]} rows
 * @param {number} firstLine
 * @param {Uint8Array} dest
 */
function parseGfx(rows, firstLine, dest) {
  const rowCount = dest.length / GFX_ROW_BYTES
  for (let y = 0; y < Math.min(rows.length, rowCount); y++) {
    const row = rows[y].trimEnd()
    checkHex(row, 'gfx', firstLine + y)
    for (let x = 0; x < Math.min(row.length, GFX_ROW_BYTES * 2); x++) {
      const nibble = parseInt(row[x], 16)
      dest[y * GFX_ROW_BYTES + (x >> 1)] |= x & 1 ? nibble << 4 : nibble
    }
  }
}

/**
 * Rows of plain hex bytes (high nibble first).
 * @param {string[]} rows
 * @param {number} firstLine
 * @param {string} section
 * @param {number} rowBytes
 * @param {Uint8Array} dest
 */
function parseHexRows(rows, firstLine, section, rowBytes, dest) {
  const rowCount = dest.length / rowBytes
  for (let y = 0; y < Math.min(rows.length, rowCount); y++) {
    const row = rows[y].trimEnd()
    checkHex(row, section, firstLine + y)
    for (let i = 0; i < Math.min(row.length >> 1, rowBytes); i++) {
      dest[y * rowBytes + i] = parseInt(row.slice(i * 2, i * 2 + 2), 16)
    }
  }
}

/**
 * @param {string[]} rows
 * @param {number} firstLine
 * @param {number} width
 * @param {number} height
 */
function parseLabel(rows, firstLine, width, height) {
  const label = new Uint8Array(width * height)
  for (let y = 0; y < Math.min(rows.length, height); y++) {
    const row = rows[y].trimEnd()
    for (let x = 0; x < Math.min(row.length, width); x++) {
      const v = LABEL_DIGITS.indexOf(row[x].toLowerCase())
      if (v < 0) throw new FormatError(`line ${firstLine + y}: invalid digit '${row[x]}' in __label__`)
      label[y * width + x] = v
    }
  }
  return label
}

/**
 * Note layout in memory (little-endian 16 bits): pitch[0..5] wave[6..8] volume[9..11]
 * effect[12..14] custom-instrument[15]. In text: pitch(2) wave(1, +8 if custom) volume(1) effect(1).
 * Each sfx is 32 notes (64 bytes) followed by 4 header bytes: editor mode, speed, loop start,
 * loop end; the text row lists those 4 header bytes first.
 * @param {string[]} rows
 * @param {number} firstLine
 * @param {Uint8Array} dest
 */
function parseSfx(rows, firstLine, dest) {
  const count = dest.length / SFX_SIZE
  for (let i = 0; i < Math.min(rows.length, count); i++) {
    const row = rows[i].trimEnd()
    checkHex(row, 'sfx', firstLine + i)
    const r = row.padEnd(8 + SFX_NOTES * 5, '0')
    const base = i * SFX_SIZE
    for (let h = 0; h < 4; h++) dest[base + SFX_NOTE_OFFSET_HEADER + h] = parseInt(r.slice(h * 2, h * 2 + 2), 16)
    for (let n = 0; n < SFX_NOTES; n++) {
      const o = 8 + n * 5
      const pitch = parseInt(r.slice(o, o + 2), 16) & 0x3f
      const wave = parseInt(r[o + 2], 16)
      const volume = parseInt(r[o + 3], 16) & 7
      const effect = parseInt(r[o + 4], 16) & 7
      dest[base + n * 2] = pitch | ((wave & 3) << 6)
      dest[base + n * 2 + 1] = ((wave >> 2) & 1) | (volume << 1) | (effect << 4) | (((wave >> 3) & 1) << 7)
    }
  }
}

const MUSIC_RE = /^([0-9a-f]{2}) ([0-9a-f]{8})$/i

/**
 * Each pattern is 4 bytes, one per channel: bit 7 is a flag, the rest the sfx id (bit 6 = muted).
 * Text: the four flag bits as one hex byte (bit c = channel c), then the 4 bytes without bit 7.
 * @param {string[]} rows
 * @param {number} firstLine
 * @param {Uint8Array} dest
 */
function parseMusic(rows, firstLine, dest) {
  const count = dest.length / MUSIC_SIZE
  for (let i = 0; i < Math.min(rows.length, count); i++) {
    const row = rows[i].trimEnd()
    const m = MUSIC_RE.exec(row)
    if (!m) throw new FormatError(`line ${firstLine + i}: malformed __music__ row`)
    const flags = parseInt(m[1], 16)
    for (let c = 0; c < MUSIC_SIZE; c++) {
      dest[i * MUSIC_SIZE + c] = (parseInt(m[2].slice(c * 2, c * 2 + 2), 16) & 0x7f) | (((flags >> c) & 1) << 7)
    }
  }
}

/**
 * Serialize a cart to `.p8` text.
 * @param {Cart} cart
 * @param {Profile} [profile]
 * @returns {string}
 */
export function serializeP8(cart, profile = pico8Profile) {
  const { regions } = profile.memory
  const out = [HEADER, `version ${cart.version}`, '__lua__']
  if (cart.code !== '') out.push(p8sciiToUnicode(cart.code))

  const add = (/** @type {string} */ name, /** @type {string[]} */ rows) => {
    if (rows.length) out.push(`__${name}__`, ...rows)
  }

  // Trailing rows that equal a new cart's are left out; reading puts them back.
  const blank = createCart(profile).rom
  const rowsOf = (/** @type {string} */ region, /** @type {(data: Uint8Array) => string[]} */ toRows) =>
    trimDefault(toRows(cart.rom.subarray(...regions[region])), toRows(blank.subarray(...regions[region])))

  add('gfx', rowsOf('gfx', gfxRows))
  if (cart.label) add('label', labelRows(cart.label, profile.display.width, profile.display.height))
  add('gff', rowsOf('flags', (d) => hexRows(d, FLAG_ROW_BYTES)))
  add('map', rowsOf('map', (d) => hexRows(d, MAP_ROW_BYTES)))
  add('sfx', rowsOf('sfx', sfxRows))
  add('music', rowsOf('music', musicRows))

  for (const [name, rows] of Object.entries(cart.extra)) add(name, rows)
  return out.join('\n') + '\n'
}

/**
 * Drop trailing rows that are the same as the default row at that index.
 * @param {string[]} rows
 * @param {string[]} defaults
 */
function trimDefault(rows, defaults) {
  let end = rows.length
  while (end > 0 && rows[end - 1] === defaults[end - 1]) end--
  return rows.slice(0, end)
}

/** @param {Uint8Array} data */
function gfxRows(data) {
  const rows = []
  for (let y = 0; y < data.length / GFX_ROW_BYTES; y++) {
    let row = ''
    for (let i = 0; i < GFX_ROW_BYTES; i++) {
      const b = data[y * GFX_ROW_BYTES + i]
      row += (b & 15).toString(16) + (b >> 4).toString(16)
    }
    rows.push(row)
  }
  return rows
}

/**
 * @param {Uint8Array} data
 * @param {number} rowBytes
 */
function hexRows(data, rowBytes) {
  const rows = []
  for (let y = 0; y < data.length / rowBytes; y++) {
    let row = ''
    for (let i = 0; i < rowBytes; i++) row += HEX[data[y * rowBytes + i]]
    rows.push(row)
  }
  return rows
}

/**
 * @param {Uint8Array} label
 * @param {number} width
 * @param {number} height
 */
function labelRows(label, width, height) {
  const rows = []
  for (let y = 0; y < height; y++) {
    let row = ''
    for (let x = 0; x < width; x++) {
      const v = label[y * width + x]
      if (v > 31) throw new RangeError(`label colour ${v} out of range 0..31`)
      row += LABEL_DIGITS[v]
    }
    rows.push(row)
  }
  return rows
}

/** @param {Uint8Array} data */
function sfxRows(data) {
  const rows = []
  for (let i = 0; i < data.length / SFX_SIZE; i++) {
    const base = i * SFX_SIZE
    let row = ''
    for (let h = 0; h < 4; h++) row += HEX[data[base + SFX_NOTE_OFFSET_HEADER + h]]
    for (let n = 0; n < SFX_NOTES; n++) {
      const lo = data[base + n * 2]
      const hi = data[base + n * 2 + 1]
      const wave = ((lo >> 6) & 3) | ((hi & 1) << 2) | ((hi >> 7) << 3)
      row += HEX[lo & 0x3f] + wave.toString(16) + ((hi >> 1) & 7).toString(16) + ((hi >> 4) & 7).toString(16)
    }
    rows.push(row)
  }
  return rows
}

/** @param {Uint8Array} data */
function musicRows(data) {
  const rows = []
  for (let i = 0; i < data.length / MUSIC_SIZE; i++) {
    let flags = 0
    let bytes = ''
    for (let c = 0; c < MUSIC_SIZE; c++) {
      const b = data[i * MUSIC_SIZE + c]
      flags |= (b >> 7) << c
      bytes += HEX[b & 0x7f]
    }
    rows.push(`${HEX[flags]} ${bytes}`)
  }
  return rows
}
