import { describe, expect, it, vi } from 'vitest'
import { Input } from '../../src/player/input.js'
import { createLoop } from '../../src/player/loop.js'

describe('Input', () => {
  /** @param {Input} input @param {number} n */
  const tick = (input, n = 1) => {
    for (let i = 0; i < n; i++) input.tick()
  }

  it('holds a button while the key is down', () => {
    const input = new Input()
    input.press('ArrowLeft')
    expect(input.btn(0)).toBe(false) // not before the frame is counted
    tick(input)
    expect(input.btn(0)).toBe(true)
    input.release('ArrowLeft')
    tick(input)
    expect(input.btn(0)).toBe(false)
  })

  it('maps several keys to one button and two players', () => {
    const input = new Input()
    input.press('KeyC')
    input.press('KeyS')
    tick(input)
    expect(input.btn(4)).toBe(true)
    expect(input.btn(0, 1)).toBe(true)
    expect(input.btn(0, 0)).toBe(false)
  })

  it('reports a press once, then repeats while held', () => {
    const input = new Input()
    input.press('KeyZ')
    const presses = []
    for (let frame = 1; frame <= 24; frame++) {
      tick(input)
      if (input.btnp(4)) presses.push(frame)
    }
    expect(presses).toEqual([1, 19, 23])
  })

  it('builds bit masks', () => {
    const input = new Input()
    input.press('ArrowRight')
    input.press('KeyX')
    input.press('KeyD')
    tick(input)
    expect(input.mask()).toBe(0b10_0010 | (1 << 11))
    expect(input.mask(true)).toBe(input.mask())
    tick(input)
    expect(input.mask(true)).toBe(0)
  })

  it('lets go of everything', () => {
    const input = new Input()
    input.press('ArrowUp')
    input.releaseAll()
    tick(input)
    expect(input.btn(2)).toBe(false)
  })

  it('listens to a window and detaches again', () => {
    const input = new Input()
    const handlers = new Map()
    const target = /** @type {any} */ ({
      addEventListener: (/** @type {string} */ type, /** @type {any} */ fn) => handlers.set(type, fn),
      removeEventListener: (/** @type {string} */ type) => handlers.delete(type),
    })
    const detach = input.attach(target)
    const prevent = vi.fn()
    handlers.get('keydown')({ code: 'ArrowDown', preventDefault: prevent })
    expect(prevent).toHaveBeenCalled()
    tick(input)
    expect(input.btn(3)).toBe(true)

    // keys of the browser (Ctrl+Z) and unrelated keys are left alone
    const other = vi.fn()
    handlers.get('keydown')({ code: 'KeyZ', ctrlKey: true, preventDefault: other })
    handlers.get('keydown')({ code: 'KeyK', preventDefault: other })
    expect(other).not.toHaveBeenCalled()

    handlers.get('keyup')({ code: 'ArrowDown' })
    tick(input)
    expect(input.btn(3)).toBe(false)

    handlers.get('keydown')({ code: 'ArrowDown', preventDefault() {} })
    handlers.get('blur')()
    tick(input)
    expect(input.btn(3)).toBe(false)

    detach()
    expect(handlers.size).toBe(0)
  })

  it('notes a press of the pause key once', () => {
    const input = new Input()
    const handlers = new Map()
    const target = /** @type {any} */ ({ addEventListener: (/** @type {string} */ t, /** @type {any} */ fn) => handlers.set(t, fn), removeEventListener() {} })
    input.attach(target)
    const prevent = vi.fn()
    expect(input.takePause()).toBe(false)
    handlers.get('keydown')({ code: 'KeyP', preventDefault: prevent })
    expect(prevent).toHaveBeenCalled()
    expect(input.takePause()).toBe(true)
    expect(input.takePause()).toBe(false)
    handlers.get('keydown')({ code: 'Enter', repeat: true, preventDefault() {} }) // holding the key does not count again
    expect(input.takePause()).toBe(false)
    handlers.get('keydown')({ code: 'Enter', preventDefault() {} })
    input.releaseAll()
    expect(input.takePause()).toBe(false)
  })

  describe('in devkit mode', () => {
    /** An input that listens to a fake window, with the devkit mode on or off. */
    function listening(devkit = true) {
      const input = new Input()
      input.devkit = () => devkit
      const handlers = new Map()
      input.attach(/** @type {any} */ ({ addEventListener: (/** @type {string} */ t, /** @type {any} */ fn) => handlers.set(t, fn), removeEventListener() {} }))
      /** @param {object} event */
      const key = (event) => handlers.get('keydown')({ preventDefault() {}, ...event })
      return { input, key }
    }

    it('keeps what is typed, and hands it out in order', () => {
      const { input, key } = listening()
      key({ code: 'KeyH', key: 'h' })
      key({ code: 'KeyI', key: 'I' })
      key({ code: 'Enter', key: 'Enter' })
      key({ code: 'Backspace', key: 'Backspace' })
      key({ code: 'ArrowLeft', key: 'ArrowLeft' }) // not a character
      expect([input.takeText(), input.takeText(), input.takeText(), input.takeText(), input.takeText()]).toEqual(['h', 'I', '\r', '\b', ''])
    })

    it('still plays the buttons with the keys that it types', () => {
      const { input, key } = listening()
      key({ code: 'KeyZ', key: 'z' })
      tick(input)
      expect(input.btn(4)).toBe(true)
      expect(input.takeText()).toBe('z')
    })

    it('leaves the pause keys to the cart and pauses with Escape', () => {
      const { input, key } = listening()
      key({ code: 'KeyP', key: 'p' })
      key({ code: 'Enter', key: 'Enter' })
      expect(input.takePause()).toBe(false)
      expect(input.text).toEqual(['p', '\r'])
      key({ code: 'Escape', key: 'Escape' })
      expect(input.takePause()).toBe(true)
    })

    it('types nothing when the mode is off', () => {
      const { input, key } = listening(false)
      key({ code: 'KeyH', key: 'h' })
      expect(input.text).toEqual([])
      key({ code: 'KeyP', key: 'p' })
      expect(input.takePause()).toBe(true)
    })

    it('does not keep more than it can use', () => {
      const { input, key } = listening()
      for (let i = 0; i < 200; i++) key({ code: 'KeyH', key: 'h' })
      expect(input.text).toHaveLength(64)
    })

    it('forgets what was typed when it lets go of everything', () => {
      const { input, key } = listening()
      key({ code: 'KeyH', key: 'h' })
      input.releaseAll()
      expect(input.takeText()).toBe('')
    })
  })

  describe('the pointer', () => {
    function pointing(devkit = true) {
      const input = new Input()
      input.devkit = () => devkit
      /** @type {Map<string, any>} */
      const onScreen = new Map()
      /** @type {Map<string, any>} */
      const onWindow = new Map()
      const screen = /** @type {any} */ ({
        addEventListener: (/** @type {string} */ t, /** @type {any} */ fn) => onScreen.set(t, fn),
        removeEventListener: (/** @type {string} */ t) => onScreen.delete(t),
        getBoundingClientRect: () => ({ left: 100, top: 20, width: 256, height: 256 }),
      })
      const win = /** @type {any} */ ({
        addEventListener: (/** @type {string} */ t, /** @type {any} */ fn) => onWindow.set(t, fn),
        removeEventListener: (/** @type {string} */ t) => onWindow.delete(t),
      })
      const detach = input.attachPointer(screen, 128, 128, win)
      return { input, onScreen, onWindow, detach }
    }

    it('turns a position over the canvas into a screen pixel', () => {
      const { input, onScreen, onWindow } = pointing()
      onScreen.get('pointerdown')({ clientX: 100 + 128, clientY: 20 + 64, buttons: 1 })
      expect(input.pointer).toMatchObject({ x: 64, y: 32, buttons: 1 })
      onWindow.get('pointermove')({ clientX: 100 + 255, clientY: 20 + 1, buttons: 3 })
      expect(input.pointer).toMatchObject({ x: 127, y: 0, buttons: 3 })
    })

    it('keeps a drag that leaves the canvas on the screen\'s edge, and hears the release', () => {
      const { input, onWindow } = pointing()
      onWindow.get('pointermove')({ clientX: 5000, clientY: -40, buttons: 1 })
      expect(input.pointer).toMatchObject({ x: 127, y: 0, buttons: 1 })
      onWindow.get('pointerup')({ clientX: 5000, clientY: -40, buttons: 0 })
      expect(input.pointer.buttons).toBe(0)
    })

    it('reports the wheel for one frame, only in devkit mode', () => {
      const { input, onScreen } = pointing()
      const prevent = vi.fn()
      onScreen.get('wheel')({ deltaY: -100, preventDefault: prevent })
      expect(prevent).toHaveBeenCalled()
      tick(input)
      expect(input.wheel).toBe(1)
      tick(input)
      expect(input.wheel).toBe(0)
      onScreen.get('wheel')({ deltaY: 100, preventDefault() {} })
      tick(input)
      expect(input.wheel).toBe(-1)

      const off = pointing(false)
      const left = vi.fn()
      off.onScreen.get('wheel')({ deltaY: -100, preventDefault: left })
      tick(off.input)
      expect(left).not.toHaveBeenCalled()
      expect(off.input.wheel).toBe(0)
    })

    it('detaches again', () => {
      const { onScreen, onWindow, detach, input } = pointing()
      input.pointer.buttons = 1
      detach()
      expect(onScreen.size + onWindow.size).toBe(0)
      expect(input.pointer.buttons).toBe(0)
    })
  })
})

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
    /** Moves the time on and runs the scheduled frame. @param {number} ms */
    advance(ms) {
      time += ms
      const cb = pending
      pending = null
      cb?.()
    },
    get scheduled() {
      return pending !== null
    },
  }
}

describe('createLoop', () => {
  it('steps at a fixed rate whatever the display does', () => {
    const clock = fakeClock()
    const step = vi.fn()
    const present = vi.fn()
    const loop = createLoop({ ...clock, step, present, fps: 30 })
    loop.start()
    clock.advance(16) // a 60 Hz display frame: not enough for a 30 fps step
    expect(step).toHaveBeenCalledTimes(0)
    clock.advance(17)
    expect(step).toHaveBeenCalledTimes(1)
    expect(present).toHaveBeenCalledTimes(1)
    clock.advance(16)
    expect(present).toHaveBeenCalledTimes(1) // nothing stepped, nothing shown
    clock.advance(18)
    expect(step).toHaveBeenCalledTimes(2)
  })

  it('runs at 60 fps when asked', () => {
    const clock = fakeClock()
    const step = vi.fn()
    const loop = createLoop({ ...clock, step })
    loop.setFps(60)
    expect(loop.fps).toBeCloseTo(60)
    loop.start()
    for (let i = 0; i < 6; i++) clock.advance(1000 / 60)
    expect(step).toHaveBeenCalledTimes(6)
  })

  it('catches up a little after a stall, then gives up', () => {
    const clock = fakeClock()
    const step = vi.fn()
    const loop = createLoop({ ...clock, step, fps: 30 })
    loop.start()
    clock.advance(1000) // thirty frames late
    expect(step).toHaveBeenCalledTimes(4)
    clock.advance(10)
    expect(step).toHaveBeenCalledTimes(4) // the debt is forgiven
  })

  it('stops, and can start again', () => {
    const clock = fakeClock()
    const step = vi.fn()
    const loop = createLoop({ ...clock, step })
    expect(loop.running).toBe(false)
    loop.start()
    loop.start()
    expect(loop.running).toBe(true)
    loop.stop()
    expect(loop.running).toBe(false)
    expect(clock.scheduled).toBe(false)
    loop.stop()
    loop.start()
    clock.advance(34)
    expect(step).toHaveBeenCalledTimes(1)
  })

  it('stops in the middle of a frame when a step stops it', () => {
    const clock = fakeClock()
    const present = vi.fn()
    /** @type {ReturnType<typeof createLoop>} */
    let loop
    const step = vi.fn(() => loop.stop())
    loop = createLoop({ ...clock, step, present })
    loop.start()
    clock.advance(100)
    expect(step).toHaveBeenCalledTimes(1)
    expect(present).not.toHaveBeenCalled()
  })
})
