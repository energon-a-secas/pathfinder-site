// ============================================================
//  test-utils.js -- Lightweight test runner and assert helpers
//  No dependencies. Runs in any modern browser.
// ============================================================

const suites  = []
let current   = null

// ── Public API ───────────────────────────────────────────────

export function describe(name, fn) {
  const suite = { name, tests: [], passed: 0, failed: 0, errors: [] }
  suites.push(suite)
  current = suite
  fn()
  current = null
}

export function it(name, fn) {
  if (!current) throw new Error('it() must be called inside describe()')
  current.tests.push({ name, fn })
}

export const assert = {
  ok(val, msg) {
    if (!val) throw new Error(msg || `Expected truthy, got ${JSON.stringify(val)}`)
  },
  eq(actual, expected, msg) {
    if (!Object.is(actual, expected)) {
      throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  },
  deepEq(actual, expected, msg) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected)
    if (a !== b) throw new Error(msg || `Deep equality failed.\n  Expected: ${b}\n  Actual:   ${a}`)
  },
  neq(actual, notExpected, msg) {
    if (Object.is(actual, notExpected)) {
      throw new Error(msg || `Expected value to differ from ${JSON.stringify(notExpected)}`)
    }
  },
  throws(fn, msg) {
    let threw = false
    try { fn() } catch (_) { threw = true }
    if (!threw) throw new Error(msg || 'Expected function to throw')
  },
  match(str, regex, msg) {
    if (!regex.test(str)) throw new Error(msg || `Expected "${str}" to match ${regex}`)
  },
  includes(str, sub, msg) {
    if (typeof str === 'string') {
      if (!str.includes(sub)) throw new Error(msg || `Expected string to include "${sub}"`)
    } else if (Array.isArray(str)) {
      if (!str.includes(sub)) throw new Error(msg || `Expected array to include ${JSON.stringify(sub)}`)
    } else {
      throw new Error('assert.includes expects a string or array')
    }
  },
  notIncludes(str, sub, msg) {
    if (typeof str === 'string' && str.includes(sub)) {
      throw new Error(msg || `Expected string NOT to include "${sub}"`)
    }
  },
  gt(a, b, msg) {
    if (!(a > b)) throw new Error(msg || `Expected ${a} > ${b}`)
  },
  gte(a, b, msg) {
    if (!(a >= b)) throw new Error(msg || `Expected ${a} >= ${b}`)
  },
  lt(a, b, msg) {
    if (!(a < b)) throw new Error(msg || `Expected ${a} < ${b}`)
  },
}

// ── Runner ───────────────────────────────────────────────────

export async function runAll() {
  let totalPassed = 0, totalFailed = 0

  for (const suite of suites) {
    for (const test of suite.tests) {
      try {
        const result = test.fn()
        if (result instanceof Promise) await result
        suite.passed++
        totalPassed++
      } catch (err) {
        suite.failed++
        totalFailed++
        suite.errors.push({ test: test.name, error: err.message || String(err) })
      }
    }
  }

  return { suites, totalPassed, totalFailed }
}

// ── HTML reporter ────────────────────────────────────────────

export function renderReport(container, results) {
  const { suites, totalPassed, totalFailed } = results
  const total = totalPassed + totalFailed
  const allGreen = totalFailed === 0

  let html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:720px;margin:40px auto;padding:0 20px">
      <h1 style="font-size:1.4em;margin-bottom:4px">Pathfinder Test Suite</h1>
      <div style="font-size:0.95em;margin-bottom:24px;color:${allGreen ? '#34d399' : '#f87171'}">
        ${totalPassed}/${total} passed${totalFailed ? ` &mdash; ${totalFailed} failed` : ''}
      </div>`

  for (const suite of suites) {
    const color = suite.failed ? '#f87171' : '#34d399'
    html += `
      <div style="margin-bottom:20px;border:1px solid rgba(255,255,255,.08);border-radius:8px;overflow:hidden">
        <div style="padding:10px 14px;background:rgba(255,255,255,.04);font-weight:600;display:flex;justify-content:space-between">
          <span>${esc(suite.name)}</span>
          <span style="color:${color}">${suite.passed}/${suite.tests.length}</span>
        </div>`

    if (suite.errors.length) {
      html += '<div style="padding:8px 14px;background:rgba(248,113,113,.06)">'
      for (const e of suite.errors) {
        html += `<div style="margin-bottom:6px">
          <span style="color:#f87171;font-weight:600">FAIL</span>
          <span style="margin-left:8px">${esc(e.test)}</span>
          <pre style="margin:4px 0 0 24px;font-size:0.85em;color:#fb923c;white-space:pre-wrap">${esc(e.error)}</pre>
        </div>`
      }
      html += '</div>'
    }

    html += '</div>'
  }

  html += '</div>'
  container.innerHTML = html
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// ── DOM mock helpers ─────────────────────────────────────────

/** Create a minimal mock element with classList, insert into document */
export function mockBlockEl(id, opts = {}) {
  let el = document.getElementById('b-' + id)
  if (!el) {
    el = document.createElement('div')
    el.id = 'b-' + id
    document.body.appendChild(el)
  }
  if (opts.width)  el.style.width  = opts.width + 'px'
  if (opts.height) el.style.height = opts.height + 'px'
  return el
}

/** Remove all mock block elements from the document */
export function cleanupMockEls() {
  document.querySelectorAll('[id^="b-"]').forEach(el => el.remove())
  document.querySelectorAll('[id^="gi-"]').forEach(el => el.remove())
}

/** Create a mock gap-icon container for a block */
export function mockGapIconEl(id) {
  let el = document.getElementById('gi-' + id)
  if (!el) {
    el = document.createElement('div')
    el.id = 'gi-' + id
    document.body.appendChild(el)
  }
  return el
}

/** Mock localStorage with an in-memory store */
export function mockLocalStorage() {
  const store = {}
  return {
    getItem(k)    { return store[k] ?? null },
    setItem(k, v) { store[k] = String(v) },
    removeItem(k) { delete store[k] },
    clear()       { Object.keys(store).forEach(k => delete store[k]) },
    get _store()  { return store },
  }
}
