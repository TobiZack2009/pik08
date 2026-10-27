import { decode, encode } from 'fast-png'
import { ExportLimitError, FormatError } from './errors.js'
import { compressCode } from './code-compress.js'
import { decompressCode } from './code-decompress.js'
import { sha1 } from './sha1.js'
import { pico8Profile } from '../profiles/pico8/index.js'
import {
  CART_SIZE,
  CART_TRAILER_SIZE,
  CART_TRAILER_START,
  CODE_END,
  CODE_REGION_SIZE,
  CODE_START,
  ROM_SIZE,
} from '../profiles/pico8/memory-map.js'

/** @import { Cart } from '../core/cart.js' */
/** @import { Profile } from '../core/profile.js' */

/**
 * Reading `.p8.png` cartridges.
 *
 * A cart is stored steganographically in a 160x205 RGBA PNG: the two low bits of
 * each of A, R, G, B form one byte (A is the top pair), giving 160*205 = 32800 bytes.
 *
 * Decoding deliberately goes through a pure-JS PNG decoder and NOT canvas:
 * `getImageData` returns premultiplied alpha, which corrupts the hidden bits.
 */

export const P8PNG_WIDTH = 160
export const P8PNG_HEIGHT = 205

/**
 * @typedef {Object} P8PngCart
 * @property {Uint8Array} rom         0x4300 bytes: gfx, map, flags, music, sfx (see ROM_REGIONS)
 * @property {string} code            Decompressed code as a binary string (1 char = 1 byte)
 * @property {import('./code-decompress.js').CodeFormat} codeFormat  How the code was stored
 * @property {number} version         The version byte at 0x8000
 * @property {Uint8Array} trailer     The raw 0x20-byte trailer at 0x8000 (version info + hash)
 * @property {Uint8Array | null} label  Palette indices of the picture, or null if there is none
 */

/** Where the label picture sits in the image; it is framed by a one pixel outline. */
const LABEL_X = 16
const LABEL_Y = 24

const BODY_COLOR = 0x646464
const OUTLINE_COLOR = 0x000408
const BLANK_LABEL_COLOR = 0x888888

/** Trailer bytes 1..5: (0, major, minor) of the PICO-8 release we claim, platform 'w', build. */
const TRAILER_PICO8_VERSION = [0, 2, 5]
const TRAILER_PLATFORM = 0x77
const TRAILER_BUILD = 6
const TRAILER_HASH_OFFSET = 6

/** First cart version that may contain pxa-compressed code (PICO-8 0.2.0). */
const MIN_PXA_VERSION = 16

/** Largest per-channel error when matching a pixel to a palette colour (low 2 bits are stolen). */
const LABEL_TOLERANCE = 4
/** Share of label pixels that must match the palette for the picture to count as a label. */
const LABEL_MATCH_RATIO = 0.9

/**
 * Collect the hidden bytes from raw RGBA pixel data.
 * @param {ArrayLike<number>} rgba  Non-premultiplied 8-bit RGBA, 4 bytes per pixel
 * @param {number} pixelCount
 * @returns {Uint8Array}
 */
export function extractBytes(rgba, pixelCount) {
  const out = new Uint8Array(pixelCount)
  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    out[i] = ((rgba[p + 3] & 3) << 6) | ((rgba[p] & 3) << 4) | ((rgba[p + 1] & 3) << 2) | (rgba[p + 2] & 3)
  }
  return out
}

/**
 * Split a 0x8020-byte cart image payload into its parts.
 * @param {Uint8Array} bytes
 * @returns {P8PngCart}
 */
export function parseCartBytes(bytes) {
  if (bytes.length < CART_SIZE) throw new FormatError(`cart data too short: ${bytes.length} < ${CART_SIZE} bytes`)
  const { code, format } = decompressCode(bytes.subarray(CODE_START, CODE_END))
  return {
    rom: bytes.slice(0, ROM_SIZE),
    code,
    codeFormat: format,
    version: bytes[CART_TRAILER_START],
    trailer: bytes.slice(CART_TRAILER_START, CART_TRAILER_START + CART_TRAILER_SIZE),
    label: null,
  }
}

/**
 * Decode a `.p8.png` file.
 * @param {Uint8Array} png  The PNG file bytes
 * @returns {P8PngCart}
 */
export function decodeP8Png(png) {
  let image
  try {
    image = decode(png)
  } catch (e) {
    throw new FormatError(`not a valid PNG: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (image.width !== P8PNG_WIDTH || image.height !== P8PNG_HEIGHT) {
    throw new FormatError(`unexpected image size ${image.width}x${image.height}, expected ${P8PNG_WIDTH}x${P8PNG_HEIGHT}`)
  }
  if (image.depth !== 8 || image.channels !== 4 || image.palette) {
    throw new FormatError('cart images must be 8-bit RGBA')
  }

  const cart = parseCartBytes(extractBytes(image.data, image.width * image.height))
  cart.label = extractLabel(image.data, pico8Profile)
  return cart
}

/**
 * Read the label picture back out of the image, if it is one: every pixel is the nearest
 * palette colour (within the noise of the hidden bits).
 * @param {ArrayLike<number>} rgba
 * @param {Profile} profile
 * @returns {Uint8Array | null}
 */
function extractLabel(rgba, profile) {
  const { width, height, palette } = profile.display
  const label = new Uint8Array(width * height)
  let matched = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = ((LABEL_Y + y) * P8PNG_WIDTH + LABEL_X + x) * 4
      const index = nearestColor(palette, rgba[p], rgba[p + 1], rgba[p + 2])
      if (index >= 0) {
        label[y * width + x] = index
        matched++
      }
    }
  }
  return matched >= width * height * LABEL_MATCH_RATIO ? label : null
}

/**
 * Index of the palette colour closest to (r, g, b), or -1 if none is within tolerance.
 * @param {readonly number[]} palette
 * @param {number} r
 * @param {number} g
 * @param {number} b
 */
function nearestColor(palette, r, g, b) {
  let best = -1
  let bestDistance = Infinity
  for (let i = 0; i < palette.length; i++) {
    const dr = Math.abs(((palette[i] >> 16) & 255) - r)
    const dg = Math.abs(((palette[i] >> 8) & 255) - g)
    const db = Math.abs((palette[i] & 255) - b)
    if (dr > LABEL_TOLERANCE || dg > LABEL_TOLERANCE || db > LABEL_TOLERANCE) continue
    const d = dr * dr + dg * dg + db * db
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best
}

/**
 * Read a `.p8.png` into a cart.
 * @param {Uint8Array} png
 * @param {Profile} [profile]
 * @returns {Cart}
 */
export function readP8Png(png, profile = pico8Profile) {
  const { rom, code, version, label } = decodeP8Png(png)
  return { profileId: profile.id, version, code, rom, label, extra: {} }
}

/**
 * The 0x8020 bytes a cart occupies in memory-image form: rom, compressed code, trailer.
 * @param {Cart} cart
 * @param {Profile} [profile]
 * @returns {Uint8Array}
 * @throws {ExportLimitError} if the code is too big to fit
 */
export function buildCartBytes(cart, profile = pico8Profile) {
  const { codeChars = Infinity, compressedBytes = Infinity } = profile.limits
  if (cart.code.length > codeChars) throw new ExportLimitError('codeChars', cart.code.length, codeChars)
  const { bytes: code, format } = compressCode(cart.code)
  // Whatever the profile says, the code region of the image is only this big.
  const limit = Math.min(compressedBytes, CODE_REGION_SIZE)
  if (code.length > limit) throw new ExportLimitError('compressedBytes', code.length, limit)

  const out = new Uint8Array(CART_SIZE)
  out.set(cart.rom, 0)
  out.set(code, CODE_START)
  out[CART_TRAILER_START] = format === 'pxa' ? Math.max(cart.version, MIN_PXA_VERSION) : cart.version
  out.set(TRAILER_PICO8_VERSION, CART_TRAILER_START + 1)
  out[CART_TRAILER_START + 4] = TRAILER_PLATFORM
  out[CART_TRAILER_START + 5] = TRAILER_BUILD
  out.set(sha1(out.subarray(0, CART_TRAILER_START)), CART_TRAILER_START + TRAILER_HASH_OFFSET)
  return out
}

/**
 * The picture a cart image shows underneath the hidden bits: a plain frame around the label.
 * @param {Uint8Array | null} label
 * @param {Profile} profile
 * @returns {Uint8Array} RGBA, opaque
 */
function renderFrame(label, profile) {
  const { width, height, palette } = profile.display
  if (label && label.length !== width * height) throw new RangeError(`label has ${label.length} pixels, expected ${width * height}`)
  const rgba = new Uint8Array(P8PNG_WIDTH * P8PNG_HEIGHT * 4)

  for (let y = 0; y < P8PNG_HEIGHT; y++) {
    for (let x = 0; x < P8PNG_WIDTH; x++) {
      const lx = x - LABEL_X
      const ly = y - LABEL_Y
      let color = BODY_COLOR
      if (lx >= 0 && lx < width && ly >= 0 && ly < height) {
        if (label) {
          const index = label[ly * width + lx]
          if (index >= palette.length) throw new RangeError(`label colour ${index} out of range`)
          color = palette[index]
        } else {
          color = BLANK_LABEL_COLOR
        }
      } else if (lx >= -1 && lx <= width && ly >= -1 && ly <= height) {
        color = OUTLINE_COLOR
      }
      const p = (y * P8PNG_WIDTH + x) * 4
      rgba[p] = color >> 16
      rgba[p + 1] = (color >> 8) & 255
      rgba[p + 2] = color & 255
      rgba[p + 3] = 255
    }
  }
  return rgba
}

/**
 * Hide `bytes` in the two low bits of each channel of `rgba` (in place).
 * @param {Uint8Array} rgba
 * @param {Uint8Array} bytes
 */
function embedBytes(rgba, bytes) {
  for (let i = 0, p = 0; i < bytes.length; i++, p += 4) {
    const b = bytes[i]
    rgba[p] = (rgba[p] & ~3) | ((b >> 4) & 3)
    rgba[p + 1] = (rgba[p + 1] & ~3) | ((b >> 2) & 3)
    rgba[p + 2] = (rgba[p + 2] & ~3) | (b & 3)
    rgba[p + 3] = (rgba[p + 3] & ~3) | (b >> 6)
  }
}

/**
 * Write a cart as a `.p8.png`.
 * @param {Cart} cart
 * @param {Profile} [profile]
 * @returns {Uint8Array}
 * @throws {ExportLimitError} if the cart doesn't fit
 */
export function writeP8Png(cart, profile = pico8Profile) {
  const bytes = buildCartBytes(cart, profile)
  const data = renderFrame(cart.label, profile)
  embedBytes(data, bytes)
  return encode({ width: P8PNG_WIDTH, height: P8PNG_HEIGHT, data, depth: 8, channels: 4 })
}
