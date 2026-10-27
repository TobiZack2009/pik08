import { describe, expect, it } from 'vitest'
import { setPixel } from '../../src/ui/editors/sprite/raster.js'
import { getTile, regionsTouched } from '../../src/ui/editors/map/map-data.js'
import {
  brushBlock,
  clampToMap,
  clearTiles,
  copyTiles,
  dragTiles,
  fillTiles,
  mapIndices,
  paintTiles,
  snapToBrush,
  stampTiles,
  tileSelection,
} from '../../src/ui/editors/map/map-ops.js'

const regions = () => ({ map: new Uint8Array(0x1000), gfx: new Uint8Array(0x2000) })

describe('brush', () => {
  it('lays the selected sprites out as tiles', () => {
    const block = brushBlock({ col: 2, row: 1, w: 2, h: 2 })
    expect([block.w, block.h]).toEqual([2, 2])
    expect(Array.from(block.tiles)).toEqual([18, 19, 34, 35])
  })

  it('turns a tile number into a one-sprite selection', () => {
    expect(tileSelection(37)).toEqual({ col: 5, row: 2, w: 1, h: 1 })
  })
})

describe('painting tiles', () => {
  it('returns only the tiles that changed and skips the ones outside the map', () => {
    const { map, gfx } = regions()
    const changed = paintTiles(map, gfx, [[0, 0], [1, 0], [-1, 0], [128, 0], [0, 64]], 5)
    expect(changed).toEqual([[0, 0], [1, 0]])
    expect(getTile(map, gfx, 1, 0)).toBe(5)
    expect(paintTiles(map, gfx, [[0, 0]], 5)).toEqual([])
  })

  it('writes the lower half of the map into the sprite sheet', () => {
    const { map, gfx } = regions()
    const changed = paintTiles(map, gfx, [[3, 40]], 9)
    expect(gfx[0x1000 + 8 * 128 + 3]).toBe(9)
    expect(map.every((b) => b === 0)).toBe(true)
    expect(regionsTouched(changed)).toEqual(['gfx'])
  })

  it('fills the connected area of one tile', () => {
    const { map, gfx } = regions()
    paintTiles(map, gfx, [[2, 0], [2, 1], [2, 2]], 4) // a wall under the fill's reach on x = 2
    const changed = fillTiles(map, gfx, 0, 0, 7)
    expect(getTile(map, gfx, 0, 0)).toBe(7)
    expect(getTile(map, gfx, 2, 0)).toBe(4)
    expect(getTile(map, gfx, 3, 0)).toBe(7) // connected around the wall
    expect(changed.length).toBe(128 * 64 - 3)
  })

  it('does not fill with the tile that is already there', () => {
    const { map, gfx } = regions()
    expect(fillTiles(map, gfx, 4, 4, 0)).toEqual([])
    expect(fillTiles(map, gfx, -1, 4, 3)).toEqual([])
  })

  it('stamps a block and drops what does not fit', () => {
    const { map, gfx } = regions()
    const block = { w: 2, h: 2, tiles: Uint8Array.of(1, 2, 3, 4) }
    const changed = stampTiles(map, gfx, 127, 63, block)
    expect(changed).toEqual([[127, 63]])
    expect(getTile(map, gfx, 127, 63)).toBe(1)
    expect(stampTiles(map, gfx, 127, 63, block)).toEqual([])
  })

  it('clears and copies rectangles', () => {
    const { map, gfx } = regions()
    paintTiles(map, gfx, [[1, 1], [2, 1]], 6)
    const copy = copyTiles(map, gfx, { x: 1, y: 1, w: 2, h: 1 })
    expect(Array.from(copy.tiles)).toEqual([6, 6])
    expect(clearTiles(map, gfx, { x: 1, y: 1, w: 2, h: 1 })).toHaveLength(2)
    expect(getTile(map, gfx, 1, 1)).toBe(0)
  })
})

describe('geometry', () => {
  it('cuts a drag to the map', () => {
    expect(dragTiles([5, 9], [2, 3])).toEqual({ x: 2, y: 3, w: 4, h: 7 })
    expect(dragTiles([-5, -5], [500, 500])).toEqual({ x: 0, y: 0, w: 128, h: 64 })
  })

  it('snaps a brush to steps of its own size from the origin', () => {
    expect(snapToBrush([10, 10], [10, 10], 2, 2)).toEqual([10, 10])
    expect(snapToBrush([10, 10], [11, 11], 2, 2)).toEqual([10, 10])
    expect(snapToBrush([10, 10], [12, 13], 2, 2)).toEqual([12, 12])
    expect(snapToBrush([10, 10], [9, 9], 2, 2)).toEqual([8, 8])
    expect(snapToBrush([10, 10], [7, 10], 1, 1)).toEqual([7, 10])
  })

  it('keeps a point inside the map', () => {
    expect(clampToMap([-3, 99])).toEqual([0, 63])
  })
})

describe('mapIndices', () => {
  it('draws each tile from its sprite', () => {
    const { map, gfx } = regions()
    setPixel(gfx, 8 * 3 + 1, 8 * 1 + 2, 12) // sprite 19 (col 3, row 1), pixel (1, 2)
    paintTiles(map, gfx, [[5, 4]], 19)
    const out = mapIndices(map, gfx, { x: 4, y: 4, w: 2, h: 1 })
    expect(out.length).toBe(16 * 8)
    expect(out[2 * 16 + 8 + 1]).toBe(12) // second tile of the row
    expect(out[2 * 16 + 1]).toBe(0) // first tile is sprite 0
  })

  it('reads the lower half of the map through the sheet', () => {
    const { map, gfx } = regions()
    setPixel(gfx, 0, 0, 3) // sprite 0
    paintTiles(map, gfx, [[0, 33]], 0)
    gfx[0x1000 + 128] = 1 // tile (0, 33) = sprite 1
    setPixel(gfx, 8, 0, 14) // sprite 1, pixel (0, 0)
    const out = mapIndices(map, gfx, { x: 0, y: 33, w: 1, h: 1 })
    expect(out[0]).toBe(14)
  })
})
