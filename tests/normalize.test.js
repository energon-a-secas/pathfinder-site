// ============================================================
//  normalize.test.js -- Tests for js/normalize.js
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { normalizeBlock, normalizeArrow, normalizeCanvas, normalizeSituation } from '../js/normalize.js'

// ── normalizeBlock ───────────────────────────────────────────

describe('normalizeBlock()', () => {
  it('drops a block with no id', () => {
    assert.eq(normalizeBlock({ type: 'goal', title: 'x' }), null)
  })

  it('drops a block with an unknown type', () => {
    assert.eq(normalizeBlock({ id: 'a', type: 'not-real' }), null)
  })

  it('drops non-object input', () => {
    assert.eq(normalizeBlock(null), null)
    assert.eq(normalizeBlock('nope'), null)
  })

  it('coerces a numeric title to a string', () => {
    assert.eq(normalizeBlock({ id: 'a', type: 'goal', title: 42 }).title, '42')
  })

  it('defaults missing actions/questions to empty arrays', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal' })
    assert.deepEq(b.actions, [])
    assert.deepEq(b.questions, [])
  })

  it('filters invalid action names', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', actions: ['resolve', 'bogus', 'prepare'] })
    assert.deepEq(b.actions, ['resolve', 'prepare'])
  })

  it('dedupes repeated actions', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', actions: ['resolve', 'resolve'] })
    assert.deepEq(b.actions, ['resolve'])
  })

  it('coerces legacy string questions into { text } objects', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', questions: ['q'] })
    assert.deepEq(b.questions, [{ text: 'q' }])
  })

  it('drops question entries that are neither a string nor an object', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', questions: ['q', 7, null] })
    assert.deepEq(b.questions, [{ text: 'q' }])
  })

  it('keeps a stored answer on a question', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', questions: [{ text: 'q', answer: 'a' }] })
    assert.deepEq(b.questions, [{ text: 'q', answer: 'a' }])
  })

  it('repairs non-finite coordinates to 0', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', x: 'NaNxx', y: undefined })
    assert.eq(b.x, 0)
    assert.eq(b.y, 0)
  })

  it('keeps finite coordinates', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', x: 120, y: -40 })
    assert.eq(b.x, 120)
    assert.eq(b.y, -40)
  })

  it('rejects an invalid hex color (falls back to null)', () => {
    assert.eq(normalizeBlock({ id: 'a', type: 'goal', color: 'red' }).color, null)
    assert.eq(normalizeBlock({ id: 'a', type: 'goal', color: '#ff8800' }).color, '#ff8800')
  })

  it('drops invalid status and priority', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', status: 'made-up', priority: 'urgent' })
    assert.eq(b.status, null)
    assert.eq(b.priority, null)
  })

  it('keeps valid status and priority', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', status: 'done', priority: 'high' })
    assert.eq(b.status, 'done')
    assert.eq(b.priority, 'high')
  })
})

// ── normalizeArrow ───────────────────────────────────────────

describe('normalizeArrow()', () => {
  it('drops an arrow missing an endpoint', () => {
    assert.eq(normalizeArrow({ from: 'a' }), null)
  })

  it('drops a self-referential arrow', () => {
    assert.eq(normalizeArrow({ from: 'a', to: 'a' }), null)
  })

  it('defaults style to curved and weight to 2', () => {
    const a = normalizeArrow({ from: 'a', to: 'b' })
    assert.eq(a.style, 'curved')
    assert.eq(a.weight, 2)
  })

  it('rejects an invalid style', () => {
    assert.eq(normalizeArrow({ from: 'a', to: 'b', style: 'zigzag' }).style, 'curved')
  })

  it('preserves a note string when present', () => {
    assert.eq(normalizeArrow({ from: 'a', to: 'b', note: 'only if approved' }).note, 'only if approved')
  })

  it('leaves note undefined when absent', () => {
    assert.eq(normalizeArrow({ from: 'a', to: 'b' }).note, undefined)
  })

  it('coerces a non-string note to a string', () => {
    assert.eq(normalizeArrow({ from: 'a', to: 'b', note: 7 }).note, '7')
  })
})

// ── flow node types survive normalization ────────────────────

describe('normalizeBlock() -- flow types', () => {
  it('accepts a process block', () => {
    const b = normalizeBlock({ id: 'p', type: 'process', title: 'Update status' })
    assert.ok(b)
    assert.eq(b.type, 'process')
  })

  it('accepts a terminator block', () => {
    const b = normalizeBlock({ id: 't', type: 'terminator', title: 'Done' })
    assert.ok(b)
    assert.eq(b.type, 'terminator')
  })
})

// ── normalizeCanvas ──────────────────────────────────────────

describe('normalizeCanvas()', () => {
  it('returns an empty canvas for garbage input', () => {
    const r = normalizeCanvas(null)
    assert.deepEq(r.blocks, {})
    assert.deepEq(r.arrows, [])
  })

  it('accepts blocks as an array or an id-keyed map', () => {
    const asArray = normalizeCanvas({ blocks: [{ id: 'a', type: 'goal' }] })
    const asMap   = normalizeCanvas({ blocks: { a: { id: 'a', type: 'goal' } } })
    assert.eq(Object.keys(asArray.blocks).length, 1)
    assert.eq(Object.keys(asMap.blocks).length, 1)
  })

  it('counts dropped blocks', () => {
    const r = normalizeCanvas({ blocks: [
      { id: 'a', type: 'goal' },
      { type: 'goal' },          // no id
      { id: 'c', type: 'bad' },  // bad type
    ]})
    assert.eq(Object.keys(r.blocks).length, 1)
    assert.eq(r.dropped.blocks, 2)
  })

  it('clears groupId references to dropped groups', () => {
    const r = normalizeCanvas({
      blocks: [{ id: 'a', type: 'goal', groupId: 'ghost' }],
      groups: {},
    })
    assert.eq(r.blocks.a.groupId, null)
  })

  it('preserves a valid groupId when its group survives', () => {
    const r = normalizeCanvas({
      blocks: [{ id: 'a', type: 'goal', groupId: 'g1' }],
      groups: { g1: { id: 'g1', label: 'G' } },
    })
    assert.eq(r.blocks.a.groupId, 'g1')
  })

  it('coerces meta.title to a string', () => {
    assert.eq(normalizeCanvas({ meta: { title: 9 } }).meta.title, '9')
  })
})

// ── Appearance fields ────────────────────────────────────────

describe('normalizeBlock() -- appearance', () => {
  it('defaults a block with no appearance set to inherit', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal' })
    assert.eq(b.cardStyle, null)
    assert.eq(b.borderWidth, null)
  })

  it('keeps a known card style', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', cardStyle: 'header' })
    assert.eq(b.cardStyle, 'header')
  })

  it('drops an unknown card style back to inherit', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', cardStyle: 'neon' })
    assert.eq(b.cardStyle, null)
  })

  it('only accepts border widths from the offered set', () => {
    assert.eq(normalizeBlock({ id: 'a', type: 'goal', borderWidth: 2 }).borderWidth, 2)
    assert.eq(normalizeBlock({ id: 'a', type: 'goal', borderWidth: 47 }).borderWidth, null)
  })
})

describe('normalizeCanvas() -- card style default', () => {
  it('gives an old canvas the outline default', () => {
    const c = normalizeCanvas({ blocks: [], arrows: [], meta: { title: 'x' } })
    assert.eq(c.meta.cardStyle, 'outline')
  })

  it('round-trips a chosen default', () => {
    const c = normalizeCanvas({ blocks: [], arrows: [], meta: { title: 'x', cardStyle: 'tint' } })
    assert.eq(c.meta.cardStyle, 'tint')
  })

  it('rejects a card style it does not know', () => {
    const c = normalizeCanvas({ blocks: [], arrows: [], meta: { cardStyle: 'chrome' } })
    assert.eq(c.meta.cardStyle, 'outline')
  })
})

describe('normalizeArrow() -- routed style', () => {
  it('accepts the routed style', () => {
    assert.eq(normalizeArrow({ from: 'a', to: 'b', style: 'routed' }).style, 'routed')
  })
})

// ── Situation ────────────────────────────────────────────────

describe('normalizeSituation()', () => {
  it('falls back to the default for a missing situation', () => {
    const sit = normalizeSituation(undefined)
    assert.eq(sit.codebase, 'none')
    assert.eq(sit.runtime, 'chat')
    assert.eq(sit.firstMove, 'plan')
  })

  it('keeps every recognised choice', () => {
    const sit = normalizeSituation({ codebase: 'current', runtime: 'code', firstMove: 'read' })
    assert.eq(sit.codebase, 'current')
    assert.eq(sit.runtime, 'code')
    assert.eq(sit.firstMove, 'read')
  })

  it('replaces an unknown choice rather than dropping the field', () => {
    // A missing situation is worse than a conservative one: the prompt would
    // simply stop saying where things stand.
    const sit = normalizeSituation({ codebase: 'quantum', runtime: 'code' })
    assert.eq(sit.codebase, 'none')
    assert.eq(sit.runtime, 'code')
  })

  it('carries the free-text fields', () => {
    const sit = normalizeSituation({ repoHint: 'org/repo', constraints: 'No new deps' })
    assert.eq(sit.repoHint, 'org/repo')
    assert.eq(sit.constraints, 'No new deps')
  })

  it('caps free text so a pasted document cannot become the prompt', () => {
    const sit = normalizeSituation({ repoHint: 'x'.repeat(900), constraints: 'y'.repeat(5000) })
    assert.eq(sit.repoHint.length, 300)
    assert.eq(sit.constraints.length, 1000)
  })
})

describe('normalizeCanvas() -- situation round-trip', () => {
  it('gives a canvas with no situation the default', () => {
    const c = normalizeCanvas({ blocks: [], arrows: [], meta: { title: 'x' } })
    assert.eq(c.meta.situation.codebase, 'none')
  })

  it('round-trips a full situation', () => {
    const c = normalizeCanvas({ blocks: [], arrows: [], meta: {
      situation: { codebase: 'current', runtime: 'code', firstMove: 'read', repoHint: 'r', constraints: 'c' } } })
    assert.eq(c.meta.situation.codebase, 'current')
    assert.eq(c.meta.situation.runtime, 'code')
    assert.eq(c.meta.situation.repoHint, 'r')
  })
})
