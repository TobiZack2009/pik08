import { installCoroutines } from './coroutine.js'
import { LuaError } from './errors.js'
import { createOps } from './ops.js'
import { createStdlib } from './stdlib.js'
import { LuaTable } from './table.js'
import { NONE, first, toList } from './values.js'

/**
 * @import { NumberModel } from './numbers.js'
 * @import { Host } from './stdlib.js'
 */

/** Marker keys in the flat item list of `mk`. */
const P = Symbol('positional')
const R = Symbol('rest')

/**
 * Everything compiled code needs at runtime: the operators, the globals table and a few helpers
 * that only the code generator uses.
 * @param {{ model: NumberModel, host?: Host & { peek?: (a: number) => number, peek2?: (a: number) => number, peek4?: (a: number) => number, flip?: () => void } }} options
 */
export function createRuntime({ model, host = {} }) {
  const ops = createOps(model)
  const G = createStdlib(ops, host)
  const { wrap } = installCoroutines(G, host)
  // Compiled code reads and writes globals straight through `G.s`; the stdlib guarantees it is a real dictionary.

  /**
   * General table constructor, used when evaluation order or computed keys matter. `items` is a flat
   * list of (key, value) pairs; positional items use the key `P`, and a trailing multi-value uses `R`
   * with the value list as the value.
   * @param {any[]} items
   */
  function mk(items) {
    /** @type {any[]} */
    const arr = []
    /** @type {any[]} */
    const keyed = []
    for (let i = 0; i < items.length; i += 2) {
      const k = items[i]
      if (k === P) arr.push(items[i + 1])
      else if (k === R) for (const v of items[i + 1]) arr.push(v)
      else keyed.push(k, items[i + 1])
    }
    const n = arr.length
    const t = new LuaTable(arr)
    for (let i = 0; i < keyed.length; i += 2) {
      const k = keyed[i]
      // Positional items win over explicit integer keys that they cover.
      if (typeof k === 'number' && k >= 1 && k <= n && Number.isInteger(k)) continue
      t.set(k, keyed[i + 1])
    }
    return t
  }

  /**
   * Validates a numeric `for` bound.
   * @param {any} v
   * @param {string} what
   */
  function fornum(v, what) {
    if (typeof v !== 'number') throw new LuaError(`'for' ${what} must be a number`)
    return v
  }

  /** @param {any} v */
  function forstep(v) {
    if (typeof v !== 'number') throw new LuaError("'for' step must be a number")
    if (v === 0) throw new LuaError("'for' step is zero")
    return v
  }

  return {
    ...ops,
    ops,
    G,
    T: LuaTable,
    NONE,
    first,
    list: toList,
    mk,
    P,
    R,
    /** Makes the function value of a generator body (see coroutine.js). */
    gen: wrap,
    fornum,
    forstep,
    /** Raw model addition, used for loop counters. */
    sa: model.add,
    peek: (/** @type {number} */ a) => host.peek?.(a) ?? 0,
    peek2: (/** @type {number} */ a) => host.peek2?.(a) ?? 0,
    peek4: (/** @type {number} */ a) => host.peek4?.(a) ?? 0,
  }
}

/** @typedef {ReturnType<typeof createRuntime>} Runtime */
