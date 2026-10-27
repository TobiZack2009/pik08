import { registerProfile } from '../core/profile.js'
import { pico8Profile } from './pico8/index.js'

/** Registers every built-in profile. Call once at startup. */
export function registerBuiltinProfiles() {
  registerProfile(pico8Profile)
}
