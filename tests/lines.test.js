// ============================================================
//  lines.test.js -- connections: routing, lanes, heads, labels,
//  the inline label editor, Tidy's report, and the export.
//
//  The regression fixture is the canvas that prompted "lines are
//  awful" (geometry and sides as the user drew them; the text is
//  neutralised). It goes through the real JSON Canvas importer.
// ============================================================

import { describe, it, assert, mockBlockEl, cleanupMockEls } from './test-utils.js'
import { state, ui, view, selection, pointer, getUndoHistory, getRedoFuture,
         resetSnapshotToken, canvasMeta } from '../js/state.js'
import { $ } from '../js/utils.js'
import { addArrow, selectArrow, deselectAll, deleteArrow } from '../js/render.js'
import { resolveRoutes, renderArrows, applyTransform, headLength, headTrim, arrowMarker,
         placeLabels, arrowPolyline, pruneArrowLabels, syncArrowStates, linesUnderCards,
         pathFor, portPos, setupArrowHover, invalidateRoutes } from '../js/canvas.js'
import { routeOrtho, separateRoutes, polyToPath, labelAnchor, ROUTE_DEFAULTS } from '../js/route.js'
import { tidyCanvas, releaseTidyPins, tidySummary } from '../js/layout.js'
import { startArrowLabelEdit, isArrowLabelEditing, commitArrowLabelEdit, onKeydown,
         nearestOnPolyline } from '../js/arrow-edit.js'
import { fromJsonCanvas } from '../js/interop.js'
import { buildSvg } from '../js/image-export.js'
import { RELATIONS } from '../js/relations.js'
import { setupKeyboardShortcuts } from '../js/events.js'

// ── Fixture ──────────────────────────────────────────────────
const USER_CANVAS = {
  nodes: [
    { id: 'n1', type: 'text', x: 867,  y: 367, width: 220, height: 62, color: '#f0abfc', text: '#### Multi Reports' },
    { id: 'n2', type: 'text', x: -153, y: 357, width: 220, height: 82, color: '3', text: '#### Plans per Epic (Deliverable)\n\nPart of the delivery lifecycle.' },
    { id: 'n3', type: 'text', x: 527,  y: 357, width: 220, height: 82, color: '3', text: '#### Weekly Reports\n\n(Check if still used)' },
    { id: 'n4', type: 'text', x: 187,  y: 349, width: 220, height: 97, color: '4', text: '#### Schedule Plans\n\nIntegration with several tools to get a summary of the work needed.' },
    { id: 'n5', type: 'text', x: 527,  y: 477, width: 220, height: 62, color: '3', text: '#### End of Sprint' },
    { id: 'n6', type: 'text', x: -833, y: 422, width: 220, height: 62, color: '#f0abfc', text: '#### Team Model Reporting' },
    { id: 'n7', type: 'text', x: -833, y: 522, width: 220, height: 62, color: '#f0abfc', text: '#### Executive Reporting' },
    { id: 'n8', type: 'text', x: -493, y: 422, width: 220, height: 62, color: '#60a5fa', text: '#### Every End of Sprint' },
    { id: 'n9', type: 'text', x: 527,  y: 577, width: 220, height: 62, color: '3', text: '#### Key Results' },
    { id: 'na', type: 'text', x: 187,  y: 577, width: 220, height: 62, color: '#60a5fa', text: "#### On Quarter's end" },
    { id: 'nb', type: 'text', x: 187,  y: 677, width: 220, height: 82, color: '#64748b', text: '#### Team Central\n\nIntegrated with the tracker and other sources' },
  ],
  edges: [
    { id: 'e1', fromNode: 'n2', toNode: 'n4', fromSide: 'right' },
    { id: 'e2', fromNode: 'n3', toNode: 'n1', fromSide: 'right' },
    { id: 'e3', fromNode: 'n5', toNode: 'n1', fromSide: 'right' },
    { id: 'e4', fromNode: 'n7', toNode: 'n8', fromSide: 'right', toSide: 'left' },
    { id: 'e5', fromNode: 'n6', toNode: 'n8', fromSide: 'right' },
    { id: 'e6', fromNode: 'n8', toNode: 'n2', fromSide: 'right' },
    { id: 'e7', fromNode: 'n8', toNode: 'n5', fromSide: 'right' },
    { id: 'e8', fromNode: 'na', toNode: 'n9', fromSide: 'right' },
    { id: 'e9', fromNode: 'n7', toNode: 'na', fromSide: 'right' },
    { id: 'ea', fromNode: 'n4', toNode: 'n3', fromSide: 'right' },
    { id: 'eb', fromNode: 'nb', toNode: 'n9', fromSide: 'top' },
    { id: 'ec', fromNode: 'n9', toNode: 'n1', fromSide: 'right' },
  ],
}

function reset() {
  if (isArrowLabelEditing()) commitArrowLabelEdit()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  ui.embed = false
  pointer.ix = null
  selection.ids.clear()
  selection.blockId = null
  selection.arrowId = null
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  $.arrowsGroup().innerHTML = ''
}

function block(id, x, y, w = 220, h = 62, extra = {}) {
  state.blocks[id] = { id, type: 'process', title: id, description: '', notes: '', x, y,
    actions: [], questions: [], docRef: null, width: w, color: null, collapsed: false,
    groupId: null, status: null, priority: null, ...extra }
  mockBlockEl(id, { width: w, height: h })
}

function arrow(id, from, to, extra = {}) {
  const a = { id, from, to, style: 'routed', pattern: 'solid', bidirectional: false, color: null,
    weight: 1.5, fromPort: null, toPort: null, ...extra }
  state.arrows.push(a)
  return a
}

function loadUserCanvas({ portsBy } = {}) {
  reset()
  const { payload } = fromJsonCanvas(USER_CANVAS)
  const size = new Map(USER_CANVAS.nodes.map(n => [n.id, n]))
  payload.blocks.forEach(b => block(b.id, b.x, b.y, size.get(b.id).width, size.get(b.id).height, { type: b.type, title: b.title }))
  payload.arrows.forEach(a => state.arrows.push({ ...a, pattern: 'solid', color: null, weight: 1.5,
    ...(portsBy && (a.fromPort || a.toPort) ? { portsBy } : {}) }))
}

function rectOf(id) {
  const b = state.blocks[id], el = document.getElementById('b-' + id)
  return { id, x: b.x, y: b.y, w: el.offsetWidth, h: el.offsetHeight }
}

// An axis-aligned segment through a rect's interior (touching does not count).
function crosses(r, a, b) {
  const l = r.x, t = r.y, rr = r.x + r.w, bo = r.y + r.h
  if (a.y === b.y) {
    if (a.y <= t || a.y >= bo) return false
    return Math.max(Math.min(a.x, b.x), l) < Math.min(Math.max(a.x, b.x), rr)
  }
  if (a.x <= l || a.x >= rr) return false
  return Math.max(Math.min(a.y, b.y), t) < Math.min(Math.max(a.y, b.y), bo)
}

// Pairs of runs from different routes closer than 8px across and sharing
// more than 8px along.
function sharedRuns(routes) {
  const segs = []
  routes.forEach((pts, aid) => {
    const p = pts.points || []
    for (let i = 1; i < p.length; i++) segs.push({ aid, a: p[i - 1], b: p[i] })
  })
  const out = []
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i], u = segs[j]
      if (s.aid === u.aid) continue
      const sv = s.a.x === s.b.x, uv = u.a.x === u.b.x
      if (sv !== uv) continue
      const c1 = sv ? s.a.x : s.a.y, c2 = uv ? u.a.x : u.a.y
      if (Math.abs(c1 - c2) >= 8) continue
      const along = (seg, v) => v ? [seg.a.y, seg.b.y] : [seg.a.x, seg.b.x]
      const [s1, s2] = along(s, sv), [u1, u2] = along(u, uv)
      const overlap = Math.min(Math.max(s1, s2), Math.max(u1, u2)) - Math.max(Math.min(s1, s2), Math.min(u1, u2))
      if (overlap > 8) out.push({ a: s.aid, b: u.aid, overlap })
    }
  }
  return out
}

const titled = t => Object.values(state.blocks).find(b => b.title === t)?.id

// ── The user's canvas ────────────────────────────────────────

describe('lines: the canvas that looked awful', () => {
  it('routes every connection and none passes through a card it does not join', () => {
    loadUserCanvas()
    const routes = resolveRoutes({ cheap: false })
    assert.eq(routes.size, 12)
    const rects = Object.keys(state.blocks).map(rectOf)
    state.arrows.forEach(a => {
      const p = routes.get(a.id).points
      assert.ok(p && p.length >= 2, `${a.id} should be routed`)
      for (let i = 1; i < p.length; i++) {
        rects.forEach(r => {
          if (r.id === a.from || r.id === a.to) return
          assert.ok(!crosses(r, p[i - 1], p[i]),
            `${state.blocks[a.from].title} -> ${state.blocks[a.to].title} crosses ${state.blocks[r.id].title}`)
        })
      }
    })
  })

  it('the line from the bottom card no longer cuts through the card 38px above it', () => {
    loadUserCanvas()
    const routes = resolveRoutes({ cheap: false })
    const a = state.arrows.find(x => x.from === titled('Team Central'))
    const p = routes.get(a.id).points
    const quarter = rectOf(titled("On Quarter's end"))
    for (let i = 1; i < p.length; i++) assert.ok(!crosses(quarter, p[i - 1], p[i]))
  })

  it('no two routes share a run closer than 8px for more than 8px', () => {
    loadUserCanvas()
    assert.deepEq(sharedRuns(resolveRoutes({ cheap: false })), [])
  })

  it('the three arrows into Multi Reports do not share a trunk', () => {
    loadUserCanvas()
    const hub = titled('Multi Reports')
    const routes = resolveRoutes({ cheap: false })
    const into = new Map([...routes].filter(([aid]) => state.arrows.find(a => a.id === aid).to === hub))
    assert.eq(into.size, 3)
    assert.deepEq(sharedRuns(into), [])
    const ends = [...into.values()].map(p => p.y2)
    assert.eq(new Set(ends).size, 3, 'three heads on three lanes')
    ends.sort((a, b) => a - b)
    assert.gte(ends[1] - ends[0], 16); assert.gte(ends[2] - ends[1], 16)
  })

  it('with import pins (another tool\'s sides) nearly aligned ends straighten', () => {
    loadUserCanvas({ portsBy: 'import' })
    const routes = resolveRoutes({ cheap: false })
    const weekly = state.arrows.find(a => a.from === titled('Weekly Reports'))
    assert.eq(routes.get(weekly.id).points.length, 2, 'one straight run, no jog')
    const quarter = state.arrows.find(a => a.from === titled("On Quarter's end"))
    assert.eq(routes.get(quarter.id).points.length, 2)
    assert.deepEq(sharedRuns(routes), [])
  })

  it('every coordinate in a routed path is a whole pixel', () => {
    loadUserCanvas()
    state.blocks[titled('Key Results')].x += 0.37
    state.blocks[titled('Weekly Reports')].y += 0.61
    const routes = resolveRoutes({ cheap: false })
    routes.forEach(pts => (pts.points || []).forEach(p => {
      assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y), `fractional point ${p.x},${p.y}`)
    }))
    const d = polyToPath(routes.get(state.arrows[0].id).points, ROUTE_DEFAULTS.corner)
    assert.ok(!/\d\.\d/.test(d), `path has fractions: ${d}`)
  })
})

// ── The router on its own ────────────────────────────────────

describe('lines: router', () => {
  it('shrinks a crowded clearance instead of dropping the block', () => {
    const src = { x: 187, y: 677, w: 220, h: 82 }
    const mid = { x: 187, y: 577, w: 220, h: 62 }
    const dst = { x: 527, y: 577, w: 220, h: 62 }
    const p = routeOrtho({ x1: 297, y1: 677, d1: 'top', x2: 527, y2: 608, d2: 'left' }, [src, mid, dst])
    assert.ok(p, 'routed')
    for (let i = 1; i < p.length; i++) assert.ok(!crosses(mid, p[i - 1], p[i]), 'stays out of the block above')
  })

  it('treats the endpoint blocks as obstacles past the stub', () => {
    const src = { x: 0, y: 0, w: 220, h: 60 }
    const dst = { x: -400, y: 0, w: 220, h: 60 }
    const p = routeOrtho({ x1: 220, y1: 30, d1: 'right', x2: -180, y2: 30, d2: 'right' }, [src, dst])
    assert.ok(p, 'routed')
    for (let i = 1; i < p.length; i++) assert.ok(!crosses(src, p[i - 1], p[i]), 'goes around its own source')
  })

  it('meets halfway when two facing ports are closer than two stubs', () => {
    const p = routeOrtho({ x1: 100, y1: 50, d1: 'right', x2: 120, y2: 50, d2: 'left' }, [])
    assert.deepEq(p, [{ x: 100, y: 50 }, { x: 120, y: 50 }])
  })

  it('does not give up on a large hand-placed canvas', () => {
    let seed = 11
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const blocks = []
    for (let i = 0; i < 150; i++) {
      blocks.push({ x: (i % 13) * 340 + Math.round(rnd() * 60), y: Math.floor(i / 13) * 200 + Math.round(rnd() * 40),
                    w: 220, h: 62 + Math.round(rnd() * 40) })
    }
    let declined = 0
    for (let k = 0; k < 25; k++) {
      const a = blocks[(k * 37) % 150], b = blocks[(k * 53 + 7) % 150]
      if (a === b) continue
      const pts = { x1: a.x + a.w, y1: Math.round(a.y + a.h / 2), d1: 'right', x2: b.x, y2: Math.round(b.y + b.h / 2), d2: 'left' }
      const p = routeOrtho(pts, blocks)
      if (!p) { declined++; continue }
      for (let i = 1; i < p.length; i++) blocks.forEach(r => {
        if (r !== a && r !== b) assert.ok(!crosses(r, p[i - 1], p[i]), 'a long route stays out of every block')
      })
    }
    assert.eq(declined, 0)
  })

  it('separates two routes that share a trunk and keeps their port legs', () => {
    const routes = [
      { id: 'a', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 160, y: 200 }] },
      { id: 'b', points: [{ x: 0, y: 300 }, { x: 100, y: 300 }, { x: 100, y: 120 }, { x: 160, y: 120 }] },
    ]
    const out = separateRoutes(routes, [])
    const xa = out[0].points[1].x, xb = out[1].points[1].x
    assert.gte(Math.abs(xa - xb), 10)
    assert.deepEq(out[0].points[0], { x: 0, y: 0 }, 'port end unchanged')
    assert.deepEq(out[1].points[3], { x: 160, y: 120 }, 'port end unchanged')
    assert.eq(routes[0].points[1].x, 100, 'inputs are not mutated')
  })

  it('picks the order that does not cross when it separates', () => {
    // a turns into the target above b's turn, so a must take the outer lane.
    const routes = [
      { id: 'a', points: [{ x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 300 }, { x: 160, y: 300 }] },
      { id: 'b', points: [{ x: 0, y: 200 }, { x: 100, y: 200 }, { x: 100, y: 310 }, { x: 160, y: 310 }] },
    ]
    const [a, b] = separateRoutes(routes, [])
    assert.gt(a.points[1].x, b.points[1].x)
  })

  it('keeps spreading until busy hand-drawn canvases have few shared runs left', () => {
    // Ten seeded 24-card, 30-line canvases. Three passes left 62 shared
    // runs across them; repeating until nothing moves leaves 30.
    let total = 0
    for (let seed = 1; seed <= 10; seed++) {
      reset()
      invalidateRoutes()
      let s = seed * 7919
      const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
      for (let i = 0; i < 24; i++) {
        block('b' + i, (i % 6) * 300 + Math.round(rnd() * 50), Math.floor(i / 6) * 170 + Math.round(rnd() * 40), 220, 62 + Math.round(rnd() * 30))
      }
      const seen = new Set()
      for (let k = 0; k < 30; k++) {
        const f = Math.floor(rnd() * 24), t = Math.floor(rnd() * 24)
        if (f === t || seen.has(f + '>' + t)) continue
        seen.add(f + '>' + t)
        arrow('a' + k, 'b' + f, 'b' + t)
      }
      total += sharedRuns(resolveRoutes({ cheap: false })).length
    }
    assert.ok(total <= 40, `${total} shared runs`)
  })

  it('will not move a run into a block', () => {
    const wall = { x: 104, y: 0, w: 40, h: 400 }
    const routes = [
      { id: 'a', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 60, y: 200 }] },
      { id: 'b', points: [{ x: 0, y: 300 }, { x: 100, y: 300 }, { x: 100, y: 120 }, { x: 60, y: 120 }] },
    ]
    separateRoutes(routes, [wall]).forEach(r => {
      for (let i = 1; i < r.points.length; i++) assert.ok(!crosses(wall, r.points[i - 1], r.points[i]))
    })
  })
})

// ── Lanes ────────────────────────────────────────────────────

describe('lines: lanes', () => {
  it('keeps lanes on one side at least 16px apart', () => {
    reset()
    block('hub', 600, 200, 220, 100)
    ;['s1', 's2', 's3', 's4'].forEach((id, i) => { block(id, 0, i * 140, 220, 62); arrow('a' + i, id, 'hub', { style: 'curved' }) })
    const ys = ['a0', 'a1', 'a2', 'a3'].map(id => resolveRoutes({ cheap: true }).get(id).y2).sort((a, b) => a - b)
    for (let i = 1; i < ys.length; i++) assert.gte(ys[i] - ys[i - 1], 16)
  })

  it('spills extra arrows to the next side instead of stacking heads', () => {
    reset()
    block('hub', 600, 300, 220, 62)
    for (let i = 0; i < 6; i++) { block('s' + i, 0, i * 120, 220, 62); arrow('a' + i, 's' + i, 'hub', { style: 'curved' }) }
    const routes = resolveRoutes({ cheap: true })
    const sides = [...routes.values()].map(p => p.d2)
    assert.ok(sides.filter(s => s === 'left').length <= 3, 'a 62px side holds three lanes')
    assert.ok(sides.includes('top') && sides.includes('bottom'), 'the extremes spill up and down')
  })

  it('never spills a pinned end', () => {
    reset()
    block('hub', 600, 300, 220, 62)
    for (let i = 0; i < 6; i++) { block('s' + i, 0, i * 120, 220, 62); arrow('a' + i, 's' + i, 'hub', { style: 'curved', toPort: 'left' }) }
    const routes = resolveRoutes({ cheap: true })
    ;[...routes.values()].forEach(p => assert.eq(p.d2, 'left'))
  })

  it('slides a lone, unpinned end to line up with the other end', () => {
    reset()
    block('a', 0, 0, 220, 100)
    block('b', 400, 20, 220, 62)
    arrow('x', 'a', 'b')
    const p = resolveRoutes({ cheap: false }).get('x')
    assert.eq(p.y1, p.y2, 'straight across')
    assert.eq(p.points.length, 2)
  })

  it('leaves an end the user pinned at the port they chose', () => {
    reset()
    block('a', 0, 0, 220, 100)
    block('b', 400, 20, 220, 62)
    arrow('x', 'a', 'b', { fromPort: 'right', toPort: 'left' })
    const p = resolveRoutes({ cheap: false }).get('x')
    assert.eq(p.y1, 50, 'the source keeps its midpoint')
    assert.eq(p.y2, 51)
  })

  it('slides an end on a shared side into line when its neighbours keep their pitch', () => {
    reset()
    block('s1', 0, 0); block('s2', 0, 300)
    block('t', 500, 0, 220, 200)
    arrow('one', 's1', 't'); arrow('two', 's2', 't')
    const routes = resolveRoutes({ cheap: false })
    const one = routes.get('one'), two = routes.get('two')
    assert.eq(one.y2, one.y1, 'the end on the shared side lines up with its source')
    assert.eq(one.points.length, 2, 'one straight run, no jog')
    assert.gte(two.y2 - one.y2, 16, 'the lanes keep their pitch')
  })

  it('never slides a shared-side end closer than 16px to its neighbour', () => {
    reset()
    block('s1', 0, 89); block('s2', 0, 300)
    block('t', 500, 0, 220, 200)
    arrow('one', 's1', 't'); arrow('two', 's2', 't')
    const routes = resolveRoutes({ cheap: false })
    const one = routes.get('one'), two = routes.get('two')
    assert.eq(one.y1, 120)
    assert.neq(one.y2, 120, 'lining up would crowd the lane below')
    assert.gte(two.y2 - one.y2, 16)
  })

  it('keeps lanes inside the block even when overfull', () => {
    reset()
    block('b1', 0, 0, 220, 62)
    for (let i = 0; i < 6; i++) {
      const p = portPos('b1', 'right', i, 6)
      assert.ok(p.y > 0 && p.y < 62)
    }
  })
})

// ── Heads, patterns, hit areas (against the real stylesheet) ─

let sheetPromise = null
function realSheet() {
  sheetPromise = sheetPromise || fetch('../css/style.css').then(r => r.text()).then(css => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    return { sheet, css }
  })
  return sheetPromise
}

async function shadowSvg(markup) {
  const { sheet } = await realSheet()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-3000px;top:0;width:300px;height:200px'
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  root.adoptedStyleSheets = [sheet]
  root.innerHTML = markup
  return { root, done: () => host.remove() }
}

// The same, on screen (invisible), for hit tests.
async function shadowAt(markup) {
  const { sheet } = await realSheet()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:200px;opacity:0;z-index:2147483647'
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  root.adoptedStyleSheets = [sheet]
  root.innerHTML = markup
  return { root, done: () => host.remove() }
}

// The app's stylesheet on the test page itself, for layout-dependent tests.
async function withAppStyles(fn) {
  const { sheet } = await realSheet()
  const saved = document.adoptedStyleSheets
  document.adoptedStyleSheets = [...saved, sheet]
  try { return await fn() } finally { document.adoptedStyleSheets = saved }
}

describe('lines: heads and line states', () => {
  it('head size follows the weight but stays bounded', () => {
    assert.gte(headLength(1), 8)
    assert.eq(headLength(5), 16)
    assert.eq(headLength(20), 16)
    assert.ok(headLength(1.5) < headLength(3.5))
  })

  it('a weight-5 head is minted in user units, at most 16 long', () => {
    reset()
    const ref = arrowMarker('#ff0000', 5)
    const id = ref.match(/#([^)]+)\)/)[1]
    const m = document.getElementById(id)
    assert.ok(m, 'marker minted')
    assert.eq(m.getAttribute('markerUnits'), 'userSpaceOnUse')
    assert.ok(+m.getAttribute('markerWidth') <= 16)
    assert.ok(+m.getAttribute('markerHeight') <= 16)
    assert.eq(arrowMarker('#ff0000', 5), ref, 'reused, not minted twice')
    assert.eq(document.querySelectorAll('#' + id).length, 1)
  })

  it('a theme-token head is filled from the token, so it follows light mode', () => {
    const ref = arrowMarker('edge', 1.5)
    const poly = document.getElementById(ref.match(/#([^)]+)\)/)[1]).querySelector('polygon')
    assert.eq(poly.style.fill, 'var(--edge)')
  })

  it('the line stops short of the card by the head, and the head tip by 2px', () => {
    assert.eq(headTrim(1.5), 2 + headLength(1.5) * 0.4)
    const d = pathFor({ x1: 0, y1: 0, d1: 'right', x2: 200, y2: 0, d2: 'left' }, 'straight', { end: headTrim(1.5) })
    const endX = +d.split(' ').at(-2)
    assert.ok(Math.abs(200 - headTrim(1.5) - endX) < 0.01, `path ends at ${endX}`)
  })

  it('each state picks its own head, width and colour from the stylesheet', async () => {
    const { root, done } = await shadowSvg(
      '<svg width="300" height="100"><g class="arrow-g" style="--ac:#123456;--ac-hi:#abcdef;--ac-sel:#fedcba;--aw:1.5px;' +
      '--mk:url(#k-rest);--mk-hi:url(#k-hi);--mk-sel:url(#k-sel)"><path class="arrow-path" d="M 0 50 L 300 50"></path></g></svg>')
    try {
      const g = root.querySelector('.arrow-g'), path = root.querySelector('.arrow-path')
      const cs = () => getComputedStyle(path)
      assert.includes(cs().markerEnd, 'k-rest')
      assert.eq(cs().strokeWidth, '1.5px')
      assert.eq(cs().stroke, 'rgb(18, 52, 86)')
      g.classList.add('related')
      assert.includes(cs().markerEnd, 'k-hi', 'a related line brightens its head too')
      assert.eq(cs().strokeWidth, '2px')
      assert.eq(cs().strokeDasharray, 'none', 'and stays solid')
      g.classList.remove('related'); g.classList.add('sel')
      assert.includes(cs().markerEnd, 'k-sel')
      assert.eq(cs().strokeWidth, '2.5px')
      assert.eq(cs().markerStart, 'none', 'one-way: no tail head')
      g.classList.add('bidir')
      assert.includes(cs().markerStart, 'k-sel', 'two-way: the same head at the start')
      assert.eq(path.getAnimations().length, 0)
    } finally { done() }
  })

  it('a dashed pattern survives the stylesheet in every state', async () => {
    reset()
    block('a', 0, 0); block('b', 400, 0)
    arrow('x', 'a', 'b', { pattern: 'dashed' })
    renderArrows({ cheap: true })
    const dash = document.querySelector('#arrowsGroup [data-aid="x"] .arrow-path').style.strokeDasharray
    assert.ok(dash, 'inline dash set')
    const { root, done } = await shadowSvg(
      `<svg width="300" height="100"><g class="arrow-g sel related"><path class="arrow-path" style="stroke-dasharray:${dash}" d="M 0 50 L 300 50"></path></g></svg>`)
    try {
      const computed = getComputedStyle(root.querySelector('.arrow-path')).strokeDasharray
      assert.ok(computed.split(/[ ,]+/).map(parseFloat).some(n => n > 0), `computed ${computed}`)
    } finally { done() }
  })

  it('the hit area stays about 12 screen px wide when zoomed out', async () => {
    const { root, done } = await shadowSvg(
      '<svg width="300" height="100" style="--px:2.5px"><g class="arrow-g" style="--aw:1.5px"><path class="arrow-hitbox" d="M 0 50 L 300 50"></path></g></svg>')
    try {
      assert.eq(getComputedStyle(root.querySelector('.arrow-hitbox')).strokeWidth, '30px')
    } finally { done() }
  })

  it('a press on a line picks that line, even where a neighbour\'s wide hit area covers it', async () => {
    reset()
    block('a', 0, 0); block('b', 400, 0)
    arrow('x', 'a', 'b', { style: 'straight' })
    arrow('y', 'b', 'a', { style: 'straight' })
    selection.arrowId = 'x'
    renderArrows({ cheap: false })
    selection.arrowId = null
    const routes = resolveRoutes({ cheap: false })
    const yx = routes.get('x').y1, yy = routes.get('y').y1
    assert.eq(yy - yx, 16, 'two lanes 16 apart')
    const hits = $.arrowsGroup().querySelector(':scope > .arrow-hits')
    assert.ok(hits, 'a narrow hit layer')
    assert.eq(hits.nextElementSibling, $.arrowsGroup().lastElementChild, 'right under the labels')
    assert.eq(hits.previousElementSibling.dataset.aid, 'y', 'above every line')
    assert.eq(hits.lastElementChild.dataset.end, 'to', 'the handles come last')
    // One screen pixel is 3.33 world units (zoom 0.3): the 12px wide areas
    // (40 units) of two lines 16 units apart overlap by far.
    const { root, done } = await shadowAt(
      `<svg width="700" height="120" style="--px:3.3333px;overflow:visible">${$.arrowsGroup().outerHTML}</svg>`)
    try {
      const at = (x, y) => root.elementFromPoint(x, y)?.closest('[data-aid]')?.dataset.aid
      assert.eq(at(300, yx), 'x', 'on x\'s stroke')
      assert.eq(at(300, yy), 'y', 'on y\'s stroke')
      assert.eq(at(300, yx - 12), 'x', 'near a line still selects it')
      const handle = root.elementFromPoint(routes.get('x').x1, yx)
      assert.ok(handle?.classList.contains('arrow-handle'), 'the endpoint handle is above the hit areas')
      assert.eq(handle.dataset.end, 'from')
    } finally { done() }
  })

  it('applyTransform publishes one screen pixel in world units', () => {
    const saved = { ...view }
    try {
      view.zoom = 0.5
      applyTransform()
      assert.eq($.arrowsLayer().style.getPropertyValue('--px'), '2.0000px')
    } finally { Object.assign(view, saved); applyTransform() }
  })

  it('hovering a card fades unrelated lines and their labels as a whole', async () => {
    const { root, done } = await shadowSvg(
      '<div class="canvas-root has-hover"><svg width="300" height="100">' +
      '<g class="arrow-g"><path class="arrow-path" d="M 0 10 L 300 10"></path></g>' +
      '<g class="arrow-g related"><path class="arrow-path" d="M 0 50 L 300 50"></path></g>' +
      '<g class="arrow-labels"><g class="arrow-label-g"><rect class="arrow-label-bg"></rect></g>' +
      '<g class="arrow-label-g related"><rect class="arrow-label-bg"></rect></g></g></svg></div>')
    try {
      const [plain, rel] = root.querySelectorAll('.arrow-g')
      const [lp, lr] = root.querySelectorAll('.arrow-label-g')
      assert.eq(getComputedStyle(plain).opacity, '0.18')
      assert.eq(getComputedStyle(rel).opacity, '1')
      assert.eq(getComputedStyle(lp).opacity, '0.18')
      assert.eq(getComputedStyle(lr).opacity, '1')
    } finally { done() }
  })

  it('defines opaque edge tokens for both themes and no infinite line animation', async () => {
    const { css } = await realSheet()
    const lines = css.slice(css.indexOf('/* ════ [lines] ════ */'), css.indexOf('/* ════ [chrome] ════ */'))
    assert.gt(lines.length, 100, 'found the section')
    assert.match(lines, /:root\s*{[^}]*--edge:\s*#7c8196/)
    assert.match(lines, /body\.light-mode\s*{[^}]*--edge:\s*#6b7280/)
    assert.ok(!/infinite/.test(lines))
    assert.match(lines, /prefers-reduced-motion: reduce/)
    assert.ok(!/arrowFlow/.test(css), 'the marching animation is gone')
    // Tokens derived from the text colours must be declared where the theme
    // classes redefine those (body), or they freeze at the dark values.
    const rootRule = lines.match(/:root\s*{[^}]*}/)[0]
    assert.ok(!/var\(--text-/.test(rootRule), 'no text-derived token on :root')
    assert.match(lines, /\nbody\s*{[^}]*--edge-sel:\s*var\(--text-primary\)/)
    // Card styles belong to the cards; a hovered line rings its cards in SVG.
    assert.ok(!/\.block\b/.test(lines.replace(/\/\*[\s\S]*?\*\//g, '')), 'no .block rule in [lines]')
  })

  it('two colours never share a minted head', () => {
    assert.neq(arrowMarker('rgb(1,23,4)', 2), arrowMarker('rgb(12,3,4)', 2))
  })

  it('new connections default to weight 1.5, saved ones keep theirs', () => {
    reset()
    block('a', 0, 0); block('b', 400, 0)
    const id = addArrow('a', 'b')
    assert.eq(state.arrows.find(a => a.id === id).weight, 1.5)
    arrow('old', 'b', 'a', { weight: 2 })
    renderArrows({ cheap: true })
    const g = document.querySelector('#arrowsGroup [data-aid="old"]')
    assert.eq(g.style.getPropertyValue('--aw'), '2px')
  })
})

// ── Labels ───────────────────────────────────────────────────

describe('lines: labels', () => {
  it('sit on the longest straight run, clear of every bend', () => {
    reset()
    block('a', 0, 0, 220, 62)
    block('b', 500, 300, 220, 62)
    arrow('x', 'a', 'b', { label: 'feeds', fromPort: 'right', toPort: 'left' })
    const routes = resolveRoutes({ cheap: false })
    const pts = routes.get('x')
    const poly = arrowPolyline(pts, 'routed')
    assert.ok(poly.length > 2, 'the route bends')
    const lp = placeLabels(routes).get('x')
    for (let i = 1; i < poly.length - 1; i++) {
      assert.gt(Math.hypot(lp.x - poly[i].x, lp.y - poly[i].y), ROUTE_DEFAULTS.corner, 'not on a corner')
    }
    const anc = labelAnchor(poly)
    assert.eq(Math.round(anc.x), lp.x); assert.eq(Math.round(anc.y), lp.y)
  })

  it('never overlap each other or a card', () => {
    reset()
    block('hub', 500, 200, 220, 100)
    for (let i = 0; i < 4; i++) { block('s' + i, 0, i * 110, 220, 62); arrow('a' + i, 's' + i, 'hub', { label: 'depends on data ' + i }) }
    const labels = [...placeLabels(resolveRoutes({ cheap: false })).values()].filter(l => l.text)
    assert.eq(labels.length, 4)
    const box = l => ({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h })
    const hit = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) assert.ok(!hit(box(labels[i]), box(labels[j])), 'labels overlap')
      Object.keys(state.blocks).forEach(id => assert.ok(!hit(box(labels[i]), rectOf(id)), 'label on a card'))
    }
  })

  it('paint after every line, as pills that carry the connection id', () => {
    reset()
    block('a', 0, 0); block('b', 400, 0); block('c', 0, 300)
    arrow('x', 'a', 'b', { label: 'first' })
    arrow('y', 'c', 'b', { label: 'second', note: 'why it matters' })
    renderArrows({ cheap: true })
    const group = $.arrowsGroup()
    const layer = group.lastElementChild
    assert.ok(layer.classList.contains('arrow-labels'), 'the labels layer is last')
    const tag = layer.querySelector('[data-aid="y"]')
    assert.ok(tag.querySelector('rect.arrow-label-bg'), 'pill background')
    assert.eq(tag.querySelector('.arrow-label').textContent, 'second')
    assert.ok(tag.classList.contains('has-note'))
    assert.includes(tag.querySelector('.arrow-note').textContent, 'why it matters')
    // A line added later still paints under every label.
    arrow('z', 'a', 'c', { label: 'third' })
    renderArrows({ cheap: true })
    assert.ok(group.lastElementChild.classList.contains('arrow-labels'))
    // The card-hover code marks lines; labels follow.
    group.querySelector(':scope > [data-aid="x"]').classList.add('related')
    syncArrowStates()
    assert.ok(layer.querySelector('[data-aid="x"]').classList.contains('related'))
  })

  it('hovering a connection brightens it and its label and marks the cards it joins', () => {
    reset()
    block('a', 0, 0); block('b', 400, 0)
    arrow('x', 'a', 'b', { label: 'feeds' })
    renderArrows({ cheap: true })
    setupArrowHover()
    const hit = $.arrowsGroup().querySelector(':scope > [data-aid="x"] .arrow-hitbox')
    hit.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
    assert.ok($.arrowsGroup().querySelector(':scope > [data-aid="x"]').classList.contains('hover'), 'line')
    assert.ok($.arrowsGroup().querySelector('.arrow-labels [data-aid="x"]').classList.contains('hover'), 'label')
    assert.ok(document.getElementById('b-a').classList.contains('edge-end'), 'source card')
    assert.ok(document.getElementById('b-b').classList.contains('edge-end'), 'target card')
    const rings = [...$.arrowsGroup().querySelectorAll('.arrow-end-ring')]
    assert.deepEq(rings.map(r => r.dataset.bid), ['a', 'b'], 'a ring around each card, drawn under the cards')
    assert.eq(+rings[1].getAttribute('x'), 396)
    assert.eq($.arrowsGroup().firstElementChild.classList.contains('arrow-rings'), true, 'under every line')
    hit.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }))
    assert.eq($.arrowsGroup().querySelector('.hover'), null)
    assert.eq($.arrowsGroup().querySelectorAll('.arrow-end-ring').length, 0)
    assert.ok(!document.getElementById('b-a').classList.contains('edge-end'))
  })

  it('try the other straight runs of their own line before stepping off it', () => {
    reset()
    arrow('x', 'p', 'q', { label: 'feeds into' })
    const routes = new Map([['x', { x1: 0, y1: 0, d1: 'right', x2: 500, y2: 200, d2: 'left',
      points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 500, y: 200 }] }]])
    // Lines across the whole longest run, closer together than a label is wide.
    for (let i = 0; i < 11; i++) {
      const cx = 5 + i * 30
      arrow('c' + i, 'p', 'q')
      routes.set('c' + i, { x1: cx, y1: -60, d1: 'bottom', x2: cx, y2: 40, d2: 'top', points: [{ x: cx, y: -60 }, { x: cx, y: 40 }] })
    }
    const lp = placeLabels(routes).get('x')
    assert.deepEq({ x: lp.x, y: lp.y }, { x: 300, y: 100 }, 'on its second run, not on the others\' lines')
    assert.eq(lp.leader, null, 'on its own line: no leader')
  })

  it('a label that has to step off its line gets a leader back to it', () => {
    reset()
    arrow('x', 'p', 'q', { label: 'feeds into' })
    const routes = new Map([['x', { x1: 0, y1: 0, d1: 'right', x2: 400, y2: 0, d2: 'left',
      points: [{ x: 0, y: 0 }, { x: 400, y: 0 }] }]])
    for (let i = 0; i < 20; i++) {
      const cx = 10 + i * 20
      arrow('c' + i, 'p', 'q')
      routes.set('c' + i, { x1: cx, y1: -10, d1: 'bottom', x2: cx, y2: 10, d2: 'top', points: [{ x: cx, y: -10 }, { x: cx, y: 10 }] })
    }
    const lp = placeLabels(routes).get('x')
    assert.eq(lp.y, 28, 'beside the line, clear of the others')
    assert.deepEq(lp.leader, { x1: lp.x, y1: 0, x2: lp.x, y2: 28 - lp.h / 2 })
  })

  it('never settle on a card while there is room further out, and draw the leader', () => {
    reset()
    block('a', 0, 0, 100, 40); block('b', 1000, 0, 100, 40)
    block('c', 100, -30, 860, 40); block('d', 100, 30, 860, 40)
    arrow('x', 'a', 'b', { style: 'straight', label: 'feeds into' })
    renderArrows({ cheap: false })
    const lp = placeLabels(resolveRoutes({ cheap: false })).get('x')
    const box = { x: lp.x - lp.w / 2, y: lp.y - lp.h / 2, w: lp.w, h: lp.h }
    ;['a', 'b', 'c', 'd'].forEach(id => {
      const r = rectOf(id)
      assert.ok(!(box.x < r.x + r.w && r.x < box.x + box.w && box.y < r.y + r.h && r.y < box.y + box.h), `label on card ${id}`)
    })
    assert.ok(lp.leader, 'a leader back to the line')
    assert.eq(lp.leader.y1, 20)
    const lead = $.arrowsGroup().querySelector('.arrow-labels [data-aid="x"] .arrow-label-leader')
    assert.eq(lead.style.display, '')
    assert.eq(+lead.getAttribute('y1'), 20); assert.eq(+lead.getAttribute('y2'), lp.leader.y2)
    const svg = buildSvg().svg
    assert.includes(svg, `<line x1="${lp.leader.x1}" y1="20" x2="${lp.leader.x2}" y2="${lp.leader.y2}"`, 'the export draws it too')
  })

  it('go when their connection is deleted', () => {
    reset()
    block('a', 0, 0); block('b', 400, 0)
    arrow('x', 'a', 'b', { label: 'gone soon' })
    renderArrows({ cheap: true })
    deleteArrow('x')
    pruneArrowLabels()
    assert.eq($.arrowsGroup().querySelector('.arrow-labels [data-aid="x"]'), null)
    assert.eq($.arrowsGroup().querySelector('[data-aid="x"]'), null, 'and its narrow hit area')
  })
})

// ── Drag ─────────────────────────────────────────────────────

describe('lines: dragging', () => {
  it('an unchanged canvas reuses its separated routes; a drag frame keeps them for lines it does not move', () => {
    loadUserCanvas()
    invalidateRoutes()
    const first = resolveRoutes({ cheap: false })
    const again = resolveRoutes({ cheap: false })
    let routed = 0
    first.forEach((pts, aid) => {
      if (!(pts.points?.length > 2)) return
      routed++
      assert.eq(again.get(aid).points, pts.points, 'the same result, not separated again')
    })
    assert.gt(routed, 3)
    const mover = titled('Team Central')
    try {
      selection.ids.add(mover)
      pointer.ix = { type: 'block', id: mover, moved: true }
      state.blocks[mover].x += 40
      const frame = resolveRoutes({ cheap: true, moving: new Set([mover]) })
      let kept = 0
      first.forEach((pts, aid) => {
        const a = state.arrows.find(x => x.id === aid)
        if (a.from === mover || a.to === mover || !(pts.points?.length > 2)) return
        const f = frame.get(aid)
        if (f.x1 !== pts.x1 || f.y1 !== pts.y1 || f.x2 !== pts.x2 || f.y2 !== pts.y2) return
        kept++
        assert.eq(f.points, pts.points, 'a line the drag does not touch keeps its separated route')
      })
      assert.gt(kept, 3)
    } finally {
      pointer.ix = null
      selection.ids.clear()
      state.blocks[mover].x -= 40
    }
    // After a real move the next full pass separates afresh.
    state.blocks[titled('Key Results')].y += 30
    const moved = resolveRoutes({ cheap: false })
    assert.neq(moved.get(state.arrows.find(a => a.from === titled('Key Results')).id).points,
      first.get(state.arrows.find(a => a.from === titled('Key Results')).id).points)
    assert.deepEq(sharedRuns(moved), [])
  })

  it('only the dragged block\'s connections go cheap; the rest keep their route', () => {
    reset()
    block('a', 0, 0); block('b', 400, 200)
    block('p', 0, 800); block('q', 400, 1000)
    arrow('moving', 'a', 'b')
    arrow('still', 'p', 'q')
    resolveRoutes({ cheap: false })
    try {
      selection.ids.add('a')
      pointer.ix = { type: 'block', id: 'a', moved: true }
      state.blocks.a.x += 37
      const routes = resolveRoutes({ cheap: true, moving: new Set(['a']) })
      assert.ok(!routes.get('moving').points, 'the dragged connection draws cheaply')
      assert.ok(routes.get('still').points?.length > 2, 'the other keeps its routed path')
    } finally {
      pointer.ix = null
      selection.ids.clear()
    }
  })
})

// ── Inline label editor ──────────────────────────────────────

function withViewport(fn) {
  const vp = $.canvasViewport()
  const saved = vp.getAttribute('style')
  const savedView = { ...view }
  vp.style.cssText = 'display:block;position:fixed;left:0;top:0;width:900px;height:600px;overflow:hidden;opacity:0'
  view.panX = 0; view.panY = 0; view.zoom = 1
  try { return fn(vp) } finally {
    if (isArrowLabelEditing()) commitArrowLabelEdit()
    if (saved == null) vp.removeAttribute('style'); else vp.setAttribute('style', saved)
    Object.assign(view, savedView)
    deselectAll()
  }
}

const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))

describe('lines: inline label editor', () => {
  it('opens a labelled field over the canvas and Enter commits in one undo step', () => {
    reset()
    block('a', 40, 40); block('b', 440, 40)
    arrow('x', 'a', 'b')
    renderArrows({ cheap: false })
    withViewport(vp => {
      assert.ok(startArrowLabelEdit('x'))
      const wrap = vp.querySelector('.arrow-edit')
      assert.ok(wrap && wrap.hasAttribute('data-canvas-ui'), 'canvas UI, so presses stay in it')
      const input = wrap.querySelector('input')
      assert.eq(input.getAttribute('aria-label'), 'Connection label')
      assert.eq(document.activeElement, input)
      const before = getUndoHistory().length
      input.value = 'feeds'
      key(input, 'Enter')
      assert.eq(state.arrows[0].label, 'feeds')
      assert.eq(getUndoHistory().length, before + 1)
      assert.ok(!isArrowLabelEditing())
      assert.eq(vp.querySelector('.arrow-edit'), null)
    })
  })

  it('Escape and blur commit too, empty clears, and no change takes no undo step', () => {
    reset()
    block('a', 40, 40); block('b', 440, 40)
    arrow('x', 'a', 'b', { label: 'old' })
    renderArrows({ cheap: false })
    withViewport(vp => {
      startArrowLabelEdit('x')
      let input = vp.querySelector('.arrow-edit input')
      assert.eq(input.value, 'old')
      input.value = 'new'
      key(input, 'Escape')
      assert.eq(state.arrows[0].label, 'new', 'Escape keeps what was typed')
      startArrowLabelEdit('x')
      input = vp.querySelector('.arrow-edit input')
      input.value = '   '
      // A headless page without system focus fires no real blur; send one.
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
      assert.eq(state.arrows[0].label, '', 'blur commits; empty clears')
      const before = getUndoHistory().length
      startArrowLabelEdit('x')
      key(vp.querySelector('.arrow-edit input'), 'Enter')
      assert.eq(getUndoHistory().length, before, 'nothing changed, nothing to undo')
    })
  })

  it('offers the five relations as chips; a chip sets the meaning in one step', () => {
    reset()
    block('a', 40, 40); block('b', 440, 40)
    arrow('x', 'a', 'b')
    renderArrows({ cheap: false })
    withViewport(vp => {
      startArrowLabelEdit('x')
      const chips = [...vp.querySelectorAll('.arrow-edit [data-relation]')]
      assert.eq(chips.length, Object.keys(RELATIONS).length)
      chips.forEach(c => assert.eq(c.tagName, 'BUTTON'))
      const before = getUndoHistory().length
      const blocks = chips.find(c => c.dataset.relation === 'blocks')
      blocks.click()
      assert.eq(state.arrows[0].relation, 'blocks')
      assert.eq(getUndoHistory().length, before + 1)
      assert.eq(blocks.getAttribute('aria-pressed'), 'true')
      assert.ok(isArrowLabelEditing(), 'the editor stays open')
      blocks.click()
      assert.eq(state.arrows[0].relation, null, 'pressing it again clears it')
    })
  })

  it('suggests the verb the two card types imply', () => {
    reset()
    block('a', 40, 40, 220, 62, { type: 'implementation' }); block('b', 440, 40, 220, 62, { type: 'output' })
    arrow('x', 'a', 'b')
    renderArrows({ cheap: false })
    withViewport(vp => {
      startArrowLabelEdit('x')
      const input = vp.querySelector('.arrow-edit input')
      assert.includes(input.placeholder, 'produces')
      vp.querySelector('.arrow-edit .suggest').click()
      assert.eq(input.value, 'produces')
      key(input, 'Enter')
      assert.eq(state.arrows[0].label, 'produces')
    })
  })

  it('sits on the label, and follows pan and zoom', () => {
    reset()
    block('a', 40, 40); block('b', 440, 40)
    arrow('x', 'a', 'b', { label: 'feeds' })
    renderArrows({ cheap: false })
    withViewport(vp => {
      startArrowLabelEdit('x')
      const wrap = vp.querySelector('.arrow-edit')
      const tag = $.arrowsGroup().querySelector('.arrow-labels [data-aid="x"] .arrow-label')
      assert.eq(parseFloat(wrap.style.left), +tag.getAttribute('x'))
      assert.eq(parseFloat(wrap.style.top), +tag.getAttribute('y'))
      view.panX = 100; view.zoom = 2
      applyTransform()
      assert.eq(parseFloat(wrap.style.left), +tag.getAttribute('x') * 2 + 100)
    })
  })

  it('opens where the line was clicked when there is no label yet', () => {
    reset()
    block('a', 40, 40); block('b', 640, 40)
    arrow('x', 'a', 'b')
    renderArrows({ cheap: false })
    withViewport(vp => {
      startArrowLabelEdit('x', { clientX: 300, clientY: 90 })
      const wrap = vp.querySelector('.arrow-edit')
      assert.eq(parseFloat(wrap.style.left), 300)
      assert.eq(parseFloat(wrap.style.top), 71, 'snapped onto the line')
    })
    assert.deepEq(nearestOnPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 40, 30), { x: 40, y: 0 })
  })

  it('Enter or F2 on a selected connection opens it, never while typing', () => {
    reset()
    block('a', 40, 40); block('b', 440, 40)
    arrow('x', 'a', 'b')
    renderArrows({ cheap: false })
    withViewport(vp => {
      selectArrow('x')
      document.activeElement?.blur?.()
      const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
      onKeydown(enter)
      assert.ok(isArrowLabelEditing(), 'Enter opened it')
      assert.ok(enter.defaultPrevented)
      commitArrowLabelEdit()
      selectArrow('x')
      document.activeElement?.blur?.()
      onKeydown(new KeyboardEvent('keydown', { key: 'F2', cancelable: true }))
      assert.ok(isArrowLabelEditing(), 'F2 opened it')
      commitArrowLabelEdit()
      selectArrow('x')
      const field = document.createElement('input')
      document.body.appendChild(field)
      field.focus()
      onKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
      field.remove()
      assert.ok(!isArrowLabelEditing(), 'typing elsewhere is left alone')
    })
  })

  it('does nothing in a read-only view', () => {
    reset()
    block('a', 40, 40); block('b', 440, 40)
    arrow('x', 'a', 'b')
    renderArrows({ cheap: false })
    withViewport(vp => {
      ui.readOnly = true
      try {
        assert.eq(startArrowLabelEdit('x'), false)
        assert.eq(vp.querySelector('.arrow-edit'), null)
        selection.arrowId = 'x'
        onKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
        assert.ok(!isArrowLabelEditing())
      } finally { ui.readOnly = false }
    })
  })

  it('keys pressed on a focused chip stay in the editor', () => {
    reset()
    setupKeyboardShortcuts()
    block('a', 40, 40); block('b', 440, 40)
    arrow('x', 'a', 'b')
    renderArrows({ cheap: false })
    withViewport(vp => {
      const zen = document.body.dataset.zen, chrome = document.body.dataset.chrome
      assert.ok(startArrowLabelEdit('x'))
      const chip = vp.querySelector('.arrow-edit [data-relation]')
      chip.focus()
      assert.eq(document.activeElement, chip)
      const reached = []
      const spy = e => reached.push(e.key)
      document.addEventListener('keydown', spy)
      try {
        for (const k of ['Backspace', 'Delete', 'z', 'h', 'l']) key(chip, k)
        key(chip, 'Tab')
      } finally { document.removeEventListener('keydown', spy) }
      assert.deepEq(reached, ['Tab'], 'only Tab leaves the editor')
      assert.eq(state.arrows.length, 1, 'Backspace did not delete the connection being edited')
      assert.ok(isArrowLabelEditing(), 'the editor is still open')
      assert.eq(document.body.dataset.zen, zen, 'z did not switch on Zen')
      assert.eq(document.body.dataset.chrome, chrome, 'h did not hide the chrome')
    })
  })

  it('opened near the bottom edge it keeps the view and flips its chips above the field', async () => {
    reset()
    block('a', 40, 544); block('b', 440, 544)
    arrow('x', 'a', 'b')
    renderArrows({ cheap: false })
    await withAppStyles(() => withViewport(vp => {
      const before = JSON.stringify(view)
      assert.ok(startArrowLabelEdit('x', { clientX: 330, clientY: 575 }))
      assert.eq(JSON.stringify(view), before, 'the canvas did not move under the pointer')
      const wrap = vp.querySelector('.arrow-edit')
      assert.ok(wrap.classList.contains('flip'), 'chips above the field')
      const r = wrap.getBoundingClientRect(), f = wrap.querySelector('input').getBoundingClientRect()
      assert.ok(r.top >= 0 && r.bottom <= 600, `on screen: ${r.top}..${r.bottom}`)
      assert.ok(Math.abs((f.top + f.bottom) / 2 - 575) <= 2, 'the field stays on the line')
    }))
  })

  it('opened near a side edge it keeps the view and shifts the box on screen', async () => {
    reset()
    block('a', -400, 100); block('b', 400, 100)
    arrow('x', 'a', 'b')
    renderArrows({ cheap: false })
    await withAppStyles(() => withViewport(vp => {
      const before = JSON.stringify(view)
      assert.ok(startArrowLabelEdit('x', { clientX: 12, clientY: 131 }))
      assert.eq(JSON.stringify(view), before, 'the canvas did not move')
      const wrap = vp.querySelector('.arrow-edit')
      assert.eq(wrap.style.left, '12px', 'still anchored where it was opened')
      const r = wrap.getBoundingClientRect()
      assert.ok(r.left >= 0 && r.right <= 900, `on screen: ${r.left}..${r.right}`)
    }))
  })

  it('a label that really is off screen is still brought into view', () => {
    reset()
    block('a', 3000, 40); block('b', 3400, 40)
    arrow('x', 'a', 'b', { label: 'far away' })
    renderArrows({ cheap: false })
    withViewport(vp => {
      selectArrow('x')
      assert.ok(startArrowLabelEdit('x'))
      const left = parseFloat(vp.querySelector('.arrow-edit').style.left)
      assert.ok(left > 0 && left < 900, `recentred: ${left}`)
    })
  })
})

// ── Tidy ─────────────────────────────────────────────────────

describe('lines: Tidy and pins', () => {
  it('Tidy may restamp pins that came from an import', () => {
    reset()
    block('a', 0, 0); block('b', 0, 300)
    arrow('x', 'a', 'b', { fromPort: 'top', toPort: 'bottom', portsBy: 'import' })
    tidyCanvas({ direction: 'LR' })
    assert.eq(state.arrows[0].portsBy, 'tidy')
    assert.eq(state.arrows[0].fromPort, 'right')
    assert.eq(state.arrows[0].toPort, 'left')
  })

  it('moving a block releases import pins like tidy ones, never a hand pin', () => {
    reset()
    block('a', 0, 0); block('b', 400, 0); block('c', 0, 300)
    arrow('imp', 'a', 'b', { fromPort: 'top', toPort: 'top', portsBy: 'import' })
    arrow('hand', 'a', 'c', { fromPort: 'bottom', toPort: 'top' })
    assert.eq(releaseTidyPins(['a']), 1)
    assert.eq(state.arrows[0].fromPort, null)
    assert.eq(state.arrows[0].portsBy, undefined)
    assert.eq(state.arrows[1].fromPort, 'bottom')
  })

  it('reports lines left under a card, not only crossings', () => {
    reset()
    block('a', 0, 0); block('m', 300, 0); block('b', 600, 0)
    arrow('x', 'a', 'b', { style: 'straight' })
    assert.deepEq(linesUnderCards(resolveRoutes({ cheap: true })), ['x'])
    const msg = tidySummary({ moved: 3, crossings: 0, underCards: 2 }, 3, 'LR')
    assert.includes(msg, '2 lines under a card')
    assert.includes(msg, '0 crossings')
    assert.notIncludes(tidySummary({ moved: 3, crossings: 1, underCards: 0 }, 3, 'TB'), 'under a card')
    const r = tidyCanvas({ direction: 'LR' })
    assert.eq(typeof r.underCards, 'number')
  })

  it('still reports lines under a card when there was nothing to move', () => {
    assert.eq(tidySummary({ moved: 0, crossings: 0, underCards: 3 }, 5, 'LR'), 'Already arranged, 3 lines under a card')
    assert.eq(tidySummary({ moved: 0, crossings: 0, underCards: 1 }, 5, 'LR'), 'Already arranged, 1 line under a card')
    assert.eq(tidySummary({ moved: 0, crossings: 0, underCards: 0 }, 5, 'LR'), 'Already arranged')
  })
})

// ── Export ───────────────────────────────────────────────────

describe('lines: image export mirrors the canvas', () => {
  it('uses bounded user-unit heads, pills for labels and the line pattern', () => {
    reset()
    block('a', 0, 0); block('b', 400, 0)
    arrow('x', 'a', 'b', { label: 'feeds', pattern: 'dotted', weight: 5 })
    const doc = new DOMParser().parseFromString(buildSvg().svg, 'image/svg+xml')
    const m = doc.querySelector('marker')
    assert.eq(m.getAttribute('markerUnits'), 'userSpaceOnUse')
    assert.ok(+m.getAttribute('markerWidth') <= 16)
    const path = doc.querySelector('path')
    assert.ok(path.getAttribute('stroke-dasharray'))
    assert.eq(doc.querySelectorAll('path').length, 1)
    const pill = [...doc.querySelectorAll('rect')].find(r => r.getAttribute('rx') === '9')
    assert.ok(pill, 'label pill')
    const lp = placeLabels(resolveRoutes()).get('x')
    const text = [...doc.querySelectorAll('text')].find(t => t.textContent === 'feeds')
    assert.eq(+text.getAttribute('x'), lp.x, 'same placement as the canvas')
  })

  it('fades the lines and labels with the spotlight, as the canvas does', () => {
    reset()
    block('a', 0, 0, 220, 62, { highlight: 'focus' }); block('b', 400, 0)
    arrow('x', 'a', 'b', { label: 'feeds' })
    const parse = () => new DOMParser().parseFromString(buildSvg().svg, 'image/svg+xml')
    assert.eq(parse().querySelector('path').parentNode.getAttribute('opacity'), null, 'no spotlight, no fade')
    canvasMeta.spotlight = true
    try {
      const doc = parse()
      assert.eq(doc.querySelector('path').parentNode.getAttribute('opacity'), '0.35')
      const text = [...doc.querySelectorAll('text')].find(t => t.textContent === 'feeds')
      assert.eq(text.parentNode.getAttribute('opacity'), '0.35')
    } finally { canvasMeta.spotlight = false }
  })
})
