import { describe, expect, it, vi } from 'vitest'
import {
  ACTIONS,
  bindingOf,
  createBindings,
  describeActions,
  formatBinding,
  shortcutFor,
  validateBinding,
} from '../../src/ui/shortcuts.js'

/** @param {Partial<Parameters<typeof shortcutFor>[0]>} e */
const ev = (e) => ({ key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...e })
/** @param {Partial<Parameters<typeof shortcutFor>[0]>} e */
const press = (e) => shortcutFor(ev(e))

describe('shortcutFor', () => {
  it('maps file shortcuts for ctrl and cmd', () => {
    expect(press({ key: 's', ctrlKey: true })).toBe('save')
    expect(press({ key: 's', metaKey: true })).toBe('save')
    expect(press({ key: 'S', ctrlKey: true, shiftKey: true })).toBe('saveAs')
    expect(press({ key: 'o', ctrlKey: true })).toBe('open')
    expect(press({ key: 'e', metaKey: true })).toBe('export')
  })

  it('runs and stops', () => {
    expect(press({ key: 'F5' })).toBe('run')
    expect(press({ key: 'F5', shiftKey: true })).toBe('stop')
    expect(press({ key: 'Enter', ctrlKey: true })).toBe('run')
  })

  it('toggles the command line', () => {
    expect(press({ key: '`', ctrlKey: true })).toBe('toggleCli')
  })

  it('switches tabs with alt+digit', () => {
    expect(press({ key: '¡', code: 'Digit1', altKey: true })).toBe('tab:0')
    expect(press({ key: '5', code: 'Digit5', altKey: true })).toBe('tab:4')
    expect(press({ key: '0', code: 'Digit0', altKey: true })).toBeNull()
    expect(press({ key: '1', code: 'Digit1', altKey: true, shiftKey: true })).toBeNull()
  })

  it('ignores plain keys and alt-modified ctrl combos', () => {
    expect(press({ key: 's' })).toBeNull()
    expect(press({ key: 's', ctrlKey: true, altKey: true })).toBeNull()
    expect(press({ key: 'x', ctrlKey: true })).toBeNull()
  })
})

describe('bindingOf', () => {
  it('writes modifiers in a fixed order, with Ctrl and Cmd both as Mod', () => {
    expect(bindingOf(ev({ key: 's', ctrlKey: true }))).toBe('Mod+s')
    expect(bindingOf(ev({ key: 'S', metaKey: true, shiftKey: true }))).toBe('Mod+Shift+s')
    expect(bindingOf(ev({ key: 'F5', shiftKey: true }))).toBe('Shift+F5')
    expect(bindingOf(ev({ key: ' ', ctrlKey: true }))).toBe('Mod+Space')
  })

  it('goes by the physical key when alt changes the character', () => {
    expect(bindingOf(ev({ key: '¡', code: 'Digit1', altKey: true }))).toBe('Alt+1')
    expect(bindingOf(ev({ key: 'å', code: 'KeyA', altKey: true }))).toBe('Alt+a')
  })

  it('leaves Shift out of a character, which already shows it', () => {
    expect(bindingOf(ev({ key: 'P', shiftKey: true }))).toBe('p')
    expect(bindingOf(ev({ key: '+', shiftKey: true }))).toBe('+')
    expect(bindingOf(ev({ key: 'Enter', shiftKey: true }))).toBe('Shift+Enter')
    expect(bindingOf(ev({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe('Mod+Shift+z')
    expect(bindingOf(ev({ key: 'a', code: 'KeyA', altKey: true, shiftKey: true }))).toBe('Alt+Shift+a')
  })

  it('has nothing for a bare modifier', () => {
    for (const key of ['Control', 'Shift', 'Alt', 'Meta']) expect(bindingOf(ev({ key }))).toBeNull()
  })
})

describe('validateBinding', () => {
  it('accepts the defaults', () => {
    for (const spec of ACTIONS) for (const binding of spec.defaults) expect(validateBinding(binding, spec.scope)).toBeNull()
  })

  it('accepts a plus as the key', () => {
    expect(validateBinding('Mod++')).toBeNull()
  })

  it('refuses plain keys, which would stop typing', () => {
    expect(validateBinding('s')).toMatch(/Ctrl\/Cmd or Alt/)
    expect(validateBinding('Escape')).toMatch(/Ctrl\/Cmd or Alt/)
  })

  it('refuses the editing keys', () => {
    for (const key of ['a', 'c', 'v', 'x', 'y', 'z']) expect(validateBinding(`Mod+${key}`)).toBe('reserved for editing')
    expect(validateBinding('Mod+Shift+z')).toBe('reserved for editing')
    expect(validateBinding('Mod+Alt+c')).toBeNull()
  })

  it('asks for Ctrl/Cmd, Alt or a function key in the code editor, where letters are typed', () => {
    expect(validateBinding('p', 'code')).toMatch(/Ctrl\/Cmd or Alt/)
    expect(validateBinding('Shift+ArrowUp', 'code')).toMatch(/Ctrl\/Cmd or Alt/)
    expect(validateBinding('Mod+c', 'code')).toBe('reserved for editing')
    expect(validateBinding('Mod+z', 'code')).toBeNull()
    expect(validateBinding('Alt+ArrowUp', 'code')).toBeNull()
    expect(validateBinding('Shift+F3', 'code')).toBeNull()
  })

  it('refuses what is not written the canonical way', () => {
    expect(validateBinding('')).not.toBeNull()
    expect(validateBinding('Mod+S')).not.toBeNull()
    expect(validateBinding('Shift+Mod+s')).not.toBeNull()
    expect(validateBinding('Mod+Shift')).not.toBeNull()
    expect(validateBinding('Shift+a')).not.toBeNull() // Shift is in the character
  })
})

describe('formatBinding', () => {
  it('spells the keys out for Windows and Linux', () => {
    expect(formatBinding('Mod+Shift+s', false)).toBe('Ctrl+Shift+S')
    expect(formatBinding('Alt+1', false)).toBe('Alt+1')
    expect(formatBinding('F5', false)).toBe('F5')
    expect(formatBinding('Mod+Enter', false)).toBe('Ctrl+Enter')
    expect(formatBinding('Mod++', false)).toBe('Ctrl++')
  })

  it('uses the Mac symbols', () => {
    expect(formatBinding('Mod+Shift+s', true)).toBe('⇧⌘S')
    expect(formatBinding('Alt+1', true)).toBe('⌥1')
  })
})

describe('describeActions', () => {
  it('names the tab shortcuts after the tabs and drops the rest', () => {
    const actions = describeActions([{ label: 'Code' }, { label: 'Sprites' }])
    expect(actions.filter((a) => a.group === 'Tabs').map((a) => [a.id, a.label])).toEqual([
      ['tab:0', 'Go to Code'],
      ['tab:1', 'Go to Sprites'],
    ])
    expect(actions.some((a) => a.id === 'run')).toBe(true)
  })
})

describe('shortcutFor with custom bindings', () => {
  it('replaces the defaults of an action only', () => {
    const custom = { run: ['Mod+r'] }
    expect(shortcutFor(ev({ key: 'r', ctrlKey: true }), custom)).toBe('run')
    expect(shortcutFor(ev({ key: 'F5' }), custom)).toBeNull()
    expect(shortcutFor(ev({ key: 's', ctrlKey: true }), custom)).toBe('save')
  })

  it('can leave an action unbound', () => {
    expect(shortcutFor(ev({ key: 'F5' }), { run: [] })).toBeNull()
  })
})

/** @returns {Storage} */
function memoryStorage(initial = {}) {
  /** @type {Record<string, string>} */
  const data = { ...initial }
  return /** @type {any} */ ({
    getItem: (/** @type {string} */ k) => data[k] ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => void (data[k] = v),
    removeItem: (/** @type {string} */ k) => void delete data[k],
  })
}

describe('createBindings', () => {
  it('starts with the defaults', () => {
    const bindings = createBindings(memoryStorage())
    expect(bindings.get('run')).toEqual(['F5', 'Mod+Enter'])
    expect(bindings.isCustom('run')).toBe(false)
    expect(bindings.anyCustom()).toBe(false)
    expect(bindings.match(ev({ key: 'F5' }))).toBe('run')
  })

  it('replaces all the keys of an action with the one given', () => {
    const bindings = createBindings(memoryStorage())
    expect(bindings.assign('run', 'F6')).toBeNull()
    expect(bindings.get('run')).toEqual(['F6'])
    expect(bindings.match(ev({ key: 'Enter', ctrlKey: true }))).toBeNull()
    expect(bindings.match(ev({ key: 'F6' }))).toBe('run')
    expect(bindings.match(ev({ key: 'F5' }))).toBeNull()
    expect(bindings.isCustom('run')).toBe(true)
  })

  it('refuses a binding another action uses, and says which', () => {
    const bindings = createBindings(memoryStorage())
    expect(bindings.assign('stop', 'Mod+s')).toEqual({ error: 'taken', by: 'save' })
    expect(bindings.get('stop')).toEqual(['Shift+F5'])
  })

  it('lets an action keep one of its own keys, and drops the rest', () => {
    const bindings = createBindings(memoryStorage())
    expect(bindings.assign('run', 'Mod+Enter')).toBeNull()
    expect(bindings.get('run')).toEqual(['Mod+Enter'])
  })

  it('refuses an invalid binding', () => {
    const bindings = createBindings(memoryStorage())
    expect(bindings.assign('stop', 'x')).toMatchObject({ error: 'invalid' })
    expect(bindings.assign('stop', 'Mod+c')).toEqual({ error: 'invalid', message: 'reserved for editing' })
    expect(bindings.anyCustom()).toBe(false)
  })

  it('does nothing when the binding is the one already there', () => {
    const bindings = createBindings(memoryStorage())
    const changed = vi.fn()
    bindings.on(changed)
    expect(bindings.assign('save', 'Mod+s')).toBeNull()
    expect(changed).not.toHaveBeenCalled()
  })

  it('leaves an action unassigned', () => {
    const bindings = createBindings(memoryStorage())
    bindings.unbind('stop')
    expect(bindings.get('stop')).toEqual([])
    expect(bindings.match(ev({ key: 'F5', shiftKey: true }))).toBeNull()
    const changed = vi.fn()
    bindings.on(changed)
    bindings.unbind('stop') // nothing left to take off
    expect(changed).not.toHaveBeenCalled()
  })

  it('frees a binding for another action once it is removed', () => {
    const bindings = createBindings(memoryStorage())
    bindings.unbind('save')
    expect(bindings.assign('stop', 'Mod+s')).toBeNull()
    expect(bindings.match(ev({ key: 's', ctrlKey: true }))).toBe('stop')
  })

  it('resets one action or all of them', () => {
    const bindings = createBindings(memoryStorage())
    bindings.assign('run', 'F6')
    bindings.assign('save', 'F2')
    bindings.reset('run')
    expect(bindings.get('run')).toEqual(['F5', 'Mod+Enter'])
    expect(bindings.isCustom('save')).toBe(true)
    bindings.resetAll()
    expect(bindings.anyCustom()).toBe(false)
    expect(bindings.get('save')).toEqual(['Mod+s'])
  })

  it('is no longer custom once the defaults are typed back in', () => {
    const bindings = createBindings(memoryStorage())
    bindings.assign('save', 'F2')
    bindings.assign('save', 'Mod+s')
    expect(bindings.isCustom('save')).toBe(false)
  })

  it('tells listeners about a change until they stop', () => {
    const bindings = createBindings(memoryStorage())
    const changed = vi.fn()
    const off = bindings.on(changed)
    bindings.assign('save', 'F2')
    bindings.reset('save')
    bindings.assign('save', 'F2')
    bindings.resetAll()
    expect(changed).toHaveBeenCalledTimes(4)
    off()
    bindings.assign('save', 'F2')
    expect(changed).toHaveBeenCalledTimes(4)
  })

  it('remembers the changes, and only those', () => {
    const storage = memoryStorage()
    createBindings(storage).assign('run', 'F6')
    expect(JSON.parse(storage.getItem('p8n.shortcuts') ?? '')).toEqual({ run: ['F6'] })
    expect(createBindings(storage).get('run')).toEqual(['F6'])
    const again = createBindings(storage)
    again.resetAll()
    expect(storage.getItem('p8n.shortcuts')).toBeNull()
  })

  it('ignores unreadable or invalid saved bindings', () => {
    expect(createBindings(memoryStorage({ 'p8n.shortcuts': 'not json' })).get('run')).toEqual(['F5', 'Mod+Enter'])
    const saved = JSON.stringify({ run: ['x', 'F6', 'F6', 7], save: 'Mod+s', nope: ['F7'], stop: [] })
    const bindings = createBindings(memoryStorage({ 'p8n.shortcuts': saved }))
    expect(bindings.get('run')).toEqual(['F6'])
    expect(bindings.get('save')).toEqual(['Mod+s'])
    expect(bindings.get('stop')).toEqual([])
  })

  it('works when the storage throws', () => {
    const broken = /** @type {Storage} */ (
      /** @type {any} */ ({
        getItem() {
          throw new Error('blocked')
        },
        setItem() {
          throw new Error('blocked')
        },
        removeItem() {
          throw new Error('blocked')
        },
      })
    )
    const bindings = createBindings(broken)
    expect(() => bindings.assign('run', 'F6')).not.toThrow()
    expect(bindings.get('run')[0]).toBe('F6')
  })
})

describe('scopes', () => {
  /** @param {import('../../src/ui/shortcuts.js').Scope} scope @param {Partial<Parameters<typeof shortcutFor>[0]>} e */
  const inScope = (scope, e) => shortcutFor(ev(e), {}, scope)

  it('keeps the editors\' keys out of the app and the other way round', () => {
    expect(inScope('app', { key: 'p' })).toBeNull()
    expect(inScope('sprite', { key: 'p' })).toBe('sprite:tool:pen')
    expect(inScope('map', { key: 'p' })).toBe('map:tool:pen')
    expect(inScope('sprite', { key: 'F5' })).toBeNull()
    expect(inScope('map', { key: 'h' })).toBe('map:tool:pan')
    expect(inScope('sprite', { key: 'h' })).toBe('sprite:flipH')
  })

  it('finds the editors\' keys with Shift or Caps Lock on', () => {
    expect(inScope('sprite', { key: 'H', shiftKey: true })).toBe('sprite:flipH')
    expect(inScope('map', { key: '+', shiftKey: true })).toBe('map:zoomIn')
    expect(inScope('map', { key: '=' })).toBe('map:zoomIn')
    expect(inScope('sprite', { key: 'z', ctrlKey: true, shiftKey: true })).toBe('redo')
    expect(inScope('map', { key: ' ' })).toBe('map:panHold')
  })

  it('has no default key that clashes with another action\'s', () => {
    const bindings = createBindings(null)
    for (const spec of ACTIONS) {
      for (const binding of spec.defaults) expect(bindings.find(binding, spec.scope), `${spec.id} ${binding}`).toBe(spec.id)
    }
  })

  it('keeps the code editor\'s keys to itself, but shares undo and redo with it', () => {
    expect(inScope('code', { key: 'F12' })).toBe('code:definition')
    expect(inScope('app', { key: 'F12' })).toBeNull()
    expect(inScope('sprite', { key: 'F12' })).toBeNull()
    expect(inScope('code', { key: 'z', ctrlKey: true })).toBe('undo')
    const bindings = createBindings(null)
    expect(bindings.assign('code:find', 'Mod+s')).toEqual({ error: 'taken', by: 'save' })
    expect(bindings.assign('code:find', 'Mod+z')).toEqual({ error: 'taken', by: 'undo' })
    expect(bindings.assign('code:find', 'p')).toMatchObject({ error: 'invalid' })
    expect(bindings.assign('sprite:tool:pen', 'F12')).toBeNull() // another editor's keys don't clash
  })

  it('has one undo and one redo for every editor', () => {
    expect(ACTIONS.filter((a) => /undo|redo/i.test(a.id)).map((a) => [a.id, a.scope])).toEqual([
      ['undo', 'editor'],
      ['redo', 'editor'],
    ])
    for (const scope of /** @type {const} */ (['sprite', 'map', 'editor'])) {
      expect(inScope(scope, { key: 'z', ctrlKey: true })).toBe('undo')
      expect(inScope(scope, { key: 'y', ctrlKey: true })).toBe('redo')
    }
    expect(inScope('app', { key: 'z', ctrlKey: true })).toBeNull()
  })

  it('moves undo and redo for all the editors at once', () => {
    const bindings = createBindings(null)
    expect(bindings.assign('undo', 'Mod+u')).toBeNull()
    for (const scope of /** @type {const} */ (['sprite', 'map', 'editor'])) {
      expect(bindings.match(ev({ key: 'u', ctrlKey: true }), scope)).toBe('undo')
      expect(bindings.match(ev({ key: 'z', ctrlKey: true }), scope)).toBeNull()
    }
  })

  it('refuses a key an editor has to undo and redo, whichever editor it is for', () => {
    const bindings = createBindings(null)
    expect(bindings.assign('sprite:flipH', 'Mod+z')).toEqual({ error: 'taken', by: 'undo' })
    expect(bindings.assign('map:tool:pen', 'Mod+y')).toEqual({ error: 'taken', by: 'redo' })
    expect(bindings.assign('undo', 'h')).toEqual({ error: 'taken', by: 'sprite:flipH' })
    expect(bindings.assign('undo', 'F5')).toEqual({ error: 'taken', by: 'run' })
  })

  it('has the same tools as the editors', async () => {
    const { TOOLS } = await import('../../src/ui/editors/sprite/sprite-ops.js')
    const { MAP_TOOLS } = await import('../../src/ui/editors/map/map-ops.js')
    const toolsOf = (/** @type {string} */ scope) => ACTIONS.filter((a) => a.id.startsWith(`${scope}:tool:`)).map((a) => a.id.slice(scope.length + 6))
    expect(toolsOf('sprite')).toEqual([...TOOLS])
    expect(toolsOf('map')).toEqual([...MAP_TOOLS])
  })

  it('lets the editors use plain keys, but not the ones that move around', () => {
    expect(validateBinding('p', 'sprite')).toBeNull()
    expect(validateBinding('Space', 'map')).toBeNull()
    expect(validateBinding('p', 'app')).not.toBeNull()
    expect(validateBinding('ArrowLeft', 'sprite')).toMatch(/move around/)
    expect(validateBinding('Tab', 'map')).toMatch(/move around/)
    expect(validateBinding('Mod+ArrowLeft', 'sprite')).toBeNull()
    expect(validateBinding('P', 'sprite')).not.toBeNull()
  })

  it('refuses a key an action of the same scope or the app has, but not another editor\'s', () => {
    const bindings = createBindings(null)
    expect(bindings.assign('sprite:tool:pen', 'e')).toEqual({ error: 'taken', by: 'sprite:tool:eraser' })
    expect(bindings.assign('map:tool:pen', 'v')).toBeNull() // the sprite editor flips with v
    expect(bindings.assign('sprite:tool:pen', 'F5')).toEqual({ error: 'taken', by: 'run' })
    expect(bindings.assign('sprite:tool:pen', 'Alt+1')).toEqual({ error: 'taken', by: 'tab:0' })
    expect(bindings.assign('tab:0', 'Mod+q')).toBeNull()
    expect(bindings.assign('run', 'Mod+Shift+p')).toBeNull()
    expect(bindings.assign('run', 'p')).toEqual({ error: 'invalid', message: expect.any(String) })
  })

  it('matches by scope after a rebind, and forgets the old key', () => {
    const bindings = createBindings(null)
    expect(bindings.assign('sprite:tool:pen', 'x')).toBeNull()
    expect(bindings.match(ev({ key: 'x' }), 'sprite')).toBe('sprite:tool:pen')
    expect(bindings.match(ev({ key: 'p' }), 'sprite')).toBeNull()
    expect(bindings.match(ev({ key: 'p' }), 'map')).toBe('map:tool:pen')
    expect(bindings.isCustom('sprite:tool:pen')).toBe(true)
  })

  it('keeps nothing without storage, and validates saved editor keys by scope', () => {
    const storage = memoryStorage({ 'p8n.shortcuts': JSON.stringify({ 'sprite:tool:pen': ['x'], run: ['x'], 'map:tool:pen': ['ArrowUp'] }) })
    const bindings = createBindings(storage)
    expect(bindings.get('sprite:tool:pen')).toEqual(['x'])
    expect(bindings.get('run')).toEqual([]) // x is not valid in the app
    expect(bindings.get('map:tool:pen')).toEqual([])
    const bare = createBindings(null)
    bare.assign('sprite:tool:pen', 'x')
    expect(bare.get('sprite:tool:pen')).toEqual(['x'])
  })
})
