/**
 * @import { Expr, Stat, FunctionExpr, CallExpr, MethodCallExpr, GenericForStat } from './ast.js'
 */

/**
 * Which functions of a program might `yield`, for the code generator.
 *
 * Compiled functions are plain JS functions, which cannot be suspended. A function that may end up
 * calling `yield` is therefore compiled as a JS generator instead (see codegen.js), and so are the
 * call sites inside it that may reach a yield. Everything else stays a plain function, so carts that
 * do not use coroutines compile exactly as before and the others pay only where it is needed.
 *
 * The analysis is a conservative call graph:
 *  - a call to the builtin `yield` (or to `foreach`, which calls back into Lua, or to `flip`, which
 *    suspends the cart until the next frame) may yield;
 *  - a call to a local function that is never reassigned, or to a global that is only ever assigned
 *    function literals, yields if one of those functions does (computed to a fixed point);
 *  - any other call (a method, a field, a parameter, a result) is unknown and may yield;
 *  - calls to the other builtins, which never call back into Lua, cannot.
 * If the program touches `_G` or `_ENV` it could rebind any global, so every global call is unknown.
 * Nothing is generated at all unless the program mentions `yield` or calls `flip`.
 *
 * @typedef {Object} YieldAnalysis
 * @property {Set<FunctionExpr>} generators   Functions to compile as generators
 * @property {Map<CallExpr | MethodCallExpr, FunctionExpr | null>} calls
 *   The call sites (inside generators) that may yield, with the function they call when it is known
 * @property {Set<GenericForStat>} loops   The `for ... in` loops whose iterator may yield
 */

/** Builtins that suspend or call back into Lua, so their callers may yield. */
const YIELDING_BUILTINS = new Set(['yield', 'foreach', 'flip'])
/** Builtins whose result is an iterator that never yields. */
const ITERATOR_BUILTINS = new Set(['all', 'pairs', 'ipairs'])
/** Builtins that are iterators themselves (`for k, v in next, t`). */
const ITERATORS = new Set(['next', 'inext'])

const UNKNOWN = Symbol('unknown')
const SAFE = Symbol('safe')
const YIELDS = Symbol('yields')

/**
 * @param {FunctionExpr} root  The main function of the program
 * @returns {YieldAnalysis}
 */
export function analyzeYields(root) {
  /** @type {{ fn: FunctionExpr, sites: (CallExpr | MethodCallExpr | GenericForStat)[] }[]} */
  const funcs = []
  /** Functions assigned to each global; `null` stands for an assignment of something else. @type {Map<string, (FunctionExpr | null)[]>} */
  const globalDefs = new Map()
  /** The function each never-reassigned local holds, by variable id; `null` when it may change. @type {Map<number, FunctionExpr | null>} */
  const localDefs = new Map()
  let mentionsYield = false
  let touchesEnv = false

  /** @param {string} name @param {FunctionExpr | null} fn */
  const defineGlobal = (name, fn) => {
    const list = globalDefs.get(name)
    if (list) list.push(fn)
    else globalDefs.set(name, [fn])
  }

  /** @param {FunctionExpr} fn */
  function visitFunction(fn) {
    const rec = { fn, sites: /** @type {(CallExpr | MethodCallExpr | GenericForStat)[]} */ ([]) }
    funcs.push(rec)
    stats(fn.body, rec)
  }

  /** @param {Stat[]} list @param {typeof funcs[number]} rec */
  function stats(list, rec) {
    for (const s of list) stat(s, rec)
  }

  /** @param {Expr[]} list @param {typeof funcs[number]} rec */
  function exprs(list, rec) {
    for (const e of list) expr(e, rec)
  }

  /** @param {Stat} s @param {typeof funcs[number]} rec */
  function stat(s, rec) {
    switch (s.type) {
      case 'LocalDecl':
        s.vars.forEach((v, i) => {
          const value = s.values[i]
          if (value?.type === 'Function') localDefs.set(v.id, v.assigned ? null : value)
        })
        exprs(s.values, rec)
        break
      case 'LocalFunction':
        localDefs.set(s.var.id, s.var.assigned ? null : s.func)
        expr(s.func, rec)
        break
      case 'Assign':
        s.targets.forEach((t, i) => {
          if (t.type === 'Global') {
            const value = s.values[i]
            defineGlobal(t.name, value?.type === 'Function' ? value : null)
          }
          expr(t, rec)
        })
        exprs(s.values, rec)
        break
      case 'OpAssign':
        if (s.target.type === 'Global') defineGlobal(s.target.name, null)
        expr(s.target, rec)
        expr(s.value, rec)
        break
      case 'CallStat':
        expr(s.call, rec)
        break
      case 'Do':
        stats(s.body, rec)
        break
      case 'While':
        expr(s.cond, rec)
        stats(s.body, rec)
        break
      case 'Repeat':
        stats(s.body, rec)
        expr(s.cond, rec)
        break
      case 'If':
        for (const c of s.clauses) {
          expr(c.cond, rec)
          stats(c.body, rec)
        }
        if (s.orelse) stats(s.orelse, rec)
        break
      case 'NumericFor':
        expr(s.start, rec)
        expr(s.limit, rec)
        if (s.step) expr(s.step, rec)
        stats(s.body, rec)
        break
      case 'GenericFor':
        rec.sites.push(s)
        exprs(s.exprs, rec)
        stats(s.body, rec)
        break
      case 'Return':
        exprs(s.values, rec)
        break
    }
  }

  /** @param {Expr} e @param {typeof funcs[number]} rec */
  function expr(e, rec) {
    switch (e.type) {
      case 'Global':
        if (e.name === 'yield') mentionsYield = true
        if (e.name === '_G' || e.name === '_ENV') touchesEnv = true
        break
      case 'String':
        if (e.value === 'yield') mentionsYield = true
        break
      case 'Function':
        visitFunction(e)
        break
      case 'Call':
        rec.sites.push(e)
        if (e.fn.type === 'Global' && e.fn.name === 'flip') mentionsYield = true
        expr(e.fn, rec)
        exprs(e.args, rec)
        break
      case 'MethodCall':
        rec.sites.push(e)
        expr(e.object, rec)
        exprs(e.args, rec)
        break
      case 'Index':
        expr(e.object, rec)
        expr(e.key, rec)
        break
      case 'Unary':
        expr(e.arg, rec)
        break
      case 'Binary':
        expr(e.left, rec)
        expr(e.right, rec)
        break
      case 'Paren':
        expr(e.expr, rec)
        break
      case 'Table':
        for (const item of e.items) {
          if (item.key) expr(item.key, rec)
          expr(item.value, rec)
        }
        break
    }
  }

  visitFunction(root)

  /** @type {YieldAnalysis} */
  const result = { generators: new Set(), calls: new Map(), loops: new Set() }
  if (!mentionsYield) return result

  /**
   * What a callee expression is: a builtin that cannot yield (SAFE) or can (YIELDS), the functions it
   * may be (a list), or no telling (UNKNOWN).
   * @param {Expr} e
   * @returns {typeof UNKNOWN | typeof SAFE | typeof YIELDS | FunctionExpr[]}
   */
  function calleeOf(e) {
    while (e.type === 'Paren') e = e.expr
    if (e.type === 'Local') {
      const def = localDefs.get(e.var.id)
      return def ? [def] : UNKNOWN
    }
    if (e.type === 'Global') {
      if (touchesEnv) return UNKNOWN
      const defs = globalDefs.get(e.name)
      if (defs === undefined) return YIELDING_BUILTINS.has(e.name) ? YIELDS : SAFE
      return defs.includes(null) ? UNKNOWN : /** @type {FunctionExpr[]} */ (defs)
    }
    return UNKNOWN
  }

  /** @param {Expr} e @param {Set<string>} names */
  const isBuiltin = (e, names) => e.type === 'Global' && names.has(e.name) && calleeOf(e) === SAFE

  /** Whether a call or loop might yield, given the generators found so far. @param {CallExpr | MethodCallExpr | GenericForStat} site */
  function yields(site) {
    if (site.type === 'GenericFor') {
      const [head] = site.exprs
      if (site.exprs.length === 1 && head.type === 'Call' && isBuiltin(head.fn, ITERATOR_BUILTINS)) return false
      return !isBuiltin(head, ITERATORS)
    }
    if (site.type === 'MethodCall') return true
    const callee = calleeOf(site.fn)
    if (callee === SAFE) return false
    if (Array.isArray(callee)) return callee.some((f) => result.generators.has(f))
    return true
  }

  for (let changed = true; changed;) {
    changed = false
    for (const rec of funcs) {
      if (!result.generators.has(rec.fn) && rec.sites.some(yields)) {
        result.generators.add(rec.fn)
        changed = true
      }
    }
  }

  for (const rec of funcs) {
    for (const site of rec.sites) {
      if (!yields(site)) continue
      if (site.type === 'GenericFor') result.loops.add(site)
      else {
        const callee = site.type === 'Call' ? calleeOf(site.fn) : UNKNOWN
        result.calls.set(site, Array.isArray(callee) && callee.length === 1 ? callee[0] : null)
      }
    }
  }
  return result
}
