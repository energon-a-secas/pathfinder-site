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
  bug: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 8h-2.81a5.98 5.98 0 00-1.82-1.96L17 4.41 15.59 3l-2.17 2.17a6.02 6.02 0 00-2.83 0L8.41 3 7 4.41l1.62 1.63A5.98 5.98 0 006.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81a5.99 5.99 0 0010.38 0H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>',
  migrate: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h10v2H4zm0 5h10v2H4zm0 5h10v2H4zm14.5-8.5L17 8l3 3-3 3 1.5 1.5L23 11z"/></svg>',
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
  {
    icon: 'bug',
    name: 'Investigate a Bug',
    desc: 'Symptom → suspects → evidence → fix',
    large: true,
    mode: 'investigate',
    situation: { codebase: 'current', runtime: 'code', firstMove: 'read',
      constraints: 'Reproduce before theorising\nDo not change behaviour while investigating' },
    blocks: [
      { type: 'terminator', title: 'Report received', dx: 0, dy: 0,
        description: 'Who saw it, when, and on which version. Vague reports produce vague investigations.' },
      { type: 'problem', title: 'Observable symptom', dx: 260, dy: 0, priority: 'high', actions: ['resolve'],
        description: 'What actually happens, stated without a theory attached. "Checkout 500s on card payments", not "the payment service is broken".' },
      { type: 'process', title: 'Reproduce it', dx: 520, dy: -120,
        description: 'The exact steps, environment and data that trigger it. A bug you cannot reproduce is a bug you cannot prove you fixed.' },
      { type: 'question', title: 'Does it happen on every environment?', dx: 520, dy: 20,
        description: 'Prod only, staging too, local? The answer eliminates whole classes of cause.' },
      { type: 'question', title: 'When did it start?', dx: 520, dy: 150,
        description: 'First report, first log line, last known-good deploy. Bisect the window before reading code.' },
      { type: 'assumption', title: 'It started with the last deploy', dx: 780, dy: 150, actions: ['validate'],
        description: 'The most common and most wrong assumption in an outage. Check the timeline before letting it steer the search.' },
      { type: 'decision', title: 'Suspect A: the obvious one', dx: 780, dy: -140,
        description: 'The component everyone names first. Say what evidence would confirm it and what would rule it out.' },
      { type: 'decision', title: 'Suspect B: the boring one', dx: 780, dy: -10,
        description: 'Config, clock skew, a full disk, an expired credential. Cheap to check, and right more often than anyone admits.' },
      { type: 'context', title: 'What changed recently', dx: 260, dy: 180,
        description: 'Deploys, config edits, dependency bumps, infra changes, traffic shape. The blast radius of the last week.' },
      { type: 'output', title: 'Root cause, with evidence', dx: 1040, dy: -60, priority: 'high',
        description: 'The mechanism, and the specific log line, trace, or diff that proves it. A cause without evidence is still a guess.' },
      { type: 'risk', title: 'The fix breaks something else', dx: 1040, dy: 90,
        description: 'What else depends on the behaviour being changed, and how you would know if it broke.' },
      { type: 'requirement', title: 'A test that fails before the fix', dx: 1300, dy: -60, priority: 'high',
        description: 'Written against the reproduction. If it passes on the unfixed code, it is testing the wrong thing.' },
      { type: 'terminator', title: 'Fixed and proven', dx: 1560, dy: -60,
        description: 'Test goes red then green, the symptom is gone in the environment that reported it, and the cause is written down.' },
    ],
    arrows: [
      [0,1,'reported as'], [1,2,'reproduce'], [1,3,'scope'], [1,4,'when'],
      [4,5,'suggests'], [2,6,'points at'], [2,7,'points at'], [8,1,'context for'],
      [5,6,'underpins'], [6,9,'confirmed by'], [7,9,'confirmed by'],
      [9,10,'may cause'], [9,11,'requires'], [10,11,'guarded by'], [11,12,'closes'],
    ],
  },
  {
    icon: 'map',
    name: 'Inherit a Codebase',
    desc: 'Unknown repo → map → first safe change',
    large: true,
    mode: 'investigate',
    situation: { codebase: 'current', runtime: 'code', firstMove: 'read',
      constraints: 'Read before writing\nNo refactors until the tests run' },
    blocks: [
      { type: 'terminator', title: 'Handed the repo', dx: 0, dy: 0,
        description: 'What you were told it does, and by whom. Keep it: you will want to compare it against what you find.' },
      { type: 'goal', title: 'Be able to make a safe change', dx: 260, dy: 0, priority: 'high',
        description: 'Not "understand everything". The bar is: change one thing and know whether you broke anything.' },
      { type: 'process', title: 'Get it running locally', dx: 520, dy: -150,
        description: 'Build, run, and hit one real endpoint or screen. Time-box it, and write down every undocumented step you hit.' },
      { type: 'process', title: 'Run the test suite', dx: 520, dy: -20,
        description: 'How long it takes, what fails on a clean checkout, and whether anyone trusts it. A suite nobody trusts is not a safety net.' },
      { type: 'process', title: 'Trace one request end to end', dx: 520, dy: 110,
        description: 'Entry point to storage and back. One real path teaches more than a week of reading directory names.' },
      { type: 'question', title: 'Where does the money or the risk live?', dx: 780, dy: 110,
        description: 'Payments, auth, personal data, anything with a regulator attached. Find these before touching anything.' },
      { type: 'assumption', title: 'The README is current', dx: 780, dy: 240, actions: ['validate'],
        description: 'Usually written once at the start. Check it against the build you just ran, not the other way round.' },
      { type: 'assumption', title: 'Tests cover the important paths', dx: 780, dy: -20, actions: ['validate'],
        description: 'Coverage percentage is not the answer. Ask whether the paths you just traced are covered at all.' },
      { type: 'output', title: 'A map of the moving parts', dx: 1040, dy: -80,
        description: 'Services, storage, jobs, external calls, and which of them you can restart without asking permission.' },
      { type: 'output', title: 'A list of what is undocumented', dx: 1040, dy: 60,
        description: 'Every step you had to work out yourself. This is the highest-value thing a newcomer can write down, and only they can.' },
      { type: 'risk', title: 'Change breaks something invisible', dx: 1040, dy: 200,
        description: 'A cron, a downstream consumer, a report someone reads on Mondays. Name what has no test and no owner.' },
      { type: 'requirement', title: 'A rollback you have actually tried', dx: 1300, dy: 60, priority: 'high',
        description: 'Deploying without a tested rollback means the first change is also the first outage.' },
      { type: 'terminator', title: 'First change shipped', dx: 1560, dy: 60,
        description: 'Something small, reversible, and observable. The point is proving the loop works, not the change itself.' },
    ],
    arrows: [
      [0,1,'goal'], [1,2,'needs'], [1,3,'needs'], [1,4,'needs'],
      [4,5,'reveals'], [3,7,'tests'], [0,6,'claims'],
      [2,9,'produces'], [4,8,'produces'], [5,10,'flags'], [7,10,'underpins'],
      [8,11,'informs'], [10,11,'requires'], [9,11,'informs'], [11,12,'enables'],
    ],
  },
  {
    icon: 'migrate',
    name: 'Migrate a System',
    desc: 'Old → new, with a way back',
    large: true,
    mode: 'plan',
    situation: { codebase: 'current', runtime: 'code', firstMove: 'plan',
      constraints: 'No big-bang cutover\nEvery step must be reversible' },
    blocks: [
      { type: 'context', title: 'Why move at all', dx: 0, dy: -140,
        description: 'The cost of staying put, in numbers. A migration without this gets abandoned halfway.' },
      { type: 'goal', title: 'Everything on the new system', dx: 0, dy: 20, priority: 'high',
        description: 'With a date and a definition of done that includes the old system being switched off.' },
      { type: 'requirement', title: 'No data loss', dx: 280, dy: -140, priority: 'high',
        description: 'Reconciliation between old and new, run continuously, not once at the end.' },
      { type: 'requirement', title: 'Reversible at every step', dx: 280, dy: -10, priority: 'high',
        description: 'Each phase can be rolled back without a data migration in the other direction.' },
      { type: 'assumption', title: 'The old system can run alongside the new one', dx: 280, dy: 130, actions: ['validate'],
        description: 'The entire dual-running plan depends on this. Check it before anything else is designed around it.' },
      { type: 'assumption', title: 'We know every consumer', dx: 280, dy: 260, actions: ['validate'],
        description: 'There is always one more. Look at access logs, not at the documentation.' },
      { type: 'process', title: 'Shadow-write to both', dx: 560, dy: -80,
        description: 'New system receives every write, serves nothing. Cheap way to find schema surprises under real load.' },
      { type: 'process', title: 'Read from new, fall back to old', dx: 820, dy: -80,
        description: 'Reads move first because they are the reversible half. Measure the fallback rate; it is your correctness signal.' },
      { type: 'process', title: 'Move writes', dx: 1080, dy: -80,
        description: 'The point of no easy return. Do it per tenant or per region, never all at once.' },
      { type: 'process', title: 'Decommission the old system', dx: 1340, dy: -80,
        description: 'Left undone, you now maintain two systems forever. Put a date on it in the same plan.' },
      { type: 'risk', title: 'Silent divergence between the two', dx: 820, dy: 70,
        description: 'Both accept writes, they drift, nobody notices for weeks. Reconciliation has to alarm, not just log.' },
      { type: 'risk', title: 'Cutover under load', dx: 1080, dy: 70,
        description: 'What happens if the switch lands during peak traffic, and who is allowed to call it off.' },
      { type: 'decision', title: 'Per-tenant, not big bang', dx: 560, dy: 70,
        description: 'Slower, and the only version where the first failure is survivable.' },
      { type: 'output', title: 'Reconciliation report', dx: 1340, dy: 70, priority: 'high',
        description: 'Old versus new, per entity, every day, with a threshold that blocks the next phase.' },
      { type: 'terminator', title: 'Old system off', dx: 1600, dy: -80,
        description: 'Powered down, not just unused. Until then the migration is not finished.' },
    ],
    arrows: [
      [0,1,'motivates'], [1,2,'requires'], [1,3,'requires'],
      [4,3,'underpins'], [5,3,'underpins'], [12,3,'satisfies'],
      [1,6,'starts with'], [6,7,'then'], [7,8,'then'], [8,9,'then'], [9,14,'ends at'],
      [6,10,'risks'], [8,11,'risks'], [2,13,'proven by'], [13,8,'gates'],
    ],
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
      cardStyle: null, borderWidth: null,
    }
    return id
  })

  tpl.arrows.forEach(([fi, ti, label]) => {
    const fId = ids[fi], tId = ids[ti]
    if (fId && tId && fId !== tId) {
      const arrow = { id: genId(), from: fId, to: tId, style: 'routed', bidirectional: false, color: null, weight: 2, fromPort: null, toPort: null }
      if (label) arrow.label = label
      state.arrows.push(arrow)
    }
  })

  return ids
}

/**
 * A template's engagement setup, applied only to a canvas that was empty.
 *
 * Dropping "Investigate a Bug" onto a canvas already framed as a build is a
 * merge, and silently rewriting the framing under it would be the wrong call.
 */
export function applyTemplateSituation(tpl, canvasMeta, devOpts) {
  if (!tpl.situation && !tpl.mode) return false
  if (tpl.situation) canvasMeta.situation = { ...canvasMeta.situation, ...tpl.situation }
  if (tpl.mode) devOpts.mode = tpl.mode
  return true
}
