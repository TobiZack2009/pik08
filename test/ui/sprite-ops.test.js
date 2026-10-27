import { describe, expect, it } from 'vitest'
import { getPixel, setPixel } from '../../src/ui/editors/sprite/raster.js'
import {
  SHEET_COLS,
  clampSelection,
  clearArea,
  copyArea,
  dragArea,
  dragSelection,
  fillArea,
  flipAreaH,
  flipAreaV,
  hasFlag,
  inRect,
  moveSelection,
  paintPoints,
  pasteBlock,
  rotateArea,
  selectedSprites,
  selectionRect,
  setFlag,
  shapePoints,
  sheetIndices,
  shiftArea,
  spriteIndex,
  strokePoints,
} from '../../src/ui/editors/sprite/sprite-ops.js'

const newGfx = () => new Uint8Array(0x2000)
/** the 8x8 sprite at sheet column 1, row 0 */
const view = { x: 8, y: 0, w: 8, h: 8 }

describe('selections', () => {
  it('turns a selection into sheet pixels and a sprite number', () => {
    const sel = { col: 2, row: 3, w: 2, h: 1 }
    expect(selectionRect(sel)).toEqual({ x: 16, y: 24, w: 16, h: 8 })
    expect(spriteIndex(sel)).toBe(3 * SHEET_COLS + 2)
  })

  it('keeps a selection inside the sheet and within the size limit', () => {
    expect(clampSelection({ col: 15, row: 15, w: 4, h: 2 })).toEqual({ col: 12, row: 14, w: 4, h: 2 })
    expect(clampSelection({ col: -3, row: 0, w: 0, h: 20 })).toEqual({ col: 0, row: 0, w: 1, h: 8 })
    expect(clampSelection({ col: 0, row: 0, w: 12, h: 1 }, 4).w).toBe(4)
  })

  it('selects the cells between two drag points, in any direction', () => {
    expect(dragSelection(3, 2, 5, 4)).toEqual({ col: 3, row: 2, w: 3, h: 3 })
    expect(dragSelection(5, 4, 3, 2)).toEqual({ col: 3, row: 2, w: 3, h: 3 })
    expect(dragSelection(0, 0, 15, 15)).toEqual({ col: 0, row: 0, w: 8, h: 8 })
  })

  it('moves by whole sprites and stops at the edge', () => {
    const sel = { col: 14, row: 0, w: 2, h: 1 }
    expect(moveSelection(sel, 1, 1)).toEqual({ col: 14, row: 1, w: 2, h: 1 })
    expect(moveSelection(sel, -20, 0).col).toBe(0)
  })

  it('lists the covered sprites row by row', () => {
    expect(selectedSprites({ col: 1, row: 1, w: 2, h: 2 })).toEqual([17, 18, 33, 34])
  })
})

describe('view access', () => {
  it('tests view coordinates', () => {
    expect(inRect(view, 0, 0)).toBe(true)
    expect(inRect(view, 7, 7)).toBe(true)
    expect(inRect(view, 8, 0)).toBe(false)
    expect(inRect(view, -1, 3)).toBe(false)
  })

  it('reads colour indices of a rectangle', () => {
    const gfx = newGfx()
    setPixel(gfx, 9, 1, 7)
    const px = sheetIndices(gfx, view)
    expect(px.length).toBe(64)
    expect(px[1 * 8 + 1]).toBe(7)
    expect(sheetIndices(gfx).length).toBe(128 * 128)
  })
})

describe('painting', () => {
  it('writes view coordinates into the sheet and reports changes', () => {
    const gfx = newGfx()
    expect(paintPoints(gfx, view, [[0, 0], [1, 0]], 5)).toBe(true)
    expect(getPixel(gfx, 8, 0)).toBe(5)
    expect(getPixel(gfx, 9, 0)).toBe(5)
    expect(paintPoints(gfx, view, [[0, 0]], 5)).toBe(false)
  })

  it('ignores points outside the view', () => {
    const gfx = newGfx()
    expect(paintPoints(gfx, view, [[-1, 0], [8, 0], [0, 8]], 5)).toBe(false)
    expect(getPixel(gfx, 7, 0)).toBe(0)
    expect(getPixel(gfx, 16, 0)).toBe(0)
  })

  it('fills the connected area inside the view only', () => {
    const gfx = newGfx()
    for (let y = 0; y < 8; y++) setPixel(gfx, 8 + 3, y, 2) // a wall at x = 3
    expect(fillArea(gfx, view, 0, 0, 9)).toBe(true)
    expect(getPixel(gfx, 8, 0)).toBe(9)
    expect(getPixel(gfx, 10, 7)).toBe(9)
    expect(getPixel(gfx, 11, 0)).toBe(2)
    expect(getPixel(gfx, 12, 0)).toBe(0) // other side of the wall
    expect(getPixel(gfx, 7, 0)).toBe(0) // outside the view, same colour
  })

  it('does nothing when filling with the colour already there or outside the view', () => {
    const gfx = newGfx()
    expect(fillArea(gfx, view, 0, 0, 0)).toBe(false)
    expect(fillArea(gfx, view, 9, 0, 3)).toBe(false)
  })

  it('draws shapes and joins stroke segments', () => {
    expect(shapePoints('line', [0, 0], [3, 0], false)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]])
    expect(shapePoints('rect', [0, 0], [2, 2], false)).toHaveLength(8)
    expect(shapePoints('rect', [0, 0], [2, 2], true)).toHaveLength(9)
    expect(shapePoints('circle', [0, 0], [4, 4], true).length).toBeGreaterThan(shapePoints('circle', [0, 0], [4, 4], false).length)
    expect(strokePoints(null, [2, 2])).toEqual([[2, 2]])
    expect(strokePoints([0, 0], [3, 0])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]])
  })
})

describe('area transforms', () => {
  const whole = { x: 0, y: 0, w: 8, h: 8 }

  it('flips horizontally and vertically', () => {
    const gfx = newGfx()
    setPixel(gfx, 8, 0, 4) // view (0,0)
    expect(flipAreaH(gfx, view, whole)).toBe(true)
    expect(getPixel(gfx, 8, 0)).toBe(0)
    expect(getPixel(gfx, 15, 0)).toBe(4)
    expect(flipAreaV(gfx, view, whole)).toBe(true)
    expect(getPixel(gfx, 15, 7)).toBe(4)
  })

  it('reports no change for a symmetrical area', () => {
    const gfx = newGfx()
    expect(flipAreaH(gfx, view, whole)).toBe(false)
    expect(rotateArea(gfx, view, whole)).toBe(false)
  })

  it('rotates a square clockwise', () => {
    const gfx = newGfx()
    setPixel(gfx, 8, 0, 4) // top-left goes to top-right
    expect(rotateArea(gfx, view, whole)).toBe(true)
    expect(getPixel(gfx, 15, 0)).toBe(4)
    expect(getPixel(gfx, 8, 0)).toBe(0)
  })

  it('refuses to rotate a rectangle that is not square', () => {
    const gfx = newGfx()
    setPixel(gfx, 8, 0, 4)
    expect(rotateArea(gfx, view, { x: 0, y: 0, w: 4, h: 2 })).toBe(false)
    expect(getPixel(gfx, 8, 0)).toBe(4)
  })

  it('shifts with wrap-around', () => {
    const gfx = newGfx()
    setPixel(gfx, 15, 0, 6) // right edge of the view
    expect(shiftArea(gfx, view, whole, 1, 0)).toBe(true)
    expect(getPixel(gfx, 8, 0)).toBe(6)
    expect(getPixel(gfx, 15, 0)).toBe(0)
    expect(shiftArea(gfx, view, whole, 0, -1)).toBe(true)
    expect(getPixel(gfx, 8, 7)).toBe(6)
    expect(shiftArea(gfx, view, whole, 8, 8)).toBe(false)
  })

  it('only touches the given area', () => {
    const gfx = newGfx()
    setPixel(gfx, 8, 0, 1)
    setPixel(gfx, 8 + 4, 0, 2)
    flipAreaH(gfx, view, { x: 0, y: 0, w: 4, h: 8 })
    expect(getPixel(gfx, 8 + 3, 0)).toBe(1)
    expect(getPixel(gfx, 8 + 4, 0)).toBe(2)
  })
})

describe('copy, paste, clear', () => {
  it('copies an area and pastes it elsewhere', () => {
    const gfx = newGfx()
    setPixel(gfx, 8, 0, 3)
    setPixel(gfx, 9, 1, 4)
    const block = copyArea(gfx, view, { x: 0, y: 0, w: 2, h: 2 })
    expect(Array.from(block.data)).toEqual([3, 0, 0, 4])
    expect(pasteBlock(gfx, view, 4, 4, block)).toBe(true)
    expect(getPixel(gfx, 12, 4)).toBe(3)
    expect(getPixel(gfx, 13, 5)).toBe(4)
    expect(pasteBlock(gfx, view, 4, 4, block)).toBe(false)
  })

  it('drops what does not fit in the view', () => {
    const gfx = newGfx()
    const block = { w: 3, h: 1, data: Uint8Array.of(1, 2, 3) }
    expect(pasteBlock(gfx, view, 6, 0, block)).toBe(true)
    expect(getPixel(gfx, 14, 0)).toBe(1)
    expect(getPixel(gfx, 15, 0)).toBe(2)
    expect(getPixel(gfx, 16, 0)).toBe(0) // next sprite untouched
    expect(pasteBlock(gfx, view, -5, 0, block)).toBe(false)
  })

  it('clears an area', () => {
    const gfx = newGfx()
    paintPoints(gfx, view, [[0, 0], [1, 0], [5, 5]], 8)
    expect(clearArea(gfx, view, { x: 0, y: 0, w: 2, h: 1 })).toBe(true)
    expect(getPixel(gfx, 8, 0)).toBe(0)
    expect(getPixel(gfx, 13, 5)).toBe(8)
    expect(clearArea(gfx, view, { x: 0, y: 0, w: 2, h: 1 })).toBe(false)
  })

  it('normalises a drag into an area inside the view', () => {
    expect(dragArea(view, [5, 2], [1, 6])).toEqual({ x: 1, y: 2, w: 5, h: 5 })
    expect(dragArea(view, [-3, -3], [20, 20])).toEqual({ x: 0, y: 0, w: 8, h: 8 })
    expect(dragArea(view, [3, 3], [3, 3])).toEqual({ x: 3, y: 3, w: 1, h: 1 })
  })
})

describe('flags', () => {
  it('sets and clears a bit on several sprites', () => {
    const flags = new Uint8Array(256)
    expect(setFlag(flags, [1, 2], 3, true)).toBe(true)
    expect(flags[1]).toBe(8)
    expect(hasFlag(flags, 2, 3)).toBe(1)
    expect(hasFlag(flags, 0, 3)).toBe(0)
    expect(setFlag(flags, [1, 2], 3, true)).toBe(false)
    expect(setFlag(flags, [1], 3, false)).toBe(true)
    expect(flags[1]).toBe(0)
    expect(flags[2]).toBe(8)
  })

  it('ignores sprites outside the table', () => {
    const flags = new Uint8Array(256)
    expect(setFlag(flags, [-1, 256], 0, true)).toBe(false)
    expect(hasFlag(flags, 999, 0)).toBe(0)
  })
})
