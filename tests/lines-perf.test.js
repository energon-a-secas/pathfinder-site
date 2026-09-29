// ============================================================
//  lines-perf.test.js -- incremental routing.
//
//  A full pass re-routes only the connections whose search a
//  changed card could have touched, and separation reuses every
//  cluster whose inputs recur. The contract: whatever the edits,
//  the result is exactly what a full re-route gives.
// ============================================================

import { describe, it, assert, mockBlockEl, cleanupMockEls } from './test-utils.js'
import { state, selection, pointer, getUndoHistory, getRedoFuture } from '../js/state.js'
import { $ } from '../js/utils.js'
import { resolveRoutes, invalidateRoutes, fullReroute, routeStats } from '../js/arrow-routes.js'
import { routeOrtho, separateRoutes, rectTouchesBox } from '../js/route.js'
import { placeLabels, renderArrows } from '../js/canvas.js'

function reset() {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  pointer.ix = null
  selection.ids.clear()
  selection.blockId = null
  selection.arrowId = null
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  $.arrowsGroup().innerHTML = ''
  invalidateRoutes()
}

function block(id, x, y, w = 220, h = 62) {
  state.blocks[id] = { id, type: 'process', title: id, description: '', notes: '', x, y,
    actions: [], questions: [], docRef: null, width: w, color: null, collapsed: false,
    groupId: null, status: null, priority: null }
  // Out of flow: another suite can leave the body a flex column, which
  // shrinks in-flow mocks and makes every card change height when one is
  // added.
  const el = mockBlockEl(id, { width: w, height: h })
  el.style.position = 'absolute'
  el.style.left = '-99999px'
}

function arrow(id, from, to, extra = {}) {
  state.arrows.push({ id, from, to, style: 'routed', pattern: 'solid', bidirectional: false,
    color: null, weight: 1.5, fromPort: null, toPort: null, ...extra })
}

function seeded(seed) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

// Everything a route resolves to, as one comparable string.
const dump = routes => JSON.stringify([...routes.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1))

// A grid of cards with mostly local connections, like a real busy map.
function gridCanvas(rnd, n, links, { spacingX = 300, spacingY = 190 } = {}) {
  const cols = Math.ceil(Math.sqrt(n * 1.5))
  for (let i = 0; i < n; i++) {
    block('b' + i, (i % cols) * spacingX + Math.round(rnd() * 50), Math.floor(i / cols) * spacingY + Math.round(rnd() * 40),
      200 + Math.round(rnd() * 40), 62 + Math.round(rnd() * 30))
  }
  const seen = new Set()
  for (let k = 0; state.arrows.length < links && k < links * 20; k++) {
    const i = Math.floor(rnd() * n)
    const j = rnd() < 0.8 ? Math.min(n - 1, Math.max(0, i + [1, -1, cols, -cols, cols + 1][Math.floor(rnd() * 5)])) : Math.floor(rnd() * n)
    if (i === j || seen.has(i + '>' + j)) continue
    seen.add(i + '>' + j)
    const r = rnd()
    arrow('a' + state.arrows.length, 'b' + i, 'b' + j, {
      style: r < 0.8 ? 'routed' : r < 0.9 ? 'curved' : 'elbow',
      label: rnd() < 0.3 ? 'feeds' : undefined,
      fromPort: rnd() < 0.15 ? ['left', 'right', 'top', 'bottom'][Math.floor(rnd() * 4)] : null,
    })
  }
}

describe('lines-perf: incremental routing equals a full re-route', () => {
  it('holds over 60 random edits of every kind, drags included', () => {
    reset()
    const rnd = seeded(20260929)
    gridCanvas(rnd, 36, 48)
    resolveRoutes()
    const ids = () => Object.keys(state.blocks)
    const pick = list => list[Math.floor(rnd() * list.length)]
    const history = []
    let next = 1000, checked = 0, routedSeen = 0, searched = 0, routedArrows = 0
    for (let step = 0; step < 60; step++) {
      const kind = Math.floor(rnd() * 9)
      const id = pick(ids())
      const b = state.blocks[id]
      if (kind <= 1) {
        history.push([id, b.x, b.y])
        b.x += Math.round((rnd() - 0.5) * 400); b.y += Math.round((rnd() - 0.5) * 300)
      } else if (kind === 2) {
        const w = 160 + Math.round(rnd() * 140), h = 50 + Math.round(rnd() * 80)
        b.width = w
        mockBlockEl(id, { width: w, height: h })
      } else if (kind === 3) {
        const nid = 'n' + next++
        block(nid, b.x + Math.round((rnd() - 0.5) * 600), b.y + Math.round((rnd() - 0.5) * 400))
        arrow('x' + next++, nid, pick(ids()))
      } else if (kind === 4 && ids().length > 12) {
        delete state.blocks[id]
        document.getElementById('b-' + id)?.remove()
        state.arrows = state.arrows.filter(a => a.from !== id && a.to !== id)
      } else if (kind === 5) {
        const to = pick(ids())
        if (to !== id) arrow('x' + next++, id, to, { label: rnd() < 0.5 ? 'needs' : undefined })
      } else if (kind === 6 && state.arrows.length) {
        const a = pick(state.arrows)
        a.toPort = a.toPort ? null : pick(['left', 'right', 'top', 'bottom'])
      } else if (kind === 7) {
        // A drag: frames draw cheaply with the card in flight, then release.
        try {
          pointer.ix = { type: 'block', id, moved: true }
          const moving = new Set([id])
          for (let f = 1; f <= 4; f++) {
            b.x += 23; b.y -= 11
            resolveRoutes({ cheap: true, moving })
          }
        } finally { pointer.ix = null }
      } else if (history.length) {
        // Undo-like: a card goes back exactly where it was.
        const [hid, hx, hy] = history.pop()
        if (state.blocks[hid]) { state.blocks[hid].x = hx; state.blocks[hid].y = hy }
      }
      const s0 = routeStats.searches
      const inc = resolveRoutes()
      searched += routeStats.searches - s0
      routedArrows += state.arrows.filter(a => a.style === 'routed').length
      const full = fullReroute()
      inc.forEach(p => { if (p.points?.length > 2) routedSeen++ })
      assert.eq(dump(inc), dump(full), `step ${step} (edit ${kind}): the incremental routes differ from a full re-route`)
      checked++
    }
    assert.eq(checked, 60)
    assert.gt(routedSeen, 60 * 10, 'the canvas kept plenty of routed, bent lines throughout')
    assert.ok(searched < routedArrows / 3, `${searched} searches where a full re-route each time runs ${routedArrows}`)
  })

  it('also holds on a dense canvas where separation moves most lines', () => {
    reset()
    const rnd = seeded(77)
    gridCanvas(rnd, 40, 56, { spacingX: 250, spacingY: 120 })
    resolveRoutes()
    for (let step = 0; step < 25; step++) {
      const id = 'b' + Math.floor(rnd() * 40)
      state.blocks[id].x += Math.round((rnd() - 0.5) * 160)
      state.blocks[id].y += Math.round((rnd() - 0.5) * 120)
      assert.eq(dump(resolveRoutes()), dump(fullReroute()), `step ${step}`)
    }
  })

  it('fullReroute leaves the live caches as they were', () => {
    reset()
    gridCanvas(seeded(5), 16, 20)
    const first = resolveRoutes()
    fullReroute()
    const before = routeStats.searches
    const again = resolveRoutes()
    assert.eq(routeStats.searches, before, 'nothing was searched again')
    first.forEach((pts, aid) => assert.eq(again.get(aid).points, pts.points, aid + ' kept its very array'))
  })
})

// The same busy grid with plainer connections (routed or elbow only), so
// the random edits below decide everything that varies.
function plainCanvas(rnd, n, links, { spacingX = 300, spacingY = 190 } = {}) {
  const cols = Math.ceil(Math.sqrt(n * 1.5))
  for (let i = 0; i < n; i++) {
    block('b' + i, (i % cols) * spacingX + Math.round(rnd() * 50), Math.floor(i / cols) * spacingY + Math.round(rnd() * 40),
      200 + Math.round(rnd() * 40), 62 + Math.round(rnd() * 30))
  }
  const seen = new Set()
  for (let k = 0; state.arrows.length < links && k < links * 20; k++) {
    const i = Math.floor(rnd() * n)
    const j = rnd() < 0.8 ? Math.min(n - 1, Math.max(0, i + [1, -1, cols, -cols, cols + 1][Math.floor(rnd() * 5)])) : Math.floor(rnd() * n)
    if (i === j || seen.has(i + '>' + j)) continue
    seen.add(i + '>' + j)
    arrow('a' + state.arrows.length, 'b' + i, 'b' + j, { style: rnd() < 0.85 ? 'routed' : 'elbow' })
  }
}

const STYLES = ['routed', 'routed', 'curved', 'elbow', 'straight']
const SIDES = ['left', 'right', 'top', 'bottom']

// Every edit the app can make between two full passes, drawn at random:
// moves of one card or six, a Tidy-sized shift, a card that grows because
// its text wrapped, a drag with its cheap frames (kept or cancelled), a
// cheap pass with no moving set, style and end changes, a reversed line,
// adding and deleting, and a line deleted then restored under its own id.
function randomEdit(rnd, kind, fresh) {
  const ids = Object.keys(state.blocks)
  const pick = list => list[Math.floor(rnd() * list.length)]
  const id = pick(ids), b = state.blocks[id]
  if (kind === 0) { b.x += Math.round((rnd() - 0.5) * 300); b.y += Math.round((rnd() - 0.5) * 200) }
  else if (kind === 1 && state.arrows.length) pick(state.arrows).style = pick(STYLES)
  else if (kind === 2 && state.arrows.length > 5) state.arrows.splice(Math.floor(rnd() * state.arrows.length), 1)
  else if (kind === 3 && state.arrows.length) { const a = pick(state.arrows), t = pick(ids); if (t !== a.from) a.to = t }
  else if (kind === 4 && state.arrows.length) {
    const a = pick(state.arrows)
    a.fromPort = a.fromPort ? null : pick(SIDES)
    a.portsBy = rnd() < 0.5 ? 'tidy' : undefined
  } else if (kind === 5) {
    const sel = new Set()
    for (let k = 0; k < 6; k++) sel.add(pick(ids))
    const dx = Math.round((rnd() - 0.5) * 240), dy = Math.round((rnd() - 0.5) * 160)
    sel.forEach(s => { state.blocks[s].x += dx; state.blocks[s].y += dy })
  } else if (kind === 6) {
    ids.forEach(s => { state.blocks[s].x += 3; state.blocks[s].y -= 2 })
  } else if (kind === 7) {
    document.getElementById('b-' + id).style.height = (40 + Math.round(rnd() * 90)) + 'px'
  } else if (kind === 8) {
    const sel = new Set([id, pick(ids)])
    const start = [...sel].map(s => [s, state.blocks[s].x, state.blocks[s].y])
    try {
      pointer.ix = { type: 'block', id, moved: true }
      for (let f = 0; f < 5; f++) {
        sel.forEach(s => { state.blocks[s].x += 31; state.blocks[s].y += 17 })
        resolveRoutes({ cheap: true, moving: sel })
      }
    } finally { pointer.ix = null }
    if (rnd() < 0.5) start.forEach(([s, x, y]) => { state.blocks[s].x = x; state.blocks[s].y = y })
  } else if (kind === 9) {
    resolveRoutes({ cheap: true })
    b.x += 40
  } else if (kind === 10) {
    const nid = 'n' + fresh()
    block(nid, b.x + Math.round((rnd() - 0.5) * 500), b.y + Math.round((rnd() - 0.5) * 300))
    arrow('x' + fresh(), pick(Object.keys(state.blocks)), nid)
  } else if (kind === 11 && ids.length > 12) {
    delete state.blocks[id]
    document.getElementById('b-' + id)?.remove()
    state.arrows = state.arrows.filter(a => a.from !== id && a.to !== id)
  } else if (kind === 12 && state.arrows.length) {
    const a = pick(state.arrows), f = a.from
    a.from = a.to; a.to = f
  } else if (kind === 13 && state.arrows.length) {
    const i = Math.floor(rnd() * state.arrows.length)
    const [a] = state.arrows.splice(i, 1)
    resolveRoutes()
    state.arrows.splice(i, 0, { ...a })
  }
}

describe('lines-perf: equivalence under every kind of edit, on several canvases', () => {
  const canvases = [[1, 36, 50, 300, 190], [2, 40, 60, 250, 120], [3, 30, 45, 230, 110], [4, 50, 70, 280, 150], [5, 24, 40, 240, 105]]
  for (const [seed, n, links, spacingX, spacingY] of canvases) {
    it(`seed ${seed}: 70 random edits, each pass equal to a full re-route`, () => {
      reset()
      const rnd = seeded(seed * 7919)
      plainCanvas(rnd, n, links, { spacingX, spacingY })
      resolveRoutes()
      let next = 5000
      const log = []
      for (let step = 0; step < 70; step++) {
        const kind = Math.floor(rnd() * 14)
        log.push(kind)
        randomEdit(rnd, kind, () => next++)
        const inc = dump(resolveRoutes()), full = dump(fullReroute())
        assert.ok(inc === full, `seed ${seed} step ${step} (edit ${kind}, edits so far ${log.join(',')}): the incremental routes differ from a full re-route`)
        if (inc !== full) return
      }
    })
  }

  it('the same set of lines in another order separates as a full re-route does', () => {
    reset()
    plainCanvas(seeded(99), 40, 60, { spacingX: 250, spacingY: 120 })
    state.arrows.forEach(a => { a.style = 'routed' })
    resolveRoutes()
    state.arrows.reverse()
    assert.eq(dump(resolveRoutes()), dump(fullReroute()), 'reversed order')
    const rnd = seeded(7)
    for (let k = state.arrows.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [state.arrows[k], state.arrows[j]] = [state.arrows[j], state.arrows[k]]
    }
    assert.eq(dump(resolveRoutes()), dump(fullReroute()), 'shuffled order')
  })

  it('a full re-route gives the same answer every time', () => {
    reset()
    plainCanvas(seeded(123), 60, 90, { spacingX: 250, spacingY: 120 })
    assert.eq(dump(fullReroute()), dump(fullReroute()))
  })

  it('a card beside a separated run, outside every search box, still moves that run', () => {
    // Six lines run left to right under a tall wall, all well below their
    // ends (a detour past the router's reach), and share the stretch under
    // it: separation spreads them over 50px there. Then a card slides in
    // under that stretch, one pixel beyond the margin the routes keep. It
    // is outside every box the routes depended on (their search boxes, and
    // their paths grown by that margin), so no route is searched again, but
    // it is close enough to refuse one of separation's places: the
    // incremental pass must see that, as a full re-route does.
    reset()
    for (let i = 0; i < 6; i++) { block('a' + i, 0, i * 70); block('b' + i, 800, i * 70) }
    block('wall', 400, -1000, 120, 1460)
    block('c', 3000, 3000, 120, 60)
    for (let i = 0; i < 6; i++) arrow('x' + i, 'a' + i, 'b' + i)
    const before = resolveRoutes()
    const low = id => Math.max(...before.get(id).points.map(p => p.y))
    const floor = 460 + 18   // the wall's foot plus the router's margin
    assert.gt(low('x5'), 5 * 70 + 31 + 80, 'the lowest line detours more than the reach below its ends')
    assert.ok([0, 1, 2, 3, 4, 5].some(i => low('x' + i) > floor + 19), 'separation spreads a run below the card to come')
    const raw = fullReroute()
    assert.ok(dump(raw) === dump(before), 'the starting state agrees with a full re-route')
    const s0 = routeStats.searches
    state.blocks.c.x = 390; state.blocks.c.y = floor + 19
    const after = resolveRoutes()
    assert.eq(routeStats.searches - s0, 0, 'no route was searched again: the card is outside every box')
    const full = fullReroute()
    assert.ok(dump(full) !== dump(before), 'a full re-route places the runs differently with the card there')
    assert.eq(dump(after), dump(full), 'and the incremental pass agrees with it')
  })
})

describe('lines-perf: a release re-routes only what the move could reach', () => {
  it('moving one card of 120 re-runs the search for a small share of 160 lines', () => {
    reset()
    gridCanvas(seeded(3), 120, 160)
    state.arrows.forEach(a => { a.style = 'routed' })
    resolveRoutes()
    const cold = routeStats.searches
    const before = routeStats.searches
    const id = 'b55'
    state.blocks[id].x += 90; state.blocks[id].y += 45
    resolveRoutes()
    const ran = routeStats.searches - before
    const attached = state.arrows.filter(a => a.from === id || a.to === id).length
    assert.ok(ran >= attached, `${ran} searches, ${attached} lines on the card`)
    assert.ok(ran <= 40, `${ran} of ${state.arrows.length} lines searched again`)
    assert.gt(cold, 0)
  })

  it('a pass with nothing moved searches nothing and keeps every array', () => {
    reset()
    gridCanvas(seeded(9), 30, 40)
    const first = resolveRoutes()
    const before = routeStats.searches
    const again = resolveRoutes()
    assert.eq(routeStats.searches - before, 0)
    first.forEach((pts, aid) => assert.eq(again.get(aid).points, pts.points))
  })

  it('a card added far from every line leaves them all alone', () => {
    reset()
    gridCanvas(seeded(12), 30, 40)
    resolveRoutes()
    const before = routeStats.searches
    block('far', 20000, 20000)
    resolveRoutes()
    assert.eq(routeStats.searches - before, 0, 'no route could have met it')
  })

  it('a card dropped across a line re-routes that line around it', () => {
    reset()
    block('a', 0, 0); block('b', 800, 0)
    arrow('x', 'a', 'b')
    const first = resolveRoutes().get('x')
    assert.eq(first.points.length, 2, 'straight across open ground')
    block('wall', 400, -20, 120, 100)
    const after = resolveRoutes().get('x')
    assert.gt(after.points.length, 2, 'bends around the new card')
    assert.eq(dump(resolveRoutes()), dump(fullReroute()))
  })

  it('the drag frames never enter the cache: the release matches a full re-route', () => {
    reset()
    gridCanvas(seeded(31), 30, 40)
    resolveRoutes()
    const id = 'b14'
    try {
      pointer.ix = { type: 'block', id, moved: true }
      for (let f = 0; f < 6; f++) { state.blocks[id].x += 40; resolveRoutes({ cheap: true, moving: new Set([id]) }) }
    } finally { pointer.ix = null }
    assert.eq(dump(resolveRoutes()), dump(fullReroute()))
  })
})

describe('lines-perf: the router reports what it depended on', () => {
  for (const [name, opts] of [['the router\'s defaults', {}], ['the canvas reach and margin', { reach: 80, outerMargin: true }]])
  it(`a search is unchanged by any move that touches none of its boxes, with ${name}`, () => {
    const rnd = seeded(404)
    let kept = 0, redone = 0
    for (let trial = 0; trial < 40; trial++) {
      const rects = []
      for (let i = 0; i < 30; i++) rects.push({ x: (i % 6) * 280 + Math.round(rnd() * 60), y: Math.floor(i / 6) * 170 + Math.round(rnd() * 40), w: 200, h: 70 })
      const a = rects[Math.floor(rnd() * 30)], b = rects[Math.floor(rnd() * 30)]
      if (a === b) continue
      const pts = { x1: a.x + a.w, y1: a.y + 35, d1: 'right', x2: b.x, y2: b.y + 35, d2: 'left' }
      const deps = []
      const path = routeOrtho(pts, rects, { ...opts, deps })
      const m = Math.floor(rnd() * 30)
      if (rects[m] === a || rects[m] === b) continue
      const old = { ...rects[m] }
      rects[m] = { ...old, x: old.x + Math.round((rnd() - 0.5) * 500), y: old.y + Math.round((rnd() - 0.5) * 300) }
      if (deps.some(d => rectTouchesBox(old, d) || rectTouchesBox(rects[m], d))) { redone++; continue }
      assert.deepEq(routeOrtho(pts, rects, opts), path, 'a move outside every box changed the route')
      kept++
    }
    assert.gt(kept, 5, `${kept} kept, ${redone} redone`)
  })

  it('separation with a memo gives what separation without one gives, edit after edit', () => {
    const rnd = seeded(8080)
    const rects = []
    for (let i = 0; i < 24; i++) rects.push({ x: (i % 6) * 260 + Math.round(rnd() * 40), y: Math.floor(i / 6) * 150 + Math.round(rnd() * 30), w: 200, h: 64 })
    const sides = ['left', 'right', 'top', 'bottom']
    const port = (r, side) => side === 'left' ? { x: r.x, y: r.y + 32 } : side === 'right' ? { x: r.x + r.w, y: r.y + 32 }
      : side === 'top' ? { x: r.x + 100, y: r.y } : { x: r.x + 100, y: r.y + r.h }
    const links = []
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(rnd() * 24), j = Math.floor(rnd() * 24)
      if (i !== j) links.push([i, j, sides[Math.floor(rnd() * 4)], sides[Math.floor(rnd() * 4)]])
    }
    const routeAll = () => links.map(([i, j, s1, s2], k) => {
      const p = port(rects[i], s1), q = port(rects[j], s2)
      return { id: 'r' + k, points: routeOrtho({ x1: p.x, y1: p.y, d1: s1, x2: q.x, y2: q.y, d2: s2 }, rects) }
    }).filter(r => r.points && r.points.length > 2)
    let memo = { prev: new Map(), next: new Map() }
    let reused = 0
    for (let step = 0; step < 12; step++) {
      if (step) {
        const m = Math.floor(rnd() * 24)
        rects[m] = { ...rects[m], x: rects[m].x + Math.round((rnd() - 0.5) * 200) }
      }
      const routes = routeAll()
      const plain = separateRoutes(routes, rects)
      memo.next = new Map()
      const memoised = separateRoutes(routes, rects, { memo })
      memo.next.forEach((list, h) => list.forEach(e => { if (memo.prev.get(h)?.includes(e)) reused++ }))
      memo = { prev: memo.next, next: new Map() }
      assert.deepEq(memoised, plain, `step ${step}`)
      assert.deepEq(routes.map(r => r.points.length), routeAll().map(r => r.points.length), 'the inputs were not mutated')
    }
    assert.gt(reused, 10, `${reused} cluster placements were reused`)
  })
})

describe('lines-perf: the canvas reach keeps the margin', () => {
  // A wall between two ends sends the line under it, past the canvas's
  // reach of 80, and a card sits just under that detour: outside the search
  // box, so the first search never sees it, and the line it finds runs 1px
  // from the card's top.
  const a = { x: -220, y: -31, w: 220, h: 62 }, b = { x: 400, y: -31, w: 220, h: 62 }
  const wall = { x: 150, y: -300, w: 100, h: 400 }, c = { x: 160, y: 119, w: 80, h: 50 }
  const pts = { x1: 0, y1: 0, d1: 'right', x2: 400, y2: 0, d2: 'left' }
  const clearance = (p, r) => Math.min(...p.slice(1).map((q, i) => {
    const s = p[i]
    return Math.max(r.x - Math.max(s.x, q.x), Math.min(s.x, q.x) - (r.x + r.w), r.y - Math.max(s.y, q.y), Math.min(s.y, q.y) - (r.y + r.h), 0)
  }))

  it('a detour past the reach keeps the margin from a card the search left out', () => {
    const p = routeOrtho(pts, [a, b, wall, c], { reach: 80, outerMargin: true })
    assert.ok(clearance(p, c) >= 18, `${clearance(p, c)}px from the card`)
    assert.deepEq(p, routeOrtho(pts, [a, b, wall, c]), 'the line the default reach of 160 draws')
  })

  it('the trace tool\'s default leaves that check off and draws what it drew', () => {
    // Its lines run inside containers, so a line near a box it did not
    // search around is normal there: it keeps its old behaviour.
    const p = routeOrtho(pts, [a, b, wall, c], { reach: 80 })
    assert.eq(clearance(p, c), 1)
  })

  it('a card moved in beside a detour re-routes it, as a full re-route does', () => {
    reset()
    block('a', a.x, a.y, a.w, a.h); block('b', b.x, b.y, b.w, b.h)
    block('wall', wall.x, wall.y, wall.w, wall.h)
    block('c', 3000, 3000, c.w, c.h)
    arrow('x', 'a', 'b')
    resolveRoutes()
    const s0 = routeStats.searches
    state.blocks.c.x = c.x; state.blocks.c.y = c.y
    const after = resolveRoutes()
    assert.gt(routeStats.searches - s0, 0, 'the card touches the margin around the line, so it searched again')
    assert.ok(clearance(after.get('x').points, c) >= 18, `${clearance(after.get('x').points, c)}px from the card`)
    assert.eq(dump(after), dump(fullReroute()))
  })
})

describe('lines-perf: the canvas router counts turns in its estimate', () => {
  // turnBound only makes the search look at fewer states: a path of the
  // same cost comes back, and almost always the very same path.
  const sides = ['left', 'right', 'top', 'bottom']
  const port = (r, side) => side === 'left' ? { x: r.x, y: r.y + Math.round(r.h / 2) } : side === 'right' ? { x: r.x + r.w, y: r.y + Math.round(r.h / 2) }
    : side === 'top' ? { x: r.x + Math.round(r.w / 2), y: r.y } : { x: r.x + Math.round(r.w / 2), y: r.y + r.h }
  const cases = () => {
    const rnd = seeded(2929), out = []
    for (let t = 0; t < 30; t++) {
      const rects = []
      // A loose grid: cards never overlap, so no line starts inside another card.
      for (let i = 0; i < 20; i++) rects.push({ x: (i % 5) * 280 + Math.round(rnd() * 50), y: Math.floor(i / 5) * 170 + Math.round(rnd() * 40), w: 120 + Math.round(rnd() * 100), h: 50 + Math.round(rnd() * 60) })
      for (let k = 0; k < 8; k++) {
        const a = rects[Math.floor(rnd() * 20)], b = rects[Math.floor(rnd() * 20)]
        if (a === b) continue
        const s1 = sides[Math.floor(rnd() * 4)], s2 = sides[Math.floor(rnd() * 4)]
        const p = port(a, s1), q = port(b, s2)
        out.push({ pts: { x1: p.x, y1: p.y, d1: s1, x2: q.x, y2: q.y, d2: s2 }, rects, ends: [a, b] })
      }
    }
    return out
  }

  it('finds the plain estimate\'s path in almost every search, around the same cards', () => {
    let same = 0, n = 0
    for (const { pts, rects, ends } of cases()) {
      const plain = routeOrtho(pts, rects, { reach: 80 }), turns = routeOrtho(pts, rects, { reach: 80, turnBound: true })
      n++
      if (JSON.stringify(plain) === JSON.stringify(turns)) { same++; continue }
      // A different path of equal cost: it still avoids every card but its ends.
      assert.ok(plain && turns, 'both found a path')
      const others = rects.filter(r => !ends.includes(r))
      for (let i = 1; i < turns.length; i++) {
        assert.ok(!others.some(r => r.x < Math.max(turns[i - 1].x, turns[i].x) && Math.min(turns[i - 1].x, turns[i].x) < r.x + r.w &&
          r.y < Math.max(turns[i - 1].y, turns[i].y) && Math.min(turns[i - 1].y, turns[i].y) < r.y + r.h &&
          (turns[i - 1].x === turns[i].x ? turns[i].x > r.x && turns[i].x < r.x + r.w : turns[i].y > r.y && turns[i].y < r.y + r.h)), 'crosses a card')
      }
    }
    assert.ok(same >= n * 0.97, `${same} of ${n} the same`)
  })

  it('reports the same boxes it depended on', () => {
    for (const { pts, rects } of cases().slice(0, 60)) {
      const a = [], b = []
      routeOrtho(pts, rects, { reach: 80, outerMargin: true, deps: a })
      routeOrtho(pts, rects, { reach: 80, outerMargin: true, turnBound: true, deps: b })
      assert.eq(a.length, b.length)
    }
  })
})

describe('lines-perf: cost on a large canvas', () => {
  it('a one-card release costs a fraction of routing everything (300 cards, 400 lines)', () => {
    reset()
    gridCanvas(seeded(42), 300, 400, { spacingX: 340, spacingY: 230 })
    state.arrows.forEach(a => { a.style = 'routed'; a.fromPort = null })
    const t = f => { const t0 = performance.now(); f(); return performance.now() - t0 }
    const cold = t(() => { invalidateRoutes(); resolveRoutes() })
    resolveRoutes()
    const releases = []
    for (const id of ['b120', 'b121', 'b150', 'b151', 'b180']) {
      state.blocks[id].x += 180; state.blocks[id].y += 90
      const s0 = routeStats.searches
      releases.push({ ms: t(() => resolveRoutes()), searches: routeStats.searches - s0 })
      state.blocks[id].x -= 180; state.blocks[id].y -= 90
      resolveRoutes()
    }
    releases.forEach(r => assert.ok(r.searches <= 60, `${r.searches} searches for one card`))
    const median = releases.map(r => r.ms).sort((a, b) => a - b)[2]
    assert.ok(median < cold / 2, `release ${median.toFixed(1)}ms vs full ${cold.toFixed(1)}ms`)
  })

  it('placing labels on 400 lines stays cheap', () => {
    reset()
    gridCanvas(seeded(43), 300, 400, { spacingX: 340, spacingY: 230 })
    state.arrows.forEach(a => { a.label = 'feeds' })
    const routes = resolveRoutes()
    const t0 = performance.now()
    const labels = placeLabels(routes)
    const ms = performance.now() - t0
    assert.eq([...labels.values()].filter(l => l.text).length, 400)
    assert.ok(ms < 60, `${ms.toFixed(1)}ms`)
  })

  it('labels find the cards and lines near them anywhere on the canvas, negative coordinates too', () => {
    reset()
    // Two short lines side by side far up and left, a card just under
    // them: each label keeps off the card and off the other line.
    block('a', -5210, -3100); block('b', -4700, -3100)
    block('c', -5210, -2990); block('d', -4700, -2990)
    block('under', -4960, -3060, 180, 40)
    arrow('x', 'a', 'b', { label: 'feeds the report' })
    arrow('y', 'c', 'd', { label: 'needs sign-off' })
    const routes = resolveRoutes()
    const labels = placeLabels(routes)
    const box = l => ({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h })
    const hit = (r, q) => r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h
    for (const aid of ['x', 'y']) {
      const r = box(labels.get(aid))
      for (const id in state.blocks) {
        const b = state.blocks[id], el = document.getElementById('b-' + id)
        assert.ok(!hit(r, { x: b.x, y: b.y, w: el.offsetWidth, h: el.offsetHeight }), `${aid} sits on ${id}`)
      }
    }
    assert.ok(!hit(box(labels.get('x')), box(labels.get('y'))), 'the two labels do not overlap')
  })

  it('a second render with nothing changed rewrites no path', () => {
    reset()
    gridCanvas(seeded(44), 40, 50)
    renderArrows({ cheap: false })
    const seen = []
    const obs = new MutationObserver(list => list.forEach(m => seen.push(m)))
    obs.observe($.arrowsGroup(), { attributes: true, subtree: true, attributeFilter: ['d'] })
    renderArrows({ cheap: false })
    const pending = obs.takeRecords()
    obs.disconnect()
    assert.eq(seen.length + pending.length, 0, 'no d attribute was written again')
    reset()
  })
})
