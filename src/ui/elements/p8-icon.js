import { svgIcon } from '../icons.js'

/**
 * `<p8-icon name="play">`: a Lucide icon sized by `--icon` (or the `size` attribute, in px).
 * Decorative by default; give it a `label` to expose it to screen readers.
 */
export class P8Icon extends HTMLElement {
  static observedAttributes = ['name', 'size', 'label']

  connectedCallback() {
    this.#render()
  }

  /** @param {string} name @param {string | null} before @param {string | null} after */
  attributeChangedCallback(name, before, after) {
    if (before !== after && this.isConnected) this.#render()
  }

  #render() {
    const size = this.getAttribute('size')
    if (size) this.style.setProperty('--icon', `${size}px`)
    const label = this.getAttribute('label')
    if (label) {
      this.setAttribute('role', 'img')
      this.setAttribute('aria-label', label)
    } else {
      this.removeAttribute('role')
      this.removeAttribute('aria-label')
    }
    this.replaceChildren(svgIcon(this.getAttribute('name') ?? ''))
  }
}
