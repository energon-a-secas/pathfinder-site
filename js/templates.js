// ════════════════════════════════════════════════════════════
//  templates.js: pre-defined block patterns
//
//  Templates are content-bearing: each block ships a real title +
//  description (and sometimes priority / actions), and arrows carry
//  semantic labels. Applied to an empty canvas they produce a prompt
//  that already reads like a brief, which is the canvas-to-AI value
//  on display, not empty placeholder boxes.
//
//  An arrow is [from, to, label?, relation?]. The label is what the
//  reader sees; a label like "requires" also implies a relation
//  (depends-on), so where that inference would reverse the drawn
//  order, the arrow names its relation explicitly.
//
//  A large template's dx/dy are Tidy's own arrangement of it (left to
//  right, measured in the app), so the examples page, which opens the
//  raw positions through a share link and draws its pictures from them,
//  shows the map the palette shows after its Tidy, with no card on
//  another. Re-measure them if a large template gains or loses a block.
// ════════════════════════════════════════════════════════════

import { state, view } from './state.js'
import { $, genId, DEFAULT_ARROW_WEIGHT } from './utils.js'

// Template icons: the one stroked set (a 16px grid, a 1.5px stroke, round
// caps), like every other icon in the app (DESIGN.md Iconography).
const ticon = d => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
export const TICONS = {
  sprint:  ticon('<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3.25"/><circle cx="8" cy="8" r=".6"/>'),
  search:  ticon('<circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25L13.5 13.5"/>'),
  launch:  ticon('<circle cx="8" cy="8" r="6"/><path d="M2 8h12"/><path d="M8 2c1.6 1.6 2.4 3.6 2.4 6S9.6 12.4 8 14c-1.6-1.6-2.4-3.6-2.4-6S6.4 3.6 8 2z"/>'),
  balance: ticon('<path d="M8 1.75l5 2v4c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5v-4z"/><path d="M8 5.5v3.25"/><path d="M8 11v.01"/>'),
  idea:    ticon('<path d="M6 12.25h4"/><path d="M6.75 14.25h2.5"/><path d="M8 1.75a4.5 4.5 0 0 0-2.75 8.06c.47.36.75.9.75 1.47v.22h4v-.22c0-.57.28-1.11.75-1.47A4.5 4.5 0 0 0 8 1.75z"/>'),
  bug:     ticon('<rect x="5" y="5" width="6" height="8.5" rx="3"/><path d="M6.25 5a1.75 1.75 0 0 1 3.5 0"/><path d="M2.5 9.25H5M11 9.25h2.5M3 5.75l2 1.25M13 5.75L11 7M3 13l2-1.25M13 13l-2-1.25"/>'),
  map:     ticon('<path d="M2 4l4-1.5 4 1.5 4-1.5v9.5L10 13.5 6 12l-4 1.5z"/><path d="M6 2.5V12M10 4v9.5"/>'),
  migrate: ticon('<path d="M2.5 4.5h7M2.5 8h7M2.5 11.5h7"/><path d="M11.5 5.5L14 8l-2.5 2.5"/>'),
  report:  ticon('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5.5 11V8.5M8 11V5.5M10.5 11V7"/>'),
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
        description: 'Riskiest belief: if false, the whole idea changes. Pressure-test first.' },
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
        description: 'Which option won and why: the record future-you will thank you for.' },
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
        description: 'What actually ships: the artifact users touch.' },
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
      { type: 'problem', title: 'Observable symptom', dx: 340, dy: -23, priority: 'high', actions: ['resolve'],
        description: 'What actually happens, stated without a theory attached. "Checkout 500s on card payments", not "the payment service is broken".' },
      { type: 'process', title: 'Reproduce it', dx: 1020, dy: 0,
        description: 'The exact steps, environment and data that trigger it. A bug you cannot reproduce is a bug you cannot prove you fixed.' },
      { type: 'question', title: 'Does it happen on every environment?', dx: 680, dy: -166,
        description: 'Prod only, staging too, local? The answer eliminates whole classes of cause.' },
      { type: 'question', title: 'When did it start?', dx: 680, dy: 179,
        description: 'First report, first log line, last known-good deploy. Bisect the window before reading code.' },
      { type: 'assumption', title: 'It started with the last deploy', dx: 1020, dy: 157, actions: ['validate'],
        description: 'The most common and most wrong assumption in an outage. Check the timeline before letting it steer the search.' },
      { type: 'decision', title: 'Suspect A: the obvious one', dx: 1360, dy: 79,
        description: 'The component everyone names first. Say what evidence would confirm it and what would rule it out.' },
      { type: 'decision', title: 'Suspect B: the boring one', dx: 1360, dy: -78,
        description: 'Config, clock skew, a full disk, an expired credential. Cheap to check, and right more often than anyone admits.' },
      { type: 'context', title: 'What changed recently', dx: 0, dy: 157,
        description: 'Deploys, config edits, dependency bumps, infra changes, traffic shape. The blast radius of the last week.' },
      { type: 'output', title: 'Root cause, with evidence', dx: 1700, dy: -90, priority: 'high',
        description: 'The mechanism, and the specific log line, trace, or diff that proves it. A cause without evidence is still a guess.' },
      { type: 'risk', title: 'The fix breaks something else', dx: 2040, dy: -88,
        description: 'What else depends on the behaviour being changed, and how you would know if it broke.' },
      { type: 'requirement', title: 'A test that fails before the fix', dx: 2380, dy: -99, priority: 'high',
        description: 'Written against the reproduction. If it passes on the unfixed code, it is testing the wrong thing.' },
      { type: 'terminator', title: 'Fixed and proven', dx: 2720, dy: -78,
        description: 'Test goes red then green, the symptom is gone in the environment that reported it, and the cause is written down.' },
    ],
    arrows: [
      [0,1,'reported as'], [1,2,'reproduce'], [1,3,'scope'], [1,4,'when'],
      [4,5,'suggests'], [2,6,'points at'], [2,7,'points at'], [8,1,'context for'],
      [5,6,'underpins'], [6,9,'confirmed by'], [7,9,'confirmed by'],
      // "requires" alone reads as depends-on, which ordered the test before
      // the root cause and closed the cycle cause -> risk -> test -> cause.
      [9,10,'may cause'], [9,11,'requires','precedes'], [10,11,'guarded by'], [11,12,'closes'],
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
      { type: 'goal', title: 'Be able to make a safe change', dx: 340, dy: -116, priority: 'high',
        description: 'Not "understand everything". The bar is: change one thing and know whether you broke anything.' },
      { type: 'process', title: 'Get it running locally', dx: 1020, dy: -274,
        description: 'Build, run, and hit one real endpoint or screen. Time-box it, and write down every undocumented step you hit.' },
      { type: 'process', title: 'Run the test suite', dx: 680, dy: -95,
        description: 'How long it takes, what fails on a clean checkout, and whether anyone trusts it. A suite nobody trusts is not a safety net.' },
      { type: 'process', title: 'Trace one request end to end', dx: 680, dy: 62,
        description: 'Entry point to storage and back. One real path teaches more than a week of reading directory names.' },
      { type: 'question', title: 'Where does the money or the risk live?', dx: 1020, dy: 83,
        description: 'Payments, auth, personal data, anything with a regulator attached. Find these before touching anything.' },
      { type: 'assumption', title: 'The README is current', dx: 340, dy: 83, actions: ['validate'],
        description: 'Usually written once at the start. Check it against the build you just ran, not the other way round.' },
      { type: 'assumption', title: 'Tests cover the important paths', dx: 1020, dy: -117, actions: ['validate'],
        description: 'Coverage percentage is not the answer. Ask whether the paths you just traced are covered at all.' },
      { type: 'output', title: 'A map of the moving parts', dx: 1360, dy: -440,
        description: 'Services, storage, jobs, external calls, and which of them you can restart without asking permission.' },
      { type: 'output', title: 'A list of what is undocumented', dx: 1360, dy: -283,
        description: 'Every step you had to work out yourself. This is the highest-value thing a newcomer can write down, and only they can.' },
      { type: 'risk', title: 'Change breaks something invisible', dx: 1360, dy: -107,
        description: 'A cron, a downstream consumer, a report someone reads on Mondays. Name what has no test and no owner.' },
      { type: 'requirement', title: 'A rollback you have actually tried', dx: 1700, dy: -461, priority: 'high',
        description: 'Deploying without a tested rollback means the first change is also the first outage.' },
      { type: 'terminator', title: 'First change shipped', dx: 2040, dy: -440,
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
      { type: 'goal', title: 'Everything on the new system', dx: 340, dy: -161, priority: 'high',
        description: 'With a date and a definition of done that includes the old system being switched off.' },
      { type: 'requirement', title: 'No data loss', dx: 680, dy: -417, priority: 'high',
        description: 'Reconciliation between old and new, run continuously, not once at the end.' },
      { type: 'requirement', title: 'Reversible at every step', dx: 680, dy: 17, priority: 'high',
        description: 'Each phase can be rolled back without a data migration in the other direction.' },
      { type: 'assumption', title: 'The old system can run alongside the new one', dx: 340, dy: 38, actions: ['validate'],
        description: 'The entire dual-running plan depends on this. Check it before anything else is designed around it.' },
      { type: 'assumption', title: 'We know every consumer', dx: 340, dy: 238, actions: ['validate'],
        description: 'There is always one more. Look at access logs, not at the documentation.' },
      { type: 'process', title: 'Shadow-write to both', dx: 680, dy: -140,
        description: 'New system receives every write, serves nothing. Cheap way to find schema surprises under real load.' },
      { type: 'process', title: 'Read from new, fall back to old', dx: 1020, dy: -237,
        description: 'Reads move first because they are the reversible half. Measure the fallback rate; it is your correctness signal.' },
      { type: 'process', title: 'Move writes', dx: 1360, dy: -406,
        description: 'The point of no easy return. Do it per tenant or per region, never all at once.' },
      { type: 'process', title: 'Decommission the old system', dx: 1700, dy: -498,
        description: 'Left undone, you now maintain two systems forever. Put a date on it in the same plan.' },
      { type: 'risk', title: 'Silent divergence between the two', dx: 1020, dy: -61,
        description: 'Both accept writes, they drift, nobody notices for weeks. Reconciliation has to alarm, not just log.' },
      { type: 'risk', title: 'Cutover under load', dx: 1700, dy: -322,
        description: 'What happens if the switch lands during peak traffic, and who is allowed to call it off.' },
      { type: 'decision', title: 'Per-tenant, not big bang', dx: 340, dy: 419,
        description: 'Slower, and the only version where the first failure is survivable.' },
      { type: 'output', title: 'Reconciliation report', dx: 1020, dy: -417, priority: 'high',
        description: 'Old versus new, per entity, every day, with a threshold that blocks the next phase.' },
      { type: 'terminator', title: 'Old system off', dx: 2040, dy: -489,
        description: 'Powered down, not just unused. Until then the migration is not finished.' },
    ],
    arrows: [
      [0,1,'motivates'], [1,2,'requires'], [1,3,'requires'],
      [4,3,'underpins'], [5,3,'underpins'], [12,3,'satisfies'],
      [1,6,'starts with'], [6,7,'then'], [7,8,'then'], [8,9,'then'], [9,14,'ends at'],
      [6,10,'risks'], [8,11,'risks'], [2,13,'proven by'], [13,8,'gates'],
    ],
  },
  {
    // A reporting pipeline typed the way the six steps suggest: who reads
    // each report, what number it is judged by, the one-off build versus the
    // recurring run, and the cadences that start it. Unlabelled arrows are
    // deliberate: their endpoint types imply the verb (owns, measures,
    // satisfies, should move, triggers, delivered to) and the prompt prints
    // it. Arrows to and from readers and measures say `informs`, so they add
    // no task order; the rest keep the default. No title contains another,
    // and no description hides a question: the open one is its own block.
    icon: 'report',
    name: 'Recurring Reporting Flow',
    desc: 'Cadence → reports → readers, with a measure',
    large: true,
    mode: 'plan',
    situation: { codebase: 'none', runtime: 'chat', firstMove: 'plan',
      constraints: 'Automate only the reports someone reads\nOne source of truth for every number' },
    blocks: [
      { type: 'goal', title: 'Leaders see delivery health without asking', dx: 0, dy: 0, priority: 'high',
        description: 'What the reports are for. Without it every report below is output nobody can judge, and the easiest one to cut is the one that matters.' },
      { type: 'stakeholder', title: 'Executives', dx: -340, dy: 21,
        description: 'Read the quarterly roll-up. They want trend and risk rather than ticket detail, and they sign off the targets.' },
      { type: 'stakeholder', title: 'Delivery leads', dx: -340, dy: 178,
        description: 'Own each epic and act on its status every sprint. The sprint-end report is written for them first.' },
      { type: 'metric', title: 'Report lead time', dx: -340, dy: 335,
        description: 'Working days from a sprint or quarter closing to its report reaching the readers. The number the goal is judged by, not the count of reports sent.',
        criteria: ['One working day or less after each sprint closes, by the end of the quarter'] },
      { type: 'requirement', title: 'Reports need no manual assembly', dx: 340, dy: 0, priority: 'high',
        description: 'Every figure in every report comes from the work tracker, not from someone copying it across on a Friday afternoon.',
        criteria: ['Every figure comes from the work tracker; nobody retypes numbers',
          'Any report can be regenerated later and shows the same figures'] },
      { type: 'implementation', title: 'Build the report scheduler', dx: -1700, dy: 256,
        description: 'Work done once: connect the work tracker and the document tool so the reports assemble themselves. The run it enables is a Process.' },
      { type: 'resource', title: 'Work tracker', dx: -2040, dy: 424,
        description: 'The system of record every report reads from. If it is wrong or late, every report is wrong or late with it.' },
      { type: 'terminator', title: 'Every end of sprint', dx: -1700, dy: 413,
        description: 'The cadence that starts the sprint-end run. A moment in time, so it is a Trigger, not a step and not a report.' },
      { type: 'terminator', title: 'Quarter end', dx: -1020, dy: 21,
        description: 'Starts the quarterly roll-up. Its own trigger, because the executives read on a different clock from the delivery leads.' },
      { type: 'process', title: 'Assemble each epic\'s status notes', dx: -1360, dy: 247,
        description: 'The recurring run: pull progress, plans and problems for each open epic from the work tracker, every time the trigger fires.' },
      { type: 'output', title: 'Status notes per epic', dx: -1020, dy: 178,
        description: 'Progress, plans and problems for one epic on one page. The unit every other report is assembled from.' },
      { type: 'output', title: 'Sprint-end report', dx: -680, dy: 178,
        description: 'Every epic\'s status notes for the sprint that just closed, with what slipped and why, for the people who can act on it.' },
      { type: 'output', title: 'Quarterly roll-up', dx: -680, dy: 21,
        description: 'The quarter in one document: lead time against target, the epics at risk, and the decisions needed from leadership.' },
      { type: 'output', title: 'Weekly status report', dx: -1020, dy: 335,
        description: 'An older format still produced every week. Nobody on the map receives it, which is the open question beside it.' },
      { type: 'question', title: 'Does anyone still read the weekly report?', dx: -1360, dy: 423,
        description: 'If nobody reads it, retire it rather than automate it. Ask the delivery leads before the scheduler is built.' },
      { type: 'risk', title: 'Tracker data is stale or incomplete', dx: -1700, dy: 570, actions: ['prepare'],
        description: 'Epics not updated before the trigger fires turn into confident reports of old news. Remind owners a day before.' },
    ],
    arrows: [
      [1,0,'','informs'], [3,0,'','informs'], [0,4,'requires'],
      [5,4], [5,3,'','informs'], [6,5,'feeds'], [6,15,'can go stale','related'],
      [7,9], [5,9,'automates'], [9,10,'produces'],
      [10,11,'rolls into'], [10,12,'rolls into'], [8,12,'starts'],
      [11,2,'','informs'], [12,1,'','informs'],
      [9,13,'produces'], [14,13,'about','related'],
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
      actions: bd.actions ? [...bd.actions] : [],
      questions: bd.questions ? bd.questions.map(q => ({ text: q.text })) : [],
      criteria: bd.criteria ? [...bd.criteria] : [],
      rationale: bd.rationale || '',
      width: null, color: null, collapsed: false, groupId: null,
      status: bd.status || null, priority: bd.priority || null,
      cardStyle: null, borderWidth: null,
    }
    return id
  })

  tpl.arrows.forEach(([fi, ti, label, relation]) => {
    const fId = ids[fi], tId = ids[ti]
    if (fId && tId && fId !== tId) {
      const arrow = { id: genId(), from: fId, to: tId, style: 'routed', bidirectional: false, color: null, weight: DEFAULT_ARROW_WEIGHT, fromPort: null, toPort: null }
      if (label) arrow.label = label
      if (relation) arrow.relation = relation
      state.arrows.push(arrow)
    }
  })

  return ids
}

// ── User templates: your own canvas, kept as a starting point ─
// Stored in the same shape the built-ins use, so applyTemplate treats both
// identically. Positions are normalised to the canvas's own top-left, and
// the situation and mode ride along like the large built-ins carry theirs.

const USER_TPL_KEY = 'pathfinder-templates'
const MAX_USER_TPL = 12

export function listUserTemplates() {
  try {
    const arr = JSON.parse(localStorage.getItem(USER_TPL_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch (_) { return [] }
}

export function deleteUserTemplate(id) {
  try {
    localStorage.setItem(USER_TPL_KEY, JSON.stringify(listUserTemplates().filter(t => t.id !== id)))
  } catch (_) {}
}

/**
 * Capture the live canvas as a reusable template. Pure of DOM: reads state
 * and returns the stored entry (or null when there is nothing to save or no
 * room). `deps` exist so tests can hand in plain objects.
 */
export function saveCurrentAsTemplate(name, deps) {
  const st = deps?.state || state
  const meta = deps?.canvasMeta
  const mode = deps?.mode
  const blocks = Object.values(st.blocks)
  if (!blocks.length) return null
  const minX = Math.min(...blocks.map(b => b.x))
  const minY = Math.min(...blocks.map(b => b.y))
  const index = new Map(blocks.map((b, i) => [b.id, i]))
  const tpl = {
    id: genId(),
    name: (name || '').trim() || 'My template',
    desc: `${blocks.length} block${blocks.length === 1 ? '' : 's'} · yours`,
    large: blocks.length > 8,
    user: true,
    blocks: blocks.map(b => ({
      type: b.type, title: b.title, description: b.description || '',
      dx: Math.round(b.x - minX), dy: Math.round(b.y - minY),
      actions: (b.actions || []).slice(), priority: b.priority || undefined,
      status: b.status || undefined,
      criteria: (b.criteria || []).slice(),
      rationale: b.rationale || undefined,
      questions: (b.questions || []).map(q => ({ text: q.text })),
    })),
    arrows: st.arrows
      .filter(a => index.has(a.from) && index.has(a.to))
      .map(a => [index.get(a.from), index.get(a.to), a.label || undefined, ...(a.relation ? [a.relation] : [])]),
  }
  if (meta?.situation) tpl.situation = { ...meta.situation }
  if (mode) tpl.mode = mode
  const all = listUserTemplates()
  all.push(tpl)
  while (all.length > MAX_USER_TPL) all.shift()
  try { localStorage.setItem(USER_TPL_KEY, JSON.stringify(all)) } catch (_) { return null }
  return tpl
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
