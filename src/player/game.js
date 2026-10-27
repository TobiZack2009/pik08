import { createEngine } from '../audio/engine.js'
import { createAudioOutput } from '../audio/output.js'
import { Memory } from '../core/memory.js'
import { compile, mapError } from '../lua/compile.js'
import { installApi, createMemoryAccess, DEVKIT } from './api.js'
import { browserStorage, createCartData } from './cartdata.js'
import { LINE_H } from './font.js'
import { Graphics, SCREEN_H, SCREEN_W } from './graphics.js'
import { Input } from './input.js'
import { createLoop } from './loop.js'
import { createMenu } from './menu.js'
import { paintIndexed } from './renderer.js'

/** @import { Profile } from '../core/profile.js' */
/** @import { Program } from '../lua/compile.js' */
/** @import { Storage } from './cartdata.js' */

/**
 * @typedef {Object} GameError
 * @property {number} line     Lua line, 1 when unknown
 * @property {string} message
 */

/**
 * @typedef {Object} GameOptions
 * @property {Profile} profile
 * @property {HTMLCanvasElement | null} [canvas]  where frames are shown
 * @property {Input} [input]
 * @property {(error: GameError | null) => void} [onError]  the cart failed (or, with null, started fine)
 * @property {(text: string) => void} [onPrint]             `printh` output
 * @property {(frame: Uint8Array) => void} [onFrame]        every frame shown, as palette indices (for previews)
 * @property {Pick<import('./loop.js').LoopOptions, 'schedule' | 'cancel' | 'now'>} [clock]  replaced in tests
 * @property {(engine: Engine) => AudioOutput} [createOutput]  the speakers; replaced in tests
 * @property {() => number} [random]  for the noise instrument; replaced in tests
 * @property {Storage | null} [storage]  where `cartdata` keeps its numbers (default: the browser's local storage, if any)
 * @property {(command: string) => void} [onExtcmd]  the `extcmd` commands the game does not handle itself (`screen`, `rec`, ...)
 * @property {() => Date} [date]  the time `stat` reports; replaced in tests
 * @property {() => number} [heap]  KiB of memory in use by the page, for `stat(0)` (default: Chrome's `performance.memory`, otherwise nothing)
 *
 * @typedef {Object} AudioOutput
 * @property {() => Promise<void>} start
 * @property {() => void} stop
 * @property {() => Promise<void>} close
 */

/** @typedef {import('../audio/engine.js').Engine} Engine */

/** Memory use of `stat(0)` is capped where the console's is. */
const LUA_MEMORY_KIB = 2048

/** KiB the page has in use (Chrome only), or NaN. */
function browserHeap() {
  const memory = /** @type {{ memory?: { usedJSHeapSize: number } }} */ (typeof performance === 'undefined' ? {} : performance).memory
  return memory ? memory.usedJSHeapSize / 1024 : NaN
}

/** Sound data of a game that has not loaded a cart yet. */
const NO_SFX = new Uint8Array(64 * 68)
const NO_MUSIC = new Uint8Array(64 * 4)

/** Characters per line of the error box (the font is 4 pixels wide). */
const ERROR_COLUMNS = Math.floor(SCREEN_W / 4)

/**
 * Splits text into lines that fit the screen.
 * @param {string} text
 * @returns {string[]}
 */
export function wrapText(text, columns = ERROR_COLUMNS) {
  /** @type {string[]} */
  const lines = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      let rest = word
      while (rest.length > columns) {
        if (line) lines.push(line)
        lines.push(rest.slice(0, columns))
        rest = rest.slice(columns)
        line = ''
      }
      if (!line) line = rest
      else if (line.length + 1 + rest.length <= columns) line += ' ' + rest
      else {
        lines.push(line)
        line = rest
      }
    }
    lines.push(line)
  }
  return lines
}

/**
 * One cart running on its own copy of the console's memory.
 *
 * `load` starts a cart (code and ROM); `swapRom` slips new graphics, map and sound data into the game
 * that is already running without restarting it. Errors stop the game, show the message on the
 * screen and are reported through `onError`.
 *
 * The main chunk and `_init` run a frame at a time, so a cart that loops with `flip` in them (instead
 * of using `_update` and `_draw`) is paced like any other. Enter or P opens the pause menu, which holds the sound too.
 *
 * @param {GameOptions} options
 */
export function createGame({ profile, canvas = null, input = new Input(), onError, onPrint, onFrame, clock, createOutput = createAudioOutput, random, storage = browserStorage(), onExtcmd, date, heap = browserHeap }) {
  /** @type {Memory | null} */
  let memory = null
  /** @type {Graphics | null} */
  let graphics = null
  /** @type {Program | null} */
  let program = null
  /** @type {GameError | null} */
  let error = null
  let frames = 0
  let fps = 30
  /** @type {Generator<void, any, void> | null} the main chunk and `_init`, until they have finished */
  let boot = null
  /** @type {ReturnType<typeof createMenu> | null} */
  let menu = null
  /** @type {ReturnType<typeof createCartData> | null} */
  let cartdata = null
  /** @type {'reset' | 'stop' | null} what the cart asked for, done once its code has returned */
  let pending = null
  /** @type {{ code: string, rom: Uint8Array } | null} */
  let lastCart = null
  /** @type {((...args: any[]) => any) | undefined} */
  let update
  /** @type {((...args: any[]) => any) | undefined} */
  let draw
  const frame = new Uint8Array(SCREEN_W * SCREEN_H)

  const now = clock?.now ?? (() => performance.now())
  /** when the step that is running began (milliseconds) */
  let stepStart = 0
  /** time spent showing frames since the step began, and in the one before */
  let showing = 0
  let showed = 0
  /** @type {number} the page's memory when the cart started, in KiB */
  let heap0 = NaN

  // The synth reads the sound regions of the game's own memory as it renders, so a cart that
  // pokes its sfx or music data is heard, and so is new data swapped in while it runs.
  const engine = createEngine({
    sfx: () => (memory ? memory.region('sfx') : NO_SFX),
    music: () => (memory ? memory.region('music') : NO_MUSIC),
    random,
  })
  /** @type {AudioOutput | null} made when the first sound is asked for */
  let output = null

  /** Starts the speakers, or wakes them if the browser kept them suspended. */
  function wake() {
    output ??= createOutput(engine)
    output.start().catch(() => {})
  }

  // the pause menu holds the sound too: the music and the notes stay where they were
  const syncPause = () => engine.setPaused(menu?.isOpen === true && !error)
  // the devkit mode is on while the cart has switched it on in memory
  input.devkit = () => memory !== null && (memory.data[DEVKIT] & 1) === 1

  const loop = createLoop({
    ...clock,
    fps: 30,
    step() {
      if (!program) return
      stepStart = now()
      showed = showing
      showing = 0
      input.tick()
      if (input.takePause() && menu) {
        if (menu.isOpen) menu.close()
        else menu.open()
      }
      guarded(() => {
        if (menu?.isOpen) menu.step()
        else if (boot) {
          frames++
          advanceBoot()
        } else if (update) {
          frames++
          /** @type {Program} */ (program).call(update)
        }
      })
      syncPause()
    },
    present() {
      if (!program) return
      if (menu?.isOpen) {
        menu.draw()
        show()
        return
      }
      if (boot) return // the cart shows its frames itself, with `flip`
      guarded(() => {
        if (draw) /** @type {Program} */ (program).call(draw)
      })
      syncPause()
      show()
    },
  })

  /**
   * Runs a piece of the cart's code: an error fails the game, and a reset or shutdown that the code
   * asked for happens once it has returned.
   * @param {() => void} run
   */
  function guarded(run) {
    try {
      run()
    } catch (e) {
      fail(e)
    }
    const asked = pending
    pending = null
    if (asked === 'reset' && lastCart) load(lastCart)
    else if (asked === 'stop') stop()
  }

  /** What `extcmd` asks of the game. @param {string} command */
  function extcmd(command) {
    if (command === 'pause') menu?.open()
    else if (command === 'reset') pending = 'reset'
    else if (command === 'shutdown') pending = 'stop'
    else onExtcmd?.(command)
  }

  /**
   * Runs the main chunk and `_init` up to the next `flip`, showing the frame it made, or to their
   * end, when the cart's callbacks take over.
   * @returns {boolean} false if the cart failed
   */
  function advanceBoot() {
    const running = boot
    if (!running || !program) return true
    try {
      if (!running.next().done) {
        show()
        return true
      }
    } catch (e) {
      boot = null
      fail(e)
      return false
    }
    boot = null
    const named = (/** @type {string} */ name) => {
      const f = /** @type {Program} */ (program).G.get(name)
      return typeof f === 'function' ? f : undefined
    }
    const update60 = named('_update60')
    update = update60 ?? named('_update')
    draw = named('_draw')
    fps = update60 ? 60 : 30
    loop.setFps(fps)
    // a cart with neither callback is finished once its main chunk ran
    if (update || draw) update ??= () => {}
    else loop.stop()
    return true
  }

  /** Paints the screen on the canvas and hands the frame to the preview. */
  function show() {
    if (!graphics) return
    const began = now()
    graphics.indices(frame)
    if (canvas) paintIndexed(canvas, frame, profile.display.palette)
    onFrame?.(frame)
    showing += now() - began
  }

  /** The share of a frame's time the cart has used so far, and what showing the previous frame cost. */
  function cpuUse() {
    const budget = 1000 / fps
    return { cpu: Math.max(0, now() - stepStart) / budget, system: showed / budget }
  }

  /** KiB the cart has added to the page's memory, within the console's 2 MiB; 0 where the browser does not tell. */
  function memoryUse() {
    const grown = heap() - heap0
    return Number.isFinite(grown) ? Math.min(LUA_MEMORY_KIB, Math.max(0, grown)) : 0
  }

  /**
   * The cart failed: stop and say why, on screen and to the outside.
   * @param {unknown} e
   */
  function fail(e) {
    loop.stop()
    engine.stop()
    engine.setPaused(false)
    cartdata?.flush()
    const mapped = mapError(e)
    const line = typeof mapped?.line === 'number' ? mapped.line : 1
    const message = String(mapped?.message ?? mapped)
    error = { line, message }
    if (graphics) {
      graphics.clip()
      graphics.camera()
      graphics.pal()
      const lines = wrapText(`runtime error line ${line}\n${message}`)
      const top = Math.max(0, SCREEN_H - 2 - lines.length * LINE_H)
      graphics.rectfill(0, top, SCREEN_W - 1, SCREEN_H - 1, 8)
      lines.forEach((text, i) => graphics?.print(text, 1, top + 1 + i * LINE_H, 7))
      show()
    }
    onError?.(error)
  }

  /**
   * Starts a cart from the beginning.
   * @param {{ code: string, rom: Uint8Array }} cart
   */
  function load({ code, rom }) {
    cartdata?.flush()
    loop.stop()
    engine.stop()
    engine.setPaused(false)
    heap0 = heap()
    lastCart = { code, rom: rom.slice() }
    error = null
    program = null
    update = draw = undefined
    boot = null
    pending = null
    frames = 0
    fps = 30
    loop.setFps(fps)
    input.releaseAll()
    memory = new Memory(profile.memory)
    memory.loadCart({ rom })
    const data = memory.data
    graphics = new Graphics(data)
    const access = createMemoryAccess(data)
    cartdata = createCartData(data, storage)
    const pause = (menu = createMenu({
      graphics,
      data,
      input,
      call: (callback, buttons) => /** @type {Program} */ (program).call(callback, buttons),
      reset: () => {
        pending = 'reset'
      },
    }))

    try {
      const compiled = (program = compile(code, {
        host: {
          printh: (text) => onPrint?.(text),
          time: () => frames / fps,
          peek: (/** @type {number} */ a) => access.peek(a),
          peek2: (/** @type {number} */ a) => access.peek2(a),
          peek4: (/** @type {number} */ a) => access.peek4(a),
          flip: show,
        },
      }))
      installApi(compiled.G, {
        graphics,
        data,
        rom: rom.slice(),
        input,
        tostr: (v) => compiled.rt.ops.tostr(v),
        fps: () => (boot && typeof compiled.G.get('_update60') === 'function' ? 60 : fps), // known as soon as the cart defines it
        engine,
        wake,
        cartdata,
        menuitem: pause.setItem,
        extcmd,
        date,
        memory: memoryUse,
        cpu: cpuUse,
        version: profile.cart.defaultVersion,
      })
      boot = (function* () {
        yield* compiled.drive(compiled.main)
        const init = compiled.G.get('_init')
        if (typeof init === 'function') yield* compiled.drive(init)
      })()
    } catch (e) {
      fail(e)
      return
    }
    if (!advanceBoot()) return
    onError?.(null)
    show()
    if (boot || update || draw) loop.start()
  }

  function stop() {
    cartdata?.flush()
    loop.stop()
    engine.stop()
    engine.setPaused(false)
  }

  return {
    load,
    /**
     * Replaces the ROM data (sprites, map, flags, music, sfx) of the running game.
     * @param {Uint8Array} rom
     */
    swapRom(rom) {
      if (!memory) return
      if (lastCart) lastCart.rom = rom.slice()
      memory.loadCart({ rom })
      if (!loop.running) show()
    },
    stop,
    /** For a click or key press in the page: browsers only let sound start after one. */
    wake() {
      if (output) output.start().catch(() => {})
    },
    /** Silences the game and lets go of the speakers. */
    async destroy() {
      stop()
      await output?.close()
      output = null
    },
    engine,
    /** Shows the screen again, e.g. after the canvas changed. */
    show,
    input,
    get running() {
      return loop.running
    },
    get error() {
      return error
    },
    get frames() {
      return frames
    },
    get graphics() {
      return graphics
    },
    get program() {
      return program
    },
  }
}
