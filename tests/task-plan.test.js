import { describe, it, assert } from './test-utils.js'
import { buildTaskPlan, taskChecklist } from '../js/task-plan.js'

const block = (id, extra = {}) => ({ id, type: 'requirement', title: id, ...extra })
const ids = plan => plan.tasks.map(b => b.id)

describe('Dependency-ordered task checklist', () => {
  it('places prerequisites before higher-priority dependents across block types', () => {
    const blocks = {
      ship: block('ship', { priority: 'high' }),
      artifact: block('artifact', { type: 'output', priority: 'low' }),
      review: block('review', { type: 'decision' }),
    }
    const plan = buildTaskPlan(blocks, [{ from: 'artifact', to: 'review' }, { from: 'review', to: 'ship' }])
    assert.deepEq(ids(plan), ['artifact', 'ship'])
    assert.eq(plan.hasCycle, false)
  })
  it('uses priority to choose between available tasks', () => {
    const blocks = { low: block('low', { priority: 'low' }), high: block('high', { priority: 'high' }), medium: block('medium', { priority: 'medium' }) }
    assert.deepEq(ids(buildTaskPlan(blocks, [])), ['high', 'medium', 'low'])
  })
  it('warns about cycles and keeps all tasks visible exactly once', () => {
    const blocks = { a: block('a'), b: block('b'), c: block('c') }
    const arrows = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'b', to: 'c' }]
    const plan = buildTaskPlan(blocks, arrows)
    assert.eq(plan.hasCycle, true)
    assert.eq(new Set(ids(plan)).size, 3)
    assert.includes(taskChecklist(blocks, arrows), '[NEEDS INPUT: circular connections]')
  })
  it('ignores dangling endpoints and duplicate connections', () => {
    const blocks = { b: block('b'), a: block('a') }
    const arrows = [{ from: 'gone', to: 'a' }, { from: 'a', to: 'b' }, { from: 'a', to: 'b' }]
    assert.deepEq(ids(buildTaskPlan(blocks, arrows)), ['a', 'b'])
    assert.eq(buildTaskPlan(blocks, arrows).hasCycle, false)
  })
  it('preserves done and blocked status along with task evidence', () => {
    const blocks = {
      done: block('done', { status: 'done', criteria: ['Deployed'] }),
      waiting: block('waiting', {
        status: 'blocked', notes: 'Keep retries safe', rationale: 'Avoid double charges',
        questions: [{ text: 'Which gateway?', answer: 'Existing gateway' }, { text: 'Which region?' }],
        docRef: { label: 'API spec', href: '/api.md', anchor: 'payments' },
        description: 'First line\nSecond line', actions: ['prepare'],
      }),
    }
    const out = taskChecklist(blocks, [{ from: 'done', to: 'waiting' }])
    assert.includes(out, '- [x] [DONE] done')
    assert.notIncludes(out, '- [ ] Deployed')
    assert.includes(out, '- [ ] [BLOCKED] waiting')
    for (const expected of ['Keep retries safe', 'Avoid double charges', 'Answer: Existing gateway',
      '[NEEDS CLARIFICATION]: Which region?', 'API spec (/api.md#payments)', '      Second line', 'Actions: prepare', 'after: done']) {
      assert.includes(out, expected)
    }
  })
  it('does not mutate the graph while ordering or rendering it', () => {
    const blocks = { a: block('a'), b: block('b') }, arrows = [{ from: 'a', to: 'b' }]
    const before = JSON.stringify({ blocks, arrows })
    taskChecklist(blocks, arrows)
    assert.eq(JSON.stringify({ blocks, arrows }), before)
  })
})
