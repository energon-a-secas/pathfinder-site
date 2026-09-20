import { TYPES, STATUS_DEFS, PRIORITY_DEFS } from './utils.js'

/** Readable full content for reply reviews and saved-version comparisons. */
export function blockDetails(block) {
  if (!block) return 'Not present'
  const fields = [
    ['Title', block.title || '(untitled)'], ['Type', TYPES[block.type]?.label || block.type],
    ['Description', block.description], ['Notes', block.notes],
    ['Status', STATUS_DEFS[block.status || 'not-started']?.label],
    ['Priority', PRIORITY_DEFS[block.priority]?.label],
    ['Actions', (block.actions || []).join(', ')],
    ['Acceptance criteria', (block.criteria || []).join('\n')],
    ['Rationale', block.rationale],
    ['Questions', (block.questions || []).map(q => `${q.text}${q.answer ? '\nAnswer: ' + q.answer : ''}`).join('\n\n')],
    ['Documentation', block.docRef ? [block.docRef.label, block.docRef.href, block.docRef.anchor].filter(Boolean).join(' · ') : ''],
    ['Position', `${block.x ?? 0}, ${block.y ?? 0}`],
    ['Appearance', [`width: ${block.width || 'default'}`, `color: ${block.color || 'default'}`, `style: ${block.cardStyle || 'default'}`, `border: ${block.borderWidth ?? 'default'}`, `highlight: ${block.highlight || 'none'}`, block.collapsed ? 'collapsed' : 'expanded'].join(', ')],
    ['Group', block.groupId],
  ]
  return fields.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join('\n\n')
}
