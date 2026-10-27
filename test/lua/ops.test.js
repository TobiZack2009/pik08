import { describe, expect, it } from 'vitest'
import { FIXED, FLOAT } from '../../src/lua/numbers.js'
import { createOps } from '../../src/lua/ops.js'
import { LuaTable } from '../../src/lua/table.js'
import { LuaError } from '../../src/lua/errors.js'
import { first } from '../../src/lua/values.js'

const o = createOps(FIXED)
const f = createOps(FLOAT)

/** Table from a plain object with string keys. @param {Record<string, any>} obj @param {any[]} [array] */
const T = (obj = {}, array = []) => {
  const t = new LuaTable(array)
  for (const [k, v] of Object.entries(obj)) t.set(k, v)
  return t
}
/** Table with a metatable. @param {Record<string, any>} meta @param {Record<string, any>} [obj] */
const withMeta = (meta, obj = {}) => {
  const t = T(obj)
  t.meta = T(meta)
  return t
}
/** @param {() => any} fn @param {string | RegExp} msg */
const throwsLua = (fn, msg) => {
  expect(fn).toThrow(LuaError)
  expect(fn).toThrow(msg)
}

describe('arithmetic', () => {
  it('uses the number model', () => {
    expect(o.add(32767, 1)).toBe(-32768)
    expect(f.add(32767, 1)).toBe(32768)
    expect(o.div(1, 0)).toBeGreaterThan(32767)
    expect(f.div(1, 0)).toBe(Infinity)
    expect(o.mul(0.5, 4)).toBe(2)
  })
  it('coerces numeric strings', () => {
    expect(o.add('10', 1)).toBe(11)
    expect(o.add(1, '0x10')).toBe(17)
    expect(o.mul('2', '3')).toBe(6)
    expect(o.add(' 5 ', 0)).toBe(5)
    expect(o.unm('3')).toBe(-3)
  })
  it('rejects non-numeric operands with Lua-style messages', () => {
    throwsLua(() => o.add(undefined, 1), 'attempt to perform arithmetic on a nil value')
    throwsLua(() => o.add(1, undefined), 'attempt to perform arithmetic on a nil value')
    throwsLua(() => o.add(true, 1), 'attempt to perform arithmetic on a boolean value')
    throwsLua(() => o.sub('abc', 1), 'attempt to perform arithmetic on a string value')
    throwsLua(() => o.mul(new LuaTable(), 2), 'attempt to perform arithmetic on a table value')
    throwsLua(() => o.mod(() => {}, 2), 'attempt to perform arithmetic on a function value')
    throwsLua(() => o.unm(undefined), 'attempt to perform arithmetic on a nil value')
    throwsLua(() => o.add('', 1), 'attempt to perform arithmetic on a string value')
  })
  it('blames the operand that is not a number', () => {
    throwsLua(() => o.add(1, true), 'boolean value')
    throwsLua(() => o.add(true, 1), 'boolean value')
    throwsLua(() => o.add(undefined, true), 'nil value') // first bad operand
  })
  it('bitwise operators', () => {
    expect(o.band(5, 3)).toBe(1)
    expect(o.shl(1, 3)).toBe(8)
    expect(o.bnot(0)).toBe(-1 / 65536)
    expect(o.band('5', 3)).toBe(1)
    throwsLua(() => o.band(undefined, 1), 'attempt to perform bitwise operation on a nil value')
    throwsLua(() => o.bnot(undefined), 'attempt to perform bitwise operation on a nil value')
  })
})

describe('arithmetic metamethods', () => {
  it('__add on the left operand', () => {
    const a = withMeta({ __add: (x, y) => 'added' })
    expect(o.add(a, 1)).toBe('added')
  })
  it('__add on the right operand', () => {
    const a = withMeta({ __add: (x, y) => [x === 1, first(y) === a] })
    expect(first(o.add(1, a))).toBe(true) // returns multi-value array, first value used
  })
  it('left metamethod wins over right', () => {
    const a = withMeta({ __add: () => 'left' })
    const b = withMeta({ __add: () => 'right' })
    expect(o.add(a, b)).toBe('left')
  })
  it('metamethod gets both operands in order', () => {
    const seen = []
    const a = withMeta({ __sub: (x, y) => seen.push(x, y) })
    const b = new LuaTable()
    o.sub(b, a)
    expect(seen).toEqual([b, a])
  })
  it('only the first result of a metamethod is used', () => {
    const a = withMeta({ __mul: () => [1, 2, 3] })
    expect(o.mul(a, a)).toBe(1)
    const none = withMeta({ __mul: () => [] })
    expect(o.mul(none, none)).toBeUndefined()
  })
  it('every arithmetic operator dispatches', () => {
    for (const [op, ev] of /** @type {const} */ ([
      ['add', '__add'], ['sub', '__sub'], ['mul', '__mul'], ['div', '__div'], ['idiv', '__idiv'],
      ['mod', '__mod'], ['pow', '__pow'], ['band', '__band'], ['bor', '__bor'], ['bxor', '__bxor'],
      ['shl', '__shl'], ['shr', '__shr'],
    ])) {
      expect(o[op](withMeta({ [ev]: () => ev }), 1), ev).toBe(ev)
    }
  })
  it('__unm', () => {
    const a = withMeta({ __unm: () => 'negated' })
    expect(o.unm(a)).toBe('negated')
  })
  it('metamethod can be a callable table', () => {
    const callable = withMeta({ __call: (self, x, y) => 'called' })
    expect(o.add(withMeta({ __add: callable }), 1)).toBe('called')
  })
  it('a non-function metamethod value errors on use', () => {
    throwsLua(() => o.add(withMeta({ __add: 5 }), 1), 'attempt to call a number value')
  })
  it('a plain table without metatable errors', () => {
    throwsLua(() => o.add(new LuaTable(), 1), 'attempt to perform arithmetic on a table value')
  })
  it('numbers win over string coercion (no metamethod needed)', () => {
    expect(o.add('1', '2')).toBe(3)
  })
})

describe('comparison', () => {
  it('numbers and strings', () => {
    expect(o.lt(1, 2)).toBe(true)
    expect(o.lt(2, 2)).toBe(false)
    expect(o.le(2, 2)).toBe(true)
    expect(o.lt('a', 'b')).toBe(true)
    expect(o.lt('a', 'B')).toBe(false)
    expect(o.lt('Z', 'a')).toBe(true)
    expect(o.lt('', 'a')).toBe(true)
    expect(o.lt('a', 'ab')).toBe(true)
    expect(o.lt('10', '9')).toBe(true) // lexicographic, no coercion
    expect(o.le('b', 'a')).toBe(false)
  })
  it('compares bytes, not UTF-16 collation', () => {
    expect(o.lt('\x7f', '\x80')).toBe(true)
    expect(o.lt('\xff', 'a')).toBe(false)
  })
  it('refuses mixed and non-comparable types', () => {
    throwsLua(() => o.lt(1, '2'), 'attempt to compare number with string')
    throwsLua(() => o.lt('1', 2), 'attempt to compare string with number')
    throwsLua(() => o.lt(undefined, 1), 'attempt to compare nil with number')
    throwsLua(() => o.lt(1, undefined), 'attempt to compare number with nil')
    throwsLua(() => o.le(true, false), 'attempt to compare two boolean values')
    throwsLua(() => o.lt(new LuaTable(), new LuaTable()), 'attempt to compare two table values')
    throwsLua(() => o.lt(undefined, undefined), 'attempt to compare two nil values')
    throwsLua(() => o.lt(new LuaTable(), 1), 'attempt to compare table with number')
  })
  it('NaN compares false both ways', () => {
    expect(f.lt(NaN, 1)).toBe(false)
    expect(f.lt(1, NaN)).toBe(false)
    expect(f.le(NaN, NaN)).toBe(false)
    expect(f.eq(NaN, NaN)).toBe(false)
  })
  it('__lt and __le', () => {
    const mk = (n) => withMeta({ __lt: (a, b) => a.get('n') < b.get('n'), __le: (a, b) => a.get('n') <= b.get('n') }, { n })
    expect(o.lt(mk(1), mk(2))).toBe(true)
    expect(o.lt(mk(2), mk(1))).toBe(false)
    expect(o.le(mk(2), mk(2))).toBe(true)
  })
  it('__lt result is converted to a boolean', () => {
    const t = withMeta({ __lt: () => 'yes' })
    expect(o.lt(t, t)).toBe(true)
    const u = withMeta({ __lt: () => undefined })
    expect(o.lt(u, u)).toBe(false)
    const z = withMeta({ __lt: () => 0 })
    expect(o.lt(z, z)).toBe(true) // 0 is truthy in Lua
  })
  it('__lt works across a table and a number', () => {
    const t = withMeta({ __lt: (a, b) => (typeof b === 'number' ? true : false) })
    expect(o.lt(t, 5)).toBe(true)
  })
  it('there is no __le fallback to __lt', () => {
    const t = withMeta({ __lt: () => true })
    throwsLua(() => o.le(t, t), 'attempt to compare two table values')
  })
})

describe('equality', () => {
  it('primitive equality never coerces', () => {
    expect(o.eq(1, 1)).toBe(true)
    expect(o.eq(1, '1')).toBe(false)
    expect(o.eq('a', 'a')).toBe(true)
    expect(o.eq(undefined, undefined)).toBe(true)
    expect(o.eq(undefined, false)).toBe(false)
    expect(o.eq(0, false)).toBe(false)
    expect(o.eq('', false)).toBe(false)
    expect(o.eq(true, true)).toBe(true)
  })
  it('tables compare by identity', () => {
    const a = new LuaTable()
    expect(o.eq(a, a)).toBe(true)
    expect(o.eq(a, new LuaTable())).toBe(false)
  })
  it('__eq is used for two distinct tables', () => {
    const mt = T({ __eq: (a, b) => a.get('id') === b.get('id') })
    const a = T({ id: 1 })
    const b = T({ id: 1 })
    const c = T({ id: 2 })
    a.meta = mt
    b.meta = mt
    c.meta = mt
    expect(o.eq(a, b)).toBe(true)
    expect(o.eq(a, c)).toBe(false)
  })
  it('__eq is found on either operand', () => {
    const a = withMeta({ __eq: () => true })
    expect(o.eq(a, new LuaTable())).toBe(true)
    expect(o.eq(new LuaTable(), a)).toBe(true)
  })
  it('__eq is not consulted for a table and a non-table', () => {
    const a = withMeta({ __eq: () => true })
    expect(o.eq(a, 1)).toBe(false)
    expect(o.eq(a, undefined)).toBe(false)
  })
  it('__eq is not consulted for identical tables', () => {
    let called = false
    const a = withMeta({ __eq: () => ((called = true), false) })
    expect(o.eq(a, a)).toBe(true)
    expect(called).toBe(false)
  })
})

describe('concat', () => {
  it('joins strings and numbers', () => {
    expect(o.concat('a', 'b')).toBe('ab')
    expect(o.concat('x', 1)).toBe('x1')
    expect(o.concat(1, 2)).toBe('12')
    expect(o.concat('', '')).toBe('')
    expect(o.concat(0.5, 'x')).toBe('0.5x')
  })
  it('formats numbers by model', () => {
    expect(o.concat('v=', 21845 / 65536)).toBe('v=0.3333')
    expect(f.concat('v=', 1 / 3)).toBe('v=0.33333333333333')
  })
  it('rejects nil, booleans, tables, functions', () => {
    throwsLua(() => o.concat('a', undefined), 'attempt to concatenate a nil value')
    throwsLua(() => o.concat(undefined, 'a'), 'attempt to concatenate a nil value')
    throwsLua(() => o.concat('a', true), 'attempt to concatenate a boolean value')
    throwsLua(() => o.concat(new LuaTable(), 'a'), 'attempt to concatenate a table value')
    throwsLua(() => o.concat('a', () => {}), 'attempt to concatenate a function value')
    throwsLua(() => o.concat(1, false), 'attempt to concatenate a boolean value')
  })
  it('__concat', () => {
    const t = withMeta({ __concat: (a, b) => 'cat' })
    expect(o.concat(t, 'x')).toBe('cat')
    expect(o.concat('x', t)).toBe('cat')
    expect(o.concat(1, t)).toBe('cat')
  })
})

describe('length', () => {
  it('strings and tables', () => {
    expect(o.len('')).toBe(0)
    expect(o.len('hello')).toBe(5)
    expect(o.len(new LuaTable([1, 2, 3]))).toBe(3)
    expect(o.len(new LuaTable())).toBe(0)
  })
  it('counts p8str bytes, not code points', () => {
    expect(o.len('\x80\x81')).toBe(2)
  })
  it('__len', () => {
    expect(o.len(withMeta({ __len: () => 42 }))).toBe(42)
  })
  it('errors on other types', () => {
    throwsLua(() => o.len(undefined), 'attempt to get length of a nil value')
    throwsLua(() => o.len(5), 'attempt to get length of a number value')
    throwsLua(() => o.len(true), 'attempt to get length of a boolean value')
  })
})

describe('index', () => {
  it('reads raw fields', () => {
    const t = T({ x: 1 }, [10, 20])
    expect(o.index(t, 'x')).toBe(1)
    expect(o.indexStr(t, 'x')).toBe(1)
    expect(o.index(t, 2)).toBe(20)
    expect(o.index(t, 'missing')).toBeUndefined()
    expect(o.index(t, 3)).toBeUndefined()
    expect(o.index(t, undefined)).toBeUndefined()
  })
  it('errors on non-indexable values, with a description', () => {
    throwsLua(() => o.index(undefined, 'x'), 'attempt to index a nil value')
    throwsLua(() => o.index(5, 'x'), 'attempt to index a number value')
    throwsLua(() => o.index(true, 'x'), 'attempt to index a boolean value')
    throwsLua(() => o.index(() => {}, 'x'), 'attempt to index a function value')
    throwsLua(() => o.index(undefined, 'x', "local 'p'"), "attempt to index a nil value (local 'p')")
    throwsLua(() => o.indexStr(undefined, 'x', "field 'y'"), "attempt to index a nil value (field 'y')")
  })
  it('indexes strings by position', () => {
    expect(o.index('abc', 1)).toBe('a')
    expect(o.index('abc', 3)).toBe('c')
    expect(o.index('abc', 4)).toBeUndefined()
    expect(o.index('abc', 0)).toBeUndefined()
    expect(o.index('abc', -1)).toBeUndefined()
    expect(o.index('abc', 1.5)).toBeUndefined()
    expect(o.index('abc', 'len')).toBeUndefined()
  })
  it('__index table chain', () => {
    const base = T({ greet: 'hi' })
    const mid = withMeta({ __index: base }, { own: 1 })
    const obj = withMeta({ __index: mid })
    expect(o.indexStr(obj, 'greet')).toBe('hi')
    expect(o.indexStr(obj, 'own')).toBe(1)
    expect(o.indexStr(obj, 'nope')).toBeUndefined()
  })
  it('own fields shadow __index', () => {
    const obj = withMeta({ __index: T({ x: 'base' }) }, { x: 'own' })
    expect(o.indexStr(obj, 'x')).toBe('own')
  })
  it('a false own field still shadows __index', () => {
    const obj = withMeta({ __index: T({ x: 'base' }) }, { x: false })
    expect(o.indexStr(obj, 'x')).toBe(false)
  })
  it('__index function receives table and key; first result only', () => {
    const seen = []
    const obj = withMeta({ __index: (t, k) => (seen.push([t, k]), [k + '!', 'extra']) })
    expect(o.index(obj, 'foo')).toBe('foo!')
    expect(seen).toEqual([[obj, 'foo']])
  })
  it('__index function returning nothing gives nil', () => {
    expect(o.index(withMeta({ __index: () => [] }), 'x')).toBeUndefined()
  })
  it('__index not consulted when the field exists', () => {
    let called = false
    const obj = withMeta({ __index: () => ((called = true), 1) }, { x: 5 })
    o.index(obj, 'x')
    expect(called).toBe(false)
  })
  it('__index as a string indexes the string', () => {
    expect(o.index(withMeta({ __index: 'abc' }), 2)).toBe('b')
  })
  it('__index of a non-indexable value errors', () => {
    throwsLua(() => o.index(withMeta({ __index: 5 }), 'x'), 'attempt to index a number value')
  })
  it('detects __index loops', () => {
    const a = new LuaTable()
    a.meta = T({ __index: a })
    throwsLua(() => o.index(a, 'x'), 'loop in gettable')
  })
  it('a metatable without __index is harmless', () => {
    expect(o.index(withMeta({ __call: () => 1 }), 'x')).toBeUndefined()
  })
  it('metatable with numeric keys via __index table', () => {
    const obj = withMeta({ __index: T({}, ['a', 'b']) })
    expect(o.index(obj, 2)).toBe('b')
  })
})

describe('setindex', () => {
  it('writes raw fields', () => {
    const t = new LuaTable()
    o.setindex(t, 'x', 1)
    o.setindex(t, 1, 'one')
    expect(t.get('x')).toBe(1)
    expect(t.get(1)).toBe('one')
  })
  it('errors on non-tables', () => {
    throwsLua(() => o.setindex(undefined, 'x', 1), 'attempt to index a nil value')
    throwsLua(() => o.setindex(5, 'x', 1), 'attempt to index a number value')
    throwsLua(() => o.setindex('str', 'x', 1), 'attempt to index a string value')
    throwsLua(() => o.setindex(undefined, 'x', 1, "global 'g'"), "attempt to index a nil value (global 'g')")
  })
  it('nil and NaN keys error', () => {
    throwsLua(() => o.setindex(new LuaTable(), undefined, 1), 'table index is nil')
    throwsLua(() => o.setindex(new LuaTable(), NaN, 1), 'table index is NaN')
  })
  it('__newindex function is called for absent keys only', () => {
    const calls = []
    const t = withMeta({ __newindex: (tbl, k, v) => calls.push([k, v]) }, { present: 1 })
    o.setindex(t, 'absent', 2)
    o.setindex(t, 'present', 3)
    expect(calls).toEqual([['absent', 2]])
    expect(t.get('absent')).toBeUndefined()
    expect(t.get('present')).toBe(3)
  })
  it('__newindex table redirects the write', () => {
    const store = new LuaTable()
    const t = withMeta({ __newindex: store })
    o.setindex(t, 'x', 1)
    expect(store.get('x')).toBe(1)
    expect(t.get('x')).toBeUndefined()
  })
  it('__newindex table chain honours the target metatable', () => {
    const log = []
    const inner = withMeta({ __newindex: (t, k, v) => log.push([k, v]) })
    const outer = withMeta({ __newindex: inner })
    o.setindex(outer, 'k', 'v')
    expect(log).toEqual([['k', 'v']])
  })
  it('rawset bypasses it (via LuaTable.set)', () => {
    const t = withMeta({ __newindex: () => { throw new Error('no') } })
    t.set('x', 1)
    expect(t.get('x')).toBe(1)
  })
  it('detects __newindex loops', () => {
    const a = new LuaTable()
    a.meta = T({ __newindex: a })
    throwsLua(() => o.setindex(a, 'x', 1), 'loop in settable')
  })
  it('setting an existing key to nil does not use __newindex', () => {
    const t = withMeta({ __newindex: () => { throw new Error('no') } }, { x: 1 })
    o.setindex(t, 'x', undefined)
    expect(t.get('x')).toBeUndefined()
  })
  it('__index and __newindex together make a proxy', () => {
    const store = T({ a: 1 })
    const proxy = withMeta({ __index: store, __newindex: store })
    o.setindex(proxy, 'b', 2)
    expect(o.index(proxy, 'a')).toBe(1)
    expect(o.index(proxy, 'b')).toBe(2)
    expect(store.get('b')).toBe(2)
  })
})

describe('call', () => {
  it('returns functions unchanged', () => {
    const fn = () => 1
    expect(o.call(fn)).toBe(fn)
  })
  it('errors with descriptions', () => {
    throwsLua(() => o.call(undefined), 'attempt to call a nil value')
    throwsLua(() => o.call(undefined, "global 'foo'"), "attempt to call a nil value (global 'foo')")
    throwsLua(() => o.call(5), 'attempt to call a number value')
    throwsLua(() => o.call('x', "field 'f'"), "attempt to call a string value (field 'f')")
    throwsLua(() => o.call(new LuaTable()), 'attempt to call a table value')
    throwsLua(() => o.call(true), 'attempt to call a boolean value')
  })
  it('__call forwards with the table as the first argument', () => {
    const seen = []
    const t = withMeta({ __call: (self, ...args) => (seen.push(self, ...args), 'r') })
    expect(o.call(t)(1, 2)).toBe('r')
    expect(seen).toEqual([t, 1, 2])
  })
  it('__call can itself be a callable table', () => {
    const inner = withMeta({ __call: (self, outer, x) => ['inner', self === inner, x] })
    const t = withMeta({ __call: inner })
    expect(o.call(t)(9)).toEqual(['inner', true, 9])
  })
})

describe('tostr', () => {
  it('primitives', () => {
    expect(o.tostr('x')).toBe('x')
    expect(o.tostr(1.5)).toBe('1.5')
    expect(o.tostr(true)).toBe('true')
    expect(o.tostr(false)).toBe('false')
    expect(o.tostr(undefined)).toBe('[nil]')
    expect(o.tostr(() => {})).toBe('[function]')
    expect(o.tostr(new LuaTable())).toBe('[table]')
  })
  it('__tostring', () => {
    expect(o.tostr(withMeta({ __tostring: () => 'custom' }))).toBe('custom')
    expect(o.tostr(withMeta({ __tostring: () => 42 }))).toBe('42')
  })
  it('number formatting follows the model', () => {
    expect(o.tostr(21845 / 65536)).toBe('0.3333')
    expect(f.tostr(1 / 3)).toBe('0.33333333333333')
  })
})
