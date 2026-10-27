import { describe, expect, it } from 'vitest'
import {
  dedentAmount,
  indentAfter,
  leadingWhitespace,
  opensBlock,
  toggleComment,
} from '../../src/ui/editors/code/lua-indent.js'

describe('opensBlock', () => {
  it('opens after block starters', () => {
    for (const line of ['if x then', 'for i=1,3 do', 'while a do', 'function f()', 'repeat', 'local t = {', 'f(a,', 'else']) {
      expect(opensBlock(line), line).toBe(1)
    }
  })

  it('does not open for one-liners or closers', () => {
    for (const line of ['x = 1', 'if x then a() end', 'if x then a() else b() end', 'end', 'end)', 'until x', '}', '', '-- then']) {
      expect(opensBlock(line), line).toBe(0)
    }
  })

  it('handles else and elseif', () => {
    expect(opensBlock('elseif y then')).toBe(1)
    expect(opensBlock('if x then a() else b() end')).toBe(0)
    expect(opensBlock('else if x then')).toBe(1)
  })

  it('looks at tokens, not words inside strings or comments', () => {
    expect(opensBlock('print("do then")')).toBe(0)
    expect(opensBlock('x = 1 -- function(')).toBe(0)
  })

  it('keeps one-line anonymous functions balanced', () => {
    expect(opensBlock('foreach(t, function(o) o.x += 1 end)')).toBe(0)
    expect(opensBlock('foreach(t, function(o)')).toBe(1)
  })
})

describe('indentAfter', () => {
  it('keeps the indent and adds a level after an opener', () => {
    expect(indentAfter('  x = 1')).toBe('  ')
    expect(indentAfter('  if x then')).toBe('    ')
    expect(indentAfter('\tfor i=1,2 do')).toBe('\t  ')
    expect(indentAfter('')).toBe('')
  })
})

describe('dedentAmount', () => {
  it('removes one level when a block ender is typed alone', () => {
    expect(dedentAmount('    end')).toBe(2)
    expect(dedentAmount('  else')).toBe(2)
    expect(dedentAmount('  until')).toBe(2)
    expect(dedentAmount('  }')).toBe(2)
  })

  it('does nothing otherwise', () => {
    expect(dedentAmount('  endx')).toBe(0)
    expect(dedentAmount('  x = end')).toBe(0)
    expect(dedentAmount('')).toBe(0)
  })

  it('never removes more than the line has', () => {
    expect(dedentAmount(' end')).toBe(1)
    expect(dedentAmount('end')).toBe(0)
    expect(dedentAmount('\tend')).toBe(1)
  })
})

describe('leadingWhitespace', () => {
  it('returns spaces and tabs', () => {
    expect(leadingWhitespace(' \t x')).toBe(' \t ')
    expect(leadingWhitespace('x')).toBe('')
  })
})

describe('toggleComment', () => {
  it('comments at the shallowest indent and skips blank lines', () => {
    expect(toggleComment(['  a', '', '    b'])).toEqual(['  -- a', '', '  --   b'])
  })

  it('uncomments when every line is commented', () => {
    expect(toggleComment(['  -- a', '', '--b'])).toEqual(['  a', '', 'b'])
  })

  it('comments everything when only some lines are', () => {
    expect(toggleComment(['-- a', 'b'])).toEqual(['-- -- a', '-- b'])
  })

  it('round-trips', () => {
    const lines = ['if x then', '  y()', 'end']
    expect(toggleComment(toggleComment(lines))).toEqual(lines)
  })
})
