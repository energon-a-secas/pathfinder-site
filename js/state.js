// ════════════════════════════════════════════════════════════
//  state.js — State management, localStorage load/save, undo/redo
// ════════════════════════════════════════════════════════════

import { STORAGE_KEY, debounce } from './utils.js'

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
}

export const canvasMeta = { title: '' }

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
    if (raw) {
      const d = JSON.parse(raw)
      state.blocks = d.blocks || {}
      state.arrows = d.arrows || []
      state.groups = d.groups || {}
      Object.assign(canvasMeta, d.meta || { title: '' })
    }
  } catch(_) {}
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
export function snap(v) { return ui.snapToGrid ? Math.round(v / 28) * 28 : v }

// ── World coordinate conversion ──────────────────────────────
export function toWorld(vx, vy) {
  return { x: (vx - view.panX) / view.zoom, y: (vy - view.panY) / view.zoom }
}
