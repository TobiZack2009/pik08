import { ExportLimitError } from './errors.js'

/**
 * Compression of cart code into the `\0pxa` format (PICO-8 0.2+). The decoder lives in
 * code-decompress.js; the format is described there.
 *
 * The compressor is an optimal-parse dynamic program over bit costs. A path through the code
 * is a sequence of tokens:
 *
 *   literal  1 + (extra+1) + (4+extra) bits, `extra` growing with the char's move-to-front index
 *   copy     class bits (5-bit offset: 3, 10-bit: 3, 15-bit: 2) + the offset + 3 bits per 7 chars
 *   raw      13 header bits, 8 bits per char, 8 bit NUL terminator (no NULs inside)
 *
 * The one thing that makes this inexact is the move-to-front table: a literal's cost depends on
 * the whole history. Each DP node keeps the table of its own best path, so the cost of the path
 * we finally choose is always exact; it just may not be the global optimum.
 *
 * @typedef {{ lit: number } | { copy: [offset: number, count: number] } | { raw: [start: number, end: number] }} PxaToken
 */

const MAX_LEN = 1024
const MAX_OFFSET = 0x8000
const CHAIN_LIMIT = 128
const HASH_BITS = 15
const INF = 0x3fffffff

/** Largest 16-bit values the header can hold. */
const HEADER_MAX = 0xffff
const HEADER_SIZE = 8

const RAW_OPEN_BITS = 13
const RAW_CLOSE_BITS = 8
const COPY_BASE_BITS = [8, 13, 17]

// How a DP node was reached.
const LITERAL = 1
const COPY = 2
const CLOSE = 3 // N node reached by terminating a raw block
const OPEN = 1 // R node reached by opening a raw block
const CONTINUE = 2 // R node reached by extending a raw block

/** @param {number} idx  move-to-front index */
function literalBits(idx) {
  if (idx < 16) return 6
  if (idx < 48) return 8
  if (idx < 112) return 10
  if (idx < 240) return 12
  return 14
}

/** @param {number} len */
function countBits(len) {
  return 3 * (Math.floor((len - 3) / 7) + 1)
}

/**
 * @param {string} code
 * @returns {Uint8Array}
 */
function toBytes(code) {
  const out = new Uint8Array(code.length)
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i)
    if (c > 255) throw new RangeError(`code is not a p8str: char ${c} at index ${i}`)
    out[i] = c
  }
  return out
}

/**
 * Find the cheapest token sequence for `s`.
 * @param {Uint8Array} s
 * @returns {{ tokens: PxaToken[], bits: number }}
 */
function plan(s) {
  const n = s.length
  const costN = new Int32Array(n + 1).fill(INF)
  const costR = new Int32Array(n + 1).fill(INF)
  const kindN = new Uint8Array(n + 1)
  const kindR = new Uint8Array(n + 1)
  const fromN = new Int32Array(n + 1)
  const offN = new Int32Array(n + 1)
  /** @type {Uint8Array[]} */
  const mtfN = new Array(n + 1)
  /** @type {Uint8Array[]} */
  const mtfR = new Array(n + 1)

  costN[0] = 0
  mtfN[0] = Uint8Array.from({ length: 256 }, (_, i) => i)

  const head = new Int32Array(1 << HASH_BITS).fill(-1)
  const prev = new Int32Array(n).fill(-1)
  const bestLen = [0, 0, 0]
  const bestOff = [0, 0, 0]

  /** @param {number} i */
  const hashAt = (i) => Math.imul((s[i] << 16) | (s[i + 1] << 8) | s[i + 2], 0x9e3779b1) >>> (32 - HASH_BITS)

  /**
   * Longest match per offset class for the text at `i`, into bestLen/bestOff.
   * @param {number} i
   */
  function findMatches(i) {
    bestLen[0] = bestLen[1] = bestLen[2] = 0
    if (i + 3 > n) return
    const max = Math.min(MAX_LEN, n - i)
    let steps = 0
    for (let cand = head[hashAt(i)]; cand >= 0 && steps < CHAIN_LIMIT; cand = prev[cand], steps++) {
      const offset = i - cand
      if (offset > MAX_OFFSET) break
      let len = 0
      while (len < max && s[cand + len] === s[i + len]) len++
      if (len < 3) continue
      const cls = offset <= 32 ? 0 : offset <= 1024 ? 1 : 2
      if (len > bestLen[cls]) {
        bestLen[cls] = len
        bestOff[cls] = offset
      }
      // Candidates further back can't be longer, only dearer.
      if (len === max) break
    }
  }

  /**
   * @param {number} i
   * @param {number} len
   * @param {number} cls
   */
  function relaxCopy(i, len, cls) {
    const j = i + len
    const c = costN[i] + COPY_BASE_BITS[cls] + countBits(len)
    if (c < costN[j]) {
      costN[j] = c
      kindN[j] = COPY
      fromN[j] = i
      offN[j] = bestOff[cls]
    }
  }

  for (let i = 0; i <= n; i++) {
    // --- finalize the two states at i
    if (i > 0) {
      if (costR[i] < INF) {
        mtfR[i] = kindR[i] === OPEN ? mtfN[i - 1] : mtfR[i - 1]
        if (costR[i] + RAW_CLOSE_BITS < costN[i]) {
          costN[i] = costR[i] + RAW_CLOSE_BITS
          kindN[i] = CLOSE
        }
      }
      if (kindN[i] === LITERAL) {
        const m = mtfN[i - 1].slice()
        const idx = m.indexOf(s[i - 1])
        m.copyWithin(1, 0, idx)
        m[0] = s[i - 1]
        mtfN[i] = m
      } else if (kindN[i] === COPY) {
        mtfN[i] = mtfN[fromN[i]]
      } else {
        mtfN[i] = mtfR[i]
      }
    }
    if (i === n) break

    const ch = s[i]
    const here = costN[i]

    // --- literal
    const idx = mtfN[i].indexOf(ch)
    const litCost = here + literalBits(idx)
    if (litCost < costN[i + 1]) {
      costN[i + 1] = litCost
      kindN[i + 1] = LITERAL
    }

    // --- raw block: open here, or extend the one that's open
    if (ch !== 0) {
      const open = here + RAW_OPEN_BITS + 8
      if (open < costR[i + 1]) {
        costR[i + 1] = open
        kindR[i + 1] = OPEN
      }
      if (costR[i] < INF) {
        const cont = costR[i] + 8
        if (cont < costR[i + 1]) {
          costR[i + 1] = cont
          kindR[i + 1] = CONTINUE
        }
      }
    }

    // --- copies
    findMatches(i)
    let covered = 2 // lengths up to here are already available more cheaply
    for (let cls = 0; cls < 3; cls++) {
      const hi = bestLen[cls]
      if (hi <= covered) continue
      const lo = covered + 1
      for (let len = lo; len <= Math.min(hi, 40); len++) relaxCopy(i, len, cls)
      // Beyond that only the end of each 7-long cost bucket (and the maximum) can matter.
      if (hi > 40) {
        const start = Math.max(41, lo)
        let len = 3 + 7 * Math.floor((start - 3) / 7) + 6
        for (; len <= hi; len += 7) relaxCopy(i, len, cls)
        if (len - 7 !== hi) relaxCopy(i, hi, cls)
      }
      covered = hi
    }

    if (i + 3 <= n) {
      const h = hashAt(i)
      prev[i] = head[h]
      head[h] = i
    }
  }

  /** @type {PxaToken[]} */
  const tokens = []
  for (let i = n; i > 0; ) {
    if (kindN[i] === LITERAL) {
      tokens.push({ lit: s[i - 1] })
      i--
    } else if (kindN[i] === COPY) {
      tokens.push({ copy: [offN[i], i - fromN[i]] })
      i = fromN[i]
    } else {
      let k = i
      while (kindR[k] === CONTINUE) k--
      tokens.push({ raw: [k - 1, i] })
      i = k - 1
    }
  }
  tokens.reverse()
  return { tokens, bits: costN[n] }
}

/** LSB-first bit writer. */
class BitWriter {
  constructor() {
    /** @type {number[]} */
    this.bytes = []
    this.length = 0
  }

  /** @param {number} b */
  bit(b) {
    if ((this.length & 7) === 0) this.bytes.push(0)
    if (b) this.bytes[this.length >> 3] |= 1 << (this.length & 7)
    this.length++
  }

  /**
   * @param {number} value
   * @param {number} n
   */
  bits(value, n) {
    for (let i = 0; i < n; i++) this.bit((value >> i) & 1)
  }
}

/**
 * Serialize tokens into the bitstream (no header).
 * @param {Uint8Array} s
 * @param {PxaToken[]} tokens
 */
function writeTokens(s, tokens) {
  const w = new BitWriter()
  const mtf = Array.from({ length: 256 }, (_, i) => i)

  for (const t of tokens) {
    if ('lit' in t) {
      const idx = mtf.indexOf(t.lit)
      let extra = 0
      while (idx >= ((1 << (extra + 1)) - 1) * 16) extra++
      w.bit(1)
      for (let e = 0; e < extra; e++) w.bit(1)
      w.bit(0)
      w.bits(idx - (((1 << extra) - 1) << 4), 4 + extra)
      mtf.splice(idx, 1)
      mtf.unshift(t.lit)
    } else if ('copy' in t) {
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
    } else {
      // offset 1 in the 10-bit class is the (otherwise useless) raw block marker
      w.bit(0)
      w.bit(1)
      w.bit(0)
      w.bits(0, 10)
      for (let i = t.raw[0]; i < t.raw[1]; i++) w.bits(s[i], 8)
      w.bits(0, 8)
    }
  }
  return w
}

/**
 * The cheapest token sequence found for `code`, and its exact size in bits.
 * Exposed for tests.
 * @param {string} code
 */
export function planPxa(code) {
  return plan(toBytes(code))
}

/**
 * Compress code into a complete `\0pxa` region (header included, no padding).
 * @param {string} code  a p8str
 * @returns {Uint8Array}
 * @throws {ExportLimitError} if the code or its compressed form don't fit the 16-bit header fields
 */
export function compressPxa(code) {
  if (code.length > HEADER_MAX) throw new ExportLimitError('codeChars', code.length, HEADER_MAX)
  const s = toBytes(code)
  const { tokens } = plan(s)
  const w = writeTokens(s, tokens)

  const total = HEADER_SIZE + w.bytes.length
  if (total > HEADER_MAX) throw new ExportLimitError('compressedBytes', total, HEADER_MAX)
  const out = new Uint8Array(total)
  out.set([0x00, 0x70, 0x78, 0x61, code.length >> 8, code.length & 0xff, total >> 8, total & 0xff])
  out.set(w.bytes, HEADER_SIZE)
  return out
}

/**
 * Encode code for the code region of a cart: plain text if that is no bigger (and possible,
 * i.e. the code has no NUL), otherwise pxa.
 * @param {string} code  a p8str
 * @returns {{ bytes: Uint8Array, format: 'raw' | 'pxa' }}
 */
export function compressCode(code) {
  const pxa = compressPxa(code)
  if (!code.includes('\0') && code.length <= pxa.length) return { bytes: toBytes(code), format: 'raw' }
  return { bytes: pxa, format: 'pxa' }
}
