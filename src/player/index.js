import './player.css'
import { h } from '../ui/dom.js'
import { createGame } from './game.js'
import { CHANNEL_NAME } from './hot-reload.js'

/** @import { Profile } from '../core/profile.js' */
/** @import { ChannelLike, EditorMessage, PlayerMessage } from './hot-reload.js' */

/** The editor's preview in the dock gets a frame at most this often (milliseconds). */
const FRAME_INTERVAL = 100

/**
 * @typedef {Object} PlayerOptions
 * @property {Profile} profile
 * @property {() => ChannelLike} [channel]
 * @property {() => number} [now]
 * @property {Parameters<typeof createGame>[0]['clock']} [clock]
 */

/** Downloads the screen as a PNG: what the cart asks for with `extcmd("screen")`. @param {HTMLCanvasElement} canvas */
function saveScreenshot(canvas) {
  canvas.toBlob?.((blob) => {
    if (!blob) return
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'p8n-screen.png'
    link.click()
    URL.revokeObjectURL(link.href)
  }, 'image/png')
}

/**
 * The run tab: a canvas, scaled by whole numbers to fit the window, that plays whatever cart the
 * editor sends and follows it as it changes.
 *
 * @param {HTMLElement} root
 * @param {PlayerOptions} options
 */
export function mountPlayer(root, { profile, channel = () => new BroadcastChannel(CHANNEL_NAME), now = () => performance.now(), clock }) {
  const { width, height } = profile.display
  const canvas = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'pixel player__screen', width, height, tabindex: 0, 'aria-label': 'running cart' }))
  const note = h('p', { class: 'player__note' }, 'waiting for the editor...')
  root.replaceChildren(h('div', { class: 'player' }, h('div', { class: 'player__stage' }, canvas), note))
  document.title = 'p8n - run'

  const link = channel()
  /** @param {PlayerMessage} message */
  const send = (message) => link.postMessage(message)

  /** @type {string | null} the code that is running */
  let running = null
  let lastFrame = -Infinity

  const game = createGame({
    profile,
    canvas,
    clock,
    onPrint: (text) => console.log(text),
    onError(error) {
      if (error) {
        note.textContent = `line ${error.line}: ${error.message}`
        note.dataset.state = 'error'
        send({ type: 'error', line: error.line, message: error.message })
      } else {
        note.textContent = 'running'
        delete note.dataset.state
        send({ type: 'ok' })
      }
    },
    onExtcmd(command) {
      if (command === 'screen') saveScreenshot(canvas)
    },
    onFrame(indices) {
      const t = now()
      if (t - lastFrame < FRAME_INTERVAL) return
      lastFrame = t
      send({ type: 'frame', indices: indices.slice() })
    },
  })

  /** Whole-number scale that fits the window. */
  function fit() {
    const room = Math.min(root.clientWidth || window.innerWidth, (root.clientHeight || window.innerHeight) - 32)
    const scale = Math.max(1, Math.floor(room / width))
    canvas.style.width = `${width * scale}px`
    canvas.style.height = `${height * scale}px`
  }

  /** @param {EditorMessage} message */
  function receive(message) {
    if (message?.type === 'cart') {
      const restart = message.restart || running === null || message.code !== running
      running = message.code
      if (restart) game.load({ code: message.code, rom: message.rom })
      else game.swapRom(message.rom)
    } else if (message?.type === 'stop') {
      game.stop()
      note.textContent = 'stopped'
    }
  }

  link.addEventListener('message', (e) => receive(e.data))
  const detachKeys = game.input.attach(window)
  const detachPointer = game.input.attachPointer(canvas, width, height)
  const wake = () => game.wake()
  window.addEventListener('pointerdown', wake)
  window.addEventListener('keydown', wake)
  const onResize = () => fit()
  const onHide = () => send({ type: 'bye' })
  window.addEventListener('resize', onResize)
  window.addEventListener('pagehide', onHide)
  fit()
  canvas.focus()
  send({ type: 'hello' })

  return {
    game,
    canvas,
    destroy() {
      void game.destroy()
      detachKeys()
      detachPointer()
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pagehide', onHide)
      link.close()
      root.replaceChildren()
    },
  }
}
