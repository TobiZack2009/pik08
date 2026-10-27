import './gallery.css'
import { h } from './dom.js'
import { showDialog } from './elements/index.js'
import { DENSITIES, THEMES, applyPrefs, loadPrefs } from './theme.js'
import { ICONS } from './icons.js'

/**
 * A development page (`/#gallery`) showing every element in every state, in either theme. It is
 * left out of production builds.
 * @param {HTMLElement} root
 */
export function mountGallery(root) {
  const prefs = loadPrefs()

  /**
   * @param {string} title
   * @param {...any} content
   */
  const section = (title, ...content) =>
    h('section', { class: 'gallery__section' }, h('h2', null, title), h('div', { class: 'gallery__row' }, ...content))

  const tabs = /** @type {any} */ (h('p8-tabs'))
  tabs.tabs = [
    { id: 'code', label: 'Code', icon: 'code' },
    { id: 'gfx', label: 'Sprites', icon: 'image' },
    { id: 'map', label: 'Map', icon: 'map' },
    { id: 'sfx', label: 'SFX', icon: 'waveform' },
    { id: 'music', label: 'Music', icon: 'music' },
  ]

  const meter = /** @type {any} */ (h('p8-meter', { label: 'tokens', value: 6000, max: 8192 }))
  const slider = h('input', {
    type: 'range',
    min: 0,
    max: 9000,
    value: 6000,
    oninput: (/** @type {Event} */ e) => (meter.value = Number(/** @type {HTMLInputElement} */ (e.target).value)),
  })

  const palette = h('p8-palette', { value: 8, count: 32 })

  root.replaceChildren(
    h(
      'div',
      { class: 'gallery' },
      h(
        'header',
        { class: 'gallery__header' },
        h('h1', null, 'p8n elements'),
        h(
          'p8-toolbar',
          null,
          ...THEMES.map((theme) =>
            h('p8-button', { onclick: () => applyPrefs({ ...prefs, theme: (prefs.theme = theme) }) }, theme),
          ),
          h('span', { class: 'sep' }),
          ...DENSITIES.map((density) =>
            h('p8-button', { onclick: () => applyPrefs({ ...prefs, density: (prefs.density = density) }) }, density),
          ),
        ),
      ),
      section(
        'Buttons',
        h('p8-button', { icon: 'play', variant: 'primary' }, 'Run'),
        h('p8-button', { icon: 'save' }, 'Save'),
        h('p8-button', { icon: 'trash', variant: 'danger' }, 'Delete'),
        h('p8-button', { icon: 'undo', variant: 'ghost', title: 'Undo' }),
        h('p8-button', { icon: 'grid', toggle: true, title: 'Grid' }),
        h('p8-button', { icon: 'grid', toggle: true, pressed: true, title: 'Grid (on)' }),
        h('p8-button', { disabled: true }, 'Disabled'),
      ),
      section('Tabs', tabs),
      section(
        'Toolbar',
        h(
          'p8-toolbar',
          { class: 'raised' },
          h('p8-button', { icon: 'pencil', title: 'Pen' }),
          h('p8-button', { icon: 'eraser', title: 'Eraser' }),
          h('p8-button', { icon: 'paint-bucket', title: 'Fill' }),
          h('span', { class: 'sep' }),
          h('p8-button', { icon: 'undo', title: 'Undo' }),
          h('p8-button', { icon: 'redo', title: 'Redo' }),
          h('span', { class: 'spacer' }),
          h('p8-button', { icon: 'info', title: 'Info' }),
        ),
      ),
      section('Palette', palette),
      section('Meter', meter, slider),
      section(
        'Split',
        h(
          'p8-split',
          { size: 200, fixed: 'end', style: { height: '120px', width: '100%' } },
          h('div', { class: 'sunken', style: { padding: '8px' } }, 'main pane'),
          h('div', { class: 'sunken', style: { padding: '8px' } }, 'side pane (drag the divider)'),
        ),
      ),
      section(
        'Dialog',
        h(
          'p8-button',
          {
            onclick: () =>
              showDialog({
                title: 'Cart is too big to export',
                message: 'The cart has 9000 tokens, but the limit is 8192 (808 over).',
                actions: [
                  { id: 'cancel', label: 'Cancel' },
                  { id: 'save', label: 'Save as .p8', primary: true },
                ],
              }),
          },
          'Open dialog',
        ),
      ),
      section(
        `Icons (${Object.keys(ICONS).length})`,
        ...Object.keys(ICONS).map((name) => h('span', { class: 'gallery__icon', title: name }, h('p8-icon', { name }), h('small', null, name))),
      ),
    ),
  )
}
