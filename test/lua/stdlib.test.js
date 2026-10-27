import { describe, expect, it } from 'vitest'
import { FIXED, FLOAT } from '../../src/lua/numbers.js'
import { createOps } from '../../src/lua/ops.js'
import { createStdlib } from '../../src/lua/stdlib.js'
import { LuaTable } from '../../src/lua/table.js'
import { LuaError } from '../../src/lua/errors.js'

/**
 * @param {import('../../src/lua/numbers.js').NumberModel} [model]
 * @param {import('../../src/lua/stdlib.js').Host} [host]
 */
function lib(model = FIXED, host = {}) {
  const ops = createOps(model)
  const G = createStdlib(ops, { seed: 1, ...host })
  /** @type {(name: string, ...args: any[]) => any} */
  const call = (name, ...args) => G.get(name)(...args)
  return { ops, G, call }
}
const { call, G, ops } = lib()
const T = (...items) => new LuaTable(items)
/** Collects a table's array part. @param {LuaTable} t */
const list = (t) => [...t.a]
/** Lazily runs a generic-for style loop over what pairs()/ipairs()/all() return. */
function* lazy(r) {
  const [f, s, c] = Array.isArray(r) ? r : [r]
  let ctl = c
  for (;;) {
    const v = f(s, ctl)
    const vals = Array.isArray(v) ? v : [v]
    if (vals[0] === undefined) return
    yield vals.length === 1 ? vals[0] : vals
    ctl = vals[0]
  }
}
const iterate = (r) => [...lazy(r)]

describe('add', () => {
  it('appends and returns the value', () => {
    const t = T()
    expect(call('add', t, 'a')).toBe('a')
    call('add', t, 'b')
    expect(list(t)).toEqual(['a', 'b'])
  })
  it('ignores nil values', () => {
    const t = T(1)
    expect(call('add', t, undefined)).toBeUndefined()
    expect(t.length()).toBe(1)
  })
  it('accepts false and 0', () => {
    const t = T()
    call('add', t, false)
    call('add', t, 0)
    expect(list(t)).toEqual([false, 0])
  })
  it('inserts at an index, shifting up', () => {
    const t = T('a', 'c')
    call('add', t, 'b', 2)
    expect(list(t)).toEqual(['a', 'b', 'c'])
    call('add', t, 'z', 1)
    expect(list(t)).toEqual(['z', 'a', 'b', 'c'])
    call('add', t, 'end', 5)
    expect(list(t)).toEqual(['z', 'a', 'b', 'c', 'end'])
  })
  it('clamps out-of-range indices', () => {
    const t = T('a')
    call('add', t, 'big', 99)
    call('add', t, 'small', -5)
    expect(list(t)).toEqual(['small', 'a', 'big'])
  })
  it('does nothing for nil tables, throws for other types', () => {
    expect(call('add', undefined, 1)).toBeUndefined()
    expect(() => call('add', 5, 1)).toThrow("bad argument #1 to 'add' (table expected, got number)")
    expect(() => call('add', 'str', 1)).toThrow(LuaError)
  })
  it('works on tables that also have string keys', () => {
    const t = new LuaTable()
    t.set('name', 'x')
    call('add', t, 1)
    expect(t.get(1)).toBe(1)
    expect(t.length()).toBe(1)
  })
  it('fills past stashed integer keys', () => {
    const t = new LuaTable()
    t.set(3, 'c')
    call('add', t, 'a')
    call('add', t, 'b')
    expect(t.length()).toBe(3)
  })
})

describe('del / deli', () => {
  it('del removes the first match and shifts down', () => {
    const t = T('a', 'b', 'a', 'c')
    expect(call('del', t, 'a')).toBe('a')
    expect(list(t)).toEqual(['b', 'a', 'c'])
  })
  it('del of a missing value does nothing', () => {
    const t = T(1, 2)
    expect(call('del', t, 3)).toBeUndefined()
    expect(list(t)).toEqual([1, 2])
  })
  it('del compares without coercion', () => {
    const t = T(1, '1')
    call('del', t, '1')
    expect(list(t)).toEqual([1])
  })
  it('del(t, nil) and del(nil, x) are no-ops', () => {
    const t = T(1, undefined, 3)
    expect(call('del', t, undefined)).toBeUndefined()
    expect(list(t)).toEqual([1, undefined, 3])
    expect(call('del', undefined, 1)).toBeUndefined()
  })
  it('del matches by identity for tables', () => {
    const a = T()
    const b = T()
    const t = T(a, b)
    call('del', t, b)
    expect(list(t)).toEqual([a])
  })
  it('del of the last element shrinks the length', () => {
    const t = T(1, 2, 3)
    call('del', t, 3)
    expect(t.length()).toBe(2)
  })
  it('deli removes by index, defaulting to the last', () => {
    const t = T('a', 'b', 'c')
    expect(call('deli', t, 2)).toBe('b')
    expect(list(t)).toEqual(['a', 'c'])
    expect(call('deli', t)).toBe('c')
    expect(list(t)).toEqual(['a'])
    expect(call('deli', t, 1)).toBe('a')
    expect(call('deli', t)).toBeUndefined()
  })
  it('deli with an out-of-range index does nothing', () => {
    const t = T(1, 2)
    expect(call('deli', t, 0)).toBeUndefined()
    expect(call('deli', t, 3)).toBeUndefined()
    expect(call('deli', t, -1)).toBeUndefined()
    expect(list(t)).toEqual([1, 2])
    expect(call('deli', undefined, 1)).toBeUndefined()
  })
  it('deleting while iterating with all() skips the next element', () => {
    const t = T(1, 2, 3, 4)
    const seen = []
    for (const v of lazy(call('all', t))) {
      seen.push(v)
      call('del', t, v)
    }
    expect(seen).toEqual([1, 3])
    expect(list(t)).toEqual([2, 4])
  })
})

describe('count / all / foreach', () => {
  it('count', () => {
    expect(call('count', T(1, 2, 3))).toBe(3)
    expect(call('count', T())).toBe(0)
    expect(call('count', undefined)).toBe(0)
    expect(call('count', T(1, 2, 1, 1), 1)).toBe(3)
    expect(call('count', T(1, 2), 5)).toBe(0)
    expect(call('count', T(1, undefined, 3))).toBe(2)
    expect(call('count', T(false, false), false)).toBe(2)
  })
  it('all yields values in order', () => {
    expect(iterate(call('all', T('a', 'b', 'c')))).toEqual(['a', 'b', 'c'])
  })
  it('all skips holes and yields false', () => {
    expect(iterate(call('all', T(1, undefined, false, 3)))).toEqual([1, false, 3])
  })
  it('all(nil) yields nothing', () => {
    expect(iterate(call('all', undefined))).toEqual([])
  })
  it('all sees elements appended while iterating', () => {
    const t = T(1)
    const seen = []
    for (const v of lazy(call('all', t))) {
      seen.push(v)
      if (v < 3) call('add', t, v + 1)
    }
    expect(seen).toEqual([1, 2, 3])
  })
  it('foreach calls with each value', () => {
    const seen = []
    call('foreach', T(1, 2, 3), (v) => seen.push(v))
    expect(seen).toEqual([1, 2, 3])
  })
  it('foreach skips nil holes, includes false', () => {
    const seen = []
    call('foreach', T(1, undefined, false), (v) => seen.push(v))
    expect(seen).toEqual([1, false])
  })
  it('foreach(nil, f) is a no-op; non-function errors', () => {
    expect(() => call('foreach', undefined, () => {})).not.toThrow()
    expect(() => call('foreach', T(1), undefined)).toThrow('attempt to call a nil value')
  })
  it('foreach with callable table', () => {
    const seen = []
    const f = new LuaTable()
    f.meta = new LuaTable()
    f.meta.set('__call', (self, v) => seen.push(v))
    call('foreach', T(7, 8), f)
    expect(seen).toEqual([7, 8])
  })
})

describe('pairs / ipairs / next / inext', () => {
  it('pairs covers array then hash', () => {
    const t = T('a', 'b')
    t.set('x', 1)
    expect(iterate(call('pairs', t))).toEqual([[1, 'a'], [2, 'b'], ['x', 1]])
  })
  it('pairs(nil) yields nothing; other types throw', () => {
    expect(iterate(call('pairs', undefined))).toEqual([])
    expect(() => call('pairs', 5)).toThrow("bad argument #1 to 'pairs' (table expected, got number)")
    expect(() => call('pairs', 'str')).toThrow(LuaError)
  })
  it('pairs honours __pairs', () => {
    const t = new LuaTable()
    t.meta = new LuaTable()
    t.meta.set('__pairs', () => [(s, c) => (c === undefined ? [1, 'custom'] : undefined), t, undefined])
    expect(iterate(call('pairs', t))).toEqual([[1, 'custom']])
  })
  it('pairs sees false values', () => {
    const t = new LuaTable()
    t.set('f', false)
    expect(iterate(call('pairs', t))).toEqual([['f', false]])
  })
  it('ipairs stops at the first nil', () => {
    expect(iterate(call('ipairs', T('a', 'b', undefined, 'd')))).toEqual([[1, 'a'], [2, 'b']])
  })
  it('ipairs continues through false', () => {
    expect(iterate(call('ipairs', T(false, 0)))).toEqual([[1, false], [2, 0]])
  })
  it('ipairs ignores string keys and empty tables', () => {
    const t = new LuaTable()
    t.set('x', 1)
    expect(iterate(call('ipairs', t))).toEqual([])
  })
  it('ipairs follows __index', () => {
    const t = new LuaTable()
    t.meta = new LuaTable()
    t.meta.set('__index', (self, k) => (k <= 3 ? k * 10 : undefined))
    expect(iterate(call('ipairs', t))).toEqual([[1, 10], [2, 20], [3, 30]])
  })
  it('ipairs(nil) yields nothing; numbers throw', () => {
    expect(iterate(call('ipairs', undefined))).toEqual([])
    expect(() => call('ipairs', 5)).toThrow(LuaError)
  })
  it('inext', () => {
    const t = T('a', 'b')
    expect(call('inext', t, 0)).toEqual([1, 'a'])
    expect(call('inext', t, 1)).toEqual([2, 'b'])
    expect(call('inext', t, 2)).toBeUndefined()
  })
  it('next', () => {
    const t = new LuaTable()
    expect(call('next', t)).toBeUndefined()
    t.set('x', 1)
    expect(call('next', t)).toEqual(['x', 1])
    expect(call('next', t, 'x')).toBeUndefined()
    expect(() => call('next', undefined)).toThrow(LuaError)
  })
  it('next(t) == nil detects emptiness even with holes', () => {
    expect(call('next', T(undefined, undefined))).toBeUndefined()
  })
})

describe('pack / unpack / select', () => {
  it('pack stores values and n', () => {
    const t = call('pack', 1, undefined, 3, undefined)
    expect(t.get('n')).toBe(4)
    expect(t.get(1)).toBe(1)
    expect(t.get(3)).toBe(3)
    expect(call('pack').get('n')).toBe(0)
  })
  it('unpack returns all values', () => {
    expect(call('unpack', T(1, 2, 3))).toEqual([1, 2, 3])
    expect(call('unpack', T())).toEqual([])
  })
  it('unpack with a range, including holes and beyond the end', () => {
    expect(call('unpack', T(1, 2, 3), 2)).toEqual([2, 3])
    expect(call('unpack', T(1, 2, 3), 2, 3)).toEqual([2, 3])
    expect(call('unpack', T(1, 2, 3), 2, 5)).toEqual([2, 3, undefined, undefined])
    expect(call('unpack', T(1, undefined, 3))).toEqual([1, undefined, 3])
    expect(call('unpack', T(1, 2), 3, 2)).toEqual([])
  })
  it('unpack round-trips pack with trailing nils via n', () => {
    const t = call('pack', 1, undefined, undefined)
    expect(call('unpack', t, 1, t.get('n'))).toEqual([1, undefined, undefined])
  })
  it('unpack errors on non-tables and absurd ranges', () => {
    expect(() => call('unpack', undefined)).toThrow("bad argument #1 to 'unpack'")
    expect(() => call('unpack', T(), 1, 1e7)).toThrow('too many results to unpack')
  })
  it('select', () => {
    expect(call('select', '#')).toBe(0)
    expect(call('select', '#', 1, undefined, undefined)).toBe(3)
    expect(call('select', 1, 'a', 'b', 'c')).toEqual(['a', 'b', 'c'])
    expect(call('select', 2, 'a', 'b', 'c')).toEqual(['b', 'c'])
    expect(call('select', 3, 'a', 'b', 'c')).toEqual(['c'])
    expect(call('select', 4, 'a', 'b', 'c')).toEqual([])
    expect(call('select', -1, 'a', 'b', 'c')).toEqual(['c'])
    expect(call('select', -3, 'a', 'b', 'c')).toEqual(['a', 'b', 'c'])
  })
  it('select rejects index 0 and too-negative indices', () => {
    expect(() => call('select', 0, 1)).toThrow('index out of range')
    expect(() => call('select', -2, 1)).toThrow('index out of range')
  })
})

describe('metatables and raw access', () => {
  it('setmetatable returns the table', () => {
    const t = T()
    const m = T()
    expect(call('setmetatable', t, m)).toBe(t)
    expect(call('getmetatable', t)).toBe(m)
  })
  it('setmetatable(t, nil) removes it', () => {
    const t = T()
    call('setmetatable', t, T())
    call('setmetatable', t, undefined)
    expect(call('getmetatable', t)).toBeUndefined()
  })
  it('validates arguments', () => {
    expect(() => call('setmetatable', undefined, T())).toThrow("bad argument #1 to 'setmetatable'")
    expect(() => call('setmetatable', 5, T())).toThrow(LuaError)
    expect(() => call('setmetatable', T(), 5)).toThrow("bad argument #2 to 'setmetatable' (nil or table expected)")
    expect(() => call('setmetatable', T(), 'x')).toThrow(LuaError)
  })
  it('__metatable protects and is returned by getmetatable', () => {
    const t = T()
    const m = new LuaTable()
    m.set('__metatable', 'locked')
    call('setmetatable', t, m)
    expect(call('getmetatable', t)).toBe('locked')
    expect(() => call('setmetatable', t, T())).toThrow('cannot change a protected metatable')
  })
  it('getmetatable of non-tables is nil', () => {
    expect(call('getmetatable', 5)).toBeUndefined()
    expect(call('getmetatable', 'str')).toBeUndefined()
    expect(call('getmetatable', undefined)).toBeUndefined()
    expect(call('getmetatable', T())).toBeUndefined()
  })
  it('rawget / rawset / rawequal / rawlen bypass metamethods', () => {
    const t = T()
    const m = new LuaTable()
    m.set('__index', () => 'meta')
    m.set('__newindex', () => { throw new Error('should not run') })
    m.set('__len', () => 99)
    m.set('__eq', () => true)
    call('setmetatable', t, m)
    expect(ops.index(t, 'x')).toBe('meta')
    expect(call('rawget', t, 'x')).toBeUndefined()
    expect(call('rawset', t, 'x', 5)).toBe(t)
    expect(call('rawget', t, 'x')).toBe(5)
    expect(call('rawlen', t)).toBe(0)
    expect(call('rawlen', 'abc')).toBe(3)
    expect(call('rawequal', t, T())).toBe(false)
    expect(call('rawequal', t, t)).toBe(true)
    expect(call('rawequal', 1, 1)).toBe(true)
    expect(call('rawequal', 1, '1')).toBe(false)
  })
  it('rawset with nil key throws', () => {
    expect(() => call('rawset', T(), undefined, 1)).toThrow('table index is nil')
  })
  it('type', () => {
    expect(call('type', undefined)).toBe('nil')
    expect(call('type', true)).toBe('boolean')
    expect(call('type', 1)).toBe('number')
    expect(call('type', 'x')).toBe('string')
    expect(call('type', T())).toBe('table')
    expect(call('type', () => {})).toBe('function')
    expect(() => call('type')).toThrow("bad argument #1 to 'type'")
  })
  it('assert returns its arguments or throws the message', () => {
    expect(call('assert', 1, 'm')).toEqual([1, 'm'])
    expect(call('assert', 0)).toEqual([0])
    expect(call('assert', '')).toEqual([''])
    expect(() => call('assert', false)).toThrow('assertion failed!')
    expect(() => call('assert', undefined, 'boom')).toThrow('boom')
    expect(() => call('assert')).toThrow('assertion failed!')
    try {
      call('assert', false, T())
      expect.unreachable()
    } catch (e) {
      expect(/** @type {LuaError} */ (e).value).toBeInstanceOf(LuaTable)
    }
  })
})

describe('tostr / tonum', () => {
  it('tostr', () => {
    expect(call('tostr')).toBe('')
    expect(call('tostr', undefined)).toBe('[nil]')
    expect(call('tostr', 'abc')).toBe('abc')
    expect(call('tostr', 12)).toBe('12')
    expect(call('tostr', 0.5)).toBe('0.5')
    expect(call('tostr', true)).toBe('true')
    expect(call('tostr', T())).toBe('[table]')
    expect(G.get('tostring')).toBe(G.get('tostr'))
  })
  it('tostr hex flags', () => {
    expect(call('tostr', 1.5, 1)).toBe('0x0001.8000')
    expect(call('tostr', -1, 1)).toBe('0xffff.0000')
    expect(call('tostr', 0, 1)).toBe('0x0000.0000')
    expect(call('tostr', 1.5, 3)).toBe('0x00018000')
    expect(call('tostr', 1.5, 2)).toBe('98304')
    expect(call('tostr', -1, 2)).toBe('-65536')
    expect(call('tostr', 'str', 1)).toBe('str')
    expect(call('tostr', 7, 0)).toBe('7')
  })
  it('tonum', () => {
    expect(call('tonum', 5)).toBe(5)
    expect(call('tonum', '5')).toBe(5)
    expect(call('tonum', '-1.5')).toBe(-1.5)
    expect(call('tonum', '0x10')).toBe(16)
    expect(call('tonum', '0b11')).toBe(3)
    expect(call('tonum', 'abc')).toBeUndefined()
    expect(call('tonum', '')).toBeUndefined()
    expect(call('tonum', undefined)).toBeUndefined()
    expect(call('tonum', T())).toBeUndefined()
    expect(call('tonum', true)).toBe(1)
    expect(call('tonum', false)).toBe(0)
  })
  it('tonum flags', () => {
    expect(call('tonum', 'ff', 1)).toBe(255)
    expect(call('tonum', '0xff', 1)).toBe(255)
    expect(call('tonum', '101', 4)).toBe(5)
    expect(call('tonum', 'abc', 2)).toBe(0)
    expect(call('tonum', undefined, 2)).toBe(0)
    expect(call('tonum', 'zz', 1)).toBeUndefined()
  })
  it('tonum rounds to the number model', () => {
    expect(call('tonum', '0.1')).toBe(6554 / 65536)
    expect(lib(FLOAT).call('tonum', '0.1')).toBe(0.1)
  })
})

describe('strings', () => {
  it('sub', () => {
    expect(call('sub', 'hello', 2, 4)).toBe('ell')
    expect(call('sub', 'hello', 2)).toBe('ello')
    expect(call('sub', 'hello', -3)).toBe('llo')
    expect(call('sub', 'hello', 1, -2)).toBe('hell')
    expect(call('sub', 'hello', 0)).toBe('hello')
    expect(call('sub', 'hello', 4, 2)).toBe('')
    expect(call('sub', 'hello', 10)).toBe('')
    expect(call('sub', 'hello', 1, 100)).toBe('hello')
    expect(call('sub', 'hello', -100, 2)).toBe('he')
    expect(call('sub', '', 1, 1)).toBe('')
    expect(call('sub', 'hello', 3, 3)).toBe('l')
    expect(call('sub', 'hello', 2.9, 3.9)).toBe('el')
  })
  it('sub of numbers converts them; others throw', () => {
    expect(call('sub', 12345, 2, 3)).toBe('23')
    expect(() => call('sub', undefined, 1)).toThrow("bad argument #1 to 'sub' (string expected, got nil)")
    expect(() => call('sub', T(), 1)).toThrow("(string expected, got table)")
  })
  it('ord / chr', () => {
    expect(call('ord', 'A')).toBe(65)
    expect(call('ord', 'ABC', 2)).toBe(66)
    expect(call('ord', 'ABC', 4)).toBeUndefined()
    expect(call('ord', 'ABC', 0)).toBeUndefined()
    expect(call('ord', '')).toBeUndefined()
    expect(call('ord', 'ABC', 1, 3)).toEqual([65, 66, 67])
    expect(call('ord', 'ABC', 2, 5)).toEqual([66, 67])
    expect(call('ord', '\x80')).toBe(128)
    expect(call('chr', 65)).toBe('A')
    expect(call('chr', 72, 105)).toBe('Hi')
    expect(call('chr', 0x80)).toBe('\x80')
    expect(call('chr', 256 + 65)).toBe('A')
    expect(call('chr')).toBe('')
  })
  it('split on commas converts numbers', () => {
    expect(list(call('split', '1,2,3'))).toEqual([1, 2, 3])
    expect(list(call('split', 'a,b,c'))).toEqual(['a', 'b', 'c'])
    expect(list(call('split', '1,a,0x10,2.5'))).toEqual([1, 'a', 16, 2.5])
  })
  it('split keeps empty fields', () => {
    expect(list(call('split', 'a,,b'))).toEqual(['a', '', 'b'])
    expect(list(call('split', 'a,'))).toEqual(['a', ''])
    expect(list(call('split', ',a'))).toEqual(['', 'a'])
    expect(list(call('split', ','))).toEqual(['', ''])
  })
  it('split of the empty string is an empty table', () => {
    expect(list(call('split', ''))).toEqual([])
  })
  it('split with other separators', () => {
    expect(list(call('split', 'a b c', ' '))).toEqual(['a', 'b', 'c'])
    expect(list(call('split', 'a, b', ', '))).toEqual(['a', 'b'])
    expect(list(call('split', 'abc', ''))).toEqual(['a', 'b', 'c'])
    expect(list(call('split', 'abcdefg', 3))).toEqual(['abc', 'def', 'g'])
    expect(list(call('split', '123456', 2))).toEqual([12, 34, 56])
  })
  it('split without conversion keeps strings', () => {
    expect(list(call('split', '1,2', ',', false))).toEqual(['1', '2'])
  })
  it('split with nil separator uses comma', () => {
    expect(list(call('split', '1,2', undefined))).toEqual([1, 2])
  })
  it('split rejects non-strings', () => {
    expect(() => call('split', undefined)).toThrow(LuaError)
    expect(list(call('split', 12))).toEqual([12])
  })
})

describe('math', () => {
  it('flr / ceil', () => {
    expect(call('flr', 1.5)).toBe(1)
    expect(call('flr', -1.5)).toBe(-2)
    expect(call('flr', -0.5)).toBe(-1)
    expect(call('flr', 3)).toBe(3)
    expect(call('ceil', 1.2)).toBe(2)
    expect(call('ceil', -1.2)).toBe(-1)
    expect(call('ceil', 2)).toBe(2)
  })
  it('flr coerces strings and treats other values as 0', () => {
    expect(call('flr', '2.7')).toBe(2)
    expect(call('flr', undefined)).toBe(0)
    expect(call('flr', 'abc')).toBe(0)
    expect(call('flr', T())).toBe(0)
  })
  it('abs / sgn', () => {
    expect(call('abs', -3)).toBe(3)
    expect(call('abs', 3)).toBe(3)
    expect(call('abs', -32768)).toBe(-32768) // wraps like the console
    expect(lib(FLOAT).call('abs', -32768)).toBe(32768)
    expect(call('sgn', -5)).toBe(-1)
    expect(call('sgn', 5)).toBe(1)
    expect(call('sgn', 0)).toBe(1)
  })
  it('sqrt', () => {
    expect(call('sqrt', 4)).toBe(2)
    expect(call('sqrt', 2)).toBe(Math.floor(Math.SQRT2 * 65536) / 65536)
    expect(call('sqrt', 0)).toBe(0)
    expect(call('sqrt', -4)).toBe(0)
    expect(lib(FLOAT).call('sqrt', 2)).toBe(Math.SQRT2)
  })
  it('min / max / mid', () => {
    expect(call('max', 1, 2)).toBe(2)
    expect(call('min', 1, 2)).toBe(1)
    expect(call('max', -1, -2)).toBe(-1)
    expect(call('max', 5)).toBe(5)
    expect(call('max', -5)).toBe(0) // missing argument counts as 0
    expect(call('min', 5)).toBe(0)
    expect(call('mid', 1, 2, 3)).toBe(2)
    expect(call('mid', 3, 2, 1)).toBe(2)
    expect(call('mid', 2, 1, 3)).toBe(2)
    expect(call('mid', 1, 3, 2)).toBe(2)
    expect(call('mid', 0, 5, 10)).toBe(5)
    expect(call('mid', 0, -5, 10)).toBe(0)
    expect(call('mid', 0, 15, 10)).toBe(10)
    expect(call('mid', 5, 5, 5)).toBe(5)
  })
  it('sin / cos use turns, with sin inverted', () => {
    expect(call('sin', 0)).toBe(0)
    expect(call('sin', 0.25)).toBe(-1)
    expect(call('sin', 0.5)).toBe(0)
    expect(call('sin', 0.75)).toBe(1)
    expect(call('sin', 1)).toBe(0)
    expect(call('sin', -0.25)).toBe(1)
    expect(call('sin', 1.25)).toBe(-1)
    expect(call('cos', 0)).toBe(1)
    expect(call('cos', 0.25)).toBe(0)
    expect(call('cos', 0.5)).toBe(-1)
    expect(call('cos', 0.75)).toBe(0)
    expect(call('cos', 1)).toBe(1)
    expect(Math.abs(call('sin', 1 / 8) + Math.SQRT1_2)).toBeLessThan(1 / 32768)
    expect(Math.abs(call('cos', 1 / 8) - Math.SQRT1_2)).toBeLessThan(1 / 32768)
  })
  it('sin stays on the fixed grid; float model is exact', () => {
    const v = call('sin', 0.1)
    expect(Number.isInteger(v * 65536)).toBe(true)
    expect(lib(FLOAT).call('sin', 0.1)).toBe(-Math.sin(0.1 * 2 * Math.PI))
  })
  it('atan2 returns turns with y inverted', () => {
    expect(call('atan2', 1, 0)).toBe(0)
    expect(call('atan2', 0, -1)).toBe(0.25)
    expect(call('atan2', -1, 0)).toBe(0.5)
    expect(call('atan2', 0, 1)).toBe(0.75)
    expect(call('atan2', 0, 0)).toBe(0.25)
    expect(Math.abs(call('atan2', 1, -1) - 0.125)).toBeLessThan(1 / 32768)
  })
  it('bitwise functions mirror the operators', () => {
    expect(call('band', 5, 3)).toBe(1)
    expect(call('bor', 5, 3)).toBe(7)
    expect(call('bxor', 5, 3)).toBe(6)
    expect(call('bnot', 0)).toBe(-1 / 65536)
    expect(call('shl', 1, 4)).toBe(16)
    expect(call('shr', 16, 4)).toBe(1)
    expect(call('lshr', -1, 16)).toBe(65535 / 65536)
    expect(call('rotl', 1 / 65536, 1)).toBe(2 / 65536)
    expect(call('rotr', 1 / 65536, 1)).toBe(-32768)
    expect(call('band', undefined, 3)).toBe(0)
  })
})

describe('random numbers', () => {
  it('rnd() is in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const r = call('rnd')
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThan(1)
    }
  })
  it('rnd(x) is in [0, x)', () => {
    for (let i = 0; i < 1000; i++) {
      const r = call('rnd', 10)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThan(10)
    }
  })
  it('rnd(0) is 0 and negative gives non-positive values', () => {
    expect(call('rnd', 0)).toBe(0)
    for (let i = 0; i < 100; i++) expect(call('rnd', -5)).toBeLessThanOrEqual(0)
  })
  it('rnd(x) stays on the fixed grid; floats do not', () => {
    for (let i = 0; i < 100; i++) expect(Number.isInteger(call('rnd', 7) * 65536)).toBe(true)
  })
  it('flr(rnd(n)) covers 0..n-1', () => {
    const seen = new Set()
    for (let i = 0; i < 500; i++) seen.add(call('flr', call('rnd', 4)))
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
  })
  it('rnd(table) picks an element', () => {
    const t = T('a', 'b', 'c')
    const seen = new Set()
    for (let i = 0; i < 200; i++) seen.add(call('rnd', t))
    expect([...seen].sort()).toEqual(['a', 'b', 'c'])
    expect(call('rnd', T())).toBeUndefined()
  })
  it('srand makes the sequence repeatable', () => {
    call('srand', 42)
    const a = [call('rnd'), call('rnd'), call('rnd')]
    call('srand', 42)
    const b = [call('rnd'), call('rnd'), call('rnd')]
    expect(a).toEqual(b)
    call('srand', 43)
    expect([call('rnd'), call('rnd'), call('rnd')]).not.toEqual(a)
  })
  it('the same seed gives the same sequence across instances', () => {
    const a = lib(FIXED, { seed: 7 })
    const b = lib(FIXED, { seed: 7 })
    expect([a.call('rnd'), a.call('rnd')]).toEqual([b.call('rnd'), b.call('rnd')])
  })
  it('srand(0) works', () => {
    call('srand', 0)
    const r = call('rnd')
    expect(r).toBeGreaterThanOrEqual(0)
    expect(r).toBeLessThan(1)
  })
  it('is roughly uniform', () => {
    call('srand', 5)
    let sum = 0
    for (let i = 0; i < 5000; i++) sum += call('rnd')
    expect(sum / 5000).toBeGreaterThan(0.45)
    expect(sum / 5000).toBeLessThan(0.55)
  })
})

describe('host functions and globals', () => {
  it('print forwards raw values to the host', () => {
    const seen = []
    const l = lib(FIXED, { print: (...a) => seen.push(a) })
    l.call('print', 'hi', 1, 2, 3)
    expect(seen).toEqual([['hi', 1, 2, 3]])
  })
  it('print without a host is harmless', () => {
    expect(() => call('print', 'x')).not.toThrow()
  })
  it('printh stringifies', () => {
    const seen = []
    const l = lib(FIXED, { printh: (s) => seen.push(s) })
    l.call('printh', 12)
    l.call('printh', undefined)
    expect(seen).toEqual(['12', '[nil]'])
  })
  it('time / t', () => {
    const l = lib(FIXED, { time: () => 1.5 })
    expect(l.call('time')).toBe(1.5)
    expect(l.call('t')).toBe(1.5)
    expect(call('time')).toBe(0)
  })
  it('button glyph constants', () => {
    expect(G.get('\x8b')).toBe(0) // left
    expect(G.get('\x91')).toBe(1) // right
    expect(G.get('\x94')).toBe(2) // up
    expect(G.get('\x83')).toBe(3) // down
    expect(G.get('\x8e')).toBe(4) // O
    expect(G.get('\x97')).toBe(5) // X
  })
  it('environments are independent', () => {
    const a = lib()
    const b = lib()
    a.G.set('x', 1)
    expect(b.G.get('x')).toBeUndefined()
  })
  it('no stray JS globals leak in', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'console', 'window', 'Math', 'eval', 'require']) {
      expect(G.get(name), name).toBeUndefined()
    }
  })
})
