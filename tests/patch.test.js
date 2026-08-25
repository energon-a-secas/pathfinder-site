// ============================================================
//  patch.test.js -- The round trip: parse, resolve, apply
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { state, getUndoHistory, getRedoFuture } from '../js/state.js'
import { extractPatch, resolveRef, buildPlan, applyPlan } from '../js/patch.js'

function seedPatchState() {
  state.blocks = {
    q1: { id: 'q1', type: 'problem', title: 'Checkout fails', description: '', notes: '',
          x: 0, y: 0, actions: [], criteria: [],
          questions: [{ text: 'Does it happen on staging?' }] },
    a1: { id: 'a1', type: 'assumption', title: 'It started with the deploy', description: '', notes: '',
          x: 300, y: 0, actions: ['validate'], criteria: [], questions: [] },
    r1: { id: 'r1', type: 'requirement', title: 'A failing-first test', description: '', notes: '',
          x: 600, y: 0, actions: [], criteria: ['exists'], questions: [] },
  }
  state.arrows = [{ id: 'x1', from: 'a1', to: 'r1', label: 'motivates' }]
  state.groups = {}
  getUndoHistory().length = 0
  getRedoFuture().length = 0
}

describe('extractPatch()', () => {
  it('finds the fenced block inside a longer reply', () => {
    const reply = 'Here is what I found.\n\n```pathfinder-patch\n{"format":"pathfinder-patch","status":[]}\n```\nDone.'
    const { patch, error } = extractPatch(reply)
    assert.eq(error, undefined)
    assert.eq(patch.format, 'pathfinder-patch')
  })
  it('accepts bare patch JSON and rejects garbage and whole canvases', () => {
    assert.eq(extractPatch('{"format":"pathfinder-patch"}').patch.format, 'pathfinder-patch')
    assert.ok(extractPatch('not json').error)
    assert.match(extractPatch('{"blocks":[{"id":"x"}]}').error, /whole canvas/)
  })
})

describe('resolveRef()', () => {
  it('resolves by id, exact title, and unique fuzzy title', () => {
    seedPatchState()
    assert.eq(resolveRef('a1').how, 'id')
    assert.eq(resolveRef('checkout fails').how, 'title')
    assert.eq(resolveRef('failing-first').how, 'fuzzy')
  })
  it('refuses ambiguity and unknowns', () => {
    seedPatchState()
    state.blocks.r2 = { ...state.blocks.r1, id: 'r2' }
    assert.eq(resolveRef('A failing-first test'), null, 'two exact title matches is ambiguous')
    delete state.blocks.r2
    assert.eq(resolveRef('zzz-nope'), null)
  })
})

describe('buildPlan() + applyPlan()', () => {
  it('applies answers, verify, status, criteria, blocks and arrows as one undo step', () => {
    seedPatchState()
    const { patch } = extractPatch(JSON.stringify({
      format: 'pathfinder-patch',
      answers: [{ block: 'q1', answer: 'Staging is clean.' }],
      verify: [{ block: 'a1', verdict: 'verified', evidence: 'The deploy diff shows it.' }],
      status: [{ block: 'r1', status: 'in-progress' }],
      criteria: [{ block: 'r1', add: ['covers the retry path', 'exists'] }],
      blocks: [{ id: 'n1', type: 'problem', title: 'Retry swallows errors' }],
      arrows: [{ from: 'n1', to: 'r1', label: 'explains' }],
    }))
    const plan = buildPlan(patch)
    assert.eq(plan.ops.filter(o => !o.ok).length, 0, 'every op resolves')
    const n = applyPlan(plan)
    assert.eq(n, 6)
    assert.eq(getUndoHistory().length, 1, 'one snapshot for the whole patch')
    assert.eq(state.blocks.q1.questions[0].answer, 'Staging is clean.')
    assert.eq(state.blocks.a1.type, 'decision', 'assumption became a decision in place')
    assert.match(state.blocks.a1.rationale, /^Verified: /)
    assert.notIncludes(state.blocks.a1.actions, 'validate')
    assert.eq(state.arrows.find(a => a.id === 'x1').from, 'a1', 'its arrows survive')
    assert.eq(state.blocks.r1.status, 'in-progress')
    assert.deepEq(state.blocks.r1.criteria, ['exists', 'covers the retry path'], 'dedup keeps existing first')
    const added = Object.values(state.blocks).find(b => b.title === 'Retry swallows errors')
    assert.ok(added, 'new block landed')
    assert.ok(state.arrows.some(a => a.from === added.id && a.to === 'r1'), 'new arrow wired to existing id')
  })

  it('refuses what it cannot resolve, and a verify without evidence', () => {
    seedPatchState()
    const plan = buildPlan({
      format: 'pathfinder-patch',
      answers: [{ block: 'ghost', answer: 'x' }],
      verify: [{ block: 'a1', verdict: 'verified', evidence: '' }],
      status: [{ block: 'r1', status: 'yolo' }],
    })
    assert.eq(plan.ops.filter(o => o.ok).length, 0)
    assert.eq(applyPlan(plan), 0)
    assert.eq(getUndoHistory().length, 0, 'nothing applied, nothing snapshotted')
  })
})
