import { describe, expect, it } from 'vitest'
import { compile, mapError } from '../../src/lua/compile.js'
import { generate } from '../../src/lua/codegen.js'
import { LuaError, LuaSyntaxError } from '../../src/lua/errors.js'
import { FIXED, FLOAT } from '../../src/lua/numbers.js'
import { parse } from '../../src/lua/parser.js'
import { LuaTable } from '../../src/lua/table.js'

/** @param {() => any} f */
const thrown = (f) => {
  try {
    f()
  } catch (e) {
    return /** @type {any} */ (e)
  }
  throw new Error('expected an error')
}

describe('compile', () => {
  it('reports syntax errors with positions', () => {
    const e = thrown(() => compile('local x = 1\nlocal = 2'))
    expect(e).toBeInstanceOf(LuaSyntaxError)
    expect(e.line).toBe(2)
  })

  it('defaults to fixed-point numbers and accepts a model name or object', () => {
    expect(compile('return 32767 + 1').run()).toBe(-32768)
    expect(compile('return 32767 + 1', { model: 'float' }).run()).toBe(32768)
    expect(compile('return 32767 + 1', { model: FLOAT }).run()).toBe(32768)
    expect(compile('return 32767 + 1', { model: FIXED }).run()).toBe(-32768)
  })

  it('keeps programs independent of each other', () => {
    const a = compile('x = 1 return x')
    const b = compile('return x')
    a.run()
    expect(b.run()).toBeUndefined()
    expect(a.G).not.toBe(b.G)
  })

  it('lets the host read and call globals after running', () => {
    const p = compile('score = 0 function _update() score += 1 end')
    p.run()
    const update = p.G.get('_update')
    p.call(update)
    p.call(update)
    expect(p.G.get('score')).toBe(2)
  })

  it('can run the main chunk twice (globals persist)', () => {
    const p = compile('n = (n or 0) + 1 return n')
    expect(p.run()).toBe(1)
    expect(p.run()).toBe(2)
  })

  it('exposes host functions registered in the globals table', () => {
    const p = compile('return answer() + 1')
    p.G.set('answer', () => 41)
    expect(p.run()).toBe(42)
  })

  it('lets the host replace stdlib globals and compiled code sees it', () => {
    const p = compile('return rnd()')
    p.G.set('rnd', () => 7)
    expect(p.run()).toBe(7)
  })

  it('sees globals the host sets to a table', () => {
    const p = compile('return config.size + #config.names')
    p.G.set('config', new LuaTable([], Object.assign(Object.create(null), { size: 10, names: new LuaTable(['a', 'b']) })))
    expect(p.run()).toBe(12)
  })

  it('runs a hot loop quickly', () => {
    const p = compile('local s = 0 for i = 1, 3000000 do s += i % 7 end return s', { model: 'float' })
    const t0 = performance.now()
    expect(p.run()).toBe(8999997)
    expect(performance.now() - t0).toBeLessThan(5000)
  })
})

describe('line numbers', () => {
  it('maps the generated JS onto the same line numbers', () => {
    const src = 'local a = 1\n\n\nlocal b = 2\nlocal function f()\n  return a\nend\nreturn f()'
    const js = generate(parse(src), FIXED)
    const lines = js.split('\n')
    expect(lines.length).toBe(8)
    expect(lines[3]).toContain('b_')
    expect(lines[5]).toContain('return')
  })

  it('reports the line of a runtime error', () => {
    const e = thrown(() => compile('local x = 1\nlocal y = 2\nlocal z = nothing.field\n').run())
    expect(e).toBeInstanceOf(LuaError)
    expect(e.message).toBe("attempt to index a nil value (global 'nothing')")
    expect(e.line).toBe(3)
  })

  it('reports the line inside nested functions and loops', () => {
    const src = ['local function f(t)', '  for i = 1, 3 do', '    if i == 2 then', '      t.x.y = 1', '    end', '  end', 'end', '', 'f({})'].join('\n')
    expect(thrown(() => compile(src).run()).line).toBe(4)
  })

  it('reports the line of an error in a function called later by the host', () => {
    const p = compile('function _draw()\n  local a = 1\n  a()\nend')
    p.run()
    const e = thrown(() => p.call(p.G.get('_draw')))
    expect(e.line).toBe(3)
    expect(e.message).toBe("attempt to call a number value (local 'a')")
  })

  it('reports lines in multi-line expressions at the failing call', () => {
    const src = 'local t = {}\nlocal s = 1 +\n  2 +\n  t.x.y\n'
    expect(thrown(() => compile(src).run()).line).toBe(4)
  })

  it('reports the right line after multi-line table constructors', () => {
    const src = 'local t = {\n  1,\n  2,\n}\nlocal x = t.a.b'
    expect(thrown(() => compile(src).run()).line).toBe(5)
  })

  it('handles lines in code with goto, repeat and for loops', () => {
    const src = 'for i = 1, 2 do\n  repeat\n    if i == 2 then goto skip end\n    local x = nil + 1\n    ::skip::\n  until true\nend'
    expect(thrown(() => compile(src).run()).line).toBe(4)
  })

  it('turns a JS stack overflow into a Lua error with a line', () => {
    const e = thrown(() => compile('local function f()\n  return 1 + f()\nend\nf()').run())
    expect(e.message).toBe('stack overflow')
    expect(e.line).toBe(2)
  })

  it('uses the chunk name from the options', () => {
    const e = thrown(() => compile('\n\nlocal a = nil + 1', { name: 'other.lua' }).run())
    expect(e.line).toBe(3)
  })

  it('does not map errors of other programs', () => {
    expect(mapError(new Error('boom')).line).toBeUndefined()
    expect(mapError('not an error')).toBe('not an error')
  })

  it('keeps runtime error objects as errors', () => {
    const e = thrown(() => compile('assert(false, "custom message")').run())
    expect(e).toBeInstanceOf(LuaError)
    expect(e.message).toContain('custom message')
  })
})

describe('generated code', () => {
  /** @param {string} src */
  const js = (src) => generate(parse(src), FIXED)

  it('never puts a newline right after return', () => {
    const code = js('local function f(a)\n  return\n    a\nend\nreturn\n  f(\n1)')
    expect(code).not.toMatch(/return\s*\n/)
  })

  it('never contains raw control characters or markers', () => {
    const code = js('x = "a\\0b\\1\\255\\n"')
    // eslint-disable-next-line no-control-regex
    expect(code).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\uffff]/)
  })

  it('compiles very long programs without trouble', () => {
    const src = Array.from({ length: 2000 }, (_, i) => `local v${i % 150} = ${i} + 1`).join('\n') + '\nreturn v1'
    expect(compile(src).run()).toBe(1952)
  })

  it('compiles deeply nested expressions', () => {
    const src = 'return ' + '('.repeat(150) + '1' + ' + 1)'.repeat(150)
    expect(compile(src).run()).toBe(151)
  })

  it('compiles long concatenation and and/or chains', () => {
    expect(compile('return ' + Array.from({ length: 300 }, () => '"a"').join(' .. ')).run()).toBe('a'.repeat(300))
    expect(compile('return ' + Array.from({ length: 300 }, () => 'false').join(' or ') + ' or 7').run()).toBe(7)
  })
})
