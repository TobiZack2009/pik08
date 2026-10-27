import './theme.css'
import { createRunner, PLAYER_HASH } from '../player/hot-reload.js'
import { mountPlayer } from '../player/index.js'
import { registerBuiltinProfiles } from '../profiles/index.js'
import { pico8Profile } from '../profiles/pico8/index.js'
import { mountApp } from './app.js'
import { createCliDrawer } from './cli-drawer.js'
import { defineElements } from './elements/index.js'
import { applyPalette, applyPrefs, loadPrefs } from './theme.js'

/**
 * Starts the page: the theme first, then the editor (or, in development, the element gallery).
 * @param {HTMLElement} root
 * @param {string} [hash]
 */
export async function boot(root, hash = location.hash) {
  registerBuiltinProfiles()
  defineElements()
  applyPalette(pico8Profile.display.palette)
  applyPrefs(loadPrefs())

  if (import.meta.env.DEV && hash === '#gallery') {
    const { mountGallery } = await import('./gallery.js')
    mountGallery(root)
    return null
  }

  if (hash === PLAYER_HASH) return mountPlayer(root, { profile: pico8Profile })

  const runner = createRunner({ profile: pico8Profile })
  const app = mountApp(root, { profile: pico8Profile, runner, cli: createCliDrawer })
  runner.bind({ preview: app.preview, showLabel: app.showLabel })
  return app
}
