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

import { state, ui, snapshot, saveState } from './state.js'
import { genId, escHtml, showToast, STATUS_DEFS } from './utils.js'
import { normalizeBlock, normalizeArrow } from './normalize.js'
import { renderAllBlocks, renderInspector } from './render.js'
import { renderArrows, renderFrames, fitView } from './canvas.js'
import { runGapDetection } from './gaps.js'
import { refreshPrompt } from './prompt.js'
import { takeSnapshot } from './library.js'

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
  return { patch: data }
}

// ── Target resolution ────────────────────────────────────────

const normTitle = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Resolve an id-or-title reference to a live block. Never guesses on ambiguity. */
export function resolveRef(ref) {
  const key = String(ref ?? '').trim()
  if (!key) return null
  if (state.blocks[key]) return { id: key, how: 'id' }
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

export function buildPlan(patch) {
  const ops = []
  const add = (kind, ok, label, opts = {}) => ops.push({ kind, ok, label, ...opts })
  const miss = (kind, ref, why) => add(kind, false, `${why}: "${short(ref, 40)}"`)

  // answers → questions[i].answer
  ;(Array.isArray(patch.answers) ? patch.answers : []).forEach(a => {
    const t = resolveRef(a?.block)
    if (!t) return miss('answer', a?.block, 'No unique block match')
    const b = state.blocks[t.id]
    const qs = b.questions || []
    let idx = -1
    if (typeof a.question === 'number') idx = a.question
    else if (a.question != null) idx = qs.findIndex(q => normTitle(q.text) === normTitle(a.question))
    else if (qs.length === 1) idx = 0
    if (idx < 0 || !qs[idx]) return miss('answer', a?.question ?? a?.block, 'No matching question')
    if (!String(a.answer || '').trim()) return miss('answer', a?.block, 'Empty answer')
    add('answer', true, `Answer "${short(qs[idx].text, 44)}" on "${short(titleOf(t.id), 30)}"`, {
      conf: t.how, detail: short(a.answer),
      apply() { state.blocks[t.id].questions[idx].answer = String(a.answer).trim() },
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
      apply() {
        const blk = state.blocks[t.id]
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
    if (!STATUS_DEFS[sOp?.status]) return miss('status', sOp?.status, 'Unknown status')
    add('status', true, `Status of "${short(titleOf(t.id), 40)}" → ${sOp.status}`, {
      conf: t.how,
      apply() { state.blocks[t.id].status = sOp.status },
    })
  })

  // criteria → append, dedup, cap 30
  ;(Array.isArray(patch.criteria) ? patch.criteria : []).forEach(c => {
    const t = resolveRef(c?.block)
    if (!t) return miss('criteria', c?.block, 'No unique block match')
    const adds = (Array.isArray(c.add) ? c.add : []).map(x => String(x || '').trim()).filter(Boolean)
    if (!adds.length) return miss('criteria', c?.block, 'Nothing to add')
    add('criteria', true, `${adds.length} acceptance criteri${adds.length === 1 ? 'on' : 'a'} on "${short(titleOf(t.id), 36)}"`, {
      conf: t.how, detail: short(adds.join(' · ')),
      apply() {
        const blk = state.blocks[t.id]
        const have = new Set((blk.criteria || []).map(normTitle))
        blk.criteria = [...(blk.criteria || []), ...adds.filter(x => !have.has(normTitle(x)))].slice(0, 30)
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
      apply() {
        const blk = state.blocks[t.id]
        blk.notes = (blk.notes ? blk.notes + '\n' : '') + 'Review: ' + text
      },
    })
  })

  // new blocks (normalized; ids remapped when they collide), then new arrows
  const idMap = {}
  const placed = Object.values(state.blocks)
  let px = placed.length ? Math.max(...placed.map(b => b.x)) + 340 : 0
  let py = placed.length ? Math.min(...placed.map(b => b.y)) : 0
  ;(Array.isArray(patch.blocks) ? patch.blocks : []).forEach(rb => {
    const clean = normalizeBlock({ ...rb, id: rb?.id ?? genId() })
    if (!clean) return miss('block', rb?.title ?? rb?.id, 'Unsalvageable block (missing id/known type)')
    const finalId = state.blocks[clean.id] ? genId() : clean.id
    idMap[rb?.id ?? clean.id] = finalId
    const x = Number.isFinite(rb?.x) ? clean.x : px
    const y = Number.isFinite(rb?.y) ? clean.y : py
    if (!Number.isFinite(rb?.x)) py += 150
    add('block', true, `New ${clean.type}: "${short(clean.title || '(untitled)', 44)}"`, {
      apply() { state.blocks[finalId] = { ...clean, id: finalId, x, y } },
    })
  })
  const pendingTitle = {}
  ;(Array.isArray(patch.blocks) ? patch.blocks : []).forEach(rb => {
    const mapped = idMap[rb?.id]
    if (mapped) pendingTitle[mapped] = String(rb?.title || '(new block)')
  })
  ;(Array.isArray(patch.arrows) ? patch.arrows : []).forEach(ra => {
    const clean = normalizeArrow(ra)
    if (!clean) return miss('arrow', `${ra?.from} → ${ra?.to}`, 'Unsalvageable arrow')
    const end = ref => idMap[ref] ? { id: idMap[ref], how: 'id' } : resolveRef(ref)
    const nameOf = id => pendingTitle[id] || titleOf(id)
    const f = end(clean.from), t = end(clean.to)
    if (!f || !t) return miss('arrow', `${clean.from} → ${clean.to}`, 'No unique match for an endpoint')
    if (f.id === t.id) return miss('arrow', clean.from, 'Arrow to itself')
    if (state.arrows.some(x => x.from === f.id && x.to === t.id)) {
      return miss('arrow', `${titleOf(f.id)} → ${titleOf(t.id)}`, 'Already connected')
    }
    add('arrow', true, `Connect "${short(nameOf(f.id) || clean.from, 26)}" → "${short(nameOf(t.id) || clean.to, 26)}"${clean.label ? ` (${short(clean.label, 20)})` : ''}`, {
      conf: f.how === 'fuzzy' || t.how === 'fuzzy' ? 'fuzzy' : 'id',
      apply() {
        state.arrows.push({ ...clean, id: genId(), from: f.id, to: t.id })
        // titleOf resolves lazily above, so a new-block endpoint reads right
        // in the preview only after its block op runs; the arrow op itself is
        // ordered after every block op by construction.
      },
    })
  })

  return { ops, note: String(patch.note || '').trim() }
}

/** Mutate state per plan, as one undo step. Pure of DOM; the UI re-renders. */
export function applyPlan(plan) {
  const runnable = plan.ops.filter(o => o.ok)
  if (!runnable.length) return 0
  snapshot()
  runnable.forEach(o => o.apply())
  saveState()
  return runnable.length
}

// ── UI ───────────────────────────────────────────────────────

function renderPreview(host, plan, error) {
  if (error) { host.innerHTML = `<div class="patch-op err">${escHtml(error)}</div>`; return }
  const rows = plan.ops.map(o => {
    const cls = o.ok ? (o.conf === 'fuzzy' ? 'warn' : 'ok') : 'err'
    const conf = o.ok && o.conf === 'fuzzy' ? ' <em>(matched by title, check it)</em>'
      : o.ok && o.conf === 'title' ? ' <em>(by title)</em>' : ''
    const detail = o.detail ? `<div class="patch-op-detail">${escHtml(o.detail)}</div>` : ''
    return `<div class="patch-op ${cls}"><span class="patch-op-kind">${o.kind}</span> ${escHtml(o.label)}${conf}${detail}</div>`
  }).join('')
  const okCount = plan.ops.filter(o => o.ok).length
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
    applyBtn.disabled = !plan || !plan.ops.some(o => o.ok)
  }

  openBtn.addEventListener('click', () => {
    const open = panel.style.display !== 'none'
    panel.style.display = open ? 'none' : ''
    if (!open) input.focus()
  })
  input.addEventListener('input', refresh)
  applyBtn.addEventListener('click', () => {
    if (!plan) return
    const addedBlocks = plan.ops.some(o => o.ok && o.kind === 'block')
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
