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
import { routeOrtho, separateRoutes, segmentCrossesRect } from './route.js'
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
 * room, never closer to a corner than the inset.
 */
export function portPos(id, port, index = 0, count = 1) {
  const b = state.blocks[id]; if (!b) return null
  const { w, h } = getBlockDims(id)
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

// How many lanes a side of this length can hold at MIN_PITCH.
function laneCapacity(len) {
  const span = len - Math.min(LANE_INSET, len / 2) * 2
  return Math.max(1, Math.floor(span / MIN_PITCH) + 1)
}

// Auto-pick the facing ports based on relative box position.
function autoPorts(fromId, toId) {
  const f = state.blocks[fromId], t = state.blocks[toId]
  const { w: fw, h: fh } = getBlockDims(fromId)
  const { w: tw, h: th } = getBlockDims(toId)
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
export function bestPorts(fromId, toId, fromPort, toPort) {
  const f = state.blocks[fromId], t = state.blocks[toId]; if (!f || !t) return null
  const auto = autoPorts(fromId, toId)
  const pts = { ...auto }
  if (fromPort) {
    const p = portPos(fromId, fromPort)
    if (p) { pts.x1 = p.x; pts.y1 = p.y; pts.d1 = p.dir }
  }
  if (toPort) {
    const p = portPos(toId, toPort)
    if (p) { pts.x2 = p.x; pts.y2 = p.y; pts.d2 = p.dir }
  }
  return pts
}

// ── Lane assignment + obstacle-aware routing ─────────────────

// A cheap fingerprint of every block's box. Routes are only recomputed when
// something actually moved or resized, so panning and selecting cost nothing.
function canvasStamp(rects) {
  let s = ''
  rects.forEach(r => { s += r.id + ':' + r.x + ',' + r.y + ',' + r.w + ',' + r.h + ';' })
  return s
}

const routeCache = new Map()
let routeStamp = null
// The last full pass's separation: each route's raw points (the very array
// the route cache holds) and what separation made of them. Separating is
// the costly part of a render on a large canvas (60ms at 150 cards), and
// selecting a line, a label edit or a drag frame changes no route, so a
// raw route that is still the one separated reuses its result.
let sepMemo = null

export function invalidateRoutes() { routeCache.clear(); routeStamp = null; sepMemo = null }
// How many searches the router has run: what a keyboard nudge must not
// multiply (tests read it; nothing in the app does).
export const routeStats = { searches: 0 }

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

  // 1. Sides: pinned where pinned, facing each other otherwise.
  const sides = new Map()
  const endpoints = []
  state.arrows.forEach(a => {
    if (!rects.has(a.from) || !rects.has(a.to)) return
    const base = bestPorts(a.from, a.to, a.fromPort, a.toPort)
    if (!base) return
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
      lanePos.set(key, list.map((e, i) => portPos(e.bid, e.side, i, list.length)?.[axis]))
    }
  })

  const full = !cheap
  const anyRouted = state.arrows.some(a => arrowRoute(a) === 'routed')
  if (full && anyRouted) {
    const stamp = canvasStamp(rects)
    if (stamp !== routeStamp) { routeCache.clear(); routeStamp = stamp }
  }
  const obstacles = [...rects.values()]

  // 3. Ports on their lanes, then routes.
  state.arrows.forEach(a => {
    if (!sides.has(a.id)) return
    const lf = lanes.get(a.id + '|from') || { index: 0, count: 1 }
    const lt = lanes.get(a.id + '|to')   || { index: 0, count: 1 }
    const p1 = portPos(a.from, lf.side, lf.index, lf.count)
    const p2 = portPos(a.to,   lt.side, lt.index, lt.count)
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
    if (style === 'routed') {
      const key = a.id + '|' + pts.x1 + ',' + pts.y1 + ',' + pts.d1 + ',' + pts.x2 + ',' + pts.y2 + ',' + pts.d2
      const touchesMoving = moving && (moving.has(a.from) || moving.has(a.to))
      if (routeCache.has(key)) {
        pts.points = routeCache.get(key)
      } else if (full || (moving && !touchesMoving)) {
        const pl = routeOrtho(pts, obstacles)
        routeStats.searches++
        routeCache.set(key, pl)
        pts.points = pl
      }
    }
    out.set(a.id, pts)
  })

  // 4. Routes found one at a time happily share a trunk. Pull shared runs
  // apart so three arrows into one card read as three lines. Only a full
  // pass separates, and only when some route changed since the last one;
  // a cheap pass (a drag frame) reuses the last result for every route it
  // did not have to redraw, and leaves the moving ones for the release.
  const routed = []
  out.forEach((pts, id) => { if (pts.points && pts.points.length > 2) routed.push({ id, points: pts.points }) })
  if (full) {
    let same = !!sepMemo && sepMemo.stamp === routeStamp && sepMemo.raw.size === routed.length
    if (same) for (const r of routed) if (sepMemo.raw.get(r.id) !== r.points) { same = false; break }
    if (!same) {
      const sep = routed.length > 1 ? separateRoutes(routed, obstacles) : routed
      sepMemo = { stamp: routeStamp, raw: new Map(routed.map(r => [r.id, r.points])),
                  done: new Map(sep.map(r => [r.id, r.points])) }
    }
  }
  if (sepMemo) routed.forEach(r => {
    if (sepMemo.raw.get(r.id) === r.points) out.get(r.id).points = sepMemo.done.get(r.id)
  })

  return out
}

// A line that would only jog a few pixels between two nearly aligned ports
// looks like a mistake. When nobody pinned an end by hand, slide it along
// its side to line up with the other end: freely when it is alone there,
// and on a shared side only as far as keeps MIN_PITCH to the lanes either
// side of it, so the lanes keep their order and never touch.
function straighten(a, p1, p2, lf, lt, rects, lanePos = new Map()) {
  const facing =
    (p1.dir === 'right'  && p2.dir === 'left'   && p2.x > p1.x) ||
    (p1.dir === 'left'   && p2.dir === 'right'  && p2.x < p1.x) ||
    (p1.dir === 'bottom' && p2.dir === 'top'    && p2.y > p1.y) ||
    (p1.dir === 'top'    && p2.dir === 'bottom' && p2.y < p1.y)
  if (!facing) return
  const axis = isHoriz(p1.dir) ? 'y' : 'x'
  if (p1[axis] === p2[axis]) return
  const span = (id, side) => {
    const r = rects.get(id)
    const lo = isHoriz(side) ? r.y : r.x, len = isHoriz(side) ? r.h : r.w
    const inset = Math.min(LANE_INSET, len / 2)
    return [Math.ceil(lo + inset), Math.floor(lo + len - inset)]
  }
  const fits = (v, [lo, hi]) => v >= lo && v <= hi
  const room = (lane, v) => {
    if (lane.count <= 1) return true
    const pos = lanePos.get(lane.key); if (!pos) return false
    const prev = pos[lane.index - 1], next = pos[lane.index + 1]
    return (prev === undefined || v - prev >= MIN_PITCH) && (next === undefined || next - v >= MIN_PITCH)
  }
  const slide = (lane, p, v) => {
    p[axis] = v
    const pos = lanePos.get(lane.key); if (pos) pos[lane.index] = v
  }
  if (!userPinned(a, 'to') && fits(p1[axis], span(a.to, p2.dir)) && room(lt, p1[axis])) slide(lt, p2, p1[axis])
  else if (!userPinned(a, 'from') && fits(p2[axis], span(a.from, p1.dir)) && room(lf, p2[axis])) slide(lf, p1, p2[axis])
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
