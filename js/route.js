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
  // Obstacles farther than this from the endpoints' box sit out. It is also
  // how far a route's dependence on the canvas reaches. The canvas passes a
  // smaller one (arrow-routes.js CANVAS_REACH); the trace tool keeps this.
  reach:       160,
  // Whether a path must also keep the margin from the obstacles that sat
  // out: one that passes nearer than that is searched again with them in
  // play. The canvas turns it on with its smaller reach, so the reach costs
  // no clearance. The trace tool leaves it off: its lines run inside
  // containers, and it keeps drawing what it drew.
  outerMargin: false,
  // Whether the search's estimate counts the turns a path still needs, not
  // only its length, with ties going to the cheaper path so far. The costs
  // found are the same and the search takes 60% fewer steps (a busy canvas's
  // routes, in about 60% of the time); among equal-cost paths about one
  // search in 200 picks another one. The canvas takes it; the trace tool
  // keeps the plain estimate and what it drew.
  turnBound: false,
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
 * Only obstacles near the endpoints take part in a search (`opts.reach`).
 * A path that then passes through one that sat out (or, with
 * `opts.outerMargin`, inside its margin) is searched again with more of
 * them in play, so a smaller reach costs speed on the odd long detour
 * rather than clearance.
 *
 * `opts.deps`, when given an array, receives every box whose obstacles the
 * answer depended on: the search box of each attempt, and the extent of
 * each path that was checked against the obstacles outside it (grown by
 * the margin, with outerMargin). A block that touches none of them, before
 * or after it moved, cannot change the result, which is what lets a caller
 * keep a route across an edit.
 *
 * @param {{x1,y1,d1,x2,y2,d2}} pts  endpoints and their facing directions
 * @param {Array<{x,y,w,h}>} obstacles  blocks to avoid
 * @param {object} [opts]  overrides for ROUTE_DEFAULTS, plus `deps`
 * @returns {Array<{x,y}>|null}  polyline, or null when the caller should fall back
 */
export function routeOrtho(pts, obstacles = [], opts = {}) {
  const O = { ...ROUTE_DEFAULTS, ...opts }
  const deps = Array.isArray(opts.deps) ? opts.deps : null
  const all = obstacles.filter(r => r && Number.isFinite(r.x) && Number.isFinite(r.y) && r.w > 0 && r.h > 0)

  let reach = O.reach
  for (let attempt = 0; attempt < 3; attempt++) {
    const near = Number.isFinite(reach) ? nearby(all, pts, reach) : all
    if (deps) deps.push(Number.isFinite(reach) ? reachBox(pts, reach) : EVERYWHERE)
    // A long connection across a big canvas meets a lot of blocks. Rather
    // than give up past the budget, snap obstacle edges to a coarser grid
    // (fewer distinct lines) and try again.
    let path = null
    for (const grid of [1, 20, 40]) {
      path = search(pts, near, O, grid)
      if (path !== TOO_BIG) break
    }
    if (!path || path === TOO_BIG) return null
    // Every obstacle outside the search box is tested against this path
    // (a block added out there is one of them), so the path's extent, as
    // far as a margin reaches, is a dependency even when nothing sits out
    // today.
    const m = O.outerMargin ? O.margin : 0
    if (deps) { const e = extent(path); deps.push({ l: e.l - m, t: e.t - m, r: e.r + m, b: e.b + m }) }
    if (near.length === all.length) return path
    // An obstacle that sat out may still lie on a long detour, or right
    // beside it, closer than the margin any obstacle in the search keeps.
    // Check, and search again with more of them in play when it does.
    const inSearch = new Set(near)
    const skipped = all.filter(r => !inSearch.has(r))
    if (!crossesAny(path, skipped, m)) return path
    reach = attempt === 0 ? reach * 4 : Infinity
  }
  return null
}

// A box that every rectangle touches: the answer depended on all of them.
export const EVERYWHERE = Object.freeze({ l: -Infinity, t: -Infinity, r: Infinity, b: Infinity })

// The box nearby() keeps obstacles from, as {l,t,r,b}.
function reachBox(pts, reach) {
  return { l: Math.min(pts.x1, pts.x2) - reach, r: Math.max(pts.x1, pts.x2) + reach,
           t: Math.min(pts.y1, pts.y2) - reach, b: Math.max(pts.y1, pts.y2) + reach }
}

// The bounding box of a list of points, as {l,t,r,b}.
export function extent(points) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
  for (const p of points) {
    if (p.x < l) l = p.x
    if (p.x > r) r = p.x
    if (p.y < t) t = p.y
    if (p.y > b) b = p.y
  }
  return { l, t, r, b }
}

/**
 * Does a rectangle {x,y,w,h} touch a box {l,t,r,b}? Edges count: this
 * answers "could this block have mattered", so it errs toward yes. The
 * router's own tests (nearby, a segment crossing a block) are strict, so
 * anything they see, this sees.
 */
export function rectTouchesBox(q, box) {
  return q.x <= box.r && q.x + q.w >= box.l && q.y <= box.b && q.y + q.h >= box.t
}

// Does the path pass through any of the rects, or nearer to one than `m`?
function crossesAny(points, rects, m = 0) {
  for (const r of rects) {
    const g = m ? { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m } : r
    for (let i = 1; i < points.length; i++) if (segmentCrossesRect(g, points[i - 1], points[i])) return true
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

// The turns a path still needs at least, by which way the goal lies across
// and down (-1, 0, 1 each) and the heading (right, left, down, up): none
// when heading straight at it, one when heading along either way that
// closes the gap, two when heading away.
const TURNS = new Int8Array(36)
for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) for (let d = 0; d < 4; d++) {
  const along = d < 2 ? gx === (d === 0 ? 1 : -1) : gy === (d === 2 ? 1 : -1)
  const t = gx === 0 && gy === 0 ? 0
    : gx === 0 ? (d < 2 ? 1 : along ? 0 : 2)
    : gy === 0 ? (d >= 2 ? 1 : along ? 0 : 2)
    : along ? 1 : 2
  TURNS[((gx + 1) * 3 + gy + 1) * 4 + d] = t
}

// Working arrays every search reuses, grown when a lattice needs more: a
// search on a big canvas allocated half a megabyte, and the collector's
// pauses landed in a drag release. Each search clears only what it uses.
let scratchN = 0, scratchBufs = null
let heapF = new Float64Array(1024), heapS = new Int32Array(1024)
function scratch(N) {
  if (N > scratchN) {
    scratchN = Math.max(N, scratchN * 2)
    scratchBufs = {
      blocked: new Uint8Array(scratchN), hBlocked: new Uint8Array(scratchN), vBlocked: new Uint8Array(scratchN),
      best: new Float64Array(scratchN * 4), cameFrom: new Int32Array(scratchN * 4),
    }
  }
  const b = scratchBufs
  b.blocked.fill(0, 0, N); b.hBlocked.fill(0, 0, N); b.vBlocked.fill(0, 0, N)
  b.best.fill(Infinity, 0, N * 4); b.cameFrom.fill(-1, 0, N * 4)
  return b
}

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
  const { blocked, hBlocked, vBlocked, best, cameFrom } = scratch(W * H)
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
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1]
  // The estimate never overstates what is left, so the first path to reach
  // the goal is a cheapest one. With turnBound it adds the turns still
  // needed from heading `d` (TURNS), and ties go to the state reached more
  // cheaply (`tie`), which keeps the answer the plain estimate gives almost
  // everywhere. The distance left along each axis, and which way the goal
  // lies, are worked out once per column and row.
  const ax = new Float64Array(W), wx = new Int8Array(W), ay = new Float64Array(H), wy = new Int8Array(H)
  for (let i = 0; i < W; i++) { const d = X[ex] - X[i]; ax[i] = Math.abs(d); wx[i] = Math.sign(d) }
  for (let j = 0; j < H; j++) { const d = Y[ey] - Y[j]; ay[j] = Math.abs(d); wy[j] = Math.sign(d) }
  const TP = O.turnPenalty
  const heur = O.turnBound ? (i, j, d) => ax[i] + ay[j] + TURNS[((wx[i] + 1) * 3 + wy[j] + 1) * 4 + d] * TP
    : (i, j) => ax[i] + ay[j]
  const tie = O.turnBound ? 1e-6 : 0

  // Binary heap keyed by f-score, in two typed arrays (score, state): an
  // array of [f, s] pairs made the garbage collector a fifth of a search.
  // Sifting moves a hole rather than swapping pairs; the comparisons are the
  // same ones in the same order, so entries leave in the same order.
  let size = 0
  let hf = heapF, hs = heapS
  const push = (f, s) => {
    if (size === hf.length) {
      const nf = new Float64Array(hf.length * 2); nf.set(hf); hf = heapF = nf
      const ns = new Int32Array(hs.length * 2); ns.set(hs); hs = heapS = ns
    }
    let c = size++
    while (c > 0) {
      const p = (c - 1) >> 1
      if (hf[p] <= f) break
      hf[c] = hf[p]; hs[c] = hs[p]; c = p
    }
    hf[c] = f; hs[c] = s
  }
  let topF = 0, topS = 0
  const pop = () => {
    topF = hf[0]; topS = hs[0]
    size--
    if (size > 0) {
      const lf = hf[size], ls = hs[size]
      let p = 0
      for (;;) {
        const l = 2*p + 1, r = l + 1
        let m = p, mf = lf
        if (l < size && hf[l] < mf) { m = l; mf = hf[l] }
        if (r < size && hf[r] < mf) { m = r; mf = hf[r] }
        if (m === p) break
        hf[p] = hf[m]; hs[p] = hs[m]; p = m
      }
      hf[p] = lf; hs[p] = ls
    }
  }

  // Seed with the direction the stub is already travelling, so leaving
  // the port along its facing is free and turning immediately is not.
  const seedDir = pts.d1 === 'right' ? 0 : pts.d1 === 'left' ? 1 : pts.d1 === 'bottom' ? 2 : 3
  best[startIdx * 4 + seedDir] = 0
  push(heur(sx, sy, seedDir), startIdx * 4 + seedDir)

  let goalState = -1
  while (size > 0) {
    pop()
    const f = topF, state = topS
    const node = state >> 2, dir = state & 3
    const g = best[state]
    if (f > g + heur(node % W, (node / W) | 0, dir) + tie * g + 1e-9) continue   // stale entry
    if (node === goalIdx) { goalState = state; break }
    const i = node % W, j = (node / W) | 0

    for (let nd = 0; nd < 4; nd++) {
      const dx = DX[nd], dy = DY[nd]
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
        push(cost + heur(ni, nj, nd) + tie * cost, nState)
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
 * `opts.memo` ({ prev, next }, two Maps) remembers where each cluster's runs
 * went, keyed by everything the choice reads: the runs in order, the legs
 * either side of them and the blocks near them. A later call with the
 * same memo reuses a choice whose inputs recur exactly, so after an edit
 * only the clusters it reached are placed again, and the result is the
 * one a call without the memo gives. Choices used go in `next`; the caller
 * swaps it for `prev` between calls, which keeps the memo to one pass.
 * `memo.placed` counts the clusters that had to be placed afresh.
 *
 * @param {Array<{id, points}>} routes
 * @param {Array<{x,y,w,h}>} rects  blocks the moved runs must stay out of
 * @returns {Array<{id, points}>} new point arrays (inputs are not mutated)
 */
export function separateRoutes(routes, rects = [], opts = {}) {
  const GAP = opts.gap ?? 10
  const MIN_END = opts.minEnd ?? 12
  const memo = opts.memo || null
  const out = routes.map(r => ({ ...r, points: r.points.map(p => ({ x: p.x, y: p.y })) }))
  const blocks = blockIndex(rects)

  // Spreading one cluster can crowd its neighbour, so repeat until nothing
  // moves. Twelve passes leave a third of the shared runs three passes did
  // (random 24-card canvases); a full pass stays near 20ms at 150 cards,
  // and resolveRoutes only separates when a route changed.
  for (let pass = 0; pass < 12; pass++) {
    let moved = shortenEndLegs(out, blocks, GAP, MIN_END)
    for (const vert of [true, false]) {
      const segs = collectSegments(out, vert)
      for (const comp of clusters(segs, GAP)) {
        if (placeCluster(comp, out, blocks, GAP, MIN_END, memo)) moved = true
      }
    }
    if (!moved) break
  }
  finishRuns(out, blocks, GAP, MIN_END)
  return out
}

// ── Which blocks a leg can meet ──────────────────────────────
// Separation asks thousands of times a call whether a leg crosses a block.
// A bucket grid over the blocks, built once per call, answers from the few
// blocks near that leg, and gives exactly the answers testing every block
// gives: a block a leg crosses shares a cell with it. A block whose box is
// not plain finite numbers is tested every time, as before.
function blockIndex(rects) {
  const n = rects.length
  const wide = []
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const ok = r => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h) && r.w >= 0 && r.h >= 0
  rects.forEach((r, i) => {
    if (!ok(r)) { wide.push(i); return }
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h)
  })
  // At most 128 cells a side, 256px each unless the blocks spread wider.
  const cell = Math.max(256, (x1 - x0) / 128, (y1 - y0) / 128) || 256
  const GW = x1 >= x0 ? Math.floor((x1 - x0) / cell) + 1 : 0
  const GH = y1 >= y0 ? Math.floor((y1 - y0) / cell) + 1 : 0
  const colOf = x => Math.floor((x - x0) / cell), rowOf = y => Math.floor((y - y0) / cell)
  // The cells' blocks in one flat array: cell k holds items[start[k]..start[k+1]).
  const start = new Int32Array(GW * GH + 1)
  const span = (r, f) => {
    for (let cx = colOf(r.x); cx <= colOf(r.x + r.w); cx++)
      for (let cy = rowOf(r.y); cy <= rowOf(r.y + r.h); cy++) f(cy * GW + cx)
  }
  rects.forEach(r => { if (ok(r)) span(r, k => start[k + 1]++) })
  for (let k = 0; k < GW * GH; k++) start[k + 1] += start[k]
  const items = new Int32Array(start[GW * GH]), fill = start.slice(0, GW * GH)
  rects.forEach((r, i) => { if (ok(r)) span(r, k => { items[fill[k]++] = i }) })

  const seen = new Int32Array(n), picked = new Int32Array(n)
  let visit = 0, pick = 0
  // Tests the leg a-b against the blocks that may meet it. mode 0: does it
  // cross any; 1: any of the picked ones; 2: how many it crosses.
  const scan = (a, b, mode) => {
    let k = 0
    for (const i of wide) {
      if (mode === 1 && picked[i] !== pick) continue
      if (segmentCrossesRect(rects[i], a, b)) { if (mode !== 2) return 1; k++ }
    }
    const cl = Math.max(0, colOf(Math.min(a.x, b.x))), cr = Math.min(GW - 1, colOf(Math.max(a.x, b.x)))
    const ct = Math.max(0, rowOf(Math.min(a.y, b.y))), cb = Math.min(GH - 1, rowOf(Math.max(a.y, b.y)))
    if (!(cl <= cr && ct <= cb)) {
      // Outside the grid, or not plain numbers: then no cell answers for
      // it, and every block is looked at.
      if (Number.isFinite(cl + cr + ct + cb)) return k
      for (let i = 0; i < n; i++) {
        if (!ok(rects[i]) || (mode === 1 && picked[i] !== pick)) continue
        if (segmentCrossesRect(rects[i], a, b)) { if (mode !== 2) return 1; k++ }
      }
      return k
    }
    visit++
    for (let cy = ct; cy <= cb; cy++)
      for (let cx = cl; cx <= cr; cx++) {
        const c = cy * GW + cx
        for (let q = start[c]; q < start[c + 1]; q++) {
          const i = items[q]
          if (seen[i] === visit) continue
          seen[i] = visit
          if (mode === 1 && picked[i] !== pick) continue
          if (segmentCrossesRect(rects[i], a, b)) { if (mode !== 2) return 1; k++ }
        }
      }
    return k
  }
  return {
    // The blocks overlapping the box, in their original order. They also
    // become the ones `crossesPicked` tests against.
    pickNear(l, t, r, b) {
      pick++
      const near = []
      for (let i = 0; i < n; i++) {
        const q = rects[i]
        if (q.x < r && q.x + q.w > l && q.y < b && q.y + q.h > t) { near.push(q); picked[i] = pick }
      }
      return near
    },
    crossesPicked: (a, b) => scan(a, b, 1) > 0,
    crossesAny: (a, b) => scan(a, b, 0) > 0,
    countCrossed: (a, b) => scan(a, b, 2),
  }
}

// ── After separation: fused runs and short jogs ──────────────
// Placing clusters one at a time can leave two runs on the very same line
// (a cluster spread into its neighbour on the last pass), and moving a run
// can leave the leg beside it a few pixels long. Both read as mistakes.
// This pass takes each one left and tries a few local moves, keeping one
// only when it makes that route better and nothing about it worse: no new
// card crossed, no leg made shorter than it was, no run brought nearer to
// another route's.
export const JOG = 18        // an interior leg shorter than this is a jog
const APART = 6              // runs nearer than this across read as one line
const SHARED = 8             // and sharing more than this along

function runOf(a, b) {
  const vert = a.x === b.x
  if (!vert && a.y !== b.y) return null
  const u1 = vert ? a.y : a.x, u2 = vert ? b.y : b.x
  return { vert, c: vert ? a.x : a.y, lo: Math.min(u1, u2), hi: Math.max(u1, u2) }
}

// Every route's runs, kept per route: a route that changes has its own
// runs worked out again, rather than every route's.
function runsBy(routes) {
  return routes.map((r, ri) => routeRuns(r.points, ri))
}
function routeRuns(p, ri) {
  const runs = []
  for (let i = 0; i < p.length - 1; i++) {
    if (p[i].x === p[i + 1].x && p[i].y === p[i + 1].y) continue
    const run = runOf(p[i], p[i + 1])
    if (run) runs.push({ ri, ...run })
  }
  return runs
}

// What is wrong with one route's polyline, against every other route's runs.
function faultsOf(points, ri, runs, blocks, minEnd) {
  const f = { cards: 0, jogs: 0, fused: 0, near: 0, ends: 0 }
  const n = points.length - 1
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[i + 1]
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    if (!len) continue
    if (i > 0 && i < n - 1 && len < JOG) f.jogs++
    if ((i === 0 || i === n - 1) && len < minEnd) f.ends++
    f.cards += blocks.countCrossed(a, b)
    const run = runOf(a, b); if (!run) continue
    for (let rj = 0; rj < runs.length; rj++) {
      if (rj === ri) continue
      for (const s of runs[rj]) {
        if (s.vert !== run.vert) continue
        const d = Math.abs(s.c - run.c)
        if (d >= APART || Math.min(run.hi, s.hi) - Math.max(run.lo, s.lo) <= SHARED) continue
        f.near++
        if (d < 1) f.fused++
      }
    }
  }
  return f
}

const noWorse = (after, before) => after.cards <= before.cards && after.jogs <= before.jogs &&
  after.fused <= before.fused && after.near <= before.near && after.ends <= before.ends

/**
 * Move the run points[i]..points[i+1] across to c. Each leg beside it keeps
 * its direction and at least the length it had (up to JOG inside the line,
 * minEnd at a port). `vanish` (-1 before, +1 after) lets that one leg shrink
 * to nothing, which folds a jog away. Null when the move breaks a leg.
 */
function movedRun(points, i, c, minEnd, vanish = 0) {
  const n = points.length - 1
  if (i <= 0 || i >= n - 1) return null            // port legs stay where the lane put them
  const vert = points[i].x === points[i + 1].x
  const axis = vert ? 'x' : 'y'
  const old = points[i][axis]
  if (c === old) return null
  for (const [k, far] of [[i - 1, points[i - 1][axis]], [i + 1, points[i + 2][axis]]]) {
    const before = old - far, after = c - far
    if (after === 0 && vanish === (k < i ? -1 : 1)) continue
    if (Math.sign(before) !== Math.sign(after)) return null
    const need = Math.min(k === 0 || k === n - 1 ? minEnd : JOG, Math.abs(before))
    if (Math.abs(after) < need) return null
  }
  const q = points.map(p => ({ x: p.x, y: p.y }))
  q[i][axis] = c; q[i + 1][axis] = c
  return simplify(q)
}

function finishRuns(routes, blocks, gap, minEnd) {
  const runs = runsBy(routes)
  const take = (ri, q) => { routes[ri].points = q; runs[ri] = routeRuns(q, ri) }
  // 1. Runs of two routes on the very same line: move one of them over.
  for (let round = 0; round < 3; round++) {
    let changed = false
    const pairs = []
    for (const vert of [true, false]) {
      const segs = collectSegments(routes, vert)
      for (let a = 0; a < segs.length; a++) {
        for (let b = a + 1; b < segs.length && segs[b].c - segs[a].c < 1; b++) {
          const s = segs[a], t = segs[b]
          if (s.ri !== t.ri && Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > SHARED) pairs.push([s, t])
        }
      }
    }
    for (const pair of pairs) {
      let best = null
      for (const s of pair) {
        if (s.fixed) continue
        const p = routes[s.ri].points
        // Earlier moves this round may have changed the route: find the run again.
        const i = p.findIndex((q, k) => k < p.length - 1 && runOf(q, p[k + 1])?.vert === s.vert &&
          (s.vert ? q.x : q.y) === s.c && Math.min(s.vert ? q.y : q.x, s.vert ? p[k + 1].y : p[k + 1].x) === s.lo)
        if (i < 0) continue
        const before = faultsOf(p, s.ri, runs, blocks, minEnd)
        if (!before.fused) continue
        for (const off of [gap, -gap, 2 * gap, -2 * gap, 3 * gap, -3 * gap]) {
          const q = movedRun(p, i, s.c + off, minEnd)
          if (!q) continue
          const after = faultsOf(q, s.ri, runs, blocks, minEnd)
          if (after.fused >= before.fused || !noWorse(after, before)) continue
          const score = after.fused * 1e6 + after.near * 1e3 + Math.abs(off)
          if (!best || score < best.score) best = { score, ri: s.ri, q }
        }
      }
      if (best) { take(best.ri, best.q); changed = true }
    }
    if (!changed) break
  }

  // 2. Short legs inside a line: fold the jog away by moving the run on one
  // side onto the other's line, or, failing that, stretch it to JOG.
  routes.forEach((r, ri) => {
    let from = 1
    for (let guard = 0; guard < 12; guard++) {
      const p = r.points, n = p.length - 1
      let j = -1
      for (let k = from; k < n - 1; k++) {
        const len = Math.abs(p[k + 1].x - p[k].x) + Math.abs(p[k + 1].y - p[k].y)
        if (len > 0 && len < JOG) { j = k; break }
      }
      if (j < 0) return
      const before = faultsOf(p, ri, runs, blocks, minEnd)
      const vert = p[j].x === p[j + 1].x         // the jog's own axis
      const axis = vert ? 'y' : 'x'               // the runs either side are across it
      const prev = p[j][axis], next = p[j + 1][axis]
      const dir = Math.sign(next - prev)
      const tries = [
        [j - 1, next, 1], [j + 1, prev, -1],      // fold: one run onto the other's line
        [j - 1, next - dir * JOG, 0], [j + 1, prev + dir * JOG, 0],   // stretch
      ]
      let done = false
      for (const [k, c, vanish] of tries) {
        const q = movedRun(p, k, c, minEnd, vanish)
        if (!q) continue
        const after = faultsOf(q, ri, runs, blocks, minEnd)
        if (after.jogs < before.jogs && noWorse({ ...after, jogs: before.jogs }, before)) {
          take(ri, q)
          done = true
          break
        }
      }
      // A jog that cannot go stays; look further along. After a change the
      // points were renumbered, so start again from the first leg.
      from = done ? 1 : j + 1
    }
  })
}

// Each route's runs along one axis, sorted by where they sit across it. With
// `portsOnly`, only the first and last legs: the same runs in the same order
// as filtering the full list, without building it.
function collectSegments(routes, vert, portsOnly = false) {
  const segs = []
  routes.forEach((r, ri) => {
    const p = r.points
    for (let i = 0; i < p.length - 1; i++) {
      if (portsOnly && i > 0 && i < p.length - 2) i = p.length - 2
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
// along may enter a block. `crosses(a, b)` says whether a leg enters one.
function feasible(routes, s, c, crosses, minEnd) {
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
    if (crosses(loc[k - 1], loc[k])) return false
  }
  return true
}

// Two port legs (neither can move sideways: the lane put them there) that
// run into each other at nearly the same height read as one line with a
// junction. Shorten one of them instead, by sliding the bend next to it
// back until the two stop overlapping, whichever needs the smaller move.
function shortenEndLegs(routes, blocks, gap, minEnd) {
  let changed = false
  for (const vert of [true, false]) {
    const segs = collectSegments(routes, vert, true)
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s = segs[i], t = segs[j]
        // Sorted by c, so every later run is at least as far off.
        if (t.c - s.c >= gap) break
        if (s.ri === t.ri) continue
        if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) <= 0) continue
        let best = null
        // Two gaps' clearance reads as two separate corners; one is the
        // least that still does.
        for (const clear of [gap * 2, gap]) {
          for (const [leg, other] of [[s, t], [t, s]]) {
            const move = shortening(routes, leg, other, clear)
            if (!move) continue
            if (!feasible(routes, move.seg, move.c, blocks.crossesAny, minEnd)) continue
            if (!best || Math.abs(move.c - move.seg.c) < Math.abs(best.c - best.seg.c)) best = move
          }
          if (best) break
        }
        if (!best) continue
        const p = routes[best.seg.ri].points, k = best.seg.i
        if (best.seg.vert) { p[k].x = best.c; p[k + 1].x = best.c } else { p[k].y = best.c; p[k + 1].y = best.c }
        changed = true
        return changed || shortenEndLegs(routes, blocks, gap, minEnd)
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

// Every ordering of 0..n-1, in a fixed order; built once per size.
const PERMS = new Map()
function permutations(n) {
  if (n <= 1) return [[0]]
  if (PERMS.has(n)) return PERMS.get(n)
  const out = []
  const rec = (pre, rest) => {
    if (!rest.length) { out.push(pre); return }
    rest.forEach((v, i) => rec([...pre, v], [...rest.slice(0, i), ...rest.slice(i + 1)]))
  }
  rec([], [...Array(n).keys()])
  PERMS.set(n, out)
  return out
}

// The blocks a cluster's runs could reach: moving k runs `gap` apart
// shifts none of them by more than k gaps, so anything farther away cannot
// be entered. Checking every block for every candidate ordering is what
// made separation cost 60ms on a 150-card canvas. They also become the
// blocks `blocks.crossesPicked` tests the cluster's moves against.
function nearRects(comp, routes, blocks, reach) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
  comp.forEach(s => {
    const p = routes[s.ri].points
    for (let k = Math.max(0, s.i - 1); k <= Math.min(p.length - 1, s.i + 2); k++) {
      l = Math.min(l, p[k].x); r = Math.max(r, p[k].x)
      t = Math.min(t, p[k].y); b = Math.max(b, p[k].y)
    }
  })
  l -= reach; t -= reach; r += reach; b += reach
  return blocks.pickNear(l, t, r, b)
}

// Everything choosePlaces reads, as a list of numbers: each run in order
// (its axis, place, whether it is a port leg or next to one) with the legs
// either side of it, then the blocks near the cluster. Numbers rather than
// a string: building and hashing the string was most of a cached lookup.
function clusterSig(comp, routes, near, gap, minEnd) {
  const sig = [gap, minEnd, comp.length]
  for (const s of comp) {
    const p = routes[s.ri].points
    const lo = Math.max(0, s.i - 1), hi = Math.min(p.length - 1, s.i + 2)
    sig.push((s.vert ? 1 : 0) + (s.fixed ? 2 : 0) + (s.i === 0 ? 4 : 0) + (s.i === 1 ? 8 : 0) +
      (s.i + 2 === p.length - 1 ? 16 : 0) + (s.i === p.length - 2 ? 32 : 0), s.c, hi - lo)
    for (let q = lo; q <= hi; q++) sig.push(p[q].x, p[q].y)
  }
  sig.push(near.length)
  for (const r of near) sig.push(r.x, r.y, r.w, r.h)
  return sig
}

function sigHash(sig) {
  let h = 0x811c9dc5
  for (const v of sig) h = Math.imul(h ^ ((v * 64) | 0), 16777619)
  return h >>> 0
}

const sameSig = (a, b) => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// The memo maps a signature's hash to the entries with that hash; a hit
// compares the whole signature, so a collision is only a miss.
function memoGet(map, h, sig) {
  const list = map.get(h)
  if (list) for (const e of list) if (sameSig(e.sig, sig)) return e
  return null
}
function memoPut(map, h, entry) {
  const list = map.get(h)
  if (!list) map.set(h, [entry])
  else if (!list.includes(entry)) list.push(entry)
}

function placeCluster(comp, routes, blocks, gap, minEnd, memo = null) {
  const fixed = comp.filter(s => s.fixed)
  if (fixed.length > 1) return false
  const near = nearRects(comp, routes, blocks, (comp.length + 1) * gap)
  let places = null
  if (memo) {
    const sig = clusterSig(comp, routes, near, gap, minEnd), h = sigHash(sig)
    const hit = memoGet(memo.next, h, sig) || memoGet(memo.prev, h, sig)
    if (!hit) memo.placed = (memo.placed || 0) + 1
    const entry = hit || { sig, places: choosePlaces(comp, routes, blocks.crossesPicked, gap, minEnd, fixed) }
    memoPut(memo.next, h, entry)
    places = entry.places
  } else {
    places = choosePlaces(comp, routes, blocks.crossesPicked, gap, minEnd, fixed)
  }

  let changed = false
  comp.forEach((s, m) => {
    const c = places[m]
    if (c === s.c) return
    const p = routes[s.ri].points
    if (s.vert) { p[s.i].x = c; p[s.i + 1].x = c } else { p[s.i].y = c; p[s.i + 1].y = c }
    s.c = c
    changed = true
  })
  return changed
}

// Where each run of a cluster goes: the ordering with the fewest refused
// moves, then the fewest crossings, then the least movement. Orderings share
// their places, so each run's candidate places are numbered, and whether a
// run can go to a place, and how two runs at two places cross, are each
// worked out once. The result is the one trying every ordering afresh gives.
function choosePlaces(comp, routes, crosses, gap, minEnd, fixed) {
  const k = comp.length
  const centre = Math.round(comp.reduce((sum, s) => sum + s.c, 0) / k)
  const vals = comp.map(() => [])          // run -> its places, by number
  const nums = comp.map(() => new Map())   // run -> place -> number
  const placeNo = (m, c) => {
    let n = nums[m].get(c)
    if (n === undefined) { n = vals[m].length; vals[m].push(c); nums[m].set(c, n) }
    return n
  }
  const ok = comp.map(() => [])
  const canMove = (m, n) => {
    let v = ok[m][n]
    if (v === undefined) { v = feasible(routes, comp[m], vals[m][n], crosses, minEnd); ok[m][n] = v }
    return v
  }
  const legs = comp.map(() => [])
  const legsAt = (m, n) => legs[m][n] || (legs[m][n] = localPath(routes, comp[m], vals[m][n]))
  const cross = new Map()
  const M = 1024
  const pairCross = (a, na, b, nb) => {
    const key = ((a * M + na) * k + b) * M + nb
    let v = cross.get(key)
    if (v === undefined) { v = crossings(legsAt(a, na), legsAt(b, nb)); cross.set(key, v) }
    return v
  }

  const own = comp.map((s, m) => placeNo(m, s.c))
  let best = null
  const at = new Array(k)

  // With no run pinned in place every ordering uses the same k slots, so
  // where each run lands at each slot, and how two runs at two slots cross,
  // go in flat tables and each ordering is only additions. Same scores,
  // same orderings in the same order, same winner as the general loop below.
  if (!fixed.length && k <= 6) {
    const kk = k * k
    const place = new Int32Array(kk), refused = new Uint8Array(kk), moved = new Float64Array(kk)
    for (let m = 0; m < k; m++) {
      for (let j = 0; j < k; j++) {
        const c = centre + Math.round((j - (k - 1) / 2) * gap)
        const n = placeNo(m, c)
        if (canMove(m, n)) { place[m * k + j] = n; moved[m * k + j] = Math.abs(c - comp[m].c) }
        else { place[m * k + j] = own[m]; refused[m * k + j] = 1 }
      }
    }
    const pc = new Int16Array(kk * kk).fill(-1)
    const slotOf = new Int32Array(k)
    for (const order of permutations(k)) {
      let bad = 0, shift = 0
      for (let j = 0; j < k; j++) {
        const m = order[j]
        slotOf[m] = j
        bad += refused[m * k + j]; shift += moved[m * k + j]
      }
      let score = bad * 1e6 + shift
      if (best && score >= best.score) continue
      for (let a = 0; a < k && (!best || score < best.score); a++) {
        const ia = a * k + slotOf[a]
        for (let b = a + 1; b < k; b++) {
          const ib = b * k + slotOf[b], key = ia * kk + ib
          let x = pc[key]
          if (x < 0) { x = crossings(legsAt(a, place[ia]), legsAt(b, place[ib])); pc[key] = x }
          score += x * 1e4
        }
      }
      if (!best || score < best.score) best = { score, at: [...slotOf].map((j, m) => place[m * k + j]) }
    }
    return best.at.map((n, m) => vals[m][n])
  }

  // Every ordering for a small cluster; above six, keep the current order.
  const orders = k <= 6 ? permutations(k) : [comp.map((_, i) => i).sort((a, b) => comp[a].c - comp[b].c)]
  for (const order of orders) {
    // Slot j sits at centre + (j - (k-1)/2) * gap, unless a fixed run is in
    // the cluster: then the slots shift so that run keeps its place.
    let base = centre
    const fi = fixed.length ? order.findIndex(m => comp[m].fixed) : -1
    if (fi >= 0) base = comp[order[fi]].c - Math.round((fi - (k - 1) / 2) * gap)
    let bad = 0, shift = 0
    for (let j = 0; j < k; j++) {
      const m = order[j]
      const c = base + Math.round((j - (k - 1) / 2) * gap)
      const n = placeNo(m, c)
      if (canMove(m, n)) { at[m] = n; shift += Math.abs(c - comp[m].c) }
      else { at[m] = own[m]; bad++ }
    }
    // No term of the score is negative, so an ordering whose partial score
    // already reaches the best cannot beat it (a tie keeps the first): stop
    // counting its crossings there.
    let score = bad * 1e6 + shift
    if (best && score >= best.score) continue
    for (let a = 0; a < k && (!best || score < best.score); a++) {
      for (let b = a + 1; b < k; b++) score += pairCross(a, at[a], b, at[b]) * 1e4
    }
    if (!best || score < best.score) best = { score, at: at.slice() }
  }
  return best.at.map((n, m) => vals[m][n])
}
