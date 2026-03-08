// ════════════════════════════════════════════════════════════
//  prompt.js — AI prompt export generation
// ════════════════════════════════════════════════════════════

import { state, ui, devOpts, promptState } from './state.js'
import { $, TYPES, ACTION_DEFS, escHtml, getBlockEl } from './utils.js'
import { runGapDetection } from './gaps.js'

// ── Prompt generation ────────────────────────────────────────
export function generatePrompt() {
  const byType = {}
  Object.values(state.blocks).forEach(b => { (byType[b.type]??=[]).push(b) })

  const fmt = b => {
    let s = `\u2022 ${b.title || '(untitled)'}`
    if (b.description) s += `\n  ${b.description}`
    if ((b.questions||[]).length) {
      s += '\n  Open questions:'
      b.questions.forEach(q => { s += `\n    - ${q}` })
    }
    if ((b.actions||[]).length) s += `\n  Actions: ${b.actions.join(', ')}`
    if (b.notes) s += `\n  Notes: ${b.notes}`
    const el = getBlockEl(b.id)
    if (el?.classList.contains('gap-assumption')) s += '\n  \u26A0 ASSUMPTION GAP: not linked to goal or requirement'
    return s
  }

  const sec = (heading, type) => {
    const items = byType[type]; if (!items?.length) return ''
    return `## ${heading}\n${items.map(fmt).join('\n')}\n`
  }

  const content = [
    sec('Context / Background',                       'context'),
    sec('Project Goals',                    'goal'),
    sec('Problems / Blockers',                        'problem'),
    sec('Requirements',                               'requirement'),
    sec('Risks',                                      'risk'),
    sec('Open Questions (Review Before Assuming)','question'),
    sec('Decisions',                                  'decision'),
    sec('Resources Available',                        'resource'),
    sec('Expected Outputs',                           'output'),
    sec('Custom / Other',                             'custom')
  ].filter(Boolean).join('\n')

  if (!content.trim()) return '(No blocks yet. Add blocks to generate a prompt.)'

  // 1. Mode directive
  const modeDirectives = {
    explore:
      '## Task\nReview this strategy canvas and surface gaps, assumptions, and missing connections. ' +
      'Ask clarifying questions rather than proposing solutions. Highlight what is unclear or contradictory.\n',
    plan:
      '## Task\nReview this strategy canvas and produce a phased implementation plan. ' +
      'Break work into concrete phases with clear outputs for each. Flag any assumptions you are making.\n',
    build:
      '## Task\nImplement the plan described in this canvas. Produce working code. ' +
      'For each requirement, include acceptance criteria. Use the dependency connections to order your work.\n',
    clarify:
      '## Task\nDo NOT implement or plan yet. Identify what is ambiguous, missing, or contradictory ' +
      'and return a prioritized list of clarifying questions.\n\n' +
      'Group questions by: Requirements, Architecture, Scope, Risk, Conflicts.\n' +
      'For each question, cite the specific canvas block it comes from.\n' +
      'Mark each as [BLOCKING], [IMPORTANT], or [NICE TO HAVE].\n' +
      'Return no more than 15 questions, prioritized by blocking status.\n' +
      'Close with a one-paragraph Readiness Assessment.\n'
  }
  let prompt = (modeDirectives[devOpts.mode] || modeDirectives.plan) + '\n'

  // 2. Dev option instructions
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

  // 3. Canvas content
  prompt += '---\n\n# Project Canvas\n\n' + content

  // 4. Connections (typed)
  if (state.arrows.length) {
    prompt += '\n## Connections\n'
    state.arrows.forEach(a => {
      const f = state.blocks[a.from], t = state.blocks[a.to]
      if (f && t) {
        const via = a.label ? ` [${a.label}]` : ''
        prompt += `\u2022 ${TYPES[f.type]?.label} "${f.title}"${via} \u2192 ${TYPES[t.type]?.label} "${t.title}"\n`
      }
    })
  }

  // 5. Groups — named clusters of blocks
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

  // 6. Action legend — explain action badges if any block uses them
  const usedActions = new Set()
  Object.values(state.blocks).forEach(b => (b.actions||[]).forEach(a => usedActions.add(a)))
  if (usedActions.size) {
    prompt += '\n## Action Labels\nBlocks may carry action labels indicating their status:\n'
    usedActions.forEach(a => {
      prompt += `\u2022 **${a}**: ${ACTION_DEFS[a] || a}\n`
    })
  }

  // 6. Gap details
  const { count: gapCount, details: gapDetails } = runGapDetection()
  if (gapCount) {
    const gapLabels = {
      'gap-isolated':     'no connections: not linked to anything on the canvas',
      'gap-assumption':   'assumption gap: question not linked to a Goal or Requirement',
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

  // Blocks without descriptions (only significant if canvas has substance)
  if (n > 3) {
    const noDesc = blocks.filter(b => !b.description?.trim()).length
    score -= Math.min(noDesc * 1.5, 15)
  }

  // No goal block when canvas has content
  const hasGoal = blocks.some(b => b.type === 'goal')
  if (!hasGoal && n >= 3) score -= 12

  // Goals without requirements
  const goals = blocks.filter(b => b.type === 'goal')
  const reqs  = blocks.filter(b => b.type === 'requirement')
  if (goals.length > 0 && reqs.length === 0) score -= 8

  // Connection bonus: reward well-connected canvases
  if (n > 1) {
    const connected = new Set([...state.arrows.flatMap(a => [a.from, a.to])])
    score += Math.round((connected.size / n) * 10)
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
