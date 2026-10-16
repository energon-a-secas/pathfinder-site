// ════════════════════════════════════════════════════════════
//  lod.js: how the map reads at any zoom. The level-of-detail
//  band on the canvas root, the card's small-zoom face, and the
//  hover fade. The look is CSS (the [zoom] section of style.css);
//  this module only decides which band applies and paints the
//  face. zoom-controls.js sets it up and re-exports it.
// ════════════════════════════════════════════════════════════

import { state, view, saveHooks } from './state.js'
import { $, escHtml, TYPES } from './utils.js'
import { transformHooks } from './canvas.js'
import { blockDecorators } from './render.js'
import { typeShape } from './cards.js'
import { ELLIPSIS, FACE_METRICS, fitTitle, fitFaceTitle, faceLayout, faceMetrics } from './face-text.js'
export { ELLIPSIS, FACE_METRICS, titlePieces, fitTitle, fitFaceTitle, faceLayout, faceMetrics } from './face-text.js'

// ── Level of detail ─────────────────────────────────────────
// A card drawn at 30% is a texture: a 14px title is 4px on screen. So the
// canvas root carries a band class and the cards show less, larger, as the
// map gets smaller:
//
//   lod-full   92% and above   the whole card
//   lod-title  45% to 92%      the type and the title, 11px or more on screen
//   lod-pill   25% to 45%      the type's dot and the title, in a line or two
//   lod-dot    under 25%       the card in its type colour, its title on hover or focus
//
// and connection labels step aside below full detail until a line or one
// of its cards is hovered or selected. Only what is inside a card changes: the
// card keeps its size in the world, so no line is re-routed when the zoom
// crosses a band, and the image export (which draws from the state) is the
// same at any zoom.

// Full detail starts where the card's smallest prose, the 12px description,
// is 11px on screen (11 / 12, rounded up): the 11px floor holds on the
// canvas too. It started at 75%, where a description drew at 9px and the
// type label at 8.25px, and zooming in across 75% made the type label
// smaller (11px on the title face, 8.4px on the full card). Between 92% and
// 100% the card's 11px strings (the type label, chips, line labels) are
// drawn up to their screen size ([zoom] in style.css), which moves nothing.
export const FULL_DETAIL_ZOOM = 0.92
export const LOD_BANDS = [
  { band: 'full', min: FULL_DETAIL_ZOOM },
  { band: 'title', min: 0.45 },
  { band: 'pill', min: 0.25 },
  { band: 'dot', min: 0 },
]
// Connection labels rest with full detail: below it an 11px label drew at
// 6.6 to 10px. A hovered or selected line still shows its label, at its
// screen size.
export const LABELS_MIN_ZOOM = FULL_DETAIL_ZOOM
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

const lod = { band: null, labels: null, z: null, exact: true, k: null, fitK: null, vp: null }
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
  // The cards' sizes, read before this frame writes anything they depend on.
  if (FIT_BANDS.has(band) && (k !== lod.fitK || band !== lod.band)) primeSizes(root)
  if (k !== lod.k || !root.style.getPropertyValue('--lodk')) {
    root.style.setProperty('--lodk', String(+k.toFixed(5)))
    lod.k = k
  }
  let refit = k !== lod.fitK
  if (band !== lod.band || !root.classList.contains('lod-' + band)) {
    LOD_BANDS.forEach(b => root.classList.toggle('lod-' + b.band, b.band === band))
    refit = refit || band !== lod.band
    lod.band = band
  }
  // A new band or a new face scale changes how much of a title fits: break
  // every title again, now, so no frame shows the old lines at the new size
  // (on a large map, the ones in and near the view now and the rest just
  // after: refitFaces).
  if (refit && FIT_BANDS.has(band)) refitFaces(root)
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
  // Below full detail the new face's title is broken into lines before the
  // next paint (a microtask, batched: a whole map renders card by card).
  sizes.delete(el)
  if (FIT_BANDS.has(currentLod())) queueFit(el)
  else queuePrime()
}

// ── Titles that break between words ─────────────────────────
// The lines, the layout and the metrics are face-text.js (pure); this
// module measures and writes them.
const FIT_BANDS = new Set(['title', 'pill'])

// Measuring: one canvas context, a cache per font and string (cleared when
// web fonts arrive, which change every width).
// The family is read once: asking for a computed style right after the band
// class changed would restyle every card a second time in the same frame.
let measureCtx = null, family = ''
const widths = new Map()
function measurer(px, weight = 600) {
  if (!measureCtx) {
    try { measureCtx = document.createElement('canvas').getContext('2d') } catch (_) { measureCtx = null }
  }
  if (!family) family = getComputedStyle(document.body).fontFamily || 'sans-serif'
  const font = `${weight} ${px}px ${family}`
  return s => {
    const k = font + '\n' + s
    let v = widths.get(k)
    if (v === undefined) {
      if (measureCtx) { measureCtx.font = font; v = measureCtx.measureText(s).width }
      else v = s.length * px * 0.6
      if (widths.size > 20000) widths.clear()
      widths.set(k, v)
    }
    return v
  }
}

// A card's size (inside its border) does not change with the zoom, so it
// is read once and kept: a band change or a scale step then only writes,
// and the page lays out once. Reading it after the new --lodk forced a
// layout of every face first, which doubled the cost of a step at 300
// cards. A card that renders again, any save (a resize handle moves no
// state) and the fonts arriving forget the sizes they may have changed.
let sizes = new WeakMap()
function cardSize(el) {
  let s = sizes.get(el)
  if (!s) {
    s = { w: el.clientWidth, h: el.clientHeight }
    // A canvas that is not laid out (hidden) has no sizes to keep.
    if (s.w > 0) sizes.set(el, s)
  }
  return s
}
// The viewport's size too (refitFaces culls with it), but only when a
// card's size was read anyway or it is not known: reading it on every
// refit forced a layout that the writes then threw away.
function primeSizes(root) {
  let read = !lod.vp
  for (const el of root.querySelectorAll(':scope > .block')) if (!sizes.has(el)) { cardSize(el); read = true }
  const vp = read && $.canvasViewport()
  if (vp) lod.vp = { w: vp.clientWidth, h: vp.clientHeight }
}

/**
 * The title's lines, written one element per line (a space between, so its
 * text reads whole). The closing line of a cut title is `is-end`, which
 * lets its ellipsis hang into the padding (--lod-hang).
 */
function writeLines(title, lines, cut = false, hangs = null) {
  const hang = i => hangs ? !!hangs[i] : cut && i === lines.length - 1
  const want = lines.join('\n') + (cut ? '\n…' : '') + (hangs ? '\n' + hangs.map(h => h ? 1 : 0).join('') : '')
  if (title.dataset.lines === want) return
  title.dataset.lines = want
  title.replaceChildren(...lines.flatMap((l, i) => {
    const span = document.createElement('span')
    span.className = hang(i) ? 'block-lod-line is-end' : 'block-lod-line'
    span.textContent = l
    return i ? [document.createTextNode(' '), span] : [span]
  }))
}

/**
 * Break the face titles of `els` (every card by default) for the current
 * band and scale. Reads every card's size first and writes after, so a map
 * of 300 cards lays out once.
 */
export function fitFaces(els = null) {
  const band = currentLod()
  if (!FIT_BANDS.has(band)) return
  const root = $.canvasRoot(); if (!root) return
  const cards = els ? [...els].filter(el => el?.isConnected) : [...root.querySelectorAll(':scope > .block')]
  const k = lod.k || 1
  const measureType = measurer(FACE_METRICS.title.typeFont)
  const measure = { [FACE_METRICS.title.font]: measurer(FACE_METRICS.title.font), [FACE_METRICS.pill.font]: measurer(FACE_METRICS.pill.font) }
  const jobs = cards.map(el => {
    const face = el.querySelector(':scope > .block-lod .block-lod-face')
    const title = face?.querySelector('.block-lod-title')
    if (!title) return null
    const size = cardSize(el)
    return { el, face, title, w: size.w / k, h: size.h / k }
  }).filter(Boolean)
  for (const j of jobs) {
    const b = state.blocks[j.el.dataset.id]
    const text = (b?.title || '').trim()
    const type = TYPES[b?.type]?.label || b?.type || ''
    const spec = faceLayout(band, j.w, j.h, { typeFits: width => measureType(type) <= width })
    if (j.face.dataset.layout !== spec.layout) j.face.dataset.layout = spec.layout
    const m = faceMetrics(band, spec.layout)
    const fit = text ? fitFaceTitle(text, spec, m, measure[m.font]) : { lines: ['Untitled'], cut: false, dot: true }
    writeLines(j.title, fit.lines, fit.cut, fit.hangs)
    // A word wider than its line took the dot's room (fitFaceTitle).
    if ((j.face.dataset.nodot === '1') === fit.dot) { if (fit.dot) delete j.face.dataset.nodot; else j.face.dataset.nodot = '1' }
    // A cut title is read whole in the tip, in the title band too.
    const box = j.face.parentElement
    if ((box.dataset.cut === '1') !== fit.cut) { if (fit.cut) box.dataset.cut = '1'; else delete box.dataset.cut }
  }
  if (!els) lod.fitK = k
}

// ── Refitting a large map ───────────────────────────────────
// A band change or a new face scale refits every face. At 300 cards the
// first time (nothing measured yet) took 78ms in one frame, so a map of
// more than FIT_NOW_MAX cards fits the cards in and near the view (half a
// view round it) at once and the rest in idle time, a batch at a time,
// before a pan could bring them in. A newer refit drops what is left of an
// older one, and a batch that runs after the zoom went back to full detail
// does nothing.
export const FIT_NOW_MAX = 80
const FIT_BATCH = 60
let restJob = null
const idle = cb => typeof requestIdleCallback === 'function' ? { idle: requestIdleCallback(cb, { timeout: 120 }) } : { timer: setTimeout(() => cb(null), 16) }
function cancelRest() {
  if (!restJob) return
  if (restJob.idle) cancelIdleCallback(restJob.idle); else clearTimeout(restJob.timer)
  restJob = null
}
function fitRest(queue) {
  restJob = idle(deadline => {
    restJob = null
    do fitFaces(queue.splice(0, FIT_BATCH))
    while (queue.length && deadline && deadline.timeRemaining() > 6)
    if (queue.length) fitRest(queue)
  })
}

/** Which of `cards` are in or near the view, from the state, the camera and the kept sizes: no layout read. Pure but for the sizes. */
export function nearView(cards, cam = view, vp = lod.vp) {
  const z = cam.zoom || 1
  if (!vp?.w) return { near: cards, far: [] }
  const w = vp.w / z, h = vp.h / z, pad = Math.max(w, h) / 2
  const x0 = -cam.panX / z - pad, y0 = -cam.panY / z - pad, x1 = x0 + w + 2 * pad, y1 = y0 + h + 2 * pad
  const near = [], far = []
  for (const el of cards) {
    const b = state.blocks[el.dataset.id], s = sizes.get(el)
    const inView = !b || !s || (b.x < x1 && b.x + s.w > x0 && b.y < y1 && b.y + s.h > y0)
    ;(inView ? near : far).push(el)
  }
  return { near, far }
}

function refitFaces(root) {
  cancelRest()
  const cards = [...root.querySelectorAll(':scope > .block')]
  lod.fitK = lod.k
  if (cards.length <= FIT_NOW_MAX) { fitFaces(cards); return }
  const { near, far } = nearView(cards)
  fitFaces(near)
  if (far.length) fitRest(far)
}

let fitQueue = null
function queueFit(el) {
  if (!fitQueue) {
    fitQueue = new Set()
    queueMicrotask(() => { const q = fitQueue; fitQueue = null; fitFaces(q) })
  }
  fitQueue.add(el)
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
  // A card can change size without a re-render (a resize handle, a web font
  // arriving): every save, and the fonts, break the titles again. Lines
  // that did not change are not rewritten.
  saveHooks.push(() => { sizes = new WeakMap(); if (FIT_BANDS.has(currentLod())) queueFitAll(); else queuePrime() })
  window.addEventListener('resize', () => { lod.vp = null; queuePrime() })
  document.fonts?.ready?.then(() => {
    widths.clear(); family = ''; sizes = new WeakMap()
    if (FIT_BANDS.has(currentLod())) fitFaces(); else queuePrime()
  }, () => {})
  queuePrime()
  applyLod({ exact: true })
}

// At full detail the cards' sizes, the viewport's and the font are read
// in idle time, while the layout is clean and a read costs nothing, so the
// zoom that first crosses into the faces only writes. Read there, they
// forced a layout of the whole map at the old band that the new band's
// writes then threw away: the first crossing at 300 cards took 78ms.
let primeJob = null
function queuePrime() {
  if (primeJob) return
  primeJob = idle(() => {
    primeJob = null
    const root = $.canvasRoot()
    if (!root || FIT_BANDS.has(currentLod())) return
    if (!family) family = getComputedStyle(document.body).fontFamily || 'sans-serif'
    primeSizes(root)
  })
}

let fitAllQueued = false
function queueFitAll() {
  if (fitAllQueued) return
  fitAllQueued = true
  queueMicrotask(() => { fitAllQueued = false; fitFaces() })
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
  setupFocusChip()
}

// ── The canvas's focus chip ─────────────────────────────────
// The canvas's own keyboard focus shows as a chip at its top left
// ([canvas4]), and only when the focus arrived from the keyboard (Tab, or
// a key that handed it back). :focus-visible is not enough on its own: it
// stays true when a click lands on a canvas the keyboard had focused, and
// Chrome turns it on for a canvas a click focused as soon as any key is
// pressed, so N, then a letter, or Cmd+K after a click flashed the chip.
// The viewport carries how its focus arrived (data-input): a press
// anywhere takes the chip away, and only focus arriving again by keyboard
// brings it back.
let chipWired = false
export function setupFocusChip() {
  const vp = $.canvasViewport()
  if (chipWired || !vp) return
  chipWired = true
  let last = 'pointer'
  const note = kind => { if (vp.dataset.input !== kind) vp.dataset.input = kind }
  document.addEventListener('pointerdown', () => { last = 'pointer'; note('pointer') }, true)
  document.addEventListener('keydown', () => { last = 'key' }, true)
  vp.addEventListener('focus', () => note(last))
  note(last)
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

/** Set the card's tip side for where it is on screen now (below full detail only). */
export function placeTip(el) {
  if (!FIT_BANDS.has(currentLod()) && currentLod() !== 'dot') return
  const vp = $.canvasViewport()?.getBoundingClientRect(); if (!vp) return
  const { x, y } = tipSides(el.getBoundingClientRect(), vp)
  if ((el.dataset.tipX || '') !== x) { if (x) el.dataset.tipX = x; else delete el.dataset.tipX }
  if ((el.dataset.tipY || '') !== y) { if (y) el.dataset.tipY = y; else delete el.dataset.tipY }
}
