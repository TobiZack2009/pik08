/**
 * A profile describes one "console": its display, memory map and (informational) limits.
 * PICO-8 is the first profile; later ones can differ in resolution, memory layout, language
 * and API. Fields are added here as the pieces that consume them are built.
 *
 * @typedef {Object} Profile
 * @property {string} id                       Stable identifier, e.g. 'pico8'
 * @property {string} name                     Human-readable name
 * @property {{ width: number, height: number, palette: readonly number[] }} display
 *   `palette` holds 0xRRGGBB values. For PICO-8 the first 16 are the standard colours and the
 *   next 16 the "secret" palette (also usable in labels).
 * @property {{ size: number, romSize: number, regions: Readonly<Record<string, import('../profiles/pico8/memory-map.js').Region>> }} memory
 *   `size` is the whole address space; `romSize` the part stored in a cartridge's data
 *   sections (the first `romSize` bytes).
 * @property {{ defaultVersion: number, createRom: () => Uint8Array, starterCode: string }} cart
 *   `createRom` makes the data of a new, empty cartridge (`memory.romSize` bytes); it need not be zeros.
 *   `starterCode` is the program text (a p8str) a cart made with "New" starts with.
 * @property {{ codeChars?: number, tokens?: number, compressedBytes?: number }} limits
 *   Informational: the UI shows these and export codecs may enforce them; running never does.
 */

/** @type {Map<string, Profile>} */
const profiles = new Map()

/** @param {Profile} profile */
export function registerProfile(profile) {
  if (profiles.has(profile.id)) throw new Error(`profile already registered: ${profile.id}`)
  profiles.set(profile.id, profile)
}

/** @param {string} id */
export function getProfile(id) {
  const profile = profiles.get(id)
  if (!profile) throw new Error(`unknown profile: ${id}`)
  return profile
}

export function listProfiles() {
  return [...profiles.values()]
}
