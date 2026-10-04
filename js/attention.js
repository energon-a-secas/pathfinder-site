import { state, ui, saveStatus } from './state.js'
import { escHtml, showToast, TYPES } from './utils.js'
import { focusBlock } from './ui-panels.js'
import { detectGaps, CRITERIA_GAPS, GAP_META, FINDING_ACKS, FINDING_META, gapExplain, hasCriteria,
         acceptGap, acceptFinding, unacceptGap } from './gaps.js'
import { categorizeLine } from './classify.js'
import { mutateBlocks } from './render.js'
import { retypeBlocks } from './type-menu.js'
import { setupFilter, filterValue } from './filter-menu.js'

// Open-issue kinds first, in the order the tab lists them. `accepted` is last
// and is not an open issue: it is listed so an accepted gap stays visible and
// can be reopened, and it never counts towards the badge.
export const ATTENTION_KINDS = {
  blocked: 'Blocked work', question: 'Unanswered questions', assumption: 'Unverified assumptions',
  criteria: 'Missing criteria or targets', gap: 'Planning gaps', canvas: 'Canvas checks',
  accepted: 'Accepted gaps',
}

const CRITERIA_GAP_IDS = new Set(Object.values(CRITERIA_GAPS))
const CRITERIA_ASK = {
  requirement: 'Define what must be true for this to be done.',
  metric: 'Set the target this metric has to hit.',
}
const sentence = s => s ? s[0].toUpperCase() + s.slice(1) : s

/**
 * The open rows and the accepted rows, from one detection pass.
 *
 * One row per block per issue. With the connections, a block's gap row is
 * its one reported gap, so this tab raises exactly what the prompt's gap
 * section reports: a criteria or targets row only when that is the reported
 * gap (so accepting it lands on a gap detection reaches), and an
 * assumption's "dangling" gap row stands in for its generic row. Structural
 * checks need the connections, so without `arrows` only the block checks run.
 */
export function attentionModel(blocks, arrows = null, { groups = {} } = {}) {
  const structural = Array.isArray(arrows)
  const result = structural ? detectGaps(blocks, arrows, { groups }) : null
  const gapOf = new Map((result?.details || []).map(d => [d.id, d.gaps[0]]))
  const items = []
  Object.values(blocks).forEach(block => {
    const add = (kind, detail, question = null, extra = {}) =>
      items.push({ id: block.id, kind, detail, question, title: block.title || '(untitled)', type: block.type, ...extra })
    if (block.status === 'blocked') add('blocked', 'Review the blocker and update the status when work can continue.')
    const questions = block.questions || []
    questions.forEach((q, i) => { if (q.text?.trim() && !q.answer?.trim()) add('question', q.text, i) })
    // An Open Question card holds its own answer (inspector, or a reply's
    // patch): one with an answer is settled, whatever its status says.
    if (block.type === 'question' && !questions.length && block.status !== 'done' && !String(block.answer || '').trim()) {
      add('question', block.description || 'Write its answer in the inspector; that marks it done.', null, { card: true })
    }
    const gap = gapOf.get(block.id)
    if (block.type === 'assumption' && gap !== 'gap-assumption') add('assumption', 'Verify or refute with evidence, then turn this into a decision.')
    if (gap) {
      const criteria = CRITERIA_GAP_IDS.has(gap)
      add(criteria ? 'criteria' : 'gap', criteria ? CRITERIA_ASK[block.type] : GAP_META[gap]?.short || gap, null,
        { gap, explain: gapExplain(gap) })
    } else if (!structural) {
      const criteriaGap = CRITERIA_GAPS[block.type]
      if (criteriaGap && !hasCriteria(block) && !(block.gapAck || []).includes(criteriaGap)) {
        add('criteria', CRITERIA_ASK[block.type], null, { gap: criteriaGap })
      }
    }
  })
  ;(result?.findings || []).forEach(f => items.push({
    id: f.ids[0] || null, ids: f.ids, kind: 'canvas', finding: f.kind, ack: FINDING_ACKS[f.kind] || null,
    detail: sentence(f.text) + '.', question: null, title: FINDING_META[f.kind]?.short || 'Whole canvas', type: null,
  }))
  const order = Object.keys(ATTENTION_KINDS)
  items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))

  // Standing acceptances first, then the ones the canvas no longer raises.
  const accepted = [...(result?.accepted || []), ...(result?.stale || [])].map(a => {
    const short = GAP_META[a.gap]?.short || a.gap
    const detail = a.live === false ? `${short} (no longer applies)`
      : a.live === null && !GAP_META[a.gap] ? `${short} (a check this version does not know)` : short
    return { id: a.id, kind: 'accepted', gap: a.gap, live: a.live, detail, explain: GAP_META[a.gap] ? gapExplain(a.gap) : '',
      question: null, title: a.title, type: a.type }
  })
  return { items, accepted }
}

/** One entry per open issue; answering a question never hides another open issue. */
export function attentionItems(blocks, arrows = null, opts = {}) {
  return attentionModel(blocks, arrows, opts).items
}

/**
 * Every gap the author accepted (each block's gapAck). The ones that still
 * stand are the list the prompt prints under "Accepted gaps"; after them,
 * `live: false` marks one the canvas no longer raises, so it can be cleared.
 */
export function acceptedItems(blocks, arrows = [], opts = {}) {
  return attentionModel(blocks, arrows, opts).accepted
}

/**
 * Give untyped (Other) blocks the classifier's best guess, marked for a type
 * check so the author confirms each one. One undo step. Blocks the classifier
 * cannot place stay Other. Returns how many were retyped.
 */
export function suggestTypes(ids = Object.keys(state.blocks)) {
  if (ui.readOnly || ui.embed) return 0
  const guesses = new Map()
  ids.forEach(id => {
    const b = state.blocks[id]; if (!b || b.type !== 'custom') return
    let type = categorizeLine(b.title || '').type
    // A title alone is often a bare noun; the first line of the description
    // is the next best signal.
    const first = (b.description || '').split('\n')[0].trim()
    if (type === 'custom' && first) type = categorizeLine(`${b.title || ''} ${first}`).type
    if (type !== 'custom' && TYPES[type]) guesses.set(id, type)
  })
  if (!guesses.size) { showToast('No confident guess for these blocks: pick each type by hand'); return 0 }
  mutateBlocks([...guesses.keys()], b => ({ type: guesses.get(b.id), typeCheck: true }))
  showToast(`${guesses.size} block${guesses.size === 1 ? '' : 's'} typed: check each one`)
  return guesses.size
}

/**
 * Keep the automatic type on every listed block awaiting a type check, as
 * one undo step, by the rule every type picker uses (type-menu.js). The
 * cards' own check is still the way to change one. Returns how many.
 */
export function confirmTypes(ids) {
  if (ui.readOnly || ui.embed) return 0
  const n = retypeBlocks(ids.filter(id => state.blocks[id]?.typeCheck), null)
  if (n) showToast(`Kept the type on ${n} block${n === 1 ? '' : 's'}`)
  return n
}

/**
 * The action button that sits beside a row ('' for none). A button cannot sit
 * inside the row's own button, so actions are siblings. Nothing in read-only
 * or embed views, where the canvas is someone else's.
 */
function rowAction(item, i) {
  if (ui.readOnly || ui.embed) return ''
  const on = `"${item.title}"`
  const btn = (act, text, label) =>
    `<button type="button" class="btn btn-secondary btn-sm attention-act" data-attention-act="${act}" data-attention="${i}" aria-label="${escHtml(label)}">${text}</button>`
  if (item.kind === 'canvas') {
    if (item.finding === 'untyped') return btn('suggest-types', 'Suggest types', 'Suggest a type for each untyped block')
    if (item.finding === 'type-check') return btn('confirm-types', 'Keep all', 'Keep the automatic type on every block awaiting a type check')
    if (item.ack) return btn('accept', 'Accept', `Accept "${item.title}": keep these blocks as they are and stop raising it`)
    return ''
  }
  if ((item.kind === 'gap' || item.kind === 'criteria') && item.gap) return btn('accept', 'Accept', `Accept this gap on ${on}: keep it and stop raising it`)
  if (item.kind === 'accepted') {
    return item.live === false
      ? btn('reopen', 'Clear', `Clear the accepted gap on ${on}: it no longer applies`)
      : btn('reopen', 'Reopen', `Reopen the accepted gap on ${on}`)
  }
  return ''
}

/**
 * The list markup for the given rows; `i` in each row indexes `rows`. A row
 * that names a block is a button that opens it; a whole-canvas row with no
 * block to open is plain text, so it is not a dead stop in the Tab order.
 * The row shows the short name; the full sentence is its tooltip.
 */
export function attentionRowsHtml(rows) {
  return rows.map((item, i) => {
    const where = item.kind === 'canvas'
      ? (item.id ? 'opens the first block' : 'whole canvas')
      : escHtml(TYPES[item.type]?.label || item.type || '')
    const cls = ['gap', 'canvas', 'accepted'].includes(item.kind) ? ` class="attention-${item.kind}"` : ''
    const tip = item.explain ? ` title="${escHtml(item.explain)}"` : ''
    const body = `<span class="attention-kind">${escHtml(ATTENTION_KINDS[item.kind])}${where ? ` · ${where}` : ''}</span>
      <strong>${escHtml(item.title)}</strong>
      <span class="attention-detail">${escHtml(item.detail)}</span>`
    const main = item.id
      ? `<button type="button" class="attention-item" data-attention="${i}"${tip}>${body}</button>`
      : `<div class="attention-item attention-static"${tip}>${body}</div>`
    return `<li${cls}>${main}${rowAction(item, i)}</li>`
  }).join('')
}

/** Run a row action. Each one is a single undo step. Returns true on a change. */
export function runAttentionAction(act, item) {
  if (!item) return false
  if (act === 'suggest-types') return suggestTypes(item.ids || undefined) > 0
  if (act === 'confirm-types') return confirmTypes(item.ids || []) > 0
  if (act === 'accept') {
    if (item.kind === 'canvas') {
      const n = acceptFinding({ kind: item.finding, ids: item.ids })
      if (n) showToast(`Accepted for ${n} block${n === 1 ? '' : 's'}: listed under Accepted gaps`)
      return n > 0
    }
    const ok = acceptGap(item.id, item.gap)
    if (ok) showToast('Gap accepted: listed under Accepted gaps and no longer raised')
    return ok
  }
  if (act === 'reopen') return unacceptGap(item.id, item.gap)
  return false
}

export function setupAttention() {
  const list = document.getElementById('attentionList'), filter = document.getElementById('attentionFilter')
  if (!list || !filter) return
  let shown = []
  // The category filter is the one filter control (filter-menu.js): a chip
  // that opens a menu.js list, each category with its count.
  let model = { items: [], accepted: [] }
  const countOf = kind => [...model.items, ...model.accepted].filter(item => item.kind === kind).length
  setupFilter(filter, {
    name: 'Show',
    options: () => [{ value: '', label: 'All items' },
      ...Object.entries(ATTENTION_KINDS).map(([value, label]) => ({ value, label, count: countOf(value) }))],
    onChange: () => refresh(),
  })
  const refresh = () => {
    const { items, accepted } = model = attentionModel(state.blocks, state.arrows, { groups: state.groups })
    const kind = filterValue(filter)
    shown = [...items, ...accepted].filter(item => !kind || item.kind === kind)
    const badge = document.getElementById('attentionCount')
    if (badge) {
      badge.textContent = items.length > 99 ? '99+' : String(items.length)
      badge.hidden = !items.length
      badge.closest('button')?.setAttribute('aria-label', `Attention, ${items.length} open item${items.length === 1 ? '' : 's'}`)
    }
    const open = shown.filter(item => item.kind !== 'accepted')
    const acc = shown.length - open.length
    const count = new Set(open.map(item => item.id).filter(Boolean)).size
    const accText = acc ? `${acc} accepted gap${acc === 1 ? '' : 's'}` : ''
    const summary = document.getElementById('attentionSummary')
    if (summary) {
      summary.textContent = open.length
        ? `${open.length} item${open.length === 1 ? '' : 's'} across ${count} block${count === 1 ? '' : 's'}${accText ? `, ${accText}` : ''}`
        : accText ? `No open items, ${accText}.` : kind ? 'No items in this category.' : 'No outstanding items in these checks.'
    }
    // A rebuild under keyboard focus (the save that follows an action runs
    // this again) used to drop focus to the page: keep it on the row at the
    // same position, else the nearest row, else the filter.
    const ae = document.activeElement
    const fromRow = list.contains(ae) ? [...list.children].findIndex(li => li.contains(ae)) : -1
    const act = fromRow >= 0 && ae.dataset.attentionAct
    list.innerHTML = attentionRowsHtml(shown)
    if (fromRow < 0) return
    const lis = [...list.children]
    const pick = li => (act && li.querySelector(`[data-attention-act="${act}"]`)) || li.querySelector('button')
    const next = [...lis.slice(fromRow), ...lis.slice(0, fromRow).reverse()].map(pick).find(Boolean)
    ;(next || filter).focus({ preventScroll: true })
  }
  list.addEventListener('click', e => {
    const actBtn = e.target.closest('[data-attention-act]')
    if (actBtn) {
      const i = Number(actBtn.dataset.attention)
      // The list is rebuilt by the change, so keep keyboard focus in it: the
      // row now at this position, else the nearest one that can take focus.
      if (runAttentionAction(actBtn.dataset.attentionAct, shown[i])) {
        const lis = [...list.children]
        const next = [...lis.slice(i), ...lis.slice(0, i).reverse()].map(li => li.querySelector('button')).find(Boolean)
        ;(next || filter).focus()
      }
      return
    }
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
      else if (item.card) target = document.getElementById('inspAnswer') || target
      else if (item.kind === 'blocked') target = document.querySelector('#statusPicker button') || target
      else if (item.kind === 'assumption') target = document.getElementById('inspNotes') || target
      else if (item.kind === 'gap') target = document.querySelector('#gapFixes .gap-fix-btn') || target
    }
    target?.focus()
    target?.scrollIntoView({ block: 'nearest' })
  })
  window.addEventListener('pf:canvas-changed', refresh)
  // Saves settle what changed without an event of its own (a drag, a
  // resize). 'pending' fires on every keystroke and adds nothing a change
  // event has not already refreshed: at 300 blocks it doubled the checks
  // run per key.
  window.addEventListener('pf:save-status', () => { if (saveStatus.phase !== 'pending') refresh() })
  refresh()
}
