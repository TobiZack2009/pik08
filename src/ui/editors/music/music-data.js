/**
 * The `music` region: 64 patterns of 4 bytes, one per channel. Bits 0-5 of a byte are the sfx
 * number, bit 6 switches the channel off, and bit 7 is a flag: channel 0's is "loop start",
 * channel 1's "loop back" and channel 2's "stop".
 */

export const PATTERN_COUNT = 64
export const CHANNELS = 4

/**
 * @typedef {Object} Pattern
 * @property {{ sfx: number, enabled: boolean }[]} channels
 * @property {boolean} loopStart
 * @property {boolean} loopBack
 * @property {boolean} stop
 */

/**
 * @param {Uint8Array} music  the `music` region
 * @param {number} id
 * @returns {Pattern}
 */
export function readPattern(music, id) {
  const b = Array.from({ length: CHANNELS }, (_, c) => music[id * CHANNELS + c])
  return {
    channels: b.map((v) => ({ sfx: v & 0x3f, enabled: (v & 0x40) === 0 })),
    loopStart: (b[0] & 0x80) !== 0,
    loopBack: (b[1] & 0x80) !== 0,
    stop: (b[2] & 0x80) !== 0,
  }
}

/**
 * @param {Uint8Array} music
 * @param {number} id
 * @param {Pattern} p
 */
export function writePattern(music, id, p) {
  const flags = [p.loopStart, p.loopBack, p.stop, false]
  for (let c = 0; c < CHANNELS; c++) {
    const ch = p.channels[c]
    music[id * CHANNELS + c] = (ch.sfx & 0x3f) | (ch.enabled ? 0 : 0x40) | (flags[c] ? 0x80 : 0)
  }
}

/**
 * Whether a pattern plays anything.
 * @param {Pattern} p
 */
export const isUsed = (p) => p.channels.some((c) => c.enabled)
