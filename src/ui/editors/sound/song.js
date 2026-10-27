import { CHANNELS, PATTERN_COUNT, readPattern, writePattern } from '../music/music-data.js'
import { NOTE_COUNT, SFX_COUNT, SFX_SIZE, readHeader, readNote } from '../sfx/sfx-data.js'

/**
 * The song as the sound editor sees it, made of the `sfx` and `music` regions:
 *
 *  - a **bar** is a music pattern (0-63), a row of the timeline;
 *  - a **cell** is one channel (0-3) of a bar: it holds the number of an sfx, or is empty;
 *  - the sfx a cell holds is the **pattern** that the piano roll edits.
 *
 * Two cells can hold the same sfx; then they share it, and editing one changes the other. The
 * functions here do the housekeeping around that (finding a free sfx, making a copy that is no
 * longer shared, moving bars). They change the regions in place and know nothing about undo: the
 * caller runs each as one step of a `createRegionEdits` over `['sfx', 'music']`.
 */

export { CHANNELS, PATTERN_COUNT as BAR_COUNT }

/** Samples of the sound engine per unit of speed (see audio/engine.js). */
export const TICK_SAMPLES = 183
const SAMPLE_RATE = 22050

/** The sfx 0-7 can be used as instruments, so new patterns avoid them while other numbers are free. */
const FIRST_PLAIN = 8
/** Bytes of an empty cell, like those of a new cartridge. */
const emptyByte = (/** @type {number} */ channel) => 0x41 + channel

/**
 * @typedef {Object} Cell
 * @property {number} bar      0-63
 * @property {number} channel  0-3
 */

// --- cells -------------------------------------------------------------------------------------

/**
 * The sfx of a cell, -1 if the cell is empty (the channel is off in that bar).
 * @param {Uint8Array} music
 * @param {number} bar
 * @param {number} channel
 */
export function cellSfx(music, bar, channel) {
  const b = music[bar * CHANNELS + channel]
  return b & 0x40 ? -1 : b & 0x3f
}

/**
 * Puts an sfx in a cell, or empties it with -1. The flag of the bar (bit 7) is kept, and an
 * emptied cell remembers its sfx number, as PICO-8 does.
 * @param {Uint8Array} music
 * @param {number} bar
 * @param {number} channel
 * @param {number} sfx  0-63, or -1
 */
export function setCell(music, bar, channel, sfx) {
  const i = bar * CHANNELS + channel
  const flag = music[i] & 0x80
  music[i] = sfx < 0 ? flag | 0x40 | (music[i] & 0x3f) : flag | (sfx & 0x3f)
}

/**
 * Whether a bar plays anything.
 * @param {Uint8Array} music
 * @param {number} bar
 */
export const isUsedBar = (music, bar) => [0, 1, 2, 3].some((c) => cellSfx(music, bar, c) >= 0)

/**
 * Index of the last bar that plays anything, -1 for an empty song.
 * @param {Uint8Array} music
 */
export function lastBar(music) {
  for (let bar = PATTERN_COUNT - 1; bar >= 0; bar--) if (isUsedBar(music, bar)) return bar
  return -1
}

/**
 * The cells that hold each sfx, indexed by sfx number.
 * @param {Uint8Array} music
 * @returns {Cell[][]}
 */
export function usage(music) {
  /** @type {Cell[][]} */
  const out = Array.from({ length: SFX_COUNT }, () => [])
  for (let bar = 0; bar < PATTERN_COUNT; bar++) {
    for (let channel = 0; channel < CHANNELS; channel++) {
      const id = cellSfx(music, bar, channel)
      if (id >= 0) out[id].push({ bar, channel })
    }
  }
  return out
}

/**
 * Whether the sfx of a cell is also in another cell.
 * @param {Uint8Array} music
 * @param {number} bar
 * @param {number} channel
 */
export function isShared(music, bar, channel) {
  const id = cellSfx(music, bar, channel)
  return id >= 0 && usage(music)[id].length > 1
}

/**
 * Sets a flag of a bar: the start of a loop, the end of a loop (jump back to the start) or the
 * end of the song.
 * @param {Uint8Array} music
 * @param {number} bar
 * @param {'loopStart' | 'loopBack' | 'stop'} flag
 * @param {boolean} on
 */
export function setFlag(music, bar, flag, on) {
  const p = readPattern(music, bar)
  p[flag] = on
  writePattern(music, bar, p)
}

// --- sfx ---------------------------------------------------------------------------------------

/**
 * Whether an sfx has no notes and no loop. Its speed and editor mode do not count.
 * @param {Uint8Array} sfx
 * @param {number} id
 */
export function isEmptySfx(sfx, id) {
  const o = id * SFX_SIZE
  for (let i = 0; i < NOTE_COUNT * 2; i++) if (sfx[o + i] !== 0) return false
  const h = readHeader(sfx, id)
  return h.loopStart === 0 && h.loopEnd === 0
}

/**
 * The sfx 0-7 that some note uses as its instrument.
 * @param {Uint8Array} sfx
 */
export function instrumentSfx(sfx) {
  const used = new Set()
  for (let id = 0; id < SFX_COUNT; id++) {
    for (let n = 0; n < NOTE_COUNT; n++) {
      const note = readNote(sfx, id, n)
      if (note.wave >= 8 && note.vol > 0) used.add(note.wave & 7)
    }
  }
  return used
}

/**
 * Sound effects that are safe to write into: empty, not in a cell of the song and not an
 * instrument of another sfx. The numbers from 8 come first, then 0-7.
 * @param {Uint8Array} sfx
 * @param {Uint8Array} music
 * @param {number} [count]
 * @returns {number[]} up to `count` numbers
 */
export function freeSfx(sfx, music, count = 1) {
  const cells = usage(music)
  const instruments = instrumentSfx(sfx)
  const free = (/** @type {number} */ id) => cells[id].length === 0 && !instruments.has(id) && isEmptySfx(sfx, id)
  const order = [...Array.from({ length: SFX_COUNT - FIRST_PLAIN }, (_, i) => i + FIRST_PLAIN), ...Array.from({ length: FIRST_PLAIN }, (_, i) => i)]
  /** @type {number[]} */
  const out = []
  for (const id of order) {
    if (out.length >= count) break
    if (free(id)) out.push(id)
  }
  return out
}

/**
 * Copies an sfx over another: notes, header and all.
 * @param {Uint8Array} sfx
 * @param {number} from
 * @param {number} to
 */
export function copySfx(sfx, from, to) {
  if (from === to) return
  sfx.copyWithin(to * SFX_SIZE, from * SFX_SIZE, (from + 1) * SFX_SIZE)
}

// --- making and sharing patterns ---------------------------------------------------------------

/**
 * The speed a new pattern in a bar should have: that of the other channels, so that they stay in
 * step.
 * @param {Uint8Array} sfx
 * @param {Uint8Array} music
 * @param {number} bar
 */
export function barSpeed(sfx, music, bar) {
  for (let c = 0; c < CHANNELS; c++) {
    const id = cellSfx(music, bar, c)
    if (id >= 0) return readHeader(sfx, id).speed
  }
  return 16
}

/**
 * Makes a new, empty pattern in a cell: the first free sfx, at the speed of the rest of the bar.
 * Does nothing if the cell already has one.
 * @param {Uint8Array} sfx
 * @param {Uint8Array} music
 * @param {number} bar
 * @param {number} channel
 * @returns {number} the sfx of the cell, -1 if there was no free sfx
 */
export function newPattern(sfx, music, bar, channel) {
  const current = cellSfx(music, bar, channel)
  if (current >= 0) return current
  const [id] = freeSfx(sfx, music)
  if (id === undefined) return -1
  const speed = barSpeed(sfx, music, bar)
  sfx.fill(0, id * SFX_SIZE, (id + 1) * SFX_SIZE)
  sfx[id * SFX_SIZE + 65] = speed
  setCell(music, bar, channel, id)
  return id
}

/**
 * Gives a cell its own copy of the sfx it shares. Does nothing if it is not shared.
 * @param {Uint8Array} sfx
 * @param {Uint8Array} music
 * @param {number} bar
 * @param {number} channel
 * @returns {number} the sfx of the cell afterwards; -1 if the cell is empty or shared but no sfx is free (nothing changed)
 */
export function makeUnique(sfx, music, bar, channel) {
  const id = cellSfx(music, bar, channel)
  if (id < 0) return -1
  if (usage(music)[id].length <= 1) return id
  const [copy] = freeSfx(sfx, music)
  if (copy === undefined) return -1
  copySfx(sfx, id, copy)
  setCell(music, bar, channel, copy)
  return copy
}

// --- bars --------------------------------------------------------------------------------------

/**
 * Empties a bar: all its channels off and no flags.
 * @param {Uint8Array} music
 * @param {number} bar
 */
export function clearBar(music, bar) {
  for (let c = 0; c < CHANNELS; c++) music[bar * CHANNELS + c] = emptyByte(c)
}

/**
 * Copies a bar over another, the flags too. The sfx stay shared.
 * @param {Uint8Array} music
 * @param {number} from
 * @param {number} to
 */
export function copyBar(music, from, to) {
  if (from !== to) music.copyWithin(to * CHANNELS, from * CHANNELS, (from + 1) * CHANNELS)
}

/**
 * Copies a bar over another. With `unique` the patterns are copied as well, so that the new bar
 * can be edited on its own (a pattern that two channels of the bar share stays shared between them).
 * The target is replaced; if there are not enough free sfx for `unique` nothing changes.
 * @param {Uint8Array} sfx
 * @param {Uint8Array} music
 * @param {number} from
 * @param {number} to
 * @param {boolean} [unique]
 * @returns {boolean} whether it was done
 */
export function duplicateBar(sfx, music, from, to, unique = false) {
  if (from === to) return true
  if (!unique) {
    copyBar(music, from, to)
    return true
  }
  const ids = [...new Set([0, 1, 2, 3].map((c) => cellSfx(music, from, c)).filter((id) => id >= 0))]
  // the free sfx are found with the target already replaced, so that its old cells no longer hold any
  const saved = music.slice(to * CHANNELS, (to + 1) * CHANNELS)
  copyBar(music, from, to)
  const free = freeSfx(sfx, music, ids.length)
  if (free.length < ids.length) {
    music.set(saved, to * CHANNELS)
    return false
  }
  const copies = new Map(ids.map((id, i) => [id, free[i]]))
  for (const [id, copy] of copies) copySfx(sfx, id, copy)
  for (let c = 0; c < CHANNELS; c++) {
    const id = cellSfx(music, to, c)
    if (id >= 0) setCell(music, to, c, /** @type {number} */ (copies.get(id)))
  }
  return true
}

/**
 * Inserts an empty bar, moving the ones from there on down by one. Not possible when the last bar
 * is in use.
 * @param {Uint8Array} music
 * @param {number} at
 * @returns {boolean}
 */
export function insertBar(music, at) {
  if (isUsedBar(music, PATTERN_COUNT - 1)) return false
  music.copyWithin((at + 1) * CHANNELS, at * CHANNELS, (PATTERN_COUNT - 1) * CHANNELS)
  clearBar(music, at)
  return true
}

/**
 * Removes a bar, moving the ones after it up by one.
 * @param {Uint8Array} music
 * @param {number} at
 */
export function removeBar(music, at) {
  music.copyWithin(at * CHANNELS, (at + 1) * CHANNELS, PATTERN_COUNT * CHANNELS)
  clearBar(music, PATTERN_COUNT - 1)
}

/**
 * Duplicates a bar into a new one right after it, moving the later bars down. The copy keeps the
 * patterns of the original (shared), or with `unique` gets copies of them. It has no flags: it
 * repeats the content of the bar, not its place in the song's structure. Nothing changes if the
 * song has no room, or there are not enough free sfx for `unique`.
 * @param {Uint8Array} sfx
 * @param {Uint8Array} music
 * @param {number} bar
 * @param {boolean} [unique]
 * @returns {boolean} whether it was done
 */
export function duplicateAfter(sfx, music, bar, unique = false) {
  if (bar + 1 >= PATTERN_COUNT) return false
  const before = music.slice()
  if (!insertBar(music, bar + 1)) return false
  if (!duplicateBar(sfx, music, bar, bar + 1, unique)) {
    music.set(before)
    return false
  }
  for (let c = 0; c < CHANNELS; c++) music[(bar + 1) * CHANNELS + c] &= 0x7f
  return true
}

/**
 * The stretches of bars that loop: from the loop start to the bar that jumps back to it, for each
 * bar with a loop-back flag (the closest loop start at or before it, else the first bar).
 * @param {Uint8Array} music
 * @returns {{ from: number, to: number }[]}
 */
export function loopRanges(music) {
  const out = []
  for (let bar = 0; bar < PATTERN_COUNT; bar++) {
    if (!readPattern(music, bar).loopBack) continue
    let from = bar
    while (from > 0 && !readPattern(music, from).loopStart) from--
    out.push({ from, to: bar })
  }
  return out
}

// --- playing order and length ------------------------------------------------------------------

/**
 * How many ticks (units of speed) a bar lasts, as the sound engine counts: as long as the first
 * channel that does not loop, or if every channel loops, the slowest of them for one pass. 0 when
 * the bar plays nothing.
 * @param {Uint8Array} sfx
 * @param {Uint8Array} music
 * @param {number} bar
 */
export function barTicks(sfx, music, bar) {
  let looping = -1
  for (let c = 0; c < CHANNELS; c++) {
    const id = cellSfx(music, bar, c)
    if (id < 0) continue
    const { speed, loopStart, loopEnd } = readHeader(sfx, id)
    const ticks = Math.max(1, speed)
    if (loopEnd > 0 && loopEnd > loopStart) {
      looping = Math.max(looping, NOTE_COUNT * ticks)
    } else {
      const end = loopEnd === 0 && loopStart > 0 ? Math.min(NOTE_COUNT, loopStart) : NOTE_COUNT
      return end * ticks
    }
  }
  return Math.max(0, looping)
}

/**
 * How long a bar lasts, in seconds.
 * @param {Uint8Array} sfx
 * @param {Uint8Array} music
 * @param {number} bar
 */
export const barSeconds = (sfx, music, bar) => (barTicks(sfx, music, bar) * TICK_SAMPLES) / SAMPLE_RATE

/**
 * The bar that plays after this one, -1 if the song ends. A stop flag ends it, a loop-back flag
 * jumps to the closest loop start at or before it (or the first bar), and a bar that plays nothing
 * ends it.
 * @param {Uint8Array} sfx
 * @param {Uint8Array} music
 * @param {number} bar
 */
export function nextBar(sfx, music, bar) {
  const p = readPattern(music, bar)
  if (p.stop) return -1
  let next = bar + 1
  if (p.loopBack) {
    next = bar
    while (next > 0 && !readPattern(music, next).loopStart) next--
  }
  if (next >= PATTERN_COUNT || barTicks(sfx, music, next) <= 0) return -1
  return next
}
