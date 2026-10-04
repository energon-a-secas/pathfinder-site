import { dependencyEdges, connectionLabel, impliedVerb, relationOf } from './relations.js'
// ════════════════════════════════════════════════════════════
//  prompt.js: AI prompt export generation
// ════════════════════════════════════════════════════════════

import { state, ui, devOpts, promptState, canvasMeta, serializeCanvas } from './state.js'
import { $, TYPES, ACTION_DEFS, STATUS_DEFS, PRIORITY_DEFS, SITUATION_FIELDS, SITUATION_DEFAULT, typeInfo, askedQuestions } from './utils.js'
import { runGapDetection, GAP_META, FINDING_ACKS, nextEmptyStep } from './gaps.js'
import { breakCycles, assignLayers } from './layout.js'
import { taskChecklist, mitigationIndex, cardAnswer, IMPLIED_MITIGATION } from './task-plan.js'

/**
 * The block types each prompt section prints. `tasks` is the Build checklist,
 * so it takes every type the registry marks as a task; `flow` is the
 * workflow walk over process steps and triggers.
 */
export const PROMPT_SECTION_TYPES = {
  context: ['context'], stakeholders: ['stakeholder'], goals: ['goal'], metrics: ['metric'],
  problems: ['problem'], requirements: ['requirement'], work: ['implementation'],
  tasks: Object.keys(TYPES).filter(t => TYPES[t].task),
  assumptions: ['assumption'], risks: ['risk'], questions: ['question'], decisions: ['decision'],
  resources: ['resource'], outputs: ['output'], flow: ['process', 'terminator'], custom: ['custom'],
}

/**
 * Per-mode section order. Every mode lists every type: a type missing from an
 * order used to vanish from that prompt (Clarify dropped resources, outputs
 * and custom), and the registry coverage test now fails if one ever does
 * again. Explore and Clarify front-load the unknowns; Build folds
 * requirements, outputs and work items into the task checklist.
 */
export const PROMPT_ORDERS = {
  plan:    ['context','stakeholders','goals','metrics','problems','requirements','work','assumptions','risks','questions','decisions','resources','outputs','flow','custom'],
  investigate: ['context','problems','metrics','questions','assumptions','stakeholders','goals','requirements','work','risks','decisions','resources','flow','outputs','custom'],
  explore: ['assumptions','questions','goals','metrics','stakeholders','problems','requirements','work','risks','context','decisions','resources','outputs','flow','custom'],
  build:   ['context','goals','metrics','stakeholders','tasks','assumptions','problems','risks','questions','decisions','resources','flow','custom'],
  clarify: ['questions','assumptions','goals','metrics','stakeholders','problems','requirements','work','risks','decisions','context','resources','outputs','flow','custom'],
}

/**
 * What an arrow says, in two parts: `stated`, the author's label or
 * relation, and `implied`, the verb its endpoint types imply when nobody
 * labelled it (an Implementation "satisfies" a Requirement), kept apart so
 * it is never passed off as the author's words. An `informs` or `related`
 * relation only says the arrow sets no task order, so beside an implied
 * verb it reads as that ("context only") instead of as a second verb:
 * "[informs] [implied: owns]" made two claims that disagree.
 */
export function connectionReading(a, f, t) {
  const stated = connectionLabel(a)
  const implied = f && t && !(a.label || '').trim() ? impliedVerb(f.type, t.type) : ''
  if (!implied) return { stated, implied: '' }
  const rel = a.relation ? relationOf(a) : ''
  if (rel === 'informs' || rel === 'related') return { stated: '', implied: `${implied}; context only` }
  return { stated, implied }
}

/** One connection line for the prompt. */
export function connectionLine(a, blocks = state.blocks) {
  const f = blocks[a.from], t = blocks[a.to]
  if (!f || !t) return ''
  const { stated, implied } = connectionReading(a, f, t)
  let via = stated ? ` [${stated}]` : ''
  if (implied) via += ` [implied: ${implied}]`
  const arrow = a.bidirectional ? '↔' : '→'
  return `• ${typeInfo(f.type).label} "${f.title}"${via} ${arrow} ${typeInfo(t.type).label} "${t.title}"`
}

/**
 * One line per gap an author accepted (block.gapAck), labelled from GAP_META
 * where this build knows the rule. Read from the blocks, not from gap
 * detection, so an acceptance still reaches the reader once detection
 * suppresses the gap itself.
 *
 * `firing` is the set of `blockId|gapId` pairs whose rule still fires. An
 * acceptance whose gap has since been fixed (a requirement that gained
 * criteria) is left out: listing it would tell the reader "done is
 * undefined" beside the criteria that define it. A rule this build does not
 * know cannot be re-checked, so it is listed as the author left it. Without
 * `firing`, every acceptance is listed.
 */
export function acceptedGapLines(blocks = state.blocks, firing = null) {
  return Object.values(blocks).flatMap(b => (b.gapAck || [])
    .filter(gapType => !firing || !GAP_META[gapType] || firing.has(`${b.id}|${gapType}`))
    .map(gapType => {
      const what = GAP_META[gapType]?.prompt || GAP_META[gapType]?.short || gapType
      return `• ${typeInfo(b.type).label}: "${b.title || '(untitled)'}": ${what}`
    }))
}

/**
 * The `blockId|gapId` pairs a gap-detection result says still fire. Reads
 * both shapes: a detector that reports accepted gaps apart (`accepted`,
 * one { id, gap } each) and one that reports them among the rest.
 */
export function firingGaps({ details = [], accepted = [] } = {}) {
  return new Set([
    ...details.flatMap(d => (d.gaps || []).map(g => `${d.id}|${g}`)),
    ...(accepted || []).map(a => `${a.id}|${a.gap}`),
  ])
}

/**
 * The standing brief: what this document is, and where the reader is standing.
 *
 * A canvas handed over without this gets acted on wrongly. An assistant with
 * the repository open should go read it rather than take the canvas at face
 * value; one in a chat window should not pretend it has. This section says
 * which of those is true before the plan gets a chance to imply otherwise.
 */
export function situationSection() {
  const sit = { ...SITUATION_DEFAULT, ...(canvasMeta.situation || {}) }
  const lines = [
    'This is a planning canvas exported from Pathfinder. It is a plan, not a codebase, and not a record of what exists. Everything below is what somebody mapped out; none of it is verified unless this section says otherwise.',
  ]

  const pick = (field, key) => SITUATION_FIELDS[field]?.options?.[key]?.line
  const codebase = pick('codebase', sit.codebase)
  if (codebase) {
    const hint = (sit.repoHint || '').trim()
    lines.push(codebase + (hint ? ` The code in question: ${hint}.` : ''))
  }
  const runtime = pick('runtime', sit.runtime)
  if (runtime) lines.push(runtime)
  const firstMove = pick('firstMove', sit.firstMove)
  if (firstMove) lines.push(firstMove)

  let out = '## Situation\n' + lines.map(l => `- ${l}`).join('\n') + '\n'

  const constraints = (sit.constraints || '').trim()
  if (constraints) {
    out += '\n### Constraints and boundaries\n' + constraints.split(/\r?\n/)
      .map(l => l.trim()).filter(Boolean).map(l => `- ${l}`).join('\n') + '\n'
  }
  return out + '\n'
}

// ── Prompt generation ────────────────────────────────────────
export function generatePrompt() {
  const mode = devOpts.mode || 'plan'
  const byType = {}
  Object.values(state.blocks).forEach(b => { (byType[b.type]??=[]).push(b) })

  // Who mitigates each risk, read from the drawing (relations.js), so a risk
  // is never handed over without the work that answers it.
  const { byRisk: mitigations } = mitigationIndex(state.blocks, state.arrows)
  const nameOf = id => `${state.blocks[id].title || '(untitled)'} (${typeInfo(state.blocks[id].type).label})`

  const fmt = b => {
    const tags = []
    if (b.priority) tags.push(PRIORITY_DEFS[b.priority]?.label?.toUpperCase() || b.priority)
    if (b.status && b.status !== 'not-started') tags.push(STATUS_DEFS[b.status]?.label?.toUpperCase() || b.status)
    const tagStr = tags.length ? ` [${tags.join('] [')}]` : ''
    let s = `\u2022${tagStr} ${b.title || '(untitled)'}`
    if (b.description) s += `\n  ${b.description}`
    // A block's own answer: an Open Question card's, or one kept from when a
    // retyped block was a question.
    const own = String(b.answer ?? '').trim()
    if (own) s += `\n  Answer: ${own.replace(/\n/g, '\n  ')}`
    if (b.type === 'risk' && mitigations.has(b.id)) {
      // What the author wrote, then what only the endpoint types suggest,
      // labelled as such: a risk is never handed over as covered on a guess.
      const all = mitigations.get(b.id), names = list => list.map(m => nameOf(m.id)).join('; ')
      const stated = all.filter(m => !m.implied), implied = all.filter(m => m.implied)
      if (stated.length) s += `\n  Mitigated by: ${names(stated)}`
      if (implied.length) s += `\n  Mitigated by (${IMPLIED_MITIGATION}): ${names(implied)}`
    }
    if ((b.criteria || []).length) {
      s += `\n  ${typeInfo(b.type).criteria || 'Acceptance criteria'}:`
      b.criteria.forEach(c => { s += `\n    - ${c}` })
    }
    if (b.rationale?.trim()) s += `\n  Rationale: ${b.rationale.trim().replace(/\n/g, '\n  ')}`
    if (b.docRef && (b.docRef.href || b.docRef.label)) {
      const ref = b.docRef.label || b.docRef.href
      const anchor = b.docRef.anchor ? `#${b.docRef.anchor}` : ''
      s += `\n  Referenced doc: ${ref}${b.docRef.href && b.docRef.label ? ` (${b.docRef.href}${anchor})` : anchor}`
    }
    // Questions raised on the block: the open ones, then the answered ones,
    // each under a heading that says which they are.
    const asked = askedQuestions(b)
    const open = asked.filter(q => !q.answer?.trim()), answered = asked.filter(q => q.answer?.trim())
    if (open.length) {
      s += '\n  Open questions:'
      open.forEach(q => { s += `\n    - ${q.text}` })
    }
    if (answered.length) {
      s += '\n  Answered questions:'
      answered.forEach(q => {
        s += `\n    - ${q.text}`
        s += `\n      Answer: ${q.answer.trim().replace(/\n/g, '\n      ')}`
      })
    }
    if ((b.actions||[]).length) s += `\n  Actions: ${b.actions.join(', ')}`
    if (b.notes) s += `\n  Notes: ${b.notes}`
    return s
  }

  // Headings come from the registry, so a type can never print as undefined.
  const sec = type => {
    const items = byType[type]; if (!items?.length) return ''
    return `## ${typeInfo(type).section}\n${items.map(fmt).join('\n')}\n`
  }

  const taskSection = () => {
    const checklist = taskChecklist(state.blocks, state.arrows)
    return checklist ? `## Implementation checklist\n${checklist}` : ''
  }

  // Open Question cards: the open ones under the registry's heading, the
  // answered ones under their own, so an answer is never handed over as an
  // unknown still waiting (and the reader does not ask it again).
  const questionSection = () => {
    const items = byType.question; if (!items?.length) return ''
    const open = items.filter(b => !cardAnswer(b)), answered = items.filter(b => cardAnswer(b))
    let out = ''
    if (open.length) out += `## ${typeInfo('question').section}\n${open.map(fmt).join('\n')}\n`
    if (answered.length) {
      out += `${out ? '\n' : ''}## Answered Questions\nAnswers recorded on the map. Rely on them rather than asking again, and say so if you find one is wrong.\n`
      out += `${answered.map(fmt).join('\n')}\n`
    }
    return out
  }

  // Workflow section: process + terminator nodes as an ordered sequence.
  // Ordering uses the whole graph, not just flow-to-flow arrows: two steps
  // linked through a Problem between them still land in the right order,
  // which the old flow-only walk got wrong ("Fixed and proven" printed
  // before the step that reproduces). Start terminators lead, end
  // terminators close, and only process steps carry numbers.
  const flowSection = () => {
    const flow = Object.values(state.blocks).filter(b => b.type === 'process' || b.type === 'terminator')
    if (!flow.length) return ''
    const ids = Object.keys(state.blocks)
    const edges = dependencyEdges(state.blocks, state.arrows)
    const { acyclic } = breakCycles(ids, edges)
    const { layer } = assignLayers(ids, acyclic)
    const outDeg = {}
    flow.forEach(b => { outDeg[b.id] = 0 })
    edges.forEach(a => { if (outDeg[a.from] != null) outDeg[a.from]++ })
    // Terminators with outgoing arrows open the flow; ones without close it.
    const rank = b => b.type === 'terminator' ? (outDeg[b.id] ? -1 : 1) : 0
    const ordered = [...flow].sort((a, b) =>
      ((layer.get(a.id) ?? 0) - (layer.get(b.id) ?? 0)) ||
      (rank(a) - rank(b)) ||
      (a.title || '').localeCompare(b.title || ''))
    let out = '## Workflow (end-to-end)\n'
    let step = 0
    ordered.forEach(b => {
      const kind = b.type === 'terminator' ? '◆' : `${++step}.`
      out += `${kind} ${b.title || '(untitled)'}\n`
      if (b.description) out += `      ${b.description.replace(/\n/g, '\n      ')}\n`
    })
    return out
  }

  // Section builders keyed by intent, so each mode can choose order + form.
  // PROMPT_SECTION_TYPES records which block types each one prints.
  const S = {
    context:      () => sec('context'),
    stakeholders: () => sec('stakeholder'),
    goals:        () => sec('goal'),
    metrics:      () => sec('metric'),
    problems:     () => sec('problem'),
    requirements: () => sec('requirement'),
    work:         () => sec('implementation'),
    tasks:        () => taskSection(),
    assumptions:  () => sec('assumption'),
    risks:        () => sec('risk'),
    questions:    () => questionSection(),
    decisions:    () => sec('decision'),
    resources:    () => sec('resource'),
    outputs:      () => sec('output'),
    flow:         () => flowSection(),
    custom:       () => sec('custom'),
  }
  const order = PROMPT_ORDERS[mode] || PROMPT_ORDERS.plan
  const covered = new Set(order.flatMap(k => PROMPT_SECTION_TYPES[k] || []))
  // Safety net for a type the orders do not name (an unknown id in a
  // hand-written canvas): print it under its own heading rather than drop it.
  const extra = Object.keys(byType).filter(t => !covered.has(t)).map(t => sec(t))
  const content = [...order.map(k => S[k] && S[k]()), ...extra].filter(Boolean).join('\n')

  if (!content.trim()) return '(No blocks yet. Add blocks to generate a prompt.)'

  // 1. Mode directive
  const modeDirectives = {
    investigate:
      '## Task\nInvestigate. Establish what is actually true before anything is changed or proposed. ' +
      'Work outward from the Problems and Open Questions below.\n\n' +
      'For each finding, state the evidence you based it on. Where you could not establish something, say so plainly ' +
      'rather than filling the gap with a plausible guess: an unmarked guess in an investigation is worse than an ' +
      'admitted unknown.\n' +
      'Where this canvas and reality disagree, report the disagreement; do not quietly reconcile it.\n' +
      'Do not write fixes yet. Close with what you would need in order to be sure.\n',
    explore:
      '## Task\nReview this strategy canvas and surface gaps, assumptions, and missing connections. ' +
      'Ask clarifying questions rather than proposing solutions. Highlight what is unclear or contradictory. ' +
      'Start from the Assumptions and Open Questions below; they are where this plan is weakest.\n',
    plan:
      '## Task\nReview this strategy canvas and produce a phased implementation plan. ' +
      'Break work into concrete phases with clear outputs for each. Flag any assumptions you are making.\n',
    build:
      '## Task\nImplement the plan described in this canvas. Produce working code. ' +
      'Work through the Implementation checklist below in dependency order. Priorities break ties between available tasks. ' +
      'Checked tasks are already marked done on the canvas; verify their claims against the code rather than reimplementing them. ' +
      'Do not treat blocked tasks as ready: resolve their blockers first. For each requirement, include acceptance criteria; ' +
      'where they are marked [NEEDS INPUT], do NOT invent them; ask first. ' +
      'A work item listed with "satisfies:" is done when that requirement\'s criteria hold. ' +
      'Resolve blocking questions and circular dependencies before implementing the affected work.\n',
    clarify:
      '## Task\nDo NOT implement or plan yet. Identify what is ambiguous, missing, or contradictory ' +
      'and return a prioritized list of clarifying questions.\n\n' +
      'Group questions by: Requirements, Architecture, Scope, Risk, Conflicts.\n' +
      'For each question, cite the specific canvas block it comes from.\n' +
      'Mark each as [BLOCKING], [IMPORTANT], or [NICE TO HAVE].\n' +
      'Return no more than 15 questions, prioritized by blocking status.\n' +
      'Close with a one-paragraph Readiness Assessment.\n'
  }
  let prompt = situationSection() + (modeDirectives[mode] || modeDirectives.plan) + '\n'

  // Standing directive: assumptions are bets, not facts. When the reader can
  // actually reach the code, checking beats asking, and saying so is the
  // difference between a useful answer and a list of questions.
  if (byType.assumption?.length) {
    const sit = { ...SITUATION_DEFAULT, ...(canvasMeta.situation || {}) }
    const canCheck = sit.codebase === 'current' && (sit.runtime === 'code' || sit.runtime === 'ide')
    prompt += 'Treat each Assumption below as believed-true-until-disproven. Confirm or challenge each one explicitly before relying on it.\n'
    prompt += canCheck
      ? 'Several of them are probably settleable from the repository you have open. Check those against the code and label each result verified or still open, rather than asking about something you could have read.\n\n'
      : 'You cannot verify these from here, so do not treat any of them as established. Say which ones would change the plan most if they turned out to be wrong.\n\n'
  }

  // 2. Dev option instructions, suppressed in Clarify (no implementation yet)
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

  // 3. Block type legend (makes prompt self-contained for AI). The lines live
  // in the type registry, next to everything else a type means, and print in
  // registry order (Why, Who, Proof, What, How, Doubt) rather than in the
  // order blocks happened to be created.
  const usedTypes = new Set(Object.values(state.blocks).map(b => b.type))
  if (usedTypes.size) {
    prompt += '## Block Type Legend\n'
    const ordered = [...Object.keys(TYPES).filter(t => usedTypes.has(t)), ...[...usedTypes].filter(t => !Object.hasOwn(TYPES, t))]
    ordered.forEach(t => {
      prompt += `\u2022 **${typeInfo(t).label}**: ${typeInfo(t).legend}\n`
    })
    prompt += '\n'
  }

  // 4. Canvas content, titled by the canvas, with the engagement framing first
  const title = (canvasMeta.title || '').trim() || 'Project Canvas'
  prompt += `---\n\n# ${title}\n\n`
  const brief = (canvasMeta.contextBrief || '').trim()
  if (brief) prompt += `## Engagement Context\n${brief}\n\n`
  prompt += content

  // 5. Connections (typed; an unlabelled arrow prints the verb its endpoint
  // types imply, marked as implied)
  if (state.arrows.length) {
    prompt += '\n## Connections\n'
    state.arrows.forEach(a => {
      const line = connectionLine(a)
      if (line) {
        prompt += line + '\n'
        if (a.note?.trim()) prompt += `    ${a.note.trim().replace(/\n/g, '\n    ')}\n`
      }
    })
  }

  // 6. Groups: named clusters of blocks
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

  // 7. Action legend: explain action badges if any block uses them
  const usedActions = new Set()
  Object.values(state.blocks).forEach(b => (b.actions||[]).forEach(a => usedActions.add(a)))
  if (usedActions.size) {
    prompt += '\n## Action Labels\nBlocks may carry action labels indicating their status:\n'
    usedActions.forEach(a => {
      prompt += `\u2022 **${a}**: ${ACTION_DEFS[a] || a}\n`
    })
  }

  // 8. Gap details. Labels come from GAP_META so the prompt, the breakdown
  // and the docs cannot drift apart.
  // A gap the author accepted (block.gapAck) is not an open finding: it is
  // listed on its own below, so the reader neither re-raises it nor loses it.
  const gapResult = runGapDetection()
  const { details: gapDetails, canvasFindings } = gapResult
  const isAccepted = (id, gapType) => (state.blocks[id]?.gapAck || []).includes(gapType)
  const openGaps = gapDetails.flatMap(g => g.gaps.filter(gapType => !isAccepted(g.id, gapType)).map(gapType => ({ g, gapType })))
  if (openGaps.length || (canvasFindings || []).length) {
    prompt += '\n## Planning Gaps Detected\n'
    openGaps.forEach(({ g, gapType }) => {
      prompt += `\u2022 ${typeInfo(g.type).label}: "${g.title}": ${GAP_META[gapType]?.prompt || gapType}\n`
    })
    ;(canvasFindings || []).forEach(f => { prompt += `\u2022 Canvas: ${f}\n` })
  }
  const accepted = acceptedGapLines(state.blocks, firingGaps(gapResult))
  if (accepted.length) {
    prompt += '\n## Accepted gaps\nThe author reviewed these and chose to leave them as they are. Do not raise them again as findings; mention one only if it now blocks the work.\n'
    accepted.forEach(line => { prompt += line + '\n' })
  }

  // 9. The way back. The canvas absorbs results through a small patch format;
  // asking for it here is what turns a one-shot export into a round trip.
  prompt += '\n## When you reply\n'
  prompt += 'End your reply with a fenced ```pathfinder-patch``` code block (JSON; spec: ' +
    'https://pathfinder.neorgon.com/llms.txt) carrying: answers to the open questions, each ' +
    'assumption marked verified or refuted with its evidence, status changes, new acceptance ' +
    'criteria, and any new blocks wired to existing ones. Address blocks by the ids below; ' +
    'do not invent answers you do not have. To answer an Open Question card, give its id and leave out "question". ' +
    'For a refuted assumption, add "decision": the statement that is true instead, which becomes the card\'s title. ' +
    'For new arrows, set relation to precedes, depends-on, blocks, informs, or related. depends-on means the target is a prerequisite; informs and related do not set task order.\n' +
    // The ids, not the labels: a label ("Trigger / End") is what a person
    // reads, the id is what the patch must carry.
    `A new block's type is one of: ${Object.keys(TYPES).join(', ')}.\n`
  prompt += '\n### Block ids\n'
  Object.values(state.blocks).forEach(b => {
    prompt += `\u2022 ${b.id}: ${(b.title || '(untitled)').slice(0, 60)}\n`
  })

  return prompt.trim()
}

// ── Grounded per-question prompt ──────────────────────────────
// Turns one question on one block into a focused, self-contained prompt: the
// question, the block it hangs off, its referenced doc, its 1-hop neighbors
// (with arrow labels), and the canvas engagement brief. Enough context for an
// assistant to answer THIS question without the whole canvas.
export function buildQuestionPrompt(block, question) {
  const q = question || (block.questions || [])[0] || { text: '' }
  const brief = (canvasMeta.contextBrief || '').trim()
  const title = (canvasMeta.title || '').trim() || 'Project Canvas'

  const describe = b => {
    let s = `${typeInfo(b.type).label}: "${b.title || '(untitled)'}"`
    if (b.description?.trim()) s += `\n  ${b.description.trim().replace(/\n/g, '\n  ')}`
    return s
  }

  const neighbors = []
  state.arrows.forEach(a => {
    if (a.from === block.id && state.blocks[a.to]) neighbors.push({ b: state.blocks[a.to], dir: '→', label: connectionLabel(a) })
    if (a.to === block.id && state.blocks[a.from]) neighbors.push({ b: state.blocks[a.from], dir: '←', label: connectionLabel(a) })
  })

  let p = '## Task\n'
  p += 'Answer the specific question below using the surrounding context. If the context is insufficient, say what is missing rather than guessing.\n\n'
  if (brief) p += `## Engagement Context\n${brief}\n\n`
  p += `## Question\n${q.text.trim() || '(no question text)'}\n\n`
  p += `## This relates to\n${describe(block)}\n`

  if (block.docRef && (block.docRef.href || block.docRef.label)) {
    const ref = block.docRef.label || block.docRef.href
    const anchor = block.docRef.anchor ? `#${block.docRef.anchor}` : ''
    p += `\n## Referenced documentation\n${ref}${block.docRef.href && block.docRef.label ? `, ${block.docRef.href}${anchor}` : anchor}\n`
    p += 'If you can access this document, ground your answer in it.\n'
  }

  if (neighbors.length) {
    p += '\n## Connected blocks\n'
    neighbors.forEach(n => {
      const via = n.label ? ` [${n.label}]` : ''
      p += `${n.dir}${via} ${describe(n.b).replace(/\n/g, '\n   ')}\n`
    })
  }

  const otherQs = (block.questions || []).filter(x => x !== q && x.text?.trim())
  if (otherQs.length) {
    p += '\n## Other open questions on this block (for context, do not answer)\n'
    otherQs.forEach(x => { p += `- ${x.text.trim()}\n` })
  }

  p += `\n(From the "${title}" strategy canvas.)`
  return p.trim()
}

// ── Canvas health score ───────────────────────────────────────
// No longer drawn: since 2026-10-03 the Brief tab says what is open in one
// readiness line (js/brief.js), counted the way the Attention tab counts,
// instead of grading the map with a number. Kept as an API, with its tests.
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

  // Nothing on the map says why the work exists. A Problem answers the Why
  // as well as a Goal does, the same test as the canvas "no Why" finding,
  // so a problem-rooted map is not docked for a goal it does not need.
  const hasWhy = blocks.some(b => TYPES[b.type]?.step === 'why')
  if (!hasWhy && n >= 3) score -= 12

  // Goals with nothing under them anywhere on the map. A metric or the work
  // itself counts, matching the gap-no-req rule.
  const goals = blocks.filter(b => b.type === 'goal')
  const support = blocks.filter(b => ['requirement', 'metric', 'implementation'].includes(b.type))
  if (goals.length > 0 && support.length === 0) score -= 8

  // Untyped blocks. Other has no gap rule, so without this a map imported as
  // mostly Other scored higher than the same map typed honestly: removing
  // meaning raised the score. Each one costs what a gap costs, since whatever
  // gap it has is hidden from every check.
  const untyped = blocks.filter(b => b.type === 'custom').length
  score -= Math.min(untyped * 8, 40)

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
function promptSnapshot() {
  const blocks = Object.fromEntries(Object.entries(state.blocks).map(([id, b]) => [id, {
    title: b.title || '', type: b.type, description: b.description || '', notes: b.notes || '',
    status: b.status || 'not-started', priority: b.priority || null,
    actions: b.actions || [], criteria: b.criteria || [], questions: b.questions || [],
    rationale: b.rationale || '', docRef: b.docRef || null, groupId: b.groupId || null,
    answer: b.answer || '',
  }]))
  const arrows = Object.fromEntries(state.arrows.map(a => [JSON.stringify([a.from, a.to]), {
    relation: a.relation || null, label: a.label || '', note: a.note || '', bidirectional: !!a.bidirectional,
  }]))
  const { title, contextBrief, situation, prompt } = serializeCanvas().meta
  const groups = Object.values(state.groups || {}).map(g => ({ id: g.id, label: g.label || '' }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return { blocks, arrows, groups, meta: { title, contextBrief, situation, prompt } }
}

export function markExported() {
  promptState.lastSnapshot = JSON.stringify(promptSnapshot())
}

export function getPromptDiff() {
  if (!promptState.lastSnapshot) return null
  const prev = JSON.parse(promptState.lastSnapshot)
  const curr = promptSnapshot()
  const prevBlocks = prev.blocks || {}
  const currBlocks = curr.blocks
  const prevPairs = new Set(Object.keys(prev.arrows || {}))
  const currPairs = new Set(Object.keys(curr.arrows))

  const added    = Object.keys(currBlocks).filter(id => !prevBlocks[id]).map(id => currBlocks[id].title || '(untitled)')
  const removed  = Object.keys(prevBlocks).filter(id => !currBlocks[id]).map(id => prevBlocks[id].title || '(untitled)')
  const modified = Object.keys(currBlocks).filter(id =>
    prevBlocks[id] && JSON.stringify(currBlocks[id]) !== JSON.stringify(prevBlocks[id])
  ).map(id => currBlocks[id].title || '(untitled)')
  const addedArrows   = [...currPairs].filter(p => !prevPairs.has(p)).length
  const removedArrows = [...prevPairs].filter(p => !currPairs.has(p)).length
  const modifiedArrows = [...currPairs].filter(p => prevPairs.has(p) && JSON.stringify(curr.arrows[p]) !== JSON.stringify(prev.arrows[p])).length
  const framingChanged = JSON.stringify(curr.meta) !== JSON.stringify(prev.meta)
  const groupsChanged = JSON.stringify(curr.groups) !== JSON.stringify(prev.groups)

  if (!added.length && !removed.length && !modified.length && !addedArrows && !removedArrows && !modifiedArrows && !framingChanged && !groupsChanged) return null
  return { added, removed, modified, addedArrows, removedArrows, modifiedArrows, framingChanged, groupsChanged }
}

// ── Refresh the Brief tab ────────────────────────────────────
// The Brief tab draws itself (js/brief.js registers its renderer here, so
// this module holds no pane markup). Without a renderer, as in the test
// harness, the plain output field is filled instead.
let briefRenderer = null
export function setBriefRenderer(fn) { briefRenderer = typeof fn === 'function' ? fn : null }

export function refreshPrompt() {
  if (!ui.promptDirty) return
  try {
    if (briefRenderer) briefRenderer()
    else {
      const out = $.promptOutput()
      if (out && 'value' in out) out.value = generatePrompt()
    }
  } finally {
    ui.promptDirty = false
  }
}

// ── Brief helpers: size, outline, scope ───────────────────────

/**
 * Characters per token for Markdown, measured on Claude's own output
 * (tokenizer.json, `measured.markdown`), and how far a whole-text estimate
 * from that table lands from the real count (`error_bar_note`): half of
 * estimates within 20.7% (the median), three in four within 28.4% (p75).
 * An estimate, said as one: the Brief tab prints "about", never a count.
 */
export const CHARS_PER_TOKEN = 2.99
export const TOKEN_ERROR = 0.207
export const TOKEN_ERROR_P75 = 0.284

export function estimateTokens(text) {
  const n = String(text || '').length
  return n ? Math.max(1, Math.round(n / CHARS_PER_TOKEN)) : 0
}

/** An estimate rounded to what it can claim: tens under 1,000, hundreds above. */
export function roundTokens(n) {
  if (!n) return 0
  return n < 1000 ? Math.max(10, Math.round(n / 10) * 10) : Math.round(n / 100) * 100
}

/** "640 tokens", "2.4k tokens", "18k tokens": the short form for a label. */
export function formatTokens(n) {
  const r = roundTokens(n)
  if (r < 1000) return `${r} tokens`
  return `${r < 10000 ? (r / 1000).toFixed(1).replace(/\.0$/, '') : Math.round(r / 1000)}k tokens`
}

/**
 * The brief's headings, in order: `# ` (the map's title) and `## `
 * (sections), each with the line it starts on and how many top-level
 * items it lists. Fenced code is skipped, so a fence in a description
 * cannot invent a section.
 */
export function briefOutline(text) {
  const out = []
  let cur = null, fence = false
  String(text || '').split('\n').forEach((line, i) => {
    if (/^\s*```[\w-]*\s*$/.test(line)) { fence = !fence; return }
    if (fence) return
    const h = line.match(/^(#{1,2}) (\S.*)$/)
    if (h) { cur = { level: h[1].length, title: h[2].trim(), line: i, items: 0 }; out.push(cur); return }
    if (cur && /^(?:•|-|\d+\.|◆) /.test(line)) cur.items++
  })
  return out
}

/** How many `## ` sections a brief has. */
export function briefSectionCount(text) {
  return briefOutline(text).filter(s => s.level === 2).length
}

/**
 * The part of the map a scoped brief covers: the selected blocks plus every
 * block one connection away from them.
 */
export function briefScope(ids, blocks = state.blocks, arrows = state.arrows) {
  const selected = new Set([...(ids || [])].filter(id => blocks[id]))
  const scope = new Set(selected)
  arrows.forEach(a => {
    if (!blocks[a.from] || !blocks[a.to]) return
    if (selected.has(a.from)) scope.add(a.to)
    if (selected.has(a.to)) scope.add(a.from)
  })
  return { selected, scope, neighbours: scope.size - selected.size, total: Object.keys(blocks).length }
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

/**
 * The gap sections of a scoped brief, from the whole map's detection result
 * (`whole`, a runGapDetection result) limited to the blocks in `scope`. A
 * gap is a claim about the map, so it is never re-checked on the part: a
 * risk mitigated by a block outside the scope is not "unmitigated".
 * Written the way generatePrompt writes its own; the brief tests hold the
 * two to the same text for a scope that covers the map.
 */
export function scopedGapText(whole, scope, blocks = state.blocks, acceptedIntro = '') {
  const acked = (id, gap) => (blocks[id]?.gapAck || []).includes(gap)
  const open = (whole.details || []).filter(d => scope.has(d.id))
    .flatMap(d => d.gaps.filter(g => !acked(d.id, g))
      .map(g => `• ${typeInfo(d.type).label}: "${d.title}": ${GAP_META[g]?.prompt || g}`))
  // A finding about the whole map (no ids) stands as it is, and so does one
  // whose blocks are all in the part. One that names blocks partly outside
  // it would quote titles the brief says not to refer to: it is said once
  // per block in the part instead, in the words its acceptance uses, which
  // name no other block.
  const findings = (whole.findings || []).flatMap(f => {
    const ids = f.ids || []
    if (!ids.length || ids.every(id => scope.has(id))) return [`• Canvas: ${f.text}`]
    const ack = FINDING_ACKS[f.kind]
    if (!ack || !GAP_META[ack]) return ids.some(id => scope.has(id)) ? [`• Canvas: ${f.text}`] : []
    return ids.filter(id => scope.has(id) && blocks[id] && !acked(id, ack))
      .map(id => `• ${typeInfo(blocks[id].type).label}: "${blocks[id].title || '(untitled)'}": ${GAP_META[ack].prompt}`)
  })
  let out = ''
  if (open.length || findings.length) out += '\n## Planning Gaps Detected\n' + [...open, ...findings].join('\n') + '\n'
  const inScope = Object.fromEntries(Object.keys(blocks).filter(id => scope.has(id)).map(id => [id, blocks[id]]))
  const accepted = acceptedGapLines(inScope, firingGaps(whole))
  if (accepted.length) out += '\n## Accepted gaps\n' + (acceptedIntro ? acceptedIntro + '\n' : '') + accepted.join('\n') + '\n'
  return out
}

/**
 * The Build checklist with only the selected blocks' tasks. A neighbour is
 * in a scoped brief to be read, not built, so its task leaves the list (its
 * title can still appear in an "after:" line, as context). A note line
 * ("Not ordered by the map", the cycle warning) stays only while a task it
 * introduces does. Items are found by the checklist's own shape: a line
 * that opens `- [ ]` or `- [x]`, then its `Block: <id> (<Type>)` line.
 */
export function focusChecklist(body, selected) {
  const segs = []
  String(body || '').split('\n').forEach(line => {
    const cur = segs[segs.length - 1]
    if (/^- \[[ xX]\]/.test(line)) segs.push({ item: true, lines: [line], id: null })
    else if (!line.trim() || /^\s/.test(line)) {
      if (cur) cur.lines.push(line); else segs.push({ item: false, lines: [line] })
    } else segs.push({ item: false, lines: [line] })
    const last = segs[segs.length - 1]
    if (last.item && !last.id) { const m = line.match(/^\s+Block: (\S+) \(/); if (m) last.id = m[1] }
  })
  const keep = segs.map(s => !s.item || !s.id || selected.has(s.id))
  // A note stays while some kept task follows it.
  for (let i = segs.length - 1, after = false; i >= 0; i--) {
    if (segs[i].item) { after = after || keep[i]; continue }
    if (segs[i].lines.some(l => l.trim())) keep[i] = after
  }
  const tasks = segs.filter((s, i) => s.item && keep[i]).length
  const text = segs.filter((_, i) => keep[i]).flatMap(s => s.lines).join('\n')
    .replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '')
  return { text: tasks ? text + '\n' : '', tasks, dropped: segs.filter((s, i) => s.item && !keep[i]).length }
}

/** Swap one `## ` section's body (heading kept) for what `fn` returns; '' drops the section. */
function replaceSection(text, heading, fn) {
  const head = `## ${heading}\n`
  const at = text.startsWith(head) ? 0 : (text.indexOf(`\n${head}`) + 1 || -1)
  if (at < 0) return text
  const from = at + head.length
  const next = text.indexOf('\n## ', from - 1)
  const end = next < 0 ? text.length : next + 1
  const body = fn(text.slice(from, end))
  return body ? text.slice(0, from) + body + (end < text.length ? '\n' : '') + text.slice(end)
    : text.slice(0, at) + text.slice(end)
}

/** Cut one `## ` section (heading to the next `## ` or the end) out of a brief. */
function cutSection(text, heading) {
  const at = text.indexOf(`\n## ${heading}\n`)
  if (at < 0) return { text, body: '' }
  const next = text.indexOf('\n## ', at + 4)
  const end = next < 0 ? text.length : next
  return { text: text.slice(0, at) + text.slice(end), body: text.slice(at, end) }
}

/**
 * A brief for part of the map: the selected blocks and their direct
 * neighbours, said to be partial in its own `## Scope` section, so the
 * reader neither treats the rest of the map as empty nor touches it. The
 * block-id list, the connections and the checklist cover only the scope;
 * the gap sections come from the whole map. With nothing selected, or a
 * scope that covers every block, it is the whole brief.
 */
export function generateScopedPrompt(ids) {
  const all = state.blocks, arrows = state.arrows
  const { selected, scope, neighbours, total } = briefScope(ids, all, arrows)
  if (!selected.size || scope.size >= total) return generatePrompt()
  const whole = runGapDetection()
  let text
  try {
    state.blocks = Object.fromEntries(Object.keys(all).filter(id => scope.has(id)).map(id => [id, all[id]]))
    state.arrows = arrows.filter(a => scope.has(a.from) && scope.has(a.to))
    text = generatePrompt()
  } finally {
    state.blocks = all
    state.arrows = arrows
    // The generator painted the part's gaps on its cards: paint the map's.
    runGapDetection()
  }

  // Swap the part's gap sections for the whole map's.
  const cutGaps = cutSection(text, 'Planning Gaps Detected')
  const cutAcc = cutSection(cutGaps.text, 'Accepted gaps')
  const intro = cutAcc.body.split('\n')[2] || ''
  const acceptedIntro = intro.startsWith('•') ? '' : intro
  text = cutAcc.text
  const gaps = scopedGapText(whole, scope, all, acceptedIntro ||
    'The author reviewed these and chose to leave them as they are. Do not raise them again as findings; mention one only if it now blocks the work.')
  const reply = text.indexOf('\n## When you reply\n')
  text = reply < 0 ? text + '\n' + gaps : text.slice(0, reply) + gaps + text.slice(reply)

  // The checklist is the selection's work only: a neighbour is context.
  let droppedTasks = 0, keptTasks = 0
  text = replaceSection(text, 'Implementation checklist', body => {
    const r = focusChecklist(body, selected)
    droppedTasks = r.dropped; keptTasks = r.tasks
    return r.text
  })

  // Say it is partial, and which blocks it is about, before the task.
  const name = id => `"${(all[id].title || '(untitled)').slice(0, 60)}" (${id})`
  const order = Object.keys(all)
  const focus = order.filter(id => selected.has(id))
  const context = order.filter(id => scope.has(id) && !selected.has(id))
  const lines = [
    `- Selected, the subject of this brief: ${focus.map(name).join(', ')}`,
    ...(context.length ? [`- Connected directly, context only (read them; do not plan, build or change them): ${context.map(name).join(', ')}`] : []),
  ]
  if (droppedTasks && !keptTasks) lines.push('- None of the selected blocks is a task, so there is no checklist: the connected tasks are context, not work.')
  const note = '## Scope\n' +
    `This brief covers part of the map, ${scope.size} of ${total} blocks: ${plural(selected.size, 'selected block')}` +
    `${neighbours ? ` and the ${plural(neighbours, 'block')} connected to ${selected.size === 1 ? 'it' : 'them'} directly` : ''}. ` +
    'The rest of the map is left out on purpose: do not assume it is empty, and do not change or refer to blocks that are not listed here. ' +
    'Gaps were checked against the whole map.\n' + lines.join('\n') + '\n\n'
  const task = text.indexOf('## Task\n')
  return task < 0 ? note + text : text.slice(0, task) + note + text.slice(task)
}
