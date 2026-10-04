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
import { paintColorFor } from './cards.js'
import { placeLabels, wrapNote, NOTE_LINE, NOTE_GAP } from './arrow-labels.js'
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

// Markers already minted, so a render of 400 lines does not look each of
// its 1200 heads up in the document. A marker that left the document (the
// layer was rebuilt) is minted again.
const markers = new Map()

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
  if (markers.get(id)?.isConnected) return `url(#${id})`
  const found = document.getElementById(id)
  if (found) markers.set(id, found)
  else {
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
    markers.set(id, m)
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
  // The dot colour is the --grid-dot token, so it follows the theme.
  canvasViewport.style.backgroundImage =
    'radial-gradient(circle, var(--grid-dot) 1px, transparent 1px)'
  canvasViewport.style.backgroundSize = `${sz}px ${sz}px`
  canvasViewport.style.backgroundPosition =
    `${view.panX % sz}px ${view.panY % sz}px`
  $.zoomIndicator().textContent = Math.round(view.zoom * 100) + '%'
  // One screen pixel in world units. The hit area and the endpoint handles
  // are sized from it, so a connection stays easy to grab when zoomed out;
  // on the root it also keeps the card states (selection, focus, the gap
  // ring and badge, a highlight) at their screen size when zoomed out.
  // --pxn is the same number without a unit, for scale().
  const px = (1 / (view.zoom || 1)).toFixed(4)
  canvasRoot.style.setProperty('--px', px + 'px')
  canvasRoot.style.setProperty('--pxn', px)
  $.arrowsLayer()?.style.setProperty('--px', px + 'px')
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
// Attribute and custom-property writes, skipped when the value is the one
// written last time. A drag release redraws every line though only the few
// near the moved card changed, and rewriting the rest cost more than
// working out where they go. Only renderArrows writes these, so the value
// kept on the element is always the one in the document.
function put(el, name, value) {
  const last = el.__pf || (el.__pf = {})
  value = String(value)
  if (last[name] === value) return
  last[name] = value
  if (name.charCodeAt(0) === 45 && name.charCodeAt(1) === 45) el.style.setProperty(name, value)
  else el.setAttribute(name, value)
}
function show(el, on) {
  const v = on ? '' : 'none'
  if (el.style.display !== v) el.style.display = v
}

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
    put(tight, 'd', d)
    put(tight, '--aw', weight + 'px')
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

    put(hit, 'd', d)
    put(vis, 'd', d)
    vis.classList.toggle('selected', sel)
    // Inline style, not the presentation attribute: any stylesheet rule
    // beats an attribute, which is how dashed arrows used to draw solid.
    const dash = dashArrayFor(arrowPattern(a), weight)
    if (vis.style.strokeDasharray !== dash) vis.style.strokeDasharray = dash

    // Colour, weight and heads per state, as custom properties. CSS picks the
    // set for the state (rest, related or hovered, selected), so hovering a
    // card needs no re-render and a head always matches its line.
    // An old amber would read as a gap: paintColorFor draws it as the
    // nearest swatch, and the stored colour is left alone.
    const paint = paintColorFor(a.color).color
    const props = {
      '--ac': paint || 'var(--edge)',
      '--ac-hi': paint || 'var(--edge-hi)',
      '--ac-sel': paint || 'var(--edge-sel)',
      '--aw': weight + 'px',
      '--mk': arrowMarker(paint || 'edge', weight),
      '--mk-hi': arrowMarker(paint || 'hi', weight),
      '--mk-sel': arrowMarker(paint || 'sel', weight),
    }
    for (const k in props) put(g, k, props[k])

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
    put(t, '--ac', props['--ac']); put(t, '--ac-hi', props['--ac-hi']); put(t, '--ac-sel', props['--ac-sel'])
    const [lead, bg, lbl, note] = t.children
    // A label that had to step off its line points back to it.
    if (lp.text && lp.leader) {
      put(lead, 'x1', lp.leader.x1); put(lead, 'y1', lp.leader.y1)
      put(lead, 'x2', lp.leader.x2); put(lead, 'y2', lp.leader.y2)
      show(lead, true)
    } else {
      show(lead, false)
    }
    if (lp.text) {
      put(bg, 'x', lp.x - lp.w / 2); put(bg, 'y', lp.y - lp.h / 2)
      put(bg, 'width', lp.w); put(bg, 'height', lp.h)
      put(bg, 'rx', '9')
      show(bg, true)
      put(lbl, 'x', lp.x); put(lbl, 'y', lp.y)
      if (lbl.textContent !== lp.text) lbl.textContent = lp.text
      show(lbl, true)
    } else {
      show(bg, false)
      if (lbl.textContent) lbl.textContent = ''
      show(lbl, false)
    }
    lbl.classList.toggle('selected', sel)

    // Arrow note: richer annotation. Content is always rendered when present;
    // CSS decides whether it's visible (hover via .related, .sel, or the global
    // body.show-arrow-text setting) so hover reveal needs no arrow re-render.
    if (noteText) {
      const lines = wrapNote(noteText)
      const startY = lp.y + (lp.text ? lp.h / 2 + NOTE_GAP : NOTE_GAP)
      put(note, 'y', startY)
      const html = lines.map((ln, i) =>
        `<tspan x="${lp.x}" dy="${i === 0 ? 0 : NOTE_LINE}">${escHtml(ln)}</tspan>`).join('')
      if (note.__pfHtml !== html) { note.innerHTML = html; note.__pfHtml = html }
      note.classList.toggle('selected', sel)
    } else if (note.__pfHtml !== '') {
      note.textContent = ''
      note.__pfHtml = ''
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
