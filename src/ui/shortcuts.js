/**
 * Global keyboard shortcuts. `shortcutFor` maps a key event to an action name, so the table is
 * testable; the app does what the name says.
 *
 * @typedef {'save' | 'saveAs' | 'open' | 'export' | 'run' | 'stop' | 'toggleCli' | `tab:${number}`} ShortcutAction
 */

/**
 * @param {Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>} e
 * @returns {ShortcutAction | null}
 */
export function shortcutFor(e) {
  const mod = e.ctrlKey || e.metaKey
  if (e.key === 'F5') return e.shiftKey ? 'stop' : 'run'
  if (mod && !e.altKey) {
    switch (e.key.toLowerCase()) {
      case 's':
        return e.shiftKey ? 'saveAs' : 'save'
      case 'o':
        return 'open'
      case 'e':
        return 'export'
      case 'enter':
        return 'run'
      case '`':
        return 'toggleCli'
    }
  }
  if (e.altKey && !mod && !e.shiftKey) {
    const digit = /^Digit([1-9])$/.exec(e.code)
    if (digit) return `tab:${Number(digit[1]) - 1}`
  }
  return null
}
