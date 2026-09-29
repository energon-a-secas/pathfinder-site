// ════════════════════════════════════════════════════════════
//  ui-panels.js: search, shortcuts overlay, panel tabs,
//                 dev options, export/share/import dropdowns, header buttons
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, canvasMeta, devOpts,
         saveState, buildShareUrl, buildEmbedUrl, snapshot, debouncedSave } from './state.js'
import { $, TYPES, STATUS_DEFS, CARD_STYLES, DEFAULT_CARD_STYLE, SITUATION_FIELDS, SITUATION_DEFAULT,
         clamp, escHtml, showToast, getBlockDims, copyText, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { applyTransform, renderArrows, renderFrames, fitView, updateHint } from './canvas.js'
import { renderAllBlocks, renderInspector, selectBlock } from './render.js'
import { TEMPLATES, TICONS, applyTemplate, applyTemplateSituation,
         listUserTemplates, saveCurrentAsTemplate, deleteUserTemplate } from './templates.js'
import { refreshPrompt, markExported, generatePrompt, situationSection } from './prompt.js'
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
import { openIncoming, incomingMessage } from './sharing.js'
import { animateView } from './zoom-controls.js'

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
  const allMaps = !ui.readOnly && !ui.embed && document.getElementById('searchScope')?.value === 'all'
  const filters = {
    type: document.getElementById('searchType')?.value || '',
    status: document.getElementById('searchStatus')?.value || '',
  }
  const results = allMaps ? searchSavedMaps($.searchInput().value, filters) : searchBlocks(state.blocks, $.searchInput().value, filters)
  $.searchResults().innerHTML = results.map(({ block: b, source, excerpt, mapId, mapName, current }, i) =>
    `<div class="search-result" id="search-result-${i}" role="option" aria-selected="false" data-id="${escHtml(b.id)}" data-map="${escHtml(mapId || '')}">
       <span class="search-result-dot" style="background:var(--c-${b.type})" aria-hidden="true"></span>
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
  const scope = document.getElementById('searchScope')
  if (scope) {
    scope.closest('.search-scope').hidden = ui.readOnly || ui.embed
    scope.addEventListener('change', refreshSearch)
  }
  document.getElementById('searchBtn')?.addEventListener('click', () => ui.searchOpen ? closeSearch() : openSearch())
  document.getElementById('searchClose')?.addEventListener('click', () => closeSearch())
  for (const [id, defs] of [['searchType', TYPES], ['searchStatus', STATUS_DEFS]]) {
    const select = document.getElementById(id)
    if (!select) continue
    Object.entries(defs).forEach(([value, { label }]) => select.add(new Option(label, value)))
    select.addEventListener('change', refreshSearch)
  }
  document.getElementById('searchReset')?.addEventListener('click', () => {
    searchInput.value = ''
    document.getElementById('searchType').value = ''
    document.getElementById('searchStatus').value = ''
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
// classify.js); a key added there has to be added here too, or nobody
// learns it exists. tests/integration.test.js checks the ones outside
// events.js are listed.
export const SHORTCUTS = [
  { group: 'Editing', keys: [
    ['Enter / F2',             'Edit the selected card\u2019s title, or the selected connection\u2019s label'],
    ['Shift + Enter',          'Edit the selected card\u2019s description'],
    ['Double-click card',      'Edit the title, or the description where you click'],
    ['Double-click line',      'Edit the connection\u2019s label'],
    ['Tab (in a title)',       'Keep the title and edit the description'],
    ['Shift + Tab (in a description)', 'Keep the description and go back to the title'],
    ['Enter or Escape',        'Finish editing a title (Escape keeps what you typed)'],
    ['\u2318/Ctrl + Enter or Escape', 'Finish editing a description'],
    ['Arrow keys',             'Nudge the selected blocks 1px (a grid step when snapping)'],
    ['Shift + Arrow',          'Nudge the selected blocks 10px'],
    ['\u2318/Ctrl + D',        'Duplicate the selected block'],
    ['Delete / Backspace',     'Delete the selected blocks or connection'],
    ['\u2318/Ctrl + Z',        'Undo'],
    ['\u2318/Ctrl + Shift + Z','Redo'],
    ['Right-click',            'Quick actions for a card, a connection or the canvas'],
    ['Shift + F10 / Menu key', 'Quick actions for the selected card'],
    ['T',                      'Confirm or change the type of a card marked for a type check'],
    ['L',                      'Tidy: auto-arrange the canvas'],
  ] },
  { group: 'Navigation', keys: [
    ['Tab / Shift + Tab',      'Select the next or previous block in reading order; past the last one, leave the canvas'],
    ['\u2318/Ctrl + Arrow',    'Select the nearest block in that direction, connected ones first'],
    ['Enter / Space',          'Select the focused block'],
    ['Escape',                 'Deselect; press again to leave the canvas. Also closes overlays and ends dot voting'],
    ['Shift + click',          'Add a block to the selection'],
    ['Shift + drag',           'Select blocks inside a box'],
    ['\u2318/Ctrl + A',        'Select every block'],
    ['\u2318/Ctrl + F',        'Find blocks'],
    ['Arrow keys',             'Pan the canvas when nothing is selected (Shift pans further)'],
    ['Drag empty canvas',      'Pan the canvas'],
    ['Space + drag',           'Pan the canvas, even over cards'],
    ['Middle-button drag',     'Pan the canvas'],
    ['Scroll / two fingers',   'Pan the canvas (Shift + wheel pans sideways)'],
  ] },
  { group: 'Creating', keys: [
    ['Double-click canvas',    'Add a block where you click'],
    ['Right-click canvas',     'Add a block where you click'],
    ['Drag a port \u25CF',     'Draw a connection; drop it on empty canvas to add a connected block there'],
    ['Click a port \u25CF',    'Add a connected block on that side'],
    ['Alt + Arrow',            'Add a connected block in that direction'],
    ['\u2318/Ctrl + Enter',    'Add a connected block to the right'],
  ] },
  { group: 'View', keys: [
    ['Shift + 1',              'Fit all blocks in view'],
    ['Shift + 2',              'Zoom to the selection'],
    ['Shift + 0',              'Zoom to 100%'],
    ['= / -',                  'Zoom in / out'],
    ['\u2318/Ctrl + = / - / 0','Zoom in / out / to 100% while the canvas has focus (elsewhere they zoom the page)'],
    ['Pinch / \u2318/Ctrl + scroll', 'Zoom at the pointer'],
    ['H',                      'Hide the header and footer'],
    ['Z',                      'Zen: hide every panel too'],
    ['Alt + H',                'High-contrast mode'],
    ['?',                      'Show this help'],
  ] },
]

// A view-only link cannot edit or create, so its sheet lists only the keys
// that work there instead of promising ones that do nothing.
const READ_ONLY_GROUPS = ['Navigation', 'View']

export function buildShortcutGrid() {
  const grid = $.shortcutGrid(); if (!grid) return
  grid.textContent = ''
  const note = document.createElement('p')
  note.className = 'shortcut-note'
  note.textContent = 'Single keys (letters, digits, =, -, arrows, Space) work while the canvas has focus: click it or press Tab to reach it.' +
    (ui.readOnly ? ' This is a view-only link, so editing keys are off.' : '')
  grid.appendChild(note)
  const groups = ui.readOnly ? SHORTCUTS.filter(g => READ_ONLY_GROUPS.includes(g.group)) : SHORTCUTS
  // Newspaper columns (CSS), so all four groups fit one screen on a laptop
  // instead of the View keys waiting below the fold. Each key and its
  // description share a row wrapper that never splits across columns.
  const columns = document.createElement('div')
  columns.className = 'shortcut-columns'
  groups.forEach(({ group, keys }) => {
    const section = document.createElement('section')
    section.className = 'shortcut-section'
    const h = document.createElement('h3')
    h.className = 'shortcut-group'
    h.textContent = group
    const list = document.createElement('dl')
    list.className = 'shortcut-list'
    keys.forEach(([key, desc]) => {
      const row = document.createElement('div'); row.className = 'shortcut-row'
      const k = document.createElement('dt'); k.className = 'shortcut-key'; k.textContent = key
      const d = document.createElement('dd'); d.className = 'shortcut-desc'; d.textContent = desc
      row.appendChild(k); row.appendChild(d)
      list.appendChild(row)
    })
    section.appendChild(h); section.appendChild(list)
    columns.appendChild(section)
  })
  grid.appendChild(columns)
}

// Where focus was before the sheet opened, so closing it puts you back.
let shortcutsReturnFocus = null

export function openShortcuts() {
  const overlay = $.shortcutOverlay()
  if (overlay.style.display === 'none') {
    shortcutsReturnFocus = document.activeElement
    buildShortcutGrid()   // read-only may have changed since start-up
  }
  overlay.style.display = ''
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  requestAnimationFrame(() => document.getElementById('shortcutClose')?.focus())
}
export function closeShortcuts() {
  const overlay = $.shortcutOverlay()
  const wasOpen = overlay.style.display !== 'none'
  overlay.style.display = 'none'
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

// ── Engagement Context field ─────────────────────────────────
// One-or-two-line framing that opens the generated prompt. Lives in the
// Prompt pane (where it shapes the output the user is about to copy).
export function syncContextBrief() {
  const el = document.getElementById('contextBrief')
  if (el && el.value !== (canvasMeta.contextBrief || '')) el.value = canvasMeta.contextBrief || ''
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
    ui.promptDirty = true
    if (ui.activeTab === 'prompt') refreshPrompt()
  })
}

// ── Panel tabs ───────────────────────────────────────────────
export function setupPanelTabs() {
  const tabs = [...document.querySelectorAll('.panel-tab')]
  const tablist = document.querySelector('.panel-tabs')
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

// ── Prompt mode descriptions ─────────────────────────────────
// One-line plain-language explanation of what each mode asks the AI to do,
// shown under the mode selector so the choice isn't a guess.
const MODE_DESCS = {
  investigate: 'Establishes what is actually true before anything changes. Findings must carry their evidence, unknowns stay marked as unknown, and disagreements between the canvas and reality get reported rather than smoothed over. Use it when you are picking up somebody else\'s system.',
  explore: 'Surfaces gaps, risky assumptions, and missing links, asks questions instead of proposing solutions. Good for pressure-testing an early canvas.',
  plan:    'Turns the canvas into a phased implementation plan with concrete outputs per phase. The default for "give me a roadmap".',
  build:   'Treats requirements and outputs as a task checklist and asks for working code. Use once the plan is settled.',
  clarify: 'Returns a prioritized list of clarifying questions (blocking → nice-to-have), each tied to a block, plus a readiness read. Best when you want gaps and useful questions before committing.',
}

export function refreshModeDesc() {
  const el = document.getElementById('modeDesc')
  if (el) el.textContent = MODE_DESCS[devOpts.mode] || MODE_DESCS.plan
}

// ── Situation ────────────────────────────────────────────────

/**
 * The engagement setup: what code exists, what the assistant can reach, and
 * what it should do first. Rendered from SITUATION_FIELDS so the control and
 * the sentence it produces cannot drift apart, and previewed live because the
 * whole point is being able to read what you are about to hand over.
 */
export function setupSituation() {
  const host = document.getElementById('situationFields')
  const repo = document.getElementById('situationRepoHint')
  const cons = document.getElementById('situationConstraints')
  if (!host) return

  const paint = () => {
    const sit = { ...SITUATION_DEFAULT, ...(canvasMeta.situation || {}) }
    host.innerHTML = Object.entries(SITUATION_FIELDS).map(([key, field]) => `
      <div class="situation-row">
        <div class="insp-label situation-row-label">${escHtml(field.label)}
          <span class="insp-label-hint">${escHtml(field.hint)}</span></div>
        <div class="dev-radio-group" data-situation="${key}">
          ${Object.entries(field.options).map(([val, opt]) =>
            `<button class="radio-opt${sit[key] === val ? ' active' : ''}" data-situation-value="${val}"
                     title="${escHtml(opt.line)}">${escHtml(opt.label)}</button>`).join('')}
        </div>
      </div>`).join('')
    if (repo && document.activeElement !== repo) repo.value = sit.repoHint || ''
    if (cons && document.activeElement !== cons) cons.value = sit.constraints || ''
    refreshSituationPreview()
  }

  host.addEventListener('click', e => {
    const btn = e.target.closest('[data-situation-value]'); if (!btn) return
    const key = btn.closest('[data-situation]')?.dataset.situation; if (!key) return
    canvasMeta.situation = { ...SITUATION_DEFAULT, ...(canvasMeta.situation || {}), [key]: btn.dataset.situationValue }
    paint(); saveState(); ui.promptDirty = true; refreshPrompt()
  })

  const bindText = (el, key) => el && el.addEventListener('input', () => {
    canvasMeta.situation = { ...SITUATION_DEFAULT, ...(canvasMeta.situation || {}), [key]: el.value }
    refreshSituationPreview(); debouncedSave(); ui.promptDirty = true; refreshPrompt()
  })
  bindText(repo, 'repoHint')
  bindText(cons, 'constraints')

  paint()
  syncSituation = paint
}

let syncSituation = () => {}
export function refreshSituation() { syncSituation() }

/** Show the exact lines the situation will contribute to the prompt. */
export function refreshSituationPreview() {
  const el = document.getElementById('situationPreview'); if (!el) return
  el.textContent = situationSection().trim()
}

// ── Dev options ──────────────────────────────────────────────
function syncRadioAria(groupEl) {
  groupEl.querySelectorAll('.radio-opt').forEach(b =>
    b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false')
  )
}

export function setupDevOptions() {
  // Set initial aria-pressed on all radio groups
  document.querySelectorAll('.dev-radio-group').forEach(g => syncRadioAria(g))

  document.getElementById('devOptionsHeader').addEventListener('click', () =>
    document.getElementById('devOptions').classList.toggle('open')
  )
  document.getElementById('toneGroup').addEventListener('click', e => {
    const btn = e.target.closest('.radio-opt'); if (!btn) return
    document.querySelectorAll('#toneGroup .radio-opt').forEach(b => b.classList.remove('active'))
    btn.classList.add('active'); devOpts.tone = btn.dataset.value
    syncRadioAria(document.getElementById('toneGroup'))
    debouncedSave()
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })
  document.getElementById('detailGroup').addEventListener('click', e => {
    const btn = e.target.closest('.radio-opt'); if (!btn) return
    document.querySelectorAll('#detailGroup .radio-opt').forEach(b => b.classList.remove('active'))
    btn.classList.add('active'); devOpts.detail = btn.dataset.value
    syncRadioAria(document.getElementById('detailGroup'))
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
    debouncedSave()
    ui.promptDirty = true; refreshPrompt()
  })
  refreshModeDesc()

  // Docs base URL: powers inline doc previews for pages under this origin/path.
  const docsBaseInput = document.getElementById('docsBaseInput')
  if (docsBaseInput) {
    docsBaseInput.value = getDocsBase()
    docsBaseInput.addEventListener('input', () => setDocsBase(docsBaseInput.value))
  }

  document.getElementById('prePromptGroup').addEventListener('click', e => {
    const btn = e.target.closest('.check-opt'); if (!btn) return
    btn.classList.toggle('active')
    btn.classList.contains('active') ? devOpts.prePrompts.add(btn.dataset.value)
                                     : devOpts.prePrompts.delete(btn.dataset.value)
    debouncedSave()
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })

  // One-click presets: a bundle of mode + dev options for the common
  // handovers. They set the same fields the controls below do, nothing more.
  const PRESETS = {
    'claude-code': { label: 'Claude Code', mode: 'build', tone: 'auto', detail: 'standard', pre: ['tasks', 'errors', 'edge'] },
    'cursor-ts':   { label: 'Cursor + TS', mode: 'build', tone: 'technical', detail: 'standard', pre: ['typescript', 'tasks', 'docs'] },
    'pm-clarify':  { label: 'PM clarify', mode: 'clarify', tone: 'formal', detail: 'standard', pre: [] },
  }
  document.getElementById('promptPresets')?.addEventListener('click', e => {
    const btn = e.target.closest('.preset-opt'); if (!btn) return
    const pz = PRESETS[btn.dataset.preset]; if (!pz) return
    devOpts.mode = pz.mode; devOpts.tone = pz.tone; devOpts.detail = pz.detail
    devOpts.prePrompts = new Set(pz.pre)
    syncPromptOptControls()
    debouncedSave()
    showToast(`${pz.label}: ${pz.mode} mode${pz.pre.length ? `, ${pz.pre.length} extras` : ''}`, 'success', 1800)
  })

  // A replace (share link, import, Maps switch) can change the options under
  // the controls; resync them. Also run once so a loaded canvas is reflected.
  window.addEventListener('pf:prompt-opts-changed', syncPromptOptControls)
  syncPromptOptControls()
}

/** Reflect devOpts into the Prompt tab controls (mode, tone, detail, pre). */
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
  document.querySelectorAll('#prePromptGroup .check-opt').forEach(b =>
    b.classList.toggle('active', devOpts.prePrompts.has(b.dataset.value)))
  refreshModeDesc()
  ui.promptDirty = true
  if (ui.activeTab === 'prompt') refreshPrompt()
}

// ── Copy prompt button ───────────────────────────────────────
export function setupCopyPrompt() {
  document.getElementById('copyPromptBtn').addEventListener('click', () => {
    const promptOutput = $.promptOutput()
    if (!promptOutput.value) return
    copyText(promptOutput.value).then(ok => {
      if (!ok) { showToast('Copy failed \u2014 select the text and press Ctrl/Cmd+C', 'warning'); return }
      markExported()
      ui.promptDirty = true; refreshPrompt()
      showToast('Prompt copied to clipboard', 'success')
      const btn = document.getElementById('copyPromptBtn')
      btn.textContent = '\u2713 Copied!'; btn.classList.add('copied')
      setTimeout(() => { btn.textContent = 'Copy Prompt'; btn.classList.remove('copied') }, 2000)
    })
  })
}

// \u2500\u2500 Clipboard helper \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// copyText now lives in utils.js; re-exported so existing importers keep working.
export { copyText }

// Keep the quick action quiet; detailed readiness belongs in the Prompt pane.
export function refreshQuickCopy() {
  const button = document.getElementById('copyPromptPill')
  if (!button) return
  button.hidden = ui.readOnly || ui.embed
  button.disabled = !Object.keys(state.blocks).length
}

/** Clicks on the gap breakdown jump to the first offending block. */
export function setupGapBreakdown() {
  document.getElementById('gapBreakdown')?.addEventListener('click', e => {
    const row = e.target.closest('.gap-row[data-bid]'); if (!row) return
    focusBlock(row.dataset.bid)
  })
}

export function setupQuickCopy() {
  const button = document.getElementById('copyPromptPill')
  if (!button) return
  const label = document.getElementById('copyPillLabel')
  let resetLabel
  button.addEventListener('click', async () => {
    if (ui.readOnly || ui.embed || !Object.keys(state.blocks).length) return
    const copied = await copyText(generatePrompt())
    if (!copied) { showToast('Copy failed. Open the Prompt tab to copy manually', 'warning'); return }
    markExported()
    ui.promptDirty = true
    refreshPrompt()
    clearTimeout(resetLabel)
    label.textContent = 'Copied'
    button.setAttribute('aria-label', 'Prompt copied')
    resetLabel = setTimeout(() => {
      label.textContent = 'Copy prompt'
      button.setAttribute('aria-label', 'Copy prompt')
    }, 1800)
  })
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

  on('exportCopyPrompt', () => {
    if (!Object.keys(state.blocks).length) { showToast('Add a block first', 'warning'); return }
    ui.promptDirty = true
    copyText(generatePrompt()).then(ok => {
      if (!ok) { showToast('Copy failed: open the Prompt tab and copy manually', 'warning'); return }
      markExported()
      ui.promptDirty = true; refreshPrompt()
      showToast('AI-ready prompt copied to clipboard', 'success')
    })
  })

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
 * Re-lay the canvas and animate every block to its new home.
 *
 * Positions land in one undo step (tidyCanvas takes the snapshot), so Cmd+Z
 * restores the whole arrangement. Arrows are re-rendered each frame during the
 * transition, then routed properly once it settles.
 */
// `snapshot: false` is for a caller that already took this action's undo
// step. Listeners pass an Event here, which has no `snapshot`: the default.
export function runTidy({ snapshot: takeSnapshot = true } = {}) {
  if (ui.readOnly) return
  const count = Object.keys(state.blocks).length
  if (count < 2) { showToast('Add at least two blocks to arrange', 'info', 1600); return }

  const tidied = tidyCanvas({ direction: layoutDir, snapshot: takeSnapshot !== false })
  document.body.classList.add('tidying')
  renderAllBlocks()
  renderFrames()

  const started = performance.now()
  const step = () => {
    renderArrows({ cheap: true })
    renderFrames()
    if (performance.now() - started < 460) requestAnimationFrame(step)
    else {
      document.body.classList.remove('tidying')
      renderArrows({ cheap: false })
      fitView()
    }
  }
  requestAnimationFrame(step)

  saveState()
  ui.promptDirty = true
  runGapDetection()
  // The summary also counts lines left under a card (layout.js).
  showToast(tidySummary(tidied, count, layoutDir), 'success', 2600)
}

export function setupTidy() {
  refreshDirButton()
  document.getElementById('tidyBtn')?.addEventListener('click', runTidy)
  // The caret's direction menu is wired with the other header menus in
  // js/view-menu.js (setupViewMenu).
}

/** The undo shortcut as this platform spells it, for copy that names it. */
export function undoKeyLabel(platform = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '') {
  return /mac|iphone|ipad|ipod/i.test(platform) ? 'Cmd+Z' : 'Ctrl+Z'
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
  if (ask && !confirm(`Clear this map? Every block, connection and group on it goes. Undo (${undoKeyLabel()}) brings it back.`)) return false
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
  return true
}

// Theme, snapping, pinned ports, connection notes, motion and card style all
// live in View now (js/view-menu.js); Fit moved to the status bar. What is left
// here is the File menu's Clear row.
export function setupHeaderButtons() {
  document.getElementById('clearBtn')?.addEventListener('click', () => clearCanvas())
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

/** Fold Templates away, but only if the user has not already opened it by hand. */
export function collapseTemplatesAfterUse() {
  if (ui.readOnly) return
  let pinned = null
  try { pinned = localStorage.getItem('pathfinder-pal-templatesSection') } catch (_) {}
  if (pinned === '1') return
  setPaletteSection('templatesSection', false)
  try { localStorage.removeItem('pathfinder-pal-templatesSection') } catch (_) {}
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

  // Palette collapse button, now in the palette header
  const collapseBtn = document.getElementById('paletteCollapseBtn')
  const palette = document.getElementById('palette')
  if (collapseBtn && palette) {
    const reflect = () => {
      const on = palette.classList.contains('collapsed')
      collapseBtn.title = on ? 'Show palette' : 'Hide palette'
      collapseBtn.setAttribute('aria-label', collapseBtn.title)
      collapseBtn.setAttribute('aria-expanded', on ? 'false' : 'true')
    }
    try { if (localStorage.getItem('pathfinder-palette-collapsed') === '1') palette.classList.add('collapsed') } catch (_) {}
    reflect()
    collapseBtn.addEventListener('click', () => {
      palette.classList.toggle('collapsed')
      try { localStorage.setItem('pathfinder-palette-collapsed', palette.classList.contains('collapsed') ? '1' : '0') } catch (_) {}
      reflect()
    })
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
const SAVE_TPL_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>'

function renderTemplatesList() {
  const list = $.templatesList(); if (!list) return
  const users = listUserTemplates()
  list.innerHTML = TEMPLATES.map((tpl, i) => `
    <div class="template-item${tpl.large ? ' template-large' : ''}" data-tpl="${i}" title="${escHtml(tpl.name)}">
      <div class="template-icon">${TICONS[tpl.icon] || ''}</div>
      <div>
        <div class="template-label">${escHtml(tpl.name)}${tpl.large ? '<span class="template-size">' + tpl.blocks.length + '</span>' : ''}</div>
        <div class="template-desc">${escHtml(tpl.desc)}</div>
      </div>
    </div>`).join('')
    + users.map(tpl => `
    <div class="template-item template-user" data-utpl="${escHtml(tpl.id)}" title="${escHtml(tpl.name)}">
      <div class="template-icon">${SAVE_TPL_ICON}</div>
      <div>
        <div class="template-label">${escHtml(tpl.name)}</div>
        <div class="template-desc">${escHtml(tpl.desc || '')}</div>
      </div>
      <button class="utpl-del" data-utpl-del="${escHtml(tpl.id)}" title="Delete this template" aria-label="Delete template">×</button>
    </div>`).join('')
    + `
    <button class="template-save" id="saveTemplateBtn" title="Keep the current canvas as a reusable starting point">
      ${SAVE_TPL_ICON}<span>Save canvas as template</span>
    </button>`
}

export function setupTemplates() {
  const list = $.templatesList(); if (!list) return
  renderTemplatesList()
  list.addEventListener('click', e => {
    const del = e.target.closest('[data-utpl-del]')
    if (del) {
      e.stopPropagation()
      deleteUserTemplate(del.dataset.utplDel)
      renderTemplatesList()
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
    snapshot()
    applyTemplate(tpl)
    // A template's framing only lands on a canvas that had nothing on it. On a
    // merge the existing situation is somebody's deliberate choice.
    const framed = wasEmpty && applyTemplateSituation(tpl, canvasMeta, devOpts)
    if (framed) { refreshSituation(); syncPromptOptControls(); debouncedSave() }
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
    if (tpl.large) {
      // The template click already took its undo step above: one click, one Cmd+Z.
      runTidy({ snapshot: false })
      if (framed) showToast(`${tpl.name} added, arranged, and the Situation set to match`, 'success', 3200)
    } else {
      fitView()
      showToast(`Added ${tpl.name}. Press Tidy or L to arrange it`, 'success', 2600)
    }
  })
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
        const msg = incomingMessage(r, 'shared map')
        if (msg) showToast(msg, r.dropped && (r.dropped.blocks + r.dropped.arrows + r.dropped.groups) ? 'warning' : 'success', 3600)
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
  showToast(skipped
    ? `Loaded ${r.imported} blocks from the link${where}, skipped ${skipped} invalid item${skipped === 1 ? '' : 's'}`
    : `Loaded ${r.imported} block${r.imported === 1 ? '' : 's'} from the link${where}`, skipped ? 'warning' : 'success', 3600)
}
