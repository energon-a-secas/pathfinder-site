// Content search is independent of the canvas and DOM so hidden fields and
// filters follow the same rules for mouse, touch, and keyboard navigation.
import { TYPES, STATUS_DEFS } from './utils.js'

const fold = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

function fieldsFor(block) {
  return [
    ['Title', block.title, 100],
    ['Type', TYPES[block.type]?.label || block.type, 40],
    ['Description', block.description, 20],
    ['Notes', block.notes, 10],
    ['Rationale', block.rationale, 10],
    ...((block.criteria || []).map(text => ['Criterion', text, 10])),
    ...((block.questions || []).flatMap(q => typeof q === 'string'
      ? [['Question', q, 10]]
      : [['Question', q.text, 10], ['Answer', q.answer, 10]])),
    ['Documentation', block.docRef?.label, 10],
    ['Status', STATUS_DEFS[block.status || 'not-started']?.label, 5],
  ].filter(([, text]) => text).map(([source, text, weight]) => ({ source, text, weight, folded: fold(text) }))
}

function excerpt(text, terms) {
  const compact = String(text).replace(/\s+/g, ' ').trim()
  const folded = fold(compact)
  const matches = terms.map(term => folded.indexOf(term)).filter(i => i >= 0)
  const start = matches.length ? Math.max(0, Math.min(...matches) - 36) : 0
  const end = start + 150
  return (start ? '…' : '') + compact.slice(start, end) + (end < compact.length ? '…' : '')
}

/** All query words must match; exact titles rank ahead of hidden-field hits. */
export function searchBlocks(blocks, query = '', { type = '', status = '' } = {}) {
  const phrase = fold(query).trim()
  const terms = phrase.split(/\s+/).filter(Boolean)
  return Object.values(blocks).flatMap(block => {
    if (type && block.type !== type) return []
    if (status && (block.status || 'not-started') !== status) return []
    const fields = fieldsFor(block)
    if (!terms.every(term => fields.some(f => f.folded.includes(term)))) return []
    const title = fold(block.title)
    const score = terms.reduce((sum, term) => sum + Math.max(...fields.filter(f => f.folded.includes(term)).map(f => f.weight)), 0)
      + (phrase && title === phrase ? 1000 : phrase && title.startsWith(phrase) ? 200 : 0)
    const detail = fields.find(f => !['Title', 'Type', 'Status'].includes(f.source) && terms.some(term => f.folded.includes(term)))
      || fields.find(f => f.source === 'Description')
    return [{ block, score, source: detail?.source || '', excerpt: detail ? excerpt(detail.text, terms) : '' }]
  }).sort((a, b) => b.score - a.score)
}
