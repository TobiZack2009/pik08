import { compile } from '../../src/lua/compile.js'
import { LuaTable } from '../../src/lua/table.js'

/**
 * Converts a Lua value to plain JS for assertions: tables with only an array part become arrays
 * (holes are `undefined`), other tables become objects keyed by string.
 * @param {any} v
 * @returns {any}
 */
export function toJS(v) {
  if (!(v instanceof LuaTable)) return v
  const hasOther = Object.keys(v.s).some((k) => v.s[k] !== undefined) || (v.h !== null && v.h.size > 0)
  if (!hasOther) return v.a.map(toJS)
  /** @type {Record<string, any>} */
  const o = {}
  v.a.forEach((x, i) => {
    if (x !== undefined) o[i + 1] = toJS(x)
  })
  for (const k of Object.keys(v.s)) if (v.s[k] !== undefined) o[k] = toJS(v.s[k])
  if (v.h) for (const [k, x] of v.h) o[String(k)] = toJS(x)
  return o
}

/**
 * Test helpers bound to a number model.
 * @param {'fixed' | 'float'} model
 */
export function lua(model) {
  /** @type {string[]} */
  const printed = []
  /** @param {string} src */
  const program = (src) =>
    compile(src, {
      model,
      host: { print: (...a) => printed.push(a.map((x) => program.tostr(x)).join(' ')), printh: (s) => printed.push(s) },
    })
  program.tostr = /** @type {(x: any) => string} */ (x) => String(x)

  /** Runs a chunk and returns every returned value as a JS array. @param {string} src @returns {any[]} */
  const vals = (src) => {
    const p = program(src)
    program.tostr = p.rt.tostr
    const r = p.run()
    return (Array.isArray(r) ? r : [r]).map(toJS)
  }
  /** Runs a chunk and returns its first returned value. @param {string} src */
  const val = (src) => vals(src)[0]
  /** Runs a chunk and returns the lines it printed. @param {string} src */
  const out = (src) => {
    printed.length = 0
    const p = program(src)
    program.tostr = p.rt.tostr
    p.run()
    return [...printed]
  }
  /** Runs a chunk, expecting a runtime error; returns it. @param {string} src @returns {any} */
  const fail = (src) => {
    try {
      program(src).run()
    } catch (e) {
      return e
    }
    throw new Error('expected the chunk to fail')
  }
  return { program, vals, val, out, fail }
}
