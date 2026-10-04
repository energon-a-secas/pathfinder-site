// Shared by Build prompts and the spec bundle: both must hand an assistant
// the same task order and the same evidence from the canvas.
import { TYPES, PRIORITY_DEFS, STATUS_DEFS, typeInfo, askedQuestions } from './utils.js'
import { dependencyEdges, mitigationPairs } from './relations.js'

const priorityRank = block => ({ high: 0, medium: 1, low: 2 }[block.priority] ?? 3)
// The registry says which types are tasks: requirement and output as before,
// plus implementation, the most task-like type there is.
const isTask = block => Object.hasOwn(TYPES, block.type) && TYPES[block.type].task

/**
 * An Open Question card's own answer, trimmed, or ''. The card is the
 * question, so it holds its answer itself (`block.answer`); questions[] is
 * for questions raised on other blocks. Every hand-off reads it through this.
 */
export const cardAnswer = block => (block?.type === 'question' ? String(block.answer || '').trim() : '')

/**
 * Order dependencies, including paths through non-task blocks. A task with
 * no dependency in or out has nothing on the map that orders it, so it is
 * listed after the ordered ones (in priority, then canvas, order) and named
 * in `unordered`: placing it by canvas position among them would pass a
 * tie-break off as a dependency, which is how a cleanup wired only to its
 * goal used to come first.
 */
export function buildTaskPlan(blocks, arrows) {
  const ids = Object.keys(blocks)
  const position = new Map(ids.map((id, i) => [id, i]))
  const incoming = new Map(ids.map(id => [id, new Set()]))
  const outgoing = new Map(ids.map(id => [id, new Set()]))
  dependencyEdges(blocks, arrows).forEach(({ from, to }) => {
    if (!incoming.has(to) || !outgoing.has(from)) return
    incoming.get(to).add(from)
    outgoing.get(from).add(to)
  })
  const remaining = new Map(ids.map(id => [id, incoming.get(id).size]))
  const compare = (a, b) => priorityRank(blocks[a]) - priorityRank(blocks[b]) || position.get(a) - position.get(b)
  const ready = ids.filter(id => remaining.get(id) === 0)
  const ordered = [], visited = new Set()
  while (ready.length) {
    ready.sort(compare)
    const id = ready.shift()
    visited.add(id)
    ordered.push(id)
    outgoing.get(id).forEach(next => {
      remaining.set(next, remaining.get(next) - 1)
      if (remaining.get(next) === 0) ready.push(next)
    })
  }
  // Keep every task visible, but never silently reverse a dependency to
  // manufacture an implementation order for a cyclic graph.
  const unresolved = ids.filter(id => !visited.has(id)).sort(compare)
  ordered.push(...unresolved)
  const taskIds = ordered.filter(id => isTask(blocks[id]))
  const unordered = new Set(taskIds.filter(id => !incoming.get(id).size && !outgoing.get(id).size))
  return {
    tasks: [...taskIds.filter(id => !unordered.has(id)), ...taskIds.filter(id => unordered.has(id))].map(id => blocks[id]),
    unordered,
    incoming,
    hasCycle: unresolved.length > 0,
  }
}

const indent = text => String(text).trim().replace(/\r?\n/g, '\n      ')

/**
 * The requirements a work item satisfies: every requirement it is wired to,
 * in either direction. An Implementation inherits "done" from these (its own
 * criteria are optional), so the checklist prints them instead of asking for
 * criteria the canvas already has one hop away.
 */
export function satisfiedRequirements(block, blocks, arrows) {
  if (block?.type !== 'implementation') return []
  const seen = new Set()
  const out = []
  arrows.forEach(a => {
    const other = a.from === block.id ? a.to : a.to === block.id ? a.from : null
    const req = other != null && Object.hasOwn(blocks, other) ? blocks[other] : null
    if (req?.type === 'requirement' && !seen.has(req.id)) { seen.add(req.id); out.push(req) }
  })
  return out
}

/**
 * Each block's risks it mitigates (by → [{ id: risk, implied }]) and each
 * risk's mitigations (risk → [{ id: by, implied }]). `implied` marks a pair
 * read from an unlabelled arrow (relations.js mitigationPairs): a guess from
 * the endpoint types, which every hand-off prints as implied, never as fact.
 */
export function mitigationIndex(blocks, arrows) {
  const byRisk = new Map(), byBlock = new Map()
  mitigationPairs(blocks, arrows).forEach(({ risk, by, implied }) => {
    if (!byRisk.has(risk)) byRisk.set(risk, [])
    if (!byBlock.has(by)) byBlock.set(by, [])
    byRisk.get(risk).push({ id: by, implied: !!implied })
    byBlock.get(by).push({ id: risk, implied: !!implied })
  })
  return { byRisk, byBlock }
}

/** The label a mitigation line opens with: stated, or implied by the drawing. */
export const IMPLIED_MITIGATION = 'implied by an unlabelled arrow'

export function taskChecklist(blocks, arrows) {
  const { tasks, unordered, incoming, hasCycle } = buildTaskPlan(blocks, arrows)
  if (!tasks.length) return ''
  const { byBlock: mitigates } = mitigationIndex(blocks, arrows)
  let out = hasCycle
    ? '> [NEEDS INPUT: circular connections] A complete dependency order is not possible. Resolve the cycle before implementing dependent tasks.\n\n'
    : ''
  const looseFrom = tasks.length > 1 ? tasks.findIndex(b => unordered.has(b.id)) : -1
  tasks.forEach((b, i) => {
    // The tasks nothing on the map orders come last, under a line that says
    // so: the list order among them is a tie-break, not a dependency.
    // They may well be connected (to a goal, a stakeholder, a related task):
    // what they lack is a connection that sets an order.
    if (i === looseFrom) {
      out += i === 0
        ? 'Not ordered by the map: no connection sets an order for these tasks, so priority and then canvas position decide where they sit. Decide the sequence yourself.\n\n'
        : '\nNot ordered by the map: no connection sets an order for these tasks, so they sit after the tasks above by priority and then canvas position. Decide where each one belongs.\n\n'
    }
    const done = b.status === 'done'
    const tags = []
    if (b.priority) tags.push(PRIORITY_DEFS[b.priority]?.label?.toUpperCase() || b.priority)
    if (b.status && b.status !== 'not-started') tags.push(STATUS_DEFS[b.status]?.label?.toUpperCase() || b.status)
    out += `- [${done ? 'x' : ' '}]${tags.map(tag => ` [${tag}]`).join('')} ${b.title || '(untitled)'}\n`
    out += `      Block: ${b.id} (${typeInfo(b.type).label})\n`
    if (b.description?.trim()) out += `      ${indent(b.description)}\n`
    const prior = [...incoming.get(b.id)]
    const before = prior.map(id => blocks[id].title || '(untitled)')
    if (before.length) out += `      after: ${before.join('; ')}\n`
    // An Open Question card this task waits on: its answer, where the task
    // needs it, or a flag that there is none yet.
    prior.filter(id => blocks[id].type === 'question').forEach(id => {
      const answer = cardAnswer(blocks[id])
      out += answer
        ? `      Answer to "${blocks[id].title || '(untitled)'}": ${indent(answer)}\n`
        : `      [NEEDS CLARIFICATION]: ${indent(blocks[id].title || '(untitled)')}\n`
    })
    ;(mitigates.get(b.id) || []).forEach(({ id: risk, implied }) => {
      out += `      mitigates${implied ? ` (${IMPLIED_MITIGATION})` : ''}: ${blocks[risk].title || '(untitled)'} (${risk})\n`
    })
    const satisfies = satisfiedRequirements(b, blocks, arrows)
    satisfies.forEach(req => {
      out += `      satisfies: ${req.title || '(untitled)'} (${req.id})\n`
      if (req.criteria?.length) {
        req.criteria.forEach(c => { out += `        - ${done ? '' : '[ ] '}${indent(c)}\n` })
      } else out += `        [NEEDS INPUT: acceptance criteria on "${req.title || '(untitled)'}"]\n`
    })
    // A work item's own criteria are optional once it satisfies a requirement.
    if (b.criteria?.length || !satisfies.length) {
      out += `      ${typeInfo(b.type).criteria || 'Acceptance criteria'}:\n`
      if (b.criteria?.length) {
        b.criteria.forEach(c => { out += `      - ${done ? '' : '[ ] '}${indent(c)}\n` })
      } else out += '      [NEEDS INPUT: acceptance criteria]\n'
    }
    if (b.rationale?.trim()) out += `      Rationale: ${indent(b.rationale)}\n`
    if (b.docRef?.href || b.docRef?.label) {
      const { href, label, anchor } = b.docRef
      const url = (href || '') + (anchor ? '#' + anchor : '')
      out += `      Referenced doc: ${label || url}${label && url ? ` (${url})` : ''}\n`
    }
    askedQuestions(b).forEach(q => {
      out += `      ${q.answer?.trim() ? 'Question' : '[NEEDS CLARIFICATION]'}: ${indent(q.text)}\n`
      if (q.answer?.trim()) out += `      Answer: ${indent(q.answer)}\n`
    })
    if (b.actions?.length) out += `      Actions: ${b.actions.join(', ')}\n`
    if (b.notes?.trim()) out += `      Notes: ${indent(b.notes)}\n`
  })
  return out
}
