// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { defineElements } from '../../src/ui/elements/index.js'
import { createRoll } from '../../src/ui/editors/sound/roll.js'
import { createSoundEditor } from '../../src/ui/editors/sound/sound-editor.js'
import { createRegionEdits } from '../../src/ui/editors/region-edits.js'
import { layoutFor, lanesLayout, GUTTER, RULER } from '../../src/ui/editors/sound/roll-ops.js'
import { readHeader, readNote, writeNote } from '../../src/ui/editors/sfx/sfx-data.js'
import { Project } from '../../src/ui/store.js'

beforeAll(() => defineElements())

/** @type {{ destroy?: () => void, el: HTMLElement } | undefined} */
let current

afterEach(() => {
  current?.destroy?.()
  current?.el.remove()
  current = undefined
})

// the middle zoom, which is the default; the canvases are at the origin of the fake page
const L = layoutFor(1)
const ID = 3

function fakeSound() {
  return {
    play: vi.fn(),
    stop: vi.fn(),
    playing: vi.fn(() => false),
    position: vi.fn(() => -1),
    playMusic: vi.fn(),
    musicBar: vi.fn(() => -1),
  }
}

function setup({ withSound = true } = {}) {
  const project = Project.empty(pico8Profile)
  const sound = fakeSound()
  /** @type {ReturnType<typeof createRoll>} */
  let roll
  const edits = createRegionEdits(project, ['sfx'], Symbol('test'), () => roll.refresh())
  roll = createRoll({ project, edits, getId: () => ID, sound: withSound ? /** @type {any} */ (sound) : undefined, setInfo: vi.fn() })
  document.body.append(roll.el)
  roll.activate()
  current = roll
  const grid = /** @type {HTMLCanvasElement} */ (roll.el.querySelector('.roll__grid'))
  const ruler = /** @type {HTMLCanvasElement} */ (roll.el.querySelector('.roll__ruler'))
  const lanes = /** @type {HTMLCanvasElement} */ (roll.el.querySelector('.roll__lanes'))
  const sfx = () => project.region('sfx')
  const note = (/** @type {number} */ step) => readNote(sfx(), ID, step)
  return { project, roll, edits, sound, grid, ruler, lanes, sfx, note }
}

/** @param {HTMLElement} el @param {string} type @param {number} x @param {number} y @param {MouseEventInit} [init] */
function fire(el, type, x, y, init = {}) {
  el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...init }))
}

/** The pixel in the middle of a cell of the grid. @param {number} step @param {number} pitch */
const cell = (step, pitch) => [GUTTER + step * L.cellW + 3, (63 - pitch) * L.cellH + 3]

/** @param {HTMLElement} el @param {number} step @param {number} pitch @param {MouseEventInit} [init] */
function click(el, step, pitch, init) {
  const [x, y] = cell(step, pitch)
  fire(el, 'pointerdown', x, y, init)
  fire(el, 'pointerup', x, y, init)
}

/** @param {HTMLElement} el @param {[number, number]} from @param {[number, number]} to */
function drag(el, from, to) {
  const [x0, y0] = cell(...from)
  const [x1, y1] = cell(...to)
  fire(el, 'pointerdown', x0, y0)
  fire(el, 'pointermove', x1, y1)
  fire(el, 'pointerup', x1, y1)
}

/** @param {string} key @param {KeyboardEventInit} [init] */
function key(key, init = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

/** Selects steps by dragging over the ruler. @param {ReturnType<typeof setup>} s @param {number} a @param {number} b */
function selectSteps(s, a, b) {
  const y = RULER / 2
  fire(s.ruler, 'pointerdown', GUTTER + a * L.cellW + 2, y)
  fire(s.ruler, 'pointermove', GUTTER + b * L.cellW + 2, y)
  fire(s.ruler, 'pointerup', GUTTER + b * L.cellW + 2, y)
}

describe('drawing', () => {
  it('puts a note down with the brush', () => {
    const s = setup()
    click(s.grid, 5, 30)
    expect(s.note(5)).toEqual({ pitch: 30, wave: 0, vol: 5, fx: 0 })
  })

  it('draws a note on every step of a drag, following the pointer in pitch', () => {
    const s = setup()
    drag(s.grid, [2, 20], [6, 28])
    expect([2, 3, 4, 5, 6].map((n) => s.note(n).pitch)).toEqual([20, 22, 24, 26, 28])
    expect(s.note(1).pitch).toBe(0)
    expect(s.note(7).vol).toBe(0)
  })

  it('draws leftwards too, and moves a note up and down inside its step', () => {
    const s = setup()
    drag(s.grid, [6, 28], [4, 20])
    expect([4, 5, 6].map((n) => s.note(n).pitch)).toEqual([20, 24, 28])
    const [x, y] = cell(4, 40)
    fire(s.grid, 'pointerdown', x, y)
    fire(s.grid, 'pointerup', x, y)
    expect(s.note(4).pitch).toBe(40)
  })

  it('uses the instrument, volume and effect of the brush', () => {
    const s = setup()
    const wave = /** @type {HTMLSelectElement} */ (s.roll.el.querySelector('select[aria-label="instrument"]'))
    wave.value = '13'
    wave.dispatchEvent(new Event('change'))
    const vol = /** @type {HTMLInputElement} */ (s.roll.el.querySelector('input[aria-label="volume"]'))
    vol.value = '7'
    vol.dispatchEvent(new Event('change'))
    const fx = /** @type {HTMLSelectElement} */ (s.roll.el.querySelector('select[aria-label="effect"]'))
    fx.value = '3'
    fx.dispatchEvent(new Event('change'))
    click(s.grid, 0, 12)
    expect(s.note(0)).toEqual({ pitch: 12, wave: 13, vol: 7, fx: 3 })
  })

  it('clamps a typed volume', () => {
    const s = setup()
    const vol = /** @type {HTMLInputElement} */ (s.roll.el.querySelector('input[aria-label="volume"]'))
    vol.value = '99'
    vol.dispatchEvent(new Event('change'))
    expect(s.roll.state.brush.vol).toBe(7)
    vol.value = ''
    vol.dispatchEvent(new Event('change'))
    expect(s.roll.state.brush.vol).toBe(7)
  })

  it('takes a note away when drawing the same one again, and keeps erasing through the drag', () => {
    const s = setup()
    drag(s.grid, [2, 20], [6, 20])
    expect([2, 3, 4, 5, 6].every((n) => s.note(n).pitch === 20)).toBe(true)
    drag(s.grid, [2, 20], [4, 20])
    expect([2, 3, 4].every((n) => s.note(n).vol === 0 && s.note(n).pitch === 0)).toBe(true)
    expect(s.note(5).pitch).toBe(20)
  })

  it('erases with the erase tool', () => {
    const s = setup()
    drag(s.grid, [2, 20], [6, 20])
    s.roll.setTool('erase')
    drag(s.grid, [3, 50], [4, 50])
    expect(s.note(3).vol).toBe(0)
    expect(s.note(4).vol).toBe(0)
    expect(s.note(5).vol).toBe(5)
  })

  it('stays out of the way outside the grid', () => {
    const s = setup()
    fire(s.grid, 'pointerdown', 5, 5)
    fire(s.grid, 'pointerup', 5, 5)
    expect(s.sfx().subarray(ID * 68, ID * 68 + 64).every((b) => b === 0)).toBe(true)
  })

  it('keeps a drag that leaves the grid on its edge', () => {
    const s = setup()
    const [x0, y0] = cell(28, 10)
    fire(s.grid, 'pointerdown', x0, y0)
    fire(s.grid, 'pointermove', 9999, y0)
    fire(s.grid, 'pointerup', 9999, y0)
    expect(s.note(31).pitch).toBe(10)
    expect(s.sfx().subarray(4 * 68, 4 * 68 + 64).every((b) => b === 0)).toBe(true)
  })

  it('does nothing to other sfx', () => {
    const s = setup()
    writeNote(s.sfx(), 4, 0, { pitch: 9, wave: 1, vol: 2, fx: 0 })
    drag(s.grid, [0, 20], [31, 20])
    expect(readNote(s.sfx(), 4, 0).pitch).toBe(9)
  })
})

describe('undo', () => {
  it('makes a whole stroke one step', () => {
    const s = setup()
    drag(s.grid, [2, 20], [6, 28])
    expect(s.edits.history.undoStack).toHaveLength(1)
    s.edits.undo()
    expect([2, 3, 4, 5, 6].every((n) => s.note(n).vol === 0)).toBe(true)
    s.edits.redo()
    expect(s.note(6).pitch).toBe(28)
  })

  it('records nothing for a click that changes nothing', () => {
    const s = setup()
    s.roll.setTool('erase')
    click(s.grid, 2, 20)
    expect(s.edits.history.undoStack).toHaveLength(0)
  })

  it('puts the bytes back when a stroke is cancelled', () => {
    const s = setup()
    const [x, y] = cell(2, 20)
    fire(s.grid, 'pointerdown', x, y)
    expect(s.note(2).pitch).toBe(20)
    fire(s.grid, 'pointercancel', x, y)
    expect(s.note(2).pitch).toBe(0)
    expect(s.edits.history.undoStack).toHaveLength(0)
  })

  it('tells the project about the edit once, at the end of the stroke', () => {
    const s = setup()
    const heard = vi.fn()
    s.project.on('rom:sfx', heard)
    drag(s.grid, [2, 20], [6, 28])
    expect(heard).toHaveBeenCalledTimes(1)
    expect(s.project.dirty).toBe(true)
  })
})

describe('picking', () => {
  it('takes the instrument, volume and effect of a note with the right button', () => {
    const s = setup()
    writeNote(s.sfx(), ID, 4, { pitch: 20, wave: 11, vol: 3, fx: 6 })
    click(s.grid, 4, 20, { button: 2 })
    expect(s.roll.state.brush).toEqual({ wave: 11, vol: 3, fx: 6 })
    expect(s.note(4)).toEqual({ pitch: 20, wave: 11, vol: 3, fx: 6 })
  })

  it('ignores an empty step', () => {
    const s = setup()
    click(s.grid, 4, 20, { button: 2 })
    expect(s.roll.state.brush).toEqual({ wave: 0, vol: 5, fx: 0 })
  })
})

describe('selecting', () => {
  it('selects steps by dragging over the ruler, in either direction', () => {
    const s = setup()
    selectSteps(s, 3, 7)
    expect(s.roll.state.selection).toEqual([3, 7])
    selectSteps(s, 9, 5)
    expect(s.roll.state.selection).toEqual([5, 9])
  })

  it('selects with the select tool, and a plain click drops the selection', () => {
    const s = setup()
    s.roll.setTool('select')
    drag(s.grid, [2, 30], [5, 10])
    expect(s.roll.state.selection).toEqual([2, 5])
    click(s.grid, 8, 30)
    expect(s.roll.state.selection).toBeNull()
    expect(s.edits.history.undoStack).toHaveLength(0)
  })

  it('selects everything with Ctrl+A and nothing with Escape', () => {
    const s = setup()
    key('a', { ctrlKey: true })
    expect(s.roll.state.selection).toEqual([0, 31])
    key('Escape')
    expect(s.roll.state.selection).toBeNull()
  })

  it('shows a box over the selection', () => {
    const s = setup()
    const box = /** @type {HTMLElement} */ (s.roll.el.querySelector('.roll__selection'))
    expect(box.hidden).toBe(true)
    s.roll.select([2, 4])
    expect(box.hidden).toBe(false)
    expect(box.style.left).toBe(`${GUTTER + 2 * L.cellW}px`)
    expect(box.style.width).toBe(`${3 * L.cellW}px`)
  })
})

describe('editing the selection', () => {
  /** @param {ReturnType<typeof setup>} s */
  function twoNotes(s) {
    writeNote(s.sfx(), ID, 2, { pitch: 20, wave: 1, vol: 4, fx: 0 })
    writeNote(s.sfx(), ID, 3, { pitch: 24, wave: 1, vol: 4, fx: 0 })
    writeNote(s.sfx(), ID, 9, { pitch: 40, wave: 1, vol: 4, fx: 0 })
    s.roll.select([2, 5])
  }

  it('transposes with the arrow keys, an octave with Shift', () => {
    const s = setup()
    twoNotes(s)
    key('ArrowUp')
    expect([s.note(2).pitch, s.note(3).pitch]).toEqual([21, 25])
    key('ArrowDown', { shiftKey: true })
    expect([s.note(2).pitch, s.note(3).pitch]).toEqual([9, 13])
    expect(s.note(9).pitch).toBe(40)
  })

  it('moves the notes sideways with the left and right arrows, and the selection with them', () => {
    const s = setup()
    twoNotes(s)
    key('ArrowRight')
    expect(s.note(2).vol).toBe(0)
    expect(s.note(3).pitch).toBe(20)
    expect(s.note(4).pitch).toBe(24)
    expect(s.roll.state.selection).toEqual([3, 6])
    key('ArrowLeft')
    key('ArrowLeft')
    expect(s.note(1).pitch).toBe(20)
    expect(s.roll.state.selection).toEqual([1, 4])
  })

  it('deletes with Delete and Backspace', () => {
    const s = setup()
    twoNotes(s)
    key('Delete')
    expect(s.note(2).vol).toBe(0)
    expect(s.note(3).vol).toBe(0)
    expect(s.note(9).pitch).toBe(40)
  })

  it('copies, pastes at the selection, and selects what it pasted', () => {
    const s = setup()
    twoNotes(s)
    key('c', { ctrlKey: true })
    s.roll.select([12, 12])
    key('v', { ctrlKey: true })
    expect(s.note(12).pitch).toBe(20)
    expect(s.note(13).pitch).toBe(24)
    expect(s.roll.state.selection).toEqual([12, 15])
    // the original is still there
    expect(s.note(2).pitch).toBe(20)
  })

  it('cuts', () => {
    const s = setup()
    twoNotes(s)
    key('x', { ctrlKey: true })
    expect(s.note(2).vol).toBe(0)
    s.roll.select([20, 20])
    key('v', { ctrlKey: true })
    expect(s.note(20).pitch).toBe(20)
    expect(s.note(21).pitch).toBe(24)
  })

  it('pastes at the start without a selection', () => {
    const s = setup()
    twoNotes(s)
    key('c', { ctrlKey: true })
    s.roll.select(null)
    key('v', { ctrlKey: true })
    expect(s.note(0).pitch).toBe(20)
  })

  it('takes the new instrument, volume or effect of the brush onto the selected notes', () => {
    const s = setup()
    twoNotes(s)
    const fx = /** @type {HTMLSelectElement} */ (s.roll.el.querySelector('select[aria-label="effect"]'))
    fx.value = '2'
    fx.dispatchEvent(new Event('change'))
    expect(s.note(2)).toMatchObject({ fx: 2, vol: 4, wave: 1 })
    expect(s.note(3).fx).toBe(2)
    expect(s.note(9).fx).toBe(0)
    expect(s.note(4).vol).toBe(0)
  })

  it('makes each edit one undo step', () => {
    const s = setup()
    twoNotes(s)
    key('ArrowUp')
    key('ArrowUp')
    expect(s.edits.history.undoStack).toHaveLength(2)
    s.edits.undo()
    expect(s.note(2).pitch).toBe(21)
  })

  it('ignores the arrows without a selection', () => {
    const s = setup()
    writeNote(s.sfx(), ID, 2, { pitch: 20, wave: 1, vol: 4, fx: 0 })
    const e = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(s.note(2).pitch).toBe(20)
  })

  it('does not take Ctrl+Z, which belongs to the editor around it', () => {
    const s = setup()
    const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(s.roll.state.selection).toBeNull()
  })
})

describe('the loop', () => {
  it('sets the loop to the selection, and removes it again', () => {
    const s = setup()
    s.roll.select([4, 11])
    const [loop, unloop] = /** @type {HTMLElement[]} */ ([...s.roll.el.querySelectorAll('p8-button')].filter((b) => /loop/i.test(b.getAttribute('title') ?? '')))
    expect(unloop.hasAttribute('disabled')).toBe(true)
    loop.querySelector('button')?.click()
    expect(readHeader(s.sfx(), ID)).toMatchObject({ loopStart: 4, loopEnd: 12 })
    expect(unloop.hasAttribute('disabled')).toBe(false)
    unloop.querySelector('button')?.click()
    expect(readHeader(s.sfx(), ID)).toMatchObject({ loopStart: 0, loopEnd: 0 })
  })
})

describe('the lanes', () => {
  const lane = lanesLayout(L)

  it('sets the volume of a note by dragging in the volume lane, and leaves empty steps alone', () => {
    const s = setup()
    writeNote(s.sfx(), ID, 2, { pitch: 20, wave: 1, vol: 4, fx: 0 })
    writeNote(s.sfx(), ID, 4, { pitch: 20, wave: 1, vol: 4, fx: 0 })
    const x = (/** @type {number} */ step) => GUTTER + step * L.cellW + 3
    fire(s.lanes, 'pointerdown', x(2), lane.vol.y)
    expect(s.note(2).vol).toBe(7)
    fire(s.lanes, 'pointermove', x(3), lane.vol.y + lane.vol.h - 1)
    fire(s.lanes, 'pointermove', x(4), lane.vol.y + lane.vol.h - 1)
    fire(s.lanes, 'pointerup', x(4), lane.vol.y + lane.vol.h - 1)
    expect(s.note(4).vol).toBe(0)
    expect(s.note(3)).toEqual({ pitch: 0, wave: 0, vol: 0, fx: 0 })
    expect(s.note(2).vol).toBe(7)
    expect(s.edits.history.undoStack).toHaveLength(1)
  })

  it('keeps following a drag that leaves the lane', () => {
    const s = setup()
    writeNote(s.sfx(), ID, 2, { pitch: 20, wave: 1, vol: 4, fx: 0 })
    const x = GUTTER + 2 * L.cellW + 3
    fire(s.lanes, 'pointerdown', x, lane.vol.y + 20)
    fire(s.lanes, 'pointermove', x, -500)
    fire(s.lanes, 'pointerup', x, -500)
    expect(s.note(2).vol).toBe(7)
  })

  it('gives a note the instrument and the effect of the brush', () => {
    const s = setup()
    writeNote(s.sfx(), ID, 2, { pitch: 20, wave: 1, vol: 4, fx: 0 })
    s.roll.state.brush = { wave: 9, vol: 2, fx: 5 }
    const x = GUTTER + 2 * L.cellW + 3
    fire(s.lanes, 'pointerdown', x, lane.wave.y + 2)
    fire(s.lanes, 'pointerup', x, lane.wave.y + 2)
    expect(s.note(2)).toEqual({ pitch: 20, wave: 9, vol: 4, fx: 0 })
    fire(s.lanes, 'pointerdown', x, lane.fx.y + 2)
    fire(s.lanes, 'pointerup', x, lane.fx.y + 2)
    expect(s.note(2)).toEqual({ pitch: 20, wave: 9, vol: 4, fx: 5 })
  })
})

describe('sound', () => {
  it('lets a note be heard as it is put down, once per step', () => {
    const s = setup()
    drag(s.grid, [2, 20], [4, 20])
    expect(s.sound.play).toHaveBeenCalledWith(ID, 2, 1)
    expect(s.sound.play).toHaveBeenLastCalledWith(ID, 4, 1)
    expect(s.sound.play).toHaveBeenCalledTimes(2)
  })

  it('is quiet when erasing', () => {
    const s = setup()
    writeNote(s.sfx(), ID, 2, { pitch: 20, wave: 0, vol: 5, fx: 0 })
    s.roll.setTool('erase')
    click(s.grid, 2, 20)
    expect(s.sound.play).not.toHaveBeenCalled()
  })

  it('plays and stops with Space', () => {
    const s = setup()
    key(' ')
    expect(s.sound.play).toHaveBeenCalledWith(ID)
    s.sound.playing.mockReturnValue(true)
    key(' ')
    expect(s.sound.stop).toHaveBeenCalledTimes(1)
  })

  it('does not take Space from a field', () => {
    const s = setup()
    const input = /** @type {HTMLInputElement} */ (s.roll.el.querySelector('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    expect(s.sound.play).not.toHaveBeenCalled()
  })

  it('shows the playhead where the sound is', () => {
    const s = setup()
    const head = /** @type {HTMLElement} */ (s.roll.el.querySelector('.roll__playhead'))
    expect(head.hidden).toBe(true)
    s.sound.position.mockReturnValue(2.5)
    s.roll.tick()
    expect(head.hidden).toBe(false)
    expect(head.style.left).toBe(`${GUTTER + 2.5 * L.cellW}px`)
    s.sound.position.mockReturnValue(-1)
    s.roll.tick()
    expect(head.hidden).toBe(true)
  })

  it('silences the sound when its tab is left', () => {
    const s = setup()
    s.roll.deactivate()
    expect(s.sound.stop).toHaveBeenCalled()
  })

  it('works without a sound service', () => {
    const s = setup({ withSound: false })
    click(s.grid, 2, 20)
    key(' ')
    expect(s.note(2).pitch).toBe(20)
  })
})

describe('tools, zoom and shortcuts', () => {
  it('switches tool with D, E and S', () => {
    const s = setup()
    key('s')
    expect(s.roll.state.tool).toBe('select')
    key('e')
    expect(s.roll.state.tool).toBe('erase')
    key('d')
    expect(s.roll.state.tool).toBe('draw')
  })

  it('does not take keys while it is not active', () => {
    const s = setup()
    s.roll.deactivate()
    key('e')
    expect(s.roll.state.tool).toBe('draw')
  })

  it('resizes the canvases with the zoom, within the limits', () => {
    const s = setup()
    const before = s.grid.width
    s.roll.setZoom(2)
    expect(s.grid.width).toBeGreaterThan(before)
    s.roll.setZoom(99)
    expect(s.roll.state.zoom).toBe(2)
    s.roll.setZoom(-9)
    expect(s.roll.state.zoom).toBe(0)
    expect(s.grid.width).toBeLessThan(before)
    expect(s.ruler.width).toBe(s.grid.width)
    expect(s.lanes.width).toBe(s.grid.width)
  })

  it('draws on the cells of the new zoom', () => {
    const s = setup()
    s.roll.setZoom(0)
    const l0 = layoutFor(0)
    fire(s.grid, 'pointerdown', GUTTER + 5 * l0.cellW + 2, 10 * l0.cellH + 2)
    fire(s.grid, 'pointerup', GUTTER + 5 * l0.cellW + 2, 10 * l0.cellH + 2)
    expect(s.note(5).pitch).toBe(53)
  })
})

describe('in the sound editor', () => {
  function editorSetup() {
    const project = Project.empty(pico8Profile)
    const sound = fakeSound()
    const sounds = createSoundEditor({ project, setStatus: vi.fn(), setInfo: vi.fn(), requestRun: vi.fn(), sound: /** @type {any} */ (sound) })
    document.body.append(sounds.el)
    sounds.activate?.()
    current = sounds
    sounds.setFocus('pattern')
    const editor = {
      el: sounds.pattern.el,
      state: sounds.pattern.state,
      roll: sounds.pattern.roll,
      select: sounds.pattern.select,
      setView: sounds.pattern.setView,
      undo: sounds.undo,
    }
    return { project, editor, sound }
  }

  it('shows the roll first, and the table when asked', () => {
    const { editor } = editorSetup()
    const roll = /** @type {HTMLElement} */ (editor.el.querySelector('.roll'))
    const table = /** @type {HTMLElement} */ (editor.el.querySelector('.tracker__grid'))
    expect(roll.hidden).toBe(false)
    expect(table.hidden).toBe(true)
    editor.setView('table')
    expect(roll.hidden).toBe(true)
    expect(table.hidden).toBe(false)
    expect(editor.state.view).toBe('table')
  })

  it('draws into the selected sfx and undoes with the editor', () => {
    const { project, editor } = editorSetup()
    editor.select(7)
    const grid = /** @type {HTMLCanvasElement} */ (editor.el.querySelector('.roll__grid'))
    click(grid, 3, 30)
    expect(readNote(project.region('sfx'), 7, 3).pitch).toBe(30)
    editor.undo()
    expect(readNote(project.region('sfx'), 7, 3).pitch).toBe(0)
  })

  it('shows what is drawn in the table too', () => {
    const { editor } = editorSetup()
    const grid = /** @type {HTMLCanvasElement} */ (editor.el.querySelector('.roll__grid'))
    click(grid, 3, 30)
    const pitch = /** @type {HTMLInputElement} */ (editor.el.querySelector('input[aria-label="note 3 pitch"]'))
    expect(pitch.value).toBe('30')
  })

  it('drops the selection when another sfx is chosen', () => {
    const { editor } = editorSetup()
    editor.roll.select([1, 4])
    editor.select(5)
    expect(editor.roll.state.selection).toBeNull()
  })

  it('does not let the roll take keys in the table view', () => {
    const { editor } = editorSetup()
    editor.setView('table')
    key('e')
    expect(editor.roll.state.tool).toBe('draw')
    editor.setView('roll')
    key('e')
    expect(editor.roll.state.tool).toBe('erase')
  })
})

describe('painting', () => {
  /** A 2d context that remembers the rectangles it filled, with the style they were filled in. */
  function recordingContext() {
    /** @type {{ style: string, alpha: number, rect: number[] }[]} */
    const fills = []
    /** @type {string[]} */
    const texts = []
    const ctx = /** @type {any} */ ({ fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1 })
    ctx.fillRect = (/** @type {number[]} */ ...rect) => fills.push({ style: ctx.fillStyle, alpha: ctx.globalAlpha, rect })
    ctx.fillText = (/** @type {string} */ t) => texts.push(t)
    ctx.strokeRect = () => {}
    return { ctx, fills, texts }
  }

  it('draws the notes in the colour of their instrument, brighter when louder', () => {
    const rec = recordingContext()
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(rec.ctx)
    try {
      const s = setup()
      rec.fills.length = 0
      writeNote(s.sfx(), ID, 2, { pitch: 20, wave: 0, vol: 7, fx: 0 })
      writeNote(s.sfx(), ID, 3, { pitch: 20, wave: 0, vol: 1, fx: 0 })
      s.roll.refresh()
      const blue = '#29adff' // instrument 0 is palette colour 12
      const x = (/** @type {number} */ step) => GUTTER + step * L.cellW + 1
      const y = (63 - 20) * L.cellH
      const loud = rec.fills.find((f) => f.style === blue && f.rect[0] === x(2) && f.rect[1] === y)
      const soft = rec.fills.find((f) => f.style === blue && f.rect[0] === x(3) && f.rect[1] === y)
      expect(loud?.alpha).toBeCloseTo(1)
      expect(soft?.alpha).toBeLessThan(loud?.alpha ?? 0)
    } finally {
      spy.mockRestore()
    }
  })

  it('labels the octaves and the ruler', () => {
    const rec = recordingContext()
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(rec.ctx)
    try {
      setup()
      expect(rec.texts).toContain('C-3')
      expect(rec.texts).toContain('28')
      expect(rec.texts).toContain('vol')
    } finally {
      spy.mockRestore()
    }
  })
})
