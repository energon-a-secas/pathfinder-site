// ════════════════════════════════════════════════════════════
//  type-keys.js: N, then a letter, adds a block of that type.
//
//  N arms it and shows which letter makes which type (TYPE_KEYS in
//  ui-panels.js, the table the shortcut sheet and the command
//  palette show too). The next key decides: a type letter adds that
//  block at the pointer when the pointer is over the canvas, else at
//  the centre of the view, and opens its title; Escape or any other
//  key cancels, and nothing else that key would have done happens
//  (after N, T is not the type check and L is not Tidy). Only while
//  the canvas has focus, never while typing, never on a view-only
//  link. One undo step, like every other way to add a block.
// ════════════════════════════════════════════════════════════

import { ui, toWorld } from './state.js'
import { $, TYPES } from './utils.js'
import { createBlockAt } from './create.js'
import { typeDot, typeNoun } from './type-menu.js'
import { isMenuOpen } from './menu.js'
import { TYPE_KEYS } from './ui-panels.js'
import { isTyping, canvasHasFocus, modalDialogOpen, withCameraHeld, announce } from './navigation.js'
import { centreWorld } from './command-items.js'

const MODIFIERS = new Set(['Shift', 'Alt', 'Control', 'Meta', 'CapsLock', 'AltGraph', 'Fn', 'OS'])

/** The type a letter makes after N, or null. */
export function typeForKey(letter) {
  const k = String(letter || '').toLowerCase()
  return Object.keys(TYPE_KEYS).find(t => TYPE_KEYS[t] === k && Object.hasOwn(TYPES, t)) || null
}

// The letter a key press means, layout first: e.key on a Latin layout,
// else the physical key (a Cyrillic layout still has a KeyG).
function letterOf(e) {
  const k = (e.key || '').toLowerCase()
  if (/^[a-z]$/.test(k)) return k
  const m = /^Key([A-Z])$/.exec(e.code || '')
  return m ? m[1].toLowerCase() : null
}

let armed = false
let hintEl = null
let pointer = null       // the last pointer position over the canvas (client px)

export function isTypeKeyArmed() { return armed }

const sheetOpen = () => { const o = $.shortcutOverlay(); return !!o && o.style.display !== 'none' }

function canAct() {
  return !ui.readOnly && !modalDialogOpen() && !isMenuOpen() && !sheetOpen() && !isTyping() && canvasHasFocus()
}

// ── The hint ─────────────────────────────────────────────────
// Which letter makes which type, while N is armed. Drawn over the canvas
// and hidden from screen readers, which hear the same list announced.
function showHint() {
  const vp = $.canvasViewport(); if (!vp) return
  if (!hintEl) {
    hintEl = document.createElement('div')
    hintEl.className = 'typekeys-hint'
    hintEl.setAttribute('data-canvas-ui', '')
    hintEl.setAttribute('aria-hidden', 'true')
  }
  // Rebuilt each time, so the dots follow the theme.
  hintEl.innerHTML =
    '<div class="typekeys-head"><span class="typekeys-title">New block</span>' +
    '<span class="typekeys-sub">Press a letter. Esc cancels</span></div>' +
    '<ul class="typekeys-list">' + Object.keys(TYPES).filter(t => TYPE_KEYS[t]).map(t =>
      `<li><kbd class="typekeys-key">${TYPE_KEYS[t].toUpperCase()}</kbd>` +
      `<span class="pf-menu-dot" data-shape="${TYPES[t].shape || 'dot'}" style="background:${typeDot(t)}"></span>` +
      `<span class="typekeys-label">${TYPES[t].label}</span></li>`).join('') + '</ul>'
  if (hintEl.parentElement !== vp) vp.appendChild(hintEl)
  hintEl.hidden = false
}

function hideHint() { if (hintEl) hintEl.hidden = true }

function arm() {
  armed = true
  showHint()
  const list = Object.keys(TYPES).filter(t => TYPE_KEYS[t]).map(t => `${TYPE_KEYS[t].toUpperCase()} ${typeNoun(t)}`).join(', ')
  announce(`New block: press a letter. ${list}. Escape cancels.`)
}

export function disarmTypeKeys() {
  if (!armed) return
  armed = false
  hideHint()
}

// ── Where it lands ───────────────────────────────────────────
function pointerWorld() {
  const vp = $.canvasViewport()
  const r = vp?.getBoundingClientRect()
  if (!pointer || !r || !(r.width && r.height)) return null
  if (pointer.x < r.left || pointer.x > r.right || pointer.y < r.top || pointer.y > r.bottom) return null
  return toWorld(pointer.x - r.left, pointer.y - r.top)
}

/** Add a block of type `t` at the pointer (over the canvas) or the centre, in title editing. */
export function createTypeAtPointer(t) {
  if (ui.readOnly || !Object.hasOwn(TYPES, t)) return null
  const w = pointerWorld() || centreWorld()
  // The block is where it was asked for; focusing its title must not pan.
  const id = withCameraHeld(() => createBlockAt(t, w.x, w.y))
  if (id) announce(`${TYPES[t].label} added. Type its title.`)
  return id
}

// ── Keys ─────────────────────────────────────────────────────
function onKeydown(e) {
  if (armed) {
    if (MODIFIERS.has(e.key)) return
    // The key after N is N's, whatever it is: nothing else may act on it.
    e.preventDefault()
    e.stopPropagation()
    // N held past the repeat delay is still the same N, not the letter after.
    if (e.repeat) return
    disarmTypeKeys()
    if (e.key === 'Escape') { announce('No block added'); return }
    const t = !e.metaKey && !e.ctrlKey && !e.altKey ? typeForKey(letterOf(e)) : null
    if (!t) { announce('No block type on that key. Nothing was added'); return }
    if (!ui.readOnly) createTypeAtPointer(t)
    return
  }
  if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
  if (letterOf(e) !== 'n' || !canAct()) return
  e.preventDefault()
  arm()
}

const onPointerMove = e => { pointer = { x: e.clientX, y: e.clientY } }
const onPointerLeave = () => { pointer = null }
const onFocusIn = () => { if (armed && (isTyping() || !canvasHasFocus())) disarmTypeKeys() }

/** Wire N-then-a-letter. Once only; returns the function that unwires it. */
let teardown = null
export function setupTypeKeys() {
  if (teardown) return teardown
  // Capture: the key after N must reach nothing else (classify.js's T,
  // events.js's L, H and Z).
  document.addEventListener('keydown', onKeydown, true)
  const vp = $.canvasViewport()
  vp?.addEventListener('pointermove', onPointerMove, { passive: true })
  vp?.addEventListener('pointerleave', onPointerLeave)
  // Anything else the person does lets go of N.
  document.addEventListener('pointerdown', disarmTypeKeys, true)
  window.addEventListener('blur', disarmTypeKeys)
  document.addEventListener('focusin', onFocusIn)
  teardown = () => {
    document.removeEventListener('keydown', onKeydown, true)
    vp?.removeEventListener('pointermove', onPointerMove)
    vp?.removeEventListener('pointerleave', onPointerLeave)
    document.removeEventListener('pointerdown', disarmTypeKeys, true)
    window.removeEventListener('blur', disarmTypeKeys)
    document.removeEventListener('focusin', onFocusIn)
    disarmTypeKeys()
    pointer = null
    teardown = null
  }
  return teardown
}
