import { h } from '../dom.js'
import { createCodeEditor } from './code/code-editor.js'
import { createMapEditor } from './map/map-editor.js'
import { createSettingsEditor } from './settings/settings-editor.js'
import { createSoundEditor } from './sound/sound-editor.js'
import { createSpriteEditor } from './sprite/sprite-editor.js'

/** @import { Project } from '../store.js' */

/**
 * What an editor gets from the shell.
 * @typedef {Object} EditorContext
 * @property {Project} project
 * @property {(message: string) => void} setStatus  one line in the status bar
 * @property {(info: string) => void} setInfo       the editor's own readout (cursor position, ...)
 * @property {() => void} requestRun
 * @property {import('../audio.js').SoundService} [sound]  the live synth; absent where there is no audio
 * @property {import('./settings/settings-editor.js').SettingsApi} [settings]  what the settings view changes; only that view needs it
 * @property {import('../shortcuts.js').Bindings} [bindings]  the keys of the editors that have their own; they use the defaults without it
 */

/**
 * @typedef {Object} EditorView
 * @property {HTMLElement} el
 * @property {() => void} [activate]    the tab was shown
 * @property {() => void} [deactivate]  the tab was hidden
 * @property {() => void} [destroy]
 */

/** @typedef {(ctx: EditorContext) => EditorView} EditorFactory */

/** The tabs, in order (Alt+1 ... Alt+4 pick them, unless rebound). */
export const TABS = [
  { id: 'code', label: 'Code', icon: 'code' },
  { id: 'gfx', label: 'Sprites', icon: 'image' },
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'sound', label: 'Sound', icon: 'music' },
]

/** The view the gear button opens. It is not in the tab strip, and it is not remembered as the last tab. */
export const SETTINGS_TAB = 'settings'

/**
 * @param {string} title
 * @returns {EditorFactory}
 */
function placeholder(title) {
  return () => ({ el: h('div', { class: 'editor-empty' }, h('p', { class: 'faint' }, `${title} editor`)) })
}

/** @type {Record<string, EditorFactory>} */
export const EDITORS = {
  ...Object.fromEntries(TABS.map((tab) => [tab.id, placeholder(tab.label)])),
  code: createCodeEditor,
  gfx: createSpriteEditor,
  map: createMapEditor,
  sound: createSoundEditor,
  [SETTINGS_TAB]: createSettingsEditor,
}
