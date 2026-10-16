// ════════════════════════════════════════════════════════════
//  panel-resize.js: how wide the right panel is.
//
//  A separator on the panel's left edge sets the width: drag it,
//  click it for a short list of widths (the single-pointer way,
//  WCAG 2.5.7; Enter or Space opens the same list), or focus it
//  and use the arrow keys (Shift for bigger steps, Home and End
//  for the limits); a double-click puts the stylesheet's width
//  back. It is the panel's sibling, so its 24px target straddles
//  the edge, half over the canvas and half over the panel. The width is a per-browser view
//  preference (`pathfinder-panel-width`), never part of a map,
//  and stays between 320px and the smaller of half the window
//  and 760px. Only where the panel is a column beside the canvas
//  (769px and up): under that it is a band across the window's
//  foot, and on a phone a bottom sheet, both the window's width,
//  and there is nothing to drag.
//
//  The Brief's Read control borrows a width (borrowWidth) and
//  gives it back (returnWidth); a drag while it is borrowed makes
//  the dragged width the person's own and ends the loan.
//
//  The canvas sits to the panel's left and its camera is pinned
//  to its own top left corner, so a new width moves no card. What
//  depends on the canvas's size (the minimap's frame, the Back to
//  content pill, a toast centred over the canvas) follows the
//  edge through a window resize event, as chrome.js does for H
//  and Z.
// ════════════════════════════════════════════════════════════

import { placeToast } from './utils.js'
import { openMenu } from './menu.js'

export const PANEL_MIN = 320
export const PANEL_MAX = 760
export const PANEL_WIDTH_KEY = 'pathfinder-panel-width'
const STEP = 16, BIG_STEP = 64
// How long a click waits to be sure it is not the first of a double-click.
const DOUBLE_CLICK_MS = 260
// Where the panel stops being a column (style.css, the 768px rules).
const NOT_A_COLUMN = '(max-width: 768px)'

const byId = id => document.getElementById(id)
const notAColumn = () => { try { return window.matchMedia(NOT_A_COLUMN).matches } catch (_) { return false } }

/** Whether the panel is a column beside the canvas here, the only place it takes a width. */
export function panelIsColumn() { return !notAColumn() }

/**
 * The stylesheet's own width for the panel at this window width: 320px,
 * 280px at 1024px and under (style.css, the right panel and its tablet
 * rule). Reset goes back to it.
 */
export function defaultPanelWidth(vw = window.innerWidth) { return vw <= 1024 ? 280 : 320 }

/** The narrowest the separator goes: 320px, or the stylesheet's width where that is less. */
export function panelMin(vw = window.innerWidth) { return Math.min(PANEL_MIN, defaultPanelWidth(vw)) }

/** The widest: half the window, never over 760px, never under the minimum. */
export function panelMax(vw = window.innerWidth) { return Math.max(panelMin(vw), Math.min(Math.floor(vw / 2), PANEL_MAX)) }

/**
 * The widths a click on the separator offers: the stylesheet's own, the
 * widest this window allows, and one between them. Each is a whole 8px
 * step; one the window leaves no room for is left out.
 */
export function panelWidthChoices(vw = window.innerWidth) {
  const base = defaultPanelWidth(vw), max = panelMax(vw)
  const wide = clampPanelWidth(Math.round((base + max) / 16) * 8, vw)
  return [
    { key: 'default', label: 'Default width', width: base },
    { key: 'wide', label: 'Wide', width: wide },
    { key: 'widest', label: 'Widest', width: max },
  ].filter((c, i, all) => i === 0 || c.width > all[i - 1].width)
}

/** A width held to the limits for a window `vw` wide, in whole pixels. */
export function clampPanelWidth(w, vw = window.innerWidth) {
  const n = Number(w)
  if (!Number.isFinite(n)) return defaultPanelWidth(vw)
  return Math.round(Math.min(panelMax(vw), Math.max(panelMin(vw), n)))
}

/** The width this browser chose, or null for the stylesheet's own. */
export function storedPanelWidth() {
  try {
    const v = parseInt(localStorage.getItem(PANEL_WIDTH_KEY), 10)
    return Number.isFinite(v) && v > 0 ? v : null
  } catch (_) { return null }
}

function storeWidth(w) {
  try {
    if (w == null) localStorage.removeItem(PANEL_WIDTH_KEY)
    else localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(w)))
  } catch (_) {}
}

// The loan the Read control holds: the width shown while reading. Null when
// nothing is borrowed. The person's own width stays in storage throughout.
let borrowed = null

/** The width the panel should have now: a loan, else the stored choice, held to the limits. */
export function wantedPanelWidth() {
  const own = borrowed ?? storedPanelWidth()
  return own == null ? null : clampPanelWidth(own)
}

let settleQueued = false
/**
 * After the width changes, once a frame: what sizes itself off the canvas
 * hears a window resize (minimap, the Back to content pill, open menus),
 * and a toast over the canvas is centred again.
 */
function settle() {
  if (settleQueued) return
  settleQueued = true
  const run = () => {
    settleQueued = false
    window.dispatchEvent(new CustomEvent('pf:panel-width', { detail: { width: currentWidth(), reading: borrowed != null } }))
    resizing = true
    try { window.dispatchEvent(new Event('resize')) } finally { resizing = false }
    const toast = document.querySelector('.toast-notification')
    if (toast && toast.classList.contains('toast-in-canvas')) placeToast(toast)
  }
  if (typeof requestAnimationFrame === 'function' && !document.hidden) requestAnimationFrame(run)
  else run()
}
let resizing = false

function currentWidth() {
  const panel = byId('rightPanel')
  return panel ? Math.round(panel.getBoundingClientRect().width) : 0
}

/** Draw the panel at `w` (null: the stylesheet's width) and say so on the separator. */
function apply(w) {
  const panel = byId('rightPanel'); if (!panel) return
  if (w == null) {
    panel.classList.remove('is-sized')
    panel.style.removeProperty('--panel-w')
  } else {
    panel.classList.add('is-sized')
    panel.style.setProperty('--panel-w', w + 'px')
  }
  syncSeparator()
  settle()
}

/** The separator's value, limits and words, from what is drawn. */
export function syncSeparator() {
  const sep = byId('panelResizer'); if (!sep) return
  const panel = byId('rightPanel')
  const w = panel && panel.getClientRects().length ? currentWidth() : (wantedPanelWidth() ?? defaultPanelWidth())
  sep.setAttribute('aria-valuemin', String(panelMin()))
  sep.setAttribute('aria-valuemax', String(panelMax()))
  sep.setAttribute('aria-valuenow', String(w))
  sep.setAttribute('aria-valuetext', `${w} pixels wide`)
}

// A loan the person ended by choosing a width of their own (a drag, the
// keys, the list of widths): the Brief's Read is off, and is not brought
// back next time (brief.js listens).
function loanTaken() {
  if (borrowed == null) return
  borrowed = null
  window.dispatchEvent(new CustomEvent('pf:read-loan-taken'))
}

/** Set the person's own width (stored), ending any loan. Returns the width drawn. */
export function setPanelWidth(w) {
  loanTaken()
  const next = clampPanelWidth(w)
  storeWidth(next)
  apply(next)
  return next
}

/** Back to the stylesheet's width: the double-click, and nothing stored. */
export function resetPanelWidth() {
  loanTaken()
  storeWidth(null)
  apply(null)
}

/** Lend the panel a width (the Read control): drawn, never stored. */
export function borrowWidth(w) {
  if (notAColumn()) return null
  borrowed = clampPanelWidth(w)
  apply(borrowed)
  return borrowed
}

/** Give a borrowed width back: the person's own, or the stylesheet's. */
export function returnWidth() {
  if (borrowed == null) return false
  borrowed = null
  apply(wantedPanelWidth())
  return true
}

export function isWidthBorrowed() { return borrowed != null }

/** The separator's list of widths, as menu.js rows: the one drawn now is checked. */
export function panelWidthItems(vw = window.innerWidth) {
  const now = currentWidth()
  return panelWidthChoices(vw).map(c => ({
    label: c.label, hint: `${c.width} pixels`, radio: true, checked: Math.abs(now - c.width) <= 1,
    action: () => { if (c.key === 'default') resetPanelWidth(); else setPanelWidth(c.width) },
  }))
}

/** Open the list of widths beside the separator, or at a point. */
export function openPanelWidthMenu(at = null) {
  const sep = byId('panelResizer')
  if (!sep || notAColumn()) return null
  const r = sep.getBoundingClientRect()
  return openMenu(panelWidthItems(), {
    x: at ? at.x : r.left + r.width / 2, y: at ? at.y : r.top + Math.min(r.height / 2, 160),
    label: 'Panel width', className: 'panel-width-menu', returnFocus: sep,
  })
}

// ── Wiring ───────────────────────────────────────────────────

let wired = false
export function setupPanelResize() {
  const sep = byId('panelResizer'), panel = byId('rightPanel')
  if (wired || !sep || !panel) return
  wired = true
  const own = wantedPanelWidth()
  if (own != null) apply(own)
  else syncSeparator()

  // Pointer: the panel's right edge stays put, so the width is that edge
  // minus the pointer, from where the drag started. A press that does not
  // move is a click: it opens the list of widths, once it is clear it is
  // not the first half of a double-click (which resets instead).
  let drag = null, raf = 0, pending = null, dragged = false, menuTimer = 0
  const draw = () => { raf = 0; if (pending != null) { apply(pending); pending = null } }
  sep.addEventListener('pointerdown', e => {
    if (e.button !== 0 || notAColumn()) return
    e.preventDefault()
    dragged = false
    try { sep.setPointerCapture(e.pointerId) } catch (_) {}
    drag = { id: e.pointerId, x: e.clientX, w: currentWidth() }
    document.body.classList.add('panel-resizing')
    sep.focus({ preventScroll: true })
  })
  sep.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return
    // A drag makes the width the person's own: a loan ends at the first move.
    loanTaken()
    pending = clampPanelWidth(drag.w + (drag.x - e.clientX))
    if (!raf) raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : (draw(), 0)
  })
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return
    if (raf) { cancelAnimationFrame(raf); draw() }
    const moved = Math.abs(e.clientX - drag.x) > 1
    drag = null
    dragged = moved
    document.body.classList.remove('panel-resizing')
    if (moved) setPanelWidth(currentWidth())
  }
  sep.addEventListener('pointerup', end)
  sep.addEventListener('pointercancel', end)
  sep.addEventListener('lostpointercapture', end)
  sep.addEventListener('click', e => {
    clearTimeout(menuTimer)
    // The click that ends a drag is the drag's, not a request for widths.
    if (dragged) { dragged = false; return }
    if (notAColumn()) return
    // A click from assistive technology (no pointer count) opens at once.
    if (!e.detail) { openPanelWidthMenu(); return }
    if (e.detail > 1) return
    const at = { x: e.clientX, y: e.clientY }
    menuTimer = setTimeout(() => openPanelWidthMenu(at), DOUBLE_CLICK_MS)
  })
  sep.addEventListener('dblclick', e => { e.preventDefault(); clearTimeout(menuTimer); resetPanelWidth() })

  // Keyboard: the panel is on the right, so left widens it; Enter or Space
  // opens the list of widths.
  sep.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); e.stopPropagation()
      openPanelWidthMenu()
      return
    }
    const step = e.shiftKey ? BIG_STEP : STEP
    const w = currentWidth()
    const next = {
      ArrowLeft: w + step, ArrowUp: w + step, PageUp: w + BIG_STEP,
      ArrowRight: w - step, ArrowDown: w - step, PageDown: w - BIG_STEP,
      Home: panelMin(), End: panelMax(),
    }[e.key]
    if (next === undefined) return
    e.preventDefault()
    e.stopPropagation()
    setPanelWidth(next)
  })

  // A narrower window holds the width to its new limit; a wider one gives
  // the stored width back. The resize this module dispatches is skipped.
  window.addEventListener('resize', () => {
    if (resizing) return
    const want = wantedPanelWidth()
    const drawn = panel.classList.contains('is-sized') ? parseInt(panel.style.getPropertyValue('--panel-w'), 10) : null
    if (want !== drawn) apply(want)
    else syncSeparator()
  })
}
