/** @import { Profile } from './profile.js' */
/** @import { Cart } from './cart.js' */

/**
 * A profile's whole address space. Editors read and write the cart's data through named
 * regions; a running game gets its own copy so it can never corrupt the cart being edited.
 */
export class Memory {
  /** @param {Profile['memory']} spec */
  constructor(spec) {
    this.spec = spec
    this.data = new Uint8Array(spec.size)
  }

  /**
   * A live view (not a copy) of a named region.
   * @param {string} name
   * @returns {Uint8Array}
   */
  region(name) {
    const r = this.spec.regions[name]
    if (!r) throw new Error(`unknown memory region: ${name}`)
    return this.data.subarray(r[0], r[1])
  }

  /** @param {number} addr */
  peek(addr) {
    this.#check(addr)
    return this.data[addr]
  }

  /**
   * @param {number} addr
   * @param {number} value  truncated to a byte
   */
  poke(addr, value) {
    this.#check(addr)
    this.data[addr] = value
  }

  /**
   * Copy a cart's ROM data to the start of memory.
   * @param {Pick<Cart, 'rom'>} cart
   */
  loadCart(cart) {
    if (cart.rom.length !== this.spec.romSize) {
      throw new RangeError(`cart rom is ${cart.rom.length} bytes, expected ${this.spec.romSize}`)
    }
    this.data.set(cart.rom, 0)
  }

  /** A copy of the ROM part of memory, for storing back into a cart. */
  readRom() {
    return this.data.slice(0, this.spec.romSize)
  }

  /** A fully independent copy, e.g. the memory a game runs on. */
  clone() {
    const copy = new Memory(this.spec)
    copy.data.set(this.data)
    return copy
  }

  /** @param {number} addr */
  #check(addr) {
    if (!Number.isInteger(addr) || addr < 0 || addr >= this.data.length) {
      throw new RangeError(`bad memory address: ${addr}`)
    }
  }
}
