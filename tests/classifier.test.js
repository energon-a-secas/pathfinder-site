// ============================================================
//  classifier.test.js -- categorizeLine's cues for the lines a
//  reporting canvas is made of: a reporting line is a guess at a
//  Stakeholder, a work verb a guess at an Implementation, a period
//  end is a cadence (Trigger / End) only when it says when, and a
//  bare one names the report. Plus the confidence rule every cue
//  keeps (a call a person could read another way is low, so the card
//  asks for a check) and a labelled corpus that pins what the older
//  cues already placed.
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, selection, getUndoHistory } from '../js/state.js'
import { categorizeLine, createBlocksFromText } from '../js/classify.js'
import { parseMermaid } from '../js/interop.js'

function reset() {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  selection.ids.clear(); selection.blockId = null; selection.arrowId = null
  ui.readOnly = false
}

const call = line => { const r = categorizeLine(line); return `${r.type}/${r.confidence}` }

function table(name, rows) {
  describe(name, () => {
    rows.forEach(([line, expected, why]) => {
      it(`"${line}" -> ${expected}${why ? ` (${why})` : ''}`, () => assert.eq(call(line), expected, line))
    })
  })
}

// ── Reporting lines ──────────────────────────────────────────

table('categorizeLine() -- a reporting line is a guess at its audience', [
  ['Portfolio Reporting', 'stakeholder/low', 'named for whom it reports to'],
  ['Board Reporting', 'stakeholder/low'],
  ['Investor Reporting', 'stakeholder/low'],
  ['ACME Model Reporting', 'stakeholder/low', 'an acronym in front reads as a name; up to three words'],
  ['Executive Reporting', 'stakeholder/low', 'an audience word and a reporting line never add up to a confident call'],
  ['Leadership Reporting', 'stakeholder/low'],
  ['Customer Reporting', 'stakeholder/low'],
  ['Financial Reporting', 'output/low', 'a subject in front: the report itself'],
  ['Status Reporting', 'output/low'],
  ['Weekly reporting', 'output/low', 'a cadence in front: the report itself'],
  ['Monthly digest', 'output/low'],
  ['Weekly updates', 'output/low'],
  ['Manual reporting', 'custom/low', 'a manner is not a who'],
  ['Automate reporting', 'implementation/high', 'a stronger cue still wins'],
  ['Improve reporting', 'goal/high'],
  ['Reporting is slow', 'problem/high'],
])

// ── Work verbs ───────────────────────────────────────────────

table('categorizeLine() -- a work verb is a guess at an Implementation', [
  ['Schedule status notes', 'implementation/low', 'once to build, or a step on every run'],
  ['Schedule the weekly report', 'implementation/low', 'the verb outranks the report noun'],
  ['Consolidate the three trackers', 'implementation/low'],
  ['Replace the legacy importer', 'implementation/low'],
  ['Refactor the export module', 'implementation/low'],
  ['Upgrade the database to the new major version', 'implementation/low', 'outranks the resource noun'],
  ['Connect the tracker to the data hub', 'implementation/low'],
  ['Retire the old portal', 'implementation/low'],
  ['Wire the scheduler', 'implementation/low'],
  ['Roll out SSO to every team', 'implementation/low'],
  ['Prototype the checkout flow', 'implementation/low'],
  ['Schedule the integration', 'implementation/high', 'a verb and an integration together are confident'],
  ['Implement the retry queue', 'implementation/high', 'the older cues keep their confidence'],
  ['Schedule risk', 'risk/high', 'a risk word is stronger'],
])

describe('categorizeLine() -- a work word that is the subject is not work', () => {
  ;['Schedule slipped again', 'Schedule is tight', 'Upgrade path is unclear', 'Install base is shrinking',
    'Rework is eating the sprint', 'Connect with customers monthly'].forEach(line => {
    it(`"${line}" is not an Implementation`, () => {
      assert.neq(categorizeLine(line).type, 'implementation', line)
      assert.eq(categorizeLine(line).confidence, 'low', line)
    })
  })
})

// ── Cadences and period ends ─────────────────────────────────

table('categorizeLine() -- a cadence says when; a bare period end names the report', [
  ['Every End of Sprint', 'terminator/high', '"every"'],
  ["On Quarter's end", 'terminator/high', '"on"'],
  ['At month end', 'terminator/high', '"at"'],
  ['Every sprint end', 'terminator/high'],
  ["Every quarter's end", 'terminator/high'],
  ['At the end of the quarter', 'terminator/high'],
  ['The end of the quarter', 'terminator/high', 'the article prose puts in front of a moment'],
  ['Each sprint', 'terminator/high'],
  ['End of Sprint', 'output/low', 'the sprint-end report, or the moment: a guess'],
  ['Month end', 'output/low'],
  ['Sprint-end', 'output/low'],
  ["Quarter's end", 'output/low'],
  ['End of day report', 'output/low', 'was a confident Trigger / End'],
  ['Every end of sprint report', 'output/low', 'a cadence mentioned, a report named'],
  ['End', 'terminator/high', 'a finish, not a period'],
  ['Done', 'terminator/high'],
  ['End of flow', 'terminator/high'],
  ['The end of support for v1', 'terminator/high', 'only a period end keeps its article'],
])

// ── Confidence stays honest ──────────────────────────────────

describe('categorizeLine() -- a new cue alone is never a confident call', () => {
  // Each of these lines carries exactly one of the new cues and nothing else,
  // so each must come back low: the card then asks a person to check it.
  const ALONE = ['Portfolio Reporting', 'Board Reporting', 'Executive Reporting', 'Financial Reporting', 'Weekly reporting',
    'Schedule status notes', 'Consolidate the three trackers', 'Replace the legacy importer', 'Refactor', 'Configure SSO',
    'End of Sprint', 'Month end', 'Sprint end', "Quarter's end", 'By quarter end', 'Quarter-end close',
    'End of release', 'End of the release', 'Release-end', 'End-of-sprint', 'Release reporting', 'Release updates']
  ALONE.forEach(line => {
    it(`"${line}" is low confidence`, () => assert.eq(categorizeLine(line).confidence, 'low', call(line)))
  })

  it('the title comes back untouched when no prefix was stripped', () => {
    ;['Portfolio Reporting', 'Schedule status notes', 'End of Sprint', "On Quarter's end", 'The end of the quarter'].forEach(line =>
      assert.eq(categorizeLine(line).title, line))
  })
})

describe('createBlocksFromText() -- the new guesses ask for a check', () => {
  // Since the design round (BRAINDUMP) only a prefix, a heading or a
  // trailing "?" is certain in a dump: a confident guess is flagged too.
  it('types each reporting line and marks every guess, confident or not, in one undo step', () => {
    reset()
    const before = getUndoHistory().length
    const ids = createBlocksFromText('Schedule status notes\nEnd of Sprint\nPortfolio Reporting\nEvery End of Sprint', false)
    assert.eq(getUndoHistory().length, before + 1, 'one undo step for the whole paste')
    const got = ids.map(id => [state.blocks[id].type, !!state.blocks[id].typeCheck])
    assert.deepEq(got, [['implementation', true], ['output', true], ['stakeholder', true], ['terminator', true]])
    assert.eq(categorizeLine('Every End of Sprint').confidence, 'high', 'the classifier is still sure of the cadence')
    ids.forEach(id => document.getElementById('b-' + id)?.remove())
    reset()
  })
})

// ── Review round: guesses that must not stack or steal ───────
//
// Each table below pins one defect found in review, by the lines that showed
// it. Before the fix every line here came back as the type in its comment.

table('categorizeLine() -- a work verb never outranks a risk or problem cue', [
  // were implementation/high: the verb (2.5) stacked with the noun (2)
  ['Upgrade breaks the integration', 'risk/high', 'the upgrade is the subject'],
  ['Upgrade could break the integration', 'risk/high'],
  ['Schedule migration risk', 'risk/high', 'verb and noun reach 3 and tie; the risk wins'],
  ['Replace the integration: risk of data loss', 'risk/high'],
  ['Refactor the integration, risk of regressions', 'risk/high'],
  ['Consolidate migration concerns', 'risk/high'],
  ['Replace the integration', 'implementation/high', 'with an object in view and nothing stronger the stack still reaches 3'],
])

describe('categorizeLine() -- a failure verb makes the work word the subject', () => {
  // were implementation/low
  ;['Upgrade failed on staging', 'Install failed for three customers', 'Upgrade will fix the crash', 'Upgrade might slip the release'].forEach(line => {
    it(`"${line}" is not an Implementation`, () => assert.neq(categorizeLine(line).type, 'implementation', call(line)))
  })
})

table('categorizeLine() -- a work word in front of a measure names the measure', [
  // were implementation/low
  ['Rework rate above 20%', 'metric/low'],
  ['Rework rate', 'metric/low'],
  ['Schedule variance under 5%', 'metric/low'],
  ['Upgrade adoption rate', 'metric/low'],
  ['Install rate above 60%', 'metric/low'],
  ['Rework percentage', 'metric/low'],
  ['Schedule adherence target', 'metric/low'],
  ['Schedule target: 90% on-time', 'metric/low'],
  ['Wire the rate limiter', 'implementation/low', 'an article makes the measure word an object'],
  ['Upgrade the rate limiter', 'implementation/low'],
])

describe('categorizeLine() -- a subject, period, scope or manner in front of "reporting" is not a who', () => {
  // were stakeholder/low
  ;['Regulatory reporting', 'ESG reporting', 'Tax reporting', 'Error reporting', 'Crash reporting', 'Expense reporting',
    'Time reporting', 'Project reporting', 'Sprint reporting', 'Q3 reporting', 'Year-end reporting', 'Month-end reporting',
    'End of quarter reporting', 'Self-service reporting', 'Consolidated reporting', 'Centralized reporting',
    'Internal reporting', 'External reporting', 'Operational reporting', 'Custom reporting', 'Dashboard reporting',
    'Epic reporting', 'Data Quality Reporting', 'Month End Reporting', 'End Of Quarter Reporting', 'Self Service Reporting',
    'Real Time Reporting', 'Vendor reporting'].forEach(line => {
    it(`"${line}" is not a Stakeholder`, () => {
      assert.neq(categorizeLine(line).type, 'stakeholder', call(line))
      assert.eq(categorizeLine(line).confidence, 'low', line)
    })
  })
})

table('categorizeLine() -- a reporting line is a Stakeholder only when it names whom it reports to', [
  ['Board reporting', 'stakeholder/low'],
  ['Management reporting', 'stakeholder/low'],
  ['Partner reporting', 'stakeholder/low'],
  ['Regulator reporting', 'stakeholder/low', 'a regulator is a who; regulatory is a subject'],
  ['Client reporting', 'stakeholder/low'],
  ['Weekly Board Reporting', 'stakeholder/low'],
  ['Retail Division Reporting', 'stakeholder/low', 'two capitalised words read as a name'],
  ['Retail division reporting', 'custom/low', 'in sentence case they do not'],
  // A period in front is the report itself, like a cadence.
  ['Sprint reporting', 'output/low'],
  ['Q3 reporting', 'output/low'],
  ['Year-end reporting', 'output/low'],
  ['Month-end reporting', 'output/low'],
  ['End of quarter reporting', 'output/low', 'was a confident Trigger / End'],
])

table('categorizeLine() -- a release period end does not stack with the release noun', [
  // were output/high
  ['End of release', 'output/low'],
  ['End of the release', 'output/low'],
  ['Release-end', 'output/low'],
  ['Every release', 'terminator/high', 'with "every" it is still a cadence'],
])

table('categorizeLine() -- a hyphenated period end reads like the spaced one', [
  // were terminator/high
  ['End-of-day report', 'output/low'],
  ['End-of-sprint report', 'output/low'],
  ['End-of-sprint', 'output/low'],
  ['End-of-Sprint', 'output/low'],
  ['Every end-of-sprint', 'terminator/high'],
  ['At end-of-quarter', 'terminator/high'],
  ['The end-of-quarter', 'terminator/high'],
])

describe('createBlocksFromText() -- the review lines, typed and flagged as a person would see them', () => {
  it('a risk stays a risk (a confident one), and in a dump every guess asks for a check', () => {
    reset()
    const ids = createBlocksFromText([
      'Upgrade breaks the integration', 'Schedule migration risk', 'End of release', 'Rework rate above 20%',
      'Year-end reporting', 'Tax reporting', 'End-of-day report', 'Board reporting',
    ].join('\n'), false)
    const got = ids.map(id => `${state.blocks[id].type}${state.blocks[id].typeCheck ? '?' : ''}`)
    assert.deepEq(got, ['risk?', 'risk?', 'output?', 'metric?', 'output?', 'custom?', 'output?', 'stakeholder?'])
    ;['Upgrade breaks the integration', 'Schedule migration risk'].forEach(line =>
      assert.eq(call(line), 'risk/high', 'still a confident call for the importers'))
    ids.forEach(id => document.getElementById('b-' + id)?.remove())
    reset()
  })
})

// ── Review round 2: a noun is not work, Title Case is not a name ──
//
// Each table pins one defect from the second review, by the lines that
// showed it; the comment above each says what they came out as before.

table('categorizeLine() -- a work word used as a noun never stacks into a confident Implementation', [
  // were implementation/high: the work word (2.5) plus the integration or
  // migration noun (2) reached the cap of 3 with no object in view
  ['Install failures after the migration', 'implementation/low'],
  ['Upgrade delays the migration', 'implementation/low'],
  ['Upgrade blocked by the integration', 'implementation/low'],
  ['Schedule delay on the integration', 'implementation/low'],
  ['Schedule impact of the migration', 'implementation/low'],
  ['Rework caused by the migration', 'implementation/low'],
  ['Rework from the integration', 'implementation/low'],
  ['Upgrade guide for the migration', 'implementation/low'],
  ['Upgrade plan for the integration', 'implementation/low'],
  ['Schedule for the migration', 'implementation/low'],
  ['Rework budget for the migration', 'implementation/low', 'a noun no list knows still stays a guess'],
  ['Wire fees for the integration', 'implementation/low'],
  ['Schedule integration work', 'implementation/low', 'no article, no object in view'],
  ['Prototype results from the integration', 'output/low', 'the results are the output, as before the stream'],
  // an article after the work word makes what follows its object
  ['Schedule the integration', 'implementation/high'],
  ['Upgrade the integration', 'implementation/high'],
  ['Consolidate the integrations', 'implementation/high'],
  ['Hook up the integration', 'implementation/high'],
])

table('categorizeLine() -- a work word in a noun compound is not work', [
  // were implementation/low: the verb guess fired on the noun
  ['Upgrade path', 'custom/low'], ['Upgrade guide', 'custom/low'], ['Upgrade notes', 'custom/low'], ['Upgrade cost', 'custom/low'],
  ['Install guide', 'custom/low'], ['Install base', 'custom/low'], ['Schedule delay', 'custom/low'], ['Schedule overrun', 'custom/low'],
  ['Schedule pressure', 'custom/low'], ['Schedule of payments', 'custom/low'], ['Wire transfer fees', 'custom/low'],
  ['Rework costs us a week', 'custom/low'], ['Rebuild time', 'custom/low'], ['Rebuild vs buy', 'custom/low'],
  ['Prototype ready for review', 'custom/low'], ['Upgrade expected in Q3', 'custom/low'],
  ['Prototype results', 'output/low'], ['Prototype results look good', 'output/low'],
  // still work: a state in front of a noun, a non-article word, a verb that is not a noun
  ['Install pending updates', 'implementation/low', 'a state before a noun describes the object'],
  ['Replace stalled jobs', 'implementation/low'],
  ['Schedule the changes', 'implementation/low', 'an article is never the one word in front of a subject verb'],
  ['Rebuild base images', 'implementation/low'],
  ['Consolidate results from each team', 'implementation/low', 'consolidate is not a noun'],
])

describe('categorizeLine() -- Title Case alone does not make a reporting line a name', () => {
  // were stakeholder/low
  ;['Supply Chain Reporting', 'Cash Flow Reporting', 'Carbon Emissions Reporting', 'Help Desk Reporting', 'Web Analytics Reporting',
    'Accounts Payable Reporting', 'Inventory Level Reporting', 'Management Information Reporting', 'Employee Engagement Reporting',
    'Marketing Campaign Reporting', 'Change Management Reporting', 'Incident Management Reporting', 'Project Management Reporting',
    'Vendor Management Reporting', 'Portfolio Health Reporting', 'Board Pack Reporting', 'Operating Model Reporting',
    'Investor relations reporting'].forEach(line => {
    it(`"${line}" is not a Stakeholder`, () => {
      assert.neq(categorizeLine(line).type, 'stakeholder', call(line))
      assert.eq(categorizeLine(line).confidence, 'low', line)
    })
  })
  it('"Asset Management Reporting" goes back to the resource guess it was', () => assert.eq(call('Asset Management Reporting'), 'resource/low'))
})

table('categorizeLine() -- a reporting line still names whom it reports to', [
  ['ACME Model Reporting', 'stakeholder/low', 'an acronym leads: a name'],
  ['Retail Division Reporting', 'stakeholder/low', 'an organisational unit ends it'],
  ['Portfolio Reporting', 'stakeholder/low'],
  ['PMO reporting', 'stakeholder/low'],
  ['Management reporting', 'stakeholder/low', 'management alone'],
  ['Senior Management Reporting', 'stakeholder/low', 'management after a rank'],
  ['Weekly Management Reporting', 'stakeholder/low', 'management after a cadence'],
  ['Weekly Board Reporting', 'stakeholder/low', 'the word next to "reporting" is the audience'],
  ['Audit Committee Reporting', 'stakeholder/low'],
  ['Steering committee reporting', 'stakeholder/low'],
  ['KPI Dashboard Reporting', 'metric/high', 'an acronym that is a subject is not a name'],
  ['API Usage Reporting', 'resource/low', 'nor is one that names a system'],
])

table('categorizeLine() -- only a period a team reports on names its report', [
  // were output/low: every period end read as the report
  ['End of day', 'terminator/low', 'no report: a moment, still a guess'],
  ['End of the day', 'terminator/low'],
  ['End of week', 'terminator/low'],
  ['End of Friday', 'terminator/low'],
  ['Start of day', 'terminator/high', 'a start names no report'],
  ['Start of sprint', 'terminator/high'],
  ['End of sprint', 'output/low', 'the sprint-end report or review, as its author meant'],
  ['End of quarter', 'output/low'],
  ['Every end of day', 'terminator/high', 'a cadence either way'],
  // were terminator/low or Other: a period's ceremony is a recurring step
  ['Month-end close', 'process/low'],
  ['Year-end close', 'process/low'],
  ['Quarter end close', 'process/low'],
  ['End of quarter review', 'process/low'],
  ['End of sprint demo', 'process/low'],
  ['Sprint retro', 'process/low'],
  ['Weekly sync', 'process/low'],
])

describe('createBlocksFromText() -- a noun reading asks for a check, an object does not', () => {
  it('flags every guess from the second review; the classifier trusts only the work with an object', () => {
    reset()
    const ids = createBlocksFromText([
      'Prototype results from the integration', 'Upgrade guide for the migration', 'Install failures after the migration',
      'Replace the integration', 'Supply Chain Reporting', 'End of day', 'Month-end close',
    ].join('\n'), false)
    const got = ids.map(id => `${state.blocks[id].type}${state.blocks[id].typeCheck ? '?' : ''}`)
    assert.deepEq(got, ['output?', 'implementation?', 'implementation?', 'implementation?', 'custom?', 'terminator?', 'process?'])
    assert.eq(call('Replace the integration'), 'implementation/high', 'confident, but in a dump only a prefix is certain')
    assert.eq(call('Upgrade guide for the migration'), 'implementation/low')
    ids.forEach(id => document.getElementById('b-' + id)?.remove())
    reset()
  })
})

describe('parseMermaid() -- a low shape is not overridden by a noun read as work', () => {
  it('a parallelogram labelled with a noun phrase stays a checked Output', () => {
    // was implementation/high with no check: the classifier's confident call beat the shape
    const [a, b, c] = parseMermaid([
      'flowchart LR',
      '  A[/Prototype results from the integration/] --> B[/Upgrade guide for the migration/]',
      '  B --> C[Replace the integration]',
    ].join('\n')).payload.blocks
    assert.deepEq([a.type, !!a.typeCheck], ['output', true])
    assert.deepEq([b.type, !!b.typeCheck], ['output', true], 'a guess never outranks the shape')
    assert.deepEq([c.type, !!c.typeCheck], ['implementation', false], 'work with an object is still confident')
  })
})

// ── The labelled corpus ──────────────────────────────────────
//
// Synthetic lines written for this file, each with the type a person would
// mean. PLACED pins every line the classifier agrees on, so a new cue that
// steals one fails here by name. MISSES are the lines no cue reads yet; they
// must stay low confidence, since a confident wrong type is never questioned.

const PLACED = [
  ['Increase conversion by 15%', 'goal'], ['Reduce onboarding time to one day', 'goal'], ['Launch the partner program in Q3', 'goal'],
  ['Improve report accuracy', 'goal'], ['Grow weekly active teams', 'goal'], ['Ship v2 before the conference', 'goal'],
  ['Our aim is fewer handoffs', 'goal'],
  ['Checkout is slow on mobile', 'problem'], ['Customers cannot check out', 'problem'], ['The API latency exceeds our SLA', 'problem'],
  ['Build fails on main', 'problem'], ['Error rate doubled after the release', 'problem'], ['Known issues in checkout', 'problem'],
  ['Executives', 'stakeholder'], ['Leadership team', 'stakeholder'], ['Customers', 'stakeholder'], ['Team leads', 'stakeholder'],
  ['Program sponsors', 'stakeholder'], ['Product owners', 'stakeholder'], ['stakeholder: Finance', 'stakeholder'],
  ['Key Results', 'metric'], ['Churn rate under 3%', 'metric'], ['NPS above 40', 'metric'], ['Sprint predictability metric', 'metric'],
  ['Weekly active teams KPI', 'metric'],
  ['Must support SSO', 'requirement'], ['Reports need to export to PDF', 'requirement'], ['The system shall log every change', 'requirement'],
  ['Has to work offline', 'requirement'],
  ['Weekly Reports', 'output'], ['Multi Reports', 'output'], ['Quarterly results', 'output'], ['Release notes', 'output'],
  ['Sprint-end report', 'output'], ['Deliverables for the pilot', 'output'], ['Status notes per Epic (Deliverable)', 'output'],
  ['Build the report scheduler', 'implementation'], ['Integrate SSO with the identity provider', 'implementation'],
  ['Migrate billing to the new ledger', 'implementation'], ['Automate the weekly export', 'implementation'],
  ['Set up the staging environment', 'implementation'],
  ['Update status to Ready for Review', 'process'], ['Send the summary to leadership', 'process'], ['Generate status notes', 'process'],
  ['Review the draft', 'process'], ['Assign an owner', 'process'], ['Notify the channel', 'process'], ['Set the status to Ready', 'process'],
  ['Every month', 'terminator'], ['Start', 'terminator'], ['On every release', 'terminator'],
  ['Decided to go with the managed queue', 'decision'], ['Pick one tracker as the source of truth', 'decision'],
  ['Choose between build and buy', 'decision'], ['Opted for weekly releases', 'decision'],
  ['Data Hub', 'resource'], ['Data warehouse', 'resource'], ['Partner portal', 'resource'], ['Platform team', 'resource'],
  ['Design budget', 'resource'], ['Data Central', 'resource'],
  ['Customers will pay for this', 'assumption'], ['We assume teams update the tracker daily', 'assumption'],
  ['Leadership probably reads the summary', 'assumption'], ['Teams expect a weekly digest', 'assumption'],
  ['Open risks on the release', 'risk'], ['The integration might fail under load', 'risk'], ['Single point of failure in the importer', 'risk'],
  ['Will users accept SSO-only?', 'question'], ['Who signs off the report?', 'question'], ['Is the weekly report still used?', 'question'],
  ['Currently every team uses its own tracker', 'context'], ['Background: the org moved to quarterly planning', 'context'],
  ['FYI the audit is in March', 'context'],
  ['Prototype results from the integration', 'output'], ['Month-end close', 'process'], ['Sprint retro', 'process'],
  ['End of day', 'terminator'], ['Start of day', 'terminator'],
]

const MISSES = [
  ['Make status visible to every team', 'goal'], ['Duplicate tickets across trackers', 'problem'],
  ['Nobody owns the data pipeline', 'problem'], ['Time to first value', 'metric'], ['Architecture document', 'output'],
  ['Collect updates from each team', 'process'], ['Submission received', 'terminator'], ['Vendor lock-in', 'risk'],
  ['Install failures after the migration', 'problem'], ['Schedule delay on the integration', 'problem'],
  ['Upgrade guide for the migration', 'output'], ['Rework caused by the migration', 'problem'],
  ['Upgrade blocked by the integration', 'problem'],
]

describe('categorizeLine() -- the labelled corpus', () => {
  it('places every line the cues already agreed on', () => {
    const wrong = PLACED.filter(([line, meant]) => categorizeLine(line).type !== meant)
      .map(([line, meant]) => `${line}: ${call(line)}, meant ${meant}`)
    assert.deepEq(wrong, [])
  })

  it('is never confidently wrong: what it cannot read yet stays a low-confidence guess', () => {
    const confident = [...PLACED, ...MISSES].filter(([line, meant]) => {
      const r = categorizeLine(line)
      return r.type !== meant && r.confidence === 'high'
    }).map(([line]) => `${line}: ${call(line)}`)
    assert.deepEq(confident, [])
    MISSES.forEach(([line, meant]) => assert.neq(categorizeLine(line).type, meant, `${line} is now placed: move it to PLACED`))
  })
})
