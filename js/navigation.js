// ════════════════════════════════════════════════════════════
//  navigation.js: moving around the canvas without a mouse, and
//  quick create with one.
//
//  Reading order for Tab, the nearest block in a direction for
//  Cmd/Ctrl+Arrow, arrow-key nudges, the screen-reader
//  announcement of the selected block, and the type picker that
//  opens when a connection is dropped on empty canvas. events.js
//  wires the keys and pointers; the decisions live here, in
//  functions the tests can call directly.
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, GRID, snapshotOnce, snapTo } from './state.js'
import { $, TYPES, STATUS_DEFS, getBlockEl } from './utils.js'
import { applyTransform, renderArrows } from './canvas.js'
import { renderBlock, selectBlock, addArrow, mutateBlocks } from './render.js'
import { createBlockAt, createConnected, suggestedNextTypes, defaultConnectDirection, blockSize } from './create.js'
import { startInlineEdit } from './inline-edit.js'
import { openCanvasAddMenu } from './context-menu.js'
import { releaseTidyPins } from './layout.js'

// Blocks whose tops are within this many pixels read as one row.
export const ROW_TOLERANCE = 40
export const PAN_STEP = 60

export const ARROW_DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
const DIR_VEC = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }
// A port's side, as the direction a new block grows in.
export const PORT_DIR = { left: 'left', right: 'right', top: 'up', bottom: 'down' }

// Space held: the next drag pans, wherever it starts (over cards too).
export const nav = { spaceHeld: false }

// ── Focus ───────────────────────────────────────────────────
/** Keys typed into a field belong to the field. */
export function isTyping() {
  const ae = document.activeElement
  const tag = ae?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae?.isContentEditable === true
}

/**
 * A modal dialog (the incoming-link chooser) owns the keyboard until it
 * closes: nothing behind it may delete, undo or zoom. `:modal` matches only
 * a dialog opened with showModal(), which is what makes the page inert.
 */
export function modalDialogOpen() {
  try { return !!document.querySelector('dialog:modal') } catch (_) { return false }
}

/**
 * Single-key shortcuts (letters, digits, =, -, arrows, Space) only act while
 * the canvas itself has focus, or nothing does (WCAG 2.1.4): the page, the
 * viewport or a card. A focused button or menu keeps its own keys.
 */
export function canvasHasFocus() {
  const ae = document.activeElement
  if (!ae || ae === document.body || ae === document.documentElement) return true
  const vp = $.canvasViewport()
  if (!vp || !vp.contains(ae) || ae.closest('[data-canvas-ui]')) return false
  return ae === vp || ae.classList.contains('block')
}

/**
 * Cmd/Ctrl + = - 0 zoom the canvas only while the canvas (or its zoom
 * cluster) has focus. Anywhere else they stay the browser's page zoom,
 * which is how people with low vision enlarge the whole interface.
 */
export function canvasZoomKeysApply() {
  if (canvasHasFocus()) return true
  return !!document.activeElement?.closest?.('#zoomControls, .zoom-menu')
}

// ── Card decorators (render.js blockDecorators) ─────────────
// A view-only link cannot connect anything, so its ports promise nothing
// (CSS hides them there too).
export const PORT_TIP = 'Drag to connect, or click to add a connected block'
export function labelPorts(b, el) {
  el.querySelectorAll('.port').forEach(p => {
    if (ui.readOnly) p.removeAttribute('title')
    else p.title = PORT_TIP
  })
}

const CARD_CONTROLS = 'button, a[href], input, select, textarea, [tabindex]'

/**
 * Each card is one Tab stop. Its own buttons (collapse, the doc badge) sit
 * outside the Tab sequence: Tab from a card goes to the next card in reading
 * order, so the browser only ever reached them by accident, entering the
 * canvas backwards onto the DOM-last card's collapse button. They stay
 * clickable, and Shift+F10 and the inspector reach the same actions.
 */
export function untabCardControls(b, el) {
  el.querySelectorAll(CARD_CONTROLS).forEach(c => { if (c !== el && c.tabIndex >= 0) c.tabIndex = -1 })
}

// ── Camera hold ─────────────────────────────────────────────
// Focus arriving at a card pans it into view (events.js). A block the pointer
// has just placed is already where the person put it; panning then slides it
// out from under them, so quick create holds the camera while it focuses.
let cameraHolds = 0
export function isCameraHeld() { return cameraHolds > 0 }
export function withCameraHeld(fn) {
  cameraHolds++
  try { return fn() } finally { cameraHolds-- }
}

/**
 * How far to pan one axis so the span [a1, a2] (screen px) shows inside
 * [pad, size - pad]. Only as far as it takes: a card that is partly in view
 * moves to the nearest edge instead of jumping to the centre. A span larger
 * than the room shows its start.
 */
export function revealShift(a1, a2, size, pad) {
  if (a2 - a1 > size - 2 * pad) return pad - a1
  if (a1 < pad) return pad - a1
  if (a2 > size - pad) return size - pad - a2
  return 0
}


function centreOf(b) {
  const { w, h } = blockSize(b.id)
  return { x: b.x + w / 2, y: b.y + h / 2 }
}

/**
 * Block ids in reading order: rows top to bottom (tops within
 * ROW_TOLERANCE share a row), left to right inside a row. A card 12px lower
 * than its neighbour is still beside it, not after the whole row.
 */
export function readingOrder(blocks = state.blocks) {
  const list = Object.values(blocks).slice().sort((a, b) => a.y - b.y || a.x - b.x)
  const rows = []
  for (const b of list) {
    const row = rows[rows.length - 1]
    if (row && b.y - row.top <= ROW_TOLERANCE) row.items.push(b)
    else rows.push({ top: b.y, items: [b] })
  }
  return rows.flatMap(r => r.items.sort((a, b) => a.x - b.x || a.y - b.y)).map(b => b.id)
}

/**
 * The block Cmd/Ctrl+Arrow moves to from `fromId`. Candidates lie ahead in
 * that direction; those inside a 45 degree cone win over those off to the
 * side. Distance counts sideways drift double, and a block connected to
 * this one counts as nearer, so following the flow is the easy path.
 */
export function nearestInDirection(fromId, dir, blocks = state.blocks, arrows = state.arrows) {
  const src = blocks[fromId]
  const vec = DIR_VEC[dir]
  if (!src || !vec) return null
  const c = centreOf(src)
  const linked = new Set()
  arrows.forEach(a => {
    if (a.from === fromId) linked.add(a.to)
    else if (a.to === fromId) linked.add(a.from)
  })
  let best = null
  for (const b of Object.values(blocks)) {
    if (b.id === fromId) continue
    const p = centreOf(b)
    const dx = p.x - c.x, dy = p.y - c.y
    const along = dx * vec[0] + dy * vec[1]
    if (along <= 1) continue
    const across = Math.abs(vec[0] ? dy : dx)
    const tier = across <= along ? 0 : 1
    const score = (along + across * 2) * (linked.has(b.id) ? 0.6 : 1)
    if (!best || tier < best.tier || (tier === best.tier && score < best.score)) best = { id: b.id, tier, score }
  }
  return best ? best.id : null
}

/** The block keyboard traversal starts from: the single selection, else the focused card. */
export function currentBlockId() {
  if (selection.ids.size === 1 && selection.blockId && state.blocks[selection.blockId]) return selection.blockId
  const focused = document.activeElement?.closest?.('.block')
  const id = focused?.dataset.id
  return id && state.blocks[id] ? id : null
}

// ── Announcements ───────────────────────────────────────────
function announcer() {
  let el = document.getElementById('canvasAnnouncer')
  if (el) return el
  el = document.createElement('div')
  el.id = 'canvasAnnouncer'
  el.className = 'sr-only'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-atomic', 'true')
  const host = $.canvasViewport()?.parentElement || document.body
  host.appendChild(el)
  return el
}

/** Say something to a screen reader, once, even when it repeats the last message. */
export function announce(text) {
  const el = announcer()
  // Identical text is not re-read; a trailing no-break space makes it new.
  el.textContent = el.textContent === text ? text + ' ' : text
}

/** "Title, Type, Status. 3 of 11" for a block, in reading order. */
export function describeBlock(id) {
  const b = state.blocks[id]; if (!b) return ''
  const order = readingOrder()
  const status = STATUS_DEFS[b.status]?.label || STATUS_DEFS['not-started'].label
  return `${b.title || 'Untitled'}, ${TYPES[b.type]?.label || b.type}, ${status}. ${order.indexOf(id) + 1} of ${order.length}`
}

/** Select a block from the keyboard: select it, focus it (which pans it into view), announce it. */
export function selectFromKeyboard(id) {
  if (!state.blocks[id]) return false
  selectBlock(id)
  // preventScroll: the viewport clips with overflow hidden, and a native
  // scroll there would shift every coordinate. focusin pans the camera.
  getBlockEl(id)?.focus({ preventScroll: true })
  announce(describeBlock(id))
  return true
}

// ── Tab leaving the canvas ──────────────────────────────────
const TABBABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [tabindex], [contenteditable="true"]'

function isTabbable(el) {
  if (el.tabIndex < 0 || el.disabled || el.closest('[inert]')) return false
  if (!el.getClientRects().length) return false
  return getComputedStyle(el).visibility !== 'hidden'
}

/**
 * Controls floating over the canvas that come before the blocks in page
 * order (Find blocks, the review bar, the Brain Dump card): tabbable, inside
 * the viewport, ahead of the canvas root. Tab visits them before the cards.
 */
export function controlsBeforeCanvas() {
  const root = $.canvasRoot(), vp = $.canvasViewport()
  if (!root || !vp) return []
  return [...vp.querySelectorAll(TABBABLE)].filter(el =>
    !root.contains(el) && (root.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) && isTabbable(el))
}

/** The first thing Tab reaches after the canvas's blocks, or null. */
export function focusableAfterCanvas() {
  const root = $.canvasRoot(); if (!root) return null
  for (const el of document.querySelectorAll(TABBABLE)) {
    if (root.contains(el)) continue
    if (!(root.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue
    if (isTabbable(el)) return el
  }
  return null
}

// ── Nudge and pan ───────────────────────────────────────────
// Holding an arrow key is one move, so it is one undo step: presses less
// than a second apart on the same selection share a snapshot token.
let nudgeBurst = 0
let lastNudge = { t: -Infinity, key: '' }

/** Move the selected blocks one step: 1px, 10px with Shift, a grid cell when snapping. */
export function nudgeSelection(dir, big = false) {
  const vec = DIR_VEC[dir]
  const ids = [...selection.ids].filter(id => state.blocks[id])
  if (ui.readOnly || !vec || !ids.length) return false
  const key = ids.slice().sort().join(',')
  const now = performance.now()
  if (now - lastNudge.t > 1000 || lastNudge.key !== key) nudgeBurst++
  lastNudge = { t: now, key }
  snapshotOnce('nudge:' + nudgeBurst)
  const step = big ? 10 : 1
  // Same rule as a drag: pins the auto-layout chose no longer fit.
  releaseTidyPins(ids)
  // Each press draws like a drag frame: only the lines on the moved cards
  // are redrawn, cheaply. Re-routing every routed line for a 1px move cost
  // 150ms a press at 300 blocks. The full pass runs once the burst ends.
  mutateBlocks(ids, b => ui.snapToGrid
    ? { x: snapTo(b.x) + vec[0] * GRID, y: snapTo(b.y) + vec[1] * GRID }
    : { x: b.x + vec[0] * step, y: b.y + vec[1] * step }, { undo: false, arrows: { cheap: true, moving: new Set(ids) } })
  clearTimeout(nudgeSettle)
  nudgeSettle = setTimeout(settleNudge, NUDGE_SETTLE_MS)
  return true
}

// How long after the last press the lines get their full route.
export const NUDGE_SETTLE_MS = 220
let nudgeSettle = null
function settleNudge() { nudgeSettle = null; renderArrows({ cheap: false }) }
/** Run a pending post-nudge routing pass now (tests, and anything that measures lines). */
export function flushNudge() { if (nudgeSettle) { clearTimeout(nudgeSettle); settleNudge() } }

/** Pan the camera 60px (240px with Shift) in a direction. */
export function panBy(dir, big = false) {
  const vec = DIR_VEC[dir]; if (!vec) return
  const d = PAN_STEP * (big ? 4 : 1)
  // Arrow right shows what is to the right, so the content moves left.
  view.panX -= vec[0] * d
  view.panY -= vec[1] * d
  applyTransform()
}

// ── Creating connected blocks ───────────────────────────────
/** What quick create makes next to a block: the first suggestion, else the same type. */
export function quickCreateType(fromType) {
  return suggestedNextTypes(fromType)[0] || (Object.hasOwn(TYPES, fromType) ? fromType : 'goal')
}

/** Alt+Arrow, Cmd/Ctrl+Enter and a click on a port: one connected block, one undo step. */
export function createInDirection(fromId, dir) {
  const src = state.blocks[fromId]
  if (!src || ui.readOnly || !DIR_VEC[dir]) return null
  return createConnected(fromId, quickCreateType(src.type), { dir, incoming: 'auto' })
}

/** The side of a new block that faces its source, for a drop at world (wx, wy). */
export function facingSide(fromId, wx, wy) {
  const src = state.blocks[fromId]; if (!src) return 'left'
  const c = centreOf(src)
  const dx = wx - c.x, dy = wy - c.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'left' : 'right'
  return dy >= 0 ? 'top' : 'bottom'
}

/**
 * Create a `type` block whose side facing `fromId` sits on world point
 * (wx, wy), connect the two, and open its title. One undo step.
 */
export function createFromDrop(fromId, fromPort, type, wx, wy) {
  const src = state.blocks[fromId]
  if (!src || ui.readOnly || !Object.hasOwn(TYPES, type)) return null
  const side = facingSide(fromId, wx, wy)
  const id = createBlockAt(type, wx, wy, { edit: false, select: true })   // the one snapshot
  if (!id) return null
  const b = state.blocks[id]
  const { w, h } = blockSize(id)
  if (side === 'left')       { b.x = wx;         b.y = wy - h / 2 }
  else if (side === 'right') { b.x = wx - w;     b.y = wy - h / 2 }
  else if (side === 'top')   { b.x = wx - w / 2; b.y = wy }
  else                       { b.x = wx - w / 2; b.y = wy - h }
  b.x = Math.round(b.x); b.y = Math.round(b.y)
  renderBlock(id)
  // Which way it points follows the implied verb, like every other quick
  // create; the ends pin only when the "pin ports" preference is on.
  const incoming = defaultConnectDirection(src.type, type) === 'in'
  const pinSrc = ui.pinPorts ? fromPort || null : null
  const pinNew = ui.pinPorts ? side : null
  if (incoming) addArrow(id, fromId, pinNew, pinSrc, { undo: false })
  else addArrow(fromId, id, pinSrc, pinNew, { undo: false })
  renderArrows({ cheap: false })
  // The block is where the connection was dropped; keep it there on screen.
  withCameraHeld(() => startInlineEdit(id, 'title', { selectAll: true }))
  return id
}

/**
 * The type picker for a connection dropped on empty canvas: the quick-add
 * picker (context-menu.js) with the source type's suggested successors
 * first. Typing filters, Enter picks the first match, Escape creates
 * nothing. Closing hands focus to the canvas, not to the source card the
 * press happened to focus: refocusing a card that is partly off screen pans
 * the camera before the new block has even been placed.
 */
export function openQuickCreate({ fromId, fromPort = null, clientX, clientY, wx, wy, onClose } = {}) {
  const src = state.blocks[fromId]
  if (!src || ui.readOnly) { onClose?.(); return null }
  return openCanvasAddMenu(clientX, clientY, {
    suggested: suggestedNextTypes(src.type),
    title: `Add after ${TYPES[src.type]?.label || src.type}`,
    label: 'Add a connected block',
    className: 'pf-quick-create',
    returnFocus: $.canvasViewport(),
    onPick: t => createFromDrop(fromId, fromPort, t, wx, wy),
    onClose,
  })
}
