import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { parse } from '../../src/lua/parser.js'
import { parseP8 } from '../../src/formats/p8.js'
import { decodeP8Png } from '../../src/formats/p8png.js'
import { LuaSyntaxError } from '../../src/lua/errors.js'
import { e, s } from '../helpers/lua-sexp.js'

const bad = (/** @type {string} */ src, /** @type {RegExp | string} */ msg) => {
  expect(() => parse(src)).toThrow(LuaSyntaxError)
  expect(() => parse(src)).toThrow(msg)
}

describe('literals', () => {
  it('parses constants', () => {
    expect(e('nil')).toBe('nil')
    expect(e('true')).toBe('true')
    expect(e('false')).toBe('false')
    expect(e('12.5')).toBe('12.5')
    expect(e('"hi"')).toBe('"hi"')
    expect(e('[[hi]]')).toBe('"hi"')
    expect(e('0x10')).toBe('16')
  })

  it('parses an empty program', () => {
    expect(parse('')).toMatchObject({ type: 'Chunk', body: [] })
    expect(s('')).toBe('')
    expect(s(' -- nothing\n')).toBe('')
    expect(s(';;;')).toBe('')
  })
})

describe('table constructors', () => {
  it('parses empty, positional and keyed tables', () => {
    expect(e('{}')).toBe('(table)')
    expect(e('{1,2,3}')).toBe('(table 1 2 3)')
    expect(e('{x=1,y=2}')).toBe('(table (= "x" 1) (= "y" 2))')
    expect(e('{[1]=2,["a b"]=3}')).toBe('(table (= 1 2) (= "a b" 3))')
  })

  it('accepts both , and ; as separators and an optional trailing one', () => {
    expect(e('{1;2;3}')).toBe('(table 1 2 3)')
    expect(e('{1,2,}')).toBe('(table 1 2)')
    expect(e('{1;2;}')).toBe('(table 1 2)')
    expect(e('{1,2;3}')).toBe('(table 1 2 3)')
  })

  it('mixes the forms in order', () => {
    expect(e('{1,x=2,[3]=4,5}')).toBe('(table 1 (= "x" 2) (= 3 4) 5)')
  })

  it('distinguishes {x=1} from {x==1}', () => {
    expect(e('{x=1}')).toBe('(table (= "x" 1))')
    expect(e('{x==1}')).toBe('(table (== @x 1))')
  })

  it('treats a name that is a local as a key only when followed by =', () => {
    expect(s('local x = 1 return {x}')).toBe('(local (x) (1)) (return (table x))')
    expect(s('local x = 1 return {x=x}')).toBe('(local (x) (1)) (return (table (= "x" x)))')
  })

  it('nests tables', () => {
    expect(e('{{1,2},{3,{4}}}')).toBe('(table (table 1 2) (table 3 (table 4)))')
    expect(e('{a={b={c=1}}}')).toBe('(table (= "a" (table (= "b" (table (= "c" 1))))))')
  })

  it('allows nil, calls, varargs and functions as values', () => {
    expect(e('{nil,nil}')).toBe('(table nil nil)')
    expect(e('{f()}')).toBe('(table (call @f))')
    expect(e('{x=nil}')).toBe('(table (= "x" nil))')
    expect(s('function f(...) return {...} end')).toBe('(assign (@f) ((function (...) (return (table ...)))))')
    expect(e('{function() end}')).toBe('(table (function ()))')
  })

  it('allows a keyword-like name as a bracketed key but not bare', () => {
    expect(e('{["end"]=1}')).toBe('(table (= "end" 1))')
    bad('return {end=1}', /unexpected symbol/)
  })

  it('rejects malformed tables', () => {
    bad('return {1,,2}', /unexpected symbol/)
    bad('return {1', /'}' expected/)
    bad('return {[1]}', /'=' expected/)
    bad('return {x=}', /unexpected symbol/)
    bad('return {\n1,\n2', /'}' expected \(to close '\{' at line 1\)/)
  })

  it('table constructors may be indexed and called only through parentheses', () => {
    expect(e('({1,2})[1]')).toBe('(idx (paren (table 1 2)) 1)')
    bad('return {1,2}[1]', /'<eof>' expected|unexpected/)
    expect(e('#{1,2}')).toBe('(# (table 1 2))')
  })
})

describe('names and indexing', () => {
  it('resolves unknown names as globals and declared names as locals', () => {
    expect(s('x = y')).toBe('(assign (@x) (@y))')
    expect(s('local x = 1 x = x')).toBe('(local (x!) (1)) (assign (x!) (x!))')
  })

  it('parses dot, bracket and chained access', () => {
    expect(e('a.b')).toBe('(idx @a "b")')
    expect(e('a.b.c')).toBe('(idx (idx @a "b") "c")')
    expect(e('a[1]')).toBe('(idx @a 1)')
    expect(e('a[b][c]')).toBe('(idx (idx @a @b) @c)')
    expect(e('a.b[1].c')).toBe('(idx (idx (idx @a "b") 1) "c")')
    expect(e('a["x y"]')).toBe('(idx @a "x y")')
    expect(e('a[nil]')).toBe('(idx @a nil)')
    expect(e('a[a[1]]')).toBe('(idx @a (idx @a 1))')
  })

  it('does not treat a keyword as a field name', () => {
    bad('return a.end', /<name> expected/)
    bad('return a.nil', /<name> expected/)
    bad('return a.1', /expected/)
  })

  it('treats a glyph byte as an ordinary global', () => {
    expect(e('btn(\x8b)')).toBe('(call @btn @\x8b)')
  })

  it('a field name may be anything that is not a keyword, including a builtin function name', () => {
    expect(e('t.add')).toBe('(idx @t "add")')
    expect(e('t.x.y.z')).toBe('(idx (idx (idx @t "x") "y") "z")')
  })
})

describe('calls', () => {
  it('parses calls with and without arguments', () => {
    expect(e('f()')).toBe('(call @f)')
    expect(e('f(1)')).toBe('(call @f 1)')
    expect(e('f(1,2,3)')).toBe('(call @f 1 2 3)')
    expect(e('f(g(1))')).toBe('(call @f (call @g 1))')
    expect(e('f()()')).toBe('(call (call @f))')
    expect(e('f(nil,nil)')).toBe('(call @f nil nil)')
      })

  it('parses string and table call sugar', () => {
    expect(e('f"x"')).toBe('(call @f "x")')
    expect(e("f'x'")).toBe('(call @f "x")')
    expect(e('f[[x]]')).toBe('(call @f "x")')
    expect(e('f{1,2}')).toBe('(call @f (table 1 2))')
    expect(e('f"a""b"')).toBe('(call (call @f "a") "b")')
    expect(e('f{}.x')).toBe('(idx (call @f (table)) "x")')
  })

  it('parses method calls', () => {
    expect(e('o:m()')).toBe('(mcall @o m)')
    expect(e('o:m(1,2)')).toBe('(mcall @o m 1 2)')
    expect(e('o:m"x"')).toBe('(mcall @o m "x")')
    expect(e('o:m{}')).toBe('(mcall @o m (table))')
    expect(e('a.b:c(1)')).toBe('(mcall (idx @a "b") c 1)')
    expect(e('a:b():c()')).toBe('(mcall (mcall @a b) c)')
    expect(e('a[1]:m()')).toBe('(mcall (idx @a 1) m)')
    expect(e('("x"):rep(3)')).toBe('(mcall (paren "x") rep 3)')
  })

  it('requires arguments after a method name', () => {
    bad('return o:m', /function arguments expected/)
    bad('o:m = 1', /function arguments expected/)
  })

  it('keeps parentheses (they truncate multiple values)', () => {
    expect(e('(f())')).toBe('(paren (call @f))')
    expect(e('((1))')).toBe('(paren (paren 1))')
    expect(e('(f)()')).toBe('(call (paren @f))')
  })

  it('rejects unclosed argument lists', () => {
    bad('f(1', /'\)' expected/)
    bad('f(1,', /unexpected symbol/)
    bad('f(\n1\n', /'\)' expected \(to close '\(' at line 1\)/)
  })

  it('a call with a literal is not a call on a literal', () => {
    bad('"x"()', /syntax error|unexpected symbol/)
    bad('1()', /syntax error|unexpected symbol/)
    bad('nil()', /unexpected symbol/)
  })
})

describe('operator precedence', () => {
  it('multiplication binds tighter than addition', () => {
    expect(e('1+2*3')).toBe('(+ 1 (* 2 3))')
    expect(e('1*2+3')).toBe('(+ (* 1 2) 3)')
  })

  it('is left associative for arithmetic', () => {
    expect(e('1-2-3')).toBe('(- (- 1 2) 3)')
    expect(e('8/4/2')).toBe('(/ (/ 8 4) 2)')
    expect(e('a\\b\\c')).toBe('(\\ (\\ @a @b) @c)')
    expect(e('a%b%c')).toBe('(% (% @a @b) @c)')
  })

  it('is right associative for ^ and ..', () => {
    expect(e('2^3^2')).toBe('(^ 2 (^ 3 2))')
    expect(e('a..b..c')).toBe('(.. @a (.. @b @c))')
  })

  it('^ binds tighter than unary minus, in both directions', () => {
    expect(e('-2^2')).toBe('(- (^ 2 2))')
    expect(e('2^-2')).toBe('(^ 2 (- 2))')
    expect(e('-x^-y')).toBe('(- (^ @x (- @y)))')
    expect(e('not a^b')).toBe('(not (^ @a @b))')
  })

  it('unary operators bind tighter than * and +', () => {
    expect(e('-a*b')).toBe('(* (- @a) @b)')
    expect(e('-a+b')).toBe('(+ (- @a) @b)')
    expect(e('#t+1')).toBe('(+ (# @t) 1)')
    expect(e('not a==b')).toBe('(== (not @a) @b)')
    expect(e('- -a')).toBe('(- (- @a))')
    expect(e('not not a')).toBe('(not (not @a))')
    expect(e('-#t')).toBe('(- (# @t))')
  })

  it('.. is below + and above comparison', () => {
    expect(e('a..b+c')).toBe('(.. @a (+ @b @c))')
    expect(e('a..b==c')).toBe('(== (.. @a @b) @c)')
    expect(e('1 .. 2')).toBe('(.. 1 2)')
  })

  it('and binds tighter than or', () => {
    expect(e('a or b and c')).toBe('(or @a (and @b @c))')
    expect(e('a and b or c')).toBe('(or (and @a @b) @c)')
    expect(e('a or b or c')).toBe('(or (or @a @b) @c)')
  })

  it('comparison is below arithmetic and above and/or', () => {
    expect(e('a+1<b*2')).toBe('(< (+ @a 1) (* @b 2))')
    expect(e('a<b and c>d')).toBe('(and (< @a @b) (> @c @d))')
    expect(e('a==b or c~=d')).toBe('(or (== @a @b) (~= @c @d))')
    expect(e('a<=b')).toBe('(<= @a @b)')
    expect(e('a>=b')).toBe('(>= @a @b)')
  })

  it('treats != as ~=', () => {
    expect(e('a!=b')).toBe('(~= @a @b)')
    expect(e('a!=b and c')).toBe('(and (~= @a @b) @c)')
  })

  it('has the bitwise operators between comparison and ..', () => {
    expect(e('a|b&c')).toBe('(| @a (& @b @c))')
    expect(e('a|b^^c&d')).toBe('(| @a (^^ @b (& @c @d)))')
    expect(e('a&b<<c')).toBe('(& @a (<< @b @c))')
    expect(e('a<<b+c')).toBe('(<< @a (+ @b @c))')
    expect(e('a<<b..c')).toBe('(<< @a (.. @b @c))')
    expect(e('a==b|c')).toBe('(== @a (| @b @c))')
  })

  it('reads ~ as xor in binary position and bnot in unary position', () => {
    expect(e('a~b')).toBe('(^^ @a @b)')
    expect(e('~a')).toBe('(~ @a)')
    expect(e('~a~b')).toBe('(^^ (~ @a) @b)')
    expect(e('a~~b')).toBe('(^^ @a (~ @b))')
    expect(e('a ~ ~b')).toBe('(^^ @a (~ @b))')
  })

  it('parses all shift and rotate operators', () => {
    expect(e('a<<b')).toBe('(<< @a @b)')
    expect(e('a>>b')).toBe('(>> @a @b)')
    expect(e('a>>>b')).toBe('(>>> @a @b)')
    expect(e('a<<>b')).toBe('(<<> @a @b)')
    expect(e('a>><b')).toBe('(>>< @a @b)')
    expect(e('a<<b>>c')).toBe('(>> (<< @a @b) @c)')
  })

  it('parses the peek operators @ % $', () => {
    expect(e('@0x5f00')).toBe('(@ 24320)')
    expect(e('%0x5f00')).toBe('(% 24320)')
    expect(e('$0x5f00')).toBe('($ 24320)')
    expect(e('@a+1')).toBe('(+ (@ @a) 1)')
    expect(e('@(a+1)')).toBe('(@ (paren (+ @a 1)))')
    expect(e('@@a')).toBe('(@ (@ @a))')
  })

  it('% is modulo as a binary operator and peek2 as a prefix one', () => {
    expect(e('a%b')).toBe('(% @a @b)')
    expect(e('a%%b')).toBe('(% @a (% @b))')
    expect(e('%a%b')).toBe('(% (% @a) @b)')
  })

  it('parentheses override precedence', () => {
    expect(e('(1+2)*3')).toBe('(* (paren (+ 1 2)) 3)')
    expect(e('-(a)')).toBe('(- (paren @a))')
  })

  it('handles long chains without trouble', () => {
    const src = Array.from({ length: 300 }, (_, i) => i).join('+')
    expect(e(src).startsWith('(+ (+ (+')).toBe(true)
    const deep = '('.repeat(150) + '1' + ')'.repeat(150)
    expect(e(deep).startsWith('(paren (paren')).toBe(true)
  })
})

describe('function expressions', () => {
  it('parses anonymous functions', () => {
    expect(e('function() end')).toBe('(function ())')
    expect(e('function(a,b) return a+b end')).toBe('(function (a b) (return (+ a b)))')
    expect(e('function(...) end')).toBe('(function (...))')
    expect(e('function(a,...) end')).toBe('(function (a ...))')
  })

  it('rejects ... outside vararg functions', () => {
    bad('return function() return ... end', /cannot use '...' outside a vararg function/)
    expect(() => parse('return ...')).not.toThrow() // the main chunk is vararg
    expect(() => parse('return function(...) return function(...) return ... end end')).not.toThrow()
    bad('return function(...) return function() return ... end end', /cannot use '...'/)
  })

  it('rejects a bad parameter list', () => {
    bad('function f(a,) end', /<name> expected/)
    bad('function f(...,a) end', /'\)' expected/)
    bad('function f(1) end', /<name> expected/)
    bad('function f(a b) end', /'\)' expected/)
    bad('function f a end', /'\(' expected/)
  })

  it('reports an unclosed function with its opening line', () => {
    bad('function f()\n  x=1\n', /'end' expected \(to close 'function' at line 1\) near <eof>/)
  })

  it('records the end line', () => {
    const [stat] = parse('local f = function()\n\nend').body
    if (stat.type !== 'LocalDecl') throw new Error('x')
    const fn = stat.values[0]
    if (fn.type !== 'Function') throw new Error('x')
    expect(fn.endLine).toBe(3)
    expect(fn.line).toBe(1)
  })
})

describe('function statements', () => {
  it('declares a global function', () => {
    expect(s('function f(a) return a end')).toBe('(assign (@f) ((function (a) (return a))))')
  })

  it('declares a field function', () => {
    expect(s('function a.b.c() end')).toBe('(assign ((idx (idx @a "b") "c")) ((function ())))')
  })

  it('declares a method with an implicit self', () => {
    expect(s('function a:m(x) return self end')).toBe('(assign ((idx @a "m")) ((function (self x) (return self))))')
    expect(s('function a.b:m() end')).toBe('(assign ((idx (idx @a "b") "m")) ((function (self))))')
  })

  it('assigns to a local when the name is a local', () => {
    expect(s('local f function f() end')).toBe('(local (f!)) (assign (f!) ((function ())))')
  })

  it('declares a local function that can see itself', () => {
    expect(s('local function f() return f end')).toBe('(localfn f^ (function () (return f^)))')
  })

  it('a plain local assigned from a function does not see itself', () => {
    expect(s('local f = function() return f end')).toBe('(local (f) ((function () (return @f))))')
  })

  it('does not allow a method in the middle of a name', () => {
    bad('function a:b.c() end', /'\(' expected/)
  })

  it('does not allow a field of a call', () => {
    bad('function f().x() end', /unexpected symbol/)
  })
})

describe('assignment', () => {
  it('parses single and multiple assignment', () => {
    expect(s('a=1')).toBe('(assign (@a) (1))')
    expect(s('a,b=1,2')).toBe('(assign (@a @b) (1 2))')
    expect(s('a,b=1')).toBe('(assign (@a @b) (1))')
    expect(s('a=1,2')).toBe('(assign (@a) (1 2))')
    expect(s('a,b=b,a')).toBe('(assign (@a @b) (@b @a))')
    expect(s('t.x,t[1],y=1,2,3')).toBe('(assign ((idx @t "x") (idx @t 1) @y) (1 2 3))')
    expect(s('a=f()')).toBe('(assign (@a) ((call @f)))')
    expect(s('a,b=f()')).toBe('(assign (@a @b) ((call @f)))')
  })

  it('assigns to nil keys syntactically (the runtime rejects it)', () => {
    expect(s('t[nil]=1')).toBe('(assign ((idx @t nil)) (1))')
  })

  it('rejects things that cannot be assigned to', () => {
    bad('f() = 1', /cannot assign/)
    bad('(a) = 1', /cannot assign/)
    bad('1 = 1', /unexpected symbol/)
    bad('a, f() = 1, 2', /cannot assign/)
    bad('nil = 1', /unexpected symbol/)
    bad('"x" = 1', /unexpected symbol/)
    bad('a + b = 1', /syntax error|unexpected|'=' expected/)
  })

  it('rejects a statement that is just an expression', () => {
    bad('a', /syntax error/)
    bad('a.b', /syntax error/)
    bad('a == b', /syntax error/)
    bad('(f())', /syntax error/)
  })

  it('rejects a missing right-hand side', () => {
    bad('a =', /unexpected symbol near <eof>/)
    bad('a, b', /'=' expected/)
  })

  it('marks locals that are assigned after declaration', () => {
    expect(s('local a = 1 local b = 2 a = 3')).toBe('(local (a!) (1)) (local (b) (2)) (assign (a!) (3))')
    expect(s('local a, b a, b = 1, 2')).toBe('(local (a! b!)) (assign (a! b!) (1 2))')
  })

  it('marks locals captured by closures', () => {
    expect(s('local a = 1 local function f() return a end')).toBe('(local (a^) (1)) (localfn f (function () (return a^)))')
    expect(s('local a = 1 local function f() a = 2 end')).toBe('(local (a!^) (1)) (localfn f (function () (assign (a!^) (2))))')
    // using a function's own local inside the function is not a capture
    expect(s('local function f() local a = 1 return a end')).toBe('(localfn f (function () (local (a) (1)) (return a)))')
  })

  it('marks a local captured from two functions up', () => {
    expect(s('local a return function() return function() return a end end')).toBe(
      '(local (a^)) (return (function () (return (function () (return a^)))))',
    )
  })
})

describe('compound assignment', () => {
  it('parses each arithmetic and bitwise operator', () => {
    for (const op of ['+', '-', '*', '/', '\\', '%', '..', '^', '|', '&', '^^', '<<', '>>', '>>>', '<<>', '>><']) {
      expect(s(`a ${op}= 1`)).toBe(`(${op}= @a 1)`)
    }
  })

  it('applies to fields and indices', () => {
    expect(s('t.x += 1')).toBe('(+= (idx @t "x") 1)')
    expect(s('t[i] *= 2')).toBe('(*= (idx @t @i) 2)')
    expect(s('t[i+1][j] ..= "x"')).toBe('(..= (idx (idx @t (+ @i 1)) @j) "x")')
  })

  it('takes a whole expression on the right', () => {
    expect(s('a += b * 2 + 1')).toBe('(+= @a (+ (* @b 2) 1))')
    expect(s('a -= f(x)')).toBe('(-= @a (call @f @x))')
  })

  it('~= is never an assignment operator (xor-assign is ^^=)', () => {
    bad('a ~= 3', /syntax error/)
    expect(s('a ^^= 3')).toBe('(^^= @a 3)')
  })

  it('marks a local as assigned', () => {
    expect(s('local a = 1 a += 1')).toBe('(local (a!) (1)) (+= a! 1)')
  })

  it('rejects compound assignment to a call, to several targets, or without a value', () => {
    bad('f() += 1', /cannot assign/)
    bad('a, b += 1', /'=' expected/)
    bad('a +=', /unexpected symbol/)
  })

  it('does not treat comparison operators as assignment', () => {
    bad('a <= 1', /syntax error/)
    bad('a >= 1', /syntax error/)
    bad('a == 1', /syntax error/)
    bad('a != 1', /syntax error/)
  })

  it('a - -= b is not compound', () => {
    expect(s('a -= -1')).toBe('(-= @a (- 1))')
  })
})

describe('local', () => {
  it('declares locals with and without values', () => {
    expect(s('local a')).toBe('(local (a))')
    expect(s('local a = 1')).toBe('(local (a) (1))')
    expect(s('local a, b = 1, 2')).toBe('(local (a b) (1 2))')
    expect(s('local a, b = f()')).toBe('(local (a b) ((call @f)))')
    expect(s('local a, b, c = 1')).toBe('(local (a b c) (1))')
    expect(s('local a = nil')).toBe('(local (a) (nil))')
  })

  it('declares locals after evaluating the right-hand side', () => {
    expect(s('local a = a')).toBe('(local (a) (@a))')
    expect(s('local a = 1 local a = a')).toBe('(local (a) (1)) (local (a) (a))')
    expect(s('local a, b = b, a')).toBe('(local (a b) (@b @a))')
  })

  it('shadows', () => {
    const chunk = parse('local a = 1 local a = 2 return a')
    const ret = chunk.body[2]
    if (ret.type !== 'Return' || ret.values[0].type !== 'Local') throw new Error('x')
    expect(ret.values[0].var.id).toBe(1)
    expect(chunk.localCount).toBe(2)
  })

  it('scopes a local to its block', () => {
    expect(s('do local a = 1 end return a')).toBe('(do (local (a) (1))) (return @a)')
    expect(s('if x then local a = 1 end return a')).toBe('(if (@x (local (a) (1)))) (return @a)')
    expect(s('while x do local a end return a')).toBe('(while @x (local (a))) (return @a)')
  })

  it('local without a name is an error', () => {
    bad('local', /<name> expected/)
    bad('local 1', /<name> expected/)
    bad('local a,', /<name> expected/)
    bad('local a = ', /unexpected symbol/)
    bad('local t.x = 1', /syntax error|unexpected|'=' expected/)
  })
})

describe('if', () => {
  it('parses if / elseif / else', () => {
    expect(s('if a then x=1 end')).toBe('(if (@a (assign (@x) (1))))')
    expect(s('if a then else end')).toBe('(if (@a) (else))')
    expect(s('if a then x=1 else x=2 end')).toBe('(if (@a (assign (@x) (1))) (else (assign (@x) (2))))')
    expect(s('if a then elseif b then elseif c then else end')).toBe('(if (@a) (@b) (@c) (else))')
  })

  it('rejects else after else and elseif after else', () => {
    bad('if a then else else end', /'end' expected/)
    bad('if a then else elseif b then end', /'end' expected/)
  })

  it('requires then and end', () => {
    bad('if a x=1 end', /'then' expected/)
    bad('if a then x=1', /'end' expected near <eof>/)
    bad('if a then x=1\n', /'end' expected \(to close 'if' at line 1\)/)
    bad('if a then\n x=1\n', /'end' expected \(to close 'if' at line 1\) near <eof>/)
    bad('if a then x=1 elseif b x=2 end', /'then' expected/)
  })

  it('accepts do in place of then', () => {
    expect(s('if a do x=1 end')).toBe('(if (@a (assign (@x) (1))))')
  })

  it('handles then directly after a number', () => {
    expect(s('if a==1then x=1 end')).toBe('(if ((== @a 1) (assign (@x) (1))))')
  })
})

describe('shorthand if', () => {
  it('runs to the end of the line', () => {
    expect(s('if (a) x=1')).toBe('(if ((paren @a) (assign (@x) (1))))')
  })

  it('does not swallow the next line', () => {
    expect(s('if (a) x=1\ny=2')).toBe('(if ((paren @a) (assign (@x) (1)))) (assign (@y) (2))')
  })

  it('runs several statements on the same line', () => {
    expect(s('if (a) x=1 y=2 z=3\nw=4')).toBe(
      '(if ((paren @a) (assign (@x) (1)) (assign (@y) (2)) (assign (@z) (3)))) (assign (@w) (4))',
    )
  })

  it('takes a call or compound assignment as its body', () => {
    expect(s('if (btn(0)) x-=1')).toBe('(if ((paren (call @btn 0)) (-= @x 1)))')
    expect(s('if (a) f()')).toBe('(if ((paren @a) (call @f)))')
  })

  it('supports a condition ending in a call', () => {
    expect(s('if btn(0) x=1')).toBe('(if ((call @btn 0) (assign (@x) (1))))')
  })

  it('supports a same-line else', () => {
    expect(s('if (a) x=1 else x=2')).toBe('(if ((paren @a) (assign (@x) (1))) (else (assign (@x) (2))))')
    expect(s('if (a) x=1 else x=2\ny=3')).toBe('(if ((paren @a) (assign (@x) (1))) (else (assign (@x) (2)))) (assign (@y) (3))')
  })

  it('does not take an else from the next line', () => {
    // the else is then left over and is a syntax error, as in PICO-8
    bad('if (a) x=1\nelse x=2', /'<eof>' expected near 'else'/)
  })

  it('nests: the inner shorthand takes the else', () => {
    expect(s('if (a) if (b) x=1 else x=2')).toBe(
      '(if ((paren @a) (if ((paren @b) (assign (@x) (1))) (else (assign (@x) (2))))))',
    )
  })

  it('allows a long-form if inside', () => {
    expect(s('if (a) if b then x=1 end y=2\nz=3')).toBe(
      '(if ((paren @a) (if (@b (assign (@x) (1)))) (assign (@y) (2)))) (assign (@z) (3))',
    )
  })

  it('a multi-line long-form body ends the shorthand at the end of the construct', () => {
    expect(s('if (a) if b then\nx=1\nend\ny=2')).toBe('(if ((paren @a) (if (@b (assign (@x) (1)))))) (assign (@y) (2))')
  })

  it('return in a shorthand takes values only from its own line', () => {
    expect(s('if (a) return 1\nx=2')).toBe('(if ((paren @a) (return 1))) (assign (@x) (2))')
    expect(s('if (a) return\nx=2')).toBe('(if ((paren @a) (return))) (assign (@x) (2))')
    expect(s('if (a) return 1,2')).toBe('(if ((paren @a) (return 1 2)))')
  })

  it('return at the end of a long block keeps reading across lines', () => {
    expect(s('function f()\nreturn\n1\nend')).toBe('(assign (@f) ((function () (return 1))))')
  })

  it('the condition may be a bigger expression that ends in a parenthesis', () => {
    expect(s('if (a and b) or (c) x=1')).toBe('(if ((or (paren (and @a @b)) (paren @c)) (assign (@x) (1))))')
  })

  it('the shorthand body can be empty at the end of the file', () => {
    expect(s('if (a)')).toBe('(if ((paren @a)))')
  })

  it('does not use the line of a long string to end the body', () => {
    // newlines inside long strings do not count (PICO-8 tracks line breaks in whitespace only)
    expect(s('if (a) x=[[1\n2]] y=2')).toBe('(if ((paren @a) (assign (@x) ("1\\n2")) (assign (@y) (2))))')
  })

  it('works with ? as the body', () => {
    expect(s('if (a) ?"hi"')).toBe('(if ((paren @a) (call @print "hi")))')
  })

  it('works inside functions and loops', () => {
    expect(s('function f()\n if (a) return 1\n return 2\nend')).toBe(
      '(assign (@f) ((function () (if ((paren @a) (return 1))) (return 2))))',
    )
    expect(s('for i=1,3 do\n if (i==2) break\nend')).toBe('(for i 1 3 _ (if ((paren (== i 2)) break)))')
  })
})

describe('while, repeat', () => {
  it('parses while', () => {
    expect(s('while a do x=1 end')).toBe('(while @a (assign (@x) (1)))')
    expect(s('while a do end')).toBe('(while @a)')
  })

  it('parses shorthand while', () => {
    expect(s('while (a) x+=1')).toBe('(while (paren @a) (+= @x 1))')
    expect(s('while (a) x+=1\ny=1')).toBe('(while (paren @a) (+= @x 1)) (assign (@y) (1))')
    expect(s('while (a) x+=1 y+=1')).toBe('(while (paren @a) (+= @x 1) (+= @y 1))')
  })

  it('allows break in a shorthand while', () => {
    expect(s('while (a) if (b) break')).toBe('(while (paren @a) (if ((paren @b) break)))')
  })

  it('parses repeat until, with the condition seeing the body locals', () => {
    expect(s('repeat x=1 until a')).toBe('(repeat ((assign (@x) (1))) @a)')
    expect(s('repeat local done = f() until done')).toBe('(repeat ((local (done) ((call @f)))) done)')
  })

  it('rejects the usual mistakes', () => {
    bad('while a x=1 end', /'do' expected/)
    bad('while a do x=1\n', /'end' expected \(to close 'while' at line 1\)/)
    bad('repeat x=1\n', /'until' expected \(to close 'repeat' at line 1\)/)
    bad('repeat until', /unexpected symbol/)
  })
})

describe('for', () => {
  it('parses numeric for', () => {
    expect(s('for i=1,10 do end')).toBe('(for i 1 10 _)')
    expect(s('for i=1,10,2 do x=i end')).toBe('(for i 1 10 2 (assign (@x) (i)))')
    expect(s('for i=10,1,-1 do end')).toBe('(for i 10 1 (- 1))')
    expect(s('for i=a,#t do end')).toBe('(for i @a (# @t) _)')
  })

  it('parses generic for', () => {
    expect(s('for k,v in pairs(t) do end')).toBe('(forin (k v) ((call @pairs @t)))')
    expect(s('for v in all(t) do x=v end')).toBe('(forin (v) ((call @all @t)) (assign (@x) (v)))')
    expect(s('for a,b,c in f,s,i do end')).toBe('(forin (a b c) (@f @s @i))')
  })

  it('scopes the loop variable to the loop', () => {
    expect(s('for i=1,2 do end return i')).toBe('(for i 1 2 _) (return @i)')
    expect(s('for k,v in x do end return k,v')).toBe('(forin (k v) (@x)) (return @k @v)')
  })

  it('the loop bounds do not see the loop variable', () => {
    expect(s('for i=1,i do end')).toBe('(for i 1 @i _)')
  })

  it('records assigned loop variables', () => {
    expect(s('for i=1,3 do i = i + 1 end')).toBe('(for i! 1 3 _ (assign (i!) ((+ i! 1))))')
  })

  it('rejects malformed loops', () => {
    bad('for i=1 do end', /',' expected/)
    bad('for i=1,2,3,4 do end', /'do' expected/)
    bad('for i=1,2 end', /'do' expected/)
    bad('for 1,2 do end', /<name> expected/)
    bad('for i in do end', /unexpected symbol/)
    bad('for i,j=1,2 do end', /'in' expected/)
    bad('for i=1,2 do\n', /'end' expected \(to close 'for' at line 1\)/)
  })
})

describe('break, goto, labels', () => {
  it('allows break inside loops, including nested blocks', () => {
    expect(s('while a do break end')).toBe('(while @a break)')
    expect(s('for i=1,2 do if i then break end end')).toBe('(for i 1 2 _ (if (i break)))')
    expect(s('repeat do break end until a')).toBe('(repeat ((do break)) @a)')
  })

  it('rejects break outside a loop, and across a function boundary', () => {
    bad('break', /no loop to break/)
    bad('if a then break end', /no loop to break/)
    bad('while a do local f = function() break end end', /no loop to break/)
  })

  it('parses labels and gotos', () => {
    expect(s('::top:: x=1 goto top')).toBe('(label top) (assign (@x) (1)) (goto top)')
    expect(s('for i=1,3 do if i==2 then goto continue end ::continue:: end')).toBe(
      '(for i 1 3 _ (if ((== i 2) (goto continue))) (label continue))',
    )
  })

  it('allows a forward goto', () => {
    expect(s('goto done x=1 ::done::')).toBe('(goto done) (assign (@x) (1)) (label done)')
  })

  it('a goto can jump to a label in an enclosing block', () => {
    expect(s('do goto out end ::out::')).toBe('(do (goto out)) (label out)')
  })

  it('rejects a goto with no visible label', () => {
    bad('goto nowhere', /no visible label 'nowhere' for goto/)
    bad('do ::inner:: end goto inner', /no visible label 'inner'/)
    bad('::a:: local function f() goto a end', /no visible label 'a'/)
  })

  it('rejects a duplicate label in the same block', () => {
    bad('::a:: ::a::', /label 'a' already defined on line 1/)
  })

  it('allows the same label in different blocks', () => {
    expect(() => parse('do ::a:: end do ::a:: end')).not.toThrow()
  })

  it('labels need names', () => {
    bad('::1::', /<name> expected/)
    bad('::a', /'::' expected/)
  })
})

describe('return', () => {
  it('parses returns with any number of values', () => {
    expect(s('return')).toBe('(return)')
    expect(s('return 1')).toBe('(return 1)')
    expect(s('return 1,2,3')).toBe('(return 1 2 3)')
    expect(s('return f()')).toBe('(return (call @f))')
    expect(s('return nil')).toBe('(return nil)')
    expect(s('return;')).toBe('(return)')
  })

  it('stops at block ends', () => {
    expect(s('if a then return end')).toBe('(if (@a (return)))')
    expect(s('if a then return else return 1 end')).toBe('(if (@a (return)) (else (return 1)))')
    expect(s('repeat return until a')).toBe('(repeat ((return)) @a)')
  })

  it('does not insist that return is the last statement', () => {
    expect(s('return 1 x=2')).toBe('(return 1) (assign (@x) (2))')
  })
})

describe('? print shorthand', () => {
  it('prints its arguments', () => {
    expect(s('?"hi"')).toBe('(call @print "hi")')
    expect(s('?1,2,3')).toBe('(call @print 1 2 3)')
    expect(s('? a+1')).toBe('(call @print (+ @a 1))')
    expect(s('?f(x)')).toBe('(call @print (call @f @x))')
  })

  it('takes the whole rest of the expression list', () => {
    expect(s('?"a","b"\n?"c"')).toBe('(call @print "a" "b") (call @print "c")')
  })

  it('needs at least one argument', () => {
    bad('?', /unexpected symbol near <eof>/)
  })

  it('is not an expression', () => {
    bad('x = ?1', /unexpected symbol/)
  })

  it('always refers to the global print even if print is shadowed', () => {
    expect(s('local print = 1 ?"x"')).toBe('(local (print) (1)) (call @print "x")')
  })
})

describe('statements', () => {
  it('parses do blocks', () => {
    expect(s('do end')).toBe('(do)')
    expect(s('do x=1 end')).toBe('(do (assign (@x) (1)))')
    bad('do', /'end' expected/)
  })

  it('separates statements without semicolons', () => {
    expect(s('a=1 b=2')).toBe('(assign (@a) (1)) (assign (@b) (2))')
    expect(s('f() g()')).toBe('(call @f) (call @g)')
  })

  it('treats a leading paren on the next line as a call of the previous expression, like Lua', () => {
    expect(s('a = b\n(f)()')).toBe('(assign (@a) ((call (call @b @f))))')
  })

  it('rejects stray tokens', () => {
    bad('end', /'<eof>' expected near 'end'/)
    bad('x = 1 )', /syntax error|unexpected|'<eof>' expected/)
    bad('else', /'<eof>' expected near 'else'/)
    bad('until x', /'<eof>' expected near 'until'/)
    bad('then', /syntax error|unexpected/)
    bad(')', /unexpected symbol/)
  })

  it('reports positions', () => {
    try {
      parse('x = 1\ny = = 2')
      expect.unreachable()
    } catch (err) {
      const le = /** @type {LuaSyntaxError} */ (err)
      expect([le.line, le.col]).toEqual([2, 5])
      expect(le.message).toBe("unexpected symbol near '='")
    }
  })

  it('attaches line numbers to nodes', () => {
    const { body } = parse('a = 1\n\nb = 2\nf(\n1)')
    expect(body.map((n) => n.line)).toEqual([1, 3, 4])
  })

  it('propagates lexer errors as LuaSyntaxError', () => {
    bad('x = "abc', /unfinished string/)
    bad('x = 0x', /malformed number/)
  })
})

describe('robustness', () => {
  it('never throws anything but LuaSyntaxError for token soup', () => {
    const atoms = ['local', 'x', '=', '1', 'if', '(', ')', 'then', 'end', 'else', 'function', 'f', ',', '{', '}', '[', ']', '.', ':', '+=', 'return', '"s"', 'while', 'do', 'for', 'in', '?', '...', 'nil', 'goto', '::', 'break', 'repeat', 'until', '\n', '-', 'not', '@', 'and', '..']
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...atoms), { maxLength: 25 }), (parts) => {
        try {
          parse(parts.join(' '))
        } catch (err) {
          expect(err).toBeInstanceOf(LuaSyntaxError)
        }
      }),
      { numRuns: 1000 },
    )
  })

  it('parses a realistic cart', () => {
    const src = `
-- a tiny game
player = {x=64, y=64, spd=1.5, sprites={1,2,3}}
local enemies = {}

function _init()
  for i=1,5 do
    add(enemies, {x=rnd(128), y=rnd(128), hp=3})
  end
  music(0)
end

function _update60()
  if (btn(0)) player.x -= player.spd
  if (btn(1)) player.x += player.spd
  if (btnp(4)) sfx(0)
  for e in all(enemies) do
    e.x += sgn(player.x - e.x) * .25
    if (abs(e.x-player.x) < 4 and abs(e.y-player.y) < 4) del(enemies, e) player.hp = (player.hp or 3) - 1
  end
  player.x = mid(0, player.x, 127)
end

function _draw()
  cls(1)
  for e in all(enemies) do spr(16, e.x, e.y) end
  spr(player.sprites[flr(t()*4)%3+1], player.x, player.y)
  ?"score: "..#enemies, 2, 2, 7
end
`
    const chunk = parse(src)
    expect(chunk.body.map((n) => n.type)).toEqual(['Assign', 'LocalDecl', 'Assign', 'Assign', 'Assign'])
  })
})

describe('real cartridges', () => {
  const fixture = (/** @type {string} */ name) => new URL(`../fixtures/${name}`, import.meta.url)
  const carts = [
    ...['test_cart', 'test_gol', 'test_cart_memdump', 'test_cart_with_label', 'empty'].map((n) => [n, parseP8(readFileSync(fixture(`picotool/${n}.p8`), 'utf8')).code]),
    ...['picotool/memorymap', 'shrinko8/genend', 'shrinko8/title'].map((n) => [n, decodeP8Png(readFileSync(fixture(`${n}.p8.png`))).code]),
  ]
  for (const [name, code] of carts) {
    it(`parses ${name}`, () => {
      expect(() => parse(code)).not.toThrow()
    })
  }
})
