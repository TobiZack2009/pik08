import { tokenizeTolerant } from '../../../lua/tokens.js'

/**
 * Indentation rules for the code editor. They work on single lines, relative to the line above,
 * which is what people expect while typing (PICO-8 code is often one-line shorthand, so a full
 * block analysis would fight the user).
 */

export const INDENT = '  '

const OPENERS = new Set(['then', 'do', 'function', 'repeat'])
const CLOSERS = new Set(['end', 'until', 'elseif'])
const OPEN_BRACKETS = new Set(['(', '[', '{'])
const CLOSE_BRACKETS = new Set([')', ']', '}'])

/** Lines that move back one level as soon as they are typed. */
export const DEDENT_WORDS = new Set(['end', 'else', 'until', '}', ')', ']'])

/**
 * How many levels the lines below a line should be indented relative to it: 1 if the line leaves a
 * block or bracket open, otherwise 0. A closing word or bracket at the very start of the line is
 * not counted: such a line has already been moved back to the level of its block. `else` closes
 * the branch before it and opens its own, so it only counts at the start of a line.
 * @param {string} line  a line of code (a p8str)
 * @returns {0 | 1}
 */
export function opensBlock(line) {
  const { tokens } = tokenizeTolerant(line)
  let depth = 0
  tokens.forEach((t, k) => {
    const v = /** @type {string} */ (t.value)
    if (t.type === 'keyword') {
      if (OPENERS.has(v)) depth++
      else if (CLOSERS.has(v) && k > 0) depth--
      else if (v === 'else' && k === 0) depth++
    } else if (t.type === 'punct') {
      if (OPEN_BRACKETS.has(v)) depth++
      else if (CLOSE_BRACKETS.has(v) && k > 0) depth--
    }
  })
  return depth > 0 ? 1 : 0
}

/**
 * Leading whitespace of a line.
 * @param {string} line
 */
export function leadingWhitespace(line) {
  return /^[ \t]*/.exec(line)?.[0] ?? ''
}

/**
 * Indentation for the line after `line` (the text of the current line up to the cursor).
 * @param {string} line
 * @returns {string}
 */
export function indentAfter(line) {
  return leadingWhitespace(line) + (opensBlock(line) ? INDENT : '')
}

/**
 * If `beforeCursor` (the current line up to the cursor) is just a word that ends a block, how much
 * indentation to remove from the line; otherwise 0. Only whole levels are removed.
 * @param {string} beforeCursor
 * @returns {number}
 */
export function dedentAmount(beforeCursor) {
  const word = beforeCursor.trim()
  if (!DEDENT_WORDS.has(word)) return 0
  const indent = leadingWhitespace(beforeCursor)
  if (indent.endsWith('\t')) return 1
  return Math.min(indent.length, INDENT.length)
}

/**
 * Toggles `--` comments over the given lines: if every non-blank line is commented they are
 * uncommented, otherwise all get commented.
 * @param {string[]} lines
 * @returns {string[]}
 */
export function toggleComment(lines) {
  const real = lines.filter((l) => l.trim() !== '')
  const commented = real.length > 0 && real.every((l) => /^\s*--/.test(l))
  if (commented) return lines.map((l) => l.replace(/^(\s*)-- ?/, '$1'))
  const indent = Math.min(...real.map((l) => leadingWhitespace(l).length), Infinity)
  return lines.map((l) => (l.trim() === '' ? l : l.slice(0, indent) + '-- ' + l.slice(indent)))
}
