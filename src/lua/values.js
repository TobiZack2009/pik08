import { LuaTable } from './table.js'

/**
 * Multiple values: a function may return a plain JS array, which is a list of Lua values (Lua values
 * are never JS arrays). Anything else is a single value. Falling off the end of a function returns
 * the empty list `NONE`.
 */
export const NONE = Object.freeze(/** @type {any[]} */ ([]))

/**
 * First value of a call result (what a single-value context sees).
 * @param {any} v
 */
export const first = (v) => (Array.isArray(v) ? v[0] : v)

/** Lua truthiness: everything except nil and false. @param {any} v */
export const truthy = (v) => v !== undefined && v !== false

/**
 * Normalizes a call result to a list of values.
 * @param {any} v
 * @returns {any[]}
 */
export const toList = (v) => (Array.isArray(v) ? v : [v])

/**
 * Lua's `type()` name of a value.
 * @param {any} v
 */
export function typeName(v) {
  switch (typeof v) {
    case 'undefined':
      return 'nil'
    case 'boolean':
    case 'number':
    case 'string':
    case 'function':
      return typeof v
    default:
      return v instanceof LuaTable ? 'table' : 'thread'
  }
}
