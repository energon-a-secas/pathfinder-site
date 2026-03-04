// ════════════════════════════════════════════════════════════
//  gaps.js — Gap detection logic
// ════════════════════════════════════════════════════════════

import { state } from './state.js'
import { getBlockEl } from './utils.js'

// ── Gap detection ────────────────────────────────────────────
export function runGapDetection() {
  const GAP = ['gap-isolated','gap-assumption','gap-no-req','gap-unaddressed']
  const details = []
  for (const id in state.blocks) {
    const b   = state.blocks[id]
    const el  = getBlockEl(id); if (!el) continue
    GAP.forEach(c => el.classList.remove(c))

    const inc = state.arrows.filter(a => a.to   === id)
    const out = state.arrows.filter(a => a.from === id)

    let gap = false

    if (inc.length === 0 && out.length === 0) {
      el.classList.add('gap-isolated'); gap = true
    }
    if (b.type === 'question') {
      const linked = [...inc.map(a => state.blocks[a.from]), ...out.map(a => state.blocks[a.to])].filter(Boolean)
      if (!linked.some(x => x.type === 'goal' || x.type === 'requirement')) {
        el.classList.add('gap-assumption'); gap = true
      }
    }
    if (b.type === 'goal') {
      const linked = [...inc.map(a => state.blocks[a.from]), ...out.map(a => state.blocks[a.to])].filter(Boolean)
      if (!linked.some(x => x.type === 'requirement')) {
        el.classList.add('gap-no-req'); gap = true
      }
    }
    if (b.type === 'problem' && !b.actions.includes('resolve') && out.length === 0) {
      el.classList.add('gap-unaddressed'); gap = true
    }

    const gi = document.getElementById('gi-' + id)
    if (gi) {
      const icons = []
      if (el.classList.contains('gap-assumption'))  icons.push('\u26A0')
      if (el.classList.contains('gap-no-req'))      icons.push('\uD83D\uDCCB')
      if (el.classList.contains('gap-unaddressed')) icons.push('\uD83D\uDD34')
      gi.innerHTML = icons.map(i => `<span class="gap-icon">${i}</span>`).join('')
    }
    if (gap) {
      const blockGaps = []
      if (el.classList.contains('gap-isolated'))    blockGaps.push('gap-isolated')
      if (el.classList.contains('gap-assumption'))  blockGaps.push('gap-assumption')
      if (el.classList.contains('gap-no-req'))      blockGaps.push('gap-no-req')
      if (el.classList.contains('gap-unaddressed')) blockGaps.push('gap-unaddressed')
      details.push({ title: b.title || '(untitled)', type: b.type, gaps: blockGaps })
    }
  }
  return { count: details.length, details }
}
