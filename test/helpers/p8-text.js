/**
 * Minimal reader for the `.p8` text format, used only to provide ground truth in tests
 * (the real .p8 codec will live in src/formats/p8.js).
 */

/**
 * @param {string} text
 * @returns {Map<string, string[]>} section name (without underscores) -> lines
 */
export function readSections(text) {
  /** @type {Map<string, string[]>} */
  const sections = new Map()
  /** @type {string[] | null} */
  let current = null
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^__(\w+)__$/.exec(line)
    if (m) {
      current = []
      sections.set(m[1], current)
    } else if (current) {
      current.push(line)
    }
  }
  return sections
}

/**
 * The Lua code of a .p8 file. Every line of the section is newline-terminated and the file
 * writer adds ONE extra newline as a separator before the next section header. Joining the
 * section's lines with '\n' therefore yields the code including its own trailing newline
 * (e.g. 'print(1)\n'), which is exactly what a .p8.png stores.
 * @param {string} text
 */
export function readLua(text) {
  return (readSections(text).get('lua') ?? []).join('\n')
}

/**
 * Decode `__gfx__` rows into bytes. Each row is 128 pixels = 128 hex digits = 64 bytes;
 * the left pixel of each pair is the LOW nibble.
 * @param {string[]} lines
 * @returns {Uint8Array} bytes covering the rows present
 */
export function readGfx(lines) {
  const rows = lines.filter((l) => l.length > 0)
  const out = new Uint8Array(rows.length * 64)
  rows.forEach((row, y) => {
    for (let x = 0; x < 64; x++) {
      const lo = parseInt(row[x * 2], 16)
      const hi = parseInt(row[x * 2 + 1], 16)
      out[y * 64 + x] = (hi << 4) | lo
    }
  })
  return out
}

/**
 * Decode rows of plain hex (high nibble first), as used by `__map__` and `__gff__`.
 * @param {string[]} lines
 * @returns {Uint8Array}
 */
export function readHexRows(lines) {
  const hex = lines.filter((l) => l.length > 0).join('')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
