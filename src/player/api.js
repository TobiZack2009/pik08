import { LuaError } from '../lua/errors.js'
import { NONE } from '../lua/values.js'
import { CARTDATA_ADDR } from './cartdata.js'

/** @import { LuaTable } from '../lua/table.js' */
/** @import { Graphics } from './graphics.js' */
/** @import { Input } from './input.js' */
/** @import { Engine } from '../audio/engine.js' */
/** @import { createCartData } from './cartdata.js' */

/**
 * The console's functions as a cart sees them: argument handling for Lua values (a missing argument
 * is `undefined`) around the graphics, memory and input of one running game.
 *
 * `sfx` and `music` drive the sound engine; `cartdata`, `dget` and `dset` keep numbers between runs;
 * `menuitem` and `extcmd` belong to the pause menu and the host. `flip` is part of the coroutine
 * machinery (see lua/coroutine.js), since it has to suspend the cart.
 */

const MEMORY_SIZE = 0x8000

/** A number argument, or undefined when it is missing or not a number. @param {any} x */
const num = (x) => (typeof x === 'number' ? x : undefined)
/** A number argument, 0 if it is missing. @param {any} x */
const num0 = (x) => (typeof x === 'number' ? x : 0)
/** A boolean argument. @param {any} x */
const bool = (x) => x !== undefined && x !== false

/**
 * Reads and writes the address space as bytes, 16-bit and 32-bit values (little endian, the 32-bit
 * ones as 16.16 fixed point). Addresses outside memory are an error in the cart.
 * @param {Uint8Array} data
 */
export function createMemoryAccess(data) {
  /** @param {number} addr @param {number} [size] */
  const at = (addr, size = 1) => {
    const a = Math.floor(addr)
    if (!(a >= 0 && a + size <= MEMORY_SIZE)) throw new LuaError('bad memory access')
    return a
  }
  return {
    /** @param {number} addr */
    peek: (addr) => data[at(addr)],
    /** @param {number} addr */
    peek2: (addr) => {
      const a = at(addr, 2)
      return (((data[a] | (data[a + 1] << 8)) << 16) >> 16)
    },
    /** @param {number} addr */
    peek4: (addr) => {
      const a = at(addr, 4)
      return (data[a] | (data[a + 1] << 8) | (data[a + 2] << 16) | (data[a + 3] << 24)) / 65536
    },
    /** @param {number} addr @param {number} value */
    poke: (addr, value) => {
      data[at(addr)] = Math.floor(value)
    },
    /** @param {number} addr @param {number} value */
    poke2: (addr, value) => {
      const a = at(addr, 2)
      const v = Math.floor(value)
      data[a] = v & 255
      data[a + 1] = (v >> 8) & 255
    },
    /** @param {number} addr @param {number} value */
    poke4: (addr, value) => {
      const a = at(addr, 4)
      const v = Math.floor(value * 65536) | 0
      data[a] = v & 255
      data[a + 1] = (v >> 8) & 255
      data[a + 2] = (v >> 16) & 255
      data[a + 3] = (v >>> 24) & 255
    },
    /** @param {number} dest @param {number} src @param {number} length */
    memcpy: (dest, src, length) => {
      const n = Math.max(0, Math.floor(length))
      if (n === 0) return
      data.copyWithin(at(dest, n), at(src, n), at(src, n) + n)
    },
    /** @param {number} dest @param {number} value @param {number} length */
    memset: (dest, value, length) => {
      const n = Math.max(0, Math.floor(length))
      if (n === 0) return
      data.fill(Math.floor(value) & 255, at(dest, n), at(dest, n) + n)
    },
  }
}

/** The time as `stat` reports it: year, month, day, hour, minute, second. @param {Date} d @param {boolean} utc */
function clockFields(d, utc) {
  return utc
    ? [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
    : [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]
}

/**
 * What `stat` can tell about the game.
 * @typedef {Object} StatSource
 * @property {number} fps
 * @property {Engine} engine
 * @property {Date} date
 * @property {Input} input
 * @property {Uint8Array} data
 * @property {number} memory   Lua memory in KiB
 * @property {number} cpu      the share of the frame used so far (1 is all of it)
 * @property {number} system   the share of the previous frame that went to showing it
 * @property {number} version
 */

/** The devkit mode is on while bit 0 of this byte is set. */
export const DEVKIT = 0x5f2d

/**
 * `stat(n)`: the memory (0) and cpu (1, 2) use, the version (5) and launch parameter (6, always
 * empty), the frame rate (7, 9) and the rate asked for (8), what the sound engine is doing (the
 * sound (16-19, 46-49) and the note (20-23, 50-53) on each channel, -1 when a channel is silent, the
 * music pattern (24, 54), the number of patterns played since `music` was called (25, 55), the tick in
 * the pattern (26) and whether music plays (57)), the keyboard and mouse of the devkit mode (30-34, 36)
 * and the date and time, in UTC (80-85) and local (90-95). Everything else reads as 0.
 * @param {number} n
 * @param {StatSource} source
 */
function stat(n, { fps, engine, date, input, data, memory, cpu, system, version }) {
  if (n === 0) return memory
  if (n === 1) return cpu
  if (n === 2) return system
  if (n === 5) return version
  if (n === 7 || n === 8 || n === 9) return fps
  if (n === 6) return ''
  if (n >= 30 && n <= 36) {
    if (!(data[DEVKIT] & 1)) return n === 30 ? false : n === 31 ? '' : 0
    if (n === 30) return input.text.length > 0
    if (n === 31) return input.takeText()
    if (n === 32) return input.pointer.x
    if (n === 33) return input.pointer.y
    if (n === 34) return input.pointer.buttons
    return n === 36 ? input.wheel : 0
  }
  if (n === 26) return engine.state.tick
  if (n === 57) return engine.state.pattern !== -1
  if (n >= 80 && n <= 85) return clockFields(date, true)[n - 80]
  if (n >= 90 && n <= 95) return clockFields(date, false)[n - 90]
  if ((n >= 16 && n <= 25) || (n >= 46 && n <= 55)) {
    const k = n >= 46 ? n - 30 : n
    const state = engine.state
    if (k <= 19) return state.channels[k - 16].sfx
    if (k <= 23) {
      const ch = state.channels[k - 20]
      return ch.sfx < 0 ? -1 : Math.floor(ch.note)
    }
    return k === 24 ? state.pattern : state.count
  }
  return 0
}

/**
 * Puts the console's functions into a globals table.
 *
 * @param {LuaTable} G
 * @param {Object} game
 * @param {Graphics} game.graphics
 * @param {Uint8Array} game.data       the address space
 * @param {Uint8Array} game.rom        the cart's ROM, for `reload`
 * @param {Input} game.input
 * @param {(value: any) => string} game.tostr  Lua's `tostring`
 * @param {() => number} game.fps
 * @param {Engine} game.engine         the synth that `sfx` and `music` play on
 * @param {() => void} game.wake       starts the audio output; called when a cart makes a sound
 * @param {ReturnType<typeof createCartData>} game.cartdata  the persistent numbers
 * @param {(index: number, label?: string, callback?: (...args: any[]) => any) => void} game.menuitem  sets or removes an entry of the pause menu
 * @param {(command: string) => void} game.extcmd  what the cart asks of the host
 * @param {() => Date} [game.date]     the time `stat` reports; the real one by default
 * @param {() => number} game.memory   Lua memory in KiB, for `stat(0)`
 * @param {() => { cpu: number, system: number }} game.cpu  the use of the frame so far and of the previous frame's showing, for `stat(1)` and `stat(2)`
 * @param {number} game.version        the version id of the console, for `stat(5)`
 */
export function installApi(G, { graphics: g, data, rom, input, tostr, fps, engine, wake, cartdata, menuitem, extcmd, date = () => new Date(), memory, cpu, version }) {
  /** @param {string} name @param {(...args: any[]) => any} fn */
  const def = (name, fn) => G.set(name, fn)
  /** Defines a function that returns nothing. @param {string} name @param {(...args: any[]) => void} fn */
  const act = (name, fn) =>
    def(name, (...args) => {
      fn(...args)
      return NONE
    })
  const mem = createMemoryAccess(data)

  // ---- drawing ----------------------------------------------------------------------------------
  act('cls', (c) => g.cls(num(c)))
  act('pset', (x, y, c) => g.pset(num0(x), num0(y), num(c)))
  def('pget', (x, y) => g.pget(num0(x), num0(y)))
  act('line', (x0, y0, x1, y1, c) => g.line(num0(x0), num0(y0), num(x1), num(y1), num(c)))
  act('rect', (x0, y0, x1, y1, c) => g.rect(num0(x0), num0(y0), num0(x1), num0(y1), num(c)))
  act('rectfill', (x0, y0, x1, y1, c) => g.rectfill(num0(x0), num0(y0), num0(x1), num0(y1), num(c)))
  act('circ', (x, y, r, c) => g.circ(num0(x), num0(y), num(r) ?? 4, num(c)))
  act('circfill', (x, y, r, c) => g.circfill(num0(x), num0(y), num(r) ?? 4, num(c)))
  act('spr', (n, x, y, w, h, fx, fy) => g.spr(num0(n), num0(x), num0(y), num(w), num(h), bool(fx), bool(fy)))
  act('sspr', (sx, sy, sw, sh, dx, dy, dw, dh, fx, fy) =>
    g.sspr(num0(sx), num0(sy), num0(sw), num0(sh), num0(dx), num0(dy), num(dw), num(dh), bool(fx), bool(fy)),
  )
  act('map', (cx, cy, sx, sy, cw, ch, layer) => g.map(num(cx), num(cy), num(sx), num(sy), num(cw), num(ch), num(layer)))
  def('sget', (x, y) => g.sget(num0(x), num0(y)))
  act('sset', (x, y, c) => g.sset(num0(x), num0(y), num0(c)))
  def('mget', (x, y) => g.mget(num0(x), num0(y)))
  act('mset', (x, y, tile) => g.mset(num0(x), num0(y), num0(tile)))
  def('fget', (n, bit) => g.fget(num0(n), num(bit)))
  act('fset', (n, a, b) => g.fset(num0(n), num0(a), b === undefined ? undefined : bool(b)))
  def('print', (value, x, y, c) => g.print(typeof value === 'string' ? value : tostr(value), num(x), num(y), num(c)))
  act('color', (c) => g.color(num(c)))
  def('fillp', (p) => g.fillp(num0(p)))
  act('cursor', (x, y, c) => g.cursor(num(x), num(y), num(c)))
  act('camera', (x, y) => g.camera(num(x), num(y)))
  act('clip', (x, y, w, h) => g.clip(num(x), num(y), num(w), num(h)))
  act('pal', (a, b, p) => g.pal(num(a), num(b), num(p)))
  act('palt', (c, on) => g.palt(num(c), on === undefined ? undefined : bool(on)))

  // ---- input ------------------------------------------------------------------------------------
  def('btn', (i, p) => (num(i) === undefined ? input.mask() : input.btn(Math.floor(num0(i)) & 7, Math.floor(num0(p)) & 1)))
  def('btnp', (i, p) => (num(i) === undefined ? input.mask(true) : input.btnp(Math.floor(num0(i)) & 7, Math.floor(num0(p)) & 1)))

  // ---- memory -----------------------------------------------------------------------------------
  def('peek', (addr, n) => {
    const count = Math.max(1, Math.floor(num(n) ?? 1))
    const a = num0(addr)
    if (count === 1) return mem.peek(a)
    return Array.from({ length: count }, (_, i) => mem.peek(a + i))
  })
  def('peek2', (addr) => mem.peek2(num0(addr)))
  def('peek4', (addr) => mem.peek4(num0(addr)))
  act('poke', (addr, ...values) => values.forEach((v, i) => mem.poke(num0(addr) + i, num0(v))))
  act('poke2', (addr, v) => mem.poke2(num0(addr), num0(v)))
  act('poke4', (addr, v) => mem.poke4(num0(addr), num0(v)))
  act('memcpy', (dest, src, length) => mem.memcpy(num0(dest), num0(src), num0(length)))
  act('memset', (dest, value, length) => mem.memset(num0(dest), num0(value), num0(length)))
  act('reload', (dest, src, length) => {
    const d = Math.floor(num(dest) ?? 0)
    const s = Math.floor(num(src) ?? d)
    const n = Math.max(0, Math.floor(num(length) ?? rom.length))
    const part = rom.subarray(s, Math.min(s + n, rom.length))
    if (s >= 0 && d >= 0 && d + part.length <= MEMORY_SIZE) data.set(part, d)
  })
  // `cstore` keeps memory in the game's copy of the cart, where `reload` finds it (the cart file itself is not written)
  act('cstore', (dest, src, length) => {
    const d = Math.floor(num(dest) ?? 0)
    const s = Math.floor(num(src) ?? d)
    const n = Math.max(0, Math.floor(num(length) ?? rom.length))
    if (d < 0 || s < 0 || d >= rom.length || s + n > MEMORY_SIZE) return
    rom.set(data.subarray(s, s + Math.min(n, rom.length - d)), d)
  })
  def('stat', (n) => {
    const k = Math.floor(num0(n))
    // the measurements are only taken when asked for
    const use = k === 1 || k === 2 ? cpu() : { cpu: 0, system: 0 }
    return stat(k, { fps: fps(), engine, date: date(), input, data, memory: k === 0 ? memory() : 0, cpu: use.cpu, system: use.system, version })
  })

  // ---- saved numbers ----------------------------------------------------------------------------
  def('cartdata', (id) => cartdata.open(typeof id === 'string' ? id : ''))
  /** The address of saved number `i`, or -1 when it is out of range. @param {any} i */
  const slot = (i) => {
    if (cartdata.id === null) throw new LuaError('cartdata() not called')
    const n = Math.floor(num0(i))
    return n >= 0 && n < 64 ? CARTDATA_ADDR + n * 4 : -1
  }
  def('dget', (i) => {
    const a = slot(i)
    return a < 0 ? 0 : mem.peek4(a)
  })
  act('dset', (i, value) => {
    const a = slot(i)
    if (a < 0) return
    mem.poke4(a, num0(value))
    cartdata.flush()
  })

  // ---- the pause menu and the host --------------------------------------------------------------
  act('menuitem', (index, label, callback) => {
    const i = Math.floor(num0(index))
    if (i < 1 || i > 5) return
    menuitem(i, typeof label === 'string' ? label : undefined, typeof callback === 'function' ? callback : undefined)
  })
  act('extcmd', (command) => {
    if (typeof command === 'string') extcmd(command)
  })

  // ---- sound ------------------------------------------------------------------------------------
  act('sfx', (n, channel, offset, length) => {
    if (num(n) === undefined) return
    engine.sfx(n, num(channel) ?? -1, num(offset) ?? 0, num(length) ?? 0)
    wake()
  })
  act('music', (n, fade, mask) => {
    if (num(n) === undefined) return
    engine.music(n, num(fade) ?? 0, num(mask) ?? 0)
    wake()
  })
}
