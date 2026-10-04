// ============================================================
//  navigation.test.js -- keyboard traversal, zoom, panning and
//  quick create (navigation.js, zoom-controls.js and the
//  navigation handlers in events.js)
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, selection, pointer, view, getUndoHistory, getRedoFuture,
         resetSnapshotToken } from '../js/state.js'
import { $, TYPES, MIN_ZOOM, MAX_ZOOM, DEFAULT_WIDTH } from '../js/utils.js'
import { renderBlock, undo, deselectAll, selectBlock } from '../js/render.js'
import { setupCanvasPointerEvents, setupArrowEvents, setupKeyboardShortcuts,
         setupTabNavigation } from '../js/events.js'
import { isInlineEditing, commitInlineEdit } from '../js/inline-edit.js'
import { closeMenus, isMenuOpen } from '../js/menu.js'
import { suggestedNextTypes } from '../js/create.js'
import { readingOrder, nearestInDirection, describeBlock, quickCreateType,
         facingSide, ROW_TOLERANCE, openQuickCreate, revealShift, flushNudge, NUDGE_SETTLE_MS } from '../js/navigation.js'
import { routeStats } from '../js/arrow-routes.js'
import { renderArrows, applyTransform } from '../js/canvas.js'
import { selectArrow } from '../js/render.js'
import { wheelZoomFactor, nextZoomStop, ZOOM_STOPS, WHEEL_MAX_STEP, zoomToSelection,
         contentInView, refreshBackToContent, openZoomMenu, setupZoomControls } from '../js/zoom-controls.js'
import { SHORTCUTS, buildShortcutGrid, openShortcuts, setupShortcutOverlay } from '../js/ui-panels.js'

// ── Helpers ─────────────────────────────────────────────────
function reset() {
  if (isInlineEditing()) commitInlineEdit()
  closeMenus()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  ui.snapToGrid = false
  pointer.ix = null
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
  // Single-key shortcuts need the canvas (or nothing) to have focus.
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '',
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
  setupKeyboardShortcuts()
  setupTabNavigation()
}

const key = (k, extra = {}, target = document.activeElement || document.body) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })
  target.dispatchEvent(ev)
  return ev
}

const ptr = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: 7, button: 0, buttons: type === 'pointerup' ? 0 : 1,
  clientX: x, clientY: y, isPrimary: true, pointerType: 'mouse', ...extra }))

// The test page hides the viewport; focus and measuring need it laid out.
function withViewport(fn) {
  const vp = $.canvasViewport()
  const prevCss = vp.style.cssText
  const prevTab = vp.getAttribute('tabindex')
  const saved = { ...view }
  vp.style.cssText = 'display:block;position:relative;width:800px;height:600px;overflow:hidden'
  vp.tabIndex = 0   // as in index.html
  const done = () => {
    vp.style.cssText = prevCss
    if (prevTab == null) vp.removeAttribute('tabindex'); else vp.setAttribute('tabindex', prevTab)
    Object.assign(view, saved)
  }
  let out
  try { out = fn(vp) } catch (err) { done(); throw err }
  if (out && typeof out.then === 'function') return out.finally(done)
  done()
  return out
}

function withView(fn) {
  const saved = { ...view }
  try { return fn() } finally { Object.assign(view, saved) }
}

// ── navigation.js: pure decisions ───────────────────────────
describe('Reading order and direction (navigation.js)', () => {
  it('reading order reads rows top to bottom, left to right, with a row tolerance', () => {
    const blocks = {
      c: { id: 'c', x: 0,   y: 200 },
      b: { id: 'b', x: 300, y: 12 },    // 12px lower than a: same row
      a: { id: 'a', x: 0,   y: 0 },
      d: { id: 'd', x: 600, y: ROW_TOLERANCE + 20 },   // too low: next row
    }
    assert.deepEq(readingOrder(blocks), ['a', 'b', 'd', 'c'])
  })

  it('the nearest block ahead wins, and a connected one counts as nearer', () => {
    reset()
    block('a', { x: 0, y: 0 })
    block('b', { x: 300, y: 0 })
    block('c', { x: 600, y: 0 })
    block('e', { x: 0, y: 400 })
    assert.eq(nearestInDirection('a', 'right'), 'b')
    assert.eq(nearestInDirection('a', 'down'), 'e')
    assert.eq(nearestInDirection('a', 'left'), null, 'nothing to the left')
    assert.eq(nearestInDirection('b', 'left'), 'a')
    // f is a little further than b but connected to a.
    block('f', { x: 340, y: 20 })
    state.arrows.push({ id: 'af', from: 'a', to: 'f', style: 'routed', fromPort: null, toPort: null })
    assert.eq(nearestInDirection('a', 'right'), 'f')
  })

  it('quick create picks the first suggestion, and the new block faces its source', () => {
    reset()
    assert.eq(quickCreateType('goal'), suggestedNextTypes('goal')[0])
    assert.ok(Object.hasOwn(TYPES, quickCreateType('custom')))
    block('a', { x: 0, y: 0 })
    assert.eq(facingSide('a', 800, 50), 'left', 'dropped to the right: its left side faces a')
    assert.eq(facingSide('a', -600, 50), 'right')
    assert.eq(facingSide('a', 100, 900), 'top')
    assert.eq(facingSide('a', 100, -900), 'bottom')
  })

  it('describes a block for the screen reader: title, type, status, position', () => {
    reset()
    block('a', { x: 0, y: 0, title: 'Ship it', status: 'in-progress' })
    block('b', { x: 300, y: 0 })
    const text = describeBlock('b')
    assert.match(text, /^b, Goal, .+\. 2 of 2$/)
    assert.match(describeBlock('a'), /^Ship it, Goal, /)
  })
})

// ── Keyboard traversal ──────────────────────────────────────
describe('Keyboard traversal', () => {
  it('Tab walks the blocks in reading order and leaves the canvas after the last one', () => {
    wire(); reset()
    block('c', { x: 0, y: 300 })
    block('a', { x: 0, y: 0 })
    block('b', { x: 300, y: 10 })
    const after = document.createElement('button')
    after.textContent = 'after the canvas'
    withViewport(vp => {
      vp.after(after)
      try {
        vp.focus()
        assert.eq(document.activeElement, vp)
        key('Tab', {}, vp)
        assert.eq(selection.blockId, 'a', 'Tab from the canvas enters at the first block')
        assert.eq(document.activeElement, document.getElementById('b-a'))
        key('Tab')
        assert.eq(selection.blockId, 'b', 'then the block beside it, not the one below')
        key('Tab')
        assert.eq(selection.blockId, 'c')
        const out = key('Tab')
        assert.ok(out.defaultPrevented)
        assert.eq(document.activeElement, after, 'Tab after the last block leaves the canvas')
        // And back: Shift+Tab from the first block lands on the canvas, not the last block.
        document.getElementById('b-a').focus()
        key('Tab', { shiftKey: true })
        assert.eq(document.activeElement, vp)
        const leave = key('Tab', { shiftKey: true }, vp)
        assert.ok(!leave.defaultPrevented, 'Shift+Tab on the canvas is left to the browser')
      } finally { after.remove() }
    })
  })

  it('controls floating over the canvas come before the blocks in Tab order', () => {
    wire(); reset()
    block('a', { x: 0, y: 0 })
    block('b', { x: 300, y: 0 })
    withViewport(vp => {
      const find = document.createElement('button')
      find.textContent = 'Find blocks'
      find.setAttribute('data-canvas-ui', '')
      vp.insertBefore(find, vp.firstChild)
      try {
        vp.focus()
        const ev = key('Tab', {}, vp)
        assert.ok(!ev.defaultPrevented, 'the browser moves on to the Find button')
        document.getElementById('b-a').focus()
        const back = key('Tab', { shiftKey: true })
        assert.ok(back.defaultPrevented)
        assert.eq(document.activeElement, find, 'Shift+Tab from the first block reaches the floating control')
      } finally { find.remove() }
    })
  })

  it('tabbing in from a control outside lands on the first block going forwards, the last going backwards', async () => {
    wire(); reset()
    // In a page with system focus, reset() taking focus off the last test's
    // card fired a real focusout in the canvas, and focus arriving within
    // 100ms of one reads as moving inside the canvas. Let it pass.
    if (document.hasFocus()) await sleep(120)
    block('upper', { x: 0, y: 0 })
    block('lower', { x: 0, y: 300 })
    // DOM order disagrees with reading order, as on a map edited over time:
    // the browser's own Tab would reach 'lower' first.
    $.canvasRoot().appendChild(document.getElementById('b-upper'))
    const el = id => document.getElementById('b-' + id)
    // A page without system focus (the headless runner) moves focus without
    // firing focus events, so send the focusin the browser would.
    // A page with system focus fires the real one, and a second would run
    // the Tab-entry handler twice.
    const arrive = (id, from = null) => {
      const had = document.hasFocus()
      el(id).focus()
      if (!had) el(id).dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: from }))
    }
    return withViewport(async () => {
      // The browser's Tab: a keydown, then focus on the next card in DOM order.
      key('Tab', {}, document.body)
      arrive('lower')
      assert.eq(selection.blockId, 'upper', 'forwards: the first block in reading order')
      assert.eq(document.activeElement, el('upper'))
      document.activeElement.blur()
      // Leaving the canvas and coming back is two key presses apart, not the
      // same instant (see the wait above).
      if (document.hasFocus()) await sleep(120)
      key('Tab', { shiftKey: true }, document.body)
      arrive('upper')
      assert.eq(selection.blockId, 'lower', 'backwards: the last block in reading order')
      // Focus moving from card to card is not entering the canvas.
      key('Tab', {}, document.body)
      arrive('upper', el('lower'))
      assert.eq(selection.blockId, 'lower', 'card to card is left alone')
    })
  })

  it('an aria-live region announces the block Tab selects', () => {
    wire(); reset()
    block('a', { x: 0, y: 0, title: 'First' })
    block('b', { x: 300, y: 0, title: 'Second' })
    withViewport(vp => {
      vp.focus()
      key('Tab', {}, vp)
      const live = document.getElementById('canvasAnnouncer')
      assert.ok(live, 'live region exists')
      assert.eq(live.getAttribute('aria-live'), 'polite')
      assert.match(live.textContent, /^First, Goal, .+\. 1 of 2/)
    })
  })

  it('Cmd/Ctrl+Arrow selects the nearest block in that direction', () => {
    wire(); reset()
    block('a', { x: 0, y: 0 })
    block('b', { x: 300, y: 0 })
    block('d', { x: 0, y: 400 })
    selectBlock('a')
    const ev = key('ArrowRight', { metaKey: true })
    assert.ok(ev.defaultPrevented)
    assert.eq(selection.blockId, 'b')
    key('ArrowLeft', { ctrlKey: true })
    assert.eq(selection.blockId, 'a')
    key('ArrowDown', { ctrlKey: true })
    assert.eq(selection.blockId, 'd')
    key('ArrowDown', { ctrlKey: true })
    assert.eq(selection.blockId, 'd', 'nothing below: the selection stays')
    assert.eq(getUndoHistory().length, 0, 'selecting is not an edit')
  })

  it('Alt+Arrow creates exactly one connected block and one arrow, in one undo step', () => {
    wire(); reset()
    block('a', { x: 0, y: 0 })
    selectBlock('a')
    const ev = key('ArrowDown', { altKey: true })
    assert.ok(ev.defaultPrevented)
    const ids = Object.keys(state.blocks)
    assert.eq(ids.length, 2)
    assert.eq(state.arrows.length, 1)
    const nid = ids.find(id => id !== 'a')
    const nb = state.blocks[nid]
    assert.eq(nb.type, suggestedNextTypes('goal')[0], 'the first suggestion for a goal')
    assert.ok(nb.y > 0, 'placed below')
    const arrow = state.arrows[0]
    assert.ok((arrow.from === 'a' && arrow.to === nid) || (arrow.from === nid && arrow.to === 'a'))
    assert.ok(isInlineEditing(), 'the new block opens in title editing')
    commitInlineEdit()
    assert.eq(getUndoHistory().length, 1, 'one undo step')
    undo()
    assert.deepEq(Object.keys(state.blocks), ['a'])
    assert.eq(state.arrows.length, 0)
  })

  it('Cmd/Ctrl+Enter adds a connected block to the right', () => {
    wire(); reset()
    block('a', { x: 0, y: 0 })
    selectBlock('a')
    key('Enter', { ctrlKey: true })
    const nid = Object.keys(state.blocks).find(id => id !== 'a')
    assert.ok(nid, 'created')
    assert.ok(state.blocks[nid].x > 200, 'to the right of a')
    assert.eq(state.arrows.length, 1)
    commitInlineEdit()
  })

  it('arrow keys nudge the selection (1px, Shift 10px), and a held key is one undo step', () => {
    wire(); reset()
    block('a', { x: 40, y: 40 })
    selectBlock('a')
    key('ArrowRight'); key('ArrowRight'); key('ArrowRight')
    assert.eq(state.blocks.a.x, 43)
    key('ArrowDown', { shiftKey: true })
    assert.eq(state.blocks.a.y, 50)
    assert.eq(getUndoHistory().length, 1, 'one burst, one undo step')
    undo()
    assert.eq(state.blocks.a.x, 40)
    assert.eq(state.blocks.a.y, 40)
  })

  it('a nudge moves one grid step when snapping is on', () => {
    wire(); reset()
    block('a', { x: 40, y: 40 })
    selectBlock('a')
    ui.snapToGrid = true
    try { key('ArrowRight') } finally { ui.snapToGrid = false }
    assert.eq(state.blocks.a.x, 56)
    assert.eq(state.blocks.a.y, 28)
  })

  it('arrow keys pan 60px when nothing is selected, and read-only never nudges or creates', () => {
    wire(); reset()
    block('a', { x: 40, y: 40 })
    withView(() => {
      view.panX = 0; view.panY = 0
      key('ArrowRight')
      assert.eq(view.panX, -60, 'the content moves left to show what is to the right')
      key('ArrowUp', { shiftKey: true })
      assert.eq(view.panY, 240)
      selectBlock('a')
      ui.readOnly = true
      try {
        key('ArrowLeft')
        assert.eq(state.blocks.a.x, 40, 'no nudge in a view-only link')
        assert.eq(view.panX, 0, 'it pans instead')
        key('ArrowDown', { altKey: true })
        assert.eq(Object.keys(state.blocks).length, 1, 'no quick create either')
      } finally { ui.readOnly = false }
    })
  })

  it('Escape deselects first, then lets go of the canvas', () => {
    wire(); reset()
    block('a', { x: 0, y: 0 })
    withViewport(() => {
      selectBlock('a')
      const el = document.getElementById('b-a')
      el.focus()
      key('Escape')
      assert.eq(selection.ids.size, 0)
      assert.eq(document.activeElement, el, 'the first Escape only deselects')
      key('Escape')
      assert.ok(document.activeElement !== el && !$.canvasViewport().contains(document.activeElement),
        'the second Escape leaves the canvas')
    })
  })

  it('single-key shortcuts stay off while a control outside the canvas has focus', () => {
    wire(); reset()
    block('a', { x: 0, y: 0 })
    const btn = document.createElement('button')
    btn.textContent = 'elsewhere'
    document.body.appendChild(btn)
    withView(() => {
      view.zoom = 1; view.panX = 0
      try {
        btn.focus()
        key('=')
        key('ArrowRight')
        assert.eq(view.zoom, 1, '= did not zoom')
        assert.eq(view.panX, 0, 'the arrow did not pan')
        btn.blur()
        key('=')
        assert.eq(view.zoom, 1.25, 'with the canvas (or nothing) focused it does')
      } finally { btn.remove() }
    })
  })
})

// ── Zoom ────────────────────────────────────────────────────
describe('Zoom keys, wheel and menu', () => {
  it('one wheel notch changes the zoom by at most x1.25; a pinch stays smooth', () => {
    assert.eq(wheelZoomFactor(200), 1 / WHEEL_MAX_STEP)
    assert.eq(wheelZoomFactor(-200), WHEEL_MAX_STEP)
    assert.eq(wheelZoomFactor(3, 1), 1 / WHEEL_MAX_STEP, 'three lines is a big notch too')
    const small = wheelZoomFactor(4)
    assert.ok(small < 1 && small > 1 / WHEEL_MAX_STEP, 'a small pinch delta is not clamped')
  })

  it('a Ctrl+wheel event on the canvas is clamped: 44% does not jump to 260%', () => {
    wire(); reset()
    withView(() => {
      view.zoom = 0.44; view.panX = 0; view.panY = 0
      $.canvasViewport().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -200, clientX: 100, clientY: 100 }))
      assert.ok(Math.abs(view.zoom - 0.55) < 1e-9, `zoom ${view.zoom}`)
    })
  })

  it('a Safari trackpad pinch (gesture events) zooms the canvas, and its Ctrl+wheel twin is ignored', () => {
    wire(); reset()
    const vp = $.canvasViewport()
    const gesture = (type, props = {}) => {
      const ev = new Event(type, { bubbles: true, cancelable: true })
      for (const [k, v] of Object.entries(props)) Object.defineProperty(ev, k, { value: v })
      vp.dispatchEvent(ev)
      return ev
    }
    withView(() => {
      view.zoom = 0.5; view.panX = 0; view.panY = 0
      assert.ok(gesture('gesturestart').defaultPrevented, 'the page itself does not zoom')
      gesture('gesturechange', { scale: 2, clientX: 0, clientY: 0 })
      assert.eq(view.zoom, 1)
      vp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -200 }))
      assert.eq(view.zoom, 1, 'no double zoom while the gesture runs')
      gesture('gesturechange', { scale: 100 })
      assert.eq(view.zoom, MAX_ZOOM, 'clamped')
      gesture('gestureend')
      vp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 200 }))
      assert.ok(view.zoom < MAX_ZOOM, 'the wheel zooms again once the gesture ends')
    })
  })

  it('zoom stops are round numbers inside the range', () => {
    assert.eq(ZOOM_STOPS[0], MIN_ZOOM)
    assert.eq(ZOOM_STOPS[ZOOM_STOPS.length - 1], MAX_ZOOM)
    assert.eq(nextZoomStop(1, 1), 1.25)
    assert.eq(nextZoomStop(1, -1), 0.8)
    assert.eq(nextZoomStop(0.44, 1), 0.5)
    assert.eq(nextZoomStop(MAX_ZOOM, 1), MAX_ZOOM)
    assert.eq(nextZoomStop(MIN_ZOOM, -1), MIN_ZOOM)
  })

  it('= and - step the zoom, Shift+0 is 100%, Cmd/Ctrl+= zooms the canvas, not the page', () => {
    wire(); reset()
    withView(() => {
      view.zoom = 1
      key('=')
      assert.eq(view.zoom, 1.25)
      key('-'); key('-')
      assert.eq(view.zoom, 0.8)
      key(')', { code: 'Digit0', shiftKey: true })
      assert.eq(view.zoom, 1)
      const ev = key('=', { metaKey: true })
      assert.ok(ev.defaultPrevented, 'the browser does not zoom the page')
      assert.eq(view.zoom, 1.25)
      key('0', { code: 'Digit0', ctrlKey: true })
      assert.eq(view.zoom, 1)
    })
  })

  it('Shift+1 fits every block, matched on the key code rather than the character', () => {
    wire(); reset()
    block('a', { x: 0, y: 0 })
    block('b', { x: 900, y: 700 })
    withViewport(() => {
      view.zoom = 2.6; view.panX = 5000; view.panY = 5000
      const ev = key('!', { code: 'Digit1', shiftKey: true })
      assert.ok(ev.defaultPrevented)
      assert.ok(view.zoom < 1, `fit zoomed out to ${view.zoom}`)
      assert.ok(contentInView(), 'and the blocks are in view')
    })
  })

  it('zoom to selection frames the selected blocks around the viewport centre', async () => {
    wire(); reset()
    block('a', { x: 1000, y: 1000 })
    block('b', { x: 1400, y: 1100 })
    await withViewport(async () => {
      view.zoom = 1; view.panX = 0; view.panY = 0
      assert.eq(zoomToSelection(), false, 'nothing selected, nothing to frame')
      // Set the selection directly: the test page has no multi-select inspector.
      selection.ids.add('a'); selection.ids.add('b'); selection.blockId = null
      key('@', { code: 'Digit2', shiftKey: true })
      const vp = $.canvasViewport()
      const cx = (state.blocks.a.x + state.blocks.b.x + (vp.querySelector('#b-b').offsetWidth || 220)) / 2
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 25))
        if (Math.abs(cx * view.zoom + view.panX - 400) < 1) break
      }
      assert.ok(Math.abs(cx * view.zoom + view.panX - 400) < 1, 'the selection is centred horizontally')
      assert.ok(view.zoom <= 1, 'never zooms in past 100% to frame a selection')
    })
  })

  it('the zoom menu lists every zoom action with its shortcut', () => {
    reset()
    const anchor = document.createElement('button')
    anchor.textContent = '100%'
    document.body.appendChild(anchor)
    try {
      openZoomMenu(anchor)
      const menu = document.querySelector('.pf-menu.zoom-menu')
      assert.ok(menu, 'menu open')
      assert.ok(menu.hasAttribute('data-canvas-ui'))
      assert.eq(anchor.getAttribute('aria-expanded'), 'true')
      const rows = [...menu.querySelectorAll('.pf-menu-item')]
      const labels = rows.map(r => r.querySelector('.pf-menu-label').textContent)
      for (const l of ['Zoom in', 'Zoom out', 'Zoom to 100%', 'Fit all blocks', 'Zoom to selection']) assert.includes(labels, l)
      const byLabel = l => rows.find(r => r.querySelector('.pf-menu-label').textContent === l)
      assert.eq(byLabel('Fit all blocks').querySelector('.pf-menu-shortcut').textContent, 'Shift+1')
      assert.eq(byLabel('Zoom to selection').querySelector('.pf-menu-shortcut').textContent, 'Shift+2')
      assert.ok(byLabel('Zoom to selection').disabled, 'disabled with nothing selected')
      closeMenus()
      block('a'); selectBlock('a')
      openZoomMenu(anchor)
      const sel = [...document.querySelectorAll('.pf-menu.zoom-menu .pf-menu-item')]
        .find(r => r.querySelector('.pf-menu-label').textContent === 'Zoom to selection')
      assert.ok(!sel.disabled, 'enabled once something is selected')
    } finally { closeMenus(); anchor.remove() }
    assert.ok(!isMenuOpen())
  })

  it('the status bar zoom cluster is four labelled buttons in the canvas UI slot', async () => {
    const html = await (await fetch('../index.html', { cache: 'no-store' })).text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const slot = doc.getElementById('zoomControls')
    assert.ok(slot && slot.hasAttribute('data-canvas-ui'))
    const buttons = [...slot.querySelectorAll('button')]
    assert.deepEq(buttons.map(b => b.id), ['zoomOutBtn', 'zoomMenuBtn', 'zoomInBtn', 'fitViewBtn'])
    buttons.forEach(b => {
      const name = (b.getAttribute('aria-label') || b.textContent).trim()
      assert.ok(name.length > 1, `${b.id} has an accessible name`)
      assert.eq(b.getAttribute('type'), 'button')
    })
    assert.ok(doc.querySelector('#zoomMenuBtn #zoomIndicator'), 'the percentage lives inside the menu button')
    const label = doc.getElementById('canvasViewport').getAttribute('aria-label')
    assert.ok(!/arrow keys to pan\./.test(label), 'the old label is gone')
    for (const k of ['Tab', 'Enter or F2', 'Alt', 'Escape']) assert.includes(label, k)
    assert.ok(!html.includes('\u2014'), 'no em dash in the page')
  })
})

// ── Panning ─────────────────────────────────────────────────
describe('Space and middle-button panning', () => {
  it('with Space held, dragging a card pans the canvas instead of moving the card', () => {
    wire(); reset()
    block('a', { x: 40, y: 40 })
    const vp = $.canvasViewport()
    withView(() => {
      view.panX = 0; view.panY = 0
      key(' ', { code: 'Space' }, document.body)
      assert.ok(vp.classList.contains('space-pan'), 'the grab cursor is on')
      const title = document.querySelector('#b-a .block-title')
      ptr(title, 'pointerdown', 50, 50)
      ptr(title, 'pointermove', 90, 60)
      assert.eq(view.panX, 40)
      assert.eq(view.panY, 10)
      assert.eq(state.blocks.a.x, 40, 'the card stayed put')
      ptr(title, 'pointerup', 90, 60)
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }))
      assert.ok(!vp.classList.contains('space-pan'))
      ptr(title, 'pointerdown', 50, 50)
      assert.eq(pointer.ix?.type, 'block', 'without Space a press on a card drags it again')
      ptr(title, 'pointerup', 50, 50)
    })
  })

  it('a middle-button drag pans and keeps the selection', () => {
    wire(); reset()
    block('a', { x: 40, y: 40 })
    selectBlock('a')
    const vp = $.canvasViewport()
    withView(() => {
      view.panX = 0
      ptr(vp, 'pointerdown', 100, 100, { button: 1, buttons: 4 })
      ptr(vp, 'pointermove', 130, 100, { button: -1, buttons: 4 })
      ptr(vp, 'pointerup', 130, 100, { button: 1, buttons: 0 })
      assert.eq(view.panX, 30)
      assert.eq(selection.blockId, 'a')
    })
  })
})

// ── Quick create with the mouse ─────────────────────────────
describe('Quick create from a port', () => {
  // The drop test needs "empty canvas under the pointer" without layout.
  function underPointer(el, fn) {
    const orig = document.elementFromPoint
    document.elementFromPoint = () => el
    try { return fn() } finally { document.elementFromPoint = orig }
  }

  it('ports say that a click adds a connected block, except in a view-only link', () => {
    wire(); reset(); block('a')
    const port = () => document.querySelector('#b-a .port-right')
    assert.match(port().title, /click to add a connected block/i)
    ui.readOnly = true
    try {
      renderBlock('a')
      assert.ok(!port().hasAttribute('title'), 'no promise the view cannot keep')
      ptr(port(), 'pointerdown', 100, 100)
      ptr(port(), 'pointerup', 100, 100)
      assert.eq(Object.keys(state.blocks).length, 1, 'a click on a port creates nothing')
    } finally { ui.readOnly = false; renderBlock('a') }
  })

  it('a click on a port (no drag) adds a connected block on that side, in one undo step', () => {
    wire(); reset()
    block('a', { x: 0, y: 0 })
    const port = document.querySelector('#b-a .port-bottom')
    ptr(port, 'pointerdown', 100, 100)
    ptr(port, 'pointerup', 100, 100)
    const nid = Object.keys(state.blocks).find(id => id !== 'a')
    assert.ok(nid, 'created')
    assert.ok(state.blocks[nid].y > 0, 'below the bottom port')
    assert.eq(state.arrows.length, 1)
    assert.ok(isInlineEditing())
    commitInlineEdit()
    assert.eq(getUndoHistory().length, 1)
  })

  it('dropping a connection on empty canvas opens the type picker, suggestions first, and creates there', () => {
    wire(); reset()
    block('a', { x: 40, y: 40 })
    const port = document.querySelector('#b-a .port-right')
    withView(() => {
      view.panX = 0; view.panY = 0; view.zoom = 1
      underPointer($.canvasRoot(), () => {
        ptr(port, 'pointerdown', 260, 90)
        ptr(port, 'pointermove', 330, 200)
        ptr(port, 'pointerup', 400, 300)
      })
      const menu = document.querySelector('.pf-menu.pf-quick-create')
      assert.ok(menu, 'the picker is open')
      assert.ok($.arrowPreview().getAttribute('d'), 'the line stays drawn while choosing')
      const first = menu.querySelector('.pf-menu-item .pf-menu-label').textContent
      const expected = suggestedNextTypes('goal')[0]
      assert.eq(first, TYPES[expected].label, 'the first suggestion for a goal comes first')
      assert.eq(Object.keys(state.blocks).length, 1, 'nothing created yet')
      menu.querySelector('.pf-menu-item').click()
      assert.ok(!isMenuOpen())
      assert.eq($.arrowPreview().getAttribute('d'), '', 'the preview is cleared')
      const ids = Object.keys(state.blocks)
      assert.eq(ids.length, 2)
      const nb = state.blocks[ids.find(id => id !== 'a')]
      assert.eq(nb.type, expected)
      assert.eq(nb.x, 400, 'its left side, which faces a, sits on the drop point')
      const h = document.getElementById('b-' + nb.id).offsetHeight || 100
      assert.eq(nb.y, Math.round(300 - h / 2))
      assert.eq(state.arrows.length, 1)
      assert.ok([state.arrows[0].from, state.arrows[0].to].includes('a'))
      assert.ok(isInlineEditing(), 'title editing starts')
      commitInlineEdit()
      assert.eq(getUndoHistory().length, 1, 'one undo step')
      undo()
      assert.eq(Object.keys(state.blocks).length, 1)
      assert.eq(state.arrows.length, 0)
    })
  })

  it('Escape in the picker creates nothing', () => {
    wire(); reset()
    block('a', { x: 40, y: 40 })
    const port = document.querySelector('#b-a .port-right')
    withView(() => {
      view.panX = 0; view.panY = 0; view.zoom = 1
      underPointer($.canvasRoot(), () => {
        ptr(port, 'pointerdown', 260, 90)
        ptr(port, 'pointermove', 400, 300)
        ptr(port, 'pointerup', 400, 300)
      })
      const menu = document.querySelector('.pf-menu.pf-quick-create')
      assert.ok(menu)
      const focused = menu.contains(document.activeElement) ? document.activeElement : menu
      focused.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      assert.ok(!isMenuOpen())
      assert.eq(Object.keys(state.blocks).length, 1)
      assert.eq(state.arrows.length, 0)
      assert.eq(getUndoHistory().length, 0)
      assert.eq($.arrowPreview().getAttribute('d'), '')
    })
  })

  it('dropping on another block still connects to it, with no picker', () => {
    wire(); reset()
    block('a', { x: 40, y: 40 })
    block('b', { x: 600, y: 40 })
    const port = document.querySelector('#b-a .port-right')
    underPointer(document.querySelector('#b-b .block-title'), () => {
      ptr(port, 'pointerdown', 260, 90)
      ptr(port, 'pointermove', 620, 80)
      ptr(port, 'pointerup', 620, 80)
    })
    assert.ok(!isMenuOpen())
    assert.eq(state.arrows.length, 1)
    assert.eq(state.arrows[0].to, 'b')
  })
})

// ── Back to content ─────────────────────────────────────────
describe('Back to content', () => {
  it('a pill appears when every block is off screen, and brings them back', () => {
    wire(); reset(); setupZoomControls()
    block('a', { x: 40, y: 40 })
    withViewport(() => {
      view.zoom = 1; view.panX = -5000; view.panY = 0
      refreshBackToContent()
      const pill = document.getElementById('backToContent')
      assert.ok(pill, 'pill exists')
      assert.eq(pill.tagName, 'BUTTON')
      assert.ok(pill.hasAttribute('data-canvas-ui'))
      assert.eq(pill.hidden, false, 'shown while lost')
      pill.click()
      assert.ok(contentInView(), 'fit brought the block back')
      assert.eq(pill.hidden, true)
      view.panX = 0
      refreshBackToContent()
      assert.eq(pill.hidden, true, 'hidden while a block is visible')
    })
  })

  it('stays hidden on an empty canvas', () => {
    reset(); setupZoomControls()
    withViewport(() => {
      view.panX = -5000
      refreshBackToContent()
      assert.eq(document.getElementById('backToContent').hidden, true)
    })
  })
})

// ── The shortcut sheet ──────────────────────────────────────
describe('Shortcut sheet', () => {
  // Regrouped by the COMMAND stream (design round): Creating first, the
  // palette and N-then-a-letter added, and rows that said the same thing
  // merged (the merged keys live on in the descriptions, checked below).
  it('lists every binding, grouped Creating, Editing, Navigation, View', () => {
    assert.deepEq(SHORTCUTS.map(g => g.group), ['Creating', 'Editing', 'Navigation', 'View'])
    const keys = SHORTCUTS.flatMap(g => g.keys.map(k => k[0]))
    for (const k of ['Enter / F2', 'Shift + Enter', 'Double-click line', 'Double-click canvas',
      'Shift + F10 / Menu key', 'Tab / Shift + Tab', '⌘/Ctrl + Arrow', 'Alt + Arrow',
      '⌘/Ctrl + Enter', 'Click a port ●', 'Space + drag',
      'Shift + 1', 'Shift + 2', 'Shift + 0', '= / -', 'Escape', 'L', 'H', 'Z', '?',
      '⌘/Ctrl + K', 'N, then a letter', '/']) {
      assert.includes(keys, k)
    }
    const all = JSON.stringify(SHORTCUTS).toLowerCase()
    for (const merged of ['middle button', 'redo', 'shift nudges 10px', 'right-click the canvas']) {
      assert.includes(all, merged, `"${merged}" is still described`)
    }
    const text = JSON.stringify(SHORTCUTS)
    assert.ok(!text.includes('\u2014'), 'no em dash')
  })

  it('renders every group behind All shortcuts, and a view-only link lists only what works there', () => {
    buildShortcutGrid()
    const grid = $.shortcutGrid()
    const all = grid.querySelector('details.shortcut-all')
    assert.ok(all, 'one disclosure holds the full list')
    assert.eq(all.querySelectorAll('.shortcut-section').length, SHORTCUTS.length)
    assert.eq(all.querySelectorAll('dt.shortcut-key').length, SHORTCUTS.reduce((n, g) => n + g.keys.length, 0))
    ui.readOnly = true
    try {
      buildShortcutGrid()
      const groups = [...grid.querySelectorAll('.shortcut-all .shortcut-group')].map(h => h.textContent)
      assert.deepEq(groups, ['Navigation', 'View'])
      assert.ok(!grid.querySelector('.shortcut-typekeys'), 'no type letters where nothing can be added')
    } finally { ui.readOnly = false; buildShortcutGrid() }
  })

  it('Escape closes the sheet without deselecting the block behind it', () => {
    wire(); reset(); setupShortcutOverlay()
    block('a'); selectBlock('a')
    const overlay = $.shortcutOverlay()
    try {
      openShortcuts()
      assert.eq(overlay.style.display, '')
      overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      assert.eq(overlay.style.display, 'none')
      assert.eq(selection.blockId, 'a', 'still selected')
    } finally { overlay.style.display = 'none' }
  })
})


// ── Review fixes (2026-09-28) ───────────────────────────────
// The headless page has no system focus, so element.focus() moves focus
// without firing focus events. Fire the focusin a focused page would, so the
// camera and Tab-entry handlers run as they do in a real browser.
function withFocusEvents(fn) {
  const orig = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (opts) {
    const prev = document.activeElement
    orig.call(this, opts)
    if (document.activeElement === this && prev !== this && !document.hasFocus()) {
      this.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: prev === document.body ? null : prev }))
    }
  }
  let out
  try { out = fn() } catch (err) { HTMLElement.prototype.focus = orig; throw err }
  if (out && typeof out.then === 'function') return out.finally(() => { HTMLElement.prototype.focus = orig })
  HTMLElement.prototype.focus = orig
  return out
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
// A key press ends the grace period in which focus from a pointer press
// never moves the camera, as a person reading a menu would.
const endPressGrace = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))

describe('Quick create keeps the camera still', () => {
  it('picking a type after a drop leaves the view alone, so the block lands under the drop', () => {
    wire(); reset()
    // The source card overhangs the left edge, as it does after a long drag.
    block('a', { x: -150, y: 40 })
    withViewport(vp => {
      const r = vp.getBoundingClientRect()
      // A press on a port focuses its card; the picker used to hand focus back
      // there on close, and that alone panned the camera.
      document.getElementById('b-a').focus({ preventScroll: true })
      // The camera starts here. A page with system focus (not the headless
      // runner) fired a real focusin just now that revealed the card; the
      // press that focuses it in the app never does (its grace period).
      view.panX = 0; view.panY = 0; view.zoom = 1; applyTransform()
      const wx = 560, wy = 300
      openQuickCreate({ fromId: 'a', fromPort: 'right', clientX: r.left + wx, clientY: r.top + wy, wx, wy })
      endPressGrace()
      withFocusEvents(() => document.querySelector('.pf-quick-create .pf-menu-item').click())
      assert.eq(Object.keys(state.blocks).length, 2)
      assert.deepEq({ x: view.panX, y: view.panY, z: view.zoom }, { x: 0, y: 0, z: 1 }, 'the camera did not move')
      const nid = Object.keys(state.blocks).find(id => id !== 'a')
      assert.eq(state.blocks[nid].x * view.zoom + view.panX, wx,
        'its left side is on screen where the connection was dropped')
      assert.ok(isInlineEditing(), 'and its title is being edited')
      commitInlineEdit()
    })
  })

  it('Escape in the picker hands focus to the canvas, not to the source card', () => {
    wire(); reset()
    block('a', { x: -150, y: 40 })
    withViewport(vp => {
      document.getElementById('b-a').focus({ preventScroll: true })
      view.panX = 0; view.panY = 0; view.zoom = 1; applyTransform()   // after the setup focus, as above
      openQuickCreate({ fromId: 'a', fromPort: 'right', clientX: 400, clientY: 300, wx: 400, wy: 300 })
      endPressGrace()
      withFocusEvents(() => {
        const menu = document.querySelector('.pf-quick-create')
        const at = menu.contains(document.activeElement) ? document.activeElement : menu
        at.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      })
      assert.ok(!isMenuOpen())
      assert.eq(document.activeElement, vp, 'the canvas keeps the keyboard')
      assert.deepEq({ x: view.panX, y: view.panY }, { x: 0, y: 0 }, 'refocusing the half-hidden source did not pan')
      assert.eq(Object.keys(state.blocks).length, 1)
    })
  })

  it('keyboard focus moves a partly visible card only as far as it takes, and centres one that is off screen', () => {
    assert.eq(revealShift(100, 300, 800, 60), 0, 'inside the padded view: no move')
    assert.eq(revealShift(700, 920, 800, 60), -180, 'overhangs the right: just enough to clear the pad')
    assert.eq(revealShift(-50, 170, 800, 60), 110, 'overhangs the left')
    assert.eq(revealShift(0, 900, 800, 60), 60, 'bigger than the room: show its start')
    wire(); reset()
    block('a', { x: 700, y: 100 })
    block('far', { x: 5000, y: 100 })
    withViewport(() => {
      view.panX = 0; view.panY = 0; view.zoom = 1
      const w = document.getElementById('b-a').offsetWidth
      // An earlier test may have left focus on a card called 'a' with the
      // camera at 0,0,1, which reads as a return to it (no pan). Focus
      // leaving from outside any card clears that memory, as a fresh page has.
      $.canvasRoot().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      endPressGrace()
      withFocusEvents(() => document.getElementById('b-a').focus({ preventScroll: true }))
      assert.eq(view.panX, 800 - 60 - (700 + w), 'the card slid in to the padded edge, no further')
      assert.eq(view.panY, 0, 'the other axis did not move')
      endPressGrace()
      withFocusEvents(() => document.getElementById('b-far').focus({ preventScroll: true }))
      const fw = document.getElementById('b-far').offsetWidth
      assert.ok(Math.abs((5000 + fw / 2) * view.zoom + view.panX - 400) < 1, 'a card nowhere on screen is centred')
    })
  })
})

describe('Focus coming back from a card\u2019s own editor', () => {
  // Chrome blurs a title when it stops being editable, before the card takes
  // focus back, so the card's focusin has no relatedTarget.
  const leaveThenArrive = (from, to) => {
    from.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    to.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: null }))
  }

  it('finishing a title does not pan the camera to a card that overhangs the edge', async () => {
    wire(); reset()
    block('a', { x: 700, y: 100 })
    await withViewport(async () => {
      view.panX = 0; view.panY = 0; view.zoom = 1
      endPressGrace()
      const el = document.getElementById('b-a')
      leaveThenArrive(el.querySelector('.block-title'), el)
      assert.deepEq({ x: view.panX, y: view.panY }, { x: 0, y: 0 }, 'the card stays where it is')
      // Arriving at the same card later, from outside the page, still reveals it.
      await sleep(120)
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: null }))
      assert.ok(view.panX < 0, 'focus from outside the card still pans it into view')
    })
  })

  it('Tab inside a title moves on to the description; it is not Tab entering the canvas', async () => {
    wire(); reset()
    block('a', { x: 0, y: 0 }); block('b', { x: 300, y: 0 })
    selectBlock('b')
    await withViewport(async () => {
      const el = document.getElementById('b-b')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      const desc = el.querySelector('.block-desc')
      desc.contentEditable = 'true'
      try {
        leaveThenArrive(el.querySelector('.block-title'), desc)
        assert.eq(selection.blockId, 'b', 'still on the card being edited')
      } finally { desc.contentEditable = 'false' }
      // Let the within-the-canvas window lapse before the next test tabs in.
      await sleep(120)
    })
  })
})

describe('Tab entry and card controls', () => {
  it('a card is one Tab stop: its own buttons are out of the Tab sequence', () => {
    wire(); reset()
    block('a', { docRef: { href: 'https://example.com', label: 'Spec', anchor: null } })
    const el = document.getElementById('b-a')
    assert.eq(el.tabIndex, 0, 'the card itself is tabbable')
    const controls = [...el.querySelectorAll('button')]
    assert.ok(controls.length >= 2, 'collapse and doc badge rendered')
    controls.forEach(c => assert.eq(c.tabIndex, -1, `${c.className} is not a Tab stop`))
  })

  it('Shift+Tab into the canvas that lands on a control inside a card selects the last block in reading order', () => {
    wire(); reset()
    // DOM order c, a, b; reading order a, b, c. The browser's Shift+Tab from
    // the status bar reaches the DOM-last card, b, or a button on it.
    block('c', { x: 0, y: 300 }); block('a', { x: 0, y: 0 }); block('b', { x: 300, y: 10 })
    const outside = document.createElement('button')
    outside.textContent = 'status bar'
    document.body.appendChild(outside)
    try {
      withViewport(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
        const btn = document.querySelector('#b-b .block-collapse-btn')
        btn.focus()
        btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: outside }))
        assert.eq(selection.blockId, 'c', 'the reading-order last block is selected')
        assert.eq(document.activeElement, document.getElementById('b-c'), 'and focused, not the button')
        // Going on backwards visits b next, then a: nothing is skipped.
        key('Tab', { shiftKey: true })
        assert.eq(selection.blockId, 'b')
        key('Tab', { shiftKey: true })
        assert.eq(selection.blockId, 'a')
      })
    } finally { outside.remove() }
  })

  it('with nothing after the canvas, Tab past the last card takes every card stop out for that key press', async () => {
    wire(); reset()
    block('a', { x: 0, y: 0 }); block('b', { x: 300, y: 0 })
    // Stand in for an embed: nothing tabbable follows the canvas.
    const root = $.canvasRoot()
    const later = [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
      .filter(el => !root.contains(el) && (root.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))
    const saved = later.map(el => el.getAttribute('tabindex'))
    later.forEach(el => { el.tabIndex = -1 })
    // A control another feature adds to a card after the decorators ran.
    const extra = document.querySelector('#b-a .block-collapse-btn')
    extra.tabIndex = 0
    try {
      await withViewport(async () => {
        const ev = key('Tab', {}, document.getElementById('b-b'))
        assert.ok(!ev.defaultPrevented, 'the browser moves on out of the page')
        assert.eq(document.getElementById('b-a').tabIndex, -1, 'cards are out for this press')
        assert.eq(extra.tabIndex, -1, 'and so is a tabbable control inside one')
        await sleep(0)
        assert.eq(document.getElementById('b-a').tabIndex, 0, 'restored afterwards')
        assert.eq(extra.tabIndex, 0)
      })
    } finally {
      later.forEach((el, i) => { if (saved[i] == null) el.removeAttribute('tabindex'); else el.setAttribute('tabindex', saved[i]) })
    }
  })
})

describe('Port clicks', () => {
  // Each test uses its own source id: a click on the same card's port within
  // half a second of an earlier test's click would read as its second half.
  const click = (id, detail) => {
    const port = document.querySelector(`#b-${id} .port-right`)
    ptr(port, 'pointerdown', 100, 100, { detail }); ptr(port, 'pointerup', 100, 100, { detail })
  }

  it('a double-click on a port adds one connected block, not two', () => {
    wire(); reset()
    block('dbl1', { x: 0, y: 0 })
    click('dbl1', 1)
    click('dbl1', 2)
    if (isInlineEditing()) commitInlineEdit()
    assert.eq(Object.keys(state.blocks).length, 2, 'one gesture, one new block')
    assert.eq(state.arrows.length, 1)
    assert.eq(getUndoHistory().length, 1)
  })

  it('a quick second click counts as a double-click even when the browser reports no click count', () => {
    wire(); reset()
    block('dbl2', { x: 0, y: 0 })
    click('dbl2', 0)
    click('dbl2', 0)
    if (isInlineEditing()) commitInlineEdit()
    assert.eq(Object.keys(state.blocks).length, 2)
  })

  it('two separate clicks add two blocks', async () => {
    wire(); reset()
    block('dbl3', { x: 0, y: 0 })
    click('dbl3', 1)
    if (isInlineEditing()) commitInlineEdit()
    await sleep(560)
    click('dbl3', 1)
    if (isInlineEditing()) commitInlineEdit()
    assert.eq(Object.keys(state.blocks).length, 3, 'clicks half a second apart are two gestures')
  })
})

// The test page has no multi-select inspector; selecting two blocks renders it.
function withMultiInspector(fn) {
  const made = !document.getElementById('multiCount')
  if (made) { const el = document.createElement('div'); el.id = 'multiCount'; el.style.display = 'none'; document.body.appendChild(el) }
  try { return fn() } finally { if (made) document.getElementById('multiCount')?.remove() }
}

describe('A view-only link: the sheet promises only what works', () => {
  it('Cmd/Ctrl+A selects every block in a view-only link, as the sheet says', () => {
    wire(); reset()
    block('a', { x: 0, y: 0 }); block('b', { x: 300, y: 0 })
    ui.readOnly = true
    try {
      buildShortcutGrid()
      const listed = [...$.shortcutGrid().querySelectorAll('dt.shortcut-key')].map(k => k.textContent)
      assert.includes(listed, '⌘/Ctrl + A')
      const ev = withMultiInspector(() => key('a', { metaKey: true }, document.body))
      assert.ok(ev.defaultPrevented)
      assert.eq(selection.ids.size, 2)
    } finally { ui.readOnly = false; buildShortcutGrid(); deselectAll() }
  })

  it('Shift+click adds to the selection in a view-only link, and nothing moves', () => {
    wire(); reset()
    block('a', { x: 0, y: 0 }); block('b', { x: 300, y: 0 })
    ui.readOnly = true
    try {
      renderBlock('a'); renderBlock('b')
      const ea = document.getElementById('b-a'), eb = document.getElementById('b-b')
      ptr(ea, 'pointerdown', 10, 10); ptr(ea, 'pointerup', 10, 10)
      withMultiInspector(() => { ptr(eb, 'pointerdown', 310, 10, { shiftKey: true }); ptr(eb, 'pointerup', 310, 10, { shiftKey: true }) })
      assert.eq(selection.ids.size, 2)
      assert.ok(selection.ids.has('a') && selection.ids.has('b'))
      assert.eq(getUndoHistory().length, 0, 'selecting is not an edit')
    } finally { ui.readOnly = false; pointer.ix = null; deselectAll() }
  })
})

describe('Zoom keys and the browser', () => {
  it('Cmd/Ctrl + = - 0 are left to the browser while a control outside the canvas has focus', () => {
    wire(); reset()
    const btn = document.createElement('button')
    btn.textContent = 'Inspector tab'
    document.body.appendChild(btn)
    withView(() => {
      view.zoom = 1
      try {
        btn.focus()
        for (const [k, code] of [['=', 'Equal'], ['-', 'Minus'], ['0', 'Digit0']]) {
          const ev = key(k, { metaKey: true, code })
          assert.ok(!ev.defaultPrevented, `Cmd+${k} zooms the page from the side panel`)
        }
        assert.eq(view.zoom, 1, 'the canvas zoom did not change')
        btn.blur()
        const ev = key('=', { ctrlKey: true, code: 'Equal' })
        assert.ok(ev.defaultPrevented, 'with the canvas (or nothing) focused it zooms the canvas')
        assert.eq(view.zoom, 1.25)
      } finally { btn.remove() }
    })
  })

  it('on a German keyboard, = (typed as Shift+0) zooms in instead of resetting to 100%', () => {
    wire(); reset()
    withView(() => {
      view.zoom = 1.5
      key('=', { code: 'Digit0', shiftKey: true })
      assert.eq(view.zoom, 2, 'zoomed in one stop')
      key(')', { code: 'Digit0', shiftKey: true })
      assert.eq(view.zoom, 1, 'Shift+0 on a US keyboard still means 100%')
    })
  })
})

describe('Shortcut sheet layout', () => {
  it('rows are key and description pairs inside balanced columns', () => {
    buildShortcutGrid()
    const grid = $.shortcutGrid()
    const cols = grid.querySelector('.shortcut-columns')
    assert.ok(cols, 'one column container')
    assert.eq(cols.querySelectorAll('.shortcut-section').length, SHORTCUTS.length)
    const rows = [...cols.querySelectorAll('dl.shortcut-list > .shortcut-row')]
    assert.eq(rows.length, SHORTCUTS.reduce((n, g) => n + g.keys.length, 0))
    const top = [...grid.querySelectorAll('.shortcut-top dl.shortcut-list > .shortcut-row')]
    assert.eq(top.length, 12, 'the most used dozen, first')
    rows.push(...top)
    rows.forEach(r => {
      assert.eq(r.children.length, 2)
      assert.eq(r.children[0].tagName, 'DT'); assert.eq(r.children[1].tagName, 'DD')
    })
  })

  // With "All shortcuts" folded (how it opens), the most used keys and the
  // type letters fit; unfolded, the full list scrolls inside the sheet.
  it('at 1440 by 900 the sheet as it opens is on screen without scrolling', async () => {
    // Width comes from the window (100vw); the height a 900px window allows
    // is set below, so the check does not depend on the runner's own height.
    if (window.innerWidth < 1400) { assert.ok(true, 'window too narrow to measure'); return }
    const css = (await (await fetch('../css/style.css', { cache: 'no-store' })).text()).replace(/:root\b/g, ':host')
      + '\n.shortcut-overlay .shortcut-modal { max-height: calc(900px - 32px) !important; }'
    buildShortcutGrid()
    const host = document.createElement('div')
    document.body.appendChild(host)
    try {
      const shadow = host.attachShadow({ mode: 'open' })
      shadow.innerHTML = `<style>${css}</style>
        <div class="shortcut-overlay" style="visibility:hidden"><div class="shortcut-modal">
          <div class="shortcut-modal-header"><span>Keyboard Shortcuts</span><button class="shortcut-close">x</button></div>
          <div class="shortcut-grid"></div>
          <div class="shortcut-modal-footer">New here? <a href="#">Take the walkthrough</a>.</div>
        </div></div>`
      const grid = shadow.querySelector('.shortcut-grid')
      grid.append(...[...$.shortcutGrid().childNodes].map(n => n.cloneNode(true)))
      assert.ok(grid.scrollHeight <= grid.clientHeight + 1,
        `the sheet fits: content ${grid.scrollHeight}px in ${grid.clientHeight}px`)
      const box = grid.getBoundingClientRect()
      const shown = [...shadow.querySelectorAll('.shortcut-group')].filter(h => !h.closest('details'))
      assert.ok(shown.length >= 2, 'Most used and the type letters')
      shown.forEach(h => {
        const r = h.getBoundingClientRect()
        assert.ok(r.top >= box.top && r.bottom <= box.bottom, `${h.textContent} heading is visible`)
      })
      const toggle = shadow.querySelector('.shortcut-all-toggle')
      const t = toggle.getBoundingClientRect()
      assert.ok(t.top >= box.top && t.bottom <= box.bottom, 'All shortcuts is on screen too')
      shadow.querySelector('details.shortcut-all').open = true
      const modal = shadow.querySelector('.shortcut-modal')
      assert.ok(modal.getBoundingClientRect().height <= 900 - 32 + 1, 'unfolded, the sheet still fits the window')
      assert.eq(getComputedStyle(grid).overflowY, 'auto', 'and its list scrolls inside it, not the page')
    } finally { host.remove() }
  })
})

// ── QA round ────────────────────────────────────────────────
describe('The canvas never scrolls (QA)', () => {
  it('the stylesheet clips the viewport, so a caret cannot scroll it', async () => {
    const css = await (await fetch('../css/style.css', { cache: 'no-store' })).text()
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-3000px;top:0'
    document.body.appendChild(host)
    try {
      const root = host.attachShadow({ mode: 'open' })
      root.adoptedStyleSheets = [sheet]
      root.innerHTML = '<div class="canvas-viewport" style="display:block;width:200px;height:100px"><div style="height:600px;width:900px"></div></div>'
      const vp = root.querySelector('.canvas-viewport')
      vp.scrollTop = 50; vp.scrollLeft = 40
      assert.eq(vp.scrollTop, 0, 'not a scroll container')
      assert.eq(vp.scrollLeft, 0)
    } finally { host.remove() }
  })

  it('a scroll that happens anyway is folded into the pan, so pointer mapping stays true', () => {
    wire(); reset()
    return withViewport(async vp => {
      const tall = document.createElement('div')
      tall.style.cssText = 'position:absolute;left:0;top:0;width:2000px;height:2000px'
      vp.appendChild(tall)
      try {
        view.panX = 0; view.panY = 0
        vp.scrollTop = 15
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        assert.eq(vp.scrollTop, 0, 'the scroll is undone')
        assert.eq(view.panY, -15, 'and the drawing stays where it was painted')
      } finally { tall.remove() }
    })
  })
})

describe('Selected connection ends and duplicates (QA)', () => {
  function withElements(fn, list) {
    const orig = document.elementsFromPoint
    document.elementsFromPoint = () => list
    try { return fn() } finally { document.elementsFromPoint = orig }
  }
  function underPointer(el, fn) {
    const orig = document.elementFromPoint
    document.elementFromPoint = () => el
    try { return fn() } finally { document.elementFromPoint = orig }
  }
  function setup() {
    wire(); reset()
    block('a', { x: 0, y: 0 }); block('b', { x: 400, y: 0 }); block('c', { x: 400, y: 300 })
    state.arrows = [
      { id: 'ab', from: 'a', to: 'b', style: 'routed', fromPort: null, toPort: null },
      { id: 'ac', from: 'a', to: 'c', style: 'routed', fromPort: null, toPort: null },
    ]
    renderArrows({ cheap: false })
    selectArrow('ac')
  }
  const handleFor = (aid, end) => {
    const h = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    h.classList.add('arrow-handle'); h.dataset.aid = aid; h.dataset.end = end
    return h
  }

  it('a press on a port lying over the selected connection\'s handle drags that end', () => {
    setup()
    const port = document.querySelector('#b-c .port-left')
    withElements(() => ptr(port, 'pointerdown', 400, 340), [port, document.getElementById('b-c'), handleFor('ac', 'to')])
    assert.eq(pointer.ix?.type, 'aend', 'the handle wins over the port above it')
    assert.eq(pointer.ix?.aid, 'ac')
    ptr(port, 'pointerup', 400, 340)
    pointer.ix = null
  })

  it('with no connection selected the port still draws a new connection', () => {
    setup(); deselectAll()
    const port = document.querySelector('#b-c .port-left')
    withElements(() => ptr(port, 'pointerdown', 400, 340), [port, handleFor('ac', 'to')])
    assert.eq(pointer.ix?.type, 'arrow')
    pointer.ix = null
  })

  it('moving an end onto a card it is already connected to is refused, not doubled', () => {
    setup()
    const hist = getUndoHistory().length
    const port = document.querySelector('#b-c .port-left')
    withElements(() => ptr(port, 'pointerdown', 400, 340), [handleFor('ac', 'to')])
    assert.eq(pointer.ix?.type, 'aend')
    const target = document.querySelector('#b-b .port-left')
    ptr($.canvasViewport(), 'pointermove', 400, 200)
    underPointer(target, () => ptr(port, 'pointerup', 400, 40))
    assert.eq(state.arrows.length, 2)
    assert.deepEq(state.arrows.map(a => a.from + '>' + a.to), ['a>b', 'a>c'], 'no second a>b')
    assert.eq(getUndoHistory().length, hist, 'nothing to undo')
  })

  it('moving an end onto a free card still re-targets it, as one undo step', () => {
    setup()
    block('d', { x: 800, y: 300 })
    const hist = getUndoHistory().length
    const port = document.querySelector('#b-c .port-left')
    withElements(() => ptr(port, 'pointerdown', 400, 340), [handleFor('ac', 'to')])
    ptr($.canvasViewport(), 'pointermove', 600, 340)
    underPointer(document.querySelector('#b-d .port-left'), () => ptr(port, 'pointerup', 800, 340))
    assert.eq(state.arrows.find(a => a.id === 'ac').to, 'd')
    assert.eq(getUndoHistory().length, hist + 1)
  })

  it('a click on an end handle, with no drag, changes nothing and takes no undo step', () => {
    setup()
    state.arrows.find(a => a.id === 'ac').toPort = 'left'
    const hist = getUndoHistory().length
    const port = document.querySelector('#b-c .port-left')
    withElements(() => ptr(port, 'pointerdown', 400, 340), [handleFor('ac', 'to')])
    underPointer(port, () => ptr(port, 'pointerup', 400, 340))
    const ac = state.arrows.find(a => a.id === 'ac')
    assert.eq(ac.to, 'c'); assert.eq(ac.toPort, 'left', 'the pin stays')
    assert.eq(getUndoHistory().length, hist)
  })
})

describe('Keys that must not reach the map (QA)', () => {
  it('behind the shortcut sheet Backspace, Delete and Cmd+Z do nothing; Escape closes it', () => {
    wire(); reset(); setupShortcutOverlay()
    block('a'); block('b', { x: 400 })
    selectBlock('a')
    const hist = getUndoHistory().length
    openShortcuts()
    try {
      const close = document.getElementById('shortcutClose') || document.body
      key('Backspace', {}, close)
      assert.ok(state.blocks.a, 'Backspace behind the sheet leaves the selected card')
      key('Delete', {}, document.body)
      assert.ok(state.blocks.a, 'so does Delete')
      key('d', { metaKey: true }, document.body)
      assert.eq(Object.keys(state.blocks).length, 2, 'nothing duplicated')
      assert.eq(getUndoHistory().length, hist, 'nothing recorded')
      getUndoHistory().push(JSON.stringify({ blocks: {}, arrows: [], groups: {} }))
      key('z', { metaKey: true }, document.body)
      assert.eq(Object.keys(state.blocks).length, 2, 'Cmd+Z undoes nothing nobody can see')
      getUndoHistory().pop()
      key('Escape', {}, document.body)
      assert.eq($.shortcutOverlay().style.display, 'none', 'Escape closes the sheet')
    } finally { $.shortcutOverlay().style.display = 'none' }
  })

  it('a focused status-bar or header button keeps Delete; the canvas still deletes', () => {
    wire(); reset()
    block('a'); block('b', { x: 400 })
    selectBlock('a')
    const btn = document.createElement('button')
    btn.id = 'qaFitBtn'
    document.body.appendChild(btn)
    try {
      btn.focus()
      key('Delete', {}, btn)
      key('d', { metaKey: true }, btn)
      assert.ok(state.blocks.a, 'Delete on a focused button leaves the card')
      assert.eq(Object.keys(state.blocks).length, 2, 'Cmd+D on a button duplicates nothing')
      btn.blur()
      key('Delete', {}, document.body)
      assert.ok(!state.blocks.a, 'from the canvas (the page) Delete still deletes')
    } finally { btn.remove() }
  })
})

describe('Card controls are one undo step each (QA)', () => {
  it('the collapse caret is undoable, like Collapse in the menu', () => {
    wire(); reset()
    block('a')
    const hist = getUndoHistory().length
    document.querySelector('#b-a .block-collapse-btn').click()
    assert.eq(state.blocks.a.collapsed, true)
    assert.eq(getUndoHistory().length, hist + 1, 'one step')
    undo()
    assert.eq(state.blocks.a.collapsed, false, 'Cmd+Z expands it again')
  })

  it('a resize drag is one undo step; a click on the handle is none', () => {
    wire(); reset()
    block('a', { x: 0, y: 0 })
    const handle = () => document.querySelector('#b-a .block-resize-handle')
    const hist = getUndoHistory().length
    withView(() => {
      view.zoom = 1
      ptr(handle(), 'pointerdown', 200, 50)
      ptr(handle(), 'pointerup', 200, 50)
      assert.eq(getUndoHistory().length, hist, 'a click is not an edit')
      ptr(handle(), 'pointerdown', 200, 50)
      ptr($.canvasViewport(), 'pointermove', 230, 50)
      ptr($.canvasViewport(), 'pointermove', 260, 50)
      ptr($.canvasViewport(), 'pointerup', 260, 50)
    })
    assert.eq(state.blocks.a.width, DEFAULT_WIDTH + 60, 'the card is wider')
    assert.eq(getUndoHistory().length, hist + 1, 'one step for the whole drag')
    undo()
    assert.ok(!state.blocks.a.width || state.blocks.a.width === DEFAULT_WIDTH, 'Cmd+Z puts the width back')
  })
})

describe('A keyboard nudge draws like a drag frame (QA)', () => {
  it('a press re-routes only the moved card\'s lines, and the full pass follows the burst', async () => {
    wire(); reset()
    block('a', { x: 0, y: 0 }); block('b', { x: 400, y: 0 })
    block('c', { x: 0, y: 400 }); block('d', { x: 400, y: 400 })
    block('e', { x: 0, y: 800 }); block('f', { x: 400, y: 800 })
    state.arrows = ['ab', 'cd', 'ef'].map(id => ({ id, from: id[0], to: id[1], style: 'routed', fromPort: null, toPort: null }))
    renderArrows({ cheap: false })
    selectBlock('a')
    document.activeElement?.blur?.()
    const before = routeStats.searches
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown')
    assert.eq(state.blocks.a.y, 3, 'the card moved')
    assert.eq(routeStats.searches - before, 0, 'no line was re-routed while the key is held')
    await new Promise(r => setTimeout(r, NUDGE_SETTLE_MS + 60))
    assert.ok(routeStats.searches - before >= 1, 'the full routing pass ran once the burst ended')
    flushNudge()
  })
})

describe('Escape leaves no ring that reads as a selection (design foundation)', () => {
  it('a card the pointer selected lets go of focus when Escape clears the selection', () => {
    wire(); reset()
    block('a')
    withViewport(() => withFocusEvents(() => {
      const el = document.getElementById('b-a')
      // A press, then focus inside its grace period: focus from the pointer.
      $.canvasRoot().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      el.focus({ preventScroll: true })
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      selectBlock('a')
      key('Escape', {}, el)
      assert.eq(selection.ids.size, 0, 'the selection is cleared')
      assert.neq(document.activeElement, el, 'and the card keeps no focus ring')
    }))
  })

  it('a card the keyboard reached keeps its focus, so Tab carries on from there', () => {
    wire(); reset()
    block('a')
    withViewport(() => withFocusEvents(() => {
      const el = document.getElementById('b-a')
      endPressGrace()
      el.focus({ preventScroll: true })
      selectBlock('a')
      key('Escape', {}, el)
      assert.eq(selection.ids.size, 0, 'the selection is cleared')
      assert.eq(document.activeElement, el, 'focus stays on the card')
    }))
  })
})
