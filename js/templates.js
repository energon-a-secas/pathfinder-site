// ════════════════════════════════════════════════════════════
//  templates.js — Pre-defined block patterns
// ════════════════════════════════════════════════════════════

import { state, view } from './state.js'
import { $, genId } from './utils.js'

// SVG icons for templates (no emojis — cleaner look)
export const TICONS = {
  sprint: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
  launch: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
  balance: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>',
}

export const TEMPLATES = [
  {
    icon: 'sprint',
    name: 'Sprint Planning',
    desc: 'Goal → requirements → risk',
    blocks: [
      { type: 'goal',        title: 'Sprint Goal',    dx:   0, dy:   0 },
      { type: 'requirement', title: 'Must have',       dx: 280, dy: -70 },
      { type: 'requirement', title: 'Should have',     dx: 280, dy:  70 },
      { type: 'risk',        title: 'Risk',            dx: 560, dy:   0 },
    ],
    arrows: [[0,1],[0,2],[1,3],[2,3]],
  },
  {
    icon: 'search',
    name: 'Problem Analysis',
    desc: 'Problem → options → solution',
    blocks: [
      { type: 'problem',  title: 'Core Problem',    dx:   0, dy:   0 },
      { type: 'decision', title: 'Option A',         dx: 280, dy: -90 },
      { type: 'decision', title: 'Option B',         dx: 280, dy:   0 },
      { type: 'decision', title: 'Option C',         dx: 280, dy:  90 },
      { type: 'output',   title: 'Chosen Solution',  dx: 560, dy:   0 },
    ],
    arrows: [[0,1],[0,2],[0,3],[1,4],[2,4],[3,4]],
  },
  {
    icon: 'launch',
    name: 'Feature Launch',
    desc: 'Context + goal → output + risk',
    blocks: [
      { type: 'context',     title: 'Background',  dx:   0, dy: -70 },
      { type: 'goal',        title: 'Goal',         dx:   0, dy:  70 },
      { type: 'resource',    title: 'Resource',     dx: 280, dy:   0 },
      { type: 'output',      title: 'Output',       dx: 560, dy: -70 },
      { type: 'risk',        title: 'Risk',         dx: 560, dy:  70 },
    ],
    arrows: [[0,2],[1,2],[2,3],[2,4]],
  },
  {
    icon: 'balance',
    name: 'Risk Review',
    desc: 'Risk → decision → requirement',
    blocks: [
      { type: 'risk',        title: 'Risk',           dx:   0, dy:   0 },
      { type: 'question',    title: 'Unknown?',        dx:   0, dy: 130 },
      { type: 'decision',    title: 'Mitigation',     dx: 280, dy:   0 },
      { type: 'requirement', title: 'Requirement',    dx: 560, dy:   0 },
    ],
    arrows: [[0,2],[1,2],[2,3]],
  },
]

export function applyTemplate(tpl) {
  const canvasViewport = $.canvasViewport()
  const r  = canvasViewport.getBoundingClientRect()
  const cx = (r.width  / 2 - view.panX) / view.zoom - 110
  const cy = (r.height / 2 - view.panY) / view.zoom - 40

  const ids = tpl.blocks.map(bd => {
    const id = genId()
    state.blocks[id] = {
      id, type: bd.type, title: bd.title,
      description: '', notes: '',
      x: cx + bd.dx, y: cy + bd.dy,
      actions: [], questions: [],
      width: null, color: null, collapsed: false, groupId: null,
    }
    return id
  })

  tpl.arrows.forEach(([fi, ti]) => {
    const fId = ids[fi], tId = ids[ti]
    if (fId && tId && fId !== tId) state.arrows.push({ id: genId(), from: fId, to: tId })
  })

  return ids
}
