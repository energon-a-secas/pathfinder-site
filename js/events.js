// ════════════════════════════════════════════════════════════
//  events.js: core canvas interactions. Pointer events, keyboard
//              shortcuts, canvas title, hover. The classifier lives in
//              classify.js, the palette in palette.js and the inspector
//              listeners in inspector.js.
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, canvasMeta, pointer,
         debouncedSave, snapshot, snap, toWorld } from './state.js'
import { $, clamp, getBlockEl, getBlockDims, showToast, addVotesToBlock, DEFAULT_WIDTH, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { applyTransform, portPos, cpOffset, renderArrows, renderFrames, fitView,
         blockAtWorld, blocksInRect, isLight } from './canvas.js'
import { renderBlock, renderInspector,
         selectBlock, addToSelection, setSelection, selectArrow, deselectAll,
         mutateBlock, deleteBlock, addArrow, deleteArrow,
         duplicateBlock, deleteBlocksBatch, undo, redo } from './render.js'
import { runGapDetection } from './gaps.js'
import { openSearch, closeSearch, openShortcuts, closeShortcuts, runTidy } from './ui-panels.js'
import { toggleChrome, toggleZen } from './chrome.js'
import { guidesForDrag, drawGuides, clearGuides } from './align.js'
import { openDocPopup } from './doc-panel.js'
import { releaseTidyPins } from './layout.js'
import { startInlineEdit } from './inline-edit.js'
import { startArrowLabelEdit } from './arrow-edit.js'
import { openCanvasAddMenu } from './context-menu.js'
import { setVotingMode, refreshVotingBanner } from './voting.js'
// Navigation (keyboard, zoom, quick create). Its own lines, so the shared
// imports above stay as other streams left them.
import { blockDecorators } from './render.js'
import { zoomIn, zoomOut, zoomTo, zoomAround, zoomToSelection, wheelZoomFactor } from './zoom-controls.js'
import { ARROW_DIRS, PORT_DIR, readingOrder, nearestInDirection, currentBlockId, selectFromKeyboard,
         focusableAfterCanvas, controlsBeforeCanvas, nudgeSelection, panBy, createInDirection,
         openQuickCreate, nav, isTyping, canvasHasFocus, canvasZoomKeysApply, labelPorts,
         untabCardControls, isCameraHeld, revealShift } from './navigation.js'

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
// The last press on a connection. Selecting a connection deselects the card
// it leaves, which can change that card's height and re-route the line away
// from the pointer; the second press of a double-click then lands on empty
// canvas. Remembering the first press keeps the pair aimed at the arrow.
let lastArrowPress = null   // { aid, t, x, y }
const DBL_MS = 500, DBL_SLOP = 8

function arrowPressPair(x, y) {
  const p = lastArrowPress
  if (!p || performance.now() - p.t > DBL_MS) return null
  if (Math.hypot(x - p.x, y - p.y) > DBL_SLOP) return null
  return state.arrows.some(a => a.id === p.aid) ? p : null
}

export function setupArrowEvents() {
  $.arrowsLayer().addEventListener('pointerdown', e => {
    // Endpoint handles belong to the viewport's drag logic (re-pin/re-target).
    if (e.target.closest('.arrow-handle')) return
    const g = e.target.closest('[data-aid]'); if (!g) return
    lastArrowPress = { aid: g.dataset.aid, t: performance.now(), x: e.clientX, y: e.clientY }
    selectArrow(g.dataset.aid)
    e.stopPropagation()
  })
}

// ── Canvas pointer events ────────────────────────────────────
const activePointers = new Map()
let   pinchState     = null  // { startDist, startZoom, startPanX, startPanY, cx, cy }

// Setup runs once per viewport element: the tests call it too, and a second
// set of listeners would handle every press twice.
const wiredViewports = new WeakSet()

export function setupCanvasPointerEvents() {
  const canvasViewport = $.canvasViewport()
  if (wiredViewports.has(canvasViewport)) return
  wiredViewports.add(canvasViewport)
  const canvasRoot     = $.canvasRoot()
  const arrowPreview   = $.arrowPreview()
  const selectBox      = $.selectBox()

  // Capture the pointer only once it has really moved. Capturing on
  // pointerdown retargets the follow-up click and dblclick to the viewport
  // (Pointer Events L3), which silently broke every click handler inside it:
  // the collapse button, the doc badge, the chip menus, double-click editing.
  const capture = pid => { try { canvasViewport.setPointerCapture(pid) } catch (_) {} }

  // Blocks that just finished a drag, so the click that ends it never votes.
  const recentlyDragged = new WeakMap()
  const DRAG_VOTE_THRESHOLD = 200 // ms

  // The last click on a port. A double-click is two clicks to the browser
  // but one gesture to a person, so its second click adds no second block.
  let lastPortClick = null    // { bid, t, x, y }
  const isPortRepeat = (bid, x, y, detail) => {
    const p = lastPortClick, now = performance.now()
    lastPortClick = { bid, t: now, x, y }
    if (detail > 1) return true
    return !!p && p.bid === bid && now - p.t <= DBL_MS && Math.hypot(x - p.x, y - p.y) <= DBL_SLOP
  }

  // Safety net. Until a drag moves 3px nothing is captured, so its pointerup
  // can land outside the viewport (header, panel, another window). Without
  // this, pointer.ix would outlive the press and the next hover would drag.
  const releaseStray = e => {
    activePointers.delete(e.pointerId)
    if (activePointers.size < 2) pinchState = null
    const ix = pointer.ix
    if (!ix || (ix.pointerId !== undefined && ix.pointerId !== e.pointerId)) return
    selectBox.style.display = 'none'
    arrowPreview.setAttribute('d', '')
    canvasViewport.style.cursor = 'default'
    canvasViewport.classList.remove('is-panning')
    clearGuides()
    canvasRoot.querySelectorAll('.block.dragging').forEach(el => el.classList.remove('dragging'))
    pointer.ix = null
    if (ix.type !== 'pan') renderArrows({ cheap: false })
  }

  // A pan that keeps the selection: the middle button, or any press while
  // Space is held. Starts over cards too, since that is where people are.
  const startHandPan = e => {
    e.preventDefault()
    pointer.ix = { type: 'pan', startX: e.clientX, startY: e.clientY, startPX: view.panX, startPY: view.panY,
                   pointerId: e.pointerId, captured: false, downX: e.clientX, downY: e.clientY }
    canvasViewport.style.cursor = 'grabbing'
    canvasViewport.classList.add('is-panning')
  }

  canvasViewport.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.button !== 1) return
    // Overlay UI inside the viewport (menus, bars, chips, the Brain Dump card)
    // carries data-canvas-ui and handles its own presses.
    if (e.target.closest('[data-canvas-ui]')) return
    // Text being edited on a card: the press places the caret or selects
    // words, it must not start dragging the card.
    if (e.target.closest('[contenteditable="true"]')) return
    if (e.button === 1 || nav.spaceHeld) { startHandPan(e); return }
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Two-finger pinch: cancel any single-pointer interaction and switch to pinch
    if (activePointers.size === 2) {
      selection.ids.forEach(sid => getBlockEl(sid)?.classList.remove('dragging'))
      arrowPreview.setAttribute('d', ''); canvasViewport.style.cursor = 'default'
      selectBox.style.display = 'none'; pointer.ix = null
      for (const pid of activePointers.keys()) capture(pid)
      const pts = [...activePointers.values()]
      pinchState = {
        startDist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
        startZoom: view.zoom, startPanX: view.panX, startPanY: view.panY,
        cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2,
      }
      return
    }

    const arrowHandle  = e.target.closest('.arrow-handle')
    const resizeHandle = e.target.closest('.block-resize-handle')
    const collapseBtn  = e.target.closest('.block-collapse-btn')
    const docBadge     = e.target.closest('.block-doc-badge')
    const port         = e.target.closest('.port')
    const block        = e.target.closest('.block')
    const frame        = !block && e.target.closest('.frame')

    if (arrowHandle) {
      if (ui.readOnly) return
      e.stopPropagation()
      const a = state.arrows.find(arr => arr.id === arrowHandle.dataset.aid); if (!a) return
      const end = arrowHandle.dataset.end
      // The end that is staying put anchors the preview line.
      const anchorId = end === 'from' ? a.to : a.from
      const anchorSide = end === 'from' ? a.toPort : a.fromPort
      const ap = portPos(anchorId, anchorSide || 'right'); if (!ap) return
      pointer.ix = { type: 'aend', aid: a.id, end, x1: ap.x, y1: ap.y, d1: ap.dir }
      arrowPreview.setAttribute('d', '')
      arrowPreview.setAttribute('marker-end', isLight() ? 'url(#arrowhead-light-pre)' : 'url(#arrowhead-pre)')

    } else if (resizeHandle) {
      if (ui.readOnly) return
      e.stopPropagation()
      const id = resizeHandle.dataset.bid; const b = state.blocks[id]; if (!b) return
      pointer.ix = { type: 'resize', id, startX: e.clientX, startW: b.width || DEFAULT_WIDTH }

    } else if (collapseBtn || docBadge) {
      // handled by their own click handlers below; just prevent drag
      pointer.ix = null

    } else if (port) {
      if (ui.readOnly) return
      e.stopPropagation()
      const bid  = port.dataset.bid
      const pp   = portPos(bid, port.dataset.port); if (!pp) return
      pointer.ix = { type: 'arrow', fromId: bid, fromPort: port.dataset.port, x1: pp.x, y1: pp.y, d1: pp.dir,
                     detail: e.detail }
      arrowPreview.setAttribute('d', '')
      arrowPreview.setAttribute('marker-end', isLight() ? 'url(#arrowhead-light-pre)' : 'url(#arrowhead-pre)')

    } else if (block) {
      const id = block.dataset.id
      // Selecting is not editing: Shift+click adds to the selection in a
      // view-only link too (Shift+2 then frames what was picked).
      if (e.shiftKey) { addToSelection(id); pointer.ix = null; return }
      if (ui.readOnly) { selectBlock(id); pointer.ix = null; return }
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
      // The second press of a double-click that began on a connection: the
      // line moved away under the pointer. Keep the arrow selected so the
      // dblclick can still edit its label.
      if (!e.shiftKey && arrowPressPair(e.clientX, e.clientY)) { pointer.ix = null; return }
      deselectAll()
      if (e.shiftKey) {
        const r = canvasViewport.getBoundingClientRect()
        const w = toWorld(e.clientX - r.left, e.clientY - r.top)
        pointer.ix = { type: 'select', startX: e.clientX, startY: e.clientY, startWX: w.x, startWY: w.y }
      } else {
        pointer.ix = { type: 'pan', startX: e.clientX, startY: e.clientY, startPX: view.panX, startPY: view.panY }
        canvasViewport.style.cursor = 'grabbing'
        canvasViewport.classList.add('is-panning')
      }
    }
    if (pointer.ix) Object.assign(pointer.ix, { pointerId: e.pointerId, captured: false, downX: e.clientX, downY: e.clientY })
  })

  const onMove = e => {
    // Only pointers that went down on the canvas count. A hovering mouse
    // used to be counted too, so a later one-finger touch read as a pinch.
    if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // A mouse moving with no button held means its pointerup never arrived
    // (an OS interruption, a dialog mid-drag). End the press instead of
    // letting the next hover keep panning or dragging.
    if (pointer.ix && e.pointerType === 'mouse' && e.buttons === 0 && pointer.ix.pointerId === e.pointerId) {
      releaseStray(e); return
    }

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
    const far = ix.pointerId === e.pointerId && Math.hypot(e.clientX - ix.downX, e.clientY - ix.downY) > 3
    if (!ix.captured && ix.pointerId === e.pointerId) {
      // Drawing a connection captures on its first move; everything else
      // waits for 3px so a click stays a click.
      if (far || ix.type === 'arrow' || ix.type === 'aend') { capture(ix.pointerId); ix.captured = true }
    }
    // A press on a port that never travels 3px is a click (quick create),
    // not a connection being drawn.
    if (far) ix.dragged = true
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
        const ids = Object.keys(ix.startPositions)
        const place = (adjX, adjY) => ids.forEach(id => {
          const b = state.blocks[id], sp = ix.startPositions[id]; if (!b) return
          b.x = snap(sp.x + dx / view.zoom) + adjX
          b.y = snap(sp.y + dy / view.zoom) + adjY
          const el = getBlockEl(id)
          if (el) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px' }
        })
        place(0, 0)
        // Nudge onto a neighbour's edge or centre when it is within a few
        // pixels, and show the line that explains why. Grid snapping is the
        // stronger claim on position, so it wins outright.
        if (!ui.snapToGrid) {
          const g = guidesForDrag(ids)
          if (g.dx || g.dy) place(g.dx, g.dy)
          drawGuides(g)
        }
        requestAnimationFrame(() => { renderArrows(); renderFrames() })
      }

    } else if (ix.type === 'arrow' || ix.type === 'aend') {
      if (ix.type === 'arrow' && !ix.dragged) return
      const r = canvasViewport.getBoundingClientRect()
      const w = toWorld(e.clientX - r.left, e.clientY - r.top)
      const c1 = cpOffset(ix.x1, ix.y1, ix.d1, 80)
      arrowPreview.setAttribute('d',
        `M ${ix.x1} ${ix.y1} C ${c1.x} ${c1.y}, ${w.x-50} ${w.y}, ${w.x} ${w.y}`)
    }
  }
  canvasViewport.addEventListener('pointermove', onMove)
  // Until a press is captured, its moves only reach the viewport while the
  // pointer is over it. A fast drag from near the edge can leave on its very
  // first move; pick that move up here, which captures and carries on.
  document.addEventListener('pointermove', e => {
    const ix = pointer.ix
    if (!ix || ix.captured || ix.pointerId !== e.pointerId) return
    if (canvasViewport.contains(e.target)) return   // the viewport handled it
    onMove(e)
  })

  canvasViewport.addEventListener('pointerup', e => {
    activePointers.delete(e.pointerId)
    if (pinchState) { if (activePointers.size < 2) { pinchState = null; pointer.ix = null } return }

    const ix = pointer.ix
    if (!ix) return
    if (ix.type === 'pan') {
      canvasViewport.style.cursor = 'default'
      canvasViewport.classList.remove('is-panning')

    } else if (ix.type === 'select') {
      selectBox.style.display = 'none'
      const r = canvasViewport.getBoundingClientRect()
      const w = toWorld(e.clientX - r.left, e.clientY - r.top)
      const found = blocksInRect(ix.startWX, ix.startWY, w.x, w.y)
      if (found.length) setSelection(found)

    } else if (ix.type === 'block') {
      clearGuides()
      selection.ids.forEach(sid => getBlockEl(sid)?.classList.remove('dragging'))
      // Only a press that moved is a drag. Stamping every release made the
      // click that follows it (within 200ms, always) look like a drag's end,
      // so voting mode never added a dot.
      if (ix.moved) selection.ids.forEach(sid => {
        const blockEl = getBlockEl(sid)
        if (blockEl) recentlyDragged.set(blockEl, Date.now())
      })
      if (!ix.moved && ix.willDeselect) selectBlock(ix.id)
      // A moved block releases tidy-written pins on its arrows: the auto-layout's
      // side choices were for positions that no longer exist. Hand pins stay.
      if (ix.moved) { releaseTidyPins(selection.ids); renderFrames(); debouncedSave(); runGapDetection(); ui.promptDirty = true }

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

    } else if (ix.type === 'aend') {
      arrowPreview.setAttribute('d', '')
      const a = state.arrows.find(arr => arr.id === ix.aid)
      const r = canvasViewport.getBoundingClientRect()
      const w = toWorld(e.clientX - r.left, e.clientY - r.top)
      const portEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.port')
      const tid = (portEl && portEl.dataset.bid) || blockAtWorld(w.x, w.y)
      const otherId = a && (ix.end === 'from' ? a.to : a.from)
      // Dropping on a port pins that side; dropping on the body of a block
      // re-targets and hands the side back to auto.
      if (a && tid && tid !== otherId) {
        const side = portEl && portEl.dataset.bid === tid ? portEl.dataset.port : null
        snapshot()
        if (ix.end === 'from') { a.from = tid; a.fromPort = side }
        else                   { a.to   = tid; a.toPort   = side }
        delete a.portsBy
        renderInspector(); runGapDetection(); debouncedSave(); ui.promptDirty = true
      }

    } else if (ix.type === 'arrow') {
      arrowPreview.setAttribute('d', '')
      if (!ix.dragged) {
        // A click on a port grows a connected block out of that side; the
        // second click of a double-click does nothing more.
        pointer.ix = null
        if (!isPortRepeat(ix.fromId, e.clientX, e.clientY, ix.detail)) {
          createInDirection(ix.fromId, PORT_DIR[ix.fromPort] || 'right')
        }
        return
      }
      const r = canvasViewport.getBoundingClientRect()
      const w = toWorld(e.clientX - r.left, e.clientY - r.top)
      // Pin the source port the user dragged from; pin the target port only if
      // they released directly on one. Unpinned sides keep auto-routing.
      const under = document.elementFromPoint(e.clientX, e.clientY)
      const portEl = under?.closest('.port')
      // What is under the pointer wins over geometry: a card drawn on top of
      // another, or its outline, is still that card.
      const underBlock = under?.closest('.block')?.dataset.id
      const tid = (portEl && portEl.dataset.bid) || (state.blocks[underBlock] ? underBlock : null) || blockAtWorld(w.x, w.y)
      if (tid && tid !== ix.fromId) {
        const toPort = portEl && portEl.dataset.bid === tid ? portEl.dataset.port : null
        const fromPort = ui.pinPorts ? ix.fromPort : null
        addArrow(ix.fromId, tid, fromPort, ui.pinPorts ? toPort : null)
      } else if (!tid && under && canvasViewport.contains(under) && !under.closest('[data-canvas-ui]')) {
        // Dropped on empty canvas: offer a block to connect, right there.
        // The preview line stays up while the picker is open.
        const c1 = cpOffset(ix.x1, ix.y1, ix.d1, 80)
        arrowPreview.setAttribute('d', `M ${ix.x1} ${ix.y1} C ${c1.x} ${c1.y}, ${w.x - 50} ${w.y}, ${w.x} ${w.y}`)
        pointer.ix = null
        renderArrows({ cheap: false })
        openQuickCreate({ fromId: ix.fromId, fromPort: ix.fromPort, clientX: e.clientX, clientY: e.clientY,
          wx: w.x, wy: w.y, onClose: () => arrowPreview.setAttribute('d', '') })
        return
      }
    }
    pointer.ix = null
    // Arrows draw on a cheap path while a pointer is down. Now that it is up,
    // run the real router once.
    if (ix.type !== 'pan') renderArrows({ cheap: false })
  })

  canvasViewport.addEventListener('pointercancel', e => {
    activePointers.delete(e.pointerId)
    if (activePointers.size < 2) pinchState = null
    const ix = pointer.ix
    if (ix?.type === 'arrow') arrowPreview.setAttribute('d', '')
    if (ix?.type === 'pan') { canvasViewport.style.cursor = 'default'; canvasViewport.classList.remove('is-panning') }
    if (ix?.type === 'select') selectBox.style.display = 'none'
    if (ix?.type === 'block') { clearGuides(); selection.ids.forEach(sid => getBlockEl(sid)?.classList.remove('dragging')) }
    pointer.ix = null
    if (ix && ix.type !== 'pan') renderArrows({ cheap: false })
  })

  document.addEventListener('pointerup', releaseStray)
  document.addEventListener('pointercancel', releaseStray)

  // Wheel: trackpad two-finger scroll pans; pinch-zoom (which the browser
  // reports as a wheel event with ctrlKey) and Cmd/Ctrl+wheel zoom at the
  // cursor. This matches Figma/Miro/tldraw so "just move to pan" works on a
  // trackpad without holding a drag.
  // Safari reports a trackpad pinch as gesture events rather than
  // Ctrl+wheel; without these it zooms the whole page instead of the canvas.
  // A touch pinch is already handled by the pointer path above.
  let gesture = null
  canvasViewport.addEventListener('gesturestart', e => {
    if (e.target.closest?.('[data-canvas-ui]')) return
    e.preventDefault()
    gesture = { zoom: view.zoom }
  })
  canvasViewport.addEventListener('gesturechange', e => {
    if (!gesture) return
    e.preventDefault()
    if (pinchState || !Number.isFinite(e.scale)) return
    const r = canvasViewport.getBoundingClientRect()
    const vx = Number.isFinite(e.clientX) ? e.clientX - r.left : r.width / 2
    const vy = Number.isFinite(e.clientY) ? e.clientY - r.top : r.height / 2
    zoomAround(gesture.zoom * e.scale, vx, vy)
  })
  canvasViewport.addEventListener('gestureend', e => { if (gesture) { e.preventDefault(); gesture = null } })

  canvasViewport.addEventListener('wheel', e => {
    if (e.target.closest('[data-canvas-ui]')) return
    e.preventDefault()
    // A Safari pinch in progress zooms through the gesture events.
    if (gesture && e.ctrlKey) return
    const r  = canvasViewport.getBoundingClientRect()
    const vx = e.clientX - r.left, vy = e.clientY - r.top

    if (e.ctrlKey || e.metaKey) {
      // Zoom toward the cursor. A trackpad pinch sends many small deltas and
      // stays smooth; a mouse notch sends one big one, capped at x1.25 so a
      // single click of the wheel cannot jump from 44% to 260%.
      const wx = (vx - view.panX) / view.zoom, wy = (vy - view.panY) / view.zoom
      view.zoom = clamp(view.zoom * wheelZoomFactor(e.deltaY, e.deltaMode), MIN_ZOOM, MAX_ZOOM)
      view.panX = vx - wx * view.zoom
      view.panY = vy - wy * view.zoom
    } else {
      // Pan by the scroll delta (two-finger swipe on a trackpad, or wheel).
      // Line and page deltas become pixels; Shift+wheel on a mouse pans
      // sideways, as it scrolls sideways everywhere else.
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (canvasViewport.clientHeight || 400) : 1
      let dx = e.deltaX * k, dy = e.deltaY * k
      if (e.shiftKey && !dx) { dx = dy; dy = 0 }
      view.panX -= dx
      view.panY -= dy
    }
    applyTransform()
  }, { passive: false })

  // Middle-button drags pan; stop the browser's autoscroll from starting too.
  canvasViewport.addEventListener('mousedown', e => {
    if (e.button === 1 && !e.target.closest('[data-canvas-ui]')) e.preventDefault()
  })

  // Ports say what they do: the tooltip is the only hint that a click
  // (not just a drag) does something. Each card is one Tab stop.
  if (!blockDecorators.includes(labelPorts)) blockDecorators.push(labelPorts)
  if (!blockDecorators.includes(untabCardControls)) blockDecorators.push(untabCardControls)
  canvasRoot.querySelectorAll('.block').forEach(el => untabCardControls(null, el))

  // Double-click: a card edits the field under the pointer, a connection
  // edits its label, empty canvas offers a block to add right there. Fit is
  // Shift+1 and the status bar button now.
  canvasViewport.addEventListener('dblclick', e => {
    // A press that jittered past 3px was captured, so its dblclick is aimed
    // at the viewport; find what is really under the pointer.
    const hit = (e.target === canvasViewport || !canvasViewport.contains(e.target))
      ? document.elementFromPoint(e.clientX, e.clientY) : e.target
    if (!hit || !canvasViewport.contains(hit) || hit.closest('[data-canvas-ui]')) return
    // Double-clicking a word inside text already being edited selects it.
    if (hit.closest('[contenteditable="true"]')) return
    if (ui.readOnly) return
    // A pair that began on a connection edits that connection, even when the
    // line was re-routed away from the pointer between the two presses.
    const pair = arrowPressPair(e.clientX, e.clientY)
    if (pair) {
      e.preventDefault()
      startArrowLabelEdit(pair.aid, { clientX: e.clientX, clientY: e.clientY })
      return
    }
    const block = hit.closest('.block')
    if (block) {
      // Controls on the card keep their own click; a double-click there is two clicks.
      if (hit.closest('button, .port, .block-resize-handle')) return
      e.preventDefault()
      const id = block.dataset.id
      if (hit.closest('.block-desc')) {
        startInlineEdit(id, 'description', { selectAll: false, caretPoint: { x: e.clientX, y: e.clientY } })
      } else {
        startInlineEdit(id, 'title')
      }
      return
    }
    const arrow = hit.closest('[data-aid]')
    if (arrow) {
      e.preventDefault()
      startArrowLabelEdit(arrow.dataset.aid, { clientX: e.clientX, clientY: e.clientY })
      return
    }
    if (hit.closest('.frame-label')) return
    e.preventDefault()
    openCanvasAddMenu(e.clientX, e.clientY)
  })

  // Block collapse toggle
  canvasRoot.addEventListener('click', e => {
    const btn = e.target.closest('.block-collapse-btn'); if (!btn) return
    const id = btn.dataset.bid; const b = state.blocks[id]; if (!b) return
    mutateBlock(id, { collapsed: !b.collapsed })
    e.stopPropagation()
  })

  // Doc badge → open the referenced-doc preview popup
  canvasRoot.addEventListener('click', e => {
    const btn = e.target.closest('.block-doc-badge'); if (!btn) return
    e.stopPropagation()
    openDocPopup(btn.dataset.docBid, btn)
  })

  // Dot voting: only while the mode is on (voting.js). Without the gate every
  // click on a card body voted, rewrote the URL hash and toasted.
  canvasRoot.addEventListener('click', e => {
    if (!ui.votingMode) return
    // Only handle clicks on block (not ports, buttons, editable areas)
    const block = e.target.closest('.block')
    if (!block) return

    // CRITICAL: Don't vote if block was just dragged (within 200ms)
    const lastDragged = recentlyDragged.get(block)
    if (lastDragged && (Date.now() - lastDragged < DRAG_VOTE_THRESHOLD)) {
      return // Just finished dragging, don't vote
    }

    // Don't vote if clicked on interactive elements or text being edited
    if (e.target.closest('.port') ||
        e.target.closest('.block-collapse-btn') ||
        e.target.closest('.block-resize-handle') ||
        e.target.closest('button') ||
        e.target.closest('[contenteditable="true"]')) {
      return
    }

    const blockId = block.dataset.id
    if (!blockId || ui.readOnly) return

    const votesAdded = addVotesToBlock(blockId, 1)
    if (votesAdded) {
      renderBlock(blockId)
      ui.promptDirty = true
      refreshVotingBanner()
      showToast(`Added a dot to "${state.blocks[blockId].title || 'Block'}"`, 'info', 1500)
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
// Every binding here is listed in SHORTCUTS (ui-panels.js); add both or
// nobody learns the key exists.
const noMods = e => !e.metaKey && !e.ctrlKey && !e.altKey

function endSpacePan() {
  nav.spaceHeld = false
  $.canvasViewport()?.classList.remove('space-pan')
}

let keyboardWired = false
export function setupKeyboardShortcuts() {
  if (keyboardWired) return
  keyboardWired = true
  document.addEventListener('keyup', e => { if (e.code === 'Space' || e.key === ' ') endSpacePan() })
  window.addEventListener('blur', endSpacePan)
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault(); ui.searchOpen ? $.searchInput().focus() : openSearch(); return
    }
    // Nothing below this line may fire while the user is typing. `?` used to
    // sit above it, so a question mark in a description opened the help sheet.
    if (isTyping()) return
    const mod = e.metaKey || e.ctrlKey
    const onCanvas = canvasHasFocus()

    if (e.key === '?') { e.preventDefault(); openShortcuts(); return }
    // Matched on e.code too: Option+H types a symbol on a Mac.
    if (e.altKey && !mod && (e.code === 'KeyH' || e.key === 'h')) { e.preventDefault(); document.body.classList.toggle('high-contrast'); return }

    // ── View: about the window, not the map, so live in read-only and embed.
    // Cmd/Ctrl + = - 0 zoom the canvas instead of the page, but only while
    // the canvas has focus: from the side panel they stay the browser's own
    // page zoom, which people with low vision rely on.
    if (mod && !e.altKey && canvasZoomKeysApply()) {
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') { e.preventDefault(); zoomIn(); return }
      if (e.key === '-' || e.code === 'NumpadSubtract') { e.preventDefault(); zoomOut(); return }
      if (e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); zoomTo(1); return }
    }
    if (onCanvas && noMods(e)) {
      // Shift+digit matched on e.code: the key reads '!' on a US layout and
      // something else elsewhere.
      if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fitView(); return }
      if (e.shiftKey && e.code === 'Digit2') { e.preventDefault(); zoomToSelection(); return }
      // The typed '=' wins over Shift+0: on a German keyboard '=' is Shift+0.
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); return }
      if (e.shiftKey && e.code === 'Digit0') { e.preventDefault(); zoomTo(1); return }
      if (e.key === '-' && !e.shiftKey) { e.preventDefault(); zoomOut(); return }
      if (!e.shiftKey) {
        const k = e.key.toLowerCase()
        if (k === 'h') { e.preventDefault(); toggleChrome(); return }
        if (k === 'z') { e.preventDefault(); toggleZen();   return }
      }
      if (e.code === 'Space' || e.key === ' ') {
        // Held Space turns the next drag into a pan. The keydown still
        // reaches a focused card first, which selects it.
        e.preventDefault()
        if (!nav.spaceHeld) { nav.spaceHeld = true; $.canvasViewport()?.classList.add('space-pan') }
        return
      }
    }

    // ── Moving around. Selection and the camera are not edits, so these
    // work in read-only too; nudging and creating do not.
    const dir = ARROW_DIRS[e.key]
    if (dir && onCanvas) {
      if (mod && !e.altKey && !e.shiftKey) {
        e.preventDefault()   // Cmd+Left is Back in some browsers
        const from = currentBlockId()
        const to = from ? nearestInDirection(from, dir) : readingOrder()[0]
        if (to) selectFromKeyboard(to)
        return
      }
      if (e.altKey && !mod && !e.shiftKey) {
        if (ui.readOnly) return
        e.preventDefault()   // Alt+Left is Back on Windows
        const from = currentBlockId()
        if (from) createInDirection(from, dir)
        return
      }
      if (noMods(e)) {
        e.preventDefault()
        if (!ui.readOnly && selection.ids.size) nudgeSelection(dir, e.shiftKey)
        else panBy(dir, e.shiftKey)
        return
      }
    }

    if (e.key === 'Escape') {
      if ($.shortcutOverlay().style.display !== 'none') { closeShortcuts(); return }
      if (ui.searchOpen) { closeSearch(); return }
      if (ui.votingMode) { setVotingMode(false); return }
      if (selection.ids.size || selection.arrowId || selection.groupId) { deselectAll(); return }
      // Nothing left to deselect: let go of the canvas, so the keyboard is
      // never stuck in it.
      const ae = document.activeElement
      if (ae && ae !== document.body && $.canvasViewport().contains(ae)) ae.blur()
      return
    }

    // Selecting everything is not an edit either: it works in a view-only link.
    if (mod && e.key === 'a') { e.preventDefault(); setSelection(Object.keys(state.blocks)); return }

    if (ui.readOnly) return
    if (onCanvas && noMods(e) && !e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault(); runTidy(); return
    }
    // Cmd/Ctrl+Enter adds a connected block to the right of the selected one.
    if (mod && !e.altKey && e.key === 'Enter' && onCanvas) {
      const from = currentBlockId()
      if (from) { e.preventDefault(); createInDirection(from, 'right') }
      return
    }
    // Enter or F2 edits the selected card's title, Shift+Enter its
    // description. Only from the canvas or the page itself: Enter on a
    // focused button must press that button.
    if ((e.key === 'Enter' || e.key === 'F2') && noMods(e) && !e.defaultPrevented) {
      const ae = document.activeElement
      // A control on the card (collapse, doc badge) keeps its own Enter.
      const fromCanvas = !ae || ae === document.body ||
        ($.canvasViewport().contains(ae) && !ae.closest('[data-canvas-ui]') &&
         !ae.closest('button, a[href], input, select, textarea'))
      if (fromCanvas && selection.ids.size === 1 && selection.blockId && state.blocks[selection.blockId]) {
        e.preventDefault()
        startInlineEdit(selection.blockId, e.key === 'Enter' && e.shiftKey ? 'description' : 'title')
        return
      }
    }
    if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
    if (mod && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if      (selection.ids.size > 1)  deleteBlocksBatch([...selection.ids])
      else if (selection.blockId)       deleteBlock(selection.blockId)
      else if (selection.arrowId)       deleteArrow(selection.arrowId)
    }
    if (mod && e.key === 'd' && selection.blockId) {
      e.preventDefault()
      const newId = duplicateBlock(selection.blockId)
      if (newId) selectBlock(newId)
    }
  })
}


// ── Tab keyboard navigation ───────────────────────────────────
let tabNavWired = false
export function setupTabNavigation() {
  if (tabNavWired) return
  tabNavWired = true
  // Tab / Shift+Tab walk the blocks in reading order, selecting each, and
  // then leave the canvas: Tab after the last block goes on to whatever
  // follows the canvas, Shift+Tab before the first goes back to the canvas
  // itself and from there out. It used to wrap forever (WCAG 2.1.2).
  const viewport = $.canvasViewport()
  viewport.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.target.closest('[data-canvas-ui]') || e.target.isContentEditable) return
    const order = readingOrder(); if (!order.length) return
    const block = e.target.closest('.block')
    const cur = block ? order.indexOf(block.dataset.id) : -1
    if (!block) {
      // On the canvas itself: Tab enters at the first block, Shift+Tab leaves.
      if (e.target !== viewport || e.shiftKey) return
      // Controls floating over the canvas (Find, the review bar) come first,
      // in page order; the focusin handler below then lands on the first
      // block in reading order.
      if (controlsBeforeCanvas().length) return
      e.preventDefault(); selectFromKeyboard(order[0]); return
    }
    const next = cur + (e.shiftKey ? -1 : 1)
    if (cur >= 0 && next >= 0 && next < order.length) {
      e.preventDefault(); selectFromKeyboard(order[next]); return
    }
    if (e.shiftKey) {
      // Before the first block: the last floating control, else the canvas.
      e.preventDefault()
      const before = controlsBeforeCanvas()
      ;(before[before.length - 1] || viewport).focus({ preventScroll: true })
      return
    }
    // Past the last block. Cards come in DOM order, not reading order, so
    // the browser's own next stop could be another card: skip them all.
    const after = focusableAfterCanvas()
    if (after) { e.preventDefault(); after.focus(); return }
    // Nothing tabbable follows the canvas (an embed, say). Take the cards,
    // and anything tabbable inside them, out of the tab order for this one
    // key press, so the browser moves on out of the page instead of back to
    // a card (or a card's button) that is later in the DOM.
    const stops = [...$.canvasRoot().querySelectorAll('.block, .block *')].filter(el => el.tabIndex >= 0)
    const was = stops.map(el => el.getAttribute('tabindex'))
    stops.forEach(el => { el.tabIndex = -1 })
    setTimeout(() => stops.forEach((el, i) => {
      if (!el.isConnected) return
      if (was[i] == null) el.removeAttribute('tabindex'); else el.setAttribute('tabindex', was[i])
    }), 0)
  })

  // Tab can also reach the cards from a control beside them in the page (the
  // Find button before, the status bar after). Cards sit in DOM order, so a
  // plain Tab would land on whichever card was created first. Treat the
  // canvas as one stop instead: going forwards lands on the first block in
  // reading order, going backwards on the last.
  let tabAt = -Infinity, tabBack = false
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab') { tabAt = performance.now(); tabBack = e.shiftKey }
  }, true)
  // Where focus last left from inside a card. Closing a title editor blurs
  // the field before the card takes focus back, so that focusin arrives with
  // no relatedTarget, exactly like focus coming from outside the page. A
  // focusout inside the canvas just before says it is only moving within.
  let leftAt = -Infinity, leftBlock = null
  $.canvasRoot().addEventListener('focusout', e => {
    leftBlock = e.target.closest?.('.block') || null
    leftAt = performance.now()
  })
  const justLeft = block => performance.now() - leftAt < 100 && (!block || leftBlock === block)
  $.canvasRoot().addEventListener('focusin', e => {
    // Whatever inside a card the browser lands on (the card, or a button on
    // it) counts as arriving at the canvas. A field being edited never does:
    // Tab inside a title moves on to the description.
    const block = e.target.closest?.('.block')
    if (!block || e.target.isContentEditable || performance.now() - tabAt > 200) return
    if (e.relatedTarget && $.canvasRoot().contains(e.relatedTarget)) return
    if (justLeft()) return
    const order = readingOrder(); if (!order.length) return
    const want = tabBack ? order[order.length - 1] : order[0]
    if (e.target !== block || block.dataset.id !== want || selection.ids.size !== 1 || selection.blockId !== want) {
      selectFromKeyboard(want)
    }
  })

  // Enter / Space on focused block → select it. Enter on the block that is
  // already the selection falls through to the edit shortcut instead.
  // Only the card itself: Enter or Space on a button inside it presses the button.
  $.canvasRoot().addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if (e.metaKey || e.ctrlKey || e.altKey) return   // Cmd/Ctrl+Enter creates, see setupKeyboardShortcuts
    if (e.target.isContentEditable) return
    const block = e.target.closest('.block'); if (!block || e.target !== block) return
    const id = block.dataset.id
    // Holding Space to pan repeats the key; select once.
    if (e.key === ' ' && e.repeat) { e.preventDefault(); return }
    if (e.key === 'Enter' && selection.ids.size === 1 && selection.blockId === id) return
    e.preventDefault(); selectBlock(id)
  })

  // Focus that comes from a press must not move the view. The card would
  // slide out from under the pointer between pointerdown and pointerup, so
  // the second press of a double-click, or a button's click, lands on empty
  // canvas. Touch focuses after pointerup, hence a short grace period; any
  // key press ends it, so keyboard traversal always recentres.
  let pressDown = false, pressUpAt = -Infinity
  const endPress = () => { if (pressDown) { pressDown = false; pressUpAt = performance.now() } }
  $.canvasRoot().addEventListener('pointerdown', () => { pressDown = true }, true)
  document.addEventListener('pointerup', endPress, true)
  document.addEventListener('pointercancel', endPress, true)
  document.addEventListener('keydown', () => { pressDown = false; pressUpAt = -Infinity }, true)
  const fromPress = () => pressDown || performance.now() - pressUpAt < 500

  // Auto-pan canvas when a focused block is off-screen
  $.canvasRoot().addEventListener('focusin', e => {
    const block = e.target.closest('.block'); if (!block) return
    // A block the pointer just placed (quick create) stays where it was put.
    if (fromPress() || isCameraHeld()) return
    // Focus moving within one card (into its title editor and back) is not
    // arriving at it.
    if (e.relatedTarget && block.contains(e.relatedTarget)) return
    if (justLeft(block)) return
    const id = block.dataset.id; const b = state.blocks[id]; if (!b) return
    const { w, h } = getBlockDims(id)
    const vp  = $.canvasViewport(), pad = 60
    const W = vp.offsetWidth, H = vp.offsetHeight
    const bX1 = b.x * view.zoom + view.panX, bY1 = b.y * view.zoom + view.panY
    const bX2 = bX1 + w * view.zoom,          bY2 = bY1 + h * view.zoom
    if (bX1 >= pad && bY1 >= pad && bX2 <= W - pad && bY2 <= H - pad) return
    if (bX2 <= 0 || bY2 <= 0 || bX1 >= W || bY1 >= H) {
      // Nowhere on screen: centre it, so what surrounds it shows too.
      view.panX = W / 2 - (b.x + w / 2) * view.zoom
      view.panY = H / 2 - (b.y + h / 2) * view.zoom
    } else {
      // Partly on screen: move only as far as it takes. Recentring a card
      // that overhangs by a few pixels jumped the whole canvas.
      view.panX += revealShift(bX1, bX2, W, pad)
      view.panY += revealShift(bY1, bY2, H, pad)
    }
    applyTransform()
  })
}

