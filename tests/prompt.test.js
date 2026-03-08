// ============================================================
//  prompt.test.js -- Tests for js/prompt.js
// ============================================================

import { describe, it, assert, mockBlockEl, mockGapIconEl, cleanupMockEls } from './test-utils.js'
import { state, devOpts, ui } from '../js/state.js'
import { generatePrompt, computeHealthScore } from '../js/prompt.js'

// Helper: set up state for prompt tests
function resetPromptState() {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  devOpts.tone = 'auto'
  devOpts.detail = 'standard'
  devOpts.prePrompts = new Set()
  devOpts.mode = 'plan'
  ui.promptDirty = true
}

function addBlock(id, type, title, opts = {}) {
  state.blocks[id] = {
    id, type, title,
    description: opts.description || '',
    notes: opts.notes || '',
    x: opts.x || 0, y: opts.y || 0,
    actions: opts.actions || [],
    questions: opts.questions || [],
    width: null, color: null, collapsed: false, groupId: null,
  }
  mockBlockEl(id)
  mockGapIconEl(id)
}

function addArrow(from, to, opts = {}) {
  state.arrows.push({ id: `a-${from}-${to}`, from, to, label: opts.label || '', ...opts })
}

// ── Empty canvas ─────────────────────────────────────────────

describe('generatePrompt() -- empty canvas', () => {
  it('returns placeholder text when no blocks exist', () => {
    resetPromptState()
    const prompt = generatePrompt()
    assert.includes(prompt, 'No blocks yet')
  })
})

// ── Mode directives ──────────────────────────────────────────

describe('generatePrompt() -- mode directives', () => {
  it('explore mode includes review and clarifying questions directive', () => {
    resetPromptState()
    addBlock('b1', 'goal', 'Ship v2')
    devOpts.mode = 'explore'
    const prompt = generatePrompt()
    assert.includes(prompt, '## Task')
    assert.includes(prompt, 'surface gaps')
    assert.includes(prompt, 'clarifying questions')
  })

  it('plan mode includes phased implementation plan directive', () => {
    resetPromptState()
    addBlock('b1', 'goal', 'Ship v2')
    devOpts.mode = 'plan'
    const prompt = generatePrompt()
    assert.includes(prompt, 'phased implementation plan')
  })

  it('build mode includes working code directive', () => {
    resetPromptState()
    addBlock('b1', 'goal', 'Ship v2')
    devOpts.mode = 'build'
    const prompt = generatePrompt()
    assert.includes(prompt, 'working code')
    assert.includes(prompt, 'acceptance criteria')
  })

  it('clarify mode includes ambiguous/missing directive and structure', () => {
    resetPromptState()
    addBlock('b1', 'goal', 'Ship v2')
    devOpts.mode = 'clarify'
    const prompt = generatePrompt()
    assert.includes(prompt, 'Do NOT implement')
    assert.includes(prompt, 'BLOCKING')
    assert.includes(prompt, 'Readiness Assessment')
  })
})

// ── Section ordering ─────────────────────────────────────────

describe('generatePrompt() -- sections grouped by type', () => {
  it('groups blocks by type with correct section headings', () => {
    resetPromptState()
    addBlock('c1', 'context', 'Background info')
    addBlock('g1', 'goal', 'Main Goal')
    addBlock('p1', 'problem', 'Blocker')
    addBlock('r1', 'requirement', 'Must have')
    addBlock('k1', 'risk', 'Possible failure')
    addBlock('q1', 'question', 'Open question')
    addBlock('d1', 'decision', 'We decided')
    addBlock('s1', 'resource', 'Team')
    addBlock('o1', 'output', 'Deliverable')
    addBlock('x1', 'custom', 'Other')

    const prompt = generatePrompt()

    // Verify all sections are present
    assert.includes(prompt, '## Context / Background')
    assert.includes(prompt, '## Project Goals')
    assert.includes(prompt, '## Problems / Blockers')
    assert.includes(prompt, '## Requirements')
    assert.includes(prompt, '## Risks')
    assert.includes(prompt, '## Open Questions')
    assert.includes(prompt, '## Decisions')
    assert.includes(prompt, '## Resources Available')
    assert.includes(prompt, '## Expected Outputs')
    assert.includes(prompt, '## Custom / Other')
  })

  it('Context appears before Goals in the prompt', () => {
    resetPromptState()
    addBlock('c1', 'context', 'BG')
    addBlock('g1', 'goal', 'Goal')
    const prompt = generatePrompt()
    const ctxIdx  = prompt.indexOf('## Context')
    const goalIdx = prompt.indexOf('## Project Goals')
    assert.ok(ctxIdx < goalIdx, 'Context should appear before Goals')
  })

  it('omits empty sections', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'Only a goal')
    const prompt = generatePrompt()
    assert.includes(prompt, '## Project Goals')
    assert.notIncludes(prompt, '## Problems')
    assert.notIncludes(prompt, '## Requirements')
  })
})

// ── Block content in prompt ──────────────────────────────────

describe('generatePrompt() -- block content', () => {
  it('includes block title', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'Ship v2')
    const prompt = generatePrompt()
    assert.includes(prompt, 'Ship v2')
  })

  it('includes block description', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'Ship v2', { description: 'Release by Q3' })
    const prompt = generatePrompt()
    assert.includes(prompt, 'Release by Q3')
  })

  it('includes block notes', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'Ship v2', { notes: 'Check with PM' })
    const prompt = generatePrompt()
    assert.includes(prompt, 'Notes: Check with PM')
  })

  it('includes block actions', () => {
    resetPromptState()
    addBlock('p1', 'problem', 'Bug', { actions: ['resolve', 'prepare'] })
    const prompt = generatePrompt()
    assert.includes(prompt, 'Actions: resolve, prepare')
  })

  it('includes open questions on blocks', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'Ship', { questions: ['When?', 'Budget?'] })
    const prompt = generatePrompt()
    assert.includes(prompt, 'Open questions:')
    assert.includes(prompt, '- When?')
    assert.includes(prompt, '- Budget?')
  })

  it('uses (untitled) for blocks without a title', () => {
    resetPromptState()
    addBlock('g1', 'goal', '')
    const prompt = generatePrompt()
    assert.includes(prompt, '(untitled)')
  })
})

// ── Connections section ──────────────────────────────────────

describe('generatePrompt() -- connections', () => {
  it('includes Connections section when arrows exist', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'Goal A')
    addBlock('r1', 'requirement', 'Req B')
    addArrow('g1', 'r1')
    const prompt = generatePrompt()
    assert.includes(prompt, '## Connections')
    assert.includes(prompt, 'Goal "Goal A"')
    assert.includes(prompt, 'Requirement "Req B"')
  })

  it('includes arrow labels in connections', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    addBlock('r1', 'requirement', 'R')
    addArrow('g1', 'r1', { label: 'depends on' })
    const prompt = generatePrompt()
    assert.includes(prompt, '[depends on]')
  })

  it('omits Connections section when no arrows', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'Solo')
    const prompt = generatePrompt()
    assert.notIncludes(prompt, '## Connections')
  })

  it('skips arrows referencing deleted blocks', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    // Arrow to a nonexistent block
    state.arrows.push({ id: 'a1', from: 'g1', to: 'deleted' })
    const prompt = generatePrompt()
    // Should not crash, and connections for broken arrows should be skipped
    assert.ok(typeof prompt === 'string')
  })
})

// ── Action Labels section in prompt ──────────────────────────

describe('generatePrompt() -- Action Labels section', () => {
  it('includes Action Labels section when blocks have actions', () => {
    resetPromptState()
    addBlock('p1', 'problem', 'Bug', { actions: ['resolve'] })
    const prompt = generatePrompt()
    assert.includes(prompt, '## Action Labels')
  })

  it('lists each used action with its definition', () => {
    resetPromptState()
    addBlock('p1', 'problem', 'Bug', { actions: ['resolve', 'prepare'] })
    const prompt = generatePrompt()
    assert.includes(prompt, '**resolve**')
    assert.includes(prompt, '**prepare**')
    assert.includes(prompt, 'fix or close')
    assert.includes(prompt, 'Gather resources')
  })

  it('omits Action Labels section when no blocks have actions', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'Ship v2', { actions: [] })
    const prompt = generatePrompt()
    assert.notIncludes(prompt, '## Action Labels')
  })

  it('only lists actions that are actually used on blocks', () => {
    resetPromptState()
    addBlock('p1', 'problem', 'Bug', { actions: ['reinforce'] })
    const prompt = generatePrompt()
    assert.includes(prompt, '**reinforce**')
    assert.notIncludes(prompt, '**resolve**')
    assert.notIncludes(prompt, '**prepare**')
    assert.notIncludes(prompt, '**recollect**')
  })

  it('deduplicates actions across multiple blocks', () => {
    resetPromptState()
    addBlock('p1', 'problem', 'Bug 1', { actions: ['resolve'] })
    addBlock('p2', 'problem', 'Bug 2', { actions: ['resolve', 'prepare'] })
    const prompt = generatePrompt()
    // Count occurrences of **resolve** in Action Labels section
    const actionSection = prompt.split('## Action Labels')[1]?.split('##')[0] || ''
    const resolveCount = (actionSection.match(/\*\*resolve\*\*/g) || []).length
    assert.eq(resolveCount, 1, 'resolve should appear only once in Action Labels')
  })

  it('handles custom/unknown action names gracefully', () => {
    resetPromptState()
    addBlock('p1', 'problem', 'Bug', { actions: ['unknown_action'] })
    const prompt = generatePrompt()
    assert.includes(prompt, '## Action Labels')
    assert.includes(prompt, '**unknown_action**')
    // Falls back to the action name itself when not in ACTION_DEFS
    assert.includes(prompt, 'unknown_action')
  })
})

// ── Gap details in prompt ────────────────────────────────────

describe('generatePrompt() -- gap details', () => {
  it('includes Planning Gaps section when gaps exist', () => {
    resetPromptState()
    addBlock('q1', 'question', 'Floating question')
    // question with no connections -> gap-isolated + gap-assumption
    const prompt = generatePrompt()
    assert.includes(prompt, '## Planning Gaps Detected')
  })

  it('describes gap type in gap details', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'Lonely Goal')
    // goal with no connections -> gap-isolated + gap-no-req
    const prompt = generatePrompt()
    assert.includes(prompt, 'no connections')
    assert.includes(prompt, 'no requirement')
  })

  it('omits gap section when all blocks are well-connected', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    addBlock('r1', 'requirement', 'R')
    addArrow('g1', 'r1')
    const prompt = generatePrompt()
    assert.notIncludes(prompt, '## Planning Gaps')
  })
})

// ── Dev options ──────────────────────────────────────────────

describe('generatePrompt() -- dev options', () => {
  it('formal tone adds tone instruction', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    devOpts.tone = 'formal'
    const prompt = generatePrompt()
    assert.includes(prompt, 'formal, professional tone')
  })

  it('casual tone adds casual instruction', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    devOpts.tone = 'casual'
    const prompt = generatePrompt()
    assert.includes(prompt, 'conversational')
  })

  it('technical tone adds technical instruction', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    devOpts.tone = 'technical'
    const prompt = generatePrompt()
    assert.includes(prompt, 'technical language')
  })

  it('auto tone adds no tone instruction', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    devOpts.tone = 'auto'
    const prompt = generatePrompt()
    assert.notIncludes(prompt, 'formal, professional')
    assert.notIncludes(prompt, 'conversational')
    assert.notIncludes(prompt, 'technical language')
  })

  it('brief detail adds concise instruction', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    devOpts.detail = 'brief'
    const prompt = generatePrompt()
    assert.includes(prompt, 'concise')
  })

  it('detailed adds comprehensive instruction', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    devOpts.detail = 'detailed'
    const prompt = generatePrompt()
    assert.includes(prompt, 'comprehensive')
  })

  it('standard detail adds no detail instruction', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    devOpts.detail = 'standard'
    const prompt = generatePrompt()
    assert.notIncludes(prompt, 'concise and high-level')
    assert.notIncludes(prompt, 'comprehensive, detailed')
  })

  it('prePrompt tasks adds acceptance criteria instruction', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    devOpts.prePrompts = new Set(['tasks'])
    const prompt = generatePrompt()
    assert.includes(prompt, 'acceptance criteria')
  })

  it('prePrompt typescript adds TypeScript instruction', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    devOpts.prePrompts = new Set(['typescript'])
    const prompt = generatePrompt()
    assert.includes(prompt, 'TypeScript')
  })

  it('prePrompt security adds security instruction', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    devOpts.prePrompts = new Set(['security'])
    const prompt = generatePrompt()
    assert.includes(prompt, 'security')
  })

  it('multiple prePrompts all appear', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    devOpts.prePrompts = new Set(['edge', 'errors', 'docs'])
    const prompt = generatePrompt()
    assert.includes(prompt, 'edge cases')
    assert.includes(prompt, 'error handling')
    assert.includes(prompt, 'Document')
  })
})

// ── computeHealthScore ───────────────────────────────────────

describe('computeHealthScore()', () => {
  it('returns null for empty canvas', () => {
    resetPromptState()
    assert.eq(computeHealthScore(), null)
  })

  it('returns a number between 0 and 100', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G', { description: 'desc' })
    addBlock('r1', 'requirement', 'R', { description: 'desc' })
    addArrow('g1', 'r1')
    const score = computeHealthScore()
    assert.ok(typeof score === 'number')
    assert.gte(score, 0)
    assert.ok(score <= 100)
  })

  it('penalizes gaps', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G')
    addBlock('g2', 'goal', 'G2')
    addBlock('g3', 'goal', 'G3')
    addBlock('g4', 'goal', 'G4')
    // All isolated -> many gaps
    const score = computeHealthScore()
    assert.lt(score, 80, 'Score should be reduced by gaps')
  })

  it('penalizes missing goal when canvas has 3+ blocks', () => {
    resetPromptState()
    addBlock('p1', 'problem', 'P1', { description: 'd' })
    addBlock('p2', 'problem', 'P2', { description: 'd' })
    addBlock('p3', 'problem', 'P3', { description: 'd' })
    const score = computeHealthScore()
    assert.lt(score, 90, 'Should be penalized for no goal block')
  })

  it('rewards well-connected canvases', () => {
    resetPromptState()
    addBlock('g1', 'goal', 'G', { description: 'desc' })
    addBlock('r1', 'requirement', 'R', { description: 'desc' })
    addArrow('g1', 'r1')
    const connected = computeHealthScore()

    resetPromptState()
    addBlock('g2', 'goal', 'G', { description: 'desc' })
    addBlock('r2', 'requirement', 'R', { description: 'desc' })
    // no arrows
    const disconnected = computeHealthScore()

    assert.gt(connected, disconnected, 'Connected canvas should score higher')
  })
})
