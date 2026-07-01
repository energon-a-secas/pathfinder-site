// ════════════════════════════════════════════════════════════
//  ui-panels.js — Search, shortcuts overlay, panel tabs,
//                 dev options, export/share/import dropdowns, header buttons
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, canvasMeta, devOpts,
         saveState, buildShareUrl, buildEmbedUrl, snapshot, debouncedSave } from './state.js'
import { $, TYPES, clamp, escHtml, showToast, getBlockDims, getSmallIcon, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { applyTransform, renderArrows, renderFrames, fitView, updateHint } from './canvas.js'
import { renderAllBlocks, renderInspector, selectBlock, updateCanvasTitle } from './render.js'
import { TEMPLATES, TICONS, applyTemplate } from './templates.js'
import { refreshPrompt, markExported, generatePrompt, computeHealthScore } from './prompt.js'
import { applyImport, exportJSON, exportMarkdown, exportMeetingSummary, exportToPresentationSage } from './export.js'
import { exportPNG, exportSVG } from './image-export.js'
import { runGapDetection } from './gaps.js'

// ── Search ───────────────────────────────────────────────────
function searchBlocks(query) {
  if (!query.trim()) return []
  const q = query.toLowerCase()
  return Object.values(state.blocks)
    .filter(b => (b.title||'').toLowerCase().includes(q) || b.type.includes(q))
    .slice(0, 8)
}

function focusBlock(id) {
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
  ui.searchOpen = true; ui.searchFocusIdx = -1
  $.searchOverlay().style.display = ''
  $.searchInput().value = ''; $.searchResults().innerHTML = ''
  $.searchResults().classList.remove('has-results')
  $.searchInput().focus()
}

export function closeSearch() {
  ui.searchOpen = false
  $.searchOverlay().style.display = 'none'
}

function renderSearchResults(results) {
  ui.searchFocusIdx = -1
  const searchResults = $.searchResults()
  if (!results.length) { searchResults.innerHTML = ''; searchResults.classList.remove('has-results'); return }
  searchResults.classList.add('has-results')
  searchResults.innerHTML = results.map((b, i) =>
    `<div class="search-result" data-id="${b.id}" data-i="${i}">
       <div class="search-result-dot" style="background:${TYPES[b.type]?.color||'#fff'}"></div>
       <span class="search-result-title">${escHtml(b.title||'(untitled)')}</span>
       <span class="search-result-type">${TYPES[b.type]?.label||b.type}</span>
     </div>`
  ).join('')
  searchResults.querySelectorAll('.search-result').forEach(el =>
    el.addEventListener('mousedown', ev => {
      ev.preventDefault()
      closeSearch(); focusBlock(el.dataset.id)
    })
  )
}

export function setupSearchEvents() {
  const overlay = $.searchOverlay()
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.addEventListener('keydown', e => trapFocus(overlay, e))

  const searchInput = $.searchInput()
  searchInput.addEventListener('input', () =>
    renderSearchResults(searchBlocks(searchInput.value))
  )

  searchInput.addEventListener('keydown', e => {
    const items = $.searchResults().querySelectorAll('.search-result')
    if (e.key === 'Escape') { e.preventDefault(); closeSearch() }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const focused = $.searchResults().querySelector('.search-result.focused')
      if (focused) { closeSearch(); focusBlock(focused.dataset.id) }
      else if (items[0]) { closeSearch(); focusBlock(items[0].dataset.id) }
    }
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      items.forEach(el => el.classList.remove('focused'))
      ui.searchFocusIdx = Math.min(ui.searchFocusIdx + 1, items.length - 1)
      items[ui.searchFocusIdx]?.classList.add('focused')
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      items.forEach(el => el.classList.remove('focused'))
      ui.searchFocusIdx = Math.max(ui.searchFocusIdx - 1, 0)
      items[ui.searchFocusIdx]?.classList.add('focused')
    }
    e.stopPropagation()
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
  ['Double-click canvas','Fit all blocks in view'],
  ['Drag port \u25CF',        'Draw connection arrow'],
  ['Tab / Shift+Tab',    'Navigate between blocks'],
  ['Enter / Space',      'Select focused block'],
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
  function showTab(tab) {
    ui.activeTab = tab
    document.querySelectorAll('.panel-tab').forEach(b => b.classList.toggle('active', b.dataset.tab===tab))
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id===tab+'Pane'))
    if (tab === 'prompt') { ui.promptDirty = true; refreshPrompt() }
  }
  document.querySelectorAll('.panel-tab').forEach(btn =>
    btn.addEventListener('click', () => showTab(btn.dataset.tab))
  )
}

// ── Prompt mode descriptions ─────────────────────────────────
// One-line plain-language explanation of what each mode asks the AI to do,
// shown under the mode selector so the choice isn't a guess.
const MODE_DESCS = {
  explore: 'Surfaces gaps, risky assumptions, and missing links — asks questions instead of proposing solutions. Good for pressure-testing an early canvas.',
  plan:    'Turns the canvas into a phased implementation plan with concrete outputs per phase. The default for "give me a roadmap".',
  build:   'Treats requirements and outputs as a task checklist and asks for working code. Use once the plan is settled.',
  clarify: 'Returns a prioritized list of clarifying questions (blocking → nice-to-have), each tied to a block, plus a readiness read. Best when you want gaps and useful questions before committing.',
}

export function refreshModeDesc() {
  const el = document.getElementById('modeDesc')
  if (el) el.textContent = MODE_DESCS[devOpts.mode] || MODE_DESCS.plan
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
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })
  document.getElementById('detailGroup').addEventListener('click', e => {
    const btn = e.target.closest('.radio-opt'); if (!btn) return
    document.querySelectorAll('#detailGroup .radio-opt').forEach(b => b.classList.remove('active'))
    btn.classList.add('active'); devOpts.detail = btn.dataset.value
    syncRadioAria(document.getElementById('detailGroup'))
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })
  document.getElementById('modeGroup').addEventListener('click', e => {
    const btn = e.target.closest('.radio-opt'); if (!btn) return
    document.querySelectorAll('#modeGroup .radio-opt').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    devOpts.mode = btn.dataset.value
    syncRadioAria(document.getElementById('modeGroup'))
    refreshModeDesc()
    ui.promptDirty = true; refreshPrompt()
  })
  refreshModeDesc()
  document.getElementById('prePromptGroup').addEventListener('click', e => {
    const btn = e.target.closest('.check-opt'); if (!btn) return
    btn.classList.toggle('active')
    btn.classList.contains('active') ? devOpts.prePrompts.add(btn.dataset.value)
                                     : devOpts.prePrompts.delete(btn.dataset.value)
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })
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
// navigator.clipboard.writeText rejects silently when the page isn't focused
// or over insecure origins. Fall back to a hidden textarea + execCommand so the
// copy still lands, and always surface success/failure to the user.
export function copyText(text) {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
      document.body.appendChild(ta)
      ta.focus(); ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch (_) { return false }
  }
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true, () => fallback())
  }
  return Promise.resolve(fallback())
}

// \u2500\u2500 Readiness verdict (plain-language go/no-go) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Pure function of the health score + gap count \u2014 no new persisted state.
function readiness() {
  const score = computeHealthScore()
  if (score === null) return null
  const { count: gaps } = runGapDetection()
  const blocks = Object.values(state.blocks)
  const hasGoal = blocks.some(b => b.type === 'goal')
  const hasReq  = blocks.some(b => b.type === 'requirement')

  if (score >= 80) return { grade: 'a', green: true, text: 'Looks solid \u2014 your AI has enough to plan' }
  if (score >= 50) {
    let tip = 'add a bit more detail'
    if (gaps) tip = `close ${gaps} gap${gaps > 1 ? 's' : ''}`
    else if (!hasReq) tip = 'add a requirement'
    else if (blocks.filter(b => !b.description?.trim()).length) tip = 'describe a few more blocks'
    return { grade: 'b', green: false, text: `Almost ready \u2014 ${tip} for a stronger plan` }
  }
  const next = !hasGoal ? 'Add a goal' : !hasReq ? 'Add a requirement' : 'Describe your blocks'
  return { grade: 'c', green: false, text: `${next} first for a useful plan` }
}

export function refreshReadinessVerdict() {
  const wrap = document.getElementById('copyPillWrap')
  if (!wrap) return
  if (ui.readOnly) { wrap.style.display = 'none'; return }
  const verdictEl = document.getElementById('copyPillVerdict')
  const v = readiness()
  if (!v) { verdictEl.textContent = ''; verdictEl.className = 'copy-pill-verdict'; return }
  verdictEl.textContent = v.text
  verdictEl.className = `copy-pill-verdict grade-${v.grade}`
}

export function setupCopyPill() {
  const pill = document.getElementById('copyPromptPill')
  if (!pill) return
  if (ui.readOnly) { document.getElementById('copyPillWrap').style.display = 'none'; return }
  const label = document.getElementById('copyPillLabel')

  // Always copy on click. The readiness verdict above the pill is the nudge for
  // an incomplete canvas — we never gate the actual copy behind a second click
  // (that made "I copied something else recently" look like a broken button).
  pill.addEventListener('click', () => {
    if (!Object.keys(state.blocks).length) { showToast('Add a block first', 'warning'); return }
    ui.promptDirty = true
    const text = generatePrompt()
    copyText(text).then(ok => {
      if (!ok) { showToast('Copy failed — open the Prompt tab and copy manually', 'warning'); return }
      markExported()
      ui.promptDirty = true; refreshPrompt()
      const v = readiness()
      showToast(v && !v.green ? `Copied — note: ${v.text}` : 'AI-ready prompt copied to clipboard', 'success')
      label.textContent = 'Copied!'; pill.classList.add('copied')
      setTimeout(() => { label.textContent = 'Copy AI-ready prompt'; pill.classList.remove('copied') }, 1800)
    })
  })
  window.addEventListener('pf:canvas-changed', refreshReadinessVerdict)
  refreshReadinessVerdict()
}

// ── Export dropdown ──────────────────────────────────────────
function setDropdownOpen(wrapperId, open) {
  const el = document.getElementById(wrapperId)
  el.classList.toggle('open', open)
  el.querySelector('.header-btn')?.setAttribute('aria-expanded', open ? 'true' : 'false')
  if (open) {
    const first = el.querySelector('.export-item')
    if (first) requestAnimationFrame(() => first.focus())
  }
}

function setupDropdownKeyboard(wrapperId) {
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
      if (!ok) { showToast('Copy failed — open the Prompt tab and copy manually', 'warning'); return }
      markExported()
      ui.promptDirty = true; refreshPrompt()
      showToast('AI-ready prompt copied to clipboard', 'success')
    })
  })

  document.getElementById('exportJSON').addEventListener('click', () => {
    exportJSON()
  })

  document.getElementById('exportMarkdown').addEventListener('click', () => {
    exportMarkdown()
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
    showToast(ok ? okMsg : 'Copy failed — try again', ok ? 'success' : 'warning'))
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
      let data
      try { data = JSON.parse(ev.target.result) }
      catch(_) { showToast('Could not read file: invalid JSON', 'error'); return }

      const hasContent = Object.keys(state.blocks).length > 0
      const mode = !hasContent
        ? 'replace'
        : (confirm(
            'Import canvas?\n\n' +
            'OK  \u2192 Replace current canvas\n' +
            'Cancel \u2192 Merge (add to existing canvas)'
          ) ? 'replace' : 'merge')

      const { imported, dropped } = applyImport(data, mode)
      reportImport(imported, dropped)
    }
    reader.onerror = () => showToast('Could not read file', 'error')
    reader.readAsText(file)
  })
}

// ── Header buttons ───────────────────────────────────────────
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
    try { localStorage.setItem('pathfinder-panel-collapsed', on ? '1' : '0') } catch(_) {}
  }
  // Restore persisted state (embed/readonly hides the panel entirely already).
  try { if (localStorage.getItem('pathfinder-panel-collapsed') === '1') panel.classList.add('collapsed') } catch(_) {}

  collapse.addEventListener('click', () => setCollapsed(true))
  reopen.addEventListener('click', () => setCollapsed(false))
}

// ── Palette sections & collapse ──────────────────────────────
export function setupPaletteSections() {
  // Section toggles (Templates, Blocks)
  document.querySelectorAll('.palette-section-toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const section = toggle.closest('.palette-section')
      section.classList.toggle('collapsed')
      toggle.setAttribute('aria-expanded', !section.classList.contains('collapsed'))
    })
  })

  // Advanced types sub-section toggle (nested inside Blocks)
  const advToggle = document.getElementById('advancedBlocksToggle')
  if (advToggle) {
    advToggle.addEventListener('click', () => {
      const sub = document.getElementById('advancedBlocks')
      sub.classList.toggle('collapsed')
      advToggle.setAttribute('aria-expanded', !sub.classList.contains('collapsed'))
    })
  }

  // Palette collapse button
  const collapseBtn = document.getElementById('paletteCollapseBtn')
  if (collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      const palette = document.getElementById('palette')
      palette.classList.toggle('collapsed')
      collapseBtn.title = palette.classList.contains('collapsed') ? 'Expand palette' : 'Collapse palette'
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

  const beepEmbed = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWTAkZYLTo6aZVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmFgU7k9n1unEiBC13yO/eizEIHWq+8+OWTQ=='

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  function updateWarningClass() {
    const minsLeft = timeRemaining / 60
    display.classList.remove('warning', 'critical')
    widget.classList.remove('active')

    if (timeRemaining > 0) {
      widget.classList.add('active')
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
    // Update icon based on state
    toggleBtn.innerHTML = isVisible ? getSmallIcon('clock') : getSmallIcon('timer')
  })

  // Initialize with clock icon
  toggleBtn.innerHTML = getSmallIcon('clock')

  startBtn.addEventListener('click', () => {
    if (timeRemaining === 0) {
      const mins = parseInt(minutesInput.value, 10) || 10
      timeRemaining = mins * 60
      originalTime = timeRemaining
    }

    isPaused = false
    startBtn.style.display = 'none'
    pauseBtn.style.display = ''

    interval = setInterval(() => {
      if (!isPaused && timeRemaining > 0) {
        timeRemaining--
        updateDisplay()
      }
    }, 1000)
  })

  pauseBtn.addEventListener('click', () => {
    isPaused = true
    startBtn.style.display = ''
    pauseBtn.style.display = 'none'
    startBtn.textContent = 'Resume'
  })

  resetBtn.addEventListener('click', () => {
    if (interval) {
      clearInterval(interval)
      interval = null
    }
    isPaused = false
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
export function setupTemplates() {
  const list = $.templatesList(); if (!list) return
  list.innerHTML = TEMPLATES.map((tpl, i) => `
    <div class="template-item" data-tpl="${i}" title="${escHtml(tpl.name)}">
      <div class="template-icon">${TICONS[tpl.icon] || ''}</div>
      <div>
        <div class="template-label">${escHtml(tpl.name)}</div>
        <div class="template-desc">${escHtml(tpl.desc)}</div>
      </div>
    </div>`).join('')
  list.addEventListener('click', e => {
    const item = e.target.closest('.template-item'); if (!item) return
    const tpl = TEMPLATES[+item.dataset.tpl]; if (!tpl) return
    snapshot()
    applyTemplate(tpl)
    renderAllBlocks()
    renderArrows()
    renderFrames()
    runGapDetection()
    updateHint()
    debouncedSave()
    ui.promptDirty = true
  })
}

// ── Share URL loader ─────────────────────────────────────────
export function checkShareUrl() {
  const hash = location.hash
  if (!hash.startsWith('#s=')) return
  try {
    const data = JSON.parse(decodeURIComponent(atob(hash.slice(3))))
    if (!data.blocks) return
    const qsParts = []; if (ui.embed) qsParts.push('embed'); if (ui.readOnly) qsParts.push('readonly')
    history.replaceState(null, '', location.pathname + (qsParts.length ? '?' + qsParts.join('&') : ''))
    const isEmpty = Object.keys(state.blocks).length === 0
    const mode = (isEmpty || ui.embed) ? 'replace'
      : (confirm('Load shared canvas?\n\nOK \u2192 Replace current canvas\nCancel \u2192 Merge into existing') ? 'replace' : 'merge')
    const { dropped } = applyImport(data, mode)
    updateCanvasTitle()
    syncContextBrief()
    const skipped = dropped.blocks + dropped.arrows + dropped.groups
    if (skipped) showToast(`Loaded shared canvas, skipped ${skipped} invalid item${skipped === 1 ? '' : 's'}`, 'warning')
  } catch(_) { /* malformed hash -- silently ignore */ }
}
