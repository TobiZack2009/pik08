import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { decode } from 'fast-png'
import { buildCartBytes, decodeP8Png, extractBytes, readP8Png, writeP8Png } from '../../src/formats/p8png.js'
import { parseP8 } from '../../src/formats/p8.js'
import { sha1 } from '../../src/formats/sha1.js'
import { ExportLimitError } from '../../src/formats/errors.js'
import { createCart } from '../../src/core/cart.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { CART_SIZE, CART_TRAILER_START, CODE_REGION_SIZE, CODE_START, ROM_SIZE } from '../../src/profiles/pico8/memory-map.js'

const fixture = (/** @type {string} */ name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url))
const parseFixture = (/** @type {string} */ name) => parseP8(fixture(name).toString('utf8'))

/** Code that cannot be compressed and has no NUL, so it is stored as is. */
function plainCode(/** @type {number} */ n) {
  let x = 99
  let s = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    s += String.fromCharCode(1 + ((x >>> 0) % 255))
  }
  return s
}

describe('the cart trailer hash', () => {
  for (const name of ['shrinko8/genend', 'shrinko8/title']) {
    it(`our SHA-1 reproduces the one PICO-8 stored in ${name}`, () => {
      const image = decode(fixture(`${name}.p8.png`))
      const bytes = extractBytes(image.data, image.width * image.height)
      const stored = bytes.subarray(CART_TRAILER_START + 6, CART_TRAILER_START + 26)
      expect(sha1(bytes.subarray(0, CART_TRAILER_START))).toEqual(stored)
    })
  }
})

describe('decodeP8Png label', () => {
  it('returns the picture of a cart that has one', () => {
    const { label } = decodeP8Png(fixture('shrinko8/title.p8.png'))
    expect(label).toHaveLength(128 * 128)
    expect(new Set(label)).toEqual(new Set([0, 8, 7, 13])) // black, red, white, indigo
  })

  it('returns null for a real cart whose label was never set (grey placeholder)', () => {
    expect(decodeP8Png(fixture('shrinko8/genend.p8.png')).label).toBeNull()
  })

  it('returns null for a cart with a blank label area', () => {
    const png = writeP8Png(createCart(pico8Profile))
    expect(decodeP8Png(png).label).toBeNull()
  })
})

describe('buildCartBytes', () => {
  it('lays out rom, code and trailer, with a hash of everything before the trailer', () => {
    const cart = parseFixture('picotool/test_gol.p8')
    const bytes = buildCartBytes(cart)
    expect(bytes).toHaveLength(CART_SIZE)
    expect(bytes.subarray(0, ROM_SIZE)).toEqual(cart.rom)
    expect([...bytes.subarray(CART_TRAILER_START + 1, CART_TRAILER_START + 6)]).toEqual([0, 2, 5, 0x77, 6])
    expect(bytes.subarray(CART_TRAILER_START + 6, CART_TRAILER_START + 26)).toEqual(sha1(bytes.subarray(0, CART_TRAILER_START)))
    expect(bytes.subarray(CART_TRAILER_START + 26)).toEqual(new Uint8Array(6))
  })

  it('raises the version when the code needs the pxa format', () => {
    const cart = createCart(pico8Profile)
    cart.version = 8
    cart.code = 'print("hello world")\n'.repeat(50)
    expect(buildCartBytes(cart)[CART_TRAILER_START]).toBe(16)

    cart.code = 'print(1)'
    expect(buildCartBytes(cart)[CART_TRAILER_START]).toBe(8)
  })
})

describe('writeP8Png', () => {
  it('produces a 160x205 opaque RGBA image', () => {
    const image = decode(writeP8Png(createCart(pico8Profile)))
    expect([image.width, image.height, image.depth, image.channels]).toEqual([160, 205, 8, 4])
    for (let p = 3; p < image.data.length; p += 4) expect(image.data[p]).toBeGreaterThanOrEqual(252)
  })

  it('frames the label at (16, 24) with a one pixel outline', () => {
    const cart = createCart(pico8Profile)
    cart.label = new Uint8Array(128 * 128).fill(8) // red
    const image = decode(writeP8Png(cart))
    const at = (/** @type {number} */ x, /** @type {number} */ y) => {
      const p = (y * 160 + x) * 4
      // drop the two bits that carry data
      return [image.data[p] >> 2, image.data[p + 1] >> 2, image.data[p + 2] >> 2]
    }
    const red = [0xff >> 2, 0x00, 0x4d >> 2]
    expect(at(16, 24)).toEqual(red)
    expect(at(143, 151)).toEqual(red)
    expect(at(15, 24)).toEqual([0, 1, 2]) // outline #000408
    expect(at(144, 151)).toEqual([0, 1, 2])
    expect(at(16, 23)).toEqual([0, 1, 2])
    expect(at(16, 152)).toEqual([0, 1, 2])
    expect(at(0, 0)).toEqual([0x64 >> 2, 0x64 >> 2, 0x64 >> 2]) // body
  })

  it('round-trips real cartridges through p8 -> png -> cart', () => {
    for (const name of ['empty', 'test_cart', 'test_gol', 'test_cart_memdump']) {
      const cart = parseFixture(`picotool/${name}.p8`)
      const back = readP8Png(writeP8Png(cart))
      // old carts are bumped to a version that may hold pxa code if that is how the code got stored
      expect(back.version).toBeGreaterThanOrEqual(cart.version)
      expect({ ...back, version: cart.version }).toEqual(cart)
    }
  })

  it('round-trips a label', () => {
    const cart = parseFixture('picotool/test_cart_with_label.p8')
    expect(cart.label).not.toBeNull()
    expect(readP8Png(writeP8Png(cart)).label).toEqual(cart.label)
  })

  it('round-trips code that needs the compressor', () => {
    const png = fixture('shrinko8/genend.p8.png')
    const original = readP8Png(png)
    const again = readP8Png(writeP8Png(original))
    expect(again.code).toBe(original.code)
    expect(again.rom).toEqual(original.rom)
    expect(again.label).toEqual(original.label)
    expect(again.version).toBe(original.version)
  })

  it('round-trips arbitrary rom, label and code (property)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: ROM_SIZE, maxLength: ROM_SIZE }),
        // every palette index appears, whatever the data bits do to the colours
        fc.integer({ min: 0, max: 31 }),
        fc.array(fc.integer({ min: 0, max: 255 }), { maxLength: 300 }),
        (rom, shift, codeBytes) => {
          const cart = createCart(pico8Profile)
          cart.rom.set(rom)
          cart.label = Uint8Array.from({ length: 128 * 128 }, (_, i) => (i + shift) % 32)
          cart.code = String.fromCharCode(...codeBytes)
          const back = readP8Png(writeP8Png(cart))
          expect(back.rom).toEqual(cart.rom)
          expect(back.label).toEqual(cart.label)
          expect(back.code).toBe(cart.code)
        },
      ),
      { numRuns: 15 },
    )
  })

  it('accepts code that exactly fills the code region', () => {
    const cart = createCart(pico8Profile)
    cart.code = plainCode(CODE_REGION_SIZE)
    expect(readP8Png(writeP8Png(cart)).code).toBe(cart.code)
  })

  it('refuses code that does not fit, with the numbers', () => {
    const cart = createCart(pico8Profile)
    cart.code = plainCode(CODE_REGION_SIZE + 1)
    expect(() => writeP8Png(cart)).toThrow(ExportLimitError)
    expect(() => writeP8Png(cart)).toThrow(/compressedBytes/)
    try {
      writeP8Png(cart)
    } catch (e) {
      expect(e).toMatchObject({ limit: 'compressedBytes', actual: CODE_REGION_SIZE + 1, max: CODE_REGION_SIZE })
    }
  })

  it('refuses code with too many characters', () => {
    const cart = createCart(pico8Profile)
    cart.code = 'a'.repeat(65536)
    expect(() => writeP8Png(cart)).toThrow(/codeChars/)
  })

  it('rejects a label of the wrong size', () => {
    const cart = createCart(pico8Profile)
    cart.label = new Uint8Array(10)
    expect(() => writeP8Png(cart)).toThrow(RangeError)
  })

  it('puts the code where the decoder looks for it', () => {
    const cart = createCart(pico8Profile)
    cart.code = 'print(1)'
    const bytes = buildCartBytes(cart)
    expect(String.fromCharCode(...bytes.subarray(CODE_START, CODE_START + 8))).toBe('print(1)')
  })
})
