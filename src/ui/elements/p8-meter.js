import { elemake } from '../dom.js'

/** Fraction of the limit from which the meter turns to a warning. */
export const WARN_AT = 0.9

/**
 * `<p8-meter label="tokens" value="120" max="8192">`: how much of a limit is used.
 * `data-state` is `ok`, `warn` (90% or more) or `over`.
 */
export class P8Meter extends HTMLElement {
  static observedAttributes = ['label', 'value', 'max']

  /** @type {HTMLElement | null} */
  #fill = null
  /** @type {HTMLElement | null} */
  #label = null
  /** @type {HTMLElement | null} */
  #amount = null

  connectedCallback() {
    if (this.#fill) return
    this.setAttribute('role', 'meter')
    this.setAttribute('aria-valuemin', '0')
    this.#label = elemake('span', { class: 'p8-meter__label' })
    this.#amount = elemake('span', { class: 'p8-meter__amount' })
    this.#fill = elemake('span', { class: 'p8-meter__fill' })
    this.replaceChildren(this.#label, elemake('span', { class: 'p8-meter__bar' }, this.#fill), this.#amount)
    this.#render()
  }

  attributeChangedCallback() {
    if (this.#fill) this.#render()
  }

  get value() {
    return Number(this.getAttribute('value') ?? 0)
  }
  set value(v) {
    this.setAttribute('value', String(v))
  }

  get max() {
    return Number(this.getAttribute('max') ?? 1)
  }
  set max(v) {
    this.setAttribute('max', String(v))
  }

  /** `ok`, `warn` or `over`. */
  get state() {
    const ratio = this.max > 0 ? this.value / this.max : 0
    return ratio > 1 ? 'over' : ratio >= WARN_AT ? 'warn' : 'ok'
  }

  #render() {
    const { value, max } = this
    const label = this.getAttribute('label') ?? ''
    const parts = /** @type {{ label: HTMLElement, amount: HTMLElement, fill: HTMLElement }} */ ({
      label: this.#label,
      amount: this.#amount,
      fill: this.#fill,
    })
    parts.label.textContent = label
    parts.amount.textContent = `${value} / ${max}`
    parts.fill.style.width = `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`
    this.dataset.state = this.state
    this.setAttribute('aria-valuenow', String(value))
    this.setAttribute('aria-valuemax', String(max))
    this.setAttribute('aria-label', label)
    this.setAttribute('aria-valuetext', `${value} of ${max}${this.state === 'over' ? ', over the limit' : ''}`)
  }
}
