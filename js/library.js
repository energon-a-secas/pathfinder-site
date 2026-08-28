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

import { state, ui, canvasMeta, saveState, saveHooks, serializeCanvas,
         loadView, getUndoHistory, getRedoFuture } from './state.js'
import { applyTransform } from './canvas.js'
import { genId, showToast } from './utils.js'
import { applyImport } from './export.js'
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
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(index)) } catch (_) {}
}
export function currentId() {
  try { return localStorage.getItem(CUR_KEY) } catch (_) { return null }
}
function setCurrentId(id) {
  try { localStorage.setItem(CUR_KEY, id) } catch (_) {}
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

/** Mirror the active canvas into its slot and refresh its index row. */
export function writeThrough() {
  const id = currentId()
  if (!id) return
  try { localStorage.setItem(slotKey(id), JSON.stringify(payloadOfState())) } catch (_) { return }
  const index = loadIndex()
  const row = index.find(e => e.id === id) || (index.push({ id }), index[index.length - 1])
  row.name    = displayName(canvasMeta)
  row.updated = Date.now()
  row.blocks  = Object.keys(state.blocks).length
  row.arrows  = state.arrows.length
  saveIndex(index)
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
  const snap = { id: genId(), name: (name || '').trim() || 'Snapshot', at: Date.now(), payload: serializeCanvas() }
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
  const a = oldP?.blocks || {}, b = newP?.blocks || {}
  const aIds = new Set(Object.keys(a)), bIds = new Set(Object.keys(b))
  let added = 0, removed = 0, changed = 0
  bIds.forEach(id => { if (!aIds.has(id)) added++ })
  aIds.forEach(id => { if (!bIds.has(id)) removed++ })
  aIds.forEach(id => {
    if (!bIds.has(id)) return
    const x = a[id], y = b[id]
    if (x.title !== y.title || x.description !== y.description || x.type !== y.type ||
        x.status !== y.status || (x.criteria || []).join('\n') !== (y.criteria || []).join('\n') ||
        (x.rationale || '') !== (y.rationale || '')) changed++
  })
  const dArrows = ((newP?.arrows || []).length) - ((oldP?.arrows || []).length)
  const parts = []
  if (added) parts.push(`+${added} block${added === 1 ? '' : 's'}`)
  if (removed) parts.push(`-${removed}`)
  if (changed) parts.push(`${changed} changed`)
  if (dArrows) parts.push(`${dArrows > 0 ? '+' : ''}${dArrows} arrow${Math.abs(dArrows) === 1 ? '' : 's'}`)
  return parts.length ? parts.join(' · ') : 'no changes'
}

export function restoreSnapshot(snapId) {
  const id = currentId()
  const snap = listSnapshots(id).find(sn => sn.id === snapId)
  if (!snap) { showToast('That snapshot is gone', 'warning'); return }
  // The state being replaced is itself worth keeping.
  takeSnapshot('Before restoring "' + snap.name + '"')
  loadPayload(snap.payload)
  writeThrough()
  showToast(`Restored "${snap.name}"`, 'success', 2200)
}

/** First run: adopt whatever canvas already exists as map number one. */
export function ensureLibrary() {
  if (currentId()) return
  const id = genId()
  setCurrentId(id)
  writeThrough()
}

// ── Operations ───────────────────────────────────────────────

function clearUndo() {
  getUndoHistory().length = 0
  getRedoFuture().length = 0
}

/**
 * Load a payload as the whole canvas, then run the canvas-level refreshes a
 * replace needs (same set checkShareUrl does). One quirk needs correcting by
 * hand: applyImport keeps the previous title when the incoming one is empty
 * (right for merges and shares, wrong here, where an empty title means the
 * map genuinely has none yet), so the title is forced from the payload.
 */
function loadPayload(payload) {
  // Each map remembers its own camera; restore it and skip the fit when it
  // was there. A brand-new or never-visited map still fits to its content.
  const restored = loadView()
  applyImport(payload, 'replace', { fit: !restored })
  if (restored) applyTransform()
  canvasMeta.title = (payload.meta && typeof payload.meta.title === 'string') ? payload.meta.title : ''
  clearUndo()
  collapseTemplatesAfterUse()
  refreshSituation(); refreshCardStyles(); refreshSpotlight()
  updateCanvasTitle()
  syncContextBrief()
  // Let listeners that key off canvas changes (readiness verdict, prompt
  // preview) re-evaluate against the map that just loaded.
  window.dispatchEvent(new CustomEvent('pf:canvas-changed'))
}

export function switchTo(id) {
  if (!id || id === currentId()) return
  const payload = readSlot(id)
  if (!payload) { showToast('That map could not be loaded', 'warning'); return }
  saveState()              // flush the outgoing canvas into its own slot
  setCurrentId(id)         // before the load, so its save lands in the new slot
  loadPayload(payload)
}

export function newMap() {
  saveState()
  const id = genId()
  const payload = { blocks: {}, arrows: [], groups: {}, meta: { title: '' } }
  try { localStorage.setItem(slotKey(id), JSON.stringify(payload)) } catch (_) {
    showToast('No room left in this browser for another map', 'warning'); return
  }
  setCurrentId(id)
  loadPayload(payload)
  writeThrough()
  showToast('New map. The old one is under Maps', 'success', 2200)
}

export function duplicateCurrent() {
  saveState()
  const id = genId()
  const payload = JSON.parse(JSON.stringify(payloadOfState()))
  payload.meta.title = (displayName(canvasMeta) + ' copy').trim()
  try { localStorage.setItem(slotKey(id), JSON.stringify(payload)) } catch (_) {
    showToast('No room left in this browser for another map', 'warning'); return
  }
  setCurrentId(id)
  loadPayload(payload)
  writeThrough()
  showToast('Duplicated. You are now on the copy', 'success', 2200)
}

export function deleteMap(id) {
  const index = loadIndex().filter(e => e.id !== id)
  saveIndex(index)
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
  const bundle = {
    format: 'pathfinder-maps',
    version: 1,
    exported: new Date().toISOString(),
    current: currentId(),
    maps: index.map(e => ({ id: e.id, name: e.name, updated: e.updated, payload: readSlot(e.id) }))
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
    it.addEventListener('click', () => { setDropdownOpen('mapsWrapper', false); fn() })
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
    row.querySelector('.map-item-name').textContent = sn.name
    row.querySelector('.map-item-meta').textContent =
      `${fmtWhen(sn.at)} · since then: ${diffPayloads(sn.payload, now)}`
    row.addEventListener('click', () => { setDropdownOpen('mapsWrapper', false); restoreSnapshot(sn.id) })
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
  writeThrough()

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
