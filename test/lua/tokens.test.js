import { describe, expect, it } from 'vitest'
import { countTokens, tokenizeTolerant } from '../../src/lua/tokens.js'

describe('countTokens', () => {
  it.each([
    ['', 0],
    ['x=1', 3],
    ['local x=1', 3],
    ['function f(a,b) return a end', 7],
    ['x=-1', 3],
    ['x=~1', 3],
    ['x=a-1', 5],
    ['x=(1)-1', 6],
    ['x=f()-1', 6],
    ['x=-a', 4],
    ['t.x=1', 4],
    ['a:b()', 3],
    ['::top::', 1],
    ['foo(1,2)', 4],
    ['t={1,2}', 5],
    ['if x then y() end', 5],
    ['x=1 -- a comment, with tokens', 3],
    ['x="a,b"', 3],
    ['x=true-1', 5],
    ['print("hi");', 3],
  ])('%j has %i tokens', (src, n) => {
    expect(countTokens(src)).toBe(n)
  })

  it('counts what can be read of broken source', () => {
    expect(countTokens('x=1\ny="abc\nz=2')).toBe(8)
    expect(countTokens('x=1\n--[[ never closed\ny=2')).toBe(3)
  })
})

describe('tokenizeTolerant', () => {
  it('matches tokenize for valid source (without eof)', () => {
    const { tokens, errors } = tokenizeTolerant('local a = 1\nb = a + 2')
    expect(errors).toEqual([])
    expect(tokens.map((t) => t.value)).toEqual(['local', 'a', '=', 1, 'b', '=', 'a', '+', 2])
  })

  it('keeps tokens before an error and resumes on the next line', () => {
    const src = 'a=1 b="oops\nc=2'
    const { tokens, errors } = tokenizeTolerant(src)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ pos: 6, end: 11 })
    expect(tokens.map((t) => t.value)).toEqual(['a', '=', 1, 'b', '=', 'c', '=', 2])
  })

  it('reports correct offsets and lines after a recovery', () => {
    const src = '"x\nfoo = 1'
    const { tokens } = tokenizeTolerant(src)
    const foo = tokens[0]
    expect(foo.value).toBe('foo')
    expect(foo.pos).toBe(src.indexOf('foo'))
    expect(foo.line).toBe(2)
    expect(foo.col).toBe(1)
  })

  it('lets an unfinished long comment swallow the rest', () => {
    const { tokens, errors } = tokenizeTolerant('a=1\n--[[ open\nb=2')
    expect(tokens).toHaveLength(3)
    expect(errors[0].end).toBe(17)
  })

  it('survives several errors', () => {
    const { errors } = tokenizeTolerant('"a\n"b\n"c')
    expect(errors).toHaveLength(3)
  })
})
