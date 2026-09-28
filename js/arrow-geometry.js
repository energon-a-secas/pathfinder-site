// ════════════════════════════════════════════════════════════
//  arrow-geometry.js: the shape of a connection, as data.
//
//  Pure: no DOM, no app state. Given resolved endpoints (and a
//  routed polyline when there is one) it answers what the line
//  looks like: its path string, its polyline, its midpoint, how
//  big its head is. canvas.js and image-export.js both draw from
//  these, so the screen and an exported file cannot disagree.
// ════════════════════════════════════════════════════════════

import { clamp } from './utils.js'
import { polyToPath, polyMidpoint, ROUTE_DEFAULTS } from './route.js'

export const isHoriz = side => side === 'left' || side === 'right'

// ── Arrowheads ───────────────────────────────────────────────
// Heads are sized in world units (markerUnits=userSpaceOnUse), not in
// multiples of the stroke: a Bold line used to grow a 50px head. The length
// follows the weight gently and is capped. The shape is a filled "stealth"
// head, and the fill is a theme token (or the arrow's own colour), so a line
// and its head always match, in both themes, and fade together.
export const HEAD_GAP = 2   // the tip stops this far short of the card

export function headLength(weight) {
  const w = Number(weight) || 1.5
  return clamp(Math.round((6 + 2.5 * w) * 2) / 2, 8, 16)
}

// How far a headed end of the visible line is pulled back: the gap, plus
// enough to tuck the line's butt inside the head so the tip stays sharp.
export function headTrim(weight) { return HEAD_GAP + headLength(weight) * 0.4 }

export const HEAD_POINTS = '0,0 10,5 0,10 2.5,5'

// A colour as an id fragment. Separators are encoded rather than dropped,
// so rgb(1,23,4) and rgb(12,3,4) do not share a head.
export function colorKey(color) {
  return String(color).replace(/[^0-9a-zA-Z]/g, c => '_' + c.charCodeAt(0).toString(16))
}

// ── Arrow route vs pattern ───────────────────────────────────
// `style` is geometry only (routed, curved, straight, elbow) and `pattern` is
// the dash (solid, dashed, dotted). They used to share `style`, so a dashed
// line could not also be routed. normalize.js migrates saved data; these read
// an arrow either way, so an unnormalized legacy object still draws right.
export const ARROW_ROUTES = ['routed', 'curved', 'straight', 'elbow']
export const ARROW_PATTERN_VALUES = ['solid', 'dashed', 'dotted']
const LEGACY_PATTERN_STYLES = ['dashed', 'dotted']

export function arrowRoute(a) {
  const s = a?.style
  if (ARROW_ROUTES.includes(s)) return s
  return 'curved'
}

export function arrowPattern(a) {
  if (ARROW_PATTERN_VALUES.includes(a?.pattern)) return a.pattern
  if (LEGACY_PATTERN_STYLES.includes(a?.style)) return a.style
  return 'solid'
}

// Saved arrows without a weight drew at 2 before the default became 1.5,
// so they keep 2 rather than thinning on the next load.
export function arrowWeight(a) {
  const w = Number(a?.weight)
  return Number.isFinite(w) && w > 0 ? w : 2
}

// Dash lengths in user units, stretched a little for heavy lines so a thick
// dotted line does not turn into a solid one. '' means solid.
const DASHES = { dashed: [8, 6], dotted: [2, 5] }
export function dashArrayFor(pattern, weight = 2) {
  const d = DASHES[pattern]
  if (!d) return ''
  const k = Math.max(1, (Number(weight) || 2) / 2.5)
  return d.map(n => Math.round(n * k * 10) / 10).join(' ')
}

export function cpOffset(x, y, dir, off) {
  return dir === 'right'  ? { x: x+off, y }
       : dir === 'left'   ? { x: x-off, y }
       : dir === 'bottom' ? { x, y: y+off }
       :                    { x, y: y-off }
}

export function buildPath(x1, y1, d1, x2, y2, d2, style = 'curved') {
  if (style === 'straight') {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }
  if (style === 'elbow') {
    // Both ends matter. Leaving horizontally and arriving vertically needs one
    // bend, not two, and using only d1 sent that case in through the wrong side.
    const h1 = d1 === 'right' || d1 === 'left'
    const h2 = d2 === 'right' || d2 === 'left'
    if (h1 && h2) {
      const mx = (x1 + x2) / 2
      return `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`
    }
    if (!h1 && !h2) {
      const my = (y1 + y2) / 2
      return `M ${x1} ${y1} V ${my} H ${x2} V ${y2}`
    }
    return h1 ? `M ${x1} ${y1} H ${x2} V ${y2}` : `M ${x1} ${y1} V ${y2} H ${x2}`
  }
  const off = curveReach(x1, y1, x2, y2)
  const c1 = cpOffset(x1, y1, d1, off), c2 = cpOffset(x2, y2, d2, off)
  return `M ${x1} ${y1} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${x2} ${y2}`
}

const curveReach = (x1, y1, x2, y2) => clamp(Math.max(Math.abs(x2-x1), Math.abs(y2-y1)) * 0.38, 55, 130)

// The corner points of an elbow, in whole pixels.
function elbowPoints({ x1, y1, d1, x2, y2, d2 }) {
  const h1 = isHoriz(d1), h2 = isHoriz(d2)
  const p1 = { x: x1, y: y1 }, p2 = { x: x2, y: y2 }
  if (h1 && h2) { const mx = Math.round((x1 + x2) / 2); return [p1, { x: mx, y: y1 }, { x: mx, y: y2 }, p2] }
  if (!h1 && !h2) { const my = Math.round((y1 + y2) / 2); return [p1, { x: x1, y: my }, { x: x2, y: my }, p2] }
  return h1 ? [p1, { x: x2, y: y1 }, p2] : [p1, { x: x1, y: y2 }, p2]
}

function curveControls(pts) {
  const off = curveReach(pts.x1, pts.y1, pts.x2, pts.y2)
  return { c1: cpOffset(pts.x1, pts.y1, pts.d1, off), c2: cpOffset(pts.x2, pts.y2, pts.d2, off) }
}

function bezierAt(p0, c1, c2, p3, t) {
  const u = 1 - t
  return {
    x: u*u*u*p0.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*p3.y,
  }
}

/**
 * The drawn shape of a resolved arrow as a polyline: exact for routed,
 * elbow and straight lines, sampled for curves. Label placement, the
 * inline label editor and the Tidy report all measure against this.
 */
export function arrowPolyline(pts, style = 'curved') {
  if (style === 'routed' && pts.points && pts.points.length > 1) return pts.points
  if (style === 'routed' || style === 'elbow') return elbowPoints(pts)
  if (style === 'straight') return [{ x: pts.x1, y: pts.y1 }, { x: pts.x2, y: pts.y2 }]
  const { c1, c2 } = curveControls(pts)
  const p0 = { x: pts.x1, y: pts.y1 }, p3 = { x: pts.x2, y: pts.y2 }
  const out = []
  for (let i = 0; i <= 16; i++) out.push(bezierAt(p0, c1, c2, p3, i / 16))
  return out
}

// Pull the ends of a polyline back along its first and last runs.
function trimPolyline(points, t0, t1) {
  const pts = points.map(p => ({ x: p.x, y: p.y }))
  const pull = (end, next, t) => {
    if (!t) return
    const len = Math.hypot(next.x - end.x, next.y - end.y)
    if (len < 1) return
    const d = Math.min(t, len - 1)
    end.x = Math.round((end.x + (next.x - end.x) * d / len) * 100) / 100
    end.y = Math.round((end.y + (next.y - end.y) * d / len) * 100) / 100
  }
  if (pts.length >= 2) {
    pull(pts[pts.length - 1], pts[pts.length - 2], t1)
    pull(pts[0], pts[1], t0)
  }
  return pts
}

/**
 * Build the SVG path for one resolved arrow. `routed` uses the polyline the
 * router produced; a routed arrow with no polyline (router declined, or a
 * cheap drag pass) draws as an elbow rather than disappearing. `trim` pulls
 * a headed end back so the head, not the line, meets the card.
 */
export function pathFor(pts, style = 'curved', trim = null) {
  const t0 = trim?.start || 0, t1 = trim?.end || 0
  if (style === 'routed' || style === 'elbow') {
    return polyToPath(trimPolyline(arrowPolyline(pts, style), t0, t1), ROUTE_DEFAULTS.corner)
  }
  if (style === 'straight') {
    const [a, b] = trimPolyline([{ x: pts.x1, y: pts.y1 }, { x: pts.x2, y: pts.y2 }], t0, t1)
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  }
  if (!t0 && !t1) return buildPath(pts.x1, pts.y1, pts.d1, pts.x2, pts.y2, pts.d2, 'curved')
  // A curve leaves and arrives along its port's facing, so pulling an end
  // back along that facing keeps the tangent, and the head, pointing true.
  const { c1, c2 } = curveControls(pts)
  const s = cpOffset(pts.x1, pts.y1, pts.d1, t0)
  const e = cpOffset(pts.x2, pts.y2, pts.d2, t1)
  const r = v => Math.round(v * 100) / 100
  return `M ${r(s.x)} ${r(s.y)} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${r(e.x)} ${r(e.y)}`
}

export function arrowMidpoint(pts, style = 'curved') {
  if (style === 'routed' && pts.points && pts.points.length > 1) {
    return polyMidpoint(pts.points)
  }
  if (style === 'straight' || style === 'elbow' || style === 'routed') {
    return { x: (pts.x1 + pts.x2) / 2, y: (pts.y1 + pts.y2) / 2 }
  }
  const { c1, c2 } = curveControls(pts)
  return bezierAt({ x: pts.x1, y: pts.y1 }, c1, c2, { x: pts.x2, y: pts.y2 }, 0.5)
}

/** The halfway point of a curve and its direction there, for its label. */
export function curveAnchor(pts) {
  const { c1, c2 } = curveControls(pts)
  const p0 = { x: pts.x1, y: pts.y1 }, p3 = { x: pts.x2, y: pts.y2 }
  const m = bezierAt(p0, c1, c2, p3, 0.5), n = bezierAt(p0, c1, c2, p3, 0.52)
  const len = Math.hypot(n.x - m.x, n.y - m.y) || 1
  return { x: m.x, y: m.y, ux: (n.x - m.x) / len, uy: (n.y - m.y) / len, len: 60 }
}
