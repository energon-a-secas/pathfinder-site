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
  setupKeyboardShortcuts, setupTabNavigation, setupPalette, setupInspectorEvents, setupPasteHandler
} from './events.js'
import {
  setupSearchEvents, buildShortcutGrid, setupShortcutOverlay,
  setupPanelTabs, setupDevOptions, setupCopyPrompt,
  setupExportDropdown, setupShareDropdown, setupImportHandler,
  setupHeaderButtons, setupTemplates, checkShareUrl
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
  setupTemplates()

  renderAllBlocks()
  updateHint()
  requestAnimationFrame(() => {
    renderArrows()
    renderFrames()
    runGapDetection()
    if (Object.keys(state.blocks).length) fitView()
    renderInspector()
    refreshPrompt()
  })
}

init()
