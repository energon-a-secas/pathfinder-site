// ════════════════════════════════════════════════════════════
//  ui-panels.js — Search, shortcuts overlay, panel tabs,
//                 dev options, export/share/import dropdowns, header buttons
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, canvasMeta, devOpts,
         saveState, buildShareUrl, buildEmbedUrl, snapshot, debouncedSave } from './state.js'
import { $, TYPES, clamp, escHtml, showToast, getBlockDims, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { applyTransform, renderArrows, renderFrames, fitView, updateHint } from './canvas.js'
import { renderAllBlocks, renderInspector, selectBlock } from './render.js'
import { TEMPLATES, TICONS, applyTemplate } from './templates.js'
import { refreshPrompt, markExported } from './prompt.js'
import { applyImport, exportJSON, exportMarkdown, exportCopyPrompt, exportMeetingSummary } from './export.js'
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
      markExported()
      ui.promptDirty = true; refreshPrompt()
      const btn = document.getElementById('copyPromptBtn')
      btn.textContent = '\u2713 Copied!'; btn.classList.add('copied')
      setTimeout(() => { btn.textContent = 'Copy Prompt'; btn.classList.remove('copied') }, 2000)
    })
  })
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
    exportCopyPrompt()
    markExported()
    ui.promptDirty = true; refreshPrompt()
  })

  document.getElementById('exportJSON').addEventListener('click', () => {
    exportJSON()
  })

  document.getElementById('exportMarkdown').addEventListener('click', () => {
    exportMarkdown()
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
  document.getElementById('shareCopyLink').addEventListener('click', () => {
    navigator.clipboard.writeText(buildShareUrl(false)).then(() => showToast('Link copied!'))
    setDropdownOpen('shareWrapper', false)
  })
  document.getElementById('shareCopyReadOnly').addEventListener('click', () => {
    navigator.clipboard.writeText(buildShareUrl(true)).then(() => showToast('View-only link copied!'))
    setDropdownOpen('shareWrapper', false)
  })
  document.getElementById('shareCopyEmbed').addEventListener('click', () => {
    const src = buildEmbedUrl()
    const snippet = `<iframe src="${src}" width="800" height="500" style="border:none;border-radius:12px" allowfullscreen></iframe>`
    navigator.clipboard.writeText(snippet).then(() => showToast('Embed code copied!'))
    setDropdownOpen('shareWrapper', false)
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
    applyImport(data, mode)
    if (data.meta?.title) { canvasMeta.title = data.meta.title }
  } catch(_) { /* malformed hash -- silently ignore */ }
}
