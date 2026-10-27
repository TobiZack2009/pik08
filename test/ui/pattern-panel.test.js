// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCart } from '../../src/core/cart.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { createSoundEditor } from '../../src/ui/editors/sound/sound-editor.js'
import { readHeader, readNote, writeNote } from '../../src/ui/editors/sfx/sfx-data.js'
import { defineElements } from '../../src/ui/elements/index.js'
import { Project } from '../../src/ui/store.js'

beforeAll(() => defineElements())

/** The pattern panel of the sound editor, with the editor's undo and lifecycle. @typedef {ReturnType<typeof facade>} Editor */
/** @param {ReturnType<typeof createSoundEditor>} sound */
function facade(sound) {
  return {
    el: sound.pattern.el,
    state: sound.pattern.state,
    select: sound.pattern.select,
    info: sound.pattern.info,
    undo: sound.undo,
    activate: sound.activate,
    deactivate: sound.deactivate,
    destroy() {
      sound.destroy()
      sound.el.remove()
    },
  }
}

/** @type {Editor | undefined} */
let editor

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

function setup({ select = true } = {}) {
  const project = Project.empty(pico8Profile)
  const setInfo = vi.fn()
  const sound = createSoundEditor({ project, setStatus: vi.fn(), setInfo, requestRun: vi.fn() })
  editor = facade(sound)
  if (select) sound.pattern.select(0) // not the blank pattern the empty first cell offers
  document.body.append(sound.el)
  editor.activate()
  const events = /** @type {string[][]} */ ([])
  project.on('rom', (d) => events.push([...d.regions].sort()))
  return { project, editor, setInfo, events }
}

/** @param {string} label @returns {HTMLInputElement | HTMLSelectElement} */
const control = (label) => /** @type {HTMLInputElement | HTMLSelectElement} */ (document.querySelector(`[aria-label="${label}"]`))

/** @param {HTMLInputElement | HTMLSelectElement} el @param {string} value */
function change(el, value) {
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/** @param {string} key @param {KeyboardEventInit} [init] */
function press(key, init = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

describe('showing', () => {
  it('lists the 64 sounds and starts on the blank one for the empty first cell', () => {
    const { editor } = setup({ select: false })
    const items = editor.el.querySelectorAll('.tracker__item')
    expect(items).toHaveLength(64)
    expect(items[8].hasAttribute('data-selected')).toBe(true)
    expect(editor.el.querySelectorAll('.tracker__row:not(.tracker__row--head)')).toHaveLength(32)
  })

  it('shows the notes of the chosen sound', () => {
    const { project, editor } = setup()
    writeNote(project.region('sfx'), 3, 5, { pitch: 36, wave: 9, vol: 5, fx: 2 })
    editor.select(3)
    expect(control('note 5 pitch').value).toBe('36')
    expect(control('note 5 instrument').value).toBe('9')
    expect(control('note 5 volume').value).toBe('5')
    expect(control('note 5 effect').value).toBe('2')
    expect(editor.el.querySelectorAll('.tracker__note')[5].textContent).toBe('C-3')
  })

  it('marks sounds that make no noise', () => {
    const { project, editor } = setup()
    writeNote(project.region('sfx'), 1, 0, { pitch: 10, wave: 0, vol: 3, fx: 0 })
    editor.select(1)
    const items = editor.el.querySelectorAll('.tracker__item')
    expect(/** @type {HTMLElement} */ (items[0]).dataset.silent).toBe('true')
    expect(/** @type {HTMLElement} */ (items[1]).dataset.silent).toBe('false')
  })

  it('clamps the selection', () => {
    const { editor } = setup()
    editor.select(99)
    expect(editor.state.sfx).toBe(63)
    editor.select(-4)
    expect(editor.state.sfx).toBe(0)
  })

  it('reports the sound in the status bar once the roll has the keyboard', () => {
    const { editor, setInfo } = setup()
    editor.select(12)
    expect(editor.info()).toBe('sfx 12')
    document.querySelector('.roll')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(setInfo).toHaveBeenLastCalledWith('sfx 12')
  })

  it('marks the loop', () => {
    const { editor } = setup()
    change(control('Loop start'), '2')
    change(control('Loop end'), '4')
    const rows = [...editor.el.querySelectorAll('.tracker__row:not(.tracker__row--head)')].map((r) => /** @type {HTMLElement} */ (r).dataset.loop)
    expect(rows.slice(0, 6)).toEqual(['false', 'false', 'true', 'true', 'false', 'false'])
  })
})

describe('editing', () => {
  it('writes a note, clamped, and announces the region', () => {
    const { project, events } = setup()
    change(control('note 2 pitch'), '99')
    expect(readNote(project.region('sfx'), 0, 2).pitch).toBe(63)
    change(control('note 2 volume'), '5')
    change(control('note 2 instrument'), '12')
    change(control('note 2 effect'), '6')
    expect(readNote(project.region('sfx'), 0, 2)).toEqual({ pitch: 63, wave: 12, vol: 5, fx: 6 })
    expect(events.every((e) => e.join() === 'sfx')).toBe(true)
    expect(events).toHaveLength(4)
    expect(project.dirty).toBe(true)
  })

  it('edits the sound that is selected', () => {
    const { project, editor } = setup()
    editor.select(7)
    change(control('note 0 volume'), '4')
    expect(readNote(project.region('sfx'), 7, 0).vol).toBe(4)
    expect(readNote(project.region('sfx'), 0, 0).vol).toBe(0)
  })

  it('ignores an empty or non-numeric field and puts the old value back', () => {
    const { project } = setup()
    change(control('note 1 pitch'), '20')
    change(control('note 1 pitch'), '')
    expect(readNote(project.region('sfx'), 0, 1).pitch).toBe(20)
    expect(control('note 1 pitch').value).toBe('20')
  })

  it('writes the speed and loop points', () => {
    const { project } = setup()
    change(control('Speed'), '12')
    change(control('Loop start'), '40')
    change(control('Loop end'), '99')
    expect(readHeader(project.region('sfx'), 0)).toMatchObject({ speed: 12, loopStart: 31, loopEnd: 32 })
  })

  it('does not announce an edit that changes nothing', () => {
    const { events } = setup()
    change(control('note 0 pitch'), '0')
    expect(events).toHaveLength(0)
  })

  it('clears the notes of the sound', () => {
    const { project, editor } = setup()
    editor.select(2)
    change(control('note 3 volume'), '6')
    const clear = /** @type {HTMLElement} */ (editor.el.querySelector('p8-button[icon="trash"]'))
    clear.click()
    expect(readNote(project.region('sfx'), 2, 3).vol).toBe(0)
  })
})

describe('undo and redo', () => {
  it('steps back and forth, one step per edit', () => {
    const { project } = setup()
    change(control('note 0 volume'), '3')
    change(control('note 0 volume'), '5')
    const vol = () => readNote(project.region('sfx'), 0, 0).vol
    press('z', { ctrlKey: true })
    expect(vol()).toBe(3)
    expect(control('note 0 volume').value).toBe('3')
    press('z', { ctrlKey: true, shiftKey: true })
    expect(vol()).toBe(5)
    press('z', { ctrlKey: true })
    press('z', { ctrlKey: true })
    expect(vol()).toBe(0)
    press('y', { metaKey: true })
    expect(vol()).toBe(3)
  })

  it('leaves the keys to a focused field', () => {
    const { project } = setup()
    change(control('note 0 volume'), '3')
    control('note 0 volume').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(readNote(project.region('sfx'), 0, 0).vol).toBe(3)
  })

  it('ignores the keys while hidden', () => {
    const { project, editor } = setup()
    change(control('note 0 volume'), '3')
    editor.deactivate()
    press('z', { ctrlKey: true })
    expect(readNote(project.region('sfx'), 0, 0).vol).toBe(3)
  })

  it('enables the buttons to match the history', () => {
    const { editor } = setup()
    const undo = document.querySelector('p8-button[icon="undo"]')
    const redo = document.querySelector('p8-button[icon="redo"]')
    expect(undo?.hasAttribute('disabled')).toBe(true)
    change(control('note 0 volume'), '3')
    expect(undo?.hasAttribute('disabled')).toBe(false)
    expect(redo?.hasAttribute('disabled')).toBe(true)
    editor.undo()
    expect(redo?.hasAttribute('disabled')).toBe(false)
  })
})

describe('other editors', () => {
  it('repaints when someone else changes the region', () => {
    const { project } = setup()
    writeNote(project.region('sfx'), 0, 4, { pitch: 7, wave: 1, vol: 2, fx: 0 })
    project.notifyRom(['sfx'], Symbol('other'))
    expect(control('note 4 pitch').value).toBe('7')
  })

  it('drops its history when a cart is loaded', () => {
    const { project, editor } = setup()
    change(control('note 0 volume'), '3')
    project.load(createCart(pico8Profile), 'other.p8')
    expect(document.querySelector('p8-button[icon="undo"]')?.hasAttribute('disabled')).toBe(true)
    expect(control('note 0 volume').value).toBe('0')
  })

  it('stops listening once destroyed', () => {
    const { project, editor } = setup()
    const input = control('note 4 pitch')
    editor.destroy()
    writeNote(project.region('sfx'), 0, 4, { pitch: 7, wave: 1, vol: 2, fx: 0 })
    project.notifyRom(['sfx'], Symbol('other'))
    expect(input.value).toBe('0')
  })
})
