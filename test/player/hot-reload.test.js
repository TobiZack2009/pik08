import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CODE_DELAY, ROM_DELAY, PLAYER_HASH, createRunner } from '../../src/player/hot-reload.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { Project } from '../../src/ui/store.js'
import { linkedChannels } from '../helpers/channel.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(opened = true) {
  const [editorEnd, playerEnd] = linkedChannels()
  const open = vi.fn(() => opened)
  const runner = createRunner({ profile: pico8Profile, channel: () => editorEnd, open, playerUrl: () => 'http://x/#run' })
  const project = Project.empty(pico8Profile)
  const preview = { getContext: vi.fn(() => null), width: 128, height: 128 }
  const showLabel = vi.fn()
  runner.bind({ preview: /** @type {any} */ (preview), showLabel })
  const runerrors = /** @type {any[]} */ ([])
  project.on('runerror', (e) => runerrors.push(e))
  /** What the editor has sent, by type. @param {string} type */
  const sent = (type) => editorEnd.sent.filter((m) => m.type === type)
  return { runner, project, editorEnd, playerEnd, open, preview, showLabel, runerrors, sent }
}

describe('createRunner', () => {
  it('opens the run tab and sends the cart at once', () => {
    const { runner, project, open, sent } = setup()
    project.setCode('cls(3)')
    const message = runner.run(project)
    expect(open).toHaveBeenCalledWith('http://x/#run')
    expect(message).toBe('running in the run tab')
    expect(runner.running).toBe(true)
    expect(sent('cart')).toHaveLength(1)
    expect(sent('cart')[0]).toMatchObject({ code: 'cls(3)', restart: true })
    expect(sent('cart')[0].rom).toHaveLength(pico8Profile.memory.romSize)
  })

  it('has a player url with the player hash', () => {
    expect(PLAYER_HASH).toBe('#run')
    vi.stubGlobal('location', { href: 'http://localhost:5173/index.html#code' })
    try {
      const [a] = linkedChannels()
      const open = vi.fn((/** @type {string} */ _url) => true)
      const runner = createRunner({ profile: pico8Profile, channel: () => a, open })
      runner.run(Project.empty(pico8Profile))
      expect(open.mock.calls[0][0]).toBe('http://localhost:5173/index.html#run')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('sends a copy of the ROM', () => {
    const { runner, project, sent } = setup()
    runner.run(project)
    project.region('gfx')[0] = 77
    expect(sent('cart')[0].rom[0]).toBe(0)
  })

  it('says so when the tab is blocked, and does not run', () => {
    const { runner, project, showLabel, sent, runerrors } = setup(false)
    expect(runner.run(project)).toMatch(/blocked/)
    expect(runner.running).toBe(false)
    expect(showLabel).toHaveBeenCalled()
    expect(runerrors).toEqual([null])
    expect(sent('cart')).toHaveLength(0)
    project.setCode('x = 1')
    vi.advanceTimersByTime(1000)
    expect(sent('cart')).toHaveLength(0)
  })

  describe('while running', () => {
    it('restarts the cart after the code stops changing', () => {
      const { runner, project, sent } = setup()
      runner.run(project)
      project.setCode('a')
      vi.advanceTimersByTime(CODE_DELAY - 1)
      project.setCode('ab')
      vi.advanceTimersByTime(CODE_DELAY - 1)
      expect(sent('cart')).toHaveLength(1)
      vi.advanceTimersByTime(1)
      expect(sent('cart')).toHaveLength(2)
      expect(sent('cart')[1]).toMatchObject({ code: 'ab', restart: true })
    })

    it('swaps in changed graphics without a restart', () => {
      const { runner, project, sent } = setup()
      runner.run(project)
      project.region('gfx')[3] = 9
      project.notifyRom(['gfx'])
      vi.advanceTimersByTime(ROM_DELAY)
      expect(sent('cart')).toHaveLength(2)
      expect(sent('cart')[1].restart).toBe(false)
      expect(sent('cart')[1].rom[3]).toBe(9)
    })

    it('folds close edits into one message, which restarts if any of them needs it', () => {
      const { runner, project, sent } = setup()
      runner.run(project)
      project.setCode('b')
      project.notifyRom(['map'])
      vi.advanceTimersByTime(CODE_DELAY + ROM_DELAY)
      expect(sent('cart')).toHaveLength(2)
      expect(sent('cart')[1].restart).toBe(true)
      // and the next one starts over
      project.notifyRom(['map'])
      vi.advanceTimersByTime(ROM_DELAY)
      expect(sent('cart')[2].restart).toBe(false)
    })

    it('restarts when another cart is loaded', () => {
      const { runner, project, sent } = setup()
      runner.run(project)
      project.load({ ...project.cart, code: 'other' }, 'other.p8')
      vi.advanceTimersByTime(0)
      expect(sent('cart')).toHaveLength(2)
      expect(sent('cart')[1]).toMatchObject({ code: 'other', restart: true })
    })

    it('does not pile up watchers when run is pressed again', () => {
      const { runner, project, sent } = setup()
      runner.run(project)
      runner.run(project)
      expect(sent('cart')).toHaveLength(2)
      project.setCode('c')
      vi.advanceTimersByTime(CODE_DELAY)
      expect(sent('cart')).toHaveLength(3)
    })

    it('hands the cart to a player that has just loaded', () => {
      const { runner, project, playerEnd, sent } = setup()
      runner.run(project)
      playerEnd.postMessage({ type: 'hello' })
      expect(sent('cart')).toHaveLength(2)
      expect(sent('cart')[1].restart).toBe(true)
    })

    it('shows what the cart reports', () => {
      const { runner, project, playerEnd, runerrors } = setup()
      runner.run(project)
      playerEnd.postMessage({ type: 'error', line: 4, message: 'boom' })
      playerEnd.postMessage({ type: 'ok' })
      expect(runerrors).toEqual([{ line: 4, message: 'boom' }, null])
    })

    it('paints the frames in the dock', () => {
      const { runner, project, playerEnd, preview } = setup()
      runner.run(project)
      playerEnd.postMessage({ type: 'frame', indices: new Uint8Array(128 * 128) })
      expect(preview.getContext).toHaveBeenCalled()
    })

    it('goes idle when the run tab is closed', () => {
      const { runner, project, playerEnd, showLabel, runerrors, sent } = setup()
      runner.run(project)
      playerEnd.postMessage({ type: 'bye' })
      expect(runner.running).toBe(false)
      expect(showLabel).toHaveBeenCalled()
      expect(runerrors).toEqual([null])
      project.setCode('later')
      vi.advanceTimersByTime(1000)
      expect(sent('cart')).toHaveLength(1)
    })
  })

  describe('stop', () => {
    it('tells the player, puts the label back and stops watching', () => {
      const { runner, project, showLabel, sent, runerrors } = setup()
      runner.run(project)
      project.setCode('pending')
      runner.stop()
      expect(sent('stop')).toHaveLength(1)
      expect(runner.running).toBe(false)
      expect(showLabel).toHaveBeenCalled()
      expect(runerrors).toEqual([null])
      vi.advanceTimersByTime(1000)
      expect(sent('cart')).toHaveLength(1) // the edit that was waiting never went out
    })

    it('has nothing to do when nothing runs', () => {
      const { runner, sent } = setup()
      expect(runner.stop()).toBe('nothing is running')
      expect(sent('stop')).toHaveLength(0)
    })

    it('ignores a hello from a player when it is not running', () => {
      const { runner, project, playerEnd, sent } = setup()
      runner.run(project)
      runner.stop()
      playerEnd.postMessage({ type: 'hello' })
      expect(sent('cart')).toHaveLength(1)
    })
  })

  it('closes the channel when destroyed', () => {
    const { runner, project, editorEnd } = setup()
    runner.run(project)
    runner.destroy()
    expect(editorEnd.closed).toBe(true)
    expect(runner.running).toBe(false)
  })
})
