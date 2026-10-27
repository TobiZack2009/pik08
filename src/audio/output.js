import { SAMPLE_RATE } from './waveform.js'

/**
 * Plays an engine through Web Audio. The engine is rendered in short chunks a little ahead of the
 * clock of the audio context and each chunk is scheduled as an `AudioBufferSourceNode` that starts
 * exactly where the previous one ended. This needs no worklet file, so it also works in the
 * single-file build. The price is a delay of about `lookahead` seconds before an edit of the
 * regions is heard.
 *
 * While the engine is idle nothing is rendered or scheduled.
 */

/**
 * The part of an `AudioContext` that is used (a fake can stand in for it in tests).
 * @typedef {Object} AudioContextLike
 * @property {number} currentTime
 * @property {string} state
 * @property {AudioNode} destination
 * @property {() => Promise<void>} resume
 * @property {() => Promise<void>} close
 * @property {(channels: number, length: number, rate: number) => AudioBuffer} createBuffer
 * @property {() => AudioBufferSourceNode} createBufferSource
 */

/**
 * @typedef {Object} OutputOptions
 * @property {AudioContextLike} [context]  By default a new `AudioContext` at 22050 Hz
 * @property {number} [lookahead]  Seconds of sound kept scheduled ahead of the clock
 * @property {number} [chunk]  Samples per scheduled buffer
 * @property {number} [interval]  Milliseconds between two checks
 */

/**
 * @param {{ render: (out: Float32Array) => void, readonly active: boolean }} engine
 * @param {OutputOptions} [options]
 */
export function createAudioOutput(engine, options = {}) {
  const { lookahead = 0.1, chunk = 1024, interval = 25 } = options
  /** @type {AudioContextLike | null} */
  let ctx = options.context ?? null
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null
  /** Context time at which the next chunk starts. */
  let nextTime = 0
  let scratch = new Float32Array(chunk)

  function pump() {
    if (!ctx) return
    const horizon = ctx.currentTime + lookahead
    // a hole (the engine was idle, or the tab was in the background): start again from now
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.02
    while (nextTime < horizon) {
      if (!engine.active) {
        nextTime = ctx.currentTime + 0.02
        return
      }
      engine.render(scratch)
      const buffer = ctx.createBuffer(1, chunk, SAMPLE_RATE)
      buffer.copyToChannel(scratch, 0)
      const node = ctx.createBufferSource()
      node.buffer = buffer
      node.connect(ctx.destination)
      node.start(nextTime)
      nextTime += chunk / SAMPLE_RATE
    }
  }

  return {
    /** Starts the clock. Call it from a user gesture the first time, or the browser keeps the context suspended. */
    async start() {
      if (timer !== null) {
        // running: a later gesture may be what lets a suspended context go on
        if (ctx?.state === 'suspended') await ctx.resume().catch(() => {})
        return
      }
      if (!ctx) {
        const Ctor = globalThis.AudioContext ?? /** @type {any} */ (globalThis).webkitAudioContext
        if (!Ctor) return
        ctx = /** @type {AudioContextLike} */ (new Ctor({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' }))
      }
      scratch = new Float32Array(chunk)
      nextTime = 0
      timer = setInterval(pump, interval)
      if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
      pump()
    },
    /** Stops scheduling; what is already scheduled (at most `lookahead`) still plays out. */
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
    },
    /** Stops and releases the audio context. */
    async close() {
      this.stop()
      const c = ctx
      ctx = null
      if (c && c.state !== 'closed') await c.close().catch(() => {})
    },
    get running() {
      return timer !== null
    },
    /** Runs one scheduling round now (for tests). */
    pump,
  }
}
