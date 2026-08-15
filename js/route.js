// ════════════════════════════════════════════════════════════
//  route.js — Orthogonal connection routing that avoids blocks.
//
//  Pure geometry. No DOM, no app state, no imports — everything
//  it needs arrives as arguments, so it is directly testable and
//  can be swapped out without touching the rest of the canvas.
//
//  The approach is the one draw.io uses: rather than search a
//  pixel grid, build a sparse lattice from the coordinates that
//  matter (each obstacle's inflated edges, plus the two
//  endpoints) and run A* over that. A 40-block canvas produces a
//  lattice in the low hundreds of nodes, not tens of thousands.
// ════════════════════════════════════════════════════════════

export const ROUTE_DEFAULTS = {
  margin:      18,    // clearance kept around every obstacle
  stub:        22,    // straight run off a port before the first turn
  turnPenalty: 45,    // cost of a direction change, in pixels
  maxNodes:    5000,  // lattice budget; past this we decline to route
  corner:      9,     // rounded-corner radius in the emitted path
}

// ── Small geometry helpers ───────────────────────────────────

function inflate(r, m) {
  return { l: r.x - m, t: r.y - m, r: r.x + r.w + m, b: r.y + r.h + m }
}

// Strict containment. A point sitting exactly on an inflated edge
// is outside, which is what lets the lattice lines (which are
// placed on those edges) stay usable.
function inside(box, x, y) {
  return x > box.l && x < box.r && y > box.t && y < box.b
}

// Does an axis-aligned segment pass through a box? Endpoints that
// merely touch the boundary do not count, for the same reason.
function segmentHits(box, ax, ay, bx, by) {
  if (ay === by) {
    if (ay <= box.t || ay >= box.b) return false
    return Math.max(Math.min(ax, bx), box.l) < Math.min(Math.max(ax, bx), box.r)
  }
  if (ax <= box.l || ax >= box.r) return false
  return Math.max(Math.min(ay, by), box.t) < Math.min(Math.max(ay, by), box.b)
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

/** Turn an orthogonal polyline into an SVG path with rounded corners. */
export function polyToPath(points, radius = ROUTE_DEFAULTS.corner) {
  const pts = simplify(points)
  if (pts.length < 2) return ''
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`

  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1], cur = pts[i], next = pts[i + 1]
    const inLen  = Math.hypot(cur.x - prev.x, cur.y - prev.y)
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    if (r < 1) { d += ` L ${cur.x} ${cur.y}`; continue }
    const ax = cur.x + Math.sign(prev.x - cur.x) * r
    const ay = cur.y + Math.sign(prev.y - cur.y) * r
    const bx = cur.x + Math.sign(next.x - cur.x) * r
    const by = cur.y + Math.sign(next.y - cur.y) * r
    d += ` L ${ax.toFixed(2)} ${ay.toFixed(2)} Q ${cur.x} ${cur.y} ${bx.toFixed(2)} ${by.toFixed(2)}`
  }
  const last = pts[pts.length - 1]
  return d + ` L ${last.x} ${last.y}`
}

/** Point at the halfway mark along an orthogonal polyline. */
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

// ── The router ───────────────────────────────────────────────

/**
 * Route an orthogonal path between two ports, around obstacles.
 *
 * @param {{x1,y1,d1,x2,y2,d2}} pts  endpoints and their facing directions
 * @param {Array<{x,y,w,h}>} obstacles  blocks to avoid (endpoints excluded by the caller)
 * @param {object} [opts]  overrides for ROUTE_DEFAULTS
 * @returns {Array<{x,y}>|null}  polyline, or null when the caller should fall back
 */
export function routeOrtho(pts, obstacles = [], opts = {}) {
  const O = { ...ROUTE_DEFAULTS, ...opts }

  const start = { x: pts.x1, y: pts.y1 }
  const end   = { x: pts.x2, y: pts.y2 }
  const sStub = stepOut(start.x, start.y, pts.d1, O.stub)
  const eStub = stepOut(end.x,   end.y,   pts.d2, O.stub)

  // A block whose clearance zone already swallows one of the stubs cannot be
  // routed around: every edge in or out of that endpoint would be impassable
  // and the search would fail outright. Drop it and route around the rest.
  const boxes = obstacles
    .map(r => inflate(r, O.margin))
    .filter(b => !inside(b, sStub.x, sStub.y) && !inside(b, eStub.x, eStub.y))

  // Candidate lines: every obstacle edge (already inflated) plus the
  // stubs, plus the corridor midlines, which give the router a lane
  // to run between two boxes instead of around both.
  const xs = [sStub.x, eStub.x, (sStub.x + eStub.x) / 2]
  const ys = [sStub.y, eStub.y, (sStub.y + eStub.y) / 2]
  for (const b of boxes) { xs.push(b.l, b.r); ys.push(b.t, b.b) }
  const X = uniqSorted(xs), Y = uniqSorted(ys)

  if (X.length * Y.length > O.maxNodes) return null

  const W = X.length, H = Y.length
  const xi = new Map(X.map((v, i) => [v, i]))
  const yi = new Map(Y.map((v, i) => [v, i]))
  const sx = xi.get(Math.round(sStub.x * 100) / 100)
  const sy = yi.get(Math.round(sStub.y * 100) / 100)
  const ex = xi.get(Math.round(eStub.x * 100) / 100)
  const ey = yi.get(Math.round(eStub.y * 100) / 100)
  if (sx == null || sy == null || ex == null || ey == null) return null

  const startIdx = sy * W + sx
  const goalIdx  = ey * W + ex

  const blocked = new Uint8Array(W * H)
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const idx = j * W + i
      if (idx === startIdx || idx === goalIdx) continue
      for (const b of boxes) { if (inside(b, X[i], Y[j])) { blocked[idx] = 1; break } }
    }
  }

  const passable = (ax, ay, bx, by) => {
    for (const b of boxes) { if (segmentHits(b, ax, ay, bx, by)) return false }
    return true
  }

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
    const [, state] = pop()
    const node = state >> 2, dir = state & 3
    if (node === goalIdx) { goalState = state; break }
    const i = node % W, j = (node / W) | 0
    const g = best[state]
    if (!Number.isFinite(g)) continue

    for (let nd = 0; nd < 4; nd++) {
      const [dx, dy] = DIRS[nd]
      const ni = i + dx, nj = j + dy
      if (ni < 0 || ni >= W || nj < 0 || nj >= H) continue
      const nIdx = nj * W + ni
      if (blocked[nIdx]) continue
      if (!passable(X[i], Y[j], X[ni], Y[nj])) continue
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
