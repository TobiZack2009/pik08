import { createCart, createStarterCart } from '../core/cart.js'

/** @import { Cart } from '../core/cart.js' */
/** @import { Profile } from '../core/profile.js' */

/**
 * The project being edited: one cart plus where it came from. Editors read and write `cart`
 * directly (the ROM regions are edited in place) and tell the others through typed events.
 *
 * Events:
 *  - `code`         the program text changed; detail `{ source }`
 *  - `rom:<region>` bytes of a ROM region changed (`rom:gfx`, `rom:map`, ...); detail `{ source }`
 *  - `rom`          any ROM region changed; detail `{ regions, source }`
 *  - `load`         a different cart replaced the current one
 *  - `meta`         file name or dirty flag changed
 *  - `runerror`     the running cart failed (detail `{ line, message }`) or was fixed (`null`)
 *
 * `source` names the editor that made the change, so it can ignore its own echo.
 */

export class Project {
  /**
   * @param {Cart} cart
   * @param {Profile} profile
   * @param {string} [fileName]
   */
  constructor(cart, profile, fileName = 'untitled.p8') {
    this.cart = cart
    this.profile = profile
    this.fileName = fileName
    this.dirty = false
    /** @type {Map<string, Set<(detail: any) => void>>} */
    this.listeners = new Map()
  }

  /**
   * A project holding an empty cart.
   * @param {Profile} profile
   */
  static empty(profile) {
    return new Project(createCart(profile), profile)
  }

  /**
   * A project holding a new cart with the profile's starter code.
   * @param {Profile} profile
   */
  static starter(profile) {
    return new Project(createStarterCart(profile), profile)
  }

  /**
   * @param {string} type  an event name from the list above
   * @param {(detail: any) => void} fn
   * @returns {() => void} unsubscribe
   */
  on(type, fn) {
    let set = this.listeners.get(type)
    if (!set) this.listeners.set(type, (set = new Set()))
    set.add(fn)
    return () => set.delete(fn)
  }

  /**
   * @param {string} type
   * @param {any} [detail]
   */
  emit(type, detail) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(detail)
  }

  /**
   * A live view of a ROM region of the cart (edits write through to the cart).
   * Don't keep it across a `load`: the cart's ROM is replaced then.
   * @param {string} name
   * @returns {Uint8Array}
   */
  region(name) {
    const r = this.profile.memory.regions[name]
    if (!r) throw new Error(`unknown memory region: ${name}`)
    return this.cart.rom.subarray(r[0], r[1])
  }

  /**
   * @param {string} code  a p8str
   * @param {unknown} [source]
   */
  setCode(code, source) {
    if (code === this.cart.code) return
    this.cart.code = code
    this.#changed()
    this.emit('code', { source })
  }

  /**
   * Announce that bytes of the given ROM regions were edited in place.
   * @param {string[]} regions
   * @param {unknown} [source]
   */
  notifyRom(regions, source) {
    this.#changed()
    for (const r of regions) this.emit(`rom:${r}`, { source })
    this.emit('rom', { regions, source })
  }

  /**
   * Replaces the whole cart (opening a file, `new`).
   * @param {Cart} cart
   * @param {string} fileName
   */
  load(cart, fileName) {
    this.cart = cart
    this.fileName = fileName
    this.dirty = false
    this.emit('load')
    this.emit('meta')
  }

  /** @param {string} [fileName]  the name it was saved under */
  markSaved(fileName) {
    if (fileName !== undefined) this.fileName = fileName
    this.dirty = false
    this.emit('meta')
  }

  #changed() {
    if (this.dirty) return
    this.dirty = true
    this.emit('meta')
  }
}
