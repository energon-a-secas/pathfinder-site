// ════════════════════════════════════════════════════════════
//  arrow-routes.js: where every connection runs.
//
//  Sides, lanes on each side, the A* route around the cards, and
//  the pass that pulls shared runs apart. resolveRoutes() is the
//  single source of connection geometry for the canvas and the
//  image export alike.
// ════════════════════════════════════════════════════════════

import { state } from './state.js'
import { getBlockDims } from './utils.js'
import { routeOrtho, separateRoutes, segmentCrossesRect, rectTouchesBox, ROUTE_DEFAULTS } from './route.js'
import { isHoriz, arrowRoute, arrowPolyline } from './arrow-geometry.js'

// ── Arrow routing ────────────────────────────────────────────
const LANE_INSET = 14
const MIN_PITCH = 16      // lanes on one side sit at least this far apart

/**
 * Where a connection meets a block.
 *
 * With the default index/count it returns the exact side midpoint, which is
 * what a single arrow wants. When several arrows share a side, each gets its
 * own lane: centred on the side, at least MIN_PITCH apart when the side has
 * room, never closer to a corner than the inset. `rect` ({x,y,w,h}) saves
 * reading the card's size from the page when the caller has it already.
 */
export function portPos(id, port, index = 0, count = 1, rect = null) {
  const b = rect || boxOf(id); if (!b) return null
  const { w, h } = b
  const along = len => {
    if (count <= 1) return len / 2
    const lo = Math.min(LANE_INSET, len / 2)
    const span = len - lo * 2
    const pitch = Math.min(Math.max(span / (count + 1), MIN_PITCH), span / (count - 1))
    return len / 2 + (index - (count - 1) / 2) * pitch
  }
  const ox = along(w), oy = along(h)
  const map = {
    left:   { x: b.x,      y: b.y + oy, dir: 'left'   },
    right:  { x: b.x + w,  y: b.y + oy, dir: 'right'  },
    top:    { x: b.x + ox, y: b.y,      dir: 'top'    },
    bottom: { x: b.x + ox, y: b.y + h,  dir: 'bottom' }
  }
  const p = map[port]
  // Whole pixels. Fractional lane offsets left half-pixel jogs in routed
  // paths (… L 998 -24 L 998 -23.5 …) where the two ends disagreed.
  return p ? { x: Math.round(p.x), y: Math.round(p.y), dir: p.dir } : null
}

// A card's box: its position from the state, its size from the page.
function boxOf(id) {
  const b = state.blocks[id]; if (!b) return null
  const { w, h } = getBlockDims(id)
  return { x: b.x, y: b.y, w, h }
}

// How many lanes a side of this length can hold at MIN_PITCH.
function laneCapacity(len) {
  const span = len - Math.min(LANE_INSET, len / 2) * 2
  return Math.max(1, Math.floor(span / MIN_PITCH) + 1)
}

// Auto-pick the facing ports based on relative box position.
function autoPorts(f, t) {
  const fw = f.w, fh = f.h, tw = t.w, th = t.h
  const dx = (t.x + tw/2) - (f.x + fw/2)
  const dy = (t.y + th/2) - (f.y + fh/2)
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { x1: f.x+fw, y1: f.y+fh/2, d1:'right', x2: t.x,    y2: t.y+th/2, d2:'left'   }
      : { x1: f.x,    y1: f.y+fh/2, d1:'left',  x2: t.x+tw, y2: t.y+th/2, d2:'right'  }
  } else {
    return dy >= 0
      ? { x1: f.x+fw/2, y1: f.y+fh, d1:'bottom', x2: t.x+tw/2, y2: t.y,    d2:'top'    }
      : { x1: f.x+fw/2, y1: f.y,    d1:'top',    x2: t.x+tw/2, y2: t.y+th, d2:'bottom' }
  }
}

// Resolve the endpoints for an arrow. Pinned ports (fromPort/toPort) stay on the
// side the user connected; unpinned sides auto-route by box position.
export function bestPorts(fromId, toId, fromPort, toPort, rects = null) {
  const f = rects?.get(fromId) || boxOf(fromId), t = rects?.get(toId) || boxOf(toId)
  if (!f || !t) return null
  const pts = autoPorts(f, t)
  if (fromPort) {
    const p = portPos(fromId, fromPort, 0, 1, f)
    if (p) { pts.x1 = p.x; pts.y1 = p.y; pts.d1 = p.dir }
  }
  if (toPort) {
    const p = portPos(toId, toPort, 0, 1, t)
    if (p) { pts.x2 = p.x; pts.y2 = p.y; pts.d2 = p.dir }
  }
  return pts
}

// ── Lane assignment + obstacle-aware routing ─────────────────

// Routing is incremental. Each routed connection keeps its polyline with
// the boxes its search looked at (routeOrtho's `deps`). A full pass compares
// every block's box with the boxes of the previous full pass, and only a
// route whose boxes a changed block touches (where it was, or where it is
// now) runs again. A drag release re-routes the lines near the card that
// moved, not all 400. Nothing depends on a block outside those boxes, so
// the result is the one a full re-route gives (tests/lines-perf.test.js
// checks it on random edits).
let routeCache = new Map()       // aid -> { key, points, deps }
// Routes a drag frame found for lines it did not move. They were found
// against a card mid-drag, so they never enter the cache and go at the
// next full pass.
let provisional = new Map()      // aid -> { key, points }
let baseRects = null             // id -> box at the last full pass: what the caches hold for
// Past this many changed boxes (Tidy, an import, undo of either) checking
// each route costs more than routing afresh.
const CHANGE_LIMIT = 64
// How far past its endpoints a canvas route looks for cards to avoid. It is
// also how far a route's dependence on the canvas reaches, so it decides how
// many lines a moved card makes re-route: about half as many as at the
// router's default 160. A path that then comes nearer than the margin to a
// card left out of the search is searched again with that card in play
// (outerMargin), so the smaller reach costs no clearance: on 4412 routes
// over random grids, 38 differ from what 160 draws, and the 4 of those that
// pass nearer to some card still keep 64px from it. Only the canvas takes
// these: the trace tool keeps the router's defaults. The canvas also takes
// the router's turn-counting estimate (turnBound): routes of the same cost,
// found in about 60% of the time.
const CANVAS_REACH = 80
const CANVAS_ROUTE = { reach: CANVAS_REACH, outerMargin: true, turnBound: true }

// Separation is global (one crowded corridor pushes on the next), so it
// runs over every route whenever one changed, but each cluster's placement
// is remembered by its exact inputs (separateRoutes' memo): after an edit
// only the clusters it reached are placed again.
let clusterMemo = { prev: new Map(), next: new Map() }
// The last full pass's separation per route: the raw points (the very array
// the route cache holds) and what separation made of them. A drag frame
// reuses it for every line it does not redraw, and a full pass in which no
// block and no route changed reuses all of it.
let sepByRoute = new Map()       // aid -> { raw, done }
let rectsChanged = true

export function invalidateRoutes() {
  routeCache = new Map(); provisional = new Map()
  clusterMemo = { prev: new Map(), next: new Map() }
  baseRects = null; sepByRoute = new Map(); rectsChanged = true
}

/**
 * What a full re-route gives right now: every route searched and separated
 * afresh, with the live caches left exactly as they were. The incremental
 * pass must always equal it (tests/lines-perf.test.js holds it to that).
 */
export function fullReroute() {
  const kept = { routeCache, provisional, clusterMemo, baseRects, sepByRoute, rectsChanged, stats: { ...routeStats } }
  invalidateRoutes()
  try { return resolveRoutes() }
  finally {
    ({ routeCache, provisional, clusterMemo, baseRects, sepByRoute, rectsChanged } = kept)
    Object.assign(routeStats, kept.stats)
  }
}

const sameBox = (p, q) => p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h
const touchesAny = (deps, boxes) => {
  for (const d of deps) for (const q of boxes) if (rectTouchesBox(q, d)) return true
  return false
}

// A full pass: drop what the blocks that changed since the last one could
// have changed, and take this pass's boxes as the new reference.
function settle(rects) {
  provisional.clear()
  rectsChanged = !baseRects
  if (!baseRects) routeCache.clear()
  else {
    const changed = []
    rects.forEach((r, id) => {
      const o = baseRects.get(id)
      if (!o) changed.push(r)
      else if (!sameBox(o, r)) changed.push(o, r)
    })
    baseRects.forEach((o, id) => { if (!rects.has(id)) changed.push(o) })
    rectsChanged = changed.length > 0
    if (changed.length > CHANGE_LIMIT) routeCache.clear()
    else if (changed.length) routeCache.forEach((e, aid) => { if (touchesAny(e.deps, changed)) routeCache.delete(aid) })
  }
  baseRects = rects
}

// How many searches the router has run (what a keyboard nudge must not
// multiply) and how many clusters separation placed afresh rather than
// from its memo. Tests read them; nothing in the app does.
export const routeStats = { searches: 0, placed: 0 }

// A side pinned by a person stays exactly where they put it. Pins written
// by Tidy or by an import are layout, not intent, and may be adjusted.
function userPinned(a, end) {
  const port = end === 'from' ? a.fromPort : a.toPort
  return !!port && a.portsBy !== 'tidy' && a.portsBy !== 'import'
}

/**
 * Resolve every arrow's real endpoints in one pass.
 *
 * This is the single source of truth for arrow geometry: the live canvas and
 * the SVG/PNG exporter both call it, so an exported diagram cannot drift from
 * what is on screen.
 *
 * `cheap` skips the router for arrows it would have to compute. With a
 * `moving` set (a drag in flight) only the connections of those blocks go
 * cheap; the rest keep their cached route, or get one. Without it every
 * uncached route draws as an elbow until the next full pass.
 *
 * @returns {Map<string, {x1,y1,d1,x2,y2,d2,lane,laneCount,points?}>}
 */
export function resolveRoutes({ cheap = false, moving = null } = {}) {
  const out = new Map()
  const rects = new Map()
  for (const id in state.blocks) {
    const b = state.blocks[id], { w, h } = getBlockDims(id)
    rects.set(id, { id, x: b.x, y: b.y, w, h })
  }
  const centre = id => { const r = rects.get(id); return { x: r.x + r.w / 2, y: r.y + r.h / 2 } }

  // 1. Sides: pinned where pinned, facing each other otherwise, unless a
  // routed line would leave straight into another card (see clearSide).
  const sides = new Map()
  const endpoints = []
  const blocked = sideBlocker(rects)
  state.arrows.forEach(a => {
    if (!rects.has(a.from) || !rects.has(a.to)) return
    const base = bestPorts(a.from, a.to, a.fromPort, a.toPort, rects)
    if (!base) return
    if (arrowRoute(a) === 'routed') {
      if (!a.fromPort) base.d1 = clearSide(a.from, a.to, base.d1, rects, blocked)
      if (!a.toPort) base.d2 = clearSide(a.to, a.from, base.d2, rects, blocked)
    }
    sides.set(a.id, base)
    endpoints.push({ aid: a.id, end: 'from', bid: a.from, side: base.d1, other: a.to, pinned: !!a.fromPort })
    endpoints.push({ aid: a.id, end: 'to',   bid: a.to,   side: base.d2, other: a.from, pinned: !!a.toPort })
  })

  const bucketize = () => {
    const m = new Map()
    endpoints.forEach(e => {
      const k = e.bid + '|' + e.side
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(e)
    })
    return m
  }
  // Order each bucket by where its far end sits. Ordering by the far end is
  // what keeps the lanes from crossing each other on the way out.
  const sortBucket = list => {
    const h = isHoriz(list[0].side)
    list.sort((p, q) => {
      const a = centre(p.other), b = centre(q.other)
      return (h ? a.y - b.y : a.x - b.x) || (p.aid < q.aid ? -1 : p.aid > q.aid ? 1 : 0)
    })
  }

  // 2. A side with more arrows than it has room for at MIN_PITCH spills the
  // ends at its extremes to the neighbouring side they lean toward, rather
  // than packing heads on top of each other. Pinned ends never move.
  let buckets = bucketize()
  let spilled = false
  buckets.forEach(list => {
    const { bid, side } = list[0]
    const r = rects.get(bid)
    const h = isHoriz(side)
    const cap = laneCapacity(h ? r.h : r.w)
    if (list.length <= cap) return
    sortBucket(list)
    const mid = h ? r.y + r.h / 2 : r.x + r.w / 2
    const movable = list.filter(e => !e.pinned)
    let excess = list.length - cap
    while (excess > 0 && movable.length) {
      const first = movable[0], last = movable[movable.length - 1]
      const lean = e => { const c = centre(e.other); return (h ? c.y : c.x) - mid }
      const pick = Math.abs(lean(first)) >= Math.abs(lean(last)) ? movable.shift() : movable.pop()
      pick.side = h ? (lean(pick) < 0 ? 'top' : 'bottom') : (lean(pick) < 0 ? 'left' : 'right')
      excess--
      spilled = true
    }
  })
  if (spilled) buckets = bucketize()

  const lanes = new Map()
  // Where each lane of a shared side sits along it, updated as ends slide
  // into line (straighten), so a slide never crowds a neighbour.
  const lanePos = new Map()
  buckets.forEach((list, key) => {
    if (list.length > 1) sortBucket(list)
    list.forEach((e, i) => lanes.set(e.aid + '|' + e.end, { index: i, count: list.length, side: e.side, key }))
    if (list.length > 1) {
      const axis = isHoriz(list[0].side) ? 'y' : 'x'
      lanePos.set(key, list.map((e, i) => portPos(e.bid, e.side, i, list.length, rects.get(e.bid))?.[axis]))
    }
  })

  const full = !cheap
  if (full) {
    settle(rects)
    // A deleted connection's route would otherwise stay cached for good.
    if (routeCache.size > state.arrows.length) {
      const live = new Set(state.arrows.map(a => a.id))
      routeCache.forEach((_, aid) => { if (!live.has(aid)) routeCache.delete(aid) })
    }
  }
  const obstacles = [...rects.values()]

  // 3. Ports on their lanes, then routes.
  const ends = new Map()
  state.arrows.forEach(a => {
    if (!sides.has(a.id)) return
    const lf = lanes.get(a.id + '|from') || { index: 0, count: 1 }
    const lt = lanes.get(a.id + '|to')   || { index: 0, count: 1 }
    const p1 = portPos(a.from, lf.side, lf.index, lf.count, rects.get(a.from))
    const p2 = portPos(a.to,   lt.side, lt.index, lt.count, rects.get(a.to))
    if (!p1 || !p2) return
    const style = arrowRoute(a)
    if (style !== 'straight') straighten(a, p1, p2, lf, lt, rects, lanePos)
    const pts = {
      x1: p1.x, y1: p1.y, d1: p1.dir,
      x2: p2.x, y2: p2.y, d2: p2.dir,
      fromLane: lf.index, fromLaneCount: lf.count,
      toLane:   lt.index, toLaneCount:   lt.count,
      lane:      lt.count > lf.count ? lt.index : lf.index,
      laneCount: Math.max(lf.count, lt.count),
    }
    out.set(a.id, pts)
    ends.set(a.id, { a, lf, lt, style })
  })
  unstackFacing(out, ends, rects, lanePos)
  out.forEach((pts, aid) => {
    const { a, style } = ends.get(aid)
    if (style === 'routed') {
      const key = pts.x1 + ',' + pts.y1 + ',' + pts.d1 + ',' + pts.x2 + ',' + pts.y2 + ',' + pts.d2
      const kept = routeCache.get(a.id)
      const drafted = provisional.get(a.id)
      if (kept && kept.key === key) {
        pts.points = kept.points
      } else if (full) {
        const deps = []
        pts.points = routeOrtho(pts, obstacles, { ...CANVAS_ROUTE, deps })
        routeStats.searches++
        routeCache.set(a.id, { key, points: pts.points, deps })
      } else if (drafted && drafted.key === key) {
        pts.points = drafted.points
      } else if (moving && !moving.has(a.from) && !moving.has(a.to)) {
        pts.points = routeOrtho(pts, obstacles, CANVAS_ROUTE)
        routeStats.searches++
        provisional.set(a.id, { key, points: pts.points })
      }
    }
  })

  // 4. Routes found one at a time happily share a trunk. Pull shared runs
  // apart so three arrows into one card read as three lines. Only a full
  // pass separates, and only when a route or a block changed; a cheap pass
  // (a drag frame) reuses the last result for every route it did not have
  // to redraw, and leaves the moving ones for the release.
  const routed = []
  out.forEach((pts, id) => { if (pts.points && pts.points.length > 2) routed.push({ id, points: pts.points }) })
  if (full) {
    // Separation reads the routes in order (runs are clustered and placed
    // in that order), so the same routes in another order are not the same
    // input: the stored map's order is the last pass's order.
    let same = !rectsChanged && sepByRoute.size === routed.length
    if (same) {
      let i = 0
      for (const [id, s] of sepByRoute) {
        if (routed[i].id !== id || s.raw !== routed[i].points) { same = false; break }
        i++
      }
    }
    if (!same) {
      clusterMemo.next = new Map()
      clusterMemo.placed = 0
      const sep = routed.length > 1 ? separateRoutes(routed, obstacles, { memo: clusterMemo }) : routed
      routeStats.placed += clusterMemo.placed
      clusterMemo = { prev: clusterMemo.next, next: new Map() }
      sepByRoute = new Map(routed.map((r, i) => [r.id, { raw: r.points, done: sep[i].points }]))
    }
  }
  routed.forEach(r => {
    const s = sepByRoute.get(r.id)
    if (s && s.raw === r.points) out.get(r.id).points = s.done
  })

  return out
}

// ── Sides that lead straight into a neighbour ─────────────────
// Two cards a few pixels apart: the side of one that faces a far target can
// sit right against the other card, and the first stretch of line (the
// router's stub) then runs through it, since the router cannot route around
// a card its stub starts inside. An unpinned end in that spot takes the next
// best side instead. Ends a person pinned stay where they are.
const STUB = ROUTE_DEFAULTS.stub
const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }
const CELL = 256

// Whether the stub off a side of a card runs into a card other than the
// two the line joins. One per pass: a bucket grid over the cards, built on
// first use, and each answer kept for the pass.
function sideBlocker(rects) {
  let cells = null
  const memo = new Map()
  const key = (cx, cy) => cx * 65536 + cy
  const build = () => {
    cells = new Map()
    rects.forEach(r => {
      for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w) / CELL); cx++)
        for (let cy = Math.floor(r.y / CELL); cy <= Math.floor((r.y + r.h) / CELL); cy++) {
          const list = cells.get(key(cx, cy))
          if (list) list.push(r); else cells.set(key(cx, cy), [r])
        }
    })
  }
  return (bid, side, other) => {
    const k = bid + '|' + side + '|' + other
    const known = memo.get(k)
    if (known !== undefined) return known
    if (!cells) build()
    // The side's midpoint, as portPos gives it for a single line.
    const b = rects.get(bid)
    const p = side === 'left' ? { x: b.x, y: Math.round(b.y + b.h / 2) } : side === 'right' ? { x: b.x + b.w, y: Math.round(b.y + b.h / 2) }
            : side === 'top' ? { x: Math.round(b.x + b.w / 2), y: b.y } : { x: Math.round(b.x + b.w / 2), y: b.y + b.h }
    const q = side === 'left' ? { x: p.x - STUB, y: p.y } : side === 'right' ? { x: p.x + STUB, y: p.y }
            : side === 'top' ? { x: p.x, y: p.y - STUB } : { x: p.x, y: p.y + STUB }
    let hit = false
    for (let cx = Math.floor(Math.min(p.x, q.x) / CELL); !hit && cx <= Math.floor(Math.max(p.x, q.x) / CELL); cx++)
      for (let cy = Math.floor(Math.min(p.y, q.y) / CELL); !hit && cy <= Math.floor(Math.max(p.y, q.y) / CELL); cy++)
        for (const r of cells.get(key(cx, cy)) || []) {
          if (r.id !== bid && r.id !== other && segmentCrossesRect(r, p, q)) { hit = true; break }
        }
    memo.set(k, hit)
    return hit
  }
}

function clearSide(bid, other, side, rects, blocked) {
  if (!blocked(bid, side, other)) return side
  const b = rects.get(bid), o = rects.get(other)
  const dx = (o.x + o.w / 2) - (b.x + b.w / 2), dy = (o.y + o.h / 2) - (b.y + b.h / 2)
  const across = isHoriz(side) ? (dy >= 0 ? 'bottom' : 'top') : (dx >= 0 ? 'right' : 'left')
  for (const alt of [across, OPPOSITE[across], OPPOSITE[side]]) if (!blocked(bid, alt, other)) return alt
  return side
}

// A line that would only jog a few pixels between two nearly aligned ports
// looks like a mistake. When nobody pinned an end by hand, slide it along
// its side to line up with the other end: freely when it is alone there,
// and on a shared side only as far as keeps MIN_PITCH to the lanes either
// side of it, so the lanes keep their order and never touch.
function straighten(a, p1, p2, lf, lt, rects, lanePos = new Map()) {
  if (!facingEnds(p1, p2)) return
  const axis = isHoriz(p1.dir) ? 'y' : 'x'
  if (p1[axis] === p2[axis]) return
  const slide = (lane, p, v) => {
    p[axis] = v
    const pos = lanePos.get(lane.key); if (pos) pos[lane.index] = v
  }
  if (!userPinned(a, 'to') && fits(p1[axis], sideSpan(rects, a.to, p2.dir)) && laneRoom(lanePos, lt, p1[axis])) slide(lt, p2, p1[axis])
  else if (!userPinned(a, 'from') && fits(p2[axis], sideSpan(rects, a.from, p1.dir)) && laneRoom(lanePos, lf, p2[axis])) slide(lf, p1, p2[axis])
}

// Two ends that face each other across open ground.
function facingEnds(p1, p2) {
  return (p1.dir === 'right'  && p2.dir === 'left'   && p2.x > p1.x) ||
         (p1.dir === 'left'   && p2.dir === 'right'  && p2.x < p1.x) ||
         (p1.dir === 'bottom' && p2.dir === 'top'    && p2.y > p1.y) ||
         (p1.dir === 'top'    && p2.dir === 'bottom' && p2.y < p1.y)
}

// Where along a side an end may sit: the side less the corner inset.
function sideSpan(rects, id, side) {
  const r = rects.get(id)
  const lo = isHoriz(side) ? r.y : r.x, len = isHoriz(side) ? r.h : r.w
  const inset = Math.min(LANE_INSET, len / 2)
  return [Math.ceil(lo + inset), Math.floor(lo + len - inset)]
}
const fits = (v, [lo, hi]) => v >= lo && v <= hi

// Whether an end can sit at v without crowding the lanes either side of it.
function laneRoom(lanePos, lane, v) {
  if (lane.count <= 1) return true
  const pos = lanePos.get(lane.key); if (!pos) return false
  const prev = pos[lane.index - 1], next = pos[lane.index + 1]
  return (prev === undefined || v - prev >= MIN_PITCH) && (next === undefined || next - v >= MIN_PITCH)
}

// ── Facing ends of different lines ───────────────────────────
// Two cards a few pixels apart, a line leaving the bottom of the upper one
// and another the top of the lower one, both from the middle: their first
// stretches run into each other and read as one line joining the cards.
// Separation cannot help (both are port legs), so one of the two ends
// slides a lane's pitch along its side. An end a person pinned stays, and
// an end its own line was straightened to meet moves last.
const FACING_REACH = STUB * 2 + 10

function unstackFacing(out, ends, rects, lanePos) {
  const at = e => e.which === 1 ? { x: e.pts.x1, y: e.pts.y1, dir: e.pts.d1 } : { x: e.pts.x2, y: e.pts.y2, dir: e.pts.d2 }
  const other = e => at({ ...e, which: 3 - e.which })
  // Ends on top and bottom sides, grouped by x; on left and right, by y.
  // Only ends in one group can face each other from the same spot.
  const groups = new Map()
  const keyOf = e => { const p = at(e); return (isHoriz(p.dir) ? 'y' : 'x') + (isHoriz(p.dir) ? p.y : p.x) }
  const join = e => { const k = keyOf(e); if (groups.has(k)) groups.get(k).push(e); else groups.set(k, [e]) }
  out.forEach((pts, aid) => {
    const { a, lf, lt } = ends.get(aid)
    join({ aid, a, pts, which: 1, lane: lf })
    join({ aid, a, pts, which: 2, lane: lt })
  })
  groups.forEach(group => {
    if (group.length < 2) return
    for (const P of group) {
      const dir = at(P).dir
      if (dir !== 'bottom' && dir !== 'right') continue
      const axis = dir === 'bottom' ? 'x' : 'y', across = axis === 'x' ? 'y' : 'x'
      const facing = dir === 'bottom' ? 'top' : 'left'
      for (const Q of group) {
        const p = at(P), q = at(Q)   // either may have slid already
        if (Q.aid === P.aid || q.dir !== facing || q[axis] !== p[axis]) continue
        const gap = q[across] - p[across]
        if (gap <= 0 || gap > FACING_REACH) continue
        // An end whose own line runs straight to its other end loses that if it moves.
        const straight = E => { const e = at(E), o = other(E); return e[axis] === o[axis] && facingEnds(e, o) }
        const order = [Q, P].sort((E, F) => straight(E) - straight(F))
        for (const E of order) {
          if (userPinned(E.a, E.which === 1 ? 'from' : 'to')) continue
          const e = at(E)
          const bid = E.which === 1 ? E.a.from : E.a.to
          const span = sideSpan(rects, bid, e.dir)
          const v = [e[axis] + MIN_PITCH, e[axis] - MIN_PITCH].find(v => fits(v, span) && laneRoom(lanePos, E.lane, v))
          if (v === undefined) continue
          if (E.which === 1) E.pts[axis + '1'] = v; else E.pts[axis + '2'] = v
          const pos = lanePos.get(E.lane.key); if (pos) pos[E.lane.index] = v
          break
        }
      }
    }
  })
}

/**
 * Connections whose drawn line passes under a card that is not one of its
 * own two ends. Tidy reports this, because a crossing count alone says
 * nothing about a line hidden behind a block.
 */
export function linesUnderCards(routes = resolveRoutes()) {
  const rects = []
  for (const id in state.blocks) {
    const b = state.blocks[id], { w, h } = getBlockDims(id)
    rects.push({ id, x: b.x, y: b.y, w, h })
  }
  const hits = []
  state.arrows.forEach(a => {
    const pts = routes.get(a.id); if (!pts) return
    const poly = arrowPolyline(pts, arrowRoute(a))
    const others = rects.filter(r => r.id !== a.from && r.id !== a.to)
    for (let i = 1; i < poly.length; i++) {
      if (others.some(r => segmentCrossesRect(r, poly[i - 1], poly[i]))) { hits.push(a.id); return }
    }
  })
  return hits
}
