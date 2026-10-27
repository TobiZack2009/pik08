import { floodFillPoints, getPixel } from '../sprite/raster.js'
import { SHEET_COLS, spriteIndex } from '../sprite/sprite-ops.js'
import { MAP_HEIGHT, MAP_WIDTH, getTile, inMap, readTiles, setTile } from './map-data.js'

/** @import { Point } from '../sprite/raster.js' */
/** @import { Rect, SpriteSelection } from '../sprite/sprite-ops.js' */
/** @import { TileBlock } from './map-data.js' */

/**
 * What the map editor does to the tiles, without any DOM. Coordinates are tiles; every function that
 * changes the map returns the tiles that actually changed, so callers can repaint just those and
 * work out which ROM regions to announce (see `regionsTouched` in map-data.js).
 */

/** @typedef {'pen' | 'eraser' | 'fill' | 'line' | 'rect' | 'circle' | 'select' | 'pick' | 'pan'} MapToolId */
export const MAP_TOOLS = /** @type {const} */ (['pen', 'eraser', 'fill', 'line', 'rect', 'circle', 'select', 'pick', 'pan'])

/** Tile size in sprite pixels. */
export const TILE_PX = 8

/**
 * The tiles a sprite-sheet selection stands for: the same sprites in the same layout.
 * @param {SpriteSelection} sel
 * @returns {TileBlock}
 */
export function brushBlock(sel) {
  const tiles = new Uint8Array(sel.w * sel.h)
  for (let j = 0; j < sel.h; j++) for (let i = 0; i < sel.w; i++) tiles[j * sel.w + i] = (sel.row + j) * SHEET_COLS + sel.col + i
  return { w: sel.w, h: sel.h, tiles }
}

/**
 * The sprite selection that shows one tile.
 * @param {number} tile
 * @returns {SpriteSelection}
 */
export const tileSelection = (tile) => ({ col: tile % SHEET_COLS, row: tile >> 4, w: 1, h: 1 })

/** The first sprite of a brush: what the single-tile tools use. */
export const brushTile = (/** @type {SpriteSelection} */ sel) => spriteIndex(sel)

/**
 * Colour indices of a rectangle of tiles, one per pixel, `rect.w * 8` wide.
 * @param {Uint8Array} map
 * @param {Uint8Array} gfx
 * @param {Rect} rect  in tiles
 * @param {Uint8Array} [out]
 * @returns {Uint8Array}
 */
export function mapIndices(map, gfx, rect, out = new Uint8Array(rect.w * rect.h * TILE_PX * TILE_PX)) {
  const width = rect.w * TILE_PX
  for (let ty = 0; ty < rect.h; ty++) {
    for (let tx = 0; tx < rect.w; tx++) {
      const tile = getTile(map, gfx, rect.x + tx, rect.y + ty)
      const sx = (tile % SHEET_COLS) * TILE_PX
      const sy = (tile >> 4) * TILE_PX
      for (let py = 0; py < TILE_PX; py++) {
        const row = (ty * TILE_PX + py) * width + tx * TILE_PX
        for (let px = 0; px < TILE_PX; px++) out[row + px] = getPixel(gfx, sx + px, sy + py)
      }
    }
  }
  return out
}

/**
 * Sets tiles; those outside the map and those that already have the tile are skipped.
 * @param {Uint8Array} map
 * @param {Uint8Array} gfx
 * @param {Iterable<Point>} points
 * @param {number} tile
 * @returns {Point[]} the tiles that changed
 */
export function paintTiles(map, gfx, points, tile) {
  /** @type {Point[]} */
  const changed = []
  for (const [x, y] of points) {
    if (!inMap(x, y) || getTile(map, gfx, x, y) === tile) continue
    setTile(map, gfx, x, y, tile)
    changed.push([x, y])
  }
  return changed
}

/**
 * Fills the connected area of one tile.
 * @param {Uint8Array} map
 * @param {Uint8Array} gfx
 * @param {number} x
 * @param {number} y
 * @param {number} tile
 * @returns {Point[]}
 */
export function fillTiles(map, gfx, x, y, tile) {
  if (!inMap(x, y) || getTile(map, gfx, x, y) === tile) return []
  const area = floodFillPoints(MAP_WIDTH, MAP_HEIGHT, (px, py) => getTile(map, gfx, px, py), x, y)
  return paintTiles(map, gfx, area, tile)
}

/**
 * Puts a block of tiles with its corner at a tile; what falls outside the map is dropped.
 * @param {Uint8Array} map
 * @param {Uint8Array} gfx
 * @param {number} x
 * @param {number} y
 * @param {TileBlock} block
 * @returns {Point[]}
 */
export function stampTiles(map, gfx, x, y, block) {
  /** @type {Point[]} */
  const changed = []
  for (let j = 0; j < block.h; j++) {
    for (let i = 0; i < block.w; i++) {
      const tile = block.tiles[j * block.w + i]
      if (!inMap(x + i, y + j) || getTile(map, gfx, x + i, y + j) === tile) continue
      setTile(map, gfx, x + i, y + j, tile)
      changed.push([x + i, y + j])
    }
  }
  return changed
}

/**
 * Empties a rectangle of tiles (tile 0).
 * @param {Uint8Array} map
 * @param {Uint8Array} gfx
 * @param {Rect} rect
 * @returns {Point[]}
 */
export function clearTiles(map, gfx, rect) {
  return stampTiles(map, gfx, rect.x, rect.y, { w: rect.w, h: rect.h, tiles: new Uint8Array(rect.w * rect.h) })
}

/**
 * @param {Uint8Array} map
 * @param {Uint8Array} gfx
 * @param {Rect} rect
 * @returns {TileBlock}
 */
export const copyTiles = (map, gfx, rect) => readTiles(map, gfx, rect.x, rect.y, rect.w, rect.h)

/**
 * The rectangle between two tiles (any order), cut to the map. Empty (w or h 0) cannot happen for
 * points inside the map.
 * @param {Point} a
 * @param {Point} b
 * @returns {Rect}
 */
export function dragTiles([ax, ay], [bx, by]) {
  const x0 = Math.max(0, Math.min(ax, bx))
  const y0 = Math.max(0, Math.min(ay, by))
  const x1 = Math.min(MAP_WIDTH - 1, Math.max(ax, bx))
  const y1 = Math.min(MAP_HEIGHT - 1, Math.max(ay, by))
  return { x: x0, y: y0, w: Math.max(0, x1 - x0 + 1), h: Math.max(0, y1 - y0 + 1) }
}

/**
 * Where a brush lands when dragging from `origin`: on the grid of brush-sized steps that starts at
 * the origin, so a big brush leaves clean copies of itself instead of a smear.
 * @param {Point} origin
 * @param {Point} at
 * @param {number} bw  brush size in tiles
 * @param {number} bh
 * @returns {Point}
 */
export function snapToBrush([ox, oy], [x, y], bw, bh) {
  return [ox + Math.floor((x - ox) / bw) * bw, oy + Math.floor((y - oy) / bh) * bh]
}

/**
 * @param {Point} p
 * @returns {Point}
 */
export const clampToMap = ([x, y]) => [Math.min(MAP_WIDTH - 1, Math.max(0, x)), Math.min(MAP_HEIGHT - 1, Math.max(0, y))]
