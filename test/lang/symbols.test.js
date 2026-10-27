import { describe, expect, it } from 'vitest'
import { lookup, scanSymbols, visibleAt } from '../../src/lang/symbols.js'
import { analyze } from '../../src/ui/editors/code/code-model.js'

/** @param {import('../../src/lang/symbols.js').Symbols} symbols @param {string} name */
function decl(symbols, name) {
  const found = symbols.decls.find((d) => d.name === name)
  if (!found) throw new Error(`no declaration of ${name}`)
  return found
}

/**
 * Scans code; `|` marks an offset of interest (removed from the code).
 * @param {string} code
 */
function scan(code) {
  const at = code.indexOf('|')
  const p8 = at < 0 ? code : code.replace('|', '')
  const symbols = scanSymbols(analyze(p8))
  return { symbols, at, names: (offset = at) => visibleAt(symbols, offset).map((d) => d.name) }
}

describe('scanSymbols', () => {
  it('finds locals, functions, globals and params', () => {
    const { symbols } = scan('local a = 1\nfunction f(x, y) end\nb = 2\nlocal function g() end')
    expect(symbols.decls.map((d) => [d.name, d.kind])).toEqual([
      ['a', 'local'], ['f', 'function'], ['x', 'param'], ['y', 'param'], ['b', 'global'], ['g', 'local'],
    ])
    expect(decl(symbols, 'f').params).toEqual([{ name: 'x' }, { name: 'y' }])
  })

  it('shows params only inside the function', () => {
    const inside = scan('function f(dx) |end')
    expect(inside.names()).toContain('dx')
    const outside = scan('function f(dx) end |')
    expect(outside.names()).not.toContain('dx')
    expect(outside.names()).toContain('f')
  })

  it('scopes a for variable to the loop body', () => {
    expect(scan('for i = 1, 3 do |end').names()).toContain('i')
    expect(scan('for i = 1, 3 do end |').names()).not.toContain('i')
    expect(scan('for k, v in pairs(t) do |end').names()).toEqual(expect.arrayContaining(['k', 'v']))
    expect(scan('for i = 1, |3 do end').names()).not.toContain('i')
  })

  it('ends a local at the end of its block', () => {
    expect(scan('if c then local z = 1 end |').names()).not.toContain('z')
    expect(scan('if c then local z = 1 |end').names()).toContain('z')
  })

  it('lets `local x = x` see the outer x', () => {
    const { symbols, at } = scan('local x = 1\nlocal x = x|\nprint(x)')
    const inner = symbols.decls.filter((d) => d.name === 'x')[1]
    expect(inner.scopeStart).toBeGreaterThan(at - 1)
    // inside the right hand side the first x is the one in scope
    const rhs = symbols.decls[1].pos + 4
    expect(lookup(symbols, 'x', rhs)).toBe(symbols.decls[0])
  })

  it('prefers the innermost shadowing declaration', () => {
    const { symbols, at } = scan('local a = 1\nfunction f()\n  local a = 2\n  |\nend')
    expect(lookup(symbols, 'a', at)?.pos).toBeGreaterThan(symbols.decls[0].pos)
    expect(visibleAt(symbols, at).filter((d) => d.name === 'a')).toHaveLength(1)
  })

  it('treats elseif/else as part of the same block', () => {
    const { names } = scan('if a then local p = 1 elseif b then local q = 2 else local r = 3 end local after = 1|')
    expect(names()).toContain('after')
    expect(names()).not.toContain('q')
  })

  it('opens no block for the shorthand if', () => {
    const { names } = scan('if (c) x = 1\nlocal y = 2\n|')
    expect(names()).toContain('y')
    expect(scan('if (c) local w = 1\nfunction f() end\n|').names()).toContain('f')
  })

  it('does not count a nested function end as the end of an enclosing local', () => {
    const { names } = scan('local f = function() return 1 end\nlocal g = 2\n|')
    expect(names()).toEqual(expect.arrayContaining(['f', 'g']))
  })

  it('records methods and fields', () => {
    const { symbols } = scan('p = {x = 1, y = 2, move = function(self, dx) end}\nfunction p:draw() end\nfunction p.new(a) end\np.z = 3')
    /** @type {Record<string, import('../../src/lang/symbols.js').Field>} */
    const byName = Object.fromEntries(symbols.fields.map((f) => [f.name, f]))
    expect(Object.keys(byName).sort()).toEqual(['draw', 'move', 'new', 'x', 'y', 'z'])
    expect(byName.draw.method).toBe(true)
    expect(byName.draw.owner).toBe('p')
    expect(byName.new.params).toEqual([{ name: 'a' }])
    expect(byName.move.params).toEqual([{ name: 'self' }, { name: 'dx' }])
  })

  it('declares self in a method', () => {
    expect(scan('function p:draw() |end').names()).toContain('self')
    expect(scan('function p.draw() |end').names()).not.toContain('self')
  })

  it('takes the comment block above a function as its doc', () => {
    const { symbols } = scan('local k = 1\n-- moves it\n-- by dx\nfunction move(dx) end\n\n-- not this\n\nfunction other() end')
    expect(decl(symbols, 'move').doc).toBe('moves it\nby dx')
    expect(decl(symbols, 'other').doc).toBeUndefined()
  })

  it('records a function stored in a variable with its params', () => {
    const { symbols } = scan('-- adds\nlocal add2 = function(a, b) end')
    const d = decl(symbols, 'add2')
    expect(d.params).toEqual([{ name: 'a' }, { name: 'b' }])
    expect(d.doc).toBe('adds')
  })

  it('does not declare a global for an assignment to a local', () => {
    const { symbols } = scan('local a = 1\na = 2')
    expect(symbols.decls.filter((d) => d.name === 'a')).toHaveLength(1)
  })
})

describe('scanSymbols on broken code', () => {
  for (const [label, code] of [
    ['an unclosed function', 'function f(a)\n  local b = 1\n  '],
    ['a trailing local', 'local x ='],
    ['a trailing local with names', 'local a, b'],
    ['a dot at the end', 'p = {x=1}\np.'],
    ['extra ends', 'end end end local z = 1'],
    ['a for without do', 'for i = 1, 3\nprint(i)'],
    ['a half function name', 'function a.'],
    ['an empty program', ''],
    ['an unfinished string', 'local s = "abc\nlocal t = 1'],
    ['only keywords', 'function function local local for for'],
  ]) {
    it(`does not throw on ${label}`, () => {
      expect(() => scanSymbols(analyze(code))).not.toThrow()
    })
  }

  it('still sees the locals of an unclosed function', () => {
    const { names } = scan('function f(a)\n  local b = 1\n  |')
    expect(names()).toEqual(expect.arrayContaining(['a', 'b', 'f']))
  })

  it('has fewer scopes than blocks when unbalanced', () => {
    expect(scan('function f() if a then').symbols.scopes.length).toBe(2)
    expect(scan('end end').symbols.scopes.length).toBe(0)
  })
})
