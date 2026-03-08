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

export const ACTION_DEFS = {
  resolve:   'Take action to fix or close this item',
  prepare:   'Gather resources or context before proceeding',
  recollect: 'Review past decisions or context relevant here',
  reinforce: 'Strengthen or validate the current approach',
}

export const STATUS_DEFS = {
  'not-started': { label: 'Not Started', icon: '\u25CB' },
  'in-progress': { label: 'In Progress', icon: '\u25D4' },
  'done':        { label: 'Done',        icon: '\u25CF' },
  'blocked':     { label: 'Blocked',     icon: '\u25A0' },
}

export const PRIORITY_DEFS = {
  high:   { label: 'High',   color: '#f87171' },
  medium: { label: 'Medium', color: '#fbbf24' },
  low:    { label: 'Low',    color: '#94a3b8' },
}

export const ARROW_LABEL_PRESETS = [
  'depends on', 'blocks', 'enables', 'mitigates',
  'validates', 'conflicts with', 'informs', 'requires',
]

export const TYPE_EXPLANATIONS = {
  goal:        'A strategic objective you want to achieve. Examples: "Increase conversion by 15%", "Launch MVP by Q3". Connect to Requirements that must be met.',
  problem:     'A blocker, issue, or pain point that needs resolution. Examples: "API latency exceeds SLA", "No CI/CD pipeline". Mark "Resolve" when actioned.',
  requirement: 'A hard constraint that must be satisfied for a Goal to succeed. Examples: "GDPR compliance", "Response time under 200ms". Link to the Goal it serves.',
  risk:        'Something that could go wrong and derail the plan. Examples: "Key engineer leaving", "Vendor contract expires". Connect to a Decision that mitigates it.',
  question:    'An unknown or assumption that needs validation before proceeding. Examples: "Will users accept SSO-only auth?", "Is the budget approved?". Link to the Goal or Requirement it affects.',
  decision:    'A choice that has already been made or needs to be made. Examples: "Use PostgreSQL over MongoDB", "Ship without feature X". Document the rationale in Notes.',
  resource:    'An available asset, tool, team, or budget. Examples: "Design team (3 people)", "AWS credits ($10K)", "Existing auth library". Connect to what it enables.',
  output:      'An expected deliverable or measurable result. Examples: "API documentation", "Staging environment", "User research report". Connect from the Resources and Requirements that produce it.',
  context:     'Background information that frames the project. Examples: "Company is migrating to cloud", "Competitor launched similar feature last month". Helps AI understand constraints.',
  custom:      'A free-form block for anything that doesn\'t fit the other types. Use sparingly — the structured types produce better AI prompts.',
}

export const SWATCH_COLORS = [
  '#a78bfa', '#f87171', '#fbbf24', '#fb923c',
  '#38bdf8', '#34d399', '#2dd4bf', '#818cf8',
  '#f472b6', '#c084fc', '#94a3b8', '#ffffff',
]
export const SWATCH_NAMES = {
  '#a78bfa': 'Violet', '#f87171': 'Red', '#fbbf24': 'Amber', '#fb923c': 'Orange',
  '#38bdf8': 'Sky', '#34d399': 'Emerald', '#2dd4bf': 'Teal', '#818cf8': 'Indigo',
  '#f472b6': 'Pink', '#c084fc': 'Purple', '#94a3b8': 'Slate', '#ffffff': 'White',
}

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
  const live = document.getElementById('toastLive')
  if (live) { live.textContent = ''; requestAnimationFrame(() => { live.textContent = msg }) }
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
  framesLayer:      () => document.getElementById('framesLayer'),
  colorSwatches:    () => document.getElementById('colorSwatches'),
  inspectorFrame:   () => document.getElementById('inspectorFrame'),
  frameLabelInput:  () => document.getElementById('frameLabelInput'),
  templatesList:      () => document.getElementById('templatesList'),
  arrowColorSwatches: () => document.getElementById('arrowColorSwatches'),
}

// ── Block element helpers ────────────────────────────────────
export function getBlockEl(id)   { return document.getElementById('b-' + id) }
export function getBlockDims(id) {
  const el = getBlockEl(id)
  return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: DEFAULT_WIDTH, h: 100 }
}
