/**
 * A fixed-timestep game loop: `step` runs 30 or 60 times a second however fast the display
 * refreshes, and `present` runs once per display frame in which anything was stepped.
 *
 * The clock and the scheduler can be replaced, which is how the tests drive it.
 *
 * @typedef {Object} LoopOptions
 * @property {() => void} step      one game update
 * @property {() => void} [present] show the result (after the steps of one display frame)
 * @property {number} [fps]         30 (default) or 60
 * @property {(callback: () => void) => number} [schedule]
 * @property {(handle: number) => void} [cancel]
 * @property {() => number} [now]   milliseconds
 */

/** The most steps made in one display frame; after a long stall the game slows down instead of racing to catch up. */
const MAX_CATCH_UP = 4

/** @param {LoopOptions} options */
export function createLoop({ step, present, fps = 30, schedule = (cb) => requestAnimationFrame(cb), cancel = (h) => cancelAnimationFrame(h), now = () => performance.now() }) {
  let frameMs = 1000 / fps
  let last = 0
  let owed = 0
  let handle = 0
  let running = false

  function tick() {
    if (!running) return
    handle = schedule(tick)
    const t = now()
    owed += t - last
    last = t
    let steps = 0
    while (owed >= frameMs - 0.5 && steps < MAX_CATCH_UP && running) {
      owed -= frameMs
      steps++
      step()
    }
    if (steps === MAX_CATCH_UP) owed = 0
    if (steps > 0 && running) present?.()
  }

  return {
    get running() {
      return running
    },
    get fps() {
      return 1000 / frameMs
    },
    /** Changes the rate; takes effect from the next frame. @param {number} value */
    setFps(value) {
      frameMs = 1000 / value
    },
    start() {
      if (running) return
      running = true
      last = now()
      owed = 0
      handle = schedule(tick)
    },
    stop() {
      if (!running) return
      running = false
      cancel(handle)
    },
  }
}
