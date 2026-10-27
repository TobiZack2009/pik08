// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCart } from '../../src/core/cart.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { createSoundEditor } from '../../src/ui/editors/sound/sound-editor.js'
import { readPattern, writePattern } from '../../src/ui/editors/music/music-data.js'
import { defineElements } from '../../src/ui/elements/index.js'
import { Project } from '../../src/ui/store.js'

beforeAll(() => defineElements())

/** The song panel of the sound editor, with the editor's undo and lifecycle. @typedef {ReturnType<typeof facade>} Editor */
/** @param {ReturnType<typeof createSoundEditor>} sound */
function facade(sound) {
  return {
    el: sound.song.el,
    setView: sound.song.setView,
    undo: sound.undo,
    redo: sound.redo,
    activate: sound.activate,
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

function setup() {
  const project = Project.empty(pico8Profile)
  const setInfo = vi.fn()
  const sound = createSoundEditor({ project, setStatus: vi.fn(), setInfo, requestRun: vi.fn() })
  editor = facade(sound)
  document.body.append(sound.el)
  editor.activate()
  const events = /** @type {string[][]} */ ([])
  project.on('rom', (d) => events.push([...d.regions].sort()))
  return { project, editor, setInfo, events }
}

/** @param {string} label @returns {HTMLInputElement} */
const control = (label) => /** @type {HTMLInputElement} */ (document.querySelector(`[aria-label="${label}"]`))

/** @param {HTMLInputElement} el @param {string} value */
function type(el, value) {
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/** @param {HTMLInputElement} el @param {boolean} checked */
function toggle(el, checked) {
  el.checked = checked
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('showing', () => {
  it('has a row for each of the 64 patterns', () => {
    const { editor } = setup()
    expect(editor.el.querySelectorAll('.tracker__row:not(.tracker__row--head)')).toHaveLength(64)
  })

  it('shows the channels and flags', () => {
    const { project, editor } = setup()
    writePattern(project.region('music'), 5, {
      channels: [
        { sfx: 12, enabled: true },
        { sfx: 3, enabled: false },
        { sfx: 63, enabled: true },
        { sfx: 0, enabled: false },
      ],
      loopStart: true,
      loopBack: false,
      stop: true,
    })
    project.notifyRom(['music'], Symbol('other'))
    expect(control('pattern 5 channel 0 sfx').value).toBe('12')
    expect(control('pattern 5 channel 0 on').checked).toBe(true)
    expect(control('pattern 5 channel 1 on').checked).toBe(false)
    expect(control('pattern 5 channel 2 sfx').value).toBe('63')
    expect(control('pattern 5 loop start').checked).toBe(true)
    expect(control('pattern 5 loop back').checked).toBe(false)
    expect(control('pattern 5 stop').checked).toBe(true)
    const row = /** @type {HTMLElement} */ (editor.el.querySelectorAll('.tracker__row:not(.tracker__row--head)')[5])
    expect(row.dataset.used).toBe('true')
  })

  it('reports how many patterns are used', () => {
    const { project, editor, setInfo } = setup()
    editor.setView('table')
    toggle(control('pattern 0 channel 0 on'), true)
    toggle(control('pattern 0 channel 0 on'), false)
    toggle(control('pattern 0 channel 1 on'), false)
    toggle(control('pattern 0 channel 2 on'), false)
    toggle(control('pattern 0 channel 3 on'), false)
    const used = Array.from({ length: 64 }, (_, id) => readPattern(project.region('music'), id)).filter((p) => p.channels.some((c) => c.enabled)).length
    expect(setInfo).toHaveBeenLastCalledWith(`${used} of 64 patterns used`)
    expect(/** @type {HTMLElement} */ (document.querySelector('.tracker__row[data-used="false"]'))).not.toBeNull()
  })
})

describe('editing', () => {
  it('writes a sound number, clamped, and announces the region', () => {
    const { project, events } = setup()
    type(control('pattern 2 channel 1 sfx'), '99')
    expect(readPattern(project.region('music'), 2).channels[1].sfx).toBe(63)
    type(control('pattern 2 channel 1 sfx'), '17')
    expect(readPattern(project.region('music'), 2).channels[1].sfx).toBe(17)
    expect(events.every((e) => e.join() === 'music')).toBe(true)
    expect(project.dirty).toBe(true)
  })

  it('switches a channel on and off', () => {
    const { project } = setup()
    toggle(control('pattern 1 channel 3 on'), true)
    expect(readPattern(project.region('music'), 1).channels[3].enabled).toBe(true)
    toggle(control('pattern 1 channel 3 on'), false)
    expect(readPattern(project.region('music'), 1).channels[3].enabled).toBe(false)
  })

  it('sets the flags without touching the sound numbers', () => {
    const { project } = setup()
    type(control('pattern 4 channel 0 sfx'), '9')
    type(control('pattern 4 channel 2 sfx'), '11')
    toggle(control('pattern 4 loop start'), true)
    toggle(control('pattern 4 loop back'), true)
    toggle(control('pattern 4 stop'), true)
    const p = readPattern(project.region('music'), 4)
    expect(p).toMatchObject({ loopStart: true, loopBack: true, stop: true })
    expect(p.channels.map((c) => c.sfx)).toEqual([9, p.channels[1].sfx, 11, p.channels[3].sfx])
    toggle(control('pattern 4 loop back'), false)
    expect(readPattern(project.region('music'), 4).loopBack).toBe(false)
    expect(readPattern(project.region('music'), 4).loopStart).toBe(true)
  })

  it('keeps the old number for an empty field', () => {
    const { project } = setup()
    type(control('pattern 0 channel 0 sfx'), '21')
    type(control('pattern 0 channel 0 sfx'), '')
    expect(readPattern(project.region('music'), 0).channels[0].sfx).toBe(21)
    expect(control('pattern 0 channel 0 sfx').value).toBe('21')
  })

  it('clears all patterns', () => {
    const { project, editor } = setup()
    type(control('pattern 3 channel 0 sfx'), '30')
    const clear = /** @type {HTMLElement} */ (editor.el.querySelector('p8-button[icon="trash"]'))
    clear.click()
    expect(project.region('music').every((b) => b === 0x40)).toBe(true)
    editor.undo()
    expect(readPattern(project.region('music'), 3).channels[0].sfx).toBe(30)
  })
})

describe('undo and redo', () => {
  it('steps back and forth', () => {
    const { project, editor } = setup()
    type(control('pattern 0 channel 0 sfx'), '5')
    type(control('pattern 0 channel 0 sfx'), '6')
    editor.undo()
    expect(readPattern(project.region('music'), 0).channels[0].sfx).toBe(5)
    expect(control('pattern 0 channel 0 sfx').value).toBe('5')
    editor.redo()
    expect(readPattern(project.region('music'), 0).channels[0].sfx).toBe(6)
  })

  it('answers Ctrl+Z on the window when active, but not in a number field', () => {
    const { project } = setup()
    type(control('pattern 0 channel 0 sfx'), '5')
    control('pattern 0 channel 0 sfx').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(readPattern(project.region('music'), 0).channels[0].sfx).toBe(5)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(readPattern(project.region('music'), 0).channels[0].sfx).not.toBe(5)
  })
})

describe('other editors', () => {
  it('repaints on a foreign change and clears history on load', () => {
    const { project, editor } = setup()
    type(control('pattern 0 channel 0 sfx'), '5')
    writePattern(project.region('music'), 9, { channels: Array.from({ length: 4 }, () => ({ sfx: 44, enabled: true })), loopStart: false, loopBack: false, stop: false })
    project.notifyRom(['music'], Symbol('other'))
    expect(control('pattern 9 channel 2 sfx').value).toBe('44')
    project.load(createCart(pico8Profile), 'x.p8')
    expect(document.querySelector('p8-button[icon="undo"]')?.hasAttribute('disabled')).toBe(true)
    expect(control('pattern 9 channel 2 sfx').value).not.toBe('44')
  })
})
