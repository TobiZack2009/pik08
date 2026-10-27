import './sprite-editor.css'
import { paintIndexed } from '../../../player/renderer.js'
import { elemake } from '../../dom.js'
import { RegionHistory } from '../../history.js'
import { titleHints } from '../../hints.js'
import { createBindings } from '../../shortcuts.js'
import { cssColor } from '../../theme.js'
import { getPixel } from './raster.js'
import {
  clampSelection,
  clearArea,
  copyArea,
  dragArea,
  fillArea,
  flipAreaH,
  flipAreaV,
  hasFlag,
  inRect,
  moveSelection,
  paintPoints,
  pasteBlock,
  rotateArea,
  selectedSprites,
  selectionRect,
  setFlag,
  shapePoints,
  SHAPE_TOOLS,
  sheetIndices,
  shiftArea,
  spriteIndex,
  strokePoints,
  TOOLS,
} from './sprite-ops.js'
import { createSpritePicker } from './sprite-picker.js'

/** @import { EditorContext, EditorView } from '../index.js' */
/** @import { Block, Point } from './raster.js' */
/** @import { Rect, SpriteSelection, ToolId } from './sprite-ops.js' */

/** @type {Record<ToolId, { icon: string, label: string }>} */
export const TOOL_INFO = {
  pen: { icon: 'pencil', label: 'Pen' },
  eraser: { icon: 'eraser', label: 'Eraser' },
  fill: { icon: 'paint-bucket', label: 'Fill' },
  line: { icon: 'minus', label: 'Line' },
  rect: { icon: 'rect', label: 'Rectangle' },
  circle: { icon: 'circle', label: 'Ellipse' },
  select: { icon: 'box-select', label: 'Select' },
  pick: { icon: 'pipette', label: 'Pick colour' },
}

const ARROWS = /** @type {Record<string, [number, number]>} */ ({
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
})

/**
 * @typedef {Object} SpriteEditorState
 * @property {ToolId} tool
 * @property {number} color
 * @property {boolean} filled     rectangles and ellipses are filled
 * @property {boolean} grid
 * @property {SpriteSelection} selection  the sprites being edited
 * @property {Rect | null} area   marked pixels inside them (view coordinates), if any
 */

/**
 * The sprite editor. It edits a *view*: the selected sprites (up to 8x8 of them) shown as one
 * zoomed image. The pixel logic is in `sprite-ops.js`; this file is the DOM around it.
 *
 * @param {EditorContext} ctx
 * @returns {EditorView & { state: SpriteEditorState, undo: () => void, redo: () => void, setTool: (tool: ToolId) => void, setColor: (color: number) => void }}
 */
export function createSpriteEditor({ project, setStatus, setInfo, bindings = createBindings(null) }) {
  const hints = titleHints(bindings)
  const source = Symbol('sprite-editor')
  const palette = project.profile.display.palette
  const gfx = () => project.region('gfx')
  const flags = () => project.region('flags')
  const history = new RegionHistory(() => [gfx(), flags()])

  /** @type {SpriteEditorState} */
  const state = { tool: 'pen', color: 7, filled: false, grid: true, selection: { col: 0, row: 0, w: 1, h: 1 }, area: null }
  /** the selected sprites in sheet pixels */
  let view = selectionRect(state.selection)
  /** @type {Block | null} */
  let clipboard = null
  /** @type {Point | null} the view pixel under the pointer */
  let hover = null
  let active = false

  // ---- elements ---------------------------------------------------------------------------------
  const canvas = /** @type {HTMLCanvasElement} */ (elemake('canvas', { class: 'pixel' }))
  const overlay = /** @type {HTMLCanvasElement} */ (elemake('canvas', { class: 'pixel' }))
  const grid = elemake('div', { class: 'sprite-editor__grid' })
  const marquee = elemake('div', { class: 'sprite-editor__marquee', hidden: true })
  const board = elemake('div', { class: 'sprite-editor__board', dataset: { tool: state.tool } }, canvas, overlay, grid, marquee)

  const picker = createSpritePicker({
    project,
    selection: state.selection,
    onSelect: (selection) => setSelection(selection),
  })

  const paletteEl = elemake('p8-palette', { value: state.color, count: 16, columns: 8 })
  paletteEl.addEventListener('change', (e) => {
    state.color = /** @type {CustomEvent} */ (e).detail.value
  })

  /** @type {Map<ToolId, HTMLElement>} */
  const toolButtons = new Map()
  for (const id of TOOLS) {
    const { icon, label } = TOOL_INFO[id]
    toolButtons.set(id, hints.hint(elemake('p8-button', { icon, variant: 'ghost', onclick: () => setTool(id) }), label, `sprite:tool:${id}`))
  }
  const filledButton = elemake('p8-button', { icon: 'circle-dot', title: 'Filled rectangles and ellipses', variant: 'ghost', toggle: true })
  filledButton.addEventListener('change', (e) => {
    state.filled = /** @type {CustomEvent} */ (e).detail.pressed
  })
  const tools = elemake('p8-toolbar', { class: 'sprite-editor__tools', vertical: true, 'aria-label': 'Tools' }, [...toolButtons.values()], elemake('div', { class: 'sep' }), filledButton)

  /**
   * @param {string} icon
   * @param {string} title
   * @param {import('../../shortcuts.js').ShortcutAction} action
   * @param {() => void} run
   */
  const opButton = (icon, title, action, run) => hints.hint(elemake('p8-button', { icon, variant: 'ghost', onclick: run }), title, action)
  const undoButton = opButton('undo', 'Undo', 'undo', () => undo())
  const redoButton = opButton('redo', 'Redo', 'redo', () => redo())
  const gridButton = elemake('p8-button', { icon: 'grid', title: 'Show pixel grid', variant: 'ghost', toggle: true, pressed: true })
  gridButton.addEventListener('change', (e) => {
    state.grid = /** @type {CustomEvent} */ (e).detail.pressed
    el.dataset.grid = state.grid ? 'on' : 'off'
  })
  const ops = elemake(
    'p8-toolbar',
    { class: 'sprite-editor__ops', 'aria-label': 'Edit' },
    undoButton,
    redoButton,
    elemake('div', { class: 'sep' }),
    opButton('flip-horizontal', 'Flip horizontally', 'sprite:flipH', () => flip('h')),
    opButton('flip-vertical', 'Flip vertically', 'sprite:flipV', () => flip('v')),
    opButton('rotate-cw', 'Rotate clockwise', 'sprite:rotate', () => rotate()),
    elemake('div', { class: 'sep' }),
    opButton('copy', 'Copy', 'sprite:copy', () => copy()),
    opButton('scissors', 'Cut', 'sprite:cut', () => cut()),
    opButton('paste', 'Paste', 'sprite:paste', () => paste()),
    opButton('trash', 'Clear', 'sprite:clear', () => clear()),
    elemake('div', { class: 'spacer' }),
    gridButton,
  )

  const stage = elemake('div', { class: 'sprite-editor__stage' }, board)
  const main = elemake('div', { class: 'sprite-editor__main' }, ops, stage)

  const flagButtons = Array.from({ length: 8 }, (_, bit) =>
    elemake('button', {
      type: 'button',
      class: 'sprite-editor__flag',
      title: `Flag ${bit}`,
      'aria-label': `Flag ${bit}`,
      'aria-pressed': 'false',
      style: { '--flag': `var(--p8-${8 + bit})` },
      onclick: () => toggleFlag(bit),
    }),
  )
  const side = elemake(
    'div',
    { class: 'sprite-editor__side' },
    elemake('section', null, elemake('h3', null, 'Colour'), paletteEl),
    elemake('section', null, elemake('h3', null, 'Flags'), elemake('div', { class: 'sprite-editor__flags' }, flagButtons)),
    elemake('section', null, elemake('h3', null, 'Sprite sheet'), picker.el, elemake('p', { class: 'faint' }, 'Drag to select up to 8 x 8 sprites.')),
  )

  const split = elemake('p8-split', { fixed: 'end', size: 300, min: 220, 'storage-key': 'sprite-side' }, main, side)
  const el = elemake('div', { class: 'sprite-editor', dataset: { grid: 'on' } }, tools, split)

  // ---- drawing the view -------------------------------------------------------------------------
  function paint() {
    paintIndexed(canvas, sheetIndices(gfx(), view), palette)
  }

  /** Called when the selected sprites changed: resize everything to the new view. */
  function syncView() {
    const sel = state.selection
    view = selectionRect(sel)
    for (const c of [canvas, overlay]) {
      c.width = view.w
      c.height = view.h
    }
    board.style.setProperty('--w', String(view.w))
    board.style.setProperty('--h', String(view.h))
    board.style.setProperty('--sw', String(sel.w))
    board.style.setProperty('--sh', String(sel.h))
    state.area = null
    showArea()
    paint()
    picker.set(sel)
    refreshFlags()
    updateInfo()
  }

  /** @param {SpriteSelection} next */
  function setSelection(next) {
    const sel = clampSelection(next)
    const cur = state.selection
    if (sel.col === cur.col && sel.row === cur.row && sel.w === cur.w && sel.h === cur.h) return
    state.selection = sel
    syncView()
  }

  function showArea() {
    const a = state.area
    marquee.hidden = !a
    if (!a) return
    marquee.style.left = `${(a.x / view.w) * 100}%`
    marquee.style.top = `${(a.y / view.h) * 100}%`
    marquee.style.width = `${(a.w / view.w) * 100}%`
    marquee.style.height = `${(a.h / view.h) * 100}%`
  }

  /**
   * @param {Iterable<Point>} points
   * @param {number} color
   */
  function drawPreview(points, color) {
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    ctx.fillStyle = cssColor(palette[color] ?? 0)
    for (const [x, y] of points) if (inRect(view, x, y)) ctx.fillRect(x, y, 1, 1)
  }

  const clearPreview = () => overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height)

  // the sheet picker is bigger than the view, so during a stroke it repaints at most once per frame
  let frame = 0
  function repaintSheetSoon() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      picker.refresh()
    })
  }

  function updateInfo() {
    if (!active) return
    const { selection: sel } = state
    const size = sel.w > 1 || sel.h > 1 ? `  ${sel.w}x${sel.h}` : ''
    setInfo(`Sprite ${spriteIndex(sel)}${size}${hover ? `  x ${hover[0]} y ${hover[1]}` : ''}`)
  }

  function refreshFlags() {
    const sprites = selectedSprites(state.selection)
    flagButtons.forEach((button, bit) => {
      const set = sprites.filter((s) => hasFlag(flags(), s, bit)).length
      button.setAttribute('aria-pressed', set === 0 ? 'false' : set === sprites.length ? 'true' : 'mixed')
    })
  }

  function refreshHistory() {
    undoButton.toggleAttribute('disabled', !history.canUndo)
    redoButton.toggleAttribute('disabled', !history.canRedo)
  }

  // ---- changing the sheet -----------------------------------------------------------------------
  /**
   * Ends an edit gesture: records it for undo and tells the other editors.
   * @param {string[]} regions  what the gesture may have changed
   * @returns {boolean} whether anything changed
   */
  function finish(regions) {
    const changed = history.commit()
    if (changed) {
      paint()
      refreshHistory()
      project.notifyRom(regions, source)
    }
    return changed
  }

  /**
   * Runs one change to the sheet as a single undo step.
   * @param {() => unknown} change
   * @param {string[]} [regions]
   */
  function edit(change, regions = ['gfx']) {
    history.begin()
    change()
    return finish(regions)
  }

  function undo() {
    if (!history.undo()) return
    afterHistory()
  }

  function redo() {
    if (!history.redo()) return
    afterHistory()
  }

  function afterHistory() {
    paint()
    picker.refresh()
    refreshFlags()
    refreshHistory()
    project.notifyRom(['gfx', 'flags'], source)
  }

  /** The marked area, or the whole view. */
  const target = () => state.area ?? { x: 0, y: 0, w: view.w, h: view.h }

  /** @param {'h' | 'v'} axis */
  function flip(axis) {
    const area = target()
    edit(() => (axis === 'h' ? flipAreaH : flipAreaV)(gfx(), view, area))
  }

  function rotate() {
    const area = target()
    if (area.w !== area.h) return setStatus('Rotating needs a square area')
    edit(() => rotateArea(gfx(), view, area))
  }

  /**
   * @param {number} dx
   * @param {number} dy
   */
  function shift(dx, dy) {
    const area = target()
    edit(() => shiftArea(gfx(), view, area, dx, dy))
  }

  function copy() {
    const area = target()
    clipboard = copyArea(gfx(), view, area)
    setStatus(`Copied ${area.w} x ${area.h} pixels`)
  }

  function clear() {
    const area = target()
    edit(() => clearArea(gfx(), view, area))
  }

  function cut() {
    copy()
    clear()
  }

  function paste() {
    const block = clipboard
    if (!block) return setStatus('Nothing to paste')
    const [x, y] = hover ?? (state.area ? [state.area.x, state.area.y] : [0, 0])
    edit(() => pasteBlock(gfx(), view, x, y, block))
    const pasted = dragArea(view, [x, y], [x + block.w - 1, y + block.h - 1])
    state.area = pasted.w > 0 && pasted.h > 0 ? pasted : null
    showArea()
  }

  /** @param {number} bit */
  function toggleFlag(bit) {
    const sprites = selectedSprites(state.selection)
    const all = sprites.every((s) => hasFlag(flags(), s, bit))
    edit(() => setFlag(flags(), sprites, bit, !all), ['flags'])
    refreshFlags()
  }

  /** @param {ToolId} tool */
  function setTool(tool) {
    state.tool = tool
    board.dataset.tool = tool
    for (const [id, button] of toolButtons) button.toggleAttribute('pressed', id === tool)
  }

  /** @param {number} color */
  function setColor(color) {
    state.color = color
    paletteEl.setAttribute('value', String(color))
  }

  // ---- the pointer ------------------------------------------------------------------------------
  /**
   * @typedef {Object} Drag
   * @property {ToolId} tool
   * @property {Point} start
   * @property {Point} now
   */
  /** @type {Drag | null} */
  let drag = null

  /**
   * The view pixel under the pointer (can be outside the view while dragging).
   * @param {MouseEvent} e
   * @returns {Point}
   */
  function viewPoint(e) {
    const r = board.getBoundingClientRect()
    return [Math.floor(((e.clientX - r.left) / r.width) * view.w) || 0, Math.floor(((e.clientY - r.top) / r.height) * view.h) || 0]
  }

  /** @param {Point} p  @returns {Point} */
  const clampToView = ([x, y]) => [Math.min(view.w - 1, Math.max(0, x)), Math.min(view.h - 1, Math.max(0, y))]

  /** @param {Point} p */
  function pickAt([x, y]) {
    if (inRect(view, x, y)) setColor(getPixel(gfx(), view.x + x, view.y + y))
  }

  /** @param {Drag} d  @param {Point} p */
  function stroke(d, p) {
    const color = d.tool === 'eraser' ? 0 : state.color
    paintPoints(gfx(), view, strokePoints(d.now, p), color)
    d.now = p
    paint()
    repaintSheetSoon()
  }

  board.addEventListener('contextmenu', (e) => e.preventDefault())

  board.addEventListener('pointerdown', (e) => {
    if (drag) return
    e.preventDefault()
    const p = viewPoint(e)
    if (e.button === 2) return pickAt(p) // right button: pick the colour under the pointer
    if (e.button !== 0) return
    try {
      board.setPointerCapture(e.pointerId)
    } catch {
      // no capture: the drag then ends when the pointer leaves the board
    }
    const tool = state.tool
    if (tool === 'pick') return pickAt(p)
    if (tool === 'fill') {
      history.begin()
      fillArea(gfx(), view, p[0], p[1], state.color)
      finish(['gfx'])
      return
    }
    if (tool === 'pen' || tool === 'eraser') {
      history.begin()
      drag = { tool, start: p, now: p }
      stroke(drag, p)
      return
    }
    const at = clampToView(p)
    drag = { tool, start: at, now: at }
    if (tool === 'select') {
      state.area = dragArea(view, at, at)
      showArea()
    } else {
      drawPreview(shapePoints(/** @type {'line'} */ (tool), at, at, state.filled), state.color)
    }
  })

  board.addEventListener('pointermove', (e) => {
    const p = viewPoint(e)
    hover = inRect(view, p[0], p[1]) ? p : null
    updateInfo()
    if (!drag) return
    if (drag.tool === 'pen' || drag.tool === 'eraser') return stroke(drag, p)
    drag.now = clampToView(p)
    if (drag.tool === 'select') {
      state.area = dragArea(view, drag.start, drag.now)
      showArea()
    } else {
      drawPreview(shapePoints(/** @type {'line'} */ (drag.tool), drag.start, drag.now, state.filled), state.color)
    }
  })

  board.addEventListener('pointerup', () => {
    const d = drag
    if (!d) return
    drag = null
    if (d.tool === 'pen' || d.tool === 'eraser') {
      finish(['gfx'])
    } else if (d.tool === 'select') {
      // a click without a drag drops the selection
      if (d.start[0] === d.now[0] && d.start[1] === d.now[1]) state.area = null
      showArea()
    } else if (SHAPE_TOOLS.has(d.tool)) {
      clearPreview()
      history.begin()
      paintPoints(gfx(), view, shapePoints(/** @type {'line'} */ (d.tool), d.start, d.now, state.filled), state.color)
      finish(['gfx'])
    }
  })

  board.addEventListener('pointercancel', () => {
    const d = drag
    drag = null
    clearPreview()
    if (d && (d.tool === 'pen' || d.tool === 'eraser')) {
      history.cancel()
      paint()
      picker.refresh()
    }
  })

  board.addEventListener('pointerleave', () => {
    hover = null
    updateInfo()
  })

  // ---- the keyboard -----------------------------------------------------------------------------
  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (e.defaultPrevented) return
    const t = e.target
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
    const action = bindings.match(e, 'sprite')
    if (action) {
      e.preventDefault()
      const tool = TOOLS.find((id) => action === `sprite:tool:${id}`)
      if (tool) return setTool(tool)
      switch (action) {
        case 'undo':
          return undo()
        case 'redo':
          return redo()
        case 'sprite:copy':
          return copy()
        case 'sprite:cut':
          return cut()
        case 'sprite:paste':
          return paste()
        case 'sprite:flipH':
          return flip('h')
        case 'sprite:flipV':
          return flip('v')
        case 'sprite:rotate':
          return rotate()
        case 'sprite:clear':
          return clear()
        case 'sprite:deselect':
          state.area = null
          return showArea()
        case 'sprite:colorPrev':
          return setColor((state.color + 15) % 16)
        case 'sprite:colorNext':
          return setColor((state.color + 1) % 16)
      }
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const arrow = ARROWS[e.key]
    if (arrow) {
      e.preventDefault()
      if (e.shiftKey) shift(arrow[0], arrow[1])
      else setSelection(moveSelection(state.selection, arrow[0], arrow[1]))
    }
  }

  // ---- the rest of the app ----------------------------------------------------------------------
  const unsubscribe = [
    project.on('rom:gfx', (/** @type {{ source?: unknown }} */ d) => {
      if (d?.source !== source) paint()
    }),
    project.on('rom:flags', (/** @type {{ source?: unknown }} */ d) => {
      if (d?.source !== source) refreshFlags()
    }),
    project.on('load', () => {
      history.clear()
      refreshHistory()
      syncView()
    }),
  ]

  setTool('pen')
  syncView()
  refreshHistory()

  return {
    el,
    state,
    undo,
    redo,
    setTool,
    setColor,
    activate() {
      active = true
      window.addEventListener('keydown', onKey)
      paint()
      picker.refresh()
      updateInfo()
    },
    deactivate() {
      active = false
      window.removeEventListener('keydown', onKey)
    },
    destroy() {
      window.removeEventListener('keydown', onKey)
      cancelAnimationFrame(frame)
      for (const off of unsubscribe) off()
      hints.destroy()
      picker.destroy()
    },
  }
}
