import { describe, expect, it } from 'vitest'
import { callAt, contextAt } from '../../src/lang/context.js'
import { completions, definition, hover, outline, signature, symbolsOf } from '../../src/lang/service.js'
import { analyze } from '../../src/ui/editors/code/code-model.js'

/**
 * Analyzes code; `|` marks the cursor and is removed from the code.
 * @param {string} code
 */
function at(code) {
  const offset = code.indexOf('|')
  const analysis = analyze(offset < 0 ? code : code.replace('|', ''))
  return { analysis, offset }
}

/**
 * `at` as the arguments of a service function.
 * @param {string} code
 * @returns {[ReturnType<typeof analyze>, number]}
 */
function atArgs(code) {
  const { analysis, offset } = at(code)
  return [analysis, offset]
}

/** @param {string} code */
const labels = (code) => {
  const { analysis, offset } = at(code)
  return completions(analysis, offset)?.items.map((i) => i.label) ?? null
}

describe('contextAt', () => {
  it('finds comments, strings and numbers', () => {
    const kind = (/** @type {string} */ code) => {
      const { analysis, offset } = at(code)
      return contextAt(analysis, offset).kind
    }
    expect(kind('-- hello |')).toBe('comment')
    expect(kind('x = 1 -- a|b\ny = 2')).toBe('comment')
    expect(kind('--[[ long\n| ]] x')).toBe('comment')
    expect(kind('--[[ done ]]| x')).toBe('name')
    expect(kind('print("ab|c")')).toBe('string')
    expect(kind('print("abc|')).toBe('string')
    expect(kind('print("abc")|')).toBe('name')
    expect(kind('x = 12|')).toBe('number')
    expect(kind('x = ab|')).toBe('name')
  })

  it('reads the receiver of a member access', () => {
    const { analysis, offset } = at('p.x|')
    expect(contextAt(analysis, offset)).toMatchObject({ kind: 'member', receiver: 'p', prefix: 'x', method: false })
    const m = at('obj:|')
    expect(contextAt(m.analysis, m.offset)).toMatchObject({ kind: 'member', receiver: 'obj', prefix: '', method: true })
  })
})

describe('callAt', () => {
  it('counts the arguments before the cursor', () => {
    const index = (/** @type {string} */ code) => {
      const { analysis, offset } = at(code)
      return callAt(analysis, offset)?.index
    }
    expect(index('circfill(|')).toBe(0)
    expect(index('circfill(1, |')).toBe(1)
    expect(index('circfill(1, 2, 3, |')).toBe(3)
    expect(index('circfill(1, f(2, 3), |')).toBe(2)
    expect(index('circfill({1, 2, 3}, |')).toBe(1)
    expect(index('circfill(1, {a, b|')).toBe(1)
  })

  it('finds nothing outside a call', () => {
    for (const code of ['x = 1|', 'f(1)|', 'f(1) y|', '(1 + |', 'local x = |']) {
      const { analysis, offset } = at(code)
      expect(callAt(analysis, offset), code).toBeNull()
    }
  })

  it('looks through grouping parentheses', () => {
    const { analysis, offset } = at('f(a, (b + |')
    expect(callAt(analysis, offset)?.name).toBe('f')
  })

  it('reads the receiver', () => {
    const { analysis, offset } = at('obj:go(1, |')
    expect(callAt(analysis, offset)).toMatchObject({ name: 'go', receiver: 'obj', method: true, member: true, index: 1 })
  })
})

describe('completions', () => {
  it('offers API functions by prefix', () => {
    const list = labels('sp|')
    expect(list).toContain('spr')
    expect(list).toContain('split')
    expect(list).not.toContain('cls')
  })

  it('matches without regard to case', () => {
    expect(labels('CIR|')).toEqual(expect.arrayContaining(['circ', 'circfill']))
  })

  it('puts locals before file functions before the API', () => {
    const { analysis, offset } = at('function circle_of() end\nlocal circuit = 1\ncir|')
    const items = completions(analysis, offset)?.items ?? []
    const ranks = Object.fromEntries(items.map((i) => [i.label, i.rank]))
    expect(ranks.circuit).toBeLessThan(ranks.circle_of)
    expect(ranks.circle_of).toBeLessThan(ranks.circ)
  })

  it('offers params and loop variables only in scope', () => {
    expect(labels('function f(speed) sp|')).toContain('speed')
    expect(labels('function f(speed) end sp|')).not.toContain('speed')
    expect(labels('for step=1,3 do st|')).toContain('step')
    expect(labels('for step=1,3 do end st|')).not.toContain('step')
  })

  it('does not offer a shadowed API name twice', () => {
    const list = labels('local cls = 1\ncl|') ?? []
    expect(list.filter((l) => l === 'cls')).toHaveLength(1)
  })

  it('does not offer the name being declared', () => {
    expect(labels('local spee|')).not.toContain('spee')
    expect(labels('function mov|')).not.toContain('mov')
  })

  it('lists the known fields after a dot, never API names', () => {
    const list = labels('p = {x = 1, y = 2}\np.z = 3\np.|')
    expect(list).toEqual(expect.arrayContaining(['x', 'y', 'z']))
    expect(list).not.toContain('cls')
    expect(list).not.toContain('print')
    expect(labels('p = {x = 1}\np.x|') ?? []).toEqual(['x'])
  })

  it('lists the fields of the receiver first, and of anything for an unknown one', () => {
    const code = 'a = {ax = 1}\nb = {bx = 1}\n'
    expect(labels(code + 'a.|')).toEqual(['ax'])
    expect(labels(code + 'unknown.|')).toEqual(expect.arrayContaining(['ax', 'bx']))
    expect(labels(code + 'self.|')).toEqual(expect.arrayContaining(['ax', 'bx']))
  })

  it('lists methods after a colon', () => {
    const list = labels('function p:draw() end\nfunction p.new() end\np:|')
    expect(list).toEqual(expect.arrayContaining(['draw']))
  })

  it('offers nothing in strings, comments and after numbers', () => {
    expect(labels('print("sp|")')).toBeNull()
    expect(labels('-- sp|')).toBeNull()
    expect(labels('x = 12|')).toBeNull()
  })

  it('offers snippets and keywords last', () => {
    const { analysis, offset } = at('fo|')
    const items = completions(analysis, offset)?.items ?? []
    const foreach = items.find((i) => i.label === 'foreach')
    expect(foreach?.snippet).toContain('foreach(')
    expect(items.find((i) => i.label === 'for')?.snippet).toBeDefined()
    expect(items.filter((i) => i.label === 'for')).toHaveLength(1)
    expect(items.find((i) => i.label === 'function')).toBeUndefined()
  })

  it('starts the replaced range at the word', () => {
    const { analysis, offset } = at('x = 1\n  circ|')
    expect(completions(analysis, offset)?.from).toBe(offset - 4)
  })

  it('lists everything for an empty prefix', () => {
    const list = labels('|') ?? []
    expect(list).toEqual(expect.arrayContaining(['cls', '_draw', 'local']))
  })

  it('works on half-typed code', () => {
    expect(labels('function f(spa)\n  local spb = 1\n  \n  sp|')).toEqual(expect.arrayContaining(['spr', 'spa', 'spb']))
    expect(labels('local x =\nsp|')).toContain('spr')
  })
})

describe('hover', () => {
  it('describes an API function', () => {
    const { analysis, offset } = at('circfill|(1, 2, 3)')
    const h = hover(analysis, offset)
    expect(h).toMatchObject({ title: 'circfill(x, y, [r], [col])', origin: 'api', from: 0, to: 8 })
    expect(h?.doc).toMatch(/filled circle/)
  })

  it('describes entry points', () => {
    const { analysis, offset } = at('function _upd|ate() end')
    expect(hover(analysis, offset)?.doc).toMatch(/30 times/)
  })

  it('prefers the file declaration with its doc comment', () => {
    const { analysis, offset } = at('-- steps the world\nfunction step(dt) end\nste|p(1)')
    expect(hover(analysis, offset)).toMatchObject({ title: 'step(dt)', doc: 'steps the world', origin: 'file' })
  })

  it('lets a local shadow an API function', () => {
    const { analysis, offset } = at('local cls = 1\nprint(cl|s)')
    expect(hover(analysis, offset)).toMatchObject({ origin: 'file', title: 'local cls' })
  })

  it('describes fields, not API names, after a dot', () => {
    expect(hover(...atArgs('p = {}\nfunction p:cls() end\np:cl|s()'))?.origin).toBe('file')
    const { analysis, offset } = at('p = {}\np.cl|s')
    expect(hover(analysis, offset)).toBeNull()
  })

  it('describes keywords that have a description and ignores others', () => {
    expect(hover(...atArgs('lo|cal x = 1'))?.origin).toBe('keyword')
    expect(hover(...atArgs('whi|le x do end'))).toBeNull()
  })

  it('is silent in comments, strings and over unknown names', () => {
    expect(hover(...atArgs('-- circ|fill'))).toBeNull()
    expect(hover(...atArgs('print("circ|fill")'))).toBeNull()
    expect(hover(...atArgs('nothing|here'))).toBeNull()
  })
})

describe('signature', () => {
  it('follows the argument the cursor is in', () => {
    const active = (/** @type {string} */ code) => {
      const { analysis, offset } = at(code)
      return signature(analysis, offset)?.active
    }
    expect(active('circfill(|')).toBe(0)
    expect(active('circfill(1,|')).toBe(1)
    expect(active('circfill(1, 2, 3, 4|')).toBe(3)
    expect(active('circfill(1, 2, 3, 4, 5|')).toBe(-1)
  })

  it('keeps the last parameter active for variable arguments', () => {
    const { analysis, offset } = at('chr(1, 2, 3, 4|')
    expect(signature(analysis, offset)).toMatchObject({ name: 'chr', active: 0 })
    const s = at('pack(1, 2, 3|')
    expect(signature(s.analysis, s.offset)?.active).toBe(0)
  })

  it('reads user functions from their declaration', () => {
    const { analysis, offset } = at('function move(dx, dy) end\nmove(1, |')
    expect(signature(analysis, offset)).toMatchObject({ name: 'move', active: 1, params: [{ name: 'dx' }, { name: 'dy' }] })
  })

  it('leaves out self for a colon call', () => {
    const { analysis, offset } = at('p = {go = function(self, speed) end}\np:go(|')
    expect(signature(analysis, offset)?.params.map((p) => p.name)).toEqual(['speed'])
    const m = at('function p:go(speed) end\np:go(|')
    expect(signature(m.analysis, m.offset)?.params.map((p) => p.name)).toEqual(['speed'])
  })

  it('gives nothing for unknown functions, variables or outside calls', () => {
    for (const code of ['mystery(|', 'local f = 1\nf(|', 'x = 1|', 'obj:cls(|']) {
      const { analysis, offset } = at(code)
      expect(signature(analysis, offset), code).toBeNull()
    }
  })
})

describe('definition', () => {
  it('finds the innermost local', () => {
    const { analysis, offset } = at('local a = 1\nfunction f()\n  local a = 2\n  print(a|)\nend')
    const d = definition(analysis, offset)
    expect(d && analysis.p8.slice(d.from, d.to)).toBe('a')
    expect(d?.from).toBe(analysis.p8.indexOf('a = 2'))
  })

  it('finds a global function declared later', () => {
    const { analysis, offset } = at('mov|e()\nfunction move() end')
    expect(definition(analysis, offset)?.from).toBe(analysis.p8.indexOf('move() end'))
  })

  it('finds a parameter', () => {
    const { analysis, offset } = at('function f(speed)\n  return sp|eed\nend')
    expect(definition(analysis, offset)?.from).toBe(analysis.p8.indexOf('speed'))
  })

  it('finds fields by receiver, or by name alone', () => {
    const code = 'a = {size = 1}\nb = {size = 2}\n'
    const second = at(code + 'print(b.si|ze)')
    expect(definition(second.analysis, second.offset)?.from).toBe(second.analysis.p8.indexOf('size', 20))
    const any = at(code + 'print(thing().si|ze)')
    expect(definition(any.analysis, any.offset)?.from).toBe(any.analysis.p8.indexOf('size'))
  })

  it('finds nothing for API names and unknowns', () => {
    expect(definition(...atArgs('cl|s()'))).toBeNull()
    expect(definition(...atArgs('unk|nown()'))).toBeNull()
  })
})

describe('outline', () => {
  it('lists functions, then top-level variables, in source order', () => {
    const { analysis } = at(
      'local speed = 1\nfunction _init() local inner = 1 end\ncount = 0\nfunction p:draw(a) end\nlocal function helper(x) end\nfor i=1,2 do local loop = 1 end',
    )
    const items = outline(analysis)
    expect(items.map((i) => [i.name, i.kind])).toEqual([
      ['_init', 'function'],
      ['p:draw', 'function'],
      ['helper', 'function'],
      ['speed', 'variable'],
      ['count', 'variable'],
    ])
    expect(items[1].detail).toBe('p:draw(a)')
  })

  it('is empty for an empty program', () => {
    expect(outline(analyze('').p8 === '' ? analyze('') : analyze(''))).toEqual([])
  })
})

describe('caching', () => {
  it('scans an analysis once', () => {
    const { analysis } = at('local a = 1')
    expect(symbolsOf(analysis)).toBe(symbolsOf(analysis))
  })
})
