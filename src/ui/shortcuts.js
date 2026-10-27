/**
 * Keyboard shortcuts.
 *
 * Every action has default bindings (`ACTIONS`); the user can change them in the settings. A binding is
 * a string such as `Mod+Shift+s`, `F5` or `Alt+1`: the modifiers `Mod` (Ctrl or Cmd), `Alt` and `Shift`
 * in that order, then the key (`KeyboardEvent.key`, one-character keys in lower case; Shift is left out
 * of a single character key unless Ctrl/Cmd or Alt is held too, as the character already shows it).
 * `shortcutFor` maps a key event to an action name, so the table is testable; the app does what the
 * name says.
 *
 * An action has a scope: `app` actions work everywhere, `sprite`, `map` and `code` ones only while that
 * editor is shown, and `editor` ones (undo and redo) in every editor that has them. The sprite and map
 * editors' keys can be bare letters; the app's and the code editor's (where letters are typed) need
 * Ctrl/Cmd, Alt or a function key.
 *
 * @typedef {'app' | 'editor' | 'sprite' | 'map' | 'code'} Scope
 * @typedef {'save' | 'saveAs' | 'open' | 'export' | 'run' | 'stop' | 'toggleCli' | 'toggleSettings' | 'undo' | 'redo' | `tab:${number}` | `sprite:${string}` | `map:${string}` | `code:${string}`} ShortcutAction
 *
 * @typedef {Object} ActionSpec
 * @property {ShortcutAction} id
 * @property {string} label
 * @property {string} group
 * @property {Scope} scope
 * @property {readonly string[]} defaults
 *
 * @typedef {{ error: 'invalid', message: string } | { error: 'taken', by: ShortcutAction }} AssignError
 */

const STORAGE_KEY = 'p8n.shortcuts'

/** The drawing tools, in the order of the toolbar: id, label and default key. */
const TOOL_KEYS = [
  ['pen', 'Pen', 'p'],
  ['eraser', 'Eraser', 'e'],
  ['fill', 'Fill', 'f'],
  ['line', 'Line', 'l'],
  ['rect', 'Rectangle', 'r'],
  ['circle', 'Ellipse', 'o'],
  ['select', 'Select', 's'],
  ['pick', 'Pick colour', 'i'],
]

/**
 * @param {'sprite' | 'map' | 'code'} scope
 * @param {string} group
 * @param {[id: string, label: string, ...defaults: string[]][]} list  the actions, as id, label, default keys
 * @returns {ActionSpec[]}
 */
const scoped = (scope, group, list) =>
  list.map(([id, label, ...defaults]) => ({ id: /** @type {ShortcutAction} */ (`${scope}:${id}`), label, group, scope, defaults }))

/**
 * @param {'sprite' | 'map'} scope
 * @param {string} group
 * @param {[id: string, label: string, ...defaults: string[]][]} [more]  tools only this editor has
 */
const toolActions = (scope, group, more = []) =>
  scoped(scope, group, [...TOOL_KEYS, ...more].map(([id, label, key]) => [`tool:${id}`, label, key]))

/**
 * @param {'run' | 'stop' | 'save' | 'saveAs' | 'open' | 'export' | 'toggleCli' | 'toggleSettings'} id
 * @param {string} label
 * @param {string} group
 * @param {string[]} defaults
 * @returns {ActionSpec}
 */
const app = (id, label, group, ...defaults) => ({ id, label, group, scope: 'app', defaults })

/** @type {readonly ActionSpec[]} */
export const ACTIONS = [
  app('run', 'Run cart', 'Cart', 'F5', 'Mod+Enter'),
  app('stop', 'Stop cart', 'Cart', 'Shift+F5'),
  app('save', 'Save', 'File', 'Mod+s'),
  app('saveAs', 'Save as', 'File', 'Mod+Shift+s'),
  app('open', 'Open', 'File', 'Mod+o'),
  app('export', 'Export .p8.png', 'File', 'Mod+e'),
  app('toggleCli', 'Command line', 'View', 'Mod+`'),
  app('toggleSettings', 'Settings', 'View', 'Mod+,'),
  ...Array.from({ length: 9 }, (_, i) => ({
    id: /** @type {ShortcutAction} */ (`tab:${i}`),
    label: `Tab ${i + 1}`,
    group: 'Tabs',
    scope: /** @type {Scope} */ ('app'),
    defaults: [`Alt+${i + 1}`],
  })),
  { id: 'undo', label: 'Undo', group: 'Editors', scope: 'editor', defaults: ['Mod+z'] },
  { id: 'redo', label: 'Redo', group: 'Editors', scope: 'editor', defaults: ['Mod+Shift+z', 'Mod+y'] },
  ...scoped('code', 'Code editor', [
    ['complete', 'Trigger completion', 'Mod+Space'],
    ['definition', 'Go to definition', 'F12'],
    ['outline', 'Go to symbol', 'Mod+Shift+o'],
    ['comment', 'Toggle comment', 'Mod+/'],
    ['find', 'Find', 'Mod+f'],
    ['findNext', 'Find next', 'Mod+g', 'F3'],
    ['findPrev', 'Find previous', 'Mod+Shift+g', 'Shift+F3'],
    ['gotoLine', 'Go to line', 'Mod+Alt+g'],
    ['selectNext', 'Select next occurrence', 'Mod+d'],
    ['moveUp', 'Move line up', 'Alt+ArrowUp'],
    ['moveDown', 'Move line down', 'Alt+ArrowDown'],
    ['copyUp', 'Copy line up', 'Alt+Shift+ArrowUp'],
    ['copyDown', 'Copy line down', 'Alt+Shift+ArrowDown'],
    ['deleteLine', 'Delete line', 'Mod+Shift+k'],
  ]),
  ...toolActions('sprite', 'Sprite tools'),
  ...scoped('sprite', 'Sprite editing', [
    ['copy', 'Copy', 'Mod+c'],
    ['cut', 'Cut', 'Mod+x'],
    ['paste', 'Paste', 'Mod+v'],
    ['flipH', 'Flip horizontally', 'h'],
    ['flipV', 'Flip vertically', 'v'],
    ['rotate', 'Rotate clockwise', 't'],
    ['clear', 'Clear', 'Delete', 'Backspace'],
    ['deselect', 'Deselect', 'Escape'],
    ['colorPrev', 'Previous colour', '['],
    ['colorNext', 'Next colour', ']'],
  ]),
  ...toolActions('map', 'Map tools', [['pan', 'Pan', 'h']]),
  ...scoped('map', 'Map editing', [
    ['copy', 'Copy', 'Mod+c'],
    ['cut', 'Cut', 'Mod+x'],
    ['paste', 'Paste', 'Mod+v'],
    ['clear', 'Clear', 'Delete', 'Backspace'],
    ['deselect', 'Deselect', 'Escape'],
    ['zoomIn', 'Zoom in', '+', '='],
    ['zoomOut', 'Zoom out', '-'],
    ['panHold', 'Pan while held', 'Space'],
  ]),
]

/**
 * The actions to show for an editor with these tabs: the tab shortcuts get the tabs' names, and the
 * ones past the last tab are left out.
 * @param {readonly { label: string }[]} tabs
 * @returns {ActionSpec[]}
 */
export function describeActions(tabs) {
  return ACTIONS.flatMap((spec) => {
    if (!spec.id.startsWith('tab:')) return [spec]
    const tab = tabs[Number(spec.id.slice(4))]
    return tab ? [{ ...spec, label: `Go to ${tab.label}` }] : []
  })
}

/**
 * Whether an action of one scope is in force when another scope's keys are looked at.
 * @param {Scope} spec  the scope of the action
 * @param {Scope} scope  where the key was pressed
 */
const serves = (spec, scope) => spec === scope || (spec === 'editor' && scope !== 'app')

/** Whether two scopes can be active together, so their actions must not share a key. */
const overlaps = (/** @type {Scope} */ a, /** @type {Scope} */ b) => a === b || a === 'app' || b === 'app' || a === 'editor' || b === 'editor'

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'AltGraph', 'Shift', 'OS', 'Hyper', 'Super'])
const MODIFIERS = ['Mod', 'Alt', 'Shift']
/** Keys that must keep working in the editors even when Ctrl or Cmd is held. */
const RESERVED = new Set(['a', 'c', 'v', 'x', 'y', 'z'])
/** The same for the code editor, where undo and redo are bindings like the rest. */
const TEXT_KEYS = new Set(['a', 'c', 'v', 'x'])
const FUNCTION_KEY = /^F([1-9]|1[0-2])$/

/** @param {Pick<KeyboardEvent, 'key' | 'code' | 'altKey'>} e */
function keyName(e) {
  if (e.altKey) {
    // Option changes the character on some layouts, so go by the physical key
    const physical = /^(?:Digit|Key)(.)$/.exec(e.code)
    if (physical) return physical[1].toLowerCase()
  }
  if (e.key === ' ') return 'Space'
  return e.key.length === 1 ? e.key.toLowerCase() : e.key
}

/**
 * The binding a key event stands for, or null for a bare modifier key.
 * @param {Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>} e
 * @returns {string | null}
 */
export function bindingOf(e) {
  if (!e.key || MODIFIER_KEYS.has(e.key)) return null
  const key = keyName(e)
  const mod = e.ctrlKey || e.metaKey
  const shift = e.shiftKey && (key.length > 1 || mod || e.altKey)
  return [mod && 'Mod', e.altKey && 'Alt', shift && 'Shift', key].filter(Boolean).join('+')
}

/**
 * The key of a binding, without its modifiers: `s` for `Mod+Shift+s`.
 * @param {string} binding
 */
export function bindingKey(binding) {
  return parseBinding(binding).key
}

/**
 * The name a key event has in a binding, whatever modifiers are held: `Space` for the space bar.
 * @param {Pick<KeyboardEvent, 'key' | 'code' | 'altKey'>} e
 */
export function eventKey(e) {
  return keyName(e)
}

/**
 * @param {string} binding
 * @returns {{ mod: boolean, alt: boolean, shift: boolean, key: string }}
 */
export function parseBinding(binding) {
  const found = { mod: false, alt: false, shift: false }
  let rest = binding
  for (let again = true; again; ) {
    again = false
    for (const name of MODIFIERS) {
      if (rest.startsWith(name + '+') && rest.length > name.length + 1) {
        found[/** @type {'mod' | 'alt' | 'shift'} */ (name.toLowerCase())] = true
        rest = rest.slice(name.length + 1)
        again = true
      }
    }
  }
  return { ...found, key: rest }
}

/**
 * Why a binding cannot be used, or null when it can. In the app a plain key would stop typing in the
 * editors, so it needs Ctrl/Cmd or Alt (or be a function key), and the editing keys stay as they are.
 * In the code editor, where plain keys are typed, the rule is the same but only the clipboard keys and
 * select all are kept. In the sprite and map editors plain keys are the point, except the ones with a
 * fixed job.
 * @param {string} binding
 * @param {Scope} [scope]
 * @returns {string | null}
 */
export function validateBinding(binding, scope = 'app') {
  const { mod, alt, key } = parseBinding(binding)
  if (!key || MODIFIER_KEYS.has(key) || binding !== normalize(binding)) return 'not a valid key'
  if (scope === 'code') {
    if (!mod && !alt && !FUNCTION_KEY.test(key)) return 'needs Ctrl/Cmd or Alt, or a function key'
    if (mod && !alt && TEXT_KEYS.has(key)) return 'reserved for editing'
    return null
  }
  if (scope !== 'app') {
    if (!mod && !alt && (key === 'Tab' || key.startsWith('Arrow'))) return 'used to move around'
    return null
  }
  if (!mod && !alt && !FUNCTION_KEY.test(key)) return 'needs Ctrl/Cmd or Alt, or a function key'
  if (mod && !alt && RESERVED.has(key)) return 'reserved for editing'
  return null
}

/** @param {string} binding */
function normalize(binding) {
  const { mod, alt, shift, key } = parseBinding(binding)
  const keep = shift && (key.length > 1 || mod || alt)
  return [mod && 'Mod', alt && 'Alt', keep && 'Shift', key.length === 1 ? key.toLowerCase() : key].filter(Boolean).join('+')
}

/** @returns {boolean} */
function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')
}

/**
 * How a binding is written for people: `Ctrl+Shift+S`, or `⌘⇧S` on a Mac.
 * @param {string} binding
 * @param {boolean} [mac]
 */
export function formatBinding(binding, mac = isMac()) {
  const { mod, alt, shift, key } = parseBinding(binding)
  const shown = key.length === 1 ? key.toUpperCase() : key
  const parts = mac
    ? [alt && '⌥', shift && '⇧', mod && '⌘', shown]
    : [mod && 'Ctrl', alt && 'Alt', shift && 'Shift', shown]
  return parts.filter(Boolean).join(mac ? '' : '+')
}

/**
 * The modifiers held in a key event, as they are shown while a shortcut is being recorded: `Ctrl+Shift`,
 * or `⇧⌘` on a Mac. Empty when none is held.
 * @param {Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>} e
 * @param {boolean} [mac]
 */
export function formatHeld(e, mac = isMac()) {
  const mod = e.ctrlKey || e.metaKey
  const parts = mac ? [e.altKey && '⌥', e.shiftKey && '⇧', mod && '⌘'] : [mod && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift']
  return parts.filter(Boolean).join(mac ? '' : '+')
}

/**
 * The action a key event triggers.
 * @param {Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>} e
 * @param {Partial<Record<string, readonly string[]>>} [custom]  bindings that replace the defaults, by action
 * @param {Scope} [scope]  whose actions to look at
 * @returns {ShortcutAction | null}
 */
export function shortcutFor(e, custom = {}, scope = 'app') {
  const binding = bindingOf(e)
  if (!binding) return null
  return ACTIONS.find((spec) => serves(spec.scope, scope) && (custom[spec.id] ?? spec.defaults).includes(binding))?.id ?? null
}

/**
 * The user's bindings, kept in localStorage. Only the actions that differ from the defaults are saved.
 * @param {Storage | null} [storage]  where to keep them; null keeps them nowhere
 */
export function createBindings(storage = safeStorage()) {
  /** @type {Map<string, string[]>} */
  const custom = load(storage)
  /** @type {Set<() => void>} */
  const listeners = new Set()

  /** @param {string} id */
  const spec = (id) => /** @type {ActionSpec} */ (ACTIONS.find((a) => a.id === id))

  /** @param {string} id @returns {readonly string[]} */
  const get = (id) => custom.get(id) ?? spec(id).defaults

  /** @param {string} id @param {string[]} list */
  function put(id, list) {
    const same = list.length === spec(id).defaults.length && list.every((b, i) => b === spec(id).defaults[i])
    if (same) custom.delete(id)
    else custom.set(id, list)
    save(storage, custom)
    for (const fn of [...listeners]) fn()
  }

  /**
   * Which action uses a binding, among the ones it would clash with: those of its own scope, the
   * app's and the editors' shared ones, which work together with it.
   * @param {string} binding
   * @param {Scope} [scope]
   * @returns {ShortcutAction | undefined}
   */
  const find = (binding, scope = 'app') =>
    ACTIONS.find((a) => overlaps(a.scope, scope) && get(a.id).includes(binding))?.id

  return {
    get,
    find,

    /** @param {string} id */
    isCustom: (id) => custom.has(id),
    /** Whether any action differs from its defaults. */
    anyCustom: () => custom.size > 0,

    /**
     * @param {Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>} e
     * @param {Scope} [scope]
     */
    match: (e, scope = 'app') => shortcutFor(e, Object.fromEntries(custom), scope),

    /**
     * Gives an action this one key, in place of the ones it had.
     * @param {ShortcutAction} id
     * @param {string} binding
     * @returns {AssignError | null}  why it was refused
     */
    assign(id, binding) {
      const { scope } = spec(id)
      const message = validateBinding(binding, scope)
      if (message) return { error: 'invalid', message }
      const owner = find(binding, scope)
      if (owner && owner !== id) return { error: 'taken', by: owner }
      const now = get(id)
      if (now.length !== 1 || now[0] !== binding) put(id, [binding])
      return null
    },

    /** Leaves an action without a key. @param {ShortcutAction} id */
    unbind(id) {
      if (get(id).length) put(id, [])
    },

    /** @param {ShortcutAction} id */
    reset(id) {
      if (custom.delete(id)) put(id, [...spec(id).defaults])
    },

    resetAll() {
      if (!custom.size) return
      custom.clear()
      save(storage, custom)
      for (const fn of [...listeners]) fn()
    },

    /**
     * Calls back after any change.
     * @param {() => void} fn
     * @returns {() => void}  stops listening
     */
    on(fn) {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
  }
}

/** @typedef {ReturnType<typeof createBindings>} Bindings */

/**
 * @param {Storage | null | undefined} storage
 * @returns {Map<string, string[]>}
 */
function load(storage) {
  /** @type {Map<string, string[]>} */
  const custom = new Map()
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}')
    for (const { id, defaults, scope } of ACTIONS) {
      const list = saved?.[id]
      if (!Array.isArray(list)) continue
      const valid = [...new Set(list.filter((b) => typeof b === 'string' && validateBinding(b, scope) === null))]
      if (valid.length !== defaults.length || valid.some((b, i) => b !== defaults[i])) custom.set(id, valid)
    }
  } catch {
    // unreadable: the defaults
  }
  return custom
}

/**
 * @param {Storage | null | undefined} storage
 * @param {Map<string, string[]>} custom
 */
function save(storage, custom) {
  try {
    if (custom.size) storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(custom)))
    else storage?.removeItem(STORAGE_KEY)
  } catch {
    // storage full or blocked: the change just won't be remembered
  }
}

/** @returns {Storage | undefined} */
function safeStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined // blocked in some privacy modes
  }
}
