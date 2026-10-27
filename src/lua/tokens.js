import { LuaSyntaxError } from './errors.js'
import { tokenize } from './lexer.js'

/** @import { Token } from './lexer.js' */

/**
 * @typedef {Object} LexError
 * @property {number} pos       Offset where the problem starts
 * @property {number} end       Offset where lexing resumed (the end of the line, or of the source)
 * @property {string} message
 */

/**
 * Like `tokenize`, but never throws: after a lexical error the rest of that line is skipped (an
 * unfinished long string or comment swallows the rest of the source) and lexing resumes. Used where
 * half-typed code is normal: editor highlighting and the token counter.
 * The result has no 'eof' token.
 * @param {string} src
 * @returns {{ tokens: Token[], errors: LexError[] }}
 */
export function tokenizeTolerant(src) {
  /** @type {Token[]} */
  const tokens = []
  /** @type {LexError[]} */
  const errors = []
  let offset = 0
  let lineBase = 0

  /** @param {Token[]} read */
  const add = (read) => {
    for (const t of read) {
      if (t.type === 'eof') continue
      tokens.push(
        offset === 0 ? t : { ...t, pos: t.pos + offset, end: t.end + offset, line: t.line + lineBase, vline: t.vline + lineBase },
      )
    }
  }

  for (;;) {
    try {
      add(tokenize(offset === 0 ? src : src.slice(offset)))
      break
    } catch (e) {
      if (!(e instanceof LuaSyntaxError) || e.pos === undefined) throw e
      add(e.tokens ?? [])
      const pos = offset + e.pos
      let resume
      if (/^unfinished long/.test(e.message)) {
        resume = src.length
      } else {
        const nl = src.indexOf('\n', pos)
        resume = nl < 0 ? src.length : nl
      }
      if (resume <= offset) resume = offset + 1 // always make progress
      errors.push({ pos, end: resume, message: e.message })
      for (let i = offset; i < resume; i++) if (src.charCodeAt(i) === 10) lineBase++
      offset = resume
      if (offset >= src.length) break
    }
  }
  return { tokens, errors }
}

/** Punctuation that PICO-8 does not count as a token. */
const FREE_PUNCT = new Set([',', '.', ':', ';', '::', ')', ']', '}'])
/** Keywords that PICO-8 does not count as a token. */
const FREE_KEYWORDS = new Set(['end', 'local'])
/** After these a `-` is a binary operator, not the sign of a number. */
const OPERAND_KEYWORDS = new Set(['true', 'false', 'nil', 'end'])

/**
 * PICO-8's token count of an already tokenized program. Every token counts except `, . : ; :: ) ] }`,
 * `end` and `local`, and a unary minus or tilde written directly in front of a number (`-1` is one token).
 * @param {readonly Token[]} tokens
 * @returns {number}
 */
export function countTokenList(tokens) {
  let count = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'eof') continue
    if (t.type === 'punct') {
      if (FREE_PUNCT.has(/** @type {string} */ (t.value))) continue
      if ((t.value === '-' || t.value === '~') && tokens[i + 1]?.type === 'number' && !endsOperand(tokens[i - 1])) continue
    } else if (t.type === 'keyword' && FREE_KEYWORDS.has(/** @type {string} */ (t.value))) {
      continue
    }
    count++
  }
  return count
}

/**
 * Whether `prev` ends an operand, which makes a following `-` binary.
 * @param {Token | undefined} prev
 */
function endsOperand(prev) {
  if (!prev) return false
  switch (prev.type) {
    case 'name':
    case 'number':
    case 'string':
      return true
    case 'keyword':
      return OPERAND_KEYWORDS.has(/** @type {string} */ (prev.value))
    case 'punct':
      return prev.value === ')' || prev.value === ']' || prev.value === '}' || prev.value === '...'
    default:
      return false
  }
}

/**
 * Token count of Lua source. Source with lexical errors is counted as far as it can be read.
 * @param {string} src  a p8str
 * @returns {number}
 */
export function countTokens(src) {
  return countTokenList(tokenizeTolerant(src).tokens)
}
