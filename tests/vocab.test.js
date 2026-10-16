// ============================================================
//  vocab.test.js: one vocabulary (design round, wave 4)
//
//  One name per thing, everywhere a person reads it: the built-in
//  templates, the type labels, the brief's headings, "connection"
//  rather than "arrow", plain words for the jargon the critique
//  named, and one key cap. Old spellings still load: a file or a
//  link written with the Title Case names keeps working.
// ============================================================

import { describe, it, assert, mockBlockEl, mockGapIconEl, cleanupMockEls, ONSCREEN, fromSiteRoot } from './test-utils.js'
import { renderBlock } from '../js/render.js'
import { meaningName, portsValue, weightName } from '../js/inspector.js'
import { mapsMenuItems, takeSnapshot, deleteSnapshot } from '../js/library.js'
import { pressKeys, keyCapsHtml, phraseCapsHtml, isKey } from '../js/keycaps.js'
import { openMenu, closeMenus } from '../js/menu.js'
import { state, devOpts, canvasMeta } from '../js/state.js'
import { generatePrompt, generateScopedPrompt, briefOutline } from '../js/prompt.js'
import { buildMarkdown, buildMeetingSummary } from '../js/export.js'
import { buildSpecFiles } from '../js/spec-export.js'
import { IMPLIED_MITIGATION } from '../js/task-plan.js'
import { GAP_META } from '../js/gaps.js'
import { SHORTCUTS } from '../js/ui-panels.js'
import { diffPayloads } from '../js/library.js'
import { TEMPLATES, findTemplate } from '../js/templates.js'
import { payloadFor, EXAMPLES } from '../js/examples-page.js'
import { templateMenuItems, firstBlockPillsHtml, SAMPLE_TITLE, setupStartPanel } from '../js/start-panel.js'
import { EXAMPLE_CANVAS } from '../js/example-canvas.js'
import { setupPatchUI, patchKindWord } from '../js/patch.js'
import { edgeDetails } from '../js/comparison-ui.js'
import { connectionSettings, DIRECTION_NAMES, WEIGHT_NAMES, ROUTE_NAMES, PATTERN_NAMES } from '../js/connection-words.js'
import { rowMatch } from '../js/command-items.js'
import { openCommandPalette, closeCommandPalette } from '../js/command-palette.js'
import { commandGroups } from '../js/command-items.js'
import { setupTemplates, templateTitle } from '../js/ui-panels.js'
import { $, TYPES, TYPE_DISAMBIGUATION, resolveTypeId, ACTION_ASKS, ACTION_LABELS, shortDate } from '../js/utils.js'
import { normalizeCanvas, normalizeBlock } from '../js/normalize.js'
import { fromJsonCanvas } from '../js/interop.js'
import { headingType } from '../js/classify.js'
import { typeMenuItems } from '../js/type-menu.js'
import { fileMenuItems } from '../js/view-menu.js'
import { DIAGRAM_BUILDER_PROMPT } from '../js/diagram-instructions.js'

// A label is in sentence case when no word after the first starts with a
// capital, short of a known proper noun or an acronym.
const PROPER = new Set(['AI', 'API', 'JSON', 'PNG', 'SVG', 'Mermaid', 'Markdown', 'Claude', 'Code', 'Cursor'])
export function sentenceCaseProblem(label) {
  const words = String(label).split(/\s+/).slice(1)
  return words.find(w => /^[A-Z][a-z]/.test(w) && !PROPER.has(w.replace(/[^\w]/g, ''))) || ''
}

// ── 1. Built-in template names ───────────────────────────────
describe('vocab: one name per built-in template', () => {
  it('every built-in name is in sentence case', () => {
    TEMPLATES.forEach(t => assert.eq(sentenceCaseProblem(t.name), '', `"${t.name}" is not in sentence case`))
  })

  it('the four worked maps are named by the job they do, the report included', () => {
    const large = TEMPLATES.filter(t => t.large).map(t => t.name)
    assert.deepEq(large, ['Investigate a bug', 'Inherit a codebase', 'Migrate a system', 'Plan a recurring report'])
  })

  it('a name written before the change still finds its template, in any case', () => {
    assert.eq(findTemplate('Investigate a Bug')?.name, 'Investigate a bug')
    assert.eq(findTemplate('MIGRATE A SYSTEM')?.name, 'Migrate a system')
    assert.eq(findTemplate('  sprint   planning ')?.name, 'Sprint planning')
    assert.eq(findTemplate('Recurring Reporting Flow')?.name, 'Plan a recurring report', 'the old name is an alias')
    assert.eq(findTemplate('recurring reporting flow')?.name, 'Plan a recurring report')
    assert.eq(findTemplate('Plan a Recurring Report')?.name, 'Plan a recurring report')
    assert.eq(findTemplate('No such template'), null)
    assert.eq(findTemplate(''), null)
    assert.eq(findTemplate(undefined), null)
  })

  it('the examples page opens every template by its new name and by its old one', () => {
    EXAMPLES.filter(e => e.key !== 'checkout').forEach(e => {
      assert.ok(TEMPLATES.some(t => t.name === e.key), `"${e.key}" is a built-in name`)
      assert.ok(payloadFor(e.key), `${e.key} opens`)
    })
    for (const old of ['Investigate a Bug', 'Inherit a Codebase', 'Migrate a System', 'Recurring Reporting Flow']) {
      const p = payloadFor(old)
      assert.ok(p, `${old} still opens`)
      assert.eq(p.meta.title, findTemplate(old).name, 'and is titled with the name the palette shows')
    }
  })

  it('the palette, the start panel and the command palette show the same names', () => {
    setupTemplates()
    const palette = [...$.templatesList().querySelectorAll('.template-item[data-tpl] .template-label')]
      .map(el => el.firstChild.textContent.trim())
    assert.deepEq(palette, TEMPLATES.map(t => t.name), 'the palette')
    const start = templateMenuItems(() => {}).flatMap(i => i.submenu || [i]).filter(i => i.action).map(i => i.label)
    assert.deepEq([...start].sort(), TEMPLATES.map(t => t.name).sort(), 'the start panel')
    const cmd = commandGroups().find(g => g.key === 'templates').items.filter(r => r.id.startsWith('tpl:')).map(r => r.label)
    assert.deepEq(cmd, TEMPLATES.map(t => t.name), 'Cmd+K')
  })

  it('a built-in template titles an empty map with its own name', () => {
    TEMPLATES.forEach(t => assert.eq(templateTitle(t), t.name))
  })

  it('the examples page heads each template section with the template name', async () => {
    const html = await (await fetch('../examples.html', { cache: 'no-store' })).text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const sections = [...doc.querySelectorAll('section.ex')]
    let checked = 0
    sections.forEach(s => {
      const key = s.querySelector('.ex-actions [data-example]')?.dataset.example
      if (!key || key === 'checkout') return
      assert.eq(s.querySelector('h2').textContent.trim(), key, `the "${key}" section's heading`)
      checked++
    })
    assert.eq(checked, 3, 'three template sections')
  })
})

// ── 2. Type labels ───────────────────────────────────────────
describe('vocab: type labels in sentence case, old spellings still typed', () => {
  it('every label is in sentence case; the phrases read "Open question", "Trigger / end", "Resource / system"', () => {
    Object.values(TYPES).forEach(t => assert.eq(sentenceCaseProblem(t.label), '', `"${t.label}"`))
    assert.eq(TYPES.question.label, 'Open question')
    assert.eq(TYPES.terminator.label, 'Trigger / end')
    assert.eq(TYPES.resource.label, 'Resource / system')
    assert.eq(TYPE_DISAMBIGUATION.join(' ').match(/Trigger \/ \w+/)[0], 'Trigger / end', 'the picker foot says it the same way')
  })

  it('the ids never changed', () => {
    assert.deepEq(Object.keys(TYPES), ['goal', 'problem', 'stakeholder', 'metric', 'requirement', 'output',
      'implementation', 'process', 'terminator', 'decision', 'resource', 'assumption', 'risk', 'question', 'context', 'custom'])
  })

  it('a canvas written with the old Title Case labels loads every block typed', () => {
    const old = { blocks: {
      a: { id: 'a', type: 'Open Question', title: 'Is the budget approved?', x: 0, y: 0 },
      b: { id: 'b', type: 'Trigger / End', title: 'Every end of sprint', x: 300, y: 0 },
      c: { id: 'c', type: 'Resource / System', title: 'Work tracker', x: 600, y: 0 },
      d: { id: 'd', type: 'OPEN QUESTION', title: 'Shouted', x: 0, y: 200 },
      e: { id: 'e', type: 'trigger/end', title: 'Squashed', x: 300, y: 200 },
      f: { id: 'f', type: 'Custom / Other', title: 'Retired label', x: 600, y: 200 },
    }, arrows: [] }
    const clean = normalizeCanvas(old)
    assert.deepEq(Object.values(clean.blocks).map(b => b.type), ['question', 'terminator', 'resource', 'question', 'terminator', 'custom'])
    Object.values(clean.blocks).forEach(b => assert.ok(!b.typeHint, `${b.title}: no leftover typeHint`))
    assert.eq(resolveTypeId('Open question'), 'question', 'and the new spelling')
    assert.eq(resolveTypeId('Trigger / end'), 'terminator')
    assert.eq(resolveTypeId('Resource / system'), 'resource')
  })

  it('a block kept as Other with an old label as its hint comes back typed', () => {
    assert.eq(normalizeBlock({ id: 'x', type: 'custom', typeHint: 'Open Question' }).type, 'question')
    assert.eq(normalizeBlock({ id: 'y', type: 'custom', typeHint: 'Resource / System' }).type, 'resource')
  })

  it('a JSON Canvas node carrying an old label in pathfinderType still types from its colour', () => {
    const { payload } = fromJsonCanvas({ nodes: [
      { id: 'n1', type: 'text', x: 0, y: 0, width: 200, height: 80, text: '#### Is this read?', color: TYPES.question.color, pathfinderType: 'Open Question' },
      { id: 'n2', type: 'text', x: 300, y: 0, width: 200, height: 80, text: '#### Quarter end', color: TYPES.terminator.color, pathfinderType: 'Trigger / End' },
    ], edges: [] })
    const types = Object.values(normalizeCanvas(payload).blocks).map(b => b.type)
    assert.deepEq(types, ['question', 'terminator'])
  })

  it('a pasted heading in the old spelling still heads its type', () => {
    assert.eq(headingType('Open Questions:'), 'question')
    assert.eq(headingType('## Trigger / End'), 'terminator')
    assert.eq(headingType('Resource / System:'), 'resource')
    assert.eq(headingType('Open questions:'), 'question')
  })

  it('the type picker, the start pills and the diagram-builder prompt read the label from the registry', async () => {
    const picker = typeMenuItems('goal', () => {}).filter(i => i.label && !i.type).map(i => i.label)
    ;['Open question', 'Trigger / end', 'Resource / system'].forEach(l => assert.includes(picker, l))
    const built = new DOMParser().parseFromString(firstBlockPillsHtml(['question']), 'text/html')
    assert.eq(built.querySelector('[data-type="question"]').textContent.trim(), 'Open question', 'the pills the panel draws')
    const page = new DOMParser().parseFromString(await (await fetch('../index.html', { cache: 'no-store' })).text(), 'text/html')
    assert.eq(page.querySelector('.start-pill[data-type="question"]').textContent.trim(), 'Open question', 'the pill in the page')
    assert.includes(DIAGRAM_BUILDER_PROMPT, 'Open question')
    assert.notIncludes(DIAGRAM_BUILDER_PROMPT, 'Open Question')
  })
})

// ── 3. The brief's headings ──────────────────────────────────
// A map with every type, an answered card, actions, a group, a labelled and
// an unlabelled connection, gaps and an accepted gap: every section prints.
function everySectionMap() {
  cleanupMockEls()
  state.blocks = {}; state.arrows = []; state.groups = { g1: { id: 'g1', label: 'Core' } }
  canvasMeta.title = 'Vocabulary map'; canvasMeta.contextBrief = 'Why this map exists.'
  devOpts.prePrompts = new Set(); devOpts.tone = 'auto'; devOpts.detail = 'standard'
  Object.keys(TYPES).forEach((t, i) => {
    state.blocks['v' + i] = {
      id: 'v' + i, type: t, title: `${TYPES[t].label} card`, description: 'One line.', notes: '',
      x: (i % 4) * 300, y: Math.floor(i / 4) * 200, actions: TYPES[t].actions.slice(), questions: [],
      criteria: [], width: null, color: null, collapsed: false, groupId: i < 2 ? 'g1' : null,
      gapAck: t === 'requirement' ? ['gap-no-criteria'] : [],
    }
    mockBlockEl('v' + i); mockGapIconEl('v' + i)
  })
  const id = t => 'v' + Object.keys(TYPES).indexOf(t)
  state.blocks[id('question')].answer = 'Yes, it is.'
  state.blocks[id('question') + 'b'] = { ...state.blocks[id('question')], id: id('question') + 'b', title: 'Still open?', answer: '' }
  mockBlockEl(id('question') + 'b'); mockGapIconEl(id('question') + 'b')
  state.arrows.push(
    { id: 'c1', from: id('terminator'), to: id('process'), label: '' },
    { id: 'c2', from: id('goal'), to: id('requirement'), label: 'requires' },
    { id: 'c3', from: id('implementation'), to: id('risk'), label: '' },
  )
}

const headingsOf = text => String(text).split('\n').filter(l => /^#{1,4} /.test(l)).map(l => l.replace(/^#+ /, ''))

describe('vocab: the brief, and every document the app writes, heads its sections in sentence case', () => {
  it('every heading of every mode is in sentence case', () => {
    everySectionMap()
    try {
      for (const mode of ['plan', 'investigate', 'explore', 'build', 'clarify']) {
        devOpts.mode = mode
        const heads = headingsOf(generatePrompt()).filter(h => h !== canvasMeta.title)
        assert.gt(heads.length, 10, `${mode}: a full brief`)
        heads.forEach(h => assert.eq(sentenceCaseProblem(h), '', `${mode}: "${h}"`))
      }
    } finally { devOpts.mode = 'plan' }
  })

  it('names the sections the critique listed, in one style', () => {
    everySectionMap()
    devOpts.mode = 'plan'
    const heads = headingsOf(generatePrompt())
    ;['Block type legend', 'Problems and blockers', 'Open questions (review before assuming)',
      'Assumptions (validate before building)', 'Workflow (end to end)', 'When you reply', 'Answered questions',
      'Action labels', 'Planning gaps detected', 'Accepted gaps', 'Context and background', 'Other (untyped)']
      .forEach(h => assert.includes(heads, h))
    heads.forEach(h => assert.ok(!/ \/ /.test(h), `"${h}": a pair is joined with "and", not a slash`))
  })

  it('the machine-read parts keep working: the reply section, the patch fence, the scoped brief', () => {
    everySectionMap()
    devOpts.mode = 'build'
    try {
      const full = generatePrompt()
      assert.includes(full, '\n## When you reply\n')
      assert.includes(full, '```pathfinder-patch```')
      assert.ok(briefOutline(full).some(s => s.title === 'When you reply'), 'the outline finds it')
      const scoped = generateScopedPrompt(['v0'])
      assert.eq(scoped.split('\n## Planning gaps detected\n').length, 2, 'the scoped brief swaps in one gap section')
      assert.ok(scoped.indexOf('## Planning gaps detected') < scoped.indexOf('## When you reply'), 'before the reply section')
      assert.includes(scoped, '## Scope')
    } finally { devOpts.mode = 'plan' }
  })

  it('an untitled map is called what the app calls it', () => {
    everySectionMap()
    canvasMeta.title = ''
    try {
      assert.includes(generatePrompt(), '\n# Untitled map\n')
      assert.ok(buildMarkdown().startsWith('# Untitled map\n'))
    } finally { canvasMeta.title = 'Vocabulary map' }
  })

  it('the Markdown export, the meeting summary and the spec bundle head in sentence case too', () => {
    everySectionMap()
    const docs = [['Markdown', buildMarkdown()], ['meeting summary', buildMeetingSummary({ now: new Date(2026, 9, 4) })],
      ...buildSpecFiles(new Date(2026, 9, 4)).map(f => [f.name, f.data])]
    docs.forEach(([name, text]) => headingsOf(text)
      .filter(h => !h.includes(canvasMeta.title) && !/^(G|M|R|D)\d/.test(h) && !Object.values(state.blocks).some(b => h.startsWith(b.title)))
      .forEach(h => assert.eq(sentenceCaseProblem(h), '', `${name}: "${h}"`)))
    assert.includes(buildMeetingSummary({ now: new Date(2026, 9, 4) }), '# Meeting summary: Vocabulary map')
  })
})

// ── 4. "Connection" wherever a person reads it ───────────────
// "Arrow" stays in code and in the JSON field `arrows`; a person reads
// "connection". The arrow keys are keys, so they keep their name.
const ARROW_WORD = /\barrows?\b(?! keys?\b)/i
const withoutKeysAndFields = s => String(s).replace(/\barrow keys?\b/gi, '').replace(/"arrows"|`arrows`|arrows\[\]/g, '')

describe('vocab: a person reads "connection", never "arrow"', () => {
  it('the brief says connection, and names the JSON field only as a field', () => {
    everySectionMap()
    for (const mode of ['plan', 'build']) {
      devOpts.mode = mode
      const p = generatePrompt()
      assert.ok(!ARROW_WORD.test(withoutKeysAndFields(p)), `${mode}: ${(withoutKeysAndFields(p).match(new RegExp('.{40}' + ARROW_WORD.source + '.{20}', 'i')) || [''])[0]}`)
    }
    devOpts.mode = 'plan'
    assert.eq(IMPLIED_MITIGATION, 'implied by an unlabelled connection')
  })

  it('the type registry, the gap texts and the shortcut sheet say connection', () => {
    Object.entries(TYPES).forEach(([id, t]) => ['short', 'tip', 'legend', 'example', 'section'].forEach(k =>
      assert.ok(!ARROW_WORD.test(withoutKeysAndFields(t[k])), `${id}.${k}: ${t[k]}`)))
    Object.entries(GAP_META).forEach(([id, g]) => Object.values(g).forEach(v =>
      assert.ok(typeof v !== 'string' || !ARROW_WORD.test(v), `${id}: ${v}`)))
    SHORTCUTS.forEach(g => g.keys.forEach(([, desc]) => assert.ok(!ARROW_WORD.test(withoutKeysAndFields(desc)), desc)))
  })

  it('a snapshot comparison counts connections, and names what it removed', () => {
    const one = { blocks: { a: { id: 'a', type: 'goal', title: 'A', x: 0, y: 0 }, b: { id: 'b', type: 'goal', title: 'B', x: 300, y: 0 } }, arrows: [], groups: {}, meta: {} }
    const two = { blocks: { a: one.blocks.a }, arrows: [], groups: {}, meta: {} }
    const three = { ...one, arrows: [{ id: 'c', from: 'a', to: 'b' }] }
    assert.includes(diffPayloads(one, two), '-1 block')
    assert.includes(diffPayloads(one, three), '+1 connection')
    assert.notIncludes(diffPayloads(one, three), 'arrow')
  })

  it('the app page and the doc pages say connection in every word a person reads', async () => {
    for (const page of ['../index.html', '../tutorial.html', '../examples.html']) {
      const doc = new DOMParser().parseFromString(await (await fetch(page, { cache: 'no-store' })).text(), 'text/html')
      doc.querySelectorAll('script, style, svg').forEach(el => el.remove())
      const said = [doc.body.textContent, ...[...doc.querySelectorAll('[title], [aria-label], [placeholder], [alt]')]
        .flatMap(el => ['title', 'aria-label', 'placeholder', 'alt'].map(a => el.getAttribute(a) || ''))].join('\n')
      const hit = withoutKeysAndFields(said).match(new RegExp('.{0,40}' + ARROW_WORD.source + '.{0,20}', 'i'))
      assert.ok(!hit, `${page}: "${hit && hit[0]}"`)
    }
  })
})

// ── 5. Jargon into plain words ───────────────────────────────
// The stylesheet in a frame of its own, so the inspector's container query
// and :has() resolve as they do on the page.
async function frame(html, { width = 320, height = 900, bodyClass = '' } = {}) {
  const f = document.createElement('iframe')
  f.style.cssText = `${ONSCREEN};width:${width}px;height:${height}px`
  f.srcdoc = '<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css">' +
    '<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>' +
    `</head><body class="${bodyClass}">${fromSiteRoot(html)}</body></html>`
  const loaded = new Promise(res => f.addEventListener('load', res, { once: true }))
  document.body.appendChild(f)
  await loaded
  await new Promise(res => f.contentWindow.requestAnimationFrame(() => res()))
  return f
}
let pageDoc = null
async function appPage() {
  pageDoc ??= new DOMParser().parseFromString(await (await fetch('../index.html', { cache: 'no-store' })).text(), 'text/html')
  return pageDoc
}

describe('vocab: the jargon the critique named, in plain words', () => {
  it('File names what each hand-off does', async () => {
    const doc = await appPage()
    assert.eq(doc.getElementById('copyDiagramInstructions').textContent.trim(), 'Copy a prompt that builds a map')
    // What a person sees is the menu row built from the hidden button, so
    // the row itself has to name where it goes (another site, a new tab).
    const rows = fileMenuItems(doc.getElementById('fileActions'), { readOnly: false }).filter(i => i.label)
    const sage = rows.find(i => i.rowId === 'exportToPresentationSage')
    assert.eq(sage?.label, 'Open as slides in Presentation Sage', 'the File row says what it does and where')
    const ro = fileMenuItems(doc.getElementById('fileActions'), { readOnly: true }).find(i => i.rowId === 'exportToPresentationSage')
    if (ro) assert.eq(ro.label, sage.label, 'the same words on a view-only link')
    const all = doc.body.innerHTML
    ;['diagram-builder', 'Open in Presentation Sage', 'Auto (label or types)'].forEach(w => assert.notIncludes(all, w))
  })

  it('no placeholder, tooltip or label shows Markdown fences', async () => {
    const doc = await appPage()
    doc.querySelectorAll('[placeholder], [title], [aria-label]').forEach(el =>
      ['placeholder', 'title', 'aria-label'].forEach(a => assert.notIncludes(el.getAttribute(a) || '', '```', `${el.id || el.tagName} ${a}`)))
    assert.includes(doc.getElementById('patchInput')?.placeholder || doc.querySelector('textarea[placeholder*="pathfinder-patch"]').placeholder,
      'pathfinder-patch block')
  })

  it('a toast never names the situation as a proper noun', async () => {
    for (const file of ['ui-panels.js', 'sharing.js', 'start-panel.js', 'brief.js', 'library.js']) {
      const src = await (await fetch('../js/' + file, { cache: 'no-store' })).text()
      const toasts = [...src.matchAll(/showToast\(\s*([`'"])([\s\S]*?)\1/g)].map(m => m[2])
      toasts.forEach(t => assert.ok(!/\S\s+Situation\b|^Situation set/.test(t), `${file}: "${t}"`))
    }
  })

  it('the connection meaning reads Automatic, with what it reads as', () => {
    assert.eq(meaningName({ relation: null }), 'Automatic')
    assert.eq(meaningName({ relation: 'depends-on' }), 'Depends on')
    assert.eq(meaningName({ relation: 'nonsense' }), 'Automatic')
  })

  it('connection points read as a row value: Auto, or the sides, and who set them', () => {
    assert.eq(portsValue({}), 'Auto')
    assert.eq(portsValue({ fromPort: 'top', toPort: null }), 'Top → Auto')
    assert.eq(portsValue({ fromPort: 'right', toPort: 'left', portsBy: 'tidy' }), 'Right → Left, set by Tidy')
    assert.eq(portsValue({ fromPort: null, toPort: 'bottom', portsBy: 'import' }), 'Auto → Bottom, from the imported file')
  })

  it('a weight reads by its name, an older one by its old name and size', () => {
    assert.eq(weightName(1), 'Thin')
    assert.eq(weightName(1.5), 'Normal')
    assert.eq(weightName(3.5), 'Bold')
    assert.eq(weightName(2), 'Normal (2px)')
    assert.eq(weightName(5), 'Bold (5px)')
    assert.eq(weightName(7), '7px')
  })

  it('an action chip says what it asks of the plan, as its tooltip and its name', () => {
    assert.eq(ACTION_ASKS.resolve, 'Resolve: the plan must fix this')
    Object.keys(ACTION_LABELS).forEach(k => assert.ok(ACTION_ASKS[k]?.startsWith(ACTION_LABELS[k] + ': '), `${k}: the asks start with the chip's word`))
    cleanupMockEls()
    state.blocks = { cx: { id: 'cx', type: 'problem', title: 'Checkout fails', description: '', notes: '', x: 0, y: 0,
      actions: ['resolve', 'prepare', 'validate'], questions: [], width: null, color: null, collapsed: false, groupId: null } }
    renderBlock('cx')
    try {
      const chips = [...document.querySelectorAll('#b-cx .action-badge')]
      assert.eq(chips.length, 3)
      chips.forEach(c => {
        const word = c.querySelector('span').textContent
        assert.eq(c.getAttribute('title'), c.getAttribute('aria-label'))
        assert.ok(c.getAttribute('aria-label').startsWith(word + ': '), c.getAttribute('aria-label'))
        assert.eq(c.getAttribute('role'), 'img', 'a name a screen reader announces on a span')
      })
    } finally { document.getElementById('b-cx')?.remove(); state.blocks = {} }
  })

  it('a date in the Maps menu reads "Oct 4" whatever the browser\'s language', () => {
    const now = new Date(2026, 9, 4, 13, 5)
    assert.eq(shortDate(now, { now }), 'Oct 4')
    assert.eq(shortDate(new Date(2025, 9, 4), { now }), 'Oct 4, 2025', 'another year says which')
    assert.match(shortDate(now, { now, time: true }), /^Oct 4, (13:05|1:05\sPM)$/)
    assert.eq(shortDate(null), '')
    assert.eq(shortDate('not a date'), '')
    // Every dated row of the Maps menu: the month first, in the interface's words.
    const old = document.documentElement.lang
    document.documentElement.lang = 'en'
    try {
      mapsMenuItems().filter(i => i.radio).flatMap(r => r.hint.split(' · ')).filter(p => p && !/^\d+ /.test(p))
        .forEach(d => assert.match(d, /^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/, d))
    } finally { document.documentElement.lang = old }
  })

  it('a snapshot named with its date is not dated twice in the Maps menu', () => {
    const KEY = 'pathfinder-map-current'
    let prev = null
    try { prev = localStorage.getItem(KEY); localStorage.setItem(KEY, 'vocab-snap-test') } catch (_) { return }
    const auto = takeSnapshot('Snapshot · ' + shortDate(Date.now(), { time: true }))
    const named = takeSnapshot('Before the patch')
    try {
      const rows = mapsMenuItems().find(i => /^Snapshots/.test(i.label)).submenu()
      const autoRow = rows.find(r => r.label === 'Compare: ' + auto.name)
      const namedRow = rows.find(r => r.label === 'Compare: Before the patch')
      assert.match(autoRow.hint, /^Since then: /, autoRow.hint)
      assert.match(namedRow.hint, /^[A-Z][a-z]{2} \d{1,2} · since then: /, namedRow.hint)
    } finally {
      deleteSnapshot(auto.id); deleteSnapshot(named.id)
      try { localStorage.removeItem('pathfinder-snaps-vocab-snap-test'); prev === null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, prev) } catch (_) {}
    }
  })
})

describe('vocab: the connection panel is a property sheet like the block\'s', () => {
  async function connectionPane(width = 320) {
    const doc = await appPage()
    const pane = doc.getElementById('inspectorPane').cloneNode(true)
    pane.querySelector('#inspectorArrow').style.display = 'block'
    pane.querySelector('#inspectorContent').style.display = 'block'
    const acts = pane.querySelector('#typeActionsSection')
    acts.hidden = false
    acts.querySelector('#typeActions').innerHTML = '<button type="button" class="action-toggle" aria-pressed="false"><span class="action-tick"></span>Resolve</button>'
    // The right panel's own width: the pane pads itself.
    return frame(`<div class="panel-content" style="width:${width}px">${pane.outerHTML}</div>`, { width })
  }

  it('every row, the note included, has its label in the label column and its control in the field column', async () => {
    const f = await connectionPane()
    try {
      const d = f.contentDocument, r = el => el.getBoundingClientRect()
      const note = d.getElementById('arrowNoteInput'), noteLabel = d.querySelector('label[for="arrowNoteInput"]')
      const field = r(d.getElementById('arrowLabelInput')).left
      assert.ok(Math.abs(r(note).left - field) < 1, `the note's field lines up with the label field (${r(note).left} vs ${field})`)
      assert.ok(r(noteLabel).right <= r(note).left, 'the note label is beside it, not above')
      assert.ok(Math.abs(r(noteLabel).top - r(note).top) < 10, 'on the same row')
      const labels = [...d.querySelectorAll('#inspectorArrow .insp-section > .insp-label')]
      assert.eq(labels.length, 8, 'Label, Meaning, Note, Route, Pattern, Direction, Weight, Colour')
      labels.forEach(l => assert.ok(Math.abs(r(l).left - r(labels[0]).left) < 1, `${l.textContent.trim()}: one label column`))
      ;[...d.querySelectorAll('#inspectorArrow .insp-row-chip')].forEach(b =>
        assert.ok(Math.abs(r(b).left - field) < 1, `${b.id} starts at the field column`))
    } finally { f.remove() }
  })

  it('the type\'s toggle (Resolve) starts at the Description\'s edge, not in the middle', async () => {
    const f = await connectionPane()
    try {
      const d = f.contentDocument
      const desc = d.getElementById('inspDesc').getBoundingClientRect()
      const toggle = d.querySelector('#typeActions .action-toggle').getBoundingClientRect()
      assert.ok(Math.abs(toggle.left - desc.left) < 1, `toggle at ${toggle.left}, description at ${desc.left}`)
    } finally { f.remove() }
  })

  it('a narrow panel puts every label above its control again', async () => {
    const f = await connectionPane(250)
    try {
      const d = f.contentDocument
      const note = d.getElementById('arrowNoteInput').getBoundingClientRect()
      const label = d.querySelector('label[for="arrowNoteInput"]').getBoundingClientRect()
      assert.ok(label.bottom <= note.top + 1, 'the label sits above')
    } finally { f.remove() }
  })
})

// ── 6. One key cap ───────────────────────────────────────────
describe('vocab: one key cap, one key per cap', () => {
  const caps = html => [...new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').querySelectorAll('kbd')].map(k => k.textContent)
  const text = html => new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.textContent

  it('a press is its keys: modifiers by name or by symbol, a lone symbol is itself', () => {
    assert.deepEq(pressKeys('Shift+1'), ['Shift', '1'])
    assert.deepEq(pressKeys('Ctrl+Shift+Z'), ['Ctrl', 'Shift', 'Z'])
    assert.deepEq(pressKeys('⇧⌘Z'), ['⇧', '⌘', 'Z'])
    assert.deepEq(pressKeys('⌘K'), ['⌘', 'K'])
    assert.deepEq(pressKeys('-'), ['-'])
    assert.deepEq(pressKeys('Del'), ['Del'])
  })

  it('keys pressed together sit side by side and still read "Shift+1"; a chord says then', () => {
    assert.deepEq(caps(keyCapsHtml('Shift+1')), ['Shift', '1'])
    assert.eq(text(keyCapsHtml('Shift+1')), 'Shift+1')
    assert.deepEq(caps(keyCapsHtml('N K')), ['N', 'K'])
    assert.eq(text(keyCapsHtml('N K')), 'N then K')
    assert.eq(keyCapsHtml(''), '')
  })

  it('a sheet phrase: keys in caps, every other word beside them', () => {
    assert.deepEq(caps(phraseCapsHtml('⌘/Ctrl + K')), ['⌘/Ctrl', 'K'])
    assert.deepEq(caps(phraseCapsHtml('Tab / Shift + Tab (editing)')), ['Tab', 'Shift', 'Tab'])
    assert.includes(text(phraseCapsHtml('Tab / Shift + Tab (editing)')), '(editing)')
    assert.deepEq(caps(phraseCapsHtml('N, then a letter')), ['N'])
    assert.eq(text(phraseCapsHtml('N, then a letter')), 'N then a letter', 'a chord says then, as the palette does')
    assert.deepEq(caps(phraseCapsHtml('Shift + click')), ['Shift'])
    assert.eq(text(phraseCapsHtml('Shift + click')), 'Shift + click', 'a mouse action keeps its plus')
    assert.deepEq(caps(phraseCapsHtml('Double-click canvas')), [], 'not a key')
    assert.deepEq(caps(phraseCapsHtml('⌘/Ctrl + = / - / 0')), ['⌘/Ctrl', '=', '-', '0'])
    assert.deepEq(caps(phraseCapsHtml('/')), ['/'])
    // Keys pressed together are one unbreakable press: a narrow column wraps
    // between presses, never between Shift and Tab.
    const doc = new DOMParser().parseFromString(`<div>${phraseCapsHtml('Tab / Shift + Tab (editing)')}</div>`, 'text/html')
    const presses = [...doc.querySelectorAll('.kbd-press')]
    assert.eq(presses.length, 1)
    assert.deepEq([...presses[0].querySelectorAll('kbd')].map(k => k.textContent), ['Shift', 'Tab'])
    // Every phrase the sheet lists: no cap holds a sentence.
    SHORTCUTS.forEach(g => g.keys.forEach(([k]) => caps(phraseCapsHtml(k)).forEach(c =>
      assert.ok(isKey(c), `"${k}": "${c}" is a key`))))
  })

  it('a menu row shows its shortcut as caps and a count as a number', () => {
    const m = openMenu([
      { label: 'Fit all blocks', shortcut: 'Shift+1' },
      { label: 'Duplicate', shortcut: '⌘D' },
      { label: 'Problems', shortcut: '3' },
    ], { x: 10, y: 10 })
    try {
      const [fit, dup, count] = [...m.el.querySelectorAll('.pf-menu-item')]
      assert.deepEq([...fit.querySelectorAll('kbd.pf-menu-key')].map(k => k.textContent), ['Shift', '1'])
      assert.eq(fit.querySelector('.pf-menu-shortcut').textContent, 'Shift+1')
      assert.deepEq([...dup.querySelectorAll('kbd.pf-menu-key')].map(k => k.textContent), ['⌘', 'D'])
      assert.eq(count.querySelectorAll('kbd').length, 0, 'a count is not a key')
      assert.eq(count.querySelector('.pf-menu-shortcut').textContent, '3')
    } finally { closeMenus() }
  })

  it('in the sheet\'s narrow "All shortcuts" column, no press splits across lines', async () => {
    const rows = SHORTCUTS.flatMap(g => g.keys).map(([k, d]) =>
      `<div class="shortcut-row"><dt class="shortcut-keys">${phraseCapsHtml(k, { cls: 'shortcut-key' })}</dt><dd class="shortcut-desc">${d}</dd></div>`).join('')
    // A key column narrower than the sheet's, so every long phrase has to wrap.
    const narrow = '<style>.shortcut-row { grid-template-columns: minmax(0, 96px) minmax(0, 1fr); }</style>'
    const f = await frame(`${narrow}<div class="shortcut-overlay" style="display:block;position:static"><div class="shortcut-grid"><dl class="shortcut-list">${rows}</dl></div></div>`, { width: 380, height: 2600 })
    try {
      const split = [...f.contentDocument.querySelectorAll('.kbd-press')].filter(p => {
        const tops = [...p.querySelectorAll('kbd')].map(k => k.getBoundingClientRect().top)
        return Math.max(...tops) - Math.min(...tops) > 2
      }).map(p => p.textContent)
      assert.deepEq(split, [])
    } finally { f.remove() }
  })

  it('the same box everywhere: palette, menu, sheet, N panel, start panel and doc page, in both themes', async () => {
    const html = '<div class="cmdk-row"><span class="cmdk-keys"><kbd class="kbd cmdk-kbd">K</kbd></span></div>' +
      '<div class="pf-menu"><span class="pf-menu-shortcut pf-menu-keys"><kbd class="kbd pf-menu-key">K</kbd></span></div>' +
      '<dl class="shortcut-list"><div class="shortcut-row"><dt class="shortcut-keys"><kbd class="kbd shortcut-key">K</kbd></dt><dd>x</dd></div></dl>' +
      '<ul class="typekeys-list"><li><kbd class="kbd typekeys-key">K</kbd></li></ul>' +
      '<div class="start-panel"><kbd class="start-key">K</kbd></div>' +
      '<main class="doc"><p>Press <kbd>K</kbd></p></main>'
    for (const theme of ['', 'light-mode']) {
      const f = await frame(html, { width: 800, height: 400, bodyClass: theme })
      try {
        const all = [...f.contentDocument.querySelectorAll('kbd')]
        assert.eq(all.length, 6)
        const props = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'height', 'minWidth', 'borderTopLeftRadius',
          'fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'borderTopColor', 'borderTopWidth']
        const cs = all.map(k => f.contentWindow.getComputedStyle(k))
        props.forEach(p => assert.eq(new Set(cs.map(c => c[p])).size, 1, `${theme || 'dark'} ${p}: ${cs.map(c => c[p]).join(' / ')}`))
        assert.eq(cs[0].paddingLeft, '5px')
        assert.eq(cs[0].height, '20px')
        all.forEach(k => assert.eq(Math.round(k.getBoundingClientRect().width), 20, 'a single key is a 20px square'))
      } finally { f.remove() }
    }
  })
})


// ── Review fixes (wave 4) ────────────────────────────────────
// One test per defect the review confirmed, so none comes back.
describe('vocab: what the review found', () => {
  it('the patch preview names a connection a connection, in sentence case, never ARROW', async () => {
    const doc = await appPage()
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-6000px;top:0;width:320px'
    host.appendChild(document.importNode(doc.getElementById('patchSection'), true))
    document.body.appendChild(host)
    const saved = { blocks: state.blocks, arrows: state.arrows }
    state.blocks = {
      p1: { id: 'p1', type: 'problem', title: 'Checkout fails under load', x: 0, y: 0, actions: [], questions: [] },
      q1: { id: 'q1', type: 'question', title: 'Is staging affected?', x: 300, y: 0, actions: [], questions: [] },
      i1: { id: 'i1', type: 'implementation', title: 'Retry payment calls', x: 600, y: 0, actions: [], questions: [] },
    }
    state.arrows = []
    try {
      setupPatchUI()
      const input = host.querySelector('#patchInput')
      input.value = 'Done.\n```pathfinder-patch\n' + JSON.stringify({ format: 'pathfinder-patch', version: 1,
        answers: [{ block: 'q1', answer: 'Production only' }],
        blocks: [{ id: 'n1', type: 'risk', title: 'Retries hide the cause' }],
        arrows: [{ from: 'p1', to: 'i1', label: 'needs' }, { from: 'n1', to: 'i1' }, { from: 'zz', to: 'i1' }] }) + '\n```'
      input.dispatchEvent(new Event('input'))
      const preview = host.querySelector('#patchPreview')
      const kinds = [...preview.querySelectorAll('.patch-op-kind')].map(k => k.textContent)
      assert.deepEq(kinds, ['Answer', 'Block', 'Connection', 'Connection', 'Connection'])
      assert.ok(!ARROW_WORD.test(preview.textContent), preview.textContent)
      ;['answer', 'verify', 'status', 'criteria', 'note', 'block', 'arrow'].forEach(k =>
        assert.eq(sentenceCaseProblem(patchKindWord(k)), '', k))
    } finally { state.blocks = saved.blocks; state.arrows = saved.arrows; host.remove() }
    // Uppercase belongs to the card's type label alone (DESIGN.md).
    const f = await frame('<div class="patch-op"><label><span><span class="patch-op-kind">Connection</span> Connect</span></label></div>')
    try {
      assert.eq(f.contentWindow.getComputedStyle(f.contentDocument.querySelector('.patch-op-kind')).textTransform, 'none')
    } finally { f.remove() }
  })

  it('a snapshot comparison names a connection\'s settings in the inspector\'s words and order', () => {
    const canvas = { blocks: { a: { title: 'Alpha' }, b: { title: 'Beta' } } }
    const text = edgeDetails({ from: 'a', to: 'b', label: 'asks', note: 'only on Mondays', style: 'routed', pattern: 'dashed', weight: 2,
      bidirectional: true, fromPort: 'right', toPort: 'left', portsBy: 'tidy' }, canvas)
    assert.eq(text, ['Alpha → Beta', 'Label: asks', 'Meaning: Automatic', 'Note: only on Mondays', 'Route: Routed', 'Pattern: Dashed',
      'Direction: Two-way', 'Weight: Normal (2px)', 'Colour: Default', 'Connection points: Right → Left, set by Tidy'].join('\n'))
    const plain = edgeDetails({ from: 'a', to: 'b' }, canvas)
    assert.includes(plain, 'Direction: One-way')
    assert.includes(plain, 'Connection points: Auto')
    ;['Style:', 'color:', 'both ways', 'one way', 'Connection sides', 'automatic', 'Sides placed'].forEach(w => assert.notIncludes(text + plain, w))
  })

  it('one-way and two-way are hyphenated alike, and both pickers read one set of names', async () => {
    assert.deepEq(Object.values(DIRECTION_NAMES), ['One-way', 'Two-way'])
    assert.deepEq(connectionSettings({}).map(([k]) => k), ['Meaning', 'Route', 'Pattern', 'Direction', 'Weight', 'Colour', 'Connection points'])
    const doc = await appPage()
    assert.eq(doc.getElementById('arrowHeadsText').textContent.trim(), 'One-way')
    // Neither picker keeps a copy of the names: both import them.
    for (const file of ['../js/inspector.js', '../js/context-menu.js']) {
      const src = await (await fetch(file, { cache: 'no-store' })).text()
      assert.includes(src, "from './connection-words.js'", file)
      assert.ok(!/\{\s*routed:\s*'Routed'/.test(src) && !/\[1, 'Thin'\]|1: 'Thin'/.test(src), `${file} has no table of its own`)
    }
    assert.eq(WEIGHT_NAMES[1.5], 'Normal'); assert.eq(ROUTE_NAMES.routed, 'Routed'); assert.eq(PATTERN_NAMES.dotted, 'Dotted')
  })

  it('the start panel\'s submit keys are caps side by side, with no plus between them on screen', async () => {
    const doc = await appPage()
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:fixed;left:-6000px;top:0;width:700px'
    wrap.innerHTML = doc.getElementById('brainDump').outerHTML
    document.body.appendChild(wrap)
    const visible = el => { const c = el.cloneNode(true); c.querySelectorAll('.sr-only').forEach(e => e.remove()); return c.textContent.trim() }
    try {
      const staticHint = wrap.querySelector('#startSubmitHint')
      assert.eq(visible(staticHint), 'CtrlEnter', 'the page as served: two caps, the plus hidden')
      setupStartPanel()
      const hint = document.getElementById('startSubmitHint')
      const keys = [...hint.querySelectorAll('kbd')].map(k => k.textContent)
      assert.eq(keys.length, 2)
      assert.eq(keys[1], 'Enter')
      assert.ok(['⌘', 'Ctrl'].includes(keys[0]), keys[0])
      assert.notIncludes(visible(hint), '+')
      assert.includes(hint.textContent, '+', 'a screen reader still hears the plus')
    } finally { wrap.remove() }
  })

  it('no page shows a plus between two caps, and the doc pages spell the modifier as the sheet does', async () => {
    for (const page of ['../index.html', '../tutorial.html', '../examples.html']) {
      const html = await (await fetch(page, { cache: 'no-store' })).text()
      assert.ok(!/<\/kbd>\s*\+\s*<kbd/.test(html), `${page}: a visible plus between caps`)
      assert.ok(!/<kbd[^>]*>Cmd\/Ctrl/.test(html), `${page}: Cmd/Ctrl in a cap; the sheet writes ⌘/Ctrl`)
    }
  })

  it('one name per key: Esc and Del in the sheet, as in the menus, the palette and the N panel', () => {
    const sheet = SHORTCUTS.flatMap(g => g.keys.flatMap(([k]) => [...new DOMParser().parseFromString(`<div>${phraseCapsHtml(k)}</div>`, 'text/html').querySelectorAll('kbd')].map(c => c.textContent)))
    assert.includes(sheet, 'Esc')
    assert.includes(sheet, 'Del')
    ;['Escape', 'Delete'].forEach(k => assert.ok(!sheet.includes(k), `the sheet says ${k}`))
  })

  it('the palette foot shows its prefixes as caps, like every other key in it', () => {
    openCommandPalette()
    try {
      const foot = document.querySelector('#commandPalette .cmdk-foot-scopes')
      assert.deepEq([...foot.querySelectorAll('kbd')].map(k => k.textContent), ['/', '>', '#', '@'])
      assert.ok([...foot.querySelectorAll('kbd')].every(k => k.classList.contains('cmdk-kbd')))
    } finally { closeCommandPalette({ restoreFocus: false }) }
  })

  it('a template\'s retired name still finds it in the command palette, ranked under a name match', () => {
    const label = 'Plan a recurring report', old = ['Recurring reporting flow']
    ;['Recurring Reporting Flow', 'reporting flow', 'recurring reporting'].forEach(q =>
      assert.ok(rowMatch(q, label, old), `"${q}" finds it`))
    assert.ok(rowMatch('recurring', label, old).score > rowMatch('reporting flow', label, old).score, 'a label match ranks first')
    assert.eq(rowMatch('reporting flow', label), null, 'and only through the old name')
    const tpl = commandGroups().find(g => g.key === 'templates')?.items.find(r => r.label === label)
    assert.deepEq(tpl?.keywords, old)
    openCommandPalette({ query: 'Recurring Reporting Flow' })
    try {
      const rows = [...document.querySelectorAll('#cmdkList .cmdk-row .cmdk-label')].map(e => e.textContent)
      assert.includes(rows, label)
    } finally { closeCommandPalette({ restoreFocus: false }) }
  })

  it('the sample map has one name: the start panel, Cmd+K, the examples page and the walkthrough agree', async () => {
    assert.eq(SAMPLE_TITLE, EXAMPLE_CANVAS.meta.title)
    const html = await (await fetch('../examples.html', { cache: 'no-store' })).text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    assert.eq(doc.getElementById('ex-checkout').textContent.trim(), SAMPLE_TITLE)
    const names = [...doc.querySelectorAll('section.ex h2')].map(h => h.textContent.trim())
    assert.eq(new Set(names).size, names.length, 'no two sections share a name')
    const sample = commandGroups().flatMap(g => g.items).find(r => r.id === 'cmd:sample')
    if (sample) assert.includes(sample.hint, SAMPLE_TITLE)
  })

  it('Planning\'s toggles are a property row, Intent, beside Priority\'s label column', async () => {
    const doc = await appPage()
    const pane = doc.getElementById('inspectorPane').cloneNode(true)
    pane.querySelector('#inspectorContent').style.display = 'block'
    pane.querySelector('#planningDetails').setAttribute('open', '')
    const f = await frame(`<div class="panel-content" style="width:320px">${pane.outerHTML}</div>`, { width: 320 })
    try {
      const d = f.contentDocument, x = s => d.querySelector(s).getBoundingClientRect().left
      assert.eq(d.getElementById('inspIntentCaption').textContent.trim(), 'Intent')
      assert.ok(Math.abs(x('#inspIntentCaption') - x('#inspPriorityCaption')) < 1, 'one label column')
      assert.ok(Math.abs(x('#planningDetails .action-toggle') - x('#inspPriorityBtn')) < 1, 'the toggles start at the field column, like the chip')
      assert.ok(Math.abs(x('#planningDetails .insp-help') - x('#inspPriorityBtn')) < 1, 'the help under them')
    } finally { f.remove() }
  })

  it('every date the app writes reads the same way: the Markdown and the meeting summary say "Oct 4, 2026"', () => {
    const old = document.documentElement.lang
    document.documentElement.lang = 'en'
    try {
      const date = buildMarkdown().split('\n')[1]
      assert.match(date, /^_[A-Z][a-z]{2} \d{1,2}, \d{4}_$/, date)
      const now = new Date(2026, 9, 4, 13, 5)
      const stamp = buildMeetingSummary({ now }).split('\n')[1]
      assert.match(stamp, /^_Oct 4, 2026, (13:05|1:05\sPM)_$/, stamp)
      assert.eq(shortDate(now, { now, year: true }), 'Oct 4, 2026')
    } finally { document.documentElement.lang = old }
  })

  it('the living docs use the sentence-case type labels too', async () => {
    for (const file of ['../DESIGN.md', '../CLAUDE.md', '../README.md', '../llms.txt']) {
      const text = await (await fetch(file, { cache: 'no-store' })).text()
      ;['Open Question', 'Trigger / End', 'Resource / System'].forEach(w => assert.notIncludes(text, w, `${file}: "${w}"`))
    }
  })

  it('the comment that explains ACTION_ASKS sits on ACTION_ASKS', async () => {
    const src = await (await fetch('../js/utils.js', { cache: 'no-store' })).text()
    const at = src.indexOf('// What a chip asks the plan to do')
    assert.ok(at >= 0)
    const next = src.slice(at).split('\n').find(l => !l.startsWith('//'))
    assert.match(next, /^export const ACTION_ASKS/, next)
  })

  it('the sheet\'s key column puts one space beside a word, not a space and a gap', async () => {
    const row = `<dl class="shortcut-list"><div class="shortcut-row"><dt class="shortcut-keys">${phraseCapsHtml('N, then a letter')}</dt><dd>x</dd></div></dl>` +
      `<div class="pf-menu"><span class="pf-menu-shortcut">${keyCapsHtml('N K', { cls: 'pf-menu-key' })}</span></div>`
    const f = await frame(row, { width: 390 })
    try {
      const d = f.contentDocument, r = el => el.getBoundingClientRect()
      assert.eq(f.contentWindow.getComputedStyle(d.querySelector('.shortcut-keys')).columnGap, '0px')
      const cap = d.querySelector('.shortcut-keys kbd'), sep = d.querySelector('.shortcut-keys .kbd-sep'), word = d.querySelector('.shortcut-keys .kbd-word')
      assert.ok(Math.abs(r(sep).left - r(cap).right) < 0.5 && Math.abs(r(word).left - r(sep).right) < 0.5, 'the words carry the space')
      const [n, k] = d.querySelectorAll('.pf-menu kbd'), then = d.querySelector('.pf-menu .kbd-then')
      assert.ok(Math.abs(r(then).left - r(n).right) < 0.5 && Math.abs(r(k).left - r(then).right) < 0.5, 'a chord in a menu too')
    } finally { f.remove() }
  })
})
