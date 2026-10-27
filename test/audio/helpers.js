import { createEngine } from '../../src/audio/engine.js'
import { SAMPLE_RATE } from '../../src/audio/waveform.js'
import { writeHeader, writeNote } from '../../src/ui/editors/sfx/sfx-data.js'

export { SAMPLE_RATE }

/** Fresh `sfx` and `music` regions, all zero. */
export function regions() {
  return { sfx: new Uint8Array(64 * 68), music: new Uint8Array(64 * 4) }
}

/**
 * Writes an sfx. `notes` are `[pitch, wave, vol, fx]`; missing notes are silent.
 * @param {Uint8Array} sfx
 * @param {number} id
 * @param {Object} o
 * @param {number[][]} [o.notes]
 * @param {number} [o.speed]
 * @param {number} [o.loopStart]
 * @param {number} [o.loopEnd]
 * @param {number} [o.filters]
 */
export function setSfx(sfx, id, { notes = [], speed = 1, loopStart = 0, loopEnd = 0, filters = 0 }) {
  for (let n = 0; n < 32; n++) {
    const [pitch = 0, wave = 0, vol = 0, fx = 0] = notes[n] ?? []
    writeNote(sfx, id, n, { pitch, wave, vol, fx })
  }
  writeHeader(sfx, id, { mode: filters, speed, loopStart, loopEnd })
}

/** A note repeated `count` times. @param {number[]} note @param {number} [count] */
export const repeat = (note, count = 32) => Array.from({ length: count }, () => note)

/**
 * An engine with a seeded random number generator, so noise is repeatable.
 * @param {{ sfx: Uint8Array, music: Uint8Array }} r
 * @param {number} [seed]
 */
export function engineFor(r, seed = 1) {
  let s = seed >>> 0 || 1
  const random = () => {
    // xorshift32
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
  return createEngine({ sfx: r.sfx, music: r.music, random })
}

/** @param {{ render: (out: Float32Array) => void }} engine @param {number} samples */
export function render(engine, samples) {
  const out = new Float32Array(samples)
  engine.render(out)
  return out
}

/** Number of rising zero crossings: the frequency in Hz when `samples` is one second. @param {Float32Array} x */
export function crossings(x) {
  let n = 0
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) n++
  return n
}

/** Largest absolute value. @param {Float32Array} x */
export function peak(x) {
  let p = 0
  for (const v of x) p = Math.max(p, Math.abs(v))
  return p
}

/** Root mean square of the difference of neighbours: large for bright sounds. @param {Float32Array} x */
export function roughness(x) {
  let sum = 0
  for (let i = 1; i < x.length; i++) sum += (x[i] - x[i - 1]) ** 2
  return Math.sqrt(sum / x.length)
}
