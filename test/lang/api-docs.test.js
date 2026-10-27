import { describe, expect, it } from 'vitest'
import { KEYWORDS as LEXER_KEYWORDS } from '../../src/lua/lexer.js'
import { API, ENTRY_POINTS, KEYWORDS, SNIPPETS, formatSignature } from '../../src/lang/api-docs.js'
import { createGame } from '../../src/player/game.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'

/** The names of the globals a cart can use, read from a game that has loaded an empty cart. */
function runtimeGlobals() {
  const game = createGame({ profile: pico8Profile, clock: { now: () => 0, schedule: () => 1, cancel() {} }, storage: null })
  game.load({ code: '', rom: pico8Profile.cart.createRom() })
  const next = /** @type {NonNullable<typeof game.program>} */ (game.program).G.iterator()
  /** @type {string[]} */
  const names = []
  for (let entry; (entry = next()); ) names.push(/** @type {string} */ (entry[0]))
  return names
}

describe('api docs', () => {
  // The glyph constants (the button symbols) are variables, not functions to document.
  const names = runtimeGlobals().filter((n) => n.charCodeAt(0) < 0x80)

  it('document every global of the runtime', () => {
    expect(names.length).toBeGreaterThan(80)
    expect(names.filter((n) => !(n in API))).toEqual([])
  })

  it('document nothing the runtime does not have', () => {
    expect(Object.keys(API).filter((n) => !names.includes(n))).toEqual([])
  })

  it('give every entry a group, a description and named parameters', () => {
    for (const [name, doc] of Object.entries({ ...API, ...ENTRY_POINTS })) {
      expect(doc.group, name).toBeTruthy()
      expect(doc.doc.length, name).toBeGreaterThan(5)
      for (const p of doc.params) expect(p.name, name).toMatch(/^(\.\.\.|\w+)$/)
    }
  })

  it('put optional parameters last', () => {
    for (const [name, doc] of Object.entries(API)) {
      const first = doc.params.findIndex((p) => p.optional)
      if (first >= 0) expect(doc.params.slice(first).every((p) => p.optional), name).toBe(true)
    }
  })

  it('format signatures', () => {
    expect(formatSignature('circfill', API.circfill.params)).toBe('circfill(x, y, [r], [col])')
    expect(formatSignature('time', API.time.params)).toBe('time()')
    expect(formatSignature('add', API.add.params)).toBe('add(t, v, [i])')
  })

  it('list the lexer keywords', () => {
    expect([...KEYWORDS].sort()).toEqual([...LEXER_KEYWORDS].sort())
  })

  it('have snippets with a cursor field', () => {
    for (const s of SNIPPETS) expect(s.template, s.label).toContain('${')
  })
})
