import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { compressCode, compressPxa, planPxa } from '../../src/formats/code-compress.js'
import { decompressCode } from '../../src/formats/code-decompress.js'
import { decode } from 'fast-png'
import { decodeP8Png, extractBytes } from '../../src/formats/p8png.js'
import { ExportLimitError } from '../../src/formats/errors.js'
import { CODE_END, CODE_START } from '../../src/profiles/pico8/memory-map.js'

const fixture = (/** @type {string} */ name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url))

/** @param {string} code */
function roundTrip(code) {
  const region = compressPxa(code)
  const { code: back, format } = decompressCode(region)
  expect(format).toBe('pxa')
  return back
}

/** Deterministic pseudo-random bytes (xorshift), so failures are reproducible. */
function noise(/** @type {number} */ n, seed = 12345) {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    s += String.fromCharCode((x >>> 0) & 255)
  }
  return s
}

describe('compressPxa', () => {
  it('writes the header: magic, uncompressed length, total length including the header', () => {
    const region = compressPxa('hello hello hello')
    expect([...region.subarray(0, 4)]).toEqual([0, 0x70, 0x78, 0x61])
    expect((region[4] << 8) | region[5]).toBe(17)
    expect((region[6] << 8) | region[7]).toBe(region.length)
  })

  it('handles the empty string', () => {
    expect(roundTrip('')).toBe('')
  })

  it('handles one char, including NUL', () => {
    expect(roundTrip('x')).toBe('x')
    expect(roundTrip('\0')).toBe('\0')
  })

  it('compresses long runs to almost nothing', () => {
    const code = 'a'.repeat(20000)
    expect(roundTrip(code)).toBe(code)
    // ~3 bits per 7 chars at best; far below the 20000 input
    expect(compressPxa(code).length).toBeLessThan(20000 / 7)
  })

  it('round-trips every byte value, in order and reversed', () => {
    const all = String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i))
    expect(roundTrip(all)).toBe(all)
    const rev = [...all].reverse().join('')
    expect(roundTrip(rev)).toBe(rev)
  })

  it('round-trips repetitive text with long-distance matches', () => {
    const chunk = noise(1500, 7)
    const code = chunk + noise(2000, 9) + chunk + noise(3000, 11) + chunk
    expect(roundTrip(code)).toBe(code)
    // the second and third copy of `chunk` (class-15 offsets) must be found
    expect(compressPxa(code).length).toBeLessThan(code.length - 2 * 1500 + 600)
  })

  it('never expands incompressible data by more than a raw block costs', () => {
    for (const seed of [1, 2, 3]) {
      const code = noise(5000, seed)
      expect(roundTrip(code)).toBe(code)
      // 8-byte header + 13 bits + 8 bits per char + 8 bits terminator, plus a few bytes for each
      // NUL (raw blocks can't contain one, so it ends the block and costs a literal).
      const nuls = [...code].filter((c) => c === '\0').length
      expect(compressPxa(code).length).toBeLessThanOrEqual(8 + 5000 + 3 + 5 * nuls)
    }
  })

  it('reports an exact bit cost for its plan', () => {
    for (const code of ['', 'abcabcabcabc', noise(3000, 5), 'x = x + 1\n'.repeat(300)]) {
      const { bits } = planPxa(code)
      expect(compressPxa(code).length).toBe(8 + Math.ceil(bits / 8))
    }
  })

  it('round-trips arbitrary strings (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 400 }), (bytes) => {
        const code = String.fromCharCode(...bytes)
        expect(roundTrip(code)).toBe(code)
      }),
    )
  })

  it('round-trips strings over a tiny alphabet, which forces many overlapping matches (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(0, 1, 97, 98), { maxLength: 600 }), (bytes) => {
        const code = String.fromCharCode(...bytes)
        expect(roundTrip(code)).toBe(code)
      }),
    )
  })

  it('rejects text that is not a p8str', () => {
    expect(() => compressPxa('\u0100')).toThrow(RangeError)
  })

  it('refuses code longer than the 16-bit header can express', () => {
    const err = (() => {
      try {
        compressPxa('a'.repeat(65536))
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(ExportLimitError)
    expect(err).toMatchObject({ limit: 'codeChars', actual: 65536, max: 65535 })
  })

  it('copes with the maximum code length in reasonable time', () => {
    const line = 'if (btn(0)) x -= 1 -- move the player left\n'
    let code = ''
    for (let i = 0; code.length < 65000; i++) code += line.replace('x', 'x' + (i % 97))
    code = code.slice(0, 65535)
    const start = Date.now()
    expect(roundTrip(code)).toBe(code)
    expect(Date.now() - start).toBeLessThan(10000)
  })
})

describe('compressCode', () => {
  it('keeps short unique text as plain text', () => {
    const { bytes, format } = compressCode('print("hi")')
    expect(format).toBe('raw')
    expect(decompressCode(bytes)).toEqual({ code: 'print("hi")', format: 'raw' })
  })

  it('uses pxa when it is smaller', () => {
    const code = 'print("hello world")\n'.repeat(50)
    const { bytes, format } = compressCode(code)
    expect(format).toBe('pxa')
    expect(bytes.length).toBeLessThan(code.length / 4)
  })

  it('never stores code containing NUL as plain text', () => {
    const { format } = compressCode('a\0b')
    expect(format).toBe('pxa')
  })

  it('stores empty code as nothing', () => {
    const { bytes, format } = compressCode('')
    expect(format).toBe('raw')
    expect(bytes).toHaveLength(0)
  })
})

describe('against real cartridges', () => {
  for (const name of ['shrinko8/genend', 'picotool/test_gol', 'picotool/test_cart', 'picotool/memorymap']) {
    it(`round-trips the code of ${name}`, () => {
      const { code } = decodeP8Png(fixture(`${name}.p8.png`))
      expect(roundTrip(code)).toBe(code)
    })
  }

  it('does at least as well as PICO-8 itself on genend (4290 chars)', () => {
    const png = fixture('shrinko8/genend.p8.png')
    const { code } = decodeP8Png(png)
    const image = decode(png)
    const bytes = extractBytes(image.data, image.width * image.height)
    const region = bytes.subarray(CODE_START, CODE_END)
    const original = (region[6] << 8) | region[7] // total size PICO-8 stored, header included
    expect(compressPxa(code).length).toBeLessThanOrEqual(original)
  })
})
