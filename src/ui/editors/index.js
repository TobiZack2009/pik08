import { h } from '../dom.js'
import { createCodeEditor } from './code/code-editor.js'
import { createMapEditor } from './map/map-editor.js'
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
 */

/**
 * @typedef {Object} EditorView
 * @property {HTMLElement} el
 * @property {() => void} [activate]    the tab was shown
 * @property {() => void} [deactivate]  the tab was hidden
 * @property {() => void} [destroy]
 */

/** @typedef {(ctx: EditorContext) => EditorView} EditorFactory */

/** The tabs, in order (Alt+1 ... Alt+4 pick them). */
export const TABS = [
  { id: 'code', label: 'Code', icon: 'code', title: 'Code (Alt+1)' },
  { id: 'gfx', label: 'Sprites', icon: 'image', title: 'Sprites (Alt+2)' },
  { id: 'map', label: 'Map', icon: 'map', title: 'Map (Alt+3)' },
  { id: 'sound', label: 'Sound', icon: 'music', title: 'Sound (Alt+4)' },
]

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
}
