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
// ════════════════════════════════════════════════════════════

import { state, ui, view, canvasMeta, promptState, saveState, saveHooks, serializeCanvas,
         saveView, loadView, getUndoHistory, getRedoFuture, mapIdHooks } from './state.js'
import { applyTransform } from './canvas.js'
import { genId, showToast, STORAGE_KEY } from './utils.js'
import { applyImport } from './export.js'
import { normalizeCanvas } from './normalize.js'
import { searchBlocks } from './search.js'
import { compareCanvases } from './comparison.js'
import { updateCanvasTitle } from './render.js'
import { refreshSituation, refreshCardStyles, refreshSpotlight,
         syncContextBrief, collapseTemplatesAfterUse } from './ui-panels.js'

const INDEX_KEY = 'pathfinder-maps'
const CUR_KEY   = 'pathfinder-map-current'
const slotKey   = id => 'pathfinder-map-' + id
const snapKey   = id => 'pathfinder-snaps-' + id
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
  return true
}

/**
 * storage listener: another tab moved the shared pointer. Returns whether
 * this tab's map is now a different one from the pointer's.
 */
export function notePointerMove(e) {
  if (!e || (e.storageArea && e.storageArea !== localStorage)) return pointerAway
  if (e.key !== CUR_KEY && e.key !== null) return pointerAway
  if (!tabMap) tabMap = e.oldValue || null
  pointerAway = !!tabMap && e.newValue !== tabMap
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
  try { localStorage.setItem(slotKey(id), JSON.stringify(payloadOfState())) } catch (_) { return false }
  const index = loadIndex()
  const row = index.find(e => e.id === id) || (index.push({ id }), index[index.length - 1])
  row.name    = displayName(canvasMeta)
  row.updated = Date.now()
  row.blocks  = Object.keys(state.blocks).length
  row.arrows  = state.arrows.length
  return saveIndex(index)
}

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

export function takeSnapshot(name) {
  const id = currentId()
  if (!id) return null
  const snaps = listSnapshots(id)
  const snap = { id: genId(), name: (name || '').trim() || 'Snapshot', at: Date.now(), payload: JSON.parse(JSON.stringify(serializeCanvas())) }
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
  if (cur) { if (!pointerAway) tabMap = cur; return }
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
  const backup = readBackup()
  if (backup.maps[id]) { delete backup.maps[id]; writeBackup(backup) }
  if (id === currentId()) {
    const next = index[0]
    if (next) {
      setCurrentId(next.id)
      loadPayload(readSlot(next.id) || { blocks: {}, arrows: [], groups: {}, meta: { title: '' } })
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
  saveHooks.push(writeThrough)
  saveState()
  window.addEventListener('storage', notePointerMove)

  // The Maps button opens mapsMenuItems() through view-menu.js, with the
  // other header menus.

  document.getElementById('importMapsFile')?.addEventListener('change', e => {
    const f = e.target.files?.[0]
    if (f) importMapsFile(f)
    e.target.value = ''
  })
}
