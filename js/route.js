// ════════════════════════════════════════════════════════════
//  route.js: orthogonal connection routing that avoids blocks.
//
//  Pure geometry. No DOM, no app state, no imports: everything
//  it needs arrives as arguments, so it is directly testable and
//  can be swapped out without touching the rest of the canvas.
//
//  The approach is the one draw.io uses: rather than search a
//  pixel grid, build a sparse lattice from the coordinates that
//  matter (each obstacle's inflated edges, plus the two
//  endpoints) and run A* over that. Only obstacles near the two
//  endpoints take part, so a 300-block canvas routes about as
//  fast as a 30-block one.
// ════════════════════════════════════════════════════════════

export const ROUTE_DEFAULTS = {
  margin:      18,     // clearance kept around every obstacle
  stub:        22,     // straight run off a port before the first turn
  turnPenalty: 45,     // cost of a direction change, in pixels
  maxNodes:    20000,  // lattice budget; past this we decline to route
  corner:      8,      // rounded-corner radius in the emitted path
  reach:       160,    // obstacles farther than this from the endpoints' box sit out
}

// ── Small geometry helpers ───────────────────────────────────

// Strict containment. A point sitting exactly on an inflated edge
// is outside, which is what lets the lattice lines (which are
// placed on those edges) stay usable.
function inside(box, x, y) {
  return x > box.l && x < box.r && y > box.t && y < box.b
}

// How far a point sits outside a rectangle along its worse axis. A point
// is inside the rectangle grown by m exactly when this is below m.
function clearance(r, x, y) {
  const dx = Math.max(r.x - x, x - (r.x + r.w), 0)
  const dy = Math.max(r.y - y, y - (r.y + r.h), 0)
  return Math.max(dx, dy)
}

// Does an axis-aligned segment pass through the interior of a rect?
// Touching the boundary does not count.
export function segmentCrossesRect(r, a, b) {
  const l = r.x, t = r.y, rr = r.x + r.w, bo = r.y + r.h
  if (a.y === b.y) {
    if (a.y <= t || a.y >= bo) return false
    return Math.max(Math.min(a.x, b.x), l) < Math.min(Math.max(a.x, b.x), rr)
  }
  if (a.x === b.x) {
    if (a.x <= l || a.x >= rr) return false
    return Math.max(Math.min(a.y, b.y), t) < Math.min(Math.max(a.y, b.y), bo)
  }
  // Diagonal (a sampled curve): test a few points along it.
  for (let s = 1; s < 8; s++) {
    const x = a.x + (b.x - a.x) * s / 8, y = a.y + (b.y - a.y) * s / 8
    if (x > l && x < rr && y > t && y < bo) return true
  }
  return false
}

function stepOut(x, y, dir, d) {
  return dir === 'right'  ? { x: x + d, y }
       : dir === 'left'   ? { x: x - d, y }
       : dir === 'bottom' ? { x, y: y + d }
       :                    { x, y: y - d }
}

function uniqSorted(values) {
  return [...new Set(values.map(v => Math.round(v * 100) / 100))].sort((a, b) => a - b)
}

// Two ports facing each other across a narrow gap: a full stub from each
// would overshoot the other and draw a zigzag, so both stubs meet halfway.
function stubLength(pts, stub) {
  const { x1, y1, d1, x2, y2, d2 } = pts
  let gap = Infinity
  if (d1 === 'right' && d2 === 'left' && x2 >= x1) gap = x2 - x1
  else if (d1 === 'left' && d2 === 'right' && x1 >= x2) gap = x1 - x2
  else if (d1 === 'bottom' && d2 === 'top' && y2 >= y1) gap = y2 - y1
  else if (d1 === 'top' && d2 === 'bottom' && y1 >= y2) gap = y1 - y2
  return gap < stub * 2 ? Math.max(0, Math.floor(gap / 2)) : stub
}

// ── Path emission ────────────────────────────────────────────

/** Drop points that sit on a straight run between their neighbours. */
export function simplify(points) {
  const out = []
  for (const p of points) {
    const n = out.length
    if (n >= 2) {
      const a = out[n - 2], b = out[n - 1]
      const straightX = a.x === b.x && b.x === p.x
      const straightY = a.y === b.y && b.y === p.y
      if (straightX || straightY) { out[n - 1] = p; continue }
    }
    if (n && out[n - 1].x === p.x && out[n - 1].y === p.y) continue
    out.push(p)
  }
  return out
}

/**
 * Turn an orthogonal polyline into an SVG path with rounded corners.
 * The radius is a whole number so every coordinate in the path is too:
 * half-pixel corners were what drew the faint jogs.
 */
export function polyToPath(points, radius = ROUTE_DEFAULTS.corner) {
  const pts = simplify(points)
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`

  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1]
    const inLen  = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.floor(Math.min(radius, inLen / 2, outLen / 2))
    if (r < 1) { d += ` L ${cur.x} ${cur.y}`; continue }
    const ax = cur.x + Math.sign(prev.x - cur.x) * r
    const ay = cur.y + Math.sign(prev.y - cur.y) * r
    const bx = cur.x + Math.sign(next.x - cur.x) * r
    const by = cur.y + Math.sign(next.y - cur.y) * r
    d += ` L ${ax} ${ay} Q ${cur.x} ${cur.y} ${bx} ${by}`
  }
  const last = pts[pts.length - 1]
  return d + ` L ${last.x} ${last.y}`
}

/** Point at the halfway mark along a polyline. */
export function polyMidpoint(points) {
  const pts = simplify(points)
  if (!pts.length) return { x: 0, y: 0 }
  if (pts.length === 1) return { ...pts[0] }
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y)
  let walked = 0
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y)
    if (walked + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - walked) / seg
      return { x: pts[i-1].x + (pts[i].x - pts[i-1].x) * t, y: pts[i-1].y + (pts[i].y - pts[i-1].y) * t }
    }
    walked += seg
  }
  return { ...pts[pts.length - 1] }
}

/**
 * Where a label belongs on a polyline: the middle of its longest straight
 * run, so it never sits on a corner. A very short route falls back to the
 * halfway point along the path. Returns the unit direction of that run too,
 * for sliding the label along it or off to one side.
 */
export function labelAnchor(points) {
  const pts = simplify(points || [])
  if (pts.length < 2) return { ...(pts[0] || { x: 0, y: 0 }), ux: 1, uy: 0, len: 0 }
  let best = null, bestLen = -1
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > bestLen) {
      bestLen = len
      best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, ux: (b.x - a.x) / (len || 1), uy: (b.y - a.y) / (len || 1), len }
    }
  }
  if (bestLen < 34) return { ...polyMidpoint(pts), ux: best.ux, uy: best.uy, len: bestLen }
  return best
}

// ── The router ───────────────────────────────────────────────

/**
 * Route an orthogonal path between two ports, around obstacles.
 *
 * Obstacles may include the two endpoint blocks themselves: the stub carries
 * the line out of its own block, and past the stub the block is as solid as
 * any other, so a pinned side facing away from the target goes around it.
 *
 * @param {{x1,y1,d1,x2,y2,d2}} pts  endpoints and their facing directions
 * @param {Array<{x,y,w,h}>} obstacles  blocks to avoid
 * @param {object} [opts]  overrides for ROUTE_DEFAULTS
 * @returns {Array<{x,y}>|null}  polyline, or null when the caller should fall back
 */
export function routeOrtho(pts, obstacles = [], opts = {}) {
  const O = { ...ROUTE_DEFAULTS, ...opts }
  const all = obstacles.filter(r => r && Number.isFinite(r.x) && Number.isFinite(r.y) && r.w > 0 && r.h > 0)

  let reach = O.reach
  for (let attempt = 0; attempt < 3; attempt++) {
    const near = Number.isFinite(reach) ? nearby(all, pts, reach) : all
    // A long connection across a big canvas meets a lot of blocks. Rather
    // than give up past the budget, snap obstacle edges to a coarser grid
    // (fewer distinct lines) and try again.
    let path = null
    for (const grid of [1, 20, 40]) {
      path = search(pts, near, O, grid)
      if (path !== TOO_BIG) break
    }
    if (!path || path === TOO_BIG) return null
    if (near.length === all.length) return path
    // An obstacle that sat out may still lie on a long detour. Check, and
    // search again with everything in play when it does.
    const skipped = all.filter(r => !near.includes(r))
    if (!crossesAny(path, skipped)) return path
    reach = attempt === 0 ? reach * 4 : Infinity
  }
  return null
}

function crossesAny(points, rects) {
  for (let i = 1; i < points.length; i++) {
    for (const r of rects) if (segmentCrossesRect(r, points[i - 1], points[i])) return true
  }
  return false
}

// Obstacles overlapping the endpoints' bounding box grown by `reach`.
function nearby(rects, pts, reach) {
  const l = Math.min(pts.x1, pts.x2) - reach, r = Math.max(pts.x1, pts.x2) + reach
  const t = Math.min(pts.y1, pts.y2) - reach, b = Math.max(pts.y1, pts.y2) + reach
  return rects.filter(o => o.x < r && o.x + o.w > l && o.y < b && o.y + o.h > t)
}

const TOO_BIG = Symbol('too big')

function search(pts, obstacles, O, grid = 1) {
  const start = { x: pts.x1, y: pts.y1 }
  const end   = { x: pts.x2, y: pts.y2 }
  const stub  = stubLength(pts, O.stub)
  const sStub = stepOut(start.x, start.y, pts.d1, stub)
  const eStub = stepOut(end.x,   end.y,   pts.d2, stub)

  // Each obstacle keeps as much of its clearance as it can. When a stub
  // lands inside that clearance (two blocks closer than stub + margin), the
  // clearance shrinks to fit rather than the block vanishing from the
  // search, which is how a line used to cut straight through a neighbour.
  // Edges are whole pixels, rounded outward.
  const boxes = []
  for (const r of obstacles) {
    const room = Math.min(clearance(r, sStub.x, sStub.y), clearance(r, eStub.x, eStub.y))
    if (room <= 0) continue          // a stub inside the block itself: nothing to route around
    const m = Math.min(O.margin, room)
    const box = {
      l: Math.floor(r.x - m), t: Math.floor(r.y - m),
      r: Math.ceil(r.x + r.w + m), b: Math.ceil(r.y + r.h + m),
    }
    if (inside(box, sStub.x, sStub.y) || inside(box, eStub.x, eStub.y)) continue
    if (grid > 1) {
      // Nearest grid line, which moves an edge at most grid/2: with the
      // full margin that still clears the block. A snapped box that would
      // swallow a stub keeps its exact edges.
      const snapped = {
        l: Math.min(Math.round(box.l / grid) * grid, Math.floor(r.x) - 2),
        t: Math.min(Math.round(box.t / grid) * grid, Math.floor(r.y) - 2),
        r: Math.max(Math.round(box.r / grid) * grid, Math.ceil(r.x + r.w) + 2),
        b: Math.max(Math.round(box.b / grid) * grid, Math.ceil(r.y + r.h) + 2),
      }
      if (!inside(snapped, sStub.x, sStub.y) && !inside(snapped, eStub.x, eStub.y)) { boxes.push(snapped); continue }
    }
    boxes.push(box)
  }

  // Candidate lines: every obstacle edge plus the stubs, plus the corridor
  // midlines, which give the router a lane to run between two boxes
  // instead of around both.
  const xs = [sStub.x, eStub.x, Math.round((sStub.x + eStub.x) / 2)]
  const ys = [sStub.y, eStub.y, Math.round((sStub.y + eStub.y) / 2)]
  for (const b of boxes) { xs.push(b.l, b.r); ys.push(b.t, b.b) }
  const X = uniqSorted(xs), Y = uniqSorted(ys)

  if (X.length * Y.length > O.maxNodes) return TOO_BIG

  const W = X.length, H = Y.length
  const xi = new Map(X.map((v, i) => [v, i]))
  const yi = new Map(Y.map((v, i) => [v, i]))
  const key = v => Math.round(v * 100) / 100
  const sx = xi.get(key(sStub.x)), sy = yi.get(key(sStub.y))
  const ex = xi.get(key(eStub.x)), ey = yi.get(key(eStub.y))
  if (sx == null || sy == null || ex == null || ey == null) return null

  const startIdx = sy * W + sx
  const goalIdx  = ey * W + ex

  // Blocked nodes and lattice edges, marked box by box. Every box edge is a
  // lattice line, so a box covers a clean index range and an edge between
  // two neighbouring nodes is either wholly inside a box or wholly out.
  const blocked = new Uint8Array(W * H)
  const hBlocked = new Uint8Array(W * H)   // edge (i,j) -> (i+1,j)
  const vBlocked = new Uint8Array(W * H)   // edge (i,j) -> (i,j+1)
  for (const b of boxes) {
    const il = xi.get(key(b.l)), ir = xi.get(key(b.r))
    const jt = yi.get(key(b.t)), jb = yi.get(key(b.b))
    for (let j = jt + 1; j < jb; j++) {
      for (let i = il; i < ir; i++) hBlocked[j * W + i] = 1
      for (let i = il + 1; i < ir; i++) blocked[j * W + i] = 1
    }
    for (let i = il + 1; i < ir; i++) {
      for (let j = jt; j < jb; j++) vBlocked[j * W + i] = 1
    }
  }
  blocked[startIdx] = 0
  blocked[goalIdx] = 0

  // A* over the lattice. State is (node, incoming direction), because
  // the turn penalty makes cost path-dependent; four directions per
  // node keeps that exact without exploding the search space.
  const DIRS = [[1,0],[-1,0],[0,1],[0,-1]]
  const N = W * H
  const best = new Float64Array(N * 4).fill(Infinity)
  const cameFrom = new Int32Array(N * 4).fill(-1)
  const heur = (i, j) => Math.abs(X[i] - X[ex]) + Math.abs(Y[j] - Y[ey])

  // Binary heap keyed by f-score.
  const heap = []
  const push = (f, s) => {
    heap.push([f, s])
    let c = heap.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      if (heap[p][0] <= heap[c][0]) break
      const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p
    }
  }
  const pop = () => {
    const top = heap[0], last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let p = 0
      for (;;) {
        const l = 2*p + 1, r = l + 1
        let m = p
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === p) break
        const t = heap[m]; heap[m] = heap[p]; heap[p] = t; p = m
      }
    }
    return top
  }

  // Seed with the direction the stub is already travelling, so leaving
  // the port along its facing is free and turning immediately is not.
  const seedDir = pts.d1 === 'right' ? 0 : pts.d1 === 'left' ? 1 : pts.d1 === 'bottom' ? 2 : 3
  best[startIdx * 4 + seedDir] = 0
  push(heur(sx, sy), startIdx * 4 + seedDir)

  let goalState = -1
  while (heap.length) {
    const [f, state] = pop()
    const node = state >> 2, dir = state & 3
    const g = best[state]
    if (f > g + heur(node % W, (node / W) | 0) + 1e-9) continue   // stale entry
    if (node === goalIdx) { goalState = state; break }
    const i = node % W, j = (node / W) | 0

    for (let nd = 0; nd < 4; nd++) {
      const [dx, dy] = DIRS[nd]
      const ni = i + dx, nj = j + dy
      if (ni < 0 || ni >= W || nj < 0 || nj >= H) continue
      const nIdx = nj * W + ni
      if (blocked[nIdx]) continue
      if (dy === 0 ? hBlocked[j * W + Math.min(i, ni)] : vBlocked[Math.min(j, nj) * W + i]) continue
      const step = Math.abs(X[ni] - X[i]) + Math.abs(Y[nj] - Y[j])
      const cost = g + step + (nd === dir ? 0 : O.turnPenalty)
      const nState = nIdx * 4 + nd
      if (cost < best[nState]) {
        best[nState] = cost
        cameFrom[nState] = state
        push(cost + heur(ni, nj), nState)
      }
    }
  }

  if (goalState < 0) return null

  const lattice = []
  for (let s = goalState; s >= 0; s = cameFrom[s]) {
    const node = s >> 2
    lattice.push({ x: X[node % W], y: Y[(node / W) | 0] })
    if ((s >> 2) === startIdx) break
  }
  lattice.reverse()

  return simplify([start, ...lattice, end])
}

// ── Separating routes that share a corridor ──────────────────

/**
 * Pull apart collinear runs that different routes share.
 *
 * Every route is found on its own, so three arrows into one card happily
 * pick the same trunk and fuse into one thick line. This pass finds runs
 * closer than `gap` that overlap, and spreads each cluster `gap` apart,
 * choosing the order that crosses least. A run attached to a port (the
 * first and last leg) stays where its lane put it; a leg next to a port
 * keeps at least `minEnd` so the arrowhead never lands on a corner. Moves
 * that would take a line through a block are not made.
 *
 * @param {Array<{id, points}>} routes
 * @param {Array<{x,y,w,h}>} rects  blocks the moved runs must stay out of
 * @returns {Array<{id, points}>} new point arrays (inputs are not mutated)
 */
export function separateRoutes(routes, rects = [], opts = {}) {
  const GAP = opts.gap ?? 10
  const MIN_END = opts.minEnd ?? 12
  const out = routes.map(r => ({ ...r, points: r.points.map(p => ({ x: p.x, y: p.y })) }))

  // Spreading one cluster can crowd its neighbour, so repeat until nothing
  // moves. Twelve passes leave a third of the shared runs three passes did
  // (random 24-card canvases); a full pass stays near 20ms at 150 cards,
  // and resolveRoutes only separates when a route changed.
  for (let pass = 0; pass < 12; pass++) {
    let moved = shortenEndLegs(out, rects, GAP, MIN_END)
    for (const vert of [true, false]) {
      const segs = collectSegments(out, vert)
      for (const comp of clusters(segs, GAP)) {
        if (placeCluster(comp, out, rects, GAP, MIN_END)) moved = true
      }
    }
    if (!moved) break
  }
  return out
}

function collectSegments(routes, vert) {
  const segs = []
  routes.forEach((r, ri) => {
    const p = r.points
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1]
      if (vert ? a.x !== b.x : a.y !== b.y) continue
      if (a.x === b.x && a.y === b.y) continue
      const c = vert ? a.x : a.y
      const u1 = vert ? a.y : a.x, u2 = vert ? b.y : b.x
      segs.push({ ri, i, vert, c, lo: Math.min(u1, u2), hi: Math.max(u1, u2),
                  fixed: i === 0 || i === p.length - 2 })
    }
  })
  return segs.sort((s, t) => s.c - t.c)
}

// Connected groups of runs that are too close: nearer than `gap` across,
// overlapping along. Runs of the same route never pair with each other.
function clusters(segs, gap) {
  const parent = segs.map((_, i) => i)
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length && segs[j].c - segs[i].c < gap; j++) {
      const s = segs[i], t = segs[j]
      if (s.ri === t.ri) continue
      if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) <= 2) continue
      parent[find(i)] = find(j)
    }
  }
  const groups = new Map()
  segs.forEach((s, i) => {
    const k = find(i)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(s)
  })
  return [...groups.values()].filter(g => g.length > 1 && new Set(g.map(s => s.ri)).size > 1)
}

// The legs either side of a run, with the run moved to coordinate c.
function localPath(routes, s, c) {
  const p = routes[s.ri].points
  const pts = []
  for (let k = Math.max(0, s.i - 1); k <= Math.min(p.length - 1, s.i + 2); k++) {
    const q = { x: p[k].x, y: p[k].y }
    if (k === s.i || k === s.i + 1) { if (s.vert) q.x = c; else q.y = c }
    pts.push(q)
  }
  return pts
}

// Can this run move to c? Its neighbours must keep their direction and
// length (the legs at the ports at least minEnd), and nothing it drags
// along may enter a block.
function feasible(routes, s, c, rects, minEnd) {
  if (c === s.c) return true
  if (s.fixed) return false
  const p = routes[s.ri].points
  const axis = s.vert ? 'x' : 'y'
  const legOk = (k, isEnd) => {
    const far = p[k][axis]
    const before = s.c - far, after = c - far
    if (Math.sign(before) !== Math.sign(after)) return false
    return Math.abs(after) >= (isEnd ? minEnd : 1)
  }
  if (!legOk(s.i - 1, s.i - 1 === 0)) return false
  if (!legOk(s.i + 2, s.i + 2 === p.length - 1)) return false
  const loc = localPath(routes, s, c)
  for (let k = 1; k < loc.length; k++) {
    for (const r of rects) if (segmentCrossesRect(r, loc[k - 1], loc[k])) return false
  }
  return true
}

// Two port legs (neither can move sideways: the lane put them there) that
// run into each other at nearly the same height read as one line with a
// junction. Shorten one of them instead, by sliding the bend next to it
// back until the two stop overlapping, whichever needs the smaller move.
function shortenEndLegs(routes, rects, gap, minEnd) {
  let changed = false
  for (const vert of [true, false]) {
    const segs = collectSegments(routes, vert).filter(s => s.fixed)
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s = segs[i], t = segs[j]
        if (s.ri === t.ri || Math.abs(s.c - t.c) >= gap) continue
        if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) <= 0) continue
        let best = null
        // Two gaps' clearance reads as two separate corners; one is the
        // least that still does.
        for (const clear of [gap * 2, gap]) {
          for (const [leg, other] of [[s, t], [t, s]]) {
            const move = shortening(routes, leg, other, clear)
            if (!move) continue
            if (!feasible(routes, move.seg, move.c, rects, minEnd)) continue
            if (!best || Math.abs(move.c - move.seg.c) < Math.abs(best.c - best.seg.c)) best = move
          }
          if (best) break
        }
        if (!best) continue
        const p = routes[best.seg.ri].points, k = best.seg.i
        if (best.seg.vert) { p[k].x = best.c; p[k + 1].x = best.c } else { p[k].y = best.c; p[k + 1].y = best.c }
        changed = true
        return changed || shortenEndLegs(routes, rects, gap, minEnd)
      }
    }
  }
  return changed
}

// The bend next to a port leg, and where it must go for that leg to end
// `gap` short of the other run. Null for a leg with no bend to move.
function shortening(routes, leg, other, gap) {
  const p = routes[leg.ri].points
  if (p.length < 4) return null
  const first = leg.i === 0
  const k = first ? 1 : leg.i - 1                 // the neighbouring run
  const port = first ? p[0] : p[p.length - 1]
  const along = leg.vert ? 'y' : 'x'
  const portAt = port[along]
  // The leg grows from the port toward the other run; stop it short of it.
  const c = portAt <= (leg.lo + leg.hi) / 2 ? other.lo - gap : other.hi + gap
  const a = p[k], b = p[k + 1]
  const nVert = a.x === b.x
  if (nVert === leg.vert) return null
  const seg = { ri: leg.ri, i: k, vert: nVert, c: nVert ? a.x : a.y,
                fixed: k === 0 || k === p.length - 2 }
  return { seg, c: Math.round(c) }
}

function crossings(a, b) {
  let n = 0
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) if (orthoCross(a[i - 1], a[i], b[j - 1], b[j])) n++
  }
  return n
}

function orthoCross(p1, p2, q1, q2) {
  const pv = p1.x === p2.x, qv = q1.x === q2.x
  if (pv === qv) return false
  const [v1, v2, h1, h2] = pv ? [p1, p2, q1, q2] : [q1, q2, p1, p2]
  const x = v1.x, y = h1.y
  return x > Math.min(h1.x, h2.x) && x < Math.max(h1.x, h2.x) &&
         y > Math.min(v1.y, v2.y) && y < Math.max(v1.y, v2.y)
}

function permutations(n) {
  if (n <= 1) return [[0]]
  const out = []
  const rec = (pre, rest) => {
    if (!rest.length) { out.push(pre); return }
    rest.forEach((v, i) => rec([...pre, v], [...rest.slice(0, i), ...rest.slice(i + 1)]))
  }
  rec([], [...Array(n).keys()])
  return out
}

// The blocks a cluster's runs could reach: moving k runs `gap` apart
// shifts none of them by more than k gaps, so anything farther away cannot
// be entered. Checking every block for every candidate ordering is what
// made separation cost 60ms on a 150-card canvas.
function nearRects(comp, routes, rects, reach) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
  comp.forEach(s => {
    const p = routes[s.ri].points
    for (let k = Math.max(0, s.i - 1); k <= Math.min(p.length - 1, s.i + 2); k++) {
      l = Math.min(l, p[k].x); r = Math.max(r, p[k].x)
      t = Math.min(t, p[k].y); b = Math.max(b, p[k].y)
    }
  })
  l -= reach; t -= reach; r += reach; b += reach
  return rects.filter(q => q.x < r && q.x + q.w > l && q.y < b && q.y + q.h > t)
}

function placeCluster(comp, routes, rects, gap, minEnd) {
  const k = comp.length
  const fixed = comp.filter(s => s.fixed)
  if (fixed.length > 1) return false
  const centre = Math.round(comp.reduce((sum, s) => sum + s.c, 0) / k)
  const near = nearRects(comp, routes, rects, (k + 1) * gap)
  // Orderings share their slots, so each (run, slot) pair is checked once.
  const memo = new Map()
  const canMove = (m, c) => {
    const key = m + ':' + c
    if (!memo.has(key)) memo.set(key, feasible(routes, comp[m], c, near, minEnd))
    return memo.get(key)
  }

  // Every ordering for a small cluster; above six, keep the current order.
  const orders = k <= 6 ? permutations(k) : [comp.map((_, i) => i).sort((a, b) => comp[a].c - comp[b].c)]
  let best = null
  for (const order of orders) {
    // Slot j sits at centre + (j - (k-1)/2) * gap, unless a fixed run is in
    // the cluster: then the slots shift so that run keeps its place.
    let base = centre
    const fi = fixed.length ? order.findIndex(m => comp[m].fixed) : -1
    if (fi >= 0) base = comp[order[fi]].c - Math.round((fi - (k - 1) / 2) * gap)
    const slot = order.map((m, j) => ({ m, c: base + Math.round((j - (k - 1) / 2) * gap) }))
    let bad = 0, shift = 0
    const at = new Map()
    slot.forEach(({ m, c }) => {
      const s = comp[m]
      if (canMove(m, c)) { at.set(m, c); shift += Math.abs(c - s.c) }
      else { at.set(m, s.c); bad++ }
    })
    // A worse count of refused moves cannot win on crossings: skip the count.
    if (best && bad * 1e6 > best.score) continue
    const locals = comp.map((s, m) => localPath(routes, s, at.get(m)))
    let cross = 0
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) cross += crossings(locals[a], locals[b])
    const score = bad * 1e6 + cross * 1e4 + shift
    if (!best || score < best.score) best = { score, at }
  }

  let changed = false
  comp.forEach((s, m) => {
    const c = best.at.get(m)
    if (c === s.c) return
    const p = routes[s.ri].points
    if (s.vert) { p[s.i].x = c; p[s.i + 1].x = c } else { p[s.i].y = c; p[s.i + 1].y = c }
    s.c = c
    changed = true
  })
  return changed
}
