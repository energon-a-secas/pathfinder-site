import { connectionLabel } from './relations.js'
// ════════════════════════════════════════════════════════════
//  patch.js: the round trip. An assistant's reply can end with
//  a fenced ```pathfinder-patch``` JSON block; this module finds
//  it, previews every operation against the live canvas, and
//  applies the lot as ONE undo step.
//
//  The failure it exists to prevent: an investigation whose
//  answers die in the chat log. Answers land in their question
//  blocks, a verified or refuted assumption becomes a decision
//  in place (same id, so its arrows survive), statuses and
//  criteria update, and new findings arrive as wired blocks.
//
//  Addressing: an op names a block by id (the prompt now prints
//  an id map) or by title. Ids win; an exact title match is
//  trusted; a unique fuzzy match is applied but labeled in the
//  preview; anything ambiguous or unknown is refused, never
//  guessed.
// ════════════════════════════════════════════════════════════

import { state, ui, snapshot, saveState, serializeCanvas } from './state.js'
import { genId, escHtml, showToast, STATUS_DEFS } from './utils.js'
import { normalizeBlock, normalizeArrow } from './normalize.js'
import { renderAllBlocks, renderInspector } from './render.js'
import { renderArrows, renderFrames, fitView } from './canvas.js'
import { runGapDetection } from './gaps.js'
import { refreshPrompt } from './prompt.js'
import { takeSnapshot, currentId } from './library.js'
import { blockDetails } from './change-details.js'

// ── Parsing ──────────────────────────────────────────────────

/** Pull the patch JSON out of a pasted reply (fenced block or bare JSON). */
export function extractPatch(text) {
  const raw = String(text || '').trim()
  if (!raw) return { error: 'Nothing pasted yet' }
  const fence = raw.match(/```pathfinder-patch\s*\n([\s\S]*?)```/)
  const body = fence ? fence[1] : raw
  let data
  try { data = JSON.parse(body) } catch (_) {
    return { error: fence
      ? 'The pathfinder-patch block is not valid JSON'
      : 'No ```pathfinder-patch``` block found, and the text is not JSON' }
  }
  if (!data || typeof data !== 'object') return { error: 'The patch is not an object' }
  if (data.blocks && !data.format) {
    return { error: 'That looks like a whole canvas, not a patch. Use Export ▾ → Import JSON for it' }
  }
  if (data.format !== 'pathfinder-patch') {
    return { error: 'Missing "format": "pathfinder-patch"' }
  }
  if (data.version != null && data.version !== 1) {
    return { error: 'Unsupported patch version. Ask for a version 1 pathfinder-patch' }
  }
  return { patch: data }
}

// ── Target resolution ────────────────────────────────────────

const normTitle = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Resolve an id-or-title reference to a live block. Never guesses on ambiguity. */
export function resolveRef(ref) {
  const key = String(ref ?? '').trim()
  if (!key) return null
  if (Object.hasOwn(state.blocks, key)) return { id: key, how: 'id' }
  const want = normTitle(key)
  if (!want) return null
  const all = Object.values(state.blocks)
  const exact = all.filter(b => normTitle(b.title) === want)
  if (exact.length === 1) return { id: exact[0].id, how: 'title' }
  if (exact.length > 1) return null
  const loose = all.filter(b => normTitle(b.title).includes(want))
  if (loose.length === 1) return { id: loose[0].id, how: 'fuzzy' }
  return null
}

// ── Plan: one entry per operation, applied only when ok ──────

const short = (s, n = 70) => { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
const titleOf = id => state.blocks[id]?.title || '(untitled)'
const planBaseline = () => JSON.stringify({ map: currentId(), canvas: serializeCanvas() })

export function buildPlan(patch) {
  const ops = []
  const add = (kind, ok, label, opts = {}) => ops.push({ id: ops.length, kind, ok, label, selected: ok, requires: [], ...opts })
  const miss = (kind, ref, why) => add(kind, false, `${why}: "${short(ref, 40)}"`)

  // answers → questions[i].answer
  ;(Array.isArray(patch.answers) ? patch.answers : []).forEach(a => {
    const t = resolveRef(a?.block)
    if (!t) return miss('answer', a?.block, 'No unique block match')
    const b = state.blocks[t.id]
    const qs = b.questions || []
    let idx = -1
    if (typeof a.question === 'number') idx = a.question
    else if (a.question != null) {
      const matches = qs.map((q, i) => normTitle(q.text) === normTitle(a.question) ? i : -1).filter(i => i >= 0)
      if (matches.length === 1) idx = matches[0]
    }
    else if (qs.length === 1) idx = 0
    if (!Number.isInteger(idx) || idx < 0 || !qs[idx]) return miss('answer', a?.question ?? a?.block, 'No unique matching question')
    if (!String(a.answer || '').trim()) return miss('answer', a?.block, 'Empty answer')
    add('answer', true, `Answer "${short(qs[idx].text, 44)}" on "${short(titleOf(t.id), 30)}"`, {
      conf: t.how, detail: short(a.answer),
      read: graph => graph.blocks[t.id].questions[idx].answer || 'Not answered',
      apply(graph) { graph.blocks[t.id].questions[idx].answer = String(a.answer).trim() },
    })
  })

  // verify → assumption becomes a decision in place (same id: arrows survive)
  ;(Array.isArray(patch.verify) ? patch.verify : []).forEach(v => {
    const t = resolveRef(v?.block)
    if (!t) return miss('verify', v?.block, 'No unique block match')
    const b = state.blocks[t.id]
    if (b.type !== 'assumption') return miss('verify', b.title, 'Not an assumption')
    const verdict = v.verdict === 'refuted' ? 'refuted' : v.verdict === 'verified' ? 'verified' : null
    if (!verdict) return miss('verify', v?.block, 'verdict must be "verified" or "refuted"')
    const evidence = String(v.evidence || '').trim()
    if (!evidence) return miss('verify', b.title, 'No evidence given')
    add('verify', true, `${verdict === 'verified' ? 'Verified' : 'Refuted'}: "${short(b.title, 40)}" becomes a decision`, {
      conf: t.how, detail: short(evidence),
      read: graph => blockDetails(graph.blocks[t.id]),
      apply(graph) {
        const blk = graph.blocks[t.id]
        blk.type = 'decision'
        blk.rationale = (verdict === 'verified' ? 'Verified: ' : 'Refuted: ') + evidence
        blk.actions = (blk.actions || []).filter(x => x !== 'validate')
      },
    })
  })

  // status
  ;(Array.isArray(patch.status) ? patch.status : []).forEach(sOp => {
    const t = resolveRef(sOp?.block)
    if (!t) return miss('status', sOp?.block, 'No unique block match')
    if (typeof sOp?.status !== 'string' || !Object.hasOwn(STATUS_DEFS, sOp.status)) return miss('status', sOp?.block, 'Unknown status')
    add('status', true, `Status of "${short(titleOf(t.id), 40)}" → ${sOp.status}`, {
      conf: t.how,
      read: graph => STATUS_DEFS[graph.blocks[t.id].status || 'not-started']?.label || 'Not Started',
      apply(graph) { graph.blocks[t.id].status = sOp.status },
    })
  })

  // criteria → append, dedup, cap 30
  ;(Array.isArray(patch.criteria) ? patch.criteria : []).forEach(c => {
    const t = resolveRef(c?.block)
    if (!t) return miss('criteria', c?.block, 'No unique block match')
    const before = state.blocks[t.id].criteria || []
    const have = new Set(before.map(normTitle))
    const adds = []
    ;(Array.isArray(c.add) ? c.add : []).forEach(value => {
      const text = String(value || '').trim().slice(0, 300)
      if (!text || have.has(normTitle(text)) || before.length + adds.length >= 30) return
      have.add(normTitle(text)); adds.push(text)
    })
    if (!adds.length) return miss('criteria', c?.block, before.length >= 30 ? 'Already at the 30-criterion limit' : 'No new criteria to add')
    add('criteria', true, `${adds.length} acceptance criteri${adds.length === 1 ? 'on' : 'a'} on "${short(titleOf(t.id), 36)}"`, {
      conf: t.how, detail: short(adds.join(' · ')),
      read: graph => (graph.blocks[t.id].criteria || []).join('\n') || 'No acceptance criteria',
      apply(graph) {
        const blk = graph.blocks[t.id], all = [...(blk.criteria || [])]
        const known = new Set(all.map(normTitle))
        ;(Array.isArray(c.add) ? c.add : []).forEach(value => {
          const text = String(value || '').trim().slice(0, 300)
          if (!text || known.has(normTitle(text)) || all.length >= 30) return
          known.add(normTitle(text)); all.push(text)
        })
        blk.criteria = all
      },
    })
  })

  // notes → appended to the block's freeform notes, prefixed so review
  // remarks stay tellable-apart from the author's own. The read-only review
  // bar emits these; anything may.
  ;(Array.isArray(patch.notes) ? patch.notes : []).forEach(nOp => {
    const t = resolveRef(nOp?.block)
    if (!t) return miss('note', nOp?.block, 'No unique block match')
    const text = String(nOp?.note || '').trim()
    if (!text) return miss('note', nOp?.block, 'Empty note')
    add('note', true, `Note on "${short(titleOf(t.id), 40)}"`, {
      conf: t.how, detail: short(text),
      read: graph => graph.blocks[t.id].notes || 'No notes',
      apply(graph) {
        const blk = graph.blocks[t.id]
        blk.notes = (blk.notes ? blk.notes + '\n' : '') + 'Review: ' + text
      },
    })
  })

  // new blocks (normalized; ids remapped when they collide), then new arrows
  const idMap = new Map(), pendingTitle = new Map(), idCounts = new Map(), blockOps = new Map()
  const newBlocks = Array.isArray(patch.blocks) ? patch.blocks : []
  newBlocks.forEach(rb => {
    if (rb?.id == null) return
    const id = String(rb.id).trim()
    idCounts.set(id, (idCounts.get(id) || 0) + 1)
  })
  const placed = Object.values(state.blocks)
  let px = placed.length ? Math.max(...placed.map(b => b.x)) + 340 : 0
  let py = placed.length ? Math.min(...placed.map(b => b.y)) : 0
  newBlocks.forEach(rb => {
    if (rb?.id != null && idCounts.get(String(rb.id).trim()) > 1) {
      return miss('block', rb.id, 'Duplicate new block id; use a unique id for each block')
    }
    const clean = normalizeBlock({ ...rb, id: rb?.id ?? genId() })
    if (!clean) return miss('block', rb?.title ?? rb?.id, 'Unsalvageable block (missing id/known type)')
    const finalId = Object.hasOwn(state.blocks, clean.id) || Object.hasOwn(Object.prototype, clean.id) ? genId() : clean.id
    idMap.set(clean.id, finalId)
    pendingTitle.set(finalId, clean.title || '(new block)')
    const x = Number.isFinite(rb?.x) ? clean.x : px
    const y = Number.isFinite(rb?.y) ? clean.y : py
    if (!Number.isFinite(rb?.x)) py += 150
    blockOps.set(finalId, ops.length)
    add('block', true, `New ${clean.type}: "${short(clean.title || '(untitled)', 44)}"`, {
      read: graph => blockDetails(graph.blocks[finalId]),
      apply(graph) { graph.blocks[finalId] = { ...structuredClone(clean), id: finalId, x, y } },
    })
  })
  const connected = new Set(state.arrows.map(a => JSON.stringify([a.from, a.to])))
  ;(Array.isArray(patch.arrows) ? patch.arrows : []).forEach(ra => {
    const clean = normalizeArrow(ra)
    if (!clean) return miss('arrow', `${ra?.from} → ${ra?.to}`, 'Unsalvageable arrow')
    const end = ref => {
      if (idMap.has(ref)) return { id: idMap.get(ref), how: 'id' }
      // A rejected new block must not fall back to an existing block with
      // the same id and quietly attach a finding to the wrong target.
      return idCounts.has(ref) ? null : resolveRef(ref)
    }
    const nameOf = id => pendingTitle.get(id) || titleOf(id)
    const f = end(clean.from), t = end(clean.to)
    if (!f || !t) return miss('arrow', `${clean.from} → ${clean.to}`, 'No unique match for an endpoint')
    if (f.id === t.id) return miss('arrow', clean.from, 'Arrow to itself')
    const pair = JSON.stringify([f.id, t.id])
    if (connected.has(pair)) {
      return miss('arrow', `${nameOf(f.id)} → ${nameOf(t.id)}`, 'Already connected or included in this patch')
    }
    connected.add(pair)
    const arrowId = genId()
    add('arrow', true, `Connect "${short(nameOf(f.id) || clean.from, 26)}" → "${short(nameOf(t.id) || clean.to, 26)}"${clean.label ? ` (${short(clean.label, 20)})` : ''}`, {
      conf: f.how === 'fuzzy' || t.how === 'fuzzy' ? 'fuzzy' : 'id',
      requires: [f.id, t.id].filter(id => blockOps.has(id)).map(id => blockOps.get(id)),
      read: graph => graph.arrows.some(a => a.id === arrowId)
        ? `${nameOf(f.id)} → ${nameOf(t.id)}${connectionLabel(clean) ? '\nMeaning: ' + connectionLabel(clean) : ''}${clean.note ? '\nNote: ' + clean.note : ''}` : 'Not connected',
      apply(graph) {
        graph.arrows.push({ ...clean, id: arrowId, from: f.id, to: t.id })
      },
    })
  })

  return { ops, note: String(patch.note || '').trim(), baseline: planBaseline(), applied: false }
}

export function isPlanCurrent(plan) {
  return !!plan && !plan.applied && plan.baseline === planBaseline()
}

export function setPlanSelected(plan, id, selected) {
  const op = plan.ops[id]
  if (!op?.ok) return
  op.selected = selected
  if (selected) op.requires.forEach(required => setPlanSelected(plan, required, true))
  else plan.ops.filter(other => other.requires.includes(id)).forEach(other => setPlanSelected(plan, other.id, false))
}

export function selectedOps(plan) {
  return plan.ops.filter(op => op.ok && op.selected && op.requires.every(id => plan.ops[id]?.selected))
}

export function previewPlan(plan) {
  let draft = JSON.parse(JSON.stringify(state))
  return plan.ops.map(op => {
    if (!op.ok) return { ...op }
    const before = op.read(draft)
    const next = JSON.parse(JSON.stringify(draft))
    op.apply(next)
    const after = op.read(next)
    if (op.selected && op.requires.every(id => plan.ops[id]?.selected)) draft = next
    return { ...op, before, after }
  })
}

/** Mutate state per plan, as one undo step. Pure of DOM; the UI re-renders. */
export function applyPlan(plan) {
  if (ui.readOnly || ui.embed || !isPlanCurrent(plan)) return 0
  const runnable = selectedOps(plan)
  if (!runnable.length) return 0
  snapshot()
  runnable.forEach(o => o.apply(state))
  plan.applied = true
  saveState()
  ui.promptDirty = true
  window.dispatchEvent(new CustomEvent('pf:canvas-changed'))
  return runnable.length
}

// ── UI ───────────────────────────────────────────────────────

function renderPreview(host, plan, error) {
  if (error) { host.innerHTML = `<div class="patch-op err">${escHtml(error)}</div>`; return }
  const rows = previewPlan(plan).map(o => {
    const cls = o.ok ? (o.conf === 'fuzzy' ? 'warn' : 'ok') : 'err'
    const conf = o.ok && o.conf === 'fuzzy' ? ' <em>(matched by title, check it)</em>'
      : o.ok && o.conf === 'title' ? ' <em>(by title)</em>' : ''
    const toggle = o.ok ? `<input type="checkbox" data-patch-op="${o.id}" ${o.selected ? 'checked' : ''} aria-label="Include change: ${escHtml(o.label)}">` : ''
    const detail = o.ok ? `<details class="change-detail"><summary>Before and after</summary><strong>Before</strong><pre>${escHtml(o.before)}</pre><strong>After</strong><pre>${escHtml(o.after)}</pre></details>` : ''
    const dependency = o.requires.length ? '<div class="patch-op-detail">Including this connection also includes its new blocks.</div>' : ''
    return `<div class="patch-op ${cls}"><label>${toggle}<span><span class="patch-op-kind">${o.kind}</span> ${escHtml(o.label)}${conf}</span></label>${dependency}${detail}</div>`
  }).join('')
  const okCount = selectedOps(plan).length
  const head = plan.note ? `<div class="patch-op-note">${escHtml(short(plan.note, 120))}</div>` : ''
  host.innerHTML = head + (rows || '<div class="patch-op err">The patch contains no operations</div>') +
    `<div class="patch-op-sum">${okCount} of ${plan.ops.length} operation${plan.ops.length === 1 ? '' : 's'} will apply</div>`
}

export function setupPatchUI() {
  const openBtn = document.getElementById('patchOpenBtn')
  const panel = document.getElementById('patchPanel')
  if (!openBtn || !panel) return
  if (ui.readOnly) { document.getElementById('patchSection').style.display = 'none'; return }
  const input = document.getElementById('patchInput')
  const preview = document.getElementById('patchPreview')
  const applyBtn = document.getElementById('patchApplyBtn')
  let plan = null

  const refresh = () => {
    const { patch, error } = extractPatch(input.value)
    plan = error ? null : buildPlan(patch)
    renderPreview(preview, plan || { ops: [] }, error)
    applyBtn.disabled = !plan || !selectedOps(plan).length
  }

  preview.addEventListener('change', e => {
    if (!e.target.matches('[data-patch-op]') || !plan) return
    if (!isPlanCurrent(plan)) { refresh(); showToast('The canvas changed. Review the refreshed preview', 'warning'); return }
    setPlanSelected(plan, Number(e.target.dataset.patchOp), e.target.checked)
    renderPreview(preview, plan)
    applyBtn.disabled = !selectedOps(plan).length
    preview.querySelector(`[data-patch-op="${e.target.dataset.patchOp}"]`)?.focus()
  })

  openBtn.addEventListener('click', () => {
    const open = panel.style.display !== 'none'
    panel.style.display = open ? 'none' : ''
    if (!open) input.focus()
  })
  input.addEventListener('input', refresh)
  applyBtn.addEventListener('click', () => {
    if (!plan) return
    if (!isPlanCurrent(plan)) {
      refresh()
      showToast('The canvas changed. Review the updated preview, then apply again', 'warning', 3200)
      return
    }
    const addedBlocks = selectedOps(plan).some(o => o.kind === 'block')
    // Cmd+Z covers this session; the snapshot covers next week.
    takeSnapshot('Before the patch')
    const n = applyPlan(plan)
    if (!n) return
    renderAllBlocks(); renderArrows({ cheap: false }); renderFrames()
    runGapDetection(); renderInspector()
    // New blocks land beside the canvas; show them rather than leaving an
    // arrow running off the edge of the viewport.
    if (addedBlocks) fitView()
    ui.promptDirty = true
    if (ui.activeTab === 'prompt') refreshPrompt()
    input.value = ''; preview.innerHTML = ''; applyBtn.disabled = true
    panel.style.display = 'none'
    showToast(`Applied ${n} change${n === 1 ? '' : 's'}. One Cmd+Z undoes them all`, 'success', 2600)
  })
  document.getElementById('patchCancelBtn')?.addEventListener('click', () => {
    panel.style.display = 'none'
  })
}
