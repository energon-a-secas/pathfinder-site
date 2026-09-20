import { describe, it, assert } from './test-utils.js'
import { compareCanvases } from '../js/comparison.js'
import { state, ui } from '../js/state.js'
import { takeSnapshot, restoreSnapshot, listSnapshots } from '../js/library.js'

const block = (id, extra = {}) => ({ id, type: 'requirement', title: id, x: 0, y: 0, ...extra })
describe('Snapshot comparison', () => {
  it('provides added, removed and changed blocks with full before/after data', () => {
    const before = { blocks: [block('edit'), block('gone')] }
    const after = { blocks: [block('edit', { x: 400, questions: [{ text: 'Why?', answer: 'Full answer '.repeat(100) }] }), block('new')] }
    const comparison = compareCanvases(before, after)
    assert.deepEq(comparison.blocks.map(b => b.kind), ['changed', 'removed', 'added'])
    assert.includes(comparison.blocks[0].fields, 'x')
    assert.includes(comparison.blocks[0].fields, 'questions')
    assert.eq(comparison.blocks[0].after.questions[0].answer.length, 1200)
  })
  it('compares edge meaning, groups and settings, ignoring regenerated edge IDs', () => {
    const before = { arrows: [{ id: 'old', from: 'a', to: 'b', relation: 'blocks' }], groups: { g: { id: 'g', label: 'Old' } } }
    const after = { arrows: [{ id: 'new', from: 'a', to: 'b', relation: 'informs' }], groups: { g: { id: 'g', label: 'New' } }, meta: { title: 'Release' } }
    const comparison = compareCanvases(before, after)
    assert.deepEq(comparison.arrows[0].fields, ['relation'])
    assert.eq(comparison.groups[0].kind, 'changed')
    assert.eq(comparison.meta[0].id, 'title')
  })
  it('never mutates the source canvases', () => {
    const before = { blocks: [block('a')] }, after = { blocks: [block('b')] }
    const original = JSON.stringify({ before, after })
    const comparison = compareCanvases(before, after)
    comparison.before.blocks.a.title = 'Altered copy'
    assert.eq(JSON.stringify({ before, after }), original)
  })
  it('backs up current content before restoring', () => {
    ui.readOnly = false; ui.embed = false
    localStorage.setItem('pathfinder-map-current', 'compare-test')
    localStorage.removeItem('pathfinder-snaps-compare-test')
    state.blocks = { a: block('a') }; state.arrows = []; state.groups = {}
    const snapshot = takeSnapshot('Original')
    state.blocks.a.title = 'Current work'
    assert.eq(restoreSnapshot(snapshot.id), true)
    assert.eq(state.blocks.a.title, 'a')
    assert.eq(listSnapshots().at(-1).payload.blocks.a.title, 'Current work')
  })
  it('refuses a restore if the backup cannot be written', () => {
    localStorage.setItem('pathfinder-map-current', 'compare-failed')
    localStorage.removeItem('pathfinder-snaps-compare-failed')
    state.blocks = { a: block('a') }; state.arrows = []; state.groups = {}
    const snapshot = takeSnapshot('Original')
    state.blocks.a.title = 'Keep unsaved work'
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('pathfinder-snaps-')) throw new DOMException('Full', 'QuotaExceededError')
      return original.call(this, key, value)
    }
    try {
      assert.eq(restoreSnapshot(snapshot.id), false)
      assert.eq(state.blocks.a.title, 'Keep unsaved work')
    } finally { Storage.prototype.setItem = original }
  })
})
