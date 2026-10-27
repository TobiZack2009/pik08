/**
 * Theme and density: the palette of the active profile becomes CSS custom properties
 * (`--p8-0` ... `--p8-31`), and `data-theme` / `data-density` on the root pick the semantic colours
 * and sizes defined in `theme.css`. The choice is remembered in localStorage.
 */

export const THEMES = /** @type {const} */ (['dark', 'light'])
export const DENSITIES = /** @type {const} */ (['comfortable', 'compact'])

/** @typedef {typeof THEMES[number]} Theme */
/** @typedef {typeof DENSITIES[number]} Density */

const STORAGE_KEY = 'p8n.prefs'

/**
 * `0xRRGGBB` -> `#rrggbb`.
 * @param {number} rgb
 */
export function cssColor(rgb) {
  return '#' + (rgb & 0xffffff).toString(16).padStart(6, '0')
}

/**
 * Publishes a palette as `--p8-<index>` custom properties.
 * @param {readonly number[]} palette
 * @param {HTMLElement} [root]
 */
export function applyPalette(palette, root = document.documentElement) {
  palette.forEach((rgb, i) => root.style.setProperty(`--p8-${i}`, cssColor(rgb)))
}

/**
 * @typedef {Object} Prefs
 * @property {Theme} theme
 * @property {Density} density
 */

/**
 * @param {Storage | undefined} [storage]
 * @returns {Prefs}
 */
export function loadPrefs(storage = safeStorage()) {
  /** @type {Prefs} */
  const prefs = { theme: 'dark', density: 'comfortable' }
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}')
    if (THEMES.includes(saved.theme)) prefs.theme = saved.theme
    if (DENSITIES.includes(saved.density)) prefs.density = saved.density
  } catch {
    // unreadable preferences: defaults
  }
  return prefs
}

/**
 * @param {Prefs} prefs
 * @param {Storage | undefined} [storage]
 */
export function savePrefs(prefs, storage = safeStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // storage full or blocked: the choice just won't be remembered
  }
}

/**
 * Sets the attributes on the root element and remembers the choice.
 * @param {Prefs} prefs
 * @param {HTMLElement} [root]
 */
export function applyPrefs(prefs, root = document.documentElement) {
  root.dataset.theme = prefs.theme
  root.dataset.density = prefs.density
  savePrefs(prefs)
}

/** @returns {Storage | undefined} */
function safeStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined // blocked in some privacy modes
  }
}
