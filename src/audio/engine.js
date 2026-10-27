import { HighShelf } from './filter.js'
import { SAMPLE_RATE, keyToFreq, newSynthParams, voice } from './waveform.js'

/**
 * The PICO-8 sound engine: four channels that play sfx, and a music sequencer that starts sfx on
 * them pattern by pattern. It is a pure sample generator: `render` fills a buffer with mono samples
 * at 22050 Hz, and `output.js` plays them.
 *
 * The engine reads the `sfx` and `music` regions while it renders, one sample at a time, and does
 * not copy them, so an edit to the regions is heard at once, in the middle of a note. The
 * behaviour (note timing, effects, filters, the way music picks the length of a pattern, how `sfx`
 * chooses a channel) follows the ZEPTO-8 emulator (WTFPL), which was measured against PICO-8.
 *
 * Layout of the regions (see also ui/editors/sfx/sfx-data.js and music/music-data.js):
 *  - sfx: 64 sounds of 68 bytes: 32 notes of 2 bytes, then filters, speed, loop start, loop end
 *  - music: 64 patterns of 4 bytes: bits 0-5 the sfx, bit 6 channel off, bit 7 a flag that is
 *    loop start (channel 0), loop back (channel 1) or stop (channel 2)
 */

const SFX_SIZE = 68
const NOTES = 32
const CHANNELS = 4
/** Samples per unit of speed: one note lasts `speed` of these. */
const TICK = 183
/** Silent samples after which a finished engine stops rendering (longer than the reverb tail). */
const QUIET_SAMPLES = 16384

/**
 * @typedef {Object} SfxState  Where a channel is in an sfx
 * @property {number} sfx   -1 when not playing
 * @property {number} offset  In notes (fractional)
 * @property {number} time    In notes, ignoring loops
 * @property {number} prevKey
 * @property {number} prevVol
 */

/**
 * @typedef {Object} Channel
 * @property {SfxState} main
 * @property {SfxState} custom  The sfx used as the instrument of the current note
 * @property {number} sfxMusic  A music sfx waiting for the sound effect on this channel to end
 * @property {number} length
 * @property {boolean} canLoop
 * @property {boolean} isMusic
 * @property {import('./waveform.js').SynthParams} last
 * @property {import('./waveform.js').SynthParams} fadeSynth
 * @property {number} fade
 * @property {number} lastInstrument
 * @property {number} lastKey
 * @property {number} reverbIndex
 * @property {Float32Array} reverb2
 * @property {Float32Array} reverb4
 * @property {HighShelf} damp1
 * @property {HighShelf} damp2
 */

/** @returns {SfxState} */
const newSfxState = () => ({ sfx: -1, offset: 0, time: 0, prevKey: 0, prevVol: 0 })

/** @returns {Channel} */
const newChannel = () => ({
  main: newSfxState(),
  custom: newSfxState(),
  sfxMusic: -1,
  length: 0,
  canLoop: true,
  isMusic: false,
  last: newSynthParams(),
  fadeSynth: newSynthParams(),
  fade: 0,
  lastInstrument: 0,
  lastKey: 0,
  reverbIndex: 0,
  reverb2: new Float32Array(366),
  reverb4: new Float32Array(732),
  damp1: new HighShelf(2400, 1, -6),
  damp2: new HighShelf(1000, 1, -12),
})

/** @param {number} x @param {number} lo @param {number} hi */
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)

/**
 * @typedef {Object} EngineOptions
 * @property {Uint8Array | (() => Uint8Array)} sfx    The `sfx` region (or a function that gets it, if it can be replaced)
 * @property {Uint8Array | (() => Uint8Array)} music  The `music` region
 * @property {() => number} [random]  Uniform in [0, 1), for the noise instrument
 * @property {number} [volume]  Master volume, 0.5 like PICO-8
 */

/** @param {EngineOptions} options */
export function createEngine({ sfx: sfxSource, music: musicSource, random = Math.random, volume = 0.5 }) {
  const getSfx = typeof sfxSource === 'function' ? sfxSource : () => sfxSource
  const getMusic = typeof musicSource === 'function' ? musicSource : () => musicSource
  let sfx = getSfx()
  let song = getMusic()

  /** @type {Channel[]} */
  const channels = Array.from({ length: CHANNELS }, newChannel)
  const m = {
    /** Pattern being played, -1 for none. */
    pattern: -1,
    /** Number of patterns played since `music()` was called. */
    count: -1,
    /** Channels (bit mask) that `sfx()` must leave alone. */
    mask: 0,
    fadeVolume: 0,
    /** Per second. */
    fadeStep: 0,
    /** Position in the pattern, in ticks of 183 samples. */
    offset: -1,
    /** Length of the pattern, in ticks. */
    length: 0,
  }
  let paused = false
  let quiet = QUIET_SAMPLES

  // --- reading the regions ---------------------------------------------------------------------

  const speedOf = (/** @type {number} */ id) => Math.max(1, sfx[id * SFX_SIZE + 65])
  const loopStartOf = (/** @type {number} */ id) => sfx[id * SFX_SIZE + 66]
  const loopEndOf = (/** @type {number} */ id) => sfx[id * SFX_SIZE + 67]
  const songByte = (/** @type {number} */ pattern, /** @type {number} */ c) => song[pattern * 4 + c]

  // --- sfx -------------------------------------------------------------------------------------

  /**
   * Advances one channel's position in an sfx by one sample and, if the current note makes sound,
   * writes the voice for it into `out`.
   * @param {SfxState} cur
   * @param {import('./waveform.js').SynthParams} out
   * @param {number} freqFactor
   * @param {number} length  Notes after which to stop, 0 for no limit
   * @param {boolean} isMusic
   * @param {boolean} canLoop
   */
  function updateSfx(cur, out, freqFactor, length, isMusic, canLoop) {
    if (cur.sfx === -1) return
    const id = cur.sfx
    const base = id * SFX_SIZE
    const speed = speedOf(id)
    const loopStart = loopStartOf(id)
    const loopEnd = loopEndOf(id)

    const offset = cur.offset
    const perSample = 1 / (TICK * speed)
    let nextOffset = offset + perSample
    const nextTime = cur.time + perSample

    // looping is off when the start is not before the end
    const loopRange = loopEnd - loopStart
    if (loopRange > 0 && nextOffset >= loopEnd && canLoop) {
      nextOffset = ((nextOffset - loopStart) % loopRange) + loopStart
    }

    let hasEnd = false
    let endTime = NOTES
    if (length > 0) {
      hasEnd = true
      endTime = length
    }
    // PICO-8 ignores the length for music, except for the length of the pattern
    if (!isMusic && loopEnd === 0 && loopStart > 0) {
      hasEnd = true
      endTime = Math.min(endTime, loopStart)
    }
    // without a loop (or once `sfx(n, -2)` ended it) it ends after the length, or for sound effects
    // after the last audible note
    if (loopRange <= 0 || !canLoop) {
      hasEnd = true
      if (!isMusic) {
        let last = 0
        for (let n = 0; n < NOTES; n++) if ((sfx[base + n * 2 + 1] >> 1) & 7) last = n + 1
        endTime = Math.min(endTime, last)
      }
    }

    if (offset < NOTES) {
      const noteId = Math.floor(offset)
      const nextNoteId = Math.floor(nextOffset)
      const lo = sfx[base + noteId * 2]
      const hi = sfx[base + noteId * 2 + 1]
      const key = lo & 63
      let vol = ((hi >> 1) & 7) / 7
      let freq = keyToFreq(key) * freqFactor

      if (vol > 0) {
        const fx = (hi >> 4) & 7
        switch (fx) {
          case 1: {
            // slide: from the previous note and volume
            const t = offset % 1
            freq = keyToFreq(cur.prevKey) + (freq - keyToFreq(cur.prevKey)) * t
            if (cur.prevVol > 0) vol = cur.prevVol + (vol - cur.prevVol) * t
            break
          }
          case 2: {
            // vibrato: half a semitone
            const t = Math.abs(((7.5 * offset * TICK * speed) / SAMPLE_RATE) % 1 - 0.5) - 0.25
            freq = freq + (freq * 1.059463094359 - freq) * t
            break
          }
          case 3:
            freq *= 1 - (offset % 1)
            break
          case 4:
            vol *= offset % 1
            break
          case 5:
            vol *= 1 - (offset % 1)
            break
          case 6:
          case 7: {
            // arpeggio over the group of four notes the note is in; halved when the speed is <= 8
            const mm = (speed <= 8 ? 32 : 16) / (fx === 6 ? 4 : 8)
            const n = Math.floor((mm * 7.5 * offset * TICK * speed) / SAMPLE_RATE)
            const arp = (noteId & ~3) | (n & 3)
            freq = keyToFreq(sfx[base + arp * 2] & 63)
            break
          }
        }
        out.key = key
        out.freq = freq
        out.instrument = ((lo >> 6) & 3) | ((hi & 1) << 2)
        out.custom = (hi & 0x80) !== 0
        out.filters = sfx[base + 64]
        out.volume = vol
        out.isMusic = isMusic
        out.phi += freq / SAMPLE_RATE
      }

      if (nextNoteId !== noteId) {
        cur.prevKey = key
        cur.prevVol = ((hi >> 1) & 7) / 7
      }
    }

    cur.offset = nextOffset
    cur.time = nextTime
    if (hasEnd && nextTime >= endTime) cur.sfx = -1
  }

  /** The sample of a voice, with the volume of the music or sound effects applied. @param {import('./waveform.js').SynthParams} p */
  function sample(p) {
    let v = voice(p, random) * p.volume
    v *= p.isMusic ? m.fadeVolume * volume : volume
    return clamp(v, -1, 1)
  }

  // --- starting sounds -------------------------------------------------------------------------

  /** @param {number} id @param {number} chan @param {number} offset @param {number} length @param {boolean} isMusic */
  function launch(id, chan, offset, length, isMusic) {
    const ch = channels[chan]
    ch.main.sfx = id
    ch.main.offset = Math.max(0, offset)
    ch.main.time = 0
    ch.length = Math.max(0, length)
    ch.canLoop = true
    ch.isMusic = isMusic
    ch.lastInstrument = 0xff
    ch.lastKey = 0xff
    // sliding from the lowest note (C-2) is not audible, so it is the default "previous note"
    ch.main.prevKey = 24
    ch.main.prevVol = 0
    quiet = 0
  }

  /** @param {number} pattern */
  function setPattern(pattern) {
    // the previous music stops
    for (const ch of channels) {
      if (ch.isMusic) {
        ch.main.sfx = -1
        ch.sfxMusic = -1
      }
    }
    const stop = () => {
      m.pattern = -1
      m.count = -1
      m.offset = -1
      m.mask = 0
      m.length = 0
    }
    if (pattern < 0 || pattern > 63) return stop()

    // The pattern lasts as long as the first channel that does not loop; if all loop, as long as
    // the slowest, so that it ends when every channel has played its 32 notes.
    let looping = -1
    let notLooping = -1
    for (let i = 0; i < CHANNELS; i++) {
      const b = songByte(pattern, i)
      if (b & 0x40) continue
      const id = b & 0x3f
      const loopStart = loopStartOf(id)
      const loopEnd = loopEndOf(id)
      if (loopEnd > 0 && loopEnd > loopStart) {
        looping = Math.max(looping, NOTES * speedOf(id))
      } else {
        let end = NOTES
        if (loopEnd === 0 && loopStart > 0) end = Math.min(end, loopStart)
        notLooping = end * speedOf(id)
        break
      }
    }
    const duration = notLooping > 0 ? notLooping : looping
    if (duration <= 0) return stop()

    m.pattern = pattern
    m.offset = 0
    m.length = duration
    for (let i = 0; i < CHANNELS; i++) {
      const b = songByte(pattern, i)
      if (b & 0x40) continue
      const id = b & 0x3f
      if (channels[i].main.sfx === -1) launch(id, i, 0, 0, true)
      // a sound effect is playing: the music takes over when it ends
      else channels[i].sfxMusic = id
    }
    quiet = 0
  }

  // --- the public calls ------------------------------------------------------------------------

  /**
   * `sfx(n, channel, offset, length)`: -1 stops the sound of a channel (or of all non-music
   * channels), -2 ends its loop.
   * @param {number} id
   * @param {number} [chan]  -1 (the default) picks a channel
   * @param {number} [offset]  First note
   * @param {number} [length]  Number of notes
   */
  function playSfx(id, chan = -1, offset = 0, length = 0) {
    sfx = getSfx()
    id = Math.trunc(id)
    chan = Math.trunc(chan)
    offset = Math.trunc(offset)
    if (!(id >= -2 && id <= 63) || !(chan >= -1 && chan <= 3) || offset > 31) return

    if (id < 0) {
      for (let i = 0; i < CHANNELS; i++) {
        if (chan !== -1 && chan !== i) continue
        if (channels[i].isMusic) continue
        if (id === -1) channels[i].main.sfx = -1
        else channels[i].canLoop = false
      }
      return
    }

    const free = (/** @type {number} */ i) => ((1 << i) & m.mask) === 0
    if (chan === -1) {
      // a free channel, or one that already plays this sound
      for (let i = 0; i < CHANNELS; i++) {
        if (free(i) && (channels[i].main.sfx === -1 || channels[i].main.sfx === id)) {
          chan = i
          break
        }
      }
    }
    if (chan === -1) {
      // else the first channel that plays music
      for (let i = 0; i < CHANNELS; i++) {
        if (free(i) && channels[i].isMusic) {
          chan = i
          break
        }
      }
    }
    if (chan === -1) {
      // else the channel with the fastest sound, the latest if several
      let fastest = 255
      for (let i = 0; i < CHANNELS; i++) {
        if (!free(i)) continue
        const cur = channels[i].main.sfx
        if (cur < 0) continue
        if (speedOf(cur) <= fastest) {
          chan = i
          fastest = speedOf(cur)
        }
      }
    }
    if (chan === -1) return

    for (const ch of channels) if (ch.main.sfx === id) ch.main.sfx = -1
    // the music sound that is replaced comes back when this one ends
    if (channels[chan].main.sfx !== -1 && channels[chan].isMusic) channels[chan].sfxMusic = channels[chan].main.sfx
    launch(id, chan, offset, length, false)
  }

  /**
   * `music(pattern, fadeMs, mask)`: -1 stops (after the fade).
   * @param {number} pattern
   * @param {number} [fadeMs]
   * @param {number} [mask]  Channels that `sfx` must not use
   */
  function playMusic(pattern, fadeMs = 0, mask = 0) {
    sfx = getSfx()
    song = getMusic()
    pattern = Math.trunc(pattern)
    if (!(pattern >= -1 && pattern <= 63)) return
    if (pattern === -1) {
      // stops when the fade is over
      m.fadeStep = fadeMs <= 0 ? -Infinity : -m.fadeVolume * (1000 / fadeMs)
      return
    }
    m.count = 0
    m.mask = mask & 0xf
    m.fadeVolume = 1
    m.fadeStep = 0
    if (fadeMs > 0) {
      m.fadeVolume = 0
      m.fadeStep = 1000 / fadeMs
    }
    setPattern(pattern)
  }

  // --- rendering -------------------------------------------------------------------------------

  /** Whether anything can still make sound. */
  const busy = () => m.pattern !== -1 || channels.some((ch) => ch.main.sfx !== -1 || ch.sfxMusic !== -1 || ch.fade > 0)

  /** Moves the music on by one sample. */
  function advanceMusic() {
    m.offset += 1 / TICK
    m.fadeVolume = clamp(m.fadeVolume + m.fadeStep / SAMPLE_RATE, 0, 1)
    if (m.fadeStep < 0 && m.fadeVolume <= 0) {
      setPattern(-1)
    } else if (m.offset >= m.length) {
      const p = m.pattern
      let next = p + 1
      let count = m.count + 1
      if (songByte(p, 2) & 0x80) {
        next = -1
        count = -1
      } else if (songByte(p, 1) & 0x80) {
        // loop back to the last pattern that starts a loop
        while (--next > 0 && !(songByte(next, 0) & 0x80));
      }
      m.count = count
      setPattern(next)
    }
  }

  /** One sample of one channel. @param {number} c */
  function channelSample(c) {
    const ch = channels[c]
    if (c === 0 && m.pattern !== -1 && !paused) advanceMusic()

    // a music sfx that was waiting for the sound effect of this channel
    if (ch.main.sfx === -1 && ch.sfxMusic !== -1 && !paused) {
      const id = ch.sfxMusic
      const speed = speedOf(id)
      let at = m.offset / speed
      let play = true
      const loopRange = loopEndOf(id) - loopStartOf(id)
      if (loopRange > 0 && ch.canLoop) {
        if (at > loopStartOf(id)) at = ((at - loopStartOf(id)) % loopRange) + loopStartOf(id)
      } else if (at > NOTES) play = false
      if (play) launch(id, c, at, 0, true)
      ch.sfxMusic = -1
    }

    const last = ch.last
    const next = newSynthParams()
    next.phi = last.phi
    next.lastAdvance = last.lastAdvance
    next.lastSample = last.lastSample
    // the filters outlive the note, so that a reverb tail is not cut off when the sound ends
    next.filters = last.filters
    let value = 0

    if (!paused) {
      const baseOffset = ch.main.offset
      updateSfx(ch.main, next, 1, ch.length, ch.isMusic, ch.canLoop)
      let restart = next.instrument !== ch.lastInstrument || next.key !== ch.lastKey
      ch.lastInstrument = next.instrument
      ch.lastKey = next.key

      if (next.volume > 0) {
        if (next.custom) {
          // another sfx is the instrument; it plays from its start for every note, transposed
          if (ch.main.offset < baseOffset) restart = true
          if (ch.custom.sfx === -1 && Math.floor(baseOffset) !== Math.floor(ch.main.offset)) restart = true
          if (restart) {
            ch.custom.sfx = next.instrument
            ch.custom.offset = 0
            ch.custom.time = 0
          }
          next.phi = last.phi
          const factor = next.freq / keyToFreq(24)
          const mainVolume = next.volume
          // a silent note of the instrument is silent (the volume is set by the instrument's own notes)
          next.volume = 0
          updateSfx(ch.custom, next, factor, 0, false, true)
          next.volume *= mainVolume
        }
        if (next.volume > 0) value = sample(next)
      }
    }

    // a sudden change of pitch, volume or instrument is smoothed with a short crossfade
    const threshold = Math.min(next.freq, last.freq) * 0.01
    if (Math.abs(next.volume - last.volume) > 0.1 || Math.abs(next.freq - last.freq) > threshold || next.instrument !== last.instrument) {
      if (ch.fade <= 0) ch.fadeSynth = { ...last }
      ch.fade = 1
      // the phase is reset between notes so that it does not lose precision
      next.phi %= 1
    }
    ch.last = next

    let reverb = Math.floor(next.filters / 24) % 3
    let dampen = Math.floor(next.filters / 72) % 3
    let r1 = reverb === 1 ? 1 : 0
    let r2 = reverb === 2 ? 1 : 0
    let d1 = dampen === 1 ? 1 : 0
    let d2 = dampen === 2 ? 1 : 0

    if (ch.fade > 0) {
      const f = ch.fadeSynth
      f.phi += f.freq / SAMPLE_RATE
      value += (sample(f) - value) * ch.fade
      reverb = Math.floor(f.filters / 24) % 3
      dampen = Math.floor(f.filters / 72) % 3
      r1 += ((reverb === 1 ? 1 : 0) - r1) * ch.fade
      r2 += ((reverb === 2 ? 1 : 0) - r2) * ch.fade
      d1 += ((dampen === 1 ? 1 : 0) - d1) * ch.fade
      d2 += ((dampen === 2 ? 1 : 0) - d2) * ch.fade
      ch.fade -= 130 / SAMPLE_RATE
    }

    // reverb: feedback delays of 2 and 4 ticks
    const i = ch.reverbIndex++
    if (r1 > 0) value += r1 * ch.reverb2[i % 366] * 0.5
    if (r2 > 0) value += r2 * ch.reverb4[i % 732] * 0.5
    ch.reverb2[i % 366] = value
    ch.reverb4[i % 732] = value

    const v1 = ch.damp1.run(value)
    if (d1 > 0) value += (v1 - value) * d1
    const v2 = ch.damp2.run(value)
    if (d2 > 0) value += (v2 - value) * d2

    return clamp(value, -0.99, 0.99)
  }

  /**
   * Fills `out` with the next samples (mono, 22050 Hz, -1..1). Once nothing has played for a while
   * this is only zeros and costs nothing.
   * @param {Float32Array} out
   */
  function render(out) {
    sfx = getSfx()
    song = getMusic()
    if (quiet >= QUIET_SAMPLES && !busy()) {
      out.fill(0)
      return
    }
    for (let i = 0; i < out.length; i++) {
      let mix = 0
      for (let c = 0; c < CHANNELS; c++) mix += channelSample(c)
      out[i] = clamp(mix, -1, 1)
      if (busy()) quiet = 0
      else quiet++
    }
  }

  return {
    sfx: playSfx,
    music: playMusic,
    render,
    /** Silences everything now. */
    stop() {
      setPattern(-1)
      for (const ch of channels) {
        ch.main.sfx = -1
        ch.custom.sfx = -1
        ch.sfxMusic = -1
      }
    },
    /** Pauses or resumes; the sounds keep their place. @param {boolean} value */
    setPaused(value) {
      paused = value
    },
    /** Whether `render` currently produces anything (false when idle). */
    get active() {
      return quiet < QUIET_SAMPLES || busy()
    },
    /** Where everything is, for playheads: the music pattern and per channel the sfx and note position. */
    get state() {
      return {
        pattern: m.pattern,
        count: m.count,
        /** Ticks into the music pattern (0 when there is none). */
        tick: m.pattern === -1 ? 0 : Math.max(0, Math.floor(m.offset)),
        channels: channels.map((ch) => ({ sfx: ch.main.sfx, note: ch.main.offset, music: ch.isMusic && ch.main.sfx !== -1 })),
      }
    },
  }
}

/** @typedef {ReturnType<typeof createEngine>} Engine */
