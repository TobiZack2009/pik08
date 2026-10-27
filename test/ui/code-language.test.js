// @vitest-environment happy-dom
import { startCompletion, completionStatus, currentCompletions } from '@codemirror/autocomplete'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { createCodeEditor } from '../../src/ui/editors/code/code-editor.js'
import { analyze } from '../../src/ui/editors/code/code-model.js'
import { gotoDefinition, hoverAt, signatureTooltip, toggleOutline } from '../../src/ui/editors/code/language.js'
import { Project } from '../../src/ui/store.js'

beforeAll(() => {
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() {} })
  Range.prototype.getBoundingClientRect = rect
  Range.prototype.getClientRects = () => /** @type {any} */ ([])
})

/** @type {ReturnType<typeof createCodeEditor> | undefined} */
let editor

afterEach(() => {
  editor?.destroy?.()
  editor = undefined
})

/** @param {string} [code] */
function setup(code = '') {
  const project = Project.empty(pico8Profile)
  project.cart.code = code
  editor = createCodeEditor({ project, setStatus: vi.fn(), setInfo: vi.fn(), requestRun: vi.fn() })
  document.body.append(editor.el)
  editor.view.focus = () => {} // happy-dom's selection events re-enter CodeMirror
  return { project, view: editor.view }
}

/** @param {import('@codemirror/view').EditorView} view @param {string} text */
function type(view, text) {
  for (const ch of text) {
    const { from, to } = view.state.selection.main
    view.dispatch({ changes: { from, to, insert: ch }, selection: { anchor: from + 1 }, userEvent: 'input.type' })
  }
}

/** @param {import('@codemirror/view').EditorView} view */
const labels = (view) => currentCompletions(view.state).map((c) => c.label)

/** Waits for the completion source to answer. @param {import('@codemirror/view').EditorView} view */
async function settled(view) {
  for (let i = 0; i < 40 && completionStatus(view.state) === 'pending'; i++) await new Promise((r) => setTimeout(r, 5))
  await new Promise((r) => setTimeout(r, 5))
}

/** The list ignores accept keys for a moment after it opens (the `interactionDelay` of the extension). */
const interactive = () => new Promise((r) => setTimeout(r, 90))

/** @param {import('@codemirror/view').EditorView} view @param {string} key @param {KeyboardEventInit} [init] */
function press(view, key, init = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  view.contentDOM.dispatchEvent(event)
  return event
}

describe('completion', () => {
  it('offers spr when sp is typed', async () => {
    const { view } = setup()
    view.focus()
    type(view, 'sp')
    await settled(view)
    expect(labels(view)).toContain('spr')
    expect(labels(view)).not.toContain('cls')
  })

  it('is opened by the command with an empty word', async () => {
    const { view } = setup('')
    startCompletion(view)
    await settled(view)
    expect(labels(view)).toContain('cls')
  })

  it('lists fields after a dot', async () => {
    const { view } = setup('p = {x = 1, y = 2}\n')
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    type(view, 'p.')
    await settled(view)
    expect(labels(view).sort()).toEqual(['x', 'y'])
  })

  it('accepts with Tab only while the list is open', async () => {
    const { view } = setup('')
    view.focus()
    type(view, 'circf')
    await settled(view)
    expect(labels(view)).toContain('circfill')
    await interactive()
    const accepted = press(view, 'Tab')
    expect(accepted.defaultPrevented).toBe(true)
    expect(view.state.doc.toString()).toBe('circfill')
    // no list now: Tab indents
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '' } })
    await settled(view)
    expect(completionStatus(view.state)).toBe(null)
    press(view, 'Tab')
    expect(view.state.doc.toString()).toBe('  ')
  })

  it('inserts a snippet with the indentation of the editor', async () => {
    const { view } = setup('')
    view.focus()
    type(view, 'fore')
    await settled(view)
    expect(labels(view)).toContain('foreach')
    await interactive()
    press(view, 'Tab')
    expect(view.state.doc.toString()).toBe('foreach(t, function(v)\n  \nend)')
  })
})

/** @param {import('@codemirror/state').EditorState} state */
const getAnalysis = (state) => analyze(state.doc.toString())

/** @param {{ create: (view: any) => { dom: HTMLElement } }} tip */
const tipDom = (tip) => tip.create(null).dom

describe('hover', () => {
  it('describes the function under the pointer', () => {
    const { view } = setup('circfill(1, 2, 3)')
    const tip = hoverAt(getAnalysis, view.state, 3)
    expect(tip).not.toBeNull()
    const dom = tipDom(/** @type {any} */ (tip))
    expect(dom.querySelector('.lang-hover__title')?.textContent).toBe('circfill(x, y, [r], [col])')
    expect(dom.querySelector('.lang-hover__param')).not.toBeNull()
  })

  it('describes a function of the program with its comment', () => {
    const code = '-- moves it\nfunction move(dx) end\nmove(1)'
    const { view } = setup(code)
    const tip = hoverAt(getAnalysis, view.state, code.lastIndexOf('move') + 1)
    const dom = tipDom(/** @type {any} */ (tip))
    expect(dom.querySelector('.lang-hover__title')?.textContent).toBe('move(dx)')
    expect(dom.querySelector('.lang-hover__doc')?.textContent).toBe('moves it')
  })

  it('says nothing about a string, a number or an unknown name', () => {
    const { view } = setup('print("circfill") x = 12 nothing_here()')
    expect(hoverAt(getAnalysis, view.state, 8)).toBeNull()
    expect(hoverAt(getAnalysis, view.state, 23)).toBeNull()
    expect(hoverAt(getAnalysis, view.state, 30)).toBeNull()
  })
})

describe('signature help', () => {
  /** @param {string} code */
  function sigAtEnd(code) {
    const { view } = setup(code)
    view.dispatch({ selection: { anchor: code.length } })
    return signatureTooltip(getAnalysis, view.state)
  }
  const active = (/** @type {any} */ tip) => tipDom(tip).querySelector('.lang-sig__param.is-active')?.textContent

  it('marks the current parameter and advances at a comma', () => {
    expect(active(sigAtEnd('circfill('))).toBe('x')
    expect(active(sigAtEnd('circfill(1, '))).toBe('y')
    expect(active(sigAtEnd('circfill(1, 2, 3, '))).toBe('[col]')
  })

  it('works for a function of the program', () => {
    const tip = sigAtEnd('function move(dx, dy) end\nmove(1, ')
    expect(active(tip)).toBe('dy')
    expect(tipDom(/** @type {any} */ (tip)).querySelector('.lang-sig__line')?.textContent).toBe('move(dx, dy)')
  })

  it('is absent outside a call', () => {
    expect(sigAtEnd('cls()')).toBeNull()
    expect(sigAtEnd('x = 1')).toBeNull()
  })

  it('shows as a tooltip while the cursor is in the call', () => {
    const { view } = setup('')
    view.focus()
    type(view, 'circfill(1, ')
    expect(view.dom.querySelector('.lang-sig')).not.toBeNull()
    type(view, '2)')
    expect(view.dom.querySelector('.lang-sig')).toBeNull()
  })
})

describe('go to definition', () => {
  const code = 'function move(dx) end\nmove(1)'

  it('selects the declaration', () => {
    const { view } = setup(code)
    expect(gotoDefinition(getAnalysis, view, code.lastIndexOf('move') + 1)).toBe(true)
    const { from, to } = view.state.selection.main
    expect(view.state.sliceDoc(from, to)).toBe('move')
    expect(from).toBe(code.indexOf('move'))
  })

  it('reports an API name or an unknown name as having none', () => {
    const { view } = setup('cls()\nnothing()')
    expect(gotoDefinition(getAnalysis, view, 1)).toBe(false)
    expect(gotoDefinition(getAnalysis, view, 8)).toBe(false)
  })

  it('is bound to F12', () => {
    const { view } = setup(code)
    view.focus()
    view.dispatch({ selection: { anchor: code.lastIndexOf('move') + 2 } })
    const event = press(view, 'F12')
    expect(event.defaultPrevented).toBe(true)
    expect(view.state.selection.main.from).toBe(code.indexOf('move'))
  })
})

describe('outline', () => {
  const code = 'score = 0\nfunction _init() end\nlocal function helper() end\nfunction _draw() end'

  /** @param {HTMLElement} el */
  const names = (el) => [...el.querySelectorAll('.lang-outline__name')].map((n) => n.textContent)

  it('lists functions, then variables, and filters', () => {
    const { view } = setup(code)
    toggleOutline(getAnalysis, view)
    const panel = /** @type {HTMLElement} */ (view.dom.querySelector('.lang-outline'))
    expect(names(panel)).toEqual(['_init', 'helper', '_draw', 'score'])
    const input = /** @type {HTMLInputElement} */ (panel.querySelector('input'))
    input.value = 'dr'
    input.dispatchEvent(new Event('input'))
    expect(names(panel)).toEqual(['_draw'])
    input.value = 'zzz'
    input.dispatchEvent(new Event('input'))
    expect(panel.querySelector('.lang-outline__empty')).not.toBeNull()
  })

  it('jumps on Enter and closes', () => {
    const { view } = setup(code)
    toggleOutline(getAnalysis, view)
    const input = /** @type {HTMLInputElement} */ (view.dom.querySelector('.lang-outline__filter'))
    input.value = 'help'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(view.dom.querySelector('.lang-outline')).toBeNull()
    const { from, to } = view.state.selection.main
    expect(view.state.sliceDoc(from, to)).toBe('helper')
  })

  it('closes on Escape and toggles', () => {
    const { view } = setup(code)
    toggleOutline(getAnalysis, view)
    const input = /** @type {HTMLInputElement} */ (view.dom.querySelector('.lang-outline__filter'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(view.dom.querySelector('.lang-outline')).toBeNull()
    toggleOutline(getAnalysis, view)
    expect(view.dom.querySelector('.lang-outline')).not.toBeNull()
    toggleOutline(getAnalysis, view)
    expect(view.dom.querySelector('.lang-outline')).toBeNull()
  })
})
