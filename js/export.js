// ════════════════════════════════════════════════════════════
//  export.js — JSON/Markdown export/import
// ════════════════════════════════════════════════════════════

import { state, selection, ui, canvasMeta, saveState } from './state.js'
import { $, TYPES, genId } from './utils.js'
import { renderArrows, renderFrames, updateHint, fitView } from './canvas.js'
import { renderBlock, renderInspector } from './render.js'
import { runGapDetection } from './gaps.js'
import { generatePrompt, refreshPrompt } from './prompt.js'

// ── Import JSON ───────────────────────────────────────────────
export function applyImport(data, mode) {
  // mode: 'replace' | 'merge'
  const inBlocks = data.blocks || (Array.isArray(data.blocks) ? data.blocks : Object.values(data.blocks || {}))
  const inArrows = data.arrows || []

  const inGroups = (data.groups && !Array.isArray(data.groups)) ? data.groups : {}

  if (mode === 'replace') {
    state.blocks = {}; state.arrows = []; state.groups = {}
    $.canvasRoot().querySelectorAll('.block').forEach(el => el.remove())
    $.arrowsGroup().innerHTML = ''
    $.framesLayer()?.querySelectorAll('.frame').forEach(el => el.remove())
    selection.ids.clear(); selection.blockId = null; selection.arrowId = null; selection.groupId = null
  }

  // Build ID remap (merge needs fresh IDs to avoid collisions)
  const idMap = {}
  const blocksArr = Array.isArray(inBlocks) ? inBlocks : Object.values(inBlocks)
  blocksArr.forEach(b => {
    const newId = (mode === 'replace') ? b.id : genId()
    idMap[b.id] = newId
    state.blocks[newId] = { ...b, id: newId }
    renderBlock(newId)
  })
  inArrows.forEach(a => {
    const fId = idMap[a.from] || a.from
    const tId = idMap[a.to]   || a.to
    if (state.blocks[fId] && state.blocks[tId] && fId !== tId)
      const extra = {}
      if (a.label) extra.label = a.label
      if (a.style) extra.style = a.style
      if (a.weight) extra.weight = a.weight
      if (a.bidirectional) extra.bidirectional = a.bidirectional
      state.arrows.push({ id: genId(), from: fId, to: tId, ...extra })
  })

  // Import groups, remap IDs on merge
  const groupIdMap = {}
  Object.values(inGroups).forEach(g => {
    const newGid = (mode === 'replace') ? g.id : genId()
    groupIdMap[g.id] = newGid
    state.groups[newGid] = { ...g, id: newGid }
  })
  // Update block groupIds to remapped group IDs
  blocksArr.forEach(b => {
    const newId = idMap[b.id]
    if (b.groupId && state.blocks[newId]) {
      state.blocks[newId].groupId = groupIdMap[b.groupId] || b.groupId
    }
  })

  updateHint()
  requestAnimationFrame(() => {
    renderArrows(); renderFrames(); runGapDetection()
    if (Object.keys(state.blocks).length) fitView()
    renderInspector()
    ui.promptDirty = true; if (ui.activeTab === 'prompt') refreshPrompt()
  })
  saveState()
}

// ── Export JSON ───────────────────────────────────────────────
export function exportJSON() {
  const blob = new Blob([JSON.stringify({ blocks: Object.values(state.blocks), arrows: state.arrows, groups: state.groups, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = 'pathfinder.json'; a.click(); URL.revokeObjectURL(a.href)
}

// ── Export Markdown ──────────────────────────────────────────
export function exportMarkdown() {
  const order   = ['goal','problem','requirement','risk','question','decision','resource','output']
  const headings = { goal:'Goals', problem:'Problems / Blockers', requirement:'Requirements',
    risk:'Risks', question:'Open Questions', decision:'Decisions', resource:'Resources', output:'Outputs' }
  const byType = {}
  Object.values(state.blocks).forEach(b => { (byType[b.type]??=[]).push(b) })
  let md = `# Pathfinder Canvas\n_${new Date().toLocaleDateString()}_\n\n`
  order.forEach(t => {
    const items = byType[t]; if (!items?.length) return
    md += `## ${headings[t]}\n\n`
    items.forEach(b => {
      md += `### ${b.title}\n`
      if (b.description) md += `${b.description}\n\n`
      if (b.actions?.length) md += `**Actions:** ${b.actions.join(', ')}\n\n`
      if (b.questions?.length) { md += `**Open questions:**\n`; b.questions.forEach(q => { md += `- ${q}\n` }); md += '\n' }
      if (b.notes) md += `**Notes:** ${b.notes}\n\n`
    })
  })
  if (state.arrows.length) {
    md += '## Connections\n\n'
    state.arrows.forEach(a => {
      const f = state.blocks[a.from], t = state.blocks[a.to]
      if (f && t) md += `- **${f.title}** \u2192 **${t.title}**\n`
    })
  }
  const blob = new Blob([md], { type: 'text/markdown' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = 'pathfinder.md'; a.click(); URL.revokeObjectURL(a.href)
}

// ── Export copy prompt ───────────────────────────────────────
export function exportCopyPrompt() {
  navigator.clipboard.writeText(generatePrompt())
}
