/**
 * Number models. Lua numbers are always plain JS doubles at runtime; a model decides how arithmetic
 * behaves on them:
 *  - FLOAT: ordinary IEEE doubles (what stock Lua 5.2 does).
 *  - FIXED: PICO-8's 16:16 fixed point. Every value is an int32 divided by 65536, so it stays exactly
 *    representable as a double; the operations below wrap/truncate the way the real console does.
 *
 * Bitwise operators work on the 32-bit pattern of the 16:16 representation in BOTH models.
 *
 * @typedef {Object} NumberModel
 * @property {'float' | 'fixed'} name
 * @property {(a: number, b: number) => number} add
 * @property {(a: number, b: number) => number} sub
 * @property {(a: number, b: number) => number} mul
 * @property {(a: number, b: number) => number} div
 * @property {(a: number, b: number) => number} idiv   Floor division (`\`)
 * @property {(a: number, b: number) => number} mod    Floored modulo
 * @property {(a: number, b: number) => number} pow
 * @property {(a: number) => number} neg
 * @property {(a: number, b: number) => number} band
 * @property {(a: number, b: number) => number} bor
 * @property {(a: number, b: number) => number} bxor
 * @property {(a: number) => number} bnot
 * @property {(a: number, b: number) => number} shl
 * @property {(a: number, b: number) => number} shr    Arithmetic shift right
 * @property {(a: number, b: number) => number} lshr   Logical shift right
 * @property {(a: number, b: number) => number} rotl
 * @property {(a: number, b: number) => number} rotr
 * @property {(x: number) => number} fromLiteral       Converts an exact source literal to a model value
 * @property {(x: number) => number} norm              Converts a computed double (sin, sqrt, rnd...) to a model value
 * @property {(n: number) => string} tostring          Decimal rendering (what `print` shows)
 * @property {(s: string) => number | undefined} parse Parses numeric text, undefined if it is not a number
 * @property {number} max                              Largest representable value
 * @property {number} min                              Smallest representable value
 */

const ONE = 65536

/** The 16:16 bit pattern of a number (truncating anything finer than 1/65536). @param {number} x */
export const toBits = (x) => (x * ONE) | 0
/** @param {number} bits */
export const fromBits = (bits) => (bits | 0) / ONE

/** @param {number} x */
const wrap = (x) => ((x * ONE) | 0) / ONE

// --- bit operations on int32 patterns --------------------------------------------------------

/** @param {number} n shift count; fractions are floored */
const count = (n) => (Number.isNaN(n) ? 0 : Math.floor(n))

/** @param {number} x @param {number} n @returns {number} */
function shlBits(x, n) {
  n = count(n)
  if (n < 0) return lshrBits(x, -n)
  return n >= 32 ? 0 : x << n
}
/** @param {number} x @param {number} n @returns {number} */
function shrBits(x, n) {
  n = count(n)
  if (n < 0) return shlBits(x, -n)
  return n >= 32 ? (x < 0 ? -1 : 0) : x >> n
}
/** @param {number} x @param {number} n @returns {number} */
function lshrBits(x, n) {
  n = count(n)
  if (n < 0) return shlBits(x, -n)
  return n >= 32 ? 0 : (x >>> n) | 0
}
/** @param {number} x @param {number} n */
function rotlBits(x, n) {
  n = ((count(n) % 32) + 32) % 32
  return n === 0 ? x : (x << n) | (x >>> (32 - n))
}

/** @param {(a: number, b: number) => number} f */
const bin = (f) => (/** @type {number} */ a, /** @type {number} */ b) => f(toBits(a), toBits(b)) / ONE

/** Shifts and rotates take their count as a plain number, not a 16.16 pattern. @param {(a: number, n: number) => number} f */
const shift = (f) => (/** @type {number} */ a, /** @type {number} */ n) => f(toBits(a), n) / ONE

const bitOps = {
  band: bin((a, b) => a & b),
  bor: bin((a, b) => a | b),
  bxor: bin((a, b) => a ^ b),
  bnot: (/** @type {number} */ a) => ~toBits(a) / ONE,
  shl: shift(shlBits),
  shr: shift(shrBits),
  lshr: shift(lshrBits),
  rotl: shift(rotlBits),
  rotr: shift((a, n) => rotlBits(a, -count(n))),
}

// --- text -------------------------------------------------------------------------------------

/**
 * Parses what `tonum` / string-to-number coercion accepts: optional whitespace and sign around a
 * decimal number, `0x` hex or `0b` binary, with optional fraction. Returns the exact double.
 * @param {string} str
 * @returns {number | undefined}
 */
export function parseNumber(str) {
  const m = /^[ \t\n\v\f\r]*([+-]?)(?:0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?|0[bB]([01]*)(?:\.([01]*))?|(\d+\.?\d*|\.\d+))[ \t\n\v\f\r]*$/.exec(str)
  if (!m) return undefined
  const sign = m[1] === '-' ? -1 : 1
  let v
  if (m[2] !== undefined) {
    if (!m[2] && !m[3]) return undefined
    v = (m[2] ? parseInt(m[2], 16) : 0) + (m[3] ? parseInt(m[3], 16) / 16 ** m[3].length : 0)
  } else if (m[4] !== undefined) {
    if (!m[4] && !m[5]) return undefined
    v = (m[4] ? parseInt(m[4], 2) : 0) + (m[5] ? parseInt(m[5], 2) / 2 ** m[5].length : 0)
  } else {
    v = parseFloat(/** @type {string} */ (m[6]))
  }
  return sign * v
}

/** Strips trailing zeros (and a dangling dot) from a decimal string. @param {string} s */
const stripZeros = (s) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s)

/** @param {number} n */
function fixedToString(n) {
  const s = stripZeros(n.toFixed(4))
  return s === '-0' ? '0' : s
}

/** C's `%.14g`, which is how Lua 5.2 prints numbers. @param {number} n */
function floatToString(n) {
  if (Number.isNaN(n)) return n < 0 ? '-nan' : 'nan'
  if (n === Infinity) return 'inf'
  if (n === -Infinity) return '-inf'
  if (n === 0) return Object.is(n, -0) ? '-0' : '0'
  const [mant, exp] = n.toExponential(13).split('e')
  const e = Number(exp)
  if (e < -4 || e >= 14) {
    const digits = Math.abs(e) < 10 ? '0' + Math.abs(e) : String(Math.abs(e))
    return stripZeros(/** @type {string} */ (mant)) + 'e' + (e < 0 ? '-' : '+') + digits
  }
  return stripZeros(n.toFixed(Math.max(0, 13 - e)))
}

// --- fixed point -----------------------------------------------------------------------------

const FIXED_MAX = 0x7fffffff / ONE
const FIXED_MIN = -0x80000000 / ONE

/** PICO-8 defines division by zero as the extreme value with the sign of the dividend. @param {number} a */
const divZero = (a) => (a > 0 ? FIXED_MAX : a < 0 ? -FIXED_MAX : 0)

/** @type {NumberModel} */
export const FIXED = {
  name: 'fixed',
  add: (a, b) => wrap(a + b),
  sub: (a, b) => wrap(a - b),
  mul(a, b) {
    const ai = a * ONE
    const bi = b * ONE
    // (ai * bi) >> 16 without leaving the 53-bit exact range: split ai into high and low halves
    const ah = ai >> 16
    const al = ai & 0xffff
    return ((ah * bi + Math.floor((al * bi) / ONE)) | 0) / ONE
  },
  div(a, b) {
    if (b === 0) return divZero(a)
    return ((Math.trunc((a * ONE * ONE) / (b * ONE))) | 0) / ONE
  },
  idiv(a, b) {
    if (b === 0) return divZero(a)
    return wrap(Math.floor(a / b))
  },
  mod(a, b) {
    if (b === 0) return a
    const ai = a * ONE
    const bi = b * ONE
    let r = ai % bi
    if (r !== 0 && r < 0 !== bi < 0) r += bi
    return r === 0 ? 0 : r / ONE // no negative zero in fixed point
  },
  pow: (a, b) => wrap(Math.pow(a, b)),
  neg: (a) => wrap(-a),
  ...bitOps,
  fromLiteral: (x) => (Math.round(x * ONE) | 0) / ONE,
  norm: (x) => wrap(x),
  tostring: fixedToString,
  parse(s) {
    const v = parseNumber(s)
    return v === undefined ? undefined : (Math.round(v * ONE) | 0) / ONE
  },
  max: FIXED_MAX,
  min: FIXED_MIN,
}

// --- float -----------------------------------------------------------------------------------

/** @type {NumberModel} */
export const FLOAT = {
  name: 'float',
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  idiv: (a, b) => Math.floor(a / b),
  mod: (a, b) => a - Math.floor(a / b) * b,
  pow: (a, b) => Math.pow(a, b),
  neg: (a) => -a,
  ...bitOps,
  fromLiteral: (x) => x,
  norm: (x) => x,
  tostring: floatToString,
  parse: parseNumber,
  max: Number.MAX_VALUE,
  min: -Number.MAX_VALUE,
}

/** @param {'float' | 'fixed'} name */
export const modelByName = (name) => (name === 'float' ? FLOAT : FIXED)
