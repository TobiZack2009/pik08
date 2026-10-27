import { elemake } from '../dom.js'

/**
 * `<p8-palette value="7">`: a colour picker over the active palette. Swatches take their colour
 * from the `--p8-<index>` custom properties (see theme.js), so there is nothing to feed it.
 *
 * Attributes: `value` (selected index), `count` (colours shown, default 16), `columns` (default 4).
 * With `count` above 16 the extra colours (the "secret" ones in PICO-8) get a gap before them.
 * Fires `change` with `detail.value`. Arrow keys move the selection.
 */
export class P8Palette extends HTMLElement {
  static observedAttributes = ['value', 'count', 'columns']

  connectedCallback() {
    this.setAttribute('role', 'radiogroup')
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Colour')
    this.addEventListener('keydown', this.#onKey)
    this.#render()
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.#onKey)
  }

  attributeChangedCallback() {
    if (this.isConnected) this.#render()
  }

  get value() {
    return Number(this.getAttribute('value') ?? 0)
  }
  set value(index) {
    this.setAttribute('value', String(index))
  }

  get count() {
    return Number(this.getAttribute('count') ?? 16)
  }

  get columns() {
    return Number(this.getAttribute('columns') ?? 4)
  }

  /** @param {number} index */
  #select(index) {
    if (index === this.value || index < 0 || index >= this.count) return
    this.value = index
    this.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value: index } }))
  }

  #render() {
    const { value, count, columns } = this
    this.style.setProperty('--columns', String(columns))
    /** @type {Node[]} */
    const nodes = []
    for (let i = 0; i < count; i++) {
      if (i === 16) nodes.push(elemake('span', { class: 'p8-palette__gap', 'aria-hidden': 'true' }))
      nodes.push(
        elemake('button', {
          type: 'button',
          role: 'radio',
          class: 'p8-swatch',
          title: String(i),
          'aria-label': `Colour ${i}`,
          'aria-checked': String(i === value),
          tabindex: i === value ? '0' : '-1',
          style: { '--swatch': `var(--p8-${i})` },
          dataset: { index: i },
          onclick: () => this.#select(i),
        }),
      )
    }
    this.replaceChildren(...nodes)
  }

  /** @param {KeyboardEvent} e */
  #onKey = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -this.columns, ArrowDown: this.columns }[
      /** @type {'ArrowLeft'} */ (e.key)
    ]
    if (!step) return
    e.preventDefault()
    const next = Math.min(this.count - 1, Math.max(0, this.value + step))
    this.#select(next)
    const swatch = /** @type {HTMLElement[]} */ ([...this.querySelectorAll('.p8-swatch')]).find((s) => s.dataset.index === String(next))
    swatch?.focus()
  }
}
