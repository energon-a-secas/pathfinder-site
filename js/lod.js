// ════════════════════════════════════════════════════════════
//  lod.js: how the map reads at any zoom. The level-of-detail
//  band on the canvas root, the card's small-zoom face, and the
//  hover fade. The look is CSS (the [zoom] section of style.css);
//  this module only decides which band applies and paints the
//  face. zoom-controls.js sets it up and re-exports it.
// ════════════════════════════════════════════════════════════

import { state, view } from './state.js'
import { $, escHtml, TYPES } from './utils.js'
import { transformHooks } from './canvas.js'
import { blockDecorators } from './render.js'
import { typeShape } from './cards.js'

// ── Level of detail ─────────────────────────────────────────
// A card drawn at 30% is a texture: a 14px title is 4px on screen. So the
// canvas root carries a band class and the cards show less, larger, as the
// map gets smaller:
//
//   lod-full   75% and above   the whole card
//   lod-title  45% to 75%      the type and the title, 11px or more on screen
//   lod-pill   25% to 45%      the type's dot and the title, in a line or two
//   lod-dot    under 25%       the card in its type colour, its title on hover or focus
//
// and connection labels step aside below 60% until a line or one of its
// cards is hovered or selected. Only what is inside a card changes: the
// card keeps its size in the world, so no line is re-routed when the zoom
// crosses a band, and the image export (which draws from the state) is the
// same at any zoom.

export const LOD_BANDS = [
  { band: 'full', min: 0.75 },
  { band: 'title', min: 0.45 },
  { band: 'pill', min: 0.25 },
  { band: 'dot', min: 0 },
]
export const LABELS_MIN_ZOOM = 0.6
// Hysteresis: during a gesture (small steps) a band holds until the zoom is
// this far past its edge, so a pinch resting on 75% does not flicker the
// cards between two looks. A jump (a button, Fit, an arrival) lands exactly.
export const LOD_MARGIN = 0.02
const GESTURE_STEP = 0.1   // |ln(z / previous z)| under this is one step of a gesture

/** The band a zoom falls in, with no history. */
function exactBand(z) {
  return (LOD_BANDS.find(b => z >= b.min) || LOD_BANDS[LOD_BANDS.length - 1]).band
}

const isGestureStep = (z, prevZ) => prevZ > 0 && Math.abs(Math.log(z / prevZ)) < GESTURE_STEP

/**
 * The band for zoom `z`. Given the previous frame's band and zoom, a small
 * step that crosses an edge by less than LOD_MARGIN keeps the previous
 * band. Pure, for the tests.
 */
export function lodBand(z, prev = null, prevZ = null) {
  const next = exactBand(z)
  if (!prev || prev === next || !isGestureStep(z, prevZ)) return next
  const i = LOD_BANDS.findIndex(b => b.band === prev), j = LOD_BANDS.findIndex(b => b.band === next)
  if (i < 0 || Math.abs(i - j) !== 1) return next
  const edge = LOD_BANDS[Math.min(i, j)].min
  return Math.abs(z - edge) < LOD_MARGIN ? prev : next
}

/** Whether connection labels draw at rest at zoom `z` (with the same hysteresis). */
export function labelsAtRest(z, prev = null, prevZ = null) {
  const next = z >= LABELS_MIN_ZOOM
  if (prev === null || prev === next || !isGestureStep(z, prevZ)) return next
  return Math.abs(z - LABELS_MIN_ZOOM) < LOD_MARGIN ? prev : next
}

// The face's scale: the zoom's inverse rounded UP to a 1/16 octave step
// (about 4.4%). Rounded up so text is never under its size on screen;
// stepped so a pinch re-lays the faces out every few frames, not each one.
// Each new step re-lays out every face, which at a few hundred cards is
// most of a frame, so while a gesture is zooming the face moves in quarter
// octaves (about 19%, a step of the fine grid, so text is still never
// under its size) and settles on the fine step once the zoom has rested.
export const LOD_STEPS_PER_OCTAVE = 16
export const LOD_GESTURE_STEPS = 4
export const LOD_SETTLE_MS = 160
export function lodScale(z, steps = LOD_STEPS_PER_OCTAVE) {
  const inv = 1 / (z || 1)
  if (inv <= 1) return 1
  return Math.pow(2, Math.ceil(Math.log2(inv) * steps - 1e-9) / steps)
}

const lod = { band: null, labels: null, z: null, exact: true, k: null }
let settleTimer = 0

/** The canvas root's band right now ('full', 'title', 'pill' or 'dot'). */
export function currentLod() { return lod.band || exactBand(view.zoom) }

/** The next band change lands exactly, with no hysteresis: a jump, not a gesture. */
export function exactLodNext() { lod.exact = true }

/**
 * applyTransform hook: the band classes and the face scale on the canvas
 * root. Runs on every pan and zoom frame, so it writes only what changed:
 * a custom property or a class on the root restyles every card.
 */
export function applyLod({ exact = false, settle = false } = {}) {
  const root = $.canvasRoot(); if (!root) return
  const z = view.zoom, prevZ = lod.z
  const sticky = !(exact || lod.exact)
  const band = lodBand(z, sticky ? lod.band : null, sticky ? prevZ : null)
  const labels = labelsAtRest(z, sticky ? lod.labels : null, sticky ? prevZ : null)
  lod.z = z; lod.exact = false
  // A zoom frame of a gesture takes the coarse step and asks for the fine
  // one once the zoom rests; a jump, a pan or the settle takes the fine one.
  const zooming = sticky && !settle && z !== prevZ && isGestureStep(z, prevZ)
  clearTimeout(settleTimer)
  if (zooming) settleTimer = setTimeout(() => applyLod({ settle: true }), LOD_SETTLE_MS)
  const k = band === 'full' ? 1 : lodScale(z, zooming ? LOD_GESTURE_STEPS : LOD_STEPS_PER_OCTAVE)
  if (k !== lod.k || !root.style.getPropertyValue('--lodk')) {
    root.style.setProperty('--lodk', String(+k.toFixed(5)))
    lod.k = k
  }
  if (band !== lod.band || !root.classList.contains('lod-' + band)) {
    LOD_BANDS.forEach(b => root.classList.toggle('lod-' + b.band, b.band === band))
    lod.band = band
  }
  if (labels !== lod.labels || root.classList.contains('lod-quiet-labels') === labels) {
    root.classList.toggle('lod-quiet-labels', !labels)
    lod.labels = labels
  }
}

/**
 * blockDecorators painter: the card's face for the bands below full. A copy
 * of the type and the title in a box of its own over the card (aria-hidden:
 * the card's name already says both), absolutely placed, so the card's
 * height, and with it every line, never changes. The tip is the whole
 * title, shown under the card on hover or focus where the face cuts it.
 */
export function paintLodFace(b, el) {
  el.querySelector(':scope > .block-lod')?.remove()
  const label = TYPES[b.type]?.label || b.type || ''
  const title = (b.title || '').trim()
  const text = title ? escHtml(title) : 'Untitled'
  el.insertAdjacentHTML('beforeend',
    '<div class="block-lod" aria-hidden="true">' +
      '<div class="block-lod-face">' +
        '<div class="block-lod-head">' +
          `<span class="block-type-dot" data-shape="${typeShape(b.type)}"></span>` +
          `<span class="block-lod-type">${escHtml(label)}</span>` +
        '</div>' +
        `<div class="block-lod-title${title ? '' : ' is-empty'}">${text}</div>` +
      '</div>' +
      `<div class="block-lod-tip"><span class="block-lod-tip-type">${escHtml(label)}</span>${text}</div>` +
    '</div>')
}

let lodWired = false
export function setupLod() {
  if (!blockDecorators.includes(paintLodFace)) blockDecorators.push(paintLodFace)
  // Cards rendered before the painter was registered get their face now.
  $.canvasRoot()?.querySelectorAll(':scope > .block').forEach(el => {
    const b = state.blocks[el.dataset.id]
    if (b && !el.querySelector(':scope > .block-lod')) paintLodFace(b, el)
  })
  if (lodWired) return
  lodWired = true
  transformHooks.add(applyLod)
  applyLod({ exact: true })
}

// ── Hover fade ──────────────────────────────────────────────
// Hovering a card fades what it is not connected to (events.js sets
// .has-hover and .related; the look is CSS, in [zoom]). The fade waits for
// a short dwell, so a pointer crossing the map does not flicker it, and it
// never happens for a finger: a tap is not a hover. The root carries the
// last pointer's kind, so the CSS can tell a touch from a mouse on a laptop
// that has both.
let hoverWired = false
export function setupHoverDim() {
  if (hoverWired) return
  const root = $.canvasRoot(); if (!root) return
  hoverWired = true
  const note = e => {
    const kind = e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse'
    if (root.dataset.pointer !== kind) root.dataset.pointer = kind
  }
  root.addEventListener('pointerdown', note, true)
  root.addEventListener('pointerover', note, true)
  // The tip shows on hover and keyboard focus; place it as it opens.
  const place = e => {
    const el = e.target.closest?.('.block')
    if (el && root.contains(el)) placeTip(el)
  }
  root.addEventListener('pointerover', place)
  root.addEventListener('focusin', place)
}

// ── The tip's side ──────────────────────────────────────────
// The whole-title tip opens under the card, from its left edge. Near the
// canvas's right edge (or the inspector beside it) that ran off screen,
// and near the bottom it ran under the status bar, so it opens toward the
// left, or above, when its room on the usual side is short and the other
// side has more. Its size is the CSS cap (280px) and two lines of text.
export const TIP_ROOM = { w: 280, h: 52, gap: 6 }

/** Which way the tip opens for a card and viewport rect. Pure, for the tests. */
export function tipSides(card, vp, room = TIP_ROOM) {
  const right = vp.right - card.left, left = card.right - vp.left
  const below = vp.bottom - card.bottom - room.gap, above = card.top - vp.top - room.gap
  return {
    x: right < room.w && left > right ? 'end' : '',
    y: below < room.h && above > below ? 'above' : '',
  }
}

/** Set the card's tip side for where it is on screen now (pill and dot bands only). */
export function placeTip(el) {
  const band = currentLod()
  if (band !== 'pill' && band !== 'dot') return
  const vp = $.canvasViewport()?.getBoundingClientRect(); if (!vp) return
  const { x, y } = tipSides(el.getBoundingClientRect(), vp)
  if ((el.dataset.tipX || '') !== x) { if (x) el.dataset.tipX = x; else delete el.dataset.tipX }
  if ((el.dataset.tipY || '') !== y) { if (y) el.dataset.tipY = y; else delete el.dataset.tipY }
}
