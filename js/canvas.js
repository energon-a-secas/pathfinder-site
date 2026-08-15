// ════════════════════════════════════════════════════════════
//  canvas.js — Canvas connections/lines drawing (SVG), drag behavior
// ════════════════════════════════════════════════════════════

import { state, view, selection, ui, pointer, debouncedSaveView } from './state.js'
import { $, clamp, escHtml, getBlockDims, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { routeOrtho, polyToPath, polyMidpoint } from './route.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

// ── Theme-aware helpers ─────────────────────────────────────
export function isLight() { return ui.lightMode }

const LIGHT_MARKERS = {
  'arrowhead': 'arrowhead-light',
  'arrowhead-sel': 'arrowhead-light-sel',
  'arrowhead-pre': 'arrowhead-light-pre',
  'arrowhead-back': 'arrowhead-light-back',
  'arrowhead-back-sel': 'arrowhead-light-back-sel',
}

function markerRef(base) {
  return isLight() ? `url(#${LIGHT_MARKERS[base] || base})` : `url(#${base})`
}

// The stock markers bake their fill in, so a recoloured arrow used to keep a
// white head. Mint one marker per colour on demand and reuse it.
const mintedMarkers = new Set()
export function colorMarker(color, back = false) {
  const key = (back ? 'b' : 'f') + color.replace(/[^0-9a-zA-Z]/g, '')
  const id = 'ah-' + key
  if (!mintedMarkers.has(id)) {
    const defs = $.arrowsLayer()?.querySelector('defs')
    if (!defs) return markerRef(back ? 'arrowhead-back' : 'arrowhead')
    if (!defs.querySelector('#' + id)) {
      const m = document.createElementNS(SVG_NS, 'marker')
      m.setAttribute('id', id)
      m.setAttribute('markerWidth', '10')
      m.setAttribute('markerHeight', '7')
      m.setAttribute('refX', back ? '1' : '9')
      m.setAttribute('refY', '3.5')
      m.setAttribute('orient', 'auto')
      const poly = document.createElementNS(SVG_NS, 'polygon')
      poly.setAttribute('points', back ? '10 0, 0 3.5, 10 7' : '0 0, 10 3.5, 0 7')
      poly.setAttribute('fill', color)
      m.appendChild(poly)
      defs.appendChild(m)
    }
    mintedMarkers.add(id)
  }
  return `url(#${id})`
}

// ── Canvas transform + dot grid ──────────────────────────────
export function applyTransform() {
  const canvasRoot = $.canvasRoot()
  const canvasViewport = $.canvasViewport()
  canvasRoot.style.transform = `translate(${view.panX}px,${view.panY}px) scale(${view.zoom})`
  // Move dot grid with canvas
  const sz = 28 * view.zoom
  const dotColor = isLight() ? 'rgba(15,23,42,.09)' : 'rgba(255,255,255,.12)'
  canvasViewport.style.backgroundImage =
    `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`
  canvasViewport.style.backgroundSize = `${sz}px ${sz}px`
  canvasViewport.style.backgroundPosition =
    `${view.panX % sz}px ${view.panY % sz}px`
  $.zoomIndicator().textContent = Math.round(view.zoom * 100) + '%'
  debouncedSaveView()
}

// ── Arrow routing ────────────────────────────────────────────
const LANE_INSET = 14

/**
 * Where a connection meets a block.
 *
 * With the default index/count it returns the exact side midpoint, which is
 * what a single arrow wants. When several arrows share a side, each gets its
 * own lane spread along that side instead of all of them stacking on the
 * midpoint, where they fuse into what looks like one thick line.
 */
export function portPos(id, port, index = 0, count = 1) {
  const b = state.blocks[id]; if (!b) return null
  const { w, h } = getBlockDims(id)
  const frac = count > 1 ? (index + 1) / (count + 1) : 0.5
  const along = len => {
    const lo = Math.min(LANE_INSET, len / 2)
    return lo + (len - lo * 2) * frac
  }
  const ox = along(w), oy = along(h)
  const map = {
    left:   { x: b.x,      y: b.y + oy, dir: 'left'   },
    right:  { x: b.x + w,  y: b.y + oy, dir: 'right'  },
    top:    { x: b.x + ox, y: b.y,      dir: 'top'    },
    bottom: { x: b.x + ox, y: b.y + h,  dir: 'bottom' }
  }
  return map[port] || null
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

function blockCenter(id) {
  const b = state.blocks[id]; if (!b) return null
  const { w, h } = getBlockDims(id)
  return { x: b.x + w / 2, y: b.y + h / 2 }
}

// A cheap fingerprint of every block's box. Routes are only recomputed when
// something actually moved or resized, so panning and selecting cost nothing.
function canvasStamp() {
  let s = ''
  for (const id in state.blocks) {
    const b = state.blocks[id], { w, h } = getBlockDims(id)
    s += id + ':' + b.x + ',' + b.y + ',' + w + ',' + h + ';'
  }
  return s
}

const routeCache = new Map()
let routeStamp = null

export function invalidateRoutes() { routeCache.clear(); routeStamp = null }

function obstaclesFor(fromId, toId) {
  const out = []
  for (const id in state.blocks) {
    if (id === fromId || id === toId) continue
    const b = state.blocks[id], { w, h } = getBlockDims(id)
    out.push({ x: b.x, y: b.y, w, h })
  }
  return out
}

/**
 * Resolve every arrow's real endpoints in one pass.
 *
 * This is the single source of truth for arrow geometry: the live canvas and
 * the SVG/PNG exporter both call it, so an exported diagram cannot drift from
 * what is on screen. Pass `cheap` during a drag to skip the A* router; the
 * caller re-runs without it on pointerup.
 *
 * @returns {Map<string, {x1,y1,d1,x2,y2,d2,lane,laneCount,points?}>}
 */
export function resolveRoutes({ cheap = false } = {}) {
  const out = new Map()
  const sides = new Map()
  const endpoints = []

  state.arrows.forEach(a => {
    const base = bestPorts(a.from, a.to, a.fromPort, a.toPort)
    if (!base) return
    sides.set(a.id, base)
    endpoints.push({ aid: a.id, end: 'from', bid: a.from, side: base.d1, other: a.to })
    endpoints.push({ aid: a.id, end: 'to',   bid: a.to,   side: base.d2, other: a.from })
  })

  // Bucket endpoints by the side they land on, then order each bucket by where
  // its far end sits. Ordering by the far end is what keeps the lanes from
  // crossing each other on the way out.
  const buckets = new Map()
  endpoints.forEach(e => {
    const k = e.bid + '|' + e.side
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(e)
  })

  const lanes = new Map()
  buckets.forEach(list => {
    if (list.length > 1) {
      const horiz = list[0].side === 'left' || list[0].side === 'right'
      const key = e => {
        const c = blockCenter(e.other)
        return c ? (horiz ? c.y : c.x) : 0
      }
      list.sort((p, q) => key(p) - key(q))
    }
    list.forEach((e, i) => lanes.set(e.aid + '|' + e.end, { index: i, count: list.length }))
  })

  const wantsRouting = !cheap && state.arrows.some(a => a.style === 'routed')
  if (wantsRouting) {
    const stamp = canvasStamp()
    if (stamp !== routeStamp) { routeCache.clear(); routeStamp = stamp }
  }

  state.arrows.forEach(a => {
    const base = sides.get(a.id); if (!base) return
    const lf = lanes.get(a.id + '|from') || { index: 0, count: 1 }
    const lt = lanes.get(a.id + '|to')   || { index: 0, count: 1 }
    const p1 = portPos(a.from, base.d1, lf.index, lf.count)
    const p2 = portPos(a.to,   base.d2, lt.index, lt.count)
    if (!p1 || !p2) return
    const pts = {
      x1: p1.x, y1: p1.y, d1: p1.dir,
      x2: p2.x, y2: p2.y, d2: p2.dir,
      fromLane: lf.index, fromLaneCount: lf.count,
      toLane:   lt.index, toLaneCount:   lt.count,
      // Labels sit at the path midpoint, so they spread by whichever end
      // actually fans out. A fan-in to one hub is the common case and it is
      // the `to` end that is crowded there.
      lane:      lt.count > lf.count ? lt.index : lf.index,
      laneCount: Math.max(lf.count, lt.count),
    }
    if (wantsRouting && a.style === 'routed') {
      const key = a.id + '|' + pts.x1 + ',' + pts.y1 + ',' + pts.d1 + ',' + pts.x2 + ',' + pts.y2 + ',' + pts.d2
      if (routeCache.has(key)) {
        pts.points = routeCache.get(key)
      } else {
        const pl = routeOrtho(pts, obstaclesFor(a.from, a.to))
        routeCache.set(key, pl)
        pts.points = pl
      }
    }
    out.set(a.id, pts)
  })

  return out
}

export function cpOffset(x, y, dir, off) {
  return dir === 'right'  ? { x: x+off, y }
       : dir === 'left'   ? { x: x-off, y }
       : dir === 'bottom' ? { x, y: y+off }
       :                    { x, y: y-off }
}

export function buildPath(x1, y1, d1, x2, y2, d2, style = 'curved') {
  if (style === 'straight') {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }
  if (style === 'elbow') {
    // Both ends matter. Leaving horizontally and arriving vertically needs one
    // bend, not two, and using only d1 sent that case in through the wrong side.
    const h1 = d1 === 'right' || d1 === 'left'
    const h2 = d2 === 'right' || d2 === 'left'
    if (h1 && h2) {
      const mx = (x1 + x2) / 2
      return `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`
    }
    if (!h1 && !h2) {
      const my = (y1 + y2) / 2
      return `M ${x1} ${y1} V ${my} H ${x2} V ${y2}`
    }
    return h1 ? `M ${x1} ${y1} H ${x2} V ${y2}` : `M ${x1} ${y1} V ${y2} H ${x2}`
  }
  const off = clamp(Math.max(Math.abs(x2-x1), Math.abs(y2-y1)) * 0.38, 55, 130)
  const c1 = cpOffset(x1, y1, d1, off), c2 = cpOffset(x2, y2, d2, off)
  return `M ${x1} ${y1} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${x2} ${y2}`
}

/**
 * Build the SVG path for one resolved arrow. `routed` uses the polyline the
 * router produced; anything else falls through to the primitive shapes. A
 * routed arrow with no polyline (router declined, or a cheap drag pass) draws
 * as an elbow rather than disappearing.
 */
export function pathFor(pts, style = 'curved') {
  if (style === 'routed') {
    if (pts.points && pts.points.length > 1) return polyToPath(pts.points)
    return buildPath(pts.x1, pts.y1, pts.d1, pts.x2, pts.y2, pts.d2, 'elbow')
  }
  return buildPath(pts.x1, pts.y1, pts.d1, pts.x2, pts.y2, pts.d2, style)
}

export function arrowMidpoint(pts, style = 'curved') {
  if (style === 'routed' && pts.points && pts.points.length > 1) {
    return polyMidpoint(pts.points)
  }
  if (style === 'straight' || style === 'elbow' || style === 'routed') {
    return { x: (pts.x1 + pts.x2) / 2, y: (pts.y1 + pts.y2) / 2 }
  }
  const off = clamp(Math.max(Math.abs(pts.x2-pts.x1), Math.abs(pts.y2-pts.y1)) * 0.38, 55, 130)
  const c1 = cpOffset(pts.x1, pts.y1, pts.d1, off)
  const c2 = cpOffset(pts.x2, pts.y2, pts.d2, off)
  return {
    x: 0.125 * (pts.x1 + 3*c1.x + 3*c2.x + pts.x2),
    y: 0.125 * (pts.y1 + 3*c1.y + 3*c2.y + pts.y2)
  }
}

// ── Render arrows ────────────────────────────────────────────
export function renderArrows(opts = {}) {
  const arrowsGroup = $.arrowsGroup()
  const live = new Set(state.arrows.map(a => a.id))
  arrowsGroup.querySelectorAll('[data-aid]').forEach(g => { if (!live.has(g.dataset.aid)) g.remove() })

  // A drag re-renders arrows on every pointermove, so the A* router is skipped
  // while one is in flight and run once when the pointer comes back up.
  const routes = resolveRoutes({ cheap: opts.cheap ?? !!pointer.ix })

  state.arrows.forEach(a => {
    const pts   = routes.get(a.id); if (!pts) return
    const style = a.style || 'curved'
    const d     = pathFor(pts, style)
    const sel   = selection.arrowId === a.id

    let g = arrowsGroup.querySelector(`[data-aid="${a.id}"]`)
    if (!g) {
      g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.dataset.aid = a.id

      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      hit.classList.add('arrow-hitbox')
      g.appendChild(hit)

      const vis = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      vis.classList.add('arrow-path')
      g.appendChild(vis)

      const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      lbl.classList.add('arrow-label')
      g.appendChild(lbl)

      const note = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      note.classList.add('arrow-note')
      g.appendChild(note)

      arrowsGroup.appendChild(g)
    }

    const [hit, vis] = g.children
    hit.setAttribute('d', d)
    vis.setAttribute('d', d)
    vis.classList.toggle('selected', sel)
    g.classList.toggle('sel', sel)
    vis.removeAttribute('stroke-dasharray')
    if (style === 'dashed') vis.setAttribute('stroke-dasharray', '10 6')
    else if (style === 'dotted') vis.setAttribute('stroke-dasharray', '3 5')
    vis.setAttribute('marker-end', a.color
      ? colorMarker(a.color, false)
      : markerRef(sel ? 'arrowhead-sel' : 'arrowhead'))
    vis.setAttribute('marker-start', a.bidirectional
      ? (a.color ? colorMarker(a.color, true) : markerRef(sel ? 'arrowhead-back-sel' : 'arrowhead-back'))
      : '')

    // Color and weight via CSS custom properties (allow .related and hover to override via !important)
    const light = isLight()
    const defColor    = light ? 'rgba(0,0,0,.4)'  : 'rgba(255,255,255,.5)'
    const selColor    = light ? 'rgba(0,0,0,.72)' : 'rgba(255,255,255,.85)'
    const brightColor = light ? 'rgba(0,0,0,.6)'  : 'rgba(255,255,255,.75)'
    g.style.setProperty('--ac', sel ? (a.color || selColor) : (a.color || defColor))
    g.style.setProperty('--ac-hi', a.color || brightColor)
    g.style.setProperty('--aw', (a.weight || 2) + 'px')

    const lbl = g.children[2]
    const mid = arrowMidpoint(pts, style)
    // Parallel connections share a midpoint, so their labels would stack.
    // Nudge each one along its lane instead.
    let mx = mid.x, my = mid.y
    if (pts.laneCount > 1) {
      const spread = (pts.lane - (pts.laneCount - 1) / 2) * 15
      if (pts.d1 === 'left' || pts.d1 === 'right') my += spread
      else mx += spread
    }
    lbl.setAttribute('x', mx)
    lbl.setAttribute('y', my)
    lbl.textContent = a.label || ''
    lbl.style.display = a.label ? '' : 'none'
    lbl.classList.toggle('selected', sel)

    // Arrow note: richer annotation. Content is always rendered when present;
    // CSS decides whether it's visible (hover via .related, .sel, or the global
    // body.show-arrow-text setting) so hover reveal needs no arrow re-render.
    const noteEl = g.children[3]
    const noteText = (a.note || '').trim()
    if (noteText) {
      const lines = wrapNote(noteText)
      const startY = my + (a.label ? 15 : 4)
      noteEl.setAttribute('y', startY)
      noteEl.innerHTML = lines.map((ln, i) =>
        `<tspan x="${mx}" dy="${i === 0 ? 0 : 13}">${escHtml(ln)}</tspan>`).join('')
      g.classList.add('has-note')
      noteEl.classList.toggle('selected', sel)
    } else {
      noteEl.textContent = ''
      g.classList.remove('has-note')
    }

    // Endpoint handles, only on the selected arrow. Dragging one re-pins that
    // end to whichever port it lands on, or re-targets the whole connection.
    // Appended after the four fixed children, which are read positionally.
    let handles = g.querySelectorAll('.arrow-handle')
    if (sel && !ui.readOnly) {
      if (!handles.length) {
        ;['from', 'to'].forEach(end => {
          const c = document.createElementNS(SVG_NS, 'circle')
          c.setAttribute('r', '5')
          c.classList.add('arrow-handle')
          c.dataset.aid = a.id
          c.dataset.end = end
          g.appendChild(c)
        })
        handles = g.querySelectorAll('.arrow-handle')
      }
      handles[0].setAttribute('cx', pts.x1); handles[0].setAttribute('cy', pts.y1)
      handles[1].setAttribute('cx', pts.x2); handles[1].setAttribute('cy', pts.y2)
    } else if (handles.length) {
      handles.forEach(h => h.remove())
    }
  })
}

// Soft-wrap an arrow note into short lines so long annotations stay readable
// on the canvas without an HTML layout pass. ~28 chars/line, max 4 lines.
function wrapNote(text, maxChars = 28, maxLines = 4) {
  const out = []
  text.split(/\r?\n/).forEach(para => {
    let line = ''
    para.split(/\s+/).forEach(word => {
      if (!line) { line = word }
      else if ((line + ' ' + word).length <= maxChars) { line += ' ' + word }
      else { out.push(line); line = word }
    })
    if (line) out.push(line)
  })
  if (out.length > maxLines) { const t = out.slice(0, maxLines); t[maxLines - 1] += '…'; return t }
  return out
}

// ── Empty-canvas hint ────────────────────────────────────────
export function updateHint() {
  const empty = Object.keys(state.blocks).length === 0
  // Brain Dump is the primary empty state (read-only/embed views fall back to
  // the plain text hint, since there's nothing to type into).
  const brainDump = document.getElementById('brainDump')
  const useBrainDump = empty && brainDump && !ui.readOnly && !ui.embed
  if (brainDump) brainDump.style.display = useBrainDump ? '' : 'none'
  $.canvasHint().style.display = (empty && !useBrainDump) ? '' : 'none'
}

// ── Fit view ─────────────────────────────────────────────────
export function fitView() {
  const ids = Object.keys(state.blocks)
  if (!ids.length) { view.panX = 0; view.panY = 0; view.zoom = 1; applyTransform(); return }
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity
  ids.forEach(id => {
    const b = state.blocks[id], { w, h } = getBlockDims(id)
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x+w); maxY = Math.max(maxY, b.y+h)
  })
  const canvasViewport = $.canvasViewport()
  const pad = 80, vpW = canvasViewport.offsetWidth, vpH = canvasViewport.offsetHeight
  const z = clamp(Math.min(vpW/(maxX-minX+pad*2), vpH/(maxY-minY+pad*2)), MIN_ZOOM, MAX_ZOOM)
  view.zoom = z
  view.panX = (vpW - (maxX-minX)*z)/2 - minX*z
  view.panY = (vpH - (maxY-minY)*z)/2 - minY*z
  applyTransform()
}

// ── Block-at-point ───────────────────────────────────────────
export function blockAtWorld(wx, wy) {
  for (const id in state.blocks) {
    const b = state.blocks[id], { w, h } = getBlockDims(id)
    if (wx >= b.x && wx <= b.x+w && wy >= b.y && wy <= b.y+h) return id
  }
  return null
}

// ── Frames (group visual containers) ─────────────────────────
const FRAME_PAD = 28

export function renderFrames() {
  const layer = $.framesLayer(); if (!layer) return
  // Remove frames for deleted groups
  layer.querySelectorAll('.frame').forEach(el => {
    if (!state.groups[el.dataset.gid]) el.remove()
  })
  Object.values(state.groups).forEach(g => {
    const members = Object.values(state.blocks).filter(b => b.groupId === g.id)
    if (!members.length) { layer.querySelector(`[data-gid="${g.id}"]`)?.remove(); return }
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity
    members.forEach(b => {
      const { w, h } = getBlockDims(b.id)
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + w); maxY = Math.max(maxY, b.y + h)
    })
    let el = layer.querySelector(`[data-gid="${g.id}"]`)
    if (!el) {
      el = document.createElement('div')
      el.className = 'frame'; el.dataset.gid = g.id
      el.innerHTML = `<div class="frame-label" data-gid="${g.id}">${escHtml(g.label)}</div>`
      layer.appendChild(el)
    } else {
      const lbl = el.querySelector('.frame-label')
      if (lbl && lbl.contentEditable !== 'true') lbl.textContent = g.label
    }
    el.style.left   = (minX - FRAME_PAD) + 'px'
    el.style.top    = (minY - FRAME_PAD - 30) + 'px'
    el.style.width  = (maxX - minX + FRAME_PAD * 2) + 'px'
    el.style.height = (maxY - minY + FRAME_PAD * 2 + 30) + 'px'
    el.classList.toggle('selected', selection.groupId === g.id)
  })
}

// ── Blocks in rect (for rubber-band selection) ───────────────
export function blocksInRect(wx1, wy1, wx2, wy2) {
  const x1 = Math.min(wx1,wx2), x2 = Math.max(wx1,wx2)
  const y1 = Math.min(wy1,wy2), y2 = Math.max(wy1,wy2)
  return Object.keys(state.blocks).filter(id => {
    const b = state.blocks[id], { w, h } = getBlockDims(id)
    return b.x < x2 && b.x+w > x1 && b.y < y2 && b.y+h > y1
  })
}
