// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { mountApp } from '../../src/ui/app.js'
import { TABS } from '../../src/ui/editors/index.js'
import { setCell } from '../../src/ui/editors/sound/song.js'

/** @type {ReturnType<typeof mountApp> | undefined} */
let app
/** @type {HTMLElement} */
let root

beforeEach(() => {
  localStorage.clear()
  root = document.createElement('div')
  document.body.append(root)
})

afterEach(() => {
  app?.destroy()
  app = undefined
  root.remove()
})

/** @param {Partial<Parameters<typeof mountApp>[1]>} [options] */
function mount(options = {}) {
  const io = {
    pickFile: vi.fn(async () => null),
    saveFile: vi.fn(async (/** @type {Uint8Array} */ _bytes, /** @type {string} */ name) => ({ name })),
    confirm: vi.fn(async () => true),
    choose: vi.fn(async () => null),
  }
  app = mountApp(root, { profile: pico8Profile, io, ...options })
  return { app, io }
}

/** @param {Partial<KeyboardEventInit>} init */
const key = (init) => window.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init }))

describe('mountApp', () => {
  it('builds the shell with the code tab showing', () => {
    const { app } = mount()
    expect(root.querySelector('.app__top')).not.toBeNull()
    expect(root.querySelector('.app__dock')).not.toBeNull()
    expect(root.querySelector('.app__status')).not.toBeNull()
    expect(app.tab).toBe('code')
    expect(document.title).toBe('untitled.p8 - p8n')
  })

  it('creates editors lazily and hides the inactive ones', () => {
    const made = vi.fn((/** @type {string} */ id) => ({ el: document.createElement('div'), id }))
    const editors = Object.fromEntries(TABS.map((t) => [t.id, () => made(t.id)]))
    const { app } = mount({ editors })
    expect(made).toHaveBeenCalledTimes(1)
    app.showTab('gfx')
    expect(made).toHaveBeenCalledTimes(2)
    const wraps = /** @type {HTMLElement[]} */ ([...root.querySelectorAll('.app__editor')])
    expect(wraps.map((w) => [w.dataset.editor, w.hidden])).toEqual([
      ['code', true],
      ['gfx', false],
    ])
    app.showTab('code')
    expect(made).toHaveBeenCalledTimes(2)
  })

  it('calls activate and deactivate when switching', () => {
    const calls = /** @type {string[]} */ ([])
    const editors = Object.fromEntries(
      TABS.map((t) => [
        t.id,
        () => ({
          el: document.createElement('div'),
          activate: () => calls.push(`+${t.id}`),
          deactivate: () => calls.push(`-${t.id}`),
        }),
      ]),
    )
    const { app } = mount({ editors })
    app.showTab('map')
    expect(calls).toEqual(['+code', '-code', '+map'])
  })

  it('remembers the last tab', () => {
    mount().app.showTab('sound')
    app?.destroy()
    expect(mount().app.tab).toBe('sound')
  })

  it('maps the old sfx and music tabs to the sound tab', () => {
    localStorage.setItem('p8n.tab', 'music')
    expect(mount().app.tab).toBe('sound')
  })

  it('shows the pattern of a selected song cell in the sound tab', () => {
    const { app } = mount({ sound: { output: { start: async () => {}, close: async () => {} } } })
    app.showTab('sound')
    setCell(app.project.region('music'), 3, 0, 17)
    app.project.notifyRom(['music'], Symbol('test'))
    const cell = /** @type {HTMLElement} */ (root.querySelector('.timeline__cell[data-bar="3"][data-channel="0"]'))
    cell.click()
    expect(app.tab).toBe('sound')
    expect(root.querySelector('.sound__pattern .tracker__title')?.textContent).toBe('SFX 17')
  })

  it('switches tabs with Alt+digit', () => {
    const { app } = mount()
    key({ key: '3', code: 'Digit3', altKey: true })
    expect(app.tab).toBe('map')
  })

  it('shows token and char counts and the dirty marker', () => {
    const { app } = mount()
    app.project.setCode('print(1)')
    const numbers = [...root.querySelectorAll('.status__num')].map((n) => n.textContent)
    expect(numbers[0]).toMatch(/^tokens 3\/8192$/)
    expect(numbers[1]).toBe('chars 8/65535')
    expect(root.querySelector('.app__file')?.textContent).toBe('untitled.p8 *')
    expect(document.title).toBe('* untitled.p8 - p8n')
    const meter = /** @type {any} */ (root.querySelector('p8-meter[label="tokens"]'))
    expect(meter.value).toBe(3)
  })

  it('saves with Ctrl+S and clears the dirty marker', async () => {
    const { app, io } = mount()
    app.project.setCode('x=1')
    key({ key: 's', ctrlKey: true })
    await vi.waitFor(() => expect(app.project.dirty).toBe(false))
    expect(io.saveFile).toHaveBeenCalled()
    expect(root.querySelector('.status__message')?.textContent).toBe('saved untitled.p8')
  })

  it('runs through the runner and reports its message', () => {
    const run = vi.fn(() => 'run tab opened')
    const stop = vi.fn()
    const { app } = mount({ runner: { run, stop } })
    key({ key: 'F5' })
    expect(run).toHaveBeenCalledWith(app.project)
    expect(root.querySelector('.status__message')?.textContent).toBe('run tab opened')
    key({ key: 'F5', shiftKey: true })
    expect(stop).toHaveBeenCalled()
    expect(root.querySelector('.status__message')?.textContent).toBe('stopped')
  })

  it('says so when there is no runner', () => {
    mount()
    key({ key: 'F5' })
    expect(root.querySelector('.status__message')?.textContent).toMatch(/not available/)
  })

  it('toggles the command drawer', () => {
    const cli = vi.fn(() => ({ el: document.createElement('div') }))
    mount({ cli })
    const drawer = /** @type {HTMLElement} */ (root.querySelector('.app__cli'))
    expect(drawer.hidden).toBe(true)
    key({ key: '`', ctrlKey: true })
    expect(drawer.hidden).toBe(false)
    key({ key: '`', ctrlKey: true })
    expect(drawer.hidden).toBe(true)
    expect(cli).toHaveBeenCalledTimes(1)
  })

  it('ignores shortcuts while a dialog is open', () => {
    const run = vi.fn()
    mount({ runner: { run, stop: vi.fn() } })
    document.body.append(document.createElement('p8-dialog'))
    key({ key: 'F5' })
    expect(run).not.toHaveBeenCalled()
    document.querySelector('p8-dialog')?.remove()
  })

  it('stops listening after destroy', () => {
    const run = vi.fn()
    const { app } = mount({ runner: { run, stop: vi.fn() } })
    app.destroy()
    key({ key: 'F5' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('settings', () => {
  const gear = () => /** @type {HTMLElement} */ (root.querySelector('.app__top > p8-button:last-child'))
  const click = (/** @type {HTMLElement} */ el) => /** @type {HTMLElement} */ (el.querySelector('.p8-button__inner')).click()

  it('opens from the gear at the far end of the top bar and closes back to the tab before', () => {
    const { app } = mount()
    app.showTab('map')
    expect(gear().getAttribute('icon')).toBe('settings')
    click(gear())
    expect(app.tab).toBe('settings')
    expect(gear().hasAttribute('pressed')).toBe(true)
    expect(root.querySelector('[data-editor="settings"]')?.hasAttribute('hidden')).toBe(false)
    expect(root.querySelector('[data-editor="map"]')?.hasAttribute('hidden')).toBe(true)
    click(gear())
    expect(app.tab).toBe('map')
    expect(gear().hasAttribute('pressed')).toBe(false)
  })

  it('leaves no tab of the strip selected while it shows', () => {
    const { app } = mount()
    app.showTab('settings')
    expect(root.querySelectorAll('.p8-tab[aria-selected="true"]')).toHaveLength(0)
    app.showTab('gfx')
    expect(root.querySelector('.p8-tab[aria-selected="true"]')?.getAttribute('data-id')).toBe('gfx')
    expect(gear().hasAttribute('pressed')).toBe(false)
  })

  it('toggles with Ctrl+comma', () => {
    const { app } = mount()
    key({ key: ',', ctrlKey: true })
    expect(app.tab).toBe('settings')
    key({ key: ',', ctrlKey: true })
    expect(app.tab).toBe('code')
  })

  it('goes to a tab with Alt+digit', () => {
    const { app } = mount()
    app.showTab('settings')
    key({ key: '2', code: 'Digit2', altKey: true })
    expect(app.tab).toBe('gfx')
  })

  it('is not what the next visit starts on', () => {
    const { app } = mount()
    app.showTab('sound')
    app.showTab('settings')
    app.destroy()
    expect(mount().app.tab).toBe('sound')
  })

  it('switches the theme', () => {
    const { app } = mount()
    app.showTab('settings')
    const light = /** @type {HTMLInputElement} */ (root.querySelector('input[name="theme"][value="light"]'))
    light.checked = true
    light.dispatchEvent(new Event('change', { bubbles: true }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(JSON.parse(localStorage.getItem('p8n.prefs') ?? '{}').theme).toBe('light')
  })

  it('switches the density, and has no density button in the top bar', () => {
    const { app } = mount()
    expect(root.querySelector('.app__top p8-button[icon="maximize"]')).toBeNull()
    app.showTab('settings')
    const compact = /** @type {HTMLInputElement} */ (root.querySelector('input[name="density"][value="compact"]'))
    compact.checked = true
    compact.dispatchEvent(new Event('change', { bubbles: true }))
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(JSON.parse(localStorage.getItem('p8n.prefs') ?? '{}').density).toBe('compact')
  })

  it('rebinds an editor key and the editor follows, tooltip and all', () => {
    const { app } = mount()
    app.showTab('map')
    app.showTab('settings')
    ;/** @type {HTMLElement} */ (root.querySelector('.settings__category[data-id="shortcuts"]')).click()
    const fill = /** @type {HTMLElement} */ (root.querySelector('[data-action="map:tool:fill"] .settings__key'))
    fill.click()
    fill.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true }))
    expect(JSON.parse(localStorage.getItem('p8n.shortcuts') ?? '{}')['map:tool:fill']).toEqual(['g'])

    app.showTab('map')
    const board = /** @type {HTMLElement} */ (root.querySelector('.map-editor__board'))
    key({ key: 'f' })
    expect(board.dataset.tool).toBe('pen')
    key({ key: 'g' })
    expect(board.dataset.tool).toBe('fill')
    expect(root.querySelector('.map-editor p8-button[title="Fill (G)"]')).not.toBeNull()
  })

  it('does not run the editors\' keys while the settings show', () => {
    const { app } = mount()
    app.showTab('map')
    app.showTab('settings')
    key({ key: 'e' })
    app.showTab('map')
    expect(/** @type {HTMLElement} */ (root.querySelector('.map-editor__board')).dataset.tool).toBe('pen')
  })

  it('has no theme button in the top bar any more', () => {
    mount()
    expect(root.querySelector('.app__top p8-button[icon="sun"], .app__top p8-button[icon="moon"]')).toBeNull()
  })

  it('applies a rebound shortcut at once and remembers it', () => {
    const run = vi.fn()
    const { app } = mount({ runner: { run, stop: vi.fn() } })
    app.showTab('settings')
    const shortcuts = /** @type {HTMLElement} */ (root.querySelector('.settings__category[data-id="shortcuts"]'))
    shortcuts.click()
    const runKey = /** @type {HTMLElement} */ (root.querySelector('[data-action="run"] .settings__key'))
    runKey.click()
    runKey.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true }))
    key({ key: 'F5' })
    expect(run).not.toHaveBeenCalled()
    key({ key: 'F7' })
    expect(run).toHaveBeenCalledTimes(1)

    app.destroy()
    mount({ runner: { run, stop: vi.fn() } })
    key({ key: 'F7' })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('does not run the cart for the key that sets a shortcut', () => {
    const run = vi.fn()
    const { app } = mount({ runner: { run, stop: vi.fn() } })
    app.showTab('settings')
    root.querySelector('.settings__category[data-id="shortcuts"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const saveKey = /** @type {HTMLElement} */ (root.querySelector('[data-action="save"] .settings__key'))
    saveKey.click()
    const pressed = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true })
    saveKey.dispatchEvent(pressed)
    expect(run).not.toHaveBeenCalled()
    expect(pressed.defaultPrevented).toBe(true)
  })

  it('names the shortcut in the tooltips and follows a change', () => {
    const { app } = mount()
    const runButton = () => root.querySelector('.app__toolbar p8-button[icon="play"]')
    const codeTab = () => root.querySelector('.p8-tab[data-id="code"]')
    expect(runButton()?.getAttribute('title')).toBe('Run (F5)')
    expect(codeTab()?.getAttribute('title')).toMatch(/^Code \(Alt\+1\)$|^Code \(⌥1\)$/)
    app.showTab('settings')
    root.querySelector('.settings__category[data-id="shortcuts"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const runKey = /** @type {HTMLElement} */ (root.querySelector('[data-action="run"] .settings__key'))
    runKey.click()
    runKey.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', bubbles: true, cancelable: true }))
    expect(runButton()?.getAttribute('title')).toBe('Run (F7)')
    expect(root.querySelectorAll('.p8-tab[aria-selected="true"]')).toHaveLength(0)
  })
})
