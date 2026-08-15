// ============================================================
//  route.test.js -- Tests for js/route.js (orthogonal router)
//
//  The contract that matters: a routed path never passes through
//  a block. Everything else is shape and economy.
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { routeOrtho, polyToPath, polyMidpoint, simplify, ROUTE_DEFAULTS } from '../js/route.js'

// Does an axis-aligned segment pass through a rect? Written independently of
// the router's own copy so a bug in that helper cannot hide itself.
function crosses(rect, a, b) {
  const l = rect.x, t = rect.y, r = rect.x + rect.w, bo = rect.y + rect.h
  if (a.y === b.y) {
    if (a.y <= t || a.y >= bo) return false
    return Math.max(Math.min(a.x, b.x), l) < Math.min(Math.max(a.x, b.x), r)
  }
  if (a.x <= l || a.x >= r) return false
  return Math.max(Math.min(a.y, b.y), t) < Math.min(Math.max(a.y, b.y), bo)
}

function pathCrossesAny(points, rects) {
  for (let i = 1; i < points.length; i++) {
    for (const rc of rects) if (crosses(rc, points[i - 1], points[i])) return true
  }
  return false
}

function isOrthogonal(points) {
  for (let i = 1; i < points.length; i++) {
    if (points[i].x !== points[i - 1].x && points[i].y !== points[i - 1].y) return false
  }
  return true
}

describe('routeOrtho() -- clear ground', () => {
  it('runs straight when nothing is in the way', () => {
    const p = routeOrtho({ x1: 0, y1: 50, d1: 'right', x2: 400, y2: 50, d2: 'left' }, [])
    assert.deepEq(p, [{ x: 0, y: 50 }, { x: 400, y: 50 }])
  })

  it('produces an axis-aligned polyline for an offset target', () => {
    const p = routeOrtho({ x1: 0, y1: 0, d1: 'right', x2: 300, y2: 200, d2: 'left' }, [])
    assert.ok(p, 'expected a route')
    assert.ok(isOrthogonal(p), 'every segment should be horizontal or vertical')
  })

  it('starts and ends exactly on the given ports', () => {
    const p = routeOrtho({ x1: 10, y1: 20, d1: 'right', x2: 310, y2: 220, d2: 'left' }, [])
    assert.eq(p[0].x, 10); assert.eq(p[0].y, 20)
    assert.eq(p[p.length - 1].x, 310); assert.eq(p[p.length - 1].y, 220)
  })
})

describe('routeOrtho() -- obstacles', () => {
  it('steers around a block sitting on the direct line', () => {
    const obs = [{ x: 150, y: 0, w: 100, h: 100 }]
    const p = routeOrtho({ x1: 0, y1: 50, d1: 'right', x2: 400, y2: 50, d2: 'left' }, obs)
    assert.ok(p, 'expected a route')
    assert.ok(!pathCrossesAny(p, obs), 'route should not pass through the block')
    assert.ok(p.length > 2, 'a detour needs at least one bend')
  })

  it('keeps clear of a corridor of blocks', () => {
    const obs = [
      { x: 150, y: -40, w: 90, h: 120 },
      { x: 150, y: 120, w: 90, h: 120 },
      { x: 300, y: 20,  w: 90, h: 120 },
    ]
    const p = routeOrtho({ x1: 0, y1: 90, d1: 'right', x2: 520, y2: 90, d2: 'left' }, obs)
    assert.ok(p, 'expected a route')
    assert.ok(!pathCrossesAny(p, obs), 'route should not pass through any block')
    assert.ok(isOrthogonal(p), 'route should stay axis-aligned')
  })

  it('ignores a block that already swallows an endpoint stub', () => {
    // Nothing can be routed around here: the target sits inside the obstacle's
    // clearance. Declining would leave the arrow undrawn, so the router drops
    // that obstacle rather than failing.
    const obs = [{ x: 380, y: 20, w: 100, h: 80 }]
    const p = routeOrtho({ x1: 0, y1: 60, d1: 'right', x2: 390, y2: 60, d2: 'left' }, obs)
    assert.ok(p, 'expected a route even with the target inside an obstacle margin')
  })

  it('declines rather than churning when the lattice would be huge', () => {
    const obs = []
    for (let i = 0; i < 120; i++) obs.push({ x: i * 40, y: i * 30, w: 60, h: 40 })
    const p = routeOrtho({ x1: 0, y1: 0, d1: 'right', x2: 5000, y2: 4000, d2: 'left' }, obs, { maxNodes: 400 })
    assert.eq(p, null)
  })
})

describe('simplify()', () => {
  it('drops points on a straight run', () => {
    const p = simplify([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])
    assert.eq(p.length, 2)
  })

  it('drops exact duplicates', () => {
    const p = simplify([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }])
    assert.eq(p.length, 2)
  })

  it('keeps corners', () => {
    const p = simplify([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])
    assert.eq(p.length, 3)
  })
})

describe('polyToPath()', () => {
  it('emits a plain line for two points', () => {
    assert.eq(polyToPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]), 'M 0 0 L 10 0')
  })

  it('rounds corners with a quadratic', () => {
    const d = polyToPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
    assert.match(d, /^M\s/)
    assert.includes(d, 'Q')
  })

  it('returns an empty string for a degenerate polyline', () => {
    assert.eq(polyToPath([{ x: 5, y: 5 }]), '')
  })

  it('never bends further than half a segment', () => {
    // A 6px segment with the default 9px radius would otherwise overshoot
    // into the neighbouring segment and produce a visible kink.
    const d = polyToPath([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 60 }], ROUTE_DEFAULTS.corner)
    assert.ok(!d.includes('NaN'), 'path should not contain NaN')
    assert.includes(d, 'Q')
  })
})

describe('polyMidpoint()', () => {
  it('finds the halfway point of a straight run', () => {
    const m = polyMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    assert.eq(m.x, 50); assert.eq(m.y, 0)
  })

  it('measures along the path, not across it', () => {
    // Total length 200: 100 across, then 100 down. Halfway is the corner.
    const m = polyMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
    assert.eq(m.x, 100); assert.eq(m.y, 0)
  })
})
