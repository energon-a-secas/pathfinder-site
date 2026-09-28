// ════════════════════════════════════════════════════════════
//  arrow-labels.js: where each connection's label goes.
//
//  Measured with a canvas text measure (no layout pass), placed on
//  the longest straight run, then nudged off cards, other labels
//  and other lines. The canvas and the image export share it.
// ════════════════════════════════════════════════════════════

import { state } from './state.js'
import { getBlockDims } from './utils.js'
import { connectionLabel } from './relations.js'
import { labelAnchor, segmentCrossesRect } from './route.js'
import { arrowRoute, arrowPolyline, curveAnchor } from './arrow-geometry.js'

const LABEL_FONT = '500 11px "Avenir Next", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
export const LABEL_PAD_X = 6
export const LABEL_H = 18

let measureCtx = null
const widthCache = new Map()
/** Rendered width of a label at the pill's font, from a canvas measure. */
export function labelTextWidth(text) {
  if (widthCache.has(text)) return widthCache.get(text)
  let w = NaN
  try {
    measureCtx = measureCtx || document.createElement('canvas').getContext('2d')
    measureCtx.font = LABEL_FONT
    w = measureCtx.measureText(text).width
  } catch (_) {}
  if (!Number.isFinite(w) || w <= 0) w = text.length * 6.2
  w = Math.ceil(w)
  if (widthCache.size > 500) widthCache.clear()
  widthCache.set(text, w)
  return w
}

const overlaps = (r, list) => list.some(b =>
  r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h)

// Straight runs other than the one labelAnchor picked, longest first. A run
// shorter than two corners cannot hold a label clear of its bends.
function otherRuns(poly, primary) {
  const runs = []
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 34) continue
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2
    if (Math.abs(x - primary.x) < 1 && Math.abs(y - primary.y) < 1) continue
    runs.push({ x, y, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, len })
  }
  return runs.sort((p, q) => q.len - p.len).slice(0, 4)
}

function nearestOn(poly, x, y) {
  let best = null, bestD = Infinity
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i]
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0
    const px = a.x + dx * t, py = a.y + dy * t, d = (px - x) ** 2 + (py - y) ** 2
    if (d < bestD) { bestD = d; best = { x: px, y: py } }
  }
  return best
}

// A short tick from the label to its own line, for a label that had to
// step off it: without one, a label between two lines belongs to either.
function leaderFor(poly, r) {
  if (poly.length < 2) return null
  const p = nearestOn(poly, r.x + r.w / 2, r.y + r.h / 2)
  if (!p) return null
  if (p.x >= r.x - 1 && p.x <= r.x + r.w + 1 && p.y >= r.y - 1 && p.y <= r.y + r.h + 1) return null
  const qx = Math.max(r.x, Math.min(r.x + r.w, p.x)), qy = Math.max(r.y, Math.min(r.y + r.h, p.y))
  if (Math.hypot(p.x - qx, p.y - qy) < 3) return null
  return { x1: Math.round(p.x), y1: Math.round(p.y), x2: Math.round(qx), y2: Math.round(qy) }
}

/**
 * Where each connection's label goes. It starts at the middle of the
 * longest straight run (never on a corner) and slides along it; then along
 * the other straight runs, longest first; only then does it step off to
 * either side. The first spot that overlaps no card, no label placed
 * before it and no other connection's line wins. When none does, a spot
 * clear of cards and labels, then one clear of cards, then the anchor.
 * A label that ends up off its own line gets a leader back to it.
 * Returns aid -> { x, y (centre), w, h, text, ux, uy, leader }. Arrows
 * without a label still get their anchor, for the note and the editor.
 */
export function placeLabels(routes) {
  const blocks = []
  for (const id in state.blocks) {
    const b = state.blocks[id], { w, h } = getBlockDims(id)
    blocks.push({ x: b.x - 3, y: b.y - 3, w: w + 6, h: h + 6 })
  }
  // Every drawn run, for keeping a label off lines that are not its own.
  const polys = new Map()
  const segs = []
  state.arrows.forEach(a => {
    const pts = routes.get(a.id); if (!pts) return
    const poly = arrowPolyline(pts, arrowRoute(a))
    polys.set(a.id, poly)
    for (let i = 1; i < poly.length; i++) {
      const p = poly[i - 1], q = poly[i]
      segs.push({ aid: a.id, p, q, l: Math.min(p.x, q.x), r: Math.max(p.x, q.x), t: Math.min(p.y, q.y), b: Math.max(p.y, q.y) })
    }
  })
  const labelled = state.arrows.filter(a => connectionLabel(a)).length
  const avoidLines = segs.length * labelled <= 150000   // a budget, for huge canvases
  const clearOfLines = (r, aid) => !segs.some(s => s.aid !== aid &&
    s.r > r.x && s.l < r.x + r.w && s.b > r.y && s.t < r.y + r.h && segmentCrossesRect(r, s.p, s.q))
  const placed = [], placedExact = []
  const out = new Map()
  state.arrows.forEach(a => {
    const pts = routes.get(a.id); if (!pts) return
    const style = arrowRoute(a)
    const poly = polys.get(a.id)
    const anc = style === 'curved' ? curveAnchor(pts) : labelAnchor(poly)
    const text = connectionLabel(a)
    if (!text) { out.set(a.id, { x: Math.round(anc.x), y: Math.round(anc.y), w: 0, h: 0, text: '', ux: anc.ux, uy: anc.uy, leader: null }); return }
    const w = labelTextWidth(text) + LABEL_PAD_X * 2, h = LABEL_H
    const box = (cx, cy) => ({ x: cx - w / 2, y: cy - h / 2, w, h })
    const runs = [anc, ...(style === 'curved' ? [] : otherRuns(poly, anc))]
    let tries = []
    const slide = (run, perp, full = false) => {
      const px = -run.uy, py = run.ux
      const reach = Math.max(16, (run.len || 0) / 2 - (full ? 0 : w / 4))
      const at = (along, off) => tries.push([Math.round(run.x + run.ux * along + px * off),
                                             Math.round(run.y + run.uy * along + py * off)])
      at(0, perp)
      for (let d = perp ? 20 : 16; d <= reach; d += perp ? 24 : 16) { at(d, perp); at(-d, perp) }
    }
    // Tiers, best first: clear of everything; clear of cards and labels;
    // clear of cards and touching a label's margin but not the label.
    let spot = null, clear = null, snug = null, offCards = null
    const search = () => {
      for (const [cx, cy] of tries) {
        const r = box(cx, cy)
        if (overlaps(r, blocks)) continue
        if (!offCards) offCards = { x: cx, y: cy }
        if (overlaps(r, placed)) {
          if (!snug && !overlaps(r, placedExact)) snug = { x: cx, y: cy }
          continue
        }
        if (!avoidLines || clearOfLines(r, a.id)) { spot = { x: cx, y: cy }; return }
        if (!clear) clear = { x: cx, y: cy }
      }
    }
    // On a line first, every run; then beside it, the longest run first.
    runs.forEach(run => slide(run, 0))
    for (const off of [16, -16, 28, -28, 40, -40]) runs.forEach(run => slide(run, off))
    search()
    // Boxed in by cards or labels: look wider before settling for a label
    // over another label or over a card (cards paint over lines, so a label
    // there is half hidden).
    if (!spot && !clear && !snug) {
      tries = []
      runs.forEach(run => slide(run, 0, true))
      for (const off of [52, -52, 64, -64, 80, -80]) runs.forEach(run => slide(run, off, true))
      search()
    }
    spot = spot || clear || snug || offCards || { x: Math.round(anc.x), y: Math.round(anc.y) }
    const r = box(spot.x, spot.y)
    placed.push({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 })
    placedExact.push(r)
    out.set(a.id, { x: spot.x, y: spot.y, w, h, text, ux: anc.ux, uy: anc.uy, leader: leaderFor(poly, r) })
  })
  return out
}
