import './sound.css'
import '../tracker.css'
import { h } from '../../dom.js'
import { titleHints } from '../../hints.js'
import { createBindings } from '../../shortcuts.js'
import { createRegionEdits } from '../region-edits.js'
import { createPatternPanel } from './pattern-panel.js'
import { createSongPanel } from './song-panel.js'
import { SFX_SIZE } from '../sfx/sfx-data.js'
import { barSpeed, cellSfx, freeSfx, isEmptySfx, setCell, usage } from './song.js'

/** @import { EditorContext, EditorView } from '../index.js' */

/** @typedef {'song' | 'pattern'} SoundFocus */

/**
 * The sound tab: the song as a timeline of patterns on top, and under it the pattern of the selected
 * cell as a piano roll (or any sound effect, from the list). Choosing a cell in the song shows its
 * pattern, and edits are heard as they are made. Both panels share one undo history over the
 * `sfx` and `music` regions, so undo takes back whatever the last edit touched in either.
 *
 * A cell with no pattern offers a blank sound effect (the first free one) in the pattern panel,
 * which is only given to the cell by the first edit that changes it, in the same undo step. So an
 * empty song can be written by choosing a cell and drawing notes, and merely looking allocates
 * nothing.
 *
 * The keyboard belongs to the panel that was used last, so Space plays the song after a click in it,
 * and the pattern after a click in the roll.
 *
 * @param {EditorContext} ctx
 * @returns {EditorView & Required<Pick<EditorView, 'activate' | 'deactivate' | 'destroy'>> & {
 *   state: { focus: SoundFocus },
 *   song: ReturnType<typeof createSongPanel>,
 *   pattern: ReturnType<typeof createPatternPanel>,
 *   select: (sfx: number) => void,
 *   setFocus: (focus: SoundFocus) => void,
 *   undo: () => void,
 *   redo: () => void,
 * }}
 */
export function createSoundEditor({ project, setInfo, setStatus, sound, bindings = createBindings(null) }) {
  const hints = titleHints(bindings)
  const source = Symbol('sound-editor')
  /** @type {{ focus: SoundFocus }} */
  const state = { focus: 'song' }
  let active = false
  const edits = createRegionEdits(project, ['sfx', 'music'], source, refresh)

  // ---- the blank pattern of an empty cell -------------------------------------------------------
  /** The sound effect offered to the selected cell while it is empty; -1 for none. */
  let draft = -1
  /** @type {{ bar: number, channel: number, id: number, before: Uint8Array } | null} */
  let claim = null

  const music = () => project.region('music')
  const sfx = () => project.region('sfx')
  const cell = () => song.timeline.state.cell
  const block = (/** @type {number} */ id) => sfx().subarray(id * SFX_SIZE, (id + 1) * SFX_SIZE)

  /** Shows the first free sound effect in the pattern panel as the blank one for the selected cell. */
  function offerDraft() {
    const [id] = freeSfx(sfx(), music())
    draft = id ?? -1
    if (id === undefined) setStatus?.('there is no free sfx left for a new pattern')
    else pattern.select(id)
  }

  /** The cell the draft is for, if the offer still stands: it is shown, untouched and unused. */
  function draftTarget() {
    if (draft < 0 || pattern.state.sfx !== draft) return null
    const { bar, channel } = cell()
    if (cellSfx(music(), bar, channel) >= 0 || usage(music())[draft].length > 0 || !isEmptySfx(sfx(), draft)) return null
    return { bar, channel, id: draft }
  }

  /**
   * The undo history as the pattern panel sees it: the first edit that changes a draft gives it to
   * the cell, as part of that edit. An edit that changes nothing leaves the cell empty.
   * @type {typeof edits}
   */
  const patternEdits = {
    ...edits,
    begin() {
      edits.begin()
      const target = draftTarget()
      claim = null
      if (!target) return
      block(target.id)[65] = barSpeed(sfx(), music(), target.bar) // the speed of the rest of the bar, as for a new pattern
      claim = { ...target, before: block(target.id).slice() }
    },
    commit() {
      const taken = claim
      claim = null
      if (taken) {
        const now = block(taken.id)
        if (now.every((v, i) => v === taken.before[i])) {
          edits.cancel()
          return false
        }
        setCell(music(), taken.bar, taken.channel, taken.id)
        draft = -1
      }
      return edits.commit()
    },
    cancel() {
      claim = null
      edits.cancel()
    },
    edit(change) {
      patternEdits.begin()
      change()
      return patternEdits.commit()
    },
  }

  /** Undo and redo, which can empty the selected cell again: then its blank pattern is offered again. @param {boolean} forward */
  function stepHistory(forward) {
    const { bar, channel } = cell()
    const had = cellSfx(music(), bar, channel) >= 0
    const done = forward ? edits.redo() : edits.undo()
    if (done && had && cellSfx(music(), bar, channel) < 0) offerDraft()
    return done
  }
  const undo = () => stepHistory(false)
  const redo = () => stepHistory(true)

  const isFocused = (/** @type {SoundFocus} */ which) => () => state.focus === which
  const pattern = createPatternPanel({ project, edits: patternEdits, sound, setInfo, onSelect: showInfo, isFocused: isFocused('pattern') })
  const song = createSongPanel({ project, edits, sound, setStatus, follow: (id) => pattern.select(id), onEmpty: offerDraft, onSelect: showInfo, isFocused: isFocused('song') })

  const undoButton = hints.hint(h('p8-button', { icon: 'undo', onclick: () => undo() }), 'Undo', 'undo')
  const redoButton = hints.hint(h('p8-button', { icon: 'redo', onclick: () => redo() }), 'Redo', 'redo')
  const bar = h('div', { class: 'tracker__bar' }, h('strong', { class: 'tracker__title' }, 'Sound'), h('span', { class: 'spacer' }), undoButton, redoButton)

  const el = h('div', { class: 'sound' }, bar, song.el, pattern.el)

  // ---- showing the data -------------------------------------------------------------------------
  /** Puts the readout of the panel that has the keyboard in the status bar. */
  function showInfo() {
    if (active) setInfo(state.focus === 'song' ? song.info() : pattern.info())
  }

  /** Shows the bytes in both panels. */
  function refresh() {
    song.refresh()
    pattern.refresh()
    undoButton.toggleAttribute('disabled', !edits.history.canUndo)
    redoButton.toggleAttribute('disabled', !edits.history.canRedo)
    showInfo()
  }

  /** @param {SoundFocus} focus */
  function setFocus(focus) {
    if (state.focus === focus) return
    state.focus = focus
    song.el.toggleAttribute('data-focus', focus === 'song')
    pattern.el.toggleAttribute('data-focus', focus === 'pattern')
    showInfo()
  }
  song.el.toggleAttribute('data-focus', true)

  // whichever panel was last used gets the keys
  for (const type of ['pointerdown', 'focusin', 'click']) {
    song.el.addEventListener(type, () => setFocus('song'), true)
    pattern.el.addEventListener(type, () => setFocus('pattern'), true)
  }

  /** Shows a sound effect in the pattern panel. @param {number} id */
  function select(id) {
    pattern.select(id)
  }

  // ---- the keyboard -----------------------------------------------------------------------------
  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.defaultPrevented) return
    const t = e.target
    // text fields keep their own undo
    if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /** @type {HTMLInputElement} */ (t).type !== 'checkbox'))) return
    const action = bindings.match(e, 'editor')
    if (action !== 'undo' && action !== 'redo') return
    e.preventDefault()
    if (action === 'redo') redo()
    else undo()
  }

  const unsubscribe = [
    project.on('rom:music', (/** @type {{ source?: unknown }} */ d) => {
      if (d?.source !== source) refresh()
    }),
    project.on('rom:sfx', (/** @type {{ source?: unknown }} */ d) => {
      if (d?.source !== source) refresh()
    }),
    project.on('load', () => {
      edits.clear()
      refresh()
      song.timeline.select(cell().bar, cell().channel)
    }),
  ]

  refresh()
  song.timeline.select(cell().bar, cell().channel)

  return {
    el,
    state,
    song,
    pattern,
    select,
    setFocus,
    undo: () => void undo(),
    redo: () => void redo(),
    activate() {
      active = true
      window.addEventListener('keydown', onKey)
      song.activate()
      pattern.activate()
      refresh()
    },
    deactivate() {
      active = false
      window.removeEventListener('keydown', onKey)
      song.deactivate()
      pattern.deactivate()
    },
    destroy() {
      window.removeEventListener('keydown', onKey)
      song.destroy()
      pattern.destroy()
      for (const off of unsubscribe) off()
      hints.destroy()
    },
  }
}
