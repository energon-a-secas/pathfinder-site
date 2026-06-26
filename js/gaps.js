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

// ── Gap auto-fix suggestions ──────────────────────────────────
export function getGapFixes(b) {
  const el = getBlockEl(b.id); if (!el) return []
  const fixes = []
  if (el.classList.contains('gap-isolated')) {
    fixes.push({ id: 'connect', icon: '🔗', text: 'This block floats alone — drag from a port ● to link it to the plan.' })
  }
  if (el.classList.contains('gap-assumption')) {
    fixes.push({ id: 'add-goal', icon: '🎯', text: 'This assumption isn’t tied to anything yet — link it to the Goal or Requirement it underpins.', action: 'Create Goal' })
  }
  if (el.classList.contains('gap-no-req')) {
    fixes.push({ id: 'add-req', icon: '📋', text: 'This goal has no requirements yet — add the first one?', action: 'Add Requirement' })
  }
  if (el.classList.contains('gap-unaddressed')) {
    fixes.push({ id: 'resolve', icon: '✅', text: 'Nothing is addressing this problem yet — mark it resolved or link a fix.', action: 'Mark Resolved' })
    fixes.push({ id: 'add-decision', icon: '⚖️', text: '', action: 'Create Decision' })
  }
  return fixes
}
