/**
 * A 3x5 pixel font for `print`. Each glyph is five octal digits, one per row, the leftmost pixel in
 * the highest bit (so `7` is a full row of three, `5` is the two outer pixels).
 *
 * Only the ASCII range is covered; lowercase letters use the capital shapes, like the small-caps
 * look of the console's own font.
 */

/** @type {Readonly<Record<string, string>>} */
const GLYPHS = {
  ' ': '00000',
  '!': '22202',
  '"': '55000',
  '#': '57575',
  $: '36236',
  '%': '51245',
  '&': '25253',
  "'": '22000',
  '(': '12221',
  ')': '42224',
  '*': '05250',
  '+': '02720',
  ',': '00024',
  '-': '00700',
  '.': '00002',
  '/': '11244',
  0: '75557',
  1: '26227',
  2: '71747',
  3: '71717',
  4: '55711',
  5: '74717',
  6: '74757',
  7: '71244',
  8: '75757',
  9: '75717',
  ':': '02020',
  ';': '02024',
  '<': '12421',
  '=': '07070',
  '>': '42124',
  '?': '71202',
  '@': '75747',
  A: '25755',
  B: '65656',
  C: '34443',
  D: '65556',
  E: '74647',
  F: '74644',
  G: '34753',
  H: '55755',
  I: '72227',
  J: '11152',
  K: '55655',
  L: '44447',
  M: '57755',
  N: '75555',
  O: '25552',
  P: '65644',
  Q: '25573',
  R: '65655',
  S: '34216',
  T: '72222',
  U: '55557',
  V: '55552',
  W: '55775',
  X: '55255',
  Y: '55222',
  Z: '71247',
  '[': '64446',
  '\\': '44211',
  ']': '31113',
  '^': '25000',
  _: '00007',
  '`': '42000',
  '{': '32623',
  '|': '22222',
  '}': '62326',
  '~': '03600',
}

/** The glyph for characters we have no shape for: a hollow box. */
const UNKNOWN = '77577'

/** Width of the cell one character takes, in pixels. */
export const CHAR_W = 4
/** Height of a line of text, in pixels. */
export const LINE_H = 6

/**
 * The rows of a character's glyph.
 * @param {string} ch  one character of a p8str
 * @returns {number[]} five numbers, 3 bits each
 */
export function glyphRows(ch) {
  const glyph = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? UNKNOWN
  return Array.from(glyph, (digit) => Number(digit))
}

/**
 * Pixel width of a character cell: the button and symbol glyphs (0x80 and up) are twice as wide.
 * @param {string} ch
 */
export const charWidth = (ch) => (ch.charCodeAt(0) >= 0x80 ? CHAR_W * 2 : CHAR_W)

/**
 * Pixel width of a piece of text (no line breaks).
 * @param {string} text
 */
export function textWidth(text) {
  let w = 0
  for (const ch of text) w += charWidth(ch)
  return w
}
