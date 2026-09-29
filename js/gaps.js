// ════════════════════════════════════════════════════════════
//  gaps.js: gap detection. A pure rule engine (detectGaps) over
//  the blocks and arrows, the DOM writer that paints its result
//  (runGapDetection), canvas-level findings, and gap acceptance.
// ════════════════════════════════════════════════════════════

import { dependencyEdges } from './relations.js'
import { state, selection, ui, snapshot } from './state.js'
import { getBlockEl, TYPES, TYPE_STEPS } from './utils.js'
import { breakCycles } from './layout.js'
import { mutateBlock, mutateBlocks, renderInspector, blockDecorators } from './render.js'

// ── Rules ────────────────────────────────────────────────────
//
// One gap per block. Isolation is checked first and wins outright: every
// type rule below assumes the block is connected and asks whether it is
// connected to the right things. The type rules then run in this order and
// the first one that fires is the block's gap (methodology.md "Insights"):
// assumption, goal, problem, risk, decision, output (producer, then
// consumer), requirement, process, implementation, metric (goal, then
// target), stakeholder. Custom ("Other") has no type rule on purpose: it is
// the untyped bucket, and the canvas-level "untyped" finding covers it.

// What gives a piece of implementation work its reason to exist.
const PURPOSE = ['goal', 'requirement', 'problem', 'metric', 'output', 'stakeholder']
// What a stakeholder can receive, own or be asked for.
const SERVES = ['output', 'metric', 'goal', 'requirement', 'decision']

/** A criteria or targets list with at least one real line in it. */
export const hasCriteria = b => (b.criteria || []).some(c => typeof c === 'string' && c.trim())

const acts = b => b.actions || []

// [gap id, block type, fires(ctx)] in reporting order. ctx carries the block,
// its connection counts and a `linked(types)` test over its neighbours.
const TYPE_RULES = [
  ['gap-assumption', 'assumption', c => !acts(c.b).includes('validate') && !c.linked(['goal', 'requirement'])],
  // A goal is supported by a requirement, a metric or the work itself: an
  // OKR-shaped goal, key result, initiative chain is not a gap.
  ['gap-no-req', 'goal', c => !c.linked(['requirement', 'metric', 'implementation'])],
  ['gap-unaddressed', 'problem', c => !acts(c.b).includes('resolve') && !c.out],
  ['gap-no-mitigation', 'risk', c => !c.out && !acts(c.b).includes('prepare')],
  ['gap-no-basis', 'decision', c => !c.inc && !(c.b.rationale || '').trim()],
  ['gap-no-producer', 'output', c => !c.inc],
  // Only once the map models an audience or a measure: without either, every
  // sink output of a legacy canvas (and of the templates) would light up.
  ['gap-no-consumer', 'output', c => c.hasAudience && !c.out && !c.linked(['stakeholder'])],
  ['gap-no-criteria', 'requirement', c => !hasCriteria(c.b)],
  // A flow can pass THROUGH ordinary blocks (the tutorial example does), so
  // "outside any flow" means its whole component holds no other flow node.
  ['gap-loose-step', 'process', c => c.flowInComp < 2],
  ['gap-no-purpose', 'implementation', c => !c.linked(PURPOSE)],
  ['gap-metric-no-goal', 'metric', c => !c.linked(['goal'])],
  ['gap-no-target', 'metric', c => !hasCriteria(c.b)],
  ['gap-unserved', 'stakeholder', c => !c.linked(SERVES)],
]

/** Every gap id, in the order the rules are checked. */
export const GAP_ORDER = ['gap-isolated', ...TYPE_RULES.map(r => r[0])]
const RULES = new Map(TYPE_RULES.map(r => [r[0], r]))

/**
 * Canvas findings an author can accept, and the id the acceptance is stored
 * under in each named block's gapAck (the one slot that travels with the
 * canvas). Only findings that can be a deliberate choice are listed: a
 * cycle, an empty group, an unchecked type or an untyped block is something
 * to fix, not to keep.
 */
export const FINDING_ACKS = {
  duplicate: 'gap-finding-duplicate',
  'hidden-question': 'gap-finding-hidden-question',
  'goal-no-metric': 'gap-finding-goal-no-metric',
  'metric-unmoved': 'gap-finding-metric-unmoved',
}
const FINDING_OF_ACK = Object.fromEntries(Object.entries(FINDING_ACKS).map(([k, v]) => [v, k]))
const ACK_IDS = new Set([...GAP_ORDER, ...Object.values(FINDING_ACKS)])

/** The criteria-list gap for a type, when that type has one. */
export const CRITERIA_GAPS = { requirement: 'gap-no-criteria', metric: 'gap-no-target' }

const isAcked = (b, gap) => Array.isArray(b.gapAck) && b.gapAck.includes(gap)

/**
 * Pure gap detection: no DOM, no state. Returns
 *   { count, details: [{ id, title, type, gaps: [gapId] }],
 *     accepted: [{ id, title, type, gap, live }], stale: [same shape],
 *     canvasFindings: [string], findings: [{ kind, text, ids }] }
 * `details` holds at most one gap per block. A gap listed in the block's
 * `gapAck` is not reported, and a type rule further down may still fire
 * (accepting "nothing produces this" says nothing about who receives it).
 * Accepting isolation ends the checks for that block, since every type rule
 * assumes a connected block.
 *
 * Every gapAck entry lands in one of two lists, in block order. `accepted`
 * holds the acceptances that still stand: the rule's own condition holds
 * now, whatever the precedence (`live: true`, possibly behind another gap),
 * or it cannot be re-checked (`live: null`: a check this build does not
 * know, or a finding ack when findings were not computed). That is the list
 * the prompt's Accepted gaps section prints (prompt.js reads it as "still
 * fires"). `stale` holds the ones the canvas no longer raises (`live:
 * false`), which the Attention tab offers to clear and the prompt leaves out.
 */
export function detectGaps(blocks = {}, arrows = [], { groups = {}, findings: withFindings = true } = {}) {
  const ids = Object.keys(blocks)
  const inc = new Map(ids.map(id => [id, []]))
  const out = new Map(ids.map(id => [id, []]))
  arrows.forEach(a => {
    if (inc.has(a.to)) inc.get(a.to).push(a.from)
    if (out.has(a.from)) out.get(a.from).push(a.to)
  })

  // Connected components, for the loose-step rule.
  const comp = new Map(ids.map(id => [id, id]))
  const find = x => { let r = x; while (comp.get(r) !== r) r = comp.get(r); comp.set(x, r); return r }
  arrows.forEach(a => { if (comp.has(a.from) && comp.has(a.to)) comp.set(find(a.from), find(a.to)) })
  const flowInComp = new Map()
  ids.forEach(id => {
    const t = blocks[id].type
    if (t === 'process' || t === 'terminator') flowInComp.set(find(id), (flowInComp.get(find(id)) || 0) + 1)
  })
  const hasAudience = ids.some(id => blocks[id].type === 'stakeholder' || blocks[id].type === 'metric')

  const details = [], holds = new Map()
  ids.forEach(id => {
    const b = blocks[id]
    const ins = inc.get(id), outs = out.get(id)
    const isolated = !ins.length && !outs.length
    const neighbours = [...ins, ...outs].map(n => blocks[n]).filter(Boolean)
    const ctx = {
      b, inc: ins.length, out: outs.length, hasAudience, flowInComp: flowInComp.get(find(id)) || 0,
      linked: types => neighbours.some(x => types.includes(x.type)),
    }
    holds.set(id, gap => gap === 'gap-isolated' ? isolated
      : RULES.has(gap) ? b.type === RULES.get(gap)[1] && RULES.get(gap)[2](ctx) : null)
    const report = gap => {
      if (isAcked(b, gap)) return false
      details.push({ id, title: b.title || '(untitled)', type: b.type, gaps: [gap] }); return true
    }
    if (isolated) { report('gap-isolated'); return }
    for (const [gap, type, fires] of TYPE_RULES) {
      if (b.type === type && fires(ctx) && report(gap)) return
    }
  })

  const { findings, members } = withFindings
    ? canvasFindingsFor(blocks, arrows, groups, { inc, out })
    : { findings: [], members: null }

  const accepted = [], stale = []
  ids.forEach(id => {
    const b = blocks[id]
    if (!Array.isArray(b.gapAck)) return
    b.gapAck.forEach(gap => {
      const kind = FINDING_OF_ACK[gap]
      const live = kind ? (members ? members.get(kind).has(id) : null) : holds.get(id)(gap)
      ;(live === false ? stale : accepted).push({ id, title: b.title || '(untitled)', type: b.type, gap, live })
    })
  })
  return { count: details.length, details, accepted, stale, canvasFindings: findings.map(f => f.text), findings }
}

// ── Canvas-level findings ────────────────────────────────────
// Real problems that belong to no single block. Each is { kind, text, ids }:
// `text` is what the prompt prints, `ids` the blocks worth jumping to.

/** A short name per finding kind, for the Attention row's heading. */
export const FINDING_META = {
  cycle: { short: 'Dependency cycle' },
  'empty-group': { short: 'Empty group' },
  untyped: { short: 'Untyped blocks' },
  'no-why': { short: 'No Why on the map' },
  'goal-no-metric': { short: 'Goals with no metric' },
  'metric-unmoved': { short: 'Metrics no work moves' },
  duplicate: { short: 'Possible duplicates' },
  'hidden-question': { short: 'Questions in descriptions' },
  'type-check': { short: 'Types to confirm' },
}

const DEFAULT_TITLE = /^untitled( \d+)?$/i
const normTitle = t => ` ${String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
const quoteList = (titles, max = 3) => {
  const shown = titles.slice(0, max).map(t => `"${t || '(untitled)'}"`).join(', ')
  return titles.length > max ? `${shown} and ${titles.length - max} more` : shown
}
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

// A question parked in a description, where nothing tracks it. A "?" counts
// only when it ends its line: text after it on the same line is its answer
// ("Why does this matter? Because churn."). URLs go first so a query
// string's "?" is not read as one.
const HIDDEN_QUESTION = /\?[)\]"'\u201d\u2019]*[ \t]*(?:\r?\n|$)|\b(tbd|tbc|to be (confirmed|decided|determined))\b|\b(check|verify|confirm) (if|whether)\b|\(\s*(check|verify|confirm)\b/i
export const hidesQuestion = text => HIDDEN_QUESTION.test(String(text || '').replace(/\bhttps?:\/\/\S+/gi, ''))

// Two titles are a possible duplicate when they match after normalising, or
// when the shorter (two words or more) sits inside the longer on word
// boundaries and covers at least three quarters of its words. "End of
// Sprint" in "Every End of Sprint" is one; "Export PDF" in "Export PDF
// button" is the usual requirement and the work that satisfies it.
const DUPLICATE_COVERAGE = 0.75

function canvasFindingsFor(blocks, arrows, groups, { inc, out }) {
  const findings = []
  const add = (kind, text, ids = []) => findings.push({ kind, text, ids })
  // Who each acceptable finding names before acceptances are applied: an
  // accepted finding ack is live while its block would still be named.
  const members = new Map(Object.keys(FINDING_ACKS).map(k => [k, new Set()]))
  const open = (kind, list) => {
    list.forEach(b => members.get(kind).add(b.id))
    return list.filter(b => !isAcked(b, FINDING_ACKS[kind]))
  }
  const list = Object.values(blocks)
  const ids = Object.keys(blocks)
  const n = ids.length
  const linkedTypes = id => [...(inc.get(id) || []), ...(out.get(id) || [])].map(x => blocks[x]?.type).filter(Boolean)
  const ofType = t => list.filter(b => b.type === t)

  if (n) {
    const edges = dependencyEdges(blocks, arrows)
    const { reversed } = breakCycles(ids, edges)
    if (reversed.size) {
      const cyc = [...new Set([...reversed].flatMap(i => [edges[i].from, edges[i].to]))]
      add('cycle', `${reversed.size} connection${reversed.size === 1 ? '' : 's'} close a cycle: the dependency order is circular somewhere`, cyc)
    }
  }
  Object.values(groups || {}).forEach(g => {
    if (!list.some(b => b.groupId === g.id)) add('empty-group', `group "${g.label || '(unnamed)'}" has a name and no members`)
  })

  // Untyped share. Two or more is the floor for the percentage branch, so a
  // map that is one Other block so far is not told it is 100% untyped.
  const untyped = ofType('custom')
  if (untyped.length >= 3 || (untyped.length >= 2 && untyped.length / n > 0.25)) {
    add('untyped', `${untyped.length} of ${n} blocks are untyped (Other): gap checks skip them and the AI has to guess what they are. Give each a type`,
      untyped.map(b => b.id))
  }

  // Why: nothing says what the work is for.
  if (n >= 5 && !list.some(b => TYPES[b.type]?.step === 'why')) {
    add('no-why', `${n} blocks and no Goal or Problem: nothing says why this work exists. Start with the Why`)
  }

  // Proof: only once the map uses the new vocabulary, so a legacy canvas of
  // goals and requirements is not suddenly told it lacks metrics.
  if (list.some(b => b.type === 'metric' || b.type === 'implementation')) {
    const unmeasured = open('goal-no-metric', ofType('goal').filter(g => !linkedTypes(g.id).includes('metric')))
    if (unmeasured.length) {
      add('goal-no-metric', `${plural(unmeasured.length, 'goal')} with no Metric (${quoteList(unmeasured.map(b => b.title))}): how will you know it worked? Add the Metric that measures it`,
        unmeasured.map(b => b.id))
    }
  }
  if (list.some(b => b.type === 'implementation')) {
    const unmoved = open('metric-unmoved', ofType('metric').filter(m => !linkedTypes(m.id).includes('implementation')))
    if (unmoved.length) {
      add('metric-unmoved', `${plural(unmoved.length, 'metric')} that no work moves (${quoteList(unmoved.map(b => b.title))}): link the Implementation expected to shift it`,
        unmoved.map(b => b.id))
    }
  }

  // Possible duplicates. Default "Untitled N" titles never match. A pair is
  // kept apart once both of its blocks accepted the finding, so a new block
  // that duplicates an accepted one is still raised.
  const titled = list
    .filter(b => (b.title || '').trim() && !DEFAULT_TITLE.test(b.title.trim()))
    .map(b => ({ b, t: normTitle(b.title) }))
    .filter(x => x.t.trim())
    // Word counts once per title, not once per pair: the pair loop is
    // quadratic, and re-splitting both titles in it cost 40ms a keystroke
    // at 300 blocks.
    .map(x => ({ ...x, w: x.t.trim().split(' ').length }))
  const pairs = []
  for (let i = 0; i < titled.length; i++) {
    for (let j = i + 1; j < titled.length; j++) {
      const [s, l] = titled[i].t.length <= titled[j].t.length ? [titled[i], titled[j]] : [titled[j], titled[i]]
      const sw = s.w, lw = l.w
      if (s.t === l.t || (sw >= 2 && sw / lw >= DUPLICATE_COVERAGE && l.t.includes(s.t))) pairs.push([s.b, l.b])
    }
  }
  pairs.forEach(p => open('duplicate', p))
  const dupAck = FINDING_ACKS.duplicate
  const openPairs = pairs.filter(([a, b]) => !(isAcked(a, dupAck) && isAcked(b, dupAck)))
  if (openPairs.length) {
    const shown = openPairs.slice(0, 3).map(([a, b]) => `"${a.title.trim()}" and "${b.title.trim()}"`).join('; ')
    add('duplicate', `possible duplicate${openPairs.length === 1 ? '' : 's'}: ${shown}${openPairs.length > 3 ? ` and ${openPairs.length - 3} more` : ''}. Merge them or make the difference explicit`,
      [...new Set(openPairs.flat().map(b => b.id))])
  }

  // Doubt: a question hidden in a description reaches no checklist. An Open
  // Question is already tracked, and an Assumption is the doubt itself.
  const hidden = open('hidden-question', list.filter(b => b.type !== 'question' && b.type !== 'assumption' && hidesQuestion(b.description)))
  if (hidden.length) {
    add('hidden-question', `${plural(hidden.length, 'block')} ${hidden.length === 1 ? 'keeps' : 'keep'} a question in the description (${quoteList(hidden.map(b => b.title))}): make it an Open Question so it is tracked`,
      hidden.map(b => b.id))
  }

  // Auto-typed with low confidence and nobody has confirmed the type yet.
  const unchecked = list.filter(b => b.typeCheck === true)
  if (unchecked.length) {
    add('type-check', `${plural(unchecked.length, 'block was', 'blocks were')} typed automatically and ${unchecked.length === 1 ? 'awaits' : 'await'} a check: confirm or change the type`,
      unchecked.map(b => b.id))
  }

  return { findings, members }
}

// ── The next question ────────────────────────────────────────
/**
 * The first of the six steps (Why, Who, Proof, What, How, Doubt) that has no
 * block on the map yet, as its TYPE_STEPS entry { id, label, hint }, or null
 * once every step has one. It names what to ask next (methodology.md
 * "Methodology guidance": the health bar's next question), so it is advice,
 * never a gap.
 */
export function nextEmptyStep(blocks = {}) {
  const used = new Set(Object.values(blocks).map(b => TYPES[b.type]?.step).filter(Boolean))
  return TYPE_STEPS.find(s => s.id !== 'other' && !used.has(s.id)) || null
}

// ── The DOM writer ───────────────────────────────────────────
// The last result, per block. renderBlock rebuilds a card's class and empties
// its gi- slot; several paths re-render a card without re-running detection
// (an edit that changed nothing, a vote, a review note), and the card lost its
// gap outline and icon while the checks still reported the gap. A block
// decorator paints the last known gap back onto every card render.
let lastGapById = new Map()
let decoratorWired = false

function paintGap(el, id, gap) {
  GAP_ORDER.forEach(c => el.classList.remove(c))
  if (gap) el.classList.add(gap)
  const gi = el.querySelector('.block-gap-icons') || document.getElementById('gi-' + id)
  if (gi) gi.innerHTML = gap ? gapIconHtml(gap) : ''
}

function paintLastGap(b, el) { paintGap(el, b.id, lastGapById.get(b.id) || null) }

// Paints detectGaps' result onto the rendered cards: one gap class per card
// and a line icon in its `gi-<id>` slot. Blocks with no element are still
// detected (the result is about the canvas, not about what is on screen).
export function runGapDetection() {
  // Registered on first use rather than at load: render.js imports this
  // module, so its exports are not ready while this one evaluates.
  if (!decoratorWired) {
    decoratorWired = true
    if (!blockDecorators.includes(paintLastGap)) blockDecorators.push(paintLastGap)
  }
  const result = detectGaps(state.blocks, state.arrows, { groups: state.groups })
  lastGapById = new Map(result.details.map(d => [d.id, d.gaps[0]]))
  for (const id in state.blocks) {
    const el = getBlockEl(id); if (!el) continue
    paintGap(el, id, lastGapById.get(id) || null)
  }
  return result
}

/** The block's reported gap id right now, or null. */
export function blockGap(blockId) {
  if (!state.blocks[blockId]) return null
  return detectGaps(state.blocks, state.arrows, { findings: false }).details.find(d => d.id === blockId)?.gaps[0] || null
}

// ── Accepting a gap ──────────────────────────────────────────
// "We know, and it is fine": the author keeps a gap on purpose (an output
// handed to a team outside the map, a decision taken elsewhere). The gap id
// goes into block.gapAck, which travels with the canvas, so a reviewer and
// the AI see the same judgement. detectGaps' `accepted` is the one list of
// acceptances that still stand: the prompt prints it under "Accepted gaps"
// (prompt.js acceptedGapLines) and the Attention tab lists it, so the two
// cannot differ. An acceptance the canvas has outgrown goes to `stale`.

/**
 * Accept a gap on one block. `gapId` defaults to the block's current gap and
 * may be any rule id or finding ack (FINDING_ACKS). One undo step. Returns
 * true when something changed. Refused in read-only and embed views.
 */
export function acceptGap(blockId, gapId = null) {
  const b = state.blocks[blockId]
  if (!b || ui.readOnly || ui.embed) return false
  const gap = gapId || blockGap(blockId)
  if (!gap || !ACK_IDS.has(gap) || isAcked(b, gap)) return false
  mutateBlock(blockId, { gapAck: [...(b.gapAck || []), gap] }, { undo: true })
  if (selection.blockId === blockId) renderInspector()
  return true
}

/**
 * Accept a canvas finding ({ kind, ids }) for every block it names, as one
 * undo step. Only kinds in FINDING_ACKS can be accepted. Returns how many
 * blocks changed (0 when refused or already accepted).
 */
export function acceptFinding(finding) {
  const ack = FINDING_ACKS[finding?.kind]
  if (!ack || ui.readOnly || ui.embed) return 0
  const ids = (finding.ids || []).filter(id => state.blocks[id] && !isAcked(state.blocks[id], ack))
  if (!ids.length) return 0
  mutateBlocks(ids, b => ({ gapAck: [...(b.gapAck || []), ack] }))
  if (ids.includes(selection.blockId)) renderInspector()
  return ids.length
}

/** Withdraw an accepted gap so it is reported again. One undo step. */
export function unacceptGap(blockId, gapId) {
  const b = state.blocks[blockId]
  if (!b || ui.readOnly || ui.embed || !isAcked(b, gapId)) return false
  const rest = b.gapAck.filter(g => g !== gapId)
  if (rest.length) {
    mutateBlock(blockId, { gapAck: rest }, { undo: true })
  } else {
    // normalize drops an empty list, so the live block does too. The key is
    // removed rather than set to [] or undefined, which Object.assign cannot do.
    snapshot()
    delete b.gapAck
    mutateBlock(blockId, {})
  }
  if (selection.blockId === blockId) renderInspector()
  return true
}

/* ── Rule metadata: one source for the prompt, the breakdown, and docs ──
   The last four entries are finding acks, not card classes: they name an
   accepted canvas finding wherever gapAck is printed (the prompt's Accepted
   gaps section, the Attention tab). */
export const GAP_META = {
  'gap-isolated':      { short: 'Isolated',            prompt: 'no connections: not linked to anything on the canvas' },
  'gap-assumption':    { short: 'Dangling assumption', prompt: 'unvalidated assumption: not linked to a Goal or Requirement and not flagged to validate' },
  'gap-no-req':        { short: 'Goal with nothing under it', prompt: 'no requirement: goal has no linked requirement, metric or implementation, so nothing sits under it' },
  'gap-unaddressed':   { short: 'Unaddressed problem', prompt: 'unaddressed: problem with no resolve action and no outgoing links' },
  'gap-no-mitigation': { short: 'Unmitigated risk',    prompt: 'unmitigated: risk with nothing downstream of it and no prepare action' },
  'gap-no-basis':      { short: 'Decision without basis', prompt: 'no basis: decision with nothing leading to it and no recorded rationale' },
  'gap-no-producer':   { short: 'Output nothing produces', prompt: 'no producer: output with no incoming connection' },
  'gap-no-consumer':   { short: 'Output nobody receives', prompt: 'no consumer: output with no outgoing connection and no linked stakeholder, so nobody on the map receives it' },
  'gap-no-criteria':   { short: 'Requirement without criteria', prompt: 'no acceptance criteria: "done" is undefined for this requirement' },
  'gap-loose-step':    { short: 'Step outside any flow', prompt: 'loose step: workflow step connected to no other step or Trigger / End' },
  'gap-no-purpose':    { short: 'Work with no reason', prompt: 'no purpose: implementation linked to no goal, requirement, problem, metric, output or stakeholder' },
  'gap-metric-no-goal': { short: 'Metric measuring no goal', prompt: 'measures no goal: metric not linked to the goal it is meant to measure' },
  'gap-no-target':     { short: 'Metric without a target', prompt: 'no target: a metric without a target cannot say whether the work is winning' },
  'gap-unserved':      { short: 'Stakeholder nothing serves', prompt: 'unserved: nothing on the map is delivered to or asked of this stakeholder' },
  'gap-finding-duplicate':       { short: 'Possible duplicate', prompt: 'possible duplicate: its title nearly repeats another block\'s' },
  'gap-finding-hidden-question': { short: 'Question in the description', prompt: 'question in the description: not tracked as an Open Question' },
  'gap-finding-goal-no-metric':  { short: 'Goal with no metric', prompt: 'no metric: nothing on the map measures this goal' },
  'gap-finding-metric-unmoved':  { short: 'Metric no work moves', prompt: 'unmoved: no implementation is linked to shift this metric' },
}

/**
 * One readable sentence for a gap: the short name, then the reason without
 * the prompt's leading tag ("Isolated: not linked to anything on the
 * canvas"). The card tooltip and the Attention tab both use it.
 */
export function gapExplain(gap) {
  const meta = GAP_META[gap]
  if (!meta) return gap
  const why = meta.prompt.split(': ').slice(1).join(': ') || meta.prompt
  return `${meta.short}: ${why}`
}

/* ── Suggestion icons ─────────────────────────────────────────
   These were emoji, which is a problem beyond taste: an emoji renders in the
   platform's own palette, so five suggestions arrived in five unrelated
   colours next to a muted 11px line of text, and each one sat at whatever
   baseline its font decided. As line-art on `currentColor` they inherit the
   panel's colour and the fleet's icon weight, and they are the same shape on
   every machine rather than whatever that OS ships.
─────────────────────────────────────────────────────────────── */
const svg = (d, size = 13) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'

const ICON_PATHS = {
  /* two links of a chain, for a block joined to nothing */
  connect:      '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  /* concentric target, for an assumption with nothing to aim at */
  'add-goal':   '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  /* ruled list, for a goal carrying no requirements */
  'add-req':    '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  /* check in a circle, for a problem nothing is acting on */
  resolve:      '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  /* a fork in the road: one path in, two out, which is what a decision is */
  'add-decision': '<path d="M12 21V13"/><path d="M12 13 5.5 7.5"/><path d="M12 13l6.5-5.5"/><circle cx="4.5" cy="6" r="2"/><circle cx="19.5" cy="6" r="2"/>',
  /* a shield, for a risk with no mitigation */
  shield:       '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/>',
  /* a checked list, for a requirement whose "done" is undefined */
  criteria:     '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3 6l1.2 1.2L6.5 4.9M3 12l1.2 1.2 2.3-2.3M3 18l1.2 1.2 2.3-2.3"/>',
  /* a gauge with its needle, for a metric with no goal or no target */
  gauge:        '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 13.5l4-4.5"/><circle cx="12" cy="14" r="1.3"/>',
  /* a head and shoulders, for the people end of a map */
  person:       '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
}
const FIX_ICON = Object.fromEntries(Object.entries(ICON_PATHS).map(([k, d]) => [k, svg(d)]))

// Which icon marks each gap on a card.
const GAP_ICON = {
  'gap-isolated': 'connect', 'gap-assumption': 'add-goal', 'gap-no-req': 'add-req',
  'gap-unaddressed': 'resolve', 'gap-no-mitigation': 'shield', 'gap-no-basis': 'add-decision',
  'gap-no-producer': 'connect', 'gap-no-consumer': 'person', 'gap-no-criteria': 'criteria',
  'gap-loose-step': 'connect', 'gap-no-purpose': 'add-goal', 'gap-metric-no-goal': 'gauge',
  'gap-no-target': 'gauge', 'gap-unserved': 'person',
}

/** 14px line-art SVG string for a gap class, '' for an unknown one. */
export function gapIconFor(gapClass) {
  const key = GAP_ICON[gapClass]
  return key ? svg(ICON_PATHS[key], 14) : ''
}

// The card marker: an icon with the rule's name as its accessible text, so
// the gap is never signalled by the ring's colour alone.
function gapIconHtml(gap) {
  const attr = t => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<span class="gap-icon" role="img" title="${attr(gapExplain(gap))}" aria-label="Gap: ${attr(GAP_META[gap]?.short || gap)}">${gapIconFor(gap)}</span>`
}

// ── Gap auto-fix suggestions ──────────────────────────────────
// Driven by detection, not by the card's classes, so it answers for a block
// that is not on screen. Each fix names the gap it addresses (`gap`); fixes
// that create a block carry `create: { type, dir }` for applyGapFix, where
// dir 'out' draws block -> new and 'in' draws new -> block.
export function getGapFixes(b) {
  if (!b || !state.blocks[b.id]) return []
  const gap = blockGap(b.id)
  const fixes = []
  const fix = (id, icon, text, action, extra = {}) =>
    fixes.push({ id, gap, icon: FIX_ICON[icon], text, ...(action ? { action } : {}), ...extra })
  switch (gap) {
    case 'gap-isolated':
      fix('connect', 'connect', 'This block floats alone: drag from a port to link it to the plan.')
      break
    case 'gap-assumption':
      fix('add-goal', 'add-goal', 'This assumption isn’t tied to anything yet: link it to the Goal or Requirement it underpins.', 'Create Goal')
      break
    case 'gap-no-req':
      fix('add-req', 'add-req', 'The What step is missing: nothing sits under this goal yet. Add the first Requirement?', 'Add Requirement')
      fix('create:metric:in', 'gauge', 'Or start with Proof: add the Metric that will show it worked.', 'Add Metric',
        { create: { type: 'metric', dir: 'in' } })
      break
    case 'gap-unaddressed':
      fix('resolve', 'resolve', 'Nothing is addressing this problem yet: mark it resolved or link a fix.', 'Mark Resolved')
      /* This one shipped with an empty string, so it rendered as an icon, a blank
         column and a button, with nothing saying what the button was for. */
      fix('add-decision', 'add-decision', 'Or record the call you already made, so the reasoning behind it survives.', 'Create Decision')
      break
    case 'gap-no-mitigation':
      fix('prepare', 'shield', 'Nothing mitigates this risk yet: flag the prep work, or link what handles it.', 'Mark Prepare')
      fix('mitigate', 'add-decision', 'Or record the mitigation as a decision downstream of it.', 'Create Decision')
      break
    case 'gap-no-basis':
      fix('rationale', 'add-decision', 'This decision records no basis: nothing leads to it and the why is empty.', 'Add rationale')
      break
    case 'gap-no-producer':
      fix('create:implementation:in', 'connect', 'The How is missing: nothing on the canvas produces this output. Add the work that yields it.', 'Add Implementation',
        { create: { type: 'implementation', dir: 'in' } })
      break
    case 'gap-no-consumer':
      fix('create:stakeholder:out', 'person', 'The Who is missing: nobody on the map receives this output. Add who it is delivered to.', 'Add Stakeholder',
        { create: { type: 'stakeholder', dir: 'out' } })
      break
    case 'gap-no-criteria':
      fix('criteria', 'criteria', '"Done" is undefined here: add acceptance criteria, one per line.', 'Add criteria')
      break
    case 'gap-loose-step':
      fix('connect', 'connect', 'This step is in no flow: connect it to another step or a Trigger / End.')
      break
    case 'gap-no-purpose':
      fix('create:requirement:out', 'add-goal', 'The Why is missing: this work has no reason on the map. Add the Requirement it satisfies.', 'Add Requirement',
        { create: { type: 'requirement', dir: 'out' } })
      break
    case 'gap-metric-no-goal':
      fix('add-goal', 'gauge', 'The Why is missing: this metric measures no goal. Add the objective it measures.', 'Create Goal')
      break
    case 'gap-no-target':
      fix('criteria', 'criteria', 'Proof is incomplete: a metric without a target cannot say if you are winning. Add the target, one per line.', 'Add target')
      break
    case 'gap-unserved':
      fix('create:output:in', 'person', 'Nothing is delivered to or asked of this stakeholder: add the Output they receive, or link the Goal they own.', 'Add Output',
        { create: { type: 'output', dir: 'in' } })
      break
  }
  return fixes
}
