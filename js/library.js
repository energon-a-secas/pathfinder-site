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
// ════════════════════════════════════════════════════════════

import { state, ui, view, canvasMeta, promptState, saveState, saveHooks, serializeCanvas,
         saveView, loadView, getUndoHistory, getRedoFuture } from './state.js'
import { applyTransform } from './canvas.js'
import { genId, showToast } from './utils.js'
import { applyImport } from './export.js'
import { normalizeCanvas } from './normalize.js'
import { searchBlocks } from './search.js'
import { compareCanvases } from './comparison.js'
import { updateCanvasTitle } from './render.js'
import { setDropdownOpen, setupDropdownKeyboard,
         refreshSituation, refreshCardStyles, refreshSpotlight,
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
export function currentId() {
  try { return localStorage.getItem(CUR_KEY) } catch (_) { return null }
}
function setCurrentId(id) {
  try { localStorage.setItem(CUR_KEY, id); return true } catch (_) { return false }
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
  if (currentId()) return
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
  applyImport(payload, 'replace', { fit: !restored })
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

export function deleteMap(id) {
  if (id === currentId() && !saveState()) return false
  const index = loadIndex().filter(e => e.id !== id)
  if (!saveIndex(index)) { showToast('Could not update the map library. No map was deleted', 'warning'); return false }
  try { localStorage.removeItem(slotKey(id)) } catch (_) {}
  try { localStorage.removeItem(snapKey(id)) } catch (_) {}
  try { localStorage.removeItem('pathfinder-view:' + id) } catch (_) {}
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

function renderMenu() {
  const dd = document.getElementById('mapsDropdown')
  if (!dd) return
  const cur = currentId()
  const index = loadIndex().slice().sort((a, b) => (b.updated || 0) - (a.updated || 0))
  dd.innerHTML = ''

  index.forEach(e => {
    const row = document.createElement('div')
    row.className = 'export-item map-row' + (e.id === cur ? ' active' : '')
    row.setAttribute('role', 'menuitem'); row.setAttribute('tabindex', '-1')
    const meta = `${e.blocks ?? 0} block${e.blocks === 1 ? '' : 's'} · ${e.arrows ?? 0} arrow${e.arrows === 1 ? '' : 's'} · ${fmtWhen(e.updated)}`
    row.innerHTML = `<span class="map-dot"></span>
      <span class="map-item-text"><span class="map-item-name"></span><div class="map-item-meta"></div></span>
      <button class="map-del" title="Delete this map" aria-label="Delete map">×</button>`
    row.querySelector('.map-item-name').textContent = e.name || 'Untitled map'
    row.querySelector('.map-item-meta').textContent = meta
    row.addEventListener('click', () => { setDropdownOpen('mapsWrapper', false); switchTo(e.id) })
    row.querySelector('.map-del').addEventListener('click', ev => {
      ev.stopPropagation()
      const label = e.name || 'Untitled map'
      if (!confirm(`Delete "${label}"?\n\nThis cannot be undone.`)) return
      deleteMap(e.id)
      renderMenu()
    })
    dd.appendChild(row)
  })

  const hr = document.createElement('hr')
  hr.style.cssText = 'border:none;border-top:1px solid rgba(255,255,255,.08);margin:4px 0'
  dd.appendChild(hr)

  const action = (label, fn) => {
    const it = document.createElement('div')
    it.className = 'export-item'
    it.setAttribute('role', 'menuitem'); it.setAttribute('tabindex', '-1')
    it.textContent = label
    it.addEventListener('click', event => {
      // Opening a submenu replaces this node. Stop the detached click from
      // looking like an outside click to the document's dismissal listener.
      event.stopPropagation()
      setDropdownOpen('mapsWrapper', false); fn()
    })
    dd.appendChild(it)
  }
  action('New map', newMap)
  action('Duplicate this map', duplicateCurrent)
  const nSnaps = listSnapshots().length
  const snapNow = document.createElement('div')
  snapNow.className = 'export-item'
  snapNow.setAttribute('role', 'menuitem'); snapNow.setAttribute('tabindex', '-1')
  snapNow.textContent = 'Snapshot this map'
  snapNow.addEventListener('click', () => {
    const when = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const snap = takeSnapshot('Snapshot · ' + when)
    setDropdownOpen('mapsWrapper', false)
    showToast(snap ? 'Snapshot kept. Restore it any time from Maps' : 'No room left for a snapshot', snap ? 'success' : 'warning', 2200)
  })
  dd.appendChild(snapNow)
  if (nSnaps) action(`Snapshots (${nSnaps})…`, () => renderSnapshotMenu())
  action('Export all maps (JSON)', exportAllMaps)
  action('Import maps (JSON)', () => document.getElementById('importMapsFile')?.click())
}

function renderSnapshotMenu() {
  const dd = document.getElementById('mapsDropdown')
  if (!dd) return
  setDropdownOpen('mapsWrapper', true)
  const now = serializeCanvas()
  dd.innerHTML = ''
  const back = document.createElement('div')
  back.className = 'export-item'
  back.setAttribute('role', 'menuitem'); back.setAttribute('tabindex', '-1')
  back.textContent = '← Maps'
  back.addEventListener('click', ev => { ev.stopPropagation(); renderMenu() })
  dd.appendChild(back)
  const snaps = listSnapshots().slice().reverse()
  snaps.forEach(sn => {
    const row = document.createElement('div')
    row.className = 'export-item map-row'
    row.setAttribute('role', 'menuitem'); row.setAttribute('tabindex', '-1')
    row.innerHTML = `<span class="map-item-text"><span class="map-item-name"></span><div class="map-item-meta"></div></span>
      <button class="map-del" title="Delete this snapshot" aria-label="Delete snapshot">×</button>`
    row.querySelector('.map-item-name').textContent = 'Compare: ' + sn.name
    row.querySelector('.map-item-meta').textContent =
      `${fmtWhen(sn.at)} · since then: ${diffPayloads(sn.payload, now)}`
    row.addEventListener('click', () => {
      setDropdownOpen('mapsWrapper', false)
      window.dispatchEvent(new CustomEvent('pf:compare-snapshot', { detail: sn }))
    })
    row.querySelector('.map-del').addEventListener('click', ev => {
      ev.stopPropagation()
      deleteSnapshot(sn.id)
      renderSnapshotMenu()
    })
    dd.appendChild(row)
  })
  if (!snaps.length) renderMenu()
}

export function setupLibrary() {
  const wrapper = document.getElementById('mapsWrapper')
  if (!wrapper) return
  if (ui.readOnly) { wrapper.style.display = 'none'; return }

  ensureLibrary()
  saveHooks.push(writeThrough)
  saveState()

  const btn = document.getElementById('mapsBtn')
  btn.addEventListener('click', e => {
    e.stopPropagation()
    const open = !wrapper.classList.contains('open')
    if (open) renderMenu()
    setDropdownOpen('mapsWrapper', open)
  })
  document.addEventListener('click', e => {
    if (!wrapper.contains(e.target)) setDropdownOpen('mapsWrapper', false)
  })
  setupDropdownKeyboard('mapsWrapper')

  document.getElementById('importMapsFile')?.addEventListener('change', e => {
    const f = e.target.files?.[0]
    if (f) importMapsFile(f)
    e.target.value = ''
  })
}
