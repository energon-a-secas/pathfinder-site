// ════════════════════════════════════════════════════════════
//  spec-export.js: the Spec bundle. One zip, five Markdown
//  files, in the shape spec-driven development tools expect:
//  spec.md / plan.md / tasks.md (the Spec Kit style layout),
//  requirements.md (the same requirements in EARS form for
//  Kiro-style tooling), and a README that says what it all is.
//
//  Everything is built from the canvas: acceptance criteria come
//  from block.criteria, decision rationale from block.rationale,
//  ordering from the connections (the same layering Tidy and the
//  Workflow section use). Nothing is invented; a missing input
//  is marked [NEEDS INPUT] rather than filled with a guess.
// ════════════════════════════════════════════════════════════

import { state, canvasMeta } from './state.js'
import { PRIORITY_DEFS, showToast } from './utils.js'
import { situationSection } from './prompt.js'
import { mermaidBlock } from './export.js'
import { breakCycles, assignLayers } from './layout.js'

const byType = () => {
  const m = {}
  Object.values(state.blocks).forEach(b => { (m[b.type] ??= []).push(b) })
  return m
}

const title = () => (canvasMeta.title || '').trim() || 'Untitled canvas'

const priTag = b => b.priority ? ` [${(PRIORITY_DEFS[b.priority]?.label || b.priority).toUpperCase()}]` : ''

/** Layer index per block over the whole graph, for dependency ordering. */
function layerMap() {
  const ids = Object.keys(state.blocks)
  const edges = state.arrows
    .filter(a => state.blocks[a.from] && state.blocks[a.to])
    .map(a => ({ from: a.from, to: a.to }))
  const { acyclic } = breakCycles(ids, edges)
  return assignLayers(ids, acyclic).layer
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 }

function criteriaChecklist(b, indent = '') {
  if (!(b.criteria || []).length) return `${indent}- [ ] [NEEDS INPUT: acceptance criteria]\n`
  return b.criteria.map(c => `${indent}- [ ] ${c}\n`).join('')
}

function questionLines(b) {
  return (b.questions || []).map(q => {
    const ans = q.answer?.trim()
    return ans
      ? `- ${q.text}\n  - Answered: ${ans.replace(/\n/g, ' ')}\n`
      : `- [NEEDS CLARIFICATION] ${q.text}\n`
  }).join('')
}

// ── The five files ───────────────────────────────────────────

function readmeMd(now) {
  const n = Object.keys(state.blocks).length
  return `# Spec bundle

Generated from a Pathfinder canvas ("${title()}", ${n} block${n === 1 ? '' : 's'}, ${state.arrows.length} connection${state.arrows.length === 1 ? '' : 's'}) on ${now.toISOString().slice(0, 10)}.
Pathfinder: https://pathfinder.neorgon.com/

Files:

- spec.md: what to build. Goals, requirements with acceptance criteria, open
  questions marked [NEEDS CLARIFICATION], assumptions and risks.
- plan.md: how, and under what constraints. The situation, decisions with
  their rationale, resources, context, and the dependency graph.
- tasks.md: the ordered checklist, sequenced by the dependency order drawn
  on the canvas.
- requirements.md: the same requirements restated in EARS form
  ("THE SYSTEM SHALL ..."), for tools that expect Kiro-style specs.

The spec/plan/tasks split follows the common spec-driven development shape,
so the files drop into a Spec Kit style workflow. Nothing in this bundle is
verified: it is a plan somebody drew. Anything marked [NEEDS INPUT] or
[NEEDS CLARIFICATION] must be settled by a person, not invented.
`
}

function specMd() {
  const t = byType()
  let md = `# ${title()}: specification\n\n`
  md += `> A plan exported from Pathfinder, not a record of what exists. Open\n> questions are marked [NEEDS CLARIFICATION]; assumptions are unverified bets.\n\n`
  const brief = (canvasMeta.contextBrief || '').trim()
  if (brief) md += `## Summary\n\n${brief}\n\n`

  if (t.goal?.length) {
    md += `## Goals\n\n`
    t.goal.forEach((b, i) => {
      md += `### G${i + 1}. ${b.title || '(untitled)'}${priTag(b)}\n`
      if (b.description) md += `${b.description}\n`
      md += `\nDone when:\n${criteriaChecklist(b)}\n`
    })
  }
  if (t.requirement?.length) {
    md += `## Requirements\n\n`
    t.requirement.forEach((b, i) => {
      md += `### R${i + 1}. ${b.title || '(untitled)'}${priTag(b)}\n`
      if (b.description) md += `${b.description}\n`
      md += `\nAcceptance criteria:\n${criteriaChecklist(b)}`
      const q = questionLines(b)
      if (q) md += `\nOpen points:\n${q}`
      md += '\n'
    })
  }
  if (t.output?.length) {
    md += `## Deliverables\n\n`
    t.output.forEach((b, i) => {
      md += `### D${i + 1}. ${b.title || '(untitled)'}${priTag(b)}\n`
      if (b.description) md += `${b.description}\n`
      md += `\nDone when:\n${criteriaChecklist(b)}\n`
    })
  }
  if (t.assumption?.length) {
    md += `## Assumptions (validate before building)\n\n`
    t.assumption.forEach(b => {
      md += `- **${b.title || '(untitled)'}**${b.description ? `: ${b.description}` : ''}\n`
    })
    md += '\n'
  }
  if (t.risk?.length) {
    md += `## Risks\n\n`
    t.risk.forEach(b => {
      md += `- **${b.title || '(untitled)'}**${b.description ? `: ${b.description}` : ''}\n`
    })
    md += '\n'
  }
  if (t.question?.length) {
    md += `## Open questions\n\n`
    t.question.forEach(b => {
      md += `- [NEEDS CLARIFICATION] ${b.title || '(untitled)'}${b.description ? ` (${b.description})` : ''}\n`
    })
    md += '\n'
  }
  return md
}

function planMd() {
  const t = byType()
  let md = `# ${title()}: plan\n\n`
  md += situationSection()
  if (t.decision?.length) {
    md += `## Decisions\n\n`
    t.decision.forEach(b => {
      md += `### ${b.title || '(untitled)'}\n`
      if (b.description) md += `${b.description}\n`
      md += b.rationale?.trim()
        ? `\n**Rationale:** ${b.rationale.trim()}\n\n`
        : `\n**Rationale:** [NEEDS INPUT: why this choice, what was rejected]\n\n`
    })
  }
  if (t.resource?.length) {
    md += `## Resources\n\n`
    t.resource.forEach(b => { md += `- **${b.title || '(untitled)'}**${b.description ? `: ${b.description}` : ''}\n` })
    md += '\n'
  }
  if (t.context?.length) {
    md += `## Context\n\n`
    t.context.forEach(b => { md += `- **${b.title || '(untitled)'}**${b.description ? `: ${b.description}` : ''}\n` })
    md += '\n'
  }
  const flow = [...(t.process || []), ...(t.terminator || [])]
  if (flow.length) {
    const layer = layerMap()
    const ordered = flow.sort((a, b) => (layer.get(a.id) ?? 0) - (layer.get(b.id) ?? 0))
    md += `## Workflow\n\n`
    ordered.forEach(b => { md += `- ${b.title || '(untitled)'}${b.type === 'terminator' ? ' (start/end)' : ''}\n` })
    md += '\n'
  }
  const graph = mermaidBlock()
  if (graph) md += `## Structure\n\n${graph}`
  return md
}

function tasksMd() {
  const t = byType()
  const items = [...(t.requirement || []), ...(t.output || [])]
  let md = `# ${title()}: tasks\n\n`
  md += `> Sequenced by the dependency order drawn on the canvas. Work top to\n> bottom; a task's criteria are its definition of done.\n\n`
  if (!items.length) {
    md += `No requirement or output blocks on the canvas yet, so there are no\ntasks to list. Add them in Pathfinder and export again.\n`
    return md
  }
  const layer = layerMap()
  const ordered = items.sort((a, b) =>
    ((layer.get(a.id) ?? 0) - (layer.get(b.id) ?? 0)) ||
    ((PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)))
  const taskIds = new Set(items.map(b => b.id))
  ordered.forEach(b => {
    md += `- [ ]${priTag(b)} ${b.title || '(untitled)'}\n`
    if (b.description) md += `      ${b.description.replace(/\n/g, '\n      ')}\n`
    const after = state.arrows
      .filter(a => a.to === b.id && taskIds.has(a.from))
      .map(a => state.blocks[a.from]?.title).filter(Boolean)
    if (after.length) md += `      after: ${after.join('; ')}\n`
    md += criteriaChecklist(b, '      ')
  })
  return md
}

// A criterion that already opens with an EARS keyword is kept verbatim; the
// rest get the ubiquitous form. Nothing is parsed into triggers we cannot know.
const EARS_OPENERS = /^(WHEN|WHILE|IF|WHERE|THE SYSTEM)\b/i

function requirementsMd() {
  const t = byType()
  let md = `# ${title()}: requirements (EARS)\n\n`
  md += `> The requirements from spec.md restated in EARS form for Kiro-style\n> tooling. A criterion already phrased with WHEN / WHILE / IF / WHERE is\n> kept verbatim; the rest use the ubiquitous "THE SYSTEM SHALL" form.\n\n`
  const reqs = t.requirement || []
  if (!reqs.length) {
    md += `No requirement blocks on the canvas yet.\n`
    return md
  }
  reqs.forEach((b, i) => {
    md += `### R${i + 1}: ${b.title || '(untitled)'}${priTag(b)}\n\n`
    md += `**User story:** ${b.description?.trim() || '[NEEDS INPUT: who needs this and why]'}\n\n`
    md += `#### Acceptance criteria\n\n`
    if ((b.criteria || []).length) {
      b.criteria.forEach((c, j) => {
        const line = EARS_OPENERS.test(c) ? c : `THE SYSTEM SHALL ${c}`
        md += `${j + 1}. ${line}\n`
      })
    } else {
      md += `1. [NEEDS INPUT: acceptance criteria]\n`
    }
    md += '\n'
  })
  return md
}

/** Build the bundle's files. Exported separately so tests can read them. */
export function buildSpecFiles(now = new Date()) {
  return [
    { name: 'README.md', data: readmeMd(now) },
    { name: 'spec.md', data: specMd() },
    { name: 'plan.md', data: planMd() },
    { name: 'tasks.md', data: tasksMd() },
    { name: 'requirements.md', data: requirementsMd() },
  ]
}

export async function exportSpecBundle() {
  if (!Object.keys(state.blocks).length) {
    showToast('Add blocks first; an empty spec helps nobody', 'warning')
    return
  }
  const { buildZip } = await import('./zip.js')
  const bytes = buildZip(buildSpecFiles())
  const blob = new Blob([bytes], { type: 'application/zip' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'pathfinder-spec.zip'
  a.click()
  URL.revokeObjectURL(a.href)
  showToast('Spec bundle downloaded: spec, plan, tasks, EARS requirements', 'success', 2600)
}
