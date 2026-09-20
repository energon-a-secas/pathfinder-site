import { dependencyEdges } from './relations.js'
// ════════════════════════════════════════════════════════════
//  gaps.js: Gap detection logic
// ════════════════════════════════════════════════════════════

import { state } from './state.js'
import { getBlockEl, DEFAULT_WIDTH } from './utils.js'
import { breakCycles } from './layout.js'

// ── Gap detection ────────────────────────────────────────────
//
// Gap branches are mutually exclusive: an isolated block reports
// exactly ONE gap (the isolation), never a second type-specific gap
// on top of it. Type-specific gaps (assumption / no-req / unaddressed)
// only apply to blocks that ARE connected but are connected wrongly.
export function runGapDetection() {
  const GAP = ['gap-isolated','gap-assumption','gap-no-req','gap-unaddressed',
               'gap-no-mitigation','gap-no-basis','gap-no-producer','gap-no-criteria','gap-loose-step']
  const details = []

  // Connected components over the arrows, for the loose-step rule: a flow in
  // this app legitimately passes THROUGH non-flow blocks (the tutorial's own
  // example does), so "outside any flow" must mean the whole component holds
  // no other flow node, not merely the direct neighbours.
  const comp = new Map()
  const find = x => { let r = x; while (comp.get(r) !== r) r = comp.get(r); comp.set(x, r); return r }
  for (const id in state.blocks) comp.set(id, id)
  state.arrows.forEach(a => {
    if (!comp.has(a.from) || !comp.has(a.to)) return
    comp.set(find(a.from), find(a.to))
  })
  const flowInComp = new Map()
  for (const id in state.blocks) {
    const t = state.blocks[id].type
    if (t === 'process' || t === 'terminator') {
      const r = find(id)
      flowInComp.set(r, (flowInComp.get(r) || 0) + 1)
    }
  }
  const record = (b, gapClass) =>
    details.push({ id: b.id, title: b.title || '(untitled)', type: b.type, gaps: [gapClass] })

  for (const id in state.blocks) {
    const b   = state.blocks[id]
    const el  = getBlockEl(id); if (!el) continue
    GAP.forEach(c => el.classList.remove(c))
    const gi = document.getElementById('gi-' + id)
    if (gi) gi.innerHTML = ''

    const inc = state.arrows.filter(a => a.to   === id)
    const out = state.arrows.filter(a => a.from === id)

    // Isolated wins outright: one gap, no further checks.
    if (inc.length === 0 && out.length === 0) {
      el.classList.add('gap-isolated'); record(b, 'gap-isolated'); continue
    }

    const linked = [...inc.map(a => state.blocks[a.from]), ...out.map(a => state.blocks[a.to])].filter(Boolean)

    // Assumption left dangling: an untested bet not anchored to a goal
    // or requirement, and not flagged for validation.
    if (b.type === 'assumption'
        && !b.actions.includes('validate')
        && !linked.some(x => x.type === 'goal' || x.type === 'requirement')) {
      el.classList.add('gap-assumption'); record(b, 'gap-assumption'); continue
    }
    // Goal with no requirement feeding it.
    if (b.type === 'goal' && !linked.some(x => x.type === 'requirement')) {
      el.classList.add('gap-no-req'); record(b, 'gap-no-req'); continue
    }
    // Problem nobody is acting on.
    if (b.type === 'problem' && !b.actions.includes('resolve') && out.length === 0) {
      el.classList.add('gap-unaddressed'); record(b, 'gap-unaddressed'); continue
    }
    // Risk with no mitigation: nothing downstream of it and nobody preparing.
    if (b.type === 'risk' && out.length === 0 && !b.actions.includes('prepare')) {
      el.classList.add('gap-no-mitigation'); record(b, 'gap-no-mitigation'); continue
    }
    // Decision with no basis: nothing leads to it and no rationale recorded.
    if (b.type === 'decision' && inc.length === 0 && !b.rationale?.trim()) {
      el.classList.add('gap-no-basis'); record(b, 'gap-no-basis'); continue
    }
    // Output nothing produces.
    if (b.type === 'output' && inc.length === 0) {
      el.classList.add('gap-no-producer'); record(b, 'gap-no-producer'); continue
    }
    // Requirement with no acceptance criteria: "done" is undefined.
    if (b.type === 'requirement' && !(b.criteria || []).length) {
      el.classList.add('gap-no-criteria'); record(b, 'gap-no-criteria'); continue
    }
    // Workflow step in a component holding no other flow node: it is in no
    // flow at all, however many ordinary blocks it touches.
    if (b.type === 'process' && (flowInComp.get(find(id)) || 0) < 2) {
      el.classList.add('gap-loose-step'); record(b, 'gap-loose-step'); continue
    }
  }

  // Canvas-level findings: real problems that belong to no single block.
  const canvasFindings = []
  const ids = Object.keys(state.blocks)
  if (ids.length) {
    const edges = dependencyEdges(state.blocks, state.arrows)
    const { reversed } = breakCycles(ids, edges)
    if (reversed.size) {
      canvasFindings.push(`${reversed.size} connection${reversed.size === 1 ? '' : 's'} close a cycle: the dependency order is circular somewhere`)
    }
  }
  Object.values(state.groups || {}).forEach(g => {
    if (!Object.values(state.blocks).some(b => b.groupId === g.id)) {
      canvasFindings.push(`group "${g.label || '(unnamed)'}" has a name and no members`)
    }
  })

  return { count: details.length, details, canvasFindings }
}

/* ── Rule metadata: one source for the prompt, the breakdown, and docs ── */
export const GAP_META = {
  'gap-isolated':      { short: 'Isolated',            prompt: 'no connections: not linked to anything on the canvas' },
  'gap-assumption':    { short: 'Dangling assumption', prompt: 'unvalidated assumption: not linked to a Goal or Requirement and not flagged to validate' },
  'gap-no-req':        { short: 'Goal without requirements', prompt: 'no requirement: goal has no linked requirement' },
  'gap-unaddressed':   { short: 'Unaddressed problem', prompt: 'unaddressed: problem with no resolve action and no outgoing links' },
  'gap-no-mitigation': { short: 'Unmitigated risk',    prompt: 'unmitigated: risk with nothing downstream of it and no prepare action' },
  'gap-no-basis':      { short: 'Decision without basis', prompt: 'no basis: decision with nothing leading to it and no recorded rationale' },
  'gap-no-producer':   { short: 'Output nothing produces', prompt: 'no producer: output with no incoming connection' },
  'gap-no-criteria':   { short: 'Requirement without criteria', prompt: 'no acceptance criteria: "done" is undefined for this requirement' },
  'gap-loose-step':    { short: 'Step outside any flow', prompt: 'loose step: workflow step connected to no other step or start/end' },
}

/* ── Suggestion icons ─────────────────────────────────────────
   These were emoji, which is a problem beyond taste: an emoji renders in the
   platform's own palette, so five suggestions arrived in five unrelated
   colours next to a muted 11px line of text, and each one sat at whatever
   baseline its font decided. As line-art on `currentColor` they inherit the
   panel's colour and the fleet's icon weight, and they are the same shape on
   every machine rather than whatever that OS ships.
─────────────────────────────────────────────────────────────── */
const svg = d =>
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'

const FIX_ICON = {
  /* two links of a chain, for a block joined to nothing */
  connect:      svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
  /* concentric target, for an assumption with nothing to aim at */
  'add-goal':   svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>'),
  /* ruled list, for a goal carrying no requirements */
  'add-req':    svg('<path d="M8 6h12M8 12h12M8 18h12"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  /* check in a circle, for a problem nothing is acting on */
  resolve:      svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>'),
  /* a fork in the road: one path in, two out, which is what a decision is */
  'add-decision': svg('<path d="M12 21V13"/><path d="M12 13 5.5 7.5"/><path d="M12 13l6.5-5.5"/><circle cx="4.5" cy="6" r="2"/><circle cx="19.5" cy="6" r="2"/>'),
  /* a shield, for a risk with no mitigation */
  shield:       svg('<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/>'),
  /* a checked list, for a requirement whose "done" is undefined */
  criteria:     svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3 6l1.2 1.2L6.5 4.9M3 12l1.2 1.2 2.3-2.3M3 18l1.2 1.2 2.3-2.3"/>')
}

// ── Gap auto-fix suggestions ──────────────────────────────────
export function getGapFixes(b) {
  const el = getBlockEl(b.id); if (!el) return []
  const fixes = []
  if (el.classList.contains('gap-isolated')) {
    fixes.push({ id: 'connect', icon: FIX_ICON['connect'], text: 'This block floats alone: drag from a port ● to link it to the plan.' })
  }
  if (el.classList.contains('gap-assumption')) {
    fixes.push({ id: 'add-goal', icon: FIX_ICON['add-goal'], text: 'This assumption isn’t tied to anything yet, link it to the Goal or Requirement it underpins.', action: 'Create Goal' })
  }
  if (el.classList.contains('gap-no-req')) {
    fixes.push({ id: 'add-req', icon: FIX_ICON['add-req'], text: 'This goal has no requirements yet: add the first one?', action: 'Add Requirement' })
  }
  if (el.classList.contains('gap-unaddressed')) {
    fixes.push({ id: 'resolve', icon: FIX_ICON['resolve'], text: 'Nothing is addressing this problem yet: mark it resolved or link a fix.', action: 'Mark Resolved' })
    /* This one shipped with an empty string, so it rendered as an icon, a blank
       column and a button, with nothing saying what the button was for. */
    fixes.push({ id: 'add-decision', icon: FIX_ICON['add-decision'], text: 'Or record the call you already made, so the reasoning behind it survives.', action: 'Create Decision' })
  }
  if (el.classList.contains('gap-no-mitigation')) {
    fixes.push({ id: 'prepare', icon: FIX_ICON['shield'], text: 'Nothing mitigates this risk yet: flag the prep work, or link what handles it.', action: 'Mark Prepare' })
    fixes.push({ id: 'mitigate', icon: FIX_ICON['add-decision'], text: 'Or record the mitigation as a decision downstream of it.', action: 'Create Decision' })
  }
  if (el.classList.contains('gap-no-basis')) {
    fixes.push({ id: 'rationale', icon: FIX_ICON['add-decision'], text: 'This decision records no basis: nothing leads to it and the why is empty.', action: 'Add rationale' })
  }
  if (el.classList.contains('gap-no-producer')) {
    fixes.push({ id: 'connect', icon: FIX_ICON['connect'], text: 'Nothing on the canvas produces this output, link the work that yields it.' })
  }
  if (el.classList.contains('gap-no-criteria')) {
    fixes.push({ id: 'criteria', icon: FIX_ICON['criteria'], text: '"Done" is undefined here: add acceptance criteria, one per line.', action: 'Add criteria' })
  }
  if (el.classList.contains('gap-loose-step')) {
    fixes.push({ id: 'connect', icon: FIX_ICON['connect'], text: 'This step is in no flow: connect it to another step or a Start/End.' })
  }
  return fixes
}
