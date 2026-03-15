// ════════════════════════════════════════════════════════════
//  render.js — DOM rendering, block creation, canvas layout,
//              selection, mutations, undo/redo
// ════════════════════════════════════════════════════════════

import { state, selection, ui, canvasMeta, debouncedSave, snapshot,
         getUndoHistory, getRedoFuture } from './state.js'
import { $, TYPES, SWATCH_COLORS, SWATCH_NAMES, ACTION_DEFS, STATUS_DEFS, PRIORITY_DEFS,
         ARROW_LABEL_PRESETS, TYPE_EXPLANATIONS, DEFAULT_WIDTH, escHtml, genId, getBlockEl, getBlockDims, getBlockVotes, getSmallIcon } from './utils.js'
import { renderArrows, renderFrames, updateHint } from './canvas.js'
import { runGapDetection, getGapFixes } from './gaps.js'
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

  el.className = 'block' + (selection.ids.has(id) ? ' selected' : '') + (b.collapsed ? ' collapsed' : '')
  el.dataset.id   = id
  el.dataset.type = b.type
  const w = b.width || DEFAULT_WIDTH
  el.style.cssText = `left:${b.x}px;top:${b.y}px;width:${w}px`
  if (b.color) el.style.setProperty('--bc', b.color)

  const actHtml = b.actions.map(a => `<span class="action-badge ${a}" title="${ACTION_DEFS[a] || a}">${a}</span>`).join('')
  const statusHtml = b.status && b.status !== 'not-started'
    ? `<span class="status-badge status-${b.status}" title="${STATUS_DEFS[b.status]?.label || b.status}">${STATUS_DEFS[b.status]?.icon || ''} ${STATUS_DEFS[b.status]?.label || b.status}</span>` : ''
  const priorityHtml = b.priority
    ? `<span class="priority-badge priority-${b.priority}" title="${PRIORITY_DEFS[b.priority]?.label || b.priority} priority">${PRIORITY_DEFS[b.priority]?.label || b.priority}</span>` : ''
  const descHtml = b.description
    ? `<div class="block-desc">${escHtml(b.description)}</div>` : ''
  const badgeStyle = b.color ? ` style="color:${b.color}"` : ''

  // Voting indicator - show vote count if any votes exist
  const voteCount = getBlockVotes(id).reduce((sum, v) => sum + v.dots, 0)
  const voteClass = voteCount > 0 ? ' block-vote-indicator has-votes' : ' block-vote-indicator'
  const voteHtml = voteCount > 0 ? `\n      <span class="${voteClass}" title="${voteCount} votes">${getSmallIcon('vote')} ${voteCount}</span>` : ''

  el.tabIndex = 0
  el.setAttribute('role', 'article')
  el.setAttribute('aria-label', `${TYPES[b.type]?.label || b.type}: ${b.title || 'Untitled'}`)
  el.setAttribute('aria-selected', selection.ids.has(id) ? 'true' : 'false')

  el.innerHTML = `
    <div class="block-header">
      <span class="block-type-badge"${badgeStyle}>${TYPES[b.type]?.label || b.type}</span>${voteHtml}
      <div class="block-gap-icons" id="gi-${id}"></div>
      <button class="block-collapse-btn" data-bid="${id}" title="${b.collapsed ? 'Expand' : 'Collapse'}" aria-label="${b.collapsed ? 'Expand block' : 'Collapse block'}">${b.collapsed ? '&#9654;' : '&#9660;'}</button>
    </div>
    <div class="block-title" id="bt-${id}">${escHtml(b.title) || '<span style="opacity:.35">Untitled</span>'}</div>
    ${descHtml}
    ${(statusHtml || priorityHtml) ? `<div class="block-meta">${priorityHtml}${statusHtml}</div>` : ''}
    ${actHtml ? `<div class="block-actions">${actHtml}</div>` : ''}
    <div class="port port-left"   data-port="left"   data-bid="${id}"></div>
    <div class="port port-right"  data-port="right"  data-bid="${id}"></div>
    <div class="port port-top"    data-port="top"    data-bid="${id}"></div>
    <div class="port port-bottom" data-port="bottom" data-bid="${id}"></div>
    <div class="block-resize-handle" data-bid="${id}"></div>`
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
    const frameSection = document.getElementById('frameSection')
    const ungroupBtn = document.getElementById('ungroupBtn')
    const groupBlocksBtn = document.getElementById('groupBlocksBtn')
    if (frameSection && ungroupBtn && groupBlocksBtn) {
      const hasGroup = selection.groupId && state.groups[selection.groupId]
      frameSection.style.display = hasGroup ? '' : 'none'
      groupBlocksBtn.style.display = hasGroup ? 'none' : ''
      if (hasGroup) {
        const lbl = document.getElementById('frameLabelInput')
        if (lbl) lbl.value = state.groups[selection.groupId].label
      }
    }
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
      // Label presets
      const presetsEl = document.getElementById('arrowLabelPresets')
      if (presetsEl) {
        presetsEl.innerHTML = ARROW_LABEL_PRESETS.map(p =>
          `<button class="arrow-preset-chip${a.label === p ? ' active' : ''}" data-preset="${p}">${p}</button>`
        ).join('')
      }
      // Style buttons
      document.querySelectorAll('[data-arrow-style]').forEach(btn =>
        btn.classList.toggle('active', (a.style || 'curved') === btn.dataset.arrowStyle))
      // Bidirectional toggle
      document.getElementById('arrowBidir').classList.toggle('active', !!a.bidirectional)
      // Color swatches
      const arrowSwatches = $.arrowColorSwatches()
      if (arrowSwatches) {
        arrowSwatches.innerHTML =
          `<div class="color-swatch swatch-reset${!a.color ? ' active' : ''}" data-color="reset" role="button" aria-label="Default color" title="Default"></div>` +
          SWATCH_COLORS.map(c =>
            `<div class="color-swatch${a.color === c ? ' active' : ''}" data-color="${c}" style="background:${c}" role="button" aria-label="${SWATCH_NAMES[c] || c}" title="${SWATCH_NAMES[c] || c}"></div>`
          ).join('')
      }
      // Weight buttons
      document.querySelectorAll('[data-arrow-weight]').forEach(btn =>
        btn.classList.toggle('active', (a.weight || 2) === +btn.dataset.arrowWeight))
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
  const TYPE_TIPS = {
    goal: 'What you want to achieve', problem: 'Blocker or issue', requirement: 'Needed to proceed',
    risk: 'What might go wrong', question: 'Unknown / assumption', decision: 'A choice already made',
    resource: 'Available asset', output: 'Expected result', context: 'Background information', custom: 'Free-form block',
  }
  $.typePicker().innerHTML = Object.entries(TYPES).map(([t, cfg]) =>
    `<span class="type-pill${t===b.type?' active':''}" data-type="${t}" style="color:${cfg.color}" title="${TYPE_TIPS[t] || t}">${cfg.label}</span>`
  ).join('')

  // Status picker
  const statusPicker = document.getElementById('statusPicker')
  if (statusPicker) {
    statusPicker.innerHTML = `<button class="status-opt${!b.status || b.status === 'not-started' ? ' active' : ''}" data-status="">None</button>` +
      Object.entries(STATUS_DEFS).filter(([k]) => k !== 'not-started').map(([k, v]) =>
        `<button class="status-opt${b.status === k ? ' active' : ''}" data-status="${k}">${v.icon} ${v.label}</button>`
      ).join('')
  }

  // Priority picker
  const priorityPicker = document.getElementById('priorityPicker')
  if (priorityPicker) {
    priorityPicker.innerHTML = `<button class="priority-opt${!b.priority ? ' active' : ''}" data-priority="">None</button>` +
      Object.entries(PRIORITY_DEFS).map(([k, v]) =>
        `<button class="priority-opt${b.priority === k ? ' active' : ''}" data-priority="${k}" style="--pc:${v.color}">${v.label}</button>`
      ).join('')
  }

  inspTitle.value = b.title
  inspDesc.value  = b.description
  inspNotes.value = b.notes || ''

  document.querySelectorAll('.action-toggle').forEach(btn => {
    const isActive = b.actions.includes(btn.dataset.action)
    btn.classList.toggle('active', isActive)
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false')
  })

  // Color swatches
  const swatchesEl = $.colorSwatches()
  if (swatchesEl) {
    swatchesEl.innerHTML =
      `<div class="color-swatch swatch-reset${!b.color ? ' active' : ''}" data-color="reset" role="button" aria-label="Reset to type color" title="Reset to type color"></div>` +
      SWATCH_COLORS.map(c =>
        `<div class="color-swatch${b.color === c ? ' active' : ''}" data-color="${c}" style="background:${c}" role="button" aria-label="${SWATCH_NAMES[c] || c}" title="${SWATCH_NAMES[c] || c}"></div>`
      ).join('')
  }

  renderQuestions(b)

  // Gap fix suggestions
  const gapFixesEl = document.getElementById('gapFixes')
  if (gapFixesEl) {
    const fixes = getGapFixes(b)
    if (fixes.length) {
      gapFixesEl.style.display = ''
      gapFixesEl.innerHTML =
        '<div class="insp-label" style="margin-bottom:8px">Suggestions</div>' +
        fixes.map(f => `
          <div class="gap-fix-item">
            <span class="gap-fix-icon">${f.icon}</span>
            <div class="gap-fix-text">${escHtml(f.text)}</div>
            ${f.action ? `<button class="gap-fix-btn" data-fix="${f.id}" data-bid="${b.id}">${escHtml(f.action)}</button>` : ''}
          </div>`).join('')
    } else {
      gapFixesEl.style.display = 'none'
    }
  }
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
  selection.blockId = null; selection.groupId = null
  if (selection.arrowId) { selection.arrowId = null; renderArrows() }
  if (id) {
    selection.ids.add(id); selection.blockId = id
    getBlockEl(id)?.classList.add('selected')
  }
  renderFrames()
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
  selection.ids.clear(); selection.blockId = null; selection.groupId = null
  if (selection.arrowId) { selection.arrowId = null; renderArrows() }
  renderFrames()
  renderInspector()
}

// ── Block / arrow mutations ──────────────────────────────────
export function mutateBlock(id, changes) {
  if (!state.blocks[id]) return
  Object.assign(state.blocks[id], changes)
  renderBlock(id)
  renderArrows()
  renderFrames()
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
    actions: [], questions: [],
    width: null, color: null, collapsed: false, groupId: null,
    status: null, priority: null,
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
  renderFrames()
  if (selection.blockId === id) {
    selection.ids.delete(id); selection.blockId = null; selection.groupId = null; renderInspector()
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
  state.arrows.push({ id: genId(), from: fromId, to: toId,
    style: 'curved', bidirectional: false, color: null, weight: 2 })
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
  selection.ids.clear(); selection.blockId = null; selection.groupId = null
  renderArrows(); renderFrames(); updateHint(); runGapDetection(); renderInspector()
  debouncedSave()
  afterMutation()
}

// ── Undo / Redo ──────────────────────────────────────────────
export function undo() {
  const history = getUndoHistory()
  if (!history.length) return
  const future = getRedoFuture()
  future.push(JSON.stringify({ blocks: state.blocks, arrows: state.arrows, groups: state.groups }))
  const d = JSON.parse(history.pop())
  state.blocks = d.blocks; state.arrows = d.arrows; state.groups = d.groups || {}
  renderAllBlocks(); renderArrows(); renderFrames(); runGapDetection(); renderInspector()
  deselectAll(); debouncedSave()
}

export function redo() {
  const future = getRedoFuture()
  if (!future.length) return
  const history = getUndoHistory()
  history.push(JSON.stringify({ blocks: state.blocks, arrows: state.arrows, groups: state.groups }))
  const d = JSON.parse(future.pop())
  state.blocks = d.blocks; state.arrows = d.arrows; state.groups = d.groups || {}
  renderAllBlocks(); renderArrows(); renderFrames(); runGapDetection(); renderInspector()
  deselectAll(); debouncedSave()
}

// ── Groups ───────────────────────────────────────────────────
export function createGroup(ids, label = 'Group') {
  if (ids.length < 2) return null
  snapshot()
  const gid = genId()
  state.groups[gid] = { id: gid, label }
  ids.forEach(id => { if (state.blocks[id]) state.blocks[id].groupId = gid })
  selection.groupId = gid
  renderFrames()
  renderInspector()
  debouncedSave()
  afterMutation()
  return gid
}

export function deleteGroup(gid) {
  if (!state.groups[gid]) return
  snapshot()
  Object.values(state.blocks).forEach(b => { if (b.groupId === gid) b.groupId = null })
  delete state.groups[gid]
  $.framesLayer()?.querySelector(`[data-gid="${gid}"]`)?.remove()
  selection.groupId = null
  renderInspector()
  debouncedSave()
  afterMutation()
}

// ── Canvas title ─────────────────────────────────────────────
export function updateCanvasTitle() {
  const el = $.canvasTitle()
  const t = canvasMeta.title || 'Strategy canvas'
  if (el.contentEditable !== 'true') el.textContent = t
  document.title = canvasMeta.title ? canvasMeta.title + ' | Pathfinder' : 'Pathfinder | Strategy Canvas'
}
