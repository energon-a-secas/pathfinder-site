import { connectionLabel } from './relations.js'
// ════════════════════════════════════════════════════════════
//  interop.js: other tools' canvases, in and out.
//
//  JSON Canvas (.canvas, the MIT format from Obsidian and
//  friends, jsoncanvas.org) imports AND exports, so a plan can
//  arrive from a vault and the result can live back in it.
//  Mermaid flowcharts import and export, because engineers have
//  them in every README.
//
//  Types travel explicitly, never by guesswork when a signal is
//  there: JSON Canvas nodes carry their type's exact hex plus a
//  `pathfinderType` field, Mermaid nodes carry a shape and a
//  `class` line. Only text with no signal goes through the same
//  classifier Brain Dump uses (categorizeLine), and low-confidence
//  calls are flagged `typeCheck` for a person to confirm.
//  Positions for Mermaid come from the app's own layered layout
//  rather than a guess.
// ════════════════════════════════════════════════════════════

import { state, canvasMeta } from './state.js'
import { TYPES, DEFAULT_ARROW_WEIGHT, genId, getBlockDims } from './utils.js'
import { categorizeLine } from './classify.js'
import { layoutGraph } from './layout.js'

// ── Format detection ─────────────────────────────────────────

export function detectFormat(text) {
  const t = String(text || '').trim()
  if (!t) return null
  if (/```mermaid/.test(t) || /^(flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/m.test(t)) return 'mermaid'
  try {
    const data = JSON.parse(t)
    if (data && Array.isArray(data.nodes)) return 'canvas'
    if (data && typeof data === 'object') return 'pathfinder'
  } catch (_) {}
  return null
}

// ── JSON Canvas: colours and types ───────────────────────────
// The spec's six presets are hues with no defined meaning ("intentionally
// not defined so that applications can tailor the presets"). Older
// Pathfinder exports wrote them, two types per preset, so a preset is a
// hint between candidates and never a type on its own. Export now writes
// each type's own hex, which maps back to exactly one type.

const JC_TO_HEX = { 1: '#f87171', 2: '#fb923c', 3: '#fbbf24', 4: '#34d399', 5: '#22d3ee', 6: '#a78bfa' }
// The pre-2026-09 export table, reversed: what each preset used to mean.
const JC_PRESET_TYPES = {
  1: ['problem'], 2: ['risk'], 3: ['requirement', 'assumption'],
  4: ['decision'], 5: ['question', 'resource'], 6: ['goal', 'output'],
}

function jcColorToHex(c) {
  if (c == null) return null
  const s = String(c)
  if (/^#/.test(s)) return s
  return JC_TO_HEX[s] || null
}

/** The type whose dark or light hex is exactly `hex`, or null. */
export function typeForHex(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex.trim())) return null
  const h = hex.trim().toLowerCase()
  for (const [id, t] of Object.entries(TYPES)) {
    if (String(t.color).toLowerCase() === h || String(t.light || '').toLowerCase() === h) return id
  }
  return null
}

// An override equal to the type's own colour says nothing, and a dark hex
// pinned on a card keeps it dark in light mode. Only a real override stays.
function overrideFor(hex, type) {
  if (!hex) return null
  const t = TYPES[type]
  const h = hex.toLowerCase()
  if (t && (String(t.color).toLowerCase() === h || String(t.light || '').toLowerCase() === h)) return null
  return hex
}

const TYPE_ID = /^[a-z][a-z0-9-]{0,39}$/
const HEX = /^#[0-9a-f]{3,8}$/i

/**
 * The colour to write for a block's override. Most swatches are exactly
 * some type's hex (Red is problem's), so a Risk coloured Red would read
 * back as a Problem in any tool that keeps only the spec fields. Such an
 * override is moved one step in its blue channel: the same colour to an
 * eye, and no longer a type's. Returns [written, exact] where `exact` is
 * the original when it had to move, else null.
 */
export function exportColorFor(color, type) {
  if (!color) return [null, null]
  const owner = typeForHex(color)
  if (!owner || owner === type) return [color, null]
  const base = color.trim().toLowerCase()
  const blue = parseInt(base.slice(5, 7), 16)
  for (const step of [1, -1, 2, -2, 3, -3]) {
    const b = blue + step
    if (b < 0 || b > 255) continue
    const moved = base.slice(0, 5) + b.toString(16).padStart(2, '0')
    if (!typeForHex(moved)) return [moved, color]
  }
  return [color, null]
}

/**
 * Decide a text node's type from the strongest signal it carries:
 * 1. `pathfinderType` (written by our own export): exact, high.
 * 2. A colour that is exactly one type's hex: exact, high.
 * 3. A preset colour: a hint between that preset's candidate types. It
 *    settles a low-confidence classifier call; a confident classifier
 *    that disagrees keeps its call but is flagged for a check.
 * 4. The classifier alone.
 * Returns { type, title, confidence }.
 */
export function resolveNodeType(node, title) {
  const hinted = typeof node.pathfinderType === 'string' ? node.pathfinderType.trim() : ''
  // An unknown id is kept as-is: normalize turns it into custom + typeHint,
  // so a newer export read by an older build does not lose the type.
  if (hinted && TYPE_ID.test(hinted)) return { type: hinted, title, confidence: 'high' }
  const color = node.color == null ? '' : String(node.color).trim()
  const exact = typeForHex(color)
  if (exact) return { type: exact, title, confidence: 'high' }

  const cat = categorizeLine(title || '(untitled)')
  const candidates = JC_PRESET_TYPES[color] || null
  const catTitle = title ? (cat.title || title) : ''
  if (!candidates) return { type: cat.type, title: catTitle, confidence: cat.confidence }
  if (candidates.includes(cat.type)) return { type: cat.type, title: catTitle, confidence: cat.confidence }
  if (cat.confidence === 'high') return { type: cat.type, title: catTitle, confidence: 'low' }
  // The classifier's prefix stripping only applies to its own call.
  return { type: candidates[0], title, confidence: 'low' }
}

// First non-empty line becomes the title, the rest the description.
function splitText(md) {
  const lines = String(md || '').split(/\r?\n/)
  const i = lines.findIndex(l => l.trim())
  if (i < 0) return { title: '', description: '' }
  const title = lines[i].trim().replace(/^#{1,6}\s+/, '').replace(/^[-*>]\s+/, '').replace(/\*\*/g, '').slice(0, 200)
  const description = lines.slice(i + 1).join('\n').trim()
  return { title, description }
}

// ── JSON Canvas → Pathfinder ─────────────────────────────────

export function fromJsonCanvas(data) {
  const blocks = []
  const lowConfidence = []
  const groupRects = []

  ;(Array.isArray(data.nodes) ? data.nodes : []).forEach(n => {
    if (!n || typeof n !== 'object') return
    const id = String(n.id ?? genId())
    if (n.type === 'group') {
      groupRects.push({ id, label: String(n.label || 'Group'), x: +n.x || 0, y: +n.y || 0, w: +n.width || 0, h: +n.height || 0 })
      return
    }
    // A preset is spent as a type hint (resolveNodeType), so only a real hex
    // can become a colour override. Our own export keeps the exact override
    // in `pathfinderColor` when it had to move the written one off a type
    // hex (exportColorFor).
    const rawColor = n.color == null ? '' : String(n.color).trim()
    const exact = typeof n.pathfinderColor === 'string' && HEX.test(n.pathfinderColor.trim()) ? n.pathfinderColor.trim() : null
    const hex = exact || (HEX.test(rawColor) ? rawColor : null)
    const base = { id, x: +n.x || 0, y: +n.y || 0, width: n.width > 0 ? +n.width : null }
    if (n.type === 'file' || n.type === 'link') {
      const isFile = n.type === 'file'
      const ref = String((isFile ? n.file : n.url) || '')
      const type = typeof n.pathfinderType === 'string' && TYPE_ID.test(n.pathfinderType) ? n.pathfinderType : 'resource'
      const title = isFile
        ? (ref.split('/').pop() || 'File')
        : (ref.replace(/^https?:\/\//, '').slice(0, 120) || 'Link')
      blocks.push({ ...base, type, color: overrideFor(hex, type), title, description: '',
        docRef: { href: ref, label: isFile ? (ref.split('/').pop() || '') : '', anchor: '' } })
      return
    }
    // text node (or unknown): the strongest type signal wins.
    const split = splitText(n.text)
    // Our own export writes "(untitled)" for an empty title; read it back empty.
    const title = split.title === '(untitled)' ? '' : split.title
    const description = split.description
    const r = resolveNodeType(n, title)
    const block = { ...base, type: r.type, color: overrideFor(hex, r.type), title: r.title ?? title, description }
    if (r.confidence === 'low') { block.typeCheck = true; lowConfidence.push(id) }
    blocks.push(block)
  })

  // Group membership by geometry: a block belongs to the smallest group
  // rectangle containing its top-left corner, matching how canvases nest.
  const groups = groupRects.map(g => ({ id: g.id, label: g.label }))
  blocks.forEach(b => {
    const inside = groupRects
      .filter(g => b.x >= g.x && b.x <= g.x + g.w && b.y >= g.y && b.y <= g.y + g.h)
      .sort((p, q) => p.w * p.h - q.w * q.h)[0]
    if (inside) b.groupId = inside.id
  })

  const SIDES = ['top', 'right', 'bottom', 'left']
  const nodeIds = new Set(blocks.map(b => b.id))
  const arrows = []
  ;(Array.isArray(data.edges) ? data.edges : []).forEach(e => {
    if (!e || typeof e !== 'object') return
    const from = String(e.fromNode ?? ''), to = String(e.toNode ?? '')
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) return
    const fromPort = SIDES.includes(e.fromSide) ? e.fromSide : null
    const toPort = SIDES.includes(e.toSide) ? e.toSide : null
    const arrow = {
      id: String(e.id ?? genId()), from, to,
      label: e.label != null ? String(e.label) : undefined,
      fromPort, toPort,
      bidirectional: e.fromEnd === 'arrow',
      // Routed, not the legacy curve: an imported canvas has no hand-drawn
      // lines worth preserving, and the router steers around the cards.
      // New to this app, so drawn at the new-connection weight.
      style: 'routed', weight: DEFAULT_ARROW_WEIGHT,
    }
    // Another tool's layout picked these sides, not a person here, so Tidy
    // may move them.
    if (fromPort || toPort) arrow.portsBy = 'import'
    const edgeColor = jcColorToHex(e.color)
    if (edgeColor && /^#[0-9a-f]{3,8}$/i.test(edgeColor)) arrow.color = edgeColor
    arrows.push(arrow)
  })

  return { payload: { blocks, arrows, groups, meta: { title: '' } }, lowConfidence }
}

// ── Pathfinder → JSON Canvas ─────────────────────────────────

export function toJsonCanvas() {
  const nodes = []
  Object.values(state.blocks).forEach(b => {
    const { w, h } = getBlockDims(b.id)
    let text = `#### ${b.title || '(untitled)'}`
    if (b.description) text += `\n\n${b.description}`
    if ((b.criteria || []).length) text += '\n\n' + b.criteria.map(c => `- [ ] ${c}`).join('\n')
    if (b.rationale?.trim()) text += `\n\n_Rationale: ${b.rationale.trim()}_`
    const type = TYPES[b.type] ? b.type : 'custom'
    const [override, exact] = exportColorFor(b.color, type)
    const node = {
      id: b.id, type: 'text',
      x: Math.round(b.x), y: Math.round(b.y),
      width: Math.round(b.width || w || 260), height: Math.round(h || 120),
      // The type's own hex, so the type survives a tool that drops the
      // extra field below; an override colour wins on screen, as it does
      // here, and never reads as another type's hex.
      color: override || TYPES[type].color,
      text,
      // Not in the JSON Canvas spec, which neither defines nor forbids extra
      // properties. Import prefers it when a tool kept it.
      pathfinderType: b.typeHint || type,
    }
    if (exact) node.pathfinderColor = exact
    nodes.push(node)
  })

  // Groups become group nodes sized to their members plus padding.
  Object.values(state.groups || {}).forEach(g => {
    const members = Object.values(state.blocks).filter(b => b.groupId === g.id)
    if (!members.length) return
    const PAD = 40
    const xs = members.map(b => b.x), ys = members.map(b => b.y)
    const x2 = Math.max(...members.map(b => b.x + (getBlockDims(b.id).w || 260)))
    const y2 = Math.max(...members.map(b => b.y + (getBlockDims(b.id).h || 120)))
    nodes.push({
      id: 'group-' + g.id, type: 'group', label: g.label || 'Group',
      x: Math.round(Math.min(...xs) - PAD), y: Math.round(Math.min(...ys) - PAD),
      width: Math.round(x2 - Math.min(...xs) + PAD * 2), height: Math.round(y2 - Math.min(...ys) + PAD * 2),
    })
  })

  const edges = state.arrows
    .filter(a => state.blocks[a.from] && state.blocks[a.to])
    .map(a => {
      const e = { id: a.id, fromNode: a.from, toNode: a.to }
      if (a.fromPort) e.fromSide = a.fromPort
      if (a.toPort) e.toSide = a.toPort
      if (connectionLabel(a)) e.label = connectionLabel(a)
      if (a.bidirectional) e.fromEnd = 'arrow'
      if (a.color) e.color = a.color
      return e
    })

  return { nodes, edges }
}

export function downloadJsonCanvas() {
  const blob = new Blob([JSON.stringify(toJsonCanvas(), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = (canvasMeta.title || 'pathfinder').trim().replace(/[^\w-]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '') + '.canvas'
  a.click()
  URL.revokeObjectURL(a.href)
}

// ── Mermaid: shapes and classes ──────────────────────────────
// Every node shape Mermaid's flowchart syntax has, longest opener first,
// so `((x))` is a circle rather than a round box around `(x)`.
const SHAPES = [
  ['(((', ')))', 'dcircle'],
  ['((', '))', 'circle'],
  ['([', '])', 'stadium'],
  ['[[', ']]', 'subroutine'],
  ['[(', ')]', 'cylinder'],
  ['{{', '}}', 'hexagon'],
  ['[/', '/]', 'parallelogram'],
  ['[\\', '\\]', 'parallelogram'],
  ['[/', '\\]', 'trapezoid'],
  ['[\\', '/]', 'trapezoid'],
  ['{', '}', 'diamond'],
  ['[', ']', 'rect'],
  ['(', ')', 'round'],
  ['>', ']', 'flag'],
]

// Shapes with a flowchart convention behind them. The confident ones are
// the conventions nobody reads differently (a diamond is a decision, a
// cylinder is a store); the rest only settle a call the classifier could
// not make.
const SHAPE_TYPES = {
  diamond: ['decision', 'high'],
  stadium: ['terminator', 'high'],
  circle: ['terminator', 'high'],
  dcircle: ['terminator', 'high'],
  cylinder: ['resource', 'high'],
  subroutine: ['implementation', 'low'],
  parallelogram: ['output', 'low'],
  hexagon: ['question', 'low'],
  flag: ['context', 'low'],
}

// What export draws each type as. Types without a shape of their own stay
// rectangles and travel by their `class` line, which Mermaid also renders.
const TYPE_SHAPES = {
  decision: ['{', '}'],
  terminator: ['([', '])'],
  resource: ['[(', ')]'],
  output: ['[/', '/]'],
  implementation: ['[[', ']]'],
  question: ['{{', '}}'],
  context: ['>', ']'],
}

/** The Mermaid opener and closer for a type, e.g. ['{', '}'] for decision. */
export function mermaidShapeFor(type) {
  return TYPE_SHAPES[type] || ['[', ']']
}

const decodeEntities = s => s
  .replace(/#quot;/g, '"')
  .replace(/#(\d{1,6});/g, (_, n) => { try { return String.fromCodePoint(+n) } catch (_) { return '' } })

function mermaidNodeType(shape, label, cls) {
  if (cls && Object.hasOwn(TYPES, cls)) return { type: cls, confidence: 'high' }
  const byShape = SHAPE_TYPES[shape]
  if (byShape && byShape[1] === 'high') return { type: byShape[0], confidence: 'high' }
  const cat = categorizeLine(label)
  if (cat.confidence === 'high') return { type: cat.type, confidence: 'high' }
  if (byShape) return { type: byShape[0], confidence: 'low' }
  // A flowchart is a workflow, and 'process' beats 'custom' as the honest
  // fallback for a box nothing else describes.
  return { type: 'process', confidence: 'low' }
}

// One node token: id, an optional shaped label, an optional :::class.
function parseNodeToken(tok, reg) {
  let t = String(tok || '').trim()
  let cls = null
  const cm = t.match(/:::([\w-]+)\s*$/)
  if (cm) { cls = cm[1]; t = t.slice(0, cm.index).trim() }
  const im = t.match(/^[\w.-]+/)
  if (!im) return null
  const id = im[0]
  const rest = t.slice(id.length).trim()
  let label = null, shape = null
  if (rest) {
    const sh = SHAPES.find(([o, c]) => rest.length >= o.length + c.length && rest.startsWith(o) && rest.endsWith(c))
    if (!sh) return null
    label = decodeEntities(rest.slice(sh[0].length, rest.length - sh[1].length).trim().replace(/^["'`]|["'`]$/g, ''))
    shape = sh[2]
  }
  if (!reg.has(id)) reg.set(id, { id, label: label || id, shape: shape || 'plain', cls })
  else {
    const n = reg.get(id)
    if (label) { n.label = label; if (shape) n.shape = shape }
    if (cls) n.cls = cls
  }
  return id
}

// Split `a & b[x & y]` on the ampersands that sit outside any label.
function splitAmp(text) {
  const out = []
  let depth = 0, quote = false, cur = ''
  for (const ch of String(text || '')) {
    if (ch === '"') quote = !quote
    if (!quote) {
      if ('[({'.includes(ch)) depth++
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1)
      else if (ch === '&' && depth === 0) { out.push(cur); cur = ''; continue }
    }
    cur += ch
  }
  out.push(cur)
  return out.map(t => t.trim()).filter(Boolean)
}

// ── Mermaid flowchart → Pathfinder ───────────────────────────

// Mermaid's comments are lines that start with %%. A %% inside a quoted
// label is text ("5%% of calls"); one after the statement, outside quotes,
// is tolerated as a trailing comment.
function stripComment(line) {
  const t = String(line).trim()
  if (t.startsWith('%%')) return ''
  let quote = false
  for (let i = 0; i < t.length - 1; i++) {
    if (t[i] === '"') quote = !quote
    else if (!quote && t[i] === '%' && t[i + 1] === '%') return t.slice(0, i).trim()
  }
  return t
}

export function parseMermaid(text) {
  let body = String(text || '')
  const fence = body.match(/```mermaid\s*\n([\s\S]*?)```/)
  if (fence) body = fence[1]
  const lines = body.split(/\r?\n/).map(stripComment).filter(Boolean)

  let direction = 'LR'
  const reg = new Map()          // id -> { id, label, shape, cls }
  const edges = []
  const groups = []
  const membership = {}          // nodeId -> groupId
  const groupStack = []
  const classOf = {}             // nodeId -> class name from `class` lines

  const EDGE_SPLIT = /\s*(<-->|<-\.->|<==>|-\.->|-\.-|-->|---|==>|--)\s*(?:\|([^|]*)\|\s*)?/

  lines.forEach(line => {
    const dir = line.match(/^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/)
    if (dir) { direction = (dir[1] === 'TB' || dir[1] === 'TD' || dir[1] === 'BT') ? 'TB' : 'LR'; return }
    if (/^(flowchart|graph)\b/.test(line)) return
    const sub = line.match(/^subgraph\s+(?:[\w.-]+\s*\[(.+?)\]|(.+))$/)
    if (sub) {
      const gid = genId()
      groups.push({ id: gid, label: decodeEntities((sub[1] || sub[2] || 'Group').trim().replace(/^["']|["']$/g, '')) })
      groupStack.push(gid)
      return
    }
    if (/^end$/i.test(line)) { groupStack.pop(); return }
    // `class a,b goal` is how an export names each node's type.
    const cl = line.match(/^class\s+([\w.,\s-]+?)\s+([\w-]+)\s*;?$/)
    if (cl) { cl[1].split(',').map(x => x.trim()).filter(Boolean).forEach(id => { classOf[id] = cl[2] }); return }
    if (/^(classDef|class|style|linkStyle|click|direction)\b/.test(line)) return

    // Quoted text may hold anything, arrows and pipes included, so it is
    // masked before the line is split into nodes and links.
    const quoted = []
    const masked = line.replace(/;\s*$/, '').replace(/"[^"]*"/g, m => { quoted.push(m); return '\u0000' + (quoted.length - 1) + '\u0000' })
    const unmask = str => String(str ?? '').replace(/\u0000(\d+)\u0000/g, (_, i) => quoted[+i])
    // `A -- label --> B` is the long label form; fold it into the |label| one.
    const norm = masked.replace(/--\s+([^->|]+?)\s+-->/g, '-->|$1|')
    const parts = norm.split(EDGE_SPLIT)
    // parts: node, op, label?, node, op, label?, node ...
    let prevIds = null
    for (let i = 0; i < parts.length; i += 3) {
      const ids = splitAmp(parts[i]).map(t => parseNodeToken(unmask(t), reg)).filter(Boolean)
      ids.forEach(id => { if (groupStack.length && membership[id] == null) membership[id] = groupStack[groupStack.length - 1] })
      const op = parts[i - 2], label = parts[i - 1] != null ? unmask(parts[i - 1]) : undefined
      if (prevIds && op && ids.length) {
        prevIds.forEach(f => ids.forEach(t => {
          if (f === t) return
          edges.push({
            from: f, to: t,
            label: label ? decodeEntities(label.trim().replace(/^["']|["']$/g, '')) : undefined,
            // Dotted Mermaid links keep their routing; the dash is a pattern.
            style: 'routed',
            pattern: op.includes('.') ? 'dashed' : 'solid',
            weight: op.includes('==') ? 3.5 : DEFAULT_ARROW_WEIGHT,
            bidirectional: op.startsWith('<') || undefined,
          })
        }))
      }
      if (ids.length) prevIds = ids
    }
  })

  if (!reg.size) return { payload: { blocks: [], arrows: [], groups: [], meta: { title: '' } }, lowConfidence: [] }

  // Positions from the app's own layered layout, not a guess.
  const layoutNodes = [...reg.values()].map(n => ({ id: n.id, w: 260, h: 120 }))
  const { positions } = layoutGraph(layoutNodes, edges.map(e => ({ from: e.from, to: e.to })), { direction })

  const lowConfidence = []
  const blocks = [...reg.values()].map(n => {
    const { type, confidence } = mermaidNodeType(n.shape, n.label, classOf[n.id] || n.cls)
    const p = positions.get(n.id) || { x: 0, y: 0 }
    const block = { id: n.id, type, title: n.label.slice(0, 200), x: p.x, y: p.y, groupId: membership[n.id] || null }
    if (confidence === 'low') { block.typeCheck = true; lowConfidence.push(n.id) }
    return block
  })
  const arrows = edges.map(e => ({ id: genId(), from: e.from, to: e.to, label: e.label, style: e.style, pattern: e.pattern, weight: e.weight, bidirectional: e.bidirectional }))

  return { payload: { blocks, arrows, groups, meta: { title: '' } }, lowConfidence }
}

// ── Pathfinder → Mermaid flowchart ───────────────────────────

// Mermaid's entity codes: #quot; for a double quote, and '#' itself as
// #35; so a title like "issue #12; then" is not read as the code #12;. '%'
// goes as #37; so "%%" in a label can never start a comment, and a backtick
// as #96; so a title cannot close the ``` fence the Markdown export puts
// the graph in.
const mmText = s => String(s ?? '').replace(/\s+/g, ' ').trim()
  .replace(/#/g, '#35;').replace(/%/g, '#37;').replace(/"/g, '#quot;').replace(/`/g, '#96;')
const mmEdgeLabel = s => mmText(s).replace(/\|/g, '/')

/**
 * The canvas as a Mermaid flowchart that reads back without loss of type:
 * every block is declared (isolated ones too), each type gets its
 * conventional shape where one exists, a `class` line names every node's
 * type, and groups become subgraphs. `classDef` only outlines, so it reads
 * on GitHub's light and dark themes alike.
 */
export function toMermaid({ blocks = state.blocks, arrows = state.arrows, groups = state.groups, direction = 'LR' } = {}) {
  const list = Object.values(blocks || {})
  if (!list.length) return ''
  const key = new Map(list.map((b, i) => [b.id, 'n' + (i + 1)]))
  const decl = b => {
    const [o, c] = mermaidShapeFor(b.type)
    return `${key.get(b.id)}${o}"${mmText(b.title) || 'Untitled'}"${c}`
  }
  const out = [`flowchart ${direction === 'TB' ? 'TB' : 'LR'}`]
  const grouped = new Map()
  list.forEach(b => {
    const g = b.groupId && groups?.[b.groupId]
    if (!g) { out.push('  ' + decl(b)); return }
    if (!grouped.has(g.id)) grouped.set(g.id, [])
    grouped.get(g.id).push(b)
  })
  let gi = 0
  grouped.forEach((members, gid) => {
    out.push(`  subgraph g${++gi}["${mmText(groups[gid].label) || 'Group'}"]`)
    members.forEach(b => out.push('    ' + decl(b)))
    out.push('  end')
  })
  ;(arrows || []).forEach(a => {
    if (!key.has(a.from) || !key.has(a.to)) return
    const dashed = a.pattern === 'dashed' || a.pattern === 'dotted'
    const op = a.bidirectional
      ? (dashed ? '<-.->' : '<-->')
      : (dashed ? '-.->' : (a.weight >= 3 ? '==>' : '-->'))
    const label = connectionLabel(a)
    out.push(`  ${key.get(a.from)} ${op}${label ? `|"${mmEdgeLabel(label)}"|` : ''} ${key.get(a.to)}`)
  })
  const byType = new Map()
  list.forEach(b => {
    const t = TYPES[b.type] ? b.type : 'custom'
    if (!byType.has(t)) byType.set(t, [])
    byType.get(t).push(key.get(b.id))
  })
  byType.forEach((ids, t) => out.push(`  class ${ids.join(',')} ${t}`))
  byType.forEach((_, t) => out.push(`  classDef ${t} stroke:${TYPES[t].color},stroke-width:2px`))
  return out.join('\n') + '\n'
}
