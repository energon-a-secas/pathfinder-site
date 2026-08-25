// ============================================================
//  user-templates.test.js -- Save the canvas as a template
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { listUserTemplates, saveCurrentAsTemplate, deleteUserTemplate } from '../js/templates.js'

function seed() {
  localStorage.removeItem('pathfinder-templates')
  return {
    state: {
      blocks: {
        a: { id: 'a', type: 'goal', title: 'Ship', description: 'd', x: 100, y: 50, actions: [], questions: [], criteria: ['done when shipped'], rationale: '' },
        b: { id: 'b', type: 'requirement', title: 'Fast', description: '', x: 400, y: 50, actions: [], questions: [{ text: 'How fast?', answer: 'x' }], criteria: [], rationale: '' },
      },
      arrows: [{ id: 'x', from: 'a', to: 'b', label: 'requires' }],
    },
    canvasMeta: { situation: { codebase: 'current', runtime: 'code', firstMove: 'read', repoHint: '', constraints: '' } },
    mode: 'build',
  }
}

describe('saveCurrentAsTemplate()', () => {
  it('normalises positions, indexes arrows, carries criteria, situation and mode', () => {
    const deps = seed()
    const tpl = saveCurrentAsTemplate('My flow', deps)
    assert.eq(tpl.name, 'My flow')
    assert.eq(tpl.blocks[0].dx, 0, 'positions are relative to the canvas top-left')
    assert.eq(tpl.blocks[1].dx, 300)
    assert.deepEq(tpl.arrows, [[0, 1, 'requires']])
    assert.deepEq(tpl.blocks[0].criteria, ['done when shipped'])
    assert.eq(tpl.blocks[1].questions[0].text, 'How fast?')
    assert.eq(tpl.blocks[1].questions[0].answer, undefined, 'answers do not ride into a template')
    assert.eq(tpl.situation.codebase, 'current')
    assert.eq(tpl.mode, 'build')
    assert.eq(listUserTemplates().length, 1)
  })
  it('returns null on an empty canvas and caps the store at twelve', () => {
    const deps = seed()
    assert.eq(saveCurrentAsTemplate('x', { state: { blocks: {}, arrows: [] } }), null)
    for (let i = 0; i < 14; i++) saveCurrentAsTemplate('t' + i, deps)
    assert.eq(listUserTemplates().length, 12)
    assert.eq(listUserTemplates()[0].name, 't2', 'oldest dropped')
  })
  it('deleteUserTemplate removes exactly one', () => {
    const deps = seed()
    const keep = saveCurrentAsTemplate('keep', deps)
    const gone = saveCurrentAsTemplate('gone', deps)
    deleteUserTemplate(gone.id)
    assert.deepEq(listUserTemplates().map(t => t.name), ['keep'])
    assert.eq(listUserTemplates()[0].id, keep.id)
  })
})
