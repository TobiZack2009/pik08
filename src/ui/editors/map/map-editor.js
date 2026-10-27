import './map-editor.css'
import { paintIndexedRegion } from '../../../player/renderer.js'
import { clamp, h } from '../../dom.js'
import { RegionHistory } from '../../history.js'
import { titleHints } from '../../hints.js'
import { createBindings, eventKey } from '../../shortcuts.js'
import { createSpritePicker } from '../sprite/sprite-picker.js'
import { SHAPE_TOOLS, clampSelection, inRect, shapePoints, strokePoints } from '../sprite/sprite-ops.js'
import { MAP_HEIGHT, MAP_WIDTH, getTile, isSharedRow, regionsTouched } from './map-data.js'
import {
  MAP_TOOLS,
  TILE_PX,
  brushBlock,
  brushTile,
  clampToMap,
  clearTiles,
  copyTiles,
  dragTiles,
  fillTiles,
  mapIndices,
  paintTiles,
  snapToBrush,
  stampTiles,
  tileSelection,
} from './map-ops.js'

/** @import { EditorContext, EditorView } from '../index.js' */
/** @import { Point } from '../sprite/raster.js' */
/** @import { Rect, SpriteSelection } from '../sprite/sprite-ops.js' */
/** @import { TileBlock } from './map-data.js' */
/** @import { MapToolId } from './map-ops.js' */

/** @type {Record<MapToolId, { icon: string, label: string }>} */
export const MAP_TOOL_INFO = {
  pen: { icon: 'pencil', label: 'Draw with the brush' },
  eraser: { icon: 'eraser', label: 'Eraser' },
  fill: { icon: 'paint-bucket', label: 'Fill' },
  line: { icon: 'minus', label: 'Line' },
  rect: { icon: 'rect', label: 'Rectangle' },
  circle: { icon: 'circle', label: 'Ellipse' },
  select: { icon: 'box-select', label: 'Select tiles' },
  pick: { icon: 'pipette', label: 'Pick tile' },
  pan: { icon: 'hand', label: 'Pan' },
}

/** Zoom steps: how many screen pixels one sprite pixel gets. */
export const ZOOMS = [1, 2, 3, 4, 6, 8]

/** The ROM regions in the order the history stores them. */
const HISTORY_REGIONS = ['map', 'gfx']

/**
 * @typedef {Object} MapEditorState
 * @property {MapToolId} tool
 * @property {boolean} filled
 * @property {boolean} grid
 * @property {number} zoom
 * @property {SpriteSelection} brush  the sprites the pen puts down
 * @property {Rect | null} area       the selected tiles
 */

/**
 * The map editor: the 128x64 tile map on a scrolling, zoomable canvas, with the sprite sheet as the
 * tile palette. Rows 32..63 are stored in the sprite sheet (like PICO-8), so editing them also
 * announces `rom:gfx`, and the editor repaints when sprites change.
 *
 * @param {EditorContext} ctx
 * @returns {EditorView & { state: MapEditorState, undo: () => void, redo: () => void, setTool: (tool: MapToolId) => void, setZoom: (zoom: number) => void }}
 */
export function createMapEditor({ project, setStatus, setInfo, bindings = createBindings(null) }) {
  const hints = titleHints(bindings)
  const source = Symbol('map-editor')
  const palette = project.profile.display.palette
  const map = () => project.region('map')
  const gfx = () => project.region('gfx')
  const history = new RegionHistory(() => [map(), gfx()])

  /** @type {MapEditorState} */
  const state = { tool: 'pen', filled: false, grid: true, zoom: 2, brush: { col: 1, row: 0, w: 1, h: 1 }, area: null }
  /** @type {TileBlock | null} */
  let clipboard = null
  /** @type {Point | null} the tile under the pointer */
  let hover = null
  let active = false
  /** something changed the graphics while the tab was hidden */
  let stale = false
  let spaceDown = false
  /** The key that is holding the pan, so letting go of it ends the pan. */
  let panKey = ''

  // ---- elements ---------------------------------------------------------------------------------
  const canvas = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'pixel map-editor__map', width: MAP_WIDTH * TILE_PX, height: MAP_HEIGHT * TILE_PX }))
  const preview = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'pixel map-editor__preview', width: MAP_WIDTH, height: MAP_HEIGHT }))
  const grid = h('div', { class: 'map-editor__grid' })
  const shared = h('div', { class: 'map-editor__shared' }, h('span', null, 'rows 32-63 are stored in the sprite sheet (sprites 128-255)'))
  const marquee = h('div', { class: 'map-editor__marquee', hidden: true })
  const cursor = h('div', { class: 'map-editor__cursor', hidden: true })
  const board = h('div', { class: 'map-editor__board', dataset: { tool: state.tool } }, canvas, preview, grid, shared, marquee, cursor)
  const scroller = h('div', { class: 'map-editor__scroll' }, board)

  const picker = createSpritePicker({ project, selection: state.brush, onSelect: (brush) => setBrush(brush) })

  /** @type {Map<MapToolId, HTMLElement>} */
  const toolButtons = new Map()
  for (const id of MAP_TOOLS) {
    const { icon, label } = MAP_TOOL_INFO[id]
    toolButtons.set(id, hints.hint(h('p8-button', { icon, variant: 'ghost', onclick: () => setTool(id) }), label, `map:tool:${id}`))
  }
  const filledButton = h('p8-button', { icon: 'circle-dot', title: 'Filled rectangles and ellipses', variant: 'ghost', toggle: true })
  filledButton.addEventListener('change', (e) => {
    state.filled = /** @type {CustomEvent} */ (e).detail.pressed
  })
  const tools = h('p8-toolbar', { class: 'map-editor__tools', vertical: true, 'aria-label': 'Tools' }, [...toolButtons.values()], h('div', { class: 'sep' }), filledButton)

  /**
   * @param {string} icon
   * @param {string} title
   * @param {import('../../shortcuts.js').ShortcutAction} action
   * @param {() => void} run
   */
  const opButton = (icon, title, action, run) => hints.hint(h('p8-button', { icon, variant: 'ghost', onclick: run }), title, action)
  const undoButton = opButton('undo', 'Undo', 'undo', () => undo())
  const redoButton = opButton('redo', 'Redo', 'redo', () => redo())
  const zoomOutButton = opButton('zoom-out', 'Zoom out', 'map:zoomOut', () => zoomBy(-1))
  const zoomInButton = opButton('zoom-in', 'Zoom in', 'map:zoomIn', () => zoomBy(1))
  const zoomLabel = h('span', { class: 'map-editor__zoom' })
  const gridButton = h('p8-button', { icon: 'grid', title: 'Show grid', variant: 'ghost', toggle: true, pressed: true })
  gridButton.addEventListener('change', (e) => {
    state.grid = /** @type {CustomEvent} */ (e).detail.pressed
    el.dataset.grid = state.grid ? 'on' : 'off'
  })
  const ops = h(
    'p8-toolbar',
    { class: 'map-editor__ops', 'aria-label': 'Edit' },
    undoButton,
    redoButton,
    h('div', { class: 'sep' }),
    opButton('copy', 'Copy', 'map:copy', () => copy()),
    opButton('scissors', 'Cut', 'map:cut', () => cut()),
    opButton('paste', 'Paste', 'map:paste', () => paste()),
    opButton('trash', 'Clear selected tiles', 'map:clear', () => clear()),
    h('div', { class: 'spacer' }),
    zoomOutButton,
    zoomLabel,
    zoomInButton,
    gridButton,
  )

  const brushLabel = h('p', { class: 'map-editor__brush' })
  const main = h('div', { class: 'map-editor__main' }, ops, scroller)
  const side = h(
    'div',
    { class: 'map-editor__side' },
    h('section', null, h('h3', null, 'Tiles'), picker.el, brushLabel, h('p', { class: 'faint' }, 'Drag on the sheet to pick a brush of up to 8 x 8 sprites.')),
  )
  const split = h('p8-split', { fixed: 'end', size: 300, min: 220, 'storage-key': 'map-side' }, main, side)
  const el = h('div', { class: 'map-editor', dataset: { grid: 'on' } }, tools, split)

  // ---- drawing ----------------------------------------------------------------------------------
  /** Repaints the whole map. */
  function paintAll() {
    stale = false
    paintIndexedRegion(canvas, mapIndices(map(), gfx(), { x: 0, y: 0, w: MAP_WIDTH, h: MAP_HEIGHT }), palette, 0, 0, canvas.width, canvas.height)
  }

  /**
   * Repaints some tiles.
   * @param {Point[]} tiles
   */
  function paintTilesAt(tiles) {
    if (tiles.length > 256) return paintAll()
    for (const [x, y] of tiles) {
      paintIndexedRegion(canvas, mapIndices(map(), gfx(), { x, y, w: 1, h: 1 }), palette, x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX)
    }
  }

  /** Something changed the sprite sheet or the map from outside. */
  function repaintExternal() {
    if (active) paintAll()
    else stale = true
  }

  function applyZoom() {
    el.style.setProperty('--tile', `${TILE_PX * state.zoom}px`)
    el.dataset.zoom = String(state.zoom)
    zoomLabel.textContent = `${state.zoom * 100}%`
    zoomOutButton.toggleAttribute('disabled', state.zoom <= ZOOMS[0])
    zoomInButton.toggleAttribute('disabled', state.zoom >= ZOOMS[ZOOMS.length - 1])
  }

  /**
   * Zooms to the step nearest to `zoom`, keeping the point under the pointer (or the middle) where it is.
   * @param {number} zoom
   * @param {{ clientX: number, clientY: number }} [anchor]
   */
  function setZoom(zoom, anchor) {
    const target = ZOOMS.reduce((best, z) => (Math.abs(z - zoom) < Math.abs(best - zoom) ? z : best))
    if (target === state.zoom) return
    const sr = scroller.getBoundingClientRect()
    const cx = anchor?.clientX ?? sr.left + sr.width / 2
    const cy = anchor?.clientY ?? sr.top + sr.height / 2
    const before = board.getBoundingClientRect()
    const fx = (cx - before.left) / before.width || 0
    const fy = (cy - before.top) / before.height || 0
    state.zoom = target
    applyZoom()
    const after = board.getBoundingClientRect()
    scroller.scrollLeft += after.left + fx * after.width - cx || 0
    scroller.scrollTop += after.top + fy * after.height - cy || 0
    updateCursor()
  }

  /**
   * @param {number} direction  1 to zoom in a step, -1 to zoom out
   * @param {{ clientX: number, clientY: number }} [anchor]
   */
  function zoomBy(direction, anchor) {
    const at = ZOOMS.indexOf(state.zoom)
    setZoom(ZOOMS[clamp(at + direction, 0, ZOOMS.length - 1)], anchor)
  }

  /**
   * Places an overlay box on a rectangle of tiles.
   * @param {HTMLElement} box
   * @param {Rect | null} rect
   */
  function place(box, rect) {
    box.hidden = !rect
    if (!rect) return
    box.style.setProperty('--x', String(rect.x))
    box.style.setProperty('--y', String(rect.y))
    box.style.setProperty('--w', String(rect.w))
    box.style.setProperty('--h', String(rect.h))
  }

  const showArea = () => place(marquee, state.area)

  /** The box that follows the pointer: the brush size for the pen, one tile otherwise. */
  function updateCursor() {
    if (!hover || !active || state.tool === 'pan' || drag) return place(cursor, null)
    const big = state.tool === 'pen' ? state.brush : { w: 1, h: 1 }
    place(cursor, { x: hover[0], y: hover[1], w: Math.min(big.w, MAP_WIDTH - hover[0]), h: Math.min(big.h, MAP_HEIGHT - hover[1]) })
  }

  /** @param {Point[]} points */
  function drawPreview(points) {
    const ctx = preview.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, preview.width, preview.height)
    ctx.fillStyle = 'rgba(255, 241, 232, 0.6)'
    for (const [x, y] of points) if (x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT) ctx.fillRect(x, y, 1, 1)
  }

  const clearPreview = () => preview.getContext('2d')?.clearRect(0, 0, preview.width, preview.height)

  function updateInfo() {
    if (!active) return
    if (!hover) return setInfo(`Brush: sprite ${brushTile(state.brush)}`)
    const [x, y] = hover
    setInfo(`x ${x} y ${y}  tile ${getTile(map(), gfx(), x, y)}${isSharedRow(y) ? '  (shared with the sprite sheet)' : ''}`)
  }

  function updateBrushLabel() {
    const { brush } = state
    brushLabel.textContent = `Brush: sprite ${brushTile(brush)}${brush.w > 1 || brush.h > 1 ? `, ${brush.w} x ${brush.h}` : ''}`
  }

  function refreshHistory() {
    undoButton.toggleAttribute('disabled', !history.canUndo)
    redoButton.toggleAttribute('disabled', !history.canRedo)
  }

  // ---- changing the map -------------------------------------------------------------------------
  /** @param {import('../../history.js').RegionDiff[] | undefined} diffs  @returns {string[]} */
  const regionsOf = (diffs) => (diffs ?? []).map((d) => HISTORY_REGIONS[d.region])

  /**
   * Ends an edit gesture: records it and announces the regions that changed.
   * @returns {boolean} whether anything changed
   */
  function finish() {
    const changed = history.commit()
    if (changed) {
      refreshHistory()
      project.notifyRom(regionsOf(history.undoStack.at(-1)), source)
    }
    return changed
  }

  /**
   * One edit as a single undo step.
   * @param {() => Point[]} change  returns the tiles it changed
   */
  function edit(change) {
    history.begin()
    paintTilesAt(change())
    return finish()
  }

  /** @param {boolean} forward */
  function step(forward) {
    if (!(forward ? history.redo() : history.undo())) return
    const diffs = forward ? history.undoStack.at(-1) : history.redoStack.at(-1)
    paintAll()
    refreshHistory()
    project.notifyRom(regionsOf(diffs), source)
  }
  const undo = () => step(false)
  const redo = () => step(true)

  /** @param {SpriteSelection} brush */
  function setBrush(brush) {
    state.brush = clampSelection(brush)
    picker.set(state.brush)
    updateBrushLabel()
    updateCursor()
    updateInfo()
  }

  /** @param {MapToolId} tool */
  function setTool(tool) {
    state.tool = tool
    board.dataset.tool = tool
    for (const [id, button] of toolButtons) button.toggleAttribute('pressed', id === tool)
    updateCursor()
  }

  function copy() {
    const area = state.area
    if (!area) return setStatus('Select some tiles first')
    clipboard = copyTiles(map(), gfx(), area)
    setStatus(`Copied ${area.w} x ${area.h} tiles`)
  }

  function clear() {
    const area = state.area
    if (!area) return setStatus('Select some tiles first')
    edit(() => clearTiles(map(), gfx(), area))
  }

  function cut() {
    if (!state.area) return setStatus('Select some tiles first')
    copy()
    clear()
  }

  function paste() {
    const block = clipboard
    if (!block) return setStatus('Nothing to paste')
    const [x, y] = hover ?? (state.area ? [state.area.x, state.area.y] : [0, 0])
    edit(() => stampTiles(map(), gfx(), x, y, block))
    const pasted = dragTiles([x, y], [x + block.w - 1, y + block.h - 1])
    state.area = pasted.w > 0 && pasted.h > 0 ? pasted : null
    showArea()
  }

  // ---- the pointer ------------------------------------------------------------------------------
  /**
   * @typedef {Object} Drag
   * @property {MapToolId} tool
   * @property {Point} start
   * @property {Point} now
   * @property {Point | null} [stamped]  where the pen last put the brush
   * @property {{ x: number, y: number, left: number, top: number }} [pan]
   */
  /** @type {Drag | null} */
  let drag = null

  /**
   * The tile under the pointer (can be outside the map while dragging).
   * @param {MouseEvent} e
   * @returns {Point}
   */
  function tileAt(e) {
    const r = board.getBoundingClientRect()
    return [Math.floor(((e.clientX - r.left) / r.width) * MAP_WIDTH) || 0, Math.floor(((e.clientY - r.top) / r.height) * MAP_HEIGHT) || 0]
  }

  /** @param {Point} p */
  function pickAt([x, y]) {
    if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return
    setBrush(tileSelection(getTile(map(), gfx(), x, y)))
  }

  /**
   * Continues a pen or eraser stroke to a tile.
   * @param {Drag} d
   * @param {Point} p
   */
  function stroke(d, p) {
    /** @type {Point[]} */
    const changed = []
    if (d.tool === 'eraser') {
      changed.push(...paintTiles(map(), gfx(), strokePoints(d.now, p), 0))
    } else {
      const { w, h } = state.brush
      const block = brushBlock(state.brush)
      for (const point of strokePoints(d.now, p)) {
        const at = snapToBrush(d.start, point, w, h)
        if (d.stamped && d.stamped[0] === at[0] && d.stamped[1] === at[1]) continue
        d.stamped = at
        changed.push(...stampTiles(map(), gfx(), at[0], at[1], block))
      }
    }
    d.now = p
    paintTilesAt(changed)
  }

  /** @param {Drag} d */
  function previewShape(d) {
    drawPreview(shapePoints(/** @type {'line'} */ (d.tool), d.start, d.now, state.filled))
  }

  board.addEventListener('contextmenu', (e) => e.preventDefault())

  board.addEventListener('pointerdown', (e) => {
    if (drag) return
    e.preventDefault()
    const p = tileAt(e)
    const panning = e.button === 1 || (e.button === 0 && (state.tool === 'pan' || spaceDown))
    if (e.button === 2) return pickAt(p) // right button: pick the tile under the pointer
    if (e.button !== 0 && !panning) return
    try {
      board.setPointerCapture(e.pointerId)
    } catch {
      // no capture: the drag then ends when the pointer leaves the board
    }
    if (panning) {
      drag = { tool: 'pan', start: p, now: p, pan: { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop } }
      return
    }
    const tool = state.tool
    if (tool === 'pick') return pickAt(p)
    if (tool === 'fill') {
      history.begin()
      paintTilesAt(fillTiles(map(), gfx(), p[0], p[1], brushTile(state.brush)))
      finish()
      return
    }
    if (tool === 'pen' || tool === 'eraser') {
      const at = clampToMap(p)
      history.begin()
      drag = { tool, start: at, now: at, stamped: null }
      // the first stamp has to land where the pointer is, even right at the map edge
      stroke(drag, at)
      updateCursor()
      return
    }
    const at = clampToMap(p)
    drag = { tool, start: at, now: at }
    if (tool === 'select') {
      state.area = dragTiles(at, at)
      showArea()
    } else {
      previewShape(drag)
    }
  })

  board.addEventListener('pointermove', (e) => {
    const p = tileAt(e)
    hover = inRect({ x: 0, y: 0, w: MAP_WIDTH, h: MAP_HEIGHT }, p[0], p[1]) ? p : null
    if (drag?.pan) {
      scroller.scrollLeft = drag.pan.left - (e.clientX - drag.pan.x)
      scroller.scrollTop = drag.pan.top - (e.clientY - drag.pan.y)
      return
    }
    updateCursor()
    updateInfo()
    if (!drag) return
    if (drag.tool === 'pen' || drag.tool === 'eraser') return stroke(drag, clampToMap(p))
    drag.now = clampToMap(p)
    if (drag.tool === 'select') {
      state.area = dragTiles(drag.start, drag.now)
      showArea()
    } else {
      previewShape(drag)
    }
  })

  board.addEventListener('pointerup', () => {
    const d = drag
    if (!d) return
    drag = null
    if (d.pan) return
    if (d.tool === 'pen' || d.tool === 'eraser') {
      finish()
    } else if (d.tool === 'select') {
      // a click without a drag drops the selection
      if (d.start[0] === d.now[0] && d.start[1] === d.now[1]) state.area = null
      showArea()
    } else if (SHAPE_TOOLS.has(d.tool)) {
      clearPreview()
      const tile = brushTile(state.brush)
      edit(() => paintTiles(map(), gfx(), shapePoints(/** @type {'line'} */ (d.tool), d.start, d.now, state.filled), tile))
    }
    updateCursor()
  })

  board.addEventListener('pointercancel', () => {
    const d = drag
    drag = null
    clearPreview()
    if (d && (d.tool === 'pen' || d.tool === 'eraser')) {
      history.cancel()
      paintAll()
    }
  })

  board.addEventListener('pointerleave', () => {
    hover = null
    updateCursor()
    updateInfo()
  })

  scroller.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return // plain wheel scrolls
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1 : -1, e)
    },
    { passive: false },
  )

  // ---- the keyboard -----------------------------------------------------------------------------
  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.defaultPrevented) return
    const t = e.target
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    const action = bindings.match(e, 'map')
    if (!action) return
    e.preventDefault()
    const tool = MAP_TOOLS.find((id) => action === `map:tool:${id}`)
    if (tool) return setTool(tool)
    switch (action) {
      case 'undo':
        return undo()
      case 'redo':
        return redo()
      case 'map:copy':
        return copy()
      case 'map:cut':
        return cut()
      case 'map:paste':
        return paste()
      case 'map:clear':
        return clear()
      case 'map:deselect':
        state.area = null
        return showArea()
      case 'map:zoomIn':
        return zoomBy(1)
      case 'map:zoomOut':
        return zoomBy(-1)
      case 'map:panHold':
        spaceDown = true
        panKey = eventKey(e)
        board.dataset.pan = 'on'
        return
    }
  }

  /** @param {KeyboardEvent} e */
  function onKeyUp(e) {
    if (!spaceDown || eventKey(e) !== panKey) return
    stopPanHold()
  }

  function stopPanHold() {
    spaceDown = false
    delete board.dataset.pan
  }

  // ---- the rest of the app ----------------------------------------------------------------------
  const unsubscribe = [
    project.on('rom:map', (/** @type {{ source?: unknown }} */ d) => {
      if (d?.source !== source) repaintExternal()
    }),
    project.on('rom:gfx', (/** @type {{ source?: unknown }} */ d) => {
      if (d?.source !== source) repaintExternal()
    }),
    project.on('load', () => {
      history.clear()
      refreshHistory()
      state.area = null
      showArea()
      repaintExternal()
    }),
  ]

  applyZoom()
  setTool('pen')
  updateBrushLabel()
  refreshHistory()
  paintAll()

  return {
    el,
    state,
    undo,
    redo,
    setTool,
    setZoom,
    activate() {
      active = true
      window.addEventListener('keydown', onKey)
      window.addEventListener('keyup', onKeyUp)
      if (stale) paintAll()
      picker.refresh()
      updateInfo()
    },
    deactivate() {
      active = false
      stopPanHold()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      place(cursor, null)
    },
    destroy() {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      for (const off of unsubscribe) off()
      hints.destroy()
      picker.destroy()
    },
  }
}
