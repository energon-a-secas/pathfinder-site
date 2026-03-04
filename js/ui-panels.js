// ════════════════════════════════════════════════════════════
//  ui-panels.js — Search, shortcuts overlay, panel tabs,
//                 dev options, export/share/import dropdowns, header buttons
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, canvasMeta, devOpts,
         saveState, buildShareUrl } from './state.js'
import { $, TYPES, clamp, escHtml, showToast, getBlockDims, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { applyTransform, renderArrows, fitView, updateHint } from './canvas.js'
import { renderInspector, selectBlock } from './render.js'
import { refreshPrompt } from './prompt.js'
import { applyImport, exportJSON, exportMarkdown, exportCopyPrompt } from './export.js'

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

export function openShortcuts() { $.shortcutOverlay().style.display = '' }
export function closeShortcuts() { $.shortcutOverlay().style.display = 'none' }

export function setupShortcutOverlay() {
  document.getElementById('shortcutClose').addEventListener('click', closeShortcuts)
  $.shortcutOverlay().addEventListener('click', e => {
    if (e.target === $.shortcutOverlay()) closeShortcuts()
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

// ── Dev options ──────────────────────────────────────────────
export function setupDevOptions() {
  document.getElementById('devOptionsHeader').addEventListener('click', () =>
    document.getElementById('devOptions').classList.toggle('open')
  )
  document.getElementById('toneGroup').addEventListener('click', e => {
    const btn = e.target.closest('.radio-opt'); if (!btn) return
    document.querySelectorAll('#toneGroup .radio-opt').forEach(b => b.classList.remove('active'))
    btn.classList.add('active'); devOpts.tone = btn.dataset.value
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })
  document.getElementById('detailGroup').addEventListener('click', e => {
    const btn = e.target.closest('.radio-opt'); if (!btn) return
    document.querySelectorAll('#detailGroup .radio-opt').forEach(b => b.classList.remove('active'))
    btn.classList.add('active'); devOpts.detail = btn.dataset.value
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })
  document.getElementById('modeGroup').addEventListener('click', e => {
    const btn = e.target.closest('.radio-opt'); if (!btn) return
    document.querySelectorAll('#modeGroup .radio-opt').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    devOpts.mode = btn.dataset.value
    ui.promptDirty = true; refreshPrompt()
  })
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
    navigator.clipboard.writeText(promptOutput.value).then(() => {
      const btn = document.getElementById('copyPromptBtn')
      btn.textContent = '\u2713 Copied!'; btn.classList.add('copied')
      setTimeout(() => { btn.textContent = 'Copy Prompt'; btn.classList.remove('copied') }, 2000)
    })
  })
}

// ── Export dropdown ──────────────────────────────────────────
export function setupExportDropdown() {
  document.getElementById('exportBtn').addEventListener('click', e => {
    document.getElementById('exportWrapper').classList.toggle('open'); e.stopPropagation()
  })
  document.addEventListener('click', () => {
    document.getElementById('exportWrapper').classList.remove('open')
    document.getElementById('shareWrapper').classList.remove('open')
  })

  document.getElementById('exportCopyPrompt').addEventListener('click', () => {
    exportCopyPrompt()
  })

  document.getElementById('exportJSON').addEventListener('click', () => {
    exportJSON()
  })

  document.getElementById('exportMarkdown').addEventListener('click', () => {
    exportMarkdown()
  })

  document.getElementById('importJSON').addEventListener('click', () => {
    document.getElementById('exportWrapper').classList.remove('open')
    document.getElementById('importFile').value = ''
    document.getElementById('importFile').click()
  })
}

// ── Share dropdown ───────────────────────────────────────────
export function setupShareDropdown() {
  document.getElementById('shareBtn').addEventListener('click', e => {
    document.getElementById('shareWrapper').classList.toggle('open'); e.stopPropagation()
  })
  document.getElementById('shareCopyLink').addEventListener('click', () => {
    navigator.clipboard.writeText(buildShareUrl(false)).then(() => showToast('Link copied!'))
    document.getElementById('shareWrapper').classList.remove('open')
  })
  document.getElementById('shareCopyReadOnly').addEventListener('click', () => {
    navigator.clipboard.writeText(buildShareUrl(true)).then(() => showToast('View-only link copied!'))
    document.getElementById('shareWrapper').classList.remove('open')
  })
}

// ── Import file handler ──────────────────────────────────────
export function setupImportHandler() {
  document.getElementById('importFile').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      let data
      try { data = JSON.parse(ev.target.result) }
      catch(_) { alert('Invalid JSON file.'); return }

      const hasContent = Object.keys(state.blocks).length > 0
      if (!hasContent) { applyImport(data, 'replace'); return }

      const choice = confirm(
        'Import canvas?\n\n' +
        'OK  \u2192 Replace current canvas\n' +
        'Cancel \u2192 Merge (add to existing canvas)'
      )
      applyImport(data, choice ? 'replace' : 'merge')
    }
    reader.readAsText(file)
  })
}

// ── Header buttons ───────────────────────────────────────────
export function setupHeaderButtons() {
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (!confirm('Clear the entire canvas? All blocks and connections will be lost.')) return
    state.blocks = {}; state.arrows = []
    $.canvasRoot().querySelectorAll('.block').forEach(el => el.remove())
    $.arrowsGroup().innerHTML = ''
    selection.ids.clear(); selection.blockId = null; selection.arrowId = null
    renderInspector(); updateHint(); saveState()
    ui.promptDirty = true; if (ui.activeTab==='prompt') refreshPrompt()
  })

  document.getElementById('fitBtn').addEventListener('click', fitView)

  document.getElementById('snapBtn').addEventListener('click', () => {
    ui.snapToGrid = !ui.snapToGrid
    document.getElementById('snapBtn').classList.toggle('active', ui.snapToGrid)
  })
}

// ── Share URL loader ─────────────────────────────────────────
export function checkShareUrl() {
  const hash = location.hash
  if (!hash.startsWith('#s=')) return
  try {
    const data = JSON.parse(decodeURIComponent(atob(hash.slice(3))))
    if (!data.blocks) return
    history.replaceState(null, '', location.pathname + (ui.readOnly ? '?readonly' : ''))
    const isEmpty = Object.keys(state.blocks).length === 0
    const mode = isEmpty ? 'replace'
      : (confirm('Load shared canvas?\n\nOK \u2192 Replace current canvas\nCancel \u2192 Merge into existing') ? 'replace' : 'merge')
    applyImport(data, mode)
    if (data.meta?.title) { canvasMeta.title = data.meta.title }
  } catch(_) { /* malformed hash -- silently ignore */ }
}
