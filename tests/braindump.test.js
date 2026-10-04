// ============================================================
//  braindump.test.js: the BRAINDUMP stream (design round, wave 2).
//  Input and placement: the prefixes are authoritative and exported
//  as data (PREFIXES), a heading types the list under it, "- " lines
//  under a requirement or metric become its criteria, every guess
//  that did not come from a prefix asks for a check, a dump lays out
//  in step columns and arrives readable, and no creation path lands
//  on a card (palette, quick create, a split line, a dump, a patch).
//  Tidy lays the blocks no line touches out in step columns.
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, view, selection, getUndoHistory, getRedoFuture } from '../js/state.js'
import { TYPES, TYPE_STEPS, DEFAULT_WIDTH } from '../js/utils.js'
import { undo, deselectAll } from '../js/render.js'
import {
  PREFIXES, CRITERIA_FROM_BULLETS, TITLE_MAX, categorizeLine, headingType, parseOutline, readDump,
  splitTitle, createBlocksFromText, dumpSummary, capitalFirst, layoutDump, settleDump, resolveTypeCheck,
} from '../js/classify.js'
import { arriveAt, ARRIVAL_ZOOM, ARRIVAL_PAD } from '../js/zoom-controls.js'
import {
  createBlockAt, createConnected, insertOnArrow, nearestFreeSpot, placeNewBlocks, occupiedRects,
} from '../js/create.js'
import { addTypeAtCenter } from '../js/palette.js'
import {
  CARD_GAP, STEP_LAYOUT, layoutByStep, stepOfType, connectedIds, tidyCanvas, tidySummary,
} from '../js/layout.js'
import { buildPlan, applyPlan } from '../js/patch.js'
import { commitInlineEdit, isInlineEditing } from '../js/inline-edit.js'

// Cards in the test page are not laid out, so every size is the estimate.
const W = DEFAULT_WIDTH, H = 100

function reset() {
  if (isInlineEditing()) commitInlineEdit()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  deselectAll()
  selection.ids.clear(); selection.blockId = null; selection.arrowId = null
  view.panX = 0; view.panY = 0; view.zoom = 1
}

function block(id, type, x, y, extra = {}) {
  state.blocks[id] = { id, type, title: id, description: '', notes: '', x, y,
    actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, ...extra }
}

const dump = () => JSON.stringify({ blocks: state.blocks, arrows: state.arrows, groups: state.groups })
const rectOf = b => ({ x: b.x, y: b.y, w: W, h: H })

/** The clear space between two rectangles along the axis that separates them (negative = overlap). */
function clearance(a, b) {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
  return Math.max(dx, dy)
}

/** Every pair among `ids` (and against `others`) keeps at least CARD_GAP. */
function assertSpaced(ids, others = []) {
  const rs = ids.map(id => ({ id, ...rectOf(state.blocks[id]) }))
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      assert.ok(clearance(rs[i], rs[j]) >= CARD_GAP, `${rs[i].id} and ${rs[j].id} are ${clearance(rs[i], rs[j])}px apart`)
    }
    others.forEach(o => {
      const r = { id: o, ...rectOf(state.blocks[o]) }
      assert.ok(clearance(rs[i], r) >= CARD_GAP, `${rs[i].id} sits ${clearance(rs[i], r)}px from ${o}`)
    })
  }
}

// The persona dump from the usability report (D-usability.md, Priya): the
// same fifteen lines in natural phrasing, and with prefixes.
const NATURAL = `Move sign-in to an external OAuth provider
Login success rate stays at or above 99.5% during cutover
Support team
Security reviewer
Existing sessions survive the cutover
  - no forced logout for users with a valid session
Every account maps to exactly one provider identity
  - migration report shows zero unmatched accounts
Roll back to local passwords within 15 minutes
  - flag flip, no deploy
Add the OIDC client and callback route
Write the account-linking migration script
Put provider login behind a feature flag
Remove local password hashes 30 days after cutover
Provider outage locks every user out
Email mismatch links an account to the wrong person
The provider's token lifetime can match our session length
Do service accounts and API keys go through the provider too?`

const PREFIXED = `Goal: Move sign-in to an external OAuth provider
Metric: Login success rate stays at or above 99.5% during cutover
Who: Support team
Stakeholder: Security reviewer
Req: Existing sessions survive the cutover
  - No forced logout for users with a valid session
Requirement: Every account maps to exactly one provider identity
  - Migration report shows zero unmatched accounts
Req: Roll back to local passwords within 15 minutes
  - Flag flip, no deploy
Build: Add the OIDC client and callback route
Impl: Write the account-linking migration script
Build: Put provider login behind a feature flag
Build: Remove local password hashes 30 days after cutover
Risk: Provider outage locks every user out
Risk: Email mismatch links an account to the wrong person
Assume: The provider's token lifetime can match our session length
Do service accounts and API keys go through the provider too?`

// ── Prefixes ─────────────────────────────────────────────────

describe('braindump: PREFIXES is the documented syntax', () => {
  it('has one entry per type except Other, in step order', () => {
    const types = PREFIXES.map(p => p.type)
    assert.eq(new Set(types).size, types.length, 'no type twice')
    assert.deepEq([...types].sort(), Object.keys(TYPES).filter(t => t !== 'custom').sort())
    const order = TYPE_STEPS.map(s => s.id)
    const steps = PREFIXES.map(p => order.indexOf(stepOfType(p.type)))
    assert.deepEq(steps, [...steps].sort((a, b) => a - b), 'Why, Who, Proof, What, How, Doubt, Other')
  })

  it('every shown form is sure, every sure form is an accepted key, and every entry has an example', () => {
    PREFIXES.forEach(p => {
      assert.ok(p.show.length > 0, p.type)
      p.show.forEach(s => assert.includes(p.sure, s, `${p.type}: ${s}`))
      p.sure.forEach(s => assert.includes(p.keys, s, `${p.type}: ${s}`))
      assert.ok(typeof p.example === 'string' && p.example.length > 3, p.type)
    })
  })

  it('no key belongs to two types', () => {
    const all = PREFIXES.flatMap(p => p.keys)
    assert.eq(new Set(all).size, all.length)
  })

  it('teaches the forms the brief names', () => {
    const shown = new Map(PREFIXES.flatMap(p => p.show.map(s => [s, p.type])))
    ;[['goal', 'goal'], ['who', 'stakeholder'], ['stakeholder', 'stakeholder'], ['metric', 'metric'],
      ['req', 'requirement'], ['requirement', 'requirement'], ['build', 'implementation'], ['impl', 'implementation'],
      ['risk', 'risk'], ['assume', 'assumption'], ['decision', 'decision'], ['output', 'output'],
      ['step', 'process'], ['trigger', 'terminator'], ['context', 'context'], ['question', 'question'],
    ].forEach(([form, type]) => assert.eq(shown.get(form), type, form))
  })

  it('every sure form types its line outright, in any case, and strips itself from the title', () => {
    PREFIXES.forEach(p => p.sure.forEach(k => {
      ;[`${k}: Ship the thing`, `${k.toUpperCase()}: Ship the thing`, `${k[0].toUpperCase()}${k.slice(1)} : Ship the thing`].forEach(line => {
        const r = categorizeLine(line)
        assert.deepEq([r.type, r.source, r.title], [p.type, 'prefix', 'Ship the thing'], line)
      })
    }))
  })

  it('any other key is a guess at its type that keeps the word, and a dump asks for a check', () => {
    PREFIXES.forEach(p => p.keys.filter(k => !p.sure.includes(k)).forEach(k => {
      const line = `${k[0].toUpperCase()}${k.slice(1)}: Ship the thing`
      const r = categorizeLine(line)
      assert.deepEq([r.type, r.source, r.title], [p.type, 'alias', line], line)
      const [spec] = readDump(line)
      assert.deepEq([spec.type, spec.typeCheck], [p.type, true], line)
    }))
  })

  it('stand-up notes are flagged, not confidently wrong', () => {
    const got = readDump([
      'Done: OIDC client merged',
      'Task: write the account-linking migration script',
      'Action: draft the rollback runbook',
      'Target: 99.5% login success during cutover',
      'Start: 3 March',
      'End: 30 days after cutover',
      'Should: we also support SAML?',
      'Who: owns the rollout?',
    ].join('\n')).map(s => [s.type, s.title, s.typeCheck])
    assert.deepEq(got, [
      ['terminator', 'Done: OIDC client merged', true],
      ['implementation', 'Task: write the account-linking migration script', true],
      ['process', 'Action: draft the rollback runbook', true],
      ['metric', 'Target: 99.5% login success during cutover', true],
      ['terminator', 'Start: 3 March', true],
      ['terminator', 'End: 30 days after cutover', true],
      ['question', 'Should we also support SAML?', false],
      ['question', 'Who owns the rollout?', false],
    ])
  })

  it('a sure prefix holds against a "?", except a word that asks', () => {
    assert.deepEq([categorizeLine('Risk: will the provider go down?').type, categorizeLine('Risk: will the provider go down?').source], ['risk', 'prefix'])
    assert.deepEq([categorizeLine('Who: Support team').type, categorizeLine('Who: Support team').source], ['stakeholder', 'prefix'])
    assert.eq(readDump('Q: what is the token lifetime?')[0].title, 'What is the token lifetime?')
    assert.eq(categorizeLine('Done. Moving on to the next item').source, 'guess', 'only a sure word takes the full stop')
    assert.eq(readDump('goal. ship it')[0].title, 'Ship it')
  })

  it('in a dump a prefixed title starts with a capital; a word with capitals inside stays as written', () => {
    const titles = readDump(['goal: cut drop-off', "Q: what's the token lifetime?", 'build: iOS login screen', 'build: OIDC client',
      'context: https://example.test/runbook', 'who: owns the rollout?', 'provider outage locks users out', 'Risks:', '- email mismatch'].join('\n'))
      .map(s => s.title)
    assert.deepEq(titles, ['Cut drop-off', "What's the token lifetime?", 'iOS login screen', 'OIDC client',
      'https://example.test/runbook', 'Who owns the rollout?', 'provider outage locks users out', 'email mismatch'],
      'a line with no prefix is the line as typed')
    assert.eq(capitalFirst('élan matters'), 'Élan matters')
    assert.eq(capitalFirst(''), '')
    assert.eq(categorizeLine('Problem: checkout breaks').title, 'checkout breaks', 'the importers keep the title as written')
  })

  it('each example, written with its short form, reads back as its type', () => {
    PREFIXES.forEach(p => {
      const r = categorizeLine(`${p.show[0]}: ${p.example}`)
      assert.deepEq([r.type, r.source], [p.type, 'prefix'], p.example)
    })
  })

  it('a trailing "?" is an Open Question, certain; a belief with one stays a guess', () => {
    assert.deepEq(Object.values(categorizeLine('Who signs off the migration?')).slice(0, 4),
      ['question', 'Who signs off the migration?', 'high', 'question'])
    assert.eq(categorizeLine('We assume admins will probably invite later?').source, 'guess')
  })

  it('reads past the markup notes carry: bullets, numbers, task boxes, headings, bold', () => {
    ;['- Goal: Ship it', '* Goal: Ship it', '1) Goal: Ship it', '2. Goal: Ship it', '- [ ] Goal: Ship it',
      '[x] Goal: Ship it', '## Goal: Ship it', '**Goal:** Ship it', '**Goal**: Ship it'].forEach(line => {
      const r = categorizeLine(line)
      assert.deepEq([r.type, r.title, r.source], ['goal', 'Ship it', 'prefix'], line)
    })
  })

  it('a number or a dash is a list marker only with a space after it', () => {
    assert.eq(parseOutline('3.5% of trials convert')[0].line, '3.5% of trials convert')
    assert.eq(parseOutline('2.0 rollout plan')[0].line, '2.0 rollout plan')
    assert.eq(parseOutline('-5% activation since launch')[0].line, '-5% activation since launch')
    assert.eq(parseOutline('Steps\n1. First\n2) Second').length, 1, 'numbered children still fold')
    assert.eq(parseOutline('Steps\n-\n- \n*').length, 1, 'an empty bullet makes nothing')
    assert.eq(parseOutline('Steps\n•First').length, 1, 'a bullet glyph needs no space')
  })

  it('reads the bullets a document editor pastes, and "Q:" for a question', () => {
    const items = parseOutline('Req: Sessions survive\n– No forced logout\n◦ Refresh works\n▪ Rollback works')
    assert.eq(items.length, 1)
    assert.deepEq(items[0].children.map(c => [c.text, c.bullet]), [['No forced logout', true], ['Refresh works', true], ['Rollback works', true]])
    assert.deepEq([categorizeLine('Q: Who signs off?').type, categorizeLine('Q: Who signs off?').title], ['question', 'Who signs off?'])
    assert.eq(categorizeLine('Q3 revenue is flat').source, 'guess', '"Q3" is not the prefix')
  })
})

// ── Long lines and big dumps ─────────────────────────────────

describe('braindump: hardening for pasted notes', () => {
  it('a pasted paragraph keeps its first sentence as the title and the rest as the description', () => {
    const para = 'Move sign-in to an external provider before the audit. ' +
      'The current password store fails two controls, and every month it stays adds work for the support team.'
    const [s] = readDump(`Goal: ${para}`)
    assert.eq(s.type, 'goal')
    assert.eq(s.title, 'Move sign-in to an external provider before the audit.')
    assert.eq(s.description, para.slice(s.title.length + 1))
  })

  it('a long line with no sentence break is cut at a word, and the description keeps all of it', () => {
    const long = Array(40).fill('provider').join(' ')
    const { title, overflow } = splitTitle(long)
    assert.ok(title.length <= TITLE_MAX + 1, `${title.length}`)
    assert.ok(title.endsWith('provider…'), 'cut after a whole word')
    assert.eq(overflow, long)
    assert.deepEq(splitTitle('Short title'), { title: 'Short title', overflow: '' })
  })

  it('an abbreviation or a lower-case next word is not a sentence end', () => {
    const line = 'We need to support every identity provider the enterprise customers use today, e.g. the two big ones, ' +
      'and keep the local accounts working for the contractors who have no provider at all until the end of the year.'
    assert.gt(line.length, TITLE_MAX)
    const { title, overflow } = splitTitle(line)
    assert.ok(!title.endsWith('e.g.'), title)
    assert.ok(title.endsWith('…'), 'no sentence end within reach: cut at a word')
    assert.eq(overflow, line)
    const two = 'Move sign-in to the provider, i.e. the hosted one. The current store fails two controls and every month adds work for the support team, which is the cost.'
    assert.eq(splitTitle(two).title, 'Move sign-in to the provider, i.e. the hosted one.')
    const lower = 'Cut over in March vs. April. that slips the audit, and the audit needs the provider in place before the second control is tested again.'
    assert.ok(!splitTitle(lower).title.endsWith('April.'), 'a lower-case next word carries the sentence on')
  })

  it('a long requirement keeps its criteria; the rest of its line goes to the description', () => {
    const long = 'Every account maps to exactly one provider identity. ' + 'Accounts with two emails are merged first by support. '.repeat(3)
    const [s] = readDump(`Req: ${long}\n- Zero unmatched accounts`)
    assert.eq(s.title, 'Every account maps to exactly one provider identity.')
    assert.deepEq(s.criteria, ['Zero unmatched accounts'])
    assert.ok(s.description.startsWith('Accounts with two emails'))
  })

  it('blank and whitespace-only input makes nothing and takes no undo step', () => {
    reset()
    assert.deepEq(readDump(''), [])
    assert.deepEq(createBlocksFromText('  \n\t\n   '), [])
    assert.eq(getUndoHistory().length, 0)
  })

  it('a very long step grows its columns instead of a strip of narrow ones', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: 'm' + i, type: 'context', w: W, h: H }))
    const { lanes } = layoutByStep(many)
    assert.eq(lanes.length, 5)
    assert.deepEq(lanes.map(l => l.ids.length), [10, 10, 10, 10, 10])
  })

  it('emoji, accents and right-to-left text pass through as titles', () => {
    const specs = readDump('Risk: 🔥 Données perdues\nGoal: تحسين التسجيل\n問題が多い?\n誰が承認しますか？')
    assert.deepEq(specs.map(s => [s.type, s.title]), [['risk', '🔥 Données perdues'], ['goal', 'تحسين التسجيل'],
      ['question', '問題が多い?'], ['question', '誰が承認しますか？']])
    assert.ok(specs.every(s => !s.typeCheck), 'a full-width question mark is a question too')
  })
})

// ── Headings ─────────────────────────────────────────────────

describe('braindump: a heading types the list under it', () => {
  it('recognises the word alone with a colon, a Markdown heading, plurals and type labels', () => {
    ;[['Risks:', 'risk'], ['Goal:', 'goal'], ['## Open questions', 'question'], ['Open questions:', 'question'],
      ['**Requirements:**', 'requirement'], ['Reqs:', 'requirement'], ['Who:', 'stakeholder'], ['Metrics :', 'metric'],
      ['# Assumptions', 'assumption'], ['Hypotheses:', 'assumption'], ['Work items:', 'implementation'],
      ['Processes:', 'process'], ['Triggers:', 'terminator'], ['Background:', 'context'],
    ].forEach(([line, type]) => assert.eq(headingType(line), type, line))
  })

  it('is not a heading with text after it, without a colon, or for a word a list uses for anything', () => {
    ;['Goal: ship it', 'Risks', 'Risk register', 'Done:', 'Tasks:', 'Notes:', 'Status:', 'Results:', 'Start:',
      '## Plan for the quarter', 'Team:'].forEach(line => assert.eq(headingType(line), null, line))
  })

  it('a bulleted list under a heading: each line one block of that type, none flagged', () => {
    const specs = readDump('Risks:\n- Provider outage locks every user out\n- Email mismatch links the wrong account\nGoals:\n- Move sign-in to the provider')
    assert.deepEq(specs.map(s => [s.type, s.title, s.typeCheck]), [
      ['risk', 'Provider outage locks every user out', false],
      ['risk', 'Email mismatch links the wrong account', false],
      ['goal', 'Move sign-in to the provider', false],
    ])
    assert.deepEq(specs.map(s => s.source), ['heading', 'heading', 'heading'])
  })

  it('a flat list under a heading runs to a blank line; the next line is read on its own', () => {
    const specs = readDump('Open questions:\nDo service accounts move too\nWho approves the cutover\n\nAdd the OIDC client')
    assert.deepEq(specs.map(s => [s.type, s.source]), [['question', 'heading'], ['question', 'heading'], [specs[2].type, 'guess']])
    assert.eq(specs[2].typeCheck, true)
  })

  it('a Markdown heading runs to the next heading, across blank lines', () => {
    const specs = readDump('## Risks\n\nProvider outage locks every user out\n\nEmail mismatch links an account to the wrong person\n\n## Timeline\n\nCut over in March')
    assert.deepEq(specs.map(s => [s.type, s.source]).slice(0, 2), [['risk', 'heading'], ['risk', 'heading']])
    assert.eq(specs[2].title, 'Timeline', 'an unknown heading ends the section')
    assert.eq(specs[3].source, 'guess', 'and what follows it is read on its own')
    const word = readDump('Risks:\nProvider outage\n\nCut over in March')
    assert.deepEq(word.map(s => s.source), ['heading', 'guess'], 'a "Word:" heading still ends at a blank line')
  })

  it('a bulleted list ends at a shallower line, whatever it says', () => {
    const specs = readDump('Risks:\n- Provider outage\n- Email mismatch\nShip the migration before the review')
    assert.deepEq(specs.map(s => s.source), ['heading', 'heading', 'guess'])
  })

  it("a line's own prefix wins over its heading", () => {
    const specs = readDump('Risks:\n- Provider outage\n- Assume: the provider has an SLA')
    assert.deepEq(specs.map(s => [s.type, s.source]), [['risk', 'heading'], ['assumption', 'prefix']])
  })

  it('a heading alone makes no block; "Done:" and "Tasks:" stay ordinary lines', () => {
    assert.eq(readDump('Risks:').length, 0)
    assert.eq(readDump('Risks:\n\n').length, 0)
    const done = parseOutline('Done:\n- Set up the repo\n- Wrote the tests')
    assert.eq(done.length, 1, 'the bullets fold into the line above, as before')
    assert.eq(done[0].section, null)
  })

  it('sub-bullets under a requirement in a heading list become its criteria', () => {
    const [a, b] = readDump('## Requirements\n- Sessions survive the cutover\n  - No forced logout\n  - Tokens refresh silently\n- Rollback within 15 minutes')
    assert.deepEq([a.type, a.title, a.criteria, a.description], ['requirement', 'Sessions survive the cutover', ['No forced logout', 'Tokens refresh silently'], ''])
    assert.deepEq([b.type, b.criteria], ['requirement', []])
  })

  it('with nesting off, every line is a block and the heading still types them', () => {
    const specs = readDump('Risks:\n- Provider outage\n  - Every login fails', false)
    assert.deepEq(specs.map(s => [s.type, s.title]), [['risk', 'Provider outage'], ['risk', 'Every login fails']])
  })
})

// ── Criteria from bullets ────────────────────────────────────

describe('braindump: "- " lines under a requirement or metric are its criteria', () => {
  it('requirement and metric only', () => {
    assert.deepEq([...CRITERIA_FROM_BULLETS].sort(), ['metric', 'requirement'])
    CRITERIA_FROM_BULLETS.forEach(t => assert.ok(TYPES[t].criteria, `${t} carries criteria`))
  })

  it('bullets become criteria (a metric\'s Targets); an unmarked continuation stays the description', () => {
    const [req, metric, goal] = readDump([
      'Req: Existing sessions survive the cutover',
      '  Sessions issued before the switch',
      '  - No forced logout for users with a valid session',
      '  - Refresh works across the switch',
      'Metric: Login success rate',
      '- At or above 99.5% during cutover',
      'Goal: Move sign-in to an external provider',
      '- Without a support spike',
    ].join('\n'))
    assert.deepEq(req.criteria, ['No forced logout for users with a valid session', 'Refresh works across the switch'])
    assert.eq(req.description, 'Sessions issued before the switch')
    assert.deepEq(metric.criteria, ['At or above 99.5% during cutover'])
    assert.eq(metric.description, '')
    assert.deepEq(goal.criteria, [], 'a goal keeps its bullets as the description')
    assert.eq(goal.description, '• Without a support spike')
  })

  it('under a guessed type the bullets stay in the description, where every type shows them', () => {
    const cases = [
      'Support team\n  - Tier 1 handles the cutover tickets\n  - Escalation goes to the platform on-call',
      'We must not break the mobile app\n  - mobile app v4 still uses the old token endpoint',
      '3.5% of logins fail on mobile\n1. Ship the flag\n2. Migrate accounts',
    ]
    cases.forEach(text => {
      const [s] = readDump(text)
      assert.ok(CRITERIA_FROM_BULLETS.has(s.type), `${s.type}: still the classifier's guess`)
      assert.ok(s.typeCheck, 'a guess')
      assert.deepEq(s.criteria, [], text)
      assert.ok(s.description.startsWith('• '), s.description)
    })
  })

  it('fixing a guessed requirement to a stakeholder keeps its notes on the card', () => {
    reset()
    const [id] = createBlocksFromText('Support team\n  - Tier 1 handles the cutover tickets\n  - Escalation goes to the platform on-call')
    assert.eq(state.blocks[id].type, 'requirement')
    assert.ok(resolveTypeCheck(id, 'stakeholder'))
    const b = state.blocks[id]
    assert.eq(b.type, 'stakeholder')
    assert.ok(!(b.criteria || []).length, 'nothing hidden in a field the stakeholder does not show')
    assert.eq(b.description, '• Tier 1 handles the cutover tickets\n• Escalation goes to the platform on-call')
    reset()
  })

  it('drops repeats, caps at 30 and keeps the overflow in the description', () => {
    const lines = ['Req: Many checks', '- Same check', '- same check']
    for (let i = 0; i < 32; i++) lines.push(`- Check ${i}`)
    const [r] = readDump(lines.join('\n'))
    assert.eq(r.criteria.length, 30)
    assert.eq(r.criteria.filter(c => c.toLowerCase() === 'same check').length, 1)
    assert.eq(r.description.split('\n').length, 3, 'the three past the cap stay as text')
  })

  it('lands on the created block, so the requirement has no criteria gap', () => {
    reset()
    const [id] = createBlocksFromText('Req: Sessions survive\n- No forced logout')
    assert.deepEq(state.blocks[id].criteria, ['No forced logout'])
    assert.ok(!state.blocks[id].typeCheck)
    reset()
  })
})

// ── The persona dump ─────────────────────────────────────────

describe('braindump: the usability dump, natural and prefixed', () => {
  it('with prefixes: fifteen of fifteen typed as meant, no check asked, criteria in place', () => {
    const specs = readDump(PREFIXED)
    assert.eq(specs.length, 15)
    assert.deepEq(specs.map(s => s.type), ['goal', 'metric', 'stakeholder', 'stakeholder', 'requirement', 'requirement',
      'requirement', 'implementation', 'implementation', 'implementation', 'implementation', 'risk', 'risk', 'assumption', 'question'])
    assert.eq(specs.filter(s => s.typeCheck).length, 0)
    assert.deepEq(specs.filter(s => s.type === 'requirement').map(s => s.criteria.length), [1, 1, 1])
  })

  it('in natural phrasing every guess asks for a check; only the "?" line is certain', () => {
    const specs = readDump(NATURAL)
    assert.eq(specs.length, 15)
    const certain = specs.filter(s => !s.typeCheck)
    assert.deepEq(certain.map(s => [s.type, s.source]), [['question', 'question']])
    // The three the report found confidently wrong are flagged now.
    ;['Move sign-in to an external OAuth provider', 'Add the OIDC client and callback route', 'Provider outage locks every user out']
      .forEach(t => assert.ok(specs.find(s => s.title === t).typeCheck, t))
  })

  it('creates them as one undo step that restores the canvas exactly', () => {
    reset()
    block('x', 'goal', 0, 0)
    const before = dump()
    const ids = createBlocksFromText(PREFIXED)
    assert.eq(ids.length, 15)
    assert.eq(getUndoHistory().length, 1)
    undo()
    assert.eq(dump(), before)
    reset()
  })

  it('creates nothing in a view-only map', () => {
    reset()
    ui.readOnly = true
    assert.deepEq(createBlocksFromText('Goal: x'), [])
    ui.readOnly = false
    assert.eq(Object.keys(state.blocks).length, 0)
  })
})

// ── Step columns ─────────────────────────────────────────────

describe('braindump: layoutByStep()', () => {
  const nodes = (types, h = H) => types.map((type, i) => ({ id: `${type}${i}`, type, w: W, h }))

  it('one column per step in step order, empty steps left out, CARD_GAP between rows', () => {
    const { positions, lanes, width, height } = layoutByStep(nodes(['risk', 'goal', 'implementation', 'goal', 'metric']))
    assert.deepEq(lanes.map(l => l.step), ['why', 'proof', 'how', 'doubt'])
    assert.deepEq(lanes[0].ids, ['goal1', 'goal3'], 'a step keeps the order given')
    const col = STEP_LAYOUT.columnGap
    assert.deepEq(positions.get('goal1'), { x: 0, y: 0 })
    assert.deepEq(positions.get('goal3'), { x: 0, y: H + CARD_GAP })
    assert.deepEq(positions.get('metric4'), { x: W + col, y: 0 })
    assert.deepEq(positions.get('implementation2'), { x: 2 * (W + col), y: 0 })
    assert.deepEq(positions.get('risk0'), { x: 3 * (W + col), y: 0 })
    assert.eq(width, 4 * W + 3 * col)
    assert.eq(height, 2 * H + CARD_GAP)
  })

  it('a long step wraps into a second column CARD_GAP beside the first', () => {
    const n = STEP_LAYOUT.maxPerColumn + 2
    const { positions, lanes } = layoutByStep([...nodes(Array(n).fill('requirement')), ...nodes(['risk'])])
    assert.deepEq(lanes.map(l => [l.step, l.ids.length]), [['what', STEP_LAYOUT.maxPerColumn], ['what', 2], ['doubt', 1]])
    const second = positions.get(`requirement${STEP_LAYOUT.maxPerColumn}`)
    assert.deepEq(second, { x: W + CARD_GAP, y: 0 })
    assert.eq(positions.get(`risk0`).x, 2 * W + CARD_GAP + STEP_LAYOUT.columnGap)
  })

  it('wrap: columns that would end past the width start a band below the tallest one above', () => {
    const ns = nodes(['goal', 'goal', 'stakeholder', 'metric', 'requirement', 'implementation', 'risk'])
    const col = STEP_LAYOUT.columnGap
    const { positions, width, height } = layoutByStep(ns, { wrap: 2 * W + col })
    assert.deepEq(positions.get('goal0'), { x: 0, y: 0 })
    assert.deepEq(positions.get('stakeholder2'), { x: W + col, y: 0 })
    const band2 = 2 * H + CARD_GAP + col
    assert.deepEq(positions.get('metric3'), { x: 0, y: band2 }, 'the third column opens the second band')
    assert.deepEq(positions.get('requirement4'), { x: W + col, y: band2 })
    assert.deepEq(positions.get('risk6'), { x: W + col, y: band2 + H + col })
    assert.eq(width, 2 * W + col)
    assert.eq(height, band2 + H + col + H)
    assert.deepEq(layoutByStep(ns, { wrap: Infinity }).positions, layoutByStep(ns).positions, 'no wrap is one band')
  })

  it('grow: false keeps a long step at maxPerColumn', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: 'm' + i, type: 'context', w: W, h: H }))
    assert.eq(layoutByStep(many, { grow: false, maxPerColumn: 2, direction: 'TB' }).lanes.length, 25)
  })

  it('TB turns columns into rows; Other and unknown types go last', () => {
    const { positions, lanes } = layoutByStep([
      { id: 'c', type: 'context', w: W, h: H }, { id: 'u', type: 'no-such-type', w: W, h: H }, { id: 'g', type: 'goal', w: W, h: H },
    ], { direction: 'TB' })
    assert.deepEq(lanes.map(l => l.step), ['why', 'other'])
    assert.deepEq(positions.get('g'), { x: 0, y: 0 })
    assert.deepEq(positions.get('c'), { x: 0, y: H + STEP_LAYOUT.columnGap })
    assert.deepEq(positions.get('u'), { x: W + CARD_GAP, y: H + STEP_LAYOUT.columnGap })
  })
})

describe('braindump: a dump lands in step columns, never on a card', () => {
  it('Why, Who, Proof, What, How, Doubt read left to right, and the cards keep CARD_GAP', () => {
    reset()
    const ids = createBlocksFromText(PREFIXED)
    const xOf = type => Math.min(...ids.filter(id => state.blocks[id].type === type).map(id => state.blocks[id].x))
    const order = ['goal', 'stakeholder', 'metric', 'requirement', 'implementation', 'risk']
    order.slice(1).forEach((t, i) => assert.gt(xOf(t), xOf(order[i]), `${t} right of ${order[i]}`))
    assert.eq(xOf('assumption'), xOf('risk'), 'one Doubt column')
    assertSpaced(ids)
    ids.forEach(id => {
      assert.eq(state.blocks[id].x, Math.round(state.blocks[id].x), 'whole pixels')
      assert.eq(state.blocks[id].y, Math.round(state.blocks[id].y))
    })
    reset()
  })

  it('on a busy map the whole arrangement moves to the nearest free space', () => {
    reset()
    // Cards across the middle of the view, where the dump wants to land.
    for (let i = 0; i < 5; i++) block('old' + i, 'context', -600 + i * 260, -60)
    const ids = createBlocksFromText(PREFIXED)
    assertSpaced(ids, Object.keys(state.blocks).filter(id => id.startsWith('old')))
    reset()
  })

  it('a caller that moves the dump onto a card (Paste as blocks at the menu) sees it move clear', async () => {
    reset()
    block('old', 'goal', 0, 0)
    const ids = createBlocksFromText('Risk: Provider outage\nRisk: Email mismatch\nReq: Sessions survive\nBuild: OIDC client')
    // A caller that moves the arrangement's corner to a point after the dump.
    const minX = Math.min(...ids.map(id => state.blocks[id].x)), minY = Math.min(...ids.map(id => state.blocks[id].y))
    ids.forEach(id => { state.blocks[id].x += -60 - minX; state.blocks[id].y += 0 - minY })
    await Promise.resolve()
    assertSpaced(ids, ['old'])
    assert.eq(getUndoHistory().length, 1, 'still the one undo step')
    assert.ok(!settleDump(ids), 'clear now, so nothing more moves')
    reset()
  })

  it('at a given point, the arrangement starts there when the space is free', () => {
    reset()
    const ids = createBlocksFromText('Goal: one\nRisk: two', true, { at: { x: 610, y: 420 } })
    assert.eq(Math.min(...ids.map(id => state.blocks[id].x)), 610 - DEFAULT_WIDTH / 2)
    assert.eq(Math.min(...ids.map(id => state.blocks[id].y)), 420)
    reset()
  })
})

// ── Arrival ──────────────────────────────────────────────────

// A laid-out viewport of a known size. Fixed and out of the flex flow: the
// design-token tests adopt style.css, which makes the body a flex column
// that would shrink it to nothing.
async function withViewport(w, h, fn) {
  const vp = document.getElementById('canvasViewport')
  const prev = vp.getAttribute('style')
  const css = document.createElement('style')
  css.textContent = `#canvasRoot .block { position: absolute; height: ${H}px; box-sizing: border-box; overflow: hidden }`
  document.head.appendChild(css)
  vp.setAttribute('style', `display:block;position:fixed;left:0;top:0;flex:none;width:${w}px;height:${h}px;overflow:hidden`)
  try { return await fn() } finally {
    vp.setAttribute('style', prev)
    css.remove()
  }
}

describe('braindump: a dump arrives readable', () => {
  it('a laptop view: the columns wrap into bands, and the whole dump arrives readable', () => withViewport(1100, 760, () => {
    reset()
    const ids = createBlocksFromText(PREFIXED)
    const r = arriveAt(ids, { stay: true })
    assert.ok(view.zoom >= ARRIVAL_ZOOM, `${view.zoom}`)
    assert.ok(r.whole, 'all fifteen in view')
    const ys = new Set(ids.map(id => state.blocks[id].y))
    const goal = ids.find(id => state.blocks[id].type === 'goal'), risk = ids.find(id => state.blocks[id].type === 'risk')
    assert.gt(state.blocks[risk].y, state.blocks[goal].y, 'Doubt sits in a band under Why')
    assert.gt(ys.size, 1)
    assertSpaced(ids)
    reset()
  }))

  it('too big for the view at a readable zoom: ARRIVAL_ZOOM on the start, Why first', () => withViewport(900, 600, () => {
    reset()
    const ids = createBlocksFromText(PREFIXED + '\n' + PREFIXED)
    const r = arriveAt(ids, { stay: true })
    assert.ok(r.moved)
    assert.eq(r.whole, false)
    assert.eq(view.zoom, ARRIVAL_ZOOM)
    const minY = Math.min(...ids.map(id => state.blocks[id].y))
    // The arrival's margin is in world pixels, so it is ARRIVAL_PAD at this zoom.
    assert.ok(Math.abs(minY * view.zoom + view.panY - ARRIVAL_PAD * view.zoom) <= 1, 'the top row starts at the top edge')
    const goal = ids.find(id => state.blocks[id].type === 'goal')
    const gx = state.blocks[goal].x * view.zoom + view.panX
    assert.ok(gx >= 0 && gx < 900, 'the Why column is in view')
    reset()
  }))

  it('a phone view: step rows, as many cards across as read', () => withViewport(390, 640, () => {
    reset()
    const ids = createBlocksFromText('Goal: one\nWho: two\nMetric: three\nReq: four\nBuild: five\nRisk: six\nRisk: seven')
    arriveAt(ids, { stay: true })
    const goal = state.blocks[ids[0]], who = state.blocks[ids[1]], risks = ids.slice(5).map(id => state.blocks[id])
    assert.gt(who.y, goal.y, 'Who is a row under Why')
    assert.eq(goal.x, who.x, 'rows start at one edge')
    assert.eq(who.y - goal.y, H + STEP_LAYOUT.columnGap, 'a step gap between rows')
    assert.eq(risks[1].y - risks[0].y, H + CARD_GAP, 'one card across: a step wraps onto a second row, CARD_GAP under')
    assert.eq(view.zoom, ARRIVAL_ZOOM)
    const shown = ids.filter(id => {
      const b = state.blocks[id], top = b.y * view.zoom + view.panY
      return top >= 0 && top + H * view.zoom <= 640
    })
    assert.ok(shown.length >= 4, `${shown.length} of 7 cards in view`)
    reset()
  }))

  it('a small dump fits, never past 100%; one already in view leaves the camera alone', () => withViewport(900, 600, () => {
    reset()
    view.zoom = 0.3
    const ids = createBlocksFromText('Goal: one\nRisk: two')
    const r = arriveAt(ids, { stay: true })
    assert.ok(r.moved && r.whole)
    assert.eq(view.zoom, 1)
    const again = arriveAt(ids, { stay: true })
    assert.deepEq(again, { whole: true, moved: false })
    reset()
  }))

  it('runs after the caller: a block moved right after the dump is what the camera shows', () => withViewport(900, 600, async () => {
    reset()
    const ids = createBlocksFromText('Goal: one')
    state.blocks[ids[0]].x = 5000
    state.blocks[ids[0]].y = 5000
    await Promise.resolve()
    const sx = 5000 * view.zoom + view.panX
    assert.ok(sx >= 0 && sx + W * view.zoom <= 900, `the moved card is in view (${sx})`)
    reset()
  }))

  it('does nothing without a laid-out viewport', () => {
    reset()
    block('a', 'goal', 9000, 9000)
    assert.eq(arriveAt(['a'], { stay: true }), null)
    assert.deepEq([view.panX, view.panY, view.zoom], [0, 0, 1])
    reset()
  })

  it('the toast says how many, how many types to check, and how to see them all', () => {
    assert.eq(dumpSummary(1), 'Added 1 block')
    assert.eq(dumpSummary(15, 0, true), 'Added 15 blocks')
    assert.eq(dumpSummary(15, 14, false, 'Shift+1'), 'Added 15 blocks, 14 with a guessed type to check. Shift+1 shows all of them')
    assert.eq(dumpSummary(3, 3, true), 'Added 3 blocks, every type a guess to check')
    assert.eq(dumpSummary(1, 1, false, 'Shift+1'), 'Added 1 block, 1 with a guessed type to check. Shift+1 shows all of it')
    assert.eq(dumpSummary(4, 0, false, 'Fit'), 'Added 4 blocks. Fit shows all of them', 'a phone names the Fit button')
    assert.match(dumpSummary(4, 0, false), /^Added 4 blocks\. (Shift\+1|Fit) shows all of them$/)
  })
})

describe('braindump: layoutDump() fits the arrangement to the view', () => {
  const ns = types => types.map((type, i) => ({ id: `${type}${i}`, type, w: W, h: H }))
  const SIX = ns(['goal', 'stakeholder', 'metric', 'requirement', 'implementation', 'risk'])

  it('no view: one band of columns', () => {
    assert.deepEq(layoutDump(SIX).positions, layoutByStep(SIX).positions)
    assert.deepEq(layoutDump(SIX, 0, 0).positions, layoutByStep(SIX).positions)
  })

  it('a wide, short view keeps one band; a squarer one wraps where the whole shows larger', () => {
    const wide = layoutDump(SIX, 2400, 500)
    assert.eq(new Set(SIX.map(n => wide.positions.get(n.id).y)).size, 1)
    const square = layoutDump(SIX, 900, 800)
    assert.gt(new Set(SIX.map(n => square.positions.get(n.id).y)).size, 1, 'more than one band')
    const zoom = l => Math.min(1, 900 / (l.width + ARRIVAL_PAD * 2), 800 / (l.height + ARRIVAL_PAD * 2))
    assert.ok(zoom(square) > zoom(layoutByStep(SIX)), 'and it shows larger than one band would')
    const order = SIX.map(n => square.positions.get(n.id)).map(p => p.y * 10000 + p.x)
    assert.deepEq(order, [...order].sort((a, b) => a - b), 'still Why, Who, Proof, What, How, Doubt in reading order')
  })

  it('a tall view: step rows with as many cards across as read at ARRIVAL_ZOOM', () => {
    const many = ns(Array(5).fill('requirement'))
    const l = layoutDump(many, 390, 800)
    const across = Math.floor((390 / ARRIVAL_ZOOM - ARRIVAL_PAD * 2 + CARD_GAP) / (W + CARD_GAP))
    assert.eq(l.lanes[0].ids.length, Math.max(1, across))
    assert.ok((l.width + ARRIVAL_PAD * 2) * ARRIVAL_ZOOM <= 390 || across === 1, 'a row fits across the phone')
  })
})

// ── Free slots ───────────────────────────────────────────────

describe('braindump: nearestFreeSpot()', () => {
  it('returns the request when it is free, in whole pixels', () => {
    assert.deepEq(nearestFreeSpot(10.4, 20.6, W, H, []), { x: 10, y: 21 })
    assert.deepEq(nearestFreeSpot(0, 0, W, H, [{ x: 1000, y: 1000, w: W, h: H }]), { x: 0, y: 0 })
  })

  it('moves the least distance that keeps the gap, preferring below', () => {
    const p = nearestFreeSpot(0, 0, W, H, [{ x: 0, y: 0, w: W, h: H }])
    assert.deepEq(p, { x: 0, y: H + CARD_GAP })
  })

  it('keeps the gap from every card around it', () => {
    const rects = [{ x: 0, y: 0, w: W, h: H }, { x: 0, y: 140, w: W, h: H }, { x: 0, y: -140, w: W, h: H }]
    const p = nearestFreeSpot(0, 0, W, H, rects)
    rects.forEach(r => assert.ok(clearance({ ...p, w: W, h: H }, r) >= CARD_GAP))
  })

  it('past the search, goes right of everything', () => {
    const wall = [{ x: -5000, y: -5000, w: 10000, h: 10000 }]
    assert.deepEq(nearestFreeSpot(0, 0, W, H, wall), { x: 5000 + 2 * CARD_GAP, y: 0 })
  })
})

describe('braindump: no creation path lands on a card', () => {
  it('createBlockAt on top of a card takes the nearest free slot', () => {
    reset()
    block('a', 'goal', 400, 250)
    const id = createBlockAt('risk', 400 + W / 2, 250 + H / 2, { edit: false })
    assertSpaced([id], ['a'])
    reset()
  })

  it('palette clicks: the second card lands beside the first, not on it', () => {
    reset()
    const one = addTypeAtCenter('goal'); if (isInlineEditing()) commitInlineEdit()
    const two = addTypeAtCenter('goal'); if (isInlineEditing()) commitInlineEdit()
    const three = addTypeAtCenter('risk'); if (isInlineEditing()) commitInlineEdit()
    assertSpaced([one, two, three])
    assert.eq(getUndoHistory().length, 3, 'one undo step each')
    reset()
  })

  it('quick create keeps siblings CARD_GAP apart', () => {
    reset()
    block('a', 'goal', 0, 0)
    const made = [0, 1, 2].map(() => createConnected('a', 'requirement', { edit: false }))
    assertSpaced(made, ['a'])
    reset()
  })

  it('quick create on a side crowded past the slide still lands near, on a free slot', () => {
    reset()
    block('a', 'goal', 0, 0)
    // A column of cards down the right side, longer than the slide reaches.
    const wall = []
    for (let i = 0; i < 52; i++) { block('w' + i, 'context', W + 80, i * 100); wall.push('w' + i) }
    assert.eq(occupiedRects(['a']).length, 52)
    const id = createConnected('a', 'requirement', { edit: false })
    assertSpaced([id], ['a', ...wall])
    const b = state.blocks[id]
    assert.ok(Math.hypot(b.x, b.y) < 600, `near its source, at ${b.x},${b.y}`)
    reset()
  })

  it('splitting a line between two close cards does not cover either', () => {
    reset()
    block('a', 'goal', 0, 0)
    block('b', 'output', W + 60, 0)
    state.arrows.push({ id: 'ab', from: 'a', to: 'b', style: 'straight', fromPort: null, toPort: null })
    const id = insertOnArrow('ab', 'process')
    if (isInlineEditing()) commitInlineEdit()
    assertSpaced([id], ['a', 'b'])
    assert.eq(getUndoHistory().length, 1)
    reset()
  })
})

// ── A patch's new blocks ─────────────────────────────────────

describe('braindump: a patch places new blocks beside what they connect to', () => {
  function seed() {
    reset()
    block('goal', 'goal', 0, 0, { title: 'Move sign-in' })
    block('req', 'requirement', 300, 0, { title: 'Sessions survive' })
    block('risk', 'risk', 600, 0, { title: 'Provider outage' })
  }

  it('right of a block that points at it, left of one it points at, never on a card', () => {
    seed()
    const plan = buildPlan({ format: 'pathfinder-patch', blocks: [
      { id: 'n1', type: 'implementation', title: 'Feature flag' },
      { id: 'n2', type: 'metric', title: 'Login success rate' },
    ], arrows: [{ from: 'req', to: 'n1' }, { from: 'n2', to: 'goal' }] })
    assert.eq(applyPlan(plan), 4)
    const n1 = Object.values(state.blocks).find(b => b.title === 'Feature flag')
    const n2 = Object.values(state.blocks).find(b => b.title === 'Login success rate')
    assert.gt(n1.x, state.blocks.req.x, 'right of the requirement that points at it')
    assert.lt(n2.x, state.blocks.goal.x, 'left of the goal it points at')
    assertSpaced([n1.id, n2.id], ['goal', 'req', 'risk'])
    assert.eq(getUndoHistory().length, 1)
    reset()
  })

  it('a chain grows out from the map: a block linked to a new block sits beside it', () => {
    seed()
    const plan = buildPlan({ format: 'pathfinder-patch', blocks: [
      { id: 'b2', type: 'decision', title: 'Second' },
      { id: 'b1', type: 'implementation', title: 'First' },
    ], arrows: [{ from: 'b1', to: 'b2' }, { from: 'risk', to: 'b1' }] })
    applyPlan(plan)
    const first = Object.values(state.blocks).find(b => b.title === 'First')
    const second = Object.values(state.blocks).find(b => b.title === 'Second')
    assert.gt(first.x, state.blocks.risk.x)
    assert.gt(second.x, first.x, 'placed after the block it waits on')
    assert.ok(Math.abs(second.y - first.y) < 400, 'near it, not at the top of the map edge')
    assertSpaced([first.id, second.id], ['goal', 'req', 'risk'])
    reset()
  })

  it('unconnected findings stack right of the map; given coordinates are kept', () => {
    seed()
    const plan = buildPlan({ format: 'pathfinder-patch', blocks: [
      { id: 'u1', type: 'question', title: 'Loose one' },
      { id: 'u2', type: 'question', title: 'Loose two' },
      { id: 'u3', type: 'context', title: 'Placed', x: -900, y: 700 },
    ] })
    applyPlan(plan)
    const [u1, u2, u3] = ['Loose one', 'Loose two', 'Placed'].map(t => Object.values(state.blocks).find(b => b.title === t))
    assert.gt(u1.x, state.blocks.risk.x + W)
    assert.gt(u2.x, state.blocks.risk.x + W)
    assertSpaced([u1.id, u2.id], ['goal', 'req', 'risk'])
    assert.deepEq([u3.x, u3.y], [-900, 700])
    reset()
  })

  it('a block linked to a new block with coordinates sits beside that block', () => {
    seed()
    const plan = buildPlan({ format: 'pathfinder-patch', blocks: [
      { id: 'n3', type: 'decision', title: 'Placed decision', x: 900, y: 40 },
      { id: 'n4', type: 'requirement', title: 'Follows from it' },
    ], arrows: [{ from: 'n3', to: 'n4' }] })
    applyPlan(plan)
    const n3 = Object.values(state.blocks).find(b => b.title === 'Placed decision')
    const n4 = Object.values(state.blocks).find(b => b.title === 'Follows from it')
    assert.deepEq([n3.x, n3.y], [900, 40])
    assert.gt(n4.x, n3.x + W - 1, 'right of the decision that points at it')
    assert.ok(Math.abs(n4.y - n3.y) < 200, `level with it (${n4.y})`)
    assert.ok(n4.x < 900 + W + 300, `not out past the map (${n4.x})`)
    assertSpaced([n3.id, n4.id], ['goal', 'req', 'risk'])
    reset()
  })

  it('a new block with one coordinate keeps it when that spot is free', () => {
    seed()
    applyPlan(buildPlan({ format: 'pathfinder-patch', blocks: [
      { id: 'x1', type: 'context', title: 'Only x', x: -700 },
      { id: 'y1', type: 'context', title: 'Only y', y: 900 },
    ] }))
    const onlyX = Object.values(state.blocks).find(b => b.title === 'Only x')
    const onlyY = Object.values(state.blocks).find(b => b.title === 'Only y')
    assert.eq(onlyX.x, -700)
    assert.eq(onlyY.y, 900)
    assertSpaced([onlyX.id, onlyY.id], ['goal', 'req', 'risk'])
    reset()
  })

  it('placeNewBlocks is usable on its own and keeps its own placements apart', () => {
    reset()
    block('a', 'goal', 0, 0)
    const at = placeNewBlocks([
      { key: 'p', anchors: [{ id: 'a', side: 'right' }] },
      { key: 'q', anchors: [{ id: 'a', side: 'right' }] },
      { key: 'r', anchors: [{ id: 'p', side: 'right' }] },
    ])
    const rs = ['p', 'q', 'r'].map(k => ({ ...at.get(k), w: W, h: H }))
    assert.deepEq(at.get('p'), { x: W + 80, y: 0 })
    assert.ok(clearance(rs[0], rs[1]) >= CARD_GAP)
    assert.eq(rs[2].x, rs[0].x + W + 80)
    reset()
  })
})

// ── Tidy's fallback ──────────────────────────────────────────

describe('braindump: Tidy lays the unconnected blocks out in step columns', () => {
  it('connectedIds: the blocks a line touches', () => {
    assert.deepEq([...connectedIds(['a', 'b', 'c'], [])], [])
    assert.deepEq([...connectedIds(['a', 'b', 'c'], [{ from: 'a', to: 'b' }])].sort(), ['a', 'b'])
    assert.deepEq([...connectedIds(['a', 'b', 'c'], [{ from: 'a', to: 'a' }])], [], 'a self-loop connects nothing')
    assert.deepEq([...connectedIds(['a', 'b', 'c'], [{ from: 'a', to: 'zz' }])], [], 'a line to nowhere connects nothing')
  })

  it('arranges a loose map by step in one undo step, keeping each column in reading order', () => {
    reset()
    block('r', 'risk', 0, 0); block('g2', 'goal', 0, 900); block('g1', 'goal', 50, 300)
    block('m', 'metric', 900, 0); block('i', 'implementation', 300, 600)
    const before = dump()
    const res = tidyCanvas({ direction: 'LR' })
    assert.eq(res.mode, 'steps')
    assert.eq(res.crossings, 0)
    const b = state.blocks
    assert.eq(b.g1.x, b.g2.x, 'one Why column')
    assert.lt(b.g1.y, b.g2.y, 'in the order they read before')
    assert.ok(b.g1.x < b.m.x && b.m.x < b.i.x && b.i.x < b.r.x, 'Why, Proof, How, Doubt')
    assert.eq(Math.min(...Object.values(b).map(x => x.x)), 0, 'anchored where the map was')
    assertSpaced(Object.keys(b))
    assert.eq(getUndoHistory().length, 1)
    undo()
    assert.eq(dump(), before)
    reset()
  })

  it('with no connections, releases the pins Tidy or an import wrote, never a hand pin', () => {
    reset()
    ;['a', 'b', 'c', 'd', 'e'].forEach((id, i) => block(id, 'goal', i * 300, 0))
    state.arrows.push({ id: 't', from: 'a', to: 'a', fromPort: 'right', toPort: 'left', portsBy: 'tidy' })
    assert.eq(tidyCanvas({ direction: 'LR' }).mode, 'steps')
    assert.deepEq([state.arrows[0].fromPort, state.arrows[0].toPort, state.arrows[0].portsBy], [null, null, undefined])
    reset()
    ;['a', 'b', 'c', 'd', 'e'].forEach((id, i) => block(id, 'goal', i * 300, 0))
    state.arrows.push({ id: 'h', from: 'a', to: 'a', fromPort: 'top', toPort: 'top' })
    tidyCanvas({ direction: 'LR' })
    assert.deepEq([state.arrows[0].fromPort, state.arrows[0].toPort], ['top', 'top'])
    reset()
  })

  // The Risk Review template (four blocks, three lines) plus ten pasted lines.
  function riskReviewPlusNotes() {
    reset()
    block('top', 'risk', 0, 0); block('asm', 'assumption', 0, 150)
    block('mit', 'decision', 300, 0); block('req', 'requirement', 600, 0)
    state.arrows.push({ id: 'a1', from: 'asm', to: 'top', style: 'routed' }, { id: 'a2', from: 'top', to: 'mit', style: 'routed' },
      { id: 'a3', from: 'mit', to: 'req', style: 'routed' })
    ;['goal', 'stakeholder', 'metric', 'requirement', 'implementation', 'implementation', 'risk', 'question', 'context', 'output']
      .forEach((type, i) => block('n' + i, type, 100 + (i % 5) * 260, 400 + Math.floor(i / 5) * 160))
  }
  const flowIds = ['top', 'asm', 'mit', 'req']
  const noteIds = Array.from({ length: 10 }, (_, i) => 'n' + i)

  it('a half-wired map keeps its flow running with the lines and puts the loose cards in step columns below', () => {
    riskReviewPlusNotes()
    const before = dump()
    const res = tidyCanvas({ direction: 'LR' })
    assert.neq(res.mode, 'steps')
    assert.eq(res.loose, 10)
    const b = state.blocks
    assert.ok(b.asm.x < b.top.x && b.top.x < b.mit.x && b.mit.x < b.req.x, 'the flow reads along its lines, not by step')
    const flowBottom = Math.max(...flowIds.map(id => b[id].y + H))
    noteIds.forEach(id => assert.gt(b[id].y, flowBottom, `${id} sits under the flow`))
    const xOf = id => b[id].x
    assert.ok(xOf('n0') < xOf('n1') && xOf('n1') < xOf('n2') && xOf('n2') < xOf('n3') && xOf('n3') < xOf('n4'),
      'Why, Who, Proof, What, How')
    assert.eq(Math.min(...flowIds.map(xOf)), Math.min(...noteIds.map(xOf)), 'the columns line up with the flow')
    assertSpaced([...flowIds, ...noteIds])
    assert.ok(state.arrows.every(a => a.portsBy === 'tidy'), 'the flow\'s lines still point along it')
    assert.eq(getUndoHistory().length, 1)
    undo()
    assert.eq(dump(), before)
    reset()
  })

  it('top to bottom, the loose cards go beside the flow', () => {
    riskReviewPlusNotes()
    tidyCanvas({ direction: 'TB' })
    const b = state.blocks
    const flowRight = Math.max(...flowIds.map(id => b[id].x + W))
    noteIds.forEach(id => assert.gt(b[id].x, flowRight, `${id} sits right of the flow`))
    assertSpaced([...flowIds, ...noteIds])
    reset()
  })

  it('a connected map still gets the layered layout', () => {
    reset()
    block('a', 'goal', 0, 0); block('b', 'requirement', 0, 300); block('c', 'implementation', 0, 600)
    state.arrows.push({ id: 'x', from: 'a', to: 'b', style: 'routed' }, { id: 'y', from: 'b', to: 'c', style: 'routed' })
    const res = tidyCanvas({ direction: 'LR' })
    assert.neq(res.mode, 'steps')
    assert.eq(state.arrows[0].portsBy, 'tidy')
    reset()
  })

  it('the toast names the columns and why, and the undo key of this platform', () => {
    assert.eq(tidySummary({ moved: 4, crossings: 0, mode: 'steps' }, 6, 'LR', 'Ctrl+Z'),
      'Arranged 6 blocks in step columns, since none are connected. Undo with Ctrl+Z')
    assert.includes(tidySummary({ moved: 4, crossings: 0, mode: 'steps' }, 6, 'TB'), 'step rows')
    assert.includes(tidySummary({ moved: 4, crossings: 0, underCards: 1, mode: 'steps' }, 6, 'LR'), '1 line under a card')
    assert.eq(tidySummary({ moved: 0, crossings: 0, mode: 'steps' }, 6, 'LR'), 'Already arranged')
    assert.eq(tidySummary({ moved: 9, crossings: 1, loose: 10 }, 14, 'LR', 'Cmd+Z'),
      'Arranged 14 blocks left to right, 1 crossing, 10 unconnected in step columns below. Undo with Cmd+Z')
    assert.includes(tidySummary({ moved: 9, crossings: 0, loose: 2 }, 6, 'TB', 'Cmd+Z'), '2 unconnected in step rows beside it')
    const mac = /mac|iphone|ipad|ipod/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '')
    assert.ok(tidySummary({ moved: 1, crossings: 0 }, 2, 'LR').endsWith(mac ? 'Cmd+Z' : 'Ctrl+Z'), 'the default follows the platform')
  })
})
