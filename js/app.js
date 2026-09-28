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
  setupKeyboardShortcuts, setupTabNavigation
} from './events.js'
import { setupPasteHandler, setupTypeChips, setupBrainDump } from './classify.js'
import { setupPalette } from './palette.js'
import { setupInspectorEvents } from './inspector.js'
import { applyPrefs } from './prefs.js'
import { setupArrowEdit } from './arrow-edit.js'
import { setupViewMenu } from './view-menu.js'
import { setupZoomControls } from './zoom-controls.js'
import { setupSharingSafety } from './sharing.js'
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
  // Per-browser preferences (motion) are body classes; apply them before
  // anything renders so nothing animates for a frame and then stops.
  applyPrefs()

  const fromLink = /^#[sz]=/.test(location.hash) || params.has('src')
  // View-only arrivals must never display or merge the visitor's private map.
  if (!ui.embed && !(ui.readOnly && fromLink)) loadState()
  if (!checkShareUrl()) checkSrcUrl()
  updateCanvasTitle()

  // Restore theme preference. Dark is the default identity: only switch to
  // light when the user has explicitly chosen it before (no OS-preference opt-in).
  try {
    if (localStorage.getItem('pathfinder-theme') === 'light') ui.lightMode = true
  } catch(_) {}
  if (ui.lightMode) applyTheme()

  // Restore pin-ports preference (default OFF since 2026-09-28)
  try { const p = localStorage.getItem('pathfinder-pinports'); if (p !== null) ui.pinPorts = p === '1' } catch(_) {}

  // Restore arrow-text preference (default OFF)
  try { ui.showArrowText = localStorage.getItem('pathfinder-arrowtext') === '1' } catch(_) {}
  if (ui.showArrowText) document.body.classList.add('show-arrow-text')

  // Restore grid-snap preference (default OFF)
  try { ui.snapToGrid = localStorage.getItem('pathfinder-snap') === '1' } catch(_) {}
  if (ui.snapToGrid) document.body.classList.add('snap-grid')

  // Legacy tint: the Tinted card preset replaced its toggle, which has no row
  // of its own any more. A browser that still has it on keeps the look (View
  // names it beside the card style) until the next Card style pick clears it.
  try { ui.tintedBlocks = !!localStorage.getItem('pathfinder-tint') } catch(_) {}
  if (ui.tintedBlocks) document.body.classList.add('tinted-blocks')

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
  setupArrowEdit()
  setupViewMenu()
  setupZoomControls()
  setupSharingSafety()

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
