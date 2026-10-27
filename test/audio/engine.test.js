import { describe, expect, it } from 'vitest'
import { createEngine } from '../../src/audio/engine.js'
import { writePattern } from '../../src/ui/editors/music/music-data.js'
import { writeNote } from '../../src/ui/editors/sfx/sfx-data.js'
import { SAMPLE_RATE, crossings, engineFor, peak, regions, render, repeat, roughness, setSfx } from './helpers.js'

const TRI = 0
const SQUARE = 3
const NOISE = 6

/** A long steady note: 32 notes of the same pitch, looping. */
const drone = (/** @type {number} */ key, wave = TRI, vol = 7, fx = 0) => ({
  notes: repeat([key, wave, vol, fx]),
  speed: 16,
  loopStart: 0,
  loopEnd: 32,
})

/** Four silent channels, then a pattern that plays `ids` on channels 0..n. */
function pattern(/** @type {Uint8Array} */ music, /** @type {number} */ id, /** @type {(number | null)[]} */ ids, flags = {}) {
  writePattern(music, id, {
    channels: [0, 1, 2, 3].map((c) => ({ sfx: ids[c] ?? 0, enabled: ids[c] != null })),
    loopStart: false,
    loopBack: false,
    stop: false,
    ...flags,
  })
}

describe('pitch and volume', () => {
  it('plays a note at its frequency', () => {
    const r = regions()
    setSfx(r.sfx, 0, drone(33))
    const e = engineFor(r)
    e.sfx(0)
    render(e, 2000)
    expect(crossings(render(e, SAMPLE_RATE))).toBeGreaterThanOrEqual(438)
    expect(crossings(render(e, SAMPLE_RATE))).toBeLessThanOrEqual(442)
  })

  it('plays an octave higher at double the frequency', () => {
    const r = regions()
    setSfx(r.sfx, 0, drone(45))
    const e = engineFor(r)
    e.sfx(0)
    render(e, 2000)
    expect(Math.abs(crossings(render(e, SAMPLE_RATE)) - 880)).toBeLessThanOrEqual(3)
  })

  it('scales the level with the volume', () => {
    const r = regions()
    setSfx(r.sfx, 0, drone(33, TRI, 7))
    setSfx(r.sfx, 1, drone(33, TRI, 3))
    const loud = engineFor(r)
    loud.sfx(0)
    render(loud, 2000)
    const soft = engineFor(r)
    soft.sfx(1)
    render(soft, 2000)
    const ratio = peak(render(loud, 4000)) / peak(render(soft, 4000))
    expect(ratio).toBeCloseTo(7 / 3, 1)
  })

  it('stays within the range of the output', () => {
    const r = regions()
    for (let i = 0; i < 4; i++) setSfx(r.sfx, i, drone(40 + i, SQUARE))
    const e = engineFor(r)
    for (let i = 0; i < 4; i++) e.sfx(i, i)
    expect(peak(render(e, 8000))).toBeLessThanOrEqual(1)
  })

  it('is silent when no sound plays', () => {
    const e = engineFor(regions())
    expect(peak(render(e, 1000))).toBe(0)
  })
})

describe('timing', () => {
  it('lasts 183 samples per speed unit and note, up to the last audible note', () => {
    const r = regions()
    setSfx(r.sfx, 0, { notes: repeat([33, TRI, 7], 3), speed: 1 })
    const e = engineFor(r)
    e.sfx(0)
    render(e, 500)
    expect(e.state.channels[0].sfx).toBe(0)
    render(e, 100)
    expect(e.state.channels[0].sfx).toBe(-1)
  })

  it('scales with the speed', () => {
    const r = regions()
    setSfx(r.sfx, 0, { notes: repeat([33, TRI, 7], 2), speed: 10 })
    const e = engineFor(r)
    e.sfx(0)
    render(e, 3500)
    expect(e.state.channels[0].sfx).toBe(0)
    render(e, 300)
    expect(e.state.channels[0].sfx).toBe(-1)
  })

  it('becomes silent when it has ended', () => {
    const r = regions()
    setSfx(r.sfx, 0, { notes: repeat([33, TRI, 7], 2), speed: 1 })
    const e = engineFor(r)
    e.sfx(0)
    render(e, 1000)
    expect(peak(render(e, 1000))).toBe(0)
  })

  it('stops at the loop start when the loop end is 0 and the start is not', () => {
    const r = regions()
    setSfx(r.sfx, 0, { notes: repeat([33, TRI, 7]), speed: 1, loopStart: 4, loopEnd: 0 })
    const e = engineFor(r)
    e.sfx(0)
    render(e, 4 * 183 - 20)
    expect(e.state.channels[0].sfx).toBe(0)
    render(e, 60)
    expect(e.state.channels[0].sfx).toBe(-1)
  })

  it('loops between the loop points', () => {
    const r = regions()
    setSfx(r.sfx, 0, { notes: repeat([33, TRI, 7]), speed: 1, loopStart: 0, loopEnd: 4 })
    const e = engineFor(r)
    e.sfx(0)
    render(e, 20000)
    expect(e.state.channels[0].sfx).toBe(0)
    expect(e.state.channels[0].note).toBeLessThan(4)
  })

  it('ends a loop with sfx(-2) after the current pass', () => {
    const r = regions()
    setSfx(r.sfx, 0, { notes: repeat([33, TRI, 7], 8), speed: 1, loopStart: 0, loopEnd: 4 })
    const e = engineFor(r)
    e.sfx(0)
    render(e, 5000)
    e.sfx(-2, 0)
    render(e, 5000)
    expect(e.state.channels[0].sfx).toBe(-1)
  })

  it('starts at the offset and ends after the length', () => {
    const r = regions()
    setSfx(r.sfx, 0, { notes: repeat([33, TRI, 7]), speed: 1 })
    const e = engineFor(r)
    e.sfx(0, 0, 10, 2)
    expect(e.state.channels[0].note).toBe(10)
    render(e, 300)
    expect(e.state.channels[0].sfx).toBe(0)
    render(e, 200)
    expect(e.state.channels[0].sfx).toBe(-1)
  })
})

describe('effects', () => {
  /** The first and second half of a one-note sfx, at speed 16 (2928 samples per note). */
  function halves(/** @type {number} */ fx) {
    const r = regions()
    setSfx(r.sfx, 0, { notes: [[33, TRI, 7, fx]], speed: 16 })
    const e = engineFor(r)
    e.sfx(0)
    render(e, 300)
    return [render(e, 1200), render(e, 1200)]
  }

  it('lowers the pitch with drop', () => {
    const [a, b] = halves(3)
    expect(crossings(a)).toBeGreaterThan(crossings(b))
  })

  it('raises the level with fade in', () => {
    const [a, b] = halves(4)
    expect(peak(b)).toBeGreaterThan(peak(a) * 1.3)
  })

  it('lowers the level with fade out', () => {
    const [a, b] = halves(5)
    expect(peak(a)).toBeGreaterThan(peak(b) * 1.3)
  })

  it('moves the pitch with vibrato', () => {
    const r = regions()
    setSfx(r.sfx, 0, { notes: repeat([33, TRI, 7, 2], 4), speed: 16 })
    const plain = regions()
    setSfx(plain.sfx, 0, { notes: repeat([33, TRI, 7, 0], 4), speed: 16 })
    const a = engineFor(r)
    const b = engineFor(plain)
    a.sfx(0)
    b.sfx(0)
    const x = render(a, 5000)
    const y = render(b, 5000)
    expect(x).not.toEqual(y)
  })

  it('slides from the previous note', () => {
    const r = regions()
    setSfx(r.sfx, 0, {
      notes: [
        [21, TRI, 7, 0],
        [45, TRI, 7, 1],
      ],
      speed: 16,
    })
    const e = engineFor(r)
    e.sfx(0)
    render(e, 2928 + 300)
    const early = crossings(render(e, 1000))
    render(e, 800)
    const late = crossings(render(e, 1000))
    expect(late).toBeGreaterThan(early)
  })

  it('arpeggiates over four notes', () => {
    const r = regions()
    const notes = [
      [24, TRI, 7, 6],
      [31, TRI, 7, 6],
      [36, TRI, 7, 6],
      [43, TRI, 7, 6],
    ]
    setSfx(r.sfx, 0, { notes, speed: 16 })
    const plain = regions()
    setSfx(plain.sfx, 0, { notes: notes.map((n) => [n[0], n[1], n[2], 0]), speed: 16 })
    const a = engineFor(r)
    const b = engineFor(plain)
    a.sfx(0)
    b.sfx(0)
    // the first note of the plain one is just 24; the arpeggio visits the others as well
    const hi = crossings(render(a, 1500))
    const lo = crossings(render(b, 1500))
    expect(hi).toBeGreaterThan(lo)
  })
})

describe('instruments and filters', () => {
  it('uses another sfx as a custom instrument, transposed', () => {
    const r = regions()
    // sfx 0: the instrument, a triangle at C-2
    setSfx(r.sfx, 0, { notes: repeat([24, TRI, 7]), speed: 1 })
    // sfx 1 plays pitch 36 (an octave above) with instrument 0 (wave 8)
    setSfx(r.sfx, 1, { notes: repeat([36, 8, 7]), speed: 8, loopStart: 0, loopEnd: 32 })
    const e = engineFor(r)
    e.sfx(1)
    render(e, 2000)
    const hz = crossings(render(e, 1000)) * (SAMPLE_RATE / 1000)
    expect(Math.abs(hz - 523.25)).toBeLessThan(25)
  })

  it('has a noise instrument that is seeded and different from silence', () => {
    const r = regions()
    setSfx(r.sfx, 0, drone(40, NOISE))
    const a = engineFor(r, 7)
    const b = engineFor(r, 7)
    const c = engineFor(r, 8)
    a.sfx(0)
    b.sfx(0)
    c.sfx(0)
    const x = render(a, 4000)
    expect(peak(x)).toBeGreaterThan(0.01)
    expect(render(b, 4000)).toEqual(x)
    expect(render(c, 4000)).not.toEqual(x)
  })

  it('adds a tail with reverb', () => {
    const r = regions()
    setSfx(r.sfx, 0, { notes: repeat([33, SQUARE, 7], 2), speed: 1 })
    setSfx(r.sfx, 1, { notes: repeat([33, SQUARE, 7], 2), speed: 1, filters: 24 })
    setSfx(r.sfx, 2, { notes: repeat([33, SQUARE, 7], 2), speed: 1, filters: 48 })
    const tail = (/** @type {number} */ id) => {
      const e = engineFor(r)
      e.sfx(id)
      render(e, 600)
      return peak(render(e, 2000))
    }
    expect(tail(0)).toBe(0)
    expect(tail(1)).toBeGreaterThan(0.01)
    expect(tail(2)).toBeGreaterThan(0.01)
  })

  it('takes the brightness away with dampen', () => {
    const r = regions()
    setSfx(r.sfx, 0, drone(50, SQUARE))
    setSfx(r.sfx, 1, { ...drone(50, SQUARE), filters: 72 })
    setSfx(r.sfx, 2, { ...drone(50, SQUARE), filters: 144 })
    const rough = (/** @type {number} */ id) => {
      const e = engineFor(r)
      e.sfx(id)
      render(e, 1000)
      return roughness(render(e, 6000))
    }
    const plain = rough(0)
    expect(rough(1)).toBeLessThan(plain)
    expect(rough(2)).toBeLessThan(rough(1))
  })

  it('detunes with a second wave', () => {
    const r = regions()
    setSfx(r.sfx, 0, drone(33, SQUARE))
    setSfx(r.sfx, 1, { ...drone(33, SQUARE), filters: 8 })
    const a = engineFor(r)
    const b = engineFor(r)
    a.sfx(0)
    b.sfx(1)
    expect(render(b, 3000)).not.toEqual(render(a, 3000))
  })
})

describe('sfx() channel choice', () => {
  const playing = (/** @type {ReturnType<typeof createEngine>} */ e) => e.state.channels.map((c) => c.sfx)

  function many() {
    const r = regions()
    for (let i = 0; i < 8; i++) setSfx(r.sfx, i, drone(30 + i))
    return r
  }

  it('uses the first free channel', () => {
    const e = engineFor(many())
    e.sfx(1)
    e.sfx(2)
    e.sfx(3)
    expect(playing(e)).toEqual([1, 2, 3, -1])
  })

  it('restarts a sound on the channel it is already on', () => {
    const e = engineFor(many())
    e.sfx(1)
    e.sfx(2)
    e.sfx(1)
    expect(playing(e)).toEqual([1, 2, -1, -1])
  })

  it('uses a given channel', () => {
    const e = engineFor(many())
    e.sfx(5, 2)
    expect(playing(e)).toEqual([-1, -1, 5, -1])
  })

  it('stops one channel or all with -1', () => {
    const e = engineFor(many())
    e.sfx(1)
    e.sfx(2)
    e.sfx(-1, 0)
    expect(playing(e)).toEqual([-1, 2, -1, -1])
    e.sfx(-1)
    expect(playing(e)).toEqual([-1, -1, -1, -1])
  })

  it('ignores numbers out of range', () => {
    const e = engineFor(many())
    e.sfx(64)
    e.sfx(1, 4)
    e.sfx(1, 0, 32)
    expect(playing(e)).toEqual([-1, -1, -1, -1])
  })

  it('takes the fastest channel when all are busy', () => {
    const r = many()
    setSfx(r.sfx, 4, { ...drone(30), speed: 4 })
    const e = engineFor(r)
    e.sfx(0)
    e.sfx(1)
    e.sfx(4)
    e.sfx(2)
    expect(playing(e)).toEqual([0, 1, 4, 2])
    // all busy: the new sound replaces the one with the smallest speed number (sfx 4)
    e.sfx(7)
    expect(playing(e)).toEqual([0, 1, 7, 2])
  })
})

describe('music', () => {
  /** Sounds of 32 ticks without a loop; one pattern is 32 * 183 = 5856 samples. */
  function song() {
    const r = regions()
    for (let i = 0; i < 4; i++) setSfx(r.sfx, i, { notes: repeat([30 + i, TRI, 7]), speed: 1 })
    return r
  }
  const PATTERN = 32 * 183

  it('plays the sfx of a pattern on its channels', () => {
    const r = song()
    pattern(r.music, 0, [0, 1, null, 3])
    const e = engineFor(r)
    e.music(0)
    expect(e.state.pattern).toBe(0)
    expect(e.state.channels.map((c) => c.sfx)).toEqual([0, 1, -1, 3])
    expect(e.state.channels.map((c) => c.music)).toEqual([true, true, false, true])
    expect(peak(render(e, 2000))).toBeGreaterThan(0.05)
  })

  it('moves on to the next pattern, and stops at the end', () => {
    const r = song()
    pattern(r.music, 0, [0])
    pattern(r.music, 1, [1])
    const e = engineFor(r)
    e.music(0)
    render(e, PATTERN - 200)
    expect(e.state.pattern).toBe(0)
    render(e, 400)
    expect(e.state.pattern).toBe(1)
    expect(e.state.channels[0].sfx).toBe(1)
    // pattern 2 has all its channels off, so the music is over
    pattern(r.music, 2, [])
    render(e, PATTERN + 400)
    expect(e.state.pattern).toBe(-1)
  })

  it('stops at a stop flag', () => {
    const r = song()
    pattern(r.music, 0, [0], { stop: true })
    pattern(r.music, 1, [1])
    const e = engineFor(r)
    e.music(0)
    render(e, PATTERN + 400)
    expect(e.state.pattern).toBe(-1)
  })

  it('loops back to the loop start', () => {
    const r = song()
    pattern(r.music, 0, [0], { loopStart: true })
    pattern(r.music, 1, [1], { loopBack: true })
    const e = engineFor(r)
    e.music(0)
    render(e, PATTERN * 2 + 400)
    expect(e.state.pattern).toBe(0)
    expect(e.state.count).toBe(2)
  })

  it('takes the length of the pattern from the first sfx that does not loop', () => {
    const r = song()
    // channel 0 loops (so it does not set the length), channel 1 is 32 ticks of speed 1
    setSfx(r.sfx, 0, { ...drone(30), speed: 2 })
    pattern(r.music, 0, [0, 1])
    pattern(r.music, 1, [2])
    const e = engineFor(r)
    e.music(0)
    render(e, PATTERN + 300)
    expect(e.state.pattern).toBe(1)
  })

  it('fades out and stops with music(-1, ms)', () => {
    const r = song()
    pattern(r.music, 0, [0], { loopStart: true })
    pattern(r.music, 1, [1], { loopBack: true })
    const e = engineFor(r)
    e.music(0)
    render(e, 1000)
    e.music(-1, 100)
    render(e, 1500)
    expect(e.state.pattern).toBe(0)
    render(e, 1500)
    expect(e.state.pattern).toBe(-1)
  })

  it('stops at once with music(-1)', () => {
    const r = song()
    pattern(r.music, 0, [0])
    const e = engineFor(r)
    e.music(0)
    render(e, 500)
    e.music(-1)
    render(e, 10)
    expect(e.state.pattern).toBe(-1)
    expect(e.state.channels[0].music).toBe(false)
  })

  it('fades in', () => {
    const r = song()
    setSfx(r.sfx, 0, drone(33))
    pattern(r.music, 0, [0])
    const e = engineFor(r)
    e.music(0, 400)
    const start = peak(render(e, 1000))
    render(e, 6000)
    expect(peak(render(e, 1000))).toBeGreaterThan(start * 3)
  })

  it('keeps the masked channels free of sfx()', () => {
    const r = song()
    setSfx(r.sfx, 5, drone(40))
    pattern(r.music, 0, [0, null, null, null])
    const e = engineFor(r)
    e.music(0, 0, 0b0011)
    e.sfx(5)
    expect(e.state.channels[2].sfx).toBe(5)
    expect(e.state.channels[0].sfx).toBe(0)
  })

  it('lets a sound effect take over a music channel and gives it back', () => {
    const r = song()
    setSfx(r.sfx, 5, { notes: repeat([40, TRI, 7], 2), speed: 1 })
    pattern(r.music, 0, [0, 1, 2, 3])
    const e = engineFor(r)
    e.music(0)
    e.sfx(5, 0)
    expect(e.state.channels[0].sfx).toBe(5)
    render(e, 1500)
    expect(e.state.channels[0].sfx).toBe(0)
  })

  it('ignores a pattern out of range', () => {
    const e = engineFor(song())
    e.music(64)
    expect(e.state.pattern).toBe(-1)
  })
})

describe('editing while playing', () => {
  it('is heard in the middle of a note', () => {
    const r = regions()
    setSfx(r.sfx, 0, drone(33))
    const e = engineFor(r)
    e.sfx(0)
    render(e, 3000)
    expect(Math.abs(crossings(render(e, SAMPLE_RATE)) - 440)).toBeLessThanOrEqual(3)
    for (let n = 0; n < 32; n++) writeNote(r.sfx, 0, n, { pitch: 45, wave: TRI, vol: 7, fx: 0 })
    render(e, 1500)
    expect(Math.abs(crossings(render(e, SAMPLE_RATE)) - 880)).toBeLessThanOrEqual(3)
  })

  it('follows a change of speed', () => {
    const r = regions()
    setSfx(r.sfx, 0, { notes: repeat([33, TRI, 7]), speed: 20 })
    const e = engineFor(r)
    e.sfx(0)
    render(e, 1000)
    const before = e.state.channels[0].note
    r.sfx[65] = 1
    render(e, 1830)
    expect(e.state.channels[0].note - before).toBeGreaterThan(9)
  })

  it('follows a pattern that changes', () => {
    const r = regions()
    for (let i = 0; i < 4; i++) setSfx(r.sfx, i, { notes: repeat([30 + i, TRI, 7]), speed: 1 })
    pattern(r.music, 0, [0])
    pattern(r.music, 1, [1])
    const e = engineFor(r)
    e.music(0)
    render(e, 100)
    pattern(r.music, 1, [2])
    render(e, 5856)
    expect(e.state.channels[0].sfx).toBe(2)
  })

  it('can be given regions through functions, which may change', () => {
    let a = regions()
    const e = createEngine({ sfx: () => a.sfx, music: () => a.music })
    setSfx(a.sfx, 0, drone(33))
    e.sfx(0)
    render(e, 3000)
    const b = regions()
    setSfx(b.sfx, 0, drone(45))
    a = b
    render(e, 2000)
    expect(Math.abs(crossings(render(e, SAMPLE_RATE)) - 880)).toBeLessThanOrEqual(3)
  })
})

describe('state of the engine', () => {
  it('is idle until something plays, and again a while after it ends', () => {
    const r = regions()
    setSfx(r.sfx, 0, { notes: repeat([33, TRI, 7], 2), speed: 1 })
    const e = engineFor(r)
    expect(e.active).toBe(false)
    e.sfx(0)
    expect(e.active).toBe(true)
    render(e, 2000)
    expect(e.active).toBe(true)
    render(e, 20000)
    expect(e.active).toBe(false)
  })

  it('renders zeros when idle', () => {
    const e = engineFor(regions())
    const out = new Float32Array(100).fill(1)
    e.render(out)
    expect(peak(out)).toBe(0)
  })

  it('keeps its place while paused', () => {
    const r = regions()
    setSfx(r.sfx, 0, drone(33))
    const e = engineFor(r)
    e.sfx(0)
    render(e, 1000)
    const note = e.state.channels[0].note
    e.setPaused(true)
    // after a short crossfade to silence
    render(e, 500)
    expect(peak(render(e, 500))).toBeLessThan(0.01)
    expect(e.state.channels[0].note).toBe(note)
    e.setPaused(false)
    render(e, 1000)
    expect(e.state.channels[0].note).toBeGreaterThan(note)
  })

  it('stops everything', () => {
    const r = regions()
    setSfx(r.sfx, 0, drone(33))
    pattern(r.music, 0, [0])
    const e = engineFor(r)
    e.sfx(0)
    e.music(0)
    e.stop()
    expect(e.state.pattern).toBe(-1)
    expect(e.state.channels.every((c) => c.sfx === -1)).toBe(true)
  })

  it('never produces NaN, whatever the data', () => {
    const r = regions()
    const rng = engineFor(r, 99)
    // random bytes everywhere
    let s = 12345
    for (const region of [r.sfx, r.music]) {
      for (let i = 0; i < region.length; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff
        region[i] = (s >> 8) & 255
      }
    }
    rng.music(0)
    for (let i = 0; i < 4; i++) rng.sfx(i, i)
    for (let k = 0; k < 20; k++) {
      for (const v of render(rng, 5000)) {
        if (!Number.isFinite(v) || Math.abs(v) > 1) throw new Error('bad sample ' + v)
      }
    }
  })
})

describe('regions that are replaced', () => {
  it('reads the current ones when a sound is started, before anything was rendered', () => {
    let r = regions()
    const e = createEngine({ sfx: () => r.sfx, music: () => r.music })
    r = regions()
    setSfx(r.sfx, 2, { notes: repeat([30, 0, 5, 0]) })
    r.music.set([2, 0x41, 0x42, 0x43])
    e.music(0)
    expect(e.state.pattern).toBe(0)
    expect(e.state.channels[0].sfx).toBe(2)
    e.sfx(2, 1)
    expect(e.state.channels[1].sfx).toBe(2)
  })
})
