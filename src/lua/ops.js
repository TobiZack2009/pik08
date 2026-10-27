import { LuaError } from './errors.js'
import { LuaTable } from './table.js'
import { first, typeName } from './values.js'

/** @import { NumberModel } from './numbers.js' */

const MAX_META_CHAIN = 100

/**
 * Builds the operator implementations that compiled code calls, specialised to a number model.
 * Every operator has a fast path for plain numbers (or tables) and falls back to coercion,
 * metamethods and Lua-style errors.
 * @param {NumberModel} M
 */
export function createOps(M) {
  /**
   * Metamethod `ev` of a value, if it is a table with a metatable that defines it.
   * @param {any} v
   * @param {string} ev
   */
  const metaOf = (v, ev) => (v instanceof LuaTable && v.meta !== null ? v.meta.getStr(ev) : undefined)

  /** Number value of a number or numeric string (arithmetic coerces strings). @param {any} v */
  const toNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? M.parse(v) : undefined)

  /**
   * @param {string} what
   * @param {any} v
   * @param {string} [desc]
   */
  const err = (what, v, desc) => new LuaError(`attempt to ${what} a ${typeName(v)} value${desc ? ` (${desc})` : ''}`)

  // --- calls ---------------------------------------------------------------------------------

  /**
   * Resolves the callee of a call. Returns `f` itself when it is a function, a forwarding function
   * for callable tables (`__call`), and throws "attempt to call a nil value (global 'x')" otherwise.
   * @param {any} f
   * @param {string} [desc]  What the callee is, e.g. "global 'foo'", for the error message
   * @returns {(...args: any[]) => any}
   */
  function call(f, desc) {
    if (typeof f === 'function') return f
    const h = metaOf(f, '__call')
    if (h !== undefined) {
      /** @type {any} */
      const g = call(h)
      /** @type {any} */
      const forward = (/** @type {any[]} */ ...args) => g(f, ...args)
      // a handler that may yield keeps its generator version (see coroutine.js)
      if (g.$g) forward.$g = (/** @type {any[]} */ ...args) => g.$g(f, ...args)
      return forward
    }
    throw err('call', f, desc)
  }

  /**
   * Calls a metamethod handler and returns its first result.
   * @param {any} h
   * @param {any[]} args
   */
  const callMeta = (h, ...args) => first(call(h)(...args))

  // --- indexing ------------------------------------------------------------------------------

  /**
   * @param {LuaTable} t  A table whose own lookup of `k` came up nil and that has a metatable
   * @param {any} k
   * @returns {any}
   */
  function indexMeta(t, k) {
    for (let n = 0; n < MAX_META_CHAIN; n++) {
      const h = /** @type {LuaTable} */ (t.meta).getStr('__index')
      if (h === undefined) return undefined
      if (typeof h === 'function') return first(h(t, k))
      if (!(h instanceof LuaTable)) return index(h, k)
      const v = h.get(k)
      if (v !== undefined || h.meta === null) return v
      t = h
    }
    throw new LuaError("loop in gettable")
  }

  /**
   * `o[k]`
   * @param {any} o
   * @param {any} k
   * @param {string} [desc]  What `o` is, for the error message
   * @returns {any}
   */
  function index(o, k, desc) {
    if (o instanceof LuaTable) {
      const v = o.get(k)
      return v !== undefined || o.meta === null ? v : indexMeta(o, k)
    }
    if (typeof o === 'string') {
      // Strings index to single characters; anything else is nil.
      return typeof k === 'number' && Number.isInteger(k) && k >= 1 && k <= o.length ? o[k - 1] : undefined
    }
    throw err('index', o, desc)
  }

  /**
   * `o.name` with a constant string key.
   * @param {any} o
   * @param {string} k
   * @param {string} [desc]
   * @returns {any}
   */
  function indexStr(o, k, desc) {
    if (o instanceof LuaTable) {
      const v = o.s[k]
      return v !== undefined || o.meta === null ? v : indexMeta(o, k)
    }
    return index(o, k, desc)
  }

  /**
   * `o[k] = v`
   * @param {any} o
   * @param {any} k
   * @param {any} v
   * @param {string} [desc]
   */
  function setindex(o, k, v, desc) {
    for (let n = 0; n < MAX_META_CHAIN; n++) {
      if (!(o instanceof LuaTable)) throw err('index', o, desc)
      if (o.meta === null || o.get(k) !== undefined) {
        o.set(k, v)
        return
      }
      const h = o.meta.getStr('__newindex')
      if (h === undefined) {
        o.set(k, v)
        return
      }
      if (typeof h === 'function') {
        h(o, k, v)
        return
      }
      o = h
      desc = undefined
    }
    throw new LuaError("loop in settable")
  }

  /**
   * `o.name = v` with a constant string key.
   * @param {any} o
   * @param {string} k
   * @param {any} v
   * @param {string} [desc]
   */
  function setindexStr(o, k, v, desc) {
    if (o instanceof LuaTable && o.meta === null) o.setStr(k, v)
    else setindex(o, k, v, desc)
  }

  // --- arithmetic ----------------------------------------------------------------------------

  /**
   * Slow path of a binary arithmetic/bitwise operator: string coercion, then metamethods, then error.
   * @param {any} a
   * @param {any} b
   * @param {string} ev
   * @param {(a: number, b: number) => number} f
   * @param {string} what
   * @param {string} [da]  What `a` is, for the error message
   * @param {string} [db]  What `b` is
   */
  function arithSlow(a, b, ev, f, what, da, db) {
    const x = toNum(a)
    const y = toNum(b)
    if (x !== undefined && y !== undefined) return f(x, y)
    const h = metaOf(a, ev) ?? metaOf(b, ev)
    if (h !== undefined) return callMeta(h, a, b)
    throw x === undefined ? err(what, a, da) : err(what, b, db)
  }

  /**
   * @param {string} ev
   * @param {(a: number, b: number) => number} f
   * @param {string} [what]
   * @returns {(a: any, b: any, da?: string, db?: string) => any}
   */
  const binary = (ev, f, what = 'perform arithmetic on') => (a, b, da, db) =>
    typeof a === 'number' && typeof b === 'number' ? f(a, b) : arithSlow(a, b, ev, f, what, da, db)

  const BITWISE = 'perform bitwise operation on'
  const add = binary('__add', M.add)
  const sub = binary('__sub', M.sub)
  const mul = binary('__mul', M.mul)
  const div = binary('__div', M.div)
  const idiv = binary('__idiv', M.idiv)
  const mod = binary('__mod', M.mod)
  const pow = binary('__pow', M.pow)
  const band = binary('__band', M.band, BITWISE)
  const bor = binary('__bor', M.bor, BITWISE)
  const bxor = binary('__bxor', M.bxor, BITWISE)
  const shl = binary('__shl', M.shl, BITWISE)
  const shr = binary('__shr', M.shr, BITWISE)
  const lshr = binary('__lshr', M.lshr, BITWISE)
  const rotl = binary('__rotl', M.rotl, BITWISE)
  const rotr = binary('__rotr', M.rotr, BITWISE)

  /** @param {any} a @param {string} [d] */
  function unm(a, d) {
    if (typeof a === 'number') return M.neg(a)
    const x = toNum(a)
    if (x !== undefined) return M.neg(x)
    const h = metaOf(a, '__unm')
    if (h !== undefined) return callMeta(h, a, a)
    throw err('perform arithmetic on', a, d)
  }

  /** @param {any} a @param {string} [d] */
  function bnot(a, d) {
    const x = toNum(a)
    if (x !== undefined) return M.bnot(x)
    throw err(BITWISE, a, d)
  }

  // --- comparison ----------------------------------------------------------------------------

  /**
   * @param {any} a
   * @param {any} b
   */
  function compareError(a, b) {
    const ta = typeName(a)
    const tb = typeName(b)
    return new LuaError(ta === tb ? `attempt to compare two ${ta} values` : `attempt to compare ${ta} with ${tb}`)
  }

  /**
   * @param {any} a
   * @param {any} b
   * @param {string} ev
   * @returns {boolean}
   */
  function compareSlow(a, b, ev) {
    const h = metaOf(a, ev) ?? metaOf(b, ev)
    if (h !== undefined) {
      const r = callMeta(h, a, b)
      return r !== undefined && r !== false
    }
    throw compareError(a, b)
  }

  /** `a < b` @param {any} a @param {any} b @returns {boolean} */
  function lt(a, b) {
    const ta = typeof a
    if (ta === typeof b && (ta === 'number' || ta === 'string')) return a < b
    return compareSlow(a, b, '__lt')
  }

  /** `a > b`, evaluated as `b < a` like Lua does. @param {any} a @param {any} b @returns {boolean} */
  const gt = (a, b) => lt(b, a)

  /** `a >= b`, evaluated as `b <= a`. @param {any} a @param {any} b @returns {boolean} */
  const ge = (a, b) => le(b, a)

  /** `a <= b` @param {any} a @param {any} b @returns {boolean} */
  function le(a, b) {
    const ta = typeof a
    if (ta === typeof b && (ta === 'number' || ta === 'string')) return a <= b
    return compareSlow(a, b, '__le')
  }

  /** `a == b`, honoring `__eq` when both are distinct tables. @param {any} a @param {any} b @returns {boolean} */
  function eq(a, b) {
    if (a === b) return true
    if (a instanceof LuaTable && b instanceof LuaTable) {
      const h = metaOf(a, '__eq') ?? metaOf(b, '__eq')
      if (h !== undefined) {
        const r = callMeta(h, a, b)
        return r !== undefined && r !== false
      }
    }
    return false
  }

  // --- strings -------------------------------------------------------------------------------

  /**
   * Text of any value, as `tostr` and `print` show it.
   * @param {any} v
   * @returns {string}
   */
  function tostr(v) {
    switch (typeof v) {
      case 'string':
        return v
      case 'number':
        return M.tostring(v)
      case 'boolean':
        return v ? 'true' : 'false'
      case 'undefined':
        return '[nil]'
      case 'function':
        return '[function]'
    }
    const h = metaOf(v, '__tostring')
    if (h !== undefined) {
      const r = callMeta(h, v)
      return typeof r === 'string' ? r : tostr(r)
    }
    return v instanceof LuaTable ? '[table]' : '[thread]'
  }

  /** `a .. b` @param {any} a @param {any} b @param {string} [da] @param {string} [db] @returns {any} */
  function concat(a, b, da, db) {
    const ta = typeof a
    const tb = typeof b
    if ((ta === 'string' || ta === 'number') && (tb === 'string' || tb === 'number')) {
      return (ta === 'string' ? a : M.tostring(a)) + (tb === 'string' ? b : M.tostring(b))
    }
    const h = metaOf(a, '__concat') ?? metaOf(b, '__concat')
    if (h !== undefined) return callMeta(h, a, b)
    throw ta === 'string' || ta === 'number' ? err('concatenate', b, db) : err('concatenate', a, da)
  }

  /** `#v` @param {any} v @param {string} [d] @returns {any} */
  function len(v, d) {
    if (typeof v === 'string') return v.length
    if (v instanceof LuaTable) {
      if (v.meta !== null) {
        const h = v.meta.getStr('__len')
        if (h !== undefined) return callMeta(h, v)
      }
      return v.a.length
    }
    throw err('get length of', v, d)
  }

  return {
    model: M,
    call, callMeta, index, indexStr, setindex, setindexStr,
    add, sub, mul, div, idiv, mod, pow, unm,
    band, bor, bxor, bnot, shl, shr, lshr, rotl, rotr,
    lt, le, gt, ge, eq, concat, len, tostr, toNum,
  }
}

/** @typedef {ReturnType<typeof createOps>} Ops */
