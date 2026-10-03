// ════════════════════════════════════════════════════════════
//  render.js: DOM rendering, block creation, canvas layout,
//              selection, mutations, undo/redo
// ════════════════════════════════════════════════════════════

import { state, selection, ui, canvasMeta, debouncedSave, snapshot,
         getUndoHistory, getRedoFuture, resetSnapshotToken, undoEntry, applyPromptOpts } from './state.js'
import { $, TYPES, ACTION_DEFS, STATUS_DEFS, PRIORITY_DEFS,
         DEFAULT_WIDTH, DEFAULT_CARD_STYLE, DEFAULT_ARROW_WEIGHT,
         escHtml, escHtmlMultiline, genId, getBlockEl, getBlockVotes, getSmallIcon } from './utils.js'
import { renderArrows, renderFrames, updateHint } from './canvas.js'
import { runGapDetection } from './gaps.js'
import { refreshPrompt } from './prompt.js'
import { renderInspector } from './inspector.js'
import { lightAccentFor, highlightTabLabel, typeShape, chipIcon } from './cards.js'

// The inspector moved to inspector.js; these re-exports keep every existing
// importer of render.js working.
export { renderInspector, renderQuestions } from './inspector.js'

function afterMutation() {
  ui.promptDirty = true
  if (ui.activeTab === 'prompt') refreshPrompt()
  // Attention, the quick copy bar and the backup status refresh on every
  // change whatever tab is open. Decoupled via event to avoid a cycle.
  window.dispatchEvent(new CustomEvent('pf:canvas-changed'))
}

// ── Block rendering ──────────────────────────────────────────
// Per-block markers (review notes, votes) register a `(block, el)` painter
// here instead of editing renderBlock. Each runs after the card is built.
export const blockDecorators = []

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

  // A type set by the classifier with low confidence waits for a person to
  // confirm it. A view-only link cannot confirm anything, so it shows none.
  const typeCheck = !!b.typeCheck && !ui.readOnly
  el.className = 'block' + (selection.ids.has(id) ? ' selected' : '') + (b.collapsed ? ' collapsed' : '') +
    (b.color ? ' has-color' : '') + (typeCheck ? ' type-check' : '')
  el.dataset.id   = id
  el.dataset.type = b.type
  const w = b.width || DEFAULT_WIDTH
  el.style.cssText = `left:${b.x}px;top:${b.y}px;width:${w}px`
  // Appearance. Both fall back to the canvas-wide default, so changing that
  // one setting restyles every card that has not been overridden.
  el.dataset.card = b.cardStyle || canvasMeta.cardStyle || DEFAULT_CARD_STYLE
  if (b.highlight) el.dataset.highlight = b.highlight
  else delete el.dataset.highlight
  // A custom colour feeds --bc through the stylesheet (.has-color), not
  // inline, so the light theme can swap in a twin that reads on white.
  if (b.color) {
    el.style.setProperty('--bc-custom', b.color)
    const light = lightAccentFor(b.color)
    if (light) el.style.setProperty('--bc-custom-light', light)
  }
  if (b.borderWidth) el.style.setProperty('--bw', b.borderWidth + 'px')

  // Chips are neutral: an icon and a word say which one it is, never a
  // colour (red and amber already mean a type and a gap).
  const word = a => escHtml(String(a).charAt(0).toUpperCase() + String(a).slice(1))
  const actHtml = (b.actions || []).map(a =>
    `<span class="chip action-badge ${escHtml(a)}" title="${escHtml(ACTION_DEFS[a] || a)}">${chipIcon('action', a)}<span>${word(a)}</span></span>`).join('')
  const statusLabel = STATUS_DEFS[b.status]?.label || b.status
  const statusHtml = b.status && b.status !== 'not-started'
    ? `<span class="chip status-badge status-${escHtml(b.status)}" title="${escHtml(statusLabel)}">${chipIcon('status', b.status)}<span>${escHtml(statusLabel)}</span></span>` : ''
  const priorityLabel = PRIORITY_DEFS[b.priority]?.label || b.priority
  const priorityHtml = b.priority
    ? `<span class="chip priority-badge priority-${escHtml(b.priority)}" title="${escHtml(priorityLabel)} priority">${chipIcon('priority', b.priority)}<span>${escHtml(priorityLabel)}</span></span>` : ''
  // Always rendered (even when empty) so the description is directly
  // double-click editable on the card. Empty ones collapse via CSS `:empty`;
  // the selected card shows an "Add description" hint as an overlay, which
  // never changes the card's height (the arrows are drawn to that height).
  const descHtml = `<div class="block-desc">${escHtmlMultiline(b.description)}</div>`

  // The type reads as a neutral label beside a dot in the type colour, so
  // its contrast never depends on the hue. Awaiting a check, the label is a
  // button that opens the type menu (classify.js), with "Looks right" first.
  const typeLabel = escHtml(TYPES[b.type]?.label || b.type)
  // The dot's shape follows the step's role (TYPES shape), so two types close
  // in colour never share a shape.
  const typeDot = `<span class="block-type-dot" data-shape="${typeShape(b.type)}" aria-hidden="true"></span>`
  const typeHtml = typeCheck
    ? `<button type="button" class="block-type-badge block-type-check" data-type-check="${id}" data-canvas-ui` +
      ` aria-haspopup="menu" aria-expanded="false" aria-label="Type ${typeLabel}, set automatically: confirm or change it"` +
      ` aria-keyshortcuts="T" title="Set automatically: confirm or change the type (T)">${typeDot}<span class="block-type-label">${typeLabel}</span>` +
      `<svg class="block-type-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg></button>`
    : `<span class="block-type-badge">${typeDot}<span class="block-type-label">${typeLabel}</span></span>`

  // Voting indicator - show vote count if any votes exist
  const voteCount = getBlockVotes(id).reduce((sum, v) => sum + v.dots, 0)
  const voteClass = voteCount > 0 ? ' block-vote-indicator has-votes' : ' block-vote-indicator'
  const voteHtml = voteCount > 0 ? `\n      <span class="${voteClass}" title="${voteCount} votes">${getSmallIcon('vote')} ${voteCount}</span>` : ''

  // Living-doc markers: a link chip when a doc is wired (click → preview popup),
  // and a check when at least one question has an answer stored.
  const hasDoc = !!(b.docRef && (b.docRef.href || b.docRef.label))
  const docTitle = hasDoc ? (b.docRef.label || b.docRef.href) : ''
  const docHtml = hasDoc
    ? `\n      <button class="block-doc-badge" data-doc-bid="${id}" title="View referenced doc: ${escHtml(docTitle)}" aria-label="View referenced documentation">${getSmallIcon('link')}</button>` : ''
  const answered = (b.questions || []).some(q => q.answer?.trim())
  const answeredHtml = answered
    ? `\n      <span class="block-answered-badge" title="A question on this block has an answer">${getSmallIcon('check')}</span>` : ''

  // Collapsing is an edit, so a view-only link gets no control for it, only
  // a mark on a collapsed card saying that something is folded away.
  const caretSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>'
  const collapseHtml = ui.readOnly
    ? (b.collapsed ? `<span class="block-collapsed-mark" aria-hidden="true" title="Collapsed">${caretSvg}</span>` : '')
    : `<button type="button" class="block-collapse-btn" data-bid="${id}" title="${b.collapsed ? 'Expand' : 'Collapse'}"` +
    ` aria-label="${b.collapsed ? 'Expand block' : 'Collapse block'}" aria-expanded="${b.collapsed ? 'false' : 'true'}">` +
    `${caretSvg}</button>`

  const hlTab = highlightTabLabel(b.highlight)
  const hlTabHtml = hlTab ? `\n    <span class="block-hl-tab" aria-hidden="true">${escHtml(hlTab)}</span>` : ''

  el.tabIndex = 0
  el.setAttribute('role', 'article')
  cardLabels.set(el, `${TYPES[b.type]?.label || b.type}: ${b.title || 'Untitled'}` +
    (hlTab ? `, highlighted ${hlTab}` : '') + (typeCheck ? ', type not confirmed' : '') +
    (ui.readOnly && b.collapsed ? ', collapsed' : ''))
  labelSelected(el, selection.ids.has(id))
  // T opens the type check from the card itself (classify.js), since Tab
  // steps from card to card and never reaches the label's button.
  if (typeCheck) el.setAttribute('aria-keyshortcuts', 'T')
  else el.removeAttribute('aria-keyshortcuts')

  // The gi- slot belongs to gaps.js: runGapDetection paints it after every
  // render, from the same result that sets the card's gap class.
  el.innerHTML = `
    <div class="block-header">
      ${typeHtml}${voteHtml}${docHtml}${answeredHtml}
      <div class="block-gap-icons" id="gi-${id}"></div>
      ${collapseHtml}
    </div>
    <div class="block-title" id="bt-${id}">${escHtml(b.title) || '<span class="block-title-empty">Untitled</span>'}</div>
    ${descHtml}
    ${(statusHtml || priorityHtml) ? `<div class="block-meta">${priorityHtml}${statusHtml}</div>` : ''}
    ${actHtml ? `<div class="block-actions">${actHtml}</div>` : ''}${hlTabHtml}
    <div class="port port-left"   data-port="left"   data-bid="${id}"></div>
    <div class="port port-right"  data-port="right"  data-bid="${id}"></div>
    <div class="port port-top"    data-port="top"    data-bid="${id}"></div>
    <div class="port port-bottom" data-port="bottom" data-bid="${id}"></div>
    <div class="block-resize-handle" data-bid="${id}"></div>`

  for (const paint of blockDecorators) {
    try { paint(b, el) } catch (err) { console.error('block decorator failed', err) }
  }
}

export function renderAllBlocks() {
  $.canvasRoot().querySelectorAll('.block').forEach(el => { if (!state.blocks[el.dataset.id]) el.remove() })
  Object.keys(state.blocks).forEach(id => renderBlock(id))
}


// ── Selection ────────────────────────────────────────────────
// aria-selected is not supported on role=article (Chrome drops it, and it
// went stale besides), so the card's name says it: "Goal: Ship it, selected".
const cardLabels = new WeakMap()   // card element -> its name without the state
function labelSelected(el, on) {
  const base = cardLabels.get(el) ?? el.getAttribute('aria-label') ?? ''
  el.setAttribute('aria-label', on ? base + ', selected' : base)
}
function paintSelected(id, on) {
  const el = getBlockEl(id); if (!el) return
  el.classList.toggle('selected', on)
  if (cardLabels.has(el)) labelSelected(el, on)
}

export function selectBlock(id) {
  selection.ids.forEach(sid => paintSelected(sid, false))
  selection.ids.clear()
  selection.blockId = null; selection.groupId = null
  if (selection.arrowId) { selection.arrowId = null; renderArrows() }
  if (id) {
    selection.ids.add(id); selection.blockId = id
    paintSelected(id, true)
  }
  renderFrames()
  renderInspector()
}

export function addToSelection(id) {
  if (selection.arrowId) { selection.arrowId = null; renderArrows() }
  if (selection.ids.has(id)) {
    selection.ids.delete(id); paintSelected(id, false)
  } else {
    selection.ids.add(id); paintSelected(id, true)
  }
  selection.blockId = selection.ids.size === 1 ? [...selection.ids][0] : null
  renderInspector()
}

export function setSelection(ids) {
  selection.ids.forEach(sid => paintSelected(sid, false))
  selection.ids.clear()
  if (selection.arrowId) { selection.arrowId = null; renderArrows() }
  ids.forEach(id => {
    if (state.blocks[id]) { selection.ids.add(id); paintSelected(id, true) }
  })
  selection.blockId = selection.ids.size === 1 ? [...selection.ids][0] : null
  renderInspector()
}

export function selectArrow(id) {
  selection.ids.forEach(sid => paintSelected(sid, false))
  selection.ids.clear(); selection.blockId = null
  selection.arrowId = id
  renderArrows()
  renderInspector()
}

export function deselectAll() {
  selection.ids.forEach(sid => paintSelected(sid, false))
  selection.ids.clear(); selection.blockId = null; selection.groupId = null
  if (selection.arrowId) { selection.arrowId = null; renderArrows() }
  renderFrames()
  renderInspector()
}

// ── Block / arrow mutations ──────────────────────────────────
// `undo: true` makes the change its own undo step. It defaults to false so
// callers that already took a snapshot (or coalesce with snapshotOnce) do not
// get a second one.
export function mutateBlock(id, changes, { undo = false } = {}) {
  if (!state.blocks[id]) return
  if (undo) snapshot()
  Object.assign(state.blocks[id], changes)
  renderBlock(id)
  renderArrows()
  renderFrames()
  runGapDetection()
  debouncedSave()
  afterMutation()
}

/**
 * Change several blocks as one undo step. `changesOrFn` is either an object
 * applied to every block or `(block) => changes`. Returns how many changed.
 * `arrows` is passed to renderArrows (a nudge draws like a drag frame).
 */
export function mutateBlocks(ids, changesOrFn, { undo = true, arrows = null } = {}) {
  const live = ids.filter(id => state.blocks[id])
  if (!live.length) return 0
  if (undo) snapshot()
  live.forEach(id => {
    const b = state.blocks[id]
    const changes = typeof changesOrFn === 'function' ? changesOrFn(b) : changesOrFn
    if (changes) Object.assign(b, changes)
    renderBlock(id)
  })
  renderArrows(arrows || {})
  renderFrames()
  runGapDetection()
  debouncedSave()
  afterMutation()
  return live.length
}

/**
 * Change one arrow. One undo step by default. Moving either end off its pin
 * drops `portsBy`, since the side is now the user's choice, unless the caller
 * passes `portsBy` explicitly (reversing an arrow keeps its provenance).
 * `refreshInspector: false` is for text inputs that must keep their caret.
 */
export function mutateArrow(id, changes, { undo = true, refreshInspector = true } = {}) {
  const a = state.arrows.find(arr => arr.id === id)
  if (!a) return null
  if (undo) snapshot()
  Object.assign(a, changes)
  if (('fromPort' in changes || 'toPort' in changes) && !('portsBy' in changes)) delete a.portsBy
  if (a.portsBy == null) delete a.portsBy
  renderArrows({ cheap: false })
  runGapDetection()
  debouncedSave()
  afterMutation()
  if (refreshInspector && selection.arrowId === id) renderInspector()
  return a
}

function nextUntitledTitle() {
  const used = Object.values(state.blocks)
    .map(b => /^Untitled (\d+)$/.exec(b.title))
    .filter(Boolean)
    .map(m => +m[1])
  return `Untitled ${(used.length ? Math.max(...used) : 0) + 1}`
}

export function createBlock(type, wx, wy, { undo = true } = {}) {
  if (undo) snapshot()
  const id = genId()
  const count = Object.keys(state.blocks).length
  state.blocks[id] = {
    id, type,
    title: nextUntitledTitle(),
    description: '', notes: '',
    x: wx - DEFAULT_WIDTH/2 + (count % 5) * 12,
    y: wy - 50            + (count % 5) * 10,
    actions: [], questions: [],
    docRef: null,
    width: null, color: null, collapsed: false, groupId: null,
    status: null, priority: null,
    cardStyle: null, borderWidth: null,   // null = follow the canvas default
    highlight: null,                      // presentation emphasis, not meaning
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

// Returns the new arrow's id, or null when the connection already exists.
export function addArrow(fromId, toId, fromPort = null, toPort = null, { undo = true, relation = null } = {}) {
  if (fromId === toId) return null
  if (state.arrows.some(a => a.from === fromId && a.to === toId)) return null
  if (undo) snapshot()
  const arrow = { id: genId(), from: fromId, to: toId,
    style: 'routed', bidirectional: false, color: null, weight: DEFAULT_ARROW_WEIGHT, fromPort, toPort }
  if (relation) arrow.relation = relation
  state.arrows.push(arrow)
  renderArrows()
  runGapDetection()
  debouncedSave()
  afterMutation()
  return arrow.id
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
// Undo and redo swap the canvas with an entry of the same scope: a replace's
// step (framing) trades the whole framing, any other step the map settings
// it carries (state.js undoEntry).
function restoreEntry(raw) {
  const d = JSON.parse(raw)
  state.blocks = d.blocks; state.arrows = d.arrows; state.groups = d.groups || {}
  if (d.meta) {
    const { prompt, ...rest } = d.meta
    Object.assign(canvasMeta, rest)
    if (prompt) {
      applyPromptOpts(prompt)
      window.dispatchEvent(new CustomEvent('pf:prompt-opts-changed'))
    }
    document.body.classList.toggle('spotlight', !!canvasMeta.spotlight)
    updateCanvasTitle()
    ui.promptDirty = true
    // Situation and brief controls live in ui-panels.js, which listens.
    window.dispatchEvent(new CustomEvent('pf:meta-restored'))
  }
  resetSnapshotToken()
  // Undo keeps what was selected when it still exists, so "change it in the
  // inspector, undo, change it again" needs no reselect. It used to deselect
  // everything, which also emptied the inspector and dropped focus on the page.
  const before = document.activeElement
  const beforeId = before && before !== document.body ? before.id : ''
  const keep = [...selection.ids].filter(id => state.blocks[id])
  const arrowId = !keep.length && selection.arrowId && state.arrows.some(a => a.id === selection.arrowId)
    ? selection.arrowId : null
  selection.ids.clear(); keep.forEach(id => selection.ids.add(id))
  selection.blockId = keep.length === 1 ? keep[0] : null
  selection.arrowId = arrowId
  if (selection.groupId && !state.groups[selection.groupId]) selection.groupId = null
  renderAllBlocks(); renderArrows(); renderFrames(); runGapDetection(); renderInspector()
  // The empty state follows the blocks: undoing a Clear must take the Brain
  // Dump card away again, and undoing the only block must bring it back.
  updateHint()
  refocusAfterRestore(before, beforeId)
  debouncedSave()
  // Everything that listens for canvas changes (Attention, search, the
  // comparison bar, the label editor) sees an undo like any other change.
  afterMutation()
}

const shown = el => !!el && el.isConnected && el.getClientRects().length > 0

// Focus stays on the control that was used, or on the card, when the
// restore hid or replaced it. Focus somewhere still visible is left alone.
function refocusAfterRestore(before, beforeId) {
  const ae = document.activeElement
  if (!before || before === document.body || (ae && ae !== document.body)) return
  let target = shown(before) ? before : (beforeId ? document.getElementById(beforeId) : null)
  if (!shown(target)) target = selection.blockId ? getBlockEl(selection.blockId) : null
  if (shown(target)) target.focus({ preventScroll: true })
}

export function undo() {
  const history = getUndoHistory()
  if (!history.length) return
  const raw = history.pop()
  getRedoFuture().push(undoEntry({ framing: JSON.parse(raw).framing }))
  restoreEntry(raw)
}

export function redo() {
  const future = getRedoFuture()
  if (!future.length) return
  const raw = future.pop()
  getUndoHistory().push(undoEntry({ framing: JSON.parse(raw).framing }))
  restoreEntry(raw)
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
  if (el.contentEditable !== 'true') {
    el.textContent = t
    // A control that renames the map, except in a view-only page, where it
    // is only the header link's text and no Tab stop.
    if (ui.readOnly) {
      el.removeAttribute('role'); el.removeAttribute('aria-label'); el.removeAttribute('tabindex')
    } else {
      el.setAttribute('role', 'button'); el.setAttribute('aria-label', 'Rename map, ' + t); el.tabIndex = 0
    }
  }
  // A long title ellipsizes in the header; the tooltip carries all of it.
  el.title = t
  document.title = canvasMeta.title ? canvasMeta.title + ' | Pathfinder' : 'Pathfinder | Strategy Canvas'
}
