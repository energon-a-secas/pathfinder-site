// ============================================================
//  foundation.test.js -- pointer capture, the dot-voting gate,
//  double-click routing, preferences and the mutation layer
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, selection, pointer, view, getUndoHistory, getRedoFuture,
         snapshot, snapshotOnce, resetSnapshotToken } from '../js/state.js'
import { $, getBlockVotes } from '../js/utils.js'
import { renderBlock, renderAllBlocks, undo, deselectAll, selectArrow, selectBlock,
         mutateBlock, mutateBlocks, mutateArrow, blockDecorators } from '../js/render.js'
import { setupCanvasPointerEvents, setupArrowEvents, setupKeyboardShortcuts,
         setupTabNavigation } from '../js/events.js'
import { setupContextMenu } from '../js/context-menu.js'
import { setVotingMode, isVotingMode } from '../js/voting.js'
import { getPref, setPref, applyPrefs, PREF_DEFAULTS } from '../js/prefs.js'
import { isInlineEditing, commitInlineEdit, startInlineEdit } from '../js/inline-edit.js'
import { wireBlockTextInputs } from '../js/inspector.js'
import { startArrowLabelEdit } from '../js/arrow-edit.js'
import { chrome } from '../js/chrome.js'

function reset() {
  if (isInlineEditing()) commitInlineEdit()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  pointer.ix = null
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: 'desc', notes: '',
    x: 40, y: 40, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, ...extra }
  renderBlock(id)
}

let wired = false
function wire() {
  if (wired) return
  wired = true
  setupArrowEvents()
  setupCanvasPointerEvents()
  setupContextMenu()
}

// Votes live in the URL hash; leave the test page's URL as it was found.
const clearHash = () => history.replaceState(null, '', location.pathname + location.search)

const ptr = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: 7, button: 0, buttons: type === 'pointerup' ? 0 : 1,
  clientX: x, clientY: y, isPrimary: true, ...extra }))

// Count setPointerCapture calls on the viewport for the duration of fn.
function spyCapture(fn) {
  const vp = $.canvasViewport()
  const calls = []
  vp.setPointerCapture = pid => calls.push(pid)
  try { fn() } finally { delete vp.setPointerCapture }
  return calls
}

describe('Pointer capture: only once a press really moves', () => {
  it('a press and release without movement never captures', () => {
    wire(); reset(); block('a')
    const vp = $.canvasViewport()
    const calls = spyCapture(() => {
      ptr(vp, 'pointerdown', 100, 100)
      ptr(vp, 'pointerup', 100, 100)
      const title = document.querySelector('#b-a .block-title')
      ptr(title, 'pointerdown', 50, 50)
      ptr(title, 'pointermove', 51, 51)
      ptr(title, 'pointerup', 51, 51)
    })
    assert.eq(calls.length, 0)
    assert.eq(pointer.ix, null)
  })

  it('a drag past 3px captures once', () => {
    wire(); reset(); block('a')
    const vp = $.canvasViewport()
    const calls = spyCapture(() => {
      ptr(vp, 'pointerdown', 100, 100)
      ptr(vp, 'pointermove', 102, 101)
      ptr(vp, 'pointermove', 110, 100)
      ptr(vp, 'pointermove', 130, 100)
      ptr(vp, 'pointerup', 130, 100)
    })
    assert.deepEq(calls, [7])
  })

  it('a card drag past 3px captures and moves the card', () => {
    wire(); reset(); block('a')
    const title = document.querySelector('#b-a .block-title')
    const calls = spyCapture(() => {
      ptr(title, 'pointerdown', 50, 50)
      ptr(title, 'pointermove', 70, 50)
      ptr(title, 'pointerup', 70, 50)
    })
    assert.eq(calls.length, 1)
    assert.ok(state.blocks.a.x > 40, 'the card moved')
  })

  it('a press inside text being edited does not drag the card', () => {
    wire(); reset(); block('a')
    startInlineEdit('a', 'title')
    const title = document.querySelector('#b-a .block-title')
    const calls = spyCapture(() => {
      ptr(title, 'pointerdown', 50, 50)
      ptr(title, 'pointermove', 90, 50)
      ptr(title, 'pointerup', 90, 50)
    })
    assert.eq(calls.length, 0)
    assert.eq(state.blocks.a.x, 40)
    assert.ok(isInlineEditing(), 'still editing')
    commitInlineEdit()
  })

  it('presses on canvas overlay UI are ignored entirely', () => {
    wire(); reset()
    const vp = $.canvasViewport()
    const overlay = document.createElement('div')
    overlay.setAttribute('data-canvas-ui', '')
    vp.appendChild(overlay)
    const calls = spyCapture(() => {
      ptr(overlay, 'pointerdown', 10, 10)
      ptr(overlay, 'pointermove', 60, 60)
    })
    overlay.remove()
    assert.eq(calls.length, 0)
    assert.eq(pointer.ix, null)
  })

  it('a release outside the viewport still ends the interaction', () => {
    wire(); reset()
    const vp = $.canvasViewport()
    ptr(vp, 'pointerdown', 100, 100)
    assert.ok(pointer.ix, 'a pan started')
    ptr(document.body, 'pointerup', 100, 100)
    assert.eq(pointer.ix, null)
  })
})

describe('Dot voting is a mode', () => {
  it('a click on a card does not vote while the mode is off', () => {
    wire(); reset(); block('a')
    clearHash()
    assert.ok(!isVotingMode())
    document.querySelector('#b-a .block-desc').click()
    assert.eq(getBlockVotes('a').length, 0)
    assert.ok(!/votes=/.test(location.hash))
  })

  it('with the mode on a click adds a dot, and the banner is canvas UI', () => {
    wire(); reset(); block('a')
    clearHash()
    assert.ok(setVotingMode(true))
    try {
      assert.ok(document.body.classList.contains('voting-mode'))
      const banner = document.getElementById('votingBanner')
      assert.ok(banner && banner.hasAttribute('data-canvas-ui'))
      document.querySelector('#b-a .block-desc').click()
      assert.eq(getBlockVotes('a').length, 1)
      assert.match(banner.textContent, /4 left/)
    } finally {
      setVotingMode(false)
      clearHash()
    }
    assert.eq(document.getElementById('votingBanner'), null)
    assert.ok(!document.body.classList.contains('voting-mode'))
  })

  it('is refused in read-only and embed views', () => {
    ui.readOnly = true
    try { assert.eq(setVotingMode(true), false) } finally { ui.readOnly = false }
    assert.ok(!isVotingMode())
  })

  // A real click is pointerdown, pointerup, then click. Every pointerup used
  // to stamp the card as "just dragged", and the click that follows always
  // lands inside that 200ms window, so no real click ever voted.
  it('a real press, release and click on a card adds a dot; a drag does not', () => {
    wire(); reset(); block('a')
    clearHash()
    setVotingMode(true)
    const dots = () => getBlockVotes('a').reduce((n, v) => n + v.dots, 0)
    try {
      const desc = document.querySelector('#b-a .block-desc')
      ptr(desc, 'pointerdown', 60, 60)
      ptr(desc, 'pointerup', 60, 60)
      desc.click()
      assert.eq(dots(), 1, 'the click voted')
      ptr(desc, 'pointerdown', 60, 60)
      ptr(desc, 'pointermove', 90, 60)
      ptr(desc, 'pointerup', 90, 60)
      desc.click()
      assert.eq(dots(), 1, 'the click that ends a drag does not vote')
    } finally {
      setVotingMode(false)
      clearHash()
    }
  })

  it('every dot is kept: a second card gets its own, and the hash keeps one votes segment', () => {
    wire(); reset(); block('a'); block('b', { x: 400 })
    history.replaceState(null, '', location.pathname + location.search + '#s=abc')
    setVotingMode(true)
    try {
      document.querySelector('#b-a .block-desc').click()
      document.querySelector('#b-b .block-desc').click()
      document.querySelector('#b-b .block-desc').click()
      assert.eq(getBlockVotes('a').reduce((n, v) => n + v.dots, 0), 1)
      assert.eq(getBlockVotes('b').reduce((n, v) => n + v.dots, 0), 2)
      assert.eq((location.hash.match(/votes=/g) || []).length, 1, location.hash)
      assert.ok(location.hash.startsWith('#s=abc&votes='), 'other hash segments are left alone')
      assert.match(document.getElementById('votingBanner').textContent, /2 left/)
    } finally {
      setVotingMode(false)
      clearHash()
    }
  })
})

describe('Double-click and right-click routing', () => {
  it('double-clicking a card title starts inline editing', () => {
    wire(); reset(); block('a')
    const title = document.querySelector('#b-a .block-title')
    title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }))
    assert.ok(isInlineEditing())
    commitInlineEdit()
  })

  it('double-clicking empty canvas opens the add menu, which includes assumption and risk', () => {
    wire(); reset()
    const root = $.canvasRoot()
    root.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }))
    const menu = document.querySelector('.ctx-add-menu')
    assert.ok(menu, 'add menu open')
    const types = [...menu.querySelectorAll('[data-add-type]')].map(b => b.dataset.addType)
    assert.includes(types, 'assumption')
    assert.includes(types, 'risk')
    menu.querySelector('[data-add-type="risk"]').click()
    assert.eq(document.querySelector('.ctx-add-menu'), null)
    const made = Object.values(state.blocks)
    assert.eq(made.length, 1)
    assert.eq(made[0].type, 'risk')
    assert.ok(isInlineEditing(), 'the new block opens in title editing')
    commitInlineEdit()
  })

  it('read-only double-click does nothing', () => {
    wire(); reset(); block('a')
    ui.readOnly = true
    try {
      document.querySelector('#b-a .block-title').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
      $.canvasRoot().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    } finally { ui.readOnly = false }
    assert.ok(!isInlineEditing())
    assert.eq(document.querySelector('.ctx-add-menu'), null)
  })

  it('right-clicking a connection selects it instead of offering to add a block', () => {
    wire(); reset()
    block('a'); block('b', { x: 400 })
    state.arrows.push({ id: 'ab', from: 'a', to: 'b', style: 'curved', bidirectional: false, color: null, weight: 2, fromPort: null, toPort: null })
    renderAllBlocks()
    // The test page keeps its arrow layer outside the viewport, so build a
    // connection where the app has it: inside the canvas.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.dataset.aid = 'ab'
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    g.appendChild(path); svg.appendChild(g)
    $.canvasRoot().appendChild(svg)
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 })
    path.dispatchEvent(ev)
    svg.remove()
    assert.eq(document.querySelector('.ctx-add-menu'), null)
    assert.eq(selection.arrowId, 'ab')
    assert.ok(ev.defaultPrevented)
    deselectAll()
  })

  // Selecting a routed connection deselects the card it leaves; the card
  // shrinks, the line re-routes away from the pointer, and the second press
  // of the double-click lands on empty canvas.
  it('a double-click that began on a connection edits it even when the line moved away', () => {
    wire(); reset()
    block('a'); block('b', { x: 400 })
    state.arrows.push({ id: 'ab', from: 'a', to: 'b', style: 'routed', bidirectional: false, color: null, weight: 2, fromPort: null, toPort: null })
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.dataset.aid = 'ab'
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    g.appendChild(path)
    $.arrowsGroup().appendChild(g)
    try {
      ptr(path, 'pointerdown', 777, 555)
      ptr(path, 'pointerup', 777, 555)
      assert.eq(selection.arrowId, 'ab')
      const vp = $.canvasViewport()
      ptr(vp, 'pointerdown', 778, 555)
      assert.eq(selection.arrowId, 'ab', 'the second press keeps the connection selected')
      assert.eq(pointer.ix, null, 'and starts no pan')
      ptr(vp, 'pointerup', 778, 555)
      $.canvasRoot().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 778, clientY: 555 }))
      assert.eq(document.querySelector('.ctx-add-menu'), null, 'no add menu')
      assert.eq(selection.arrowId, 'ab', 'the label edit is for that connection')
    } finally {
      g.remove()
      deselectAll()
    }
  })

  it('the double-click add menu is canvas UI: keys stay in it and a wheel closes it', () => {
    wire(); reset()
    $.canvasRoot().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }))
    const menu = document.querySelector('.ctx-add-menu')
    assert.ok(menu, 'add menu open')
    assert.ok(menu.hasAttribute('data-canvas-ui'))
    let leaked = 0
    const spy = () => leaked++
    document.addEventListener('keydown', spy)
    try {
      menu.querySelector('.ctx-item').dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, cancelable: true }))
    } finally { document.removeEventListener('keydown', spy) }
    assert.eq(leaked, 0, 'H never reached the canvas shortcuts')
    document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 40 }))
    assert.eq(document.querySelector('.ctx-add-menu'), null, 'a wheel outside closes it')
  })

  it('the connection label fallback brings a hidden panel back before focusing its field', () => {
    reset(); block('a'); block('b', { x: 400 })
    state.arrows.push({ id: 'ab', from: 'a', to: 'b', style: 'routed', bidirectional: false, color: null, weight: 2, fromPort: null, toPort: null })
    const panel = document.createElement('div')
    panel.id = 'rightPanel'; panel.className = 'collapsed'
    const reopen = document.createElement('button')
    reopen.id = 'panelReopenBtn'
    reopen.addEventListener('click', () => panel.classList.remove('collapsed'))
    document.body.append(panel, reopen)
    const saved = { ...chrome }
    chrome.frame = false; chrome.panels = false   // Zen
    try {
      assert.ok(startArrowLabelEdit('ab'))
      assert.eq(selection.arrowId, 'ab')
      assert.ok(chrome.panels, 'Zen left so the panel shows')
      assert.ok(!panel.classList.contains('collapsed'), 'the collapsed panel reopened')
    } finally {
      panel.remove(); reopen.remove()
      Object.assign(chrome, saved)
      delete document.body.dataset.chrome; delete document.body.dataset.zen
      deselectAll()
    }
  })
})

describe('Pointer robustness', () => {
  it('a drag whose first move already left the viewport still captures and pans', () => {
    wire(); reset()
    const vp = $.canvasViewport()
    const saved = { ...view }
    view.panX = 0; view.panY = 0
    try {
      const calls = spyCapture(() => {
        ptr(vp, 'pointerdown', 100, 100)
        ptr(document.body, 'pointermove', 150, 100)
      })
      assert.deepEq(calls, [7], 'captured from the document-level move')
      assert.eq(view.panX, 50, 'and panned')
      ptr(document.body, 'pointerup', 150, 100)
      assert.eq(pointer.ix, null)
    } finally { Object.assign(view, saved) }
  })

  it('a hovering mouse is not a second finger: a touch press pans instead of pinching', () => {
    wire(); reset()
    const vp = $.canvasViewport()
    vp.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 31, pointerType: 'mouse', buttons: 0, clientX: 10, clientY: 10 }))
    ptr(vp, 'pointerdown', 100, 100, { pointerType: 'touch' })
    try {
      assert.ok(pointer.ix && pointer.ix.type === 'pan', 'one finger pans')
    } finally { ptr(vp, 'pointerup', 100, 100, { pointerType: 'touch' }) }
  })

  it('a mouse move with no button held ends a press whose pointerup was lost', () => {
    wire(); reset()
    const vp = $.canvasViewport()
    const saved = { ...view }
    try {
      ptr(vp, 'pointerdown', 100, 100, { pointerType: 'mouse' })
      ptr(vp, 'pointermove', 140, 100, { pointerType: 'mouse' })
      assert.ok(pointer.ix, 'panning')
      const px = view.panX
      vp.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, pointerType: 'mouse', buttons: 0, clientX: 220, clientY: 100 }))
      assert.eq(pointer.ix, null, 'the press ended')
      assert.eq(view.panX, px, 'the hover did not keep panning')
    } finally { Object.assign(view, saved) }
  })
})

describe('Focus and keys on cards', () => {
  it('focus from a press does not recentre the view; keyboard focus still does', () => {
    wire(); setupTabNavigation(); reset(); block('a')
    const el = document.getElementById('b-a')
    const saved = { ...view }
    const focusin = (extra = {}) => el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, ...extra }))
    try {
      view.panX = 0; view.panY = 0
      ptr(el, 'pointerdown', 50, 50)
      focusin()
      assert.eq(view.panX, 0, 'no pan while pressed')
      ptr(el, 'pointerup', 50, 50)
      focusin()
      assert.eq(view.panX, 0, 'no pan just after the release (touch focuses then)')
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
      focusin({ relatedTarget: el.querySelector('.block-title') })
      assert.eq(view.panX, 0, 'focus moving within one card is not arriving at it')
      focusin()
      assert.ok(view.panX !== 0 || view.panY !== 0, 'keyboard focus recentres a card off screen')
    } finally { Object.assign(view, saved) }
  })

  it('Enter or Space on a button inside a card presses the button, it does not edit or select', () => {
    wire(); setupKeyboardShortcuts(); setupTabNavigation(); reset(); block('a')
    const vp = $.canvasViewport()
    const prev = vp.style.display
    vp.style.display = 'block'
    const saved = { ...view }
    try {
      selectBlock('a')
      const btn = document.querySelector('#b-a .block-collapse-btn')
      btn.focus()
      assert.eq(document.activeElement, btn)
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      btn.dispatchEvent(enter)
      assert.ok(!isInlineEditing(), 'no title edit on the selected card')
      assert.ok(!enter.defaultPrevented, 'the button keeps its Enter')
      deselectAll()
      btn.focus()
      const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
      btn.dispatchEvent(space)
      assert.ok(!space.defaultPrevented, 'the button keeps its Space')
      assert.eq(selection.blockId, null, 'the card was not selected instead')
    } finally {
      if (isInlineEditing()) commitInlineEdit()
      vp.style.display = prev
      Object.assign(view, saved)
    }
  })
})

describe('Inspector text fields are undoable (snapshotOnce)', () => {
  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })) }

  it('a typing burst in the title is one undo step; leaving the field ends it', () => {
    reset(); block('a', { title: 'Original' })
    wireBlockTextInputs()
    selectBlock('a')
    const input = $.inspTitle()
    type(input, 'OriginalX')
    type(input, 'OriginalXY')
    assert.eq(state.blocks.a.title, 'OriginalXY')
    assert.eq(getUndoHistory().length, 1, 'one step for the burst')
    input.dispatchEvent(new Event('change'))
    type(input, 'OriginalXYZ')
    assert.eq(getUndoHistory().length, 2, 'a new burst after leaving the field')
    undo()
    assert.eq(state.blocks.a.title, 'OriginalXY')
    undo()
    assert.eq(state.blocks.a.title, 'Original')
    deselectAll()
  })

  it('each field is its own step, and read-only writes nothing', () => {
    reset(); block('a', { title: 'T', description: 'D', notes: 'N' })
    wireBlockTextInputs()
    selectBlock('a')
    type($.inspDesc(), 'D2')
    type($.inspNotes(), 'N2')
    assert.eq(getUndoHistory().length, 2)
    undo()
    assert.eq(state.blocks.a.notes, 'N')
    assert.eq(state.blocks.a.description, 'D2')
    ui.readOnly = true
    try { type($.inspTitle(), 'nope') } finally { ui.readOnly = false }
    assert.eq(state.blocks.a.title, 'T')
    deselectAll()
  })
})

describe('Preferences (prefs.js)', () => {
  it('motion is off by default and toggles body.motion-on', () => {
    const saved = localStorage.getItem('pathfinder-prefs')
    try {
      localStorage.removeItem('pathfinder-prefs')
      assert.eq(PREF_DEFAULTS.motion, false)
      assert.eq(getPref('motion'), false)
      applyPrefs()
      assert.ok(!document.body.classList.contains('motion-on'))
      let seen = null
      const on = e => { seen = e.detail }
      window.addEventListener('pf:pref-changed', on)
      setPref('motion', true)
      window.removeEventListener('pf:pref-changed', on)
      assert.ok(document.body.classList.contains('motion-on'))
      assert.deepEq(seen, { key: 'motion', value: true })
      assert.eq(JSON.parse(localStorage.getItem('pathfinder-prefs')).motion, true)
      setPref('motion', false)
      assert.ok(!document.body.classList.contains('motion-on'))
    } finally {
      if (saved === null) localStorage.removeItem('pathfinder-prefs')
      else localStorage.setItem('pathfinder-prefs', saved)
      applyPrefs()
    }
  })

  it('an embed never writes preferences to storage', () => {
    const saved = localStorage.getItem('pathfinder-prefs')
    try {
      localStorage.removeItem('pathfinder-prefs')
      ui.embed = true
      setPref('motion', true)
      assert.eq(localStorage.getItem('pathfinder-prefs'), null)
      assert.eq(getPref('motion'), true, 'the embed still sees its own choice')
    } finally {
      ui.embed = false
      if (saved === null) localStorage.removeItem('pathfinder-prefs')
      else localStorage.setItem('pathfinder-prefs', saved)
      applyPrefs()
    }
  })
})

describe('Mutation layer', () => {
  it('mutateBlock only snapshots when asked', () => {
    reset(); block('a')
    mutateBlock('a', { title: 'x' })
    assert.eq(getUndoHistory().length, 0)
    mutateBlock('a', { title: 'y' }, { undo: true })
    assert.eq(getUndoHistory().length, 1)
    undo()
    assert.eq(state.blocks.a.title, 'x')
  })

  it('mutateBlocks changes many blocks in one undo step', () => {
    reset(); block('a'); block('b'); block('c')
    const n = mutateBlocks(['a', 'b', 'missing'], b => ({ priority: b.id === 'a' ? 'high' : 'low' }))
    assert.eq(n, 2)
    assert.eq(state.blocks.a.priority, 'high')
    assert.eq(state.blocks.b.priority, 'low')
    assert.eq(state.blocks.c.priority, null)
    assert.eq(getUndoHistory().length, 1)
    undo()
    assert.eq(state.blocks.a.priority, null)
    assert.eq(state.blocks.b.priority, null)
  })

  it('mutateArrow is one undo step and drops tidy provenance when an end is re-pinned', () => {
    reset(); block('a'); block('b', { x: 400 })
    state.arrows.push({ id: 'ab', from: 'a', to: 'b', style: 'routed', bidirectional: false, color: null,
      weight: 2, fromPort: 'right', toPort: 'left', portsBy: 'tidy' })
    mutateArrow('ab', { color: '#f87171' })
    assert.eq(state.arrows[0].portsBy, 'tidy', 'a colour change keeps the pins as they were')
    mutateArrow('ab', { fromPort: 'bottom' })
    assert.eq(state.arrows[0].fromPort, 'bottom')
    assert.ok(!('portsBy' in state.arrows[0]))
    assert.eq(getUndoHistory().length, 2)
    undo()
    assert.eq(state.arrows[0].portsBy, 'tidy')
    assert.eq(state.arrows[0].fromPort, 'right')
  })

  it('mutateArrow keeps provenance passed explicitly (reverse)', () => {
    reset(); block('a'); block('b', { x: 400 })
    state.arrows.push({ id: 'ab', from: 'a', to: 'b', style: 'routed', bidirectional: false, color: null,
      weight: 2, fromPort: 'right', toPort: 'left', portsBy: 'tidy' })
    mutateArrow('ab', { from: 'b', to: 'a', fromPort: 'left', toPort: 'right', portsBy: 'tidy' })
    assert.eq(state.arrows[0].portsBy, 'tidy')
    assert.eq(state.arrows[0].from, 'b')
    assert.eq(mutateArrow('missing', { color: null }), null)
  })

  it('mutateArrow re-renders the inspector only for the selected arrow', () => {
    reset(); block('a'); block('b', { x: 400 })
    state.arrows.push({ id: 'ab', from: 'a', to: 'b', style: 'routed', bidirectional: false, color: null, weight: 2, fromPort: null, toPort: null })
    selectArrow('ab')
    mutateArrow('ab', { bidirectional: true })
    assert.eq(state.arrows[0].bidirectional, true)
    deselectAll()
  })

  it('snapshotOnce coalesces a burst with one token; snapshot() ends the burst', () => {
    reset(); block('a')
    assert.ok(snapshotOnce('insp-title:a'))
    assert.ok(!snapshotOnce('insp-title:a'))
    assert.ok(!snapshotOnce('insp-title:a'))
    assert.eq(getUndoHistory().length, 1)
    assert.ok(snapshotOnce('insp-desc:a'), 'another field is another step')
    snapshot()
    assert.ok(snapshotOnce('insp-desc:a'), 'a plain snapshot ends the burst')
    resetSnapshotToken()
    assert.ok(snapshotOnce('insp-desc:a'))
    assert.eq(getUndoHistory().length, 5)
  })

  it('undo ends the burst, so typing again is its own step', () => {
    reset(); block('a')
    snapshotOnce('t'); mutateBlock('a', { title: 'typed' })
    undo()
    assert.ok(snapshotOnce('t'))
  })

  it('renderBlock runs every registered block decorator', () => {
    reset()
    const seen = []
    const paint = (b, el) => seen.push([b.id, el.id])
    blockDecorators.push(paint)
    try { block('a') } finally { blockDecorators.splice(blockDecorators.indexOf(paint), 1) }
    assert.deepEq(seen, [['a', 'b-a']])
  })
})
