import { MEMORY_REGIONS, MEMORY_SIZE, ROM_SIZE } from './memory-map.js'

/** @import { Profile } from '../../core/profile.js' */

/** The 16 standard PICO-8 colours followed by the 16 "secret" ones, as 0xRRGGBB. */
export const PICO8_PALETTE = Object.freeze([
  0x000000, 0x1d2b53, 0x7e2553, 0x008751, 0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8,
  0xff004d, 0xffa300, 0xffec27, 0x00e436, 0x29adff, 0x83769c, 0xff77a8, 0xffccaa,
  0x291814, 0x111d35, 0x422136, 0x125359, 0x742f29, 0x49333b, 0xa28879, 0xf3ef7d,
  0xbe1250, 0xff6c24, 0xa8e72e, 0x00b543, 0x065ab5, 0x754665, 0xff6e59, 0xff9d81,
])

/**
 * The ROM of a new cartridge. It is not all zeros: every music pattern starts with all four
 * channels disabled (bytes 0x41..0x44) and every sfx has a speed (1 for sfx 0, 16 for the rest).
 * Rows of a `.p8` file at their default may be left out.
 * @returns {Uint8Array}
 */
export function createPico8Rom() {
  const rom = new Uint8Array(ROM_SIZE)
  const [sfxStart] = MEMORY_REGIONS.sfx
  const [musicStart] = MEMORY_REGIONS.music
  for (let i = 0; i < 64; i++) {
    rom[sfxStart + i * 68 + 65] = i === 0 ? 1 : 16 // header byte 1 of the 4 after the 32 notes
    for (let channel = 0; channel < 4; channel++) rom[musicStart + i * 4 + channel] = 0x41 + channel
  }
  return rom
}

/** The code of a new cartridge: the three entry points, ready to fill in. */
export const PICO8_STARTER_CODE = `-- called once when the cart starts
function _init()
end

-- called 30 times a second
function _update()
end

-- called after each update
function _draw()
  cls()
end
`

/** @type {Profile} */
export const pico8Profile = Object.freeze({
  id: 'pico8',
  name: 'PICO-8',
  display: { width: 128, height: 128, palette: PICO8_PALETTE },
  memory: { size: MEMORY_SIZE, romSize: ROM_SIZE, regions: MEMORY_REGIONS },
  cart: { defaultVersion: 41, createRom: createPico8Rom, starterCode: PICO8_STARTER_CODE },
  limits: { codeChars: 65535, tokens: 8192, compressedBytes: 15616 },
})
