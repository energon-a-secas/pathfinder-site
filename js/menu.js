// ════════════════════════════════════════════════════════════
//  menu.js: the one menu component. Context menus, header
//  dropdowns and inspector pickers are all built from it, so
//  keyboard support, dismissal and styling cannot drift.
//
//  openMenu(items, { x, y, anchor, placement, className, label,
//                    onClose, returnFocus }) -> { el, close }
//  openDropdown(anchorEl, items, opts)  toggles for that anchor
//  closeMenus(), isMenuOpen()
//
//  Item shapes:
//   { label, icon?, dot?, hint?, shortcut?, checked?, radio?,
//     disabled?, danger?, keepOpen?, action?, submenu? }
//   { type: 'divider' } | { type: 'heading', label }
//   { type: 'swatches', options: [{ value, color, label, active,
//     className? }], onPick }
//   { type: 'search', placeholder, filter: true }
//   { type: 'custom', render: containerEl => void }
// ════════════════════════════════════════════════════════════

import { escHtml } from './utils.js'

const HOVER_DELAY = 120
const PAD = 8

const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
const CARET_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'

// The open stack: index 0 is the root menu, each later entry a submenu of
// the one before it. `parentItem` is the row that opened it.
let stack = []
let root = null   // { el, anchor, onClose, returnFocus, api }
let hoverTimer = null
let globalWired = false

export function isMenuOpen() { return !!root }

/** Close every open menu. Focus goes back only when asked (keyboard exits). */
export function closeMenus({ restoreFocus = false } = {}) {
  clearTimeout(hoverTimer)
  if (!root) return
  const r = root
  root = null
  stack.forEach(m => m.el.remove())
  stack = []
  // preventScroll: the element a menu hands focus back to may be a card
  // partly off screen, and the canvas pans by transform, so a scroll there
  // would put everything drawn out of step with the pointer.
  if (restoreFocus) {
    const target = r.returnFocus
    if (target && target.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true })
  }
  try { r.onClose?.() } catch (err) { console.error(err) }
}

export function openMenu(items, opts = {}) {
  const { x = 0, y = 0, anchor = null, placement = 'bottom-start', className = '', label, onClose } = opts
  closeMenus()
  wireGlobal()
  const returnFocus = opts.returnFocus || document.activeElement
  const el = buildMenu(items, { className, label, level: 0 })
  document.body.appendChild(el)
  root = { el, anchor, onClose, returnFocus }
  stack = [{ el, items, parentItem: null }]
  if (anchor) placeAtAnchor(el, anchor, placement)
  else placeAtPoint(el, x, y)
  focusInitial(el)
  const api = { el, close: () => { if (root && root.el === el) closeMenus({ restoreFocus: true }) } }
  root.api = api
  return api
}

/**
 * A menu anchored under a button (flipping up when there is no room below).
 * A second call for the same anchor closes it, like any dropdown button.
 */
export function openDropdown(anchorEl, items, opts = {}) {
  if (root && root.anchor === anchorEl) { closeMenus({ restoreFocus: true }); return null }
  const userClose = opts.onClose
  anchorEl.setAttribute('aria-haspopup', 'menu')
  anchorEl.setAttribute('aria-expanded', 'true')
  return openMenu(items, {
    placement: 'bottom-start', returnFocus: anchorEl, ...opts, anchor: anchorEl,
    onClose: () => { anchorEl.setAttribute('aria-expanded', 'false'); userClose?.() },
  })
}

// ── Building ────────────────────────────────────────────────
function buildMenu(items, { className = '', label, level }) {
  const el = document.createElement('div')
  el.className = 'pf-menu' + (level ? ' pf-submenu' : '') + (className ? ' ' + className : '')
  el.setAttribute('role', 'menu')
  el.setAttribute('data-canvas-ui', '')
  el.tabIndex = -1
  // Inline because placement depends on it, stylesheet or not.
  el.style.position = 'fixed'
  if (label) el.setAttribute('aria-label', label)
  el.dataset.level = String(level)
  const list = typeof items === 'function' ? items() : items
  ;(list || []).forEach(item => { const row = buildItem(item, level); if (row) el.appendChild(row) })
  el.addEventListener('keydown', onKeydown)
  el.addEventListener('mouseover', onHover)
  el.addEventListener('click', onClick)
  // Keep a press inside a menu from reaching the canvas under it.
  el.addEventListener('pointerdown', e => e.stopPropagation())
  el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation() })
  return el
}

function buildItem(item, level) {
  if (!item) return null
  const type = item.type || 'item'
  if (type === 'divider') {
    const d = document.createElement('div')
    d.className = 'pf-menu-divider'
    d.setAttribute('role', 'separator')
    return d
  }
  if (type === 'heading') {
    const h = document.createElement('div')
    h.className = 'pf-menu-heading'
    h.setAttribute('role', 'presentation')
    h.textContent = item.label || ''
    return h
  }
  if (type === 'swatches') {
    const row = document.createElement('div')
    row.className = 'pf-menu-swatches'
    row.setAttribute('role', 'group')
    if (item.label) row.setAttribute('aria-label', item.label)
    ;(item.options || []).forEach(opt => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'pf-menu-swatch' + (opt.active ? ' active' : '') + (opt.className ? ' ' + opt.className : '')
      b.setAttribute('role', 'menuitemradio')
      b.setAttribute('aria-checked', opt.active ? 'true' : 'false')
      b.setAttribute('aria-label', opt.label || String(opt.value))
      b.title = opt.label || String(opt.value)
      b.tabIndex = -1
      if (opt.color) b.style.setProperty('--sw', opt.color)
      b._pfSwatch = { item, opt }
      row.appendChild(b)
    })
    return row
  }
  if (type === 'search') {
    const wrap = document.createElement('div')
    wrap.className = 'pf-menu-search'
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'pf-menu-search-input'
    input.placeholder = item.placeholder || 'Filter'
    input.setAttribute('aria-label', item.label || item.placeholder || 'Filter')
    input.autocomplete = 'off'
    input.spellcheck = false
    input._pfSearch = item
    input.addEventListener('input', () => filterAfter(input))
    wrap.appendChild(input)
    return wrap
  }
  if (type === 'custom') {
    const c = document.createElement('div')
    c.className = 'pf-menu-custom'
    try { item.render?.(c) } catch (err) { console.error(err) }
    return c
  }

  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'pf-menu-item' + (item.danger ? ' pf-menu-danger' : '')
  const checkable = item.checked !== undefined
  b.setAttribute('role', checkable ? (item.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem')
  if (checkable) b.setAttribute('aria-checked', item.checked ? 'true' : 'false')
  if (item.disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true') }
  if (item.submenu) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false') }
  b.tabIndex = -1
  const lead = item.icon
    ? `<span class="pf-menu-icon" aria-hidden="true">${item.icon}</span>`
    : item.dot ? `<span class="pf-menu-dot" aria-hidden="true" style="background:${escHtml(item.dot)}"></span>` : ''
  b.innerHTML =
    `<span class="pf-menu-check" aria-hidden="true">${checkable && item.checked ? CHECK_SVG : ''}</span>` +
    lead +
    `<span class="pf-menu-text"><span class="pf-menu-label">${escHtml(item.label || '')}</span>` +
    (item.hint ? `<span class="pf-menu-hint">${escHtml(item.hint)}</span>` : '') + '</span>' +
    (item.shortcut ? `<kbd class="pf-menu-shortcut">${escHtml(item.shortcut)}</kbd>` : '') +
    (item.submenu ? `<span class="pf-menu-caret" aria-hidden="true">${CARET_SVG}</span>` : '')
  if (item.hint) b.title = item.hint
  b._pfItem = item
  b._pfLevel = level
  return b
}

// ── Positioning ─────────────────────────────────────────────
function fitHeight(el) {
  el.style.maxHeight = Math.max(120, window.innerHeight - PAD * 2) + 'px'
}

function clampLeft(left, w) {
  return Math.max(PAD, Math.min(left, window.innerWidth - PAD - w))
}

function placeAtPoint(el, x, y) {
  el.style.left = '0px'; el.style.top = '0px'
  fitHeight(el)
  const { width: w, height: h } = el.getBoundingClientRect()
  let left = x, top = y
  if (left + w > window.innerWidth - PAD) left = x - w
  if (top + h > window.innerHeight - PAD) top = Math.max(PAD, window.innerHeight - PAD - h)
  el.style.left = clampLeft(left, w) + 'px'
  el.style.top = Math.max(PAD, top) + 'px'
}

function placeAtAnchor(el, anchor, placement) {
  el.style.left = '0px'; el.style.top = '0px'
  fitHeight(el)
  const a = anchor.getBoundingClientRect()
  const { width: w, height: h } = el.getBoundingClientRect()
  const wantUp = placement.startsWith('top')
  const below = a.bottom + 4, above = a.top - 4 - h
  let top
  if (wantUp) top = above >= PAD ? above : below
  else top = below + h <= window.innerHeight - PAD || above < PAD ? below : above
  if (top + h > window.innerHeight - PAD) top = Math.max(PAD, window.innerHeight - PAD - h)
  const left = placement.endsWith('end') ? a.right - w : a.left
  el.style.left = clampLeft(left, w) + 'px'
  el.style.top = Math.max(PAD, top) + 'px'
}

function placeSubmenu(el, itemEl, parentEl) {
  el.style.left = '0px'; el.style.top = '0px'
  fitHeight(el)
  const r = itemEl.getBoundingClientRect(), p = parentEl.getBoundingClientRect()
  const { width: w, height: h } = el.getBoundingClientRect()
  let left = p.right + 2
  if (left + w > window.innerWidth - PAD) left = p.left - w - 2
  let top = r.top - 5
  if (top + h > window.innerHeight - PAD) top = window.innerHeight - PAD - h
  el.style.left = clampLeft(left, w) + 'px'
  el.style.top = Math.max(PAD, top) + 'px'
}

// ── Focus helpers ───────────────────────────────────────────
function isShown(node) { return !node.hidden && !node.closest('[hidden]') }

// The keyboard stops of one menu: every enabled row, plus one stop per
// swatch row (arrow left/right moves inside the row).
function stops(menuEl) {
  const out = []
  for (const child of menuEl.children) {
    if (!isShown(child)) continue
    if (child.classList.contains('pf-menu-item') && !child.disabled) out.push(child)
    else if (child.classList.contains('pf-menu-swatches')) {
      const sw = child.querySelector('.pf-menu-swatch.active') || child.querySelector('.pf-menu-swatch')
      if (sw) out.push(sw)
    } else if (child.classList.contains('pf-menu-search')) out.push(child.querySelector('input'))
  }
  return out
}

function focusInitial(menuEl) {
  const search = menuEl.querySelector('.pf-menu-search-input')
  if (search) { search.focus(); return }
  const first = stops(menuEl)[0]
  ;(first || menuEl).focus()
}

function stopIndexOf(list, node) {
  const row = node?.closest?.('.pf-menu-swatches')
  if (row) return list.findIndex(s => s.closest('.pf-menu-swatches') === row)
  return list.indexOf(node)
}

function menuLevel(menuEl) { return +(menuEl?.dataset.level || 0) }

// ── Submenus ────────────────────────────────────────────────
function closeFrom(level) {
  while (stack.length > level) {
    const m = stack.pop()
    m.el.remove()
    m.parentItem?.setAttribute('aria-expanded', 'false')
    m.parentItem?.classList.remove('pf-open')
  }
}

function openSubmenu(itemEl, { focus = false } = {}) {
  const item = itemEl._pfItem
  if (!item?.submenu || itemEl.disabled) return
  const level = itemEl._pfLevel + 1
  const existing = stack[level]
  if (existing && existing.parentItem === itemEl) {
    if (focus) focusInitial(existing.el)
    return
  }
  closeFrom(level)
  const items = typeof item.submenu === 'function' ? item.submenu() : item.submenu
  const el = buildMenu(items, { label: item.label, level })
  document.body.appendChild(el)
  stack.push({ el, items, parentItem: itemEl })
  itemEl.setAttribute('aria-expanded', 'true')
  itemEl.classList.add('pf-open')
  placeSubmenu(el, itemEl, itemEl.closest('.pf-menu'))
  if (focus) focusInitial(el)
}

// ── Activation ──────────────────────────────────────────────
function activateItem(itemEl, { viaKeyboard = false } = {}) {
  const item = itemEl._pfItem
  if (!item || item.disabled) return
  if (item.submenu) { openSubmenu(itemEl, { focus: true }); return }
  if (item.keepOpen) {
    if (item.checked !== undefined) {
      if (item.radio) {
        itemEl.parentElement.querySelectorAll('[role=menuitemradio]').forEach(b => {
          if (b._pfItem) { b._pfItem.checked = false; b.setAttribute('aria-checked', 'false'); b.querySelector('.pf-menu-check').innerHTML = '' }
        })
        item.checked = true
      } else item.checked = !item.checked
      itemEl.setAttribute('aria-checked', item.checked ? 'true' : 'false')
      itemEl.querySelector('.pf-menu-check').innerHTML = item.checked ? CHECK_SVG : ''
    }
    try { item.action?.() } catch (err) { console.error(err) }
    return
  }
  // Close first, then act: an action that moves focus (inline editing, a
  // dialog) must win over the menu handing focus back.
  closeMenus({ restoreFocus: true })
  try { item.action?.() } catch (err) { console.error(err) }
  void viaKeyboard
}

function pickSwatch(btn) {
  const { item, opt } = btn._pfSwatch
  if (item.keepOpen) {
    btn.parentElement.querySelectorAll('.pf-menu-swatch').forEach(s => {
      s.classList.toggle('active', s === btn); s.setAttribute('aria-checked', s === btn ? 'true' : 'false')
    })
  } else closeMenus({ restoreFocus: true })
  try { item.onPick?.(opt.value) } catch (err) { console.error(err) }
}

function onClick(e) {
  const sw = e.target.closest('.pf-menu-swatch')
  if (sw) { e.stopPropagation(); pickSwatch(sw); return }
  const itemEl = e.target.closest('.pf-menu-item')
  if (!itemEl) return
  e.stopPropagation()
  activateItem(itemEl)
}

function onHover(e) {
  const itemEl = e.target.closest('.pf-menu-item')
  if (!itemEl) return
  const menuEl = itemEl.closest('.pf-menu')
  clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => {
    if (!root || !menuEl.isConnected) return
    if (itemEl._pfItem?.submenu && !itemEl.disabled) openSubmenu(itemEl)
    else closeFrom(menuLevel(menuEl) + 1)
  }, HOVER_DELAY)
}

// ── Search filter ───────────────────────────────────────────
function filterAfter(input) {
  const q = input.value.trim().toLowerCase()
  const menuEl = input.closest('.pf-menu')
  const wrap = input.closest('.pf-menu-search')
  let after = false, visibleInGroup = 0
  const pending = []
  for (const child of menuEl.children) {
    if (child === wrap) { after = true; continue }
    if (!after) continue
    if (child.classList.contains('pf-menu-item')) {
      const text = (child._pfItem?.label || '') + ' ' + (child._pfItem?.hint || '')
      const show = !q || text.toLowerCase().includes(q)
      child.hidden = !show
      if (show) visibleInGroup++
    } else if (child.classList.contains('pf-menu-heading') || child.classList.contains('pf-menu-divider')) {
      pending.push(child)
    }
  }
  // Headings and dividers only make sense unfiltered.
  pending.forEach(n => { n.hidden = !!q })
  let empty = menuEl.querySelector('.pf-menu-empty')
  if (!visibleInGroup) {
    if (!empty) {
      empty = document.createElement('div')
      empty.className = 'pf-menu-empty'
      empty.setAttribute('role', 'presentation')
      menuEl.appendChild(empty)
    }
    empty.textContent = 'No matches'
  } else empty?.remove()
}

// The search filters the rows after it, so Enter picks from those only: a row
// above the box is never a match, and with nothing matching nothing runs.
function firstVisibleAfter(input) {
  const menuEl = input.closest('.pf-menu')
  const wrap = input.closest('.pf-menu-search')
  return stops(menuEl).find(s => !s.closest('.pf-menu-search') &&
    (wrap.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING))
}

// A field someone rendered into a { type: 'custom' } item owns its keys.
function inCustomField(node) {
  if (!node?.closest?.('.pf-menu-custom')) return false
  return node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)
}

// ── Keyboard ────────────────────────────────────────────────
function onKeydown(e) {
  // Nothing typed into a menu may reach the canvas shortcuts behind it.
  e.stopPropagation()
  const menuEl = e.currentTarget
  const level = menuLevel(menuEl)
  const active = document.activeElement
  const inSearch = active?.classList?.contains('pf-menu-search-input')
  const list = stops(menuEl)
  const idx = stopIndexOf(list, active)
  const move = to => { const n = list.length; if (!n) return; list[((to % n) + n) % n].focus() }

  // Typing, arrows, Enter and Space inside a custom item's field are the
  // field's own. Escape still leaves the menu; Tab moves between the item's
  // fields and leaves the menu after the last one.
  if (inCustomField(e.target)) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (level > 0) { const parent = stack[level]?.parentItem; closeFrom(level); parent?.focus() }
      else closeMenus({ restoreFocus: true })
    } else if (e.key === 'Tab') {
      const box = e.target.closest('.pf-menu-custom')
      const fields = [...box.querySelectorAll('input, textarea, select, button, [contenteditable="true"], [tabindex]:not([tabindex="-1"])')]
        .filter(f => !f.disabled && isShown(f))
      const i = fields.indexOf(e.target)
      const inside = e.shiftKey ? i > 0 : i > -1 && i < fields.length - 1
      if (!inside) { e.preventDefault(); closeMenus({ restoreFocus: true }) }
    }
    return
  }

  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); move(idx < 0 ? 0 : idx + 1); return
    case 'ArrowUp':   e.preventDefault(); move(idx < 0 ? list.length - 1 : idx - 1); return
    case 'Home': if (inSearch) return; e.preventDefault(); move(0); return
    case 'End':  if (inSearch) return; e.preventDefault(); move(list.length - 1); return
    case 'ArrowRight': {
      if (inSearch) return
      if (active?.classList.contains('pf-menu-swatch')) {
        e.preventDefault(); (active.nextElementSibling || active).focus(); return
      }
      if (active?._pfItem?.submenu) { e.preventDefault(); openSubmenu(active, { focus: true }) }
      return
    }
    case 'ArrowLeft': {
      if (inSearch) return
      if (active?.classList.contains('pf-menu-swatch') && active.previousElementSibling) {
        e.preventDefault(); active.previousElementSibling.focus(); return
      }
      if (level > 0) {
        e.preventDefault()
        const parent = stack[level]?.parentItem
        closeFrom(level)
        parent?.focus()
      }
      return
    }
    case 'Escape': {
      e.preventDefault()
      if (level > 0) {
        const parent = stack[level]?.parentItem
        closeFrom(level)
        parent?.focus()
      } else closeMenus({ restoreFocus: true })
      return
    }
    case 'Tab': e.preventDefault(); closeMenus({ restoreFocus: true }); return
    case 'Enter':
    case ' ': {
      if (inSearch && e.key === ' ') return
      e.preventDefault()
      if (inSearch) {
        const first = firstVisibleAfter(active)
        if (first?.classList.contains('pf-menu-item')) activateItem(first, { viaKeyboard: true })
        else if (first?.classList.contains('pf-menu-swatch')) pickSwatch(first)
        return
      }
      if (active?.classList.contains('pf-menu-swatch')) { pickSwatch(active); return }
      if (active?.classList.contains('pf-menu-item')) activateItem(active, { viaKeyboard: true })
      return
    }
  }

  // First-letter typeahead over the rows' labels.
  if (!inSearch && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && /\S/.test(e.key)) {
    const ch = e.key.toLowerCase()
    const rows = list.filter(s => s.classList.contains('pf-menu-item'))
    if (!rows.length) return
    const start = Math.max(0, rows.indexOf(active))
    for (let i = 1; i <= rows.length; i++) {
      const r = rows[(start + i) % rows.length]
      if ((r._pfItem?.label || '').trim().toLowerCase().startsWith(ch)) { r.focus(); break }
    }
    e.preventDefault()
  }
}

// ── Dismissal ───────────────────────────────────────────────
function insideMenus(node) {
  return !!(node && node.closest && node.closest('.pf-menu'))
}

function wireGlobal() {
  if (globalWired) return
  globalWired = true
  document.addEventListener('pointerdown', e => {
    if (!root || insideMenus(e.target)) return
    // A press on the anchor is left to its own click, which toggles.
    if (root.anchor && root.anchor.contains(e.target)) return
    closeMenus()
  }, true)
  document.addEventListener('wheel', e => { if (root && !insideMenus(e.target)) closeMenus() }, { capture: true, passive: true })
  document.addEventListener('scroll', e => { if (root && !insideMenus(e.target)) closeMenus() }, true)
  window.addEventListener('resize', () => closeMenus())
  window.addEventListener('blur', () => closeMenus())
}
