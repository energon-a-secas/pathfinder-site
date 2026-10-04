// ════════════════════════════════════════════════════════════
//  create.js: every "make a block here" path in one place.
//
//  The palette, the canvas add menu, quick-create from a port,
//  the keyboard and the gap fixes all create through these, so
//  each creation is one undo step and lands in title editing.
//  Every one lands in a free slot (nearestFreeSpot), CARD_GAP
//  clear of every card; the brain dump and a patch's new blocks
//  use the same helpers (occupiedRects, placeNewBlocks).
// ════════════════════════════════════════════════════════════

import { state, ui, snapshot } from './state.js'
import { TYPES, DEFAULT_WIDTH, genId, getBlockDims, showToast } from './utils.js'
import { renderArrows, resolveRoutes, arrowMidpoint } from './canvas.js'
import { renderBlock, selectBlock, createBlock, addArrow, mutateBlock } from './render.js'
import { startInlineEdit } from './inline-edit.js'
import { impliedVerb } from './relations.js'
import { CARD_GAP } from './layout.js'

const GAP = 80        // distance from the source block's side
const STEP = 24       // how far to slide along the side when that spot is taken
const MAX_STEPS = 200

/**
 * What usually comes next from a block of this type, best first. Drives
 * "Add connected" menus and keyboard quick-create. Filtered to the types
 * that exist, so it is safe on a registry that has not grown yet.
 */
const NEXT_TYPES = {
  goal:           ['metric', 'requirement', 'implementation', 'problem', 'stakeholder'],
  problem:        ['decision', 'implementation', 'question', 'risk'],
  stakeholder:    ['goal', 'output', 'requirement'],
  metric:         ['goal', 'implementation', 'requirement'],
  requirement:    ['implementation', 'output', 'metric', 'decision'],
  output:         ['stakeholder', 'metric', 'process'],
  implementation: ['output', 'requirement', 'metric', 'risk'],
  process:        ['process', 'terminator', 'decision', 'output'],
  terminator:     ['process', 'implementation', 'output'],
  decision:       ['implementation', 'requirement', 'risk'],
  resource:       ['implementation', 'process', 'metric'],
  assumption:     ['question', 'decision', 'risk'],
  risk:           ['decision', 'implementation', 'question'],
  question:       ['assumption', 'decision', 'implementation'],
  context:        ['problem', 'goal', 'stakeholder'],
  custom:         ['goal', 'requirement', 'implementation', 'decision'],
}

export function suggestedNextTypes(type) {
  return (NEXT_TYPES[type] || []).filter(t => Object.hasOwn(TYPES, t))
}

/**
 * Which way a new connection between these two types should point. 'in'
 * when only the reverse pair implies a verb: adding a Metric from a Goal
 * makes metric -> goal ("measures"), not goal -> metric.
 */
export function defaultConnectDirection(fromType, toType) {
  return impliedVerb(toType, fromType) && !impliedVerb(fromType, toType) ? 'in' : 'out'
}

/**
 * A block's rendered size when the card is laid out, a sensible estimate
 * when it is not (a hidden viewport measures 0x0). Placement, navigation
 * and the camera all measure through this.
 */
export function blockSize(id) {
  const d = getBlockDims(id)
  const b = state.blocks[id]
  return { w: d.w || b?.width || DEFAULT_WIDTH, h: d.h || 100 }
}

// ── Free slots ───────────────────────────────────────────────
//
// Creation never lands on a card. Every path that makes a block (a palette
// click or drop, the quick-add picker, quick create, splitting a line, the
// brain dump, a patch's new findings) asks for the nearest spot that keeps
// CARD_GAP clear of every card, so a line between two of them always has
// room to show.

/** The rectangles the blocks occupy (rendered size, else the estimate), leaving out `skip`. */
export function occupiedRects(skip = []) {
  const left = new Set(skip)
  return Object.values(state.blocks).filter(b => !left.has(b.id)).map(b => {
    const { w, h } = blockSize(b.id)
    return { x: b.x, y: b.y, w, h }
  })
}

function isClear(x, y, w, h, rects, gap) {
  for (const r of rects) {
    if (x < r.x + r.w + gap && x + w + gap > r.x && y < r.y + r.h + gap && y + h + gap > r.y) return false
  }
  return true
}

// Grid offsets around a point, nearest first, built once. Equal distances
// prefer below, then right, then left, then above: the next item of a list
// reads under the last one.
const SEARCH_RINGS = 60
let searchOrder = null
function offsetsNearestFirst() {
  if (searchOrder) return searchOrder
  const out = []
  for (let i = -SEARCH_RINGS; i <= SEARCH_RINGS; i++) {
    for (let j = -SEARCH_RINGS; j <= SEARCH_RINGS; j++) if (i || j) out.push([i, j, i * i + j * j])
  }
  out.sort((a, b) => a[2] - b[2] || b[1] - a[1] || b[0] - a[0])
  searchOrder = out
  return out
}

/**
 * The top-left nearest to (x, y) where a w by h box overlaps none of `rects`
 * and keeps `gap` clear of each. (x, y) itself when it is free. Searches a
 * grid of `step` pixels out to 60 steps; past that, the box goes right of
 * everything, level with the request. Pure; whole pixels out.
 */
export function nearestFreeSpot(x, y, w, h, rects, { gap = CARD_GAP, step = 20 } = {}) {
  const fx = Math.round(x), fy = Math.round(y)
  if (!rects.length || isClear(fx, fy, w, h, rects, gap)) return { x: fx, y: fy }
  // Only cards inside the search window can block a candidate.
  const reach = SEARCH_RINGS * step + gap
  const near = rects.filter(r => r.x < fx + w + reach && r.x + r.w > fx - reach && r.y < fy + h + reach && r.y + r.h > fy - reach)
  for (const [i, j] of offsetsNearestFirst()) {
    const px = fx + i * step, py = fy + j * step
    if (isClear(px, py, w, h, near, gap)) return { x: px, y: py }
  }
  return { x: Math.round(Math.max(...rects.map(r => r.x + r.w)) + gap * 2), y: fy }
}

/**
 * Move block `id` to the nearest free slot from where it is now (no undo
 * step, no render: the caller owns both). Returns true when it moved.
 */
export function placeFree(id, opts) {
  const b = state.blocks[id]
  if (!b) return false
  const { w, h } = blockSize(id)
  const p = nearestFreeSpot(b.x, b.y, w, h, occupiedRects([id]), opts)
  if (p.x === b.x && p.y === b.y) return false
  b.x = p.x; b.y = p.y
  return true
}

/**
 * Where blocks that are not on the canvas yet should land (a patch's new
 * findings): beside a block each one connects to, to its right when that
 * block points at the new one and to its left when the new one points at
 * it, else in a column right of the map; always the nearest slot that keeps
 * CARD_GAP from every card, the ones placed here included. An anchor may be
 * another new block: those wait until it is placed, so a chain of findings
 * grows out from the map instead of starting over at its edge.
 *
 * An item may bring one coordinate of its own (`fixed: { x }` or `{ y }`):
 * the search starts from it.
 *
 * @param {Array<{key, w?, h?, fixed?: {x?, y?}, anchors?: Array<{id, side: 'left'|'right'}>}>} items
 * @param {{occupied?: Array<{x,y,w,h}>, known?: Map<string,{x,y,w,h}>, gap?: number}} [opts]
 *   `occupied` defaults to every block on the canvas; `known` holds blocks
 *   that are not on the canvas yet but have a place (a patch's new blocks
 *   with coordinates), so an item can anchor on them
 * @returns {Map<string,{x,y}>} top-left per key, whole pixels
 */
export function placeNewBlocks(items, { occupied = occupiedRects(), known = new Map(), gap = CARD_GAP } = {}) {
  const rects = occupied.slice()
  const placed = new Map()
  const rectOf = id => {
    if (placed.has(id)) return placed.get(id)
    if (known.has(id)) return known.get(id)
    const b = state.blocks[id]
    return b ? { x: b.x, y: b.y, ...blockSize(id) } : null
  }
  const right = rects.length ? Math.max(...rects.map(r => r.x + r.w)) : 0
  const top = rects.length ? Math.min(...rects.map(r => r.y)) : 0
  const anchorOf = it => (it.anchors || []).find(a => a && rectOf(a.id)) || null
  const waiting = items.slice()
  while (waiting.length) {
    // Next: the first item with nothing to wait for (no anchor, or one that
    // is placed); when every one left waits on another, the first of them.
    let i = waiting.findIndex(it => !(it.anchors || []).length || anchorOf(it))
    if (i < 0) i = 0
    const it = waiting.splice(i, 1)[0]
    const w = it.w || DEFAULT_WIDTH, h = it.h || 100
    const anchor = anchorOf(it)
    const a = anchor ? rectOf(anchor.id) : null
    const want = { ...(!a ? { x: right + GAP + gap, y: top }
      : anchor.side === 'left' ? { x: a.x - GAP - w, y: a.y }
      : { x: a.x + a.w + GAP, y: a.y }) }
    if (Number.isFinite(it.fixed?.x)) want.x = it.fixed.x
    if (Number.isFinite(it.fixed?.y)) want.y = it.fixed.y
    const p = nearestFreeSpot(want.x, want.y, w, h, rects, { gap })
    const r = { x: p.x, y: p.y, w, h }
    rects.push(r)
    placed.set(it.key, r)
  }
  return new Map([...placed].map(([k, r]) => [k, { x: r.x, y: r.y }]))
}

function finishCreate(id, { edit, select }) {
  if (select || edit) selectBlock(id)
  if (edit) startInlineEdit(id, 'title', { selectAll: true })
  return id
}

/**
 * Create a block centred on world point (wx, wy), or in the nearest free
 * slot when a card is in the way. One undo step. Selects it and starts
 * title editing unless told not to.
 */
export function createBlockAt(type, wx, wy, { edit = true, select = true } = {}) {
  if (ui.readOnly || !Object.hasOwn(TYPES, type)) return null
  const id = createBlock(type, wx, wy)
  // Select before measuring: a selected card can be taller (its empty
  // description shows a hint), and measuring the unselected card centred
  // the new one about 12px below the pointer.
  if (select || edit) selectBlock(id)
  const b = state.blocks[id]
  const { w, h } = blockSize(id)
  b.x = Math.round(wx - w / 2)
  b.y = Math.round(wy - h / 2)
  placeFree(id)
  renderBlock(id)
  renderArrows()
  if (edit) startInlineEdit(id, 'title', { selectAll: true })
  return id
}

/**
 * Create a block beside `fromId` and connect them. The new block sits 80px
 * beyond the chosen side and slides 24px along that side until it keeps
 * CARD_GAP clear of every card, so repeated calls stack instead of piling
 * up (and, past the slide's reach, takes the nearest free slot). One undo step.
 * The arrow runs from -> new unless `incoming` is true (new -> from).
 * `incoming: 'auto'` picks the way the implied verb reads
 * (defaultConnectDirection): a Metric added from a Goal points at the Goal.
 */
export function createConnected(fromId, type, { dir = 'right', incoming = false, edit = true, select = true, relation = null } = {}) {
  const src = state.blocks[fromId]
  if (ui.readOnly || !src || !Object.hasOwn(TYPES, type)) return null
  if (incoming === 'auto') incoming = defaultConnectDirection(src.type, type) === 'in'
  incoming = incoming === true

  snapshot()
  const id = createBlock(type, src.x, src.y, { undo: false })
  const b = state.blocks[id]
  const s = blockSize(fromId)
  const n = blockSize(id)
  let x, y
  if (dir === 'left')      { x = src.x - GAP - n.w;  y = src.y }
  else if (dir === 'up')   { x = src.x;              y = src.y - GAP - n.h }
  else if (dir === 'down') { x = src.x;              y = src.y + s.h + GAP }
  else                     { x = src.x + s.w + GAP;  y = src.y }
  // Slide along the side the block grew from: down a right/left side,
  // rightwards along a top/bottom one.
  const slideY = dir !== 'up' && dir !== 'down'
  const x0 = x, y0 = y
  const rects = occupiedRects([id])
  let i = 0
  for (; i < MAX_STEPS && !isClear(x, y, n.w, n.h, rects, CARD_GAP); i++) {
    if (slideY) y += STEP; else x += STEP
  }
  // A side crowded past the slide's reach: the nearest free slot instead.
  if (i === MAX_STEPS) { x = x0; y = y0 }
  b.x = Math.round(x); b.y = Math.round(y)
  placeFree(id)
  renderBlock(id)
  if (incoming) addArrow(id, fromId, null, null, { undo: false, relation })
  else addArrow(fromId, id, null, null, { undo: false, relation })
  renderArrows({ cheap: false })
  return finishCreate(id, { edit, select })
}

/**
 * Split A -> B into A -> new -> B at the connection's midpoint. The relation,
 * route and look carry to both halves; the label and note stay on the first.
 * One undo step.
 */
export function insertOnArrow(aid, type, { edit = true } = {}) {
  const a = state.arrows.find(x => x.id === aid)
  if (ui.readOnly || !a || !Object.hasOwn(TYPES, type)) return null
  if (!state.blocks[a.from] || !state.blocks[a.to]) return null
  let mid = null
  try {
    const pts = resolveRoutes({ cheap: true }).get(aid)
    if (pts) mid = arrowMidpoint(pts, a.style === 'routed' ? 'straight' : (a.style || 'curved'))
  } catch (_) {}
  if (!mid) {
    const f = state.blocks[a.from], t = state.blocks[a.to]
    const fd = blockSize(a.from), td = blockSize(a.to)
    mid = { x: (f.x + fd.w / 2 + t.x + td.w / 2) / 2, y: (f.y + fd.h / 2 + t.y + td.h / 2) / 2 }
  }

  snapshot()
  const id = createBlock(type, mid.x, mid.y, { undo: false })
  const nb = state.blocks[id]
  const { w, h } = blockSize(id)
  nb.x = Math.round(mid.x - w / 2); nb.y = Math.round(mid.y - h / 2)
  // Two close cards leave no room at the midpoint: never land on either.
  placeFree(id)
  const second = { ...JSON.parse(JSON.stringify(a)), id: genId(), from: id, fromPort: null, label: '', note: '' }
  if (!second.note) delete second.note
  a.to = id
  a.toPort = null
  state.arrows.push(second)
  renderBlock(id)
  // mutateBlock without undo does the shared bookkeeping (arrows, frames,
  // gaps, save, prompt) once for the whole split.
  mutateBlock(id, {})
  renderArrows({ cheap: false })
  return finishCreate(id, { edit, select: true })
}

// Legacy fix ids from gaps.js, expressed as the generic create shape.
const LEGACY_CREATE = {
  'add-goal':     { type: 'goal', dir: 'out', done: 'Goal created and linked' },
  'add-req':      { type: 'requirement', dir: 'in', done: 'Requirement created and linked' },
  'add-decision': { type: 'decision', dir: 'out', done: 'Decision created and linked' },
  'mitigate':     { type: 'decision', dir: 'out', done: 'Decision created and linked' },
}

/**
 * Apply one Suggestions fix to a block. `fix` is a fix object from
 * getGapFixes (or just its id). `fix.create = { type, dir }` creates and
 * links a block: dir 'out' draws block -> new, 'in' draws new -> block.
 */
export function applyGapFix(fix, blockId) {
  const b = state.blocks[blockId]
  if (!b || ui.readOnly) return null
  const f = typeof fix === 'string' ? { id: fix } : (fix || {})
  const create = f.create || (LEGACY_CREATE[f.id] && { type: LEGACY_CREATE[f.id].type, dir: LEGACY_CREATE[f.id].dir })
  if (create && create.type) {
    const id = createConnected(blockId, create.type, { incoming: create.dir === 'in' })
    if (id) showToast(LEGACY_CREATE[f.id]?.done || `${TYPES[create.type]?.label || create.type} created and linked`)
    return id
  }
  if (f.id === 'resolve' || f.id === 'prepare' || f.id === 'validate') {
    if (!b.actions.includes(f.id)) mutateBlock(blockId, { actions: [...b.actions, f.id] }, { undo: true })
    return blockId
  }
  if (f.id === 'rationale') { document.getElementById('inspRationale')?.focus(); return blockId }
  if (f.id === 'criteria') { document.getElementById('inspCriteria')?.focus(); return blockId }
  return null
}
