import { generate } from './codegen.js'
import { FLIP } from './coroutine.js'
import { LuaError } from './errors.js'
import { FIXED, FLOAT } from './numbers.js'
import { parse } from './parser.js'
import { createRuntime } from './runtime.js'

/**
 * @import { NumberModel } from './numbers.js'
 * @import { Runtime } from './runtime.js'
 * @import { LuaTable } from './table.js'
 */

/**
 * @typedef {Object} CompileOptions
 * @property {'fixed' | 'float' | NumberModel} [model]   Number semantics (default `'fixed'`, as PICO-8)
 * @property {import("./stdlib.js").Host & Record<string, any>} [host]
 * @property {string} [name]   Chunk name shown in stack traces (default `cart.lua`)
 */

/**
 * @typedef {Object} Program
 * @property {string} js          The generated JavaScript (line N corresponds to Lua line N)
 * @property {Runtime} rt
 * @property {LuaTable} G         The globals table
 * @property {(...args: any[]) => any} run   Runs the main chunk; errors carry `line`
 * @property {<A extends any[], R>(fn: (...args: A) => R, ...args: A) => R} call   Calls a Lua function, mapping errors like `run`
 * @property {(...args: any[]) => any} main   The main chunk, unmapped; give it to `drive` to run it a frame at a time
 * @property {(fn: (...args: any[]) => any, ...args: any[]) => Generator<void, any, void>} drive
 *   Runs a Lua function as a generator that pauses at each `flip` the function reaches (outside any
 *   coroutine), so the host can show the frame and go on when it is time for the next. Its result is
 *   the function's; errors carry `line` like `call`'s.
 */

/**
 * Compiles Lua source (a p8str) to a runnable program. Throws `LuaSyntaxError` for bad source.
 * @param {string} src
 * @param {CompileOptions} [options]
 * @returns {Program}
 */
export function compile(src, options = {}) {
  const model = typeof options.model === 'object' ? options.model : options.model === 'float' ? FLOAT : FIXED
  const name = options.name ?? 'cart.lua'
  const js = generate(parse(src), model)
  const rt = createRuntime({ model, host: options.host })
  const factory = (0, eval)(`(function($rt){${js}\n})\n//# sourceURL=${name}`)
  /** @type {(...args: any[]) => any} */
  const main = factory(rt)

  /**
   * @template {any[]} A
   * @template R
   * @param {(...args: A) => R} fn
   * @param {A} args
   * @returns {R}
   */
  function call(fn, ...args) {
    try {
      return fn(...args)
    } catch (e) {
      throw mapError(e, name)
    }
  }

  /**
   * @param {(...args: any[]) => any} fn
   * @param {any[]} args
   * @returns {Generator<void, any, void>}
   */
  function* drive(fn, ...args) {
    try {
      const body = /** @type {import('./coroutine.js').LuaFunction} */ (fn).$g
      if (body === undefined) return fn(...args)
      const it = body(...args)
      let step = it.next()
      while (!step.done) {
        if (/** @type {any} */ (step.value) !== FLIP) {
          it.return(undefined)
          throw new LuaError('attempt to yield from outside a coroutine')
        }
        yield
        step = it.next([])
      }
      return step.value
    } catch (e) {
      throw mapError(e, name)
    }
  }

  return { js, rt, G: rt.G, run: (...args) => call(main, ...args), call, main, drive }
}

/**
 * Turns whatever a compiled program threw into a `LuaError` with the Lua line number attached.
 * JS stack overflows become "stack overflow"; other JS errors (which would be bugs in the runtime)
 * are returned unchanged apart from the line.
 * @param {unknown} e
 * @param {string} [name]   Chunk name used when compiling
 * @returns {any}
 */
export function mapError(e, name = 'cart.lua') {
  if (!(e instanceof Error)) return e
  let err = /** @type {any} */ (e)
  if (e instanceof RangeError && /call stack/i.test(e.message)) {
    err = new LuaError('stack overflow')
    err.stack = e.stack
  }
  if (err.line === undefined) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`${escaped}:(\\d+):\\d+`).exec(err.stack ?? '')
    if (m) err.line = Number(m[1])
  }
  return err
}
