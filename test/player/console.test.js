import { describe, expect, it, vi } from 'vitest'
import { createGame } from '../../src/player/game.js'
import { Graphics } from '../../src/player/graphics.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { repeat, setSfx } from '../audio/helpers.js'

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
    /** Time passes while the game is busy. @param {number} ms */
    spend(ms) {
      time += ms
    },
    /** @param {number} n */
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

/** A storage that lives in a map. */
function memoryStorage(map = new Map()) {
  return { map, get: (/** @type {string} */ k) => map.get(k) ?? null, set: (/** @type {string} */ k, /** @type {string} */ v) => void map.set(k, v) }
}

/** @param {Partial<Parameters<typeof createGame>[0]>} [options] */
function setup(options = {}) {
  const clock = fakeClock()
  const onError = vi.fn()
  const onFrame = vi.fn()
  const onExtcmd = vi.fn()
  const output = { start: vi.fn(async () => {}), stop: vi.fn(), close: vi.fn(async () => {}) }
  const game = createGame({ profile: pico8Profile, clock, onError, onFrame, onExtcmd, storage: memoryStorage(), createOutput: () => output, random: () => 0.5, ...options })
  const load = (/** @type {string} */ code, rom = pico8Profile.cart.createRom()) => game.load({ code, rom })
  const global = (/** @type {string} */ name) => game.program?.G.get(name)
  /** The screen as the last frame showed it. */
  const screen = () => onFrame.mock.calls.at(-1)?.[0]
  /** Presses a key for one frame and lets go. @param {string} code */
  const tap = (code) => {
    game.input.press(code)
    clock.frames(1)
    game.input.release(code)
    clock.frames(1)
  }
  const pause = () => {
    game.input.pause = true
    clock.frames(1)
  }
  return { game, clock, onError, onFrame, onExtcmd, load, global, screen, tap, pause }
}

describe('fillp', () => {
  function graphics() {
    return new Graphics(new Uint8Array(0x8000))
  }
  /** The 4x4 block at the top left as rows of colours. @param {Graphics} g */
  const block = (g) => [0, 1, 2, 3].map((y) => [0, 1, 2, 3].map((x) => g.pget(x, y)))

  it('draws the high colour where the pattern has a bit set and the low colour elsewhere', () => {
    const g = graphics()
    g.fillp(0b1010010110100101)
    g.rectfill(0, 0, 3, 3, 0x21)
    expect(block(g)).toEqual([
      [2, 1, 2, 1],
      [1, 2, 1, 2],
      [2, 1, 2, 1],
      [1, 2, 1, 2],
    ])
  })

  it('repeats across the screen, not from the shape', () => {
    const g = graphics()
    g.fillp(0b1000000000000000)
    g.rectfill(3, 3, 8, 8, 0x21)
    expect(g.pget(4, 4)).toBe(2) // (4, 4) is the top left of a block
    expect(g.pget(5, 4)).toBe(1)
    expect(g.pget(8, 8)).toBe(2)
  })

  it('leaves the screen alone where the high colour is see-through', () => {
    const g = graphics()
    g.cls(5)
    g.fillp(0b1111111111111111 + 0.5)
    g.rectfill(0, 0, 3, 3, 0x21)
    expect(block(g).flat().every((c) => c === 5)).toBe(true)
    g.fillp(0b1010101010101010 + 0.5)
    g.rectfill(0, 0, 3, 3, 0x21)
    expect(block(g)[0]).toEqual([5, 1, 5, 1])
  })

  it('applies to pixels, lines, circles and rectangles', () => {
    const g = graphics()
    g.fillp(0b1000000000000000)
    g.pset(0, 0, 0x21)
    g.pset(1, 0, 0x21)
    g.line(0, 2, 3, 2, 0x21)
    expect([g.pget(0, 0), g.pget(1, 0)]).toEqual([2, 1])
    expect([g.pget(0, 2), g.pget(1, 2)]).toEqual([1, 1])
    g.circfill(20, 20, 4, 0x21)
    g.rect(40, 40, 47, 47, 0x21)
    expect(new Set([g.pget(20, 20), g.pget(19, 20), g.pget(20, 19)]).size).toBeGreaterThan(0)
  })

  it('does not touch sprites or text', () => {
    const g = graphics()
    g.fillp(0b1111111111111111)
    g.sset(0, 0, 3)
    g.spr(0, 8, 8)
    expect(g.pget(8, 8)).toBe(3)
    g.print('I', 20, 20, 0x27)
    let seven = 0
    for (let y = 20; y < 25; y++) for (let x = 20; x < 23; x++) if (g.pget(x, y) === 7) seven++
    expect(seven).toBeGreaterThan(0)
  })

  it('goes through the draw palette and returns what it replaces', () => {
    const g = graphics()
    expect(g.fillp(0xa5a5 - 0x10000)).toBe(0)
    g.pal(2, 9)
    g.fillp(0b1000000000000000)
    g.rectfill(0, 0, 0, 0, 0x21)
    expect(g.pget(0, 0)).toBe(9)
    expect(g.fillp(0b1111000011110000 + 0.25)).toBe(-32768) // 0x8000 as a 16.16 number
    expect(g.fillp()).toBe(0b1111000011110000 - 0x10000 + 0.25)
    expect(g.fillp()).toBe(0)
  })

  it('is cleared by fillp() and kept in memory for the cart to see', () => {
    const { load, global } = setup()
    load('fillp(0x1234.8) a, b, c = peek(0x5f31), peek(0x5f32), peek(0x5f33) fillp() d = peek(0x5f31)')
    expect([global('a'), global('b'), global('c'), global('d')]).toEqual([0x34, 0x12, 1, 0])
  })

  it('works in a running cart', () => {
    const { load, clock, screen } = setup()
    load('function _draw() cls() fillp(0b0101101001011010) rectfill(0, 0, 7, 7, 0x1c) end')
    clock.frames(1)
    expect([screen()[0], screen()[1]]).toEqual([12, 1])
  })
})

describe('cartdata', () => {
  it('keeps numbers between runs of a cart', () => {
    const storage = memoryStorage()
    const first = setup({ storage })
    first.load('first = cartdata("my_game") dset(0, 42) dset(63, -1.5)')
    expect(first.global('first')).toBe(false)
    const second = setup({ storage })
    second.load('seen = cartdata("my_game") a, b, c = dget(0), dget(63), dget(1)')
    expect([second.global('seen'), second.global('a'), second.global('b'), second.global('c')]).toEqual([true, 42, -1.5, 0])
  })

  it('is shared by the carts that use one id and separate from the others', () => {
    const storage = memoryStorage()
    setup({ storage }).load('cartdata("one") dset(0, 1)')
    const other = setup({ storage })
    other.load('cartdata("two") a = dget(0)')
    expect(other.global('a')).toBe(0)
  })

  it('lives in memory from 0x5e00, where a cart may poke it', () => {
    const { load, global } = setup()
    load('cartdata("x") dset(1, 3) a = peek4(0x5e04) poke4(0x5e08, 7) b = dget(2)')
    expect(global('a')).toBe(3)
    expect(global('b')).toBe(7)
  })

  it('saves what was poked when the game stops', () => {
    const storage = memoryStorage()
    const a = setup({ storage })
    a.load('cartdata("p") poke(0x5e00, 9)')
    a.game.stop()
    const b = setup({ storage })
    b.load('cartdata("p") x = dget(0)')
    expect(b.global('x')).toBeCloseTo(9 / 65536, 8)
  })

  it('needs cartdata() before dget and dset', () => {
    const a = setup()
    a.load('dset(0, 1)')
    expect(a.onError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'cartdata() not called' }))
    const b = setup()
    b.load('x = dget(0)')
    expect(b.game.error?.message).toBe('cartdata() not called')
  })

  it('refuses a second call and a bad id', () => {
    const a = setup()
    a.load('cartdata("a") cartdata("b")')
    expect(a.game.error?.message).toContain('only be called once')
    const b = setup()
    b.load('cartdata("Bad Id")')
    expect(b.game.error?.message).toContain('lowercase')
    const c = setup()
    c.load('cartdata()')
    expect(c.game.error).not.toBeNull()
  })

  it('ignores slots out of range', () => {
    const { load, global } = setup()
    load('cartdata("r") dset(64, 5) dset(-1, 5) a = dget(64) b = dget(-1)')
    expect([global('a'), global('b')]).toEqual([0, 0])
  })

  it('works without storage', () => {
    const { load, global } = setup({ storage: null })
    load('cartdata("n") dset(0, 4) a = dget(0)')
    expect(global('a')).toBe(4)
  })

  it('starts empty on every run when the storage is not valid', () => {
    const storage = memoryStorage(new Map([['p8n:cartdata:v', 'garbage']]))
    const { load, global } = setup({ storage })
    load('r = cartdata("v") a = dget(0)')
    expect([global('r'), global('a')]).toEqual([false, 0])
  })
})

describe('cstore', () => {
  it('keeps memory where reload finds it', () => {
    const { load, global } = setup()
    load('poke(0, 5, 6) cstore(0, 0, 2) poke(0, 9, 9) reload(0, 0, 2) a, b = peek(0), peek(1)')
    expect([global('a'), global('b')]).toEqual([5, 6])
  })

  it('is kept across a restart of the cart only in the game, not in the cart handed in', () => {
    const rom = pico8Profile.cart.createRom()
    const { load } = setup()
    load('poke(0, 5) cstore(0, 0, 1)', rom)
    expect(rom[0]).toBe(0)
  })

  it('stays inside the cart', () => {
    const { load, game, global } = setup()
    load('poke(0x4400, 1) cstore(0x4400, 0x4400, 16) a = peek(0x4400) cstore(0x42ff, 0x42ff, 100) reload(0x42ff, 0x42ff, 100) poke(0x42ff, 3) cstore(0x42ff, 0x42ff, 100) poke(0x42ff, 0) reload(0x42ff, 0x42ff, 1) b = peek(0x42ff)')
    expect(game.error).toBeNull()
    expect(global('a')).toBe(1)
    expect(global('b')).toBe(3)
  })
})

describe('stat', () => {
  const date = () => new Date(Date.UTC(2031, 4, 17, 13, 45, 59))

  it('reports the frame rate, wanted and actual', () => {
    const { load, global } = setup()
    load('a, b, c = stat(7), stat(8), stat(9)')
    expect([global('a'), global('b'), global('c')]).toEqual([30, 30, 30])
    load('function _update60() end a, b = stat(8), stat(9)')
    expect([global('a'), global('b')]).toEqual([60, 60])
  })

  it('tells the date and time', () => {
    const { load, global } = setup({ date })
    load('y, mo, d, h, mi, s = stat(80), stat(81), stat(82), stat(83), stat(84), stat(85) ly, lmo, ld, lh = stat(90), stat(91), stat(92), stat(93)')
    expect(['y', 'mo', 'd', 'h', 'mi', 's'].map(global)).toEqual([2031, 5, 17, 13, 45, 59])
    const local = date()
    expect(['ly', 'lmo', 'ld', 'lh'].map(global)).toEqual([local.getFullYear(), local.getMonth() + 1, local.getDate(), local.getHours()])
  })

  it('has an empty parameter string and zero for the rest', () => {
    const { load, global } = setup()
    load('a, b, c = stat(6), stat(0), stat(99)')
    expect([global('a'), global('b'), global('c')]).toEqual(['', 0, 0])
  })

  it('says whether music plays and how far into the pattern it is', () => {
    const rom = pico8Profile.cart.createRom()
    const { sfx, music } = pico8Profile.memory.regions
    setSfx(rom.subarray(sfx[0], sfx[1]), 3, { notes: repeat([30, 0, 5, 0]), speed: 1 })
    rom.subarray(music[0], music[1]).set([3, 0x41, 0x42, 0x43])
    const { load, global, game } = setup()
    load('a = stat(57) b = stat(26) music(0) c = stat(57)', rom)
    expect([global('a'), global('b'), global('c')]).toEqual([false, 0, true])
    game.engine.render(new Float32Array(4096))
    const stat = /** @type {(n: number) => number} */ (global('stat'))
    expect(stat(26)).toBeGreaterThan(0)
  })
})

describe('stat: the console itself', () => {
  it('counts the memory the cart has added to the page, up to the console\'s 2 MiB', () => {
    let kib = 1000
    const { load, clock, global } = setup({ heap: () => kib })
    load('function _update() m = stat(0) end')
    clock.frames(1)
    expect(global('m')).toBe(0)
    kib = 1500
    clock.frames(1)
    expect(global('m')).toBe(500)
    kib = 900 // after a collection
    clock.frames(1)
    expect(global('m')).toBe(0)
    kib = 1_000_000
    clock.frames(1)
    expect(global('m')).toBe(2048)
  })

  it('reads 0 for the memory where the browser does not say', () => {
    const { load, clock, global } = setup({ heap: () => NaN })
    load('function _update() m = stat(0) end')
    clock.frames(1)
    expect(global('m')).toBe(0)
  })

  it('measures the cpu used so far in the frame against the time it has', () => {
    const clock = fakeClock()
    const game = createGame({
      profile: pico8Profile,
      clock,
      storage: null,
      createOutput: () => ({ start: async () => {}, stop() {}, close: async () => {} }),
      onPrint: () => clock.spend(10),
      onFrame: () => clock.spend(3),
    })
    const budget = 1000 / 30
    game.load({
      code: 'function _update() a = stat(1) printh("") b = stat(1) c = stat(2) end function _draw() printh("") d = stat(1) end',
      rom: pico8Profile.cart.createRom(),
    })
    clock.frames(2)
    const global = (/** @type {string} */ name) => game.program?.G.get(name)
    expect(global('a')).toBeCloseTo(0)
    expect(global('b')).toBeCloseTo(10 / budget)
    expect(global('d')).toBeCloseTo(20 / budget) // the update and the draw
    expect(global('c')).toBeCloseTo(3 / budget) // what showing the frame before cost
  })

  it('has the version of the cart format', () => {
    const { load, global } = setup()
    load('v = stat(5)')
    expect(global('v')).toBe(pico8Profile.cart.defaultVersion)
  })
})

describe('stat: the keyboard and the mouse of the devkit mode', () => {
  const read = 'function _update() on = stat(30) key = stat(31) mx, my, mb, wheel = stat(32), stat(33), stat(34), stat(36) end'

  it('tells nothing until the cart switches the mode on', () => {
    const { load, clock, global, game } = setup()
    load(read)
    game.input.text.push('h')
    Object.assign(game.input.pointer, { x: 40, y: 50, buttons: 1 })
    clock.frames(1)
    expect(['on', 'key', 'mx', 'my', 'mb'].map(global)).toEqual([false, '', 0, 0, 0])
  })

  it('gives the typed keys one at a time', () => {
    const { load, clock, global, game } = setup()
    load('poke(0x5f2d, 1) ' + read)
    game.input.text.push('h', 'i')
    clock.frames(1)
    expect([global('on'), global('key')]).toEqual([true, 'h'])
    clock.frames(1)
    expect([global('on'), global('key')]).toEqual([true, 'i'])
    clock.frames(1)
    expect([global('on'), global('key')]).toEqual([false, ''])
  })

  it('follows the mouse and its wheel', () => {
    const { load, clock, global, game } = setup()
    load('poke(0x5f2d, 1) ' + read)
    Object.assign(game.input.pointer, { x: 40, y: 50, buttons: 5, wheel: 1 })
    clock.frames(1)
    expect(['mx', 'my', 'mb', 'wheel'].map(global)).toEqual([40, 50, 5, 1])
    clock.frames(1)
    expect(global('wheel')).toBe(0) // the wheel moved in one frame only
  })

  it('stops with the mode, and while the pause menu is open', () => {
    const { load, clock, global, game, pause } = setup()
    load('poke(0x5f2d, 1) ' + read)
    clock.frames(1)
    expect(game.input.devkit()).toBe(true)
    pause()
    expect(game.input.devkit()).toBe(false)
    pause()
    expect(game.input.devkit()).toBe(true)
    load('on = 1')
    expect(game.input.devkit()).toBe(false)
    expect(global('on')).toBe(1)
  })
})

describe('flip', () => {
  it('lets a cart draw its own frames from the main chunk', () => {
    const { load, clock, global, onFrame, onError, game } = setup()
    load('n = 0 while true do n += 1 cls(n) flip() end')
    expect(onError).toHaveBeenCalledWith(null)
    expect(game.running).toBe(true)
    expect(global('n')).toBe(1)
    expect(onFrame.mock.calls.at(-1)?.[0][0]).toBe(1)
    clock.frames(3)
    expect(global('n')).toBe(4)
    expect(onFrame.mock.calls.at(-1)?.[0][0]).toBe(4)
  })

  it('counts the frames of the loop for time()', () => {
    const { load, clock, global } = setup()
    load('while true do t = time() flip() end')
    clock.frames(30)
    expect(global('t')).toBeCloseTo(1, 5)
  })

  it('works in _init, and then _update and _draw take over', () => {
    const { load, clock, global } = setup()
    load('log = "" function _init() log ..= "i" flip() log ..= "j" end function _update() log ..= "u" end function _draw() log ..= "d" end')
    expect(global('log')).toBe('i')
    clock.frames(1)
    expect(global('log')).toBe('ijd')
    clock.frames(2)
    expect(global('log')).toBe('ijdudud')
  })

  it('ends the game when the code after the last flip ends it', () => {
    const { load, clock, global, game } = setup()
    load('flip() n = 1')
    expect(game.running).toBe(true)
    clock.frames(1)
    expect(global('n')).toBe(1)
    expect(game.running).toBe(false)
  })

  it('fails with the line of an error after a flip', () => {
    const { load, clock, onError, game } = setup()
    load('flip()\nflip()\nx = nil + 1')
    clock.frames(2)
    expect(game.running).toBe(false)
    expect(onError).toHaveBeenLastCalledWith(expect.objectContaining({ line: 3 }))
  })

  it('shows the frame at once from _draw', () => {
    /** @type {number[]} */
    const seen = []
    const { load, clock } = setup({ onFrame: (frame) => void seen.push(frame[0]) })
    load('function _draw() cls(3) flip() cls(4) end')
    seen.length = 0
    clock.frames(1)
    expect(seen).toEqual([3, 4])
  })

  it('does nothing to a cart that has a variable of that name', () => {
    const { load, global } = setup()
    load('flip = true function _update() end n = 1')
    expect(global('n')).toBe(1)
    expect(global('flip')).toBe(true)
  })
})

describe('the pause menu', () => {
  const counting = 'n = 0 function _update() n += 1 end function _draw() cls(1) end'

  it('stops the cart and draws over its frame', () => {
    const { load, clock, global, pause, screen } = setup()
    load(counting)
    clock.frames(1)
    expect(global('n')).toBe(1)
    pause()
    clock.frames(3)
    expect(global('n')).toBe(1)
    const shown = Array.from(screen())
    expect(shown.includes(7)).toBe(true) // the border of the menu
    expect(shown.includes(1)).toBe(true) // the frozen frame around it
  })

  it('goes back to the cart when paused again, or on continue', () => {
    const { load, clock, global, pause, tap, game } = setup()
    load(counting)
    clock.frames(1)
    pause()
    pause()
    expect(global('n')).toBe(2)
    pause()
    tap('KeyZ') // continue is the first entry
    expect(global('n')).toBe(3)
    clock.frames(1)
    expect(global('n')).toBe(4)
    expect(game.running).toBe(true)
  })

  it('holds the music while it is open', () => {
    const rom = pico8Profile.cart.createRom()
    const { sfx, music } = pico8Profile.memory.regions
    setSfx(rom.subarray(sfx[0], sfx[1]), 3, { notes: repeat([30, 0, 5, 0]), speed: 1 })
    rom.subarray(music[0], music[1]).set([3, 0x41, 0x42, 0x43])
    const { load, clock, pause, game, global } = setup()
    load('music(0) function _update() end', rom)
    const tick = () => /** @type {(n: number) => number} */ (global('stat'))(26)
    clock.frames(1)
    game.engine.render(new Float32Array(1024))
    const before = tick()
    expect(before).toBeGreaterThan(0)
    pause()
    game.engine.render(new Float32Array(1024))
    expect(tick()).toBe(before)
    pause()
    game.engine.render(new Float32Array(1024))
    expect(tick()).toBeGreaterThan(before)
  })

  it('does not leave the sound held when the game is replaced or stopped', () => {
    const { load, clock, pause, game } = setup()
    const held = vi.spyOn(game.engine, 'setPaused')
    load(counting)
    clock.frames(1)
    pause()
    expect(held).toHaveBeenLastCalledWith(true)
    load(counting)
    expect(held).toHaveBeenLastCalledWith(false)
    clock.frames(1)
    pause()
    game.stop()
    expect(held).toHaveBeenLastCalledWith(false)
  })

  it('puts the screen and the draw state back', () => {
    const { load, clock, global, pause, screen } = setup()
    load('function _draw() cls(2) camera(5, 6) pal(1, 8) end')
    clock.frames(1)
    pause()
    pause()
    const peek = /** @type {(a: number) => number} */ (global('peek'))
    expect([peek(0x5f28), peek(0x5f2a), peek(0x5f01)]).toEqual([5, 6, 8])
    expect(screen()[0]).not.toBe(7)
  })

  it('calls the entries of the cart with the buttons, and stays while they return true', () => {
    const { load, clock, global, pause, tap } = setup()
    load('log = "" function _init() menuitem(1, "boost", function(b) log ..= b .. "," return true end) end function _update() end')
    clock.frames(1)
    pause()
    tap('ArrowDown')
    tap('KeyZ')
    tap('ArrowLeft')
    tap('ArrowRight')
    tap('KeyX')
    expect(global('log')).toBe('16,1,2,32,')
    const before = global('log')
    tap('ArrowUp')
    tap('KeyZ') // continue
    clock.frames(1)
    expect(global('log')).toBe(before)
  })

  it('closes after an entry that does not return true', () => {
    const { load, clock, global, pause, tap } = setup()
    load('n = 0 function _init() menuitem(2, "go", function() hit = true end) end function _update() n += 1 end')
    clock.frames(1)
    pause()
    tap('ArrowDown')
    tap('KeyZ')
    expect(global('hit')).toBe(true)
    const n = global('n')
    clock.frames(2)
    expect(global('n')).toBe(/** @type {number} */ (n) + 2)
  })

  it('can change and remove its entries', () => {
    const { load, clock, global, pause, tap } = setup()
    load('function _init() menuitem(1, "a", function() which = "a" end) menuitem(1, "b", function() which = "b" end) menuitem(2, "c", function() which = "c" end) menuitem(2) end function _update() end')
    clock.frames(1)
    pause()
    tap('ArrowDown')
    tap('KeyZ')
    expect(global('which')).toBe('b')
    pause()
    tap('ArrowUp') // wraps to "reset game", where there is nothing for c
    expect(global('which')).toBe('b')
  })

  it('resets the cart from its last entry', () => {
    const { load, clock, global, pause, tap, game } = setup()
    load(counting)
    clock.frames(3)
    expect(global('n')).toBe(3)
    pause()
    tap('ArrowUp')
    tap('KeyZ') // the new run has had one frame by the time the key is let go
    expect(global('n')).toBe(1)
    expect(game.running).toBe(true)
    clock.frames(1)
    expect(global('n')).toBe(2)
  })

  it('forgets the entries of a cart that is replaced', () => {
    const { load, clock, pause, tap, global } = setup()
    load('function _init() menuitem(1, "x", function() hit = true end) end function _update() end')
    load('function _update() end')
    clock.frames(1)
    pause()
    tap('ArrowDown')
    tap('KeyZ')
    expect(global('hit')).toBeUndefined()
  })
})

describe('extcmd', () => {
  it('resets the cart', () => {
    const { load, clock, global } = setup()
    load('n = 0 function _update() n += 1 if n == 3 then extcmd("reset") end end')
    clock.frames(3)
    expect(global('n')).toBe(0)
    clock.frames(2)
    expect(global('n')).toBe(2)
  })

  it('shuts the game down', () => {
    const { load, clock, game } = setup()
    load('function _update() extcmd("shutdown") end')
    clock.frames(1)
    expect(game.running).toBe(false)
  })

  it('opens the pause menu', () => {
    const { load, clock, global } = setup()
    load('n = 0 function _update() n += 1 if n == 2 then extcmd("pause") end end')
    clock.frames(5)
    expect(global('n')).toBe(2)
  })

  it('hands the rest on to the host', () => {
    const { load, onExtcmd } = setup()
    load('extcmd("screen") extcmd("rec") extcmd(5)')
    expect(onExtcmd.mock.calls).toEqual([['screen'], ['rec']])
  })
})
