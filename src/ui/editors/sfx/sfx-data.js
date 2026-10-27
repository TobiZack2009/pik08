/**
 * The `sfx` region: 64 sound effects of 68 bytes. Each has 32 notes of 2 bytes, then 4 header
 * bytes (editor mode, speed, loop start, loop end). A note is
 *
 *     low byte:  bits 0-5 pitch, bits 6-7 low bits of the waveform
 *     high byte: bit 0 waveform bit 2, bits 1-3 volume, bits 4-6 effect, bit 7 waveform bit 3
 *
 * The waveform is 0-7 (built-in instruments) or 8-15 (custom instruments: sfx 0-7).
 */

export const SFX_COUNT = 64
export const SFX_SIZE = 68
export const NOTE_COUNT = 32
const HEADER = NOTE_COUNT * 2

export const WAVE_NAMES = ['triangle', 'tilted saw', 'saw', 'square', 'pulse', 'organ', 'noise', 'phaser']
export const EFFECT_NAMES = ['none', 'slide', 'vibrato', 'drop', 'fade in', 'fade out', 'arp fast', 'arp slow']

/** @typedef {{ pitch: number, wave: number, vol: number, fx: number }} Note */
/** @typedef {{ mode: number, speed: number, loopStart: number, loopEnd: number }} SfxHeader */

/**
 * @param {Uint8Array} sfx  the `sfx` region
 * @param {number} id
 * @param {number} n  note index 0..31
 * @returns {Note}
 */
export function readNote(sfx, id, n) {
  const o = id * SFX_SIZE + n * 2
  const lo = sfx[o]
  const hi = sfx[o + 1]
  return {
    pitch: lo & 0x3f,
    wave: ((lo >> 6) & 3) | ((hi & 1) << 2) | ((hi >> 7) << 3),
    vol: (hi >> 1) & 7,
    fx: (hi >> 4) & 7,
  }
}

/**
 * @param {Uint8Array} sfx
 * @param {number} id
 * @param {number} n
 * @param {Note} note
 */
export function writeNote(sfx, id, n, note) {
  const o = id * SFX_SIZE + n * 2
  sfx[o] = (note.pitch & 0x3f) | ((note.wave & 3) << 6)
  sfx[o + 1] = ((note.wave >> 2) & 1) | ((note.vol & 7) << 1) | ((note.fx & 7) << 4) | (((note.wave >> 3) & 1) << 7)
}

/**
 * @param {Uint8Array} sfx
 * @param {number} id
 * @returns {SfxHeader}
 */
export function readHeader(sfx, id) {
  const o = id * SFX_SIZE + HEADER
  return { mode: sfx[o], speed: sfx[o + 1], loopStart: sfx[o + 2], loopEnd: sfx[o + 3] }
}

/**
 * @param {Uint8Array} sfx
 * @param {number} id
 * @param {Partial<SfxHeader>} h
 */
export function writeHeader(sfx, id, h) {
  const o = id * SFX_SIZE + HEADER
  if (h.mode !== undefined) sfx[o] = h.mode & 255
  if (h.speed !== undefined) sfx[o + 1] = h.speed & 255
  if (h.loopStart !== undefined) sfx[o + 2] = h.loopStart & 255
  if (h.loopEnd !== undefined) sfx[o + 3] = h.loopEnd & 255
}

/**
 * Whether no note of the sfx makes sound (all volumes 0).
 * @param {Uint8Array} sfx
 * @param {number} id
 */
export function isSilent(sfx, id) {
  for (let n = 0; n < NOTE_COUNT; n++) if (readNote(sfx, id, n).vol > 0) return false
  return true
}

/**
 * Resets the notes of an sfx and its loop points, keeping the speed.
 * @param {Uint8Array} sfx
 * @param {number} id
 */
export function clearSfx(sfx, id) {
  const o = id * SFX_SIZE
  sfx.fill(0, o, o + HEADER)
  writeHeader(sfx, id, { mode: 0, loopStart: 0, loopEnd: 0 })
}

const NOTE_LETTERS = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-']

/**
 * Name of a pitch as shown in PICO-8's tracker: 0 is `C-0`, 36 is `C-3`.
 * @param {number} pitch
 */
export function noteName(pitch) {
  return NOTE_LETTERS[pitch % 12] + Math.floor(pitch / 12)
}
