import { LuaError } from './errors.js'

/**
 * Lua values at runtime: nil is `undefined`, booleans/numbers/strings are native JS values (strings
 * are p8str: one char per byte), tables are `LuaTable`, functions are JS functions.
 * @typedef {undefined | boolean | number | string | LuaTable | ((...args: any[]) => any)} LuaValue
 */

/** Dictionary type for string keys: no prototype, so `__proto__`/`constructor` are ordinary keys. */
function Dict() {}
Dict.prototype = Object.create(null)

/** Shared by all tables without string keys so reads need no null check. Never written to. */
const EMPTY_DICT = Object.freeze(new /** @type {any} */ (Dict)())

/** Compact the string part once this many keys may have been set to nil. */
const DEAD_LIMIT = 64

/**
 * A Lua table, split in three parts so the common shapes are fast:
 *  - `a`: the array part, keys 1..a.length. May hold nil holes in the middle (as in `{1, nil, 3}` or
 *    after `t[2] = nil`) but never ends with nil, so `#t` is just `a.length`.
 *  - `s`: string keys. Setting a key to nil leaves an `undefined` tombstone so objects keep their
 *    shape; tombstones are skipped by iteration and swept occasionally.
 *  - `h`: every other key (non-array numbers, booleans, tables, functions), created lazily.
 * Invariant: integer keys stored in `h` are all greater than `a.length + 1`, so growing the array part
 * only has to look for the single next key when it appends.
 */
export class LuaTable {
  /**
   * @param {any[]} [array]   Takes ownership. Trailing nils are trimmed.
   * @param {Record<string, any>} [strings]   Takes ownership; must have a null prototype
   */
  constructor(array, strings) {
    /** @type {any[]} */
    this.a = array ?? []
    /** @type {Record<string, any>} */
    this.s = strings ?? EMPTY_DICT
    /** @type {Map<any, any> | null} */
    this.h = null
    /** @type {LuaTable | null} */
    this.meta = null
    this.dead = 0
    if (array) this.trim()
  }

  /** Number of keys 1..n (the length operator without metamethods). */
  length() {
    return this.a.length
  }

  /** @private */
  trim() {
    const a = this.a
    let n = a.length
    while (n > 0 && a[n - 1] === undefined) n--
    a.length = n
  }

  /**
   * Moves keys that the array part has now reached out of the hash part.
   * @private
   */
  migrate() {
    const h = this.h
    if (h === null || h.size === 0) return
    const a = this.a
    for (;;) {
      const k = a.length + 1
      const v = h.get(k)
      if (v === undefined) return
      h.delete(k)
      a.push(v)
    }
  }

  /** @private */
  sweep() {
    const s = this.s
    for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k]
    this.dead = 0
  }

  /** Raw get. @param {any} k */
  get(k) {
    if (typeof k === 'string') return this.s[k]
    if (typeof k === 'number') {
      const i = k - 1
      const a = this.a
      if (i >= 0 && i < a.length && i === (i | 0)) return a[i]
    }
    return this.h === null ? undefined : this.h.get(k)
  }

  /** Raw get with a string key. @param {string} k */
  getStr(k) {
    return this.s[k]
  }

  /**
   * Raw set. Throws on nil and NaN keys, as Lua does.
   * @param {any} k
   * @param {any} v
   */
  set(k, v) {
    if (typeof k === 'string') {
      this.setStr(k, v)
      return
    }
    if (typeof k === 'number') {
      const a = this.a
      const n = a.length
      const i = k - 1
      if (i >= 0 && i <= n && i === (i | 0)) {
        if (i < n) {
          a[i] = v
          if (v === undefined && i === n - 1) this.trim()
        } else if (v !== undefined) {
          a.push(v)
          this.migrate()
        }
        return
      }
      if (k !== k) throw new LuaError('table index is NaN')
    } else if (k === undefined) {
      throw new LuaError('table index is nil')
    }
    if (v === undefined) {
      if (this.h !== null) this.h.delete(k)
    } else {
      ;(this.h ??= new Map()).set(k, v)
    }
  }

  /** Raw set with a string key. @param {string} k @param {any} v */
  setStr(k, v) {
    let s = this.s
    if (v === undefined) {
      if (s[k] !== undefined) {
        s[k] = undefined
        if (++this.dead > DEAD_LIMIT) this.sweep()
      }
      return
    }
    if (s === EMPTY_DICT) s = this.s = new /** @type {any} */ (Dict)()
    s[k] = v
  }

  /** `table.insert`-like: appends. @param {any} v */
  push(v) {
    if (v === undefined) return
    this.a.push(v)
    this.migrate()
  }

  /**
   * Inserts at array position `i` (1..n+1), shifting later elements up.
   * @param {number} i
   * @param {any} v
   */
  insertAt(i, v) {
    this.a.splice(i - 1, 0, v)
    this.trim()
    this.migrate()
  }

  /**
   * Removes the element at array position `i` (1..n), shifting later elements down.
   * @param {number} i
   */
  removeAt(i) {
    const v = this.a.splice(i - 1, 1)[0]
    this.trim()
    return v
  }

  /**
   * Stateful iterator over all entries for `pairs`: array part in order, then string keys, then the
   * rest. Assigning to existing fields (including nil) while iterating is fine.
   * @returns {() => [any, any] | undefined}
   */
  iterator() {
    let phase = 0
    let i = 0
    /** @type {string[]} */
    let keys = []
    /** @type {Iterator<[any, any]> | null} */
    let it = null
    return () => {
      if (phase === 0) {
        const a = this.a
        while (i < a.length) {
          const v = a[i++]
          if (v !== undefined) return [i, v]
        }
        phase = 1
        i = 0
        keys = Object.keys(this.s)
      }
      if (phase === 1) {
        const s = this.s
        while (i < keys.length) {
          const k = /** @type {string} */ (keys[i++])
          const v = s[k]
          if (v !== undefined) return [k, v]
        }
        phase = 2
        it = this.h === null ? null : this.h.entries()
      }
      if (phase === 2 && it !== null) {
        for (;;) {
          const r = it.next()
          if (r.done) break
          if (r.value[1] !== undefined) return r.value
        }
      }
      phase = 3
      return undefined
    }
  }

  /**
   * `next(t, key)`: the entry after `key` in iteration order, undefined at the end. O(n) unless `key`
   * is nil or an array index.
   * @param {any} key
   * @returns {[any, any] | undefined}
   */
  next(key) {
    const a = this.a
    let ai = 0
    let si = 0
    /** @type {any} */
    let skipMapTo
    let haveSkip = false
    if (key !== undefined) {
      if (typeof key === 'string') {
        ai = a.length
        const i = Object.keys(this.s).indexOf(key)
        if (i < 0) throw new LuaError("invalid key to 'next'")
        si = i + 1
      } else if (typeof key === 'number' && Number.isInteger(key) && key >= 1 && !(this.h !== null && this.h.has(key))) {
        ai = key // an array index, or one that was just trimmed away
      } else {
        if (this.h === null || !this.h.has(key)) throw new LuaError("invalid key to 'next'")
        ai = a.length
        si = Infinity
        skipMapTo = key
        haveSkip = true
      }
    }
    for (; ai < a.length; ai++) if (a[ai] !== undefined) return [ai + 1, a[ai]]
    const s = this.s
    const keys = Object.keys(s)
    for (; si < keys.length; si++) {
      const k = /** @type {string} */ (keys[si])
      if (s[k] !== undefined) return [k, s[k]]
    }
    if (this.h !== null) {
      for (const [k, v] of this.h) {
        if (haveSkip) {
          if (k === skipMapTo) haveSkip = false
          continue
        }
        if (v !== undefined) return [k, v]
      }
    }
    return undefined
  }
}
