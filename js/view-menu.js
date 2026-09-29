// ════════════════════════════════════════════════════════════
//  view-menu.js: the header's menus.
//
//  Maps, File, Share, the Tidy caret, View and Help are menu.js dropdowns,
//  so they share one keyboard model, one dismissal model and one
//  look. On phones, where the header kit moves them into its
//  overflow panel, the same items open in place inside that panel
//  instead of floating over it.
//
//  View holds every display preference, in two scopes that behave
//  differently and are labelled so: "This browser" is localStorage
//  and never leaves the machine; "This map" is canvasMeta, which
//  rides in share links and exports. Animate highlights is off by
//  default, and even when on only the card under the pointer (or
//  selected, or keyboard-focused) moves. The CSS half of that rule
//  lives with the gap and highlight styles in style.css.
// ════════════════════════════════════════════════════════════

import { state, ui, canvasMeta, snapshot, saveState, debouncedSave, snapTo } from './state.js'
import { $, CARD_STYLES, escHtml, showToast } from './utils.js'
import { renderAllBlocks, renderInspector } from './render.js'
import { renderArrows, renderFrames } from './canvas.js'
import { openDropdown, closeMenus } from './menu.js'
import { getPref, setPref } from './prefs.js'
import { isVotingMode, setVotingMode } from './voting.js'
import { chrome, toggleChrome, toggleZen } from './chrome.js'
import {
  applyTheme, setCanvasCardStyle, canvasCardStyle, refreshSpotlight,
  runTidy, getLayoutDir, setLayoutDir, openShortcuts,
} from './ui-panels.js'
import { mapsMenuItems } from './library.js'

const TINT_KEY = 'pathfinder-tint'

// An embedded canvas is someone else's page: it never writes the visitor's
// preferences (prefs.js applies the same rule to its own keys).
function persist(key, value) {
  if (ui.embed) return
  try { localStorage.setItem(key, value) } catch (_) {}
}

function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
}

// ── Preference setters (one per View row, exported for tests) ──

export function setLightMode(on) {
  ui.lightMode = !!on
  applyTheme()
  persist('pathfinder-theme', ui.lightMode ? 'light' : '')
}

/**
 * Snap to grid. Turning it on also moves every block onto the grid, so the
 * setting has a visible effect; that move is one undo step, and there is no
 * step at all when nothing had to move.
 */
export function setSnapToGrid(on) {
  if (ui.readOnly) return
  ui.snapToGrid = !!on
  document.body.classList.toggle('snap-grid', ui.snapToGrid)
  persist('pathfinder-snap', ui.snapToGrid ? '1' : '0')
  if (!ui.snapToGrid) { showToast('Grid snapping off', 'info', 1200); return }
  const off = Object.values(state.blocks).filter(b => b.x !== snapTo(b.x) || b.y !== snapTo(b.y))
  if (off.length) {
    snapshot()
    off.forEach(b => { b.x = snapTo(b.x); b.y = snapTo(b.y) })
    renderAllBlocks(); renderArrows(); renderFrames(); debouncedSave()
  }
  showToast(off.length ? 'Snapped all blocks to the grid' : 'Grid snapping on', 'success', 1500)
}

export function setPinPorts(on) {
  ui.pinPorts = !!on
  persist('pathfinder-pinports', ui.pinPorts ? '1' : '0')
}

export function setArrowText(on) {
  ui.showArrowText = !!on
  document.body.classList.toggle('show-arrow-text', ui.showArrowText)
  persist('pathfinder-arrowtext', ui.showArrowText ? '1' : '0')
}

/** Animate highlights and gap hints: prefs.js keeps body.motion-on in step. */
export function setMotion(on) { setPref('motion', !!on) }

// Session only, like the Alt+H key it mirrors.
export function setHighContrast(on) { document.body.classList.toggle('high-contrast', !!on) }

/** Spotlight rides on the map. It needs something highlighted to be useful. */
export function setSpotlight(on) {
  if (ui.readOnly) return false
  // A map setting, so one undo step (the step carries it: state.js undoEntry).
  if (!!canvasMeta.spotlight !== !!on) snapshot()
  canvasMeta.spotlight = !!on
  refreshSpotlight()
  saveState()
  renderInspector()
  return true
}

/**
 * The old tint toggle duplicated the Tinted card preset and is gone, with no
 * row of its own. A browser that still has it on keeps the look (app.js reads
 * the key at startup) until the next Card style pick, which is the control
 * that replaced it and so the natural moment to let the old setting go.
 */
export function hasLegacyTint() {
  try { return !!localStorage.getItem(TINT_KEY) } catch (_) { return !!ui.tintedBlocks }
}

export function clearLegacyTint() {
  ui.tintedBlocks = false
  document.body.classList.remove('tinted-blocks')
  try { localStorage.removeItem(TINT_KEY) } catch (_) {}
}

// After hiding the header, the button that opened the menu is gone with it.
function focusCanvas() { $.canvasViewport()?.focus({ preventScroll: true }) }

// ── Menu contents ────────────────────────────────────────────

const CARD_PREVIEW = k => `<span class="card-swatch card-swatch-${k}"></span>`

export function cardStyleItems() {
  const current = canvasCardStyle()
  return Object.entries(CARD_STYLES).map(([k, v]) => ({
    label: v.label, hint: v.hint, icon: CARD_PREVIEW(k),
    radio: true, checked: current === k,
    action: () => { if (setCanvasCardStyle(k) && hasLegacyTint()) clearLegacyTint() },
  }))
}

// A browser still on the retired tint toggle sees tinted cards whatever the
// preset says, so the hint names both until the next pick lets the tint go.
function cardStyleHint() {
  const label = CARD_STYLES[canvasCardStyle()]?.label
  return hasLegacyTint() ? `${label}, tinted (old setting)` : label
}

/**
 * The View menu, built from live state each time it opens so every check mark
 * is current. Read-only links get only what a reader can use: authoring
 * settings and the map-scoped section are left out.
 */
export function viewMenuItems() {
  const ro = ui.readOnly
  const motionOn = !!getPref('motion')
  const items = [
    { type: 'heading', label: 'This browser' },
    { label: 'Dark theme', radio: true, checked: !ui.lightMode, keepOpen: true, action: () => setLightMode(false) },
    { label: 'Light theme', radio: true, checked: ui.lightMode, keepOpen: true, action: () => setLightMode(true) },
    { type: 'divider' },
  ]
  if (!ro) items.push(
    { label: 'Snap to grid', checked: ui.snapToGrid, keepOpen: true, action: () => setSnapToGrid(!ui.snapToGrid) },
    { label: 'Pin connections to the port you drag from', checked: ui.pinPorts, keepOpen: true,
      hint: 'Off: connections pick the nearest side as blocks move',
      action: () => setPinPorts(!ui.pinPorts) },
  )
  items.push(
    { label: 'Always show connection notes', checked: ui.showArrowText, keepOpen: true,
      action: () => setArrowText(!ui.showArrowText) },
    { label: 'Animate highlights', checked: motionOn, keepOpen: true,
      hint: reducedMotion()
        ? 'Your system asks for reduced motion, so nothing moves'
        : 'Gap hints too, and only on the card you hover or select',
      action: () => setMotion(!getPref('motion')) },
    { label: 'High contrast', shortcut: 'Alt+H', checked: document.body.classList.contains('high-contrast'), keepOpen: true,
      action: () => setHighContrast(!document.body.classList.contains('high-contrast')) },
    { label: 'Hide header and footer', shortcut: 'H', checked: !chrome.frame,
      action: () => { toggleChrome(); if (!chrome.frame) focusCanvas() } },
    { label: 'Zen: hide panels', shortcut: 'Z', checked: !chrome.panels,
      action: () => { toggleZen(); if (!chrome.frame) focusCanvas() } },
  )
  if (!ro && !ui.embed) items.push(
    { label: 'Dot voting', hint: 'Click cards to add dots. This session only', checked: isVotingMode(),
      action: () => setVotingMode(!isVotingMode()) },
  )
  if (!ro) {
    const anyHighlight = Object.values(state.blocks).some(b => b.highlight)
    const spotDisabled = !anyHighlight && !canvasMeta.spotlight
    items.push(
      { type: 'heading', label: 'This map (travels with share links)' },
      { label: 'Card style', hint: cardStyleHint(), submenu: cardStyleItems },
      { label: 'Spotlight: fade unhighlighted', checked: !!canvasMeta.spotlight, keepOpen: true,
        disabled: spotDisabled, hint: spotDisabled ? 'Highlight a card first' : undefined,
        action: () => setSpotlight(!canvasMeta.spotlight) },
    )
  }
  return items
}

/**
 * A menu read from a row of hidden source buttons in index.html: their order
 * is the menu's order, a change of data-file-group (or data-menu-group) draws
 * a divider, and a view-only link keeps only rows marked data-readonly="ok".
 * Picking an entry clicks its row, so the listeners in ui-panels.js
 * (setupExportDropdown, setupShareDropdown) stay the one place each runs.
 */
function rowMenuItems(source, readOnly) {
  if (!source) return []
  const items = []
  let group = null
  for (const el of source.querySelectorAll(':scope > [data-file-group], :scope > [data-menu-group]')) {
    if (readOnly && el.dataset.readonly !== 'ok') continue
    const g = el.dataset.fileGroup || el.dataset.menuGroup
    if (group !== null && g !== group) items.push({ type: 'divider' })
    group = g
    items.push({
      label: el.textContent.trim().replace(/\s+/g, ' '),
      icon: el.querySelector('svg')?.outerHTML,
      danger: g === 'danger',
      rowId: el.id,
      action: () => el.click(),
    })
  }
  return items
}

/** File: import first, every export, then clearing the map (#fileActions). */
export function fileMenuItems(source = document.getElementById('fileActions'), { readOnly = ui.readOnly } = {}) {
  return rowMenuItems(source, readOnly)
}

/** Share: the three copy actions (#shareActions). Hidden on view-only links. */
export function shareMenuItems(source = document.getElementById('shareActions')) {
  return rowMenuItems(source, false)
}

export function tidyMenuItems() {
  const dir = getLayoutDir()
  const arrange = d => () => { setLayoutDir(d); runTidy() }
  return [
    { label: 'Arrange left to right', radio: true, checked: dir === 'LR', action: arrange('LR') },
    { label: 'Arrange top to bottom', radio: true, checked: dir === 'TB', action: arrange('TB') },
  ]
}

// Reading material opens beside the canvas, so the map stays where it was.
function openPage(href) { window.open(href, '_blank', 'noopener') }

export function helpMenuItems() {
  return [
    { label: 'Keyboard shortcuts', shortcut: '?', action: openShortcuts },
    { type: 'divider' },
    { label: 'Walkthrough', hint: 'A worked example, step by step', action: () => openPage('tutorial.html') },
    { label: 'Examples', hint: 'Finished maps to open and take apart', action: () => openPage('examples.html') },
    { label: 'Trace: diagrams as text', hint: 'Troubleshooting trees and architecture maps', action: () => openPage('trace.html') },
  ]
}

// ── Opening from the header ──────────────────────────────────

const overflowPanel = () => document.querySelector('.header-overflow-menu')

/**
 * On phones the header kit moves these buttons into its overflow panel. Once a
 * menu entry has run, close that panel too and leave focus on its toggle
 * rather than on a button that just disappeared.
 */
function leaveOverflow() {
  const toggle = document.querySelector('.header-overflow-toggle')
  const panel = overflowPanel()
  if (!toggle || !panel) return
  if (toggle.getAttribute('aria-expanded') === 'true') toggle.click()
  const a = document.activeElement
  if (!a || a === document.body || panel.contains(a)) toggle.focus()
}

// ── Phones: menus open in place inside the kit's overflow panel ──
//
// A floating menu over the panel covered most of a phone screen, so a tap
// meant for empty space landed on a row. In the panel the same items are
// rows under the button that opened them: the kit's arrow keys walk them
// with every other row, Escape folds the list back to its button, and a
// toggle keeps the list open with its mark updated.

const INLINE = 'hdr-inline-menu'
const INLINE_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'

/** Fold every in-panel list away (they are rebuilt on each open). */
export function closeInlineMenus() {
  document.querySelectorAll(`.${INLINE}:not(.hdr-inline-sub)`).forEach(list => {
    list._pfAnchor?.setAttribute('aria-expanded', 'false')
    list.remove()
  })
}

function inlineRow(item) {
  if (!item) return null
  if (item.type === 'divider') {
    const d = document.createElement('div')
    d.className = 'hdr-inline-divider'
    d.setAttribute('role', 'separator')
    return d
  }
  if (item.type === 'heading') {
    const h = document.createElement('div')
    h.className = 'hdr-inline-heading'
    h.textContent = item.label || ''
    return h
  }
  if (item.type) return null   // header menus use none of the other shapes
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'hdr-inline-item' + (item.danger ? ' hdr-inline-danger' : '')
  const checkable = item.checked !== undefined
  if (checkable) b.setAttribute('aria-pressed', item.checked ? 'true' : 'false')
  if (item.disabled) b.disabled = true
  if (item.submenu) b.setAttribute('aria-expanded', 'false')
  b.innerHTML =
    `<span class="hdr-inline-check" aria-hidden="true">${checkable && item.checked ? INLINE_CHECK : ''}</span>` +
    (item.icon ? `<span class="hdr-inline-icon" aria-hidden="true">${item.icon}</span>` : '') +
    `<span class="hdr-inline-text"><span class="hdr-inline-label">${escHtml(item.label || '')}</span>` +
    (item.hint ? `<span class="hdr-inline-hint">${escHtml(item.hint)}</span>` : '') + '</span>' +
    (item.submenu ? '<span class="hdr-inline-caret" aria-hidden="true">▾</span>' : '')
  b._pfItem = item
  return b
}

function fillInline(list, items) {
  list.replaceChildren(...(items || []).map(inlineRow).filter(Boolean))
}

function toggleInlineSub(row) {
  const next = row.nextElementSibling
  if (next?.classList.contains('hdr-inline-sub')) {
    next.remove()
    row.setAttribute('aria-expanded', 'false')
    return
  }
  const item = row._pfItem
  const sub = document.createElement('div')
  sub.className = `${INLINE} hdr-inline-sub`
  sub.setAttribute('role', 'group')
  sub.setAttribute('aria-label', item.label || '')
  fillInline(sub, typeof item.submenu === 'function' ? item.submenu() : item.submenu)
  row.after(sub)
  row.setAttribute('aria-expanded', 'true')
  sub.querySelector('.hdr-inline-item:not(:disabled)')?.focus()
}

function toggleInlineMenu(btn, getItems, label) {
  const open = btn.nextElementSibling
  if (open?.classList.contains(INLINE) && open._pfAnchor === btn) {
    closeInlineMenus()
    return null
  }
  // One open list in the panel at a time.
  closeMenus()
  closeInlineMenus()
  const list = document.createElement('div')
  list.className = INLINE
  list.setAttribute('role', 'group')
  list.setAttribute('aria-label', label)
  list.setAttribute('data-canvas-ui', '')
  list._pfAnchor = btn
  fillInline(list, getItems())

  list.addEventListener('click', e => {
    const row = e.target.closest('.hdr-inline-item')
    if (!row || !list.contains(row)) return
    // The kit closes its panel on any button click inside it. A toggle or a
    // submenu has to keep it open, and an action closes it itself below.
    e.stopPropagation()
    const item = row._pfItem
    if (!item || item.disabled) return
    if (item.submenu) { toggleInlineSub(row); return }
    if (item.keepOpen) {
      try { item.action?.() } catch (err) { console.error(err) }
      // Rebuilt from live state, so every mark is current; focus stays put.
      const at = [...list.querySelectorAll('.hdr-inline-item')].indexOf(row)
      fillInline(list, getItems())
      list.querySelectorAll('.hdr-inline-item')[at]?.focus()
      return
    }
    closeInlineMenus()
    try { item.action?.() } catch (err) { console.error(err) }
    leaveOverflow()
  })
  list.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return
    // One level at a time: the list folds, the panel stays.
    e.preventDefault(); e.stopPropagation()
    closeInlineMenus()
    btn.focus()
  })

  btn.after(list)
  btn.setAttribute('aria-expanded', 'true')
  list.querySelector('.hdr-inline-item:not(:disabled)')?.focus()
  return { el: list, close: closeInlineMenus }
}

/**
 * Open a header menu under its button (toggles like any dropdown). `items` is
 * a list or a function that builds one; in the overflow panel the list is
 * rebuilt after each toggle, so a function keeps every mark live.
 */
export function openHeaderMenu(btn, items, label) {
  const get = typeof items === 'function' ? items : () => items
  if (btn.closest('.header-overflow-menu')) return toggleInlineMenu(btn, get, label)
  return openDropdown(btn, get(), { label, className: 'pf-header-menu' })
}

export function openViewMenu(btn) { return openHeaderMenu(btn, viewMenuItems, 'View') }

function wire(id, itemsFn, label) {
  const btn = document.getElementById(id)
  if (!btn) return
  btn.setAttribute('aria-haspopup', 'menu')
  btn.setAttribute('aria-expanded', 'false')
  btn.addEventListener('click', e => {
    // In the kit's overflow panel a button click closes the panel, which would
    // take the list that is about to open in it along.
    if (btn.closest('.header-overflow-menu')) e.stopPropagation()
    openHeaderMenu(btn, itemsFn, label)
  })
}

let inlineWired = false
function wireInlineDismissal() {
  if (inlineWired) return
  inlineWired = true
  // A press outside the panel (the kit's toggle included) closes it or is
  // about to, and a list left behind would reopen stale. The resize comes
  // before the kit moves its rows back into the bar on a wider window.
  document.addEventListener('click', e => {
    if (!document.querySelector('.' + INLINE)) return
    if (!e.target.closest?.('.header-overflow-menu')) closeInlineMenus()
  }, true)
  window.addEventListener('resize', closeInlineMenus)
}

export function setupViewMenu() {
  wire('mapsBtn', mapsMenuItems, 'Maps')
  wire('exportBtn', () => fileMenuItems(), 'File')
  wire('shareBtn', () => shareMenuItems(), 'Share')
  wire('tidyMenuBtn', tidyMenuItems, 'Tidy direction')
  wire('viewBtn', viewMenuItems, 'View')
  wire('helpBtn', helpMenuItems, 'Help')
  wireInlineDismissal()
}
