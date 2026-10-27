import { LINE_H, charWidth, glyphRows } from './font.js'

/**
 * The drawing half of the console, working directly on its memory like the real thing: the screen is
 * the 4-bit region at 0x6000, and the draw state (palette, clip rectangle, pen colour, cursor,
 * camera) lives in the registers from 0x5f00, so a cart can `peek` and `poke` it.
 *
 * Every method takes plain numbers (the Lua-facing wrappers are in `api.js`); positions are floored
 * the way the console does it. `undefined` stands for an argument that was left out.
 */

export const SCREEN_ADDR = 0x6000
export const SCREEN_W = 128
export const SCREEN_H = 128

const PAL_DRAW = 0x5f00 // 16 bytes: colour a draws as (low nibble); bit 4 = transparent when drawing sprites
const PAL_SCREEN = 0x5f10 // 16 bytes: colour a is shown as (0..15, or 128..143 for the secret colours)
const CLIP = 0x5f20 // x0, y0, x1, y1 (the far edge is not drawn)
const PEN = 0x5f25 // low nibble: the colour; high nibble: the second colour of a fill pattern
const FILL = 0x5f31 // the 16-bit fill pattern, then its flags (bit 0: the second colour is see-through)
const CURSOR = 0x5f26 // x, y
const CAMERA = 0x5f28 // x, y as 16-bit little endian
const MAP_ADDR = 0x2000
const MAP_SHARED = 0x1000 // map rows 32..63 are stored here, in the lower half of the sprite sheet
const FLAGS_ADDR = 0x3000
const MAP_W = 128
const MAP_H = 64

/** @param {number} x */
const flr = (x) => Math.floor(x)
/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export class Graphics {
  /** @param {Uint8Array} data  the console's whole address space */
  constructor(data) {
    this.d = data
    this.cx0 = 0
    this.cy0 = 0
    this.cx1 = SCREEN_W
    this.cy1 = SCREEN_H
    this.camX = 0
    this.camY = 0
    /** the fill pattern in force for the shape being drawn (0: none), and the colour its set bits draw (-1: none) */
    this.pat = 0
    this.sec = 0
    /** where the last `line` ended, for `line(x, y)` with two arguments */
    this.lineEnd = /** @type {[number, number] | null} */ (null)
    this.reset()
  }

  /** The state a cart starts with (and `run` restores): identity palettes, no clip, pen 6, cursor and camera at 0. */
  reset() {
    const d = this.d
    d.fill(0, 0x5f00, 0x6000)
    this.resetPalette()
    this.clip()
    d[PEN] = 6
    this.lineEnd = null
  }

  resetPalette() {
    const d = this.d
    for (let c = 0; c < 16; c++) {
      d[PAL_DRAW + c] = c === 0 ? 0x10 : c
      d[PAL_SCREEN + c] = c
    }
  }

  /** Reads the registers that every drawing call depends on. */
  #state() {
    const d = this.d
    this.cx0 = clamp(d[CLIP], 0, SCREEN_W)
    this.cy0 = clamp(d[CLIP + 1], 0, SCREEN_H)
    this.cx1 = clamp(d[CLIP + 2], 0, SCREEN_W)
    this.cy1 = clamp(d[CLIP + 3], 0, SCREEN_H)
    this.camX = ((d[CAMERA] | (d[CAMERA + 1] << 8)) << 16) >> 16
    this.camY = ((d[CAMERA + 2] | (d[CAMERA + 3] << 8)) << 16) >> 16
    this.pat = 0
  }

  /**
   * The colour to draw shapes with: the one given (which becomes the pen) or the pen, through the draw
   * palette. This also readies the fill pattern for the `#plot`s that follow.
   * @param {number | undefined} c
   */
  #pen(c) {
    const d = this.d
    if (c !== undefined) d[PEN] = flr(c) & 0xff
    const pen = d[PEN]
    this.pat = d[FILL] | (d[FILL + 1] << 8)
    this.sec = d[FILL + 2] & 1 ? -1 : d[PAL_DRAW + (pen >> 4)] & 15
    return d[PAL_DRAW + (pen & 15)] & 15
  }

  /**
   * Sets one pixel, if it is inside the clip rectangle. Positions are final screen positions.
   * @param {number} x
   * @param {number} y
   * @param {number} c  0..15
   */
  #plot(x, y, c) {
    if (x < this.cx0 || x >= this.cx1 || y < this.cy0 || y >= this.cy1) return
    if (this.pat !== 0 && (this.pat >> (15 - ((y & 3) * 4 + (x & 3)))) & 1) {
      if (this.sec < 0) return
      c = this.sec
    }
    const i = SCREEN_ADDR + y * 64 + (x >> 1)
    const byte = this.d[i]
    this.d[i] = x & 1 ? (byte & 0x0f) | (c << 4) : (byte & 0xf0) | c
  }

  /** A horizontal run, both ends included. */
  #hline(/** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ y, /** @type {number} */ c) {
    if (y < this.cy0 || y >= this.cy1) return
    if (x0 > x1) [x0, x1] = [x1, x0]
    for (let x = Math.max(x0, this.cx0), end = Math.min(x1, this.cx1 - 1); x <= end; x++) this.#plot(x, y, c)
  }

  // ---- the screen -------------------------------------------------------------------------------
  /** @param {number} [c] */
  cls(c = 0) {
    const v = (flr(c) & 15) * 0x11
    this.d.fill(v, SCREEN_ADDR, SCREEN_ADDR + 0x2000)
    this.d[CURSOR] = 0
    this.d[CURSOR + 1] = 0
  }

  /** The colour at a screen pixel (the camera applies). @param {number} x @param {number} y */
  pget(x, y) {
    this.#state()
    return this.#screenAt(flr(x) - this.camX, flr(y) - this.camY)
  }

  /** @param {number} x @param {number} y */
  #screenAt(x, y) {
    if (x < 0 || x >= SCREEN_W || y < 0 || y >= SCREEN_H) return 0
    const byte = this.d[SCREEN_ADDR + y * 64 + (x >> 1)]
    return x & 1 ? byte >> 4 : byte & 15
  }

  /** @param {number} x @param {number} y @param {number} [c] */
  pset(x, y, c) {
    this.#state()
    const col = this.#pen(c)
    this.#plot(flr(x) - this.camX, flr(y) - this.camY, col)
  }

  /**
   * Scrolls the screen up by some rows, filling the bottom with colour 0.
   * @param {number} rows
   */
  scroll(rows) {
    const bytes = rows * 64
    this.d.copyWithin(SCREEN_ADDR, SCREEN_ADDR + bytes, SCREEN_ADDR + 0x2000)
    this.d.fill(0, SCREEN_ADDR + 0x2000 - bytes, SCREEN_ADDR + 0x2000)
  }

  // ---- shapes -----------------------------------------------------------------------------------
  /**
   * @param {number} x0
   * @param {number} y0
   * @param {number} [x1]  left out to continue from where the last line ended (then the third argument is the colour)
   * @param {number} [y1]
   * @param {number} [c]
   */
  line(x0, y0, x1, y1, c) {
    if (x1 === undefined || y1 === undefined) {
      // line(x, y [, c]): from where the last line ended
      c = x1
      x1 = x0
      y1 = y0
      x0 = this.lineEnd?.[0] ?? x1
      y0 = this.lineEnd?.[1] ?? y1
    }
    this.#state()
    const col = this.#pen(c)
    x0 = flr(x0)
    y0 = flr(y0)
    x1 = flr(x1)
    y1 = flr(y1)
    this.lineEnd = /** @type {[number, number]} */ ([x1, y1])
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    let x = x0
    let y = y0
    for (;;) {
      this.#plot(x - this.camX, y - this.camY, col)
      if (x === x1 && y === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }

  /** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} [c] */
  rect(x0, y0, x1, y1, c) {
    this.#state()
    const col = this.#pen(c)
    const [ax, bx] = [flr(Math.min(x0, x1)) - this.camX, flr(Math.max(x0, x1)) - this.camX]
    const [ay, by] = [flr(Math.min(y0, y1)) - this.camY, flr(Math.max(y0, y1)) - this.camY]
    this.#hline(ax, bx, ay, col)
    this.#hline(ax, bx, by, col)
    for (let y = ay + 1; y < by; y++) {
      this.#plot(ax, y, col)
      this.#plot(bx, y, col)
    }
  }

  /** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 @param {number} [c] */
  rectfill(x0, y0, x1, y1, c) {
    this.#state()
    const col = this.#pen(c)
    const [ax, bx] = [flr(Math.min(x0, x1)) - this.camX, flr(Math.max(x0, x1)) - this.camX]
    const [ay, by] = [flr(Math.min(y0, y1)) - this.camY, flr(Math.max(y0, y1)) - this.camY]
    for (let y = Math.max(ay, this.cy0); y <= Math.min(by, this.cy1 - 1); y++) this.#hline(ax, bx, y, col)
  }

  /** @param {number} x @param {number} y @param {number} r @param {number} [c] */
  circ(x, y, r, c) {
    this.#state()
    const col = this.#pen(c)
    r = flr(r)
    if (r < 0) return
    x = flr(x) - this.camX
    y = flr(y) - this.camY
    let px = r
    let py = 0
    let d = 1 - r
    while (px >= py) {
      for (const [ox, oy] of [[px, py], [py, px], [-px, py], [-py, px], [px, -py], [py, -px], [-px, -py], [-py, -px]]) {
        this.#plot(x + ox, y + oy, col)
      }
      py++
      if (d < 0) d += 2 * py + 1
      else {
        px--
        d += 2 * (py - px) + 1
      }
    }
  }

  /** @param {number} x @param {number} y @param {number} r @param {number} [c] */
  circfill(x, y, r, c) {
    this.#state()
    const col = this.#pen(c)
    r = flr(r)
    if (r < 0) return
    x = flr(x) - this.camX
    y = flr(y) - this.camY
    let px = r
    let py = 0
    let d = 1 - r
    while (px >= py) {
      this.#hline(x - px, x + px, y + py, col)
      this.#hline(x - px, x + px, y - py, col)
      this.#hline(x - py, x + py, y + px, col)
      this.#hline(x - py, x + py, y - px, col)
      py++
      if (d < 0) d += 2 * py + 1
      else {
        px--
        d += 2 * (py - px) + 1
      }
    }
  }

  // ---- sprites and the map ----------------------------------------------------------------------
  /** A pixel of the sprite sheet. @param {number} x @param {number} y */
  sget(x, y) {
    x = flr(x)
    y = flr(y)
    if (x < 0 || x >= 128 || y < 0 || y >= 128) return 0
    const byte = this.d[y * 64 + (x >> 1)]
    return x & 1 ? byte >> 4 : byte & 15
  }

  /** @param {number} x @param {number} y @param {number} c */
  sset(x, y, c) {
    x = flr(x)
    y = flr(y)
    if (x < 0 || x >= 128 || y < 0 || y >= 128) return
    const i = y * 64 + (x >> 1)
    const col = flr(c) & 15
    this.d[i] = x & 1 ? (this.d[i] & 0x0f) | (col << 4) : (this.d[i] & 0xf0) | col
  }

  /**
   * Copies a rectangle of the sprite sheet to the screen, stretched to the destination size.
   * @param {number} sx @param {number} sy @param {number} sw @param {number} sh  source rectangle
   * @param {number} dx @param {number} dy @param {number} dw @param {number} dh  destination, already moved by the camera
   * @param {boolean} flipX @param {boolean} flipY
   */
  #blit(sx, sy, sw, sh, dx, dy, dw, dh, flipX, flipY) {
    if (dw <= 0 || dh <= 0) return
    for (let j = 0; j < dh; j++) {
      const y = dy + j
      if (y < this.cy0 || y >= this.cy1) continue
      const srcY = sy + flr(((flipY ? dh - 1 - j : j) * sh) / dh)
      for (let i = 0; i < dw; i++) {
        const x = dx + i
        if (x < this.cx0 || x >= this.cx1) continue
        const srcX = sx + flr(((flipX ? dw - 1 - i : i) * sw) / dw)
        const mapped = this.d[PAL_DRAW + this.sget(srcX, srcY)]
        if (mapped & 0x10) continue
        this.#plot(x, y, mapped & 15)
      }
    }
  }

  /**
   * @param {number} n  sprite number
   * @param {number} x @param {number} y
   * @param {number} [w]  width in sprites (default 1)
   * @param {number} [h]
   * @param {boolean} [flipX]
   * @param {boolean} [flipY]
   */
  spr(n, x, y, w = 1, h = 1, flipX = false, flipY = false) {
    this.#state()
    n = flr(n) & 255
    this.#blit((n % 16) * 8, (n >> 4) * 8, flr(w * 8), flr(h * 8), flr(x) - this.camX, flr(y) - this.camY, flr(w * 8), flr(h * 8), flipX, flipY)
  }

  /**
   * @param {number} sx @param {number} sy @param {number} sw @param {number} sh
   * @param {number} dx @param {number} dy
   * @param {number} [dw]  default: the source width
   * @param {number} [dh]
   * @param {boolean} [flipX]
   * @param {boolean} [flipY]
   */
  sspr(sx, sy, sw, sh, dx, dy, dw = sw, dh = sh, flipX = false, flipY = false) {
    this.#state()
    this.#blit(flr(sx), flr(sy), flr(sw), flr(sh), flr(dx) - this.camX, flr(dy) - this.camY, flr(dw), flr(dh), flipX, flipY)
  }

  /** A tile of the map: rows 32..63 are stored in the lower half of the sprite sheet. @param {number} x @param {number} y */
  mget(x, y) {
    x = flr(x)
    y = flr(y)
    if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return 0
    return this.d[(y < 32 ? MAP_ADDR + y * MAP_W : MAP_SHARED + (y - 32) * MAP_W) + x]
  }

  /** @param {number} x @param {number} y @param {number} tile */
  mset(x, y, tile) {
    x = flr(x)
    y = flr(y)
    if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return
    this.d[(y < 32 ? MAP_ADDR + y * MAP_W : MAP_SHARED + (y - 32) * MAP_W) + x] = flr(tile) & 255
  }

  /**
   * Sprite flags: the whole byte, or whether one bit is set.
   * @param {number} n
   * @param {number} [bit]
   * @returns {number | boolean}
   */
  fget(n, bit) {
    const flags = this.d[FLAGS_ADDR + (flr(n) & 255)]
    return bit === undefined ? flags : ((flags >> (flr(bit) & 7)) & 1) === 1
  }

  /**
   * `fset(n, flags)` or `fset(n, bit, on)`.
   * @param {number} n
   * @param {number} bitOrFlags
   * @param {boolean} [on]
   */
  fset(n, bitOrFlags, on) {
    const i = FLAGS_ADDR + (flr(n) & 255)
    if (on === undefined) this.d[i] = flr(bitOrFlags) & 255
    else if (on) this.d[i] |= 1 << (flr(bitOrFlags) & 7)
    else this.d[i] &= ~(1 << (flr(bitOrFlags) & 7))
  }

  /**
   * Draws tiles of the map.
   * @param {number} [cellX]  first map column
   * @param {number} [cellY]
   * @param {number} [sx]  screen position of the first tile
   * @param {number} [sy]
   * @param {number} [cellW]  how many columns (default: to the edge of the map)
   * @param {number} [cellH]
   * @param {number} [layer]  only tiles whose sprite flags include all of these bits
   */
  map(cellX = 0, cellY = 0, sx = 0, sy = 0, cellW = MAP_W, cellH = MAP_H, layer = 0) {
    this.#state()
    cellX = flr(cellX)
    cellY = flr(cellY)
    const ox = flr(sx) - this.camX
    const oy = flr(sy) - this.camY
    layer = flr(layer) & 255
    for (let j = 0; j < flr(cellH); j++) {
      const y = oy + j * 8
      if (y + 8 <= this.cy0 || y >= this.cy1) continue
      for (let i = 0; i < flr(cellW); i++) {
        const x = ox + i * 8
        if (x + 8 <= this.cx0 || x >= this.cx1) continue
        const tile = this.mget(cellX + i, cellY + j)
        if (tile === 0) continue
        if (layer && (this.d[FLAGS_ADDR + tile] & layer) !== layer) continue
        this.#blit((tile % 16) * 8, (tile >> 4) * 8, 8, 8, x, y, 8, 8, false, false)
      }
    }
  }

  // ---- text -------------------------------------------------------------------------------------
  /**
   * Prints text. Without a position it continues at the cursor, scrolling the screen when the
   * text would run off the bottom; with one it prints there.
   * @param {string} text
   * @param {number} [x]
   * @param {number} [y]
   * @param {number} [c]
   * @returns {number} the x position after the last character
   */
  print(text, x, y, c) {
    this.#state()
    const col = this.#pen(c)
    this.pat = 0
    const d = this.d
    const auto = x === undefined || y === undefined
    let left = auto ? d[CURSOR] : flr(/** @type {number} */ (x))
    let top = auto ? d[CURSOR + 1] : flr(/** @type {number} */ (y))
    if (auto && top > SCREEN_H - LINE_H) {
      this.scroll(top - (SCREEN_H - LINE_H))
      top = SCREEN_H - LINE_H
    }
    let px = left
    let py = top
    for (const ch of text) {
      if (ch === '\n') {
        px = left
        py += LINE_H
        continue
      }
      const rows = glyphRows(ch)
      for (let j = 0; j < 5; j++) {
        for (let i = 0; i < 3; i++) {
          if ((rows[j] >> (2 - i)) & 1) this.#plot(px + i - this.camX, py + j - this.camY, col)
        }
      }
      px += charWidth(ch)
    }
    d[CURSOR] = clamp(left, 0, 255)
    d[CURSOR + 1] = clamp(py + LINE_H, 0, 255)
    return px
  }

  // ---- state ------------------------------------------------------------------------------------
  /** @param {number} [c] */
  color(c = 6) {
    this.d[PEN] = flr(c) & 0xff
  }

  /**
   * Sets the fill pattern of shapes: 16 bits for a 4x4 block (the top left is the highest), where a
   * set bit draws the high nibble of the colour and a clear one the low. The fraction adds flags: .5
   * makes the high colour see-through (.25 and .125, for sprites, are kept but not used).
   * @param {number} [p]
   * @returns {number} the previous setting
   */
  fillp(p = 0) {
    const d = this.d
    const old = d[FILL] | (d[FILL + 1] << 8)
    const oldFlags = d[FILL + 2] & 7
    const whole = flr(p)
    const f = Math.round((p - whole) * 8) & 7
    d[FILL] = whole & 255
    d[FILL + 1] = (whole >> 8) & 255
    d[FILL + 2] = ((f >> 2) & 1) | (f & 2) | ((f & 1) << 2)
    const back = ((oldFlags & 1) << 2) | (oldFlags & 2) | ((oldFlags >> 2) & 1)
    return (old >= 0x8000 ? old - 0x10000 : old) + back / 8
  }

  /** @param {number} [x] @param {number} [y] @param {number} [c] */
  cursor(x = 0, y = 0, c) {
    this.d[CURSOR] = clamp(flr(x), 0, 255)
    this.d[CURSOR + 1] = clamp(flr(y), 0, 255)
    if (c !== undefined) this.d[PEN] = flr(c) & 0xff
  }

  /** @param {number} [x] @param {number} [y] */
  camera(x = 0, y = 0) {
    x = flr(x)
    y = flr(y)
    this.d[CAMERA] = x & 255
    this.d[CAMERA + 1] = (x >> 8) & 255
    this.d[CAMERA + 2] = y & 255
    this.d[CAMERA + 3] = (y >> 8) & 255
  }

  /**
   * Limits drawing to a rectangle; no arguments lift the limit.
   * @param {number} [x] @param {number} [y] @param {number} [w] @param {number} [h]
   */
  clip(x, y, w, h) {
    const d = this.d
    if (x === undefined || y === undefined || w === undefined || h === undefined) {
      d[CLIP] = 0
      d[CLIP + 1] = 0
      d[CLIP + 2] = SCREEN_W
      d[CLIP + 3] = SCREEN_H
      return
    }
    d[CLIP] = clamp(flr(x), 0, SCREEN_W)
    d[CLIP + 1] = clamp(flr(y), 0, SCREEN_H)
    d[CLIP + 2] = clamp(flr(x) + flr(w), 0, SCREEN_W)
    d[CLIP + 3] = clamp(flr(y) + flr(h), 0, SCREEN_H)
  }

  /**
   * `pal()` resets; `pal(a, b)` draws colour a as b; with `onScreen` the change applies when the
   * frame is shown instead (so it also affects what was drawn before).
   * @param {number} [a] @param {number} [b] @param {number} [onScreen]
   */
  pal(a, b, onScreen = 0) {
    if (a === undefined) {
      this.resetPalette()
      return
    }
    if (b === undefined) return
    const from = flr(a) & 15
    if (flr(onScreen) === 1) this.d[PAL_SCREEN + from] = flr(b) & 0xff
    else this.d[PAL_DRAW + from] = (this.d[PAL_DRAW + from] & 0x10) | (flr(b) & 15)
  }

  /**
   * Which colours count as see-through for sprites. `palt()` resets to colour 0 only; `palt(c, on)`
   * changes one colour; `palt(mask)` sets all sixteen (colour 0 is the highest of the 16 bits).
   * @param {number} [c] @param {boolean} [on]
   */
  palt(c, on) {
    const d = this.d
    if (c === undefined) {
      for (let i = 0; i < 16; i++) d[PAL_DRAW + i] = (d[PAL_DRAW + i] & 15) | (i === 0 ? 0x10 : 0)
    } else if (on === undefined) {
      const mask = flr(c) & 0xffff
      for (let i = 0; i < 16; i++) d[PAL_DRAW + i] = (d[PAL_DRAW + i] & 15) | ((mask >> (15 - i)) & 1 ? 0x10 : 0)
    } else {
      const i = flr(c) & 15
      d[PAL_DRAW + i] = (d[PAL_DRAW + i] & 15) | (on ? 0x10 : 0)
    }
  }

  // ---- showing the screen -----------------------------------------------------------------------
  /**
   * The screen as one palette index per pixel (secret colours are 16..31), through the screen palette.
   * @param {Uint8Array} [out]
   * @returns {Uint8Array}
   */
  indices(out = new Uint8Array(SCREEN_W * SCREEN_H)) {
    const d = this.d
    /** @type {number[]} */
    const lookup = []
    for (let c = 0; c < 16; c++) {
      const v = d[PAL_SCREEN + c]
      lookup.push(v >= 128 ? 16 + (v & 15) : v & 15)
    }
    for (let i = 0; i < SCREEN_W * SCREEN_H / 2; i++) {
      const byte = d[SCREEN_ADDR + i]
      out[i * 2] = lookup[byte & 15]
      out[i * 2 + 1] = lookup[byte >> 4]
    }
    return out
  }
}
