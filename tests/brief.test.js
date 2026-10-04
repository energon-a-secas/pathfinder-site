// ============================================================
//  brief.test.js: the BRIEF stream (design round, wave 2). The
//  prompt read as a document: the Markdown it renders, the
//  readiness line counted the way the Attention tab counts, the
//  framing summary, presets that cannot disagree with Running in,
//  the size estimate, the scoped brief, Copy and the tab's markup.
// ============================================================

import { describe, it, assert, cssRgba } from './test-utils.js'
import { state, selection, ui, devOpts, canvasMeta, promptState } from '../js/state.js'
import { SITUATION_DEFAULT } from '../js/utils.js'
import { generatePrompt, generateScopedPrompt, briefScope, scopedGapText, estimateTokens, roundTokens,
         formatTokens, briefOutline, briefSectionCount, getPromptDiff, CHARS_PER_TOKEN, focusChecklist } from '../js/prompt.js'
import { runGapDetection } from '../js/gaps.js'
import { attentionModel } from '../js/attention.js'
import { briefHtml, briefInline } from '../js/brief-md.js'
import { readiness, copiedSummary, renderBrief, setBriefScope, briefScopeNow,
         copyBrief, isCopyBriefKey, sizeNote, setFraming, followReplyPanel, wireSizeNote } from '../js/brief.js'
import { framingSummary, PRESETS, presetMatches, applyPreset, setupSituation, setupDevOptions, syncReadonlyValues, setupExportDropdown } from '../js/ui-panels.js'

// ── A small map ──────────────────────────────────────────────
// A goal threatened by a risk that a job mitigates, a requirement with no
// criteria, an assumption under the goal. Selecting the goal scopes in the
// requirement, the assumption and the risk, but not the job that mitigates
// the risk: the case where a part read on its own would lie.
const B = (id, type, title, extra = {}) => ({ id, type, title, description: '', x: 0, y: 0, ...extra })
function fixture() {
  state.blocks = {
    g1: B('g1', 'goal', 'Faster status notes'),
    r1: B('r1', 'requirement', 'One place for the numbers'),
    a1: B('a1', 'assumption', 'Teams read the digest', { actions: ['validate'] }),
    k1: B('k1', 'risk', 'Owner leaves'),
    i2: B('i2', 'implementation', 'Weekly digest job'),
  }
  state.arrows = [
    { id: 'e1', from: 'g1', to: 'r1' },
    { id: 'e2', from: 'a1', to: 'g1' },
    { id: 'e3', from: 'g1', to: 'k1' },
    { id: 'e4', from: 'k1', to: 'i2' },
    { id: 'e5', from: 'i2', to: 'r1' },
  ]
  state.groups = {}
}
function clear() {
  state.blocks = {}; state.arrows = []; state.groups = {}
  selection.ids.clear(); selection.blockId = null
}

// ── Markdown ─────────────────────────────────────────────────
describe('brief: the brief renders as a document', () => {
  it('headings become sections with ids, counted with their top-level items', () => {
    const { html, sections } = briefHtml('## Situation\n- one\n- two\n\n## Task\nDo it.\n\n---\n\n# My map\n\n## Goals\n• A\n• B\n• C\n')
    assert.deepEq(sections.map(s => [s.level, s.title, s.items]), [[2, 'Situation', 2], [2, 'Task', 0], [1, 'My map', 0], [2, 'Goals', 3]])
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
    assert.eq(doc.getElementById(sections[0].id).textContent, 'Situation')
    assert.eq(doc.getElementById(sections[0].id).getAttribute('tabindex'), '-1')
    assert.ok(doc.querySelector('hr'), 'the rule')
    assert.eq(doc.querySelectorAll('.md-list').length, 2)
  })

  it('an indented line continues its item, a nested list stays inside it, in order', () => {
    const text = '## Requirements\n• [HIGH] One place\n  The numbers live in one sheet\n  Acceptance criteria:\n    - Every team reads it\n    - Updated weekly\n  Rationale: fewer copies\n• Second\n'
    const { html } = briefHtml(text)
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
    const items = doc.querySelectorAll('.md-list > li')
    const first = [...items].find(li => li.textContent.includes('One place'))
    assert.ok(first, 'the first item')
    const parts = [...first.querySelector('.md-item').children].map(el => el.className)
    assert.deepEq(parts, ['md-text', 'md-list', 'md-text'], 'text, the criteria, then the rationale after them')
    assert.includes(first.querySelector('.md-text').innerHTML, 'The numbers live in one sheet')
    assert.eq(first.querySelectorAll('.md-list li').length, 2)
    assert.includes(first.lastElementChild.textContent, 'Rationale: fewer copies')
  })

  it('escapes the author\'s text: a title can never become markup', () => {
    const { html } = briefHtml('## Goals\n• <img src=x onerror="alert(1)"> **bold** `code` [x](javascript:alert(1))\n')
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
    assert.ok(!doc.querySelector('img'), 'no element from the text')
    assert.ok(!doc.querySelector('a'), 'no link from a javascript: address')
    assert.eq(doc.querySelector('strong').textContent, 'bold')
    assert.eq(doc.querySelector('code').textContent, 'code')
    assert.includes(doc.body.textContent, '<img src=x onerror="alert(1)">')
  })

  it('https addresses link out safely; fenced code and task boxes read as what they are', () => {
    const a = briefInline('spec: https://pathfinder.neorgon.com/llms.txt). End with a fenced ```pathfinder-patch``` block')
    const doc = new DOMParser().parseFromString(`<p>${a}</p>`, 'text/html')
    const link = doc.querySelector('a')
    assert.eq(link.getAttribute('href'), 'https://pathfinder.neorgon.com/llms.txt')
    assert.eq(link.getAttribute('rel'), 'noopener noreferrer')
    assert.eq(doc.querySelector('code').textContent, 'pathfinder-patch')
    const { html } = briefHtml('## Implementation checklist\n- [ ] Write it\n- [x] Ship it\n\n```\n## not a heading\n```\n')
    const d2 = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
    assert.eq(d2.querySelectorAll('.md-check').length, 2)
    assert.eq(d2.querySelectorAll('.md-check.done').length, 1)
    assert.eq(d2.querySelector('.md-check').getAttribute('aria-label'), 'To do')
    assert.eq(d2.querySelectorAll('h3').length, 1, 'a heading inside a fence is code')
    assert.includes(d2.querySelector('pre').textContent, '## not a heading')
  })

  it('renders every heading of a real brief, and its outline agrees', () => {
    fixture()
    try {
      const text = generatePrompt()
      const { sections } = briefHtml(text)
      const outline = briefOutline(text)
      assert.deepEq(sections.map(s => s.title), outline.map(s => s.title))
      assert.eq(sections.filter(s => s.level === 2).length, briefSectionCount(text))
      assert.ok(outline.some(s => s.title === 'Situation'))
      assert.ok(outline.some(s => s.title === 'When you reply'))
    } finally { clear() }
  })
})

// ── Size ─────────────────────────────────────────────────────
describe('brief: the size estimate', () => {
  it('uses the measured Markdown ratio and rounds to what it can claim', () => {
    assert.eq(CHARS_PER_TOKEN, 2.99)
    assert.eq(estimateTokens(''), 0)
    assert.eq(estimateTokens('x'.repeat(7215)), Math.round(7215 / 2.99))
    assert.eq(roundTokens(2413), 2400)
    assert.eq(roundTokens(637), 640)
    assert.eq(formatTokens(2413), '2.4k tokens')
    assert.eq(formatTokens(637), '640 tokens')
    assert.eq(formatTokens(18342), '18k tokens')
    assert.eq(formatTokens(1000 * 2.99 / 2.99), '1k tokens')
  })

  it('a copy says what went: about N tokens, M sections', () => {
    const text = '## Situation\n- a\n\n## Task\nb\n'
    assert.eq(copiedSummary(text), `about ${roundTokens(estimateTokens(text))} tokens, 2 sections`)
    assert.match(copiedSummary('## One\nx'), /, 1 section$/)
  })
})

// ── Readiness ────────────────────────────────────────────────
describe('brief: one readiness line, counted the way Attention counts', () => {
  it('the count is the Attention tab\'s count, broken down by its kinds', () => {
    fixture()
    try {
      const model = attentionModel(state.blocks, state.arrows, { groups: state.groups })
      const r = readiness(model)
      assert.eq(r.open, model.items.length, 'the same number as the Attention badge')
      assert.ok(r.open > 0)
      assert.match(r.text, new RegExp(`^${r.open} open items?: `))
      const sum = r.parts.reduce((n, p) => n + parseInt(p, 10), 0)
      assert.eq(sum, r.open, 'the parts add up to the count')
      if (model.items.some(i => i.kind === 'criteria')) assert.ok(r.parts.some(p => /requirements? without criteria$/.test(p)))
    } finally { clear() }
  })

  it('says plainly when nothing is open, and counts acceptances apart', () => {
    assert.eq(readiness({ items: [], accepted: [] }).text, 'No open items.')
    assert.eq(readiness({ items: [], accepted: [{ live: true }, { live: false }] }).text, 'No open items; 1 accepted gap.')
    const one = readiness({ items: [{ kind: 'question' }], accepted: [] })
    assert.eq(one.text, '1 open item: 1 question.')
    assert.eq(readiness({ items: [{ kind: 'gap' }, { kind: 'gap' }, { kind: 'blocked' }], accepted: [] }).text, '3 open items: 1 blocked, 2 gaps.')
  })

  it('says what is open, by type: "2 risks, 1 decision", not "3 gaps"', () => {
    const gap = (type, g) => ({ kind: 'gap', type, gap: g })
    const r = readiness({ items: [gap('risk', 'gap-no-mitigation'), gap('decision', 'gap-no-basis'), gap('risk', 'gap-no-mitigation')], accepted: [] })
    assert.eq(r.text, '3 open items: 1 decision, 2 risks.')
    // Isolation is about connections, whatever the type; a metric's
    // criteria are its targets.
    const r2 = readiness({ items: [gap('goal', 'gap-isolated'), gap('stakeholder', 'gap-isolated'), { kind: 'criteria', type: 'requirement', gap: 'gap-no-criteria' },
      { kind: 'criteria', type: 'metric', gap: 'gap-no-target' }, { kind: 'criteria', type: 'requirement', gap: 'gap-no-criteria' }, gap('implementation', 'gap-no-purpose')], accepted: [] })
    assert.eq(r2.text, '6 open items: 1 metric without a target, 2 requirements without criteria, 1 work item, 2 unconnected blocks.')
    assert.ok(!/\bgaps?\b/.test(r2.text), 'no bare "gaps" when the types are known')
  })
})

// ── Framing and presets ──────────────────────────────────────
describe('brief: the framing row and the presets', () => {
  it('reads the Situation back as one line', () => {
    assert.eq(framingSummary({ codebase: 'current', runtime: 'code', firstMove: 'read' }, ''), 'This repo, in Claude Code, read the code first')
    assert.eq(framingSummary({}, ''), 'No code yet, in a chat, propose a plan first')
    assert.eq(framingSummary({ runtime: 'ide' }, ''), 'No code yet, in an IDE, propose a plan first')
    assert.eq(framingSummary({ constraints: 'No new dependencies\n\nShip behind a flag' }, 'For the platform team'),
      'No code yet, in a chat, propose a plan first; 2 boundaries, context')
    assert.match(framingSummary({ constraints: 'One' }, ''), /; 1 boundary$/)
  })

  it('a preset sets where the brief runs, so it can never disagree with Running in', () => {
    const saved = { mode: devOpts.mode, tone: devOpts.tone, detail: devOpts.detail, pre: new Set(devOpts.prePrompts), sit: canvasMeta.situation }
    try {
      for (const [key, pz] of Object.entries(PRESETS)) {
        assert.ok(applyPreset(key), key)
        assert.eq(canvasMeta.situation.runtime, pz.runtime, `${key}: Running in`)
        assert.eq(devOpts.mode, pz.mode)
        assert.ok(presetMatches(key), `${key} shows as on`)
        assert.ok(Object.keys(PRESETS).filter(k => k !== key).every(k => !presetMatches(k)), 'only one preset on')
      }
      assert.eq(PRESETS['claude-code'].runtime, 'code')
      assert.ok(PRESETS['claude-code'].label !== 'Claude Code', 'not a second control called just "Claude Code"')
      devOpts.tone = 'casual'
      assert.ok(!presetMatches('pm-clarify'), 'a changed option turns the preset off')
      ui.readOnly = true
      assert.ok(!applyPreset('claude-code'), 'a view-only link cannot change the framing')
    } finally {
      ui.readOnly = false
      devOpts.mode = saved.mode; devOpts.tone = saved.tone; devOpts.detail = saved.detail; devOpts.prePrompts = saved.pre
      canvasMeta.situation = saved.sit
    }
  })
})

// ── Scope ────────────────────────────────────────────────────
describe('brief: a brief for the selection and its neighbours', () => {
  it('the scope is the selection plus every block one connection away', () => {
    fixture()
    try {
      const { selected, scope, neighbours, total } = briefScope(['g1'])
      assert.deepEq([...selected], ['g1'])
      assert.deepEq([...scope].sort(), ['a1', 'g1', 'k1', 'r1'])
      assert.eq(neighbours, 3)
      assert.eq(total, 5)
    } finally { clear() }
  })

  it('says it is partial, lists only its blocks, and takes its gaps from the whole map', () => {
    fixture()
    try {
      const all = state.blocks, arrows = state.arrows
      const text = generateScopedPrompt(['g1'])
      assert.ok(state.blocks === all && state.arrows === arrows, 'the map is put back')
      assert.includes(text, '## Scope\n')
      assert.includes(text, '4 of 5 blocks')
      assert.ok(text.indexOf('## Scope') < text.indexOf('## Task'), 'before the task')
      const ids = text.slice(text.indexOf('### Block ids'))
      assert.includes(ids, 'g1: ')
      assert.ok(!ids.includes('i2: '), 'a block outside the scope is not offered for the patch')
      // The risk's mitigation is outside the scope; on its own the part
      // would call it unmitigated. The whole map says otherwise.
      const gaps = text.slice(text.indexOf('## Planning Gaps Detected'))
      assert.ok(!gaps.includes('"Owner leaves"'), 'no false "unmitigated" on a risk mitigated outside the scope')
      assert.includes(gaps, '"One place for the numbers"')
      assert.ok(!generatePrompt().includes('## Scope'), 'the whole brief is not marked partial')
    } finally { clear(); runGapDetection() }
  })

  it('the rebuilt gap sections are the brief\'s own, word for word, for a scope that covers the map', () => {
    fixture()
    state.blocks.r1.gapAck = ['gap-no-criteria']
    try {
      const full = generatePrompt()
      const from = full.indexOf('\n## Planning Gaps Detected\n')
      const to = full.indexOf('\n## When you reply\n')
      assert.ok(from > 0 && to > from)
      const intro = full.slice(full.indexOf('\n## Accepted gaps\n')).split('\n')[2]
      const rebuilt = scopedGapText(runGapDetection(), new Set(Object.keys(state.blocks)), state.blocks, intro)
      assert.eq(rebuilt, full.slice(from, to))
      assert.eq(generateScopedPrompt(Object.keys(state.blocks)), full, 'a scope that covers the map is the whole brief')
      assert.eq(generateScopedPrompt([]), full, 'nothing selected is the whole brief')
    } finally { clear(); runGapDetection() }
  })
})

// ── The tab, mounted ─────────────────────────────────────────
let pageDoc = null
const indexDoc = async () => pageDoc || (pageDoc = new DOMParser().parseFromString(await (await fetch('../index.html', { cache: 'no-store' })).text(), 'text/html'))

/** Mount the Brief pane from index.html; the runner's stub ids step aside. */
async function mountPane() {
  const doc = await indexDoc()
  const aside = ['promptOutput', 'promptDiff', 'briefLong'].map(id => document.getElementById(id)).filter(Boolean)
  aside.forEach(el => { el.dataset.stubId = el.id; el.id = '' })
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-4000px;top:0;width:320px;height:800px;display:flex;flex-direction:column'
  host.appendChild(document.importNode(doc.getElementById('promptPane'), true))
  document.body.appendChild(host)
  return () => { host.remove(); aside.forEach(el => { el.id = el.dataset.stubId; delete el.dataset.stubId }) }
}

describe('brief: the Brief tab', () => {
  it('reads top to bottom: mode, Copy, readiness, framing, the brief, the way back', async () => {
    const doc = await indexDoc()
    assert.eq(doc.querySelector('.panel-tab[data-tab="prompt"]').textContent.trim(), 'Brief')
    const order = ['modeGroup', 'copyPromptBtn', 'briefReady', 'briefFramingBtn', 'briefDoc', 'patchSection'].map(id => doc.getElementById(id))
    order.forEach((el, i) => assert.ok(el, `#${['modeGroup', 'copyPromptBtn', 'briefReady', 'briefFramingBtn', 'briefDoc', 'patchSection'][i]}`))
    for (let i = 1; i < order.length; i++) {
      assert.ok(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${order[i - 1].id} before ${order[i].id}`)
    }
    const pane = doc.getElementById('promptPane')
    assert.ok(pane.contains(doc.getElementById('patchSection')), 'the reply panel is the tab\'s last part')
    const copy = doc.getElementById('copyPromptBtn')
    assert.ok(copy.classList.contains('btn-primary'), 'Copy is the one primary button')
    assert.eq(pane.querySelectorAll('.btn-primary:not(#patchApplyBtn)').length, 1)
    assert.includes(copy.getAttribute('aria-keyshortcuts'), 'Control+Shift+C')
    assert.eq(doc.getElementById('briefFramingBtn').getAttribute('aria-controls'), 'briefFraming')
    assert.ok(doc.getElementById('briefFraming').contains(doc.getElementById('situationFields')), 'the Situation folds into Framing')
    assert.ok(doc.getElementById('briefFraming').contains(doc.getElementById('devOptions')), 'so do the prompt options')
    assert.ok(!pane.querySelector('#healthBar, #gapBreakdown, .health-score, textarea#promptOutput'), 'no grade, no second gap list, no raw box')
    const labels = [...pane.querySelectorAll('button')].map(b => b.textContent.trim())
    assert.ok(!labels.includes('Claude Code'), 'Claude Code is named once, under Running in')
    assert.ok(!labels.includes('Brief'), 'no option called Brief inside the tab called Brief')
    assert.eq(doc.querySelector('#detailGroup [data-value="brief"]').textContent.trim(), 'Short')
    const scope = doc.getElementById('briefScope')
    assert.eq(scope.getAttribute('role'), 'group')
    assert.deepEq([...scope.querySelectorAll('button')].map(b => b.dataset.scope), ['map', 'selection'], 'Whole map and Selection, beside Copy')
    assert.ok(copy.parentElement.contains(scope), 'on the Copy row')
    const size = doc.getElementById('briefTokens')
    assert.eq(size.tagName, 'BUTTON', 'the size note is reachable by keyboard and touch')
    assert.eq(size.getAttribute('aria-controls'), 'briefTokensNote')
    assert.ok(!/Dev Options|Engagement Context|Generated Prompt/.test(pane.textContent), 'the old jargon is gone')
  })

  it('draws the brief, its size, the readiness line and the framing from the map', async () => {
    const unmount = await mountPane()
    fixture()
    try {
      renderBrief()
      const out = document.getElementById('promptOutput')
      assert.eq(out.tagName, 'ARTICLE')
      assert.eq(out.querySelector('h3').textContent, 'Situation')
      assert.match(document.getElementById('briefTokens').textContent, /^About \d/)
      const items = attentionModel(state.blocks, state.arrows, { groups: state.groups }).items.length
      assert.match(document.getElementById('briefReadyText').textContent, new RegExp(`^${items} open item`))
      assert.ok(!document.getElementById('briefReady').hidden)
      assert.eq(document.querySelector('#briefScope [data-scope="map"]').getAttribute('aria-pressed'), 'true')
      assert.eq(document.querySelector('#briefScope [data-scope="selection"]').getAttribute('aria-disabled'), 'true', 'nothing selected yet')
      assert.ok(!document.getElementById('copyPromptBtn').disabled)
      assert.ok(!document.getElementById('briefOutlineBtn').hidden)
      assert.eq(document.getElementById('briefSectionName').textContent, 'Sections', 'the bar does not repeat the heading under it')
      assert.match(document.getElementById('briefTokensNote').textContent, /half of estimates land within 21%/)
      assert.eq(document.getElementById('briefFramingSummary').textContent, framingSummary())
      assert.ok(!document.getElementById('promptPane').classList.contains('is-empty'))
    } finally { unmount(); clear() }
  })

  it('a selection can be briefed on its own, and the choice lets go with the selection', async () => {
    const unmount = await mountPane()
    fixture()
    try {
      assert.eq(setBriefScope('selection'), 'map', 'nothing selected: the whole map')
      selection.ids.add('g1'); selection.blockId = 'g1'
      renderBrief()
      const sel = document.querySelector('#briefScope [data-scope="selection"]')
      assert.eq(sel.getAttribute('aria-disabled'), 'false', 'a selection surfaces Selection beside Copy')
      assert.eq(document.getElementById('briefScopeCount').textContent, '1')
      assert.eq(setBriefScope('selection'), 'selection')
      renderBrief()
      assert.eq(sel.getAttribute('aria-pressed'), 'true')
      assert.eq(document.querySelector('#briefScope [data-scope="map"]').getAttribute('aria-pressed'), 'false')
      assert.ok([...document.querySelectorAll('#promptOutput h3')].some(h => h.textContent === 'Scope'), 'the brief says it is partial')
      selection.ids.clear(); selection.blockId = null
      assert.eq(briefScopeNow(), 'map')
      renderBrief()
      assert.eq(document.querySelector('#briefScope [data-scope="map"]').getAttribute('aria-pressed'), 'true')
      assert.ok(![...document.querySelectorAll('#promptOutput h3')].some(h => h.textContent === 'Scope'))
    } finally { setBriefScope('map'); unmount(); clear(); runGapDetection() }
  })

  it('an empty map shows what the brief will be, and nothing to copy', async () => {
    const unmount = await mountPane()
    clear()
    try {
      renderBrief()
      assert.includes(document.getElementById('promptOutput').textContent, 'The brief is written from the map')
      assert.ok(document.getElementById('copyPromptBtn').disabled)
      assert.ok(document.getElementById('briefReady').hidden)
      assert.eq(document.getElementById('briefTokens').textContent, '')
      assert.ok(document.getElementById('promptPane').classList.contains('is-empty'), 'no bar and no reply section yet')
    } finally { unmount() }
  })

  it('a very long brief says, in one plain line, how to hand over less', async () => {
    const unmount = await mountPane()
    fixture()
    try {
      renderBrief()
      assert.ok(document.getElementById('briefLong').hidden, 'an ordinary brief says nothing')
      state.blocks.g1.description = 'The weekly numbers, in full. '.repeat(3000)
      renderBrief()
      const line = document.getElementById('briefLong')
      assert.ok(!line.hidden)
      assert.match(line.textContent, /^A long brief, \d+k tokens\. To hand over one part, select it on the map and choose Selection beside Copy brief\.$/)
    } finally { unmount(); clear() }
  })

  it('Copy hands over the whole brief and confirms its size and sections', async () => {
    fixture()
    let copied = null
    const savedSnap = promptState.lastSnapshot
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { copied = t } } })
    try {
      assert.ok(await copyBrief({ scope: 'map' }))
      assert.eq(copied, generatePrompt())
      const toast = document.querySelector('.toast-notification')
      assert.eq(toast?.textContent, `Copied: ${copiedSummary(copied)}`)
      assert.eq(getPromptDiff(), null, 'later changes are counted from this copy')
      selection.ids.add('g1')
      setBriefScope('selection')
      assert.ok(await copyBrief())
      assert.includes(copied, '## Scope')
      assert.match(document.querySelector('.toast-notification').textContent, /^Copied the brief for the selection: about \d/)
    } finally {
      delete navigator.clipboard
      document.querySelectorAll('.toast-notification').forEach(t => t.remove())
      promptState.lastSnapshot = savedSnap
      setBriefScope('map'); clear(); runGapDetection()
    }
  })

  it('every word on the tab reads at 4.5:1 on what it sits on, and its marks at 3:1, in both themes', async () => {
    const doc0 = await indexDoc()
    const pane = doc0.getElementById('promptPane').outerHTML
    const sample = briefHtml('## Situation\n- The relevant repository is open to you.\n\n## Implementation checklist\n- [ ] Write it\n- [x] Ship it\n  Block: b1 (Requirement)\n\n## When you reply\nEnd with a fenced ```pathfinder-patch``` block (spec: https://pathfinder.neorgon.com/llms.txt).\n').html
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
    const rgba = s => cssRgba(s) || []
    for (const theme of ['', 'light-mode']) {
      const frame = document.createElement('iframe')
      frame.style.cssText = 'position:fixed;left:-5000px;top:0;width:320px;height:900px;border:0'
      frame.srcdoc = `<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css"><style>*, *::before, *::after { transition: none !important; }</style></head><body class="${theme}"><aside class="right-panel" style="height:900px"><div class="panel-content">${pane}</div></aside></body></html>`
      const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
      document.body.appendChild(frame)
      await loaded
      try {
        const d = frame.contentDocument, w = frame.contentWindow
        d.getElementById('promptPane').classList.add('active')
        d.getElementById('promptOutput').innerHTML = sample
        d.getElementById('briefReady').hidden = false
        d.getElementById('briefReadyText').innerHTML = '<strong>3 open items</strong>: 1 question, 2 gaps.'
        d.getElementById('briefFramingSummary').textContent = 'This repo, Claude Code, read the code first'
        d.getElementById('briefTokens').textContent = 'About 2.4k tokens'
        d.getElementById('modeDesc').textContent = 'A phased plan with a concrete output for each phase.'
        d.getElementById('briefOutlineBtn').hidden = false
        // The colour behind an element: the first ancestor with a fill.
        const behind = el => {
          for (let e = el; e; e = e.parentElement) {
            const c = rgba(w.getComputedStyle(e).backgroundColor)
            if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) return c.slice(0, 3)
          }
          return rgba(w.getComputedStyle(d.body).backgroundColor).slice(0, 3)
        }
        const name = theme || 'dark'
        d.getElementById('briefTokensNote').hidden = false
        d.getElementById('briefTokensNote').textContent = 'About 2,400 tokens, estimated.'
        const text = ['#modeGroup .radio-opt', '#modeGroup .radio-opt.active', '#modeDesc', '#copyPromptBtn',
          '#briefScope [data-scope="map"]', '#briefScope [data-scope="selection"]', '#briefTokensNote',
          '#briefReadyText', '#briefReadyText strong', '#briefReviewBtn', '.brief-row-label', '#briefFramingSummary',
          '#briefSectionName', '#briefTokens', '.brief-md p', '.brief-md li .md-text', '.brief-md .md-h2', '.brief-md code', '.brief-md a',
          '.brief-reply .brief-group-title', '.brief-reply-hint', '#patchOpenBtn']
        for (const sel of text) {
          const el = d.querySelector(sel)
          assert.ok(el, `${name}: ${sel}`)
          const r = ratio(rgba(w.getComputedStyle(el).color).slice(0, 3), behind(el))
          assert.ok(r >= 4.5, `${name}: ${sel} ${r.toFixed(2)}:1`)
          assert.ok(parseFloat(w.getComputedStyle(el).fontSize) >= 11, `${name}: ${sel} keeps the 11px floor`)
        }
        const box = d.querySelector('.brief-md .md-check:not(.done)')
        const rb = ratio(rgba(w.getComputedStyle(box).borderTopColor).slice(0, 3), behind(box))
        assert.ok(rb >= 3, `${name}: a task box draws at ${rb.toFixed(2)}:1`)
        const seg = d.querySelector('#modeGroup .radio-opt.active')
        const rs = ratio(rgba(w.getComputedStyle(seg).borderTopColor).slice(0, 3), behind(seg.parentElement))
        assert.ok(rs >= 3, `${name}: the chosen mode's edge ${rs.toFixed(2)}:1`)
      } finally { frame.remove() }
    }
  })

  it('Cmd or Ctrl + Shift + C is the copy key, and nothing near it', () => {
    const k = (o) => isCopyBriefKey({ key: 'C', code: 'KeyC', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o })
    assert.ok(k({ metaKey: true, shiftKey: true }))
    assert.ok(k({ ctrlKey: true, shiftKey: true }))
    assert.ok(!k({ metaKey: true }), 'Cmd+C stays the system copy')
    assert.ok(!k({ shiftKey: true }))
    assert.ok(!k({ metaKey: true, shiftKey: true, altKey: true }))
  })

  it('the situation defaults read back as the framing a new map starts with', () => {
    assert.eq(framingSummary({ ...SITUATION_DEFAULT }, ''), 'No code yet, in a chat, propose a plan first')
  })
})

// ── Review fixes (2026-10-03) ────────────────────────────────
// Each test below pins one defect the BRIEF review confirmed.

/** A map shaped like the review's: a requirement, the output after it, the work before it. */
function focusFixture() {
  state.blocks = {
    g1: B('g1', 'goal', 'Move to the new system'),
    r1: B('r1', 'requirement', 'No data loss', { priority: 'high' }),
    o1: B('o1', 'output', 'Reconciliation report', { priority: 'high' }),
    i1: B('i1', 'implementation', 'Shadow-write to both'),
    i2: B('i2', 'implementation', 'Cut over reads'),
    k1: B('k1', 'risk', 'Silent divergence'),
  }
  state.arrows = [
    { id: 'f1', from: 'g1', to: 'r1' },
    { id: 'f2', from: 'r1', to: 'o1' },
    { id: 'f3', from: 'i1', to: 'r1' },
    { id: 'f4', from: 'o1', to: 'i2' },
    { id: 'f5', from: 'k1', to: 'i2' },
  ]
  state.groups = {}
}

describe('brief: a scoped brief names its subject and builds only that', () => {
  it('Scope names the selected blocks as the subject and the neighbours as context, by title and id', () => {
    focusFixture()
    const mode = devOpts.mode
    try {
      devOpts.mode = 'build'
      const text = generateScopedPrompt(['r1'])
      const scope = text.slice(text.indexOf('## Scope\n'), text.indexOf('## Task\n'))
      assert.includes(scope, 'Selected, the subject of this brief: "No data loss" (r1)')
      assert.match(scope, /Connected directly, context only \(read them; do not plan, build or change them\): .*"Reconciliation report" \(o1\)/)
      assert.includes(scope, '"Shadow-write to both" (i1)')
      assert.includes(scope, '"Move to the new system" (g1)')
      assert.ok(!scope.includes('Cut over reads'), 'a block outside the scope is not named')
    } finally { devOpts.mode = mode; clear(); runGapDetection() }
  })

  it('a one-block scoped Build brief lists only that block as a task', () => {
    focusFixture()
    const mode = devOpts.mode
    try {
      devOpts.mode = 'build'
      const text = generateScopedPrompt(['r1'])
      const at = text.indexOf('## Implementation checklist\n')
      assert.ok(at > 0, 'the checklist is there')
      const end = text.indexOf('\n## ', at + 5)
      const checklist = text.slice(at, end < 0 ? text.length : end)
      const tasks = checklist.split('\n').filter(l => /^- \[[ x]\]/.test(l))
      assert.eq(tasks.length, 1, checklist)
      assert.match(tasks[0], /No data loss$/)
      assert.ok(!checklist.includes('Block: o1') && !checklist.includes('Block: i1'), 'neighbours are context, not tasks')
      assert.includes(checklist, 'Block: r1 (Requirement)', 'the task keeps its own lines')
    } finally { devOpts.mode = mode; clear(); runGapDetection() }
  })

  it('a selection with no task in it says so instead of handing over the neighbours\' tasks', () => {
    focusFixture()
    const mode = devOpts.mode
    try {
      devOpts.mode = 'build'
      const text = generateScopedPrompt(['g1'])
      assert.ok(!text.includes('## Implementation checklist'), 'no checklist of context tasks')
      assert.includes(text, 'None of the selected blocks is a task, so there is no checklist')
    } finally { devOpts.mode = mode; clear(); runGapDetection() }
  })

  it('the checklist filter keeps a note only while a task it introduces stays', () => {
    const body = '> [NEEDS INPUT: circular connections] Resolve it.\n\n- [ ] [HIGH] A\n      Block: a (Requirement)\n      after: B\n- [ ] B\n      Block: b (Output)\n\nNot ordered by the map: decide the sequence yourself.\n\n- [ ] C\n      Block: c (Output)\n'
    const onlyA = focusChecklist(body, new Set(['a']))
    assert.eq(onlyA.tasks, 1)
    assert.eq(onlyA.dropped, 2)
    assert.includes(onlyA.text, '> [NEEDS INPUT')
    assert.ok(!onlyA.text.includes('Not ordered'), 'the note for dropped tasks goes with them')
    assert.ok(onlyA.text.includes('after: B'), 'the item keeps its own lines')
    const onlyC = focusChecklist(body, new Set(['c']))
    assert.includes(onlyC.text, 'Not ordered by the map')
    assert.ok(!onlyC.text.includes('- [ ] B'))
    assert.eq(focusChecklist(body, new Set(['z'])).text, '', 'nothing selected in it: no section')
  })
})

describe('brief: a scoped brief\'s findings stay inside its scope', () => {
  it('a duplicate naming a block outside the scope is said per block in it, naming no other block', () => {
    state.blocks = {
      g: B('g', 'goal', 'Ship invoices'),
      r1: B('r1', 'requirement', 'Invoices export to CSV'),
      r2: B('r2', 'requirement', 'Invoices export to CSV'),
      k: B('k', 'risk', 'Format drift'),
      o: B('o', 'output', 'CSV file'),
    }
    state.arrows = [{ id: 'a1', from: 'g', to: 'r1' }, { id: 'a2', from: 'g', to: 'r2' }, { id: 'a3', from: 'r2', to: 'k' }, { id: 'a4', from: 'k', to: 'o' }]
    state.groups = {}
    try {
      const whole = runGapDetection()
      assert.ok(whole.findings.some(f => f.kind === 'duplicate'), 'the map has the duplicate')
      // Scope r1: r1 and g, not r2.
      const text = scopedGapText(whole, new Set(['r1', 'g']), state.blocks)
      assert.ok(!text.includes('Canvas: possible duplicate'), 'not the whole-map sentence, which quotes r2')
      assert.includes(text, '• Requirement: "Invoices export to CSV": possible duplicate: its title nearly repeats another block\'s')
      assert.eq(text.split('possible duplicate').length - 1, 1, 'once, for r1 only')
      // A scope holding both keeps the map's own sentence.
      const both = scopedGapText(whole, new Set(['r1', 'r2', 'g']), state.blocks)
      assert.includes(both, '• Canvas: possible duplicate: "Invoices export to CSV" and "Invoices export to CSV"')
      // Through the generator too.
      const brief = generateScopedPrompt(['r1'])
      const gaps = brief.slice(brief.indexOf('## Planning Gaps Detected'), brief.indexOf('## When you reply'))
      assert.ok(!gaps.includes('" and "'), gaps)
    } finally { clear(); runGapDetection() }
  })
})

describe('brief: the size note says what the estimate can claim, to every input', () => {
  it('half within 21%, three in four within 28%: the median and p75, not "most"', () => {
    const note = sizeNote('x'.repeat(7215))
    assert.includes(note, '7,215 characters, about 2,400 tokens.')
    assert.includes(note, 'half of estimates land within 21% of the real count, three in four within 28%')
    assert.ok(!/Most estimates/i.test(note))
  })

  it('the size is a disclosure button: a click or Enter shows the note, Escape hides it', async () => {
    const unmount = await mountPane()
    fixture()
    try {
      renderBrief()
      wireSizeNote()
      const btn = document.getElementById('briefTokens'), note = document.getElementById('briefTokensNote')
      assert.ok(note.hidden)
      btn.click()
      assert.eq(btn.getAttribute('aria-expanded'), 'true')
      assert.ok(!note.hidden)
      assert.match(note.textContent, /characters, about [\d,]+ tokens\. Estimated at 2\.99/)
      assert.eq(btn.getAttribute('aria-controls'), note.id)
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      assert.eq(btn.getAttribute('aria-expanded'), 'false')
      assert.ok(note.hidden)
    } finally { unmount(); clear() }
  })
})

describe('brief: one mark per task, and the bar does not repeat the heading', () => {
  it('a task item draws its box in the bullet\'s place, never a dot and a box', () => {
    const { html } = briefHtml('## Implementation checklist\n- [ ] [HIGH] No data loss\n      Block: r1 (Requirement)\n      Acceptance criteria:\n      - [ ] Counts match\n1. [ ] Numbered keeps its number\n')
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
    const task = doc.querySelector('li.md-task')
    assert.ok(task, 'the task item')
    assert.eq(task.querySelectorAll(':scope > .md-mark').length, 1)
    assert.ok(task.querySelector(':scope > .md-mark > .md-check'), 'the box is the mark')
    assert.ok(!task.querySelector(':scope > .md-mark[aria-hidden="true"]'), 'no bullet beside it')
    assert.ok(!task.querySelector(':scope > .md-item > .md-text .md-check'), 'and no second box in the text')
    assert.eq(task.querySelector(':scope > .md-item > .md-text').innerHTML.split('<br>')[0].trim(), '[HIGH] No data loss', 'the line reads as text, not as "[ ]"')
    const numbered = [...doc.querySelectorAll('li')].find(li => li.textContent.includes('Numbered'))
    assert.eq(numbered.querySelector('.md-mark').textContent, '1.')
    assert.ok(numbered.querySelector('.md-text .md-check'), 'a numbered task keeps its number and shows the box after it')
  })

  it('the bar names a section only once its heading has reached the bar', async () => {
    const unmount = await mountPane()
    fixture()
    try {
      const doc = document.getElementById('briefDoc')
      // Laid out whatever stylesheet an earlier test left in the runner.
      document.getElementById('promptPane').style.cssText = 'display:block;height:auto'
      doc.style.cssText = 'display:block;height:240px;overflow:auto;position:relative'
      doc.querySelector('.brief-docbar').style.cssText = 'position:sticky;top:0;height:36px;background:#fff'
      renderBrief()
      assert.eq(document.getElementById('briefSectionName').textContent, 'Sections', 'at the top, the first heading is in view under the bar')
      const task = [...doc.querySelectorAll('.md-h2')].find(h => h.textContent === 'Task')
      doc.scrollTop = task.offsetTop - 30
      renderBrief()
      assert.eq(document.getElementById('briefSectionName').textContent, 'Task')
    } finally { unmount(); clear() }
  })
})

describe('brief: framing and the reply never push the brief out of reach', () => {
  it('Framing is not remembered: it opens for this visit only', async () => {
    const unmount = await mountPane()
    try {
      localStorage.removeItem('pathfinder-brief-framing')
      setFraming(true)
      const pane = document.getElementById('promptPane')
      assert.ok(pane.classList.contains('framing-open'))
      assert.eq(document.getElementById('briefFramingBtn').getAttribute('aria-expanded'), 'true')
      assert.ok(!document.getElementById('briefFraming').hidden)
      assert.eq(localStorage.getItem('pathfinder-brief-framing'), null, 'nothing saved')
      setFraming(false)
      assert.ok(!pane.classList.contains('framing-open'))
    } finally { setFraming(false); unmount() }
  })

  it('a change made with Framing open is marked where it lands in the brief', async () => {
    const unmount = await mountPane()
    fixture()
    const sit = canvasMeta.situation
    try {
      canvasMeta.situation = { ...SITUATION_DEFAULT, runtime: 'code' }
      renderBrief()
      setFraming(true)
      canvasMeta.situation = { ...SITUATION_DEFAULT, runtime: 'chat' }
      renderBrief()
      const marked = document.querySelectorAll('#promptOutput .md-changed')
      assert.eq(marked.length, 1)
      assert.match(marked[0].textContent, /You are in a chat window/)
      assert.eq(marked[0].tagName, 'LI', 'the line, not the whole section')
    } finally { canvasMeta.situation = sit; setFraming(false); unmount(); clear() }
  })

  it('opening the reply panel gives it the brief\'s place, and closes Framing', async () => {
    const unmount = await mountPane()
    try {
      followReplyPanel()
      const pane = document.getElementById('promptPane'), panel = document.getElementById('patchPanel')
      setFraming(true)
      panel.style.display = ''
      await new Promise(r => setTimeout(r, 0))
      assert.ok(pane.classList.contains('reply-open'))
      assert.ok(!pane.classList.contains('framing-open'), 'one at a time')
      panel.style.display = 'none'
      await new Promise(r => setTimeout(r, 0))
      assert.ok(!pane.classList.contains('reply-open'))
    } finally { setFraming(false); unmount() }
  })

  it('at 1440x900 and 1024x768 the panel never overflows, and Apply stays in view after a long preview', async () => {
    const doc0 = await indexDoc()
    const paneHtml = doc0.getElementById('promptPane').outerHTML
    fixture()
    let sample
    try { sample = briefHtml(generatePrompt()).html } finally { clear(); runGapDetection() }
    const rows = Array.from({ length: 18 }, (_, i) => `<div class="patch-op ok"><label><input type="checkbox" checked><span><span class="patch-op-kind">verify</span> Assumption ${i + 1} marked verified</span></label></div>`).join('')
    // The window widths (so the panel is its 320px or 280px self) and the
    // panel body's height at those sizes (the review's numbers).
    for (const [width, height] of [[1440, 710], [1024, 577]]) {
      const frame = document.createElement('iframe')
      frame.style.cssText = `position:fixed;left:-5000px;top:0;width:${width}px;height:900px;border:0`
      frame.srcdoc = `<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css"><style>*, *::before, *::after { transition: none !important; }</style></head><body style="margin:0"><aside class="right-panel" style="height:${height}px"><div class="panel-content" id="panelContent" style="flex:none;height:${height}px">${paneHtml}</div></aside></body></html>`
      const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
      document.body.appendChild(frame)
      await loaded
      try {
        const d = frame.contentDocument
        const pane = d.getElementById('promptPane')
        pane.classList.add('active')
        d.getElementById('promptOutput').innerHTML = sample
        d.getElementById('briefReady').hidden = false
        d.getElementById('briefReadyText').innerHTML = '<strong>7 open items</strong>: 2 assumptions, 2 requirements without criteria, 1 decision, 2 risks.'
        d.getElementById('modeDesc').textContent = 'A phased plan with a concrete output for each phase.'
        d.getElementById('briefFramingSummary').textContent = 'This repo, in Claude Code, propose a plan first; 2 boundaries'
        d.getElementById('briefTokens').textContent = 'About 2.4k tokens'
        // A selection's count beside Selection: Copy and the scope still fit.
        d.getElementById('briefScopeCount').textContent = '12'
        const copy = d.getElementById('copyPromptBtn')
        assert.ok(copy.scrollWidth <= copy.clientWidth, `${width}: Copy brief is not clipped (${copy.scrollWidth} in ${copy.clientWidth})`)
        const scopeBox = d.getElementById('briefScope').getBoundingClientRect(), head = d.querySelector('.brief-actions').getBoundingClientRect()
        assert.ok(scopeBox.right <= head.right + 0.5, `${width}: the scope control stays inside the row`)
        const pc = d.getElementById('panelContent')
        const fits = what => assert.ok(pc.scrollHeight <= pc.clientHeight + 1, `${height}: ${what}: the panel scrolls ${pc.scrollHeight} in ${pc.clientHeight}`)
        fits('closed')
        assert.ok(d.getElementById('briefDoc').getBoundingClientRect().height >= 240, `${height}: the brief keeps its floor`)
        assert.ok(d.getElementById('patchSection').getBoundingClientRect().height <= 48, `${height}: the reply row is one row until used`)
        // Framing open: it scrolls on its own, the brief keeps 200px in view.
        pane.classList.add('framing-open'); d.getElementById('briefFraming').hidden = false
        fits('framing open')
        assert.ok(d.getElementById('briefDoc').getBoundingClientRect().height >= 199, `${height}: the brief stays in view under the framing`)
        pane.classList.remove('framing-open'); d.getElementById('briefFraming').hidden = true
        // The reply open, a long preview pasted.
        pane.classList.add('reply-open')
        d.getElementById('patchPanel').style.display = ''
        d.getElementById('patchPreview').innerHTML = rows + '<div class="patch-op-sum">18 of 18 operations will apply</div>'
        fits('reply open')
        const apply = d.getElementById('patchApplyBtn').getBoundingClientRect(), box = pc.getBoundingClientRect()
        assert.ok(apply.top >= box.top && apply.bottom <= box.bottom, `${height}: Apply at ${Math.round(apply.top)}-${Math.round(apply.bottom)} inside ${Math.round(box.top)}-${Math.round(box.bottom)}`)
        assert.eq(frame.contentWindow.getComputedStyle(d.getElementById('briefDoc')).display, 'none', 'the brief steps aside while a reply is pasted')
      } finally { frame.remove() }
    }
  })
})

describe('brief: a view-only link shows the framing as values', () => {
  it('Situation rows read "Label  value", empty fields read "none", presets are gone', async () => {
    const unmount = await mountPane()
    const sit = canvasMeta.situation, brief = canvasMeta.contextBrief
    ui.readOnly = true
    try {
      canvasMeta.situation = { ...SITUATION_DEFAULT, codebase: 'current', runtime: 'code', repoHint: '', constraints: 'No new dependencies' }
      canvasMeta.contextBrief = ''
      setupSituation()
      setupDevOptions()
      syncReadonlyValues()
      const host = document.getElementById('situationFields')
      assert.eq(host.querySelectorAll('button').length, 0, 'no choices drawn')
      const values = [...host.querySelectorAll('.situation-row')].map(r => [r.querySelector('.brief-field-label').textContent.trim(), r.querySelector('.brief-value').textContent])
      assert.deepEq(values.map(v => v[1]), ['This repo', 'Claude Code', values[2][1]])
      assert.ok(values[2][1] && values[2][1] !== 'none')
      const repo = document.getElementById('situationRepoHint')
      assert.ok(repo.hidden, 'no empty box')
      assert.eq(repo.nextElementSibling.textContent, 'none')
      assert.eq(document.getElementById('situationConstraints').nextElementSibling.textContent, 'No new dependencies')
      assert.eq(document.getElementById('contextBrief').nextElementSibling.textContent, 'none')
      assert.ok(document.getElementById('presetsSection').hidden, 'presets are actions: not on a view-only link')
      assert.ok([...document.querySelectorAll('#toneGroup .radio-opt')].every(b => b.tabIndex === -1), 'values are not tab stops')
    } finally {
      ui.readOnly = false
      canvasMeta.situation = sit; canvasMeta.contextBrief = brief
      unmount()
    }
  })
})

describe('brief: every Copy says the same thing', () => {
  it('File, Copy goes through the Brief tab\'s own Copy, for the whole map', () => {
    const btn = document.createElement('button')
    btn.id = 'exportCopyPrompt'
    btn.style.display = 'none'
    document.body.appendChild(btn)
    const seen = []
    const listen = e => seen.push(e.detail)
    window.addEventListener('pf:copy-brief', listen)
    try {
      setupExportDropdown()
      btn.click()
      assert.deepEq(seen, [{ scope: 'map' }], 'one copy of the whole map, confirmed by the brief\'s toast')
    } finally { window.removeEventListener('pf:copy-brief', listen); btn.remove() }
  })
})
