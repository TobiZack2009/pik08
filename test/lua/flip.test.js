import { describe, expect, it, vi } from 'vitest'
import { compile } from '../../src/lua/compile.js'

/** A program whose `flip` is counted. @param {string} src */
function program(src) {
  const flip = vi.fn()
  return { flip, program: compile(src, { host: { flip } }) }
}

/** Runs a generator to the end, counting the pauses. @param {Generator<void, any, void>} gen */
function pauses(gen) {
  let n = 0
  for (;;) {
    const step = gen.next()
    if (step.done) return { n, value: step.value }
    n++
  }
}

describe('flip run plainly', () => {
  it('shows the frame and carries on', () => {
    const { flip, program: p } = program('n = 0 for i = 1, 3 do n += i flip() end return n')
    expect(p.run()).toBe(6)
    expect(flip).toHaveBeenCalledTimes(3)
  })

  it('works from a function called by native code', () => {
    const { flip, program: p } = program('local t = setmetatable({}, {__index = function() flip() return 9 end}) return t.x')
    expect(p.run()).toBe(9)
    expect(flip).toHaveBeenCalled()
  })

  it('is a function that does nothing without a host', () => {
    const p = compile('flip() return 5')
    expect(p.run()).toBe(5)
  })

  it('leaves programs without it as plain code', () => {
    const { program: p } = program('return 1')
    expect(p.js).not.toContain('function*')
  })

  it('does not make generators of carts that only have a variable called flip', () => {
    const { program: p } = program('flip = true return flip')
    expect(p.js).not.toContain('function*')
    expect(p.run()).toBe(true)
  })

  it('leaves a function of the cart called flip alone', () => {
    const { flip, program: p } = program('function flip() n = 7 end flip() return n')
    expect(p.run()).toBe(7)
    expect(flip).not.toHaveBeenCalled()
  })
})

describe('flip driven a frame at a time', () => {
  it('pauses at each flip without showing it', () => {
    const { flip, program: p } = program('n = 0 while n < 3 do n += 1 flip() end return n')
    expect(pauses(p.drive(p.main))).toEqual({ n: 3, value: 3 })
    expect(flip).not.toHaveBeenCalled()
  })

  it('pauses inside the functions it calls', () => {
    const { program: p } = program(`
      local function wait(k) for i = 1, k do flip() end end
      function main() wait(2) wait(1) return 'done' end
    `)
    p.run()
    expect(pauses(p.drive(/** @type {any} */ (p.G.get('main'))))).toEqual({ n: 3, value: 'done' })
  })

  it('runs a function that cannot pause to its end', () => {
    const { program: p } = program('function f(a) return a + 1 end flip()')
    p.run()
    expect(pauses(p.drive(/** @type {any} */ (p.G.get('f')), 4))).toEqual({ n: 0, value: 5 })
  })

  it('shows the frame at once inside a coroutine', () => {
    const { flip, program: p } = program(`
      local co = cocreate(function() flip() yield(1) flip() return 2 end)
      a = coresume(co)
      b = coresume(co)
    `)
    expect(pauses(p.drive(p.main)).n).toBe(0)
    expect(flip).toHaveBeenCalledTimes(2)
    expect(p.G.get('a')).toBe(true)
  })

  it('still lets coroutines yield', () => {
    const { program: p } = program(`
      local co = cocreate(function() yield(1) yield(2) end)
      local _, a = coresume(co)
      flip()
      local _, b = coresume(co)
      return a + b
    `)
    expect(pauses(p.drive(p.main))).toEqual({ n: 1, value: 3 })
  })

  it('reports errors with their line', () => {
    const { program: p } = program('flip()\nflip()\nlocal x = nil + 1')
    const gen = p.drive(p.main)
    gen.next()
    gen.next()
    expect(() => gen.next()).toThrowError(expect.objectContaining({ line: 3 }))
  })
})
