// ============================================================
//  patch.test.js -- The round trip: parse, resolve, apply
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { state, ui, getUndoHistory, getRedoFuture } from '../js/state.js'
import { extractPatch, resolveRef, buildPlan, applyPlan, isPlanCurrent, setPlanSelected, selectedOps, previewPlan } from '../js/patch.js'

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
  it('rejects unsupported versions instead of interpreting a different format', () => {
    assert.match(extractPatch('{"format":"pathfinder-patch","version":2}').error, /version 1/)
  })
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

describe('notes op (review remarks)', () => {
  it('appends prefixed notes and refuses empty ones', () => {
    seedPatchState()
    state.blocks.q1.notes = 'mine'
    const plan = buildPlan({ format: 'pathfinder-patch', notes: [
      { block: 'q1', note: 'check the cert dates' },
      { block: 'q1', note: '   ' },
    ] })
    assert.eq(plan.ops.filter(o => o.ok).length, 1)
    applyPlan(plan)
    assert.eq(state.blocks.q1.notes, 'mine\nReview: check the cert dates')
  })
})

describe('buildPlan() + applyPlan()', () => {
  it('applies only selected changes, with one undo step', () => {
    seedPatchState()
    const plan = buildPlan({ status: [{ block: 'r1', status: 'done' }], notes: [{ block: 'q1', note: 'Keep this' }] })
    setPlanSelected(plan, 0, false)
    assert.eq(applyPlan(plan), 1)
    assert.eq(state.blocks.r1.status, undefined)
    assert.eq(state.blocks.q1.notes, 'Review: Keep this')
    assert.eq(getUndoHistory().length, 1)
  })
  it('keeps new connections and their selected endpoints consistent', () => {
    seedPatchState()
    const plan = buildPlan({ blocks: [{ id: 'new', type: 'risk', title: 'New risk' }], arrows: [{ from: 'new', to: 'r1' }] })
    setPlanSelected(plan, 0, false)
    assert.eq(selectedOps(plan).length, 0)
    setPlanSelected(plan, 1, true)
    assert.eq(selectedOps(plan).length, 2)
    assert.eq(applyPlan(plan), 2)
    assert.ok(state.blocks[state.arrows.at(-1).from])
  })
  it('does not include criteria from deselected operations', () => {
    seedPatchState()
    const plan = buildPlan({ criteria: [{ block: 'r1', add: ['First', 'Shared'] }, { block: 'r1', add: ['Shared', 'Second'] }] })
    setPlanSelected(plan, 0, false)
    applyPlan(plan)
    assert.deepEq(state.blocks.r1.criteria, ['exists', 'Shared', 'Second'])
  })
  it('previews complete before/after text without changing live state', () => {
    seedPatchState()
    const answer = 'Full evidence '.repeat(80)
    const before = JSON.stringify(state)
    const plan = buildPlan({ answers: [{ block: 'q1', answer }] })
    const preview = previewPlan(plan)
    assert.eq(preview[0].before, 'Not answered')
    assert.eq(preview[0].after, answer.trim())
    assert.eq(JSON.stringify(state), before)
  })
  it('refuses duplicate new block IDs and their ambiguous connections', () => {
    seedPatchState()
    const plan = buildPlan({ blocks: [
      { id: 'same', type: 'risk', title: 'First' }, { id: 'same', type: 'risk', title: 'Second' },
    ], arrows: [{ from: 'same', to: 'r1' }] })
    assert.eq(plan.ops.filter(o => o.ok).length, 0)
    assert.eq(applyPlan(plan), 0)
    assert.eq(Object.keys(state.blocks).length, 3)
  })
  it('deduplicates arrows within one patch', () => {
    seedPatchState()
    const plan = buildPlan({ arrows: [{ from: 'q1', to: 'r1' }, { from: 'q1', to: 'r1' }] })
    assert.eq(plan.ops.filter(o => o.ok).length, 1)
    applyPlan(plan)
    assert.eq(state.arrows.filter(a => a.from === 'q1' && a.to === 'r1').length, 1)
  })
  it('does not wire a rejected new block to an existing block sharing its id', () => {
    seedPatchState()
    const plan = buildPlan({ blocks: [{ id: 'r1', type: 'unknown' }], arrows: [{ from: 'r1', to: 'q1' }] })
    assert.eq(plan.ops.filter(o => o.ok).length, 0)
    assert.eq(applyPlan(plan), 0)
    assert.eq(state.arrows.length, 1)
  })
  it('deduplicates criteria within and across operations and honors storage limits', () => {
    seedPatchState()
    const plan = buildPlan({ criteria: [
      { block: 'r1', add: ['New one', ' new ONE ', 'exists'] },
      { block: 'r1', add: ['New one', 'x'.repeat(400)] },
    ] })
    applyPlan(plan)
    assert.deepEq(state.blocks.r1.criteria, ['exists', 'New one', 'x'.repeat(300)])
    const full = buildPlan({ criteria: [{ block: 'r1', add: Array.from({ length: 40 }, (_, i) => 'Criterion ' + i) }] })
    assert.match(full.ops[0].label, /^27 acceptance criteria/)
    applyPlan(full)
    assert.eq(state.blocks.r1.criteria.length, 30)
    const overflow = buildPlan({ criteria: [{ block: 'r1', add: ['overflow'] }] })
    assert.eq(overflow.ops[0].ok, false)
  })
  it('requires a question index when duplicate question text is ambiguous', () => {
    seedPatchState()
    state.blocks.q1.questions.push({ text: 'Does it happen on staging?' })
    const plan = buildPlan({ answers: [{ block: 'q1', question: 'Does it happen on staging?', answer: 'Yes' }] })
    assert.eq(plan.ops[0].ok, false)
    const indexed = buildPlan({ answers: [{ block: 'q1', question: 1, answer: 'Yes' }] })
    applyPlan(indexed)
    assert.eq(state.blocks.q1.questions[1].answer, 'Yes')
    assert.eq(state.blocks.q1.questions[0].answer, undefined)
  })
  it('refuses a stale preview without applying any changes or adding undo history', () => {
    seedPatchState()
    const plan = buildPlan({ status: [{ block: 'r1', status: 'done' }], notes: [{ block: 'q1', note: 'Check staging' }] })
    delete state.blocks.q1
    assert.eq(isPlanCurrent(plan), false)
    assert.eq(applyPlan(plan), 0)
    assert.eq(state.blocks.r1.status, undefined)
    assert.eq(getUndoHistory().length, 0)
  })
  it('refuses a preview from another map even when its canvas content is identical', () => {
    seedPatchState()
    const key = 'pathfinder-map-current', old = localStorage.getItem(key)
    try {
      localStorage.setItem(key, 'map-one')
      const plan = buildPlan({ status: [{ block: 'r1', status: 'done' }] })
      localStorage.setItem(key, 'map-two')
      assert.eq(applyPlan(plan), 0)
    } finally {
      if (old === null) localStorage.removeItem(key)
      else localStorage.setItem(key, old)
    }
  })
  it('applies a preview only once and refuses changes in view-only mode', () => {
    seedPatchState()
    const plan = buildPlan({ notes: [{ block: 'q1', note: 'Check staging' }] })
    ui.readOnly = true
    try { assert.eq(applyPlan(plan), 0) } finally { ui.readOnly = false }
    assert.eq(applyPlan(plan), 1)
    assert.eq(applyPlan(plan), 0)
    assert.eq(state.blocks.q1.notes, 'Review: Check staging')
    assert.eq(getUndoHistory().length, 1)
  })
  it('refuses inherited object property names as references, statuses, or block types', () => {
    seedPatchState()
    assert.eq(resolveRef('constructor'), null)
    const plan = buildPlan({ status: [{ block: 'r1', status: 'constructor' }], blocks: [{ id: 'bad', type: 'toString' }] })
    assert.eq(plan.ops.filter(o => o.ok).length, 0)
  })
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
