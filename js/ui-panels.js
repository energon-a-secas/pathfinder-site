// ════════════════════════════════════════════════════════════
//  ui-panels.js: search, shortcuts overlay, panel tabs,
//                 dev options, export/share/import dropdowns, header buttons
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, canvasMeta, devOpts,
         saveState, buildShareUrl, buildEmbedUrl, snapshot, debouncedSave } from './state.js'
import { $, TYPES, STATUS_DEFS, CARD_STYLES, DEFAULT_CARD_STYLE, SITUATION_FIELDS, SITUATION_DEFAULT,
         clamp, escHtml, showToast, getBlockDims, copyText, undoKeyLabel, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { applyTransform, renderArrows, renderFrames, fitView, updateHint } from './canvas.js'
import { renderAllBlocks, renderInspector, selectBlock, undo, updateCanvasTitle } from './render.js'
import { TEMPLATES, TICONS, applyTemplate, applyTemplateSituation,
         listUserTemplates, saveCurrentAsTemplate, deleteUserTemplate } from './templates.js'
import { refreshPrompt } from './prompt.js'
import { exportJSON, exportMarkdown, exportMeetingSummary, exportToPresentationSage } from './export.js'
import { exportSpecBundle } from './spec-export.js'
import { detectFormat, fromJsonCanvas, parseMermaid, downloadJsonCanvas, toMermaid } from './interop.js'
import { exportPNG, exportSVG } from './image-export.js'
import { DIAGRAM_BUILDER_PROMPT } from './diagram-instructions.js'
import { runGapDetection } from './gaps.js'
import { getDocsBase, setDocsBase } from './doc-panel.js'
import { tidyCanvas, tidySummary } from './layout.js'
import { searchBlocks } from './search.js'
import { searchSavedMaps, switchTo, currentId } from './library.js'
import { decodeLegacyShare, decodeShareHash, isShareHash, canCompressLinks } from './state.js'
// Where a template or a link lands, and Tidy's move.
import { arriveAt, arriveAfterLoad, arrivalLead, arrivalHint, animateView,
         positionsNow, animateTidy, fitTarget, TIDY_MS } from './zoom-controls.js'
import { openIncoming, incomingMessage } from './sharing.js'
import { setupFilter, filterValue, setFilterValue } from './filter-menu.js'
import { typeDot } from './type-menu.js'
import { showPanels } from './chrome.js'

// ── Search ───────────────────────────────────────────────────
let searchReturnFocus = null

/** Centre a block at 100% or more and select it, with the camera's easing. */
export function focusBlock(id) {
  const b = state.blocks[id]; if (!b) return
  const { w, h } = getBlockDims(id)
  const canvasViewport = $.canvasViewport()
  const vpW = canvasViewport.offsetWidth, vpH = canvasViewport.offsetHeight
  const targetZoom = clamp(Math.max(view.zoom, 1.0), MIN_ZOOM, MAX_ZOOM)
  // zoom-controls.js eases it, jumps under reduced motion, and cancels an
  // earlier move still running.
  animateView(vpW / 2 - (b.x + w / 2) * targetZoom, vpH / 2 - (b.y + h / 2) * targetZoom, targetZoom)
  selectBlock(id)
}

export function openSearch() {
  if (!ui.searchOpen) searchReturnFocus = document.activeElement
  ui.searchOpen = true
  $.searchOverlay().style.display = ''
  document.getElementById('searchBtn')?.setAttribute('aria-expanded', 'true')
  $.searchInput().setAttribute('aria-expanded', 'true')
  refreshSearch()
  $.searchInput().focus()
  $.searchInput().select()
}

export function closeSearch({ restoreFocus = true } = {}) {
  ui.searchOpen = false
  $.searchOverlay().style.display = 'none'
  $.searchInput().setAttribute('aria-expanded', 'false')
  $.searchInput().removeAttribute('aria-activedescendant')
  document.getElementById('searchBtn')?.setAttribute('aria-expanded', 'false')
  if (restoreFocus) {
    const target = searchReturnFocus?.isConnected && searchReturnFocus !== document.body
      ? searchReturnFocus : document.getElementById('searchBtn')
    target?.focus({ preventScroll: true })
  }
}

function setSearchFocus(index, scroll = false) {
  const items = $.searchResults().querySelectorAll('.search-result')
  ui.searchFocusIdx = items.length ? (index + items.length) % items.length : -1
  items.forEach((el, i) => {
    const on = i === ui.searchFocusIdx
    el.classList.toggle('focused', on)
    el.setAttribute('aria-selected', String(on))
  })
  const active = items[ui.searchFocusIdx]
  if (active) {
    $.searchInput().setAttribute('aria-activedescendant', active.id)
    if (scroll) active.scrollIntoView({ block: 'nearest' })
  } else $.searchInput().removeAttribute('aria-activedescendant')
}

function refreshSearch() {
  const allMaps = !ui.readOnly && !ui.embed && filterValue(document.getElementById('searchScope')) === 'all'
  const filters = {
    type: filterValue(document.getElementById('searchType')),
    status: filterValue(document.getElementById('searchStatus')),
  }
  const results = allMaps ? searchSavedMaps($.searchInput().value, filters) : searchBlocks(state.blocks, $.searchInput().value, filters)
  $.searchResults().innerHTML = results.map(({ block: b, source, excerpt, mapId, mapName, current }, i) =>
    `<div class="search-result" id="search-result-${i}" role="option" aria-selected="false" data-id="${escHtml(b.id)}" data-map="${escHtml(mapId || '')}">
       <span class="search-result-dot" data-shape="${escHtml(TYPES[b.type]?.shape || 'dot')}" style="background:var(--c-${TYPES[b.type] ? b.type : 'custom'})" aria-hidden="true"></span>
       <span class="search-result-content">
         <span class="search-result-title">${escHtml(b.title || '(untitled)')}</span>
         ${allMaps ? `<span class="search-result-map">${escHtml(mapName)}${current ? ' · current map' : ''}</span>` : ''}
         ${excerpt ? `<span class="search-result-excerpt">${source !== 'Description' ? escHtml(source) + ': ' : ''}${escHtml(excerpt)}</span>` : ''}
       </span>
       <span class="search-result-type">${escHtml(TYPES[b.type]?.label || b.type)}</span>
     </div>`).join('')
  const summary = document.getElementById('searchSummary')
  if (summary) summary.textContent = allMaps
    ? `${results.length} matching blocks across ${new Set(results.map(result => result.mapId)).size} maps`
    : `${results.length} of ${Object.keys(state.blocks).length} blocks`
  const empty = document.getElementById('searchEmpty')
  if (empty) {
    empty.hidden = results.length > 0
    empty.textContent = allMaps || Object.keys(state.blocks).length
      ? 'No matching blocks. Try different words or reset the filters.'
      : 'This map has no blocks to search yet.'
  }
  $.searchResults().scrollTop = 0
  setSearchFocus(0)
}

function chooseSearchResult(id, mapId) {
  const switching = mapId && mapId !== currentId()
  if (switching && !switchTo(mapId)) {
    showToast('Could not open that map. Your current work is still open', 'warning')
    return
  }
  closeSearch({ restoreFocus: false })
  const reveal = () => {
    focusBlock(id)
    document.getElementById('b-' + id)?.focus({ preventScroll: true })
  }
  // Import may schedule a fit; reveal the result after that frame.
  if (switching) requestAnimationFrame(reveal)
  else reveal()
}

export function setupSearchEvents() {
  const overlay = $.searchOverlay()
  const searchInput = $.searchInput()
  // Type, status and scope are the one filter control (filter-menu.js).
  const scope = document.getElementById('searchScope')
  if (scope) {
    scope.hidden = ui.readOnly || ui.embed
    setupFilter(scope, { name: 'Search in', onChange: refreshSearch, options: () => [
      { value: 'current', label: 'This map' }, { value: 'all', label: 'All saved maps' }] })
  }
  document.getElementById('searchBtn')?.addEventListener('click', () => ui.searchOpen ? closeSearch() : openSearch())
  document.getElementById('searchClose')?.addEventListener('click', () => closeSearch())
  setupFilter(document.getElementById('searchType'), { name: 'Type', onChange: refreshSearch, options: () => [
    { value: '', label: 'All types' },
    ...Object.keys(TYPES).map(t => ({ value: t, label: TYPES[t].label, dot: typeDot(t), dotShape: TYPES[t].shape }))] })
  setupFilter(document.getElementById('searchStatus'), { name: 'Status', onChange: refreshSearch, options: () => [
    { value: '', label: 'All statuses' },
    ...Object.entries(STATUS_DEFS).map(([value, { label }]) => ({ value, label }))] })
  document.getElementById('searchReset')?.addEventListener('click', () => {
    searchInput.value = ''
    setFilterValue(document.getElementById('searchType'), '')
    setFilterValue(document.getElementById('searchStatus'), '')
    refreshSearch()
    searchInput.focus()
  })
  searchInput.addEventListener('input', refreshSearch)
  $.searchResults().addEventListener('click', e => {
    const item = e.target.closest('.search-result')
    if (item) chooseSearchResult(item.dataset.id, item.dataset.map)
  })
  // This is an inline search surface, so Tab can reach the filters or leave it.
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault(); searchInput.focus(); searchInput.select()
    }
    e.stopPropagation()
  })
  overlay.addEventListener('dblclick', e => e.stopPropagation())
  searchInput.addEventListener('keydown', e => {
    if (e.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      const focused = $.searchResults().querySelector('.search-result.focused')
      if (focused) chooseSearchResult(focused.dataset.id, focused.dataset.map)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setSearchFocus(ui.searchFocusIdx + (e.key === 'ArrowDown' ? 1 : -1), true)
    }
  })
  document.addEventListener('pointerdown', e => {
    if (ui.searchOpen && !overlay.contains(e.target) && !e.target.closest('#searchBtn')) closeSearch({ restoreFocus: false })
  })
  overlay.addEventListener('wheel', e => e.stopPropagation(), { passive: true })
  window.addEventListener('pf:canvas-changed', () => {
    if (ui.searchOpen) refreshSearch()
  })
}

// ── Shortcuts overlay ────────────────────────────────────────
// Every binding the canvas has, by what it is for. The handlers live in
// events.js (and inline-edit.js, arrow-edit.js, context-menu.js,
// classify.js, command-palette.js, type-keys.js); a key added there has to
// be added here too, or nobody learns it exists. tests/integration.test.js
// checks the ones outside events.js are listed.
//
// A row is [key, what it does], plus { top, short, key? } on the dozen
// people reach for most: the row's place in the sheet's "Most used" list,
// the short line it shows there and, where the full key would wrap in that
// narrower column, a shorter one. The sheet opens on that list and the type
// letters; the rest wait behind "All shortcuts".
export const SHORTCUTS = [
  { group: 'Creating', keys: [
    ['N, then a letter',       'Add a block of that type at the pointer, or at the centre of the canvas (the letters are listed above)', { top: 2, short: 'New block of that type' }],
    ['/',                      'Open the command palette at Create'],
    ['Double-click canvas',    'Add a block where you click (right-click the canvas works too)'],
    ['Alt + Arrow',            'Add a connected block in that direction', { top: 4, short: 'Add a connected block' }],
    ['⌘/Ctrl + Enter',    'Add a connected block to the right'],
    ['Click a port ●',    'Add a connected block on that side'],
    ['Drag a port ●',     'Draw a connection; drop it on empty canvas to add a connected block there'],
    ['1 / 2 / 3',              'On an empty map: paste your notes, start from a template, or open the sample map'],
  ] },
  { group: 'Editing', keys: [
    ['Enter / F2',             'Edit the selected card’s title, or the selected connection’s label', { top: 3, short: 'Edit the title' }],
    ['Shift + Enter',          'Edit the selected card’s description'],
    ['Double-click card',      'Edit the title, or the description where you click'],
    ['Double-click line',      'Edit the connection’s label'],
    ['Tab / Shift + Tab (editing)', 'Keep what you typed and move between the title and the description'],
    ['Enter or Escape',        'Finish a title (Escape keeps what you typed); a description finishes with ⌘/Ctrl + Enter or Escape'],
    ['Arrow keys',             'Nudge the selected blocks 1px, a grid step when snapping (Shift nudges 10px)'],
    ['⌘/Ctrl + D',        'Duplicate the selected block'],
    ['Delete / Backspace',     'Delete the selected blocks or connection'],
    ['⌘/Ctrl + Z',        'Undo (add Shift to redo)', { top: 8, short: 'Undo (add Shift to redo)' }],
    ['Shift + F10 / Menu key', 'Quick actions for the selected card, the selection or the connection', { top: 7, short: 'Actions for the selection', key: 'Shift + F10' }],
    ['Right-click',            'Quick actions for a card, a connection or the canvas'],
    ['T',                      'Confirm or change the type of a card marked for a type check'],
    ['L',                      'Tidy: auto-arrange the canvas', { top: 10, short: 'Tidy the map' }],
  ] },
  { group: 'Navigation', keys: [
    ['⌘/Ctrl + K',        'Open the command palette: run any action, or jump to a block, map or template by name', { top: 1, short: 'Command palette: anything by name' }],
    ['Tab / Shift + Tab',      'Select the next or previous block in reading order; past the last one, leave the canvas', { top: 5, short: 'Next or previous block' }],
    ['⌘/Ctrl + Arrow',    'Select the nearest block in that direction, connected ones first', { top: 6, short: 'Nearest block that way' }],
    ['Enter / Space',          'Select the focused block'],
    ['Escape',                 'Deselect; press again to leave the canvas. Also closes overlays and ends dot voting'],
    ['Shift + click',          'Add a block to the selection'],
    ['Shift + drag',           'Select blocks inside a box'],
    ['⌘/Ctrl + A',        'Select every block'],
    ['⌘/Ctrl + F',        'Find blocks', { top: 9, short: 'Find blocks' }],
    ['Arrow keys',             'Pan the canvas when nothing is selected (Shift pans further)'],
    ['Space + drag',           'Pan the canvas, even over cards. Dragging empty canvas, the middle button and scrolling pan it too'],
  ] },
  { group: 'View', keys: [
    ['Shift + 1',              'Fit all blocks in view', { top: 11, short: 'Fit all blocks' }],
    ['Shift + 2',              'Zoom to the selection'],
    ['Shift + 0',              'Zoom to 100%'],
    ['= / -',                  'Zoom in / out'],
    ['⌘/Ctrl + = / - / 0','Zoom in / out / to 100% while the canvas has focus (elsewhere they zoom the page)'],
    ['Pinch / ⌘/Ctrl + scroll', 'Zoom at the pointer'],
    ['H',                      'Hide the header and footer'],
    ['Z',                      'Zen: hide every panel too'],
    ['M',                      'Show or hide the minimap'],
    ['Alt + 1 / 2 / 3',        'Show the Inspector, the Brief or the Attention tab, with the keyboard on it'],
    ['⌘/Ctrl + Shift + C',     'Copy the brief for the whole map (on a view-only link too)'],
    ['Alt + H',                'High-contrast mode'],
    ['?',                      'Show this help', { top: 12, short: 'This sheet' }],
  ] },
]

/**
 * The letter that follows N for each block type (js/type-keys.js), in
 * registry order. One letter per type and none shared: the type's initial
 * where it is free, else a letter from its name, so Risk is K (R is
 * Requirement), Process is W (a workflow step), Resource / System is Y and
 * Other is X. After N every key belongs to this map: T is Trigger / End,
 * not the type check, and L, which no type uses, adds nothing instead of
 * running Tidy.
 */
export const TYPE_KEYS = {
  goal: 'g', problem: 'p', stakeholder: 's', metric: 'm', requirement: 'r', output: 'o',
  implementation: 'i', process: 'w', terminator: 't', decision: 'd', resource: 'y',
  assumption: 'a', risk: 'k', question: 'q', context: 'c', custom: 'x',
}

// A view-only link cannot edit or create, so its sheet lists only the keys
// that work there instead of promising ones that do nothing.
const READ_ONLY_GROUPS = ['Navigation', 'View']

const sheetGroups = (readOnly = ui.readOnly) =>
  readOnly ? SHORTCUTS.filter(g => READ_ONLY_GROUPS.includes(g.group)) : SHORTCUTS

/** The sheet's "Most used" rows in order: { key, desc, top, group }. */
export function topShortcuts({ readOnly = ui.readOnly } = {}) {
  return sheetGroups(readOnly)
    .flatMap(g => g.keys.filter(k => k[2]?.top).map(k => ({ key: k[2].key || k[0], desc: k[2].short || k[1], top: k[2].top, group: g.group })))
    .sort((a, b) => a.top - b.top)
}

function shortcutRow(key, desc) {
  const row = document.createElement('div'); row.className = 'shortcut-row'
  const k = document.createElement('dt'); k.className = 'shortcut-key'; k.textContent = key
  const d = document.createElement('dd'); d.className = 'shortcut-desc'; d.textContent = desc
  row.append(k, d)
  return row
}

function shortcutSection(title, className = '') {
  const section = document.createElement('section')
  section.className = 'shortcut-section' + (className ? ' ' + className : '')
  const h = document.createElement('h3')
  h.className = 'shortcut-group'
  h.textContent = title
  section.appendChild(h)
  return section
}

// Whether "All shortcuts" is open, for this page view: the sheet reopens the
// way it was left.
let allShortcutsOpen = false

export function buildShortcutGrid() {
  const grid = $.shortcutGrid(); if (!grid) return
  grid.textContent = ''
  const note = document.createElement('p')
  note.className = 'shortcut-note'
  note.textContent = 'Single keys (letters, digits, =, -, arrows, Space) work while the canvas has focus: click it or press Tab to reach it.' +
    (ui.readOnly ? ' This is a view-only link, so editing keys are off.' : '')
  grid.appendChild(note)

  // The dozen keys people reach for every day come first.
  const top = shortcutSection('Most used', 'shortcut-top')
  const topList = document.createElement('dl')
  topList.className = 'shortcut-list shortcut-top-list'
  topShortcuts().forEach(r => topList.appendChild(shortcutRow(r.key, r.desc)))
  top.appendChild(topList)
  grid.appendChild(top)

  // The letters that follow N, each beside its type's dot in its shape.
  if (!ui.readOnly) {
    const keys = shortcutSection('After N: one letter per block type', 'shortcut-typekeys')
    const list = document.createElement('ul')
    list.className = 'shortcut-typekey-list'
    Object.keys(TYPES).filter(t => TYPE_KEYS[t]).forEach(t => {
      const li = document.createElement('li')
      li.className = 'shortcut-typekey'
      const k = document.createElement('kbd'); k.className = 'shortcut-key'; k.textContent = TYPE_KEYS[t].toUpperCase()
      const dot = document.createElement('span'); dot.className = 'pf-menu-dot'; dot.setAttribute('aria-hidden', 'true')
      if (TYPES[t].shape) dot.dataset.shape = TYPES[t].shape
      dot.style.background = ui.lightMode ? TYPES[t].light : TYPES[t].color
      const label = document.createElement('span'); label.className = 'shortcut-typekey-label'; label.textContent = TYPES[t].label
      li.append(k, dot, label)
      list.appendChild(li)
    })
    keys.appendChild(list)
    grid.appendChild(keys)
  }

  // Everything, by what it is for, behind one disclosure. Newspaper columns
  // (CSS) balance the groups; each key and its description share a row
  // wrapper that never splits across columns.
  const groups = sheetGroups()
  const all = document.createElement('details')
  all.className = 'shortcut-all'
  all.open = allShortcutsOpen
  all.addEventListener('toggle', () => { allShortcutsOpen = all.open })
  const summary = document.createElement('summary')
  summary.className = 'shortcut-all-toggle'
  summary.textContent = `All shortcuts (${groups.reduce((n, g) => n + g.keys.length, 0)})`
  const columns = document.createElement('div')
  columns.className = 'shortcut-columns'
  groups.forEach(({ group, keys }) => {
    const section = shortcutSection(group)
    const list = document.createElement('dl')
    list.className = 'shortcut-list'
    keys.forEach(([key, desc]) => list.appendChild(shortcutRow(key, desc)))
    section.appendChild(list)
    columns.appendChild(section)
  })
  all.append(summary, columns)
  grid.appendChild(all)
}

// Where focus was before the sheet opened, so closing it puts you back.
let shortcutsReturnFocus = null

// While the sheet is open the page behind it is inert. aria-modal on a div
// does not take the page out of a screen reader's browse mode, so the header
// and canvas controls were still there to wander into. Live regions stay
// live, so a toast behind the sheet is still read.
let inertBehind = []
function setPageInert(on) {
  inertBehind.forEach(el => { el.inert = false })
  inertBehind = []
  if (!on) return
  const overlay = $.shortcutOverlay()
  inertBehind = [...document.body.children].filter(el =>
    el !== overlay && !el.contains(overlay) && !el.inert && el.tagName !== 'SCRIPT' &&
    !el.hasAttribute('aria-live') && !['status', 'alert', 'log'].includes(el.getAttribute('role')))
  inertBehind.forEach(el => { el.inert = true })
}

export function openShortcuts() {
  const overlay = $.shortcutOverlay()
  if (overlay.style.display === 'none') {
    shortcutsReturnFocus = document.activeElement
    buildShortcutGrid()   // read-only may have changed since start-up
  }
  overlay.style.display = ''
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  setPageInert(true)
  // focusVisible: '?' after a click on the canvas left Firefox treating this
  // focus as a mouse one, and the close button showed no ring.
  requestAnimationFrame(() => document.getElementById('shortcutClose')?.focus({ focusVisible: true }))
}
export function closeShortcuts() {
  const overlay = $.shortcutOverlay()
  const wasOpen = overlay.style.display !== 'none'
  overlay.style.display = 'none'
  setPageInert(false)
  const back = shortcutsReturnFocus
  shortcutsReturnFocus = null
  if (wasOpen && back && back.isConnected && back !== document.body && typeof back.focus === 'function') {
    back.focus({ preventScroll: true })
  }
}

// Generic focus trap: keeps Tab within a container
function trapFocus(container, e) {
  if (e.key !== 'Tab') return
  const focusable = container.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')
  if (!focusable.length) return
  const first = focusable[0], last = focusable[focusable.length - 1]
  if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus() } }
  else { if (document.activeElement === last) { e.preventDefault(); first.focus() } }
}

let shortcutOverlayWired = false
export function setupShortcutOverlay() {
  const overlay = $.shortcutOverlay()
  if (shortcutOverlayWired || !overlay) return
  shortcutOverlayWired = true
  document.getElementById('shortcutClose')?.addEventListener('click', closeShortcuts)
  overlay.addEventListener('click', e => {
    if (e.target === $.shortcutOverlay()) closeShortcuts()
  })
  overlay.addEventListener('keydown', e => {
    // Escape closes the sheet and nothing else: without stopping here the
    // canvas's own Escape also cleared the selection behind it.
    if (e.key === 'Escape') { e.stopPropagation(); closeShortcuts(); return }
    const modal = $.shortcutOverlay().querySelector('.shortcut-modal')
    if (modal) trapFocus(modal, e)
  })
}

// ── Context field ────────────────────────────────────────────
// One or two lines of framing the assistant reads first (canvasMeta.
// contextBrief). It sits in the Brief tab's Situation, beside the other
// framing; the brief prints it before the map.
export function syncContextBrief() {
  const el = document.getElementById('contextBrief')
  if (el && el.value !== (canvasMeta.contextBrief || '')) el.value = canvasMeta.contextBrief || ''
  refreshFramingSummary()
}

export function setupContextBrief() {
  const el = document.getElementById('contextBrief')
  if (!el) return
  syncContextBrief()
  // Undoing a replace puts the map's own framing back (render.js undo).
  window.addEventListener('pf:meta-restored', () => { syncContextBrief(); refreshSituation() })
  if (ui.readOnly) { el.readOnly = true; return }
  el.addEventListener('input', () => {
    canvasMeta.contextBrief = el.value
    debouncedSave()
    refreshFramingSummary()
    ui.promptDirty = true
    if (ui.activeTab === 'prompt') refreshPrompt()
  })
}

// ── Panel tabs ───────────────────────────────────────────────
// The right panel's tabs, in order, with the key that shows each (Alt+1, 2,
// 3, matched on e.code in events.js) and its command palette row. Without
// them a keyboard reached the Brief only by walking every card: the tabs
// are one Tab stop (a roving tabindex) after the whole canvas.
export const PANEL_TABS = [
  { tab: 'inspector', label: 'Show inspector', key: '1' },
  { tab: 'prompt',    label: 'Show brief',     key: '2' },
  { tab: 'attention', label: 'Show attention', key: '3' },
]
let showTabImpl = null

/**
 * Show a panel tab and (by default) put the keyboard on it: the panel opens
 * if it was collapsed, hidden by Zen, or a phone sheet at its peek.
 */
export function showPanelTab(tab, { focus = true } = {}) {
  const btn = document.getElementById('tab-' + tab)
  if (!showTabImpl || !btn || ui.embed) return false
  showPanels()
  const panel = document.getElementById('rightPanel')
  if (panel?.classList.contains('collapsed')) document.getElementById('panelReopenBtn')?.click()
  if (panel?.dataset.sheet === 'peek' && window.matchMedia?.('(max-width: 700px)').matches) {
    document.getElementById('sheetHandle')?.click()
  }
  showTabImpl(tab)
  if (focus) btn.focus({ preventScroll: true })
  return true
}

export function setupPanelTabs() {
  const tabs = [...document.querySelectorAll('.panel-tab')]
  const tablist = document.querySelector('.panel-tablist') || document.querySelector('.panel-tabs')
  tablist.setAttribute('role', 'tablist')
  tablist.setAttribute('aria-label', 'Plan details')
  tabs.forEach(button => {
    const name = button.dataset.tab
    button.id = 'tab-' + name
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-controls', name + 'Pane')
    const pane = document.getElementById(name + 'Pane')
    pane.setAttribute('role', 'tabpanel')
    pane.setAttribute('aria-labelledby', button.id)
  })
  function showTab(tab) {
    ui.activeTab = tab
    tabs.forEach(button => {
      const active = button.dataset.tab === tab
      button.classList.toggle('active', active)
      button.setAttribute('aria-selected', String(active))
      button.tabIndex = active ? 0 : -1
    })
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id===tab+'Pane'))
    if (tab === 'prompt') { ui.promptDirty = true; refreshPrompt() }
  }
  showTabImpl = showTab
  document.querySelectorAll('.panel-tab').forEach(btn =>
    btn.addEventListener('click', () => showTab(btn.dataset.tab))
  )
  tablist.addEventListener('keydown', event => {
    if (!event.target.matches('.panel-tab')) return
    const index = tabs.indexOf(event.target)
    const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault(); event.stopPropagation()
    tabs[next].focus(); showTab(tabs[next].dataset.tab)
  })
  showTab(ui.activeTab)
}

// ── Mode descriptions ────────────────────────────────────────
// One plain line per mode, under the mode control, so the choice is not a
// guess. Each says what the assistant is asked to hand back.
const MODE_DESCS = {
  investigate: 'Establish what is true first: evidence for each finding, unknowns left marked as unknown.',
  explore: 'Find the gaps and the risky assumptions, and ask instead of proposing fixes.',
  plan:    'A phased plan with a concrete output for each phase.',
  build:   'Work the checklist in dependency order and write the code.',
  clarify: 'Prioritized clarifying questions, each tied to a block, before anything is planned.',
}

export function refreshModeDesc() {
  const el = document.getElementById('modeDesc')
  if (el) el.textContent = MODE_DESCS[devOpts.mode] || MODE_DESCS.plan
}

// ── The framing summary ──────────────────────────────────────
// The Situation, read back as one line ("This repo, Claude Code, read the
// code first"), so the Brief tab's Framing row says what the brief assumes
// without being opened.

const FRAMING_WORDS = {
  codebase: { none: 'No code yet', current: 'This repo', other: 'Code elsewhere', greenfield: 'Greenfield' },
  runtime: { chat: 'in a chat', code: 'in Claude Code', ide: 'in an IDE' },
  firstMove: { read: 'read the code first', ask: 'ask questions first', plan: 'propose a plan first', act: 'start work directly' },
}

export function framingSummary(situation = canvasMeta.situation, contextBrief = canvasMeta.contextBrief) {
  const sit = { ...SITUATION_DEFAULT, ...(situation || {}) }
  const word = (field, key) => FRAMING_WORDS[field][key] || SITUATION_FIELDS[field]?.options?.[key]?.label || key
  let out = [word('codebase', sit.codebase), word('runtime', sit.runtime), word('firstMove', sit.firstMove)].join(', ')
  const bounds = (sit.constraints || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).length
  const extras = []
  if (bounds) extras.push(`${bounds} boundar${bounds === 1 ? 'y' : 'ies'}`)
  if ((contextBrief || '').trim()) extras.push('context')
  if (extras.length) out += `; ${extras.join(', ')}`
  return out
}

/** Write the Framing row's one-line summary (and, view-only, the values). */
export function refreshFramingSummary() {
  syncReadonlyValues()
  const el = document.getElementById('briefFramingSummary'); if (!el) return
  const text = framingSummary()
  el.textContent = text
  el.closest('button')?.setAttribute('title', `Framing: ${text}`)
}

/**
 * On a view-only link the framing's text fields are the author's values:
 * each shows as text after its label ("none" when empty), not as a box
 * that looks like it takes typing.
 */
const READONLY_FIELDS = ['situationRepoHint', 'situationConstraints', 'contextBrief', 'docsBaseInput']
export function syncReadonlyValues() {
  if (!ui.readOnly) return
  READONLY_FIELDS.forEach(id => {
    const input = document.getElementById(id); if (!input) return
    input.hidden = true
    let shown = input.nextElementSibling?.matches?.('.brief-value[data-value-for]') ? input.nextElementSibling : null
    if (!shown) {
      shown = document.createElement('p')
      shown.className = 'brief-value'
      shown.dataset.valueFor = id
      input.after(shown)
    }
    const v = (input.value || '').trim()
    shown.textContent = v || 'none'
    shown.classList.toggle('is-none', !v)
  })
}

// ── Situation ────────────────────────────────────────────────

/**
 * The engagement setup: what code exists, what the assistant can reach, and
 * what it should do first. Rendered from SITUATION_FIELDS so the control and
 * the sentence it produces cannot drift apart. The brief below shows the
 * lines it contributes, and the Framing row reads it back in one line.
 * On a view-only link it is the author's framing: shown, not changed.
 */
export function setupSituation() {
  const host = document.getElementById('situationFields')
  const repo = document.getElementById('situationRepoHint')
  const cons = document.getElementById('situationConstraints')
  if (!host) return
  const locked = ui.readOnly
  if (locked) { if (repo) repo.readOnly = true; if (cons) cons.readOnly = true }

  const paint = () => {
    const sit = { ...SITUATION_DEFAULT, ...(canvasMeta.situation || {}) }
    // View-only: each row reads "Label  chosen value", with no choices.
    if (locked) {
      host.innerHTML = Object.entries(SITUATION_FIELDS).map(([key, field]) => `
        <div class="situation-row is-value">
          <div class="brief-field-label situation-row-label">${escHtml(field.label)}</div>
          <p class="brief-value" data-situation-shown="${key}">${escHtml(field.options[sit[key]]?.label || 'none')}</p>
        </div>`).join('')
      if (repo) repo.value = sit.repoHint || ''
      if (cons) cons.value = sit.constraints || ''
      refreshSituationPreview()
      return
    }
    // Rebuilding the buttons drops focus to the page: put it back on the
    // same choice, so a keyboard user stays where they were.
    const had = host.contains(document.activeElement) && document.activeElement.closest('[data-situation-value]')
    const back = had && [had.closest('[data-situation]')?.dataset.situation, had.dataset.situationValue]
    host.innerHTML = Object.entries(SITUATION_FIELDS).map(([key, field]) => `
      <div class="situation-row">
        <div class="brief-field-label situation-row-label" id="situation-${key}-label">${escHtml(field.label)}
          <span class="brief-hint">${escHtml(field.hint)}</span></div>
        <div class="dev-radio-group" data-situation="${key}" data-count="${Object.keys(field.options).length}" role="group" aria-labelledby="situation-${key}-label">
          ${Object.entries(field.options).map(([val, opt]) =>
            `<button type="button" class="radio-opt${sit[key] === val ? ' active' : ''}" data-situation-value="${val}"
                     aria-pressed="${sit[key] === val}"${locked ? ' aria-disabled="true"' : ''} title="${escHtml(opt.line)}">${escHtml(opt.label)}</button>`).join('')}
        </div>
      </div>`).join('')
    if (back) host.querySelector(`[data-situation="${back[0]}"] [data-situation-value="${back[1]}"]`)?.focus({ preventScroll: true })
    if (repo && document.activeElement !== repo) repo.value = sit.repoHint || ''
    if (cons && document.activeElement !== cons) cons.value = sit.constraints || ''
    refreshSituationPreview()
  }

  host.addEventListener('click', e => {
    if (locked) return
    const btn = e.target.closest('[data-situation-value]'); if (!btn) return
    const key = btn.closest('[data-situation]')?.dataset.situation; if (!key) return
    canvasMeta.situation = { ...SITUATION_DEFAULT, ...(canvasMeta.situation || {}), [key]: btn.dataset.situationValue }
    paint(); saveState(); syncPresetButtons(); ui.promptDirty = true; refreshPrompt()
  })

  const bindText = (el, key) => el && !locked && el.addEventListener('input', () => {
    canvasMeta.situation = { ...SITUATION_DEFAULT, ...(canvasMeta.situation || {}), [key]: el.value }
    refreshSituationPreview(); debouncedSave(); ui.promptDirty = true; refreshPrompt()
  })
  bindText(repo, 'repoHint')
  bindText(cons, 'constraints')

  paint()
  syncSituation = paint
}

let syncSituation = () => {}
export function refreshSituation() { syncSituation(); syncPresetButtons() }

/**
 * The situation's one-line read-back on the Framing row. (It used to be a
 * preview box of the exact lines; the brief below now shows those lines in
 * place, so the box said everything twice.)
 */
export function refreshSituationPreview() { refreshFramingSummary() }

// ── Prompt options and presets ───────────────────────────────
function syncRadioAria(groupEl) {
  groupEl.querySelectorAll('.radio-opt').forEach(b =>
    b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false')
  )
}

/**
 * One-click presets: a bundle of mode, where the brief will run, and the
 * prompt options, for the common hand-overs. A preset sets the same fields
 * the controls do, nothing more: "Build in Claude Code" picks Claude Code
 * under Running in, so the two can never disagree about where it runs.
 */
export const PRESETS = {
  'claude-code': { label: 'Build in Claude Code', runtime: 'code', mode: 'build', tone: 'auto', detail: 'standard', pre: ['tasks', 'errors', 'edge'] },
  'cursor-ts':   { label: 'Build in Cursor, TypeScript', runtime: 'ide', mode: 'build', tone: 'technical', detail: 'standard', pre: ['typescript', 'tasks', 'docs'] },
  'pm-clarify':  { label: 'Clarify in a chat', runtime: 'chat', mode: 'clarify', tone: 'formal', detail: 'standard', pre: [] },
}

/** Whether the current options are exactly what a preset sets. */
export function presetMatches(key, opts = devOpts, situation = canvasMeta.situation) {
  const pz = PRESETS[key]; if (!pz) return false
  const runtime = { ...SITUATION_DEFAULT, ...(situation || {}) }.runtime
  const pre = [...(opts.prePrompts || [])].sort().join(',')
  return opts.mode === pz.mode && opts.tone === pz.tone && opts.detail === pz.detail &&
    runtime === pz.runtime && pre === [...pz.pre].sort().join(',')
}

/** Apply a preset: one save, the controls and the brief follow. */
export function applyPreset(key) {
  const pz = PRESETS[key]; if (!pz || ui.readOnly) return false
  devOpts.mode = pz.mode; devOpts.tone = pz.tone; devOpts.detail = pz.detail
  devOpts.prePrompts = new Set(pz.pre)
  canvasMeta.situation = { ...SITUATION_DEFAULT, ...(canvasMeta.situation || {}), runtime: pz.runtime }
  syncSituation()
  syncPromptOptControls()
  debouncedSave()
  return true
}

function syncPresetButtons() {
  document.querySelectorAll('#promptPresets .preset-opt').forEach(b =>
    b.setAttribute('aria-pressed', presetMatches(b.dataset.preset) ? 'true' : 'false'))
}

export function setupDevOptions() {
  // Set initial aria-pressed on all radio groups
  document.querySelectorAll('.dev-radio-group').forEach(g => syncRadioAria(g))
  const locked = ui.readOnly

  // A real button, so Tone, Detail and the rest are reachable by keyboard.
  const devHeader = document.getElementById('devOptionsHeader')
  devHeader.addEventListener('click', () => {
    const open = document.getElementById('devOptions').classList.toggle('open')
    devHeader.setAttribute('aria-expanded', open ? 'true' : 'false')
  })
  // Tone, detail and the extras are the author's choices: on a view-only
  // link they show, they do not change. The mode stays live there: it is a
  // way of reading the same map.
  if (locked) {
    // Shown as values: the chosen option reads as text (the rest are not
    // drawn) and is out of the tab order; presets, being actions, go.
    document.querySelectorAll('#toneGroup .radio-opt, #detailGroup .radio-opt, #prePromptGroup .check-opt, #promptPresets .preset-opt')
      .forEach(b => { b.setAttribute('aria-disabled', 'true'); b.tabIndex = -1 })
    const presets = document.getElementById('presetsSection'); if (presets) presets.hidden = true
    const docs = document.getElementById('docsBaseInput'); if (docs) docs.readOnly = true
  }
  document.getElementById('toneGroup').addEventListener('click', e => {
    const btn = e.target.closest('.radio-opt'); if (!btn || locked) return
    document.querySelectorAll('#toneGroup .radio-opt').forEach(b => b.classList.remove('active'))
    btn.classList.add('active'); devOpts.tone = btn.dataset.value
    syncRadioAria(document.getElementById('toneGroup'))
    syncPresetButtons()
    debouncedSave()
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })
  document.getElementById('detailGroup').addEventListener('click', e => {
    const btn = e.target.closest('.radio-opt'); if (!btn || locked) return
    document.querySelectorAll('#detailGroup .radio-opt').forEach(b => b.classList.remove('active'))
    btn.classList.add('active'); devOpts.detail = btn.dataset.value
    syncRadioAria(document.getElementById('detailGroup'))
    syncPresetButtons()
    debouncedSave()
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })
  document.getElementById('modeGroup').addEventListener('click', e => {
    const btn = e.target.closest('.radio-opt'); if (!btn) return
    document.querySelectorAll('#modeGroup .radio-opt').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    devOpts.mode = btn.dataset.value
    syncRadioAria(document.getElementById('modeGroup'))
    refreshModeDesc()
    syncPresetButtons()
    debouncedSave()
    ui.promptDirty = true; refreshPrompt()
  })
  refreshModeDesc()

  // Docs base URL: powers inline doc previews for pages under this origin/path.
  const docsBaseInput = document.getElementById('docsBaseInput')
  if (docsBaseInput) {
    docsBaseInput.value = getDocsBase()
    if (!locked) docsBaseInput.addEventListener('input', () => setDocsBase(docsBaseInput.value))
  }

  document.getElementById('prePromptGroup').addEventListener('click', e => {
    const btn = e.target.closest('.check-opt'); if (!btn || locked) return
    btn.classList.toggle('active')
    btn.classList.contains('active') ? devOpts.prePrompts.add(btn.dataset.value)
                                     : devOpts.prePrompts.delete(btn.dataset.value)
    btn.setAttribute('aria-pressed', btn.classList.contains('active') ? 'true' : 'false')
    syncPresetButtons()
    debouncedSave()
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })

  document.getElementById('promptPresets')?.addEventListener('click', e => {
    const btn = e.target.closest('.preset-opt'); if (!btn || locked) return
    const pz = PRESETS[btn.dataset.preset]
    if (!applyPreset(btn.dataset.preset)) return
    const runtime = SITUATION_FIELDS.runtime.options[pz.runtime]?.label || pz.runtime
    showToast(`${pz.label}: ${pz.mode} mode, running in ${runtime}${pz.pre.length ? `, ${pz.pre.length} extras` : ''}`, 'success', 2000)
  })

  // A replace (share link, import, Maps switch) can change the options under
  // the controls; resync them. Also run once so a loaded canvas is reflected.
  window.addEventListener('pf:prompt-opts-changed', syncPromptOptControls)
  syncPromptOptControls()
}

/** Reflect devOpts into the Brief tab controls (mode, tone, detail, extras, presets). */
export function syncPromptOptControls() {
  syncModeButtons()
  const setRadio = (groupId, val) => {
    const g = document.getElementById(groupId); if (!g) return
    g.querySelectorAll('.radio-opt').forEach(b => {
      const on = b.dataset.value === val
      b.classList.toggle('active', on)
      b.setAttribute('aria-pressed', on ? 'true' : 'false')
    })
  }
  setRadio('toneGroup', devOpts.tone)
  setRadio('detailGroup', devOpts.detail)
  document.querySelectorAll('#prePromptGroup .check-opt').forEach(b => {
    const on = devOpts.prePrompts.has(b.dataset.value)
    b.classList.toggle('active', on)
    b.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
  syncPresetButtons()
  refreshModeDesc()
  ui.promptDirty = true
  if (ui.activeTab === 'prompt') refreshPrompt()
}

// ── Copy the brief ───────────────────────────────────────────
// The Brief tab (js/brief.js, set up from app.js) owns Copy, its
// confirmation, the status bar's copy button and Cmd/Ctrl+Shift+C. It is
// imported by app.js alone: brief.js reads the Attention tab's model, and
// importing it from here put attention.js inside gaps.js's own evaluation.

// copyText now lives in utils.js; re-exported so existing importers keep working.
export { copyText }

// Keep the quick action quiet; what is open and what goes out live in the Brief tab.
export function refreshQuickCopy() {
  const button = document.getElementById('copyPromptPill')
  if (!button) return
  button.hidden = ui.readOnly || ui.embed
  button.disabled = !Object.keys(state.blocks).length
}

/**
 * The status bar's copy button: its name and whether it can act. Its click
 * is wired by js/brief.js (setupBrief): always the whole map, with the same
 * confirmation as the Brief tab's Copy.
 */
export function setupQuickCopy() {
  if (!document.getElementById('copyPromptPill')) return
  window.addEventListener('pf:canvas-changed', refreshQuickCopy)
  window.addEventListener('pf:save-status', refreshQuickCopy)
  refreshQuickCopy()
}

/**
 * The File menu's actions. Each row in #fileActions is wired here by id. The
 * menu itself (fileMenuItems in js/view-menu.js) renders those rows through
 * menu.js and clicks the one you pick, so these listeners stay the one place
 * each export runs, whoever triggers it.
 */
export function setupExportDropdown() {
  const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn)

  // The whole map's brief, through the Brief tab's own Copy (js/brief.js),
  // so File says what went the same way the tab and the status bar do.
  on('exportCopyPrompt', () => window.dispatchEvent(new CustomEvent('pf:copy-brief', { detail: { scope: 'map' } })))

  on('copyDiagramInstructions', () => {
    copyText(DIAGRAM_BUILDER_PROMPT).then(ok => {
      showToast(ok
        ? 'AI diagram-builder prompt copied: paste it into Claude, add your topic, then Import the JSON'
        : 'Copy failed: try again', ok ? 'success' : 'warning')
    })
  })

  on('exportJSON', () => exportJSON())
  on('exportMarkdown', () => exportMarkdown())
  on('exportSpecBundle', () => exportSpecBundle())

  // The same graph the Markdown export carries (interop.js toMermaid): it
  // pastes into a README, an issue or Obsidian and reads back into Pathfinder.
  on('exportMermaid', () => {
    const graph = toMermaid()
    if (!graph) { showToast('Add a block first', 'warning'); return }
    copyText(graph).then(ok => showToast(ok
      ? 'Mermaid copied: it renders on GitHub and imports back into Pathfinder'
      : 'Copy failed: try again', ok ? 'success' : 'warning'))
  })

  on('exportJsonCanvas', () => {
    if (!Object.keys(state.blocks).length) { showToast('Add a block first', 'warning'); return }
    downloadJsonCanvas()
    showToast('JSON Canvas downloaded: it opens in Obsidian and friends', 'success')
  })

  on('exportPNG', () => exportPNG(2))
  on('exportSVG', () => exportSVG())

  // The File button used to flash "Exported!" in place of its own label,
  // which clobbered the label's markup. A toast says the same thing.
  on('exportMeetingSummary', () => {
    exportMeetingSummary()
    showToast('Meeting summary exported', 'success', 1500)
  })

  on('exportToPresentationSage', () => exportToPresentationSage())

  on('importJSON', () => {
    if (ui.readOnly) return
    const input = document.getElementById('importFile')
    if (!input) return
    input.value = ''
    input.click()
  })
}

// ── Share menu ───────────────────────────────────────────────
// The rows' actions. The Share button opens them through menu.js
// (shareMenuItems in js/view-menu.js), which clicks the row you pick.
export function setupShareDropdown() {
  const shareCopy = (text, okMsg) => copyText(text).then(ok =>
    showToast(ok ? okMsg : 'Copy failed: try again', ok ? 'success' : 'warning'))
  document.getElementById('shareCopyLink')?.addEventListener('click', () => {
    shareCopy(buildShareUrl(false), 'Link copied!')
  })
  document.getElementById('shareCopyReadOnly')?.addEventListener('click', () => {
    shareCopy(buildShareUrl(true), 'View-only link copied!')
  })
  document.getElementById('shareCopyEmbed')?.addEventListener('click', () => {
    const src = buildEmbedUrl()
    const snippet = `<iframe src="${src}" width="800" height="500" style="border:none;border-radius:12px" allowfullscreen></iframe>`
    shareCopy(snippet, 'Embed code copied!')
  })
}

// ── Import result toast ──────────────────────────────────────
function reportImport(imported, dropped, mode = 'replace') {
  const skipped = dropped.blocks + dropped.arrows + dropped.groups
  if (!imported && !skipped) { showToast('Nothing to import', 'warning'); return }
  let msg = `Imported ${imported} block${imported === 1 ? '' : 's'}`
  if (mode === 'new') msg += ' as a new map'
  else if (mode === 'merge') msg += ' into your map'
  if (skipped) {
    const parts = []
    if (dropped.blocks) parts.push(`${dropped.blocks} block${dropped.blocks === 1 ? '' : 's'}`)
    if (dropped.arrows) parts.push(`${dropped.arrows} connection${dropped.arrows === 1 ? '' : 's'}`)
    if (dropped.groups) parts.push(`${dropped.groups} group${dropped.groups === 1 ? '' : 's'}`)
    msg += `, skipped ${parts.join(', ')}`
  }
  if (mode === 'new') msg += '. Your previous map is under Maps'
  showToast(msg, skipped ? 'warning' : 'success', mode === 'new' ? 3600 : 3000)
}

/**
 * Turn the text of an imported file or a ?src= response into a canvas.
 * One reader, three formats: pathfinder JSON, JSON Canvas (.canvas, an
 * { nodes, edges } object), or a Mermaid flowchart. Returns
 * { data, low, format } or { error } with a message fit for a toast.
 */
function parseIncomingText(text) {
  const fmt = detectFormat(text)
  if (!fmt) return { error: 'Could not read it: not JSON, JSON Canvas, or a Mermaid flowchart' }
  if (fmt === 'mermaid') {
    const r = parseMermaid(text)
    if (!r.payload.blocks.length) return { error: 'No flowchart nodes found in it' }
    return { data: r.payload, low: r.lowConfidence, format: fmt }
  }
  const json = JSON.parse(text)
  if (fmt === 'canvas') {
    const r = fromJsonCanvas(json)
    if (!r.payload.blocks.length) return { error: 'That canvas has no nodes in it' }
    return { data: r.payload, low: r.lowConfidence, format: fmt }
  }
  if (json && json.format === 'pathfinder-maps') return { error: 'That file holds several maps: use Maps, Import maps' }
  if (!json || (!json.blocks && !json.arrows)) return { error: 'There is no canvas in it' }
  return { data: json, low: [], format: fmt }
}

// Converted formats go through the classifier; the calls it was unsure of
// are flagged for a person to confirm.
function flagLowConfidence(low, idMap) {
  if (!low.length) return
  window.dispatchEvent(new CustomEvent('pf:show-type-chips', {
    detail: low.map(id => ({ id: (idMap && idMap[id]) || id, confidence: 'low' })),
  }))
}

// ── Import file handler ──────────────────────────────────────
// A file that arrives while a map is open offers "Open as a new map"
// first, never a bare replace (sharing.js openIncoming).
export function setupImportHandler() {
  document.getElementById('importFile').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      let parsed
      try { parsed = parseIncomingText(ev.target.result) }
      catch (_) { parsed = { error: 'Could not read file: the JSON is malformed' } }
      if (parsed.error) { showToast(parsed.error, 'error'); return }
      openIncoming(parsed.data, { source: 'file', name: file.name }).then(r => {
        if (!r) return
        reportImport(r.imported, r.dropped, r.mode)
        flagLowConfidence(parsed.low, r.idMap)
      })
    }
    reader.onerror = () => showToast('Could not read file', 'error')
    reader.readAsText(file)
  })
}

// ── Canvas-wide card style ───────────────────────────────────

/**
 * The default look for every block that has not overridden it. Lives on the
 * canvas (not in ui) so it travels with a share link and an exported JSON:
 * a diagram someone else opens should look like the one you sent.
 * The control is View > Card style (js/view-menu.js).
 */
export function setCanvasCardStyle(key) {
  if (!CARD_STYLES[key] || ui.readOnly) return false
  // A map setting, so one undo step (the step carries it: state.js undoEntry).
  if ((canvasMeta.cardStyle || DEFAULT_CARD_STYLE) !== key) snapshot()
  canvasMeta.cardStyle = key
  renderAllBlocks(); renderArrows({ cheap: false }); renderFrames()
  renderInspector()
  saveState()
  showToast(`Cards set to ${CARD_STYLES[key].label}`, 'success', 1500)
  return true
}

/** The current canvas-wide preset, falling back to the default. */
export function canvasCardStyle() { return canvasMeta.cardStyle || DEFAULT_CARD_STYLE }

// The View menu reads canvasMeta each time it opens, so there is no header
// control left to wire or repaint. Both stay exported for their callers.
export function setupCardStyles() {}
export function refreshCardStyles() {}

/** Spotlight rides on the canvas, so an imported one arrives already on. */
export function refreshSpotlight() {
  document.body.classList.toggle('spotlight', !!canvasMeta.spotlight)
}

// ── Tidy (auto-layout) ───────────────────────────────────────

const DIR_KEY = 'pathfinder-layout-dir'
let layoutDir = 'LR'
try { const d = localStorage.getItem(DIR_KEY); if (d === 'LR' || d === 'TB') layoutDir = d } catch (_) {}

// The caret names the direction Tidy will use. It no longer flips it on
// click: a preference that silently re-laid the map was an action in disguise.
function refreshDirButton() {
  const label = layoutDir === 'LR' ? 'left to right' : 'top to bottom'
  const caret = document.getElementById('tidyMenuBtn')
  if (caret) {
    caret.title = 'Tidy direction: ' + label
    caret.setAttribute('aria-label', 'Tidy direction, now ' + label)
  }
  const main = document.getElementById('tidyBtn')
  if (main) main.title = `Arrange the map ${label} and re-point every connection along the flow (L)`
}

export function getLayoutDir() { return layoutDir }

/** Remember the direction Tidy lays out in ('LR' or 'TB'). Does not run it. */
export function setLayoutDir(dir) {
  if (dir !== 'LR' && dir !== 'TB') return false
  layoutDir = dir
  try { localStorage.setItem(DIR_KEY, layoutDir) } catch (_) {}
  refreshDirButton()
  return true
}

/**
 * Re-lay the canvas and bring every block to its new home.
 *
 * Positions land in one undo step (tidyCanvas takes the snapshot), so Cmd+Z
 * restores the whole arrangement. With Animate highlights on, the cards
 * slide there on a transform while the lines step aside, and the camera
 * eases to the fit in the same 200ms (zoom-controls.js animateTidy); with
 * motion off (the default) it is all instant.
 */
// `snapshot: false` is for a caller that already took this action's undo
// step. Listeners pass an Event here, which has no `snapshot`: the default.
// `arrive` (blocks and an arriveAt lead) lands the camera on them instead of
// the whole-map fit: a template arranges itself on arrival. A map with no
// connections comes back in step columns, which spread wide, so it lands at
// a readable zoom too, with the summary as the arrival's toast.
export function runTidy({ snapshot: takeSnapshot = true, arrive = null } = {}) {
  if (ui.readOnly) return
  const count = Object.keys(state.blocks).length
  if (count < 2) { showToast('Add at least two blocks to arrange', 'info', 1600); return }

  const before = positionsNow()
  const tidied = tidyCanvas({ direction: layoutDir, snapshot: takeSnapshot !== false })
  renderAllBlocks()
  renderFrames()

  saveState()
  ui.promptDirty = true
  runGapDetection()
  // The summary also counts lines left under a card (layout.js).
  const summary = tidySummary(tidied, count, layoutDir, undoKeyLabel())
  if (!arrive && tidied.mode === 'steps' && tidied.moved) arrive = { ids: null, lead: summary }
  else showToast(summary, 'success', 2600)

  const settle = () => {
    renderArrows({ cheap: false })
    renderFrames()
    window.dispatchEvent(new CustomEvent('pf:canvas-changed'))
  }
  const sliding = animateTidy(before, settle) > 0
  if (!sliding) {
    if (arrive) arriveAt(arrive.ids, { lead: arrive.lead })
    else fitView()
    return
  }
  // The camera moves with the cards, to where it will end up.
  if (arrive) arriveAt(arrive.ids, { lead: arrive.lead, animate: true })
  else { const t = fitTarget(); if (t) animateView(t.panX, t.panY, t.zoom, TIDY_MS) }
}

export function setupTidy() {
  refreshDirButton()
  document.getElementById('tidyBtn')?.addEventListener('click', runTidy)
  // The caret's direction menu is wired with the other header menus in
  // js/view-menu.js (setupViewMenu).
}


/**
 * Clear the active map: every block, connection and group, as one undo step.
 * Group frames are .frame elements in their own layer, which renderFrames()
 * prunes once the groups are gone; the old code removed .group-frame, which
 * never existed, so the frames stayed on screen.
 */
export function clearCanvas({ ask = true } = {}) {
  if (ui.readOnly) return false
  // Nothing to clear: no question to answer, and no undo step that would
  // make the next Cmd+Z look like it did nothing.
  if (!Object.keys(state.blocks).length && !state.arrows.length && !Object.keys(state.groups || {}).length) {
    showToast('This map is already empty', 'info', 1500)
    return false
  }
  // No confirm (a native one stopped the page): clearing is one undo step,
  // and the toast says so and offers it.
  snapshot()
  state.blocks = {}; state.arrows = []; state.groups = {}
  selection.ids.clear(); selection.blockId = null; selection.arrowId = null; selection.groupId = null
  renderAllBlocks()
  renderFrames()
  renderArrows({ cheap: false })
  runGapDetection()
  renderInspector(); updateHint(); saveState()
  ui.promptDirty = true; if (ui.activeTab === 'prompt') refreshPrompt()
  window.dispatchEvent(new CustomEvent('pf:canvas-changed'))
  if (ask) showToast(`Map cleared. ${undoKeyLabel()} brings it back.`, 'info', 6000, { action: { label: 'Undo', run: () => undo() } })
  return true
}

// Theme, snapping, pinned ports, connection notes, motion and card style all
// live in View now (js/view-menu.js); Fit moved to the status bar. What is left
// here is the File menu's Clear row.
export function setupHeaderButtons() {
  document.getElementById('clearBtn')?.addEventListener('click', () => clearCanvas())
  // A view-only link was a dead end: nothing could be edited or copied.
  // Edit a copy reopens the same link without ?readonly, which arrives like
  // any share link: as a new map of the visitor's own, never over theirs.
  const copy = document.getElementById('editCopyBtn')
  if (copy) {
    copy.hidden = !canEditACopy()
    copy.addEventListener('click', () => location.assign(editCopyUrl()))
  }
}

/** True on a view-only link that carries a map (a #z= / #s= hash or ?src=), outside an embed. */
export function canEditACopy(loc = location) {
  const params = new URLSearchParams(loc.search)
  return !!(ui.readOnly && !ui.embed && (/^#[sz]=/.test(loc.hash) || params.has('src')))
}

/** The same link without ?readonly: the map arrives editable, as a new map. */
export function editCopyUrl(href = location.href) {
  const u = new URL(href)
  u.searchParams.delete('readonly')
  return u.toString()
}

// An edit on a view-only link used to do nothing and say nothing. Said once
// every few seconds at most, never in an embed (someone else's page).
let viewOnlySaidAt = -Infinity
export function sayViewOnly() {
  if (!ui.readOnly || ui.embed) return false
  const now = performance.now()
  if (now - viewOnlySaidAt < 4000) return false
  viewOnlySaidAt = now
  showToast(canEditACopy() ? 'View only. Edit a copy to change it.' : 'View only.', 'info', 3200)
  return true
}

export function applyTheme() {
  document.body.classList.toggle('light-mode', ui.lightMode)
  // Re-render arrows to swap marker refs and color defaults
  applyTransform()
  renderArrows()
}

// ── Right panel collapse ─────────────────────────────────────
export function setupPanelCollapse() {
  const panel   = document.getElementById('rightPanel')
  const collapse = document.getElementById('panelCollapseBtn')
  const reopen   = document.getElementById('panelReopenBtn')
  if (!panel || !collapse || !reopen) return

  const setCollapsed = on => {
    panel.classList.toggle('collapsed', on)
    collapse.setAttribute('aria-expanded', String(!on))
    if (on) reopen.focus({ preventScroll: true })
    else collapse.focus({ preventScroll: true })
    try { localStorage.setItem('pathfinder-panel-collapsed', on ? '1' : '0') } catch(_) {}
  }
  // Restore persisted state (embed/readonly hides the panel entirely already).
  try { if (localStorage.getItem('pathfinder-panel-collapsed') === '1') { panel.classList.add('collapsed'); collapse.setAttribute('aria-expanded', 'false') } } catch(_) {}

  collapse.addEventListener('click', () => setCollapsed(true))
  reopen.addEventListener('click', () => setCollapsed(false))
}

// ── Palette sections & collapse ──────────────────────────────
/**
 * Open or fold a palette section, and remember it.
 *
 * Exported because the canvas drives it too: once you have blocks, Templates
 * has done its job and the block list is what you reach for.
 */
export function setPaletteSection(sectionId, open) {
  const section = document.getElementById(sectionId); if (!section) return
  section.classList.toggle('collapsed', !open)
  const content = section.querySelector('.palette-section-body')
  if (content) content.inert = !open && !window.matchMedia('(max-width: 768px)').matches
  section.querySelector('.palette-section-toggle')?.setAttribute('aria-expanded', open ? 'true' : 'false')
  if (!ui.readOnly) {
    try { localStorage.setItem('pathfinder-pal-' + sectionId, open ? '1' : '0') } catch (_) {}
  }
}

/**
 * Fold Templates away, but only if the user has not already opened it by
 * hand. Content arriving in bulk (a template, a shared map, another map)
 * also folds the palette to its rail, on the same terms (setPaletteRail).
 */
export function collapseTemplatesAfterUse() {
  if (ui.readOnly) return
  autoPaletteRail(true)
  let pinned = null
  try { pinned = localStorage.getItem('pathfinder-pal-templatesSection') } catch (_) {}
  if (pinned === '1') return
  setPaletteSection('templatesSection', false)
  try { localStorage.removeItem('pathfinder-pal-templatesSection') } catch (_) {}
}

// ── The palette rail ──
// Once a map has content the palette has done most of its job, and the map
// is the interface: with no choice of the person's own, a map with blocks
// shows the palette as its 48px rail (a dot per type, each still a button,
// draggable, named on hover and focus), and an empty map shows it whole.
// The collapse button records a choice ('1' rail, '0' open) that always
// wins. Only on wide windows: narrower ones get the rail (1024px and under)
// or the strip (phones) from the stylesheet already.
const PALETTE_KEY = 'pathfinder-palette-collapsed'
function paletteChoice() { try { return localStorage.getItem(PALETTE_KEY) } catch (_) { return null } }
function reflectPalette() {
  const palette = document.getElementById('palette'), btn = document.getElementById('paletteCollapseBtn')
  if (!palette || !btn) return
  const on = palette.classList.contains('collapsed')
  btn.title = on ? 'Show palette' : 'Hide palette'
  btn.setAttribute('aria-label', btn.title)
  btn.setAttribute('aria-expanded', on ? 'false' : 'true')
}
/** Show the palette as its rail or whole; `remember` records it as the person's choice. */
export function setPaletteRail(on, { remember = false } = {}) {
  const palette = document.getElementById('palette'); if (!palette) return
  palette.classList.toggle('collapsed', !!on)
  if (remember) { try { localStorage.setItem(PALETTE_KEY, on ? '1' : '0') } catch (_) {} }
  reflectPalette()
}
/**
 * With no choice recorded: the rail once the map has content and the window
 * is wide, the whole palette when the map is empty. `arrived` is content
 * landing in bulk; a block added one at a time from the palette leaves it
 * where it is, so the list never folds away under the pointer.
 */
function autoPaletteRail(arrived = false) {
  if (ui.readOnly || paletteChoice() !== null) return
  const has = Object.keys(state.blocks).length > 0
  if (!has) setPaletteRail(false)
  else if (arrived && window.matchMedia('(min-width: 1025px)').matches) setPaletteRail(true)
}

export function setupPaletteSections() {
  window.matchMedia('(max-width: 768px)').addEventListener('change', e => {
    document.querySelectorAll('.palette-section').forEach(section => {
      section.querySelector('.palette-section-body').inert = !e.matches && section.classList.contains('collapsed')
    })
  })
  // Section toggles (Templates, Blocks)
  document.querySelectorAll('.palette-section-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const section = toggle.closest('.palette-section')
      const open = section.classList.contains('collapsed')
      setPaletteSection(section.id, open)
    })
  })

  // Restore section state. Templates defaults to open on an empty canvas and
  // folded once there is something on it, because that is the point at which
  // it stops being the thing you need.
  ;['templatesSection', 'blocksSection'].forEach(id => {
    let saved = null
    try { saved = localStorage.getItem('pathfinder-pal-' + id) } catch (_) {}
    if (saved !== null) { setPaletteSection(id, saved === '1'); return }
    if (id === 'templatesSection' && Object.keys(state.blocks).length) {
      setPaletteSection(id, false)
    }
  })

  // Palette collapse button, in the palette header. A press is the person's
  // own choice and is kept; until there is one, the map's content decides
  // (the rail section above).
  const collapseBtn = document.getElementById('paletteCollapseBtn')
  const palette = document.getElementById('palette')
  if (collapseBtn && palette) {
    const choice = paletteChoice()
    if (choice !== null) setPaletteRail(choice === '1')
    else autoPaletteRail(true)
    collapseBtn.addEventListener('click', () => setPaletteRail(!palette.classList.contains('collapsed'), { remember: true }))
    // An emptied map (Clear, a new map) brings the whole palette back.
    window.addEventListener('pf:canvas-changed', () => autoPaletteRail(false))
  }
}

// ── Timer Widget ─────────────────────────────────────────────
export function setupTimer() {
  const display = document.getElementById('timerDisplay')
  const toggleBtn = document.getElementById('timerToggleBtn')
  const controls = document.getElementById('timerControls')
  const minutesInput = document.getElementById('timerMinutes')
  const startBtn = document.getElementById('timerStartBtn')
  const pauseBtn = document.getElementById('timerPauseBtn')
  const resetBtn = document.getElementById('timerResetBtn')
  const widget = document.getElementById('timerWidget')

  let interval = null
  let timeRemaining = 0
  let isPaused = false
  let originalTime = 0
  let hasStarted = false

  const beepEmbed = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWTAkZYLTo6aZVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWTQ=='

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  // On a phone the timer row is the foot of the right panel's sheet, out of
  // sight while the sheet is collapsed; a running timer also shows its time
  // on the sheet's handle (#sheetTimer, aria-hidden: the row itself is
  // what a screen reader reads). Only while it counts down: a paused time,
  // or the full time put back after the end, would read as a countdown.
  const handleTime = document.getElementById('sheetTimer')
  function mirrorToHandle() {
    if (!handleTime) return
    handleTime.hidden = !(interval && hasStarted && !isPaused && timeRemaining > 0)
    handleTime.textContent = display.textContent
    handleTime.classList.toggle('warning', display.classList.contains('warning'))
    handleTime.classList.toggle('critical', display.classList.contains('critical'))
  }

  function updateWarningClass() {
    const minsLeft = timeRemaining / 60
    display.classList.remove('warning', 'critical')
    widget.classList.toggle('active', hasStarted && !isPaused && timeRemaining > 0)
    widget.classList.toggle('started', hasStarted)

    if (hasStarted && timeRemaining > 0) {
      if (minsLeft <= 1) {
        display.classList.add('critical')
      } else if (minsLeft <= 3) {
        display.classList.add('warning')
      }
    }
    mirrorToHandle()
  }

  function updateDisplay() {
    display.textContent = formatTime(Math.max(0, timeRemaining))
    updateWarningClass()

    if (timeRemaining === 0 && interval) {
      clearInterval(interval)
      interval = null
      isPaused = false
      startBtn.style.display = ''
      pauseBtn.style.display = 'none'

      // Play beep sound
      try {
        const audio = new Audio(beepEmbed)
        audio.play().catch(() => {})
      } catch (e) {}

      // Reset display after a moment
      setTimeout(() => {
        display.textContent = formatTime(originalTime)
        timeRemaining = originalTime
        updateWarningClass()
      }, 3000)
    }
  }

  toggleBtn.addEventListener('click', () => {
    const isVisible = controls.style.display === 'flex'
    controls.style.display = isVisible ? 'none' : 'flex'
    toggleBtn.classList.toggle('active', !isVisible)
    toggleBtn.setAttribute('aria-expanded', String(!isVisible))
  })

  startBtn.addEventListener('click', () => {
    if (timeRemaining === 0) {
      const mins = parseInt(minutesInput.value, 10) || 10
      timeRemaining = mins * 60
      originalTime = timeRemaining
    }

    isPaused = false
    hasStarted = true
    if (interval) clearInterval(interval)
    startBtn.style.display = 'none'
    pauseBtn.style.display = ''

    interval = setInterval(() => {
      if (!isPaused && timeRemaining > 0) {
        timeRemaining--
        updateDisplay()
      }
    }, 1000)
    updateDisplay()
  })

  pauseBtn.addEventListener('click', () => {
    isPaused = true
    startBtn.style.display = ''
    pauseBtn.style.display = 'none'
    startBtn.textContent = 'Resume'
    updateWarningClass()
  })

  resetBtn.addEventListener('click', () => {
    if (interval) {
      clearInterval(interval)
      interval = null
    }
    isPaused = false
    hasStarted = false
    const mins = parseInt(minutesInput.value, 10) || 10
    timeRemaining = mins * 60
    originalTime = timeRemaining
    startBtn.style.display = ''
    pauseBtn.style.display = 'none'
    startBtn.textContent = 'Start'
    updateDisplay()
  })

  minutesInput.addEventListener('input', () => {
    if (!interval || isPaused) {
      const mins = parseInt(minutesInput.value, 10) || 10
      timeRemaining = mins * 60
      originalTime = timeRemaining
      updateDisplay()
    }
  })

  // Initialize
  resetBtn.click()
}

// ── Templates ────────────────────────────────────────────────
// One stroked line icon, like the rest of the set.
const SAVE_TPL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>'

/** A template's accessible name: its name, and its size when it is a large one. */
export function templateName(tpl) {
  return tpl.large ? `${tpl.name}, ${tpl.blocks.length} blocks` : tpl.name
}

// Each template is a real button (Enter and Space, a name, a Tab stop); its
// description is the button's description, not part of its name. A saved
// template's delete is a sibling button, never nested inside the one that
// applies it.
function templateButton(tpl, { attr, descId, icon, extraClass = '' }) {
  return `
    <button type="button" class="template-item${extraClass}" ${attr} aria-label="${escHtml(templateName(tpl))}"${tpl.desc ? ` aria-describedby="${descId}"` : ''} title="${escHtml(tpl.name)}">
      <span class="template-icon" aria-hidden="true">${icon}</span>
      <span class="template-text">
        <span class="template-label">${escHtml(tpl.name)}${tpl.large ? '<span class="template-size" aria-hidden="true">' + tpl.blocks.length + '</span>' : ''}</span>
        ${tpl.desc ? `<span class="template-desc" id="${descId}">${escHtml(tpl.desc)}</span>` : ''}
      </span>
    </button>`
}

function renderTemplatesList() {
  const list = $.templatesList(); if (!list) return
  const users = listUserTemplates()
  list.innerHTML = TEMPLATES.map((tpl, i) => templateButton(tpl, {
      attr: `data-tpl="${i}"`, descId: `tpl-desc-${i}`, icon: TICONS[tpl.icon] || '', extraClass: tpl.large ? ' template-large' : '',
    })).join('')
    + users.map((tpl, j) => `
    <div class="template-row template-user">
      ${templateButton(tpl, { attr: `data-utpl="${escHtml(tpl.id)}"`, descId: `utpl-desc-${j}`, icon: SAVE_TPL_ICON, extraClass: ' template-user' })}
      <button type="button" class="utpl-del" data-utpl-del="${escHtml(tpl.id)}" title="Delete this template" aria-label="Delete template ${escHtml(tpl.name)}">×</button>
    </div>`).join('')
    + `
    <button type="button" class="template-save" id="saveTemplateBtn" title="Keep the current canvas as a reusable starting point">
      ${SAVE_TPL_ICON}<span>Save canvas as template</span>
    </button>`
}

let templatesWired = false
export function setupTemplates() {
  const list = $.templatesList(); if (!list) return
  renderTemplatesList()
  // Wired once: a second listener would apply every template twice.
  if (templatesWired) return
  templatesWired = true
  list.addEventListener('click', e => {
    const del = e.target.closest('[data-utpl-del]')
    if (del) {
      e.stopPropagation()
      // The row goes with it; keep the keyboard in the list rather than on
      // the page: the next saved template, else Save canvas as template.
      const rows = [...list.querySelectorAll('.utpl-del')]
      const at = rows.indexOf(del)
      deleteUserTemplate(del.dataset.utplDel)
      renderTemplatesList()
      const left = list.querySelectorAll('.template-row .template-item')
      ;(left[Math.min(at, left.length - 1)] || document.getElementById('saveTemplateBtn'))?.focus()
      showToast('Template deleted', 'info', 1500)
      return
    }
    if (e.target.closest('#saveTemplateBtn')) {
      if (!Object.keys(state.blocks).length) { showToast('Add blocks first, then save them as a template', 'warning'); return }
      const tpl = saveCurrentAsTemplate(canvasMeta.title, { state, canvasMeta, mode: devOpts.mode })
      renderTemplatesList()
      showToast(tpl ? `"${tpl.name}" saved: it now lives in Templates` : 'No room to save the template', tpl ? 'success' : 'warning', 2400)
      return
    }
    const item = e.target.closest('.template-item'); if (!item) return
    const tpl = item.dataset.utpl
      ? listUserTemplates().find(t => t.id === item.dataset.utpl)
      : TEMPLATES[+item.dataset.tpl]
    if (!tpl) return
    const wasEmpty = Object.keys(state.blocks).length === 0
    // On an empty map the template also sets the framing and the name, so the
    // undo step carries the framing too: one Cmd+Z takes all of it back.
    snapshot({ framing: wasEmpty })
    const added = applyTemplate(tpl)
    // A template's framing only lands on a canvas that had nothing on it. On a
    // merge the existing situation is somebody's deliberate choice.
    const framed = wasEmpty && applyTemplateSituation(tpl, canvasMeta, devOpts)
    if (framed) { refreshSituation(); syncPromptOptControls(); debouncedSave() }
    // An empty map with no name takes the template's (it kept "Untitled map").
    if (wasEmpty && !(canvasMeta.title || '').trim()) {
      canvasMeta.title = templateTitle(tpl.name)
      updateCanvasTitle()
    }
    renderAllBlocks()
    renderArrows({ cheap: false })
    renderFrames()
    runGapDetection()
    updateHint()
    saveState()
    ui.promptDirty = true
    refreshPrompt()
    collapseTemplatesAfterUse()

    // The big templates exist to be read as a shape, so arrange them straight
    // away rather than dropping a knot of boxes and hoping the button is found.
    // Either way it lands readable, on where its flow starts (zoom-controls.js
    // arriveAt), not at a whole-map fit too small to read.
    if (tpl.large) {
      // The template click already took its undo step above: one click, one Cmd+Z.
      const lead = framed ? `${tpl.name} added and arranged, with its situation.` : `${tpl.name} added and arranged.`
      runTidy({ snapshot: false, arrive: { ids: added, lead } })
    } else {
      arriveAt(added, { lead: `${arrivalLead(tpl.name)} Press Tidy or L to arrange it.`, ms: 2600 })
    }
  })
}

/** A template's name as a map's title, in sentence case ("Investigate a bug"). */
export function templateTitle(name) {
  const words = String(name || '').trim().split(/\s+/)
  return words.map((w, i) => i && /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w).join(' ')
}

/** Reflect devOpts.mode back onto the mode buttons after a template sets it. */
function syncModeButtons() {
  const group = document.getElementById('modeGroup'); if (!group) return
  group.querySelectorAll('.radio-opt').forEach(b => {
    const on = b.dataset.value === devOpts.mode
    b.classList.toggle('active', on)
    b.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
}

// ── Share URL loader ─────────────────────────────────────────
// Remove the link parts of the address once the canvas they carried is in
// a map (or can never load), so a reload does not offer it again. `via` is
// the arrival marker a built link carries (state.js buildShareUrl); the
// header kit has counted it by then. Read-only documents live in the URL,
// so they keep it for reloads and copies.
function forgetLinkInUrl({ hash = false, src = false, via = false } = {}) {
  if (ui.readOnly) return
  const params = new URLSearchParams(location.search)
  if (src) params.delete('src')
  if (via) params.delete('via')
  const query = params.toString()
  history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + (hash ? '' : location.hash))
}

/**
 * A map that arrived by link (a share link, an example, the tutorial's
 * example, ?src=) lands readable on where its flow starts, after the
 * import's own frame (zoom-controls.js arriveAt): the blocks it brought on
 * a merge, the whole map otherwise. The toast is the path's own message,
 * plus "Shift+1 shows all of it." (on a phone, "Fit shows all of it.") when
 * part of the map is off screen; a
 * plain open that shows everything says nothing, as before.
 */
function landIncoming(r, msg) {
  if (!r) return
  const ids = r.mode === 'merge' ? Object.values(r.idMap || {}) : null
  const skipped = r.dropped ? r.dropped.blocks + r.dropped.arrows + r.dropped.groups : 0
  arriveAfterLoad(ids).then(a => {
    if (!msg && (!a || a.whole)) return
    const lead = msg ? (/[.!?]$/.test(msg) ? msg : msg + '.') : arrivalLead(canvasMeta.title || 'Shared map', 'opened')
    showToast(a && !a.whole ? `${lead} ${arrivalHint()}` : lead, skipped ? 'warning' : 'success', 3600)
  })
}

/**
 * Load a #s= or #z= share link. Returns true when the hash held a canvas
 * (for #s=, which decodes synchronously), a Promise for #z= (inflating is
 * asynchronous; the promise is truthy, so init still skips ?src=), or
 * undefined when there is no link. A map with content is never replaced
 * without a choice: see sharing.js openIncoming.
 */
export function checkShareUrl() {
  const hash = location.hash
  if (!isShareHash(hash)) return
  const receive = data => {
    if (!data || typeof data !== 'object' || !data.blocks) return false
    // The hash takes precedence over a competing URL source.
    forgetLinkInUrl({ src: true })
    openIncoming(data, {
      source: 'link',
      onApplied: r => {
        forgetLinkInUrl({ hash: true, via: true })
        landIncoming(r, incomingMessage(r, 'shared map'))
      },
    })
    return true
  }
  if (hash.startsWith('#s=')) {
    let data
    try { data = decodeLegacyShare(hash) } catch (_) { return /* malformed hash: ignore it */ }
    return receive(data) || undefined
  }
  return decodeShareHash(hash).then(
    data => receive(data) || (showToast('That share link has no map in it', 'warning'), false),
    () => {
      showToast(canCompressLinks()
        ? 'Could not open that share link: it is damaged, cut short, or too large'
        : 'This browser cannot open compressed share links. Update it, or ask for the map as a file', 'warning', 4500)
      return false
    })
}

// ── ?src= loader ─────────────────────────────────────────────
/**
 * Load a canvas from a URL: ?src=https://... pointing at canvas JSON (or a
 * JSON Canvas file, or a Mermaid flowchart), the pattern proctor-site
 * established. It is the link an agent can hand over when a #s= hash would
 * be unwieldy: a gist, a raw file in a repo. Only https, only hosts the CSP
 * allows (GitHub raw/gist plus same-origin), a 1 MB cap, and the same
 * open-as-new-map choice a share link gets.
 */
export async function checkSrcUrl() {
  const params = new URLSearchParams(location.search)
  const src = params.get('src')
  if (!src) return
  // A link that cannot load leaves the address, or every reload would fetch
  // it and show the same error again. Cancelling the choice keeps it.
  const fail = (msg, ms) => { forgetLinkInUrl({ src: true, via: true }); showToast(msg, 'warning', ms) }
  if (!/^https:\/\//.test(src) && !src.startsWith('/')) { fail('?src= must be an https URL'); return }
  let parsed
  try {
    const res = await fetch(src, { credentials: 'omit' })
    if (!res.ok) { fail(`Could not load ?src= (HTTP ${res.status})`); return }
    const text = await res.text()
    if (text.length > 1_000_000) { fail('That canvas file is over 1 MB; import it as a file instead'); return }
    try { parsed = parseIncomingText(text) } catch (_) { parsed = { error: 'The file at that URL is not valid JSON' } }
  } catch (_) {
    fail('Could not fetch ?src= (network, CORS, or a host the app does not allow)')
    return
  }
  if (parsed.error) { fail('?src= ' + parsed.error.charAt(0).toLowerCase() + parsed.error.slice(1), 4000); return }
  const r = await openIncoming(parsed.data, { source: 'src', onApplied: () => forgetLinkInUrl({ src: true, via: true }) })
  if (!r) return
  flagLowConfidence(parsed.low, r.idMap)
  const skipped = r.dropped.blocks + r.dropped.arrows + r.dropped.groups
  const where = r.mode === 'new' ? ' as a new map. Yours is under Maps' : r.mode === 'merge' ? ' into your map' : ''
  landIncoming(r, skipped
    ? `Loaded ${r.imported} blocks from the link${where}, skipped ${skipped} invalid item${skipped === 1 ? '' : 's'}`
    : `Loaded ${r.imported} block${r.imported === 1 ? '' : 's'} from the link${where}`)
}
