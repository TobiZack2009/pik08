import { beforeEach, describe, expect, it } from 'vitest'
import { glyphRows, charWidth, textWidth, CHAR_W, LINE_H } from '../../src/player/font.js'
import { Graphics, SCREEN_ADDR } from '../../src/player/graphics.js'

/** @type {Uint8Array} */
let data
/** @type {Graphics} */
let g

beforeEach(() => {
  data = new Uint8Array(0x8000)
  g = new Graphics(data)
})

/** The colour of every pixel in a row range, as a string of hex digits. @param {number} y @param {number} [x0] @param {number} [x1] */
const row = (y, x0 = 0, x1 = 16) => {
  let s = ''
  for (let x = x0; x < x1; x++) s += g.pget(x, y).toString(16)
  return s
}

describe('font', () => {
  it('has a glyph of five rows for every printable character', () => {
    for (const ch of 'AZaz09 !~') expect(glyphRows(ch)).toHaveLength(5)
  })

  it('treats lowercase like capitals', () => {
    expect(glyphRows('a')).toEqual(glyphRows('A'))
  })

  it('measures text', () => {
    expect(CHAR_W).toBe(4)
    expect(LINE_H).toBe(6)
    expect(textWidth('abc')).toBe(12)
    expect(charWidth('\u{80}')).toBe(8)
  })
})

describe('Graphics state', () => {
  it('starts with identity palettes, no clip and pen 6', () => {
    expect(data[0x5f00]).toBe(0x10) // colour 0 is transparent
    expect(data[0x5f00 + 5]).toBe(5)
    expect(data[0x5f10 + 9]).toBe(9)
    expect(data[0x5f25]).toBe(6)
    expect([data[0x5f20], data[0x5f21], data[0x5f22], data[0x5f23]]).toEqual([0, 0, 128, 128])
  })
})

describe('pixels', () => {
  it('sets and reads pixels, even and odd columns alike', () => {
    g.pset(0, 0, 3)
    g.pset(1, 0, 9)
    g.pset(127, 127, 12)
    expect(g.pget(0, 0)).toBe(3)
    expect(g.pget(1, 0)).toBe(9)
    expect(g.pget(127, 127)).toBe(12)
    expect(data[SCREEN_ADDR]).toBe(0x93)
  })

  it('remembers the pen', () => {
    g.pset(0, 0, 8)
    g.pset(1, 0)
    expect(g.pget(1, 0)).toBe(8)
  })

  it('ignores positions off the screen', () => {
    g.pset(-1, 0, 7)
    g.pset(128, 0, 7)
    g.pset(0, 128, 7)
    expect(data.slice(SCREEN_ADDR).every((b) => b === 0)).toBe(true)
  })

  it('floors positions', () => {
    g.pset(2.9, 1.2, 4)
    expect(g.pget(2, 1)).toBe(4)
  })

  it('clears the screen and puts the cursor home', () => {
    g.cursor(30, 40)
    g.cls(5)
    expect(g.pget(64, 64)).toBe(5)
    expect(data[0x5f26]).toBe(0)
    expect(data[0x5f27]).toBe(0)
  })
})

describe('clip and camera', () => {
  it('limits drawing to the clip rectangle', () => {
    g.clip(2, 2, 4, 4)
    g.rectfill(0, 0, 10, 10, 7)
    expect(row(1, 0, 8)).toBe('00000000')
    expect(row(2, 0, 8)).toBe('00777700')
    expect(row(5, 0, 8)).toBe('00777700')
    expect(row(6, 0, 8)).toBe('00000000')
  })

  it('lifts the clip with no arguments', () => {
    g.clip(0, 0, 1, 1)
    g.clip()
    g.pset(50, 50, 7)
    expect(g.pget(50, 50)).toBe(7)
  })

  it('moves everything by the camera', () => {
    g.camera(10, 20)
    g.pset(10, 20, 7)
    g.camera()
    expect(g.pget(0, 0)).toBe(7)
  })

  it('keeps a negative camera', () => {
    g.camera(-5, -5)
    g.pset(0, 0, 7)
    g.camera()
    expect(g.pget(5, 5)).toBe(7)
  })
})

describe('shapes', () => {
  it('draws lines in both directions', () => {
    g.line(0, 0, 5, 0, 7)
    g.line(5, 2, 0, 2, 8)
    expect(row(0, 0, 8)).toBe('77777700')
    expect(row(2, 0, 8)).toBe('88888800')
  })

  it('draws a diagonal', () => {
    g.line(0, 0, 3, 3, 7)
    for (let i = 0; i <= 3; i++) expect(g.pget(i, i)).toBe(7)
  })

  it('continues a line from where the last one ended', () => {
    g.line(0, 0, 4, 0, 7)
    g.line(4, 3, 9)
    expect(g.pget(4, 1)).toBe(9)
    expect(g.pget(4, 2)).toBe(9)
    expect(g.pget(4, 3)).toBe(9)
  })

  it('draws a rectangle outline and a filled one', () => {
    g.rect(1, 1, 4, 4, 7)
    expect(row(1, 0, 6)).toBe('077770')
    expect(row(2, 0, 6)).toBe('070070')
    g.rectfill(10, 1, 13, 4, 8)
    expect(row(2, 9, 15)).toBe('088880')
  })

  it('accepts the corners in any order', () => {
    g.rectfill(4, 4, 1, 1, 7)
    expect(g.pget(1, 1)).toBe(7)
    expect(g.pget(4, 4)).toBe(7)
  })

  it('draws circles', () => {
    g.circ(64, 64, 3, 7)
    expect(g.pget(67, 64)).toBe(7)
    expect(g.pget(61, 64)).toBe(7)
    expect(g.pget(64, 67)).toBe(7)
    expect(g.pget(64, 61)).toBe(7)
    expect(g.pget(64, 64)).toBe(0)
    g.circfill(20, 20, 3, 8)
    expect(g.pget(20, 20)).toBe(8)
    expect(g.pget(23, 20)).toBe(8)
    expect(g.pget(24, 20)).toBe(0)
  })

  it('draws nothing for a negative radius', () => {
    g.circfill(20, 20, -1, 8)
    expect(g.pget(20, 20)).toBe(0)
  })

  it('goes through the draw palette', () => {
    g.pal(7, 8)
    g.pset(0, 0, 7)
    expect(g.pget(0, 0)).toBe(8)
    g.pal()
    g.pset(1, 0, 7)
    expect(g.pget(1, 0)).toBe(7)
  })
})

describe('sprites', () => {
  beforeEach(() => {
    // sprite 1 is the second 8x8 cell of the first row: a 5 at its (1, 0) and a 6 at its (7, 7)
    g.sset(9, 0, 5)
    g.sset(15, 7, 6)
  })

  it('reads and writes the sprite sheet', () => {
    expect(g.sget(9, 0)).toBe(5)
    expect(g.sget(15, 7)).toBe(6)
    expect(g.sget(200, 0)).toBe(0)
  })

  it('draws a sprite, leaving colour 0 see-through', () => {
    g.cls(1)
    g.spr(1, 10, 10)
    expect(g.pget(10, 10)).toBe(1)
    expect(g.pget(11, 10)).toBe(5)
    expect(g.pget(17, 17)).toBe(6)
  })

  it('flips', () => {
    g.spr(1, 0, 0, 1, 1, true, false)
    expect(g.pget(6, 0)).toBe(5)
    g.cls()
    g.spr(1, 0, 0, 1, 1, false, true)
    expect(g.pget(1, 7)).toBe(5)
  })

  it('draws several sprites at once', () => {
    g.spr(0, 0, 0, 2, 1)
    expect(g.pget(9, 0)).toBe(5)
  })

  it('makes other colours see-through with palt', () => {
    g.cls(1)
    g.palt(5, true)
    g.spr(1, 0, 0)
    expect(g.pget(1, 0)).toBe(1)
    g.palt()
    g.spr(1, 0, 0)
    expect(g.pget(1, 0)).toBe(5)
  })

  it('takes a bit mask in palt', () => {
    g.palt(0) // nothing is see-through
    g.cls(1)
    g.spr(1, 0, 0)
    expect(g.pget(0, 0)).toBe(0)
    g.palt(0x8000) // colour 0 is
    g.cls(1)
    g.spr(1, 0, 0)
    expect(g.pget(0, 0)).toBe(1)
  })

  it('remaps colours when drawing', () => {
    g.pal(5, 12)
    g.spr(1, 0, 0)
    expect(g.pget(1, 0)).toBe(12)
  })

  it('stretches with sspr', () => {
    g.sspr(8, 0, 8, 8, 0, 0, 16, 16)
    expect(row(0, 0, 4)).toBe('0055')
    expect(g.pget(2, 1)).toBe(5)
  })

  it('moves sprites with the camera and respects the clip', () => {
    g.camera(1, 0)
    g.spr(1, 1, 0)
    g.camera()
    expect(g.pget(1, 0)).toBe(5)
    g.cls()
    g.clip(0, 0, 1, 8)
    g.spr(1, 0, 0)
    expect(g.pget(1, 0)).toBe(0)
  })
})

describe('map and flags', () => {
  it('stores the lower half of the map in the sprite sheet', () => {
    g.mset(3, 5, 9)
    g.mset(3, 40, 7)
    expect(data[0x2000 + 5 * 128 + 3]).toBe(9)
    expect(data[0x1000 + 8 * 128 + 3]).toBe(7)
    expect(g.mget(3, 5)).toBe(9)
    expect(g.mget(3, 40)).toBe(7)
    expect(g.mget(-1, 0)).toBe(0)
    expect(g.mget(0, 64)).toBe(0)
  })

  it('reads and writes flags', () => {
    g.fset(4, 0xa0)
    expect(g.fget(4)).toBe(0xa0)
    expect(g.fget(4, 5)).toBe(true)
    expect(g.fget(4, 4)).toBe(false)
    g.fset(4, 1, true)
    g.fset(4, 5, false)
    expect(g.fget(4)).toBe(0x82)
  })

  it('draws tiles, skipping tile 0', () => {
    g.sset(8, 0, 5) // tile 1: its first pixel
    g.sset(16, 0, 6) // tile 2: its first pixel
    g.mset(0, 0, 1)
    g.mset(1, 0, 2)
    g.mset(2, 0, 0)
    g.map(0, 0, 0, 0, 3, 1)
    expect(g.pget(0, 0)).toBe(5)
    expect(g.pget(8, 0)).toBe(6)
    expect(g.pget(16, 0)).toBe(0)
  })

  it('draws a part of the map somewhere else', () => {
    g.sset(8, 0, 5)
    g.mset(10, 3, 1)
    g.map(10, 3, 40, 50, 1, 1)
    expect(g.pget(40, 50)).toBe(5)
  })

  it('only draws tiles with the layer flags', () => {
    g.sset(8, 0, 5)
    g.sset(16, 0, 6)
    g.mset(0, 0, 1)
    g.mset(1, 0, 2)
    g.fset(2, 0x2)
    g.map(0, 0, 0, 0, 2, 1, 2)
    expect(g.pget(0, 0)).toBe(0)
    expect(g.pget(8, 0)).toBe(6)
  })
})

describe('print', () => {
  it('draws text and returns where it ended', () => {
    const end = g.print('AB', 10, 10, 7)
    expect(end).toBe(18)
    let lit = 0
    for (let y = 10; y < 15; y++) for (let x = 10; x < 18; x++) if (g.pget(x, y) === 7) lit++
    expect(lit).toBeGreaterThan(8)
    // the column between the letters stays empty
    for (let y = 10; y < 15; y++) expect(g.pget(13, y)).toBe(0)
  })

  it('continues at the cursor and moves down a line', () => {
    g.cursor(4, 8)
    g.print('A', undefined, undefined, 7)
    expect(data[0x5f26]).toBe(4)
    expect(data[0x5f27]).toBe(8 + LINE_H)
  })

  it('scrolls when the cursor is at the bottom', () => {
    g.rectfill(0, 127, 127, 127, 9)
    g.cursor(0, 126)
    g.print('A', undefined, undefined, 7)
    // the old last row moved up by (126 - 122) = 4 rows
    expect(g.pget(100, 123)).toBe(9)
    expect(g.pget(100, 127)).toBe(0)
    expect(data[0x5f27]).toBe(128)
  })

  it('breaks lines at a newline', () => {
    g.print('A\nA', 0, 0, 7)
    let lit = 0
    for (let y = 6; y < 11; y++) for (let x = 0; x < 3; x++) if (g.pget(x, y) === 7) lit++
    expect(lit).toBeGreaterThan(0)
  })

  it('uses and sets the pen', () => {
    g.color(11)
    g.print('I', 0, 0)
    let found = false
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (g.pget(x, y) === 11) found = true
    expect(found).toBe(true)
  })
})

describe('indices', () => {
  it('lists the palette index of every pixel', () => {
    g.pset(0, 0, 3)
    g.pset(1, 0, 9)
    const out = g.indices()
    expect(out).toHaveLength(128 * 128)
    expect(out[0]).toBe(3)
    expect(out[1]).toBe(9)
    expect(out[2]).toBe(0)
  })

  it('goes through the screen palette, including the secret colours', () => {
    g.cls(5)
    g.pal(5, 7, 1)
    expect(g.indices()[0]).toBe(7)
    g.pal(5, 128 + 3, 1)
    expect(g.indices()[0]).toBe(16 + 3)
  })

  it('writes into a given array', () => {
    const out = new Uint8Array(128 * 128)
    expect(g.indices(out)).toBe(out)
  })
})
