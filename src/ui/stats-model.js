import { compressedSize, quickStats } from './stats.js'

/** @import { Project } from './store.js' */
/** @import { CartStats } from './stats.js' */

/**
 * @typedef {CartStats & { compressed?: number }} LiveStats
 */

/**
 * Keeps the numbers for the status bar and the limit meters up to date. Token and character counts
 * follow every edit; the compressed size is slower, so it waits until typing pauses.
 *
 * @param {Project} project
 * @param {(stats: LiveStats) => void} onChange
 * @param {{ delay?: number, compress?: (code: string) => number }} [options]
 * @returns {{ get: () => LiveStats, dispose: () => void }}
 */
export function watchStats(project, onChange, { delay = 400, compress = compressedSize } = {}) {
  /** @type {number | undefined} */
  let compressed
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer

  const get = () => ({ ...quickStats(project.cart), compressed })

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      compressed = compress(project.cart.code)
      onChange(get())
    }, delay)
  }

  const update = () => {
    onChange(get())
    schedule()
  }

  const offs = [project.on('code', update), project.on('load', update)]
  schedule()

  return {
    get,
    dispose() {
      clearTimeout(timer)
      for (const off of offs) off()
    },
  }
}
