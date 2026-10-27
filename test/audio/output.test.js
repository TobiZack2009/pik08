import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAudioOutput } from '../../src/audio/output.js'

/** A stand-in for an AudioContext that records what is scheduled. */
function fakeContext(state = 'running') {
  const ctx = {
    currentTime: 0,
    state,
    destination: /** @type {AudioNode} */ ({}),
    started: /** @type {number[]} */ ([]),
    buffers: /** @type {Float32Array[]} */ ([]),
    resumed: 0,
    closed: false,
    async resume() {
      ctx.resumed++
      ctx.state = 'running'
    },
    async close() {
      ctx.closed = true
      ctx.state = 'closed'
    },
    createBuffer(/** @type {number} */ _channels, /** @type {number} */ length) {
      const data = new Float32Array(length)
      return /** @type {any} */ ({
        data,
        copyToChannel(/** @type {Float32Array} */ src) {
          data.set(src)
        },
      })
    },
    createBufferSource() {
      return /** @type {any} */ ({
        buffer: null,
        connect() {},
        start(/** @type {number} */ when) {
          ctx.started.push(when)
          ctx.buffers.push(this.buffer.data)
        },
      })
    },
  }
  return ctx
}

function fakeEngine(active = true) {
  const e = {
    active,
    renders: 0,
    render(/** @type {Float32Array} */ out) {
      e.renders++
      out.fill(0.25)
    },
  }
  return e
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createAudioOutput', () => {
  it('schedules contiguous chunks up to the lookahead', async () => {
    vi.useFakeTimers()
    const ctx = fakeContext()
    const engine = fakeEngine()
    const out = createAudioOutput(engine, { context: ctx, lookahead: 0.2, chunk: 1000 })
    await out.start()
    expect(ctx.started.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < ctx.started.length; i++) {
      expect(ctx.started[i] - ctx.started[i - 1]).toBeCloseTo(1000 / 22050, 9)
    }
    expect(ctx.started[ctx.started.length - 1]).toBeLessThan(0.2)
    expect(ctx.buffers[0][0]).toBe(0.25)
    await out.close()
  })

  it('schedules more as the clock moves on', async () => {
    vi.useFakeTimers()
    const ctx = fakeContext()
    const out = createAudioOutput(fakeEngine(), { context: ctx, lookahead: 0.1, chunk: 1000, interval: 25 })
    await out.start()
    const first = ctx.started.length
    ctx.currentTime = 0.1
    vi.advanceTimersByTime(25)
    expect(ctx.started.length).toBeGreaterThan(first)
    await out.close()
  })

  it('renders nothing while the engine is idle, and starts again when it is not', async () => {
    vi.useFakeTimers()
    const ctx = fakeContext()
    const engine = fakeEngine(false)
    const out = createAudioOutput(engine, { context: ctx, lookahead: 0.1, chunk: 1000, interval: 25 })
    await out.start()
    vi.advanceTimersByTime(200)
    expect(engine.renders).toBe(0)
    expect(ctx.started).toEqual([])
    engine.active = true
    ctx.currentTime = 1
    vi.advanceTimersByTime(25)
    expect(engine.renders).toBeGreaterThan(0)
    // the first chunk after the pause starts at once, not in the past
    expect(ctx.started[0]).toBeGreaterThanOrEqual(1)
    await out.close()
  })

  it('resumes a suspended context', async () => {
    vi.useFakeTimers()
    const ctx = fakeContext('suspended')
    const out = createAudioOutput(fakeEngine(), { context: ctx })
    await out.start()
    expect(ctx.resumed).toBe(1)
    await out.close()
  })

  it('resumes again on a later start if the browser kept it suspended', async () => {
    vi.useFakeTimers()
    const ctx = fakeContext('suspended')
    ctx.resume = async () => {
      ctx.resumed++
    }
    const out = createAudioOutput(fakeEngine(), { context: ctx })
    await out.start()
    await out.start()
    expect(ctx.resumed).toBe(2)
    await out.close()
  })

  it('stops scheduling when stopped, and releases the context when closed', async () => {
    vi.useFakeTimers()
    const ctx = fakeContext()
    const out = createAudioOutput(fakeEngine(), { context: ctx, lookahead: 0.1, chunk: 1000 })
    await out.start()
    expect(out.running).toBe(true)
    out.stop()
    expect(out.running).toBe(false)
    const n = ctx.started.length
    ctx.currentTime = 5
    vi.advanceTimersByTime(500)
    expect(ctx.started.length).toBe(n)
    await out.close()
    expect(ctx.closed).toBe(true)
  })

  it('does nothing without Web Audio', async () => {
    const out = createAudioOutput(fakeEngine())
    await out.start()
    expect(out.running).toBe(false)
  })
})
