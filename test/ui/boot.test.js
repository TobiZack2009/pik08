// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

/** @type {{ destroy?: () => void } | null} */
let started = null

afterEach(() => {
  started?.destroy?.()
  started = null
  document.body.replaceChildren()
})

function root() {
  const el = document.createElement('div')
  document.body.append(el)
  return el
}

/** Boots the page with a fresh module state (booting registers the profiles, which can happen once). @param {HTMLElement} el @param {string} hash */
async function start(el, hash) {
  vi.resetModules()
  const { boot } = await import('../../src/ui/boot.js')
  started = /** @type {any} */ (await boot(el, hash))
  return /** @type {any} */ (started)
}

describe('boot', () => {
  it('starts the editor by default', async () => {
    const el = root()
    const app = await start(el, '')
    expect(el.querySelector('.player')).toBeNull()
    expect(el.querySelector('.app__status')).not.toBeNull()
    expect(typeof app.showLabel).toBe('function')
  })

  it('starts the player for the run hash', async () => {
    const el = root()
    const player = await start(el, '#run')
    expect(el.querySelector('.player canvas')).not.toBeNull()
    expect(el.querySelector('.app__status')).toBeNull()
    expect(player.game).toBeDefined()
  })

  it('sets the palette colours for both', async () => {
    await start(root(), '#run')
    expect(document.documentElement.style.getPropertyValue('--p8-8')).not.toBe('')
  })
})
