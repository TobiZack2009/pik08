/**
 * Keyboard input as the console's six buttons per player: left, right, up, down, O, X.
 * Player 0 plays on the arrow keys with Z/C/N (O) and X/V/M (X); player 1 on ESDF with Shift/Tab (O) and A/Q (X).
 * Enter and P ask for the pause menu.
 *
 * A cart that turned on the devkit mode (`poke(0x5f2d, 1)`) also gets the keys that were typed and
 * the mouse over the screen; the keyboard then belongs to the cart, and Escape asks for the pause menu.
 */

/** Keys that open the pause menu. */
export const PAUSE_KEYS = ['Enter', 'KeyP']

/** What the named keys type, as PICO-8 sees it. */
const KEY_TEXT = /** @type {Record<string, string>} */ ({ Enter: '\r', Backspace: '\b', Tab: '\t', Delete: '\x7f' })
/** The most typed characters kept for a cart that does not read them. */
const TEXT_MAX = 64

/** Keys (`KeyboardEvent.code`) for each button of each player. */
export const BUTTON_KEYS = [
  [['ArrowLeft'], ['ArrowRight'], ['ArrowUp'], ['ArrowDown'], ['KeyZ', 'KeyC', 'KeyN'], ['KeyX', 'KeyV', 'KeyM']],
  [['KeyS'], ['KeyF'], ['KeyE'], ['KeyD'], ['ShiftLeft', 'Tab'], ['KeyA', 'KeyQ']],
]

const BUTTONS = 6
/** Frames before a held button starts to repeat for `btnp`, and the gap between repeats. */
const REPEAT_DELAY = 15
const REPEAT_EVERY = 4

export class Input {
  constructor() {
    /** @type {Map<string, number>} key code -> bit (player * 8 + button) */
    this.bits = new Map()
    BUTTON_KEYS.forEach((player, p) => player.forEach((keys, b) => keys.forEach((code) => this.bits.set(code, p * 8 + b))))
    /** keys that are down */
    this.down = new Set()
    /** how many frames each bit has been held (0 = up) */
    this.held = new Uint16Array(16)
    /** whether the pause key was pressed since it was last asked about */
    this.pause = false
    /** whether the cart turned the devkit mode on; the game sets this */
    this.devkit = () => false
    /** @type {string[]} characters typed and not yet read (devkit mode) */
    this.text = []
    /** the mouse over the screen, in screen pixels; `buttons` is 1 left, 2 right, 4 middle */
    this.pointer = { x: 0, y: 0, buttons: 0, wheel: 0 }
    /** the wheel movement of the frame that is running: 1 up, -1 down, 0 */
    this.wheel = 0
  }

  /** Whether the pause key was pressed since the last time this was asked. */
  takePause() {
    const asked = this.pause
    this.pause = false
    return asked
  }

  /** Marks a key as pressed. @param {string} code */
  press(code) {
    this.down.add(code)
  }

  /** @param {string} code */
  release(code) {
    this.down.delete(code)
  }

  /** Lets go of everything, e.g. when the window loses focus. */
  releaseAll() {
    this.down.clear()
    this.pause = false
    this.text.length = 0
    this.pointer.buttons = 0
    this.pointer.wheel = 0
    this.wheel = 0
  }

  /** The next typed character, or an empty string. */
  takeText() {
    return this.text.shift() ?? ''
  }

  /** Whether a button is down right now. @param {number} bit */
  #isDown(bit) {
    for (const [code, b] of this.bits) if (b === bit && this.down.has(code)) return true
    return false
  }

  /** Counts a frame: call once before each update. */
  tick() {
    for (let bit = 0; bit < 16; bit++) this.held[bit] = this.#isDown(bit) ? Math.min(this.held[bit] + 1, 0xffff) : 0
    this.wheel = this.pointer.wheel
    this.pointer.wheel = 0
  }

  /**
   * Whether a button is held.
   * @param {number} button  0..5
   * @param {number} [player]
   */
  btn(button, player = 0) {
    return this.held[player * 8 + button] > 0
  }

  /**
   * Whether a button was just pressed, or is repeating while held.
   * @param {number} button
   * @param {number} [player]
   */
  btnp(button, player = 0) {
    const frames = this.held[player * 8 + button]
    return frames === 1 || (frames > REPEAT_DELAY && (frames - REPEAT_DELAY) % REPEAT_EVERY === 0)
  }

  /**
   * All buttons as a bitfield: player 0 in bits 0..5, player 1 in bits 8..13.
   * @param {boolean} [pressedOnly]  use `btnp` instead of `btn`
   */
  mask(pressedOnly = false) {
    let mask = 0
    for (let p = 0; p < 2; p++) {
      for (let b = 0; b < BUTTONS; b++) if (pressedOnly ? this.btnp(b, p) : this.btn(b, p)) mask |= 1 << (p * 8 + b)
    }
    return mask
  }

  /**
   * Follows the mouse over the screen: its position in screen pixels, its buttons and its wheel.
   * @param {HTMLElement} screen  the canvas
   * @param {number} width   the screen's size in pixels
   * @param {number} height
   * @param {Window} [target]  where releases and moves are heard, so that a drag can leave the canvas
   * @returns {() => void} stop listening
   */
  attachPointer(screen, width, height, target = window) {
    /** @param {MouseEvent} e */
    const move = (e) => {
      const box = screen.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) return
      this.pointer.x = Math.min(width - 1, Math.max(0, Math.floor(((e.clientX - box.left) * width) / box.width)))
      this.pointer.y = Math.min(height - 1, Math.max(0, Math.floor(((e.clientY - box.top) * height) / box.height)))
      this.pointer.buttons = e.buttons & 7
    }
    /** @param {WheelEvent} e */
    const wheel = (e) => {
      if (!this.devkit()) return
      e.preventDefault()
      this.pointer.wheel = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0
    }
    /** @param {Event} e */
    const menu = (e) => {
      if (this.devkit()) e.preventDefault()
    }
    screen.addEventListener('pointerdown', move)
    screen.addEventListener('wheel', wheel, { passive: false })
    screen.addEventListener('contextmenu', menu)
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', move)
    return () => {
      screen.removeEventListener('pointerdown', move)
      screen.removeEventListener('wheel', wheel)
      screen.removeEventListener('contextmenu', menu)
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', move)
      this.pointer.buttons = 0
    }
  }

  /**
   * Listens for keys on a window. The keys the game uses do not scroll the page.
   * @param {Window} [target]
   * @returns {() => void} stop listening
   */
  attach(target = window) {
    /** @param {KeyboardEvent} e */
    const onDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const devkit = this.devkit()
      if (devkit ? e.code === 'Escape' : PAUSE_KEYS.includes(e.code)) {
        e.preventDefault()
        if (!e.repeat) this.pause = true
        return
      }
      if (devkit) {
        const typed = KEY_TEXT[e.key] ?? (e.key.length === 1 ? e.key : '')
        if (typed) {
          e.preventDefault()
          if (this.text.length < TEXT_MAX) this.text.push(typed)
        }
      }
      if (!this.bits.has(e.code)) return
      e.preventDefault()
      this.press(e.code)
    }
    /** @param {KeyboardEvent} e */
    const onUp = (e) => {
      if (this.bits.has(e.code)) this.release(e.code)
    }
    const onBlur = () => this.releaseAll()
    target.addEventListener('keydown', onDown)
    target.addEventListener('keyup', onUp)
    target.addEventListener('blur', onBlur)
    return () => {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      target.removeEventListener('blur', onBlur)
      this.releaseAll()
    }
  }
}
