// ════════════════════════════════════════════════════════════
//  export.js — JSON/Markdown export/import
// ════════════════════════════════════════════════════════════

import { state, selection, ui, canvasMeta, saveState } from './state.js'
import { $, TYPES, genId, getAllVotes, SVG_ICONS } from './utils.js'
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
    if (state.blocks[fId] && state.blocks[tId] && fId !== tId) {
      const extra = {}
      if (a.label) extra.label = a.label
      if (a.style) extra.style = a.style
      if (a.weight) extra.weight = a.weight
      if (a.bidirectional) extra.bidirectional = a.bidirectional
      state.arrows.push({ id: genId(), from: fId, to: tId, ...extra })
    }
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
      const tags = []
      if (b.priority) tags.push(b.priority.toUpperCase())
      if (b.status && b.status !== 'not-started') tags.push(b.status)
      md += `### ${b.title}${tags.length ? ' [' + tags.join(', ') + ']' : ''}\n`
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

// ── Export Meeting Summary ───────────────────────────────────
export function exportMeetingSummary() {
  const now = new Date()
  const blocks = Object.values(state.blocks)
  const arrows = state.arrows
  const votes = getAllVotes()

  let md = `# Meeting Summary\n_${now.toLocaleDateString()} at ${now.toLocaleTimeString()}_\n\n`

  // Meeting metadata
  const totalParticipants = new Set(Object.values(votes).flat().map(v => v.userId)).size
  if (totalParticipants > 0) {
    md += `**Participants:** ${totalParticipants}\n\n`
  }

  // Canvas link if shareable
  try {
    const shareUrl = location.origin + location.pathname + location.search + location.hash
    md += `**Canvas:** ${shareUrl}\n\n`
  } catch (e) {}

  // Decisions Made
  const decisions = blocks.filter(b => b.type === 'decision')
  if (decisions.length) {
    md += `## ${SVG_ICONS.decision} Decisions Made\n\n`
    decisions.forEach(b => {
      md += `- **${b.title}**`
      if (b.description) md += `: ${b.description}`
      if (b.notes) md += `\n  *Notes: ${b.notes}*`
      md += `\n`
    })
  } else {
    md += `## ${SVG_ICONS.decision} Decisions Made\n\n_No decision blocks found. Add blocks of type "Decision" to capture decisions here._\n\n`
  }

  // Voting Results (if voting happened)
  const votingBlocks = Object.entries(votes)
    .map(([blockId, voteArray]) => {
      const block = state.blocks[blockId]
      if (!block) return null
      const totalDots = voteArray.reduce((sum, v) => sum + v.dots, 0)
      return { blockId, title: block.title, type: block.type, dots: totalDots }
    })
    .filter(Boolean)
    .sort((a, b) => b.dots - a.dots)

  if (votingBlocks.length) {
    md += `## ${SVG_ICONS.vote} Voting Results\n\n`
    md += `| Rank | Item | Votes |\n|------|------|-------|\n`
    votingBlocks.forEach((item, i) => {
      const typeLabel = TYPES[item.type]?.label || item.type
      md += `| ${i + 1} | ${item.title} (${typeLabel}) | ${item.dots}\n`
    })
    md += `\n`
  }

  // Action Items (blocks with resolve/prepare actions)
  const actionBlocks = blocks.filter(b => b.actions && b.actions.length)
  if (actionBlocks.length) {
    md += `## ${SVG_ICONS.action} Action Items\n\n`
    actionBlocks.forEach(b => {
      b.actions.forEach(action => {
        md += `- [ ] **${b.title}** (${action})`
        if (b.notes) md += `\n  *Context: ${b.notes}*`
        md += `\n`
      })
    })
  } else {
    md += `## ${SVG_ICONS.action} Action Items\n\n_No action items marked. Add actions to blocks (resolve, prepare, etc.) to create action items._\n\n`
  }

  // Open Questions
  const questions = blocks.filter(b => b.type === 'question')
  if (questions.length) {
    md += `## ${SVG_ICONS.question} Open Questions\n\n`
    questions.forEach(b => {
      md += `- ${b.title}`
      if (b.description) md += `: ${b.description}`
      if (b.questions?.length) {
        md += `\n  - ${b.questions.join('\n  - ')}`
      }
      md += `\n`
    })
  } else {
    md += `## ${SVG_ICONS.question} Open Questions\n\n_No questions recorded. Add "Question" blocks to track open questions._\n\n`
  }

  // Resource Inventory
  const resources = blocks.filter(b => b.type === 'resource')
  if (resources.length) {
    md += `## ${SVG_ICONS.resource || SVG_ICONS.star} Available Resources\n\n`
    resources.forEach(b => {
      md += `- ${b.title}`
      if (b.description) md += ` - ${b.description}`
      md += `\n`
    })
    md += `\n`
  }

  // Risks Identified
  const risks = blocks.filter(b => b.type === 'risk')
  if (risks.length) {
    md += `## ${SVG_ICONS.warning} Risks Identified\n\n`
    risks.forEach(b => {
      md += `- **${b.title}**`
      if (b.description) md += `: ${b.description}`
      md += `\n`
    })
    md += `\n`
  }

  // Goals / Objectives
  const goals = blocks.filter(b => b.type === 'goal')
  if (goals.length) {
    md += `## ${SVG_ICONS.target || SVG_ICONS.flag} Goals / Objectives\n\n`
    goals.forEach(b => {
      md += `- ${b.title}`
      if (b.description) md += `: ${b.description}`
      md += `\n`
    })
    md += `\n`
  }

  // Connection Summary
  const connectedCount = arrows.length
  const isolatedCount = blocks.filter(b => {
    const hasIncoming = arrows.some(a => a.to === b.id)
    const hasOutgoing = arrows.some(a => a.from === b.id)
    return !hasIncoming && !hasOutgoing
  }).length

  if (connectedCount > 0 || isolatedCount > 0) {
    md += `## ${SVG_ICONS.link} Connection Summary\n\n`
    md += `- Total connections made: ${connectedCount}\n`
    md += `- Isolated items (no connections): ${isolatedCount}\n`
    md += `- Connected items: ${blocks.length - isolatedCount}\n\n`
  }

  // Next Steps Recommendation
  const emptySections = []
  if (!decisions.length) emptySections.push('Decisions')
  if (!actionBlocks.length) emptySections.push('Action Items')
  if (!questions.length) emptySections.push('Open Questions')

  if (emptySections.length) {
    md += `## ${SVG_ICONS.info} Recommendations\n\nTo improve future meeting summaries:\n`
    if (emptySections.includes('Decisions')) {
      md += `- Add blocks of type "Decision" to capture decisions clearly\n`
    }
    if (emptySections.includes('Action Items')) {
      md += `- Use action badges (resolve, prepare, etc.) to mark tasks\n`
    }
    if (emptySections.includes('Open Questions')) {
      md += `- Add "Question" blocks to track what needs answering\n`
    }
    md += `\n`
  }

  md += `---\n*Summary generated from Pathfinder canvas*\n
**Tips for better meeting summaries:**
1. Use clear, descriptive titles for blocks
2. Add context in descriptions and notes
3. Mark decisions with "Decision" blocks
4. Assign actions using action badges
5. Vote on priorities to see team consensus`

  // Download as markdown
  const blob = new Blob([md], { type: 'text/markdown' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `meeting-summary-${now.toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(a.href)
  return md
}
