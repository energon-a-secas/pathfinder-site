// ============================================================
//  integration.test.js -- the seams between the overhaul's streams,
//  checked on the merged tree: one type picker and one retype rule,
//  one quick-add picker, one Mermaid serializer, one align rule, the
//  shortcut sheet covering keys bound outside events.js, map settings
//  in the undo step, a modal dialog owning the keyboard, blank
//  questions kept out of exports, and the image export drawing the
//  card the canvas draws.
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, selection, view, canvasMeta, snapshot, getUndoHistory, getRedoFuture,
         resetSnapshotToken, saveView } from '../js/state.js'
import { notePointerMove, forgetTabMap } from '../js/library.js'
import { $, TYPES, typesByStep, DEFAULT_ARROW_WEIGHT, askedQuestions } from '../js/utils.js'
import { renderBlock, undo, redo, deselectAll, selectBlock, setSelection } from '../js/render.js'
import { runGapDetection } from '../js/gaps.js'
import { setupContextMenu } from '../js/context-menu.js'
import { setupTypeChips, openTypeChipMenu, setupPasteHandler } from '../js/classify.js'
import { closeMenus, openMenu } from '../js/menu.js'
import * as typeMenu from '../js/type-menu.js'
import { typeMenuItems as inspectorTypeMenuItems } from '../js/inspector.js'
import { openQuickCreate } from '../js/navigation.js'
import { SHORTCUTS, setCanvasCardStyle } from '../js/ui-panels.js'
import { setSpotlight } from '../js/view-menu.js'
import { setupKeyboardShortcuts, setupCanvasPointerEvents } from '../js/events.js'
import { arrangeSelection } from '../js/align.js'
import { buildSvg } from '../js/image-export.js'
import { attentionItems, runAttentionAction } from '../js/attention.js'
import { generatePrompt } from '../js/prompt.js'
import { buildMarkdown } from '../js/export.js'
import { parseMermaid, fromJsonCanvas } from '../js/interop.js'
import { TEMPLATES, applyTemplate } from '../js/templates.js'

const history = () => getUndoHistory().length

function reset() {
  closeMenus()
  cleanupMockEls()
  state.blocks = {}; state.arrows = []; state.groups = {}
  ui.readOnly = false; ui.lightMode = false
  canvasMeta.cardStyle = 'outline'; canvasMeta.spotlight = false; canvasMeta.title = ''
  document.body.classList.remove('spotlight', 'light-mode')
  getUndoHistory().length = 0; getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '', x: 40, y: 40,
    actions: [], questions: [], docRef: null, width: null, color: null, collapsed: false,
    groupId: null, status: null, priority: null, cardStyle: null, borderWidth: null,
    highlight: null, criteria: [], ...extra }
  renderBlock(id)
  return state.blocks[id]
}

const lastMenu = () => { const all = document.querySelectorAll('.pf-menu'); return all[all.length - 1] }
const labelOf = row => row.querySelector('.pf-menu-label')?.textContent
const rows = menu => [...menu.children].filter(n => n.classList.contains('pf-menu-item') && !n.hidden)
function click(label, menu = lastMenu()) {
  const row = rows(menu).find(r => labelOf(r) === label)
  assert.ok(row, `menu row "${label}"`)
  row.click()
}
function openSub(label) {
  click(label)
  const sub = lastMenu()
  assert.ok(sub.classList.contains('pf-submenu'), `"${label}" opened a submenu`)
  return sub
}

// ── One type picker ─────────────────────────────────────────

describe('Integration: one type picker, one retype rule', () => {
  it('the inspector, the context menus and the type check build from type-menu.js', () => {
    assert.eq(inspectorTypeMenuItems, typeMenu.typeMenuItems, 'the inspector re-exports the shared list')
    const flat = typeMenu.typeMenuItems(null, () => {}).filter(i => i.radio).map(i => i.label)
    const byStep = typesByStep().flatMap(g => g.types).map(t => TYPES[t].label)
    assert.deepEq(flat, byStep, 'every type, in step order')
    const compact = typeMenu.typeMenuItems('goal', () => {}, { unconfirmed: true, steps: true })
    assert.eq(compact[0].label, 'Looks right')
    assert.eq(compact.filter(i => i.submenu).length, typesByStep().filter(g => g.types.length).length)
  })

  it('a pick from the context menu or the card settles the check, the hint and a type-coloured fill alike', () => {
    reset(); setupContextMenu(); setupTypeChips()
    const guess = { type: 'custom', typeCheck: true, typeHint: 'widget', color: TYPES.custom.color }
    block('a', { ...guess }); block('b', { ...guess, x: 400 })
    // Context menu: Change type, Risk.
    document.querySelector('#b-a .block-title').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }))
    click('Risk', openSub('Change type'))
    // The card's type check: Doubt, Risk.
    openTypeChipMenu(document.querySelector('#b-b .block-type-check'))
    click('Risk', openSub('Doubt'))
    for (const id of ['a', 'b']) {
      const b = state.blocks[id]
      assert.eq(b.type, 'risk', id)
      assert.ok(!('typeCheck' in b) && !('typeHint' in b), `${id}: check and hint settled`)
      assert.eq(b.color, null, `${id}: the old type's colour went with the old type`)
    }
    assert.eq(history(), 2, 'one undo step each')
    closeMenus()
  })

  it('the retype rule keeps a colour somebody chose', () => {
    const b = { type: 'goal', typeCheck: true, color: '#f472b6' }
    assert.deepEq(typeMenu.retypeBlock(b, 'risk'), { type: 'risk' })
    assert.ok(!('typeCheck' in b))
    assert.eq(typeMenu.retypeBlock({ type: 'goal' }, 'goal'), null, 'the same type changes nothing')
    assert.ok(typeMenu.retypeChanges({ type: 'goal', typeCheck: true }, 'goal'), 'but confirming a guess counts')
  })
})

// ── One quick-add picker ────────────────────────────────────

describe('Integration: one quick-add picker', () => {
  it('a connection dropped on empty canvas opens the double-click picker, suggestions first', () => {
    reset()
    block('a', { type: 'goal' })
    openQuickCreate({ fromId: 'a', fromPort: 'right', clientX: 400, clientY: 300, wx: 400, wy: 300 })
    const m = document.querySelector('.pf-menu.ctx-add-menu')
    assert.ok(m, 'the quick-add picker')
    assert.ok(m.classList.contains('pf-quick-create'), 'with the port-drop hook class')
    assert.ok(m.querySelector('.pf-menu-search-input'), 'its filter box')
    const headings = [...m.querySelectorAll('.pf-menu-heading')].map(h => h.textContent)
    assert.includes(headings, 'Suggested')
    closeMenus()
  })
})

// ── The shortcut sheet ──────────────────────────────────────

describe('Integration: the shortcut sheet lists keys bound outside events.js', () => {
  const rowsOf = () => SHORTCUTS.flatMap(g => g.keys)
  const has = (key, word) => rowsOf().some(([k, d]) => k === key && (!word || d.includes(word)))
  it('names the type check, the menu key, and the connection label keys', () => {
    assert.ok(has('T', 'type check'), 'T (classify.js)')
    assert.ok(has('Shift + F10 / Menu key'), 'Shift+F10 (context-menu.js)')
    assert.ok(has('Enter / F2', 'connection'), 'Enter/F2 on a connection (arrow-edit.js)')
    assert.ok(has('Double-click line', 'label'), 'double-click a line (events.js, arrow-edit.js)')
    assert.ok(has('Alt + H') && has('H') && has('Z'), 'the View toggles')
  })
})

// ── Map settings in the undo step ───────────────────────────

describe('Integration: map settings are undoable', () => {
  it('Card style is one undo step, and undo puts it back', () => {
    reset(); block('a')
    assert.ok(setCanvasCardStyle('plain'))
    assert.eq(history(), 1)
    assert.eq(canvasMeta.cardStyle, 'plain')
    assert.eq(document.getElementById('b-a').dataset.card, 'plain')
    undo()
    assert.eq(canvasMeta.cardStyle, 'outline')
    assert.eq(document.getElementById('b-a').dataset.card, 'outline', 'the cards repaint')
    redo()
    assert.eq(canvasMeta.cardStyle, 'plain')
    setCanvasCardStyle('plain')
    assert.eq(history(), 1, 'picking the style already set is no step')
  })

  it('Spotlight is one undo step, and undo turns it off again', () => {
    reset(); block('a', { highlight: 'alert' })
    setSpotlight(true)
    assert.eq(history(), 1)
    assert.ok(document.body.classList.contains('spotlight'))
    undo()
    assert.eq(canvasMeta.spotlight, false)
    assert.ok(!document.body.classList.contains('spotlight'))
  })

  it('an ordinary undo leaves the title alone; a replace step carries the whole framing', () => {
    reset(); block('a')
    canvasMeta.title = 'Before'
    snapshot()
    canvasMeta.title = 'Renamed'
    undo()
    assert.eq(canvasMeta.title, 'Renamed', 'a block edit\'s undo does not revert a rename')
    snapshot({ framing: true })
    canvasMeta.title = 'Incoming'
    undo()
    assert.eq(canvasMeta.title, 'Renamed', 'undoing a replace brings the title back')
    redo()
    assert.eq(canvasMeta.title, 'Incoming')
    canvasMeta.title = ''
  })
})

// ── A modal dialog owns the keyboard ────────────────────────

describe('Integration: global shortcuts stop behind a modal dialog', () => {
  it('Delete does nothing while a modal dialog is open, and works once it closes', () => {
    reset(); setupKeyboardShortcuts()
    block('a')
    selectBlock('a')
    const dlg = document.createElement('dialog')
    dlg.innerHTML = '<button type="button">OK</button>'
    document.body.appendChild(dlg)
    try {
      dlg.showModal()
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
      assert.ok(state.blocks.a, 'the dialog kept the key')
      dlg.close()
      document.activeElement?.blur?.()
      selectBlock('a')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
      assert.ok(!state.blocks.a, 'with the dialog gone, Delete deletes')
    } finally { dlg.remove() }
  })
})

describe('Integration: paste stops behind a modal dialog or an open menu (QA)', () => {
  const paste = text => {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    // Firefox drops clipboardData given to the constructor (a real paste
    // carries it); set it on the event so every engine runs the same test.
    Object.defineProperty(ev, 'clipboardData', { value: dt })
    document.body.dispatchEvent(ev)
  }

  it('Cmd+V adds nothing behind the incoming-link dialog or under a menu, and works otherwise', () => {
    reset(); setupPasteHandler()
    block('a')
    document.activeElement?.blur?.()
    const count = () => Object.keys(state.blocks).length
    const dlg = document.createElement('dialog')
    dlg.innerHTML = '<button type="button">Open as a new map</button>'
    document.body.appendChild(dlg)
    try {
      dlg.showModal()
      paste('Goal: one\nRisk: two')
      assert.eq(count(), 1, 'the dialog says the map stays as it is, and it does')
    } finally { dlg.close(); dlg.remove() }
    document.activeElement?.blur?.()
    openMenu([{ label: 'Add here' }], { x: 40, y: 40 })
    try {
      document.activeElement?.blur?.()
      paste('Goal: one')
      assert.eq(count(), 1, 'an open menu owns the keyboard too')
    } finally { closeMenus() }
    document.activeElement?.blur?.()
    paste('Goal: one')
    assert.eq(count(), 2, 'with nothing open, paste still makes blocks')
    reset()
  })
})

// ── One align rule ──────────────────────────────────────────

describe('Integration: one align and distribute rule', () => {
  it('moves as one undo step, takes none when nothing moves, and keeps the gap marks', () => {
    reset()
    block('a', { x: 10, y: 10 }); block('b', { x: 300, y: 200 })
    runGapDetection()
    const gapOf = id => [...document.getElementById('b-' + id).classList].filter(c => c.startsWith('gap-'))
    const before = gapOf('b')
    assert.eq(arrangeSelection('align', ['a', 'b'], 'left'), 1)
    assert.eq(state.blocks.b.x, 10)
    assert.eq(history(), 1)
    assert.deepEq(gapOf('b'), before)
    assert.eq(arrangeSelection('align', ['a', 'b'], 'left'), 0, 'already aligned')
    assert.eq(history(), 1, 'no step for a no-op')
    assert.eq(arrangeSelection('distribute', ['a', 'b'], 'h'), 0, 'distribute needs three')
    assert.eq(history(), 1)
  })
})

// ── Exports ─────────────────────────────────────────────────

describe('Integration: exports', () => {
  it('a blank question is never printed, in the prompt or the Markdown', () => {
    reset()
    block('a', { title: 'Ship it', questions: [{ text: '' }, { text: 'Who signs off?' }, { text: '   ' }] })
    assert.eq(askedQuestions(state.blocks.a).length, 1)
    const prompt = generatePrompt(), md = buildMarkdown()
    assert.includes(prompt, 'Who signs off?')
    assert.includes(md, 'Who signs off?')
    assert.ok(!/^\s*- \s*$/m.test(prompt), 'no bare bullet in the prompt')
    assert.ok(!/^\s*- \s*$/m.test(md), 'no bare bullet in the Markdown')
  })

  it('templates and imports create connections at the new-connection weight', () => {
    reset()
    applyTemplate(TEMPLATES[0])
    assert.ok(state.arrows.length > 0)
    assert.ok(state.arrows.every(a => a.weight === DEFAULT_ARROW_WEIGHT), 'template arrows')
    const mm = parseMermaid('flowchart LR\n  a["A"] --> b["B"]\n  b ==> c["C"]').payload.arrows
    assert.eq(mm[0].weight, DEFAULT_ARROW_WEIGHT, 'a plain Mermaid link')
    assert.eq(mm[1].weight, 3.5, 'a thick Mermaid link keeps its weight')
    const jc = fromJsonCanvas({ nodes: [{ id: 'n1', type: 'text', text: 'A', x: 0, y: 0, width: 200, height: 60 },
      { id: 'n2', type: 'text', text: 'B', x: 300, y: 0, width: 200, height: 60 }],
      edges: [{ id: 'e1', fromNode: 'n1', toNode: 'n2' }] }).payload.arrows
    assert.eq(jc[0].weight, DEFAULT_ARROW_WEIGHT, 'a JSON Canvas edge')
    reset()
  })

  it('the image export draws the card the canvas draws', () => {
    reset()
    block('a', {
      type: 'requirement', title: 'Checkout under two seconds', priority: 'high', status: 'in-progress',
      description: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen ' +
        'seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix twentyseven',
    })
    const doc = new DOMParser().parseFromString(buildSvg().svg, 'image/svg+xml')
    const texts = [...doc.querySelectorAll('text')]
    const label = texts.find(t => t.textContent === TYPES.requirement.label.toUpperCase())
    assert.ok(label, 'the type label')
    assert.neq(label.getAttribute('fill'), TYPES.requirement.color, 'in neutral ink, not the type colour')
    assert.eq(label.getAttribute('font-size'), '10')
    const dot = doc.querySelector('circle')
    assert.eq(dot?.getAttribute('fill'), TYPES.requirement.color, 'the colour is the dot beside it')
    const title = texts.find(t => t.textContent.startsWith('Checkout'))
    assert.eq(title.getAttribute('font-size'), '14')
    const desc = texts.filter(t => t.getAttribute('font-size') === '12')
    assert.eq(desc.length, 3, 'the description clamps to three lines')
    assert.ok(desc[2].textContent.endsWith('…'), 'with an ellipsis where it was cut')
    const badges = texts.filter(t => t.getAttribute('font-size') === '10' && t !== label).map(t => t.textContent)
    assert.includes(badges, 'HIGH')
    assert.ok(badges.some(t => t.includes('Progress') || t.includes('progress')), 'status badge')
    reset()
  })
})

// ── Two tabs ────────────────────────────────────────────────

describe('Integration: the camera stays with this tab\'s map', () => {
  it('saves the view under the map this tab has open, not the one another tab moved to', () => {
    const CUR = 'pathfinder-map-current'
    const keys = [CUR, 'pathfinder-view:mine', 'pathfinder-view:theirs']
    const saved = keys.map(k => { try { return localStorage.getItem(k) } catch (_) { return null } })
    const wasEmbed = ui.embed
    try {
      ui.readOnly = false; ui.embed = false
      forgetTabMap()
      localStorage.setItem(CUR, 'theirs')
      notePointerMove({ key: CUR, oldValue: 'mine', newValue: 'theirs', storageArea: localStorage })
      localStorage.removeItem('pathfinder-view:mine'); localStorage.removeItem('pathfinder-view:theirs')
      saveView()
      assert.ok(localStorage.getItem('pathfinder-view:mine'), 'this tab\'s map keeps its camera')
      assert.eq(localStorage.getItem('pathfinder-view:theirs'), null, 'the other tab\'s map is left alone')
      assert.eq(JSON.parse(localStorage.getItem('pathfinder-view:mine')).zoom, view.zoom)
    } finally {
      forgetTabMap()
      ui.embed = wasEmbed
      keys.forEach((k, i) => { try { saved[i] === null ? localStorage.removeItem(k) : localStorage.setItem(k, saved[i]) } catch (_) {} })
    }
  })
})

// ── Dragging lands on whole pixels ──────────────────────────

describe('Integration: a drag lands on whole pixels', () => {
  it('a card dragged at a fractional zoom ends at integer coordinates, and releases import pins', () => {
    reset(); setupCanvasPointerEvents()
    block('a', { x: 40, y: 40 }); block('b', { x: 500, y: 40 })
    state.arrows.push({ id: 'ab', from: 'a', to: 'b', style: 'routed', fromPort: 'right', toPort: 'left', portsBy: 'import' })
    const saved = { ...view }
    const ptr = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true,
      pointerId: 9, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, isPrimary: true, pointerType: 'mouse' }))
    try {
      view.zoom = 0.44
      const el = document.querySelector('#b-a .block-title')
      ptr(el, 'pointerdown', 100, 100)
      ptr(el, 'pointermove', 107, 103)
      ptr(el, 'pointermove', 131, 117)
      ptr(el, 'pointerup', 131, 117)
      const b = state.blocks.a
      assert.ok(b.x !== 40, 'it moved')
      assert.eq(b.x, Math.round(b.x)); assert.eq(b.y, Math.round(b.y))
      assert.ok(!state.arrows[0].portsBy && !state.arrows[0].fromPort, 'the import pins were released')
    } finally { Object.assign(view, saved) }
  })
})

// ── Types awaiting a check, from the Attention tab ──────────

describe('Integration: Attention keeps every automatic type in one step', () => {
  it('the type-check finding offers Keep all, which settles each check by the shared rule', () => {
    reset()
    block('a', { type: 'risk', typeCheck: true, typeHint: 'hazard' }); block('b', { type: 'metric', typeCheck: true, x: 400 })
    const row = attentionItems(state.blocks, state.arrows).find(i => i.finding === 'type-check')
    assert.ok(row, 'the finding is listed')
    assert.ok(runAttentionAction('confirm-types', row))
    assert.ok(!('typeCheck' in state.blocks.a) && !('typeCheck' in state.blocks.b))
    assert.ok(!('typeHint' in state.blocks.a))
    assert.eq(state.blocks.a.type, 'risk', 'the type it was given stays')
    assert.eq(history(), 1, 'one undo step')
    undo()
    assert.ok(state.blocks.a.typeCheck && state.blocks.b.typeCheck, 'undo brings the checks back')
  })
})
