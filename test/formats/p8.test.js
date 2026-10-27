import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { parseP8, serializeP8 } from '../../src/formats/p8.js'
import { decodeP8Png } from '../../src/formats/p8png.js'
import { FormatError } from '../../src/formats/errors.js'
import { createCart } from '../../src/core/cart.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { MEMORY_REGIONS, ROM_SIZE } from '../../src/profiles/pico8/memory-map.js'

const fixture = (/** @type {string} */ name) => new URL(`../fixtures/${name}`, import.meta.url)
const text = (/** @type {string} */ name) => readFileSync(fixture(name), 'utf8')
const png = (/** @type {string} */ name) => decodeP8Png(readFileSync(fixture(name)))

const HEADER = 'pico-8 cartridge // http://www.pico-8.com\nversion 41\n'

describe('parseP8 against the .p8.png of the same cartridge', () => {
  for (const name of ['empty', 'test_cart', 'test_gol', 'test_cart_memdump']) {
    it(`${name}: rom and code match`, () => {
      const fromText = parseP8(text(`picotool/${name}.p8`))
      const fromPng = png(`picotool/${name}.p8.png`)
      expect(fromText.rom).toEqual(fromPng.rom)
      // test_cart_memdump.p8 is a version-5 file, saved before PICO-8 added the blank separator
      // line after the code, so only trailing newlines differ for it.
      if (name === 'test_cart_memdump') expect(fromText.code.trimEnd()).toBe(fromPng.code.trimEnd())
      else expect(fromText.code).toBe(fromPng.code)
    })
  }

  it('test_cart_memdump really exercises sfx and music', () => {
    const cart = parseP8(text('picotool/test_cart_memdump.p8'))
    const [sfxStart, sfxEnd] = MEMORY_REGIONS.sfx
    const [musicStart, musicEnd] = MEMORY_REGIONS.music
    expect(cart.rom.subarray(sfxStart, sfxEnd).some((b) => b !== 0)).toBe(true)
    expect(cart.rom.subarray(musicStart, musicEnd).some((b) => b !== 0)).toBe(true)
  })
})

describe('defaults of a new cart', () => {
  it('createCart matches what PICO-8 itself wrote for an empty cart', () => {
    expect(parseP8(text('picotool/empty.p8')).rom).toEqual(createCart(pico8Profile).rom)
  })

  it('default music patterns disable all four channels and default sfx have a speed', () => {
    const { rom } = createCart(pico8Profile)
    expect([...rom.subarray(...MEMORY_REGIONS.music).subarray(0, 8)]).toEqual([0x41, 0x42, 0x43, 0x44, 0x41, 0x42, 0x43, 0x44])
    const sfx = rom.subarray(...MEMORY_REGIONS.sfx)
    expect([sfx[65], sfx[68 + 65], sfx[63 * 68 + 65]]).toEqual([1, 16, 16])
  })

  it('absent sections and rows read as the defaults, not zeros', () => {
    expect(parseP8(`${HEADER}__lua__\n`).rom).toEqual(createCart(pico8Profile).rom)
    const rom = parseP8(`${HEADER}__lua__\n__music__\n01 00000000\n`).rom
    const music = rom.subarray(...MEMORY_REGIONS.music)
    expect([...music.subarray(0, 4)]).toEqual([0x80, 0, 0, 0]) // the row given
    expect([...music.subarray(4, 8)]).toEqual([0x41, 0x42, 0x43, 0x44]) // the next one, default
  })

  it('does not write rows that are at their default, but writes zeros where they differ', () => {
    const cart = createCart(pico8Profile)
    expect(serializeP8(cart)).not.toContain('__sfx__')
    cart.rom[MEMORY_REGIONS.music[0] + 1] = 0 // pattern 0, channel 1: now differs from the default
    expect(serializeP8(cart)).toContain('__music__\n00 41004344\n')
    expect(parseP8(serializeP8(cart)).rom).toEqual(cart.rom)
  })
})

describe('parseP8', () => {
  it('reads the version', () => {
    expect(parseP8('pico-8 cartridge // x\nversion 16\n__lua__\n').version).toBe(16)
  })

  it('reads a label section', () => {
    const cart = parseP8(text('picotool/test_cart_with_label.p8'))
    expect(cart.label).toHaveLength(128 * 128)
    expect(cart.label?.some((c) => c !== 0)).toBe(true)
    expect(Math.max(...(cart.label ?? []))).toBeLessThan(32)
  })

  it('has no label when there is no label section', () => {
    expect(parseP8(text('picotool/test_cart.p8')).label).toBeNull()
  })

  it('decodes a hand-computed sfx note', () => {
    // header 00 00 00 00, then note "00472": pitch 0x00, wave 4 (custom bit 2), volume 7, effect 2
    // word = pitch | wave<<6 | vol<<9 | fx<<12 = 0 | 0x100 (wave bit 2 -> bit 8) | 0xe00 | 0x2000
    const cart = parseP8(`${HEADER}__sfx__\n00000000${'00472'}\n`)
    const sfx = cart.rom.subarray(...MEMORY_REGIONS.sfx)
    expect(sfx[0]).toBe(0x00)
    expect(sfx[1]).toBe(0x2f)
  })

  it('decodes the sfx header bytes into the end of each 68-byte sfx', () => {
    const cart = parseP8(`${HEADER}__sfx__\n01020304\n`)
    expect([...cart.rom.subarray(...MEMORY_REGIONS.sfx).subarray(64, 68)]).toEqual([1, 2, 3, 4])
  })

  it('decodes a music row: flag bits go to bit 7 of each channel byte', () => {
    const cart = parseP8(`${HEADER}__music__\n05 00044208\n`)
    expect([...cart.rom.subarray(...MEMORY_REGIONS.music).subarray(0, 4)]).toEqual([0x80, 0x04, 0xc2, 0x08])
  })

  it('treats missing rows and short rows as zeros', () => {
    const cart = parseP8(`${HEADER}__gfx__\n1\n__map__\nff\n`)
    expect(cart.rom[0]).toBe(1)
    expect(cart.rom[1]).toBe(0)
    expect(cart.rom[MEMORY_REGIONS.map[0]]).toBe(0xff)
  })

  it('puts the left gfx pixel in the low nibble', () => {
    expect(parseP8(`${HEADER}__gfx__\n12\n`).rom[0]).toBe(0x21)
  })

  it('accepts CRLF line endings', () => {
    const lf = parseP8(text('picotool/test_cart.p8'))
    const crlf = parseP8(text('picotool/test_cart.p8').replace(/\n/g, '\r\n'))
    expect(crlf).toEqual(lf)
  })

  it('keeps unknown sections verbatim', () => {
    const cart = parseP8(`${HEADER}__lua__\nx=1\n__meta:foo__\nhello\nworld\n`)
    expect(cart.extra['meta:foo']).toEqual(['hello', 'world'])
    expect(cart.code).toBe('x=1')
    expect(serializeP8(cart)).toContain('__meta:foo__\nhello\nworld\n')
  })

  it('converts the code from Unicode to a p8str', () => {
    expect(parseP8(`${HEADER}__lua__\nif btn(\u2b05\ufe0f) then end\n`).code).toBe('if btn(\x8b) then end')
  })

  it('rejects non-cartridges and bad digits', () => {
    expect(() => parseP8('hello')).toThrow(FormatError)
    expect(() => parseP8('')).toThrow(FormatError)
    expect(() => parseP8(`${HEADER}__gfx__\nzz\n`)).toThrow(/line 4/)
    expect(() => parseP8(`${HEADER}__music__\nnonsense\n`)).toThrow(FormatError)
    expect(() => parseP8(`${HEADER}__label__\n!\n`)).toThrow(FormatError)
  })
})

describe('serializeP8', () => {
  it('writes an empty cart minimally', () => {
    expect(serializeP8(createCart(pico8Profile))).toBe(`${HEADER}__lua__\n`)
  })

  it('omits blank trailing rows', () => {
    const cart = createCart(pico8Profile)
    cart.rom[0] = 0x21
    const out = serializeP8(cart)
    expect(out).toContain('__gfx__\n12' + '0'.repeat(126) + '\n')
    expect(out).not.toContain('__map__')
    expect(out).not.toContain('__sfx__')
    expect(out).not.toContain('__music__')
  })

  it('writes the p8scii code as Unicode', () => {
    const cart = createCart(pico8Profile)
    cart.code = 'btn(\x8b)'
    expect(serializeP8(cart)).toContain('btn(\u2b05\ufe0f)')
  })

  it('rejects label colours out of range', () => {
    const cart = createCart(pico8Profile)
    cart.label = new Uint8Array(128 * 128)
    cart.label[3] = 32
    expect(() => serializeP8(cart)).toThrow(RangeError)
  })
})

describe('round trips', () => {
  for (const name of ['empty', 'test_cart', 'test_gol', 'test_cart_memdump', 'test_cart_with_label']) {
    it(`${name}: parse -> serialize -> parse is stable`, () => {
      const first = parseP8(text(`picotool/${name}.p8`))
      const second = parseP8(serializeP8(first))
      expect(second).toEqual(first)
    })
  }

  it('is lossless for arbitrary rom bytes, code and label (property)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: ROM_SIZE, maxLength: ROM_SIZE }),
        // no CR (line-ending normalisation) and no section-marker lookalikes
        fc.array(fc.integer({ min: 0, max: 255 }).filter((b) => b !== 13 && b !== 95), { maxLength: 200 }),
        fc.option(fc.uint8Array({ minLength: 128 * 128, maxLength: 128 * 128 }).map((a) => a.map((v) => v & 31)), {
          nil: null,
        }),
        (rom, codeBytes, label) => {
          const cart = createCart(pico8Profile)
          cart.rom.set(rom)
          cart.code = String.fromCharCode(...codeBytes)
          cart.label = label
          expect(parseP8(serializeP8(cart))).toEqual(cart)
        },
      ),
      { numRuns: 25 },
    )
  })
})
