// ════════════════════════════════════════════════════════════
//  events.js — Core canvas interactions: pointer events, keyboard
//              shortcuts, palette, inspector panel, canvas title, hover
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, canvasMeta, pointer,
         debouncedSave, snapshot, snap, toWorld } from './state.js'
import { $, clamp, getBlockEl, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { applyTransform, portPos, cpOffset, renderArrows, fitView,
         blockAtWorld, blocksInRect } from './canvas.js'
import { renderBlock, renderInspector, renderQuestions,
         selectBlock, addToSelection, setSelection, selectArrow, deselectAll,
         mutateBlock, createBlock, deleteBlock, addArrow, deleteArrow,
         duplicateBlock, deleteBlocksBatch, undo, redo } from './render.js'
import { runGapDetection } from './gaps.js'
import { openSearch, closeSearch, openShortcuts, closeShortcuts } from './ui-panels.js'

// ── Canvas title editing ─────────────────────────────────────
export function setupCanvasTitle() {
  const canvasTitleEl = $.canvasTitle()
  canvasTitleEl.addEventListener('click', () => {
    if (ui.readOnly) return
    canvasTitleEl.contentEditable = 'true'
    canvasTitleEl.focus()
    const r = document.createRange(); r.selectNodeContents(canvasTitleEl)
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
  })
  canvasTitleEl.addEventListener('blur', () => {
    canvasTitleEl.contentEditable = 'false'
    canvasMeta.title = canvasTitleEl.textContent.trim()
    const el = $.canvasTitle()
    const t = canvasMeta.title || 'Strategy canvas'
    if (el.contentEditable !== 'true') el.textContent = t
    document.title = canvasMeta.title ? canvasMeta.title + ' | Pathfinder' : 'Pathfinder | Strategy Canvas'
    debouncedSave()
  })
  canvasTitleEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); canvasTitleEl.blur() }
    e.stopPropagation()
  })
}

// ── Arrow click ──────────────────────────────────────────────
export function setupArrowEvents() {
  $.arrowsLayer().addEventListener('pointerdown', e => {
    const g = e.target.closest('[data-aid]'); if (!g) return
    selectArrow(g.dataset.aid)
    e.stopPropagation()
  })
}

// ── Canvas pointer events ────────────────────────────────────
export function setupCanvasPointerEvents() {
  const canvasViewport = $.canvasViewport()
  const canvasRoot     = $.canvasRoot()
  const arrowPreview   = $.arrowPreview()
  const selectBox      = $.selectBox()
  const inspTitle      = $.inspTitle()

  canvasViewport.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    canvasViewport.setPointerCapture(e.pointerId)

    const port  = e.target.closest('.port')
    const block = e.target.closest('.block')

    if (port) {
      if (ui.readOnly) return
      e.stopPropagation()
      const bid  = port.dataset.bid
      const pp   = portPos(bid, port.dataset.port); if (!pp) return
      pointer.ix = { type: 'arrow', fromId: bid, x1: pp.x, y1: pp.y, d1: pp.dir }
      arrowPreview.setAttribute('d', '')

    } else if (block) {
      const id = block.dataset.id
      if (ui.readOnly) { selectBlock(id); pointer.ix = null; return }
      if (e.shiftKey) { addToSelection(id); pointer.ix = null; return }
      const alreadyInMulti = selection.ids.has(id) && selection.ids.size > 1
      if (!alreadyInMulti) selectBlock(id)
      const startPositions = {}
      selection.ids.forEach(sid => { const sb = state.blocks[sid]; if (sb) startPositions[sid] = { x: sb.x, y: sb.y } })
      pointer.ix = { type: 'block', id, startX: e.clientX, startY: e.clientY,
             startBX: state.blocks[id]?.x||0, startBY: state.blocks[id]?.y||0,
             startPositions, moved: false, snapshotted: false, willDeselect: alreadyInMulti }

    } else {
      deselectAll()
      if (e.shiftKey) {
        const r = canvasViewport.getBoundingClientRect()
        const w = toWorld(e.clientX - r.left, e.clientY - r.top)
        pointer.ix = { type: 'select', startX: e.clientX, startY: e.clientY, startWX: w.x, startWY: w.y }
      } else {
        pointer.ix = { type: 'pan', startX: e.clientX, startY: e.clientY, startPX: view.panX, startPY: view.panY }
        canvasViewport.style.cursor = 'grabbing'
      }
    }
  })

  canvasViewport.addEventListener('pointermove', e => {
    const ix = pointer.ix
    if (!ix) return
    if (ix.type === 'pan') {
      view.panX = ix.startPX + (e.clientX - ix.startX)
      view.panY = ix.startPY + (e.clientY - ix.startY)
      applyTransform()

    } else if (ix.type === 'select') {
      const r = canvasViewport.getBoundingClientRect()
      const vx1 = Math.min(ix.startX, e.clientX) - r.left, vy1 = Math.min(ix.startY, e.clientY) - r.top
      const vx2 = Math.max(ix.startX, e.clientX) - r.left, vy2 = Math.max(ix.startY, e.clientY) - r.top
      selectBox.style.display = 'block'
      selectBox.style.left   = vx1+'px'; selectBox.style.top    = vy1+'px'
      selectBox.style.width  = (vx2-vx1)+'px'; selectBox.style.height = (vy2-vy1)+'px'

    } else if (ix.type === 'block') {
      const dx = e.clientX - ix.startX, dy = e.clientY - ix.startY
      if (!ix.moved && (Math.abs(dx)>3||Math.abs(dy)>3)) {
        ix.moved = true
        selection.ids.forEach(sid => getBlockEl(sid)?.classList.add('dragging'))
        ix.snapshotted || (snapshot(), ix.snapshotted = true)
      }
      if (ix.moved) {
        if (selection.ids.size > 1 && selection.ids.has(ix.id)) {
          selection.ids.forEach(sid => {
            const sb = state.blocks[sid], sp = ix.startPositions[sid]; if (!sb||!sp) return
            sb.x = snap(sp.x + dx/view.zoom); sb.y = snap(sp.y + dy/view.zoom)
            const sel = getBlockEl(sid)
            if (sel) { sel.style.left = sb.x+'px'; sel.style.top = sb.y+'px' }
          })
        } else {
          const b = state.blocks[ix.id]; if (!b) return
          b.x = snap(ix.startBX + dx/view.zoom); b.y = snap(ix.startBY + dy/view.zoom)
          const el = getBlockEl(ix.id)
          if (el) { el.style.left = b.x+'px'; el.style.top = b.y+'px' }
        }
        requestAnimationFrame(renderArrows)
      }

    } else if (ix.type === 'arrow') {
      const r = canvasViewport.getBoundingClientRect()
      const w = toWorld(e.clientX - r.left, e.clientY - r.top)
      const c1 = cpOffset(ix.x1, ix.y1, ix.d1, 80)
      arrowPreview.setAttribute('d',
        `M ${ix.x1} ${ix.y1} C ${c1.x} ${c1.y}, ${w.x-50} ${w.y}, ${w.x} ${w.y}`)
    }
  })

  canvasViewport.addEventListener('pointerup', e => {
    const ix = pointer.ix
    if (!ix) return
    if (ix.type === 'pan') {
      canvasViewport.style.cursor = 'default'

    } else if (ix.type === 'select') {
      selectBox.style.display = 'none'
      const r = canvasViewport.getBoundingClientRect()
      const w = toWorld(e.clientX - r.left, e.clientY - r.top)
      const found = blocksInRect(ix.startWX, ix.startWY, w.x, w.y)
      if (found.length) setSelection(found)

    } else if (ix.type === 'block') {
      selection.ids.forEach(sid => getBlockEl(sid)?.classList.remove('dragging'))
      if (!ix.moved && ix.willDeselect) selectBlock(ix.id)
      if (ix.moved) { debouncedSave(); runGapDetection(); ui.promptDirty = true }

    } else if (ix.type === 'arrow') {
      arrowPreview.setAttribute('d', '')
      const r = canvasViewport.getBoundingClientRect()
      const w = toWorld(e.clientX - r.left, e.clientY - r.top)
      const tid = blockAtWorld(w.x, w.y)
      if (tid && tid !== ix.fromId) addArrow(ix.fromId, tid)
    }
    pointer.ix = null
  })

  canvasViewport.addEventListener('pointercancel', () => {
    const ix = pointer.ix
    if (ix?.type === 'arrow') arrowPreview.setAttribute('d', '')
    if (ix?.type === 'pan') canvasViewport.style.cursor = 'default'
    if (ix?.type === 'select') selectBox.style.display = 'none'
    if (ix?.type === 'block') selection.ids.forEach(sid => getBlockEl(sid)?.classList.remove('dragging'))
    pointer.ix = null
  })

  // Wheel zoom
  canvasViewport.addEventListener('wheel', e => {
    e.preventDefault()
    const r  = canvasViewport.getBoundingClientRect()
    const vx = e.clientX - r.left, vy = e.clientY - r.top
    const wx = (vx - view.panX)/view.zoom, wy = (vy - view.panY)/view.zoom
    view.zoom = clamp(view.zoom * (e.deltaY < 0 ? 1.1 : 0.9), MIN_ZOOM, MAX_ZOOM)
    view.panX = vx - wx*view.zoom
    view.panY = vy - wy*view.zoom
    applyTransform()
  }, { passive: false })

  // Double-click: edit title or fit view
  canvasViewport.addEventListener('dblclick', e => {
    const block = e.target.closest('.block')
    if (block) {
      if (ui.readOnly) return
      const bt = block.querySelector('.block-title'); if (!bt) return
      bt.contentEditable = 'true'; bt.focus()
      const r = document.createRange(); r.selectNodeContents(bt)
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r)
      e.preventDefault()
    } else {
      fitView()
    }
  })

  // Commit inline title edit on blur
  canvasRoot.addEventListener('blur', e => {
    const bt = e.target
    if (!bt.classList.contains('block-title') || bt.contentEditable !== 'true') return
    bt.contentEditable = 'false'
    const id = bt.closest('.block')?.dataset.id; if (!id) return
    const title = bt.textContent.trim()
    if (state.blocks[id]) {
      state.blocks[id].title = title
      if (selection.blockId === id) inspTitle.value = title
      debouncedSave(); ui.promptDirty = true
    }
  }, true)

  canvasRoot.addEventListener('keydown', e => {
    if (e.target.classList.contains('block-title') && e.target.contentEditable === 'true') {
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur() }
      e.stopPropagation()
    }
  })

  // Hover highlighting
  canvasRoot.addEventListener('pointerover', e => {
    const block = e.target.closest('.block')
    const id = block?.dataset.id || null
    if (id === ui.hoveredBlockId) return
    $.arrowsGroup().querySelectorAll('.related').forEach(el => el.classList.remove('related'))
    canvasRoot.querySelectorAll('.block.related').forEach(el => el.classList.remove('related'))
    ui.hoveredBlockId = id
    if (!id) { canvasRoot.classList.remove('has-hover'); return }
    canvasRoot.classList.add('has-hover')
    state.arrows.forEach(a => {
      if (a.from !== id && a.to !== id) return
      const g = $.arrowsGroup().querySelector(`[data-aid="${a.id}"]`)
      if (g) { g.classList.add('related'); g.querySelector('.arrow-path')?.classList.add('related') }
      getBlockEl(a.from === id ? a.to : a.from)?.classList.add('related')
    })
  })
  canvasRoot.addEventListener('pointerout', e => {
    if (e.relatedTarget && canvasRoot.contains(e.relatedTarget)) return
    $.arrowsGroup().querySelectorAll('.related').forEach(el => el.classList.remove('related'))
    canvasRoot.querySelectorAll('.block.related').forEach(el => el.classList.remove('related'))
    canvasRoot.classList.remove('has-hover')
    ui.hoveredBlockId = null
  })
}

// ── Keyboard shortcuts ───────────────────────────────────────
export function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault(); ui.searchOpen ? $.searchInput().focus() : openSearch(); return
    }
    if (e.key === '?') { e.preventDefault(); openShortcuts(); return }
    if (ui.readOnly) return
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.contentEditable === 'true') return
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); setSelection(Object.keys(state.blocks)); return }
    if (e.key === 'Escape') {
      if ($.shortcutOverlay().style.display !== 'none') { closeShortcuts(); return }
      if (ui.searchOpen) { closeSearch(); return }
      deselectAll(); return
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if      (selection.ids.size > 1)  deleteBlocksBatch([...selection.ids])
      else if (selection.blockId)       deleteBlock(selection.blockId)
      else if (selection.arrowId)       deleteArrow(selection.arrowId)
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'd' && selection.blockId) {
      e.preventDefault()
      const newId = duplicateBlock(selection.blockId)
      if (newId) selectBlock(newId)
    }
  })
}

// ── Palette ──────────────────────────────────────────────────
export function setupPalette() {
  document.getElementById('palette').addEventListener('click', e => {
    const item = e.target.closest('.palette-item'); if (!item) return
    const canvasViewport = $.canvasViewport()
    const r  = canvasViewport.getBoundingClientRect()
    const w  = toWorld(r.width/2, r.height/2)
    const id = createBlock(item.dataset.type, w.x, w.y)
    selectBlock(id)
  })
}

// ── Inspector panel events ───────────────────────────────────
export function setupInspectorEvents() {
  const inspTitle = $.inspTitle()
  const inspDesc  = $.inspDesc()
  const inspNotes = $.inspNotes()

  // Type picker
  $.typePicker().addEventListener('click', e => {
    const pill = e.target.closest('.type-pill'); if (!pill || !selection.blockId) return
    mutateBlock(selection.blockId, { type: pill.dataset.type })
    renderInspector()
  })

  inspTitle.addEventListener('input', () => {
    if (selection.blockId) mutateBlock(selection.blockId, { title: inspTitle.value })
  })
  inspDesc.addEventListener('input', () => {
    if (selection.blockId) mutateBlock(selection.blockId, { description: inspDesc.value })
  })
  inspNotes.addEventListener('input', () => {
    if (selection.blockId) mutateBlock(selection.blockId, { notes: inspNotes.value })
  })

  document.querySelectorAll('.action-toggle').forEach(btn =>
    btn.addEventListener('click', () => {
      if (!selection.blockId) return
      const b = state.blocks[selection.blockId]; if (!b) return
      const a = btn.dataset.action, i = b.actions.indexOf(a)
      if (i >= 0) b.actions.splice(i,1); else b.actions.push(a)
      btn.classList.toggle('active', b.actions.includes(a))
      renderBlock(selection.blockId); runGapDetection(); debouncedSave()
      ui.promptDirty = true
    })
  )

  document.getElementById('addQuestionBtn').addEventListener('click', () => {
    const b = state.blocks[selection.blockId]; if (!b) return
    b.questions.push(''); renderQuestions(b); debouncedSave(); ui.promptDirty = true
    setTimeout(() => { const ins = $.questionsList().querySelectorAll('input'); ins[ins.length-1]?.focus() }, 30)
  })

  document.getElementById('dupeBlockBtn').addEventListener('click', () => {
    if (!selection.blockId) return
    const newId = duplicateBlock(selection.blockId)
    if (newId) selectBlock(newId)
  })

  document.getElementById('deleteBlockBtn').addEventListener('click', () => {
    if (selection.blockId) deleteBlock(selection.blockId)
  })

  document.getElementById('deleteMultiBtn').addEventListener('click', () =>
    deleteBlocksBatch([...selection.ids])
  )

  document.getElementById('arrowLabelInput').addEventListener('input', () => {
    const a = state.arrows.find(arr => arr.id === selection.arrowId); if (!a) return
    a.label = document.getElementById('arrowLabelInput').value.trim()
    renderArrows(); debouncedSave(); ui.promptDirty = true
  })

  document.getElementById('deleteArrowBtn').addEventListener('click', () => {
    if (selection.arrowId) deleteArrow(selection.arrowId)
  })
}
