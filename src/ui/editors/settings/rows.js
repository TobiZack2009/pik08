import { elemake } from '../../dom.js'

/**
 * The page layout shared by the settings categories: a title, and rows of "name and hint on the left,
 * the control on the right".
 */

/**
 * @param {string} title
 * @param {...any} content
 */
export function section(title, ...content) {
  return elemake('section', { class: 'settings__section' }, elemake('h2', { class: 'settings__title' }, title), ...content)
}

/**
 * @param {string} label
 * @param {string} hint  one line under the name
 * @param {HTMLElement} control
 */
export function row(label, hint, control) {
  return elemake(
    'div',
    { class: 'settings__row' },
    elemake('div', { class: 'settings__text' }, elemake('span', { class: 'settings__label' }, label), elemake('span', { class: 'settings__hint' }, hint)),
    control,
  )
}
