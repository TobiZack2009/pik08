import { ExportLimitError } from '../formats/errors.js'
import { parseP8, serializeP8 } from '../formats/p8.js'
import { readP8Png, writeP8Png } from '../formats/p8png.js'
import { countTokens } from '../lua/tokens.js'

/** @import { Cart } from '../core/cart.js' */
/** @import { Profile } from '../core/profile.js' */

/**
 * Reading and writing cart files. The functions up to `describeLimitError` are pure; the rest
 * touch the browser (File System Access API where available, `<input>` and downloads otherwise).
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

/**
 * @param {Uint8Array} bytes
 * @returns {'p8png' | 'p8'}
 */
export function detectFormat(bytes) {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b) ? 'p8png' : 'p8'
}

/**
 * File name without the cart extension: `game.p8.png` -> `game`.
 * @param {string} fileName
 */
export function baseName(fileName) {
  return fileName.replace(/\.p8\.png$/i, '').replace(/\.(p8|png)$/i, '')
}

/**
 * @param {Uint8Array} bytes
 * @param {Profile} profile
 * @returns {Cart}
 * @throws {import('../formats/errors.js').FormatError}
 */
export function decodeCart(bytes, profile) {
  if (detectFormat(bytes) === 'p8png') return readP8Png(bytes, profile)
  return parseP8(new TextDecoder('utf-8').decode(bytes), profile)
}

/**
 * @param {Cart} cart
 * @param {Profile} profile
 * @returns {Uint8Array}
 */
export function encodeP8(cart, profile) {
  return new TextEncoder().encode(serializeP8(cart, profile))
}

/**
 * Throws if the cart is over one of the profile's limits that the code codecs don't check.
 * @param {Cart} cart
 * @param {Profile} profile
 * @throws {ExportLimitError}
 */
export function checkLimits(cart, profile) {
  const { tokens: maxTokens } = profile.limits
  if (maxTokens !== undefined) {
    const tokens = countTokens(cart.code)
    if (tokens > maxTokens) throw new ExportLimitError('tokens', tokens, maxTokens)
  }
}

/**
 * The bytes of a `.p8.png`. Blocked (by throwing) when the cart is over a limit.
 * @param {Cart} cart
 * @param {Profile} profile
 * @returns {Uint8Array}
 * @throws {ExportLimitError}
 */
export function encodeP8Png(cart, profile) {
  checkLimits(cart, profile)
  return writeP8Png(cart, profile)
}

const LIMIT_NAMES = /** @type {Record<string, string>} */ ({
  tokens: 'tokens',
  codeChars: 'characters of code',
  compressedBytes: 'bytes of compressed code',
})

/**
 * Text for the dialog shown when an export is blocked.
 * @param {ExportLimitError} err
 * @returns {{ title: string, message: string }}
 */
export function describeLimitError(err) {
  const what = LIMIT_NAMES[err.limit] ?? err.limit
  return {
    title: 'Cart is too big to export',
    message: `The cart has ${err.actual} ${what}, but the limit is ${err.max} (${err.actual - err.max} over). You can still run it and save it as .p8.`,
  }
}

/** Mime types by cart format. */
export const MIME = { p8: 'text/plain', p8png: 'image/png' }

const PICKER_TYPES = [
  { description: 'PICO-8 cartridges', accept: { 'text/plain': ['.p8'], 'image/png': ['.png'] } },
]

/**
 * @typedef {Object} OpenedFile
 * @property {Uint8Array} bytes
 * @property {string} name
 * @property {any} [handle]   File System Access handle, for saving back
 */

/**
 * @param {File} file
 * @returns {Promise<OpenedFile>}
 */
export async function readFile(file) {
  return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name }
}

/**
 * Shows the browser's open dialog. Resolves to null if the user cancels.
 * @returns {Promise<OpenedFile | null>}
 */
export async function pickFile() {
  const w = /** @type {any} */ (window)
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const [handle] = await w.showOpenFilePicker({ types: PICKER_TYPES })
      const file = await handle.getFile()
      return { ...(await readFile(file)), handle }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null
      throw e
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.p8,.png'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      resolve(file ? readFile(file) : null)
    })
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

/**
 * Saves bytes under a name the user can choose, or back to `handle` if given.
 * @param {Uint8Array} bytes
 * @param {string} suggestedName
 * @param {'p8' | 'p8png'} format
 * @param {any} [handle]  a handle from `pickFile` or an earlier save; used without asking
 * @returns {Promise<{ name: string, handle?: any } | null>}  null if the user cancels
 */
export async function saveFile(bytes, suggestedName, format, handle) {
  const w = /** @type {any} */ (window)
  const blob = new Blob([/** @type {BlobPart} */ (bytes)], { type: MIME[format] })
  if (handle || typeof w.showSaveFilePicker === 'function') {
    try {
      const target =
        handle ??
        (await w.showSaveFilePicker({
          suggestedName,
          types: [
            format === 'p8png'
              ? { description: 'PICO-8 cartridge image', accept: { 'image/png': ['.png'] } }
              : { description: 'PICO-8 cartridge', accept: { 'text/plain': ['.p8'] } },
          ],
        }))
      const writable = await target.createWritable()
      await writable.write(blob)
      await writable.close()
      return { name: target.name, handle: target }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null
      throw e
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { name: suggestedName }
}
