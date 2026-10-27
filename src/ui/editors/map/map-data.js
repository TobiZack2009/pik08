/**
 * Access to the 128x64 tile map.
 *
 * Like PICO-8, the `map` region only holds the upper 32 rows (0x2000..0x2fff). The lower 32 rows
 * live in the second half of the sprite sheet (0x1000..0x1fff, i.e. sprites 128..255), so drawing
 * there changes sprites and vice versa. See profiles/pico8/memory-map.js.
 */

export const MAP_WIDTH = 128
export const MAP_HEIGHT = 64
/** Rows stored in the `map` region; the rest is in the `gfx` region. */
export const MAP_OWN_ROWS = 32
/** Offset in the `gfx` region where the lower map rows start. */
export const MAP_GFX_OFFSET = 0x1000

/**
 * @param {number} x
 * @param {number} y
 */
export const inMap = (x, y) => x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT

/**
 * Whether a tile is stored in the sprite sheet's memory.
 * @param {number} y
 */
export const isSharedRow = (y) => y >= MAP_OWN_ROWS

/**
 * @param {Uint8Array} map  the `map` region
 * @param {Uint8Array} gfx  the `gfx` region
 * @param {number} x
 * @param {number} y
 * @returns {number} the sprite number, 0 outside the map
 */
export function getTile(map, gfx, x, y) {
  if (!inMap(x, y)) return 0
  return y < MAP_OWN_ROWS ? map[y * MAP_WIDTH + x] : gfx[MAP_GFX_OFFSET + (y - MAP_OWN_ROWS) * MAP_WIDTH + x]
}

/**
 * @param {Uint8Array} map
 * @param {Uint8Array} gfx
 * @param {number} x
 * @param {number} y
 * @param {number} tile
 */
export function setTile(map, gfx, x, y, tile) {
  if (!inMap(x, y)) return
  if (y < MAP_OWN_ROWS) map[y * MAP_WIDTH + x] = tile
  else gfx[MAP_GFX_OFFSET + (y - MAP_OWN_ROWS) * MAP_WIDTH + x] = tile
}

/**
 * Which regions an edit touches, for change notifications.
 * @param {Iterable<readonly [number, number]>} points
 * @returns {string[]}
 */
export function regionsTouched(points) {
  let own = false
  let shared = false
  for (const [, y] of points) {
    if (isSharedRow(y)) shared = true
    else own = true
  }
  return [...(own ? ['map'] : []), ...(shared ? ['gfx'] : [])]
}

/**
 * @typedef {{ w: number, h: number, tiles: Uint8Array }} TileBlock
 */

/**
 * @param {Uint8Array} map
 * @param {Uint8Array} gfx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {TileBlock}
 */
export function readTiles(map, gfx, x, y, w, h) {
  const tiles = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tiles[j * w + i] = getTile(map, gfx, x + i, y + j)
  return { w, h, tiles }
}

/**
 * @param {Uint8Array} map
 * @param {Uint8Array} gfx
 * @param {number} x
 * @param {number} y
 * @param {TileBlock} block
 */
export function writeTiles(map, gfx, x, y, block) {
  for (let j = 0; j < block.h; j++) for (let i = 0; i < block.w; i++) setTile(map, gfx, x + i, y + j, block.tiles[j * block.w + i])
}
