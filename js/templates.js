// ════════════════════════════════════════════════════════════
//  templates.js — Pre-defined block patterns
//
//  Templates are content-bearing: each block ships a real title +
//  description (and sometimes priority / actions), and arrows carry
//  semantic labels. Applied to an empty canvas they produce a prompt
//  that already reads like a brief — that's the canvas→AI value on
//  display, not empty placeholder boxes.
// ════════════════════════════════════════════════════════════

import { state, view } from './state.js'
import { $, genId } from './utils.js'

// SVG icons for templates (no emojis — cleaner look)
export const TICONS = {
  sprint: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
  launch: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>',
  balance: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>',
  idea: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>',
}

export const TEMPLATES = [
  {
    icon: 'idea',
    name: 'Validate an Idea',
    desc: 'Goal → assumptions → next experiment',
    blocks: [
      { type: 'goal',        title: 'Validate the core idea', dx:   0, dy:   0, priority: 'high',
        description: 'What we want to learn or prove before committing real effort.' },
      { type: 'assumption',  title: 'Users will pay for this', dx: 300, dy: -110, actions: ['validate'],
        description: 'Riskiest belief — if false, the whole idea changes. Pressure-test first.' },
      { type: 'assumption',  title: 'We can reach the audience cheaply', dx: 300, dy: 10, actions: ['validate'],
        description: 'Distribution assumption. Name the channel and a realistic CAC.' },
      { type: 'question',    title: 'What does "success" look like in 2 weeks?', dx: 300, dy: 130,
        description: 'Define the metric and threshold that would make us continue.' },
      { type: 'output',      title: 'Smallest experiment to run next', dx: 600, dy: 0,
        description: 'The cheapest test that could invalidate the riskiest assumption.' },
    ],
    arrows: [ [1,0,'underpins'], [2,0,'underpins'], [3,0,'informs'], [0,4,'leads to'] ],
  },
  {
    icon: 'sprint',
    name: 'Sprint Planning',
    desc: 'Goal → requirements → risk',
    blocks: [
      { type: 'goal',        title: 'Sprint goal', dx:   0, dy:   0, priority: 'high',
        description: 'The single outcome this sprint must deliver.' },
      { type: 'requirement', title: 'Must have', dx: 300, dy: -90, priority: 'high',
        description: 'Non-negotiable for the goal to count as done.' },
      { type: 'requirement', title: 'Should have', dx: 300, dy: 70, priority: 'medium',
        description: 'Valuable but cuttable if time runs short.' },
      { type: 'assumption',  title: 'Scope is stable for 2 weeks', dx: 300, dy: 190, actions: ['validate'],
        description: 'If stakeholders may change scope mid-sprint, flag it now.' },
      { type: 'risk',        title: 'Biggest delivery risk', dx: 600, dy: 0,
        description: 'What is most likely to slip the sprint, and the early warning sign.' },
    ],
    arrows: [ [0,1,'requires'], [0,2,'requires'], [3,0,'underpins'], [1,4,'threatened by'], [2,4,'threatened by'] ],
  },
  {
    icon: 'search',
    name: 'Problem Analysis',
    desc: 'Problem → options → decision',
    blocks: [
      { type: 'problem',  title: 'Core problem', dx:   0, dy:   0, priority: 'high', actions: ['resolve'],
        description: 'State the problem as an observable symptom, not a missing solution.' },
      { type: 'decision', title: 'Option A', dx: 300, dy: -100,
        description: 'Approach, rough cost, and the main trade-off.' },
      { type: 'decision', title: 'Option B', dx: 300, dy: 10,
        description: 'Approach, rough cost, and the main trade-off.' },
      { type: 'decision', title: 'Option C', dx: 300, dy: 120,
        description: 'Approach, rough cost, and the main trade-off.' },
      { type: 'output',   title: 'Chosen solution + rationale', dx: 600, dy: 10, priority: 'high',
        description: 'Which option won and why — the record future-you will thank you for.' },
    ],
    arrows: [ [0,1,'option'], [0,2,'option'], [0,3,'option'], [1,4,'resolves'], [2,4,'resolves'], [3,4,'resolves'] ],
  },
  {
    icon: 'launch',
    name: 'Feature Launch',
    desc: 'Context + goal → output + risk',
    blocks: [
      { type: 'context',     title: 'Why now', dx:   0, dy: -80,
        description: 'Market, competitive, or internal context that makes this timely.' },
      { type: 'goal',        title: 'Launch goal', dx:   0, dy:  80, priority: 'high',
        description: 'The measurable result a successful launch produces.' },
      { type: 'requirement', title: 'Launch-blocking requirement', dx: 300, dy: 0, priority: 'high',
        description: 'The one thing that must be true to ship at all.' },
      { type: 'output',      title: 'Go-live deliverable', dx: 600, dy: -80,
        description: 'What actually ships — the artifact users touch.' },
      { type: 'risk',        title: 'Launch risk', dx: 600, dy: 80,
        description: 'What could go wrong on or after launch day, and the mitigation.' },
    ],
    arrows: [ [0,2,'frames'], [1,2,'requires'], [2,3,'produces'], [2,4,'threatened by'] ],
  },
  {
    icon: 'balance',
    name: 'Risk Review',
    desc: 'Risk → assumption → mitigation',
    blocks: [
      { type: 'risk',        title: 'Top risk', dx:   0, dy:   0, priority: 'high',
        description: 'The failure mode that would hurt most, with its likely trigger.' },
      { type: 'assumption',  title: 'Assumption that could be wrong', dx: 0, dy: 150, actions: ['validate'],
        description: 'The belief whose failure would cause this risk to materialize.' },
      { type: 'decision',    title: 'Mitigation', dx: 300, dy: 0,
        description: 'The concrete action that reduces likelihood or blast radius.' },
      { type: 'requirement', title: 'Resulting requirement', dx: 600, dy: 0,
        description: 'What the mitigation forces us to build or guarantee.' },
    ],
    arrows: [ [1,0,'underpins'], [0,2,'mitigated by'], [2,3,'requires'] ],
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
      description: bd.description || '', notes: '',
      x: cx + bd.dx, y: cy + bd.dy,
      actions: bd.actions ? [...bd.actions] : [], questions: [],
      width: null, color: null, collapsed: false, groupId: null,
      status: null, priority: bd.priority || null,
    }
    return id
  })

  tpl.arrows.forEach(([fi, ti, label]) => {
    const fId = ids[fi], tId = ids[ti]
    if (fId && tId && fId !== tId) {
      const arrow = { id: genId(), from: fId, to: tId, style: 'curved', bidirectional: false, color: null, weight: 2, fromPort: null, toPort: null }
      if (label) arrow.label = label
      state.arrows.push(arrow)
    }
  })

  return ids
}
