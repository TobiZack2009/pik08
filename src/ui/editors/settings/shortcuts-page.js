import { elemake } from '../../dom.js'
import { bindingOf, formatBinding, formatHeld } from '../../shortcuts.js'

/** @import { ActionSpec } from '../../shortcuts.js' */
/** @import { SettingsApi } from './settings-editor.js' */

const PROMPT = 'press keys…'

/**
 * One action and a single button for its keys. Click it and press the new combination, modifiers
 * included: the keys held show on the button as they go down, and the first other key completes it.
 * The combination replaces the action's keys. Backspace clears them, Escape cancels.
 * @param {ActionSpec} spec
 * @param {SettingsApi} settings
 */
function shortcutRow(spec, { bindings, actions }) {
  let recording = false
  /** Whether the next space bar release must not click the button again. */
  let swallowSpaceUp = false

  const error = elemake('div', { class: 'settings__error', role: 'alert' })
  const reset = elemake('p8-button', {
    icon: 'rotate-ccw',
    variant: 'ghost',
    title: `Reset ${spec.label} to its default`,
    onclick: () => bindings.reset(spec.id),
  })
  const key = elemake('button', {
    type: 'button',
    class: 'settings__key',
    title: 'Click, then press the new shortcut',
    onclick: begin,
    onkeydown: onKey,
    onkeyup: onKeyUp,
    onblur: () => {
      if (recording) render()
    },
  })
  const el = elemake('div', { class: 'settings__row settings__row--keys', dataset: { action: spec.id } }, elemake('span', { class: 'settings__label' }, spec.label), key, reset, error)

  /** @param {string} id */
  const nameOf = (id) => {
    const other = actions.find((a) => a.id === id)
    if (!other) return id
    const shared = actions.some((a) => a !== other && a.label === other.label)
    return shared ? `${other.label} (${other.group.toLowerCase()})` : other.label
  }

  function begin() {
    if (recording) return
    recording = true
    key.textContent = PROMPT
    key.dataset.recording = ''
    key.setAttribute('aria-label', `Press the new shortcut for ${spec.label}`)
    key.focus()
  }

  function render() {
    recording = false
    error.textContent = ''
    delete key.dataset.recording
    const list = bindings.get(spec.id)
    key.textContent = list.length ? list.map((binding) => formatBinding(binding)).join(' / ') : 'Unassigned'
    key.classList.toggle('settings__key--empty', !list.length)
    key.setAttribute('aria-label', `${spec.label}: ${key.textContent}. Change`)
    reset.toggleAttribute('hidden', !bindings.isCustom(spec.id))
  }

  /** Ends the recording and keeps the focus on the button. */
  function stop() {
    render()
    key.focus()
  }

  /** What the button says while the keys are down: the modifiers held so far. @param {KeyboardEvent} e */
  function showHeld(e) {
    const held = formatHeld(e)
    key.textContent = held ? `${held}+…` : PROMPT
  }

  /** @param {KeyboardEvent} e */
  function onKey(e) {
    if (!recording || e.key === 'Tab') return
    // none of this may reach the app's own shortcuts, or the browser's
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') return stop()
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === 'Backspace' || e.key === 'Delete')) {
      bindings.unbind(spec.id)
      return stop()
    }
    const binding = bindingOf(e)
    if (!binding) return showHeld(e) // only a modifier so far
    const refused = bindings.assign(spec.id, binding)
    if (!refused) {
      swallowSpaceUp = e.key === ' '
      return stop()
    }
    const shown = formatBinding(binding)
    error.textContent = refused.error === 'invalid' ? `${shown}: ${refused.message}` : `${shown} is already used by ${nameOf(refused.by)}`
    showHeld(e)
  }

  /** @param {KeyboardEvent} e */
  function onKeyUp(e) {
    if (e.key === ' ' && swallowSpaceUp) {
      swallowSpaceUp = false
      e.preventDefault() // or releasing the space bar would click the button and start over
      return
    }
    if (recording) showHeld(e)
  }

  render()
  return { el, render }
}

/**
 * The Shortcuts category: every action with its keys, grouped.
 * @param {SettingsApi} settings
 */
export function shortcutsPage(settings) {
  const { bindings, actions } = settings
  const rows = actions.map((spec) => shortcutRow(spec, settings))
  const resetAll = elemake('p8-button', { icon: 'rotate-ccw', onclick: () => bindings.resetAll() }, 'Reset all')

  const refresh = () => {
    for (const r of rows) r.render()
    resetAll.toggleAttribute('disabled', !bindings.anyCustom())
  }
  const off = bindings.on(refresh)
  resetAll.toggleAttribute('disabled', !bindings.anyCustom())

  const groups = [...new Set(actions.map((a) => a.group))]
  const el = elemake(
    'section',
    { class: 'settings__section' },
    elemake(
      'div',
      { class: 'settings__header' },
      elemake('h2', { class: 'settings__title' }, 'Shortcuts'),
      elemake('span', { class: 'spacer' }),
      resetAll,
    ),
   
    groups.map((group) =>
      elemake(
        'div',
        { class: 'settings__group' },
        elemake('h3', { class: 'settings__subtitle' }, group),
        rows.filter((_, i) => actions[i].group === group).map((r) => r.el),
      ),
    ),
  )
  return { el, destroy: off }
}
