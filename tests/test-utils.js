// ============================================================
//  test-utils.js -- Lightweight test runner and assert helpers
//  No dependencies. Runs in any modern browser.
// ============================================================

const suites  = []
let current   = null

// Test frames sit on screen, invisible and inert: WebKit never runs
// requestAnimationFrame in a frame parked off screen, and the suite hung.
// Every helper that builds an iframe places it with this.
export const ONSCREEN = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;border:0'

// Markup copied from a page at the site root into a test frame, whose base
// is tests/: relative image sources point back at the root, or every frame
// that copies the header asked for tests/energon-classic-logo.png (a 404 in
// every engine's console).
export function fromSiteRoot(html) {
  return String(html).replace(/\b(src)="(?![a-z]+:|\/|\.\.\/|#|data:)([^"]+)"/gi, '$1="../$2"')
}

// One test that never settles must not stall the report: after this long
// it is recorded as a failure and the run moves on.
export const TEST_TIMEOUT_MS = 15000

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
        if (result instanceof Promise) {
          let timer
          const limit = new Promise((_, rej) => {
            timer = setTimeout(() => rej(new Error(`TIMEOUT after ${TEST_TIMEOUT_MS}ms`)), TEST_TIMEOUT_MS)
          })
          try { await Promise.race([result, limit]) } finally { clearTimeout(timer) }
        }
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

// ── Colour ───────────────────────────────────────────────────

// Any colour getComputedStyle can return, as [r, g, b, a]: r, g, b in sRGB
// 0-255 (rounded), a in 0-1. The design tokens are OKLCH, so a computed
// colour is often oklch() or oklab() (color-mix in oklab) rather than rgb(),
// and a contrast check has to read every form. null when it is not a colour.
export function cssRgba(input) {
  const s = String(input ?? '').trim().toLowerCase()
  if (!s) return null
  if (s === 'transparent') return [0, 0, 0, 0]
  const num = (v, pct = 1) => (v === 'none' ? 0 : v.endsWith('%') ? (parseFloat(v) / 100) * pct : parseFloat(v))
  const split = inner => {
    const [main, alpha] = inner.split('/')
    return { c: main.trim().split(/[\s,]+/).filter(Boolean), a: alpha == null ? null : num(alpha.trim()) }
  }
  const enc = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)
  const fromLinear = (lin, a) => [...lin.map(c => Math.round(Math.min(1, Math.max(0, enc(Math.min(1, Math.max(0, c))))) * 255)), a]
  const fromOklab = (L, A, B, a) => {
    const l_ = L + 0.3963377774 * A + 0.2158037573 * B
    const m_ = L - 0.1055613458 * A - 0.0638541728 * B
    const s_ = L - 0.0894841775 * A - 1.2914855480 * B
    const l = l_ ** 3, m = m_ ** 3, q = s_ ** 3
    return fromLinear([
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * q,
    ], a)
  }
  let m = /^#([0-9a-f]{3,8})$/.exec(s)
  if (m) {
    const h = m[1].length <= 4 ? [...m[1]].map(c => c + c).join('') : m[1]
    const v = [0, 2, 4, 6].map(i => parseInt(h.slice(i, i + 2) || 'ff', 16))
    return [v[0], v[1], v[2], v[3] / 255]
  }
  if ((m = /^rgba?\((.*)\)$/.exec(s))) {
    const t = split(m[1])
    const c = t.c.slice(0, 3).map(v => (v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v)))
    const a = t.a ?? (t.c[3] != null ? num(t.c[3]) : 1)
    return [...c.map(Math.round), a]
  }
  if ((m = /^color\(srgb (.*)\)$/.exec(s))) {
    const t = split(m[1])
    return [...t.c.slice(0, 3).map(v => Math.round(num(v) * 255)), t.a ?? 1]
  }
  if ((m = /^oklab\((.*)\)$/.exec(s))) {
    const t = split(m[1])
    return fromOklab(num(t.c[0]), num(t.c[1], 0.4), num(t.c[2], 0.4), t.a ?? 1)
  }
  if ((m = /^oklch\((.*)\)$/.exec(s))) {
    const t = split(m[1])
    const L = num(t.c[0]), C = num(t.c[1], 0.4), h = (num(t.c[2]) * Math.PI) / 180
    return fromOklab(L, C * Math.cos(h), C * Math.sin(h), t.a ?? 1)
  }
  return null
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
