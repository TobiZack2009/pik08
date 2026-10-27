// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { indexedToRgba } from '../../src/player/renderer.js'

describe('indexedToRgba', () => {
  const palette = [0x000000, 0xff0000, 0x00ff80]

  it('expands indices to opaque RGBA', () => {
    const out = indexedToRgba([0, 1, 2], palette)
    expect(Array.from(out)).toEqual([0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 128, 255])
  })

  it('treats unknown indices as black', () => {
    expect(Array.from(indexedToRgba([9], palette))).toEqual([0, 0, 0, 255])
  })

  it('writes into a given buffer', () => {
    const buf = new Uint8ClampedArray(8)
    const out = indexedToRgba([1, 2], palette, buf)
    expect(out).toBe(buf)
    expect(buf[0]).toBe(255)
    expect(buf[5]).toBe(255)
  })
})
