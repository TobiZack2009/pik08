import { describe, expect, it } from 'vitest'
import {
  ellipsePoints,
  flipH,
  flipV,
  floodFillPoints,
  getPixel,
  linePoints,
  readBlock,
  rectPoints,
  rotateCW,
  setPixel,
  shiftBlock,
  writeBlock,
} from '../../src/ui/editors/sprite/raster.js'

/** @param {[number, number][]} pts */
const key = (pts) =>pts.map(([x, y]) => `${x},${y}`).sort()

describe('pixel access', () => {
  it('stores the left pixel in the low nibble', () => {
    const gfx = new Uint8Array(0x2000)
    setPixel(gfx, 0, 0, 0xa)
    setPixel(gfx, 1, 0, 0x5)
    expect(gfx[0]).toBe(0x5a)
    expect(getPixel(gfx, 0, 0)).toBe(0xa)
    expect(getPixel(gfx, 1, 0)).toBe(0x5)
    setPixel(gfx, 0, 0, 3)
    expect(getPixel(gfx, 1, 0)).toBe(0x5)
  })

  it('addresses rows 64 bytes apart and ignores out of range', () => {
    const gfx = new Uint8Array(0x2000)
    setPixel(gfx, 127, 127, 15)
    expect(gfx[127 * 64 + 63]).toBe(0xf0)
    setPixel(gfx, 128, 0, 1)
    setPixel(gfx, -1, 0, 1)
    expect(gfx.filter(Boolean).length).toBe(1)
    expect(getPixel(gfx, 200, 0)).toBe(0)
  })
})

describe('shapes', () => {
  it('draws lines in every direction, both ends included', () => {
    expect(linePoints(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]])
    expect(linePoints(2, 2, 2, 2)).toEqual([[2, 2]])
    expect(linePoints(3, 3, 0, 0)).toEqual([[3, 3], [2, 2], [1, 1], [0, 0]])
    const l = linePoints(0, 0, 5, 2)
    expect(l[0]).toEqual([0, 0])
    expect(l.at(-1)).toEqual([5, 2])
    expect(l).toHaveLength(6)
  })

  it('makes rectangles from any corner order', () => {
    expect(rectPoints(3, 3, 1, 1, true)).toHaveLength(9)
    expect(rectPoints(1, 1, 3, 3, false)).toHaveLength(8)
    expect(key(rectPoints(3, 3, 1, 1, false))).toEqual(key(rectPoints(1, 1, 3, 3, false)))
    expect(rectPoints(2, 2, 2, 2, false)).toEqual([[2, 2]])
    expect(rectPoints(0, 0, 3, 0, false)).toHaveLength(4)
  })

  it('makes ellipses that fill their box symmetrically', () => {
    for (const [w, h] of [[1, 1], [3, 3], [4, 4], [8, 8], [8, 4], [3, 9], [2, 1]]) {
      const filled = ellipsePoints(0, 0, w - 1, h - 1, true)
      const set = new Set(key(filled))
      expect(set.size).toBe(filled.length)
      for (const [x, y] of filled) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThan(w)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThan(h)
        expect(set.has(`${w - 1 - x},${y}`)).toBe(true)
        expect(set.has(`${x},${h - 1 - y}`)).toBe(true)
      }
      // touches all four sides of the box
      expect(filled.some(([x]) => x === 0)).toBe(true)
      expect(filled.some(([x]) => x === w - 1)).toBe(true)
      expect(filled.some(([, y]) => y === 0)).toBe(true)
      expect(filled.some(([, y]) => y === h - 1)).toBe(true)
    }
  })

  it('outline is a subset of the filled ellipse and hollow inside', () => {
    const outline = ellipsePoints(0, 0, 10, 10, false)
    const filled = new Set(key(ellipsePoints(0, 0, 10, 10, true)))
    expect(outline.every(([x, y]) => filled.has(`${x},${y}`))).toBe(true)
    expect(outline.length).toBeLessThan(filled.size)
    expect(new Set(key(outline)).has('5,5')).toBe(false)
  })

  it('accepts corners in any order', () => {
    expect(key(ellipsePoints(6, 6, 0, 0, true))).toEqual(key(ellipsePoints(0, 0, 6, 6, true)))
  })
})

describe('floodFillPoints', () => {
  it('fills the connected area only', () => {
    // 4x3:   0 0 1 0
    //        0 0 1 0
    //        1 1 1 0
    const grid = [0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0]
    /** @param {number} x @param {number} y */
    const get = (x, y) => grid[y * 4 + x]
    expect(key(floodFillPoints(4, 3, get, 0, 0))).toEqual(['0,0', '0,1', '1,0', '1,1'])
    expect(key(floodFillPoints(4, 3, get, 3, 0))).toEqual(['3,0', '3,1', '3,2'])
    expect(floodFillPoints(4, 3, get, 2, 0)).toHaveLength(5)
    expect(floodFillPoints(4, 3, get, 9, 9)).toEqual([])
  })

  it('does not wrap around edges', () => {
    /** @param {number} x */
    const get = (x) => (x === 0 || x === 2 ? 0 : 1)
    expect(floodFillPoints(3, 1, get, 0, 0)).toHaveLength(1)
  })
})

describe('blocks', () => {
  const block = { w: 3, h: 2, data: Uint8Array.from([1, 2, 3, 4, 5, 6]) }

  it('flips', () => {
    expect([...flipH(block).data]).toEqual([3, 2, 1, 6, 5, 4])
    expect([...flipV(block).data]).toEqual([4, 5, 6, 1, 2, 3])
  })

  it('rotates clockwise', () => {
    const r = rotateCW(block)
    expect([r.w, r.h]).toEqual([2, 3])
    expect([...r.data]).toEqual([4, 1, 5, 2, 6, 3])
    /** @type {import('../../src/ui/editors/sprite/raster.js').Block} */
    let b = block
    for (let i = 0; i < 4; i++) b = rotateCW(b)
    expect(b).toEqual(block)
  })

  it('shifts with wrap-around', () => {
    expect([...shiftBlock(block, 1, 0).data]).toEqual([3, 1, 2, 6, 4, 5])
    expect([...shiftBlock(block, 0, -1).data]).toEqual([4, 5, 6, 1, 2, 3])
    expect([...shiftBlock(block, 3, 2).data]).toEqual([...block.data])
    expect([...shiftBlock(block, -4, 0).data]).toEqual([2, 3, 1, 5, 6, 4])
  })

  it('reads and writes rectangles of the sheet', () => {
    const gfx = new Uint8Array(0x2000)
    writeBlock(gfx, 5, 6, block)
    expect(readBlock(gfx, 5, 6, 3, 2)).toEqual(block)
    expect(getPixel(gfx, 7, 7)).toBe(6)
    writeBlock(gfx, 126, 127, block) // clipped at the sheet edge
    expect(getPixel(gfx, 127, 127)).toBe(2)
  })
})
