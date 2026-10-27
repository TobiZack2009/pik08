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

  it('switches the theme', () => {
    mount()
    const before = document.documentElement.dataset.theme
    const toggle = /** @type {HTMLElement} */ (root.querySelector('.app__top > p8-button:last-child .p8-button__inner'))
    toggle.click()
    expect(document.documentElement.dataset.theme).not.toBe(before)
  })
})
