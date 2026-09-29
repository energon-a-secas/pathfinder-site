// ============================================================
//  data-safety.test.js -- what keeps a map intact across builds
//  and tabs: the save stamp, the per-tab map, and the offer to
//  restore blocks an older build of Pathfinder dropped.
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { state, ui, view, canvasMeta, saveState, saveStatus, saveHooks, loadState, loadView, lastLoad, serializeCanvas,
         serializeForShare, applyPromptOpts, getUndoHistory, getRedoFuture, buildShareUrlAsync,
         decodeShareHash, canCompressLinks } from '../js/state.js'
import { normalizeCanvas, normalizeBlock, normalizeArrow, SCHEMA_VERSION, schemaOf } from '../js/normalize.js'
import { currentId, ensureLibrary, writeThrough, switchTo, newMap, deleteMap, forgetTabMap, rearmTabLoad,
         rememberedTabMap, readLastGood, findOlderVersionLoss, checkOlderVersionLoss, checkStorageForOlderVersion,
         pendingOlderVersionLoss, restoreOlderVersionLoss, dismissOlderVersionLoss, resetOlderVersionState,
         sweepLastGood, diffPayloads, isSavedCanvas, checkLoadForOlderVersion, freeLastGoodSpace,
         storedShape, PRE_REGISTRY_TYPES, writerKnewEveryType, writerSigns, listSnapshots,
         mapWithPendingLoss } from '../js/library.js'
import { setupSharingSafety, showOlderVersionBanner, olderVersionText, touchesThisMap,
         hasContent, openIncoming, incomingDialog, incomingMessage } from '../js/sharing.js'
import { compareCanvases } from '../js/comparison.js'
import { undo } from '../js/render.js'

const TAB_KEY = 'pathfinder-tab-map'

// The map this tab had open (library.js keeps it in sessionStorage, and a
// reload reopens it). A tab that came here from the app still has it, and
// the suite's first loadState() would read that map instead of its fixture.
// This runs when the suite imports this file, before any test runs; the
// entry comes back when the page goes.
{
  let mine = null
  try { mine = sessionStorage.getItem(TAB_KEY); sessionStorage.removeItem(TAB_KEY) } catch (_) {}
  window.addEventListener('pagehide', () => {
    try { if (mine == null) sessionStorage.removeItem(TAB_KEY); else sessionStorage.setItem(TAB_KEY, mine) } catch (_) {}
  })
}
const slot = id => 'pathfinder-map-' + id
const good = id => 'pathfinder-lastgood-' + id

// The 13 types the builds before the stamp knew. Everything else they
// dropped on load, and their next autosave kept the loss.
const PRE_STAMP = ['goal', 'problem', 'requirement', 'assumption', 'risk', 'decision',
  'question', 'resource', 'output', 'process', 'terminator', 'context', 'custom']

// A small reporting map with three blocks an older build cannot read.
function fixture() {
  const b = (id, type, title, x) => normalizeBlock({ id, type, title, x, y: 0 })
  return {
    blocks: {
      g1: b('g1', 'goal', 'Faster monthly close', 0),
      r1: b('r1', 'requirement', 'Status notes per deliverable', 300),
      i1: b('i1', 'implementation', 'Build the status notes job', 600),
      m1: b('m1', 'metric', 'Days to publish the report', 900),
      s1: b('s1', 'stakeholder', 'Portfolio reporting leads', 1200),
    },
    arrows: [
      { id: 'a1', from: 'i1', to: 'r1', style: 'routed', label: 'satisfies' },
      { id: 'a2', from: 'i1', to: 'm1', style: 'routed' },
      { id: 'a3', from: 'm1', to: 'g1', style: 'routed' },
      { id: 'a4', from: 's1', to: 'g1', style: 'routed' },
      { id: 'a5', from: 'r1', to: 'g1', style: 'routed' },
    ].map(normalizeArrow),
  }
}

/** The open map holds the fixture, saved by this build (slot + last-good). */
function seedMap(title = 'Reporting cadence') {
  const f = fixture()
  state.blocks = f.blocks; state.arrows = f.arrows; state.groups = {}
  canvasMeta.title = title; canvasMeta.contextBrief = ''
  ensureLibrary()
  saveState()
  return currentId()
}

// What a pre-registry build (4ea4d6d) rebuilt each block and arrow from:
// the fields it knew. No `pattern`, `typeHint`, `typeCheck` or `gapAck`.
const OLD_BLOCK_KEYS = ['id', 'type', 'title', 'description', 'notes', 'x', 'y', 'actions', 'questions', 'docRef',
  'width', 'color', 'collapsed', 'groupId', 'status', 'priority', 'cardStyle', 'borderWidth', 'highlight', 'criteria', 'rationale']
const OLD_ARROW_KEYS = ['id', 'from', 'to', 'relation', 'style', 'bidirectional', 'color', 'weight', 'label', 'note', 'fromPort', 'toPort']
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]))

/**
 * What a build before the stamp and the registry did with a map: load it
 * through its normalize (unknown types dropped, every block and arrow
 * rebuilt from the fields it knew, meta rebuilt from the keys it knew, so
 * no stamp), then autosave. `drop` removes more blocks, as a person
 * deleting them in that older tab would.
 */
function olderBuildSave(id, { drop = [], storageKey = true } = {}) {
  const cur = JSON.parse(localStorage.getItem(slot(id)))
  const blocks = {}
  Object.values(cur.blocks).forEach(b => { if (PRE_STAMP.includes(b.type) && !drop.includes(b.id)) blocks[b.id] = pick(b, OLD_BLOCK_KEYS) })
  const arrows = cur.arrows.map(a => ({ ...pick(a, OLD_ARROW_KEYS), ...(a.portsBy === 'tidy' ? { portsBy: 'tidy' } : {}) }))
  const { title, contextBrief, cardStyle, spotlight, situation, prompt } = cur.meta
  const json = JSON.stringify({ blocks, arrows, groups: cur.groups, meta: { title, contextBrief, cardStyle, spotlight, situation, prompt } })
  if (storageKey) localStorage.setItem('pathfinder-v1', json)
  localStorage.setItem(slot(id), json)
  return json
}

/**
 * What a registry build before the stamp (the live 614c549) did: it knew
 * every type and dropped none, wrote `pattern` on every arrow it loaded,
 * and saved no stamp. `drop` is a person deleting blocks in that tab, with
 * the connections that touched them.
 */
function registryBuildSave(id, { drop = [], storageKey = true, arrows: keepArrows = true } = {}) {
  const cur = JSON.parse(localStorage.getItem(slot(id)))
  const blocks = {}
  Object.values(cur.blocks).forEach(b => { if (!drop.includes(b.id)) blocks[b.id] = b })
  const arrows = keepArrows ? cur.arrows.filter(a => blocks[a.from] && blocks[a.to]).map(a => ({ ...a, pattern: a.pattern || 'solid' })) : []
  const meta = { ...cur.meta }
  delete meta.schema
  const json = JSON.stringify({ blocks, arrows, groups: cur.groups, meta })
  if (storageKey) localStorage.setItem('pathfinder-v1', json)
  localStorage.setItem(slot(id), json)
  return json
}

/** What a page load does before setupLibrary's first save stamps it. */
function reloadPage() {
  rearmTabLoad()
  loadState()
  return checkOlderVersionLoss(currentId(), lastLoad, 'load')
}

const banner = () => document.getElementById('olderVersionBanner')
const ids = obj => Object.keys(obj).sort()

// ── Isolation ───────────────────────────────────────────────

function keepStorage() {
  const saved = new Map()
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('pathfinder-')) saved.set(k, localStorage.getItem(k))
  }
  let tab = null
  try { tab = sessionStorage.getItem(TAB_KEY) } catch (_) {}
  return () => {
    const now = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('pathfinder-')) now.push(k)
    }
    now.forEach(k => { if (!saved.has(k)) localStorage.removeItem(k) })
    saved.forEach((v, k) => localStorage.setItem(k, v))
    try { if (tab == null) sessionStorage.removeItem(TAB_KEY); else sessionStorage.setItem(TAB_KEY, tab) } catch (_) {}
  }
}

async function sandbox(fn) {
  const before = JSON.parse(JSON.stringify(serializeCanvas()))
  const flags = { readOnly: ui.readOnly, embed: ui.embed }
  const camera = { ...view }
  const restoreStorage = keepStorage()
  const undoLen = getUndoHistory().length
  const setItem = Storage.prototype.setItem
  saveHooks.push(writeThrough)
  resetOlderVersionState()
  try {
    ui.readOnly = false; ui.embed = false
    setupSharingSafety()
    await fn()
  } finally {
    Storage.prototype.setItem = setItem
    saveHooks.splice(saveHooks.indexOf(writeThrough), 1)
    banner()?.remove()
    document.getElementById('otherTabBanner')?.remove()
    resetOlderVersionState()
    forgetTabMap()
    Object.assign(state, { blocks: before.blocks, arrows: before.arrows, groups: before.groups })
    Object.assign(canvasMeta, before.meta)
    delete canvasMeta.prompt
    delete canvasMeta.schema
    applyPromptOpts(before.meta.prompt)
    Object.assign(ui, flags)
    Object.assign(view, camera)
    getUndoHistory().length = Math.min(getUndoHistory().length, undoLen)
    getRedoFuture().length = 0
    restoreStorage()
  }
}

// ── The stamp ───────────────────────────────────────────────

describe('Data safety: the save stamp', () => {
  it('every local save carries meta.schema, in pathfinder-v1, the slot and the last-good copy', () => sandbox(() => {
    const id = seedMap()
    assert.eq(SCHEMA_VERSION, 2)
    assert.eq(serializeCanvas().meta.schema, SCHEMA_VERSION)
    assert.eq(JSON.parse(localStorage.getItem('pathfinder-v1')).meta.schema, SCHEMA_VERSION)
    assert.eq(JSON.parse(localStorage.getItem(slot(id))).meta.schema, SCHEMA_VERSION)
    assert.eq(JSON.parse(localStorage.getItem(good(id))).meta.schema, SCHEMA_VERSION)
  }))

  it('normalize keeps the stamp beside meta, a newer one included, and drops junk', () => {
    const stamped = normalizeCanvas({ blocks: {}, meta: { title: 'T', schema: 2 } })
    assert.eq(stamped.schema, 2)
    assert.ok(!('schema' in stamped.meta), 'meta holds map settings only')
    assert.eq(normalizeCanvas({ meta: { schema: 7 } }).schema, 7, 'a newer build is not read as older')
    ;[0, -1, 1.5, '2', null, true, [2], {}].forEach(v =>
      assert.ok(!('schema' in normalizeCanvas({ meta: { schema: v } })), `junk stamp ${JSON.stringify(v)} is dropped`))
    assert.ok(!('schema' in normalizeCanvas({ blocks: {} })), 'an unstamped save stays unstamped')
    assert.eq(schemaOf(null), null)
    assert.eq(schemaOf({ meta: [] }), null)
  })

  it('an unstamped save, the shape every older build wrote, still loads', () => sandbox(() => {
    localStorage.setItem('pathfinder-v1', JSON.stringify({
      blocks: { o1: { id: 'o1', type: 'goal', title: 'Written by an older build' } }, arrows: [], meta: { title: 'Old map' },
    }))
    rearmTabLoad()
    try { sessionStorage.removeItem(TAB_KEY) } catch (_) {}
    loadState()
    assert.ok(state.blocks.o1)
    assert.eq(canvasMeta.title, 'Old map')
    assert.eq(lastLoad.schema, null)
    assert.ok(lastLoad.save)
  }))

  it('share links keep the shape they always had, and decode to the saved meta', () => sandbox(async () => {
    seedMap()
    assert.ok(!('schema' in serializeForShare().meta), 'the stamp describes a local save, not a link')
    if (!canCompressLinks()) return
    const url = await buildShareUrlAsync()
    const decoded = await decodeShareHash(url.slice(url.indexOf('#')))
    assert.ok(!('schema' in decoded.meta))
    assert.deepEq(normalizeCanvas(decoded).meta, normalizeCanvas(JSON.parse(JSON.stringify(serializeCanvas()))).meta)
  }))

  it('a stamped and an unstamped copy of the same map compare as unchanged', () => sandbox(() => {
    seedMap()
    const now = JSON.parse(JSON.stringify(serializeCanvas()))
    const old = JSON.parse(JSON.stringify(now)); delete old.meta.schema
    assert.eq(compareCanvases(old, now).meta.length, 0, 'no "map setting changed" row for the stamp')
    assert.eq(diffPayloads(old, now), 'no changes')
    assert.ok(!touchesThisMap({ key: slot(currentId()), storageArea: localStorage, newValue: JSON.stringify(old) }),
      'another tab saving the same map without the stamp is not a change')
  }))
})

// ── The per-tab map ─────────────────────────────────────────

describe('Data safety: each tab reloads into its own map', () => {
  // Another tab opened map B and saved it: the pointer and pathfinder-v1 name B.
  function anotherTabOpens(title) {
    const id = 'tab-other-' + Math.random().toString(36).slice(2, 8)
    const payload = { blocks: { b1: normalizeBlock({ id: 'b1', type: 'risk', title: 'Only in ' + title }) }, arrows: [], groups: {}, meta: { title, schema: 2 } }
    localStorage.setItem(slot(id), JSON.stringify(payload))
    localStorage.setItem('pathfinder-v1', JSON.stringify(payload))
    localStorage.setItem('pathfinder-map-current', id)
    return id
  }

  it('opening a map remembers it for this tab', () => sandbox(() => {
    const a = seedMap('Map A')
    assert.eq(rememberedTabMap(), a)
    newMap()
    const b = currentId()
    assert.neq(b, a)
    assert.eq(rememberedTabMap(), b)
    switchTo(a)
    assert.eq(rememberedTabMap(), a)
  }))

  it('a reload reopens this tab\'s map after another tab moved the pointer', () => sandbox(() => {
    const a = seedMap('Map A')
    const b = anotherTabOpens('Map B')
    forgetTabMap()
    rearmTabLoad()
    loadState()
    assert.eq(canvasMeta.title, 'Map A')
    assert.ok(state.blocks.g1 && !state.blocks.b1, "this tab's map, not the one saved last")
    assert.eq(lastLoad.key, slot(a))
    assert.eq(currentId(), a)
    // The first save puts the pointer back on this map, so a fresh load
    // (and every other tab's pointer logic) agrees with what pathfinder-v1 holds.
    saveState()
    assert.eq(localStorage.getItem('pathfinder-map-current'), a)
    assert.ok(JSON.parse(localStorage.getItem('pathfinder-v1')).blocks.g1)
    assert.ok(JSON.parse(localStorage.getItem(slot(b))).blocks.b1, "the other tab's map is untouched")
  }))

  it('two tabs on two maps each reload into their own', () => sandbox(() => {
    const a = seedMap('Map A')
    const b = anotherTabOpens('Map B')
    // Tab one (remembers A) reloads, and saves.
    sessionStorage.setItem(TAB_KEY, a); forgetTabMap(); rearmTabLoad(); loadState()
    assert.eq(canvasMeta.title, 'Map A')
    saveState()
    // Tab two (remembers B) reloads after tab one's save moved the pointer to A.
    sessionStorage.setItem(TAB_KEY, b); forgetTabMap(); rearmTabLoad(); loadState()
    assert.eq(canvasMeta.title, 'Map B')
    assert.ok(state.blocks.b1)
    assert.eq(currentId(), b)
  }))

  it('a new tab, a deleted map, or a map that is already the pointer read pathfinder-v1 as before', () => sandbox(() => {
    seedMap('Map A')
    anotherTabOpens('Map B')
    sessionStorage.removeItem(TAB_KEY); forgetTabMap(); rearmTabLoad(); loadState()
    assert.eq(canvasMeta.title, 'Map B', 'nothing remembered: the pointer\'s map')
    assert.eq(lastLoad.key, 'pathfinder-v1')
    sessionStorage.setItem(TAB_KEY, 'tab-deleted-map'); forgetTabMap(); rearmTabLoad(); loadState()
    assert.eq(canvasMeta.title, 'Map B', 'a remembered map that no longer exists falls back')
    assert.eq(lastLoad.key, 'pathfinder-v1')
  }))

  it('only the load that opens the page is a reload', () => sandbox(() => {
    const a = seedMap('Map A')
    anotherTabOpens('Map B')
    sessionStorage.setItem(TAB_KEY, a); forgetTabMap(); rearmTabLoad()
    loadState()
    assert.eq(canvasMeta.title, 'Map A')
    loadState()
    assert.eq(canvasMeta.title, 'Map B', 'a later loadState() reads pathfinder-v1')
  }))

  it("the camera comes back with this tab's map", () => sandbox(() => {
    const a = seedMap('Map A')
    localStorage.setItem('pathfinder-view:' + a, JSON.stringify({ panX: 123, panY: -45, zoom: 0.8 }))
    const b = anotherTabOpens('Map B')
    localStorage.setItem('pathfinder-view:' + b, JSON.stringify({ panX: 9, panY: 9, zoom: 2 }))
    forgetTabMap(); rearmTabLoad(); loadState()
    assert.ok(loadView())
    assert.eq(view.panX, 123)
    assert.eq(view.zoom, 0.8)
  }))
})

// ── Older builds ────────────────────────────────────────────

describe('Data safety: restoring what an older build dropped', () => {
  it('finds the dropped blocks on load and offers them in a banner', () => sandbox(() => {
    const id = seedMap()
    olderBuildSave(id)
    const loss = reloadPage()
    assert.ok(loss, 'the loss is found')
    assert.deepEq([...loss.ids].sort(), ['i1', 'm1', 's1'])
    assert.deepEq(loss.arrows.map(a => a.id).sort(), ['a1', 'a2', 'a3', 'a4'], 'every connection that touched them')
    assert.deepEq(ids(state.blocks), ['g1', 'r1'], 'the canvas is what the older build left')
    const el = banner()
    assert.ok(el, 'the banner is up')
    assert.eq(el.getAttribute('role'), 'alert')
    assert.ok(el.hasAttribute('data-canvas-ui'))
    assert.eq(el.parentElement?.id, 'canvasViewport')
    assert.eq(el.querySelector('.older-version-text').textContent,
      'An older version of Pathfinder saved this map and dropped 3 blocks it does not understand. Restore them?')
    const buttons = [...el.querySelectorAll('button')]
    assert.deepEq(buttons.map(b => b.textContent), ['Restore', 'Dismiss'])
    buttons.forEach(b => assert.eq(b.type, 'button'))
    assert.eq(document.getElementById('otherTabBanner'), null)
  }))

  it('holds the last-good copy until answered, across a reload', () => sandbox(() => {
    const id = seedMap()
    olderBuildSave(id)
    reloadPage()
    saveState() // the init save stamps what the older build left
    assert.eq(JSON.parse(localStorage.getItem(slot(id))).meta.schema, SCHEMA_VERSION)
    const kept = readLastGood(id)
    assert.ok(kept.blocks.i1 && kept.blocks.m1 && kept.blocks.s1, 'the copy was not overwritten')
    assert.deepEq([...kept.pendingRestore].sort(), ['i1', 'm1', 's1'])
    assert.ok(!('pendingUnsure' in kept), 'its connections showed an older build wrote it')
    // A new page knows nothing in memory; the stamped save alone would pass.
    resetOlderVersionState()
    const again = reloadPage()
    assert.ok(again, 'offered again after the reload')
    assert.deepEq([...again.ids].sort(), ['i1', 'm1', 's1'])
    assert.eq(again.unsure, false, 'and still claimed')
  }))

  it('Restore brings back the blocks with their ids, as one undo step, and saves', () => sandbox(() => {
    const id = seedMap()
    const original = JSON.parse(JSON.stringify(state.blocks))
    olderBuildSave(id)
    reloadPage()
    const steps = getUndoHistory().length
    banner().querySelector('.older-version-restore').click()
    assert.eq(banner(), null, 'the banner closes')
    assert.eq(getUndoHistory().length, steps + 1, 'one undo step')
    assert.deepEq(ids(state.blocks), ['g1', 'i1', 'm1', 'r1', 's1'])
    assert.deepEq(state.blocks.i1, original.i1, 'restored exactly as it was')
    const pairs = state.arrows.map(a => a.from + '>' + a.to)
    assert.eq(new Set(pairs).size, pairs.length, 'no connection twice')
    assert.eq(state.arrows.length, 5)
    const saved = JSON.parse(localStorage.getItem(slot(id)))
    assert.eq(saved.meta.schema, SCHEMA_VERSION)
    assert.ok(saved.blocks.i1 && saved.blocks.m1 && saved.blocks.s1, 'saved')
    assert.ok(!('pendingRestore' in readLastGood(id)), 'answered')
    assert.eq(pendingOlderVersionLoss(), null)
    undo()
    assert.deepEq(ids(state.blocks), ['g1', 'r1'], 'one undo takes them out again')
  }))

  it('Dismiss keeps the map as the older build left it, and does not ask again', () => sandbox(() => {
    const id = seedMap()
    olderBuildSave(id)
    reloadPage()
    const steps = getUndoHistory().length
    banner().querySelector('.older-version-dismiss').click()
    assert.eq(banner(), null)
    assert.eq(getUndoHistory().length, steps, 'nothing to undo')
    assert.deepEq(ids(state.blocks), ['g1', 'r1'])
    const kept = readLastGood(id)
    assert.ok(!kept.blocks.i1 && !('pendingRestore' in kept), 'the copy is now the map as it is')
    resetOlderVersionState()
    assert.eq(reloadPage(), null, 'not offered after a reload')
    olderBuildSave(id)
    assert.eq(reloadPage(), null, 'nor when the older build saves the same map again')
    assert.eq(banner(), null)
  }))

  it('no false positive after a normal save', () => sandbox(() => {
    seedMap()
    assert.eq(reloadPage(), null)
    saveState()
    assert.eq(reloadPage(), null)
    assert.eq(banner(), null)
  }))

  it('no false positive after a legitimate delete, and a deleted block is never offered back', () => sandbox(() => {
    const id = seedMap()
    delete state.blocks.i1
    state.arrows = state.arrows.filter(a => a.from !== 'i1' && a.to !== 'i1')
    saveState()
    assert.eq(reloadPage(), null, 'deleted in this build: nothing to restore')
    olderBuildSave(id)
    const loss = reloadPage()
    assert.deepEq([...loss.ids].sort(), ['m1', 's1'], 'the deleted block stays deleted')
  }))

  it('a block deleted in an older pre-registry tab, of a type it knew, is not offered back', () => sandbox(() => {
    const id = seedMap()
    olderBuildSave(id, { drop: ['g1'] }) // dropped i1, m1, s1; the person deleted g1
    const loss = reloadPage()
    assert.deepEq([...loss.ids].sort(), ['i1', 'm1', 's1'], 'only what it could not read')
    assert.eq(banner().querySelector('.older-version-text').textContent,
      'An older version of Pathfinder saved this map and dropped 3 blocks it does not understand. Restore them?')
    assert.eq(olderVersionText({ ids: ['x'], source: 'load' }),
      'An older version of Pathfinder saved this map and dropped 1 block it does not understand. Restore it?')
  }))

  it('a delete in a stale tab of the live registry build (no stamp) raises no banner, on load or live', () => sandbox(() => {
    ;[['i1'], ['g1'], ['i1', 'm1', 's1']].forEach(drop => {
      resetOlderVersionState()
      const id = seedMap()
      const json = registryBuildSave(id, { drop, storageKey: false })
      assert.ok(writerKnewEveryType(JSON.parse(json)), 'the save shows a build that knew every type')
      window.dispatchEvent(new StorageEvent('storage', { key: slot(id), storageArea: localStorage, newValue: json }))
      assert.eq(banner(), null, `deleting ${drop} there is not an older build's loss`)
      assert.ok(document.getElementById('otherTabBanner'), 'it is the ordinary other-tab case')
      document.getElementById('otherTabBanner').remove()
      registryBuildSave(id, { drop })
      assert.eq(reloadPage(), null, `not offered on reload after deleting ${drop}`)
      assert.eq(banner(), null)
    })
  }))

  it('a registry build is told apart by its arrows, or by a type or field only it writes', () => {
    const b = (id, type, extra = {}) => ({ id, type, title: id, ...extra })
    assert.ok(writerKnewEveryType({ blocks: { g: b('g', 'goal') }, arrows: [{ from: 'g', to: 'x', pattern: 'solid' }], meta: {} }))
    assert.ok(writerKnewEveryType({ blocks: { g: b('g', 'goal'), k: b('k', 'metric') }, arrows: [], meta: {} }))
    assert.ok(writerKnewEveryType({ blocks: [b('g', 'custom', { typeHint: 'roadmap' })], meta: {} }))
    assert.ok(writerKnewEveryType({ blocks: { g: b('g', 'goal', { gapAck: ['gap-isolated'] }) }, meta: {} }))
    assert.ok(writerKnewEveryType({ blocks: { g: b('g', 'goal', { typeCheck: true }) }, meta: {} }))
    assert.ok(!writerKnewEveryType({ blocks: { g: b('g', 'goal') }, arrows: [{ from: 'g', to: 'r', style: 'routed' }], meta: {} }),
      'a pre-registry save has none of them')
    assert.ok(!writerKnewEveryType(null))
    assert.deepEq(PRE_REGISTRY_TYPES, PRE_STAMP)
    // Ambiguous (no arrows, no new type left): only the types it could not read count.
    const goodCopy = { blocks: { g: b('g', 'goal'), k: b('k', 'metric') }, arrows: [], meta: { schema: 2 } }
    assert.eq(findOlderVersionLoss(storedShape({ blocks: {}, arrows: [], meta: {} }), goodCopy).ids.join(), 'k')
    assert.eq(findOlderVersionLoss(storedShape({ blocks: { k: b('k', 'metric') }, arrows: [], meta: {} }), goodCopy), null,
      'a known type deleted there is not offered')
    assert.eq(findOlderVersionLoss(storedShape({ blocks: {}, arrows: [], meta: {} }), goodCopy).unsure, true,
      'nothing shows which build wrote it, so it is offered without the claim')
  })

  it('an arrow the last-good copy has, written back without a pattern, shows a pre-registry build', () => {
    const b = (id, type) => ({ id, type, title: id })
    const goodCopy = { blocks: { g: b('g', 'goal'), r: b('r', 'requirement'), k: b('k', 'metric') },
      arrows: [{ id: 'x1', from: 'r', to: 'g', style: 'routed', pattern: 'solid' }, { from: 'k', to: 'g', pattern: 'solid' }], meta: { schema: 2 } }
    const stored = arrows => storedShape({ blocks: { g: b('g', 'goal'), r: b('r', 'requirement') }, arrows, meta: {} })
    assert.deepEq(writerSigns({ blocks: {}, arrows: [{ id: 'x1', from: 'r', to: 'g' }, { from: 'k', to: 'g' }, { id: 'p', from: 'a', to: 'b', pattern: 'solid' }] }),
      { knewEveryType: true, bareArrows: [] }, 'a registry build: nothing more to read')
    assert.deepEq(writerSigns({ blocks: {}, arrows: [{ id: 'x1', from: 'r', to: 'g' }, { from: 'k', to: 'g' }, null] }),
      { knewEveryType: false, bareArrows: ['id:x1', 'ends:k\ng'] })
    assert.eq(findOlderVersionLoss(stored([{ id: 'x1', from: 'r', to: 'g', style: 'routed' }]), goodCopy).unsure, false, 'by id')
    assert.eq(findOlderVersionLoss(stored([{ from: 'k', to: 'g' }]), goodCopy).unsure, false, 'by its ends, when it has no id')
    assert.eq(findOlderVersionLoss(stored([{ id: 'drawn-there', from: 'r', to: 'g' }]), goodCopy).unsure, true,
      'a connection drawn in that tab shows nothing')
    // An earlier check's certainty travels with the held copy.
    const heldSure = { ...goodCopy, pendingRestore: ['k'] }
    const heldUnsure = { ...goodCopy, pendingRestore: ['k'], pendingUnsure: true }
    const stamped = { schema: 2, blockIds: ['g', 'r'], save: true }
    assert.eq(findOlderVersionLoss(stamped, heldSure).unsure, false)
    assert.eq(findOlderVersionLoss(stamped, heldUnsure).unsure, true)
  })

  it('checks a map on switch, keeps the offer with that map, and restores its connections', () => sandbox(() => {
    const a = seedMap('Map A')
    newMap()
    const b = currentId()
    olderBuildSave(a, { storageKey: false }) // an older tab saved map A meanwhile
    switchTo(a)
    assert.eq(currentId(), a)
    assert.ok(banner(), 'offered on switch')
    assert.deepEq(ids(state.blocks), ['g1', 'r1'])
    assert.eq(state.arrows.length, 1, 'a load drops connections to missing blocks')
    switchTo(b)
    assert.eq(banner(), null, "another map's offer is not shown here")
    switchTo(a)
    assert.ok(banner(), 'offered again on the way back')
    const r = restoreOlderVersionLoss()
    assert.deepEq(r, { blocks: 3, arrows: 4 })
    assert.eq(state.arrows.length, 5)
    assert.deepEq(ids(state.blocks), ['g1', 'i1', 'm1', 'r1', 's1'])
  }))

  it('restores no connection to a block that is gone, and no group that is gone', () => sandbox(() => {
    const id = seedMap()
    state.groups = { grp: { id: 'grp', label: 'Reporting' } }
    state.blocks.i1.groupId = 'grp'
    saveState()
    olderBuildSave(id, { storageKey: false })
    const loss = checkOlderVersionLoss(id, { schema: null, blockIds: ['g1', 'r1'], save: true }, 'switch')
    assert.ok(loss)
    state.blocks = { g1: state.blocks.g1 } // r1 deleted here since
    state.arrows = []
    state.groups = {}
    restoreOlderVersionLoss()
    assert.deepEq(ids(state.blocks), ['g1', 'i1', 'm1', 's1'])
    assert.eq(state.blocks.i1.groupId, null)
    assert.ok(!state.arrows.some(a => a.from === 'r1' || a.to === 'r1'), 'the connection to the deleted block stays out')
    assert.eq(state.arrows.length, 3)
  }))

  it('an older tab saving over this map raises the banner, not the other-tab one', () => sandbox(() => {
    const id = seedMap()
    const json = olderBuildSave(id, { storageKey: false })
    window.dispatchEvent(new StorageEvent('storage', { key: slot(id), storageArea: localStorage, newValue: json }))
    assert.ok(banner())
    assert.eq(document.getElementById('otherTabBanner'), null)
    assert.includes(banner().textContent, 'Close any Pathfinder tab opened before the update, or its next save drops them again.')
    assert.eq(ids(state.blocks).length, 5, 'this tab still has every block')
    const steps = getUndoHistory().length
    banner().querySelector('.older-version-restore').click()
    assert.eq(getUndoHistory().length, steps, 'nothing was missing here, so nothing to undo')
    const saved = JSON.parse(localStorage.getItem(slot(id)))
    assert.eq(Object.keys(saved.blocks).length, 5, "this tab's copy, with every block, is saved over it")
    assert.eq(saved.meta.schema, SCHEMA_VERSION)
    assert.eq(document.getElementById('otherTabBanner'), null, 'no conflict left')
  }))

  it('dismissing that banner leaves the ordinary other-tab warning, since the map still differs', () => sandbox(() => {
    const id = seedMap()
    const json = olderBuildSave(id, { storageKey: false })
    window.dispatchEvent(new StorageEvent('storage', { key: slot(id), storageArea: localStorage, newValue: json }))
    banner().querySelector('.older-version-dismiss').click()
    assert.eq(banner(), null)
    assert.ok(document.getElementById('otherTabBanner'), 'the other-tab warning takes over')
    assert.eq(localStorage.getItem(good(id)), json, 'the older copy is accepted as last-good')
  }))

  it('a stamped write from another tab is the ordinary other-tab case', () => sandbox(() => {
    const id = seedMap()
    const theirs = JSON.parse(JSON.stringify(serializeCanvas()))
    delete theirs.blocks.i1
    theirs.meta.title = 'Renamed in a current tab'
    const e = { key: slot(id), storageArea: localStorage, newValue: JSON.stringify(theirs) }
    assert.eq(checkStorageForOlderVersion(e), null)
    window.dispatchEvent(new StorageEvent('storage', e))
    assert.eq(banner(), null)
    assert.ok(document.getElementById('otherTabBanner'))
  }))

  it('a payload no build saved (no meta) is not read as an older build', () => {
    assert.ok(!isSavedCanvas({}))
    assert.ok(!isSavedCanvas({ blocks: {}, meta: [] }))
    assert.ok(isSavedCanvas({ blocks: {}, meta: {} }))
    const goodCopy = { blocks: { k: { id: 'k', type: 'metric', title: 'K' } }, arrows: [], meta: { schema: 2 } }
    assert.eq(findOlderVersionLoss({ schema: null, blockIds: [], save: false }, goodCopy), null)
    assert.ok(findOlderVersionLoss({ schema: null, blockIds: [], save: true }, goodCopy))
    assert.eq(findOlderVersionLoss({ schema: 2, blockIds: [] }, goodCopy), null, 'stamped: a deliberate delete')
    assert.eq(findOlderVersionLoss({ schema: null, blockIds: [] }, null), null, 'no last-good copy yet')
  })

  it('never checks or shows in a view-only or embedded page', () => sandbox(() => {
    const id = seedMap()
    olderBuildSave(id)
    rearmTabLoad(); loadState()
    ui.readOnly = true
    assert.eq(checkOlderVersionLoss(id, lastLoad, 'load'), null)
    assert.eq(showOlderVersionBanner({ ids: ['i1'], mapId: id }), null)
    ui.readOnly = false; ui.embed = true
    assert.eq(checkOlderVersionLoss(id, lastLoad, 'load'), null)
    assert.eq(restoreOlderVersionLoss({ ids: ['i1'], mapId: id, blocks: [], arrows: [] }), null)
    assert.eq(banner(), null)
  }))
})

describe('Data safety: the offer while it waits', () => {
  it('work done while the offer waits is covered too, and a second older save loses nothing', () => sandbox(() => {
    const id = seedMap()
    olderBuildSave(id)
    reloadPage()   // offered i1, m1, s1; nobody answers
    saveState()    // the init save
    state.blocks.i2 = normalizeBlock({ id: 'i2', type: 'implementation', title: 'Publish the weekly digest', x: 600, y: 300 })
    state.arrows.push(normalizeArrow({ id: 'a6', from: 'i2', to: 'r1', style: 'routed' }))
    delete state.blocks.g1 // a deliberate delete meanwhile
    saveState()
    const kept = readLastGood(id)
    assert.deepEq(ids(kept.blocks), ['i1', 'i2', 'm1', 'r1', 's1'], 'the map now, plus what waits')
    assert.deepEq([...kept.pendingRestore].sort(), ['i1', 'm1', 's1'])
    assert.ok(kept.arrows.some(a => a.id === 'a6'), 'the new connection too')
    assert.eq(new Set(kept.arrows.map(a => a.id)).size, kept.arrows.length, 'no connection twice')
    // The older build saves the map again (a stale tab, a second rollback): it drops i2 too.
    olderBuildSave(id)
    resetOlderVersionState() // a new page
    const loss = reloadPage()
    assert.deepEq([...loss.ids].sort(), ['i1', 'i2', 'm1', 's1'], 'both losses are offered')
    assert.eq(banner().querySelector('.older-version-text').textContent,
      'An older version of Pathfinder saved this map and dropped 4 blocks it does not understand. Restore them?')
    restoreOlderVersionLoss()
    assert.deepEq(ids(state.blocks), ['i1', 'i2', 'm1', 'r1', 's1'], 'the deleted goal stays deleted')
    assert.ok(state.arrows.some(a => a.id === 'a6' && a.from === 'i2'))
    assert.ok(!('pendingRestore' in readLastGood(id)), 'answered')
  }))

  it("an offer another tab's older build raised goes once this tab's own save puts the blocks back", () => sandbox(() => {
    const id = seedMap()
    const json = olderBuildSave(id, { storageKey: false })
    window.dispatchEvent(new StorageEvent('storage', { key: slot(id), storageArea: localStorage, newValue: json }))
    assert.ok(banner())
    state.blocks.g1.title += ' (this quarter)'
    saveState()
    assert.eq(banner(), null, 'nothing is missing any more, so nothing is claimed')
    assert.eq(pendingOlderVersionLoss(), null)
    assert.eq(Object.keys(JSON.parse(localStorage.getItem(slot(id))).blocks).length, 5)
    const again = olderBuildSave(id, { storageKey: false })
    window.dispatchEvent(new StorageEvent('storage', { key: slot(id), storageArea: localStorage, newValue: again }))
    assert.ok(banner(), 'the older tab saving again raises it again')
  }))

  it('a map an older build emptied is not replaced by a link without asking', () => sandbox(async () => {
    // An untitled map whose blocks were all of types the older build cannot
    // read, and not yet connected (a connection would survive the older
    // build's save, dangling, and count as content by itself).
    state.blocks = {
      m1: normalizeBlock({ id: 'm1', type: 'metric', title: 'Days to publish the report' }),
      s1: normalizeBlock({ id: 's1', type: 'stakeholder', title: 'Portfolio reporting leads', x: 300 }),
    }
    state.arrows = []
    state.groups = {}
    canvasMeta.title = ''; canvasMeta.contextBrief = ''
    ensureLibrary(); saveState()
    olderBuildSave(currentId())
    rearmTabLoad(); loadState()
    assert.eq(Object.keys(state.blocks).length + state.arrows.length, 0, 'the older build emptied it')
    const loss = checkLoadForOlderVersion()
    assert.deepEq([...loss.ids].sort(), ['m1', 's1'])
    assert.eq(checkLoadForOlderVersion(), loss, 'the load is checked once')
    assert.ok(hasContent(), 'a waiting offer counts as content')
    const shared = { blocks: { t1: { id: 't1', type: 'goal', title: 'Data Hub rollout' } }, arrows: [], meta: { title: 'Teammate map' } }
    const pending = openIncoming(shared, { source: 'link' })
    const dlg = incomingDialog()
    assert.ok(dlg, 'the link asks')
    assert.eq(dlg.querySelector('.incoming-primary').dataset.choice, 'new', 'Open as a new map is the default')
    dlg.querySelector('[data-choice="cancel"]').click()
    assert.eq(await pending, null)
    assert.eq(Object.keys(state.blocks).length, 0, 'nothing replaced')
    assert.ok(pendingOlderVersionLoss(), 'the offer still stands')
  }))
})

// A localStorage that holds `headroom` more characters than it does now,
// and throws the browser's quota error past that, as a full one does.
function withQuota(headroom, fn) {
  const setItem = Storage.prototype.setItem
  const size = () => {
    let n = 0
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + (localStorage.getItem(k) || '').length }
    return n
  }
  const limit = size() + headroom
  Storage.prototype.setItem = function (k, v) {
    if (this === localStorage) {
      const old = localStorage.getItem(k)
      const next = size() - (old == null ? 0 : String(k).length + old.length) + String(k).length + String(v).length
      if (next > limit) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    return setItem.call(this, k, v)
  }
  try { return fn() } finally { Storage.prototype.setItem = setItem }
}

describe('Data safety: last-good copies give way near the quota', () => {
  it('a save that runs out of room drops redundant copies and succeeds', () => sandbox(() => {
    const a = seedMap('Map A')
    state.blocks.g1.description = 'Month-end status notes. '.repeat(400)
    saveState()
    const aSlot = localStorage.getItem(slot(a))
    newMap()
    const b = currentId()
    saveState()
    assert.ok(localStorage.getItem(good(a)) && localStorage.getItem(good(b)))
    state.blocks.n1 = normalizeBlock({ id: 'n1', type: 'goal', title: 'Weekly digest', description: 'Digest line. '.repeat(200) })
    const ok = withQuota(1000, () => saveState())
    assert.ok(ok, 'the save succeeds')
    assert.eq(saveStatus.phase, 'saved')
    assert.ok(JSON.parse(localStorage.getItem(slot(b))).blocks.n1, 'the new card is saved')
    assert.ok(JSON.parse(localStorage.getItem('pathfinder-v1')).blocks.n1)
    assert.eq(localStorage.getItem(slot(a)), aSlot, 'the other map itself is untouched')
    assert.eq(localStorage.getItem(good(a)), null, "the other map's redundant copy gave way")
  }))

  it("this map's own copy goes first, since the retry writes it again", () => sandbox(() => {
    const a = seedMap('Map A')
    newMap()
    const b = currentId()
    state.blocks.n1 = normalizeBlock({ id: 'n1', type: 'goal', title: 'Weekly digest', description: 'Digest line. '.repeat(40) })
    saveState()
    const before = localStorage.getItem(good(b)).length
    state.blocks.n2 = normalizeBlock({ id: 'n2', type: 'goal', title: 'Monthly digest', description: 'Digest line. '.repeat(40) })
    // Less room than the canvas needs to grow: the first write fails.
    const grow = JSON.stringify(serializeCanvas()).length - before
    assert.ok(grow > 0 && before > grow)
    assert.ok(withQuota(grow - 10, () => saveState()), 'the save succeeds')
    assert.ok(JSON.parse(localStorage.getItem(slot(b))).blocks.n2)
    assert.ok(localStorage.getItem(good(a)), "another map's copy is kept when this map's was enough")
  }))

  it('a copy holding an offer is never dropped', () => sandbox(() => {
    const a = seedMap('Map A')
    newMap()
    // Map A's offer waits for an answer (it is not the open map).
    localStorage.setItem(good(a), JSON.stringify({ ...readLastGood(a), pendingRestore: ['i1'] }))
    state.blocks.n1 = normalizeBlock({ id: 'n1', type: 'goal', title: 'Weekly digest', description: 'Digest line. '.repeat(400) })
    const held = localStorage.getItem(good(a))
    const ok = withQuota(500, () => saveState())
    assert.ok(!ok, 'no room, and nothing it may drop')
    assert.eq(saveStatus.phase, 'error')
    assert.eq(localStorage.getItem(good(a)), held, 'the offer survives')
    assert.ok(!freeLastGoodSpace(1), 'nothing else to free')
  }))
})

describe('Data safety: the last-good copy is bounded', () => {
  it('is one copy per map, the same bytes as its slot', () => sandbox(() => {
    const id = seedMap()
    assert.eq(localStorage.getItem(good(id)), localStorage.getItem(slot(id)))
    saveState(); saveState()
    let copies = 0
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i) === good(id)) copies++
    assert.eq(copies, 1)
  }))

  it('goes with its map, and a copy whose map is gone is swept', () => sandbox(() => {
    const id = seedMap()
    newMap()
    assert.ok(localStorage.getItem(good(id)))
    deleteMap(id)
    assert.eq(localStorage.getItem(good(id)), null, 'deleting the map deletes its copy')
    localStorage.setItem(good('tab-ghost'), '{}')
    sweepLastGood()
    assert.eq(localStorage.getItem(good('tab-ghost')), null, 'an orphan left by an older build is swept')
    assert.ok(localStorage.getItem(good(currentId())), 'a live map keeps its copy')
  }))

  it('a copy that cannot be written is removed rather than left stale', () => sandbox(() => {
    const id = seedMap()
    assert.ok(readLastGood(id).blocks.i1)
    delete state.blocks.i1
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('pathfinder-lastgood-')) throw new Error('QuotaExceededError')
      return setItem.call(this, k, v)
    }
    try { assert.ok(saveState(), 'the map itself still saves') }
    finally { Storage.prototype.setItem = setItem }
    assert.eq(localStorage.getItem(good(id)), null, 'no stale copy to offer a deleted block back')
  }))
})

// ── Review round: what the offer must survive ───────────────

describe('Data safety: a held offer survives what happens around it', () => {
  // The held copy is written on every save while the offer waits; the
  // blocks it holds are in no other key.
  function heldOffer() {
    const id = seedMap()
    olderBuildSave(id)
    reloadPage()   // offered i1, m1, s1; nobody answers
    saveState()    // the init save stamps the map; the copy stays held
    assert.includes(localStorage.getItem(good(id)), '"pendingRestore"')
    return id
  }

  it('a held copy whose own write fails is kept, and the offer comes back after a reload', () => sandbox(() => {
    const id = heldOffer()
    state.blocks.g1.description = 'Month-end status notes for every deliverable.'
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (k, v) {
      if (this === localStorage && String(k).startsWith('pathfinder-lastgood-')) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      return setItem.call(this, k, v)
    }
    try { assert.ok(saveState(), 'the map itself saves') }
    finally { Storage.prototype.setItem = setItem }
    assert.eq(saveStatus.phase, 'saved')
    const kept = readLastGood(id)
    assert.ok(kept, 'the held copy is not removed')
    assert.ok(kept.blocks.i1 && kept.blocks.m1 && kept.blocks.s1, 'it still has the lost blocks')
    assert.deepEq([...kept.pendingRestore].sort(), ['i1', 'm1', 's1'])
    resetOlderVersionState() // a new page: the person reloaded without answering
    const again = reloadPage()
    assert.ok(again, 'offered again')
    assert.deepEq([...again.ids].sort(), ['i1', 'm1', 's1'])
    restoreOlderVersionLoss()
    assert.deepEq(ids(state.blocks), ['g1', 'i1', 'm1', 'r1', 's1'])
    assert.eq(state.blocks.g1.description, 'Month-end status notes for every deliverable.', 'into the map as edited since')
  }))

  it('near the quota the held copy keeps its place, and takes the room another map\'s plain copy used', () => sandbox(() => {
    // The review's case: the canvas and its slot still fit, the held copy
    // (bigger by the lost blocks) does not.
    const id = heldOffer()
    // No other map's plain copy to give up (earlier suites may leave some).
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith('pathfinder-lastgood-') && k !== good(id)) localStorage.removeItem(k)
    }
    const before = localStorage.getItem(good(id))
    state.blocks.g1.description = 'x'.repeat(100)
    const grow = JSON.stringify(serializeCanvas()).length - localStorage.getItem(slot(id)).length
    assert.ok(grow >= 100)
    assert.ok(withQuota(2 * grow + 40, () => saveState()), 'the save succeeds')
    assert.eq(saveStatus.phase, 'saved')
    assert.eq(JSON.parse(localStorage.getItem(slot(id))).blocks.g1.description, 'x'.repeat(100))
    assert.eq(localStorage.getItem(good(id)), before, 'the held copy is the one from before, untouched')
    resetOlderVersionState()
    assert.deepEq([...reloadPage().ids].sort(), ['i1', 'm1', 's1'], 'and the offer returns')

    // With another map's plain copy to give up, the held one is written afresh.
    const other = 'held-room-' + Math.random().toString(36).slice(2, 8)
    localStorage.setItem(slot(other), JSON.stringify({ blocks: {}, arrows: [], meta: { title: 'Other', schema: 2 } }))
    localStorage.setItem(good(other), JSON.stringify({ blocks: {}, arrows: [], meta: { title: 'Other ' + 'y'.repeat(400), schema: 2 } }))
    saveState()
    state.blocks.g1.description = 'z'.repeat(200)
    const grow2 = JSON.stringify(serializeCanvas()).length - localStorage.getItem(slot(id)).length
    assert.ok(withQuota(2 * grow2 + 40, () => saveState()))
    assert.eq(localStorage.getItem(good(other)), null, "the other map's plain copy gave way")
    const fresh = readLastGood(id)
    assert.eq(fresh.blocks.g1.description, 'z'.repeat(200), 'the held copy has the latest map')
    assert.deepEq([...fresh.pendingRestore].sort(), ['i1', 'm1', 's1'])
  }))

  it('Replace on a map with a waiting offer keeps the offered blocks in its snapshot and undo step, and ends the offer', () => sandbox(async () => {
    const id = heldOffer()
    assert.ok(banner())
    const shared = { blocks: { t1: { id: 't1', type: 'goal', title: 'Data Hub rollout' } }, arrows: [], meta: { title: 'Teammate map' } }
    const pending = openIncoming(shared, { source: 'link' })
    assert.ok(incomingDialog(), 'the link asks')
    incomingDialog().querySelector('[data-choice="replace"]').click()
    const r = await pending
    assert.eq(r.mode, 'replace')
    assert.ok(r.replacedContent)
    assert.eq(r.keptDropped, 3)
    assert.deepEq(ids(state.blocks), ['t1'])
    assert.eq(banner(), null, "no offer about a canvas that is now someone else's")
    assert.eq(pendingOlderVersionLoss(), null)
    const snap = listSnapshots(id).at(-1)
    assert.eq(snap.name, 'Before loading shared link')
    assert.deepEq(ids(snap.payload.blocks), ['g1', 'i1', 'm1', 'r1', 's1'], 'the snapshot has the map whole')
    assert.eq(snap.payload.arrows.length, 5, 'with every connection')
    assert.ok(!('pendingRestore' in snap.payload))
    const kept = readLastGood(id)
    assert.ok(kept.blocks.t1 && !kept.blocks.i1 && !('pendingRestore' in kept), 'the last-good copy is the new canvas')
    assert.eq(checkOlderVersionLoss(id, storedShape(JSON.parse(localStorage.getItem(slot(id)))), 'load'), null,
      'a reload offers nothing on the teammate map')
    assert.eq(incomingMessage(r, 'shared map'),
      'Replaced your map with the shared map. Undo, or Maps, Snapshots, brings yours back, with the 3 blocks an older version dropped')
    undo()
    assert.deepEq(ids(state.blocks), ['g1', 'i1', 'm1', 'r1', 's1'], 'one undo brings the map back whole')
    assert.eq(canvasMeta.title, 'Reporting cadence')
  }))

  it('Merge on a map with a waiting offer leaves the offer alone', () => sandbox(async () => {
    heldOffer()
    const shared = { blocks: { t1: { id: 't1', type: 'goal', title: 'Data Hub rollout' } }, arrows: [], meta: { title: 'Teammate map' } }
    const pending = openIncoming(shared, { source: 'link' })
    incomingDialog().querySelector('[data-choice="merge"]').click()
    const r = await pending
    assert.eq(r.mode, 'merge')
    assert.ok(!('keptDropped' in r))
    assert.ok(banner(), 'the same map, so the same offer')
    assert.deepEq([...pendingOlderVersionLoss().ids].sort(), ['i1', 'm1', 's1'])
  }))

  it('mapWithPendingLoss is the map as Restore would leave it', () => sandbox(() => {
    heldOffer()
    const whole = mapWithPendingLoss()
    assert.deepEq(ids(whole.blocks), ['g1', 'i1', 'm1', 'r1', 's1'])
    assert.ok(!('pendingRestore' in whole) && !('pendingUnsure' in whole))
    assert.ok(whole.arrows.every(a => whole.blocks[a.from] && whole.blocks[a.to]), 'no connection to a block that is gone')
    assert.deepEq(ids(state.blocks), ['g1', 'r1'], 'the live map is untouched')
    assert.deepEq(ids(mapWithPendingLoss(null).blocks), ['g1', 'r1'], 'no offer: the map as it is')
  }))

  it('a link on the page load runs the load check itself, before deciding the map is empty', () => sandbox(async () => {
    state.blocks = {
      m1: normalizeBlock({ id: 'm1', type: 'metric', title: 'Days to publish the report' }),
      s1: normalizeBlock({ id: 's1', type: 'stakeholder', title: 'Portfolio reporting leads', x: 300 }),
    }
    state.arrows = []; state.groups = {}
    canvasMeta.title = ''; canvasMeta.contextBrief = ''
    ensureLibrary(); saveState()
    olderBuildSave(currentId())
    rearmTabLoad(); loadState()
    resetOlderVersionState() // nothing has asked yet, as on a fresh page
    assert.eq(pendingOlderVersionLoss(), null)
    const shared = { blocks: { t1: { id: 't1', type: 'goal', title: 'Data Hub rollout' } }, arrows: [], meta: { title: 'Teammate map' } }
    const pending = openIncoming(shared, { source: 'link' })
    assert.ok(incomingDialog(), 'the link asks, because hasContent ran the check')
    assert.deepEq([...pendingOlderVersionLoss().ids].sort(), ['m1', 's1'])
    incomingDialog().querySelector('[data-choice="cancel"]').click()
    assert.eq(await pending, null)
  }))
})

describe('Data safety: a save that cannot show who wrote it', () => {
  // A map with no connections. A stale tab of the live registry build
  // (614c549) that deletes its only new-type card saves exactly what a
  // pre-registry build would have: no stamp, no pattern, no new type.
  function flatMap() {
    state.blocks = {
      g1: normalizeBlock({ id: 'g1', type: 'goal', title: 'Faster monthly close' }),
      r1: normalizeBlock({ id: 'r1', type: 'requirement', title: 'Status notes per deliverable', x: 300 }),
      i1: normalizeBlock({ id: 'i1', type: 'implementation', title: 'Build the status notes job', x: 600 }),
    }
    state.arrows = []; state.groups = {}
    canvasMeta.title = 'Reporting cadence'; canvasMeta.contextBrief = ''
    ensureLibrary(); saveState()
    return currentId()
  }
  const UNSURE_ONE = 'This map is missing 1 block that an older version of Pathfinder cannot read. ' +
    'It may have dropped it, or it was deleted on purpose. Restore it?'

  it('is offered as a possibility, live and on load, and never tells the person to close tabs', () => sandbox(() => {
    const id = flatMap()
    const json = registryBuildSave(id, { drop: ['i1'], storageKey: false })
    assert.ok(!writerKnewEveryType(JSON.parse(json)), 'the save shows nothing')
    window.dispatchEvent(new StorageEvent('storage', { key: slot(id), storageArea: localStorage, newValue: json }))
    assert.ok(banner(), 'offered, since it may be a loss')
    assert.eq(banner().querySelector('.older-version-text').textContent, UNSURE_ONE)
    assert.ok(!banner().textContent.includes('Close any'), 'no claim that another tab runs an older build')
    // Unanswered, this tab closes; that tab's save is what the next page loads.
    banner().remove()
    resetOlderVersionState()

    registryBuildSave(id, { drop: ['i1'] })
    resetOlderVersionState()
    const loss = reloadPage()
    assert.eq(loss.unsure, true)
    assert.eq(banner().querySelector('.older-version-text').textContent, UNSURE_ONE)
    saveState()
    assert.ok(readLastGood(id).pendingUnsure, 'the held copy remembers it was a guess')
    resetOlderVersionState()
    const again = reloadPage()
    assert.eq(again.unsure, true, 'still a guess after a reload')
    assert.eq(banner().querySelector('.older-version-text').textContent, UNSURE_ONE)
    // Dismiss is the answer for a deliberate delete: never offered again.
    banner().querySelector('.older-version-dismiss').click()
    resetOlderVersionState()
    assert.eq(reloadPage(), null)
  }))

  it('two blocks read as a plural guess', () => {
    assert.eq(olderVersionText({ ids: ['a', 'b'], unsure: true, source: 'storage' }),
      'This map is missing 2 blocks that an older version of Pathfinder cannot read. It may have dropped them, or they were deleted on purpose. Restore them?')
  })

  it('a pre-registry build that rewrote a connection the map already had is named outright', () => sandbox(() => {
    const id = flatMap()
    state.arrows = [normalizeArrow({ id: 'k1', from: 'r1', to: 'g1', style: 'routed' })]
    saveState()
    const json = olderBuildSave(id, { storageKey: false })
    window.dispatchEvent(new StorageEvent('storage', { key: slot(id), storageArea: localStorage, newValue: json }))
    assert.eq(pendingOlderVersionLoss().unsure, false)
    assert.eq(banner().querySelector('.older-version-text').textContent,
      'An older version of Pathfinder saved this map and dropped 1 block it does not understand. Restore it? ' +
      'Close any Pathfinder tab opened before the update, or its next save drops it again.')
  }))
})
