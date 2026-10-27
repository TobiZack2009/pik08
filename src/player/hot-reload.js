import { paintIndexed } from './renderer.js'

/** @import { Project } from '../ui/store.js' */

/**
 * The link between the editor and the tab the cart runs in, over a BroadcastChannel.
 *
 * editor to player:
 *  - `cart`  the code and ROM to run; `restart` says to start over (otherwise the player restarts
 *            only if the code differs from what it runs, and swaps the ROM data in when it does not)
 *  - `stop`
 * player to editor:
 *  - `hello` the player has loaded and wants a cart
 *  - `ok` / `error`  the cart started fine / failed (`line` is a Lua line)
 *  - `frame` the screen as palette indices, now and then, for the preview in the dock
 *  - `bye`   the player tab closed
 *
 * @typedef {{ type: 'cart', code: string, rom: Uint8Array, restart: boolean } | { type: 'stop' }} EditorMessage
 * @typedef {{ type: 'hello' } | { type: 'ok' } | { type: 'error', line: number, message: string } | { type: 'frame', indices: Uint8Array } | { type: 'bye' }} PlayerMessage
 */

export const CHANNEL_NAME = 'p8n-run'
/** The hash that makes the page the player instead of the editor. */
export const PLAYER_HASH = '#run'

/** Quiet time after the last keystroke before the running cart restarts with the new code. */
export const CODE_DELAY = 400
/** Quiet time after the last edit of graphics, map or sound before they are swapped in. */
export const ROM_DELAY = 60

/**
 * @typedef {Object} ChannelLike
 * @property {(message: any) => void} postMessage
 * @property {(type: 'message', listener: (event: { data: any }) => void) => void} addEventListener
 * @property {() => void} close
 */

/**
 * @typedef {Object} RunnerOptions
 * @property {Pick<import('../core/profile.js').Profile, 'display'>} profile
 * @property {() => ChannelLike} [channel]
 * @property {(url: string) => unknown} [open]  opens (or reuses) the player tab; a falsy result means it was blocked
 * @property {() => string} [playerUrl]
 */

/**
 * The editor's side of running a cart: opens the player tab, keeps it up to date while you edit
 * and shows what comes back (errors on the code editor, frames in the dock).
 *
 * @param {RunnerOptions} options
 */
export function createRunner({
  profile,
  channel = () => new BroadcastChannel(CHANNEL_NAME),
  open = (url) => window.open(url, CHANNEL_NAME),
  playerUrl = () => location.href.split('#')[0] + PLAYER_HASH,
}) {
  /** @type {ChannelLike | null} */
  let link = null
  /** @type {Project | null} */
  let project = null
  /** @type {{ preview: HTMLCanvasElement | null, showLabel: () => void } | null} */
  let view = null
  /** @type {(() => void)[]} */
  let offs = []
  let live = false
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  let restartPending = false

  /** @param {EditorMessage} message */
  const send = (message) => link?.postMessage(message)

  /** @param {boolean} restart */
  function sendCart(restart) {
    if (!project) return
    send({ type: 'cart', code: project.cart.code, rom: project.cart.rom.slice(), restart })
  }

  /**
   * Sends the cart soon, folding edits that come close together into one message.
   * @param {boolean} restart
   * @param {number} delay
   */
  function sendSoon(restart, delay) {
    restartPending ||= restart
    clearTimeout(timer)
    timer = setTimeout(() => {
      sendCart(restartPending)
      restartPending = false
    }, delay)
  }

  function unwatch() {
    clearTimeout(timer)
    restartPending = false
    for (const off of offs) off()
    offs = []
  }

  function idle() {
    live = false
    unwatch()
    project?.emit('runerror', null)
    view?.showLabel()
  }

  /** @param {PlayerMessage} message */
  function receive(message) {
    switch (message?.type) {
      case 'hello':
        if (live) sendCart(true)
        break
      case 'ok':
        project?.emit('runerror', null)
        break
      case 'error':
        project?.emit('runerror', { line: message.line, message: message.message })
        break
      case 'frame':
        if (view?.preview) paintIndexed(view.preview, message.indices, profile.display.palette)
        break
      case 'bye':
        if (live) idle()
        break
    }
  }

  return {
    /**
     * The dock canvas to show frames on, and how to put the cart label back when the run is over.
     * @param {{ preview: HTMLCanvasElement | null, showLabel: () => void }} target
     */
    bind(target) {
      view = target
    },

    /**
     * Runs the project in the player tab (opening it if needed) and keeps it in sync until `stop`.
     * @param {Project} p
     * @returns {string | void} a message for the status bar
     */
    run(p) {
      project = p
      if (!link) {
        link = channel()
        link.addEventListener('message', (e) => receive(e.data))
      }
      unwatch()
      live = true
      offs = [
        p.on('code', () => sendSoon(true, CODE_DELAY)),
        p.on('rom', () => sendSoon(false, ROM_DELAY)),
        p.on('load', () => sendSoon(true, 0)),
      ]
      if (!open(playerUrl())) {
        idle()
        return 'the run tab was blocked; allow pop-ups for this page'
      }
      // a player that is already open takes this at once; a new one asks with `hello` when it has loaded
      sendCart(true)
      return 'running in the run tab'
    },

    /** @returns {string | void} */
    stop() {
      if (!live) return 'nothing is running'
      send({ type: 'stop' })
      idle()
    },

    get running() {
      return live
    },

    destroy() {
      unwatch()
      link?.close()
      link = null
      live = false
    },
  }
}
