// ============================================================
//  reading.test.js: the READING stream (design round, wave 4).
//  The brief as a reading surface and errors that say what to
//  do: a resizable panel, the Brief's Read width, a top area
//  that never cuts a word, one scope for every Copy brief,
//  refusals in two parts (what is wrong, what to try), a reply
//  outside the brief labelled, the question card's Answer
//  leading, and classifier cues that need harm or a measure
//  (the corpus lives in classifier.test.js).
// ============================================================

import { describe, it, assert, cssRgba, ONSCREEN } from './test-utils.js'
import { state, selection, ui, view, canvasMeta, promptState, getUndoHistory, getRedoFuture, resetSnapshotToken } from '../js/state.js'
import { SITUATION_DEFAULT } from '../js/utils.js'
import { generatePrompt, briefScope } from '../js/prompt.js'
import { runGapDetection } from '../js/gaps.js'
import { briefHtml } from '../js/brief-md.js'
import { setBriefScope, copyBrief, copyRequest, syncCopyScope, setupReading, setReading, readingWidth, readWidens, READ_MEASURE } from '../js/brief.js'
import { PANEL_MIN, PANEL_MAX, PANEL_WIDTH_KEY, panelMin, panelMax, clampPanelWidth, defaultPanelWidth,
         storedPanelWidth, wantedPanelWidth, setPanelWidth, resetPanelWidth, isWidthBorrowed,
         panelWidthChoices, panelWidthItems } from '../js/panel-resize.js'
import { extractPatch, buildPlan, applyPlan, setPlanSelected, previewSummary, setBriefCoverage, briefCoverages,
         outsideBriefs, setupPatchUI, PATCH_ERRORS, COVERAGE_KEY } from '../js/patch.js'
import { readIncoming, IMPORT_ERRORS, MAX_IMPORT_CHARS, jsonErrorLine, damagedKind, ROWS, showRefusal } from '../js/interop.js'
import { MEETING_SUMMARY_FAILED } from '../js/export.js'
import { commandGroups } from '../js/command-items.js'
import { mapsMenuItems } from '../js/library.js'
import { LINK_ERRORS, linkError } from '../js/sharing.js'
import { checkSrcUrl, checkShareUrl } from '../js/ui-panels.js'
import { fileMenuItems, FILE_MENUS } from '../js/view-menu.js'
import { setupInspectorEvents } from '../js/inspector.js'
import { renderBlock, selectBlock, deselectAll } from '../js/render.js'
import { closeMenus, isMenuOpen } from '../js/menu.js'
import { cleanupMockEls } from './test-utils.js'

const byId = id => document.getElementById(id)
const frame = () => new Promise(r => requestAnimationFrame(() => r()))
const tick = () => new Promise(r => setTimeout(r, 0))
let pageDoc = null
const indexDoc = async () => pageDoc || (pageDoc = new DOMParser().parseFromString(await (await fetch('../index.html', { cache: 'no-store' })).text(), 'text/html'))

// ── A mounted panel ──────────────────────────────────────────
// The right panel from index.html: the separator and the Brief pane, plus
// the status bar's copy button and File's rows, in a host whose width
// follows --panel-w the way the stylesheet's rule does. The runner's stub
// ids step aside while it is mounted.
const host = { el: null, marks: [], wired: false }
async function mountPanel() {
  if (host.el) return host.el
  const doc = await indexDoc()
  const parts = ['panelResizer', 'promptPane', 'copyPromptPill', 'fileActions'].map(id => document.importNode(doc.getElementById(id), true))
  parts.forEach(p => [p, ...p.querySelectorAll('[id]')].forEach(n => {
    const stub = n.id && document.getElementById(n.id)
    if (!stub) return
    const mark = document.createComment('stub ' + n.id)
    stub.replaceWith(mark)
    host.marks.push({ mark, stub })
  }))
  // A row like .app-body: the separator, then the panel it sizes.
  const row = document.createElement('div')
  row.style.cssText = 'position:fixed;right:0;top:0;height:700px;display:flex;opacity:0;pointer-events:none;z-index:-1'
  const aside = document.createElement('aside')
  aside.id = 'rightPanel'
  aside.className = 'right-panel'
  aside.style.cssText = 'height:700px;width:var(--panel-w, 320px);display:flex;flex-direction:column'
  const [sep, pane, pill, files] = parts
  pane.classList.add('active')
  aside.append(pane, pill, files)
  row.append(sep, aside)
  document.body.appendChild(row)
  host.el = row
  if (!host.wired) { setupReading(); host.wired = true }
  return aside
}
function unmountPanel() {
  setReading(false)
  closeMenus()
  host.el?.remove()
  host.el = null
  host.marks.forEach(({ mark, stub }) => mark.replaceWith(stub))
  host.marks = []
  try { localStorage.removeItem(PANEL_WIDTH_KEY) } catch (_) {}
}
const width = () => Math.round(byId('rightPanel').getBoundingClientRect().width)

// A small map: a goal with a requirement, an assumption and a risk on it,
// and a job that mitigates the risk (outside the goal's neighbours).
const B = (id, type, title, extra = {}) => ({ id, type, title, description: '', notes: '', x: 0, y: 0, actions: [], questions: [],
  criteria: [], rationale: '', docRef: null, status: null, priority: null, ...extra })
function fixture() {
  state.blocks = {
    g1: B('g1', 'goal', 'Faster status notes'),
    r1: B('r1', 'requirement', 'One place for the numbers'),
    a1: B('a1', 'assumption', 'Teams read the digest', { actions: ['validate'] }),
    k1: B('k1', 'risk', 'Owner leaves'),
    i2: B('i2', 'implementation', 'Weekly digest job'),
  }
  state.arrows = [
    { id: 'e1', from: 'g1', to: 'r1' }, { id: 'e2', from: 'a1', to: 'g1' }, { id: 'e3', from: 'g1', to: 'k1' },
    { id: 'e4', from: 'k1', to: 'i2' }, { id: 'e5', from: 'i2', to: 'r1' },
  ]
  state.groups = {}
  getUndoHistory().length = 0; getRedoFuture().length = 0
}
function clear() {
  state.blocks = {}; state.arrows = []; state.groups = {}
  selection.ids.clear(); selection.blockId = null; selection.arrowId = null
  getUndoHistory().length = 0; getRedoFuture().length = 0
  resetSnapshotToken()
  // A press on Read is remembered (brief.js readPref): no test leaves it on.
  try { localStorage.removeItem('pathfinder-brief-read') } catch (_) {}
}
const toastText = () => document.querySelector('.toast-notification .toast-msg')?.textContent || ''
const dropToasts = () => document.querySelectorAll('.toast-notification').forEach(t => t.remove())

// ═════════════════════════════════════════════════════════════
describe('reading: the panel takes the width the reader gives it', () => {
  it('holds 320px to the smaller of half the window and 760px; the stylesheet\'s 280px stays reachable on a narrow window', () => {
    assert.eq(PANEL_MIN, 320)
    assert.eq(PANEL_MAX, 760)
    assert.eq(panelMin(1440), 320)
    assert.eq(panelMax(1440), 720, 'half of 1440')
    assert.eq(panelMax(1920), 760, 'never over 760px')
    assert.eq(panelMax(3000), 760)
    assert.eq(defaultPanelWidth(1000), 280)
    assert.eq(panelMin(1000), 280, 'the tablet width is the floor where it is the default')
    assert.eq(panelMax(1000), 500)
    assert.eq(clampPanelWidth(100, 1440), 320)
    assert.eq(clampPanelWidth(5000, 1440), 720)
    assert.eq(clampPanelWidth(433.6, 1440), 434, 'whole pixels')
    assert.eq(clampPanelWidth('wide', 1440), 320, 'nonsense is the default')
  })

  it('the separator is a focusable vertical separator that says its width and limits', async () => {
    await mountPanel()
    const sep = byId('panelResizer')
    assert.eq(sep.getAttribute('role'), 'separator')
    assert.eq(sep.getAttribute('aria-orientation'), 'vertical')
    assert.eq(sep.tabIndex, 0)
    assert.eq(sep.getAttribute('aria-label'), 'Panel width')
    assert.eq(sep.getAttribute('aria-controls'), 'rightPanel')
    assert.eq(sep.getAttribute('aria-valuenow'), String(width()))
    assert.eq(sep.getAttribute('aria-valuemin'), String(panelMin()))
    assert.eq(sep.getAttribute('aria-valuemax'), String(panelMax()))
    assert.includes(sep.title, 'Double-click')
    assert.includes(sep.title, 'click for widths')
    // Review fix: the panel's sibling, so its target can straddle the edge
    // (the panel clips what it holds); the stylesheet hides it with the panel.
    assert.eq(sep.nextElementSibling, byId('rightPanel'), 'right before the panel it sizes')
  })

  it('keys: left widens, right narrows, Shift steps 64, Home and End go to the limits, and nothing else hears them', async () => {
    await mountPanel()
    resetPanelWidth(); await frame()
    const sep = byId('panelResizer')
    const heard = []
    const listen = e => heard.push(e.key)
    document.addEventListener('keydown', listen)
    const press = (key, extra = {}) => sep.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))
    try {
      const w0 = width()
      press('ArrowLeft'); assert.eq(width(), w0 + 16)
      press('ArrowLeft', { shiftKey: true }); assert.eq(width(), w0 + 80)
      press('ArrowRight'); assert.eq(width(), w0 + 64)
      press('End'); assert.eq(width(), panelMax())
      press('Home'); assert.eq(width(), panelMin())
      press('ArrowRight'); assert.eq(width(), panelMin(), 'never under the floor')
      assert.eq(sep.getAttribute('aria-valuenow'), String(panelMin()))
      assert.eq(storedPanelWidth(), panelMin(), 'a key is a choice: stored')
      assert.deepEq(heard, [], 'the canvas never sees an arrow meant for the separator')
      press('F7'); assert.deepEq(heard, ['F7'], 'other keys pass')
    } finally { document.removeEventListener('keydown', listen) }
  })

  it('a drag sets the width from the panel\'s fixed right edge and stores it; a double-click puts the default back', async () => {
    await mountPanel()
    resetPanelWidth(); await frame()
    const sep = byId('panelResizer')
    const w0 = width()
    const at = sep.getBoundingClientRect()
    const ev = (type, x) => sep.dispatchEvent(new PointerEvent(type, { pointerId: 7, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: at.top + 100, bubbles: true, cancelable: true }))
    ev('pointerdown', at.left + 4)
    assert.ok(document.body.classList.contains('panel-resizing'), 'the page shows the resize cursor')
    ev('pointermove', at.left - 60)
    ev('pointermove', at.left - 116)
    await frame()
    ev('pointerup', at.left - 116)
    await frame()
    assert.eq(width(), w0 + 120)
    assert.eq(storedPanelWidth(), w0 + 120)
    assert.ok(!document.body.classList.contains('panel-resizing'))
    assert.ok(byId('rightPanel').classList.contains('is-sized'))
    // A click with no move changes nothing.
    ev('pointerdown', at.left); ev('pointerup', at.left); await frame()
    assert.eq(width(), w0 + 120)
    sep.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await frame()
    assert.eq(storedPanelWidth(), null, 'the choice is forgotten')
    assert.ok(!byId('rightPanel').classList.contains('is-sized'))
    assert.eq(width(), 320, 'the stylesheet\'s width')
  })

  it('a stored width wider than this window allows is drawn at the limit and kept for a wider one', () => {
    localStorage.setItem(PANEL_WIDTH_KEY, '2000')
    try {
      assert.eq(storedPanelWidth(), 2000, 'kept as chosen')
      assert.eq(wantedPanelWidth(), panelMax(), 'drawn at the limit')
    } finally { localStorage.removeItem(PANEL_WIDTH_KEY) }
  })

  it('the camera stays where it is, and what sizes itself off the canvas hears about the change', async () => {
    await mountPanel()
    const cam = { ...view }
    const seen = { resize: 0, width: [] }
    const onResize = () => seen.resize++
    const onWidth = e => seen.width.push(e.detail)
    window.addEventListener('resize', onResize)
    window.addEventListener('pf:panel-width', onWidth)
    try {
      setPanelWidth(480)
      await frame(); await frame()
      assert.deepEq({ ...view }, cam, 'pan and zoom untouched: the canvas is pinned to its own top left')
      assert.ok(seen.resize >= 1, 'a resize for the minimap, the Back to content pill and open menus')
      assert.eq(seen.width.at(-1)?.width, 480)
      assert.eq(seen.width.at(-1)?.reading, false)
    } finally {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pf:panel-width', onWidth)
      resetPanelWidth()
    }
  })

  it('only a column beside the canvas takes a width: the 768px band and the phone sheet keep the window\'s, with no separator', async () => {
    const doc = await indexDoc()
    const sepHtml = doc.getElementById('panelResizer').outerHTML
    for (const [w, shown] of [[1440, true], [740, false], [390, false]]) {
      const f = document.createElement('iframe')
      f.style.cssText = `${ONSCREEN};width:${w}px;height:800px`
      f.srcdoc = `<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css"></head><body style="margin:0"><main class="app-body" style="height:100vh"><section class="canvas-workspace"></section>${sepHtml}<aside class="right-panel is-sized" id="rightPanel" style="--panel-w:600px"><div class="panel-content"></div></aside></main></body></html>`
      const loaded = new Promise(r => f.addEventListener('load', r, { once: true }))
      document.body.appendChild(f)
      await loaded
      try {
        const d = f.contentDocument, win = f.contentWindow
        const sep = d.getElementById('panelResizer'), panel = d.getElementById('rightPanel')
        assert.eq(win.getComputedStyle(sep).display !== 'none', shown, `${w}: separator ${shown ? 'shown' : 'hidden'}`)
        assert.eq(Math.round(panel.getBoundingClientRect().width), shown ? 600 : w, `${w}: the panel's width`)
        if (shown) {
          assert.eq(win.getComputedStyle(sep).cursor, 'col-resize')
          // Review fix: a 24px target (WCAG 2.5.8) across the edge, half
          // over the canvas, below the panel's tab row; the canvas keeps
          // its width (the separator takes no room in the row).
          const s = sep.getBoundingClientRect(), p = panel.getBoundingClientRect()
          assert.ok(s.width >= 24, `a 24px target, not ${s.width}`)
          assert.ok(Math.abs(s.left + s.width / 2 - p.left) <= 1, `centred on the panel's edge: ${s.left}+${s.width / 2} vs ${p.left}`)
          assert.ok(s.top >= 44, 'clear of the panel\'s tabs')
          assert.eq(Math.round(d.querySelector('.canvas-workspace').getBoundingClientRect().width), w - 600, 'no room taken from the canvas')
          assert.ok(parseFloat(win.getComputedStyle(sep, '::after').height) >= 24, 'a grip at rest')
          panel.classList.add('collapsed')
          assert.eq(win.getComputedStyle(sep).display, 'none', 'nothing to drag on a folded panel')
          assert.eq(Math.round(panel.getBoundingClientRect().width), 48, 'and the fold keeps its own width')
          panel.classList.remove('collapsed')
          d.body.dataset.zen = 'on'
          assert.eq(win.getComputedStyle(sep).display, 'none', 'Z hides it with the panel')
          d.body.dataset.zen = 'off'
          d.body.classList.add('embed-mode')
          assert.eq(win.getComputedStyle(sep).display, 'none', 'an embed has no panel to size')
        }
      } finally { f.remove() }
    }
  })
})

// ═════════════════════════════════════════════════════════════
// Review fix (WCAG 2.5.7): a width without dragging. A click on the
// separator lists widths; Enter or Space does too; a double-click still
// resets, without the list flashing open first.
describe('reading: a click on the separator offers widths, no drag needed', () => {
  const click = (sep, detail) => sep.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail, clientX: 10, clientY: 200 }))
  const menuLabels = () => [...document.querySelectorAll('.panel-width-menu .pf-menu-label')].map(e => e.textContent)
  const wait = ms => new Promise(r => setTimeout(r, ms))

  it('offers the default, a wide and the widest width, each a whole step, never two alike', () => {
    assert.deepEq(panelWidthChoices(1440).map(c => [c.label, c.width]), [['Default width', 320], ['Wide', 520], ['Widest', 720]])
    assert.deepEq(panelWidthChoices(1920).map(c => c.width), [320, 544, 760])
    assert.deepEq(panelWidthChoices(1000).map(c => c.width), [280, 392, 500], 'a tablet window: its own default and limit')
    for (const vw of [800, 1024, 1280, 1440, 2560]) {
      const ws = panelWidthChoices(vw).map(c => c.width)
      assert.ok(ws.every((w, i) => i === 0 || w > ws[i - 1]), `${vw}: ${ws}`)
      assert.ok(ws.every(w => w === clampPanelWidth(w, vw) || w === defaultPanelWidth(vw)), `${vw}: inside the limits`)
    }
  })

  it('a click opens the list once it is not a double-click; picking a width sets and stores it, and the list says which is drawn', async () => {
    await mountPanel()
    resetPanelWidth(); await frame()
    const sep = byId('panelResizer')
    try {
      click(sep, 1)
      assert.ok(!isMenuOpen(), 'not before a second click could arrive')
      await wait(320)
      assert.ok(isMenuOpen(), 'then the list')
      assert.deepEq(menuLabels(), ['Default width', 'Wide', 'Widest'])
      const rows = [...document.querySelectorAll('.panel-width-menu .pf-menu-item')]
      assert.eq(rows[0].getAttribute('aria-checked'), 'true', 'the default is drawn')
      assert.eq(document.querySelector('.panel-width-menu').getAttribute('aria-label'), 'Panel width')
      rows[1].click()
      await frame()
      const wide = panelWidthChoices().find(c => c.key === 'wide').width
      assert.eq(width(), wide)
      assert.eq(storedPanelWidth(), wide, 'a choice, stored')
      assert.ok(!isMenuOpen())
      assert.eq(panelWidthItems().find(i => i.label === 'Wide').checked, true)
      // Enter opens the same list from the keyboard; Default width forgets the choice.
      sep.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      assert.ok(isMenuOpen(), 'Enter opens it')
      document.querySelector('.panel-width-menu .pf-menu-item').click()
      await frame()
      assert.eq(storedPanelWidth(), null)
      assert.eq(width(), 320)
      // Assistive technology clicks with no pointer count: at once.
      click(sep, 0)
      assert.ok(isMenuOpen(), 'a click with no count opens at once')
    } finally { closeMenus(); resetPanelWidth() }
  })

  it('Cmd+K reaches the same widths, as the separator\'s list does (every menu action stays in the palette)', async () => {
    await mountPanel()
    resetPanelWidth(); await frame()
    try {
      const row = commandGroups().flatMap(g => g.items).find(r => r && r.label === 'Panel width')
      assert.ok(row, 'a Panel width row')
      const kids = row.children()
      assert.deepEq(kids.map(k => k.label), ['Default width', 'Wide', 'Widest'])
      kids.find(k => k.label === 'Widest').run()
      await frame()
      assert.eq(width(), panelMax())
    } finally { resetPanelWidth() }
  })

  it('a double-click resets without the list, and the click that ends a drag is the drag\'s', async () => {
    await mountPanel()
    setPanelWidth(500); await frame()
    const sep = byId('panelResizer')
    try {
      click(sep, 1); click(sep, 2)
      sep.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
      await wait(320)
      assert.ok(!isMenuOpen(), 'no list after a double-click')
      assert.eq(storedPanelWidth(), null, 'reset')
      const at = sep.getBoundingClientRect()
      const ev = (type, x) => sep.dispatchEvent(new PointerEvent(type, { pointerId: 11, button: 0, buttons: 1, clientX: x, clientY: at.top + 80, bubbles: true, cancelable: true }))
      ev('pointerdown', at.left + 12); ev('pointermove', at.left - 28); await frame(); ev('pointerup', at.left - 28)
      click(sep, 1)
      await wait(320)
      assert.ok(!isMenuOpen(), 'a drag is not a request for the list')
      assert.eq(storedPanelWidth(), 360)
    } finally { closeMenus(); resetPanelWidth() }
  })
})

// ═════════════════════════════════════════════════════════════
describe('reading: Read lends the panel the brief\'s measure and gives it back', () => {
  async function withBrief() {
    await mountPanel()
    fixture()
    byId('promptOutput').innerHTML = briefHtml(generatePrompt()).html
    byId('promptPane').classList.add('active')
    resetPanelWidth(); await frame()
  }

  it('Read widens the panel to the measure, stores nothing, and presses; again gives the width back', async () => {
    await withBrief()
    try {
      const btn = byId('briefReadBtn')
      assert.eq(btn.tagName, 'BUTTON')
      assert.eq(btn.getAttribute('aria-pressed'), 'false')
      assert.eq(btn.textContent.trim(), 'Read')
      const want = clampPanelWidth(readingWidth())
      btn.click()
      await frame()
      assert.eq(btn.getAttribute('aria-pressed'), 'true')
      assert.ok(isWidthBorrowed())
      assert.eq(width(), want)
      assert.ok(byId('promptPane').classList.contains('is-reading'))
      assert.eq(storedPanelWidth(), null, 'a loan, never the person\'s choice')
      btn.click()
      await frame()
      assert.eq(btn.getAttribute('aria-pressed'), 'false')
      assert.eq(width(), 320)
    } finally { setReading(false); clear() }
  })

  it('the measure is the brief\'s own text: a larger font asks for a proportionally wider panel', async () => {
    await withBrief()
    try {
      assert.eq(READ_MEASURE, 68)
      const md = byId('promptOutput')
      md.style.fontSize = '13px'
      const small = readingWidth()
      md.style.fontSize = '16px'
      const large = readingWidth()
      assert.ok(small > 300, `13px: ${small}px`)
      const ratio = large / small
      assert.ok(ratio > 1.15 && ratio < 1.3, `16px over 13px asks ${ratio.toFixed(2)} times the width`)
    } finally { byId('promptOutput').style.fontSize = ''; clear() }
  })

  it('leaving the Brief tab gives the width back, and so does folding the panel', async () => {
    await withBrief()
    try {
      const own = setPanelWidth(360)
      setReading(true); await frame()
      assert.ok(isWidthBorrowed())
      byId('promptPane').classList.remove('active')
      await tick()
      assert.ok(!isWidthBorrowed(), 'the tab changed')
      assert.eq(width(), own, 'the person\'s own width, not the default')
      assert.eq(byId('briefReadBtn').getAttribute('aria-pressed'), 'false')
      byId('promptPane').classList.add('active')
      setReading(true); await frame()
      byId('rightPanel').classList.add('collapsed')
      await tick()
      assert.ok(!isWidthBorrowed(), 'the panel folded')
    } finally { byId('rightPanel').classList.remove('collapsed'); setReading(false); resetPanelWidth(); clear() }
  })

  // Review fix: Read narrowed a panel dragged wider than the measure (720 to
  // 485px) while its title said it widens.
  it('Read never narrows: past the measure it rests, says why, and leaves the width alone', async () => {
    await withBrief()
    try {
      const btn = byId('briefReadBtn')
      const want = readingWidth()
      assert.ok(readWidens(), 'at 320px there is width to give')
      assert.ok(!btn.hasAttribute('aria-disabled'))
      assert.includes(btn.title, 'Widen the panel')
      const wide = setPanelWidth(Math.min(panelMax(), want + 120)); await frame(); await frame()
      assert.ok(wide > want, `${wide} is past the measure ${want}`)
      assert.ok(!readWidens())
      assert.eq(btn.getAttribute('aria-disabled'), 'true', 'it rests')
      assert.includes(btn.title, 'already wide enough')
      btn.click(); await frame()
      assert.eq(width(), wide, 'never narrowed')
      assert.ok(!isWidthBorrowed())
      assert.eq(btn.getAttribute('aria-pressed'), 'false')
      assert.eq(setReading(true), false)
      assert.eq(width(), wide)
      // Narrower again: Read has width to give, and its title says so.
      setPanelWidth(320); await frame(); await frame()
      assert.ok(!btn.hasAttribute('aria-disabled'))
      btn.click(); await frame()
      assert.eq(btn.getAttribute('aria-pressed'), 'true')
      assert.eq(btn.title, 'Give the panel its width back')
    } finally { setReading(false); resetPanelWidth(); clear() }
  })

  it('a drag while reading keeps the dragged width as the reader\'s own and lets go of the button', async () => {
    await withBrief()
    try {
      setReading(true); await frame()
      const sep = byId('panelResizer'), at = sep.getBoundingClientRect(), w = width()
      const ev = (type, x) => sep.dispatchEvent(new PointerEvent(type, { pointerId: 9, button: 0, buttons: 1, clientX: x, clientY: at.top + 50, bubbles: true }))
      ev('pointerdown', at.left + 4); ev('pointermove', at.left - 36); await frame(); ev('pointerup', at.left - 36)
      await frame(); await frame()
      assert.ok(!isWidthBorrowed())
      assert.eq(storedPanelWidth(), w + 40)
      assert.eq(byId('briefReadBtn').getAttribute('aria-pressed'), 'false')
    } finally { setReading(false); resetPanelWidth(); clear() }
  })
})

// ═════════════════════════════════════════════════════════════
describe('reading: the top of the Brief reads whole', () => {
  // The pane in a frame with the real stylesheet, at the default 320px panel.
  async function paneFrame(theme, fill, panelW = null) {
    const doc = await indexDoc()
    const f = document.createElement('iframe')
    f.style.cssText = `${ONSCREEN};width:1440px;height:900px`
    const sized = panelW ? ` is-sized" style="height:900px;--panel-w:${panelW}px` : '" style="height:900px'
    f.srcdoc = `<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css"><style>*, *::before, *::after { transition: none !important; }</style></head><body class="${theme}" style="margin:0"><aside id="rightPanel" class="right-panel${sized}"><div class="panel-content">${doc.getElementById('promptPane').outerHTML}</div></aside></body></html>`
    const loaded = new Promise(r => f.addEventListener('load', r, { once: true }))
    document.body.appendChild(f)
    await loaded
    const d = f.contentDocument
    d.getElementById('promptPane').classList.add('active')
    fill(d)
    return f
  }
  const lines = (el, win) => Math.round(el.getBoundingClientRect().height / parseFloat(win.getComputedStyle(el).lineHeight))

  it('the framing summary wraps between words to two lines at most, never an ellipsis, even at its longest', async () => {
    const longest = 'Code elsewhere, in an IDE, ask questions first; 12 boundaries, context'
    for (const summary of ['This repo, in Claude Code, read the code first; 3 boundaries, context', longest, 'No code yet, in a chat, propose a plan first']) {
      const f = await paneFrame('', d => { d.getElementById('briefFramingSummary').textContent = summary })
      try {
        const d = f.contentDocument, win = f.contentWindow
        const text = d.querySelector('.brief-framing-text')
        assert.ok(text.contains(d.getElementById('briefFramingSummary')) && text.contains(d.querySelector('.brief-row-label')), 'one run of text')
        assert.ok(text.scrollHeight <= text.clientHeight + 1, `${summary}: nothing clipped (${text.scrollHeight} in ${text.clientHeight})`)
        assert.ok(lines(text, win) <= 2, `${summary}: ${lines(text, win)} lines`)
        assert.eq(win.getComputedStyle(d.getElementById('briefFramingSummary')).textOverflow, 'clip')
      } finally { f.remove() }
    }
  })

  it('Review stays on the count\'s line however the breakdown wraps', async () => {
    const f = await paneFrame('', d => {
      d.getElementById('briefReady').hidden = false
      d.getElementById('briefReadyText').innerHTML = '<strong>7 open items</strong>: 2 assumptions, 2 requirements without criteria, 1 decision, 2 risks.'
    })
    try {
      const d = f.contentDocument
      const count = d.querySelector('#briefReadyText strong').getBoundingClientRect()
      const review = d.getElementById('briefReviewBtn').getBoundingClientRect()
      assert.ok(Math.abs(count.top - review.top) < 3, `count at ${count.top}, Review at ${review.top}`)
      assert.ok(review.right <= d.getElementById('briefReady').getBoundingClientRect().right + 0.5, 'inside the row')
    } finally { f.remove() }
  })

  // Review fix: at 720px the Copy brief button was 510px of violet, the
  // modes spread over 680px and Read sat 215px past the text it controls.
  it('a wide panel keeps the top, the framing, the bar and the reply to the brief\'s column', async () => {
    for (const w of [320, 520, 720]) {
      const f = await paneFrame('', d => {
        d.getElementById('promptOutput').innerHTML = '<p>' + 'A plan read in a wide panel keeps one column. '.repeat(30) + '</p>'
        d.getElementById('briefOutlineBtn').hidden = false
        d.getElementById('briefTokens').textContent = 'About 2.6k tokens'
        d.getElementById('briefFramingSummary').textContent = 'This repo, in Claude Code, read the code first'
      }, w)
      try {
        const d = f.contentDocument
        const r = id => d.getElementById(id).getBoundingClientRect()
        const md = r('promptOutput'), copy = r('copyPromptBtn'), modes = r('modeGroup'), read = r('briefReadBtn')
        assert.eq(Math.round(r('rightPanel').width), w, `a ${w}px panel`)
        const mdText = md.right - 16
        assert.ok(copy.right <= md.right + 1 && modes.right <= md.right + 1, `${w}: the top keeps to the column (${modes.right} vs ${md.right})`)
        assert.ok(Math.abs(read.right - mdText) <= 9, `${w}: Read ends where the text does (${read.right} vs ${mdText})`)
        assert.ok(r('briefFramingBtn').right <= md.right + 1, `${w}: the framing row too`)
        assert.ok(Math.abs(d.querySelector('.brief-reply-head').getBoundingClientRect().right - mdText) <= 1, `${w}: and the reply row ends with the text`)
        if (w === 720) assert.ok(copy.width < 360, `720: Copy brief is ${copy.width}px, not the panel's width`)
      } finally { f.remove() }
    }
  })

  it('the brief\'s bar holds the section, the size and Read on one row, legible in both themes', async () => {
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
    for (const theme of ['', 'light-mode']) {
      const f = await paneFrame(theme, d => {
        d.getElementById('briefOutlineBtn').hidden = false
        d.getElementById('briefSectionName').textContent = 'Assumptions (validate before building)'
        d.getElementById('briefTokens').textContent = 'About 12.4k tokens'
      })
      try {
        const d = f.contentDocument, win = f.contentWindow
        const [outline, tokens, read] = ['briefOutlineBtn', 'briefTokens', 'briefReadBtn'].map(id => d.getElementById(id).getBoundingClientRect())
        assert.ok(Math.abs(outline.top - read.top) < 1 && Math.abs(tokens.top - read.top) < 1, `${theme || 'dark'}: one row`)
        assert.ok(outline.right <= tokens.left && tokens.right <= read.left, 'in order, not overlapping')
        const bar = d.querySelector('.brief-docbar').getBoundingClientRect()
        assert.ok(read.right <= bar.right, 'Read inside the bar')
        const btn = d.getElementById('briefReadBtn')
        const bg = cssRgba(win.getComputedStyle(d.querySelector('.brief-docbar')).backgroundColor).slice(0, 3)
        const r = ratio(cssRgba(win.getComputedStyle(btn).color).slice(0, 3), bg)
        assert.ok(r >= 4.5, `${theme || 'dark'}: Read at ${r.toFixed(2)}:1`)
        assert.ok(parseFloat(win.getComputedStyle(btn).fontSize) >= 11)
        assert.ok(btn.getBoundingClientRect().height >= 24, 'a 24px target')
        btn.setAttribute('aria-pressed', 'true')
        const edge = ratio(cssRgba(win.getComputedStyle(btn).borderTopColor).slice(0, 3), bg)
        assert.ok(edge >= 3, `${theme || 'dark'}: pressed edge ${edge.toFixed(2)}:1`)
      } finally { f.remove() }
    }
  })
})

// ═════════════════════════════════════════════════════════════
describe('reading: every Copy brief copies the scope chosen in the Brief tab, and says so', () => {
  // Review fix: with Selection chosen, File's row and the palette's own row
  // were both "Copy brief for the selection", and nothing in Cmd+K copied
  // the whole map.
  it('Cmd+K lists each scope once, by a name of its own, and each row copies what it names', async () => {
    await mountPanel()
    fixture()
    let copied = null
    const savedSnap = promptState.lastSnapshot
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { copied = t } } })
    const onCopy = e => copyRequest(e.detail)
    window.addEventListener('pf:copy-brief', onCopy)
    // File's row as ui-panels.js setupExportDropdown wires it.
    const fileRow = () => window.dispatchEvent(new CustomEvent('pf:copy-brief', { detail: { scope: 'map' } }))
    byId('exportCopyPrompt').addEventListener('click', fileRow)
    const copyRows = () => commandGroups().flatMap(g => g.items).filter(r => r && /^Copy brief/.test(r.label))
    try {
      selection.ids.add('g1'); selection.blockId = 'g1'
      for (const scope of ['map', 'selection']) {
        setBriefScope(scope)
        const labels = copyRows().map(r => r.label)
        assert.deepEq([...labels].sort(), scope === 'map'
          ? ['Copy brief', 'Copy brief for the selection']
          : ['Copy brief for the selection', 'Copy brief for the whole map'], `${scope}: ${labels}`)
        assert.eq(new Set(labels).size, labels.length, 'no two rows with one name')
      }
      const whole = copyRows().find(r => r.label === 'Copy brief for the whole map')
      whole.run(); await tick(); await tick()
      assert.eq(copied, generatePrompt(), 'the whole map, though Selection is chosen')
      const part = copyRows().find(r => r.label === 'Copy brief for the selection')
      part.run(); await tick(); await tick()
      assert.includes(copied, '## Scope', 'File\'s row copies the chosen part')
    } finally {
      window.removeEventListener('pf:copy-brief', onCopy)
      byId('exportCopyPrompt')?.removeEventListener('click', fileRow)
      delete navigator.clipboard
      dropToasts()
      promptState.lastSnapshot = savedSnap
      setBriefCoverage(null)
      setBriefScope('map'); clear(); runGapDetection()
    }
  })

  it('Selection: the status bar\'s button carries the tag and File\'s row names it; the whole map clears both', async () => {
    await mountPanel()
    fixture()
    try {
      selection.ids.add('g1'); selection.ids.add('r1'); selection.blockId = 'g1'
      assert.eq(setBriefScope('selection'), 'selection')
      const pill = byId('copyPromptPill'), tag = pill.querySelector('.quick-copy-scope')
      assert.ok(tag && !tag.hidden, 'a Selection tag')
      assert.eq(tag.textContent, 'Selection')
      assert.eq(pill.getAttribute('aria-label'), 'Copy brief for the selection')
      assert.includes(pill.title, '2 selected blocks')
      assert.eq(fileMenuItems(byId('fileActions'), { readOnly: false }).find(i => i.rowId === 'exportCopyPrompt').label, 'Copy brief for the selection')
      setBriefScope('map')
      assert.ok(tag.hidden)
      assert.eq(pill.getAttribute('aria-label'), 'Copy brief')
      assert.eq(pill.title, 'Copy the brief for the whole map')
      assert.eq(fileMenuItems(byId('fileActions'), { readOnly: false }).find(i => i.rowId === 'exportCopyPrompt').label, 'Copy brief')
      // Nothing selected: the scope falls back to the whole map, and so do the words.
      setBriefScope('selection')
      selection.ids.clear(); selection.blockId = null
      syncCopyScope()
      assert.ok(tag.hidden, 'no selection, no tag')
    } finally { setBriefScope('map'); clear() }
  })

  it('a copy asked for elsewhere copies the chosen scope; only an explicit request for the selection overrides it', async () => {
    await mountPanel()
    fixture()
    let copied = null
    const savedSnap = promptState.lastSnapshot
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { copied = t } } })
    try {
      selection.ids.add('g1'); selection.blockId = 'g1'
      setBriefScope('selection')
      assert.ok(await copyRequest({ scope: 'map' }), 'File\'s row sends map: it copies what it says')
      assert.includes(copied, '## Scope')
      setBriefScope('map')
      assert.ok(await copyRequest({ scope: 'map' }))
      assert.eq(copied, generatePrompt())
      assert.ok(await copyRequest({ scope: 'selection' }), 'Cmd+K\'s row asks for the selection by name')
      assert.includes(copied, '## Scope')
      setBriefScope('selection')
      assert.ok(await copyRequest({ scope: 'whole' }), 'and for the whole map by name')
      assert.eq(copied, generatePrompt())
    } finally {
      delete navigator.clipboard
      dropToasts()
      promptState.lastSnapshot = savedSnap
      setBriefCoverage(null)
      setBriefScope('map'); clear(); runGapDetection()
    }
  })
})

// ═════════════════════════════════════════════════════════════
describe('reading: a reply that cannot be read says what to try', () => {
  it('pins the patch refusals: what is wrong, then the next move', () => {
    const r = t => extractPatch(t)
    assert.deepEq(r('Sure! Here is my analysis. The risk is real.'), {
      error: 'No pathfinder-patch block found in this reply.',
      hint: 'Paste the whole reply, including the fenced block at its end. If it has none, ask the assistant to end with the pathfinder-patch block the brief describes, or copy the brief again if the reply came from an older one.',
    })
    assert.deepEq(r('Here it is:\n```pathfinder-patch\n{"format": "pathfinder-patch", "status": ['), {
      error: 'The pathfinder-patch block is cut off: its closing fence is missing.',
      hint: 'Paste the whole reply down to its last line, or ask the assistant to send the block again.',
    })
    assert.deepEq(r('```pathfinder-patch\n{\n  "format": "pathfinder-patch",\n  "status": [,]\n}\n```'), {
      error: 'The pathfinder-patch block is not valid JSON, near line 3 of the block.',
      hint: 'Ask the assistant to send the block again as plain JSON, or fix that line in the box above.',
    })
    assert.deepEq(r('```pathfinder-patch\n[1, 2]\n```'), PATCH_ERRORS.notObject)
    assert.eq(r('{"blocks": {"a": {}}}').error, 'That looks like a whole canvas, not a patch.')
    assert.eq(r('{"blocks": {"a": {}}}').hint, `Open it with ${ROWS.importFile} instead; a patch only lists changes.`)
    assert.deepEq(r('{"status": []}'), {
      error: 'The block is missing "format": "pathfinder-patch".',
      hint: 'Add that line as its first field, or ask the assistant to send the block again exactly as the brief describes.',
    })
    assert.deepEq(r('{"format": "pathfinder-patch", "version": 2}'), {
      error: 'This patch says version 2; Pathfinder reads version 1.',
      hint: 'Ask the assistant to send it again as a version 1 pathfinder-patch, the format the brief describes.',
    })
  })

  // Review fix: accepting a patch outside its block changed what the
  // parser takes, beyond this stream's error copy. It is refused, as it was
  // before, and the refusal says where the patch sits and how to fix it.
  it('a patch written without its label is refused, saying where it sits and what to do', () => {
    const body = '{"format": "pathfinder-patch", "status": [{"block": "a", "status": "done"}]}'
    assert.deepEq(extractPatch('Here you go:\n```json\n' + body + '\n```\nThanks.'), {
      error: 'The patch in this reply is in a block not labelled pathfinder-patch.',
      hint: 'Write pathfinder-patch after the three backticks that open that block, or ask the assistant to send it again as the brief describes.',
    })
    assert.deepEq(extractPatch('The changes: ' + body + ' Let me know.'), {
      error: 'The patch in this reply is not in a pathfinder-patch block.',
      hint: 'Paste only the patch, from its first { to its last }, or ask the assistant to send it again in a pathfinder-patch block.',
    })
    assert.deepEq(extractPatch('```js\nrun()\n```\nand then ' + body), PATCH_ERRORS.unlabelledBare, 'a block before it is not its block')
    assert.deepEq(extractPatch('```json\n{"format": "something-else"}\n```'), PATCH_ERRORS.noBlock, 'only a patch that says what it is')
    // What still reads: the labelled block, and a paste of the patch alone.
    assert.eq(extractPatch('Here:\n```pathfinder-patch\n' + body + '\n```').patch?.format, 'pathfinder-patch')
    assert.eq(extractPatch(body).patch?.status?.[0]?.status, 'done')
  })

  it('the preview shows both parts beside the warning icon, the format\'s name as code', async () => {
    await mountPanel()
    setupPatchUI()
    try {
      const input = byId('patchInput')
      input.value = 'A plain chat answer with no block.'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const err = byId('patchPreview').querySelector('.patch-op.err')
      assert.ok(err, 'an error row')
      assert.eq(err.getAttribute('role'), 'status')
      assert.ok(err.querySelector('svg.patch-err-icon'), 'never a colour alone')
      assert.eq(err.querySelector('.patch-err-what').textContent, 'No pathfinder-patch block found in this reply.')
      assert.match(err.querySelector('.patch-err-next').textContent, /^Paste the whole reply/)
      assert.eq(err.querySelector('code')?.textContent, 'pathfinder-patch')
      assert.notIncludes(err.textContent, '```')
      assert.ok(byId('patchApplyBtn').hidden, 'no button that cannot run')
      // A patch with nothing in it says what a patch carries.
      input.value = '{"format": "pathfinder-patch"}'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      assert.eq(byId('patchPreview').querySelector('.patch-err-what')?.textContent, 'The patch has no changes in it.')
      assert.includes(byId('patchPreview').querySelector('.patch-err-next').textContent, 'an answer, a verdict, a status, criteria, a note, a block or a connection')
    } finally { byId('patchInput').value = ''; byId('patchPreview').innerHTML = '' }
  })
})

describe('reading: a file or a link that cannot open says what to try', () => {
  it('pins the import refusals, each naming the thing in hand, in two short sentences', () => {
    assert.eq(readIncoming('   ').error, 'That file is empty. Check it is the map you meant: a Pathfinder .json, a .canvas file or a Mermaid flowchart.')
    assert.eq(readIncoming('hello world').error, 'That file is not a map Pathfinder can open. Choose a Pathfinder .json, a .canvas file or a Mermaid flowchart.')
    assert.eq(readIncoming('{\n  "blocks": {\n    "a": \n  }\n}').error,
      'That file is damaged near line 4. Export the map again with File, Export, Download JSON.')
    assert.eq(readIncoming('flowchart LR\n%% nothing yet').error,
      'That Mermaid text has no flowchart nodes. Start it with "flowchart LR" and a line such as A[Goal] --> B[Work].')
    assert.eq(readIncoming('{"nodes": [], "edges": []}').error, 'That JSON Canvas file has no cards. Export it again from the app that made it.')
    assert.eq(readIncoming('{"format": "pathfinder-maps", "maps": []}').error, 'That file holds several maps. Open it with Maps, Import maps (JSON).')
    assert.eq(readIncoming('{"format": "pathfinder-patch", "status": []}').error, 'That is a pathfinder-patch, not a map. Paste it in the Brief tab, under Bring the reply back.')
    assert.eq(readIncoming('{"title": "Plan"}').error, 'That file has no blocks or connections. Check it is a map saved with File, Export, Download JSON.')
    assert.eq(readIncoming('[1, 2, 3]').error, IMPORT_ERRORS.noMap())
    assert.eq(readIncoming('x'.repeat(MAX_IMPORT_CHARS + 1)).error,
      'That file is 8 MB, and a map can be 8 MB at most. Check it is the map you meant.')
    assert.eq(readIncoming('', { source: 'src' }).error, IMPORT_ERRORS.empty('the file at that link'))
    assert.match(readIncoming('', { source: 'src' }).error, /^The file at that link is empty\./)
    assert.eq(readIncoming('not a map', { source: 'src' }).error,
      'The file at that link is not a map Pathfinder can open. Link to a Pathfinder .json, a .canvas file or a Mermaid flowchart.')
    // Short enough to read at a glance in a toast: two sentences, at most 30 words.
    const args = { tooLarge: [9_400_000], damaged: [12, 'that file', 'pathfinder'], mapsDamaged: [3] }
    for (const [k, f] of Object.entries(IMPORT_ERRORS)) {
      const text = f(...(args[k] || []))
      assert.ok(text.split(/\s+/).length <= 30, `${k}: ${text.split(/\s+/).length} words`)
      assert.eq((text.match(/[.](\s|$)/g) || []).length, 2, `${k}: what is wrong, then what to try`)
    }
  })

  // Review fix: a damaged JSON Canvas from another app was told to export
  // again from Pathfinder.
  it('a damaged file is advised by what it looks like: a Pathfinder map, a JSON Canvas, or neither', () => {
    assert.eq(damagedKind('{"blocks": {"a": '), 'pathfinder')
    assert.eq(damagedKind('{"nodes": [ {"id": "x", } ], "edges": []}'), 'canvas')
    assert.eq(damagedKind('{"title": "x",, }'), null)
    assert.eq(readIncoming('{"nodes": [ {"id": "x", } ], "edges": []}').error,
      'That file is damaged near line 1. Export it again from the app that made it.')
    assert.eq(readIncoming('{"title": "x",, }').error,
      'That file is not valid JSON near line 1. Export it again from the app that made it.')
    assert.notIncludes(readIncoming('{"nodes": [ {"id": "x", } ]}').error, 'Pathfinder')
  })

  // Review fix: menu rows were named three ways ("File, Import", "File,
  // Import JSON / Canvas / Mermaid", "an Export all backup").
  it('every menu row a refusal names is spelled as the menus spell it', async () => {
    const doc = await indexDoc()
    const rowText = id => doc.getElementById(id)?.textContent.trim().replace(/\s+/g, ' ').replace(/\u2026$/, '')
    const header = { File: rowText('exportBtn'), Share: rowText('shareBtn'), Maps: doc.querySelector('#mapsBtn .map-crumb-word')?.textContent }
    const rows = { importFile: 'importJSON', downloadJson: 'exportJSON', downloadMarkdown: 'exportMarkdown', copyLink: 'shareCopyLink' }
    const maps = mapsMenuItems().map(i => i.label).filter(Boolean)
    for (const [key, path] of Object.entries(ROWS)) {
      if (key === 'replyBack') {
        assert.includes(path, doc.getElementById('replyHeading').textContent.trim())
        continue
      }
      const parts = path.split(', ')
      const menu = parts[0], row = parts[parts.length - 1], sub = parts.length > 2 ? parts[1] : null
      assert.eq(header[menu], menu, `${key}: a ${menu} menu in the header`)
      if (rows[key]) assert.eq(rowText(rows[key]), row, `${key}: File and Share rows`)
      else assert.ok(maps.includes(row), `${key}: "${row}" in Maps`)
      // A row inside one of File's submenus (MENUS) names that submenu, and
      // a row the File menu shows at its top level names none.
      if (menu === 'File') {
        const key2 = doc.getElementById(rows[key])?.dataset.fileMenu || null
        const subName = key2 ? FILE_MENUS.find(([k]) => k === key2)?.[1] : null
        assert.eq(sub, subName, `${key}: File's ${subName || 'top level'}`)
      }
    }
    // And every refusal uses these spellings, never another.
    const args = { tooLarge: [9_400_000], damaged: [12, 'that file', 'pathfinder'], mapsDamaged: [3] }
    const all = [...Object.entries(IMPORT_ERRORS).map(([k, f]) => f(...(args[k] || []))), ...Object.values(LINK_ERRORS).map(f => f(500)),
      ...Object.values(PATCH_ERRORS).map(v => typeof v === 'function' ? v(1) : v).map(e => `${e.error} ${e.hint}`), MEETING_SUMMARY_FAILED()]
    for (const text of all) {
      for (const m of text.matchAll(/\b(File|Maps|Share), /g)) {
        const rest = text.slice(m.index)
        assert.ok(Object.values(ROWS).some(row => rest.startsWith(row)), `"${rest.slice(0, 40)}" in: ${text}`)
      }
      assert.notIncludes(text, 'Export all backup')
    }
  })

  it('still reads what it reads: a map, a JSON Canvas and a Mermaid flowchart', () => {
    assert.eq(readIncoming('{"blocks": {"a": {"id": "a", "type": "goal", "title": "Ship"}}, "arrows": []}').format, 'pathfinder')
    const canvas = readIncoming('{"nodes": [{"id": "n1", "type": "text", "text": "Goal: ship", "x": 0, "y": 0, "width": 200, "height": 80}], "edges": []}')
    assert.eq(canvas.format, 'canvas')
    assert.eq(canvas.data.blocks.length, 1)
    const mermaid = readIncoming('flowchart LR\n  A[Ship the beta] --> B[Collect feedback]')
    assert.eq(mermaid.format, 'mermaid')
    assert.eq(mermaid.data.blocks.length, 2)
  })

  it('finds the line a JSON error points at, from the engine\'s words or, failing those, from the text', () => {
    assert.eq(jsonErrorLine('a\nb\nc', { message: 'Unexpected token } in JSON at position 4' }), 3)
    assert.eq(jsonErrorLine('', { message: 'Expected \',\' or \'}\' after property value in JSON at position 20 (line 2 column 5)' }), 2)
    assert.eq(jsonErrorLine('', { message: 'JSON.parse: expected property name at line 7 column 3 of the JSON data' }), 7)
    // V8's "Unexpected token" names no place: the text is scanned.
    assert.eq(jsonErrorLine('{\n  "a": 1,\n  "b": }\n', { message: 'Unexpected token \'}\'' }), 3)
    assert.eq(jsonErrorLine('[1, 2,\n 3,\n]', { message: '' }), 3, 'a trailing comma')
    assert.eq(jsonErrorLine('{"a": "x\ny"}', { message: '' }), 1, 'a raw newline inside a string')
    assert.eq(jsonErrorLine('{"a": [1, {"b": null}], "c": -2.5e3, "d": "\\"q\\""}', { message: '' }), null, 'valid JSON has no error line')
    // The scanner agrees with JSON.parse on what parses.
    for (const t of ['{}', '[]', '"s"', '0', '-0.5', 'true', 'null', '{"a":{"b":[1,2,{"c":"d"}]}}', '{"a":1,}', '[01]', '{a:1}', '"\\u00e9"', '1 2', '']) {
      let ok = true
      try { JSON.parse(t) } catch (_) { ok = false }
      assert.eq(jsonErrorLine(t, { message: '' }) === null, ok, `${JSON.stringify(t)} ${ok ? 'parses' : 'does not parse'}`)
    }
  })

  it('pins the link refusals and picks the one a failure deserves', () => {
    assert.eq(LINK_ERRORS.damaged(), 'That share link is damaged or cut short. Open it again from the original message, or ask for the map as a file.')
    assert.eq(LINK_ERRORS.empty(), 'That share link has no map in it. Ask for the link again (Share, Copy link).')
    assert.eq(LINK_ERRORS.srcHttp(404), 'The map at that link did not load (HTTP 404). Download the file and open it with File, Import JSON / Canvas / Mermaid.')
    assert.eq(linkError(new Error('Link payload too large')), LINK_ERRORS.tooLarge())
    assert.eq(linkError(new Error('Invalid character')), LINK_ERRORS.damaged())
    assert.eq(linkError(null, { compression: false }), LINK_ERRORS.noCompression())
    for (const [k, f] of Object.entries(LINK_ERRORS)) {
      const text = f(404)
      assert.ok(text.split(/\s+/).length <= 30, `${k}: ${text.split(/\s+/).length} words`)
    }
  })

  it('the meeting summary that fails says what to try', () => {
    assert.eq(MEETING_SUMMARY_FAILED(), 'Could not export the meeting summary. Try again, or save the map as text with File, Export, Download Markdown.')
  })

  // Review fix (major): a refusal with a next step was a 6 second toast,
  // gone before it could be read (42 words for a damaged link).
  it('a refusal stays on screen until it is dismissed or the next message replaces it', () => {
    const delays = []
    const realTimeout = window.setTimeout
    window.setTimeout = (fn, ms, ...rest) => { delays.push(ms); return realTimeout(fn, 2 ** 30, ...rest) }
    try {
      showRefusal(LINK_ERRORS.damaged())
    } finally { window.setTimeout = realTimeout }
    try {
      assert.ok(delays.length && delays.every(ms => ms >= 2 ** 31 - 1), `no timer shorter than the longest a browser waits: ${delays}`)
      const toast = document.querySelector('.toast-notification')
      assert.eq(toast.querySelector('.toast-msg').textContent, LINK_ERRORS.damaged())
      const dismiss = toast.querySelector('button.toast-action')
      assert.eq(dismiss?.textContent, 'Dismiss', 'a way to close it')
      dismiss.click()
      assert.eq(document.querySelector('.toast-notification'), null, 'gone when dismissed')
    } finally { dropToasts() }
  })

  // The em and en dash, written by code point so this file holds neither.
  const DASHES = new RegExp([0x2014, 0x2013].map(c => String.fromCharCode(c)).join('|') + '| -- ')

  it('every refusal names a next move, in sentence case, with no em dash and no raw fence', () => {
    const NEXT = /\b(Export|Ask|ask|Paste|Open|open|Check|Choose|Download|download|Fix|fix|Update|Start|Add|Pick|Copy|copy|tick|Write|Link|Try)\b/
    const args = { tooLarge: [9_400_000], damaged: [12] }
    const all = [
      ['meeting summary', MEETING_SUMMARY_FAILED()],
      ['damaged, a canvas', IMPORT_ERRORS.damaged(3, 'that file', 'canvas')], ['damaged, a map', IMPORT_ERRORS.damaged(3, 'that file', 'pathfinder')],
      ...Object.entries(IMPORT_ERRORS).map(([k, f]) => [k, f(...(args[k] || []))]),
      ['damaged, no line', IMPORT_ERRORS.damaged(null)], ['unknown, a link', IMPORT_ERRORS.unknown('the file at that link')],
      ...Object.entries(LINK_ERRORS).map(([k, f]) => [k, f(500)]),
      ...Object.entries(PATCH_ERRORS).filter(([k]) => k !== 'empty').map(([k, v]) => { const e = typeof v === 'function' ? v(3) : v; return [k, `${e.error} ${e.hint}`] }),
    ]
    for (const [k, text] of all) {
      assert.ok(typeof text === 'string' && text.length > 20, k)
      assert.match(text, NEXT, `${k} names what to try: ${text}`)
      assert.ok(!DASHES.test(text), `${k}: no dash used as punctuation`)
      assert.notIncludes(text, '```', k)
      assert.match(text, /^[A-Z]/, `${k} starts with a capital`)
      assert.match(text, /[.)]$/, `${k} ends a sentence`)
    }
  })

  it('a ?src= that cannot load says what to try, in its toast', async () => {
    const url = location.href, fetchBefore = window.fetch, ro = ui.readOnly
    ui.readOnly = false
    try {
      history.replaceState(null, '', '?src=' + encodeURIComponent('http://example.com/a.json'))
      await checkSrcUrl()
      assert.eq(toastText(), LINK_ERRORS.srcNotHttps())
      assert.eq(document.querySelector('.toast-notification .toast-action')?.textContent, 'Dismiss', 'it waits to be dismissed')
      window.fetch = async () => ({ ok: false, status: 404, text: async () => '' })
      history.replaceState(null, '', '?src=%2Fgone.json')
      await checkSrcUrl()
      assert.eq(toastText(), LINK_ERRORS.srcHttp(404))
      window.fetch = async () => ({ ok: true, status: 200, text: async () => 'not a map at all' })
      history.replaceState(null, '', '?src=%2Fnotes.txt')
      await checkSrcUrl()
      assert.eq(toastText(), IMPORT_ERRORS.unknown('the file at that link'))
      window.fetch = async () => { throw new TypeError('Failed to fetch') }
      history.replaceState(null, '', '?src=%2Foffline.json')
      await checkSrcUrl()
      assert.eq(toastText(), LINK_ERRORS.srcNetwork())
    } finally { window.fetch = fetchBefore; ui.readOnly = ro; history.replaceState(null, '', url); dropToasts() }
  })

  it('a damaged share link says so, the old #s= kind too, which used to be ignored in silence', async () => {
    const url = location.href, ro = ui.readOnly
    ui.readOnly = false
    try {
      history.replaceState(null, '', location.pathname + location.search + '#s=%%%not-base64')
      checkShareUrl()
      assert.eq(toastText(), LINK_ERRORS.damaged())
      // Review fix: the link leaves the address, as a failed ?src= does, so
      // a reload does not raise the same refusal again.
      assert.eq(location.hash, '', '#s= gone from the address')
      assert.eq(checkShareUrl(), undefined, 'nothing left to report on a reload')
      dropToasts()
      history.replaceState(null, '', location.pathname + location.search + '#z=@@@@')
      await checkShareUrl()
      assert.ok([LINK_ERRORS.damaged(), LINK_ERRORS.noCompression()].includes(toastText()), toastText())
      assert.eq(location.hash, '', '#z= gone too')
    } finally { ui.readOnly = ro; history.replaceState(null, '', url); dropToasts() }
  })
})

// ═════════════════════════════════════════════════════════════
describe('reading: a reply that reaches outside the brief it answers', () => {
  const patch = { format: 'pathfinder-patch',
    status: [{ block: 'g1', status: 'in-progress' }, { block: 'i2', status: 'done' }],
    criteria: [{ block: 'r1', add: ['Numbers refresh hourly'] }],
    blocks: [{ id: 'n1', type: 'risk', title: 'Digest lands in spam' }],
    arrows: [{ from: 'n1', to: 'i2' }],
  }

  it('labels a change to a block the copied brief did not cover, leaves it unticked, and applies it when ticked', () => {
    fixture()
    const { scope } = briefScope(['g1'])
    try {
      setBriefCoverage([...scope])
      assert.ok(!scope.has('i2'), 'the job is outside the goal\'s brief')
      const plan = buildPlan(patch)
      const op = (kind, pred) => plan.ops.find(o => o.kind === kind && pred(o))
      const inside = op('status', o => o.label.includes('Faster status notes'))
      const outside = op('status', o => o.label.includes('Weekly digest job'))
      const link = op('arrow', () => true)
      assert.ok(inside.selected && !inside.outside)
      assert.deepEq(outside.outside, ['i2'])
      assert.ok(!outside.selected, 'waits to be ticked')
      assert.deepEq(link.outside, ['i2'], 'a connection to it too')
      assert.ok(!op('block', () => true).outside, 'a new block is nobody\'s outside')
      assert.eq(previewSummary(plan), '3 of 5 operations will apply. 2 changes touch blocks outside the brief you copied: tick them to include them.')
      setPlanSelected(plan, outside.id, true)
      assert.eq(applyPlan(plan), 4)
      assert.eq(state.blocks.i2.status, 'done', 'applied when chosen')
      assert.eq(state.blocks.g1.status, 'in-progress')
    } finally { setBriefCoverage(null); clear() }
  })

  it('a whole-map brief, another map\'s brief and no brief label nothing', () => {
    fixture()
    try {
      setBriefCoverage(null)
      assert.eq(briefCoverages(), null)
      assert.ok(buildPlan(patch).ops.every(o => !o.outside))
      setBriefCoverage(['g1'], 'another-map-entirely')
      assert.eq(briefCoverages(), null)
      assert.ok(buildPlan(patch).ops.every(o => !o.outside && (o.selected || !o.ok)))
      setBriefCoverage(Object.keys(state.blocks))
      assert.ok(buildPlan(patch).ops.every(o => !o.outside), 'the whole map covers every block it had')
    } finally { setBriefCoverage(null); clear() }
  })

  // Review fix: coverage was one in-memory record. A reload lost it, and a
  // reply to part A pasted after copying part B had A's own changes
  // labelled outside and unticked.
  it('keeps the last few briefs per map for the session: a reply to an earlier part finds its blocks covered', () => {
    fixture()
    try {
      const partA = [...briefScope(['g1']).scope], partB = [...briefScope(['i2']).scope]
      assert.ok(!partA.includes('i2') && !partB.includes('a1'), 'two parts, each missing a block of the other')
      setBriefCoverage(partA)
      setBriefCoverage(partB)
      const replyToA = { format: 'pathfinder-patch', status: [{ block: 'a1', status: 'done' }, { block: 'g1', status: 'in-progress' }] }
      assert.ok(buildPlan(replyToA).ops.every(o => !o.outside && o.selected), 'A\'s own changes are A\'s')
      // Kept for the tab's session, so a reload still knows them.
      const kept = JSON.parse(sessionStorage.getItem(COVERAGE_KEY))
      assert.eq(Object.values(kept)[0].length, 2, 'both briefs, newest first')
      assert.deepEq([...kept[Object.keys(kept)[0]][0]].sort(), [...partB].sort())
      // A change no recent brief covered all of is still outside; a
      // connection between the two parts names both ends.
      assert.deepEq(outsideBriefs(['a1', 'i2']), ['a1', 'i2'])
      assert.deepEq(outsideBriefs(['a1']), [])
      // Five per map, the oldest dropped; copying the same part again moves it to the front.
      for (let i = 0; i < 6; i++) setBriefCoverage(['g1', 'b' + i])
      assert.eq(JSON.parse(sessionStorage.getItem(COVERAGE_KEY))[Object.keys(kept)[0]].length, 5)
      // A map cleared or replaced since: its briefs no longer apply.
      setBriefCoverage(null); setBriefCoverage(['gone1', 'gone2'])
      assert.eq(briefCoverages(), null)
    } finally { setBriefCoverage(null); clear() }
  })

  it('copying a brief records what it covered: the selection\'s part, or every block of the whole map', async () => {
    fixture()
    const savedSnap = promptState.lastSnapshot
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })
    try {
      selection.ids.add('g1'); selection.blockId = 'g1'
      await copyBrief({ scope: 'selection' })
      assert.deepEq([...briefCoverages()[0]].sort(), [...briefScope(['g1']).scope].sort())
      await copyBrief({ scope: 'map' })
      assert.deepEq([...briefCoverages()[0]].sort(), Object.keys(state.blocks).sort())
      assert.eq(briefCoverages().length, 2)
    } finally {
      delete navigator.clipboard
      dropToasts()
      promptState.lastSnapshot = savedSnap
      setBriefCoverage(null); clear()
    }
  })

  it('the preview says it in words beside the row, and on the checkbox\'s name', async () => {
    await mountPanel()
    setupPatchUI()
    fixture()
    try {
      setBriefCoverage([...briefScope(['g1']).scope])
      const input = byId('patchInput')
      input.value = '```pathfinder-patch\n' + JSON.stringify({ format: 'pathfinder-patch', status: [{ block: 'g1', status: 'done' }, { block: 'i2', status: 'done' }] }) + '\n```'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const rows = [...byId('patchPreview').querySelectorAll('.patch-op')]
      const away = rows.find(r => r.classList.contains('outside'))
      assert.ok(away, 'one row is outside')
      assert.eq(away.querySelector('.patch-op-outside').textContent, 'outside the brief')
      const box = away.querySelector('input[type="checkbox"]')
      assert.ok(!box.checked)
      assert.includes(box.getAttribute('aria-label'), 'outside the brief')
      assert.includes(byId('patchPreview').querySelector('.patch-op-sum').textContent, 'outside the brief you copied')
      assert.eq(rows.filter(r => r.querySelector('.patch-op-outside')).length, 1)
    } finally { byId('patchInput').value = ''; byId('patchPreview').innerHTML = ''; setBriefCoverage(null); clear() }
  })
})

// ═════════════════════════════════════════════════════════════
describe('reading: on a question card the Answer leads', () => {
  const OPEN_KEY = 'pathfinder-insp-open'
  const ihost = { el: null, marks: [], saved: null }
  async function mountInspector() {
    if (ihost.el) return
    const doc = await indexDoc()
    const pane = document.importNode(doc.getElementById('inspectorPane'), true)
    pane.querySelectorAll('[id]').forEach(n => {
      const stub = document.getElementById(n.id)
      if (!stub) return
      const mark = document.createComment('stub ' + n.id)
      stub.replaceWith(mark)
      ihost.marks.push({ mark, stub })
    })
    ihost.el = document.createElement('div')
    ihost.el.className = 'panel-content'
    ihost.el.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:610px;overflow:auto;z-index:5'
    ihost.el.appendChild(pane)
    document.body.appendChild(ihost.el)
    try { ihost.saved = localStorage.getItem(OPEN_KEY) } catch (_) {}
    setupInspectorEvents()
  }
  function unmountInspector() {
    closeMenus()
    ihost.el?.remove(); ihost.el = null
    ihost.marks.forEach(({ mark, stub }) => mark.replaceWith(stub)); ihost.marks = []
    try { ihost.saved === null ? localStorage.removeItem(OPEN_KEY) : localStorage.setItem(OPEN_KEY, ihost.saved) } catch (_) {}
  }
  function card(id, type, title, extra = {}) {
    state.blocks[id] = { ...B(id, type, title), x: 40, y: 40, width: null, color: null, collapsed: false, groupId: null,
      cardStyle: null, borderWidth: null, highlight: null, ...extra }
    renderBlock(id)
  }
  function fresh() {
    document.activeElement?.blur?.()
    cleanupMockEls()
    clear(); deselectAll()
    state.blocks = {}
    canvasMeta.situation = { ...SITUATION_DEFAULT }
  }
  const isBefore = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

  it('sits right under the Title, before the description, and Questions waits closed even when left open elsewhere', async () => {
    await mountInspector()
    fresh()
    localStorage.setItem(OPEN_KEY, JSON.stringify({ questions: true }))
    card('q', 'question', 'Does it happen on staging?', { description: 'If staging is clean, the cause is the environment.' })
    selectBlock('q')
    const section = byId('answerSection'), title = byId('inspTitle').closest('.insp-section'), desc = byId('inspDesc').closest('.insp-section')
    assert.eq(section.previousElementSibling, title, 'the Answer leads')
    assert.ok(isBefore(section, desc), 'the description is its context, after it')
    assert.ok(section.style.display !== 'none')
    assert.eq(byId('questionsDetails').open, false, 'no second, empty place to write the answer')
  })

  it('an empty Answer keeps Questions closed even with a sub-question; once answered, an open sub-question opens it', async () => {
    await mountInspector()
    fresh()
    localStorage.removeItem(OPEN_KEY)
    card('q', 'question', 'Which region?', { questions: [{ text: 'Who owns the data?' }] })
    card('q2', 'question', 'Which plan?', { answer: 'The team plan.', status: 'done', questions: [{ text: 'Who pays?' }] })
    selectBlock('q')
    assert.eq(byId('questionsDetails').open, false, 'the empty Answer comes first')
    selectBlock('q2')
    assert.eq(byId('questionsDetails').open, true, 'answered: the open sub-question is next')
  })

  // Review fix: the empty-and-closed rule reached every type and overrode
  // the remembered state there, beyond the question card this stream owns.
  it('other types keep the remembered state, and open for an unanswered question as before', async () => {
    await mountInspector()
    fresh()
    localStorage.setItem(OPEN_KEY, JSON.stringify({ questions: true }))
    card('r', 'requirement', 'Works offline')
    card('r2', 'requirement', 'Exports to PDF', { questions: [{ text: 'Which page size?' }] })
    selectBlock('r')
    assert.eq(byId('questionsDetails').open, true, 'left open elsewhere: still open')
    selectBlock('r2')
    assert.eq(byId('questionsDetails').open, true, 'an open question: open')
    localStorage.setItem(OPEN_KEY, JSON.stringify({}))
    deselectAll()
    selectBlock('r')
    assert.eq(byId('questionsDetails').open, false, 'nothing remembered and nothing asked: closed')
  })

  it('a block retyped from a question keeps its answer after its own fields, not under its title', async () => {
    await mountInspector()
    fresh()
    card('d', 'decision', 'Use the EU region', { answer: 'EU, for the data rules.' })
    selectBlock('d')
    const section = byId('answerSection')
    assert.eq(section.previousElementSibling, byId('rationaleSection'))
    assert.includes(section.textContent, 'Kept from when this was an open question.')
  })

  it('puts the harness back', () => {
    fresh()
    unmountInspector()
    unmountPanel()
    assert.eq(byId('answerSection'), null)
    assert.eq(byId('panelResizer'), null)
    assert.eq(storedPanelWidth(), null)
  })
})
