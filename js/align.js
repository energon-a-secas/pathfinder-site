// ════════════════════════════════════════════════════════════
//  align.js — Alignment aids.
//
//  Two halves. `findGuides` is pure geometry: given what is being
//  dragged and what is standing still, it reports the nudge that
//  lines them up plus the guide lines to draw. `alignSelection`
//  and `distributeSelection` are the deliberate version for a
//  multi-selection.
//
//  Tidy re-lays the whole canvas; this is for the last 6 pixels.
// ════════════════════════════════════════════════════════════

import { state, snapshot, debouncedSave } from './state.js'
import { $, getBlockDims } from './utils.js'

export const SNAP_TOLERANCE = 6

function boxOf(id) {
  const b = state.blocks[id]; if (!b) return null
  const { w, h } = getBlockDims(id)
  return { id, l: b.x, t: b.y, r: b.x + w, b: b.y + h, cx: b.x + w / 2, cy: b.y + h / 2, w, h }
}

/**
 * Find the alignment snap for a moving box against a set of static ones.
 *
 * Checks the three interesting positions on each axis (both edges and the
 * centre) against the same three on every candidate, and takes the closest
 * match inside the tolerance. Returns the correction to apply and the world
 * coordinates of the lines worth drawing.
 *
 * @returns {{dx:number, dy:number, vx:number[], hy:number[]}}
 */
export function findGuides(moving, statics, tol = SNAP_TOLERANCE) {
  let bestX = null, bestY = null
  const vx = [], hy = []

  for (const s of statics) {
    for (const [mv, sv] of [[moving.l, s.l], [moving.l, s.r], [moving.r, s.l], [moving.r, s.r], [moving.cx, s.cx]]) {
      const d = sv - mv
      if (Math.abs(d) <= tol && (bestX === null || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: sv }
    }
    for (const [mv, sv] of [[moving.t, s.t], [moving.t, s.b], [moving.b, s.t], [moving.b, s.b], [moving.cy, s.cy]]) {
      const d = sv - mv
      if (Math.abs(d) <= tol && (bestY === null || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: sv }
    }
  }

  if (bestX) vx.push(bestX.at)
  if (bestY) hy.push(bestY.at)
  return { dx: bestX ? bestX.d : 0, dy: bestY ? bestY.d : 0, vx, hy }
}

/** Compute the snap for the current drag, given the ids being moved. */
export function guidesForDrag(movingIds) {
  const moving = movingIds.map(boxOf).filter(Boolean)
  if (!moving.length) return { dx: 0, dy: 0, vx: [], hy: [] }
  const hull = {
    l: Math.min(...moving.map(m => m.l)), r: Math.max(...moving.map(m => m.r)),
    t: Math.min(...moving.map(m => m.t)), b: Math.max(...moving.map(m => m.b)),
  }
  hull.cx = (hull.l + hull.r) / 2
  hull.cy = (hull.t + hull.b) / 2
  const skip = new Set(movingIds)
  const statics = Object.keys(state.blocks).filter(id => !skip.has(id)).map(boxOf).filter(Boolean)
  return findGuides(hull, statics)
}

// ── Drawing ──────────────────────────────────────────────────

export function drawGuides({ vx = [], hy = [] }) {
  const layer = document.getElementById('guidesLayer'); if (!layer) return
  layer.innerHTML =
    vx.map(x => `<div class="align-guide v" style="left:${x}px"></div>`).join('') +
    hy.map(y => `<div class="align-guide h" style="top:${y}px"></div>`).join('')
}

export function clearGuides() {
  const layer = document.getElementById('guidesLayer')
  if (layer) layer.innerHTML = ''
}

// ── Align and distribute ─────────────────────────────────────

const ALIGNERS = {
  left:    (b, hull) => ({ x: hull.l }),
  hcenter: (b, hull) => ({ x: (hull.l + hull.r) / 2 - b.w / 2 }),
  right:   (b, hull) => ({ x: hull.r - b.w }),
  top:     (b, hull) => ({ y: hull.t }),
  vcenter: (b, hull) => ({ y: (hull.t + hull.b) / 2 - b.h / 2 }),
  bottom:  (b, hull) => ({ y: hull.b - b.h }),
}

/** Align every selected block to the selection's own bounding box. */
export function alignSelection(ids, mode) {
  const fn = ALIGNERS[mode]
  const boxes = ids.map(boxOf).filter(Boolean)
  if (!fn || boxes.length < 2) return 0
  const hull = {
    l: Math.min(...boxes.map(b => b.l)), r: Math.max(...boxes.map(b => b.r)),
    t: Math.min(...boxes.map(b => b.t)), b: Math.max(...boxes.map(b => b.b)),
  }
  snapshot()
  boxes.forEach(box => {
    const p = fn(box, hull)
    const blk = state.blocks[box.id]
    if (p.x != null) blk.x = Math.round(p.x)
    if (p.y != null) blk.y = Math.round(p.y)
  })
  debouncedSave()
  return boxes.length
}

/**
 * Space the selection evenly between its outermost two blocks. Gaps are
 * equalised rather than centres, so blocks of different heights end up with
 * the same amount of air between them.
 */
export function distributeSelection(ids, axis) {
  const boxes = ids.map(boxOf).filter(Boolean)
  if (boxes.length < 3) return 0
  const horiz = axis === 'h'
  boxes.sort((a, b) => (horiz ? a.l - b.l : a.t - b.t))
  const first = boxes[0], last = boxes[boxes.length - 1]
  const span = horiz ? (last.l - first.l) : (last.t - first.t)
  const sizes = boxes.slice(1, -1).reduce((n, b) => n + (horiz ? b.w : b.h), 0)
  const gap = (span - sizes - (horiz ? first.w : first.h)) / (boxes.length - 1)

  snapshot()
  let cursor = (horiz ? first.r : first.b) + gap
  boxes.slice(1, -1).forEach(box => {
    const blk = state.blocks[box.id]
    if (horiz) { blk.x = Math.round(cursor); cursor += box.w + gap }
    else       { blk.y = Math.round(cursor); cursor += box.h + gap }
  })
  debouncedSave()
  return boxes.length
}
