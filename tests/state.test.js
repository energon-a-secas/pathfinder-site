// ============================================================
//  state.test.js -- Tests for js/state.js
// ============================================================

import { describe, it, assert, mockLocalStorage } from './test-utils.js'
import {
  state, view, ui, canvasMeta, devOpts, selection,
  snapshot, getUndoHistory, getRedoFuture,
  saveState, loadState,
  snap, toWorld, encodeCanvas
} from '../js/state.js'

// Helper: reset state to a known baseline
function resetState() {
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  view.panX = 0; view.panY = 0; view.zoom = 1
  canvasMeta.title = ''
  selection.blockId = null
  selection.arrowId = null
  selection.ids.clear()
  selection.groupId = null
  // Clear undo/redo
  getUndoHistory().length = 0
  getRedoFuture().length = 0
}

// ── snapshot / undo history ──────────────────────────────────

describe('snapshot() / undo history', () => {
  it('pushes a snapshot onto the undo history', () => {
    resetState()
    state.blocks = { a: { id: 'a', type: 'goal', title: 'Test' } }
    snapshot()
    assert.eq(getUndoHistory().length, 1)
  })

  it('snapshot captures blocks, arrows, and groups', () => {
    resetState()
    state.blocks = { b1: { id: 'b1', type: 'goal', title: 'G1' } }
    state.arrows = [{ id: 'a1', from: 'b1', to: 'b2' }]
    state.groups = { g1: { id: 'g1', label: 'Group' } }
    snapshot()
    const saved = JSON.parse(getUndoHistory()[0])
    assert.ok(saved.blocks.b1)
    assert.eq(saved.arrows.length, 1)
    assert.ok(saved.groups.g1)
  })

  it('clears redo future on snapshot', () => {
    resetState()
    getRedoFuture().push('dummy')
    assert.eq(getRedoFuture().length, 1)
    snapshot()
    assert.eq(getRedoFuture().length, 0)
  })

  it('limits history to 50 entries', () => {
    resetState()
    for (let i = 0; i < 60; i++) {
      state.blocks = { x: { id: 'x', title: `v${i}` } }
      snapshot()
    }
    assert.eq(getUndoHistory().length, 50)
  })

  it('snapshot is a deep copy -- later state changes do not mutate history', () => {
    resetState()
    state.blocks = { c: { id: 'c', type: 'goal', title: 'Original' } }
    snapshot()
    state.blocks.c.title = 'Modified'
    const saved = JSON.parse(getUndoHistory()[getUndoHistory().length - 1])
    assert.eq(saved.blocks.c.title, 'Original')
  })
})

// ── saveState / loadState ────────────────────────────────────

describe('saveState() / loadState() round-trip', () => {
  it('saves and loads blocks correctly', () => {
    resetState()
    state.blocks = {
      b1: { id: 'b1', type: 'goal', title: 'Goal 1', description: 'desc', notes: '', x: 100, y: 200, actions: ['resolve'], questions: ['why?'] }
    }
    state.arrows = [{ id: 'a1', from: 'b1', to: 'b2' }]
    canvasMeta.title = 'My Canvas'
    saveState()

    // Wipe state
    state.blocks = {}
    state.arrows = []
    canvasMeta.title = ''

    loadState()
    assert.ok(state.blocks.b1, 'Block b1 should be restored')
    assert.eq(state.blocks.b1.title, 'Goal 1')
    assert.eq(state.blocks.b1.actions[0], 'resolve')
    assert.eq(state.blocks.b1.questions[0], 'why?')
    assert.eq(state.arrows.length, 1)
    assert.eq(canvasMeta.title, 'My Canvas')
  })

  it('loadState handles empty localStorage gracefully', () => {
    resetState()
    localStorage.removeItem('pathfinder-v1')
    loadState()
    assert.deepEq(state.blocks, {})
    assert.deepEq(state.arrows, [])
  })

  it('loadState handles corrupt JSON gracefully', () => {
    resetState()
    localStorage.setItem('pathfinder-v1', 'NOT VALID JSON')
    loadState() // should not throw
    assert.deepEq(state.blocks, {})
  })

  it('preserves groups in save/load cycle', () => {
    resetState()
    state.groups = { g1: { id: 'g1', label: 'Sprint' } }
    saveState()
    state.groups = {}
    loadState()
    assert.ok(state.groups.g1)
    assert.eq(state.groups.g1.label, 'Sprint')
  })
})

// ── snap ─────────────────────────────────────────────────────

describe('snap()', () => {
  it('returns value unchanged when snapToGrid is off', () => {
    ui.snapToGrid = false
    assert.eq(snap(33), 33)
    assert.eq(snap(100.7), 100.7)
  })

  it('snaps to nearest multiple of 28 when snapToGrid is on', () => {
    ui.snapToGrid = true
    assert.eq(snap(0), 0)
    assert.eq(snap(14), 0)    // rounds down
    assert.eq(snap(15), 28)   // rounds up
    assert.eq(snap(28), 28)
    assert.eq(snap(42), 56)   // 42/28 = 1.5, rounds to 2 * 28 = 56
    assert.eq(snap(56), 56)
    ui.snapToGrid = false // reset
  })

  it('handles negative values', () => {
    ui.snapToGrid = true
    assert.eq(snap(-14), 0)
    assert.eq(snap(-28), -28)
    assert.eq(snap(-42), -56)
    ui.snapToGrid = false
  })
})

// ── toWorld ──────────────────────────────────────────────────

describe('toWorld()', () => {
  it('converts viewport coords to world coords at default view', () => {
    view.panX = 0; view.panY = 0; view.zoom = 1
    const w = toWorld(100, 200)
    assert.eq(w.x, 100)
    assert.eq(w.y, 200)
  })

  it('accounts for pan offset', () => {
    view.panX = 50; view.panY = 30; view.zoom = 1
    const w = toWorld(100, 200)
    assert.eq(w.x, 50)  // (100 - 50) / 1
    assert.eq(w.y, 170) // (200 - 30) / 1
    view.panX = 0; view.panY = 0
  })

  it('accounts for zoom', () => {
    view.panX = 0; view.panY = 0; view.zoom = 2
    const w = toWorld(200, 400)
    assert.eq(w.x, 100) // 200 / 2
    assert.eq(w.y, 200) // 400 / 2
    view.zoom = 1
  })

  it('accounts for both pan and zoom', () => {
    view.panX = 100; view.panY = 50; view.zoom = 0.5
    const w = toWorld(200, 150)
    assert.eq(w.x, 200)  // (200 - 100) / 0.5
    assert.eq(w.y, 200)  // (150 - 50) / 0.5
    view.panX = 0; view.panY = 0; view.zoom = 1
  })

  it('handles zero viewport coords', () => {
    view.panX = 50; view.panY = 50; view.zoom = 1
    const w = toWorld(0, 0)
    assert.eq(w.x, -50)
    assert.eq(w.y, -50)
    view.panX = 0; view.panY = 0
  })
})

// ── encodeCanvas ─────────────────────────────────────────────

describe('encodeCanvas()', () => {
  it('produces a base64 string', () => {
    resetState()
    state.blocks = { x: { id: 'x', type: 'goal', title: 'T' } }
    const encoded = encodeCanvas()
    assert.ok(typeof encoded === 'string')
    assert.ok(encoded.length > 0)
  })

  it('round-trips through decode', () => {
    resetState()
    state.blocks = {
      t1: { id: 't1', type: 'problem', title: 'Bug', description: 'Critical', x: 10, y: 20 }
    }
    state.arrows = [{ id: 'a1', from: 't1', to: 't2' }]
    canvasMeta.title = 'Test Canvas'

    const encoded = encodeCanvas()
    const decoded = JSON.parse(decodeURIComponent(atob(encoded)))

    assert.ok(decoded.blocks.t1)
    assert.eq(decoded.blocks.t1.title, 'Bug')
    assert.eq(decoded.arrows.length, 1)
    assert.eq(decoded.meta.title, 'Test Canvas')
  })

  it('handles empty canvas', () => {
    resetState()
    const encoded = encodeCanvas()
    const decoded = JSON.parse(decodeURIComponent(atob(encoded)))
    assert.deepEq(decoded.blocks, {})
    assert.deepEq(decoded.arrows, [])
  })

  it('handles unicode in block titles', () => {
    resetState()
    state.blocks = { u: { id: 'u', type: 'custom', title: 'Cafe\u0301 \u2014 estrategia' } }
    const encoded = encodeCanvas()
    const decoded = JSON.parse(decodeURIComponent(atob(encoded)))
    assert.eq(decoded.blocks.u.title, 'Cafe\u0301 \u2014 estrategia')
  })
})

// ── State mutation isolation ─────────────────────────────────

describe('State mutation isolation', () => {
  it('modifying blocks does not affect arrows', () => {
    resetState()
    state.blocks = { a: { id: 'a', type: 'goal', title: 'X' } }
    state.arrows = [{ id: 'ar1', from: 'a', to: 'b' }]
    state.blocks.a.title = 'Changed'
    assert.eq(state.arrows[0].from, 'a', 'Arrow reference should be unaffected')
    assert.eq(state.arrows.length, 1)
  })

  it('clearing blocks does not clear arrows', () => {
    resetState()
    state.blocks = { a: { id: 'a' } }
    state.arrows = [{ id: 'ar1', from: 'a', to: 'b' }]
    state.blocks = {}
    assert.eq(state.arrows.length, 1, 'Arrows should persist independently')
  })

  it('selection state is independent of blocks', () => {
    resetState()
    selection.blockId = 'x'
    selection.ids.add('x')
    state.blocks = {}
    assert.eq(selection.blockId, 'x', 'Selection should not auto-clear')
    assert.ok(selection.ids.has('x'))
    selection.blockId = null
    selection.ids.clear()
  })

  it('devOpts defaults are correct', () => {
    assert.eq(devOpts.tone, 'auto')
    assert.eq(devOpts.detail, 'standard')
    assert.eq(devOpts.mode, 'plan')
    assert.ok(devOpts.prePrompts instanceof Set)
  })
})
