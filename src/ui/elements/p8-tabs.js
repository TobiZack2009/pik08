import { elemake } from '../dom.js'

/**
 * @typedef {Object} TabSpec
 * @property {string} id
 * @property {string} label
 * @property {string} [icon]   name of a `<p8-icon>`
 * @property {string} [title]  tooltip, e.g. with the shortcut
 */

/**
 * `<p8-tabs>`: a row of tabs. Set `tabs` and `value`; listen for `change` (`detail.value`).
 * Arrow keys, Home and End move between tabs.
 */
export class P8Tabs extends HTMLElement {
  /** @type {TabSpec[]} */
  #tabs = []
  #value = ''

  connectedCallback() {
    this.setAttribute('role', 'tablist')
    this.addEventListener('keydown', this.#onKey)
    this.#render()
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.#onKey)
  }

  get tabs() {
    return this.#tabs
  }
  set tabs(list) {
    this.#tabs = list
    if (!list.some((t) => t.id === this.#value)) this.#value = list[0]?.id ?? ''
    this.#render()
  }

  get value() {
    return this.#value
  }
  set value(id) {
    if (id === this.#value) return
    this.#value = id
    this.#render()
  }

  /** @param {string} id */
  #select(id) {
    if (id === this.#value) return
    this.value = id
    this.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { value: id } }))
  }

  #render() {
    if (!this.isConnected) return
    this.replaceChildren(
      ...this.#tabs.map((tab) => {
        const selected = tab.id === this.#value
        return elemake(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: 'p8-tab',
            title: tab.title ?? tab.label,
            'aria-selected': String(selected),
            tabindex: selected ? '0' : '-1',
            dataset: { id: tab.id },
            onclick: () => this.#select(tab.id),
          },
          tab.icon && elemake('p8-icon', { name: tab.icon }),
          elemake('span', { class: 'p8-tab__label' }, tab.label),
        )
      }),
    )
  }

  /** @param {KeyboardEvent} e */
  #onKey = (e) => {
    const ids = this.#tabs.map((t) => t.id)
    const at = ids.indexOf(this.#value)
    /** @type {number | undefined} */
    let next
    if (e.key === 'ArrowRight') next = (at + 1) % ids.length
    else if (e.key === 'ArrowLeft') next = (at - 1 + ids.length) % ids.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = ids.length - 1
    if (next === undefined || !ids.length) return
    e.preventDefault()
    this.#select(ids[next])
    const button = /** @type {HTMLElement[]} */ ([...this.children]).find((c) => c.dataset.id === ids[next])
    button?.focus()
  }
}
