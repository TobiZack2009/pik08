// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { defineElements } from '../../src/ui/elements/index.js'
import { createSpriteEditor } from '../../src/ui/editors/sprite/sprite-editor.js'
import { getPixel, setPixel } from '../../src/ui/editors/sprite/raster.js'
import { Project } from '../../src/ui/store.js'

beforeAll(() => defineElements())

/** @type {ReturnType<typeof createSpriteEditor> | undefined} */
let editor

afterEach(() => {
  editor?.destroy?.()
  editor?.el.remove()
  editor = undefined
})

/** The board is 80px wide per 8 view pixels, so one view pixel is 10px. */
const CELL = 10

/** @param {HTMLElement} el @param {number} cells  how many cells wide and tall */
function fakeLayout(el, cells) {
  el.getBoundingClientRect = () => /** @type {DOMRect} */ ({ left: 0, top: 0, right: cells * CELL, bottom: cells * CELL, width: cells * CELL, height: cells * CELL, x: 0, y: 0, toJSON() {} })
}

function setup() {
  const project = Project.empty(pico8Profile)
  const setStatus = vi.fn()
  const setInfo = vi.fn()
  editor = createSpriteEditor({ project, setStatus, setInfo, requestRun: vi.fn() })
  document.body.append(editor.el)
  const board = /** @type {HTMLElement} */ (editor.el.querySelector('.sprite-editor__board'))
  fakeLayout(board, 8)
  editor.activate?.()
  const events = /** @type {string[]} */ ([])
  project.on('rom', (d) => events.push(...d.regions))
  return { project, board, editor, setStatus, setInfo, events }
}

/**
 * @param {HTMLElement} el
 * @param {string} type
 * @param {number} x  view pixel
 * @param {number} y
 * @param {MouseEventInit} [init]
 */
function pointer(el, type, x, y, init = {}) {
  el.dispatchEvent(new MouseEvent(type, { clientX: x * CELL + CELL / 2, clientY: y * CELL + CELL / 2, button: 0, bubbles: true, cancelable: true, ...init }))
}

/**
 * A drag from one view pixel to another, through the pointer events.
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

const gfxOf = (/** @type {Project} */ project) => project.region('gfx')

describe('sprite editor drawing', () => {
  it('draws a stroke with the pen without gaps', () => {
    const { project, board } = setup()
    drag(board, [1, 1], [5, 1])
    const gfx = gfxOf(project)
    for (let x = 1; x <= 5; x++) expect(getPixel(gfx, x, 1)).toBe(7)
    expect(getPixel(gfx, 0, 1)).toBe(0)
    expect(getPixel(gfx, 6, 1)).toBe(0)
    expect(project.dirty).toBe(true)
  })

  it('tells the other editors, once per gesture', () => {
    const { board, events } = setup()
    drag(board, [0, 0], [3, 3])
    expect(events).toEqual(['gfx'])
  })

  it('erases with the eraser', () => {
    const { project, board, editor } = setup()
    setPixel(gfxOf(project), 2, 2, 9)
    editor.setTool('eraser')
    drag(board, [2, 2], [2, 2])
    expect(getPixel(gfxOf(project), 2, 2)).toBe(0)
  })

  it('fills an area', () => {
    const { project, board, editor } = setup()
    editor.setColor(3)
    editor.setTool('fill')
    pointer(board, 'pointerdown', 4, 4)
    pointer(board, 'pointerup', 4, 4)
    const gfx = gfxOf(project)
    expect(getPixel(gfx, 0, 0)).toBe(3)
    expect(getPixel(gfx, 7, 7)).toBe(3)
    expect(getPixel(gfx, 8, 0)).toBe(0) // the next sprite is outside the view
  })

  it('draws a line on release, not before', () => {
    const { project, board, editor } = setup()
    editor.setTool('line')
    pointer(board, 'pointerdown', 0, 0)
    pointer(board, 'pointermove', 4, 0)
    expect(getPixel(gfxOf(project), 2, 0)).toBe(0)
    pointer(board, 'pointerup', 4, 0)
    expect(getPixel(gfxOf(project), 2, 0)).toBe(7)
  })

  it('draws outlined and filled rectangles', () => {
    const { project, board, editor } = setup()
    editor.setTool('rect')
    drag(board, [1, 1], [5, 5])
    expect(getPixel(gfxOf(project), 1, 1)).toBe(7)
    expect(getPixel(gfxOf(project), 3, 3)).toBe(0)
    editor.state.filled = true
    drag(board, [1, 1], [5, 5])
    expect(getPixel(gfxOf(project), 3, 3)).toBe(7)
  })

  it('keeps shapes inside the view when dragged past the edge', () => {
    const { project, board, editor } = setup()
    editor.setTool('rect')
    editor.state.filled = true
    drag(board, [5, 5], [30, 30])
    const gfx = gfxOf(project)
    expect(getPixel(gfx, 7, 7)).toBe(7)
    expect(getPixel(gfx, 8, 8)).toBe(0)
  })

  it('picks a colour with the pick tool and with the right button', () => {
    const { project, board, editor } = setup()
    setPixel(gfxOf(project), 1, 1, 12)
    setPixel(gfxOf(project), 2, 2, 5)
    editor.setTool('pick')
    pointer(board, 'pointerdown', 1, 1)
    expect(editor.state.color).toBe(12)
    expect(editor.el.querySelector('p8-palette')?.getAttribute('value')).toBe('12')
    editor.setTool('pen')
    pointer(board, 'pointerdown', 2, 2, { button: 2 })
    expect(editor.state.color).toBe(5)
    expect(getPixel(gfxOf(project), 3, 3)).toBe(0) // no drawing happened
  })

  it('changes the colour from the palette', () => {
    const { project, board, editor } = setup()
    const swatch = /** @type {HTMLElement} */ (editor.el.querySelector('.p8-swatch[data-index="9"]'))
    swatch.click()
    expect(editor.state.color).toBe(9)
    drag(board, [0, 0], [0, 0])
    expect(getPixel(gfxOf(project), 0, 0)).toBe(9)
  })
})

describe('sprite editor undo', () => {
  it('undoes and redoes a gesture with the keyboard', () => {
    const { project, board } = setup()
    drag(board, [0, 0], [3, 0])
    press('z', { ctrlKey: true })
    expect(getPixel(gfxOf(project), 1, 0)).toBe(0)
    press('z', { ctrlKey: true, shiftKey: true })
    expect(getPixel(gfxOf(project), 1, 0)).toBe(7)
    press('z', { metaKey: true })
    press('y', { ctrlKey: true })
    expect(getPixel(gfxOf(project), 1, 0)).toBe(7)
  })

  it('forgets history when a cart is loaded', () => {
    const { project, board, editor } = setup()
    drag(board, [0, 0], [3, 0])
    project.load(Project.empty(pico8Profile).cart, 'other.p8')
    editor.undo()
    expect(getPixel(gfxOf(project), 1, 0)).toBe(0)
  })

  it('does not respond to keys while hidden', () => {
    const { project, board, editor } = setup()
    drag(board, [0, 0], [3, 0])
    editor.deactivate?.()
    press('z', { ctrlKey: true })
    expect(getPixel(gfxOf(project), 1, 0)).toBe(7)
  })
})

describe('sprite editor selection and transforms', () => {
  it('marks an area and flips it', () => {
    const { project, board, editor } = setup()
    setPixel(gfxOf(project), 0, 0, 4)
    editor.setTool('select')
    drag(board, [0, 0], [3, 3])
    expect(editor.state.area).toEqual({ x: 0, y: 0, w: 4, h: 4 })
    press('h')
    expect(getPixel(gfxOf(project), 3, 0)).toBe(4)
    expect(getPixel(gfxOf(project), 0, 0)).toBe(0)
  })

  it('drops the marked area on a click or Escape', () => {
    const { board, editor } = setup()
    editor.setTool('select')
    drag(board, [0, 0], [3, 3])
    pointer(board, 'pointerdown', 5, 5)
    pointer(board, 'pointerup', 5, 5)
    expect(editor.state.area).toBeNull()
    drag(board, [0, 0], [3, 3])
    press('Escape')
    expect(editor.state.area).toBeNull()
  })

  it('copies and pastes', () => {
    const { project, board, editor, setStatus } = setup()
    press('v', { ctrlKey: true })
    expect(setStatus).toHaveBeenLastCalledWith('Nothing to paste')
    setPixel(gfxOf(project), 0, 0, 4)
    editor.setTool('select')
    drag(board, [0, 0], [1, 1])
    press('c', { ctrlKey: true })
    pointer(board, 'pointermove', 5, 5) // paste goes where the pointer is
    press('v', { ctrlKey: true })
    expect(getPixel(gfxOf(project), 5, 5)).toBe(4)
    expect(getPixel(gfxOf(project), 0, 0)).toBe(4) // still there
  })

  it('cuts', () => {
    const { project, editor, board } = setup()
    setPixel(gfxOf(project), 0, 0, 4)
    editor.setTool('select')
    drag(board, [0, 0], [1, 1])
    press('x', { ctrlKey: true })
    expect(getPixel(gfxOf(project), 0, 0)).toBe(0)
  })

  it('shifts the pixels with Shift and the arrows, wrapping around', () => {
    const { project } = setup()
    setPixel(gfxOf(project), 7, 0, 4)
    press('ArrowRight', { shiftKey: true })
    expect(getPixel(gfxOf(project), 0, 0)).toBe(4)
    expect(getPixel(gfxOf(project), 7, 0)).toBe(0)
  })

  it('rotates a square area and refuses a rectangle', () => {
    const { project, board, editor, setStatus } = setup()
    setPixel(gfxOf(project), 0, 0, 4)
    press('t')
    expect(getPixel(gfxOf(project), 7, 0)).toBe(4)
    editor.setTool('select')
    drag(board, [0, 0], [3, 1])
    press('t')
    expect(setStatus).toHaveBeenLastCalledWith('Rotating needs a square area')
  })

  it('clears with Delete', () => {
    const { project } = setup()
    setPixel(gfxOf(project), 2, 2, 4)
    press('Delete')
    expect(getPixel(gfxOf(project), 2, 2)).toBe(0)
  })
})

describe('sprite editor sprite selection', () => {
  it('moves the selection with the arrow keys and edits that sprite', () => {
    const { project, board, editor, setInfo } = setup()
    press('ArrowRight')
    press('ArrowDown')
    expect(editor.state.selection).toEqual({ col: 1, row: 1, w: 1, h: 1 })
    expect(setInfo).toHaveBeenLastCalledWith('Sprite 17')
    drag(board, [0, 0], [0, 0])
    expect(getPixel(gfxOf(project), 8, 8)).toBe(7)
    expect(getPixel(gfxOf(project), 0, 0)).toBe(0)
  })

  it('stays inside the sheet', () => {
    const { editor } = setup()
    press('ArrowLeft')
    press('ArrowUp')
    expect(editor.state.selection).toEqual({ col: 0, row: 0, w: 1, h: 1 })
  })

  it('selects several sprites by dragging on the sheet and shows them as one image', () => {
    const { project, editor } = setup()
    const sheet = /** @type {HTMLCanvasElement} */ (editor.el.querySelector('.sprite-picker__sheet'))
    sheet.getBoundingClientRect = () => /** @type {DOMRect} */ ({ left: 0, top: 0, right: 160, bottom: 160, width: 160, height: 160, x: 0, y: 0, toJSON() {} })
    const at = (/** @type {string} */ type, /** @type {number} */ col, /** @type {number} */ row) =>
      sheet.dispatchEvent(new MouseEvent(type, { clientX: col * 10 + 5, clientY: row * 10 + 5, button: 0, bubbles: true, cancelable: true }))
    at('pointerdown', 2, 1)
    at('pointermove', 3, 2)
    at('pointerup', 3, 2)
    expect(editor.state.selection).toEqual({ col: 2, row: 1, w: 2, h: 2 })
    const canvas = /** @type {HTMLCanvasElement} */ (editor.el.querySelector('.sprite-editor__board canvas'))
    expect([canvas.width, canvas.height]).toEqual([16, 16])
    const board = /** @type {HTMLElement} */ (editor.el.querySelector('.sprite-editor__board'))
    fakeLayout(board, 16)
    pointer(board, 'pointerdown', 12, 12)
    pointer(board, 'pointerup', 12, 12)
    expect(getPixel(gfxOf(project), 16 + 12, 8 + 12)).toBe(7)
  })
})

describe('sprite editor flags', () => {
  it('toggles a flag on the selected sprite and tells the flags region', () => {
    const { project, editor, events } = setup()
    const buttons = /** @type {HTMLElement[]} */ ([...editor.el.querySelectorAll('.sprite-editor__flag')])
    expect(buttons).toHaveLength(8)
    buttons[2].click()
    expect(project.region('flags')[0]).toBe(4)
    expect(buttons[2].getAttribute('aria-pressed')).toBe('true')
    expect(events).toEqual(['flags'])
    buttons[2].click()
    expect(project.region('flags')[0]).toBe(0)
  })

  it('shows a flag set on only some of the sprites as mixed, and sets all on click', () => {
    const { project, editor } = setup()
    project.region('flags')[0] = 1 // sprite 0 has flag 0
    const sheet = /** @type {HTMLCanvasElement} */ (editor.el.querySelector('.sprite-picker__sheet'))
    sheet.getBoundingClientRect = () => /** @type {DOMRect} */ ({ left: 0, top: 0, right: 160, bottom: 160, width: 160, height: 160, x: 0, y: 0, toJSON() {} })
    const at = (/** @type {string} */ type, /** @type {number} */ col) => sheet.dispatchEvent(new MouseEvent(type, { clientX: col * 10 + 5, clientY: 5, button: 0, bubbles: true, cancelable: true }))
    at('pointerdown', 0)
    at('pointermove', 1)
    at('pointerup', 1)
    const flag0 = /** @type {HTMLElement} */ (editor.el.querySelector('.sprite-editor__flag'))
    expect(flag0.getAttribute('aria-pressed')).toBe('mixed')
    flag0.click()
    expect(project.region('flags').slice(0, 2)).toEqual(Uint8Array.of(1, 1))
    flag0.click()
    expect(project.region('flags').slice(0, 2)).toEqual(Uint8Array.of(0, 0))
  })

  it('undoes a flag change', () => {
    const { project, editor } = setup()
    const flag0 = /** @type {HTMLElement} */ (editor.el.querySelector('.sprite-editor__flag'))
    flag0.click()
    press('z', { ctrlKey: true })
    expect(project.region('flags')[0]).toBe(0)
    expect(flag0.getAttribute('aria-pressed')).toBe('false')
  })
})

describe('sprite editor tool keys', () => {
  it('switches tools with single letters', () => {
    const { editor } = setup()
    press('l')
    expect(editor.state.tool).toBe('line')
    press('e')
    expect(editor.state.tool).toBe('eraser')
    press('p')
    expect(editor.state.tool).toBe('pen')
  })

  it('steps through the colours', () => {
    const { editor } = setup()
    press(']')
    expect(editor.state.color).toBe(8)
    editor.setColor(0)
    press('[')
    expect(editor.state.color).toBe(15)
  })

  it('ignores keys with a modifier it does not know and keys typed into fields', () => {
    const { editor } = setup()
    press('l', { altKey: true })
    expect(editor.state.tool).toBe('pen')
    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }))
    expect(editor.state.tool).toBe('pen')
    input.remove()
  })
})

describe('sprite editor and the rest of the app', () => {
  it('shows changes made by another editor', () => {
    const { project, editor } = setup()
    setPixel(gfxOf(project), 1, 1, 6)
    project.notifyRom(['gfx'], 'elsewhere')
    // no canvas in happy-dom, so check that the call path does not throw and the view is intact
    expect(editor.state.selection.w).toBe(1)
  })

  it('reports the pixel under the pointer', () => {
    const { board, setInfo } = setup()
    pointer(board, 'pointermove', 3, 4)
    expect(setInfo).toHaveBeenLastCalledWith('Sprite 0  x 3 y 4')
  })
})
