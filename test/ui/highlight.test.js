import { describe, expect, it } from 'vitest'
import { tokenizeTolerant } from '../../src/lua/tokens.js'
import { highlight, matchBracket } from '../../src/ui/editors/code/highlight.js'

/**
 * The highlighted words as `text:class`.
 * @param {string} src
 */
const marks = (src) => highlight(src).map((s) => `${src.slice(s.from, s.to)}:${s.cls}`)

describe('highlight', () => {
  it('classifies the basics', () => {
    expect(marks('local x = 10 + "hi"')).toEqual(['local:keyword', '=:operator', '10:number', '+:operator', '"hi":string'])
  })

  it('knows atoms, builtins and PICO-8 operators', () => {
    expect(marks('cls() x = nil')).toEqual(['cls:builtin', '(:punct', '):punct', '=:operator', 'nil:atom'])
    expect(marks('a \\ b')).toEqual(['\\:operator'])
    expect(marks('x = 0b101')).toEqual(['=:operator', '0b101:number'])
  })

  it('marks function names and properties', () => {
    expect(marks('function a.b:c() end')).toEqual([
      'function:keyword',
      'a:def',
      '.:punct',
      'b:def',
      '::punct',
      'c:def',
      '(:punct',
      '):punct',
      'end:keyword',
    ])
    expect(marks('o.x = 1')).toContain('x:property')
    expect(marks('o:print()')).toContain('print:property')
    expect(marks('function f(print) end')).not.toContain('f:builtin')
  })

  it('finds both comment styles, which the lexer drops', () => {
    expect(marks('x=1 -- note\ny=2')).toContain('-- note:comment')
    expect(marks('x=1 // note')).toContain('// note:comment')
    expect(marks('--[[ a\nb ]] x=1')).toContain('--[[ a\nb ]]:comment')
  })

  it('does not treat code in strings or comments as code', () => {
    expect(marks('"end -- no"')).toEqual(['"end -- no":string'])
    expect(marks('-- end then')).toEqual(['-- end then:comment'])
  })

  it('stays tolerant of half-typed code', () => {
    const open = marks('x = 1\ny = "abc\nz = 2')
    expect(open).toContain('1:number')
    expect(open).toContain('2:number')
    expect(open.some((m) => m.endsWith(':error'))).toBe(true)
    expect(marks('--[[ never closed\nx=1')[0].endsWith(':comment')).toBe(true)
    expect(marks('s = [[ never closed')).toContain('[[ never closed:string')
  })

  it('returns ordered, non-overlapping segments', () => {
    const src = 'function f(a)\n  -- hi\n  return a.b:c(1, "x") // k\nend\n"oops'
    const segs = highlight(src)
    for (let i = 1; i < segs.length; i++) expect(segs[i].from).toBeGreaterThanOrEqual(segs[i - 1].to)
    for (const s of segs) expect(s.to).toBeGreaterThan(s.from)
  })

  it('accepts a precomputed lex', () => {
    const src = 'x = 1'
    expect(highlight(src, tokenizeTolerant(src))).toEqual(highlight(src))
  })
})

describe('matchBracket', () => {
  const find = (/** @type {string} */ src, /** @type {number} */ cursor) => {
    const r = matchBracket(tokenizeTolerant(src).tokens, cursor)
    return r && { at: r.bracket.pos, match: r.match ? r.match.pos : null }
  }

  it('pairs brackets in both directions', () => {
    expect(find('f(a, g(b))', 1)).toEqual({ at: 1, match: 9 })
    expect(find('f(a, g(b))', 2)).toEqual({ at: 1, match: 9 })
    expect(find('f(a, g(b))', 10)).toEqual({ at: 9, match: 1 })
    expect(find('f(a, g(b))', 7)).toEqual({ at: 6, match: 8 })
    expect(find('f(a, g(b))', 8)).toEqual({ at: 8, match: 6 })
  })

  it('handles the three kinds and nesting', () => {
    expect(find('{[(x)]}', 0)).toEqual({ at: 0, match: 6 })
    expect(find('{[(x)]}', 7)).toEqual({ at: 6, match: 0 })
  })

  it('ignores brackets in strings and comments', () => {
    expect(find('f(")")', 1)).toEqual({ at: 1, match: 5 })
    expect(find('f( -- )\n)', 1)).toEqual({ at: 1, match: 8 })
  })

  it('reports an unmatched bracket and nothing elsewhere', () => {
    expect(find('f(a', 1)).toEqual({ at: 1, match: null })
    expect(find('a)', 2)).toEqual({ at: 1, match: null })
    expect(find('x = 1', 2)).toBe(null)
  })
})
