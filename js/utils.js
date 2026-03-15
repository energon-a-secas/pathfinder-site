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

// ── Voting system (client-side, URL-hash based) ────────────
const VOTE_HASH_KEY = 'votes'
const MY_VOTES_KEY = 'my-votes'
const MAX_DOTS_PER_USER = 5

// ── SVG Icons ────────────────────────────────────────────────
export const SVG_ICONS = {
  vote: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2v2h2.41l3.3 8.36-1.23 2.25c-.16.33-.25.71-.25 1.11 0 1.21.98 2.19 2.19 2.19h7.5v-2h-7.5c-.41 0-.75-.34-.75-.75 0-.13.03-.25.09-.36l1.23-2.25L16.5 6.5h5.25v12h2V4.5c0-.83-.67-1.5-1.5-1.5H7zm9 18c0 .55-.45 1-1 1h-2v-2h2c.55 0 1 .45 1 1zm-7-4c0 .55-.45 1-1 1H6v-2h2c.55 0 1 .45 1 1z"/></svg>`,
  timer: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 1H9v2h6V1zm-4 12h2V7h-2v6zm8-5h1v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V7h1V5c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2v2z"/></svg>`,
  decision: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>`,
  action: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>`,
  question: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm3.9 13.5-4.6-2.7c-.2-.2-.3-.5-.3-.8V7h2v3.9l4 2.4-1.1 2.2z"/></svg>`,
  users: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45v2h6v-2c0-2.66-5.33-4-8-4z"/></svg>`,
  priority: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L5.49 17.5 3.5 15.5z"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>`,
  link: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>`,
  people: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
  bullet: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>`,
  number: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 17H7v-2h7v2zm0-4H7v-2h7v2zm0-4H7V7h7v2zm4 8h-2V7h-2V5h4v12z"/></svg>`,
  archive: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/></svg>`,
  paperclip: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 4.5H8.49c-1.65 0-3.18.82-4.1 2.18C3.48 8.13 3 9.61 3 11.14c0 2.6 1.4 4.85 3.51 6.29 1.66 1.16 3.67 1.85 5.82 1.85h8.95c2.94 0 5.33-2.39 5.33-5.33 0-2.94-2.39-5.33-5.33-5.33h-7.5c-1.17 0-2.12-.95-2.12-2.12s.95-2.12 2.12-2.12h7.5c5.25 0 9.5 4.25 9.5 9.5s-4.25 9.5-9.5 9.5H12.02c-3.52 0-6.77-1.52-9.02-3.95C1.8 18.85.5 16.5.5 14.04c0-3.4 1.2-6.5 3.18-8.52C5.66 3.01 8.75 1.5 12.02 1.5h7.5c1.38 0 2.5 1.12 2.5 2.5s-1.12 2.5-2.5 2.5h-7.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5h7.5c2.75 0 5 2.25 5 5s-2.25 5-5 5H11.52c-1.47 0-2.88-.55-3.92-1.49-1.03-.94-1.6-2.22-1.6-3.61 0-2.76 2.24-5 5-5h8Z"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 17.27-5.76 3.34 1.56-6.63L3.5 10.49l6.88-.59L12 4.2l1.62 5.7 6.88.59-3.3 3.49 1.56 6.63L12 17.27z"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3.75-1.45-1.32C8.23 1.68 5.5 2.94 5.5 6.06c0 1.94.99 3.12 2.22 4.23 1.02.93 5.54 4.79 4.28 6.39C12.06 17.4 15 15.55 15 12c0-1.76-.86-2.95-1.82-4.03C12.09 6.68 13 5.38 13 4.5c0-1.21-.8-1.72-1.55-1.5-.47.13-.94.6-1.01.95H10.5c-.07-.35-.54-.82-1.01-.95-.75-.22-1.55.29-1.55 1.5 0 .88.91 2.18 1.82 3.47C9.86 9.05 9 10.24 9 12c0 3.55 2.94 5.4 4.5 4.51-1.26-1.6 3.26-5.46 4.28-6.39C17.01 9.18 18 8 18 6.06c0-3.12-2.73-4.38-5.05-1.63L12 3.75z"/></svg>`,
  fire: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 5.5S14 7 14 8.5 13.5 11 12.5 12s-2 1-2 3 1 3 3 3 3-1 3-3c0-1.63-1.13-2.66-2.04-3.91C14.44 7.72 13.5 5.5 13.5 5.5zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.84 0 3.56-.5 5.03-1.36C14.54 23.5 11.82 23 12 23c5.52 0 10-4.48 10-10S17.52 2 12 2z"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="m11 21-1-7H4l6-9h1l1 7h6l-6 9z"/></svg>`,
  target: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/></svg>`,
  robot: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 2H9c-1.1 0-2 .9-2 2v2H3c-.55 0-1 .45-1 1s.45 1 1 1h4v6H3c-.55 0-1 .45-1 1s.45 1 1 1h4v4c0 1.1.9 2 2 2h2v1c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-1h2c1.1 0 2-.9 2-2v-4h4c.55 0 1-.45 1-1s-.45-1-1-1h-4V8h4c.55 0 1-.45 1-1s-.45-1-1-1h-4V4c0-1.1-.9-2-2-2h-2V1h-2v1h-2zM9 20v-4h6v4H9zm8-18h2v2h-2V2zM9 6h2v2H9V6z"/></svg>`,
  alien: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93 0-.84.13-1.65.35-2.42L6.3 9.3l3.18 1.94.58-3.22 3.23.58 1.95-3.17 1.42 1.42c.55.86.91 1.86.91 2.93 0 2.08-1.03 3.92-2.61 5.05L11 19.93z"/></svg>`,
  cake: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 6c1.11 0 2-.89 2-2 0-.8-.47-1.48-1.15-1.81C12.2 1.85 12.38 1.5 12.38 1.5s.16-.35.53-.69C13.59.48 14.31 0 15.11 0c1.11 0 2 .89 2 2 0 .26-.05.51-.14.75.25.16.39.39.39.64 0 1.11-.89 2-2 2C15.67 5 15 5.67 15 6.5c0 .26.05.51.14.75-.25.16-.39.39-.39.64 0 1.11.89 2 2 2 .8 0 1.48-.47 1.81-1.15C19.15 8.8 19.5 8.98 19.5 8.98s.35.16.69.53c.35.35.53.69.53.69s.18-.35.53-.69c.34-.37.69-.53.69-.53s.35.18.69.53c.35.35.53.69.53.69s.18-.35.53-.69c.34-.37.69-.53.69-.53s.35.18.69.53c.35.35.53.69.53.69s.18-.35.53-.69c.34-.37.69-.53.69-.53M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 10c-3.87 0-9.72-.94-11-4.5C2.28 9.94 8.13 9 12 9s9.72.94 11 4.5c-1.28 3.56-7.13 4.5-11 4.5z"/></svg>`,
  pizza: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/></svg>`,
  resource: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>`,
  coffee: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4v12c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-1h1c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 6h-1V8c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-1h1v3z"/></svg>`,
  beer: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6h-2V4c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v2H3c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-7 0H8V4h4v2zM3 8h16v2l-1.5 9.5L15 14H3V8zm4 4h6v2H7v-2z"/></svg>`,
}

// Get SVG icon by key
export function getSvgIcon(key, className = '', size = 16) {
  const svg = SVG_ICONS[key]
  if (!svg) return `<span style="display:none"></span>`
  return `<span class="svg-icon ${className}" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;">${svg}</span>`
}

// Small inline SVG for decoration
export function getSmallIcon(key) {
  return getSvgIcon(key, '', 14)
}

// Medium inline SVG for headers
export function getMediumIcon(key) {
  return getSvgIcon(key, '', 18)
}

// Large SVG for prominent display
export function getLargeIcon(key) {
  return getSvgIcon(key, '', 24)
}

// Get current URL hash and parse votes
export function getBlockVotes(blockId) {
  const hash = location.hash
  if (!hash || !hash.includes(VOTE_HASH_KEY + '=')) return []

  try {
    const voteStr = hash.split(VOTE_HASH_KEY + '=')[1].split('&')[0]
    const allVotes = JSON.parse(decodeURIComponent(voteStr))
    return allVotes[blockId] || []
  } catch (e) {
    return []
  }
}

// Get all votes for all blocks
export function getAllVotes() {
  const hash = location.hash
  if (!hash || !hash.includes(VOTE_HASH_KEY + '=')) return {}

  try {
    const voteStr = hash.split(VOTE_HASH_KEY + '=')[1].split('&')[0]
    return JSON.parse(decodeURIComponent(voteStr))
  } catch (e) {
    return {}
  }
}

// Set votes for a block (updates URL hash)
export function setBlockVotes(blockId, votes) {
  const allVotes = getAllVotes()
  if (votes.length === 0) {
    delete allVotes[blockId]
  } else {
    allVotes[blockId] = votes
  }

  const voteStr = encodeURIComponent(JSON.stringify(allVotes))
  const baseUrl = location.pathname + location.search

  // Remove existing vote hash if it exists
  const cleanHash = location.hash.split('&').filter(part => !part.startsWith(VOTE_HASH_KEY + '=')).join('&')
  const prefix = cleanHash ? cleanHash + '&' : '#'

  const newUrl = baseUrl + (Object.keys(allVotes).length > 0 ? prefix + VOTE_HASH_KEY + '=' + voteStr : cleanHash)
  history.replaceState(null, '', newUrl)
}

// Add votes from current user to a block
export function addVotesToBlock(blockId, dots = 1) {
  const myUserId = getOrCreateUserId()
  const existing = getBlockVotes(blockId)
  const myExisting = existing.find(v => v.userId === myUserId)

  // Check if user has dots remaining
  const myTotalUsed = Object.values(getAllVotes()).reduce((sum, votes) => {
    const mine = votes.find(v => v.userId === myUserId)
    return sum + (mine ? mine.dots : 0)
  }, 0)

  if (myTotalUsed + dots > MAX_DOTS_PER_USER) {
    const remaining = MAX_DOTS_PER_USER - myTotalUsed
    showToast(`You only have ${remaining} dots remaining`, 'warning')
    return false
  }

  if (myExisting) {
    myExisting.dots += dots
  } else {
    existing.push({ userId: myUserId, dots, timestamp: Date.now() })
  }

  setBlockVotes(blockId, existing)
  return true
}

// Remove votes from current user for a block
export function removeVotesFromBlock(blockId, dots = 1) {
  const myUserId = getOrCreateUserId()
  const existing = getBlockVotes(blockId)
  const myVote = existing.find(v => v.userId === myUserId)

  if (!myVote) return false

  myVote.dots = Math.max(0, myVote.dots - dots)

  // Remove if zero dots
  const updated = existing.filter(v => v.dots > 0)
  setBlockVotes(blockId, updated)
  return true
}

// Clear all votes (useful for voting phase reset)
export function clearAllVotes() {
  const baseUrl = location.pathname + location.search
  const cleanHash = location.hash.split('&').filter(part => !part.startsWith(VOTE_HASH_KEY + '=')).join('&')
  history.replaceState(null, '', baseUrl + cleanHash)
  return true
}

// Get or create user ID for voting (stored in localStorage)
function getOrCreateUserId() {
  try {
    let user = JSON.parse(localStorage.getItem('pathfinder-user') || '{}')
    if (!user.userId) {
      user = { userId: 'user-' + Math.random().toString(36).slice(2, 11), createdAt: Date.now() }
      localStorage.setItem('pathfinder-user', JSON.stringify(user))
    }
    return user.userId
  } catch (e) {
    return 'anonymous-' + Math.random().toString(36).slice(2, 11)
  }
}

// Simple toast notification
let toastTimeout
export function showToast(message, type = 'info', duration = 3000) {
  const existing = document.querySelector('.toast-notification')
  if (existing) existing.remove()

  const toast = document.createElement('div')
  toast.className = `toast-notification toast-${type}`
  toast.textContent = message
  document.body.appendChild(toast)

  if (toastTimeout) clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => {
    toast.classList.add('toast-exiting')
    setTimeout(() => toast.remove(), 300)
  }, duration)
}

