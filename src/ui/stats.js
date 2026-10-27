import { compressCode } from '../formats/code-compress.js'
import { ExportLimitError } from '../formats/errors.js'
import { countTokens } from '../lua/tokens.js'

/** @import { Cart } from '../core/cart.js' */
/** @import { Profile } from '../core/profile.js' */

/**
 * @typedef {Object} CartStats
 * @property {number} tokens
 * @property {number} chars
 */

/**
 * The cheap numbers shown live in the status bar.
 * @param {Pick<Cart, 'code'>} cart
 * @returns {CartStats}
 */
export function quickStats(cart) {
  return { tokens: countTokens(cart.code), chars: cart.code.length }
}

/**
 * Size of the code once compressed for a `.p8.png`. Takes a while for big programs, so callers
 * should debounce it. Code too big for the format reports the limit as the size.
 * @param {string} code
 * @returns {number}
 */
export function compressedSize(code) {
  try {
    return compressCode(code).bytes.length
  } catch (e) {
    if (e instanceof ExportLimitError) return e.actual
    throw e
  }
}

/**
 * Every limit of the profile with the cart's use of it, e.g. for meters.
 * @param {CartStats & { compressed?: number }} stats
 * @param {Profile['limits']} limits
 * @returns {{ key: 'tokens' | 'codeChars' | 'compressedBytes', label: string, value: number, max: number }[]}
 */
export function limitUsage(stats, limits) {
  /** @type {{ key: 'tokens' | 'codeChars' | 'compressedBytes', label: string, value: number, max: number }[]} */
  const out = []
  if (limits.tokens !== undefined) out.push({ key: 'tokens', label: 'tokens', value: stats.tokens, max: limits.tokens })
  if (limits.codeChars !== undefined) out.push({ key: 'codeChars', label: 'chars', value: stats.chars, max: limits.codeChars })
  if (limits.compressedBytes !== undefined && stats.compressed !== undefined) {
    out.push({ key: 'compressedBytes', label: 'compressed', value: stats.compressed, max: limits.compressedBytes })
  }
  return out
}
