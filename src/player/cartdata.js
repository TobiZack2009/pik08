import { LuaError } from '../lua/errors.js'

/**
 * A cart's persistent data (`cartdata`, `dget`, `dset`): the 256 bytes at 0x5e00, kept between runs
 * under the id the cart names. Carts that use the same id share the data, as on the console.
 *
 * @typedef {Object} Storage
 * @property {(key: string) => string | null} get
 * @property {(key: string, value: string) => void} set
 */

export const CARTDATA_ADDR = 0x5e00
export const CARTDATA_SIZE = 0x100

const PREFIX = 'p8n:cartdata:'
const VALID_ID = /^[a-z0-9_]{1,64}$/

/** The browser's local storage, or nothing where there is none (or it is not allowed). @returns {Storage | null} */
export function browserStorage() {
  try {
    const store = globalThis.localStorage
    if (!store) return null
    return { get: (key) => store.getItem(key), set: (key, value) => store.setItem(key, value) }
  } catch {
    return null
  }
}

/**
 * @param {Uint8Array} data  the address space
 * @param {Storage | null} storage  where the data is kept; null keeps it only while the game runs
 */
export function createCartData(data, storage) {
  /** @type {string | null} */
  let id = null
  const area = () => data.subarray(CARTDATA_ADDR, CARTDATA_ADDR + CARTDATA_SIZE)

  function flush() {
    if (id === null || !storage) return
    try {
      storage.set(PREFIX + id, Array.from(area(), (b) => b.toString(16).padStart(2, '0')).join(''))
    } catch {
      // full or refused: the data lasts as long as the game
    }
  }

  return {
    /** The id the cart named, if it did. */
    get id() {
      return id
    },
    /**
     * Opens the data of an id into memory.
     * @param {string} name
     * @returns {boolean} whether the cart has saved data from before
     */
    open(name) {
      if (id !== null) throw new LuaError('cartdata() can only be called once')
      if (!VALID_ID.test(name)) throw new LuaError('cartdata() id must be 1-64 lowercase letters, digits or underscores')
      id = name
      const saved = storage?.get(PREFIX + id) ?? null
      if (saved === null || !/^[0-9a-f]{512}$/.test(saved)) return false
      for (let i = 0; i < CARTDATA_SIZE; i++) data[CARTDATA_ADDR + i] = parseInt(saved.slice(i * 2, i * 2 + 2), 16)
      return true
    },
    /** Writes the data out; a cart may also have poked it directly. */
    flush,
  }
}
