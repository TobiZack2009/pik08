import { describe, expect, it } from 'vitest'
import {
  GUTTER,
  PITCHES,
  RULER,
  STEPS,
  applyToRange,
  clearLoop,
  clearRange,
  copyRange,
  eraseStep,
  gridPoint,
  laneHit,
  lanesLayout,
  layoutFor,
  loopSteps,
  noteExtent,
  normRange,
  pasteNotes,
  rangeHasNotes,
  rulerStep,
  setLoopToRange,
  setNote,
  shiftRange,
  strokeSteps,
  transpose,
} from '../../src/ui/editors/sound/roll-ops.js'
import { readHeader, readNote } from '../../src/ui/editors/sfx/sfx-data.js'
import { regions } from '../audio/helpers.js'

const note = (/** @type {number} */ pitch, wave = 0, vol = 5, fx = 0) => ({ pitch, wave, vol, fx })

function sfxWith(/** @type {Record<number, ReturnType<typeof note>>} */ notes) {
  const { sfx } = regions()
  for (const [step, n] of Object.entries(notes)) setNote(sfx, 3, Number(step), n)
  return sfx
}

describe('layout', () => {
  it('sizes the canvas from the zoom, and clamps the zoom', () => {
    const l = layoutFor(1)
    expect(l.width).toBe(GUTTER + l.cellW * STEPS)
    expect(l.height).toBe(RULER + l.cellH * PITCHES)
    expect(layoutFor(-5)).toEqual(layoutFor(0))
    expect(layoutFor(99)).toEqual(layoutFor(2))
  })

  it('finds the step and pitch under a point, with pitch 63 on the top row', () => {
    const l = layoutFor(1)
    expect(gridPoint(l, GUTTER + 1, RULER + 1)).toEqual({ step: 0, pitch: 63 })
    expect(gridPoint(l, l.width - 1, l.height - 1)).toEqual({ step: 31, pitch: 0 })
    expect(gridPoint(l, GUTTER + l.cellW * 3 + 2, RULER + l.cellH * 10 + 2)).toEqual({ step: 3, pitch: 53 })
  })

  it('returns null outside the grid, or clamps when asked to', () => {
    const l = layoutFor(1)
    expect(gridPoint(l, GUTTER - 1, RULER + 5)).toBeNull()
    expect(gridPoint(l, GUTTER + 5, RULER - 1)).toBeNull()
    expect(gridPoint(l, l.width, RULER + 5)).toBeNull()
    expect(gridPoint(l, -50, -50, true)).toEqual({ step: 0, pitch: 63 })
    expect(gridPoint(l, 9999, 9999, true)).toEqual({ step: 31, pitch: 0 })
  })

  it('finds the step on the ruler', () => {
    const l = layoutFor(1)
    expect(rulerStep(l, GUTTER + l.cellW * 2 + 1, 3)).toBe(2)
    expect(rulerStep(l, GUTTER + 1, RULER)).toBeNull()
    expect(rulerStep(l, 2, 3)).toBeNull()
  })

  it('finds the lane under a point, and a volume from its height', () => {
    const l = layoutFor(1)
    const lanes = lanesLayout(l)
    const x = GUTTER + l.cellW * 4 + 1
    expect(laneHit(l, x, lanes.vol.y)).toEqual({ lane: 'vol', step: 4, value: 7 })
    expect(laneHit(l, x, lanes.vol.y + lanes.vol.h - 1)).toMatchObject({ lane: 'vol', value: 0 })
    expect(laneHit(l, x, lanes.wave.y + 1)).toMatchObject({ lane: 'wave', step: 4 })
    expect(laneHit(l, x, lanes.fx.y + 1)).toMatchObject({ lane: 'fx', step: 4 })
    // the gap between lanes and the gutter hit nothing
    expect(laneHit(l, x, lanes.vol.h)).toBeNull()
    expect(laneHit(l, 2, lanes.vol.y + 1)).toBeNull()
    expect(laneHit(l, x, lanes.height)).toBeNull()
  })

  it('volume values rise from the bottom of the lane to the top', () => {
    const l = layoutFor(1)
    const { vol } = lanesLayout(l)
    const x = GUTTER + 1
    let last = -1
    for (let y = vol.y + vol.h - 1; y >= vol.y; y--) {
      const v = laneHit(l, x, y)?.value ?? -1
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
    expect(last).toBe(7)
  })
})

describe('strokeSteps', () => {
  it('is a single cell for a click', () => {
    expect(strokeSteps({ step: 4, pitch: 30 }, { step: 4, pitch: 30 })).toEqual([{ step: 4, pitch: 30 }])
  })

  it('covers every step between two points, interpolating pitch', () => {
    const cells = strokeSteps({ step: 2, pitch: 10 }, { step: 6, pitch: 18 })
    expect(cells.map((c) => c.step)).toEqual([2, 3, 4, 5, 6])
    expect(cells.map((c) => c.pitch)).toEqual([10, 12, 14, 16, 18])
  })

  it('works right to left', () => {
    const cells = strokeSteps({ step: 6, pitch: 18 }, { step: 4, pitch: 10 })
    expect(cells).toEqual([
      { step: 6, pitch: 18 },
      { step: 5, pitch: 14 },
      { step: 4, pitch: 10 },
    ])
  })

  it('keeps a vertical move on one step, at its final pitch', () => {
    expect(strokeSteps({ step: 4, pitch: 10 }, { step: 4, pitch: 40 })).toEqual([{ step: 4, pitch: 40 }])
  })
})

describe('normRange', () => {
  it('orders and clamps', () => {
    expect(normRange(5, 2)).toEqual([2, 5])
    expect(normRange(-3, 40)).toEqual([0, 31])
    expect(normRange(7, 7)).toEqual([7, 7])
  })
})

describe('setNote and eraseStep', () => {
  it('writes a note and reports whether it changed anything', () => {
    const { sfx } = regions()
    expect(setNote(sfx, 3, 5, note(30, 2, 6, 1))).toBe(true)
    expect(readNote(sfx, 3, 5)).toEqual(note(30, 2, 6, 1))
    expect(setNote(sfx, 3, 5, note(30, 2, 6, 1))).toBe(false)
  })

  it('ignores steps off the sfx', () => {
    const { sfx } = regions()
    expect(setNote(sfx, 3, 32, note(30))).toBe(false)
    expect(setNote(sfx, 3, -1, note(30))).toBe(false)
    expect(sfx.every((b) => b === 0)).toBe(true)
  })

  it('erases back to all-zero bytes', () => {
    const { sfx } = regions()
    setNote(sfx, 3, 5, note(30, 9, 6, 3))
    expect(eraseStep(sfx, 3, 5)).toBe(true)
    expect(sfx.every((b) => b === 0)).toBe(true)
    expect(eraseStep(sfx, 3, 5)).toBe(false)
  })

  it('keeps custom instruments (waves 8-15)', () => {
    const { sfx } = regions()
    setNote(sfx, 0, 0, note(12, 13, 4))
    expect(readNote(sfx, 0, 0).wave).toBe(13)
  })
})

describe('extent and presence', () => {
  it('finds the first and last note', () => {
    expect(noteExtent(sfxWith({}), 3)).toBeNull()
    const sfx = sfxWith({ 4: note(10), 9: note(12), 20: note(0, 0, 0, 0) })
    expect(noteExtent(sfx, 3)).toEqual([4, 9])
  })

  it('counts a hollow (silent) note as a note', () => {
    const sfx = sfxWith({ 2: note(20, 0, 0) })
    expect(noteExtent(sfx, 3)).toEqual([2, 2])
    expect(rangeHasNotes(sfx, 3, 0, 5)).toBe(true)
    expect(rangeHasNotes(sfx, 3, 3, 5)).toBe(false)
  })
})

describe('transpose', () => {
  it('moves notes, leaving empty steps empty', () => {
    const sfx = sfxWith({ 1: note(10), 2: note(20) })
    expect(transpose(sfx, 3, 0, 3, 12)).toBe(true)
    expect(readNote(sfx, 3, 1).pitch).toBe(22)
    expect(readNote(sfx, 3, 2).pitch).toBe(32)
    expect(readNote(sfx, 3, 0)).toEqual(note(0, 0, 0))
  })

  it('clamps to the pitch range', () => {
    const sfx = sfxWith({ 0: note(60), 1: note(3) })
    transpose(sfx, 3, 0, 1, 12)
    expect(readNote(sfx, 3, 0).pitch).toBe(63)
    transpose(sfx, 3, 0, 1, -100)
    expect(readNote(sfx, 3, 0).pitch).toBe(0)
  })

  it('only touches the range', () => {
    const sfx = sfxWith({ 1: note(10), 5: note(10) })
    transpose(sfx, 3, 0, 2, 1)
    expect(readNote(sfx, 3, 1).pitch).toBe(11)
    expect(readNote(sfx, 3, 5).pitch).toBe(10)
  })

  it('reports no change when nothing moved', () => {
    const sfx = sfxWith({ 1: note(63) })
    expect(transpose(sfx, 3, 0, 3, 5)).toBe(false)
    expect(transpose(sfxWith({}), 3, 0, 31, 5)).toBe(false)
  })
})

describe('applyToRange', () => {
  it('sets only the given properties on existing notes', () => {
    const sfx = sfxWith({ 1: note(10, 1, 3, 2), 2: note(14, 1, 3, 2) })
    expect(applyToRange(sfx, 3, 0, 5, { vol: 7, wave: 5 })).toBe(true)
    expect(readNote(sfx, 3, 1)).toEqual(note(10, 5, 7, 2))
    expect(readNote(sfx, 3, 2)).toEqual(note(14, 5, 7, 2))
    expect(readNote(sfx, 3, 0)).toEqual(note(0, 0, 0))
  })

  it('reports no change when everything already matches', () => {
    const sfx = sfxWith({ 1: note(10, 1, 3, 2) })
    expect(applyToRange(sfx, 3, 0, 5, { vol: 3 })).toBe(false)
  })
})

describe('clear, copy and paste', () => {
  it('clears a range', () => {
    const sfx = sfxWith({ 1: note(10), 2: note(11), 3: note(12) })
    expect(clearRange(sfx, 3, 1, 2)).toBe(true)
    expect(noteExtent(sfx, 3)).toEqual([3, 3])
    expect(clearRange(sfx, 3, 1, 2)).toBe(false)
  })

  it('copies empty steps too, so the rhythm survives', () => {
    const sfx = sfxWith({ 1: note(10), 3: note(12) })
    const clip = copyRange(sfx, 3, 1, 3)
    expect(clip).toHaveLength(3)
    expect(clip[1]).toEqual(note(0, 0, 0))
    pasteNotes(sfx, 3, 10, clip)
    expect(readNote(sfx, 3, 10)).toEqual(note(10))
    expect(readNote(sfx, 3, 12)).toEqual(note(12))
    expect(readNote(sfx, 3, 11)).toEqual(note(0, 0, 0))
  })

  it('paste overwrites what is under it', () => {
    const sfx = sfxWith({ 10: note(50), 11: note(51) })
    pasteNotes(sfx, 3, 10, [note(1), note(0, 0, 0)])
    expect(readNote(sfx, 3, 10)).toEqual(note(1))
    expect(readNote(sfx, 3, 11)).toEqual(note(0, 0, 0))
  })

  it('drops what runs past the end', () => {
    const sfx = sfxWith({})
    expect(pasteNotes(sfx, 3, 30, [note(1), note(2), note(3), note(4)])).toBe(true)
    expect(readNote(sfx, 3, 31).pitch).toBe(2)
    // nothing spilled into the next sfx
    expect(sfx.subarray(4 * 68, 5 * 68).every((b) => b === 0)).toBe(true)
  })

  it('pastes into one sfx without touching another', () => {
    const sfx = sfxWith({ 0: note(9) })
    pasteNotes(sfx, 4, 0, copyRange(sfx, 3, 0, 0))
    expect(readNote(sfx, 4, 0).pitch).toBe(9)
    expect(readNote(sfx, 3, 0).pitch).toBe(9)
  })
})

describe('shiftRange', () => {
  it('moves notes sideways and returns the new range', () => {
    const sfx = sfxWith({ 2: note(10), 3: note(11) })
    expect(shiftRange(sfx, 3, 2, 3, 4)).toEqual([6, 7])
    expect(noteExtent(sfx, 3)).toEqual([6, 7])
    expect(readNote(sfx, 3, 6).pitch).toBe(10)
    expect(readNote(sfx, 3, 7).pitch).toBe(11)
  })

  it('moves left too', () => {
    const sfx = sfxWith({ 5: note(10) })
    expect(shiftRange(sfx, 3, 5, 5, -2)).toEqual([3, 3])
    expect(noteExtent(sfx, 3)).toEqual([3, 3])
  })

  it('stops at the edges instead of losing notes', () => {
    const sfx = sfxWith({ 29: note(10), 30: note(11) })
    expect(shiftRange(sfx, 3, 29, 30, 10)).toEqual([30, 31])
    expect(readNote(sfx, 3, 30).pitch).toBe(10)
    expect(readNote(sfx, 3, 31).pitch).toBe(11)
    expect(shiftRange(sfx, 3, 30, 31, 1)).toBeNull()
    expect(shiftRange(sfx, 3, 30, 31, -100)).toEqual([0, 1])
  })

  it('leaves other steps in place', () => {
    const sfx = sfxWith({ 0: note(1), 2: note(10), 9: note(20) })
    shiftRange(sfx, 3, 2, 2, 1)
    expect(readNote(sfx, 3, 0).pitch).toBe(1)
    expect(readNote(sfx, 3, 9).pitch).toBe(20)
    expect(readNote(sfx, 3, 3).pitch).toBe(10)
  })
})

describe('loop', () => {
  it('sets the loop to a range, the end exclusive', () => {
    const { sfx } = regions()
    expect(setLoopToRange(sfx, 3, 4, 11)).toBe(true)
    expect(readHeader(sfx, 3)).toMatchObject({ loopStart: 4, loopEnd: 12 })
    expect(loopSteps(sfx, 3)).toEqual([4, 11])
    expect(setLoopToRange(sfx, 3, 4, 11)).toBe(false)
  })

  it('loops to the very last step', () => {
    const { sfx } = regions()
    setLoopToRange(sfx, 3, 0, 31)
    expect(readHeader(sfx, 3).loopEnd).toBe(32)
    expect(loopSteps(sfx, 3)).toEqual([0, 31])
  })

  it('clears it', () => {
    const { sfx } = regions()
    setLoopToRange(sfx, 3, 4, 11)
    expect(clearLoop(sfx, 3)).toBe(true)
    expect(loopSteps(sfx, 3)).toBeNull()
    expect(clearLoop(sfx, 3)).toBe(false)
  })

  it('treats a start without an end as no loop (PICO-8 ends the sound there)', () => {
    const { sfx } = regions()
    sfx[3 * 68 + 66] = 8
    expect(loopSteps(sfx, 3)).toBeNull()
  })

  it('keeps the speed and filters', () => {
    const { sfx } = regions()
    sfx[3 * 68 + 64] = 9
    sfx[3 * 68 + 65] = 7
    setLoopToRange(sfx, 3, 1, 2)
    expect(readHeader(sfx, 3)).toMatchObject({ mode: 9, speed: 7 })
  })
})
