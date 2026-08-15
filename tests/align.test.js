// ============================================================
//  align.test.js -- Tests for js/align.js
// ============================================================

import { describe, it, assert, mockBlockEl, cleanupMockEls } from './test-utils.js'
import { state } from '../js/state.js'
import { findGuides, alignSelection, distributeSelection, SNAP_TOLERANCE } from '../js/align.js'

function reset() {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
}

function addBlock(id, x, y, w = 220, h = 100) {
  state.blocks[id] = {
    id, type: 'goal', title: id, description: '', notes: '',
    x, y, actions: [], questions: [], docRef: null,
    width: w, color: null, collapsed: false, groupId: null, status: null, priority: null,
    cardStyle: null, borderWidth: null,
  }
  mockBlockEl(id, { width: w, height: h })
}

const box = (l, t, r, b) => ({ l, t, r, b, cx: (l + r) / 2, cy: (t + b) / 2 })

describe('findGuides()', () => {
  it('reports no nudge when nothing is near', () => {
    const g = findGuides(box(0, 0, 100, 100), [box(500, 500, 600, 600)])
    assert.eq(g.dx, 0); assert.eq(g.dy, 0)
    assert.eq(g.vx.length, 0); assert.eq(g.hy.length, 0)
  })

  it('snaps a near-miss left edge and reports the line', () => {
    const g = findGuides(box(100, 0, 300, 100), [box(104, 400, 304, 500)])
    assert.eq(g.dx, 4)
    assert.deepEq(g.vx, [104])
  })

  it('snaps centres as well as edges', () => {
    // Moving centre 200, static centre 203: a 3px pull onto the centre line.
    const g = findGuides(box(100, 0, 300, 100), [box(163, 400, 243, 500)])
    assert.eq(g.dx, 3)
  })

  it('ignores anything past the tolerance', () => {
    const g = findGuides(box(100, 0, 300, 100), [box(100 + SNAP_TOLERANCE + 1, 400, 300, 500)])
    assert.eq(g.dx, 0)
  })

  it('takes the closest of several candidates', () => {
    const g = findGuides(box(100, 0, 300, 100), [box(105, 400, 305, 500), box(102, 600, 302, 700)])
    assert.eq(g.dx, 2)
  })

  it('snaps both axes at once', () => {
    const g = findGuides(box(100, 100, 300, 200), [box(103, 104, 303, 204)])
    assert.eq(g.dx, 3); assert.eq(g.dy, 4)
  })
})

describe('alignSelection()', () => {
  it('aligns left edges', () => {
    reset(); addBlock('a', 100, 0); addBlock('b', 160, 200); addBlock('c', 220, 400)
    assert.eq(alignSelection(['a', 'b', 'c'], 'left'), 3)
    assert.eq(state.blocks.a.x, 100)
    assert.eq(state.blocks.b.x, 100)
    assert.eq(state.blocks.c.x, 100)
  })

  it('aligns right edges using each block width', () => {
    reset(); addBlock('a', 100, 0, 220); addBlock('b', 160, 200, 100)
    alignSelection(['a', 'b'], 'right')
    assert.eq(state.blocks.a.x + 220, state.blocks.b.x + 100)
  })

  it('aligns vertical centres', () => {
    reset(); addBlock('a', 0, 100, 220, 100); addBlock('b', 400, 300, 220, 60)
    alignSelection(['a', 'b'], 'vcenter')
    assert.eq(state.blocks.a.y + 50, state.blocks.b.y + 30)
  })

  it('refuses a selection of one', () => {
    reset(); addBlock('a', 100, 0)
    assert.eq(alignSelection(['a'], 'left'), 0)
    assert.eq(state.blocks.a.x, 100)
  })

  it('ignores an unknown mode', () => {
    reset(); addBlock('a', 100, 0); addBlock('b', 160, 200)
    assert.eq(alignSelection(['a', 'b'], 'diagonally'), 0)
  })
})

describe('distributeSelection()', () => {
  it('equalises vertical gaps', () => {
    reset()
    addBlock('a', 0, 0, 220, 100)
    addBlock('b', 0, 40, 220, 100)
    addBlock('c', 0, 600, 220, 100)
    assert.eq(distributeSelection(['a', 'b', 'c'], 'v'), 3)
    const gap1 = state.blocks.b.y - (state.blocks.a.y + 100)
    const gap2 = state.blocks.c.y - (state.blocks.b.y + 100)
    assert.ok(Math.abs(gap1 - gap2) <= 1, `gaps should match, got ${gap1} and ${gap2}`)
  })

  it('leaves the outermost blocks where they are', () => {
    reset()
    addBlock('a', 0, 0); addBlock('b', 100, 0); addBlock('c', 900, 0)
    distributeSelection(['a', 'b', 'c'], 'h')
    assert.eq(state.blocks.a.x, 0)
    assert.eq(state.blocks.c.x, 900)
  })

  it('needs three blocks to mean anything', () => {
    reset(); addBlock('a', 0, 0); addBlock('b', 500, 0)
    assert.eq(distributeSelection(['a', 'b'], 'h'), 0)
  })
})
