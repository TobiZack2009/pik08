// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { defineElements } from '../../src/ui/elements/index.js'
import { createMapEditor } from '../../src/ui/editors/map/map-editor.js'
import { getTile, setTile } from '../../src/ui/editors/map/map-data.js'
import { createBindings } from '../../src/ui/shortcuts.js'
import { Project } from '../../src/ui/store.js'

beforeAll(() => defineElements())

/** @type {ReturnType<typeof createMapEditor> | undefined} */
let editor

afterEach(() => {
  editor?.destroy?.()
  editor?.el.remove()
  editor = undefined
})

/** One tile is 10px on the fake layout; the sprite picker uses the same cell size. */
const CELL = 10

/** @param {HTMLElement} el @param {number} cols @param {number} rows */
function fakeLayout(el, cols, rows) {
  el.getBoundingClientRect = () => /** @type {DOMRect} */ ({ left: 0, top: 0, right: cols * CELL, bottom: rows * CELL, width: cols * CELL, height: rows * CELL, x: 0, y: 0, toJSON() {} })
}

function setup(/** @type {import('../../src/ui/shortcuts.js').Bindings} */ bindings = createBindings(null)) {
  const project = Project.empty(pico8Profile)
  editor = createMapEditor({ project, setStatus: vi.fn(), setInfo: vi.fn(), requestRun: vi.fn(), bindings })
  document.body.append(editor.el)
  const board = /** @type {HTMLElement} */ (editor.el.querySelector('.map-editor__board'))
  const sheet = /** @type {HTMLElement} */ (editor.el.querySelector('.sprite-picker__sheet'))
  fakeLayout(board, 128, 64)
  fakeLayout(sheet, 16, 16)
  editor.activate?.()
  const events = /** @type {string[][]} */ ([])
  project.on('rom', (d) => events.push([...d.regions].sort()))
  return { project, board, sheet, editor, events }
}

/**
 * @param {HTMLElement} el
 * @param {string} type
 * @param {number} x  tile
 * @param {number} y
 * @param {MouseEventInit} [init]
 */
function pointer(el, type, x, y, init = {}) {
  el.dispatchEvent(new MouseEvent(type, { clientX: x * CELL + CELL / 2, clientY: y * CELL + CELL / 2, button: 0, bubbles: true, cancelable: true, ...init }))
}

/**
 * @param {HTMLElement} el
 * @param {[number, number]} from
 * @param {[number, number]} to
 */
function drag(el, from, to) {
  pointer(el, 'pointerdown', from[0], from[1])
  pointer(el, 'pointermove', to[0], to[1])
  pointer(el, 'pointerup', to[0], to[1])
}

/** @param {string} key @param {KeyboardEventInit} [init] */
function press(key, init = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

/** @param {Project} project @param {number} x @param {number} y */
const tileOf = (project, x, y) => getTile(project.region('map'), project.region('gfx'), x, y)

describe('map editor drawing', () => {
  it('stamps the brush along a pen stroke without gaps', () => {
    const { project, board } = setup()
    drag(board, [3, 4], [8, 4])
    for (let x = 3; x <= 8; x++) expect(tileOf(project, x, 4)).toBe(1)
    expect(tileOf(project, 2, 4)).toBe(0)
    expect(tileOf(project, 9, 4)).toBe(0)
    expect(project.dirty).toBe(true)
  })

  it('stamps a multi-tile brush on steps of its own size', () => {
    const { project, board, sheet } = setup()
    drag(sheet, [2, 0], [3, 1]) // sprites 2, 3, 18, 19
    expect(editor?.state.brush).toEqual({ col: 2, row: 0, w: 2, h: 2 })
    drag(board, [10, 10], [13, 10])
    expect([tileOf(project, 10, 10), tileOf(project, 11, 10), tileOf(project, 10, 11), tileOf(project, 11, 11)]).toEqual([2, 3, 18, 19])
    expect([tileOf(project, 12, 10), tileOf(project, 13, 11)]).toEqual([2, 19])
  })

  it('erases with the eraser', () => {
    const { project, board, editor } = setup()
    setTile(project.region('map'), project.region('gfx'), 5, 5, 9)
    editor.setTool('eraser')
    drag(board, [5, 5], [5, 5])
    expect(tileOf(project, 5, 5)).toBe(0)
  })

  it('fills a connected area and tells map and gfx', () => {
    const { project, board, editor, events } = setup()
    editor.setTool('fill')
    pointer(board, 'pointerdown', 0, 0)
    pointer(board, 'pointerup', 0, 0)
    expect(tileOf(project, 127, 63)).toBe(1)
    expect(tileOf(project, 60, 10)).toBe(1)
    expect(events).toEqual([['gfx', 'map']])
  })

  it('draws a line only when the button is released', () => {
    const { project, board, editor } = setup()
    editor.setTool('line')
    pointer(board, 'pointerdown', 0, 0)
    pointer(board, 'pointermove', 4, 0)
    expect(tileOf(project, 2, 0)).toBe(0)
    pointer(board, 'pointerup', 4, 0)
    expect(tileOf(project, 2, 0)).toBe(1)
    expect(tileOf(project, 5, 0)).toBe(0)
  })

  it('draws outlined and filled rectangles', () => {
    const { project, board, editor } = setup()
    editor.setTool('rect')
    drag(board, [2, 2], [6, 6])
    expect(tileOf(project, 2, 2)).toBe(1)
    expect(tileOf(project, 4, 4)).toBe(0)
    editor.state.filled = true
    drag(board, [10, 2], [14, 6])
    expect(tileOf(project, 12, 4)).toBe(1)
  })

  it('picks the tile under the pointer with the pick tool and the right button', () => {
    const { project, board, editor } = setup()
    setTile(project.region('map'), project.region('gfx'), 7, 7, 37)
    editor.setTool('pick')
    pointer(board, 'pointerdown', 7, 7)
    expect(editor.state.brush).toEqual({ col: 5, row: 2, w: 1, h: 1 })
    setTile(project.region('map'), project.region('gfx'), 8, 8, 20)
    editor.setTool('pen')
    pointer(board, 'pointerdown', 8, 8, { button: 2 })
    expect(editor.state.brush).toEqual({ col: 4, row: 1, w: 1, h: 1 })
    expect(tileOf(project, 8, 8)).toBe(20) // picking does not paint
  })

  it('keeps the stroke inside the map', () => {
    const { project, board } = setup()
    pointer(board, 'pointerdown', 126, 0)
    pointer(board, 'pointermove', 140, 0)
    pointer(board, 'pointerup', 140, 0)
    expect(tileOf(project, 127, 0)).toBe(1)
  })
})

describe('map editor selection', () => {
  it('selects, copies and pastes tiles at the pointer', () => {
    const { project, board, editor } = setup()
    drag(board, [2, 2], [3, 2])
    editor.setTool('select')
    drag(board, [2, 2], [3, 2])
    expect(editor.state.area).toEqual({ x: 2, y: 2, w: 2, h: 1 })
    press('c', { ctrlKey: true })
    pointer(board, 'pointermove', 20, 20)
    press('v', { ctrlKey: true })
    expect(tileOf(project, 20, 20)).toBe(1)
    expect(tileOf(project, 21, 20)).toBe(1)
    expect(editor.state.area).toEqual({ x: 20, y: 20, w: 2, h: 1 })
  })

  it('clears the selected tiles', () => {
    const { project, board, editor } = setup()
    drag(board, [2, 2], [4, 2])
    editor.setTool('select')
    drag(board, [3, 2], [4, 2])
    press('Delete')
    expect([2, 3, 4].map((x) => tileOf(project, x, 2))).toEqual([1, 0, 0])
  })

  it('cuts', () => {
    const { project, board, editor } = setup()
    drag(board, [2, 2], [2, 2])
    editor.setTool('select')
    drag(board, [2, 2], [3, 2])
    press('x', { ctrlKey: true })
    expect(tileOf(project, 2, 2)).toBe(0)
    pointer(board, 'pointermove', 9, 9)
    press('v', { ctrlKey: true })
    expect(tileOf(project, 9, 9)).toBe(1)
  })

  it('drops the selection on a click and on Escape', () => {
    const { board, editor } = setup()
    editor.setTool('select')
    drag(board, [2, 2], [4, 4])
    expect(editor.state.area).not.toBeNull()
    press('Escape')
    expect(editor.state.area).toBeNull()
    drag(board, [2, 2], [4, 4])
    drag(board, [6, 6], [6, 6])
    expect(editor.state.area).toBeNull()
  })

  it('says so when there is nothing to copy or paste', () => {
    const project = Project.empty(pico8Profile)
    const setStatus = vi.fn()
    editor = createMapEditor({ project, setStatus, setInfo: vi.fn(), requestRun: vi.fn() })
    editor.activate?.()
    press('c', { ctrlKey: true })
    expect(setStatus).toHaveBeenLastCalledWith('Select some tiles first')
    press('v', { ctrlKey: true })
    expect(setStatus).toHaveBeenLastCalledWith('Nothing to paste')
  })
})

describe('map editor history and regions', () => {
  it('announces the map region for the upper rows', () => {
    const { board, events } = setup()
    drag(board, [3, 5], [6, 5])
    expect(events).toEqual([['map']])
  })

  it('announces the sprite sheet for the lower rows, which live there', () => {
    const { project, board, events } = setup()
    drag(board, [3, 40], [6, 40])
    expect(events).toEqual([['gfx']])
    expect(project.region('gfx')[0x1000 + 8 * 128 + 3]).toBe(1)
    expect(project.region('map').every((b) => b === 0)).toBe(true)
  })

  it('announces both when a gesture crosses row 32', () => {
    const { board, events } = setup()
    drag(board, [3, 30], [3, 34])
    expect(events).toEqual([['gfx', 'map']])
  })

  it('undoes and redoes a stroke as one step, telling the regions it touched', () => {
    const { project, board, editor, events } = setup()
    drag(board, [3, 5], [8, 5])
    editor.undo()
    expect([3, 8].map((x) => tileOf(project, x, 5))).toEqual([0, 0])
    expect(events).toEqual([['map'], ['map']])
    editor.redo()
    expect([3, 8].map((x) => tileOf(project, x, 5))).toEqual([1, 1])
    expect(events).toEqual([['map'], ['map'], ['map']])
  })

  it('undoes a lower-row edit through gfx', () => {
    const { project, board, editor, events } = setup()
    drag(board, [4, 50], [4, 50])
    editor.undo()
    expect(tileOf(project, 4, 50)).toBe(0)
    expect(events).toEqual([['gfx'], ['gfx']])
  })

  it('undoes with the keyboard', () => {
    const { project, board } = setup()
    drag(board, [1, 1], [1, 1])
    press('z', { ctrlKey: true })
    expect(tileOf(project, 1, 1)).toBe(0)
    press('z', { ctrlKey: true, shiftKey: true })
    expect(tileOf(project, 1, 1)).toBe(1)
    press('z', { metaKey: true })
    press('y', { ctrlKey: true })
    expect(tileOf(project, 1, 1)).toBe(1)
  })

  it('does not record a stroke that changed nothing', () => {
    const { board, editor, events } = setup()
    editor.setTool('eraser')
    drag(board, [1, 1], [3, 1])
    expect(events).toEqual([])
    expect(editor.el.querySelector('p8-button[title^="Undo"]')?.hasAttribute('disabled')).toBe(true)
  })

  it('drops the history and the selection when a cart is loaded', () => {
    const { project, board, editor } = setup()
    drag(board, [1, 1], [1, 1])
    editor.setTool('select')
    drag(board, [1, 1], [2, 2])
    project.load(Project.empty(pico8Profile).cart, 'other.p8')
    expect(editor.state.area).toBeNull()
    editor.undo()
    expect(editor.el.querySelector('p8-button[title^="Undo"]')?.hasAttribute('disabled')).toBe(true)
  })

  it('repaints on a change from another editor only while the tab is shown', () => {
    const { project, editor } = setup()
    const canvas = /** @type {HTMLCanvasElement} */ (editor.el.querySelector('.map-editor__map'))
    const getContext = vi.fn(() => null)
    canvas.getContext = /** @type {any} */ (getContext)
    project.notifyRom(['gfx'], Symbol('other'))
    expect(getContext).toHaveBeenCalled()

    editor.deactivate?.()
    getContext.mockClear()
    project.notifyRom(['gfx'], Symbol('other'))
    expect(getContext).not.toHaveBeenCalled()
    editor.activate?.()
    expect(getContext).toHaveBeenCalled()
  })

  it('does not repaint for its own changes', () => {
    const { board, editor } = setup()
    const canvas = /** @type {HTMLCanvasElement} */ (editor.el.querySelector('.map-editor__map'))
    const getContext = vi.fn(() => null)
    canvas.getContext = /** @type {any} */ (getContext)
    drag(board, [1, 1], [1, 1])
    // one tile painted on the stroke; nothing else (no full repaint from the echo)
    expect(getContext).toHaveBeenCalledTimes(1)
  })
})

describe('map editor view', () => {
  it('steps through the zoom levels and stops at the ends', () => {
    const { editor } = setup()
    expect(editor.state.zoom).toBe(2)
    press('+')
    expect(editor.state.zoom).toBe(3)
    press('=')
    press('+')
    press('+')
    press('+')
    expect(editor.state.zoom).toBe(8)
    expect(editor.el.style.getPropertyValue('--tile')).toBe('64px')
    for (let i = 0; i < 10; i++) press('-')
    expect(editor.state.zoom).toBe(1)
    expect(editor.el.style.getPropertyValue('--tile')).toBe('8px')
  })

  it('snaps a requested zoom to the nearest step', () => {
    const { editor } = setup()
    editor.setZoom(5)
    expect([4, 6]).toContain(editor.state.zoom)
    editor.setZoom(100)
    expect(editor.state.zoom).toBe(8)
  })

  it('zooms with Ctrl + wheel but scrolls on a plain wheel', () => {
    const { editor } = setup()
    const scroller = /** @type {HTMLElement} */ (editor.el.querySelector('.map-editor__scroll'))
    // happy-dom's WheelEvent drops the modifier and position fields, so the event is built by hand
    /** @param {number} deltaY @param {boolean} ctrlKey */
    const wheel = (deltaY, ctrlKey) => {
      const e = new Event('wheel', { bubbles: true, cancelable: true })
      Object.assign(e, { deltaY, ctrlKey, metaKey: false, clientX: 0, clientY: 0 })
      scroller.dispatchEvent(e)
      return e
    }
    expect(wheel(100, false).defaultPrevented).toBe(false)
    expect(editor.state.zoom).toBe(2)
    expect(wheel(-100, true).defaultPrevented).toBe(true)
    expect(editor.state.zoom).toBe(3)
    wheel(100, true)
    expect(editor.state.zoom).toBe(2)
  })

  it('picks tools with their letters and marks the board', () => {
    const { board, editor } = setup()
    for (const [key, tool] of /** @type {const} */ ([['f', 'fill'], ['l', 'line'], ['r', 'rect'], ['o', 'circle'], ['s', 'select'], ['i', 'pick'], ['h', 'pan'], ['e', 'eraser'], ['p', 'pen']])) {
      press(key)
      expect(editor.state.tool).toBe(tool)
      expect(board.dataset.tool).toBe(tool)
    }
  })

  it('does not paint with the pan tool, and pans while Space is held', () => {
    const { project, board, editor } = setup()
    editor.setTool('pan')
    drag(board, [1, 1], [4, 1])
    expect(tileOf(project, 2, 1)).toBe(0)

    editor.setTool('pen')
    press(' ')
    expect(board.dataset.pan).toBe('on')
    drag(board, [1, 1], [4, 1])
    expect(tileOf(project, 2, 1)).toBe(0)
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }))
    expect(board.dataset.pan).toBeUndefined()
    drag(board, [1, 1], [1, 1])
    expect(tileOf(project, 1, 1)).toBe(1)
  })

  it('toggles the grid', () => {
    const { editor } = setup()
    const button = /** @type {HTMLElement} */ (editor.el.querySelector('p8-button[title="Show grid"]'))
    expect(editor.el.dataset.grid).toBe('on')
    button.dispatchEvent(new CustomEvent('change', { detail: { pressed: false } }))
    expect(editor.el.dataset.grid).toBe('off')
  })

  it('reports the tile under the pointer, and when it is shared with the sprite sheet', () => {
    const project = Project.empty(pico8Profile)
    const setInfo = vi.fn()
    editor = createMapEditor({ project, setStatus: vi.fn(), setInfo, requestRun: vi.fn() })
    document.body.append(editor.el)
    const board = /** @type {HTMLElement} */ (editor.el.querySelector('.map-editor__board'))
    fakeLayout(board, 128, 64)
    editor.activate?.()
    pointer(board, 'pointermove', 5, 6)
    expect(setInfo).toHaveBeenLastCalledWith('x 5 y 6  tile 0')
    pointer(board, 'pointermove', 5, 40)
    expect(setInfo.mock.lastCall?.[0]).toMatch(/shared with the sprite sheet/)
  })

  it('ignores keys while a text field has the focus, and when it is hidden', () => {
    const { editor } = setup()
    const input = document.body.appendChild(document.createElement('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }))
    expect(editor.state.tool).toBe('pen')
    input.remove()
    editor.deactivate?.()
    press('f')
    expect(editor.state.tool).toBe('pen')
  })
})

describe('map editor keys', () => {
  it('names the keys in the tooltips', () => {
    const { editor } = setup()
    expect(editor.el.querySelector('p8-button[title="Eraser (E)"]')).not.toBeNull()
    expect(editor.el.querySelector('p8-button[title="Pan (H)"]')).not.toBeNull()
    expect(editor.el.querySelector('p8-button[title="Zoom in (+)"]')).not.toBeNull()
  })

  it('follows a rebound tool key, and the tooltip with it', () => {
    const bindings = createBindings(null)
    const { editor } = setup(bindings)
    bindings.assign('map:tool:fill', 'g')
    press('f')
    expect(editor.state.tool).toBe('pen')
    press('g')
    expect(editor.state.tool).toBe('fill')
    expect(editor.el.querySelector('p8-button[title="Fill (G)"]')).not.toBeNull()
  })

  it('zooms with rebound keys, and with either default key', () => {
    const bindings = createBindings(null)
    const { editor } = setup(bindings)
    expect(editor.state.zoom).toBe(2)
    press('+', { shiftKey: true })
    expect(editor.state.zoom).toBe(3)
    press('=')
    expect(editor.state.zoom).toBe(4)
    bindings.assign('map:zoomOut', 'z')
    press('-')
    expect(editor.state.zoom).toBe(4)
    press('z')
    expect(editor.state.zoom).toBe(3)
  })

  it('pans while the rebound key is held, and lets go when it is released', () => {
    const bindings = createBindings(null)
    const { board } = setup(bindings)
    bindings.assign('map:panHold', 'q')
    press(' ')
    expect(board.dataset.pan).toBeUndefined()
    press('q')
    expect(board.dataset.pan).toBe('on')
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }))
    expect(board.dataset.pan).toBe('on')
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'q' }))
    expect(board.dataset.pan).toBeUndefined()
  })

  it('stops panning when the editor is left with the key held', () => {
    const { board, editor } = setup()
    press(' ')
    editor.deactivate?.()
    expect(board.dataset.pan).toBeUndefined()
  })

  it('keeps the sprite editor\'s keys to itself', () => {
    const { editor } = setup()
    press('v')
    press('t')
    expect(editor.state.tool).toBe('pen')
  })
})
