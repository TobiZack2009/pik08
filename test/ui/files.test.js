import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCart } from '../../src/core/cart.js'
import { ExportLimitError } from '../../src/formats/errors.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import {
  baseName,
  checkLimits,
  decodeCart,
  describeLimitError,
  detectFormat,
  encodeP8,
  encodeP8Png,
} from '../../src/ui/files.js'

const fixture = (/** @type {string} */ name) => new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))

describe('files', () => {
  it('detects the format from the bytes', () => {
    expect(detectFormat(fixture('picotool/test_cart.p8.png'))).toBe('p8png')
    expect(detectFormat(fixture('picotool/test_cart.p8'))).toBe('p8')
    expect(detectFormat(new Uint8Array(0))).toBe('p8')
  })

  it('strips cart extensions', () => {
    expect(baseName('game.p8.png')).toBe('game')
    expect(baseName('Game.P8')).toBe('Game')
    expect(baseName('a.b.p8')).toBe('a.b')
    expect(baseName('plain')).toBe('plain')
  })

  it('decodes both formats to the same cart contents', () => {
    const fromText = decodeCart(fixture('picotool/test_cart.p8'), pico8Profile)
    const fromPng = decodeCart(fixture('picotool/test_cart.p8.png'), pico8Profile)
    expect(fromText.code.length).toBeGreaterThan(0)
    expect(fromPng.code).toBe(fromText.code)
    expect(fromPng.rom).toEqual(fromText.rom)
  })

  it('round-trips through .p8 and .p8.png', () => {
    const cart = createCart(pico8Profile)
    cart.code = 'x=1\nprint(x)'
    cart.rom[5] = 77
    const viaP8 = decodeCart(encodeP8(cart, pico8Profile), pico8Profile)
    expect(viaP8.code).toBe(cart.code)
    expect(viaP8.rom[5]).toBe(77)
    const viaPng = decodeCart(encodeP8Png(cart, pico8Profile), pico8Profile)
    expect(viaPng.code).toBe(cart.code)
    expect(viaPng.rom[5]).toBe(77)
  })

  it('blocks png export over the token limit but not .p8', () => {
    const cart = createCart(pico8Profile)
    cart.code = 'x=1\n'.repeat(3000) // 9000 tokens
    expect(() => checkLimits(cart, pico8Profile)).toThrow(ExportLimitError)
    expect(() => encodeP8Png(cart, pico8Profile)).toThrow(ExportLimitError)
    expect(() => encodeP8(cart, pico8Profile)).not.toThrow()
  })

  it('lets a cart within the limits through', () => {
    const cart = createCart(pico8Profile)
    cart.code = 'x=1\n'.repeat(100)
    expect(() => checkLimits(cart, pico8Profile)).not.toThrow()
  })

  it('describes limit errors for the dialog', () => {
    const { title, message } = describeLimitError(new ExportLimitError('tokens', 9000, 8192))
    expect(title).toMatch(/too big/)
    expect(message).toContain('9000 tokens')
    expect(message).toContain('8192')
    expect(message).toContain('808 over')
    expect(describeLimitError(new ExportLimitError('compressedBytes', 20000, 15616)).message).toContain('compressed')
  })
})
