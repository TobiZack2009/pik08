/**
 * The command line of the optional drawer: `load`, `save`, `export`, `run`, `stats`, `new`, `help`.
 * Parsing and dispatch are here; what the commands do comes in through a `CliContext`, so this
 * module has no DOM and is easy to test.
 */

/**
 * @typedef {Object} CliContext
 * @property {(name?: string) => Promise<string>} save     Save as .p8 (asking where, unless a name is given); returns a message
 * @property {() => Promise<string>} load                  Opens the file dialog; returns a message
 * @property {(format: 'png' | 'p8', name?: string) => Promise<string>} exportCart
 * @property {() => string} run
 * @property {() => string | Promise<string>} newCart
 * @property {() => string[] | Promise<string[]>} stats
 */

/**
 * @typedef {Object} CommandResult
 * @property {boolean} ok
 * @property {string[]} lines   Output, one entry per line
 */

/**
 * Splits a command line into words. Words may be quoted with `'` or `"`; a backslash escapes the
 * next character. Returns null for a blank line.
 * @param {string} line
 * @returns {{ name: string, args: string[] } | null}
 * @throws {Error} on an unterminated quote
 */
export function parseCommandLine(line) {
  /** @type {string[]} */
  const words = []
  let word = ''
  let inWord = false
  let quote = ''
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '\\' && i + 1 < line.length) {
      word += line[++i]
      inWord = true
    } else if (quote) {
      if (c === quote) quote = ''
      else word += c
    } else if (c === '"' || c === "'") {
      quote = c
      inWord = true
    } else if (/\s/.test(c)) {
      if (inWord) {
        words.push(word)
        word = ''
        inWord = false
      }
    } else {
      word += c
      inWord = true
    }
  }
  if (quote) throw new Error(`unterminated ${quote} quote`)
  if (inWord) words.push(word)
  if (!words.length) return null
  return { name: words[0].toLowerCase(), args: words.slice(1) }
}

/**
 * @typedef {Object} CommandSpec
 * @property {string} usage
 * @property {string} summary
 * @property {(args: string[], ctx: CliContext) => Promise<string[]> | string[]} run   Throws `Error` for bad usage
 */

/** @type {Record<string, CommandSpec>} */
export const COMMANDS = {
  load: {
    usage: 'load',
    summary: 'open a .p8 or .p8.png cart',
    run: async (args, ctx) => {
      noArgs('load', args)
      return [await ctx.load()]
    },
  },
  save: {
    usage: 'save [name]',
    summary: 'save the cart as .p8',
    run: async (args, ctx) => {
      if (args.length > 1) throw new Error('usage: save [name]')
      return [await ctx.save(args[0])]
    },
  },
  export: {
    usage: 'export [png|p8] [name]',
    summary: 'export as .p8.png (blocked when over a limit) or .p8',
    run: async (args, ctx) => {
      const [format = 'png', name] = args
      if (args.length > 2 || (format !== 'png' && format !== 'p8')) throw new Error('usage: export [png|p8] [name]')
      return [await ctx.exportCart(format, name)]
    },
  },
  run: {
    usage: 'run',
    summary: 'run the cart in a new tab',
    run: (args, ctx) => {
      noArgs('run', args)
      return [ctx.run()]
    },
  },
  stats: {
    usage: 'stats',
    summary: 'tokens, characters and compressed size of the code',
    run: (args, ctx) => {
      noArgs('stats', args)
      return ctx.stats()
    },
  },
  new: {
    usage: 'new',
    summary: 'start an empty cart',
    run: async (args, ctx) => {
      noArgs('new', args)
      return [await ctx.newCart()]
    },
  },
  help: {
    usage: 'help [command]',
    summary: 'list commands',
    run: (args) => {
      if (args.length > 1) throw new Error('usage: help [command]')
      if (args[0]) {
        const spec = COMMANDS[args[0].toLowerCase()]
        if (!spec) throw new Error(`no such command: ${args[0]}`)
        return [`${spec.usage}  -  ${spec.summary}`]
      }
      const width = Math.max(...Object.values(COMMANDS).map((c) => c.usage.length))
      return Object.values(COMMANDS).map((c) => `${c.usage.padEnd(width)}  ${c.summary}`)
    },
  },
}

/**
 * @param {string} name
 * @param {string[]} args
 */
function noArgs(name, args) {
  if (args.length) throw new Error(`usage: ${name}`)
}

/**
 * Runs one command line.
 * @param {string} line
 * @param {CliContext} ctx
 * @returns {Promise<CommandResult>}
 */
export async function executeCommand(line, ctx) {
  try {
    const parsed = parseCommandLine(line)
    if (!parsed) return { ok: true, lines: [] }
    if (!Object.hasOwn(COMMANDS, parsed.name)) {
      return { ok: false, lines: [`unknown command: ${parsed.name} (try help)`] }
    }
    return { ok: true, lines: await COMMANDS[parsed.name].run(parsed.args, ctx) }
  } catch (e) {
    return { ok: false, lines: [e instanceof Error ? e.message : String(e)] }
  }
}
