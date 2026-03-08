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
  return ['gap-isolated', 'gap-assumption', 'gap-no-req', 'gap-unaddressed']
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

describe('Gap: assumption (question not linked to goal/requirement)', () => {
  it('flags a question block with no connections at all', () => {
    setupCanvas(
      [{ id: 'q1', type: 'question', title: 'Why?' }],
      []
    )
    runGapDetection()
    assert.includes(getGapClasses('q1'), 'gap-assumption')
  })

  it('flags a question linked only to a problem (not goal/requirement)', () => {
    setupCanvas(
      [{ id: 'q1', type: 'question', title: 'Why?' }, { id: 'p1', type: 'problem', title: 'Bug' }],
      [{ from: 'q1', to: 'p1' }]
    )
    runGapDetection()
    assert.includes(getGapClasses('q1'), 'gap-assumption')
  })

  it('does not flag a question linked to a goal', () => {
    setupCanvas(
      [{ id: 'q1', type: 'question', title: 'Why?' }, { id: 'g1', type: 'goal', title: 'Ship it' }],
      [{ from: 'q1', to: 'g1' }]
    )
    runGapDetection()
    assert.ok(!getGapClasses('q1').includes('gap-assumption'))
  })

  it('does not flag a question linked to a requirement', () => {
    setupCanvas(
      [{ id: 'q1', type: 'question', title: 'How?' }, { id: 'r1', type: 'requirement', title: 'Must do X' }],
      [{ from: 'r1', to: 'q1' }]  // incoming from requirement
    )
    runGapDetection()
    assert.ok(!getGapClasses('q1').includes('gap-assumption'))
  })

  it('does not flag non-question types', () => {
    setupCanvas(
      [{ id: 'p1', type: 'problem', title: 'Issue' }],
      []
    )
    runGapDetection()
    assert.ok(!getGapClasses('p1').includes('gap-assumption'))
  })
})

// ── gap-no-req ───────────────────────────────────────────────

describe('Gap: no-req (goal without linked requirement)', () => {
  it('flags a goal with no connections', () => {
    setupCanvas(
      [{ id: 'g1', type: 'goal', title: 'Win' }],
      []
    )
    runGapDetection()
    assert.includes(getGapClasses('g1'), 'gap-no-req')
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
  it('flags a problem with no actions and no outgoing arrows', () => {
    setupCanvas(
      [{ id: 'p1', type: 'problem', title: 'Bug', actions: [] }],
      []
    )
    runGapDetection()
    assert.includes(getGapClasses('p1'), 'gap-unaddressed')
  })

  it('does not flag a problem that has the resolve action', () => {
    setupCanvas(
      [{ id: 'p1', type: 'problem', title: 'Bug', actions: ['resolve'] }],
      []
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

describe('Multiple gaps on a single block', () => {
  it('question block can have both gap-isolated and gap-assumption', () => {
    setupCanvas(
      [{ id: 'q1', type: 'question', title: 'Why?' }],
      []
    )
    const result = runGapDetection()
    const gaps = getGapClasses('q1')
    assert.includes(gaps, 'gap-isolated')
    assert.includes(gaps, 'gap-assumption')
    assert.eq(result.count, 1, 'Should count as 1 block with gaps')
    // But the details should list both gap types
    const detail = result.details.find(d => d.title === 'Why?')
    assert.ok(detail)
    assert.includes(detail.gaps, 'gap-isolated')
    assert.includes(detail.gaps, 'gap-assumption')
  })

  it('goal block can have both gap-isolated and gap-no-req', () => {
    setupCanvas(
      [{ id: 'g1', type: 'goal', title: 'Win' }],
      []
    )
    runGapDetection()
    const gaps = getGapClasses('g1')
    assert.includes(gaps, 'gap-isolated')
    assert.includes(gaps, 'gap-no-req')
  })
})

// ── All gaps resolved ────────────────────────────────────────

describe('Block with all gaps resolved', () => {
  it('returns zero gaps for a well-connected canvas', () => {
    setupCanvas(
      [
        { id: 'g1', type: 'goal', title: 'Ship v2' },
        { id: 'r1', type: 'requirement', title: 'Performance' },
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
