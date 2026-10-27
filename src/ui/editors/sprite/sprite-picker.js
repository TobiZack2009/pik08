import './sprite-picker.css'
import { paintIndexed } from '../../../player/renderer.js'
import { clamp, h } from '../../dom.js'
import { SHEET_SIZE } from './raster.js'
import { SHEET_COLS, clampSelection, dragSelection, sheetIndices } from './sprite-ops.js'

/** @import { Project } from '../../store.js' */
/** @import { SpriteSelection } from './sprite-ops.js' */

/**
 * @typedef {Object} SpritePickerOptions
 * @property {Project} project
 * @property {SpriteSelection} selection
 * @property {(selection: SpriteSelection) => void} [onSelect]  the user dragged out a new selection
 * @property {number} [max]  most sprites per side (default 8)
 */

/**
 * The sprite sheet as a picture you can drag a selection over. Used by the sprite editor to choose
 * what to edit and by the map editor to choose tiles. It repaints itself when the sheet changes.
 *
 * @param {SpritePickerOptions} options
 */
export function createSpritePicker({ project, selection, onSelect, max = 8 }) {
  let sel = clampSelection(selection, max)
  const canvas = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'pixel sprite-picker__sheet', width: SHEET_SIZE, height: SHEET_SIZE }))
  const marker = h('div', { class: 'sprite-picker__marker' })
  const el = h('div', { class: 'sprite-picker', role: 'group', 'aria-label': 'Sprite sheet' }, canvas, marker)

  function place() {
    const cell = 100 / SHEET_COLS
    marker.style.left = `${sel.col * cell}%`
    marker.style.top = `${sel.row * cell}%`
    marker.style.width = `${sel.w * cell}%`
    marker.style.height = `${sel.h * cell}%`
  }

  function refresh() {
    paintIndexed(canvas, sheetIndices(project.region('gfx')), project.profile.display.palette)
  }

  /** @param {PointerEvent | MouseEvent} e  @returns {[number, number]} */
  function cellAt(e) {
    const r = canvas.getBoundingClientRect()
    const col = Math.floor(((e.clientX - r.left) / r.width) * SHEET_COLS) || 0
    const row = Math.floor(((e.clientY - r.top) / r.height) * SHEET_COLS) || 0
    return [clamp(col, 0, SHEET_COLS - 1), clamp(row, 0, SHEET_COLS - 1)]
  }

  /** @param {SpriteSelection} next */
  function choose(next) {
    if (next.col === sel.col && next.row === sel.row && next.w === sel.w && next.h === sel.h) return
    sel = next
    place()
    onSelect?.(sel)
  }

  /** @type {[number, number] | null} */
  let anchor = null
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // no capture: the drag then ends when the pointer leaves the sheet
    }
    anchor = cellAt(e)
    choose(dragSelection(anchor[0], anchor[1], anchor[0], anchor[1], max))
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!anchor) return
    const [col, row] = cellAt(e)
    choose(dragSelection(anchor[0], anchor[1], col, row, max))
  })
  const end = () => (anchor = null)
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)

  const unsubscribe = [project.on('rom:gfx', refresh), project.on('load', refresh)]
  place()
  refresh()

  return {
    el,
    /** @returns {SpriteSelection} */
    get selection() {
      return sel
    },
    /**
     * Shows a selection without telling `onSelect`.
     * @param {SpriteSelection} next
     */
    set(next) {
      sel = clampSelection(next, max)
      place()
    },
    refresh,
    destroy() {
      for (const off of unsubscribe) off()
    },
  }
}
