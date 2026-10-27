import { FormatError } from './errors.js'

/**
 * Decompression of the code region of a PICO-8 cart (bytes 0x4300..0x8000).
 *
 * Three encodings exist:
 *  - `raw`:    plain text, terminated by a NUL byte (carts that predate compression)
 *  - `legacy`: header `:c:\0`, a lookup-table + LZ scheme (PICO-8 0.1.x)
 *  - `pxa`:    header `\0pxa`, bitstream with move-to-front literals + LZ (PICO-8 0.2+)
 *
 * Code is returned as a "binary string": one JS char per byte (char code 0..255).
 * Mapping PICO-8's 8-bit charset to/from Unicode is the job of the .p8 text codec.
 *
 * @typedef {'raw' | 'legacy' | 'pxa'} CodeFormat
 */

/** Index 0 is the escape marker and has no character. Indices 1..0x3b map to these chars. */
const LEGACY_TABLE = '\0\n 0123456789abcdefghijklmnopqrstuvwxyz!#%(){}[]<>+=/*:;.,~_'

/** @param {ArrayLike<number>} bytes */
function toBinaryString(bytes) {
  let out = ''
  const CHUNK = 0x2000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, /** @type {number[]} */ (Array.prototype.slice.call(bytes, i, i + CHUNK)))
  }
  return out
}

/**
 * Detect the format of a code region without decoding it.
 * @param {Uint8Array} region
 * @returns {CodeFormat}
 */
export function detectCodeFormat(region) {
  if (region.length >= 4) {
    if (region[0] === 0x3a && region[1] === 0x63 && region[2] === 0x3a && region[3] === 0x00) return 'legacy'
    if (region[0] === 0x00 && region[1] === 0x70 && region[2] === 0x78 && region[3] === 0x61) return 'pxa'
  }
  return 'raw'
}

/**
 * @param {Uint8Array} region
 * @returns {{ code: string, format: CodeFormat }}
 */
export function decompressCode(region) {
  const format = detectCodeFormat(region)
  switch (format) {
    case 'legacy':
      return { code: decompressLegacy(region), format }
    case 'pxa':
      return { code: decompressPxa(region), format }
    default:
      return { code: decodeRaw(region), format }
  }
}

/** @param {Uint8Array} region */
function decodeRaw(region) {
  let end = region.indexOf(0)
  if (end < 0) end = region.length
  return toBinaryString(region.subarray(0, end))
}

/** @param {Uint8Array} region */
function decompressLegacy(region) {
  if (region.length < 8) throw new FormatError('legacy code header is truncated')
  const length = (region[4] << 8) | region[5]
  const out = new Uint8Array(length)
  let outPos = 0
  let pos = 8

  while (outPos < length) {
    if (pos >= region.length) throw new FormatError('legacy code stream ended early')
    const c = region[pos++]
    if (c === 0x00) {
      if (pos >= region.length) throw new FormatError('legacy code stream ended early')
      out[outPos++] = region[pos++]
    } else if (c <= 0x3b) {
      out[outPos++] = LEGACY_TABLE.charCodeAt(c)
    } else {
      if (pos >= region.length) throw new FormatError('legacy code stream ended early')
      const c2 = region[pos++]
      const offset = (c - 0x3c) * 16 + (c2 & 0x0f)
      const count = (c2 >> 4) + 2
      if (offset === 0 || offset > outPos) throw new FormatError('legacy code has an invalid back-reference')
      // Byte-by-byte on purpose: matches may overlap their own output.
      for (let i = 0; i < count && outPos < length; i++, outPos++) out[outPos] = out[outPos - offset]
    }
  }
  return toBinaryString(out)
}

/** LSB-first bit reader over a byte array. */
class BitReader {
  /**
   * @param {Uint8Array} bytes
   * @param {number} bytePos
   */
  constructor(bytes, bytePos) {
    this.bytes = bytes
    this.bitPos = bytePos * 8
  }

  bit() {
    const byteIndex = this.bitPos >> 3
    if (byteIndex >= this.bytes.length) throw new FormatError('pxa code stream ended early')
    const v = (this.bytes[byteIndex] >> (this.bitPos & 7)) & 1
    this.bitPos++
    return v
  }

  /** @param {number} n */
  bits(n) {
    let v = 0
    for (let i = 0; i < n; i++) v |= this.bit() << i
    return v
  }
}

/** @param {Uint8Array} region */
function decompressPxa(region) {
  if (region.length < 8) throw new FormatError('pxa code header is truncated')
  const length = (region[4] << 8) | region[5]
  // region[6..8] is the compressed length; the stream is self-terminating so it isn't needed.

  const mtf = Array.from({ length: 256 }, (_, i) => i)
  const br = new BitReader(region, 8)
  /** @type {number[]} */
  const out = []

  while (out.length < length) {
    if (br.bit()) {
      // Literal: index into the move-to-front table. Unary-coded extra bit count.
      let extra = 0
      while (br.bit()) extra++
      const idx = br.bits(4 + extra) + (((1 << extra) - 1) << 4)
      if (idx > 255) throw new FormatError('pxa literal index out of range')
      const ch = mtf[idx]
      out.push(ch)
      mtf.splice(idx, 1)
      mtf.unshift(ch)
    } else {
      const offlen = br.bit() ? (br.bit() ? 5 : 10) : 15
      const offset = br.bits(offlen) + 1

      if (offset === 1 && offlen !== 5) {
        // Raw block: NUL-terminated run of bytes.
        for (;;) {
          const ch = br.bits(8)
          if (ch === 0) break
          out.push(ch)
        }
      } else {
        let count = 3
        for (;;) {
          const part = br.bits(3)
          count += part
          if (part !== 7) break
        }
        if (offset > out.length) throw new FormatError('pxa code has an invalid back-reference')
        for (let i = 0; i < count; i++) out.push(out[out.length - offset])
      }
    }
  }

  out.length = length
  return toBinaryString(out)
}
