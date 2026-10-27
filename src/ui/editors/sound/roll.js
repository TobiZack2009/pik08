import './roll.css'
import '../tracker.css'
import { clamp, elemake } from '../../dom.js'
import { EFFECT_NAMES, WAVE_NAMES, noteName, readHeader, readNote } from '../sfx/sfx-data.js'
import {
  PITCHES,
  STEPS,
  applyToRange,
  clearLoop,
  clearRange,
  copyRange,
  eraseStep,
  gridPoint,
  laneHit,
  lanesLayout,
  layoutFor,
  loopSteps,
  normRange,
  pasteNotes,
  rangeHasNotes,
  rulerStep,
  sameNote,
  setLoopToRange,
  setNote,
  shiftRange,
  strokeSteps,
  transpose,
  ZOOMS,
  isEmptyNote,
} from './roll-ops.js'

/** @import { Note } from '../sfx/sfx-data.js' */
/** @import { SoundService } from '../../audio.js' */
/** @import { createRegionEdits } from '../region-edits.js' */

/** Palette index of the colour of each built-in instrument (custom ones reuse them, with a dot). */
const WAVE_COLORS = [12, 11, 10, 9, 8, 14, 6, 13]

/** @param {number} rgb */
const css = (rgb) => `#${rgb.toString(16).padStart(6, '0')}`

/** The black keys of an octave, as pitch classes. */
const BLACK = new Set([1, 3, 6, 8, 10])

/**
 * @typedef {'draw' | 'erase' | 'select'} RollTool
 *
 * @typedef {Object} RollState
 * @property {RollTool} tool
 * @property {number} zoom  index into the zoom levels
 * @property {{ wave: number, vol: number, fx: number }} brush  what a new note gets
 * @property {[number, number] | null} selection  first and last selected step
 */

/**
 * @typedef {Object} RollOptions
 * @property {import('../../store.js').Project} project
 * @property {ReturnType<typeof createRegionEdits>} edits  the undo history the edits go through
 * @property {() => number} getId  the sfx being edited
 * @property {SoundService} [sound]  to hear it; without it the roll is silent
 * @property {(info: string) => void} [setInfo]
 * @property {() => boolean} [isFocused]  whether the keyboard is for the roll; defaults to always
 */

/**
 * A piano roll for one sound effect: 32 steps across, 64 pitches down. Click or drag to draw
 * notes, drag over the ruler to select steps; under the grid, lanes show (and edit) the volume,
 * instrument and effect of each step. Edits go straight into the `sfx` region, so they are heard
 * at once if the sound is playing.
 *
 * @param {RollOptions} options
 */
export function createRoll({ project, edits, getId, sound, setInfo, isFocused }) {
  const palette = project.profile.display.palette
  /** @param {number} i @param {number} [fallback] */
  const color = (i, fallback = 0) => css(palette[i] ?? palette[fallback] ?? 0)
  const sfx = () => project.region('sfx')

  /** @type {RollState} */
  const state = { tool: 'draw', zoom: 1, brush: { wave: 0, vol: 5, fx: 0 }, selection: null }
  /** @type {Note[] | null} */
  let clipboard = null
  let active = false
  /** @type {number} */
  let frame = 0

  // ---- the canvases -----------------------------------------------------------------------------
  const ruler = /** @type {HTMLCanvasElement} */ (elemake('canvas', { class: 'roll__canvas roll__ruler' }))
  const grid = /** @type {HTMLCanvasElement} */ (elemake('canvas', { class: 'roll__canvas roll__grid' }))
  const lanes = /** @type {HTMLCanvasElement} */ (elemake('canvas', { class: 'roll__canvas roll__lanes' }))
  const selectionBox = elemake('div', { class: 'roll__selection', hidden: true })
  const playhead = elemake('div', { class: 'roll__playhead', hidden: true })
  const stage = elemake('div', { class: 'roll__stage' }, grid, selectionBox, playhead)
  const scroller = elemake('div', { class: 'roll__scroller sunken' }, stage)
  const board = elemake('div', { class: 'roll__board' }, elemake('div', { class: 'roll__column' }, ruler, scroller, lanes))

  /** The layout of the ruler; the grid's has no ruler of its own on top. */
  let rl = layoutFor(state.zoom)
  let gl = { ...rl, ruler: 0, height: rl.cellH * PITCHES }
  let ll = lanesLayout(rl)

  function applyZoom() {
    rl = layoutFor(state.zoom)
    gl = { ...rl, ruler: 0, height: rl.cellH * PITCHES }
    ll = lanesLayout(rl)
    ruler.width = rl.width
    ruler.height = rl.ruler
    grid.width = gl.width
    grid.height = gl.height
    lanes.width = ll.width
    lanes.height = ll.height
    for (const c of [ruler, grid, lanes]) c.style.width = `${c.width}px`
    for (const c of [ruler, grid, lanes]) c.style.height = `${c.height}px`
    zoomOut.toggleAttribute('disabled', state.zoom <= 0)
    zoomIn.toggleAttribute('disabled', state.zoom >= ZOOMS.length - 1)
  }

  /** @param {number} wave */
  const waveColor = (wave) => color(WAVE_COLORS[wave & 7])

  function paintRuler() {
    const g = ruler.getContext('2d')
    if (!g) return
    const { gutter, cellW, ruler: rh } = rl
    g.fillStyle = color(1)
    g.fillRect(0, 0, rl.width, rh)
    const loop = loopSteps(sfx(), getId())
    if (loop) {
      g.fillStyle = color(11)
      g.fillRect(gutter + loop[0] * cellW, rh - 3, (loop[1] - loop[0] + 1) * cellW, 3)
    }
    const sel = state.selection
    if (sel) {
      g.fillStyle = color(12)
      g.globalAlpha = 0.5
      g.fillRect(gutter + sel[0] * cellW, 0, (sel[1] - sel[0] + 1) * cellW, rh - 3)
      g.globalAlpha = 1
    }
    g.fillStyle = color(6)
    g.font = '8px monospace'
    g.textBaseline = 'top'
    for (let s = 0; s < STEPS; s += 4) g.fillText(String(s), gutter + s * cellW + 2, 1)
  }

  function paintGrid() {
    const g = grid.getContext('2d')
    if (!g) return
    const { gutter, cellW, cellH } = gl
    const data = sfx()
    const id = getId()
    // rows: a piano on the left, light and dark stripes across
    g.font = `${Math.max(6, Math.min(9, cellH - 1))}px monospace`
    g.textBaseline = 'middle'
    for (let row = 0; row < PITCHES; row++) {
      const pitch = PITCHES - 1 - row
      const black = BLACK.has(pitch % 12)
      const y = row * cellH
      g.fillStyle = color(black ? 17 : 0, 1)
      g.fillRect(gutter, y, gl.width - gutter, cellH)
      g.fillStyle = black ? color(0) : color(7)
      g.fillRect(0, y, gutter, cellH)
      g.fillStyle = color(5)
      g.fillRect(0, y + cellH - 1, gutter, 1)
      if (pitch % 12 === 0) {
        g.fillStyle = color(5)
        g.fillRect(gutter, y + cellH - 1, gl.width - gutter, 1)
        g.fillStyle = color(0)
        g.fillText(noteName(pitch), 2, y + cellH / 2)
      }
    }
    // steps: a line each, stronger on the beats
    for (let s = 0; s <= STEPS; s++) {
      g.fillStyle = s % 4 === 0 ? color(5) : color(1)
      g.fillRect(gutter + s * cellW - (s === STEPS ? 1 : 0), 0, 1, gl.height)
    }
    // the loop
    const loop = loopSteps(data, id)
    if (loop) {
      g.fillStyle = color(2)
      g.globalAlpha = 0.35
      g.fillRect(gutter + loop[0] * cellW, 0, (loop[1] - loop[0] + 1) * cellW, gl.height)
      g.globalAlpha = 1
    }
    // the notes
    for (let s = 0; s < STEPS; s++) {
      const n = readNote(data, id, s)
      if (isEmptyNote(n)) continue
      const x = gutter + s * cellW + 1
      const y = (PITCHES - 1 - n.pitch) * cellH
      const w = cellW - 1
      const hh = cellH - 1
      g.fillStyle = waveColor(n.wave)
      g.strokeStyle = g.fillStyle
      if (n.vol === 0) {
        g.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1)
        continue
      }
      g.globalAlpha = 0.4 + (0.6 * n.vol) / 7
      g.fillRect(x, y, w, hh)
      g.globalAlpha = 1
      g.fillStyle = color(7)
      if (n.wave >= 8) g.fillRect(x + 1, y + 1, 2, Math.min(2, hh - 1))
      if (n.fx > 0) g.fillRect(x + w - 3, y, 2, 1)
    }
  }

  function paintLanes() {
    const g = lanes.getContext('2d')
    if (!g) return
    const { gutter, cellW } = rl
    const data = sfx()
    const id = getId()
    g.fillStyle = color(1)
    g.fillRect(0, 0, ll.width, ll.height)
    g.fillStyle = color(0)
    for (const lane of [ll.vol, ll.wave, ll.fx]) g.fillRect(gutter, lane.y, ll.width - gutter, lane.h)
    g.font = '8px monospace'
    g.textBaseline = 'middle'
    g.fillStyle = color(6)
    g.fillText('vol', 2, ll.vol.y + ll.vol.h / 2)
    g.fillText('inst', 2, ll.wave.y + ll.wave.h / 2)
    g.fillText('fx', 2, ll.fx.y + ll.fx.h / 2)
    for (let s = 0; s < STEPS; s++) {
      const n = readNote(data, id, s)
      if (isEmptyNote(n)) continue
      const x = gutter + s * cellW
      const bar = Math.round((n.vol / 7) * (ll.vol.h - 2))
      g.fillStyle = waveColor(n.wave)
      g.fillRect(x + 1, ll.vol.y + ll.vol.h - bar, cellW - 1, bar)
      g.fillStyle = color(7)
      g.fillText(String(n.wave), x + 2, ll.wave.y + ll.wave.h / 2)
      g.fillStyle = n.fx ? color(7) : color(5)
      g.fillText(String(n.fx), x + 2, ll.fx.y + ll.fx.h / 2)
    }
  }

  function placeSelection() {
    const sel = state.selection
    selectionBox.hidden = !sel
    if (!sel) return
    selectionBox.style.left = `${gl.gutter + sel[0] * gl.cellW}px`
    selectionBox.style.width = `${(sel[1] - sel[0] + 1) * gl.cellW}px`
  }

  // ---- the toolbar ------------------------------------------------------------------------------
  /** @type {Map<RollTool, HTMLElement>} */
  const toolButtons = new Map()
  /** @param {RollTool} id @param {string} icon @param {string} title */
  const toolButton = (id, icon, title) => {
    const b = elemake('p8-button', { icon, title, variant: 'ghost', onclick: () => setTool(id) })
    toolButtons.set(id, b)
    return b
  }
  /** @param {string} icon @param {string} title @param {() => void} fn */
  const action = (icon, title, fn) => elemake('p8-button', { icon, title, variant: 'ghost', onclick: fn })

  const zoomOut = action('zoom-out', 'Narrower steps', () => setZoom(state.zoom - 1))
  const zoomIn = action('zoom-in', 'Wider steps', () => setZoom(state.zoom + 1))
  const playButton = action('play', 'Play or stop (Space)', () => togglePlay())

  const waveSelect = /** @type {HTMLSelectElement} */ (
    elemake(
      'select',
      { class: 'tracker__select', 'aria-label': 'instrument', title: 'Instrument of new notes' },
      Array.from({ length: 16 }, (_, w) => elemake('option', { value: w }, `${w} ${w < 8 ? WAVE_NAMES[w] : `custom ${w - 8}`}`)),
    )
  )
  const volInput = /** @type {HTMLInputElement} */ (elemake('input', { type: 'number', min: 0, max: 7, step: 1, class: 'tracker__num', 'aria-label': 'volume', title: 'Volume of new notes' }))
  const fxSelect = /** @type {HTMLSelectElement} */ (
    elemake('select', { class: 'tracker__select', 'aria-label': 'effect', title: 'Effect of new notes' }, EFFECT_NAMES.map((label, i) => elemake('option', { value: i }, `${i} ${label}`)))
  )

  const upButton = action('chevron-up', 'Selection up a semitone (Up, Shift: octave)', () => transposeSelection(1))
  const downButton = action('chevron-down', 'Selection down a semitone (Down, Shift: octave)', () => transposeSelection(-1))
  const copyButton = action('copy', 'Copy the selection (Ctrl+C)', () => copySelection())
  const pasteButton = action('paste', 'Paste (Ctrl+V)', () => pasteSelection())
  const deleteButton = action('trash', 'Delete the selected notes (Delete)', () => deleteSelection())
  const loopButton = action('repeat', 'Loop the selection', () => loopSelection())
  const unloopButton = action('x', 'Remove the loop', () => edit(() => clearLoop(sfx(), getId())))

  const bar = elemake(
    'div',
    { class: 'roll__bar' },
    toolButton('draw', 'pencil', 'Draw (D)'),
    toolButton('erase', 'eraser', 'Erase (E)'),
    toolButton('select', 'box-select', 'Select steps (S)'),
    elemake('div', { class: 'sep' }),
    waveSelect,
    volInput,
    fxSelect,
    elemake('div', { class: 'sep' }),
    upButton,
    downButton,
    copyButton,
    pasteButton,
    deleteButton,
    elemake('div', { class: 'sep' }),
    loopButton,
    unloopButton,
    elemake('span', { class: 'spacer' }),
    zoomOut,
    zoomIn,
    playButton,
  )

  /** @param {RollTool} tool */
  function setTool(tool) {
    state.tool = tool
    refreshControls()
  }

  /** @param {number} zoom */
  function setZoom(zoom) {
    state.zoom = clamp(zoom, 0, ZOOMS.length - 1)
    applyZoom()
    refresh()
  }

  waveSelect.addEventListener('change', () => brushChanged({ wave: Number(waveSelect.value) }))
  fxSelect.addEventListener('change', () => brushChanged({ fx: Number(fxSelect.value) }))
  volInput.addEventListener('change', () => {
    const v = volInput.value.trim() === '' ? NaN : Math.round(Number(volInput.value))
    brushChanged({ vol: Number.isFinite(v) ? clamp(v, 0, 7) : state.brush.vol })
  })

  /**
   * Changes what new notes get; the selected notes get it too.
   * @param {Partial<RollState['brush']>} change
   */
  function brushChanged(change) {
    Object.assign(state.brush, change)
    const range = state.selection
    if (range) edit(() => applyToRange(sfx(), getId(), range[0], range[1], change))
    else refreshControls()
  }

  // ---- showing the data -------------------------------------------------------------------------
  function refreshControls() {
    for (const [id, b] of toolButtons) b.toggleAttribute('pressed', id === state.tool)
    waveSelect.value = String(state.brush.wave)
    volInput.value = String(state.brush.vol)
    fxSelect.value = String(state.brush.fx)
    const range = state.selection
    const has = range ? rangeHasNotes(sfx(), getId(), range[0], range[1]) : false
    for (const b of [upButton, downButton, copyButton, deleteButton]) b.toggleAttribute('disabled', !has)
    loopButton.toggleAttribute('disabled', !range)
    pasteButton.toggleAttribute('disabled', !clipboard)
    const h2 = readHeader(sfx(), getId())
    unloopButton.toggleAttribute('disabled', h2.loopStart === 0 && h2.loopEnd === 0)
  }

  /** Redraws everything from the bytes. */
  function refresh() {
    paintRuler()
    paintGrid()
    paintLanes()
    placeSelection()
    refreshControls()
    tick()
  }

  /** @param {[number, number] | null} range */
  function setSelection(range) {
    state.selection = range
    paintRuler()
    placeSelection()
    refreshControls()
  }

  /**
   * Runs a change to the sfx as one undo step.
   * @param {() => boolean} change  returns whether it changed anything
   */
  function edit(change) {
    const done = edits.edit(() => void change())
    // the host refreshes after an edit; without a change nothing needs to be drawn
    if (!done) refreshControls()
    return done
  }

  // ---- playing ----------------------------------------------------------------------------------
  function togglePlay() {
    if (!sound) return
    if (sound.playing(getId())) sound.stop()
    else sound.play(getId())
    tick()
  }

  /** Moves the playhead to where the sound is. */
  function tick() {
    const pos = sound ? sound.position(getId()) : -1
    playhead.hidden = pos < 0
    if (pos >= 0) playhead.style.left = `${gl.gutter + pos * gl.cellW}px`
    playButton.setAttribute('icon', pos >= 0 ? 'stop' : 'play')
  }

  function loop() {
    tick()
    frame = requestAnimationFrame(loop)
  }

  /** Lets a note be heard as it is put down. @param {number} step */
  function audition(step) {
    sound?.play(getId(), step, 1)
  }

  // ---- the selection ----------------------------------------------------------------------------
  /** @param {number} delta */
  function transposeSelection(delta) {
    const range = state.selection
    if (range) edit(() => transpose(sfx(), getId(), range[0], range[1], delta))
  }

  function copySelection() {
    const range = state.selection
    if (range) clipboard = copyRange(sfx(), getId(), range[0], range[1])
    refreshControls()
  }

  function pasteSelection() {
    if (!clipboard) return
    const notes = clipboard
    const at = state.selection ? state.selection[0] : 0
    edit(() => pasteNotes(sfx(), getId(), at, notes))
    setSelection([at, Math.min(STEPS - 1, at + notes.length - 1)])
  }

  function deleteSelection() {
    const range = state.selection
    if (range) edit(() => clearRange(sfx(), getId(), range[0], range[1]))
  }

  function loopSelection() {
    const range = state.selection
    if (range) edit(() => setLoopToRange(sfx(), getId(), range[0], range[1]))
  }

  /** @param {number} delta */
  function shiftSelection(delta) {
    const range = state.selection
    if (!range) return
    /** @type {[number, number] | null} */
    let moved = null
    edit(() => {
      moved = shiftRange(sfx(), getId(), range[0], range[1], delta)
      return moved !== null
    })
    if (moved) setSelection(moved)
  }

  // ---- the pointer ------------------------------------------------------------------------------
  /**
   * A mouse position in the pixels of a canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {MouseEvent} e
   */
  function canvasPoint(canvas, e) {
    const r = canvas.getBoundingClientRect()
    const sx = r.width ? canvas.width / r.width : 1
    const sy = r.height ? canvas.height / r.height : 1
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }
  }

  /** @param {HTMLCanvasElement} canvas @param {PointerEvent} e */
  function capture(canvas, e) {
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // no capture: the drag then ends when the pointer leaves
    }
  }

  /**
   * @typedef {{ kind: 'paint', erase: boolean, last: { step: number, pitch: number }, heard: number }
   *   | { kind: 'select', from: number, moved: boolean }
   *   | { kind: 'lane', lane: import('./roll-ops.js').LaneName }} Drag
   */
  /** @type {Drag | null} */
  let drag = null

  // the grid: draw, erase, select
  grid.addEventListener('contextmenu', (e) => e.preventDefault())
  grid.addEventListener('pointerdown', (e) => {
    if (drag) return
    e.preventDefault()
    const { x, y } = canvasPoint(grid, e)
    const p = gridPoint(gl, x, y)
    if (e.button === 2) return pickAt(p)
    if (e.button !== 0 || !p) return
    capture(grid, /** @type {PointerEvent} */ (e))
    if (state.tool === 'select') {
      drag = { kind: 'select', from: p.step, moved: false }
      return setSelection([p.step, p.step])
    }
    const here = readNote(sfx(), getId(), p.step)
    // drawing on the very note that would be drawn takes it away again
    const erase = state.tool === 'erase' || sameNote(here, { pitch: p.pitch, ...state.brush })
    edits.begin()
    drag = { kind: 'paint', erase, last: p, heard: -1 }
    paintCells(drag, [p])
  })

  grid.addEventListener('pointermove', (e) => {
    const { x, y } = canvasPoint(grid, e)
    const at = gridPoint(gl, x, y)
    if (at && active) setInfo?.(`step ${at.step}  ${noteName(at.pitch)}`)
    if (!drag || drag.kind === 'lane') return
    const p = /** @type {{ step: number, pitch: number }} */ (gridPoint(gl, x, y, true))
    if (drag.kind === 'select') {
      drag.moved ||= p.step !== drag.from
      return setSelection(normRange(drag.from, p.step))
    }
    const from = drag.last
    drag.last = p
    paintCells(drag, strokeSteps(from, p))
  })

  /**
   * Puts down (or takes away) the notes of a stroke.
   * @param {Extract<Drag, { kind: 'paint' }>} d
   * @param {{ step: number, pitch: number }[]} cells
   */
  function paintCells(d, cells) {
    let changed = false
    for (const { step, pitch } of cells) {
      changed = (d.erase ? eraseStep(sfx(), getId(), step) : setNote(sfx(), getId(), step, { pitch, ...state.brush })) || changed
    }
    const last = cells[cells.length - 1]
    if (!d.erase && last.step !== d.heard) {
      d.heard = last.step
      audition(last.step)
    }
    if (changed) {
      paintGrid()
      paintLanes()
    }
  }

  /** The right button takes the instrument, volume and effect of the note under it. @param {{ step: number } | null} p */
  function pickAt(p) {
    if (!p) return
    const n = readNote(sfx(), getId(), p.step)
    if (isEmptyNote(n)) return
    state.brush = { wave: n.wave, vol: n.vol, fx: n.fx }
    refreshControls()
  }

  function endDrag() {
    const d = drag
    drag = null
    if (!d) return
    if (d.kind === 'select') {
      // a click without a drag drops the selection
      if (!d.moved) setSelection(null)
      return
    }
    // the host redraws after the commit
    if (!edits.commit()) refresh()
  }

  grid.addEventListener('pointerup', endDrag)
  grid.addEventListener('pointercancel', () => {
    const d = drag
    drag = null
    if (d && d.kind !== 'select') edits.cancel()
  })

  // the ruler: select steps
  ruler.addEventListener('pointerdown', (e) => {
    if (drag || e.button !== 0) return
    e.preventDefault()
    const { x, y } = canvasPoint(ruler, e)
    const step = rulerStep(rl, x, y)
    if (step === null) return
    capture(ruler, /** @type {PointerEvent} */ (e))
    drag = { kind: 'select', from: step, moved: true }
    setSelection([step, step])
  })
  ruler.addEventListener('pointermove', (e) => {
    if (drag?.kind !== 'select') return
    const { x } = canvasPoint(ruler, e)
    setSelection(normRange(drag.from, clamp(Math.floor((x - rl.gutter) / rl.cellW), 0, STEPS - 1)))
  })
  ruler.addEventListener('pointerup', () => {
    drag = null
  })
  ruler.addEventListener('pointercancel', () => {
    drag = null
  })

  // the lanes: volume, instrument and effect of the notes
  /**
   * The lane position under the pointer, with the pointer held inside the lane and the grid.
   * @param {MouseEvent} e
   * @param {import('./roll-ops.js').LaneName} lane
   */
  function laneAt(e, lane) {
    const { x, y } = canvasPoint(lanes, e)
    const band = ll[lane]
    const cx = clamp(x, rl.gutter, rl.gutter + rl.cellW * STEPS - 1)
    const cy = clamp(y, band.y, band.y + band.h - 1)
    return /** @type {NonNullable<ReturnType<typeof laneHit>>} */ (laneHit(rl, cx, cy))
  }

  /** @param {NonNullable<ReturnType<typeof laneHit>>} hit */
  function applyLane(hit) {
    const n = readNote(sfx(), getId(), hit.step)
    if (isEmptyNote(n)) return
    const value = hit.lane === 'vol' ? hit.value : hit.lane === 'wave' ? state.brush.wave : state.brush.fx
    const key = hit.lane === 'fx' ? 'fx' : hit.lane
    if (setNote(sfx(), getId(), hit.step, { ...n, [key]: value })) {
      paintGrid()
      paintLanes()
    }
  }

  lanes.addEventListener('pointerdown', (e) => {
    if (drag || e.button !== 0) return
    e.preventDefault()
    const { x, y } = canvasPoint(lanes, e)
    const hit = laneHit(rl, x, y)
    if (!hit) return
    capture(lanes, /** @type {PointerEvent} */ (e))
    edits.begin()
    drag = { kind: 'lane', lane: hit.lane }
    applyLane(hit)
  })
  lanes.addEventListener('pointermove', (e) => {
    if (drag?.kind === 'lane') applyLane(laneAt(e, drag.lane))
  })
  lanes.addEventListener('pointerup', () => {
    if (drag?.kind !== 'lane') return
    drag = null
    if (!edits.commit()) refresh()
  })
  lanes.addEventListener('pointercancel', () => {
    if (drag?.kind !== 'lane') return
    drag = null
    edits.cancel()
  })

  scroller.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return // plain wheel scrolls
      e.preventDefault()
      setZoom(state.zoom + (e.deltaY < 0 ? 1 : -1))
    },
    { passive: false },
  )

  // ---- the keyboard -----------------------------------------------------------------------------
  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.defaultPrevented || e.altKey || (isFocused && !isFocused())) return
    const t = e.target
    const key = e.key.toLowerCase()
    // fields keep their keys; a focused button keeps Space
    if (t instanceof HTMLElement && (t.isContentEditable || ['TEXTAREA', 'INPUT', 'SELECT'].includes(t.tagName) || (t.tagName === 'BUTTON' && key === ' '))) return
    if (e.ctrlKey || e.metaKey) {
      if (key === 'c') copySelection()
      else if (key === 'x') (copySelection(), deleteSelection())
      else if (key === 'v') pasteSelection()
      else if (key === 'a') setSelection([0, STEPS - 1])
      else return // undo and redo belong to the editor around the roll
      return e.preventDefault()
    }
    const octave = e.shiftKey ? 12 : 1
    const handled = /** @type {Record<string, (() => void) | undefined>} */ ({
      ' ': () => togglePlay(),
      arrowup: () => transposeSelection(octave),
      arrowdown: () => transposeSelection(-octave),
      arrowleft: () => shiftSelection(-1),
      arrowright: () => shiftSelection(1),
      delete: () => deleteSelection(),
      backspace: () => deleteSelection(),
      escape: () => setSelection(null),
      d: () => setTool('draw'),
      e: () => setTool('erase'),
      s: () => setTool('select'),
    })[key]
    if (!handled) return
    if (!state.selection && /^arrow|delete|backspace/.test(key)) return
    e.preventDefault()
    handled()
  }

  const el = elemake('div', { class: 'roll' }, bar, board)
  applyZoom()
  refresh()

  return {
    el,
    state,
    refresh,
    tick,
    /** Selects some steps (or none). @param {[number, number] | null} range */
    select(range) {
      setSelection(range && normRange(range[0], range[1]))
    },
    setTool,
    setZoom,
    activate() {
      active = true
      window.addEventListener('keydown', onKey)
      if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(loop)
      refresh()
    },
    deactivate() {
      active = false
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
