// ════════════════════════════════════════════════════════════
//  connection-words.js: a connection's settings, in one set of words.
//
//  The inspector's pickers, the right-click menu's submenus and the
//  snapshot comparison all name a connection's route, pattern,
//  direction, weight, colour and connection points from here, so a
//  setting reads the same wherever a person meets it ("Normal (2px)",
//  never "2px" in one place and "Normal (2px)" in another).
// ════════════════════════════════════════════════════════════

import { SWATCH_NAMES } from './utils.js'
import { RELATIONS } from './relations.js'
import { arrowRoute, arrowPattern, arrowWeight } from './arrow-geometry.js'

export const ROUTE_NAMES = { routed: 'Routed', curved: 'Curved', straight: 'Straight', elbow: 'Elbow' }
export const PATTERN_NAMES = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' }

// The weights a picker offers, thinnest first.
export const WEIGHT_NAMES = { 1: 'Thin', 1.5: 'Normal', 2.5: 'Thick', 3.5: 'Bold' }
export const WEIGHTS = Object.keys(WEIGHT_NAMES).map(Number)

// A weight from the previous scale (Normal 2, Bold 5) keeps its old name, so
// a connection drawn before the rescale reads "Normal (2px)", not a bare size.
const LEGACY_WEIGHT_NAMES = { 2: 'Normal', 5: 'Bold' }

/** The hint on the extra row a picker adds for a weight it does not offer. */
export const DRAWN_WEIGHT_HINT = 'The weight it was drawn at'

/** One-way or Two-way, the same hyphenation for both. */
export const DIRECTION_NAMES = { one: 'One-way', two: 'Two-way' }

/** The weight a connection draws at: a saved one without a weight drew at 2. */
export const drawnWeight = arrowWeight

/** "Thick", or an older weight by its old name and size: "Normal (2px)". */
export function weightName(w) {
  if (WEIGHT_NAMES[w]) return WEIGHT_NAMES[w]
  return LEGACY_WEIGHT_NAMES[w] ? `${LEGACY_WEIGHT_NAMES[w]} (${w}px)` : `${w}px`
}

/** What a connection means: its relation, or Automatic (read from the label, else the types). */
export function meaningName(a) {
  return a?.relation && RELATIONS[a.relation] ? RELATIONS[a.relation] : 'Automatic'
}

export const directionName = a => a?.bidirectional ? DIRECTION_NAMES.two : DIRECTION_NAMES.one
export const routeName = a => ROUTE_NAMES[arrowRoute(a)] || arrowRoute(a)
export const patternName = a => PATTERN_NAMES[arrowPattern(a)] || arrowPattern(a)
export const colourName = a => a?.color ? (SWATCH_NAMES[a.color] || 'Custom') : 'Default'

/**
 * The connection points as a row value: "Auto" while nobody pinned a side,
 * else "Top → Auto", and who pinned it when it was not a person.
 */
export function portsValue(a) {
  if (!a?.fromPort && !a?.toPort) return 'Auto'
  const side = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Auto'
  const by = { tidy: ', set by Tidy', import: ', from the imported file' }[a.portsBy] || ''
  return `${side(a.fromPort)} → ${side(a.toPort)}${by}`
}

/**
 * Every setting as [name, value] rows, in the inspector's order and words:
 * what a snapshot comparison prints for a connection before and after.
 */
export function connectionSettings(a) {
  return [
    ['Meaning', meaningName(a)],
    ['Route', routeName(a)],
    ['Pattern', patternName(a)],
    ['Direction', directionName(a)],
    ['Weight', weightName(drawnWeight(a))],
    ['Colour', colourName(a)],
    ['Connection points', portsValue(a)],
  ]
}
