import { LuaSyntaxError } from './errors.js'
import { tokenize } from './lexer.js'

/**
 * Recursive-descent parser for PICO-8's Lua dialect. See ast.js for the shape of the result.
 *
 * What differs from standard Lua 5.x:
 *  - shorthand `if (cond) stmts [else stmts]` and `while (cond) stmts`: no `then`/`do`/`end`; the
 *    body runs to the end of the line (more precisely, until a token on a later "virtual line");
 *  - `?a, b` at the start of a statement means `print(a, b)`;
 *  - `a op= b` for every binary operator that has a compound form (xor is `^^=`; `~=` is always not-equal);
 *  - extra operators `\` `^^` `>>>` `<<>` `>><` `!=`, unary `@` `%` `$` (peek, peek2, peek4);
 *  - Lua 5.3's operator precedence, with `^` binding tighter than unary operators;
 *  - `return` has no values when the next token is on a later line, but only inside a shorthand
 *    statement. A `return` is not required to be the last statement of a block.
 *
 * @import { Expr, Stat, LocalVar, Chunk, BinaryOp, CompoundOp, FunctionExpr, TableItem } from './ast.js'
 * @import { Token } from './lexer.js'
 */

/** @type {Record<string, { prec: number, right: boolean, op: BinaryOp }>} */
const BINARY = {
  or: { prec: 1, right: false, op: 'or' },
  and: { prec: 2, right: false, op: 'and' },
  '==': { prec: 3, right: false, op: '==' },
  '~=': { prec: 3, right: false, op: '~=' },
  '!=': { prec: 3, right: false, op: '~=' },
  '<': { prec: 3, right: false, op: '<' },
  '<=': { prec: 3, right: false, op: '<=' },
  '>': { prec: 3, right: false, op: '>' },
  '>=': { prec: 3, right: false, op: '>=' },
  '|': { prec: 4, right: false, op: '|' },
  '^^': { prec: 5, right: false, op: '^^' },
  '~': { prec: 5, right: false, op: '^^' },
  '&': { prec: 6, right: false, op: '&' },
  '<<': { prec: 7, right: false, op: '<<' },
  '>>': { prec: 7, right: false, op: '>>' },
  '>>>': { prec: 7, right: false, op: '>>>' },
  '<<>': { prec: 7, right: false, op: '<<>' },
  '>><': { prec: 7, right: false, op: '>><' },
  '..': { prec: 8, right: true, op: '..' },
  '+': { prec: 9, right: false, op: '+' },
  '-': { prec: 9, right: false, op: '-' },
  '*': { prec: 10, right: false, op: '*' },
  '/': { prec: 10, right: false, op: '/' },
  '\\': { prec: 10, right: false, op: '\\' },
  '%': { prec: 10, right: false, op: '%' },
  '^': { prec: 12, right: true, op: '^' },
}
const UNARY_PREC = 11

/** Compound assignment token -> the binary operator it applies. */
const COMPOUND = /** @type {Record<string, CompoundOp>} */ ({
  '+=': '+', '-=': '-', '*=': '*', '/=': '/', '\\=': '\\', '%=': '%', '..=': '..', '^=': '^',
  '|=': '|', '&=': '&', '^^=': '^^', '<<=': '<<', '>>=': '>>', '>>>=': '>>>', '<<>=': '<<>', '>><=': '>><',
})

const UNARY_PUNCT = new Set(['-', '~', '#', '@', '%', '$'])

/**
 * @typedef {Object} Scope
 * @property {Map<string, LocalVar>} vars
 * @property {Map<string, number>} labels   name -> line
 *
 * @typedef {Object} FuncState
 * @property {FuncState | null} parent
 * @property {number} depth
 * @property {boolean} isVararg
 * @property {Scope[]} scopes
 * @property {number} loops          Enclosing loops (for `break`)
 * @property {{ label: string, token: Token, scopes: Scope[] }[]} gotos
 */

/**
 * Parses a whole program.
 * @param {string} src   A p8str
 * @returns {Chunk}
 * @throws {LuaSyntaxError}
 */
export function parse(src) {
  const tokens = tokenize(src)
  let p = 0
  let nextId = 0
  /** @type {FuncState} */
  let fs = newFuncState(null, true)

  const body = parseBlock()
  if (tokens[p].type !== 'eof') fail(`'<eof>' expected`)
  closeFunction()
  return { type: 'Chunk', body, localCount: nextId }

  // ---- helpers ----

  /**
   * @param {FuncState | null} parent
   * @param {boolean} isVararg
   * @returns {FuncState}
   */
  function newFuncState(parent, isVararg) {
    return {
      parent,
      depth: parent ? parent.depth + 1 : 0,
      isVararg,
      scopes: [{ vars: new Map(), labels: new Map() }],
      loops: 0,
      gotos: [],
    }
  }

  /** @param {Token} t */
  function near(t) {
    return t.type === 'eof' ? '<eof>' : `'${src.slice(t.pos, t.end)}'`
  }

  /**
   * @param {string} message
   * @param {Token} [t]
   * @returns {never}
   */
  function fail(message, t = tokens[p]) {
    throw new LuaSyntaxError(`${message} near ${near(t)}`, t.line, t.col)
  }

  /** @param {string} v */
  function is(v) {
    const t = tokens[p]
    return t.value === v && (t.type === 'punct' || t.type === 'keyword')
  }

  /** @param {string} v */
  function accept(v) {
    if (!is(v)) return false
    p++
    return true
  }

  /** @param {string} v */
  function expect(v) {
    if (!accept(v)) fail(`'${v}' expected`)
  }

  /**
   * Expects the token that closes a construct opened by `what` at `line`.
   * @param {string} v @param {string} what @param {number} line
   */
  function expectClose(v, what, line) {
    if (accept(v)) return
    if (line === tokens[p].line) fail(`'${v}' expected`)
    fail(`'${v}' expected (to close '${what}' at line ${line})`)
  }

  function expectName() {
    const t = tokens[p]
    if (t.type !== 'name') fail('<name> expected')
    p++
    return /** @type {string} */ (t.value)
  }

  // ---- scopes ----

  function openScope() {
    fs.scopes.push({ vars: new Map(), labels: new Map() })
  }
  function closeScope() {
    fs.scopes.pop()
  }

  /** @param {string} name */
  function declare(name) {
    /** @type {LocalVar} */
    const v = { name, id: nextId++, depth: fs.depth, assigned: false, captured: false }
    fs.scopes[fs.scopes.length - 1].vars.set(name, v)
    return v
  }

  /** @param {string} name @returns {LocalVar | null} */
  function resolve(name) {
    for (let f = /** @type {FuncState | null} */ (fs); f; f = f.parent) {
      for (let i = f.scopes.length - 1; i >= 0; i--) {
        const v = f.scopes[i].vars.get(name)
        if (v) {
          if (f !== fs) v.captured = true
          return v
        }
      }
    }
    return null
  }

  function closeFunction() {
    for (const g of fs.gotos) {
      if (!g.scopes.some((s) => s.labels.has(g.label))) {
        throw new LuaSyntaxError(`no visible label '${g.label}' for goto`, g.token.line, g.token.col)
      }
    }
  }

  // ---- blocks and statements ----

  /**
   * Parses statements until the end of the block. With `vline` it is a shorthand body, which also
   * ends at the first token on a later virtual line.
   * @param {number} [vline]
   * @returns {Stat[]}
   */
  function parseBlock(vline) {
    /** @type {Stat[]} */
    const stats = []
    for (;;) {
      const t = tokens[p]
      if (t.type === 'eof') break
      if (vline !== undefined && t.vline > vline) break
      if (t.type === 'keyword' && (t.value === 'end' || t.value === 'else' || t.value === 'elseif' || t.value === 'until')) break
      const s = parseStat(vline)
      if (s) stats.push(s)
    }
    return stats
  }

  /** Parses a block in its own scope. @param {number} [vline] */
  function parseScopedBlock(vline) {
    openScope()
    const b = parseBlock(vline)
    closeScope()
    return b
  }

  /** @param {number} [vline] @returns {Stat | null} */
  function parseStat(vline) {
    const t = tokens[p]
    const pos = { line: t.line, col: t.col }
    if (t.type === 'punct') {
      if (t.value === ';') {
        p++
        return null
      }
      if (t.value === '::') {
        p++
        const name = expectName()
        expect('::')
        const labels = fs.scopes[fs.scopes.length - 1].labels
        if (labels.has(name)) {
          throw new LuaSyntaxError(`label '${name}' already defined on line ${labels.get(name)}`, t.line, t.col)
        }
        labels.set(name, t.line)
        return { type: 'Label', name, ...pos }
      }
      if (t.value === '?') {
        p++
        const args = parseExprList()
        return {
          type: 'CallStat',
          call: { type: 'Call', fn: { type: 'Global', name: 'print', ...pos }, args, ...pos },
          ...pos,
        }
      }
    } else if (t.type === 'keyword') {
      switch (t.value) {
        case 'if':
          return parseIf()
        case 'while':
          return parseWhile()
        case 'do': {
          p++
          const b = parseScopedBlock()
          expectClose('end', 'do', t.line)
          return { type: 'Do', body: b, ...pos }
        }
        case 'for':
          return parseFor()
        case 'repeat': {
          p++
          openScope()
          fs.loops++
          const b = parseBlock()
          fs.loops--
          expectClose('until', 'repeat', t.line)
          const cond = parseExpr()
          closeScope()
          return { type: 'Repeat', body: b, cond, ...pos }
        }
        case 'function':
          return parseFunctionStat()
        case 'local':
          p++
          if (accept('function')) {
            const name = expectName()
            const v = declare(name)
            const func = parseFuncBody(name, t.line, false)
            return { type: 'LocalFunction', var: v, func, ...pos }
          }
          return parseLocal(pos)
        case 'return': {
          p++
          const n = tokens[p]
          const ends =
            n.type === 'eof' ||
            (n.type === 'keyword' && (n.value === 'end' || n.value === 'else' || n.value === 'elseif' || n.value === 'until')) ||
            (n.type === 'punct' && n.value === ';') ||
            (vline !== undefined && n.vline > vline)
          return { type: 'Return', values: ends ? [] : parseExprList(), ...pos }
        }
        case 'break':
          if (fs.loops === 0) fail('no loop to break', t)
          p++
          return { type: 'Break', ...pos }
        case 'goto': {
          p++
          const label = expectName()
          fs.gotos.push({ label, token: t, scopes: fs.scopes.slice() })
          return { type: 'Goto', label, ...pos }
        }
      }
    }
    return parseExprStat(pos)
  }

  /** @param {{ line: number, col: number }} pos @returns {Stat} */
  function parseExprStat(pos) {
    const first = parseSuffixed()
    const t = tokens[p]
    if (t.type === 'punct' && (t.value === '=' || t.value === ',')) {
      const targets = [first]
      while (accept(',')) targets.push(parseSuffixed())
      expect('=')
      const values = parseExprList()
      for (const target of targets) markAssigned(target)
      return {
        type: 'Assign',
        targets: /** @type {import('./ast.js').AssignStat['targets']} */ (targets),
        values,
        ...pos,
      }
    }
    if (t.type === 'punct' && Object.hasOwn(COMPOUND, t.value)) {
      markAssigned(first)
      p++
      const value = parseExpr()
      return {
        type: 'OpAssign',
        op: COMPOUND[/** @type {string} */ (t.value)],
        target: /** @type {import('./ast.js').OpAssignStat['target']} */ (first),
        value,
        ...pos,
      }
    }
    if (first.type === 'Call' || first.type === 'MethodCall') return { type: 'CallStat', call: first, ...pos }
    return fail('syntax error')
  }

  /**
   * Checks that `target` can be assigned to and records the assignment.
   * @param {Expr} target
   */
  function markAssigned(target) {
    if (target.type === 'Local') target.var.assigned = true
    else if (target.type !== 'Global' && target.type !== 'Index') {
      throw new LuaSyntaxError(`syntax error: cannot assign to this expression`, target.line, target.col)
    }
  }

  /** @param {{ line: number, col: number }} pos @returns {Stat} */
  function parseLocal(pos) {
    const names = [expectName()]
    while (accept(',')) names.push(expectName())
    const values = accept('=') ? parseExprList() : []
    // the new locals come into scope after the right-hand side
    const vars = names.map(declare)
    return { type: 'LocalDecl', vars, values, ...pos }
  }

  /** @returns {Stat} */
  function parseIf() {
    const start = tokens[p]
    const pos = { line: start.line, col: start.col }
    p++
    const cond = parseExpr()
    if (accept('then') || accept('do')) {
      /** @type {{ cond: Expr, body: Stat[] }[]} */
      const clauses = [{ cond, body: parseScopedBlock() }]
      /** @type {Stat[] | null} */
      let orelse = null
      for (;;) {
        if (accept('elseif')) {
          const c = parseExpr()
          expect('then')
          clauses.push({ cond: c, body: parseScopedBlock() })
        } else if (accept('else')) {
          orelse = parseScopedBlock()
          expectClose('end', 'if', start.line)
          break
        } else {
          expectClose('end', 'if', start.line)
          break
        }
      }
      return { type: 'If', clauses, orelse, ...pos }
    }
    if (!is_prev(')')) fail(`'then' expected`)
    const vline = tokens[p - 1].vline
    const body = parseScopedBlock(vline)
    /** @type {Stat[] | null} */
    let orelse = null
    if (tokens[p].vline === vline && accept('else')) orelse = parseScopedBlock(vline)
    return { type: 'If', clauses: [{ cond, body }], orelse, ...pos }
  }

  /** Whether the previous token is the punctuation `v`. @param {string} v */
  function is_prev(v) {
    const t = tokens[p - 1]
    return t.type === 'punct' && t.value === v
  }

  /** @returns {Stat} */
  function parseWhile() {
    const start = tokens[p]
    const pos = { line: start.line, col: start.col }
    p++
    const cond = parseExpr()
    fs.loops++
    try {
      if (accept('do')) {
        const body = parseScopedBlock()
        expectClose('end', 'while', start.line)
        return { type: 'While', cond, body, ...pos }
      }
      if (!is_prev(')')) fail(`'do' expected`)
      const body = parseScopedBlock(tokens[p - 1].vline)
      return { type: 'While', cond, body, ...pos }
    } finally {
      fs.loops--
    }
  }

  /** @returns {Stat} */
  function parseFor() {
    const start = tokens[p]
    const pos = { line: start.line, col: start.col }
    p++
    const first = expectName()
    if (accept('=')) {
      const startExpr = parseExpr()
      expect(',')
      const limit = parseExpr()
      const step = accept(',') ? parseExpr() : null
      expect('do')
      openScope()
      const v = declare(first)
      fs.loops++
      const body = parseScopedBlock()
      fs.loops--
      closeScope()
      expectClose('end', 'for', start.line)
      return { type: 'NumericFor', var: v, start: startExpr, limit, step, body, ...pos }
    }
    const names = [first]
    while (accept(',')) names.push(expectName())
    expect('in')
    const exprs = parseExprList()
    expect('do')
    openScope()
    const vars = names.map(declare)
    fs.loops++
    const body = parseScopedBlock()
    fs.loops--
    closeScope()
    expectClose('end', 'for', start.line)
    return { type: 'GenericFor', vars, exprs, body, ...pos }
  }

  /** `function a.b.c:m(...) ... end` @returns {Stat} */
  function parseFunctionStat() {
    const start = tokens[p]
    const pos = { line: start.line, col: start.col }
    p++
    const nameTok = tokens[p]
    let fullName = expectName()
    const v = resolve(/** @type {string} */ (nameTok.value))
    const npos = { line: nameTok.line, col: nameTok.col }
    /** @type {Expr} */
    let target = v ? { type: 'Local', var: v, ...npos } : { type: 'Global', name: fullName, ...npos }
    let isMethod = false
    while (is('.') || is(':')) {
      isMethod = tokens[p].value === ':'
      p++
      const keyTok = tokens[p]
      const key = expectName()
      fullName += (isMethod ? ':' : '.') + key
      target = {
        type: 'Index',
        object: target,
        key: { type: 'String', value: key, line: keyTok.line, col: keyTok.col },
        line: keyTok.line,
        col: keyTok.col,
      }
      if (isMethod) break
    }
    const func = parseFuncBody(fullName, start.line, isMethod)
    markAssigned(target)
    return { type: 'Assign', targets: [/** @type {import('./ast.js').AssignStat['targets'][number]} */ (target)], values: [func], ...pos }
  }

  // ---- expressions ----

  /** @returns {Expr[]} */
  function parseExprList() {
    const list = [parseExpr()]
    while (accept(',')) list.push(parseExpr())
    return list
  }

  /**
   * Operator precedence climbing; accepts operators binding tighter than `limit`
   * (or equally tight if right associative).
   * @param {number} [limit]
   * @returns {Expr}
   */
  function parseExpr(limit = 0) {
    const t = tokens[p]
    /** @type {Expr} */
    let left
    if ((t.type === 'punct' && UNARY_PUNCT.has(/** @type {string} */ (t.value))) || (t.type === 'keyword' && t.value === 'not')) {
      p++
      const arg = parseExpr(UNARY_PREC)
      left = { type: 'Unary', op: /** @type {import('./ast.js').UnaryOp} */ (t.value), arg, line: t.line, col: t.col }
    } else {
      left = parseSimple()
    }
    for (;;) {
      const o = tokens[p]
      if (o.type !== 'punct' && o.type !== 'keyword') break
      const info = Object.hasOwn(BINARY, /** @type {string} */ (o.value)) ? BINARY[/** @type {string} */ (o.value)] : undefined
      if (!info) break
      if (info.right ? limit > info.prec : limit >= info.prec) break
      p++
      const right = parseExpr(info.prec)
      left = { type: 'Binary', op: info.op, left, right, line: o.line, col: o.col }
    }
    return left
  }

  /** @returns {Expr} */
  function parseSimple() {
    const t = tokens[p]
    const pos = { line: t.line, col: t.col }
    switch (t.type) {
      case 'number':
        p++
        return { type: 'Number', value: /** @type {number} */ (t.value), ...pos }
      case 'string':
        p++
        return { type: 'String', value: /** @type {string} */ (t.value), ...pos }
      case 'keyword':
        switch (t.value) {
          case 'nil':
            p++
            return { type: 'Nil', ...pos }
          case 'true':
            p++
            return { type: 'True', ...pos }
          case 'false':
            p++
            return { type: 'False', ...pos }
          case 'function':
            p++
            return parseFuncBody('anonymous', t.line, false)
        }
        break
      case 'punct':
        if (t.value === '...') {
          if (!fs.isVararg) fail(`cannot use '...' outside a vararg function`)
          p++
          return { type: 'Vararg', ...pos }
        }
        if (t.value === '{') return parseTable()
        break
    }
    return parseSuffixed()
  }

  /** A name or parenthesised expression followed by any number of `.k` `[k]` `:m()` `(args)` `"str"` `{}`. @returns {Expr} */
  function parseSuffixed() {
    const t = tokens[p]
    /** @type {Expr} */
    let e
    if (t.type === 'name') {
      p++
      const name = /** @type {string} */ (t.value)
      const v = resolve(name)
      e = v ? { type: 'Local', var: v, line: t.line, col: t.col } : { type: 'Global', name, line: t.line, col: t.col }
    } else if (t.type === 'punct' && t.value === '(') {
      p++
      const inner = parseExpr()
      expectClose(')', '(', t.line)
      e = { type: 'Paren', expr: inner, line: t.line, col: t.col }
    } else {
      return fail('unexpected symbol')
    }
    for (;;) {
      const s = tokens[p]
      const pos = { line: s.line, col: s.col }
      if (s.type === 'punct') {
        if (s.value === '.') {
          p++
          const k = tokens[p]
          const key = expectName()
          e = { type: 'Index', object: e, key: { type: 'String', value: key, line: k.line, col: k.col }, ...pos }
          continue
        }
        if (s.value === '[') {
          p++
          const key = parseExpr()
          expect(']')
          e = { type: 'Index', object: e, key, ...pos }
          continue
        }
        if (s.value === ':') {
          p++
          const name = expectName()
          e = { type: 'MethodCall', object: e, name, args: parseCallArgs(), ...pos }
          continue
        }
        if (s.value === '(' || s.value === '{') {
          e = { type: 'Call', fn: e, args: parseCallArgs(), ...pos }
          continue
        }
      } else if (s.type === 'string') {
        e = { type: 'Call', fn: e, args: parseCallArgs(), ...pos }
        continue
      }
      return e
    }
  }

  /** @returns {Expr[]} */
  function parseCallArgs() {
    const t = tokens[p]
    if (t.type === 'string') {
      p++
      return [{ type: 'String', value: /** @type {string} */ (t.value), line: t.line, col: t.col }]
    }
    if (t.type === 'punct' && t.value === '{') return [parseTable()]
    if (t.type === 'punct' && t.value === '(') {
      p++
      if (accept(')')) return []
      const args = parseExprList()
      expectClose(')', '(', t.line)
      return args
    }
    return fail('function arguments expected')
  }

  /** @returns {Expr} */
  function parseTable() {
    const open = tokens[p]
    p++
    /** @type {TableItem[]} */
    const items = []
    while (!is('}')) {
      const t = tokens[p]
      if (t.type === 'punct' && t.value === '[') {
        p++
        const key = parseExpr()
        expect(']')
        expect('=')
        items.push({ key, value: parseExpr() })
      } else if (t.type === 'name' && tokens[p + 1].type === 'punct' && tokens[p + 1].value === '=') {
        p += 2
        items.push({ key: { type: 'String', value: /** @type {string} */ (t.value), line: t.line, col: t.col }, value: parseExpr() })
      } else {
        items.push({ key: null, value: parseExpr() })
      }
      if (!accept(',') && !accept(';')) break
    }
    expectClose('}', '{', open.line)
    return { type: 'Table', items, line: open.line, col: open.col }
  }

  /**
   * Parameter list and body of a function; the current token is the `(`.
   * @param {string} name
   * @param {number} line  Line of the `function` keyword
   * @param {boolean} isMethod  Adds the implicit `self` parameter
   * @returns {FunctionExpr}
   */
  function parseFuncBody(name, line, isMethod) {
    const open = tokens[p]
    expect('(')
    const outer = fs
    fs = newFuncState(outer, false)
    /** @type {LocalVar[]} */
    const params = []
    if (isMethod) params.push(declare('self'))
    if (!is(')')) {
      do {
        if (is('...')) {
          p++
          fs.isVararg = true
          break
        }
        params.push(declare(expectName()))
      } while (accept(','))
    }
    expect(')')
    const body = parseBlock()
    const endTok = tokens[p]
    expectClose('end', 'function', line)
    closeFunction()
    const isVararg = fs.isVararg
    fs = outer
    return { type: 'Function', name, params, isVararg, body, endLine: endTok.line, line, col: open.col }
  }
}
