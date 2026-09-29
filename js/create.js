// ════════════════════════════════════════════════════════════
//  create.js: every "make a block here" path in one place.
//
//  The palette, the canvas add menu, quick-create from a port,
//  the keyboard and the gap fixes all create through these, so
//  each creation is one undo step and lands in title editing.
// ════════════════════════════════════════════════════════════

import { state, ui, snapshot } from './state.js'
import { TYPES, DEFAULT_WIDTH, genId, getBlockDims, showToast } from './utils.js'
import { renderArrows, resolveRoutes, arrowMidpoint } from './canvas.js'
import { renderBlock, selectBlock, createBlock, addArrow, mutateBlock } from './render.js'
import { startInlineEdit } from './inline-edit.js'
import { impliedVerb } from './relations.js'

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

function overlapsAny(x, y, w, h, skip) {
  const M = 12
  return Object.values(state.blocks).some(o => {
    if (o.id === skip) return false
    const d = blockSize(o.id)
    return x < o.x + d.w + M && x + w + M > o.x && y < o.y + d.h + M && y + h + M > o.y
  })
}

function finishCreate(id, { edit, select }) {
  if (select || edit) selectBlock(id)
  if (edit) startInlineEdit(id, 'title', { selectAll: true })
  return id
}

/**
 * Create a block centred on world point (wx, wy). One undo step. Selects it
 * and starts title editing unless told not to.
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
  renderBlock(id)
  renderArrows()
  if (edit) startInlineEdit(id, 'title', { selectAll: true })
  return id
}

/**
 * Create a block beside `fromId` and connect them. The new block sits 80px
 * beyond the chosen side and slides 24px along that side until it overlaps
 * nothing, so repeated calls stack instead of piling up. One undo step.
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
  for (let i = 0; i < MAX_STEPS && overlapsAny(x, y, n.w, n.h, id); i++) {
    if (slideY) y += STEP; else x += STEP
  }
  b.x = Math.round(x); b.y = Math.round(y)
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
