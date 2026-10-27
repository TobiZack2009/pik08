import { encode } from 'fast-png'
import { CART_SIZE } from '../../src/profiles/pico8/memory-map.js'

const W = 160
const H = 205

/**
 * Hide `bytes` in the low two bits of A,R,G,B of each pixel. The high six bits of each
 * channel are filled with a deterministic pattern; alpha's are all ones so alpha lands in
 * 252..255, as in real carts (this is what makes premultiplied-alpha decoding lossy).
 * @param {Uint8Array} bytes  at most CART_SIZE bytes; the rest is zero-padded
 * @returns {Uint8Array} RGBA data
 */
export function packBytes(bytes) {
  const rgba = new Uint8Array(W * H * 4)
  let seed = 0x1234567
  const noise = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return (seed >>> 16) & 0xfc
  }
  for (let i = 0; i < W * H; i++) {
    const b = i < bytes.length ? bytes[i] : 0
    rgba[i * 4] = noise() | ((b >> 4) & 3)
    rgba[i * 4 + 1] = noise() | ((b >> 2) & 3)
    rgba[i * 4 + 2] = noise() | (b & 3)
    rgba[i * 4 + 3] = 0xfc | ((b >> 6) & 3)
  }
  return rgba
}

/**
 * Build a complete 160x205 PNG carrying `bytes`.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function makeP8Png(bytes) {
  if (bytes.length > CART_SIZE) throw new Error('too many bytes for a cart image')
  return encode({ width: W, height: H, data: packBytes(bytes), depth: 8, channels: 4 })
}
