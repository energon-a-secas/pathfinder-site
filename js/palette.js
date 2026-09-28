// ════════════════════════════════════════════════════════════
//  palette.js: the left palette. Click, Enter or drag a type onto
//  the canvas. Moved out of events.js.
// ════════════════════════════════════════════════════════════

import { state, ui, toWorld } from './state.js'
import { $, TYPES } from './utils.js'
import { createBlockAt } from './create.js'

// ── Palette ──────────────────────────────────────────────────
export function setupPalette() {
  const palette = document.getElementById('palette')

  function addBlockAtCenter(item) {
    const r = $.canvasViewport().getBoundingClientRect()
    const w = toWorld(r.width / 2, r.height / 2)
    // A small stagger so repeated clicks do not stack cards exactly.
    const n = Object.keys(state.blocks).length % 5
    createBlockAt(item.dataset.type, w.x + n * 12, w.y + n * 10)
  }

  let lastDragTime = 0
  palette.addEventListener('click',   e => {
    if (Date.now() - lastDragTime < 300) return // skip click after drag
    const i = e.target.closest('.palette-item'); if (i) addBlockAtCenter(i)
  })
  palette.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const i = e.target.closest('.palette-item'); if (!i) return
    e.preventDefault(); addBlockAtCenter(i)
  })

  // Pointer-event-based drag from palette to canvas (works on touch + mouse)
  // Uses an 8px threshold before committing to drag so mobile scroll isn't hijacked
  const DRAG_THRESHOLD = 8
  let paletteDrag = null

  palette.addEventListener('pointerdown', e => {
    const item = e.target.closest('.palette-item'); if (!item) return
    if (ui.readOnly) return
    const type = item.dataset.type
    if (!type || !TYPES[type]) return
    paletteDrag = { type, item, ghost: null, startX: e.clientX, startY: e.clientY, committed: false }
    item.setPointerCapture(e.pointerId)
  })

  palette.addEventListener('pointermove', e => {
    if (!paletteDrag) return
    const dx = e.clientX - paletteDrag.startX
    const dy = e.clientY - paletteDrag.startY

    if (!paletteDrag.committed) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
      // Commit to drag: create the ghost
      paletteDrag.committed = true
      paletteDrag.item.classList.add('dragging')
      const ghost = document.createElement('div')
      ghost.className = 'palette-drag-ghost'
      ghost.textContent = TYPES[paletteDrag.type]?.label || paletteDrag.type
      ghost.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;pointer-events:none;z-index:1000`
      document.body.appendChild(ghost)
      paletteDrag.ghost = ghost
    }

    paletteDrag.ghost.style.left = e.clientX + 'px'
    paletteDrag.ghost.style.top = e.clientY + 'px'

    const vp = $.canvasViewport()
    const r = vp.getBoundingClientRect()
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    vp.classList.toggle('drop-target', over)
  })

  // Listen on document so pointerup is caught even when pointer leaves palette
  document.addEventListener('pointerup', e => {
    if (!paletteDrag) return
    const { type, item, ghost, committed } = paletteDrag
    paletteDrag = null
    item.classList.remove('dragging')
    if (ghost) ghost.remove()

    const vp = $.canvasViewport()
    vp.classList.remove('drop-target')

    if (!committed) return // click handled by click listener

    lastDragTime = Date.now()
    const r = vp.getBoundingClientRect()
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const w = toWorld(e.clientX - r.left, e.clientY - r.top)
      createBlockAt(type, w.x, w.y)
    }
  })

  document.addEventListener('pointercancel', () => {
    if (!paletteDrag) return
    paletteDrag.item.classList.remove('dragging')
    if (paletteDrag.ghost) paletteDrag.ghost.remove()
    paletteDrag = null
    $.canvasViewport().classList.remove('drop-target')
  })
}
