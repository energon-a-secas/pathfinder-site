import { describe, it, assert } from './test-utils.js'
import { state, saveState, saveStatus, saveHooks, debouncedSave } from '../js/state.js'
import { newMap, currentId, ensureLibrary } from '../js/library.js'

describe('Save reliability', () => {
  it('reports storage failure, retains the live map, and recovers on retry', () => {
    const original = Storage.prototype.setItem
    const before = JSON.stringify(state)
    try {
      Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError') }
      assert.eq(saveState(), false)
      assert.eq(saveStatus.phase, 'error')
      assert.includes(saveStatus.message, 'Download a backup')
      assert.eq(JSON.stringify(state), before)
    } finally { Storage.prototype.setItem = original }
    assert.eq(saveState(), true)
    assert.eq(saveStatus.phase, 'saved')
    assert.ok(saveStatus.savedAt)
  })
  it('does not claim success when the library copy fails', () => {
    const fail = () => false
    saveHooks.push(fail)
    try { assert.eq(saveState(), false); assert.eq(saveStatus.phase, 'error') }
    finally { saveHooks.splice(saveHooks.indexOf(fail), 1) }
    saveState()
  })
  it('shows pending status immediately and saves after the debounce', async () => {
    debouncedSave()
    assert.eq(saveStatus.phase, 'pending')
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.eq(saveStatus.phase, 'saved')
  })
  it('keeps the current map open if flushing outgoing work fails', () => {
    ensureLibrary()
    const id = currentId(), before = JSON.stringify(state)
    const fail = () => false
    saveHooks.push(fail)
    try { assert.eq(newMap(), false); assert.eq(currentId(), id); assert.eq(JSON.stringify(state), before) }
    finally { saveHooks.splice(saveHooks.indexOf(fail), 1) }
    saveState()
  })
})
