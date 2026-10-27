import { describe, expect, it } from 'vitest'
import { analyze, bracketsAt, lineColToOffset, markRange, normalizeInsert, syntaxProblem } from '../../src/ui/editors/code/code-model.js'
import { fromDisplay, toDisplay } from '../../src/ui/editors/code/p8scii-view.js'

describe('normalizeInsert', () => {
  it('leaves ordinary text alone', () => {
    expect(normalizeInsert('print("hi")\n  x=1')).toBe('print("hi")\n  x=1')
  })

  it('keeps P8SCII glyphs', () => {
    const glyphs = toDisplay('\x80\x97\x8e')
    expect(normalizeInsert(glyphs)).toBe(glyphs)
  })

  it('turns characters outside the charset into their UTF-8 bytes, one glyph per byte', () => {
    const out = normalizeInsert('é')
    expect(fromDisplay(out)).toBe('\xc3\xa9')
    expect(normalizeInsert(out)).toBe(out) // stable
  })
})

describe('analyze', () => {
  it('lexes the p8str and gives display offsets for wide glyphs', () => {
    const doc = toDisplay('x=\x8e\ny=1') // x, =, a two-unit glyph, newline, y, =, 1
    const a = analyze(doc)
    expect(a.p8).toBe('x=\x8e\ny=1')
    expect(doc.length).toBe(a.p8.length + a.map.wide.length)
    const number = a.segments.find((s) => s.cls === 'number')
    expect(number).toBeDefined()
    const at = a.map.toDisplay(/** @type {{ from: number }} */ (number).from)
    expect(doc[at]).toBe('1')
  })

  it('highlights keywords and comments', () => {
    const classes = analyze('if x then -- hi\nend').segments.map((s) => s.cls)
    expect(classes).toContain('keyword')
    expect(classes).toContain('comment')
  })
})

describe('bracketsAt', () => {
  it('pairs brackets after wide glyphs', () => {
    const doc = toDisplay('print("\x8e")\n')
    const a = analyze(doc)
    const open = doc.indexOf('(')
    const found = bracketsAt(a, open + 1) // just after the "("
    expect(found?.matched).toBe(true)
    expect(found?.ranges.map((r) => doc.slice(r.from, r.to)).sort()).toEqual(['(', ')'])
  })

  it('reports an unmatched bracket', () => {
    const found = bracketsAt(analyze('f(1'), 2)
    expect(found?.matched).toBe(false)
  })

  it('is null away from brackets', () => {
    expect(bracketsAt(analyze('x = 1'), 2)).toBeNull()
  })
})

describe('syntaxProblem', () => {
  it('is null for valid code', () => {
    expect(syntaxProblem('x = 1\nprint(x)')).toBeNull()
  })

  it('reports the parser error with a position', () => {
    const code = 'x = 1\ny = = 2'
    const p = syntaxProblem(code)
    expect(p?.line).toBe(2)
    expect(code[/** @type {number} */ (p?.pos)]).toBe('=')
  })

  it('uses the lexer position for lexer errors', () => {
    const p = syntaxProblem('x = "abc')
    expect(p?.message).toMatch(/unfinished string/)
    expect(p?.pos).toBe(4)
  })

  it('points at the end of the code when it stops early', () => {
    const code = 'if x then\n'
    const p = syntaxProblem(code)
    expect(p?.pos).toBeLessThanOrEqual(code.length)
  })
})

describe('lineColToOffset', () => {
  it('converts 1-based positions and stays inside the line', () => {
    const src = 'ab\ncde\nf'
    expect(lineColToOffset(src, 1, 1)).toBe(0)
    expect(lineColToOffset(src, 2, 2)).toBe(4)
    expect(lineColToOffset(src, 2, 99)).toBe(6)
    expect(lineColToOffset(src, 9, 1)).toBe(src.length)
  })
})

describe('markRange', () => {
  it('covers the word at the position', () => {
    const a = analyze('x = foo bar')
    expect(markRange(a, 4)).toEqual({ from: 4, to: 7 })
  })

  it('marks one character on punctuation', () => {
    const a = analyze('x = )')
    expect(markRange(a, 4)).toEqual({ from: 4, to: 5 })
  })

  it('marks the last character when the position is the end', () => {
    const a = analyze('x =')
    expect(markRange(a, 3)).toEqual({ from: 2, to: 3 })
  })
})
