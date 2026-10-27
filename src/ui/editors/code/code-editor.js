import { acceptCompletion } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { lintGutter, linter } from '@codemirror/lint'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { elemake } from '../../dom.js'
import { createBindings } from '../../shortcuts.js'
import { analyze, bracketsAt, markRange, normalizeInsert, syntaxProblem } from './code-model.js'
import { codeKeymap, withoutOwned } from './keys.js'
import { languageCommands, languageSupport } from './language.js'
import { INDENT, dedentAmount, indentAfter, toggleComment } from './lua-indent.js'
import { fromDisplay, toDisplay } from './p8scii-view.js'

/** @import { StateEffectType } from '@codemirror/state' */
/** @import { Analysis } from './code-model.js' */
/** @import { EditorContext, EditorView as ShellEditor } from '../index.js' */

/** Marks transactions that come from the project, so they are not sent back to it. */
const external = Annotation.define()

/** Shows (or, with `null`, clears) the line a running cart failed on. */
const setRunError = /** @type {StateEffectType<number | null>} */ (StateEffect.define())

const LEXED_MARK = (/** @type {string} */ cls) => Decoration.mark({ class: `tok-${cls}` })
const markCache = new Map()
const mark = (/** @type {string} */ cls) => {
  let deco = markCache.get(cls)
  if (!deco) markCache.set(cls, (deco = LEXED_MARK(cls)))
  return deco
}

const BRACKET_OK = Decoration.mark({ class: 'bracket-match' })
const BRACKET_BAD = Decoration.mark({ class: 'bracket-nomatch' })
const ERROR_LINE = Decoration.line({ class: 'cm-run-error' })

/**
 * @typedef {Object} Analyzed
 * @property {Analysis} analysis
 * @property {import('@codemirror/state').RangeSet<Decoration>} marks     syntax colours
 * @property {import('@codemirror/state').RangeSet<Decoration>} brackets  the bracket pair at the cursor
 */

/**
 * @param {Analysis} analysis
 * @param {number} cursor
 * @returns {Analyzed}
 */
function build(analysis, cursor) {
  /** @type {RangeSetBuilder<Decoration>} */
  const marks = new RangeSetBuilder()
  for (const { from, to, cls } of analysis.segments) {
    if (to > from) marks.add(analysis.map.toDisplay(from), analysis.map.toDisplay(to), mark(cls))
  }
  return { analysis, marks: marks.finish(), brackets: bracketRange(analysis, cursor) }
}

/**
 * @param {Analysis} analysis
 * @param {number} cursor
 */
function bracketRange(analysis, cursor) {
  const found = bracketsAt(analysis, cursor)
  /** @type {RangeSetBuilder<Decoration>} */
  const builder = new RangeSetBuilder()
  if (found) {
    const deco = found.matched ? BRACKET_OK : BRACKET_BAD
    for (const r of [...found.ranges].sort((a, b) => a.from - b.from)) builder.add(r.from, r.to, deco)
  }
  return builder.finish()
}

/** The analysis of the document and the decorations made from it, kept up to date together. */
const analyzed = StateField.define({
  create: (state) => build(analyze(state.doc.toString()), state.selection.main.head),
  update(value, tr) {
    if (tr.docChanged) return build(analyze(tr.newDoc.toString()), tr.newSelection.main.head)
    if (tr.selection) return { ...value, brackets: bracketRange(value.analysis, tr.newSelection.main.head) }
    return value
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.marks),
    EditorView.decorations.from(field, (v) => v.brackets),
  ],
})

/** The line a run failed on, until the code is edited. */
const errorLine = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setRunError)) continue
      const line = effect.value
      if (line === null) return Decoration.none
      const at = tr.newDoc.line(Math.min(Math.max(1, line), tr.newDoc.lines))
      return Decoration.set([ERROR_LINE.range(at.from)])
    }
    return tr.docChanged ? Decoration.none : value
  },
  provide: (field) => EditorView.decorations.from(field),
})

/** Keeps the document in the form PICO-8 would give typed or pasted text. */
const normalizeInput = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(external)) return tr
  let changed = false
  /** @type {{ from: number, to: number, insert: string }[]} */
  const specs = []
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const text = inserted.toString()
    const insert = normalizeInsert(text)
    if (insert !== text) changed = true
    specs.push({ from: fromA, to: toA, insert })
  })
  if (!changed) return tr
  let shift = 0
  const cursors = specs.map((s) => {
    const at = s.from + shift + s.insert.length
    shift += s.insert.length - (s.to - s.from)
    return EditorSelection.cursor(at)
  })
  return [
    {
      changes: specs,
      selection: EditorSelection.create(cursors),
      userEvent: tr.annotation(Transaction.userEvent) ?? 'input',
      scrollIntoView: true,
    },
  ]
})

/**
 * The lines touched by the selection (a selection ending at the start of a line doesn't touch it).
 * @param {EditorState} state
 */
function touchedLines(state) {
  const seen = new Set()
  const lines = []
  for (const r of state.selection.ranges) {
    let last = state.doc.lineAt(r.to)
    if (r.to > r.from && last.from === r.to) last = state.doc.lineAt(r.to - 1)
    for (let n = state.doc.lineAt(r.from).number; n <= last.number; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      lines.push(state.doc.line(n))
    }
  }
  return lines
}

/** @param {import('@codemirror/view').EditorView} view */
function insertNewline(view) {
  const update = view.state.changeByRange((range) => {
    const line = view.state.doc.lineAt(range.from)
    const before = fromDisplay(line.text.slice(0, range.from - line.from))
    const insert = '\n' + indentAfter(before)
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) }
  })
  view.dispatch(update, { scrollIntoView: true, userEvent: 'input' })
  return true
}

/** @param {import('@codemirror/view').EditorView} view */
function indentMore(view) {
  const { state } = view
  const lines = touchedLines(state)
  if (lines.length <= 1) {
    view.dispatch(state.replaceSelection(INDENT), { scrollIntoView: true, userEvent: 'input' })
    return true
  }
  view.dispatch({
    changes: lines.filter((l) => l.length > 0).map((l) => ({ from: l.from, insert: INDENT })),
    userEvent: 'input.indent',
  })
  return true
}

/** @param {import('@codemirror/view').EditorView} view */
function indentLess(view) {
  const changes = touchedLines(view.state).flatMap((line) => {
    const lead = /^(\t| {1,2})/.exec(line.text)?.[0]
    return lead ? [{ from: line.from, to: line.from + lead.length }] : []
  })
  if (changes.length) view.dispatch({ changes, userEvent: 'delete.dedent' })
  return true
}

/** @param {import('@codemirror/view').EditorView} view */
function commentLines(view) {
  const lines = touchedLines(view.state)
  const result = toggleComment(lines.map((l) => l.text))
  const changes = lines.flatMap((l, i) => (result[i] === l.text ? [] : [{ from: l.from, to: l.to, insert: result[i] }]))
  if (changes.length) view.dispatch({ changes, userEvent: 'input.comment' })
  return true
}

/**
 * Moves "end", "else", "until" and the closing brackets back to the level of their block as soon as
 * they are typed.
 */
const dedentOnType = EditorView.inputHandler.of((view, from, to, text) => {
  if (text.length !== 1 || from !== to) return false
  const line = view.state.doc.lineAt(from)
  if (from !== line.to) return false
  const amount = dedentAmount(fromDisplay(line.text.slice(0, from - line.from)) + text)
  if (!amount) return false
  view.dispatch({
    changes: [{ from: line.from, to: line.from + amount }, { from, insert: text }],
    selection: { anchor: from + text.length - amount },
    userEvent: 'input.type',
    scrollIntoView: true,
  })
  return true
})

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'var(--code-bg)',
    fontSize: 'var(--code-fs)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: 'var(--code-lh)' },
  '.cm-content': { caretColor: 'var(--focus)', padding: '4px 0' },
  '.cm-line': { padding: '0 8px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--focus)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: 'var(--selection)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--selection)' },
  '.cm-gutters': {
    backgroundColor: 'var(--code-gutter)',
    color: 'var(--text-faint)',
    border: 'none',
    borderRight: 'var(--bw) solid var(--border)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--code-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-line)', color: 'var(--text)' },
  '.cm-run-error': { backgroundColor: 'color-mix(in srgb, var(--danger) 28%, transparent)' },
  '.bracket-match': { backgroundColor: 'var(--selection)', outline: '1px solid var(--accent)' },
  '.bracket-nomatch': { backgroundColor: 'color-mix(in srgb, var(--danger) 35%, transparent)' },
  '.cm-specialChar': { color: 'var(--danger)' },

  '.tok-keyword': { color: 'var(--syn-keyword)', fontWeight: '700' },
  '.tok-atom': { color: 'var(--syn-atom)' },
  '.tok-def': { color: 'var(--syn-def)' },
  '.tok-property': { color: 'var(--syn-property)' },
  '.tok-builtin': { color: 'var(--syn-builtin)' },
  '.tok-glyph': { color: 'var(--syn-glyph)' },
  '.tok-number': { color: 'var(--syn-number)' },
  '.tok-string': { color: 'var(--syn-string)' },
  '.tok-operator': { color: 'var(--syn-operator)' },
  '.tok-punct': { color: 'var(--syn-punct)' },
  '.tok-comment': { color: 'var(--syn-comment)', fontStyle: 'italic' },
  '.tok-error': { textDecoration: 'underline wavy var(--danger)' },

  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)', fontFamily: 'var(--font-ui)' },
  '.cm-panels-top': { borderBottom: 'var(--bw) solid var(--border)' },
  '.cm-panel.cm-search': { fontSize: 'var(--fs-small)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    font: 'inherit',
    color: 'var(--text)',
    backgroundColor: 'var(--code-bg)',
    border: 'var(--bw) solid var(--border)',
    borderRadius: '0',
    backgroundImage: 'none',
  },
  '.cm-panel.cm-search button:hover': { backgroundColor: 'var(--surface-hi)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warn) 35%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 45%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', color: 'var(--text)', border: 'var(--bw) solid var(--border)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },

  '.cm-tooltip.cm-tooltip-autocomplete': { fontFamily: 'var(--font-code)', fontSize: 'var(--fs-small)' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-code)', maxHeight: '14em' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '1px 6px', display: 'flex', alignItems: 'baseline', gap: '8px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--selection)', color: 'var(--text)' },
  '.cm-completionLabel': { flex: 'none' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700', color: 'var(--accent)' },
  '.cm-completionDetail': { color: 'var(--text-faint)', fontStyle: 'normal', marginLeft: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.lang-kind': { color: 'var(--text-faint)', fontSize: '0.85em', textTransform: 'uppercase', marginLeft: 'auto', paddingLeft: '8px' },
  '.cm-completionInfo': { fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-small)', maxWidth: '24em', whiteSpace: 'pre-wrap' },

  '.lang-hover, .lang-sig': { padding: '4px 8px', fontFamily: 'var(--font-code)', fontSize: 'var(--fs-small)', maxWidth: '30em' },
  '.lang-hover__title, .lang-sig__line': { color: 'var(--text)', whiteSpace: 'pre-wrap' },
  '.lang-hover__doc, .lang-sig__doc, .lang-hover__returns, .lang-hover__param': {
    fontFamily: 'var(--font-ui)',
    color: 'var(--text-faint)',
    marginTop: '2px',
    whiteSpace: 'pre-wrap',
  },
  '.lang-hover__param code': { fontFamily: 'var(--font-code)', color: 'var(--text)' },
  '.lang-sig__param strong': { color: 'var(--accent)', fontWeight: '700' },

  '.lang-outline': {
    position: 'absolute',
    top: '8px',
    right: '16px',
    zIndex: '10',
    width: 'min(28em, 80%)',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    border: 'var(--bw) solid var(--border)',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--fs-small)',
  },
  '.lang-outline__filter': {
    boxSizing: 'border-box',
    width: '100%',
    font: 'inherit',
    color: 'var(--text)',
    backgroundColor: 'var(--code-bg)',
    border: 'none',
    borderBottom: 'var(--bw) solid var(--border)',
    borderRadius: '0',
    padding: '4px 8px',
    outline: 'none',
  },
  '.lang-outline__list': { listStyle: 'none', margin: '0', padding: '0', maxHeight: '16em', overflowY: 'auto' },
  '.lang-outline__item, .lang-outline__empty': { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '2px 8px', cursor: 'pointer' },
  '.lang-outline__item.is-active': { backgroundColor: 'var(--selection)' },
  '.lang-outline__name': { fontFamily: 'var(--font-code)' },
  '.lang-outline__detail, .lang-outline__empty': { color: 'var(--text-faint)' },
  '.lang-outline__empty': { cursor: 'default' },
})

/**
 * A cursor readout for the status bar.
 * @param {EditorState} state
 */
export function cursorInfo(state) {
  const { main } = state.selection
  const line = state.doc.lineAt(main.head)
  const text = `Ln ${line.number}, Col ${main.head - line.from + 1}`
  const selected = state.selection.ranges.reduce((n, r) => n + (r.to - r.from), 0)
  return selected ? `${text} (${selected} selected)` : text
}

/**
 * The code editor: CodeMirror over the display form of the cart's code, with PICO-8 highlighting,
 * Lua-aware indentation, bracket matching, find and replace, and syntax error marks.
 *
 * @param {EditorContext} ctx
 * @returns {ShellEditor & { view: import('@codemirror/view').EditorView }}
 */
export function createCodeEditor({ project, setInfo, bindings = createBindings(null) }) {
  const source = {}
  let active = false
  const getAnalysis = (/** @type {EditorState} */ state) => state.field(analyzed).analysis
  const commands = { ...languageCommands(getAnalysis), 'code:comment': commentLines }
  // the shortcuts that can be changed in the settings; rebuilt when they are
  const shortcuts = new Compartment()

  /** @param {string} display */
  const makeState = (display) =>
    EditorState.create({
      doc: display,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        EditorState.tabSize.of(INDENT.length),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        lintGutter(),
        linter(
          (view) => {
            const { analysis } = view.state.field(analyzed)
            const problem = syntaxProblem(analysis.p8)
            if (!problem) return []
            const { from, to } = markRange(analysis, problem.pos)
            return [{ from, to, severity: 'error', message: problem.message }]
          },
          { delay: 500 },
        ),
        analyzed,
        errorLine,
        normalizeInput,
        dedentOnType,
        languageSupport(getAnalysis),
        shortcuts.of(codeKeymap(bindings, commands)),
        Prec.high(
          keymap.of([
            { key: 'Enter', run: insertNewline },
            { key: 'Tab', run: acceptCompletion }, // false when no list is open, so Tab goes on to indent
            { key: 'Tab', run: indentMore },
            { key: 'Shift-Tab', run: indentLess },
          ]),
        ),
        // Mod-Enter runs the cart (the shell handles it), so it must not insert a blank line here
        keymap.of(withoutOwned([...defaultKeymap.filter((b) => b.key !== 'Mod-Enter'), ...historyKeymap, ...searchKeymap])),
        EditorView.contentAttributes.of({
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
          'aria-label': 'cart code',
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((t) => t.annotation(external))) {
            project.setCode(fromDisplay(update.state.doc.toString()), source)
          }
          if (active && (update.docChanged || update.selectionSet)) setInfo(cursorInfo(update.state))
        }),
        theme,
      ],
    })

  const view = new EditorView({ state: makeState(toDisplay(project.cart.code)) })
  const el = elemake('div', { class: 'code-editor' }, view.dom)

  const offs = [
    project.on('code', ({ source: from }) => {
      if (from === source) return
      const p8 = project.cart.code
      if (p8 === fromDisplay(view.state.doc.toString())) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: toDisplay(p8) },
        annotations: [external.of(true), Transaction.addToHistory.of(false)],
      })
    }),
    bindings.on(() => view.dispatch({ effects: shortcuts.reconfigure(codeKeymap(bindings, commands)) })),
    project.on('load', () => {
      view.setState(makeState(toDisplay(project.cart.code)))
      if (active) setInfo(cursorInfo(view.state))
    }),
    project.on('runerror', (/** @type {{ line: number } | null} */ error) => {
      const doc = view.state.doc
      const line = error ? Math.min(Math.max(1, error.line), doc.lines) : 0
      view.dispatch({
        effects: [setRunError.of(error ? error.line : null), ...(error ? [EditorView.scrollIntoView(doc.line(line).from, { y: 'center' })] : [])],
      })
    }),
  ]

  return {
    el,
    view,
    activate() {
      active = true
      setInfo(cursorInfo(view.state))
      view.focus()
    },
    deactivate() {
      active = false
    },
    destroy() {
      for (const off of offs) off()
      view.destroy()
    },
  }
}
