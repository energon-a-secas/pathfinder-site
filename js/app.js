// ════════════════════════════════════════════════════════════
//  app.js — Entry point: imports everything, initializes
// ════════════════════════════════════════════════════════════

import { state, ui, canvasMeta, loadState, loadView } from './state.js'
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
import { setupChrome } from './chrome.js'
import { setupLibrary } from './library.js'
import { setupPatchUI } from './patch.js'
import { setupReview } from './review.js'
import { setupPersistence } from './persistence-ui.js'
import { setupAttention } from './attention.js'
import { setupComparison } from './comparison-ui.js'
import { checkSrcUrl } from './ui-panels.js'
import {
  setupSearchEvents, buildShortcutGrid, setupShortcutOverlay,
  setupPanelTabs, setupDevOptions, setupCopyPrompt, setupTimer,
  setupExportDropdown, setupShareDropdown, setupImportHandler,
  setupHeaderButtons, setupPaletteSections, setupTemplates, checkShareUrl, applyTheme,
  setupContextBrief, setupQuickCopy, refreshQuickCopy, setupPanelCollapse, setupTidy, setupCardStyles, setupSituation, setupGapBreakdown
} from './ui-panels.js'

// ── Init ─────────────────────────────────────────────────────
function init() {
  const params = new URLSearchParams(location.search)
  ui.embed    = params.has('embed')
  ui.readOnly = params.has('readonly') || ui.embed
  if (ui.embed)    document.body.classList.add('embed-mode')
  if (ui.readOnly) document.body.classList.add('readonly-mode')

  const fromLink = location.hash.startsWith('#s=') || params.has('src')
  // View-only arrivals must never display or merge the visitor's private map.
  if (!ui.embed && !(ui.readOnly && fromLink)) loadState()
  if (!checkShareUrl()) checkSrcUrl()
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

  // Restore grid-snap preference (default OFF)
  try { ui.snapToGrid = localStorage.getItem('pathfinder-snap') === '1' } catch(_) {}
  if (ui.snapToGrid) {
    document.body.classList.add('snap-grid')
    document.getElementById('snapBtn')?.classList.add('active')
  }

  // Restore tint preference
  try { ui.tintedBlocks = !!localStorage.getItem('pathfinder-tint') } catch(_) {}
  if (ui.tintedBlocks) {
    document.body.classList.add('tinted-blocks')
    document.getElementById('tintBtn')?.classList.add('active')
  }
  // Restore the camera. A share link brings its own canvas, so that case
  // still fits to the diagram rather than reusing wherever you last were.
  const restoredView = !fromLink && !ui.embed && loadView()
  if (canvasMeta.spotlight) document.body.classList.add('spotlight')
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
  setupQuickCopy()
  setupGapBreakdown()
  setupPanelCollapse()
  setupTidy()
  setupCardStyles()
  setupSituation()
  setupChrome()
  setupLibrary()
  setupPersistence()
  setupPatchUI()
  setupAttention()
  setupComparison()
  setupReview()

  renderAllBlocks()
  updateHint()
  requestAnimationFrame(() => {
    renderArrows()
    renderFrames()
    runGapDetection()
    if (!restoredView && Object.keys(state.blocks).length) fitView()
    renderInspector()
    refreshPrompt()
    refreshQuickCopy()
  })
}

init()
