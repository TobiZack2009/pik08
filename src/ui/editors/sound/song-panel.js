import '../tracker.css'
import { clamp, elemake } from '../../dom.js'
import { createTimeline } from './timeline.js'
import { CHANNELS, PATTERN_COUNT, isUsed, readPattern, writePattern } from '../music/music-data.js'

/** @import { Pattern } from '../music/music-data.js' */
/** @import { SoundService } from '../../audio.js' */
/** @import { createRegionEdits } from '../region-edits.js' */

/** @param {number} n */
const two = (n) => String(n).padStart(2, '0')

const FLAGS = /** @type {const} */ ([
  ['loopStart', 'loop start'],
  ['loopBack', 'loop back'],
  ['stop', 'stop'],
])

/**
 * @typedef {Object} SongPanelOptions
 * @property {import('../../store.js').Project} project
 * @property {ReturnType<typeof createRegionEdits>} edits  the undo history the edits go through; it must cover `sfx` and `music`
 * @property {SoundService} [sound]  to hear the song; without it the panel is silent
 * @property {(message: string) => void} [setStatus]
 * @property {(sfx: number) => void} [follow]  told the pattern of the selected cell when it changes
 * @property {() => void} [onEmpty]  told when the selected cell has no pattern
 * @property {() => void} [onSelect]  told after another cell is selected
 * @property {() => boolean} [isFocused]  whether the keyboard is for the panel; defaults to always
 */

/**
 * The song: a timeline of the 64 bars, or a table with a row for each. Each bar names a sound effect
 * (pattern) for each of the 4 channels, or switches the channel off, and may start a loop, loop back
 * or stop. With a sound service the song can be played. The sound editor around it owns the undo
 * history, which covers the `sfx` region too (making a pattern writes a sound effect), and keeps
 * the panel up to date with `refresh`.
 *
 * @param {SongPanelOptions} options
 */
export function createSongPanel({ project, edits, sound, setStatus, follow, onEmpty, onSelect, isFocused }) {
  const state = { view: /** @type {'timeline' | 'table'} */ ('timeline') }
  let active = false
  const music = () => project.region('music')
  const timeline = createTimeline({ project, edits, sound, setStatus, follow, onEmpty, onSelect, isFocused })

  const viewButton = elemake('p8-button', { icon: 'grid', title: 'Timeline or table of patterns', variant: 'ghost', toggle: true, pressed: true })
  viewButton.addEventListener('change', (e) => setView(/** @type {CustomEvent} */ (e).detail.pressed ? 'timeline' : 'table'))

  const clearButton = elemake(
    'p8-button',
    {
      icon: 'trash',
      title: 'Clear all patterns',
      onclick: () => edits.edit(() => music().fill(0x40)),
    },
    'Clear',
  )

  const rows = Array.from({ length: PATTERN_COUNT }, (_, id) => {
    /** @param {Partial<Pattern>} change */
    const write = (change) => {
      edits.edit(() => writePattern(music(), id, { ...readPattern(music(), id), ...change }))
      refresh()
    }

    const channels = Array.from({ length: CHANNELS }, (_, c) => {
      const enabled = /** @type {HTMLInputElement} */ (elemake('input', { type: 'checkbox', 'aria-label': `pattern ${id} channel ${c} on` }))
      const sfx = /** @type {HTMLInputElement} */ (
        elemake('input', { type: 'number', min: 0, max: 63, step: 1, class: 'tracker__num', 'aria-label': `pattern ${id} channel ${c} sfx` })
      )
      const update = () => {
        const pattern = readPattern(music(), id)
        const value = sfx.value.trim() === '' ? NaN : Number(sfx.value)
        pattern.channels[c] = {
          enabled: enabled.checked,
          sfx: Number.isFinite(value) ? clamp(Math.round(value), 0, 63) : pattern.channels[c].sfx,
        }
        write({ channels: pattern.channels })
      }
      enabled.addEventListener('change', update)
      sfx.addEventListener('change', update)
      return { enabled, sfx, el: elemake('span', { class: 'tracker__cell' }, enabled, sfx) }
    })

    const flags = FLAGS.map(([key, label]) => {
      const box = /** @type {HTMLInputElement} */ (elemake('input', { type: 'checkbox', 'aria-label': `pattern ${id} ${label}` }))
      box.addEventListener('change', () => write({ [key]: box.checked }))
      return { key, box, el: elemake('label', { class: 'tracker__flag', title: label }, box, label) }
    })

    const el = elemake(
      'div',
      { class: 'tracker__row', role: 'row' },
      elemake('span', { class: 'tracker__index' }, two(id)),
      ...channels.map((c) => c.el),
      ...flags.map((f) => f.el),
    )
    return { el, channels, flags }
  })

  const head = elemake(
    'div',
    { class: 'tracker__row tracker__row--head', 'aria-hidden': 'true' },
    elemake('span', { class: 'tracker__index' }, '#'),
    ...Array.from({ length: CHANNELS }, (_, c) => elemake('span', { class: 'tracker__cell' }, `Ch ${c + 1}`)),
    ...FLAGS.map(([, label]) => elemake('span', { class: 'tracker__flag' }, label)),
  )
  const grid = elemake('div', { class: 'tracker__grid', role: 'table', 'aria-label': 'patterns' }, head, rows.map((r) => r.el))

  const el = elemake(
    'div',
    { class: 'sound__song' },
    elemake('div', { class: 'tracker__bar' }, elemake('strong', { class: 'tracker__title' }, 'Song'), elemake('span', { class: 'spacer' }), viewButton, clearButton),
    timeline.el,
    grid,
  )

  // ---- showing the data -------------------------------------------------------------------------
  /** Shows the bytes in the controls. */
  function refresh() {
    const data = music()
    let used = 0
    rows.forEach((row, id) => {
      const pattern = readPattern(data, id)
      pattern.channels.forEach((channel, c) => {
        row.channels[c].enabled.checked = channel.enabled
        row.channels[c].sfx.value = String(channel.sfx)
      })
      for (const flag of row.flags) flag.box.checked = pattern[flag.key]
      row.el.dataset.used = String(isUsed(pattern))
      if (isUsed(pattern)) used++
    })
    timeline.refresh()
  }

  /** What the status bar says about the song. */
  function info() {
    if (state.view === 'timeline') return timeline.info()
    const data = music()
    const used = Array.from({ length: PATTERN_COUNT }, (_, id) => readPattern(data, id)).filter(isUsed).length
    return `${used} of ${PATTERN_COUNT} patterns used`
  }

  /** @param {'timeline' | 'table'} view */
  function setView(view) {
    state.view = view
    grid.hidden = view === 'timeline'
    timeline.el.hidden = view === 'table'
    viewButton.toggleAttribute('pressed', view === 'timeline')
    if (!active) return
    if (view === 'timeline') timeline.activate()
    else timeline.deactivate()
  }

  setView('timeline')
  refresh()

  return {
    el,
    state,
    setView,
    timeline,
    refresh,
    info,
    activate() {
      active = true
      if (state.view === 'timeline') timeline.activate()
      refresh()
    },
    deactivate() {
      active = false
      timeline.deactivate()
    },
    destroy() {
      timeline.destroy()
    },
  }
}
