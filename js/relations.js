// Connection semantics are separate from their label and drawing direction.
export const RELATIONS = {
  precedes: 'Comes before',
  'depends-on': 'Depends on',
  blocks: 'Blocks',
  informs: 'Informs',
  related: 'Related',
}

export function relationOf(arrow) {
  if (Object.hasOwn(RELATIONS, arrow.relation)) return arrow.relation
  // Recognize older semantic labels. Unknown labels preserve the original
  // arrow ordering so existing unlabeled workflow maps keep their order.
  const label = (arrow.label || '').trim().toLowerCase().split(':')[0].trim()
  if (['depends on', 'requires'].includes(label)) return 'depends-on'
  if (['blocks', 'enables', 'underpins'].includes(label)) return 'blocks'
  if (['informs', 'validates', 'mitigates'].includes(label)) return 'informs'
  if (['related', 'related to', 'conflicts with', 'threatened by', 'mitigated by', 'option'].includes(label)) return 'related'
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
    const relation = relationOf(arrow)
    if (relation === 'informs' || relation === 'related') return []
    return [{ from: relation === 'depends-on' ? arrow.to : arrow.from, to: relation === 'depends-on' ? arrow.from : arrow.to }]
  })
}

export function relationHint(arrow, blocks) {
  const relation = relationOf(arrow)
  if (relation === 'informs' || relation === 'related') return 'Provides context without changing task order.'
  const from = blocks[arrow.from]?.title || 'Source', to = blocks[arrow.to]?.title || 'Target'
  return relation === 'depends-on' ? `“${to}” comes before “${from}” in the task plan.` : `“${from}” comes before “${to}” in the task plan.`
}
