// ════════════════════════════════════════════════════════════
//  cards.js: what a card shows besides its text. The light-theme
//  accent for a custom colour, the type dot's shape, the chip
//  icons and the highlight tab. The gap icon slot (gi-<id>) is not
//  painted here: gaps.js owns it, because runGapDetection is what
//  knows the gap, and two writers of one slot gave a card two names
//  for the same gap.
//  No state changes happen here: this module only paints.
// ════════════════════════════════════════════════════════════

import { TYPES, HIGHLIGHTS } from './utils.js'

// ── Custom colours in the light theme ───────────────────────
// A block colour is stored as the dark-theme hex. On a near-white card a
// colour that reads on the dark canvas fails as an edge or a dot, so the
// light theme swaps in a darker twin. Type colours carry theirs in the
// registry (current and legacy); these are the swatches, today's and the
// four pre-2026-10 ones that were not a type colour. No data changes: only
// paint.
const SWATCH_LIGHT = {
  '#da534f': '#b63132', '#cc6526': '#ad5010', '#699630': '#4f7715', '#269e5f': '#0b7643',
  '#0e9a94': '#047270', '#1794b5': '#026e8c', '#3986e4': '#1d60bc', '#ad63c4': '#8a3d9a',
  '#cd509f': '#a32c74', '#db6686': '#b63c62', '#78889b': '#475366', '#9d846d': '#765e49',
  // Pre-2026-10 swatches that were not a type colour.
  '#f472b6': '#db2777', '#c084fc': '#9333ea', '#94a3b8': '#64748b', '#ffffff': '#475569',
}

/** The light-theme twin of a stored block colour, or null when it has none. */
export function lightAccentFor(hex) {
  if (typeof hex !== 'string') return null
  const h = hex.trim().toLowerCase()
  for (const t of Object.values(TYPES)) {
    if (t.color.toLowerCase() === h) return t.light
    // legacyColors holds dark, light pairs: an old dark hex has its old twin.
    const old = t.legacyColors || []
    for (let i = 0; i + 1 < old.length; i += 2) if (old[i].toLowerCase() === h) return old[i + 1]
  }
  return SWATCH_LIGHT[h] || null
}

// ── The type dot's shape ────────────────────────────────────
/** The dot shape for a type id ('dot', 'ring', 'square', 'diamond'). */
export function typeShape(type) {
  return TYPES[type]?.shape || 'dot'
}

// ── Chip icons ──────────────────────────────────────────────
// Priority, status and action chips are neutral (surface-2, text-2): what
// tells them apart is a stroked 16px icon and a word, never a colour. Red and
// amber already mean a type and a gap.
const icon = body =>
  '<svg class="chip-icon" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>'

// Signal bars: the level is how many are drawn at full strength.
const bars = n => icon(
  `<path d="M3.5 12.5V10"${n < 1 ? ' opacity=".3"' : ''}/>` +
  `<path d="M8 12.5V6.75"${n < 2 ? ' opacity=".3"' : ''}/>` +
  `<path d="M12.5 12.5v-9"${n < 3 ? ' opacity=".3"' : ''}/>`)

const CHIP_ICONS = {
  priority: { high: bars(3), medium: bars(2), low: bars(1) },
  status: {
    'not-started': icon('<circle cx="8" cy="8" r="5.25"/>'),
    'in-progress': icon('<circle cx="8" cy="8" r="5.25"/><path d="M8 2.75a5.25 5.25 0 0 1 0 10.5z" fill="currentColor" stroke="none"/>'),
    done:          icon('<circle cx="8" cy="8" r="5.25"/><path d="M5.6 8.2l1.7 1.7 3.1-3.4"/>'),
    blocked:       icon('<circle cx="8" cy="8" r="5.25"/><path d="M4.3 11.7l7.4-7.4"/>'),
  },
  action: {
    // A wrench: someone is fixing it.
    resolve:   icon('<path d="M3 13l5-5"/><path d="M8 8a3.25 3.25 0 0 1 4.3-4.3L10.5 5.5l.25 1.25 1.25.25 1.8-1.8A3.25 3.25 0 0 1 9.5 9.5"/>'),
    // A shield: ready for it before it happens.
    prepare:   icon('<path d="M8 2.25l4.75 1.9v3.6c0 2.9-2 5.2-4.75 6-2.75-.8-4.75-3.1-4.75-6v-3.6z"/>'),
    // A clock turning back: look at what was decided before.
    recollect: icon('<path d="M2.75 8a5.25 5.25 0 1 0 1.55-3.7"/><path d="M2.75 2.75v2.5h2.5"/><path d="M8 5.5V8l1.75 1.1"/>'),
    // Two chevrons up: make it stronger.
    reinforce: icon('<path d="M4.5 8.25L8 4.75l3.5 3.5"/><path d="M4.5 12L8 8.5l3.5 3.5"/>'),
    // A magnifier: check it before relying on it.
    validate:  icon('<circle cx="7" cy="7" r="4.25"/><path d="M10.2 10.2l3.3 3.3"/>'),
  },
}

/** The 11px stroked icon for a chip: kind is 'priority', 'status' or 'action'. */
export function chipIcon(kind, key) {
  return CHIP_ICONS[kind]?.[key] || ''
}

// ── Highlight tab ───────────────────────────────────────────
// The ring alone says "look here" in colour only. A word on it keeps the
// meaning for anyone who cannot tell red from amber. Festive is a pattern,
// not a colour, so it needs no word.
const TABBED_HIGHLIGHTS = ['alert', 'focus', 'go', 'hold']

export function highlightTabLabel(key) {
  return TABBED_HIGHLIGHTS.includes(key) ? (HIGHLIGHTS[key]?.label || '') : ''
}
