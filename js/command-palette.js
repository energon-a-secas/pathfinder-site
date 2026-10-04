// ════════════════════════════════════════════════════════════
//  command-palette.js: Cmd/Ctrl+K. One box that runs any action,
//  jumps to any block or map, adds any type and applies any
//  template, by name.
//
//  A modal <dialog> holding an ARIA combobox: the field keeps focus
//  and the active row is its aria-activedescendant. Up and Down
//  move, Enter runs, a row with more behind it (Change type, Status,
//  Connect to...) opens in place and Backspace on an empty field or
//  Escape goes back up; Escape at the top closes and focus returns
//  to where it was. Typing /, >, # or @ first narrows the list to
//  Create, Actions, Blocks or Maps; / on the canvas opens straight
//  at Create. A view-only link gets what works there.
//
//  The rows and the matching live in command-items.js; N-then-a-
//  letter lives in type-keys.js.
//
//  openCommandPalette({ scope, query }) / closeCommandPalette()
//  isCommandPaletteOpen() / setupCommandPalette()
// ════════════════════════════════════════════════════════════

import { ui } from './state.js'
import { $ } from './utils.js'
import { closeMenus, isMenuOpen } from './menu.js'
import { closeShortcuts } from './ui-panels.js'
import { isTyping, canvasHasFocus, modalDialogOpen, withCameraHeld } from './navigation.js'
import { commandGroups, rowMatch, ICONS, MOD, IS_MAC, PALETTE_ROW_ID } from './command-items.js'
import { rowEl } from './command-rows.js'
import { setupTypeKeys, isTypeKeyArmed } from './type-keys.js'

const RECENT_KEY = 'pathfinder-palette-recent'
const RECENT_MAX = 8, RECENT_SHOWN = 5
const QUERY_CAP = 50        // rows per group for a query
const SCOPE_CAP = 200       // rows for a whole group (a scope, or a drilled list)

// Typed first, these narrow the list. They are a shortcut, not syntax: the
// character is taken out of the field and shown as a chip instead.
const SCOPES = { '/': 'create', '>': 'actions', '#': 'blocks', '@': 'maps' }
const SCOPE_GROUPS = { create: ['create'], actions: ['selection', 'actions'], blocks: ['blocks'], maps: ['maps'] }
const SCOPE_LABELS = { create: 'Create', actions: 'Actions', blocks: 'Blocks', maps: 'Maps' }


let dlg = null, input = null, listEl = null, chipEl = null, liveEl = null, footScopes = null
let pool = null          // the groups, built when the palette opens
let stack = []           // drilled levels: { label, rows, noDefault, placeholder, root }
let scope = null         // a SCOPES value, or null for everything
let flat = []            // the rendered rows, in order: { row, el }
let active = -1
let returnFocus = null
let memoryRecent = []    // where nothing may be stored (an embed, blocked storage)
let announceTimer = null

export function isCommandPaletteOpen() { return !!dlg?.open }

// ── Recent ───────────────────────────────────────────────────
// What this browser ran from the palette lately, newest first. A per-viewer
// convenience: an embed never writes the visitor's storage, and a page that
// cannot store keeps the list in memory.
//
// Recent can hold the row Enter runs on a fresh palette, so it never holds
// one that should not run by accident: nothing destructive (Delete, Clear
// this map, Delete a map), no template (a dozen blocks, a second time), and
// no row that waits for a search ("Change type to risk").
const recallable = row => !!row && !row.danger && !row.noRecent && !row.searchOnly
function readRecent() {
  if (ui.embed) return memoryRecent
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []
  } catch (_) { return memoryRecent }
}

function remember(row) {
  if (!recallable(row) || !row.id) return
  const id = row.id
  const next = [id, ...readRecent().filter(x => x !== id)].slice(0, RECENT_MAX)
  memoryRecent = next
  if (ui.embed) return
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch (_) {}
}

// Read back through the same rule, so a list stored before it (or by an
// older build) cannot bring a Delete back. A row already shown above (the
// Selected group) is not repeated.
function recentRows(shown = new Set()) {
  const byId = new Map()
  pool.forEach(g => g.items.forEach(r => { if (!byId.has(r.id)) byId.set(r.id, r) }))
  return readRecent().map(id => byId.get(id))
    .filter(r => recallable(r) && !r.disabled && !shown.has(r.id))
    .slice(0, RECENT_SHOWN)
}

// ── Building the dialog ──────────────────────────────────────
function build() {
  dlg = document.createElement('dialog')
  dlg.className = 'cmdk'
  dlg.id = 'commandPalette'
  dlg.setAttribute('aria-label', 'Command palette')
  dlg.innerHTML = `
    <div class="cmdk-field">
      <span class="cmdk-search-icon" aria-hidden="true">${ICONS.find}</span>
      <span class="cmdk-chip" id="cmdkScope" hidden></span>
      <input class="cmdk-input" id="cmdkInput" type="text" role="combobox" aria-expanded="true"
        aria-controls="cmdkList" aria-autocomplete="list" aria-haspopup="listbox"
        autocomplete="off" autocapitalize="off" spellcheck="false">
      <kbd class="cmdk-kbd cmdk-esc" aria-hidden="true">Esc</kbd>
    </div>
    <div class="cmdk-list" id="cmdkList" role="listbox" aria-label="Commands"></div>
    <div class="cmdk-foot" aria-hidden="true">
      <span class="cmdk-foot-keys"><kbd class="cmdk-kbd">↑</kbd><kbd class="cmdk-kbd">↓</kbd> to move,
        <kbd class="cmdk-kbd">Enter</kbd> to run, <kbd class="cmdk-kbd">Esc</kbd> to close</span>
      <span class="cmdk-foot-scopes"></span>
    </div>
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>`
  document.body.appendChild(dlg)
  input = dlg.querySelector('.cmdk-input')
  listEl = dlg.querySelector('.cmdk-list')
  chipEl = dlg.querySelector('.cmdk-chip')
  liveEl = dlg.querySelector('[role=status]')
  footScopes = dlg.querySelector('.cmdk-foot-scopes')

  input.addEventListener('input', onInput)
  input.addEventListener('keydown', onKey)
  // The field keeps focus: a press on a row must not take it.
  listEl.addEventListener('mousedown', e => e.preventDefault())
  // Moving the pointer picks the row under it; a list scrolling under a
  // still pointer does not (pointermove, not mouseover).
  listEl.addEventListener('pointermove', e => {
    const i = flat.findIndex(f => f.el === e.target.closest?.('.cmdk-row'))
    if (i >= 0 && i !== active && !flat[i].row.disabled) setActive(i, { byKeyboard: false })
  })
  listEl.addEventListener('click', e => {
    const i = flat.findIndex(f => f.el === e.target.closest?.('.cmdk-row'))
    if (i >= 0) runRow(flat[i].row)
  })
  // A press on the backdrop closes it, like any light dialog.
  dlg.addEventListener('click', e => {
    if (e.target !== dlg) return
    const r = dlg.getBoundingClientRect()
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeCommandPalette()
  })
  // Escape reaches onKey first; this is for any other way a dialog cancels.
  dlg.addEventListener('cancel', e => { e.preventDefault(); onEscape() })
  dlg.addEventListener('wheel', e => e.stopPropagation(), { passive: true })
}

// ── Opening and closing ──────────────────────────────────────
function validScope(s) {
  return s && SCOPE_GROUPS[s] && pool.some(g => SCOPE_GROUPS[s].includes(g.key) && g.items.length) ? s : null
}

/**
 * Open the palette (or, open already, switch it to `scope`). `scope` is
 * 'create', 'actions', 'blocks' or 'maps'; `query` prefills the field.
 */
export function openCommandPalette({ scope: s = null, query = '' } = {}) {
  if (!dlg) build()
  if (!dlg.open) {
    closeMenus()
    const ae = document.activeElement
    // A field on a card that is being edited commits as focus leaves it; go
    // back to its card, which is still there.
    returnFocus = ae?.isContentEditable ? (ae.closest('.block') || ae) : ae
    pool = commandGroups()
    stack = []
    dlg.showModal()
  }
  scope = validScope(s)
  input.value = query
  input.placeholder = placeholder()
  render()
  input.focus()
}

export function closeCommandPalette({ restoreFocus = true } = {}) {
  if (!dlg?.open) return
  dlg.close()
  clearTimeout(announceTimer)
  pool = null; stack = []; scope = null; flat = []; active = -1
  listEl.textContent = ''
  const back = returnFocus
  returnFocus = null
  if (!restoreFocus) return
  const target = back?.isConnected && back !== document.body && typeof back.focus === 'function' ? back : $.canvasViewport()
  // A card getting its focus back is not arriving at it: the camera stays.
  withCameraHeld(() => target?.focus({ preventScroll: true }))
}

// ── What to show ─────────────────────────────────────────────
function ranked(rows, q, cap) {
  const scored = []
  rows.forEach((row, i) => {
    const m = rowMatch(q, row.label)
    if (m) scored.push({ row, hits: m.hits, score: m.score, i })
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return { rows: scored.slice(0, cap), more: Math.max(0, scored.length - cap) }
}

// Rows under one heading per run of the same heading (a drilled type list
// keeps its steps, Create keeps "Connected to" apart from "At the centre").
function byHeading(rows, fallback, cap = SCOPE_CAP) {
  const out = []
  rows.slice(0, cap).forEach(row => {
    const label = row.heading || fallback
    const last = out[out.length - 1]
    if (last && last.label === label) last.rows.push({ row })
    else out.push({ label, rows: [{ row }] })
  })
  if (rows.length > cap && out.length) out[out.length - 1].more = rows.length - cap
  return out
}

function sections() {
  const q = input.value.trim()
  if (stack.length) {
    const level = stack[stack.length - 1]
    if (!q) return byHeading(level.rows, level.label)
    const r = ranked(level.rows, q, SCOPE_CAP)
    return [{ label: level.label, rows: r.rows, more: r.more }]
  }
  const groups = pool.filter(g => !scope || SCOPE_GROUPS[scope].includes(g.key))
  if (q) {
    return groups.map(g => { const r = ranked(g.items, q, QUERY_CAP); return { label: g.label, rows: r.rows, more: r.more } })
      .filter(s => s.rows.length)
      // The best match leads, so Enter takes it, whichever group it is in.
      .sort((a, b) => b.rows[0].score - a.rows[0].score)
  }
  if (scope) return groups.flatMap(g => byHeading(g.items.filter(r => !r.searchOnly), g.label))
  // With nothing typed, the list is what can be done now, short: what the
  // selection offers first, then Recent, then a few of each group with "N
  // more: keep typing". A row that cannot run yet (Undo with nothing to
  // undo) waits until somebody searches for it.
  const out = []
  const add = g => {
    const usable = g.items.filter(r => !r.disabled && !r.searchOnly)
    const list = g.preview || (g.cap ? usable.slice(0, g.cap) : usable)
    if (!list.length) return
    out.push({ label: g.label, rows: list.map(row => ({ row })), more: usable.length - list.length })
  }
  groups.filter(g => g.key === 'selection').forEach(add)
  const recent = recentRows(new Set(out.flatMap(sec => sec.rows.map(r => r.row.id))))
  if (recent.length) out.push({ label: 'Recent', rows: recent.map(row => ({ row })) })
  groups.filter(g => g.key !== 'selection').forEach(add)
  return out
}

function placeholder() {
  const level = stack[stack.length - 1]
  if (level) return level.placeholder || `Filter ${level.label.replace(/…$/, '').toLowerCase()}`
  if (scope === 'create') return 'Type a block type, like risk or metric'
  if (scope) return `Search ${SCOPE_LABELS[scope].toLowerCase()}`
  return ui.readOnly ? 'Search actions and blocks' : 'Search actions, blocks, maps and templates'
}

// ── Rendering (one row: command-rows.js) ─────────────────────
function render() {
  const secs = sections()
  listEl.textContent = ''
  flat = []
  secs.forEach((sec, si) => {
    const group = document.createElement('div')
    group.className = 'cmdk-section'
    group.setAttribute('role', 'group')
    const h = document.createElement('div')
    h.className = 'cmdk-heading'
    h.id = `cmdk-h-${si}`
    h.setAttribute('role', 'presentation')
    h.textContent = sec.label
    group.setAttribute('aria-labelledby', h.id)
    group.appendChild(h)
    sec.rows.forEach(({ row, hits }) => {
      const el = rowEl(row, hits, flat.length)
      flat.push({ row, el })
      group.appendChild(el)
    })
    if (sec.more > 0) {
      const more = document.createElement('div')
      more.className = 'cmdk-more'
      more.setAttribute('role', 'presentation')
      more.textContent = `${sec.more} more: keep typing to narrow the list`
      group.appendChild(more)
    }
    listEl.appendChild(group)
  })
  if (!flat.length) {
    const empty = document.createElement('div')
    empty.className = 'cmdk-empty'
    empty.setAttribute('role', 'presentation')
    const q = input.value.trim()
    empty.textContent = q ? `Nothing matches “${q}”. Try fewer letters.` : 'Nothing to choose here.'
    listEl.appendChild(empty)
  }
  const level = stack[stack.length - 1]
  const label = level ? level.label : scope ? SCOPE_LABELS[scope] : ''
  chipEl.hidden = !label
  chipEl.textContent = label
  input.setAttribute('aria-label', label ? `Search ${label.replace(/…$/, '')}` : 'Search commands')
  footScopes.textContent = level ? 'Backspace to go back' : scope ? 'Backspace to search everything'
    : ui.readOnly ? '# for blocks' : '/ to create, > actions, # blocks, @ maps'
  // A list that asks for a choice (Connect to) has nothing picked until
  // something is typed or a row is chosen with the arrows. A list of values
  // (Change type, Status) opens on the current one, like any picker.
  const typed = !!input.value.trim()
  const current = level && !typed ? flat.findIndex(f => f.row.checked && !f.row.disabled) : -1
  const first = level?.noDefault && !typed ? -1 : current >= 0 ? current : nextEnabled(-1, 1)
  listEl.scrollTop = 0
  setActive(first, { byKeyboard: true, scroll: false })
  if (current >= 0) openOn(flat[current].el)
  sayCount()
}

// A list of values opens scrolled to the current one (Change type on
// Process), and never with a heading half under the field: it lands on the
// start of the value's own step, or at the end of the list, or on an earlier
// step's start, whichever first shows the value whole below a whole heading.
// Headings are sticky (CSS), so the heading at the top is the step the rows
// under it belong to.
function openOn(el) {
  const max = listEl.scrollHeight - listEl.clientHeight
  if (max <= 0) return
  const box = listEl.getBoundingClientRect()
  const at = node => node.getBoundingClientRect().top - box.top + listEl.scrollTop
  const secs = [...listEl.querySelectorAll(':scope > .cmdk-section')].map(sec => {
    const top = at(sec)
    return { top, bottom: top + sec.offsetHeight, head: sec.querySelector('.cmdk-heading')?.offsetHeight || 0 }
  })
  const rowTop = at(el), rowBottom = rowTop + el.offsetHeight
  const padEnd = parseFloat(getComputedStyle(listEl).paddingBottom) || 0
  const fits = top => {
    const sec = secs.find(x => x.top <= top + 0.5 && x.bottom > top + 0.5)
    const head = sec ? sec.head : 0
    return (!sec || sec.bottom - top >= head - 0.5) &&
      rowTop >= top + head - 0.5 && rowBottom <= top + listEl.clientHeight - padEnd + 0.5
  }
  const own = secs.find(x => x.top <= rowTop && x.bottom >= rowBottom)
  // Whole pixels, rounded toward the section's start: WebKit keeps an
  // integer scrollTop and floors a fractional one, which left a 1px sliver
  // of the previous step above the sticky heading.
  const options = [own?.top, max, ...secs.map(x => x.top).reverse()]
    .filter(t => t != null && t <= max + 0.5).map(t => Math.ceil(t - 0.01))
  const top = options.find(fits)
  if (top != null) listEl.scrollTop = top
  else el.scrollIntoView({ block: 'center' })
}

function sayCount() {
  clearTimeout(announceTimer)
  const n = flat.length
  const level = stack[stack.length - 1]
  announceTimer = setTimeout(() => {
    if (!liveEl) return
    const what = n ? `${n} ${n === 1 ? 'result' : 'results'}` : 'No matches'
    liveEl.textContent = level ? `${level.label}: ${what}` : what
  }, 250)
}

// ── The active row ───────────────────────────────────────────
function nextEnabled(from, dir, wrap = true) {
  const n = flat.length
  if (!n) return -1
  for (let step = 1; step <= n; step++) {
    let i = from + dir * step
    if (wrap) i = ((i % n) + n) % n
    else if (i < 0 || i >= n) return -1
    if (!flat[i].row.disabled) return i
  }
  return -1
}

function setActive(i, { byKeyboard = true, scroll = true } = {}) {
  if (flat[active]) {
    flat[active].el.setAttribute('aria-selected', 'false')
    flat[active].el.classList.remove('is-active', 'is-key')
  }
  active = i
  const cur = flat[i]
  if (!cur) { input.removeAttribute('aria-activedescendant'); return }
  cur.el.setAttribute('aria-selected', 'true')
  cur.el.classList.add('is-active')
  // The focus ring follows the keyboard; the pointer only lights the row.
  cur.el.classList.toggle('is-key', byKeyboard)
  input.setAttribute('aria-activedescendant', cur.el.id)
  if (scroll) cur.el.scrollIntoView({ block: 'nearest' })
}

function move(dir, { page = false } = {}) {
  if (!flat.length) return
  if (page) {
    let i = active < 0 ? 0 : active
    for (let k = 0; k < 8; k++) { const nx = nextEnabled(i, dir, false); if (nx < 0) break; i = nx }
    setActive(i)
    return
  }
  const i = nextEnabled(active < 0 ? (dir > 0 ? -1 : 0) : active, dir)
  if (i >= 0) setActive(i)
}

// ── Running ──────────────────────────────────────────────────
function drill(row) {
  const rows = row.children()
  stack.push({
    label: row.label, rows, noDefault: !!rows.noDefault, placeholder: rows.placeholder,
    root: stack.length ? stack[0].root : row,
  })
  input.value = ''
  input.placeholder = placeholder()
  render()
}

function back() {
  stack.pop()
  input.value = ''
  input.placeholder = placeholder()
  render()
}

function runRow(row) {
  if (!row || row.disabled) return
  if (row.children) { drill(row); return }
  // A choice inside Change type is remembered as Change type; one inside
  // Delete a map is not remembered at all.
  remember(stack.length ? (row.danger ? null : stack[0].root) : row)
  // Close first, then act: an action that moves focus (title editing, the
  // Find box, a file picker) must win over the palette handing focus back.
  closeCommandPalette()
  try { row.run?.() } catch (err) { console.error(err) }
}

function onEscape() {
  if (stack.length) back()
  else closeCommandPalette()
}

function onInput() {
  if (!stack.length && !scope) {
    const s = SCOPES[input.value[0]]
    if (s && validScope(s)) {
      scope = s
      input.value = input.value.slice(1)
      input.placeholder = placeholder()
    }
  }
  render()
}

function onKey(e) {
  // Nothing typed here reaches the canvas behind. The palette closes inside
  // this handler, and the same Escape then deselected the block it had just
  // jumped to, and the same Enter opened its title.
  e.stopPropagation()
  if (e.isComposing || e.keyCode === 229) return
  const empty = !input.value
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); move(1); return
    case 'ArrowUp':   e.preventDefault(); move(-1); return
    case 'PageDown':  e.preventDefault(); move(1, { page: true }); return
    case 'PageUp':    e.preventDefault(); move(-1, { page: true }); return
    case 'Enter':
      e.preventDefault()
      if (flat[active]) runRow(flat[active].row)
      else if (!input.value.trim()) move(1)
      return
    case 'Escape': e.preventDefault(); onEscape(); return
    case 'Tab': e.preventDefault(); return   // one field; the arrows move through the list
    case 'ArrowRight':
      if (flat[active]?.row.children && input.selectionStart === input.value.length) { e.preventDefault(); drill(flat[active].row) }
      return
    case 'ArrowLeft':
      if (stack.length && empty) { e.preventDefault(); back() }
      return
    case 'Backspace':
      if (!empty) return
      if (stack.length) { e.preventDefault(); back() }
      else if (scope) { e.preventDefault(); scope = null; input.placeholder = placeholder(); render() }
  }
}

// ── Keys that open it ────────────────────────────────────────
const sheetOpen = () => { const o = $.shortcutOverlay(); return !!o && o.style.display !== 'none' }

function isKey(e, letter) {
  const k = (e.key || '').toLowerCase()
  return k === letter || (!/^[a-z]$/.test(k) && e.code === 'Key' + letter.toUpperCase())
}

// Cmd+K on a Mac, Ctrl+K elsewhere. Never Ctrl+K on a Mac: in every text
// field there it deletes to the end of the line, and the palette opens while
// typing too.
const isPaletteChord = e => (IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) &&
  !e.altKey && !e.shiftKey && isKey(e, 'k')

function onGlobalKey(e) {
  // The key after N is N's (type-keys.js, wired first): it has already
  // taken it, Cmd/Ctrl+K and / included.
  if (e.defaultPrevented || isTypeKeyArmed()) return
  // Cmd/Ctrl+K anywhere, while typing too; again to close. A dialog that
  // owns the keyboard (the incoming-link chooser) keeps it.
  if (isPaletteChord(e)) {
    if (isCommandPaletteOpen()) { e.preventDefault(); e.stopPropagation(); closeCommandPalette(); return }
    if (modalDialogOpen()) return
    e.preventDefault(); e.stopPropagation()
    if (sheetOpen()) closeShortcuts()
    openCommandPalette()
    return
  }
  // / on the canvas: straight to Create.
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !ui.readOnly && !isCommandPaletteOpen() &&
      !modalDialogOpen() && !isMenuOpen() && !sheetOpen() && !isTyping() && canvasHasFocus()) {
    e.preventDefault(); e.stopPropagation()
    openCommandPalette({ scope: 'create' })
  }
}

/**
 * The Help menu's row for the palette (helpMenuItems in js/view-menu.js),
 * the way in for a pointer or a touch screen, where there is no K to press.
 */
export function commandPaletteMenuItem() {
  return { label: 'Command palette', hint: 'Run anything by name', shortcut: MOD + 'K', rowId: PALETTE_ROW_ID,
    action: () => openCommandPalette() }
}

/**
 * Wire Cmd/Ctrl+K, / and N-then-a-letter. Once only; returns the function
 * that unwires them again (the test suite uses it, so its later files run
 * with the keys they expect).
 */
let teardown = null
export function setupCommandPalette() {
  if (teardown) return teardown
  // N's listener first: on the same target and phase, the first one wired
  // runs first, and the key after N must reach nothing else.
  const offTypeKeys = setupTypeKeys()
  // Capture, so a menu or a card's own key handling never swallows it.
  document.addEventListener('keydown', onGlobalKey, true)
  teardown = () => {
    document.removeEventListener('keydown', onGlobalKey, true)
    offTypeKeys()
    closeCommandPalette({ restoreFocus: false })
    teardown = null
  }
  return teardown
}
