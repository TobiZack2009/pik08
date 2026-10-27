import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { encode } from 'fast-png'
import { decodeP8Png, extractBytes, parseCartBytes } from '../../src/formats/p8png.js'
import { FormatError } from '../../src/formats/errors.js'
import { CART_SIZE, CODE_START, ROM_REGIONS, ROM_SIZE } from '../../src/profiles/pico8/memory-map.js'
import { makeP8Png } from '../helpers/make-p8png.js'
import { buildPxa, bytesOf } from '../helpers/code-encoders.js'
import { readGfx, readHexRows, readLua, readSections } from '../helpers/p8-text.js'

/** @param {string} rel */
const fixture = (rel) => new Uint8Array(readFileSync(new URL(`../fixtures/${rel}`, import.meta.url)))

describe('extractBytes', () => {
  it('packs A,R,G,B low bit pairs into one byte, alpha on top', () => {
    // Pixel layout is R,G,B,A. Each pixel isolates one channel, the last has junk in the high bits.
    const rgba = Uint8Array.from([
      0, 0, 0, 3, //             a=3 -> 0xC0
      3, 0, 0, 0, //             r=3 -> 0x30
      0, 3, 0, 0, //             g=3 -> 0x0C
      0, 0, 3, 0, //             b=3 -> 0x03
      0xfd, 0xfe, 0xff, 0xfc, // r=1 g=2 b=3 a=0 -> 0x1B
    ])
    expect([...extractBytes(rgba, 5)]).toEqual([0xc0, 0x30, 0x0c, 0x03, 0x1b])
  })
})

describe('parseCartBytes', () => {
  it('rejects data that is shorter than a full cart', () => {
    expect(() => parseCartBytes(new Uint8Array(100))).toThrow(FormatError)
  })
})

describe('decodeP8Png with synthetic carts', () => {
  /** @param {Uint8Array} codeRegion */
  const cartBytes = (codeRegion, version = 41) => {
    const bytes = new Uint8Array(CART_SIZE)
    for (let i = 0; i < ROM_SIZE; i++) bytes[i] = (i * 7 + (i >> 8)) & 0xff
    bytes.set(codeRegion, CODE_START)
    bytes[0x8000] = version
    for (let i = 1; i < 0x20; i++) bytes[0x8000 + i] = 0xa0 + i
    return bytes
  }

  it('round-trips ROM, version, trailer and raw code through a real PNG', () => {
    const bytes = cartBytes(Uint8Array.from([...bytesOf('print("hi")'), 0]))
    const cart = decodeP8Png(makeP8Png(bytes))

    expect(cart.rom).toEqual(bytes.subarray(0, ROM_SIZE))
    expect(cart.code).toBe('print("hi")')
    expect(cart.codeFormat).toBe('raw')
    expect(cart.version).toBe(41)
    expect(cart.trailer).toEqual(bytes.subarray(0x8000, 0x8020))
  })

  it('decodes pxa code stored in the image', () => {
    const bytes = cartBytes(buildPxa([{ raw: [...bytesOf('x=1\nprint(x)')] }]))
    const cart = decodeP8Png(makeP8Png(bytes))
    expect(cart.codeFormat).toBe('pxa')
    expect(cart.code).toBe('x=1\nprint(x)')
  })

  it('does not lose data when alpha is close to opaque (premultiplied-alpha regression)', () => {
    // Every pixel here has alpha in 252..255 and arbitrary colour high bits, like real carts.
    const bytes = new Uint8Array(CART_SIZE)
    for (let i = 0; i < CART_SIZE; i++) bytes[i] = (i * 31 + 17) & 0xff
    bytes.set([0, 0, 0, 0], CODE_START) // keep the code region decodable as (empty) raw
    const cart = decodeP8Png(makeP8Png(bytes))
    expect(cart.rom).toEqual(bytes.subarray(0, ROM_SIZE))
    expect(cart.trailer).toEqual(bytes.subarray(0x8000, 0x8020))
  })
})

describe('decodeP8Png errors', () => {
  it('rejects bytes that are not a PNG', () => {
    expect(() => decodeP8Png(bytesOf('definitely not a png'))).toThrow(FormatError)
  })

  it('rejects images of the wrong size', () => {
    const small = encode({ width: 16, height: 16, data: new Uint8Array(16 * 16 * 4), depth: 8, channels: 4 })
    expect(() => decodeP8Png(small)).toThrow(/size/)
  })

  it('rejects images that are not 8-bit RGBA', () => {
    const rgb = encode({ width: 160, height: 205, data: new Uint8Array(160 * 205 * 3), depth: 8, channels: 3 })
    expect(() => decodeP8Png(rgb)).toThrow(/RGBA/)
  })
})

describe('decodeP8Png with real carts', () => {
  // Carts from picotool (MIT) that come with a matching .p8 text file as ground truth.
  describe.each(['empty', 'test_cart', 'test_gol'])('picotool/%s', (name) => {
    const cart = decodeP8Png(fixture(`picotool/${name}.p8.png`))
    const text = readFileSync(new URL(`../fixtures/picotool/${name}.p8`, import.meta.url), 'latin1')
    const sections = readSections(text)

    it('decodes the same code as the .p8 text', () => {
      expect(cart.code).toBe(readLua(text))
    })

    it('has gfx bytes matching the .p8 text', () => {
      const gfx = readGfx(sections.get('gfx') ?? [])
      const [start] = ROM_REGIONS.gfx
      expect(cart.rom.subarray(start, start + gfx.length)).toEqual(gfx)
    })

    it('has map and flag bytes matching the .p8 text', () => {
      const map = readHexRows(sections.get('map') ?? [])
      const flags = readHexRows(sections.get('gff') ?? [])
      expect(cart.rom.subarray(ROM_REGIONS.map[0], ROM_REGIONS.map[0] + map.length)).toEqual(map)
      expect(cart.rom.subarray(ROM_REGIONS.flags[0], ROM_REGIONS.flags[0] + flags.length)).toEqual(flags)
    })
  })

  it('picotool/test_gol uses the legacy :c: format', () => {
    expect(decodeP8Png(fixture('picotool/test_gol.p8.png')).codeFormat).toBe('legacy')
  })

  it('picotool/onechar has a single-character program', () => {
    const cart = decodeP8Png(fixture('picotool/onechar.p8.png'))
    expect(cart.code).toBe('a')
  })

  it('picotool/memorymap decodes (legacy format)', () => {
    const cart = decodeP8Png(fixture('picotool/memorymap.p8.png'))
    expect(cart.codeFormat).toBe('legacy')
    expect(cart.code.startsWith('cls()\n')).toBe(true)
  })

  it('shrinko8/genend uses the pxa format', () => {
    const cart = decodeP8Png(fixture('shrinko8/genend.p8.png'))
    expect(cart.codeFormat).toBe('pxa')
    expect(cart.code.length).toBe(4290)
    expect(cart.code.startsWith("local hello = 'world'\nfunction something()")).toBe(true)
    expect(cart.code).not.toContain('\0')
  })

  it('shrinko8/title decodes with raw (uncompressed) code', () => {
    const cart = decodeP8Png(fixture('shrinko8/title.p8.png'))
    expect(cart.codeFormat).toBe('raw')
    expect(cart.code.length).toBe(123)
  })
})
