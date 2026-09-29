// ============================================================
//  qa2.test.js -- regression tests for the open-items QA round
//  (Firefox, WebKit and accessibility lenses, 2026-09-29)
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, selection, pointer, view, canvasMeta, getUndoHistory, getRedoFuture, resetSnapshotToken } from '../js/state.js'
import { $ } from '../js/utils.js'
import { renderBlock, deselectAll, updateCanvasTitle, selectBlock, addToSelection, setSelection } from '../js/render.js'
import { runGapDetection } from '../js/gaps.js'
import { setupCanvasPointerEvents, setupArrowEvents, setupKeyboardShortcuts, setupTabNavigation,
         setupCanvasTitle } from '../js/events.js'
import { isInlineEditing, commitInlineEdit, startInlineEdit } from '../js/inline-edit.js'
import { openMenu, closeMenus } from '../js/menu.js'
import { openBlockMenu, setupContextMenu } from '../js/context-menu.js'
import { setupDevOptions, openShortcuts, closeShortcuts, setupSituation } from '../js/ui-panels.js'
import { setupPatchUI } from '../js/patch.js'
import { setupAttention } from '../js/attention.js'
import { nextZoomStop, ZOOM_STOPS } from '../js/zoom-controls.js'
import { selectFromKeyboard } from '../js/navigation.js'

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
  setupKeyboardShortcuts()
  setupTabNavigation()
}

const key = (k, extra = {}, target = document.activeElement || document.body) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })
  target.dispatchEvent(ev)
  return ev
}

// The test page hides the viewport; focus needs it laid out.
function withViewport(fn) {
  const vp = $.canvasViewport()
  const prevCss = vp.style.cssText
  const prevTab = vp.getAttribute('tabindex')
  const saved = { ...view }
  vp.style.cssText = 'display:block;position:relative;width:800px;height:600px;overflow:hidden'
  vp.tabIndex = 0
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

// A page without system focus (the headless runner) moves focus without
// firing focus events: send the focusin the browser would, only then.
function focusAs(el, from = null) {
  const had = document.hasFocus()
  el.focus({ preventScroll: true })
  if (!had) el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: from }))
}

const ptr = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: 11, button: 0, buttons: type === 'pointerup' ? 0 : 1,
  clientX: x, clientY: y, isPrimary: true, ...extra }))

const selectStart = el => {
  const ev = new Event('selectstart', { bubbles: true, cancelable: true })
  el.dispatchEvent(ev)
  return ev.defaultPrevented
}

// The rule bodies of a stylesheet, comments stripped, as [selector, body].
async function cssRules(path) {
  const text = (await (await fetch(path)).text()).replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(text))) rules.push([m[1].trim(), m[2]])
  return rules
}

describe('QA2 WebKit: a canvas press never selects page text', () => {
  it('a press on a card or on empty canvas cancels selectstart until it is released', () => {
    wire(); reset(); block('a')
    const title = document.querySelector('#b-a .block-title')
    ptr(title, 'pointerdown', 50, 50)
    assert.ok(selectStart(title), 'dragging a card selects nothing')
    assert.ok(selectStart(document.body), 'running off the viewport selects nothing either')
    ptr(title, 'pointerup', 50, 50)
    assert.ok(!selectStart(document.body), 'after release the page selects normally')
    const vp = $.canvasViewport()
    ptr(vp, 'pointerdown', 300, 300)
    assert.ok(selectStart(vp), 'a pan selects nothing')
    ptr(vp, 'pointerup', 300, 300)
    assert.ok(!selectStart(vp))
  })

  it('text being edited and canvas overlays keep their own selection', () => {
    wire(); reset(); block('a')
    const desc = document.querySelector('#b-a .block-desc')
    desc.setAttribute('contenteditable', 'true')
    try {
      ptr(desc, 'pointerdown', 50, 70)
      assert.ok(!selectStart(desc), 'a drag-select inside the description works')
      ptr(desc, 'pointerup', 50, 70)
    } finally { desc.removeAttribute('contenteditable') }
    const overlay = document.createElement('div')
    overlay.setAttribute('data-canvas-ui', '')
    overlay.textContent = 'Overlay copy'
    $.canvasViewport().appendChild(overlay)
    try {
      ptr(overlay, 'pointerdown', 10, 10)
      assert.ok(!selectStart(overlay))
      ptr(overlay, 'pointerup', 10, 10)
    } finally { overlay.remove() }
  })

  it('every user-select: none in the stylesheet carries its -webkit- twin', async () => {
    // Shipped Safari ignores the unprefixed property.
    const bad = (await cssRules('../css/style.css'))
      .filter(([, body]) => /(^|[^-])user-select:\s*none/.test(body) && !/-webkit-user-select:\s*none/.test(body))
      .map(([sel]) => sel)
    assert.deepEq(bad, [])
  })
})

describe('QA2 WebKit: Safari before 18 still blurs', () => {
  it('every backdrop-filter carries a -webkit- twin with the same value', async () => {
    const bad = []
    for (const path of ['../css/style.css', '../css/trace.css']) {
      for (const [sel, body] of await cssRules(path)) {
        const plain = [...body.matchAll(/(?:^|[^-])backdrop-filter:\s*([^;]+);/g)].map(m => m[1].trim())
        const pref = [...body.matchAll(/-webkit-backdrop-filter:\s*([^;]+);/g)].map(m => m[1].trim())
        if (JSON.stringify(plain) !== JSON.stringify(pref)) bad.push(path + ' ' + sel)
      }
    }
    assert.deepEq(bad, [])
  })
})

describe('QA2 WebKit: large maps stay quick', () => {
  it('gap painting writes nothing when no gap changed', () => {
    reset()
    block('a'); block('b', { x: 400 }); block('c', { type: 'problem', x: 800 })
    state.arrows = [{ id: 'ab', from: 'a', to: 'b', style: 'routed' }]
    runGapDetection()
    const cards = ['a', 'b', 'c'].map(id => document.getElementById('b-' + id))
    const icons = ['a', 'b', 'c'].map(id => document.getElementById('gi-' + id))
    assert.ok(cards[2].className.includes('gap-'), 'the fixture has a gap to paint')
    const records = []
    const mo = new MutationObserver(r => records.push(...r))
    cards.concat(icons).forEach(el => mo.observe(el, { attributes: true, childList: true, subtree: true }))
    runGapDetection(); runGapDetection()
    records.push(...mo.takeRecords())
    mo.disconnect()
    assert.eq(records.length, 0, 'no class or icon rewrite: ' + records.map(r => r.type + ':' + (r.attributeName || '')).join(','))
  })

  it('a gap that changes, or a card re-render, is still painted', () => {
    reset()
    block('a'); block('b', { x: 400 })
    runGapDetection()
    const el = document.getElementById('b-a')
    assert.ok(el.classList.contains('gap-isolated'))
    state.arrows = [{ id: 'ab', from: 'a', to: 'b', style: 'routed' }]
    runGapDetection()
    assert.ok(!el.classList.contains('gap-isolated'), 'the old gap is cleared')
    state.arrows = []
    runGapDetection()
    renderBlock('a')
    const again = document.getElementById('b-a')
    assert.ok(again.classList.contains('gap-isolated'), 'a re-render keeps its gap')
    assert.ok(document.querySelector('#gi-a .gap-icon'), 'and its icon')
  })

  it('each card is its own stacking context', async () => {
    const rule = (await cssRules('../css/style.css')).find(([sel]) => sel === '.block')
    assert.ok(rule && /isolation:\s*isolate/.test(rule[1]))
  })
})

describe('QA2 a11y: Tab never jumps the selection to the first card', () => {
  it('Tab in a card menu closes it and leaves selection and focus on that card', () => {
    wire(); reset()
    block('first', { x: 0, y: 0 }); block('mid', { x: 300, y: 0 }); block('last', { x: 600, y: 0 })
    withViewport(() => {
      selectFromKeyboard('mid')
      const card = document.getElementById('b-mid')
      const { el } = openMenu([{ label: 'Edit title', action: () => {} }, { label: 'Delete', action: () => {} }],
        { x: 100, y: 100, returnFocus: card, label: 'Actions for mid' })
      const item = el.querySelector('[role^=menuitem]')
      item.focus()
      // The menu takes the Tab and hands focus back to the card itself; in a
      // page without system focus, deliver the focusin that would bring.
      card.focus = function (o) { delete card.focus; focusAs(card, item) }
      let ev
      try { ev = key('Tab', {}, item) } finally { delete card.focus }
      assert.ok(ev.defaultPrevented)
      assert.ok(!el.isConnected, 'the menu closed')
      assert.eq(selection.blockId, 'mid', 'the selection stays on the card the menu was for')
      assert.eq(selection.ids.size, 1)
      assert.eq(document.activeElement, card)
    })
    closeMenus()
  })

  it('a multi-selection survives Tab out of its menu', () => {
    wire(); reset()
    block('first', { x: 0, y: 0 }); block('a', { x: 300, y: 0 }); block('b', { x: 600, y: 0 })
    withViewport(() => {
      selectFromKeyboard('a')
      selection.ids.add('b')
      const card = document.getElementById('b-a')
      const tab = key('Tab', {}, document.body)
      tab.preventDefault()   // as the menu does before refocusing the card
      focusAs(card, document.body)
      assert.deepEq([...selection.ids].sort(), ['a', 'b'])
    })
  })

  it('focus arriving from a field that re-rendered as it blurred is not entering the canvas', () => {
    wire(); reset()
    block('first', { x: 0, y: 0 }); block('a', { x: 300, y: 0 }); block('b', { x: 600, y: 0 })
    withViewport(() => {
      selectFromKeyboard('a')
      const gone = document.createElement('div')   // the description, cut loose by the re-render
      key('Tab', {}, document.body)
      focusAs(document.getElementById('b-b'), gone)
      assert.eq(selection.blockId, 'a', 'not the first card in reading order')
    })
  })

  it('Tab out of a description commits it and moves to the next card in reading order', () => {
    wire(); reset()
    block('first', { x: 0, y: 0 }); block('a', { x: 300, y: 0 }); block('b', { x: 0, y: 300 })
    withViewport(() => {
      selectFromKeyboard('a')
      assert.ok(startInlineEdit('a', 'description'))
      const desc = document.querySelector('#b-a .block-desc')
      desc.textContent = 'Written here'
      const ev = key('Tab', {}, desc)
      assert.ok(ev.defaultPrevented, 'the browser does not pick the next card by DOM order')
      assert.ok(!isInlineEditing())
      assert.eq(state.blocks.a.description, 'Written here')
      assert.eq(selection.blockId, 'b', 'the next card in reading order')
      assert.eq(document.activeElement, document.getElementById('b-b'))
    })
  })
})

describe('QA2 a11y: the map title renames, from a pointer or the keyboard', () => {
  let titleWired = false
  // As in index.html: the title sits inside the header's home link.
  function withTitle(fn) {
    const el = $.canvasTitle()
    if (!titleWired) { titleWired = true; setupCanvasTitle() }
    const parent = el.parentNode, next = el.nextSibling, css = el.style.cssText
    const link = document.createElement('a')
    link.href = '#qa2-title-link-followed'
    document.body.appendChild(link); link.appendChild(el)
    el.style.cssText = ''
    const saved = { title: canvasMeta.title, readOnly: ui.readOnly, hash: location.hash }
    try { return fn(el, link) } finally {
      if (el.contentEditable === 'true') el.blur()
      el.contentEditable = 'false'
      parent.insertBefore(el, next); link.remove(); el.style.cssText = css
      canvasMeta.title = saved.title; ui.readOnly = saved.readOnly
      updateCanvasTitle()
      if (location.hash !== saved.hash) history.replaceState(null, '', location.pathname + location.search + saved.hash)
    }
  }

  it('a click renames instead of following the home link', () => withTitle((el, link) => {
    ui.readOnly = false; canvasMeta.title = 'Status notes plan'; updateCanvasTitle()
    let followed = false
    const spy = e => { followed = !e.defaultPrevented }
    document.addEventListener('click', spy)
    try { el.click() } finally { document.removeEventListener('click', spy) }
    assert.ok(!followed, 'the link never sees an unprevented click')
    assert.ok(location.hash !== '#qa2-title-link-followed')
    assert.eq(el.contentEditable, 'true')
    assert.eq(el.getAttribute('role'), 'textbox')
    assert.eq(el.getAttribute('aria-label'), 'Map title')
  }))

  it('has a name and a role, Enter or F2 starts renaming, Enter commits', () => withTitle(el => {
    ui.readOnly = false; canvasMeta.title = 'Status notes plan'; updateCanvasTitle()
    assert.eq(el.getAttribute('role'), 'button')
    assert.eq(el.getAttribute('aria-label'), 'Rename map, Status notes plan')
    assert.eq(el.tabIndex, 0)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }))
    assert.eq(el.contentEditable, 'true', 'F2 renames')
    el.textContent = 'Weekly digest plan'
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    // A page without system focus fires no blur on its own.
    if (el.contentEditable === 'true') el.dispatchEvent(new FocusEvent('blur'))
    assert.eq(canvasMeta.title, 'Weekly digest plan')
    assert.eq(el.contentEditable, 'false')
    assert.eq(el.getAttribute('aria-label'), 'Rename map, Weekly digest plan')
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    el.dispatchEvent(ev)
    assert.ok(ev.defaultPrevented)
    assert.eq(el.contentEditable, 'true', 'Enter renames too')
  }))

  it('Escape puts the old title back', () => withTitle(el => {
    ui.readOnly = false; canvasMeta.title = 'Status notes plan'; updateCanvasTitle()
    el.click()
    el.textContent = 'Half typed'
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    if (el.contentEditable === 'true') el.dispatchEvent(new FocusEvent('blur'))
    assert.eq(canvasMeta.title, 'Status notes plan')
    assert.eq(el.textContent, 'Status notes plan')
  }))

  it('in a view-only page the title is plain text: no role, no Tab stop, clicks go to the link', () => withTitle(el => {
    ui.readOnly = true; canvasMeta.title = 'Status notes plan'; updateCanvasTitle()
    assert.eq(el.getAttribute('role'), null)
    assert.eq(el.getAttribute('tabindex'), null)
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    let prevented = null
    const spy = e => { prevented = e.defaultPrevented; e.preventDefault() }   // never navigate the runner
    document.addEventListener('click', spy)
    try { el.dispatchEvent(ev) } finally { document.removeEventListener('click', spy) }
    assert.eq(prevented, false)
    assert.eq(el.contentEditable === 'true', false)
  }))
})

describe('QA2 a11y: a connection can be selected without a pointer', () => {
  const lastMenu = () => { const all = document.querySelectorAll('.pf-menu'); return all[all.length - 1] }
  const rowsOf = m => [...m.querySelectorAll('.pf-menu-item')].filter(r => !r.hidden)
  const labelOf = r => r.querySelector('.pf-menu-label')?.textContent

  it("the card menu lists the card's connections, and picking one selects it on the canvas", () => {
    wire(); reset(); setupContextMenu()
    block('a', { title: 'Weekly digest' }); block('b', { title: 'Notes arrive late', x: 400 }); block('c', { title: 'Faster status notes', x: 800 })
    state.arrows = [
      { id: 'ab', from: 'a', to: 'b', style: 'routed', relation: 'informs' },
      { id: 'ca', from: 'c', to: 'a', style: 'routed' },
    ]
    withViewport(vp => {
      openBlockMenu('a', 100, 100)
      const root = lastMenu()
      const row = rowsOf(root).find(r => labelOf(r) === 'Select connection')
      assert.ok(row, 'the card menu offers it')
      row.click()
      const sub = lastMenu()
      assert.ok(sub.classList.contains('pf-submenu'))
      assert.deepEq(rowsOf(sub).map(labelOf), ['To Notes arrive late', 'From Faster status notes'])
      rowsOf(sub)[0].click()
      assert.eq(selection.arrowId, 'ab')
      assert.eq(selection.ids.size, 0, 'the card is no longer selected')
      assert.eq(document.activeElement, vp, 'the canvas has the keyboard')
      assert.match(document.getElementById('canvasAnnouncer')?.textContent || '', /^Connection from Weekly digest to Notes arrive late/)
      // The documented keys now reach it.
      vp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))
      assert.deepEq(state.arrows.map(a => a.id), ['ca'], 'Delete removed that connection only')
      assert.ok(state.blocks.a && state.blocks.b)
    })
    closeMenus()
  })

  it('a card with no connections does not offer the row', () => {
    wire(); reset(); setupContextMenu()
    block('a')
    openBlockMenu('a', 100, 100)
    assert.ok(!rowsOf(lastMenu()).some(r => labelOf(r) === 'Select connection'))
    closeMenus()
  })
})

describe('QA2 a11y: focus and state survive forced colors', () => {
  it('menu rows, the canvas and the active panel tab have system-colour cues', async () => {
    const css = (await (await fetch('../css/style.css')).text()).replace(/\/\*[\s\S]*?\*\//g, '')
    const blocks = []
    for (let i = css.indexOf('@media (forced-colors: active)'); i >= 0; i = css.indexOf('@media (forced-colors: active)', i + 1)) {
      let depth = 0, j = css.indexOf('{', i)
      for (let k = j; k < css.length; k++) {
        if (css[k] === '{') depth++
        else if (css[k] === '}' && --depth === 0) { blocks.push(css.slice(j, k)); break }
      }
    }
    const forced = blocks.join('\n')
    assert.match(forced, /\.pf-menu-item:is\([^)]*:focus[^)]*\)\s*\{[^}]*outline:\s*2px solid Highlight/)
    assert.match(forced, /\.canvas-viewport:focus-visible\s*\{[^}]*outline:\s*2px solid Highlight/)
    assert.match(forced, /\.panel-tab\.active\s*\{[^}]*border-bottom-color:\s*Highlight/)
  })

  it('the canvas focus ring is a solid outline, not a faint inset shadow', async () => {
    const rules = await cssRules('../css/style.css')
    const ring = rules.filter(([sel]) => sel === '.canvas-viewport:focus-visible').map(([, b]) => b).join(';')
    assert.match(ring, /outline:\s*2px solid #4d94ff/)
    assert.ok(!/rgba\(0,\s*99,\s*229,\s*\.4\)/.test(ring))
  })
})

describe('QA2 a11y: Dev Options opens from the keyboard', () => {
  let page = null
  const markup = async () => page || (page = new DOMParser().parseFromString(await (await fetch('../index.html', { cache: 'no-store' })).text(), 'text/html'))

  it('the header is a real button that says whether it is open and what it controls', async () => {
    const doc = await markup()
    const h = doc.getElementById('devOptionsHeader')
    assert.eq(h.tagName, 'BUTTON')
    assert.eq(h.getAttribute('type'), 'button')
    assert.eq(h.getAttribute('aria-expanded'), 'false')
    const body = doc.getElementById(h.getAttribute('aria-controls'))
    assert.ok(body && body.classList.contains('dev-options-body'))
    assert.eq(h.querySelector('svg').getAttribute('aria-hidden'), 'true')
  })

  it('pressing it toggles the panel and aria-expanded', async () => {
    const doc = await markup()
    const host = document.createElement('div')
    host.style.display = 'none'
    ;['devOptions', 'modeGroup', 'promptPresets'].forEach(id => host.appendChild(document.importNode(doc.getElementById(id), true)))
    document.body.appendChild(host)
    try {
      setupDevOptions()
      const h = host.querySelector('#devOptionsHeader')
      h.click()
      assert.ok(host.querySelector('#devOptions').classList.contains('open'))
      assert.eq(h.getAttribute('aria-expanded'), 'true')
      h.click()
      assert.ok(!host.querySelector('#devOptions').classList.contains('open'))
      assert.eq(h.getAttribute('aria-expanded'), 'false')
    } finally { host.remove() }
  })
})

describe('QA2: the shortcut sheet', () => {
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))

  it('its close button has a name, and focus lands on it with a visible ring', async () => {
    const page = new DOMParser().parseFromString(await (await fetch('../index.html', { cache: 'no-store' })).text(), 'text/html')
    const btn = page.getElementById('shortcutClose')
    assert.eq(btn.getAttribute('aria-label'), 'Close keyboard shortcuts')
    assert.eq(btn.querySelector('[aria-hidden="true"]')?.textContent, '✕')
    const overlay = $.shortcutOverlay()
    const close = document.createElement('button'); close.id = 'shortcutClose'
    overlay.appendChild(close)
    const calls = []
    close.focus = opts => calls.push(opts)
    try {
      openShortcuts()
      await nextFrame()
      assert.deepEq(calls, [{ focusVisible: true }], 'Firefox otherwise inherits a mouse focus and shows no ring')
    } finally { closeShortcuts(); close.remove() }
  })

  it('the page behind it is inert while it is open, and only while it is open', () => {
    const overlay = $.shortcutOverlay()
    const live = document.createElement('div'); live.setAttribute('aria-live', 'polite')
    const already = document.createElement('div'); already.inert = true
    document.body.append(live, already)
    try {
      openShortcuts()
      const isLive = el => el.hasAttribute('aria-live') || ['status', 'alert', 'log'].includes(el.getAttribute('role'))
      const behind = [...document.body.children].filter(el => el !== overlay && el.tagName !== 'SCRIPT' && !isLive(el))
      assert.ok(behind.length > 3)
      assert.deepEq(behind.filter(el => !el.inert).map(el => el.id || el.tagName), [], 'everything behind the sheet')
      assert.ok(!overlay.inert, 'not the sheet')
      assert.ok(!live.inert, 'live regions keep speaking')
      closeShortcuts()
      assert.ok(behind.filter(el => el !== already).every(el => !el.inert), 'all of it back')
      assert.ok(already.inert, 'what was inert before stays inert')
    } finally { closeShortcuts(); live.remove(); already.remove() }
  })
})

describe('QA2 WebKit: zooming', () => {
  it('a Safari pinch that starts over an overlay zooms the canvas, never the page', () => {
    wire(); reset()
    const vp = $.canvasViewport()
    const bar = document.createElement('div')
    bar.setAttribute('data-canvas-ui', '')
    vp.appendChild(bar)
    const saved = { ...view }
    const gesture = (type, props = {}) => {
      const ev = new Event(type, { bubbles: true, cancelable: true })
      for (const [k, v] of Object.entries(props)) Object.defineProperty(ev, k, { value: v })
      bar.dispatchEvent(ev)
      return ev
    }
    try {
      view.zoom = 0.5; view.panX = 0; view.panY = 0
      assert.ok(gesture('gesturestart').defaultPrevented, 'the page does not scale')
      assert.ok(gesture('gesturechange', { scale: 2, clientX: 0, clientY: 0 }).defaultPrevented)
      assert.eq(view.zoom, 1, 'the canvas zooms instead')
      gesture('gestureend')
    } finally { bar.remove(); Object.assign(view, saved) }
  })

  it('a zoom button press is always a visible step', () => {
    assert.eq(nextZoomStop(0.6571, 1), 0.8, 'from the fit zoom of 66%, not to 67%')
    assert.eq(nextZoomStop(0.6571, -1), 0.5)
    assert.eq(nextZoomStop(0.52, -1), 0.33, 'not to 50% from 52%')
    // From every stop, the neighbouring stop (they are all more than 5% apart).
    ZOOM_STOPS.forEach((z, i) => {
      if (i < ZOOM_STOPS.length - 1) assert.eq(nextZoomStop(z, 1), ZOOM_STOPS[i + 1])
      if (i > 0) assert.eq(nextZoomStop(z, -1), ZOOM_STOPS[i - 1])
    })
  })
})

describe('QA2 a11y: selection is heard', () => {
  it("a card's name says it is selected, through every way of selecting", () => {
    wire(); reset()
    block('a', { title: 'Ship it' }); block('b', { title: 'Plan it', x: 400 })
    const name = id => document.getElementById('b-' + id).getAttribute('aria-label')
    assert.eq(name('a'), 'Goal: Ship it')
    assert.eq(document.getElementById('b-a').getAttribute('aria-selected'), null, 'not the unsupported attribute')
    selectBlock('a')
    assert.eq(name('a'), 'Goal: Ship it, selected')
    addToSelection('b')
    assert.eq(name('b'), 'Goal: Plan it, selected')
    addToSelection('a')
    assert.eq(name('a'), 'Goal: Ship it')
    setSelection(['a', 'b'])
    assert.ok(name('a').endsWith(', selected') && name('b').endsWith(', selected'))
    renderBlock('a')
    assert.eq(name('a'), 'Goal: Ship it, selected', 'a re-render keeps it')
    deselectAll()
    assert.eq(name('a'), 'Goal: Ship it'); assert.eq(name('b'), 'Goal: Plan it')
  })

  it('the live region is in the page before the first message', async () => {
    const page = new DOMParser().parseFromString(await (await fetch('../index.html', { cache: 'no-store' })).text(), 'text/html')
    const live = page.getElementById('canvasAnnouncer')
    assert.ok(live, 'index.html carries it')
    assert.eq(live.getAttribute('aria-live'), 'polite')
    assert.eq(live.getAttribute('role'), 'status')
    assert.eq(live.textContent, '')
  })

  it('Select all and Escape are announced', () => {
    wire(); reset()
    block('a'); block('b', { x: 400 }); block('c', { x: 800 })
    withViewport(vp => {
      vp.focus()
      key('a', { metaKey: true }, vp)
      assert.eq(selection.ids.size, 3)
      assert.eq(document.getElementById('canvasAnnouncer').textContent.trim(), '3 blocks selected')
      key('Escape', {}, vp)
      assert.eq(selection.ids.size, 0)
      assert.eq(document.getElementById('canvasAnnouncer').textContent.trim(), 'Selection cleared')
    })
  })
})

describe('QA2 a11y: focus stays put when a control re-renders or removes itself', () => {
  let page = null
  const markup = async () => page || (page = new DOMParser().parseFromString(await (await fetch('../index.html', { cache: 'no-store' })).text(), 'text/html'))
  // Real markup from index.html, laid out (focus needs a box) but invisible.
  async function mountFrom(ids) {
    const doc = await markup()
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:0;top:0;width:320px;opacity:0;pointer-events:none'
    ids.forEach(id => host.appendChild(document.importNode(doc.getElementById(id), true)))
    document.body.appendChild(host)
    return host
  }

  it('Delete on the focused card hands the keyboard to the canvas and says so', () => {
    wire(); reset()
    block('a'); block('b', { x: 400 })
    withViewport(vp => {
      selectFromKeyboard('a')
      assert.eq(document.activeElement, document.getElementById('b-a'))
      key('Delete', {}, document.activeElement)
      assert.ok(!state.blocks.a)
      assert.eq(document.activeElement, vp, 'not the page')
      assert.eq(document.getElementById('canvasAnnouncer').textContent.trim(), 'Deleted the block')
    })
  })

  it('a Situation choice keeps focus on itself and says it is pressed', async () => {
    const host = await mountFrom(['situationFields'])
    const saved = canvasMeta.situation
    try {
      setupSituation()
      const btns = () => [...host.querySelectorAll('[data-situation="codebase"] [data-situation-value]')]
      const group = host.querySelector('[data-situation="codebase"]')
      assert.eq(group.getAttribute('role'), 'group')
      assert.ok(document.getElementById(group.getAttribute('aria-labelledby')), 'the row names its group')
      const target = btns().find(b => b.getAttribute('aria-pressed') === 'false')
      const value = target.dataset.situationValue
      target.focus()
      target.click()
      const now = btns().find(b => b.dataset.situationValue === value)
      assert.ok(now !== target, 'the buttons were rebuilt')
      assert.eq(document.activeElement, now, 'focus is back on the same choice')
      assert.eq(now.getAttribute('aria-pressed'), 'true')
      assert.eq(btns().filter(b => b.getAttribute('aria-pressed') === 'true').length, 1)
    } finally { canvasMeta.situation = saved; host.remove() }
  })

  it("the reply panel's Close hands focus back to the button that opened it", async () => {
    const host = await mountFrom(['patchSection'])
    try {
      setupPatchUI()
      const open = host.querySelector('#patchOpenBtn'), panel = host.querySelector('#patchPanel')
      open.click()
      assert.eq(panel.style.display, '')
      const close = host.querySelector('#patchCancelBtn')
      close.focus()
      close.click()
      assert.eq(panel.style.display, 'none')
      assert.eq(document.activeElement, open)
    } finally { host.remove() }
  })

  it('the Attention list keeps focus on the same row when it is rebuilt', async () => {
    reset()
    block('g1', { type: 'goal', title: 'Faster status notes' })
    block('p1', { type: 'problem', title: 'Notes arrive late', x: 400 })
    block('r1', { type: 'risk', title: 'Owner leaves', x: 800 })
    const host = await mountFrom(['attentionFilter', 'attentionList'])
    try {
      setupAttention()
      const list = host.querySelector('#attentionList')
      const rowButtons = () => [...list.children].map(li => li.querySelector('button')).filter(Boolean)
      assert.ok(rowButtons().length >= 2, 'the fixture has rows')
      rowButtons()[1].focus()
      window.dispatchEvent(new CustomEvent('pf:canvas-changed'))
      assert.ok(list.contains(document.activeElement), 'still in the list, not on the page')
      assert.eq([...list.children].findIndex(li => li.contains(document.activeElement)), 1, 'on the same row')
    } finally { host.remove(); reset() }
  })

  it('the generated prompt has a name, and the tablist holds only tabs', async () => {
    const doc = await markup()
    assert.eq(doc.getElementById('promptOutput').getAttribute('aria-label'), 'Generated prompt')
    const tablist = doc.querySelector('.panel-tablist')
    assert.ok(tablist)
    assert.deepEq([...tablist.children].map(c => c.className.split(' ')[0]), ['panel-tab', 'panel-tab', 'panel-tab'])
    assert.ok(!tablist.contains(doc.getElementById('panelCollapseBtn')))
  })

  it('the crawl-only links behind the footer are not Tab stops', async () => {
    const doc = await markup()
    const links = [...doc.querySelectorAll('nav.sr-only a')]
    assert.ok(links.length >= 2)
    assert.ok(links.every(a => a.getAttribute('tabindex') === '-1'))
  })
})
