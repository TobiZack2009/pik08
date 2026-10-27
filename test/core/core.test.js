import { describe, expect, it } from 'vitest'
import { getProfile, listProfiles, registerProfile } from '../../src/core/profile.js'
import { Memory } from '../../src/core/memory.js'
import { cloneCart, createCart } from '../../src/core/cart.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { registerBuiltinProfiles } from '../../src/profiles/index.js'
import { MEMORY_REGIONS, MEMORY_SIZE, ROM_REGIONS, ROM_SIZE } from '../../src/profiles/pico8/memory-map.js'

describe('profile registry', () => {
  it('registers builtin profiles and looks them up by id', () => {
    registerBuiltinProfiles()
    expect(getProfile('pico8')).toBe(pico8Profile)
    expect(listProfiles().map((p) => p.id)).toContain('pico8')
  })

  it('rejects duplicate ids and unknown lookups', () => {
    expect(() => registerProfile(pico8Profile)).toThrow(/already registered/)
    expect(() => getProfile('nope')).toThrow(/unknown profile/)
  })
})

describe('pico8 profile', () => {
  it('has a 32-colour palette with the standard first 16', () => {
    expect(pico8Profile.display.palette).toHaveLength(32)
    expect(pico8Profile.display.palette[0]).toBe(0x000000)
    expect(pico8Profile.display.palette[7]).toBe(0xfff1e8)
    expect(pico8Profile.display.palette[12]).toBe(0x29adff)
  })

  it('has ROM regions that tile [0, romSize) without gaps or overlap', () => {
    const regions = Object.values(ROM_REGIONS).sort((a, b) => a[0] - b[0])
    let cursor = 0
    for (const [start, end] of regions) {
      expect(start).toBe(cursor)
      cursor = end
    }
    expect(cursor).toBe(ROM_SIZE)
  })

  it('has memory regions that tile the whole address space', () => {
    const regions = Object.values(MEMORY_REGIONS).sort((a, b) => a[0] - b[0])
    let cursor = 0
    for (const [start, end] of regions) {
      expect(start).toBe(cursor)
      cursor = end
    }
    expect(cursor).toBe(MEMORY_SIZE)
  })
})

describe('Memory', () => {
  it('region() returns a live view of the right size', () => {
    const mem = new Memory(pico8Profile.memory)
    const screen = mem.region('screen')
    expect(screen).toHaveLength(0x2000)
    screen[0] = 0x42
    expect(mem.peek(0x6000)).toBe(0x42)
    mem.poke(0x6001, 7)
    expect(screen[1]).toBe(7)
  })

  it('rejects unknown regions and out-of-range addresses', () => {
    const mem = new Memory(pico8Profile.memory)
    expect(() => mem.region('nope')).toThrow(/unknown memory region/)
    expect(() => mem.peek(-1)).toThrow(RangeError)
    expect(() => mem.peek(0x8000)).toThrow(RangeError)
    expect(() => mem.poke(1.5, 0)).toThrow(RangeError)
  })

  it('loads a cart rom into the start of memory and reads it back', () => {
    const cart = createCart(pico8Profile)
    cart.rom[0] = 1
    cart.rom[ROM_SIZE - 1] = 9
    const mem = new Memory(pico8Profile.memory)
    mem.loadCart(cart)
    expect(mem.peek(0)).toBe(1)
    expect(mem.peek(ROM_SIZE - 1)).toBe(9)
    expect(mem.peek(ROM_SIZE)).toBe(0)
    expect(mem.readRom()).toEqual(cart.rom)
  })

  it('rejects a rom of the wrong size', () => {
    const mem = new Memory(pico8Profile.memory)
    expect(() => mem.loadCart({ rom: new Uint8Array(10) })).toThrow(RangeError)
  })

  it('clone() is independent of the original', () => {
    const mem = new Memory(pico8Profile.memory)
    mem.poke(5, 5)
    const copy = mem.clone()
    copy.poke(5, 99)
    expect(mem.peek(5)).toBe(5)
    expect(copy.peek(5)).toBe(99)
  })
})

describe('Cart', () => {
  it('createCart makes an empty cart for the profile', () => {
    const cart = createCart(pico8Profile)
    expect(cart).toMatchObject({ profileId: 'pico8', version: 41, code: '', label: null, extra: {} })
    expect(cart.rom).toHaveLength(ROM_SIZE)
  })

  it('cloneCart deep-copies every mutable part', () => {
    const cart = createCart(pico8Profile)
    cart.label = new Uint8Array(4)
    cart.extra = { foo: ['a', 'b'] }
    const copy = cloneCart(cart)
    expect(copy).toEqual(cart)

    copy.rom[0] = 1
    copy.label?.fill(3)
    copy.extra.foo.push('c')
    expect(cart.rom[0]).toBe(0)
    expect(cart.label).toEqual(new Uint8Array(4))
    expect(cart.extra.foo).toEqual(['a', 'b'])
  })
})
