// ════════════════════════════════════════════════════════════
//  trace/layout-trace.js: A normalized trace to a drawable scene
//
//  Reuses the canvas's own pure layout and routing (layout.js:layoutGraph,
//  route.js:routeOrtho) rather than growing a second implementation of
//  either. What is new here is containment (an account holding a VPC
//  holding a subnet) and lane assignment, so six edges arriving at one
//  box land on six points instead of fusing into one line.
//
//  The output is data: no SVG, no DOM. render-svg.js draws it, and a test
//  can assert on it without a browser.
// ════════════════════════════════════════════════════════════

import { layoutGraph } from '../layout.js'
import { routeOrtho, polyToPath, polyMidpoint } from '../route.js'

/**
 * Where a branch label goes.
 *
 * The geometric midpoint of an orthogonal path is very often a corner, and
 * a corner is exactly where two lanes converge. The middle of the longest
 * straight run is almost always in open channel instead, which is the
 * difference between a label you can read and one printed across a bend.
 */
function labelAnchor(pts) {
  if (!pts || pts.length < 2) return polyMidpoint(pts || [])
  let best = null, bestLen = -1
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    if (len > bestLen) { bestLen = len; best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, len } }
  }
  // A very short run is worse than the honest midpoint.
  return bestLen < 34 ? polyMidpoint(pts) : best
}
import { TOPO_KINDS, BOX } from './model.js'
import { measureAll, textWidth } from './measure.js'

const OUTER = 56          // margin around the whole diagram

/** Depth of a node in the containment tree; containers sort by it. */
function depthOf(node, byId) {
  let d = 0, cur = node
  while (cur && cur.parent) { d++; cur = byId.get(cur.parent) }
  return d
}

/**
 * Which side of a box an edge should leave from or arrive at.
 *
 * Decided from the boxes' relative positions rather than from the layer
 * index, because a back edge and a long forward edge want different
 * geometry and only the geometry knows which one this is.
 */
function sidesFor(a, b, horiz) {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2
  const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2
  const dx = bcx - acx, dy = bcy - acy

  if (horiz) {
    if (Math.abs(dx) > 8) return dx > 0 ? ['right', 'left'] : ['left', 'right']
    return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']
  }
  if (Math.abs(dy) > 8) return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']
  return dx > 0 ? ['right', 'left'] : ['left', 'right']
}

const DIRV = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }

/** A point on `side` of box `r`, at fractional position `t` along it. */
function portAt(r, side, t) {
  const x = side === 'left' ? r.x : side === 'right' ? r.x + r.w : r.x + r.w * t
  const y = side === 'top' ? r.y : side === 'bottom' ? r.y + r.h : r.y + r.h * t
  return { x: Math.round(x), y: Math.round(y) }
}

const hits = (r, boxes) => boxes.some(b =>
  r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h)

/** Estimated plate size for a label, matching render-svg's own geometry. */
const plateOf = (label, cx, cy) => {
  const w = textWidth(label, 11) + 14, h = 18
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

/**
 * Place every branch label somewhere it can be read.
 *
 * Three strategies, cheapest first: leave it where the router put it,
 * slide it along its own straight run, then push it perpendicular to that
 * run. Labels already placed count as obstacles too, which is the case
 * Mermaid does not handle and the reason two outcomes of one decision
 * overprint each other there.
 */
function nudgeLabels(edges, boxes) {
  const placed = []
  const free = r => !hits(r, boxes) && !hits(r, placed)

  const longestSeg = pts => {
    let seg = null, best = -1
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
      if (len > best) { best = len; seg = [a, b, len] }
    }
    return seg
  }

  edges.filter(e => e.label).forEach(e => {
    const here = plateOf(e.label, e.mid.x, e.mid.y)
    if (free(here)) { placed.push(here); return }

    const seg = longestSeg(e.points)
    if (!seg) { placed.push(here); return }
    const [a, b, len] = seg
    const ux = (b.x - a.x) / (len || 1), uy = (b.y - a.y) / (len || 1)
    const px = -uy, py = ux                       // unit perpendicular

    const tries = []
    for (let d = 16; d <= Math.max(16, len / 2); d += 16) tries.push([d, 0], [-d, 0])
    for (const off of [15, -15, 26, -26, 38, -38]) {
      tries.push([0, off])
      for (let d = 20; d <= Math.max(20, len / 2); d += 24) tries.push([d, off], [-d, off])
    }

    for (const [along, perp] of tries) {
      const cx = e.mid.x + ux * along + px * perp
      const cy = e.mid.y + uy * along + py * perp
      const r = plateOf(e.label, cx, cy)
      if (free(r)) { e.mid = { x: cx, y: cy }; placed.push(r); return }
    }
    placed.push(here)
  })
}

export function buildScene(trace, opts = {}) {
  const horiz = (trace.meta.dir || 'LR') !== 'TB'
  const boxes = measureAll(trace.nodes)
  const byId = trace.byId

  const isContainer = n => trace.meta.kind === 'topology' && TOPO_KINDS[n.kind]?.container
  const containers = trace.nodes.filter(isContainer)
  const leaves = trace.nodes.filter(n => !isContainer(n))

  // Containers are not laid out. They are drawn around whatever ends up
  // inside them, which is the only way nesting stays correct when the
  // layout moves a child.
  const laidIds = new Set(leaves.map(n => n.id))
  const edgesForLayout = trace.edges
    .filter(e => laidIds.has(e.from) && laidIds.has(e.to))
    .map(e => ({ from: e.from, to: e.to }))

  // Cluster siblings by their outermost container, so a layout that is
  // free to reorder a layer still keeps one account's boxes together.
  const rootContainerOf = id => {
    let cur = byId.get(id), last = null
    while (cur && cur.parent) { last = cur.parent; cur = byId.get(cur.parent) }
    return last
  }

  const layoutNodes = leaves.map(n => ({
    id: n.id, w: boxes.get(n.id).w, h: boxes.get(n.id).h,
    groupId: rootContainerOf(n.id),
  }))

  const { positions } = layoutNodes.length
    ? layoutGraph(layoutNodes, edgesForLayout, { direction: horiz ? 'LR' : 'TB', layerGap: 96, nodeGap: 30, ...(opts.layout || {}) })
    : { positions: new Map() }

  // ── place leaves ───────────────────────────────────────────
  const rects = new Map()
  leaves.forEach(n => {
    const p = positions.get(n.id) || { x: 0, y: 0 }
    const b = boxes.get(n.id)
    rects.set(n.id, { x: Math.round(p.x), y: Math.round(p.y), w: b.w, h: b.h })
  })

  // ── grow containers around their contents ──────────────────
  // Deepest first, so an outer container sees its inner containers'
  // finished rectangles rather than only their leaf descendants.
  const childrenOf = id => trace.nodes.filter(n => n.parent === id)
  const ordered = [...containers].sort((a, b) => depthOf(b, byId) - depthOf(a, byId))
  ordered.forEach(c => {
    const kids = childrenOf(c.id).map(k => rects.get(k.id)).filter(Boolean)
    if (!kids.length) { rects.set(c.id, { x: 0, y: 0, w: 220, h: 90, empty: true }); return }
    const l = Math.min(...kids.map(r => r.x)) - BOX.containerPad
    const t = Math.min(...kids.map(r => r.y)) - BOX.containerPad - BOX.containerHeadH
    const r = Math.max(...kids.map(k => k.x + k.w)) + BOX.containerPad
    const b = Math.max(...kids.map(k => k.y + k.h)) + BOX.containerPad
    const labelW = textWidth(c.title, 12) + 34
    rects.set(c.id, { x: Math.round(l), y: Math.round(t), w: Math.round(Math.max(r - l, labelW)), h: Math.round(b - t) })
  })

  // ── normalise to the origin ────────────────────────────────
  const all = [...rects.values()]
  const minX = all.length ? Math.min(...all.map(r => r.x)) : 0
  const minY = all.length ? Math.min(...all.map(r => r.y)) : 0
  rects.forEach(r => { r.x += OUTER - minX; r.y += OUTER - minY })

  // ── lanes ──────────────────────────────────────────────────
  // Every endpoint is bucketed by the side it lands on, then each bucket
  // is spread across that side. Without this, a check with five outcomes
  // draws five arrows out of one pixel.
  const buckets = new Map()   // `${id}|${side}` -> [edgeId]
  const sideOf = new Map()    // edgeId -> [fromSide, toSide]
  trace.edges.forEach(e => {
    const a = rects.get(e.from), b = rects.get(e.to)
    if (!a || !b) return
    const [sa, sb] = sidesFor(a, b, horiz)
    sideOf.set(e.id, [sa, sb])
    const ka = `${e.from}|${sa}`, kb = `${e.to}|${sb}`
    if (!buckets.has(ka)) buckets.set(ka, [])
    if (!buckets.has(kb)) buckets.set(kb, [])
    buckets.get(ka).push(e.id + ':from')
    buckets.get(kb).push(e.id + ':to')
  })

  // Order each bucket by the other end's cross-axis position, so lanes do
  // not cross each other on the way out of a box.
  buckets.forEach((arr, key) => {
    const [nodeId] = key.split('|')
    arr.sort((p, q) => {
      const other = tag => {
        const [eid, end] = tag.split(':')
        const e = trace.edges.find(x => x.id === eid)
        const otherId = end === 'from' ? e.to : e.from
        const r = rects.get(otherId)
        return r ? (horiz ? r.y + r.h / 2 : r.x + r.w / 2) : 0
      }
      return other(p) - other(q)
    })
  })

  const laneT = (key, tag) => {
    const arr = buckets.get(key) || []
    const i = arr.indexOf(tag)
    return arr.length <= 1 ? 0.5 : (i + 1) / (arr.length + 1)
  }

  // ── route ──────────────────────────────────────────────────
  const obstacles = leaves.map(n => rects.get(n.id)).filter(Boolean)
  const edges = []
  trace.edges.forEach(e => {
    const a = rects.get(e.from), b = rects.get(e.to)
    if (!a || !b) return
    const [sa, sb] = sideOf.get(e.id)
    const p1 = portAt(a, sa, laneT(`${e.from}|${sa}`, e.id + ':from'))
    const p2 = portAt(b, sb, laneT(`${e.to}|${sb}`, e.id + ':to'))

    const others = obstacles.filter(r => r !== a && r !== b)
    let pts
    try {
      pts = routeOrtho({ x1: p1.x, y1: p1.y, d1: DIRV[sa], x2: p2.x, y2: p2.y, d2: DIRV[sb] }, others)
    } catch (_) { pts = null }
    if (!pts || pts.length < 2) pts = [p1, { x: (p1.x + p2.x) / 2, y: p1.y }, { x: (p1.x + p2.x) / 2, y: p2.y }, p2]

    edges.push({
      ...e,
      points: pts,
      path: polyToPath(pts),
      mid: labelAnchor(pts),
      end: { x: p2.x, y: p2.y, side: sb },
    })
  })

  // Labels are painted after the boxes, so one landing on a box hides part
  // of it. Slide it along its own segment until it clears, and leave it
  // where it was if nothing on that run is clear.
  nudgeLabels(edges, obstacles)

  // ── bounds ─────────────────────────────────────────────────
  let maxX = 0, maxY = 0
  rects.forEach(r => { maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h) })
  edges.forEach(e => e.points.forEach(p => { maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }))

  return {
    meta: trace.meta,
    width:  Math.round(maxX + OUTER),
    height: Math.round(maxY + OUTER),
    containers: ordered.slice().reverse().map(c => ({ ...c, rect: rects.get(c.id), depth: depthOf(c, byId) })),
    nodes: leaves.map(n => ({ ...n, rect: rects.get(n.id), box: boxes.get(n.id) })),
    edges,
  }
}
