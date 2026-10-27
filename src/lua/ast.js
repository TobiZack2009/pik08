/**
 * AST of PICO-8 Lua, as produced by parser.js. This file only holds types.
 *
 * Names are resolved by the parser: a use of a local is a `Local` node pointing at its `LocalVar`,
 * anything else is a `Global`. Syntactic sugar is already gone:
 *  - `function a.b:c() end` is an `Assign` of a `Function` (with an explicit `self` parameter);
 *  - `a.b` is an `Index` with a `String` key; `a:m(x)` stays a `MethodCall`;
 *  - `?x` is a call to the global `print`; `a != b` is `~=`; binary `~` is `^^`;
 *  - `if (c) stmt` and `while (c) stmt` are ordinary `If` / `While`.
 *
 * @typedef {Object} LocalVar
 * @property {string} name
 * @property {number} id          Unique within one parse
 * @property {number} depth       Function nesting depth where it was declared (main chunk = 0)
 * @property {boolean} assigned   Assigned to somewhere after its declaration
 * @property {boolean} captured   Used from a function nested inside the one that declares it
 *
 * @typedef {Object} Pos
 * @property {number} line   1-based
 * @property {number} col    1-based
 *
 * Expressions
 * @typedef {{ type: 'Nil' } & Pos} NilExpr
 * @typedef {{ type: 'True' } & Pos} TrueExpr
 * @typedef {{ type: 'False' } & Pos} FalseExpr
 * @typedef {{ type: 'Number', value: number } & Pos} NumberExpr
 * @typedef {{ type: 'String', value: string } & Pos} StringExpr
 * @typedef {{ type: 'Vararg' } & Pos} VarargExpr
 * @typedef {{ type: 'Local', var: LocalVar } & Pos} LocalExpr
 * @typedef {{ type: 'Global', name: string } & Pos} GlobalExpr
 * @typedef {{ type: 'Index', object: Expr, key: Expr } & Pos} IndexExpr
 * @typedef {{ type: 'Call', fn: Expr, args: Expr[] } & Pos} CallExpr
 * @typedef {{ type: 'MethodCall', object: Expr, name: string, args: Expr[] } & Pos} MethodCallExpr
 * @typedef {{ type: 'Function', name: string, params: LocalVar[], isVararg: boolean, body: Stat[], endLine: number } & Pos} FunctionExpr
 * @typedef {{ type: 'Unary', op: UnaryOp, arg: Expr } & Pos} UnaryExpr
 * @typedef {{ type: 'Binary', op: BinaryOp, left: Expr, right: Expr } & Pos} BinaryExpr
 * @typedef {{ type: 'Paren', expr: Expr } & Pos} ParenExpr
 * @typedef {{ type: 'Table', items: TableItem[] } & Pos} TableExpr
 *
 * @typedef {{ key: Expr | null, value: Expr }} TableItem   `key` is null for positional items
 *
 * @typedef {'-' | 'not' | '#' | '~' | '@' | '%' | '$'} UnaryOp
 *   `~` is bitwise not; `@` `%` `$` are peek, peek2, peek4.
 * @typedef {'or' | 'and' | '==' | '~=' | '<' | '<=' | '>' | '>=' | '|' | '^^' | '&' | '<<' | '>>' | '>>>'
 *   | '<<>' | '>><' | '..' | '+' | '-' | '*' | '/' | '\\' | '%' | '^'} BinaryOp
 * @typedef {Exclude<BinaryOp, 'or' | 'and' | '==' | '~=' | '<' | '<=' | '>' | '>='>} CompoundOp   Operators usable as `op=`
 *
 * @typedef {NilExpr | TrueExpr | FalseExpr | NumberExpr | StringExpr | VarargExpr | LocalExpr | GlobalExpr
 *   | IndexExpr | CallExpr | MethodCallExpr | FunctionExpr | UnaryExpr | BinaryExpr | ParenExpr | TableExpr} Expr
 *
 * Statements
 * @typedef {{ type: 'LocalDecl', vars: LocalVar[], values: Expr[] } & Pos} LocalDeclStat
 * @typedef {{ type: 'LocalFunction', var: LocalVar, func: FunctionExpr } & Pos} LocalFunctionStat
 * @typedef {{ type: 'Assign', targets: (LocalExpr | GlobalExpr | IndexExpr)[], values: Expr[] } & Pos} AssignStat
 * @typedef {{ type: 'OpAssign', op: CompoundOp, target: LocalExpr | GlobalExpr | IndexExpr, value: Expr } & Pos} OpAssignStat
 * @typedef {{ type: 'CallStat', call: CallExpr | MethodCallExpr } & Pos} CallStat
 * @typedef {{ type: 'Do', body: Stat[] } & Pos} DoStat
 * @typedef {{ type: 'While', cond: Expr, body: Stat[] } & Pos} WhileStat
 * @typedef {{ type: 'Repeat', body: Stat[], cond: Expr } & Pos} RepeatStat   `cond` can see the body's locals
 * @typedef {{ type: 'If', clauses: { cond: Expr, body: Stat[] }[], orelse: Stat[] | null } & Pos} IfStat
 * @typedef {{ type: 'NumericFor', var: LocalVar, start: Expr, limit: Expr, step: Expr | null, body: Stat[] } & Pos} NumericForStat
 * @typedef {{ type: 'GenericFor', vars: LocalVar[], exprs: Expr[], body: Stat[] } & Pos} GenericForStat
 * @typedef {{ type: 'Return', values: Expr[] } & Pos} ReturnStat
 * @typedef {{ type: 'Break' } & Pos} BreakStat
 * @typedef {{ type: 'Goto', label: string } & Pos} GotoStat
 * @typedef {{ type: 'Label', name: string } & Pos} LabelStat
 *
 * @typedef {LocalDeclStat | LocalFunctionStat | AssignStat | OpAssignStat | CallStat | DoStat | WhileStat | RepeatStat
 *   | IfStat | NumericForStat | GenericForStat | ReturnStat | BreakStat | GotoStat | LabelStat} Stat
 *
 * @typedef {Object} Chunk
 * @property {'Chunk'} type
 * @property {Stat[]} body
 * @property {number} localCount   Number of locals declared (ids are below this)
 */

export {}
