// ============================================================
//  snapshots.test.js -- Map snapshots: store, cap, diff
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { state, canvasMeta, devOpts } from '../js/state.js'
import { listSnapshots, takeSnapshot, deleteSnapshot, diffPayloads } from '../js/library.js'

function seedSnapState() {
  state.blocks = { a: { id: 'a', type: 'goal', title: 'A', description: '', x: 0, y: 0, actions: [], questions: [], criteria: [], rationale: '' } }
  state.arrows = []
  state.groups = {}
  canvasMeta.title = 'Snap test'
  localStorage.setItem('pathfinder-map-current', 'snaptest-map')
  localStorage.removeItem('pathfinder-snaps-snaptest-map')
}

describe('takeSnapshot() / listSnapshots()', () => {
  it('stores a named full copy for the current map', () => {
    seedSnapState()
    const snap = takeSnapshot('before it all')
    assert.ok(snap)
    const snaps = listSnapshots('snaptest-map')
    assert.eq(snaps.length, 1)
    assert.eq(snaps[0].name, 'before it all')
    assert.ok(snaps[0].payload.blocks.a, 'the payload is a real copy')
    state.blocks.a.title = 'Later edit'
    assert.eq(snap.payload.blocks.a.title, 'A', 'the returned snapshot is detached too')
  })
  it('caps at eight, dropping the oldest', () => {
    seedSnapState()
    for (let i = 0; i < 10; i++) takeSnapshot('s' + i)
    const snaps = listSnapshots('snaptest-map')
    assert.eq(snaps.length, 8)
    assert.eq(snaps[0].name, 's2', 'oldest two dropped')
  })
  it('deleteSnapshot removes exactly one', () => {
    seedSnapState()
    takeSnapshot('keep'); const gone = takeSnapshot('gone')
    deleteSnapshot(gone.id, 'snaptest-map')
    const names = listSnapshots('snaptest-map').map(s => s.name)
    assert.deepEq(names, ['keep'])
  })
})

describe('diffPayloads()', () => {
  const P = blocks => ({ blocks: Object.fromEntries(Object.entries(blocks).map(([id, b]) => [id, { type: 'goal', ...b }])), arrows: [] })
  it('counts added, removed and changed blocks and arrow delta', () => {
    const a = P({ x: { id: 'x', title: 'One', description: '' }, y: { id: 'y', title: 'Two', description: '' } })
    const b = P({ x: { id: 'x', title: 'One changed', description: '' }, z: { id: 'z', title: 'New', description: '' } })
    b.arrows = [{ id: 'a1', from: 'x', to: 'z' }]
    const d = diffPayloads(a, b)
    assert.includes(d, '+1 block')
    assert.includes(d, '-1')
    assert.includes(d, '1 changed')
    assert.includes(d, '+1 arrow')
  })
  it('says so when nothing changed', () => {
    const a = P({ x: { id: 'x', title: 'One', description: '' } })
    assert.eq(diffPayloads(a, a), 'no changes')
  })
  it('detects review notes, question answers, actions, priority and movement', () => {
    const a = P({ x: { id: 'x', title: 'One' } })
    for (const edit of [{ notes: 'Review: clarify' }, { questions: [{ text: 'Why?', answer: 'Because' }] },
      { actions: ['validate'] }, { priority: 'high' }, { x: 80 }, { docRef: { label: 'Design doc' } }]) {
      const b = P({ x: { ...a.blocks.x, ...edit } })
      assert.includes(diffPayloads(a, b), '1 changed')
    }
  })
  it('detects changed connection text even when arrow counts stay the same', () => {
    const a = { ...P({}), arrows: [{ from: 'x', to: 'y', label: 'enables' }] }
    const b = { ...P({}), arrows: [{ from: 'x', to: 'y', label: 'blocks' }] }
    assert.includes(diffPayloads(a, b), '1 arrow changed')
  })
  it('detects rewiring instead of reporting no changes for equal arrow counts', () => {
    const a = { ...P({}), arrows: [{ from: 'x', to: 'y' }] }
    const b = { ...P({}), arrows: [{ from: 'x', to: 'z' }] }
    assert.includes(diffPayloads(a, b), '+1 arrow')
    assert.includes(diffPayloads(a, b), '-1 arrow')
  })
  it('detects map framing and group changes', () => {
    assert.includes(diffPayloads(P({}), { ...P({}), meta: { title: 'Renamed' } }), 'map settings changed')
    assert.includes(diffPayloads(P({}), { ...P({}), groups: { g: { id: 'g', label: 'Sprint' } } }), 'groups changed')
  })
  it('ignores storage defaults and regenerated arrow IDs', () => {
    const a = { ...P({}), arrows: [{ id: 'old', from: 'x', to: 'y' }] }
    const b = { ...P({}), arrows: [{ id: 'new', from: 'x', to: 'y', style: 'curved', weight: 2 }] }
    assert.eq(diffPayloads(a, b), 'no changes')
  })
})
