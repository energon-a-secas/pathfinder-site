// ════════════════════════════════════════════════════════════
//  palette.js: the left palette and the empty canvas's six-step
//  starter. Both are rendered from the type registry, grouped by
//  the question each type answers (Why, Who, Proof, What, How,
//  Doubt). Click, Enter or drag a type onto the canvas.
// ════════════════════════════════════════════════════════════

import { state, ui, toWorld } from './state.js'
import { $, TYPES, typesByStep, escHtml } from './utils.js'
import { createBlockAt } from './create.js'

const article = word => (/^[aeiou]/i.test(word) ? 'an' : 'a')

// ── Rendering ────────────────────────────────────────────────
function itemHtml(t) {
  const cfg = TYPES[t]
  const label = escHtml(cfg.label)
  return `<button type="button" class="palette-item" data-type="${t}" data-tier="${cfg.tier}"` +
    ` aria-label="Add ${label} block" aria-describedby="pdesc-${t}">` +
    `<span class="palette-dot" style="background:var(--c-${t})" aria-hidden="true"></span>` +
    `<span class="palette-item-text"><span class="palette-label">${label}</span></span>` +
    `<span class="sr-only" id="pdesc-${t}">${escHtml(cfg.short)}</span>` +
    `</button>`
}

/**
 * The palette's type rows, one group per step with a small heading. Every
 * type in the registry appears exactly once, in registry order within its step.
 */
export function renderPaletteTypes(list = document.getElementById('blocksList')) {
  if (!list) return
  list.innerHTML = typesByStep().filter(g => g.types.length).map(g => {
    const name = escHtml(`${g.label}: ${g.hint}`)
    return `<div class="palette-step" role="group" aria-label="${name}" data-step="${g.step}">` +
      `<div class="palette-step-head" title="${name}" aria-hidden="true">${escHtml(g.label)}</div>` +
      g.types.map(itemHtml).join('') +
      `</div>`
  }).join('')
}

/**
 * The empty state's "Map it in six steps" row: one button per step (Other
 * is support, not a step), each adding that step's first type.
 */
export function renderStepStarter(row = document.getElementById('mapSteps')) {
  if (!row) return
  const steps = typesByStep().filter(g => g.step !== 'other' && g.types.length)
  row.innerHTML = steps.map((g, i) => {
    const t = g.types[0], label = TYPES[t].label
    return `<button type="button" class="map-step" data-type="${t}" data-step="${g.step}"` +
      ` aria-label="${escHtml(`${i + 1}. ${g.label}: add ${article(label)} ${label}`)}"` +
      ` title="${escHtml(`${g.label}: ${g.hint}`)}">` +
      `<span class="map-step-head"><span class="map-step-num" aria-hidden="true">${i + 1}</span>${escHtml(g.label)}</span>` +
      `<span class="map-step-type"><span class="palette-dot" style="background:var(--c-${t})" aria-hidden="true"></span>${escHtml(label)}</span>` +
      `</button>`
  }).join('')
}

/** Add a block of `type` at the middle of the visible canvas, in title edit. */
export function addTypeAtCenter(type) {
  if (ui.readOnly || !Object.hasOwn(TYPES, type)) return null
  const r = $.canvasViewport().getBoundingClientRect()
  const w = toWorld(r.width / 2, r.height / 2)
  // A small stagger so repeated clicks do not stack cards exactly.
  const n = Object.keys(state.blocks).length % 5
  return createBlockAt(type, w.x + n * 12, w.y + n * 10)
}

// ── Hover and focus tip ──────────────────────────────────────
// One floating tip for the whole palette, fixed to the page. The palette
// scrolls, so a tip positioned inside it was clipped to nothing; this one
// also names the type when the palette is collapsed to its dots.
let tipEl = null
let tipItem = null   // the row the tip is showing for

function hideTip() { if (tipEl) tipEl.hidden = true; tipItem = null }

function showTip(item) {
  const cfg = TYPES[item?.dataset.type]; if (!cfg) return
  if (!tipEl) {
    tipEl = document.createElement('div')
    tipEl.className = 'palette-tip'
    // Screen readers get the same text from the row's own description.
    tipEl.setAttribute('aria-hidden', 'true')
    document.body.appendChild(tipEl)
  }
  // Several tips open with the short line itself; saying it twice in a row
  // reads as a stutter, so it only gets its own line when the tip does not.
  const repeats = String(cfg.tip || '').toLowerCase().startsWith(String(cfg.short || '').toLowerCase())
  tipEl.innerHTML =
    `<strong class="palette-tip-title">${escHtml(cfg.label)}</strong>` +
    (repeats ? '' : `<span class="palette-tip-short">${escHtml(cfg.short)}</span>`) +
    `<span class="palette-tip-body">${escHtml(cfg.tip)}</span>` +
    (cfg.example ? `<span class="palette-tip-example">e.g. ${escHtml(cfg.example)}</span>` : '')
  tipEl.hidden = false
  tipItem = item
  const pr = document.getElementById('palette')?.getBoundingClientRect() || item.getBoundingClientRect()
  const ir = item.getBoundingClientRect()
  const { width: tw, height: th } = tipEl.getBoundingClientRect()
  const pad = 8
  let left, top
  if (pr.width > pr.height) {
    // The phone layout lays the palette out as a strip: tip below the row.
    left = ir.left; top = pr.bottom + pad
  } else {
    left = pr.right + pad; top = ir.top + ir.height / 2 - th / 2
  }
  left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad))
  top = Math.max(pad, Math.min(top, window.innerHeight - th - pad))
  tipEl.style.left = left + 'px'
  tipEl.style.top = top + 'px'
}

// ── Palette ──────────────────────────────────────────────────
let paletteWired = false
const wiredStarters = new WeakSet()
export function setupPalette() {
  renderPaletteTypes()
  renderStepStarter()

  // The six-step starter sits in the Brain Dump card, inside the canvas.
  // Setup can run again (tests, a re-render), so each row is wired once.
  const steps = document.getElementById('mapSteps')
  if (steps && !wiredStarters.has(steps)) {
    wiredStarters.add(steps)
    steps.addEventListener('click', e => {
      const b = e.target.closest('.map-step'); if (b) addTypeAtCenter(b.dataset.type)
    })
  }

  const palette = document.getElementById('palette')
  if (!palette || paletteWired) return
  paletteWired = true

  let lastDragTime = 0
  palette.addEventListener('click',   e => {
    if (Date.now() - lastDragTime < 300) return // skip click after drag
    const i = e.target.closest('.palette-item'); if (i) addTypeAtCenter(i.dataset.type)
  })
  // The rows are buttons, so Enter and Space would click them anyway; taking
  // the key here (and preventing the button's own click) adds exactly one.
  palette.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const i = e.target.closest('.palette-item'); if (!i) return
    e.preventDefault(); hideTip(); addTypeAtCenter(i.dataset.type)
  })

  // Tip on mouse hover and on keyboard focus; never on touch, which has no hover.
  palette.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return
    const i = e.target.closest('.palette-item'); if (i) showTip(i)
  })
  palette.addEventListener('pointerout', e => {
    const i = e.target.closest('.palette-item')
    if (i && !i.contains(e.relatedTarget)) hideTip()
  })
  palette.addEventListener('focusin', e => {
    const i = e.target.closest('.palette-item')
    if (i && i.matches(':focus-visible')) showTip(i)
  })
  palette.addEventListener('focusout', hideTip)
  // Tabbing to a row below the fold scrolls the palette just after focusin
  // showed that row's tip: the tip follows its row instead of vanishing. A
  // wheel scroll moves rows out from under a hover tip, so that one hides.
  palette.addEventListener('scroll', () => {
    if (tipItem && tipItem === document.activeElement && tipEl && !tipEl.hidden) showTip(tipItem)
    else hideTip()
  }, { passive: true })

  // Pointer-event-based drag from palette to canvas (works on touch + mouse)
  // Uses an 8px threshold before committing to drag so mobile scroll isn't hijacked
  const DRAG_THRESHOLD = 8
  let paletteDrag = null

  palette.addEventListener('pointerdown', e => {
    const item = e.target.closest('.palette-item'); if (!item) return
    hideTip()
    if (ui.readOnly) return
    const type = item.dataset.type
    if (!type || !TYPES[type]) return
    paletteDrag = { type, item, ghost: null, startX: e.clientX, startY: e.clientY, committed: false }
    item.setPointerCapture(e.pointerId)
  })

  palette.addEventListener('pointermove', e => {
    if (!paletteDrag) return
    const dx = e.clientX - paletteDrag.startX
    const dy = e.clientY - paletteDrag.startY

    if (!paletteDrag.committed) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
      // Commit to drag: create the ghost
      paletteDrag.committed = true
      paletteDrag.item.classList.add('dragging')
      const ghost = document.createElement('div')
      ghost.className = 'palette-drag-ghost'
      ghost.textContent = TYPES[paletteDrag.type]?.label || paletteDrag.type
      ghost.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;pointer-events:none;z-index:1000`
      document.body.appendChild(ghost)
      paletteDrag.ghost = ghost
    }

    paletteDrag.ghost.style.left = e.clientX + 'px'
    paletteDrag.ghost.style.top = e.clientY + 'px'

    const vp = $.canvasViewport()
    const r = vp.getBoundingClientRect()
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    vp.classList.toggle('drop-target', over)
  })

  // Listen on document so pointerup is caught even when pointer leaves palette
  document.addEventListener('pointerup', e => {
    if (!paletteDrag) return
    const { type, item, ghost, committed } = paletteDrag
    paletteDrag = null
    item.classList.remove('dragging')
    if (ghost) ghost.remove()

    const vp = $.canvasViewport()
    vp.classList.remove('drop-target')

    if (!committed) return // click handled by click listener

    lastDragTime = Date.now()
    const r = vp.getBoundingClientRect()
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const w = toWorld(e.clientX - r.left, e.clientY - r.top)
      createBlockAt(type, w.x, w.y)
    }
  })

  document.addEventListener('pointercancel', () => {
    if (!paletteDrag) return
    paletteDrag.item.classList.remove('dragging')
    if (paletteDrag.ghost) paletteDrag.ghost.remove()
    paletteDrag = null
    $.canvasViewport().classList.remove('drop-target')
  })
}
