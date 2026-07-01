// ════════════════════════════════════════════════════════════
//  app.js — Entry point: imports everything, initializes
// ════════════════════════════════════════════════════════════

import { state, ui, loadState } from './state.js'
import { applyTransform, fitView, updateHint, renderArrows, renderFrames } from './canvas.js'
import { renderAllBlocks, renderInspector, updateCanvasTitle } from './render.js'
import { runGapDetection } from './gaps.js'
import { refreshPrompt } from './prompt.js'
import {
  setupCanvasTitle, setupArrowEvents, setupCanvasPointerEvents,
  setupKeyboardShortcuts, setupTabNavigation, setupPalette, setupInspectorEvents, setupPasteHandler,
  setupTypeChips, setupBrainDump
} from './events.js'
import { setupContextMenu } from './context-menu.js'
import {
  setupSearchEvents, buildShortcutGrid, setupShortcutOverlay,
  setupPanelTabs, setupDevOptions, setupCopyPrompt, setupTimer,
  setupExportDropdown, setupShareDropdown, setupImportHandler,
  setupHeaderButtons, setupPaletteSections, setupTemplates, checkShareUrl, applyTheme,
  setupContextBrief, setupCopyPill, refreshReadinessVerdict, setupPanelCollapse
} from './ui-panels.js'

// ── Init ─────────────────────────────────────────────────────
function init() {
  const params = new URLSearchParams(location.search)
  ui.embed    = params.has('embed')
  ui.readOnly = params.has('readonly') || ui.embed
  if (ui.embed)    document.body.classList.add('embed-mode')
  if (ui.readOnly) document.body.classList.add('readonly-mode')

  loadState()
  checkShareUrl()
  updateCanvasTitle()

  // Restore theme preference. Dark is the default identity — only switch to
  // light when the user has explicitly chosen it before (no OS-preference opt-in).
  try {
    if (localStorage.getItem('pathfinder-theme') === 'light') ui.lightMode = true
  } catch(_) {}
  if (ui.lightMode) applyTheme()

  // Restore pin-ports preference (default ON)
  try { const p = localStorage.getItem('pathfinder-pinports'); if (p !== null) ui.pinPorts = p === '1' } catch(_) {}

  // Restore arrow-text preference (default OFF)
  try { ui.showArrowText = localStorage.getItem('pathfinder-arrowtext') === '1' } catch(_) {}
  if (ui.showArrowText) document.body.classList.add('show-arrow-text')

  // Restore tint preference
  try { ui.tintedBlocks = !!localStorage.getItem('pathfinder-tint') } catch(_) {}
  if (ui.tintedBlocks) {
    document.body.classList.add('tinted-blocks')
    document.getElementById('tintBtn')?.classList.add('active')
  }
  applyTransform()

  // Wire up all event handlers
  setupCanvasTitle()
  setupArrowEvents()
  setupCanvasPointerEvents()
  setupKeyboardShortcuts()
  setupTabNavigation()
  setupPalette()
  setupInspectorEvents()
  setupPasteHandler()
  setupTypeChips()
  setupContextMenu()
  setupBrainDump()
  setupSearchEvents()
  buildShortcutGrid()
  setupShortcutOverlay()
  setupPanelTabs()
  setupDevOptions()
  setupCopyPrompt()
  setupTimer()
  setupExportDropdown()
  setupShareDropdown()
  setupImportHandler()
  setupHeaderButtons()
  setupPaletteSections()
  setupTemplates()
  setupContextBrief()
  setupCopyPill()
  setupPanelCollapse()

  renderAllBlocks()
  updateHint()
  requestAnimationFrame(() => {
    renderArrows()
    renderFrames()
    runGapDetection()
    if (Object.keys(state.blocks).length) fitView()
    renderInspector()
    refreshPrompt()
    refreshReadinessVerdict()
  })
}

init()
