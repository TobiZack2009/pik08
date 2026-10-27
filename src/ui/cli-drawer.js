import './cli-drawer.css'
import { h } from './dom.js'
import { executeCommand } from './cli.js'
import { compressedSize, quickStats } from './stats.js'

/** @import { EditorContext, EditorView } from './editors/index.js' */
/** @import { FileActions } from './file-actions.js' */
/** @import { CliContext } from './cli.js' */

/**
 * What the drawer needs from the shell: the editor context plus the file actions and a way to run
 * that says what happened.
 * @typedef {EditorContext & { actions: FileActions, run: () => string }} CliHost
 */

/** The most lines kept in the log; the oldest go first. */
const MAX_LINES = 300
/** The most commands kept to step back through. */
const MAX_HISTORY = 100

/**
 * The commands of the drawer, wired to a project.
 * @param {CliHost} host
 * @returns {CliContext}
 */
export function createCliContext({ project, actions, run }) {
  return {
    save: (name) => actions.save(name),
    load: () => actions.open(),
    exportCart: (format, name) => actions.exportCart(format, name),
    run,
    newCart: () => actions.newCart(),
    async stats() {
      const { limits } = project.profile
      const { tokens, chars } = quickStats(project.cart)
      const compressed = compressedSize(project.cart.code)
      /** @param {string} label @param {number} value @param {number | undefined} max */
      const line = (label, value, max) => `${label.padEnd(11)} ${value}${max === undefined ? '' : ` / ${max}`}`
      return [line('tokens', tokens, limits.tokens), line('characters', chars, limits.codeChars), line('compressed', compressed, limits.compressedBytes)]
    },
  }
}

/**
 * The command drawer: a log, and a prompt with history (Up/Down). Commands are in `cli.js`.
 *
 * @param {CliHost} host
 * @returns {EditorView}
 */
export function createCliDrawer(host) {
  const context = createCliContext(host)
  const log = h('div', { class: 'cli__log', role: 'log', 'aria-live': 'polite' })
  const input = /** @type {HTMLInputElement} */ (
    h('input', { class: 'cli__input', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'command' })
  )
  const el = h(
    'div',
    { class: 'cli', onclick: (/** @type {MouseEvent} */ e) => e.target === el || e.target === log ? input.focus() : undefined },
    log,
    h('label', { class: 'cli__prompt' }, h('span', { class: 'cli__caret', 'aria-hidden': 'true' }, '>'), input),
  )

  /** @type {string[]} */
  const history = []
  /** Where Up/Down are in the history; `history.length` is the line being typed. */
  let at = 0
  let draft = ''
  let busy = false

  /** @param {string} text @param {'echo' | 'out' | 'error'} kind */
  function print(text, kind) {
    log.append(h('div', { class: 'cli__line', dataset: { kind } }, text || ' '))
    while (log.childElementCount > MAX_LINES) log.firstElementChild?.remove()
    log.scrollTop = log.scrollHeight
  }

  async function submit() {
    const line = input.value
    if (busy) return
    input.value = ''
    print(line, 'echo')
    if (line.trim() && history.at(-1) !== line) {
      history.push(line)
      if (history.length > MAX_HISTORY) history.shift()
    }
    at = history.length
    draft = ''
    busy = true
    el.setAttribute('aria-busy', 'true')
    try {
      const result = await executeCommand(line, context)
      for (const text of result.lines) print(text, result.ok ? 'out' : 'error')
    } finally {
      busy = false
      el.removeAttribute('aria-busy')
    }
  }

  /** @param {number} step */
  function recall(step) {
    if (at === history.length) draft = input.value
    at = Math.min(history.length, Math.max(0, at + step))
    input.value = at === history.length ? draft : history[at]
    input.setSelectionRange(input.value.length, input.value.length)
  }

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'ArrowUp' && !e.shiftKey) {
      e.preventDefault()
      recall(-1)
    } else if (e.key === 'ArrowDown' && !e.shiftKey) {
      e.preventDefault()
      recall(1)
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      log.replaceChildren()
    }
  })

  print("type 'help' for the commands", 'out')

  return {
    el,
    activate: () => input.focus(),
    deactivate: () => input.blur(),
    destroy: () => el.remove(),
  }
}
