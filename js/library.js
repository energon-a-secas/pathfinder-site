// ════════════════════════════════════════════════════════════
//  library.js: the canvas library: several maps in one browser.
//
//  The active canvas stays exactly where it always lived
//  ('pathfinder-v1'), so share links, undo, autosave and old
//  sessions keep working untouched. The library adds an index
//  ('pathfinder-maps') plus one payload slot per map
//  ('pathfinder-map-<id>'), kept in sync by a save hook: every
//  autosave of the active canvas writes through to its slot.
//
//  Switching flushes the current canvas, loads the target through
//  the same normalize/import path a share link takes, and clears
//  the undo stack, since undo must never cross canvases.
//
//  openAsNewMap() is where a link, a ?src= URL or an imported file
//  lands by default (sharing.js asks first), and the backup stamps
//  ('pathfinder-backup') record when each map was last exported.
//
//  Each tab remembers its own map in sessionStorage, so a reload
//  reopens it even after another tab moved the shared pointer, and
//  each map keeps a last-good copy ('pathfinder-lastgood-<id>'):
//  what this build last saved of it. An older build that drops
//  blocks it does not know leaves a save without the schema stamp,
//  and the last-good copy is what brings those blocks back.
// ════════════════════════════════════════════════════════════

import { state, ui, view, canvasMeta, promptState, saveState, saveHooks, storageReliefHooks, serializeCanvas, snapshot,
         saveView, loadView, getUndoHistory, getRedoFuture, mapIdHooks, lastLoad } from './state.js'
import { applyTransform, renderArrows, renderFrames, updateHint } from './canvas.js'
import { genId, showToast, STORAGE_KEY } from './utils.js'
import { applyImport } from './export.js'
import { normalizeCanvas, normalizeArrow, schemaOf } from './normalize.js'
import { searchBlocks } from './search.js'
import { compareCanvases } from './comparison.js'
import { updateCanvasTitle, renderBlock, renderInspector } from './render.js'
import { runGapDetection } from './gaps.js'
import { refreshPrompt } from './prompt.js'
import { refreshSituation, refreshCardStyles, refreshSpotlight,
         syncContextBrief, collapseTemplatesAfterUse } from './ui-panels.js'

const INDEX_KEY = 'pathfinder-maps'
const CUR_KEY   = 'pathfinder-map-current'
const slotKey   = id => 'pathfinder-map-' + id
const snapKey   = id => 'pathfinder-snaps-' + id
const goodKey   = id => 'pathfinder-lastgood-' + id
const MAX_SNAPS = 8

// ── Index and slots ──────────────────────────────────────────

function loadIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter(e => e && typeof e.id === 'string') : []
  } catch (_) { return [] }
}
function saveIndex(index) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)); return true } catch (_) { return false }
}

// ── Which map this tab has open ──────────────────────────────
// CUR_KEY is shared by every tab and names the map a fresh load opens.
// When another tab moves it (opens a link as a new map, switches maps),
// this tab still shows its own map, and its saves must keep going to that
// map's slot, not the other tab's. A storage event is the only signal: it
// fires in the other tabs, never in the tab that wrote, so this tab's own
// switches (and a test writing the key directly) never look foreign.
let tabMap = null        // the map this tab last opened or adopted
let pointerAway = false  // another tab has moved CUR_KEY off tabMap

export function currentId() {
  if (pointerAway && tabMap) return tabMap
  try { return localStorage.getItem(CUR_KEY) } catch (_) { return null }
}
function setCurrentId(id) {
  try { localStorage.setItem(CUR_KEY, id) } catch (_) { return false }
  tabMap = id || null
  pointerAway = false
  rememberTabMap(tabMap)
  return true
}

// ── This tab's map, across reloads ───────────────────────────
// CUR_KEY only says which map some tab opened last. sessionStorage belongs
// to one tab and survives its reloads, so it can say which map THIS tab had
// open: two tabs on two maps each reload into their own. A new tab has
// nothing remembered and opens the pointer's map, as it always did.
const TAB_KEY = 'pathfinder-tab-map'

function rememberTabMap(id) {
  try { if (id) sessionStorage.setItem(TAB_KEY, id); else sessionStorage.removeItem(TAB_KEY) } catch (_) {}
}
export function rememberedTabMap() {
  try { return sessionStorage.getItem(TAB_KEY) } catch (_) { return null }
}

let loadSourceUsed = false

/**
 * The key the page load reads the canvas from (state.js loadState asks).
 * After a reload: this tab's map, when it still exists and another tab has
 * moved the pointer off it since. Otherwise null, which means STORAGE_KEY.
 * Answers once per page, since only the load that opens a page is a reload;
 * later loadState calls (tests) read STORAGE_KEY as before.
 */
export function tabLoadSource() {
  if (loadSourceUsed) return null
  loadSourceUsed = true
  const mine = rememberedTabMap()
  if (!mine) return null
  try {
    if (localStorage.getItem(CUR_KEY) === mine) return null
    if (localStorage.getItem(slotKey(mine)) == null) return null
  } catch (_) { return null }
  // The state a storage event from another tab leaves behind: the pointer
  // is away from this tab's map, so this tab's saves re-point it (writeThrough).
  tabMap = mine
  pointerAway = true
  return slotKey(mine)
}
mapIdHooks.loadSource = tabLoadSource

/** Test hook: let the next loadState() act as a page load again. */
export function rearmTabLoad() { loadSourceUsed = false }

/**
 * storage listener: another tab moved the shared pointer. Returns whether
 * this tab's map is now a different one from the pointer's.
 */
export function notePointerMove(e) {
  if (!e || (e.storageArea && e.storageArea !== localStorage)) return pointerAway
  if (e.key !== CUR_KEY && e.key !== null) return syncPointer()
  if (!tabMap) tabMap = e.oldValue || null
  pointerAway = !!tabMap && e.newValue !== tabMap
  return pointerAway
}

/**
 * Re-read the pointer before a storage event is handled. Another tab writes
 * the index, the new map's slot, then the pointer, and Firefox already
 * returns that tab's later pointer while this tab is still handling the
 * slot's event: currentId() would name the other tab's new map, and a save
 * in that window would be filed under it. Only other tabs fire storage
 * events, so this tab's own switches (and a test writing the key directly)
 * never reach here.
 */
export function syncPointer() {
  if (tabMap) {
    try { pointerAway = localStorage.getItem(CUR_KEY) !== tabMap } catch (_) {}
  }
  return pointerAway
}

// The camera is saved per map (state.js viewKey): under this tab's map, not
// whichever one another tab moved the pointer to.
mapIdHooks.current = currentId

/** Test hook: forget which map this tab had open. */
export function forgetTabMap() { tabMap = null; pointerAway = false }

/**
 * Make this tab's map the one a load opens: its latest saved copy goes to
 * STORAGE_KEY and the pointer names it. The "changed in another tab"
 * Reload uses it, so the reload shows this map as that tab left it rather
 * than whichever map some tab saved last.
 */
export function pointAtThisMap() {
  const id = currentId()
  if (!id) return false
  try {
    const slot = localStorage.getItem(slotKey(id))
    if (slot) localStorage.setItem(STORAGE_KEY, slot)
  } catch (_) { return false }
  return setCurrentId(id)
}
function readSlot(id) {
  try {
    const raw = localStorage.getItem(slotKey(id))
    return raw ? JSON.parse(raw) : null
  } catch (_) { return null }
}
function payloadOfState() {
  return serializeCanvas()
}
function displayName(meta) {
  return (meta?.title || '').trim() || 'Untitled map'
}

/** Read-only search, using live content for the active map before autosave. */
export function searchSavedMaps(query, filters = {}) {
  if (ui.readOnly || ui.embed) return []
  const active = currentId()
  const ids = [...new Set([active, ...loadIndex().map(row => row.id)].filter(Boolean))]
  if (!active) ids.unshift(null)
  const results = ids.flatMap(id => {
    const live = id === active
    const payload = live ? serializeCanvas() : readSlot(id)
    if (!payload) return []
    const canvas = live ? payload : normalizeCanvas(payload)
    return searchBlocks(canvas.blocks, query, filters).map(result => ({
      ...result, mapId: id || '', mapName: displayName(canvas.meta), current: live,
    }))
  })
  return results.sort((a, b) => b.score - a.score || Number(b.current) - Number(a.current) || a.mapName.localeCompare(b.mapName))
}

/** Mirror the active canvas into its slot and refresh its index row. */
export function writeThrough() {
  const id = currentId()
  if (!id) return true
  // Another tab moved the pointer, and this save just wrote this tab's map
  // to STORAGE_KEY. Name it again, or a load would read this canvas as the
  // other tab's map and file it under that map's slot.
  if (pointerAway && !setCurrentId(id)) return false
  const json = JSON.stringify(payloadOfState())
  try { localStorage.setItem(slotKey(id), json) } catch (_) { return false }
  writeLastGood(id, json)
  // Another tab's older build dropped blocks this tab still had, and this
  // save just wrote them back: the banner's claim is no longer true. That
  // tab's next save raises it again, through its storage event.
  if (pendingLoss?.mapId === id && pendingLoss.source === 'storage' &&
      pendingLoss.ids.every(bid => state.blocks[bid])) setPendingLoss(null)
  const index = loadIndex()
  const row = index.find(e => e.id === id) || (index.push({ id }), index[index.length - 1])
  row.name    = displayName(canvasMeta)
  row.updated = Date.now()
  row.blocks  = Object.keys(state.blocks).length
  row.arrows  = state.arrows.length
  return saveIndex(index)
}

// ── Last-good copy: older builds must not cost blocks ────────
// A build before the 16-type registry drops every block of a type it does
// not know (implementation, metric, stakeholder) on load, and its next
// autosave makes the loss permanent. That build is still reachable: a tab
// left open since before an update, or a rollback of the site. It never
// writes the schema stamp (normalize.js SCHEMA_VERSION), and it never
// touches this key, so the copy this build last saved of each map is still
// here when this build comes back and finds an unstamped save.
//
// Cost: one extra copy of each map, the same bytes as its slot. At most one
// per map; deleting the map deletes it, and setupLibrary() drops a copy
// whose map is gone. They are the first thing given up when a save runs
// out of room (freeLastGoodSpace): a failed save costs more than a copy.
//
// While a loss waits for an answer the copy is held: every save still
// writes it, as the map now plus the lost blocks and the connections that
// touched them, with the lost ids in `pendingRestore`. Work done meanwhile
// is covered too, and the offer comes back after a reload until Restore or
// Dismiss answers it.

const held = new Map()   // mapId -> the loss still waiting for Restore or Dismiss
let pendingLoss = null   // the loss the banner offers for the open map

/** The last copy this build saved of a map, as stored, or null. */
export function readLastGood(id) {
  try {
    const raw = id ? localStorage.getItem(goodKey(id)) : null
    const v = raw ? JSON.parse(raw) : null
    return v && typeof v === 'object' ? v : null
  } catch (_) { return null }
}

function writeLastGood(id, json) {
  let copy = json
  const waiting = held.get(id)
  if (waiting) {
    const missing = waiting.blocks.filter(b => !state.blocks[b.id])
    if (!missing.length) {
      // Every lost block is back some other way (a snapshot restore, an
      // undo): there is nothing left to offer.
      held.delete(id)
      if (pendingLoss?.mapId === id) setPendingLoss(null)
    } else {
      copy = JSON.stringify(withLostBlocks(serializeCanvas(), missing, waiting.arrows, waiting.unsure))
    }
  }
  if (writeGood(id, copy)) return
  // A held copy is never removed: the one stored may be the only copy of
  // the blocks it offers, and it still has them and their ids. Being older
  // costs nothing, since only its `pendingRestore` ids are offered. Every
  // other copy that cannot be written goes: a stale one would offer back
  // blocks deleted since.
  if (held.has(id)) return
  try { localStorage.removeItem(goodKey(id)) } catch (_) {}
}

/**
 * Write a last-good copy. A held one that does not fit gets the room other
 * maps' plain copies take up (they guard against a loss that may never
 * happen; this one guards blocks already lost). Returns whether it wrote.
 */
function writeGood(id, copy) {
  try { localStorage.setItem(goodKey(id), copy); return true } catch (_) {}
  if (!held.has(id) || !freeLastGoodSpace(1)) return false
  try { localStorage.setItem(goodKey(id), copy); return true } catch (_) { return false }
}

/**
 * A held last-good copy: the map as it is now, plus the lost blocks still
 * missing from it and the connections that touched them (those this map
 * does not have already), with their ids in `pendingRestore`, and
 * `pendingUnsure` when nothing showed an older build dropped them.
 */
function withLostBlocks(payload, missing, arrows, unsure = false) {
  const lost = new Set(missing.map(b => b.id))
  const pair = a => a.from + '\n' + a.to
  const ids = new Set(payload.arrows.map(a => a.id).filter(Boolean))
  const pairs = new Set(payload.arrows.map(pair))
  const extra = (arrows || []).filter(a => (lost.has(a.from) || lost.has(a.to)) &&
    !(a.id && ids.has(a.id)) && !pairs.has(pair(a)))
  const blocks = { ...payload.blocks }
  missing.forEach(b => { blocks[b.id] = b })
  const out = { ...payload, blocks, arrows: [...payload.arrows, ...extra], pendingRestore: [...lost] }
  if (unsure) out.pendingUnsure = true
  return out
}

/**
 * The open map with the blocks a waiting offer holds put back, and the
 * connections between them and the map: what Restore would make of it.
 * A replace (sharing.js applyIncoming) keeps this as its snapshot and its
 * undo step, then settles the offer, so the blocks stay in both.
 */
export function mapWithPendingLoss(loss = pendingOlderVersionLoss()) {
  const payload = JSON.parse(JSON.stringify(serializeCanvas()))
  const missing = loss ? loss.blocks.filter(b => !state.blocks[b.id]) : []
  if (!missing.length) return payload
  const whole = withLostBlocks(payload, JSON.parse(JSON.stringify(missing)), JSON.parse(JSON.stringify(loss.arrows)))
  delete whole.pendingRestore
  delete whole.pendingUnsure
  // As Restore does: no group that is gone, no connection to a block that is.
  missing.forEach(b => {
    const copy = whole.blocks[b.id]
    if (copy.groupId && !whole.groups?.[copy.groupId]) copy.groupId = null
  })
  whole.arrows = whole.arrows.filter(a => whole.blocks[a.from] && whole.blocks[a.to])
  return whole
}

/**
 * Close a waiting offer without Restore or Dismiss: its blocks were kept
 * somewhere else (mapWithPendingLoss) and the canvas is about to become
 * something else. The next save writes a plain last-good copy.
 */
export function settleOlderVersionLoss(loss = pendingLoss) {
  if (!loss) return
  held.delete(loss.mapId)
  if (pendingLoss?.mapId === loss.mapId) setPendingLoss(null)
}

/**
 * Out of room (state.js saveState calls this when a save fails, then tries
 * again). Last-good copies are the space the app can give up without
 * losing anything the person can see: `round` 0 drops this map's own copy,
 * which the retry writes afresh anyway; round 1 drops every other map's.
 * A held copy (an offer waiting for an answer) is never dropped: it may be
 * the only copy of the blocks it offers. Returns whether it freed anything.
 */
export function freeLastGoodSpace(round = 0) {
  const own = currentId()
  const keys = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith('pathfinder-lastgood-')) continue
      const mapId = k.slice('pathfinder-lastgood-'.length)
      if (round === 0 ? mapId !== own : mapId === own) continue
      if (held.has(mapId)) continue
      if ((localStorage.getItem(k) || '').includes('"pendingRestore"')) continue
      keys.push(k)
    }
    keys.forEach(k => localStorage.removeItem(k))
  } catch (_) { return false }
  return keys.length > 0
}
storageReliefHooks.push(freeLastGoodSpace)

function setPendingLoss(loss) {
  pendingLoss = loss
  window.dispatchEvent(new CustomEvent('pf:older-version-loss', { detail: loss }))
}

/** The loss waiting for an answer on the open map, or null. */
export function pendingOlderVersionLoss() {
  return pendingLoss && pendingLoss.mapId === currentId() ? pendingLoss : null
}

// ── Who wrote an unstamped save ──────────────────────────────
// Only this build and newer ones stamp their saves, so an unstamped one came
// from either a pre-registry build (the one that drops blocks) or a registry
// build from before the stamp (614c549, live in a stale tab), which drops
// nothing. What each one writes tells them apart, most of the time.

/**
 * The 13 types every build before the 16-type registry knew. Those builds
 * dropped a block of any other type on load; a missing block of one of
 * these was deleted there on purpose.
 */
export const PRE_REGISTRY_TYPES = ['goal', 'problem', 'requirement', 'assumption', 'risk', 'decision',
  'question', 'resource', 'output', 'process', 'terminator', 'context', 'custom']

/**
 * Whether an unstamped save shows it came from a build that knew every
 * type. Those never drop a block on load (an unknown type stays `custom` +
 * `typeHint`), so what they saved without a block, somebody deleted. The
 * signs, none of which a pre-registry build can write, since it rebuilt
 * every block and arrow from the fields it knew: an arrow with a `pattern`
 * key (a registry build's normalizeArrow writes one on every arrow it
 * loads), or a block of a type it added, or one carrying `typeHint`,
 * `typeCheck` or `gapAck`.
 */
export function writerKnewEveryType(data) {
  if (!data || typeof data !== 'object') return false
  const arrows = Array.isArray(data.arrows) ? data.arrows : []
  if (arrows.some(a => a && typeof a === 'object' && typeof a.pattern === 'string')) return true
  const raw = data.blocks
  const blocks = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : [])
  return blocks.some(b => b && typeof b === 'object' && (
    (typeof b.type === 'string' && !PRE_REGISTRY_TYPES.includes(b.type)) ||
    b.typeHint != null || b.typeCheck != null || b.gapAck != null))
}

// An arrow by its id, or by its ends when it has none.
function arrowKey(a) {
  if (!a || typeof a !== 'object') return ''
  const id = typeof a.id === 'string' ? a.id.trim() : ''
  if (id) return 'id:' + id
  return a.from != null && a.to != null ? 'ends:' + String(a.from).trim() + '\n' + String(a.to).trim() : ''
}

/**
 * What a stored payload says about the build that wrote it: whether it
 * knew every type, and the arrows it wrote without a `pattern`. An arrow
 * the last-good copy also has, written back without one, was loaded by
 * the writer and rebuilt from fields that did not include it: only a
 * pre-registry build does that. A save with no such arrow (a map with no
 * connections, or only ones drawn in that tab) cannot be told apart.
 */
export function writerSigns(data) {
  const knewEveryType = writerKnewEveryType(data)
  const arrows = !knewEveryType && data && Array.isArray(data.arrows) ? data.arrows : []
  const bareArrows = arrows.filter(a => a && typeof a === 'object' && typeof a.pattern !== 'string').map(arrowKey).filter(Boolean)
  return { knewEveryType, bareArrows }
}
// state.js loadState records these in lastLoad, for the page load's check.
mapIdHooks.inspectLoad = writerSigns

/**
 * Blocks a map's last-good copy has and a stored copy lost. Pure.
 * `stored` is { schema, blockIds, save, knewEveryType, bareArrows } as read
 * (storedShape, or state.js lastLoad).
 *
 * Only a pre-registry build loses blocks nobody deleted, and only blocks of
 * the types it did not know (PRE_REGISTRY_TYPES). So a save (every build
 * writes a meta object) with no stamp and no sign of a build that knew
 * every type (`knewEveryType`) counts the missing blocks of the other
 * types. A missing block of a type it knew was deleted there on purpose.
 * A stamped copy (this build or a newer one), an unstamped one by a
 * registry build, and a payload no build saved lost nothing that was not
 * deleted. Blocks a previous check is still holding (`pendingRestore`)
 * count whoever wrote the copy.
 *
 * `unsure` is set when no arrow shows a pre-registry build wrote the save
 * (writerSigns): a registry build in a stale tab deleting the map's only
 * new-type card looks the same, so the banner offers, but does not claim.
 * Returns null, or { ids, blocks, arrows, unsure }: the blocks and every
 * arrow that touched them, as the last-good copy had them.
 */
export function findOlderVersionLoss(stored, good) {
  if (!stored || !good || typeof good !== 'object') return null
  const g = normalizeCanvas(good)
  const have = new Set(stored.blockIds || [])
  const pending = Array.isArray(good.pendingRestore) ? good.pendingRestore.filter(id => typeof id === 'string') : []
  const preRegistry = !stored.schema && stored.save !== false && !stored.knewEveryType
  const dropped = preRegistry ? Object.keys(g.blocks).filter(id => !PRE_REGISTRY_TYPES.includes(g.blocks[id].type)) : []
  const ids = [...new Set([...pending, ...dropped])].filter(id => g.blocks[id] && !have.has(id))
  if (!ids.length) return null
  const goodArrows = new Set(g.arrows.map(arrowKey))
  const shown = preRegistry && (stored.bareArrows || []).some(k => goodArrows.has(k))
  // A block is surely lost when this check shows it, or an earlier one did.
  const sure = new Set([...(good.pendingUnsure ? [] : pending), ...(shown ? dropped : [])])
  const lost = new Set(ids)
  return {
    ids,
    blocks: ids.map(id => g.blocks[id]),
    arrows: g.arrows.filter(a => lost.has(a.from) || lost.has(a.to)),
    unsure: ids.some(id => !sure.has(id)),
  }
}

/**
 * Check a map's stored copy against its last-good copy, before anything
 * saves over it. `source` is 'load', 'switch' or 'storage' (another tab
 * wrote it; this tab still has the blocks in memory, so nothing is held).
 * Offers the loss through the `pf:older-version-loss` event and returns it.
 */
export function checkOlderVersionLoss(id, stored, source = 'load') {
  if (!id || ui.readOnly || ui.embed) return null
  const good = readLastGood(id)
  const loss = findOlderVersionLoss(stored, good)
  if (!loss) {
    // Another tab writing a whole copy settles nothing held here.
    if (source !== 'storage') {
      held.delete(id)
      if (pendingLoss?.mapId === id) setPendingLoss(null)
    }
    return null
  }
  if (source !== 'storage') {
    held.set(id, loss)
    const was = Array.isArray(good.pendingRestore) ? good.pendingRestore : []
    if (was.length !== loss.ids.length || loss.ids.some(bid => !was.includes(bid)) || !!good.pendingUnsure !== loss.unsure) {
      const copy = { ...good, pendingRestore: loss.ids }
      if (loss.unsure) copy.pendingUnsure = true
      else delete copy.pendingUnsure
      writeGood(id, JSON.stringify(copy))
    }
  }
  const found = { ...loss, mapId: id, source }
  setPendingLoss(found)
  return found
}

/** Whether a payload has the shape every build's autosave writes. */
export const isSavedCanvas = p => !!p && typeof p === 'object' && !!p.meta && typeof p.meta === 'object' && !Array.isArray(p.meta)

/** What a stored payload says, in the shape checkOlderVersionLoss reads. */
export function storedShape(payload) {
  const c = normalizeCanvas(payload)
  return { schema: c.schema || null, blockIds: Object.keys(c.blocks), save: isSavedCanvas(payload), ...writerSigns(payload) }
}

// The page load's check runs once, before anything can save over what the
// load read: setupLibrary asks before the session's first save, and
// sharing.js hasContent asks before a share link, ?src= or a file decides
// whether the map is empty (a pending loss counts as content, so the link
// asks instead of replacing a map an older build emptied). Whichever comes
// first runs it.
let loadChecked = false

/** Check what the page load read, once per page. Returns the loss or null. */
export function checkLoadForOlderVersion() {
  if (loadChecked) return pendingOlderVersionLoss()
  loadChecked = true
  if (!lastLoad.key || ui.readOnly || ui.embed) return null
  return checkOlderVersionLoss(currentId(), lastLoad, 'load')
}

/**
 * storage listener: an unstamped write to the open map's slot came from an
 * older build in another tab. Returns the loss it caused, or null.
 */
export function checkStorageForOlderVersion(e) {
  if (!e || (e.storageArea && e.storageArea !== localStorage)) return null
  const id = currentId()
  if (!id || e.key !== slotKey(id) || e.newValue == null) return null
  let payload
  try { payload = JSON.parse(e.newValue) } catch (_) { return null }
  // A current build's save (stamped) is the other-tab check's business, and
  // this settles it without normalizing a whole map on every foreign save.
  if (schemaOf(payload) || !isSavedCanvas(payload)) return null
  return checkOlderVersionLoss(id, storedShape(payload), 'storage')
}

/**
 * Restore: the lost blocks, and every arrow that touched them whose other
 * end still exists, go back into the open map with their own ids, as one
 * undo step, and the map saves. Blocks already present are left alone, so
 * a tab that still had them in memory (a 'storage' loss) only saves.
 * Returns { blocks, arrows } restored, or null when it did not apply.
 */
export function restoreOlderVersionLoss(loss = pendingLoss) {
  if (!loss || ui.readOnly || ui.embed || loss.mapId !== currentId()) return null
  const blocks = loss.blocks.filter(b => !state.blocks[b.id])
  const ids = new Set([...Object.keys(state.blocks), ...blocks.map(b => b.id)])
  const pair = a => a.from + '\n' + a.to
  const pairs = new Set(state.arrows.map(pair))
  const arrowIds = new Set(state.arrows.map(a => a.id).filter(Boolean))
  const arrows = loss.arrows.filter(a => normalizeArrow(a) && ids.has(a.from) && ids.has(a.to) &&
    !(a.id && arrowIds.has(a.id)) && !pairs.has(pair(a)))
  if (blocks.length || arrows.length) {
    snapshot()
    blocks.forEach(b => {
      const copy = JSON.parse(JSON.stringify(b))
      if (copy.groupId && !state.groups[copy.groupId]) copy.groupId = null
      state.blocks[copy.id] = copy
    })
    arrows.forEach(a => {
      const copy = JSON.parse(JSON.stringify(a))
      if (!copy.id) copy.id = genId()
      state.arrows.push(copy)
    })
    blocks.forEach(b => renderBlock(b.id))
    renderArrows(); renderFrames(); updateHint(); runGapDetection(); renderInspector()
    ui.promptDirty = true
    if (ui.activeTab === 'prompt') refreshPrompt()
    window.dispatchEvent(new CustomEvent('pf:canvas-changed'))
  }
  held.delete(loss.mapId)
  setPendingLoss(null)
  saveState()
  return { blocks: blocks.length, arrows: arrows.length }
}

/**
 * Dismiss: keep the map as the older build left it. The last-good copy
 * becomes that map, so the same loss is not offered again.
 */
export function dismissOlderVersionLoss(loss = pendingLoss) {
  if (!loss) return
  held.delete(loss.mapId)
  setPendingLoss(null)
  if (ui.readOnly || ui.embed) return
  if (loss.source === 'storage') {
    // This tab still shows its own copy; the stored one is the older build's.
    try {
      const slot = localStorage.getItem(slotKey(loss.mapId))
      if (slot) localStorage.setItem(goodKey(loss.mapId), slot)
    } catch (_) {}
  } else if (loss.mapId === currentId()) {
    writeThrough()
  }
}

/** Drop last-good copies whose map is gone (deleted by an older build). */
export function sweepLastGood() {
  try {
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('pathfinder-lastgood-')) keys.push(k)
    }
    keys.forEach(k => {
      if (localStorage.getItem(slotKey(k.slice('pathfinder-lastgood-'.length))) == null) localStorage.removeItem(k)
    })
  } catch (_) {}
}

/** Test hook: forget every hold, the pending offer and the load check. */
export function resetOlderVersionState() { held.clear(); pendingLoss = null; loadChecked = false }


// ── Snapshots: named states of the current map ───────────────
// Full copies, capped per map, oldest dropped. A snapshot survives sessions
// where the in-memory undo stack does not, which is the whole point: the
// "before the investigation" state is still there next week.

export function listSnapshots(mapId = currentId()) {
  try {
    const arr = JSON.parse(localStorage.getItem(snapKey(mapId)) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch (_) { return [] }
}

/** Keep a named copy of the open map (or of `payload`, a version of it). */
export function takeSnapshot(name, payload = null) {
  const id = currentId()
  if (!id) return null
  const snaps = listSnapshots(id)
  const snap = { id: genId(), name: (name || '').trim() || 'Snapshot', at: Date.now(), payload: JSON.parse(JSON.stringify(payload || serializeCanvas())) }
  snaps.push(snap)
  while (snaps.length > MAX_SNAPS) snaps.shift()
  try { localStorage.setItem(snapKey(id), JSON.stringify(snaps)) } catch (_) { return null }
  return snap
}

export function deleteSnapshot(snapId, mapId = currentId()) {
  const snaps = listSnapshots(mapId).filter(sn => sn.id !== snapId)
  try { localStorage.setItem(snapKey(mapId), JSON.stringify(snaps)) } catch (_) {}
}

/** What changed between a snapshot and now, as a short honest summary. */
export function diffPayloads(oldP, newP) {
  const comparison = compareCanvases(oldP, newP)
  const count = (changes, kind) => changes.filter(change => change.kind === kind).length
  const added = count(comparison.blocks, 'added'), removed = count(comparison.blocks, 'removed'), changed = count(comparison.blocks, 'changed')
  const addedArrows = count(comparison.arrows, 'added'), removedArrows = count(comparison.arrows, 'removed'), changedArrows = count(comparison.arrows, 'changed')
  const parts = []
  if (added) parts.push(`+${added} block${added === 1 ? '' : 's'}`)
  if (removed) parts.push(`-${removed}`)
  if (changed) parts.push(`${changed} changed`)
  if (addedArrows) parts.push(`+${addedArrows} arrow${addedArrows === 1 ? '' : 's'}`)
  if (removedArrows) parts.push(`-${removedArrows} arrow${removedArrows === 1 ? '' : 's'}`)
  if (changedArrows) parts.push(`${changedArrows} arrow${changedArrows === 1 ? '' : 's'} changed`)
  if (comparison.groups.length) parts.push('groups changed')
  if (comparison.meta.length) parts.push('map settings changed')
  return parts.length ? parts.join(' · ') : 'no changes'
}

export function restoreSnapshot(snapId) {
  if (ui.readOnly || ui.embed) return false
  const id = currentId()
  const snap = listSnapshots(id).find(sn => sn.id === snapId)
  if (!snap) { showToast('That snapshot is gone', 'warning'); return false }
  // The state being replaced is itself worth keeping.
  if (!saveState()) return false
  if (!takeSnapshot('Before restoring "' + snap.name + '"')) {
    showToast('Could not keep a backup snapshot. Download a backup and free storage before restoring', 'warning', 4000)
    return false
  }
  loadPayload(snap.payload, { resetExport: false })
  saveState()
  showToast(`Restored "${snap.name}"`, 'success', 2200)
  return true
}

/** First run: adopt whatever canvas already exists as map number one. */
export function ensureLibrary() {
  const cur = currentId()
  if (cur) {
    if (!pointerAway) tabMap = cur
    rememberTabMap(tabMap)
    return
  }
  const id = genId()
  if (setCurrentId(id)) writeThrough()
}

// ── Operations ───────────────────────────────────────────────

function clearUndo() {
  getUndoHistory().length = 0
  getRedoFuture().length = 0
}

/**
 * Load a payload as the whole canvas, then run the canvas-level refreshes a
 * replace needs (same set checkShareUrl does).
 */
function loadPayload(payload, { resetExport = true } = {}) {
  // Each map remembers its own camera; restore it and skip the fit when it
  // was there. A brand-new or never-visited map still fits to its content.
  const restored = loadView({ legacy: false })
  if (!restored) Object.assign(view, { panX: 0, panY: 0, zoom: 1 })
  const result = applyImport(payload, 'replace', { fit: !restored })
  applyTransform()
  clearUndo()
  if (resetExport) promptState.lastSnapshot = null
  collapseTemplatesAfterUse()
  refreshSituation(); refreshCardStyles(); refreshSpotlight()
  updateCanvasTitle()
  syncContextBrief()
  // Let listeners that key off canvas changes (readiness verdict, prompt
  // preview) re-evaluate against the map that just loaded.
  window.dispatchEvent(new CustomEvent('pf:canvas-changed'))
  return result
}

export function switchTo(id) {
  if (!id) return false
  if (id === currentId()) return true
  const payload = readSlot(id)
  if (!payload) { showToast('That map could not be loaded', 'warning'); return }
  if (!saveState()) return false // keep unsaved work in memory if either write failed
  saveView()               // don't lose a pan made within the debounce window
  if (!setCurrentId(id)) { showToast('Could not switch maps. Your current map is still open', 'warning'); return false }
  // Before the load saves over it: did an older build write this map last?
  if (pendingLoss && pendingLoss.mapId !== id) setPendingLoss(null)
  checkOlderVersionLoss(id, storedShape(payload), 'switch')
  loadPayload(payload)
  return true
}

export function newMap() {
  if (!saveState()) return false
  saveView()
  const id = genId()
  const payload = { blocks: {}, arrows: [], groups: {}, meta: { title: '' } }
  try { localStorage.setItem(slotKey(id), JSON.stringify(payload)) } catch (_) {
    showToast('No room left in this browser for another map', 'warning'); return
  }
  if (!setCurrentId(id)) { showToast('Could not open the new map. Your current map is still open', 'warning'); return false }
  if (pendingLoss) setPendingLoss(null)
  loadPayload(payload)
  writeThrough()
  showToast('New map. The old one is under Maps', 'success', 2200)
}

export function duplicateCurrent() {
  if (!saveState()) return false
  saveView()
  const id = genId()
  const payload = JSON.parse(JSON.stringify(payloadOfState()))
  payload.meta.title = (displayName(canvasMeta) + ' copy').trim()
  try { localStorage.setItem(slotKey(id), JSON.stringify(payload)) } catch (_) {
    showToast('No room left in this browser for another map', 'warning'); return
  }
  if (!setCurrentId(id)) { showToast('Could not open the copy. Your current map is still open', 'warning'); return false }
  if (pendingLoss) setPendingLoss(null)
  loadPayload(payload)
  writeThrough()
  showToast('Duplicated. You are now on the copy', 'success', 2200)
}

/**
 * Open an incoming canvas (a share link, a ?src= URL, an imported file) as a
 * map of its own, leaving the current one exactly as it was. This is the
 * default for everything that arrives from outside: a teammate's link must
 * never overwrite your work because you clicked it.
 * Returns applyImport's { imported, dropped, idMap }, or false when nothing
 * changed (storage full, or the current map could not be flushed first).
 */
export function openAsNewMap(data) {
  if (ui.readOnly || ui.embed) return false
  // The library may not be set up yet on a first visit, and its save hook
  // may not be registered yet during init: adopt and mirror explicitly.
  ensureLibrary()
  if (!saveState()) return false
  if (currentId() && !writeThrough()) {
    showToast('Could not keep your current map, so nothing was opened. Free some storage and try again', 'warning', 4000)
    return false
  }
  saveView()
  const id = genId()
  try { localStorage.setItem(slotKey(id), JSON.stringify(data)) } catch (_) {
    showToast('No room left in this browser for another map. Your current map is unchanged', 'warning', 4000)
    return false
  }
  if (!setCurrentId(id)) {
    try { localStorage.removeItem(slotKey(id)) } catch (_) {}
    showToast('Could not open a new map. Your current map is unchanged', 'warning', 4000)
    return false
  }
  if (pendingLoss) setPendingLoss(null)
  const result = loadPayload(data)
  writeThrough()
  return result
}

export function deleteMap(id) {
  if (id === currentId() && !saveState()) return false
  const index = loadIndex().filter(e => e.id !== id)
  if (!saveIndex(index)) { showToast('Could not update the map library. No map was deleted', 'warning'); return false }
  try { localStorage.removeItem(slotKey(id)) } catch (_) {}
  try { localStorage.removeItem(snapKey(id)) } catch (_) {}
  try { localStorage.removeItem('pathfinder-view:' + id) } catch (_) {}
  try { localStorage.removeItem(goodKey(id)) } catch (_) {}
  held.delete(id)
  if (pendingLoss?.mapId === id) setPendingLoss(null)
  const backup = readBackup()
  if (backup.maps[id]) { delete backup.maps[id]; writeBackup(backup) }
  if (id === currentId()) {
    const next = index[0]
    if (next) {
      setCurrentId(next.id)
      const payload = readSlot(next.id) || { blocks: {}, arrows: [], groups: {}, meta: { title: '' } }
      checkOlderVersionLoss(next.id, storedShape(payload), 'switch')
      loadPayload(payload)
    } else {
      // Deleted the only map: start a fresh empty one.
      setCurrentId('')
      try { localStorage.removeItem(CUR_KEY) } catch (_) {}
      loadPayload({ blocks: {}, arrows: [], groups: {}, meta: { title: '' } })
      ensureLibrary()
    }
  }
}

export function exportAllMaps() {
  saveState()
  const index = loadIndex()
  const active = currentId() || 'recovered-map'
  if (!index.some(row => row.id === active)) index.unshift({ id: active, name: displayName(canvasMeta), updated: Date.now() })
  const bundle = {
    format: 'pathfinder-maps',
    version: 1,
    exported: new Date().toISOString(),
    current: active,
    maps: index.map(e => ({ id: e.id, name: e.id === active ? displayName(canvasMeta) : e.name, updated: e.updated, payload: e.id === active ? serializeCanvas() : readSlot(e.id) }))
      .filter(m => m.payload),
  }
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'pathfinder-maps.json'
  a.click()
  URL.revokeObjectURL(a.href)
  recordBackup('all', Date.now(), bundle.maps.map(m => m.id))
}

// ── Backups: when this browser last exported a copy ───────────
// localStorage is one browser's copy, capped at about 5 MiB, and Safari
// evicts script-written data after seven days without a visit. A file
// export is the only copy that survives all of that, so the app tracks
// when one was last made, per map, and says so in the status bar.

const BACKUP_KEY = 'pathfinder-backup'

export function readBackup() {
  try {
    const b = JSON.parse(localStorage.getItem(BACKUP_KEY) || '{}')
    return {
      all: Number.isFinite(b.all) ? b.all : null,
      maps: b.maps && typeof b.maps === 'object' ? b.maps : {},
      since: Number.isFinite(b.since) ? b.since : null,
      nagAt: Number.isFinite(b.nagAt) ? b.nagAt : null,
    }
  } catch (_) { return { all: null, maps: {}, since: null, nagAt: null } }
}

export function writeBackup(b) {
  try { localStorage.setItem(BACKUP_KEY, JSON.stringify(b)); return true } catch (_) { return false }
}

/**
 * Record an export: one map's id, or 'all' with the ids the bundle held.
 * Stamped per map, so a map created after the last Export all still reads
 * "never" rather than borrowing a date from before it existed.
 */
export function recordBackup(scope = 'all', at = Date.now(), ids = null) {
  const b = readBackup()
  if (scope === 'all') {
    b.all = at
    ;(ids || [currentId(), ...loadIndex().map(e => e.id)]).filter(Boolean).forEach(id => { b.maps[id] = at })
  } else if (scope) b.maps[scope] = at
  writeBackup(b)
  window.dispatchEvent(new CustomEvent('pf:backup-recorded', { detail: { scope, at } }))
}

/** When the given map was last exported, by itself or in an Export all. */
export function lastBackupAt(mapId = currentId()) {
  const b = readBackup()
  return (mapId && Number.isFinite(b.maps[mapId]) && b.maps[mapId]) || null
}

export function importMapsFile(file) {
  const reader = new FileReader()
  reader.onload = () => {
    let added = 0
    try {
      const data = JSON.parse(reader.result)
      // Accept the bundle format, or a single-canvas JSON as one new map.
      const maps = data && data.format === 'pathfinder-maps' && Array.isArray(data.maps)
        ? data.maps
        : (data && (data.blocks || data.arrows) ? [{ name: data.meta?.title, payload: data }] : [])
      const index = loadIndex()
      maps.forEach(m => {
        if (!m || !m.payload || typeof m.payload !== 'object') return
        const id = genId()
        try { localStorage.setItem(slotKey(id), JSON.stringify(m.payload)) } catch (_) { return }
        index.push({
          id,
          name: (m.name || m.payload.meta?.title || '').trim() || 'Imported map',
          updated: Date.now(),
          blocks: m.payload.blocks ? Object.keys(m.payload.blocks).length : 0,
          arrows: Array.isArray(m.payload.arrows) ? m.payload.arrows.length : 0,
        })
        added++
      })
      saveIndex(index)
    } catch (_) {}
    showToast(added ? `Imported ${added} map${added === 1 ? '' : 's'} into the library` : 'That file has no maps in it', added ? 'success' : 'warning')
  }
  reader.readAsText(file)
}

// ── Menu ─────────────────────────────────────────────────────

function fmtWhen(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const plural = (n, word) => `${n ?? 0} ${word}${n === 1 ? '' : 's'}`

/**
 * The Maps menu (menu.js, like File, View and Help; view-menu.js opens it
 * from the header and in place in the phone panel). The maps, newest first,
 * the open one checked, then what to do with this one, then the library as
 * a whole. Deleting sits in its own submenu at the end, so it is never a
 * mis-click beside the row you meant to open.
 */
export function mapsMenuItems() {
  const cur = currentId()
  const index = loadIndex().slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))
  const name = e => e.name || 'Untitled map'
  const meta = e => `${plural(e.blocks, 'block')} · ${plural(e.arrows, 'arrow')} · ${fmtWhen(e.updated)}`
  const snaps = listSnapshots()
  const items = [{ type: 'heading', label: 'Your maps' }]
  index.forEach(e => items.push({
    label: name(e), hint: meta(e), radio: true, checked: e.id === cur,
    action: () => { if (e.id !== currentId()) switchTo(e.id) },
  }))
  items.push({ type: 'divider' },
    { label: 'New map', action: newMap },
    { label: 'Duplicate this map', action: duplicateCurrent },
    { label: 'Snapshot this map', hint: 'Kept in this browser, to compare or restore', action: snapshotNow })
  if (snaps.length) items.push({ label: `Snapshots (${snaps.length})`, submenu: snapshotItems })
  items.push({ type: 'divider' },
    { label: 'Export all maps (JSON)', action: exportAllMaps },
    { label: 'Import maps (JSON)', action: () => document.getElementById('importMapsFile')?.click() })
  if (index.length) {
    items.push({ type: 'divider' }, {
      label: 'Delete a map', danger: true,
      submenu: () => index.map(e => ({
        label: name(e), hint: e.id === cur ? 'The map you have open' : meta(e), danger: true,
        action: () => {
          if (!confirm(`Delete "${name(e)}"?\n\nThis cannot be undone.`)) return
          deleteMap(e.id)
        },
      })),
    })
  }
  return items
}

function snapshotNow() {
  const when = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const snap = takeSnapshot('Snapshot · ' + when)
  showToast(snap ? 'Snapshot kept. Restore it any time from Maps' : 'No room left for a snapshot', snap ? 'success' : 'warning', 2200)
}

// Each snapshot opens the comparison against the map as it is now; the last
// row deletes one.
function snapshotItems() {
  const now = serializeCanvas()
  const snaps = listSnapshots().slice().reverse()
  return [
    ...snaps.map(sn => ({
      label: 'Compare: ' + sn.name, hint: `${fmtWhen(sn.at)} · since then: ${diffPayloads(sn.payload, now)}`,
      action: () => window.dispatchEvent(new CustomEvent('pf:compare-snapshot', { detail: sn })),
    })),
    { type: 'divider' },
    { label: 'Delete a snapshot', danger: true, submenu: () => snaps.map(sn => ({
      label: sn.name, hint: fmtWhen(sn.at), danger: true, action: () => deleteSnapshot(sn.id),
    })) },
  ]
}

export function setupLibrary() {
  const wrapper = document.getElementById('mapsWrapper')
  if (!wrapper) return
  if (ui.readOnly) { wrapper.style.display = 'none'; return }

  ensureLibrary()
  // Before the first save of the session stamps it: was what this page
  // loaded written by an older build that dropped blocks? (Usually app.js
  // already asked, before any share link could land.)
  checkLoadForOlderVersion()
  saveHooks.push(writeThrough)
  saveState()
  sweepLastGood()
  window.addEventListener('storage', notePointerMove)

  // The Maps button opens mapsMenuItems() through view-menu.js, with the
  // other header menus.

  document.getElementById('importMapsFile')?.addEventListener('change', e => {
    const f = e.target.files?.[0]
    if (f) importMapsFile(f)
    e.target.value = ''
  })
}
