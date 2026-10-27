import { describe, expect, it } from 'vitest'
import { P8SCII_TABLE } from '../../src/formats/p8scii-table.js'
import { OffsetMap, fromDisplay, toDisplay } from '../../src/ui/editors/code/p8scii-view.js'

const wideByte = P8SCII_TABLE.findIndex((ch) => ch.length > 1)

describe('p8scii-view', () => {
  it('leaves plain ASCII, newlines and tabs alone', () => {
    const src = 'x = 1\n\tprint("hi")'
    expect(toDisplay(src)).toBe(src)
  })

  it('shows high bytes as their glyphs and converts back', () => {
    const src = 'if btn(' + String.fromCharCode(0x8b) + ') then'
    const shown = toDisplay(src)
    expect(shown).not.toBe(src)
    expect(shown).toContain(P8SCII_TABLE[0x8b])
    expect(fromDisplay(shown)).toBe(src)
  })

  it('round-trips every glyph byte', () => {
    let all = ''
    for (let b = 0x80; b < 0x100; b++) all += String.fromCharCode(b)
    expect(fromDisplay(toDisplay(all))).toBe(all)
  })

  it('has some glyphs that take two UTF-16 units', () => {
    expect(wideByte).toBeGreaterThan(0)
    expect(toDisplay(String.fromCharCode(wideByte)).length).toBe(2)
  })
})

describe('OffsetMap', () => {
  const w = String.fromCharCode(wideByte)
  const src = `a${w}b${w}${w}c`
  const shown = toDisplay(src)

  it('is the identity without wide glyphs', () => {
    const map = new OffsetMap('abc')
    expect(map.toDisplay(2)).toBe(2)
    expect(map.toP8(2)).toBe(2)
  })

  it('shifts offsets past each wide glyph', () => {
    const map = new OffsetMap(src)
    expect(shown.length).toBe(src.length + 3)
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => map.toDisplay(i))).toEqual([0, 1, 3, 4, 6, 8, 9])
  })

  it('maps display offsets back, rounding down inside a pair', () => {
    const map = new OffsetMap(src)
    for (let i = 0; i <= src.length; i++) expect(map.toP8(map.toDisplay(i))).toBe(i)
    expect(map.toP8(2)).toBe(1) // the middle of the first wide glyph
    expect(map.toP8(7)).toBe(4)
  })
})
