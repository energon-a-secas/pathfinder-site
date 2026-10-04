// ============================================================
//  qa3.test.js -- regression tests for the design round's third QA
//  (critique, detector, personas and cross-browser lenses, 2026-10-04)
// ============================================================

import { describe, it, assert, cleanupMockEls, mockBlockEl } from './test-utils.js'
import { state, ui, view, selection, getUndoHistory, getRedoFuture, resetSnapshotToken } from '../js/state.js'
import { $, DEFAULT_WIDTH, CARD_STYLES, drawnCardStyle } from '../js/utils.js'
import { renderBlock, deselectAll, deleteBlock, deleteBlocksBatch } from '../js/render.js'
import { cardStyleItems } from '../js/view-menu.js'
import { normalizeBlock } from '../js/normalize.js'
import { isInlineEditing, commitInlineEdit } from '../js/inline-edit.js'
import { openMenu, closeMenus, matchTier } from '../js/menu.js'
import { connectToItems, connectHint } from '../js/context-menu.js'
import { createConnected, defaultConnectDirection, nearestFreeSpot } from '../js/create.js'
import { detectGaps } from '../js/gaps.js'
import { attentionModel, attentionRowsHtml, attentionBreakdown } from '../js/attention.js'
import { createBlocksFromText } from '../js/classify.js'
import { extractPatch, buildPlan, applyPlan } from '../js/patch.js'
import { DEFAULT_ARROW_WEIGHT } from '../js/utils.js'
import { clampIntoView } from '../js/type-keys.js'
import { placeLabels, wrapNote, NOTE_LINE, NOTE_GAP, LABEL_H } from '../js/arrow-labels.js'
import { setupKeyboardShortcuts, setupTabNavigation } from '../js/events.js'
import { setupPanelTabs, showPanelTab, PANEL_TABS, SHORTCUTS, canEditACopy, editCopyUrl, sayViewOnly, templateTitle } from '../js/ui-panels.js'
import { commandGroups, jumpToBlock, matchScore, rowMatch } from '../js/command-items.js'

function reset() {
  closeMenus()
  if (isInlineEditing()) commitInlineEdit()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
  selection.ids.clear(); selection.blockId = null; selection.arrowId = null
  view.panX = 0; view.panY = 0; view.zoom = 1
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '',
    x: 40, y: 40, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, highlight: null, ...extra }
  renderBlock(id)
}

const type = (input, text) => {
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

// ── Connect to: the row Enter picks is the best answer ───────
describe('qa3: Connect to ranks a title that starts with the query first', () => {
  it('matchTier: the label start, then a word start, then anywhere', () => {
    assert.eq(matchTier('Login success rate', 'log'), 0)
    assert.eq(matchTier('Move sign-in without logouts', 'log'), 1)
    assert.eq(matchTier('Catalogue sync', 'log'), 2)
    assert.eq(matchTier('Token refresh', 'log'), 3)
  })

  it('"log" marks "Login success rate" over an earlier row with "logouts", and the rows reorder', () => {
    reset()
    block('team', { type: 'stakeholder', title: 'Mobile app team' })
    block('g', { type: 'goal', title: 'Move sign-in to the new service without logouts', x: 300 })
    block('m', { type: 'metric', title: 'Login success rate', x: 600 })
    block('t', { type: 'implementation', title: 'Token refresh endpoint', x: 900 })
    block('s', { type: 'risk', title: 'The token service drops sessions', x: 1200 })
    const m = openMenu(connectToItems('team'), { x: 10, y: 10 })
    try {
      const input = m.el.querySelector('.pf-menu-search-input')
      const visible = () => [...m.el.querySelectorAll('.pf-menu-item')].filter(r => !r.hidden).map(r => r._pfItem.label)
      const before = visible()
      type(input, 'log')
      assert.eq(m.el.querySelector('.pf-menu-match')?._pfItem.label, 'Login success rate')
      assert.eq(visible()[0], 'Login success rate', 'the best answer is the first row')
      assert.eq(m.el.querySelector('.pf-menu-match .pf-menu-hit')?.textContent, 'Log', 'the matched letters are bold')
      type(input, 'tok')
      assert.eq(m.el.querySelector('.pf-menu-match')?._pfItem.label, 'Token refresh endpoint')
      type(input, '')
      assert.deepEq(visible(), before, 'cleared, every row is back in its place')
      assert.ok(!m.el.querySelector('.pf-menu-hit'), 'and nothing is bold')
    } finally { closeMenus() }
  })
})

// ── A risk added from a block is not its mitigation ──────────
describe('qa3: a new risk hangs off the block it came from', () => {
  it('requirement -> risk, and the risk reports that nothing mitigates it', () => {
    reset()
    block('r', { type: 'requirement', title: 'Admins can invite a whole team at once', criteria: ['x'] })
    const id = createConnected('r', 'risk', { incoming: 'auto', edit: false })
    assert.eq(state.arrows[0].from, 'r')
    assert.eq(state.arrows[0].to, id)
    const gaps = detectGaps(state.blocks, state.arrows)
    assert.ok(gaps.details.some(d => d.id === id && d.gaps.includes('gap-no-mitigation')), 'the risk shows as unmitigated')
    assert.eq(defaultConnectDirection('implementation', 'risk'), 'out')
  })

  it('the Connect to hint reads as a sentence, and says when a pair adds no order', () => {
    reset()
    block('k', { type: 'risk', title: 'Invites land in spam' })
    block('d', { type: 'decision', title: 'Send from our own domain', x: 300 })
    block('p', { type: 'stakeholder', title: 'Workspace admins', x: 600 })
    block('m', { type: 'metric', title: 'Invite acceptance', x: 900 })
    block('o', { type: 'output', title: 'Invite email', x: 1200 })
    assert.eq(connectHint('k', 'd'), 'Decision: this is mitigated by it')
    assert.eq(connectHint('d', 'k'), 'Risk: related, no task order')
    assert.notIncludes(connectHint('p', 'm'), 'comes before', 'a stakeholder and a metric add no task order')
    assert.eq(connectHint('p', 'o'), 'Output: it is delivered to this')
  })
})

// ── The Brief tab rewrites itself after a dump ───────────────
describe('qa3: a brain dump refreshes an open Brief tab', () => {
  it('with the Brief tab active the brief is written at once', () => {
    reset()
    const tab = ui.activeTab
    ui.activeTab = 'prompt'
    ui.promptDirty = false
    try {
      const ids = createBlocksFromText('Goal: Teams set up a shared workspace\nRisk: Invites land in spam')
      assert.eq(ids.length, 2)
      assert.eq(ui.promptDirty, false, 'refreshPrompt ran, so nothing is left dirty')
    } finally { ui.activeTab = tab; reset() }
  })
})

// ── N then a letter near the edge lands inside the view ──────
describe('qa3: type keys never create a card half out of view', () => {
  it('clampIntoView moves a point near an edge in until a default card fits', () => {
    reset()
    const vp = $.canvasViewport()
    const prev = vp.style.cssText
    vp.style.cssText = 'display:block;position:relative;width:800px;height:600px;overflow:hidden'
    try {
    const W = vp.clientWidth, H = vp.clientHeight
    assert.eq(W, 800)
    const p = clampIntoView({ x: 4, y: 4 })
    assert.ok(p.x - DEFAULT_WIDTH / 2 >= 16 - 1e-6, `left edge ${p.x - DEFAULT_WIDTH / 2}`)
    assert.ok(p.y - 50 >= 16 - 1e-6, `top edge ${p.y - 50}`)
    const q = clampIntoView({ x: W - 2, y: H - 2 })
    assert.ok(q.x + DEFAULT_WIDTH / 2 <= W - 16 + 1e-6, 'right edge')
    assert.ok(q.y + 50 <= H - 16 + 1e-6, 'bottom edge')
    const mid = { x: W / 2, y: H / 2 }
    assert.deepEq(clampIntoView(mid), mid, 'a point well inside stays put')
    view.zoom = 0.5
    const z = clampIntoView({ x: 1, y: 1 })
    assert.ok(z.x - DEFAULT_WIDTH / 2 >= 32 - 1e-6, 'in world units at 50%: 16 screen px is 32')
    } finally { vp.style.cssText = prev; view.zoom = 1 }
  })
})

// ── The keyboard reaches the Brief and Attention ─────────────
function panelTabsMock() {
  const wrap = document.createElement('div')
  wrap.className = 'mock-el panel-tabs'
  wrap.innerHTML = '<div class="panel-tablist">' +
    '<button class="panel-tab active" data-tab="inspector">Inspector</button>' +
    '<button class="panel-tab" data-tab="prompt">Brief</button>' +
    '<button class="panel-tab" data-tab="attention">Attention</button></div>' +
    '<div class="tab-pane active" id="inspectorPane"></div><div class="tab-pane" id="promptPane"></div>' +
    '<div class="tab-pane" id="attentionPane"></div>'
  document.body.appendChild(wrap)
  return wrap
}

describe('qa3: Alt+1, 2, 3 and the palette show a panel tab', () => {
  it('Alt+2 shows the Brief with the keyboard on its tab; the palette lists all three', () => {
    reset()
    const tab = ui.activeTab
    const mock = panelTabsMock()
    try {
      ui.activeTab = 'inspector'
      setupPanelTabs()
      setupKeyboardShortcuts()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '™', code: 'Digit2', altKey: true, bubbles: true, cancelable: true }))
      assert.eq(ui.activeTab, 'prompt')
      assert.eq(document.activeElement?.dataset?.tab, 'prompt', 'focus is on the Brief tab')
      assert.ok(document.getElementById('promptPane').classList.contains('active'))
      assert.ok(showPanelTab('attention'))
      assert.eq(ui.activeTab, 'attention')
      const actions = commandGroups().find(g => g.key === 'actions').items
      for (const t of PANEL_TABS) {
        const row = actions.find(r => r.id === 'panel:' + t.tab)
        assert.ok(row, t.label)
        assert.match(row.shortcut, new RegExp(t.key + '$'))
      }
      const keys = SHORTCUTS.flatMap(g => g.keys.map(k => k[0]))
      assert.ok(keys.includes('Alt + 1 / 2 / 3'), 'listed in the shortcut sheet')
    } finally {
      mock.remove(); ui.activeTab = tab
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
    }
  })

  it('the Tab after Escape let go of the canvas leaves it, instead of re-entering at the first block', () => {
    reset()
    setupKeyboardShortcuts(); setupTabNavigation()
    const after = document.createElement('button')
    after.className = 'mock-el'; after.textContent = 'after the canvas'
    document.body.appendChild(after)
    const vp = $.canvasViewport(), prev = vp.style.cssText
    vp.style.cssText = 'display:block;position:relative;width:800px;height:600px;overflow:hidden'
    try {
      block('a'); block('b', { x: 400 })
      const el = document.getElementById('b-a')
      el.focus()
      assert.eq(document.activeElement, el)
      const esc = () => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      esc()
      assert.ok(document.activeElement === document.body || !document.activeElement, 'Escape let go of the canvas')
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      document.body.dispatchEvent(tab)
      assert.ok(tab.defaultPrevented, 'the app moved focus itself')
      assert.ok(!$.canvasRoot().contains(document.activeElement), 'and not into a card')
    } finally { vp.style.cssText = prev; after.remove(); reset() }
  })
})

// ── Cmd+K jump: the camera stays when the card is in view ────
describe('qa3: jumping to a block on screen does not move the camera', () => {
  it('in view at full detail: selected, camera still; off screen: panned at the same zoom', () => {
    reset()
    const vp = $.canvasViewport(), prev = vp.style.cssText
    vp.style.cssText = 'display:block;position:relative;width:800px;height:600px;overflow:hidden'
    try {
      view.panX = 0; view.panY = 0; view.zoom = 0.95
      block('a', { x: 100, y: 100 }); block('far', { x: 4000, y: 100 })
      jumpToBlock('a')
      assert.deepEq([view.panX, view.panY, view.zoom], [0, 0, 0.95], 'nothing moved')
      assert.eq(selection.blockId, 'a')
      jumpToBlock('far')
      assert.eq(view.zoom, 0.95, 'the zoom is kept')
      assert.eq(selection.blockId, 'far')
    } finally { vp.style.cssText = prev; reset() }
  })
})

// ── A view-only link is not a dead end ───────────────────────
describe('qa3: view-only links offer Edit a copy, and say why an edit does nothing', () => {
  it('Edit a copy shows only on a view-only link that carries a map, and drops only ?readonly', () => {
    const ro = ui.readOnly, em = ui.embed
    try {
      ui.readOnly = true; ui.embed = false
      assert.ok(canEditACopy({ search: '?readonly&via=share', hash: '#z=abc' }))
      assert.ok(canEditACopy({ search: '?readonly&src=https://example.org/m.json', hash: '' }))
      assert.ok(!canEditACopy({ search: '?readonly', hash: '' }), 'no map in the link: nothing to copy')
      ui.embed = true
      assert.ok(!canEditACopy({ search: '?embed&readonly', hash: '#z=abc' }), 'never in an embed')
      ui.readOnly = false; ui.embed = false
      assert.ok(!canEditACopy({ search: '', hash: '#z=abc' }), 'an editable page needs no copy')
      assert.eq(editCopyUrl('https://pathfinder.example/index.html?readonly&via=share#z=abc'),
        'https://pathfinder.example/index.html?via=share#z=abc')
    } finally { ui.readOnly = ro; ui.embed = em }
  })

  it('an edit on a view-only page says so, once every few seconds, never in an embed', () => {
    const ro = ui.readOnly, em = ui.embed
    try {
      ui.readOnly = false
      assert.eq(sayViewOnly(), false, 'an editable page says nothing')
      ui.readOnly = true; ui.embed = true
      assert.eq(sayViewOnly(), false, 'an embed says nothing')
      ui.embed = false
      const first = sayViewOnly()
      assert.eq(sayViewOnly(), false, 'not twice in a row')
      assert.ok(first === true || first === false)
    } finally { ui.readOnly = ro; ui.embed = em }
  })

  it('the review bar placeholder fits the bar', async () => {
    const doc = new DOMParser().parseFromString(await (await fetch('../index.html')).text(), 'text/html')
    const ph = doc.getElementById('reviewInput').getAttribute('placeholder')
    assert.ok(ph.length <= 28, ph)
  })
})

// ── A connection's note stays off the cards ──────────────────
describe('qa3: a label is placed with its note, so the note never runs under a card', () => {
  it('a three-line note under a label whose anchor sits just above a card moves with its label', () => {
    reset()
    const card = (id, x, y) => {
      state.blocks[id] = { id, type: 'process', title: id, description: '', notes: '', x, y, actions: [], questions: [],
        docRef: null, width: 220, color: null, collapsed: false, groupId: null, status: null, priority: null }
      mockBlockEl(id, { width: 220, height: 62 })
    }
    card('p', 0, 0); card('q', 600, 0); card('c', 330, 60)
    const note = 'The certificate rotation is the one nobody wrote down. Check it before the deploy.'
    state.arrows = [{ id: 'x', from: 'p', to: 'q', style: 'routed', pattern: 'solid', label: 'context for', note }]
    const routes = new Map([['x', { x1: 220, y1: 31, d1: 'right', x2: 600, y2: 31, d2: 'left',
      points: [{ x: 220, y: 31 }, { x: 600, y: 31 }] }]])
    try {
      const lines = wrapNote(note)
      assert.eq(lines.length, 3)
      const lp = placeLabels(routes).get('x')
      const top = lp.y - LABEL_H / 2, bottom = lp.y + LABEL_H / 2 + NOTE_GAP + lines.length * NOTE_LINE
      const left = lp.x - 90, right = lp.x + 90
      for (const id of ['p', 'q', 'c']) {
        const b = state.blocks[id]
        const overlap = left < b.x + 220 && b.x < right && top < b.y + 62 && b.y < bottom
        assert.ok(!overlap, `the label and its note clear ${id} (${lp.x}, ${lp.y})`)
      }
    } finally { cleanupMockEls(); reset() }
  })
})

// ── Attention: the ringed card is a ringed row ───────────────
describe('qa3: Attention marks every row whose card wears the gap ring, and says what it counts', () => {
  it('a requirement with no criteria is ringed on the map and in the list', () => {
    const blocks = {
      g: { id: 'g', type: 'goal', title: 'Find the cause', x: 0, y: 0 },
      r: { id: 'r', type: 'requirement', title: 'A test that fails before the fix', x: 300, y: 0, criteria: [] },
      q: { id: 'q', type: 'question', title: 'Does it happen on staging?', x: 600, y: 0 },
    }
    const arrows = [{ id: 'a1', from: 'g', to: 'r' }, { id: 'a2', from: 'q', to: 'r' }]
    const ringed = detectGaps(blocks, arrows).details.map(d => d.id)
    assert.ok(ringed.includes('r'), 'the requirement wears the ring')
    const { items } = attentionModel(blocks, arrows)
    const ul = document.createElement('ul')
    ul.innerHTML = attentionRowsHtml(items)
    const rowOf = id => [...ul.children][items.findIndex(i => i.id === id && i.kind !== 'question')]
    assert.ok(rowOf('r').classList.contains('attention-gap'), 'and its row wears the amber ring')
    const qRow = [...ul.children][items.findIndex(i => i.kind === 'question')]
    assert.ok(!qRow.classList.contains('attention-gap'), 'an open question has no gap ring: nothing marks it on the map')
    const text = attentionBreakdown(items)
    assert.includes(text, '1 gap marked on the map')
    assert.includes(text, '1 unanswered question')
  })
})

// ── The accent bar (a side stripe) is retired ────────────────
describe('qa3: the accent bar card style is no longer offered, and a saved one draws as outline', () => {
  it('no menu offers it, a stored "bar" draws as outline, and the value still loads', () => {
    reset()
    assert.ok(!cardStyleItems().some(i => i.label === CARD_STYLES.bar.label), 'View > Card style does not list it')
    assert.eq(drawnCardStyle('bar'), 'outline')
    assert.eq(drawnCardStyle('tint'), 'tint')
    block('b', { cardStyle: 'bar' })
    assert.eq(document.getElementById('b-b').dataset.card, 'outline')
    assert.eq(state.blocks.b.cardStyle, 'bar', 'the stored value is kept, so it round-trips')
    assert.eq(normalizeBlock({ id: 'n', type: 'goal', title: 'n', x: 0, y: 0, cardStyle: 'bar' }).cardStyle, 'bar', 'normalize.js accepts it')
  })
})

// ── The round trip ───────────────────────────────────────────
describe('qa3: a reply with no patch says what to do; a patch draws lines like a person does', () => {
  it('a plain chat answer gets a message that names the fix', () => {
    const { error } = extractPatch('Sure! Here is my analysis of the plan. The risk is real.')
    assert.includes(error, 'no changes block')
    assert.includes(error, 'pathfinder-patch')
    assert.notIncludes(error, '```')
  })

  it('a patch connection with no style or weight is routed at the default weight; one that sets them keeps them', () => {
    reset()
    block('a', { title: 'Alpha' }); block('b', { type: 'requirement', title: 'Beta', x: 400 })
    block('c', { type: 'implementation', title: 'Gamma', x: 800 })
    const plan = buildPlan({ format: 'pathfinder-patch', version: 1, arrows: [
      { from: 'a', to: 'b' },
      { from: 'c', to: 'b', style: 'straight', weight: 3 },
    ] })
    assert.eq(applyPlan(plan), 2)
    const ab = state.arrows.find(x => x.from === 'a'), cb = state.arrows.find(x => x.from === 'c')
    assert.eq(ab.style, 'routed'); assert.eq(ab.weight, DEFAULT_ARROW_WEIGHT)
    assert.eq(cb.style, 'straight'); assert.eq(cb.weight, 3)
  })

  it('the preview keeps about 60 characters of a title', () => {
    reset()
    block('a', { title: 'Does the admin console share the session store with the API' })
    const plan = buildPlan({ format: 'pathfinder-patch', version: 1, notes: [{ block: 'a', note: 'Checked: yes' }] })
    const label = plan.ops.map(o => o.label).join(' | ')
    assert.includes(label, 'share the session store with the')
  })
})

// ── A delete says what went, and offers Undo ─────────────────
describe('qa3: deleting blocks shows a toast with Undo', () => {
  it('one block by title, several by count; Undo brings them back', () => {
    reset()
    block('a', { title: 'Checkout returns 500' }); block('b', { x: 300 }); block('c', { x: 600 })
    deleteBlock('a')
    const toast = () => document.querySelector('.toast-notification')
    assert.eq(toast()?.querySelector('.toast-msg')?.textContent, 'Deleted "Checkout returns 500".')
    toast().querySelector('.toast-action').click()
    assert.ok(state.blocks.a, 'Undo restored it')
    deleteBlocksBatch(['b', 'c'])
    assert.eq(toast()?.querySelector('.toast-msg')?.textContent, 'Deleted 2 blocks.')
    toast().querySelector('.toast-action').click()
    assert.ok(state.blocks.b && state.blocks.c)
    reset()
  })
})

// ── The command palette finds the words people type ──────────
describe('qa3: the palette matches synonyms, rejects scattered letters, and can rename the map', () => {
  it('"export png" and "export image" find Download image; "png" no longer finds Sprint Planning', () => {
    assert.ok(rowMatch('export png', 'Download image (PNG 2×)'), 'export png')
    assert.ok(rowMatch('export image', 'Download image (PNG 2×)'), 'export image')
    assert.ok(rowMatch('save svg', 'Download vector (SVG)'), 'save svg')
    assert.eq(rowMatch('png', 'Sprint Planning'), null)
    assert.ok(matchScore('rsk', 'Risk'), 'a run with one letter skipped still counts')
    assert.ok(matchScore('ct', 'Change type'), 'word starts still count')
    assert.gt(rowMatch('download', 'Download image (PNG 2×)').score, rowMatch('export', 'Download image (PNG 2×)').score,
      'the label itself ranks above a synonym')
  })

  it('Rename this map is a palette action, found by "rename" and by "title"', () => {
    reset()
    const actions = commandGroups().find(g => g.key === 'actions').items
    const row = actions.find(r => r.label === 'Rename this map')
    assert.ok(row, 'listed')
    assert.ok(rowMatch('rename', row.label) && rowMatch('title', row.label))
  })
})

describe('qa3: a free slot for a new card prefers one in view', () => {
  it('with `within`, the nearest clear slot inside the rect wins over a nearer one outside it', () => {
    // A card at the asked-for spot; the nearest clear slot is below the view.
    const rects = [{ x: 0, y: 0, w: 220, h: 100 }]
    const free = nearestFreeSpot(0, 0, 220, 100, rects)
    const within = { x1: -1000, y1: -1000, x2: 1000, y2: 60 }
    const inView = nearestFreeSpot(0, 0, 220, 100, rects, { within })
    assert.ok(inView.y + 100 <= 60 || inView.x + 220 <= within.x2, 'inside the rect')
    assert.ok(inView.y + 100 <= within.y2, `the slot is in view (${inView.x}, ${inView.y})`)
    assert.ok(free.y + 100 > within.y2 || free.x !== inView.x || free.y !== inView.y, 'unconstrained it may pick another')
  })
})

// ── A template names an empty map ───────────────────────────
describe('qa3: a template names an empty map', () => {
  it('a built-in name goes to sentence case; a saved template keeps its author spelling', () => {
    assert.eq(templateTitle('Investigate a Bug'), 'Investigate a bug')
    assert.eq(templateTitle({ name: 'Migrate a System' }), 'Migrate a system')
    assert.eq(templateTitle({ name: 'Migrate Billing to Postgres', user: true }), 'Migrate Billing to Postgres',
      'proper nouns in a saved name survive')
    assert.eq(templateTitle({ name: '  Weekly Review  ', user: true }), 'Weekly Review')
  })
})
