// ============================================================
//  library.test.js -- Canvas library: migration, create, open,
//  duplicate, delete. Snapshots and diffs live in snapshots.test.js.
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { state, view, canvasMeta, promptState, saveState, saveHooks, applyPromptOpts } from '../js/state.js'
import { currentId, writeThrough, ensureLibrary, switchTo, newMap, duplicateCurrent, deleteMap } from '../js/library.js'

// Remove every library key so each test starts from a browser that has
// never seen the Maps menu. run-tests.html restores the real user's
// pathfinder-* keys after the run, so this is safe to do for real.
function wipeLibrary() {
  const kill = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && (k === 'pathfinder-maps' || k === 'pathfinder-map-current' ||
              k.startsWith('pathfinder-map-') || k.startsWith('pathfinder-snaps-') ||
              k.startsWith('pathfinder-view'))) kill.push(k)
  }
  kill.forEach(k => localStorage.removeItem(k))
}

function block(id, title) {
  return { id, type: 'goal', title, description: '', notes: '', x: 40, y: 40,
           actions: [], questions: [], criteria: [], rationale: '' }
}

// A single-canvas user from before the library existed: a canvas in
// memory, autosaved under pathfinder-v1, and no library keys at all.
function seedLegacyUser() {
  wipeLibrary()
  state.blocks = { m1: block('m1', 'Legacy block') }
  state.arrows = []
  state.groups = {}
  canvasMeta.title = 'Legacy plan'
  saveState()
}

function readIndex() {
  return JSON.parse(localStorage.getItem('pathfinder-maps') || '[]')
}
function readSlot(id) {
  const raw = localStorage.getItem('pathfinder-map-' + id)
  return raw ? JSON.parse(raw) : null
}

describe('ensureLibrary(): migrating the pre-library canvas', () => {
  it('adopts the existing pathfinder-v1 document as the first map', () => {
    seedLegacyUser()
    assert.eq(currentId(), null, 'no library yet')
    ensureLibrary()
    const id = currentId()
    assert.ok(id, 'a current map id exists after migration')
    const slot = readSlot(id)
    assert.ok(slot && slot.blocks.m1, 'the legacy canvas landed in its own slot')
    assert.eq(slot.meta.title, 'Legacy plan')
    const index = readIndex()
    assert.eq(index.length, 1)
    assert.eq(index[0].id, id)
    assert.eq(index[0].name, 'Legacy plan')
  })
  it('leaves pathfinder-v1 in place as the active-canvas pointer', () => {
    seedLegacyUser()
    ensureLibrary()
    const live = JSON.parse(localStorage.getItem('pathfinder-v1'))
    assert.ok(live.blocks.m1, 'the old key still holds the active canvas')
  })
  it('is a no-op when the library already exists', () => {
    seedLegacyUser()
    ensureLibrary()
    const id = currentId()
    ensureLibrary()
    assert.eq(currentId(), id, 'the current map is unchanged')
    assert.eq(readIndex().length, 1, 'no duplicate row')
  })
})

describe('newMap() / switchTo() / duplicateCurrent() / deleteMap()', () => {
  it('newMap starts an empty canvas and keeps the old one in the library', () => {
    seedLegacyUser()
    ensureLibrary()
    const first = currentId()
    promptState.lastSnapshot = 'previous map export'
    newMap()
    const second = currentId()
    assert.neq(second, first)
    assert.deepEq(state.blocks, {}, 'the new canvas is empty')
    assert.eq(promptState.lastSnapshot, null, 'export tracking does not cross into the new map')
    assert.eq(canvasMeta.title, '', 'new map has no inherited title')
    assert.eq(JSON.parse(localStorage.getItem('pathfinder-v1')).meta.title, '', 'autosave has the same title')
    assert.deepEq(view, { panX: 0, panY: 0, zoom: 1 }, 'new map starts with a clean camera')
    assert.eq(readIndex().length, 2)
    assert.ok(readSlot(first).blocks.m1, 'the first map kept its content')
  })

  it('switchTo flushes the outgoing canvas and loads the target', () => {
    seedLegacyUser()
    ensureLibrary()
    const a = currentId()
    // setupLibrary registers this hook in the app; the harness never runs
    // setupLibrary (it needs the header DOM), so register it by hand.
    saveHooks.push(writeThrough)
    try {
      newMap()
      const b = currentId()
      state.blocks = { bb: block('bb', 'B only') }
      switchTo(a)
      assert.eq(currentId(), a)
      assert.ok(state.blocks.m1, 'the first canvas is back on screen')
      assert.ok(!state.blocks.bb)
      assert.ok(readSlot(b).blocks.bb, 'the outgoing edit was flushed into its slot')
    } finally {
      saveHooks.splice(saveHooks.indexOf(writeThrough), 1)
    }
  })

  it('duplicateCurrent copies content and lands on the copy', () => {
    seedLegacyUser()
    ensureLibrary()
    const orig = currentId()
    duplicateCurrent()
    const copy = currentId()
    assert.neq(copy, orig)
    assert.eq(canvasMeta.title, 'Legacy plan copy')
    assert.ok(state.blocks.m1, 'the content came along')
    assert.eq(readIndex().length, 2)
  })

  it('switching immediately after panning preserves each map camera', async () => {
    seedLegacyUser()
    ensureLibrary()
    const first = currentId()
    newMap()
    const second = currentId()
    await new Promise(requestAnimationFrame)
    Object.assign(view, { panX: 81, panY: 27, zoom: .7 })
    switchTo(first)
    await new Promise(requestAnimationFrame)
    Object.assign(view, { panX: 900, panY: -10, zoom: 1.5 })
    switchTo(second)
    assert.deepEq(view, { panX: 81, panY: 27, zoom: .7 })
    switchTo(first)
    assert.deepEq(view, { panX: 900, panY: -10, zoom: 1.5 })
  })

  it('new maps do not inherit a legacy global camera', () => {
    seedLegacyUser()
    ensureLibrary()
    localStorage.setItem('pathfinder-view', JSON.stringify({ panX: 999, panY: 888, zoom: 2 }))
    newMap()
    assert.deepEq(view, { panX: 0, panY: 0, zoom: 1 })
  })

  it('deleteMap removes the slot, its snapshots and its index row', () => {
    seedLegacyUser()
    ensureLibrary()
    const a = currentId()
    newMap()
    const b = currentId()
    localStorage.setItem('pathfinder-snaps-' + a, '[]')
    deleteMap(a)
    assert.eq(currentId(), b, 'still on the map that was not deleted')
    assert.eq(readSlot(a), null)
    assert.eq(localStorage.getItem('pathfinder-snaps-' + a), null)
    assert.eq(readIndex().length, 1)
    assert.eq(readIndex()[0].id, b)
  })

  it('deleting the current map switches to the next one', () => {
    seedLegacyUser()
    ensureLibrary()
    const a = currentId()
    newMap()
    const b = currentId()
    deleteMap(b)
    assert.eq(currentId(), a)
    assert.ok(state.blocks.m1, 'the surviving map loaded')
  })

  it('deleting the only map leaves a fresh empty one', () => {
    seedLegacyUser()
    ensureLibrary()
    const only = currentId()
    deleteMap(only)
    const fresh = currentId()
    assert.ok(fresh, 'a map always exists')
    assert.neq(fresh, only)
    assert.deepEq(state.blocks, {})
    assert.eq(readIndex().length, 1)
    // Leave a clean slate for the suites that run after this one.
    wipeLibrary()
    state.blocks = {}; state.arrows = []; state.groups = {}
    canvasMeta.title = ''
    applyPromptOpts({ mode: 'plan', tone: 'auto', detail: 'standard', pre: [] })
  })
})
