import { elemake } from '../dom.js'

/**
 * `<p8-button icon="play" variant="primary">Run</p8-button>`
 *
 * Wraps a real `<button>`, so keyboard and form behaviour come for free. Attributes: `icon`,
 * `label` (accessible name for icon-only buttons; falls back to `title`), `variant`
 * (`primary` | `danger` | `ghost`), `disabled`, and `toggle`, which makes it flip `pressed` on click
 * and fire `change`. Plain clicks bubble from the inner button as usual.
 */
export class P8Button extends HTMLElement {
  static observedAttributes = ['icon', 'label', 'title', 'disabled', 'pressed']

  /** @type {HTMLButtonElement | null} */
  #button = null
  /** @type {HTMLElement | null} */
  #icon = null
  #text = ''

  connectedCallback() {
    if (this.#button) return
    this.#text = this.textContent?.trim() ?? ''
    this.#button = elemake('button', { type: 'button', class: 'p8-button__inner' })
    this.replaceChildren(this.#button)
    this.#button.addEventListener('click', (e) => {
      if (this.disabled) return e.stopPropagation()
      if (this.hasAttribute('toggle')) {
        this.pressed = !this.pressed
        this.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { pressed: this.pressed } }))
      }
    })
    this.#render()
  }

  /** @param {string} name @param {string | null} before @param {string | null} after */
  attributeChangedCallback(name, before, after) {
    if (before !== after && this.#button) this.#render()
  }

  get disabled() {
    return this.hasAttribute('disabled')
  }
  set disabled(value) {
    this.toggleAttribute('disabled', Boolean(value))
  }

  get pressed() {
    return this.hasAttribute('pressed')
  }
  set pressed(value) {
    this.toggleAttribute('pressed', Boolean(value))
  }

  /**
   * @override
   * @param {FocusOptions} [options]
   */
  focus(options) {
    this.#button?.focus(options)
  }

  #render() {
    const button = /** @type {HTMLButtonElement} */ (this.#button)
    const icon = this.getAttribute('icon')
    if (icon && !this.#icon) {
      this.#icon = elemake('p8-icon', { name: icon })
      button.prepend(this.#icon)
    } else if (icon && this.#icon) {
      this.#icon.setAttribute('name', icon)
    } else if (!icon && this.#icon) {
      this.#icon.remove()
      this.#icon = null
    }
    if (this.#text && !button.querySelector('.p8-button__text')) {
      button.append(elemake('span', { class: 'p8-button__text' }, this.#text))
    }
    button.disabled = this.disabled
    const label = this.getAttribute('label') ?? this.getAttribute('title')
    if (label && !this.#text) button.setAttribute('aria-label', label)
    else button.removeAttribute('aria-label')
    if (this.hasAttribute('toggle')) button.setAttribute('aria-pressed', String(this.pressed))
    else button.removeAttribute('aria-pressed')
  }
}
