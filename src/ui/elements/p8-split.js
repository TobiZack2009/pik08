import { clamp, h } from '../dom.js'

const STEP = 16
const BIG_STEP = 64

/**
 * `<p8-split>`: two panes (its first two children) with a draggable divider between them.
 *
 * Attributes: `direction` (`row` = side by side, the default, or `column`), `fixed` (`start` or
 * `end`: which pane has the pixel size; the other takes the rest), `size` (initial px, default 240),
 * `min` and `max` (px), and `storage-key` to remember the size. The divider works with the keyboard
 * too (arrows, Shift for big steps, Home/End, double-click or Enter to reset). Fires `resize`.
 */
export class P8Split extends HTMLElement {
  static observedAttributes = ['direction', 'fixed', 'size', 'min', 'max']

  /** @type {HTMLElement | null} */
  #handle = null
  #size = 240
  #defaultSize = 240

  connectedCallback() {
    if (this.#handle) return
    const [first, second] = /** @type {HTMLElement[]} */ ([...this.children])
    if (!first || !second) return
    this.#defaultSize = Number(this.getAttribute('size') ?? 240)
    this.#size = this.#stored() ?? this.#defaultSize
    this.#handle = h('div', {
      class: 'p8-split__handle',
      role: 'separator',
      tabindex: '0',
      'aria-valuenow': String(this.#size),
      onpointerdown: this.#onPointerDown,
      onkeydown: this.#onKey,
      ondblclick: () => this.size = this.#defaultSize,
    })
    second.before(this.#handle)
    this.#apply()
  }

  /** @param {string} name @param {string | null} before @param {string | null} after */
  attributeChangedCallback(name, before, after) {
    if (before === after || !this.#handle) return
    if (name === 'size') this.#size = Number(after ?? this.#defaultSize)
    this.#apply()
  }

  /** Size in px of the fixed pane. */
  get size() {
    return this.#size
  }
  set size(value) {
    this.#size = this.#clamp(value)
    this.#apply()
    this.#store()
    this.dispatchEvent(new CustomEvent('resize', { detail: { size: this.#size } }))
  }

  get #column() {
    return this.getAttribute('direction') === 'column'
  }

  get #fixedAtEnd() {
    return this.getAttribute('fixed') !== 'start'
  }

  /** @param {number} value */
  #clamp(value) {
    const min = Number(this.getAttribute('min') ?? 80)
    const total = this.#column ? this.clientHeight : this.clientWidth
    const roomMax = total > 0 ? total - min - 6 : Infinity
    const max = Math.min(Number(this.getAttribute('max') ?? 10000), roomMax, 10000)
    return clamp(Math.round(value), min, Math.max(min, max))
  }

  #apply() {
    const handle = this.#handle
    if (!handle) return
    const column = this.#column
    this.style.flexDirection = column ? 'column' : 'row'
    handle.setAttribute('aria-orientation', column ? 'horizontal' : 'vertical')
    handle.setAttribute('aria-valuenow', String(this.#size))
    const [first, second] = /** @type {HTMLElement[]} */ ([...this.children].filter((c) => c !== handle))
    const [fixed, flexible] = this.#fixedAtEnd ? [second, first] : [first, second]
    fixed.style.flex = `0 0 ${this.#size}px`
    flexible.style.flex = '1 1 0'
    for (const pane of [first, second]) {
      pane.style.minWidth = '0'
      pane.style.minHeight = '0'
      pane.style.overflow = 'hidden'
    }
  }

  /** @param {PointerEvent} e */
  #onPointerDown = (e) => {
    if (e.button !== 0) return
    const handle = /** @type {HTMLElement} */ (this.#handle)
    e.preventDefault()
    handle.setPointerCapture?.(e.pointerId)
    handle.dataset.dragging = ''
    /** @param {PointerEvent} ev */
    const move = (ev) => {
      const rect = this.getBoundingClientRect()
      const column = this.#column
      const pos = column ? ev.clientY - rect.top : ev.clientX - rect.left
      const total = column ? rect.height : rect.width
      const half = 3
      this.size = this.#fixedAtEnd ? total - pos - half : pos - half
    }
    const up = () => {
      delete handle.dataset.dragging
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  /** @param {KeyboardEvent} e */
  #onKey = (e) => {
    const column = this.#column
    const grow = this.#fixedAtEnd ? (column ? 'ArrowUp' : 'ArrowLeft') : column ? 'ArrowDown' : 'ArrowRight'
    const shrink = this.#fixedAtEnd ? (column ? 'ArrowDown' : 'ArrowRight') : column ? 'ArrowUp' : 'ArrowLeft'
    const step = e.shiftKey ? BIG_STEP : STEP
    if (e.key === grow) this.size = this.#size + step
    else if (e.key === shrink) this.size = this.#size - step
    else if (e.key === 'Home') this.size = 0
    else if (e.key === 'End') this.size = Infinity
    else if (e.key === 'Enter') this.size = this.#defaultSize
    else return
    e.preventDefault()
  }

  #stored() {
    const key = this.getAttribute('storage-key')
    if (!key) return null
    try {
      const value = Number(globalThis.localStorage?.getItem(`p8n.split.${key}`))
      return value > 0 ? value : null
    } catch {
      return null
    }
  }

  #store() {
    const key = this.getAttribute('storage-key')
    if (!key) return
    try {
      globalThis.localStorage?.setItem(`p8n.split.${key}`, String(this.#size))
    } catch {
      // not remembered
    }
  }
}
