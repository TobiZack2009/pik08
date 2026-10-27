/**
 * Documentation of the PICO-8 globals, entry points, keywords and snippets, for completion, hover
 * and signature help. Names and parameters follow what the runtime really accepts
 * (`lua/stdlib.js`, `player/api.js`); a test keeps the table and the runtime in step.
 *
 * @typedef {Object} ParamDoc
 * @property {string} name        `...` for variable arguments
 * @property {boolean} [optional]
 * @property {string} [doc]
 *
 * @typedef {Object} ApiDoc
 * @property {string} group
 * @property {ParamDoc[]} params
 * @property {string} [returns]
 * @property {string} doc
 *
 * @typedef {Object} Snippet
 * @property {string} label
 * @property {string} template   CodeMirror snippet syntax (`${name}` fields, `${}` for the cursor)
 * @property {string} doc
 */

/** What a parameter name usually means, so each entry doesn't have to repeat it. */
const PARAM_DOCS = /** @type {Record<string, string>} */ ({
  x: 'x position in pixels',
  y: 'y position in pixels',
  x0: 'x of the first point',
  y0: 'y of the first point',
  x1: 'x of the second point',
  y1: 'y of the second point',
  w: 'width',
  h: 'height',
  r: 'radius in pixels',
  col: 'colour index, 0 to 15 (the current colour if left out)',
  n: 'number',
  t: 'a table',
  v: 'a value',
  fn: 'a function',
  s: 'a string',
  addr: 'memory address',
  dest: 'destination address',
  src: 'source address',
  len: 'number of bytes',
  flip_x: 'true to mirror horizontally',
  flip_y: 'true to mirror vertically',
  layer: 'bit mask of the sprite flags a tile must have to be drawn (0 draws all)',
})

/**
 * @param {string} group
 * @param {string} signature  parameter names separated by commas; `[name]` is optional
 * @param {string} doc
 * @param {string} [returns]
 * @returns {ApiDoc}
 */
function fn(group, signature, doc, returns) {
  /** @type {ParamDoc[]} */
  const params = signature
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const optional = p.startsWith('[')
      const name = p.replace(/[[\]]/g, '')
      /** @type {ParamDoc} */
      const param = { name }
      if (optional) param.optional = true
      if (PARAM_DOCS[name]) param.doc = PARAM_DOCS[name]
      return param
    })
  return returns ? { group, params, returns, doc } : { group, params, doc }
}

/** @type {Readonly<Record<string, ApiDoc>>} */
export const API = Object.freeze({
  // ---- graphics ---------------------------------------------------------------------------------
  cls: fn('graphics', '[col]', 'Clears the screen to a colour (0 by default) and moves the cursor to the top left.'),
  pset: fn('graphics', 'x, y, [col]', 'Sets the pixel at (x, y) to a colour.'),
  pget: fn('graphics', 'x, y', 'Returns the colour of the pixel at (x, y).', 'number'),
  line: fn('graphics', 'x0, y0, [x1], [y1], [col]', 'Draws a line. With only the first point it continues from where the last line ended.'),
  rect: fn('graphics', 'x0, y0, x1, y1, [col]', 'Draws the outline of a rectangle between two corners.'),
  rectfill: fn('graphics', 'x0, y0, x1, y1, [col]', 'Draws a filled rectangle between two corners.'),
  circ: fn('graphics', 'x, y, [r], [col]', 'Draws the outline of a circle (radius 4 by default).'),
  circfill: fn('graphics', 'x, y, [r], [col]', 'Draws a filled circle (radius 4 by default).'),
  spr: fn('graphics', 'n, x, y, [w], [h], [flip_x], [flip_y]', 'Draws sprite n with its top left corner at (x, y). w and h are the size in sprites (1 by default).'),
  sspr: fn('graphics', 'sx, sy, sw, sh, dx, dy, [dw], [dh], [flip_x], [flip_y]', 'Draws a rectangle of the sprite sheet (sx, sy, sw, sh, in pixels) at (dx, dy), stretched to dw by dh.'),
  map: fn('graphics', '[cell_x], [cell_y], [sx], [sy], [cell_w], [cell_h], [layer]', 'Draws part of the map: cell_w by cell_h tiles from (cell_x, cell_y), with the top left at screen position (sx, sy).'),
  sget: fn('graphics', 'x, y', 'Returns the colour of a pixel of the sprite sheet.', 'number'),
  sset: fn('graphics', 'x, y, [col]', 'Sets a pixel of the sprite sheet.'),
  mget: fn('graphics', 'x, y', 'Returns the tile number at a map cell.', 'number'),
  mset: fn('graphics', 'x, y, tile', 'Sets the tile number at a map cell.'),
  fget: fn('graphics', 'n, [bit]', 'Returns the flags of sprite n as a number, or with bit (0 to 7) whether that flag is set.', 'number | boolean'),
  fset: fn('graphics', 'n, f, [val]', 'Sets the flags of sprite n to the number f, or with val (true or false) sets only the flag at bit f.'),
  print: fn('graphics', 'str, [x], [y], [col]', 'Prints a value on the screen. Without x and y it prints at the cursor and moves to the next line.', 'number'),
  color: fn('graphics', '[col]', 'Sets the colour that drawing functions use when none is given.'),
  fillp: fn('graphics', '[pattern]', 'Sets the fill pattern: a 4x4 bit mask that makes shapes dither between two colours.', 'number'),
  cursor: fn('graphics', '[x], [y], [col]', 'Sets where print draws next, and optionally the colour.'),
  camera: fn('graphics', '[x], [y]', 'Offsets everything drawn afterwards by (-x, -y). With no arguments it resets.'),
  clip: fn('graphics', '[x], [y], [w], [h]', 'Limits drawing to a rectangle of the screen. With no arguments it resets.'),
  pal: fn('graphics', '[c0], [c1], [p]', 'Draws colour c0 as c1 from now on (p = 0 for drawing, 1 for the screen). With no arguments it resets all.'),
  palt: fn('graphics', '[col], [t]', 'Makes colour col transparent (t = true) or opaque when drawing sprites. With no arguments it resets (only 0 is transparent).'),

  // ---- input ------------------------------------------------------------------------------------
  btn: fn('input', '[i], [p]', 'Whether button i (0 left, 1 right, 2 up, 3 down, 4 O, 5 X) of player p is held. With no arguments it returns a bit mask of all.', 'boolean | number'),
  btnp: fn('input', '[i], [p]', 'Like btn, but true only on the frame the button went down (and then while repeating when held).', 'boolean | number'),

  // ---- sound ------------------------------------------------------------------------------------
  sfx: fn('sound', 'n, [channel], [offset], [length]', 'Plays sound effect n (-1 stops, -2 stops looping) on a channel (-1 picks a free one, -2 stops it).'),
  music: fn('sound', 'n, [fade], [mask]', 'Plays music from pattern n (-1 stops). fade is a fade-in in milliseconds, mask picks the channels.'),

  // ---- math -------------------------------------------------------------------------------------
  flr: fn('math', 'x', 'Rounds down to the nearest integer.', 'number'),
  ceil: fn('math', 'x', 'Rounds up to the nearest integer.', 'number'),
  abs: fn('math', 'x', 'Absolute value.', 'number'),
  sgn: fn('math', 'x', 'The sign of x: -1 for negative numbers, 1 for zero and positive ones.', 'number'),
  sqrt: fn('math', 'x', 'Square root.', 'number'),
  max: fn('math', 'a, b', 'The larger of two numbers.', 'number'),
  min: fn('math', 'a, b', 'The smaller of two numbers.', 'number'),
  mid: fn('math', 'a, b, c', 'The middle value of three numbers. mid(lo, x, hi) limits x to a range.', 'number'),
  sin: fn('math', 'x', 'Sine of x, where 1.0 is a full turn. Note that it is upside down: sin(0.25) is -1.', 'number'),
  cos: fn('math', 'x', 'Cosine of x, where 1.0 is a full turn.', 'number'),
  atan2: fn('math', 'dx, dy', 'The angle of the vector (dx, dy) as a fraction of a turn. dy is upside down as for sin.', 'number'),
  rnd: fn('math', '[x]', 'A random number from 0 up to but not including x (1 by default). Given a table it returns a random element.', 'number'),
  srand: fn('math', 'seed', 'Seeds the random number generator.'),
  band: fn('math', 'a, b', 'Bitwise and.', 'number'),
  bor: fn('math', 'a, b', 'Bitwise or.', 'number'),
  bxor: fn('math', 'a, b', 'Bitwise exclusive or.', 'number'),
  bnot: fn('math', 'a', 'Bitwise not.', 'number'),
  shl: fn('math', 'a, n', 'Shifts a left by n bits.', 'number'),
  shr: fn('math', 'a, n', 'Shifts a right by n bits, keeping the sign.', 'number'),
  lshr: fn('math', 'a, n', 'Shifts a right by n bits, filling with zeros.', 'number'),
  rotl: fn('math', 'a, n', 'Rotates a left by n bits.', 'number'),
  rotr: fn('math', 'a, n', 'Rotates a right by n bits.', 'number'),

  // ---- tables -----------------------------------------------------------------------------------
  add: fn('table', 't, v, [i]', 'Adds v to the end of table t (or at index i, moving the rest up).', 'any'),
  del: fn('table', 't, v', 'Removes the first element of t equal to v, moving the rest down.', 'any'),
  deli: fn('table', 't, [i]', 'Removes the element at index i (the last by default) and returns it.', 'any'),
  count: fn('table', 't, [v]', 'The number of elements of t, or how many are equal to v.', 'number'),
  all: fn('table', 't', 'An iterator over the elements of t, for use in "for v in all(t)".', 'function'),
  foreach: fn('table', 't, fn', 'Calls fn(v) for each element of t.'),
  pairs: fn('table', 't', 'An iterator over all keys and values of t, for "for k, v in pairs(t)".', 'function'),
  ipairs: fn('table', 't', 'An iterator over the indices and values 1, 2, ... of t, up to the first gap.', 'function'),
  next: fn('table', 't, [k]', 'The key and value after key k in t (the first when k is nil).', 'any, any'),
  inext: fn('table', 't, i', 'The index and value after index i of t. The step function of ipairs.', 'number, any'),
  pack: fn('table', '...', 'A table of the arguments, with their count in the field n.', 'table'),
  unpack: fn('table', 't, [i], [j]', 'The elements i to j of t as separate values.', '...'),
  select: fn('table', 'n, ...', 'The arguments from number n on; with "#" their count.', '...'),
  setmetatable: fn('table', 't, m', 'Sets the metatable of t (operators and indexing fall back to it) and returns t.', 'table'),
  getmetatable: fn('table', 't', 'The metatable of t, or nil.', 'table'),
  rawget: fn('table', 't, k', 'Reads t[k] without using the metatable.', 'any'),
  rawset: fn('table', 't, k, v', 'Writes t[k] without using the metatable.'),
  rawequal: fn('table', 'a, b', 'Whether a and b are the same value, without using the metatable.', 'boolean'),
  rawlen: fn('table', 'v', 'The length of a table or string, without using the metatable.', 'number'),

  // ---- strings and conversion -------------------------------------------------------------------
  type: fn('string', 'v', 'The type of v as a string: "nil", "number", "string", "boolean", "table" or "function".', 'string'),
  assert: fn('string', 'cond, [msg]', 'Stops the cart with an error message when cond is false or nil.'),
  tostr: fn('string', 'v, [flags]', 'Converts v to a string. flags 1 gives hexadecimal for numbers.', 'string'),
  tostring: fn('string', 'v', 'Converts v to a string.', 'string'),
  tonum: fn('string', 'v, [flags]', 'Converts a string to a number (nil if it is not one). Numbers are returned as they are.', 'number'),
  sub: fn('string', 's, i, [j]', 'The part of string s from character i to j (to the end by default). Negative positions count from the end.', 'string'),
  ord: fn('string', 's, [i], [count]', 'The character code at position i of s (1 by default).', 'number'),
  chr: fn('string', '...', 'A string made of the characters with the given codes.', 'string'),
  split: fn('string', 's, [sep], [convert]', 'Splits s at each sep (a comma by default) into a table; with convert numbers become numbers.', 'table'),
  printh: fn('string', 'str', 'Prints a string to the console of the host (not on the screen).'),
  time: fn('system', '', 'Seconds since the cart started.', 'number'),
  t: fn('system', '', 'Same as time().', 'number'),

  // ---- coroutines -------------------------------------------------------------------------------
  cocreate: fn('coroutine', 'fn', 'Makes a coroutine that runs fn.', 'coroutine'),
  coresume: fn('coroutine', 'co, ...', 'Runs the coroutine until it yields or ends; the extra arguments are passed in. Returns true and the yielded values, or false and an error.', 'boolean, ...'),
  costatus: fn('coroutine', 'co', 'The state of a coroutine: "suspended", "running" or "dead".', 'string'),
  yield: fn('coroutine', '...', 'Pauses the running coroutine, giving values back to coresume.', '...'),
  flip: fn('system', '', 'Shows the screen now and waits for the next frame, so a long loop can animate.'),

  // ---- memory -----------------------------------------------------------------------------------
  peek: fn('memory', 'addr, [n]', 'Reads the byte at addr (n bytes as separate values).', 'number'),
  peek2: fn('memory', 'addr', 'Reads a 16 bit number at addr.', 'number'),
  peek4: fn('memory', 'addr', 'Reads a 32 bit number at addr.', 'number'),
  poke: fn('memory', 'addr, ...', 'Writes bytes starting at addr.'),
  poke2: fn('memory', 'addr, val', 'Writes a 16 bit number at addr.'),
  poke4: fn('memory', 'addr, val', 'Writes a 32 bit number at addr.'),
  memcpy: fn('memory', 'dest, src, len', 'Copies len bytes from src to dest.'),
  memset: fn('memory', 'dest, val, len', 'Sets len bytes from dest to val.'),
  reload: fn('memory', '[dest], [src], [len]', 'Copies data from the cart back into memory (all of it by default).'),
  cstore: fn('memory', '[dest], [src], [len]', 'Copies memory into the cart data.'),

  // ---- system -----------------------------------------------------------------------------------
  stat: fn('system', 'n', 'System information: 1 CPU use, 7 frames per second, 30/31 keyboard, 32/33/34 mouse, 80 to 85 date and time, and more.', 'number'),
  cartdata: fn('system', 'id', 'Opens the saved numbers of this cart under a unique id. Call it once before dget and dset.', 'boolean'),
  dget: fn('system', 'i', 'Reads saved number i (0 to 63).', 'number'),
  dset: fn('system', 'i, v', 'Writes saved number i (0 to 63).'),
  menuitem: fn('system', 'index, [label], [callback]', 'Sets (or, without a label, removes) item 1 to 5 of the pause menu. The callback runs when it is chosen.'),
  extcmd: fn('system', 'command', 'Asks the host to do something: "pause", "reset", "screen", "rec" and so on.'),

  // ---- values -----------------------------------------------------------------------------------
  _G: { group: 'system', params: [], doc: 'The table of all global variables.' },
  _ENV: { group: 'system', params: [], doc: 'The table of all global variables.' },
})

/** The functions the cart may define for PICO-8 to call. */
export const ENTRY_POINTS = Object.freeze(
  /** @type {Record<string, ApiDoc>} */ ({
    _init: { group: 'entry', params: [], doc: 'Called once when the cart starts.' },
    _update: { group: 'entry', params: [], doc: 'Called 30 times a second. Update the state of the game here.' },
    _update60: { group: 'entry', params: [], doc: 'Called 60 times a second (instead of _update, and makes _draw run at 60 too).' },
    _draw: { group: 'entry', params: [], doc: 'Called after each update (or less often when the cart is too slow). Draw the screen here.' },
  }),
)

/** Reserved words, as listed by the lexer. */
export const KEYWORDS = Object.freeze(
  'and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' '),
)

/** Short descriptions of keywords, for hover. */
export const KEYWORD_DOCS = Object.freeze(
  /** @type {Record<string, string>} */ ({
    local: 'Declares variables that exist only in the enclosing block.',
    function: 'Starts a function definition.',
    nil: 'The empty value; an unset variable is nil.',
    for: 'Loops: "for i = 1, 10 do" counts, "for v in all(t) do" goes through a table.',
    goto: 'Jumps to a label written ::name::.',
    break: 'Leaves the innermost loop.',
    return: 'Leaves the function, giving back values.',
  }),
)

/** @type {readonly Snippet[]} */
export const SNIPPETS = Object.freeze([
  { label: '_init', template: 'function _init()\n\t${}\nend', doc: 'Called once when the cart starts.' },
  { label: '_update', template: 'function _update()\n\t${}\nend', doc: 'Called 30 times a second.' },
  { label: '_update60', template: 'function _update60()\n\t${}\nend', doc: 'Called 60 times a second.' },
  { label: '_draw', template: 'function _draw()\n\t${}\nend', doc: 'Called after each update.' },
  { label: 'function', template: 'function ${name}(${})\n\t\nend', doc: 'A function definition.' },
  { label: 'for', template: 'for ${i}=${1},${10} do\n\t${}\nend', doc: 'A counting loop.' },
  { label: 'foreach', template: 'foreach(${t}, function(${v})\n\t${}\nend)', doc: 'Calls a function for each element of a table.' },
  { label: 'if', template: 'if ${cond} then\n\t${}\nend', doc: 'A conditional.' },
  { label: 'while', template: 'while ${cond} do\n\t${}\nend', doc: 'A loop that runs while the condition holds.' },
])

/**
 * The signature of an API function or user function as text, e.g. `circfill(x, y, [r], [col])`.
 * @param {string} name
 * @param {readonly ParamDoc[]} params
 */
export function formatSignature(name, params) {
  return `${name}(${params.map((p) => (p.optional ? `[${p.name}]` : p.name)).join(', ')})`
}
