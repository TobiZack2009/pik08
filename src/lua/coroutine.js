import { LuaError } from './errors.js'
import { NONE, toList, typeName } from './values.js'

/** @import { LuaTable } from './table.js' */

/**
 * A Lua function that may yield has a generator version in its `$g` property (see codegen.js and
 * yields.js): calling `f.$g(...args)` returns a JS generator that runs the function and, at each Lua
 * `yield`, suspends with the list of yielded values and later receives the list of resume values.
 * A plain call of such a function drives the generator itself and so cannot suspend.
 *
 * @typedef {(...args: any[]) => Generator<any[], any, any[]>} GeneratorFn
 * @typedef {((...args: any[]) => any) & { $g?: GeneratorFn }} LuaFunction
 */

/**
 * What `flip` suspends with when it runs in the main flow of a cart (outside any coroutine): the
 * host is to show the frame and resume. Other yields carry the list of values.
 */
export const FLIP = Symbol('flip')

/** A Lua thread: `cocreate(f)`. */
export class Coroutine {
  /** @param {LuaFunction} fn */
  constructor(fn) {
    this.fn = fn
    /** @type {'suspended' | 'running' | 'normal' | 'dead'} */
    this.status = 'suspended'
    /** The running body once it has started. @type {Generator<any[], any, any[]> | null} */
    this.gen = null
  }
}

/**
 * Installs `cocreate`, `coresume`, `costatus`, `yield` and `flip` in the globals table.
 *
 * `flip` shows the frame (`host.flip`). Where it can suspend the cart (the main flow, not inside a
 * coroutine) it does, so that the host can pace the cart at its frame rate: whoever drives the
 * generator sees `FLIP` and decides when to go on. Called plainly, or from a coroutine, it shows the
 * frame at once and carries on.
 *
 * @param {LuaTable} G
 * @param {{ flip?: () => void }} [host]
 */
export function installCoroutines(G, host = {}) {
  /** The coroutine that is running now, if any. @type {Coroutine | null} */
  let current = null

  /** @param {string} name @param {(...args: any[]) => any} fn */
  const def = (name, fn) => G.set(name, fn)

  /** @param {string} fname @param {any} got */
  const badThread = (fname, got) => new LuaError(`bad argument #1 to '${fname}' (coroutine expected, got ${typeName(got)})`)

  const yieldError = () =>
    new LuaError(current === null ? 'attempt to yield from outside a coroutine' : 'attempt to yield across a C-call boundary')

  /**
   * The Lua-level error value of something thrown inside a coroutine. Errors that are not the cart's
   * (bugs in the runtime itself) are not swallowed.
   * @param {unknown} e
   */
  function errorValue(e) {
    if (e instanceof LuaError) return e.value
    if (e instanceof RangeError && /call stack/i.test(e.message)) return 'stack overflow'
    throw e
  }

  /**
   * Runs `co` until it yields, returns or fails.
   * @param {Coroutine} co
   * @param {any[]} args
   * @returns {any[]}  `true` and the values, or `false` and the error
   */
  function resume(co, args) {
    const previous = current
    if (previous) previous.status = 'normal'
    co.status = 'running'
    current = co
    try {
      /** @type {IteratorResult<any[], any>} */
      let step
      if (co.gen === null) {
        const body = co.fn.$g
        if (body === undefined) {
          // a function that cannot yield just runs to the end
          const result = co.fn(...args)
          co.status = 'dead'
          return [true, ...toList(result)]
        }
        co.gen = body(...args)
        step = co.gen.next()
      } else {
        step = co.gen.next(args)
      }
      if (step.done) {
        co.status = 'dead'
        return [true, ...toList(step.value)]
      }
      co.status = 'suspended'
      return [true, ...step.value]
    } catch (e) {
      co.status = 'dead'
      return [false, errorValue(e)]
    } finally {
      current = previous
      if (previous) previous.status = 'running'
    }
  }

  def('cocreate', (f) => {
    if (typeof f !== 'function') throw new LuaError(`bad argument #1 to 'cocreate' (function expected, got ${typeName(f)})`)
    return new Coroutine(f)
  })

  def('coresume', (co, ...args) => {
    if (!(co instanceof Coroutine)) throw badThread('coresume', co)
    if (co.status === 'dead') return [false, 'cannot resume dead coroutine']
    if (co.status !== 'suspended') return [false, 'cannot resume non-suspended coroutine']
    return resume(co, args)
  })

  def('costatus', (co) => {
    if (!(co instanceof Coroutine)) throw badThread('costatus', co)
    return co.status
  })

  /** Called plainly, `yield` has nothing to suspend. */
  const plainYield = () => {
    throw yieldError()
  }
  /** @type {LuaFunction} */
  const yieldFn = plainYield
  yieldFn.$g = function* (...args) {
    if (current === null) throw yieldError()
    return yield args
  }
  def('yield', yieldFn)

  /** @type {LuaFunction} */
  const flipFn = () => {
    host.flip?.()
    return NONE
  }
  flipFn.$g = function* () {
    if (current !== null) return flipFn()
    yield /** @type {any} */ (FLIP)
    return NONE
  }
  def('flip', flipFn)

  /**
   * Makes the Lua function of a generator body: called plainly it runs the body to the end, showing
   * the frame at each `flip`, and a yield that gets that far has no coroutine to go back to (a native
   * function such as a metamethod or `sort` stands in between), so it is an error.
   * @param {GeneratorFn} body
   * @returns {LuaFunction}
   */
  function wrap(body) {
    /** @type {LuaFunction} */
    const f = (...args) => {
      const it = body(...args)
      let step = it.next()
      while (!step.done) {
        if (/** @type {any} */ (step.value) !== FLIP) {
          it.return(undefined)
          throw yieldError()
        }
        host.flip?.()
        step = it.next([])
      }
      return step.value
    }
    f.$g = body
    return f
  }

  return { wrap }
}
