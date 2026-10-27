import { autocompletion, snippet, startCompletion } from '@codemirror/autocomplete'
import { StateField } from '@codemirror/state'
import { EditorView, hoverTooltip, keymap, showTooltip } from '@codemirror/view'
import { completions, definition, hover, outline, signature } from '../../../lang/service.js'
import { h } from '../../dom.js'
import { INDENT } from './lua-indent.js'
import { toDisplay } from './p8scii-view.js'

/** @import { EditorState } from '@codemirror/state'
 * @import { CompletionContext, CompletionResult } from '@codemirror/autocomplete'
 * @import { Tooltip } from '@codemirror/view'
 * @import { Analysis } from './code-model.js' */

/**
 * The editor's side of the language service (`src/lang`): completion, hover, signature help,
 * go to definition and an outline. The service works on p8str offsets; the document holds the
 * display form, so every offset and every inserted name goes through the analysis' `OffsetMap`
 * and `toDisplay`.
 *
 * @typedef {(state: EditorState) => Analysis} GetAnalysis
 */

/** Short kind labels shown in the completion list. */
const KIND_LABELS = /** @type {Record<string, string>} */ ({
  variable: 'var',
  function: 'fn',
  method: 'fn',
  property: 'field',
  keyword: 'key',
  text: '',
})

// ---- completion ----------------------------------------------------------------------------------

/**
 * @param {GetAnalysis} getAnalysis
 * @returns {(context: CompletionContext) => CompletionResult | null}
 */
export function completionSource(getAnalysis) {
  return (context) => {
    const analysis = getAnalysis(context.state)
    const offset = analysis.map.toP8(context.pos)
    const result = completions(analysis, offset)
    if (!result || !result.items.length) return null
    // a name needs at least one typed character unless asked for; a field is offered right after the dot
    if (!context.explicit && result.kind === 'name' && result.from === offset) return null
    return {
      from: analysis.map.toDisplay(result.from),
      options: result.items.map((item) => ({
        label: toDisplay(item.label),
        type: item.type,
        detail: item.detail && item.detail !== item.label ? toDisplay(item.detail) : undefined,
        info: item.doc,
        apply: item.snippet ? snippet(item.snippet.replaceAll('\t', INDENT)) : undefined,
        boost: 30 - item.rank * 10,
      })),
    }
  }
}

// ---- hover -------------------------------------------------------------------------------------

/**
 * The tooltip for the text at a document position, if there is something to say about it.
 * @param {GetAnalysis} getAnalysis
 * @param {EditorState} state
 * @param {number} pos
 * @returns {Tooltip | null}
 */
export function hoverAt(getAnalysis, state, pos) {
  const analysis = getAnalysis(state)
  const info = hover(analysis, analysis.map.toP8(pos))
  if (!info) return null
  return {
    pos: analysis.map.toDisplay(info.from),
    end: analysis.map.toDisplay(info.to),
    above: true,
    create: () => ({
      dom: h(
        'div',
        { class: 'lang-hover' },
        h('div', { class: 'lang-hover__title' }, toDisplay(info.title)),
        info.doc && h('div', { class: 'lang-hover__doc' }, info.doc),
        info.returns && h('div', { class: 'lang-hover__returns' }, `returns ${info.returns}`),
        info.origin === 'api' &&
          info.params
            ?.filter((p) => p.doc)
            .map((p) => h('div', { class: 'lang-hover__param' }, h('code', null, p.name), ` ${p.doc}`)),
      ),
    }),
  }
}

// ---- signature help ------------------------------------------------------------------------------

/**
 * The tooltip over the open parenthesis of the call the cursor is in, with the current parameter bold.
 * @param {GetAnalysis} getAnalysis
 * @param {EditorState} state
 * @returns {(Tooltip & { key: string }) | null}
 */
export function signatureTooltip(getAnalysis, state) {
  const { main } = state.selection
  if (!main.empty) return null
  const analysis = getAnalysis(state)
  const help = signature(analysis, analysis.map.toP8(main.head))
  if (!help) return null
  const pos = analysis.map.toDisplay(help.open)
  const key = `${pos}|${help.active}|${help.name}|${help.params.map((p) => p.name).join(',')}`
  return {
    key,
    pos,
    above: true,
    create: () => {
      const params = help.params.map((p, i) => {
        const text = p.optional ? `[${p.name}]` : p.name
        return h('span', { class: i === help.active ? 'lang-sig__param is-active' : 'lang-sig__param' }, i === help.active ? h('strong', null, text) : text)
      })
      const line = h('div', { class: 'lang-sig__line' }, toDisplay(help.name), '(')
      params.forEach((el, i) => line.append(i ? ', ' : '', el))
      line.append(')')
      const active = help.params[help.active]
      return { dom: h('div', { class: 'lang-sig' }, line, active?.doc && h('div', { class: 'lang-sig__doc' }, `${active.name}: ${active.doc}`)) }
    },
  }
}

/** @param {GetAnalysis} getAnalysis */
function signatureField(getAnalysis) {
  return StateField.define({
    create: (state) => signatureTooltip(getAnalysis, state),
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value
      const next = signatureTooltip(getAnalysis, tr.state)
      return next && value && next.key === value.key ? value : next
    },
    provide: (field) => showTooltip.from(field),
  })
}

// ---- go to definition ----------------------------------------------------------------------------

/**
 * Selects the declaration of the name at `pos` and scrolls to it.
 * @param {GetAnalysis} getAnalysis
 * @param {EditorView} view
 * @param {number} pos
 * @returns {boolean} whether there was a declaration
 */
export function gotoDefinition(getAnalysis, view, pos) {
  const analysis = getAnalysis(view.state)
  const found = definition(analysis, analysis.map.toP8(pos))
  if (!found) return false
  const from = analysis.map.toDisplay(found.from)
  view.dispatch({
    selection: { anchor: from, head: analysis.map.toDisplay(found.to) },
    effects: EditorView.scrollIntoView(from, { y: 'center' }),
    userEvent: 'select.definition',
  })
  return true
}

// ---- outline -------------------------------------------------------------------------------------

/** @type {WeakMap<EditorView, () => void>} */
const openOutlines = new WeakMap()

/**
 * Shows (or, when it is open, closes) the outline: a list of the functions and top-level
 * variables with a filter. Enter jumps to the chosen one, Escape closes.
 * @param {GetAnalysis} getAnalysis
 * @param {EditorView} view
 * @returns {boolean}
 */
export function toggleOutline(getAnalysis, view) {
  const existing = openOutlines.get(view)
  if (existing) {
    existing()
    return true
  }
  const analysis = getAnalysis(view.state)
  const items = outline(analysis)
  let active = 0
  /** @type {typeof items} */
  let shown = items

  const input = h('input', {
    class: 'lang-outline__filter',
    type: 'text',
    placeholder: 'Go to symbol',
    'aria-label': 'Go to symbol',
    spellcheck: 'false',
    autocomplete: 'off',
  })
  const list = h('ul', { class: 'lang-outline__list', role: 'listbox' })
  const panel = h('div', { class: 'lang-outline' }, input, list)

  const close = () => {
    openOutlines.delete(view)
    panel.remove()
    view.focus()
  }
  /** @param {(typeof items)[number]} item */
  const jump = (item) => {
    const from = analysis.map.toDisplay(item.pos)
    close()
    view.dispatch({
      selection: { anchor: from, head: analysis.map.toDisplay(item.end) },
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
      userEvent: 'select.outline',
    })
  }
  const render = () => {
    const rows = shown.map((item, i) =>
      h(
        'li',
        {
          class: i === active ? 'lang-outline__item is-active' : 'lang-outline__item',
          role: 'option',
          'aria-selected': i === active ? 'true' : 'false',
          onmousedown: (/** @type {MouseEvent} */ e) => {
            e.preventDefault()
            jump(item)
          },
        },
        h('span', { class: 'lang-outline__name' }, toDisplay(item.name)),
        h('span', { class: 'lang-outline__detail' }, item.kind === 'variable' ? (item.detail ?? '') : ''),
      ),
    )
    if (!rows.length) rows.push(h('li', { class: 'lang-outline__empty' }, items.length ? 'no match' : 'no functions or variables'))
    list.replaceChildren(...rows)
    list.querySelector('.is-active')?.scrollIntoView?.({ block: 'nearest' })
  }
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase()
    shown = q ? items.filter((item) => item.name.toLowerCase().includes(q)) : items
    active = 0
    render()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (shown[active]) jump(shown[active])
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (shown.length) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length
      render()
    } else {
      e.stopPropagation() // typing in the filter is not typing in the editor
    }
  })
  input.addEventListener('blur', () => {
    if (openOutlines.get(view) === close) close()
  })

  render()
  view.dom.append(panel)
  openOutlines.set(view, close)
  input.focus()
  return true
}

// ---- the extension -------------------------------------------------------------------------------

/**
 * Everything the editor needs for language support.
 * @param {GetAnalysis} getAnalysis
 */
export function languageSupport(getAnalysis) {
  return [
    autocompletion({
      override: [completionSource(getAnalysis)],
      icons: false,
      addToOptions: [
        {
          position: 20,
          render: (completion) => {
            const label = KIND_LABELS[completion.type ?? ''] ?? ''
            return label ? h('span', { class: 'lang-kind' }, label) : null
          },
        },
      ],
    }),
    hoverTooltip((view, pos) => hoverAt(getAnalysis, view.state, pos), { hoverTime: 350 }),
    signatureField(getAnalysis),
    keymap.of([
      { key: 'Mod-Space', run: startCompletion },
      { key: 'F12', run: (view) => gotoDefinition(getAnalysis, view, view.state.selection.main.head), preventDefault: true },
      { key: 'Mod-Shift-o', run: (view) => toggleOutline(getAnalysis, view), preventDefault: true },
    ]),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos === null || !gotoDefinition(getAnalysis, view, pos)) return false
        event.preventDefault()
        return true
      },
    }),
  ]
}
