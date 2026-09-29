// ════════════════════════════════════════════════════════════
//  normalize.js: sanitize untrusted canvas data before it
//  reaches state and rendering.
//
//  Every external entry point (localStorage load, file import,
//  shared-link decode) routes through normalizeCanvas() so a
//  single malformed block can never throw inside render and blank
//  the whole canvas. Fixable fields are coerced; unsalvageable
//  items (no id/type) are dropped and counted.
// ════════════════════════════════════════════════════════════

import { resolveTypeId, STATUS_DEFS, PRIORITY_DEFS, ACTION_DEFS,
         CARD_STYLES, DEFAULT_CARD_STYLE, BORDER_WIDTHS,
         SITUATION_FIELDS, SITUATION_DEFAULT, HIGHLIGHTS,
         PROMPT_MODES, PROMPT_TONES, PROMPT_DETAILS, PRE_PROMPTS, PROMPT_OPTS_DEFAULT } from './utils.js'
import { RELATIONS } from './relations.js'

const VALID_ACTIONS   = Object.keys(ACTION_DEFS)
const VALID_STATUSES  = Object.keys(STATUS_DEFS)
const VALID_PRIORITIES = Object.keys(PRIORITY_DEFS)
// Arrow geometry and line pattern are separate fields. Before 2026-09 the
// dashes lived in `style`, which is why these two legacy values still load.
const VALID_ARROW_STYLES = ['curved', 'straight', 'elbow', 'routed']
const LEGACY_PATTERN_STYLES = ['dashed', 'dotted']
const VALID_ARROW_PATTERNS = ['solid', 'dashed', 'dotted']
const VALID_PORTS_BY = ['tidy', 'import']
// gapAck holds gap ids ('gap-no-req', ...). Any well-formed gap id is kept,
// known or not, so an acknowledgement written by newer code survives here.
const GAP_ID = /^gap-[a-z0-9-]{1,40}$/
const MAX_GAP_ACKS = 20
const MAX_TYPE_HINT = 40
const VALID_CARD_STYLES = Object.keys(CARD_STYLES)
const VALID_HIGHLIGHTS = Object.keys(HIGHLIGHTS)
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
 * Coerce a block's documentation reference into { href, label, anchor } or
 * null. Old canvases have no docRef (→ null); a docRef with neither an href
 * nor a label is meaningless and also collapses to null. The href is kept as
 * a plain string here; reachability (same-origin / configured base) and the
 * decision to fetch vs. open-in-tab are enforced later in doc-panel.js.
 */
function normalizeDocRef(raw) {
  if (!raw || typeof raw !== 'object') return null
  const href   = toStr(raw.href).trim()
  const label  = toStr(raw.label).trim()
  const anchor = toStr(raw.anchor).trim().replace(/^#/, '')
  if (!href && !label) return null
  return { href, label, anchor }
}

/**
 * Coerce one raw object into a valid block, or return null if it
 * cannot be salvaged (missing id, or no type at all).
 *
 * A type this build does not know is kept as `custom` with the original in
 * `typeHint`. A stale tab or an older copy of validate.mjs loading a canvas
 * saved by newer code must not drop those blocks: its next autosave would
 * make the loss permanent. A later build that knows the type restores it.
 */
export function normalizeBlock(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = toStr(raw.id).trim()
  if (!id) return null
  const rawType = typeof raw.type === 'string' ? raw.type.trim() : ''
  if (!rawType) return null
  // A label written where the id belongs ("Implementation", "Start / End")
  // is read as that type rather than parked as Other.
  const resolved = resolveTypeId(rawType)
  // A block that was already carried forward keeps its hint until a build
  // that knows the type reads it.
  const priorHint = toStr(raw.typeHint).trim()
  let type = resolved || 'custom'
  let typeHint = resolved ? '' : rawType
  if (resolved === 'custom' && priorHint) {
    const hinted = resolveTypeId(priorHint)
    if (hinted && hinted !== 'custom') type = hinted
    else typeHint = priorHint
  }

  const actions = Array.isArray(raw.actions)
    ? [...new Set(raw.actions.filter(a => VALID_ACTIONS.includes(a)))]
    : []
  // Questions are objects { text, answer?, askedAt? }. Old canvases stored
  // plain strings; coerce those to { text } so a "living question" can carry
  // a stored answer without breaking backward compatibility.
  const questions = Array.isArray(raw.questions)
    ? raw.questions
        .map(q => {
          if (typeof q === 'string') return { text: q }
          if (!q || typeof q !== 'object') return null
          const out = { text: toStr(q.text) }
          if (q.answer != null && toStr(q.answer)) out.answer = toStr(q.answer)
          const askedAt = toFiniteNum(q.askedAt, null)
          if (askedAt != null) out.askedAt = askedAt
          return out
        })
        .filter(q => q && (q.text || q.answer))
    : []

  const widthNum = toFiniteNum(raw.width, null)

  const gapAck = Array.isArray(raw.gapAck)
    ? [...new Set(raw.gapAck.filter(g => typeof g === 'string' && GAP_ID.test(g)))].slice(0, MAX_GAP_ACKS)
    : []

  const block = {
    id,
    type,
    title: toStr(raw.title),
    description: toStr(raw.description),
    notes: toStr(raw.notes),
    x: toFiniteNum(raw.x, 0),
    y: toFiniteNum(raw.y, 0),
    actions,
    questions,
    docRef: normalizeDocRef(raw.docRef),
    width: widthNum != null && widthNum > 0 ? widthNum : null,
    color: toColor(raw.color),
    collapsed: !!raw.collapsed,
    groupId: raw.groupId != null ? toStr(raw.groupId) : null,
    status: VALID_STATUSES.includes(raw.status) ? raw.status : null,
    priority: VALID_PRIORITIES.includes(raw.priority) ? raw.priority : null,
    // null on both means "inherit the canvas default", which is what an old
    // canvas gets, and what most blocks should keep.
    cardStyle: VALID_CARD_STYLES.includes(raw.cardStyle) ? raw.cardStyle : null,
    borderWidth: BORDER_WIDTHS.includes(toFiniteNum(raw.borderWidth, null)) ? toFiniteNum(raw.borderWidth, null) : null,
    // Presentation only. null means "not highlighted", which is nearly always.
    highlight: VALID_HIGHLIGHTS.includes(raw.highlight) ? raw.highlight : null,
    // Definition of done (requirement/goal/output) and the why of a decision.
    criteria: Array.isArray(raw.criteria)
      ? raw.criteria.map(c => toStr(c).trim()).filter(Boolean).slice(0, 30).map(c => c.slice(0, 300))
      : [],
    rationale: toStr(raw.rationale).slice(0, 2000),
  }
  // Optional fields are written only when they say something, so a canvas
  // that never used them serializes exactly as it did before they existed.
  if (typeHint) block.typeHint = typeHint.slice(0, MAX_TYPE_HINT)
  // Auto-typed with low confidence and not yet confirmed by a person.
  if (raw.typeCheck === true) block.typeCheck = true
  // Gap ids the author looked at and accepted for this block.
  if (gapAck.length) block.gapAck = gapAck
  return block
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

  const PORTS = ['left', 'right', 'top', 'bottom']
  // Legacy { style: 'dashed' } becomes { style: 'curved', pattern: 'dashed' }:
  // the dashed style always drew a curve, so the drawing does not change.
  // An unknown style also stays 'curved' rather than turning into 'routed',
  // which would redraw old canvases.
  const legacyPattern = LEGACY_PATTERN_STYLES.includes(raw.style) ? raw.style : null
  const pattern = VALID_ARROW_PATTERNS.includes(raw.pattern) ? raw.pattern : (legacyPattern || 'solid')
  return {
    id: toStr(raw.id).trim() || null,
    from,
    to,
    relation: Object.hasOwn(RELATIONS, raw.relation) ? raw.relation : null,
    style: VALID_ARROW_STYLES.includes(raw.style) ? raw.style : 'curved',
    pattern,
    bidirectional: !!raw.bidirectional,
    color: toColor(raw.color),
    weight: toFiniteNum(raw.weight, 2),
    label: raw.label != null ? toStr(raw.label) : undefined,
    note: raw.note != null ? toStr(raw.note) : undefined,
    fromPort: PORTS.includes(raw.fromPort) ? raw.fromPort : null,
    toPort:   PORTS.includes(raw.toPort)   ? raw.toPort   : null,
    // Provenance of the pins: 'tidy' means auto-layout wrote them and a later
    // block drag may release them; 'import' means another tool's layout did,
    // and Tidy may restamp them. Anything else collapses to absent (= user).
    portsBy: VALID_PORTS_BY.includes(raw.portsBy) ? raw.portsBy : undefined,
  }
}

/**
 * Coerce the engagement situation. Unknown keys fall back to the default
 * rather than being dropped, because a missing situation is worse than a
 * conservative one: the prompt would simply stop saying where things stand.
 */
export function normalizeSituation(raw) {
  const out = { ...SITUATION_DEFAULT }
  if (!raw || typeof raw !== 'object') return out
  Object.keys(SITUATION_FIELDS).forEach(key => {
    if (Object.prototype.hasOwnProperty.call(SITUATION_FIELDS[key].options, raw[key])) out[key] = raw[key]
  })
  out.repoHint = toStr(raw.repoHint).slice(0, 300)
  out.constraints = toStr(raw.constraints).slice(0, 1000)
  return out
}

/**
 * Coerce meta.prompt (mode + dev options). Unknown values fall back to the
 * defaults rather than being dropped, so an old canvas simply reads as Plan
 * mode with nothing extra, which is what it always was.
 */
export function normalizePromptOpts(raw) {
  const out = { ...PROMPT_OPTS_DEFAULT, pre: [] }
  if (!raw || typeof raw !== 'object') return out
  if (PROMPT_MODES.includes(raw.mode)) out.mode = raw.mode
  if (PROMPT_TONES.includes(raw.tone)) out.tone = raw.tone
  if (PROMPT_DETAILS.includes(raw.detail)) out.detail = raw.detail
  if (Array.isArray(raw.pre)) out.pre = [...new Set(raw.pre.filter(v => PRE_PROMPTS.includes(v)))]
  return out
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
  const result = { blocks: {}, arrows: [], groups: {}, meta: { title: '', contextBrief: '', cardStyle: DEFAULT_CARD_STYLE, spotlight: false, situation: { ...SITUATION_DEFAULT }, prompt: { ...PROMPT_OPTS_DEFAULT, pre: [] } } }
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
    result.meta = {
      title: toStr(data.meta.title),
      contextBrief: toStr(data.meta.contextBrief),
      cardStyle: VALID_CARD_STYLES.includes(data.meta.cardStyle) ? data.meta.cardStyle : DEFAULT_CARD_STYLE,
      spotlight: !!data.meta.spotlight,
      situation: normalizeSituation(data.meta.situation),
      prompt: normalizePromptOpts(data.meta.prompt),
    }
  }

  return { ...result, dropped }
}
