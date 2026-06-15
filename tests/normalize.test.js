// ============================================================
//  normalize.test.js -- Tests for js/normalize.js
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { normalizeBlock, normalizeArrow, normalizeCanvas } from '../js/normalize.js'

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

  it('coerces question entries to strings', () => {
    const b = normalizeBlock({ id: 'a', type: 'goal', questions: ['q', 7] })
    assert.deepEq(b.questions, ['q', '7'])
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
