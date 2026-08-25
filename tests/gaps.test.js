// ============================================================
//  gaps.test.js -- Tests for js/gaps.js (gap detection logic)
// ============================================================

import { describe, it, assert, mockBlockEl, mockGapIconEl, cleanupMockEls } from './test-utils.js'
import { state } from '../js/state.js'
import { runGapDetection } from '../js/gaps.js'

// Helper: set up state and DOM for gap tests
function setupCanvas(blocks, arrows) {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []

  blocks.forEach(b => {
    state.blocks[b.id] = {
      id: b.id, type: b.type, title: b.title || '',
      description: b.description || '', notes: '',
      x: b.x || 0, y: b.y || 0,
      actions: b.actions || [], questions: b.questions || [],
      criteria: b.criteria || [], rationale: b.rationale || '',
      width: null, color: null, collapsed: false, groupId: null,
    }
    mockBlockEl(b.id)
    mockGapIconEl(b.id)
  })

  arrows.forEach(a => {
    state.arrows.push({ id: a.id || `a-${a.from}-${a.to}`, from: a.from, to: a.to })
  })
}

function getGapClasses(id) {
  const el = document.getElementById('b-' + id)
  if (!el) return []
  return ['gap-isolated', 'gap-assumption', 'gap-no-req', 'gap-unaddressed',
          'gap-no-mitigation', 'gap-no-basis', 'gap-no-producer', 'gap-no-criteria', 'gap-loose-step']
    .filter(c => el.classList.contains(c))
}

// ── gap-isolated ─────────────────────────────────────────────

describe('Gap: isolated (no connections)', () => {
  it('flags a block with zero incoming and zero outgoing arrows', () => {
    setupCanvas(
      [{ id: 'b1', type: 'goal', title: 'Lonely Goal' }],
      []
    )
    const result = runGapDetection()
    assert.eq(result.count, 1)
    assert.includes(getGapClasses('b1'), 'gap-isolated')
  })

  it('does not flag a block that has an outgoing arrow', () => {
    setupCanvas(
      [{ id: 'b1', type: 'goal', title: 'G' }, { id: 'b2', type: 'requirement', title: 'R' }],
      [{ from: 'b1', to: 'b2' }]
    )
    runGapDetection()
    assert.ok(!getGapClasses('b1').includes('gap-isolated'))
  })

  it('does not flag a block that has an incoming arrow', () => {
    setupCanvas(
      [{ id: 'b1', type: 'goal', title: 'G' }, { id: 'b2', type: 'requirement', title: 'R' }],
      [{ from: 'b1', to: 'b2' }]
    )
    runGapDetection()
    assert.ok(!getGapClasses('b2').includes('gap-isolated'))
  })
})

// ── gap-assumption ───────────────────────────────────────────
// gap-assumption now fires on a *connected* assumption-type block that is not
// anchored to a goal/requirement and isn't flagged to validate. An isolated
// assumption reports gap-isolated only (mutual exclusivity).

describe('Gap: assumption (assumption not anchored to goal/requirement)', () => {
  it('flags a connected assumption linked only to a problem', () => {
    setupCanvas(
      [{ id: 'a1', type: 'assumption', title: 'Users will pay' }, { id: 'p1', type: 'problem', title: 'Bug' }],
      [{ from: 'a1', to: 'p1' }]
    )
    runGapDetection()
    assert.includes(getGapClasses('a1'), 'gap-assumption')
  })

  it('reports an isolated assumption as gap-isolated only (not gap-assumption)', () => {
    setupCanvas(
      [{ id: 'a1', type: 'assumption', title: 'Users will pay' }],
      []
    )
    runGapDetection()
    const gaps = getGapClasses('a1')
    assert.includes(gaps, 'gap-isolated')
    assert.ok(!gaps.includes('gap-assumption'))
  })

  it('does not flag an assumption linked to a goal', () => {
    setupCanvas(
      [{ id: 'a1', type: 'assumption', title: 'Users will pay' }, { id: 'g1', type: 'goal', title: 'Ship it' }],
      [{ from: 'a1', to: 'g1' }]
    )
    runGapDetection()
    assert.ok(!getGapClasses('a1').includes('gap-assumption'))
  })

  it('does not flag an assumption that carries a validate action', () => {
    setupCanvas(
      [{ id: 'a1', type: 'assumption', title: 'Users will pay', actions: ['validate'] }, { id: 'p1', type: 'problem', title: 'Bug' }],
      [{ from: 'a1', to: 'p1' }]
    )
    runGapDetection()
    assert.ok(!getGapClasses('a1').includes('gap-assumption'))
  })

  it('does not flag a question (questions are genuine unknowns, not assumptions)', () => {
    setupCanvas(
      [{ id: 'q1', type: 'question', title: 'Why?' }, { id: 'p1', type: 'problem', title: 'Bug' }],
      [{ from: 'q1', to: 'p1' }]
    )
    runGapDetection()
    assert.ok(!getGapClasses('q1').includes('gap-assumption'))
  })

  it('does not flag non-assumption types', () => {
    setupCanvas(
      [{ id: 'p1', type: 'problem', title: 'Issue' }, { id: 'g1', type: 'goal', title: 'G' }],
      [{ from: 'g1', to: 'p1' }]
    )
    runGapDetection()
    assert.ok(!getGapClasses('p1').includes('gap-assumption'))
  })
})

// ── gap-no-req ───────────────────────────────────────────────

describe('Gap: no-req (goal without linked requirement)', () => {
  it('reports an isolated goal as gap-isolated only (not gap-no-req)', () => {
    setupCanvas(
      [{ id: 'g1', type: 'goal', title: 'Win' }],
      []
    )
    runGapDetection()
    const gaps = getGapClasses('g1')
    assert.includes(gaps, 'gap-isolated')
    assert.ok(!gaps.includes('gap-no-req'))
  })

  it('flags a goal linked only to a problem (not a requirement)', () => {
    setupCanvas(
      [{ id: 'g1', type: 'goal', title: 'Win' }, { id: 'p1', type: 'problem', title: 'Bug' }],
      [{ from: 'g1', to: 'p1' }]
    )
    runGapDetection()
    assert.includes(getGapClasses('g1'), 'gap-no-req')
  })

  it('does not flag a goal linked to a requirement via outgoing arrow', () => {
    setupCanvas(
      [{ id: 'g1', type: 'goal', title: 'Win' }, { id: 'r1', type: 'requirement', title: 'Need X' }],
      [{ from: 'g1', to: 'r1' }]
    )
    runGapDetection()
    assert.ok(!getGapClasses('g1').includes('gap-no-req'))
  })

  it('does not flag a goal linked to a requirement via incoming arrow', () => {
    setupCanvas(
      [{ id: 'g1', type: 'goal', title: 'Win' }, { id: 'r1', type: 'requirement', title: 'Need X' }],
      [{ from: 'r1', to: 'g1' }]
    )
    runGapDetection()
    assert.ok(!getGapClasses('g1').includes('gap-no-req'))
  })

  it('does not flag non-goal types', () => {
    setupCanvas(
      [{ id: 'p1', type: 'problem', title: 'Issue' }],
      []
    )
    runGapDetection()
    assert.ok(!getGapClasses('p1').includes('gap-no-req'))
  })
})

// ── gap-unaddressed ──────────────────────────────────────────

describe('Gap: unaddressed (problem without resolve and no outgoing)', () => {
  it('flags a problem with only an incoming arrow, no actions, no outgoing', () => {
    setupCanvas(
      [{ id: 'p1', type: 'problem', title: 'Bug', actions: [] }, { id: 'c1', type: 'context', title: 'BG' }],
      [{ from: 'c1', to: 'p1' }]  // connected (incoming) so not gap-isolated
    )
    runGapDetection()
    assert.includes(getGapClasses('p1'), 'gap-unaddressed')
  })

  it('reports an isolated problem as gap-isolated only (not gap-unaddressed)', () => {
    setupCanvas(
      [{ id: 'p1', type: 'problem', title: 'Bug', actions: [] }],
      []
    )
    runGapDetection()
    const gaps = getGapClasses('p1')
    assert.includes(gaps, 'gap-isolated')
    assert.ok(!gaps.includes('gap-unaddressed'))
  })

  it('does not flag a problem that has the resolve action (with a connection)', () => {
    setupCanvas(
      [{ id: 'p1', type: 'problem', title: 'Bug', actions: ['resolve'] }, { id: 'c1', type: 'context', title: 'BG' }],
      [{ from: 'c1', to: 'p1' }]
    )
    runGapDetection()
    assert.ok(!getGapClasses('p1').includes('gap-unaddressed'))
  })

  it('does not flag a problem that has outgoing arrows', () => {
    setupCanvas(
      [{ id: 'p1', type: 'problem', title: 'Bug', actions: [] }, { id: 'd1', type: 'decision', title: 'Fix' }],
      [{ from: 'p1', to: 'd1' }]
    )
    runGapDetection()
    assert.ok(!getGapClasses('p1').includes('gap-unaddressed'))
  })

  it('still flags if problem has only incoming arrows (no outgoing)', () => {
    setupCanvas(
      [{ id: 'p1', type: 'problem', title: 'Bug', actions: [] }, { id: 'c1', type: 'context', title: 'BG' }],
      [{ from: 'c1', to: 'p1' }]  // incoming only
    )
    runGapDetection()
    assert.includes(getGapClasses('p1'), 'gap-unaddressed')
  })

  it('does not flag non-problem types', () => {
    setupCanvas(
      [{ id: 'g1', type: 'goal', title: 'Win', actions: [] }],
      []
    )
    runGapDetection()
    assert.ok(!getGapClasses('g1').includes('gap-unaddressed'))
  })
})

// ── Multiple gaps on single block ────────────────────────────

describe('Mutual exclusivity of gaps on a single block', () => {
  it('an isolated block reports exactly ONE gap (gap-isolated wins)', () => {
    setupCanvas(
      [{ id: 'q1', type: 'question', title: 'Why?' }],
      []
    )
    const result = runGapDetection()
    const gaps = getGapClasses('q1')
    assert.includes(gaps, 'gap-isolated')
    assert.eq(gaps.length, 1, 'Isolated block should carry only gap-isolated')
    assert.eq(result.count, 1, 'Should count as 1 block with gaps')
    const detail = result.details.find(d => d.title === 'Why?')
    assert.ok(detail)
    assert.deepEq(detail.gaps, ['gap-isolated'])
  })

  it('an isolated goal reports gap-isolated only (not gap-no-req on top)', () => {
    setupCanvas(
      [{ id: 'g1', type: 'goal', title: 'Win' }],
      []
    )
    runGapDetection()
    const gaps = getGapClasses('g1')
    assert.includes(gaps, 'gap-isolated')
    assert.ok(!gaps.includes('gap-no-req'))
    assert.eq(gaps.length, 1)
  })
})

// ── All gaps resolved ────────────────────────────────────────

describe('Block with all gaps resolved', () => {
  it('returns zero gaps for a well-connected canvas', () => {
    setupCanvas(
      [
        { id: 'g1', type: 'goal', title: 'Ship v2' },
        { id: 'r1', type: 'requirement', title: 'Performance', criteria: ['p95 under 200ms'] },
        { id: 'q1', type: 'question', title: 'Timeline?' },
        { id: 'p1', type: 'problem', title: 'Legacy code', actions: ['resolve'] },
      ],
      [
        { from: 'g1', to: 'r1' },
        { from: 'q1', to: 'g1' },
        { from: 'p1', to: 'r1' },
      ]
    )
    const result = runGapDetection()
    assert.eq(result.count, 0)
    assert.eq(result.details.length, 0)
  })

  it('properly clears gap classes from previously-flagged blocks', () => {
    // First run: isolated block
    setupCanvas(
      [{ id: 'b1', type: 'goal', title: 'G' }],
      []
    )
    runGapDetection()
    assert.includes(getGapClasses('b1'), 'gap-isolated')

    // Second run: add a connection
    state.arrows.push({ id: 'a1', from: 'b1', to: 'b2' })
    state.blocks.b2 = { id: 'b2', type: 'requirement', title: 'R', description: '', notes: '', x: 0, y: 0, actions: [], questions: [] }
    mockBlockEl('b2')
    mockGapIconEl('b2')

    runGapDetection()
    assert.ok(!getGapClasses('b1').includes('gap-isolated'))
    assert.ok(!getGapClasses('b1').includes('gap-no-req'))
  })
})

// ── Return value structure ───────────────────────────────────

describe('runGapDetection() return value', () => {
  it('returns { count, details } with correct structure', () => {
    setupCanvas(
      [{ id: 'p1', type: 'problem', title: 'Bug', actions: [] }],
      []
    )
    const result = runGapDetection()
    assert.ok(typeof result.count === 'number')
    assert.ok(Array.isArray(result.details))
    assert.eq(result.count, result.details.length)

    const detail = result.details[0]
    assert.ok(detail.title)
    assert.ok(detail.type)
    assert.ok(Array.isArray(detail.gaps))
  })

  it('uses (untitled) for blocks without a title', () => {
    setupCanvas(
      [{ id: 'u1', type: 'risk', title: '' }],
      []
    )
    const result = runGapDetection()
    assert.eq(result.details[0].title, '(untitled)')
  })
})

// ── The lint expansion (2026-08-24) ──────────────────────────

describe('Gap: risk without mitigation', () => {
  it('flags a connected risk with no outgoing arrows and no prepare action', () => {
    setupCanvas(
      [{ id: 'g', type: 'goal' }, { id: 'r', type: 'risk' }],
      [{ from: 'g', to: 'r' }]
    )
    runGapDetection()
    assert.deepEq(getGapClasses('r'), ['gap-no-mitigation'])
  })
  it('a prepare action clears it', () => {
    setupCanvas(
      [{ id: 'g', type: 'goal' }, { id: 'r', type: 'risk', actions: ['prepare'] }],
      [{ from: 'g', to: 'r' }]
    )
    runGapDetection()
    assert.deepEq(getGapClasses('r'), [])
  })
})

describe('Gap: decision without basis', () => {
  it('flags a decision with nothing incoming and no rationale', () => {
    setupCanvas(
      [{ id: 'd', type: 'decision' }, { id: 'o', type: 'output' }],
      [{ from: 'd', to: 'o' }]
    )
    runGapDetection()
    assert.deepEq(getGapClasses('d'), ['gap-no-basis'])
  })
  it('a recorded rationale clears it', () => {
    setupCanvas(
      [{ id: 'd', type: 'decision' }, { id: 'o', type: 'output' }],
      [{ from: 'd', to: 'o' }]
    )
    state.blocks.d.rationale = 'cheaper and boring'
    runGapDetection()
    assert.deepEq(getGapClasses('d'), [])
  })
})

describe('Gap: output nothing produces, requirement without criteria', () => {
  it('flags them, and criteria clear the requirement', () => {
    setupCanvas(
      [{ id: 'r', type: 'requirement' }, { id: 'o', type: 'output' }],
      [{ from: 'o', to: 'r' }]
    )
    runGapDetection()
    assert.deepEq(getGapClasses('o'), ['gap-no-producer'])
    assert.deepEq(getGapClasses('r'), ['gap-no-criteria'])
    state.blocks.r.criteria = ['holds under load']
    runGapDetection()
    assert.deepEq(getGapClasses('r'), [])
  })
})

describe('Gap: step outside any flow', () => {
  it('flags a process wired only to non-flow blocks', () => {
    setupCanvas(
      [{ id: 'p', type: 'process' }, { id: 'x', type: 'problem', actions: ['resolve'] }],
      [{ from: 'x', to: 'p' }]
    )
    runGapDetection()
    assert.deepEq(getGapClasses('p'), ['gap-loose-step'])
  })
  it('another flow node clears it', () => {
    setupCanvas(
      [{ id: 'p', type: 'process' }, { id: 't', type: 'terminator' }],
      [{ from: 't', to: 'p' }]
    )
    runGapDetection()
    assert.deepEq(getGapClasses('p'), [])
  })
  it('reaching a flow node THROUGH ordinary blocks also clears it', () => {
    setupCanvas(
      [{ id: 't', type: 'terminator' }, { id: 'x', type: 'problem', actions: ['resolve'] },
       { id: 'p', type: 'process' }],
      [{ from: 't', to: 'x' }, { from: 'x', to: 'p' }]
    )
    runGapDetection()
    assert.deepEq(getGapClasses('p'), [], 'the tutorial example flows through non-flow blocks')
  })
})

describe('Gap precedence and canvas findings', () => {
  it('isolation still wins over every new rule', () => {
    setupCanvas([{ id: 'r', type: 'requirement' }], [])
    runGapDetection()
    assert.deepEq(getGapClasses('r'), ['gap-isolated'])
  })
  it('reports a dependency cycle as a canvas finding', () => {
    setupCanvas(
      [{ id: 'a', type: 'process' }, { id: 'b', type: 'process' }],
      [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
    )
    const { canvasFindings } = runGapDetection()
    assert.eq(canvasFindings.length, 1)
    assert.match(canvasFindings[0], /cycle/)
  })
  it('reports a named empty group', () => {
    setupCanvas([{ id: 'a', type: 'goal' }], [])
    state.groups = { g1: { id: 'g1', label: 'Phase 9' } }
    const { canvasFindings } = runGapDetection()
    assert.ok(canvasFindings.some(f => f.includes('Phase 9')))
    state.groups = {}
  })
})
