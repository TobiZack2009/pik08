import './settings.css'
import { elemake } from '../../dom.js'
import { appearancePage } from './appearance-page.js'
import { shortcutsPage } from './shortcuts-page.js'

/** @import { EditorContext, EditorView } from '../index.js' */
/** @import { ActionSpec, Bindings } from '../../shortcuts.js' */
/** @import { Prefs } from '../../theme.js' */

/**
 * What the settings view reads and changes; the app owns the values.
 * @typedef {Object} SettingsApi
 * @property {() => Readonly<Prefs>} prefs
 * @property {(patch: Partial<Prefs>) => void} setPrefs  applies the change and remembers it
 * @property {Bindings} bindings
 * @property {readonly ActionSpec[]} actions  the shortcuts to list
 */

/**
 * One category of the menu: its page is built when the category is picked.
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} label
 * @property {string} icon
 * @property {(settings: SettingsApi) => { el: HTMLElement, destroy?: () => void }} page
 */

/** The menu, in order. A new group of settings is one more entry. @type {readonly Category[]} */
export const CATEGORIES = [
  { id: 'appearance', label: 'Appearance', icon: 'palette', page: appearancePage },
  { id: 'shortcuts', label: 'Shortcuts', icon: 'keyboard', page: shortcutsPage },
]

/**
 * The settings view: the categories on the left, the picked one on the right.
 * @param {EditorContext} ctx
 * @returns {EditorView}
 */
export function createSettingsEditor(ctx) {
  if (!ctx.settings) throw new Error('the settings view needs the settings of the app')
  const settings = /** @type {SettingsApi} */ (ctx.settings)

  /** @type {{ el: HTMLElement, destroy?: () => void } | undefined} */
  let page
  let current = ''

  const panel = elemake('div', { class: 'settings__page', role: 'tabpanel' })
  const buttons = CATEGORIES.map((category) =>
    elemake(
      'button',
      {
        type: 'button',
        role: 'tab',
        class: 'settings__category',
        dataset: { id: category.id },
        onclick: () => select(category.id),
      },
      elemake('p8-icon', { name: category.icon }),
      elemake('span', null, category.label),
    ),
  )
  const menu = elemake(
    'nav',
    { class: 'settings__menu', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Settings categories', onkeydown: onMenuKey },
    buttons,
  )

  /** @param {string} id */
  function select(id) {
    const category = CATEGORIES.find((c) => c.id === id)
    if (!category || id === current) return
    current = id
    page?.destroy?.()
    page = category.page(settings)
    panel.replaceChildren(page.el)
    for (const button of buttons) {
      const selected = button.dataset.id === id
      button.setAttribute('aria-selected', String(selected))
      button.tabIndex = selected ? 0 : -1
    }
  }

  /** @param {KeyboardEvent} e */
  function onMenuKey(e) {
    const at = CATEGORIES.findIndex((c) => c.id === current)
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: CATEGORIES.length - 1 }[
      /** @type {'ArrowDown' | 'ArrowUp' | 'Home' | 'End'} */ (e.key)
    ]
    if (next === undefined) return
    e.preventDefault()
    const to = (next + CATEGORIES.length) % CATEGORIES.length
    select(CATEGORIES[to].id)
    buttons[to].focus()
  }

  select(CATEGORIES[0].id)
  return {
    el: elemake('div', { class: 'settings' }, menu, panel),
    destroy: () => page?.destroy?.(),
  }
}
