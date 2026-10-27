import { describe, expect, it, vi } from 'vitest'
import { createGame, wrapText } from '../../src/player/game.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'

/** A scheduler and a clock the test moves by hand. */
function fakeClock() {
  let time = 0
  /** @type {(() => void) | null} */
  let pending = null
  return {
    now: () => time,
    schedule: (/** @type {() => void} */ cb) => {
      pending = cb
      return 1
    },
    cancel: () => {
      pending = null
    },
    /** Runs `n` display frames of the given length. @param {number} n @param {number} [ms] */
    frames(n, ms = 1000 / 30) {
      for (let i = 0; i < n; i++) {
        time += ms
        const cb = pending
        pending = null
        cb?.()
      }
    },
  }
}

/** @param {Partial<Parameters<typeof createGame>[0]>} [options] */
function setup(options = {}) {
  const clock = fakeClock()
  const onError = vi.fn()
  const onPrint = vi.fn()
  const onFrame = vi.fn()
  const game = createGame({ profile: pico8Profile, clock, onError, onPrint, onFrame, ...options })
  const rom = () => pico8Profile.cart.createRom()
  return { game, clock, onError, onPrint, onFrame, rom }
}

/** @param {ReturnType<typeof createGame>} game @param {string} name */
const global = (game, name) => game.program?.G.get(name)

describe('wrapText', () => {
  it('breaks at spaces and at newlines', () => {
    expect(wrapText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
    expect(wrapText('one\ntwo', 10)).toEqual(['one', 'two'])
  })

  it('splits words that are too long', () => {
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })
})

describe('createGame', () => {
  it('runs _init, then _update and _draw once per frame', () => {
    const { game, clock, rom, onError } = setup()
    game.load({
      code: `
        log = ''
        function _init() log = log .. 'i' end
        function _update() log = log .. 'u' end
        function _draw() log = log .. 'd' end
      `,
      rom: rom(),
    })
    expect(onError).toHaveBeenCalledWith(null)
    expect(game.running).toBe(true)
    clock.frames(3)
    expect(global(game, 'log')).toBe('iududud')
    expect(game.frames).toBe(3)
  })

  it('draws on the screen and reports each frame', () => {
    const { game, clock, rom, onFrame } = setup()
    game.load({ code: 'function _draw() cls(1) pset(2, 3, 7) end', rom: rom() })
    clock.frames(1)
    expect(onFrame).toHaveBeenCalled()
    const frame = onFrame.mock.calls.at(-1)?.[0]
    expect(frame[3 * 128 + 2]).toBe(7)
    expect(frame[0]).toBe(1)
  })

  it('shows the first frame of a cart that only draws in its main chunk', () => {
    const { game, rom, onFrame } = setup()
    game.load({ code: 'cls(2) rectfill(0, 0, 3, 3, 9)', rom: rom() })
    expect(game.running).toBe(false)
    expect(onFrame.mock.calls.at(-1)?.[0][0]).toBe(9)
  })

  it('keeps time by frames, at 30 fps', () => {
    const { game, clock, rom } = setup()
    game.load({ code: 'function _update() t = time() end', rom: rom() })
    clock.frames(30)
    expect(global(game, 't')).toBeCloseTo(1, 5)
  })

  it('runs at 60 fps with _update60', () => {
    const { game, clock, rom } = setup()
    game.load({ code: 'n = 0 function _update60() n += 1 t = time() end', rom: rom() })
    clock.frames(30, 1000 / 60)
    expect(global(game, 'n')).toBe(30)
    expect(global(game, 't')).toBeCloseTo(0.5, 5)
  })

  it('hands printh output on', () => {
    const { game, rom, onPrint } = setup()
    game.load({ code: 'printh("hello") printh(1 + 1)', rom: rom() })
    expect(onPrint).toHaveBeenCalledWith('hello')
    expect(onPrint).toHaveBeenCalledWith('2')
  })

  it('starts with the cart ROM in memory', () => {
    const { game, rom } = setup()
    const data = rom()
    data[0] = 0x21 // sprite sheet pixels (0,0)=1 and (1,0)=2
    data[0x3000 + 4] = 0x80 // flags of sprite 4
    game.load({ code: 'a, b, f = sget(0, 0), sget(1, 0), fget(4, 7)', rom: data })
    expect(global(game, 'a')).toBe(1)
    expect(global(game, 'b')).toBe(2)
    expect(global(game, 'f')).toBe(true)
  })

  it('gives every cart its own memory, so a restart starts fresh', () => {
    const { game, rom } = setup()
    game.load({ code: 'poke(0x4400, 99)', rom: rom() })
    game.load({ code: 'v = peek(0x4400)', rom: rom() })
    expect(global(game, 'v')).toBe(0)
  })

  it('peeks and pokes the screen', () => {
    const { game, rom } = setup()
    game.load({ code: 'poke(0x6000, 0x37) a = pget(0, 0) b = pget(1, 0) w = peek(0x6000)', rom: rom() })
    expect(global(game, 'a')).toBe(7)
    expect(global(game, 'b')).toBe(3)
    expect(global(game, 'w')).toBe(0x37)
  })

  it('reads memory out of range as an error', () => {
    const { game, rom, onError } = setup()
    game.load({ code: 'x = peek(0x9000)', rom: rom() })
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ line: 1 }))
  })

  it('reads the buttons', () => {
    const { game, clock, rom } = setup()
    game.load({ code: 'function _update() left = btn(0) mask = btn() press = btnp(4) end', rom: rom() })
    clock.frames(1)
    expect(global(game, 'left')).toBe(false)
    game.input.press('ArrowLeft')
    game.input.press('KeyZ')
    clock.frames(1)
    expect(global(game, 'left')).toBe(true)
    expect(global(game, 'mask')).toBe(1 | 16)
    expect(global(game, 'press')).toBe(true)
    clock.frames(1)
    expect(global(game, 'press')).toBe(false)
  })

  it('forgets held buttons on a restart', () => {
    const { game, rom } = setup()
    game.input.press('ArrowLeft')
    game.load({ code: '', rom: rom() })
    expect(game.input.down.size).toBe(0)
  })

  it('reloads the ROM into memory with reload()', () => {
    const { game, rom } = setup()
    const data = rom()
    data[10] = 55
    game.load({ code: 'poke(10, 1) a = peek(10) reload(10, 10, 1) b = peek(10)', rom: data })
    expect(global(game, 'a')).toBe(1)
    expect(global(game, 'b')).toBe(55)
  })

  describe('errors', () => {
    it('reports a runtime error with its line, stops, and says so on the screen', () => {
      const { game, clock, rom, onError } = setup()
      game.load({
        code: ['function _update()', '  local t = nil', '  t.x = 1', 'end'].join('\n'),
        rom: rom(),
      })
      onError.mockClear()
      clock.frames(1)
      expect(onError).toHaveBeenCalledTimes(1)
      const error = onError.mock.calls[0][0]
      expect(error.line).toBe(3)
      expect(error.message).toMatch(/\S/)
      expect(game.error).toEqual(error)
      expect(game.running).toBe(false)
      // the red box at the bottom of the screen
      const frame = game.graphics?.indices()
      expect(frame?.[127 * 128]).toBe(8)
    })

    it('reports an error in _draw', () => {
      const { game, clock, rom, onError } = setup()
      game.load({ code: 'function _draw()\n  nothing()\nend', rom: rom() })
      onError.mockClear()
      clock.frames(1)
      expect(onError.mock.calls[0][0].line).toBe(2)
    })

    it('reports an error in the main chunk or in _init', () => {
      const first = setup()
      first.game.load({ code: '\n\nx = nil + 1', rom: first.rom() })
      expect(first.onError.mock.calls[0][0].line).toBe(3)
      expect(first.game.running).toBe(false)

      const second = setup()
      second.game.load({ code: 'function _init()\n  y.z = 1\nend\nfunction _update() end', rom: second.rom() })
      expect(second.onError.mock.calls[0][0].line).toBe(2)
      expect(second.game.running).toBe(false)
    })

    it('reports a syntax error', () => {
      const { game, rom, onError } = setup()
      game.load({ code: 'x = 1\nfunction (', rom: rom() })
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0][0]).toEqual({ line: 2, message: expect.any(String) })
      expect(game.running).toBe(false)
    })

    it('clears the error when a good cart is loaded', () => {
      const { game, rom, onError } = setup()
      game.load({ code: 'x = nil + 1', rom: rom() })
      expect(game.error).not.toBeNull()
      game.load({ code: 'function _update() end', rom: rom() })
      expect(game.error).toBeNull()
      expect(onError).toHaveBeenLastCalledWith(null)
      expect(game.running).toBe(true)
    })
  })

  describe('swapRom', () => {
    it('puts new sprites into the running game without restarting it', () => {
      const { game, clock, rom, onFrame } = setup()
      game.load({ code: 'n = 0 function _update() n += 1 end function _draw() cls(1) spr(1, 0, 0) end', rom: rom() })
      clock.frames(2)
      expect(onFrame.mock.calls.at(-1)?.[0][0]).toBe(1)

      const next = rom()
      next[4] = 0x05 // sprite 1 is the cell at x 8..15: its pixel (0,0) is the low nibble of byte 4
      game.swapRom(next)
      clock.frames(1)
      expect(onFrame.mock.calls.at(-1)?.[0][0]).toBe(5)
      expect(global(game, 'n')).toBe(3) // and the game kept going
    })

    it('shows the screen again at once in a game that is not running', () => {
      const { game, rom, onFrame } = setup()
      game.load({ code: 'cls()', rom: rom() })
      const next = rom()
      next[4] = 0x05
      onFrame.mockClear()
      game.swapRom(next)
      expect(onFrame).toHaveBeenCalledTimes(1)
      expect(game.graphics?.sget(8, 0)).toBe(5)
    })

    it('does nothing before a cart is loaded', () => {
      const { game, rom } = setup()
      expect(() => game.swapRom(rom())).not.toThrow()
    })
  })

  it('stops', () => {
    const { game, clock, rom } = setup()
    game.load({ code: 'n = 0 function _update() n += 1 end', rom: rom() })
    clock.frames(2)
    game.stop()
    clock.frames(5)
    expect(game.running).toBe(false)
    expect(global(game, 'n')).toBe(2)
  })

  it('draws to a canvas when it has one', () => {
    const calls = /** @type {any[]} */ ([])
    const ctx = {
      createImageData: (/** @type {number} */ w, /** @type {number} */ h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: (/** @type {any} */ img) => calls.push(img),
    }
    const canvas = /** @type {any} */ ({ width: 128, height: 128, getContext: () => ctx })
    const { game, rom } = setup({ canvas })
    game.load({ code: 'cls(8)', rom: rom() })
    expect(calls.length).toBeGreaterThan(0)
  })
})
