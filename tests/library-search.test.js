import { describe, it, assert } from './test-utils.js'
import { state, canvasMeta, ui } from '../js/state.js'
import { searchSavedMaps } from '../js/library.js'

function seed() {
  ui.readOnly = false; ui.embed = false
  localStorage.setItem('pathfinder-map-current', 'search-live')
  localStorage.setItem('pathfinder-maps', JSON.stringify([{ id: 'search-live' }, { id: 'search-other' }, { id: 'search-broken' }]))
  localStorage.setItem('pathfinder-map-search-live', JSON.stringify({ blocks: [{ id: 'same', type: 'goal', title: 'Stale title' }] }))
  localStorage.setItem('pathfinder-map-search-other', JSON.stringify({ blocks: [{ id: 'same', type: 'requirement', title: 'Deploy service', status: 'blocked', notes: 'Retry safely' }], meta: { title: 'Release' } }))
  localStorage.setItem('pathfinder-map-search-broken', '{bad json')
  state.blocks = { same: { id: 'same', type: 'goal', title: 'Deploy live', notes: 'Unsaved change' } }
  canvasMeta.title = 'Live plan'
}

describe('Search across saved maps', () => {
  it('uses live unsaved content and distinguishes identical block IDs', () => {
    seed()
    const results = searchSavedMaps('deploy')
    assert.eq(results.length, 2)
    assert.eq(results[0].mapId, 'search-live')
    assert.eq(results[1].mapName, 'Release')
    assert.eq(searchSavedMaps('unsaved')[0].current, true)
    assert.eq(searchSavedMaps('stale').length, 0)
  })
  it('searches notes and applies type and status filters across maps', () => {
    seed()
    const results = searchSavedMaps('retry', { type: 'requirement', status: 'blocked' })
    assert.eq(results.length, 1)
    assert.eq(results[0].mapId, 'search-other')
  })
  it('does not flush, switch maps, or alter stored payloads', () => {
    seed()
    const before = JSON.stringify({ ...localStorage })
    searchSavedMaps('deploy')
    assert.eq(JSON.stringify({ ...localStorage }), before)
  })
  it('never exposes private maps in read-only or embedded views', () => {
    seed()
    try {
      ui.readOnly = true
      assert.eq(searchSavedMaps('').length, 0)
      ui.readOnly = false; ui.embed = true
      assert.eq(searchSavedMaps('').length, 0)
    } finally { ui.readOnly = false; ui.embed = false }
  })
})
