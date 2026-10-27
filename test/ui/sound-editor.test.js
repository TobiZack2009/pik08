// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCart } from '../../src/core/cart.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { createSoundEditor } from '../../src/ui/editors/sound/sound-editor.js'
import { readNote, writeNote } from '../../src/ui/editors/sfx/sfx-data.js'
import { cellSfx, setCell } from '../../src/ui/editors/sound/song.js'
import { defineElements } from '../../src/ui/elements/index.js'
import { Project } from '../../src/ui/store.js'

beforeAll(() => defineElements())

/** @type {ReturnType<typeof createSoundEditor> | undefined} */
let editor

afterEach(() => {
  editor?.destroy()
  editor?.el.remove()
  editor = undefined
})

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

/** @param {{ withSound?: boolean }} [options] */
function setup({ withSound = true } = {}) {
  const project = Project.empty(pico8Profile)
  const setInfo = vi.fn()
  const sound = fakeSound()
  editor = createSoundEditor({ project, setStatus: vi.fn(), setInfo, requestRun: vi.fn(), sound: withSound ? /** @type {any} */ (sound) : undefined })
  document.body.append(editor.el)
  editor.activate?.()
  const music = () => project.region('music')
  const sfx = () => project.region('sfx')
  return { project, editor, setInfo, sound, music, sfx }
}

/** @param {number} bar @param {number} channel @returns {HTMLElement} */
const cellEl = (bar, channel) => /** @type {HTMLElement} */ (document.querySelector(`.timeline__cell[data-bar="${bar}"][data-channel="${channel}"]`))

/** @param {string} titlePrefix */
function press(titlePrefix) {
  const host = document.querySelector(`p8-button[title^="${titlePrefix}"]`)
  const inner = /** @type {HTMLButtonElement | null | undefined} */ (host?.querySelector('button'))
  inner?.click()
}

/** @param {string} key @param {KeyboardEventInit} [init] */
function key(key, init = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

/** Pointer-down on a panel, as a click into it would be. @param {HTMLElement} el */
function touch(el) {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}

describe('layout', () => {
  it('has the song above the pattern', () => {
    const { editor } = setup()
    const kids = [...editor.el.children]
    expect(kids.indexOf(editor.song.el)).toBeLessThan(kids.indexOf(editor.pattern.el))
    expect(editor.el.querySelectorAll('.timeline__cell')).toHaveLength(256)
    expect(editor.el.querySelectorAll('.tracker__item')).toHaveLength(64)
    expect(editor.el.querySelector('.roll')).not.toBeNull()
  })

  it('starts with the song holding the keyboard', () => {
    const { editor } = setup()
    expect(editor.state.focus).toBe('song')
    expect(editor.song.el.hasAttribute('data-focus')).toBe(true)
    expect(editor.pattern.el.hasAttribute('data-focus')).toBe(false)
  })
})

describe('following the song', () => {
  it('shows the pattern of a selected cell', () => {
    const { project, editor, music } = setup()
    setCell(music(), 4, 2, 21)
    project.notifyRom(['music'], Symbol('other'))
    cellEl(4, 2).click()
    expect(editor.pattern.state.sfx).toBe(21)
    expect(editor.pattern.info()).toBe('sfx 21')
  })

  it('offers the first free sfx when an empty cell is selected', () => {
    const { project, editor, music } = setup()
    setCell(music(), 1, 0, 8)
    project.notifyRom(['music'], Symbol('other'))
    cellEl(1, 0).click()
    expect(editor.pattern.state.sfx).toBe(8)
    cellEl(7, 3).click()
    expect(editor.pattern.state.sfx).toBe(9) // 8 is taken
  })

  it('shows a pattern chosen from the list without touching the song', () => {
    const { editor, music } = setup()
    const before = music().slice()
    editor.select(33)
    expect(editor.pattern.state.sfx).toBe(33)
    expect(music()).toEqual(before)
  })
})

describe('the blank pattern of an empty cell', () => {
  /** @param {string} label @param {string} value */
  const change = (label, value) => {
    const input = /** @type {HTMLInputElement} */ (document.querySelector(`[aria-label="${label}"]`))
    input.value = value
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  it('shows a free sfx for an empty cell and allocates nothing by looking', () => {
    const { editor, music, sfx } = setup()
    const music0 = music().slice()
    const sfx0 = sfx().slice()
    cellEl(5, 2).click()
    expect(editor.pattern.state.sfx).toBe(8)
    expect(editor.pattern.info()).toBe('sfx 08')
    expect(music()).toEqual(music0)
    expect(sfx()).toEqual(sfx0)
    expect(cellEl(5, 2).hasAttribute('data-empty')).toBe(true)
  })

  it('starts on the blank pattern of the first cell', () => {
    const { editor } = setup()
    expect(editor.pattern.state.sfx).toBe(8)
  })

  it('gives the pattern to the cell with the first edit, in the same undo step', () => {
    const { editor, music, sfx } = setup()
    const music0 = music().slice()
    const sfx0 = sfx().slice()
    cellEl(5, 2).click()
    change('note 0 pitch', '30')
    change('note 0 volume', '5')
    expect(cellSfx(music(), 5, 2)).toBe(8)
    expect(cellEl(5, 2).textContent).toBe('8')
    expect(readNote(sfx(), 8, 0).pitch).toBe(30)
    editor.undo() // the volume
    expect(cellSfx(music(), 5, 2)).toBe(8)
    editor.undo() // the pitch, and the cell with it
    expect(cellSfx(music(), 5, 2)).toBe(-1)
    expect(music()).toEqual(music0)
    expect(sfx()).toEqual(sfx0)
  })

  it('offers the blank pattern again after undo takes the cell back', () => {
    const { project, editor } = setup()
    cellEl(5, 2).click()
    change('note 0 pitch', '30')
    editor.pattern.select(20) // look elsewhere
    editor.undo()
    expect(editor.pattern.state.sfx).toBe(8)
    change('note 1 pitch', '31')
    expect(cellSfx(project.region('music'), 5, 2)).toBe(8)
  })

  it('sets the speed of the rest of the bar on the new pattern', () => {
    const { music, sfx } = setup()
    setCell(music(), 5, 0, 20)
    sfx()[20 * 68 + 65] = 6
    cellEl(5, 2).click()
    change('note 0 pitch', '30')
    expect(cellSfx(music(), 5, 2)).toBe(8)
    expect(sfx()[8 * 68 + 65]).toBe(6)
  })

  it('allocates nothing for an edit that changes nothing', () => {
    const { editor, music, sfx } = setup()
    const music0 = music().slice()
    const sfx0 = sfx().slice()
    cellEl(5, 2).click()
    change('note 0 pitch', '0') // already 0
    press('Clear the notes')
    expect(music()).toEqual(music0)
    expect(sfx()).toEqual(sfx0)
    expect(editor.pattern.state.sfx).toBe(8)
    expect(document.querySelector('p8-button[icon="undo"]')?.hasAttribute('disabled')).toBe(true)
  })

  it('does not allocate when another sfx is chosen from the list', () => {
    const { editor, music } = setup()
    cellEl(5, 2).click()
    editor.select(30)
    change('note 0 pitch', '30')
    expect(cellSfx(music(), 5, 2)).toBe(-1)
  })

  it('does not allocate for a cell that has a pattern', () => {
    const { editor, music } = setup()
    setCell(music(), 5, 2, 20)
    cellEl(5, 2).click()
    expect(editor.pattern.state.sfx).toBe(20)
    change('note 0 pitch', '30')
    expect(cellSfx(music(), 5, 2)).toBe(20)
  })

  it('offers the next free sfx to the next empty cell', () => {
    const { editor, music } = setup()
    cellEl(5, 2).click()
    change('note 0 pitch', '30')
    cellEl(6, 2).click()
    expect(editor.pattern.state.sfx).toBe(9)
    change('note 0 pitch', '31')
    expect(cellSfx(music(), 6, 2)).toBe(9)
    expect(cellSfx(music(), 5, 2)).toBe(8)
  })

  it('offers a blank pattern after a cell is emptied', () => {
    const { editor, music } = setup()
    setCell(music(), 2, 0, 20)
    cellEl(2, 0).click()
    expect(editor.pattern.state.sfx).toBe(20)
    key('Delete')
    expect(cellSfx(music(), 2, 0)).toBe(-1)
    expect(editor.pattern.state.sfx).toBe(8)
  })

  it('says so when no sfx is free', () => {
    const setStatus = vi.fn()
    const project = Project.empty(pico8Profile)
    for (let id = 0; id < 64; id++) writeNote(project.region('sfx'), id, 0, { pitch: 1, wave: 0, vol: 1, fx: 0 })
    editor = createSoundEditor({ project, setStatus, setInfo: vi.fn(), requestRun: vi.fn() })
    document.body.append(editor.el)
    expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('no free sfx'))
  })
})

describe('one history', () => {
  it('takes back a new pattern, in the cell and in the sfx, in one step', () => {
    const { project, editor, music, sfx } = setup()
    const music0 = music().slice()
    const sfx0 = sfx().slice()
    cellEl(0, 0).click()
    press('New empty pattern')
    expect(cellSfx(music(), 0, 0)).toBeGreaterThanOrEqual(0)
    expect(project.dirty).toBe(true)
    editor.undo()
    expect(music()).toEqual(music0)
    expect(sfx()).toEqual(sfx0)
  })

  it('steps through edits in both panels, newest first', () => {
    const { editor, music, sfx } = setup()
    cellEl(0, 0).click()
    press('New empty pattern')
    const id = cellSfx(music(), 0, 0)
    writeNote(sfx(), id, 0, { pitch: 30, wave: 0, vol: 5, fx: 0 })
    const input = /** @type {HTMLInputElement} */ (document.querySelector('[aria-label="note 0 volume"]'))
    input.value = '6'
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(readNote(sfx(), id, 0).vol).toBe(6)
    editor.undo()
    expect(readNote(sfx(), id, 0).vol).toBe(5)
    editor.undo()
    expect(cellSfx(music(), 0, 0)).toBe(-1)
    editor.redo()
    expect(cellSfx(music(), 0, 0)).toBe(id)
  })

  it('enables the buttons to match the history', () => {
    const { editor } = setup()
    const undo = document.querySelector('p8-button[icon="undo"]')
    const redo = document.querySelector('p8-button[icon="redo"]')
    expect(undo?.hasAttribute('disabled')).toBe(true)
    cellEl(0, 0).click()
    press('New empty pattern')
    expect(undo?.hasAttribute('disabled')).toBe(false)
    editor.undo()
    expect(undo?.hasAttribute('disabled')).toBe(true)
    expect(redo?.hasAttribute('disabled')).toBe(false)
  })

  it('answers Ctrl+Z and Ctrl+Shift+Z on the window while active', () => {
    const { music } = setup()
    cellEl(0, 0).click()
    press('New empty pattern')
    key('z', { ctrlKey: true })
    expect(cellSfx(music(), 0, 0)).toBe(-1)
    key('z', { ctrlKey: true, shiftKey: true })
    expect(cellSfx(music(), 0, 0)).toBeGreaterThanOrEqual(0)
    key('z', { metaKey: true })
    expect(cellSfx(music(), 0, 0)).toBe(-1)
    key('y', { ctrlKey: true })
    expect(cellSfx(music(), 0, 0)).toBeGreaterThanOrEqual(0)
  })

  it('leaves the keys to a focused number field', () => {
    const { music } = setup()
    cellEl(0, 0).click()
    press('New empty pattern')
    const field = /** @type {HTMLInputElement} */ (document.querySelector('[aria-label="pattern of the cell"]'))
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(cellSfx(music(), 0, 0)).toBeGreaterThanOrEqual(0)
  })

  it('ignores the keys while hidden', () => {
    const { editor, music } = setup()
    cellEl(0, 0).click()
    press('New empty pattern')
    editor.deactivate?.()
    key('z', { ctrlKey: true })
    expect(cellSfx(music(), 0, 0)).toBeGreaterThanOrEqual(0)
  })
})

describe('the keyboard', () => {
  it('goes to the song after a click in it, and to the roll after a click in the roll', () => {
    const { editor, sound, music, project } = setup()
    setCell(music(), 0, 0, 5)
    project.notifyRom(['music'], Symbol('other'))
    cellEl(0, 0).click()
    key('e')
    expect(editor.pattern.roll.state.tool).toBe('draw')
    key(' ')
    expect(sound.playMusic).toHaveBeenCalledWith(0)
    expect(sound.play).not.toHaveBeenCalled()

    touch(/** @type {HTMLElement} */ (editor.pattern.el.querySelector('.roll__grid')))
    expect(editor.state.focus).toBe('pattern')
    expect(editor.pattern.el.hasAttribute('data-focus')).toBe(true)
    expect(editor.song.el.hasAttribute('data-focus')).toBe(false)
    key('e')
    expect(editor.pattern.roll.state.tool).toBe('erase')
    key(' ')
    expect(sound.play).toHaveBeenCalledWith(5)
    expect(sound.playMusic).toHaveBeenCalledTimes(1)
  })

  it('keeps Delete from emptying the cell while the roll has the keys', () => {
    const { editor, music, project } = setup()
    setCell(music(), 0, 0, 5)
    project.notifyRom(['music'], Symbol('other'))
    cellEl(0, 0).click()
    touch(/** @type {HTMLElement} */ (editor.pattern.el.querySelector('.roll__grid')))
    key('Delete')
    expect(cellSfx(music(), 0, 0)).toBe(5)
    touch(cellEl(0, 0))
    key('Delete')
    expect(cellSfx(music(), 0, 0)).toBe(-1)
  })

  it('moves to a panel when a control inside it takes focus', () => {
    const { editor } = setup()
    touch(/** @type {HTMLElement} */ (editor.pattern.el.querySelector('.roll__grid')))
    expect(editor.state.focus).toBe('pattern')
    const field = /** @type {HTMLInputElement} */ (document.querySelector('[aria-label="pattern of the cell"]'))
    field.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(editor.state.focus).toBe('song')
  })
})

describe('the status line', () => {
  it('reports the panel that has the keyboard', () => {
    const { editor, setInfo, project, music } = setup()
    setCell(music(), 2, 0, 12)
    project.notifyRom(['music'], Symbol('other'))
    cellEl(2, 0).click()
    expect(setInfo).toHaveBeenLastCalledWith(editor.song.info())
    expect(editor.song.info()).toContain('bar 02')
    touch(/** @type {HTMLElement} */ (editor.pattern.el.querySelector('.roll__grid')))
    expect(setInfo).toHaveBeenLastCalledWith('sfx 12')
  })

  it('is quiet while the tab is hidden', () => {
    const { editor, setInfo } = setup()
    editor.deactivate?.()
    setInfo.mockClear()
    touch(/** @type {HTMLElement} */ (editor.pattern.el.querySelector('.roll__grid')))
    editor.select(4)
    expect(setInfo).not.toHaveBeenCalled()
  })
})

describe('other editors', () => {
  it('repaints both panels on a foreign change', () => {
    const { project, editor, music, sfx } = setup()
    setCell(music(), 6, 1, 40)
    writeNote(sfx(), editor.pattern.state.sfx, 3, { pitch: 20, wave: 1, vol: 3, fx: 0 })
    project.notifyRom(['music', 'sfx'], Symbol('other'))
    expect(cellEl(6, 1).textContent).toContain('40')
    expect(/** @type {HTMLInputElement} */ (document.querySelector('[aria-label="note 3 pitch"]')).value).toBe('20')
  })

  it('drops its history and repaints when a cart is loaded', () => {
    const { project, editor } = setup()
    cellEl(0, 0).click()
    press('New empty pattern')
    expect(cellEl(0, 0).hasAttribute('data-empty')).toBe(false)
    project.load(createCart(pico8Profile), 'other.p8')
    expect(document.querySelector('p8-button[icon="undo"]')?.hasAttribute('disabled')).toBe(true)
    expect(cellEl(0, 0).hasAttribute('data-empty')).toBe(true)
    editor.undo()
    expect(cellEl(0, 0).hasAttribute('data-empty')).toBe(true)
  })

  it('stops listening once destroyed', () => {
    const { project, editor, music } = setup()
    const cell = cellEl(5, 0)
    editor.destroy?.()
    setCell(music(), 5, 0, 30)
    project.notifyRom(['music'], Symbol('other'))
    expect(cell.hasAttribute('data-empty')).toBe(true)
  })
})

describe('without sound', () => {
  it('still edits', () => {
    const { music } = setup({ withSound: false })
    cellEl(0, 0).click()
    press('New empty pattern')
    key(' ')
    expect(cellSfx(music(), 0, 0)).toBeGreaterThanOrEqual(0)
  })
})
