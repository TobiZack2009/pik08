import { describe, expect, it, vi } from 'vitest'
import { COMMANDS, executeCommand, parseCommandLine } from '../../src/ui/cli.js'

function context() {
  return {
    save: vi.fn(async (name) => `saved ${name ?? '(asked)'}`),
    load: vi.fn(async () => 'loaded'),
    exportCart: vi.fn(async (format, name) => `exported ${format} ${name ?? ''}`.trim()),
    run: vi.fn(() => 'running'),
    newCart: vi.fn(() => 'new cart'),
    stats: vi.fn(() => ['tokens 1/8192', 'chars 2/65535']),
  }
}

describe('parseCommandLine', () => {
  it('splits words and lower-cases the command', () => {
    expect(parseCommandLine('  SAVE   my game ')).toEqual({ name: 'save', args: ['my', 'game'] })
  })

  it('returns null for a blank line', () => {
    expect(parseCommandLine('')).toBe(null)
    expect(parseCommandLine('   \t')).toBe(null)
  })

  it('understands quotes and escapes', () => {
    expect(parseCommandLine('save "my game.p8"')?.args).toEqual(['my game.p8'])
    expect(parseCommandLine("save 'a \"b\"'")?.args).toEqual(['a "b"'])
    expect(parseCommandLine('save a\\ b')?.args).toEqual(['a b'])
    expect(parseCommandLine('save ""')?.args).toEqual([''])
    expect(parseCommandLine('save a"b c"d')?.args).toEqual(['ab cd'])
  })

  it('rejects an unterminated quote', () => {
    expect(() => parseCommandLine('save "oops')).toThrow(/unterminated/)
  })
})

describe('executeCommand', () => {
  it('does nothing for a blank line', async () => {
    expect(await executeCommand('  ', context())).toEqual({ ok: true, lines: [] })
  })

  it('dispatches to the context', async () => {
    const ctx = context()
    expect(await executeCommand('load', ctx)).toEqual({ ok: true, lines: ['loaded'] })
    expect(await executeCommand('save', ctx)).toEqual({ ok: true, lines: ['saved (asked)'] })
    expect(await executeCommand('save foo', ctx)).toEqual({ ok: true, lines: ['saved foo'] })
    expect(await executeCommand('run', ctx)).toEqual({ ok: true, lines: ['running'] })
    expect(await executeCommand('new', ctx)).toEqual({ ok: true, lines: ['new cart'] })
    expect((await executeCommand('stats', ctx)).lines).toHaveLength(2)
  })

  it('exports png by default', async () => {
    const ctx = context()
    await executeCommand('export', ctx)
    expect(ctx.exportCart).toHaveBeenLastCalledWith('png', undefined)
    await executeCommand('export p8 game', ctx)
    expect(ctx.exportCart).toHaveBeenLastCalledWith('p8', 'game')
  })

  it('reports bad usage', async () => {
    const ctx = context()
    for (const line of ['load now', 'run x', 'save a b', 'export gif', 'export png a b', 'help a b']) {
      const r = await executeCommand(line, ctx)
      expect(r.ok, line).toBe(false)
      expect(r.lines[0]).toMatch(/usage/)
    }
    expect(ctx.load).not.toHaveBeenCalled()
  })

  it('reports unknown commands, including object prototype names', async () => {
    expect((await executeCommand('frobnicate', context())).lines[0]).toMatch(/unknown command/)
    expect((await executeCommand('constructor', context())).ok).toBe(false)
    expect((await executeCommand('toString', context())).ok).toBe(false)
  })

  it('turns thrown errors into output', async () => {
    const ctx = context()
    ctx.load.mockRejectedValueOnce(new Error('disk on fire'))
    expect(await executeCommand('load', ctx)).toEqual({ ok: false, lines: ['disk on fire'] })
    expect((await executeCommand('save "x', ctx)).ok).toBe(false)
  })

  it('lists and describes commands', async () => {
    const all = await executeCommand('help', context())
    expect(all.lines).toHaveLength(Object.keys(COMMANDS).length)
    expect((await executeCommand('help export', context())).lines[0]).toContain('export [png|p8]')
    expect((await executeCommand('help nope', context())).ok).toBe(false)
  })
})
