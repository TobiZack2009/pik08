import './gallery.css'
import { elemake } from './dom.js'
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
    elemake('section', { class: 'gallery__section' }, elemake('h2', null, title), elemake('div', { class: 'gallery__row' }, ...content))

  const tabs = /** @type {any} */ (elemake('p8-tabs'))
  tabs.tabs = [
    { id: 'code', label: 'Code', icon: 'code' },
    { id: 'gfx', label: 'Sprites', icon: 'image' },
    { id: 'map', label: 'Map', icon: 'map' },
    { id: 'sfx', label: 'SFX', icon: 'waveform' },
    { id: 'music', label: 'Music', icon: 'music' },
  ]

  const meter = /** @type {any} */ (elemake('p8-meter', { label: 'tokens', value: 6000, max: 8192 }))
  const slider = elemake('input', {
    type: 'range',
    min: 0,
    max: 9000,
    value: 6000,
    oninput: (/** @type {Event} */ e) => (meter.value = Number(/** @type {HTMLInputElement} */ (e.target).value)),
  })

  const palette = elemake('p8-palette', { value: 8, count: 32 })

  root.replaceChildren(
    elemake(
      'div',
      { class: 'gallery' },
      elemake(
        'header',
        { class: 'gallery__header' },
        elemake('h1', null, 'p8n elements'),
        elemake(
          'p8-toolbar',
          null,
          ...THEMES.map((theme) =>
            elemake('p8-button', { onclick: () => applyPrefs({ ...prefs, theme: (prefs.theme = theme) }) }, theme),
          ),
          elemake('span', { class: 'sep' }),
          ...DENSITIES.map((density) =>
            elemake('p8-button', { onclick: () => applyPrefs({ ...prefs, density: (prefs.density = density) }) }, density),
          ),
        ),
      ),
      section(
        'Buttons',
        elemake('p8-button', { icon: 'play', variant: 'primary' }, 'Run'),
        elemake('p8-button', { icon: 'save' }, 'Save'),
        elemake('p8-button', { icon: 'trash', variant: 'danger' }, 'Delete'),
        elemake('p8-button', { icon: 'undo', variant: 'ghost', title: 'Undo' }),
        elemake('p8-button', { icon: 'grid', toggle: true, title: 'Grid' }),
        elemake('p8-button', { icon: 'grid', toggle: true, pressed: true, title: 'Grid (on)' }),
        elemake('p8-button', { disabled: true }, 'Disabled'),
      ),
      section('Tabs', tabs),
      section(
        'Toolbar',
        elemake(
          'p8-toolbar',
          { class: 'raised' },
          elemake('p8-button', { icon: 'pencil', title: 'Pen' }),
          elemake('p8-button', { icon: 'eraser', title: 'Eraser' }),
          elemake('p8-button', { icon: 'paint-bucket', title: 'Fill' }),
          elemake('span', { class: 'sep' }),
          elemake('p8-button', { icon: 'undo', title: 'Undo' }),
          elemake('p8-button', { icon: 'redo', title: 'Redo' }),
          elemake('span', { class: 'spacer' }),
          elemake('p8-button', { icon: 'info', title: 'Info' }),
        ),
      ),
      section('Palette', palette),
      section('Meter', meter, slider),
      section(
        'Split',
        elemake(
          'p8-split',
          { size: 200, fixed: 'end', style: { height: '120px', width: '100%' } },
          elemake('div', { class: 'sunken', style: { padding: '8px' } }, 'main pane'),
          elemake('div', { class: 'sunken', style: { padding: '8px' } }, 'side pane (drag the divider)'),
        ),
      ),
      section(
        'Dialog',
        elemake(
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
        ...Object.keys(ICONS).map((name) => elemake('span', { class: 'gallery__icon', title: name }, elemake('p8-icon', { name }), elemake('small', null, name))),
      ),
    ),
  )
}
