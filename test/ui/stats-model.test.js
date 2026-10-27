import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { Project } from '../../src/ui/store.js'
import { watchStats } from '../../src/ui/stats-model.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('watchStats', () => {
  it('reports counts at once and the compressed size after a pause', () => {
    const project = Project.empty(pico8Profile)
    const compress = vi.fn((/** @type {string} */ code) => code.length + 100)
    const onChange = vi.fn()
    const stats = watchStats(project, onChange, { delay: 50, compress })

    project.setCode('print(1)')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.lastCall?.[0].compressed).toBeUndefined()
    expect(onChange.mock.lastCall?.[0].chars).toBe(8)

    vi.advanceTimersByTime(50)
    expect(compress).toHaveBeenCalledWith('print(1)')
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange.mock.lastCall?.[0].compressed).toBe(108)
    expect(stats.get().compressed).toBe(108)
    stats.dispose()
  })

  it('debounces the compressed size while typing', () => {
    const project = Project.empty(pico8Profile)
    const compress = vi.fn(() => 1)
    const stats = watchStats(project, () => {}, { delay: 100, compress })
    vi.advanceTimersByTime(100)
    compress.mockClear()
    project.setCode('a')
    vi.advanceTimersByTime(60)
    project.setCode('ab')
    vi.advanceTimersByTime(60)
    expect(compress).not.toHaveBeenCalled()
    vi.advanceTimersByTime(40)
    expect(compress).toHaveBeenCalledTimes(1)
    stats.dispose()
  })

  it('updates when a cart is loaded', () => {
    const project = Project.empty(pico8Profile)
    const onChange = vi.fn()
    const stats = watchStats(project, onChange, { delay: 10, compress: () => 0 })
    const other = Project.empty(pico8Profile)
    other.setCode('x=1')
    project.load(other.cart, 'other.p8')
    expect(onChange.mock.lastCall?.[0].chars).toBe(3)
    stats.dispose()
  })

  it('stops after dispose', () => {
    const project = Project.empty(pico8Profile)
    const onChange = vi.fn()
    const compress = vi.fn(() => 0)
    const stats = watchStats(project, onChange, { delay: 10, compress })
    stats.dispose()
    onChange.mockClear()
    compress.mockClear()
    project.setCode('zzz')
    vi.advanceTimersByTime(100)
    expect(onChange).not.toHaveBeenCalled()
    expect(compress).not.toHaveBeenCalled()
  })
})
