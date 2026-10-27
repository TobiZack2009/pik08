// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from '../../src/ui/dom.js'
import { defineElements, showDialog } from '../../src/ui/elements/index.js'
import { ICONS } from '../../src/ui/icons.js'

defineElements()

afterEach(() => {
  document.body.replaceChildren()
})

/**
 * @param {string} key
 * @param {Element} target
 * @param {KeyboardEventInit} [init]
 */
function press(key, target, init) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

describe('h', () => {
  it('builds elements with attributes, classes, styles, listeners and children', () => {
    const onclick = vi.fn()
    const el = h(
      'div',
      { class: 'a b', id: 'x', hidden: true, nope: false, style: { color: 'red', '--k': '3' }, dataset: { n: 1 }, onclick, '.tabIndex': 2 },
      'text',
      [h('span', null, 'in'), null, undefined, false],
    )
    expect(el.className).toBe('a b')
    expect(el.getAttribute('hidden')).toBe('')
    expect(el.hasAttribute('nope')).toBe(false)
    expect(el.style.getPropertyValue('--k')).toBe('3')
    expect(el.dataset.n).toBe('1')
    expect(el.tabIndex).toBe(2)
    expect(el.textContent).toBe('textin')
    el.click()
    expect(onclick).toHaveBeenCalledTimes(1)
  })
})

describe('p8-icon', () => {
  it('renders the svg of a known icon and nothing for an unknown one', () => {
    const icon = h('p8-icon', { name: 'play' })
    document.body.append(icon)
    const svg = icon.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.querySelectorAll('path, line, circle, rect, polyline, polygon').length).toBe(ICONS.play.length)
    icon.setAttribute('name', 'nonexistent')
    expect(icon.querySelector('svg')?.children.length).toBe(0)
  })

  it('is hidden from assistive tech unless it has a label', () => {
    const icon = h('p8-icon', { name: 'play' })
    document.body.append(icon)
    expect(icon.getAttribute('role')).toBeNull()
    icon.setAttribute('label', 'Run')
    expect(icon.getAttribute('role')).toBe('img')
    expect(icon.getAttribute('aria-label')).toBe('Run')
  })
})

describe('p8-button', () => {
  it('wraps a button with icon and label', () => {
    const b = h('p8-button', { icon: 'play' }, 'Run')
    document.body.append(b)
    const inner = b.querySelector('button')
    expect(inner).not.toBeNull()
    expect(inner?.querySelector('p8-icon')?.getAttribute('name')).toBe('play')
    expect(inner?.textContent).toBe('Run')
  })

  it('names icon-only buttons from label or title', () => {
    const b = h('p8-button', { icon: 'play', title: 'Run (F5)' })
    document.body.append(b)
    expect(b.querySelector('button')?.getAttribute('aria-label')).toBe('Run (F5)')
  })

  it('does not fire clicks while disabled', () => {
    const onclick = vi.fn()
    const b = h('p8-button', { disabled: true, onclick }, 'Go')
    document.body.append(b)
    expect(b.querySelector('button')?.disabled).toBe(true)
    b.querySelector('button')?.click()
    expect(onclick).not.toHaveBeenCalled()
    b.removeAttribute('disabled')
    expect(b.querySelector('button')?.disabled).toBe(false)
  })

  it('toggles and reports it', () => {
    const onchange = vi.fn()
    const b = h('p8-button', { toggle: true, onchange }, 'Grid')
    document.body.append(b)
    const inner = /** @type {HTMLButtonElement} */ (b.querySelector('button'))
    expect(inner.getAttribute('aria-pressed')).toBe('false')
    inner.click()
    expect(b.hasAttribute('pressed')).toBe(true)
    expect(inner.getAttribute('aria-pressed')).toBe('true')
    expect(onchange.mock.calls[0][0].detail).toEqual({ pressed: true })
    inner.click()
    expect(b.hasAttribute('pressed')).toBe(false)
  })
})

describe('p8-tabs', () => {
  const tabs = [
    { id: 'code', label: 'Code' },
    { id: 'gfx', label: 'Sprites' },
    { id: 'map', label: 'Map' },
  ]

  function make() {
    const el = /** @type {any} */ (h('p8-tabs'))
    el.tabs = tabs
    document.body.append(el)
    return el
  }

  it('renders tabs and selects the first', () => {
    const el = make()
    const buttons = [...el.querySelectorAll('[role=tab]')]
    expect(buttons.map((b) => b.textContent)).toEqual(['Code', 'Sprites', 'Map'])
    expect(buttons.map((b) => b.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    expect(el.value).toBe('code')
  })

  it('changes on click and tells listeners', () => {
    const el = make()
    const onchange = vi.fn()
    el.addEventListener('change', onchange)
    el.querySelectorAll('[role=tab]')[2].click()
    expect(el.value).toBe('map')
    expect(onchange.mock.calls[0][0].detail).toEqual({ value: 'map' })
  })

  it('moves with the arrow keys, wrapping around', () => {
    const el = make()
    press('ArrowRight', el.querySelector('[role=tab]'))
    expect(el.value).toBe('gfx')
    press('End', el.querySelector('[role=tab]'))
    expect(el.value).toBe('map')
    press('ArrowRight', el.querySelector('[role=tab]'))
    expect(el.value).toBe('code')
    press('ArrowLeft', el.querySelector('[role=tab]'))
    expect(el.value).toBe('map')
  })

  it('does not fire change when set from code', () => {
    const el = make()
    const onchange = vi.fn()
    el.addEventListener('change', onchange)
    el.value = 'gfx'
    expect(onchange).not.toHaveBeenCalled()
    expect(el.querySelectorAll('[role=tab]')[1].getAttribute('aria-selected')).toBe('true')
  })
})

describe('p8-split', () => {
  function make(attrs = {}) {
    const el = /** @type {any} */ (h('p8-split', attrs, h('div', { id: 'a' }), h('div', { id: 'b' })))
    document.body.append(el)
    return el
  }

  it('puts a divider between two panes and sizes the fixed one', () => {
    const el = make({ size: '300', fixed: 'end' })
    const kids = [...el.children]
    expect(kids.map((k) => k.id || k.className)).toEqual(['a', 'p8-split__handle', 'b'])
    expect(kids[2].style.flex).toBe('0 0 300px')
    expect(kids[0].style.flex).toContain('1 1')
    expect(kids[1].getAttribute('role')).toBe('separator')
  })

  it('can fix the first pane instead', () => {
    const el = make({ size: '120', fixed: 'start' })
    expect(el.children[0].style.flex).toBe('0 0 120px')
  })

  it('resizes with the keyboard and fires resize', () => {
    const el = make({ size: '300', fixed: 'end', min: '100', max: '400' })
    const onresize = vi.fn()
    el.addEventListener('resize', onresize)
    const handle = el.querySelector('.p8-split__handle')
    press('ArrowLeft', handle) // the fixed pane is at the end, so left grows it
    expect(el.size).toBe(316)
    press('ArrowRight', handle, { shiftKey: true })
    expect(el.size).toBe(252)
    press('Home', handle)
    expect(el.size).toBe(100)
    press('End', handle)
    expect(el.size).toBe(400)
    press('Enter', handle)
    expect(el.size).toBe(300)
    expect(onresize).toHaveBeenCalled()
    expect(el.children[2].style.flex).toBe('0 0 300px')
  })

  it('remembers its size', () => {
    const el = make({ size: '200', 'storage-key': 'test' })
    el.size = 260
    el.remove()
    const again = make({ size: '200', 'storage-key': 'test' })
    expect(again.size).toBe(260)
    localStorage.removeItem('p8n.split.test')
  })
})

describe('p8-meter', () => {
  it('shows the use of a limit and its state', () => {
    const m = /** @type {any} */ (h('p8-meter', { label: 'tokens', value: 100, max: 1000 }))
    document.body.append(m)
    expect(m.textContent).toContain('tokens')
    expect(m.textContent).toContain('100 / 1000')
    expect(m.dataset.state).toBe('ok')
    expect(m.querySelector('.p8-meter__fill').style.width).toBe('10%')
    m.value = 900
    expect(m.dataset.state).toBe('warn')
    m.value = 1000
    expect(m.dataset.state).toBe('warn')
    m.value = 1200
    expect(m.dataset.state).toBe('over')
    expect(m.querySelector('.p8-meter__fill').style.width).toBe('100%')
    expect(m.getAttribute('aria-valuenow')).toBe('1200')
  })
})

describe('p8-palette', () => {
  function make(attrs = {}) {
    const el = /** @type {any} */ (h('p8-palette', { value: 7, ...attrs }))
    document.body.append(el)
    return el
  }

  it('shows 16 swatches with the selected one checked', () => {
    const el = make()
    const swatches = [...el.querySelectorAll('.p8-swatch')]
    expect(swatches).toHaveLength(16)
    expect(swatches[7].getAttribute('aria-checked')).toBe('true')
    expect(swatches[3].style.getPropertyValue('--swatch')).toBe('var(--p8-3)')
  })

  it('shows the extra colours on request', () => {
    expect(make({ count: 32 }).querySelectorAll('.p8-swatch')).toHaveLength(32)
  })

  it('selects by click and arrow keys', () => {
    const el = make()
    const onchange = vi.fn()
    el.addEventListener('change', onchange)
    el.querySelectorAll('.p8-swatch')[2].click()
    expect(el.value).toBe(2)
    expect(onchange.mock.calls[0][0].detail).toEqual({ value: 2 })
    press('ArrowDown', el.querySelector('.p8-swatch'))
    expect(el.value).toBe(6)
    press('ArrowRight', el.querySelector('.p8-swatch'))
    expect(el.value).toBe(7)
    press('ArrowUp', el.querySelector('.p8-swatch'))
    expect(el.value).toBe(3)
    press('ArrowUp', el.querySelector('.p8-swatch')) // 3 - 4 is off the top: stops at the first colour
    expect(el.value).toBe(0)
  })

  it('does not run off either end', () => {
    const el = make({ value: 0 })
    press('ArrowLeft', el.querySelector('.p8-swatch'))
    expect(el.value).toBe(0)
    el.value = 15
    press('ArrowRight', el.querySelector('.p8-swatch'))
    expect(el.value).toBe(15)
  })
})

describe('showDialog', () => {
  it('resolves with the chosen action', async () => {
    const result = showDialog({
      title: 'Hello',
      message: 'Sure?',
      actions: [
        { id: 'no', label: 'No' },
        { id: 'yes', label: 'Yes', primary: true },
      ],
    })
    const dialog = document.querySelector('p8-dialog')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.textContent).toContain('Sure?')
    ;/** @type {HTMLElement} */ (dialog?.querySelector('[data-action="yes"]')).click()
    expect(await result).toBe('yes')
    expect(document.querySelector('p8-dialog')).toBeNull()
  })

  it('resolves null on Escape', async () => {
    const result = showDialog({ title: 'Oops' })
    press('Escape', /** @type {Element} */ (document.querySelector('p8-dialog')))
    expect(await result).toBeNull()
    expect(document.querySelector('p8-dialog')).toBeNull()
  })

  it('focuses the primary action and returns focus afterwards', async () => {
    const opener = h('button', null, 'open')
    document.body.append(opener)
    opener.focus()
    const result = showDialog({
      title: 'x',
      actions: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B', primary: true },
      ],
    })
    expect(document.activeElement?.closest('[data-action]')?.getAttribute('data-action')).toBe('b')
    press('Escape', /** @type {Element} */ (document.querySelector('p8-dialog')))
    await result
    expect(document.activeElement).toBe(opener)
  })

  it('keeps Tab inside', async () => {
    const result = showDialog({
      title: 'x',
      actions: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B', primary: true },
      ],
    })
    const dialog = /** @type {Element} */ (document.querySelector('p8-dialog'))
    const buttons = dialog.querySelectorAll('button')
    buttons[1].focus()
    press('Tab', buttons[1])
    expect(document.activeElement).toBe(buttons[0])
    press('Tab', buttons[0], { shiftKey: true })
    expect(document.activeElement).toBe(buttons[1])
    press('Escape', dialog)
    await result
  })
})

describe('p8-toolbar', () => {
  it('moves focus with the arrow keys', () => {
    const bar = h(
      'p8-toolbar',
      null,
      h('p8-button', { id: 'one' }, 'One'),
      h('p8-button', { id: 'two' }, 'Two'),
      h('p8-button', { id: 'three' }, 'Three'),
    )
    document.body.append(bar)
    const [one, two, three] = [...bar.querySelectorAll('button')]
    expect(bar.getAttribute('role')).toBe('toolbar')
    one.focus()
    press('ArrowRight', one)
    expect(document.activeElement).toBe(two)
    press('End', two)
    expect(document.activeElement).toBe(three)
    press('ArrowRight', three)
    expect(document.activeElement).toBe(one)
    press('ArrowLeft', one)
    expect(document.activeElement).toBe(three)
  })
})
