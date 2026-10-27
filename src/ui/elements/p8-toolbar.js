const ITEMS = 'button:not(:disabled), [role="tab"], input:not(:disabled), select:not(:disabled)'

/**
 * `<p8-toolbar>`: a row (or, with `vertical`, a column) of controls. Left/Right (Up/Down when
 * vertical) move focus between the controls; Home and End jump to the ends. Children with the
 * `spacer` class push what follows to the far end, and `sep` draws a divider.
 */
export class P8Toolbar extends HTMLElement {
  connectedCallback() {
    if (!this.hasAttribute('role')) this.setAttribute('role', 'toolbar')
    if (this.hasAttribute('vertical')) this.setAttribute('aria-orientation', 'vertical')
    this.addEventListener('keydown', this.#onKey)
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.#onKey)
  }

  /** @param {KeyboardEvent} e */
  #onKey = (e) => {
    const target = /** @type {HTMLElement} */ (e.target)
    // text fields and tab lists use these keys themselves
    if (target.matches('input, select, textarea, [role="tab"]')) return
    const vertical = this.hasAttribute('vertical')
    const items = /** @type {HTMLElement[]} */ ([...this.querySelectorAll(ITEMS)]).filter((el) => !el.closest('[role="tablist"]'))
    const at = items.indexOf(target)
    if (at < 0) return
    /** @type {number | undefined} */
    let next
    if (e.key === (vertical ? 'ArrowDown' : 'ArrowRight')) next = (at + 1) % items.length
    else if (e.key === (vertical ? 'ArrowUp' : 'ArrowLeft')) next = (at - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next === undefined) return
    e.preventDefault()
    items[next].focus()
  }
}
