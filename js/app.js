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
  setupHeaderButtons, setupPaletteSections, setupTemplates, checkShareUrl, applyTheme
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

  // Restore theme preference (light/dark)
  try {
    const saved = localStorage.getItem('pathfinder-theme')
    if (saved === 'light') ui.lightMode = true
    else if (saved === null && window.matchMedia('(prefers-color-scheme: light)').matches) ui.lightMode = true
  } catch(_) {}
  if (ui.lightMode) applyTheme()

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
  setupPaletteSections()
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
