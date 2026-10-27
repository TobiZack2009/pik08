import { parse } from '../../src/lua/parser.js'

/** @import { Expr, Stat } from '../../src/lua/ast.js' */

/**
 * Compact S-expression rendering of AST nodes so tests can assert on a whole tree with one string.
 * Locals print as their name, globals as `@name`; a local that is assigned after its declaration
 * gets a `!` suffix and one captured by a closure a `^` suffix.
 * @param {Expr | Stat | Stat[]} node
 * @returns {string}
 */
export function sexp(node) {
  if (Array.isArray(node)) return node.map(sexp).join(' ')
  /** @param {import('../../src/lua/ast.js').LocalVar} v */
  const lv = (v) => v.name + (v.assigned ? '!' : '') + (v.captured ? '^' : '')
  /** @param {(Expr | Stat)[]} list */
  const list = (list) => list.map(sexp).join(' ')
  switch (node.type) {
    case 'Nil':
      return 'nil'
    case 'True':
      return 'true'
    case 'False':
      return 'false'
    case 'Number':
      return String(node.value)
    case 'String':
      return JSON.stringify(node.value)
    case 'Vararg':
      return '...'
    case 'Local':
      return lv(node.var)
    case 'Global':
      return '@' + node.name
    case 'Index':
      return `(idx ${sexp(node.object)} ${sexp(node.key)})`
    case 'Call':
      return `(call ${sexp(node.fn)}${node.args.length ? ' ' + list(node.args) : ''})`
    case 'MethodCall':
      return `(mcall ${sexp(node.object)} ${node.name}${node.args.length ? ' ' + list(node.args) : ''})`
    case 'Function':
      return `(function (${[...node.params.map(lv), ...(node.isVararg ? ['...'] : [])].join(' ')})${node.body.length ? ' ' + list(node.body) : ''})`
    case 'Unary':
      return `(${node.op} ${sexp(node.arg)})`
    case 'Binary':
      return `(${node.op} ${sexp(node.left)} ${sexp(node.right)})`
    case 'Paren':
      return `(paren ${sexp(node.expr)})`
    case 'Table':
      return `(table${node.items.map((it) => ' ' + (it.key ? `(= ${sexp(it.key)} ${sexp(it.value)})` : sexp(it.value))).join('')})`
  }
  switch (node.type) {
    case 'LocalFunction':
      return `(localfn ${lv(node.var)} ${sexp(node.func)})`
    case 'CallStat':
      return sexp(node.call)
    case 'Assign':
      return `(assign (${list(node.targets)}) (${list(node.values)}))`
    case 'OpAssign':
      return `(${node.op}= ${sexp(node.target)} ${sexp(node.value)})`
    case 'Do':
      return `(do${node.body.length ? ' ' + list(node.body) : ''})`
    case 'While':
      return `(while ${sexp(node.cond)}${node.body.length ? ' ' + list(node.body) : ''})`
    case 'Repeat':
      return `(repeat (${list(node.body)}) ${sexp(node.cond)})`
    case 'If':
      return `(if ${node.clauses.map((c) => `(${sexp(c.cond)}${c.body.length ? ' ' + list(c.body) : ''})`).join(' ')}${node.orelse ? ` (else${node.orelse.length ? ' ' + list(node.orelse) : ''})` : ''})`
    case 'NumericFor':
      return `(for ${lv(node.var)} ${sexp(node.start)} ${sexp(node.limit)} ${node.step ? sexp(node.step) : '_'}${node.body.length ? ' ' + list(node.body) : ''})`
    case 'GenericFor':
      return `(forin (${node.vars.map(lv).join(' ')}) (${list(node.exprs)})${node.body.length ? ' ' + list(node.body) : ''})`
    case 'Return':
      return `(return${node.values.length ? ' ' + list(node.values) : ''})`
    case 'Break':
      return 'break'
    case 'Goto':
      return `(goto ${node.label})`
    case 'Label':
      return `(label ${node.name})`
    case 'LocalDecl':
      return `(local (${node.vars.map(lv).join(' ')})${node.values.length ? ' (' + list(node.values) + ')' : ''})`
  }
  throw new Error('unknown node ' + JSON.stringify(node))
}

/** Parses `src` and renders its statements. @param {string} src */
export const s = (src) => sexp(parse(src).body)
/** Parses `src` as the right-hand side of `return` and renders the one expression. @param {string} src */
export const e = (src) => {
  const [ret] = parse('return ' + src).body
  if (ret.type !== 'Return' || ret.values.length !== 1) throw new Error('not a single expression')
  return sexp(ret.values[0])
}
