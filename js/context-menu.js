// ════════════════════════════════════════════════════════════
//  context-menu.js: right-click menus for what is under the
//  pointer. A block, a multi-selection, a connection and empty
//  canvas each get their own menu, all built with menu.js, so
//  keyboard support, dismissal and styling match every other
//  menu in the app.
//
//  Right-click, Shift+F10 and the ContextMenu key open them.
//  Every change is one undo step. Read-only and embed views get
//  navigation only (zoom to block, go to an end, fit, 100%).
//
//  Used elsewhere:
//   openCanvasAddMenu(clientX, clientY, opts?)  the quick-add type
//     picker (double-click on empty canvas, port drop). opts:
//     { suggested, title, onPick(type, world), onCancel }
//   openBlockMenu / openMultiMenu / openArrowMenu / openCanvasMenu
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, pointer, snapshot, toWorld } from './state.js'
import { $, TYPES, typesByStep, STATUS_DEFS, PRIORITY_DEFS, HIGHLIGHTS,
         SWATCH_COLORS, SWATCH_NAMES, genId, getBlockEl, showToast } from './utils.js'
import { applyTransform, fitView, updateHint,
         arrowRoute, arrowPattern, ARROW_ROUTES } from './canvas.js'
import { selectBlock, setSelection, selectArrow, renderInspector,
         mutateBlock, mutateBlocks, mutateArrow, deleteBlock, deleteBlocksBatch,
         deleteArrow, duplicateBlock, addArrow, createGroup } from './render.js'
import { openMenu, isMenuOpen } from './menu.js'
import { typeDot, typeRow, typeNoteItem, typeMenuItems, retypeBlocks, typeNoun } from './type-menu.js'
import { typeShape, chipIcon } from './cards.js'
import { createBlockAt, createConnected, insertOnArrow, suggestedNextTypes,
         defaultConnectDirection } from './create.js'
import { startInlineEdit } from './inline-edit.js'
import { startArrowLabelEdit } from './arrow-edit.js'
import { RELATIONS, relationOf, impliedVerb, connectionLabel } from './relations.js'
import { arrangeSelection } from './align.js'
import { createBlocksFromText } from './classify.js'
import { focusBlock, runTidy } from './ui-panels.js'
import { withCameraHeld, announce } from './navigation.js'
import { zoomTo, zoomToBlocks } from './zoom-controls.js'
import { focusQuestion } from './inspector.js'

// ── Small helpers ────────────────────────────────────────────
const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')
const MOD = IS_MAC ? '⌘' : 'Ctrl+'
const DIV = { type: 'divider' }

const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
// One 16px line icon per row, so labels line up with the type dots.
const I = {
  edit:      svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
  desc:      svg('<path d="M4 6h16M4 11h16M4 16h10"/>'),
  add:       svg('<rect x="3" y="7" width="9" height="10" rx="2"/><path d="M12 12h3M19 9v6M16 12h6"/>'),
  connect:   svg('<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8.5 12h7"/>'),
  type:      svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="3.5"/><path d="M13 7.5h7M7.5 13v7"/>'),
  status:    svg('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/>'),
  priority:  svg('<path d="M6 21V4h11l-2 4 2 4H6"/>'),
  highlight: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>'),
  colour:    svg('<path d="M12 3.5c3.5 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-6 6-10z"/>'),
  up:        svg('<path d="M12 20V8M7 13l5-5 5 5M5 4h14"/>'),
  down:      svg('<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>'),
  sameType:  svg('<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/>'),
  zoom:      svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/>'),
  duplicate: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  collapse:  svg('<path d="M7 10l5 5 5-5"/>'),
  expand:    svg('<path d="M10 7l5 5-5 5"/>'),
  question:  svg('<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.5a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4M12 16.8v.2"/>'),
  trash:     svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  label:     svg('<path d="M5 6h14M12 6v13"/>'),
  meaning:   svg('<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>'),
  route:     svg('<path d="M4 18h6V6h10"/>'),
  pattern:   svg('<path d="M3 12h4M10 12h4M17 12h4"/>'),
  reverse:   svg('<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4"/>'),
  twoWay:    svg('<path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4"/>'),
  weight:    svg('<path d="M4 7h16" stroke-width="1"/><path d="M4 12h16" stroke-width="2"/><path d="M4 17.5h16" stroke-width="3.2"/>'),
  insert:    svg('<path d="M3 12h5M16 12h5"/><rect x="8" y="8" width="8" height="8" rx="1.5"/>'),
  reset:     svg('<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v4h4"/>'),
  source:    svg('<circle cx="6" cy="12" r="2.5" fill="currentColor"/><path d="M9 12h11M16 8l4 4-4 4"/>'),
  target:    svg('<path d="M4 12h11M11 8l4 4-4 4"/><circle cx="18.5" cy="12" r="2.5" fill="currentColor"/>'),
  paste:     svg('<rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5V3.5h6V5M9 11h6M9 15h4"/>'),
  selectAll: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  tidy:      svg('<rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="4" width="6" height="5" rx="1"/><rect x="9" y="15" width="6" height="5" rx="1"/><path d="M6 9v3h12V9M12 12v3"/>'),
  fit:       svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  actual:    svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
  align:     svg('<path d="M4 4v16"/><rect x="7" y="6" width="11" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>'),
  distribute: svg('<path d="M4 4v16M20 4v16"/><rect x="9" y="7" width="6" height="10" rx="1"/>'),
  group:     svg('<rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="3 2.5"/><rect x="7" y="7" width="4" height="4" rx="1"/><rect x="13" y="13" width="4" height="4" rx="1"/>'),
}

const titleOf = b => (b?.title || '').trim() || 'Untitled'
const arrowById = aid => state.arrows.find(a => a.id === aid)

// The words for a type come from type-menu.js, so the menus' tally and the
// inspector's read the same.
export { typeNoun }

/** "5 blocks: 3 problems, 2 requirements", or "3 problems" when all match. */
export function selectionTally(ids) {
  const tally = new Map()
  ids.forEach(id => { const t = state.blocks[id]?.type; if (t) tally.set(t, (tally.get(t) || 0) + 1) })
  const n = [...tally.values()].reduce((s, v) => s + v, 0)
  if (tally.size === 1) { const [[t, c]] = [...tally]; return `${c} ${typeNoun(t, c)}` }
  const parts = [...tally].sort((a, b) => b[1] - a[1]).map(([t, c]) => `${c} ${typeNoun(t, c)}`)
  return `${n} blocks: ${parts.join(', ')}`
}

// Drop missing rows and the dividers they would leave doubled or dangling,
// so hiding what does not apply never leaves an empty section behind.
function tidyItems(items) {
  const out = []
  for (const it of items) {
    if (!it) continue
    if (it.type === 'divider' && (!out.length || out[out.length - 1].type === 'divider')) continue
    out.push(it)
  }
  while (out.length && out[out.length - 1].type === 'divider') out.pop()
  return out
}

// The value every block in `ids` shares, or undefined when they differ.
function shared(ids, fn) {
  const vals = new Set(ids.filter(id => state.blocks[id]).map(id => fn(state.blocks[id])))
  return vals.size === 1 ? [...vals][0] : undefined
}

function worldAt(clientX, clientY) {
  const r = $.canvasViewport().getBoundingClientRect()
  return toWorld(clientX - r.left, clientY - r.top)
}

// Root rows get a stable hook: `ctx-item`, plus `data-ctx` naming the action
// and `data-add-type` on the add rows. menu.js renders one row per item, in
// order, so the item list maps onto the menu's children.
function tagRows(el, items) {
  if (!el) return
  items.forEach((item, i) => {
    const row = el.children[i]
    if (!row || !row.classList.contains('pf-menu-item')) return
    row.classList.add('ctx-item')
    if (item.ctx) row.dataset.ctx = item.ctx
    if (item.addType) row.dataset.addType = item.addType
  })
}

// A menu action can remove what had focus (Delete). Keep the keyboard on
// the canvas rather than dropping it on the page.
function keepFocus() {
  const ae = document.activeElement
  if (!ae || ae === document.body || !ae.isConnected) $.canvasViewport()?.focus({ preventScroll: true })
}

// The viewport is overflow:hidden and pans by transform, so it must never
// scroll: from then on the canvas is drawn out of step with view.pan, and
// every click and drop maps to the wrong world point. menu.js hands focus
// back without scrolling; these menus also undo any scroll that slipped
// through (a focused card the chosen action moved, say).
function unscrollViewport() {
  const vp = $.canvasViewport()
  if (vp && (vp.scrollLeft || vp.scrollTop)) { vp.scrollLeft = 0; vp.scrollTop = 0 }
}

// menu.js calls onClose before it runs the chosen action, so check again
// once that action has had its turn.
function guardScroll() {
  unscrollViewport()
  queueMicrotask(unscrollViewport)
}

/** Open a menu with the scroll guard and a focus return that cannot scroll. */
function openCtxMenu(items, opts) {
  const onClose = opts.onClose
  const m = openMenu(items, {
    ...opts,
    onClose: () => { guardScroll(); onClose?.() },
  })
  tagRows(m.el, items)
  return m
}

// True when the card's top-left corner, where a keyboard-opened menu
// anchors, is inside the visible canvas.
function onScreen(id) {
  const r = getBlockEl(id)?.getBoundingClientRect()
  const v = $.canvasViewport()?.getBoundingClientRect()
  if (!r || !v || !(r.width || r.height) || !(v.width && v.height)) return false
  const x = r.left + 12, y = r.top + 12
  return x >= v.left && x <= v.right - 4 && y >= v.top && y <= v.bottom - 4
}

/** Pan (never zoom) just far enough that the whole card is in view. */
function revealBlock(id) {
  const r = getBlockEl(id)?.getBoundingClientRect()
  const v = $.canvasViewport()?.getBoundingClientRect()
  if (!r || !v || !(r.width || r.height) || !(v.width && v.height)) return
  const M = 40
  const shift = (lo, hi, vlo, vhi) => {
    if (lo < vlo + M) return vlo + M - lo
    if (hi > vhi - M) return Math.max(vhi - M - hi, vlo + M - lo)
    return 0
  }
  const dx = shift(r.left, r.right, v.left, v.right), dy = shift(r.top, r.bottom, v.top, v.bottom)
  if (!dx && !dy) return
  view.panX = Math.round(view.panX + dx)
  view.panY = Math.round(view.panY + dy)
  applyTransform()
}

// ── Mutations: one undo step each, none for a no-op ──────────
/**
 * Apply changes to blocks as one undo step. `spec` is an object or
 * `(block) => changes`. Keys already at that value are dropped, and when
 * nothing is left to change no snapshot is taken at all.
 */
function applyBlocks(ids, spec) {
  const plan = new Map()
  ids.forEach(id => {
    const b = state.blocks[id]; if (!b) return
    const raw = typeof spec === 'function' ? spec(b) : spec
    if (!raw) return
    const changes = {}
    for (const [k, v] of Object.entries(raw)) if (!Object.is(b[k] ?? null, v ?? null)) changes[k] = v
    if (Object.keys(changes).length) plan.set(id, changes)
  })
  if (!plan.size) return 0
  if (plan.size === 1) { const [[id, changes]] = [...plan]; mutateBlock(id, changes, { undo: true }) }
  else mutateBlocks([...plan.keys()], b => plan.get(b.id))
  renderInspector()
  return plan.size
}

function applyArrow(aid, changes) {
  const a = arrowById(aid); if (!a) return null
  const diff = {}
  for (const [k, v] of Object.entries(changes)) if (!Object.is(a[k] ?? null, v ?? null)) diff[k] = v
  if (!Object.keys(diff).length) return a
  return mutateArrow(aid, diff)
}

// Choosing a type is also the answer to "is this typed right?": retypeBlock
// (type-menu.js) settles the check the same way every type picker does.
// Blocks the pick would not change take no undo step.
function retypeAll(ids, t) {
  const n = retypeBlocks(ids, t)
  if (n) renderInspector()
  return n
}

// ── View helpers ─────────────────────────────────────────────
// The camera is zoom-controls.js's: a menu row and its shortcut (Shift+2,
// Shift+0) run the same function, so they cannot frame differently.

// ── Graph helpers ────────────────────────────────────────────
// The block one step along `a` from `cur`, going down (with the arrow) or
// up (against it). A two-way connection runs both ways, so it is followed
// either way.
function stepAlong(a, cur, dir) {
  if (a.from === a.to) return null
  const fwd = a.from === cur ? a.to : null, back = a.to === cur ? a.from : null
  const next = dir === 'down' ? (fwd || (a.bidirectional ? back : null)) : (back || (a.bidirectional ? fwd : null))
  return next && state.blocks[next] ? next : null
}

const hasStep = (id, dir) => state.arrows.some(a => stepAlong(a, id, dir))

// Everything that leads to (up) or follows from (down) a block along the
// drawn direction, the block itself included so the chain stays selected.
function reach(id, dir) {
  const seen = new Set([id])
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift()
    state.arrows.forEach(a => {
      const next = stepAlong(a, cur, dir)
      if (next && !seen.has(next)) { seen.add(next); queue.push(next) }
    })
  }
  return [...seen]
}

function selectAndSay(ids, where) {
  setSelection(ids)
  const n = ids.length - 1
  showToast(`Selected this block and ${n} ${where}`, 'success', 1600)
}

// Any connection between the two, whichever way it runs (two-way included).
// A second arrow the other way would stack on it and close a loop, which is
// why Reverse direction refuses the same thing.
const linked = (x, y) => state.arrows.some(a => (a.from === x && a.to === y) || (a.from === y && a.to === x))

// Where a new connection from `id` to `other` should point, and what the
// pair implies it means, so the row can say so before it is picked.
function connectPlan(id, other) {
  const b = state.blocks[id], o = state.blocks[other]
  const incoming = defaultConnectDirection(b.type, o.type) === 'in'
  const from = incoming ? other : id, to = incoming ? id : other
  const verb = impliedVerb(state.blocks[from].type, state.blocks[to].type)
  return { from, to, incoming, verb }
}

// The implied verbs that are not a verb in the third person: they need "is"
// to read as a sentence ("it is mitigated by this", not "it mitigated by").
const VERB_PHRASE = { 'mitigated by': 'is mitigated by', 'delivered to': 'is delivered to', 'source of': 'is a source of' }

/**
 * "Metric: it measures this", "Requirement: this satisfies it". With no
 * implied verb, what the brief will read from the arrow (relationOf): only
 * an ordering pair "comes before"; a pair that adds no task order says so.
 */
export function connectHint(id, other) {
  const o = state.blocks[other]
  const { from, to, incoming, verb } = connectPlan(id, other)
  const label = TYPES[o.type]?.label || o.type
  if (verb) {
    const phrase = VERB_PHRASE[verb] || verb
    return incoming ? `${label}: it ${phrase} this` : `${label}: this ${phrase} it`
  }
  const relation = relationOf({ from, to }, state.blocks)
  if (relation === 'informs') return `${label}: this informs it, no task order`
  if (relation === 'related') return `${label}: related, no task order`
  return `${label}: this comes before it`
}

// ── Shared submenus ──────────────────────────────────────────
// Type lists come from type-menu.js. These menus are narrow, so they end on
// one line describing the row under the pointer rather than every line.

// Every type grouped by step, for a list of actions rather than a choice.
function groupedTypeRows(makeRow) {
  const out = []
  typesByStep().forEach(g => {
    if (!g.types.length) return
    out.push({ type: 'heading', label: g.label })
    g.types.forEach(t => out.push(makeRow(t)))
  })
  return out
}

function changeTypeItems(ids) {
  return typeMenuItems(shared(ids, b => b.type) ?? null, t => retypeAll(ids, t), { notes: 'pointer' })
}

function statusItems(ids) {
  const cur = shared(ids, b => (b.status && STATUS_DEFS[b.status]) ? b.status : 'not-started')
  return Object.entries(STATUS_DEFS).map(([k, v]) => ({
    label: v.label, radio: true, checked: cur === k,
    // "Not started" is the absence of a status, as in the inspector.
    action: () => applyBlocks(ids, { status: k === 'not-started' ? null : k }),
  }))
}

function priorityItems(ids) {
  const cur = shared(ids, b => b.priority || null)
  return [
    { label: 'None', radio: true, checked: cur === null, action: () => applyBlocks(ids, { priority: null }) },
    ...Object.entries(PRIORITY_DEFS).map(([k, v]) => ({
      label: v.label, icon: chipIcon('priority', k), radio: true, checked: cur === k,
      action: () => applyBlocks(ids, { priority: k }),
    })),
  ]
}

function highlightItems(ids) {
  const cur = shared(ids, b => b.highlight || null)
  return [{
    type: 'swatches', label: 'Highlight',
    options: [
      { value: '', label: 'No highlight', className: 'ctx-sw-none', active: cur === null },
      ...Object.entries(HIGHLIGHTS).map(([k, h]) => ({
        value: k, color: `var(--hl-${k})`, label: h.label, active: cur === k,
        className: k === 'festive' ? 'ctx-sw-festive' : '',
      })),
    ],
    onPick: v => applyBlocks(ids, { highlight: v || null }),
  }]
}

function colourItems(id) {
  const b = state.blocks[id]; if (!b) return []
  return [{
    type: 'swatches', label: 'Colour',
    options: [
      { value: '', color: typeDot(b.type), label: 'Type colour (default)', active: !b.color, className: 'ctx-sw-default' },
      ...SWATCH_COLORS.map(c => ({ value: c, color: c, label: SWATCH_NAMES[c] || c, active: b.color === c })),
    ],
    onPick: v => applyBlocks([id], { color: v || null }),
  }]
}

// ── Block menu ───────────────────────────────────────────────
function addConnectedItems(id) {
  const b = state.blocks[id]; if (!b) return []
  const suggested = suggestedNextTypes(b.type)
  const row = t => typeRow(t, { action: () => createConnected(id, t, { incoming: 'auto' }) })
  return tidyItems([
    suggested.length && { type: 'heading', label: 'Suggested' },
    ...suggested.map(row),
    DIV,
    ...Object.keys(TYPES).filter(t => !suggested.includes(t)).map(row),
    typeNoteItem(),
  ])
}

/**
 * How likely a block of `other`'s type is the thing `id` connects to, lower
 * first: the source type's suggested next types in their order (a Metric's
 * Goal first), then any type the pair gives a meaning to either way, then
 * the rest. Alphabetical sorting put "Add the OIDC client" ahead of the goal
 * a metric measures.
 */
export function connectRank(id, other) {
  const s = state.blocks[id]?.type, t = state.blocks[other]?.type
  const suggested = suggestedNextTypes(s)
  const i = suggested.indexOf(t)
  if (i >= 0) return i
  return impliedVerb(s, t) || impliedVerb(t, s) ? suggested.length : suggested.length + 1
}
const byTitle = (x, y) => titleOf(x).localeCompare(titleOf(y), undefined, { numeric: true, sensitivity: 'base' })

function connectTargets(id) {
  return Object.values(state.blocks)
    .filter(o => o.id !== id && !linked(id, o.id))
    .sort((x, y) => connectRank(id, x.id) - connectRank(id, y.id) || byTitle(x, y))
}

// The filter matches block titles only, never the hint beside them, and
// Enter picks only a row the filter matched (menu.js marks it): with nothing
// typed it moves into the list instead of connecting to whatever sorts first.
export function connectToItems(id) {
  const targets = connectTargets(id)
  // Suggested types and types the pair gives a meaning to rank below this.
  const rest = suggestedNextTypes(state.blocks[id]?.type).length + 1
  const likely = targets.filter(o => connectRank(id, o.id) < rest)
  const row = o => ({
    label: titleOf(o), hint: connectHint(id, o.id), dot: typeDot(o.type), dotShape: typeShape(o.type),
    action: () => {
      const plan = connectPlan(id, o.id)
      const aid = addArrow(plan.from, plan.to)
      if (aid) showToast(`Connected to "${titleOf(o)}"`, 'success', 1600)
    },
  })
  const split = likely.length && likely.length < targets.length
  return tidyItems([
    { type: 'search', placeholder: 'Find a block by title', label: 'Find a block to connect to', matchHints: false, pickOnEmpty: false },
    split && { type: 'heading', label: 'Suggested' },
    ...likely.map(row),
    split && { type: 'heading', label: 'Other blocks' },
    ...targets.slice(likely.length).map(row),
  ])
}

/**
 * The current selection's context-menu rows, for the command palette: the
 * same builders the right-click menus use, so a palette row and its menu
 * twin cannot drift. { kind, title, items }, or null when nothing is
 * selected. `kind` is 'blocks', 'block' or 'connection'.
 */
export function selectionMenuItems() {
  const ids = [...selection.ids].filter(id => state.blocks[id])
  if (ids.length > 1) return { kind: 'blocks', title: selectionTally(ids), items: multiMenuItems(ids) }
  const id = ids.length === 1 ? ids[0] : (selection.blockId && state.blocks[selection.blockId] ? selection.blockId : null)
  if (id) return { kind: 'block', title: titleOf(state.blocks[id]), items: blockMenuItems(id) }
  if (selection.arrowId && arrowById(selection.arrowId)) {
    const p = arrowPoint(selection.arrowId)
    return { kind: 'connection', title: 'Connection', items: arrowMenuItems(selection.arrowId, { clientX: p.x, clientY: p.y }) }
  }
  return null
}

// This card's connections, one row each, so a connection can be selected
// without a pointer: the lines are not Tab stops. Once one is selected, Enter
// or F2 labels it, Delete removes it and Shift+F10 opens its own menu.
function connectionRows(id) {
  return state.arrows.filter(a => (a.from === id || a.to === id) && state.blocks[a.from] && state.blocks[a.to])
}
function connectionItems(id) {
  return connectionRows(id).map(a => {
    const out = a.from === id
    const other = state.blocks[out ? a.to : a.from]
    return {
      label: `${out ? 'To' : 'From'} ${titleOf(other)}`, dot: typeDot(other.type), dotShape: typeShape(other.type),
      hint: connectionLabel(a) || undefined,
      action: () => selectConnectionFromKeyboard(a.id),
    }
  })
}
export function selectConnectionFromKeyboard(aid) {
  const a = state.arrows.find(x => x.id === aid); if (!a) return false
  selectArrow(aid)
  $.canvasViewport()?.focus({ preventScroll: true })
  const what = connectionLabel(a)
  announce(`Connection from ${titleOf(state.blocks[a.from])} to ${titleOf(state.blocks[a.to])}${what ? ', ' + what : ''}. ` +
    'Enter to label it, Delete to remove it')
  return true
}

const blankQuestion = q => !String((typeof q === 'string' ? q : q?.text) || '').trim() && !String(q?.answer || '').trim()

function addQuestion(id) {
  const b = state.blocks[id]; if (!b) return
  const qs = b.questions || []
  // A blank question already waiting at the end is the one to type into.
  // Stacking another prints one more bare bullet in the prompt, and is an
  // undo step that changes nothing anyone can see.
  let index = qs.length - 1
  if (!qs.length || !blankQuestion(qs[index])) {
    mutateBlock(id, { questions: [...qs, { text: '' }] }, { undo: true })
    index = qs.length
  }
  focusQuestion(id, index)
}

function blockMenuItems(id) {
  const b = state.blocks[id]; if (!b) return []
  // The same camera move as Shift+2 with this block selected.
  const zoom = { ctx: 'zoom', label: 'Zoom to block', icon: I.zoom, shortcut: 'Shift+2', action: () => zoomToBlocks([id]) }
  if (ui.readOnly) return [zoom]
  const hasIn = hasStep(id, 'up'), hasOut = hasStep(id, 'down')
  const sameType = Object.values(state.blocks).filter(o => o.type === b.type).length
  return tidyItems([
    { ctx: 'edit-title', label: 'Edit title', icon: I.edit, shortcut: 'Enter', action: () => startInlineEdit(id, 'title') },
    // Caret at the end: selecting a whole paragraph invites typing over it.
    !b.collapsed && { ctx: 'edit-desc', label: 'Edit description', icon: I.desc, shortcut: 'Shift+Enter',
      action: () => startInlineEdit(id, 'description', { selectAll: false }) },
    { ctx: 'add-connected', label: 'Add connected', icon: I.add, submenu: () => addConnectedItems(id) },
    connectTargets(id).length && { ctx: 'connect', label: 'Connect to…', icon: I.connect, submenu: () => connectToItems(id) },
    connectionRows(id).length && { ctx: 'connections', label: 'Select connection', icon: I.route, submenu: () => connectionItems(id) },
    { ctx: 'type', label: 'Change type', icon: I.type, submenu: () => changeTypeItems([id]) },
    { ctx: 'status', label: 'Status', icon: I.status, submenu: () => statusItems([id]) },
    { ctx: 'priority', label: 'Priority', icon: I.priority, submenu: () => priorityItems([id]) },
    { ctx: 'highlight', label: 'Highlight', icon: I.highlight, submenu: () => highlightItems([id]) },
    { ctx: 'colour', label: 'Colour', icon: I.colour, submenu: () => colourItems(id) },
    DIV,
    hasIn && { ctx: 'upstream', label: 'Select upstream', icon: I.up,
      action: () => selectAndSay(reach(id, 'up'), 'upstream') },
    hasOut && { ctx: 'downstream', label: 'Select downstream', icon: I.down,
      action: () => selectAndSay(reach(id, 'down'), 'downstream') },
    sameType > 1 && { ctx: 'same-type', label: `Select all ${sameType} ${typeNoun(b.type, sameType)}`, icon: I.sameType,
      action: () => setSelection(Object.values(state.blocks).filter(o => o.type === b.type).map(o => o.id)) },
    zoom,
    DIV,
    { ctx: 'duplicate', label: 'Duplicate', icon: I.duplicate, shortcut: MOD + 'D',
      action: () => { const n = duplicateBlock(id); if (n) selectBlock(n) } },
    { ctx: 'collapse', label: b.collapsed ? 'Expand' : 'Collapse', icon: b.collapsed ? I.expand : I.collapse,
      action: () => applyBlocks([id], { collapsed: !b.collapsed }) },
    { ctx: 'question', label: 'Add question', icon: I.question, action: () => addQuestion(id) },
    DIV,
    { ctx: 'delete', label: 'Delete', icon: I.trash, shortcut: 'Del', danger: true,
      action: () => { deleteBlock(id); keepFocus() } },
  ])
}

export function openBlockMenu(id, clientX, clientY) {
  if (!state.blocks[id]) return null
  if (!(selection.ids.size === 1 && selection.blockId === id)) selectBlock(id)
  return openCtxMenu(blockMenuItems(id), {
    x: clientX, y: clientY, className: 'ctx-block-menu',
    label: `Actions for ${titleOf(state.blocks[id])}`,
    returnFocus: getBlockEl(id),
  })
}

// ── Multi-selection menu ─────────────────────────────────────
const ALIGN_ROWS = [
  ['left', 'Left edges'], ['hcenter', 'Centres'], ['right', 'Right edges'], null,
  ['top', 'Top edges'], ['vcenter', 'Middles'], ['bottom', 'Bottom edges'],
]

function duplicateAll(ids) {
  const live = ids.filter(id => state.blocks[id])
  if (!live.length) return []
  snapshot()
  const copyOf = new Map()
  live.forEach(id => {
    const b = state.blocks[id], nid = genId()
    // Copies leave the source's frame: a frame is a deliberate grouping,
    // and its copy would silently stretch it over the new blocks.
    state.blocks[nid] = { ...JSON.parse(JSON.stringify(b)), id: nid, x: b.x + 32, y: b.y + 32, groupId: null }
    copyOf.set(id, nid)
  })
  // Connections inside the selection come along, so a copied flow is still a flow.
  state.arrows.filter(a => copyOf.has(a.from) && copyOf.has(a.to)).forEach(a => {
    state.arrows.push({ ...JSON.parse(JSON.stringify(a)), id: genId(), from: copyOf.get(a.from), to: copyOf.get(a.to) })
  })
  const fresh = [...copyOf.values()]
  mutateBlocks(fresh, {}, { undo: false })
  updateHint()
  setSelection(fresh)
  showToast(`Duplicated ${fresh.length} blocks`, 'success', 1400)
  return fresh
}

function multiMenuItems(ids) {
  const n = ids.length
  const zoom = { ctx: 'zoom-selection', label: 'Zoom to selection', icon: I.zoom, shortcut: 'Shift+2', action: () => zoomToBlocks(ids) }
  if (ui.readOnly) return [zoom]
  const groups = new Set(ids.map(id => state.blocks[id]?.groupId || null))
  const oneGroup = groups.size === 1 && !groups.has(null)
  return tidyItems([
    { type: 'heading', label: selectionTally(ids) },
    { ctx: 'type', label: 'Change type', icon: I.type, submenu: () => changeTypeItems(ids) },
    { ctx: 'status', label: 'Status', icon: I.status, submenu: () => statusItems(ids) },
    { ctx: 'highlight', label: 'Highlight', icon: I.highlight, submenu: () => highlightItems(ids) },
    n >= 2 && { ctx: 'align', label: 'Align', icon: I.align, submenu: () => tidyItems(ALIGN_ROWS.map(r => r ? {
      label: r[1], action: () => arrangeSelection('align', ids, r[0]),
    } : DIV)) },
    n >= 3 && { ctx: 'distribute', label: 'Distribute', icon: I.distribute, submenu: () => [
      { label: 'Horizontally', hint: 'Even gaps left to right',
        action: () => arrangeSelection('distribute', ids, 'h') },
      { label: 'Vertically', hint: 'Even gaps top to bottom',
        action: () => arrangeSelection('distribute', ids, 'v') },
    ] },
    !oneGroup && { ctx: 'group', label: 'Group into frame', icon: I.group, action: () => {
      if (createGroup(ids)) showToast(`Grouped ${n} blocks. Name the frame in the inspector`, 'success', 2000)
    } },
    zoom,
    DIV,
    { ctx: 'duplicate', label: 'Duplicate all', icon: I.duplicate, action: () => duplicateAll(ids) },
    DIV,
    { ctx: 'delete', label: `Delete ${n} blocks`, icon: I.trash, shortcut: 'Del', danger: true,
      action: () => { deleteBlocksBatch(ids); keepFocus() } },
  ])
}

/** The menu for a selection of several blocks. Never changes the selection. */
export function openMultiMenu(ids, clientX, clientY, { anchorId = null } = {}) {
  const live = ids.filter(id => state.blocks[id])
  if (live.length < 2) return live.length ? openBlockMenu(live[0], clientX, clientY) : null
  return openCtxMenu(multiMenuItems(live), {
    x: clientX, y: clientY, className: 'ctx-multi-menu', label: `Actions for ${live.length} selected blocks`,
    // With no card on screen to go back to, the canvas itself.
    returnFocus: (anchorId && getBlockEl(anchorId)) || $.canvasViewport(),
  })
}

// ── Arrow menu ───────────────────────────────────────────────
const ROUTE_LABELS = { routed: 'Routed', curved: 'Curved', straight: 'Straight', elbow: 'Elbow' }
const PATTERN_LABELS = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' }
const WEIGHTS = [[1, 'Thin'], [1.5, 'Normal'], [2.5, 'Thick'], [3.5, 'Bold']]

// The weight the line is drawn at. Saved arrows with no weight drew at 2.
function drawnWeight(a) {
  const w = Number(a.weight)
  return Number.isFinite(w) && w > 0 ? w : 2
}

// A row is checked only when it is the line's real weight. Older weights
// (2, 5) get a row of their own, as in the inspector, rather than a check on
// a neighbour that picking would then change.
function weightItems(aid, a) {
  const cur = drawnWeight(a)
  const rows = WEIGHTS.map(([w, label]) => ({
    label, radio: true, checked: cur === w, action: () => applyArrow(aid, { weight: w }),
  }))
  if (!WEIGHTS.some(([w]) => w === cur)) {
    rows.push(DIV, { ctx: 'weight-current', label: `${cur}px`, hint: 'Current weight', radio: true, checked: true, action: () => {} })
  }
  return rows
}

function arrowMenuItems(aid, pt) {
  const a = arrowById(aid); if (!a) return []
  const from = state.blocks[a.from], to = state.blocks[a.to]
  const goTo = [
    from && { ctx: 'source', label: 'Go to source', hint: titleOf(from), icon: I.source, action: () => focusBlock(a.from) },
    to && { ctx: 'target', label: 'Go to target', hint: titleOf(to), icon: I.target, action: () => focusBlock(a.to) },
  ]
  if (ui.readOnly) return tidyItems(goTo)
  const route = arrowRoute(a), pattern = arrowPattern(a)
  return tidyItems([
    { ctx: 'edit-label', label: 'Edit label', icon: I.label, shortcut: 'Enter', action: () => startArrowLabelEdit(aid, pt) },
    { ctx: 'meaning', label: 'Meaning', icon: I.meaning, submenu: () => [
      { label: 'Auto (label or types)', hint: `Reads as: ${RELATIONS[relationOf({ ...a, relation: null }, state.blocks)].toLowerCase()}`,
        radio: true, checked: !a.relation, action: () => applyArrow(aid, { relation: null }) },
      DIV,
      ...Object.entries(RELATIONS).map(([k, label]) => ({
        label, radio: true, checked: a.relation === k, action: () => applyArrow(aid, { relation: k }),
      })),
    ] },
    { ctx: 'route', label: 'Route', icon: I.route, submenu: () => ARROW_ROUTES.map(k => ({
      label: ROUTE_LABELS[k] || k, radio: true, checked: route === k,
      // A legacy style of 'dashed' is a pattern too; keep it when the route changes.
      action: () => applyArrow(aid, { style: k, ...(a.style !== route && !a.pattern ? { pattern } : {}) }),
    })) },
    { ctx: 'pattern', label: 'Pattern', icon: I.pattern, submenu: () => Object.entries(PATTERN_LABELS).map(([k, label]) => ({
      label, radio: true, checked: pattern === k,
      action: () => applyArrow(aid, { pattern: k, ...(a.style !== route ? { style: route } : {}) }),
    })) },
    { ctx: 'reverse', label: 'Reverse direction', icon: I.reverse, action: () => {
      // Reversing onto a connection that already runs the other way would
      // leave two identical arrows.
      if (state.arrows.some(x => x.id !== aid && x.from === a.to && x.to === a.from)) {
        showToast('A connection already runs the other way. Turn on Two-way instead', 'info', 2400)
        return
      }
      // Pins swap with their ends and keep their provenance: reversing is
      // not the user choosing a side.
      const changes = { from: a.to, to: a.from, fromPort: a.toPort ?? null, toPort: a.fromPort ?? null }
      if (a.portsBy) changes.portsBy = a.portsBy
      mutateArrow(aid, changes)
    } },
    { ctx: 'two-way', label: 'Two-way', icon: I.twoWay, checked: !!a.bidirectional,
      action: () => applyArrow(aid, { bidirectional: !a.bidirectional }) },
    { ctx: 'colour', label: 'Colour', icon: I.colour, submenu: () => [{
      type: 'swatches', label: 'Connection colour',
      options: [
        { value: '', label: 'Default colour', className: 'ctx-sw-edge', active: !a.color },
        ...SWATCH_COLORS.map(c => ({ value: c, color: c, label: SWATCH_NAMES[c] || c, active: a.color === c })),
      ],
      onPick: v => applyArrow(aid, { color: v || null }),
    }] },
    { ctx: 'weight', label: 'Weight', icon: I.weight, submenu: () => weightItems(aid, a) },
    from && to && { ctx: 'insert', label: 'Insert block', icon: I.insert, submenu: () => [
      ...groupedTypeRows(t => typeRow(t, { action: () => insertOnArrow(aid, t) })),
      typeNoteItem(),
    ] },
    (a.fromPort || a.toPort) && { ctx: 'reset-ends', label: 'Reset ends to auto', icon: I.reset,
      action: () => applyArrow(aid, { fromPort: null, toPort: null }) },
    DIV,
    ...goTo,
    DIV,
    { ctx: 'delete', label: 'Delete', icon: I.trash, shortcut: 'Del', danger: true,
      action: () => { deleteArrow(aid); keepFocus() } },
  ])
}

export function openArrowMenu(aid, clientX, clientY) {
  if (!arrowById(aid)) return null
  if (selection.arrowId !== aid) selectArrow(aid)
  const items = arrowMenuItems(aid, { clientX, clientY })
  if (!items.length) return null
  return openCtxMenu(items, { x: clientX, y: clientY, className: 'ctx-arrow-menu', label: 'Connection actions' })
}

// ── Canvas menus ─────────────────────────────────────────────
async function pasteAsBlocks(w) {
  const hint = () => showToast(`Clipboard access is blocked here. Click the canvas and press ${MOD}V instead`, 'info', 3200)
  if (!navigator.clipboard?.readText) { hint(); return }
  let text
  try { text = await navigator.clipboard.readText() } catch (_) { hint(); return }
  if (!text || !text.trim()) { showToast('The clipboard has no text to turn into blocks', 'info', 2200); return }
  if (ui.readOnly) return
  // The dump starts at the pointer, or the nearest free space from it.
  createBlocksFromText(text, true, { at: w })
}

function canvasMenuItems(clientX, clientY) {
  const nav = [
    { ctx: 'fit', label: 'Fit', icon: I.fit, shortcut: 'Shift+1', action: () => fitView() },
    { ctx: 'actual-size', label: 'Zoom to 100%', icon: I.actual, shortcut: 'Shift+0', action: () => zoomTo(1) },
  ]
  if (ui.readOnly) return nav
  const w = worldAt(clientX, clientY)
  const row = t => typeRow(t, { ctx: 'add', addType: t, action: () => createBlockAt(t, w.x, w.y) })
  const core = Object.keys(TYPES).filter(t => TYPES[t].tier === 'core')
  const more = Object.keys(TYPES).filter(t => TYPES[t].tier !== 'core')
  const n = Object.keys(state.blocks).length
  return tidyItems([
    { type: 'heading', label: 'Add here' },
    ...core.map(row),
    more.length && { ctx: 'more-types', label: 'More types', icon: I.type, submenu: () => [...more.map(row), typeNoteItem()] },
    DIV,
    { ctx: 'paste', label: 'Paste as blocks', icon: I.paste, shortcut: MOD + 'V', action: () => { pasteAsBlocks(w) } },
    n > 0 && { ctx: 'select-all', label: 'Select all', icon: I.selectAll, shortcut: MOD + 'A',
      action: () => setSelection(Object.keys(state.blocks)) },
    n > 1 && { ctx: 'tidy', label: 'Tidy', icon: I.tidy, shortcut: 'L', action: () => runTidy() },
    DIV,
    ...nav,
  ])
}

export function openCanvasMenu(clientX, clientY) {
  return openCtxMenu(canvasMenuItems(clientX, clientY), {
    x: clientX, y: clientY, className: 'ctx-canvas-menu', label: 'Canvas actions',
  })
}

/**
 * The quick-add picker, the canvas menu's add section on its own: the
 * suggested types (when given), the core types and More types, under a
 * filter box that searches all of them, by name or by meaning. Double-
 * clicking empty canvas opens it, and so does a connection dropped on empty
 * canvas (navigation.js openQuickCreate). By default the block lands centred
 * on the pointer, with the camera held so it stays under the pointer, and
 * opens in title editing. Optional `opts`:
 *   suggested: type ids listed first under "Suggested"
 *   title: heading text (default "Add block here")
 *   onPick(type, worldPoint): replaces the default createBlockAt
 *   onCancel(): the menu closed without a pick
 *   onClose(): the menu closed, picked or not
 *   returnFocus, className: passed to the menu
 */
export function openCanvasAddMenu(clientX, clientY, opts = {}) {
  if (ui.readOnly) return null
  // World point now, before focus moves into the menu.
  const w = worldAt(clientX, clientY)
  let picked = false
  const pick = t => {
    picked = true
    if (typeof opts.onPick === 'function') opts.onPick(t, w)
    else withCameraHeld(() => createBlockAt(t, w.x, w.y))
  }
  const suggested = [...new Set((opts.suggested || []).filter(t => Object.hasOwn(TYPES, t)))]
  const rest = Object.keys(TYPES).filter(t => !suggested.includes(t))
  const core = rest.filter(t => TYPES[t].tier === 'core')
  const more = rest.filter(t => TYPES[t].tier !== 'core')
  const row = (t, extra) => typeRow(t, { ctx: 'add', addType: t, action: () => pick(t), ...extra })
  const items = tidyItems([
    { type: 'heading', label: opts.title || 'Add block here' },
    { type: 'search', placeholder: 'Filter types', label: 'Filter block types' },
    suggested.length && { type: 'heading', label: 'Suggested' },
    ...suggested.map(t => row(t)),
    suggested.length && DIV,
    ...core.map(t => row(t)),
    more.length && { ctx: 'more-types', label: 'More types', icon: I.type,
      submenu: () => [...more.map(t => row(t)), typeNoteItem()] },
    // The More types rows again, hidden until something is typed, so the
    // filter (which searches only this menu) still reaches every type.
    ...more.map(t => row(t, { filterOnly: true })),
    typeNoteItem(),
  ])
  const m = openCtxMenu(items, {
    x: clientX, y: clientY, className: ('ctx-add-menu ' + (opts.className || '')).trim(), label: opts.label || 'Add a block here',
    ...(opts.returnFocus ? { returnFocus: opts.returnFocus } : {}),
    // menu.js closes before it runs the chosen action, so decide "cancelled"
    // once that action has had its turn. onClose runs at once, like menu.js's.
    onClose: () => { opts.onClose?.(); queueMicrotask(() => { if (!picked) opts.onCancel?.() }) },
  })
  const filterOnly = items.map((it, i) => it.filterOnly && m.el.children[i]).filter(Boolean)
  const input = m.el.querySelector('.pf-menu-search-input')
  // menu.js's own filter runs first and shows every row when the box is
  // empty; put the filter-only rows away again.
  const sync = () => { if (!input.value.trim()) filterOnly.forEach(r => { r.hidden = true }) }
  sync()
  input.addEventListener('input', sync)
  return m
}

// ── Wiring ───────────────────────────────────────────────────
// Some platforms follow the ContextMenu key with their own contextmenu event;
// it must not replace the menu the key already opened.
let keyOpenedAt = -Infinity

function openForBlock(id, x, y) {
  if (selection.ids.size > 1 && selection.ids.has(id)) return openMultiMenu([...selection.ids], x, y, { anchorId: id })
  return openBlockMenu(id, x, y)
}

function blockPoint(id) {
  const r = getBlockEl(id)?.getBoundingClientRect()
  return r && (r.width || r.height) ? { x: r.left + 12, y: r.top + 12 } : viewportCentre()
}

// A keyboard-opened menu anchors on a card. A card the camera has left is
// brought back first (a pan, never a zoom), so the menu opens beside it and
// what the menu does to it happens where it can be seen.
function keyPoint(id) {
  if (!onScreen(id)) revealBlock(id)
  return blockPoint(id)
}

function viewportCentre() {
  const r = $.canvasViewport().getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

function inViewport(p) {
  const v = $.canvasViewport().getBoundingClientRect()
  return p.x >= v.left && p.x <= v.right && p.y >= v.top && p.y <= v.bottom
}

function arrowPoint(aid) {
  const el = $.arrowsGroup()?.querySelector(`[data-aid="${CSS.escape(aid)}"] .arrow-path`)
  const r = el?.getBoundingClientRect()
  const p = r && (r.width || r.height) ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
  return p && inViewport(p) ? p : viewportCentre()
}

let contextMenuWired = false
export function setupContextMenu() {
  if (contextMenuWired) return
  contextMenuWired = true
  const canvasViewport = $.canvasViewport()

  canvasViewport.addEventListener('contextmenu', e => {
    const t = e.target
    if (!(t instanceof Element)) return
    // Overlays (review bar, search, chips) and text being edited keep the
    // browser's own menu: spelling, paste, copy.
    if (t.closest('[data-canvas-ui]') || t.closest('[contenteditable="true"]')) return
    e.preventDefault()
    // macOS Ctrl+click is a primary-button press, so the canvas already
    // started a press for it. Its release would then collapse a
    // multi-selection to one block (or pan), under the menu that just
    // opened. The press became a menu request; drop it.
    if (pointer.ix && !pointer.ix.captured) {
      pointer.ix = null
      canvasViewport.style.cursor = 'default'
    }
    if (isMenuOpen() && performance.now() - keyOpenedAt < 800) return
    const block = t.closest('.block')
    if (block && state.blocks[block.dataset.id]) { openForBlock(block.dataset.id, e.clientX, e.clientY); return }
    const arrow = t.closest('[data-aid]')
    if (arrow && arrowById(arrow.dataset.aid)) { openArrowMenu(arrow.dataset.aid, e.clientX, e.clientY); return }
    openCanvasMenu(e.clientX, e.clientY)
  })

  // Shift+F10 and the ContextMenu key: the menu for the focused block, else
  // the selection, else the selected connection, else the canvas.
  document.addEventListener('keydown', e => {
    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
    if (e.defaultPrevented || isMenuOpen()) return
    const ae = document.activeElement
    if (ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable)) return
    const fromCanvas = !ae || ae === document.body ||
      (canvasViewport.contains(ae) && !ae.closest('[data-canvas-ui]'))
    if (!fromCanvas) return
    e.preventDefault()
    keyOpenedAt = performance.now()
    const focused = ae?.closest?.('.block')?.dataset.id
    if (focused && state.blocks[focused]) { const p = keyPoint(focused); openForBlock(focused, p.x, p.y); return }
    if (selection.ids.size > 1) {
      const ids = [...selection.ids]
      // The menu acts on the whole selection, so the camera stays put: it
      // anchors on a selected card that is on screen, else the canvas centre.
      const anchor = ids.find(onScreen)
      const p = anchor ? blockPoint(anchor) : viewportCentre()
      openMultiMenu(ids, p.x, p.y, { anchorId: anchor || null })
      return
    }
    if (selection.blockId && state.blocks[selection.blockId]) {
      const p = keyPoint(selection.blockId); openBlockMenu(selection.blockId, p.x, p.y); return
    }
    if (selection.arrowId && arrowById(selection.arrowId)) {
      const p = arrowPoint(selection.arrowId); openArrowMenu(selection.arrowId, p.x, p.y); return
    }
    const p = viewportCentre()
    openCanvasMenu(p.x, p.y)
  })
}
