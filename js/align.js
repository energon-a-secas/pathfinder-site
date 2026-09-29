// ════════════════════════════════════════════════════════════
//  align.js: alignment aids.
//
//  Two halves. `findGuides` is pure geometry: given what is being
//  dragged and what is standing still, it reports the nudge that
//  lines them up plus the guide lines to draw. `alignSelection`
//  and `distributeSelection` are the deliberate version for a
//  multi-selection, and `arrangeSelection` is the one entry point
//  the inspector and the context menu share for them.
//
//  Tidy re-lays the whole canvas; this is for the last 6 pixels.
// ════════════════════════════════════════════════════════════

import { state, snapshot, debouncedSave } from './state.js'
import { $, getBlockDims, showToast } from './utils.js'
import { renderArrows, renderFrames } from './canvas.js'
import { renderBlock } from './render.js'
import { runGapDetection } from './gaps.js'

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

// Each planner returns the positions it would give each block, or null when
// the selection is too small for it. Nothing moves until a plan is applied.

/** Where aligning to the selection's own bounding box would put each block. */
export function planAlign(ids, mode) {
  const fn = ALIGNERS[mode]
  const boxes = ids.map(boxOf).filter(Boolean)
  if (!fn || boxes.length < 2) return null
  const hull = {
    l: Math.min(...boxes.map(b => b.l)), r: Math.max(...boxes.map(b => b.r)),
    t: Math.min(...boxes.map(b => b.t)), b: Math.max(...boxes.map(b => b.b)),
  }
  const plan = new Map()
  boxes.forEach(box => {
    const p = fn(box, hull)
    plan.set(box.id, { x: p.x != null ? Math.round(p.x) : box.l, y: p.y != null ? Math.round(p.y) : box.t })
  })
  return plan
}

/**
 * Where spacing the selection evenly between its outermost two blocks would
 * put each block. Gaps are equalised rather than centres, so blocks of
 * different heights end up with the same amount of air between them.
 */
export function planDistribute(ids, axis) {
  const boxes = ids.map(boxOf).filter(Boolean)
  if (boxes.length < 3) return null
  const horiz = axis === 'h'
  boxes.sort((a, b) => (horiz ? a.l - b.l : a.t - b.t))
  const first = boxes[0], last = boxes[boxes.length - 1]
  const span = horiz ? (last.l - first.l) : (last.t - first.t)
  const sizes = boxes.slice(1, -1).reduce((n, b) => n + (horiz ? b.w : b.h), 0)
  const gap = (span - sizes - (horiz ? first.w : first.h)) / (boxes.length - 1)
  const plan = new Map(boxes.map(b => [b.id, { x: b.l, y: b.t }]))
  let cursor = (horiz ? first.r : first.b) + gap
  boxes.slice(1, -1).forEach(box => {
    const p = plan.get(box.id)
    if (horiz) { p.x = Math.round(cursor); cursor += box.w + gap }
    else       { p.y = Math.round(cursor); cursor += box.h + gap }
  })
  return plan
}

// Move the blocks a plan moves, as one undo step. A plan that moves nothing
// takes no snapshot: Cmd+Z must never land on a no-op, and the redo steps
// it would have cleared stay. Returns how many blocks moved.
function applyPlan(plan) {
  const moves = [...plan].filter(([id, p]) => state.blocks[id] && (state.blocks[id].x !== p.x || state.blocks[id].y !== p.y))
  if (!moves.length) return 0
  snapshot()
  moves.forEach(([id, p]) => { state.blocks[id].x = p.x; state.blocks[id].y = p.y })
  debouncedSave()
  return moves.length
}

/** Align every selected block to the selection's own bounding box. Returns how many took part. */
export function alignSelection(ids, mode) {
  const plan = planAlign(ids, mode)
  if (!plan) return 0
  applyPlan(plan)
  return plan.size
}

/** Space the selection evenly. Returns how many took part. */
export function distributeSelection(ids, axis) {
  const plan = planDistribute(ids, axis)
  if (!plan) return 0
  applyPlan(plan)
  return plan.size
}

const ARRANGE = {
  align: { plan: planAlign, few: 'Select two or more blocks to align', same: 'Already aligned', done: n => `Aligned ${n} blocks` },
  distribute: { plan: planDistribute, few: 'Select three or more blocks to distribute', same: 'Already evenly spaced', done: n => `Spaced ${n} blocks evenly` },
}

/**
 * Align (`how` a mode: left, hcenter, right, top, vcenter, bottom) or
 * distribute (`how` 'h' or 'v') a selection, as the inspector and the
 * context menu both offer it: one undo step when something moves, none when
 * nothing does, the moved cards and their connections redrawn with their gap
 * marks, and a toast either way. Returns how many blocks moved.
 */
export function arrangeSelection(kind, ids, how) {
  const k = ARRANGE[kind]; if (!k) return 0
  const plan = k.plan(ids, how)
  if (!plan) { showToast(k.few, 'info', 1600); return 0 }
  const moved = applyPlan(plan)
  if (!moved) { showToast(k.same, 'info', 1400); return 0 }
  plan.forEach((_, id) => renderBlock(id))
  renderArrows({ cheap: false })
  renderFrames()
  // A re-rendered card rebuilds its classes; paint the gaps back.
  runGapDetection()
  showToast(k.done(plan.size), 'success', 1400)
  return moved
}
