import { formatBinding } from './shortcuts.js'

/** @import { Bindings, ShortcutAction } from './shortcuts.js' */

/**
 * ` (Ctrl+S)` for the first key of an action, or nothing when it has none.
 * @param {Bindings} bindings
 * @param {ShortcutAction} action
 */
export function keysSuffix(bindings, action) {
  const first = bindings.get(action)[0]
  return first ? ` (${formatBinding(first)})` : ''
}

/**
 * Tooltips that name the shortcut of their action, and follow it when it is rebound.
 * @param {Bindings} bindings
 */
export function titleHints(bindings) {
  /** @type {[el: HTMLElement, text: string, action: ShortcutAction][]} */
  const hinted = []

  const refresh = () => {
    for (const [el, text, action] of hinted) el.setAttribute('title', text + keysSuffix(bindings, action))
  }
  const off = bindings.on(refresh)

  return {
    /**
     * Gives an element a tooltip: the text and the keys of the action.
     * @template {HTMLElement} E
     * @param {E} el
     * @param {string} text
     * @param {ShortcutAction} action
     * @returns {E}
     */
    hint(el, text, action) {
      hinted.push([el, text, action])
      el.setAttribute('title', text + keysSuffix(bindings, action))
      return el
    },
    refresh,
    /** Stops following the bindings. */
    destroy: off,
  }
}
