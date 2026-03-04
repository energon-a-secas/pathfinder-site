// ════════════════════════════════════════════════════════════
//  app.js — Entry point: imports everything, initializes
// ════════════════════════════════════════════════════════════

import { state, ui, loadState } from './state.js'
import { applyTransform, fitView, updateHint, renderArrows } from './canvas.js'
import { renderAllBlocks, renderInspector, updateCanvasTitle } from './render.js'
import { runGapDetection } from './gaps.js'
import { refreshPrompt } from './prompt.js'
import {
  setupCanvasTitle, setupArrowEvents, setupCanvasPointerEvents,
  setupKeyboardShortcuts, setupPalette, setupInspectorEvents
} from './events.js'
import {
  setupSearchEvents, buildShortcutGrid, setupShortcutOverlay,
  setupPanelTabs, setupDevOptions, setupCopyPrompt,
  setupExportDropdown, setupShareDropdown, setupImportHandler,
  setupHeaderButtons, checkShareUrl
} from './ui-panels.js'

// ── Init ─────────────────────────────────────────────────────
function init() {
  ui.readOnly = new URLSearchParams(location.search).has('readonly')
  if (ui.readOnly) document.body.classList.add('readonly-mode')

  loadState()
  checkShareUrl()
  updateCanvasTitle()
  applyTransform()

  // Wire up all event handlers
  setupCanvasTitle()
  setupArrowEvents()
  setupCanvasPointerEvents()
  setupKeyboardShortcuts()
  setupPalette()
  setupInspectorEvents()
  setupSearchEvents()
  buildShortcutGrid()
  setupShortcutOverlay()
  setupPanelTabs()
  setupDevOptions()
  setupCopyPrompt()
  setupExportDropdown()
  setupShareDropdown()
  setupImportHandler()
  setupHeaderButtons()

  renderAllBlocks()
  updateHint()
  requestAnimationFrame(() => {
    renderArrows()
    runGapDetection()
    if (Object.keys(state.blocks).length) fitView()
    renderInspector()
    refreshPrompt()
  })
}

init()
