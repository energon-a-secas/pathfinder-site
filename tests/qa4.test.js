// ============================================================
//  qa4.test.js -- regression tests for wave 4's QA (critique,
//  personas and cross-browser lenses, 2026-10-16). Each block
//  names the defect it holds closed.
// ============================================================

import { describe, it, assert, cleanupMockEls, ONSCREEN } from './test-utils.js'
import { state, ui, view, selection, canvasMeta, serializeCanvas, applyPromptOpts, getUndoHistory, getRedoFuture,
         resetSnapshotToken } from '../js/state.js'
import { $, showToast, showCopyFallback, toastDuration } from '../js/utils.js'
import { renderBlock, deselectAll, deleteBlock, selectBlock, undo } from '../js/render.js'
import { GAP_META, ISOLATION_FINDING, gapLine, getGapFixes, runGapDetection } from '../js/gaps.js'
import { attentionBreakdown, attentionRowsHtml, openItemParts } from '../js/attention.js'
import { readiness } from '../js/brief.js'
import { applyGapFix, blockSize } from '../js/create.js'
import { rovePalette, paletteStops } from '../js/palette.js'
import { arrivalView } from '../js/zoom-controls.js'
import { layoutDump } from '../js/classify.js'
import { ARRIVAL_PAD } from '../js/zoom-controls.js'
import { fitFaceTitle, FACE_METRICS } from '../js/face-text.js'
import { patchRowWords, patchKindWord } from '../js/patch.js'
import { relationOf } from '../js/relations.js'
import { taskChecklist } from '../js/task-plan.js'
import { generatePrompt } from '../js/prompt.js'
import { openConnectToMenu, sayConnected, reverseConnection } from '../js/context-menu.js'
import { closeMenus, isMenuOpen } from '../js/menu.js'
import { isInlineEditing, commitInlineEdit, startInlineEdit } from '../js/inline-edit.js'
import { SHORTCUTS, setupTemplates, importMessage } from '../js/ui-panels.js'
import { TEMPLATES } from '../js/templates.js'
import { CARD_GAP } from '../js/layout.js'
import { currentId, ensureLibrary, isBlankMap } from '../js/library.js'
import { openSampleMap, SAMPLE_TITLE, SAMPLE_OPENED } from '../js/start-panel.js'

function reset() {
  closeMenus()
  if (isInlineEditing()) commitInlineEdit()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  ui.hoveredBlockId = null
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
  selection.ids.clear(); selection.blockId = null; selection.arrowId = null
  view.panX = 0; view.panY = 0; view.zoom = 1
  document.querySelectorAll('.toast-notification').forEach(t => t.remove())
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '',
    x: 40, y: 40, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, highlight: null, ...extra }
  renderBlock(id)
}

const fetchText = async path => (await fetch(path, { cache: 'no-store' })).text()
const parse = html => new DOMParser().parseFromString(html, 'text/html')

let sheetPromise = null
function realSheet() {
  sheetPromise = sheetPromise || fetchText('../css/style.css').then(css => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    return sheet
  })
  return sheetPromise
}
async function shadow(markup, { width = 400 } = {}) {
  const sheet = await realSheet()
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-3000px;top:0;width:${width}px;height:300px`
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  const still = new CSSStyleSheet()
  still.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }')
  root.adoptedStyleSheets = [sheet, still]
  root.innerHTML = markup
  return { root, done: () => host.remove() }
}

// ── One name for a block with no connections ─────────────────
describe('qa4: isolation has one name, and the brief says a gap in one sentence', () => {
  it('"Not connected yet" on the card, in Attention and in the canvas finding', () => {
    assert.eq(GAP_META['gap-isolated'].short, 'Not connected yet')
    assert.eq(ISOLATION_FINDING.short, GAP_META['gap-isolated'].short)
    Object.values(GAP_META).forEach(g => assert.ok(!/isolated/i.test(g.short + g.prompt + (g.why || '')), g.short))
  })

  it('every gap line is one sentence: the type, the title, what is missing, one colon at most', () => {
    for (const gap of Object.keys(GAP_META)) {
      const line = gapLine('Goal', 'Ship it', gap)
      assert.ok(line.startsWith('• Goal "Ship it" '), line)
      assert.ok(line.endsWith('.') && !line.endsWith('..'), line)
      const rest = line.slice('• Goal "Ship it" '.length)
      assert.ok((rest.match(/: /g) || []).length <= 1, `one colon at most: ${line}`)
    }
    assert.eq(gapLine('Goal', 'Ship it', 'gap-no-req'), '• Goal "Ship it" has nothing under it: no requirement, metric or implementation.')
  })

  it('the brief prints the isolated goal in plain words', () => {
    reset()
    block('g', { title: 'Cut onboarding time' })
    ui.promptDirty = true
    const brief = generatePrompt()
    assert.includes(brief, '• Goal "Cut onboarding time" is not connected to anything on the map.')
    assert.notIncludes(brief, 'no connections:')
    reset()
  })

  it('the suggestion names the keyboard way too, and its button opens Connect to', () => {
    reset()
    block('a', { title: 'Alone' })
    block('b', { title: 'Other', x: 400 })
    const fix = getGapFixes(state.blocks.a).find(f => f.id === 'connect')
    assert.ok(fix, 'an isolated block has the connect fix')
    assert.includes(fix.text, 'press C')
    assert.eq(fix.action, 'Connect to…')
    let asked = null
    const hear = e => { asked = e.detail?.id }
    window.addEventListener('pf:connect-to', hear)
    try { applyGapFix(fix, 'a') } finally { window.removeEventListener('pf:connect-to', hear) }
    assert.eq(asked, 'a')
    closeMenus()
    reset()
  })
})

// ── Attention and the Brief count the same way ───────────────
describe('qa4: Attention and the Brief say the open items in one order, with one set of nouns', () => {
  const iso = { kind: 'canvas', finding: 'isolated', id: 'b0', ids: Array.from({ length: 12 }, (_, i) => 'b' + i), title: 'Not connected yet', detail: '' }
  const items = [
    { kind: 'question' }, iso, { kind: 'assumption' },
    { kind: 'canvas', finding: 'cycle' }, { kind: 'canvas', finding: 'untyped' }, { kind: 'canvas', finding: 'type-check' },
  ]

  it('the readiness line and the Attention summary are the same sentence', () => {
    const r = readiness({ items, accepted: [] })
    assert.eq(r.text, '6 open items: 1 item for the 12 blocks not connected yet, 1 unanswered question, 1 unverified assumption, 3 canvas checks.')
    assert.eq(r.text, `6 open items: ${attentionBreakdown(items)}.`)
    assert.deepEq(openItemParts(items), r.parts)
  })

  it('the isolation row is not counted as a canvas check: its meta says what it is', () => {
    const html = attentionRowsHtml([iso, { ...items[3], id: 'b1', ids: ['b1'] }])
    const doc = parse(`<ul>${html}</ul>`)
    const kinds = [...doc.querySelectorAll('.attention-kind')].map(k => k.textContent)
    assert.eq(kinds[0], 'Connections · 12 blocks, opens the first')
    assert.ok(kinds[1].startsWith('Canvas checks'), kinds[1])
  })
})

// ── The hover fade belongs to a card that is there ───────────
describe('qa4: the hover fade', () => {
  it('goes with the hovered card when it is deleted', () => {
    reset()
    block('a'); block('b', { x: 400 })
    const root = $.canvasRoot()
    ui.hoveredBlockId = 'a'
    root.classList.add('has-hover')
    document.getElementById('b-b').classList.add('related')
    deleteBlock('a')
    assert.ok(!root.classList.contains('has-hover'), 'no fade with nothing hovered')
    assert.eq(root.querySelectorAll('.related').length, 0)
    assert.eq(ui.hoveredBlockId, null)
    document.querySelectorAll('.toast-notification').forEach(t => t.remove())
    reset()
  })

  it('never fades a selected card', async () => {
    const { root, done } = await shadow('<div class="canvas-root has-hover" data-pointer="mouse"><div class="block selected"></div><div class="block"></div></div>')
    try {
      const [sel, plain] = root.querySelectorAll('.block')
      assert.eq(getComputedStyle(plain).opacity, '0.6')
      assert.eq(getComputedStyle(sel).opacity, '1')
    } finally { done() }
  })
})

// ── The palette is one Tab stop ──────────────────────────────
describe('qa4: reaching the map from the keyboard', () => {
  it('the palette holds one Tab stop, which follows focus', () => {
    const pal = document.createElement('div')
    pal.style.cssText = ONSCREEN
    pal.innerHTML = '<button>Show</button><button>Templates</button><button>Blocks</button>' +
      Array.from({ length: 16 }, (_, i) => `<button class="palette-item">T${i}</button>`).join('')
    document.body.appendChild(pal)
    try {
      rovePalette(pal)
      const stops = paletteStops(pal)
      assert.eq(stops.length, 19, 'the arrow keys still reach every control')
      assert.eq(stops.filter(b => b.tabIndex === 0).length, 1, 'one Tab stop')
      rovePalette(pal, stops[5])
      assert.eq(stops[5].tabIndex, 0)
      assert.eq(stops.filter(b => b.tabIndex === 0).length, 1)
    } finally { pal.remove() }
  })

  it('the skip link goes to the map', async () => {
    const doc = parse(await fetchText('../index.html'))
    const skip = doc.querySelector('.skip-link')
    assert.eq(skip.getAttribute('href'), '#canvasViewport')
    assert.eq(skip.textContent.trim(), 'Skip to the map')
    assert.ok(doc.getElementById('canvasViewport'))
  })
})

// ── Templates merged into a map ──────────────────────────────
describe('qa4: a template merged into a map lands beside it, and says how to take it back', () => {
  const rectOf = id => ({ x: state.blocks[id].x, y: state.blocks[id].y, ...blockSize(id) })
  const clear = (a, b) => a.x + a.w + CARD_GAP <= b.x || b.x + b.w + CARD_GAP <= a.x || a.y + a.h + CARD_GAP <= b.y || b.y + b.h + CARD_GAP <= a.y

  it('a small one keeps clear of every card, with Undo on its toast', () => {
    reset()
    setupTemplates()
    block('seed', { title: 'Token exchange endpoint', type: 'implementation', x: -110, y: -40 })
    const i = TEMPLATES.findIndex(t => !t.large)
    $.templatesList().querySelector(`.template-item[data-tpl="${i}"]`).click()
    const added = Object.keys(state.blocks).filter(id => id !== 'seed')
    assert.gt(added.length, 1)
    added.forEach(id => assert.ok(clear(rectOf(id), rectOf('seed')), `${state.blocks[id].title} is clear of the seed`))
    const toast = document.querySelector('.toast-notification')
    assert.ok(toast && /beside your map/.test(toast.textContent), toast?.textContent)
    assert.eq(toast.querySelector('.toast-action')?.textContent, 'Undo')
    toast.querySelector('.toast-action').click()
    assert.deepEq(Object.keys(state.blocks), ['seed'], 'Undo takes the template back')
    reset()
  })

  it('a large one is arranged alone: the person\'s own cards do not move', () => {
    reset()
    setupTemplates()
    block('s1', { x: 0, y: 0 }); block('s2', { x: 300, y: 0, type: 'requirement' })
    state.arrows.push({ id: 'k', from: 's1', to: 's2', style: 'routed' })
    const before = JSON.stringify([state.blocks.s1, state.blocks.s2].map(b => [b.x, b.y]))
    const i = TEMPLATES.findIndex(t => t.large)
    $.templatesList().querySelector(`.template-item[data-tpl="${i}"]`).click()
    assert.eq(JSON.stringify([state.blocks.s1, state.blocks.s2].map(b => [b.x, b.y])), before, 'your layout is kept')
    const added = Object.keys(state.blocks).filter(id => !['s1', 's2'].includes(id))
    added.forEach(id => ['s1', 's2'].forEach(s => assert.ok(clear(rectOf(id), rectOf(s)), `${state.blocks[id].title} is clear of ${s}`)))
    assert.eq(getUndoHistory().length, 1, 'one click, one undo step')
    undo()
    assert.deepEq(Object.keys(state.blocks).sort(), ['s1', 's2'])
    reset()
  })
})

// ── The arrival keeps cards out from under Find blocks ───────
describe('qa4: an arrival keeps cards out from under the floating controls', () => {
  it('moves down until no card is under the control, the entry still on screen', () => {
    reset()
    // A flow wider and taller than the view, so the arrival is at 100% on its start.
    const W = 900, H = 600
    block('t', { type: 'terminator', title: 'Start', x: 0, y: 400 })
    for (let i = 0; i < 8; i++) block('p' + i, { type: 'process', title: 'Step ' + i, x: 300 + i * 300, y: (i % 2) * 520 })
    state.arrows = [{ id: 'x0', from: 't', to: 'p0' }, ...Array.from({ length: 7 }, (_, i) => ({ id: 'x' + (i + 1), from: 'p' + i, to: 'p' + (i + 1) }))]
    const ids = Object.keys(state.blocks)
    const plain = arrivalView(ids, { w: W, h: H })
    assert.ok(plain && !plain.whole)
    // A control over whichever card sits highest on screen.
    const onScreen = ids.map(id => {
      const b = state.blocks[id], s = blockSize(id)
      return { id, x1: b.x + plain.panX, y1: b.y + plain.panY, x2: b.x + s.w + plain.panX, y2: b.y + s.h + plain.panY }
    }).filter(r => r.x2 > 0 && r.x1 < W && r.y2 > 0 && r.y1 < H).sort((a, b) => a.y1 - b.y1)
    const top = onScreen[0]
    const avoid = [{ x1: top.x1, y1: Math.max(0, top.y1) - 8, x2: top.x1 + 60, y2: Math.max(0, top.y1) + 20 }]
    const v = arrivalView(ids, { w: W, h: H }, { avoid })
    ids.forEach(id => {
      const b = state.blocks[id], s = blockSize(id)
      const r = { x1: b.x + v.panX, y1: b.y + v.panY, x2: b.x + s.w + v.panX, y2: b.y + s.h + v.panY }
      const o = avoid[0]
      assert.ok(!(r.x1 < o.x2 && r.x2 > o.x1 && r.y1 < o.y2 && r.y2 > o.y1), `${id} is not under the control`)
    })
    const e = state.blocks.t, es = blockSize('t')
    assert.ok(e.y + es.h + v.panY <= H, 'the entry still shows whole')
    reset()
  })
})

// ── A dump fits the view at the arrival's zoom ───────────────
describe('qa4: pasted notes land in columns the view shows at 100%', () => {
  it('twelve notes on a 920px canvas never go wider than the view', () => {
    const types = ['goal', 'goal', 'stakeholder', 'metric', 'requirement', 'requirement', 'output', 'implementation', 'process', 'decision', 'risk', 'question']
    const nodes = types.map((type, i) => ({ id: 'n' + i, type, w: 220, h: 100 }))
    const l = layoutDump(nodes, 920, 651)
    assert.ok(l.width <= 920 - 2 * ARRIVAL_PAD, `${l.width}px wide`)
  })
})

// ── Toasts keep clear of controls in use, and stay long enough to read ─
describe('qa4: toasts', () => {
  it('sit above the review bar instead of over its Add note', () => {
    reset()
    const bar = document.createElement('div')
    bar.className = 'canvas-statusbar'
    bar.style.cssText = 'position:fixed;left:300px;top:700px;width:800px;height:44px'
    const review = document.createElement('div')
    review.id = 'reviewBar'
    review.style.cssText = 'position:fixed;left:320px;top:630px;width:760px;height:44px'
    document.body.append(bar, review)
    try {
      showToast('Checkout 500s: investigation opened. Fit shows all of it.', 'success', 50)
      const t = document.querySelector('.toast-notification').getBoundingClientRect()
      assert.ok(t.bottom <= 630 - 8, `the toast ends at ${Math.round(t.bottom)}, above the bar at 630`)
    } finally { bar.remove(); review.remove(); document.querySelectorAll('.toast-notification').forEach(t => t.remove()) }
  })

  it('last about 2s plus 60ms a word, never less than asked, and a dismissed one stays', () => {
    assert.eq(toastDuration('Link copied.', 1500), 2120)
    assert.eq(toastDuration('a '.repeat(40), 3000), 4400)
    assert.eq(toastDuration('Short', 6000), 6000)
    assert.eq(toastDuration('x', 2 ** 31 - 1), 2 ** 31 - 1)
  })

  it('a copy that fails shows the text to copy by hand, selected, until dismissed', () => {
    reset()
    showCopyFallback('https://example.test/#z=abc', 'the link')
    const t = document.querySelector('.toast-notification')
    try {
      assert.includes(t.textContent, '⌘/Ctrl+C')
      const f = t.querySelector('textarea.toast-field')
      assert.ok(f && f.readOnly)
      assert.eq(f.value, 'https://example.test/#z=abc')
      assert.eq(t.querySelector('.toast-action')?.textContent, 'Dismiss')
    } finally { t?.remove() }
  })

  it('end in a full stop and never cheer', async () => {
    assert.eq(importMessage(3, { blocks: 0, arrows: 0, groups: 0 }), 'Imported 3 blocks.')
    assert.eq(importMessage(3, { blocks: 0, arrows: 0, groups: 0 }, 'new', { reused: true }), 'Imported 3 blocks.')
    const src = await fetchText('../js/ui-panels.js')
    assert.ok(!/copied!/.test(src), 'no exclamation marks on the share toasts')
  })
})

// ── A word wider than its pill line ──────────────────────────
describe('qa4: the pill band keeps a long word whole', () => {
  const measure = s => s.length * 6
  it('"Reconciliation report" at 44%: the word takes the dot\'s room before any cut', () => {
    const m = FACE_METRICS.pill
    const spec = { layout: 'row', width: 76.8, lines: 2 }
    const fit = fitFaceTitle('Reconciliation report', spec, m, measure)
    assert.deepEq(fit.lines, ['Reconciliation', 'report'])
    assert.eq(fit.cut, false)
    assert.eq(fit.dot, false, 'the face goes without its dot')
    fit.lines.forEach(l => assert.ok(measure(l) <= spec.width + m.dot + m.dotGap + m.hang, l))
  })
  it('a title that fits keeps its dot, and a column face is never changed', () => {
    const m = FACE_METRICS.pill
    assert.eq(fitFaceTitle('Ship it', { layout: 'row', width: 76.8, lines: 2 }, m, measure).dot, true)
    assert.eq(fitFaceTitle('Reconciliation report', { layout: 'col', width: 76.8, lines: 2 }, FACE_METRICS.title, measure).dot, true)
  })
})

// ── Words in the hand-off ────────────────────────────────────
describe('qa4: the hand-off reads as written by someone careful', () => {
  it('the patch preview says each kind once', () => {
    const rows = [
      ['answer', 'Answer "Does it happen on staging?" and mark it done', '"Does it happen on staging?", then mark it done'],
      ['answer', 'Replace the answer on "When did it start?"', 'replaces the one on "When did it start?"'],
      ['arrow', 'Connect "Move sign-in" → "Token exchange"', '"Move sign-in" → "Token exchange"'],
      ['status', 'Status of "Token exchange" → done', 'of "Token exchange" → done'],
      ['note', 'Note on "Token exchange"', 'on "Token exchange"'],
    ]
    rows.forEach(([kind, label, words]) => {
      assert.eq(patchRowWords(kind, label), words)
      const [first, second] = `${patchKindWord(kind)} ${patchRowWords(kind, label)}`.split(' ')
      assert.ok(!second.toLowerCase().startsWith(first.toLowerCase().slice(0, 5)), `${first} ${second}`)
    })
  })

  it('one assumption is "it", not "several of them"', () => {
    reset()
    const sit = canvasMeta.situation
    canvasMeta.situation = { ...sit, codebase: 'current', runtime: 'code' }
    try {
      block('a', { type: 'assumption', title: 'Old tokens can be read' })
      ui.promptDirty = true
      const brief = generatePrompt()
      assert.includes(brief, 'It may be settleable from the repository you have open.')
      assert.notIncludes(brief, 'Several of them')
    } finally { canvasMeta.situation = sit; reset() }
  })

  it('a problem is addressed by its answer, never before it in the checklist', () => {
    const blocks = {
      p: { id: 'p', type: 'problem', title: 'Old session tokens cannot be read' },
      i: { id: 'i', type: 'implementation', title: 'Token exchange', criteria: ['works'] },
    }
    const arrows = [{ id: 'a', from: 'p', to: 'i' }]
    assert.eq(relationOf(arrows[0], blocks), 'informs')
    const list = taskChecklist(blocks, arrows)
    assert.includes(list, 'addresses: Old session tokens cannot be read (p)')
    assert.notIncludes(list, 'after: Old session tokens')
  })
})

// ── Connecting from the keyboard ─────────────────────────────
describe('qa4: Connect to is one key away, and says what it recorded', () => {
  it('C is listed, and Connect to opens on its search', () => {
    assert.ok(SHORTCUTS.some(g => g.keys.some(k => k[0] === 'C')), 'C is in the shortcut sheet')
    reset()
    block('a', { title: 'Session store fills up', type: 'risk' })
    block('b', { title: 'Write sessions to both stores', type: 'implementation', x: 400 })
    const m = openConnectToMenu('a')
    try {
      assert.ok(m && isMenuOpen())
      assert.ok(m.el.querySelector('.pf-menu-search-input'), 'the search box is there')
    } finally { closeMenus() }
    reset()
  })

  it('the toast says the connection as the brief reads it, and Reverse turns it round', () => {
    reset()
    block('r', { title: 'Session store fills up', type: 'risk' })
    block('w', { title: 'Write sessions to both stores', type: 'implementation', x: 400 })
    state.arrows.push({ id: 'k', from: 'r', to: 'w', style: 'routed' })
    sayConnected('k')
    const t = document.querySelector('.toast-notification')
    try {
      assert.includes(t.textContent, '"Session store fills up" is mitigated by "Write sessions to both stores".')
      assert.eq(t.querySelector('.toast-action').textContent, 'Reverse')
      t.querySelector('.toast-action').click()
      assert.eq(state.arrows[0].from, 'w')
      assert.eq(state.arrows[0].to, 'r')
      assert.ok(!reverseConnection('nope'))
    } finally { document.querySelectorAll('.toast-notification').forEach(x => x.remove()) }
    reset()
  })
})

// ── A new card waits for its title ───────────────────────────
describe('qa4: a card being titled for the first time wears no gap yet', () => {
  it('the ring and the badge wait until the title is in', () => {
    reset()
    block('n', { title: '' })
    runGapDetection()
    const el = () => document.getElementById('b-n')
    assert.ok(el().classList.contains('gap-isolated'), 'an untitled lone card is a gap at rest')
    assert.ok(startInlineEdit('n', 'title'))
    assert.ok(!el().classList.contains('gap-isolated'), 'no ring while its first title is typed')
    commitInlineEdit()
    assert.ok(el().classList.contains('gap-isolated'), 'the marker is back once the title is in')
    // A card just made carries a placeholder title ("Untitled 1"): fresh.
    block('u', { title: 'Untitled 1', x: 600 })
    runGapDetection()
    assert.ok(startInlineEdit('u', 'title', { fresh: true }))
    assert.ok(!document.getElementById('b-u').classList.contains('gap-isolated'))
    commitInlineEdit()
    assert.ok(document.getElementById('b-u').classList.contains('gap-isolated'))
    reset()
  })
})

// ── The sample takes a blank map's place ─────────────────────
describe('qa4: opening the sample on a first visit leaves no empty map behind', () => {
  async function sandbox(fn) {
    const before = JSON.parse(JSON.stringify(serializeCanvas()))
    const saved = new Map()
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('pathfinder-')) saved.set(k, localStorage.getItem(k))
    }
    const camera = { ...view }
    try { await fn() } finally {
      Object.assign(state, { blocks: before.blocks, arrows: before.arrows, groups: before.groups })
      Object.assign(canvasMeta, before.meta)
      delete canvasMeta.prompt
      applyPromptOpts(before.meta.prompt)
      Object.assign(view, camera)
      getUndoHistory().length = 0; getRedoFuture().length = 0
      const now = []
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('pathfinder-')) now.push(k) }
      now.forEach(k => { if (!saved.has(k)) localStorage.removeItem(k) })
      saved.forEach((v, k) => localStorage.setItem(k, v))
      document.querySelectorAll('.toast-notification').forEach(t => t.remove())
    }
  }
  const wipe = () => {
    const kill = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k === 'pathfinder-maps' || k.startsWith('pathfinder-map-') || k.startsWith('pathfinder-snaps-') || k.startsWith('pathfinder-view'))) kill.push(k)
    }
    kill.forEach(k => localStorage.removeItem(k))
  }
  const index = () => JSON.parse(localStorage.getItem('pathfinder-maps') || '[]')

  it('a blank map gives the sample its slot; a map with work stays under Maps', () => sandbox(async () => {
    wipe()
    state.blocks = {}; state.arrows = []; state.groups = {}
    canvasMeta.title = ''; canvasMeta.contextBrief = ''
    ensureLibrary()
    const id = currentId()
    assert.ok(isBlankMap())
    const r = openSampleMap()
    assert.ok(r && r.reused, 'it took the blank map\'s place')
    assert.eq(currentId(), id)
    assert.deepEq(index().map(e => e.name), [SAMPLE_TITLE], 'no "Untitled map" left beside it')
    assert.eq(SAMPLE_OPENED, `${SAMPLE_TITLE} opened.`)
    // With work on the map, the sample opens beside it.
    assert.ok(!isBlankMap())
    const r2 = openSampleMap()
    assert.ok(r2 && !r2.reused)
    assert.eq(index().length, 2)
  }))
})

// ── Doc pages: the example pictures load, the prose holds its measure ─
describe('qa4: the doc pages in every engine', () => {
  it('each example detail is sized like its whole picture, so a lazy load starts (Firefox)', async () => {
    const doc = parse(await fetchText('../examples.html'))
    const details = [...doc.querySelectorAll('.ex-detail img')]
    assert.eq(details.length, 8)
    details.forEach(img => {
      const slug = img.dataset.detailPic
      const whole = doc.querySelector(`img[data-pic="${slug}"]`)
      assert.ok(whole, slug)
      assert.eq(img.getAttribute('width'), whole.getAttribute('width'), `${slug}: width`)
      assert.eq(img.getAttribute('height'), whole.getAttribute('height'), `${slug}: height`)
    })
  })

  it('the walkthrough strip is centred by its margin, never a transform (Firefox scrolled sideways)', async () => {
    const css = await fetchText('../css/style.css')
    const rule = css.slice(css.indexOf('.doc-strip {', css.indexOf('@media (min-width: 1000px)')))
    const body = rule.slice(0, rule.indexOf('}'))
    assert.ok(!/transform:\s*translateX/.test(body), body)
    assert.match(body, /margin-left: calc\(50% - min\(560px, 50vw - 32px\)\)/)
  })

  it('prose holds about 70 characters a line, not 90', async () => {
    const css = await fetchText('../css/style.css')
    assert.match(css, /\.doc p, \.doc li \{ max-width: 31em; \}/)
    assert.ok(!/\.doc p, \.doc li \{ max-width: 68ch/.test(css))
  })
})
