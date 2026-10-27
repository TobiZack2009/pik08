import { describe, expect, it } from 'vitest'
import { createCart } from '../../src/core/cart.js'
import { parseP8, serializeP8 } from '../../src/formats/p8.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  getTile,
  isSharedRow,
  readTiles,
  regionsTouched,
  setTile,
  writeTiles,
} from '../../src/ui/editors/map/map-data.js'
import { readPattern, writePattern } from '../../src/ui/editors/music/music-data.js'
import {
  clearSfx,
  isSilent,
  noteName,
  readHeader,
  readNote,
  writeHeader,
  writeNote,
} from '../../src/ui/editors/sfx/sfx-data.js'

/** @param {import('../../src/core/cart.js').Cart} cart */
const regions = (cart) => ({
  map: cart.rom.subarray(...pico8Profile.memory.regions.map),
  gfx: cart.rom.subarray(...pico8Profile.memory.regions.gfx),
  sfx: cart.rom.subarray(...pico8Profile.memory.regions.sfx),
  music: cart.rom.subarray(...pico8Profile.memory.regions.music),
})

describe('map-data', () => {
  it('keeps the upper rows in the map and the lower ones in the sprite sheet', () => {
    const cart = createCart(pico8Profile)
    const { map, gfx } = regions(cart)
    setTile(map, gfx, 3, 2, 17)
    expect(map[2 * 128 + 3]).toBe(17)
    setTile(map, gfx, 4, 32, 99)
    expect(gfx[0x1000 + 4]).toBe(99)
    setTile(map, gfx, 127, 63, 5)
    expect(gfx[0x1fff]).toBe(5)
    expect(getTile(map, gfx, 4, 32)).toBe(99)
    expect(getTile(map, gfx, 127, 63)).toBe(5)
  })

  it('ignores positions outside the map', () => {
    const cart = createCart(pico8Profile)
    const { map, gfx } = regions(cart)
    setTile(map, gfx, -1, 0, 1)
    setTile(map, gfx, 0, MAP_HEIGHT, 1)
    setTile(map, gfx, MAP_WIDTH, 0, 1)
    expect(cart.rom.slice(0, 0x3000).every((b) => b === 0)).toBe(true)
    expect(getTile(map, gfx, -5, 3)).toBe(0)
  })

  it('reads and writes tile blocks', () => {
    const cart = createCart(pico8Profile)
    const { map, gfx } = regions(cart)
    writeTiles(map, gfx, 10, 31, { w: 2, h: 2, tiles: Uint8Array.from([1, 2, 3, 4]) })
    expect(readTiles(map, gfx, 10, 31, 2, 2).tiles).toEqual(Uint8Array.from([1, 2, 3, 4]))
    expect(getTile(map, gfx, 11, 32)).toBe(4)
  })

  it('knows which regions an edit touches', () => {
    expect(regionsTouched([[0, 0], [1, 5]])).toEqual(['map'])
    expect(regionsTouched([[0, 40]])).toEqual(['gfx'])
    expect(regionsTouched([[0, 31], [0, 32]])).toEqual(['map', 'gfx'])
    expect(isSharedRow(31)).toBe(false)
    expect(isSharedRow(32)).toBe(true)
  })

  it('matches how .p8 files lay out the lower map half', () => {
    // the second half of __gfx__ holds map rows 32..63 when a cart is saved by PICO-8
    const cart = createCart(pico8Profile)
    const { map, gfx } = regions(cart)
    setTile(map, gfx, 0, 32, 0xab)
    const text = serializeP8(cart)
    const back = parseP8(text)
    const r = regions(back)
    expect(getTile(r.map, r.gfx, 0, 32)).toBe(0xab)
    expect(text).toContain('__gfx__')
  })
})

describe('sfx-data', () => {
  it('round-trips notes including custom instruments', () => {
    const cart = createCart(pico8Profile)
    const { sfx } = regions(cart)
    for (const wave of [0, 3, 5, 7, 8, 12, 15]) {
      const note = { pitch: 37, wave, vol: 5, fx: 3 }
      writeNote(sfx, 7, 31, note)
      expect(readNote(sfx, 7, 31)).toEqual(note)
    }
  })

  it('agrees with the .p8 text format', () => {
    const cart = createCart(pico8Profile)
    const { sfx } = regions(cart)
    writeNote(sfx, 2, 0, { pitch: 0x2a, wave: 0xb, vol: 6, fx: 4 })
    writeHeader(sfx, 2, { speed: 12, loopStart: 4, loopEnd: 20 })
    const lines = serializeP8(cart).split('\n')
    const row = lines[lines.indexOf('__sfx__') + 1 + 2]
    expect(row.slice(8, 13)).toBe('2ab64')
    expect(row.slice(0, 8)).toBe('000c0414')
    const back = parseP8(serializeP8(cart))
    expect(readNote(regions(back).sfx, 2, 0)).toEqual({ pitch: 0x2a, wave: 0xb, vol: 6, fx: 4 })
  })

  it('reads and writes the header and clears', () => {
    const cart = createCart(pico8Profile)
    const { sfx } = regions(cart)
    expect(readHeader(sfx, 0).speed).toBe(1)
    expect(readHeader(sfx, 1).speed).toBe(16)
    writeHeader(sfx, 1, { loopEnd: 9 })
    expect(readHeader(sfx, 1)).toEqual({ mode: 0, speed: 16, loopStart: 0, loopEnd: 9 })
    writeNote(sfx, 1, 3, { pitch: 5, wave: 1, vol: 2, fx: 0 })
    expect(isSilent(sfx, 1)).toBe(false)
    clearSfx(sfx, 1)
    expect(isSilent(sfx, 1)).toBe(true)
    expect(readHeader(sfx, 1)).toEqual({ mode: 0, speed: 16, loopStart: 0, loopEnd: 0 })
  })

  it('names pitches', () => {
    expect(noteName(0)).toBe('C-0')
    expect(noteName(13)).toBe('C#1')
    expect(noteName(63)).toBe('D#5')
  })
})

describe('music-data', () => {
  it('decodes the default pattern as all channels off', () => {
    const cart = createCart(pico8Profile)
    const p = readPattern(regions(cart).music, 5)
    expect(p.channels.map((c) => c.enabled)).toEqual([false, false, false, false])
    expect(p.loopStart || p.loopBack || p.stop).toBe(false)
  })

  it('round-trips and agrees with .p8 flags', () => {
    const cart = createCart(pico8Profile)
    const { music } = regions(cart)
    const pattern = {
      channels: [
        { sfx: 3, enabled: true },
        { sfx: 63, enabled: true },
        { sfx: 7, enabled: false },
        { sfx: 0, enabled: true },
      ],
      loopStart: true,
      loopBack: false,
      stop: true,
    }
    writePattern(music, 0, pattern)
    expect(readPattern(music, 0)).toEqual(pattern)
    const back = parseP8(serializeP8(cart))
    expect(readPattern(regions(back).music, 0)).toEqual(pattern)
    const lines = serializeP8(cart).split('\n')
    expect(lines[lines.indexOf('__music__') + 1]).toMatch(/^05 /)
  })
})
