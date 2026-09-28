// ════════════════════════════════════════════════════════════
//  arrow-edit.js: edit a connection's label in place.
//
//  Double-click a connection or its label, or press Enter or F2
//  with a connection selected: a text field opens at the label (or
//  at the point of the line nearest the click) with the five
//  relations as chips under it. Enter, Escape and blur commit, and
//  an empty field clears the label. A commit is one undo step, and
//  so is each chip. The field sits in screen space over the canvas
//  and follows pan and zoom, so it stays readable zoomed out.
//
//  When the canvas is not on screen it falls back to the
//  inspector's label field.
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view } from './state.js'
import { $ } from './utils.js'
import { selectArrow, mutateArrow } from './render.js'
import { showPanels } from './chrome.js'
import { RELATIONS, impliedVerb } from './relations.js'
import { isMenuOpen } from './menu.js'
import { resolveRoutes, arrowPolyline, arrowRoute, labelPlacement, transformHooks,
         setupArrowHover, pruneArrowLabels, applyTransform } from './canvas.js'

let cur = null   // { aid, wrap, input, anchor: { x, y } in world units }

export function isArrowLabelEditing() { return !!cur }

/**
 * Open the label editor for a connection. `clientX/clientY` (a double-click)
 * places it on the line under the pointer when there is no label yet.
 * Returns false when it cannot (read-only view, unknown connection).
 */
export function startArrowLabelEdit(aid, { clientX, clientY } = {}) {
  if (ui.readOnly || ui.embed) return false
  const a = state.arrows.find(x => x.id === aid)
  if (!a) return false
  if (cur) commit()
  if (selection.arrowId !== aid) selectArrow(aid)

  const vp = $.canvasViewport()
  const rect = vp?.getBoundingClientRect()
  if (!vp || !rect || rect.width < 40 || rect.height < 40) return inspectorFallback()
  const anchor = anchorFor(a, clientX, clientY, rect)
  if (!anchor) return inspectorFallback()

  // Bring a label that is off screen (Enter on a far-away selection) into
  // view. Only when it really is off screen: a double-click near an edge
  // was on screen by definition, and recentring the canvas under the
  // pointer lost the reader's place. The editor flips and clamps instead.
  const sx = anchor.x * view.zoom + view.panX, sy = anchor.y * view.zoom + view.panY
  if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) {
    view.panX = rect.width / 2 - anchor.x * view.zoom
    view.panY = rect.height / 2 - anchor.y * view.zoom
    applyTransform()
  }

  const { wrap, input } = build(a)
  vp.appendChild(wrap)
  cur = { aid, wrap, input, anchor, vp }
  transformHooks.add(reposition)
  reposition()
  input.focus({ preventScroll: true })
  input.select()
  return true
}

/** Commit whatever is open. Safe to call when nothing is. */
export function commitArrowLabelEdit() { commit() }

// The field lives in the right panel. Focusing it inside a hidden panel
// does nothing visible, so bring the panel back first: out of Zen, and
// un-collapsed.
function inspectorFallback() {
  showPanels()
  const panel = document.getElementById('rightPanel')
  if (panel?.classList.contains('collapsed')) document.getElementById('panelReopenBtn')?.click()
  document.querySelector('.panel-tab[data-tab="inspector"]')?.click()
  const input = document.getElementById('arrowLabelInput')
  if (!input) return false
  input.focus()
  input.select?.()
  return true
}

function anchorFor(a, clientX, clientY, rect) {
  const placed = labelPlacement(a.id)
  if (placed && placed.text) return { x: placed.x, y: placed.y }
  const pts = resolveRoutes({ cheap: true }).get(a.id)
  if (!pts) return placed ? { x: placed.x, y: placed.y } : null
  const poly = arrowPolyline(pts, arrowRoute(a))
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    const wx = (clientX - rect.left - view.panX) / view.zoom
    const wy = (clientY - rect.top - view.panY) / view.zoom
    return nearestOnPolyline(poly, wx, wy)
  }
  return placed ? { x: placed.x, y: placed.y } : nearestOnPolyline(poly, (pts.x1 + pts.x2) / 2, (pts.y1 + pts.y2) / 2)
}

export function nearestOnPolyline(poly, x, y) {
  let best = null, bestD = Infinity
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i]
    const dx = b.x - a.x, dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0
    const px = a.x + dx * t, py = a.y + dy * t
    const d = (px - x) ** 2 + (py - y) ** 2
    if (d < bestD) { bestD = d; best = { x: Math.round(px), y: Math.round(py) } }
  }
  return best || (poly[0] ? { x: poly[0].x, y: poly[0].y } : null)
}

function build(a) {
  const wrap = document.createElement('div')
  wrap.className = 'arrow-edit'
  wrap.setAttribute('data-canvas-ui', '')
  wrap.setAttribute('role', 'group')
  wrap.setAttribute('aria-label', 'Edit connection label')

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'arrow-edit-input'
  input.value = a.label || ''
  input.maxLength = 120
  input.autocomplete = 'off'
  input.setAttribute('aria-label', 'Connection label')
  const verb = impliedVerb(state.blocks[a.from]?.type, state.blocks[a.to]?.type)
  input.placeholder = verb ? `Label, e.g. ${verb}` : 'Label'

  const chips = document.createElement('div')
  chips.className = 'arrow-edit-chips'
  chips.setAttribute('role', 'group')
  chips.setAttribute('aria-label', 'Meaning')
  let suggest = null
  if (verb) {
    suggest = document.createElement('button')
    suggest.type = 'button'
    suggest.className = 'arrow-edit-chip suggest'
    suggest.textContent = `Use “${verb}”`
    suggest.setAttribute('aria-label', `Use the suggested label: ${verb}`)
    suggest.hidden = !!(a.label || '').trim()
    suggest.addEventListener('click', () => {
      input.value = verb
      suggest.hidden = true
      input.focus({ preventScroll: true })
      input.setSelectionRange(verb.length, verb.length)
    })
    chips.appendChild(suggest)
  }
  Object.entries(RELATIONS).forEach(([key, label]) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'arrow-edit-chip'
    btn.dataset.relation = key
    btn.textContent = label
    btn.setAttribute('aria-pressed', String(a.relation === key))
    btn.addEventListener('click', () => {
      const arrow = state.arrows.find(x => x.id === a.id); if (!arrow) return
      // Pressing the active meaning again clears it.
      const next = arrow.relation === key ? null : key
      mutateArrow(a.id, { relation: next }, { undo: true })
      chips.querySelectorAll('[data-relation]').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.relation === next)))
    })
    chips.appendChild(btn)
  })
  // A press on a chip must not take focus from the field: that would blur,
  // commit and close the editor before the click lands.
  chips.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault() })

  input.addEventListener('keydown', e => {
    if (e.isComposing) return
    if (e.key === 'Enter' || e.key === 'Escape') {
      // Escape leaves editing and keeps what was typed, like the card editor.
      e.preventDefault()
      e.stopPropagation()
      commit({ refocus: true })
    }
  })
  input.addEventListener('input', () => {
    if (suggest) suggest.hidden = !!input.value.trim()
  })
  chips.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit({ refocus: true }) }
  })
  // Keys pressed inside the editor belong to it. A focused chip is a
  // button, which the page's shortcut handler does not treat as typing:
  // Backspace there deleted the connection being edited, and z, h or l
  // switched on Zen, hid the chrome or ran Tidy. Tab still moves focus.
  wrap.addEventListener('keydown', e => { if (e.key !== 'Tab') e.stopPropagation() })
  wrap.addEventListener('focusout', e => {
    if (e.relatedTarget && wrap.contains(e.relatedTarget)) return
    commit()
  })
  wrap.append(input, chips)
  return { wrap, input }
}

const EDGE = 8   // keep the editor this far inside the viewport

function reposition() {
  if (!cur) return
  const { wrap } = cur
  const sx = Math.round(cur.anchor.x * view.zoom + view.panX)
  const sy = Math.round(cur.anchor.y * view.zoom + view.panY)
  // The anchor stays the field's point of reference; near an edge the box
  // shifts sideways (--edit-dx) and the chips flip above the field, so the
  // whole editor stays on screen without moving the canvas.
  wrap.style.left = sx + 'px'
  wrap.style.top = sy + 'px'
  const vw = cur.vp.clientWidth, vh = cur.vp.clientHeight
  const w = wrap.offsetWidth, h = wrap.offsetHeight
  let dx = 0
  if (w && vw) {
    if (sx - w / 2 < EDGE) dx = EDGE - (sx - w / 2)
    else if (sx + w / 2 > vw - EDGE) dx = (vw - EDGE) - (sx + w / 2)
  }
  wrap.style.setProperty('--edit-dx', Math.round(dx) + 'px')
  // Below the field there are about h - 14 pixels of chips.
  wrap.classList.toggle('flip', !!(h && vh && sy + h - 14 > vh - EDGE && sy - h + 14 >= EDGE))
}

function close() {
  if (!cur) return null
  const c = cur
  cur = null
  transformHooks.delete(reposition)
  c.wrap.remove()
  return c
}

function commit({ refocus = false } = {}) {
  const c = close(); if (!c) return
  const a = state.arrows.find(x => x.id === c.aid)
  const next = c.input.value.trim()
  if (a && (a.label || '').trim() !== next) mutateArrow(c.aid, { label: next }, { undo: true })
  if (refocus) $.canvasViewport()?.focus({ preventScroll: true })
}

// ── Wiring ───────────────────────────────────────────────────
let wired = false
export function setupArrowEdit() {
  if (wired) return
  wired = true
  setupArrowHover()
  document.addEventListener('keydown', onKeydown)
  // deleteArrow removes only the line; drop its label too, and close an
  // editor whose connection an undo just took away.
  window.addEventListener('pf:canvas-changed', () => {
    pruneArrowLabels()
    if (cur && !state.arrows.some(a => a.id === cur.aid)) close()
  })
}

// Enter or F2 with a connection selected edits its label. Only from the
// canvas or the page itself, never while typing, never read-only.
export function onKeydown(e) {
  if (e.key !== 'Enter' && e.key !== 'F2') return
  if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
  if (ui.readOnly || cur || !selection.arrowId || selection.ids.size) return
  if (isMenuOpen()) return
  const ae = document.activeElement
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return
  const vp = $.canvasViewport()
  const fromCanvas = !ae || ae === document.body || ae === document.documentElement ||
    (vp && vp.contains(ae) && !ae.closest('[data-canvas-ui]') && !ae.closest('button, a[href]'))
  if (!fromCanvas) return
  e.preventDefault()
  startArrowLabelEdit(selection.arrowId)
}
