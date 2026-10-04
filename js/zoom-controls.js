// ════════════════════════════════════════════════════════════
//  zoom-controls.js: the camera. The status bar zoom cluster
//  [-] [44% v] [+] [Fit], the zoom steps the keyboard shares
//  with it, zoom to selection, the wheel clamp, and the "Back to
//  content" pill for when every block has left the screen.
//
//  Also where a map lands when it arrives (a template, the sample,
//  an example, a share link: arriveAt) and Tidy's move. It sets up
//  lod.js (the level-of-detail band and the hover fade) and
//  minimap.js, and re-exports the band API.
//
//  Zooming is about the window, not the map, so all of it works
//  in read-only and embed views.
// ════════════════════════════════════════════════════════════

import { state, selection, view, ui } from './state.js'
import { $, clamp, getBlockEl, showToast, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { applyTransform, fitView } from './canvas.js'
import { openDropdown } from './menu.js'
import { focusBlock } from './ui-panels.js'
import { blockSize } from './create.js'
import { readingOrder } from './navigation.js'
import { setupMinimap, isMinimapOn, toggleMinimap, minimapAvailable } from './minimap.js'
import { setupLod, setupHoverDim, exactLodNext } from './lod.js'

// Level of detail and the hover fade live in lod.js; this is their one
// import point, with the rest of the camera.
export {
  LOD_BANDS, LABELS_MIN_ZOOM, LOD_MARGIN, LOD_STEPS_PER_OCTAVE, LOD_GESTURE_STEPS, LOD_SETTLE_MS,
  lodBand, labelsAtRest, lodScale, currentLod, applyLod, paintLodFace,
} from './lod.js'

// Round stops for the buttons and the = / - keys, so repeated presses land
// on numbers people recognise (50%, 100%, 200%) instead of 83.3%.
export const ZOOM_STOPS = [...new Set([MIN_ZOOM, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, MAX_ZOOM])]
  .filter(z => z >= MIN_ZOOM && z <= MAX_ZOOM)
  .sort((a, b) => a - b)

// One wheel event may change the zoom by at most this factor. A mouse wheel
// notch with Ctrl reports deltaY 100 to 200, which used to jump 44% to 260%.
export const WHEEL_MAX_STEP = 1.25

/**
 * The next stop above (dir > 0) or below (dir < 0) the zoom `z`, skipping a
 * stop within 5% of it: from the fit zoom of 66% the next press went to 67%,
 * a step nobody could see.
 */
export function nextZoomStop(z, dir) {
  if (dir > 0) return ZOOM_STOPS.find(s => s > z * 1.05) ?? MAX_ZOOM
  for (let i = ZOOM_STOPS.length - 1; i >= 0; i--) if (ZOOM_STOPS[i] < z / 1.05) return ZOOM_STOPS[i]
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
 * The house curve, --ease-out (cubic-bezier(0.25, 1, 0.5, 1)), as a
 * function: a quartic ease-out, fast start and a long settle, no overshoot.
 */
export const easeOut = t => 1 - Math.pow(1 - t, 4)

/**
 * Move the camera to (panX, panY, zoom). Eases out over `ms` (280 by
 * default, like focusBlock), and jumps straight there under reduced motion.
 */
export function animateView(panX, panY, zoom, ms = 280) {
  const token = ++animToken
  const to = { panX, panY, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) }
  if (reducedMotion() || !(ms > 0)) { Object.assign(view, to); applyTransform(); return }
  const from = { panX: view.panX, panY: view.panY, zoom: view.zoom }
  const start = performance.now()
  const step = now => {
    if (token !== animToken) return
    const t = Math.min((now - start) / ms, 1)
    const ease = easeOut(t)
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
    ...(minimapAvailable() ? [
      { type: 'divider' },
      { label: 'Minimap', shortcut: 'M', checked: isMinimapOn(), action: () => toggleMinimap() },
    ] : []),
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

  setupLod()
  setupHoverDim()
  setupMinimap()
}

// ════════════════════════════════════════════════════════════
//  Arrival
// ════════════════════════════════════════════════════════════
// A template, the sample map, an example or a share link used to land at
// a whole-map fit: 30% for the large templates, where nothing reads. It
// lands at 75% or more instead, on the map's entry layer (its triggers, or
// the blocks the flow starts from), with the rest a pan away and Shift+1
// still showing all of it.

export const ARRIVAL_ZOOM = 0.75
/** The margin an arrival keeps around what it frames, in screen pixels. */
export const ARRIVAL_PAD = 80

function boxOf(ids) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  ids.forEach(id => {
    const b = state.blocks[id]; if (!b) return
    const { w, h } = blockSize(id)
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y)
    x2 = Math.max(x2, b.x + w); y2 = Math.max(y2, b.y + h)
  })
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 }
}

/**
 * Where a flow starts, among `ids`: its triggers (a Trigger / End with
 * connections out and none in); failing that, every connected block with
 * nothing coming in; failing that (no connections), the first block in
 * reading order.
 */
export function entryBlocks(ids, arrows = state.arrows) {
  const live = (ids || []).filter(id => state.blocks[id])
  const set = new Set(live), into = new Set(), out = new Set()
  arrows.forEach(a => {
    if (a.from === a.to || !set.has(a.from) || !set.has(a.to)) return
    out.add(a.from); into.add(a.to)
  })
  const roots = live.filter(id => out.has(id) && !into.has(id))
  const triggers = roots.filter(id => state.blocks[id].type === 'terminator')
  if (triggers.length) return triggers
  if (roots.length) return roots
  const sub = {}
  live.forEach(id => { sub[id] = state.blocks[id] })
  return readingOrder(sub).slice(0, 1)
}

// The centre, on one axis, of a window `win` wide: on the entry span
// [e1, e2] (on its start when it is wider than the window), then kept
// inside the map [m1, m2], so the window shows map rather than the empty
// canvas beside it.
function arrivalCentre(e1, e2, m1, m2, win) {
  const c = e2 - e1 + ARRIVAL_PAD * 2 > win ? e1 - ARRIVAL_PAD + win / 2 : (e1 + e2) / 2
  const lo = m1 - ARRIVAL_PAD + win / 2, hi = m2 + ARRIVAL_PAD - win / 2
  return lo <= hi ? clamp(c, lo, hi) : (m1 + m2) / 2
}

/**
 * The camera for blocks `ids` arriving in a viewport `size` ({ w, h },
 * the canvas viewport by default): all of them when that reads (a fit of
 * 75% or more, never past 100%), otherwise 75% on the entry layer. `whole`
 * says whether everything is in view. Null when there is nothing to frame.
 */
export function arrivalView(ids, size = null) {
  const { w: W, h: H } = size || viewportSize()
  const live = (ids || []).filter(id => state.blocks[id])
  if (!live.length || !(W > 0) || !(H > 0)) return null
  const all = boxOf(live)
  const fit = Math.min(W / (all.w + ARRIVAL_PAD * 2), H / (all.h + ARRIVAL_PAD * 2))
  if (fit >= ARRIVAL_ZOOM) {
    const z = clamp(Math.min(fit, 1), MIN_ZOOM, MAX_ZOOM)
    return { zoom: z, panX: W / 2 - all.cx * z, panY: H / 2 - all.cy * z, whole: true }
  }
  const z = ARRIVAL_ZOOM
  const e = boxOf(entryBlocks(live))
  const cx = arrivalCentre(e.x1, e.x2, all.x1, all.x2, W / z)
  const cy = arrivalCentre(e.y1, e.y2, all.y1, all.y2, H / z)
  return { zoom: z, panX: W / 2 - cx * z, panY: H / 2 - cy * z, whole: false }
}

/** The arrival toast's second sentence, said only when part of the map is off screen. */
export const ARRIVAL_HINT = 'Shift+1 shows all of it.'
// With no keyboard to press it on (a phone, a tablet without one), the
// hint names the button instead: Fit is in the status bar on every size.
export const ARRIVAL_HINT_TOUCH = 'Fit shows all of it.'

/**
 * How this device shows the whole map: 'Shift+1' where there is a fine
 * pointer and room, 'Fit' (the status bar's button) otherwise. Every toast
 * that says how to see all of it reads this one (arrivalHint, the dump's).
 */
export function fitKeyName() {
  try {
    const touchOnly = !window.matchMedia('(any-pointer: fine)').matches
    const phone = window.matchMedia('(max-width: 700px)').matches
    return touchOnly || phone ? 'Fit' : 'Shift+1'
  } catch (_) { return 'Shift+1' }
}

/** The hint for this device: the key where there is a fine pointer and room, the button otherwise. */
export function arrivalHint() {
  return fitKeyName() === 'Fit' ? ARRIVAL_HINT_TOUCH : ARRIVAL_HINT
}

/** True when every one of `ids` is on screen at ARRIVAL_ZOOM or closer. */
export function readableInView(ids, size = null) {
  const { w: W, h: H } = size || viewportSize()
  const live = (ids || []).filter(id => state.blocks[id])
  if (!live.length || !(W > 0) || !(H > 0) || view.zoom < ARRIVAL_ZOOM) return false
  const b = boxOf(live), z = view.zoom
  return b.x1 * z + view.panX >= 0 && b.y1 * z + view.panY >= 0 &&
    b.x2 * z + view.panX <= W && b.y2 * z + view.panY <= H
}

/** "Checkout 500s added." for a template, the sample or an example. */
export function arrivalLead(name, verb = 'added') {
  const n = String(name || '').trim()
  return n ? `${n} ${verb}.` : `Map ${verb}.`
}

/**
 * Land on `ids` (every block when null); see arrivalView. An embed is a
 * figure on someone else's page, so it keeps the whole-map fit. With
 * `lead` it says "<lead> Shift+1 shows all of it." (the lead alone when
 * all of it is in view; on a touch-only device or a phone the hint names
 * the Fit button instead, arrivalHint). `animate` eases there in 200ms (Tidy).
 * `stay` leaves the camera alone when every one of `ids` is already on
 * screen at a readable zoom (a dump pasted where you are looking). Returns
 * { whole, moved }, or null when there was nothing to land on.
 */
export function arriveAt(ids = null, { lead = '', type = 'success', ms = 3200, animate = false, stay = false } = {}) {
  const list = ids ? [...ids] : Object.keys(state.blocks)
  if (ui.embed) {
    if (!list.some(id => state.blocks[id])) return null
    fitView()
    return { whole: true, moved: true }
  }
  if (stay && readableInView(list)) {
    if (lead) showToast(lead, type, ms)
    return { whole: true, moved: false }
  }
  const v = arrivalView(list)
  if (!v) return null
  exactLodNext()
  if (animate) animateView(v.panX, v.panY, v.zoom, TIDY_MS)
  else { animToken++; Object.assign(view, { panX: v.panX, panY: v.panY, zoom: v.zoom }); applyTransform() }
  if (lead) showToast(v.whole ? lead : `${lead} ${arrivalHint()}`, type, ms)
  return { whole: v.whole, moved: true }
}

/**
 * arriveAt after the frame an import scheduled (its lines, frames and fit),
 * for the paths that load through applyImport: registered after that
 * frame's callback, it runs after it in the same frame. Resolves to
 * arriveAt's result.
 */
export function arriveAfterLoad(ids = null, opts = {}) {
  return new Promise(resolve => requestAnimationFrame(() => resolve(arriveAt(ids, opts))))
}

// ════════════════════════════════════════════════════════════
//  Tidy's move
// ════════════════════════════════════════════════════════════
// Tidy writes every block's new position at once. With View > Animate
// highlights on, each card slides there from where it was (a transform,
// 200ms on the house ease-out, no overshoot) while the lines step aside and
// come back drawn to the new layout, and the camera moves in the same
// 200ms. With motion off (the default) or reduced motion, it is instant.

export const TIDY_MS = 200

export function motionAllowed() {
  return !!document.body?.classList.contains('motion-on') && !reducedMotion()
}

/** Every block's position, to hand to animateTidy after the layout. */
export function positionsNow(ids = Object.keys(state.blocks)) {
  const out = {}
  ids.forEach(id => { const b = state.blocks[id]; if (b) out[id] = { x: b.x, y: b.y } })
  return out
}

let tidyTimer = 0

/**
 * Slide each card from `before` (positionsNow() before the layout) to where
 * it is now; the cards must already be rendered at their new positions.
 * Calls `done` once they are there: at once when motion is off or nothing
 * moved, otherwise after TIDY_MS. Returns the duration, 0 when instant.
 */
export function animateTidy(before, done = () => {}) {
  const root = $.canvasRoot()
  clearTimeout(tidyTimer)
  root?.classList.remove('tidy-glide')
  const moved = []
  if (root && motionAllowed()) {
    for (const id in before) {
      const b = state.blocks[id], el = getBlockEl(id)
      if (!b || !el) continue
      const dx = before[id].x - b.x, dy = before[id].y - b.y
      if (!dx && !dy) continue
      el.style.translate = `${dx}px ${dy}px`
      moved.push(el)
    }
  }
  if (!moved.length) { done(); return 0 }
  // Each card's start must be computed before the glide class arrives, or
  // the class would slide it from where it is to its start instead. Read
  // every card (one style pass; the canvas root's own box does not depend
  // on its cards, so reading the root is not enough), then let them go.
  moved.forEach(el => getComputedStyle(el).translate)
  root.classList.add('tidy-glide')
  moved.forEach(el => { el.style.translate = '' })
  tidyTimer = setTimeout(() => {
    root.classList.remove('tidy-glide')
    done()
  }, TIDY_MS + 20)
  return TIDY_MS
}

/** The whole-map fit as a camera, without applying it (Tidy eases to it). */
export function fitTarget(ids = Object.keys(state.blocks)) {
  const live = ids.filter(id => state.blocks[id])
  const { w: W, h: H } = viewportSize()
  if (!live.length || !W || !H) return null
  const all = boxOf(live), pad = 80
  const z = clamp(Math.min(W / (all.w + pad * 2), H / (all.h + pad * 2)), MIN_ZOOM, MAX_ZOOM)
  return { zoom: z, panX: (W - all.w * z) / 2 - all.x1 * z, panY: (H - all.h * z) / 2 - all.y1 * z }
}
