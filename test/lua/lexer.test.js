import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { tokenize } from '../../src/lua/lexer.js'
import { LuaSyntaxError } from '../../src/lua/errors.js'

/** Token values without the trailing eof. */
const values = (/** @type {string} */ src) => tokenize(src).slice(0, -1).map((t) => t.value)
const types = (/** @type {string} */ src) => tokenize(src).slice(0, -1).map((t) => t.type)
const num = (/** @type {string} */ src) => {
  const [t, eof] = tokenize(src)
  expect(eof.type).toBe('eof') // exactly one token
  expect(t.type).toBe('number')
  return t.value
}
const str = (/** @type {string} */ src) => {
  const [t, eof] = tokenize(src)
  expect(eof.type).toBe('eof')
  expect(t.type).toBe('string')
  return t.value
}

describe('basics', () => {
  it('always ends with eof', () => {
    expect(tokenize('').map((t) => t.type)).toEqual(['eof'])
    expect(tokenize('  \n\t ').map((t) => t.type)).toEqual(['eof'])
    expect(tokenize('x').map((t) => t.type)).toEqual(['name', 'eof'])
  })

  it('separates names, keywords, numbers and punctuation', () => {
    expect(types('local x = 1')).toEqual(['keyword', 'name', 'punct', 'number'])
    expect(values('local x = 1')).toEqual(['local', 'x', '=', 1])
  })

  it('knows every PICO-8 keyword including goto', () => {
    const kws = 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while'
    expect(types(kws).every((t) => t === 'keyword')).toBe(true)
  })

  it('keywords are only whole words', () => {
    expect(types('ending iff _end nil1 Nil')).toEqual(['name', 'name', 'name', 'name', 'name'])
  })

  it('treats glyph bytes (>= 0x80) and 0x1e/0x1f as name characters', () => {
    expect(values('btn(\x8b)')).toEqual(['btn', '(', '\x8b', ')'])
    expect(types('btn(\x8b)')[2]).toBe('name')
    expect(values('a\x8bb')).toEqual(['a\x8bb'])
    expect(types('\x1e\x1f')).toEqual(['name'])
  })

  it('names may contain digits and underscores but not start with a digit', () => {
    expect(values('a1_b2 _3')).toEqual(['a1_b2', '_3'])
  })

  it('tracks position', () => {
    const [a, b, c] = tokenize('ab\n  cd\n\nef')
    expect([a.line, a.col, a.pos, a.end]).toEqual([1, 1, 0, 2])
    expect([b.line, b.col, b.pos]).toEqual([2, 3, 5])
    expect([c.line, c.col]).toEqual([4, 1])
  })

  it('treats CR as whitespace', () => {
    expect(values('a\r\nb\rc')).toEqual(['a', 'b', 'c'])
  })

  it('rejects stray characters', () => {
    expect(() => tokenize('x = `')).toThrow(LuaSyntaxError)
    expect(() => tokenize('a ! b')).toThrow(/unexpected symbol near '!'/)
    expect(() => tokenize('\x01')).toThrow(LuaSyntaxError)
  })
})

describe('numbers', () => {
  it('reads integers and decimals', () => {
    expect(num('0')).toBe(0)
    expect(num('123')).toBe(123)
    expect(num('0.5')).toBe(0.5)
    expect(num('.5')).toBe(0.5)
    expect(num('5.')).toBe(5)
    expect(num('007')).toBe(7)
    expect(num('3.14159')).toBeCloseTo(3.14159, 10)
  })

  it('reads hex, with and without a fraction', () => {
    expect(num('0xff')).toBe(255)
    expect(num('0XFF')).toBe(255)
    expect(num('0xAbCd')).toBe(0xabcd)
    expect(num('0x.8')).toBe(0.5)
    expect(num('0x1.8')).toBe(1.5)
    expect(num('0x0.0001')).toBe(1 / 65536)
    expect(num('0x7fff.ffff')).toBeCloseTo(32767.99998, 4)
    expect(num('0x0.0001')).toBe(2 ** -16)
    expect(num('0x0.4')).toBe(0.25)
  })

  it('reads binary, with and without a fraction', () => {
    expect(num('0b101')).toBe(5)
    expect(num('0B11')).toBe(3)
    expect(num('0b.1')).toBe(0.5)
    expect(num('0b1.1')).toBe(1.5)
    expect(num('0b0')).toBe(0)
  })

  it('has no exponent syntax: 1e3 is a number then a name', () => {
    expect(values('1e3')).toEqual([1, 'e3'])
    expect(types('1e3')).toEqual(['number', 'name'])
  })

  it('allows a keyword right after a number (1,8do)', () => {
    expect(values('for i=1,8do end')).toEqual(['for', 'i', '=', 1, ',', 8, 'do', 'end'])
    expect(values('if x==1then')).toEqual(['if', 'x', '==', 1, 'then'])
  })

  it('does not take a hex digit run as part of a decimal number', () => {
    expect(values('12ab')).toEqual([12, 'ab'])
  })

  it('stops binary at a non-binary digit', () => {
    expect(values('0b102')).toEqual([2, 2])
  })

  it('rejects malformed numbers', () => {
    expect(() => tokenize('1.2.3')).toThrow(/malformed number/)
    expect(() => tokenize('1..2')).toThrow(/malformed number/)
    expect(() => tokenize('0x')).toThrow(/malformed number/)
    expect(() => tokenize('0b')).toThrow(/malformed number/)
    expect(() => tokenize('0x.')).toThrow(/malformed number/)
  })

  it('a dot not followed by a digit is punctuation', () => {
    expect(values('a.b')).toEqual(['a', '.', 'b'])
    expect(values('1 .. 2')).toEqual([1, '..', 2])
    expect(values('a..b')).toEqual(['a', '..', 'b'])
    expect(values('...')).toEqual(['...'])
  })

  it('a minus sign is always its own token', () => {
    expect(values('-1')).toEqual(['-', 1])
    expect(values('a-1')).toEqual(['a', '-', 1])
  })

  it('reads a huge number without losing it', () => {
    expect(num('99999999999')).toBe(99999999999)
    expect(num('0xffffffff')).toBe(0xffffffff)
  })
})

describe('strings', () => {
  it('reads single and double quoted strings', () => {
    expect(str('"abc"')).toBe('abc')
    expect(str("'abc'")).toBe('abc')
    expect(str('""')).toBe('')
    expect(str(`"it's"`)).toBe("it's")
    expect(str(`'say "hi"'`)).toBe('say "hi"')
  })

  it('handles the standard escapes', () => {
    expect(str('"a\\nb"')).toBe('a\nb')
    expect(str('"\\t\\r\\a\\b\\f\\v"')).toBe('\t\r\x07\b\f\v')
    expect(str('"\\\\"')).toBe('\\')
    expect(str('"\\""')).toBe('"')
    expect(str("'\\''")).toBe("'")
  })

  it('handles the PICO-8 control-char escapes', () => {
    expect(str('"\\*\\#\\-\\|\\+\\^"')).toBe('\x01\x02\x03\x04\x05\x06')
  })

  it('handles \\x hex escapes', () => {
    expect(str('"\\x41\\xff\\x00"')).toBe('A\xff\0')
    expect(str('"\\xAb"')).toBe('\xab')
  })

  it('handles decimal escapes of up to three digits', () => {
    expect(str('"\\65"')).toBe('A')
    expect(str('"\\065"')).toBe('A')
    expect(str('"\\0"')).toBe('\0')
    expect(str('"\\255"')).toBe('\xff')
    expect(str('"\\0651"')).toBe('A1') // the fourth digit is a literal
    expect(str('"\\1x"')).toBe('\x01x')
  })

  it('handles \\z, which skips following whitespace including newlines', () => {
    expect(str('"a\\z   \n   b"')).toBe('ab')
    expect(str('"a\\zb"')).toBe('ab')
  })

  it('handles a backslash before a newline', () => {
    expect(str('"a\\\nb"')).toBe('a\nb')
  })

  it('rejects bad escapes', () => {
    expect(() => tokenize('"\\q"')).toThrow(/invalid escape sequence '\\q'/)
    expect(() => tokenize('"\\x4"')).toThrow(/invalid escape/)
    expect(() => tokenize('"\\xzz"')).toThrow(/invalid escape/)
    expect(() => tokenize('"\\256"')).toThrow(/decimal escape too large/)
  })

  it('rejects unterminated strings', () => {
    expect(() => tokenize('"abc')).toThrow(/unfinished string/)
    expect(() => tokenize('"abc\ndef"')).toThrow(/unfinished string/)
    expect(() => tokenize("'abc\"")).toThrow(/unfinished string/)
    expect(() => tokenize('"abc\\')).toThrow(/unfinished string/)
  })

  it('does not treat -- or // inside a string as a comment', () => {
    expect(str('"a--b//c"')).toBe('a--b//c')
  })

  it('keeps high bytes as they are', () => {
    expect(str('"\x8b\xff"')).toBe('\x8b\xff')
  })

  it('reports the error position', () => {
    try {
      tokenize('x=1\ny="abc')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(LuaSyntaxError)
      const err = /** @type {LuaSyntaxError} */ (e)
      expect([err.line, err.col]).toEqual([2, 3])
    }
  })
})

describe('long strings', () => {
  it('reads [[ ]] with no escape processing', () => {
    expect(str('[[a\\nb]]')).toBe('a\\nb')
  })

  it('skips a first newline', () => {
    expect(str('[[\nabc]]')).toBe('abc')
    expect(str('[[\n\nabc]]')).toBe('\nabc')
    expect(str('[[\r\nabc]]')).toBe('abc')
  })

  it('supports levels', () => {
    expect(str('[=[a]]b]=]')).toBe('a]]b')
    expect(str('[==[a]=]b]==]')).toBe('a]=]b')
  })

  it('normalises line endings', () => {
    expect(str('[[a\r\nb\rc]]')).toBe('a\nb\nc')
  })

  it('an empty one is an empty string', () => {
    expect(str('[[]]')).toBe('')
  })

  it('is not confused with indexing', () => {
    expect(values('a[1]')).toEqual(['a', '[', 1, ']'])
    expect(values('a[ [[x]] ]')).toEqual(['a', '[', 'x', ']'])
    expect(values('a[b[1]]')).toEqual(['a', '[', 'b', '[', 1, ']', ']'])
    expect(values('a[=b]')).toEqual(['a', '[', '=', 'b', ']'])
  })

  it('rejects unterminated ones', () => {
    expect(() => tokenize('[[abc')).toThrow(/unfinished long string/)
    expect(() => tokenize('[=[abc]]')).toThrow(/unfinished long string/)
  })

  it('counts lines but not virtual lines', () => {
    const t = tokenize('[[a\nb\nc]] x\ny')
    expect(t[1].line).toBe(3)
    expect(t[1].vline).toBe(1)
    expect(t[2].line).toBe(4)
    expect(t[2].vline).toBe(2)
  })
})

describe('comments', () => {
  it('skips -- line comments', () => {
    expect(values('a -- hello\nb')).toEqual(['a', 'b'])
    expect(values('a --')).toEqual(['a'])
    expect(values('--x\n--y\nz')).toEqual(['z'])
  })

  it('skips // line comments (PICO-8 only)', () => {
    expect(values('a // hello\nb')).toEqual(['a', 'b'])
    expect(values('a //')).toEqual(['a'])
    expect(values('x = 1 // 2')).toEqual(['x', '=', 1])
  })

  it('skips --[[ ]] block comments, over many lines', () => {
    expect(values('a --[[ x\ny\nz ]] b')).toEqual(['a', 'b'])
  })

  it('has no leveled block comments: --[==[ is a plain line comment', () => {
    expect(values('a --[==[ ]] ]==] b')).toEqual(['a'])
    expect(values('a --[==[ x\nb')).toEqual(['a', 'b'])
  })

  it('--[ is only a line comment', () => {
    expect(values('a --[ x\nb')).toEqual(['a', 'b'])
    expect(values('a --[= x\nb')).toEqual(['a', 'b'])
  })

  it('a block comment can be closed right away', () => {
    expect(values('a --[[]] b')).toEqual(['a', 'b'])
  })

  it('--[[ ... on one line still hides the rest of the file until ]]', () => {
    expect(values('a --[[ b\nc ]] d')).toEqual(['a', 'd'])
  })

  it('rejects an unterminated block comment', () => {
    expect(() => tokenize('--[[ abc')).toThrow(/unfinished long comment/)
  })

  it('line numbers survive comments', () => {
    const t = tokenize('--[[\n\n]]\nx')
    expect(t[0].line).toBe(4)
    const u = tokenize('// a\n-- b\nx')
    expect(u[0].line).toBe(3)
  })

  it('counts a long-comment newline in line but not vline', () => {
    const t = tokenize('--[[\n\n]] x')
    expect(t[0].line).toBe(3)
    expect(t[0].vline).toBe(1)
  })
})

describe('operators', () => {
  it('splits single-character operators', () => {
    const ops = '+ - * / \\ % & | ^ < > = ~ # ( ) { } [ ] ; , ? @ $ . :'.split(' ')
    expect(values(ops.join(' '))).toEqual(ops)
  })

  it('takes the longest operator', () => {
    expect(values('a<=b')).toEqual(['a', '<=', 'b'])
    expect(values('a>=b')).toEqual(['a', '>=', 'b'])
    expect(values('a==b')).toEqual(['a', '==', 'b'])
    expect(values('a~=b')).toEqual(['a', '~=', 'b'])
    expect(values('a!=b')).toEqual(['a', '!=', 'b'])
    expect(values('a<<b>>c')).toEqual(['a', '<<', 'b', '>>', 'c'])
    expect(values('a>>>b')).toEqual(['a', '>>>', 'b'])
    expect(values('a<<>b')).toEqual(['a', '<<>', 'b'])
    expect(values('a>><b')).toEqual(['a', '>><', 'b'])
    expect(values('a^^b')).toEqual(['a', '^^', 'b'])
    expect(values('a..b')).toEqual(['a', '..', 'b'])
    expect(values('f(...)')).toEqual(['f', '(', '...', ')'])
    expect(values('::lbl::')).toEqual(['::', 'lbl', '::'])
  })

  it('reads every compound assignment', () => {
    const ops = '+= -= *= /= \\= %= ..= ^= |= &= ^^= <<= >>= >>>= <<>= >><='.split(' ')
    for (const op of ops) expect(values(`x ${op} 1`)).toEqual(['x', op, 1])
    for (const op of ops) expect(values(`x${op}1`)).toEqual(['x', op, 1])
  })

  it('does not merge = with a following unary operator', () => {
    expect(values('x=-1')).toEqual(['x', '=', '-', 1])
    expect(values('x=~y')).toEqual(['x', '=', '~', 'y'])
    expect(values('x=#t')).toEqual(['x', '=', '#', 't'])
    expect(values('x=@5')).toEqual(['x', '=', '@', 5])
    expect(values('x=%5')).toEqual(['x', '=', '%', 5])
    expect(values('x=$5')).toEqual(['x', '=', '$', 5])
  })

  it('a == b == c is not confused with =', () => {
    expect(values('a===b')).toEqual(['a', '==', '=', 'b'])
  })

  it('x-=1 is a compound assignment but x- -1 is not', () => {
    expect(values('x-=1')).toEqual(['x', '-=', 1])
    expect(values('x- -1')).toEqual(['x', '-', '-', 1])
    expect(values('x--1')).toEqual(['x'])
  })

  it('the shorthand print mark is its own token', () => {
    expect(values('?"hi"')).toEqual(['?', 'hi'])
  })
})

describe('virtual lines', () => {
  it('increments on newlines in whitespace and line comments', () => {
    const t = tokenize('a\n-- c\nb // d\nc')
    expect(t.map((x) => x.vline)).toEqual([1, 3, 4, 4])
  })

  it('newline inside a \\z escape counts', () => {
    const t = tokenize('"a\\z\n\n" x')
    expect(t[1].line).toBe(3)
  })
})

describe('properties', () => {
  it('never throws anything but LuaSyntaxError on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (s) => {
        try {
          const t = tokenize(s)
          expect(t[t.length - 1].type).toBe('eof')
          for (const tok of t) expect(tok.end).toBeGreaterThanOrEqual(tok.pos)
        } catch (e) {
          expect(e).toBeInstanceOf(LuaSyntaxError)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('token spans are in order and do not overlap', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', '1', ' ', '\n', '+', '..', '"s"', '--c\n', '[[x]]', '0x1', '<<>', '('), { maxLength: 30 }), (parts) => {
        const src = parts.join('')
        let t
        try {
          t = tokenize(src)
        } catch {
          return
        }
        let prev = 0
        for (const tok of t) {
          expect(tok.pos).toBeGreaterThanOrEqual(prev)
          prev = tok.end
        }
      }),
    )
  })

  it('a string literal round-trips through escapes for all byte values', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 40 }), (bytes) => {
        const lit = '"' + [...bytes].map((b) => '\\' + String(b).padStart(3, '0')).join('') + '"'
        expect(str(lit)).toBe(String.fromCharCode(...bytes))
      }),
    )
  })
})
