import { describe, expect, it } from 'vitest'
import { shortcutFor } from '../../src/ui/shortcuts.js'

/** @param {Partial<Parameters<typeof shortcutFor>[0]>} e */
const press = (e) =>
  shortcutFor({ key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...e })

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
