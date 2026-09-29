// ════════════════════════════════════════════════════════════
//  state.js: state management, localStorage load/save, undo/redo
// ════════════════════════════════════════════════════════════

import { STORAGE_KEY, DEFAULT_CARD_STYLE, SITUATION_DEFAULT, MIN_ZOOM, MAX_ZOOM, clamp, debounce } from './utils.js'
import { normalizeCanvas, normalizeBlock, normalizeArrow, normalizeSituation, normalizePromptOpts } from './normalize.js'

// ── App state (mutable, shared by all modules) ──────────────
export const state = { blocks: {}, arrows: [], groups: {} }
export const view  = { panX: 0, panY: 0, zoom: 1 }

export const selection = {
  blockId:  null,
  arrowId:  null,
  ids:      new Set(),
  groupId:  null,
}

export const ui = {
  activeTab:      'inspector',
  promptDirty:    true,
  readOnly:       false,
  embed:          false,
  searchOpen:     false,
  searchFocusIdx: -1,
  snapToGrid:     false,
  tintedBlocks:   false,
  lightMode:      false,
  hoveredBlockId: null,
  // Off by default since 2026-09-28: pinned ends fight Tidy and the router,
  // so new connections auto-route unless the saved preference says otherwise.
  pinPorts:       false,  // keep arrows on the port the user connected (vs auto-route)
  showArrowText:  false,  // always show arrow notes (vs reveal on hover/selection)
  votingMode:     false,  // dot voting: a click on a card adds a dot only while this is on
}

export const canvasMeta = { title: '', contextBrief: '', cardStyle: DEFAULT_CARD_STYLE, spotlight: false, situation: { ...SITUATION_DEFAULT } }

// dev-options
export const devOpts = { tone: 'auto', detail: 'standard', prePrompts: new Set(), mode: 'plan' }

// Prompt diff tracking: a snapshot at the last export, not persisted
export const promptState = { lastSnapshot: null }

// Pointer interaction state
export const pointer = { ix: null }

// ── Undo / Redo history ──────────────────────────────────────
const undoHistory   = []
const redoFuture    = []
const MAX_HISTORY   = 50

// The coalescing token of the last snapshotOnce(). A typing burst in one
// field calls snapshotOnce with the same token on every input event, so the
// whole burst is one undo step. Any plain snapshot() ends the burst.
let lastSnapshotToken = null

// The map settings an undo step carries. Card style and Spotlight change
// only through controls that take a snapshot, so every step can hold them
// without an unrelated undo ever reverting one. A replace swaps the whole
// framing (title, brief, situation, prompt options too), so its step holds
// all of it: `framing: true`. Title and brief edits take no snapshot of
// their own, which is why an ordinary step leaves them alone.
const LOOK_KEYS = ['cardStyle', 'spotlight']

/** The undo entry for the canvas as it is now. `framing` holds the whole meta. */
export function undoEntry({ framing = false } = {}) {
  const meta = framing
    ? JSON.parse(JSON.stringify(serializeCanvas().meta))
    : Object.fromEntries(LOOK_KEYS.map(k => [k, canvasMeta[k] ?? null]))
  return JSON.stringify({ blocks: state.blocks, arrows: state.arrows, groups: state.groups, meta, framing: !!framing })
}

export function snapshot({ framing = false } = {}) {
  undoHistory.push(undoEntry({ framing }))
  if (undoHistory.length > MAX_HISTORY) undoHistory.shift()
  redoFuture.length = 0
  lastSnapshotToken = null
}

/** Snapshot unless the previous snapshot was taken for the same token. */
export function snapshotOnce(token) {
  if (token != null && token === lastSnapshotToken) return false
  snapshot()
  lastSnapshotToken = token ?? null
  return true
}

/** End the current coalescing burst (undo, redo, a field losing focus). */
export function resetSnapshotToken() { lastSnapshotToken = null }

export function getUndoHistory() { return undoHistory }
export function getRedoFuture()  { return redoFuture }

// ── Persistence ──────────────────────────────────────────────
// Write-through hooks: the canvas library mirrors the active canvas into its
// own per-map slot on every save. Registered from library.js, so this module
// keeps zero knowledge of the library.
export const saveHooks = []
export const saveStatus = { phase: 'idle', savedAt: null, message: '' }

function setSaveStatus(phase, message = '') {
  Object.assign(saveStatus, { phase, message })
  if (phase === 'saved') saveStatus.savedAt = Date.now()
  window.dispatchEvent(new CustomEvent('pf:save-status'))
}

// One serializer for every copy of the canvas that leaves memory: autosave,
// share links, the Maps library and file export all call this, so none of
// them can drift. meta.prompt is derived from devOpts at write time; devOpts
// stays the single live object every module already imports.
export function serializeCanvas() {
  return {
    blocks: state.blocks, arrows: state.arrows, groups: state.groups,
    meta: { ...canvasMeta, prompt: { mode: devOpts.mode, tone: devOpts.tone, detail: devOpts.detail, pre: [...devOpts.prePrompts] } },
  }
}

/** Apply a normalized meta.prompt into the live devOpts. */
export function applyPromptOpts(p) {
  if (!p) return
  devOpts.mode = p.mode; devOpts.tone = p.tone; devOpts.detail = p.detail
  devOpts.prePrompts = new Set(p.pre || [])
}

export function saveState() {
  // A shared preview is a separate document, never the visitor's active map.
  if (ui.readOnly || ui.embed) return true
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeCanvas()))
    for (const fn of saveHooks) {
      if (fn() === false) throw new Error('Map library write failed')
    }
    setSaveStatus('saved')
    return true
  } catch (_) {
    setSaveStatus('error', 'Changes are only in this tab. Download a backup or free browser storage, then retry.')
    return false
  }
}
const queueSave = debounce(saveState, 300)
export function debouncedSave() {
  if (ui.readOnly || ui.embed) return
  if (saveStatus.phase !== 'error') setSaveStatus('pending')
  queueSave()
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    // Normalize shape only. Arrows with missing endpoints are left in place;
    // render, gap detection, and prompt export already skip them safely, and
    // dropping them here would silently mutate a saved canvas on every load.
    const clean = normalizeCanvas(JSON.parse(raw))
    state.blocks = clean.blocks
    state.arrows = clean.arrows
    state.groups = clean.groups
    Object.assign(canvasMeta, clean.meta)
    applyPromptOpts(clean.meta.prompt)
  } catch(_) {}
}

// ── Camera persistence ───────────────────────────────────────
// Kept in its own key, deliberately not inside the canvas payload: a share
// link should carry the diagram, not the sender's pan and zoom.
// Per map since 2026-08-24: each map remembers its own camera. The legacy
// single key stays as a read fallback so nobody's view jumps on upgrade.
const VIEW_KEY = 'pathfinder-view'

// Which map this tab has open. library.js answers (its currentId knows when
// another tab has moved the shared pointer, and keeps this tab on its own
// map); until it has loaded, the shared pointer itself.
export const mapIdHooks = { current: null }

const viewKey = () => {
  try {
    const cur = mapIdHooks.current ? mapIdHooks.current() : localStorage.getItem('pathfinder-map-current')
    return cur ? 'pathfinder-view:' + cur : VIEW_KEY
  } catch (_) { return VIEW_KEY }
}

export function saveView() {
  if (ui.readOnly || ui.embed) return
  try { localStorage.setItem(viewKey(), JSON.stringify({ panX: view.panX, panY: view.panY, zoom: view.zoom })) }
  catch (_) {}
}
export const debouncedSaveView = debounce(saveView, 400)

/** Restore the saved camera. Returns false when there was nothing to restore. */
export function loadView({ legacy = true } = {}) {
  try {
    const raw = localStorage.getItem(viewKey()) || (legacy && localStorage.getItem(VIEW_KEY))
    if (!raw) return false
    const v = JSON.parse(raw)
    if (![v.panX, v.panY, v.zoom].every(Number.isFinite)) return false
    view.panX = v.panX; view.panY = v.panY; view.zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM)
    return true
  } catch (_) { return false }
}

// ── Share URL encoding ───────────────────────────────────────
// Two link formats, both decoded forever:
//   #s=  base64 of the URI-encoded JSON (the original; still produced when
//        the browser has no CompressionStream).
//   #z=  deflate-raw of the JSON, base64url. Several times shorter, which is
//        what makes a link pasteable into chat, a ticket or an email.
// Compression is asynchronous, but the Share menu copies synchronously, so
// buildShareUrl() reads a cache kept fresh after every save (sharing.js
// primes it) and falls back to #s= only when the cache is stale.

/** The original #s= payload of the full canvas. Kept byte-for-byte. */
export function encodeCanvas() {
  return btoa(encodeURIComponent(JSON.stringify(serializeCanvas())))
}

// null, false and empty values that normalize would restore on its own.
const isBlank = v => v == null || v === false || v === '' ||
  (Array.isArray(v) && !v.length) ||
  (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)

/**
 * Drop blank fields whose absence normalizes to the same thing. The check
 * runs normalize itself rather than a list of defaults, so a field whose
 * absence means something different (an arrow label of '' versus none) is
 * kept, and a field added later is handled without touching this.
 */
function stripBlank(obj, norm) {
  if (!obj || typeof obj !== 'object') return obj
  const keys = Object.keys(obj).filter(k => isBlank(obj[k]))
  if (!keys.length) return obj
  const ref = JSON.stringify(norm(obj))
  const all = { ...obj }
  keys.forEach(k => delete all[k])
  if (JSON.stringify(norm(all)) === ref) return all
  const some = { ...obj }
  keys.forEach(k => {
    const v = some[k]
    delete some[k]
    if (JSON.stringify(norm(some)) !== ref) some[k] = v
  })
  return some
}

/**
 * The canvas as a share link carries it: serializeCanvas() minus the blank
 * fields every block repeats. Only links use it; autosave, the Maps library
 * and file export keep the full shape.
 */
export function serializeForShare() {
  const c = serializeCanvas()
  const blocks = {}
  Object.entries(c.blocks).forEach(([id, b]) => { blocks[id] = stripBlank(b, normalizeBlock) })
  const meta = { ...c.meta }
  if (meta.situation) meta.situation = stripBlank(meta.situation, normalizeSituation)
  if (meta.prompt) meta.prompt = stripBlank(meta.prompt, normalizePromptOpts)
  return {
    blocks,
    arrows: c.arrows.map(a => stripBlank(a, normalizeArrow)),
    groups: c.groups,
    meta: stripBlank(meta, m => normalizeCanvas({ meta: m }).meta),
  }
}

export const canCompressLinks = () =>
  typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'

function bytesToB64url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(str) {
  const b64 = String(str).trim().replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// A link is untrusted input, and deflate expands up to about 1000x, so
// inflating stops at a cap rather than trusting the stream to end.
const MAX_INFLATED = 8_000_000

async function readAll(stream, cap = Infinity) {
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > cap) { try { await reader.cancel() } catch (_) {} throw new Error('Link payload too large') }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  chunks.forEach(c => { out.set(c, at); at += c.length })
  return out
}

/** Text to deflate-raw base64url. */
export async function compressText(text) {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return bytesToB64url(await readAll(stream))
}

/** deflate-raw base64url back to text. Throws on damage or over the cap. */
export async function decompressText(z) {
  const stream = new Blob([b64urlToBytes(z)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new TextDecoder().decode(await readAll(stream, MAX_INFLATED))
}

/** Decode a #s= hash synchronously. Throws when it is not one. */
export function decodeLegacyShare(hash) {
  const body = String(hash || '').replace(/^#?s=/, '')
  return JSON.parse(decodeURIComponent(atob(body)))
}

/** Decode a #s= or #z= hash into the raw canvas object, or null. */
export async function decodeShareHash(hash) {
  const h = String(hash || '')
  if (h.startsWith('#s=')) return decodeLegacyShare(h)
  if (h.startsWith('#z=')) {
    if (!canCompressLinks()) throw new Error('This browser cannot open compressed links')
    return JSON.parse(await decompressText(h.slice(3)))
  }
  return null
}

/** Whether a hash is a share link this build can read (#s= or #z=). */
export const isShareHash = hash => /^#[sz]=/.test(String(hash || ''))

const linkCache = { json: null, z: null, job: null, jobJson: null }

/**
 * Compress the current canvas for the next link, unless the cache already
 * holds it. Resolves to the #z= payload, or null when compression is
 * unavailable or failed (the link then falls back to #s=).
 */
export function primeShareLink() {
  if (!canCompressLinks()) return Promise.resolve(null)
  const json = JSON.stringify(serializeForShare())
  if (linkCache.json === json && linkCache.z) return Promise.resolve(linkCache.z)
  if (linkCache.job && linkCache.jobJson === json) return linkCache.job
  const job = compressText(json).then(z => {
    linkCache.json = json; linkCache.z = z
    return z
  }, () => null).finally(() => {
    if (linkCache.job === job) { linkCache.job = null; linkCache.jobJson = null }
  })
  linkCache.job = job; linkCache.jobJson = json
  return job
}

function shareFragment() {
  const json = JSON.stringify(serializeForShare())
  if (linkCache.json === json && linkCache.z) return '#z=' + linkCache.z
  // Stale: this link is the long form, the next one will not be.
  primeShareLink()
  return '#s=' + btoa(encodeURIComponent(json))
}

// `via` marks the arrival for the header kit's share counter, which reads
// ?via= but only recognises #s= among the hashes, so a #z= link would not
// count without it. The app removes it once the link is spent.
export function buildShareUrl(viewOnly = false) {
  return location.origin + location.pathname + (viewOnly ? '?readonly&via=share' : '?via=share') + shareFragment()
}

export function buildEmbedUrl() {
  return location.origin + location.pathname + '?embed&readonly&via=embed' + shareFragment()
}

/** buildShareUrl() once compression has caught up: always #z= when supported. */
export async function buildShareUrlAsync(viewOnly = false) {
  await primeShareLink()
  return buildShareUrl(viewOnly)
}

export async function buildEmbedUrlAsync() {
  await primeShareLink()
  return buildEmbedUrl()
}

// ── Snap helper ──────────────────────────────────────────────
export const GRID = 28

/**
 * Round to the grid, half away from zero.
 *
 * Math.round breaks exact halves toward +Infinity, so a block dragged to
 * y = -14 snapped to 0 while the same block at y = +14 snapped to 28. The
 * grid should not behave differently above and below the origin.
 */
export function snapTo(v, grid = GRID) {
  return Math.sign(v) * Math.round(Math.abs(v) / grid) * grid
}

export function snap(v) { return ui.snapToGrid ? snapTo(v) : v }

// ── World coordinate conversion ──────────────────────────────
export function toWorld(vx, vy) {
  return { x: (vx - view.panX) / view.zoom, y: (vy - view.panY) / view.zoom }
}
