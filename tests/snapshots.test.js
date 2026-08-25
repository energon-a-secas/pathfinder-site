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
  const P = blocks => ({ blocks, arrows: [] })
  it('counts added, removed and changed blocks and arrow delta', () => {
    const a = P({ x: { id: 'x', title: 'One', description: '' }, y: { id: 'y', title: 'Two', description: '' } })
    const b = { blocks: { x: { id: 'x', title: 'One changed', description: '' }, z: { id: 'z', title: 'New', description: '' } },
                arrows: [{ id: 'a1' }] }
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
})
