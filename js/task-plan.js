// Shared by Build prompts and the spec bundle: both must hand an assistant
// the same task order and the same evidence from the canvas.
import { TYPES, PRIORITY_DEFS, STATUS_DEFS } from './utils.js'
import { dependencyEdges } from './relations.js'

const priorityRank = block => ({ high: 0, medium: 1, low: 2 }[block.priority] ?? 3)
const isTask = block => block.type === 'requirement' || block.type === 'output'

/** Order dependencies, including paths through non-task blocks. */
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
  return {
    tasks: ordered.map(id => blocks[id]).filter(isTask),
    incoming,
    hasCycle: unresolved.length > 0,
  }
}

const indent = text => String(text).trim().replace(/\r?\n/g, '\n      ')

export function taskChecklist(blocks, arrows) {
  const { tasks, incoming, hasCycle } = buildTaskPlan(blocks, arrows)
  if (!tasks.length) return ''
  let out = hasCycle
    ? '> [NEEDS INPUT: circular connections] A complete dependency order is not possible. Resolve the cycle before implementing dependent tasks.\n\n'
    : ''
  tasks.forEach(b => {
    const done = b.status === 'done'
    const tags = []
    if (b.priority) tags.push(PRIORITY_DEFS[b.priority]?.label?.toUpperCase() || b.priority)
    if (b.status && b.status !== 'not-started') tags.push(STATUS_DEFS[b.status]?.label?.toUpperCase() || b.status)
    out += `- [${done ? 'x' : ' '}]${tags.map(tag => ` [${tag}]`).join('')} ${b.title || '(untitled)'}\n`
    out += `      Block: ${b.id} (${TYPES[b.type]?.label || b.type})\n`
    if (b.description?.trim()) out += `      ${indent(b.description)}\n`
    const before = [...incoming.get(b.id)].map(id => blocks[id].title || '(untitled)')
    if (before.length) out += `      after: ${before.join('; ')}\n`
    out += '      Acceptance criteria:\n'
    if (b.criteria?.length) {
      b.criteria.forEach(c => { out += `      - ${done ? '' : '[ ] '}${indent(c)}\n` })
    } else out += '      [NEEDS INPUT: acceptance criteria]\n'
    if (b.rationale?.trim()) out += `      Rationale: ${indent(b.rationale)}\n`
    if (b.docRef?.href || b.docRef?.label) {
      const { href, label, anchor } = b.docRef
      const url = (href || '') + (anchor ? '#' + anchor : '')
      out += `      Referenced doc: ${label || url}${label && url ? ` (${url})` : ''}\n`
    }
    ;(b.questions || []).forEach(q => {
      out += `      ${q.answer?.trim() ? 'Question' : '[NEEDS CLARIFICATION]'}: ${indent(q.text)}\n`
      if (q.answer?.trim()) out += `      Answer: ${indent(q.answer)}\n`
    })
    if (b.actions?.length) out += `      Actions: ${b.actions.join(', ')}\n`
    if (b.notes?.trim()) out += `      Notes: ${indent(b.notes)}\n`
  })
  return out
}
