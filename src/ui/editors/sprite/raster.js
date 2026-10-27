/**
 * Pixel algorithms for the sprite editor. Everything here is pure: shapes are returned as lists of
 * points, bitmaps as `Block`s, and the sprite sheet is read and written through `getPixel`/`setPixel`.
 */

/** @typedef {[x: number, y: number]} Point */
/** @typedef {{ w: number, h: number, data: Uint8Array }} Block   Row-major colour indices */

/** Width of the sprite sheet in pixels, and so the row stride of the 4 bits per pixel data. */
export const SHEET_SIZE = 128

/**
 * Colour of a pixel of 4bpp image data (left pixel = low nibble). Out of range reads give 0.
 * @param {Uint8Array} gfx
 * @param {number} x
 * @param {number} y
 */
export function getPixel(gfx, x, y) {
  if (x < 0 || y < 0 || x >= SHEET_SIZE || y >= SHEET_SIZE) return 0
  const b = gfx[y * (SHEET_SIZE / 2) + (x >> 1)]
  return x & 1 ? b >> 4 : b & 15
}

/**
 * @param {Uint8Array} gfx
 * @param {number} x
 * @param {number} y
 * @param {number} color  0..15
 */
export function setPixel(gfx, x, y, color) {
  if (x < 0 || y < 0 || x >= SHEET_SIZE || y >= SHEET_SIZE) return
  const i = y * (SHEET_SIZE / 2) + (x >> 1)
  gfx[i] = x & 1 ? (gfx[i] & 0x0f) | ((color & 15) << 4) : (gfx[i] & 0xf0) | (color & 15)
}

/**
 * Bresenham line, both ends included.
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {Point[]}
 */
export function linePoints(x0, y0, x1, y1) {
  /** @type {Point[]} */
  const out = []
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    out.push([x0, y0])
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
  return out
}

/**
 * The rectangle between two corners (any order), outline or filled.
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {boolean} filled
 * @returns {Point[]}
 */
export function rectPoints(x0, y0, x1, y1, filled) {
  const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0]
  const [t, b] = y0 < y1 ? [y0, y1] : [y1, y0]
  /** @type {Point[]} */
  const out = []
  for (let y = t; y <= b; y++) {
    if (filled || y === t || y === b) {
      for (let x = l; x <= r; x++) out.push([x, y])
    } else {
      out.push([l, y])
      if (r !== l) out.push([r, y])
    }
  }
  return out
}

/**
 * The ellipse inscribed in the bounding box between two corners (a circle for a square box).
 * Midpoint algorithm for ellipses in a rectangle (A. Zingl), so odd and even sizes both work.
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {boolean} filled
 * @returns {Point[]}
 */
export function ellipsePoints(x0, y0, x1, y1, filled) {
  /** @type {Map<number, [number, number]>} y -> [minX, maxX] of the outline */
  const rows = new Map()
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {Point[]} */
  const outline = []
  /** @param {number} x @param {number} y */
  const plot = (x, y) => {
    const key = `${x},${y}`
    if (!seen.has(key)) {
      seen.add(key)
      outline.push([x, y])
    }
    const row = rows.get(y)
    if (row) {
      if (x < row[0]) row[0] = x
      if (x > row[1]) row[1] = x
    } else {
      rows.set(y, [x, x])
    }
  }

  const a = Math.abs(x1 - x0)
  const b = Math.abs(y1 - y0)
  const b1 = b & 1
  let dx = 4 * (1 - a) * b * b
  let dy = 4 * (b1 + 1) * a * a
  let err = dx + dy + b1 * a * a
  if (x0 > x1) {
    x0 = x1
    x1 += a
  }
  if (y0 > y1) y0 = y1
  y0 += Math.floor((b + 1) / 2)
  y1 = y0 - b1
  const a8 = 8 * a * a
  const b8 = 8 * b * b
  do {
    plot(x1, y0)
    plot(x0, y0)
    plot(x0, y1)
    plot(x1, y1)
    const e2 = 2 * err
    if (e2 <= dy) {
      y0++
      y1--
      dy += a8
      err += dy
    }
    if (e2 >= dx || 2 * err > dy) {
      x0++
      x1--
      dx += b8
      err += dx
    }
  } while (x0 <= x1)
  while (y0 - y1 <= b) {
    // flat ellipses stop too early
    plot(x0 - 1, y0)
    plot(x1 + 1, y0++)
    plot(x0 - 1, y1)
    plot(x1 + 1, y1--)
  }

  if (!filled) return outline
  /** @type {Point[]} */
  const out = []
  for (const [y, [lo, hi]] of rows) for (let x = lo; x <= hi; x++) out.push([x, y])
  return out
}

/**
 * The 4-connected area of one colour around (x, y), for the fill tool.
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => number} get
 * @param {number} x
 * @param {number} y
 * @returns {Point[]}
 */
export function floodFillPoints(width, height, get, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return []
  const target = get(x, y)
  const visited = new Uint8Array(width * height)
  /** @type {Point[]} */
  const out = []
  /** @type {number[]} */
  const stack = [y * width + x]
  visited[y * width + x] = 1
  while (stack.length) {
    const p = /** @type {number} */ (stack.pop())
    const px = p % width
    const py = (p - px) / width
    out.push([px, py])
    for (const [nx, ny] of /** @type {Point[]} */ ([[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]])) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const n = ny * width + nx
      if (visited[n] || get(nx, ny) !== target) continue
      visited[n] = 1
      stack.push(n)
    }
  }
  return out
}

/**
 * Copies a rectangle of the sheet. Pixels outside the sheet read as 0.
 * @param {Uint8Array} gfx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {Block}
 */
export function readBlock(gfx, x, y, w, h) {
  const data = new Uint8Array(w * h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = getPixel(gfx, x + i, y + j)
  return { w, h, data }
}

/**
 * Pastes a block onto the sheet with its top-left corner at (x, y); parts outside are dropped.
 * @param {Uint8Array} gfx
 * @param {number} x
 * @param {number} y
 * @param {Block} block
 */
export function writeBlock(gfx, x, y, block) {
  for (let j = 0; j < block.h; j++) for (let i = 0; i < block.w; i++) setPixel(gfx, x + i, y + j, block.data[j * block.w + i])
}

/** @param {Block} b @returns {Block} */
export function flipH(b) {
  const data = new Uint8Array(b.data.length)
  for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) data[j * b.w + (b.w - 1 - i)] = b.data[j * b.w + i]
  return { w: b.w, h: b.h, data }
}

/** @param {Block} b @returns {Block} */
export function flipV(b) {
  const data = new Uint8Array(b.data.length)
  for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) data[(b.h - 1 - j) * b.w + i] = b.data[j * b.w + i]
  return { w: b.w, h: b.h, data }
}

/**
 * Quarter turn clockwise; the result is `h` wide and `w` tall.
 * @param {Block} b
 * @returns {Block}
 */
export function rotateCW(b) {
  const data = new Uint8Array(b.data.length)
  for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) data[i * b.h + (b.h - 1 - j)] = b.data[j * b.w + i]
  return { w: b.h, h: b.w, data }
}

/**
 * Moves the content by (dx, dy); what leaves one side comes back on the other.
 * @param {Block} b
 * @param {number} dx
 * @param {number} dy
 * @returns {Block}
 */
export function shiftBlock(b, dx, dy) {
  const data = new Uint8Array(b.data.length)
  for (let j = 0; j < b.h; j++) {
    for (let i = 0; i < b.w; i++) {
      const x = (((i + dx) % b.w) + b.w) % b.w
      const y = (((j + dy) % b.h) + b.h) % b.h
      data[y * b.w + x] = b.data[j * b.w + i]
    }
  }
  return { w: b.w, h: b.h, data }
}
