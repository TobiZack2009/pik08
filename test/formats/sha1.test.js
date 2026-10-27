import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { sha1 } from '../../src/formats/sha1.js'

const hex = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('hex')

describe('sha1', () => {
  it('matches the standard test vectors', () => {
    expect(hex(sha1(new Uint8Array(0)))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(hex(sha1(Buffer.from('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(hex(sha1(Buffer.from('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    )
  })

  it('matches node:crypto around every padding boundary', () => {
    for (let n = 0; n <= 200; n++) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 7 + n) & 255)
      expect(hex(sha1(data))).toBe(createHash('sha1').update(data).digest('hex'))
    }
  })

  it('matches node:crypto on a cart-sized input and on random data (property)', () => {
    const big = Uint8Array.from({ length: 0x8000 }, (_, i) => (i * 31) & 255)
    expect(hex(sha1(big))).toBe(createHash('sha1').update(big).digest('hex'))
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1000 }), (data) => {
        expect(hex(sha1(data))).toBe(createHash('sha1').update(data).digest('hex'))
      }),
    )
  })
})
