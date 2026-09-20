import { describe, it, assert } from './test-utils.js'
import { attentionItems } from '../js/attention.js'

describe('Needs attention queue', () => {
  it('keeps every issue visible even when several belong to one block', () => {
    const items = attentionItems({ r: { id: 'r', type: 'requirement', status: 'blocked', questions: [{ text: 'Which region?' }] } })
    assert.deepEq(items.map(i => i.kind), ['blocked', 'question', 'criteria'])
    assert.eq(items[1].question, 0)
  })
  it('requires evidence rather than treating a validate action as verification', () => {
    assert.eq(attentionItems({ a: { id: 'a', type: 'assumption', actions: ['validate'] } })[0].kind, 'assumption')
    assert.eq(attentionItems({ a: { id: 'a', type: 'decision', rationale: 'Verified: measured' } }).length, 0)
  })
  it('removes answered questions, completed question blocks and defined criteria', () => {
    const blocks = { q: { id: 'q', type: 'question', status: 'done' }, r: { id: 'r', type: 'requirement', criteria: ['Proven'], questions: [{ text: 'Region?', answer: 'West' }] } }
    assert.eq(attentionItems(blocks).length, 0)
    blocks.r.questions[0].answer = ' '
    assert.eq(attentionItems(blocks).length, 1)
  })
  it('keeps standalone open questions actionable without duplicating attached questions', () => {
    const b = { id: 'q', type: 'question', title: 'Where?' }
    assert.eq(attentionItems({ q: b }).length, 1)
    b.questions = [{ text: 'Where exactly?' }, { text: '  ' }]
    assert.eq(attentionItems({ q: b }).length, 1)
  })
})
