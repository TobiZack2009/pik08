import { describe, expect, it } from 'vitest'
import { compile } from '../../src/lua/compile.js'
import { LuaError, LuaSyntaxError } from '../../src/lua/errors.js'
import { lua } from '../helpers/lua-run.js'

/**
 * Execution tests for the ways PICO-8's Lua differs from standard Lua. Everything here compiles and
 * runs Lua source through the real pipeline (lexer -> parser -> codegen -> eval) using only the
 * language core: no graphics, sound or input. `print`/`?` output is captured by the test host and
 * memory reads (`@ % $`) are served by a fake `peek`.
 *
 * Tests marked "(version-dependent)" pin behaviour that differs between PICO-8 releases; if the
 * target version changes they are the first place to look.
 */

/** @param {string} src @param {'fixed' | 'float'} [model] */
const syntaxError = (src, model = 'fixed') => {
  try {
    compile(src, { model })
  } catch (e) {
    expect(e).toBeInstanceOf(LuaSyntaxError)
    return /** @type {LuaSyntaxError} */ (e)
  }
  throw new Error(`expected a syntax error for: ${src}`)
}

/** Value of `-x - 1/65536` style results: one unit in the last place of a 16.16 number. */
const ULP = 1 / 65536

describe.each(/** @type {const} */ (['fixed', 'float']))('PICO-8 dialect (%s numbers)', (model) => {
  const { val, vals, out, fail } = lua(model)

  describe('comments', () => {
    it('// is a line comment, not an operator', () => {
      expect(val('return 7 // 2')).toBe(7)
      expect(val('local x = 8 // 2\nreturn x')).toBe(8)
      expect(val('// whole line\nreturn 1')).toBe(1)
      expect(val('return 1 //')).toBe(1)
    })

    it('// and -- both hide the rest of the line only', () => {
      expect(val('local a = 1 // a = 2\nlocal b = 3 -- b = 4\nreturn a + b')).toBe(4)
    })

    it('"//" and "--" inside strings are not comments', () => {
      expect(val('return "a//b"')).toBe('a//b')
      expect(val("return 'a--b'")).toBe('a--b')
      expect(val('return [[ -- not // a comment ]]')).toBe(' -- not // a comment ')
    })

    it('--[[ ]] is a block comment that can span lines', () => {
      expect(val('local x = 1 --[[ x = 2\nx = 3 ]] return x')).toBe(1)
      expect(val('--[[ a\nb\nc ]]\nreturn 5')).toBe(5)
      expect(val('return --[[]] 6')).toBe(6)
    })

    it('a block comment ends at the first ]] and does not nest', () => {
      expect(val('--[[ a [[ b ]] return 1')).toBe(1)
      expect(val('--[[ ]=] ]] return 2')).toBe(2)
    })

    it('--[=[ is NOT a block comment: it is a plain line comment', () => {
      // standard Lua would hide the whole region and return 1
      expect(val('x = 1\n--[=[ not a block\nx = 2\n--]=]\nreturn x')).toBe(2)
      expect(val('--[==[ ]==] return 3')).toBe(undefined)
      expect(val('--[==[\nreturn 4')).toBe(4)
    })

    it('--[ and --[= alone are line comments', () => {
      expect(val('--[ x\nreturn 1')).toBe(1)
      expect(val('--[= x\nreturn 1')).toBe(1)
    })

    it('long strings still support [=[ ]=] levels', () => {
      expect(val('return [=[a]]b]=]')).toBe('a]]b')
      expect(val('return [==[a]=]b]==]')).toBe('a]=]b')
      expect(val('return [[\nfirst newline skipped]]')).toBe('first newline skipped')
    })

    it('comment recognition is independent of long strings', () => {
      // `--[[` hides a `[[` opener, and `[[ ... ]]` hides `--`
      expect(val('--[[ [[ ]] return "after"')).toBe('after')
      expect(val('local s = [[ a --[[ b ]] return s')).toBe(' a --[[ b ')
      expect(val('local s = [[ x ]] -- [[ y\nreturn s')).toBe(' x ')
    })

    it('an unterminated block comment is a syntax error', () => {
      expect(syntaxError('return 1 --[[ never closed').message).toMatch(/unfinished long comment/)
    })

    it('comments can sit directly against operators', () => {
      expect(val('return 1+--[[x]]2')).toBe(3)
      expect(val('return 1 --[[x]]+ --[[y]] 2')).toBe(3)
      expect(val('return 8/--[[x]]2')).toBe(4)
      expect(val('return 8 / // two\n2')).toBe(4)
      expect(val('return 5--[[x]]-1')).toBe(4) // `5`, comment, `-1`: this is 5 - 1 across the comment
    })

    it('"-- " right after a number hides the rest, so `4-- 1` is just 4', () => {
      expect(val('return 4-- 1')).toBe(4)
      expect(val('return 4 - -1')).toBe(5)
      expect(val('return 4- -1')).toBe(5)
    })

    it('comments keep line numbers intact for error reporting', () => {
      const e = fail('--[[ one\ntwo\nthree ]]\nlocal x = nil + 1')
      expect(e.line).toBe(4)
      expect(fail('// a\n// b\nlocal x = nil + 1').line).toBe(3)
    })
  })

  describe('numeric literals', () => {
    it.each([
      ['0b1010', 10],
      ['0B11', 3],
      ['0b0.1', 0.5],
      ['0b10.', 2],
      ['0b.01', 0.25],
      ['0b1.1', 1.5],
      ['0x10', 16],
      ['0X1f', 31],
      ['0x11.4', 17.25],
      ['0x11.4000', 17.25],
      ['0xA.8', 10.5],
      ['0x.8', 0.5],
      ['0x0.0001', ULP],
      ['0x1.', 1],
      ['.5', 0.5],
      ['5.', 5],
      ['007', 7],
      ['1.25', 1.25],
    ])('%s', (src, expected) => {
      expect(val(`return ${src}`)).toBe(expected)
    })

    it('has no exponent syntax: 1e3 is the number 1 followed by the name e3', () => {
      expect(vals('x = 1e3 = 2 return x, e3')).toEqual([1, 2])
      expect(vals('x = 0xB0p99 = 3 return x, p99')).toEqual([176, 3])
    })

    it.each(['return 1e3', 'return 1e+3', 'return 1E3', 'return 0xB0p99', 'return 0x1p4'])('rejects as an expression: %s', (src) => {
      syntaxError(src, model)
    })

    it.each([
      ['0x', 'malformed number'],
      ['0b', 'malformed number'],
      ['0b2', 'malformed number'],
      ['0xg', 'malformed number'],
      ['0x1.2.3', 'malformed number'],
      ['0b1.1.1', 'malformed number'],
      ['1..2', 'malformed number'],
      ['1.2.3', 'malformed number'],
      ['.', ''],
    ])('rejects malformed numeral %s', (src, message) => {
      const e = syntaxError(`return ${src}`, model)
      expect(e.message).toContain(message)
    })

    it('a space makes 1 .. 2 concatenation', () => {
      expect(val('return 1 .. 2')).toBe('12')
      expect(val('return 1 ..2')).toBe('12')
    })

    it('literal range follows the number model', () => {
      expect(val('return 32767')).toBe(32767)
      expect(val('return 32768')).toBe(model === 'fixed' ? -32768 : 32768)
    })

    it('there is a single number type: 1 == 1.0 and 3 / 2 is 1.5', () => {
      expect(val('return 1 == 1.0')).toBe(true)
      expect(val('return 3 / 2')).toBe(1.5)
      expect(val('return 4 / 2 == 2')).toBe(true)
    })
  })

  describe('longest-match tokens', () => {
    it('.. versus ... versus ..=', () => {
      expect(val('local function f(...) return select("#", ...) end return f(1, 2, 3)')).toBe(3)
      expect(vals('local function f(...) local a, b = ... return a .. b, select("#", ...) end return f("x", "y")')).toEqual(['xy', 2])
      expect(val('local s = "a" s ..= "b" s ..="c" return s')).toBe('abc')
      expect(val('local a, b = "p", "q" return a..b..a')).toBe('pqp')
      expect(val('local t = {x = "u", y = "v"} return t.x..t.y')).toBe('uv')
    })

    it('a lone . or .. is not confused with a number', () => {
      expect(val('local t = {5} return t[1]..1')).toBe('51')
      expect(val('return 1 .. .5')).toBe('10.5')
    })

    it('>>> versus >> versus >>=  and >>>=', () => {
      expect(val('return -8 >> 1')).toBe(-4)
      expect(val('return -8 >>> 1')).toBe(32764)
      expect(val('local x = -8 x >>= 1 return x')).toBe(-4)
      expect(val('local x = -8 x >>>= 1 return x')).toBe(32764)
      expect(val('local x = -8 x>>>=1 return x')).toBe(32764)
      expect(val('local x = 4 x>>=1 return x')).toBe(2)
    })

    it('<<> versus << versus <<= versus <<>=', () => {
      const one = ULP
      expect(val('return 0x.0001 <<> 1')).toBe(2 * one)
      expect(val('return 0x.0001<<>1')).toBe(2 * one)
      expect(val('return 1 << 1')).toBe(2)
      expect(val('local x = 1 x <<= 3 return x')).toBe(8)
      expect(val('local x = 0x.0001 x <<>= 2 return x')).toBe(4 * one)
      expect(val('local x = 0x.0001 x<<>=2 return x')).toBe(4 * one)
    })

    it('>>< versus >> versus >><=', () => {
      expect(val('return 0x.0001 >>< 1')).toBe(-32768)
      expect(val('local x = 0x.0001 x >><= 1 return x')).toBe(-32768)
      expect(val('local x = 0x.0002 x>><=1 return x')).toBe(ULP)
    })

    it('^ versus ^^ versus ^= versus ^^=', () => {
      expect(val('return 2 ^ 3')).toBe(8)
      expect(val('return 6 ^^ 3')).toBe(5)
      expect(val('local x = 2 x ^= 3 return x')).toBe(8)
      expect(val('local x = 6 x ^^= 3 return x')).toBe(5)
      expect(val('local x = 6 x^^=3 return x')).toBe(5)
    })

    it('!= versus ~= versus == versus <= >=', () => {
      expect(val('return 1 != 2')).toBe(true)
      expect(val('return 1!=1')).toBe(false)
      expect(val('return 1 ~= 2')).toBe(true)
      expect(val('return 1 ~=1')).toBe(false)
      expect(val('return 1 == 1, 1 <= 1, 1 >= 2')).toBe(true)
      expect(vals('return 1 <= 1, 1 >= 2')).toEqual([true, false])
    })

    it('a lone ! is not a token', () => {
      expect(syntaxError('return !true', model).message).toMatch(/unexpected symbol/)
      expect(syntaxError('return !', model).message).toMatch(/unexpected symbol/)
    })

    it('\\ versus \\=', () => {
      expect(val('return 7 \\ 2')).toBe(3)
      expect(val('local x = 7 x \\= 2 return x')).toBe(3)
      expect(val('local x = 7 x\\=2 return x')).toBe(3)
    })

    it('= versus == versus <= when written without spaces', () => {
      expect(val('local a=1 local b=a==1 return b')).toBe(true)
      expect(val('local a=2 local b=a<=2 return b')).toBe(true)
      expect(val('local a=-1 return a')).toBe(-1)
      expect(val('local a=3 a-=1 return a')).toBe(2)
    })

    it('compound operators written without spaces', () => {
      expect(val('local x=1 x+=1 x*=5 x-=2 x/=2 x%=3 return x')).toBe(1)
      expect(val('local x=0xf0 x&=0x3c x|=0x01 x^^=0xff return x')).toBe(0xce)
    })
  })

  describe('compound assignment', () => {
    it.each([
      ['+=', '10', '3', 13],
      ['-=', '10', '3', 7],
      ['*=', '10', '3', 30],
      ['/=', '10', '4', 2.5],
      ['\\=', '10', '4', 2],
      ['%=', '10', '4', 2],
      ['^=', '2', '3', 8],
      ['..=', '"a"', '"b"', 'ab'],
      ['&=', '0xf0', '0x3c', 0x30],
      ['|=', '0xf0', '0x0f', 0xff],
      ['^^=', '0xff', '0x0f', 0xf0],
      ['<<=', '1', '4', 16],
      ['>>=', '256', '4', 16],
      ['>>>=', '-8', '1', 32764],
      ['<<>=', '0x.0001', '1', 2 * ULP],
      ['>><=', '0x.0001', '1', -32768],
    ])('x %s y', (op, init, rhs, expected) => {
      expect(val(`local x = ${init} x ${op} ${rhs} return x`)).toBe(expected)
      expect(val(`x = ${init} x ${op} ${rhs} return x`)).toBe(expected) // global
      expect(val(`local t = {${init}} t[1] ${op} ${rhs} return t[1]`)).toBe(expected) // array slot
      expect(val(`local t = {v = ${init}} t.v ${op} ${rhs} return t.v`)).toBe(expected) // field
    })

    it('the right-hand side is a whole expression, as if parenthesised', () => {
      expect(val('local x = 10 x -= 3 - 1 return x')).toBe(8)
      expect(val('local x = 10 x /= 2 * 5 return x')).toBe(1)
      expect(val('local x = 2 x *= 2 + 3 return x')).toBe(10)
      expect(val('local x = "a" x ..= "b" .. "c" return x')).toBe('abc')
      expect(val('local x = 1 local y x += y or 4 return x')).toBe(5)
      expect(val('local x = 1 x |= 1 << 2 return x')).toBe(5)
      expect(val('local x = 20 x \\= 2 + 3 return x')).toBe(4)
      expect(val('local x = 17 x %= 3 + 2 return x')).toBe(2)
      expect(val('local x = 2 x ^= 1 + 1 return x')).toBe(4)
      expect(val('local x = 10 x -= 1 == 1 and 4 or 0 return x')).toBe(6)
    })

    it('works on indexed targets, including nested ones', () => {
      expect(val('local t = {a = {b = 5}} t.a.b += 1 t.a.b *= 2 return t.a.b')).toBe(12)
      expect(val('local t = {{1, 2}, {3, 4}} t[2][1] -= 1 return t[2][1]')).toBe(2)
      expect(val('local t, i = {10, 20, 30}, 2 t[i + 1] += 5 t[i - 1] -= 5 return t[3] + t[1]')).toBe(40)
      expect(val('local t = {} t[1] = "x" t[1] ..= "y" return t[1]')).toBe('xy')
      expect(val('local t = {n = 0} for i = 1, 4 do t.n += i end return t.n')).toBe(10)
      expect(val('local t = {s = "k"} t["s"] ..= 1 return t.s')).toBe('k1')
    })

    it('works on upvalues and globals', () => {
      expect(val('local n = 0 local function inc() n += 2 end inc() inc() return n')).toBe(4)
      expect(val('g = 1 function bump() g += 1 end bump() bump() return g')).toBe(3)
    })

    it('several compound statements on one line', () => {
      expect(val('local a, b = 1, 2 a += b b *= a a -= 1 return a * 10 + b')).toBe(26)
    })

    it('goes through __index and __newindex like a read followed by a write', () => {
      const src = `
        local log = {}
        local t = setmetatable({}, {
          __index = function(_, k) return 100 end,
          __newindex = function(_, k, v) log[#log + 1] = k .. "=" .. v end,
        })
        t.x += 1
        return log[1]
      `
      expect(val(src)).toBe('x=101')
    })

    it('evaluates the target expression once (deliberate; PICO-8 may evaluate it twice)', () => {
      // PICO-8 rewrites `a += b` textually into `a = a + (b)`, which would call k() twice here.
      // We evaluate the object and key once. Real carts rarely depend on this; revisit if one does.
      const src = `
        local n = 0
        local function k() n += 1 return 1 end
        local t = {0, 0}
        t[k()] += 5
        return n, t[1]
      `
      expect(vals(src)).toEqual([1, 5])
    })

    it('errors name the variable when the target is nil', () => {
      expect(fail('x += 1')).toBeInstanceOf(LuaError)
      expect(fail('x += 1').message).toBe("attempt to perform arithmetic on a nil value (global 'x')")
      expect(fail('local t = {} t.n += 1').message).toBe("attempt to perform arithmetic on a nil value (field 'n')")
      expect(fail('local s s ..= "a"').message).toBe("attempt to concatenate a nil value (local 's')")
    })

    it.each([
      'x, y += 1, 2',
      'f() += 1',
      '1 += 2',
      'local x += 1',
      'x +=',
      'x & = 1',
      'x + + 1',
      '"s" ..= "t"',
      '(x) += 1',
    ])('rejects: %s', (src) => {
      syntaxError(src, model)
    })

    it('~= is never an assignment operator: xor-assign is ^^=', () => {
      syntaxError('local a = 1 a ~= 3', model)
      expect(val('local a = 6 a ^^= 3 return a')).toBe(5)
    })

    it('a = b ~= c is a comparison, never an assignment operator', () => {
      expect(val('local a, b, c = 0, 1, 2 a = b ~= c return a')).toBe(true)
      expect(val('local a, b = 1, 1 return a ~= b')).toBe(false)
    })
  })

  describe('short if / while', () => {
    it('if (cond) stmt', () => {
      expect(val('local y = 0\nif (true) y = 1\nreturn y')).toBe(1)
      expect(val('local y = 0\nif (false) y = 1\nreturn y')).toBe(0)
      expect(val('local x = 5 local y = 0\nif (x > 3) y = 1\nreturn y')).toBe(1)
    })

    it('if (cond) stmt else stmt', () => {
      expect(val('local y\nif (true) y = 1 else y = 2\nreturn y')).toBe(1)
      expect(val('local y\nif (false) y = 1 else y = 2\nreturn y')).toBe(2)
      expect(val('local y\nif (nil) y = "a" else y = "b"\nreturn y')).toBe('b')
      expect(val('local y\nif (0) y = "a" else y = "b"\nreturn y')).toBe('a') // 0 is truthy
    })

    it('the body extends to the end of the line', () => {
      const src = 'local a, b = 0, 0\nif (false) a = 1 b = 2\nreturn a, b'
      expect(vals(src)).toEqual([0, 0]) // `b = 2` belongs to the if
      expect(vals('local a, b = 0, 0\nif (true) a = 1 b = 2\nreturn a, b')).toEqual([1, 2])
    })

    it('statements on the next line are outside of the if', () => {
      expect(vals('local a, b = 0, 0\nif (false) a = 1\nb = 2\nreturn a, b')).toEqual([0, 2])
    })

    it('several operations in the body, separated by spaces or semicolons', () => {
      expect(val('local n = 0\nif (true) n += 1 n *= 10 n -= 3\nreturn n')).toBe(7)
      expect(val('local n = 0\nif (true) n += 1; n += 1; n += 1\nreturn n')).toBe(3)
      expect(val('local n = 0\nif (false) n += 1 n += 1\nreturn n')).toBe(0)
    })

    it('else must be on the same line', () => {
      expect(vals('local a, b = 0, 0\nif (true) a = 1 else b = 1\nreturn a, b')).toEqual([1, 0])
      expect(vals('local a, b = 0, 0\nif (false) a = 1 else b = 1\nreturn a, b')).toEqual([0, 1])
    })

    it('else-body can hold several statements', () => {
      expect(vals('local a, b = 0, 0\nif (false) a = 1 else a = 5 b = 6\nreturn a, b')).toEqual([5, 6])
    })

    it('nests: the inner if takes the else', () => {
      const run = (a, b) => val(`local r = 0\nif (${a}) if (${b}) r = 1 else r = 2\nreturn r`)
      expect(run('true', 'true')).toBe(1)
      expect(run('true', 'false')).toBe(2)
      expect(run('false', 'true')).toBe(0)
      expect(run('false', 'false')).toBe(0)
    })

    it('works with calls, returns and break in the body', () => {
      expect(val('local function f(x) if (x > 1) return "big" return "small" end return f(2)')).toBe('big')
      expect(val('local function f(x) if (x > 1) return "big"\nreturn "small" end return f(0)')).toBe('small')
      expect(val('local n = 0 for i = 1, 10 do n = i if (i == 4) break end return n')).toBe(4)
      expect(val('local n = 0 local function f() n += 1 end\nif (true) f() f() f()\nreturn n')).toBe(3)
    })

    it('a bare return in the body returns nothing, not the next line', () => {
      expect(vals('local function f(x)\n if (x) return\n return 9\nend\nreturn f(true)')).toEqual([])
      expect(val('local function f(x)\n if (x) return\n return 9\nend\nreturn f(false)')).toBe(9)
    })

    it('a long-form if is still fine, also with a parenthesised condition', () => {
      expect(val('local y = 0 if (true) then y = 1 end return y')).toBe(1)
      expect(val('local y = 0 if (1 + 1) == 2 then y = 1 end return y')).toBe(1)
      expect(val('local y = 0 if (false) or (true) then y = 1 end return y')).toBe(1)
      expect(val('local y = 0 if (true) and (false) then y = 1 else y = 2 end return y')).toBe(2)
      expect(val('local y = 0 if true then y = 1 elseif false then y = 2 else y = 3 end return y')).toBe(1)
    })

    it('a block comment inside the body does not end it early', () => {
      const src = 'local a, b = 0, 0\nif (false) a = 1 --[[ spans\ntwo lines ]] b = 2\nreturn a, b'
      expect(vals(src)).toEqual([0, 0])
    })

    it('long strings inside the body do not end it early', () => {
      const src = 'local s = "none"\nif (false) s = [[a\nb]] s = "set"\nreturn s'
      expect(val(src)).toBe('none')
    })

    it('while (cond) stmt', () => {
      expect(val('local i = 0\nwhile (i < 5) i += 1\nreturn i')).toBe(5)
      expect(val('local i = 0\nwhile (false) i += 1\nreturn i')).toBe(0)
      expect(vals('local i, s = 0, 0\nwhile (i < 4) i += 1 s += i\nreturn i, s')).toEqual([4, 10])
    })

    it('while (cond) body ends at the line end', () => {
      expect(vals('local i, j = 0, 0\nwhile (i < 3) i += 1\nj = 7\nreturn i, j')).toEqual([3, 7])
    })

    it('break works inside a short while', () => {
      expect(val('local i = 0\nwhile (true) i += 1 if (i >= 3) break\nreturn i')).toBe(3)
    })

    it('the long forms still work', () => {
      expect(val('local i = 0 while i < 3 do i += 1 end return i')).toBe(3)
      expect(val('local i = 0 while (i < 3) do i += 1 end return i')).toBe(3)
    })

    it.each([
      ['if x y = 1', /'then' expected/],
      ['if x == 1 y = 1', /'then' expected/],
      ['while x y = 1', /'do' expected/],
      ['while x < 3 y = 1', /'do' expected/],
      ['if (x) then y = 1', /'end' expected/],
    ])('requires parentheses (or then/do): %s', (src, message) => {
      expect(syntaxError(src, model).message).toMatch(message)
    })
  })

  describe('? print shorthand', () => {
    it('?expr prints', () => {
      expect(out('?"hi"')).toEqual(['hi'])
      expect(out('? "hi"')).toEqual(['hi'])
      expect(out('?1 + 2')).toEqual(['3'])
      expect(out('?nil')).toEqual(['[nil]'])
      expect(out('?true')).toEqual(['true'])
    })

    it('takes a full expression list', () => {
      expect(out('?"a", 1 + 1, "c"')).toEqual(['a 2 c'])
      expect(out('local x = 3 ?x * 2, x ^ 2')).toEqual(['6 9'])
      expect(out('?(1 + 2) * 3')).toEqual(['9'])
      expect(out('?"a" .. "b"')).toEqual(['ab'])
    })

    it('several on a line, or mixed with other statements', () => {
      expect(out('?1 ?2 ?3')).toEqual(['1', '2', '3'])
      expect(out('local x = 4 ?x x += 1 ?x')).toEqual(['4', '5'])
      expect(out('?"a"\n?"b"\n')).toEqual(['a', 'b'])
    })

    it('the arguments stop at the end of the expression', () => {
      expect(out('?1 local x = 2 ?x')).toEqual(['1', '2'])
    })

    it('works as the body of a short if / while and in loops', () => {
      expect(out('if (true) ?"yes" else ?"no"')).toEqual(['yes'])
      expect(out('if (false) ?"yes" else ?"no"')).toEqual(['no'])
      expect(out('local i = 0 while (i < 3) i += 1 ?i')).toEqual(['1', '2', '3'])
      expect(out('for i = 1, 3 do ?i end')).toEqual(['1', '2', '3'])
    })

    it('calls whatever global `print` currently is', () => {
      expect(val('function print(s) r = s end ?"hey" return r')).toBe('hey')
    })

    it('a call may be printed', () => {
      expect(out('local function f() return 1, 2 end ?f()')).toEqual(['1 2'])
    })

    it('needs at least one argument', () => {
      syntaxError('?', model)
      syntaxError('?\nreturn 1', model)
    })
  })

  describe('floor division \\', () => {
    it.each([
      ['9 \\ 2', 4],
      ['-9 \\ 2', -5],
      ['9 \\ -2', -5],
      ['-9 \\ -2', 4],
      ['7.5 \\ 2', 3],
      ['9 \\ 2.5', 3],
      ['8 \\ 2', 4],
      ['0 \\ 5', 0],
      ['1 \\ 2', 0],
      ['-1 \\ 2', -1],
    ])('%s', (src, expected) => {
      expect(val(`return ${src}`)).toBe(expected)
    })

    it('is left associative and shares a level with * / %', () => {
      expect(val('return 100 \\ 10 \\ 3')).toBe(3)
      expect(val('return 7 \\ 2 * 2')).toBe(6)
      expect(val('return 7 * 2 \\ 4')).toBe(3)
      expect(val('return 1 + 7 \\ 2')).toBe(4)
    })

    it('unary minus binds tighter than \\', () => {
      expect(val('return -3 \\ 2')).toBe(-2)
    })

    it('uses __idiv-free semantics: tables without a metamethod are errors', () => {
      expect(fail('return {} \\ 2').message).toMatch(/arithmetic on a table value/)
    })

    it('% is floored, like Lua', () => {
      expect(val('return -7 % 3')).toBe(2)
      expect(val('return 7 % -3')).toBe(-2)
      expect(val('return 5.5 % 2')).toBe(1.5)
    })
  })

  describe('bitwise operators', () => {
    it.each([
      ['0xf0 & 0x3c', 0x30],
      ['0xf0 | 0x0f', 0xff],
      ['0xff ^^ 0x0f', 0xf0],
      ['0xf0 ^^ 0xf0', 0],
      ['5 & 3', 1],
      ['5 | 3', 7],
      ['5 ^^ 3', 6],
      ['1 << 4', 16],
      ['256 >> 4', 16],
      ['-8 >> 1', -4],
      ['-8 >>> 1', 32764],
      ['8 >>> 1', 4],
      ['0x.0001 <<> 1', 2 * ULP],
      ['0x.0001 <<> 16', 1],
      ['1 <<> 16', ULP],
      ['0x.0001 >>< 1', -32768],
      ['1 >>< 16', ULP],
    ])('%s', (src, expected) => {
      expect(val(`return ${src}`)).toBe(expected)
    })

    it('unary ~ flips every bit of the 16.16 pattern', () => {
      expect(val('return ~0')).toBe(-ULP)
      expect(val('return ~5')).toBe(-5 - ULP)
      expect(val('return ~~5')).toBe(5)
      expect(val('return ~5 & 0xff')).toBe(250)
      expect(val('return ~1 + 1')).toBe(-ULP) // unary binds tighter than +
    })

    it('binary operands keep their fractional bits', () => {
      expect(val('return 0x1.8 & 0x3.c')).toBe(1.5)
      expect(val('return 0x1.8 | 0x0.4')).toBe(1.75)
      expect(val('return 0x1.8 ^^ 0x1.8')).toBe(0)
    })

    it('shift counts of 32 or more clear the value', () => {
      expect(val('return 1 << 32')).toBe(0)
      expect(val('return 1 >> 32')).toBe(0)
    })

    it('non-numbers are errors', () => {
      expect(fail('return {} & 1').message).toMatch(/bitwise operation on a table value|arithmetic on a table value/)
    })

    it('(version-dependent) binary ~ is accepted as xor', () => {
      expect(val('return 5 ~ 3')).toBe(6)
      expect(val('return 5 ~ 3 & 1')).toBe(5 ^ (3 & 1))
    })
  })

  describe('precedence and associativity', () => {
    it.each([
      // arithmetic
      ['1 + 2 * 3', 7],
      ['(1 + 2) * 3', 9],
      ['2 * 3 % 4', 2],
      ['10 - 3 - 2', 5],
      ['100 / 10 / 5', 2],
      ['23 % 7 % 3', 2],
      ['2 * 3 / 4', 1.5],
      ['3 - -3', 6],
      ['- -3', 3],
      ['-2 * 3', -6],
      // ^ is right associative and binds tighter than unary operators
      ['-2 ^ 2', -4],
      ['2 ^ -1', 0.5],
      ['2 ^ 3 ^ 2', 512],
      ['-2 ^ 2 ^ 2', -16],
      ['-2 ^ 2 + 1', -3],
      ['2 ^ 2 * 3', 12],
      ['#"ab" * 2', 4],
      ['#"abc" + 1', 4],
      // shifts sit below + - and above &
      ['1 + 1 << 2', 8],
      ['1 << 2 + 1', 8],
      ['2 + 3 << 1', 10],
      ['8 >> 1 << 1', 8],
      ['6 & 1 << 1', 2],
      // & above ^^ above |
      ['6 | 1 ^^ 3 & 2', 7],
      ['1 | 2 | 4', 7],
      // ... and comparisons sit below all bitwise operators
      ['1 | 2 == 3', true],
      ['5 & 3 == 1', true],
      ['1 ^^ 3 == 2', true],
      ['1 << 1 == 2', true],
      ['1 | 2 ~= 3', false],
      ['1 | 2 != 3', false],
      // .. is below + - and above shifts
      ['1 .. 2 + 3', '15'],
      ['1 + 2 .. 3 + 4', '37'],
      ['"a" .. "b" == "ab"', true],
      ['1 .. 2 << 1', 24],
      // comparisons
      ['1 < 2 == true', true],
      ['1 < 2 and 2 < 3', true],
      ['1 != 2 == true', true],
      ['1 == 1 and 2 ~= 3', true],
      // logic
      ['not 1 == 2', false],
      ['not (1 == 2)', true],
      ['not nil and 1', 1],
      ['nil or false and 1', false],
      ['false and nil or 5', 5],
      ['nil and 1 or 2', 2],
      ['1 or 2 and 3', 1],
      ['(1 or 2) and 3', 3],
      ['1 and 2 or 3', 2],
    ])('%s', (src, expected) => {
      expect(val(`return ${src}`)).toBe(expected)
    })

    it('.. is right associative', () => {
      const src = `
        local mt = {__concat = function(a, b)
          return "(" .. (type(a) == "table" and a.n or a) .. "+" .. (type(b) == "table" and b.n or b) .. ")"
        end}
        local x, y, z = setmetatable({n = "x"}, mt), setmetatable({n = "y"}, mt), setmetatable({n = "z"}, mt)
        return x .. y .. z
      `
      expect(val(src)).toBe('(x+(y+z))')
    })

    it('^ is right associative with metamethods too', () => {
      const src = `
        local mt = {__pow = function(a, b)
          return setmetatable({n = "(" .. a.n .. "^" .. (type(b) == "table" and b.n or b) .. ")"}, getmetatable(a))
        end}
        local a = setmetatable({n = "a"}, mt)
        return (a ^ 2 ^ 3).n
      `
      // 2 ^ 3 is evaluated first (8), then a ^ 8
      expect(val(src)).toBe('(a^8)')
    })

    it('binary operators of equal precedence group to the left', () => {
      const src = `
        local log = {}
        local function v(n) log[#log + 1] = n return n end
        local r = v(1) - v(2) - v(3)
        return r, log[1] .. log[2] .. log[3]
      `
      expect(vals(src)).toEqual([-4, '123'])
    })

    it('and / or short-circuit and keep the deciding operand', () => {
      expect(val('local n = 0 local function f() n += 1 return true end local _ = false and f() return n')).toBe(0)
      expect(val('local n = 0 local function f() n += 1 return true end local _ = true or f() return n')).toBe(0)
      expect(vals('return nil or "d", false or nil, 0 and "z"')).toEqual(['d', undefined, 'z'])
    })

    it('unary operators nest', () => {
      expect(val('return not not nil')).toBe(false)
      expect(val('return - - - 2')).toBe(-2)
      expect(val('return #"abc" == 3')).toBe(true)
      expect(val('return -#"abc"')).toBe(-3)
      expect(val('return ~ ~7')).toBe(7)
      expect(val('return -~0')).toBe(ULP)
    })
  })

  describe('memory prefix operators', () => {
    /** @param {string} src */
    const run = (src) =>
      /** @type {any} */ (
        compile(src, {
          model,
          host: /** @type {any} */ ({ peek: (a) => a * 10, peek2: (a) => a * 100, peek4: (a) => a * 1000 }),
        }).run()
      )

    it('@ % $ read one, two and four bytes', () => {
      expect(run('return @2')).toBe(20)
      expect(run('return %2')).toBe(200)
      expect(run('return $2')).toBe(2000)
    })

    it('unary % versus binary %', () => {
      expect(run('return 7 % 3')).toBe(1)
      expect(run('return 5 %2')).toBe(1)
      expect(run('local a = 7 return a %2')).toBe(1)
      expect(run('local a = 7 return a % 2')).toBe(1)
      expect(run('return 1 + %2')).toBe(201)
      expect(run('return %2 % 7')).toBe(4)
      expect(run('return %%2')).toBe(20000)
      expect(run('local t = {1} return t[1] %2')).toBe(1)
      expect(run('local a = (7) return (a) %2')).toBe(1)
    })

    it('bind like other unary operators', () => {
      expect(run('return @1 + 1')).toBe(11)
      expect(run('return @(1 + 1)')).toBe(20)
      expect(run('return -@1')).toBe(-10)
      expect(run('local t = {3} return @t[1]')).toBe(30)
      expect(run('return @2 + %2 + $2')).toBe(2220)
      expect(run('return not @1')).toBe(false)
    })

    it('work as statements operands and assignment values', () => {
      expect(run('local a = @1 local b = %1 a += b return a')).toBe(110)
      expect(run('local t = {} t[@1] = 5 return t[10]')).toBe(5)
    })

    it('read 0 when the host has no memory', () => {
      expect(val('return @1, %1, $1')).toBe(0)
      expect(vals('return @1, %1, $1')).toEqual([0, 0, 0])
    })
  })

  describe('rest of the dialect that stays the same as Lua 5.2', () => {
    it('goto and labels (continue and nested break-out)', () => {
      const cont = `
        local s = 0
        for i = 1, 5 do
          if (i % 2 == 0) goto continue
          s += i
          ::continue::
        end
        return s
      `
      expect(val(cont)).toBe(9)
      const nested = `
        local n = 0
        for i = 1, 3 do
          for j = 1, 3 do
            n += 1
            if (i == 2 and j == 2) goto done
          end
        end
        ::done::
        return n
      `
      expect(val(nested)).toBe(5)
    })

    it('backward goto makes a loop', () => {
      expect(val('local i = 0 ::top:: i += 1 if (i < 4) goto top\nreturn i')).toBe(4)
    })

    it('varargs, select and table packing', () => {
      expect(val('local function f(...) return select("#", ...) end return f(nil, nil)')).toBe(2)
      expect(vals('local function f(...) local t = {...} return #t, t[1], t[3] end return f(5, 6, 7)')).toEqual([3, 5, 7])
      expect(vals('local function f(...) return ... end return f(1, 2, 3)')).toEqual([1, 2, 3])
      expect(vals('local function f(...) return select(2, ...) end return f("a", "b", "c")')).toEqual(['b', 'c'])
    })

    it('multiple assignment and returns', () => {
      expect(vals('local a, b, c = 1, 2 return a, b, c')).toEqual([1, 2, undefined])
      expect(vals('local a, b = 1, 2 a, b = b, a return a, b')).toEqual([2, 1])
      expect(vals('local function f() return 1, 2, 3 end local a, b = f() return a, b')).toEqual([1, 2])
      expect(vals('local function f() return 1, 2, 3 end return f(), f()')).toEqual([1, 1, 2, 3])
      expect(vals('local function f() return 1, 2, 3 end return (f())')).toEqual([1])
      expect(vals('local t = {5, 6} local i = 1 i, t[i] = i + 1, 20 return i, t[1], t[2]')).toEqual([2, 20, 6])
    })

    it('swaps through indexed targets', () => {
      expect(val('local a = {1, 2} a[1], a[2] = a[2], a[1] return a[1] * 10 + a[2]')).toBe(21)
    })

    it('closures capture variables, not values', () => {
      const src = 'local n = 0 local function inc() n += 1 return n end local function get() return n end inc() inc() return get()'
      expect(val(src)).toBe(2)
      expect(val('local fs = {} for i = 1, 3 do fs[i] = function() return i end end return fs[1]() + fs[2]() + fs[3]()')).toBe(6)
    })

    it('repeat-until sees the body locals', () => {
      expect(val('local n = 0 repeat local done = n >= 2 n += 1 until done return n')).toBe(3)
    })

    it('methods, string-call and table-call sugar', () => {
      expect(val('local o = {v = 2} function o:get(k) return self.v * k end return o:get(5)')).toBe(10)
      expect(val('local function id(x) return x end return id"s"')).toBe('s')
      expect(val('local function n(t) return #t end return n{1, 2, 3}')).toBe(3)
    })

    it('numeric for with negative and fractional steps', () => {
      expect(val('local s = "" for i = 3, 1, -1 do s ..= i end return s')).toBe('321')
      expect(val('local n = 0 for i = 0, 1, 0.25 do n += 1 end return n')).toBe(5)
      expect(val('local n = 0 for i = 1, 0 do n += 1 end return n')).toBe(0)
    })

    it('semicolons are optional statement separators', () => {
      expect(val('local a = 1; local b = 2; ; return a + b;')).toBe(3)
    })

    it('string escapes: decimal, hex and the PICO-8 control escapes', () => {
      expect(val('return "\\65\\x42"')).toBe('AB')
      expect(val('return #"\\*\\#\\-\\|\\+\\^"')).toBe(6)
      expect(val('return "\\*"')).toBe('\x01')
      expect(val('return "a\\z   \n   b"')).toBe('ab')
    })

    it('there is no integer division operator spelled //', () => {
      expect(val('return 9 // 2')).toBe(9)
    })
  })

  describe('things that are not Lua code', () => {
    it('#include is handled by the cart loader, so the Lua parser rejects it', () => {
      syntaxError('#include other.lua', model)
      syntaxError('#include', model)
    })

    it('# is the length operator wherever an expression is expected', () => {
      expect(val('return #{1, 2, 3}')).toBe(3)
      expect(val('return #"abc"')).toBe(3)
    })
  })

  describe('error lines with dialect syntax', () => {
    it('after a shorthand if', () => {
      expect(fail('local x = 1\nif (x) x += 1\nlocal y = nil + 1').line).toBe(3)
    })

    it('inside a shorthand if body', () => {
      expect(fail('local x = 1\nif (x) x += nil\nlocal y = 2').line).toBe(2)
    })

    it('after compound assignments and ? statements', () => {
      expect(fail('local x = 1\nx += 1\n?x\nx ..= {}').line).toBe(4)
    })

    it('after a multi-line long string', () => {
      expect(fail('local s = [[a\nb\nc]]\nlocal y = nil + 1').line).toBe(4)
    })
  })
})
