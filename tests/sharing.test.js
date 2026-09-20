import { describe, it, assert } from './test-utils.js'
import { state, ui, canvasMeta, serializeCanvas, applyPromptOpts } from '../js/state.js'
import { checkShareUrl, checkSrcUrl } from '../js/ui-panels.js'
import { applyImport } from '../js/export.js'

const shared = {
  blocks: {
    shared: { id: 'shared', type: 'goal', title: 'Shared goal' },
    task: { id: 'task', type: 'requirement', title: 'Shared requirement' },
  },
  arrows: [{ id: 'connection', from: 'shared', to: 'task' }],
  meta: { title: '' },
}

async function isolated(fn) {
  const before = JSON.parse(JSON.stringify(serializeCanvas()))
  const flags = { readOnly: ui.readOnly, embed: ui.embed }
  const url = location.href
  const confirm = window.confirm, fetch = window.fetch
  const saved = localStorage.getItem('pathfinder-v1')
  try {
    state.blocks = { private: { id: 'private', type: 'goal', title: 'Private goal' } }
    state.arrows = []; state.groups = {}; canvasMeta.title = 'Private map'
    localStorage.setItem('pathfinder-v1', 'private document')
    ui.readOnly = false; ui.embed = false
    await fn()
    // Let import rendering settle before restoring the test fixture.
    await new Promise(requestAnimationFrame)
  } finally {
    Object.assign(state, { blocks: before.blocks, arrows: before.arrows, groups: before.groups })
    Object.assign(canvasMeta, before.meta)
    applyPromptOpts(before.meta.prompt)
    Object.assign(ui, flags)
    window.confirm = confirm; window.fetch = fetch
    history.replaceState(null, '', url)
    if (saved === null) localStorage.removeItem('pathfinder-v1')
    else localStorage.setItem('pathfinder-v1', saved)
  }
}

describe('Shared link loading', () => {
  for (const embed of [false, true]) {
    it(`${embed ? 'embedded' : 'view-only'} links keep their URL and never merge or save private work`, () => isolated(() => {
      ui.readOnly = true; ui.embed = embed
      const hash = '#s=' + btoa(encodeURIComponent(JSON.stringify(shared)))
      history.replaceState(null, '', '?readonly' + (embed ? '&embed' : '') + hash)
      let prompts = 0
      window.confirm = () => { prompts++; return false }
      assert.eq(checkShareUrl(), true)
      assert.eq(prompts, 0)
      assert.eq(location.hash, hash)
      assert.ok(state.blocks.shared)
      assert.ok(!state.blocks.private)
      assert.eq(localStorage.getItem('pathfinder-v1'), 'private document')
      assert.eq(canvasMeta.title, '', 'untitled shared canvas does not inherit the private title')
    }))
  }
  it('read-only URL sources remain reloadable and do not save', () => isolated(async () => {
    ui.readOnly = true
    history.replaceState(null, '', '?readonly&src=%2Fshared.json&theme=default')
    let prompts = 0
    window.confirm = () => { prompts++; return false }
    window.fetch = async () => ({ ok: true, text: async () => JSON.stringify(shared) })
    await checkSrcUrl()
    assert.eq(new URLSearchParams(location.search).get('src'), '/shared.json')
    assert.eq(prompts, 0)
    assert.ok(state.blocks.shared && !state.blocks.private)
    assert.eq(localStorage.getItem('pathfinder-v1'), 'private document')
  }))
  it('editable share imports retain unrelated query options and save the incoming title', () => isolated(() => {
    history.replaceState(null, '', '?theme=default#s=' + btoa(encodeURIComponent(JSON.stringify(shared))))
    window.confirm = () => true
    assert.eq(checkShareUrl(), true)
    assert.eq(location.hash, '')
    assert.eq(location.search, '?theme=default')
    assert.eq(JSON.parse(localStorage.getItem('pathfinder-v1')).meta.title, '')
  }))
  it('replacement preserves connection IDs while merging creates fresh IDs', () => isolated(() => {
    applyImport(shared, 'replace')
    assert.eq(state.arrows[0].id, 'connection')
    applyImport(shared, 'merge')
    assert.eq(state.arrows.length, 2)
    assert.neq(state.arrows[1].id, 'connection')
  }))
  it('replacement repairs duplicate connection IDs from imported files', () => isolated(() => {
    applyImport({ ...shared, arrows: [...shared.arrows, { id: 'connection', from: 'task', to: 'shared' }] }, 'replace')
    assert.eq(state.arrows.length, 2)
    assert.eq(new Set(state.arrows.map(arrow => arrow.id)).size, 2)
  }))
})
