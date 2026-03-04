// ════════════════════════════════════════════════════════════
//  utils.js — Small shared helpers
// ════════════════════════════════════════════════════════════

// ── Constants ────────────────────────────────────────────────
export const TYPES = {
  goal:        { label: 'Goal',        color: '#a78bfa' },
  problem:     { label: 'Problem',     color: '#f87171' },
  requirement: { label: 'Requirement', color: '#fbbf24' },
  risk:        { label: 'Risk',        color: '#fb923c' },
  question:    { label: 'Question',    color: '#38bdf8' },
  decision:    { label: 'Decision',    color: '#34d399' },
  resource:    { label: 'Resource',    color: '#2dd4bf' },
  output:      { label: 'Output',      color: '#818cf8' },
  context:     { label: 'Context',     color: '#64748b' },
  custom:      { label: 'Custom',      color: '#c084fc' }
}

export const STORAGE_KEY    = 'pathfinder-v1'
export const DEFAULT_WIDTH  = 220
export const MIN_ZOOM       = 0.18
export const MAX_ZOOM       = 2.6

// ── ID generator ─────────────────────────────────────────────
let _sid = 0
export function genId() { return (Date.now().toString(36) + (++_sid).toString(36)) }

// ── Pure helpers ─────────────────────────────────────────────
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

export function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}

export function showToast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg
  document.body.appendChild(el); setTimeout(() => el.remove(), 2500)
}

// ── DOM element cache ────────────────────────────────────────
export const $ = {
  canvasViewport:   () => document.getElementById('canvasViewport'),
  canvasRoot:       () => document.getElementById('canvasRoot'),
  arrowsGroup:      () => document.getElementById('arrowsGroup'),
  arrowsLayer:      () => document.getElementById('arrowsLayer'),
  arrowPreview:     () => document.getElementById('arrowPreview'),
  canvasHint:       () => document.getElementById('canvasHint'),
  inspectorEmpty:   () => document.getElementById('inspectorEmpty'),
  inspectorContent: () => document.getElementById('inspectorContent'),
  inspTitle:        () => document.getElementById('inspTitle'),
  inspDesc:         () => document.getElementById('inspDesc'),
  inspNotes:        () => document.getElementById('inspNotes'),
  questionsList:    () => document.getElementById('questionsList'),
  promptOutput:     () => document.getElementById('promptOutput'),
  promptSummary:    () => document.getElementById('promptSummary'),
  inspectorMulti:   () => document.getElementById('inspectorMulti'),
  inspectorArrow:   () => document.getElementById('inspectorArrow'),
  selectBox:        () => document.getElementById('selectBox'),
  searchOverlay:    () => document.getElementById('searchOverlay'),
  searchInput:      () => document.getElementById('searchInput'),
  searchResults:    () => document.getElementById('searchResults'),
  zoomIndicator:    () => document.getElementById('zoomIndicator'),
  canvasTitle:      () => document.getElementById('canvasTitle'),
  typePicker:       () => document.getElementById('typePicker'),
  shortcutOverlay:  () => document.getElementById('shortcutOverlay'),
  shortcutGrid:     () => document.getElementById('shortcutGrid'),
}

// ── Block element helpers ────────────────────────────────────
export function getBlockEl(id)   { return document.getElementById('b-' + id) }
export function getBlockDims(id) {
  const el = getBlockEl(id)
  return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: DEFAULT_WIDTH, h: 100 }
}
