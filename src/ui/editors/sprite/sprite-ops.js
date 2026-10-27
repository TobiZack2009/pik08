import {
  SHEET_SIZE,
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
} from './raster.js'

/** @import { Block, Point } from './raster.js' */

/**
 * What the sprite editor does to the sheet, without any DOM. The editor works on a *view*: a
 * rectangle of the sheet in pixels (the selected sprites, always a multiple of 8 on each side).
 * Tools see view coordinates; these functions turn them into sheet writes and report whether a
 * pixel actually changed.
 *
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect  pixels, in the sheet or the view
 * @typedef {{ col: number, row: number, w: number, h: number }} SpriteSelection  in sprites (8x8 pixels)
 */

export const SPRITE_PX = 8
/** Sprites per row of the sheet. */
export const SHEET_COLS = SHEET_SIZE / SPRITE_PX
export const SPRITE_COUNT = SHEET_COLS * SHEET_COLS

/** @typedef {'pen' | 'eraser' | 'fill' | 'line' | 'rect' | 'circle' | 'select' | 'pick'} ToolId */
export const TOOLS = /** @type {const} */ (['pen', 'eraser', 'fill', 'line', 'rect', 'circle', 'select', 'pick'])

/** Tools that drag out a shape and commit it on release. */
export const SHAPE_TOOLS = new Set(['line', 'rect', 'circle'])

/**
 * The sprites a selection covers, as a rectangle of sheet pixels.
 * @param {SpriteSelection} sel
 * @returns {Rect}
 */
export function selectionRect(sel) {
  return { x: sel.col * SPRITE_PX, y: sel.row * SPRITE_PX, w: sel.w * SPRITE_PX, h: sel.h * SPRITE_PX }
}

/**
 * Index of the top-left sprite of a selection.
 * @param {SpriteSelection} sel
 */
export const spriteIndex = (sel) => sel.row * SHEET_COLS + sel.col

/**
 * Keeps a selection inside the sheet with sizes from 1 up to `max` sprites.
 * @param {SpriteSelection} sel
 * @param {number} [max]
 * @returns {SpriteSelection}
 */
export function clampSelection({ col, row, w, h }, max = 8) {
  const cw = Math.min(Math.max(1, Math.round(w)), max, SHEET_COLS)
  const ch = Math.min(Math.max(1, Math.round(h)), max, SHEET_COLS)
  return {
    col: Math.min(Math.max(0, Math.round(col)), SHEET_COLS - cw),
    row: Math.min(Math.max(0, Math.round(row)), SHEET_COLS - ch),
    w: cw,
    h: ch,
  }
}

/**
 * The selection spanned by dragging from one sprite cell to another.
 * @param {number} col0
 * @param {number} row0
 * @param {number} col1
 * @param {number} row1
 * @param {number} [max]
 * @returns {SpriteSelection}
 */
export function dragSelection(col0, row0, col1, row1, max = 8) {
  const col = Math.min(col0, col1)
  const row = Math.min(row0, row1)
  return clampSelection({ col, row, w: Math.abs(col1 - col0) + 1, h: Math.abs(row1 - row0) + 1 }, max)
}

/**
 * Moves a selection by whole sprites, staying inside the sheet.
 * @param {SpriteSelection} sel
 * @param {number} dcol
 * @param {number} drow
 */
export function moveSelection(sel, dcol, drow) {
  return clampSelection({ ...sel, col: sel.col + dcol, row: sel.row + drow })
}

/**
 * @param {Rect} view
 * @param {number} x  view coordinates
 * @param {number} y
 */
export const inRect = (view, x, y) => x >= 0 && y >= 0 && x < view.w && y < view.h

/**
 * Colour indices of a rectangle of the sheet, one per pixel.
 * @param {Uint8Array} gfx
 * @param {Rect} [rect]  the whole sheet by default
 * @param {Uint8Array} [out]
 * @returns {Uint8Array}
 */
export function sheetIndices(gfx, rect = { x: 0, y: 0, w: SHEET_SIZE, h: SHEET_SIZE }, out = new Uint8Array(rect.w * rect.h)) {
  for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) out[j * rect.w + i] = getPixel(gfx, rect.x + i, rect.y + j)
  return out
}

/**
 * Sets pixels given in view coordinates; those outside the view are ignored.
 * @param {Uint8Array} gfx
 * @param {Rect} view
 * @param {Iterable<Point>} points
 * @param {number} color
 * @returns {boolean} whether any pixel changed
 */
export function paintPoints(gfx, view, points, color) {
  let changed = false
  for (const [x, y] of points) {
    if (!inRect(view, x, y)) continue
    const sx = view.x + x
    const sy = view.y + y
    if (getPixel(gfx, sx, sy) === color) continue
    setPixel(gfx, sx, sy, color)
    changed = true
  }
  return changed
}

/**
 * Fills the connected area of one colour around a view pixel.
 * @param {Uint8Array} gfx
 * @param {Rect} view
 * @param {number} x
 * @param {number} y
 * @param {number} color
 * @returns {boolean}
 */
export function fillArea(gfx, view, x, y, color) {
  if (!inRect(view, x, y) || getPixel(gfx, view.x + x, view.y + y) === color) return false
  const area = floodFillPoints(view.w, view.h, (px, py) => getPixel(gfx, view.x + px, view.y + py), x, y)
  return paintPoints(gfx, view, area, color)
}

/**
 * The pixels of a shape dragged from one view point to another.
 * @param {'line' | 'rect' | 'circle'} tool
 * @param {Point} from
 * @param {Point} to
 * @param {boolean} filled  for rect and circle
 * @returns {Point[]}
 */
export function shapePoints(tool, [x0, y0], [x1, y1], filled) {
  if (tool === 'line') return linePoints(x0, y0, x1, y1)
  if (tool === 'rect') return rectPoints(x0, y0, x1, y1, filled)
  return ellipsePoints(x0, y0, x1, y1, filled)
}

/**
 * Points of a stroke that moved from one view pixel to the next (no gaps when the mouse is fast).
 * @param {Point | null} last
 * @param {Point} now
 * @returns {Point[]}
 */
export function strokePoints(last, now) {
  return last ? linePoints(last[0], last[1], now[0], now[1]) : [now]
}

/**
 * Rewrites a rectangle of the view through a block transform. The result must have the size of the
 * rectangle (so rotating needs a square).
 * @param {Uint8Array} gfx
 * @param {Rect} view
 * @param {Rect} area  inside the view
 * @param {(block: Block) => Block} transform
 * @returns {boolean} whether the pixels changed
 */
export function transformArea(gfx, view, area, transform) {
  const block = readBlock(gfx, view.x + area.x, view.y + area.y, area.w, area.h)
  const out = transform(block)
  if (out.w !== area.w || out.h !== area.h) return false
  if (out.data.every((v, i) => v === block.data[i])) return false
  writeBlock(gfx, view.x + area.x, view.y + area.y, out)
  return true
}

export const flipAreaH = (/** @type {Uint8Array} */ gfx, /** @type {Rect} */ view, /** @type {Rect} */ area) => transformArea(gfx, view, area, flipH)
export const flipAreaV = (/** @type {Uint8Array} */ gfx, /** @type {Rect} */ view, /** @type {Rect} */ area) => transformArea(gfx, view, area, flipV)
export const rotateArea = (/** @type {Uint8Array} */ gfx, /** @type {Rect} */ view, /** @type {Rect} */ area) => transformArea(gfx, view, area, rotateCW)

/**
 * @param {Uint8Array} gfx
 * @param {Rect} view
 * @param {Rect} area
 * @param {number} dx
 * @param {number} dy
 */
export function shiftArea(gfx, view, area, dx, dy) {
  return transformArea(gfx, view, area, (b) => shiftBlock(b, dx, dy))
}

/**
 * @param {Uint8Array} gfx
 * @param {Rect} view
 * @param {Rect} area
 * @returns {Block}
 */
export function copyArea(gfx, view, area) {
  return readBlock(gfx, view.x + area.x, view.y + area.y, area.w, area.h)
}

/**
 * Pastes a block with its corner at a view point; what does not fit in the view is dropped.
 * @param {Uint8Array} gfx
 * @param {Rect} view
 * @param {number} x
 * @param {number} y
 * @param {Block} block
 * @returns {boolean}
 */
export function pasteBlock(gfx, view, x, y, block) {
  /** @type {Point[]} */
  const points = []
  for (let j = 0; j < block.h; j++) for (let i = 0; i < block.w; i++) points.push([x + i, y + j])
  let changed = false
  for (const [px, py] of points) {
    if (!inRect(view, px, py)) continue
    const color = block.data[(py - y) * block.w + (px - x)]
    changed = paintPoints(gfx, view, [[px, py]], color) || changed
  }
  return changed
}

/**
 * @param {Uint8Array} gfx
 * @param {Rect} view
 * @param {Rect} area
 * @returns {boolean}
 */
export function clearArea(gfx, view, area) {
  /** @type {Point[]} */
  const points = []
  for (let j = 0; j < area.h; j++) for (let i = 0; i < area.w; i++) points.push([area.x + i, area.y + j])
  return paintPoints(gfx, view, points, 0)
}

/**
 * Normalises a drag between two view pixels into a rectangle inside the view.
 * @param {Rect} view
 * @param {Point} a
 * @param {Point} b
 * @returns {Rect}
 */
export function dragArea(view, [ax, ay], [bx, by]) {
  const x0 = Math.max(0, Math.min(ax, bx))
  const y0 = Math.max(0, Math.min(ay, by))
  const x1 = Math.min(view.w - 1, Math.max(ax, bx))
  const y1 = Math.min(view.h - 1, Math.max(ay, by))
  return { x: x0, y: y0, w: Math.max(0, x1 - x0 + 1), h: Math.max(0, y1 - y0 + 1) }
}

/**
 * Whether a flag of a sprite is set.
 * @param {Uint8Array} flags
 * @param {number} sprite
 * @param {number} bit  0..7
 */
export const hasFlag = (flags, sprite, bit) => ((flags[sprite] ?? 0) >> bit) & 1

/**
 * Sets or clears a flag on several sprites.
 * @param {Uint8Array} flags
 * @param {number[]} sprites
 * @param {number} bit
 * @param {boolean} on
 * @returns {boolean} whether any byte changed
 */
export function setFlag(flags, sprites, bit, on) {
  let changed = false
  for (const s of sprites) {
    if (s < 0 || s >= flags.length) continue
    const next = on ? flags[s] | (1 << bit) : flags[s] & ~(1 << bit)
    if (next !== flags[s]) {
      flags[s] = next
      changed = true
    }
  }
  return changed
}

/**
 * The sprite numbers covered by a selection, row by row.
 * @param {SpriteSelection} sel
 * @returns {number[]}
 */
export function selectedSprites(sel) {
  const out = []
  for (let j = 0; j < sel.h; j++) for (let i = 0; i < sel.w; i++) out.push((sel.row + j) * SHEET_COLS + sel.col + i)
  return out
}
