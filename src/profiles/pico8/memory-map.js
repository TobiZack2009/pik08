/**
 * PICO-8 memory layout. Regions are half-open `[start, end)` byte ranges.
 * Everything that touches cart memory should use these names instead of raw addresses.
 */

/** @typedef {readonly [start: number, end: number]} Region */

/** Regions that live in the first 0x4300 bytes of a cartridge (loaded from / saved to carts). @type {Readonly<Record<'gfx'|'map'|'flags'|'music'|'sfx', Region>>} */
export const ROM_REGIONS = Object.freeze({
  gfx: [0x0000, 0x2000],
  map: [0x2000, 0x3000],
  flags: [0x3000, 0x3100],
  music: [0x3100, 0x3200],
  sfx: [0x3200, 0x4300],
})

/** All named regions of the 64KB address space, including runtime-only ones. @type {Readonly<Record<string, Region>>} */
export const MEMORY_REGIONS = Object.freeze({
  ...ROM_REGIONS,
  userData: [0x4300, 0x5e00],
  cartData: [0x5e00, 0x5f00],
  registers: [0x5f00, 0x6000], // draw state, hardware state, GPIO
  screen: [0x6000, 0x8000],
})

/** Size of the whole address space. */
export const MEMORY_SIZE = 0x8000

/** Size of the non-code part of the ROM (gfx..sfx). */
export const ROM_SIZE = 0x4300

/** The (possibly compressed) code lives in `[CODE_START, CODE_END)` of a .p8.png. */
export const CODE_START = 0x4300
export const CODE_END = 0x8000
export const CODE_REGION_SIZE = CODE_END - CODE_START

/** Total size of a cart as stored in a .p8.png, including the 0x20-byte version trailer. */
export const CART_TRAILER_START = 0x8000
export const CART_TRAILER_SIZE = 0x20
export const CART_SIZE = CART_TRAILER_START + CART_TRAILER_SIZE
