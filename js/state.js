// ════════════════════════════════════════════════════════════
//  state.js — State management, localStorage load/save, undo/redo
// ════════════════════════════════════════════════════════════

import { STORAGE_KEY, DEFAULT_CARD_STYLE, SITUATION_DEFAULT, debounce } from './utils.js'
import { normalizeCanvas } from './normalize.js'

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
  pinPorts:       true,   // keep arrows on the port the user connected (vs auto-route)
  showArrowText:  false,  // always show arrow notes (vs reveal on hover/selection)
}

export const canvasMeta = { title: '', contextBrief: '', cardStyle: DEFAULT_CARD_STYLE, spotlight: false, situation: { ...SITUATION_DEFAULT } }

// dev-options
export const devOpts = { tone: 'auto', detail: 'standard', prePrompts: new Set(), mode: 'plan' }

// Prompt diff tracking — snapshot at last export, not persisted
export const promptState = { lastSnapshot: null }

// Pointer interaction state
export const pointer = { ix: null }

// ── Undo / Redo history ──────────────────────────────────────
const undoHistory   = []
const redoFuture    = []
const MAX_HISTORY   = 50

export function snapshot() {
  undoHistory.push(JSON.stringify({ blocks: state.blocks, arrows: state.arrows, groups: state.groups }))
  if (undoHistory.length > MAX_HISTORY) undoHistory.shift()
  redoFuture.length = 0
}

export function getUndoHistory() { return undoHistory }
export function getRedoFuture()  { return redoFuture }

// ── Persistence ──────────────────────────────────────────────
export function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ blocks: state.blocks, arrows: state.arrows, groups: state.groups, meta: canvasMeta })) }
  catch(_) {}
}
export const debouncedSave = debounce(saveState, 300)

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
  } catch(_) {}
}

// ── Camera persistence ───────────────────────────────────────
// Kept in its own key, deliberately not inside the canvas payload: a share
// link should carry the diagram, not the sender's pan and zoom.
const VIEW_KEY = 'pathfinder-view'

export function saveView() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ panX: view.panX, panY: view.panY, zoom: view.zoom })) }
  catch (_) {}
}
export const debouncedSaveView = debounce(saveView, 400)

/** Restore the saved camera. Returns false when there was nothing to restore. */
export function loadView() {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    if (!raw) return false
    const v = JSON.parse(raw)
    if (![v.panX, v.panY, v.zoom].every(Number.isFinite)) return false
    view.panX = v.panX; view.panY = v.panY; view.zoom = v.zoom
    return true
  } catch (_) { return false }
}

// ── Share URL encoding ───────────────────────────────────────
export function encodeCanvas() {
  return btoa(encodeURIComponent(JSON.stringify({ blocks: state.blocks, arrows: state.arrows, groups: state.groups, meta: canvasMeta })))
}

export function buildShareUrl(viewOnly = false) {
  return location.origin + location.pathname + (viewOnly ? '?readonly' : '') + '#s=' + encodeCanvas()
}

export function buildEmbedUrl() {
  return location.origin + location.pathname + '?embed&readonly#s=' + encodeCanvas()
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
