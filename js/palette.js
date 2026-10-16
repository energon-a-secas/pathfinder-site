// ════════════════════════════════════════════════════════════
//  palette.js: the left palette and the empty canvas's six-step
//  starter. Both are rendered from the type registry, grouped by
//  the question each type answers (Why, Who, Proof, What, How,
//  Doubt). Click, Enter or drag a type onto the canvas.
//
//  The rail (the palette collapsed, or a window 1024px and under)
//  asks nobody to remember anything: each dot carries the letter
//  that follows N for its type, every dot and head is named on
//  hover and keyboard focus by one styled tip, and its two heads
//  (Templates, Blocks) open a flyout that lists the names over the
//  canvas, so the canvas never moves (Right opens one, Left closes
//  it, a second press on its head too). Up and Down move along the
//  palette's controls. On a phone the palette is one Add control
//  in the status bar, which opens the same list of types, and a
//  submenu there replaces the list in place.
// ════════════════════════════════════════════════════════════

import { state, ui, toWorld, canvasMeta } from './state.js'
import { $, TYPES, typesByStep, escHtml } from './utils.js'
import { createBlockAt } from './create.js'
import { openMenu, closeMenus, isMenuOpen } from './menu.js'
import { typeRow, typeNoteItem } from './type-menu.js'
import { TYPE_KEYS } from './ui-panels.js'
import { listUserTemplates } from './templates.js'
import { templateMenuItems, applyTemplateFromPalette } from './start-panel.js'

/** The letter that follows N for a type, upper case, or ''. */
export const chordKey = t => (TYPE_KEYS[t] || '').toUpperCase()

/** A type row's description: what it is for, then its keys in words. */
export function typeKeysLine(t) {
  const cfg = TYPES[t]; if (!cfg) return ''
  const key = chordKey(t)
  return cfg.short + (key ? `. Keys: N, then ${key}` : '')
}

// ── Rendering ────────────────────────────────────────────────
function itemHtml(t) {
  const cfg = TYPES[t]
  const label = escHtml(cfg.label)
  const key = chordKey(t)
  // The letter is drawn for the eye; the row's description says the same
  // keys in words (aria-keyshortcuts lists alternatives, not a sequence, so
  // "N K" there would claim N alone or K alone adds the block).
  return `<button type="button" class="palette-item" data-type="${t}" data-tier="${cfg.tier}"` +
    ` aria-label="Add ${label} block" aria-describedby="pdesc-${t}">` +
    `<span class="palette-dot" data-shape="${cfg.shape || 'dot'}" style="background:var(--c-${t})" aria-hidden="true"></span>` +
    `<span class="palette-item-text"><span class="palette-label">${label}</span></span>` +
    (key ? `<span class="palette-key" aria-hidden="true">${key}</span>` : '') +
    `<span class="sr-only" id="pdesc-${t}">${escHtml(typeKeysLine(t))}</span>` +
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
 * Add a block of `type` at the middle of the visible canvas, in title edit.
 * A card already there pushes it to the nearest free slot (createBlockAt),
 * so a second click lands beside the first instead of on top of it.
 */
export function addTypeAtCenter(type) {
  if (ui.readOnly || !Object.hasOwn(TYPES, type)) return null
  const r = $.canvasViewport().getBoundingClientRect()
  const w = toWorld(r.width / 2, r.height / 2)
  return createBlockAt(type, w.x, w.y)
}

// ── Where the palette is a rail ──────────────────────────────
const RAIL_QUERY = '(min-width: 769px) and (max-width: 1024px)'
const PHONE_QUERY = '(max-width: 768px)'
// The window the palette is drawn in (a test lays one out in a frame).
const matches = (q, win = window) => typeof win?.matchMedia === 'function' && win.matchMedia(q).matches
const winOf = el => el?.ownerDocument?.defaultView || window

/** Whether the palette shows as its 48px rail: collapsed, or a narrow window. */
export function isRail(palette = document.getElementById('palette')) {
  if (!palette) return false
  const win = winOf(palette)
  if (matches(PHONE_QUERY, win)) return false
  return palette.classList.contains('collapsed') || matches(RAIL_QUERY, win)
}

/**
 * The rail always shows its dots. Folding Blocks is a choice made in the
 * whole palette, where its toggle is; the rail has no toggle, so a folded
 * Blocks left it with no dots and no way to bring them back. The section's
 * own state (the class, the stored choice) is left as it is: out of the
 * rail, the fold returns. ui-panels.js setPaletteSection makes a folded
 * body inert; this lifts that while the palette is a rail. The stylesheet
 * does the same for its height ([recognition]).
 */
export function syncRailSections(palette = document.getElementById('palette')) {
  const section = palette?.querySelector('#blocksSection')
  const body = section?.querySelector(':scope > .palette-section-body')
  if (!body) return
  const phone = matches(PHONE_QUERY, winOf(palette))
  const want = section.classList.contains('collapsed') && !phone && !isRail(palette)
  // Only on a change: a write records a mutation, and the observer below
  // would answer it again.
  if (body.inert !== want) body.inert = want
}

// ── Hover and focus tip ──────────────────────────────────────
// One floating tip for the whole palette, fixed to the page. The palette
// scrolls, so a tip positioned inside it was clipped to nothing; this one
// also names the type when the palette is collapsed to its dots, and the
// rail's heads, which show an icon or one word.
let tipEl = null
let tipItem = null   // the row the tip is showing for

function hideTip() { if (tipEl) tipEl.hidden = true; tipItem = null }

const capsHtml = keys => `<span class="palette-tip-keys">${keys.map(k => `<kbd class="typekeys-key">${escHtml(k)}</kbd>`).join('')}</span>`

/** The tip's markup for a type row: its name and keys, what it is for, an example. */
export function typeTipHtml(t) {
  const cfg = TYPES[t]; if (!cfg) return ''
  const key = chordKey(t)
  // Several tips open with the short line itself; saying it twice in a row
  // reads as a stutter, so it only gets its own line when the tip does not.
  const repeats = String(cfg.tip || '').toLowerCase().startsWith(String(cfg.short || '').toLowerCase())
  return `<span class="palette-tip-head"><strong class="palette-tip-title">${escHtml(cfg.label)}</strong>` +
    (key ? capsHtml(['N', key]) : '') + '</span>' +
    (repeats ? '' : `<span class="palette-tip-short">${escHtml(cfg.short)}</span>`) +
    `<span class="palette-tip-body">${escHtml(cfg.tip)}</span>` +
    (cfg.example ? `<span class="palette-tip-example">e.g. ${escHtml(cfg.example)}</span>` : '')
}

/** The tip's markup for a rail head or a named control: [data-tip], and [data-tip-sub] under it. */
function plainTipHtml(el) {
  return `<span class="palette-tip-head"><strong class="palette-tip-title">${escHtml(el.dataset.tip)}</strong></span>` +
    (el.dataset.tipSub ? `<span class="palette-tip-body">${escHtml(el.dataset.tipSub)}</span>` : '')
}

const tipTarget = node => node?.closest?.('.palette-item, .palette [data-tip]')

function showTip(item) {
  const html = item?.classList.contains('palette-item') ? typeTipHtml(item.dataset.type) : item?.dataset.tip ? plainTipHtml(item) : ''
  if (!html) return
  if (!tipEl) {
    tipEl = document.createElement('div')
    tipEl.className = 'palette-tip'
    // Screen readers get the same text from the row's own name and description.
    tipEl.setAttribute('aria-hidden', 'true')
    document.body.appendChild(tipEl)
  }
  tipEl.innerHTML = html
  tipEl.hidden = false
  tipItem = item
  const pr = document.getElementById('palette')?.getBoundingClientRect() || item.getBoundingClientRect()
  const ir = item.getBoundingClientRect()
  const { width: tw, height: th } = tipEl.getBoundingClientRect()
  const pad = 8
  let left, top
  if (pr.width > pr.height) {
    // A strip (a short window laid out in a row): tip below the row.
    left = ir.left; top = pr.bottom + pad
  } else {
    left = pr.right + pad; top = ir.top + ir.height / 2 - th / 2
  }
  left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad))
  top = Math.max(pad, Math.min(top, window.innerHeight - th - pad))
  tipEl.style.left = left + 'px'
  tipEl.style.top = top + 'px'
}

// ── The flyouts: names over the canvas ───────────────────────

/**
 * Every type as a menu row, by step: its dot in its shape, its name and,
 * where a keyboard is the way in, the keys that add it (N then a letter).
 * A pick adds the type at the middle of the view, as a palette click does.
 */
export function typeListItems({ keys = true, note = true, onPick = addTypeAtCenter, footer = [] } = {}) {
  const items = []
  typesByStep().forEach(g => {
    if (!g.types.length) return
    items.push({ type: 'heading', label: g.label })
    g.types.forEach(t => items.push(typeRow(t, {
      ...(keys && chordKey(t) ? { shortcut: `N ${chordKey(t)}` } : {}),
      action: () => onPick(t),
    })))
  })
  // One line at the foot says what the row under the pointer is for (a
  // touch screen has no pointer to follow, so it goes without).
  if (note) items.push(typeNoteItem())
  return [...items, ...footer]
}

/**
 * The templates as menu rows: the start panel's list (worked maps, then the
 * smaller starters) and the ones saved in this browser, each by name, then
 * saving this map as one and deleting a saved one. Each row clicks the whole
 * palette's own control (which stays in the page when the rail hides it),
 * so it takes that control's path: one undo step for a template, the same
 * toasts. The command palette has the same rows (command-items.js).
 */
export function templateListItems() {
  const items = templateMenuItems(applyTemplateFromPalette)
  const list = () => $.templatesList()
  const saved = listUserTemplates()
  if (saved.length) {
    items.push({ type: 'divider' }, { type: 'heading', label: 'Saved in this browser' })
    saved.forEach(tpl => items.push({
      label: tpl.name, hint: `${(tpl.blocks || []).length} blocks`,
      action: () => list()?.querySelector(`[data-utpl="${CSS.escape(String(tpl.id))}"]`)?.click(),
    }))
  }
  items.push({ type: 'divider' }, templateSaveItem())
  if (saved.length) {
    items.push({ label: 'Delete a saved template', submenu: saved.map(tpl => ({
      label: tpl.name, danger: true,
      action: () => list()?.querySelector(`[data-utpl-del="${CSS.escape(String(tpl.id))}"]`)?.click(),
    })) })
  }
  return items
}

/**
 * The row that keeps the open map as a template, in the rail's menu and in
 * Cmd+K: it clicks the whole palette's Save canvas as template, so the name
 * it is saved under and the toast are that button's. An empty map has
 * nothing to keep.
 */
export function templateSaveItem() {
  const empty = !Object.keys(state.blocks).length
  return {
    label: 'Save this map as a template',
    hint: empty ? 'Add blocks first' : 'Keep it in Templates as a starting point',
    disabled: empty,
    action: () => $.templatesList()?.querySelector('#saveTemplateBtn')?.click(),
  }
}

const PAD = 8
/** Put a menu at (left, top), inside the window, scrolling inside when taller than it. */
function placeMenuAt(el, left, top) {
  const win = el.ownerDocument.defaultView || window
  el.style.maxHeight = Math.max(120, win.innerHeight - PAD * 2) + 'px'
  const { width: w, height: h } = el.getBoundingClientRect()
  el.style.left = Math.max(PAD, Math.min(left, win.innerWidth - PAD - w)) + 'px'
  el.style.top = Math.max(PAD, Math.min(top, win.innerHeight - PAD - h)) + 'px'
}

/**
 * Open a rail head's flyout beside the rail: a menu.js menu, so the keys,
 * the dismissal and the look are every other menu's. It floats over the
 * canvas, which stays where it was. The head is the menu's anchor, so a
 * press on it is left to its own click, which closes it (without the
 * anchor, the press closed the menu and the click opened it again). Left,
 * the way back toward the rail, closes it too.
 */
let flyoutHead = null
export function openRailFlyout(head) {
  if (!head || ui.readOnly) return null
  if (flyoutHead === head && isMenuOpen()) { closeMenus({ restoreFocus: true }); return null }
  const palette = document.getElementById('palette')
  const pr = (palette && palette.getClientRects().length ? palette : head).getBoundingClientRect()
  const hr = head.getBoundingClientRect()
  const kind = head.dataset.flyout
  const items = kind === 'templates' ? templateListItems() : typeListItems()
  head.setAttribute('aria-expanded', 'true')
  flyoutHead = head
  const m = openMenu(items, {
    anchor: head,
    className: 'palette-flyout' + (kind === 'templates' ? ' start-template-menu' : ''),
    label: kind === 'templates' ? 'Templates' : 'Block types',
    returnFocus: head,
    onClose: () => { head.setAttribute('aria-expanded', 'false'); if (flyoutHead === head) flyoutHead = null },
  })
  if (m?.el) {
    // Beside the rail, level with its head (menu.js would put it under).
    placeMenuAt(m.el, Math.max(pr.right, hr.right) + 4, hr.top)
    m.el.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (e.target.closest?.('.pf-menu-search-input, .pf-menu-custom')) return
      e.preventDefault()
      closeMenus({ restoreFocus: true })
    })
  }
  return m
}

// ── The phone's Add control ──────────────────────────────────
/**
 * On a phone the palette is one control in the status bar. It opens the
 * same list of types (no keys: a phone has none to press), then the
 * templates, which the strip never reached.
 */
export function openPhoneAdd(btn = document.getElementById('paletteAddBtn')) {
  if (!btn || ui.readOnly) return null
  if (btn.getAttribute('aria-expanded') === 'true' && isMenuOpen()) { closeMenus({ restoreFocus: true }); return null }
  const templates = { label: 'From a template', submenu: templateListItems() }
  return openAbove(btn, typeListItems({ keys: false, note: false, footer: [{ type: 'divider' }, templates] }), 'Add a block')
}

/**
 * A phone has no room for a submenu beside its menu: a row that would open
 * one replaces the list in place with its rows, under the row's name.
 */
function inPlace(btn, items) {
  return items.map(it => it?.submenu
    ? { ...it, submenu: undefined, action: () => openAbove(btn, it.submenu, it.label) }
    : it)
}

/** A menu standing on `btn`, which sits at the foot of the screen; it scrolls rather than cover it. */
function openAbove(btn, items, label) {
  btn.setAttribute('aria-expanded', 'true')
  const r = btn.getBoundingClientRect()
  // The button is the anchor: a second press on it closes the list.
  const m = openMenu(inPlace(btn, items), {
    anchor: btn, placement: 'top-start', className: 'palette-add-menu', label,
    returnFocus: btn, onClose: () => btn.setAttribute('aria-expanded', 'false'),
  })
  if (m?.el) {
    m.el.style.maxHeight = 'none'
    const room = Math.max(120, r.top - 12)
    const h = m.el.getBoundingClientRect().height
    m.el.style.maxHeight = Math.min(h, room) + 'px'
    m.el.style.left = Math.max(PAD, Math.min(r.left, window.innerWidth - PAD - m.el.getBoundingClientRect().width)) + 'px'
    m.el.style.top = Math.max(PAD, r.top - 4 - Math.min(h, room)) + 'px'
  }
  return m
}

// ── The map's name, on a phone ───────────────────────────────
// The header has no room for the open map's name on a phone (it hides under
// 433px), so the top of the canvas carries it: the header title's own text,
// kept in step by watching it, so a rename anywhere shows here too.
export function syncMapName(label = document.getElementById('canvasMapName')) {
  if (!label) return
  const title = document.getElementById('canvasTitle')
  const text = (title?.classList.contains('is-untitled') ? '' : title?.textContent) || canvasMeta.title || ''
  label.textContent = text.trim() || 'Untitled map'
  label.classList.toggle('is-untitled', !text.trim())
}

// ── Keys: Up and Down along the palette ──────────────────────
const isShown = el => !!el && el.getClientRects().length > 0 && !el.closest('[hidden], [inert]')

/** The palette's controls a key can reach, in reading order. */
export function paletteStops(palette = document.getElementById('palette')) {
  if (!palette) return []
  return [...palette.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && isShown(el))
}

/**
 * Up, Down, Home and End move along the palette's controls (Right opens a
 * rail head's flyout). True when the key was the palette's.
 */
export function onPaletteArrow(e, palette = document.getElementById('palette')) {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false
  const keys = { ArrowDown: 1, ArrowUp: -1, Home: 'first', End: 'last' }
  // A rail head's flyout opens to the right, so Right opens it too.
  if (e.key === 'ArrowRight') {
    const head = e.target.closest('.palette-rail-head')
    if (head && isShown(head)) { e.preventDefault(); openRailFlyout(head); return true }
    return false
  }
  if (!(e.key in keys)) return false
  const stops = paletteStops(palette)
  const at = stops.indexOf(e.target.closest('button, [href], [tabindex]'))
  if (at < 0 || !stops.length) return false
  const k = keys[e.key]
  const next = k === 'first' ? 0 : k === 'last' ? stops.length - 1 : Math.max(0, Math.min(stops.length - 1, at + k))
  e.preventDefault()
  stops[next].focus()
  return true
}

// ── Palette ──────────────────────────────────────────────────
// Wired once per element: a second set of listeners would open a flyout and
// close it again on the same click, or add every block twice.
const wired = new WeakSet(), paletteWired = new WeakSet()

/**
 * Wire the rail's heads (in `palette`) and the phone's Add control
 * (`addBtn`, in the status bar), each once. Exported for the tests, which
 * press them.
 */
export function wireRailControls(palette, addBtn) {
  if (palette && !wired.has(palette)) {
    wired.add(palette)
    palette.querySelectorAll('.palette-rail-head').forEach(head => {
      head.addEventListener('click', () => { hideTip(); openRailFlyout(head) })
    })
    // The rail shows its dots whatever Blocks was folded to (syncRailSections):
    // the palette's class, the section's fold, its body's inert and the width.
    const sync = () => syncRailSections(palette)
    if (typeof MutationObserver === 'function') {
      const watch = new MutationObserver(sync)
      watch.observe(palette, { attributes: true, attributeFilter: ['class'] })
      const section = palette.querySelector('#blocksSection')
      if (section) {
        watch.observe(section, { attributes: true, attributeFilter: ['class'] })
        const body = section.querySelector(':scope > .palette-section-body')
        if (body) watch.observe(body, { attributes: true, attributeFilter: ['inert'] })
      }
    }
    const win = winOf(palette)
    for (const q of [RAIL_QUERY, PHONE_QUERY]) win.matchMedia?.(q).addEventListener?.('change', sync)
    sync()
  }
  if (addBtn && !wired.has(addBtn)) {
    wired.add(addBtn)
    addBtn.addEventListener('click', e => openPhoneAdd(e.currentTarget))
  }
}

export function setupPalette(palette = document.getElementById('palette')) {
  renderPaletteTypes()
  syncMapName()
  wireRailControls(palette, document.getElementById('paletteAddBtn'))
  if (!palette || paletteWired.has(palette)) return
  paletteWired.add(palette)

  // The map's name at the top of the canvas follows the header's title.
  const title = document.getElementById('canvasTitle')
  if (title && typeof MutationObserver === 'function') {
    new MutationObserver(() => syncMapName()).observe(title, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  }

  let lastDragTime = 0
  palette.addEventListener('click',   e => {
    if (Date.now() - lastDragTime < 300) return // skip click after drag
    const i = e.target.closest('.palette-item'); if (i) addTypeAtCenter(i.dataset.type)
  })
  // The rows are buttons, so Enter and Space would click them anyway; taking
  // the key here (and preventing the button's own click) adds exactly one.
  palette.addEventListener('keydown', e => {
    if (onPaletteArrow(e, palette)) return
    if (e.key !== 'Enter' && e.key !== ' ') return
    const i = e.target.closest('.palette-item'); if (!i) return
    e.preventDefault(); hideTip(); addTypeAtCenter(i.dataset.type)
  })

  // Tip on mouse hover and on keyboard focus; never on touch, which has no hover.
  palette.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return
    const i = tipTarget(e.target); if (i) showTip(i)
  })
  palette.addEventListener('pointerout', e => {
    const i = tipTarget(e.target)
    if (i && !i.contains(e.relatedTarget)) hideTip()
  })
  palette.addEventListener('focusin', e => {
    const i = tipTarget(e.target)
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
