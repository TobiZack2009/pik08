/** @import { Profile } from './profile.js' */

/**
 * The in-memory model of a cartridge. Editors mutate it; codecs convert it to and from files.
 *
 * @typedef {Object} Cart
 * @property {string} profileId
 * @property {number} version     Version id as stored in files (PICO-8: 41 is 0.2.5)
 * @property {string} code        Program text as a p8str: one JS char per byte (see formats/p8scii.js)
 * @property {Uint8Array} rom     The first `profile.memory.romSize` bytes of memory: gfx, map, flags, music, sfx
 * @property {Uint8Array | null} label   `display.width * display.height` palette indices, or null if no label
 * @property {Record<string, string[]>} extra   Sections of a .p8 file we don't understand, kept verbatim
 */

/**
 * A new, empty cart.
 * @param {Profile} profile
 * @returns {Cart}
 */
export function createCart(profile) {
  return {
    profileId: profile.id,
    version: profile.cart.defaultVersion,
    code: '',
    rom: profile.cart.createRom(),
    label: null,
    extra: {},
  }
}

/**
 * A new cart that starts with the profile's starter code.
 * @param {Profile} profile
 * @returns {Cart}
 */
export function createStarterCart(profile) {
  const cart = createCart(profile)
  cart.code = profile.cart.starterCode
  return cart
}

/**
 * Deep copy, so edits to the copy never touch the original.
 * @param {Cart} cart
 * @returns {Cart}
 */
export function cloneCart(cart) {
  return {
    profileId: cart.profileId,
    version: cart.version,
    code: cart.code,
    rom: cart.rom.slice(),
    label: cart.label ? cart.label.slice() : null,
    extra: Object.fromEntries(Object.entries(cart.extra).map(([name, lines]) => [name, lines.slice()])),
  }
}
