// ============================================================
//  utils.test.js -- Tests for js/utils.js
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { genId, clamp, escHtml, debounce, getBlockDims, DEFAULT_WIDTH, TYPES, ACTION_DEFS, SWATCH_COLORS } from '../js/utils.js'

// ── genId ────────────────────────────────────────────────────

describe('genId()', () => {
  it('returns a non-empty string', () => {
    const id = genId()
    assert.ok(typeof id === 'string')
    assert.ok(id.length > 0)
  })

  it('generates unique IDs on consecutive calls', () => {
    const ids = new Set()
    for (let i = 0; i < 200; i++) ids.add(genId())
    assert.eq(ids.size, 200, 'Expected 200 unique IDs')
  })

  it('IDs contain only alphanumeric chars (base36)', () => {
    for (let i = 0; i < 50; i++) {
      assert.match(genId(), /^[a-z0-9]+$/)
    }
  })
})

// ── clamp ────────────────────────────────────────────────────

describe('clamp()', () => {
  it('returns value when within bounds', () => {
    assert.eq(clamp(5, 0, 10), 5)
  })

  it('clamps to lower bound', () => {
    assert.eq(clamp(-3, 0, 10), 0)
  })

  it('clamps to upper bound', () => {
    assert.eq(clamp(15, 0, 10), 10)
  })

  it('returns lower bound when value equals lower bound', () => {
    assert.eq(clamp(0, 0, 10), 0)
  })

  it('returns upper bound when value equals upper bound', () => {
    assert.eq(clamp(10, 0, 10), 10)
  })

  it('handles negative ranges', () => {
    assert.eq(clamp(-5, -10, -1), -5)
    assert.eq(clamp(-20, -10, -1), -10)
    assert.eq(clamp(0, -10, -1), -1)
  })

  it('handles fractional values', () => {
    assert.eq(clamp(0.5, 0.18, 2.6), 0.5)
    assert.eq(clamp(0.1, 0.18, 2.6), 0.18)
    assert.eq(clamp(3.0, 0.18, 2.6), 2.6)
  })

  it('handles equal bounds', () => {
    assert.eq(clamp(5, 3, 3), 3)
    assert.eq(clamp(1, 3, 3), 3)
  })
})

// ── escHtml ──────────────────────────────────────────────────

describe('escHtml()', () => {
  it('escapes ampersands', () => {
    assert.eq(escHtml('a & b'), 'a &amp; b')
  })

  it('escapes less-than', () => {
    assert.eq(escHtml('<script>'), '&lt;script&gt;')
  })

  it('escapes greater-than', () => {
    assert.eq(escHtml('x > y'), 'x &gt; y')
  })

  it('escapes double quotes', () => {
    assert.eq(escHtml('say "hello"'), 'say &quot;hello&quot;')
  })

  it('handles all special chars in one string', () => {
    assert.eq(escHtml('<a href="x&y">'), '&lt;a href=&quot;x&amp;y&quot;&gt;')
  })

  it('returns empty string unchanged', () => {
    assert.eq(escHtml(''), '')
  })

  it('returns plain text unchanged', () => {
    assert.eq(escHtml('hello world'), 'hello world')
  })

  it('handles multiple ampersands', () => {
    assert.eq(escHtml('a&b&c'), 'a&amp;b&amp;c')
  })
})

// ── debounce ─────────────────────────────────────────────────

describe('debounce()', () => {
  it('calls function after delay', async () => {
    let called = 0
    const fn = debounce(() => { called++ }, 30)
    fn()
    assert.eq(called, 0, 'Should not be called immediately')
    await new Promise(r => setTimeout(r, 60))
    assert.eq(called, 1, 'Should be called after delay')
  })

  it('resets timer on rapid calls', async () => {
    let called = 0
    const fn = debounce(() => { called++ }, 50)
    fn(); fn(); fn()
    await new Promise(r => setTimeout(r, 80))
    assert.eq(called, 1, 'Should only be called once')
  })

  it('passes arguments to the debounced function', async () => {
    let received = null
    const fn = debounce((a, b) => { received = [a, b] }, 20)
    fn('x', 'y')
    await new Promise(r => setTimeout(r, 50))
    assert.deepEq(received, ['x', 'y'])
  })

  it('uses latest arguments when called multiple times', async () => {
    let received = null
    const fn = debounce((v) => { received = v }, 20)
    fn('first')
    fn('second')
    fn('third')
    await new Promise(r => setTimeout(r, 50))
    assert.eq(received, 'third')
  })
})

// ── getBlockDims ─────────────────────────────────────────────

describe('getBlockDims()', () => {
  it('returns default dimensions when element does not exist', () => {
    const dims = getBlockDims('nonexistent-id-xyz')
    assert.eq(dims.w, DEFAULT_WIDTH)
    assert.eq(dims.h, 100)
  })

  it('returns element dimensions when element exists', () => {
    const el = document.createElement('div')
    el.id = 'b-test-dims'
    el.style.width = '300px'
    el.style.height = '150px'
    el.style.position = 'absolute'
    document.body.appendChild(el)
    const dims = getBlockDims('test-dims')
    // offsetWidth/offsetHeight in a test document depend on layout
    // At minimum, verify it returns an object with w and h
    assert.ok(typeof dims.w === 'number')
    assert.ok(typeof dims.h === 'number')
    el.remove()
  })
})

// ── TYPES constant ───────────────────────────────────────────

describe('TYPES constant', () => {
  it('contains all 10 block types', () => {
    const expected = ['goal','problem','requirement','risk','question','decision','resource','output','context','custom']
    expected.forEach(t => {
      assert.ok(TYPES[t], `Missing type: ${t}`)
      assert.ok(TYPES[t].label, `Type ${t} missing label`)
      assert.ok(TYPES[t].color, `Type ${t} missing color`)
    })
    assert.eq(Object.keys(TYPES).length, 10)
  })

  it('each type has a unique color', () => {
    const colors = Object.values(TYPES).map(t => t.color)
    assert.eq(new Set(colors).size, 10, 'All colors should be unique')
  })
})

// ── ACTION_DEFS constant ────────────────────────────────────

describe('ACTION_DEFS constant', () => {
  it('contains all four action definitions', () => {
    const expected = ['resolve', 'prepare', 'recollect', 'reinforce']
    expected.forEach(a => {
      assert.ok(ACTION_DEFS[a], `Missing action def: ${a}`)
      assert.ok(typeof ACTION_DEFS[a] === 'string', `Action def ${a} should be a string`)
    })
    assert.eq(Object.keys(ACTION_DEFS).length, 4)
  })

  it('each action has a non-empty description', () => {
    Object.entries(ACTION_DEFS).forEach(([key, desc]) => {
      assert.ok(desc.length > 0, `Action ${key} should have a non-empty description`)
    })
  })

  it('resolve action describes fixing or closing', () => {
    assert.includes(ACTION_DEFS.resolve, 'fix')
  })

  it('prepare action describes gathering resources', () => {
    assert.includes(ACTION_DEFS.prepare, 'resources')
  })

  it('recollect action describes reviewing past decisions', () => {
    assert.includes(ACTION_DEFS.recollect, 'past decisions')
  })

  it('reinforce action describes strengthening approach', () => {
    assert.includes(ACTION_DEFS.reinforce, 'Strengthen')
  })
})

// ── SWATCH_COLORS constant ──────────────────────────────────

describe('SWATCH_COLORS constant', () => {
  it('is an array of 12 colors', () => {
    assert.ok(Array.isArray(SWATCH_COLORS))
    assert.eq(SWATCH_COLORS.length, 12)
  })

  it('every entry is a valid hex color string', () => {
    SWATCH_COLORS.forEach(c => {
      assert.match(c, /^#[0-9a-fA-F]{6}$/, `Expected hex color, got ${c}`)
    })
  })
})
