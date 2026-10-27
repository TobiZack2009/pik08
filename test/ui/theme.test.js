// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { PICO8_PALETTE } from '../../src/profiles/pico8/index.js'
import { applyPalette, applyPrefs, cssColor, loadPrefs, savePrefs } from '../../src/ui/theme.js'

/** @returns {Storage} */
function memoryStorage(initial = {}) {
  /** @type {Record<string, string>} */
  const data = { ...initial }
  return /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => data[k] ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => void (data[k] = v),
  })
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})

describe('theme', () => {
  it('formats colours', () => {
    expect(cssColor(0)).toBe('#000000')
    expect(cssColor(0xff004d)).toBe('#ff004d')
    expect(cssColor(0x1d2b53)).toBe('#1d2b53')
  })

  it('publishes the palette as custom properties', () => {
    applyPalette(PICO8_PALETTE)
    const style = document.documentElement.style
    expect(style.getPropertyValue('--p8-0')).toBe('#000000')
    expect(style.getPropertyValue('--p8-8')).toBe('#ff004d')
    expect(style.getPropertyValue('--p8-31')).toBe('#ff9d81')
  })

  it('has defaults and survives junk', () => {
    expect(loadPrefs(memoryStorage())).toEqual({ theme: 'dark', density: 'comfortable' })
    expect(loadPrefs(memoryStorage({ 'p8n.prefs': 'not json' }))).toEqual({ theme: 'dark', density: 'comfortable' })
    expect(loadPrefs(memoryStorage({ 'p8n.prefs': '{"theme":"pink","density":"compact"}' }))).toEqual({
      theme: 'dark',
      density: 'compact',
    })
  })

  it('saves and applies preferences', () => {
    applyPrefs({ theme: 'light', density: 'compact' })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(loadPrefs()).toEqual({ theme: 'light', density: 'compact' })
  })

  it('tolerates a storage that throws', () => {
    const broken = /** @type {Storage} */ (
      /** @type {any} */ ({
        getItem() {
          throw new Error('blocked')
        },
        setItem() {
          throw new Error('blocked')
        },
      })
    )
    expect(loadPrefs(broken).theme).toBe('dark')
    expect(() => savePrefs({ theme: 'dark', density: 'compact' }, broken)).not.toThrow()
  })
})
