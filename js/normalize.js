// ════════════════════════════════════════════════════════════
//  normalize.js — Sanitize untrusted canvas data before it
//  reaches state and rendering.
//
//  Every external entry point (localStorage load, file import,
//  shared-link decode) routes through normalizeCanvas() so a
//  single malformed block can never throw inside render and blank
//  the whole canvas. Fixable fields are coerced; unsalvageable
//  items (no id/type) are dropped and counted.
// ════════════════════════════════════════════════════════════

import { TYPES, DEFAULT_WIDTH, STATUS_DEFS, PRIORITY_DEFS, ACTION_DEFS } from './utils.js'

const VALID_ACTIONS   = Object.keys(ACTION_DEFS)
const VALID_STATUSES  = Object.keys(STATUS_DEFS)
const VALID_PRIORITIES = Object.keys(PRIORITY_DEFS)
const VALID_ARROW_STYLES = ['curved', 'straight', 'elbow', 'dashed', 'dotted']
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/

function toStr(v) {
  return typeof v === 'string' ? v : (v == null ? '' : String(v))
}
function toFiniteNum(v, fallback) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}
function toColor(v) {
  return typeof v === 'string' && HEX_COLOR.test(v) ? v : null
}

/**
 * Coerce one raw object into a valid block, or return null if it
 * cannot be salvaged (missing id, or a type not in the registry).
 */
export function normalizeBlock(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = toStr(raw.id).trim()
  if (!id) return null
  if (!TYPES[raw.type]) return null

  const actions = Array.isArray(raw.actions)
    ? [...new Set(raw.actions.filter(a => VALID_ACTIONS.includes(a)))]
    : []
  const questions = Array.isArray(raw.questions)
    ? raw.questions.map(toStr)
    : []

  const widthNum = toFiniteNum(raw.width, null)

  return {
    id,
    type: raw.type,
    title: toStr(raw.title),
    description: toStr(raw.description),
    notes: toStr(raw.notes),
    x: toFiniteNum(raw.x, 0),
    y: toFiniteNum(raw.y, 0),
    actions,
    questions,
    width: widthNum != null && widthNum > 0 ? widthNum : null,
    color: toColor(raw.color),
    collapsed: !!raw.collapsed,
    groupId: raw.groupId != null ? toStr(raw.groupId) : null,
    status: VALID_STATUSES.includes(raw.status) ? raw.status : null,
    priority: VALID_PRIORITIES.includes(raw.priority) ? raw.priority : null,
  }
}

/**
 * Coerce one raw object into a valid arrow. Endpoint existence is
 * not checked here (the importer remaps IDs); only shape is fixed.
 */
export function normalizeArrow(raw) {
  if (!raw || typeof raw !== 'object') return null
  const from = toStr(raw.from).trim()
  const to   = toStr(raw.to).trim()
  if (!from || !to || from === to) return null

  return {
    id: toStr(raw.id).trim() || null,
    from,
    to,
    style: VALID_ARROW_STYLES.includes(raw.style) ? raw.style : 'curved',
    bidirectional: !!raw.bidirectional,
    color: toColor(raw.color),
    weight: toFiniteNum(raw.weight, 2),
    label: raw.label != null ? toStr(raw.label) : undefined,
  }
}

function normalizeGroup(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = toStr(raw.id).trim()
  if (!id) return null
  return { id, label: toStr(raw.label) || 'Group' }
}

/**
 * Normalize a full canvas payload into clean { blocks, arrows,
 * groups, meta } plus a `dropped` report of how many items were
 * unsalvageable. Accepts blocks as either an array or id-keyed map.
 */
export function normalizeCanvas(data) {
  const dropped = { blocks: 0, arrows: 0, groups: 0 }
  const result = { blocks: {}, arrows: [], groups: {}, meta: { title: '', contextBrief: '' } }
  if (!data || typeof data !== 'object') return { ...result, dropped }

  const rawBlocks = Array.isArray(data.blocks)
    ? data.blocks
    : (data.blocks && typeof data.blocks === 'object' ? Object.values(data.blocks) : [])
  rawBlocks.forEach(rb => {
    const b = normalizeBlock(rb)
    if (b) result.blocks[b.id] = b
    else dropped.blocks++
  })

  const rawGroups = (data.groups && typeof data.groups === 'object' && !Array.isArray(data.groups))
    ? Object.values(data.groups)
    : (Array.isArray(data.groups) ? data.groups : [])
  rawGroups.forEach(rg => {
    const g = normalizeGroup(rg)
    if (g) result.groups[g.id] = g
    else dropped.groups++
  })

  const rawArrows = Array.isArray(data.arrows) ? data.arrows : []
  rawArrows.forEach(ra => {
    const a = normalizeArrow(ra)
    if (a) result.arrows.push(a)
    else dropped.arrows++
  })

  // Drop groupId references to groups that didn't survive
  Object.values(result.blocks).forEach(b => {
    if (b.groupId && !result.groups[b.groupId]) b.groupId = null
  })

  if (data.meta && typeof data.meta === 'object') {
    result.meta = { title: toStr(data.meta.title), contextBrief: toStr(data.meta.contextBrief) }
  }

  return { ...result, dropped }
}
