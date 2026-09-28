// ════════════════════════════════════════════════════════════
//  cards.js: what a card shows besides its text. The light-theme
//  accent for a custom colour and the highlight tab. The gap icon
//  slot (gi-<id>) is not painted here: gaps.js owns it, because
//  runGapDetection is what knows the gap, and two writers of one
//  slot gave a card two names for the same gap.
//  No state changes happen here: this module only paints.
// ════════════════════════════════════════════════════════════

import { TYPES, HIGHLIGHTS } from './utils.js'

// ── Custom colours in the light theme ───────────────────────
// A block colour is stored as the dark-theme hex. On a white card most of
// them fail as an edge or a dot (#fbbf24 is 1.7:1), so the light theme swaps
// in a darker twin. Type colours already have one in the registry; these are
// the swatches that are not a type colour. No data changes: only paint.
const SWATCH_LIGHT = {
  '#f472b6': '#db2777',
  '#c084fc': '#9333ea',
  '#94a3b8': '#64748b',
  '#ffffff': '#475569',
}

/** The light-theme twin of a stored block colour, or null when it has none. */
export function lightAccentFor(hex) {
  if (typeof hex !== 'string') return null
  const h = hex.trim().toLowerCase()
  for (const t of Object.values(TYPES)) {
    if (t.color.toLowerCase() === h) return t.light
  }
  return SWATCH_LIGHT[h] || null
}

// ── Highlight tab ───────────────────────────────────────────
// The ring alone says "look here" in colour only. A word on it keeps the
// meaning for anyone who cannot tell red from amber. Festive is a pattern,
// not a colour, so it needs no word.
const TABBED_HIGHLIGHTS = ['alert', 'focus', 'go', 'hold']

export function highlightTabLabel(key) {
  return TABBED_HIGHLIGHTS.includes(key) ? (HIGHLIGHTS[key]?.label || '') : ''
}
