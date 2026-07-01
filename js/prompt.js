// ════════════════════════════════════════════════════════════
//  prompt.js — AI prompt export generation
// ════════════════════════════════════════════════════════════

import { state, ui, devOpts, promptState, canvasMeta } from './state.js'
import { $, TYPES, ACTION_DEFS, STATUS_DEFS, PRIORITY_DEFS, escHtml } from './utils.js'
import { runGapDetection } from './gaps.js'

// ── Prompt generation ────────────────────────────────────────
export function generatePrompt() {
  const mode = devOpts.mode || 'plan'
  const byType = {}
  Object.values(state.blocks).forEach(b => { (byType[b.type]??=[]).push(b) })

  const incomingCount = id => state.arrows.filter(a => a.to === id).length

  const fmt = b => {
    const tags = []
    if (b.priority) tags.push(PRIORITY_DEFS[b.priority]?.label?.toUpperCase() || b.priority)
    if (b.status && b.status !== 'not-started') tags.push(STATUS_DEFS[b.status]?.label?.toUpperCase() || b.status)
    const tagStr = tags.length ? ` [${tags.join('] [')}]` : ''
    let s = `\u2022${tagStr} ${b.title || '(untitled)'}`
    if (b.description) s += `\n  ${b.description}`
    if ((b.questions||[]).length) {
      s += '\n  Open questions:'
      b.questions.forEach(q => { s += `\n    - ${q}` })
    }
    if ((b.actions||[]).length) s += `\n  Actions: ${b.actions.join(', ')}`
    if (b.notes) s += `\n  Notes: ${b.notes}`
    return s
  }

  const sec = (heading, type) => {
    const items = byType[type]; if (!items?.length) return ''
    return `## ${heading}\n${items.map(fmt).join('\n')}\n`
  }

  // Build mode renders requirements + outputs as an actionable task checklist,
  // ordered by priority then by how many things depend on them.
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }
  const taskSection = (heading, type) => {
    const items = byType[type]; if (!items?.length) return ''
    const ordered = [...items].sort((a, b) => {
      const pr = (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
      if (pr !== 0) return pr
      return incomingCount(b.id) - incomingCount(a.id)
    })
    let out = `## ${heading}\n`
    ordered.forEach(b => {
      const pri = b.priority ? ` [${PRIORITY_DEFS[b.priority]?.label?.toUpperCase() || b.priority}]` : ''
      out += `- [ ]${pri} ${b.title || '(untitled)'}\n`
      if (b.description) out += `      ${b.description}\n`
      out += `      Acceptance criteria: [NEEDS INPUT: acceptance criteria]\n`
    })
    return out
  }

  // Workflow section: process + terminator nodes rendered as an ordered
  // step sequence. Ordering follows arrows between flow nodes (a light
  // topological pass), falling back to canvas order for anything unlinked.
  const flowSection = () => {
    const flow = Object.values(state.blocks).filter(b => b.type === 'process' || b.type === 'terminator')
    if (!flow.length) return ''
    const flowIds = new Set(flow.map(b => b.id))
    const nextOf = id => state.arrows.filter(a => a.from === id && flowIds.has(a.to)).map(a => a.to)
    const indeg = {}
    flow.forEach(b => { indeg[b.id] = 0 })
    state.arrows.forEach(a => { if (flowIds.has(a.from) && flowIds.has(a.to)) indeg[a.to]++ })
    const ordered = []
    const seen = new Set()
    // Start from nodes with no incoming flow edge (natural entry points),
    // preferring terminators so a "Start" leads. Then walk forward.
    const roots = flow.filter(b => indeg[b.id] === 0)
      .sort((a, b) => (a.type === 'terminator' ? -1 : 0) - (b.type === 'terminator' ? -1 : 0))
    const walk = id => {
      if (seen.has(id)) return
      seen.add(id); ordered.push(state.blocks[id])
      nextOf(id).forEach(walk)
    }
    roots.forEach(r => walk(r.id))
    flow.forEach(b => { if (!seen.has(b.id)) walk(b.id) }) // cycles / islands
    let out = '## Workflow (end-to-end)\n'
    ordered.forEach((b, i) => {
      const kind = b.type === 'terminator' ? '◆' : `${i + 1}.`
      out += `${kind} ${b.title || '(untitled)'}\n`
      if (b.description) out += `      ${b.description.replace(/\n/g, '\n      ')}\n`
    })
    return out
  }

  // Section builders keyed by intent, so each mode can choose order + form.
  const S = {
    context:      () => sec('Context / Background', 'context'),
    goals:        () => sec('Project Goals', 'goal'),
    problems:     () => sec('Problems / Blockers', 'problem'),
    requirements: () => sec('Requirements', 'requirement'),
    reqTasks:     () => taskSection('Requirements (as tasks)', 'requirement'),
    assumptions:  () => sec('Assumptions (validate before building)', 'assumption'),
    risks:        () => sec('Risks', 'risk'),
    questions:    () => sec('Open Questions (Review Before Assuming)', 'question'),
    decisions:    () => sec('Decisions', 'decision'),
    resources:    () => sec('Resources Available', 'resource'),
    outputs:      () => sec('Expected Outputs', 'output'),
    outputTasks:  () => taskSection('Expected Outputs (as deliverables)', 'output'),
    flow:         () => flowSection(),
    custom:       () => sec('Custom / Other', 'custom'),
  }

  // Per-mode section order. Explore/Clarify front-load the unknowns; Build
  // turns requirements/outputs into checklists and drops framing-only types.
  const ORDERS = {
    plan:    ['context','goals','problems','requirements','assumptions','risks','questions','decisions','resources','outputs','flow','custom'],
    explore: ['assumptions','questions','goals','problems','requirements','risks','context','decisions','resources','outputs','flow','custom'],
    build:   ['goals','reqTasks','assumptions','problems','risks','decisions','flow','outputTasks'],
    clarify: ['questions','assumptions','goals','problems','requirements','risks','decisions','context','flow'],
  }
  const order = ORDERS[mode] || ORDERS.plan
  const content = order.map(k => S[k] && S[k]()).filter(Boolean).join('\n')

  if (!content.trim()) return '(No blocks yet. Add blocks to generate a prompt.)'

  // 1. Mode directive
  const modeDirectives = {
    explore:
      '## Task\nReview this strategy canvas and surface gaps, assumptions, and missing connections. ' +
      'Ask clarifying questions rather than proposing solutions. Highlight what is unclear or contradictory. ' +
      'Start from the Assumptions and Open Questions below \u2014 they are where this plan is weakest.\n',
    plan:
      '## Task\nReview this strategy canvas and produce a phased implementation plan. ' +
      'Break work into concrete phases with clear outputs for each. Flag any assumptions you are making.\n',
    build:
      '## Task\nImplement the plan described in this canvas. Produce working code. ' +
      'Work through the Requirements checklist below in order. For each requirement, include acceptance criteria \u2014 ' +
      'where they are marked [NEEDS INPUT], do NOT invent them; ask first. Use the dependency connections to order your work.\n',
    clarify:
      '## Task\nDo NOT implement or plan yet. Identify what is ambiguous, missing, or contradictory ' +
      'and return a prioritized list of clarifying questions.\n\n' +
      'Group questions by: Requirements, Architecture, Scope, Risk, Conflicts.\n' +
      'For each question, cite the specific canvas block it comes from.\n' +
      'Mark each as [BLOCKING], [IMPORTANT], or [NICE TO HAVE].\n' +
      'Return no more than 15 questions, prioritized by blocking status.\n' +
      'Close with a one-paragraph Readiness Assessment.\n'
  }
  let prompt = (modeDirectives[mode] || modeDirectives.plan) + '\n'

  // Standing directive: assumptions are bets, not facts.
  if (byType.assumption?.length) {
    prompt += 'Treat each Assumption below as believed-true-until-disproven; explicitly confirm or challenge each one before relying on it.\n\n'
  }

  // 2. Dev option instructions \u2014 suppressed in Clarify (no implementation yet)
  if (mode !== 'clarify') {
    const preMap = {
      tasks:      'Define all tasks with clear acceptance criteria.',
      edge:       'Include handling for edge cases.',
      errors:     'Add proper error handling throughout.',
      docs:       'Document all key functions with inline comments.',
      security:   'Consider security implications for each component.',
      typescript: 'Use TypeScript types and interfaces.'
    }
    const preLines = []
    devOpts.prePrompts.forEach(k => { if (preMap[k]) preLines.push(preMap[k]) })

    const toneMap = { formal:'Please respond in a formal, professional tone.', casual:'Keep the tone conversational and accessible.', technical:'Use precise technical language and focus on implementation details.' }
    if (devOpts.tone !== 'auto' && toneMap[devOpts.tone]) preLines.push(toneMap[devOpts.tone])

    const detailMap = { brief:'Keep responses concise and high-level.', detailed:'Provide comprehensive, detailed explanations.' }
    if (devOpts.detail !== 'standard' && detailMap[devOpts.detail]) preLines.push(detailMap[devOpts.detail])

    if (preLines.length) prompt += preLines.join('\n') + '\n\n'
  }

  // 3. Block type legend (makes prompt self-contained for AI)
  const usedTypes = new Set(Object.values(state.blocks).map(b => b.type))
  if (usedTypes.size) {
    prompt += '## Block Type Legend\n'
    const typeDefs = {
      goal: 'Strategic objective to achieve',
      problem: 'Blocker or issue requiring resolution',
      requirement: 'Hard constraint that must be satisfied',
      assumption: 'A belief being treated as true without validation \u2014 pressure-test it',
      risk: 'Potential failure point requiring mitigation',
      question: 'A genuine unknown needing an answer',
      decision: 'Choice already made (rationale should be documented)',
      resource: 'Available asset, tool, or capability',
      output: 'Expected deliverable or result',
      process: 'A step or action in a workflow',
      terminator: 'The start or end of a workflow',
      context: 'Background information for framing',
      custom: 'Free-form block',
    }
    usedTypes.forEach(t => {
      prompt += `\u2022 **${TYPES[t]?.label || t}**: ${typeDefs[t] || t}\n`
    })
    prompt += '\n'
  }

  // 4. Canvas content \u2014 titled by the canvas, with the engagement framing first
  const title = (canvasMeta.title || '').trim() || 'Project Canvas'
  prompt += `---\n\n# ${title}\n\n`
  const brief = (canvasMeta.contextBrief || '').trim()
  if (brief) prompt += `## Engagement Context\n${brief}\n\n`
  prompt += content

  // 5. Connections (typed)
  if (state.arrows.length) {
    prompt += '\n## Connections\n'
    state.arrows.forEach(a => {
      const f = state.blocks[a.from], t = state.blocks[a.to]
      if (f && t) {
        const via = a.label ? ` [${a.label}]` : ''
        prompt += `\u2022 ${TYPES[f.type]?.label} "${f.title}"${via} \u2192 ${TYPES[t.type]?.label} "${t.title}"\n`
        if (a.note?.trim()) prompt += `    ${a.note.trim().replace(/\n/g, '\n    ')}\n`
      }
    })
  }

  // 6. Groups — named clusters of blocks
  const groups = Object.values(state.groups || {})
  if (groups.length) {
    prompt += '\n## Groups\n'
    groups.forEach(g => {
      const members = Object.values(state.blocks).filter(b => b.groupId === g.id)
      if (members.length) {
        prompt += `\u2022 **${g.label || '(unnamed group)'}**: ${members.map(b => `"${b.title || '(untitled)'}"`).join(', ')}\n`
      }
    })
  }

  // 7. Action legend — explain action badges if any block uses them
  const usedActions = new Set()
  Object.values(state.blocks).forEach(b => (b.actions||[]).forEach(a => usedActions.add(a)))
  if (usedActions.size) {
    prompt += '\n## Action Labels\nBlocks may carry action labels indicating their status:\n'
    usedActions.forEach(a => {
      prompt += `\u2022 **${a}**: ${ACTION_DEFS[a] || a}\n`
    })
  }

  // 8. Gap details
  const { count: gapCount, details: gapDetails } = runGapDetection()
  if (gapCount) {
    const gapLabels = {
      'gap-isolated':     'no connections: not linked to anything on the canvas',
      'gap-assumption':   'unvalidated assumption: not linked to a Goal or Requirement and not flagged to validate',
      'gap-no-req':       'no requirement: goal has no linked requirement',
      'gap-unaddressed':  'unaddressed: problem with no resolve action and no outgoing links'
    }
    prompt += '\n## Planning Gaps Detected\n'
    gapDetails.forEach(g => {
      g.gaps.forEach(gapType => {
        prompt += `\u2022 ${TYPES[g.type]?.label}: "${g.title}" \u2014 ${gapLabels[gapType]}\n`
      })
    })
  }

  return prompt.trim()
}

// ── Canvas health score ───────────────────────────────────────
export function computeHealthScore() {
  const blocks = Object.values(state.blocks)
  const n = blocks.length
  if (n === 0) return null

  let score = 100
  const { count: gapCount } = runGapDetection()

  // Gap penalty
  score -= Math.min(gapCount * 8, 40)

  // Empty descriptions are the honest signal of a hollow canvas: a block with
  // only a title gives the AI almost nothing. Penalize every empty block (no
  // size gate), weighting the load-bearing types the AI most needs filled in.
  const HEAVY = new Set(['goal', 'requirement', 'output'])
  const noDescPenalty = blocks
    .filter(b => !b.description?.trim())
    .reduce((sum, b) => sum + (HEAVY.has(b.type) ? 6 : 3), 0)
  score -= Math.min(noDescPenalty, 45)

  // No goal block when canvas has content
  const hasGoal = blocks.some(b => b.type === 'goal')
  if (!hasGoal && n >= 3) score -= 12

  // Goals without requirements
  const goals = blocks.filter(b => b.type === 'goal')
  const reqs  = blocks.filter(b => b.type === 'requirement')
  if (goals.length > 0 && reqs.length === 0) score -= 8

  // Connection bonus: reward canvases that are both connected AND described.
  // Title-only blocks don't earn the bonus even when wired together, so a
  // skeleton can't coast to a green score on structure alone.
  if (n > 1) {
    const described = new Set(blocks.filter(b => b.description?.trim()).map(b => b.id))
    const connectedAndDescribed = new Set(
      state.arrows.flatMap(a => [a.from, a.to]).filter(id => described.has(id))
    )
    score += Math.round((connectedAndDescribed.size / n) * 10)
  }

  return Math.max(0, Math.min(100, Math.round(score)))
}

// ── Prompt diff ───────────────────────────────────────────────
export function markExported() {
  promptState.lastSnapshot = JSON.stringify({
    blocks: Object.fromEntries(Object.entries(state.blocks).map(([id, b]) => [id, { title: b.title, type: b.type, description: b.description }])),
    arrowPairs: state.arrows.map(a => `${a.from}→${a.to}`)
  })
}

function getPromptDiff() {
  if (!promptState.lastSnapshot) return null
  const prev = JSON.parse(promptState.lastSnapshot)
  const prevBlocks = prev.blocks || {}
  const currBlocks = state.blocks
  const prevPairs  = new Set(prev.arrowPairs || [])
  const currPairs  = new Set(state.arrows.map(a => `${a.from}→${a.to}`))

  const added    = Object.keys(currBlocks).filter(id => !prevBlocks[id]).map(id => currBlocks[id].title || '(untitled)')
  const removed  = Object.keys(prevBlocks).filter(id => !currBlocks[id]).map(id => prevBlocks[id].title || '(untitled)')
  const modified = Object.keys(currBlocks).filter(id =>
    prevBlocks[id] && (currBlocks[id].title !== prevBlocks[id].title || currBlocks[id].description !== prevBlocks[id].description || currBlocks[id].type !== prevBlocks[id].type)
  ).map(id => currBlocks[id].title || '(untitled)')
  const addedArrows   = [...currPairs].filter(p => !prevPairs.has(p)).length
  const removedArrows = [...prevPairs].filter(p => !currPairs.has(p)).length

  if (!added.length && !removed.length && !modified.length && !addedArrows && !removedArrows) return null
  return { added, removed, modified, addedArrows, removedArrows }
}

// ── Refresh prompt panel ─────────────────────────────────────
export function refreshPrompt() {
  if (!ui.promptDirty) return
  $.promptOutput().value = generatePrompt()

  const bCount = Object.keys(state.blocks).length
  const aCount = state.arrows.length
  const { count: gCount } = runGapDetection()
  $.promptSummary().innerHTML = bCount === 0
    ? 'No blocks yet.'
    : `<strong>${bCount}</strong> block${bCount!==1?'s':''} \u00B7 <strong>${aCount}</strong> connection${aCount!==1?'s':''}`
      + (gCount ? ` \u00B7 <span class="gap-badge">\u26A0 ${gCount} gap${gCount!==1?'s':''}</span>` : '')

  // Health score
  const healthBar = document.getElementById('healthBar')
  if (healthBar) {
    const score = computeHealthScore()
    if (score === null) {
      healthBar.style.display = 'none'
    } else {
      const grade = score >= 80 ? 'a' : score >= 50 ? 'b' : 'c'
      const label = score >= 80 ? 'Healthy' : score >= 50 ? 'Needs attention' : 'Critical gaps'
      const tips  = []
      if (gCount)                                                      tips.push(`${gCount} gap${gCount>1?'s':''}`)
      if (!Object.values(state.blocks).some(b => b.type === 'goal') && bCount >= 3) tips.push('no goal defined')
      if (Object.values(state.blocks).filter(b => !b.description?.trim()).length > 2) tips.push('blocks missing descriptions')
      healthBar.style.display = ''
      healthBar.innerHTML =
        `<div class="health-score grade-${grade}">${score}</div>` +
        `<div class="health-details"><strong>${label}</strong>` +
        (tips.length ? `<br>${tips.join(' \u00B7 ')}` : '') +
        `</div>`
    }
  }

  // Prompt diff
  const diffEl = document.getElementById('promptDiff')
  if (diffEl) {
    const diff = getPromptDiff()
    if (!diff) {
      diffEl.style.display = 'none'
    } else {
      const parts = []
      if (diff.added.length)    parts.push(`<span class="diff-added">+${diff.added.length} block${diff.added.length>1?'s':''}</span>`)
      if (diff.removed.length)  parts.push(`<span class="diff-removed">\u2212${diff.removed.length} removed</span>`)
      if (diff.modified.length) parts.push(`<span class="diff-changed">~${diff.modified.length} modified</span>`)
      if (diff.addedArrows)     parts.push(`<span class="diff-added">+${diff.addedArrows} connection${diff.addedArrows>1?'s':''}</span>`)
      if (diff.removedArrows)   parts.push(`<span class="diff-removed">\u2212${diff.removedArrows} connection${diff.removedArrows>1?'s':''} removed</span>`)
      diffEl.style.display = ''
      diffEl.innerHTML = `<div class="prompt-diff-title">Changes since last export</div>${parts.join(' \u00B7 ')}`
    }
  }

  ui.promptDirty = false
}
