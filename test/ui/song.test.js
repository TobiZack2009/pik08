import { describe, expect, it } from 'vitest'
import { readHeader, readNote, writeNote } from '../../src/ui/editors/sfx/sfx-data.js'
import { readPattern } from '../../src/ui/editors/music/music-data.js'
import {
  barSeconds,
  barTicks,
  cellSfx,
  clearBar,
  copyBar,
  copySfx,
  duplicateAfter,
  duplicateBar,
  freeSfx,
  insertBar,
  instrumentSfx,
  isEmptySfx,
  isShared,
  isUsedBar,
  lastBar,
  loopRanges,
  makeUnique,
  newPattern,
  nextBar,
  removeBar,
  setCell,
  setFlag,
  usage,
} from '../../src/ui/editors/sound/song.js'
import { engineFor, regions, render, repeat, setSfx } from '../audio/helpers.js'

/** Regions like those of a new cartridge: empty cells everywhere, empty sfx. */
function fresh() {
  const r = regions()
  for (let bar = 0; bar < 64; bar++) clearBar(r.music, bar)
  return r
}

/** A pattern with something in it. */
const fill = (/** @type {Uint8Array} */ sfx, /** @type {number} */ id, speed = 4) => setSfx(sfx, id, { notes: repeat([30 + (id % 12), 0, 5]), speed })

describe('cells', () => {
  it('reads and writes the sfx of a cell', () => {
    const { music } = fresh()
    expect(cellSfx(music, 3, 2)).toBe(-1)
    setCell(music, 3, 2, 17)
    expect(cellSfx(music, 3, 2)).toBe(17)
    expect(cellSfx(music, 3, 1)).toBe(-1)
    setCell(music, 3, 2, -1)
    expect(cellSfx(music, 3, 2)).toBe(-1)
  })

  it('keeps the flag of the bar and remembers the number of an emptied cell', () => {
    const { music } = fresh()
    setCell(music, 0, 0, 9)
    setFlag(music, 0, 'loopStart', true)
    setCell(music, 0, 0, -1)
    expect(music[0] & 0x80).toBe(0x80)
    expect(music[0] & 0x3f).toBe(9)
    setCell(music, 0, 0, 12)
    expect(music[0]).toBe(0x80 | 12)
  })

  it('sets the three flags on the channels they belong to', () => {
    const { music } = fresh()
    setFlag(music, 4, 'loopStart', true)
    setFlag(music, 4, 'loopBack', true)
    setFlag(music, 4, 'stop', true)
    expect([0, 1, 2, 3].map((c) => music[4 * 4 + c] >> 7)).toEqual([1, 1, 1, 0])
    setFlag(music, 4, 'loopBack', false)
    expect(music[4 * 4 + 1] >> 7).toBe(0)
    expect(music[4 * 4] >> 7).toBe(1)
  })

  it('finds the used bars', () => {
    const { music } = fresh()
    expect(lastBar(music)).toBe(-1)
    setCell(music, 5, 3, 1)
    setCell(music, 2, 0, 1)
    expect(isUsedBar(music, 5)).toBe(true)
    expect(isUsedBar(music, 4)).toBe(false)
    expect(lastBar(music)).toBe(5)
  })

  it('lists where each sfx is used, and when it is shared', () => {
    const { music } = fresh()
    setCell(music, 0, 0, 10)
    setCell(music, 3, 1, 10)
    setCell(music, 3, 2, 11)
    const u = usage(music)
    expect(u[10]).toEqual([
      { bar: 0, channel: 0 },
      { bar: 3, channel: 1 },
    ])
    expect(u[11]).toEqual([{ bar: 3, channel: 2 }])
    expect(u[12]).toEqual([])
    expect(isShared(music, 0, 0)).toBe(true)
    expect(isShared(music, 3, 2)).toBe(false)
    expect(isShared(music, 9, 9 % 4)).toBe(false)
  })

  it('does not count emptied cells as users', () => {
    const { music } = fresh()
    setCell(music, 0, 0, 10)
    setCell(music, 1, 0, 10)
    setCell(music, 1, 0, -1)
    expect(usage(music)[10]).toHaveLength(1)
  })
})

describe('free sfx', () => {
  it('knows an empty sfx whatever its speed', () => {
    const { sfx } = fresh()
    sfx[9 * 68 + 65] = 20
    expect(isEmptySfx(sfx, 9)).toBe(true)
    writeNote(sfx, 9, 5, { pitch: 3, wave: 0, vol: 0, fx: 0 })
    expect(isEmptySfx(sfx, 9)).toBe(false)
    clearLoop(sfx, 10)
    expect(isEmptySfx(sfx, 10)).toBe(false)
  })

  it('hands out the numbers from 8 first, then 0-7', () => {
    const { sfx, music } = fresh()
    expect(freeSfx(sfx, music, 3)).toEqual([8, 9, 10])
    for (let id = 8; id < 64; id++) fill(sfx, id)
    expect(freeSfx(sfx, music, 3)).toEqual([0, 1, 2])
  })

  it('skips sfx that are in the song', () => {
    const { sfx, music } = fresh()
    setCell(music, 0, 0, 8)
    setCell(music, 0, 1, 9)
    expect(freeSfx(sfx, music, 2)).toEqual([10, 11])
  })

  it('skips sfx used as an instrument', () => {
    const { sfx, music } = fresh()
    for (let id = 8; id < 64; id++) fill(sfx, id)
    writeNote(sfx, 20, 0, { pitch: 30, wave: 8 + 2, vol: 5, fx: 0 })
    expect([...instrumentSfx(sfx)]).toEqual([2])
    expect(freeSfx(sfx, music, 8)).toEqual([0, 1, 3, 4, 5, 6, 7])
  })

  it('returns fewer when there are fewer', () => {
    const { sfx, music } = fresh()
    for (let id = 0; id < 64; id++) fill(sfx, id)
    expect(freeSfx(sfx, music, 3)).toEqual([])
  })
})

/** Gives an sfx a loop and nothing else. @param {Uint8Array} sfx @param {number} id */
function clearLoop(sfx, id) {
  sfx[id * 68 + 66] = 4
  sfx[id * 68 + 67] = 8
}

describe('newPattern', () => {
  it('makes an empty pattern in a free sfx with a default speed', () => {
    const { sfx, music } = fresh()
    const id = newPattern(sfx, music, 0, 1)
    expect(id).toBe(8)
    expect(cellSfx(music, 0, 1)).toBe(8)
    expect(readHeader(sfx, 8).speed).toBe(16)
  })

  it('takes the speed of the other channels of the bar', () => {
    const { sfx, music } = fresh()
    fill(sfx, 20, 7)
    setCell(music, 2, 0, 20)
    const id = newPattern(sfx, music, 2, 3)
    expect(readHeader(sfx, id).speed).toBe(7)
  })

  it('leaves a cell that has a pattern alone', () => {
    const { sfx, music } = fresh()
    fill(sfx, 20)
    setCell(music, 0, 0, 20)
    expect(newPattern(sfx, music, 0, 0)).toBe(20)
    expect(usage(music)[20]).toHaveLength(1)
  })

  it('does not use the same sfx twice', () => {
    const { sfx, music } = fresh()
    const a = newPattern(sfx, music, 0, 0)
    const b = newPattern(sfx, music, 0, 1)
    expect(a).not.toBe(b)
  })

  it('cleans a leftover header', () => {
    const { sfx, music } = fresh()
    sfx[8 * 68 + 64] = 0xff
    sfx[8 * 68 + 65] = 3
    newPattern(sfx, music, 0, 0)
    expect(readHeader(sfx, 8)).toEqual({ mode: 0, speed: 16, loopStart: 0, loopEnd: 0 })
  })

  it('reports that nothing is free', () => {
    const { sfx, music } = fresh()
    for (let id = 0; id < 64; id++) fill(sfx, id)
    expect(newPattern(sfx, music, 0, 0)).toBe(-1)
    expect(cellSfx(music, 0, 0)).toBe(-1)
  })
})

describe('makeUnique', () => {
  it('copies the pattern of a shared cell and points the cell at the copy', () => {
    const { sfx, music } = fresh()
    fill(sfx, 20, 6)
    setCell(music, 0, 0, 20)
    setCell(music, 1, 0, 20)
    const copy = makeUnique(sfx, music, 1, 0)
    expect(copy).toBe(8)
    expect(cellSfx(music, 1, 0)).toBe(8)
    expect(cellSfx(music, 0, 0)).toBe(20)
    expect(sfx.slice(8 * 68, 9 * 68)).toEqual(sfx.slice(20 * 68, 21 * 68))
    expect(isShared(music, 0, 0)).toBe(false)
  })

  it('does nothing for a cell that is not shared, or empty', () => {
    const { sfx, music } = fresh()
    fill(sfx, 20)
    setCell(music, 0, 0, 20)
    expect(makeUnique(sfx, music, 0, 0)).toBe(20)
    expect(makeUnique(sfx, music, 0, 1)).toBe(-1)
    expect(freeSfx(sfx, music)[0]).toBe(8)
  })

  it('changes nothing when no sfx is free', () => {
    const { sfx, music } = fresh()
    for (let id = 0; id < 64; id++) fill(sfx, id)
    setCell(music, 0, 0, 20)
    setCell(music, 1, 0, 20)
    const before = music.slice()
    expect(makeUnique(sfx, music, 1, 0)).toBe(-1)
    expect(music).toEqual(before)
  })
})

describe('copySfx', () => {
  it('copies all 68 bytes', () => {
    const { sfx } = fresh()
    fill(sfx, 3, 9)
    copySfx(sfx, 3, 40)
    expect(sfx.slice(40 * 68, 41 * 68)).toEqual(sfx.slice(3 * 68, 4 * 68))
    expect(sfx.slice(41 * 68, 42 * 68).every((b) => b === 0)).toBe(true)
  })
})

describe('bars', () => {
  it('clears a bar like a new cartridge does', () => {
    const { music } = fresh()
    setCell(music, 7, 0, 5)
    setFlag(music, 7, 'stop', true)
    clearBar(music, 7)
    expect([...music.slice(28, 32)]).toEqual([0x41, 0x42, 0x43, 0x44])
  })

  it('copies a bar with its flags, sharing the patterns', () => {
    const { music } = fresh()
    setCell(music, 0, 0, 5)
    setCell(music, 0, 2, 6)
    setFlag(music, 0, 'loopStart', true)
    copyBar(music, 0, 3)
    expect(cellSfx(music, 3, 0)).toBe(5)
    expect(cellSfx(music, 3, 2)).toBe(6)
    expect(music[12] >> 7).toBe(1)
    expect(usage(music)[5]).toHaveLength(2)
  })

  it('duplicates a bar with its own copies of the patterns', () => {
    const { sfx, music } = fresh()
    fill(sfx, 20, 3)
    fill(sfx, 21, 5)
    setCell(music, 0, 0, 20)
    setCell(music, 0, 1, 21)
    setCell(music, 0, 2, 20) // shared inside the bar
    setFlag(music, 0, 'loopBack', true)
    expect(duplicateBar(sfx, music, 0, 2, true)).toBe(true)
    const [a, b, c] = [0, 1, 2].map((ch) => cellSfx(music, 2, ch))
    expect(new Set([a, b])).toHaveProperty('size', 2)
    expect([a, b]).not.toContain(20)
    expect([a, b]).not.toContain(21)
    expect(c).toBe(a)
    expect(sfx.slice(a * 68, (a + 1) * 68)).toEqual(sfx.slice(20 * 68, 21 * 68))
    expect(readHeader(sfx, b).speed).toBe(5)
    expect(music[2 * 4 + 1] >> 7).toBe(1)
    // the source is untouched
    expect([0, 1, 2].map((ch) => cellSfx(music, 0, ch))).toEqual([20, 21, 20])
  })

  it('duplicates without copying the patterns when asked to', () => {
    const { sfx, music } = fresh()
    fill(sfx, 20)
    setCell(music, 0, 0, 20)
    duplicateBar(sfx, music, 0, 1)
    expect(cellSfx(music, 1, 0)).toBe(20)
    expect(freeSfx(sfx, music)[0]).toBe(8)
  })

  it('duplicates nothing when there are not enough free sfx', () => {
    const { sfx, music } = fresh()
    for (let id = 0; id < 62; id++) fill(sfx, id)
    setCell(music, 0, 0, 3)
    setCell(music, 0, 1, 4)
    setCell(music, 0, 2, 5)
    const before = music.slice()
    expect(duplicateBar(sfx, music, 0, 1, true)).toBe(false)
    expect(music).toEqual(before)
  })

  it('inserts an empty bar and moves the rest down, flags with them', () => {
    const { music } = fresh()
    setCell(music, 1, 0, 11)
    setFlag(music, 1, 'loopStart', true)
    setCell(music, 2, 0, 12)
    expect(insertBar(music, 1)).toBe(true)
    expect(isUsedBar(music, 1)).toBe(false)
    expect(cellSfx(music, 2, 0)).toBe(11)
    expect(music[2 * 4] >> 7).toBe(1)
    expect(cellSfx(music, 3, 0)).toBe(12)
  })

  it('does not insert when the last bar is used', () => {
    const { music } = fresh()
    setCell(music, 63, 0, 1)
    const before = music.slice()
    expect(insertBar(music, 0)).toBe(false)
    expect(music).toEqual(before)
  })

  it('removes a bar and moves the rest up', () => {
    const { music } = fresh()
    setCell(music, 1, 0, 11)
    setCell(music, 2, 0, 12)
    setCell(music, 63, 0, 13)
    removeBar(music, 1)
    expect(cellSfx(music, 1, 0)).toBe(12)
    expect(cellSfx(music, 2, 0)).toBe(-1)
    expect(cellSfx(music, 62, 0)).toBe(13)
    expect(isUsedBar(music, 63)).toBe(false)
  })
})

describe('the length of a bar (agrees with the sound engine)', () => {
  /**
   * The sample at which the engine leaves pattern 0, found by rendering in small steps.
   * @param {{ sfx: Uint8Array, music: Uint8Array }} r
   */
  function measure(r) {
    const e = engineFor(r)
    e.music(0)
    let samples = 0
    while (e.state.pattern === 0 && samples < 200000) {
      render(e, 20)
      samples += 20
    }
    return samples
  }

  /** @type {[string, (r: ReturnType<typeof fresh>) => void][]} */
  const cases = [
    ['one sound', (r) => { setSfx(r.sfx, 8, { notes: repeat([30, 0, 5]), speed: 2 }); setCell(r.music, 0, 0, 8) }],
    [
      'the first sound that does not loop decides',
      (r) => {
        setSfx(r.sfx, 8, { notes: repeat([30, 0, 5]), speed: 5, loopStart: 0, loopEnd: 32 })
        setSfx(r.sfx, 9, { notes: repeat([30, 0, 5]), speed: 1 })
        setSfx(r.sfx, 10, { notes: repeat([30, 0, 5]), speed: 3 })
        setCell(r.music, 0, 0, 8)
        setCell(r.music, 0, 1, 9)
        setCell(r.music, 0, 2, 10)
      },
    ],
    [
      'the slowest decides if all loop',
      (r) => {
        setSfx(r.sfx, 8, { notes: repeat([30, 0, 5]), speed: 1, loopStart: 0, loopEnd: 8 })
        setSfx(r.sfx, 9, { notes: repeat([30, 0, 5]), speed: 2, loopStart: 0, loopEnd: 8 })
        setCell(r.music, 0, 0, 8)
        setCell(r.music, 0, 1, 9)
      },
    ],
    [
      'a loop start without a loop end cuts the sound',
      (r) => {
        setSfx(r.sfx, 8, { notes: repeat([30, 0, 5]), speed: 2, loopStart: 8, loopEnd: 0 })
        setCell(r.music, 0, 0, 8)
      },
    ],
    [
      'a channel that is off does not count',
      (r) => {
        setSfx(r.sfx, 8, { notes: repeat([30, 0, 5]), speed: 9 })
        setSfx(r.sfx, 9, { notes: repeat([30, 0, 5]), speed: 1 })
        setCell(r.music, 0, 0, 8)
        setCell(r.music, 0, 0, -1)
        setCell(r.music, 0, 1, 9)
      },
    ],
  ]

  for (const [name, setup] of cases) {
    it(name, () => {
      const r = fresh()
      setup(r)
      const ticks = barTicks(r.sfx, r.music, 0)
      expect(ticks).toBeGreaterThan(0)
      expect(Math.abs(measure(r) - ticks * 183)).toBeLessThanOrEqual(40)
      expect(barSeconds(r.sfx, r.music, 0)).toBeCloseTo((ticks * 183) / 22050, 9)
    })
  }

  it('is 0 for a bar that plays nothing', () => {
    const r = fresh()
    expect(barTicks(r.sfx, r.music, 0)).toBe(0)
  })
})

describe('the order of bars (agrees with the sound engine)', () => {
  /** Bars the engine plays, in order, up to `limit` changes. */
  function played(/** @type {ReturnType<typeof fresh>} */ r, limit = 10) {
    const e = engineFor(r)
    e.music(0)
    /** @type {number[]} */
    const seen = [0]
    for (let i = 0; i < 3000 && seen.length < limit; i++) {
      render(e, 100)
      const p = e.state.pattern
      if (p !== seen[seen.length - 1]) {
        seen.push(p)
        if (p === -1) break
      }
    }
    return seen
  }

  /** Bars `nextBar` visits. */
  function followed(/** @type {ReturnType<typeof fresh>} */ r, limit = 10) {
    const seen = [0]
    while (seen.length < limit) {
      const n = nextBar(r.sfx, r.music, seen[seen.length - 1])
      seen.push(n)
      if (n === -1) break
    }
    return seen
  }

  /** @param {ReturnType<typeof fresh>} r @param {number} bars */
  function bars(r, bars) {
    setSfx(r.sfx, 8, { notes: repeat([30, 0, 5]), speed: 1 })
    for (let b = 0; b < bars; b++) setCell(r.music, b, 0, 8)
  }

  it('runs on to the end', () => {
    const r = fresh()
    bars(r, 3)
    expect(followed(r)).toEqual([0, 1, 2, -1])
    expect(played(r)).toEqual(followed(r))
  })

  it('stops at a stop flag', () => {
    const r = fresh()
    bars(r, 4)
    setFlag(r.music, 1, 'stop', true)
    expect(followed(r)).toEqual([0, 1, -1])
    expect(played(r)).toEqual(followed(r))
  })

  it('loops back to the closest loop start', () => {
    const r = fresh()
    bars(r, 5)
    setFlag(r.music, 1, 'loopStart', true)
    setFlag(r.music, 3, 'loopStart', true)
    setFlag(r.music, 4, 'loopBack', true)
    expect(followed(r, 9)).toEqual([0, 1, 2, 3, 4, 3, 4, 3, 4])
    expect(played(r, 9)).toEqual(followed(r, 9))
  })

  it('loops back to the first bar when there is no loop start', () => {
    const r = fresh()
    bars(r, 3)
    setFlag(r.music, 2, 'loopBack', true)
    expect(followed(r, 7)).toEqual([0, 1, 2, 0, 1, 2, 0])
    expect(played(r, 7)).toEqual(followed(r, 7))
  })

  it('loops a single bar that is both the start and the end', () => {
    const r = fresh()
    bars(r, 2)
    setFlag(r.music, 1, 'loopStart', true)
    setFlag(r.music, 1, 'loopBack', true)
    expect(followed(r, 5)).toEqual([0, 1, 1, 1, 1])
    // the engine never leaves bar 1 (the helper only records changes)
    expect(played(r, 5)).toEqual([0, 1])
  })

  it('ends after the last bar, even bar 63', () => {
    const r = fresh()
    setSfx(r.sfx, 8, { notes: repeat([30, 0, 5]), speed: 1 })
    setCell(r.music, 63, 0, 8)
    expect(nextBar(r.sfx, r.music, 63)).toBe(-1)
  })
})

describe('duplicateAfter', () => {
  function song() {
    const r = regions()
    setSfx(r.sfx, 8, { notes: [[30, 0, 5]], speed: 4 })
    for (let bar = 0; bar < 64; bar++) clearBar(r.music, bar)
    setCell(r.music, 1, 0, 8)
    setCell(r.music, 1, 1, 8)
    setCell(r.music, 2, 0, 9)
    setFlag(r.music, 1, 'loopStart', true)
    setFlag(r.music, 1, 'loopBack', true)
    return r
  }

  it('inserts a copy after the bar and moves the rest down', () => {
    const r = song()
    expect(duplicateAfter(r.sfx, r.music, 1)).toBe(true)
    expect(cellSfx(r.music, 2, 0)).toBe(8)
    expect(cellSfx(r.music, 2, 1)).toBe(8)
    expect(cellSfx(r.music, 3, 0)).toBe(9)
    expect(cellSfx(r.music, 1, 0)).toBe(8)
  })

  it('shares the patterns, or with unique copies them', () => {
    const r = song()
    duplicateAfter(r.sfx, r.music, 1)
    expect(isShared(r.music, 2, 0)).toBe(true)
    const u = song()
    expect(duplicateAfter(u.sfx, u.music, 1, true)).toBe(true)
    expect(cellSfx(u.music, 2, 0)).not.toBe(8)
    // the two channels that shared a pattern still share the copy
    expect(cellSfx(u.music, 2, 0)).toBe(cellSfx(u.music, 2, 1))
    expect(readNote(u.sfx, cellSfx(u.music, 2, 0), 0).pitch).toBe(30)
  })

  it('leaves the flags on the original only', () => {
    const r = song()
    duplicateAfter(r.sfx, r.music, 1)
    expect(readPattern(r.music, 1)).toMatchObject({ loopStart: true, loopBack: true })
    expect(readPattern(r.music, 2)).toMatchObject({ loopStart: false, loopBack: false })
  })

  it('cannot repeat the last bar', () => {
    const r = song()
    setCell(r.music, 63, 0, 8)
    const before = r.music.slice()
    expect(duplicateAfter(r.sfx, r.music, 63)).toBe(false)
    expect(r.music).toEqual(before)
  })

  it('changes nothing when the song is full', () => {
    const r = song()
    setCell(r.music, 63, 0, 8)
    const before = r.music.slice()
    expect(duplicateAfter(r.sfx, r.music, 1)).toBe(false)
    expect(r.music).toEqual(before)
  })

  it('changes nothing when there are no free sfx for unique copies', () => {
    const r = song()
    for (let id = 0; id < 64; id++) if (id !== 8 && id !== 9) writeNote(r.sfx, id, 0, { pitch: 1, wave: 0, vol: 1, fx: 0 })
    const music = r.music.slice()
    const sfx = r.sfx.slice()
    expect(duplicateAfter(r.sfx, r.music, 1, true)).toBe(false)
    expect(r.music).toEqual(music)
    expect(r.sfx).toEqual(sfx)
  })
})

describe('loopRanges', () => {
  it('finds the bars a loop-back jumps over', () => {
    const r = regions()
    for (let bar = 0; bar < 8; bar++) clearBar(r.music, bar)
    setFlag(r.music, 2, 'loopStart', true)
    setFlag(r.music, 5, 'loopBack', true)
    expect(loopRanges(r.music)).toEqual([{ from: 2, to: 5 }])
  })

  it('loops to the first bar without a start, and finds each loop', () => {
    const r = regions()
    for (let bar = 0; bar < 8; bar++) clearBar(r.music, bar)
    setFlag(r.music, 1, 'loopBack', true)
    setFlag(r.music, 3, 'loopStart', true)
    setFlag(r.music, 6, 'loopBack', true)
    expect(loopRanges(r.music)).toEqual([
      { from: 0, to: 1 },
      { from: 3, to: 6 },
    ])
  })

  it('is empty without loops', () => {
    expect(loopRanges(regions().music)).toEqual([])
  })
})
