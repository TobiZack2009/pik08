import { h } from '../../dom.js'

/**
 * The page layout shared by the settings categories: a title, and rows of "name and hint on the left,
 * the control on the right".
 */

/**
 * @param {string} title
 * @param {...any} content
 */
export function section(title, ...content) {
  return h('section', { class: 'settings__section' }, h('h2', { class: 'settings__title' }, title), ...content)
}

/**
 * @param {string} label
 * @param {string} hint  one line under the name
 * @param {HTMLElement} control
 */
export function row(label, hint, control) {
  return h(
    'div',
    { class: 'settings__row' },
    h('div', { class: 'settings__text' }, h('span', { class: 'settings__label' }, label), h('span', { class: 'settings__hint' }, hint)),
    control,
  )
}
