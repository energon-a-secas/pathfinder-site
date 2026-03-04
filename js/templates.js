// ════════════════════════════════════════════════════════════
//  templates.js — Pre-defined block patterns
// ════════════════════════════════════════════════════════════

import { state, view } from './state.js'
import { $, genId } from './utils.js'

export const TEMPLATES = [
  {
    emoji: '🎯',
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
    emoji: '🔍',
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
    emoji: '🚀',
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
    emoji: '⚖️',
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
