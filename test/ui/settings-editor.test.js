// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineElements } from '../../src/ui/elements/index.js'
import { createSettingsEditor, CATEGORIES } from '../../src/ui/editors/settings/settings-editor.js'
import { createBindings, describeActions, formatBinding, formatHeld } from '../../src/ui/shortcuts.js'

beforeAll(() => defineElements())

/** @type {ReturnType<typeof createSettingsEditor> | undefined} */
let editor

afterEach(() => {
  editor?.destroy?.()
  editor = undefined
  document.body.replaceChildren()
})

/** @returns {Storage} */
function memoryStorage() {
  /** @type {Record<string, string>} */
  const data = {}
  return /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => data[k] ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => void (data[k] = v),
    removeItem: (/** @type {string} */ k) => void delete data[k],
  })
}

function setup() {
  const prefs = { theme: /** @type {'dark' | 'light'} */ ('dark'), density: /** @type {'comfortable' | 'compact'} */ ('comfortable') }
  const setPrefs = vi.fn((/** @type {Partial<typeof prefs>} */ patch) => void Object.assign(prefs, patch))
  const bindings = createBindings(memoryStorage())
  const tabs = [{ label: 'Code' }, { label: 'Sprites' }]
  const settings = { prefs: () => prefs, setPrefs, bindings, actions: describeActions(tabs) }
  editor = createSettingsEditor(/** @type {any} */ ({ settings }))
  document.body.append(editor.el)
  const go = (/** @type {string} */ id) => /** @type {HTMLElement} */ (editor?.el.querySelector(`.settings__category[data-id="${id}"]`)).click()
  return { prefs, setPrefs, bindings, go, el: editor.el }
}

/** @param {string} id */
const row = (id) => /** @type {HTMLElement} */ (document.querySelector(`.settings__row[data-action="${id}"]`))
/** @param {string} id */
const keyButton = (id) => /** @type {HTMLElement} */ (row(id).querySelector('.settings__key'))
/** What the one button of an action says. @param {string} id */
const keysOf = (id) => keyButton(id).textContent
const errorOf = (/** @type {string} */ id) => row(id).querySelector('.settings__error')?.textContent

/**
 * Presses keys on an element and says whether the event was allowed to go on to the browser.
 * @param {Element} target
 * @param {KeyboardEventInit} init
 */
function press(target, init) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('settings view', () => {
  it('lists the categories with the first one picked', () => {
    const { el } = setup()
    const labels = [...el.querySelectorAll('.settings__category')].map((b) => b.textContent)
    expect(labels).toEqual(CATEGORIES.map((c) => c.label))
    expect(el.querySelector('[aria-selected="true"]')?.textContent).toBe('Appearance')
    expect(el.querySelector('.settings__page h2')?.textContent).toBe('Appearance')
  })

  it('shows the category that is picked', () => {
    const { el, go } = setup()
    go('shortcuts')
    expect(el.querySelector('.settings__page h2')?.textContent).toBe('Shortcuts')
    expect(el.querySelector('[aria-selected="true"]')?.textContent).toBe('Shortcuts')
    expect(el.querySelectorAll('[aria-selected="true"]')).toHaveLength(1)
    go('appearance')
    expect(el.querySelector('.settings__page h2')?.textContent).toBe('Appearance')
  })

  it('moves between categories with the arrow keys', () => {
    const { el } = setup()
    const menu = /** @type {HTMLElement} */ (el.querySelector('.settings__menu'))
    press(menu, { key: 'ArrowDown' })
    expect(el.querySelector('[aria-selected="true"]')?.textContent).toBe('Shortcuts')
    press(menu, { key: 'ArrowDown' }) // wraps
    expect(el.querySelector('[aria-selected="true"]')?.textContent).toBe('Appearance')
    press(menu, { key: 'End' })
    expect(el.querySelector('[aria-selected="true"]')?.textContent).toBe('Shortcuts')
    press(menu, { key: 'ArrowUp' })
    expect(el.querySelector('[aria-selected="true"]')?.textContent).toBe('Appearance')
  })

  it('needs the settings of the app', () => {
    expect(() => createSettingsEditor(/** @type {any} */ ({}))).toThrow(/settings/)
  })
})

describe('appearance', () => {
  it('shows the theme and changes it', () => {
    const { el, setPrefs, prefs } = setup()
    const radios = /** @type {HTMLInputElement[]} */ ([...el.querySelectorAll('input[name="theme"]')])
    expect(radios.map((r) => [r.value, r.checked])).toEqual([
      ['dark', true],
      ['light', false],
    ])
    radios[1].checked = true
    radios[1].dispatchEvent(new Event('change', { bubbles: true }))
    expect(setPrefs).toHaveBeenCalledWith({ theme: 'light' })
    expect(prefs.theme).toBe('light')
  })

  it('shows the density and changes it', () => {
    const { el, setPrefs, prefs } = setup()
    const radios = /** @type {HTMLInputElement[]} */ ([...el.querySelectorAll('input[name="density"]')])
    expect(radios.map((r) => [r.value, r.checked])).toEqual([
      ['comfortable', true],
      ['compact', false],
    ])
    expect(el.querySelector('[role="radiogroup"][aria-label="Density"]')).not.toBeNull()
    radios[1].checked = true
    radios[1].dispatchEvent(new Event('change', { bubbles: true }))
    expect(setPrefs).toHaveBeenCalledWith({ density: 'compact' })
    expect(prefs).toEqual({ theme: 'dark', density: 'compact' })
  })

  it('keeps the theme when the density changes', () => {
    const { el, prefs } = setup()
    prefs.theme = 'light'
    const compact = /** @type {HTMLInputElement} */ (el.querySelector('input[value="compact"]'))
    compact.checked = true
    compact.dispatchEvent(new Event('change', { bubbles: true }))
    expect(prefs.theme).toBe('light')
  })

  it('shows the theme that is set', () => {
    const { go, prefs } = setup()
    prefs.theme = 'light'
    go('shortcuts')
    go('appearance')
    expect(/** @type {HTMLInputElement} */ (document.querySelector('input[value="light"]')).checked).toBe(true)
  })
})

describe('shortcuts', () => {
  it('lists the actions in groups, each with one button for its keys', () => {
    const { go, el } = setup()
    go('shortcuts')
    expect([...el.querySelectorAll('.settings__subtitle')].map((h) => h.textContent)).toEqual([
      'Cart',
      'File',
      'View',
      'Tabs',
      'Editors',
      'Code editor',
      'Sprite tools',
      'Sprite editing',
      'Map tools',
      'Map editing',
    ])
    expect(row('run').querySelector('.settings__label')?.textContent).toBe('Run cart')
    expect(keysOf('run')).toBe(`F5 / ${formatBinding('Mod+Enter')}`)
    expect(row('tab:1').querySelector('.settings__label')?.textContent).toBe('Go to Sprites')
    expect(document.querySelector('[data-action="tab:2"]')).toBeNull()
    for (const r of document.querySelectorAll('.settings__row--keys')) expect(r.querySelectorAll('.settings__key')).toHaveLength(1)
    expect(document.querySelector('.settings__row p8-button[icon="plus"]')).toBeNull()
  })

  it('rebinds an action by pressing the new keys, replacing all of its own', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    keyButton('run').click()
    expect(keyButton('run').dataset.recording).toBeDefined()
    expect(keyButton('run').textContent).toBe('press keys…')
    const event = press(keyButton('run'), { key: 'F7' })
    expect(event.defaultPrevented).toBe(true)
    expect(bindings.get('run')).toEqual(['F7'])
    expect(keysOf('run')).toBe('F7')
    expect(document.activeElement).toBe(keyButton('run'))
    expect(keyButton('run').dataset.recording).toBeUndefined()
  })

  it('keeps the keys from the rest of the app while recording', () => {
    const { go } = setup()
    go('shortcuts')
    const reached = vi.fn()
    window.addEventListener('keydown', reached)
    keyButton('run').click()
    press(keyButton('run'), { key: 'F7' })
    window.removeEventListener('keydown', reached)
    expect(reached).not.toHaveBeenCalled()
  })

  it('records modifiers and a key together, and shows the modifiers as they go down', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    const button = keyButton('save')
    button.click()
    press(button, { key: 'Control', ctrlKey: true })
    expect(button.dataset.recording).toBeDefined()
    expect(button.textContent).toBe(`${formatHeld({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })}+…`)
    press(button, { key: 'Shift', ctrlKey: true, shiftKey: true })
    expect(button.textContent).toBe(`${formatHeld({ ctrlKey: true, metaKey: false, shiftKey: true, altKey: false })}+…`)
    button.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', ctrlKey: true, bubbles: true }))
    expect(button.textContent).toBe(`${formatHeld({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false })}+…`)
    button.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }))
    expect(button.textContent).toBe('press keys…')
    press(button, { key: 'J', ctrlKey: true, shiftKey: true })
    expect(bindings.get('save')).toEqual(['Mod+Shift+j'])
    expect(keysOf('save')).toBe(formatBinding('Mod+Shift+j'))
  })

  it('records a key by Alt even when Option changes the character', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    keyButton('save').click()
    press(keyButton('save'), { key: 'ß', code: 'KeyS', altKey: true })
    expect(bindings.get('save')).toEqual(['Alt+s'])
  })

  it('says why a key is refused and goes on listening', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    keyButton('run').click()
    press(keyButton('run'), { key: 's', ctrlKey: true })
    expect(errorOf('run')).toBe(`${formatBinding('Mod+s')} is already used by Save`)
    expect(bindings.get('run')).toEqual(['F5', 'Mod+Enter'])
    expect(keyButton('run').dataset.recording).toBeDefined()
    press(keyButton('run'), { key: 'q' })
    expect(errorOf('run')).toBe('Q: needs Ctrl/Cmd or Alt, or a function key')
    press(keyButton('run'), { key: 'F7' })
    expect(errorOf('run')).toBe('')
    expect(bindings.get('run')).toEqual(['F7'])
  })

  it('accepts a key the action already has, and drops its other keys', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    keyButton('run').click()
    press(keyButton('run'), { key: 'F5' })
    expect(errorOf('run')).toBe('')
    expect(bindings.get('run')).toEqual(['F5'])
  })

  it('cancels with Escape and when the focus leaves', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    keyButton('run').click()
    press(keyButton('run'), { key: 'Escape' })
    expect(keysOf('run')).toBe(`F5 / ${formatBinding('Mod+Enter')}`)
    expect(bindings.anyCustom()).toBe(false)

    keyButton('run').click()
    keyButton('run').dispatchEvent(new FocusEvent('blur'))
    expect(keyButton('run').dataset.recording).toBeUndefined()
    expect(keyButton('run').textContent).toBe(`F5 / ${formatBinding('Mod+Enter')}`)
  })

  it('clears the keys with Backspace or Delete', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    keyButton('run').click()
    press(keyButton('run'), { key: 'Backspace' })
    expect(bindings.get('run')).toEqual([])
    expect(keysOf('run')).toBe('Unassigned')
    keyButton('stop').click()
    press(keyButton('stop'), { key: 'Delete' })
    expect(keysOf('stop')).toBe('Unassigned')
  })

  it('can record Backspace with a modifier', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    keyButton('save').click()
    press(keyButton('save'), { key: 'Backspace', ctrlKey: true })
    expect(bindings.get('save')).toEqual(['Mod+Backspace'])
  })

  it('does not start over when the space bar that was recorded is released', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    const button = keyButton('map:panHold')
    button.click()
    press(button, { key: ' ' })
    expect(bindings.get('map:panHold')).toEqual(['Space'])
    const up = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true })
    button.dispatchEvent(up)
    expect(up.defaultPrevented).toBe(true)
    const again = new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true })
    button.dispatchEvent(again)
    expect(again.defaultPrevented).toBe(false)
  })

  it('resets an action, and shows the button only while it differs', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    const reset = () => /** @type {HTMLElement} */ (row('run').querySelector('p8-button[icon="rotate-ccw"]'))
    expect(reset().hasAttribute('hidden')).toBe(true)
    bindings.assign('run', 'F7')
    expect(reset().hasAttribute('hidden')).toBe(false)
    reset().click()
    expect(keysOf('run')).toBe(`F5 / ${formatBinding('Mod+Enter')}`)
    expect(reset().hasAttribute('hidden')).toBe(true)
  })

  it('resets everything, with the button off while nothing differs', () => {
    const { go, bindings, el } = setup()
    go('shortcuts')
    const resetAll = /** @type {HTMLElement} */ (el.querySelector('.settings__header p8-button'))
    expect(resetAll.hasAttribute('disabled')).toBe(true)
    bindings.assign('run', 'F7')
    bindings.assign('save', 'F2')
    expect(resetAll.hasAttribute('disabled')).toBe(false)
    resetAll.querySelector('button')?.click()
    expect(bindings.anyCustom()).toBe(false)
    expect(keysOf('save')).toBe(formatBinding('Mod+s'))
    expect(resetAll.hasAttribute('disabled')).toBe(true)
  })

  it('follows changes made elsewhere', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    bindings.assign('open', 'F8')
    expect(keysOf('open')).toBe('F8')
  })

  it('stops following the bindings when the category is left', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    const open = row('open')
    go('appearance')
    bindings.assign('open', 'F8')
    expect(open.textContent).not.toContain('F8')
  })
})

describe('editor shortcuts', () => {
  it('lists the actions of the editors, undo and redo once', () => {
    const { go } = setup()
    go('shortcuts')
    expect(row('sprite:tool:pen').querySelector('.settings__label')?.textContent).toBe('Pen')
    expect(keysOf('sprite:tool:pen')).toBe('P')
    expect(keysOf('undo')).toBe(formatBinding('Mod+z'))
    expect(keysOf('redo')).toBe(`${formatBinding('Mod+Shift+z')} / ${formatBinding('Mod+y')}`)
    expect(document.querySelectorAll('[data-action="undo"], [data-action="redo"]')).toHaveLength(2)
    expect([...document.querySelectorAll('.settings__label')].filter((l) => /^(Undo|Redo)$/.test(l.textContent ?? ''))).toHaveLength(2)
    expect(keysOf('map:panHold')).toBe('Space')
    expect(keysOf('map:zoomIn')).toBe('+ / =')
    expect(document.querySelector('[data-action="map:tool:pan"]')).not.toBeNull()
    expect(document.querySelector('[data-action="sprite:tool:pan"]')).toBeNull()
  })

  it('takes a plain key, which the app\'s own shortcuts would not', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    keyButton('sprite:tool:pen').click()
    press(keyButton('sprite:tool:pen'), { key: 'Q', shiftKey: true })
    expect(bindings.get('sprite:tool:pen')).toEqual(['q'])
    expect(keysOf('sprite:tool:pen')).toBe('Q')
    keyButton('run').click()
    press(keyButton('run'), { key: 'q' })
    expect(errorOf('run')).toMatch(/Ctrl\/Cmd or Alt/)
  })

  it('says which action of the editor has the key, and lets the other editor have it', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    keyButton('sprite:tool:pen').click()
    press(keyButton('sprite:tool:pen'), { key: 'e' })
    expect(errorOf('sprite:tool:pen')).toBe('E is already used by Eraser (sprite tools)')
    expect(bindings.get('sprite:tool:pen')).toEqual(['p'])

    keyButton('map:tool:pen').click()
    press(keyButton('map:tool:pen'), { key: 'v' })
    expect(errorOf('map:tool:pen')).toBe('')
    expect(bindings.get('map:tool:pen')).toEqual(['v'])
  })

  it('moves undo for every editor at once', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    keyButton('undo').click()
    press(keyButton('undo'), { key: 'u', ctrlKey: true })
    expect(bindings.match({ key: 'u', code: '', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, 'sprite')).toBe('undo')
    expect(bindings.match({ key: 'u', code: '', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, 'map')).toBe('undo')
    keyButton('sprite:flipH').click()
    press(keyButton('sprite:flipH'), { key: 'u', ctrlKey: true })
    expect(errorOf('sprite:flipH')).toBe(`${formatBinding('Mod+u')} is already used by Undo`)
  })

  it('refuses a key an app shortcut has', () => {
    const { go } = setup()
    go('shortcuts')
    keyButton('sprite:tool:pen').click()
    press(keyButton('sprite:tool:pen'), { key: 'F5' })
    expect(errorOf('sprite:tool:pen')).toBe('F5 is already used by Run cart')
  })

  it('restores the default with the reset button', () => {
    const { go, bindings } = setup()
    go('shortcuts')
    keyButton('map:zoomIn').click()
    press(keyButton('map:zoomIn'), { key: 'k' })
    expect(bindings.get('map:zoomIn')).toEqual(['k'])
    ;/** @type {HTMLElement} */ (row('map:zoomIn').querySelector('p8-button[icon="rotate-ccw"]')).click()
    expect(bindings.get('map:zoomIn')).toEqual(['+', '='])
  })
})
