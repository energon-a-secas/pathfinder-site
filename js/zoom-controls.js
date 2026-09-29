// ════════════════════════════════════════════════════════════
//  zoom-controls.js: the camera. The status bar zoom cluster
//  [-] [44% v] [+] [Fit], the zoom steps the keyboard shares
//  with it, zoom to selection, the wheel clamp, and the "Back to
//  content" pill for when every block has left the screen.
//
//  Zooming is about the window, not the map, so all of it works
//  in read-only and embed views.
// ════════════════════════════════════════════════════════════

import { state, selection, view } from './state.js'
import { $, clamp, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { applyTransform, fitView } from './canvas.js'
import { openDropdown } from './menu.js'
import { focusBlock } from './ui-panels.js'
import { blockSize } from './create.js'

// Round stops for the buttons and the = / - keys, so repeated presses land
// on numbers people recognise (50%, 100%, 200%) instead of 83.3%.
export const ZOOM_STOPS = [...new Set([MIN_ZOOM, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, MAX_ZOOM])]
  .filter(z => z >= MIN_ZOOM && z <= MAX_ZOOM)
  .sort((a, b) => a - b)

// One wheel event may change the zoom by at most this factor. A mouse wheel
// notch with Ctrl reports deltaY 100 to 200, which used to jump 44% to 260%.
export const WHEEL_MAX_STEP = 1.25

/** The next stop above (dir > 0) or below (dir < 0) the zoom `z`. */
export function nextZoomStop(z, dir) {
  if (dir > 0) return ZOOM_STOPS.find(s => s > z * 1.001) ?? MAX_ZOOM
  for (let i = ZOOM_STOPS.length - 1; i >= 0; i--) if (ZOOM_STOPS[i] < z / 1.001) return ZOOM_STOPS[i]
  return MIN_ZOOM
}

/**
 * The zoom factor for one wheel event with Ctrl/Cmd (or a trackpad pinch,
 * which the browser reports the same way). Small pinch deltas stay smooth;
 * a big notch is capped. deltaMode 1 is lines, 2 is pages.
 */
export function wheelZoomFactor(deltaY, deltaMode = 0) {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return clamp(Math.exp(-px * 0.01), 1 / WHEEL_MAX_STEP, WHEEL_MAX_STEP)
}

function viewportSize() {
  const vp = $.canvasViewport()
  return { w: vp?.clientWidth || 0, h: vp?.clientHeight || 0 }
}

// A running camera animation; a newer move cancels it.
let animToken = 0

/** Zoom to `z`, keeping the viewport point (vx, vy) still. */
export function zoomAround(z, vx, vy) {
  animToken++
  const target = clamp(z, MIN_ZOOM, MAX_ZOOM)
  const wx = (vx - view.panX) / view.zoom, wy = (vy - view.panY) / view.zoom
  view.zoom = target
  view.panX = vx - wx * target
  view.panY = vy - wy * target
  applyTransform()
}

/** Zoom to `z` around the centre of the viewport. */
export function zoomTo(z) {
  const { w, h } = viewportSize()
  zoomAround(z, w / 2, h / 2)
}

export function zoomIn()  { zoomTo(nextZoomStop(view.zoom, 1)) }
export function zoomOut() { zoomTo(nextZoomStop(view.zoom, -1)) }

const reducedMotion = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

/**
 * Move the camera to (panX, panY, zoom). Eases over 280ms like focusBlock,
 * and jumps straight there under reduced motion.
 */
export function animateView(panX, panY, zoom) {
  const token = ++animToken
  const to = { panX, panY, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) }
  if (reducedMotion()) { Object.assign(view, to); applyTransform(); return }
  const from = { panX: view.panX, panY: view.panY, zoom: view.zoom }
  const start = performance.now()
  const step = now => {
    if (token !== animToken) return
    const t = Math.min((now - start) / 280, 1)
    const ease = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t
    view.panX = from.panX + (to.panX - from.panX) * ease
    view.panY = from.panY + (to.panY - from.panY) * ease
    view.zoom = from.zoom + (to.zoom - from.zoom) * ease
    applyTransform()
    if (t < 1) requestAnimationFrame(step)
  }
  step(start)
}


/** The blocks "zoom to selection" frames: the selected blocks, or a selected connection's two ends. */
export function selectionTargets() {
  if (selection.ids.size) return [...selection.ids].filter(id => state.blocks[id])
  if (selection.arrowId) {
    const a = state.arrows.find(x => x.id === selection.arrowId)
    if (a) return [a.from, a.to].filter(id => state.blocks[id])
  }
  return []
}

export function hasSelectionTarget() { return selectionTargets().length > 0 }

/**
 * Frame the given blocks. One block goes to at least 100% (focusBlock's
 * rule, which also selects it); several fit, but never zoom in past 100%
 * unless you already were. `single: false` frames one block without
 * focusBlock, for a connection whose two ends are the same block. Returns
 * false when none of the ids is a block.
 */
export function zoomToBlocks(ids, { single = true } = {}) {
  const live = (ids || []).filter(id => state.blocks[id])
  if (!live.length) return false
  if (live.length === 1 && single) { focusBlock(live[0]); return true }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  live.forEach(id => {
    const b = state.blocks[id], { w, h } = blockSize(id)
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + w); maxY = Math.max(maxY, b.y + h)
  })
  const { w: W, h: H } = viewportSize()
  const pad = 80
  const fit = W && H ? Math.min(W / (maxX - minX + pad * 2), H / (maxY - minY + pad * 2)) : 1
  const z = clamp(Math.min(fit, Math.max(view.zoom, 1)), MIN_ZOOM, MAX_ZOOM)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  animateView(W / 2 - cx * z, H / 2 - cy * z, z)
  return true
}

/**
 * Frame the selection (Shift+2, the zoom menu, the context menus): the
 * selected blocks, or a selected connection's two ends. Returns false when
 * nothing is selected.
 */
export function zoomToSelection() {
  return zoomToBlocks(selectionTargets(), { single: !selection.arrowId })
}

// ── Back to content ─────────────────────────────────────────
/** True when at least one block overlaps the visible canvas (or there is nothing to judge). */
export function contentInView() {
  const ids = Object.keys(state.blocks)
  if (!ids.length) return true
  const { w: W, h: H } = viewportSize()
  if (!W || !H) return true
  return ids.some(id => {
    const b = state.blocks[id], { w, h } = blockSize(id)
    const x1 = b.x * view.zoom + view.panX, y1 = b.y * view.zoom + view.panY
    const x2 = x1 + w * view.zoom, y2 = y1 + h * view.zoom
    return x2 > 0 && y2 > 0 && x1 < W && y1 < H
  })
}

function pillEl() { return document.getElementById('backToContent') }

function ensurePill() {
  let el = pillEl()
  if (el) return el
  const vp = $.canvasViewport(); if (!vp) return null
  el = document.createElement('button')
  el.type = 'button'
  el.id = 'backToContent'
  el.className = 'back-to-content'
  el.setAttribute('data-canvas-ui', '')
  el.hidden = true
  el.title = 'Fit every block in view (Shift+1)'
  el.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>' +
    '<span>Back to content</span>'
  el.addEventListener('click', () => {
    fitView()
    el.hidden = true
    // The pill just vanished under the keyboard; land on the canvas instead.
    if (document.activeElement === el || !document.activeElement || document.activeElement === document.body) vp.focus({ preventScroll: true })
  })
  vp.appendChild(el)
  return el
}

/** Show the pill when blocks exist and none is on screen. */
export function refreshBackToContent() {
  const el = ensurePill(); if (!el) return
  const lost = !contentInView()
  if (el.hidden === !lost) return
  el.hidden = !lost
}

let pillQueued = false
function queuePillCheck() {
  if (pillQueued) return
  pillQueued = true
  requestAnimationFrame(() => { pillQueued = false; refreshBackToContent() })
}

// ── Status bar zoom cluster ─────────────────────────────────
function zoomMenuItems() {
  return [
    { label: 'Zoom in', shortcut: '=', action: zoomIn, disabled: view.zoom >= MAX_ZOOM - 1e-6 },
    { label: 'Zoom out', shortcut: '-', action: zoomOut, disabled: view.zoom <= MIN_ZOOM + 1e-6 },
    { type: 'divider' },
    { label: 'Zoom to 100%', shortcut: 'Shift+0', action: () => zoomTo(1) },
    { label: 'Fit all blocks', shortcut: 'Shift+1', action: () => fitView() },
    { label: 'Zoom to selection', shortcut: 'Shift+2', action: () => zoomToSelection(),
      disabled: !hasSelectionTarget(), hint: hasSelectionTarget() ? '' : 'Select a block or connection first' },
    { type: 'divider' },
    { label: 'Zoom to 50%', action: () => zoomTo(0.5) },
    { label: 'Zoom to 200%', action: () => zoomTo(2) },
  ]
}

export function openZoomMenu(anchor = document.getElementById('zoomMenuBtn')) {
  if (!anchor) return null
  return openDropdown(anchor, zoomMenuItems(), { placement: 'top-start', label: 'Zoom', className: 'zoom-menu' })
}

let wired = false
export function setupZoomControls() {
  if (wired) return
  wired = true
  document.getElementById('fitViewBtn')?.addEventListener('click', () => fitView())
  document.getElementById('zoomInBtn')?.addEventListener('click', zoomIn)
  document.getElementById('zoomOutBtn')?.addEventListener('click', zoomOut)
  const menuBtn = document.getElementById('zoomMenuBtn')
  menuBtn?.addEventListener('click', () => openZoomMenu(menuBtn))

  // The pill follows the camera and the blocks. The canvas root's transform
  // changes on every pan and zoom, and its children are the blocks, so one
  // observer covers both without reaching into canvas.js.
  ensurePill()
  const root = $.canvasRoot()
  if (root && typeof MutationObserver === 'function') {
    new MutationObserver(queuePillCheck).observe(root, { attributes: true, attributeFilter: ['style'], childList: true })
  }
  window.addEventListener('resize', queuePillCheck)
  window.addEventListener('pf:canvas-changed', queuePillCheck)
  queuePillCheck()
}
