/**
 * The piano roll's logic, apart from any DOM: geometry and hit testing, and edits to the notes of
 * one sfx. A roll shows 32 steps across and 64 pitches down (pitch 63 on the top row). Every edit
 * works in place on the `sfx` region and returns whether it changed anything.
 */

import { NOTE_COUNT, readNote, readHeader, writeHeader, writeNote } from '../sfx/sfx-data.js'

export const STEPS = NOTE_COUNT
export const PITCHES = 64

/** Cell sizes in pixels, from small to large. */
export const ZOOMS = Object.freeze([
  { w: 12, h: 6 },
  { w: 18, h: 9 },
  { w: 24, h: 12 },
])

export const GUTTER = 30
export const RULER = 12
const VOLUME_LANE = 40
const SMALL_LANE = 12
const LANE_GAP = 2

/**
 * @typedef {Object} Layout
 * @property {number} cellW
 * @property {number} cellH
 * @property {number} gutter  width of the key labels on the left
 * @property {number} ruler  height of the step ruler on top
 * @property {number} width  of the whole canvas
 * @property {number} height  of the whole canvas
 */

/** @param {number} zoom index into {@link ZOOMS} @returns {Layout} */
export function layoutFor(zoom) {
  const { w, h } = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, zoom | 0))]
  return { cellW: w, cellH: h, gutter: GUTTER, ruler: RULER, width: GUTTER + w * STEPS, height: RULER + h * PITCHES }
}

/** @typedef {'vol' | 'wave' | 'fx'} LaneName */

/**
 * Where the three lanes under the grid sit (each as `{y, h}`), and the height of all of them.
 * @param {Layout} l
 */
export function lanesLayout(l) {
  const vol = { y: 0, h: VOLUME_LANE }
  const wave = { y: vol.h + LANE_GAP, h: SMALL_LANE }
  const fx = { y: wave.y + wave.h + LANE_GAP, h: SMALL_LANE }
  return { vol, wave, fx, width: l.width, height: fx.y + fx.h }
}

/**
 * The step and pitch under a point of the grid, or null outside it. With `clampTo`, points outside
 * are moved onto the nearest cell (for drags that leave the canvas).
 * @param {Layout} l
 * @param {number} x
 * @param {number} y
 * @param {boolean} [clampTo]
 * @returns {{ step: number, pitch: number } | null}
 */
export function gridPoint(l, x, y, clampTo = false) {
  let step = Math.floor((x - l.gutter) / l.cellW)
  let row = Math.floor((y - l.ruler) / l.cellH)
  if (clampTo) {
    step = Math.max(0, Math.min(STEPS - 1, step))
    row = Math.max(0, Math.min(PITCHES - 1, row))
  } else if (step < 0 || step >= STEPS || row < 0 || row >= PITCHES) {
    return null
  }
  return { step, pitch: PITCHES - 1 - row }
}

/**
 * The step under a point of the ruler (its top strip), or null.
 * @param {Layout} l
 * @param {number} x
 * @param {number} y
 */
export function rulerStep(l, x, y) {
  if (y < 0 || y >= l.ruler) return null
  const step = Math.floor((x - l.gutter) / l.cellW)
  return step < 0 || step >= STEPS ? null : step
}

/**
 * The lane, step and (for volume) value under a point of the lanes canvas, or null.
 * @param {Layout} l
 * @param {number} x
 * @param {number} y
 * @returns {{ lane: LaneName, step: number, value: number } | null}
 */
export function laneHit(l, x, y) {
  const step = Math.floor((x - l.gutter) / l.cellW)
  if (step < 0 || step >= STEPS) return null
  const lanes = lanesLayout(l)
  for (const name of /** @type {LaneName[]} */ (['vol', 'wave', 'fx'])) {
    const { y: top, h } = lanes[name]
    if (y < top || y >= top + h) continue
    // volume 7 at the top of its lane, 0 at the bottom
    const value = name === 'vol' ? Math.max(0, Math.min(7, Math.round(((top + h - y) / h) * 7))) : 0
    return { lane: name, step, value }
  }
  return null
}

/**
 * The cells a drag from one point to another passes through: one per step, with the pitch
 * interpolated, so a fast stroke leaves no gaps. Includes both ends.
 * @param {{ step: number, pitch: number }} from
 * @param {{ step: number, pitch: number }} to
 * @returns {{ step: number, pitch: number }[]}
 */
export function strokeSteps(from, to) {
  const out = []
  const dir = to.step >= from.step ? 1 : -1
  const span = Math.abs(to.step - from.step)
  for (let i = 0; i <= span; i++) {
    const t = span === 0 ? 1 : i / span
    out.push({ step: from.step + i * dir, pitch: Math.round(from.pitch + (to.pitch - from.pitch) * t) })
  }
  return out
}

/** @typedef {import('../sfx/sfx-data.js').Note} Note */

/** A step with nothing in it. @param {Note} n */
export const isEmptyNote = (n) => n.pitch === 0 && n.wave === 0 && n.vol === 0 && n.fx === 0

/** @param {Note} a @param {Note} b */
export const sameNote = (a, b) => a.pitch === b.pitch && a.wave === b.wave && a.vol === b.vol && a.fx === b.fx

/**
 * An ordered pair of steps, clamped to the sfx.
 * @param {number} a
 * @param {number} b
 * @returns {[number, number]}
 */
export function normRange(a, b) {
  const lo = Math.max(0, Math.min(a, b))
  const hi = Math.min(STEPS - 1, Math.max(a, b))
  return [lo, Math.max(lo, hi)]
}

/**
 * Writes a note at a step. Returns whether the sfx changed.
 * @param {Uint8Array} sfx
 * @param {number} id
 * @param {number} step
 * @param {Note} note
 */
export function setNote(sfx, id, step, note) {
  if (step < 0 || step >= STEPS) return false
  if (sameNote(readNote(sfx, id, step), note)) return false
  writeNote(sfx, id, step, note)
  return true
}

/** Empties a step. @param {Uint8Array} sfx @param {number} id @param {number} step */
export function eraseStep(sfx, id, step) {
  return setNote(sfx, id, step, { pitch: 0, wave: 0, vol: 0, fx: 0 })
}

/**
 * Whether a range holds any note.
 * @param {Uint8Array} sfx
 * @param {number} id
 * @param {number} from
 * @param {number} to
 */
export function rangeHasNotes(sfx, id, from, to) {
  for (let s = from; s <= to; s++) if (!isEmptyNote(readNote(sfx, id, s))) return true
  return false
}

/**
 * First and last steps that hold a note, or null for an empty sfx.
 * @param {Uint8Array} sfx
 * @param {number} id
 * @returns {[number, number] | null}
 */
export function noteExtent(sfx, id) {
  let first = -1
  let last = -1
  for (let s = 0; s < STEPS; s++) {
    if (isEmptyNote(readNote(sfx, id, s))) continue
    if (first < 0) first = s
    last = s
  }
  return first < 0 ? null : [first, last]
}

/**
 * Moves the notes of a range up or down by `delta` pitches (clamped to 0..63).
 * @param {Uint8Array} sfx
 * @param {number} id
 * @param {number} from
 * @param {number} to
 * @param {number} delta
 */
export function transpose(sfx, id, from, to, delta) {
  let changed = false
  for (let s = from; s <= to; s++) {
    const n = readNote(sfx, id, s)
    if (isEmptyNote(n)) continue
    changed = setNote(sfx, id, s, { ...n, pitch: Math.max(0, Math.min(PITCHES - 1, n.pitch + delta)) }) || changed
  }
  return changed
}

/**
 * Changes the instrument, volume or effect of the notes of a range.
 * @param {Uint8Array} sfx
 * @param {number} id
 * @param {number} from
 * @param {number} to
 * @param {Partial<Pick<Note, 'wave' | 'vol' | 'fx'>>} props
 */
export function applyToRange(sfx, id, from, to, props) {
  let changed = false
  for (let s = from; s <= to; s++) {
    const n = readNote(sfx, id, s)
    if (isEmptyNote(n)) continue
    changed = setNote(sfx, id, s, { ...n, ...props }) || changed
  }
  return changed
}

/** Empties a range. @param {Uint8Array} sfx @param {number} id @param {number} from @param {number} to */
export function clearRange(sfx, id, from, to) {
  let changed = false
  for (let s = from; s <= to; s++) changed = eraseStep(sfx, id, s) || changed
  return changed
}

/**
 * The notes of a range, for pasting. Empty steps are kept, so the rhythm survives.
 * @param {Uint8Array} sfx
 * @param {number} id
 * @param {number} from
 * @param {number} to
 * @returns {Note[]}
 */
export function copyRange(sfx, id, from, to) {
  const out = []
  for (let s = from; s <= to; s++) out.push(readNote(sfx, id, s))
  return out
}

/**
 * Writes notes starting at a step, dropping what runs past the end. Returns whether anything changed.
 * @param {Uint8Array} sfx
 * @param {number} id
 * @param {number} at
 * @param {Note[]} notes
 */
export function pasteNotes(sfx, id, at, notes) {
  let changed = false
  for (let i = 0; i < notes.length; i++) changed = setNote(sfx, id, at + i, notes[i]) || changed
  return changed
}

/**
 * Moves the notes of a range sideways by `delta` steps. What would leave the sfx is lost, and the
 * steps left behind are emptied. Returns the new range, or null if nothing changed.
 * @param {Uint8Array} sfx
 * @param {number} id
 * @param {number} from
 * @param {number} to
 * @param {number} delta
 * @returns {[number, number] | null}
 */
export function shiftRange(sfx, id, from, to, delta) {
  // keep the range itself on the sfx: stop at the edges rather than squashing it
  const d = Math.max(-from, Math.min(STEPS - 1 - to, delta))
  if (d === 0) return null
  const notes = copyRange(sfx, id, from, to)
  clearRange(sfx, id, from, to)
  pasteNotes(sfx, id, from + d, notes)
  return [from + d, to + d]
}

/**
 * Makes the loop run over a range of steps (the end is exclusive, as in PICO-8).
 * @param {Uint8Array} sfx
 * @param {number} id
 * @param {number} from
 * @param {number} to
 */
export function setLoopToRange(sfx, id, from, to) {
  const h = readHeader(sfx, id)
  if (h.loopStart === from && h.loopEnd === to + 1) return false
  writeHeader(sfx, id, { loopStart: from, loopEnd: to + 1 })
  return true
}

/** @param {Uint8Array} sfx @param {number} id */
export function clearLoop(sfx, id) {
  const h = readHeader(sfx, id)
  if (h.loopStart === 0 && h.loopEnd === 0) return false
  writeHeader(sfx, id, { loopStart: 0, loopEnd: 0 })
  return true
}

/**
 * The steps the loop covers, or null without one. The same rule as the engine's: a loop needs a
 * non-zero end after its start, or a start alone that runs to the end of the sfx.
 * @param {Uint8Array} sfx
 * @param {number} id
 * @returns {[number, number] | null}
 */
export function loopSteps(sfx, id) {
  const { loopStart, loopEnd } = readHeader(sfx, id)
  if (loopEnd <= loopStart) return null
  return [Math.min(loopStart, STEPS - 1), Math.min(loopEnd, STEPS) - 1]
}
