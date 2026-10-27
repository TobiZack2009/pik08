import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { LuaTable } from '../../src/lua/table.js'
import { LuaError } from '../../src/lua/errors.js'

/** @param {LuaTable} t */
const entries = (t) => {
  const it = t.iterator()
  const out = []
  for (let r = it(); r; r = it()) out.push(r)
  return out
}
/** Table with array items. @param {any[]} items */
const arr = (...items) => new LuaTable(items)

describe('array part', () => {
  it('starts empty', () => {
    const t = new LuaTable()
    expect(t.length()).toBe(0)
    expect(t.get(1)).toBeUndefined()
  })
  it('appends via t[#t+1]', () => {
    const t = new LuaTable()
    t.set(1, 'a')
    t.set(2, 'b')
    t.set(3, 'c')
    expect(t.length()).toBe(3)
    expect([t.get(1), t.get(2), t.get(3)]).toEqual(['a', 'b', 'c'])
  })
  it('overwrites in place', () => {
    const t = arr(1, 2, 3)
    t.set(2, 'x')
    expect(t.get(2)).toBe('x')
    expect(t.length()).toBe(3)
  })
  it('index 0, negatives and fractions are not array keys', () => {
    const t = arr(1, 2, 3)
    t.set(0, 'zero')
    t.set(-1, 'neg')
    t.set(1.5, 'frac')
    expect(t.length()).toBe(3)
    expect(t.get(0)).toBe('zero')
    expect(t.get(-1)).toBe('neg')
    expect(t.get(1.5)).toBe('frac')
    expect(t.get(1)).toBe(1)
  })
  it('does not conflate -0 with 0 as keys (they are the same key)', () => {
    const t = new LuaTable()
    t.set(0, 'a')
    expect(t.get(-0)).toBe('a')
  })
  it('number and numeric-string keys are distinct', () => {
    const t = new LuaTable()
    t.set(1, 'num')
    t.set('1', 'str')
    expect(t.get(1)).toBe('num')
    expect(t.get('1')).toBe('str')
    expect(t.length()).toBe(1)
  })
})

describe('length with nil', () => {
  it('shrinks when the last element is set to nil', () => {
    const t = arr(1, 2, 3)
    t.set(3, undefined)
    expect(t.length()).toBe(2)
  })
  it('trims all trailing nils', () => {
    const t = arr(1, 2, 3)
    t.set(2, undefined)
    expect(t.length()).toBe(3) // hole in the middle keeps the border at 3
    t.set(3, undefined)
    expect(t.length()).toBe(1) // 3 and the hole at 2 both disappear
  })
  it('a nil hole in the middle keeps #t', () => {
    const t = arr(1, 2, 3)
    t.set(2, undefined)
    expect(t.length()).toBe(3)
    expect(t.get(2)).toBeUndefined()
    expect(t.get(3)).toBe(3)
  })
  it('constructor keeps middle holes, trims trailing ones', () => {
    expect(arr(1, undefined, 3).length()).toBe(3)
    expect(arr(1, undefined, undefined).length()).toBe(1)
    expect(arr(undefined, undefined).length()).toBe(0)
    expect(arr(undefined, 2).length()).toBe(2)
  })
  it('setting beyond the end with nil is a no-op', () => {
    const t = arr(1)
    t.set(5, undefined)
    t.set(2, undefined)
    expect(t.length()).toBe(1)
  })
  it('setting a gap key stores it aside without extending #t', () => {
    const t = arr(1, 2)
    t.set(5, 'five')
    expect(t.length()).toBe(2)
    expect(t.get(5)).toBe('five')
  })
  it('filling the gap migrates the stashed keys into the array', () => {
    const t = arr(1, 2)
    t.set(5, 'e')
    t.set(4, 'd')
    expect(t.length()).toBe(2)
    t.set(3, 'c')
    expect(t.length()).toBe(5)
    expect([3, 4, 5].map((i) => t.get(i))).toEqual(['c', 'd', 'e'])
  })
  it('filling the gap does not migrate past a missing key', () => {
    const t = arr(1)
    t.set(3, 'c')
    t.set(5, 'e')
    t.set(2, 'b')
    expect(t.length()).toBe(3)
    expect(t.get(5)).toBe('e')
  })
  it('stashed keys are removable', () => {
    const t = arr(1)
    t.set(10, 'x')
    t.set(10, undefined)
    expect(t.get(10)).toBeUndefined()
    expect(entries(t)).toEqual([[1, 1]])
  })
  it('reverse fill ends contiguous', () => {
    const t = new LuaTable()
    for (let i = 10; i >= 1; i--) t.set(i, i * 2)
    expect(t.length()).toBe(10)
    expect(t.get(7)).toBe(14)
  })
  it('false is a value, not nil', () => {
    const t = new LuaTable()
    t.set(1, false)
    expect(t.length()).toBe(1)
    expect(t.get(1)).toBe(false)
    t.set('k', false)
    expect(entries(t)).toEqual([[1, false], ['k', false]])
  })
  it('0 and empty string are values, not nil', () => {
    const t = arr(0, '', 0)
    expect(t.length()).toBe(3)
  })
})

describe('string keys', () => {
  it('get/set', () => {
    const t = new LuaTable()
    t.set('x', 1)
    t.set('y', 2)
    expect(t.get('x')).toBe(1)
    expect(t.getStr('y')).toBe(2)
    expect(t.get('z')).toBeUndefined()
  })
  it('prototype-ish names are ordinary keys', () => {
    const t = new LuaTable()
    expect(t.get('__proto__')).toBeUndefined()
    expect(t.get('constructor')).toBeUndefined()
    expect(t.get('toString')).toBeUndefined()
    expect(t.get('hasOwnProperty')).toBeUndefined()
    t.set('__proto__', 1)
    t.set('constructor', 2)
    t.set('toString', 3)
    expect(t.get('__proto__')).toBe(1)
    expect(t.get('constructor')).toBe(2)
    expect(t.get('toString')).toBe(3)
    expect(entries(t).map((e) => e[0])).toEqual(['__proto__', 'constructor', 'toString'])
  })
  it('empty-string key', () => {
    const t = new LuaTable()
    t.set('', 'e')
    expect(t.get('')).toBe('e')
  })
  it('setting nil removes from iteration and reads', () => {
    const t = new LuaTable()
    t.set('a', 1)
    t.set('b', 2)
    t.set('a', undefined)
    expect(t.get('a')).toBeUndefined()
    expect(entries(t)).toEqual([['b', 2]])
  })
  it('re-setting after nil works', () => {
    const t = new LuaTable()
    t.set('a', 1)
    t.set('a', undefined)
    t.set('a', 3)
    expect(t.get('a')).toBe(3)
    expect(entries(t)).toEqual([['a', 3]])
  })
  it('setting nil on a missing key creates nothing', () => {
    const t = new LuaTable()
    t.set('nope', undefined)
    expect(entries(t)).toEqual([])
  })
  it('tombstone sweeping keeps live data', () => {
    const t = new LuaTable()
    t.set('keep', 'me')
    for (let i = 0; i < 500; i++) {
      t.set('k' + i, i)
      t.set('k' + i, undefined)
    }
    expect(t.get('keep')).toBe('me')
    expect(entries(t)).toEqual([['keep', 'me']])
    expect(Object.keys(t.s).length).toBeLessThan(100)
  })
  it('can be built from a null-prototype object', () => {
    const s = Object.assign(Object.create(null), { x: 1, y: undefined, z: 3 })
    const t = new LuaTable([10], s)
    expect(entries(t)).toEqual([[1, 10], ['x', 1], ['z', 3]])
  })
  it('does not share the empty dictionary between tables', () => {
    const a = new LuaTable()
    const b = new LuaTable()
    a.set('x', 1)
    expect(b.get('x')).toBeUndefined()
    expect(() => b.set('y', 1)).not.toThrow()
    expect(a.get('y')).toBeUndefined()
  })
})

describe('other keys', () => {
  it('boolean keys', () => {
    const t = new LuaTable()
    t.set(true, 'yes')
    t.set(false, 'no')
    expect(t.get(true)).toBe('yes')
    expect(t.get(false)).toBe('no')
  })
  it('table and function keys use identity', () => {
    const k1 = new LuaTable()
    const k2 = new LuaTable()
    const f = () => {}
    const t = new LuaTable()
    t.set(k1, 1)
    t.set(k2, 2)
    t.set(f, 3)
    expect([t.get(k1), t.get(k2), t.get(f)]).toEqual([1, 2, 3])
    expect(t.get(new LuaTable())).toBeUndefined()
  })
  it('fractional and huge numeric keys', () => {
    const t = new LuaTable()
    t.set(0.5, 'half')
    t.set(2 ** 40, 'big')
    t.set(Infinity, 'inf')
    t.set(-Infinity, 'ninf')
    expect(t.get(0.5)).toBe('half')
    expect(t.get(2 ** 40)).toBe('big')
    expect(t.get(Infinity)).toBe('inf')
    expect(t.get(-Infinity)).toBe('ninf')
    expect(t.length()).toBe(0)
  })
  it('nil key: get is nil, set throws', () => {
    const t = new LuaTable()
    expect(t.get(undefined)).toBeUndefined()
    expect(() => t.set(undefined, 1)).toThrow(LuaError)
    expect(() => t.set(undefined, 1)).toThrow('table index is nil')
  })
  it('NaN key: get is nil, set throws', () => {
    const t = new LuaTable()
    expect(t.get(NaN)).toBeUndefined()
    expect(() => t.set(NaN, 1)).toThrow('table index is NaN')
  })
  it('setting nil with a nil key still throws', () => {
    expect(() => new LuaTable().set(undefined, undefined)).toThrow('table index is nil')
  })
  it('removal of other keys', () => {
    const t = new LuaTable()
    t.set(true, 1)
    t.set(true, undefined)
    expect(t.get(true)).toBeUndefined()
    expect(entries(t)).toEqual([])
  })
})

describe('push / insertAt / removeAt', () => {
  it('push appends and ignores nil', () => {
    const t = new LuaTable()
    t.push('a')
    t.push(undefined)
    t.push('b')
    expect(t.length()).toBe(2)
  })
  it('push migrates stashed keys', () => {
    const t = new LuaTable()
    t.set(2, 'b')
    t.push('a')
    expect(t.length()).toBe(2)
  })
  it('insertAt shifts up', () => {
    const t = arr('a', 'c')
    t.insertAt(2, 'b')
    expect(entries(t)).toEqual([[1, 'a'], [2, 'b'], [3, 'c']])
    t.insertAt(1, 'z')
    expect(t.get(1)).toBe('z')
    t.insertAt(5, 'end')
    expect(t.get(5)).toBe('end')
  })
  it('removeAt shifts down and returns the removed value', () => {
    const t = arr('a', 'b', 'c')
    expect(t.removeAt(2)).toBe('b')
    expect(entries(t)).toEqual([[1, 'a'], [2, 'c']])
    expect(t.removeAt(2)).toBe('c')
    expect(t.length()).toBe(1)
  })
  it('removeAt trims holes exposed at the end', () => {
    const t = arr('a', undefined, 'c')
    t.removeAt(3)
    expect(t.length()).toBe(1)
  })
})

describe('iteration (pairs)', () => {
  it('visits the array in order, then strings, then others', () => {
    const t = new LuaTable()
    t.set(true, 'b')
    t.set('x', 'sx')
    t.set(1, 'one')
    t.set(2, 'two')
    t.set(0.5, 'half')
    expect(entries(t)).toEqual([[1, 'one'], [2, 'two'], ['x', 'sx'], [true, 'b'], [0.5, 'half']])
  })
  it('skips nil holes', () => {
    expect(entries(arr(1, undefined, 3))).toEqual([[1, 1], [3, 3]])
  })
  it('empty table', () => {
    expect(entries(new LuaTable())).toEqual([])
  })
  it('keeps returning end after the end', () => {
    const t = arr(1)
    const it = t.iterator()
    it()
    expect(it()).toBeUndefined()
    expect(it()).toBeUndefined()
  })
  it('tolerates clearing the current entry', () => {
    const t = new LuaTable()
    for (const k of ['a', 'b', 'c', 'd']) t.set(k, k)
    t.set(1, 1)
    t.set(2, 2)
    const seen = []
    const it = t.iterator()
    for (let r = it(); r; r = it()) {
      seen.push(r[0])
      t.set(r[0], undefined)
    }
    expect(seen).toEqual([1, 2, 'a', 'b', 'c', 'd'])
    expect(entries(t)).toEqual([])
  })
  it('tolerates clearing not-yet-visited entries', () => {
    const t = new LuaTable()
    t.set('a', 1)
    t.set('b', 2)
    t.set('c', 3)
    const seen = []
    const it = t.iterator()
    for (let r = it(); r; r = it()) {
      seen.push(r[0])
      t.set('c', undefined)
    }
    expect(seen).toEqual(['a', 'b'])
  })
  it('tolerates modifying values', () => {
    const t = arr(1, 2, 3)
    const it = t.iterator()
    for (let r = it(); r; r = it()) t.set(r[0], r[1] * 10)
    expect(entries(t)).toEqual([[1, 10], [2, 20], [3, 30]])
  })
  it('sees entries with false values', () => {
    const t = new LuaTable()
    t.set('f', false)
    expect(entries(t)).toEqual([['f', false]])
  })
})

describe('next', () => {
  it('starts at the beginning with nil', () => {
    expect(arr('a').next(undefined)).toEqual([1, 'a'])
    expect(new LuaTable().next(undefined)).toBeUndefined()
  })
  it('walks every entry exactly once', () => {
    const t = arr(1, 2)
    t.set('x', 'sx')
    t.set('y', 'sy')
    t.set(true, 't')
    t.set(2.5, 'f')
    const seen = []
    for (let r = t.next(undefined); r; r = t.next(r[0])) seen.push(r[0])
    expect(seen).toEqual([1, 2, 'x', 'y', true, 2.5])
  })
  it('skips holes', () => {
    const t = arr(1, undefined, 3)
    expect(t.next(1)).toEqual([3, 3])
    expect(t.next(3)).toBeUndefined()
  })
  it('skips tombstones but accepts a tombstoned key as the cursor', () => {
    const t = new LuaTable()
    t.set('a', 1)
    t.set('b', 2)
    t.set('c', 3)
    t.set('b', undefined)
    expect(t.next('a')).toEqual(['c', 3])
    expect(t.next('b')).toEqual(['c', 3])
  })
  it('errors on a key that is not in the table', () => {
    const t = arr(1)
    expect(() => t.next('nope')).toThrow("invalid key to 'next'")
    expect(() => t.next(true)).toThrow("invalid key to 'next'")
  })
  it('ends after the last array index when nothing else follows', () => {
    expect(arr(1, 2).next(2)).toBeUndefined()
  })
})

describe('model-based property test', () => {
  const key = fc.oneof(
    fc.integer({ min: -3, max: 12 }),
    fc.constantFrom('a', 'b', 'c', '1', '', '__proto__'),
    fc.constantFrom(0.5, -0.5, 2 ** 33, true, false),
  )
  const op = fc.record({ k: key, v: fc.option(fc.integer({ min: 0, max: 99 }), { nil: undefined }) })

  it('behaves like a Map for any sequence of sets', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 80 }), (ops) => {
        const t = new LuaTable()
        /** @type {Map<any, any>} */
        const model = new Map()
        for (const { k, v } of ops) {
          t.set(k, v)
          if (v === undefined) model.delete(k)
          else model.set(k, v)
        }
        // every key reads back correctly
        for (const k of new Set(ops.map((o) => o.k))) expect(t.get(k)).toBe(model.get(k))
        // iteration yields exactly the model's entries
        const got = new Map(entries(t))
        expect(got.size).toBe(model.size)
        for (const [k, v] of model) expect(got.get(k)).toBe(v)
        // the length is a border: t[n] non-nil (or n = 0) and t[n+1] nil
        const n = t.length()
        expect(n === 0 || model.has(n)).toBe(true)
        expect(model.has(n + 1)).toBe(false)
        // next() walks the same set of entries
        const viaNext = new Map()
        for (let r = t.next(undefined); r; r = t.next(r[0])) viaNext.set(r[0], r[1])
        expect(viaNext).toEqual(got)
      }),
      { numRuns: 400 },
    )
  })
})
