// ════════════════════════════════════════════════════════════
//  events.js — Core canvas interactions: pointer events, keyboard
//              shortcuts, palette, inspector panel, canvas title, hover
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, canvasMeta, pointer,
         debouncedSave, snapshot, snap, toWorld } from './state.js'
import { $, clamp, genId, getBlockEl, getBlockDims, escHtml, showToast, addVotesToBlock, TYPES, DEFAULT_WIDTH, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { applyTransform, portPos, cpOffset, renderArrows, renderFrames, fitView,
         blockAtWorld, blocksInRect, isLight, updateHint } from './canvas.js'
import { renderBlock, renderAllBlocks, renderInspector, renderQuestions,
         selectBlock, addToSelection, setSelection, selectArrow, deselectAll,
         mutateBlock, createBlock, deleteBlock, addArrow, deleteArrow,
         duplicateBlock, deleteBlocksBatch, createGroup, deleteGroup, undo, redo } from './render.js'
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
const activePointers = new Map()
let   pinchState     = null  // { startDist, startZoom, startPanX, startPanY, cx, cy }

export function setupCanvasPointerEvents() {
  const canvasViewport = $.canvasViewport()
  const canvasRoot     = $.canvasRoot()
  const arrowPreview   = $.arrowPreview()
  const selectBox      = $.selectBox()
  const inspTitle      = $.inspTitle()

  canvasViewport.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    // Overlay UI (Brain Dump card, copy pill, search box, zoom indicator) lives
    // inside the viewport. Don't capture the pointer for clicks that land on it —
    // capturing steals the follow-up `click` from the button and pans the canvas.
    if (e.target.closest('.brain-dump, .copy-pill-wrap, .search-overlay, .zoom-indicator')) return
    canvasViewport.setPointerCapture(e.pointerId)
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Two-finger pinch — cancel any single-pointer interaction and switch to pinch
    if (activePointers.size === 2) {
      selection.ids.forEach(sid => getBlockEl(sid)?.classList.remove('dragging'))
      arrowPreview.setAttribute('d', ''); canvasViewport.style.cursor = 'default'
      selectBox.style.display = 'none'; pointer.ix = null
      const pts = [...activePointers.values()]
      pinchState = {
        startDist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
        startZoom: view.zoom, startPanX: view.panX, startPanY: view.panY,
        cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2,
      }
      return
    }

    const resizeHandle = e.target.closest('.block-resize-handle')
    const collapseBtn  = e.target.closest('.block-collapse-btn')
    const port         = e.target.closest('.port')
    const block        = e.target.closest('.block')
    const frame        = !block && e.target.closest('.frame')

    if (resizeHandle) {
      if (ui.readOnly) return
      e.stopPropagation()
      const id = resizeHandle.dataset.bid; const b = state.blocks[id]; if (!b) return
      pointer.ix = { type: 'resize', id, startX: e.clientX, startW: b.width || DEFAULT_WIDTH }

    } else if (collapseBtn) {
      // handled by click event below — just prevent drag
      pointer.ix = null

    } else if (port) {
      if (ui.readOnly) return
      e.stopPropagation()
      const bid  = port.dataset.bid
      const pp   = portPos(bid, port.dataset.port); if (!pp) return
      pointer.ix = { type: 'arrow', fromId: bid, fromPort: port.dataset.port, x1: pp.x, y1: pp.y, d1: pp.dir }
      arrowPreview.setAttribute('d', '')
      arrowPreview.setAttribute('marker-end', isLight() ? 'url(#arrowhead-light-pre)' : 'url(#arrowhead-pre)')

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

    } else if (frame) {
      if (ui.readOnly) return
      const gid = frame.dataset.gid
      const members = Object.values(state.blocks).filter(b => b.groupId === gid)
      const startPositions = {}
      members.forEach(b => { startPositions[b.id] = { x: b.x, y: b.y } })
      pointer.ix = { type: 'frame', groupId: gid, startX: e.clientX, startY: e.clientY,
                     startPositions, moved: false, snapshotted: false }

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
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Pinch-zoom
    if (pinchState && activePointers.size >= 2) {
      const pts  = [...activePointers.values()]
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const r    = canvasViewport.getBoundingClientRect()
      const vx   = pinchState.cx - r.left, vy = pinchState.cy - r.top
      const wx   = (vx - pinchState.startPanX) / pinchState.startZoom
      const wy   = (vy - pinchState.startPanY) / pinchState.startZoom
      view.zoom  = clamp(pinchState.startZoom * (dist / pinchState.startDist), MIN_ZOOM, MAX_ZOOM)
      view.panX  = vx - wx * view.zoom
      view.panY  = vy - wy * view.zoom
      applyTransform(); return
    }

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

    } else if (ix.type === 'resize') {
      const dx = e.clientX - ix.startX
      const b  = state.blocks[ix.id]; if (!b) return
      const newW = clamp(ix.startW + dx / view.zoom, 140, 500)
      b.width = newW
      const el = getBlockEl(ix.id)
      if (el) el.style.width = newW + 'px'
      requestAnimationFrame(renderArrows)

    } else if (ix.type === 'frame') {
      const dx = e.clientX - ix.startX, dy = e.clientY - ix.startY
      if (!ix.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
        ix.moved = true
        ix.snapshotted || (snapshot(), ix.snapshotted = true)
      }
      if (ix.moved) {
        Object.entries(ix.startPositions).forEach(([id, sp]) => {
          const b = state.blocks[id]; if (!b) return
          b.x = snap(sp.x + dx / view.zoom); b.y = snap(sp.y + dy / view.zoom)
          const el = getBlockEl(id)
          if (el) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px' }
        })
        requestAnimationFrame(() => { renderArrows(); renderFrames() })
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
    activePointers.delete(e.pointerId)
    if (pinchState) { if (activePointers.size < 2) { pinchState = null; pointer.ix = null } return }

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
      // Track that these blocks were just dragged (prevents voting on click-after-drag)
      selection.ids.forEach(sid => {
        const blockEl = getBlockEl(sid)
        if (blockEl) recentlyDragged.set(blockEl, Date.now())
      })
      if (!ix.moved && ix.willDeselect) selectBlock(ix.id)
      if (ix.moved) { renderFrames(); debouncedSave(); runGapDetection(); ui.promptDirty = true }

    } else if (ix.type === 'resize') {
      debouncedSave(); renderArrows(); ui.promptDirty = true

    } else if (ix.type === 'frame') {
      if (!ix.moved) {
        // Frame click → select all members
        const members = Object.values(state.blocks).filter(b => b.groupId === ix.groupId).map(b => b.id)
        setSelection(members)
        selection.groupId = ix.groupId
        renderFrames()
        renderInspector()
      } else {
        renderFrames(); debouncedSave(); runGapDetection(); ui.promptDirty = true
      }

    } else if (ix.type === 'arrow') {
      arrowPreview.setAttribute('d', '')
      const r = canvasViewport.getBoundingClientRect()
      const w = toWorld(e.clientX - r.left, e.clientY - r.top)
      // Pin the source port the user dragged from; pin the target port only if
      // they released directly on one. Unpinned sides keep auto-routing.
      const portEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.port')
      const tid = (portEl && portEl.dataset.bid) || blockAtWorld(w.x, w.y)
      if (tid && tid !== ix.fromId) {
        const toPort = portEl && portEl.dataset.bid === tid ? portEl.dataset.port : null
        const fromPort = ui.pinPorts ? ix.fromPort : null
        addArrow(ix.fromId, tid, fromPort, ui.pinPorts ? toPort : null)
      }
    }
    pointer.ix = null
  })

  canvasViewport.addEventListener('pointercancel', e => {
    activePointers.delete(e.pointerId)
    if (activePointers.size < 2) pinchState = null
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

  // Track recently dragged blocks (prevents voting on drag-end)
  const recentlyDragged = new WeakMap()
  const DRAG_VOTE_THRESHOLD = 200 // ms

  // Block collapse toggle
  canvasRoot.addEventListener('click', e => {
    const btn = e.target.closest('.block-collapse-btn'); if (!btn) return
    const id = btn.dataset.bid; const b = state.blocks[id]; if (!b) return
    mutateBlock(id, { collapsed: !b.collapsed })
    e.stopPropagation()
  })

  // Voting on blocks (click block background/add area, not ports or buttons)
  canvasRoot.addEventListener('click', e => {
    // Only handle clicks on block (not ports, buttons, editable areas)
    const block = e.target.closest('.block')
    if (!block) return

    // CRITICAL: Don't vote if block was just dragged (within 200ms)
    const lastDragged = recentlyDragged.get(block)
    if (lastDragged && (Date.now() - lastDragged < DRAG_VOTE_THRESHOLD)) {
      return // Just finished dragging, don't vote
    }

    // Don't vote if clicked on interactive elements
    if (e.target.closest('.port') ||
        e.target.closest('.block-collapse-btn') ||
        e.target.closest('.block-resize-handle') ||
        e.target.tagName === 'BUTTON' ||
        e.target.classList.contains('block-title')) {
      return
    }

    const blockId = block.dataset.id
    if (!blockId || ui.readOnly) return

    const votesAdded = addVotesToBlock(blockId, 1)
    if (votesAdded) {
      renderBlock(blockId)
      ui.promptDirty = true
      // Show subtle toast
      showToast(`Added vote to "${state.blocks[blockId].title || 'Block'}"`, 'info', 1500)
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
    if (e.altKey && e.key === 'h') { e.preventDefault(); document.body.classList.toggle('high-contrast'); return }
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

// ── Text → blocks classification ─────────────────────────────
//
// Explicit "goal:"-style prefixes still win outright. Otherwise we strip a
// leading first-person/article ("we need…", "the API…") and SCORE the whole
// line against weighted keyword sets so natural prose lands on a real type
// instead of dumping into the gray 'custom' bucket.
const PREFIX_PATTERNS = [
  { re: /^(goal|objective|aim|target|vision)[:.]\s*/i,         type: 'goal' },
  { re: /^(problem|issue|blocker|bug|pain|challenge)[:.]\s*/i, type: 'problem' },
  { re: /^(risk|concern|danger|threat)[:.]\s*/i,               type: 'risk' },
  { re: /^(assum(e|ption)|belief|hypothesis)[:.]\s*/i,         type: 'assumption' },
  { re: /^(need|req(uirement)?|must|should|shall)[:.]\s*/i,    type: 'requirement' },
  { re: /^(decision|decided|chose|choice)[:.]\s*/i,            type: 'decision' },
  { re: /^(resource|team|tool|asset|budget)[:.]\s*/i,          type: 'resource' },
  { re: /^(output|deliverable|result|outcome)[:.]\s*/i,        type: 'output' },
  { re: /^(context|background|note|info|status)[:.]\s*/i,      type: 'context' },
  { re: /^(question)[:.]\s*/i,                                 type: 'question' },
  { re: /^(action|step|process|task|do)[:.]\s*/i,             type: 'process' },
  { re: /^(start|end|begin|finish|done|trigger)[:.]\s*/i,     type: 'terminator' },
]

// Weighted keyword cues. Each entry: [regex, points]. Highest-scoring type wins.
const SCORE_RULES = {
  requirement: [[/\b(need|needs|must|should|shall|require[sd]?|has to|have to)\b/i, 3], [/\b(support|enable|provide|allow)\b/i, 1]],
  assumption:  [[/\b(assume|assuming|assumption|expect|expects|presumably|likely|probably|i think|we think|believe)\b/i, 3], [/\bwill\s+\w+/i, 2], [/\b(should be fine|hopefully)\b/i, 2]],
  risk:        [[/\b(risk|concern|danger|threat|worried|might fail|could fail|fragile|breaks?|vulnerab)\b/i, 3], [/\b(if .* fails|single point of failure)\b/i, 2]],
  goal:        [[/\b(goal|objective|aim|vision|want to|increase|reduce|improve|grow|launch|ship|achieve|reach)\b/i, 3]],
  problem:     [[/\b(problem|issue|blocker|bug|broken|pain|can't|cannot|doesn't work|failing|slow|outage)\b/i, 3], [/\b(latency|exceeds?|over (our )?sla|breach(es|ing)?|too slow|error rate|downtime)\b/i, 3]],
  decision:    [[/\b(decided|decision|chose|choose|chosen|go with|pick(ed)?|settle[d]? on|opt(ed)? for)\b/i, 3]],
  resource:    [[/\b(team|budget|tool|asset|library|api|service|credits?|headcount|engineers?|designers?)\b/i, 1]],
  output:      [[/\b(deliverable|output|result|outcome|artifact|report|doc(s|umentation)?|deploy|release)\b/i, 2]],
  context:     [[/\b(background|context|currently|today|historically|note that|fyi|for reference)\b/i, 2]],
  process:     [[/^(update|create|add|send|generate|assign|review|submit|move|set|mark|run|trigger|notify)\b/i, 3], [/\b(step \d|then\b)/i, 1]],
  terminator:  [[/^(start|begin|end|finish|done|complete[d]?)\b/i, 3]],
}

const LEADING_FILLER = /^(we|i|the|our|they|it|this|that|there)\s+/i

/**
 * Classify one raw line into { type, title, confidence }.
 * confidence: 'high' (explicit prefix or strong score) | 'low' (weak/none).
 */
export function categorizeLine(raw) {
  const line = raw.replace(/^\s*[-*•]\s+/, '').replace(/^\s*\d+\.\s+/, '').trim()

  // 1. Explicit prefix — authoritative.
  for (const { re, type } of PREFIX_PATTERNS) {
    const m = line.match(re)
    if (m) return { type, title: line.slice(m[0].length).trim() || line, confidence: 'high' }
  }

  // 2. A trailing "?" is a genuine question unless it reads as a belief.
  const looksAssumed = /\b(assume|assuming|expect|believe|will work|should be|probably|likely)\b/i.test(line)
  if (line.endsWith('?') && !looksAssumed) {
    return { type: 'question', title: line, confidence: 'high' }
  }

  // 3. Score the whole line (filler-stripped) against keyword cues.
  const probe = line.replace(LEADING_FILLER, '')
  let best = { type: 'custom', score: 0 }
  for (const [type, rules] of Object.entries(SCORE_RULES)) {
    let score = 0
    for (const [re, pts] of rules) if (re.test(probe)) score += pts
    if (score > best.score) best = { type, score }
  }

  if (best.score >= 3) return { type: best.type, title: line, confidence: 'high' }
  if (best.score >= 1) return { type: best.type, title: line, confidence: 'low' }
  return { type: 'custom', title: line, confidence: 'low' }
}

/**
 * Parse freeform text into an outline: top-level lines become blocks, while
 * more-indented or bulleted lines beneath them fold into that block's
 * description. A line is a child only when it is "deeper" than the current
 * block, so a flat bullet list (all same depth) still becomes sibling blocks.
 *
 * Depth = indentUnits*10 + (isBullet ? 1 : 0), where two spaces or one tab is
 * one indent unit. This lets "Header / - bullet / - bullet" nest without
 * requiring the bullets to be spatially indented.
 */
export function parseOutline(text) {
  const MARKER = /^(\s*)([-*•]|\d+[.)])?\s*/
  const items = []          // { line, description: [lines] }
  let current = null, currentDepth = 0
  text.split(/\r?\n/).forEach(raw => {
    if (!raw.trim()) return
    const m = raw.match(MARKER)
    const ws = (m[1] || '').replace(/\t/g, '  ')
    const isBullet = !!m[2]
    const depth = Math.floor(ws.length / 2) * 10 + (isBullet ? 1 : 0)
    const content = raw.slice(m[0].length).trim()
    if (!content) return
    if (current && depth > currentDepth) {
      current.description.push(isBullet ? '• ' + content : content)
    } else {
      current = { line: content, description: [] }
      currentDepth = depth
      items.push(current)
    }
  })
  return items
}

/**
 * Turn freeform text into a column of typed blocks. Shared by the paste
 * handler and the Brain Dump card. Returns the array of created block ids.
 * When `nest` is true (default), indented/bulleted lines fold into the
 * description of the block above them.
 */
export function createBlocksFromText(text, nest = true) {
  const items = nest
    ? parseOutline(text)
    : text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => ({ line, description: [] }))
  if (!items.length) return []

  const vp = $.canvasViewport()
  const r  = vp.getBoundingClientRect()
  const cx = (r.width  / 2 - view.panX) / view.zoom - DEFAULT_WIDTH / 2
  const cy = (r.height / 2 - view.panY) / view.zoom - (items.length * 90) / 2

  snapshot()
  const created = []
  items.forEach((item, i) => {
    const { type, title, confidence } = categorizeLine(item.line)
    const id = genId()
    state.blocks[id] = {
      id, type, title, description: item.description.join('\n'), notes: '',
      x: cx, y: cy + i * 90,
      actions: [], questions: [],
      width: null, color: null, collapsed: false, groupId: null,
      status: null, priority: null,
    }
    created.push({ id, confidence })
  })

  renderAllBlocks()
  renderArrows()
  runGapDetection()
  updateHint()
  debouncedSave()
  ui.promptDirty = true
  showTypeChips(created)
  showToast(`Created ${created.length} block${created.length > 1 ? 's' : ''}`)
  return created.map(c => c.id)
}

export function setupPasteHandler() {
  document.addEventListener('paste', e => {
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.contentEditable === 'true') return
    if (ui.readOnly) return
    const text = e.clipboardData?.getData('text/plain')
    if (!text?.trim()) return
    e.preventDefault()
    createBlocksFromText(text)
  })
}

// ── Type-correction chips ────────────────────────────────────
//
// After an import, each fresh block gets a small chip floated above it so the
// 1-2 mis-categorized lines are one click from fixed. Chips are SIBLINGS in
// canvasRoot (never inside block innerHTML — renderBlock rebuilds that wholesale
// and would wipe them). They dismiss on the next canvas pointerdown.
function clearTypeChips() {
  document.querySelectorAll('.type-chip').forEach(el => el.remove())
}

function showTypeChips(created) {
  clearTypeChips()
  if (ui.readOnly) return
  const root = $.canvasRoot()
  created.forEach(({ id, confidence }) => {
    const b = state.blocks[id]; if (!b) return
    const chip = document.createElement('div')
    chip.className = 'type-chip' + (confidence === 'low' ? ' low-confidence' : '')
    chip.dataset.bid = id
    chip.style.left = b.x + 'px'
    chip.style.top  = (b.y - 26) + 'px'
    chip.innerHTML =
      `<span class="type-chip-dot" style="background:${TYPES[b.type]?.color || '#fff'}"></span>` +
      `<span class="type-chip-label">${TYPES[b.type]?.label || b.type}</span>` +
      `<svg class="type-chip-caret" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>`
    root.appendChild(chip)
    // Mark low-confidence blocks so the misses are visually obvious.
    if (confidence === 'low') getBlockEl(id)?.classList.add('low-confidence')
  })
}

function openTypeChipMenu(chip) {
  const id = chip.dataset.bid
  document.querySelectorAll('.type-chip-menu').forEach(m => m.remove())
  const menu = document.createElement('div')
  menu.className = 'type-chip-menu'
  menu.innerHTML = Object.entries(TYPES).map(([t, cfg]) =>
    `<button class="type-chip-opt" data-type="${t}">` +
    `<span class="type-chip-dot" style="background:${cfg.color}"></span>${cfg.label}</button>`
  ).join('')
  chip.appendChild(menu)
  menu.addEventListener('click', e => {
    const opt = e.target.closest('.type-chip-opt'); if (!opt) return
    e.stopPropagation()
    mutateBlock(id, { type: opt.dataset.type })
    getBlockEl(id)?.classList.remove('low-confidence')
    const b = state.blocks[id]
    chip.classList.remove('low-confidence')
    chip.querySelector('.type-chip-dot').style.background = TYPES[b.type]?.color || '#fff'
    chip.querySelector('.type-chip-label').textContent = TYPES[b.type]?.label || b.type
    menu.remove()
  })
}

// ── Brain Dump empty state ───────────────────────────────────
export function setupBrainDump() {
  const btn   = document.getElementById('brainDumpBtn')
  const input = document.getElementById('brainDumpInput')
  if (!btn || !input) return
  const nestToggle = document.getElementById('brainDumpNest')
  const run = () => {
    const text = input.value.trim()
    if (!text) { input.focus(); return }
    createBlocksFromText(text, nestToggle ? nestToggle.checked : true)
    input.value = ''
  }
  btn.addEventListener('click', run)
  // Cmd/Ctrl+Enter submits; plain Enter keeps adding lines.
  input.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run() }
  })
}

export function setupTypeChips() {
  const root = $.canvasRoot()
  // Open a chip's menu on click; dismiss all chips on any other canvas press.
  root.addEventListener('pointerdown', e => {
    const chip = e.target.closest('.type-chip')
    if (chip) {
      if (e.target.closest('.type-chip-menu')) return
      e.stopPropagation()
      const existing = chip.querySelector('.type-chip-menu')
      document.querySelectorAll('.type-chip-menu').forEach(m => m.remove())
      if (!existing) openTypeChipMenu(chip)
      return
    }
    clearTypeChips()
  }, true)
}

// ── Tab keyboard navigation ───────────────────────────────────
export function setupTabNavigation() {
  // Tab / Shift+Tab cycles through blocks in visual order
  $.canvasViewport().addEventListener('keydown', e => {
    if (e.key !== 'Tab') return
    const ids = Object.keys(state.blocks); if (!ids.length) return
    const sorted = [...ids].sort((a, b) => {
      const ba = state.blocks[a], bb = state.blocks[b]
      return ba.y !== bb.y ? ba.y - bb.y : ba.x - bb.x
    })
    const cur  = sorted.findIndex(id => getBlockEl(id) === document.activeElement)
    const next = e.shiftKey
      ? (cur <= 0 ? sorted.length - 1 : cur - 1)
      : (cur < 0 || cur >= sorted.length - 1 ? 0 : cur + 1)
    e.preventDefault()
    getBlockEl(sorted[next])?.focus()
  })

  // Enter / Space on focused block → select it
  $.canvasRoot().addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const block = e.target.closest('.block'); if (!block) return
    e.preventDefault(); selectBlock(block.dataset.id)
  })

  // Auto-pan canvas when a focused block is off-screen
  $.canvasRoot().addEventListener('focusin', e => {
    const block = e.target.closest('.block'); if (!block) return
    const id = block.dataset.id; const b = state.blocks[id]; if (!b) return
    const { w, h } = getBlockDims(id)
    const vp  = $.canvasViewport(), pad = 60
    const bX1 = b.x * view.zoom + view.panX, bY1 = b.y * view.zoom + view.panY
    const bX2 = bX1 + w * view.zoom,          bY2 = bY1 + h * view.zoom
    if (bX1 >= pad && bY1 >= pad && bX2 <= vp.offsetWidth - pad && bY2 <= vp.offsetHeight - pad) return
    view.panX = vp.offsetWidth  / 2 - (b.x + w / 2) * view.zoom
    view.panY = vp.offsetHeight / 2 - (b.y + h / 2) * view.zoom
    applyTransform()
  })
}

// ── Palette ──────────────────────────────────────────────────
export function setupPalette() {
  const palette = document.getElementById('palette')

  function addBlockAtCenter(item) {
    const r = $.canvasViewport().getBoundingClientRect()
    const w = toWorld(r.width / 2, r.height / 2)
    selectBlock(createBlock(item.dataset.type, w.x, w.y))
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
      // Commit to drag — create ghost
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
      selectBlock(createBlock(type, w.x, w.y))
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

  // One-click: promote a Question into an Assumption (defaults to a validate action)
  document.getElementById('promoteAssumption')?.addEventListener('click', () => {
    const id = selection.blockId; if (!id) return
    const b = state.blocks[id]; if (!b) return
    const actions = b.actions.includes('validate') ? b.actions : [...b.actions, 'validate']
    mutateBlock(id, { type: 'assumption', actions })
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
      const isActive = b.actions.includes(a)
      btn.classList.toggle('active', isActive)
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false')
      renderBlock(selection.blockId); runGapDetection(); debouncedSave()
      ui.promptDirty = true
    })
  )

  // Status picker
  document.getElementById('statusPicker').addEventListener('click', e => {
    const btn = e.target.closest('.status-opt'); if (!btn || !selection.blockId) return
    mutateBlock(selection.blockId, { status: btn.dataset.status || null })
    renderInspector()
  })

  // Priority picker
  document.getElementById('priorityPicker').addEventListener('click', e => {
    const btn = e.target.closest('.priority-opt'); if (!btn || !selection.blockId) return
    mutateBlock(selection.blockId, { priority: btn.dataset.priority || null })
    renderInspector()
  })

  // Actions info toggle
  document.getElementById('actionsInfoBtn').addEventListener('click', () => {
    const panel = document.getElementById('actionsInfoPanel')
    panel.style.display = panel.style.display === 'none' ? '' : 'none'
  })

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

  document.getElementById('arrowNoteInput')?.addEventListener('input', () => {
    const a = state.arrows.find(arr => arr.id === selection.arrowId); if (!a) return
    a.note = document.getElementById('arrowNoteInput').value
    renderArrows(); debouncedSave(); ui.promptDirty = true
  })

  // Arrow label presets
  document.getElementById('arrowLabelPresets').addEventListener('click', e => {
    const chip = e.target.closest('.arrow-preset-chip'); if (!chip) return
    const a = state.arrows.find(arr => arr.id === selection.arrowId); if (!a) return
    const preset = chip.dataset.preset
    a.label = a.label === preset ? '' : preset
    document.getElementById('arrowLabelInput').value = a.label
    renderArrows(); renderInspector(); debouncedSave(); ui.promptDirty = true
  })

  document.getElementById('deleteArrowBtn').addEventListener('click', () => {
    if (selection.arrowId) deleteArrow(selection.arrowId)
  })

  // Arrow style
  document.querySelectorAll('[data-arrow-style]').forEach(btn =>
    btn.addEventListener('click', () => {
      const a = state.arrows.find(arr => arr.id === selection.arrowId); if (!a) return
      a.style = btn.dataset.arrowStyle
      renderArrows(); renderInspector(); debouncedSave()
    })
  )

  // Arrow reverse direction (swap pinned ports too, so routing follows)
  document.getElementById('arrowReverse').addEventListener('click', () => {
    const a = state.arrows.find(arr => arr.id === selection.arrowId); if (!a) return
    snapshot();
    [a.from, a.to] = [a.to, a.from];
    [a.fromPort, a.toPort] = [a.toPort, a.fromPort]
    renderArrows(); renderInspector(); debouncedSave()
  })

  // Arrow auto-route: clear pinned ports so it routes by box position
  document.getElementById('arrowAutoRoute').addEventListener('click', () => {
    const a = state.arrows.find(arr => arr.id === selection.arrowId); if (!a) return
    a.fromPort = null; a.toPort = null
    renderArrows(); renderInspector(); debouncedSave()
  })

  // Arrow bidirectional
  document.getElementById('arrowBidir').addEventListener('click', () => {
    const a = state.arrows.find(arr => arr.id === selection.arrowId); if (!a) return
    a.bidirectional = !a.bidirectional
    renderArrows(); renderInspector(); debouncedSave()
  })

  // Arrow color
  document.getElementById('arrowColorSwatches').addEventListener('click', e => {
    const sw = e.target.closest('.color-swatch'); if (!sw) return
    const a = state.arrows.find(arr => arr.id === selection.arrowId); if (!a) return
    a.color = sw.dataset.color === 'reset' ? null : sw.dataset.color
    renderArrows(); renderInspector(); debouncedSave()
  })

  // Arrow weight
  document.querySelectorAll('[data-arrow-weight]').forEach(btn =>
    btn.addEventListener('click', () => {
      const a = state.arrows.find(arr => arr.id === selection.arrowId); if (!a) return
      a.weight = +btn.dataset.arrowWeight
      renderArrows(); renderInspector(); debouncedSave()
    })
  )

  // Color swatches
  document.getElementById('colorSwatches').addEventListener('click', e => {
    const sw = e.target.closest('.color-swatch'); if (!sw || !selection.blockId) return
    const color = sw.dataset.color === 'reset' ? null : sw.dataset.color
    mutateBlock(selection.blockId, { color })
    renderInspector()
  })

  // Group / ungroup buttons
  document.getElementById('groupBlocksBtn').addEventListener('click', () => {
    if (selection.ids.size < 2) return
    createGroup([...selection.ids])
  })
  document.getElementById('ungroupBtn').addEventListener('click', () => {
    if (selection.groupId) deleteGroup(selection.groupId)
  })
  document.getElementById('frameLabelInput').addEventListener('input', e => {
    if (!selection.groupId || !state.groups[selection.groupId]) return
    state.groups[selection.groupId].label = e.target.value
    renderFrames()
    debouncedSave()
  })

  // Gap fix suggestions
  document.getElementById('gapFixes').addEventListener('click', e => {
    const btn = e.target.closest('.gap-fix-btn'); if (!btn) return
    const blockId = btn.dataset.bid; const b = state.blocks[blockId]; if (!b) return
    const { w, h } = getBlockDims(blockId)
    const nx = b.x + w + 70 + DEFAULT_WIDTH / 2
    const ny = b.y + h / 2 + 50

    if (btn.dataset.fix === 'resolve') {
      if (!b.actions.includes('resolve')) mutateBlock(blockId, { actions: [...b.actions, 'resolve'] })
    } else if (btn.dataset.fix === 'add-goal') {
      const id = createBlock('goal', nx, ny); addArrow(blockId, id); selectBlock(id)
      showToast('Goal created and linked')
    } else if (btn.dataset.fix === 'add-req') {
      const id = createBlock('requirement', nx, ny); addArrow(id, blockId); selectBlock(id)
      showToast('Requirement created and linked')
    } else if (btn.dataset.fix === 'add-decision') {
      const id = createBlock('decision', nx, ny); addArrow(blockId, id); selectBlock(id)
      showToast('Decision created and linked')
    }
  })
}
