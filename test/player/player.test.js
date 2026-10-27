// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountPlayer } from '../../src/player/index.js'
import { pico8Profile } from '../../src/profiles/pico8/index.js'
import { fakeClock, linkedChannels } from '../helpers/channel.js'

/** @type {ReturnType<typeof mountPlayer> | undefined} */
let player

afterEach(() => {
  player?.destroy()
  player = undefined
})

function setup() {
  const [playerEnd, editorEnd] = linkedChannels()
  const clock = fakeClock()
  const root = document.createElement('div')
  document.body.append(root)
  // the frame throttle follows the same clock
  player = mountPlayer(root, { profile: pico8Profile, channel: () => playerEnd, now: clock.now, clock })
  const rom = () => pico8Profile.cart.createRom()
  /** What the player has sent, by type. @param {string} type */
  const sent = (type) => playerEnd.sent.filter((m) => m.type === type)
  const note = /** @type {HTMLElement} */ (root.querySelector('.player__note'))
  return { root, clock, editorEnd, playerEnd, rom, sent, note, game: player.game, canvas: player.canvas }
}

describe('mountPlayer', () => {
  it('shows a canvas the size of the screen and asks the editor for a cart', () => {
    const { root, sent, note, canvas } = setup()
    expect(root.querySelector('.player__stage canvas')).toBe(canvas)
    expect(canvas.width).toBe(128)
    expect(canvas.height).toBe(128)
    expect(note.textContent).toMatch(/waiting/)
    expect(sent('hello')).toHaveLength(1)
    expect(document.title).toBe('p8n - run')
  })

  it('scales the canvas by a whole number', () => {
    const { canvas } = setup()
    const width = parseInt(canvas.style.width)
    expect(width).toBeGreaterThanOrEqual(128)
    expect(width % 128).toBe(0)
    expect(parseInt(canvas.style.height)).toBe(width)
  })

  it('runs the cart it is sent and says so', () => {
    const { editorEnd, rom, sent, note, game, clock } = setup()
    editorEnd.postMessage({ type: 'cart', code: 'n = 0 function _update() n += 1 end function _draw() cls(2) end', rom: rom(), restart: true })
    expect(game.running).toBe(true)
    expect(note.textContent).toBe('running')
    expect(sent('ok')).toHaveLength(1)
    clock.frames(3)
    expect(game.program?.G.get('n')).toBe(3)
  })

  it('saves a screenshot when the cart asks for one', () => {
    const { editorEnd, rom, canvas } = setup()
    const blob = new Blob(['png'])
    canvas.toBlob = (callback) => callback(blob)
    const urls = { create: vi.fn(() => 'blob:shot'), revoke: vi.fn() }
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: urls.create, revokeObjectURL: urls.revoke }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      /** @this {HTMLAnchorElement} */ function () {
        expect(this.download).toBe('p8n-screen.png')
      },
    )
    editorEnd.postMessage({ type: 'cart', code: 'extcmd("screen")', rom: rom(), restart: true })
    expect(urls.create).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalledTimes(1)
    expect(urls.revoke).toHaveBeenCalledWith('blob:shot')
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('sends frames to the editor, but not too often', () => {
    const { editorEnd, rom, sent, clock } = setup()
    editorEnd.postMessage({ type: 'cart', code: 'function _draw() cls(2) end', rom: rom(), restart: true })
    const first = sent('frame').length
    expect(first).toBeGreaterThan(0)
    expect(sent('frame')[0].indices).toHaveLength(128 * 128)
    expect(sent('frame')[0].indices[0]).toBe(0) // the start frame, before _draw ran
    clock.frames(1) // 33 ms later
    clock.frames(1) // 66 ms
    expect(sent('frame').length).toBe(first)
    clock.frames(2) // 133 ms
    expect(sent('frame').length).toBe(first + 1)
    expect(sent('frame').at(-1).indices[0]).toBe(2)
  })

  it('reports an error to the editor and shows it', () => {
    const { editorEnd, rom, sent, note } = setup()
    editorEnd.postMessage({ type: 'cart', code: 'x = 1\ny = nil + 1', rom: rom(), restart: true })
    expect(sent('error')).toEqual([{ type: 'error', line: 2, message: expect.any(String) }])
    expect(note.textContent).toMatch(/^line 2: /)
    expect(note.dataset.state).toBe('error')
  })

  it('clears the error when the next cart runs', () => {
    const { editorEnd, rom, note } = setup()
    editorEnd.postMessage({ type: 'cart', code: 'y = nil + 1', rom: rom(), restart: true })
    editorEnd.postMessage({ type: 'cart', code: 'function _update() end', rom: rom(), restart: true })
    expect(note.textContent).toBe('running')
    expect(note.dataset.state).toBeUndefined()
  })

  describe('a cart that arrives while one is running', () => {
    const code = 'n = 0 function _update() n += 1 end function _draw() cls(1) spr(1, 0, 0) end'

    it('is a restart when the code changed', () => {
      const { editorEnd, rom, clock, game } = setup()
      editorEnd.postMessage({ type: 'cart', code, rom: rom(), restart: true })
      clock.frames(3)
      editorEnd.postMessage({ type: 'cart', code: code + ' ', rom: rom(), restart: false })
      clock.frames(1)
      expect(game.program?.G.get('n')).toBe(1)
    })

    it('is a restart when asked for', () => {
      const { editorEnd, rom, clock, game } = setup()
      editorEnd.postMessage({ type: 'cart', code, rom: rom(), restart: true })
      clock.frames(3)
      editorEnd.postMessage({ type: 'cart', code, rom: rom(), restart: true })
      clock.frames(1)
      expect(game.program?.G.get('n')).toBe(1)
    })

    it('swaps the ROM in when only that changed', () => {
      const { editorEnd, rom, clock, game, sent } = setup()
      editorEnd.postMessage({ type: 'cart', code, rom: rom(), restart: true })
      clock.frames(3)
      const next = rom()
      next[4] = 0x07
      editorEnd.postMessage({ type: 'cart', code, rom: next, restart: false })
      clock.frames(1)
      expect(game.program?.G.get('n')).toBe(4)
      expect(game.graphics?.sget(8, 0)).toBe(7)
      expect(sent('ok')).toHaveLength(1) // no second start
    })
  })

  it('stops when told to', () => {
    const { editorEnd, rom, note, game } = setup()
    editorEnd.postMessage({ type: 'cart', code: 'function _update() end', rom: rom(), restart: true })
    editorEnd.postMessage({ type: 'stop' })
    expect(game.running).toBe(false)
    expect(note.textContent).toBe('stopped')
  })

  it('ignores messages it does not know', () => {
    const { editorEnd, game } = setup()
    editorEnd.postMessage({ type: 'what' })
    editorEnd.postMessage(null)
    expect(game.running).toBe(false)
  })

  it('plays with the keyboard', () => {
    const { editorEnd, rom, clock, game } = setup()
    editorEnd.postMessage({ type: 'cart', code: 'function _update() right = btn(1) end', rom: rom(), restart: true })
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }))
    clock.frames(1)
    expect(game.program?.G.get('right')).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowRight' }))
    clock.frames(1)
    expect(game.program?.G.get('right')).toBe(false)
  })

  it('wakes the sound on a click or key press', () => {
    const { game } = setup()
    const wake = vi.spyOn(game, 'wake')
    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' }))
    expect(wake).toHaveBeenCalledTimes(2)
    player?.destroy()
    window.dispatchEvent(new Event('pointerdown'))
    expect(wake).toHaveBeenCalledTimes(2)
    player = undefined
  })

  it('tells the editor when the tab goes away', () => {
    const { sent } = setup()
    window.dispatchEvent(new Event('pagehide'))
    expect(sent('bye')).toHaveLength(1)
  })

  it('cleans up after itself', () => {
    const { root, playerEnd, game, editorEnd, rom } = setup()
    editorEnd.postMessage({ type: 'cart', code: 'function _update() end', rom: rom(), restart: true })
    player?.destroy()
    expect(game.running).toBe(false)
    expect(playerEnd.closed).toBe(true)
    expect(root.children).toHaveLength(0)
    window.dispatchEvent(new Event('pagehide')) // nobody is left to answer
    player = undefined
  })
})
