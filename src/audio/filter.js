import { SAMPLE_RATE } from './waveform.js'

/**
 * A high-shelf biquad filter (formulae from the Audio EQ Cookbook), used for the "dampen" setting of
 * an sfx. One instance holds the state of one channel.
 */
export class HighShelf {
  /**
   * @param {number} freq  Corner frequency in Hz
   * @param {number} q
   * @param {number} gainDb  Gain of the high band in dB (negative to cut)
   */
  constructor(freq, q, gainDb) {
    const w0 = (2 * Math.PI * freq) / SAMPLE_RATE
    const cos = Math.cos(w0)
    const a = 10 ** (gainDb / 40)
    const alpha = (Math.sin(w0) / 2) * Math.sqrt((a + 1 / a) * (1 / q - 1) + 2)
    const sqra = 2 * Math.sqrt(a) * alpha
    const a0 = a + 1 - (a - 1) * cos + sqra
    this.c1 = (a * (a + 1 + (a - 1) * cos + sqra)) / a0
    this.c2 = (-2 * a * (a - 1 + (a + 1) * cos)) / a0
    this.c3 = (a * (a + 1 + (a - 1) * cos - sqra)) / a0
    this.c4 = (2 * (a - 1 - (a + 1) * cos)) / a0
    this.c5 = (a + 1 - (a - 1) * cos - sqra) / a0
    this.x1 = 0
    this.x2 = 0
    this.y1 = 0
    this.y2 = 0
  }

  /** @param {number} x */
  run(x) {
    const y = this.c1 * x + this.c2 * this.x1 + this.c3 * this.x2 - this.c4 * this.y1 - this.c5 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}
