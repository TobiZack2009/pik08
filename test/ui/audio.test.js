import { describe, expect, it } from 'vitest'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { createCart } from '../../src/core/cart.js'
import { Project } from '../../src/ui/store.js'
import { createSoundService } from '../../src/ui/audio.js'
import { setCell } from '../../src/ui/editors/sound/song.js'
import { setSfx, repeat, peak, render } from '../audio/helpers.js'

function fakeOutput() {
  const o = { started: 0, closed: 0, async start() { o.started++ }, async close() { o.closed++ } }
  return o
}

function setup() {
  const project = Project.empty(pico8Profile)
  const output = fakeOutput()
  const sound = createSoundService(project, { output, random: () => 0.5 })
  return { project, output, sound }
}

describe('createSoundService', () => {
  it('starts the output when something plays, not before', () => {
    const { output, sound } = setup()
    expect(output.started).toBe(0)
    sound.play(0)
    expect(output.started).toBe(1)
  })

  it('plays the sfx of the project', () => {
    const { project, sound } = setup()
    setSfx(project.region('sfx'), 5, { notes: repeat([33, 0, 5]) })
    sound.play(5)
    expect(sound.playing(5)).toBe(true)
    expect(peak(render(sound.engine, 2000))).toBeGreaterThan(0.05)
  })

  it('hears an edit made while it plays', () => {
    const { project, sound } = setup()
    const sfx = project.region('sfx')
    setSfx(sfx, 5, { notes: repeat([33, 0, 5]), loopStart: 0, loopEnd: 32 })
    sound.play(5)
    render(sound.engine, 2000)
    // silence every note
    setSfx(sfx, 5, { notes: repeat([33, 0, 0]), loopStart: 0, loopEnd: 32 })
    render(sound.engine, 1000)
    expect(peak(render(sound.engine, 2000))).toBe(0)
  })

  it('plays just a note when asked to', () => {
    const { project, sound } = setup()
    setSfx(project.region('sfx'), 5, { notes: repeat([33, 0, 5]) })
    sound.play(5, 4, 1)
    // one note at speed 1 is 183 samples
    render(sound.engine, 200)
    expect(sound.playing(5)).toBe(false)
  })

  it('reports where a playing sfx is, and -1 when it is not', () => {
    const { project, sound } = setup()
    setSfx(project.region('sfx'), 5, { notes: repeat([33, 0, 5]), speed: 4 })
    expect(sound.position(5)).toBe(-1)
    sound.play(5)
    render(sound.engine, 183 * 4 * 3)
    expect(sound.position(5)).toBeGreaterThan(2.5)
    expect(sound.position(5)).toBeLessThan(3.5)
  })

  it('stops', () => {
    const { project, sound } = setup()
    setSfx(project.region('sfx'), 5, { notes: repeat([33, 0, 5]), loopStart: 0, loopEnd: 32 })
    sound.play(5)
    sound.stop()
    expect(sound.playing(5)).toBe(false)
  })

  it('stops what plays when another cart is loaded, and reads the new cart', () => {
    const { project, sound } = setup()
    setSfx(project.region('sfx'), 5, { notes: repeat([33, 0, 5]), loopStart: 0, loopEnd: 32 })
    sound.play(5)
    const next = createCart(pico8Profile)
    setSfx(next.rom.subarray(...pico8Profile.memory.regions.sfx), 6, { notes: repeat([40, 0, 5]) })
    project.load(next, 'next.p8')
    expect(sound.playing(5)).toBe(false)
    sound.play(6)
    expect(peak(render(sound.engine, 2000))).toBeGreaterThan(0.05)
  })

  it('plays music from a pattern', () => {
    const { project, sound, output } = setup()
    setSfx(project.region('sfx'), 0, { notes: repeat([33, 0, 5]) })
    setCell(project.region('music'), 0, 0, 0)
    sound.playMusic(0)
    expect(output.started).toBe(1)
    expect(peak(render(sound.engine, 2000))).toBeGreaterThan(0.05)
  })

  it('reports the music pattern that plays, and -1 when no music does', () => {
    const { project, sound } = setup()
    const music = project.region('music')
    setSfx(project.region('sfx'), 0, { notes: repeat([33, 0, 5]), speed: 1 })
    setCell(music, 2, 0, 0)
    expect(sound.musicBar()).toBe(-1)
    sound.playMusic(2)
    render(sound.engine, 400)
    expect(sound.musicBar()).toBe(2)
    sound.stop()
    expect(sound.musicBar()).toBe(-1)
  })

  it('releases the output when destroyed', async () => {
    const { output, sound } = setup()
    await sound.destroy()
    expect(output.closed).toBe(1)
  })
})
