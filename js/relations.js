// Connection semantics are separate from their label and drawing direction.
export const RELATIONS = {
  precedes: 'Comes before',
  'depends-on': 'Depends on',
  blocks: 'Blocks',
  informs: 'Informs',
  related: 'Related',
}

// Endpoint types that describe who and how-we-know rather than a step of the
// work. An arrow to or from one of these says "measures", "owns" or
// "delivered to", never "do this first", so unlabelled it adds no task order.
// Only the types added with this vocabulary are listed: every canvas drawn
// before them keeps exactly the order it had.
const NON_ORDERING_TYPES = new Set(['stakeholder', 'metric'])

/**
 * The arrow's meaning. `blocks` is optional: with it, an arrow that has no
 * relation and touches a stakeholder or a metric reads as `informs`
 * (methodology.md "Relations", the one ordering change) when it has no
 * label, or when its label is one of the verbs such an arrow implies
 * ("measures", "should move"). Writing out the verb the tool itself suggests
 * must not change what the arrow means.
 */
export function relationOf(arrow, blocks = null) {
  if (Object.hasOwn(RELATIONS, arrow.relation)) return arrow.relation
  // Recognize older semantic labels. Unknown labels preserve the original
  // arrow ordering so existing unlabeled workflow maps keep their order.
  const label = (arrow.label || '').trim().toLowerCase().split(':')[0].trim()
  if (['depends on', 'requires'].includes(label)) return 'depends-on'
  if (['blocks', 'enables', 'underpins'].includes(label)) return 'blocks'
  if (['informs', 'validates', 'mitigates'].includes(label)) return 'informs'
  if (['related', 'related to', 'conflicts with', 'threatened by', 'mitigated by', 'option'].includes(label)) return 'related'
  if (blocks && (!label || NON_ORDERING_VERBS.has(label)) &&
      (NON_ORDERING_TYPES.has(blocks[arrow.from]?.type) || NON_ORDERING_TYPES.has(blocks[arrow.to]?.type))) return 'informs'
  return 'precedes'
}

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
  if (relation === 'informs' || relation === 'related') return 'Provides context without changing task order.'
  const from = blocks[arrow.from]?.title || 'Source', to = blocks[arrow.to]?.title || 'Target'
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
  'risk>decision': 'mitigated by',
}

// The implied verbs of pairs that touch a stakeholder or a metric. None of
// them orders work, so each reads like the unlabelled arrow it describes.
const NON_ORDERING_VERBS = new Set(Object.entries(IMPLIED_VERBS)
  .filter(([pair]) => pair.split('>').some(t => NON_ORDERING_TYPES.has(t)))
  .map(([, verb]) => verb))

export function impliedVerb(fromType, toType) {
  return IMPLIED_VERBS[fromType + '>' + toType] || ''
}
