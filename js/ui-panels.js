// ════════════════════════════════════════════════════════════
//  ui-panels.js — Search, shortcuts overlay, panel tabs,
//                 dev options, export/share/import dropdowns, header buttons
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, canvasMeta, devOpts,
         saveState, buildShareUrl, buildEmbedUrl, snapshot, debouncedSave, snapTo } from './state.js'
import { $, TYPES, STATUS_DEFS, CARD_STYLES, DEFAULT_CARD_STYLE, SITUATION_FIELDS, SITUATION_DEFAULT,
         clamp, escHtml, showToast, getBlockDims, getSmallIcon, copyText, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { applyTransform, renderArrows, renderFrames, fitView, updateHint } from './canvas.js'
import { renderAllBlocks, renderInspector, selectBlock, updateCanvasTitle } from './render.js'
import { TEMPLATES, TICONS, applyTemplate, applyTemplateSituation,
         listUserTemplates, saveCurrentAsTemplate, deleteUserTemplate } from './templates.js'
import { refreshPrompt, markExported, generatePrompt, situationSection } from './prompt.js'
import { applyImport, exportJSON, exportMarkdown, exportMeetingSummary, exportToPresentationSage } from './export.js'
import { exportSpecBundle } from './spec-export.js'
import { detectFormat, fromJsonCanvas, parseMermaid, downloadJsonCanvas } from './interop.js'
import { exportPNG, exportSVG } from './image-export.js'
import { DIAGRAM_BUILDER_PROMPT } from './diagram-instructions.js'
import { runGapDetection } from './gaps.js'
import { getDocsBase, setDocsBase } from './doc-panel.js'
import { tidyCanvas } from './layout.js'
import { searchBlocks } from './search.js'
import { searchSavedMaps, switchTo, currentId } from './library.js'

// ── Search ───────────────────────────────────────────────────
let searchReturnFocus = null

export function focusBlock(id) {
  const b = state.blocks[id]; if (!b) return
  const { w, h } = getBlockDims(id)
  const canvasViewport = $.canvasViewport()
  const vpW = canvasViewport.offsetWidth, vpH = canvasViewport.offsetHeight
  const targetZoom = clamp(Math.max(view.zoom, 1.0), MIN_ZOOM, MAX_ZOOM)
  const targetPanX = vpW/2 - (b.x + w/2) * targetZoom
  const targetPanY = vpH/2 - (b.y + h/2) * targetZoom
  const startPanX = view.panX, startPanY = view.panY, startZoom = view.zoom
  // Honor reduced-motion: snap to target instead of animating the pan/zoom
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    view.panX = targetPanX; view.panY = targetPanY; view.zoom = targetZoom
    applyTransform()
    selectBlock(id)
    return
  }
  const start = performance.now()
  ;(function step(now) {
    const t = Math.min((now - start) / 280, 1)
    const ease = t < .5 ? 2*t*t : -1+(4-2*t)*t
    view.panX = startPanX + (targetPanX - startPanX) * ease
    view.panY = startPanY + (targetPanY - startPanY) * ease
    view.zoom = startZoom + (targetZoom - startZoom) * ease
    applyTransform()
    if (t < 1) requestAnimationFrame(step)
  })(start)
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
const SHORTCUTS = [
  ['\u2318/Ctrl + Z',        'Undo'],
  ['\u2318/Ctrl + Shift+Z',  'Redo'],
  ['\u2318/Ctrl + D',        'Duplicate selected block'],
  ['\u2318/Ctrl + A',        'Select all blocks'],
  ['\u2318/Ctrl + F',        'Search blocks'],
  ['Delete / Backspace', 'Delete selected block or arrow'],
  ['Shift + click',      'Add block to selection'],
  ['Shift + drag',       'Rubber-band multi-select'],
  ['Double-click block', 'Edit title inline'],
  ['Double-click description', 'Edit description inline'],
  ['Right-click block',  'Quick actions (duplicate, type, color…)'],
  ['Right-click canvas', 'Add a block where you click'],
  ['Double-click canvas','Fit all blocks in view'],
  ['Drag port \u25CF',        'Draw connection arrow'],
  ['Two-finger scroll',  'Pan the canvas'],
  ['Pinch / \u2318+scroll',   'Zoom in and out'],
  ['Drag empty canvas',  'Pan the canvas'],
  ['Tab / Shift+Tab',    'Navigate between blocks'],
  ['Enter / Space',      'Select focused block'],
  ['L',                  'Tidy: auto-arrange the canvas'],
  ['H',                  'Hide the header and footer'],
  ['Z',                  'Zen: hide every panel too'],
  ['Alt + H',            'Toggle high-contrast mode'],
  ['Escape',             'Deselect / close overlay'],
  ['?',                  'Show this help'],
]

export function buildShortcutGrid() {
  const grid = $.shortcutGrid()
  SHORTCUTS.forEach(([key, desc]) => {
    const k = document.createElement('span'); k.className = 'shortcut-key'; k.textContent = key
    const d = document.createElement('span'); d.className = 'shortcut-desc'; d.textContent = desc
    grid.appendChild(k); grid.appendChild(d)
  })
}

export function openShortcuts() {
  const overlay = $.shortcutOverlay()
  overlay.style.display = ''
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  requestAnimationFrame(() => document.getElementById('shortcutClose')?.focus())
}
export function closeShortcuts() { $.shortcutOverlay().style.display = 'none' }

// Generic focus trap: keeps Tab within a container
function trapFocus(container, e) {
  if (e.key !== 'Tab') return
  const focusable = container.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')
  if (!focusable.length) return
  const first = focusable[0], last = focusable[focusable.length - 1]
  if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus() } }
  else { if (document.activeElement === last) { e.preventDefault(); first.focus() } }
}

export function setupShortcutOverlay() {
  document.getElementById('shortcutClose').addEventListener('click', closeShortcuts)
  $.shortcutOverlay().addEventListener('click', e => {
    if (e.target === $.shortcutOverlay()) closeShortcuts()
  })
  $.shortcutOverlay().addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeShortcuts(); return }
    trapFocus($.shortcutOverlay().querySelector('.shortcut-modal'), e)
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

  // Docs base URL — powers inline doc previews for pages under this origin/path.
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

// ── Export dropdown ──────────────────────────────────────────
export function setDropdownOpen(wrapperId, open) {
  const el = document.getElementById(wrapperId)
  el.classList.toggle('open', open)
  el.querySelector('.header-btn')?.setAttribute('aria-expanded', open ? 'true' : 'false')
  if (open) {
    const first = el.querySelector('.export-item')
    if (first) requestAnimationFrame(() => first.focus())
  }
}

export function setupDropdownKeyboard(wrapperId) {
  const wrapper = document.getElementById(wrapperId)
  const dropdown = wrapper.querySelector('.export-dropdown')
  if (!dropdown) return
  dropdown.setAttribute('role', 'menu')
  dropdown.querySelectorAll('.export-item').forEach(item => {
    item.setAttribute('role', 'menuitem')
    item.setAttribute('tabindex', '-1')
  })
  dropdown.addEventListener('keydown', e => {
    const items = [...dropdown.querySelectorAll('.export-item')]
    const idx = items.indexOf(document.activeElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length
      items[next]?.focus()
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      document.activeElement?.click()
    } else if (e.key === 'Escape') {
      setDropdownOpen(wrapperId, false)
      wrapper.querySelector('.header-btn')?.focus()
    }
  })
}

export function setupExportDropdown() {
  setupDropdownKeyboard('exportWrapper')
  setupDropdownKeyboard('shareWrapper')
  document.getElementById('exportBtn').addEventListener('click', e => {
    const isOpen = document.getElementById('exportWrapper').classList.contains('open')
    setDropdownOpen('exportWrapper', !isOpen); e.stopPropagation()
  })
  document.addEventListener('click', () => {
    setDropdownOpen('exportWrapper', false)
    setDropdownOpen('shareWrapper', false)
  })

  document.getElementById('exportCopyPrompt').addEventListener('click', () => {
    setDropdownOpen('exportWrapper', false)
    if (!Object.keys(state.blocks).length) { showToast('Add a block first', 'warning'); return }
    ui.promptDirty = true
    copyText(generatePrompt()).then(ok => {
      if (!ok) { showToast('Copy failed: open the Prompt tab and copy manually', 'warning'); return }
      markExported()
      ui.promptDirty = true; refreshPrompt()
      showToast('AI-ready prompt copied to clipboard', 'success')
    })
  })

  document.getElementById('copyDiagramInstructions').addEventListener('click', () => {
    setDropdownOpen('exportWrapper', false)
    copyText(DIAGRAM_BUILDER_PROMPT).then(ok => {
      showToast(ok
        ? 'AI diagram-builder prompt copied: paste it into Claude, add your topic, then Import the JSON'
        : 'Copy failed: try again', ok ? 'success' : 'warning')
    })
  })

  document.getElementById('exportJSON').addEventListener('click', () => {
    exportJSON()
  })

  document.getElementById('exportMarkdown').addEventListener('click', () => {
    exportMarkdown()
  })

  document.getElementById('exportSpecBundle').addEventListener('click', () => {
    setDropdownOpen('exportWrapper', false)
    exportSpecBundle()
  })

  document.getElementById('exportJsonCanvas').addEventListener('click', () => {
    setDropdownOpen('exportWrapper', false)
    if (!Object.keys(state.blocks).length) { showToast('Add a block first', 'warning'); return }
    downloadJsonCanvas()
    showToast('JSON Canvas downloaded: it opens in Obsidian and friends', 'success')
  })

  document.getElementById('exportPNG').addEventListener('click', () => {
    setDropdownOpen('exportWrapper', false)
    exportPNG(2)
  })

  document.getElementById('exportSVG').addEventListener('click', () => {
    setDropdownOpen('exportWrapper', false)
    exportSVG()
  })

  document.getElementById('exportMeetingSummary').addEventListener('click', () => {
    exportMeetingSummary()
    const btn = document.getElementById('exportBtn')
    setDropdownOpen('exportWrapper', false)
    const originalText = btn.textContent
    btn.textContent = 'Exported!'
    setTimeout(() => {
      btn.textContent = originalText
    }, 1500)
  })

  document.getElementById('exportToPresentationSage').addEventListener('click', () => {
    exportToPresentationSage()
    setDropdownOpen('exportWrapper', false)
  })

  document.getElementById('importJSON').addEventListener('click', () => {
    setDropdownOpen('exportWrapper', false)
    document.getElementById('importFile').value = ''
    document.getElementById('importFile').click()
  })
}

// ── Share dropdown ───────────────────────────────────────────
export function setupShareDropdown() {
  document.getElementById('shareBtn').addEventListener('click', e => {
    const isOpen = document.getElementById('shareWrapper').classList.contains('open')
    setDropdownOpen('shareWrapper', !isOpen); e.stopPropagation()
  })
  const shareCopy = (text, okMsg) => copyText(text).then(ok =>
    showToast(ok ? okMsg : 'Copy failed: try again', ok ? 'success' : 'warning'))
  document.getElementById('shareCopyLink').addEventListener('click', () => {
    shareCopy(buildShareUrl(false), 'Link copied!')
    setDropdownOpen('shareWrapper', false)
  })
  document.getElementById('shareCopyReadOnly').addEventListener('click', () => {
    shareCopy(buildShareUrl(true), 'View-only link copied!')
    setDropdownOpen('shareWrapper', false)
  })
  document.getElementById('shareCopyEmbed').addEventListener('click', () => {
    const src = buildEmbedUrl()
    const snippet = `<iframe src="${src}" width="800" height="500" style="border:none;border-radius:12px" allowfullscreen></iframe>`
    shareCopy(snippet, 'Embed code copied!')
    setDropdownOpen('shareWrapper', false)
  })
}

// ── Import result toast ──────────────────────────────────────
function reportImport(imported, dropped) {
  const skipped = dropped.blocks + dropped.arrows + dropped.groups
  if (!imported && !skipped) { showToast('Nothing to import', 'warning'); return }
  let msg = `Imported ${imported} block${imported === 1 ? '' : 's'}`
  if (skipped) {
    const parts = []
    if (dropped.blocks) parts.push(`${dropped.blocks} block${dropped.blocks === 1 ? '' : 's'}`)
    if (dropped.arrows) parts.push(`${dropped.arrows} connection${dropped.arrows === 1 ? '' : 's'}`)
    if (dropped.groups) parts.push(`${dropped.groups} group${dropped.groups === 1 ? '' : 's'}`)
    msg += `, skipped ${parts.join(', ')}`
  }
  showToast(msg, skipped ? 'warning' : 'success')
}

// ── Import file handler ──────────────────────────────────────
export function setupImportHandler() {
  document.getElementById('importFile').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target.result
      // One picker, three formats: pathfinder JSON, JSON Canvas (.canvas,
      // an { nodes, edges } object), or a Mermaid flowchart. Converted
      // formats go through the classifier, so their low-confidence types
      // surface as the same correction chips Brain Dump shows.
      const fmt = detectFormat(text)
      if (!fmt) { showToast('Could not read file: not JSON, JSON Canvas, or a Mermaid flowchart', 'error'); return }
      let data, low = []
      if (fmt === 'mermaid') {
        const r = parseMermaid(text)
        if (!r.payload.blocks.length) { showToast('No flowchart nodes found in that file', 'warning'); return }
        data = r.payload; low = r.lowConfidence
      } else if (fmt === 'canvas') {
        const r = fromJsonCanvas(JSON.parse(text))
        if (!r.payload.blocks.length) { showToast('That canvas has no nodes in it', 'warning'); return }
        data = r.payload; low = r.lowConfidence
      } else {
        data = JSON.parse(text)
      }

      const hasContent = Object.keys(state.blocks).length > 0
      const mode = !hasContent
        ? 'replace'
        : (confirm(
            'Import canvas?\n\n' +
            'OK  \u2192 Replace current canvas\n' +
            'Cancel \u2192 Merge (add to existing canvas)'
          ) ? 'replace' : 'merge')

      const { imported, dropped, idMap } = applyImport(data, mode)
      collapseTemplatesAfterUse()
      refreshSituation(); refreshCardStyles(); refreshSpotlight()
      reportImport(imported, dropped)
      if (low.length) {
        window.dispatchEvent(new CustomEvent('pf:show-type-chips', {
          detail: low.map(id => ({ id: (idMap && idMap[id]) || id, confidence: 'low' })),
        }))
      }
    }
    reader.onerror = () => showToast('Could not read file', 'error')
    reader.readAsText(file)
  })
}

// ── Header buttons ───────────────────────────────────────────
// ── Canvas-wide card style ───────────────────────────────────

/**
 * The default look for every block that has not overridden it. Lives on the
 * canvas (not in ui) so it travels with a share link and an exported JSON:
 * a diagram someone else opens should look like the one you sent.
 */
export function setupCardStyles() {
  const wrapper = document.getElementById('cardsWrapper')
  const menu = document.getElementById('cardsDropdown')
  if (!wrapper || !menu) return

  const paint = () => {
    menu.innerHTML = Object.entries(CARD_STYLES).map(([k, v]) => {
      const on = (canvasMeta.cardStyle || DEFAULT_CARD_STYLE) === k
      return `<div class="export-item${on ? ' active' : ''}" data-canvas-card="${k}" title="${escHtml(v.hint)}">` +
             `<span class="card-swatch card-swatch-${k}"></span>${escHtml(v.label)}</div>`
    }).join('')
  }
  paint()
  syncCardStyles = paint

  document.getElementById('cardsBtn').addEventListener('click', e => {
    e.stopPropagation()
    const open = wrapper.classList.toggle('open')
    document.getElementById('cardsBtn').setAttribute('aria-expanded', open ? 'true' : 'false')
  })
  menu.addEventListener('click', e => {
    const item = e.target.closest('[data-canvas-card]'); if (!item) return
    canvasMeta.cardStyle = item.dataset.canvasCard
    paint()
    wrapper.classList.remove('open')
    renderAllBlocks(); renderArrows({ cheap: false }); renderFrames()
    renderInspector()
    saveState()
    showToast(`Cards set to ${CARD_STYLES[canvasMeta.cardStyle].label}`, 'success', 1500)
  })
  document.addEventListener('click', () => wrapper.classList.remove('open'))
}

let syncCardStyles = () => {}
export function refreshCardStyles() { syncCardStyles() }

/** Spotlight rides on the canvas, so an imported one arrives already on. */
export function refreshSpotlight() {
  document.body.classList.toggle('spotlight', !!canvasMeta.spotlight)
}

// ── Tidy (auto-layout) ───────────────────────────────────────

const DIR_KEY = 'pathfinder-layout-dir'
let layoutDir = 'LR'
try { const d = localStorage.getItem(DIR_KEY); if (d === 'LR' || d === 'TB') layoutDir = d } catch (_) {}

function refreshDirButton() {
  const btn = document.getElementById('tidyDirBtn'); if (!btn) return
  const label = layoutDir === 'LR' ? 'Left to right' : 'Top to bottom'
  btn.title = 'Layout direction: ' + label + '. Click to switch.'
  btn.setAttribute('aria-label', 'Layout direction: ' + label)
  btn.style.transform = layoutDir === 'LR' ? '' : 'rotate(90deg)'
}

/**
 * Re-lay the canvas and animate every block to its new home.
 *
 * Positions land in one undo step (tidyCanvas takes the snapshot), so Cmd+Z
 * restores the whole arrangement. Arrows are re-rendered each frame during the
 * transition, then routed properly once it settles.
 */
export function runTidy() {
  if (ui.readOnly) return
  const count = Object.keys(state.blocks).length
  if (count < 2) { showToast('Add at least two blocks to arrange', 'info', 1600); return }

  const { moved, crossings } = tidyCanvas({ direction: layoutDir })
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
  const dir = layoutDir === 'LR' ? 'left to right' : 'top to bottom'
  showToast(
    moved
      ? `Arranged ${count} blocks ${dir}, ${crossings} crossing${crossings === 1 ? '' : 's'}. Undo with Cmd+Z`
      : 'Already arranged',
    'success', 2600)
}

export function setupTidy() {
  refreshDirButton()
  document.getElementById('tidyBtn')?.addEventListener('click', runTidy)
  document.getElementById('tidyDirBtn')?.addEventListener('click', () => {
    layoutDir = layoutDir === 'LR' ? 'TB' : 'LR'
    try { localStorage.setItem(DIR_KEY, layoutDir) } catch (_) {}
    refreshDirButton()
    runTidy()
  })
}

export function setupHeaderButtons() {
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (!confirm('Clear the entire canvas? All blocks and connections will be lost.')) return
    snapshot()
    state.blocks = {}; state.arrows = []; state.groups = {}
    $.canvasRoot().querySelectorAll('.block').forEach(el => el.remove())
    $.canvasRoot().querySelectorAll('.group-frame').forEach(el => el.remove())
    $.arrowsGroup().innerHTML = ''
    selection.ids.clear(); selection.blockId = null; selection.arrowId = null
    renderInspector(); updateHint(); saveState()
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })

  document.getElementById('fitBtn').addEventListener('click', fitView)

  document.getElementById('helpBtn')?.addEventListener('click', openShortcuts)

  document.getElementById('themeBtn').addEventListener('click', () => {
    ui.lightMode = !ui.lightMode
    applyTheme()
    try { localStorage.setItem('pathfinder-theme', ui.lightMode ? 'light' : '') } catch(_) {}
  })

  document.getElementById('tintBtn').addEventListener('click', () => {
    ui.tintedBlocks = !ui.tintedBlocks
    document.body.classList.toggle('tinted-blocks', ui.tintedBlocks)
    document.getElementById('tintBtn').classList.toggle('active', ui.tintedBlocks)
    try { localStorage.setItem('pathfinder-tint', ui.tintedBlocks ? '1' : '') } catch(_) {}
  })

  document.getElementById('snapBtn').addEventListener('click', () => {
    ui.snapToGrid = !ui.snapToGrid
    document.getElementById('snapBtn').classList.toggle('active', ui.snapToGrid)
    document.body.classList.toggle('snap-grid', ui.snapToGrid)
    try { localStorage.setItem('pathfinder-snap', ui.snapToGrid ? '1' : '0') } catch(_) {}
    if (ui.snapToGrid) {
      // Immediately align every existing block to the grid so the toggle has a
      // visible effect, not just a behavior change for future drags.
      snapshot()
      Object.values(state.blocks).forEach(b => {
        b.x = snapTo(b.x)
        b.y = snapTo(b.y)
      })
      renderAllBlocks(); renderArrows(); renderFrames(); debouncedSave()
      showToast('Snapped all blocks to the grid', 'success', 1500)
    } else {
      showToast('Grid snapping off', 'info', 1200)
    }
  })

  // Arrow text: default OFF (notes reveal on hover/selection). Persist toggle.
  const arrowTextBtn = document.getElementById('arrowTextBtn')
  if (arrowTextBtn) {
    arrowTextBtn.classList.toggle('active', ui.showArrowText)
    document.body.classList.toggle('show-arrow-text', ui.showArrowText)
    arrowTextBtn.addEventListener('click', () => {
      ui.showArrowText = !ui.showArrowText
      arrowTextBtn.classList.toggle('active', ui.showArrowText)
      document.body.classList.toggle('show-arrow-text', ui.showArrowText)
      try { localStorage.setItem('pathfinder-arrowtext', ui.showArrowText ? '1' : '0') } catch(_) {}
    })
  }

  // Pin ports: default ON. Reflect initial state + persist the toggle.
  const pinBtn = document.getElementById('pinPortsBtn')
  if (pinBtn) {
    pinBtn.classList.toggle('active', ui.pinPorts)
    pinBtn.addEventListener('click', () => {
      ui.pinPorts = !ui.pinPorts
      pinBtn.classList.toggle('active', ui.pinPorts)
      try { localStorage.setItem('pathfinder-pinports', ui.pinPorts ? '1' : '0') } catch(_) {}
    })
  }
}

export function applyTheme() {
  document.body.classList.toggle('light-mode', ui.lightMode)
  const btn = document.getElementById('themeBtn')
  btn.textContent = ui.lightMode ? '☾' : '☀'
  btn.classList.toggle('active', ui.lightMode)
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

  // Advanced types sub-section toggle (nested inside Blocks)
  const advToggle = document.getElementById('advancedBlocksToggle')
  if (advToggle) {
    document.querySelector('#advancedBlocks .palette-subsection-body').inert = true
    advToggle.addEventListener('click', () => {
      const sub = document.getElementById('advancedBlocks')
      sub.classList.toggle('collapsed')
      const open = !sub.classList.contains('collapsed')
      advToggle.setAttribute('aria-expanded', open)
      sub.querySelector('.palette-subsection-body').inert = !open
    })
  }

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
      runTidy()
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
export function checkShareUrl() {
  const hash = location.hash
  if (!hash.startsWith('#s=')) return
  try {
    const data = JSON.parse(decodeURIComponent(atob(hash.slice(3))))
    if (!data.blocks) return
    // Read-only documents live in the URL, so retain it for reloads and copies.
    if (!ui.readOnly) {
      const params = new URLSearchParams(location.search)
      params.delete('src') // the hash takes precedence over a competing URL source
      const query = params.toString()
      history.replaceState(null, '', location.pathname + (query ? '?' + query : ''))
    }
    const isEmpty = Object.keys(state.blocks).length === 0
    const mode = (isEmpty || ui.readOnly) ? 'replace'
      : (confirm('Load shared canvas?\n\nOK \u2192 Replace current canvas\nCancel \u2192 Merge into existing') ? 'replace' : 'merge')
    const { dropped } = applyImport(data, mode)
    collapseTemplatesAfterUse()
    refreshSituation(); refreshCardStyles(); refreshSpotlight()
    updateCanvasTitle()
    syncContextBrief()
    const skipped = dropped.blocks + dropped.arrows + dropped.groups
    if (skipped) showToast(`Loaded shared canvas, skipped ${skipped} invalid item${skipped === 1 ? '' : 's'}`, 'warning')
    return true
  } catch(_) { /* malformed hash -- silently ignore */ }
}

// ── ?src= loader ─────────────────────────────────────────────
/**
 * Load a canvas from a URL: ?src=https://... pointing at canvas JSON, the
 * pattern proctor-site established. It is the link an agent can hand over
 * when a #s= hash would be unwieldy: a gist, a raw file in a repo. Only
 * https, only hosts the CSP allows (GitHub raw/gist plus same-origin), a
 * 1 MB cap, and the same replace-or-merge confirmation a share link gets.
 */
export async function checkSrcUrl() {
  const params = new URLSearchParams(location.search)
  const src = params.get('src')
  if (!src) return
  if (!/^https:\/\//.test(src) && !src.startsWith('/')) {
    showToast('?src= must be an https URL', 'warning'); return
  }
  // Editable imports autosave. Read-only documents need their source on reload.
  if (!ui.readOnly) {
    params.delete('src')
    const query = params.toString()
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + location.hash)
  }
  try {
    const res = await fetch(src, { credentials: 'omit' })
    if (!res.ok) { showToast(`Could not load ?src= (HTTP ${res.status})`, 'warning'); return }
    const text = await res.text()
    if (text.length > 1_000_000) { showToast('That canvas file is over 1 MB; import it as a file instead', 'warning'); return }
    const data = JSON.parse(text)
    if (!data || (!data.blocks && !data.arrows)) { showToast('That URL has no canvas in it', 'warning'); return }
    const isEmpty = Object.keys(state.blocks).length === 0
    const mode = (isEmpty || ui.readOnly) ? 'replace'
      : (confirm('Load canvas from the link?\n\nOK \u2192 Replace current canvas\nCancel \u2192 Merge into existing') ? 'replace' : 'merge')
    const { imported, dropped } = applyImport(data, mode)
    collapseTemplatesAfterUse()
    refreshSituation(); refreshCardStyles(); refreshSpotlight()
    updateCanvasTitle()
    syncContextBrief()
    const skipped = dropped.blocks + dropped.arrows + dropped.groups
    showToast(skipped
      ? `Loaded ${imported} blocks from the link, skipped ${skipped} invalid item${skipped === 1 ? '' : 's'}`
      : `Loaded ${imported} block${imported === 1 ? '' : 's'} from the link`, skipped ? 'warning' : 'success')
  } catch (_) {
    showToast('Could not fetch ?src= (network, CORS, or a host the app does not allow)', 'warning')
  }
}
