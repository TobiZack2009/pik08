import { elemake } from '../dom.js'

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'

/**
 * `<p8-dialog>`: a modal overlay. Closes on Escape and on a click on the backdrop by firing
 * `dismiss`; whoever opened it decides what to do (usually `showDialog`, below, which also removes
 * it). Focus moves into the dialog, is kept inside while it is open, and goes back afterwards.
 */
export class P8Dialog extends HTMLElement {
  /** @type {Element | null} */
  #previous = null

  connectedCallback() {
    this.#previous = document.activeElement
    this.setAttribute('role', 'dialog')
    this.setAttribute('aria-modal', 'true')
    this.addEventListener('keydown', this.#onKey)
    this.addEventListener('mousedown', this.#onBackdrop)
    const target = /** @type {HTMLElement | null} */ (this.querySelector('[autofocus], p8-button[variant="primary"]') ?? this.querySelector(FOCUSABLE))
    target?.focus()
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this.#onKey)
    this.removeEventListener('mousedown', this.#onBackdrop)
    if (this.#previous instanceof HTMLElement) this.#previous.focus()
  }

  /** @param {MouseEvent} e */
  #onBackdrop = (e) => {
    if (e.target === this) this.dispatchEvent(new CustomEvent('dismiss'))
  }

  /** @param {KeyboardEvent} e */
  #onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      this.dispatchEvent(new CustomEvent('dismiss'))
    } else if (e.key === 'Tab') {
      const items = /** @type {HTMLElement[]} */ ([...this.querySelectorAll(FOCUSABLE)])
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !this.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !this.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
  }
}

/**
 * @typedef {Object} DialogAction
 * @property {string} id
 * @property {string} label
 * @property {boolean} [primary]
 * @property {boolean} [danger]
 */

/**
 * Shows a modal dialog and resolves with the id of the chosen action, or `null` if it was
 * dismissed (Escape or a click outside).
 * @param {Object} options
 * @param {string} options.title
 * @param {string} [options.message]
 * @param {Node} [options.body]   extra content under the message
 * @param {DialogAction[]} [options.actions]  defaults to a single OK
 * @param {Element} [options.parent]
 * @returns {Promise<string | null>}
 */
export function showDialog({ title, message, body, actions = [{ id: 'ok', label: 'OK', primary: true }], parent = document.body }) {
  return new Promise((resolve) => {
    /** @param {string | null} result */
    const close = (result) => {
      dialog.remove()
      resolve(result)
    }
    const titleId = `p8-dialog-title-${Math.random().toString(36).slice(2)}`
    const dialog = elemake(
      'p8-dialog',
      { 'aria-labelledby': titleId, ondismiss: () => close(null) },
      elemake(
        'div',
        { class: 'p8-dialog__panel raised' },
        elemake('h2', { id: titleId, class: 'p8-dialog__title' }, title),
        elemake('div', { class: 'p8-dialog__body' }, message && elemake('p', null, message), body),
        elemake(
          'div',
          { class: 'p8-dialog__actions' },
          actions.map((a) =>
            elemake(
              'p8-button',
              { variant: a.danger ? 'danger' : a.primary ? 'primary' : null, dataset: { action: a.id }, onclick: () => close(a.id) },
              a.label,
            ),
          ),
        ),
      ),
    )
    parent.append(dialog)
  })
}
