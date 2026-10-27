import { LuaSyntaxError } from './errors.js'

/**
 * Tokenizer for PICO-8's Lua dialect.
 *
 * The source is a p8str (one JS char per byte, see formats/p8scii.js), and so are string
 * literal values. Differences from standard Lua that matter here:
 *  - `//` starts a line comment (there is no floor-division operator spelled that way), and only
 *    `--[[ ]]` is a long comment: `--[=[` is a plain line comment (long strings still nest by level);
 *  - numbers have no exponent: `1e3` is the number 1 followed by the name `e3`. They may be
 *    decimal, `0x` hex or `0b` binary, each with an optional fractional part;
 *  - the characters 0x80..0xff (glyphs such as the button symbols) and 0x1e/0x1f are name chars;
 *  - extra operators: `!=` `\` `^^` `>>>` `<<>` `>><` `@` `%` `$` `?` and compound assignment
 *    (`+=`, `..=`, `\=`, `>>>=`, ...);
 *  - string escapes `\*` `\#` `\-` `\|` `\+` `\^` produce control chars 1..6.
 *
 * @typedef {'name' | 'keyword' | 'number' | 'string' | 'punct' | 'eof'} TokenType
 *
 * @typedef {Object} Token
 * @property {TokenType} type
 * @property {string | number} value   Keyword/punct/name text; number value; decoded string
 * @property {number} line   1-based line of the first character
 * @property {number} vline  Like `line`, but newlines inside long strings and long comments do not
 *                           count. PICO-8 uses it to decide where a shorthand `if` ends.
 * @property {number} col    1-based column of the first character
 * @property {number} pos    Offset of the first character in the source
 * @property {number} end    Offset just past the last character
 */

export const KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in',
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
])

const PUNCT = new Set([
  '+', '-', '*', '/', '\\', '%', '&', '|', '^', '<', '>', '=', '~', '#', '(', ')', '[', ']', '{', '}',
  ';', ',', '?', '@', '$', '.', ':',
  '..', '::', '==', '~=', '!=', '<=', '>=', '<<', '>>', '^^',
  '+=', '-=', '*=', '/=', '\\=', '%=', '&=', '|=', '^=',
  '...', '..=', '>>>', '<<>', '>><', '^^=', '>>=', '<<=',
  '>>>=', '<<>=', '>><=',
])

const ESCAPES = /** @type {Record<string, string>} */ ({
  '*': '\x01', '#': '\x02', '-': '\x03', '|': '\x04', '+': '\x05', '^': '\x06',
  a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r',
  '\\': '\\', '"': '"', "'": "'", '\n': '\n',
})

/** @param {number} c */
const isDigit = (c) => c >= 48 && c <= 57
/** @param {number} c */
const isNameStart = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c >= 0x80 || c === 0x1e || c === 0x1f
/** @param {number} c */
const isNameChar = (c) => isNameStart(c) || isDigit(c)
/** @param {number} c */
const isSpace = (c) => c === 32 || (c >= 9 && c <= 13)
/** @param {number} c */
const hexValue = (c) => (isDigit(c) ? c - 48 : c >= 97 && c <= 102 ? c - 87 : c >= 65 && c <= 70 ? c - 55 : -1)

/**
 * Tokenizes `src`. The last token is always of type 'eof'.
 * @param {string} src
 * @returns {Token[]}
 * @throws {LuaSyntaxError}
 */
export function tokenize(src) {
  /** @type {Token[]} */
  const tokens = []
  const n = src.length
  let i = 0
  let line = 1
  let vline = 1
  let lineStart = 0

  /** @param {string} message @param {number} [at] */
  const fail = (message, at = i) => {
    // Recompute the line/col of `at` only when failing: errors are rare and this keeps the hot path simple.
    let l = 1
    let ls = 0
    for (let k = 0; k < at && k < n; k++) {
      if (src.charCodeAt(k) === 10) {
        l++
        ls = k + 1
      }
    }
    const err = new LuaSyntaxError(message, l, at - ls + 1)
    // Lets tolerant callers (editor highlighting, token counting) keep what was read before the error.
    err.pos = at
    err.tokens = tokens
    throw err
  }

  /**
   * Long-bracket opener at `i` (`[[`, `[=[`, ...): returns the level or -1.
   * @param {number} at
   */
  const longLevel = (at) => {
    if (src.charCodeAt(at) !== 91) return -1
    let k = at + 1
    while (src.charCodeAt(k) === 61) k++
    return src.charCodeAt(k) === 91 ? k - at - 1 : -1
  }

  /**
   * Reads a long bracket whose opener starts at `start`. Returns its content and advances `i` past it.
   * Newlines inside it advance `line` but not `vline`.
   * @param {number} start
   * @param {number} level
   * @param {string} what
   */
  const readLong = (start, level, what) => {
    const bodyStart = start + level + 2
    const close = ']' + '='.repeat(level) + ']'
    const end = src.indexOf(close, bodyStart)
    if (end < 0) fail(`unfinished long ${what}`, start)
    let body = src.slice(bodyStart, end)
    for (let k = start; k < end; k++) {
      if (src.charCodeAt(k) === 10) {
        line++
        lineStart = k + 1
      }
    }
    i = end + close.length
    body = body.replace(/\r\n?|\n\r?/g, '\n')
    if (body.charCodeAt(0) === 10) body = body.slice(1)
    return body
  }

  while (i < n) {
    const c = src.charCodeAt(i)

    if (isSpace(c)) {
      if (c === 10) {
        line++
        vline++
        lineStart = i + 1
      }
      i++
      continue
    }

    const start = i
    const startLine = line
    const startVline = vline
    const startCol = i - lineStart + 1
    /** @param {TokenType} type @param {string | number} value */
    const push = (type, value) => {
      tokens.push({ type, value, line: startLine, vline: startVline, col: startCol, pos: start, end: i })
    }

    // comments: `--`, `--[[ ]]` and `//`
    if ((c === 45 && src.charCodeAt(i + 1) === 45) || (c === 47 && src.charCodeAt(i + 1) === 47)) {
      // only the plain `--[[ ]]` form is a long comment; `--[=[` is an ordinary line comment
      if (c === 45 && longLevel(i + 2) === 0) {
        readLong(i + 2, 0, 'comment')
        continue
      }
      while (i < n && src.charCodeAt(i) !== 10) i++
      continue
    }

    // numbers
    if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
      push('number', readNumber())
      continue
    }

    if (isNameStart(c)) {
      i++
      while (i < n && isNameChar(src.charCodeAt(i))) i++
      const word = src.slice(start, i)
      push(KEYWORDS.has(word) ? 'keyword' : 'name', word)
      continue
    }

    if (c === 34 || c === 39) {
      push('string', readString(c))
      continue
    }

    if (c === 91) {
      const level = longLevel(i)
      if (level >= 0) {
        const body = readLong(i, level, 'string')
        push('string', body)
        continue
      }
    }

    // punctuation, longest match first
    let matched = ''
    for (let len = 4; len >= 1; len--) {
      const s = src.substr(i, len)
      if (s.length === len && PUNCT.has(s)) {
        matched = s
        break
      }
    }
    if (matched) {
      i += matched.length
      push('punct', matched)
      continue
    }
    fail(`unexpected symbol near '${src[i]}'`)
  }

  tokens.push({ type: 'eof', value: '<eof>', line, vline, col: i - lineStart + 1, pos: n, end: n })
  return tokens

  /** Reads a number at `i`; the value is the exact (unrounded) numeric value. */
  function readNumber() {
    const start = i
    let base = 10
    if (src.charCodeAt(i) === 48) {
      const x = src.charCodeAt(i + 1) | 32
      if (x === 120) base = 16
      else if (x === 98) base = 2
      if (base !== 10) i += 2
    }
    const digitsStart = i
    let dot = -1
    for (;;) {
      const ch = src.charCodeAt(i)
      if (ch === 46) {
        if (dot >= 0) fail(`malformed number near '${src.slice(start, i + 1)}'`, start)
        dot = i
      } else if (base === 10 ? !isDigit(ch) : base === 2 ? ch !== 48 && ch !== 49 : hexValue(ch) < 0) {
        break
      }
      i++
    }
    if (i === digitsStart || (dot === digitsStart && i === digitsStart + 1)) {
      fail(`malformed number near '${src.slice(start, i)}'`, start)
    }
    if (base === 10) return parseFloat(src.slice(start, i))
    let value = 0
    let scale = 1
    for (let k = digitsStart; k < i; k++) {
      if (k === dot) continue
      const d = hexValue(src.charCodeAt(k))
      if (dot >= 0 && k > dot) {
        scale /= base
        value += d * scale
      } else {
        value = value * base + d
      }
    }
    return value
  }

  /** @param {number} quote */
  function readString(quote) {
    const start = i
    i++
    let out = ''
    let chunk = i
    for (;;) {
      if (i >= n) fail('unfinished string', start)
      const ch = src.charCodeAt(i)
      if (ch === quote) break
      if (ch === 10) fail('unfinished string', start)
      if (ch !== 92) {
        i++
        continue
      }
      out += src.slice(chunk, i)
      const e = src[i + 1]
      const ec = src.charCodeAt(i + 1)
      if (e === undefined) fail('unfinished string', start)
      if (e === 'z') {
        i += 2
        while (i < n && isSpace(src.charCodeAt(i))) {
          if (src.charCodeAt(i) === 10) {
            line++
            vline++
            lineStart = i + 1
          }
          i++
        }
      } else if (e === 'x') {
        const h1 = hexValue(src.charCodeAt(i + 2))
        const h2 = hexValue(src.charCodeAt(i + 3))
        if (h1 < 0 || h2 < 0) fail(`invalid escape sequence '${src.slice(i, i + 4)}'`, i)
        out += String.fromCharCode(h1 * 16 + h2)
        i += 4
      } else if (isDigit(ec)) {
        let k = i + 1
        let v = 0
        while (k < i + 4 && isDigit(src.charCodeAt(k))) v = v * 10 + src.charCodeAt(k++) - 48
        if (v > 255) fail(`decimal escape too large near '${src.slice(i, k)}'`, i)
        out += String.fromCharCode(v)
        i = k
      } else if (Object.hasOwn(ESCAPES, e)) {
        if (e === '\n') {
          line++
          vline++
          lineStart = i + 2
        }
        out += ESCAPES[e]
        i += 2
      } else {
        fail(`invalid escape sequence '\\${e}'`, i)
      }
      chunk = i
    }
    out += src.slice(chunk, i)
    i++
    return out
  }
}
