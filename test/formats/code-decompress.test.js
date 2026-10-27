import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { decompressCode, detectCodeFormat } from '../../src/formats/code-decompress.js'
import { FormatError } from '../../src/formats/errors.js'
import { buildLegacy, buildPxa, bytesOf } from '../helpers/code-encoders.js'

describe('detectCodeFormat', () => {
  it('recognises legacy and pxa headers', () => {
    expect(detectCodeFormat(Uint8Array.from([0x3a, 0x63, 0x3a, 0x00, 0, 0, 0, 0]))).toBe('legacy')
    expect(detectCodeFormat(Uint8Array.from([0x00, 0x70, 0x78, 0x61, 0, 0, 0, 0]))).toBe('pxa')
  })

  it('treats anything else as raw, including very short regions', () => {
    expect(detectCodeFormat(bytesOf('print(1)'))).toBe('raw')
    expect(detectCodeFormat(new Uint8Array(0))).toBe('raw')
    expect(detectCodeFormat(bytesOf(':c:x'))).toBe('raw')
  })
})

describe('raw code', () => {
  it('stops at the first NUL', () => {
    const region = Uint8Array.from([...bytesOf('cls()'), 0, ...bytesOf('garbage')])
    expect(decompressCode(region)).toEqual({ code: 'cls()', format: 'raw' })
  })

  it('uses the whole region when there is no NUL', () => {
    expect(decompressCode(bytesOf('abc')).code).toBe('abc')
  })

  it('preserves bytes above 127 as single chars', () => {
    expect(decompressCode(Uint8Array.from([0x80, 0xff, 0x00])).code).toBe('\x80\xff')
  })
})

describe('legacy (:c:) code', () => {
  // Table: \n=1 ' '=2 '0'..'9'=3..12 'a'..'z'=13..38 -> h=20 e=17 l=24 o=27
  it('decodes table lookups', () => {
    expect(decompressCode(buildLegacy(5, [20, 17, 24, 24, 27]))).toEqual({ code: 'hello', format: 'legacy' })
  })

  it('decodes the special characters at the end of the table', () => {
    // '!'=39 '_'=59 (0x3b), newline=1, space=2, '0'=3
    expect(decompressCode(buildLegacy(5, [39, 59, 1, 2, 3])).code).toBe('!_\n 0')
  })

  it('decodes escaped raw bytes after a 0x00 marker', () => {
    expect(decompressCode(buildLegacy(3, [0x00, 0x41, 0x00, 0xe9, 13])).code).toBe('A\xe9a')
  })

  it('decodes back-references, including ones that overlap their own output', () => {
    // 'a' 'b', then ref offset=2 count=4: c=0x3c, c2=(4-2)<<4 | 2 = 0x22
    expect(decompressCode(buildLegacy(6, [13, 14, 0x3c, 0x22])).code).toBe('ababab')
  })

  it('decodes back-references with offsets of 16 or more', () => {
    // a..r (18 chars = table 13..30), then ref offset=18 count=2: c=0x3d, c2=0x02
    const letters = Array.from({ length: 18 }, (_, i) => 13 + i)
    expect(decompressCode(buildLegacy(20, [...letters, 0x3d, 0x02])).code).toBe('abcdefghijklmnopqrab')
  })

  it('rejects truncated streams', () => {
    expect(() => decompressCode(buildLegacy(5, [20, 17]))).toThrow(FormatError)
    expect(() => decompressCode(buildLegacy(2, [0x00]))).toThrow(FormatError)
    expect(() => decompressCode(Uint8Array.from([0x3a, 0x63, 0x3a, 0x00]))).toThrow(FormatError)
  })

  it('rejects back-references that point before the start of the output', () => {
    expect(() => decompressCode(buildLegacy(4, [13, 0x3c, 0x22]))).toThrow(FormatError)
  })
})

describe('pxa code', () => {
  it('decodes literals', () => {
    const region = buildPxa([{ lit: 0x61 }, { lit: 0x62 }, { lit: 0x63 }])
    expect(decompressCode(region)).toEqual({ code: 'abc', format: 'pxa' })
  })

  it('uses a move-to-front table, so repeated literals are cheap and still correct', () => {
    const region = buildPxa([{ lit: 0x61 }, { lit: 0x61 }, { lit: 0x62 }, { lit: 0x61 }, { lit: 0x61 }])
    expect(decompressCode(region).code).toBe('aabaa')
  })

  it('decodes literals whose MTF index needs extra bits', () => {
    // 200 as the very first literal sits at MTF index 200 -> extra=3 (7 index bits)
    expect(decompressCode(buildPxa([{ lit: 200 }, { lit: 3 }, { lit: 200 }])).code).toBe('\xc8\x03\xc8')
  })

  it('decodes raw blocks', () => {
    const region = buildPxa([{ raw: [...bytesOf('hello world')] }])
    expect(decompressCode(region).code).toBe('hello world')
  })

  it('decodes copies with a 5-bit offset', () => {
    expect(decompressCode(buildPxa([{ lit: 0x61 }, { lit: 0x62 }, { copy: [2, 3] }])).code).toBe('ababa')
  })

  it('treats offset 1 with a 5-bit offset field as a real copy, not a raw block', () => {
    expect(decompressCode(buildPxa([{ lit: 0x78 }, { copy: [1, 5] }])).code).toBe('xxxxxx')
  })

  it('decodes long counts using the 3-bit continuation scheme', () => {
    // count 10 = 3 + 7 + 0, count 20 = 3 + 7 + 7 + 3
    expect(decompressCode(buildPxa([{ lit: 0x78 }, { copy: [1, 10] }])).code).toBe('x'.repeat(11))
    expect(decompressCode(buildPxa([{ lit: 0x78 }, { copy: [1, 20] }])).code).toBe('x'.repeat(21))
  })

  it('decodes copies with 10-bit and 15-bit offsets', () => {
    const prefix = Array.from({ length: 1100 }, (_, i) => 65 + (i % 26))
    const text = String.fromCharCode(...prefix)

    // offset 40 -> 10-bit field; copies text[len-40 .. +4]
    const mid = decompressCode(buildPxa([{ raw: prefix }, { copy: [40, 4] }])).code
    expect(mid).toBe(text + text.slice(text.length - 40, text.length - 40 + 4))

    // offset 1100 -> 15-bit field; copies text[0 .. +5]
    const far = decompressCode(buildPxa([{ raw: prefix }, { copy: [1100, 5] }])).code
    expect(far).toBe(text + text.slice(0, 5))
  })

  it('stops at the declared length', () => {
    expect(decompressCode(buildPxa([{ lit: 0x61 }, { lit: 0x62 }, { lit: 0x63 }], 2)).code).toBe('ab')
  })

  it('rejects streams that end early', () => {
    expect(() => decompressCode(buildPxa([{ lit: 0x61 }], 10))).toThrow(FormatError)
    expect(() => decompressCode(Uint8Array.from([0x00, 0x70, 0x78, 0x61]))).toThrow(FormatError)
  })

  it('rejects back-references before the start of the output', () => {
    expect(() => decompressCode(buildPxa([{ lit: 0x61 }, { copy: [5, 3] }]))).toThrow(FormatError)
  })

  it('round-trips arbitrary literal/raw-block streams (property)', () => {
    const nonZeroByte = fc.integer({ min: 1, max: 255 })
    const token = fc.oneof(
      nonZeroByte.map((b) => ({ lit: b })),
      fc.array(nonZeroByte, { minLength: 1, maxLength: 40 }).map((raw) => ({ raw })),
    )
    fc.assert(
      fc.property(fc.array(token, { minLength: 1, maxLength: 80 }), (tokens) => {
        const expected = tokens.map((t) => ('lit' in t ? String.fromCharCode(t.lit) : String.fromCharCode(...t.raw))).join('')
        expect(decompressCode(buildPxa(tokens)).code).toBe(expected)
      }),
    )
  })
})
