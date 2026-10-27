import './app.css'
import { h } from './dom.js'
import { EDITORS, SETTINGS_TAB, TABS } from './editors/index.js'
import { defineElements } from './elements/index.js'
import { browserIO, createFileActions, enableDropOpen } from './file-actions.js'
import { titleHints, keysSuffix } from './hints.js'
import { createBindings, describeActions } from './shortcuts.js'
import { limitUsage } from './stats.js'
import { watchStats } from './stats-model.js'
import { createSoundService } from './audio.js'
import { Project } from './store.js'
import { applyPrefs, loadPrefs } from './theme.js'
import { paintIndexed } from '../player/renderer.js'

/** @import { Profile } from '../core/profile.js' */
/** @import { EditorFactory, EditorView } from './editors/index.js' */
/** @import { FileIO } from './file-actions.js' */

const TAB_KEY = 'p8n.tab'

/**
 * What runs the cart. The shell only starts and stops it; the player decides how.
 * @typedef {Object} Runner
 * @property {(project: Project) => string | void} run
 * @property {() => string | void} stop
 */

/**
 * @typedef {Object} AppOptions
 * @property {Profile} profile
 * @property {Record<string, EditorFactory>} [editors]
 * @property {Runner} [runner]
 * @property {(host: import('./cli-drawer.js').CliHost) => EditorView} [cli]  the command drawer
 * @property {FileIO} [io]  replaced in tests
 * @property {import('./audio.js').SoundOptions} [sound]  replaced in tests (a fake audio output)
 */

/**
 * Builds the editor: top bar, tabs, editor area with the side dock, command drawer, status bar.
 *
 * @param {HTMLElement} root
 * @param {AppOptions} options
 */
export function mountApp(root, { profile, editors = EDITORS, runner, cli, io = browserIO, sound: soundOptions }) {
  defineElements()
  const project = Project.starter(profile)
  const sound = createSoundService(project, soundOptions)
  const actions = createFileActions(project, io)
  const prefs = loadPrefs()
  const bindings = createBindings()
  const settings = {
    prefs: () => prefs,
    /** @param {Partial<typeof prefs>} patch */
    setPrefs(patch) {
      Object.assign(prefs, patch)
      applyPrefs(prefs)
    },
    bindings,
    actions: describeActions(TABS),
  }

  // ---- status bar -------------------------------------------------------------------------------
  const message = h('span', { class: 'status__message', role: 'status', 'aria-live': 'polite' }, 'ready')
  const info = h('span', { class: 'status__info' })
  const numbers = /** @type {Record<string, HTMLElement>} */ ({
    tokens: h('span', { class: 'status__num' }),
    codeChars: h('span', { class: 'status__num' }),
    compressedBytes: h('span', { class: 'status__num' }),
  })
  const status = h('footer', { class: 'app__status raised' }, message, info, ...Object.values(numbers))

  /** @param {string} text */
  const setStatus = (text) => (message.textContent = text)
  /** @param {string} text */
  const setInfo = (text) => (info.textContent = text)

  /** @param {Promise<string>} action */
  const report = (action) => action.then(setStatus, (e) => setStatus(String(e?.message ?? e)))

  // ---- run --------------------------------------------------------------------------------------
  const runNow = () => (runner ? (runner.run(project) ?? 'running') : 'running is not available yet')
  const requestRun = () => setStatus(runNow())
  const requestStop = () => setStatus(runner ? (runner.stop() ?? 'stopped') : 'nothing is running')

  // ---- editors ----------------------------------------------------------------------------------
  const ctx = { project, setStatus, setInfo, requestRun, sound, settings, bindings }
  const editorArea = h('div', { class: 'app__editors' })
  /** @type {Map<string, { view: EditorView, wrap: HTMLElement }>} */
  const open = new Map()
  /** @type {string} */
  let current = ''
  /** The tab to go back to when the settings close. */
  let lastTab = TABS[0].id

  const tabs = /** @type {any} */ (h('p8-tabs', { class: 'app__tabs' }))

  /** @param {string} id */
  function showTab(id) {
    if (id !== SETTINGS_TAB && !TABS.some((t) => t.id === id)) return
    if (current === id) return
    open.get(current)?.view.deactivate?.()
    open.get(current)?.wrap.setAttribute('hidden', '')
    let entry = open.get(id)
    if (!entry) {
      const view = editors[id](ctx)
      const wrap = h('div', { class: 'app__editor', dataset: { editor: id } }, view.el)
      editorArea.append(wrap)
      open.set(id, (entry = { view, wrap }))
    }
    entry.wrap.removeAttribute('hidden')
    current = id
    tabs.value = id
    settingsButton.toggleAttribute('pressed', id === SETTINGS_TAB)
    setInfo('')
    entry.view.activate?.()
    if (id === SETTINGS_TAB) return // the next visit starts on the tab before it
    lastTab = id
    try {
      localStorage.setItem(TAB_KEY, id)
    } catch {
      // not remembered
    }
  }

  /** @param {boolean} [show] */
  function toggleSettings(show = current !== SETTINGS_TAB) {
    showTab(show ? SETTINGS_TAB : lastTab)
  }
  tabs.addEventListener('change', (/** @type {CustomEvent} */ e) => showTab(e.detail.value))

  // ---- dock -------------------------------------------------------------------------------------
  const { width, height } = profile.display
  const preview = /** @type {HTMLCanvasElement} */ (
    h('canvas', { class: 'pixel app__preview-canvas', width, height, 'aria-label': 'cart label or live preview' })
  )
  const paintLabel = () => {
    const label = project.cart.label
    if (label) paintIndexed(preview, label, profile.display.palette)
    else preview.getContext('2d')?.clearRect(0, 0, width, height)
  }

  const infoRows = {
    file: h('dd'),
    profile: h('dd', null, profile.name),
    version: h('dd'),
    label: h('dd'),
  }
  const cartInfo = h(
    'dl',
    { class: 'app__info' },
    h('dt', null, 'file'),
    infoRows.file,
    h('dt', null, 'profile'),
    infoRows.profile,
    h('dt', null, 'version'),
    infoRows.version,
    h('dt', null, 'label'),
    infoRows.label,
  )
  const renderInfo = () => {
    infoRows.file.textContent = project.fileName + (project.dirty ? ' (unsaved)' : '')
    infoRows.version.textContent = String(project.cart.version)
    infoRows.label.textContent = project.cart.label ? 'yes' : 'none'
  }

  /** @type {Map<string, any>} */
  const meters = new Map()
  const meterBox = h('div', { class: 'app__meters' })
  for (const usage of limitUsage({ tokens: 0, chars: 0, compressed: 0 }, profile.limits)) {
    const meter = h('p8-meter', { label: usage.label, value: 0, max: usage.max })
    meters.set(usage.key, meter)
    meterBox.append(meter)
  }

  const section = (/** @type {string} */ title, /** @type {any[]} */ ...content) =>
    h('section', { class: 'app__section' }, h('h2', null, title), ...content)

  const dock = h(
    'aside',
    { class: 'app__dock raised', 'aria-label': 'cart overview' },
    section('Preview', h('div', { class: 'app__preview sunken' }, preview)),
    section('Cart', cartInfo),
    section('Limits', meterBox),
  )

  /** @param {import('./stats-model.js').LiveStats} stats */
  const renderStats = (stats) => {
    for (const usage of limitUsage(stats, profile.limits)) {
      const meter = meters.get(usage.key)
      if (meter) meter.value = usage.value
    }
    for (const [key, label, max] of /** @type {const} */ ([
      ['tokens', 'tokens', profile.limits.tokens],
      ['codeChars', 'chars', profile.limits.codeChars],
      ['compressedBytes', 'compressed', profile.limits.compressedBytes],
    ])) {
      const el = numbers[key]
      if (max === undefined) {
        el.hidden = true
        continue
      }
      const value = { tokens: stats.tokens, codeChars: stats.chars, compressedBytes: stats.compressed }[key]
      el.textContent = `${label} ${value ?? '…'}/${max}`
      el.dataset.state = value === undefined ? 'ok' : value > max ? 'over' : value / max >= 0.9 ? 'warn' : 'ok'
    }
  }
  const stats = watchStats(project, renderStats)
  renderStats(stats.get())

  // ---- top bar ----------------------------------------------------------------------------------
  const fileName = h('span', { class: 'app__file' })
  const renderFile = () => {
    fileName.textContent = project.fileName + (project.dirty ? ' *' : '')
    document.title = `${project.dirty ? '* ' : ''}${project.fileName} - p8n`
    renderInfo()
  }

  // Tooltips name the shortcut, so they follow it when it is rebound.
  const hints = titleHints(bindings)
  const hint = hints.hint
  function retitle() {
    tabs.tabs = TABS.map((tab, i) => ({ ...tab, title: tab.label + keysSuffix(bindings, `tab:${i}`) }))
    tabs.value = current
  }

  const button = (
    /** @type {string} */ icon,
    /** @type {string} */ title,
    /** @type {import('./shortcuts.js').ShortcutAction | undefined} */ action,
    /** @type {() => void} */ onclick,
  ) => {
    const el = h('p8-button', { icon, title, onclick })
    return action ? hint(el, title, action) : el
  }

  const settingsButton = hint(
    h('p8-button', {
      icon: 'settings',
      variant: 'ghost',
      toggle: true,
      onchange: (/** @type {CustomEvent} */ e) => toggleSettings(e.detail.pressed),
    }),
    'Settings',
    'toggleSettings',
  )

  /** @type {EditorView | undefined} */
  let cliView
  const cliBox = h('div', { class: 'app__cli sunken', hidden: true })
  const cliButton = h('p8-button', {
    icon: 'terminal',
    variant: 'ghost',
    toggle: true,
    onchange: (/** @type {CustomEvent} */ e) => setCli(e.detail.pressed),
  })
  hint(cliButton, 'Command line', 'toggleCli')
  /** @param {boolean} visible */
  function setCli(visible) {
    if (visible && !cli) {
      setStatus('the command line is not available yet')
      cliButton.removeAttribute('pressed')
      return
    }
    if (visible && !cliView) {
      cliView = cli?.({ ...ctx, actions, run: runNow })
      if (cliView) cliBox.append(cliView.el)
    }
    cliBox.hidden = !visible
    cliButton.toggleAttribute('pressed', visible)
    if (visible) cliView?.activate?.()
    else cliView?.deactivate?.()
  }

  const top = h(
    'header',
    { class: 'app__top raised' },
    h('strong', { class: 'app__brand' }, 'p8n'),
    h(
      'p8-toolbar',
      { class: 'app__toolbar' },
      hint(h('p8-button', { icon: 'play', variant: 'primary', onclick: requestRun }, 'Run'), 'Run', 'run'),
      button('stop', 'Stop', 'stop', requestStop),
      h('span', { class: 'sep' }),
      button('file-plus', 'New cart', undefined, () => report(actions.newCart())),
      button('folder-open', 'Open', 'open', () => report(actions.open())),
      button('save', 'Save', 'save', () => report(actions.save())),
      button('download', 'Export .p8.png', 'export', () => report(actions.exportCart('png'))),
      fileName,
    ),
    tabs,
    h('span', { class: 'spacer' }),
    cliButton,
    settingsButton,
  )
  retitle()

  // ---- assembly ---------------------------------------------------------------------------------
  const split = h('p8-split', { class: 'app__main', fixed: 'end', size: 280, min: 200, 'storage-key': 'dock' }, editorArea, dock)
  root.replaceChildren(h('div', { class: 'app' }, top, split, cliBox, status))

  // ---- wiring -----------------------------------------------------------------------------------
  const offs = [
    project.on('meta', renderFile),
    project.on('load', () => {
      paintLabel()
      renderInfo()
    }),
    bindings.on(retitle),
    hints.destroy,
  ]
  renderFile()
  paintLabel()

  /** @param {KeyboardEvent} e */
  const onKey = (e) => {
    if (document.querySelector('p8-dialog')) return
    const action = bindings.match(e)
    if (!action) return
    e.preventDefault()
    if (action.startsWith('tab:')) {
      const tab = TABS[Number(action.slice(4))]
      if (tab) showTab(tab.id)
      return
    }
    switch (action) {
      case 'save':
        return void report(actions.save())
      case 'saveAs':
        return void report(actions.saveAs())
      case 'open':
        return void report(actions.open())
      case 'export':
        return void report(actions.exportCart('png'))
      case 'run':
        return requestRun()
      case 'stop':
        return requestStop()
      case 'toggleCli':
        return setCli(Boolean(cliBox.hidden))
      case 'toggleSettings':
        return toggleSettings()
    }
  }
  /** @param {BeforeUnloadEvent} e */
  const onUnload = (e) => {
    if (!project.dirty) return
    e.preventDefault()
    e.returnValue = ''
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('beforeunload', onUnload)
  const stopDrop = enableDropOpen(actions, setStatus)

  let saved = ''
  try {
    saved = localStorage.getItem(TAB_KEY) ?? ''
  } catch {
    // no storage
  }
  // the sfx and music tabs of earlier versions became the sound tab
  if (saved === 'sfx' || saved === 'music') saved = 'sound'
  showTab(TABS.some((t) => t.id === saved) ? saved : TABS[0].id)

  return {
    project,
    actions,
    showTab,
    setStatus,
    /** The canvas in the dock; the player draws the live preview here. */
    preview,
    /** Puts the cart label back on the dock canvas. */
    showLabel: paintLabel,
    /** The tab that is showing. */
    get tab() {
      return current
    },
    destroy() {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('beforeunload', onUnload)
      stopDrop()
      stats.dispose()
      for (const off of offs) off()
      for (const { view } of open.values()) view.destroy?.()
      cliView?.destroy?.()
      void sound.destroy()
      root.replaceChildren()
    },
  }
}
