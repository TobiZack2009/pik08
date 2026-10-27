// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { cursorInfo, createCodeEditor } from '../../src/ui/editors/code/code-editor.js'
import { Project } from '../../src/ui/store.js'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { toDisplay } from '../../src/ui/editors/code/p8scii-view.js'

// happy-dom has no layout; CodeMirror only needs these to measure something
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
  const setInfo = vi.fn()
  editor = createCodeEditor({ project, setStatus: vi.fn(), setInfo, requestRun: vi.fn() })
  document.body.append(editor.el)
  return { project, setInfo, view: editor.view, editor }
}

/**
 * Types into the editor the way the browser would: input handlers first, then a plain insert.
 * @param {import('@codemirror/view').EditorView} view
 * @param {string} text
 */
function type(view, text) {
  for (const ch of text) {
    const { from, to } = view.state.selection.main
    const handlers = view.state.facet(EditorView.inputHandler)
    const handled = handlers.some((fn) => fn(view, from, to, ch, () => view.state.update({})))
    if (!handled) view.dispatch({ changes: { from, to, insert: ch }, selection: { anchor: from + ch.length }, userEvent: 'input.type' })
  }
}

describe('code editor', () => {
  it('shows the cart code, with P8SCII glyphs as text', () => {
    const { view } = setup('print("\x8e")')
    expect(view.state.doc.toString()).toBe(toDisplay('print("\x8e")'))
    expect(view.state.doc.toString()).not.toContain('\x8e')
  })

  it('writes edits to the project', () => {
    const { project, view } = setup('a')
    view.dispatch({ changes: { from: 1, insert: 'b' } })
    expect(project.cart.code).toBe('ab')
    expect(project.dirty).toBe(true)
  })

  it('follows changes made elsewhere without echoing them', () => {
    const { project, view } = setup('a')
    const spy = vi.spyOn(project, 'setCode')
    project.setCode('from outside', {})
    expect(view.state.doc.toString()).toBe('from outside')
    expect(spy).toHaveBeenCalledTimes(1) // only the call above
  })

  it('replaces the document when a cart is loaded', () => {
    const { project, view } = setup('old')
    const other = Project.empty(pico8Profile)
    other.cart.code = 'new cart'
    project.load(other.cart, 'other.p8')
    expect(view.state.doc.toString()).toBe('new cart')
  })

  it('turns characters outside the charset into P8SCII glyphs on input', () => {
    const { project, view } = setup('')
    view.dispatch({ changes: { from: 0, insert: 'é' }, userEvent: 'input.paste' })
    expect(project.cart.code).toBe('\xc3\xa9')
    expect(view.state.doc.toString()).toBe(view.state.doc.toString().normalize())
    expect(view.state.selection.main.head).toBe(view.state.doc.length)
  })

  it('shows a run error on a line until the code changes', () => {
    const { project, view } = setup('a\nb\nc')
    project.emit('runerror', { line: 2 })
    expect(view.dom.querySelectorAll('.cm-run-error').length).toBe(1)
    view.dispatch({ changes: { from: 0, insert: 'x' } })
    expect(view.dom.querySelectorAll('.cm-run-error').length).toBe(0)
  })

  it('colours tokens', () => {
    const { view } = setup('if x then print(1) end')
    const classes = new Set([...view.dom.querySelectorAll('[class*="tok-"]')].flatMap((n) => [...n.classList]))
    expect(classes.has('tok-keyword')).toBe(true)
    expect(classes.has('tok-builtin')).toBe(true)
    expect(classes.has('tok-number')).toBe(true)
  })

  it('marks the bracket pair at the cursor', () => {
    const { view } = setup('f(1)')
    view.dispatch({ selection: { anchor: 2 } })
    expect(view.dom.querySelectorAll('.bracket-match').length).toBe(2)
  })

  it('indents after a block opener when Enter is pressed', () => {
    const { view } = setup('if x then')
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    pressKey(view, 'Enter')
    expect(view.state.doc.toString()).toBe('if x then\n  ')
  })

  it('moves "end" back as soon as it is typed', () => {
    const { view } = setup('if x then\n  ')
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    type(view, 'end')
    expect(view.state.doc.toString()).toBe('if x then\nend')
  })

  it('inserts two spaces on Tab and removes them on Shift-Tab', () => {
    const { view } = setup('x')
    view.dispatch({ selection: { anchor: 0 } })
    pressKey(view, 'Tab')
    expect(view.state.doc.toString()).toBe('  x')
    pressKey(view, 'Tab', { shiftKey: true })
    expect(view.state.doc.toString()).toBe('x')
  })

  it('indents every selected line on Tab', () => {
    const { view } = setup('a\nb\nc')
    view.dispatch({ selection: EditorSelection.range(0, 3) })
    pressKey(view, 'Tab')
    expect(view.state.doc.toString()).toBe('  a\n  b\nc')
  })

  it('toggles comments with Mod-/', () => {
    const { view } = setup('a\nb')
    view.dispatch({ selection: EditorSelection.range(0, 3) })
    pressKey(view, '/', { ctrlKey: true })
    expect(view.state.doc.toString()).toBe('-- a\n-- b')
    pressKey(view, '/', { ctrlKey: true })
    expect(view.state.doc.toString()).toBe('a\nb')
  })

  it('reports the cursor to the status bar once active', () => {
    const { editor, setInfo, view } = setup('ab\ncd')
    view.focus = () => {} // happy-dom's selection events re-enter CodeMirror
    expect(setInfo).not.toHaveBeenCalled()
    editor.activate?.()
    expect(setInfo).toHaveBeenLastCalledWith('Ln 1, Col 1')
    view.dispatch({ selection: { anchor: 4 } })
    expect(setInfo).toHaveBeenLastCalledWith('Ln 2, Col 2')
    editor.deactivate?.()
    setInfo.mockClear()
    view.dispatch({ selection: { anchor: 0 } })
    expect(setInfo).not.toHaveBeenCalled()
  })
})

describe('cursorInfo', () => {
  it('counts the selection', async () => {
    const { EditorState } = await import('@codemirror/state')
    const state = EditorState.create({ doc: 'abc\ndef', selection: EditorSelection.range(1, 6) })
    expect(cursorInfo(state)).toBe('Ln 2, Col 3 (5 selected)')
  })
})

/**
 * Runs the editor's key bindings for a key press.
 * @param {import('@codemirror/view').EditorView} view
 * @param {string} key
 * @param {KeyboardEventInit} [init]
 */
function pressKey(view, key, init = {}) {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}
