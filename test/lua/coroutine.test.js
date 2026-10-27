import { describe, expect, it } from 'vitest'
import { compile } from '../../src/lua/compile.js'
import { LuaError } from '../../src/lua/errors.js'

/** Runs a program and returns what it returns, as a list. @param {string} src @param {Parameters<typeof compile>[1]} [options] */
const run = (src, options) => {
  const r = compile(src, options).run()
  return Array.isArray(r) ? r : r === undefined ? [] : [r]
}

/** @param {() => any} f */
const thrown = (f) => {
  try {
    f()
  } catch (e) {
    return /** @type {any} */ (e)
  }
  throw new Error('expected an error')
}

describe('basics', () => {
  it('runs a body in steps, passing values both ways', () => {
    expect(
      run(`
        local co = cocreate(function(a, b)
          local c = yield(a + b)
          local d, e = yield(c * 2)
          return d + e
        end)
        local _, x = coresume(co, 1, 2)
        local _, y = coresume(co, 10)
        local ok, z = coresume(co, 3, 4)
        return x, y, z, ok
      `),
    ).toEqual([3, 20, 7, true])
  })

  it('returns all the values of a yield and of the final return', () => {
    expect(
      run(`
        local co = cocreate(function() yield(1, 2, 3) return 4, 5 end)
        local a = {coresume(co)}
        local b = {coresume(co)}
        return #a, a[4], #b, b[3]
      `),
    ).toEqual([4, 3, 3, 5])
  })

  it('reports the status', () => {
    expect(
      run(`
        local seen = {}
        local co
        co = cocreate(function() add(seen, costatus(co)) yield() end)
        local s0 = costatus(co)
        coresume(co)
        local s1 = costatus(co)
        coresume(co)
        return s0, seen[1], s1, costatus(co)
      `),
    ).toEqual(['suspended', 'running', 'suspended', 'dead'])
  })

  it('reports normal for a coroutine that resumed another', () => {
    expect(
      run(`
        local outer, inner, seen
        outer = cocreate(function() coresume(inner) yield() end)
        inner = cocreate(function() seen = costatus(outer) end)
        coresume(outer)
        return seen
      `),
    ).toEqual(['normal'])
  })

  it('cannot resume a dead or a running coroutine', () => {
    expect(
      run(`
        local co
        co = cocreate(function() return coresume(co) end)
        local _, ok, msg = coresume(co)
        local ok2, msg2 = coresume(co)
        return ok, msg, ok2, msg2
      `),
    ).toEqual([false, 'cannot resume non-suspended coroutine', false, 'cannot resume dead coroutine'])
  })

  it('is a thread', () => {
    expect(run(`return type(cocreate(function() end))`)).toEqual(['thread'])
  })

  it('runs a function that never yields to the end on the first resume', () => {
    expect(run(`local co = cocreate(function(x) return x + 1 end) return coresume(co, 4)`)).toEqual([true, 5])
  })

  it('checks its arguments', () => {
    expect(thrown(() => run(`cocreate(1)`)).value).toMatch(/bad argument #1 to 'cocreate'/)
    expect(thrown(() => run(`coresume(1)`)).value).toMatch(/bad argument #1 to 'coresume'/)
    expect(thrown(() => run(`costatus()`)).value).toMatch(/bad argument #1 to 'costatus'/)
  })
})

describe('yielding from nested code', () => {
  it('yields from a helper function', () => {
    expect(
      run(`
        function wait(n) for i = 1, n do yield() end end
        local resumes, after = 0, false
        local co = cocreate(function() wait(3) after = true end)
        while costatus(co) ~= 'dead' do coresume(co) resumes += 1 end
        return resumes, after
      `),
    ).toEqual([4, true])
  })

  it('yields inside every kind of loop', () => {
    expect(
      run(`
        local out = {}
        local co = cocreate(function()
          for i = 1, 2 do yield('for', i) end
          local n = 0
          while n < 2 do n += 1 yield('while', n) end
          repeat n -= 1 yield('repeat', n) until n == 0
          for v in all({'a', 'b'}) do yield('all', v) end
          for k, v in pairs({x = 1}) do yield('pairs', k, v) end
        end)
        while true do
          local r = {coresume(co)}
          if costatus(co) == 'dead' then break end
          add(out, r[2] .. ':' .. tostr(r[3]) .. (r[4] and ':' .. tostr(r[4]) or ''))
        end
        return out[1], out[2], out[3], out[4], out[5], out[6], out[7], out[8], out[9], #out
      `),
    ).toEqual(['for:1', 'for:2', 'while:1', 'while:2', 'repeat:1', 'repeat:0', 'all:a', 'all:b', 'pairs:x:1', 9])
  })

  it('keeps locals and upvalues across yields', () => {
    expect(
      run(`
        local total = 0
        local function counter()
          local n = 0
          return function() n += 1 total += n yield(n) end
        end
        local co = cocreate(function()
          local tick = counter()
          tick() tick() tick()
        end)
        while costatus(co) ~= 'dead' do coresume(co) end
        return total
      `),
    ).toEqual([6])
  })

  it('yields from recursion', () => {
    expect(
      run(`
        local function walk(n) if n > 0 then yield(n) walk(n - 1) end end
        local co = cocreate(function() walk(3) end)
        local _, x = coresume(co)
        local _, y = coresume(co)
        local _, z = coresume(co)
        coresume(co)
        return x, y, z, costatus(co)
      `),
    ).toEqual([3, 2, 1, 'dead'])
  })

  it('yields from a method and from a function in a table', () => {
    expect(
      run(`
        local obj = {n = 0}
        function obj:step() self.n += 1 yield(self.n) end
        obj.run = function(self) self:step() self:step() end
        local co = cocreate(function() obj:run() end)
        local _, a = coresume(co)
        local _, b = coresume(co)
        return a, b
      `),
    ).toEqual([1, 2])
  })

  it('yields from a function passed as a parameter', () => {
    expect(
      run(`
        local function twice(f) f() f() end
        local co = cocreate(function() twice(function() yield(7) end) end)
        local _, a = coresume(co)
        local _, b = coresume(co)
        coresume(co)
        return a, b, costatus(co)
      `),
    ).toEqual([7, 7, 'dead'])
  })

  it('yields in the middle of an expression', () => {
    expect(
      run(`
        local function f(a, b, c) return a * 100 + b * 10 + c end
        local co = cocreate(function() return f(1, yield('x'), yield('y')) end)
        coresume(co)
        coresume(co, 2)
        return coresume(co, 3)
      `),
    ).toEqual([true, 123])
  })

  it('spreads multiple results into arguments and tables', () => {
    expect(
      run(`
        local function two() return 1, 2 end
        local function sum(...) local t = {...} return #t end
        local co = cocreate(function()
          yield()
          return sum(two()), #{two()}, sum(0, two())
        end)
        coresume(co)
        return coresume(co)
      `),
    ).toEqual([true, 2, 2, 3])
  })

  it('passes varargs through', () => {
    expect(
      run(`
        local function pack(...) yield() return ... end
        local co = cocreate(function(...) return pack(...) end)
        coresume(co, 1, 2, 3)
        return coresume(co)
      `),
    ).toEqual([true, 1, 2, 3])
  })

  it('works with goto', () => {
    expect(
      run(`
        local co = cocreate(function()
          local i = 0
          ::top::
          i += 1
          yield(i)
          if i < 3 then goto top end
          return 'done'
        end)
        local _, a = coresume(co)
        local _, b = coresume(co)
        local _, c = coresume(co)
        local _, d = coresume(co)
        return a, b, c, d
      `),
    ).toEqual([1, 2, 3, 'done'])
  })

  it('works through foreach', () => {
    expect(
      run(`
        local seen = 0
        local co = cocreate(function()
          foreach({10, 20, 30}, function(v) seen += v yield(v) end)
          return 'end'
        end)
        local _, a = coresume(co)
        local _, b = coresume(co)
        local _, c = coresume(co)
        local _, d = coresume(co)
        return a, b, c, d, seen
      `),
    ).toEqual([10, 20, 30, 'end', 60])
  })

  it('works through a callable table', () => {
    expect(
      run(`
        local t = setmetatable({}, {__call = function(self, x) yield(x) return x + 1 end})
        local co = cocreate(function() return t(5) end)
        local _, a = coresume(co)
        local _, b = coresume(co)
        return a, b
      `),
    ).toEqual([5, 6])
  })

  it('works through a custom iterator', () => {
    expect(
      run(`
        local function iter(t, i)
          i += 1
          if t[i] then yield('step') return i, t[i] end
        end
        local sum = 0
        local co = cocreate(function()
          for i, v in iter, {4, 5, 6}, 0 do sum += v end
        end)
        local steps = 0
        while costatus(co) ~= 'dead' do coresume(co) steps += 1 end
        return sum, steps
      `),
    ).toEqual([15, 4])
  })

  it('lets coroutines create and resume others', () => {
    expect(
      run(`
        local function gen(n) return cocreate(function() for i = 1, n do yield(i) end end) end
        local co = cocreate(function()
          local g = gen(2)
          local _, a = coresume(g)
          yield(a)
          local _, b = coresume(g)
          yield(b)
        end)
        local _, x = coresume(co)
        local _, y = coresume(co)
        return x, y
      `),
    ).toEqual([1, 2])
  })

  it('can yield from several coroutines that share a function', () => {
    expect(
      run(`
        local function pulse(id) for i = 1, 2 do yield(id * 10 + i) end end
        local a = cocreate(function() pulse(1) end)
        local b = cocreate(function() pulse(2) end)
        local _, a1 = coresume(a)
        local _, b1 = coresume(b)
        local _, a2 = coresume(a)
        local _, b2 = coresume(b)
        return a1, b1, a2, b2
      `),
    ).toEqual([11, 21, 12, 22])
  })
})

describe('errors', () => {
  it('returns an error raised in the coroutine', () => {
    expect(
      run(`
        local co = cocreate(function() yield(1) local x = nil + 1 end)
        coresume(co)
        local ok, msg = coresume(co)
        return ok, msg, costatus(co)
      `),
    ).toEqual([false, "attempt to perform arithmetic on a nil value", 'dead'])
  })

  it('returns an error raised from a function the coroutine called', () => {
    expect(
      run(`
        local function boom() yield() assert(false, 'bad') end
        local co = cocreate(function() boom() end)
        coresume(co)
        return coresume(co)
      `),
    ).toEqual([false, 'bad'])
  })

  it('rethrows through assert', () => {
    const e = thrown(() => run(`local co = cocreate(function() yield() assert(false, 'oops') end) coresume(co) assert(coresume(co))`))
    expect(e).toBeInstanceOf(LuaError)
    expect(e.value).toBe('oops')
  })

  it('cannot yield outside a coroutine', () => {
    expect(thrown(() => run(`yield()`)).value).toBe('attempt to yield from outside a coroutine')
    expect(thrown(() => run(`local function f() yield() end f()`)).value).toBe('attempt to yield from outside a coroutine')
  })

  it('cannot yield across a metamethod', () => {
    expect(
      run(`
        local t = setmetatable({}, {__index = function() yield() return 1 end})
        local co = cocreate(function() return t.x end)
        return coresume(co)
      `),
    ).toEqual([false, 'attempt to yield across a C-call boundary'])
  })

  it('survives a stack overflow in a coroutine', () => {
    expect(
      run(`
        local function g() if false then yield() end return g() + 1 end
        local co = cocreate(function() return g() end)
        local ok, msg = coresume(co)
        return ok, msg
      `),
    ).toEqual([false, 'stack overflow'])
  })
})

describe('compiled code', () => {
  it('does not use generators in a program without yield', () => {
    const js = compile(`local function f(x) return x end function g() return f(1) end cocreate(g)`).js
    expect(js).not.toContain('function*')
    expect(js).not.toContain('yield*')
  })

  it('uses generators only for the functions that may yield', () => {
    const js = compile(`
      local function pure(x) return x + 1 end
      local function waiter() yield() end
      local function caller() waiter() end
      local function other() return pure(1) end
    `).js
    expect(js.match(/function\*/g)).toHaveLength(2) // waiter, caller
    expect(js).toContain('function* waiter$f')
    expect(js).toContain('function* caller$f')
    expect(js).not.toContain('function* pure$f')
    expect(js).not.toContain('function* other$f')
  })

  it('treats unknown callees as yielding once _ENV or _G is touched', () => {
    const js = compile(`
      function a() return 1 end
      function b() return a() end
      local g = _G
      yield()
    `).js
    expect(js).toContain('function* b$f')
  })

  it('maps errors to the Lua line', () => {
    const c = compile(`local co = cocreate(function()\n  yield()\n  error('x')\nend)\ncoresume(co)\nlocal t = nil\nreturn t.x`)
    expect(thrown(() => c.run()).line).toBe(7)
  })

  it('works with the float number model', () => {
    expect(run(`local co = cocreate(function(x) yield(x / 2) end) return coresume(co, 1)`, { model: 'float' })).toEqual([true, 0.5])
  })
})
