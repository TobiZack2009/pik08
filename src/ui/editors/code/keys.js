import { copyLineDown, copyLineUp, deleteLine, moveLineDown, moveLineUp, redo, toggleComment, undo } from '@codemirror/commands'
import { findNext, findPrevious, gotoLine, openSearchPanel, selectNextOccurrence } from '@codemirror/search'
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { ACTIONS, parseBinding, validateBinding } from '../../shortcuts.js'

/** @import { Extension } from '@codemirror/state' */
/** @import { Command, KeyBinding } from '@codemirror/view' */
/** @import { Bindings } from '../../shortcuts.js' */

/**
 * The built-in commands whose keys the settings decide. They are taken out of CodeMirror's own
 * keymaps, or the default key would go on working after it was changed.
 */
const OWNED = new Set([
  undo,
  redo,
  toggleComment,
  openSearchPanel,
  findNext,
  findPrevious,
  gotoLine,
  selectNextOccurrence,
  moveLineUp,
  moveLineDown,
  copyLineUp,
  copyLineDown,
  deleteLine,
])

/**
 * The built-in commands the code editor binds itself, by action. The ones that need the editor's own
 * state (completion, definition, outline, comments) are given to `codeKeymap`.
 * @type {Record<string, Command>}
 */
const BUILT_IN = {
  undo,
  redo,
  'code:find': openSearchPanel,
  'code:findNext': findNext,
  'code:findPrev': findPrevious,
  'code:gotoLine': gotoLine,
  'code:selectNext': selectNextOccurrence,
  'code:moveUp': moveLineUp,
  'code:moveDown': moveLineDown,
  'code:copyUp': copyLineUp,
  'code:copyDown': copyLineDown,
  'code:deleteLine': deleteLine,
}

/** The commands that also work while the search panel has the focus. */
const IN_PANEL = new Set(['code:find', 'code:findNext', 'code:findPrev'])

/**
 * A keymap without the commands the settings decide the keys of.
 * @param {readonly KeyBinding[]} bindings
 */
export const withoutOwned = (bindings) => bindings.filter((b) => !b.run || !OWNED.has(b.run))

/** @param {string} binding  `Mod+Shift+k`, as CodeMirror writes it: `Mod-Shift-k` */
function keyName(binding) {
  const { mod, alt, shift, key } = parseBinding(binding)
  return [mod && 'Mod', alt && 'Alt', shift && 'Shift', key].filter(Boolean).join('-')
}

/**
 * The code editor's shortcuts as set in the settings. Undo and redo are the ones shared with the other
 * editors; a key for them that is a plain letter is left out, as it would stop that letter being typed.
 * @param {Bindings} bindings
 * @param {Record<string, Command>} commands  what the editor does for the other code actions
 * @returns {Extension}
 */
export function codeKeymap(bindings, commands) {
  /** @type {KeyBinding[]} */
  const list = []
  for (const { id, scope } of ACTIONS) {
    const run = BUILT_IN[id] ?? commands[id]
    if (!run || (scope !== 'code' && scope !== 'editor')) continue
    for (const binding of bindings.get(id)) {
      if (validateBinding(binding, 'code')) continue
      list.push({ key: keyName(binding), run, preventDefault: true, ...(IN_PANEL.has(id) && { scope: 'editor search-panel' }) })
    }
  }
  return Prec.high(keymap.of(list))
}
