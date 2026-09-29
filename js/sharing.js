// ════════════════════════════════════════════════════════════
//  sharing.js: what arrives from outside, and keeping what is here.
//
//  Link and import safety: a share link (#s= or #z=), a ?src= URL
//  or an imported file opens as a NEW map by default. Replace and
//  Merge stay available as explicit choices in a real dialog, and a
//  replace keeps a named snapshot first. The map someone was working
//  on is never overwritten because they clicked a teammate's link.
//
//  Keeping what is here: a warning when another tab changes the
//  same map, an offer to restore what an older build of Pathfinder
//  dropped (library.js finds it), a "Backed up" line with Export all
//  in the status bar, one reminder when a week passes without an
//  export, and a request for persistent storage after the first save.
// ════════════════════════════════════════════════════════════

import { state, ui, canvasMeta, saveStatus, snapshot, primeShareLink, serializeCanvas, isShareHash } from './state.js'
import { STORAGE_KEY, showToast } from './utils.js'
import { normalizeCanvas } from './normalize.js'
import { applyImport } from './export.js'
import { updateCanvasTitle } from './render.js'
import { currentId, syncPointer, ensureLibrary, takeSnapshot, openAsNewMap, exportAllMaps, pointAtThisMap,
         readBackup, writeBackup, recordBackup, lastBackupAt, checkStorageForOlderVersion,
         pendingOlderVersionLoss, restoreOlderVersionLoss, dismissOlderVersionLoss,
         checkLoadForOlderVersion, mapWithPendingLoss, settleOlderVersionLoss } from './library.js'
import { collapseTemplatesAfterUse, refreshSituation, refreshCardStyles,
         refreshSpotlight, syncContextBrief, checkShareUrl } from './ui-panels.js'
import { suspendUnloadFlush } from './persistence-ui.js'

const DAY = 86_400_000
const NAG_AFTER = 7 * DAY

// ── Incoming canvases ────────────────────────────────────────

/**
 * Whether the open map holds anything a replace would lose. Blocks an
 * older build dropped and the restore offer still holds count: that map
 * only looks empty, and a link that replaced it without asking would put a
 * teammate's canvas where Restore brings them back. A link on the page
 * load gets here before setupLibrary, so this asks for the load's check
 * itself (once per page; library.js checkLoadForOlderVersion).
 */
export function hasContent() {
  return Object.keys(state.blocks).length > 0 || state.arrows.length > 0 ||
    !!String(canvasMeta.title || '').trim() || !!String(canvasMeta.contextBrief || '').trim() ||
    !!checkLoadForOlderVersion()
}

function countOf(data) {
  const b = data?.blocks
  const blocks = Array.isArray(b) ? b.length : (b && typeof b === 'object' ? Object.keys(b).length : 0)
  const arrows = Array.isArray(data?.arrows) ? data.arrows.length : 0
  return { blocks, arrows }
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

const HEADINGS = {
  link: () => 'Open the shared map',
  src: () => 'Open the linked map',
  file: name => name ? `Import ${name}` : 'Import a file',
}

let openDialog = null

/**
 * Ask what to do with an incoming canvas. Resolves to 'new', 'replace',
 * 'merge', or null when the person cancels (Escape counts as cancel).
 * Everything incoming is written with textContent: a shared title is
 * someone else's text.
 */
export function chooseIncoming({ source = 'link', name = '', data = null } = {}) {
  if (openDialog) openDialog.finish(null)
  return new Promise(resolve => {
    const returnTo = document.activeElement
    const dlg = document.createElement('dialog')
    dlg.className = 'incoming-dialog'
    dlg.id = 'incomingDialog'
    dlg.setAttribute('data-canvas-ui', '')
    dlg.setAttribute('aria-labelledby', 'incomingTitle')
    dlg.setAttribute('aria-describedby', 'incomingDesc')
    dlg.innerHTML = `
      <h2 class="incoming-title" id="incomingTitle"></h2>
      <p class="incoming-desc" id="incomingDesc"></p>
      <div class="incoming-actions">
        <button type="button" class="incoming-btn incoming-primary" data-choice="new">Open as a new map</button>
        <button type="button" class="incoming-btn" data-choice="replace">Replace current map</button>
        <button type="button" class="incoming-btn" data-choice="merge">Merge into current map</button>
        <button type="button" class="incoming-btn incoming-cancel" data-choice="cancel">Cancel</button>
      </div>
      <p class="incoming-hint">Replace keeps a snapshot of your map under Maps, Snapshots. Undo reverses a replace or a merge.</p>`
    dlg.querySelector('.incoming-title').textContent = (HEADINGS[source] || HEADINGS.link)(name)
    const { blocks, arrows } = countOf(data)
    const incomingTitle = String(data?.meta?.title || '').trim()
    const mine = String(canvasMeta.title || '').trim()
    dlg.querySelector('.incoming-desc').textContent =
      `${incomingTitle ? `"${incomingTitle}"` : 'An untitled map'} with ${plural(blocks, 'block')} and ${plural(arrows, 'connection')}. ` +
      `Your current map${mine ? `, "${mine}",` : ''} stays as it is unless you choose Replace or Merge.`

    let done = false
    const finish = choice => {
      if (done) return
      done = true
      if (openDialog?.dlg === dlg) openDialog = null
      try { if (dlg.open) dlg.close() } catch (_) {}
      dlg.remove()
      if (returnTo && typeof returnTo.focus === 'function' && document.contains(returnTo)) {
        try { returnTo.focus({ preventScroll: true }) } catch (_) {}
      }
      resolve(choice === 'cancel' ? null : choice)
    }
    dlg.addEventListener('click', e => {
      const btn = e.target.closest('[data-choice]')
      if (btn) finish(btn.dataset.choice)
    })
    // The canvas shortcuts listen on the document. A key pressed on these
    // buttons must not delete, undo or toggle anything on the map behind the
    // dialog. Enter, Space and Escape are the buttons' and the dialog's own
    // default actions, which stopping propagation leaves alone.
    dlg.addEventListener('keydown', e => e.stopPropagation())
    // Escape fires 'cancel' on a modal dialog: treat it as the Cancel button.
    dlg.addEventListener('cancel', e => { e.preventDefault(); finish(null) })
    document.body.appendChild(dlg)
    openDialog = { dlg, finish }
    try { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '') }
    catch (_) { dlg.setAttribute('open', '') }
    dlg.querySelector('.incoming-primary')?.focus()
  })
}

/** The dialog currently asking, if any (tests and the link loader use it). */
export function incomingDialog() { return openDialog?.dlg || null }

// The canvas-level refreshes every load needs, whichever path it took.
function afterLoad() {
  collapseTemplatesAfterUse()
  refreshSituation(); refreshCardStyles(); refreshSpotlight()
  updateCanvasTitle()
  syncContextBrief()
  window.dispatchEvent(new CustomEvent('pf:canvas-changed'))
}

/**
 * A map opened as a new one needs a name the Maps menu can tell apart from
 * the one it came from: an untitled canvas was listed as "Untitled map" next
 * to another "Untitled map". A file lends its name (without the extension),
 * a link says what it was and when. A canvas with a title keeps it.
 */
export function withMapName(data, { source = 'link', name = '', now = new Date() } = {}) {
  if (!data || typeof data !== 'object') return data
  const meta = data.meta && typeof data.meta === 'object' ? data.meta : {}
  if (typeof meta.title === 'string' && meta.title.trim()) return data
  const base = source === 'file' ? String(name || '').replace(/\.[^./\\]+$/, '').trim() : ''
  let when = ''
  try { when = now.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) } catch (_) {}
  const title = base || (when ? `Shared map, ${when}` : 'Shared map')
  return { ...data, meta: { ...meta, title } }
}

/**
 * Apply an incoming canvas in the chosen mode. 'new' opens it as its own
 * map; 'replace' keeps a named snapshot of the current map first and is
 * one undo step; 'merge' is one undo step. Read-only and embed views
 * replace in memory only, since they never save.
 * Returns { mode, imported, dropped, idMap }, or null when nothing changed.
 */
export function applyIncoming(data, mode, { source = 'link', name = '' } = {}) {
  const live = !ui.readOnly && !ui.embed
  if (mode === 'new' && live) {
    const r = openAsNewMap(withMapName(data, { source, name }))
    return r ? { mode, ...r } : null
  }
  const m = mode === 'merge' ? 'merge' : 'replace'
  const had = live && hasContent()
  // Blocks an older build dropped from this map, still on offer: a replace
  // keeps them in its snapshot and its undo step, and the offer ends, since
  // the canvas it would restore them into is about to be someone else's.
  const loss = had && m === 'replace' ? pendingOlderVersionLoss() : null
  const whole = loss ? mapWithPendingLoss(loss) : null
  if (had && m === 'replace') {
    ensureLibrary()
    const label = source === 'file' ? `Before importing ${name || 'a file'}` : 'Before loading shared link'
    if (!takeSnapshot(label, whole)) {
      showToast('No room to keep a snapshot of your map, so nothing was replaced. Open it as a new map, or free some storage', 'warning', 4500)
      return null
    }
  }
  // A replace swaps the title, brief, card style, situation and prompt
  // options too, so its undo step carries the whole framing: one undo brings
  // back your blocks under your own title, not the teammate's.
  if (whole) snapshotWith(whole)
  else if (had) snapshot({ framing: m === 'replace' })
  const kept = loss ? loss.blocks.filter(b => !state.blocks[b.id]).length : 0
  if (loss) settleOlderVersionLoss(loss)
  const r = applyImport(data, m)
  afterLoad()
  return { mode: m, replacedContent: had && m === 'replace', ...(kept > 0 ? { keptDropped: kept } : {}), ...r }
}

// The replace's undo step, taken from the map with the offered blocks back
// in it (undoEntry reads the live state, so it is lent them for the call).
function snapshotWith(whole) {
  const live = { blocks: state.blocks, arrows: state.arrows, groups: state.groups }
  state.blocks = whole.blocks; state.arrows = whole.arrows; state.groups = whole.groups || {}
  try { snapshot({ framing: true }) }
  finally { Object.assign(state, live) }
}

/**
 * Receive a canvas from outside. An empty map, and every read-only or
 * embedded view, takes it directly (and synchronously, so a view-only
 * link renders on first paint). Otherwise the person chooses, with
 * "Open as a new map" first.
 * Resolves to applyIncoming's result, or null when cancelled or refused.
 */
export function openIncoming(data, { source = 'link', name = '', onApplied } = {}) {
  const settle = r => { if (r && onApplied) onApplied(r); return r }
  if (ui.readOnly || ui.embed || !hasContent()) {
    return Promise.resolve(settle(applyIncoming(data, 'replace', { source, name })))
  }
  return chooseIncoming({ source, name, data }).then(mode => {
    if (!mode) {
      showToast(source === 'file' ? 'Import cancelled. Nothing changed'
        : 'Shared map not opened. Nothing changed; reload the page to be asked again', 'info', 3200)
      return null
    }
    return settle(applyIncoming(data, mode, { source, name }))
  })
}

/** The toast after an incoming canvas lands. */
export function incomingMessage(r, what = 'map') {
  if (!r) return null
  const skipped = r.dropped ? r.dropped.blocks + r.dropped.arrows + r.dropped.groups : 0
  const tail = skipped ? `, skipped ${plural(skipped, 'invalid item')}` : ''
  if (r.mode === 'new') return `Opened the ${what} as a new map${tail}. Yours is under Maps`
  if (r.mode === 'merge') return `Merged ${plural(r.imported, 'block')} into your map${tail}`
  if (r.replacedContent && r.keptDropped) {
    return `Replaced your map with the ${what}${tail}. Undo, or Maps, Snapshots, brings yours back, with the ${plural(r.keptDropped, 'block')} an older version dropped`
  }
  if (r.replacedContent) return `Replaced your map with the ${what}${tail}. Undo, or Maps, Snapshots, brings yours back`
  return skipped ? `Loaded the ${what}${tail}` : null
}

// ── Another tab changed this map ─────────────────────────────
// Two tabs with the same map open both save to its slot, so the last tab to
// save wins. Nothing can merge two tabs' edits; the honest thing is to say
// so the moment it happens. A tab that opens or switches to another map is
// no conflict: library.js keeps this tab's saves on this tab's map.

function otherTabBanner() { return document.getElementById('otherTabBanner') }

export function showOtherTabBanner() {
  if (ui.readOnly || ui.embed) return null
  let el = otherTabBanner()
  if (el) return el
  el = document.createElement('div')
  el.id = 'otherTabBanner'
  el.className = 'other-tab-banner'
  el.setAttribute('data-canvas-ui', '')
  el.setAttribute('role', 'alert')
  el.innerHTML = '<span class="other-tab-text">This map changed in another tab. Reload to see that version; editing here will overwrite it.</span>' +
    '<button type="button" class="other-tab-reload">Reload</button>' +
    '<button type="button" class="other-tab-dismiss">Keep editing here</button>'
  el.querySelector('.other-tab-reload').addEventListener('click', () => {
    // A flush on the way out would write this tab's copy over the newer one.
    suspendUnloadFlush()
    // Reload into this map as the other tab left it, even if that tab has
    // since moved on to another map.
    pointAtThisMap()
    location.reload()
  })
  el.querySelector('.other-tab-dismiss').addEventListener('click', () => el.remove())
  ;(document.getElementById('canvasViewport') || document.body).appendChild(el)
  return el
}

// What a stored canvas means, whatever shape it was saved in: a tab that
// opens a map saves it normalized, which changes its bytes and nothing else.
function meaningOf(raw) {
  try {
    const c = normalizeCanvas(typeof raw === 'string' ? JSON.parse(raw) : raw)
    return JSON.stringify([c.blocks, c.arrows, c.groups, c.meta])
  } catch (_) { return null }
}

/**
 * Whether a storage event means another tab changed the map this tab has
 * open. Only that map's own slot counts (STORAGE_KEY is written by every
 * tab for whichever map it has open, and the pointer moving is library.js's
 * business). A write that means what was stored before, or what this tab
 * shows, is a tab opening the map, not a change.
 */
export function touchesThisMap(e) {
  if (!e || (e.storageArea && e.storageArea !== localStorage)) return false
  const k = e.key
  if (k === null) return true
  const id = currentId()
  if (k !== (id ? 'pathfinder-map-' + id : STORAGE_KEY)) return false
  if (e.newValue == null) return true
  const next = meaningOf(e.newValue)
  if (next === null) return true
  if (e.oldValue != null && next === meaningOf(e.oldValue)) return false
  return next !== meaningOf(serializeCanvas())
}

function onStorage(e) {
  if (ui.readOnly || ui.embed) return
  // Which map is this tab's, before anything below asks currentId(): the
  // other tab's pointer may already read as moved (library.js syncPointer).
  syncPointer()
  // An older build dropped blocks: that banner says more than this one,
  // and closing it brings this one up if the map still differs.
  if (checkStorageForOlderVersion(e)) return
  if (otherTabBanner() || olderVersionBanner()) return
  if (touchesThisMap(e)) showOtherTabBanner()
}

// ── An older build dropped blocks ────────────────────────────
// library.js compares a map's stored copy with the copy this build last
// saved (on load, on a map switch, and when another tab writes it) and
// raises `pf:older-version-loss`. This is the banner that answers it.

function olderVersionBanner() { return document.getElementById('olderVersionBanner') }

/**
 * The banner's words for a loss. Every block offered is of a type the
 * older build could not read (library.js findOlderVersionLoss counts no
 * other kind). When nothing in the save showed an older build wrote it
 * (`unsure`: a map with no connections looks the same after a current tab
 * deleted the card on purpose), the banner offers without claiming.
 */
export function olderVersionText(loss) {
  const n = loss?.ids?.length || 0
  const them = n === 1 ? 'it' : 'them'
  if (loss?.unsure) {
    return `This map is missing ${plural(n, 'block')} that an older version of Pathfinder cannot read. ` +
      `It may have dropped ${them}, or ${n === 1 ? 'it was' : 'they were'} deleted on purpose. Restore ${them}?`
  }
  const head = `An older version of Pathfinder saved this map and dropped ${plural(n, 'block')} it does not understand. Restore ${them}?`
  // Another tab is still running the older build and will drop them again.
  return loss?.source === 'storage'
    ? `${head} Close any Pathfinder tab opened before the update, or its next save drops ${them} again.`
    : head
}

// Whether the open map's stored copy says something other than this tab.
function slotDiffers() {
  const id = currentId()
  if (!id) return false
  try {
    const raw = localStorage.getItem('pathfinder-map-' + id)
    return raw != null && meaningOf(raw) !== meaningOf(serializeCanvas())
  } catch (_) { return false }
}

/** Close the banner, handing focus to the canvas if it was on the banner. */
export function closeOlderVersionBanner() {
  const el = olderVersionBanner()
  if (!el) return
  const hadFocus = el.contains(document.activeElement)
  el.remove()
  if (hadFocus) {
    try { document.getElementById('canvasViewport')?.focus({ preventScroll: true }) } catch (_) {}
  }
}

// After Restore or Dismiss: a stored copy that still says something else
// (Dismiss on a loss another tab caused) is the ordinary other-tab case.
function afterAnswer() {
  closeOlderVersionBanner()
  if (slotDiffers()) showOtherTabBanner()
}

export function showOlderVersionBanner(loss = pendingOlderVersionLoss()) {
  if (ui.readOnly || ui.embed || !loss || loss.mapId !== currentId()) return null
  otherTabBanner()?.remove()
  let el = olderVersionBanner()
  if (!el) {
    el = document.createElement('div')
    el.id = 'olderVersionBanner'
    // The other-tab banner's look and place: both are about this map's
    // stored copy, and only one shows at a time.
    el.className = 'other-tab-banner older-version-banner'
    el.setAttribute('data-canvas-ui', '')
    el.setAttribute('role', 'alert')
    el.innerHTML = '<span class="other-tab-text older-version-text"></span>' +
      '<button type="button" class="older-version-restore">Restore</button>' +
      '<button type="button" class="older-version-dismiss">Dismiss</button>'
    el.querySelector('.older-version-restore').addEventListener('click', () => {
      const r = restoreOlderVersionLoss(pendingOlderVersionLoss())
      afterAnswer()
      if (!r) return
      showToast(r.blocks
        ? `Restored ${plural(r.blocks, 'block')}${r.arrows ? ` and ${plural(r.arrows, 'connection')}` : ''}. Undo takes ${r.blocks === 1 ? 'it' : 'them'} out again`
        : 'Saved this tab\'s copy, which still has them', 'success', 3200)
    })
    el.querySelector('.older-version-dismiss').addEventListener('click', () => {
      dismissOlderVersionLoss(pendingOlderVersionLoss())
      afterAnswer()
    })
    ;(document.getElementById('canvasViewport') || document.body).appendChild(el)
  }
  el.querySelector('.older-version-text').textContent = olderVersionText(loss)
  return el
}

// ── Backups ──────────────────────────────────────────────────

/** "Backed up: never", "Backed up: today", "Backed up: 3 days ago". */
export function backupStatusText(at, now = Date.now()) {
  if (!at) return 'Backed up: never'
  const days = Math.floor(Math.max(0, now - at) / DAY)
  if (days === 0) return 'Backed up: today'
  return `Backed up: ${plural(days, 'day')} ago`
}

/**
 * Whether a week has passed without an export of this map. A map never
 * exported counts from the later of when tracking began and the last
 * Export all (which it was not part of), so a new map is not stale at birth.
 */
export function backupStale(now = Date.now(), mapId = currentId()) {
  const b = readBackup()
  const at = lastBackupAt(mapId) || Math.max(b.since || 0, b.all || 0)
  return !!at && now - at > NAG_AFTER
}

export function refreshBackupStatus(now = Date.now()) {
  const host = document.getElementById('backupStatus')
  if (!host) return
  if (ui.readOnly || ui.embed) { host.hidden = true; return }
  if (!host.querySelector('.backup-text')) {
    host.innerHTML = '<span class="backup-text"></span>' +
      '<button type="button" class="backup-export" title="Download every map in this browser as one JSON file">Export all</button>'
    host.querySelector('.backup-export').addEventListener('click', () => exportAllMaps())
  }
  const at = lastBackupAt()
  host.querySelector('.backup-text').textContent = backupStatusText(at, now)
  host.title = at ? 'Last exported ' + new Date(at).toLocaleString() : 'No export of this map yet. Maps live only in this browser until you export them'
  host.classList.toggle('backup-stale', backupStale(now))
  host.hidden = false
}

/**
 * One reminder when a map changes and a week has passed without an
 * export. Returns whether it nagged. At most once per session and once a
 * week, so it stays a reminder rather than a tax.
 */
let naggedThisSession = false
export function maybeNagBackup(now = Date.now()) {
  if (ui.readOnly || ui.embed || naggedThisSession) return false
  if (!backupStale(now)) return false
  const b = readBackup()
  if (b.nagAt && now - b.nagAt < NAG_AFTER) return false
  naggedThisSession = true
  b.nagAt = now
  writeBackup(b)
  const at = lastBackupAt()
  showToast(backupNagText(at ? Math.floor((now - at) / DAY) : null), 'warning', 6000)
  return true
}

// Same width as the [sharing] rule that hides the status bar's backup slot.
const NARROW = '(max-width: 700px)'

/**
 * The reminder's words. It names a control the person can see: the status
 * bar's Export all, or on a phone (where that slot is hidden) the Maps menu.
 */
export function backupNagText(days, narrow = !!globalThis.matchMedia?.(NARROW).matches) {
  const where = narrow ? 'Export all maps, in the Maps menu,' : 'Export all, in the status bar,'
  return days == null
    ? `Your maps live only in this browser and were never exported. ${where} keeps a copy`
    : `Your maps live only in this browser, last exported ${plural(days, 'day')} ago. ${where} keeps a copy`
}

/** Test hook: allow the once-per-session reminder again. */
export function resetBackupNag() { naggedThisSession = false }

/**
 * Ask the browser not to evict this origin's storage. Safari deletes
 * script-written data after seven days without a visit unless it is
 * persistent. Resolves true, false, or null when unsupported.
 */
export async function requestPersistence(storage = globalThis.navigator?.storage) {
  try {
    if (!storage || typeof storage.persist !== 'function') return null
    if (typeof storage.persisted === 'function' && await storage.persisted()) return true
    return !!(await storage.persist())
  } catch (_) { return null }
}

// ── Setup ────────────────────────────────────────────────────

let wired = false

export function setupSharingSafety() {
  if (wired) return
  wired = true
  const live = !ui.readOnly && !ui.embed

  // The Share menu copies synchronously, so keep a compressed link ready.
  const prime = () => { primeShareLink() }
  let primeTimer = null
  const primeSoon = () => { clearTimeout(primeTimer); primeTimer = setTimeout(prime, 500) }
  const shareBtn = document.getElementById('shareBtn')
  ;['pointerenter', 'pointerdown', 'focus'].forEach(t => shareBtn?.addEventListener(t, prime))
  window.addEventListener('pf:canvas-changed', primeSoon)
  setTimeout(prime, 0)

  // A link pasted into the address bar of an open tab only changes the
  // hash, so no page load reads it. Read it here, through the same choice.
  window.addEventListener('hashchange', () => {
    if (isShareHash(location.hash) && !incomingDialog()) checkShareUrl()
  })

  if (!live) {
    const host = document.getElementById('backupStatus')
    if (host) host.hidden = true
    return
  }

  window.addEventListener('storage', onStorage)
  // A loss found before this ran (on load) is waiting; later ones arrive.
  window.addEventListener('pf:older-version-loss', e => {
    if (e.detail) showOlderVersionBanner(e.detail)
    else closeOlderVersionBanner()
  })
  showOlderVersionBanner()

  const b = readBackup()
  if (!b.since) { b.since = Date.now(); writeBackup(b) }
  refreshBackupStatus()
  window.addEventListener('pf:backup-recorded', () => refreshBackupStatus())
  window.addEventListener('pf:canvas-changed', () => refreshBackupStatus())
  // Download JSON and the save-failure backup are single-map exports.
  document.addEventListener('click', e => {
    if (e.target.closest?.('#exportJSON, #saveBackup')) recordBackup(currentId() || 'all')
  })

  let persistAsked = false
  window.addEventListener('pf:save-status', () => {
    if (saveStatus.phase === 'pending') maybeNagBackup()
    if (saveStatus.phase === 'saved') {
      primeSoon()
      if (!persistAsked) { persistAsked = true; requestPersistence() }
    }
  })
}
