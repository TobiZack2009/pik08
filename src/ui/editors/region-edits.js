import { RegionHistory } from '../history.js'

/** @import { Project } from '../store.js' */

/**
 * Undoable, announced edits of some ROM regions, for editors made of form controls (sfx, music): each
 * `edit` is one undo step, and the project hears which regions changed. Edits made by someone
 * else arrive through `project.on('rom:<region>')`, which the editor listens to itself (the
 * `source` tells it which ones are its own).
 *
 * @param {Project} project
 * @param {string[]} names  the regions, in the order the history stores them
 * @param {unknown} source  identifies the editor in `rom` events
 * @param {() => void} [onChange]  called after an edit, undo or redo, to show the new bytes
 */
export function createRegionEdits(project, names, source, onChange) {
  const history = new RegionHistory(() => names.map((name) => project.region(name)))

  /** @param {import('../history.js').RegionDiff[] | undefined} diffs */
  const announce = (diffs) => {
    project.notifyRom([...new Set((diffs ?? []).map((d) => names[d.region]))], source)
    onChange?.()
  }

  /** @param {boolean} forward */
  function step(forward) {
    if (!(forward ? history.redo() : history.undo())) return false
    announce(forward ? history.undoStack.at(-1) : history.redoStack.at(-1))
    return true
  }

  return {
    history,
    /**
     * Runs a change to the regions as one undo step.
     * @param {() => void} change
     * @returns {boolean} whether any byte changed
     */
    edit(change) {
      history.begin()
      change()
      if (!history.commit()) return false
      announce(history.undoStack.at(-1))
      return true
    },
    /** Starts an edit that spans several events (a drag); the bytes are changed in between. */
    begin: () => history.begin(),
    /** Ends it as one undo step. @returns {boolean} whether any byte changed */
    commit() {
      if (!history.commit()) return false
      announce(history.undoStack.at(-1))
      return true
    },
    /** Abandons it, putting the bytes back. */
    cancel() {
      history.cancel()
      onChange?.()
    },
    undo: () => step(false),
    redo: () => step(true),
    clear: () => history.clear(),
  }
}
