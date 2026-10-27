import { describe, expect, it } from 'vitest'
import { RegionHistory } from '../../src/ui/history.js'

function setup() {
  const a = new Uint8Array(8)
  const b = new Uint8Array(4)
  return { a, b, h: new RegionHistory(() => [a, b]) }
}

describe('RegionHistory', () => {
  it('records nothing when nothing changed', () => {
    const { h } = setup()
    h.begin()
    expect(h.commit()).toBe(false)
    expect(h.canUndo).toBe(false)
  })

  it('undoes and redoes a gesture across regions', () => {
    const { a, b, h } = setup()
    h.begin()
    a[1] = 5
    a[2] = 6
    b[0] = 9
    expect(h.commit()).toBe(true)
    expect(h.undo()).toBe(true)
    expect([...a]).toEqual(new Array(8).fill(0))
    expect([...b]).toEqual(new Array(4).fill(0))
    expect(a[1]).toBe(0)
    expect(b[0]).toBe(0)
    expect(h.canRedo).toBe(true)
    expect(h.redo()).toBe(true)
    expect([a[1], a[2], b[0]]).toEqual([5, 6, 9])
  })

  it('undoes in reverse order and clears redo on a new edit', () => {
    const { a, h } = setup()
    h.edit(() => (a[0] = 1))
    h.edit(() => (a[0] = 2))
    h.undo()
    expect(a[0]).toBe(1)
    h.edit(() => (a[0] = 3))
    expect(h.canRedo).toBe(false)
    h.undo()
    h.undo()
    expect(a[0]).toBe(0)
    expect(h.undo()).toBe(false)
  })

  it('cancel restores the bytes', () => {
    const { a, h } = setup()
    a[3] = 7
    h.begin()
    a[3] = 8
    a[4] = 1
    h.cancel()
    expect([a[3], a[4]]).toEqual([7, 0])
    expect(h.canUndo).toBe(false)
  })

  it('keeps at most `limit` entries', () => {
    const a = new Uint8Array(2)
    const h = new RegionHistory(() => [a], 3)
    for (let i = 1; i <= 5; i++) h.edit(() => (a[0] = i))
    let n = 0
    while (h.undo()) n++
    expect(n).toBe(3)
    expect(a[0]).toBe(2)
  })

  it('follows the regions it is given at the time of use', () => {
    let region = new Uint8Array(4)
    const h = new RegionHistory(() => [region])
    h.edit(() => (region[0] = 4))
    region = new Uint8Array(4).fill(0)
    region[0] = 4
    h.undo()
    expect(region[0]).toBe(0)
  })
})
