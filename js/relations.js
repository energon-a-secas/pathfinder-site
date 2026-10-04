// Connection semantics are separate from their label and drawing direction.
export const RELATIONS = {
  precedes: 'Comes before',
  'depends-on': 'Depends on',
  blocks: 'Blocks',
  informs: 'Informs',
  related: 'Related',
}

// Endpoint types that are not a step of the work: why it exists (goal), who
// it is for (stakeholder), how we will know (metric), what might go wrong
// (risk), what it uses (resource) and what frames it (context). An
// unlabelled arrow to or from one of these says "measures", "owns",
// "mitigated by" or "source of", never "do this first", so it adds no task
// order. Before 2026-10 only stakeholder and metric were listed, and an
// unlabelled arrow from a risk to its mitigation printed the mitigation as
// "after: <risk>", while a cleanup task wired only to the goal ordered
// itself ahead of every requirement under that goal.
//
// Ordering pairs stay ordering: the flow types (process, terminator), the
// tasks (requirement, output, implementation), a decision, and the
// dependency-shaped doubts (an assumption to check first, an open question
// to answer first, a problem in a chain of steps).
const NON_ORDERING_TYPES = new Set(['goal', 'stakeholder', 'metric', 'risk', 'resource', 'context'])

const labelVerb = arrow => (arrow.label || '').trim().toLowerCase().split(':')[0].trim()

// The verbs that say a block answers a risk, read only on an arrow with a
// risk at the right end: from the risk ("guarded by" its test) or to it (a
// test "guards" it). "mitigated by" and "mitigates" are the app's own words
// and mean the same anywhere; the rest are what people write instead, and
// away from a risk some of them ("handles", "covers") mean something else,
// so only there are they read. They set no order: a mitigation printed as
// "after: <risk>" is the falsehood this exists to stop.
const MITIGATED_BY = new Set(['mitigated by', 'guarded by', 'prevented by', 'reduced by', 'handled by',
  'addressed by', 'covered by', 'contained by', 'caught by'])
const MITIGATES = new Set(['mitigates', 'guards', 'guards against', 'prevents', 'reduces', 'handles',
  'addresses', 'covers', 'contains', 'catches'])

/**
 * The arrow's meaning. `blocks` is optional: with it, an arrow that has no
 * relation and touches one of the non-ordering types above reads as
 * `informs` (`related` at a risk, the meaning "mitigated by" already has)
 * when it has no label, or when its label is one of the verbs such an arrow
 * implies ("measures", "should move"). Writing out the verb the tool itself
 * suggests must not change what the arrow means, and neither does writing a
 * mitigation in other words at a risk ("guarded by"). Any other label the
 * app does not know keeps the drawn order, and an explicit relation always
 * wins.
 */
export function relationOf(arrow, blocks = null) {
  if (Object.hasOwn(RELATIONS, arrow.relation)) return arrow.relation
  // Recognize older semantic labels. Unknown labels preserve the original
  // arrow ordering so existing labelled workflow maps keep their order.
  const label = labelVerb(arrow)
  if (['depends on', 'requires'].includes(label)) return 'depends-on'
  if (['blocks', 'enables', 'underpins'].includes(label)) return 'blocks'
  if (['informs', 'validates', 'mitigates'].includes(label)) return 'informs'
  if (['related', 'related to', 'conflicts with', 'threatened by', 'mitigated by', 'option'].includes(label)) return 'related'
  if (blocks) {
    const from = typeAt(blocks, arrow.from), to = typeAt(blocks, arrow.to)
    if ((from === 'risk' && MITIGATED_BY.has(label)) || (to === 'risk' && MITIGATES.has(label))) return 'related'
    if ((!label || NON_ORDERING_VERBS.has(label)) && (NON_ORDERING_TYPES.has(from) || NON_ORDERING_TYPES.has(to))) {
      return from === 'risk' || to === 'risk' ? 'related' : 'informs'
    }
  }
  return 'precedes'
}

const typeAt = (blocks, id) => Object.hasOwn(blocks, id) ? blocks[id]?.type : undefined

export function connectionLabel(arrow) {
  const meaning = arrow.relation ? RELATIONS[relationOf(arrow)].toLowerCase() : ''
  const label = (arrow.label || '').trim()
  return label && meaning && label.toLowerCase() !== meaning ? `${meaning}: ${label}` : label || meaning
}

export function dependencyEdges(blocks, arrows) {
  return arrows.flatMap(arrow => {
    if (!Object.hasOwn(blocks, arrow.from) || !Object.hasOwn(blocks, arrow.to) || arrow.from === arrow.to) return []
    const relation = relationOf(arrow, blocks)
    if (relation === 'informs' || relation === 'related') return []
    return [{ from: relation === 'depends-on' ? arrow.to : arrow.from, to: relation === 'depends-on' ? arrow.from : arrow.to }]
  })
}

export function relationHint(arrow, blocks) {
  const relation = relationOf(arrow, blocks)
  const titleOf = (id, fallback) => (Object.hasOwn(blocks, id) && blocks[id]?.title) || fallback
  if (relation === 'informs' || relation === 'related') {
    const pair = mitigationPairs(blocks, [arrow])[0]
    // A pair read from an unlabelled arrow is a guess from the two types, and
    // says so: "the work that brings this risk" is drawn the same way.
    if (pair?.implied) return `Implied: “${titleOf(pair.by, 'This')}” mitigates “${titleOf(pair.risk, 'the risk')}”. Label it “mitigated by” to confirm. It adds no task order.`
    if (pair) return `“${titleOf(pair.by, 'This')}” mitigates “${titleOf(pair.risk, 'the risk')}”. It adds no task order.`
    return 'Provides context without changing task order.'
  }
  const from = titleOf(arrow.from, 'Source'), to = titleOf(arrow.to, 'Target')
  return relation === 'depends-on' ? `“${to}” comes before “${from}” in the task plan.` : `“${from}” comes before “${to}” in the task plan.`
}

// The verb an unlabelled connection implies from its two endpoint types.
// Derived, never stored: the relation enum above stays an ordering
// vocabulary, and this only fills in what the drawing already says
// (methodology.md "Relations"). '' when the pair implies nothing.
const IMPLIED_VERBS = {
  'implementation>requirement': 'satisfies',
  'implementation>output': 'produces',
  'implementation>metric': 'should move',
  'resource>metric': 'source of',
  'terminator>process': 'triggers',
  'terminator>implementation': 'triggers',
  'metric>goal': 'measures',
  'output>stakeholder': 'delivered to',
  'stakeholder>goal': 'owns',
  // A risk points at what answers it: a choice, a guard the work must hold,
  // the work itself, or a step. Not a deliverable or a system: a risk drawn
  // to a database or a report is as often the thing at risk as its answer.
  'risk>decision': 'mitigated by',
  'risk>implementation': 'mitigated by',
  'risk>requirement': 'mitigated by',
  'risk>process': 'mitigated by',
}

// The implied verbs of pairs that touch a non-ordering type. None of them
// orders work, so each reads like the unlabelled arrow it describes.
const NON_ORDERING_VERBS = new Set(Object.entries(IMPLIED_VERBS)
  .filter(([pair]) => pair.split('>').some(t => NON_ORDERING_TYPES.has(t)))
  .map(([, verb]) => verb))

export function impliedVerb(fromType, toType) {
  return IMPLIED_VERBS[fromType + '>' + toType] || ''
}

/**
 * Which blocks mitigate which risks, read from the drawing:
 * - a risk pointing at another block labelled "mitigated by" (or "guarded
 *   by" and the like, MITIGATED_BY);
 * - any block pointing at a risk labelled "mitigates" (or "guards" and the
 *   like, MITIGATES);
 * - implied: a risk pointing at a block with no label and no relation, where
 *   the pair implies "mitigated by". This one is a guess from the two types
 *   (the work that brings a risk is drawn the same way as the work that
 *   answers it), so it carries `implied: true` and every hand-off prints it
 *   as implied, never as fact. An explicit relation is the author saying
 *   what the arrow means, and `informs` or `related` is not "mitigated by".
 * An unlabelled arrow into a risk is not a mitigation: "this work leads to
 * that risk" is drawn the same way. Returns [{ risk, by, implied? }] in arrow
 * order, each pair once; a stated pair wins over the same pair implied.
 */
export function mitigationPairs(blocks, arrows) {
  const out = [], seen = new Map()
  arrows.forEach(a => {
    if (!a || a.from === a.to) return
    const from = typeAt(blocks, a.from), to = typeAt(blocks, a.to)
    if (!from || !to) return
    const verb = labelVerb(a)
    let pair = null
    if (from === 'risk' && to !== 'risk') {
      if (MITIGATED_BY.has(verb)) pair = { risk: a.from, by: a.to }
      else if (!verb && !a.relation && impliedVerb('risk', to) === 'mitigated by') pair = { risk: a.from, by: a.to, implied: true }
    } else if (to === 'risk' && from !== 'risk' && MITIGATES.has(verb)) {
      pair = { risk: a.to, by: a.from }
    }
    if (!pair) return
    const key = pair.risk + '>' + pair.by
    const had = seen.get(key)
    if (had) { if (had.implied && !pair.implied) delete had.implied; return }
    seen.set(key, pair)
    out.push(pair)
  })
  return out
}
