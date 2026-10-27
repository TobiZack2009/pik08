import { LuaSyntaxError } from './errors.js'
import { analyzeYields } from './yields.js'

/**
 * @import { Chunk, Expr, Stat, LocalVar, FunctionExpr, TableExpr, BinaryExpr, CallExpr, MethodCallExpr } from './ast.js'
 * @import { NumberModel } from './numbers.js'
 * @import { YieldAnalysis } from './yields.js'
 */

/**
 * Lua AST -> JavaScript source.
 *
 * The result is one JS expression statement sequence that, evaluated as the body of
 * `function($rt) { ... }`, returns the main function of the cart. The whole program is laid out so that
 * JS line N is Lua line N: the header lives on line 1 and newlines are only inserted where a Lua
 * statement or call starts on a later line. Stack traces of the compiled code (with a `sourceURL`) therefore
 * point at Lua line numbers directly.
 *
 * Representation (see values.js): nil is `undefined`, a call returns either a single value or a JS
 * array (several values; `NONE` for none). Calls in single-value positions are wrapped in `$1(...)`.
 *
 * Coroutines (see yields.js and coroutine.js): the functions that may reach a `yield` are emitted as
 * JS generators, wrapped as `$G(function* f$f() {...})`, and the calls inside them that may yield
 * delegate with `yield*` to the callee's generator version (`f.$g`) when it has one. A cart that never
 * mentions `yield` produces no generators at all.
 */

/** Runtime exports that compiled code destructures into short local names. */
const IMPORTS = {
  call: '$c', index: '$i', indexStr: '$is', setindex: '$si', setindexStr: '$sis',
  add: '$add', sub: '$sub', mul: '$mul', div: '$div', idiv: '$idiv', mod: '$mod', pow: '$pow', unm: '$unm',
  band: '$band', bor: '$bor', bxor: '$bxor', bnot: '$bnot', shl: '$shl', shr: '$shr', lshr: '$lshr',
  rotl: '$rotl', rotr: '$rotr', lt: '$lt', le: '$le', gt: '$gt', ge: '$ge', eq: '$eq', concat: '$cat', len: '$len',
  T: '$T', NONE: '$N', first: '$1', list: '$L', mk: '$mk', P: '$P', R: '$R', gen: '$G',
  fornum: '$fn', forstep: '$fs', sa: '$sa', peek: '$pk', peek2: '$pk2', peek4: '$pk4',
}

/** @type {Record<string, string>} */
const BINARY_HELPERS = {
  '+': '$add', '-': '$sub', '*': '$mul', '/': '$div', '\\': '$idiv', '%': '$mod', '^': '$pow',
  '|': '$bor', '&': '$band', '^^': '$bxor', '<<': '$shl', '>>': '$shr', '>>>': '$lshr', '<<>': '$rotl', '>><': '$rotr',
  '..': '$cat', '<': '$lt', '<=': '$le', '>': '$gt', '>=': '$ge',
}

const COMPARISONS = new Set(['==', '~=', '<', '<=', '>', '>='])

/** @type {Record<string, string>} */
const UNARY_HELPERS = { '-': '$unm', '#': '$len', '~': '$bnot', '@': '$pk', '%': '$pk2', $: '$pk4' }

/** A JS identifier fragment for a Lua name (glyph bytes and other oddities become `$xx`). @param {string} s */
const sanitize = (s) => s.replace(/[^A-Za-z0-9_]/g, (c) => '$' + c.charCodeAt(0).toString(16).padStart(2, '0'))

/** JS string literal for a p8str; everything outside printable ASCII is escaped. @param {string} s */
function quote(s) {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x22 || c === 0x5c) out += '\\' + s[i]
    else if (c < 0x20 || c > 0x7e) out += c < 256 ? '\\x' + c.toString(16).padStart(2, '0') : '\\u' + c.toString(16).padStart(4, '0')
    else out += s[i]
  }
  return out + '"'
}

/** Line marker, turned into newlines by the final pass. @param {number} line */
const mark = (line) => `\u0001${line}\u0002`

/** Can this expression produce several values? @param {Expr} e */
const isMulti = (e) => e.type === 'Call' || e.type === 'MethodCall' || e.type === 'Vararg'

/** Is the value of this expression always a boolean? @param {Expr} e @returns {boolean} */
function isBool(e) {
  switch (e.type) {
    case 'True':
    case 'False':
      return true
    case 'Unary':
      return e.op === 'not'
    case 'Binary':
      return COMPARISONS.has(e.op) || ((e.op === 'and' || e.op === 'or') && isBool(e.left) && isBool(e.right))
    case 'Paren':
      return isBool(e.expr)
    default:
      return false
  }
}

/** Expressions without side effects (and that cannot call metamethods). @param {Expr} e @returns {boolean} */
function isPure(e) {
  switch (e.type) {
    case 'Nil': case 'True': case 'False': case 'Number': case 'String': case 'Vararg':
    case 'Local': case 'Global': case 'Function':
      return true
    case 'Paren':
      return isPure(e.expr)
    case 'Table':
      return e.items.every((it) => (it.key === null || isPure(it.key)) && isPure(it.value))
    default:
      return false
  }
}

/**
 * Does this statement (or a statement nested in it, but not in nested functions) contain `goto name`?
 * @param {Stat} s
 * @param {string} name
 * @returns {boolean}
 */
function hasGoto(s, name) {
  switch (s.type) {
    case 'Goto': return s.label === name
    case 'Do': case 'While': case 'Repeat': case 'NumericFor': case 'GenericFor':
      return s.body.some((x) => hasGoto(x, name))
    case 'If':
      return s.clauses.some((c) => c.body.some((x) => hasGoto(x, name))) || (s.orelse?.some((x) => hasGoto(x, name)) ?? false)
    default: return false
  }
}

/** @param {Expr} e */
const isLiteral = (e) =>
  e.type === 'Nil' || e.type === 'True' || e.type === 'False' || e.type === 'Number' || e.type === 'String'

/**
 * @typedef {Object} FnState
 * @property {number} depth
 * @property {number} temps
 * @property {Map<string, { fwd: string, back: string, passed: boolean }>[]} scopes   Visible labels, innermost last
 * @property {string[]} loops   JS labels of the enclosing Lua loops, innermost last
 * @property {boolean} gen   Whether the function is compiled as a generator
 */

class Generator {
  /** @param {NumberModel} model @param {YieldAnalysis} analysis */
  constructor(model, analysis) {
    this.model = model
    this.analysis = analysis
    /** @type {FnState} */
    this.fn = { depth: -1, temps: 0, scopes: [], loops: [], gen: false }
    /** Locals known to hold a function forever (`local function f` that is never assigned). */
    this.direct = new Set()
    this.counter = 0
  }

  /** @param {LocalVar} v */
  name(v) {
    return `${sanitize(v.name)}_${v.id}`
  }

  tmp() {
    return `$t${++this.fn.temps}`
  }

  /** @param {string} name */
  global(name) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && name !== '__proto__' ? `$s.${name}` : `$s[${quote(name)}]`
  }

  /** What an expression is called in "attempt to ... a nil value (desc)" messages, if it has a name. @param {Expr} e */
  descText(e) {
    switch (e.type) {
      case 'Local':
        return `${e.var.depth < this.fn.depth ? 'upvalue' : 'local'} '${e.var.name}'`
      case 'Global':
        return `global '${e.name}'`
      case 'Index':
        return e.key.type === 'String' ? `field '${e.key.value}'` : undefined
      case 'MethodCall':
        return `method '${e.name}'`
      default:
        return undefined
    }
  }

  /** Trailing `, "desc"` argument for an error message, or ''. @param {Expr} e */
  describe(e) {
    const d = this.descText(e)
    return d ? `, ${quote(d)}` : ''
  }

  /** Trailing description arguments for the operands of an operator helper; trailing unnamed ones are dropped. @param {Expr[]} es */
  operandDescs(...es) {
    const ds = es.map((e) => this.descText(e))
    while (ds.length && ds[ds.length - 1] === undefined) ds.pop()
    return ds.map((d) => `, ${d === undefined ? 'undefined' : quote(d)}`).join('')
  }

  /** @param {number} v */
  number(v) {
    const x = this.model.fromLiteral(v)
    return x < 0 || Object.is(x, -0) ? `(${Object.is(x, -0) ? '-0' : x})` : String(x)
  }

  // --- expressions ---------------------------------------------------------------------------

  /** Single-value expression. @param {Expr} e @returns {string} */
  expr(e) {
    switch (e.type) {
      case 'Nil': return 'undefined'
      case 'True': return 'true'
      case 'False': return 'false'
      case 'Number': return this.number(e.value)
      case 'String': return quote(e.value)
      case 'Vararg': return '$va[0]'
      case 'Local': return this.name(e.var)
      case 'Global': return this.global(e.name)
      case 'Paren': return this.expr(e.expr)
      case 'Index': {
        const o = this.expr(e.object)
        const d = this.describe(e.object)
        const m = mark(e.line)
        return e.key.type === 'String'
          ? `${m}$is(${o}, ${quote(e.key.value)}${d})`
          : `${m}$i(${o}, ${this.expr(e.key)}${d})`
      }
      case 'Call':
      case 'MethodCall':
        return `$1(${this.callExpr(e)})`
      case 'Function': return this.func(e)
      case 'Table': return this.table(e)
      case 'Unary': return this.unary(e)
      case 'Binary': return this.binary(e)
    }
  }

  /** Raw (possibly multi-valued) result of a call or vararg. @param {CallExpr | MethodCallExpr | Expr} e @returns {string} */
  multi(e) {
    if (e.type === 'Vararg') return '$va'
    if (e.type === 'Call' || e.type === 'MethodCall') return this.callExpr(e)
    return this.expr(e)
  }

  /** Argument list text, spreading a trailing multi-value. @param {Expr[]} args */
  args(args) {
    return args
      .map((a, i) => {
        if (i < args.length - 1 || !isMulti(a)) return this.expr(a)
        return a.type === 'Vararg' ? '...$va' : `...$L(${this.multi(a)})`
      })
      .join(', ')
  }

  /** @param {CallExpr | MethodCallExpr} e */
  callExpr(e) {
    const m = mark(e.line)
    if (this.fn.gen && this.analysis.calls.has(e)) return this.yieldingCall(e)
    if (e.type === 'Call') {
      const f = e.fn
      if (f.type === 'Local' && this.direct.has(f.var.id)) return `${m}${this.name(f.var)}(${this.args(e.args)})`
      return `${m}$c(${this.expr(f)}${this.describe(f)})(${this.args(e.args)})`
    }
    const obj = e.object
    const rest = e.args.length ? ', ' + this.args(e.args) : ''
    const lookup = (/** @type {string} */ o) =>
      `$c($is(${o}, ${quote(e.name)}${this.describe(obj)}), ${quote(`method '${e.name}'`)})`
    if (obj.type === 'Local') {
      const o = this.name(obj.var)
      return `${m}${lookup(o)}(${o}${rest})`
    }
    const t = this.tmp()
    return `${m}(${t} = ${this.expr(obj)}, ${lookup(t)}(${t}${rest}))`
  }

  /**
   * A call that may yield, inside a generator. A callee that is known to be a generator is delegated to
   * directly; any other is resolved at run time, since only some functions have a generator version
   * (`$g`). The pieces go through temporaries so that the call text is not repeated in the two branches.
   * @param {CallExpr | MethodCallExpr} e
   */
  yieldingCall(e) {
    const m = mark(e.line)
    const target = this.analysis.calls.get(e)
    if (e.type === 'Call' && e.fn.type === 'Local' && this.direct.has(e.fn.var.id) && target && this.analysis.generators.has(target)) {
      return `${m}(yield* ${this.name(e.fn.var)}.$g(${this.args(e.args)}))`
    }

    /** @type {string[]} */
    const pre = []
    const f = this.tmp()
    /** @type {string[]} */
    const head = []
    if (e.type === 'Call') {
      pre.push(`${f} = $c(${this.expr(e.fn)}${this.describe(e.fn)})`)
    } else {
      const o = this.tmp()
      pre.push(`${o} = ${this.expr(e.object)}`)
      pre.push(`${f} = $c($is(${o}, ${quote(e.name)}${this.describe(e.object)}), ${quote(`method '${e.name}'`)})`)
      head.push(o)
    }
    const args = e.args.map((a, i) => {
      if (i === e.args.length - 1 && isMulti(a)) {
        if (a.type === 'Vararg') return '...$va'
        const t = this.tmp()
        pre.push(`${t} = $L(${this.multi(a)})`)
        return `...${t}`
      }
      if (isLiteral(a)) return this.expr(a)
      const t = this.tmp()
      pre.push(`${t} = ${this.expr(a)}`)
      return t
    })
    const list = [...head, ...args].join(', ')
    return `${m}(${pre.join(', ')}, ${f}.$g === undefined ? ${f}(${list}) : (yield* ${f}.$g(${list})))`
  }

  /** Is this variable a function that never changes? @param {Expr} e */
  isDirect(e) {
    return e.type === 'Local' && this.direct.has(e.var.id)
  }

  /** @param {import('./ast.js').UnaryExpr} e */
  unary(e) {
    const a = e.arg
    switch (e.op) {
      case 'not':
        return `!${this.cond(a)}`
      case '-':
        if (a.type === 'Number') return this.number(this.model.neg(this.model.fromLiteral(a.value)))
        return `$unm(${this.expr(a)}${this.describe(a)})`
      default:
        return `${UNARY_HELPERS[e.op]}(${this.expr(a)}${e.op === '#' || e.op === '~' ? this.describe(a) : ''})`
    }
  }

  /** @param {BinaryExpr} e */
  binary(e) {
    const { op, left, right } = e
    if (op === 'and' || op === 'or') return this.logical(e)
    if (op === '==' || op === '~=') {
      const a = this.expr(left)
      const b = this.expr(right)
      if (isLiteral(left) || isLiteral(right)) return `(${a} ${op === '==' ? '===' : '!=='} ${b})`
      return op === '==' ? `$eq(${a}, ${b})` : `!$eq(${a}, ${b})`
    }
    const descs = COMPARISONS.has(op) ? '' : this.operandDescs(left, right)
    return `${BINARY_HELPERS[op]}(${this.expr(left)}, ${this.expr(right)}${descs})`
  }

  /** `a and b` / `a or b` as a value. @param {BinaryExpr} e */
  logical(e) {
    const and = e.op === 'and'
    if (isBool(e.left)) return `(${this.expr(e.left)} ${and ? '&&' : '||'} ${this.expr(e.right)})`
    let t
    let test
    if (e.left.type === 'Local') {
      t = this.name(e.left.var)
      test = t
    } else {
      t = this.tmp()
      test = `(${t} = ${this.expr(e.left)})`
    }
    const r = this.expr(e.right)
    const falsy = `${test} === undefined || ${t} === false`
    return and ? `(${falsy} ? ${t} : ${r})` : `(${falsy} ? ${r} : ${t})`
  }

  /** JS boolean expression for the truthiness of `e`. @param {Expr} e @returns {string} */
  cond(e) {
    switch (e.type) {
      case 'True': case 'Number': case 'String': return 'true'
      case 'False': case 'Nil': return 'false'
      case 'Paren': return this.cond(e.expr)
      case 'Unary':
        if (e.op === 'not') return `!${this.cond(e.arg)}`
        break
      case 'Binary':
        if (e.op === 'and') return `(${this.cond(e.left)} && ${this.cond(e.right)})`
        if (e.op === 'or') return `(${this.cond(e.left)} || ${this.cond(e.right)})`
        if (COMPARISONS.has(e.op)) return this.binary(e)
        break
      case 'Local': {
        const n = this.name(e.var)
        return `(${n} !== undefined && ${n} !== false)`
      }
    }
    const t = this.tmp()
    return `((${t} = ${this.expr(e)}) !== undefined && ${t} !== false)`
  }

  /** @param {TableExpr} e */
  table(e) {
    const items = e.items
    if (items.length === 0) return 'new $T()'
    const keyed = items.filter((it) => it.key !== null)
    const lastPositional = items.findLastIndex((it) => it.key === null)
    const firstKeyed = items.findIndex((it) => it.key !== null)
    const orderFree = keyed.length === 0 || lastPositional < 0 || lastPositional < firstKeyed || items.every((it) => isPure(it.value) && (it.key === null || isPure(it.key)))
    const lastItem = items[items.length - 1]
    const tail = lastItem && lastItem.key === null && isMulti(lastItem.value)

    if (orderFree && keyed.every((it) => it.key?.type === 'String')) {
      const arr = items
        .filter((it) => it.key === null)
        .map((it) => {
          const v = it.value
          if (it !== lastItem || !isMulti(v)) return this.expr(v)
          return v.type === 'Vararg' ? '...$va' : `...$L(${this.multi(v)})`
        })
        .join(', ')
      if (keyed.length === 0) return `new $T([${arr}])`
      const dict = keyed
        .map((it) => {
          const k = /** @type {import('./ast.js').StringExpr} */ (it.key).value
          return k === '__proto__' ? `[${quote(k)}]: ${this.expr(it.value)}` : `${quote(k)}: ${this.expr(it.value)}`
        })
        .join(', ')
      return `new $T([${arr}], {__proto__: null, ${dict}})`
    }

    const parts = items.map((it, i) => {
      if (it.key !== null) return `${this.expr(it.key)}, ${this.expr(it.value)}`
      if (i === items.length - 1 && tail) {
        return `$R, ${it.value.type === 'Vararg' ? '$va' : `$L(${this.multi(it.value)})`}`
      }
      return `$P, ${this.expr(it.value)}`
    })
    return `$mk([${parts.join(', ')}])`
  }

  /** @param {FunctionExpr} e */
  func(e) {
    const saved = this.fn
    const gen = this.analysis.generators.has(e)
    this.fn = { depth: saved.depth + 1, temps: 0, scopes: [], loops: [], gen }
    const params = e.params.map((p) => this.name(p))
    if (e.isVararg) params.push('...$va')
    const body = this.block(e.body)
    const last = e.body[e.body.length - 1]
    const tail = last && last.type === 'Return' ? '' : 'return $N;'
    const temps = this.fn.temps
    this.fn = saved
    let decl = ''
    if (temps > 0) decl = 'let ' + Array.from({ length: temps }, (_, i) => `$t${i + 1}`).join(', ') + ';'
    const text = `function${gen ? '*' : ''} ${sanitize(e.name || 'anon')}$f(${params.join(', ')}) {${decl}${body}${tail}}`
    return `${mark(e.line)}${gen ? `$G(${text})` : text}`
  }

  // --- statements ----------------------------------------------------------------------------

  /** A fresh name for an inline-declared temporary. */
  fresh() {
    return `$r${++this.counter}`
  }

  /**
   * Statements of a block, with `goto`/labels turned into labeled JS blocks (forward jumps) and labeled
   * `for(;;)` loops (backward jumps).
   * @param {Stat[]} stats
   * @returns {string}
   */
  block(stats) {
    if (!stats.some((s) => s.type === 'Label')) return stats.map((s) => this.stat(s)).join('')

    /** @type {Map<string, { fwd: string, back: string, passed: boolean }>} */
    const scope = new Map()
    /** @type {{ start: number, end: number, open: string, close: string }[]} */
    const intervals = []
    stats.forEach((s, j) => {
      if (s.type !== 'Label') return
      if (scope.has(s.name)) throw new LuaSyntaxError(`label '${s.name}' already defined`, s.line, s.col)
      const entry = { fwd: `L${++this.counter}_${sanitize(s.name)}`, back: `L${++this.counter}_${sanitize(s.name)}`, passed: false }
      scope.set(s.name, entry)
      const g = stats.findIndex((x, i) => i < j && hasGoto(x, s.name))
      if (g >= 0) intervals.push({ start: g, end: j, open: `${entry.fwd}: {`, close: '}' })
      if (stats.some((x, i) => i > j && hasGoto(x, s.name))) {
        intervals.push({ start: j + 1, end: stats.length, open: `${entry.back}: for (;;) {`, close: `break ${entry.back};}` })
      }
    })
    // Partially overlapping forward regions are merged so that they nest.
    for (let changed = true; changed;) {
      changed = false
      for (const a of intervals) {
        for (const b of intervals) {
          if (a !== b && a.end < b.end && a.start < b.start && b.start < a.end && a.end !== stats.length) {
            b.start = a.start
            changed = true
          }
        }
      }
    }
    intervals.sort((a, b) => a.start - b.start || b.end - a.end)

    this.fn.scopes.push(scope)
    /** @type {typeof intervals} */
    const stack = []
    let out = ''
    let next = 0
    for (let i = 0; i <= stats.length; i++) {
      while (stack.length && /** @type {any} */ (stack[stack.length - 1]).end <= i) out += /** @type {any} */ (stack.pop()).close
      if (stack.some((x) => x.end <= i)) {
        const s = stats[i - 1] ?? stats[0]
        throw new LuaSyntaxError('unsupported goto: overlapping jump regions', s?.line ?? 1, s?.col ?? 1)
      }
      if (i === stats.length) break
      while (next < intervals.length && /** @type {any} */ (intervals[next]).start === i) {
        const iv = /** @type {any} */ (intervals[next++])
        out += iv.open
        stack.push(iv)
      }
      const s = /** @type {Stat} */ (stats[i])
      if (s.type === 'Label') /** @type {any} */ (scope.get(s.name)).passed = true
      else out += this.stat(s)
    }
    this.fn.scopes.pop()
    return out
  }

  /**
   * Assignment statements that give fresh (already declared) variables the values of an expression list.
   * @param {string[]} targets
   * @param {Expr[]} values
   */
  bindFresh(targets, values) {
    let out = ''
    const n = targets.length
    values.forEach((v, i) => {
      if (i === values.length - 1 && isMulti(v) && n > i) {
        const rest = n - i
        if (rest === 1) out += `${targets[i]} = ${this.expr(v)};`
        else if (v.type === 'Vararg') for (let k = 0; k < rest; k++) out += `${targets[i + k]} = $va[${k}];`
        else {
          const r = this.fresh()
          out += `const ${r} = $L(${this.multi(v)});`
          for (let k = 0; k < rest; k++) out += `${targets[i + k]} = ${r}[${k}];`
        }
      } else if (i < n) out += `${targets[i]} = ${this.expr(v)};`
      else out += `(${this.expr(v)});`
    })
    return out
  }

  /** @param {import('./ast.js').LocalDeclStat} s */
  localDecl(s) {
    const names = s.vars.map((v) => this.name(v))
    const vals = s.values
    if (vals.length === 0) return `let ${names.join(', ')};`
    const last = /** @type {Expr} */ (vals[vals.length - 1])
    /** @type {string[]} */
    const decls = []
    if (isMulti(last) && vals.length < names.length) {
      for (let i = 0; i < vals.length - 1; i++) decls.push(`${names[i]} = ${this.expr(/** @type {Expr} */ (vals[i]))}`)
      const rest = names.slice(vals.length - 1)
      if (last.type === 'Vararg') rest.forEach((n, k) => decls.push(`${n} = $va[${k}]`))
      else {
        const r = this.fresh()
        decls.push(`${r} = $L(${this.multi(last)})`)
        rest.forEach((n, k) => decls.push(`${n} = ${r}[${k}]`))
      }
      return `let ${decls.join(', ')};`
    }
    names.forEach((n, i) => decls.push(i < vals.length ? `${n} = ${this.expr(/** @type {Expr} */ (vals[i]))}` : n))
    let out = `let ${decls.join(', ')};`
    for (let i = names.length; i < vals.length; i++) out += `(${this.expr(/** @type {Expr} */ (vals[i]))});`
    return out
  }

  /**
   * Assignment of the JS expression `v` to a target.
   * @param {import('./ast.js').AssignStat['targets'][number]} t
   * @param {string} v
   */
  assignTo(t, v) {
    switch (t.type) {
      case 'Local': return `${this.name(t.var)} = ${v}`
      case 'Global': return `${this.global(t.name)} = ${v}`
      case 'Index': {
        const o = this.expr(t.object)
        const d = this.describe(t.object)
        return t.key.type === 'String'
          ? `$sis(${o}, ${quote(t.key.value)}, ${v}${d})`
          : `$si(${o}, ${this.expr(t.key)}, ${v}${d})`
      }
    }
  }

  /** @param {import('./ast.js').AssignStat} s */
  assign(s) {
    const { targets, values } = s
    if (targets.length === 1 && values.length === 1) {
      return this.assignTo(/** @type {any} */ (targets[0]), this.expr(/** @type {Expr} */ (values[0]))) + ';'
    }
    let out = ''
    const slots = targets.map((t) => {
      if (t.type !== 'Index') return t
      const o = this.tmp()
      const k = this.tmp()
      out += `${o} = ${this.expr(t.object)}; ${k} = ${this.expr(t.key)};`
      return { type: 'Slot', o, k, d: this.describe(t.object) }
    })
    const nt = targets.length
    /** @type {string[]} */
    const vals = []
    values.forEach((v, i) => {
      if (i === values.length - 1 && isMulti(v) && nt > i) {
        const rest = nt - i
        if (rest === 1) {
          const t = this.tmp()
          out += `${t} = ${this.expr(v)};`
          vals.push(t)
        } else if (v.type === 'Vararg') {
          for (let k = 0; k < rest; k++) vals.push(`$va[${k}]`)
        } else {
          const t = this.tmp()
          out += `${t} = $L(${this.multi(v)});`
          for (let k = 0; k < rest; k++) vals.push(`${t}[${k}]`)
        }
      } else {
        const t = this.tmp()
        out += `${t} = ${this.expr(v)};`
        vals.push(t)
      }
    })
    for (let j = nt - 1; j >= 0; j--) {
      const v = vals[j] ?? 'undefined'
      const slot = /** @type {any} */ (slots[j])
      out += (slot.type === 'Slot' ? `$si(${slot.o}, ${slot.k}, ${v}${slot.d})` : this.assignTo(slot, v)) + ';'
    }
    return out
  }

  /** @param {import('./ast.js').OpAssignStat} s */
  opAssign(s) {
    const h = BINARY_HELPERS[s.op]
    const t = s.target
    if (t.type === 'Local') {
      const n = this.name(t.var)
      return `${n} = ${h}(${n}, ${this.expr(s.value)}${this.operandDescs(t, s.value)});`
    }
    if (t.type === 'Global') {
      const g = this.global(t.name)
      return `${g} = ${h}(${g}, ${this.expr(s.value)}${this.operandDescs(t, s.value)});`
    }
    let pre = ''
    let o
    if (t.object.type === 'Local') o = this.name(t.object.var)
    else {
      o = this.tmp()
      pre += `${o} = ${this.expr(t.object)}; `
    }
    const d = this.describe(t.object)
    const key = t.key
    if (key.type === 'String') {
      const k = quote(key.value)
      return `${pre}$sis(${o}, ${k}, ${h}($is(${o}, ${k}${d}), ${this.expr(s.value)}${this.operandDescs(t, s.value)})${d});`
    }
    let k
    if (key.type === 'Local' || key.type === 'Number') k = this.expr(key)
    else {
      k = this.tmp()
      pre += `${k} = ${this.expr(key)}; `
    }
    return `${pre}$si(${o}, ${k}, ${h}($i(${o}, ${k}${d}), ${this.expr(s.value)}${this.operandDescs(t, s.value)})${d});`
  }

  /**
   * Runs `f` with a fresh JS loop label pushed, and returns [label, result].
   * @param {(label: string) => string} f
   */
  loop(f) {
    const label = `L${++this.counter}`
    this.fn.loops.push(label)
    const out = f(label)
    this.fn.loops.pop()
    return out
  }

  /** @param {import('./ast.js').NumericForStat} s */
  numericFor(s) {
    const id = ++this.counter
    const M = this.model
    /** @type {string[]} */
    const hoist = []
    /** @param {Expr} e @param {string} v @param {string} what */
    const operand = (e, v, what) => {
      if (e.type === 'Number') return this.number(e.value)
      hoist.push(`${v} = $fn(${this.expr(e)}, ${quote(what)})`)
      return v
    }
    const start = operand(s.start, `$b${id}`, 'initial value')
    const limit = operand(s.limit, `$l${id}`, 'limit')
    /** @type {string} */
    let step = '1'
    let sign = 1
    if (s.step) {
      if (s.step.type === 'Number') {
        const sv = M.fromLiteral(s.step.value)
        sign = sv > 0 ? 1 : sv < 0 ? -1 : 0
        step = sign === 0 ? `$fs(0)` : this.number(s.step.value)
      } else {
        sign = 0
        hoist.push(`$st${id} = $fs(${this.expr(s.step)})`)
        step = `$st${id}`
      }
    }
    const v = this.name(s.var)
    const counter = s.var.assigned ? `$ix${id}` : v
    const test =
      sign > 0 ? `${counter} <= ${limit}`
      : sign < 0 ? `${counter} >= ${limit}`
      : `(${step} > 0 ? ${counter} <= ${limit} : ${counter} >= ${limit})`
    const incr = M.name === 'float' ? `${counter} += ${step}` : `${counter} = $sa(${counter}, ${step})`
    const body = this.loop((label) => {
      const inner = this.block(s.body)
      return `${label}: for (let ${counter} = ${start}; ${test}; ${incr}) {${s.var.assigned ? `let ${v} = ${counter};` : ''}${inner}}`
    })
    return `{${hoist.length ? `let ${hoist.join(', ')};` : ''}${body}}`
  }

  /** @param {import('./ast.js').GenericForStat} s */
  genericFor(s) {
    const id = ++this.counter
    const f = `$gf${id}`
    const st = `$gs${id}`
    const c = `$gc${id}`
    const r = `$gr${id}`
    const names = s.vars.map((v) => this.name(v))
    const setup = this.bindFresh([f, st, c], s.exprs)
    const body = this.loop((label) => {
      const inner = this.block(s.body)
      const unpack = names.length === 1
        ? `let ${names[0]} = ${r} instanceof Array ? ${r}[0] : ${r};`
        : `let ${names.join(', ')}; if (${r} instanceof Array) {${names.map((n, i) => `${n} = ${r}[${i}];`).join(' ')}} else ${names[0]} = ${r};`
      const next = this.fn.gen && this.analysis.loops.has(s)
        ? `${f}.$g === undefined ? ${f}(${st}, ${c}) : (yield* ${f}.$g(${st}, ${c}))`
        : `${f}(${st}, ${c})`
      return `${label}: for (;;) {const ${r} = ${next}; ${unpack} if (${names[0]} === undefined) break ${label}; ${c} = ${names[0]}; ${inner}}`
    })
    return `{let ${f}, ${st}, ${c}; ${setup} ${f} = $c(${f}, "for iterator 'for iterator'"); ${body}}`
  }

  /** @param {import('./ast.js').ReturnStat} s */
  ret(s) {
    const v = s.values
    if (v.length === 0) return 'return $N;'
    if (v.length === 1) return `return(${this.multi(/** @type {Expr} */ (v[0]))});`
    return `return([${this.args(v)}]);`
  }

  /** @param {Stat} s @returns {string} */
  stat(s) {
    const m = mark(s.line)
    switch (s.type) {
      case 'LocalDecl':
        return m + this.localDecl(s)
      case 'LocalFunction': {
        if (!s.var.assigned) this.direct.add(s.var.id)
        return `${m}let ${this.name(s.var)} = ${this.func(s.func)};`
      }
      case 'Assign':
        return m + this.assign(s)
      case 'OpAssign':
        return m + this.opAssign(s)
      case 'CallStat':
        return m + this.callExpr(s.call) + ';'
      case 'Do':
        return `${m}{${this.block(s.body)}}`
      case 'While': {
        const c = this.cond(s.cond)
        return m + this.loop((label) => `${label}: while (${c}) {${this.block(s.body)}}`)
      }
      case 'Repeat':
        return m + this.loop((label) => `${label}: for (;;) {${this.block(s.body)} if (${this.cond(s.cond)}) break ${label};}`)
      case 'If': {
        let out = m
        s.clauses.forEach((c, i) => {
          out += `${i ? ' else ' : ''}if (${this.cond(c.cond)}) {${this.block(c.body)}}`
        })
        if (s.orelse) out += ` else {${this.block(s.orelse)}}`
        return out
      }
      case 'NumericFor':
        return m + this.numericFor(s)
      case 'GenericFor':
        return m + this.genericFor(s)
      case 'Return':
        return m + this.ret(s)
      case 'Break': {
        const label = this.fn.loops[this.fn.loops.length - 1]
        if (label === undefined) throw new LuaSyntaxError('break outside a loop', s.line, s.col)
        return `${m}break ${label};`
      }
      case 'Goto': {
        for (let i = this.fn.scopes.length - 1; i >= 0; i--) {
          const e = /** @type {Map<string, { fwd: string, back: string, passed: boolean }>} */ (this.fn.scopes[i]).get(s.label)
          if (e) return `${m}${e.passed ? `continue ${e.back}` : `break ${e.fwd}`};`
        }
        throw new LuaSyntaxError(`no visible label '${s.label}' for goto`, s.line, s.col)
      }
      case 'Label':
        return ''
    }
  }
}

/**
 * Compiles a parsed chunk to JS source (see the file comment). The returned code is the body of a
 * function taking the runtime object `$rt` and returning the main function.
 * @param {Chunk} chunk
 * @param {NumberModel} model
 * @returns {string}
 */
export function generate(chunk, model) {
  /** @type {FunctionExpr} */
  const main = { type: 'Function', name: 'main', params: [], isVararg: true, body: chunk.body, endLine: 1, line: 1, col: 1 }
  const g = new Generator(model, analyzeYields(main))
  const fn = g.func(main)
  const names = Object.entries(IMPORTS).map(([k, v]) => `${k}: ${v}`).join(', ')
  const header = `"use strict"; const {${names}} = $rt, $s = $rt.G.s; return `
  const code = header + fn + ';'
  let cur = 1
  return code.replace(/\u0001(\d+)\u0002/g, (_, n) => {
    const line = Number(n)
    if (line <= cur) return ''
    const out = '\n'.repeat(line - cur)
    cur = line
    return out
  })
}
