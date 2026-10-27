// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { createCliContext, createCliDrawer } from '../../src/ui/cli-drawer.js'
import { Project } from '../../src/ui/store.js'

/** @type {ReturnType<typeof createCliDrawer> | undefined} */
let drawer

afterEach(() => {
  drawer?.destroy?.()
  drawer = undefined
})

function setup() {
  const project = Project.empty(pico8Profile)
  const actions = {
    open: vi.fn(async () => 'opened a.p8'),
    save: vi.fn(async (/** @type {string | undefined} */ name) => `saved ${name ?? 'cart.p8'}`),
    exportCart: vi.fn(async (/** @type {string} */ format, /** @type {string | undefined} */ name) => `exported ${format} ${name ?? ''}`.trim()),
    newCart: vi.fn(async () => 'new cart'),
  }
  const run = vi.fn(() => 'running')
  const host = { project, setStatus: vi.fn(), setInfo: vi.fn(), requestRun: vi.fn(), actions: /** @type {any} */ (actions), run }
  drawer = createCliDrawer(host)
  document.body.append(drawer.el)
  const input = /** @type {HTMLInputElement} */ (drawer.el.querySelector('.cli__input'))
  const log = /** @type {HTMLElement} */ (drawer.el.querySelector('.cli__log'))
  return { project, actions, run, input, log }
}

/** @param {HTMLInputElement} input @param {string} key @param {KeyboardEventInit} [init] */
const key = (input, key, init = {}) => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

/** Types a line, presses Enter and waits for the command to finish. @param {HTMLInputElement} input @param {string} line */
async function submit(input, line) {
  input.value = line
  key(input, 'Enter')
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(input.closest('.cli')?.hasAttribute('aria-busy')).toBe(false)
}

/** @param {HTMLElement} log */
const lines = (log) => [...log.querySelectorAll('.cli__line')].map((l) => [/** @type {HTMLElement} */ (l).dataset.kind, l.textContent])

describe('the log', () => {
  it('starts with a hint', () => {
    const { log } = setup()
    expect(lines(log)).toEqual([['out', "type 'help' for the commands"]])
  })

  it('echoes a command and prints its output', async () => {
    const { input, log, run } = setup()
    await submit(input, 'run')
    expect(run).toHaveBeenCalledOnce()
    expect(lines(log).slice(1)).toEqual([
      ['echo', 'run'],
      ['out', 'running'],
    ])
    expect(input.value).toBe('')
  })

  it('shows errors as errors', async () => {
    const { input, log } = setup()
    await submit(input, 'frobnicate')
    expect(lines(log).at(-1)).toEqual(['error', 'unknown command: frobnicate (try help)'])
  })

  it('shows a bad usage as an error', async () => {
    const { input, log } = setup()
    await submit(input, 'run now')
    expect(lines(log).at(-1)).toEqual(['error', 'usage: run'])
  })

  it('prints nothing more for a blank line', async () => {
    const { input, log } = setup()
    await submit(input, '   ')
    expect(lines(log)).toHaveLength(2)
  })

  it('keeps only the latest lines', async () => {
    const { input, log } = setup()
    for (let i = 0; i < 160; i++) await submit(input, 'run')
    expect(log.childElementCount).toBe(300)
  })

  it('clears with Ctrl+L', () => {
    const { input, log } = setup()
    key(input, 'l', { ctrlKey: true })
    expect(log.childElementCount).toBe(0)
  })

  it('ignores Enter while a command is running', async () => {
    const { input, actions } = setup()
    /** @type {() => void} */
    let release = () => {}
    actions.save.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve('saved'))))
    input.value = 'save'
    key(input, 'Enter')
    input.value = 'run'
    key(input, 'Enter')
    expect(input.value).toBe('run')
    release()
    await vi.waitFor(() => expect(input.closest('.cli')?.hasAttribute('aria-busy')).toBe(false))
  })
})

describe('the commands', () => {
  it('saves, optionally under a name', async () => {
    const { input, log, actions } = setup()
    await submit(input, 'save')
    await submit(input, 'save game.p8')
    expect(actions.save).toHaveBeenNthCalledWith(1, undefined)
    expect(actions.save).toHaveBeenNthCalledWith(2, 'game.p8')
    expect(lines(log).at(-1)).toEqual(['out', 'saved game.p8'])
  })

  it('opens, exports and starts a new cart', async () => {
    const { input, actions } = setup()
    await submit(input, 'load')
    await submit(input, 'export p8 out')
    await submit(input, 'export')
    await submit(input, 'new')
    expect(actions.open).toHaveBeenCalledOnce()
    expect(actions.exportCart).toHaveBeenNthCalledWith(1, 'p8', 'out')
    expect(actions.exportCart).toHaveBeenNthCalledWith(2, 'png', undefined)
    expect(actions.newCart).toHaveBeenCalledOnce()
  })

  it('lists the commands', async () => {
    const { input, log } = setup()
    await submit(input, 'help')
    expect(lines(log).filter(([kind]) => kind === 'out').length).toBeGreaterThan(5)
  })

  it('reports the size of the code', async () => {
    const { project, input, log } = setup()
    project.setCode('x = 1')
    await submit(input, 'stats')
    const out = lines(log).slice(-3).map(([, text]) => text)
    expect(out[0]).toMatch(/^tokens\s+3 \/ 8192$/)
    expect(out[1]).toMatch(/^characters\s+5 \/ 65535$/)
    expect(out[2]).toMatch(/^compressed\s+\d+ \/ 15616$/)
  })
})

describe('the history', () => {
  it('recalls earlier commands with Up and Down and keeps the draft', async () => {
    const { input } = setup()
    await submit(input, 'help')
    await submit(input, 'stats')
    input.value = 'dra'
    key(input, 'ArrowUp')
    expect(input.value).toBe('stats')
    key(input, 'ArrowUp')
    expect(input.value).toBe('help')
    key(input, 'ArrowUp')
    expect(input.value).toBe('help')
    key(input, 'ArrowDown')
    expect(input.value).toBe('stats')
    key(input, 'ArrowDown')
    expect(input.value).toBe('dra')
  })

  it('does not repeat a command that was just run', async () => {
    const { input } = setup()
    await submit(input, 'help')
    await submit(input, 'help')
    key(input, 'ArrowUp')
    key(input, 'ArrowUp')
    expect(input.value).toBe('help')
  })
})

describe('the view', () => {
  it('focuses the prompt when shown', () => {
    const { input } = setup()
    drawer?.activate?.()
    expect(document.activeElement).toBe(input)
  })
})

describe('createCliContext', () => {
  it('maps the commands onto the file actions', async () => {
    const project = Project.empty(pico8Profile)
    const actions = { open: vi.fn(async () => 'o'), save: vi.fn(async () => 's'), exportCart: vi.fn(async () => 'e'), newCart: vi.fn(async () => 'n') }
    const run = vi.fn(() => 'r')
    const ctx = createCliContext({ project, setStatus: vi.fn(), setInfo: vi.fn(), requestRun: vi.fn(), actions: /** @type {any} */ (actions), run })
    expect(await ctx.load()).toBe('o')
    expect(await ctx.save('x')).toBe('s')
    expect(await ctx.exportCart('png')).toBe('e')
    expect(await ctx.newCart()).toBe('n')
    expect(ctx.run()).toBe('r')
  })
})
