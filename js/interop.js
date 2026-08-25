// ════════════════════════════════════════════════════════════
//  interop.js: other tools' canvases, in and out.
//
//  JSON Canvas (.canvas, the MIT format from Obsidian and
//  friends, jsoncanvas.org) imports AND exports, so a plan can
//  arrive from a vault and the result can live back in it.
//  Mermaid flowcharts import, because engineers have them in
//  every README and the Markdown export already writes them.
//
//  Imported text carries no types, so nodes go through the same
//  classifier Brain Dump uses (categorizeLine); low-confidence
//  calls surface as the existing correction chips. Positions
//  for Mermaid come from the app's own layered layout rather
//  than a guess.
// ════════════════════════════════════════════════════════════

import { state, canvasMeta } from './state.js'
import { TYPES, genId, getBlockDims } from './utils.js'
import { categorizeLine } from './events.js'
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

// ── JSON Canvas: shared color mapping ────────────────────────
// The spec's six presets, both directions. Hex passes through as-is.

const JC_TO_HEX = { 1: '#f87171', 2: '#fb923c', 3: '#fbbf24', 4: '#34d399', 5: '#22d3ee', 6: '#a78bfa' }
const TYPE_TO_JC = {
  problem: '1', risk: '2', requirement: '3', assumption: '3',
  decision: '4', question: '5', resource: '5', goal: '6', output: '6',
}

function jcColorToHex(c) {
  if (c == null) return null
  const s = String(c)
  if (/^#/.test(s)) return s
  return JC_TO_HEX[s] || null
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
    const base = { id, x: +n.x || 0, y: +n.y || 0, width: n.width > 0 ? +n.width : null, color: jcColorToHex(n.color) }
    if (n.type === 'file') {
      const file = String(n.file || '')
      blocks.push({ ...base, type: 'resource', title: file.split('/').pop() || 'File', description: '', docRef: { href: file, label: file.split('/').pop() || '', anchor: '' } })
      return
    }
    if (n.type === 'link') {
      const url = String(n.url || '')
      blocks.push({ ...base, type: 'resource', title: url.replace(/^https?:\/\//, '').slice(0, 120) || 'Link', description: '', docRef: { href: url, label: '', anchor: '' } })
      return
    }
    // text node (or unknown): classify it like Brain Dump would.
    const { title, description } = splitText(n.text)
    const cat = categorizeLine(title || '(untitled)')
    blocks.push({ ...base, type: cat.type, title: cat.title || title, description })
    if (cat.confidence === 'low') lowConfidence.push(id)
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

  const nodeIds = new Set(blocks.map(b => b.id))
  const arrows = []
  ;(Array.isArray(data.edges) ? data.edges : []).forEach(e => {
    if (!e || typeof e !== 'object') return
    const from = String(e.fromNode ?? ''), to = String(e.toNode ?? '')
    if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) return
    arrows.push({
      id: String(e.id ?? genId()), from, to,
      label: e.label != null ? String(e.label) : undefined,
      fromPort: ['top', 'right', 'bottom', 'left'].includes(e.fromSide) ? e.fromSide : null,
      toPort: ['top', 'right', 'bottom', 'left'].includes(e.toSide) ? e.toSide : null,
      bidirectional: e.fromEnd === 'arrow',
      style: 'routed',
    })
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
    nodes.push({
      id: b.id, type: 'text',
      x: Math.round(b.x), y: Math.round(b.y),
      width: Math.round(b.width || w || 260), height: Math.round(h || 120),
      color: b.color || TYPE_TO_JC[b.type] || TYPES[b.type]?.color,
      text,
    })
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
      if (a.label) e.label = a.label
      if (a.bidirectional) e.fromEnd = 'arrow'
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

// ── Mermaid flowchart → Pathfinder ───────────────────────────

// Node shapes that carry meaning in flowcharts. Everything else is
// classified from its label, defaulting to a workflow step: a flowchart
// is a workflow, and 'process' beats 'custom' as the honest fallback.
function mermaidNodeType(shape, label) {
  if (shape === 'diamond') return { type: 'decision', confidence: 'high' }
  if (shape === 'circle' || shape === 'stadium') return { type: 'terminator', confidence: 'high' }
  const cat = categorizeLine(label)
  if (cat.confidence === 'high') return { type: cat.type, confidence: 'high' }
  return { type: 'process', confidence: 'low' }
}

// One node token: id plus an optional bracketed label.
const NODE_RE = /^\s*([\w.-]+)\s*(?:(\(\(|\(\[|\[\[|\[\/|\{|\[|\()((?:[^\])}]|\)(?!\)|\]))*?)(\)\)|\]\)|\]\]|\/\]|\}|\]|\)))?\s*$/

function parseNodeToken(tok, reg) {
  const m = tok.match(NODE_RE)
  if (!m) return null
  const id = m[1]
  let label = m[3] != null ? m[3].trim().replace(/^["']|["']$/g, '') : null
  const open = m[2] || ''
  const shape = open === '{' ? 'diamond'
    : open === '((' ? 'circle'
    : open === '([' ? 'stadium'
    : open ? 'rect' : null
  if (!reg.has(id)) reg.set(id, { id, label: label || id, shape: shape || 'plain' })
  else if (label) { const n = reg.get(id); n.label = label; if (shape) n.shape = shape }
  return id
}

export function parseMermaid(text) {
  let body = String(text || '')
  const fence = body.match(/```mermaid\s*\n([\s\S]*?)```/)
  if (fence) body = fence[1]
  const lines = body.split(/\r?\n/).map(l => l.replace(/%%.*$/, '').trim()).filter(Boolean)

  let direction = 'LR'
  const reg = new Map()          // id -> { id, label, shape }
  const edges = []
  const groups = []
  const membership = {}          // nodeId -> groupId
  const groupStack = []

  const EDGE_SPLIT = /\s*(-\.->|-\.-|-->|---|==>|--)\s*(?:\|([^|]*)\|\s*)?/

  lines.forEach(line => {
    const dir = line.match(/^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\b/)
    if (dir) { direction = (dir[1] === 'TB' || dir[1] === 'TD' || dir[1] === 'BT') ? 'TB' : 'LR'; return }
    if (/^(flowchart|graph)\b/.test(line)) return
    const sub = line.match(/^subgraph\s+(?:[\w.-]+\s*\[(.+?)\]|(.+))$/)
    if (sub) {
      const gid = genId()
      groups.push({ id: gid, label: (sub[1] || sub[2] || 'Group').trim().replace(/^["']|["']$/g, '') })
      groupStack.push(gid)
      return
    }
    if (/^end$/i.test(line)) { groupStack.pop(); return }
    if (/^(classDef|class|style|linkStyle|click|direction)\b/.test(line)) return

    // `A -- label --> B` is the long label form; fold it into the |label| one.
    const norm = line.replace(/--\s+([^->|]+?)\s+-->/g, '-->|$1|')
    const parts = norm.split(EDGE_SPLIT)
    // parts: node, op, label?, node, op, label?, node ...
    let prevIds = null
    for (let i = 0; i < parts.length; i += 3) {
      const tokens = String(parts[i] || '').split('&').map(t => t.trim()).filter(Boolean)
      const ids = tokens.map(t => parseNodeToken(t, reg)).filter(Boolean)
      ids.forEach(id => { if (groupStack.length && membership[id] == null) membership[id] = groupStack[groupStack.length - 1] })
      const op = parts[i - 2], label = parts[i - 1]
      if (prevIds && op && ids.length) {
        prevIds.forEach(f => ids.forEach(t => {
          if (f === t) return
          edges.push({
            from: f, to: t,
            label: label ? label.trim() : undefined,
            style: op.includes('.') ? 'dashed' : 'routed',
            weight: op.startsWith('==') ? 3.5 : undefined,
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
    const { type, confidence } = mermaidNodeType(n.shape, n.label)
    if (confidence === 'low') lowConfidence.push(n.id)
    const p = positions.get(n.id) || { x: 0, y: 0 }
    return { id: n.id, type, title: n.label.slice(0, 200), x: p.x, y: p.y, groupId: membership[n.id] || null }
  })
  const arrows = edges.map(e => ({ id: genId(), from: e.from, to: e.to, label: e.label, style: e.style, weight: e.weight }))

  return { payload: { blocks, arrows, groups, meta: { title: '' } }, lowConfidence }
}
