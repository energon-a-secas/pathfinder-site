import { connectionLabel } from './relations.js'
// ════════════════════════════════════════════════════════════
//  patch.js: the round trip. An assistant's reply can end with
//  a fenced ```pathfinder-patch``` JSON block; this module finds
//  it, previews every operation against the live canvas, and
//  applies the lot as ONE undo step.
//
//  The failure it exists to prevent: an investigation whose
//  answers die in the chat log. Answers land in their question
//  blocks (an Open Question card holds its own and is marked
//  done), a verified or refuted assumption becomes a decision
//  in place (same id, so its arrows survive; a refuted claim is
//  never kept as the decision's title), statuses and criteria
//  update, and new findings arrive as wired blocks.
//
//  Addressing: an op names a block by id (the prompt now prints
//  an id map) or by title. Ids win; an exact title match is
//  trusted; a unique fuzzy match is applied but labeled in the
//  preview; anything ambiguous or unknown is refused, never
//  guessed, and every refusal names cards by their titles.
// ════════════════════════════════════════════════════════════

import { state, ui, snapshot, saveState, serializeCanvas } from './state.js'
import { genId, escHtml, showToast, STATUS_DEFS, TYPES, DEFAULT_WIDTH } from './utils.js'
import { placeNewBlocks, occupiedRects } from './create.js'
import { normalizeBlock, normalizeArrow } from './normalize.js'
import { retypeBlock } from './type-menu.js'
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
    return { error: 'That looks like a whole canvas, not a patch. Use File, Import JSON / Canvas / Mermaid for it' }
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

const short = (s, n = 70) => { const t = String(s || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
const titleOf = id => state.blocks[id]?.title || '(untitled)'
const named = id => `"${short(titleOf(id), 40)}"`
// A patch is JSON somebody else wrote: only a string (or a number) is text.
// An object would otherwise land on the card as "[object Object]".
const asText = v => typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
const oneLine = s => asText(s).replace(/\s+/g, ' ')

/**
 * Why a reference resolved to nothing, in card titles. The person reading
 * the preview sees titles, not ids, and "matches 2 cards" only helps when it
 * says which two.
 */
export function explainRef(ref) {
  const key = String(ref ?? '').trim()
  if (!key) return 'No card given'
  const want = normTitle(key)
  const all = Object.values(state.blocks)
  const exact = all.filter(b => normTitle(b.title) === want)
  const hits = exact.length > 1 ? exact : all.filter(b => normTitle(b.title).includes(want))
  if (hits.length > 1) {
    const names = hits.slice(0, 3).map(b => `"${short(b.title || '(untitled)', 30)}"`).join(', ')
    return `"${short(key, 40)}" matches ${hits.length} cards (${names}${hits.length > 3 ? ', …' : ''}); use the card's id`
  }
  return `No card matches "${short(key, 40)}"`
}

/**
 * Which question an `answers` entry fills on block `b`: an index into its
 * questions[] ({ idx }), the Open Question card itself ({ card: true }), or
 * a refusal worded around the card's title ({ error }). On a question card
 * an omitted `question` means the card: the card is the question.
 */
function answerTarget(b, q) {
  const qs = b.questions || []
  const isCard = b.type === 'question'
  const name = named(b.id)
  if (typeof q === 'number') {
    if (Number.isInteger(q) && q >= 0 && qs[q]) return { idx: q }
    if (isCard && q === 0 && !qs.length) return { card: true }
    return { error: `${name} has no question ${q}` }
  }
  if (q != null && typeof q !== 'string') return { error: `"question" on ${name} must be an index or the question's text` }
  if (oneLine(q)) {
    const want = normTitle(q)
    const matches = qs.map((x, i) => normTitle(x?.text) === want ? i : -1).filter(i => i >= 0)
    if (matches.length === 1) return { idx: matches[0] }
    if (matches.length > 1) return { error: `${matches.length} questions on ${name} read "${short(q, 40)}"; give its index` }
    if (isCard && want === normTitle(b.title)) return { card: true }
    return { error: `No question on ${name} reads "${short(q, 40)}"` }
  }
  if (isCard) return { card: true }
  if (qs.length === 1) return { idx: 0 }
  if (b.type === 'assumption') return { error: `${name} is an assumption: send it under verify, with a verdict and evidence` }
  return { error: qs.length
    ? `${name} has ${qs.length} questions; name one by its index or its text`
    : `${name} has no question to answer` }
}

const statusLabelOf = blk => STATUS_DEFS[blk?.status || 'not-started']?.label || 'Not Started'

// ── Plan: one entry per operation, applied only when ok ──────

const planBaseline = () => JSON.stringify({ map: currentId(), canvas: serializeCanvas() })

export function buildPlan(patch) {
  const ops = []
  const add = (kind, ok, label, opts = {}) => ops.push({ id: ops.length, kind, ok, label, selected: ok, requires: [], ...opts })
  const miss = (kind, ref, why) => add(kind, false, `${why}: "${short(ref, 40)}"`)
  // A refusal already worded in titles, and one for a reference that found
  // no single card.
  const refuse = (kind, text) => add(kind, false, text)
  const unresolved = (kind, ref) => refuse(kind, explainRef(ref))

  // answers → questions[i].answer, or an Open Question card's own answer
  ;(Array.isArray(patch.answers) ? patch.answers : []).forEach(a => {
    const t = resolveRef(a?.block)
    if (!t) return unresolved('answer', a?.block)
    const b = state.blocks[t.id]
    const target = answerTarget(b, a?.question)
    if (target.error) return refuse('answer', target.error)
    const text = asText(a?.answer)
    if (!text) return refuse('answer', `Empty answer for ${named(t.id)}`)
    if (target.card) {
      // The card is the question: the answer is its own field, and an
      // answered question is done, so Attention stops listing it.
      const had = !!String(b.answer || '').trim()
      add('answer', true, `${had ? 'Replace the answer on' : 'Answer'} "${short(titleOf(t.id), 44)}"${b.status === 'done' ? '' : ' and mark it done'}`, {
        conf: t.how, detail: short(text),
        read: graph => {
          const blk = graph.blocks[t.id]
          return `${String(blk.answer || '').trim() ? blk.answer : 'Not answered'}\nStatus: ${statusLabelOf(blk)}`
        },
        apply(graph) {
          const blk = graph.blocks[t.id]
          blk.answer = text
          blk.status = 'done'
        },
      })
      return
    }
    const idx = target.idx
    add('answer', true, `Answer "${short(b.questions[idx].text, 44)}" on "${short(titleOf(t.id), 30)}"`, {
      conf: t.how, detail: short(text),
      read: graph => graph.blocks[t.id].questions[idx].answer || 'Not answered',
      apply(graph) { graph.blocks[t.id].questions[idx].answer = text },
    })
  })

  // verify → assumption becomes a decision in place (same id: arrows survive).
  // A refuted claim never stays on as the decision's title: the card would
  // state the opposite of what was found, and so would every later prompt.
  ;(Array.isArray(patch.verify) ? patch.verify : []).forEach(v => {
    const t = resolveRef(v?.block)
    if (!t) return unresolved('verify', v?.block)
    const b = state.blocks[t.id]
    if (b.type !== 'assumption') {
      return refuse('verify', `${named(t.id)} is not an assumption (it is ${TYPES[b.type] ? 'a ' + TYPES[b.type].label : 'untyped'})`)
    }
    const verdict = v.verdict === 'refuted' ? 'refuted' : v.verdict === 'verified' ? 'verified' : null
    if (!verdict) return refuse('verify', `The verdict on ${named(t.id)} must be "verified" or "refuted"`)
    const evidence = asText(v.evidence)
    if (!evidence) return refuse('verify', `No evidence for ${named(t.id)}: a verdict without evidence is still a guess`)
    const claim = oneLine(b.title) || '(untitled)'
    const decided = oneLine(v.decision)
    const title = verdict === 'refuted' ? (decided || `Not true: ${claim}`) : b.title
    add('verify', true, verdict === 'verified'
      ? `Verified: "${short(claim, 40)}" becomes a decision`
      : `Refuted: "${short(claim, 34)}" becomes the decision "${short(title, 34)}"`, {
      conf: t.how, detail: short(evidence),
      read: graph => blockDetails(graph.blocks[t.id]),
      apply(graph) {
        const blk = graph.blocks[t.id]
        const was = oneLine(blk.title) || '(untitled)'
        const description = String(blk.description || '').trim()
        const prior = String(blk.rationale || '').trim()
        // The one retype rule: the type check and a carried type hint go, and
        // so does a colour that was only the assumption's colour.
        Object.assign(blk, retypeBlock(blk, 'decision') || { type: 'decision' })
        blk.actions = (blk.actions || []).filter(x => x !== 'validate')
        if (verdict === 'verified') {
          blk.rationale = ['Verified: ' + evidence, decided && 'Decision: ' + decided, prior].filter(Boolean).join('\n')
          return
        }
        // Refuted: the title says what is true now. The false claim, and the
        // description that argued for it, stay as the record of what was
        // believed, in the rationale, never as a statement on the card.
        blk.title = title
        blk.description = ''
        blk.rationale = ['Refuted: ' + evidence, 'The assumption was: ' + was, description, prior].filter(Boolean).join('\n')
      },
    })
  })

  // status
  ;(Array.isArray(patch.status) ? patch.status : []).forEach(sOp => {
    const t = resolveRef(sOp?.block)
    if (!t) return unresolved('status', sOp?.block)
    if (typeof sOp?.status !== 'string' || !Object.hasOwn(STATUS_DEFS, sOp.status)) {
      return refuse('status', `Unknown status "${short(sOp?.status, 24)}" for ${named(t.id)}; use ${Object.keys(STATUS_DEFS).join(', ')}`)
    }
    add('status', true, `Status of "${short(titleOf(t.id), 40)}" → ${sOp.status}`, {
      conf: t.how,
      read: graph => STATUS_DEFS[graph.blocks[t.id].status || 'not-started']?.label || 'Not Started',
      apply(graph) { graph.blocks[t.id].status = sOp.status },
    })
  })

  // criteria → append, dedup, cap 30
  ;(Array.isArray(patch.criteria) ? patch.criteria : []).forEach(c => {
    const t = resolveRef(c?.block)
    if (!t) return unresolved('criteria', c?.block)
    const before = state.blocks[t.id].criteria || []
    const have = new Set(before.map(normTitle))
    const adds = []
    ;(Array.isArray(c.add) ? c.add : []).forEach(value => {
      const text = asText(value).slice(0, 300)
      if (!text || have.has(normTitle(text)) || before.length + adds.length >= 30) return
      have.add(normTitle(text)); adds.push(text)
    })
    if (!adds.length) {
      return refuse('criteria', before.length >= 30
        ? `${named(t.id)} is already at the 30-criterion limit`
        : `No new criteria for ${named(t.id)}`)
    }
    add('criteria', true, `${adds.length} acceptance criteri${adds.length === 1 ? 'on' : 'a'} on "${short(titleOf(t.id), 36)}"`, {
      conf: t.how, detail: short(adds.join(' · ')),
      read: graph => (graph.blocks[t.id].criteria || []).join('\n') || 'No acceptance criteria',
      apply(graph) {
        const blk = graph.blocks[t.id], all = [...(blk.criteria || [])]
        const known = new Set(all.map(normTitle))
        ;(Array.isArray(c.add) ? c.add : []).forEach(value => {
          const text = asText(value).slice(0, 300)
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
    if (!t) return unresolved('note', nOp?.block)
    const text = asText(nOp?.note)
    if (!text) return refuse('note', `Empty note for ${named(t.id)}`)
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
  // A new block without coordinates is placed once the arrows are read, next
  // to what it connects to (placeNewBlocks); apply reads the result.
  const where = new Map(), autoPlace = []
  newBlocks.forEach(rb => {
    if (rb?.id != null && idCounts.get(String(rb.id).trim()) > 1) {
      return miss('block', rb.id, 'Duplicate new block id; use a unique id for each block')
    }
    const clean = normalizeBlock({ ...rb, id: rb?.id ?? genId() })
    if (!clean) return miss('block', rb?.title ?? rb?.id, 'Unsalvageable block (missing id/known type)')
    // Loading a saved canvas keeps an unknown type as Other (forward
    // compatibility). A patch is different: the prompt listed the types, so an
    // unknown one is a mistake to report, not a block to guess at.
    if (clean.typeHint) return miss('block', rb?.title ?? rb?.id, `Unknown block type "${clean.typeHint}"`)
    const finalId = Object.hasOwn(state.blocks, clean.id) || Object.hasOwn(Object.prototype, clean.id) ? genId() : clean.id
    idMap.set(clean.id, finalId)
    pendingTitle.set(finalId, clean.title || '(new block)')
    // Both coordinates: kept as given. One: where the search for a free
    // slot starts, beside what the block connects to on the other axis.
    if (Number.isFinite(rb?.x) && Number.isFinite(rb?.y)) where.set(finalId, { x: clean.x, y: clean.y, w: clean.width || DEFAULT_WIDTH })
    else {
      autoPlace.push({ key: finalId, w: clean.width || undefined,
        fixed: { x: Number.isFinite(rb?.x) ? clean.x : undefined, y: Number.isFinite(rb?.y) ? clean.y : undefined } })
    }
    blockOps.set(finalId, ops.length)
    add('block', true, `New ${clean.type}: "${short(clean.title || '(untitled)', 44)}"`, {
      read: graph => blockDetails(graph.blocks[finalId]),
      apply(graph) {
        const at = where.get(finalId) || { x: 0, y: 0 }
        graph.blocks[finalId] = { ...structuredClone(clean), id: finalId, x: at.x, y: at.y }
      },
    })
  })
  const links = []
  const connected = new Set(state.arrows.map(a => JSON.stringify([a.from, a.to])))
  ;(Array.isArray(patch.arrows) ? patch.arrows : []).forEach(ra => {
    const clean = normalizeArrow(ra)
    if (!clean) {
      const from = String(ra?.from ?? '').trim(), to = String(ra?.to ?? '').trim()
      const hit = from && resolveRef(from)
      return refuse('arrow', from && from === to
        ? `"${short(hit ? titleOf(hit.id) : from, 40)}" cannot connect to itself`
        : 'A connection needs both ends, "from" and "to"')
    }
    const end = ref => {
      if (idMap.has(ref)) return { id: idMap.get(ref), how: 'id' }
      // A rejected new block must not fall back to an existing block with
      // the same id and quietly attach a finding to the wrong target.
      return idCounts.has(ref) ? null : resolveRef(ref)
    }
    const nameOf = id => pendingTitle.get(id) || titleOf(id)
    const f = end(clean.from), t = end(clean.to)
    if (!f || !t) {
      // Say which end failed, and why, in titles where there are titles.
      const side = (ref, hit) => hit ? `"${short(nameOf(hit.id), 26)}"` : `"${short(ref, 26)}"`
      const why = (ref, hit) => hit ? '' : idCounts.has(ref) ? `the new card "${short(ref, 26)}" was refused` : explainRef(ref)
      const reasons = [why(clean.from, f), why(clean.to, t)].filter(Boolean)
      return refuse('arrow', `Cannot connect ${side(clean.from, f)} → ${side(clean.to, t)}: ${reasons.join('; ')}`)
    }
    if (f.id === t.id) return refuse('arrow', `"${short(nameOf(f.id), 40)}" cannot connect to itself`)
    const pair = JSON.stringify([f.id, t.id])
    if (connected.has(pair)) {
      return miss('arrow', `${nameOf(f.id)} → ${nameOf(t.id)}`, 'Already connected or included in this patch')
    }
    connected.add(pair)
    links.push({ from: f.id, to: t.id })
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

  // New blocks land beside what they connect to (right of a block that
  // points at them, left of one they point at), never on a card.
  if (autoPlace.length) {
    autoPlace.forEach(it => {
      it.anchors = links.filter(l => l.from === it.key || l.to === it.key)
        .map(l => l.to === it.key ? { id: l.from, side: 'right' } : { id: l.to, side: 'left' })
    })
    // A new block with coordinates is a card in the way and an anchor too.
    const known = new Map([...where].map(([key, p]) => [key, { x: p.x, y: p.y, w: p.w, h: 100 }]))
    placeNewBlocks(autoPlace, { occupied: [...occupiedRects(), ...known.values()], known }).forEach((p, key) => where.set(key, p))
  }

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
    const inside = panel.contains(document.activeElement)
    panel.style.display = 'none'
    if (inside) openBtn.focus({ preventScroll: true })
    showToast(`Applied ${n} change${n === 1 ? '' : 's'}. One Cmd+Z undoes them all`, 'success', 2600)
  })
  // Close hides the panel it sits in: hand focus back to the button that
  // opened it rather than dropping it to the page.
  document.getElementById('patchCancelBtn')?.addEventListener('click', () => {
    const inside = panel.contains(document.activeElement)
    panel.style.display = 'none'
    if (inside) openBtn.focus({ preventScroll: true })
  })
}
