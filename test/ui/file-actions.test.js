// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { createFileActions } from '../../src/ui/file-actions.js'
import { decodeCart } from '../../src/ui/files.js'
import { Project } from '../../src/ui/store.js'

const fixture = (/** @type {string} */ name) => new Uint8Array(readFileSync(join(import.meta.dirname, '../fixtures', name)))

/** @param {Partial<import('../../src/ui/file-actions.js').FileIO>} [overrides] */
function setup(overrides = {}) {
  const project = Project.empty(pico8Profile)
  /** @type {import('../../src/ui/file-actions.js').FileIO} */
  const io = {
    pickFile: vi.fn(async () => null),
    saveFile: vi.fn(async (_bytes, name) => ({ name })),
    confirm: vi.fn(async () => true),
    choose: vi.fn(async () => null),
    ...overrides,
  }
  return { project, io, actions: createFileActions(project, io) }
}

describe('open', () => {
  it('loads the picked cart and clears the dirty flag', async () => {
    const { project, actions } = setup({
      pickFile: vi.fn(async () => ({ bytes: fixture('picotool/test_cart.p8'), name: 'test_cart.p8' })),
    })
    expect(await actions.open()).toBe('opened test_cart.p8')
    expect(project.fileName).toBe('test_cart.p8')
    expect(project.cart.code.length).toBeGreaterThan(0)
    expect(project.dirty).toBe(false)
  })

  it('opens a .p8.png', async () => {
    const { project, actions } = setup({
      pickFile: vi.fn(async () => ({ bytes: fixture('picotool/test_cart.p8.png'), name: 'test_cart.p8.png' })),
    })
    await actions.open()
    expect(project.cart.code).toBe(decodeCart(fixture('picotool/test_cart.p8'), pico8Profile).code)
  })

  it('does nothing when the file dialog is cancelled', async () => {
    const { project, actions } = setup()
    project.setCode('keep me')
    expect(await actions.open()).toBe('cancelled')
    expect(project.cart.code).toBe('keep me')
  })

  it('asks before throwing away changes', async () => {
    const pick = vi.fn(async () => ({ bytes: fixture('picotool/test_cart.p8'), name: 'a.p8' }))
    const { project, io, actions } = setup({ pickFile: pick, confirm: vi.fn(async () => false) })
    project.setCode('unsaved')
    expect(await actions.open()).toBe('cancelled')
    expect(io.confirm).toHaveBeenCalled()
    expect(pick).not.toHaveBeenCalled()
    expect(project.cart.code).toBe('unsaved')
  })

  it('reports a file that is not a cart without touching the project', async () => {
    const choose = vi.fn(async () => 'ok')
    const { project, actions } = setup({
      pickFile: vi.fn(async () => ({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), name: 'bad.png' })),
      choose,
    })
    project.setCode('keep')
    expect(await actions.open()).toMatch(/could not open bad.png/)
    expect(choose).toHaveBeenCalled()
    expect(project.cart.code).toBe('keep')
  })
})

describe('save', () => {
  it('saves as .p8 and marks the project clean', async () => {
    const { project, io, actions } = setup()
    project.setCode('print(1)')
    expect(await actions.save()).toBe('saved untitled.p8')
    expect(project.dirty).toBe(false)
    const [bytes, name, format] = /** @type {any} */ (io.saveFile).mock.calls[0]
    expect(name).toBe('untitled.p8')
    expect(format).toBe('p8')
    expect(new TextDecoder().decode(bytes)).toContain('print(1)')
  })

  it('writes back to the same handle next time', async () => {
    const h = { name: 'game.p8' }
    const saveFile = vi.fn(async () => ({ name: 'game.p8', handle: h }))
    const { actions, io } = setup({ saveFile })
    await actions.save()
    await actions.save()
    expect(/** @type {any} */ (io.saveFile).mock.calls[1][3]).toBe(h)
  })

  it('uses a given name, adding .p8', async () => {
    const { actions, project, io } = setup()
    await actions.save('my game')
    expect(/** @type {any} */ (io.saveFile).mock.calls[0][1]).toBe('my game.p8')
    expect(project.fileName).toBe('my game.p8')
  })

  it('keeps the project dirty if the user cancels', async () => {
    const { project, actions } = setup({ saveFile: vi.fn(async () => null) })
    project.setCode('x')
    expect(await actions.save()).toBe('cancelled')
    expect(project.dirty).toBe(true)
  })
})

describe('export', () => {
  it('exports a .p8.png', async () => {
    const { project, io, actions } = setup()
    project.setCode('print(1)')
    expect(await actions.exportCart('png')).toBe('exported untitled.p8.png')
    const [bytes, name, format] = /** @type {any} */ (io.saveFile).mock.calls[0]
    expect(name).toBe('untitled.p8.png')
    expect(format).toBe('p8png')
    expect(decodeCart(bytes, pico8Profile).code).toBe('print(1)')
    expect(project.dirty).toBe(true) // exporting is not saving
  })

  it('blocks the png over a limit and offers .p8', async () => {
    const choose = vi.fn(async () => 'cancel')
    const { project, io, actions } = setup({ choose })
    project.setCode('x=1\n'.repeat(3000))
    expect(await actions.exportCart('png')).toMatch(/export blocked/)
    expect(io.saveFile).not.toHaveBeenCalled()
    const dialog = /** @type {any} */ (choose.mock.calls[0])[0]
    expect(dialog.title).toMatch(/too big/)
    expect(dialog.message).toContain('tokens')
  })

  it('saves as .p8 when the user takes the offer', async () => {
    const { project, io, actions } = setup({ choose: vi.fn(async () => 'p8') })
    project.setCode('x=1\n'.repeat(3000))
    expect(await actions.exportCart('png')).toBe('saved untitled.p8')
    expect(/** @type {any} */ (io.saveFile).mock.calls[0][2]).toBe('p8')
  })

  it('can export a .p8 copy without marking the project clean', async () => {
    const { project, actions } = setup()
    project.setCode('x')
    expect(await actions.exportCart('p8', 'copy')).toBe('exported copy.p8')
    expect(project.dirty).toBe(true)
  })
})

describe('new', () => {
  it('starts a cart with the starter code', async () => {
    const { project, actions } = setup()
    project.setCode('old')
    expect(await actions.newCart()).toBe('new cart')
    expect(project.cart.code).toBe(project.profile.cart.starterCode)
    expect(project.cart.code).toContain('function _draw()')
    expect(project.fileName).toBe('untitled.p8')
    expect(project.dirty).toBe(false)
  })

  it('asks first when there are changes', async () => {
    const { project, actions } = setup({ confirm: vi.fn(async () => false) })
    project.setCode('old')
    expect(await actions.newCart()).toBe('cancelled')
    expect(project.cart.code).toBe('old')
  })
})
