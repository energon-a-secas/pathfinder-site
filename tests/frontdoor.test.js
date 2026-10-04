// ============================================================
//  frontdoor.test.js: the FRONTDOOR stream (design round, wave 2).
//  The start panel an empty map opens on (markup, the prefix helper
//  that has to agree with the classifier, the sample map, the template
//  menu, the 1/2/3 keys, contrast in both themes), the right panel
//  with nothing selected, and the reading pages: the examples gallery
//  and the walkthrough strip drawn by tools/render-assets.mjs, the
//  404, the share card and its alt text, the README's top, and no
//  sideways scroll on a phone.
// ============================================================

import { describe, it, assert, cssRgba } from './test-utils.js'
import { state, ui, canvasMeta, serializeCanvas, applyPromptOpts, getUndoHistory, getRedoFuture } from '../js/state.js'
import { TYPES } from '../js/utils.js'
import { categorizeLine } from '../js/classify.js'
import { TEMPLATES } from '../js/templates.js'
import { EXAMPLE_CANVAS } from '../js/example-canvas.js'
import { detectGaps } from '../js/gaps.js'
import { normalizeCanvas } from '../js/normalize.js'
import { closeMenus, isMenuOpen } from '../js/menu.js'
import { currentId } from '../js/library.js'
import { EXAMPLES, payloadFor } from '../js/examples-page.js'
import { isInlineEditing, commitInlineEdit } from '../js/inline-edit.js'
import {
  SAMPLE_TITLE, SAMPLE_ARRIVAL, samplePayload, sampleSummary, openSampleMap, announceArrival, templateMenuItems,
  applyTemplateFromPalette, PREFIX_WORDS, PRIMARY_PREFIX_TYPES, prefixTable, prefixWords,
  prefixHelpHtml, indentSentence, FIRST_BLOCK_TYPES, firstBlockPillsHtml,
  setupStartPanel, startPanelVisible, tabName, syncInspectorEmptyNames,
} from '../js/start-panel.js'

// ── Helpers ─────────────────────────────────────────────────

const fetchText = async url => (await fetch(url, { cache: 'no-store' })).text()
// An exported SVG's own size, from its root element.
const svgSize = svg => {
  const m = svg.match(/<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/)
  assert.ok(m, 'an SVG the exporter drew')
  return [+m[1], +m[2]]
}
// The share of its own size a page draws a map at (tools/render-assets.mjs).
const picScale = async () => +(await fetchText('../tools/render-assets.mjs')).match(/\nconst PIC_SCALE = ([\d.]+)/)[1]
const parse = html => new DOMParser().parseFromString(html, 'text/html')
let indexDoc = null
const index = async () => indexDoc ?? (indexDoc = parse(await fetchText('../index.html')))
const EM_DASH = String.fromCharCode(0x2014)

// The real stylesheet in a shadow root, `body` as a wrapper div, so a theme
// class applies to the probe only (the design-tokens tests do the same).
async function themed(bodyClass = '', replace = s => s) {
  const css = replace(await fetchText('../css/style.css'))
    .replace(/:root\b/g, ':host')
    .replace(/(?<![\w.-])body(?![\w-])/g, '.pf-body')
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-6000px;top:0;width:900px;height:700px'
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  const still = new CSSStyleSheet()
  still.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }')
  root.adoptedStyleSheets = [sheet, still]
  const page = document.createElement('div')
  page.className = ('pf-body ' + bodyClass).trim()
  root.appendChild(page)
  const add = html => { const d = document.createElement('div'); d.innerHTML = html; page.appendChild(d); return d }
  return { page, add, done: () => host.remove() }
}
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const over = (fg, bg) => { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)) }
const ratio = (fg, bg) => { const f = over(fg, bg); const [x, y] = [lum(f), lum(bg)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
// The colour an element's background resolves to, walking up past transparent ones.
function ground(el) {
  for (let n = el; n; n = n.parentElement) {
    const c = cssRgba(getComputedStyle(n).backgroundColor)
    if (c && c[3] > 0) return c[3] < 1 ? over(c, ground(n.parentElement) || [0, 0, 0]) : c.slice(0, 3)
  }
  return null
}

// Another page, its own stylesheets and markup, no scripts (and no images
// unless `images`), at a size. Its body class can be set (light-mode).
async function pageFrame(file, width, height, { images = false, bodyClass = null } = {}) {
  const doc = parse(await fetchText('../' + file))
  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href')).filter(h => h && !/^[a-z]+:/i.test(h))
  doc.querySelectorAll(images ? 'script, iframe' : 'script, img, iframe').forEach(n => n.remove())
  if (images) doc.querySelectorAll('img[src]').forEach(i => { if (!/^[a-z]+:/i.test(i.getAttribute('src'))) i.setAttribute('src', '../' + i.getAttribute('src').replace(/^\//, '')) })
  if (bodyClass !== null) doc.body.className = bodyClass
  const frame = document.createElement('iframe')
  frame.style.cssText = `position:fixed;left:-6000px;top:0;width:${width}px;height:${height}px;border:0`
  frame.srcdoc = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
    links.map(h => `<link rel="stylesheet" href="../${h.replace(/^\//, '')}">`).join('') +
    `</head><body class="${doc.body.className}">${doc.body.innerHTML}</body></html>`
  const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
  document.body.appendChild(frame)
  await loaded
  await new Promise(r => setTimeout(r, 50))
  return frame
}

// Storage, the canvas, the URL and the undo stack, put back after a test
// that opens a map of its own.
async function sandbox(fn) {
  const before = JSON.parse(JSON.stringify(serializeCanvas()))
  const flags = { readOnly: ui.readOnly, embed: ui.embed }
  const url = location.href
  const saved = new Map()
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('pathfinder-')) saved.set(k, localStorage.getItem(k))
  }
  const undoLen = getUndoHistory().length
  try {
    ui.readOnly = false; ui.embed = false
    await fn()
    await new Promise(requestAnimationFrame)
  } finally {
    Object.assign(state, { blocks: before.blocks, arrows: before.arrows, groups: before.groups })
    Object.assign(canvasMeta, before.meta)
    delete canvasMeta.prompt
    applyPromptOpts(before.meta.prompt)
    Object.assign(ui, flags)
    history.replaceState(null, '', url)
    getUndoHistory().length = Math.min(getUndoHistory().length, undoLen)
    getRedoFuture().length = 0
    const now = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('pathfinder-')) now.push(k)
    }
    now.forEach(k => { if (!saved.has(k)) localStorage.removeItem(k) })
    saved.forEach((v, k) => localStorage.setItem(k, v))
    document.querySelectorAll('.toast-notification').forEach(t => t.remove())
  }
}

// ── The start panel's markup ────────────────────────────────

describe('frontdoor: the start panel says what the tool is and offers three ways in', () => {
  it('the heading, the lede, and three keyed options with real names', async () => {
    const doc = await index()
    const panel = doc.querySelector('#brainDump #startPanel')
    assert.ok(panel, 'the panel lives in #brainDump, which updateHint shows and hides')
    assert.ok(panel.hasAttribute('data-canvas-ui'), 'a press on it never reaches the canvas')
    assert.eq(panel.querySelector('h2').textContent.trim(), 'Plan the work before an agent builds it')
    const lede = panel.querySelector('.start-lede').textContent
    for (const word of ['missing', 'brief', 'Claude Code']) assert.includes(lede, word, 'the lede names the gap check and the brief')
    const opts = [...panel.querySelectorAll('.start-options .start-opt')]
    assert.deepEq(opts.map(b => b.tagName), ['BUTTON', 'BUTTON', 'BUTTON'])
    assert.deepEq(opts.map(b => b.getAttribute('aria-keyshortcuts')), ['1', '2', '3'])
    assert.deepEq(opts.map(b => b.querySelector('.start-opt-title').textContent), ['Paste your notes', 'Start from a template', 'Open the sample map'])
    opts.forEach(b => assert.eq(b.getAttribute('type'), 'button'))
    assert.eq(opts[0].getAttribute('aria-expanded'), 'false')
    assert.eq(opts[0].getAttribute('aria-controls'), 'startNotes')
    assert.eq(opts[1].getAttribute('aria-haspopup'), 'menu')
  })

  it('the notes field opens in place: labelled, described by the prefix line, folded at first', async () => {
    const doc = await index()
    const notes = doc.getElementById('startNotes')
    assert.ok(notes.hasAttribute('hidden'), 'folded until asked for')
    const ta = notes.querySelector('textarea#brainDumpInput')
    assert.ok(doc.querySelector('label[for="brainDumpInput"]'), 'a real label')
    assert.eq(ta.getAttribute('aria-describedby'), 'startPrefixLine')
    assert.ok(doc.getElementById('startPrefixLine'), 'the line it points at exists')
    assert.ok(notes.querySelector('#brainDumpBtn.btn.btn-primary'), 'Turn into blocks is the one primary')
    assert.ok(notes.querySelector('#brainDumpNest[type="checkbox"]'))
  })

  it('every placeholder line lands on the type it shows, by its prefix or its question mark', async () => {
    const lines = (await index()).getElementById('brainDumpInput').getAttribute('placeholder').split('\n')
    const want = ['goal', 'problem', 'assumption', 'metric', 'risk', 'question']
    assert.eq(lines.length, want.length)
    lines.forEach((line, i) => {
      const r = categorizeLine(line)
      assert.eq(r.type, want[i], line)
      assert.eq(r.confidence, 'high', `${line}: no type check needed`)
    })
  })

  it('the first-block pills, the storage line, the walkthrough and the shortcuts sit under the options', async () => {
    const doc = await index()
    const panel = doc.getElementById('startPanel')
    assert.ok(panel.querySelector('#startFirstBlocks'), 'the first-block row')
    assert.eq(panel.querySelector('#startFirstTitle').textContent.trim(), 'Or add a first block')
    const foot = panel.querySelector('.start-foot')
    assert.includes(foot.textContent, 'Saved in this browser. No account, nothing uploaded.')
    assert.ok(foot.querySelector('a[href="tutorial.html"]'))
    assert.eq(foot.querySelector('#startShortcutsBtn').tagName, 'BUTTON')
    assert.ok(!panel.textContent.includes(EM_DASH), 'no em dash')
    assert.ok(!/brain dump/i.test(panel.textContent), 'the panel speaks of notes, not of a brain dump')
  })
})

// ── First-block pills ───────────────────────────────────────

describe('frontdoor: or add a first block', () => {
  it('offers Goal, Problem, Stakeholder, Metric, Requirement, Risk and Open Question, from the registry', async () => {
    assert.deepEq(FIRST_BLOCK_TYPES, ['goal', 'problem', 'stakeholder', 'metric', 'requirement', 'risk', 'question'])
    const row = (await index()).getElementById('startFirstBlocks')
    const pills = [...row.querySelectorAll('button.start-pill')]
    assert.deepEq(pills.map(b => b.dataset.type), FIRST_BLOCK_TYPES)
    // The markup on first paint is the markup the registry writes.
    const box = document.createElement('div')
    box.innerHTML = firstBlockPillsHtml()
    assert.eq(row.innerHTML.replace(/>\s+</g, '><').trim(), box.innerHTML, 'index.html matches firstBlockPillsHtml() (paste its output)')
    pills.forEach(b => {
      const t = b.dataset.type
      assert.eq(b.getAttribute('type'), 'button')
      assert.eq(b.textContent.trim(), TYPES[t].label)
      assert.eq(b.querySelector('.palette-dot').dataset.shape, TYPES[t].shape, `${t}: its shape, not only its colour`)
    })
  })

  it('a pill is named by what it shows: no number, nothing a 1, 2 or 3 key would contradict', async () => {
    const panel = (await index()).getElementById('startPanel')
    assert.ok(!panel.querySelector('#mapSteps, .map-step, .map-step-num'), 'not the numbered six-step row')
    panel.querySelectorAll('.start-pill').forEach(b => {
      assert.ok(!b.hasAttribute('aria-label'), `${b.dataset.type}: the visible words are the whole name`)
      assert.ok(!/\d/.test(b.textContent), `${b.dataset.type}: no digit in its name`)
      assert.ok(!b.hasAttribute('aria-keyshortcuts'))
    })
  })
})

// ── The prefix helper agrees with the classifier ────────────

describe('frontdoor: the prefix helper says only what the classifier does', () => {
  it('every prefix the panel shows sets its type (whichever table classify.js exports)', () => {
    const words = prefixWords()
    const shown = Object.entries(words)
    assert.ok(shown.length >= PRIMARY_PREFIX_TYPES.length, `${shown.length} prefixes shown`)
    PRIMARY_PREFIX_TYPES.forEach(t => assert.ok(words[t], `the line names a prefix for ${t}`))
    for (const [type, word] of shown) {
      const r = categorizeLine(`${word}: Something to plan`)
      assert.eq(r.type, type, `${word}: is ${type}`)
      assert.eq(r.title, 'Something to plan', `${word}: is taken off the title`)
    }
    assert.eq(categorizeLine('Is this ready to ship?').type, 'question', 'a trailing ? is a question')
  })

  it('the static line in index.html names the same prefixes, so it is true before any script runs', async () => {
    const line = (await index()).getElementById('startPrefixLine')
    const codes = [...line.querySelectorAll('code')].map(c => c.textContent)
    PRIMARY_PREFIX_TYPES.forEach(t => assert.includes(codes, PREFIX_WORDS[t] + ':', t))
    assert.includes(codes, '?')
  })

  it('reads the shapes a prefix table may take, and ignores what it cannot use', () => {
    const a = prefixTable([{ type: 'goal', prefixes: ['goal:', 'objective'] }, { type: 'risk', prefix: 'risk' }, { type: 'nope', prefixes: ['x'] }])
    assert.deepEq([...a.entries()], [['goal', ['goal', 'objective']], ['risk', ['risk']]])
    const b = prefixTable({ metric: ['kpi', 'metric'], 'who': 'stakeholder' })
    assert.deepEq(b.get('metric'), ['kpi', 'metric'])
    assert.deepEq(b.get('stakeholder'), ['who'])
    assert.eq(prefixTable([{ re: /^goal:/, type: 'goal' }]), null, 'regex rows carry no words to show')
    assert.eq(prefixTable(null), null)
    // The panel's own word wins when the table has it, else the table's first.
    const w = prefixWords([{ type: 'metric', prefixes: ['kpi', 'metric'] }, { type: 'goal', prefixes: ['objective'] }])
    assert.eq(w.metric, 'Metric')
    assert.eq(w.goal, 'Objective')
    assert.eq(w.risk, undefined, 'a type the table leaves out is not promised')
  })

  it('writes the line and keeps the rest one click away', () => {
    const html = prefixHelpHtml(PREFIX_WORDS)
    const box = document.createElement('div')
    box.innerHTML = html
    const line = box.querySelector('p#startPrefixLine')
    assert.ok(line, 'the line keeps the id the field is described by')
    PRIMARY_PREFIX_TYPES.forEach(t => assert.includes(line.innerHTML, `<code>${PREFIX_WORDS[t]}:</code>`))
    const more = box.querySelector('details.start-prefixes')
    assert.eq(more.querySelector('summary').textContent, 'More prefixes')
    const rest = Object.keys(PREFIX_WORDS).filter(t => !PRIMARY_PREFIX_TYPES.includes(t))
    const items = [...more.querySelectorAll('.start-prefix-list > span')]
    assert.eq(items.length, rest.length)
    rest.forEach((t, i) => {
      assert.eq(items[i].querySelector('code').textContent, `${PREFIX_WORDS[t]}:`)
      // The type is named only where the word does not already say it.
      const named = items[i].textContent.slice(`${PREFIX_WORDS[t]}:`.length).trim()
      const says = TYPES[t].label.toLowerCase().includes(PREFIX_WORDS[t].toLowerCase())
      assert.eq(named, says ? '' : TYPES[t].label, `${t}: "${items[i].textContent}"`)
    })
    assert.includes(more.textContent, 'Step: Process', 'a word that is not its type says the type')
    for (const w of ['Decision', 'Output', 'Context']) assert.ok(!more.textContent.includes(`${w}: ${w}`), `no "${w}: ${w}"`)
    assert.ok(!box.textContent.includes(EM_DASH))
  })

  it('reads the prefix table classify.js exports for the panel (show), before its other spellings', () => {
    const t = prefixTable([{ type: 'stakeholder', show: ['who', 'stakeholder'], sure: ['who'], keys: ['audience', 'who'] },
      { type: 'question', show: ['question'], keys: ['q', 'question'] }])
    assert.deepEq(t.get('stakeholder'), ['who', 'stakeholder'])
    assert.deepEq(t.get('question'), ['question'])
    assert.eq(prefixWords([{ type: 'metric', show: ['metric'], keys: ['kpi'] }]).metric, 'Metric')
  })

  it('the indent sentence says what the notes field will do with indented lines', () => {
    assert.eq(indentSentence(true, PREFIX_WORDS, null), 'Indented lines add detail to the line above.')
    assert.eq(indentSentence(false, PREFIX_WORDS, null), 'Every line becomes a block of its own, indented or not.')
    // Where the classifier makes "- " lines criteria (BRAINDUMP's CRITERIA_FROM_BULLETS), it says so.
    const withCriteria = indentSentence(true, PREFIX_WORDS, new Set(['requirement', 'metric']))
    assert.eq(withCriteria, 'Indented lines add detail to the line above; under a <code>Req:</code> or <code>Metric:</code> line, <code>-</code> lines become its criteria.')
    assert.eq(indentSentence(false, PREFIX_WORDS, new Set(['requirement'])), indentSentence(false, PREFIX_WORDS, null), 'folding off, no criteria either')
    const html = prefixHelpHtml(PREFIX_WORDS, { nest: false, criteria: null })
    assert.includes(html, '<span id="startIndentLine">Every line becomes a block of its own')
  })

  it('a phone or tablet does not offer Ctrl + Enter', async () => {
    const css = await fetchText('../css/style.css')
    assert.match(css, /@media \(hover: none\) and \(pointer: coarse\) \{ \.start-submit-hint \{ display: none; \} \}/)
  })
})

// ── The sample map ──────────────────────────────────────────

describe('frontdoor: the sample map opens as a map of its own', () => {
  it('is the walkthrough example, named for the Maps menu, and a copy', () => {
    const p = samplePayload()
    assert.eq(p.meta.title, SAMPLE_TITLE)
    assert.eq(SAMPLE_TITLE, 'Sample: Checkout 500s')
    assert.eq(Object.keys(p.blocks).length, EXAMPLE_CANVAS.blocks.length)
    assert.eq(p.arrows.length, EXAMPLE_CANVAS.arrows.length)
    p.blocks.t2.title = 'changed'
    p.blocks.t11.criteria.push('changed')
    assert.neq(EXAMPLE_CANVAS.blocks.find(b => b.id === 't2').title, 'changed', 'editing the sample never edits the example')
    assert.ok(!EXAMPLE_CANVAS.blocks.find(b => b.id === 't11').criteria.includes('changed'))
    assert.eq(normalizeCanvas(samplePayload()).dropped.blocks, 0, 'it loads without losses')
  })

  it('its line on the panel is counted from the map, so it cannot say what the map is not', () => {
    const clean = normalizeCanvas(samplePayload())
    const gaps = detectGaps(clean.blocks, clean.arrows).count
    const text = sampleSummary()
    assert.match(text, new RegExp(`^${Object.keys(clean.blocks).length} blocks`))
    if (gaps) assert.includes(text, 'open gap')
    else assert.ok(!/gap/.test(text), 'no gap claim for a map without gaps')
  })

  it('opening it leaves your map in the library and switches to the sample', () => sandbox(async () => {
    const before = currentId()
    state.blocks = {}; state.arrows = []; state.groups = {}
    canvasMeta.title = ''
    const r = openSampleMap()
    assert.ok(r, 'it opened')
    assert.eq(canvasMeta.title, SAMPLE_TITLE)
    assert.eq(Object.keys(state.blocks).length, EXAMPLE_CANVAS.blocks.length)
    assert.ok(before === null || currentId() !== before, 'a map of its own')
    const names = JSON.parse(localStorage.getItem('pathfinder-maps') || '[]').map(m => m.name || m.title)
    assert.includes(names, SAMPLE_TITLE)
  }))

  it('lands once, through the camera\'s own arrival, and says what opened', async () => {
    assert.eq(SAMPLE_ARRIVAL, 'Sample: Checkout 500s opened. Your own map is under Maps.')
    // ZOOM's API: arriveAfterLoad(ids, { lead }) runs arriveAt after the load's fit.
    const calls = []
    const zoomApi = { arriveAfterLoad: (ids, opts) => { calls.push(['after', ids, opts]); return Promise.resolve({ whole: false }) },
      arriveAt: (ids, opts) => calls.push(['at', ids, opts]) }
    assert.eq(announceArrival(SAMPLE_ARRIVAL, zoomApi), 'arriveAfterLoad')
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    assert.eq(calls.length, 1, 'one arrival, not a second camera move')
    assert.eq(calls[0][0], 'after')
    assert.eq(calls[0][2].lead, SAMPLE_ARRIVAL, 'the toast text goes in `lead`, the option arriveAt reads')
    assert.ok(!('name' in calls[0][2]))
    // An arriveAt without arriveAfterLoad still gets the lead, after the load's frame.
    const only = []
    assert.eq(announceArrival('X opened.', { arriveAt: (ids, opts) => only.push(opts) }), 'arriveAt')
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))
    assert.deepEq(only, [{ lead: 'X opened.' }])
    // Without the camera module's arrival, the toast alone says it.
    try {
      assert.eq(announceArrival('Y opened.', {}), 'toast')
      assert.includes(document.querySelector('.toast-notification')?.textContent || '', 'Y opened.')
    } finally { document.querySelectorAll('.toast-notification').forEach(t => t.remove()) }
  })

  it('never opens on a view-only link or an embed', () => sandbox(async () => {
    ui.readOnly = true
    assert.eq(openSampleMap(), false)
    ui.readOnly = false; ui.embed = true
    assert.eq(openSampleMap(), false)
  }))
})

// ── The template menu ───────────────────────────────────────

describe('frontdoor: start from a template', () => {
  it('lists the worked maps first, by job, in sentence case, then the smaller starters', () => {
    const picked = []
    const items = templateMenuItems(t => picked.push(t))
    const large = TEMPLATES.filter(t => t.large)
    assert.eq(items[0].type, 'heading')
    const rows = items.filter(i => !i.type && !i.submenu)
    assert.deepEq(rows.map(r => r.label), large.map(t => t.name.charAt(0) + t.name.slice(1).toLowerCase()))
    assert.deepEq(rows.map(r => r.label), ['Investigate a bug', 'Inherit a codebase', 'Migrate a system', 'Recurring reporting flow'])
    rows.forEach((r, i) => assert.includes(r.hint, `${large[i].blocks.length} blocks`))
    const more = items.find(i => i.submenu)
    assert.eq(more.label, 'Smaller starters')
    assert.eq(more.submenu.length, TEMPLATES.filter(t => !t.large).length)
    rows[2].action()
    assert.eq(picked[0], large[2], 'a row applies its own template')
  })

  it('applies through the palette row, so it takes the palette\'s exact path', () => {
    const list = document.getElementById('templatesList')
    const saved = list.innerHTML
    try {
      const tpl = TEMPLATES.find(t => t.name === 'Migrate a System')
      const i = TEMPLATES.indexOf(tpl)
      list.innerHTML = `<button type="button" class="template-item" data-tpl="${i}">Migrate</button>`
      let clicked = 0
      list.firstChild.addEventListener('click', () => clicked++)
      assert.eq(applyTemplateFromPalette(tpl), true)
      assert.eq(clicked, 1)
      list.innerHTML = ''
      assert.eq(applyTemplateFromPalette(tpl), false, 'no row, no apply')
    } finally {
      list.innerHTML = saved
      document.querySelectorAll('.toast-notification').forEach(t => t.remove())
    }
  })
})

// ── The keys, the field, Escape ─────────────────────────────

describe('frontdoor: 1, 2 and 3 on the start panel', () => {
  // The real panel's markup, rendered off screen in this document.
  async function mount() {
    const doc = await index()
    const wrap = document.createElement('div')
    wrap.style.cssText = 'position:fixed;left:-6000px;top:0;width:700px'
    wrap.innerHTML = doc.getElementById('brainDump').outerHTML
    document.body.appendChild(wrap)
    state.blocks = {}; state.arrows = []; state.groups = {}
    ui.readOnly = false; ui.embed = false
    setupStartPanel()
    return () => { closeMenus(); wrap.remove() }
  }
  const press = (key, target = document.body, opts = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }))

  it('1 opens the notes and puts the cursor in them; Escape folds them back onto the option', async () => {
    const unmount = await mount()
    try {
      assert.ok(startPanelVisible())
      document.activeElement?.blur()
      press('1')
      const btn = document.getElementById('startNotesBtn')
      assert.eq(btn.getAttribute('aria-expanded'), 'true')
      assert.eq(document.getElementById('startNotes').hidden, false)
      assert.eq(document.activeElement?.id, 'brainDumpInput')
      // A digit typed in the field is text, never a shortcut.
      press('2', document.activeElement)
      assert.eq(isMenuOpen(), false)
      press('Escape', document.activeElement)
      assert.eq(btn.getAttribute('aria-expanded'), 'false')
      assert.eq(document.activeElement, btn)
    } finally { unmount() }
  })

  it('2 opens the template menu; a modifier or a view-only map leaves the keys alone', async () => {
    const unmount = await mount()
    try {
      document.activeElement?.blur()
      press('2', document.body, { ctrlKey: true })
      assert.eq(isMenuOpen(), false, 'Ctrl+2 is not 2')
      press('2')
      assert.eq(isMenuOpen(), true)
      assert.eq(document.getElementById('startTemplateBtn').getAttribute('aria-expanded'), 'true')
      closeMenus()
      ui.readOnly = true
      press('2')
      assert.eq(isMenuOpen(), false, 'no start panel on a view-only map')
    } finally { ui.readOnly = false; unmount() }
  })

  it('Ctrl or Cmd + Enter turns the notes into blocks, one undo step, and the panel no longer applies', async () => {
    const unmount = await mount()
    const undo = getUndoHistory().length
    try {
      const btn = document.getElementById('startNotesBtn')
      btn.click()
      const ta = document.getElementById('brainDumpInput')
      press('Enter', ta, { ctrlKey: true })
      assert.eq(Object.keys(state.blocks).length, 0, 'an empty field makes nothing')
      ta.value = 'Goal: Cut onboarding drop-off\nRisk: A checklist slows admins'
      press('Enter', ta, { metaKey: true })
      const blocks = Object.values(state.blocks)
      assert.deepEq(blocks.map(b => b.type).sort(), ['goal', 'risk'])
      assert.eq(ta.value, '', 'the field empties')
      assert.eq(getUndoHistory().length, undo + 1, 'one undo step')
      assert.eq(startPanelVisible(), false)
    } finally {
      state.blocks = {}; state.arrows = []
      getUndoHistory().length = undo
      document.querySelectorAll('#canvasRoot .block').forEach(b => b.remove())
      document.querySelectorAll('.toast-notification').forEach(t => t.remove())
      unmount()
    }
  })

  it('a first-block pill adds that type, opens its title, and the panel no longer applies', async () => {
    const unmount = await mount()
    const undo = getUndoHistory().length
    try {
      document.querySelector('#startFirstBlocks .start-pill[data-type="risk"]').click()
      const blocks = Object.values(state.blocks)
      assert.eq(blocks.length, 1)
      assert.eq(blocks[0].type, 'risk')
      assert.ok(isInlineEditing(), 'the new card opens in title edit')
      assert.eq(startPanelVisible(), false)
    } finally {
      if (isInlineEditing()) commitInlineEdit()
      state.blocks = {}; state.arrows = []
      getUndoHistory().length = undo
      document.querySelectorAll('#canvasRoot .block').forEach(b => b.remove())
      document.querySelectorAll('.toast-notification').forEach(t => t.remove())
      unmount()
    }
  })

  it('the indent sentence follows the fold checkbox', async () => {
    const unmount = await mount()
    try {
      const nest = document.getElementById('brainDumpNest')
      const line = () => document.getElementById('startIndentLine').textContent
      assert.ok(nest.checked)
      assert.match(line(), /^Indented lines add detail to the line above/)
      nest.checked = false
      nest.dispatchEvent(new Event('change', { bubbles: true }))
      assert.eq(line(), 'Every line becomes a block of its own, indented or not.')
      nest.checked = true
      nest.dispatchEvent(new Event('change', { bubbles: true }))
      assert.match(line(), /^Indented lines/)
      // Escape on the checkbox folds the notes, as it does in the field.
      document.getElementById('startNotesBtn').click()
      nest.focus()
      press('Escape', nest)
      assert.eq(document.getElementById('startNotesBtn').getAttribute('aria-expanded'), 'false')
      assert.eq(document.activeElement?.id, 'startNotesBtn')
      // The field is still described by the line the sentence sits in.
      assert.ok(document.getElementById('startPrefixLine').contains(document.getElementById('startIndentLine')))
    } finally { unmount() }
  })
})

// ── Contrast ────────────────────────────────────────────────

describe('frontdoor: the start panel reads in both themes', () => {
  for (const [name, cls] of [['dark', ''], ['light', 'light-mode']]) {
    for (const hover of [false, true]) {
      it(`${name}${hover ? ', option hovered' : ''}: every line on the panel at 4.5:1`, async () => {
        const doc = await index()
        const t = await themed(cls, css => hover ? css.replace(/\.start-(opt|pill):hover/g, '.start-$1.hv') : css)
        try {
          const box = t.add(doc.getElementById('brainDump').innerHTML)
          if (hover) box.querySelectorAll('.start-opt, .start-pill').forEach(b => b.classList.add('hv'))
          box.querySelector('#startNotes').hidden = false
          const checks = ['.start-title', '.start-lede', '.start-opt-title', '.start-opt-desc', '.start-panel kbd',
            '.start-help', '.start-help code', '.brain-dump-nest span', '.start-foot', '.start-foot a', '.start-link', '.start-first-title', '.start-pill']
          for (const sel of checks) {
            const el = box.querySelector(sel)
            assert.ok(el, sel)
            const r = ratio(cssRgba(getComputedStyle(el).color), ground(el))
            assert.ok(r >= 4.5, `${name} ${sel}: ${r.toFixed(2)}:1`)
          }
          const icon = box.querySelector('.start-opt-icon')
          const ri = ratio(cssRgba(getComputedStyle(icon).color), ground(icon.parentElement))
          assert.ok(ri >= 3, `${name} option icon: ${ri.toFixed(2)}:1`)
        } finally { t.done() }
      })
    }
  }

  it('one flat surface, the system radii, and no colour that is not a token', async () => {
    const t = await themed('')
    try {
      const box = t.add((await index()).getElementById('brainDump').innerHTML)
      const panel = getComputedStyle(box.querySelector('.start-panel'))
      assert.eq(panel.boxShadow, 'none')
      assert.eq(panel.backdropFilter, 'none')
      assert.eq(panel.borderTopLeftRadius, '10px')
      assert.eq(getComputedStyle(box.querySelector('.start-opt')).borderTopLeftRadius, '6px', 'an option is a control')
      assert.eq(getComputedStyle(box.querySelector('.start-panel kbd')).borderTopLeftRadius, '4px', 'a key is a label')
    } finally { t.done() }
    const css = await fetchText('../css/style.css')
    const at = css.indexOf('/* ════ [frontdoor] ════ */')
    const section = css.slice(at, css.indexOf('/* ════ [zoom] ════ */')).replace(/\/\*[\s\S]*?\*\//g, '')
    assert.ok(!/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\(/i.test(section), 'tokens only in [frontdoor]')
    assert.ok(!/border-(left|right):\s*[2-9]/.test(section), 'no side stripes')
    assert.ok(!/transition:[^;]*\ball\b/.test(section), 'transitions name their properties')
  })
})

// ── The right panel with nothing selected ───────────────────

describe('frontdoor: the right panel with nothing selected', () => {
  it('says what each tab is for, by the tabs\' own names, and each name opens its tab', async () => {
    const doc = await index()
    const box = doc.getElementById('inspectorEmpty')
    assert.includes(box.textContent, 'Select a block to edit it here.')
    assert.includes(box.textContent, 'Select a block to read it here.', 'view-only wording')
    const goto = [...box.querySelectorAll('button[data-goto-tab]')].map(b => b.dataset.gotoTab)
    assert.deepEq(goto, ['prompt', 'attention'])
    goto.forEach(t => assert.ok(doc.querySelector(`.panel-tab[data-tab="${t}"]`), `${t} is a real tab`))
    assert.ok(!box.querySelector('svg[fill="currentColor"]'), 'no filled glyph')
  })

  it('reads true whatever the tabs are called, and follows a rename', async () => {
    const doc = await index()
    const live = doc.getElementById('inspectorEmpty').cloneNode(true)
    // Each sentence holds for today's label and for "Brief" (the BRIEF stream's).
    for (const label of ['Prompt', 'Brief']) {
      const p = live.querySelector('.insp-empty-tabs').cloneNode(true)
      p.querySelector('[data-goto-tab="prompt"]').textContent = label
      const text = p.textContent.replace(/\s+/g, ' ')
      assert.ok(!new RegExp(`\\b${label}\\b[^.]*\\b${label}\\b`, 'i').test(text), `"${text}" repeats ${label}`)
    }
    // A tab renamed after setup renames its link in the empty state.
    const tabs = document.createElement('div')
    tabs.className = 'panel-tablist'
    tabs.innerHTML = '<button class="panel-tab" data-tab="prompt">Prompt</button><button class="panel-tab" data-tab="attention">Attention<span class="tab-count">3</span></button>'
    const box = document.getElementById('inspectorEmpty')
    const saved = box.innerHTML
    document.body.appendChild(tabs)
    try {
      box.innerHTML = live.innerHTML
      setupStartPanel()
      assert.eq(box.querySelector('[data-goto-tab="attention"]').textContent, 'Attention', 'no count in the name')
      tabs.firstChild.textContent = 'Brief'
      await new Promise(r => setTimeout(r, 0))
      assert.eq(box.querySelector('[data-goto-tab="prompt"]').textContent, 'Brief')
      tabs.firstChild.textContent = 'Prompt'
      syncInspectorEmptyNames(box)
      assert.eq(box.querySelector('[data-goto-tab="prompt"]').textContent, 'Prompt')
    } finally { tabs.remove(); box.innerHTML = saved }
  })

  it('a tab\'s name drops its count and anything hidden', () => {
    const tab = document.createElement('button')
    tab.innerHTML = 'Attention<span class="tab-count">11</span><span class="sr-only">, 11 items</span>'
    assert.eq(tabName(tab), 'Attention')
    tab.innerHTML = '<span>Brief</span>'
    assert.eq(tabName(tab), 'Brief')
    assert.eq(tabName(null), '')
  })
})

// ── The examples gallery ────────────────────────────────────

describe('frontdoor: the examples gallery', () => {
  it('is ordered by job, and every map opens through payloadFor', async () => {
    const doc = parse(await fetchText('../examples.html'))
    const keys = [...doc.querySelectorAll('[data-example]')].map(b => b.dataset.example)
    assert.deepEq(keys, EXAMPLES.map(e => e.key))
    keys.forEach(k => assert.ok(payloadFor(k), `${k} has a payload`))
    assert.eq(payloadFor('nothing'), null)
    assert.eq(doc.querySelector('main h1').textContent.trim(), 'Five finished maps to start from')
    assert.ok(!doc.querySelector('.doc-kicker'), 'no eyebrow')
    const buttons = [...doc.querySelectorAll('.ex-actions [data-example]')]
    buttons.forEach(b => assert.eq(b.textContent.trim(), 'Open as a new map'))
  })

  it('each pictured map has both pictures, drawn at reading size, and an excerpt of its brief', async () => {
    const doc = parse(await fetchText('../examples.html'))
    const scale = await picScale()
    for (const ex of EXAMPLES.filter(e => e.picture)) {
      const imgs = [...doc.querySelectorAll(`img[data-pic="${ex.slug}"]`)]
      assert.deepEq(imgs.map(i => i.getAttribute('src')), [`examples/${ex.slug}.svg`, `examples/${ex.slug}-light.svg`])
      imgs.forEach(i => assert.ok(i.getAttribute('alt').length > 40, `${ex.slug}: a real alt`))
      for (const img of imgs) {
        const [w, h] = svgSize(await fetchText('../' + img.getAttribute('src')))
        assert.eq(img.getAttribute('width'), String(Math.round(w * scale)), `${ex.slug}: width reserved at ${scale} (run make assets)`)
        assert.eq(img.getAttribute('height'), String(Math.round(h * scale)), `${ex.slug}: height reserved`)
        // The picture is a link to the whole map, in the frame that scrolls.
        const link = img.closest('a.ex-pic-link')
        assert.eq(link?.getAttribute('href'), img.getAttribute('src'), `${ex.slug}: opens the whole map`)
        assert.ok(link.closest('.ex-pic-frame'), `${ex.slug}: in a frame that scrolls sideways`)
      }
      const html = await fetchText('../examples.html')
      const body = html.match(new RegExp(`<!-- brief:${ex.slug} -->([\\s\\S]*?)<!-- /brief -->`))
      assert.ok(body, `${ex.slug}: excerpt markers`)
      const lines = body[1].split('\n')
      assert.eq(lines.length, 4, `${ex.slug}: four lines (run make assets)`)
      assert.match(lines[0], /^##+ /)
      assert.match(lines[2], /^## /)
      // The bullet names a block that is on this map: the excerpt is of this map's brief.
      const titles = Object.values(payloadFor(ex.key).blocks).map(b => b.title)
      assert.ok(titles.some(t => lines[3].includes(t)), `${ex.slug}: "${lines[3]}" names a block on the map`)
    }
  })

  it('every line of an excerpt that is not a heading belongs to that map alone', async () => {
    const html = await fetchText('../examples.html')
    const seen = new Map()
    for (const ex of EXAMPLES.filter(e => e.picture)) {
      const lines = html.match(new RegExp(`<!-- brief:${ex.slug} -->([\\s\\S]*?)<!-- /brief -->`))[1].split('\n')
      lines.filter(l => !/^#/.test(l)).forEach(l => {
        assert.ok(!seen.has(l), `"${l}" is in both ${seen.get(l)} and ${ex.slug}`)
        seen.set(l, ex.slug)
      })
    }
    // The mode sentences are the same for every map in a mode: not an excerpt.
    for (const shared of ['Investigate. Establish what is actually true', 'Review this strategy canvas and produce']) {
      assert.ok(![...seen.keys()].some(l => l.startsWith(shared)), shared)
    }
  })

  for (const [file, width] of [['examples.html', 1440], ['examples.html', 390], ['tutorial.html', 1440], ['tutorial.html', 390]]) {
    it(`${file} at ${width}px: every map picture reads (titles at 11px or more), and the page never scrolls sideways`, async () => {
      for (const theme of ['', 'light-mode']) {
        const f = await pageFrame(file, width, 900, { images: true, bodyClass: ('doc-page ' + theme).trim() })
        try {
          const d = f.contentDocument
          const shown = [...d.querySelectorAll('img.ex-pic')].filter(i => i.getClientRects().length)
          assert.ok(shown.length >= (file === 'examples.html' ? 4 : 1), `${file}: pictures shown`)
          for (const img of shown) {
            const [w] = svgSize(await fetchText(img.getAttribute('src')))
            const title = 14 * img.getBoundingClientRect().width / w
            assert.ok(title >= 11, `${theme || 'dark'} ${img.getAttribute('src')}: card titles at ${title.toFixed(1)}px`)
            assert.eq(/-light\.svg$/.test(img.getAttribute('src')), !!theme, `${theme || 'dark'}: the picture in its theme`)
          }
          assert.ok(d.documentElement.scrollWidth <= width, `${file} ${theme}: ${d.documentElement.scrollWidth}px wide`)
        } finally { f.remove() }
      }
    })
  }

  it('the meta says five maps and describes the share card', async () => {
    const doc = parse(await fetchText('../examples.html'))
    assert.match(doc.querySelector('meta[name="description"]').content, /^Five finished/)
    assert.ok(!/Four|validating/.test(doc.querySelector('meta[property="og:description"]').content))
  })
})

// ── The walkthrough ─────────────────────────────────────────

describe('frontdoor: the walkthrough', () => {
  it('opens with notes, the map they become and the brief, drawn from the app', async () => {
    const html = await fetchText('../tutorial.html')
    const doc = parse(html)
    const strip = doc.querySelector('figure.doc-strip')
    assert.ok(strip, 'the strip is there')
    assert.ok(strip.compareDocumentPosition(doc.querySelector('main h2')) & Node.DOCUMENT_POSITION_FOLLOWING, 'near the top')
    assert.deepEq([...strip.querySelectorAll('.doc-strip-label')].map(l => l.textContent.replace(/^\d/, '').trim()), ['Your notes', 'The map', 'The brief'])
    // The map's main row, cut from the same drawing, each a link to the whole map.
    const imgs = [...strip.querySelectorAll('img')]
    assert.deepEq(imgs.map(i => i.getAttribute('src')), ['examples/checkout-strip.svg', 'examples/checkout-strip-light.svg'])
    assert.deepEq(imgs.map(i => i.closest('a.ex-pic-link')?.getAttribute('href')), ['examples/checkout.svg', 'examples/checkout-light.svg'])
    const scale = await picScale()
    for (const img of imgs) {
      const [w, h] = svgSize(await fetchText('../' + img.getAttribute('src')))
      assert.eq(img.getAttribute('width'), String(Math.round(w * scale)), 'width reserved (run make assets)')
      assert.eq(img.getAttribute('height'), String(Math.round(h * scale)), 'height reserved')
    }
    const lines = html.match(/<!-- brief:checkout -->([\s\S]*?)<!-- \/brief -->/)[1].split('\n')
    assert.ok(lines.length >= 4 && /^## Situation/.test(lines[0]), 'the brief opens on its Situation (run make assets)')
    // The notes in the strip are step 2's notes.
    const notes = strip.querySelector('.doc-strip-text code').textContent
    assert.includes(doc.querySelector('main').textContent.split('Step 2.')[1], notes)
  })

  it('says what the interface says now: no drift left from the review', async () => {
    const html = await fetchText('../tutorial.html')
    for (const stale of ['correction chip', 'underpins', 'direction toggle', 'Festive', 'Then delete the assumption',
      'three more finished maps', 'Brain Dump', 'doc-kicker', 'Promote to Assumption']) {
      assert.ok(!html.includes(stale), `"${stale}" is gone`)
    }
    for (const now of ['enables', 'The caret beside Tidy', 'its connections stay', 'five finished maps', 'Paste your notes']) {
      assert.includes(html, now)
    }
    assert.ok(!html.includes(EM_DASH))
  })

  it('names the tabs and the reply control by what index.html calls them now', async () => {
    const app = await index()
    const tabs = [...app.querySelectorAll('.panel-tab')].map(tabName)
    assert.ok(tabs.length >= 3, `the tabs: ${tabs.join(', ')}`)
    // The reply control's name: the BRIEF stream's heading, or today's label.
    const reply = (app.getElementById('replyHeading')?.textContent ||
      app.querySelector('#patchSection .insp-label')?.firstChild?.textContent || '').trim()
    assert.ok(reply.length > 4, 'the reply control has a name')
    for (const file of ['tutorial.html', 'examples.html']) {
      const text = parse(await fetchText('../' + file)).querySelector('main').textContent.replace(/\s+/g, ' ')
      const named = [...text.matchAll(/\b([A-Z]\w+) tab\b/g)].map(m => m[1])
      assert.ok(named.length, `${file} names a tab`)
      named.forEach(n => assert.includes(tabs, n, `${file} says "${n} tab"; the tabs are ${tabs.join(', ')}`))
      assert.includes(text, reply, `${file} names the reply control "${reply}"`)
    }
  })

  for (const file of ['tutorial.html', 'examples.html']) {
    it(`${file} at 390px: no sideways scroll, the code blocks scroll inside`, async () => {
      const f = await pageFrame(file, 390, 844)
      try {
        const d = f.contentDocument
        assert.ok(d.documentElement.scrollWidth <= 390, `${file}: ${d.documentElement.scrollWidth}px wide`)
        const doc = d.querySelector('.doc')
        assert.eq(f.contentWindow.getComputedStyle(doc).minWidth, '0px')
      } finally { f.remove() }
    })
  }

  it('the reading pages follow the theme the app saved', async () => {
    for (const file of ['tutorial.html', 'examples.html', '404.html']) {
      const html = await fetchText('../' + file)
      assert.match(html, /localStorage\.getItem\('pathfinder-theme'\)==='light'\)document\.body\.classList\.add\('light-mode'\)/, file)
    }
  })
})

// ── The 404, the share card, the README ─────────────────────

describe('frontdoor: the 404, the share card and the README', () => {
  it('the 404 offers three ways on, on the shared buttons, in sentence case', async () => {
    const doc = parse(await fetchText('../404.html'))
    const links = [...doc.querySelectorAll('.nf-links a')]
    assert.deepEq(links.map(a => a.getAttribute('href')), ['/', '/tutorial.html', '/examples.html'])
    assert.deepEq(links.map(a => a.textContent), ['Open Pathfinder', 'Walkthrough', 'Examples'])
    assert.ok(links[0].classList.contains('btn-primary') && links.slice(1).every(a => a.classList.contains('btn-secondary')))
    assert.eq(doc.querySelectorAll('.btn-primary').length, 1, 'one primary')
  })

  it('every page that shares the card describes it, headline first, and the card is 1200 by 630', async () => {
    const ogLine = (await fetchText('../tools/render-assets.mjs')).match(/\nconst OG_LINE = '([^']+)'/)[1]
    assert.eq(ogLine, 'Plan the work before an agent builds it')
    for (const file of ['index.html', 'tutorial.html', 'examples.html', 'trace.html']) {
      const doc = parse(await fetchText('../' + file))
      const og = doc.querySelector('meta[property="og:image:alt"]')?.content
      const tw = doc.querySelector('meta[name="twitter:image:alt"]')?.content
      assert.ok(og && og.length > 30, `${file}: og:image:alt`)
      assert.eq(tw, og, `${file}: the same alt for both`)
      // The card prints one line above the map; the alt reads it first.
      assert.ok(og.startsWith(ogLine + '.'), `${file}: the alt opens with "${ogLine}"`)
    }
    const img = new Image()
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = '../og-preview.jpg?' + Date.now() })
    assert.eq(img.naturalWidth, 1200)
    assert.eq(img.naturalHeight, 630)
    const home = parse(await fetchText('../index.html'))
    assert.eq(home.querySelector('meta[property="og:title"]').content, 'Pathfinder: plan the work before an agent builds it')
  })

  it('the README opens on the app in both themes, the loop, and make dev', async () => {
    const md = await fetchText('../README.md')
    const top = md.split('\n## ')[0]
    assert.match(top, /<source media="\(prefers-color-scheme: light\)" srcset="docs\/screenshot-light\.png">/)
    assert.match(top, /<img src="docs\/screenshot-dark\.png"[^>]* alt="[^"]{40,}"/)
    for (const p of ['../docs/screenshot-dark.png', '../docs/screenshot-light.png']) {
      const r = await fetch(p, { method: 'HEAD', cache: 'no-store' })
      assert.ok(r.ok, `${p} exists`)
    }
    assert.includes(top, 'make dev')
    for (const step of ['**Map**', '**See the gaps**', '**Hand over a brief**']) assert.includes(top, step)
    assert.ok(!/8778|open `index\.html` directly/.test(top), 'no port or file:// advice that does not work')
    assert.ok(!top.includes(EM_DASH))
  })
})
