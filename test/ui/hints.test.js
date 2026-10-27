// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { keysSuffix, titleHints } from '../../src/ui/hints.js'
import { createBindings, formatBinding } from '../../src/ui/shortcuts.js'

describe('keysSuffix', () => {
  it('names the first key of the action', () => {
    expect(keysSuffix(createBindings(null), 'save')).toBe(` (${formatBinding('Mod+s')})`)
  })

  it('has nothing for an action without keys', () => {
    const bindings = createBindings(null)
    bindings.unbind('save')
    expect(keysSuffix(bindings, 'save')).toBe('')
  })
})

describe('titleHints', () => {
  it('titles an element at once and follows a rebinding', () => {
    const bindings = createBindings(null)
    const hints = titleHints(bindings)
    const el = hints.hint(document.createElement('div'), 'Fill', 'sprite:tool:fill')
    expect(el.title).toBe('Fill (F)')
    bindings.assign('sprite:tool:fill', 'g')
    expect(el.title).toBe('Fill (G)')
    bindings.unbind('sprite:tool:fill')
    expect(el.title).toBe('Fill')
  })

  it('stops following once destroyed', () => {
    const bindings = createBindings(null)
    const hints = titleHints(bindings)
    const el = hints.hint(document.createElement('div'), 'Fill', 'sprite:tool:fill')
    hints.destroy()
    bindings.assign('sprite:tool:fill', 'g')
    expect(el.title).toBe('Fill (F)')
  })
})
