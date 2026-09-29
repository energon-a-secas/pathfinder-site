// ════════════════════════════════════════════════════════════
//  canvas.js: pan/zoom, drawing connections (SVG), frames, hit
//  testing. Connection geometry lives in arrow-geometry.js, the
//  routes in arrow-routes.js, label placement in arrow-labels.js
//  and hover states in arrow-hover.js; this module re-exports
//  them, so importers keep one place to import from.
// ════════════════════════════════════════════════════════════

import { state, view, selection, ui, pointer, debouncedSaveView } from './state.js'
import { $, clamp, escHtml, getBlockDims, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { HEAD_POINTS, headLength, headTrim, colorKey, arrowRoute, arrowPattern, arrowWeight,
         dashArrayFor, pathFor } from './arrow-geometry.js'
import { resolveRoutes } from './arrow-routes.js'
import { placeLabels } from './arrow-labels.js'
import { syncArrowStates } from './arrow-hover.js'

export * from './arrow-geometry.js'
export { portPos, bestPorts, resolveRoutes, invalidateRoutes, linesUnderCards } from './arrow-routes.js'
export { placeLabels, labelTextWidth, LABEL_PAD_X, LABEL_H } from './arrow-labels.js'
export { syncArrowStates, pruneArrowLabels, setupArrowHover } from './arrow-hover.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

// ── Theme-aware helpers ─────────────────────────────────────
export function isLight() { return ui.lightMode }

// ── Arrowheads ───────────────────────────────────────────────
// Heads are sized in world units (markerUnits=userSpaceOnUse), not in
// multiples of the stroke: a Bold line used to grow a 50px head. The length
// follows the weight gently and is capped (arrow-geometry.js). The fill is a
// theme token (or the arrow's own colour), so a line and its head always
// match, in both themes, and fade together.
const HEAD_TOKENS = { edge: 'var(--edge)', hi: 'var(--edge-hi)', sel: 'var(--edge-sel)' }

function arrowDefs() {
  const layer = $.arrowsLayer(); if (!layer) return null
  let defs = layer.querySelector('defs')
  if (!defs) { defs = document.createElementNS(SVG_NS, 'defs'); layer.prepend(defs) }
  return defs
}

/**
 * The marker for a paint (a theme token name, or a CSS colour) at a weight.
 * Minted once per paint and size and reused. `orient=auto-start-reverse`
 * lets the same marker serve both ends of a two-way connection.
 */
export function arrowMarker(paint, weight) {
  const L = headLength(weight)
  const token = HEAD_TOKENS[paint]
  const key = token ? paint : 'c' + colorKey(paint)
  const id = `ah-${key}-${Math.round(L * 10)}`
  if (!document.getElementById(id)) {
    const defs = arrowDefs()
    if (!defs) return 'none'
    const m = document.createElementNS(SVG_NS, 'marker')
    m.setAttribute('id', id)
    m.setAttribute('viewBox', '0 0 10 10')
    m.setAttribute('markerUnits', 'userSpaceOnUse')
    m.setAttribute('markerWidth', String(L))
    m.setAttribute('markerHeight', String(Math.round(L * 0.72 * 100) / 100))
    m.setAttribute('preserveAspectRatio', 'none')
    // The line ends 0.4 head-lengths short of the tip (see headTrim), so the
    // reference point sits 4 of the 10 viewBox units back from it.
    m.setAttribute('refX', '6')
    m.setAttribute('refY', '5')
    m.setAttribute('orient', 'auto-start-reverse')
    const poly = document.createElementNS(SVG_NS, 'polygon')
    poly.setAttribute('points', HEAD_POINTS)
    // Inline style: var() is not allowed in a presentation attribute.
    poly.style.fill = token || paint
    m.appendChild(poly)
    defs.appendChild(m)
  }
  return `url(#${id})`
}

// ── Canvas transform + dot grid ──────────────────────────────
// Things drawn in screen space over the canvas (the inline label editor)
// register here to follow pan and zoom.
export const transformHooks = new Set()

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
  // One screen pixel in world units. The hit area and the endpoint handles
  // are sized from it, so a connection stays easy to grab when zoomed out.
  $.arrowsLayer()?.style.setProperty('--px', (1 / (view.zoom || 1)).toFixed(4) + 'px')
  transformHooks.forEach(fn => { try { fn() } catch (err) { console.error(err) } })
  debouncedSaveView()
}

// The blocks a pointer interaction is moving right now. Only their
// connections draw cheaply during a drag; every other line keeps its route.
function movingBlocks() {
  const ix = pointer.ix
  if (!ix) return null
  if (ix.type === 'block' && ix.moved) {
    return selection.ids.size > 1 && selection.ids.has(ix.id) ? new Set(selection.ids) : new Set([ix.id])
  }
  if (ix.type === 'resize') return new Set([ix.id])
  if (ix.type === 'frame' && ix.moved) return new Set(Object.keys(ix.startPositions || {}))
  return null
}

// The last placement, for the inline label editor.
let lastLabels = new Map()
export function labelPlacement(aid) { return lastLabels.get(aid) || null }

// ── Render arrows ────────────────────────────────────────────
function childLayer(group, cls) {
  for (const el of group.children) if (el.classList?.contains(cls)) return el
  const layer = document.createElementNS(SVG_NS, 'g')
  layer.setAttribute('class', cls)
  return layer
}

function labelsLayer(group) {
  const layer = childLayer(group, 'arrow-labels')
  // Labels paint after every line, so no line runs across another's label.
  if (group.lastElementChild !== layer) group.appendChild(layer)
  return layer
}

// A narrow hit area per line, painted above every line's wide one. The wide
// areas stay about 12 screen px, so zoomed out, lines a few pixels apart
// overlap there and the one painted last used to win even with the pointer
// on its neighbour's stroke. A press on a stroke now always finds its own
// line; the wide areas still catch a press near a line. The endpoint
// handles sit at the end of this layer, above the narrow areas.
function hitsLayer(group, labels) {
  const layer = childLayer(group, 'arrow-hits')
  if (layer.nextElementSibling !== labels) group.insertBefore(layer, labels)
  return layer
}

export function renderArrows(opts = {}) {
  const group = $.arrowsGroup(); if (!group) return
  const layer = labelsLayer(group)
  const hitLayer = hitsLayer(group, layer)
  const live = new Set(state.arrows.map(a => a.id))
  const lines = new Map(), tags = new Map(), narrow = new Map()
  for (const el of [...group.children]) {
    const aid = el.dataset?.aid; if (!aid) continue
    if (!live.has(aid)) { el.remove(); continue }
    lines.set(aid, el)
  }
  for (const el of [...layer.children]) {
    const aid = el.dataset?.aid
    if (!aid || !live.has(aid)) { el.remove(); continue }
    tags.set(aid, el)
  }
  const oldHandles = []
  for (const el of [...hitLayer.children]) {
    if (el.classList.contains('arrow-handle')) { oldHandles.push(el); continue }
    const aid = el.dataset?.aid
    if (!aid || !live.has(aid)) { el.remove(); continue }
    narrow.set(aid, el)
  }

  // A drag re-renders arrows on every pointermove, so the A* router only
  // runs for what it must while one is in flight, and fully on release.
  // A caller moving blocks without a pointer (a keyboard nudge) names them.
  const cheap = opts.cheap ?? !!pointer.ix
  const routes = resolveRoutes({ cheap, moving: cheap ? (opts.moving || movingBlocks()) : null })
  const labels = placeLabels(routes)
  lastLabels = labels
  let handleAt = null

  state.arrows.forEach(a => {
    const pts = routes.get(a.id)
    if (!pts) { lines.get(a.id)?.remove(); tags.get(a.id)?.remove(); narrow.get(a.id)?.remove(); return }
    const style = arrowRoute(a)
    const weight = arrowWeight(a)
    const trim = headTrim(weight)
    const d = pathFor(pts, style, { start: a.bidirectional ? trim : 0, end: trim })
    const sel = selection.arrowId === a.id

    let g = lines.get(a.id)
    if (!g) {
      g = document.createElementNS(SVG_NS, 'g')
      g.dataset.aid = a.id
      group.insertBefore(g, hitLayer)
    }
    let tight = narrow.get(a.id)
    if (!tight) {
      tight = document.createElementNS(SVG_NS, 'path')
      tight.classList.add('arrow-hit')
      tight.dataset.aid = a.id
      hitLayer.appendChild(tight)
    }
    tight.setAttribute('d', d)
    tight.style.setProperty('--aw', weight + 'px')
    let hit = g.querySelector(':scope > .arrow-hitbox'), vis = g.querySelector(':scope > .arrow-path')
    if (!hit || !vis) {
      g.replaceChildren()
      hit = document.createElementNS(SVG_NS, 'path')
      hit.classList.add('arrow-hitbox')
      vis = document.createElementNS(SVG_NS, 'path')
      vis.classList.add('arrow-path')
      g.append(hit, vis)
    }
    // classList, not className: the card-hover handler's `.related` must
    // survive a re-render that lands while the pointer is still there.
    g.classList.add('arrow-g')
    g.classList.toggle('sel', sel)
    g.classList.toggle('bidir', !!a.bidirectional)

    hit.setAttribute('d', d)
    vis.setAttribute('d', d)
    vis.classList.toggle('selected', sel)
    // Inline style, not the presentation attribute: any stylesheet rule
    // beats an attribute, which is how dashed arrows used to draw solid.
    vis.removeAttribute('stroke-dasharray')
    vis.removeAttribute('marker-end')
    vis.removeAttribute('marker-start')
    vis.style.strokeDasharray = dashArrayFor(arrowPattern(a), weight)

    // Colour, weight and heads per state, as custom properties. CSS picks the
    // set for the state (rest, related or hovered, selected), so hovering a
    // card needs no re-render and a head always matches its line.
    const paint = a.color || null
    const props = {
      '--ac': paint || 'var(--edge)',
      '--ac-hi': paint || 'var(--edge-hi)',
      '--ac-sel': paint || 'var(--edge-sel)',
      '--aw': weight + 'px',
      '--mk': arrowMarker(paint || 'edge', weight),
      '--mk-hi': arrowMarker(paint || 'hi', weight),
      '--mk-sel': arrowMarker(paint || 'sel', weight),
    }
    Object.entries(props).forEach(([k, v]) => g.style.setProperty(k, v))

    // Endpoint handles, only on the selected arrow. Dragging one re-pins that
    // end to whichever port it lands on, or re-targets the whole connection.
    // Their size is in screen pixels (CSS, from --px), whatever the zoom.
    // They go last in the hits layer, above every narrow hit area.
    if (sel && !ui.readOnly) handleAt = { aid: a.id, from: [pts.x1, pts.y1], to: [pts.x2, pts.y2] }

    // The label, and the note under it, live in the labels layer.
    const lp = labels.get(a.id)
    const noteText = (a.note || '').trim()
    let t = tags.get(a.id)
    if (!lp?.text && !noteText) { t?.remove(); return }
    if (!t) {
      t = document.createElementNS(SVG_NS, 'g')
      t.dataset.aid = a.id
      const lead = document.createElementNS(SVG_NS, 'line')
      lead.classList.add('arrow-label-leader')
      const bg = document.createElementNS(SVG_NS, 'rect')
      bg.classList.add('arrow-label-bg')
      const lbl = document.createElementNS(SVG_NS, 'text')
      lbl.classList.add('arrow-label')
      const note = document.createElementNS(SVG_NS, 'text')
      note.classList.add('arrow-note')
      t.append(lead, bg, lbl, note)
      layer.appendChild(t)
    }
    t.classList.add('arrow-label-g')
    t.classList.toggle('sel', sel)
    t.classList.toggle('has-note', !!noteText)
    ;['--ac', '--ac-hi', '--ac-sel'].forEach(k => t.style.setProperty(k, props[k]))
    const [lead, bg, lbl, note] = t.children
    // A label that had to step off its line points back to it.
    if (lp.text && lp.leader) {
      lead.setAttribute('x1', lp.leader.x1); lead.setAttribute('y1', lp.leader.y1)
      lead.setAttribute('x2', lp.leader.x2); lead.setAttribute('y2', lp.leader.y2)
      lead.style.display = ''
    } else {
      lead.style.display = 'none'
    }
    if (lp.text) {
      bg.setAttribute('x', lp.x - lp.w / 2); bg.setAttribute('y', lp.y - lp.h / 2)
      bg.setAttribute('width', lp.w); bg.setAttribute('height', lp.h)
      bg.setAttribute('rx', '9')
      bg.style.display = ''
      lbl.setAttribute('x', lp.x); lbl.setAttribute('y', lp.y)
      lbl.textContent = lp.text
      lbl.style.display = ''
    } else {
      bg.style.display = 'none'
      lbl.textContent = ''
      lbl.style.display = 'none'
    }
    lbl.classList.toggle('selected', sel)

    // Arrow note: richer annotation. Content is always rendered when present;
    // CSS decides whether it's visible (hover via .related, .sel, or the global
    // body.show-arrow-text setting) so hover reveal needs no arrow re-render.
    if (noteText) {
      const lines = wrapNote(noteText)
      const startY = lp.y + (lp.text ? lp.h / 2 + 4 : 4)
      note.setAttribute('y', startY)
      note.innerHTML = lines.map((ln, i) =>
        `<tspan x="${lp.x}" dy="${i === 0 ? 0 : 13}">${escHtml(ln)}</tspan>`).join('')
      note.classList.toggle('selected', sel)
    } else {
      note.textContent = ''
    }
  })
  placeHandles(hitLayer, oldHandles, handleAt)
  syncArrowStates()
}

// The two endpoint handles of the selected line, reused across renders and
// kept last in the hits layer.
function placeHandles(layer, old, at) {
  if (!at) { old.forEach(h => h.remove()); return }
  const pair = ['from', 'to'].map(end => {
    let c = old.find(h => h.dataset.end === end)
    if (!c) {
      c = document.createElementNS(SVG_NS, 'circle')
      c.setAttribute('r', '5')
      c.classList.add('arrow-handle')
      c.dataset.end = end
    }
    c.dataset.aid = at.aid
    c.setAttribute('cx', at[end][0]); c.setAttribute('cy', at[end][1])
    return c
  })
  old.forEach(h => { if (!pair.includes(h)) h.remove() })
  // Move them only when something landed after them: moving a node under
  // the pointer can cost it its hover.
  if (layer.lastElementChild !== pair[1] || pair[1].previousElementSibling !== pair[0]) layer.append(...pair)
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
