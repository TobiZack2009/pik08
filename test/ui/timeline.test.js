// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { defineElements } from '../../src/ui/elements/index.js'
import { createTimeline } from '../../src/ui/editors/sound/timeline.js'
import { createRegionEdits } from '../../src/ui/editors/region-edits.js'
import { clearBar, cellSfx, isShared, setCell, setFlag } from '../../src/ui/editors/sound/song.js'
import { readPattern } from '../../src/ui/editors/music/music-data.js'
import { readNote, writeNote } from '../../src/ui/editors/sfx/sfx-data.js'
import { Project } from '../../src/ui/store.js'

beforeAll(() => defineElements())

/** @type {{ destroy?: () => void, el: HTMLElement } | undefined} */
let current

afterEach(() => {
  current?.destroy?.()
  current?.el.remove()
  current = undefined
})

function fakeSound() {
  let bar = -1
  return {
    playMusic: vi.fn((/** @type {number} */ b) => void (bar = b)),
    stop: vi.fn(() => void (bar = -1)),
    musicBar: vi.fn(() => bar),
    setBar: (/** @type {number} */ b) => void (bar = b),
  }
}

/** A song with some content, and every other bar empty. @param {Project} project */
function songIn(project) {
  const music = project.region('music')
  for (let bar = 0; bar < 64; bar++) clearBar(music, bar)
  writeNote(project.region('sfx'), 8, 0, { pitch: 30, wave: 0, vol: 5, fx: 0 })
  writeNote(project.region('sfx'), 9, 0, { pitch: 33, wave: 0, vol: 5, fx: 0 })
  setCell(music, 0, 0, 8)
  setCell(music, 0, 1, 8)
  setCell(music, 1, 0, 9)
}

function setup({ withSound = true, song = true } = {}) {
  const project = Project.empty(pico8Profile)
  if (song) songIn(project)
  const sound = fakeSound()
  const setStatus = vi.fn()
  const follow = vi.fn()
  let focused = true
  /** @type {ReturnType<typeof createTimeline>} */
  let timeline
  const edits = createRegionEdits(project, ['sfx', 'music'], Symbol('test'), () => timeline.refresh())
  timeline = createTimeline({ project, edits, sound: withSound ? /** @type {any} */ (sound) : undefined, setStatus, follow, isFocused: () => focused })
  document.body.append(timeline.el)
  timeline.activate()
  current = timeline
  const music = () => project.region('music')
  const sfx = () => project.region('sfx')
  return { project, timeline, edits, sound, setStatus, follow, music, sfx, setFocused: (/** @type {boolean} */ on) => void (focused = on) }
}

/** @param {number} bar @param {number} channel */
const cellEl = (bar, channel) => /** @type {HTMLElement} */ (document.querySelector(`.timeline__cell[data-bar="${bar}"][data-channel="${channel}"]`))
/** @param {number} bar */
const rulerEl = (bar) => /** @type {HTMLElement} */ (document.querySelector(`.timeline__ruler[data-bar="${bar}"]`))
/** The toolbar button whose title starts with some text. @param {string} title */
const button = (title) => /** @type {HTMLElement} */ (document.querySelector(`p8-button[title^="${title}"]`))
/** @param {string} title */
const press = (title) => /** @type {HTMLElement} */ (button(title).querySelector('button')).click()
const patternInput = () => /** @type {HTMLInputElement} */ (document.querySelector('[aria-label="pattern of the cell"]'))

/** @param {HTMLInputElement} el @param {string} value */
function type(el, value) {
  el.value = value
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/** @param {string} key @param {KeyboardEventInit} [init] */
function key(key, init = {}) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  window.dispatchEvent(e)
  return e
}

describe('showing the song', () => {
  it('has a cell for each bar of each channel, and a ruler', () => {
    setup()
    expect(document.querySelectorAll('.timeline__cell')).toHaveLength(256)
    expect(document.querySelectorAll('.timeline__ruler')).toHaveLength(64)
  })

  it('writes the pattern number in a cell and colours it by number', () => {
    setup()
    expect(cellEl(0, 0).textContent).toBe('8')
    expect(cellEl(1, 0).textContent).toBe('9')
    expect(cellEl(0, 0).style.background).not.toBe('')
    expect(cellEl(0, 0).style.background).toBe(cellEl(0, 1).style.background)
    expect(cellEl(0, 0).style.background).not.toBe(cellEl(1, 0).style.background)
  })

  it('leaves empty cells empty', () => {
    setup()
    expect(cellEl(2, 0).textContent).toBe('')
    expect(cellEl(2, 0).hasAttribute('data-empty')).toBe(true)
    expect(cellEl(0, 0).hasAttribute('data-empty')).toBe(false)
  })

  it('marks the cells that share a pattern', () => {
    setup()
    expect(cellEl(0, 0).hasAttribute('data-shared')).toBe(true)
    expect(cellEl(0, 1).hasAttribute('data-shared')).toBe(true)
    expect(cellEl(1, 0).hasAttribute('data-shared')).toBe(false)
  })

  it('shows the flags of a bar on the ruler, and the bars of a loop', () => {
    const s = setup()
    setFlag(s.music(), 0, 'loopStart', true)
    setFlag(s.music(), 1, 'loopBack', true)
    s.timeline.refresh()
    expect(rulerEl(0).textContent).toBe('0') // icons, not glyphs
    expect([...rulerEl(0).querySelectorAll('p8-icon')].map((i) => i.getAttribute('name'))).toEqual(['arrow-right-from-line'])
    expect([...rulerEl(1).querySelectorAll('p8-icon')].map((i) => i.getAttribute('name'))).toEqual(['repeat'])
    expect(rulerEl(1).title).toBe('loop back')
    expect(rulerEl(2).querySelector('p8-icon')).toBeNull()
    expect(rulerEl(0).hasAttribute('data-loop')).toBe(true)
    expect(rulerEl(1).hasAttribute('data-loop')).toBe(true)
    expect(rulerEl(2).hasAttribute('data-loop')).toBe(false)
    expect(cellEl(1, 3).hasAttribute('data-loop')).toBe(true)
  })

  it('follows changes made elsewhere when refreshed', () => {
    const s = setup()
    setCell(s.music(), 5, 2, 20)
    s.timeline.refresh()
    expect(cellEl(5, 2).textContent).toBe('20')
  })
})

describe('selecting', () => {
  it('starts on the first cell', () => {
    const s = setup()
    expect(s.timeline.state.cell).toEqual({ bar: 0, channel: 0 })
    expect(cellEl(0, 0).hasAttribute('data-selected')).toBe(true)
  })

  it('selects the cell that is clicked', () => {
    const s = setup()
    cellEl(1, 2).click()
    expect(s.timeline.state.cell).toEqual({ bar: 1, channel: 2 })
    expect(cellEl(1, 2).hasAttribute('data-selected')).toBe(true)
    expect(cellEl(0, 0).hasAttribute('data-selected')).toBe(false)
  })

  it('selects a bar from the ruler, keeping the channel', () => {
    const s = setup()
    cellEl(0, 3).click()
    rulerEl(7).click()
    expect(s.timeline.state.cell).toEqual({ bar: 7, channel: 3 })
  })

  it('shows the pattern of the selected cell in the field', () => {
    setup()
    expect(patternInput().value).toBe('8')
    cellEl(1, 0).click()
    expect(patternInput().value).toBe('9')
    cellEl(2, 0).click()
    expect(patternInput().value).toBe('')
  })

  it('reads out where it is', () => {
    const s = setup()
    cellEl(0, 1).click()
    const info = s.timeline.info()
    expect(info).toContain('bar 00')
    expect(info).toContain('ch 2')
    expect(info).toContain('sfx 08')
    expect(info).toContain('shared by 2 cells')
    cellEl(3, 0).click()
    expect(s.timeline.info()).toContain('empty')
  })

  it('stays inside the song', () => {
    const s = setup()
    s.timeline.select(-5, 9)
    expect(s.timeline.state.cell).toEqual({ bar: 0, channel: 3 })
    s.timeline.select(400, -1)
    expect(s.timeline.state.cell).toEqual({ bar: 63, channel: 0 })
  })
})

describe('editing a cell', () => {
  it('sets the pattern from the field', () => {
    const s = setup()
    cellEl(2, 1).click()
    type(patternInput(), '20')
    expect(cellSfx(s.music(), 2, 1)).toBe(20)
    expect(cellEl(2, 1).textContent).toBe('20')
  })

  it('clamps the number, and empties the cell when the field is', () => {
    const s = setup()
    type(patternInput(), '99')
    expect(cellSfx(s.music(), 0, 0)).toBe(63)
    type(patternInput(), '')
    expect(cellSfx(s.music(), 0, 0)).toBe(-1)
  })

  it('undoes and redoes an edit', () => {
    const s = setup()
    type(patternInput(), '20')
    s.edits.undo()
    expect(cellSfx(s.music(), 0, 0)).toBe(8)
    expect(cellEl(0, 0).textContent).toBe('8')
    s.edits.redo()
    expect(cellSfx(s.music(), 0, 0)).toBe(20)
  })

  it('makes a new pattern in an empty cell, and undoes the sfx with it', () => {
    const s = setup()
    cellEl(3, 0).click()
    const sfxBefore = s.sfx().slice()
    press('New')
    const id = cellSfx(s.music(), 3, 0)
    expect(id).toBeGreaterThanOrEqual(0)
    expect(cellEl(3, 0).textContent).toBe(String(id))
    s.edits.undo()
    expect(cellSfx(s.music(), 3, 0)).toBe(-1)
    expect(s.sfx()).toEqual(sfxBefore)
  })

  it('cannot make a new pattern in a cell that has one', () => {
    setup()
    expect(button('New').hasAttribute('disabled')).toBe(true)
  })

  it('says so when there is no free sfx for a new pattern', () => {
    const s = setup()
    for (let id = 0; id < 64; id++) writeNote(s.sfx(), id, 0, { pitch: 1, wave: 0, vol: 1, fx: 0 })
    cellEl(3, 0).click()
    press('New')
    expect(cellSfx(s.music(), 3, 0)).toBe(-1)
    expect(s.setStatus).toHaveBeenCalledWith(expect.stringContaining('no free sfx'))
  })

  it('gives a shared cell its own copy', () => {
    const s = setup()
    cellEl(0, 1).click()
    press('Give this cell')
    const id = cellSfx(s.music(), 0, 1)
    expect(id).not.toBe(8)
    expect(isShared(s.music(), 0, 0)).toBe(false)
    expect(readNote(s.sfx(), id, 0).pitch).toBe(30)
    s.edits.undo()
    expect(cellSfx(s.music(), 0, 1)).toBe(8)
  })

  it('only offers a copy for shared patterns', () => {
    setup()
    cellEl(1, 0).click()
    expect(button('Give this cell').hasAttribute('disabled')).toBe(true)
    cellEl(0, 0).click()
    expect(button('Give this cell').hasAttribute('disabled')).toBe(false)
  })

  it('empties a cell', () => {
    const s = setup()
    press('Empty this cell')
    expect(cellSfx(s.music(), 0, 0)).toBe(-1)
    expect(cellEl(0, 0).hasAttribute('data-empty')).toBe(true)
  })

  it('tells which pattern to show when a cell with one is selected', () => {
    const s = setup()
    cellEl(1, 0).click()
    expect(s.follow).toHaveBeenLastCalledWith(9)
    cellEl(0, 1).click()
    expect(s.follow).toHaveBeenLastCalledWith(8)
    key('ArrowLeft')
    expect(s.follow).toHaveBeenCalledTimes(3)
    expect(s.follow).toHaveBeenLastCalledWith(8)
  })

  it('does not tell anything for an empty cell', () => {
    const s = setup()
    cellEl(5, 0).click()
    expect(s.follow).not.toHaveBeenCalled()
  })

  it('tells about a pattern that was made or typed into the cell', () => {
    const s = setup()
    s.timeline.select(3, 0)
    press('New')
    expect(s.follow).toHaveBeenLastCalledWith(cellSfx(s.music(), 3, 0))
    type(patternInput(), '40')
    expect(s.follow).toHaveBeenLastCalledWith(40)
  })

  it('tells about the copy when a pattern is made unique', () => {
    const s = setup()
    cellEl(0, 1).click()
    press('Give this cell')
    expect(s.follow).toHaveBeenLastCalledWith(cellSfx(s.music(), 0, 1))
  })
})

describe('editing a bar', () => {
  it('inserts an empty bar, moving the rest down', () => {
    const s = setup()
    press('Insert')
    expect(cellSfx(s.music(), 0, 0)).toBe(-1)
    expect(cellSfx(s.music(), 1, 0)).toBe(8)
    expect(cellSfx(s.music(), 2, 0)).toBe(9)
    s.edits.undo()
    expect(cellSfx(s.music(), 0, 0)).toBe(8)
  })

  it('says so when the song has no room to insert', () => {
    const s = setup()
    setCell(s.music(), 63, 0, 8)
    press('Insert')
    expect(s.setStatus).toHaveBeenCalledWith(expect.stringContaining('full'))
    expect(cellSfx(s.music(), 0, 0)).toBe(8)
  })

  it('removes a bar, moving the rest up', () => {
    const s = setup()
    press('Remove')
    expect(cellSfx(s.music(), 0, 0)).toBe(9)
    expect(cellSfx(s.music(), 1, 0)).toBe(-1)
  })

  it('repeats a bar after itself, sharing the patterns, and moves to the copy', () => {
    const s = setup()
    press('Repeat this bar after itself, sharing')
    expect(cellSfx(s.music(), 1, 0)).toBe(8)
    expect(cellSfx(s.music(), 1, 1)).toBe(8)
    expect(cellSfx(s.music(), 2, 0)).toBe(9)
    expect(s.timeline.state.cell).toEqual({ bar: 1, channel: 0 })
  })

  it('repeats a bar with its own copies of the patterns, as one undo step', () => {
    const s = setup()
    const before = { music: s.music().slice(), sfx: s.sfx().slice() }
    press('Repeat this bar after itself, with')
    const copy = cellSfx(s.music(), 1, 0)
    expect(copy).not.toBe(8)
    expect(copy).toBe(cellSfx(s.music(), 1, 1))
    expect(readNote(s.sfx(), copy, 0).pitch).toBe(30)
    s.edits.undo()
    expect(s.music()).toEqual(before.music)
    expect(s.sfx()).toEqual(before.sfx)
  })

  it('says so when a bar cannot be repeated', () => {
    const s = setup()
    setCell(s.music(), 63, 0, 8)
    press('Repeat this bar after itself, sharing')
    expect(s.setStatus).toHaveBeenCalledWith(expect.stringContaining('full'))
    expect(s.timeline.state.cell.bar).toBe(0)
  })

  it('says so when there are no free sfx for the copies', () => {
    const s = setup()
    for (let id = 0; id < 64; id++) if (id !== 8 && id !== 9) writeNote(s.sfx(), id, 0, { pitch: 1, wave: 0, vol: 1, fx: 0 })
    press('Repeat this bar after itself, with')
    expect(s.setStatus).toHaveBeenCalledWith(expect.stringContaining('free sfx'))
    expect(cellSfx(s.music(), 1, 0)).toBe(9)
  })

  it('sets and clears the flags of the bar', () => {
    const s = setup()
    press('The song loops from')
    expect(readPattern(s.music(), 0).loopStart).toBe(true)
    expect(button('The song loops from').hasAttribute('pressed')).toBe(true)
    press('The song loops from')
    expect(readPattern(s.music(), 0).loopStart).toBe(false)
    press('The song stops')
    expect(readPattern(s.music(), 0).stop).toBe(true)
  })

  it('shows the flags of the selected bar on the buttons', () => {
    const s = setup()
    setFlag(s.music(), 1, 'loopBack', true)
    cellEl(1, 0).click()
    expect(button('The song loops back').hasAttribute('pressed')).toBe(true)
    cellEl(0, 0).click()
    expect(button('The song loops back').hasAttribute('pressed')).toBe(false)
  })
})

describe('the cell editor', () => {
  /** @param {string} title */
  const step = (title) => /** @type {HTMLElement} */ (document.querySelector(`.timeline__step[title^="${title}"]`)).click()
  const editorEl = () => /** @type {HTMLElement} */ (document.querySelector('.timeline__editor'))

  it('has no separate pattern field in the toolbar', () => {
    setup()
    expect(document.querySelector('.timeline__bar .tracker__field')).toBeNull()
    expect(document.querySelectorAll('[aria-label="pattern of the cell"]')).toHaveLength(1)
    expect(document.querySelector('.timeline__bar [aria-label="pattern of the cell"]')).toBeNull()
  })

  it('sits over the selected cell', () => {
    setup()
    expect(editorEl().style.left).toBe('36px')
    expect(editorEl().style.top).toBe('28px')
    cellEl(3, 2).click()
    expect(editorEl().style.left).toBe(`${36 + 3 * 40}px`)
    expect(editorEl().style.top).toBe(`${28 * 3}px`)
    expect(editorEl().hasAttribute('data-empty')).toBe(true)
  })

  it('steps the pattern by one with the arrows', () => {
    const s = setup()
    step('Next pattern')
    expect(cellSfx(s.music(), 0, 0)).toBe(9)
    expect(patternInput().value).toBe('9')
    step('Previous pattern')
    step('Previous pattern')
    expect(cellSfx(s.music(), 0, 0)).toBe(7)
    expect(s.follow).toHaveBeenLastCalledWith(7)
  })

  it('makes an empty cell 0 going up, and empties 0 going down', () => {
    const s = setup()
    cellEl(5, 0).click()
    step('Previous pattern')
    expect(cellSfx(s.music(), 5, 0)).toBe(-1)
    step('Next pattern')
    expect(cellSfx(s.music(), 5, 0)).toBe(0)
    step('Previous pattern')
    expect(cellSfx(s.music(), 5, 0)).toBe(-1)
  })

  it('stops at 63', () => {
    const s = setup()
    type(patternInput(), '63')
    step('Next pattern')
    expect(cellSfx(s.music(), 0, 0)).toBe(63)
  })

  it('makes each step one undo step', () => {
    const s = setup()
    step('Next pattern')
    step('Next pattern')
    s.edits.undo()
    expect(cellSfx(s.music(), 0, 0)).toBe(9)
  })

  it('steps with the arrow keys inside the field', () => {
    const s = setup()
    patternInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    expect(cellSfx(s.music(), 0, 0)).toBe(9)
    patternInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    patternInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(cellSfx(s.music(), 0, 0)).toBe(7)
    expect(s.timeline.state.cell).toEqual({ bar: 0, channel: 0 }) // the selection did not move
  })

  it('takes a typed number on Enter, and drops it on Escape', () => {
    const s = setup()
    patternInput().value = '30'
    patternInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(cellSfx(s.music(), 0, 0)).toBe(30)
    patternInput().value = '12'
    patternInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(cellSfx(s.music(), 0, 0)).toBe(30)
    expect(patternInput().value).toBe('30')
  })

  it('makes no edit when the number is the one shown', () => {
    const s = setup()
    type(patternInput(), '8')
    expect(s.edits.history.canUndo).toBe(false)
  })

  it('moves the focus to the field when a digit is typed', () => {
    setup()
    const focus = vi.spyOn(patternInput(), 'focus')
    key('5')
    expect(focus).toHaveBeenCalled()
  })

  it('tells when the selected cell is empty, by selecting it or by emptying it', () => {
    const onEmpty = vi.fn()
    const s = setup()
    // a timeline made with the hook
    s.timeline.destroy()
    s.timeline.el.remove()
    const t = createTimeline({ project: s.project, edits: s.edits, onEmpty })
    document.body.append(t.el)
    current = t
    t.select(3, 0)
    expect(onEmpty).toHaveBeenCalledTimes(1)
    t.select(0, 0)
    expect(onEmpty).toHaveBeenCalledTimes(1)
    const down = /** @type {HTMLElement} */ (t.el.querySelectorAll('.timeline__step')[1])
    down.click() // 8 -> 7
    expect(onEmpty).toHaveBeenCalledTimes(1)
    type(/** @type {HTMLInputElement} */ (t.el.querySelector('input')), '')
    expect(onEmpty).toHaveBeenCalledTimes(2)
  })
})

describe('the keyboard', () => {
  it('moves the selection with the arrows', () => {
    const s = setup()
    key('ArrowRight')
    key('ArrowRight')
    key('ArrowDown')
    expect(s.timeline.state.cell).toEqual({ bar: 2, channel: 1 })
    key('ArrowLeft')
    key('ArrowUp')
    expect(s.timeline.state.cell).toEqual({ bar: 1, channel: 0 })
  })

  it('stops at the edges', () => {
    const s = setup()
    key('ArrowLeft')
    key('ArrowUp')
    expect(s.timeline.state.cell).toEqual({ bar: 0, channel: 0 })
  })

  it('empties the cell with Delete', () => {
    const s = setup()
    key('Delete')
    expect(cellSfx(s.music(), 0, 0)).toBe(-1)
    key('ArrowRight')
    key('Backspace')
    expect(cellSfx(s.music(), 1, 0)).toBe(-1)
  })

  it('makes a pattern in an empty cell with Enter, and leaves a cell that has one alone', () => {
    const s = setup()
    s.timeline.select(4, 0)
    key('Enter')
    const id = cellSfx(s.music(), 4, 0)
    expect(id).toBeGreaterThanOrEqual(0)
    key('Enter')
    expect(cellSfx(s.music(), 4, 0)).toBe(id)
  })

  it('copies and pastes the pattern of a cell', () => {
    const s = setup()
    key('c', { ctrlKey: true })
    s.timeline.select(6, 2)
    key('v', { ctrlKey: true })
    expect(cellSfx(s.music(), 6, 2)).toBe(8)
    s.edits.undo()
    expect(cellSfx(s.music(), 6, 2)).toBe(-1)
  })

  it('pastes nothing before something was copied', () => {
    const s = setup()
    s.timeline.select(6, 2)
    key('v', { ctrlKey: true })
    expect(cellSfx(s.music(), 6, 2)).toBe(-1)
  })

  it('leaves Ctrl+Z to the editor around it', () => {
    setup()
    const e = key('z', { ctrlKey: true })
    expect(e.defaultPrevented).toBe(false)
  })

  it('leaves the keys to a text field', () => {
    const s = setup()
    const e = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })
    patternInput().dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(cellSfx(s.music(), 0, 0)).toBe(8)
  })

  it('leaves Space and Enter to a focused toolbar button', () => {
    const s = setup()
    const inner = /** @type {HTMLElement} */ (button('Insert').querySelector('button'))
    const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    inner.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(cellSfx(s.music(), 0, 0)).toBe(8)
  })

  it('takes the keys while a cell is focused, even though it is a button', () => {
    const s = setup()
    const e = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    cellEl(0, 0).dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(s.sound.playMusic).toHaveBeenCalledWith(0)
  })

  it('ignores the keys when something else has the keyboard', () => {
    const s = setup()
    s.setFocused(false)
    const e = key('Delete')
    expect(e.defaultPrevented).toBe(false)
    expect(cellSfx(s.music(), 0, 0)).toBe(8)
    s.setFocused(true)
    key('Delete')
    expect(cellSfx(s.music(), 0, 0)).toBe(-1)
  })

  it('ignores the keys when it is not the tab shown', () => {
    const s = setup()
    s.timeline.deactivate()
    key('ArrowRight')
    expect(s.timeline.state.cell.bar).toBe(0)
  })
})

describe('playing', () => {
  it('plays from the selected bar, and stops', () => {
    const s = setup()
    cellEl(1, 0).click()
    press('Play the song')
    expect(s.sound.playMusic).toHaveBeenCalledWith(1)
    expect(button('Play the song').getAttribute('icon')).toBe('stop')
    press('Play the song')
    expect(s.sound.stop).toHaveBeenCalled()
    expect(button('Play the song').getAttribute('icon')).toBe('play')
  })

  it('plays and stops with Space', () => {
    const s = setup()
    key(' ')
    expect(s.sound.playMusic).toHaveBeenCalledWith(0)
    key(' ')
    expect(s.sound.stop).toHaveBeenCalled()
  })

  it('marks the bar that plays', () => {
    const s = setup()
    s.sound.setBar(1)
    s.timeline.tick()
    expect(cellEl(1, 0).hasAttribute('data-playing')).toBe(true)
    expect(cellEl(1, 3).hasAttribute('data-playing')).toBe(true)
    expect(rulerEl(1).hasAttribute('data-playing')).toBe(true)
    expect(cellEl(0, 0).hasAttribute('data-playing')).toBe(false)
    s.sound.setBar(0)
    s.timeline.tick()
    expect(cellEl(1, 0).hasAttribute('data-playing')).toBe(false)
    expect(cellEl(0, 0).hasAttribute('data-playing')).toBe(true)
    s.sound.setBar(-1)
    s.timeline.tick()
    expect(document.querySelector('[data-playing]')).toBeNull()
  })

  it('stops the music when the tab is left', () => {
    const s = setup()
    s.sound.setBar(1)
    s.timeline.tick()
    s.timeline.deactivate()
    expect(s.sound.stop).toHaveBeenCalled()
    expect(document.querySelector('[data-playing]')).toBeNull()
  })

  it('is silent without a sound service', () => {
    const s = setup({ withSound: false })
    expect(button('Play the song').hasAttribute('disabled')).toBe(true)
    expect(() => key(' ')).not.toThrow()
    expect(s.timeline.state.cell.bar).toBe(0)
  })
})
