// ════════════════════════════════════════════════════════════
//  gaps.js — Gap detection logic
// ════════════════════════════════════════════════════════════

import { state } from './state.js'
import { getBlockEl, DEFAULT_WIDTH } from './utils.js'

// ── Gap detection ────────────────────────────────────────────
//
// Gap branches are mutually exclusive: an isolated block reports
// exactly ONE gap (the isolation), never a second type-specific gap
// on top of it. Type-specific gaps (assumption / no-req / unaddressed)
// only apply to blocks that ARE connected but are connected wrongly.
export function runGapDetection() {
  const GAP = ['gap-isolated','gap-assumption','gap-no-req','gap-unaddressed']
  const details = []
  const record = (b, gapClass) =>
    details.push({ title: b.title || '(untitled)', type: b.type, gaps: [gapClass] })

  for (const id in state.blocks) {
    const b   = state.blocks[id]
    const el  = getBlockEl(id); if (!el) continue
    GAP.forEach(c => el.classList.remove(c))
    const gi = document.getElementById('gi-' + id)
    if (gi) gi.innerHTML = ''

    const inc = state.arrows.filter(a => a.to   === id)
    const out = state.arrows.filter(a => a.from === id)

    // Isolated wins outright — one gap, no further checks.
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
  }
  return { count: details.length, details }
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
  'add-decision': svg('<path d="M12 21V13"/><path d="M12 13 5.5 7.5"/><path d="M12 13l6.5-5.5"/><circle cx="4.5" cy="6" r="2"/><circle cx="19.5" cy="6" r="2"/>')
}

// ── Gap auto-fix suggestions ──────────────────────────────────
export function getGapFixes(b) {
  const el = getBlockEl(b.id); if (!el) return []
  const fixes = []
  if (el.classList.contains('gap-isolated')) {
    fixes.push({ id: 'connect', icon: FIX_ICON['connect'], text: 'This block floats alone — drag from a port ● to link it to the plan.' })
  }
  if (el.classList.contains('gap-assumption')) {
    fixes.push({ id: 'add-goal', icon: FIX_ICON['add-goal'], text: 'This assumption isn’t tied to anything yet — link it to the Goal or Requirement it underpins.', action: 'Create Goal' })
  }
  if (el.classList.contains('gap-no-req')) {
    fixes.push({ id: 'add-req', icon: FIX_ICON['add-req'], text: 'This goal has no requirements yet — add the first one?', action: 'Add Requirement' })
  }
  if (el.classList.contains('gap-unaddressed')) {
    fixes.push({ id: 'resolve', icon: FIX_ICON['resolve'], text: 'Nothing is addressing this problem yet — mark it resolved or link a fix.', action: 'Mark Resolved' })
    /* This one shipped with an empty string, so it rendered as an icon, a blank
       column and a button, with nothing saying what the button was for. */
    fixes.push({ id: 'add-decision', icon: FIX_ICON['add-decision'], text: 'Or record the call you already made, so the reasoning behind it survives.', action: 'Create Decision' })
  }
  return fixes
}
