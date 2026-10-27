import '../tracker.css'
import { clamp, h } from '../../dom.js'
import { createRoll } from './roll.js'
import { EFFECT_NAMES, NOTE_COUNT, SFX_COUNT, WAVE_NAMES, clearSfx, isSilent, noteName, readHeader, readNote, writeHeader, writeNote } from '../sfx/sfx-data.js'

/** @import { Note, SfxHeader } from '../sfx/sfx-data.js' */
/** @import { SoundService } from '../../audio.js' */
/** @import { createRegionEdits } from '../region-edits.js' */

/** @param {number} wave */
const waveName = (wave) => (wave < WAVE_NAMES.length ? WAVE_NAMES[wave] : `custom ${wave - WAVE_NAMES.length}`)

/** The number in a field, or null when it is empty or not a number. @param {HTMLInputElement} input */
const numberOf = (input) => {
  const value = input.value.trim() === '' ? NaN : Number(input.value)
  return Number.isFinite(value) ? Math.round(value) : null
}

/** @param {number} n */
const two = (n) => String(n).padStart(2, '0')

/**
 * @typedef {Object} PatternPanelOptions
 * @property {import('../../store.js').Project} project
 * @property {ReturnType<typeof createRegionEdits>} edits  the undo history the edits go through
 * @property {SoundService} [sound]  to hear the pattern; without it the panel is silent
 * @property {(info: string) => void} [setInfo]  for what is under the pointer in the roll
 * @property {() => void} [onSelect]  told when another sound effect is shown
 * @property {() => boolean} [isFocused]  whether the keyboard is for the panel; defaults to always
 *
 * @typedef {Object} PatternState
 * @property {number} sfx  the sound effect being edited
 * @property {'roll' | 'table'} view  how its notes are shown
 */

/**
 * The patterns (sound effects): a list of the 64, and the 32 notes of the chosen one, as a piano
 * roll or as rows of pitch, instrument, volume and effect, with its speed and loop points. With a
 * sound service the roll can be played, and edits are heard as they are made. The sound editor
 * around it owns the undo history and keeps the panel up to date with `refresh`.
 *
 * @param {PatternPanelOptions} options
 */
export function createPatternPanel({ project, edits, sound, setInfo, onSelect, isFocused }) {
  /** @type {PatternState} */
  const state = { sfx: 0, view: /** @type {'roll' | 'table'} */ ('roll') }
  let active = false
  const sfx = () => project.region('sfx')
  const roll = createRoll({ project, edits, getId: () => state.sfx, sound, setInfo, isFocused })

  // ---- the list ---------------------------------------------------------------------------------
  const listButtons = Array.from({ length: SFX_COUNT }, (_, id) =>
    h('button', { type: 'button', role: 'option', class: 'tracker__item', title: `sfx ${two(id)}`, onclick: () => select(id) }, two(id)),
  )
  const list = h('div', { class: 'tracker__list sunken', role: 'listbox', 'aria-label': 'sound effects' }, listButtons)

  // ---- the header -------------------------------------------------------------------------------
  /** @param {string} label @param {keyof SfxHeader} key @param {number} max */
  const headerField = (label, key, max) => {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: 0, max, step: 1, class: 'tracker__num', 'aria-label': label }))
    input.addEventListener('change', () => {
      const value = numberOf(input)
      if (value !== null) edits.edit(() => writeHeader(sfx(), state.sfx, { [key]: clamp(value, 0, max) }))
      refresh()
    })
    return { input, el: h('label', { class: 'tracker__field' }, label, input) }
  }
  const speed = headerField('Speed', 'speed', 255)
  const loopStart = headerField('Loop start', 'loopStart', NOTE_COUNT - 1)
  const loopEnd = headerField('Loop end', 'loopEnd', NOTE_COUNT)
  const title = h('strong', { class: 'tracker__title' })

  const viewButton = h('p8-button', { icon: 'grid', title: 'Piano roll or table of notes', variant: 'ghost', toggle: true, pressed: true })
  viewButton.addEventListener('change', (e) => setView(/** @type {CustomEvent} */ (e).detail.pressed ? 'roll' : 'table'))
  const clearButton = h('p8-button', { icon: 'trash', title: 'Clear the notes of this sound', onclick: () => edits.edit(() => clearSfx(sfx(), state.sfx)) }, 'Clear')

  // ---- the notes --------------------------------------------------------------------------------
  const rows = Array.from({ length: NOTE_COUNT }, (_, n) => {
    const pitch = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: 0, max: 63, step: 1, class: 'tracker__num', 'aria-label': `note ${n} pitch` }))
    const name = h('span', { class: 'tracker__note' })
    const wave = /** @type {HTMLSelectElement} */ (
      h('select', { class: 'tracker__select', 'aria-label': `note ${n} instrument` }, Array.from({ length: 16 }, (_, w) => h('option', { value: w }, `${w} ${waveName(w)}`)))
    )
    const vol = /** @type {HTMLInputElement} */ (h('input', { type: 'number', min: 0, max: 7, step: 1, class: 'tracker__num', 'aria-label': `note ${n} volume` }))
    const fx = /** @type {HTMLSelectElement} */ (
      h('select', { class: 'tracker__select', 'aria-label': `note ${n} effect` }, EFFECT_NAMES.map((label, i) => h('option', { value: i }, `${i} ${label}`)))
    )
    const el = h(
      'div',
      { class: 'tracker__row', role: 'row' },
      h('span', { class: 'tracker__index' }, two(n)),
      h('span', { class: 'tracker__cell' }, pitch, name),
      h('span', { class: 'tracker__cell' }, wave),
      h('span', { class: 'tracker__cell' }, vol),
      h('span', { class: 'tracker__cell' }, fx),
    )
    /** @param {Partial<Note>} change */
    const write = (change) => {
      edits.edit(() => {
        const note = readNote(sfx(), state.sfx, n)
        writeNote(sfx(), state.sfx, n, { ...note, ...change })
      })
      refresh()
    }
    pitch.addEventListener('change', () => write({ pitch: clamp(numberOf(pitch) ?? readNote(sfx(), state.sfx, n).pitch, 0, 63) }))
    vol.addEventListener('change', () => write({ vol: clamp(numberOf(vol) ?? readNote(sfx(), state.sfx, n).vol, 0, 7) }))
    wave.addEventListener('change', () => write({ wave: Number(wave.value) }))
    fx.addEventListener('change', () => write({ fx: Number(fx.value) }))
    return { el, pitch, name, wave, vol, fx }
  })

  const head = h(
    'div',
    { class: 'tracker__row tracker__row--head', 'aria-hidden': 'true' },
    h('span', { class: 'tracker__index' }, '#'),
    h('span', { class: 'tracker__cell' }, 'Pitch'),
    h('span', { class: 'tracker__cell' }, 'Instrument'),
    h('span', { class: 'tracker__cell' }, 'Vol'),
    h('span', { class: 'tracker__cell' }, 'Effect'),
  )
  const grid = h('div', { class: 'tracker__grid', role: 'table', 'aria-label': 'notes' }, head, rows.map((r) => r.el))

  const el = h(
    'div',
    { class: 'tracker sound__pattern' },
    list,
    h(
      'div',
      { class: 'tracker__main' },
      h('div', { class: 'tracker__bar' }, title, speed.el, loopStart.el, loopEnd.el, h('span', { class: 'spacer' }), viewButton, clearButton),
      roll.el,
      grid,
    ),
  )

  // ---- showing the data -------------------------------------------------------------------------
  /** Shows the bytes in the controls. */
  function refresh() {
    const data = sfx()
    const header = readHeader(data, state.sfx)
    title.textContent = `SFX ${two(state.sfx)}`
    speed.input.value = String(header.speed)
    loopStart.input.value = String(header.loopStart)
    loopEnd.input.value = String(header.loopEnd)
    rows.forEach((row, n) => {
      const note = readNote(data, state.sfx, n)
      row.pitch.value = String(note.pitch)
      row.name.textContent = noteName(note.pitch)
      row.wave.value = String(note.wave)
      row.vol.value = String(note.vol)
      row.fx.value = String(note.fx)
      row.el.dataset.silent = note.vol === 0 ? 'true' : 'false'
      const looping = header.loopEnd > header.loopStart
      row.el.dataset.loop = looping && n >= header.loopStart && n < header.loopEnd ? 'true' : 'false'
    })
    listButtons.forEach((button, id) => {
      button.dataset.silent = String(isSilent(data, id))
      button.setAttribute('aria-selected', String(id === state.sfx))
      button.toggleAttribute('data-selected', id === state.sfx)
    })
    roll.refresh()
  }

  /** What the status bar says about the pattern. */
  const info = () => `sfx ${two(state.sfx)}`

  /** @param {'roll' | 'table'} view */
  function setView(view) {
    state.view = view
    grid.hidden = view === 'roll'
    roll.el.hidden = view === 'table'
    viewButton.toggleAttribute('pressed', view === 'roll')
    if (!active) return
    if (view === 'roll') roll.activate()
    else roll.deactivate()
  }

  /** @param {number} id */
  function select(id) {
    state.sfx = clamp(Math.floor(id), 0, SFX_COUNT - 1)
    roll.select(null)
    refresh()
    onSelect?.()
  }

  setView('roll')
  refresh()

  return {
    el,
    state,
    select,
    setView,
    roll,
    refresh,
    info,
    activate() {
      active = true
      if (state.view === 'roll') roll.activate()
      refresh()
    },
    deactivate() {
      active = false
      roll.deactivate()
    },
    destroy() {
      roll.destroy()
    },
  }
}
