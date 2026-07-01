// ════════════════════════════════════════════════════════════
//  context-menu.js — Right-click quick actions on a block
//
//  A floating menu (Duplicate, Change type, Color, Collapse, Delete)
//  reachable by right-click or the keyboard context-menu key. It reuses
//  the same mutation functions as the inspector so behavior stays in sync.
// ════════════════════════════════════════════════════════════

import { state, selection, ui } from './state.js'
import { $, TYPES, SWATCH_COLORS, SWATCH_NAMES, getBlockEl } from './utils.js'
import {
  duplicateBlock, deleteBlock, mutateBlock, selectBlock,
} from './render.js'

let menuEl = null

function closeMenu() {
  if (menuEl) { menuEl.remove(); menuEl = null }
}

function typeSwatchList() {
  return Object.entries(TYPES).map(([t, cfg]) =>
    `<button class="ctx-type-opt" role="menuitem" data-ctx-type="${t}">` +
    `<span class="ctx-dot" style="background:${cfg.color}"></span>${cfg.label}</button>`
  ).join('')
}

function colorSwatchList() {
  return `<button class="ctx-color-opt ctx-color-reset" role="menuitem" data-ctx-color="reset" title="Reset to type color"></button>` +
    SWATCH_COLORS.map(c =>
      `<button class="ctx-color-opt" role="menuitem" data-ctx-color="${c}" style="background:${c}" title="${SWATCH_NAMES[c] || c}" aria-label="${SWATCH_NAMES[c] || c}"></button>`
    ).join('')
}

function buildMenu(id) {
  const b = state.blocks[id]; if (!b) return null
  const menu = document.createElement('div')
  menu.className = 'ctx-menu'
  menu.setAttribute('role', 'menu')
  menu.innerHTML = `
    <button class="ctx-item" role="menuitem" data-ctx-action="duplicate">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
      Duplicate <span class="ctx-shortcut">⌘D</span>
    </button>
    <button class="ctx-item ctx-has-sub" role="menuitem" aria-haspopup="true" data-ctx-sub="type">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9h6V3H3v6zm0 12h6v-6H3v6zm8 0h6v-6h-6v6zm8 0h6v-6h-6v6zm-8-8h6V3h-6v10z"/></svg>
      Change type
      <svg class="ctx-caret" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
      <div class="ctx-submenu" data-ctx-submenu="type">${typeSwatchList()}</div>
    </button>
    <button class="ctx-item ctx-has-sub" role="menuitem" aria-haspopup="true" data-ctx-sub="color">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
      Accent color
      <svg class="ctx-caret" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
      <div class="ctx-submenu ctx-submenu-colors" data-ctx-submenu="color">${colorSwatchList()}</div>
    </button>
    <button class="ctx-item" role="menuitem" data-ctx-action="collapse">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
      ${b.collapsed ? 'Expand' : 'Collapse'}
    </button>
    <div class="ctx-divider"></div>
    <button class="ctx-item ctx-danger" role="menuitem" data-ctx-action="delete">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
      Delete <span class="ctx-shortcut">Del</span>
    </button>`
  return menu
}

function positionMenu(menu, clientX, clientY) {
  menu.style.left = '0px'; menu.style.top = '0px'
  document.body.appendChild(menu)
  const { width, height } = menu.getBoundingClientRect()
  const pad = 8
  let x = clientX, y = clientY
  if (x + width  + pad > window.innerWidth)  x = window.innerWidth  - width  - pad
  if (y + height + pad > window.innerHeight) y = window.innerHeight - height - pad
  menu.style.left = Math.max(pad, x) + 'px'
  menu.style.top  = Math.max(pad, y) + 'px'
  // Open submenus leftward when the menu sits past the viewport midpoint,
  // so the type/color flyouts don't spill off the right edge.
  const subW = 176
  if (x + width + subW + pad > window.innerWidth) menu.classList.add('flip-sub')
}

export function openBlockMenu(id, clientX, clientY) {
  if (ui.readOnly || !state.blocks[id]) return
  closeMenu()
  selectBlock(id)
  const menu = buildMenu(id); if (!menu) return
  menuEl = menu
  positionMenu(menu, clientX, clientY)

  menu.addEventListener('click', e => {
    const typeOpt = e.target.closest('[data-ctx-type]')
    if (typeOpt) { mutateBlock(id, { type: typeOpt.dataset.ctxType }); closeMenu(); return }
    const colorOpt = e.target.closest('[data-ctx-color]')
    if (colorOpt) {
      const c = colorOpt.dataset.ctxColor
      mutateBlock(id, { color: c === 'reset' ? null : c }); closeMenu(); return
    }
    const item = e.target.closest('[data-ctx-action]')
    if (!item) return
    const action = item.dataset.ctxAction
    if (action === 'duplicate') { const n = duplicateBlock(id); if (n) selectBlock(n) }
    else if (action === 'collapse') mutateBlock(id, { collapsed: !state.blocks[id]?.collapsed })
    else if (action === 'delete') deleteBlock(id)
    closeMenu()
  })

  // Keyboard: arrow-navigate items, Escape closes.
  requestAnimationFrame(() => menu.querySelector('.ctx-item')?.focus())
  menu.addEventListener('keydown', e => {
    const items = [...menu.querySelectorAll('.ctx-item')]
    const idx = items.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); getBlockEl(id)?.focus() }
  })
}

export function setupContextMenu() {
  const canvasRoot = $.canvasRoot()

  canvasRoot.addEventListener('contextmenu', e => {
    const block = e.target.closest('.block'); if (!block) return
    if (ui.readOnly) return
    e.preventDefault()
    openBlockMenu(block.dataset.id, e.clientX, e.clientY)
  })

  // Keyboard context-menu key / Shift+F10 on a focused or selected block.
  document.addEventListener('keydown', e => {
    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
    const focusedBlock = document.activeElement?.closest?.('.block')
    const id = focusedBlock?.dataset.id || selection.blockId
    if (!id || !state.blocks[id]) return
    e.preventDefault()
    const el = getBlockEl(id); const r = el?.getBoundingClientRect()
    openBlockMenu(id, r ? r.left + 12 : 200, r ? r.top + 12 : 200)
  })

  // Dismiss on any outside interaction.
  document.addEventListener('pointerdown', e => {
    if (menuEl && !e.target.closest('.ctx-menu')) closeMenu()
  }, true)
  window.addEventListener('blur', closeMenu)
  document.addEventListener('scroll', closeMenu, true)
}
