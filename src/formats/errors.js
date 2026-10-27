/** Thrown when input bytes are not a valid instance of a cart format. */
export class FormatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'FormatError'
  }
}

/**
 * Thrown when a cart cannot be exported because it exceeds one of the profile's limits.
 * Running a cart in the editor never throws this; only exporters that enforce limits do.
 */
export class ExportLimitError extends Error {
  /**
   * @param {string} limit   Name of the limit, a key of `profile.limits` (e.g. 'compressedBytes')
   * @param {number} actual
   * @param {number} max
   */
  constructor(limit, actual, max) {
    super(`${limit} limit exceeded: ${actual} > ${max}`)
    this.name = 'ExportLimitError'
    this.limit = limit
    this.actual = actual
    this.max = max
  }
}
