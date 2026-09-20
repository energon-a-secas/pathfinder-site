import { state, ui } from './state.js'
import { escHtml, TYPES } from './utils.js'
import { focusBlock } from './ui-panels.js'

export const ATTENTION_KINDS = {
  blocked: 'Blocked work', question: 'Unanswered questions', assumption: 'Unverified assumptions', criteria: 'Missing acceptance criteria',
}

/** One entry per issue; answering a question never hides another open issue. */
export function attentionItems(blocks) {
  const items = []
  Object.values(blocks).forEach(block => {
    const add = (kind, detail, question = null) => items.push({ id: block.id, kind, detail, question, title: block.title || '(untitled)', type: block.type })
    if (block.status === 'blocked') add('blocked', 'Review the blocker and update the status when work can continue.')
    const questions = block.questions || []
    questions.forEach((q, i) => { if (q.text?.trim() && !q.answer?.trim()) add('question', q.text, i) })
    if (block.type === 'question' && !questions.length && block.status !== 'done') add('question', block.description || 'Record the answer and mark this question done.')
    if (block.type === 'assumption') add('assumption', 'Verify or refute with evidence, then turn this into a decision.')
    if (['requirement', 'goal', 'output'].includes(block.type) && !(block.criteria || []).some(c => c.trim())) {
      add('criteria', 'Define what must be true for this to be done.')
    }
  })
  const order = Object.keys(ATTENTION_KINDS)
  return items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
}

export function setupAttention() {
  const list = document.getElementById('attentionList'), filter = document.getElementById('attentionFilter')
  if (!list || !filter) return
  let shown = []
  Object.entries(ATTENTION_KINDS).forEach(([value, label]) => filter.add(new Option(label, value)))
  const refresh = () => {
    const items = attentionItems(state.blocks)
    shown = items.filter(item => !filter.value || item.kind === filter.value)
    const badge = document.getElementById('attentionCount')
    badge.textContent = items.length > 99 ? '99+' : String(items.length)
    badge.hidden = !items.length
    badge.closest('button').setAttribute('aria-label', `Attention, ${items.length} open item${items.length === 1 ? '' : 's'}`)
    const count = new Set(shown.map(item => item.id)).size
    document.getElementById('attentionSummary').textContent = shown.length
      ? `${shown.length} item${shown.length === 1 ? '' : 's'} across ${count} block${count === 1 ? '' : 's'}`
      : filter.value ? 'No items in this category.' : 'No outstanding items in these checks.'
    list.innerHTML = shown.map((item, i) => `<li><button class="attention-item" data-attention="${i}">
      <span class="attention-kind">${escHtml(ATTENTION_KINDS[item.kind])}</span>
      <strong>${escHtml(item.title)}</strong>
      <span>${escHtml(item.detail)}</span>
      <span class="attention-open">${escHtml(TYPES[item.type]?.label || item.type)} · Review block →</span>
    </button></li>`).join('')
  }
  filter.addEventListener('change', refresh)
  list.addEventListener('click', e => {
    const button = e.target.closest('[data-attention]')
    if (!button) return
    const item = shown[Number(button.dataset.attention)]
    if (!item || !state.blocks[item.id]) return
    focusBlock(item.id)
    document.querySelector('[data-tab="inspector"]')?.click()
    let target = document.getElementById('inspTitle')
    if (!ui.readOnly) {
      if (item.kind === 'criteria') target = document.getElementById('inspCriteria')
      else if (item.question !== null) target = document.querySelector(`textarea[data-qi="${item.question}"]`)
      else if (item.kind === 'blocked') target = document.querySelector('#statusPicker button') || target
      else if (item.kind === 'assumption') target = document.getElementById('inspNotes') || target
    }
    target?.focus()
    target?.scrollIntoView({ block: 'nearest' })
  })
  window.addEventListener('pf:canvas-changed', refresh)
  window.addEventListener('pf:save-status', refresh)
  refresh()
}
