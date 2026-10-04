// ============================================================
//  roundtrip.test.js: the ROUNDTRIP stream (design round, wave 2).
//  The hand-off must never write falsehoods:
//  1. an Open Question card can be answered (patch and inspector), the
//     prompt prints its answer as an answer, and refusals name titles;
//  2. a refuted assumption never becomes a decision stating the claim;
//  3. an unlabelled arrow at a goal, stakeholder, metric, risk, resource
//     or context adds no task order, and risks travel with their
//     mitigations, in the brief and in the task plan.
//  The map in the middle is the persona map from the usability study
//  (D-usability.md, Priya), rebuilt with generic titles, and the patch
//  is the reply that study pasted back.
// ============================================================

import { describe, it, assert, mockBlockEl, mockGapIconEl, cleanupMockEls } from './test-utils.js'
import { state, ui, devOpts, canvasMeta, selection, getUndoHistory, getRedoFuture, resetSnapshotToken,
         serializeCanvas } from '../js/state.js'
import { $, TYPES, STATUS_DEFS, SITUATION_DEFAULT } from '../js/utils.js'
import { extractPatch, buildPlan, applyPlan, previewPlan, explainRef } from '../js/patch.js'
import { normalizeBlock, normalizeCanvas } from '../js/normalize.js'
import { generatePrompt, markExported, getPromptDiff } from '../js/prompt.js'
import { taskChecklist, buildTaskPlan, cardAnswer, mitigationIndex } from '../js/task-plan.js'
import { relationOf, relationHint, dependencyEdges, mitigationPairs, impliedVerb, RELATIONS } from '../js/relations.js'
import { detectGaps } from '../js/gaps.js'
import { TEMPLATES } from '../js/templates.js'
import { renderBlock, selectBlock, deselectAll, undo } from '../js/render.js'
import { setupInspectorEvents } from '../js/inspector.js'
import { closeMenus } from '../js/menu.js'
import { buildSpecFiles } from '../js/spec-export.js'
import { buildMarkdown, buildMeetingSummary } from '../js/export.js'
import { toJsonCanvas, fromJsonCanvas } from '../js/interop.js'
import { searchBlocks } from '../js/search.js'
import { setupContextMenu } from '../js/context-menu.js'

const byId = id => document.getElementById(id)

function reset() {
  cleanupMockEls()
  state.blocks = {}; state.arrows = []; state.groups = {}
  ui.readOnly = false
  devOpts.mode = 'plan'; devOpts.tone = 'auto'; devOpts.detail = 'standard'; devOpts.prePrompts = new Set()
  canvasMeta.title = ''; canvasMeta.contextBrief = ''
  canvasMeta.situation = { ...SITUATION_DEFAULT }
  ui.promptDirty = true
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
}

function add(id, type, title, extra = {}) {
  state.blocks[id] = { id, type, title, description: '', notes: '', x: 0, y: 0, actions: [], questions: [],
    criteria: [], rationale: '', docRef: null, width: null, color: null, collapsed: false, groupId: null,
    status: null, priority: null, ...extra }
  mockBlockEl(id); mockGapIconEl(id)
  return state.blocks[id]
}
const link = (from, to, extra = {}) => state.arrows.push({ id: `a-${from}-${to}`, from, to, ...extra })

// The persona map: a sign-in migration, fifteen cards, every arrow unlabelled.
function seedPersonaMap() {
  reset()
  add('goal', 'goal', 'Move sign-in to an external provider')
  add('metric', 'metric', 'Login success rate stays at 99.5%', { criteria: ['At or above 99.5% every hour'] })
  add('support', 'stakeholder', 'Support team')
  add('security', 'stakeholder', 'Security reviewer')
  add('sessions', 'requirement', 'Existing sessions survive the cutover', { criteria: ['No forced logout'] })
  add('mapping', 'requirement', 'Every account maps to one provider identity', { criteria: ['Zero unmatched accounts'] })
  add('rollback', 'requirement', 'Roll back to local passwords within 15 minutes', { criteria: ['Flag flips back without a deploy'] })
  add('client', 'implementation', 'Add the provider client and callback route')
  add('migrate', 'implementation', 'Write the account-linking migration script')
  add('flag', 'implementation', 'Put provider login behind a feature flag')
  add('cleanup', 'implementation', 'Remove local password hashes after cutover')
  add('outage', 'risk', 'Provider outage locks every user out')
  add('mismatch', 'risk', 'Email mismatch links the wrong person')
  add('lifetime', 'assumption', 'Provider token lifetime can match our sessions',
    { actions: ['validate'], description: 'Our sessions last 30 days; the provider should allow the same.' })
  add('service', 'question', 'Do service accounts go through the provider too?')
  ;[['goal', 'sessions'], ['goal', 'mapping'], ['goal', 'rollback'], ['client', 'sessions'], ['migrate', 'mapping'],
    ['flag', 'rollback'], ['outage', 'flag'], ['mismatch', 'migrate'], ['lifetime', 'sessions'], ['service', 'client'],
    ['support', 'metric'], ['security', 'mapping'], ['metric', 'goal'], ['cleanup', 'goal'], ['client', 'metric'],
  ].forEach(([f, t]) => link(f, t))
}

// The reply the usability study pasted back (reply-priya.md), on this map's ids.
const PERSONA_REPLY = `I read the session, login and API key code first.

\`\`\`pathfinder-patch
${JSON.stringify({
  format: 'pathfinder-patch', version: 1,
  note: 'Assumption refuted (24h token cap), question answered, refresh-token work added',
  answers: [{ block: 'service', answer: 'No. Service accounts use API keys checked in middleware and never reach the login form.' }],
  verify: [{ block: 'lifetime', verdict: 'refuted', evidence: 'The provider caps access tokens at 24h; our sessions last 30 days.' }],
  status: [{ block: 'migrate', status: 'in-progress' }],
  criteria: [{ block: 'cleanup', add: ['Runs only after 30 days with zero rollbacks'] }],
  notes: [{ block: 'flag', note: 'Default to local login in staging until the drill passes' }],
  blocks: [{ id: 'n1', type: 'implementation', title: 'Renew sessions through provider refresh tokens' },
           { id: 'n2', type: 'risk', title: 'Revoked refresh token logs users out mid-session' }],
  arrows: [{ from: 'n1', to: 'sessions', label: 'satisfies' }, { from: 'n2', to: 'n1', relation: 'informs' },
           { from: 'flag', to: 'cleanup', relation: 'precedes' }],
}, null, 2)}
\`\`\``

const section = (prompt, heading) => {
  const start = prompt.indexOf(`## ${heading}`)
  if (start < 0) return ''
  const end = prompt.indexOf('\n## ', start + 3)
  return prompt.slice(start, end < 0 ? undefined : end)
}
const taskEntry = (checklist, title) => {
  const start = checklist.indexOf(`] ${title}\n`)
  if (start < 0) return ''
  const next = checklist.indexOf('\n- [', start)
  return checklist.slice(start, next < 0 ? undefined : next)
}

// ── 1. Open Question cards ───────────────────────────────────

describe('roundtrip: an Open Question card takes its answer from a patch', () => {
  it('an answers entry with only the card id writes the answer and marks the card done', () => {
    reset()
    add('q', 'question', 'Does it happen on staging?')
    const plan = buildPlan({ answers: [{ block: 'q', answer: '  Staging is clean.  ' }] })
    assert.eq(plan.ops.length, 1)
    assert.ok(plan.ops[0].ok, plan.ops[0].label)
    assert.eq(plan.ops[0].label, 'Answer "Does it happen on staging?" and mark it done')
    const [row] = previewPlan(plan)
    assert.eq(row.before, `Not answered\nStatus: ${STATUS_DEFS['not-started'].label}`)
    assert.eq(row.after, `Staging is clean.\nStatus: ${STATUS_DEFS.done.label}`)
    assert.eq(applyPlan(plan), 1)
    assert.eq(state.blocks.q.answer, 'Staging is clean.')
    assert.eq(state.blocks.q.status, 'done')
    assert.deepEq(state.blocks.q.questions, [], 'no questions[] entry was invented for it')
    assert.eq(getUndoHistory().length, 1, 'one undo step')
    undo()
    assert.eq(state.blocks.q.answer, undefined)
    assert.eq(state.blocks.q.status, null)
  })

  it('reads index 0 or the card title as the card itself, and a living question as that question', () => {
    reset()
    add('q', 'question', 'Which region?')
    assert.ok(buildPlan({ answers: [{ block: 'q', question: 0, answer: 'EU' }] }).ops[0].ok, 'index 0 on a card with no sub-questions')
    assert.ok(buildPlan({ answers: [{ block: 'q', question: 'which  REGION?', answer: 'EU' }] }).ops[0].ok, 'its own title')
    state.blocks.q.questions = [{ text: 'Who owns the data?' }]
    const living = buildPlan({ answers: [{ block: 'q', question: 'Who owns the data?', answer: 'Billing' }] })
    applyPlan(living)
    assert.eq(state.blocks.q.questions[0].answer, 'Billing')
    assert.eq(state.blocks.q.answer, undefined, 'a named sub-question does not answer the card')
    const card = buildPlan({ answers: [{ block: 'q', answer: 'EU' }] })
    applyPlan(card)
    assert.eq(state.blocks.q.answer, 'EU', 'omitted question on a card means the card, even with sub-questions')
  })

  it('replacing an answer says so, and a done card is not re-marked', () => {
    reset()
    add('q', 'question', 'When did it start?', { answer: 'Tuesday', status: 'done' })
    const plan = buildPlan({ answers: [{ block: 'q', answer: 'Monday night' }] })
    assert.eq(plan.ops[0].label, 'Replace the answer on "When did it start?"')
    applyPlan(plan)
    assert.eq(state.blocks.q.answer, 'Monday night')
  })

  it('refusals name the card by its title, never by its id', () => {
    reset()
    add('id7x2k', 'stakeholder', 'Support team')
    add('id8m3p', 'assumption', 'It started with the deploy')
    add('id9q4r', 'requirement', 'Checkout works', { questions: [{ text: 'Card?' }, { text: 'Wallet?' }] })
    add('idq5s6', 'question', 'Does staging fail?')
    add('idd1', 'decision', 'Move fast and fix later')
    add('idd2', 'decision', 'Move the queue')
    const plan = buildPlan({
      answers: [
        { block: 'id7x2k', answer: 'x' },
        { block: 'id8m3p', answer: 'x' },
        { block: 'id9q4r', answer: 'x' },
        { block: 'idq5s6', answer: '   ' },
        { block: 'id9q4r', question: 4, answer: 'x' },
        { block: 'id9q4r', question: 'Nothing like this', answer: 'x' },
        { block: 'ghost-id', answer: 'x' },
        { block: 'move', answer: 'x' },
      ],
      verify: [{ block: 'idd1', verdict: 'verified', evidence: 'e' }, { block: 'id8m3p', verdict: 'maybe', evidence: 'e' },
               { block: 'id8m3p', verdict: 'refuted', evidence: ' ' }],
      status: [{ block: 'id7x2k', status: 'finished' }],
      criteria: [{ block: 'id9q4r', add: [] }],
      notes: [{ block: 'id7x2k', note: ' ' }],
      arrows: [{ from: 'id7x2k', to: 'ghost-id' }, { from: 'id7x2k', to: 'id7x2k' }, { from: 'id7x2k' }],
    })
    const labels = plan.ops.map(o => o.label)
    assert.eq(plan.ops.filter(o => o.ok).length, 0, labels.join('\n'))
    ;['id7x2k', 'id8m3p', 'id9q4r', 'idq5s6', 'idd1'].forEach(id =>
      labels.forEach(l => assert.notIncludes(l, id, `no internal id in "${l}"`)))
    assert.includes(labels[0], '"Support team" has no question to answer')
    assert.includes(labels[1], '"It started with the deploy" is an assumption: send it under verify')
    assert.includes(labels[2], '"Checkout works" has 2 questions')
    assert.includes(labels[3], 'Empty answer for "Does staging fail?"')
    assert.includes(labels[4], '"Checkout works" has no question 4')
    assert.includes(labels[5], 'No question on "Checkout works" reads "Nothing like this"')
    assert.eq(labels[6], 'No card matches "ghost-id"', 'an unknown reference is quoted as given')
    assert.includes(labels[7], '"move" matches 2 cards ("Move fast and fix later", "Move the queue")')
    assert.includes(labels[8], '"Move fast and fix later" is not an assumption (it is a Decision)')
    assert.includes(labels[9], 'The verdict on "It started with the deploy"')
    assert.includes(labels[10], 'No evidence for "It started with the deploy"')
    assert.includes(labels[11], 'Unknown status "finished" for "Support team"; use not-started, in-progress, done, blocked')
    assert.includes(labels[12], 'No new criteria for "Checkout works"')
    assert.includes(labels[13], 'Empty note for "Support team"')
    assert.includes(labels[14], 'Cannot connect "Support team" → "ghost-id": No card matches "ghost-id"')
    assert.includes(labels[15], '"Support team" cannot connect to itself')
    assert.eq(labels[16], 'A connection needs both ends, "from" and "to"')
    assert.eq(applyPlan(plan), 0)
  })

  it('explainRef lists at most three of the matching titles', () => {
    reset()
    ;['Alpha one', 'Alpha two', 'Alpha three', 'Alpha four'].forEach((t, i) => add('x' + i, 'goal', t))
    assert.eq(explainRef('alpha'), '"alpha" matches 4 cards ("Alpha one", "Alpha two", "Alpha three", …); use the card\'s id')
    assert.eq(explainRef(''), 'No card given')
  })

  it('takes only text from a patch: an object never lands on a card as "[object Object]"', () => {
    reset()
    add('q', 'question', 'Region?')
    add('a', 'assumption', 'It is the deploy')
    add('r', 'requirement', 'Works', { questions: [{ text: 'Card?' }] })
    const plan = buildPlan({
      answers: [{ block: 'q', answer: { text: 'EU' } }, { block: 'r', question: { i: 0 }, answer: 'Visa' }, { block: 'q', answer: 42 }],
      verify: [{ block: 'a', verdict: 'refuted', evidence: ['log'] }, { block: 'a', verdict: 'refuted', evidence: 'Rolled back first.', decision: { x: 1 } }],
      notes: [{ block: 'r', note: { n: 1 } }],
      criteria: [{ block: 'r', add: [{ c: 1 }, 'Real one'] }],
    })
    const labels = plan.ops.map(o => `${o.ok ? 'ok' : 'no'}: ${o.label}`)
    // answers ×3, verify ×2, criteria, then notes: the order buildPlan reads them in.
    assert.deepEq(plan.ops.map(o => o.ok), [false, false, true, false, true, true, false], labels.join('\n'))
    assert.includes(labels[0], 'Empty answer for "Region?"')
    assert.includes(labels[1], '"question" on "Works" must be an index or the question\'s text')
    applyPlan(plan)
    assert.eq(state.blocks.q.answer, '42')
    assert.eq(state.blocks.a.title, 'Not true: It is the deploy', 'a decision that is not text falls back to the claim')
    assert.deepEq(state.blocks.r.criteria, ['Real one'])
    JSON.stringify(state.blocks).includes('[object Object]') && assert.ok(false, 'no "[object Object]" anywhere')
  })

  it('keeps a long answer whole and an emoji or right-to-left title intact in its label', () => {
    reset()
    add('q', 'question', 'هل يعمل؟ 🚦')
    const long = 'Evidence line. '.repeat(400).trim()
    const plan = buildPlan({ answers: [{ block: 'q', answer: long }] })
    assert.includes(plan.ops[0].label, '"هل يعمل؟ 🚦"')
    applyPlan(plan)
    assert.eq(state.blocks.q.answer, long)
  })
})

describe('roundtrip: the answer field is stored, carried and exported', () => {
  it('normalize keeps a non-empty answer on any type and writes nothing for an empty one', () => {
    assert.eq(normalizeBlock({ id: 'q', type: 'question', title: 'Q', answer: 'Yes' }).answer, 'Yes')
    assert.eq(normalizeBlock({ id: 'd', type: 'decision', title: 'D', answer: 'Kept' }).answer, 'Kept')
    assert.ok(!('answer' in normalizeBlock({ id: 'q', type: 'question', title: 'Q', answer: '  ' })))
    assert.ok(!('answer' in normalizeBlock({ id: 'q', type: 'question', title: 'Q' })), 'an old canvas serializes as before')
    assert.eq(normalizeBlock({ id: 'q', type: 'question', title: 'Q', answer: 42 }).answer, '42')
    const back = normalizeCanvas(JSON.parse(JSON.stringify({ blocks: [{ id: 'q', type: 'question', title: 'Q', answer: 'Line 1\nLine 2' }] })))
    assert.eq(back.blocks.q.answer, 'Line 1\nLine 2')
  })

  it('cardAnswer reads only a question card, trimmed', () => {
    assert.eq(cardAnswer({ type: 'question', answer: '  EU  ' }), 'EU')
    assert.eq(cardAnswer({ type: 'decision', answer: 'EU' }), '')
    assert.eq(cardAnswer({ type: 'question' }), '')
    assert.eq(cardAnswer(null), '')
  })

  it('the prompt prints an answered card under Answered Questions, never as an open question', () => {
    reset()
    add('q1', 'question', 'Do service accounts use the provider?', { answer: 'No, they use API keys.', status: 'done' })
    add('q2', 'question', 'Which region hosts the provider?')
    add('r', 'requirement', 'Checkout works', { questions: [{ text: 'Card?', answer: 'Visa only' }, { text: 'Wallet?' }] })
    ;['plan', 'investigate', 'explore', 'build', 'clarify'].forEach(mode => {
      devOpts.mode = mode
      const p = generatePrompt()
      const open = section(p, TYPES.question.section)
      const answered = section(p, 'Answered Questions')
      assert.includes(open, 'Which region hosts the provider?', mode)
      assert.notIncludes(open, 'Do service accounts use the provider?', `${mode}: the answered card is not listed as open`)
      assert.includes(answered, '• [DONE] Do service accounts use the provider?', mode)
      assert.includes(answered, '  Answer: No, they use API keys.', mode)
    })
    devOpts.mode = 'plan'
    const p = generatePrompt()
    assert.includes(p, '  Open questions:\n    - Wallet?')
    assert.includes(p, '  Answered questions:\n    - Card?\n      Answer: Visa only')
    assert.notIncludes(p, 'Open questions:\n    - Card?')
  })

  it('the reply section tells the assistant how to answer a card and how to refute', () => {
    reset()
    add('q', 'question', 'Q?')
    const reply = section(generatePrompt(), 'When you reply')
    assert.includes(reply, 'To answer an Open Question card, give its id and leave out "question".')
    assert.includes(reply, '"decision": the statement that is true instead')
  })

  it('answering a card counts as a change since the last export', () => {
    reset()
    add('q', 'question', 'Q?')
    markExported()
    state.blocks.q.answer = 'Yes'
    assert.deepEq(getPromptDiff().modified, ['Q?'])
    markExported()
  })

  it('a task waiting on a question card prints its answer, or flags that it has none', () => {
    reset()
    add('q', 'question', 'Which gateway?', { answer: 'The existing one.' })
    add('o', 'question', 'Which region?')
    add('w', 'implementation', 'Wire payments')
    link('q', 'w'); link('o', 'w')
    const out = taskChecklist(state.blocks, state.arrows)
    assert.includes(out, 'after: Which gateway?; Which region?')
    assert.includes(out, '      Answer to "Which gateway?": The existing one.')
    assert.includes(out, '      [NEEDS CLARIFICATION]: Which region?')
  })
})

// ── 2. Refuted assumptions ───────────────────────────────────

describe('roundtrip: a refuted assumption never becomes a decision that states the claim', () => {
  const seed = () => {
    reset()
    add('a', 'assumption', 'Tokens last as long as our sessions',
      { actions: ['validate', 'prepare'], description: 'Sessions are 30 days.', typeCheck: true, color: TYPES.assumption.color })
    add('r', 'requirement', 'Sessions survive')
    link('a', 'r')
  }

  it('without a decision text, the card reads "Not true: <claim>" and keeps the record in its rationale', () => {
    seed()
    const plan = buildPlan({ verify: [{ block: 'a', verdict: 'refuted', evidence: 'Capped at 24h by the provider.' }] })
    assert.match(plan.ops[0].label, /^Refuted: "Tokens last as long as our sessio…" becomes the decision "Not true: Tokens last as long as/)
    applyPlan(plan)
    const b = state.blocks.a
    assert.eq(b.type, 'decision')
    assert.eq(b.title, 'Not true: Tokens last as long as our sessions')
    assert.eq(b.description, '', 'the description argued for the false claim')
    assert.eq(b.rationale, 'Refuted: Capped at 24h by the provider.\nThe assumption was: Tokens last as long as our sessions\nSessions are 30 days.')
    assert.deepEq(b.actions, ['prepare'])
    assert.eq(b.typeCheck, undefined, 'the type check settled with the retype')
    assert.eq(b.color, null, 'a colour that was only the assumption colour goes')
    assert.eq(state.arrows[0].from, 'a', 'its arrows survive')
    assert.eq(getUndoHistory().length, 1)
  })

  it('with a decision text, that text is the title', () => {
    seed()
    applyPlan(buildPlan({ verify: [{ block: 'a', verdict: 'refuted', evidence: 'Capped at 24h.',
      decision: '  Renew sessions\n through refresh tokens ' }] }))
    assert.eq(state.blocks.a.title, 'Renew sessions through refresh tokens')
    assert.includes(state.blocks.a.rationale, 'The assumption was: Tokens last as long as our sessions')
  })

  it('a verified assumption keeps its claim, description and evidence', () => {
    seed()
    applyPlan(buildPlan({ verify: [{ block: 'a', verdict: 'verified', evidence: 'Config allows 30 days.', decision: 'Keep sessions' }] }))
    const b = state.blocks.a
    assert.eq(b.type, 'decision')
    assert.eq(b.title, 'Tokens last as long as our sessions')
    assert.eq(b.description, 'Sessions are 30 days.')
    assert.eq(b.rationale, 'Verified: Config allows 30 days.\nDecision: Keep sessions')
  })

  it('an earlier rationale is kept under the new one, and undo restores the assumption whole', () => {
    seed()
    state.blocks.a.rationale = 'Chosen by the platform team.'
    const before = JSON.stringify(state.blocks.a)
    applyPlan(buildPlan({ verify: [{ block: 'a', verdict: 'refuted', evidence: 'No.' }] }))
    assert.match(state.blocks.a.rationale, /\nChosen by the platform team\.$/)
    undo()
    assert.eq(JSON.stringify(state.blocks.a), before)
  })

  it('the brief never prints the refuted claim as a decision', () => {
    seed()
    applyPlan(buildPlan({ verify: [{ block: 'a', verdict: 'refuted', evidence: 'Capped at 24h.' }] }))
    ui.promptDirty = true
    const decisions = section(generatePrompt(), TYPES.decision.section)
    assert.includes(decisions, '• Not true: Tokens last as long as our sessions')
    assert.notIncludes(decisions, '• Tokens last as long as our sessions')
    assert.includes(decisions, 'Rationale: Refuted: Capped at 24h.')
  })
})

// ── 3. Relations from endpoint types ─────────────────────────

const NON_ORDERING = ['goal', 'stakeholder', 'metric', 'risk', 'resource', 'context']

describe('roundtrip: unlabelled arrows take their meaning from the endpoint types', () => {
  it('every one of the 256 type pairs: order only between ordering types', () => {
    const ids = Object.keys(TYPES)
    ids.forEach(from => ids.forEach(to => {
      const blocks = { f: { id: 'f', type: from }, t: { id: 't', type: to } }
      const rel = relationOf({ from: 'f', to: 't' }, blocks)
      const quiet = NON_ORDERING.includes(from) || NON_ORDERING.includes(to)
      const want = !quiet ? 'precedes' : (from === 'risk' || to === 'risk') ? 'related' : 'informs'
      assert.eq(rel, want, `${from} → ${to}`)
      assert.eq(dependencyEdges(blocks, [{ from: 'f', to: 't' }]).length, quiet ? 0 : 1, `${from} → ${to} edges`)
    }))
  })

  it('an explicit relation and a known label win on every pair, and unknown labels keep the drawn order', () => {
    const ids = Object.keys(TYPES)
    ids.forEach(from => ids.forEach(to => {
      const blocks = { f: { id: 'f', type: from }, t: { id: 't', type: to } }
      Object.keys(RELATIONS).forEach(rel => assert.eq(relationOf({ from: 'f', to: 't', relation: rel }, blocks), rel))
      assert.eq(relationOf({ from: 'f', to: 't', label: 'requires' }, blocks), 'depends-on')
      assert.eq(relationOf({ from: 'f', to: 't', label: 'mitigates' }, blocks), 'informs')
      assert.eq(relationOf({ from: 'f', to: 't', label: 'feeds' }, blocks), 'precedes', `${from} → ${to} "feeds"`)
    }))
  })

  it('without the blocks nothing is derived, as before', () => {
    assert.eq(relationOf({ from: 'a', to: 'b' }), 'precedes')
  })

  it('writing out the implied verb means what the unlabelled arrow means', () => {
    const blocks = { k: { id: 'k', type: 'risk' }, i: { id: 'i', type: 'implementation' }, s: { id: 's', type: 'stakeholder' } }
    assert.eq(relationOf({ from: 'k', to: 'i', label: impliedVerb('risk', 'implementation') }, blocks), 'related')
    assert.eq(relationOf({ from: 'i', to: 's', label: 'owns' }, blocks), 'informs')
  })

  it('a risk implies "mitigated by" toward the work that answers it, and nothing the other way', () => {
    ;['decision', 'implementation', 'requirement', 'process'].forEach(t => {
      assert.eq(impliedVerb('risk', t), 'mitigated by', t)
      assert.eq(impliedVerb(t, 'risk'), '', t + ' → risk')
    })
    assert.eq(impliedVerb('risk', 'goal'), '')
  })

  it('a risk drawn to a deliverable or a system implies nothing: that is as often the thing at risk', () => {
    ;['output', 'resource'].forEach(t => {
      assert.eq(impliedVerb('risk', t), '', 'risk → ' + t)
      const blocks = { k: { id: 'k', type: 'risk' }, t: { id: 't', type: t } }
      assert.eq(relationOf({ from: 'k', to: 't' }, blocks), 'related', 'still no order')
      assert.deepEq(mitigationPairs(blocks, [{ from: 'k', to: 't' }]), [], 'and no mitigation')
    })
  })
})

describe('roundtrip: mitigations are read from the drawing', () => {
  const blocks = {
    k: { id: 'k', type: 'risk', title: 'Outage' }, i: { id: 'i', type: 'implementation', title: 'Flag' },
    d: { id: 'd', type: 'decision', title: 'Fallback' }, g: { id: 'g', type: 'goal', title: 'Goal' },
    w: { id: 'w', type: 'implementation', title: 'Runbook work' }, z: { id: 'z', type: 'implementation', title: 'Cleanup' },
  }
  it('counts the risk pointing at its answer, and "mitigates" pointing at the risk, once each', () => {
    const pairs = mitigationPairs(blocks, [
      { from: 'k', to: 'i' },                            // unlabelled, the pair implies it
      { from: 'k', to: 'i', relation: 'informs' },        // the same pair again
      { from: 'k', to: 'd', label: 'Mitigated by: fallback' },
      { from: 'w', to: 'k', label: 'mitigates' },
      { from: 'z', to: 'k' },                            // work leading to a risk is not a mitigation
      { from: 'k', to: 'g' },                            // a risk threatens a goal, it is not mitigated by it
      { from: 'k', to: 'z', relation: 'precedes' },       // an explicit order is not a mitigation
      { from: 'k', to: 'gone' },
    ])
    assert.deepEq(pairs, [{ risk: 'k', by: 'i', implied: true }, { risk: 'k', by: 'd' }, { risk: 'k', by: 'w' }])
    const { byRisk, byBlock } = mitigationIndex(blocks, [{ from: 'k', to: 'i' }, { from: 'w', to: 'k', label: 'mitigates' }])
    assert.deepEq(byRisk.get('k'), [{ id: 'i', implied: true }, { id: 'w', implied: false }])
    assert.deepEq(byBlock.get('i'), [{ id: 'k', implied: true }])
  })
  it('an unlabelled arrow is only an implied mitigation, and a set relation is none', () => {
    assert.deepEq(mitigationPairs(blocks, [{ from: 'k', to: 'i', relation: 'informs' }]), [], 'informs is not "mitigated by"')
    assert.deepEq(mitigationPairs(blocks, [{ from: 'k', to: 'i', relation: 'related' }]), [], 'nor is related')
    assert.deepEq(mitigationPairs(blocks, [{ from: 'k', to: 'i' }]), [{ risk: 'k', by: 'i', implied: true }])
    // The author's label wins over the same pair implied, whichever comes first.
    assert.deepEq(mitigationPairs(blocks, [{ from: 'k', to: 'i' }, { from: 'k', to: 'i', label: 'mitigated by' }]), [{ risk: 'k', by: 'i' }])
    assert.deepEq(mitigationPairs(blocks, [{ from: 'i', to: 'k', label: 'guards' }, { from: 'k', to: 'i' }]), [{ risk: 'k', by: 'i' }])
  })
  it('a mitigation written in other words at a risk sets no order; the same words elsewhere keep theirs', () => {
    const B = { ...blocks, r: { id: 'r', type: 'requirement', title: 'A failing test' } }
    assert.eq(relationOf({ from: 'k', to: 'r', label: 'guarded by' }, B), 'related')
    assert.eq(relationOf({ from: 'r', to: 'k', label: 'Guards against: retries' }, B), 'related')
    assert.eq(relationOf({ from: 'i', to: 'r', label: 'handles' }, B), 'precedes', 'no risk, no change')
    assert.eq(relationOf({ from: 'k', to: 'r', label: 'caused by' }, B), 'precedes', 'not a mitigation verb')
    assert.eq(relationOf({ from: 'k', to: 'r', label: 'guarded by', relation: 'precedes' }, B), 'precedes', 'an explicit relation wins')
    assert.deepEq(mitigationPairs(B, [{ from: 'k', to: 'r', label: 'guarded by' }, { from: 'w', to: 'k', label: 'prevents' },
      { from: 'k', to: 'z', label: 'caused by' }]), [{ risk: 'k', by: 'r' }, { risk: 'k', by: 'w' }])
  })
  it('the connection hint says the mitigation, whether it is implied, and that it adds no order', () => {
    assert.eq(relationHint({ from: 'k', to: 'i', label: 'mitigated by' }, blocks), '“Flag” mitigates “Outage”. It adds no task order.')
    assert.eq(relationHint({ from: 'k', to: 'i' }, blocks),
      'Implied: “Flag” mitigates “Outage”. Label it “mitigated by” to confirm. It adds no task order.')
    assert.eq(relationHint({ from: 'k', to: 'i', relation: 'informs' }, blocks), 'Provides context without changing task order.')
    assert.eq(relationHint({ from: 'g', to: 'i' }, blocks), 'Provides context without changing task order.')
    assert.eq(relationHint({ from: 'i', to: 'w' }, blocks), '“Flag” comes before “Runbook work” in the task plan.')
  })
})

describe('roundtrip: the persona map hands over a true order', () => {
  it('a mitigation never prints "after: <risk>"; it prints what it mitigates', () => {
    seedPersonaMap()
    const out = taskChecklist(state.blocks, state.arrows)
    const flag = taskEntry(out, 'Put provider login behind a feature flag')
    assert.ok(flag, out)
    assert.notIncludes(flag, 'after: Provider outage')
    // Every arrow on this map is unlabelled, so each mitigation is the
    // tool's reading of the types and is printed as one, never as fact.
    assert.includes(flag, 'mitigates (implied by an unlabelled arrow): Provider outage locks every user out (outage)')
    assert.notIncludes(out, '      mitigates: ')
    assert.includes(taskEntry(out, 'Write the account-linking migration script'),
      'mitigates (implied by an unlabelled arrow): Email mismatch links the wrong person (mismatch)')
  })

  it('labelling the arrow states the mitigation', () => {
    seedPersonaMap()
    state.arrows.find(a => a.from === 'outage').label = 'mitigated by'
    const out = taskChecklist(state.blocks, state.arrows)
    assert.includes(taskEntry(out, 'Put provider login behind a feature flag'), '      mitigates: Provider outage locks every user out (outage)')
    devOpts.mode = 'build'
    const risks = section(generatePrompt(), TYPES.risk.section)
    assert.includes(risks, '• Provider outage locks every user out\n  Mitigated by: Put provider login behind a feature flag (Implementation)\n')
    devOpts.mode = 'plan'
  })

  it('no task is ordered after the goal, and the cleanup wired only to its goal is not first', () => {
    seedPersonaMap()
    const out = taskChecklist(state.blocks, state.arrows)
    assert.notIncludes(out, 'after: Move sign-in to an external provider')
    const { tasks, unordered } = buildTaskPlan(state.blocks, state.arrows)
    assert.neq(tasks[0].id, 'cleanup')
    assert.deepEq([...unordered], ['cleanup'])
    assert.eq(tasks.at(-1).id, 'cleanup')
    // The cleanup is connected (to its goal); what it lacks is an order.
    const note = out.indexOf('Not ordered by the map: no connection sets an order for these tasks, so they sit after the tasks above')
    assert.notIncludes(out, 'nothing connects')
    assert.ok(note > 0, out)
    assert.lt(note, out.indexOf('Remove local password hashes after cutover'))
    // The dependency-shaped pairs keep their order.
    assert.includes(taskEntry(out, 'Existing sessions survive the cutover'), 'after: Add the provider client and callback route; Provider token lifetime can match our sessions')
    assert.includes(taskEntry(out, 'Add the provider client and callback route'), 'after: Do service accounts go through the provider too?')
    const order = tasks.map(b => b.id)
    assert.lt(order.indexOf('flag'), order.indexOf('rollback'))
    assert.lt(order.indexOf('client'), order.indexOf('sessions'))
  })

  it('the brief prints each risk with its mitigations, the guessed ones as implied', () => {
    seedPersonaMap()
    devOpts.mode = 'build'
    const p = generatePrompt()
    const risks = section(p, TYPES.risk.section)
    assert.includes(risks, '• Provider outage locks every user out\n  Mitigated by (implied by an unlabelled arrow): Put provider login behind a feature flag (Implementation)')
    assert.includes(risks, '• Email mismatch links the wrong person\n  Mitigated by (implied by an unlabelled arrow): Write the account-linking migration script (Implementation)')
    assert.notIncludes(risks, '  Mitigated by: ', 'no risk is handed over as covered on a guess')
    // The connection list says the same thing: implied, not stated.
    assert.includes(section(p, 'Connections'), 'Risk "Provider outage locks every user out" [implied: mitigated by] → Implementation')
    devOpts.mode = 'plan'
  })

  it('an explicit order after a risk still orders, and a labelled order is untouched', () => {
    seedPersonaMap()
    state.arrows.find(a => a.from === 'outage').relation = 'precedes'
    state.arrows.find(a => a.from === 'cleanup').label = 'follows'
    const out = taskChecklist(state.blocks, state.arrows)
    assert.includes(taskEntry(out, 'Put provider login behind a feature flag'), 'after: Provider outage locks every user out')
    assert.notIncludes(out, 'Not ordered by the map', 'the labelled arrow orders the cleanup again')
  })

  it('the reply the study pasted back applies in full: 10 of 10 operations', () => {
    seedPersonaMap()
    const { patch, error } = extractPatch(PERSONA_REPLY)
    assert.eq(error, undefined)
    const plan = buildPlan(patch)
    assert.deepEq(plan.ops.filter(o => !o.ok).map(o => o.label), [], 'nothing refused')
    assert.eq(applyPlan(plan), 10)
    assert.eq(getUndoHistory().length, 1)
    assert.eq(state.blocks.service.answer, 'No. Service accounts use API keys checked in middleware and never reach the login form.')
    assert.eq(state.blocks.service.status, 'done')
    assert.eq(state.blocks.lifetime.title, 'Not true: Provider token lifetime can match our sessions')
    devOpts.mode = 'build'
    ui.promptDirty = true
    const p = generatePrompt()
    assert.includes(section(p, 'Answered Questions'), 'Answer: No. Service accounts use API keys')
    assert.notIncludes(section(p, TYPES.question.section), 'Do service accounts')
    const out = section(p, 'Implementation checklist')
    assert.notIncludes(out, 'Not ordered by the map', 'the reply ordered the cleanup after the flag')
    assert.includes(taskEntry(out, 'Remove local password hashes after cutover'), 'after: Put provider login behind a feature flag')
    assert.includes(out, '      Answer to "Do service accounts go through the provider too?": No. Service accounts')
    // The reply says the refresh-token work brings this risk, and draws
    // risk -> work with relation "informs". That is not a mitigation, so the
    // brief must not hand the risk over as covered by the work causing it.
    const newRisk = Object.values(state.blocks).find(b => b.title.startsWith('Revoked refresh token'))
    const renew = Object.values(state.blocks).find(b => b.title.startsWith('Renew sessions'))
    const riskSection = section(p, TYPES.risk.section)
    const entry = riskSection.slice(riskSection.indexOf(`• ${newRisk.title}`)).split('\n• ')[0]
    assert.ok(entry.startsWith(`• ${newRisk.title}`), riskSection)
    assert.notIncludes(entry, 'Mitigated by', 'the new risk is not mitigated by the work that introduces it')
    assert.notIncludes(taskEntry(out, renew.title), 'mitigates')
    assert.deepEq(mitigationPairs(state.blocks, state.arrows).filter(m => m.risk === newRisk.id), [])
    devOpts.mode = 'plan'
  })
})

describe('roundtrip: the checklist marks what the map does not order', () => {
  const req = (id, extra = {}) => ({ id, type: 'requirement', title: id, ...extra })
  it('all tasks loose: one line on top, priority order kept', () => {
    const blocks = { a: req('a', { priority: 'low' }), b: req('b', { priority: 'high' }) }
    const out = taskChecklist(blocks, [])
    assert.match(out, /^Not ordered by the map: no connection sets an order for these tasks, so priority and then canvas position decide where they sit\. Decide the sequence yourself\./)
    assert.lt(out.indexOf('] [HIGH] b'), out.indexOf('] [LOW] a'))
  })
  it('a single task gets no note, and an ordered list gets none', () => {
    assert.notIncludes(taskChecklist({ a: req('a') }, []), 'Not ordered')
    assert.notIncludes(taskChecklist({ a: req('a'), b: req('b') }, [{ from: 'a', to: 'b' }]), 'Not ordered')
  })
  it('loose tasks come after the ordered ones, in priority then canvas order', () => {
    const blocks = { x: req('x'), y: req('y', { priority: 'high' }), a: req('a'), b: req('b') }
    const plan = buildTaskPlan(blocks, [{ from: 'a', to: 'b' }])
    assert.deepEq(plan.tasks.map(t => t.id), ['a', 'b', 'y', 'x'])
    assert.deepEq([...plan.unordered].sort(), ['x', 'y'])
  })
  it('a task in a cycle is ordered, not loose', () => {
    const blocks = { a: req('a'), b: req('b') }
    const plan = buildTaskPlan(blocks, [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
    assert.eq(plan.unordered.size, 0)
    assert.eq(plan.hasCycle, true)
  })
})

// ── Templates: the relation change moves no gap ──────────────

// The rule as it stood at 208a9c2: a known label, else an arrow touching a
// stakeholder or a metric (unlabelled, or with the verb such a pair implies)
// informs, else it comes before. Writing that reading onto every arrow as an
// explicit relation (which always wins) reproduces the old gap result.
const OLD_QUIET = new Set(['stakeholder', 'metric'])
const OLD_VERBS = new Set(['should move', 'source of', 'measures', 'delivered to', 'owns'])
function oldRelation(a, blocks) {
  if (Object.hasOwn(RELATIONS, a.relation)) return a.relation
  const label = (a.label || '').trim().toLowerCase().split(':')[0].trim()
  if (['depends on', 'requires'].includes(label)) return 'depends-on'
  if (['blocks', 'enables', 'underpins'].includes(label)) return 'blocks'
  if (['informs', 'validates', 'mitigates'].includes(label)) return 'informs'
  if (['related', 'related to', 'conflicts with', 'threatened by', 'mitigated by', 'option'].includes(label)) return 'related'
  if ((!label || OLD_VERBS.has(label)) && (OLD_QUIET.has(blocks[a.from]?.type) || OLD_QUIET.has(blocks[a.to]?.type))) return 'informs'
  return 'precedes'
}

function templateCanvas(tpl) {
  const blocks = {}, arrows = []
  tpl.blocks.forEach((bd, i) => {
    blocks['t' + i] = { id: 't' + i, type: bd.type, title: bd.title, description: bd.description || '', notes: '',
      x: bd.dx, y: bd.dy, actions: bd.actions ? [...bd.actions] : [], questions: (bd.questions || []).map(q => ({ text: q.text })),
      criteria: bd.criteria ? [...bd.criteria] : [], rationale: bd.rationale || '', status: bd.status || null, priority: bd.priority || null }
  })
  tpl.arrows.forEach(([f, t, label, relation], i) => {
    const a = { id: 'ta' + i, from: 't' + f, to: 't' + t }
    if (label) a.label = label
    if (relation) a.relation = relation
    arrows.push(a)
  })
  return { blocks, arrows }
}
const gapResult = ({ details, findings }) => JSON.stringify({
  details: details.map(d => `${d.id}:${d.gaps.join(',')}`).sort(),
  findings: (findings || []).map(f => `${f.kind}:${f.text}`).sort(),
})

describe('roundtrip: every built-in template keeps its gap set', () => {
  it(`all ${TEMPLATES.length} templates report the same gaps and findings as under the old reading`, () => {
    assert.gte(TEMPLATES.length, 9)
    TEMPLATES.forEach(tpl => {
      const { blocks, arrows } = templateCanvas(tpl)
      const old = arrows.map(a => ({ ...a, relation: oldRelation(a, blocks) }))
      assert.eq(gapResult(detectGaps(blocks, arrows)), gapResult(detectGaps(blocks, old)), tpl.name)
    })
  })
  it('and the same task order', () => {
    TEMPLATES.forEach(tpl => {
      const { blocks, arrows } = templateCanvas(tpl)
      const old = arrows.map(a => ({ ...a, relation: oldRelation(a, blocks) }))
      assert.deepEq(buildTaskPlan(blocks, arrows).tasks.map(b => b.id), buildTaskPlan(blocks, old).tasks.map(b => b.id), tpl.name)
    })
  })
  it('the bug template hands its test over as the guard on its risk, not as work after the risk', () => {
    const { blocks, arrows } = templateCanvas(TEMPLATES.find(t => t.name === 'Investigate a Bug'))
    const out = taskChecklist(blocks, arrows)
    const test = taskEntry(out, 'A test that fails before the fix')
    assert.ok(test, out)
    assert.notIncludes(test, 'The fix breaks something else;')
    assert.notIncludes(test, '; The fix breaks something else')
    assert.match(test, /mitigates: The fix breaks something else \(t\d+\)/)
  })
})

// ── The inspector's Answer field ─────────────────────────────

const host = { el: null, placeholders: [], mounted: false }
async function mount() {
  if (host.mounted) return
  const html = await (await fetch('../index.html', { cache: 'no-store' })).text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const pane = document.importNode(doc.getElementById('inspectorPane'), true)
  pane.querySelectorAll('[id]').forEach(n => {
    const stub = document.getElementById(n.id)
    if (!stub) return
    const mark = document.createComment('stub ' + n.id)
    stub.replaceWith(mark)
    host.placeholders.push({ mark, stub })
  })
  host.el = document.createElement('div')
  host.el.className = 'panel-content'
  host.el.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:610px;overflow:auto;z-index:5'
  host.el.appendChild(pane)
  document.body.appendChild(host.el)
  setupInspectorEvents()
  host.mounted = true
}
function unmount() {
  closeMenus()
  host.el?.remove()
  host.placeholders.forEach(({ mark, stub }) => mark.replaceWith(stub))
  host.placeholders = []
  host.mounted = false
}
// A real card on the canvas (no mock element), the way the inspector tests build one.
function card(id, type, title, extra = {}) {
  state.blocks[id] = { id, type, title, description: '', notes: '', x: 40, y: 40, actions: [], questions: [],
    criteria: [], rationale: '', docRef: null, width: null, color: null, collapsed: false, groupId: null,
    status: null, priority: null, cardStyle: null, borderWidth: null, highlight: null, ...extra }
  renderBlock(id)
  return state.blocks[id]
}
// A page without system focus (the headless runner) fires no blur event on
// el.blur(), so a test that means "focus left the field" says so itself.
const blurField = el => { if (!el) return; el.blur(); el.dispatchEvent(new FocusEvent('blur')) }
function fresh() {
  blurField(byId('inspAnswer'))
  document.activeElement?.blur?.()
  reset()
  deselectAll()
}
const typeInto = (el, text) => { el.focus(); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })) }
const leave = el => { el.dispatchEvent(new Event('change', { bubbles: true })); el.blur() }
const answerBox = () => byId('inspAnswer')
const shown = el => !!el && el.closest('#answerSection').style.display !== 'none' && !el.closest('#answerSection').hidden

describe('roundtrip: the inspector answers a question card', () => {
  it('mounts the real panel and puts Answer right after the type fields', async () => {
    await mount()
    fresh()
    card('q', 'question', 'Does staging fail?')
    selectBlock('q')
    const section = byId('answerSection')
    assert.ok(section, 'the section exists')
    assert.eq(section.previousElementSibling?.id, 'rationaleSection')
    assert.ok(shown(answerBox()), 'shown on a question card')
    assert.eq(section.querySelector('label').htmlFor, 'inspAnswer')
    assert.includes(section.querySelector('label').textContent, 'writing one marks the question done')
    assert.eq(answerBox().placeholder, 'What you found, and how you know it')
  })

  it('typing writes the answer; leaving the field marks the card done; one undo takes both back', () => {
    fresh()
    card('q', 'question', 'Does staging fail?')
    selectBlock('q')
    typeInto(answerBox(), 'No')
    typeInto(answerBox(), 'No, staging is clean.')
    assert.eq(state.blocks.q.answer, 'No, staging is clean.')
    assert.eq(state.blocks.q.status, null, 'not done while still typing')
    leave(answerBox())
    assert.eq(state.blocks.q.status, 'done')
    assert.eq(getUndoHistory().length, 1, 'the answer and its status are one step')
    undo()
    assert.eq(state.blocks.q.answer, undefined)
    assert.eq(state.blocks.q.status, null)
  })

  it('selecting another card mid-answer still marks the question done, in the same undo step', () => {
    fresh()
    card('q', 'question', 'Does staging fail?')
    card('g', 'goal', 'Goal')
    selectBlock('q')
    typeInto(answerBox(), 'Yes, all of them.')
    // A click on a card selects it on pointerdown, before the field blurs,
    // and the field then shows the goal's (empty) answer: no change event.
    selectBlock('g')
    assert.eq(state.blocks.q.status, 'done')
    assert.eq(state.blocks.g.status, null)
    assert.eq(answerBox().value, '', 'the field shows the new card, not the last answer')
    assert.eq(getUndoHistory().length, 1, 'the answer and its status are one step')
    undo()
    assert.eq(state.blocks.q.answer, undefined)
    assert.eq(state.blocks.q.status, null)
  })

  it('moving to another question card settles the first and starts a new burst on the second', () => {
    fresh()
    card('q', 'question', 'Q?')
    card('p', 'question', 'P?')
    selectBlock('q')
    typeInto(answerBox(), 'First')
    selectBlock('p')
    answerBox().focus()
    typeInto(answerBox(), 'Second')
    assert.eq(state.blocks.q.status, 'done')
    assert.eq(state.blocks.p.status, null, 'still typing in the second')
    blurField(answerBox())
    assert.eq(state.blocks.p.status, 'done', 'a blur with no change event settles it too')
    assert.eq(state.blocks.q.answer, 'First')
    assert.eq(state.blocks.p.answer, 'Second')
    assert.eq(getUndoHistory().length, 2, 'one step per answer')
  })

  it('a blur alone (no change event) ends the burst', () => {
    fresh()
    card('q', 'question', 'Q?')
    selectBlock('q')
    typeInto(answerBox(), 'Found it')
    blurField(answerBox())
    assert.eq(state.blocks.q.status, 'done')
    assert.includes(byId('inspStatusLabel').textContent, STATUS_DEFS.done.label, 'the panel shows the new status')
  })

  it('editing an existing answer leaves the status alone, and clearing it stores nothing', () => {
    fresh()
    card('q', 'question', 'Q?', { answer: 'Yes', status: 'in-progress' })
    selectBlock('q')
    assert.eq(answerBox().value, 'Yes')
    typeInto(answerBox(), 'Yes, since Monday')
    leave(answerBox())
    assert.eq(state.blocks.q.status, 'in-progress')
    typeInto(answerBox(), '   ')
    leave(answerBox())
    assert.eq(state.blocks.q.answer, undefined)
    assert.ok(!('answer' in JSON.parse(JSON.stringify(serializeCanvas())).blocks.q))
  })

  it('is hidden on other types, but shown where a retyped card still holds an answer', () => {
    fresh()
    card('g', 'goal', 'Goal')
    selectBlock('g')
    assert.ok(!shown(answerBox()))
    card('d', 'decision', 'Was a question', { answer: 'Kept' })
    selectBlock('d')
    assert.ok(shown(answerBox()))
    assert.eq(answerBox().value, 'Kept')
    assert.includes(byId('answerSection').textContent, 'kept from when this was an open question')
  })

  it('read-only: an answer reads as text, and an empty one is not shown at all', () => {
    fresh()
    card('q', 'question', 'Q?')
    card('a', 'question', 'A?', { answer: 'Recorded', status: 'done' })
    ui.readOnly = true
    try {
      selectBlock('q')
      assert.ok(!shown(answerBox()), 'empty and read-only: hidden')
      selectBlock('a')
      assert.ok(shown(answerBox()))
      assert.eq(answerBox().readOnly, true)
      assert.eq(answerBox().value, 'Recorded')
      typeInto(answerBox(), 'changed')
      assert.eq(state.blocks.a.answer, 'Recorded', 'a view-only link cannot edit it')
    } finally { ui.readOnly = false }
  })

  it('a patch answer shows in the open inspector', () => {
    fresh()
    card('q', 'question', 'Q?')
    selectBlock('q')
    applyPlan(buildPlan({ answers: [{ block: 'q', answer: 'From the reply' }] }))
    selectBlock('q')
    assert.eq(answerBox().value, 'From the reply')
  })

  it('puts the harness back', () => {
    fresh()
    unmount()
    assert.eq(byId('answerSection'), null)
    assert.eq(selection.blockId, null)
  })
})

// ── Review fixes (design round, ROUNDTRIP review) ────────────

describe('roundtrip: every hand-off carries an Open Question card\'s answer', () => {
  function answeredMap() {
    reset()
    add('q', 'question', 'Do service accounts use the provider?', { answer: 'No: API keys.', status: 'done' })
    add('o', 'question', 'Who signs off?')
    add('w', 'implementation', 'Add the client')
    link('q', 'w')
  }
  const file = name => buildSpecFiles(new Date(0)).find(f => f.name === name).data
  const between = (text, heading) => {
    const start = text.indexOf(heading)
    if (start < 0) return ''
    const end = text.indexOf('\n## ', start + heading.length)
    return text.slice(start, end < 0 ? undefined : end)
  }

  it('spec.md lists an answered card with its answer, never as [NEEDS CLARIFICATION], and agrees with tasks.md', () => {
    answeredMap()
    const spec = file('spec.md')
    assert.includes(spec, '## Open questions\n\n- [NEEDS CLARIFICATION] Who signs off?\n\n')
    assert.notIncludes(spec, '[NEEDS CLARIFICATION] Do service accounts')
    assert.includes(spec, '## Answered questions\n\n- **Do service accounts use the provider?**\n  - Answered: No: API keys.\n')
    assert.includes(file('tasks.md'), 'Answer to "Do service accounts use the provider?": No: API keys.')
  })

  it('spec.md with every card answered has no open questions at all', () => {
    answeredMap()
    delete state.blocks.o
    const spec = file('spec.md')
    assert.notIncludes(spec, '## Open questions')
    assert.notIncludes(spec, 'NEEDS CLARIFICATION] Do')
    assert.includes(spec, '## Answered questions')
  })

  it('the Markdown export prints the answer under the card', () => {
    answeredMap()
    const md = buildMarkdown()
    assert.includes(md, '### Do service accounts use the provider? [done]\n**Answer:** No: API keys.\n\n')
    assert.notIncludes(between(md, '### Who signs off?'), '**Answer:**')
  })

  it('the meeting summary moves an answered card out of Open questions, with its answer', () => {
    answeredMap()
    const md = buildMeetingSummary({ now: new Date(0) })
    const open = between(md, '## Open questions')
    assert.includes(open, '- Who signs off?')
    assert.notIncludes(open, 'Do service accounts')
    assert.includes(md, '## Answered questions\n\n- Do service accounts use the provider?\n  - Answer: No: API keys.\n')
    delete state.blocks.o
    const none = between(buildMeetingSummary({ now: new Date(0) }), '## Open questions')
    assert.includes(none, 'None open: every question on the map has an answer recorded.')
    assert.notIncludes(none, 'No questions recorded')
  })

  it('JSON Canvas carries the answer out and back, and a tool that drops the extra field keeps it in the text', () => {
    answeredMap()
    state.blocks.q.description = 'Asked by support.'
    const jc = toJsonCanvas()
    const node = jc.nodes.find(n => n.id === 'q')
    assert.includes(node.text, '**Answer:** No: API keys.')
    assert.eq(node.pathfinderAnswer, 'No: API keys.')
    assert.eq(jc.nodes.find(n => n.id === 'o').pathfinderAnswer, undefined)
    const back = fromJsonCanvas(jc).payload.blocks.find(b => b.id === 'q')
    assert.eq(back.answer, 'No: API keys.')
    assert.eq(back.description, 'Asked by support.', 'the answer is not also left in the description')
    const bare = fromJsonCanvas({ nodes: jc.nodes.map(({ pathfinderAnswer, ...n }) => n), edges: [] })
    const kept = bare.payload.blocks.find(b => b.id === 'q')
    assert.eq(kept.answer, undefined)
    assert.includes(kept.description, 'No: API keys.', 'nothing is lost without the field')
    assert.eq(normalizeCanvas(fromJsonCanvas(jc).payload).blocks.q.answer, 'No: API keys.')
  })

  it('Find blocks finds a card by its answer', () => {
    answeredMap()
    const hits = searchBlocks(state.blocks, 'API keys')
    assert.deepEq(hits.map(h => h.block.id), ['q'])
    assert.eq(hits[0].source, 'Answer')
  })
})

describe('roundtrip: a refutation keeps every word through a reload', () => {
  it('the evidence, the claim and a long description all survive normalize', () => {
    reset()
    const long = 'Our sessions last thirty days, so the provider should allow the same. '.repeat(26)
    add('a', 'assumption', 'Tokens last as long as sessions', { description: long })
    applyPlan(buildPlan({ verify: [{ block: 'a', verdict: 'refuted', evidence: 'Capped at 24h in the provider config. '.repeat(10) }] }))
    const live = state.blocks.a.rationale
    assert.gt(live.length, 2000, 'the case the old cap cut')
    assert.ok(live.endsWith(long.trim()), 'the old description is the rationale\'s tail')
    const back = normalizeCanvas(JSON.parse(JSON.stringify(serializeCanvas()))).blocks.a
    assert.eq(back.rationale, live)
  })

  it('a long rationale typed by hand is not cut on load either', () => {
    const text = 'Chosen because the queue already exists. '.repeat(150)
    assert.eq(normalizeBlock({ id: 'd', type: 'decision', title: 'Use the queue', rationale: text }).rationale, text)
  })
})

describe('roundtrip: the connection menu reads an unlabelled arrow the way the brief does', () => {
  const NS = 'http://www.w3.org/2000/svg'
  function arrowHit(aid) {
    const svg = document.createElementNS(NS, 'svg')
    svg.classList.add('ctx-test-svg')
    const g = document.createElementNS(NS, 'g')
    g.dataset.aid = aid
    const path = document.createElementNS(NS, 'path')
    path.classList.add('arrow-hitbox')
    g.appendChild(path); svg.appendChild(g)
    $.canvasRoot().appendChild(svg)
    return path
  }
  const lastMenu = () => { const all = document.querySelectorAll('.pf-menu'); return all[all.length - 1] }
  const rowOf = (menu, label) => [...menu.querySelectorAll('.pf-menu-item')].find(r => r.querySelector('.pf-menu-label')?.textContent === label)
  function meaningHint(arrow) {
    state.arrows = [arrow]
    const hit = arrowHit(arrow.id)
    try {
      hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }))
      rowOf(lastMenu(), 'Meaning').click()
      return rowOf(lastMenu(), 'From label or direction')?.querySelector('.pf-menu-hint')?.textContent
    } finally {
      closeMenus()
      document.querySelectorAll('.ctx-test-svg').forEach(el => el.remove())
    }
  }
  it('says "related" from a risk and "informs" at a goal, as the inspector hint and the brief do, and "comes before" between tasks', () => {
    reset()
    setupContextMenu()
    ;[['k', 'risk', 'Outage'], ['f', 'implementation', 'Flag'], ['g', 'goal', 'Goal'], ['h', 'implementation', 'Cleanup']]
      .forEach(([id, type, title], i) => { state.blocks[id] = { id, type, title, description: '', notes: '', x: 40 + i * 320, y: 40,
        actions: [], questions: [], criteria: [], rationale: '', docRef: null, width: null, color: null, collapsed: false,
        groupId: null, status: null, priority: null }; renderBlock(id) })
    try {
      assert.eq(meaningHint({ id: 'kf', from: 'k', to: 'f' }), 'Reads as: related')
      assert.eq(meaningHint({ id: 'hg', from: 'h', to: 'g' }), 'Reads as: informs')
      assert.eq(meaningHint({ id: 'fh', from: 'f', to: 'h' }), 'Reads as: comes before')
      assert.eq(relationHint({ from: 'k', to: 'f' }, state.blocks).includes('adds no task order'), true)
    } finally {
      deselectAll()
      Object.keys(state.blocks).forEach(id => document.getElementById('b-' + id)?.remove())
      reset()
    }
  })
})
