import { describe, expect, it } from 'vitest'
import { HighShelf } from '../../src/audio/filter.js'
import { INSTRUMENT, SAMPLE_RATE, keyToFreq, newSynthParams, voice, waveform } from '../../src/audio/waveform.js'

/** Samples of one period of an instrument. */
function period(/** @type {number} */ instrument, /** @type {number} */ filters = 0, steps = 400) {
  const p = newSynthParams()
  p.instrument = instrument
  p.filters = filters
  const out = []
  for (let i = 0; i < steps; i++) {
    p.phi = (i + 0.5) / steps
    out.push(waveform(p, Math.random))
  }
  return out
}

describe('keyToFreq', () => {
  it('has concert A at 33', () => {
    expect(keyToFreq(33)).toBeCloseTo(440, 6)
  })

  it('doubles every octave', () => {
    expect(keyToFreq(45)).toBeCloseTo(880, 6)
    expect(keyToFreq(21)).toBeCloseTo(220, 6)
  })
})

describe('waveform', () => {
  const periodic = [
    INSTRUMENT.TRIANGLE,
    INSTRUMENT.TILTED_SAW,
    INSTRUMENT.SAW,
    INSTRUMENT.SQUARE,
    INSTRUMENT.PULSE,
    INSTRUMENT.ORGAN,
    INSTRUMENT.PHASER,
  ]

  it('stays within -1..1 for every instrument and filter combination', () => {
    for (const inst of periodic) {
      for (const filters of [0, 2, 4, 6]) {
        for (const v of period(inst, filters)) expect(Math.abs(v)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is not silent and has no DC offset to speak of (the pulse wave has one by design)', () => {
    for (const inst of periodic.filter((i) => i !== INSTRUMENT.PULSE)) {
      const w = period(inst)
      expect(Math.max(...w) - Math.min(...w)).toBeGreaterThan(0.2)
      const mean = w.reduce((a, b) => a + b, 0) / w.length
      expect(Math.abs(mean)).toBeLessThan(0.08)
    }
  })

  it('has the triangle peak at half a period and its trough at the start', () => {
    const p = newSynthParams()
    p.instrument = INSTRUMENT.TRIANGLE
    p.phi = 0.5
    expect(waveform(p, Math.random)).toBeCloseTo(0.5, 6)
    p.phi = 0
    expect(waveform(p, Math.random)).toBeCloseTo(-0.5, 6)
    p.phi = 0.25
    expect(waveform(p, Math.random)).toBeCloseTo(0, 6)
  })

  it('has a square wave that is half high, half low; buzz shortens the high part', () => {
    const plain = period(INSTRUMENT.SQUARE)
    expect(plain.filter((v) => v > 0).length).toBe(plain.length / 2)
    const buzz = period(INSTRUMENT.SQUARE, 4)
    expect(buzz.filter((v) => v > 0).length).toBeCloseTo(plain.length * 0.4, -1)
  })

  it('has a pulse wave with a duty of about 0.316', () => {
    const w = period(INSTRUMENT.PULSE)
    expect(w.filter((v) => v > 0).length / w.length).toBeCloseTo(0.316, 1)
  })

  it('changes the shape with buzz', () => {
    for (const inst of periodic) {
      expect(period(inst, 4)).not.toEqual(period(inst, 0))
    }
  })

  it('is periodic', () => {
    const p = newSynthParams()
    p.instrument = INSTRUMENT.ORGAN
    p.phi = 0.3
    const a = waveform(p, Math.random)
    p.phi = 3.3
    expect(waveform(p, Math.random)).toBeCloseTo(a, 5)
  })

  it('makes noise that depends on the random source and keeps its state', () => {
    const p = newSynthParams()
    p.instrument = INSTRUMENT.NOISE
    p.key = 30
    let calls = 0
    const random = () => {
      calls++
      return 0.9
    }
    for (let i = 1; i <= 100; i++) {
      p.phi = i * 0.05
      const v = waveform(p, random)
      expect(Number.isFinite(v)).toBe(true)
      expect(Math.abs(v)).toBeLessThan(2)
    }
    expect(calls).toBe(100)
    expect(p.lastSample).toBeGreaterThan(0)
  })

  it('does not blow up when the phase goes back (noise)', () => {
    const p = newSynthParams()
    p.instrument = INSTRUMENT.NOISE
    p.lastAdvance = 5
    p.phi = 0.2
    expect(Number.isFinite(waveform(p, () => 0.3))).toBe(true)
  })
})

describe('voice (detune)', () => {
  it('adds a second wave', () => {
    const p = newSynthParams()
    p.instrument = INSTRUMENT.SQUARE
    p.phi = 0.1
    const plain = voice(p, Math.random)
    p.filters = 8
    p.phi = 0.1
    expect(voice(p, Math.random)).not.toBe(plain)
    p.filters = 16
    p.phi = 0.3
    expect(Number.isFinite(voice(p, Math.random))).toBe(true)
  })
})

describe('HighShelf', () => {
  /** @param {HighShelf} f @param {(i: number) => number} signal */
  function steady(f, signal) {
    let peak = 0
    for (let i = 0; i < 4000; i++) {
      const y = f.run(signal(i))
      if (i > 3000) peak = Math.max(peak, Math.abs(y))
    }
    return peak
  }

  it('passes low frequencies unchanged', () => {
    expect(steady(new HighShelf(2400, 1, -6), () => 1)).toBeCloseTo(1, 3)
  })

  it('cuts the high band by the gain', () => {
    const nyquist = steady(new HighShelf(1000, 1, -12), (i) => (i % 2 ? 1 : -1))
    expect(nyquist).toBeCloseTo(10 ** (-12 / 20), 1)
    const mild = steady(new HighShelf(2400, 1, -6), (i) => (i % 2 ? 1 : -1))
    expect(mild).toBeCloseTo(10 ** (-6 / 20), 1)
  })

  it('is stable', () => {
    const f = new HighShelf(1000, 1, -12)
    for (let i = 0; i < 100000; i++) expect(Math.abs(f.run(Math.sin(i * 0.37)))).toBeLessThan(5)
  })

  it('uses the sample rate of the synth', () => {
    expect(SAMPLE_RATE).toBe(22050)
  })
})
