/**
 * Two ends of an in-memory channel, standing in for a BroadcastChannel between two tabs: what one end
 * posts, the other receives (synchronously, as a structured clone, so a message that could not
 * travel between tabs fails here too).
 *
 * @returns {[Link, Link]}
 */
export function linkedChannels() {
  /** @type {Link} */
  const a = makeEnd()
  /** @type {Link} */
  const b = makeEnd()
  a.peer = b
  b.peer = a
  return [a, b]
}

/**
 * @typedef {Object} Link
 * @property {(message: any) => void} postMessage
 * @property {(type: 'message', listener: (event: { data: any }) => void) => void} addEventListener
 * @property {() => void} close
 * @property {boolean} closed
 * @property {any[]} sent  every message posted on this end
 * @property {Link | null} peer
 * @property {Set<(event: { data: any }) => void>} listeners
 */

/** @returns {Link} */
function makeEnd() {
  /** @type {Link} */
  const end = {
    sent: [],
    peer: null,
    closed: false,
    listeners: new Set(),
    postMessage(message) {
      if (end.closed) throw new Error('channel closed')
      end.sent.push(message)
      const copy = structuredClone(message)
      for (const fn of [...(end.peer?.listeners ?? [])]) fn({ data: copy })
    },
    addEventListener(_type, listener) {
      end.listeners.add(listener)
    },
    close() {
      end.closed = true
      end.listeners.clear()
    },
  }
  return end
}

/** A scheduler and a clock the test moves by hand, for `createLoop`. */
export function fakeClock() {
  let time = 0
  /** @type {(() => void) | null} */
  let pending = null
  return {
    now: () => time,
    schedule: (/** @type {() => void} */ cb) => {
      pending = cb
      return 1
    },
    cancel: () => {
      pending = null
    },
    /** Runs `n` display frames of the given length. @param {number} n @param {number} [ms] */
    frames(n, ms = 1000 / 30) {
      for (let i = 0; i < n; i++) {
        time += ms
        const cb = pending
        pending = null
        cb?.()
      }
    },
  }
}
