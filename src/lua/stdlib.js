import { LuaError } from './errors.js'
import { toBits } from './numbers.js'
import { LuaTable } from './table.js'
import { NONE, typeName } from './values.js'

/** @import { Ops } from './ops.js' */

/**
 * Things the core library needs from the outside world. All optional.
 * @typedef {Object} Host
 * @property {(...args: any[]) => void} [print]   `print(value, x, y, col)`; receives raw Lua values
 * @property {(text: string) => void} [printh]    Host console output
 * @property {() => number} [time]                Seconds since the cart started
 * @property {number} [seed]                      Initial random seed (random if omitted)
 */

const TAU = Math.PI * 2

/**
 * Creates the PICO-8 global environment that does not depend on graphics, sound or input: tables,
 * strings, math, metatables and so on. Returns the globals table with those functions installed.
 * @param {Ops} ops
 * @param {Host} [host]
 * @returns {LuaTable}
 */
export function createStdlib(ops, host = {}) {
  const M = ops.model
  const G = new LuaTable()
  const { tostr } = ops

  /** Registers a global. @param {string} name @param {(...args: any[]) => any} fn */
  const def = (name, fn) => G.set(name, fn)

  /** Numeric argument: numbers pass, numeric strings convert, anything else is 0. @param {any} x */
  const num = (x) => (typeof x === 'number' ? x : typeof x === 'string' ? (M.parse(x) ?? 0) : 0)
  /** Integer argument (truncated). @param {any} x */
  const int = (x) => Math.trunc(num(x))

  /**
   * @param {string} fname
   * @param {number} n
   * @param {string} expected
   * @param {any} got
   */
  const badArg = (fname, n, expected, got) =>
    new LuaError(`bad argument #${n} to '${fname}' (${expected} expected, got ${typeName(got)})`)

  /**
   * String argument; numbers convert.
   * @param {any} x
   * @param {string} fname
   * @param {number} n
   * @returns {string}
   */
  const str = (x, fname, n) => {
    if (typeof x === 'string') return x
    if (typeof x === 'number') return M.tostring(x)
    throw badArg(fname, n, 'string', x)
  }

  /**
   * Table argument. nil is tolerated (PICO-8 table functions silently do nothing for it).
   * @param {any} x
   * @param {string} fname
   * @returns {LuaTable | undefined}
   */
  const tbl = (x, fname) => {
    if (x instanceof LuaTable) return x
    if (x === undefined) return undefined
    throw badArg(fname, 1, 'table', x)
  }

  // --- tables ------------------------------------------------------------------------------

  def('add', (t, v, i) => {
    const tb = tbl(t, 'add')
    if (tb === undefined || v === undefined) return undefined
    if (i === undefined) tb.push(v)
    else tb.insertAt(Math.min(Math.max(int(i), 1), tb.length() + 1), v)
    return v
  })

  def('del', (t, v) => {
    const tb = tbl(t, 'del')
    if (tb === undefined || v === undefined) return undefined
    const a = tb.a
    for (let i = 0; i < a.length; i++) {
      if (a[i] === v) {
        tb.removeAt(i + 1)
        return v
      }
    }
    return undefined
  })

  def('deli', (t, i) => {
    const tb = tbl(t, 'deli')
    if (tb === undefined) return undefined
    const idx = i === undefined ? tb.length() : int(i)
    return idx >= 1 && idx <= tb.length() ? tb.removeAt(idx) : undefined
  })

  def('count', (t, v) => {
    const tb = tbl(t, 'count')
    if (tb === undefined) return 0
    let n = 0
    for (const x of tb.a) if (v === undefined ? x !== undefined : x === v) n++
    return n
  })

  def('all', (t) => {
    const tb = tbl(t, 'all')
    let i = 0
    return () => {
      if (tb === undefined) return undefined
      const a = tb.a
      while (i < a.length) {
        const v = a[i++]
        if (v !== undefined) return v
      }
      return undefined
    }
  })

  /** @type {((...args: any[]) => any) & { $g?: (...args: any[]) => Generator<any[], any, any[]> }} */
  const foreach = (t, f) => {
    const tb = tbl(t, 'foreach')
    const fn = ops.call(f, 'foreach callback')
    if (tb === undefined) return NONE
    const a = tb.a
    for (let i = 0; i < a.length; i++) {
      const v = a[i]
      if (v !== undefined) fn(v)
    }
    return NONE
  }
  // the callback may yield (see coroutine.js); the plain version above cannot suspend
  foreach.$g = function* (t, f) {
    const tb = tbl(t, 'foreach')
    /** @type {any} */
    const fn = ops.call(f, 'foreach callback')
    if (tb === undefined) return NONE
    const a = tb.a
    for (let i = 0; i < a.length; i++) {
      const v = a[i]
      if (v === undefined) continue
      if (fn.$g === undefined) fn(v)
      else yield* fn.$g(v)
    }
    return NONE
  }
  def('foreach', foreach)

  /** @param {LuaTable} t @param {any} i */
  const inext = (t, i) => {
    const k = num(i) + 1
    const v = ops.index(t, k)
    return v === undefined ? undefined : [k, v]
  }
  def('inext', inext)

  def('ipairs', (t) => {
    if (t === undefined) return [() => undefined, t, 0]
    if (!(t instanceof LuaTable) && typeof t !== 'string') throw badArg('ipairs', 1, 'table', t)
    return [inext, t, 0]
  })

  def('pairs', (t) => {
    if (t === undefined) return [() => undefined, t, undefined]
    if (!(t instanceof LuaTable)) throw badArg('pairs', 1, 'table', t)
    const h = t.meta === null ? undefined : t.meta.getStr('__pairs')
    if (h !== undefined) return ops.call(h)(t)
    const it = t.iterator()
    return [() => it(), t, undefined]
  })

  def('next', (t, k) => {
    if (!(t instanceof LuaTable)) throw badArg('next', 1, 'table', t)
    return t.next(k)
  })

  def('pack', (...args) => {
    const n = args.length // the table constructor trims trailing nils from `args`
    const t = new LuaTable(args)
    t.setStr('n', n)
    return t
  })

  def('unpack', (t, i, j) => {
    if (!(t instanceof LuaTable)) throw badArg('unpack', 1, 'table', t)
    const from = i === undefined ? 1 : int(i)
    const to = j === undefined ? t.length() : int(j)
    if (to - from >= 1e6) throw new LuaError('too many results to unpack')
    const out = []
    for (let k = from; k <= to; k++) out.push(ops.index(t, k))
    return out
  })

  def('select', (n, ...args) => {
    if (n === '#') return args.length
    const i = int(n)
    if (i === 0 || i < -args.length) throw new LuaError("bad argument #1 to 'select' (index out of range)")
    return args.slice(i < 0 ? args.length + i : i - 1)
  })

  // --- metatables and raw access -----------------------------------------------------------

  def('setmetatable', (t, m) => {
    if (!(t instanceof LuaTable)) throw badArg('setmetatable', 1, 'table', t)
    if (m !== undefined && !(m instanceof LuaTable)) throw new LuaError("bad argument #2 to 'setmetatable' (nil or table expected)")
    if (t.meta !== null && t.meta.getStr('__metatable') !== undefined) throw new LuaError('cannot change a protected metatable')
    t.meta = m ?? null
    return t
  })

  def('getmetatable', (t) => {
    if (!(t instanceof LuaTable) || t.meta === null) return undefined
    return t.meta.getStr('__metatable') ?? t.meta
  })

  def('rawget', (t, k) => {
    if (!(t instanceof LuaTable)) throw badArg('rawget', 1, 'table', t)
    return t.get(k)
  })
  def('rawset', (t, k, v) => {
    if (!(t instanceof LuaTable)) throw badArg('rawset', 1, 'table', t)
    t.set(k, v)
    return t
  })
  def('rawequal', (a, b) => a === b)
  def('rawlen', (v) => {
    if (v instanceof LuaTable) return v.length()
    if (typeof v === 'string') return v.length
    throw new LuaError("table or string expected")
  })

  def('type', (...args) => {
    if (args.length === 0) throw new LuaError("bad argument #1 to 'type' (value expected)")
    return typeName(args[0])
  })

  def('assert', (...args) => {
    const v = args[0]
    if (v === undefined || v === false) throw new LuaError(args.length > 1 ? args[1] : 'assertion failed!')
    return args
  })

  // --- conversion ---------------------------------------------------------------------------

  /** @param {number} bits @param {number} digits */
  const hex = (bits, digits) => (bits >>> 0).toString(16).padStart(digits, '0')

  def('tostr', (...args) => {
    if (args.length === 0) return ''
    const [v, flags] = args
    if (typeof v === 'number' && flags !== undefined) {
      const f = int(flags)
      const bits = toBits(v)
      if (f & 1) {
        return f & 2 ? '0x' + hex(bits, 8) : '0x' + hex(bits >>> 16, 4) + '.' + hex(bits & 0xffff, 4)
      }
      if (f & 2) return String(bits)
    }
    return tostr(v)
  })
  G.set('tostring', G.get('tostr'))

  def('tonum', (v, flags) => {
    const f = flags === undefined ? 0 : int(flags)
    /** @type {number | undefined} */
    let r
    if (typeof v === 'number') r = v
    else if (typeof v === 'boolean') r = v ? 1 : 0
    else if (typeof v === 'string') {
      if (f & 1) r = M.parse(/^\s*[+-]?0[xX]/.test(v) ? v : v.replace(/^(\s*[+-]?)/, '$10x'))
      else if (f & 4) r = M.parse(/^\s*[+-]?0[bB]/.test(v) ? v : v.replace(/^(\s*[+-]?)/, '$10b'))
      else r = M.parse(v)
    }
    return r === undefined && f & 2 ? 0 : r
  })

  // --- strings -----------------------------------------------------------------------------

  def('sub', (s, i, j) => {
    const text = str(s, 'sub', 1)
    const n = text.length
    let from = i === undefined ? 1 : int(i)
    let to = j === undefined ? -1 : int(j)
    if (from < 0) from = Math.max(n + from + 1, 1)
    else if (from === 0) from = 1
    if (to < 0) to = n + to + 1
    else if (to > n) to = n
    return from > to ? '' : text.slice(from - 1, to)
  })

  def('ord', (s, i, count) => {
    const text = str(s, 'ord', 1)
    const start = i === undefined ? 1 : int(i)
    const n = count === undefined ? 1 : int(count)
    if (start < 1 || start > text.length) return undefined
    const out = []
    for (let k = start - 1; k < start - 1 + n && k < text.length; k++) out.push(text.charCodeAt(k))
    return out.length === 1 ? out[0] : out
  })

  def('chr', (...codes) => codes.map((c) => String.fromCharCode(int(c) & 255)).join(''))

  def('split', (s, sep, convert) => {
    const text = str(s, 'split', 1)
    const doConvert = convert !== false
    /** @type {string[]} */
    let parts
    if (typeof sep === 'number') {
      const size = Math.max(1, int(sep))
      parts = []
      for (let k = 0; k < text.length; k += size) parts.push(text.slice(k, k + size))
    } else {
      const delim = sep === undefined ? ',' : str(sep, 'split', 2)
      parts = delim === '' ? text.split('') : text.split(delim)
      if (text === '') parts = []
    }
    return new LuaTable(
      parts.map((p) => {
        if (!doConvert) return p
        const v = M.parse(p)
        return v === undefined ? p : v
      }),
    )
  })

  // --- math --------------------------------------------------------------------------------

  def('flr', (x) => Math.floor(num(x)))
  def('ceil', (x) => Math.ceil(num(x)))
  def('abs', (x) => M.norm(Math.abs(num(x))))
  def('sgn', (x) => (num(x) < 0 ? -1 : 1))
  def('sqrt', (x) => {
    const v = num(x)
    return v < 0 ? 0 : M.norm(Math.sqrt(v))
  })
  def('max', (a, b) => Math.max(num(a), num(b)))
  def('min', (a, b) => Math.min(num(a), num(b)))
  def('mid', (a, b, c) => {
    const [x, y, z] = [num(a), num(b), num(c)]
    return Math.max(Math.min(x, y), Math.min(Math.max(x, y), z))
  })

  /** Fractional part of a turn count, so exact angles give exact results. @param {number} x */
  const turn = (x) => x - Math.floor(x)

  def('sin', (x) => {
    const t = turn(num(x))
    if (t === 0 || t === 0.5) return 0
    if (t === 0.25) return -1
    if (t === 0.75) return 1
    return M.norm(-Math.sin(t * TAU))
  })
  def('cos', (x) => {
    const t = turn(num(x))
    if (t === 0.25 || t === 0.75) return 0
    if (t === 0) return 1
    if (t === 0.5) return -1
    return M.norm(Math.cos(t * TAU))
  })
  def('atan2', (dx, dy) => {
    const x = num(dx)
    const y = num(dy)
    if (x === 0 && y === 0) return 0.25
    const a = Math.atan2(-y, x) / TAU
    return M.norm(a < 0 ? a + 1 : a === 0 ? 0 : a)
  })

  for (const name of /** @type {const} */ (['band', 'bor', 'bxor', 'shl', 'shr', 'lshr', 'rotl', 'rotr'])) {
    def(name, (a, b) => M[name](num(a), num(b)))
  }
  def('bnot', (a) => M.bnot(num(a)))

  // --- random numbers ----------------------------------------------------------------------

  let s0 = 0
  let s1 = 0
  /** @param {number} seed */
  const srand = (seed) => {
    const n = toBits(seed)
    s0 = n === 0 ? 0x60009755 : n
    s1 = s0 ^ 0xbead29ba
    for (let i = 0; i < 32; i++) next()
  }
  /** Next 32 random bits as an unsigned number. */
  const next = () => {
    s0 = (((s0 << 16) | (s0 >>> 16)) + s1) | 0
    s1 = (s1 + s0) | 0
    return s0 >>> 0
  }
  srand(host.seed ?? Math.random() * 65536)

  def('srand', (seed) => {
    srand(num(seed))
    return NONE
  })
  def('rnd', (x) => {
    const r = next() / 4294967296
    if (x instanceof LuaTable) {
      const n = x.length()
      return n === 0 ? undefined : x.a[Math.floor(r * n)]
    }
    return M.norm(r * (x === undefined ? 1 : num(x)))
  })

  // --- host ---------------------------------------------------------------------------------

  def('print', (...args) => {
    host.print?.(...args)
    return NONE
  })
  def('printh', (s) => {
    host.printh?.(tostr(s))
    return NONE
  })
  def('time', () => host.time?.() ?? 0)
  G.set('t', G.get('time'))

  // --- glyph constants (the button glyphs are variables in PICO-8) ---------------------------
  for (const [code, value] of [[0x8b, 0], [0x91, 1], [0x94, 2], [0x83, 3], [0x8e, 4], [0x97, 5]]) {
    G.set(String.fromCharCode(/** @type {number} */ (code)), value)
  }

  G.set('_G', G)
  G.set('_ENV', G)

  return G
}
