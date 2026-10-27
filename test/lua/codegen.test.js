import { describe, expect, it } from 'vitest'
import { compile } from '../../src/lua/compile.js'
import { LuaSyntaxError } from '../../src/lua/errors.js'
import { lua } from '../helpers/lua-run.js'

describe.each(['fixed', 'float'])('codegen (%s numbers)', (model) => {
  const { vals, val, out, fail } = lua(/** @type {'fixed' | 'float'} */ (model))

  describe('basics', () => {
    it('returns nothing, one or many values', () => {
      expect(vals('')).toEqual([])
      expect(vals('return')).toEqual([])
      expect(vals('return 1')).toEqual([1])
      expect(vals('return 1, 2, 3')).toEqual([1, 2, 3])
      expect(vals('return nil')).toEqual([undefined])
      expect(vals('return nil, nil')).toEqual([undefined, undefined])
    })

    it('evaluates literals', () => {
      expect(vals('return true, false, nil, 7, "hi", 0.5, 0x10, 0b11')).toEqual([true, false, undefined, 7, 'hi', 0.5, 16, 3])
      expect(val('return -3')).toBe(-3)
      expect(val('return - -3')).toBe(3)
      expect(val('return 1 - -1')).toBe(2)
    })

    it('handles string escapes and glyph bytes', () => {
      expect(val('return "a\\nb"')).toBe('a\nb')
      expect(val('return "q\\"q"')).toBe('q"q')
      expect(val('return "back\\\\slash"')).toBe('back\\slash')
      expect(val('return "\\65\\x42"')).toBe('AB')
      expect(val('return #"\\0\\0"')).toBe(2)
      expect(val('return "\\255"')).toBe('\xff')
    })

    it('does arithmetic with precedence', () => {
      expect(val('return 1 + 2 * 3')).toBe(7)
      expect(val('return (1 + 2) * 3')).toBe(9)
      expect(val('return 2 ^ 3 ^ 2')).toBe(512)
      expect(val('return -2 ^ 2')).toBe(-4)
      expect(val('return 7 \\ 2')).toBe(3)
      expect(val('return -7 \\ 2')).toBe(-4)
      expect(val('return 7 % 3')).toBe(1)
      expect(val('return -7 % 3')).toBe(2)
      expect(val('return 7 / 2')).toBe(3.5)
    })

    it('does bitwise operators', () => {
      expect(val('return 5 & 3')).toBe(1)
      expect(val('return 5 | 3')).toBe(7)
      expect(val('return 5 ^^ 3')).toBe(6)
      expect(val('return 1 << 4')).toBe(16)
      expect(val('return 256 >> 4')).toBe(16)
      expect(val('return ~0')).toBe(-1 / 65536)
      expect(val('return 5 ~ 3')).toBe(6)
    })

    it('concatenates strings and numbers', () => {
      expect(val('return "a" .. "b" .. "c"')).toBe('abc')
      expect(val('return "n" .. 1')).toBe('n1')
      expect(val('return 1 .. 2')).toBe('12')
      expect(val('return "x" .. 1 + 2')).toBe('x3')
    })

    it('compares', () => {
      expect(vals('return 1 < 2, 2 < 1, 1 <= 1, 2 > 1, 1 >= 2')).toEqual([true, false, true, true, false])
      expect(vals('return "a" < "b", "b" < "a", "a" == "a", "a" ~= "b", "a" != "a"')).toEqual([true, false, true, true, false])
      expect(vals('return 1 == 1, 1 == "1", nil == false, 0 == false, "" == false')).toEqual([true, false, false, false, false])
    })
  })

  describe('truthiness', () => {
    it('only nil and false are falsy', () => {
      const t = (/** @type {string} */ c) => val(`if ${c} then return "yes" else return "no" end`)
      expect(t('nil')).toBe('no')
      expect(t('false')).toBe('no')
      expect(t('0')).toBe('yes')
      expect(t('""')).toBe('yes')
      expect(t('{}')).toBe('yes')
      expect(t('true')).toBe('yes')
      expect(t('print')).toBe('yes')
    })

    it('not returns a boolean', () => {
      expect(vals('return not nil, not false, not 0, not "", not {}, not not nil')).toEqual([true, true, false, false, false, false])
    })

    it('and / or return operands', () => {
      expect(vals('return 1 and 2, nil and 2, false and 2, 1 or 2, nil or 2, false or nil, nil or false')).toEqual([2, undefined, false, 1, 2, undefined, false])
      expect(vals('return 0 and "zero", "" or "empty"')).toEqual(['zero', ''])
      expect(val('local x = nil return x and x.y')).toBe(undefined)
      expect(val('local x = nil return x or 5')).toBe(5)
      expect(val('local x = false return x or nil')).toBe(undefined)
    })

    it('and / or short circuit', () => {
      expect(val('n = 0 local function f() n += 1 return true end local _ = false and f() _ = true or f() return n')).toBe(0)
      expect(val('n = 0 local function f() n += 1 return true end local _ = true and f() _ = false or f() return n')).toBe(2)
    })

    it('chains a and b or c like a ternary', () => {
      expect(val('local x = 5 return x > 3 and "big" or "small"')).toBe('big')
      expect(val('local x = 1 return x > 3 and "big" or "small"')).toBe('small')
      // classic pitfall: a false middle value falls through to c
      expect(val('return true and false or "c"')).toBe('c')
      expect(val('return true and nil or "c"')).toBe('c')
    })

    it('uses and/or in conditions', () => {
      expect(val('local a, b = 1, nil if a and b then return 1 elseif a or b then return 2 end return 3')).toBe(2)
      expect(val('local a = nil if not a and not false then return "ok" end')).toBe('ok')
      expect(val('local n = 0 while n < 3 and true do n += 1 end return n')).toBe(3)
    })

    it('evaluates a condition with a side-effecting call once', () => {
      expect(val('n = 0 local function f() n += 1 return 1 end if f() then end return n')).toBe(1)
      expect(val('n = 0 local function f() n += 1 return nil end local x = f() or f() return n')).toBe(2)
    })
  })

  describe('locals and scope', () => {
    it('shadows locals', () => {
      expect(val('local x = 1 local x = x + 1 return x')).toBe(2)
      expect(val('local x = 1 do local x = 2 end return x')).toBe(1)
      expect(val('local x = 1 do local x = x + 10 return x end')).toBe(11)
    })

    it('local without value is nil; extra values are dropped, missing ones are nil', () => {
      expect(vals('local a, b, c = 1, 2 return a, b, c')).toEqual([1, 2, undefined])
      expect(vals('local a = 1, 2, 3 return a')).toEqual([1])
      expect(val('local a local b = a return b')).toBe(undefined)
    })

    it('evaluates dropped extra values', () => {
      expect(val('n = 0 local function f() n += 1 end local a = 1, f(), f() return n')).toBe(2)
    })

    it('reads undefined globals as nil and writes globals', () => {
      expect(val('return undefined_thing')).toBe(undefined)
      expect(val('x = 5 return x')).toBe(5)
      expect(val('x = 5 x = nil return x')).toBe(undefined)
      expect(val('_G.y = 3 return y')).toBe(3)
      expect(val('y = 4 return _G.y')).toBe(4)
      expect(val('return _G._G == _G')).toBe(true)
      expect(val('_G["a b"] = 1 return _G["a b"]')).toBe(1)
    })

    it('handles global names that are awkward in JS', () => {
      expect(val('constructor = 1 return constructor')).toBe(1)
      expect(val('__proto__ = 2 return __proto__')).toBe(2)
      expect(val('toString = 3 return toString')).toBe(3)
      expect(val('hasOwnProperty = 4 return hasOwnProperty')).toBe(4)
      expect(val('return rawget(_G, "__proto__")')).toBe(undefined)
      expect(val('local class, var, let, new, this = 1, 2, 3, 4, 5 return class + var + let + new + this')).toBe(15)
    })

    it('handles locals named like generated names', () => {
      expect(val('local a_1, a, _1 = 1, 2, 3 return a_1 + a + _1')).toBe(6)
      expect(val('local t1, r1, va, s, G = 1, 2, 3, 4, 5 return t1 + r1 + va + s + G')).toBe(15)
    })

    it('supports glyph identifiers', () => {
      expect(val('local \x80 = 5 return \x80 * 2')).toBe(10)
      expect(val('\x8a = 3 return \x8a')).toBe(3)
    })

    it('has the button glyph constants', () => {
      expect(vals('return \x8b, \x91, \x94, \x83, \x8e, \x97')).toEqual([0, 1, 2, 3, 4, 5])
    })
  })

  describe('assignment', () => {
    it('swaps with multiple assignment', () => {
      expect(vals('local a, b = 1, 2 a, b = b, a return a, b')).toEqual([2, 1])
      expect(vals('a, b = 1, 2 a, b = b, a return a, b')).toEqual([2, 1])
      expect(vals('local t = {1, 2} t[1], t[2] = t[2], t[1] return t[1], t[2]')).toEqual([2, 1])
    })

    it('evaluates all right-hand sides before assigning', () => {
      expect(vals('local i = 1 local a = {} i, a[i] = i + 1, 20 return i, a[1], a[2]')).toEqual([2, 20, undefined])
    })

    it('fills missing targets with nil and drops extra values', () => {
      expect(vals('local a, b, c = 1, 2, 3 a, b, c = 9 return a, b, c')).toEqual([9, undefined, undefined])
      expect(vals('local a, b = 1, 2 a, b = 7, 8, 9 return a, b')).toEqual([7, 8])
    })

    it('expands multi-values in the last position', () => {
      expect(vals('local function f() return 1, 2, 3 end local a, b, c, d = f() return a, b, c, d')).toEqual([1, 2, 3, undefined])
      expect(vals('local function f() return 1, 2, 3 end local a, b, c, d = 0, f() return a, b, c, d')).toEqual([0, 1, 2, 3])
      expect(vals('local function f() return 1, 2, 3 end local a, b = f(), 10 return a, b')).toEqual([1, 10])
      expect(vals('local function f() return 1, 2, 3 end local a, b = (f()) return a, b')).toEqual([1, undefined])
      expect(vals('local function f() return end local a, b = f() return a, b')).toEqual([undefined, undefined])
      expect(vals('local function f() return 1, 2 end x, y, z = f() return x, y, z')).toEqual([1, 2, undefined])
      expect(vals('local function f() return 1, 2 end local t = {} t.a, t.b = f() return t.a, t.b')).toEqual([1, 2])
    })

    it('assigns to fields with side effects once', () => {
      expect(val('n = 0 local function t() n += 1 return {} end t().x = 1 return n')).toBe(1)
      expect(val('n = 0 local t = {} local function k() n += 1 return "a" end t[k()] = 1 return n')).toBe(1)
    })

    it('supports compound assignment on every kind of target', () => {
      expect(val('local x = 1 x += 2 x *= 3 x -= 1 return x')).toBe(8)
      expect(val('g = 1 g += 4 g ..= "s" return g')).toBe('5s')
      expect(val('local t = {n = 1} t.n += 1 t.n *= 10 return t.n')).toBe(20)
      expect(val('local t = {5} t[1] -= 2 return t[1]')).toBe(3)
      expect(val('local x = 6 x \\= 4 return x')).toBe(1)
      expect(val('local x = 7 x %= 4 return x')).toBe(3)
      expect(val('local x = 2 x ^= 3 return x')).toBe(8)
      expect(val('local x = 6 x &= 3 x |= 8 x ^^= 1 return x')).toBe(11)
      expect(val('local x = 1 x <<= 3 x >>= 1 return x')).toBe(4)
      expect(val('local x = 1 x /= 4 return x')).toBe(0.25)
    })

    it('evaluates the target of a compound assignment once', () => {
      expect(vals('n = 0 local t = {x = 1} local function f() n += 1 return t end f().x += 1 return n, t.x')).toEqual([1, 2])
      expect(vals('n = 0 local t = {1} local function k() n += 1 return 1 end t[k()] += 5 return n, t[1]')).toEqual([1, 6])
    })

    it('treats += on a nil field as an error', () => {
      expect(fail('local t = {} t.n += 1').message).toBe("attempt to perform arithmetic on a nil value (field 'n')")
    })
  })

  describe('tables', () => {
    it('constructs arrays, objects and mixes', () => {
      expect(val('return {}')).toEqual([])
      expect(val('return {1, 2, 3}')).toEqual([1, 2, 3])
      expect(val('return {a = 1, b = "x"}')).toEqual({ a: 1, b: 'x' })
      expect(val('return {1, 2, x = 3, 4}')).toEqual({ 1: 1, 2: 2, 3: 4, x: 3 })
      expect(val('return {[1] = "a", [2] = "b"}')).toEqual(['a', 'b'])
      expect(val('return {["a b"] = 1}')).toEqual({ 'a b': 1 })
      expect(val('return {1, 2; 3}')).toEqual([1, 2, 3])
      expect(val('return {1, 2,}')).toEqual([1, 2])
    })

    it('keeps nil holes inside constructors', () => {
      expect(val('return {1, nil, 3}')).toEqual([1, undefined, 3])
      expect(val('return #{1, nil, 3}')).toBe(3)
      expect(val('return #{nil, nil, 3}')).toBe(3)
      expect(val('return #{1, nil}')).toBe(1)
      expect(val('return #{nil}')).toBe(0)
      expect(val('return #{nil, nil}')).toBe(0)
      expect(val('return #{n = 1}')).toBe(0)
    })

    it('treats nil values in keyed fields as absent', () => {
      expect(val('local t = {a = nil, b = 1} local n = 0 for _ in pairs(t) do n += 1 end return n')).toBe(1)
      expect(val('return ({a = nil}).a')).toBe(undefined)
    })

    it('keeps the last of duplicate keys', () => {
      expect(val('return ({a = 1, a = 2}).a')).toBe(2)
      expect(val('return ({[1] = "x", "y"})[1]')).toBe('y')
    })

    it('handles keys named like JS built-ins', () => {
      expect(val('local t = {__proto__ = 1, constructor = 2, toString = 3} return t.__proto__ + t.constructor + t.toString')).toBe(6)
      expect(val('local t = {} t.__proto__ = 5 t.hasOwnProperty = 6 return t.__proto__ + t.hasOwnProperty')).toBe(11)
      expect(vals('local t = {} return t.__proto__, t.constructor, t.valueOf')).toEqual([undefined, undefined, undefined])
      expect(val('local t = {["__proto__"] = 1} local n = 0 for k in pairs(t) do n += 1 end return n')).toBe(1)
      expect(val('local t = {} t["__proto__"] = {} return type(t.__proto__)')).toBe('table')
    })

    it('indexes with all kinds of keys', () => {
      expect(val('local t = {} t[1] = "a" t["1"] = "b" return t[1] .. t["1"]')).toBe('ab')
      expect(val('local t = {} t[true] = 1 t[false] = 2 return t[true] + t[false]')).toBe(3)
      expect(vals('local t = {} local k = {} t[k] = 5 return t[k], t[{}]')).toEqual([5, undefined])
      expect(val('local t = {} local f = function() end t[f] = 5 return t[f]')).toBe(5)
      expect(val('local t = {} t[0.5] = 1 t[-1] = 2 t[0] = 3 return t[0.5] + t[-1] + t[0]')).toBe(6)
    })

    it('throws for nil keys and reads nil keys as nil', () => {
      expect(fail('local t = {} t[nil] = 1').message).toBe('table index is nil')
      expect(fail('return {[nil] = 1}').message).toBe('table index is nil')
      expect(val('local t = {1} return t[nil]')).toBe(undefined)
    })

    it('grows arrays and keeps the length', () => {
      expect(val('local t = {} for i = 1, 10 do t[i] = i end return #t')).toBe(10)
      expect(val('local t = {} for i = 10, 1, -1 do t[i] = i end return #t')).toBe(10)
      expect(val('local t = {1, 2, 3} t[#t + 1] = 4 return #t')).toBe(4)
      expect(val('local t = {1, 2, 3} t[#t] = nil return #t')).toBe(2)
      expect(val('local t = {1, 2, 3} t[1] = nil return #t')).toBe(3)
      expect(val('local t = {} t[3] = 1 return #t')).toBe(0)
      expect(val('local t = {} t[3] = 1 t[2] = 1 t[1] = 1 return #t')).toBe(3)
    })

    it('supports nested tables and chained access', () => {
      expect(val('local t = {a = {b = {c = 42}}} return t.a.b.c')).toBe(42)
      expect(val('local t = {{1, 2}, {3, 4}} return t[2][1]')).toBe(3)
      expect(val('local t = {} t.a = {} t.a.b = {} t.a.b.c = 7 return t.a.b.c')).toBe(7)
      expect(val('local t = {f = function() return {x = 1} end} return t.f().x')).toBe(1)
    })

    it('reports which value was indexed in errors', () => {
      expect(fail('local t = {} return t.a.b').message).toBe("attempt to index a nil value (field 'a')")
      expect(fail('local t return t.a').message).toBe("attempt to index a nil value (local 't')")
      expect(fail('return nothing.a').message).toBe("attempt to index a nil value (global 'nothing')")
      expect(fail('local t = {} t.a.b = 1').message).toBe("attempt to index a nil value (field 'a')")
      expect(fail('local t = 5 t.x = 1').message).toBe("attempt to index a number value (local 't')")
      expect(fail('local x = 1 local function f() return x.y end f()').message).toBe("attempt to index a number value (upvalue 'x')")
      expect(fail('return (nil)[1]').message).toBe('attempt to index a nil value')
      expect(fail('return (true).x').message).toBe('attempt to index a boolean value')
    })

    it('indexes strings', () => {
      expect(val('local s = "abc" return s[2]')).toBe('b')
      expect(val('local s = "abc" return s[9]')).toBe(undefined)
      expect(val('local s = "abc" return s.x')).toBe(undefined)
    })

    it('evaluates constructor items in source order', () => {
      expect(val('n = 0 local function f() n += 1 return n end local t = {a = f(), f(), b = f(), f()} return t')).toEqual({ 1: 2, 2: 4, a: 1, b: 3 })
      expect(val('n = 0 local function f() n += 1 return n end return {[f()] = f(), f()}')).toEqual([3])
      expect(val('n = 0 local function f() n += 1 return n end return {x = f(), y = f()}')).toEqual({ x: 1, y: 2 })
    })

    it('expands multi-values only at the end of a constructor', () => {
      const f = 'local function f() return 1, 2, 3 end '
      expect(val(f + 'return {f()}')).toEqual([1, 2, 3])
      expect(val(f + 'return {f(), f()}')).toEqual([1, 1, 2, 3])
      expect(val(f + 'return {f(), 10}')).toEqual([1, 10])
      expect(val(f + 'return {(f())}')).toEqual([1])
      expect(val(f + 'return {x = 1, f()}')).toEqual({ 1: 1, 2: 2, 3: 3, x: 1 })
      expect(val(f + 'return {f(), x = 1}')).toEqual({ 1: 1, x: 1 })
      expect(val('local function f() end return {f()}')).toEqual([])
      expect(val('local function f() return nil, nil end return #{f()}')).toBe(0)
      expect(val('local function f(...) return {...} end return f(1, nil, 3)')).toEqual([1, undefined, 3])
    })

    it('does not alias the vararg list or return arrays', () => {
      expect(val('local function f(...) local a = {...} local b = {...} a[1] = 99 return b[1] end return f(1, 2)')).toBe(1)
      expect(val('local function f(...) return ... end local a = {f(1, 2)} a[1] = 9 local b = {f(1, 2)} return b[1]')).toBe(1)
      expect(val('local function f(...) local t = {...} t[#t + 1] = 0 return select("#", ...) end return f(1, 2)')).toBe(2)
    })
  })

  describe('functions', () => {
    it('calls with fewer and more arguments than parameters', () => {
      expect(vals('local function f(a, b, c) return a, b, c end return f(1)')).toEqual([1, undefined, undefined])
      expect(vals('local function f(a) return a end return f(1, 2, 3)')).toEqual([1])
    })

    it('returns multiple values and adjusts them', () => {
      const f = 'local function f() return 1, 2, 3 end '
      expect(vals(f + 'return f()')).toEqual([1, 2, 3])
      expect(vals(f + 'return (f())')).toEqual([1])
      expect(vals(f + 'return f(), 10')).toEqual([1, 10])
      expect(vals(f + 'return 10, f()')).toEqual([10, 1, 2, 3])
      expect(vals(f + 'return f() + 1')).toEqual([2])
      expect(vals(f + 'return {f()}, #{f()}')).toEqual([[1, 2, 3], 3])
    })

    it('distinguishes returning nothing from returning nil', () => {
      expect(val('local function f() end local function g() return nil end return select("#", f()), select("#", g())')).toBe(0)
      expect(vals('local function f() end local function g() return nil end return select("#", f()), select("#", g())')).toEqual([0, 1])
      expect(vals('local function f() return end return select("#", f())')).toEqual([0])
      expect(vals('local function f() return nil, nil end return select("#", f())')).toEqual([2])
    })

    it('passes arguments through varargs', () => {
      expect(vals('local function f(...) return ... end return f(1, 2, 3)')).toEqual([1, 2, 3])
            expect(vals('local function f(...) return select("#", ...) end local a, b, c = f(), f(nil), f(nil, nil) return a, b, c')).toEqual([0, 1, 2])
      expect(vals('local function f(a, ...) return a, ... end return f(1, 2, 3)')).toEqual([1, 2, 3])
      expect(vals('local function f(a, ...) local b, c = ... return a, b, c end return f(1, 2)')).toEqual([1, 2, undefined])
      expect(vals('local function f(...) local a, b = ... return a, b end return f(7)')).toEqual([7, undefined])
      expect(vals('local function f(...) return (...) end return f(4, 5)')).toEqual([4])
      expect(vals('local function f(...) return ..., "end" end return f(1, 2)')).toEqual([1, 'end'])
      expect(vals('local function f(...) return "start", ... end return f(1, 2)')).toEqual(['start', 1, 2])
    })

    it('forwards varargs to other calls', () => {
      expect(vals('local function g(...) return select("#", ...), ... end local function f(...) return g(...) end return f(1, nil, 3)')).toEqual([3, 1, undefined, 3])
      expect(vals('local function g(a, b, c) return c, b, a end local function f(...) return g(0, ...) end return f(1, 2)')).toEqual([2, 1, 0])
    })

    it('has varargs in the main chunk', () => {
      const p = compile('return ...', { model: /** @type {any} */ (model) })
      expect(p.run(1, 2, 3)).toEqual([1, 2, 3])
      expect(p.run()).toEqual([])
    })

    it('uses pack and unpack', () => {
      expect(vals('return unpack({1, 2, 3})')).toEqual([1, 2, 3])
      expect(vals('return unpack({1, 2, 3}, 2)')).toEqual([2, 3])
      expect(vals('return unpack({1, 2, 3}, 2, 3)')).toEqual([2, 3])
      expect(vals('return unpack({})')).toEqual([])
      expect(vals('return unpack({1, nil, 3}, 1, 3)')).toEqual([1, undefined, 3])
      expect(val('local t = pack(1, nil, nil) return t.n')).toBe(3)
      expect(val('local t = pack() return t.n')).toBe(0)
      expect(vals('local function f(...) local t = pack(...) return unpack(t, 1, t.n) end return f(nil, 2, nil)')).toEqual([undefined, 2, undefined])
    })

    it('uses select', () => {
      expect(vals('return select(2, "a", "b", "c")')).toEqual(['b', 'c'])
      expect(vals('return select(-1, "a", "b", "c")')).toEqual(['c'])
      expect(vals('return select("#")')).toEqual([0])
      expect(vals('return select("#", nil, nil)')).toEqual([2])
      expect(vals('return (select(2, "a", "b"))')).toEqual(['b'])
    })

    it('recurses', () => {
      expect(val('local function fact(n) if n <= 1 then return 1 end return n * fact(n - 1) end return fact(7)')).toBe(5040)
      expect(val('function fib(n) if n < 2 then return n end return fib(n - 1) + fib(n - 2) end return fib(15)')).toBe(610)
      expect(val('local fact fact = function(n) return n <= 1 and 1 or n * fact(n - 1) end return fact(5)')).toBe(120)
    })

    it('handles mutual recursion through globals and forward-declared locals', () => {
      expect(val('function even(n) if n == 0 then return true end return odd(n - 1) end function odd(n) if n == 0 then return false end return even(n - 1) end return even(10), odd(7)')).toBe(true)
      expect(val('local odd local function even(n) if n == 0 then return true end return odd(n - 1) end function odd(n) if n == 0 then return false end return even(n - 1) end return even(6)')).toBe(true)
    })

    it('supports deep (but finite) recursion', () => {
      expect(val('local function depth(n) if n == 0 then return 0 end return 1 + depth(n - 1) end return depth(1000)')).toBe(1000)
    })

    it('maps infinite recursion to a stack overflow error', () => {
      const e = fail('local function f() return 1 + f() end f()')
      expect(e.message).toBe('stack overflow')
    })

    it('defines methods with function a.b.c:d', () => {
      expect(val('a = {b = {}} function a.b.f(x) return x * 2 end function a.b:m(x) return self == a.b, x end return a.b.f(4), a.b:m(5)')).toBe(8)
      expect(vals('a = {b = {}} function a.b:m(x) return self == a.b, x end return a.b:m(5)')).toEqual([true, 5])
      expect(vals('local o = {n = 3} function o:get() return self.n end function o.static() return "s" end return o:get(), o.static()')).toEqual([3, 's'])
    })

    it('treats redefinition of a local function as an assignment', () => {
      expect(val('local function f() return 1 end local g = f f = function() return 2 end return g() + f()')).toBe(3)
    })

    it('evaluates arguments left to right', () => {
      expect(val('local s = "" local function f(x) s = s .. x return x end local function g() end g(f(1), f(2), f(3)) return s')).toBe('123')
      expect(val('local s = "" local function f(x) s = s .. x return x end return f(1) + f(2) * f(3), s')).toBe(7)
    })

    it('calls functions stored in tables, and immediately invoked ones', () => {
      expect(val('local t = {f = function(a) return a + 1 end} return t.f(1)')).toBe(2)
      expect(val('local t = {function(a) return a + 1 end} return t[1](1)')).toBe(2)
      expect(val('return (function(a, b) return a * b end)(3, 4)')).toBe(12)
      expect(val('local function f() return function() return 5 end end return f()()')).toBe(5)
    })

    it('reports what was called in errors', () => {
      expect(fail('nothing()').message).toBe("attempt to call a nil value (global 'nothing')")
      expect(fail('local f f()').message).toBe("attempt to call a nil value (local 'f')")
      expect(fail('local t = {} t.go()').message).toBe("attempt to call a nil value (field 'go')")
      expect(fail('local t = {} t:go()').message).toBe("attempt to call a nil value (method 'go')")
      expect(fail('local x = 1 local function f() x() end f()').message).toBe("attempt to call a number value (upvalue 'x')")
      expect(fail('("x")()').message).toBe('attempt to call a string value')
      expect(fail('local t = nil t:go()').message).toBe("attempt to index a nil value (local 't')")
    })

    it('calls methods on a call result once', () => {
      expect(val('n = 0 local o = {m = function(self) return 7 end} local function g() n += 1 return o end return g():m(), n')).toBe(7)
      expect(vals('n = 0 local o = {m = function(self) return 7 end} local function g() n += 1 return o end local r = g():m() return r, n')).toEqual([7, 1])
    })

    it('calls methods on strings only through the stdlib, not the string table', () => {
      expect(fail('local s = "abc" return s:upper()').message).toContain('attempt to call a nil value')
    })
  })

  describe('closures', () => {
    it('captures and mutates upvalues', () => {
      const c = 'local function counter() local n = 0 return function() n += 1 return n end end '
      expect(vals(c + 'local a, b = counter(), counter() return a(), a(), b(), a()')).toEqual([1, 2, 1, 3])
      expect(vals(c + 'local a, b = counter(), counter() local x, y, z, w = a(), a(), b(), a() return x, y, z, w')).toEqual([1, 2, 1, 3])
    })

    it('shares an upvalue between closures', () => {
      expect(vals('local n = 0 local function inc() n += 1 end local function get() return n end inc() inc() return get()')).toEqual([2])
      expect(vals('local function mk() local v = 0 return function() v += 1 end, function() return v end end local inc, get = mk() inc() inc() inc() return get()')).toEqual([3])
    })

    it('gives each loop iteration its own variable', () => {
      expect(val('local fs = {} for i = 1, 3 do fs[i] = function() return i end end return fs[1]() * 100 + fs[2]() * 10 + fs[3]()')).toBe(123)
      expect(val('local fs = {} for _, v in ipairs({"a", "b", "c"}) do add(fs, function() return v end) end return fs[1]() .. fs[2]() .. fs[3]()')).toBe('abc')
      expect(val('local fs = {} local i = 0 while i < 3 do i += 1 local j = i fs[i] = function() return j end end return fs[1]() + fs[2]() + fs[3]()')).toBe(6)
    })

    it('gives each repeat iteration its own locals', () => {
      expect(val('local fs, n = {}, 0 repeat n += 1 local k = n * 10 fs[n] = function() return k end until k >= 30 return fs[1]() + fs[3]()')).toBe(40)
    })

    it('sees loop-variable changes inside one iteration', () => {
      expect(val('local f for i = 1, 2 do local g = function() return i end i = i + 10 f = g end return f()')).toBe(12)
    })

    it('keeps closed-over parameters', () => {
      expect(val('local function adder(a) return function(b) return a + b end end return adder(3)(4)')).toBe(7)
    })

    it('sees later assignments to captured locals', () => {
      expect(val('local x = 1 local function f() return x end x = 2 return f()')).toBe(2)
    })

    it('captures varargs through a table', () => {
      expect(val('local function f(...) local t = {...} return function() return #t end end return f(1, 2, 3)()')).toBe(3)
    })
  })

  describe('control flow', () => {
    it('runs if / elseif / else', () => {
      const f = 'local function f(x) if x == 1 then return "one" elseif x == 2 then return "two" elseif x == 3 then return "three" else return "many" end end '
      expect(vals(f + 'return f(1), f(2), f(3), f(4), f(nil)')).toEqual(['one', 'two', 'three', 'many', 'many'])
      expect(val('local x = 0 if false then x = 1 end return x')).toBe(0)
    })

    it('runs while, repeat, break and nested loops', () => {
      expect(val('local n = 0 while n < 10 do n += 1 if n == 5 then break end end return n')).toBe(5)
      expect(val('local n = 0 repeat n += 1 until n >= 3 return n')).toBe(3)
      expect(val('local n = 0 repeat n += 1 if n == 2 then break end until false return n')).toBe(2)
      expect(val('local s = 0 for i = 1, 3 do for j = 1, 3 do if j == 2 then break end s += 1 end end return s')).toBe(3)
      expect(val('local n = 0 while true do n += 1 while true do break end if n > 2 then break end end return n')).toBe(3)
    })

    it('lets repeat conditions see the body locals', () => {
      expect(val('local n = 0 repeat local done = n >= 2 n += 1 until done return n')).toBe(3)
    })

    it('supports return in the middle of a block via do-end and loops', () => {
      expect(val('for i = 1, 5 do if i == 3 then return i end end return -1')).toBe(3)
      expect(val('local function f() while true do return "w" end end return f()')).toBe('w')
      expect(val('local function f() repeat return "r" until true end return f()')).toBe('r')
      expect(val('do return 1 end')).toBe(1)
    })

    it('supports the PICO-8 shorthand if and while', () => {
      expect(val('local x = 0\nif (x == 0) x = 5\nreturn x')).toBe(5)
      expect(val('local x = 1\nif (x == 0) x = 5 else x = 6\nreturn x')).toBe(6)
      expect(val('local n = 0\nwhile (n < 4) n += 1\nreturn n')).toBe(4)
      expect(val('local x = 0\nif (true) x += 1 x += 2\nreturn x')).toBe(3)
      expect(val('local x = 0\nif (false) x += 1 x += 2\nreturn x')).toBe(0)
      // on a single line, everything after the condition belongs to the body
      expect(val('local x = 0 if (x == 0) x = 5 return x')).toBe(5)
    })

    it('supports the ? print shorthand', () => {
      expect(out('?"hi"')).toEqual(['hi'])
      expect(out('?1 + 2')).toEqual(['3'])
    })
  })

  describe('numeric for', () => {
    const sum = (/** @type {string} */ range) => val(`local s = 0 for i = ${range} do s += i end return s`)

    it('counts up and down', () => {
      expect(sum('1, 5')).toBe(15)
      expect(sum('5, 1')).toBe(0)
      expect(sum('5, 1, -1')).toBe(15)
      expect(sum('1, 10, 3')).toBe(22)
      expect(sum('10, 1, -3')).toBe(22)
      expect(sum('1, 1')).toBe(1)
      expect(sum('0, 0')).toBe(0)
      expect(sum('-3, 3')).toBe(0)
    })

    it('supports fractional steps', () => {
      expect(sum('0, 1, 0.25')).toBe(2.5)
      expect(sum('1, 0, -0.5')).toBe(1.5)
      expect(val('local n = 0 for i = 0.5, 2.5 do n += 1 end return n')).toBe(3)
    })

    it('evaluates bounds once', () => {
      expect(val('n = 0 local function lim() n += 1 return 3 end for i = 1, lim() do end return n')).toBe(1)
      expect(val('local t = {1, 2, 3} local c = 0 for i = 1, #t do t[#t + 1] = 0 c += 1 end return c')).toBe(3)
    })

    it('uses a dynamic step', () => {
      expect(val('local s, step = 0, 2 for i = 1, 7, step do s += i end return s')).toBe(16)
      expect(val('local s, step = 0, -2 for i = 7, 1, step do s += i end return s')).toBe(16)
    })

    it('does not change the iteration when the body assigns the variable', () => {
      expect(val('local n = 0 for i = 1, 3 do i = i * 10 n += 1 end return n')).toBe(3)
      expect(val('local s = 0 for i = 1, 3 do i += 100 s += i end return s')).toBe(306)
    })

    it('leaves the variable local to the loop', () => {
      expect(val('i = "g" for i = 1, 2 do end return i')).toBe('g')
    })

    it('rejects non-numbers and a zero step', () => {
      expect(fail('for i = 1, nil do end').message).toBe("'for' limit must be a number")
      expect(fail('for i = nil, 1 do end').message).toBe("'for' initial value must be a number")
      expect(fail('for i = 1, 2, nil do end').message).toBe("'for' step must be a number")
      expect(fail('for i = 1, 2, 0 do end').message).toBe("'for' step is zero")
      expect(fail('local z = 0 for i = 1, 2, z do end').message).toBe("'for' step is zero")
      expect(fail('for i = "a", 2 do end').message).toBe("'for' initial value must be a number")
    })

    it('can loop zero times without evaluating the body', () => {
      expect(val('n = 0 for i = 2, 1 do n = 1 end return n')).toBe(0)
    })
  })

  describe('generic for', () => {
    it('iterates ipairs, stopping at the first nil', () => {
      expect(val('local s = "" for i, v in ipairs({"a", "b", nil, "d"}) do s ..= i .. v end return s')).toBe('1a2b')
      expect(val('local n = 0 for _ in ipairs({}) do n += 1 end return n')).toBe(0)
    })

    it('iterates pairs over arrays, objects and mixtures', () => {
      expect(val('local s = 0 for k, v in pairs({10, 20, 30}) do s += k * v end return s')).toBe(140)
      expect(val('local n = 0 for k, v in pairs({a = 1, b = 2, c = 3}) do n += v end return n')).toBe(6)
      expect(val('local keys = {} for k in pairs({1, 2, x = 1}) do add(keys, k) end return #keys')).toBe(3)
      expect(val('local n = 0 for k, v in pairs({1, nil, 3}) do n += 1 end return n')).toBe(2)
    })

    it('allows clearing fields while iterating', () => {
      expect(val('local t = {a = 1, b = 2, c = 3} for k in pairs(t) do t[k] = nil end return next(t)')).toBe(undefined)
    })

    it('iterates with all(), foreach, and custom iterators', () => {
      expect(val('local s = 0 for v in all({1, 2, 3}) do s += v end return s')).toBe(6)
      expect(val('local s = 0 foreach({1, 2, 3}, function(v) s += v end) return s')).toBe(6)
      expect(val('local function range(n) local i = 0 return function() i += 1 if i <= n then return i end end end local s = 0 for v in range(4) do s += v end return s')).toBe(10)
    })

    it('supports stateless iterators with state and control values', () => {
      expect(val('local function it(max, i) i += 1 if i <= max then return i, i * i end end local s = 0 for i, sq in it, 3, 0 do s += sq end return s')).toBe(14)
    })

    it('supports iterator factories returning three values', () => {
      expect(val('local function it(t, i) i += 1 if t[i] then return i, t[i] end end local function my(t) return it, t, 0 end local s = 0 for i, v in my({5, 6}) do s += i * v end return s')).toBe(17)
    })

    it('handles more loop variables than the iterator returns', () => {
      expect(vals('local function it(_, i) if i == nil then return 1, 2, 3 end end local a, b, c, d for x, y, z, w in it do a, b, c, d = x, y, z, w break end return a, b, c, d')).toEqual([1, 2, 3, undefined])
    })

    it('stops when the first value is nil even if others are not', () => {
      expect(val('local function it() return nil, 1 end local n = 0 for a, b in it do n += 1 end return n')).toBe(0)
    })

    it('treats pairs(nil) and ipairs(nil) as empty loops', () => {
      expect(val('local n = 0 for _ in pairs(nil) do n += 1 end for _ in ipairs(nil) do n += 1 end return n')).toBe(0)
    })

    it('complains about a non-callable iterator', () => {
      expect(fail('for x in 5 do end').message).toBe('attempt to call a number value (for iterator \'for iterator\')')
      expect(fail('for x in nil do end').message).toContain('attempt to call a nil value')
    })

    it('breaks out of generic loops', () => {
      expect(val('local r for k, v in pairs({5, 6, 7}) do if v == 6 then r = k break end end return r')).toBe(2)
    })
  })

  describe('goto', () => {
    it('supports continue-style forward gotos', () => {
      expect(val('local s = "" for i = 1, 5 do if i % 2 == 0 then goto continue end s ..= i ::continue:: end return s')).toBe('135')
      expect(val('local s = 0 for _, v in ipairs({1, 2, 3}) do if v == 2 then goto skip end s += v ::skip:: end return s')).toBe(4)
      expect(val('local n = 0 while n < 5 do n += 1 if n == 3 then goto cont end ::cont:: end return n')).toBe(5)
    })

    it('supports breaking out of nested loops', () => {
      expect(val('local n = 0 for i = 1, 3 do for j = 1, 3 do n += 1 if j == 2 then goto done end end end ::done:: return n')).toBe(2)
    })

    it('supports jumping over statements', () => {
      expect(val('local x = 1 goto skip x = 2 ::skip:: return x')).toBe(1)
      expect(val('local x = 1 do goto out end x = 2 ::out:: return x')).toBe(1)
    })

    it('supports several labels and overlapping regions', () => {
      expect(val('local x = "" goto b x ..= "1" ::a:: x ..= "2" ::b:: x ..= "3" return x')).toBe('3')
      expect(val('local x = "" if true then goto a end x ..= "1" ::a:: x ..= "2" if true then goto b end x ..= "3" ::b:: x ..= "4" return x')).toBe('24')
    })

    it('supports backward gotos as loops', () => {
      expect(val('local n = 0 ::top:: n += 1 if n < 5 then goto top end return n')).toBe(5)
      expect(val('local n, s = 0, 0 ::again:: n += 1 s += n if n < 4 then goto again end return s')).toBe(10)
    })

    it('supports backward gotos with break inside them', () => {
      expect(val('local n = 0 for i = 1, 10 do ::retry:: n += 1 if n % 2 == 1 then goto retry end if n > 6 then break end end return n')).toBe(8)
    })

    it('supports forward and backward jumps to the same label', () => {
      expect(val('local n = 0 goto mid ::mid:: n += 1 if n < 3 then goto mid end return n')).toBe(3)
    })

    it('rejects gotos without a label', () => {
      expect(() => compile('goto nowhere')).toThrow(LuaSyntaxError)
      expect(() => compile('do ::a:: end goto a')).toThrow(LuaSyntaxError)
    })

    it('does not see labels of other functions', () => {
      expect(() => compile('::a:: local function f() goto a end')).toThrow(LuaSyntaxError)
    })
  })

  describe('metatables', () => {
    it('uses __index tables for inheritance', () => {
      const cls = 'Animal = {} Animal.__index = Animal function Animal.new(n) return setmetatable({name = n}, Animal) end function Animal:speak() return self.name .. " makes a sound" end '
      expect(val(cls + 'return Animal.new("cat"):speak()')).toBe('cat makes a sound')
      expect(val(cls + 'Dog = setmetatable({}, {__index = Animal}) Dog.__index = Dog function Dog.new(n) return setmetatable({name = n}, Dog) end function Dog:speak() return self.name .. " barks" end return Dog.new("rex"):speak() .. "/" .. Animal.new("a"):speak()')).toBe('rex barks/a makes a sound')
      expect(val(cls + 'Dog = setmetatable({}, {__index = Animal}) Dog.__index = Dog local d = setmetatable({name = "z"}, Dog) return d:speak()')).toBe('z makes a sound')
    })

    it('uses __index functions and chains', () => {
      expect(val('local t = setmetatable({}, {__index = function(t, k) return k .. "!" end}) return t.foo, t[1]')).toBe('foo!')
      expect(val('local a = {x = 1} local b = setmetatable({y = 2}, {__index = a}) local c = setmetatable({}, {__index = b}) return c.x + c.y')).toBe(3)
      expect(val('local t = setmetatable({a = 1}, {__index = function() return "no" end}) return t.a .. t.b')).toBe('1no')
      expect(val('local t = setmetatable({}, {__index = {}}) return t.x')).toBe(undefined)
    })

    it('uses __newindex', () => {
      expect(val('local log = {} local t = setmetatable({}, {__newindex = function(t, k, v) rawset(t, k, v * 2) end}) t.a = 5 return t.a')).toBe(10)
      expect(val('local store = {} local t = setmetatable({}, {__newindex = store}) t.x = 1 return store.x, rawget(t, "x")')).toBe(1)
      expect(val('local n = 0 local t = setmetatable({a = 1}, {__newindex = function() n += 1 end}) t.a = 2 t.b = 3 return n, t.a')).toBe(1)
    })

    it('uses __call', () => {
      expect(val('local t = setmetatable({}, {__call = function(self, a, b) return a + b end}) return t(3, 4)')).toBe(7)
      expect(vals('local t = setmetatable({n = 1}, {__call = function(self, ...) return self.n, ... end}) return t("a", "b")')).toEqual([1, 'a', 'b'])
      expect(val('local C = setmetatable({}, {__call = function(cls, x) return setmetatable({x = x}, cls) end}) C.__index = C function C:get() return self.x end return C(9):get()')).toBe(9)
    })

    it('uses arithmetic metamethods', () => {
      const v = 'local V = {} V.__index = V local function vec(x, y) return setmetatable({x = x, y = y}, V) end V.__add = function(a, b) return vec(a.x + b.x, a.y + b.y) end V.__mul = function(a, k) return vec(a.x * k, a.y * k) end V.__unm = function(a) return vec(-a.x, -a.y) end V.__sub = function(a, b) return vec(a.x - b.x, a.y - b.y) end '
      expect(vals(v + 'local r = vec(1, 2) + vec(3, 4) return r.x, r.y')).toEqual([4, 6])
      expect(vals(v + 'local r = vec(1, 2) * 3 return r.x, r.y')).toEqual([3, 6])
      expect(vals(v + 'local r = -vec(1, 2) return r.x, r.y')).toEqual([-1, -2])
      expect(vals(v + 'local r = vec(5, 5) - vec(1, 2) return r.x, r.y')).toEqual([4, 3])
      expect(val('local t = setmetatable({}, {__div = function() return "d" end, __mod = function() return "m" end, __idiv = function() return "i" end}) return t / 1 .. t % 1 .. t \\ 1')).toBe('dmi')
    })

    it('uses comparison metamethods', () => {
      const m = 'local mt = {__lt = function(a, b) return a.v < b.v end, __le = function(a, b) return a.v <= b.v end, __eq = function(a, b) return a.v == b.v end} local function n(v) return setmetatable({v = v}, mt) end '
      expect(vals(m + 'return n(1) < n(2), n(2) < n(1), n(1) <= n(1), n(2) > n(1), n(1) >= n(2)')).toEqual([true, false, true, true, false])
      expect(vals(m + 'return n(1) == n(1), n(1) == n(2), n(1) ~= n(1), n(1) ~= n(2)')).toEqual([true, false, false, true])
      expect(vals(m + 'local a = n(1) return a == a, a == 1, a == nil')).toEqual([true, false, false])
    })

    it('does not call __eq for different types', () => {
      expect(val('local mt = {__eq = function() return true end} local t = setmetatable({}, mt) return t == 1')).toBe(false)
    })

    it('uses __concat, __len and __tostring', () => {
      expect(val('local t = setmetatable({}, {__concat = function(a, b) return "cat" end}) return t .. "x"')).toBe('cat')
      expect(val('local t = setmetatable({}, {__concat = function(a, b) return type(a) .. type(b) end}) return "x" .. t')).toBe('stringtable')
      expect(val('local t = setmetatable({1, 2}, {__len = function() return 42 end}) return #t')).toBe(42)
      expect(val('local t = setmetatable({}, {__tostring = function() return "T!" end}) return tostr(t)')).toBe('T!')
    })

    it('protects metatables with __metatable', () => {
      expect(val('local t = setmetatable({}, {__metatable = "locked"}) return getmetatable(t)')).toBe('locked')
      expect(fail('local t = setmetatable({}, {__metatable = 1}) setmetatable(t, {})').message).toBe('cannot change a protected metatable')
    })

    it('removes metatables with setmetatable(t, nil)', () => {
      expect(val('local t = setmetatable({}, {__index = {a = 1}}) setmetatable(t, nil) return t.a')).toBe(undefined)
    })

    it('uses rawget, rawset and rawequal to bypass metamethods', () => {
      expect(val('local t = setmetatable({}, {__index = function() return 1 end}) return rawget(t, "a")')).toBe(undefined)
      expect(val('local t = setmetatable({}, {__newindex = function() error() end}) rawset(t, "a", 2) return t.a')).toBe(2)
      expect(val('local mt = {__eq = function() return true end} return rawequal(setmetatable({}, mt), setmetatable({}, mt))')).toBe(false)
    })

    it('supports __pairs', () => {
      expect(val('local t = setmetatable({}, {__pairs = function(t) return function(_, k) if not k then return 1, "one" end end, t, nil end}) local s = "" for k, v in pairs(t) do s ..= k .. v end return s')).toBe('1one')
    })

    it('detects __index loops', () => {
      expect(fail('local a, b = {}, {} setmetatable(a, {__index = b}) setmetatable(b, {__index = a}) return a.x').message).toBe('loop in gettable')
    })

    it('errors on arithmetic on tables without metamethods', () => {
      expect(fail('return {} + 1').message).toBe('attempt to perform arithmetic on a table value')
      expect(fail('return 1 < {}').message).toBe('attempt to compare number with table')
      expect(fail('return {} < {}').message).toBe('attempt to compare two table values')
      expect(fail('return "a" < 1').message).toBe('attempt to compare string with number')
      expect(fail('return {} .. "x"').message).toBe('attempt to concatenate a table value')
      expect(fail('return #5').message).toBe('attempt to get length of a number value')
      expect(fail('return -{}').message).toBe('attempt to perform arithmetic on a table value')
      expect(fail('return nil < 1').message).toBe('attempt to compare nil with number')
      expect(fail('return 1 > nil').message).toBe('attempt to compare nil with number')
    })

    it('names the offending operand of arithmetic, bitwise, concat and length errors', () => {
      const m = (/** @type {string} */ src) => fail(src).message
      expect(m('return x + 1')).toBe("attempt to perform arithmetic on a nil value (global 'x')")
      expect(m('return 1 + x')).toBe("attempt to perform arithmetic on a nil value (global 'x')")
      expect(m('local a return a * 2')).toBe("attempt to perform arithmetic on a nil value (local 'a')")
      expect(m('local a = 1 local b return a - b')).toBe("attempt to perform arithmetic on a nil value (local 'b')")
      expect(m('local a local b = 1 return a - b')).toBe("attempt to perform arithmetic on a nil value (local 'a')")
      expect(m('local a local function f() return a / 2 end return f()')).toBe("attempt to perform arithmetic on a nil value (upvalue 'a')")
      expect(m('local t = {} return t.n % 2')).toBe("attempt to perform arithmetic on a nil value (field 'n')")
      expect(m('local t = {} return 2 ^ t.n')).toBe("attempt to perform arithmetic on a nil value (field 'n')")
      expect(m('local t = {} return t.a.b + 1')).toBe("attempt to index a nil value (field 'a')")
      expect(m('local t = {} return t[1] + 1')).toBe('attempt to perform arithmetic on a nil value')
      expect(m('local a return -a')).toBe("attempt to perform arithmetic on a nil value (local 'a')")
      expect(m('local a return a & 1')).toBe("attempt to perform bitwise operation on a nil value (local 'a')")
      expect(m('local a return ~a')).toBe("attempt to perform bitwise operation on a nil value (local 'a')")
      expect(m('local s return "x" .. s')).toBe("attempt to concatenate a nil value (local 's')")
      expect(m('local s return s .. "x"')).toBe("attempt to concatenate a nil value (local 's')")
      expect(m('return #n')).toBe("attempt to get length of a nil value (global 'n')")
      expect(m('local a = {} return a + 1')).toBe("attempt to perform arithmetic on a table value (local 'a')")
    })

    it('names the target of a compound assignment', () => {
      const m = (/** @type {string} */ src) => fail(src).message
      expect(m('x += 1')).toBe("attempt to perform arithmetic on a nil value (global 'x')")
      expect(m('local n n -= 1')).toBe("attempt to perform arithmetic on a nil value (local 'n')")
      expect(m('local n = 1 local v n *= v')).toBe("attempt to perform arithmetic on a nil value (local 'v')")
      expect(m('local s s ..= "a"')).toBe("attempt to concatenate a nil value (local 's')")
      expect(m('local t = {} t.n |= 1')).toBe("attempt to perform bitwise operation on a nil value (field 'n')")
    })

    it('does not name operands that have no name, or in comparisons', () => {
      expect(fail('local a return a < 1').message).toBe('attempt to compare nil with number')
      expect(fail('return (x) + 1').message).toBe('attempt to perform arithmetic on a nil value')
      expect(fail('local function f() end return f() + 1').message).toBe('attempt to perform arithmetic on a nil value')
    })

    it('metamethods and coercion still win over the error', () => {
      expect(val('local a = setmetatable({}, {__add = function() return 7 end}) return a + 1')).toBe(7)
      expect(val('local s = "4" return s + 1')).toBe(5)
    })

    it('evaluates a > b as b < a for metamethod argument order', () => {
      expect(val('local seen local mt = {__lt = function(a, b) seen = a.id .. b.id return true end} local x, y = setmetatable({id = "x"}, mt), setmetatable({id = "y"}, mt) local _ = x > y return seen')).toBe('yx')
    })
  })

  describe('string coercion', () => {
    it('coerces numeric strings in arithmetic', () => {
      expect(val('return "10" + 5')).toBe(15)
      expect(val('return "3" * "4"')).toBe(12)
      expect(val('return 10 - "0x4"')).toBe(6)
      expect(fail('return "abc" + 1').message).toBe('attempt to perform arithmetic on a string value')
      expect(fail('return nil + 1').message).toBe('attempt to perform arithmetic on a nil value')
      expect(fail('return 1 + nil').message).toBe('attempt to perform arithmetic on a nil value')
      expect(fail('return true * 2').message).toBe('attempt to perform arithmetic on a boolean value')
    })

    it('compares strings but never mixes strings and numbers', () => {
      expect(val('return "10" == 10')).toBe(false)
      expect(val('return "a" < "b" and "B" < "a"')).toBe(true)
    })

    it('converts with tostr and tonum', () => {
      expect(vals('return tostr(nil), tostr(true), tostr(12), tostr("s"), tostr({}), tostr(print)')).toEqual(['[nil]', 'true', '12', 's', '[table]', '[function]'])
      expect(vals('return tonum("12"), tonum("0x1f"), tonum("abc"), tonum(nil), tonum(5), tonum(true)')).toEqual([12, 31, undefined, undefined, 5, 1])
    })

    it('splits, subs and ords', () => {
      expect(val('return split("a,b,c")')).toEqual(['a', 'b', 'c'])
      expect(val('return split("1,2,3")')).toEqual([1, 2, 3])
      expect(val('return split("1,2", ",", false)')).toEqual(['1', '2'])
      expect(vals('return sub("hello", 2, 3), sub("hello", -2), ord("A"), chr(72)')).toEqual(['el', 'lo', 65, 'H'])
    })
  })

  describe('number models', () => {
    it('wraps or not depending on the model', () => {
      if (model === 'fixed') {
        expect(val('return 32767 + 1')).toBe(-32768)
        expect(val('return 0x7fff.ffff + 0x0.0001')).toBe(-32768)
        expect(val('return 32768')).toBe(-32768)
        expect(val('return 1 / 3')).toBeCloseTo(0.3333, 4)
        expect(val('return 1 / 0')).toBe(32767 + 65535 / 65536)
        expect(val('return 0.000001')).toBe(0)
        expect(val('return 0.00001')).toBe(1 / 65536)
        expect(val('return 100 * 400')).not.toBe(40000)
      } else {
        expect(val('return 32767 + 1')).toBe(32768)
        expect(val('return 32768')).toBe(32768)
        expect(val('return 1 / 3')).toBe(1 / 3)
        expect(val('return 1 / 0')).toBe(Infinity)
        expect(val('return 0.00001')).toBe(0.00001)
        expect(val('return 100 * 400')).toBe(40000)
      }
    })

    it('agrees on integers and halves', () => {
      expect(vals('return 3 + 4, 3 * 4, 10 - 12, 9 / 2, 2 ^ 10, 7 \\ 2, -7 % 3')).toEqual([7, 12, -2, 4.5, 1024, 3, 2])
    })

    it('rounds with flr and ceil', () => {
      expect(vals('return flr(2.7), flr(-2.7), ceil(2.1), ceil(-2.1), flr(3)')).toEqual([2, -3, 3, -2, 3])
    })

    it('formats numbers in tostr', () => {
      expect(val('return tostr(3) .. tostr(-2) .. tostr(0.5)')).toBe('3-20.5')
    })
  })

  describe('peek operators', () => {
    it('parse and default to 0 without a host memory', () => {
      expect(vals('return @0x5f00, %0x5f00, $0x5f00')).toEqual([0, 0, 0])
    })

    it('call the host', () => {
      const p = compile('return @1, %2, $3', {
        model: /** @type {any} */ (model),
        host: /** @type {any} */ ({ peek: (/** @type {number} */ a) => a * 10, peek2: (/** @type {number} */ a) => a * 100, peek4: (/** @type {number} */ a) => a * 1000 }),
      })
      expect(p.run()).toEqual([10, 200, 3000])
    })
  })
})
