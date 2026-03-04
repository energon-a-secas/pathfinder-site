// ════════════════════════════════════════════════════════════
//  render.js — DOM rendering, block creation, canvas layout,
//              selection, mutations, undo/redo
// ════════════════════════════════════════════════════════════

import { state, selection, ui, canvasMeta, debouncedSave, snapshot,
         getUndoHistory, getRedoFuture } from './state.js'
import { $, TYPES, DEFAULT_WIDTH, escHtml, genId, getBlockEl } from './utils.js'
import { renderArrows, updateHint } from './canvas.js'
import { runGapDetection } from './gaps.js'
import { refreshPrompt } from './prompt.js'

function afterMutation() {
  ui.promptDirty = true
  if (ui.activeTab === 'prompt') refreshPrompt()
}

// ── Block rendering ──────────────────────────────────────────
export function renderBlock(id) {
  const b  = state.blocks[id]; if (!b) return
  let el   = getBlockEl(id)
  const isNew = !el
  if (isNew) { el = document.createElement('div'); el.id = 'b-' + id; $.canvasRoot().appendChild(el) }

  // Don't clobber live inline editing
  const focused = document.activeElement
  if (!isNew && el.contains(focused) && focused.contentEditable === 'true') {
    el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; return
  }

  el.className = 'block' + (selection.ids.has(id) ? ' selected' : '')
  el.dataset.id   = id
  el.dataset.type = b.type
  el.style.cssText = `left:${b.x}px;top:${b.y}px;width:${DEFAULT_WIDTH}px`

  const actHtml = b.actions.map(a => `<span class="action-badge ${a}">${a}</span>`).join('')
  const descHtml = b.description
    ? `<div class="block-desc">${escHtml(b.description)}</div>` : ''

  el.innerHTML = `
    <div class="block-header">
      <span class="block-type-badge">${TYPES[b.type]?.label || b.type}</span>
      <div class="block-gap-icons" id="gi-${id}"></div>
    </div>
    <div class="block-title" id="bt-${id}">${escHtml(b.title) || '<span style="opacity:.35">Untitled</span>'}</div>
    ${descHtml}
    ${actHtml ? `<div class="block-actions">${actHtml}</div>` : ''}
    <div class="port port-left"   data-port="left"   data-bid="${id}"></div>
    <div class="port port-right"  data-port="right"  data-bid="${id}"></div>
    <div class="port port-top"    data-port="top"    data-bid="${id}"></div>
    <div class="port port-bottom" data-port="bottom" data-bid="${id}"></div>`
}

export function renderAllBlocks() {
  $.canvasRoot().querySelectorAll('.block').forEach(el => { if (!state.blocks[el.dataset.id]) el.remove() })
  Object.keys(state.blocks).forEach(id => renderBlock(id))
}

// ── Inspector ────────────────────────────────────────────────
export function renderInspector() {
  const inspectorEmpty   = $.inspectorEmpty()
  const inspectorContent = $.inspectorContent()
  const inspectorMulti   = $.inspectorMulti()
  const inspectorArrow   = $.inspectorArrow()
  const inspTitle        = $.inspTitle()
  const inspDesc         = $.inspDesc()
  const inspNotes        = $.inspNotes()

  if (selection.ids.size > 1) {
    inspectorEmpty.style.display = 'none'
    inspectorContent.style.display = 'none'
    inspectorMulti.style.display = ''
    inspectorArrow.style.display = 'none'
    document.getElementById('multiCount').textContent = `${selection.ids.size} blocks selected`
    return
  }
  inspectorMulti.style.display = 'none'
  if (selection.arrowId) {
    const a = state.arrows.find(arr => arr.id === selection.arrowId)
    inspectorEmpty.style.display = 'none'
    inspectorContent.style.display = 'none'
    inspectorArrow.style.display = ''
    if (a) {
      const f = state.blocks[a.from], t = state.blocks[a.to]
      document.getElementById('arrowInfo').textContent =
        `${TYPES[f?.type]?.label||'?'} "${f?.title||'?'}" \u2192 ${TYPES[t?.type]?.label||'?'} "${t?.title||'?'}"`
      document.getElementById('arrowLabelInput').value = a.label || ''
    }
    return
  }
  inspectorArrow.style.display = 'none'
  if (!selection.blockId) {
    inspectorEmpty.style.display = ''
    inspectorContent.style.display = 'none'
    return
  }
  const b = state.blocks[selection.blockId]
  if (!b) { inspectorEmpty.style.display = ''; inspectorContent.style.display = 'none'; return }

  inspectorEmpty.style.display = 'none'
  inspectorContent.style.display = ''

  // type picker
  $.typePicker().innerHTML = Object.entries(TYPES).map(([t, cfg]) =>
    `<span class="type-pill${t===b.type?' active':''}" data-type="${t}" style="color:${cfg.color}">${cfg.label}</span>`
  ).join('')

  inspTitle.value = b.title
  inspDesc.value  = b.description
  inspNotes.value = b.notes || ''

  document.querySelectorAll('.action-toggle').forEach(btn =>
    btn.classList.toggle('active', b.actions.includes(btn.dataset.action))
  )

  renderQuestions(b)
}

export function renderQuestions(b) {
  const questionsList = $.questionsList()
  questionsList.innerHTML = (b.questions||[]).map((q, i) => `
    <div class="question-item">
      <input type="text" value="${escHtml(q)}" placeholder="Enter question\u2026" data-qi="${i}">
      <button class="q-del" data-qi="${i}" title="Delete">\u00D7</button>
    </div>`).join('')

  questionsList.querySelectorAll('input').forEach(inp =>
    inp.addEventListener('input', () => {
      const b2 = state.blocks[selection.blockId]; if (!b2) return
      b2.questions[+inp.dataset.qi] = inp.value
      debouncedSave(); ui.promptDirty = true
    })
  )
  questionsList.querySelectorAll('.q-del').forEach(btn =>
    btn.addEventListener('click', () => {
      const b2 = state.blocks[selection.blockId]; if (!b2) return
      b2.questions.splice(+btn.dataset.qi, 1)
      renderQuestions(b2); debouncedSave(); ui.promptDirty = true
    })
  )
}

// ── Selection ────────────────────────────────────────────────
export function selectBlock(id) {
  selection.ids.forEach(sid => getBlockEl(sid)?.classList.remove('selected'))
  selection.ids.clear()
  selection.blockId = null
  if (selection.arrowId) { selection.arrowId = null; renderArrows() }
  if (id) {
    selection.ids.add(id); selection.blockId = id
    getBlockEl(id)?.classList.add('selected')
  }
  renderInspector()
}

export function addToSelection(id) {
  if (selection.arrowId) { selection.arrowId = null; renderArrows() }
  if (selection.ids.has(id)) {
    selection.ids.delete(id); getBlockEl(id)?.classList.remove('selected')
  } else {
    selection.ids.add(id); getBlockEl(id)?.classList.add('selected')
  }
  selection.blockId = selection.ids.size === 1 ? [...selection.ids][0] : null
  renderInspector()
}

export function setSelection(ids) {
  selection.ids.forEach(sid => getBlockEl(sid)?.classList.remove('selected'))
  selection.ids.clear()
  if (selection.arrowId) { selection.arrowId = null; renderArrows() }
  ids.forEach(id => {
    if (state.blocks[id]) { selection.ids.add(id); getBlockEl(id)?.classList.add('selected') }
  })
  selection.blockId = selection.ids.size === 1 ? [...selection.ids][0] : null
  renderInspector()
}

export function selectArrow(id) {
  selection.ids.forEach(sid => getBlockEl(sid)?.classList.remove('selected'))
  selection.ids.clear(); selection.blockId = null
  selection.arrowId = id
  renderArrows()
  renderInspector()
}

export function deselectAll() {
  selection.ids.forEach(sid => getBlockEl(sid)?.classList.remove('selected'))
  selection.ids.clear(); selection.blockId = null
  if (selection.arrowId) { selection.arrowId = null; renderArrows() }
  renderInspector()
}

// ── Block / arrow mutations ──────────────────────────────────
export function mutateBlock(id, changes) {
  if (!state.blocks[id]) return
  Object.assign(state.blocks[id], changes)
  renderBlock(id)
  renderArrows()
  runGapDetection()
  debouncedSave()
  afterMutation()
}

export function createBlock(type, wx, wy) {
  snapshot()
  const id = genId()
  const count = Object.keys(state.blocks).length
  state.blocks[id] = {
    id, type,
    title: TYPES[type]?.label || type,
    description: '', notes: '',
    x: wx - DEFAULT_WIDTH/2 + (count % 5) * 12,
    y: wy - 50            + (count % 5) * 10,
    actions: [], questions: []
  }
  renderBlock(id)
  updateHint()
  runGapDetection()
  debouncedSave()
  afterMutation()
  return id
}

export function deleteBlock(id) {
  if (!state.blocks[id]) return
  snapshot()
  delete state.blocks[id]
  getBlockEl(id)?.remove()
  state.arrows = state.arrows.filter(a => a.from !== id && a.to !== id)
  renderArrows()
  if (selection.blockId === id) {
    selection.ids.delete(id); selection.blockId = null; renderInspector()
  }
  updateHint()
  runGapDetection()
  debouncedSave()
  afterMutation()
}

export function addArrow(fromId, toId) {
  if (fromId === toId) return
  if (state.arrows.some(a => a.from === fromId && a.to === toId)) return
  snapshot()
  state.arrows.push({ id: genId(), from: fromId, to: toId })
  renderArrows()
  runGapDetection()
  debouncedSave()
  afterMutation()
}

export function deleteArrow(id) {
  snapshot()
  state.arrows = state.arrows.filter(a => a.id !== id)
  $.arrowsGroup().querySelector(`[data-aid="${id}"]`)?.remove()
  if (selection.arrowId === id) { selection.arrowId = null; renderInspector() }
  runGapDetection()
  debouncedSave()
  afterMutation()
}

export function duplicateBlock(id) {
  const b = state.blocks[id]; if (!b) return null
  snapshot()
  const newId = genId()
  state.blocks[newId] = { ...JSON.parse(JSON.stringify(b)), id: newId, x: b.x + 32, y: b.y + 32 }
  renderBlock(newId)
  updateHint()
  runGapDetection()
  debouncedSave()
  afterMutation()
  return newId
}

export function deleteBlocksBatch(ids) {
  if (!ids.length) return
  snapshot()
  ids.forEach(id => {
    if (!state.blocks[id]) return
    delete state.blocks[id]; getBlockEl(id)?.remove()
    state.arrows = state.arrows.filter(a => a.from !== id && a.to !== id)
  })
  selection.ids.clear(); selection.blockId = null
  renderArrows(); updateHint(); runGapDetection(); renderInspector()
  debouncedSave()
  afterMutation()
}

// ── Undo / Redo ──────────────────────────────────────────────
export function undo() {
  const history = getUndoHistory()
  if (!history.length) return
  const future = getRedoFuture()
  future.push(JSON.stringify({ blocks: state.blocks, arrows: state.arrows }))
  const d = JSON.parse(history.pop())
  state.blocks = d.blocks; state.arrows = d.arrows
  renderAllBlocks(); renderArrows(); runGapDetection(); renderInspector()
  deselectAll(); debouncedSave()
}

export function redo() {
  const future = getRedoFuture()
  if (!future.length) return
  const history = getUndoHistory()
  history.push(JSON.stringify({ blocks: state.blocks, arrows: state.arrows }))
  const d = JSON.parse(future.pop())
  state.blocks = d.blocks; state.arrows = d.arrows
  renderAllBlocks(); renderArrows(); runGapDetection(); renderInspector()
  deselectAll(); debouncedSave()
}

// ── Canvas title ─────────────────────────────────────────────
export function updateCanvasTitle() {
  const el = $.canvasTitle()
  const t = canvasMeta.title || 'Strategy canvas'
  if (el.contentEditable !== 'true') el.textContent = t
  document.title = canvasMeta.title ? canvasMeta.title + ' | Pathfinder' : 'Pathfinder | Strategy Canvas'
}
