// ============================================================
//  insights.test.js -- gaps, attention and health (INSIGHTS stream)
// ============================================================

import { describe, it, assert, mockBlockEl, mockGapIconEl, cleanupMockEls, cssRgba } from './test-utils.js'
import { state, ui, selection, getUndoHistory, getRedoFuture, devOpts, saveStatus } from '../js/state.js'
import { runGapDetection, detectGaps, GAP_META, GAP_ORDER, gapIconFor, getGapFixes, gapExplain, nextEmptyStep,
         acceptGap, acceptFinding, unacceptGap, blockGap, hidesQuestion, FINDING_ACKS, FINDING_META } from '../js/gaps.js'
import { attentionItems, acceptedItems, attentionModel, attentionRowsHtml, runAttentionAction, suggestTypes, setupAttention } from '../js/attention.js'
import { computeHealthScore, generatePrompt } from '../js/prompt.js'
import { relationOf, relationHint, dependencyEdges, impliedVerb } from '../js/relations.js'
import { undo, deselectAll, renderBlock } from '../js/render.js'
import { startInlineEdit, commitInlineEdit } from '../js/inline-edit.js'
import { TEMPLATES } from '../js/templates.js'

// Load a built-in template's data into state the way applyTemplate does,
// minus the viewport maths, with a mock element per block.
function loadTemplate(tpl) {
  cleanupMockEls()
  state.blocks = {}; state.arrows = []; state.groups = {}
  const ids = tpl.blocks.map((bd, i) => {
    const id = 't' + i
    state.blocks[id] = {
      id, type: bd.type, title: bd.title, description: bd.description || '', notes: '',
      x: bd.dx, y: bd.dy, actions: bd.actions ? [...bd.actions] : [],
      questions: bd.questions ? bd.questions.map(q => ({ text: q.text })) : [],
      criteria: bd.criteria ? [...bd.criteria] : [], rationale: bd.rationale || '',
      width: null, color: null, collapsed: false, groupId: null,
      status: bd.status || null, priority: bd.priority || null,
    }
    mockBlockEl(id); mockGapIconEl(id)
    return id
  })
  tpl.arrows.forEach(([fi, ti, label, relation], i) => {
    const a = { id: 'ta' + i, from: ids[fi], to: ids[ti] }
    if (label) a.label = label
    if (relation) a.relation = relation
    state.arrows.push(a)
  })
}

const gapSet = details => details.map(d => `${d.title} => ${d.gaps.join(',')}`).sort()

// Recorded against the rules as they stood before the INSIGHTS stream
// (commit ecb74f2). A new rule must leave every one of these unchanged.
const TEMPLATE_GAPS = {
  'Validate an Idea': ['Validate the core idea => gap-no-req'],
  'Sprint Planning': ['Biggest delivery risk => gap-no-mitigation', 'Must have => gap-no-criteria',
    'Should have => gap-no-criteria'],
  'Problem Analysis': [],
  'Feature Launch': ['Launch risk => gap-no-mitigation', 'Launch-blocking requirement => gap-no-criteria'],
  'Risk Review': ['Resulting requirement => gap-no-criteria'],
  'Investigate a Bug': ['A test that fails before the fix => gap-no-criteria'],
  'Inherit a Codebase': ['A rollback you have actually tried => gap-no-criteria',
    'Be able to make a safe change => gap-no-req'],
  'Migrate a System': ['Cutover under load => gap-no-mitigation', 'No data loss => gap-no-criteria',
    'Per-tenant, not big bang => gap-no-basis', 'Reversible at every step => gap-no-criteria',
    'Silent divergence between the two => gap-no-mitigation'],
}

describe('Insights: the 8 built-in templates keep their gap sets', () => {
  Object.entries(TEMPLATE_GAPS).forEach(([name, expected]) => {
    it(`"${name}" reports the same gaps as before`, () => {
      const tpl = TEMPLATES.find(t => t.name === name)
      assert.ok(tpl, 'template exists: ' + name)
      loadTemplate(tpl)
      assert.deepEq(gapSet(runGapDetection().details), expected)
      assert.deepEq(gapSet(detectGaps(state.blocks, state.arrows).details), expected, 'pure path agrees')
    })
  })
  it('the new canvas checks stay silent on every built-in template', () => {
    Object.keys(TEMPLATE_GAPS).forEach(name => {
      loadTemplate(TEMPLATES.find(t => t.name === name))
      // The dependency cycle predates this stream (a template label that
      // reads as depends-on); the TYPES stream fixes it with explicit relations.
      const extra = detectGaps(state.blocks, state.arrows).findings.filter(f => f.kind !== 'cycle')
      assert.deepEq(extra.map(f => f.text), [], name)
    })
  })
})

// ── Fixtures ─────────────────────────────────────────────────

function blk(id, type, extra = {}) {
  return { id, type, title: extra.title ?? id, description: '', notes: '', x: 0, y: 0,
    actions: [], questions: [], criteria: [], rationale: '', ...extra }
}
function canvas(list, pairs) {
  const blocks = Object.fromEntries(list.map(b => [b.id, b]))
  const arrows = pairs.map(([from, to], i) => ({ id: 'a' + i, from, to }))
  return { blocks, arrows }
}
const gapOf = (c, id) => detectGaps(c.blocks, c.arrows).details.find(d => d.id === id)?.gaps[0] || null

function load(c, { dom = true } = {}) {
  cleanupMockEls()
  document.querySelectorAll('#canvasRoot .block').forEach(el => el.remove())
  state.blocks = c.blocks; state.arrows = c.arrows; state.groups = {}
  if (dom) Object.keys(c.blocks).forEach(id => { mockBlockEl(id); mockGapIconEl(id) })
}
function resetUndo() {
  ui.readOnly = false; ui.embed = false
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  deselectAll()
}

// ── Purity ───────────────────────────────────────────────────

describe('Insights: detectGaps is pure', () => {
  it('runs with no DOM blocks and leaves its input untouched', () => {
    cleanupMockEls()
    const c = canvas([blk('g', 'goal'), blk('p', 'problem'), blk('lone', 'risk')], [['g', 'p']])
    const before = JSON.stringify(c)
    const r = detectGaps(c.blocks, c.arrows)
    assert.eq(JSON.stringify(c), before)
    assert.deepEq(r.details.map(d => [d.id, d.gaps[0]]).sort(),
      [['g', 'gap-no-req'], ['lone', 'gap-isolated'], ['p', 'gap-unaddressed']])
    assert.eq(r.count, 3)
    assert.ok(Array.isArray(r.canvasFindings) && Array.isArray(r.findings) && Array.isArray(r.accepted))
  })
  it('runGapDetection reports blocks that have no element on screen', () => {
    load(canvas([blk('g', 'goal')], []), { dom: false })
    assert.eq(runGapDetection().count, 1)
  })
  it('tolerates blocks without actions or criteria arrays', () => {
    const c = canvas([{ id: 'p', type: 'problem' }, { id: 'r', type: 'requirement' }], [['r', 'p']])
    assert.eq(gapOf(c, 'p'), 'gap-unaddressed')
    assert.eq(gapOf(c, 'r'), 'gap-no-criteria')
  })
})

// ── New rules ────────────────────────────────────────────────

describe('Insights: new rules fire and stay quiet', () => {
  it('gap-no-purpose: implementation linked to nothing that gives it a reason', () => {
    assert.eq(gapOf(canvas([blk('i', 'implementation'), blk('s', 'resource')], [['s', 'i']]), 'i'), 'gap-no-purpose')
    ;['goal', 'requirement', 'problem', 'metric', 'output', 'stakeholder'].forEach(t => {
      assert.eq(gapOf(canvas([blk('i', 'implementation'), blk('x', t)], [['i', 'x']]), 'i'), null, t)
    })
  })
  it('gap-metric-no-goal, then gap-no-target', () => {
    const m = extra => blk('m', 'metric', extra)
    assert.eq(gapOf(canvas([m(), blk('i', 'implementation')], [['i', 'm']]), 'm'), 'gap-metric-no-goal')
    assert.eq(gapOf(canvas([m(), blk('g', 'goal')], [['m', 'g']]), 'm'), 'gap-no-target')
    assert.eq(gapOf(canvas([m({ criteria: ['80% by Q4'] }), blk('g', 'goal')], [['m', 'g']]), 'm'), null)
    assert.eq(gapOf(canvas([m({ criteria: ['   '] }), blk('g', 'goal')], [['m', 'g']]), 'm'), 'gap-no-target', 'a blank line is not a target')
  })
  it('gap-no-consumer only once the map has a stakeholder or a metric', () => {
    const base = [blk('i', 'implementation'), blk('o', 'output'), blk('r', 'requirement', { criteria: ['x'] })]
    const pairs = [['i', 'o'], ['i', 'r']]
    assert.eq(gapOf(canvas(base, pairs), 'o'), null, 'legacy maps keep their sink outputs')
    const withSh = canvas([...base, blk('s', 'stakeholder'), blk('g', 'goal')], [...pairs, ['s', 'g']])
    assert.eq(gapOf(withSh, 'o'), 'gap-no-consumer')
    withSh.arrows.push({ id: 'd', from: 'o', to: 's' })
    assert.eq(gapOf(withSh, 'o'), null, 'delivered to a stakeholder')
    assert.eq(gapOf(withSh, 's'), null, 'and that serves the stakeholder')
  })
  it('gap-no-producer still wins over gap-no-consumer', () => {
    const c = canvas([blk('o', 'output'), blk('m', 'metric')], [['o', 'm']])
    assert.eq(gapOf(c, 'o'), 'gap-no-producer')
  })
  it('gap-unserved: a stakeholder with nothing delivered to or asked of them', () => {
    assert.eq(gapOf(canvas([blk('s', 'stakeholder'), blk('t', 'terminator')], [['s', 't']]), 's'), 'gap-unserved')
    ;['output', 'metric', 'goal', 'requirement', 'decision'].forEach(t => {
      assert.eq(gapOf(canvas([blk('s', 'stakeholder'), blk('x', t)], [['x', 's']]), 's'), null, t)
    })
  })
  it('refined gap-no-req: a metric or the work itself also supports a goal', () => {
    assert.eq(gapOf(canvas([blk('g', 'goal'), blk('m', 'metric')], [['m', 'g']]), 'g'), null)
    assert.eq(gapOf(canvas([blk('g', 'goal'), blk('i', 'implementation')], [['i', 'g']]), 'g'), null)
    assert.eq(gapOf(canvas([blk('g', 'goal'), blk('p', 'problem')], [['g', 'p']]), 'g'), 'gap-no-req')
  })
  it('every rule has metadata and an icon', () => {
    GAP_ORDER.forEach(g => {
      assert.ok(GAP_META[g]?.short && GAP_META[g]?.prompt, g + ' meta')
      assert.match(gapIconFor(g), /^<svg[^>]*width="14"/, g + ' icon')
    })
    assert.eq(gapIconFor('gap-nope'), '')
  })
})

describe('Insights: one gap per block', () => {
  it('a block reports only its first rule, on canvas and in the result', () => {
    const c = canvas([blk('m', 'metric'), blk('i', 'implementation'), blk('o', 'output'), blk('s', 'stakeholder')],
      [['i', 'm'], ['i', 'o'], ['s', 'i']])
    load(c)
    const r = runGapDetection()
    const ids = r.details.map(d => d.id)
    assert.eq(ids.length, new Set(ids).size, 'no block listed twice')
    r.details.forEach(d => assert.eq(d.gaps.length, 1))
    assert.eq(r.details.find(d => d.id === 'm').gaps[0], 'gap-metric-no-goal', 'not also gap-no-target')
    const el = document.getElementById('b-m')
    assert.deepEq(GAP_ORDER.filter(g => el.classList.contains(g)), ['gap-metric-no-goal'])
  })
  it('paints an icon with an accessible name into the card slot, and clears it', () => {
    load(canvas([blk('g', 'goal')], []))
    runGapDetection()
    const icon = document.querySelector('#gi-g .gap-icon')
    assert.ok(icon, 'icon rendered')
    assert.eq(icon.getAttribute('role'), 'img')
    assert.eq(icon.getAttribute('aria-label'), 'Gap: Isolated')
    assert.ok(icon.querySelector('svg'))
    state.blocks.r = blk('r', 'requirement', { criteria: ['done'] }); mockBlockEl('r'); mockGapIconEl('r')
    state.arrows.push({ id: 'x', from: 'r', to: 'g' })
    runGapDetection()
    assert.eq(document.getElementById('gi-g').innerHTML, '')
  })
})

// ── Fixes ────────────────────────────────────────────────────

describe('Insights: suggestions for the new rules', () => {
  it('create fixes carry the generic { type, dir } and the gap they fix', () => {
    const cases = [
      [[blk('i', 'implementation'), blk('s', 'resource')], [['s', 'i']], 'i', 'gap-no-purpose', { type: 'requirement', dir: 'out' }],
      [[blk('o', 'output'), blk('i', 'implementation'), blk('m', 'metric')], [['i', 'o'], ['i', 'm']], 'o', 'gap-no-consumer', { type: 'stakeholder', dir: 'out' }],
      [[blk('s', 'stakeholder'), blk('t', 'terminator')], [['s', 't']], 's', 'gap-unserved', { type: 'output', dir: 'in' }],
      [[blk('g', 'goal'), blk('p', 'problem')], [['g', 'p']], 'g', 'gap-no-req', { type: 'metric', dir: 'in' }],
    ]
    cases.forEach(([list, pairs, id, gap, create]) => {
      load(canvas(list, pairs), { dom: false })
      const fixes = getGapFixes(state.blocks[id])
      assert.ok(fixes.length, gap)
      fixes.forEach(f => assert.eq(f.gap, gap))
      assert.ok(fixes.some(f => JSON.stringify(f.create) === JSON.stringify(create)), gap + ' create fix')
      assert.eq(new Set(fixes.map(f => f.id)).size, fixes.length, 'fix ids are unique per block')
    })
  })
  it('works without a rendered card, and answers nothing for an unknown block', () => {
    load(canvas([blk('m', 'metric'), blk('g', 'goal')], [['m', 'g']]), { dom: false })
    assert.deepEq(getGapFixes(state.blocks.m).map(f => f.id), ['criteria'])
    assert.deepEq(getGapFixes({ id: 'ghost', type: 'goal' }), [])
  })
})

// ── Accepting a gap ──────────────────────────────────────────

describe('Insights: gapAck', () => {
  it('suppresses the gap for that block and lists it as accepted', () => {
    const c = canvas([blk('g', 'goal', { gapAck: ['gap-no-req'] }), blk('p', 'problem', { actions: ['resolve'] })], [['g', 'p']])
    const r = detectGaps(c.blocks, c.arrows)
    assert.eq(r.details.length, 0)
    assert.deepEq(r.accepted.map(a => [a.id, a.gap]), [['g', 'gap-no-req']])
  })
  it('an accepted type gap lets the next rule speak; accepted isolation ends the checks', () => {
    const c = canvas([blk('m', 'metric', { gapAck: ['gap-metric-no-goal'] }), blk('i', 'implementation')], [['i', 'm']])
    assert.eq(gapOf(c, 'm'), 'gap-no-target', 'accepting "measures no goal" says nothing about its target')
    const r = detectGaps(c.blocks, c.arrows)
    assert.deepEq(r.accepted.map(a => a.gap), ['gap-metric-no-goal'])
    c.blocks.m.criteria = ['80% by Q4']
    assert.eq(gapOf(c, 'm'), null)
    const lone = canvas([blk('r', 'requirement', { gapAck: ['gap-isolated'] })], [])
    assert.eq(gapOf(lone, 'r'), null, 'not re-flagged as missing criteria')
  })
  it('acceptGap is one undo step, and unacceptGap brings the gap back', () => {
    load(canvas([blk('g', 'goal'), blk('p', 'problem', { actions: ['resolve'] })], [['g', 'p']]))
    resetUndo()
    assert.eq(blockGap('g'), 'gap-no-req')
    assert.ok(acceptGap('g'))
    assert.deepEq(state.blocks.g.gapAck, ['gap-no-req'])
    assert.eq(getUndoHistory().length, 1)
    assert.eq(blockGap('g'), null)
    assert.ok(!acceptGap('g', 'gap-no-req'), 'already accepted')
    undo()
    assert.ok(!state.blocks.g.gapAck?.length)
    assert.eq(blockGap('g'), 'gap-no-req')
    assert.ok(acceptGap('g', 'gap-no-req'))
    assert.ok(unacceptGap('g', 'gap-no-req'))
    assert.ok(!('gapAck' in state.blocks.g), 'an empty list is dropped')
    assert.eq(blockGap('g'), 'gap-no-req')
  })
  it('is refused in read-only and embed views, and for unknown gap ids', () => {
    load(canvas([blk('g', 'goal'), blk('p', 'problem', { actions: ['resolve'] })], [['g', 'p']]))
    resetUndo()
    ui.readOnly = true
    assert.ok(!acceptGap('g'))
    ui.readOnly = false; ui.embed = true
    assert.ok(!acceptGap('g'))
    ui.embed = false
    assert.ok(!acceptGap('g', 'gap-made-up'))
    assert.ok(!('gapAck' in state.blocks.g))
    assert.eq(getUndoHistory().length, 0)
  })
  it('accepted lists the acceptances that still stand, stale lists the ones the canvas outgrew', () => {
    // Masked: an isolated requirement whose criteria gap was accepted. Stale:
    // a goal that has since gained a requirement. Unknown: a newer build's rule.
    const c = canvas([
      blk('r', 'requirement', { gapAck: ['gap-no-criteria'] }),
      blk('g', 'goal', { gapAck: ['gap-no-req'] }), blk('q', 'requirement', { criteria: ['x'] }),
      blk('m', 'metric', { gapAck: ['gap-from-later', 'gap-no-target'] }), blk('i', 'implementation'),
    ], [['q', 'g'], ['i', 'm']])
    const r = detectGaps(c.blocks, c.arrows)
    assert.deepEq(r.accepted.map(a => [a.id, a.gap, a.live]), [
      ['r', 'gap-no-criteria', true], ['m', 'gap-from-later', null], ['m', 'gap-no-target', true]])
    assert.deepEq(r.stale.map(a => [a.id, a.gap, a.live]), [['g', 'gap-no-req', false]])
    assert.eq(gapOf(c, 'r'), 'gap-isolated', 'the accepted gap stays masked behind isolation')
    assert.eq(gapOf(c, 'm'), 'gap-metric-no-goal')
  })
})

// ── Canvas findings ──────────────────────────────────────────

const kinds = c => detectGaps(c.blocks, c.arrows).findings.map(f => f.kind)

describe('Insights: canvas findings', () => {
  it('untyped share: three Other blocks, or more than a quarter of the map', () => {
    const others = n => Array.from({ length: n }, (_, i) => blk('c' + i, 'custom'))
    assert.ok(kinds(canvas(others(3), [])).includes('untyped'))
    assert.ok(kinds(canvas([...others(2), blk('g', 'goal'), blk('r', 'requirement')], [])).includes('untyped'), '2 of 4')
    assert.ok(!kinds(canvas([...others(2), ...['a', 'b', 'c', 'd', 'e', 'f'].map(i => blk(i, 'goal'))], [])).includes('untyped'), '2 of 8')
    assert.ok(!kinds(canvas(others(1), [])).includes('untyped'), 'one Other block is not a share')
    const f = detectGaps(canvas(others(3), []).blocks, []).findings.find(x => x.kind === 'untyped')
    assert.deepEq(f.ids, ['c0', 'c1', 'c2'])
  })
  it('no Why: five blocks and neither a goal nor a problem', () => {
    const five = t => canvas(['a', 'b', 'c', 'd', 'e'].map((id, i) => blk(id, i ? 'requirement' : t)), [])
    assert.ok(kinds(five('output')).includes('no-why'))
    assert.ok(!kinds(five('goal')).includes('no-why'))
    assert.ok(!kinds(five('problem')).includes('no-why'))
  })
  it('goals with no metric, only once the map uses metrics or implementations', () => {
    const legacy = canvas([blk('g', 'goal'), blk('r', 'requirement')], [['g', 'r']])
    assert.ok(!kinds(legacy).includes('goal-no-metric'))
    const modern = canvas([blk('g', 'goal'), blk('r', 'requirement'), blk('i', 'implementation')], [['g', 'r'], ['i', 'r']])
    assert.ok(kinds(modern).includes('goal-no-metric'))
    modern.blocks.m = blk('m', 'metric'); modern.arrows.push({ id: 'z', from: 'm', to: 'g' })
    assert.ok(!kinds(modern).includes('goal-no-metric'))
  })
  it('a metric that no work moves, once implementations exist', () => {
    const c = canvas([blk('m', 'metric'), blk('g', 'goal')], [['m', 'g']])
    assert.ok(!kinds(c).includes('metric-unmoved'))
    c.blocks.i = blk('i', 'implementation')
    assert.ok(kinds(c).includes('metric-unmoved'))
    c.arrows.push({ id: 'z', from: 'i', to: 'm' })
    assert.ok(!kinds(c).includes('metric-unmoved'))
  })
  it('possible duplicates: one title inside another, on word boundaries', () => {
    const dup = (a, b) => kinds(canvas([blk('x', 'output', { title: a }), blk('y', 'output', { title: b })], [])).includes('duplicate')
    assert.ok(dup('End of Sprint', 'Every End of Sprint'))
    assert.ok(dup('Login', 'login'), 'exact match after normalising')
    assert.ok(!dup('Reports', 'Weekly Reports'), 'a single word needs an exact match')
    assert.ok(!dup('Untitled 1', 'Untitled 1'), 'default titles never count')
    assert.ok(!dup('Option A', 'Option B'))
    assert.ok(!dup('', ''))
  })
  it('a requirement and the work that satisfies it are not duplicates', () => {
    // Regression: the shorter title only has to be inside the longer, so the
    // Implementation-satisfies-Requirement pairing was raised as a duplicate.
    const dup = (a, b) => kinds(canvas([blk('x', 'requirement', { title: a }), blk('y', 'implementation', { title: b })], [['y', 'x']])).includes('duplicate')
    ;[['Export PDF', 'Export PDF button'], ['Sign up', 'Sign up flow'], ['Data model', 'Review the data model'],
      ['User login', 'User login audit log']].forEach(([a, b]) => assert.ok(!dup(a, b), `${a} | ${b}`))
    assert.ok(dup('Weekly revenue report', 'Weekly revenue report v2'), 'three of four words is still close')
    assert.ok(dup('Export PDF', 'export pdf'), 'an exact match still counts')
  })
  it('an answered or rhetorical question is not a hidden one', () => {
    assert.ok(!hidesQuestion('Why does this matter? Because churn.'))
    assert.ok(!hidesQuestion('Is this done? Yes.'))
    assert.ok(!hidesQuestion('Q: how? A: via the queue.'))
    assert.ok(!hidesQuestion('Uses GET /items?page=2'))
    assert.ok(hidesQuestion('Who owns this? Marketing or sales?'), 'the last one is still open')
    assert.ok(hidesQuestion('Which region?\nWest, probably.'), 'a question ending its line')
    assert.ok(hidesQuestion('Is it still used? (check with ops)'))
    assert.ok(hidesQuestion('(still used?)'))
    const c = canvas([blk('a', 'assumption', { description: 'Do users want it?' }), blk('g', 'goal')], [])
    assert.ok(!kinds(c).includes('hidden-question'), 'an Assumption is the doubt itself')
  })
  it('a question hidden in a description', () => {
    assert.ok(hidesQuestion('(Check if still used)'))
    assert.ok(hidesQuestion('Owner TBD'))
    assert.ok(hidesQuestion('Does it scale?'))
    assert.ok(!hidesQuestion('See https://example.com/page?id=4 for the spec'))
    assert.ok(!hidesQuestion('Check the logs first.'))
    const c = canvas([blk('w', 'output', { description: 'Weekly. (Check if still used)' }),
      blk('q', 'question', { description: 'Who owns it?' })], [])
    const f = detectGaps(c.blocks, c.arrows).findings.find(x => x.kind === 'hidden-question')
    assert.deepEq(f.ids, ['w'], 'an Open Question block is already tracked')
  })
  it('blocks awaiting a type check', () => {
    const c = canvas([blk('a', 'output', { typeCheck: true }), blk('b', 'goal')], [])
    const f = detectGaps(c.blocks, c.arrows).findings.find(x => x.kind === 'type-check')
    assert.deepEq(f.ids, ['a'])
    assert.includes(f.text, '1 block was typed automatically')
  })
  it('canvasFindings stays the list of strings the prompt prints', () => {
    const c = canvas([blk('a', 'custom'), blk('b', 'custom'), blk('c', 'custom')], [])
    const r = detectGaps(c.blocks, c.arrows)
    assert.deepEq(r.canvasFindings, r.findings.map(f => f.text))
    r.canvasFindings.forEach(t => assert.ok(!t.includes('\u2014'), 'no em dash in copy'))
  })
})

// ── The user's canvas (methodology.md "The user's canvas re-typed") ──

const USER = [
  ['w1', 'Multi Reports', 'custom', 'output', ''],
  ['w2', 'Status notes per Epic (Deliverable)', 'output', 'output', 'Part of the lifecycle of the product.'],
  ['w3', 'Weekly Reports', 'custom', 'output', '(Check if still used)'],
  ['w4', 'Schedule status notes', 'custom', 'implementation', 'Integration with multiple tools to get a summary of the work needed.'],
  ['w5', 'End of Sprint', 'terminator', 'output', ''],
  ['w6', 'Portfolio Reporting', 'custom', 'stakeholder', ''],
  ['w7', 'Executive Reporting', 'custom', 'stakeholder', ''],
  ['w8', 'Every End of Sprint', 'custom', 'terminator', ''],
  ['x9', 'Key Results', 'custom', 'metric', ''],
  ['xa', "On Quarter's end", 'custom', 'terminator', ''],
  ['xb', 'Data Hub', 'custom', 'resource', 'Integrated with the tracker and other sources'],
]
const USER_EDGES = [['w2', 'w4'], ['w3', 'w1'], ['w5', 'w1'], ['w7', 'w8'], ['w6', 'w8'], ['w8', 'w2'],
  ['w8', 'w5'], ['xa', 'x9'], ['w7', 'xa'], ['w4', 'w3'], ['xb', 'x9'], ['x9', 'w1']]
const userCanvas = typed => canvas(USER.map(([id, title, asImported, retyped, description]) =>
  blk(id, typed ? retyped : asImported, { title, description })), USER_EDGES)

describe("Insights: the user's reporting canvas", () => {
  it('re-typed, it reports the four gaps the methodology predicts', () => {
    const c = userCanvas(true)
    assert.deepEq(gapSet(detectGaps(c.blocks, c.arrows).details), [
      'Executive Reporting => gap-unserved', 'Key Results => gap-metric-no-goal',
      'Multi Reports => gap-no-consumer', 'Portfolio Reporting => gap-unserved'])
    const k = kinds(c)
    ;['no-why', 'duplicate', 'hidden-question', 'metric-unmoved'].forEach(x => assert.ok(k.includes(x), x))
  })
  it('as imported (mostly Other) it now scores below the typed map', () => {
    load(userCanvas(false))
    assert.ok(kinds(userCanvas(false)).includes('untyped'))
    const untyped = computeHealthScore()
    load(userCanvas(true))
    const typed = computeHealthScore()
    assert.lt(untyped, typed, `untyped ${untyped} should score below typed ${typed}`)
  })
  it('health penalises Other blocks one for one', () => {
    // No descriptions, so neither score is clamped at 100.
    const two = t => canvas([blk('a', t), blk('b', 'goal'), blk('r', 'requirement', { criteria: ['x'] })],
      [['b', 'r'], ['a', 'b']])
    load(two('context')); const typed = computeHealthScore()
    load(two('custom')); const other = computeHealthScore()
    assert.eq(typed - other, 8)
  })
})

// ── Attention agrees with the prompt ─────────────────────────

describe('Insights: the Attention tab and the gap checks agree', () => {
  it('every reported gap and canvas finding has an Attention item', () => {
    const c = userCanvas(true)
    const r = detectGaps(c.blocks, c.arrows)
    const items = attentionItems(c.blocks, c.arrows)
    r.details.forEach(d => assert.ok(items.some(i => i.id === d.id && (i.kind === 'gap' || i.kind === 'criteria')), d.title))
    assert.eq(items.filter(i => i.kind === 'canvas').length, r.findings.length)
    items.filter(i => i.kind === 'gap').forEach(i => assert.includes(i.detail, GAP_META[i.gap].short))
  })
  it('does not ask an Output or a Goal for criteria the checks never require', () => {
    const c = canvas([blk('i', 'implementation'), blk('o', 'output', { title: 'Status notes per Epic' }), blk('g', 'goal'),
      blk('r', 'requirement'), blk('m', 'metric')], [['i', 'o'], ['i', 'r'], ['r', 'g'], ['m', 'g'], ['i', 'm']])
    const items = attentionItems(c.blocks, c.arrows)
    const criteria = items.filter(i => i.kind === 'criteria').map(i => i.id).sort()
    assert.deepEq(criteria, ['m', 'r'], 'requirement criteria and metric targets only')
    assert.ok(!items.some(i => i.kind === 'gap' && (i.gap === 'gap-no-criteria' || i.gap === 'gap-no-target')), 'not listed twice')
  })
  it('an accepted criteria gap is not raised again', () => {
    const c = canvas([blk('r', 'requirement', { gapAck: ['gap-no-criteria'] }), blk('g', 'goal')], [['r', 'g']])
    assert.ok(!attentionItems(c.blocks, c.arrows).some(i => i.id === 'r'))
  })
  it('without the connections only the block checks run', () => {
    const c = canvas([blk('g', 'goal')], [])
    assert.eq(attentionItems(c.blocks).length, 0)
    assert.deepEq(attentionItems(c.blocks, []).map(i => i.kind), ['gap'])
  })
})

// ── Suggest types ────────────────────────────────────────────

describe('Insights: Suggest types for untyped blocks', () => {
  it('retypes what the classifier can place, marks each for a check, one undo step', () => {
    load(canvas([blk('a', 'custom', { title: 'Risk: vendor lock-in' }), blk('b', 'custom', { title: 'Goal: ship v2' }),
      blk('c', 'custom', { title: 'Zebra' }), blk('d', 'goal')], []))
    resetUndo()
    assert.eq(suggestTypes(), 2)
    assert.eq(state.blocks.a.type, 'risk'); assert.eq(state.blocks.a.typeCheck, true)
    assert.eq(state.blocks.b.type, 'goal'); assert.eq(state.blocks.b.typeCheck, true)
    assert.eq(state.blocks.c.type, 'custom', 'no guess, left alone')
    assert.ok(!('typeCheck' in state.blocks.d), 'typed blocks untouched')
    assert.eq(getUndoHistory().length, 1)
    undo()
    assert.eq(state.blocks.a.type, 'custom')
  })
  it('does nothing in read-only', () => {
    load(canvas([blk('a', 'custom', { title: 'Risk: vendor lock-in' })], []))
    resetUndo()
    ui.readOnly = true
    assert.eq(suggestTypes(), 0)
    assert.eq(state.blocks.a.type, 'custom')
    ui.readOnly = false
  })
})

// ── Accepting gaps from the Attention tab ────────────────────

const rowsDom = rows => {
  const ul = document.createElement('ul')
  ul.innerHTML = attentionRowsHtml(rows)
  return ul
}

describe('Insights: Attention rows accept and reopen gaps', () => {
  it('gap and criteria rows offer Accept, accepted rows offer Reopen, all real labelled buttons', () => {
    resetUndo()
    const c = canvas([blk('g', 'goal', { title: 'Grow' }), blk('p', 'problem', { actions: ['resolve'] }),
      blk('r', 'requirement', { title: 'Fast' }), blk('s', 'stakeholder', { title: 'Execs', gapAck: ['gap-unserved'] }),
      blk('t', 'terminator')], [['g', 'p'], ['r', 'p'], ['s', 't']])
    const rows = [...attentionItems(c.blocks, c.arrows), ...acceptedItems(c.blocks, c.arrows)]
    const ul = rowsDom(rows)
    const act = kind => [...ul.querySelectorAll('li')].filter((li, i) => rows[i].kind === kind)
      .map(li => li.querySelector('[data-attention-act]'))
    act('gap').forEach(b => { assert.eq(b.dataset.attentionAct, 'accept'); assert.eq(b.tagName, 'BUTTON'); assert.eq(b.type, 'button') })
    act('criteria').forEach(b => assert.eq(b.dataset.attentionAct, 'accept'))
    assert.eq(act('accepted').length, 1)
    assert.eq(act('accepted')[0].dataset.attentionAct, 'reopen')
    assert.includes(act('accepted')[0].getAttribute('aria-label'), '"Execs"')
    ul.querySelectorAll('button').forEach(b => assert.ok(b.textContent.trim() || b.getAttribute('aria-label'), 'accessible name'))
  })
  it('offers no actions in read-only or embed views', () => {
    const c = canvas([blk('g', 'goal'), blk('p', 'problem')], [['g', 'p']])
    const rows = attentionItems(c.blocks, c.arrows)
    ;['readOnly', 'embed'].forEach(flag => {
      ui[flag] = true
      assert.eq(rowsDom(rows).querySelectorAll('[data-attention-act]').length, 0, flag)
      ui[flag] = false
    })
    assert.ok(rowsDom(rows).querySelectorAll('[data-attention-act]').length > 0)
  })
  it('Accept moves a gap to Accepted gaps in one undo step, Reopen brings it back', () => {
    load(canvas([blk('g', 'goal', { title: 'Grow' }), blk('p', 'problem', { actions: ['resolve'] })], [['g', 'p']]))
    resetUndo()
    const item = attentionItems(state.blocks, state.arrows).find(i => i.kind === 'gap' && i.id === 'g')
    assert.eq(item.gap, 'gap-no-req')
    assert.ok(runAttentionAction('accept', item))
    assert.eq(getUndoHistory().length, 1)
    assert.ok(!attentionItems(state.blocks, state.arrows).some(i => i.id === 'g'), 'no longer open')
    const acc = acceptedItems(state.blocks, state.arrows)
    assert.deepEq(acc.map(a => [a.id, a.gap, a.kind]), [['g', 'gap-no-req', 'accepted']])
    assert.ok(runAttentionAction('reopen', acc[0]))
    assert.eq(getUndoHistory().length, 2)
    assert.ok(attentionItems(state.blocks, state.arrows).some(i => i.id === 'g' && i.kind === 'gap'))
    assert.eq(acceptedItems(state.blocks, state.arrows).length, 0)
    undo()
    assert.deepEq(state.blocks.g.gapAck, ['gap-no-req'], 'undo of reopen re-accepts')
  })
  it('a criteria gap behind another gap gets no row of its own, and accepting it anyway stays visible', () => {
    // Regression: the row was offered, the acceptance was written, the toast
    // said it was listed under Accepted gaps, and the list stayed empty.
    load(canvas([blk('r', 'requirement', { title: 'Fast' })], []))
    resetUndo()
    assert.deepEq(attentionItems(state.blocks, state.arrows).map(i => `${i.kind}:${i.gap}`), ['gap:gap-isolated'])
    assert.ok(acceptGap('r', 'gap-no-criteria'), 'the inspector can still accept it')
    assert.deepEq(acceptedItems(state.blocks, state.arrows).map(a => [a.id, a.gap, a.live]), [['r', 'gap-no-criteria', true]])
    assert.ok(attentionItems(state.blocks, state.arrows).some(i => i.gap === 'gap-isolated'), 'isolation still raised')
  })
  it('a metric that measures no goal gets one row, and its target ack is listed when accepted', () => {
    load(canvas([blk('m', 'metric', { title: 'NPS' }), blk('i', 'implementation'), blk('r', 'requirement', { criteria: ['x'] })],
      [['i', 'm'], ['i', 'r']]))
    resetUndo()
    const rows = attentionItems(state.blocks, state.arrows).filter(i => i.id === 'm')
    assert.deepEq(rows.map(i => `${i.kind}:${i.gap}`), ['gap:gap-metric-no-goal'])
    const item = rows[0]
    assert.ok(runAttentionAction('accept', item))
    assert.deepEq(acceptedItems(state.blocks, state.arrows).map(a => a.gap), ['gap-metric-no-goal'])
    const next = attentionItems(state.blocks, state.arrows).filter(i => i.id === 'm')
    assert.deepEq(next.map(i => `${i.kind}:${i.gap}`), ['criteria:gap-no-target'], 'the next rule speaks, as a criteria row')
    assert.ok(runAttentionAction('accept', next[0]))
    assert.deepEq(acceptedItems(state.blocks, state.arrows).map(a => a.gap), ['gap-metric-no-goal', 'gap-no-target'])
    assert.eq(getUndoHistory().length, 2)
  })
  it('an unanchored assumption is one row, and accepting the gap leaves it an unverified assumption', () => {
    load(canvas([blk('a', 'assumption', { title: 'Users want it' }), blk('p', 'process'), blk('t', 'terminator')],
      [['a', 'p'], ['t', 'p']]))
    resetUndo()
    const rows = attentionItems(state.blocks, state.arrows).filter(i => i.id === 'a')
    assert.deepEq(rows.map(i => `${i.kind}:${i.gap || ''}`), ['gap:gap-assumption'])
    assert.ok(runAttentionAction('accept', rows[0]))
    assert.deepEq(attentionItems(state.blocks, state.arrows).filter(i => i.id === 'a').map(i => i.kind), ['assumption'])
  })
  it('a stale acceptance is marked and cleared, an unknown one is named by its id', () => {
    load(canvas([blk('g', 'goal', { title: 'Ship', gapAck: ['gap-no-req', 'gap-from-later'] }), blk('r', 'requirement', { criteria: ['x'] })],
      [['r', 'g']]))
    resetUndo()
    const acc = acceptedItems(state.blocks, state.arrows)
    assert.deepEq(acc.map(a => a.live), [null, false], 'standing first, stale last')
    assert.includes(acc[0].detail, 'gap-from-later')
    assert.includes(acc[1].detail, 'no longer applies')
    const ul = rowsDom(acc)
    const acts = [...ul.querySelectorAll('[data-attention-act]')]
    assert.deepEq(acts.map(b => [b.dataset.attentionAct, b.textContent]), [['reopen', 'Reopen'], ['reopen', 'Clear']])
    assert.ok(runAttentionAction('reopen', acc[1]))
    assert.deepEq(state.blocks.g.gapAck, ['gap-from-later'])
  })
  it('unaccepting one of several keeps the others', () => {
    load(canvas([blk('m', 'metric', { gapAck: ['gap-metric-no-goal', 'gap-no-target'] }), blk('i', 'implementation')], [['i', 'm']]))
    resetUndo()
    assert.ok(unacceptGap('m', 'gap-metric-no-goal'))
    assert.deepEq(state.blocks.m.gapAck, ['gap-no-target'])
    assert.eq(blockGap('m'), 'gap-metric-no-goal')
    assert.eq(getUndoHistory().length, 1)
  })
  it('unknown actions and missing rows change nothing', () => {
    load(canvas([blk('g', 'goal')], []))
    resetUndo()
    assert.ok(!runAttentionAction('explode', { id: 'g', gap: 'gap-isolated' }))
    assert.ok(!runAttentionAction('accept', null))
    assert.eq(getUndoHistory().length, 0)
  })
})

// ── One wording for a gap ────────────────────────────────────

describe('Insights: gap wording', () => {
  it('gapExplain drops the prompt tag and leads with the short name', () => {
    assert.eq(gapExplain('gap-isolated'), 'Isolated: not linked to anything on the canvas')
    GAP_ORDER.forEach(g => {
      assert.ok(gapExplain(g).startsWith(GAP_META[g].short + ': '), g)
      assert.ok(!gapExplain(g).includes('\u2014'), g + ' has no em dash')
    })
    assert.eq(gapExplain('gap-nope'), 'gap-nope')
  })
  it('the row shows the short name, and its tooltip is the card icon\'s sentence', () => {
    load(canvas([blk('m', 'metric'), blk('i', 'implementation')], [['i', 'm']]))
    runGapDetection()
    const icon = document.querySelector('#gi-m .gap-icon')
    assert.eq(icon.getAttribute('title'), gapExplain('gap-metric-no-goal'))
    const rows = attentionItems(state.blocks, state.arrows)
    const i = rows.findIndex(r => r.id === 'm' && r.kind === 'gap')
    assert.eq(rows[i].detail, GAP_META['gap-metric-no-goal'].short)
    const li = rowsDom(rows).children[i]
    assert.eq(li.querySelector('.attention-item').getAttribute('title'), gapExplain('gap-metric-no-goal'))
    assert.eq(li.querySelector('.attention-detail').textContent, 'Metric measuring no goal')
  })
  it('fixes for the new rules name the missing step', () => {
    const cases = [
      [[blk('i', 'implementation'), blk('s', 'resource')], [['s', 'i']], 'i', 'Why'],
      [[blk('o', 'output'), blk('i', 'implementation'), blk('m', 'metric')], [['i', 'o'], ['i', 'm']], 'o', 'Who'],
      [[blk('m', 'metric'), blk('i', 'implementation')], [['i', 'm']], 'm', 'Why'],
      [[blk('m', 'metric'), blk('g', 'goal')], [['m', 'g']], 'm', 'Proof'],
      [[blk('o', 'output'), blk('r', 'requirement')], [['o', 'r']], 'o', 'How'],
    ]
    cases.forEach(([list, pairs, id, step]) => {
      load(canvas(list, pairs), { dom: false })
      const text = getGapFixes(state.blocks[id]).map(f => f.text).join(' ')
      assert.includes(text, step, `${id}: ${text}`)
    })
  })
})

// ── The prompt and the Attention tab agree ───────────────────

function gapSection(prompt) {
  const start = prompt.indexOf('## Planning Gaps Detected')
  if (start < 0) return ''
  const end = prompt.indexOf('\n## ', start + 3)
  return prompt.slice(start, end < 0 ? undefined : end)
}

describe('Insights: the prompt gap section and the Attention tab list the same gaps', () => {
  it('on the re-typed reporting canvas', () => {
    load(userCanvas(true))
    devOpts.mode = 'plan'
    ui.promptDirty = true
    const section = gapSection(generatePrompt())
    assert.ok(section, 'the prompt has a gap section')
    const r = detectGaps(state.blocks, state.arrows)
    const items = attentionItems(state.blocks, state.arrows)
    r.details.forEach(d => {
      assert.includes(section, `"${d.title}"`, 'prompt lists ' + d.title)
      assert.includes(section, GAP_META[d.gaps[0]].prompt)
      assert.ok(items.some(i => i.id === d.id && i.gap === d.gaps[0]), 'attention lists ' + d.title)
    })
    items.filter(i => i.kind === 'gap').forEach(i => assert.includes(section, `"${i.title}"`, 'and the other way: ' + i.title))
    r.canvasFindings.forEach(f => assert.includes(section, f))
    assert.eq(items.filter(i => i.kind === 'canvas').length, r.canvasFindings.length)
  })
  it('an accepted gap leaves both lists together', () => {
    load(userCanvas(true))
    state.blocks.w1.gapAck = ['gap-no-consumer']
    ui.promptDirty = true
    const section = gapSection(generatePrompt())
    assert.notIncludes(section, '"Multi Reports"')
    assert.ok(!attentionItems(state.blocks, state.arrows).some(i => i.id === 'w1' && i.kind === 'gap'))
    assert.deepEq(acceptedItems(state.blocks, state.arrows).map(a => a.id), ['w1'])
  })
  it('every gap or criteria row maps to a line the prompt prints, on every kind of map', () => {
    const maps = [
      userCanvas(true), userCanvas(false),
      canvas([blk('r', 'requirement', { title: 'Lonely req' })], []),
      canvas([blk('m', 'metric', { title: 'NPS' }), blk('i', 'implementation', { title: 'Build' }), blk('r', 'requirement', { criteria: ['x'] })], [['i', 'm'], ['i', 'r']]),
      canvas([blk('a', 'assumption', { title: 'Users want it' }), blk('p', 'process'), blk('t', 'terminator')], [['a', 'p'], ['t', 'p']]),
    ]
    devOpts.mode = 'plan'
    const check = label => {
      ui.promptDirty = true
      const section = gapSection(generatePrompt())
      const rows = attentionItems(state.blocks, state.arrows).filter(i => i.kind === 'gap' || i.kind === 'criteria')
      rows.forEach(i => {
        assert.includes(section, `"${i.title}": ${GAP_META[i.gap].prompt}`, `${label}: ${i.title}`)
      })
      const perBlock = rows.map(i => i.id)
      assert.eq(perBlock.length, new Set(perBlock).size, label + ': one gap row per block')
    }
    maps.forEach((c, n) => { load(c); check('map ' + n) })
    Object.keys(TEMPLATE_GAPS).forEach(name => { loadTemplate(TEMPLATES.find(t => t.name === name)); check(name) })
  })
  it('an Accepted gaps section in the prompt, when this build prints one, is one section listing the same gaps', () => {
    // generatePrompt is TYPES-owned; the stream that prints this section reads
    // gapAck, which is what acceptedItems lists. Two sections, or a list that
    // differs from the Attention tab, is the disagreement this guards.
    load(canvas([blk('r', 'requirement', { title: 'Lonely req', gapAck: ['gap-no-criteria'] }),
      blk('g', 'goal', { title: 'Grow', gapAck: ['gap-no-req'] }), blk('p', 'problem', { actions: ['resolve'] }),
      blk('s', 'requirement', { title: 'Done already', criteria: ['x'], gapAck: ['gap-no-criteria'] })], [['g', 'p'], ['s', 'p']]))
    ui.promptDirty = true
    const p = generatePrompt()
    const n = p.split('## Accepted gaps').length - 1
    assert.ok(n <= 1, 'at most one Accepted gaps section')
    const acc = acceptedItems(state.blocks, state.arrows).filter(a => a.live !== false)
    assert.deepEq(acc.map(a => a.title), ['Lonely req', 'Grow'], 'the stale one is not a standing acceptance')
    if (n) {
      const start = p.indexOf('## Accepted gaps'), end = p.indexOf('\n## ', start + 3)
      const section = p.slice(start, end < 0 ? undefined : end)
      acc.forEach(a => assert.includes(section, `"${a.title}"`))
      assert.notIncludes(section, '"Done already"')
      assert.eq((section.match(/^\u2022 /gm) || []).length, acc.length)
    }
  })
})

// ── Relations: who and how-we-know do not order work ─────────

describe('Insights: unlabelled arrows at a stakeholder or metric add no task order', () => {
  const B = {
    i: { id: 'i', type: 'implementation', title: 'Build' }, m: { id: 'm', type: 'metric', title: 'KR' },
    s: { id: 's', type: 'stakeholder', title: 'Execs' }, o: { id: 'o', type: 'output', title: 'Report' },
    r: { id: 'r', type: 'requirement', title: 'Req' },
  }
  it('reads as informs with the blocks, and only then', () => {
    assert.eq(relationOf({ from: 'i', to: 'm' }, B), 'informs')
    assert.eq(relationOf({ from: 'o', to: 's' }, B), 'informs')
    assert.eq(relationOf({ from: 's', to: 'o' }, B), 'informs')
    assert.eq(relationOf({ from: 'i', to: 'm' }), 'precedes', 'without blocks nothing changes')
    assert.eq(relationOf({ from: 'i', to: 'r' }, B), 'precedes', 'other types keep their order')
  })
  it('an explicit relation or a label still wins', () => {
    assert.eq(relationOf({ from: 'i', to: 'm', relation: 'precedes' }, B), 'precedes')
    assert.eq(relationOf({ from: 'i', to: 'm', label: 'requires' }, B), 'depends-on')
    assert.eq(relationOf({ from: 'i', to: 'm', label: 'feeds' }, B), 'precedes', 'an unknown label keeps the drawn order')
  })
  it('drops out of dependency edges and says so in the hint', () => {
    const arrows = [{ from: 'i', to: 'm' }, { from: 'i', to: 'o' }, { from: 'o', to: 's' }, { from: 'r', to: 'i' }]
    assert.deepEq(dependencyEdges(B, arrows), [{ from: 'i', to: 'o' }, { from: 'r', to: 'i' }])
    assert.eq(relationHint({ from: 'o', to: 's' }, B), 'Provides context without changing task order.')
  })
  it('writing out the implied verb means what the unlabelled arrow means', () => {
    // Regression: "should move" and "measures", the tool's own suggestions,
    // read as unknown labels and so as "comes before", closing a false cycle.
    assert.eq(relationOf({ from: 'i', to: 'm', label: impliedVerb('implementation', 'metric') }, B), 'informs')
    assert.eq(relationOf({ from: 'm', to: 'g', label: 'Measures' }, { ...B, g: { id: 'g', type: 'goal' } }), 'informs')
    assert.eq(relationOf({ from: 'o', to: 's', label: 'delivered to: weekly' }, B), 'informs')
    assert.eq(relationOf({ from: 'r', to: 'm', label: 'measures' }, B), 'informs', 'the verb reads the same on another pair at a metric')
    assert.eq(relationOf({ from: 'i', to: 'r', label: 'satisfies' }, B), 'precedes', 'an ordering pair keeps its order')
    assert.eq(relationOf({ from: 'i', to: 'r', label: 'measures' }, B), 'precedes', 'no metric or stakeholder, no change')
    const G = [blk('g', 'goal'), blk('i', 'implementation'), blk('m', 'metric', { criteria: ['x'] })]
    const lab = canvas(G, [['g', 'i'], ['i', 'm'], ['m', 'g']])
    lab.arrows[1].label = impliedVerb('implementation', 'metric')
    lab.arrows[2].label = impliedVerb('metric', 'goal')
    assert.ok(!kinds(lab).includes('cycle'), 'no false cycle')
    assert.eq(relationHint(lab.arrows[2], lab.blocks), 'Provides context without changing task order.')
  })
  it('a metric loop is no longer a dependency cycle', () => {
    const c = canvas([blk('i', 'implementation'), blk('m', 'metric', { criteria: ['x'] }), blk('g', 'goal')],
      [['i', 'm'], ['m', 'g'], ['g', 'i']])
    assert.ok(!kinds(c).includes('cycle'))
  })
})

// ── Health ───────────────────────────────────────────────────

describe('Insights: health agrees with the refined goal rule', () => {
  it('a goal measured by a metric is not penalised for having no requirement', () => {
    const withMetric = canvas([blk('g', 'goal'), blk('m', 'metric', { criteria: ['80%'] })], [['m', 'g']])
    const withProblem = canvas([blk('g', 'goal'), blk('p', 'problem', { actions: ['resolve'] })], [['g', 'p']])
    load(withMetric); const measured = computeHealthScore()
    load(withProblem); const unsupported = computeHealthScore()
    // Same block count, no descriptions: the only differences are the goal gap
    // (8) and the no-support penalty (8).
    assert.eq(measured - unsupported, 16)
  })
})

describe('Insights: health agrees with the no-Why finding', () => {
  it('a problem-rooted map is not docked for having no goal; a map with no Why is', () => {
    // Three blocks, no descriptions, no connections: the same gaps and the
    // same description penalty on both sides, so the difference is the Why.
    load(canvas([blk('p', 'problem'), blk('r', 'requirement', { criteria: ['x'] }), blk('s', 'requirement', { criteria: ['y'] })], []))
    const withProblem = computeHealthScore()
    load(canvas([blk('p', 'requirement', { criteria: ['z'] }), blk('r', 'requirement', { criteria: ['x'] }), blk('s', 'requirement', { criteria: ['y'] })], []))
    const noWhy = computeHealthScore()
    // A problem's missing description costs 3, a requirement's 6.
    assert.eq(withProblem - noWhy, 12 + 3)
  })
})

describe('Insights: the next empty step', () => {
  it('walks Why, Who, Proof, What, How, Doubt and ignores Other', () => {
    const map = types => Object.fromEntries(types.map((t, i) => ['n' + i, blk('n' + i, t)]))
    assert.eq(nextEmptyStep({}).id, 'why')
    assert.eq(nextEmptyStep(map(['custom', 'context'])).id, 'why', 'Other and Context fill no step')
    assert.eq(nextEmptyStep(map(['problem'])).id, 'who')
    assert.eq(nextEmptyStep(map(['goal', 'stakeholder'])).id, 'proof')
    assert.eq(nextEmptyStep(map(['goal', 'stakeholder', 'metric', 'output'])).id, 'how')
    assert.eq(nextEmptyStep(map(['goal', 'stakeholder', 'metric', 'requirement', 'process'])).id, 'doubt')
    assert.eq(nextEmptyStep(map(['goal', 'stakeholder', 'metric', 'requirement', 'decision', 'risk'])), null)
    assert.ok(nextEmptyStep({}).hint, 'carries the question to ask')
  })
})

// ── Accepting a canvas finding ───────────────────────────────

describe('Insights: canvas findings can be accepted per block', () => {
  const dupMap = () => canvas([blk('x', 'output', { title: 'End of Sprint' }), blk('y', 'terminator', { title: 'Every End of Sprint' }),
    blk('g', 'goal', { title: 'Grow' })], [['y', 'x'], ['x', 'g']])
  it('accepting a duplicate keeps both blocks out of it, in one undo step, and lists both as accepted', () => {
    load(dupMap())
    resetUndo()
    const row = attentionItems(state.blocks, state.arrows).find(i => i.finding === 'duplicate')
    assert.eq(row.ack, FINDING_ACKS.duplicate)
    assert.eq(row.title, FINDING_META.duplicate.short)
    assert.ok(runAttentionAction('accept', row))
    assert.eq(getUndoHistory().length, 1)
    assert.ok(!kinds(state).includes('duplicate'))
    assert.deepEq(acceptedItems(state.blocks, state.arrows).map(a => [a.id, a.gap, a.live]),
      [['x', 'gap-finding-duplicate', true], ['y', 'gap-finding-duplicate', true]])
    assert.ok(!attentionItems(state.blocks, state.arrows).some(i => i.kind === 'canvas'), 'the badge can reach zero')
    undo()
    assert.ok(kinds(state).includes('duplicate'))
  })
  it('a new block that duplicates an accepted one is still raised, and reopening one brings the pair back', () => {
    load(dupMap())
    resetUndo()
    assert.eq(acceptFinding({ kind: 'duplicate', ids: ['x', 'y'] }), 2)
    state.blocks.z = blk('z', 'output', { title: 'end of sprint' })
    let f = detectGaps(state.blocks, state.arrows).findings.find(x => x.kind === 'duplicate')
    assert.ok(f && f.ids.includes('z'), 'z is raised with the blocks it repeats')
    assert.notIncludes(f.text, '"End of Sprint" and "Every End of Sprint"', 'the accepted pair stays apart')
    delete state.blocks.z
    assert.ok(unacceptGap('x', FINDING_ACKS.duplicate))
    f = detectGaps(state.blocks, state.arrows).findings.find(x => x.kind === 'duplicate')
    assert.deepEq(f.ids.sort(), ['x', 'y'])
  })
  it('a hidden question, a goal with no metric and a metric no work moves are accepted per block', () => {
    load(canvas([blk('w', 'output', { title: 'Weekly', description: 'Still used?' }), blk('i', 'implementation'),
      blk('g', 'goal', { title: 'Grow' }), blk('m', 'metric', { title: 'NPS', criteria: ['50'] }), blk('h', 'goal', { title: 'Keep' })],
      [['i', 'w'], ['m', 'g'], ['i', 'h']]))
    resetUndo()
    assert.deepEq(kinds(state).sort(), ['goal-no-metric', 'hidden-question', 'metric-unmoved'])
    ;['hidden-question', 'goal-no-metric', 'metric-unmoved'].forEach(kind => {
      const f = detectGaps(state.blocks, state.arrows).findings.find(x => x.kind === kind)
      assert.ok(acceptFinding(f) > 0, kind)
    })
    assert.deepEq(kinds(state), [])
    assert.deepEq(acceptedItems(state.blocks, state.arrows).map(a => `${a.id}:${a.gap}`).sort(),
      ['h:gap-finding-goal-no-metric', 'm:gap-finding-metric-unmoved', 'w:gap-finding-hidden-question'])
    state.blocks.w.description = 'Weekly, yes.'
    assert.eq(acceptedItems(state.blocks, state.arrows).find(a => a.id === 'w').live, false, 'answered since: no longer applies')
  })
  it('findings that are things to fix, not to keep, cannot be accepted', () => {
    load(canvas([blk('a', 'custom'), blk('b', 'custom'), blk('c', 'custom', { typeCheck: true })], []))
    resetUndo()
    assert.eq(acceptFinding({ kind: 'untyped', ids: ['a', 'b', 'c'] }), 0)
    assert.eq(acceptFinding({ kind: 'type-check', ids: ['c'] }), 0)
    assert.ok(!acceptGap('a', 'gap-finding-made-up'))
    ui.readOnly = true
    assert.eq(acceptFinding({ kind: 'duplicate', ids: ['a', 'b'] }), 0)
    ui.readOnly = false
    assert.eq(getUndoHistory().length, 0)
    const rows = attentionItems(state.blocks, state.arrows).filter(i => i.kind === 'canvas')
    const acts = [...rowsDom(rows).querySelectorAll('li')].map(li => li.querySelector('[data-attention-act]')?.dataset.attentionAct || '')
    assert.deepEq(rows.map(r => r.finding), ['untyped', 'type-check'])
    // Each offers a fix, never an Accept: suggesting types for the untyped
    // blocks, and keeping the automatic types (which settles each check).
    assert.deepEq(acts, ['suggest-types', 'confirm-types'])
    assert.ok(!acts.includes('accept'))
  })
  it('every finding ack has metadata the prompt can print', () => {
    Object.values(FINDING_ACKS).forEach(g => {
      assert.ok(GAP_META[g]?.short && GAP_META[g]?.prompt, g)
      assert.match(g, /^gap-[a-z0-9-]{1,40}$/, 'normalize keeps it')
    })
  })
})

describe('Insights: whole-canvas rows with no block are not buttons', () => {
  it('renders them as plain text, out of the Tab order, and keeps block rows as buttons', () => {
    const c = canvas(['a', 'b', 'c', 'd', 'e'].map(id => blk(id, 'requirement', { criteria: ['x'] })),
      [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']])
    c.blocks.e.title = 'Ship it'
    const rows = attentionItems(c.blocks, c.arrows)
    const i = rows.findIndex(r => r.finding === 'no-why')
    assert.ok(i >= 0)
    assert.eq(rows[i].id, null)
    const lis = rowsDom(rows).children
    assert.eq(lis[i].querySelector('button'), null, 'no dead button')
    assert.ok(lis[i].querySelector('.attention-static'))
    assert.ok(!lis[i].querySelector('[data-attention]'))
    rows.forEach((r, n) => { if (r.id) assert.eq(lis[n].querySelector('.attention-item').tagName, 'BUTTON') })
  })
})

describe('Insights: attentionModel is one detection pass for both lists', () => {
  it('returns the open rows and the accepted rows that attentionItems and acceptedItems return', () => {
    const c = userCanvas(true)
    c.blocks.w1.gapAck = ['gap-no-consumer']
    const m = attentionModel(c.blocks, c.arrows)
    assert.deepEq(m.items, attentionItems(c.blocks, c.arrows))
    assert.deepEq(m.accepted, acceptedItems(c.blocks, c.arrows))
  })
})

// ── QA round ────────────────────────────────────────────────
describe('Insights: QA round', () => {
  const full = (id, extra = {}) => ({ id, type: 'goal', title: id, description: '', notes: '', x: 40, y: 40,
    actions: [], questions: [], docRef: null, width: null, color: null, collapsed: false, groupId: null,
    status: null, priority: null, criteria: [], ...extra })

  it('a card keeps the gap outline and icon the checks report when it is re-rendered without a new check', () => {
    cleanupMockEls()
    state.blocks = { g: full('g', { title: 'Grow retention' }) }
    state.arrows = []; state.groups = {}
    renderBlock('g')
    runGapDetection()
    const el = () => document.getElementById('b-g')
    const icon = () => document.getElementById('gi-g')?.innerHTML || ''
    assert.ok(el().classList.contains('gap-isolated'), 'detected')
    renderBlock('g')
    assert.ok(el().classList.contains('gap-isolated'), 'a plain re-render keeps the outline')
    assert.includes(icon(), '<svg', 'and the icon')
    startInlineEdit('g', 'title')
    commitInlineEdit()   // nothing changed: the card is re-rendered, no check runs
    assert.ok(el().classList.contains('gap-isolated'), 'an edit that changed nothing keeps it too')
    assert.includes(icon(), '<svg')
    state.blocks = {}
    cleanupMockEls()
    runGapDetection()
  })

  it('the duplicate-title check splits each title once, not once per pair', () => {
    const blocks = {}
    for (let i = 0; i < 80; i++) blocks['d' + i] = full('d' + i, { type: 'requirement', title: `Weekly report number ${i} for the team` })
    const split = String.prototype.split
    let n = 0
    String.prototype.split = function (...args) { n++; return split.apply(this, args) }
    try { detectGaps(blocks, []) } finally { String.prototype.split = split }
    assert.ok(n < 80 * 10, `${n} splits for 80 titles (a split per pair would be over 6000)`)
  })

  it('Attention refreshes on a settled save, not on every keystroke\'s pending one', () => {
    const host = document.createElement('div')
    host.innerHTML = '<span id="attentionCount" hidden></span><select id="attentionFilter"><option value="">All items</option></select>' +
      '<p id="attentionSummary"></p><ul id="attentionList"></ul>'
    document.body.appendChild(host)
    const phase = saveStatus.phase
    try {
      state.blocks = { a: full('a') }; state.arrows = []; state.groups = {}
      setupAttention()
      const count = () => document.getElementById('attentionCount').textContent
      const first = count()
      state.blocks.b = full('b', { type: 'problem' })
      saveStatus.phase = 'pending'
      window.dispatchEvent(new CustomEvent('pf:save-status'))
      assert.eq(count(), first, 'a pending save does not re-run the checks')
      saveStatus.phase = 'saved'
      window.dispatchEvent(new CustomEvent('pf:save-status'))
      assert.neq(count(), first, 'a settled save does')
    } finally {
      saveStatus.phase = phase
      host.remove()
      state.blocks = {}
    }
  })

  // The Brief tab's readiness line replaced the score and the gap badge
  // (2026-10-03); every part of it reads at 4.5:1 in light mode.
  it('light mode: the Brief tab\'s readiness line is readable', async () => {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;left:-5000px;top:0;width:600px;height:300px;border:0'
    frame.srcdoc = '<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css"></head><body class="light-mode">' +
      '<div class="right-panel"><p class="brief-ready"><span><strong>5 open items</strong>: 2 questions, 3 gaps.</span> ' +
      '<button class="brief-link">Review</button></p><p class="brief-diff">Since your last copy: 1 block added.</p>' +
      '<span class="brief-tokens">About 2.4k tokens</span></div></body></html>'
    const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
    document.body.appendChild(frame)
    await loaded
    try {
      const doc = frame.contentDocument, win = frame.contentWindow
      const rgbOf = c => cssRgba(c) || []
      const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
      const over = (fg, bg) => { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)) }
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
      const page = rgbOf(win.getComputedStyle(doc.body).backgroundColor)
      const panel = over(rgbOf(win.getComputedStyle(doc.querySelector('.right-panel')).backgroundColor), page)
      for (const sel of ['.brief-ready', '.brief-ready strong', '.brief-link', '.brief-diff', '.brief-tokens']) {
        const r = ratio(rgbOf(win.getComputedStyle(doc.querySelector(sel)).color), panel)
        assert.ok(r >= 4.5, `${sel} ${r.toFixed(2)}:1`)
      }
    } finally { frame.remove() }
  })
})
