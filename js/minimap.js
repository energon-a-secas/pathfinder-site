// ════════════════════════════════════════════════════════════
//  minimap.js: a 160 by 100 overview in the canvas's bottom
//  right corner. Each block is a rectangle in its type colour
//  (or its own colour), and a frame marks what the canvas shows.
//  Drag the frame to pan, click anywhere to jump there.
//
//  Off until asked for (M, View > Minimap, or the zoom menu),
//  remembered per browser. It is a pointer aid, so it is
//  aria-hidden: Fit (Shift+1), zoom to selection (Shift+2) and
//  the arrow keys are its keyboard equivalents. Never in an
//  embed, and not on a phone, where there is no room for it.
// ════════════════════════════════════════════════════════════

import { state, view, ui, saveHooks } from './state.js'
import { $ } from './utils.js'
import { applyTransform, transformHooks } from './canvas.js'
import { blockSize } from './create.js'
import { paintColorFor } from './cards.js'
import { isTyping, modalDialogOpen, canvasHasFocus } from './navigation.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const STORE_KEY = 'pathfinder-minimap'
export const MINIMAP_SIZE = { w: 160, h: 100 }
// World units of margin around what the minimap frames.
const MARGIN = 60

const mm = { on: false, el: null, svg: null, blocks: null, frame: null, drag: null, queued: false }

/** Whether this view can have a minimap at all: not an embed, not a phone. */
export function minimapAvailable() {
  if (ui.embed) return false
  try { return !window.matchMedia('(max-width: 700px)').matches } catch (_) { return true }
}

export function isMinimapOn() { return mm.on }

/** Show or hide it, and remember the choice in this browser. */
export function setMinimap(on) {
  mm.on = !!on
  try { localStorage.setItem(STORE_KEY, mm.on ? '1' : '0') } catch (_) {}
  refreshMinimap()
  window.dispatchEvent(new CustomEvent('pf:minimap', { detail: { on: mm.on } }))
}

export function toggleMinimap() { setMinimap(!mm.on) }

// ── Geometry (pure enough for the tests) ────────────────────
/** The blocks' bounding box in world units, or null for an empty map. */
export function contentBounds(blocks = state.blocks, size = blockSize) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const id in blocks) {
    const b = blocks[id], { w, h } = size(id)
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + w); y2 = Math.max(y2, b.y + h)
  }
  return x1 === Infinity ? null : { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** The part of the world the canvas shows, for a camera and viewport size. */
export function visibleWorld(cam = view, vp = viewportSize()) {
  const z = cam.zoom || 1
  return { x: -cam.panX / z, y: -cam.panY / z, w: vp.w / z, h: vp.h / z }
}

/** What the minimap frames: the map and the visible part together, with a margin. */
export function minimapBounds(content, visible) {
  const boxes = [content, visible].filter(Boolean)
  if (!boxes.length) return null
  const x1 = Math.min(...boxes.map(b => b.x)) - MARGIN, y1 = Math.min(...boxes.map(b => b.y)) - MARGIN
  const x2 = Math.max(...boxes.map(b => b.x + b.w)) + MARGIN, y2 = Math.max(...boxes.map(b => b.y + b.h)) + MARGIN
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/**
 * The camera that puts world point (wx, wy) at the top left of the visible
 * part, at the current zoom: what dragging the frame does.
 */
export function panForWorldOrigin(wx, wy, zoom = view.zoom) {
  return { panX: -wx * zoom, panY: -wy * zoom }
}

function viewportSize() {
  const vp = $.canvasViewport()
  return { w: vp?.clientWidth || 0, h: vp?.clientHeight || 0 }
}

// ── DOM ──────────────────────────────────────────────────────
function ensureEl() {
  if (mm.el?.isConnected) return mm.el
  const vp = $.canvasViewport(); if (!vp) return null
  const el = document.createElement('div')
  el.id = 'minimap'
  el.className = 'minimap'
  el.setAttribute('data-canvas-ui', '')
  el.setAttribute('aria-hidden', 'true')
  el.hidden = true
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'minimap-svg')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  const blocks = document.createElementNS(SVG_NS, 'g')
  blocks.setAttribute('class', 'minimap-blocks')
  // The frame's wash goes under the blocks and its edge over them, so the
  // blocks inside it keep their colour.
  const wash = document.createElementNS(SVG_NS, 'rect')
  wash.setAttribute('class', 'minimap-wash')
  const frame = document.createElementNS(SVG_NS, 'rect')
  frame.setAttribute('class', 'minimap-frame')
  svg.append(wash, blocks, frame)
  el.appendChild(svg)
  vp.appendChild(el)
  Object.assign(mm, { el, svg, blocks, frame, wash })
  wirePointer(svg)
  return el
}

/** Redraw the block rectangles (after the map changed). */
export function rebuildMinimap() {
  if (!ensureEl()) return
  const g = mm.blocks
  const frag = document.createDocumentFragment()
  for (const id in state.blocks) {
    const b = state.blocks[id], { w, h } = blockSize(id)
    const r = document.createElementNS(SVG_NS, 'rect')
    r.setAttribute('class', 'minimap-b')
    r.setAttribute('x', b.x); r.setAttribute('y', b.y)
    r.setAttribute('width', Math.max(1, w)); r.setAttribute('height', Math.max(1, h))
    r.setAttribute('rx', '8')
    // The type colour as the card shows it, or the card's own colour (with
    // its light twin, and an old amber drawn as its nearest swatch).
    const paint = paintColorFor(b.color)
    if (paint.color) {
      r.classList.add('has-color')
      r.style.setProperty('--bc-custom', paint.color)
      if (paint.light) r.style.setProperty('--bc-custom-light', paint.light)
    } else {
      r.style.setProperty('--mm-type', `var(--c-${/^[a-z]+$/.test(b.type) ? b.type : 'custom'})`)
    }
    frag.appendChild(r)
  }
  g.replaceChildren(frag)
  updateMinimapView()
}

/** Move the frame (every pan and zoom), and re-frame the minimap unless a drag is holding it still. */
export function updateMinimapView() {
  if (!mm.el || mm.el.hidden) return
  const vis = visibleWorld()
  if (!mm.drag) {
    const box = minimapBounds(contentBounds(), vis)
    if (box) mm.svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`)
  }
  for (const r of [mm.wash, mm.frame]) {
    r.setAttribute('x', vis.x); r.setAttribute('y', vis.y)
    r.setAttribute('width', Math.max(1, vis.w)); r.setAttribute('height', Math.max(1, vis.h))
  }
}

/** Show or hide it for the current state, and redraw it when shown. */
export function refreshMinimap() {
  const el = ensureEl(); if (!el) return
  const show = mm.on && minimapAvailable() && Object.keys(state.blocks).length > 0
  el.hidden = !show
  if (show) rebuildMinimap()
}

function queueRefresh() {
  if (mm.queued) return
  mm.queued = true
  requestAnimationFrame(() => { mm.queued = false; refreshMinimap() })
}

// ── Pointer: drag the frame, click to jump ──────────────────
function worldAt(svg, clientX, clientY) {
  const m = svg.getScreenCTM?.()
  if (!m) return null
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse())
  return { x: p.x, y: p.y }
}

function wirePointer(svg) {
  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    const p = worldAt(svg, e.clientX, e.clientY); if (!p) return
    e.preventDefault()
    e.stopPropagation()
    const vis = visibleWorld()
    const inside = p.x >= vis.x && p.x <= vis.x + vis.w && p.y >= vis.y && p.y <= vis.y + vis.h
    // Outside the frame: jump so the point is in the middle, then drag on from there.
    const off = inside ? { x: p.x - vis.x, y: p.y - vis.y } : { x: vis.w / 2, y: vis.h / 2 }
    mm.drag = { id: e.pointerId, off }
    mm.el.classList.add('dragging')
    try { svg.setPointerCapture(e.pointerId) } catch (_) {}
    moveTo(p)
  })
  // The drag is the minimap's own: the canvas's pointer handlers never see it.
  svg.addEventListener('pointermove', e => {
    if (!mm.drag || e.pointerId !== mm.drag.id) return
    e.stopPropagation()
    const p = worldAt(svg, e.clientX, e.clientY); if (p) moveTo(p)
  })
  const end = e => {
    if (!mm.drag || e.pointerId !== mm.drag.id) return
    e.stopPropagation()
    mm.drag = null
    mm.el.classList.remove('dragging')
    updateMinimapView()
  }
  svg.addEventListener('pointerup', end)
  svg.addEventListener('pointercancel', end)
  // A press here is not a press on the canvas: no marquee, no deselect.
  svg.addEventListener('click', e => e.stopPropagation())
}

function moveTo(p) {
  const { panX, panY } = panForWorldOrigin(p.x - mm.drag.off.x, p.y - mm.drag.off.y)
  view.panX = panX; view.panY = panY
  applyTransform()
}

// ── Setup ────────────────────────────────────────────────────
let wired = false
export function setupMinimap() {
  if (wired) return
  wired = true
  try { mm.on = !ui.embed && localStorage.getItem(STORE_KEY) === '1' } catch (_) { mm.on = false }
  ensureEl()
  transformHooks.add(updateMinimapView)
  // Every saved change, not only the ones that announce themselves: a drag,
  // a resize or a frame move ends with a save and no pf:canvas-changed, and
  // dragging is the edit people make most. Never vetoes the save.
  saveHooks.push(() => { queueRefresh() })
  window.addEventListener('pf:canvas-changed', queueRefresh)
  window.addEventListener('resize', queueRefresh)
  const root = $.canvasRoot()
  if (root && typeof MutationObserver === 'function') {
    // Blocks added or removed by paths that announce nothing (Tidy, a map switch).
    new MutationObserver(queueRefresh).observe(root, { childList: true })
  }
  // M: a View key like H and Z, so it works while the canvas has focus, in
  // read-only too, and never while typing or behind a modal.
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
    if (e.key !== 'm' && e.key !== 'M') return
    if (modalDialogOpen() || isTyping() || !canvasHasFocus()) return
    const sheet = $.shortcutOverlay?.()
    if (sheet && sheet.style.display !== 'none' && sheet.getAttribute('aria-modal') === 'true') return
    if (!minimapAvailable()) return
    e.preventDefault()
    toggleMinimap()
  })
  refreshMinimap()
}
