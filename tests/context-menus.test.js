// ============================================================
//  context-menus.test.js -- the right-click menus (js/context-menu.js):
//  block, multi-selection, connection and canvas menus, the quick-add
//  picker, keyboard opening, read-only and undo behaviour
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, selection, view, pointer, getUndoHistory, getRedoFuture, resetSnapshotToken } from '../js/state.js'
import { $, TYPES, DEFAULT_WIDTH, typesByStep } from '../js/utils.js'
import { renderBlock, undo, deselectAll, setSelection, selectBlock, selectArrow } from '../js/render.js'
import { setupContextMenu, openCanvasAddMenu, openMultiMenu, typeNoun, selectionTally,
         movePastedTo } from '../js/context-menu.js'
import { setupCanvasPointerEvents } from '../js/events.js'
import { createBlocksFromText } from '../js/classify.js'
import { runGapDetection } from '../js/gaps.js'
import { suggestedNextTypes } from '../js/create.js'
import { closeMenus, isMenuOpen } from '../js/menu.js'
import { applyTransform } from '../js/canvas.js'
import { isInlineEditing, commitInlineEdit, startInlineEdit } from '../js/inline-edit.js'

const NS = 'http://www.w3.org/2000/svg'
const history = () => getUndoHistory().length

// The runner's inspector stub is an empty #inspectorMulti, and rendering a
// multi-selection writes its count line. Give it one so selecting several
// blocks here renders the way it does in the app.
function inspectorStubs() {
  if (document.getElementById('multiCount')) return
  const span = document.createElement('span')
  span.id = 'multiCount'
  ;(document.getElementById('inspectorMulti') || document.body).appendChild(span)
}

function reset() {
  inspectorStubs()
  closeMenus()
  if (isInlineEditing()) commitInlineEdit()
  cleanupMockEls()
  document.querySelectorAll('.ctx-test-svg, .type-chip').forEach(el => el.remove())
  pointer.ix = null
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
  setupContextMenu()
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '',
    x: 40, y: 40, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, highlight: null, ...extra }
  renderBlock(id)
}

function arrow(id, from, to, extra = {}) {
  const a = { id, from, to, style: 'routed', bidirectional: false, color: null, weight: 2,
    fromPort: null, toPort: null, ...extra }
  state.arrows.push(a)
  return a
}

// The test page keeps its arrow layer outside the viewport, so build a
// connection where the app has it: inside the canvas.
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

const rclick = (el, x = 40, y = 40) => {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })
  el.dispatchEvent(ev)
  return ev
}
const blockEl = id => document.querySelector(`#b-${id} .block-title`)
const rootMenu = () => document.querySelector('.pf-menu:not(.pf-submenu)')
const lastMenu = () => { const all = document.querySelectorAll('.pf-menu'); return all[all.length - 1] }
const labelOf = row => row.querySelector('.pf-menu-label')?.textContent
const rows = menu => [...menu.children].filter(n => n.classList.contains('pf-menu-item') && !n.hidden)
const labels = menu => rows(menu).map(labelOf)
const rowByLabel = (menu, label) => rows(menu).find(r => labelOf(r) === label)

function click(label, menu = lastMenu()) {
  const row = rowByLabel(menu, label)
  assert.ok(row, `menu row "${label}" (have: ${labels(menu).join(', ')})`)
  row.click()
}
function openSub(label) {
  click(label)
  const sub = lastMenu()
  assert.ok(sub.classList.contains('pf-submenu'), `"${label}" opened a submenu`)
  return sub
}

describe('Context menus: connections', () => {
  it('right-clicking a connection opens the connection menu and selects it', () => {
    reset(); block('a'); block('b', { x: 400 }); arrow('ab', 'a', 'b')
    const ev = rclick(arrowHit('ab'))
    assert.ok(ev.defaultPrevented)
    assert.eq(selection.arrowId, 'ab')
    const m = rootMenu()
    assert.ok(m.classList.contains('ctx-arrow-menu'), 'connection menu, not the add menu')
    assert.eq(document.querySelector('.ctx-add-menu'), null)
    const l = labels(m)
    ;['Edit label', 'Meaning', 'Route', 'Pattern', 'Reverse direction', 'Two-way', 'Colour', 'Weight',
      'Insert block', 'Go to source', 'Go to target', 'Delete'].forEach(x => assert.includes(l, x))
    assert.eq(l[l.length - 1], 'Delete', 'destructive item last')
    assert.ok(!l.includes('Reset ends to auto'), 'hidden when neither end is pinned')
    closeMenus()
  })

  it('Insert block splits the connection into two, keeping its meaning, in one undo step', () => {
    reset(); block('a'); block('b', { x: 400 }); arrow('ab', 'a', 'b', { relation: 'depends-on' })
    rclick(arrowHit('ab'))
    const sub = openSub('Insert block')
    assert.eq(sub.querySelectorAll('.pf-menu-heading').length, typesByStep().filter(g => g.types.length).length, 'grouped by step')
    click('Decision', sub)
    commitInlineEdit()
    assert.eq(Object.keys(state.blocks).length, 3)
    assert.eq(state.arrows.length, 2)
    const mid = Object.values(state.blocks).find(b => b.type === 'decision')
    assert.ok(state.arrows.some(a => a.from === 'a' && a.to === mid.id && a.relation === 'depends-on'))
    assert.ok(state.arrows.some(a => a.from === mid.id && a.to === 'b' && a.relation === 'depends-on'))
    assert.eq(history(), 1)
    undo()
    assert.eq(state.arrows.length, 1)
    assert.eq(Object.keys(state.blocks).length, 2)
  })

  it('Pattern and Route write their own fields, one undo step each', () => {
    reset(); block('a'); block('b', { x: 400 }); const a = arrow('ab', 'a', 'b')
    rclick(arrowHit('ab'))
    let sub = openSub('Pattern')
    assert.eq(rowByLabel(sub, 'Solid').getAttribute('aria-checked'), 'true')
    click('Dashed', sub)
    assert.eq(state.arrows[0].pattern, 'dashed')
    assert.eq(state.arrows[0].style, 'routed', 'the route is untouched')
    rclick(arrowHit('ab'))
    sub = openSub('Route')
    assert.eq(rowByLabel(sub, 'Routed').getAttribute('aria-checked'), 'true')
    click('Curved', sub)
    assert.eq(state.arrows[0].style, 'curved')
    assert.eq(state.arrows[0].pattern, 'dashed', 'the pattern is untouched')
    assert.eq(history(), 2)
    void a
  })

  it('a legacy dashed style keeps its dash when the route changes', () => {
    reset(); block('a'); block('b', { x: 400 }); arrow('ab', 'a', 'b', { style: 'dashed' })
    rclick(arrowHit('ab'))
    const sub = openSub('Pattern')
    assert.eq(rowByLabel(sub, 'Dashed').getAttribute('aria-checked'), 'true')
    closeMenus()
    rclick(arrowHit('ab'))
    click('Elbow', openSub('Route'))
    assert.eq(state.arrows[0].style, 'elbow')
    assert.eq(state.arrows[0].pattern, 'dashed')
  })

  it('Reverse swaps the ends and their pins; Two-way toggles', () => {
    reset(); block('a'); block('b', { x: 400 }); arrow('ab', 'a', 'b', { fromPort: 'right', toPort: null })
    rclick(arrowHit('ab'))
    assert.includes(labels(rootMenu()), 'Reset ends to auto', 'shown when an end is pinned')
    click('Reverse direction')
    const a = state.arrows[0]
    assert.eq(a.from, 'b'); assert.eq(a.to, 'a')
    assert.eq(a.toPort, 'right'); assert.eq(a.fromPort, null)
    rclick(arrowHit('ab'))
    assert.eq(rowByLabel(rootMenu(), 'Two-way').getAttribute('aria-checked'), 'false')
    click('Two-way')
    assert.eq(state.arrows[0].bidirectional, true)
    rclick(arrowHit('ab'))
    click('Reset ends to auto')
    assert.eq(state.arrows[0].toPort, null)
    assert.eq(history(), 3)
  })

  it('Weight checks only the real weight: a legacy weight gets its own row, and re-picking it changes nothing', () => {
    reset(); block('a'); block('b', { x: 400 }); arrow('ab', 'a', 'b', { weight: 2 })
    rclick(arrowHit('ab'))
    let sub = openSub('Weight')
    const checked = () => rows(sub).filter(r => r.getAttribute('aria-checked') === 'true').map(labelOf)
    assert.deepEq(checked(), ['2px'], 'no preset claims a weight it does not have')
    click('2px', sub)
    assert.eq(state.arrows[0].weight, 2)
    assert.eq(history(), 0, 'picking the current weight is not an undo step')
    rclick(arrowHit('ab'))
    sub = openSub('Weight')
    click('Bold', sub)
    assert.eq(state.arrows[0].weight, 3.5)
    rclick(arrowHit('ab'))
    sub = openSub('Weight')
    assert.deepEq(checked(), ['Bold'])
    assert.ok(!labels(sub).includes('2px'), 'a preset weight needs no extra row')
    closeMenus()
    // A saved arrow with no weight draws at 2, so that is what it shows.
    delete state.arrows[0].weight
    rclick(arrowHit('ab'))
    sub = openSub('Weight')
    assert.deepEq(checked(), ['2px'])
    closeMenus()
  })

  it('Meaning sets the relation, and picking the current one changes nothing', () => {
    reset(); block('a'); block('b', { x: 400 }); arrow('ab', 'a', 'b')
    rclick(arrowHit('ab'))
    let sub = openSub('Meaning')
    assert.eq(rowByLabel(sub, 'Auto (from the label and card types)').getAttribute('aria-checked'), 'true')
    click('Blocks', sub)
    assert.eq(state.arrows[0].relation, 'blocks')
    rclick(arrowHit('ab'))
    sub = openSub('Meaning')
    assert.eq(rowByLabel(sub, 'Blocks').getAttribute('aria-checked'), 'true')
    click('Blocks', sub)
    assert.eq(history(), 1, 'a no-op takes no undo step')
  })

  it('Colour and Delete', () => {
    reset(); block('a'); block('b', { x: 400 }); arrow('ab', 'a', 'b')
    rclick(arrowHit('ab'))
    openSub('Colour').querySelector('.pf-menu-swatch[aria-label="Cyan"]').click()
    assert.eq(state.arrows[0].color, '#1794b5')
    rclick(arrowHit('ab'))
    click('Delete')
    assert.eq(state.arrows.length, 0)
    undo()
    assert.eq(state.arrows.length, 1)
  })
})

describe('Context menus: one block', () => {
  it('lists the block actions with destructive last, hiding what does not apply', () => {
    reset(); block('a')
    rclick(blockEl('a'))
    const m = rootMenu()
    assert.ok(m.classList.contains('ctx-block-menu'))
    assert.eq(selection.blockId, 'a')
    const l = labels(m)
    ;['Edit title', 'Edit description', 'Add connected', 'Change type', 'Status', 'Priority', 'Highlight', 'Colour',
      'Zoom to block', 'Duplicate', 'Collapse', 'Add question', 'Delete'].forEach(x => assert.includes(l, x))
    assert.ok(!l.includes('Connect to…'), 'no other block to connect to')
    assert.ok(!l.includes('Select upstream') && !l.includes('Select downstream'), 'no connections')
    assert.ok(!l.some(x => x.startsWith('Select all')), 'only one of its type')
    assert.eq(l[l.length - 1], 'Delete')
    // Real buttons with names, tagged for integration.
    rows(m).forEach(r => { assert.eq(r.tagName, 'BUTTON'); assert.ok(labelOf(r).trim()) })
    assert.ok(m.hasAttribute('data-canvas-ui'))
    assert.eq(m.getAttribute('role'), 'menu')
    assert.ok(m.querySelector('[data-ctx="delete"]'))
    assert.eq(document.querySelector('.ctx-menu'), null, 'the hand-rolled menu is gone')
    closeMenus()
  })

  it('Edit title starts inline editing on the card', () => {
    reset(); block('a')
    rclick(blockEl('a'))
    click('Edit title')
    assert.ok(isInlineEditing())
    commitInlineEdit()
  })

  it('Add connected creates one block and one arrow in one undo step, suggested types first', () => {
    reset(); block('g', { type: 'goal' })
    rclick(blockEl('g'))
    const sub = openSub('Add connected')
    const first = rows(sub)[0]
    assert.eq(labelOf(first), TYPES[suggestedNextTypes('goal')[0]].label)
    assert.eq(rows(sub).length, Object.keys(TYPES).length, 'every type is offered once')
    click('Metric', sub)
    assert.ok(isInlineEditing(), 'the new block opens in title editing')
    commitInlineEdit()
    const m = Object.values(state.blocks).find(b => b.type === 'metric')
    assert.ok(m)
    assert.eq(state.arrows.length, 1)
    assert.eq(state.arrows[0].from, m.id, 'metric -> goal, the way "measures" reads')
    assert.eq(state.arrows[0].to, 'g')
    assert.eq(history(), 1)
    undo()
    assert.eq(Object.keys(state.blocks).length, 1)
    assert.eq(state.arrows.length, 0)
  })

  it('Connect to adds exactly one arrow and then drops that block from the list', () => {
    reset()
    block('g', { type: 'goal' }); block('m', { type: 'metric', x: 400 }); block('r', { type: 'requirement', x: 800 })
    rclick(blockEl('g'))
    let sub = openSub('Connect to…')
    assert.ok(sub.querySelector('.pf-menu-search-input'), 'a filter box')
    assert.deepEq(labels(sub), ['m', 'r'])
    click('m', sub)
    assert.eq(state.arrows.length, 1)
    assert.eq(state.arrows[0].from, 'm', 'metric -> goal')
    assert.eq(history(), 1)
    rclick(blockEl('g'))
    sub = openSub('Connect to…')
    assert.deepEq(labels(sub), ['r'], 'already connected blocks are not offered again')
    click('r', sub)
    assert.eq(state.arrows.length, 2)
    assert.ok(state.arrows.some(a => a.from === 'g' && a.to === 'r'))
    undo()
    assert.eq(state.arrows.length, 1)
  })

  it('Change type is grouped by step, checks the current type and clears a pending type check', () => {
    reset(); block('a', { type: 'custom', typeCheck: true })
    rclick(blockEl('a'))
    const sub = openSub('Change type')
    assert.eq(rows(sub).length, Object.keys(TYPES).length)
    assert.eq(sub.querySelectorAll('.pf-menu-heading').length, typesByStep().filter(g => g.types.length).length)
    const checked = rows(sub).filter(r => r.getAttribute('aria-checked') === 'true').map(labelOf)
    assert.deepEq(checked, [TYPES.custom.label])
    click('Risk', sub)
    assert.eq(state.blocks.a.type, 'risk')
    assert.ok(!('typeCheck' in state.blocks.a), 'the type check is settled')
    assert.eq(history(), 1)
    rclick(blockEl('a'))
    click('Risk', openSub('Change type'))
    assert.eq(history(), 1, 'choosing the current type is not an undo step')
  })

  it('Status, Priority, Highlight and Colour each write one undo step', () => {
    reset(); block('a')
    rclick(blockEl('a'))
    let sub = openSub('Status')
    assert.eq(rowByLabel(sub, 'Not started').getAttribute('aria-checked'), 'true')
    click('Done', sub)
    assert.eq(state.blocks.a.status, 'done')
    rclick(blockEl('a'))
    click('High', openSub('Priority'))
    assert.eq(state.blocks.a.priority, 'high')
    rclick(blockEl('a'))
    openSub('Highlight').querySelector('.pf-menu-swatch[aria-label="Alert"]').click()
    assert.eq(state.blocks.a.highlight, 'alert')
    rclick(blockEl('a'))
    sub = openSub('Colour')
    assert.eq(sub.querySelector('.pf-menu-swatch').getAttribute('aria-label'), 'Type colour (default)', 'default first')
    sub.querySelector('.pf-menu-swatch[aria-label="Cyan"]').click()
    assert.eq(state.blocks.a.color, '#1794b5')
    rclick(blockEl('a'))
    openSub('Colour').querySelector('.pf-menu-swatch[aria-label="Type colour (default)"]').click()
    assert.eq(state.blocks.a.color, null)
    assert.eq(history(), 5)
  })

  it('Select upstream and downstream follow the drawn direction', () => {
    reset()
    block('a'); block('b', { x: 300 }); block('c', { x: 600 }); block('d', { y: 300 })
    arrow('ab', 'a', 'b'); arrow('bc', 'b', 'c'); arrow('db', 'd', 'b')
    rclick(blockEl('b'))
    click('Select upstream')
    assert.deepEq([...selection.ids].sort(), ['a', 'b', 'd'])
    rclick(blockEl('b'))
    // b is now inside a multi-selection; right-clicking it keeps that.
    assert.ok(rootMenu().classList.contains('ctx-multi-menu'))
    closeMenus()
    selectBlock('b')
    rclick(blockEl('b'))
    click('Select downstream')
    assert.deepEq([...selection.ids].sort(), ['b', 'c'])
    selectBlock('a')
    rclick(blockEl('a'))
    assert.ok(!labels(rootMenu()).includes('Select upstream'), 'nothing leads to a')
    closeMenus()
  })

  it('Add question adds one empty question as one undo step; Delete is one undo step', () => {
    reset(); block('a')
    rclick(blockEl('a'))
    click('Add question')
    assert.eq(state.blocks.a.questions.length, 1)
    assert.eq(history(), 1)
    rclick(blockEl('a'))
    click('Delete')
    assert.eq(state.blocks.a, undefined)
    undo()
    assert.ok(state.blocks.a)
    assert.eq(state.blocks.a.questions.length, 1)
  })

  it('right-clicking text being edited keeps the browser menu', () => {
    reset(); block('a')
    startInlineEdit('a', 'title')
    const ev = rclick(blockEl('a'))
    assert.ok(!ev.defaultPrevented)
    assert.ok(!isMenuOpen())
    commitInlineEdit()
  })
})

describe('Context menus: multi-selection', () => {
  it('right-clicking a block inside the selection keeps it and shows the tally', () => {
    reset()
    block('a'); block('b', { x: 300 }); block('c', { x: 600, type: 'risk' })
    setSelection(['a', 'b', 'c'])
    rclick(blockEl('b'))
    assert.eq(selection.ids.size, 3, 'the selection survives')
    const m = rootMenu()
    assert.ok(m.classList.contains('ctx-multi-menu'))
    assert.eq(m.querySelector('.pf-menu-heading').textContent, '3 blocks: 2 goals, 1 risk')
    const l = labels(m)
    ;['Change type', 'Status', 'Highlight', 'Align', 'Distribute', 'Group into frame', 'Zoom to selection',
      'Duplicate all', 'Delete 3 blocks'].forEach(x => assert.includes(l, x))
    closeMenus()
  })

  it('right-clicking a block outside the selection selects just that block', () => {
    reset()
    block('a'); block('b', { x: 300 }); block('c', { x: 600 })
    setSelection(['a', 'b'])
    rclick(blockEl('c'))
    assert.eq(selection.ids.size, 1)
    assert.eq(selection.blockId, 'c')
    assert.ok(rootMenu().classList.contains('ctx-block-menu'))
    closeMenus()
  })

  it('Distribute needs three blocks; Align needs two', () => {
    reset(); block('a'); block('b', { x: 300 })
    setSelection(['a', 'b'])
    rclick(blockEl('a'))
    const l = labels(rootMenu())
    assert.includes(l, 'Align')
    assert.ok(!l.includes('Distribute'))
    closeMenus()
  })

  it('bulk Change type is one undo step and keeps the selection', () => {
    reset()
    block('a'); block('b', { x: 300, type: 'risk' }); block('c', { x: 600 })
    setSelection(['a', 'b', 'c'])
    rclick(blockEl('a'))
    const sub = openSub('Change type')
    assert.ok(!rows(sub).some(r => r.getAttribute('aria-checked') === 'true'), 'mixed types check nothing')
    click('Decision', sub)
    assert.ok(['a', 'b', 'c'].every(id => state.blocks[id].type === 'decision'))
    assert.eq(history(), 1)
    assert.eq(selection.ids.size, 3)
    undo()
    assert.eq(state.blocks.b.type, 'risk')
  })

  it('Align moves the blocks as one undo step and keeps their gap marks', () => {
    reset(); block('a', { x: 10 }); block('b', { x: 300, y: 200 })
    runGapDetection()
    const gapClasses = id => [...document.getElementById('b-' + id).classList].filter(c => c.startsWith('gap-')).sort()
    const before = gapClasses('b')
    setSelection(['a', 'b'])
    rclick(blockEl('b'))
    click('Left edges', openSub('Align'))
    assert.eq(state.blocks.b.x, 10)
    assert.eq(history(), 1)
    assert.deepEq(gapClasses('b'), before, 'rebuilding the cards did not wipe their gap state')
  })

  it('Group into frame groups the selection, then is no longer offered', () => {
    reset(); block('a'); block('b', { x: 300 })
    setSelection(['a', 'b'])
    rclick(blockEl('a'))
    click('Group into frame')
    assert.ok(state.blocks.a.groupId)
    assert.eq(state.blocks.a.groupId, state.blocks.b.groupId)
    assert.eq(history(), 1)
    setSelection(['a', 'b'])
    rclick(blockEl('a'))
    assert.ok(!labels(rootMenu()).includes('Group into frame'))
    closeMenus()
  })

  it('Duplicate all copies the connections inside the selection, in one undo step', () => {
    reset()
    block('a'); block('b', { x: 300 }); block('c', { x: 600 })
    arrow('ab', 'a', 'b'); arrow('bc', 'b', 'c')
    setSelection(['a', 'b'])
    rclick(blockEl('a'))
    click('Duplicate all')
    assert.eq(Object.keys(state.blocks).length, 5)
    assert.eq(state.arrows.length, 3, 'a -> b is copied, b -> c is not')
    const fresh = [...selection.ids]
    assert.eq(fresh.length, 2)
    assert.ok(fresh.every(id => !['a', 'b', 'c'].includes(id)), 'the copies are selected')
    assert.ok(state.arrows.some(x => fresh.includes(x.from) && fresh.includes(x.to)))
    assert.eq(history(), 1)
    undo()
    assert.eq(Object.keys(state.blocks).length, 3)
    assert.eq(state.arrows.length, 2)
  })

  it('Delete N removes the selection in one undo step', () => {
    reset(); block('a'); block('b', { x: 300 })
    const m = openMultiMenu(['a', 'b'], 40, 40)
    assert.ok(m)
    click('Delete 2 blocks')
    assert.eq(Object.keys(state.blocks).length, 0)
    undo()
    assert.eq(Object.keys(state.blocks).length, 2)
  })
})

describe('Context menus: canvas', () => {
  it('right-clicking empty canvas offers core types, more types, paste and view actions', () => {
    reset(); block('a'); block('b', { x: 300 })
    rclick($.canvasRoot(), 50, 50)
    const m = rootMenu()
    assert.ok(m.classList.contains('ctx-canvas-menu'))
    const core = Object.keys(TYPES).filter(t => TYPES[t].tier === 'core')
    assert.deepEq([...m.querySelectorAll('[data-add-type]')].map(r => r.dataset.addType), core)
    const l = labels(m)
    ;['More types', 'Paste as blocks', 'Select all', 'Tidy', 'Fit', 'Zoom to 100%'].forEach(x => assert.includes(l, x))
    closeMenus()
  })

  it('adding from the canvas menu creates the block at the pointer, in title editing', () => {
    reset()
    const saved = { ...view }
    Object.assign(view, { panX: 100, panY: 40, zoom: 2 })
    try {
      rclick($.canvasRoot(), 300, 240)
      rootMenu().querySelector('[data-add-type="goal"]').click()
      const made = Object.values(state.blocks)
      assert.eq(made.length, 1)
      // The test viewport sits at 0,0: world = (client - pan) / zoom = (100, 100).
      assert.eq(made[0].x + DEFAULT_WIDTH / 2, 100)
      assert.eq(made[0].y + 50, 100)
      assert.ok(isInlineEditing())
      commitInlineEdit()
      assert.eq(history(), 1)
    } finally { Object.assign(view, saved) }
  })

  it('the quick-add picker lists every type behind a filter, and Enter picks the first match', () => {
    reset()
    const m = openCanvasAddMenu(60, 60)
    assert.ok(m.el.classList.contains('ctx-add-menu'))
    assert.eq(m.el.querySelectorAll('[data-add-type]').length, Object.keys(TYPES).length)
    const input = m.el.querySelector('.pf-menu-search-input')
    assert.eq(document.activeElement, input, 'the filter has focus')
    input.value = 'metr'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    assert.deepEq(rows(m.el).map(r => r.dataset.addType), ['metric'])
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    assert.ok(!isMenuOpen())
    const made = Object.values(state.blocks)
    assert.eq(made.length, 1)
    assert.eq(made[0].type, 'metric')
    commitInlineEdit()
  })

  it('the quick-add picker takes suggestions, a pick callback and a cancel callback', async () => {
    reset()
    let picked = null, cancelled = 0
    let m = openCanvasAddMenu(60, 60, { suggested: ['risk', 'metric'], onPick: t => { picked = t }, onCancel: () => cancelled++ })
    const order = [...m.el.querySelectorAll('[data-add-type]')].map(r => r.dataset.addType)
    assert.deepEq(order.slice(0, 2), ['risk', 'metric'])
    assert.eq(order.length, Object.keys(TYPES).length, 'suggested types are not listed twice')
    m.el.querySelector('[data-add-type="metric"]').click()
    await Promise.resolve()
    assert.eq(picked, 'metric')
    assert.eq(cancelled, 0, 'a pick is not a cancel')
    assert.eq(Object.keys(state.blocks).length, 0, 'onPick replaces the default create')
    m = openCanvasAddMenu(60, 60, { onCancel: () => cancelled++ })
    closeMenus()
    await Promise.resolve()
    assert.eq(cancelled, 1)
  })
})

describe('Context menus: read-only and keyboard', () => {
  it('read-only views get navigation only', () => {
    reset(); block('a'); block('b', { x: 300 }); arrow('ab', 'a', 'b')
    ui.readOnly = true
    try {
      rclick(blockEl('a'))
      assert.deepEq(labels(rootMenu()), ['Zoom to block'])
      closeMenus()
      rclick($.canvasRoot(), 50, 50)
      assert.deepEq(labels(rootMenu()), ['Fit', 'Zoom to 100%'])
      closeMenus()
      rclick(arrowHit('ab'))
      assert.deepEq(labels(rootMenu()), ['Go to source', 'Go to target'])
      closeMenus()
      assert.eq(openCanvasAddMenu(10, 10), null)
      assert.eq(history(), 0)
    } finally { ui.readOnly = false }
  })

  it('Shift+F10 opens the menu for the selected block, connection or the canvas', () => {
    reset(); block('a'); block('b', { x: 300 }); arrow('ab', 'a', 'b')
    const shiftF10 = () => {
      document.activeElement?.blur?.()
      const ev = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })
      document.body.dispatchEvent(ev)
      return ev
    }
    selectBlock('a')
    assert.ok(shiftF10().defaultPrevented)
    assert.ok(rootMenu().classList.contains('ctx-block-menu'))
    // The contextmenu event some platforms send after the key must not
    // replace the menu the key opened.
    rclick($.canvasRoot(), 50, 50)
    assert.ok(rootMenu().classList.contains('ctx-block-menu'))
    closeMenus()
    selectArrow('ab')
    shiftF10()
    assert.ok(rootMenu().classList.contains('ctx-arrow-menu'))
    closeMenus()
    deselectAll()
    shiftF10()
    assert.ok(rootMenu().classList.contains('ctx-canvas-menu'))
    closeMenus()
  })
})

describe('Context menus: wording', () => {
  it('pluralises type names, including the two-part ones', () => {
    assert.eq(typeNoun('risk', 1), 'risk')
    assert.eq(typeNoun('risk', 2), 'risks')
    assert.eq(typeNoun('process', 2), 'processes')
    assert.eq(typeNoun('question', 3), 'open questions')
    assert.eq(typeNoun('terminator', 2), 'triggers / ends')
    assert.eq(typeNoun('resource', 2), 'resources / systems')
  })

  it('tallies a selection by type, largest first', () => {
    reset()
    block('a'); block('b', { type: 'risk' }); block('c', { type: 'risk' })
    assert.eq(selectionTally(['a', 'b', 'c']), '3 blocks: 2 risks, 1 goal')
    assert.eq(selectionTally(['b', 'c']), '2 risks')
    reset()
  })
})

describe('Context menus: edge cases', () => {
  it('a macOS Ctrl+click on a selected block keeps the multi-selection after release', () => {
    reset(); setupCanvasPointerEvents()
    block('a'); block('b', { x: 300 }); block('c', { x: 600 })
    setSelection(['a', 'b', 'c'])
    const el = blockEl('b')
    const press = (type, buttons) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 41, button: 0, buttons, ctrlKey: true,
      clientX: 50, clientY: 50, isPrimary: true, pointerType: 'mouse' }))
    // Ctrl+click is a primary press: the canvas starts one, then the
    // browser sends contextmenu, then the release arrives.
    press('pointerdown', 1)
    assert.ok(pointer.ix, 'the canvas started a press')
    rclick(el, 50, 50)
    assert.eq(pointer.ix, null, 'the menu took the press over')
    press('pointerup', 0)
    assert.eq(selection.ids.size, 3, 'the release did not collapse the selection')
    assert.ok(rootMenu().classList.contains('ctx-multi-menu'))
    closeMenus()
  })

  it('Reverse refuses to stack a second connection on one running the other way', () => {
    reset(); block('a'); block('b', { x: 400 }); arrow('ab', 'a', 'b'); arrow('ba', 'b', 'a')
    rclick(arrowHit('ab'))
    click('Reverse direction')
    const ab = state.arrows.find(x => x.id === 'ab')
    assert.eq(ab.from, 'a'); assert.eq(ab.to, 'b')
    assert.eq(history(), 0, 'nothing changed, so no undo step')
  })

  it('Edit description edits the description with the caret at the end', () => {
    reset(); block('a', { description: 'Some words' })
    rclick(blockEl('a'))
    click('Edit description')
    assert.ok(isInlineEditing())
    assert.eq(document.querySelector('#b-a .block-desc').contentEditable, 'true', 'the description is being edited')
    assert.neq(document.querySelector('#b-a .block-title').contentEditable, 'true')
    assert.ok(window.getSelection().isCollapsed, 'nothing is selected, so typing cannot replace it')
    commitInlineEdit()
    assert.eq(history(), 0, 'opening and closing the editor is not an edit')
  })

  it('Collapse flips to Expand and hides Edit description; Duplicate selects the copy', () => {
    reset(); block('a')
    rclick(blockEl('a'))
    click('Collapse')
    assert.eq(state.blocks.a.collapsed, true)
    rclick(blockEl('a'))
    const l = labels(rootMenu())
    assert.includes(l, 'Expand')
    assert.ok(!l.includes('Edit description'), 'a collapsed card shows no description')
    click('Expand')
    assert.eq(state.blocks.a.collapsed, false)
    rclick(blockEl('a'))
    click('Duplicate')
    assert.eq(Object.keys(state.blocks).length, 2)
    assert.ok(selection.blockId && selection.blockId !== 'a', 'the copy is selected')
    assert.eq(history(), 3)
  })

  it('type dots follow light mode', () => {
    reset(); block('a')
    ui.lightMode = true
    try {
      rclick(blockEl('a'))
      const sub = openSub('Change type')
      const dot = rowByLabel(sub, TYPES.goal.label).querySelector('.pf-menu-dot')
      assert.includes(dot.getAttribute('style'), TYPES.goal.light)
      closeMenus()
    } finally { ui.lightMode = false }
  })

  it('the ContextMenu key on a multi-selection opens its menu and keeps the selection', () => {
    reset(); block('a'); block('b', { x: 300 })
    setSelection(['a', 'b'])
    document.activeElement?.blur?.()
    const ev = new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true })
    document.body.dispatchEvent(ev)
    assert.ok(ev.defaultPrevented)
    assert.ok(rootMenu().classList.contains('ctx-multi-menu'))
    assert.eq(selection.ids.size, 2)
    closeMenus()
  })

  it('Shift+F10 inside a text field leaves the browser alone', () => {
    reset(); block('a'); selectBlock('a')
    const input = document.createElement('input')
    document.body.appendChild(input)
    try {
      input.focus()
      const ev = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true })
      input.dispatchEvent(ev)
      assert.ok(!ev.defaultPrevented)
      assert.ok(!isMenuOpen())
    } finally { input.remove() }
  })

  it('canvas Select all selects every block; Tidy needs two blocks', () => {
    reset(); block('a')
    rclick($.canvasRoot(), 50, 50)
    assert.ok(!labels(rootMenu()).includes('Tidy'), 'nothing to arrange')
    click('Select all')
    assert.deepEq([...selection.ids], ['a'])
    block('b', { x: 300 })
    rclick($.canvasRoot(), 50, 50)
    click('Select all')
    assert.eq(selection.ids.size, 2)
  })
})

describe('Context menus: paste as blocks', () => {
  const withClipboard = async (readText, fn) => {
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })
    try { await fn() } finally { delete navigator.clipboard }
  }
  const tick = () => new Promise(r => setTimeout(r, 0))

  it('pastes the clipboard as blocks that start at the pointer, in one undo step', async () => {
    reset()
    const saved = { ...view }
    Object.assign(view, { panX: 100, panY: 40, zoom: 2 })
    try {
      await withClipboard(async () => 'Goal: ship the report\nRisk: the data is late', async () => {
        rclick($.canvasRoot(), 300, 240)
        click('Paste as blocks')
        await tick()
      })
      const made = Object.values(state.blocks)
      assert.eq(made.length, 2)
      // World point of the click: (300 - 100) / 2, (240 - 40) / 2 = (100, 100).
      assert.eq(Math.min(...made.map(b => b.x)), 100 - DEFAULT_WIDTH / 2)
      assert.eq(Math.min(...made.map(b => b.y)), 100)
      assert.eq(history(), 1)
      undo()
      assert.eq(Object.keys(state.blocks).length, 0)
    } finally { Object.assign(view, saved) }
  })

  it('a blocked clipboard creates nothing and takes no undo step', async () => {
    reset()
    await withClipboard(async () => { throw new Error('denied') }, async () => {
      rclick($.canvasRoot(), 50, 50)
      click('Paste as blocks')
      await tick()
    })
    assert.eq(Object.keys(state.blocks).length, 0)
    assert.eq(history(), 0)
  })

  it('movePastedTo moves a pasted column and any chips riding on it', () => {
    reset()
    const ids = createBlocksFromText('Goal: one\nRisk: two')
    movePastedTo(ids, { x: 610, y: 420 })
    const bs = ids.map(id => state.blocks[id])
    assert.eq(Math.min(...bs.map(b => b.x)), 610 - DEFAULT_WIDTH / 2)
    assert.eq(Math.min(...bs.map(b => b.y)), 420)
    bs.forEach(b => {
      const el = document.getElementById('b-' + b.id)
      assert.eq(el.style.left, b.x + 'px')
      assert.eq(el.style.top, b.y + 'px')
      assert.ok([...el.classList].some(c => c.startsWith('gap-')), 'the gap marks survive the move')
      const chip = document.querySelector(`.type-chip[data-bid="${b.id}"]`)
      if (chip) assert.eq(chip.style.left, b.x + 'px')
    })
    assert.eq(history(), 1, 'the move is part of the paste')
  })
})

describe('Context menus: connecting and following connections', () => {
  it('Connect to never offers a block already connected either way, so it cannot stack an opposing arrow', () => {
    reset(); block('a'); block('b', { x: 400 }); arrow('ba', 'b', 'a')
    rclick(blockEl('a'))
    assert.ok(!labels(rootMenu()).includes('Connect to…'), 'b already points at a')
    closeMenus()
    block('c', { x: 800 })
    rclick(blockEl('a'))
    assert.deepEq(labels(openSub('Connect to…')), ['c'])
    closeMenus()
    // Goal -> Metric exists; the metric -> goal default must not add its twin.
    reset(); block('g', { type: 'goal' }); block('m', { type: 'metric', x: 400 }); arrow('gm', 'g', 'm')
    rclick(blockEl('g'))
    assert.ok(!labels(rootMenu()).includes('Connect to…'))
    closeMenus()
    // A two-way connection counts from either end.
    reset(); block('a'); block('b', { x: 400 }); block('c', { x: 800 }); arrow('ab', 'a', 'b', { bidirectional: true })
    rclick(blockEl('b'))
    assert.deepEq(labels(openSub('Connect to…')), ['c'])
    closeMenus()
    assert.eq(state.arrows.length, 1)
    assert.eq(history(), 0)
  })

  it('each Connect to row says which way the new connection will run', () => {
    reset()
    block('g', { type: 'goal' }); block('m', { type: 'metric', x: 400 }); block('d', { type: 'decision', x: 800 })
    block('i', { type: 'implementation', y: 300 }); block('r', { type: 'requirement', x: 400, y: 300 })
    rclick(blockEl('g'))
    let sub = openSub('Connect to…')
    const hint = label => rowByLabel(sub, label).querySelector('.pf-menu-hint')?.textContent
    assert.eq(hint('m'), 'Metric: it measures this')
    assert.eq(hint('d'), 'Decision: this comes before it')
    closeMenus()
    rclick(blockEl('i'))
    sub = openSub('Connect to…')
    assert.eq(hint('r'), 'Requirement: this satisfies it')
    click('r', sub)
    assert.ok(state.arrows.some(a => a.from === 'i' && a.to === 'r'), 'the arrow runs the way the row said')
  })

  it('Select upstream and downstream follow two-way connections both ways', () => {
    reset()
    block('a'); block('b', { x: 300 }); block('c', { x: 600 })
    arrow('ab', 'a', 'b', { bidirectional: true }); arrow('bc', 'b', 'c')
    rclick(blockEl('b'))
    const l = labels(rootMenu())
    assert.includes(l, 'Select upstream')
    assert.includes(l, 'Select downstream', 'b reaches a through the two-way link')
    click('Select downstream')
    assert.deepEq([...selection.ids].sort(), ['a', 'b', 'c'])
    selectBlock('c')
    rclick(blockEl('c'))
    click('Select upstream')
    assert.deepEq([...selection.ids].sort(), ['a', 'b', 'c'], 'c -> b, then b <-> a')
    selectBlock('a')
    rclick(blockEl('a'))
    assert.includes(labels(rootMenu()), 'Select upstream', 'the two-way link leads back to a too')
    closeMenus()
  })
})

describe('Context menus: no-op picks', () => {
  it('Align on an already aligned selection moves nothing and takes no undo step', () => {
    reset(); block('a', { x: 10, y: 10 }); block('b', { x: 10, y: 300 }); block('c', { x: 400, y: 600 })
    // A redo step waiting from earlier must survive a pick that changes nothing.
    rclick(blockEl('c')); click('Done', openSub('Status')); undo()
    assert.eq(getRedoFuture().length, 1)
    setSelection(['a', 'b'])
    rclick(blockEl('a'))
    click('Left edges', openSub('Align'))
    assert.eq(history(), 0)
    assert.eq(getRedoFuture().length, 1, 'redo is still there')
    assert.eq(state.blocks.b.x, 10)
    rclick(blockEl('a'))
    click('Top edges', openSub('Align'))
    assert.eq(history(), 1, 'a pick that moves something is one undo step')
    assert.eq(state.blocks.b.y, 10)
  })

  it('Distribute on evenly spaced blocks takes no undo step', () => {
    reset(); block('a', { x: 0, y: 0 }); block('b', { x: 400, y: 0 }); block('c', { x: 800, y: 0 })
    setSelection(['a', 'b', 'c'])
    rclick(blockEl('a'))
    click('Horizontally', openSub('Distribute'))
    assert.deepEq(['a', 'b', 'c'].map(id => state.blocks[id].x), [0, 400, 800])
    assert.eq(history(), 0)
    state.blocks.b.x = 100
    rclick(blockEl('a'))
    click('Horizontally', openSub('Distribute'))
    assert.eq(state.blocks.b.x, 400)
    assert.eq(history(), 1)
  })

  it('Add question reuses a blank question at the end instead of stacking another', () => {
    reset(); block('a')
    rclick(blockEl('a')); click('Add question')
    rclick(blockEl('a')); click('Add question')
    assert.deepEq(state.blocks.a.questions, [{ text: '' }])
    assert.eq(history(), 1, 'the second pick changed nothing')
    state.blocks.a.questions = [{ text: 'Who signs it off?' }]
    rclick(blockEl('a')); click('Add question')
    assert.eq(state.blocks.a.questions.length, 2, 'a written question gets a new one after it')
    assert.eq(state.blocks.a.questions[1].text, '')
  })
})

describe('Context menus: type lists', () => {
  it('type rows carry their meaning, so the filter finds a type by what it is for', () => {
    reset()
    const m = openCanvasAddMenu(60, 60)
    const input = m.el.querySelector('.pf-menu-search-input')
    const filter = q => {
      input.value = q
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return rows(m.el).map(r => r.dataset.addType)
    }
    assert.deepEq(filter('deliverable'), ['output'])
    assert.deepEq(filter('measurable'), ['metric'])
    assert.includes(filter('stakeholder'), 'stakeholder', 'a More types type is reachable from the filter')
    closeMenus()
    reset(); block('a')
    rclick(blockEl('a'))
    const sub = openSub('Change type')
    assert.eq(rowByLabel(sub, TYPES.implementation.label).title, TYPES.implementation.short, 'the row describes itself')
    closeMenus()
  })

  it('type lists describe the pointed-at type once, at the foot', async () => {
    reset(); block('a', { type: 'process' })
    rclick(blockEl('a'))
    const sub = openSub('Change type')
    const note = sub.querySelector('.type-menu-note')
    assert.ok(note, 'Change type has a note')
    assert.includes(note.textContent, 'Implementation', 'it opens on the current type, and Process is often confused with Implementation')
    await Promise.resolve()
    rowByLabel(sub, TYPES.goal.label).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    assert.eq(note.textContent, `${TYPES.goal.label}: ${TYPES.goal.short}`)
    rowByLabel(sub, TYPES.output.label).dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    assert.includes(note.textContent, 'someone can hold')
    closeMenus()
    rclick(blockEl('a'))
    assert.ok(openSub('Add connected').querySelector('.type-menu-note'), 'Add connected has one too')
    closeMenus()
  })

  it('the quick-add picker shows the core types and More types, not all 16 under headings', () => {
    reset()
    const core = Object.keys(TYPES).filter(t => TYPES[t].tier === 'core')
    const more = Object.keys(TYPES).filter(t => TYPES[t].tier !== 'core')
    const m = openCanvasAddMenu(60, 60)
    assert.deepEq(labels(m.el), [...core.map(t => TYPES[t].label), 'More types'])
    assert.eq(m.el.querySelectorAll('.pf-menu-heading').length, 1, 'only its title, no step headings')
    const input = m.el.querySelector('.pf-menu-search-input')
    input.value = 'trig'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    assert.deepEq(rows(m.el).map(r => r.dataset.addType), ['terminator'])
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    assert.deepEq(labels(m.el), [...core.map(t => TYPES[t].label), 'More types'], 'clearing the filter folds the rest away again')
    const sub = openSub('More types')
    assert.deepEq(labels(sub), more.map(t => TYPES[t].label))
    click(TYPES.stakeholder.label, sub)
    assert.eq(Object.values(state.blocks)[0]?.type, 'stakeholder')
    commitInlineEdit()
    // With suggestions: those first, then the core types not already listed.
    reset()
    const s = openCanvasAddMenu(60, 60, { suggested: ['output', 'metric'] })
    const expected = ['output', 'metric', ...core.filter(t => t !== 'metric')].map(t => TYPES[t].label)
    assert.deepEq(labels(s.el), [...expected, 'More types'])
    closeMenus()
  })
})

describe('Context menus: the viewport never scrolls', () => {
  // A visible, positioned viewport, as in the app: the runner's stub is
  // display:none, and an off-screen card only exists once there is a screen.
  function liveViewport() {
    const vp = $.canvasViewport(), root = $.canvasRoot()
    const prev = [vp.style.cssText, root.style.cssText, vp.getAttribute('tabindex')]
    const saved = { ...view }
    vp.style.cssText = 'display:block;position:fixed;left:0;top:0;width:600px;height:400px;overflow:hidden'
    root.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0'
    vp.tabIndex = 0
    const css = document.createElement('style')
    // The runner loads no stylesheet: give cards and menus their real shape.
    css.textContent = '#canvasRoot .block { position: absolute; width: 220px; min-height: 80px; }' +
      '.pf-menu { width: 220px; } .pf-menu-item { display: flex; width: 100%; min-height: 24px; }'
    document.head.appendChild(css)
    Object.assign(view, { panX: 0, panY: 0, zoom: 1 })
    applyTransform()
    return () => {
      closeMenus()
      vp.scrollLeft = 0; vp.scrollTop = 0
      vp.style.cssText = prev[0]; root.style.cssText = prev[1]
      if (prev[2] == null) vp.removeAttribute('tabindex'); else vp.setAttribute('tabindex', prev[2])
      css.remove()
      Object.assign(view, saved)
    }
  }
  const scrolled = () => { const vp = $.canvasViewport(); return vp.scrollLeft + ',' + vp.scrollTop }
  const key = (k, extra = {}) => (document.activeElement || document.body)
    .dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))
  const inside = (r, v) => r.left >= v.left && r.right <= v.right && r.top >= v.top && r.bottom <= v.bottom

  it('Shift+F10 on a selected block panned off-screen brings it back, and picking leaves the canvas in step', async () => {
    reset(); const done = liveViewport()
    try {
      block('far', { x: 3000, y: 2000 })
      selectBlock('far')
      document.activeElement?.blur?.()
      key('F10', { shiftKey: true })
      const m = rootMenu()
      assert.ok(m?.classList.contains('ctx-block-menu'))
      const vr = $.canvasViewport().getBoundingClientRect()
      const card = document.getElementById('b-far').getBoundingClientRect()
      assert.ok(inside(card, vr), 'the card was brought into view')
      assert.eq(view.zoom, 1, 'a pan, not a zoom')
      const mr = m.getBoundingClientRect()
      assert.ok(Math.abs(mr.left - (card.left + 12)) < 2 && Math.abs(mr.top - (card.top + 12)) < 2,
        `the menu opens at the card: menu ${Math.round(mr.left)},${Math.round(mr.top)} card ${Math.round(card.left)},${Math.round(card.top)}`)
      click('Done', openSub('Status'))
      await Promise.resolve()
      assert.eq(state.blocks.far.status, 'done')
      assert.eq(scrolled(), '0,0')
      // The drawing and view.pan agree: the card is where toWorld says it is.
      const r = document.getElementById('b-far').getBoundingClientRect()
      assert.eq(Math.round(r.left), Math.round(state.blocks.far.x * view.zoom + view.panX))
    } finally { done() }
  })

  it('the ContextMenu key anchors a selection on a card that is on screen and leaves the camera alone', () => {
    reset(); const done = liveViewport()
    try {
      block('far', { x: 3000, y: 2000 }); block('near', { x: 40, y: 40 })
      setSelection(['far', 'near'])
      document.activeElement?.blur?.()
      key('ContextMenu')
      assert.ok(rootMenu()?.classList.contains('ctx-multi-menu'))
      assert.deepEq([view.panX, view.panY], [0, 0])
      key('Escape')
      assert.ok(!isMenuOpen())
      assert.eq(scrolled(), '0,0')
      assert.eq(document.activeElement, document.getElementById('b-near'), 'focus is back on the card it opened at')
    } finally { done() }
  })

  it('a selection with nothing on screen opens its menu at the canvas centre and returns focus to the canvas', () => {
    reset(); const done = liveViewport()
    try {
      block('p', { x: 3000, y: 2000 }); block('q', { x: 3400, y: 2000 })
      setSelection(['p', 'q'])
      document.activeElement?.blur?.()
      key('ContextMenu')
      const mr = rootMenu().getBoundingClientRect()
      assert.ok(mr.left >= 290 && mr.left <= 310, 'at the centre: ' + mr.left)
      key('Escape')
      assert.eq(scrolled(), '0,0')
      assert.eq(document.activeElement, $.canvasViewport())
    } finally { done() }
  })

  it('closing a menu hands focus back without scrolling, even to a card that has left the screen', () => {
    reset(); const done = liveViewport()
    try {
      block('far', { x: 3000, y: 2000 }); block('a', { x: 40, y: 40 }); block('b', { x: 340, y: 40 })
      arrow('ab', 'a', 'b')
      // The card still has focus after the camera moved away from it.
      document.getElementById('b-far').focus({ preventScroll: true })
      rclick(arrowHit('ab'), 200, 100)
      assert.ok(rootMenu()?.classList.contains('ctx-arrow-menu'))
      key('Escape')
      assert.eq(scrolled(), '0,0')
      // A card clipped by the viewport edge, right-clicked and changed.
      block('edge', { x: 480, y: 200 })
      rclick(blockEl('edge'), 500, 220)
      click('Done', openSub('Status'))
      assert.eq(scrolled(), '0,0')
      // Any scroll that slips through is undone when the menu closes.
      rclick($.canvasRoot(), 100, 300)
      $.canvasViewport().scrollLeft = 120
      assert.eq($.canvasViewport().scrollLeft, 120, 'the test viewport can scroll')
      closeMenus()
      assert.eq(scrolled(), '0,0')
    } finally { done() }
  })
})

describe('Context menus: the camera', () => {
  it('Zoom to block and Zoom to 100% land where their shortcuts do', async () => {
    reset(); block('a')
    const saved = { ...view }
    try {
      Object.assign(view, { panX: 0, panY: 0, zoom: 0.5 })
      rclick(blockEl('a'))
      click('Zoom to block')
      await new Promise(r => setTimeout(r, 400))
      assert.eq(Math.round(view.zoom * 100), 100, 'one block goes to 100%, as Shift+2 does')
      assert.deepEq([...selection.ids], ['a'], 'the selection is unchanged')
      Object.assign(view, { panX: 0, panY: 0, zoom: 0.5 })
      rclick($.canvasRoot(), 50, 50)
      click('Zoom to 100%')
      await new Promise(r => setTimeout(r, 400))
      assert.eq(view.zoom, 1)
    } finally { Object.assign(view, saved) }
  })

  it('uses the camera functions zoom-controls.js exports, the ones the shortcuts run', async () => {
    const nav = await import('../js/zoom-controls.js')
    assert.eq(typeof nav.zoomTo, 'function', 'zoomTo(z), Shift+0')
    assert.eq(typeof nav.zoomToSelection, 'function', 'zoomToSelection(), Shift+2')
    assert.eq(typeof nav.zoomToBlocks, 'function', 'zoomToBlocks(ids), for a block that is not the selection')
  })
})
