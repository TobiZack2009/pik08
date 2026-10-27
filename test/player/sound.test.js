import { describe, expect, it, vi } from 'vitest'
import { createGame } from '../../src/player/game.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { repeat, setSfx } from '../audio/helpers.js'

const { regions } = pico8Profile.memory
const sfxOf = (/** @type {Uint8Array} */ rom) => rom.subarray(regions.sfx[0], regions.sfx[1])
const musicOf = (/** @type {Uint8Array} */ rom) => rom.subarray(regions.music[0], regions.music[1])

/** A cart ROM with a steady sound in sfx 3, and in the song sfx 3 on pattern 0 and sfx 4 on pattern 1. */
function rom() {
  const r = pico8Profile.cart.createRom()
  setSfx(sfxOf(r), 3, { notes: repeat([30, 0, 5, 0]), speed: 1 })
  setSfx(sfxOf(r), 4, { notes: repeat([20, 0, 5, 0]), speed: 1 })
  musicOf(r).set([3, 0x41, 0x42, 0x43, 4, 0x41, 0x42, 0x43])
  return r
}

function setup() {
  const output = { start: vi.fn(async () => {}), stop: vi.fn(), close: vi.fn(async () => {}) }
  const createOutput = vi.fn(() => output)
  const clock = { schedule: () => 1, cancel: () => {}, now: () => 0 }
  const game = createGame({ profile: pico8Profile, clock, createOutput, random: () => 0.5 })
  const global = (/** @type {string} */ name) => game.program?.G.get(name)
  /** Renders `n` samples; whether any is not silent. @param {number} [n] */
  const heard = (n = 2048) => {
    const out = new Float32Array(n)
    game.engine.render(out)
    return out.some((x) => x !== 0)
  }
  return { game, output, createOutput, global, heard }
}

describe('sfx', () => {
  it('plays a sound effect of the cart', () => {
    const { game, global, heard } = setup()
    game.load({ code: 'function _init() sfx(3) a, b = stat(16), stat(20) end', rom: rom() })
    expect(global('a')).toBe(3)
    expect(global('b')).toBe(0)
    expect(heard()).toBe(true)
  })

  it('takes a channel, an offset and a length', () => {
    const { game, global } = setup()
    game.load({ code: 'function _init() sfx(3, 2, 8, 4) a, b, c = stat(16), stat(18), stat(22) end', rom: rom() })
    expect(global('a')).toBe(-1)
    expect(global('b')).toBe(3)
    expect(global('c')).toBe(8)
  })

  it('stops a channel with -1', () => {
    const { game, global } = setup()
    game.load({ code: 'function _init() sfx(3, 1) sfx(-1, 1) a = stat(17) end', rom: rom() })
    expect(global('a')).toBe(-1)
  })

  it('ignores a call without a sound', () => {
    const { game, createOutput } = setup()
    game.load({ code: 'sfx() music()', rom: rom() })
    expect(game.error).toBeNull()
    expect(createOutput).not.toHaveBeenCalled()
  })

  it('plays what the cart pokes into its sound data', () => {
    const { game, heard } = setup()
    // sfx 5 is empty in the ROM; the cart writes one loud note into it
    const note = regions.sfx[0] + 5 * 68
    game.load({ code: `function _init() poke(${note}, 40, 0x0a) sfx(5) end`, rom: rom() })
    expect(heard()).toBe(true)
  })
})

describe('music', () => {
  it('plays a pattern and reports it', () => {
    const { game, global, heard } = setup()
    game.load({ code: 'function _init() music(0) a, b, c = stat(24), stat(25), stat(16) end', rom: rom() })
    expect(global('a')).toBe(0)
    expect(global('b')).toBe(0)
    expect(global('c')).toBe(3)
    expect(heard()).toBe(true)
  })

  it('moves on to the next pattern', () => {
    const { game } = setup()
    game.load({ code: 'function _init() music(0) end', rom: rom() })
    // pattern 0 lasts 32 notes of 183 samples each
    game.engine.render(new Float32Array(32 * 183 + 400))
    expect(game.engine.state.pattern).toBe(1)
  })

  it('stops with -1', () => {
    const { game } = setup()
    game.load({ code: 'function _init() music(0) music(-1) end', rom: rom() })
    game.engine.render(new Float32Array(16))
    expect(game.engine.state.pattern).toBe(-1)
  })

  it('keeps the channels of the mask free of sfx', () => {
    const { game, global } = setup()
    game.load({ code: 'function _init() music(0, 0, 1) sfx(4, -1) a = stat(16) end', rom: rom() })
    expect(global('a')).toBe(3)
  })
})

describe('the speakers', () => {
  it('are not opened until the cart makes a sound', () => {
    const { game, createOutput, output } = setup()
    game.load({ code: 'cls()', rom: rom() })
    expect(createOutput).not.toHaveBeenCalled()
    game.load({ code: 'sfx(3)', rom: rom() })
    expect(createOutput).toHaveBeenCalledTimes(1)
    expect(output.start).toHaveBeenCalled()
  })

  it('are made once for all the carts the game runs', () => {
    const { game, createOutput } = setup()
    game.load({ code: 'sfx(3)', rom: rom() })
    game.load({ code: 'sfx(4)', rom: rom() })
    expect(createOutput).toHaveBeenCalledTimes(1)
  })

  it('are woken by a click or key press, once they exist', () => {
    const { game, output } = setup()
    game.wake()
    expect(output.start).not.toHaveBeenCalled()
    game.load({ code: 'sfx(3)', rom: rom() })
    output.start.mockClear()
    game.wake()
    expect(output.start).toHaveBeenCalledTimes(1)
  })

  it('are let go of when the game is destroyed', async () => {
    const { game, output } = setup()
    game.load({ code: 'sfx(3)', rom: rom() })
    await game.destroy()
    expect(output.close).toHaveBeenCalled()
    expect(game.engine.state.channels.every((c) => c.sfx === -1)).toBe(true)
  })
})

describe('silence', () => {
  it('follows stop', () => {
    const { game, heard } = setup()
    game.load({ code: 'function _init() sfx(3) end', rom: rom() })
    game.stop()
    expect(game.engine.state.channels.every((c) => c.sfx === -1)).toBe(true)
    expect(heard(256)).toBe(false)
  })

  it('follows a new load', () => {
    const { game, global } = setup()
    game.load({ code: 'sfx(3) music(0)', rom: rom() })
    game.load({ code: 'a, b = stat(16), stat(24)', rom: rom() })
    expect(global('a')).toBe(-1)
    expect(global('b')).toBe(-1)
  })

  it('follows a runtime error', () => {
    const { game } = setup()
    game.load({ code: 'function _init() sfx(3) end function _update() error("x") end', rom: rom() })
    expect(game.engine.state.channels[0].sfx).toBe(3)
  })

  it('hears the data of a cart swapped in while it runs', () => {
    const { game, heard } = setup()
    const silent = pico8Profile.cart.createRom()
    game.load({ code: 'function _update() end', rom: silent })
    game.swapRom(rom())
    game.engine.sfx(3)
    expect(heard()).toBe(true)
  })
})
