import { createStarterCart } from '../core/cart.js'
import { ExportLimitError, FormatError } from '../formats/errors.js'
import {
  baseName,
  decodeCart,
  describeLimitError,
  detectFormat,
  encodeP8,
  encodeP8Png,
  pickFile,
  readFile,
  saveFile,
} from './files.js'
import { showDialog } from './elements/index.js'

/** @import { Project } from './store.js' */
/** @import { OpenedFile } from './files.js' */

/**
 * What the file actions need from the outside world. Tests replace it.
 * @typedef {Object} FileIO
 * @property {() => Promise<OpenedFile | null>} pickFile
 * @property {typeof saveFile} saveFile
 * @property {(options: { title: string, message: string, ok: string, danger?: boolean }) => Promise<boolean>} confirm
 * @property {(options: { title: string, message: string, actions: { id: string, label: string, primary?: boolean }[] }) => Promise<string | null>} choose
 */

/** @type {FileIO} */
export const browserIO = {
  pickFile,
  saveFile,
  confirm: async ({ title, message, ok, danger }) =>
    (await showDialog({
      title,
      message,
      actions: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'ok', label: ok, primary: !danger, danger },
      ],
    })) === 'ok',
  choose: showDialog,
}

/**
 * Open, save, export and new, on top of a `Project`. Every action resolves to a one-line message
 * for the status bar or the command line; failures that need the user's attention open a dialog.
 *
 * @param {Project} project
 * @param {FileIO} [io]
 */
export function createFileActions(project, io = browserIO) {
  /** File System Access handle of the last `.p8` opened or saved, so Save writes back to it. */
  /** @type {any} */
  let handle = null
  const profile = () => project.profile

  /** @param {string} name */
  const withP8 = (name) => (/\.p8$/i.test(name) ? name : `${baseName(name)}.p8`)

  async function confirmDiscard() {
    if (!project.dirty) return true
    return io.confirm({
      title: 'Discard changes?',
      message: `${project.fileName} has changes that are not saved.`,
      ok: 'Discard',
      danger: true,
    })
  }

  /**
   * @param {OpenedFile} file
   * @returns {Promise<string>}
   */
  async function openOpened(file) {
    try {
      const cart = decodeCart(file.bytes, profile())
      project.load(cart, file.name)
      handle = file.handle && detectFormat(file.bytes) === 'p8' ? file.handle : null
      return `opened ${file.name}`
    } catch (e) {
      if (!(e instanceof FormatError)) throw e
      await io.choose({
        title: `Can't open ${file.name}`,
        message: e.message,
        actions: [{ id: 'ok', label: 'OK', primary: true }],
      })
      return `could not open ${file.name}: ${e.message}`
    }
  }

  /**
   * Saves as .p8: back to the file it came from, or after asking where. With a name, it is
   * the suggested name (and the file is not written back in place).
   * @param {string} [name]
   * @returns {Promise<string>}
   */
  async function save(name) {
    const target = name ? withP8(name) : withP8(project.fileName)
    const result = await io.saveFile(encodeP8(project.cart, profile()), target, 'p8', name ? undefined : handle)
    if (!result) return 'cancelled'
    if (result.handle) handle = result.handle
    project.markSaved(result.name)
    return `saved ${result.name}`
  }

  return {
    save,

    /** Saves as .p8 after asking where, even if the project already has a file. */
    saveAs: () => save(project.fileName),

    /** Asks for a file, then loads it. */
    async open() {
      if (!(await confirmDiscard())) return 'cancelled'
      const file = await io.pickFile()
      return file ? openOpened(file) : 'cancelled'
    },

    /**
     * Loads a file that was dropped on the window.
     * @param {File} file
     */
    async openDropped(file) {
      if (!(await confirmDiscard())) return 'cancelled'
      return openOpened(await readFile(file))
    },

    /**
     * Exports a .p8.png (refused, with a dialog, when over a limit) or a .p8 copy.
     * @param {'png' | 'p8'} format
     * @param {string} [name]
     * @returns {Promise<string>}
     */
    async exportCart(format, name) {
      if (format === 'p8') {
        const result = await io.saveFile(encodeP8(project.cart, profile()), withP8(name ?? project.fileName), 'p8')
        return result ? `exported ${result.name}` : 'cancelled'
      }
      /** @type {Uint8Array} */
      let bytes
      try {
        bytes = encodeP8Png(project.cart, profile())
      } catch (e) {
        if (!(e instanceof ExportLimitError)) throw e
        const { title, message } = describeLimitError(e)
        const choice = await io.choose({
          title,
          message,
          actions: [
            { id: 'cancel', label: 'Cancel' },
            { id: 'p8', label: 'Save as .p8', primary: true },
          ],
        })
        if (choice === 'p8') return save()
        return `export blocked: ${e.message}`
      }
      const suggested = `${baseName(name ?? project.fileName)}.p8.png`
      const result = await io.saveFile(bytes, suggested, 'p8png')
      return result ? `exported ${result.name}` : 'cancelled'
    },

    /** Starts a new cart with the profile's starter code. */
    async newCart() {
      if (!(await confirmDiscard())) return 'cancelled'
      project.load(createStarterCart(profile()), 'untitled.p8')
      handle = null
      return 'new cart'
    },
  }
}

/** @typedef {ReturnType<typeof createFileActions>} FileActions */

/**
 * Lets a .p8 or .p8.png be dropped anywhere on the window.
 * @param {FileActions} actions
 * @param {(message: string) => void} report
 * @param {Window} [win]
 * @returns {() => void} remove the listeners
 */
export function enableDropOpen(actions, report, win = window) {
  /** @param {DragEvent} e */
  const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  /** @param {DragEvent} e */
  const over = (e) => {
    if (hasFiles(e)) e.preventDefault()
  }
  /** @param {DragEvent} e */
  const drop = (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    const file = e.dataTransfer?.files[0]
    if (file) actions.openDropped(file).then(report, (err) => report(String(err?.message ?? err)))
  }
  win.addEventListener('dragover', over)
  win.addEventListener('drop', drop)
  return () => {
    win.removeEventListener('dragover', over)
    win.removeEventListener('drop', drop)
  }
}
