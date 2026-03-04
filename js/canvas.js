// ════════════════════════════════════════════════════════════
//  canvas.js — Canvas connections/lines drawing (SVG), drag behavior
// ════════════════════════════════════════════════════════════

import { state, view, selection } from './state.js'
import { $, clamp, getBlockDims, MIN_ZOOM, MAX_ZOOM } from './utils.js'

// ── Canvas transform + dot grid ──────────────────────────────
export function applyTransform() {
  const canvasRoot = $.canvasRoot()
  const canvasViewport = $.canvasViewport()
  canvasRoot.style.transform = `translate(${view.panX}px,${view.panY}px) scale(${view.zoom})`
  // Move dot grid with canvas
  const sz = 28 * view.zoom
  canvasViewport.style.backgroundImage =
    'radial-gradient(circle, rgba(255,255,255,.12) 1px, transparent 1px)'
  canvasViewport.style.backgroundSize = `${sz}px ${sz}px`
  canvasViewport.style.backgroundPosition =
    `${view.panX % sz}px ${view.panY % sz}px`
  $.zoomIndicator().textContent = Math.round(view.zoom * 100) + '%'
}

// ── Arrow routing ────────────────────────────────────────────
export function portPos(id, port) {
  const b = state.blocks[id]; if (!b) return null
  const { w, h } = getBlockDims(id)
  const map = {
    left:   { x: b.x,       y: b.y + h/2, dir: 'left'   },
    right:  { x: b.x + w,   y: b.y + h/2, dir: 'right'  },
    top:    { x: b.x + w/2, y: b.y,        dir: 'top'    },
    bottom: { x: b.x + w/2, y: b.y + h,    dir: 'bottom' }
  }
  return map[port] || null
}

export function bestPorts(fromId, toId) {
  const f = state.blocks[fromId], t = state.blocks[toId]; if (!f || !t) return null
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

export function cpOffset(x, y, dir, off) {
  return dir === 'right'  ? { x: x+off, y }
       : dir === 'left'   ? { x: x-off, y }
       : dir === 'bottom' ? { x, y: y+off }
       :                    { x, y: y-off }
}

export function buildPath(x1, y1, d1, x2, y2, d2) {
  const off = clamp(Math.max(Math.abs(x2-x1), Math.abs(y2-y1)) * 0.38, 55, 130)
  const c1 = cpOffset(x1, y1, d1, off), c2 = cpOffset(x2, y2, d2, off)
  return `M ${x1} ${y1} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${x2} ${y2}`
}

function arrowMidpoint(pts) {
  const off = clamp(Math.max(Math.abs(pts.x2-pts.x1), Math.abs(pts.y2-pts.y1)) * 0.38, 55, 130)
  const c1 = cpOffset(pts.x1, pts.y1, pts.d1, off)
  const c2 = cpOffset(pts.x2, pts.y2, pts.d2, off)
  return {
    x: 0.125 * (pts.x1 + 3*c1.x + 3*c2.x + pts.x2),
    y: 0.125 * (pts.y1 + 3*c1.y + 3*c2.y + pts.y2)
  }
}

// ── Render arrows ────────────────────────────────────────────
export function renderArrows() {
  const arrowsGroup = $.arrowsGroup()
  const live = new Set(state.arrows.map(a => a.id))
  arrowsGroup.querySelectorAll('[data-aid]').forEach(g => { if (!live.has(g.dataset.aid)) g.remove() })

  state.arrows.forEach(a => {
    const pts = bestPorts(a.from, a.to); if (!pts) return
    const d   = buildPath(pts.x1, pts.y1, pts.d1, pts.x2, pts.y2, pts.d2)
    const sel = selection.arrowId === a.id

    let g = arrowsGroup.querySelector(`[data-aid="${a.id}"]`)
    if (!g) {
      g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.dataset.aid = a.id

      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      hit.classList.add('arrow-hitbox')
      g.appendChild(hit)

      const vis = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      vis.classList.add('arrow-path')
      vis.setAttribute('marker-end', 'url(#arrowhead)')
      g.appendChild(vis)

      const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      lbl.classList.add('arrow-label')
      g.appendChild(lbl)

      arrowsGroup.appendChild(g)
    }

    const [hit, vis] = g.children
    hit.setAttribute('d', d)
    vis.setAttribute('d', d)
    vis.classList.toggle('selected', sel)
    vis.setAttribute('marker-end', sel ? 'url(#arrowhead-sel)' : 'url(#arrowhead)')

    const lbl = g.children[2]
    const mid = arrowMidpoint(pts)
    lbl.setAttribute('x', mid.x)
    lbl.setAttribute('y', mid.y)
    lbl.textContent = a.label || ''
    lbl.style.display = a.label ? '' : 'none'
    lbl.classList.toggle('selected', sel)
  })
}

// ── Empty-canvas hint ────────────────────────────────────────
export function updateHint() {
  $.canvasHint().style.display = Object.keys(state.blocks).length ? 'none' : ''
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

// ── Blocks in rect (for rubber-band selection) ───────────────
export function blocksInRect(wx1, wy1, wx2, wy2) {
  const x1 = Math.min(wx1,wx2), x2 = Math.max(wx1,wx2)
  const y1 = Math.min(wy1,wy2), y2 = Math.max(wy1,wy2)
  return Object.keys(state.blocks).filter(id => {
    const b = state.blocks[id], { w, h } = getBlockDims(id)
    return b.x < x2 && b.x+w > x1 && b.y < y2 && b.y+h > y1
  })
}
