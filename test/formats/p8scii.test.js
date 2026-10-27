import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { p8sciiToUnicode, unicodeToP8scii } from '../../src/formats/p8scii.js'
import { P8SCII_TABLE } from '../../src/formats/p8scii-table.js'

describe('P8SCII table', () => {
  it('has 256 distinct entries, so the reverse mapping is unambiguous', () => {
    expect(P8SCII_TABLE).toHaveLength(256)
    expect(new Set(P8SCII_TABLE).size).toBe(256)
  })

  it('is plain ASCII for printable characters 0x20..0x7e', () => {
    for (let b = 0x20; b < 0x7f; b++) expect(P8SCII_TABLE[b]).toBe(String.fromCharCode(b))
  })

  it('keeps tab, newline and carriage return as themselves', () => {
    expect([P8SCII_TABLE[9], P8SCII_TABLE[10], P8SCII_TABLE[13]]).toEqual(['\t', '\n', '\r'])
  })
})

describe('p8sciiToUnicode / unicodeToP8scii', () => {
  it('round-trips every possible byte', () => {
    for (let b = 0; b < 256; b++) {
      const s = String.fromCharCode(b)
      expect(unicodeToP8scii(p8sciiToUnicode(s))).toBe(s)
    }
  })

  it('round-trips arbitrary p8strs (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 200 }), (bytes) => {
        const s = String.fromCharCode(...bytes)
        expect(unicodeToP8scii(p8sciiToUnicode(s))).toBe(s)
      }),
    )
  })

  it('maps the button glyphs to their well-known bytes', () => {
    expect(unicodeToP8scii('\u2b05\ufe0f')).toBe('\x8b') // left
    expect(unicodeToP8scii('\u27a1\ufe0f')).toBe('\x91') // right
    expect(unicodeToP8scii('\u2b06\ufe0f')).toBe('\x94') // up
    expect(unicodeToP8scii('\u2b07\ufe0f')).toBe('\x83') // down
    expect(unicodeToP8scii('\u{1f17e}\ufe0f')).toBe('\x8e') // O
    expect(unicodeToP8scii('\u274e')).toBe('\x97') // X
  })

  it('emits the emoji variation selector only where PICO-8 does', () => {
    expect(p8sciiToUnicode('\x8b')).toBe('\u2b05\ufe0f')
    expect(p8sciiToUnicode('\x97')).toBe('\u274e')
    expect(p8sciiToUnicode('\x87')).toBe('\u2665') // heart: no selector
  })

  it('accepts glyphs with or without the variation selector', () => {
    expect(unicodeToP8scii('\u2b05')).toBe('\x8b')
    expect(unicodeToP8scii('\u2b05\ufe0f')).toBe('\x8b')
  })

  it('leaves ASCII untouched', () => {
    expect(unicodeToP8scii('print("hi") -- ok\n')).toBe('print("hi") -- ok\n')
  })

  it('accepts italic letters as capitals (PICO-8 clipboard format)', () => {
    expect(unicodeToP8scii('\u{1d622}\u{1d623}')).toBe('AB')
  })

  it('reinterprets characters outside the charset as their UTF-8 bytes', () => {
    // "é" is U+00E9 -> UTF-8 C3 A9
    expect(unicodeToP8scii('\u00e9')).toBe('\xc3\xa9')
  })

  it('rejects strings that are not p8strs when converting to Unicode', () => {
    expect(() => p8sciiToUnicode('\u0100')).toThrow(RangeError)
  })
})
