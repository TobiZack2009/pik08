/**
 * Tiny *encoders* for the two compressed code formats. They emit exactly the primitives the
 * decoders understand (they are not real compressors) so tests can build precise streams.
 * Expected outputs in tests are written by hand, not derived from these.
 */

/** LSB-first bit writer. */
class BitWriter {
  constructor() {
    /** @type {number[]} */
    this.bitsOut = []
  }

  /** @param {number} b */
  bit(b) {
    this.bitsOut.push(b ? 1 : 0)
  }

  /**
   * @param {number} value
   * @param {number} n
   */
  bits(value, n) {
    for (let i = 0; i < n; i++) this.bit((value >> i) & 1)
  }

  toBytes() {
    const out = new Uint8Array(Math.ceil(this.bitsOut.length / 8))
    this.bitsOut.forEach((b, i) => {
      out[i >> 3] |= b << (i & 7)
    })
    return out
  }
}

/**
 * @typedef {{ lit: number } | { raw: number[] } | { copy: [offset: number, count: number] }} PxaToken
 */

/**
 * Build a complete `\0pxa` code region (without padding) from tokens.
 * @param {PxaToken[]} tokens
 * @param {number} [declaredLength]  override the header's uncompressed length
 * @returns {Uint8Array}
 */
export function buildPxa(tokens, declaredLength) {
  const w = new BitWriter()
  const mtf = Array.from({ length: 256 }, (_, i) => i)
  /** @type {number[]} */
  const out = []

  for (const t of tokens) {
    if ('lit' in t) {
      const idx = mtf.indexOf(t.lit)
      w.bit(1)
      let val = idx
      let nbits = 4
      while (val >= 1 << nbits) {
        w.bit(1)
        val -= 1 << nbits
        nbits++
      }
      w.bit(0)
      w.bits(val, nbits)
      mtf.splice(idx, 1)
      mtf.unshift(t.lit)
      out.push(t.lit)
    } else if ('raw' in t) {
      w.bit(0)
      w.bit(1)
      w.bit(0) // offlen 10
      w.bits(0, 10) // offset == 1 with offlen 10 -> raw block
      for (const ch of t.raw) {
        if (ch === 0) throw new Error('raw blocks cannot contain NUL')
        w.bits(ch, 8)
        out.push(ch)
      }
      w.bits(0, 8)
    } else {
      const [offset, count] = t.copy
      w.bit(0)
      if (offset <= 32) {
        w.bit(1)
        w.bit(1)
        w.bits(offset - 1, 5)
      } else if (offset <= 1024) {
        w.bit(1)
        w.bit(0)
        w.bits(offset - 1, 10)
      } else {
        w.bit(0)
        w.bits(offset - 1, 15)
      }
      let rest = count - 3
      while (rest >= 7) {
        w.bits(7, 3)
        rest -= 7
      }
      w.bits(rest, 3)
      for (let i = 0; i < count; i++) out.push(out[out.length - offset])
    }
  }

  const body = w.toBytes()
  const len = declaredLength ?? out.length
  const region = new Uint8Array(8 + body.length)
  region.set([0x00, 0x70, 0x78, 0x61, len >> 8, len & 0xff, (body.length + 8) >> 8, (body.length + 8) & 0xff])
  region.set(body, 8)
  return region
}

/**
 * Build a `:c:\0` legacy code region.
 * @param {number} length  uncompressed length for the header
 * @param {number[]} stream  the compressed byte stream
 * @returns {Uint8Array}
 */
export function buildLegacy(length, stream) {
  return Uint8Array.from([0x3a, 0x63, 0x3a, 0x00, length >> 8, length & 0xff, 0, 0, ...stream])
}

/**
 * Convert a string to bytes (1 char = 1 byte).
 * @param {string} s
 */
export function bytesOf(s) {
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}
