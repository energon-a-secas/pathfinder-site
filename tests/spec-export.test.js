// ============================================================
//  spec-export.test.js -- The Spec bundle builders
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { state, canvasMeta } from '../js/state.js'
import { buildSpecFiles } from '../js/spec-export.js'

function seedSpecState() {
  canvasMeta.title = 'Test spec'
  canvasMeta.contextBrief = 'A brief.'
  state.groups = {}
  state.blocks = {
    r1: { id: 'r1', type: 'requirement', title: 'Fast checkout', description: 'Under load.',
          criteria: ['respond within 200ms', 'WHEN the cart is empty THE SYSTEM SHALL show a hint'],
          priority: 'high', questions: [], actions: [] },
    r2: { id: 'r2', type: 'requirement', title: 'Bare requirement', description: '',
          criteria: [], questions: [{ text: 'Which gateway?' }], actions: [] },
    o1: { id: 'o1', type: 'output', title: 'Release note', description: '', criteria: ['published'], questions: [], actions: [] },
    d1: { id: 'd1', type: 'decision', title: 'Use Stripe', description: '', rationale: 'Fewer moving parts.', questions: [], actions: [] },
    q1: { id: 'q1', type: 'question', title: 'Staging parity?', description: '', questions: [], actions: [] },
  }
  state.arrows = [{ id: 'a1', from: 'r1', to: 'o1' }]
}

describe('buildSpecFiles()', () => {
  it('produces the five files by name', () => {
    seedSpecState()
    const names = buildSpecFiles().map(f => f.name)
    assert.deepEq(names, ['README.md', 'spec.md', 'plan.md', 'tasks.md', 'requirements.md'])
  })

  it('spec.md carries criteria, marks missing ones, and flags questions', () => {
    seedSpecState()
    const spec = buildSpecFiles().find(f => f.name === 'spec.md').data
    assert.includes(spec, '- [ ] respond within 200ms')
    assert.includes(spec, '[NEEDS INPUT: acceptance criteria]')
    assert.includes(spec, '[NEEDS CLARIFICATION] Which gateway?')
    assert.includes(spec, '[NEEDS CLARIFICATION] Staging parity?')
  })

  it('plan.md carries the decision rationale', () => {
    seedSpecState()
    const plan = buildSpecFiles().find(f => f.name === 'plan.md').data
    assert.includes(plan, 'Use Stripe')
    assert.includes(plan, '**Rationale:** Fewer moving parts.')
    assert.includes(plan, '## Situation')
  })

  it('tasks.md orders the upstream requirement before its output', () => {
    seedSpecState()
    const tasks = buildSpecFiles().find(f => f.name === 'tasks.md').data
    const iReq = tasks.indexOf('Fast checkout')
    const iOut = tasks.indexOf('Release note')
    assert.ok(iReq > -1 && iOut > -1)
    assert.lt(iReq, iOut, 'requirement precedes the output it produces')
    assert.includes(tasks, 'after: Fast checkout')
  })

  it('requirements.md uses EARS, keeping WHEN criteria verbatim', () => {
    seedSpecState()
    const ears = buildSpecFiles().find(f => f.name === 'requirements.md').data
    assert.includes(ears, 'THE SYSTEM SHALL respond within 200ms')
    assert.includes(ears, 'WHEN the cart is empty THE SYSTEM SHALL show a hint')
    assert.notIncludes(ears, 'THE SYSTEM SHALL WHEN')
    assert.includes(ears, '[NEEDS INPUT: acceptance criteria]')
  })
})
