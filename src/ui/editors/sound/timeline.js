import './timeline.css'
import '../tracker.css'
import { clamp, h } from '../../dom.js'
import { readPattern } from '../music/music-data.js'
import {
  BAR_COUNT,
  CHANNELS,
  barSeconds,
  cellSfx,
  duplicateAfter,
  insertBar,
  loopRanges,
  makeUnique,
  newPattern,
  removeBar,
  setCell,
  setFlag,
  usage,
} from './song.js'

/** @import { SoundService } from '../../audio.js' */
/** @import { createRegionEdits } from '../region-edits.js' */

/** Width of the channel labels and of a bar, and the height of a row, in pixels. */
const LABEL_W = 36
const CELL_W = 40
const CELL_H = 28

/** Palette index of the colour of a pattern: the sfx number picks one of eight. */
const PATTERN_COLORS = [8, 9, 10, 11, 12, 13, 14, 15]

/** The flags of a bar: icon, name for the ruler, and what the toolbar button says and explains. */
const FLAGS = /** @type {const} */ ([
  { key: 'loopStart', icon: 'arrow-right-from-line', name: 'loop start', label: 'Loop start', title: 'The song loops from this bar' },
  { key: 'loopBack', icon: 'repeat', name: 'loop back', label: 'Loop back', title: 'The song loops back at this bar' },
  { key: 'stop', icon: 'octagon-x', name: 'stop', label: 'Stop', title: 'The song stops after this bar' },
])

/** @param {number} rgb */
const css = (rgb) => `#${rgb.toString(16).padStart(6, '0')}`

/** @param {number} n */
const two = (n) => String(n).padStart(2, '0')

/**
 * @typedef {Object} TimelineOptions
 * @property {import('../../store.js').Project} project
 * @property {ReturnType<typeof createRegionEdits>} edits  the undo history the edits go through; it must cover `sfx` and `music`
 * @property {SoundService} [sound]  to hear the song; without it the timeline is silent
 * @property {(message: string) => void} [setStatus]
 * @property {(sfx: number) => void} [follow]  told the pattern of the selected cell when it changes, so that it can be shown for editing
 * @property {() => void} [onEmpty]  told when the selected cell has no pattern (it was selected or emptied), so that a blank one can be offered
 * @property {() => void} [onSelect]  told after another cell is selected
 * @property {() => boolean} [isFocused]  whether the keyboard is for the timeline; defaults to always
 *
 * @typedef {Object} TimelineState
 * @property {{ bar: number, channel: number }} cell  the selected cell
 */

/**
 * The song as a timeline: a row for each of the 4 channels and a column for each of the 64 bars,
 * each cell naming the pattern (sfx) that plays there. Patterns are coloured by number, so a
 * pattern that is used more than once is easy to see, and cells that share one are marked. A
 * toolbar edits the selected cell and bar; the song can be played from the selected bar.
 * `info()` describes the selected cell for the status bar.
 *
 * @param {TimelineOptions} options
 */
export function createTimeline({ project, edits, sound, setStatus, follow, onEmpty, onSelect, isFocused }) {
  const palette = project.profile.display.palette
  const color = (/** @type {number} */ i) => css(palette[i] ?? 0)
  const music = () => project.region('music')
  const sfx = () => project.region('sfx')

  /** @type {TimelineState} */
  const state = { cell: { bar: 0, channel: 0 } }
  /** @type {number | null} */
  let clipboard = null
  let playing = -1
  let frame = 0

  // ---- the grid ---------------------------------------------------------------------------------
  const corner = h('div', { class: 'timeline__corner' })
  const rulerCells = Array.from({ length: BAR_COUNT }, (_, bar) => {
    const flags = h('span', { class: 'timeline__flags' })
    const el = h('div', { class: 'timeline__ruler', 'data-bar': bar }, h('span', { class: 'timeline__bar-no' }, String(bar)), flags)
    return { el, flags }
  })
  const cells = Array.from({ length: CHANNELS }, (_, channel) =>
    Array.from({ length: BAR_COUNT }, (_, bar) =>
      h('button', {
        type: 'button',
        class: 'timeline__cell',
        tabindex: -1,
        'data-bar': bar,
        'data-channel': channel,
        'aria-label': `bar ${bar} channel ${channel + 1}`,
      }),
    ),
  )
  const labels = Array.from({ length: CHANNELS }, (_, c) => h('div', { class: 'timeline__label' }, `Ch ${c + 1}`))

  // the selected cell is edited in place: a number, and arrows to step it by one
  const patternInput = /** @type {HTMLInputElement} */ (
    h('input', { type: 'number', min: 0, max: 63, step: 1, class: 'timeline__number', 'aria-label': 'pattern of the cell', title: 'Pattern (sfx) of the selected cell; empty for none' })
  )
  /** @param {string} icon @param {string} title @param {number} by */
  const stepButton = (icon, title, by) => {
    const b = h('button', { type: 'button', class: 'timeline__step', tabindex: -1, title, 'aria-label': title, onclick: () => step(by) }, h('p8-icon', { name: icon, size: 10 }))
    // keep the focus where it is, so that clicking an arrow does not swallow the keys
    b.addEventListener('mousedown', (e) => e.preventDefault())
    return b
  }
  const editor = h('div', { class: 'timeline__editor' }, patternInput, h('div', { class: 'timeline__steps' }, stepButton('chevron-up', 'Next pattern number', 1), stepButton('chevron-down', 'Previous pattern number (empty below 0)', -1)))
  patternInput.addEventListener('change', commitInput)
  patternInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      commitInput()
      step(e.key === 'ArrowUp' ? 1 : -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commitInput()
      patternInput.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      refresh()
      patternInput.blur()
    }
  })

  const grid = h(
    'div',
    { class: 'timeline__grid', role: 'grid', 'aria-label': 'song' },
    corner,
    ...rulerCells.map((r) => r.el),
    ...cells.flatMap((row, c) => [labels[c], ...row]),
    // last, so that it is drawn over the cell it edits
    editor,
  )
  grid.style.setProperty('--timeline-label-w', `${LABEL_W}px`)
  grid.style.setProperty('--timeline-cell-w', `${CELL_W}px`)
  grid.style.setProperty('--timeline-cell-h', `${CELL_H}px`)
  const scroller = h('div', { class: 'timeline__scroller sunken' }, grid)

  // ---- the toolbar ------------------------------------------------------------------------------
  /** @param {string} icon @param {string} title @param {() => void} fn @param {string} [label] */
  const action = (icon, title, fn, label) => h('p8-button', { icon, title, variant: 'ghost', onclick: fn }, label)

  const newButton = action('plus', 'New empty pattern in this cell (Enter)', () => newInCell(), 'New')
  const uniqueButton = action('layers', 'Give this cell its own copy of a shared pattern', () => uniqueCell(), 'Unique')
  const clearButton = action('x', 'Empty this cell (Delete)', () => clearCell())

  const insertButton = action('skip-forward', 'Insert an empty bar here', () => insertAtBar(), 'Insert')
  const removeButton = action('minus', 'Remove this bar; the later ones move up', () => removeAtBar(), 'Remove')
  const copyBarButton = action('copy', 'Repeat this bar after itself, sharing its patterns', () => repeatBar(false), 'Repeat')
  const copyBarUniqueButton = action('stamp', 'Repeat this bar after itself, with its own copies of the patterns', () => repeatBar(true), 'Repeat unique')

  /** @type {Map<'loopStart' | 'loopBack' | 'stop', HTMLElement>} */
  const flagButtons = new Map()
  for (const { key, icon, title, label } of FLAGS) {
    const b = h('p8-button', { icon, title, variant: 'ghost', toggle: true }, label)
    b.addEventListener('change', (e) => {
      const on = /** @type {CustomEvent} */ (e).detail.pressed
      edit(() => setFlag(music(), state.cell.bar, key, on))
    })
    flagButtons.set(key, b)
  }

  const playButton = action('play', 'Play the song from this bar, or stop (Space)', () => togglePlay())
  if (!sound) playButton.setAttribute('disabled', '')

  const bar = h(
    'div',
    { class: 'timeline__bar' },
    newButton,
    uniqueButton,
    clearButton,
    h('div', { class: 'sep' }),
    insertButton,
    removeButton,
    copyBarButton,
    copyBarUniqueButton,
    h('div', { class: 'sep' }),
    ...flagButtons.values(),
    h('span', { class: 'spacer' }),
    playButton,
  )

  // ---- editing ----------------------------------------------------------------------------------
  /**
   * Runs a change to the song as one undo step.
   * @param {() => void} change
   */
  function edit(change) {
    const { bar, channel } = state.cell
    const before = cellSfx(music(), bar, channel)
    edits.edit(change)
    refresh()
    const after = cellSfx(music(), bar, channel)
    if (after >= 0 && after !== before) follow?.(after)
    else if (after < 0 && before >= 0) onEmpty?.()
  }

  /** Sets the cell to the number in the field; an empty field empties it. */
  function commitInput() {
    const { bar, channel } = state.cell
    const value = patternInput.value.trim() === '' ? NaN : Number(patternInput.value)
    const id = Number.isFinite(value) ? clamp(Math.round(value), 0, 63) : -1
    if (id === cellSfx(music(), bar, channel)) return refresh()
    edit(() => setCell(music(), bar, channel, id))
  }

  /** Steps the pattern of the cell; below 0 is empty. @param {number} by */
  function step(by) {
    const { bar, channel } = state.cell
    const now = cellSfx(music(), bar, channel)
    const id = clamp(now + by, -1, 63)
    if (id !== now) edit(() => setCell(music(), bar, channel, id))
  }

  function newInCell() {
    const { bar, channel } = state.cell
    if (cellSfx(music(), bar, channel) >= 0) return
    let made = 0
    edit(() => {
      made = newPattern(sfx(), music(), bar, channel)
    })
    if (made < 0) setStatus?.('there is no free sfx left for a new pattern')
  }

  function uniqueCell() {
    const { bar, channel } = state.cell
    const id = cellSfx(music(), bar, channel)
    if (id < 0) return
    if (usage(music())[id].length <= 1) return setStatus?.('this pattern is not shared')
    let made = 0
    edit(() => {
      made = makeUnique(sfx(), music(), bar, channel)
    })
    if (made < 0) setStatus?.('there is no free sfx left for a copy')
  }

  function clearCell() {
    const { bar, channel } = state.cell
    if (cellSfx(music(), bar, channel) >= 0) edit(() => setCell(music(), bar, channel, -1))
  }

  function insertAtBar() {
    let done = false
    edit(() => {
      done = insertBar(music(), state.cell.bar)
    })
    if (!done) setStatus?.('the song is full: the last bar is in use')
  }

  function removeAtBar() {
    edit(() => removeBar(music(), state.cell.bar))
  }

  /** @param {boolean} unique */
  function repeatBar(unique) {
    const at = state.cell.bar
    let done = false
    edit(() => {
      done = duplicateAfter(sfx(), music(), at, unique)
    })
    if (!done) {
      setStatus?.(at + 1 >= BAR_COUNT || cellsInUse(BAR_COUNT - 1) ? 'the song is full: the last bar is in use' : 'there are not enough free sfx for the copies')
      return
    }
    select(at + 1, state.cell.channel)
  }

  /** @param {number} b */
  const cellsInUse = (b) => [0, 1, 2, 3].some((c) => cellSfx(music(), b, c) >= 0)

  // ---- playing ----------------------------------------------------------------------------------
  function togglePlay() {
    if (!sound) return
    if (sound.musicBar() >= 0) sound.stop()
    else sound.playMusic(state.cell.bar)
    tick()
  }

  /** Marks the bar that plays, and follows it. */
  function tick() {
    const now = sound ? sound.musicBar() : -1
    if (now === playing) return
    if (playing >= 0) markColumn(playing, false)
    playing = now
    if (now >= 0) {
      markColumn(now, true)
      reveal(now)
    }
    playButton.setAttribute('icon', now >= 0 ? 'stop' : 'play')
  }

  /** @param {number} b @param {boolean} on */
  function markColumn(b, on) {
    rulerCells[b].el.toggleAttribute('data-playing', on)
    for (let c = 0; c < CHANNELS; c++) cells[c][b].toggleAttribute('data-playing', on)
  }

  function loop() {
    tick()
    frame = requestAnimationFrame(loop)
  }

  /** Scrolls so that a bar is in view. @param {number} b */
  function reveal(b) {
    const width = scroller.clientWidth
    if (!width) return
    const x = LABEL_W + b * CELL_W
    if (x < scroller.scrollLeft + LABEL_W) scroller.scrollLeft = b * CELL_W
    else if (x + CELL_W > scroller.scrollLeft + width) scroller.scrollLeft = x + CELL_W - width
  }

  // ---- the selection ----------------------------------------------------------------------------
  /** @param {number} b @param {number} channel */
  function select(b, channel = state.cell.channel) {
    state.cell = { bar: clamp(Math.floor(b), 0, BAR_COUNT - 1), channel: clamp(Math.floor(channel), 0, CHANNELS - 1) }
    reveal(state.cell.bar)
    refresh()
    const id = cellSfx(music(), state.cell.bar, state.cell.channel)
    if (id >= 0) follow?.(id)
    else onEmpty?.()
    onSelect?.()
  }

  grid.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('[data-bar]') : null)
    if (!target) return
    const b = Number(target.dataset.bar)
    select(b, target.dataset.channel === undefined ? state.cell.channel : Number(target.dataset.channel))
  })

  // ---- showing the data -------------------------------------------------------------------------
  /** Shows the bytes in the cells. */
  function refresh() {
    const data = music()
    const users = usage(data)
    const inLoop = new Set()
    for (const { from, to } of loopRanges(data)) for (let b = from; b <= to; b++) inLoop.add(b)

    for (let b = 0; b < BAR_COUNT; b++) {
      const pattern = readPattern(data, b)
      const ruler = rulerCells[b]
      const set = FLAGS.filter(({ key }) => pattern[key])
      const names = set.map(({ name }) => name).join(', ')
      if (ruler.flags.dataset.flags !== names) {
        ruler.flags.dataset.flags = names
        ruler.flags.replaceChildren(...set.map(({ icon }) => h('p8-icon', { name: icon, size: 11 })))
      }
      ruler.el.title = names
      ruler.el.toggleAttribute('data-loop', inLoop.has(b))
      ruler.el.toggleAttribute('data-selected', b === state.cell.bar)
      for (let c = 0; c < CHANNELS; c++) {
        const cell = cells[c][b]
        const id = cellSfx(data, b, c)
        cell.textContent = id >= 0 ? String(id) : ''
        cell.style.background = id >= 0 ? color(PATTERN_COLORS[id % PATTERN_COLORS.length]) : ''
        cell.toggleAttribute('data-empty', id < 0)
        cell.toggleAttribute('data-shared', id >= 0 && users[id].length > 1)
        cell.toggleAttribute('data-loop', inLoop.has(b))
        const selected = b === state.cell.bar && c === state.cell.channel
        cell.toggleAttribute('data-selected', selected)
        cell.setAttribute('aria-selected', String(selected))
      }
    }
    for (let c = 0; c < CHANNELS; c++) labels[c].toggleAttribute('data-selected', c === state.cell.channel)

    const { bar: b, channel } = state.cell
    const id = cellSfx(data, b, channel)
    const pattern = readPattern(data, b)
    patternInput.value = id >= 0 ? String(id) : ''
    editor.style.left = `${LABEL_W + b * CELL_W}px`
    editor.style.top = `${(channel + 1) * CELL_H}px`
    editor.style.background = id >= 0 ? color(PATTERN_COLORS[id % PATTERN_COLORS.length]) : ''
    editor.toggleAttribute('data-empty', id < 0)
    const shared = id >= 0 && users[id].length > 1
    uniqueButton.toggleAttribute('disabled', !shared)
    clearButton.toggleAttribute('disabled', id < 0)
    newButton.toggleAttribute('disabled', id >= 0)
    for (const [key, button] of flagButtons) button.toggleAttribute('pressed', pattern[key])
  }

  /** Describes the selected cell: where it is, its pattern and how long its bar lasts. */
  function info() {
    const data = music()
    const { bar: b, channel } = state.cell
    const id = cellSfx(data, b, channel)
    const count = id >= 0 ? usage(data)[id].length : 0
    const seconds = barSeconds(sfx(), data, b)
    const parts = [`bar ${two(b)}`, `ch ${channel + 1}`, id >= 0 ? `sfx ${two(id)}${count > 1 ? ` (shared by ${count} cells)` : ''}` : 'empty']
    if (seconds > 0) parts.push(`${seconds.toFixed(1)} s`)
    return parts.join(' · ')
  }

  // ---- the keyboard -----------------------------------------------------------------------------
  function copyCell() {
    const id = cellSfx(music(), state.cell.bar, state.cell.channel)
    if (id >= 0) clipboard = id
  }

  function pasteCell() {
    if (clipboard === null) return
    const id = clipboard
    const { bar, channel } = state.cell
    edit(() => setCell(music(), bar, channel, id))
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.defaultPrevented || e.altKey || (isFocused && !isFocused())) return
    const t = e.target
    const key = e.key.toLowerCase()
    // fields keep their keys; a focused toolbar button keeps Space and Enter
    if (t instanceof HTMLElement && !t.classList.contains('timeline__cell')) {
      if (t.isContentEditable || ['TEXTAREA', 'INPUT', 'SELECT'].includes(t.tagName)) return
      if (t.tagName === 'BUTTON' && (key === ' ' || key === 'enter')) return
    }
    if (e.ctrlKey || e.metaKey) {
      if (key === 'c') copyCell()
      else if (key === 'v') pasteCell()
      else return // undo and redo belong to the editor around the timeline
      return e.preventDefault()
    }
    const { bar, channel } = state.cell
    if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      // typing a number goes to the field of the cell, replacing what it shows
      patternInput.focus()
      patternInput.select()
      return
    }
    const handled = /** @type {Record<string, (() => void) | undefined>} */ ({
      arrowleft: () => select(bar - 1),
      arrowright: () => select(bar + 1),
      arrowup: () => select(bar, channel - 1),
      arrowdown: () => select(bar, channel + 1),
      delete: () => clearCell(),
      backspace: () => clearCell(),
      enter: () => newInCell(),
      ' ': () => togglePlay(),
    })[key]
    if (!handled) return
    e.preventDefault()
    handled()
  }

  const el = h('div', { class: 'timeline' }, bar, scroller)
  refresh()

  return {
    el,
    state,
    refresh,
    info,
    tick,
    select,
    activate() {
      window.addEventListener('keydown', onKey)
      if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(loop)
      refresh()
    },
    deactivate() {
      window.removeEventListener('keydown', onKey)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      sound?.stop()
      tick()
    },
    destroy() {
      window.removeEventListener('keydown', onKey)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}
