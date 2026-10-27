import { describe, expect, it, vi } from 'vitest'
import { createCart } from '../../src/core/cart.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { parse } from '../../src/lua/parser.js'
import { Project } from '../../src/ui/store.js'

describe('Project', () => {
  it('starts clean and exposes live regions', () => {
    const p = Project.empty(pico8Profile)
    expect(p.dirty).toBe(false)
    p.region('gfx')[3] = 7
    expect(p.cart.rom[3]).toBe(7)
    expect(p.region('map').length).toBe(0x1000)
    expect(() => p.region('nope')).toThrow()
  })

  it('starter holds the entry points and parses; empty holds nothing', () => {
    const p = Project.starter(pico8Profile)
    expect(p.cart.code).toBe(pico8Profile.cart.starterCode)
    expect(() => parse(p.cart.code)).not.toThrow()
    for (const name of ['_init', '_update', '_draw']) expect(p.cart.code).toContain(`function ${name}()`)
    expect(Project.empty(pico8Profile).cart.code).toBe('')
  })

  it('setCode emits once per change and marks dirty', () => {
    const p = Project.empty(pico8Profile)
    const code = vi.fn()
    const meta = vi.fn()
    p.on('code', code)
    p.on('meta', meta)
    p.setCode('x=1', 'editor')
    p.setCode('x=1', 'editor')
    expect(code).toHaveBeenCalledTimes(1)
    expect(code).toHaveBeenCalledWith({ source: 'editor' })
    expect(meta).toHaveBeenCalledTimes(1)
    expect(p.dirty).toBe(true)
  })

  it('notifyRom emits per region and a summary event', () => {
    const p = Project.empty(pico8Profile)
    const gfx = vi.fn()
    const map = vi.fn()
    const all = vi.fn()
    p.on('rom:gfx', gfx)
    p.on('rom:map', map)
    p.on('rom', all)
    p.notifyRom(['gfx'], 'sprite')
    expect(gfx).toHaveBeenCalledWith({ source: 'sprite' })
    expect(map).not.toHaveBeenCalled()
    expect(all).toHaveBeenCalledWith({ regions: ['gfx'], source: 'sprite' })
    expect(p.dirty).toBe(true)
  })

  it('load replaces the cart and resets dirty', () => {
    const p = Project.empty(pico8Profile)
    p.setCode('a')
    const load = vi.fn()
    p.on('load', load)
    const cart = createCart(pico8Profile)
    cart.code = 'b'
    p.load(cart, 'b.p8')
    expect(load).toHaveBeenCalled()
    expect(p.cart.code).toBe('b')
    expect(p.fileName).toBe('b.p8')
    expect(p.dirty).toBe(false)
  })

  it('unsubscribes', () => {
    const p = Project.empty(pico8Profile)
    const fn = vi.fn()
    const off = p.on('code', fn)
    off()
    p.setCode('z')
    expect(fn).not.toHaveBeenCalled()
  })
})
