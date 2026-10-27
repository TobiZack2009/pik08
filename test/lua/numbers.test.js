import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { FIXED, FLOAT, fromBits, parseNumber, toBits } from '../../src/lua/numbers.js'

const MAX = 32767 + 65535 / 65536
const MIN = -32768
const STEP = 1 / 65536

/** Arbitrary 16:16 value. */
const fixedNum = fc.integer({ min: -0x80000000, max: 0x7fffffff }).map((i) => i / 65536)

describe('bit patterns', () => {
  it('round-trips 16:16 values', () => {
    fc.assert(fc.property(fixedNum, (x) => fromBits(toBits(x)) === x))
  })
  it('truncates finer fractions toward zero', () => {
    expect(toBits(1.00001)).toBe(65536)
    expect(toBits(-1.00001)).toBe(-65536)
  })
  it('wraps integers outside the int16 range', () => {
    expect(toBits(32768)).toBe(-0x80000000)
  })
})

describe('FIXED arithmetic', () => {
  const { add, sub, mul, div, idiv, mod, pow, neg } = FIXED

  it('adds and subtracts exactly', () => {
    expect(add(1, 2)).toBe(3)
    expect(add(0.5, 0.25)).toBe(0.75)
    expect(sub(1, 2)).toBe(-1)
    expect(add(STEP, STEP)).toBe(2 * STEP)
  })
  it('wraps on overflow', () => {
    expect(add(MAX, STEP)).toBe(MIN)
    expect(add(32767, 1)).toBe(-32768)
    expect(sub(MIN, STEP)).toBe(MAX)
    expect(add(MIN, MIN)).toBe(0)
  })
  it('multiplies with truncation toward -infinity of the 16.16 product', () => {
    expect(mul(3, 4)).toBe(12)
    expect(mul(0.5, 0.5)).toBe(0.25)
    expect(mul(-2, 3)).toBe(-6)
    expect(mul(-0.5, 0.5)).toBe(-0.25)
    expect(mul(STEP, STEP)).toBe(0) // 2^-32 underflows
    expect(mul(-STEP, STEP)).toBe(-STEP) // arithmetic shift floors
  })
  it('wraps multiplication overflow', () => {
    expect(mul(256, 256)).toBe(0) // 65536 wraps to 0
    expect(mul(200, 200)).toBe(40000 - 65536)
    expect(mul(MIN, -1)).toBe(MIN)
    expect(mul(MIN, MIN)).toBe(0)
  })
  it('multiplication matches BigInt reference', () => {
    fc.assert(
      fc.property(fixedNum, fixedNum, (a, b) => {
        const ref = BigInt.asIntN(32, (BigInt(a * 65536) * BigInt(b * 65536)) >> 16n)
        expect(mul(a, b) * 65536).toBe(Number(ref))
      }),
      { numRuns: 2000 },
    )
  })
  it('divides truncating the 16.16 quotient', () => {
    expect(div(1, 2)).toBe(0.5)
    expect(div(1, 3)).toBe(21845 / 65536)
    expect(div(-1, 3)).toBe(-21845 / 65536)
    expect(div(10, 4)).toBe(2.5)
    expect(div(-7, 2)).toBe(-3.5)
  })
  it('division matches BigInt reference', () => {
    fc.assert(
      fc.property(fixedNum, fixedNum, (a, b) => {
        fc.pre(b !== 0)
        const ref = BigInt.asIntN(32, (BigInt(a * 65536) << 16n) / BigInt(b * 65536))
        expect(div(a, b) * 65536).toBe(Number(ref))
      }),
      { numRuns: 2000 },
    )
  })
  it('division by zero saturates by sign of the dividend', () => {
    expect(div(1, 0)).toBe(MAX)
    expect(div(-1, 0)).toBe(-MAX)
    expect(div(0, 0)).toBe(0)
    expect(div(5, -0)).toBe(MAX)
  })
  it('integer division floors', () => {
    expect(idiv(7, 2)).toBe(3)
    expect(idiv(-7, 2)).toBe(-4)
    expect(idiv(7, -2)).toBe(-4)
    expect(idiv(0.5, 1)).toBe(0)
    expect(idiv(-0.5, 1)).toBe(-1)
    expect(idiv(1, 0)).toBe(MAX)
  })
  it('modulo takes the sign of the divisor', () => {
    expect(mod(7, 3)).toBe(1)
    expect(mod(-7, 3)).toBe(2)
    expect(mod(7, -3)).toBe(-2)
    expect(mod(-7, -3)).toBe(-1)
    expect(mod(5.5, 2)).toBe(1.5)
    expect(mod(-0.25, 1)).toBe(0.75)
    expect(mod(6, 3)).toBe(0)
    expect(Object.is(mod(-6, 3), 0)).toBe(true)
  })
  it('modulo by zero returns the dividend', () => {
    expect(mod(5, 0)).toBe(5)
  })
  it('modulo result always lies in [0, b) for positive b', () => {
    fc.assert(
      fc.property(fixedNum, fixedNum, (a, b) => {
        fc.pre(b > 0)
        const r = mod(a, b)
        expect(r).toBeGreaterThanOrEqual(0)
        expect(r).toBeLessThan(b)
      }),
    )
  })
  it('power', () => {
    expect(pow(2, 3)).toBe(8)
    expect(pow(2, -1)).toBe(0.5)
    expect(pow(4, 0.5)).toBe(2)
    expect(pow(0, 0)).toBe(1)
    expect(pow(2, 15)).toBe(-32768) // 32768 wraps
    expect(pow(-1, 0.5)).toBe(0) // NaN becomes 0
  })
  it('negates, wrapping the minimum', () => {
    expect(neg(5)).toBe(-5)
    expect(neg(MIN)).toBe(MIN)
    expect(Object.is(neg(0), 0)).toBe(true) // no negative zero in fixed point
  })
  it('never leaves the representable grid', () => {
    fc.assert(
      fc.property(fixedNum, fixedNum, (a, b) => {
        for (const f of [add, sub, mul, div, idiv, mod, pow]) {
          const r = f(a, b)
          expect(r).toBeGreaterThanOrEqual(MIN)
          expect(r).toBeLessThanOrEqual(MAX)
          expect(Number.isInteger(r * 65536)).toBe(true)
        }
      }),
      { numRuns: 1000 },
    )
  })
})

describe('FIXED literals and norm', () => {
  it('rounds literals to the nearest 1/65536', () => {
    expect(FIXED.fromLiteral(0.1)).toBe(6554 / 65536)
    expect(FIXED.fromLiteral(1 / 3)).toBe(21845 / 65536)
    expect(FIXED.fromLiteral(2 / 3)).toBe(43691 / 65536)
  })
  it('wraps literals that do not fit', () => {
    expect(FIXED.fromLiteral(32768)).toBe(-32768)
    expect(FIXED.fromLiteral(40000)).toBe(40000 - 65536)
    expect(FIXED.fromLiteral(0xffff + 65535 / 65536)).toBe(-STEP)
    expect(FIXED.fromLiteral(65536)).toBe(0)
  })
  it('norm truncates computed doubles', () => {
    expect(FIXED.norm(0.99999999)).toBe(65535 / 65536)
    expect(FIXED.norm(-1e-12)).toBe(0)
    expect(Object.is(FIXED.norm(-1e-12), 0)).toBe(true)
    expect(FIXED.norm(NaN)).toBe(0)
    expect(FIXED.norm(Infinity)).toBe(0)
  })
})

describe('FLOAT arithmetic', () => {
  const { add, mul, div, idiv, mod, pow, neg } = FLOAT
  it('behaves like IEEE doubles', () => {
    expect(add(0.1, 0.2)).toBe(0.1 + 0.2)
    expect(add(32767, 1)).toBe(32768)
    expect(mul(256, 256)).toBe(65536)
    expect(div(1, 3)).toBe(1 / 3)
    expect(div(1, 0)).toBe(Infinity)
    expect(div(-1, 0)).toBe(-Infinity)
    expect(div(0, 0)).toBeNaN()
    expect(pow(2, 0.5)).toBe(Math.SQRT2)
    expect(Object.is(neg(0), -0)).toBe(true)
  })
  it('floors integer division and modulo', () => {
    expect(idiv(-7, 2)).toBe(-4)
    expect(idiv(7, 0)).toBe(Infinity)
    expect(mod(-7, 3)).toBe(2)
    expect(mod(7, -3)).toBe(-2)
    expect(mod(5.5, 2)).toBe(1.5)
    expect(mod(5, 0)).toBeNaN()
  })
  it('literals are untouched', () => {
    expect(FLOAT.fromLiteral(0.1)).toBe(0.1)
    expect(FLOAT.fromLiteral(1e10)).toBe(1e10)
  })
})

describe.each([['fixed', FIXED], ['float', FLOAT]])('bitwise operators (%s)', (_, m) => {
  it('and / or / xor on the 16.16 pattern', () => {
    expect(m.band(5, 3)).toBe(1)
    expect(m.bor(5, 3)).toBe(7)
    expect(m.bxor(5, 3)).toBe(6)
    expect(m.band(0.5, 0.75)).toBe(0.5)
    expect(m.bor(0.25, 0.5)).toBe(0.75)
    expect(m.band(-1, 0xff)).toBe(0xff)
  })
  it('not', () => {
    expect(m.bnot(0)).toBe(-STEP)
    expect(m.bnot(-STEP)).toBe(0)
    expect(m.bnot(1)).toBe(-1 - STEP)
  })
  it('shl', () => {
    expect(m.shl(1, 4)).toBe(16)
    expect(m.shl(1, 0)).toBe(1)
    expect(m.shl(1, 15)).toBe(-32768)
    expect(m.shl(1, 16)).toBe(0)
    expect(m.shl(1, 32)).toBe(0)
    expect(m.shl(1, 100)).toBe(0)
    expect(m.shl(STEP, 16)).toBe(1)
  })
  it('shl by a negative count shifts right logically', () => {
    expect(m.shl(16, -4)).toBe(1)
    expect(m.shl(-1, -16)).toBe(65535 / 65536) // 0xffff0000 >>> 16 = 0xffff
  })
  it('shr is arithmetic', () => {
    expect(m.shr(16, 4)).toBe(1)
    expect(m.shr(-16, 4)).toBe(-1)
    expect(m.shr(-1, 1)).toBe(-0.5)
    expect(m.shr(-STEP, 1)).toBe(-STEP)
    expect(m.shr(1, 40)).toBe(0)
    expect(m.shr(-1, 40)).toBe(-STEP)
    expect(m.shr(1, -4)).toBe(16)
  })
  it('lshr is logical', () => {
    expect(m.lshr(-1, 16)).toBe(65535 / 65536)
    expect(m.lshr(-16, 28)).toBe(15 / 65536)
    expect(m.lshr(-1, 32)).toBe(0)
    expect(m.lshr(1, -4)).toBe(16)
  })
  it('rotates', () => {
    expect(m.rotl(1, 16)).toBe(STEP)
    expect(m.rotl(STEP, 32)).toBe(STEP)
    expect(m.rotl(STEP, 0)).toBe(STEP)
    expect(m.rotl(STEP, 1)).toBe(2 * STEP)
    expect(m.rotl(MIN, 1)).toBe(STEP)
    expect(m.rotr(STEP, 1)).toBe(MIN)
    expect(m.rotr(MIN, 1)).toBe(16384)
    expect(m.rotl(STEP, -1)).toBe(MIN)
    expect(m.rotl(STEP, 33)).toBe(2 * STEP)
  })
  it('rotl and rotr are inverses', () => {
    fc.assert(
      fc.property(fixedNum, fc.integer({ min: -70, max: 70 }), (a, n) => m.rotr(m.rotl(a, n), n) === a),
    )
  })
  it('fractional shift counts are floored', () => {
    expect(m.shl(1, 1.9)).toBe(2)
    expect(m.shl(4, -0.5)).toBe(m.shl(4, -1)) // floor(-0.5) = -1
  })
  it('NaN shift counts act as zero', () => {
    expect(m.shl(3, NaN)).toBe(3)
  })
})

describe('number to string', () => {
  it('fixed: up to four decimals, no trailing zeros', () => {
    const t = FIXED.tostring
    expect(t(0)).toBe('0')
    expect(t(1)).toBe('1')
    expect(t(-1)).toBe('-1')
    expect(t(0.5)).toBe('0.5')
    expect(t(1.25)).toBe('1.25')
    expect(t(100)).toBe('100')
    expect(t(10)).toBe('10')
    expect(t(21845 / 65536)).toBe('0.3333')
    expect(t(-32768)).toBe('-32768')
    expect(t(-0.00001)).toBe('0')
  })
  it('float: %.14g formatting', () => {
    const t = FLOAT.tostring
    expect(t(0)).toBe('0')
    expect(t(-0)).toBe('-0')
    expect(t(1)).toBe('1')
    expect(t(0.1)).toBe('0.1')
    expect(t(0.1 + 0.2)).toBe('0.3')
    expect(t(1 / 3)).toBe('0.33333333333333')
    expect(t(100)).toBe('100')
    expect(t(123456789012)).toBe('123456789012')
    expect(t(1e14)).toBe('1e+14')
    expect(t(1e15)).toBe('1e+15')
    expect(t(12345678901234)).toBe('12345678901234')
    expect(t(0.0001)).toBe('0.0001')
    expect(t(0.00001)).toBe('1e-05')
    expect(t(1.5e-7)).toBe('1.5e-07')
    expect(t(1e100)).toBe('1e+100')
    expect(t(-2.5)).toBe('-2.5')
    expect(t(Infinity)).toBe('inf')
    expect(t(-Infinity)).toBe('-inf')
    expect(t(NaN)).toBe('nan')
  })
})

describe('parseNumber', () => {
  it('parses decimals', () => {
    expect(parseNumber('12')).toBe(12)
    expect(parseNumber('1.5')).toBe(1.5)
    expect(parseNumber('.5')).toBe(0.5)
    expect(parseNumber('5.')).toBe(5)
    expect(parseNumber('-3')).toBe(-3)
    expect(parseNumber('+3')).toBe(3)
    expect(parseNumber('  42  ')).toBe(42)
    expect(parseNumber('\t7\n')).toBe(7)
  })
  it('parses hex and binary, with fractions', () => {
    expect(parseNumber('0x10')).toBe(16)
    expect(parseNumber('0XfF')).toBe(255)
    expect(parseNumber('0x.8')).toBe(0.5)
    expect(parseNumber('0x1.8')).toBe(1.5)
    expect(parseNumber('-0x10')).toBe(-16)
    expect(parseNumber('0b101')).toBe(5)
    expect(parseNumber('0b.1')).toBe(0.5)
    expect(parseNumber('0b11.01')).toBe(3.25)
  })
  it('rejects everything else', () => {
    for (const bad of ['', ' ', 'abc', '1x', '1 2', '0x', '0b', '0xg', '0b2', '--1', '1e3', '1..2', '.', '+', '-', 'nan', 'inf', '0x.']) {
      expect(parseNumber(bad), JSON.stringify(bad)).toBeUndefined()
    }
  })
  it('model parse rounds to the model', () => {
    expect(FIXED.parse('0.1')).toBe(6554 / 65536)
    expect(FLOAT.parse('0.1')).toBe(0.1)
    expect(FIXED.parse('abc')).toBeUndefined()
    expect(FIXED.parse('40000')).toBe(40000 - 65536)
  })
})
