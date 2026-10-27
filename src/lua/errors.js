/**
 * A syntax error in Lua source. `line` and `col` are 1-based and point at the offending token
 * (or the start of the offending construct).
 */
export class LuaSyntaxError extends Error {
  /**
   * @param {string} message
   * @param {number} line
   * @param {number} col
   */
  constructor(message, line, col) {
    super(message)
    this.name = 'LuaSyntaxError'
    this.line = line
    this.col = col
    /** Source offset of the error; only set by the lexer. @type {number | undefined} */
    this.pos = undefined
    /** Tokens read before a lexer error (no 'eof'); only set by the lexer. @type {import('./lexer.js').Token[] | undefined} */
    this.tokens = undefined
  }
}

/**
 * A runtime error raised by a running cart, like Lua's `error()` or `nil + 1`. The Lua-level
 * error value (any Lua value, as in `error({})`) is `value`.
 */
export class LuaError extends Error {
  /**
   * @param {unknown} value
   * @param {string} [traceback]
   */
  constructor(value, traceback) {
    super(typeof value === 'string' ? value : `(error object is a ${typeof value} value)`)
    this.name = 'LuaError'
    this.value = value
    this.luaTraceback = traceback
    /** Lua line where the error happened, filled in when it passes out of a compiled program. @type {number | undefined} */
    this.line = undefined
  }
}
