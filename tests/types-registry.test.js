// ============================================================
//  types-registry.test.js -- the types stream: every consumer reads
//  the type registry and none drops a type (prompt modes, Markdown,
//  Spec bundle, Presentation Sage, meeting summary, Mermaid, the AI
//  diagram-builder prompt), implied verbs, work items in the task
//  plan, the classifier on a real reporting canvas, the templates'
//  gap sets, and legacy canvases that still load.
// ============================================================

import { describe, it, assert, mockBlockEl, mockGapIconEl, cleanupMockEls } from './test-utils.js'
import { state, devOpts, ui, canvasMeta, selection } from '../js/state.js'
import { TYPES, TYPE_STEPS, PROMPT_MODES, typeInfo, resolveTypeId, clearAllVotes, getAllVotes } from '../js/utils.js'
import { normalizeBlock, normalizeCanvas } from '../js/normalize.js'
import { generatePrompt, connectionLine, acceptedGapLines, firingGaps, PROMPT_ORDERS, PROMPT_SECTION_TYPES } from '../js/prompt.js'
import { buildMarkdown, exportTypeOrder, buildSageYaml, buildMeetingSummary, exportMeetingSummary, exportJSON,
         mermaidBlock, mermaidShape, summaryShareLink } from '../js/export.js'
import { buildSpecFiles, SPEC_BUNDLE_HOME } from '../js/spec-export.js'
import { taskChecklist, satisfiedRequirements } from '../js/task-plan.js'
import { DIAGRAM_BUILDER_PROMPT, allowedTypeLines, stepLines } from '../js/diagram-instructions.js'
import { TEMPLATES, applyTemplate } from '../js/templates.js'
import { runGapDetection } from '../js/gaps.js'
import { categorizeLine, createBlocksFromText } from '../js/classify.js'
import { parseMermaid } from '../js/interop.js'
import * as interop from '../js/interop.js'

const EM_DASH = String.fromCharCode(0x2014)
const IDS = Object.keys(TYPES)

// ── Fixtures ──────────────────────────────────────────────────

function reset() {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  selection.ids.clear(); selection.blockId = null; selection.arrowId = null
  canvasMeta.title = ''
  canvasMeta.contextBrief = ''
  devOpts.tone = 'auto'
  devOpts.detail = 'standard'
  devOpts.prePrompts = new Set()
  devOpts.mode = 'plan'
  ui.promptDirty = true
}

function add(id, type, title, extra = {}) {
  state.blocks[id] = {
    id, type, title, description: '', notes: '', x: 0, y: 0,
    actions: [], questions: [], criteria: [], rationale: '',
    width: null, color: null, collapsed: false, groupId: null, status: null, priority: null,
    ...extra,
  }
  mockBlockEl(id)
  mockGapIconEl(id)
  return state.blocks[id]
}

function link(from, to, extra = {}) {
  state.arrows.push({ id: `a-${from}-${to}`, from, to, ...extra })
}

// One block of every type, titled after it, chained so every export has
// connections to print.
function seedEveryType() {
  reset()
  canvasMeta.title = 'Registry coverage'
  IDS.forEach(t => add('b-' + t, t, `Block of ${t}`, t === 'metric' ? { criteria: ['80% by Q4'] } : {}))
  IDS.slice(1).forEach((t, i) => link('b-' + IDS[i], 'b-' + t))
}

// The section of a prompt that starts at `heading`, up to the next ## heading.
function sectionOf(text, heading) {
  const at = text.indexOf(heading + '\n')
  if (at < 0) return ''
  const next = text.indexOf('\n## ', at + heading.length)
  return text.slice(at, next < 0 ? undefined : next)
}

// The prompt's canvas body: from the canvas title to the first section that
// lists blocks from every type again (Connections, gaps, the reply's block
// ids). A title found only after it would hide a dropped section.
function promptBody(p) {
  const start = p.indexOf('\n# ')
  const ends = ['\n## Connections\n', '\n## Groups\n', '\n## Action Labels\n', '\n## Planning Gaps Detected\n',
    '\n## Accepted gaps\n', '\n## When you reply\n'].map(h => p.indexOf(h, start)).filter(i => i >= 0)
  return p.slice(start, ends.length ? Math.min(...ends) : undefined)
}

// A file with its Mermaid graphs removed: plan.md's Structure graph names
// every block, so a title found there proves nothing about its section.
const withoutGraphs = text => text.replace(/```mermaid[\s\S]*?```/g, '')

// ── Registry coverage ─────────────────────────────────────────
// The test methodology.md asked for first: it would have caught Clarify
// dropping resources, outputs and custom, the Spec bundle dropping problems,
// and Presentation Sage dropping five types.

describe('registry coverage -- prompt modes', () => {
  it('has an order for every prompt mode, and no order for a mode that does not exist', () => {
    assert.deepEq(Object.keys(PROMPT_ORDERS).sort(), [...PROMPT_MODES].sort())
  })

  it('every mode prints every registry type through some section', () => {
    PROMPT_MODES.forEach(mode => {
      const printed = new Set(PROMPT_ORDERS[mode].flatMap(k => PROMPT_SECTION_TYPES[k] || []))
      IDS.forEach(t => assert.ok(printed.has(t), `${mode} has no section for ${t}`))
    })
  })

  it('every section an order names exists, and no section is named twice in one mode', () => {
    PROMPT_MODES.forEach(mode => {
      const order = PROMPT_ORDERS[mode]
      order.forEach(k => assert.ok(PROMPT_SECTION_TYPES[k], `${mode}: unknown section ${k}`))
      assert.eq(new Set(order).size, order.length, `${mode} repeats a section`)
    })
  })

  it('section types name only registry types, and tasks follow the registry task flag', () => {
    Object.values(PROMPT_SECTION_TYPES).flat().forEach(t => assert.ok(Object.hasOwn(TYPES, t), `${t} is a registry type`))
    assert.deepEq(PROMPT_SECTION_TYPES.tasks, IDS.filter(t => TYPES[t].task))
  })

  it('a block of every type reaches every mode, headed by its registry section', () => {
    seedEveryType()
    PROMPT_MODES.forEach(mode => {
      devOpts.mode = mode
      const p = generatePrompt()
      const body = promptBody(p)
      IDS.forEach(t => assert.includes(body, `Block of ${t}`, `${mode} carries ${t} in the canvas body`))
      // Build folds task types into the checklist; flow types print in the
      // workflow walk; every other type gets its own registry heading. Each
      // title is looked for inside its own section, since the checklist's
      // "after:" lines and the Connections list name other types' blocks.
      IDS.forEach(t => {
        const heading = mode === 'build' && TYPES[t].task ? '## Implementation checklist'
          : t === 'process' || t === 'terminator' ? '## Workflow (end-to-end)'
          : `## ${TYPES[t].section}`
        assert.includes(sectionOf(p, heading), `Block of ${t}`, `${mode} prints ${t} under ${heading}`)
      })
    })
    reset()
  })

  it('prints the legend in registry order, one line per type used', () => {
    seedEveryType()
    const p = generatePrompt()
    const legend = sectionOf(p, '## Block Type Legend')
    const at = IDS.map(t => legend.indexOf(`**${TYPES[t].label}**: ${TYPES[t].legend}`))
    at.forEach((pos, i) => assert.ok(pos >= 0, `legend line for ${IDS[i]}`))
    assert.deepEq([...at].sort((a, b) => a - b), at, 'legend follows the registry order')
    reset()
  })

  it('tells a replying assistant the type ids a new block may use', () => {
    reset()
    add('g', 'goal', 'Ship it')
    const p = generatePrompt()
    assert.includes(p, `A new block's type is one of: ${IDS.join(', ')}.`)
    reset()
  })
})

describe('registry coverage -- Markdown export', () => {
  it('orders sections by the registry, and appends an unknown id instead of dropping it', () => {
    reset()
    assert.deepEq(exportTypeOrder({}), IDS)
    assert.deepEq(exportTypeOrder({ x: { type: 'later-type' } }), [...IDS, 'later-type'])
  })

  it('heads every type with its registry section, in registry order', () => {
    seedEveryType()
    const md = buildMarkdown()
    const at = IDS.map(t => md.indexOf(`## ${TYPES[t].section}\n`))
    at.forEach((pos, i) => assert.ok(pos >= 0, `section for ${IDS[i]}`))
    assert.deepEq([...at].sort((a, b) => a - b), at)
    assert.notIncludes(md, 'Start / End', 'no retired label')
    assert.notIncludes(md, 'undefined')
    reset()
  })
})

describe('registry coverage -- Spec bundle', () => {
  it('gives every type but Other a home file', () => {
    IDS.filter(t => t !== 'custom').forEach(t => assert.ok(SPEC_BUNDLE_HOME[t], `${t} has a home`))
    Object.keys(SPEC_BUNDLE_HOME).forEach(t => assert.ok(Object.hasOwn(TYPES, t), `${t} is a registry type`))
  })

  it('puts each block in its home file: stakeholders and metrics in spec.md, work in tasks.md', () => {
    seedEveryType()
    const files = Object.fromEntries(buildSpecFiles(new Date(0)).map(f => [f.name, f.data]))
    IDS.forEach(t => {
      const home = SPEC_BUNDLE_HOME[t] || 'spec.md'
      assert.includes(withoutGraphs(files[home]), `Block of ${t}`, `${t} is in ${home}, outside the graph`)
    })
    assert.includes(files['spec.md'], '## Stakeholders')
    assert.includes(files['spec.md'], '## Success metrics')
    assert.includes(files['spec.md'], '## Problems')
    assert.notIncludes(files['spec.md'], 'Block of implementation', 'work items live in tasks.md')
    assert.includes(files['plan.md'], `(${TYPES.terminator.label})`, 'the workflow names triggers with the current label')
    Object.values(files).forEach(text => {
      assert.notIncludes(text, 'undefined')
      assert.notIncludes(text, '(start/end)')
    })
    reset()
  })

  it('the coverage checks above cannot be satisfied by the graph or the id list alone', () => {
    // plan.md's graph and the prompt's reply section both list every block;
    // with them removed, a canvas's titles must be gone.
    seedEveryType()
    const plan = buildSpecFiles(new Date(0)).find(f => f.name === 'plan.md').data
    assert.includes(plan, '```mermaid', 'the graph is present to be removed')
    const graphOnly = plan.slice(plan.indexOf('## Structure'))
    IDS.forEach(t => assert.includes(graphOnly, `Block of ${t}`))
    assert.notIncludes(withoutGraphs(graphOnly), 'Block of')
    const p = generatePrompt()
    assert.includes(p.slice(p.indexOf('\n## Connections\n')), 'Block of resource')
    assert.notIncludes(promptBody(p), '## Connections')
    assert.notIncludes(promptBody(p), '### Block ids')
    reset()
  })

  it('names every task type when there are no tasks yet', () => {
    reset()
    add('g', 'goal', 'A goal')
    const tasks = buildSpecFiles(new Date(0)).find(f => f.name === 'tasks.md').data
    IDS.filter(t => TYPES[t].task).forEach(t => assert.includes(tasks, TYPES[t].label))
    reset()
  })
})

describe('registry coverage -- Presentation Sage', () => {
  it('gives every type present a slide headed by its registry plural, in registry order', () => {
    seedEveryType()
    const yaml = buildSageYaml()
    const at = IDS.map(t => yaml.indexOf(`heading: "${TYPES[t].plural}"`))
    at.forEach((pos, i) => assert.ok(pos >= 0, `slide for ${IDS[i]}`))
    assert.deepEq([...at].sort((a, b) => a - b), at)
    IDS.forEach(t => assert.includes(yaml, `- "Block of ${t}"`))
    reset()
  })

  it('escapes quotes, backslashes and newlines in titles', () => {
    reset()
    canvasMeta.title = 'A "quoted" \\ plan'
    add('g', 'goal', 'Line one\nline "two"')
    const yaml = buildSageYaml()
    assert.includes(yaml, 'title: "A \\"quoted\\" \\\\ plan"')
    assert.includes(yaml, '- "Line one line \\"two\\""')
    reset()
  })
})

describe('registry coverage -- meeting summary', () => {
  it('has plain-text headings, no SVG markup, and every type on the canvas', () => {
    seedEveryType()
    add('q2', 'risk', 'Vendor slips', { questions: [{ text: 'Who owns the contract?' }] })
    link('q2', 'b-goal')
    const md = buildMeetingSummary({ now: new Date(0), shareUrl: 'https://example.test/?readonly#s=abc' })
    assert.notIncludes(md, '<svg')
    assert.notIncludes(md, 'undefined')
    md.split('\n').filter(l => l.startsWith('#')).forEach(l => assert.ok(!/[<>]/.test(l), `plain heading: ${l}`))
    IDS.forEach(t => assert.includes(md, `Block of ${t}`, `summary carries ${t}`))
    assert.includes(md, '**Canvas (view-only link):** https://example.test/?readonly#s=abc')
    assert.includes(md, '- Who owns the contract? (on "Vendor slips")', 'a question raised on another block is listed')
    assert.includes(md, '# Meeting Summary: Registry coverage')
    reset()
  })

  it('the download asks the sharing code for a view-only link, and waits for it', async () => {
    reset()
    add('d', 'decision', 'Use Postgres')
    const origCreate = URL.createObjectURL, origClick = HTMLAnchorElement.prototype.click
    URL.createObjectURL = () => 'blob:captured'
    HTMLAnchorElement.prototype.click = function () {}
    let md = ''
    try { md = await exportMeetingSummary() } finally {
      URL.createObjectURL = origCreate
      HTMLAnchorElement.prototype.click = origClick
    }
    assert.includes(md, '**Canvas (view-only link):** http')
    assert.includes(md, 'Use Postgres')
    reset()
  })

  it('asks for the compressed link first, and says so when the link is too long to paste', async () => {
    const short = 'https://example.test/?readonly#z=abc'
    const long = 'https://example.test/?readonly#s=' + 'x'.repeat(5000)
    const both = { buildShareUrl: () => long, buildShareUrlAsync: async () => short }
    assert.deepEq(await summaryShareLink(both), { url: short }, 'the async builder wins over a stale long form')
    assert.deepEq(await summaryShareLink({ buildShareUrl: () => short }), { url: short })
    assert.deepEq(await summaryShareLink({ buildShareUrl: () => long }), { url: '', omitted: true })
    assert.deepEq(await summaryShareLink({}), { url: '' })
    assert.deepEq(await summaryShareLink({ buildShareUrl: () => { throw new Error('no') } }), { url: '' })
    reset()
    add('d', 'decision', 'Use Postgres')
    const md = buildMeetingSummary({ now: new Date(0), shareOmitted: true })
    assert.notIncludes(md, 'Canvas (view-only link)')
    assert.includes(md, '**Canvas:** too large for a link in this summary. In Pathfinder, use Share, then Copy view-only link.')
    reset()
  })

  it('a hand-edited votes hash cannot break the summary', () => {
    const before = location.pathname + location.search + location.hash
    try {
      reset()
      add('a', 'decision', 'Use Postgres')
      history.replaceState(null, '', location.pathname + location.search + '#votes=' +
        encodeURIComponent('{"a":[null,{"userId":"u","dots":2},{"dots":"x"}]}'))
      const md = buildMeetingSummary({ now: new Date(0) })
      assert.includes(md, '**Participants:** 1')
      assert.includes(md, '| 1 | Use Postgres (Decision) | 2 |')
    } finally {
      history.replaceState(null, '', before)
      reset()
    }
  })

  it('a summary that cannot be built fails before the caller confirms, and a late failure never rejects', async () => {
    const origCreate = URL.createObjectURL, origClick = HTMLAnchorElement.prototype.click, origError = console.error
    let clicks = 0, logged = 0
    HTMLAnchorElement.prototype.click = function () { clicks++ }
    console.error = () => { logged++ }
    try {
      reset()
      add('d', 'decision', 'Use Postgres')
      state.arrows = null
      assert.throws(() => exportMeetingSummary(), 'throws synchronously, so the click handler stops')
      assert.eq(clicks, 0)
      state.arrows = []
      URL.createObjectURL = () => { throw new Error('blocked') }
      const md = await exportMeetingSummary()
      assert.eq(md, '', 'settles with nothing instead of rejecting')
      assert.eq(clicks, 0)
      assert.eq(logged, 1, 'the failure is logged once')
      assert.includes(document.querySelector('.toast-notification')?.textContent || '', 'Could not export the meeting summary')
    } finally {
      URL.createObjectURL = origCreate
      HTMLAnchorElement.prototype.click = origClick
      console.error = origError
      document.querySelectorAll('.toast-notification').forEach(el => el.remove())
      reset()
    }
  })

  it('leaves the link out when none is given, instead of pasting the app URL', () => {
    reset()
    add('d', 'decision', 'Use Postgres')
    const md = buildMeetingSummary({ now: new Date(0) })
    assert.notIncludes(md, 'Canvas (view-only link)')
    assert.notIncludes(md, location.href)
    reset()
  })
})

describe('registry coverage -- AI diagram-builder prompt', () => {
  it('lists every type id once, with its registry meaning', () => {
    const lines = allowedTypeLines().split('\n')
    assert.eq(lines.length, IDS.length)
    IDS.forEach((t, i) => {
      assert.match(lines[i], new RegExp(`^\\s+${t}\\s+- `), `line ${i} is ${t}`)
      assert.includes(lines[i], TYPES[t].short)
    })
    assert.includes(DIAGRAM_BUILDER_PROMPT, allowedTypeLines())
  })

  it('teaches the six steps in order, with the types that answer each', () => {
    const steps = stepLines().split('\n')
    assert.eq(steps.length, TYPE_STEPS.filter(s => s.id !== 'other').length)
    assert.includes(steps[0], 'Why')
    assert.includes(steps[0], 'goal, problem')
    assert.includes(steps[5], 'Doubt')
    assert.includes(DIAGRAM_BUILDER_PROMPT, stepLines())
    assert.includes(DIAGRAM_BUILDER_PROMPT, 'File -> Import')
    assert.notIncludes(DIAGRAM_BUILDER_PROMPT, EM_DASH)
  })
})

describe('registry coverage -- types this build does not know', () => {
  it('typeInfo names an unknown id after itself instead of printing undefined', () => {
    assert.eq(typeInfo('goal'), TYPES.goal)
    const info = typeInfo('roadmap-item')
    assert.eq(info.label, 'roadmap-item')
    assert.eq(info.section, 'roadmap-item')
    assert.eq(info.plural, 'roadmap-item')
    assert.eq(info.criteria, false)
    assert.eq(typeInfo('constructor').label, 'constructor', 'an inherited name is not a registry entry')
  })

  it('every exporter keeps a block whose type id is unknown', () => {
    reset()
    add('g', 'goal', 'Known goal')
    add('x', 'later-type', 'From a newer build')
    link('g', 'x')
    const p = generatePrompt()
    assert.includes(p, '## later-type\n')
    assert.includes(p, 'From a newer build')
    assert.includes(buildMarkdown(), '## later-type\n')
    assert.includes(buildSageYaml(), '- "From a newer build"')
    assert.includes(buildSpecFiles(new Date(0)).map(f => f.data).join('\n'), 'From a newer build')
    ;[p, buildMarkdown(), buildSageYaml()].forEach(text => assert.notIncludes(text, 'undefined'))
    reset()
  })

  it('every registry entry carries a short plural', () => {
    IDS.forEach(t => assert.ok(typeof TYPES[t].plural === 'string' && TYPES[t].plural.trim(), `${t}.plural`))
    assert.notIncludes(JSON.stringify(TYPES), EM_DASH)
  })
})

// ── Implied verbs ────────────────────────────────────────────

describe('connections -- implied verbs', () => {
  it('prints the verb an unlabelled arrow implies, marked as implied', () => {
    reset()
    add('w', 'implementation', 'Build the scheduler')
    add('o', 'output', 'Weekly report')
    link('w', 'o')
    const line = connectionLine(state.arrows[0])
    assert.eq(line, '• Implementation "Build the scheduler" [implied: produces] → Output "Weekly report"')
    assert.includes(generatePrompt(), line)
    reset()
  })

  it('does not guess over an author label, and prints nothing for a pair with no verb', () => {
    reset()
    add('w', 'implementation', 'Build')
    add('o', 'output', 'Report')
    add('g', 'goal', 'Goal')
    link('w', 'o', { label: 'ships' })
    link('g', 'o')
    assert.eq(connectionLine(state.arrows[0]), '• Implementation "Build" [ships] → Output "Report"')
    assert.eq(connectionLine(state.arrows[1]), '• Goal "Goal" → Output "Report"')
    reset()
  })

  it('reads a context-only relation into the implied verb instead of printing a second verb', () => {
    reset()
    add('o', 'output', 'Roll-up')
    add('s', 'stakeholder', 'Executives')
    add('g', 'goal', 'Leaders see health')
    link('o', 's', { relation: 'informs' })
    link('s', 'g', { relation: 'related' })
    assert.eq(connectionLine(state.arrows[0]), '• Output "Roll-up" [implied: delivered to; context only] → Stakeholder "Executives"')
    assert.eq(connectionLine(state.arrows[1]), '• Stakeholder "Executives" [implied: owns; context only] → Goal "Leaders see health"')
    const md = buildMarkdown()
    assert.includes(md, '- **Roll-up** → **Executives**: _(implied: delivered to; context only)_')
    assert.notIncludes(md, '_informs_ _(implied')
    reset()
  })

  it('keeps an ordering relation beside the implied verb, since the two do not disagree', () => {
    reset()
    add('t', 'terminator', 'Every end of sprint')
    add('p', 'process', 'Assemble the report')
    add('o', 'output', 'Roll-up')
    link('t', 'p', { relation: 'precedes' })
    link('o', 'p', { relation: 'informs', label: 'feeds' })
    assert.eq(connectionLine(state.arrows[0]), '• Trigger / End "Every end of sprint" [comes before] [implied: triggers] → Process "Assemble the report"')
    assert.eq(connectionLine(state.arrows[1]), '• Output "Roll-up" [informs: feeds] → Process "Assemble the report"', 'an author label is never guessed over')
    reset()
  })

  it('shows the implied verb in the Markdown connections too', () => {
    reset()
    add('m', 'metric', 'Lead time')
    add('g', 'goal', 'Leaders see health')
    link('m', 'g')
    assert.includes(buildMarkdown(), '- **Lead time** → **Leaders see health**: _(implied: measures)_')
    reset()
  })

  it('returns nothing for an arrow whose endpoint is gone', () => {
    reset()
    add('m', 'metric', 'Lead time')
    assert.eq(connectionLine({ from: 'm', to: 'gone' }), '')
    reset()
  })
})

// ── Task plan: work items ────────────────────────────────────

describe('task plan -- implementation satisfies a requirement', () => {
  const blocks = () => ({
    req: { id: 'req', type: 'requirement', title: 'No manual assembly', criteria: ['Every figure from the tracker'] },
    bare: { id: 'bare', type: 'requirement', title: 'Regenerable', criteria: [] },
    work: { id: 'work', type: 'implementation', title: 'Build the scheduler', criteria: [] },
    solo: { id: 'solo', type: 'implementation', title: 'Unanchored work', criteria: [] },
    goal: { id: 'goal', type: 'goal', title: 'Goal' },
  })

  it('finds the requirements a work item is wired to, either direction, once each', () => {
    const b = blocks()
    const arrows = [{ from: 'work', to: 'req' }, { from: 'bare', to: 'work' }, { from: 'work', to: 'req' }, { from: 'work', to: 'goal' }]
    assert.deepEq(satisfiedRequirements(b.work, b, arrows).map(r => r.id), ['req', 'bare'])
    assert.deepEq(satisfiedRequirements(b.req, b, arrows), [], 'only work items satisfy')
  })

  it('prints satisfies: with the requirement criteria, instead of asking for its own', () => {
    const b = blocks()
    const out = taskChecklist(b, [{ from: 'work', to: 'req' }])
    const item = out.slice(out.indexOf('Build the scheduler'))
    const own = item.split('\n- ')[0]
    assert.includes(own, 'satisfies: No manual assembly (req)')
    assert.includes(own, '- [ ] Every figure from the tracker')
    assert.notIncludes(own, '[NEEDS INPUT: acceptance criteria]\n')
  })

  it('asks for criteria on the requirement when it has none', () => {
    const b = blocks()
    const out = taskChecklist(b, [{ from: 'work', to: 'bare' }])
    assert.includes(out, '[NEEDS INPUT: acceptance criteria on "Regenerable"]')
  })

  it('still asks a work item that satisfies nothing for its own criteria', () => {
    const b = blocks()
    const out = taskChecklist({ solo: b.solo }, [])
    assert.includes(out, 'Unanchored work')
    assert.includes(out, '[NEEDS INPUT: acceptance criteria]')
    assert.notIncludes(out, 'satisfies:')
  })

  it('Build mode lists the work item in the checklist', () => {
    reset()
    const b = blocks()
    Object.values(b).forEach(x => add(x.id, x.type, x.title, { criteria: x.criteria || [] }))
    link('work', 'req')
    devOpts.mode = 'build'
    const p = generatePrompt()
    assert.includes(sectionOf(p, '## Implementation checklist'), 'satisfies: No manual assembly')
    reset()
  })
})

// ── Classifier ───────────────────────────────────────────────
// The eleven block titles from a real reporting canvas (methodology.md, "The
// user's canvas re-typed"), what the classifier makes of each from the title
// alone, and what its author meant. Where they differ, the test says so: a
// title cannot always carry its type, which is why a low-confidence call is
// flagged for a person to check rather than trusted. Two titles named the
// source organisation; they are anonymised here ("Acme") because this file
// is public, and the stand-ins take the same classifier path.

const REPORTING_TITLES = [
  // title, classifier type, confidence, the type its author meant
  ['Executive Reporting', 'stakeholder', 'low', 'stakeholder'],     // an audience word alone is a guess, so it asks to be checked
  ['Acme Model Reporting', 'custom', 'low', 'stakeholder'],         // misfile: nothing in the words says audience
  ['Every End of Sprint', 'terminator', 'high', 'terminator'],
  ['Status notes per Epic (Deliverable)', 'output', 'low', 'output'],
  ['Schedule status notes', 'custom', 'low', 'implementation'],               // misfile: a bare verb could be a step or a build
  ['Weekly Reports', 'output', 'low', 'output'],
  ['End of Sprint', 'terminator', 'high', 'output'],                 // reads as a moment; its author meant the sprint-end report
  ['Key Results', 'metric', 'high', 'metric'],
  ["On Quarter's end", 'terminator', 'high', 'terminator'],
  ['Acme Central', 'resource', 'low', 'resource'],
  ['Multi Reports', 'output', 'low', 'output'],
]

describe('categorizeLine() -- a real reporting canvas', () => {
  REPORTING_TITLES.forEach(([title, type, confidence]) => {
    it(`"${title}" -> ${type} (${confidence})`, () => {
      const r = categorizeLine(title)
      assert.eq(r.type, type)
      assert.eq(r.confidence, confidence)
      assert.eq(r.title, title)
    })
  })

  it('agrees with the author on eight of eleven, and every miss is low confidence or a defensible reading', () => {
    const hits = REPORTING_TITLES.filter(([, got, , meant]) => got === meant).length
    assert.eq(hits, 8)
    REPORTING_TITLES.filter(([, got, conf, meant]) => got !== meant && conf === 'high')
      .forEach(([title]) => assert.eq(title, 'End of Sprint', 'the only confident miss is the one a person could read either way'))
  })
})

describe('categorizeLine() -- plural-safe and new cues', () => {
  const cases = [
    ['Quarterly results', 'output'],
    ['Deliverables for the pilot', 'output'],
    ['Open risks on the release', 'risk'],
    ['Known issues in checkout', 'problem'],
    ['Implement the retry queue', 'implementation'],
    ['Build the report scheduler', 'implementation'],
    ['Integrate SSO with the identity provider', 'implementation'],
    ['Migrate billing to the new ledger', 'implementation'],
    ['Automate the weekly export', 'implementation'],
    ['Set up the staging environment', 'implementation'],
    ['KPI: weekly active teams', 'metric'],
    ['Churn rate under 3%', 'metric'],
    ['Sprint predictability metric', 'metric'],
    ['stakeholder: Finance', 'stakeholder'],
    ['Leadership team', 'stakeholder'],
    ['Customers', 'stakeholder'],
    ['Data warehouse', 'resource'],
    ['Partner portal', 'resource'],
    ['system: Data warehouse', 'resource'],
  ]
  cases.forEach(([line, type]) => {
    it(`"${line}" -> ${type}`, () => assert.eq(categorizeLine(line).type, type))
  })

  // A cue that fires on one word must not make a confident call on its own:
  // createBlocksFromText and the importers only ask a person to check a
  // low-confidence type, so a confident wrong one is never questioned.
  const NOT_CONFIDENT = [
    // line, what the classifier may call it (low confidence only)
    ['Customers will pay for this', 'assumption'],       // the registry's own assumption example
    ['Report to leadership monthly', 'output'],
    ['Customer churn above 5%', 'metric'],
    ['Customer churn is too high', null],
    ['Customer data is stored unencrypted', null],
    ['Owners are unclear', null],
    ['Stakeholder buy-in is missing', null],
    ['Onboard new customers faster', null],
    ['Build trust with customers', null],
    ['Every week we lose two customers', null],
    ['Every end of sprint report', 'output'],
  ]
  NOT_CONFIDENT.forEach(([line, type]) => {
    it(`"${line}" is a guess${type ? ` (${type})` : ''}, not a confident call`, () => {
      const r = categorizeLine(line)
      assert.eq(r.confidence, 'low', `${line} -> ${r.type}/${r.confidence}`)
      if (type) assert.eq(r.type, type)
    })
  })

  it('reads a red build as a problem, not as work to do', () => {
    ;['Build fails on main', 'Build is red', 'Tests are flaky', 'Deploy failed'].forEach(line => {
      const r = categorizeLine(line)
      assert.eq(r.type, 'problem', line)
      assert.eq(r.confidence, 'high', line)
    })
    assert.eq(categorizeLine('Build a trust score for sellers').type, 'implementation', 'only "build trust" itself is excluded')
  })

  it('is confident about a title that is only the audience or only the cadence', () => {
    ;['Customers', 'Executives', 'Leadership team', 'Team leads'].forEach(line => {
      assert.deepEq([categorizeLine(line).type, categorizeLine(line).confidence], ['stakeholder', 'high'], line)
    })
    ;['Every month', 'Each sprint', 'Every End of Sprint', "On Quarter's end", 'At the end of the quarter'].forEach(line => {
      assert.deepEq([categorizeLine(line).type, categorizeLine(line).confidence], ['terminator', 'high'], line)
    })
  })

  it('keeps the lines the older cues already placed', () => {
    assert.eq(categorizeLine('Increase conversion by 15%').type, 'goal', 'a goal with a number stays a goal')
    assert.eq(categorizeLine('The API latency exceeds our SLA').type, 'problem', 'an SLA breach stays a problem')
    assert.eq(categorizeLine('Set the status to Ready').type, 'process', '"set" alone is still a step')
    assert.eq(categorizeLine('Update status to Ready for Review').type, 'process')
    assert.eq(categorizeLine('Customers cannot check out').type, 'problem', 'a pain beats the audience it hurts')
    assert.eq(categorizeLine('Will users accept SSO-only?').type, 'question')
  })
})

describe('createBlocksFromText() -- type check', () => {
  it('marks only the low-confidence guesses for a person to check, in one undo step', () => {
    reset()
    const ids = createBlocksFromText('goal: Ship the scheduler\nAcme Model Reporting\nKey Results', false)
    assert.eq(ids.length, 3)
    const [a, b, c] = ids.map(id => state.blocks[id])
    assert.eq(a.type, 'goal')
    assert.ok(!a.typeCheck, 'a prefixed line is certain')
    assert.eq(b.type, 'custom')
    assert.eq(b.typeCheck, true, 'a guess waits to be confirmed')
    assert.eq(c.type, 'metric')
    assert.ok(!c.typeCheck)
    document.querySelectorAll('.type-chip, .type-chip-menu').forEach(el => el.remove())
    ids.forEach(id => document.getElementById('b-' + id)?.remove())
    reset()
  })
})

// ── Templates ────────────────────────────────────────────────

// Block gaps each built-in template produced before this stream, captured
// from the foundation commit. Adding types and cues must not change them.
const TEMPLATE_GAPS = {
  'Validate an Idea': ['Validate the core idea|gap-no-req'],
  'Sprint Planning': ['Biggest delivery risk|gap-no-mitigation', 'Must have|gap-no-criteria', 'Should have|gap-no-criteria'],
  'Problem Analysis': [],
  'Feature Launch': ['Launch risk|gap-no-mitigation', 'Launch-blocking requirement|gap-no-criteria'],
  'Risk Review': ['Resulting requirement|gap-no-criteria'],
  'Investigate a Bug': ['A test that fails before the fix|gap-no-criteria'],
  'Inherit a Codebase': ['A rollback you have actually tried|gap-no-criteria', 'Be able to make a safe change|gap-no-req'],
  'Migrate a System': ['Cutover under load|gap-no-mitigation', 'No data loss|gap-no-criteria', 'Per-tenant, not big bang|gap-no-basis',
    'Reversible at every step|gap-no-criteria', 'Silent divergence between the two|gap-no-mitigation'],
}

function templateGaps(tpl) {
  reset()
  applyTemplate(tpl)
  Object.keys(state.blocks).forEach(id => { mockBlockEl(id); mockGapIconEl(id) })
  const r = runGapDetection()
  const gaps = r.details.map(d => `${d.title}|${d.gaps[0]}`).sort()
  const findings = r.canvasFindings || []
  reset()
  return { gaps, findings }
}

describe('templates -- gap sets', () => {
  Object.entries(TEMPLATE_GAPS).forEach(([name, expected]) => {
    it(`"${name}" keeps its gap set`, () => {
      const tpl = TEMPLATES.find(t => t.name === name)
      assert.ok(tpl, `${name} still ships`)
      assert.deepEq(templateGaps(tpl).gaps, [...expected].sort())
    })
  })

  it('"Investigate a Bug" no longer closes a false cycle', () => {
    // "requires" alone infers depends-on, which ordered the test before the
    // root cause; the arrow now names its relation.
    const { findings } = templateGaps(TEMPLATES.find(t => t.name === 'Investigate a Bug'))
    assert.ok(!findings.some(f => /cycle/.test(f)), findings.join('; '))
  })

  it('no built-in template closes a cycle', () => {
    TEMPLATES.forEach(tpl => {
      const { findings } = templateGaps(tpl)
      assert.ok(!findings.some(f => /cycle/.test(f)), `${tpl.name}: ${findings.join('; ')}`)
    })
  })

  it('every template uses registry types only, and arrows name real blocks and relations', () => {
    const relations = ['precedes', 'depends-on', 'blocks', 'informs', 'related']
    TEMPLATES.forEach(tpl => {
      tpl.blocks.forEach(b => assert.ok(Object.hasOwn(TYPES, b.type), `${tpl.name}: ${b.type}`))
      tpl.arrows.forEach(([f, t, , rel]) => {
        assert.ok(tpl.blocks[f] && tpl.blocks[t] && f !== t, `${tpl.name}: arrow ${f} -> ${t}`)
        if (rel != null) assert.ok(relations.includes(rel), `${tpl.name}: relation ${rel}`)
      })
      assert.notIncludes(JSON.stringify(tpl), EM_DASH, `${tpl.name} has no em dash`)
    })
  })
})

describe('templates -- Recurring Reporting Flow', () => {
  const tpl = () => TEMPLATES.find(t => t.name === 'Recurring Reporting Flow')

  it('ships as a large plan template with its own situation', () => {
    const t = tpl()
    assert.ok(t, 'the template exists')
    assert.eq(t.large, true)
    assert.eq(t.mode, 'plan')
    assert.eq(t.situation.codebase, 'none')
    assert.ok(t.icon && t.desc)
  })

  it('types its blocks across every step, with nothing left as Other', () => {
    const types = new Set(tpl().blocks.map(b => b.type))
    ;['goal', 'stakeholder', 'metric', 'requirement', 'output', 'implementation', 'process',
      'terminator', 'resource', 'risk', 'question'].forEach(t => assert.ok(types.has(t), `uses ${t}`))
    assert.ok(!types.has('custom'), 'no untyped block')
    const steps = new Set([...types].map(t => TYPES[t].step))
    TYPE_STEPS.filter(s => s.id !== 'other').forEach(s => assert.ok(steps.has(s.id), `answers ${s.label}`))
  })

  it('is generic: no organisation names from the canvas it was drawn from', () => {
    // The source canvas's own names are deliberately not spelled out here,
    // since this file is public. They were a team acronym and product
    // names, so the check is for any all-caps acronym beyond a few generic
    // ones, and for the tracker products a reader would recognise.
    const text = tpl().blocks.map(b => `${b.title} ${b.description || ''} ${(b.criteria || []).join(' ')}`).join(' ')
      + ' ' + tpl().name + ' ' + tpl().desc
    const generic = new Set(['KPI', 'SLA', 'OKR', 'AI', 'ID', 'PM'])
    const acronyms = (text.match(/\b[A-Z]{2,}\b/g) || []).filter(w => !generic.has(w))
    assert.deepEq(acronyms, [], 'no team or company acronym')
    ;['Jira', 'Confluence'].forEach(name => assert.notIncludes(text, name))
  })

  it('carries its measure and its done-list', () => {
    const t = tpl()
    t.blocks.filter(b => b.type === 'metric').forEach(b => assert.ok(b.criteria?.length, `${b.title} has a target`))
    t.blocks.filter(b => b.type === 'requirement').forEach(b => assert.ok(b.criteria?.length, `${b.title} has criteria`))
  })

  it('no title contains another, and only the question block asks a question', () => {
    const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    const titles = tpl().blocks.map(b => norm(b.title))
    titles.forEach((a, i) => titles.forEach((b, j) => {
      if (i !== j) assert.ok(!b.includes(a), `"${a}" is inside "${b}"`)
    }))
    tpl().blocks.filter(b => b.type !== 'question').forEach(b =>
      assert.ok(!/\?|\b(tbd|verify|check)\b/i.test(b.description), `${b.title} hides a question in its description`))
  })

  it('applies with no gap but the one it is built to show, and no canvas finding', () => {
    // An unread weekly report is the point of the question beside it; with
    // or without a rule that names it, nothing else on the map may fire.
    const allowed = ['Weekly status report|gap-no-consumer']
    const { gaps, findings } = templateGaps(tpl())
    gaps.forEach(g => assert.ok(allowed.includes(g), `unexpected gap ${g}`))
    assert.deepEq(findings, [])
  })

  it('prints implied verbs for its unlabelled arrows', () => {
    reset()
    applyTemplate(tpl())
    Object.keys(state.blocks).forEach(id => { mockBlockEl(id); mockGapIconEl(id) })
    const p = generatePrompt()
    ;['satisfies', 'should move', 'measures', 'owns', 'triggers', 'delivered to']
      .forEach(v => assert.match(p, new RegExp(`\\[implied: ${v}(; context only)?\\]`), `implies ${v}`))
    const lines = sectionOf(p, '## Connections').split('\n')
    lines.forEach(l => assert.ok(!(/\[(informs|related)\]/.test(l) && l.includes('[implied:')), `one reading per line: ${l}`))
    reset()
  })
})

// ── Legacy canvases ──────────────────────────────────────────

describe('legacy canvases -- old labels and shapes still load', () => {
  // A canvas as an older build (or a person, or an assistant) wrote it:
  // labels in `type`, including one this build retired, string questions,
  // a dashed style, no criteria field, and a type from a newer build.
  const LEGACY = {
    blocks: [
      { id: 'a', type: 'Start / End', title: 'Report received', x: 0, y: 0 },
      { id: 'b', type: 'Process', title: 'Triage', x: 300, y: 0, questions: ['Who is on call?'] },
      { id: 'c', type: 'Open Question', title: 'Is this still read?', x: 600, y: 0 },
      { id: 'd', type: 'Resource / System', title: 'Tracker', x: 0, y: 200 },
      { id: 'e', type: 'custom', title: 'Parking lot', x: 300, y: 200 },
      { id: 'f', type: 'open-question', title: 'Budget approved?', x: 600, y: 200 },
      { id: 'g', type: 'hypothesis', title: 'From a newer build', x: 0, y: 400 },
      { id: 'h', type: 'Other', title: 'Misc', x: 300, y: 400 },
    ],
    arrows: [
      { from: 'a', to: 'b', style: 'dashed' },
      { from: 'b', to: 'c', label: 'requires' },
    ],
  }

  it('resolveTypeId reads ids, labels in any case, and retired labels', () => {
    assert.eq(resolveTypeId('goal'), 'goal')
    assert.eq(resolveTypeId('Goal'), 'goal')
    assert.eq(resolveTypeId('IMPLEMENTATION'), 'implementation')
    assert.eq(resolveTypeId('Trigger / End'), 'terminator')
    assert.eq(resolveTypeId('trigger/end'), 'terminator')
    assert.eq(resolveTypeId('Start / End'), 'terminator', 'the retired label')
    assert.eq(resolveTypeId('Open Question'), 'question')
    assert.eq(resolveTypeId('open_question'), 'question')
    assert.eq(resolveTypeId('Resource / System'), 'resource')
    assert.eq(resolveTypeId('Other'), 'custom')
    assert.eq(resolveTypeId('Custom / Other'), 'custom')
    ;['hypothesis', 'constructor', '__proto__', 'toString', '', ' '].forEach(v => assert.eq(resolveTypeId(v), '', v))
    ;[null, undefined, 3, {}].forEach(v => assert.eq(resolveTypeId(v), ''))
  })

  it('loads every block and arrow, with labels read as types', () => {
    const r = normalizeCanvas(JSON.parse(JSON.stringify(LEGACY)))
    assert.eq(Object.keys(r.blocks).length, LEGACY.blocks.length)
    assert.eq(r.dropped.blocks, 0)
    assert.eq(r.arrows.length, 2)
    const t = id => r.blocks[id].type
    assert.eq(t('a'), 'terminator')
    assert.eq(t('b'), 'process')
    assert.eq(t('c'), 'question')
    assert.eq(t('d'), 'resource')
    assert.eq(t('e'), 'custom')
    assert.eq(t('f'), 'question')
    assert.eq(t('h'), 'custom')
    ;['a', 'b', 'c', 'd', 'e', 'f', 'h'].forEach(id => assert.ok(!('typeHint' in r.blocks[id]), `${id} needs no hint`))
    assert.eq(t('g'), 'custom')
    assert.eq(r.blocks.g.typeHint, 'hypothesis', 'an unknown type is kept, not guessed')
    assert.deepEq(r.blocks.b.questions, [{ text: 'Who is on call?' }])
    const dashed = r.arrows.find(a => a.from === 'a')
    assert.eq(dashed.style, 'curved')
    assert.eq(dashed.pattern, 'dashed')
  })

  it('restores a type a stale build parked, whether the hint is an id or a label', () => {
    assert.eq(normalizeBlock({ id: 'x', type: 'custom', typeHint: 'metric' }).type, 'metric')
    assert.eq(normalizeBlock({ id: 'x', type: 'custom', typeHint: 'Trigger / End' }).type, 'terminator')
    const kept = normalizeBlock({ id: 'x', type: 'custom', typeHint: 'hypothesis' })
    assert.eq(kept.type, 'custom')
    assert.eq(kept.typeHint, 'hypothesis')
    // A hint that only names Other is no reason to keep one.
    assert.eq(normalizeBlock({ id: 'x', type: 'custom', typeHint: 'Other' }).typeHint, 'Other')
  })

  it('exports a legacy canvas with the current labels', () => {
    reset()
    const r = normalizeCanvas(JSON.parse(JSON.stringify(LEGACY)))
    Object.values(r.blocks).forEach(b => add(b.id, b.type, b.title, { questions: b.questions, x: b.x, y: b.y }))
    state.arrows = r.arrows
    const md = buildMarkdown()
    assert.includes(md, `## ${TYPES.terminator.section}\n`)
    assert.includes(md, `## ${TYPES.resource.section}\n`)
    assert.notIncludes(md, 'Start / End')
    const p = generatePrompt()
    assert.includes(p, `**${TYPES.terminator.label}**`)
    assert.includes(p, 'Report received')
    reset()
  })
})

// ── Accepted gaps ────────────────────────────────────────────

describe('prompt -- accepted gaps', () => {
  it('lists an accepted gap on its own, and not among the open ones', () => {
    reset()
    add('g', 'goal', 'Ship', {})
    add('r', 'requirement', 'Fast checkout', { gapAck: ['gap-no-criteria'] })
    add('s', 'requirement', 'Audit log')
    link('g', 'r'); link('g', 's')
    const p = generatePrompt()
    const open = sectionOf(p, '## Planning Gaps Detected')
    assert.includes(open, '"Audit log"')
    assert.notIncludes(open, '"Fast checkout"')
    const accepted = sectionOf(p, '## Accepted gaps')
    assert.includes(accepted, '• Requirement: "Fast checkout": no acceptance criteria')
    reset()
  })

  it('names a rule this build does not know by its id', () => {
    const lines = acceptedGapLines({ x: { id: 'x', type: 'metric', title: 'Lead time', gapAck: ['gap-from-later'] } })
    assert.deepEq(lines, ['• Metric: "Lead time": gap-from-later'])
  })

  it('drops an acceptance once its gap is fixed, so the prompt does not contradict the canvas', () => {
    reset()
    add('g', 'goal', 'Ship')
    add('r', 'requirement', 'Fast', { gapAck: ['gap-no-criteria'], criteria: ['under 2s'] })
    link('g', 'r')
    const p = generatePrompt()
    assert.includes(p, '- under 2s')
    assert.notIncludes(p, '## Accepted gaps', 'criteria exist, so "done is undefined" no longer applies')
    reset()
  })

  it('reads which gaps still fire from either shape of detection result', () => {
    // This build reports an accepted gap among the rest; a detector that
    // suppresses it reports it apart, under `accepted`. Both mean "fires".
    const blocks = {
      r: { id: 'r', type: 'requirement', title: 'Fast', gapAck: ['gap-no-criteria'] },
      m: { id: 'm', type: 'metric', title: 'Lead time', gapAck: ['gap-from-later'] },
    }
    const inline = firingGaps({ details: [{ id: 'r', gaps: ['gap-no-criteria'] }] })
    const apart = firingGaps({ details: [], accepted: [{ id: 'r', gap: 'gap-no-criteria' }] })
    const fixed = firingGaps({ details: [] })
    const lineFor = 'Requirement: "Fast"'
    assert.ok(acceptedGapLines(blocks, inline).some(l => l.includes(lineFor)))
    assert.ok(acceptedGapLines(blocks, apart).some(l => l.includes(lineFor)))
    assert.ok(!acceptedGapLines(blocks, fixed).some(l => l.includes(lineFor)), 'a fixed gap is dropped')
    assert.deepEq(acceptedGapLines(blocks, fixed), ['• Metric: "Lead time": gap-from-later'], 'an unknown rule cannot be re-checked, so it stays')
  })

  it('prints no section when nothing is accepted', () => {
    reset()
    add('g', 'goal', 'Ship')
    assert.notIncludes(generatePrompt(), '## Accepted gaps')
    reset()
  })
})

// ── Mermaid in the Markdown export ───────────────────────────

describe('mermaidBlock() -- types survive, isolated blocks too', () => {
  it('declares every block, shapes decisions and triggers, and classes each by type', () => {
    reset()
    add('d', 'decision', 'Pick [the] {store}')
    add('t', 'terminator', 'Every end of sprint')
    add('p', 'process', 'Assemble "status notes" | now')
    add('lone', 'metric', 'Lead time')
    link('t', 'p'); link('p', 'd', { label: 'feeds' })
    const m = mermaidBlock()
    assert.includes(m, 'n1{"Pick (the) (store)"}')
    assert.includes(m, 'n2(["Every end of sprint"])')
    assert.includes(m, 'n3["Assemble status notes now"]')
    assert.includes(m, 'n4["Lead time"]', 'an isolated block is declared')
    assert.includes(m, 'n2 --> n3')
    assert.includes(m, 'n3 -->|feeds| n1')
    assert.includes(m, `classDef metric stroke:${TYPES.metric.color}`)
    assert.includes(m, 'class n4 metric')
    reset()
  })

  it('round-trips through the app’s own Mermaid importer without losing a block', () => {
    reset()
    add('d', 'decision', 'Use the queue')
    add('t', 'terminator', 'Quarter end')
    add('lone', 'goal', 'Leaders see health')
    link('t', 'd')
    const { payload } = parseMermaid(mermaidBlock())
    assert.eq(payload.blocks.length, 3, 'isolated block included')
    const byTitle = Object.fromEntries(payload.blocks.map(b => [b.title, b.type]))
    assert.eq(byTitle['Use the queue'], 'decision')
    assert.eq(byTitle['Quarter end'], 'terminator')
    assert.eq(payload.arrows.length, 1)
    reset()
  })

  it('gives every other type a usable shape, the importer\'s own when it publishes one', () => {
    // Decision and trigger are the only shapes this file owns. The rest are
    // the sharing code's call once interop.js exports mermaidShapeFor, and a
    // plain rectangle until then; either way each is a non-empty pair.
    reset()
    assert.deepEq(mermaidShape('decision'), ['{', '}'])
    assert.deepEq(mermaidShape('terminator'), ['([', '])'])
    IDS.filter(t => t !== 'decision' && t !== 'terminator').forEach(t => {
      const pair = mermaidShape(t)
      assert.ok(Array.isArray(pair) && pair.length === 2 && pair.every(x => typeof x === 'string' && x), `${t}: ${pair}`)
      const expected = typeof interop.mermaidShapeFor === 'function' ? interop.mermaidShapeFor(t) : ['[', ']']
      assert.deepEq(pair, Array.isArray(expected) ? expected : [expected.open, expected.close], t)
    })
    assert.eq(mermaidBlock(), '')
  })

  it('keeps backticks out of a label, so a title cannot close the Markdown fence', () => {
    reset()
    add('d', 'decision', 'Ship ```now```')
    add('p', 'process', 'Run `make` twice')
    link('p', 'd', { label: 'then ```x```' })
    const m = mermaidBlock()
    const body = m.slice('```mermaid\n'.length, m.lastIndexOf('```'))
    assert.notIncludes(body, '`', 'no backtick inside the fenced graph')
    assert.includes(m, "Ship '''now'''")
    assert.eq(m.split('```').length, 3, 'exactly one opening and one closing fence')
    reset()
  })
})

// ── Votes ────────────────────────────────────────────────────

describe('clearAllVotes() -- a leading votes segment', () => {
  it('removes the votes segment wherever it sits, and keeps the rest', () => {
    const before = location.pathname + location.search + location.hash
    try {
      history.replaceState(null, '', location.pathname + location.search + '#votes=' + encodeURIComponent('{"a":[{"userId":"u","dots":1}]}'))
      assert.ok(Object.keys(getAllVotes()).length === 1, 'the leading segment is read')
      clearAllVotes()
      assert.eq(location.hash, '')
      assert.deepEq(getAllVotes(), {})
      history.replaceState(null, '', location.pathname + location.search + '#votes=' + encodeURIComponent('{"a":[]}') + '&s=abc')
      clearAllVotes()
      assert.eq(location.hash, '#s=abc')
    } finally {
      history.replaceState(null, '', before)
    }
  })
})

// ── Hooks for other features ─────────────────────────────────

describe('exportJSON() -- tells the page a full copy left the browser', () => {
  it('fires pf:exported with kind json after the download', () => {
    reset()
    add('g', 'goal', 'Ship')
    const origCreate = URL.createObjectURL, origClick = HTMLAnchorElement.prototype.click
    URL.createObjectURL = () => 'blob:captured'
    HTMLAnchorElement.prototype.click = function () {}
    const seen = []
    const on = e => seen.push(e.detail)
    window.addEventListener('pf:exported', on)
    try { exportJSON() } finally {
      window.removeEventListener('pf:exported', on)
      URL.createObjectURL = origCreate
      HTMLAnchorElement.prototype.click = origClick
    }
    assert.deepEq(seen, [{ kind: 'json' }])
    reset()
  })
})
