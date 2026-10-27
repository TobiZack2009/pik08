import { createEngine } from '../audio/engine.js'
import { createAudioOutput } from '../audio/output.js'

/**
 * The editors' sound: one synth reading the live `sfx` and `music` regions of the project, so an
 * edit is heard as it is made, and one Web Audio output for it. The output only starts on the
 * first play, which comes from a click or key press, as browsers require.
 */

/** The channel the editors audition on. Music uses all four, so this interrupts channel 3 then. */
const PREVIEW_CHANNEL = 3

/**
 * @typedef {Object} SoundOptions
 * @property {{ start: () => Promise<void>, close: () => Promise<void> }} [output]  Replaces the Web Audio output (tests)
 * @property {() => number} [random]  For the noise instrument (tests)
 */

/**
 * @param {import('./store.js').Project} project
 * @param {SoundOptions} [options]
 */
export function createSoundService(project, options = {}) {
  const engine = createEngine({
    sfx: () => project.region('sfx'),
    music: () => project.region('music'),
    random: options.random,
  })
  const output = options.output ?? createAudioOutput(engine)

  // a new cart replaces the regions: whatever was playing belongs to the old one
  const unsubscribe = project.on('load', () => engine.stop())

  /** Starts the clock if it is not running. */
  function ensureStarted() {
    return output.start()
  }

  return {
    engine,
    /**
     * Plays an sfx, or a part of it, from where an editor says: `offset` is the first note and
     * `length` the number of notes (0 for the rest of the sound).
     * @param {number} id
     * @param {number} [offset]
     * @param {number} [length]
     */
    play(id, offset = 0, length = 0) {
      void ensureStarted()
      engine.sfx(id, PREVIEW_CHANNEL, offset, length)
    },
    /**
     * Plays the music from a pattern.
     * @param {number} pattern
     */
    playMusic(pattern) {
      void ensureStarted()
      engine.music(pattern)
    },
    stop() {
      engine.stop()
    },
    /** Whether an sfx is sounding on any channel. @param {number} id */
    playing(id) {
      return engine.state.channels.some((c) => c.sfx === id)
    },
    /**
     * The note an sfx has reached (fractional), or -1 when it is not playing. For playheads.
     * @param {number} id
     */
    position(id) {
      const ch = engine.state.channels.find((c) => c.sfx === id)
      return ch ? ch.note : -1
    },
    /**
     * The music pattern that is playing, -1 when no music is. For playheads.
     */
    musicBar() {
      const { pattern, channels } = engine.state
      return channels.some((c) => c.music) ? pattern : -1
    },
    ensureStarted,
    /** Silences and releases the audio context. */
    async destroy() {
      unsubscribe()
      engine.stop()
      await output.close()
    },
  }
}

/** @typedef {ReturnType<typeof createSoundService>} SoundService */
