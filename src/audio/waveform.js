/**
 * The oscillators of the PICO-8 synthesizer. The shapes and constants follow the measurements of
 * PICO-8 exports collected by the ZEPTO-8 emulator (WTFPL), so they match the real thing closely
 * without being bit-exact.
 */

export const SAMPLE_RATE = 22050

/** The built-in instruments. */
export const INSTRUMENT = Object.freeze({
  TRIANGLE: 0,
  TILTED_SAW: 1,
  SAW: 2,
  SQUARE: 3,
  PULSE: 4,
  ORGAN: 5,
  NOISE: 6,
  PHASER: 7,
})

/** Frequency in Hz of a note number 0..63 (33 is concert A, 440 Hz). @param {number} key */
export const keyToFreq = (key) => 440 * 2 ** ((key - 33) / 12)

/**
 * The state of one voice for one sample.
 * @typedef {Object} SynthParams
 * @property {number} instrument   0..7
 * @property {boolean} custom      Whether `instrument` is the number of an sfx (0..7) used as an instrument
 * @property {number} filters      The filter byte of the sfx (noiz, buzz, detune, reverb, dampen)
 * @property {number} key          Note number 0..63
 * @property {number} freq         Hz
 * @property {number} volume       0..1
 * @property {number} phi          Phase, in periods
 * @property {number} lastAdvance  Noise state
 * @property {number} lastSample   Noise state
 * @property {boolean} isMusic
 */

/** @returns {SynthParams} */
export function newSynthParams() {
  return { instrument: 0, custom: false, filters: 0, key: 0, freq: 0, volume: 0, phi: 0, lastAdvance: 0, lastSample: 0, isMusic: false }
}

/** Distance from the start of the period in [0, 1). @param {number} x */
const frac = (x) => x - Math.floor(x)

/**
 * One sample of an instrument at the phase `p.phi`, in about -0.5..0.5 before volume. The noise
 * instrument keeps its state in `p`.
 * @param {SynthParams} p
 * @param {() => number} random  Uniform in [0, 1)
 */
export function waveform(p, random) {
  const advance = p.phi
  const t = frac(advance)
  const noiz = (p.filters & 0x2) !== 0
  const buzz = (p.filters & 0x4) !== 0
  let ret = 0

  switch (p.instrument) {
    case INSTRUMENT.TRIANGLE: {
      ret = 1 - Math.abs(4 * t - 2)
      if (buzz) {
        // averaged with a tilted saw
        const a = 0.875
        const b = t < a ? (2 * t) / a - 1 : (2 * (1 - t)) / (1 - a) - 1
        ret = ret * 0.75 + b * 0.25
      }
      return ret * 0.5
    }
    case INSTRUMENT.TILTED_SAW: {
      const a = buzz ? 0.975 : 0.875
      ret = t < a ? (2 * t) / a - 1 : (2 * (1 - t)) / (1 - a) - 1
      return ret * 0.5
    }
    case INSTRUMENT.SAW: {
      ret = t < 0.5 ? t : t - 1
      // buzz: a slight offset looping on a double period
      if (buzz) ret = ret * 0.83 - (Math.abs((advance % 2) - 1) < 0.5 ? 0.085 : 0)
      return 0.653 * ret
    }
    case INSTRUMENT.SQUARE:
      return t < (buzz ? 0.4 : 0.5) ? 0.25 : -0.25
    case INSTRUMENT.PULSE:
      return t < (buzz ? 0.255 : 0.316) ? 0.25 : -0.25
    case INSTRUMENT.ORGAN: {
      ret = t < 0.5 ? 3 - Math.abs(24 * t - 6) : 1 - Math.abs(16 * t - 12)
      if (buzz) {
        // a cut on the first of the two triangles
        ret = t < 0.5 ? ret * 2 + 3 : ret
        ret = t < 0.5 && ret > -1.875 ? ret * 0.2 - 1 : ret + 0.5
      }
      return ret / 9
    }
    case INSTRUMENT.NOISE: {
      // The scale is how far the phase moved; it cannot be negative, which happens when the phase
      // was wrapped between two notes and would make the filter below unstable.
      const scale = Math.max(0, (advance - p.lastAdvance) * 8.858923)
      const sample = (p.lastSample + scale * (random() * 2 - 1)) / (1 + scale)
      const factor = 1 - p.key / 63
      ret = sample * 1.5 * (1 + factor * factor)
      // sounds a bit like a saw tooth but not quite
      if (noiz) ret *= 2 * (t < 0.5 ? t : t - 1)
      p.lastAdvance = advance
      p.lastSample = sample
      return ret
    }
    case INSTRUMENT.PHASER: {
      // two triangle waves of a slightly different frequency
      ret = 2 - Math.abs(8 * t - 4)
      ret += 1 - Math.abs(4 * frac((advance * 109) / 110) - 2)
      if (buzz) {
        // adds the waves at 2, 6, 10, 14 ...
        ret += 0.25 - Math.abs(frac(advance * 2 + 0.5) - 0.5)
        // ... and at 4, 12, 20, 28 ...
        ret += 0.125 - Math.abs(0.5 * frac(advance * 4) - 0.25)
      }
      return ret / 6
    }
  }
  return 0
}

/**
 * One sample of a voice with its detune applied (a second wave next to the first), before the
 * volume.
 * @param {SynthParams} p
 * @param {() => number} random
 */
export function voice(p, random) {
  let w = waveform(p, random)
  const detune = Math.floor(p.filters / 8) % 3
  if (detune !== 0 && p.instrument !== INSTRUMENT.NOISE) {
    let factor
    if (p.instrument === INSTRUMENT.TRIANGLE) factor = detune === 1 ? 3 / 4 : 3 / 2
    else if (p.instrument === INSTRUMENT.ORGAN) factor = detune === 1 ? 200 / 199 : 800 / 199
    else if (p.instrument === INSTRUMENT.PHASER) factor = detune === 1 ? 49 / 50 : 400 / 199
    else factor = detune === 1 ? 200 / 199 : 400 / 199
    const second = { ...p, phi: p.phi * factor }
    if (detune === 2 && p.instrument === INSTRUMENT.ORGAN) second.instrument = INSTRUMENT.TRIANGLE
    w += waveform(second, random) * 0.5
  }
  return w
}
