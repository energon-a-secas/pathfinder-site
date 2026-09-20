import { describe, it, assert } from './test-utils.js'
import { dependencyEdges, relationOf, connectionLabel } from '../js/relations.js'
import { buildTaskPlan } from '../js/task-plan.js'
import { normalizeArrow } from '../js/normalize.js'
import { state } from '../js/state.js'
import { applyImport } from '../js/export.js'

const blocks = { a: { id: 'a', type: 'requirement', title: 'Deploy' }, b: { id: 'b', type: 'requirement', title: 'Build' } }
describe('Connection meanings', () => {
  it('orders the target before the source for depends-on', () => {
    const arrows = [{ from: 'a', to: 'b', relation: 'depends-on' }]
    assert.deepEq(buildTaskPlan(blocks, arrows).tasks.map(b => b.id), ['b', 'a'])
    assert.deepEq(dependencyEdges(blocks, arrows), [{ from: 'b', to: 'a' }])
  })
  it('excludes informational cycles from dependency order', () => {
    const arrows = [{ from: 'a', to: 'b', relation: 'blocks' }, { from: 'b', to: 'a', relation: 'informs' }]
    assert.eq(buildTaskPlan(blocks, arrows).hasCycle, false)
    assert.eq(dependencyEdges(blocks, arrows).length, 1)
    arrows[1].relation = 'related'
    assert.eq(dependencyEdges(blocks, arrows).length, 1)
  })
  it('recognizes legacy labels and keeps unlabeled arrows in sequence', () => {
    assert.eq(relationOf({ label: ' Depends on ' }), 'depends-on')
    assert.eq(relationOf({ label: 'requires' }), 'depends-on')
    assert.eq(relationOf({ label: 'informs' }), 'informs')
    assert.eq(relationOf({}), 'precedes')
    assert.eq(relationOf({ label: 'custom' }), 'precedes')
  })
  it('uses explicit meaning over labels and shows both in exports', () => {
    const arrow = { relation: 'informs', label: 'depends on' }
    assert.eq(relationOf(arrow), 'informs')
    assert.eq(connectionLabel(arrow), 'informs: depends on')
    assert.eq(relationOf({ label: connectionLabel(arrow) }), 'informs', 'meaning survives text-only interchange')
    assert.eq(connectionLabel({ relation: 'blocks' }), 'blocks')
  })
  it('preserves meaning when normalizing and importing', () => {
    const arrow = { from: 'a', to: 'b', relation: 'depends-on' }
    assert.eq(normalizeArrow(arrow).relation, 'depends-on')
    assert.eq(normalizeArrow({ ...arrow, relation: 'constructor' }).relation, null)
    applyImport({ blocks, arrows: [arrow] }, 'replace', { fit: false })
    assert.eq(state.arrows[0].relation, 'depends-on')
    assert.deepEq(buildTaskPlan(state.blocks, state.arrows).tasks.map(b => b.id), ['b', 'a'])
  })
})
