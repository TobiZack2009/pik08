/**
 * Undo/redo for editors that edit byte regions in place (sprite sheet, map, sfx, ...).
 *
 * An edit gesture is bracketed by `begin()` and `commit()`; the history stores only the bytes that
 * changed in between, so a long stack of strokes over an 8KB region stays small. Regions are fetched
 * through `getRegions` on every use, because loading a cart replaces the underlying arrays.
 *
 * Code text has its own undo (CodeMirror's history).
 */

/**
 * @typedef {Object} RegionDiff
 * @property {number} region           Index into the list returned by `getRegions`
 * @property {Uint32Array} index       Changed byte offsets
 * @property {Uint8Array} before
 * @property {Uint8Array} after
 */

export class RegionHistory {
  /**
   * @param {() => Uint8Array[]} getRegions
   * @param {number} [limit]  Most entries kept
   */
  constructor(getRegions, limit = 256) {
    this.getRegions = getRegions
    this.limit = limit
    /** @type {RegionDiff[][]} */
    this.undoStack = []
    /** @type {RegionDiff[][]} */
    this.redoStack = []
    /** @type {Uint8Array[] | null} */
    this.snapshot = null
  }

  get canUndo() {
    return this.undoStack.length > 0
  }

  get canRedo() {
    return this.redoStack.length > 0
  }

  /** Starts an edit gesture. Calling it again before `commit` restarts the gesture. */
  begin() {
    this.snapshot = this.getRegions().map((r) => r.slice())
  }

  /**
   * Ends the gesture. Records an entry if anything changed.
   * @returns {boolean} whether something changed
   */
  commit() {
    const snapshot = this.snapshot
    this.snapshot = null
    if (!snapshot) return false
    const now = this.getRegions()
    /** @type {RegionDiff[]} */
    const diffs = []
    now.forEach((region, r) => {
      const old = snapshot[r]
      /** @type {number[]} */
      const changed = []
      for (let i = 0; i < region.length; i++) if (region[i] !== old[i]) changed.push(i)
      if (changed.length) {
        diffs.push({
          region: r,
          index: Uint32Array.from(changed),
          before: Uint8Array.from(changed, (i) => old[i]),
          after: Uint8Array.from(changed, (i) => region[i]),
        })
      }
    })
    if (!diffs.length) return false
    this.undoStack.push(diffs)
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack.length = 0
    return true
  }

  /** Abandons the gesture and restores the bytes as they were at `begin()`. */
  cancel() {
    const snapshot = this.snapshot
    this.snapshot = null
    if (!snapshot) return
    this.getRegions().forEach((region, r) => region.set(snapshot[r]))
  }

  /**
   * Runs `edit` as one gesture.
   * @template T
   * @param {() => T} edit
   * @returns {T}
   */
  edit(edit) {
    this.begin()
    try {
      return edit()
    } finally {
      this.commit()
    }
  }

  /** @returns {boolean} whether anything was undone */
  undo() {
    const diffs = this.undoStack.pop()
    if (!diffs) return false
    this.#apply(diffs, 'before')
    this.redoStack.push(diffs)
    return true
  }

  /** @returns {boolean} whether anything was redone */
  redo() {
    const diffs = this.redoStack.pop()
    if (!diffs) return false
    this.#apply(diffs, 'after')
    this.undoStack.push(diffs)
    return true
  }

  clear() {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.snapshot = null
  }

  /**
   * @param {RegionDiff[]} diffs
   * @param {'before' | 'after'} which
   */
  #apply(diffs, which) {
    const regions = this.getRegions()
    for (const d of diffs) {
      const region = regions[d.region]
      const values = d[which]
      for (let k = 0; k < d.index.length; k++) region[d.index[k]] = values[k]
    }
  }
}
