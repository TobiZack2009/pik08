import { first, truthy } from '../lua/values.js'
import { SCREEN_ADDR, SCREEN_H, SCREEN_W } from './graphics.js'

/** @import { Graphics } from './graphics.js' */
/** @import { Input } from './input.js' */

/**
 * The pause menu: "continue", the entries the cart added with `menuitem`, and "reset game". It
 * freezes the screen the cart had, draws over it, and puts everything back (the screen and the draw
 * state, which is why it saves all the memory from the registers up) when it closes.
 *
 * Up and down choose an entry; O or X picks it. An entry of the cart is called with the buttons that
 * were pressed (left 1, right 2, O 16, X 32) and the menu closes after it, unless it returns true.
 */

const REGISTERS = 0x5f00
const MEMORY_END = 0x8000
const SCREEN_OFFSET = SCREEN_ADDR - REGISTERS
const LABEL_MAX = 16
const SLOTS = 5

/** Button numbers of `Input`. */
const LEFT = 0
const RIGHT = 1
const UP = 2
const DOWN = 3
const O = 4
const X = 5

const BLACK = 0
const GREY = 5
const WHITE = 7
const ROW = 8
const PAD = 4

/**
 * @typedef {Object} MenuOptions
 * @property {Graphics} graphics
 * @property {Uint8Array} data   the address space
 * @property {Input} input
 * @property {(callback: (...args: any[]) => any, buttons: number) => any} call  runs a Lua function of the cart
 * @property {() => void} reset  restarts the cart ("reset game")
 */

/** @param {MenuOptions} options */
export function createMenu({ graphics, data, input, call, reset }) {
  /** @type {({ label: string, callback: (...args: any[]) => any } | null)[]} */
  const slots = Array.from({ length: SLOTS }, () => null)
  /** @type {Uint8Array | null} the memory from the registers up, as the cart left it */
  let saved = null
  let cursor = 0

  /** The rows of the menu now. */
  function entries() {
    /** @type {{ label: string, callback?: (...args: any[]) => any, kind: 'continue' | 'item' | 'reset' }[]} */
    const rows = [{ label: 'continue', kind: 'continue' }]
    for (const slot of slots) if (slot) rows.push({ label: slot.label, callback: slot.callback, kind: 'item' })
    rows.push({ label: 'reset game', kind: 'reset' })
    return rows
  }

  function open() {
    if (saved) return
    saved = data.slice(REGISTERS, MEMORY_END)
    cursor = 0
    graphics.reset()
  }

  function close() {
    if (!saved) return
    data.set(saved, REGISTERS)
    saved = null
  }

  function draw() {
    if (!saved) return
    data.set(saved.subarray(SCREEN_OFFSET), SCREEN_ADDR)
    const rows = entries()
    const width = Math.max(...rows.map((r) => r.label.length)) * 4 + PAD * 2 + 6
    const height = rows.length * ROW + PAD * 2 - 2
    const x0 = Math.floor((SCREEN_W - width) / 2)
    const y0 = Math.floor((SCREEN_H - height) / 2)
    graphics.rectfill(x0, y0, x0 + width - 1, y0 + height - 1, BLACK)
    graphics.rect(x0, y0, x0 + width - 1, y0 + height - 1, WHITE)
    rows.forEach((row, i) => {
      const y = y0 + PAD + i * ROW
      if (i === cursor) graphics.print('>', x0 + PAD, y, WHITE)
      graphics.print(row.label, x0 + PAD + 6, y, i === cursor ? WHITE : GREY)
    })
  }

  /** One frame of the menu: reads the buttons. */
  function step() {
    if (!saved) return
    const rows = entries()
    if (input.btnp(UP)) cursor = (cursor + rows.length - 1) % rows.length
    if (input.btnp(DOWN)) cursor = (cursor + 1) % rows.length
    const buttons = (input.btnp(LEFT) ? 1 : 0) | (input.btnp(RIGHT) ? 2 : 0) | (input.btnp(O) ? 16 : 0) | (input.btnp(X) ? 32 : 0)
    if (!buttons) return
    const row = rows[cursor]
    const picked = (buttons & 48) !== 0
    if (row.kind === 'continue') {
      if (picked) close()
    } else if (row.kind === 'reset') {
      if (picked) {
        close()
        reset()
      }
    } else if (row.callback) {
      const stay = truthy(first(call(row.callback, buttons)))
      if (!stay) close()
      else cursor = Math.min(cursor, entries().length - 1)
    }
  }

  return {
    get isOpen() {
      return saved !== null
    },
    open,
    close,
    step,
    draw,
    /**
     * Sets, replaces or (without a label) removes entry `index` (1..5) of the cart.
     * @param {number} index
     * @param {string} [label]
     * @param {(...args: any[]) => any} [callback]
     */
    setItem(index, label, callback) {
      slots[index - 1] = label === undefined || callback === undefined ? null : { label: label.slice(0, LABEL_MAX), callback }
    },
  }
}
