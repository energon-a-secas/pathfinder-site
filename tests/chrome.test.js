// ============================================================
//  chrome.test.js -- the header, its menus (File, Tidy, View,
//  Help) and the motion policy: nothing animates at rest, the
//  opt-in only moves the card you are looking at, and reduced
//  motion always wins.
// ============================================================

import { describe, it, assert, cleanupMockEls, cssRgba } from './test-utils.js'
import { state, ui, canvasMeta, getUndoHistory, getRedoFuture,
         resetSnapshotToken, GRID, snapshot } from '../js/state.js'
import { $, CARD_STYLES, DEFAULT_CARD_STYLE } from '../js/utils.js'
import { renderBlock, renderAllBlocks, undo, deselectAll } from '../js/render.js'
import { renderFrames } from '../js/canvas.js'
import { runGapDetection } from '../js/gaps.js'
import { closeMenus, isMenuOpen } from '../js/menu.js'
import { getPref, applyPrefs } from '../js/prefs.js'
import { isVotingMode, setVotingMode } from '../js/voting.js'
import { clearCanvas, getLayoutDir, setLayoutDir, undoKeyLabel, setupTemplates } from '../js/ui-panels.js'
import { TEMPLATES } from '../js/templates.js'
import { showToast, placeToast } from '../js/utils.js'
import { updateCanvasTitle } from '../js/render.js'
import { mapsMenuItems } from '../js/library.js'
import { viewMenuItems, fileMenuItems, shareMenuItems, tidyMenuItems, helpMenuItems, cardStyleItems,
         openViewMenu, openHeaderMenu, closeInlineMenus, setupViewMenu,
         setLightMode, setArrowText, setSnapToGrid } from '../js/view-menu.js'
import { chrome, toggleChrome, toggleZen, setupChrome } from '../js/chrome.js'

// ── Helpers ──────────────────────────────────────────────────

// Every key these tests may write, restored afterwards so the suite never
// changes the preferences of whoever runs it.
const KEYS = ['pathfinder-prefs', 'pathfinder-theme', 'pathfinder-arrowtext',
  'pathfinder-snap', 'pathfinder-pinports', 'pathfinder-tint', 'pathfinder-layout-dir']

function withStorage(fn) {
  const saved = KEYS.map(k => [k, localStorage.getItem(k)])
  const restore = () => {
    saved.forEach(([k, v]) => v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v))
    applyPrefs()
  }
  let out
  try { out = fn() } catch (err) { restore(); throw err }
  if (out instanceof Promise) return out.finally(restore)
  restore()
  return out
}

function reset() {
  closeMenus()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  ui.embed = false
  canvasMeta.cardStyle = DEFAULT_CARD_STYLE
  canvasMeta.spotlight = false
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
  $.canvasRoot().querySelectorAll('.block').forEach(el => el.remove())
  $.framesLayer().querySelectorAll('.frame').forEach(el => el.remove())
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '',
    x: 40, y: 40, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, cardStyle: null,
    borderWidth: null, highlight: null, ...extra }
  renderBlock(id)
}

const labels = items => items.filter(i => i && !i.type).map(i => i.label)
const find = (items, label) => items.find(i => i && i.label === label)

// The real header, parsed from the page itself rather than restated here.
let pageDoc = null
async function page() {
  if (!pageDoc) {
    const html = await (await fetch('../index.html')).text()
    pageDoc = new DOMParser().parseFromString(html, 'text/html')
  }
  return pageDoc
}

// ── Header markup ────────────────────────────────────────────

describe('chrome -- header markup', () => {
  it('holds Maps, File, Share, Tidy, View, Help and GitHub, in that order', async () => {
    const doc = await page()
    const actions = doc.querySelector('.header-bar .header-actions')
    const order = [...actions.children]
      .filter(el => el.matches('div, button, a'))
      .map(el => el.id || (el.classList.contains('header-github') ? 'github' : el.className))
    assert.deepEq(order, ['mapsWrapper', 'exportWrapper', 'shareWrapper', 'tidyGroup', 'viewBtn', 'helpBtn', 'github'])
    assert.match(doc.getElementById('exportBtn').textContent, /^File\b/)
  })

  it('drops the standalone controls that moved into the menus', async () => {
    const doc = await page()
    ;['themeBtn', 'cardsBtn', 'cardsWrapper', 'tintBtn', 'snapBtn', 'pinPortsBtn',
      'arrowTextBtn', 'tidyDirBtn', 'fitBtn'].forEach(id =>
      assert.ok(!doc.getElementById(id), `#${id} is gone`))
    assert.ok(!doc.querySelector('.header-bar a[href="trace.html"]'), 'Trace moved into the Help menu')
  })

  it('keeps every id that other modules look up', async () => {
    const doc = await page()
    ;['mapsWrapper', 'mapsBtn', 'importMapsFile', 'exportWrapper', 'exportBtn',
      'importFile', 'importJSON', 'exportCopyPrompt', 'copyDiagramInstructions', 'exportJSON',
      'exportMarkdown', 'exportMermaid', 'exportJsonCanvas', 'exportSpecBundle', 'exportPNG', 'exportSVG',
      'exportMeetingSummary', 'exportToPresentationSage', 'clearBtn', 'shareWrapper', 'shareBtn',
      'shareCopyLink', 'shareCopyReadOnly', 'shareCopyEmbed', 'tidyBtn', 'helpBtn',
      'readonlyBadge', 'canvasTitle'].forEach(id =>
      assert.ok(doc.getElementById(id), `#${id} is still in the page`))
  })

  it('keeps only Share in the bar on phones', async () => {
    const doc = await page()
    const kept = [...doc.querySelectorAll('.header-actions [data-keep-mobile]')].map(el => el.id)
    assert.deepEq(kept, ['shareWrapper'])
  })

  it('every control is a real button or link with a name, and a text label in the overflow panel', async () => {
    const doc = await page()
    const controls = [...doc.querySelectorAll('.header-actions button, .header-actions a')]
      .filter(el => !el.closest('.file-actions, .hdr-menu-source') && !el.closest('.export-dropdown'))
    assert.gte(controls.length, 8)
    controls.forEach(el => {
      assert.ok(el.tagName === 'BUTTON' || el.tagName === 'A', `${el.id} is a button or link`)
      const name = el.getAttribute('aria-label') || el.textContent.trim()
      assert.ok(name, `${el.id || el.className} has an accessible name`)
      // What the kit's panel shows: everything except the bar-only glyphs.
      const clone = el.cloneNode(true)
      clone.querySelectorAll('.hdr-when-bar, [aria-hidden="true"]').forEach(n => n.remove())
      assert.ok(clone.textContent.trim().length > 1, `${el.id || el.className} has a text label in the panel`)
    })
  })

  it('the File rows are buttons, import first and Clear last', async () => {
    const doc = await page()
    const rows = [...doc.querySelectorAll('#fileActions > [data-file-group]')]
    assert.ok(rows.every(r => r.tagName === 'BUTTON' && r.type === 'button'))
    assert.eq(rows[0].id, 'importJSON')
    assert.eq(rows[rows.length - 1].id, 'clearBtn')
    assert.eq(rows[rows.length - 1].dataset.fileGroup, 'danger')
  })

  it('Share is a menu of real buttons like File, not div rows with role=menuitem', async () => {
    const doc = await page()
    const rows = [...doc.querySelectorAll('#shareActions > button')]
    assert.deepEq(rows.map(r => r.id), ['shareCopyLink', 'shareCopyReadOnly', 'shareCopyEmbed'])
    assert.ok(rows.every(r => r.type === 'button'))
    assert.ok(!doc.querySelector('.header-bar .export-item'), 'no div rows left in the header markup')
    const items = shareMenuItems(doc.getElementById('shareActions'))
    assert.deepEq(labels(items), ['Copy link', 'Copy view-only link', 'Copy embed code'])
    assert.ok(items.every(i => i.icon && i.icon.startsWith('<svg')))
  })
})

// ── Header CSS ───────────────────────────────────────────────

describe('chrome -- header CSS', () => {
  it('shows File on view-only links, hides Tidy, and no longer hides theme controls on phones', async () => {
    const css = await (await fetch('../css/style.css')).text()
    assert.notIncludes(css, ':has(#themeBtn)')
    assert.notIncludes(css, '.readonly-mode #exportWrapper')
    assert.includes(css, '.readonly-mode #tidyGroup')
    assert.ok(!/\bglowAmber\b|\bglowYellow\b|\bpulseRed\b/.test(css), 'the old free-running gap glows are gone')
  })
})

// ── File menu ────────────────────────────────────────────────

describe('chrome -- File menu', () => {
  it('lists Import, then the exports, then Clear as a danger item, split by dividers', async () => {
    const doc = await page()
    const items = fileMenuItems(doc.getElementById('fileActions'), { readOnly: false })
    const rows = items.filter(i => !i.type)
    assert.eq(rows[0].rowId, 'importJSON')
    assert.match(rows[0].label, /^Import JSON \/ Canvas \/ Mermaid/)
    assert.eq(items[1].type, 'divider', 'a divider after Import')
    const last = rows[rows.length - 1]
    assert.eq(last.rowId, 'clearBtn')
    assert.ok(last.danger, 'Clear is a danger item')
    assert.eq(items[items.length - 2].type, 'divider', 'a divider before Clear')
    assert.eq(rows.length, 13)
    assert.ok(rows.every(r => r.icon && r.icon.startsWith('<svg')))
  })

  it('a view-only link keeps only the image, Markdown and Mermaid exports', async () => {
    const doc = await page()
    const items = fileMenuItems(doc.getElementById('fileActions'), { readOnly: true })
    assert.deepEq(items.filter(i => !i.type).map(i => i.rowId), ['exportMarkdown', 'exportMermaid', 'exportPNG', 'exportSVG'])
  })

  it('picking an entry clicks its row, so the existing listener runs', () => {
    const src = document.createElement('div')
    src.innerHTML = '<button type="button" id="chromeTestRow" data-file-group="data">Do it</button>'
    let clicks = 0
    src.querySelector('button').addEventListener('click', () => clicks++)
    const [item] = fileMenuItems(src, { readOnly: false })
    item.action()
    assert.eq(clicks, 1)
    assert.eq(item.label, 'Do it')
  })
})

// ── Clear this map ───────────────────────────────────────────

describe('chrome -- Clear this map', () => {
  it('removes blocks, connections, groups and their frames in one undo step', () => {
    reset()
    block('a', { groupId: 'g1' }); block('b', { x: 400, groupId: 'g1' })
    state.arrows = [{ id: 'x', from: 'a', to: 'b', style: 'routed' }]
    state.groups = { g1: { id: 'g1', label: 'Team' } }
    renderFrames()
    assert.eq($.framesLayer().querySelectorAll('.frame').length, 1, 'the frame is drawn')
    const before = getUndoHistory().length
    assert.ok(clearCanvas({ ask: false }))
    assert.eq(Object.keys(state.blocks).length, 0)
    assert.eq(state.arrows.length, 0)
    assert.eq(Object.keys(state.groups).length, 0)
    assert.eq($.canvasRoot().querySelectorAll('.block').length, 0)
    assert.eq($.framesLayer().querySelectorAll('.frame').length, 0, 'the frame goes with its group')
    assert.eq(getUndoHistory().length, before + 1, 'one undo step')
    undo()
    assert.eq(Object.keys(state.blocks).length, 2)
    assert.eq(state.arrows.length, 1)
    assert.ok(state.groups.g1)
    reset()
  })

  it('undoing a Clear takes the Brain Dump away again, and tells the listeners (QA)', () => {
    reset()
    const bd = document.createElement('div')
    bd.id = 'brainDump'
    document.body.appendChild(bd)
    let changed = 0
    const onChange = () => changed++
    window.addEventListener('pf:canvas-changed', onChange)
    try {
      block('a'); block('b', { x: 400 })
      assert.ok(clearCanvas({ ask: false }))
      assert.eq(bd.style.display, '', 'the empty state shows on the cleared map')
      changed = 0
      undo()
      assert.eq(Object.keys(state.blocks).length, 2, 'the blocks are back')
      assert.eq(bd.style.display, 'none', 'and the Brain Dump card is gone from over them')
      assert.ok(changed >= 1, 'undo announced the change')
      // The other way: undoing the only block brings the empty state back.
      reset()
      snapshot()
      block('only')
      undo()
      assert.eq(Object.keys(state.blocks).length, 0)
      assert.eq(bd.style.display, '', 'the empty state is back')
    } finally {
      window.removeEventListener('pf:canvas-changed', onChange)
      bd.remove()
      reset()
    }
  })

  it('does nothing on a view-only link, and nothing when the confirm is declined', () => {
    reset()
    block('a')
    ui.readOnly = true
    try { assert.eq(clearCanvas({ ask: false }), false) } finally { ui.readOnly = false }
    assert.ok(state.blocks.a)
    const realConfirm = window.confirm
    window.confirm = () => false
    try { assert.eq(clearCanvas(), false) } finally { window.confirm = realConfirm }
    assert.ok(state.blocks.a)
    assert.eq(getUndoHistory().length, 0)
    reset()
  })

  it('an empty map has nothing to clear: no question and no undo step', () => {
    reset()
    let asked = 0
    const realConfirm = window.confirm
    window.confirm = () => { asked++; return true }
    try { assert.eq(clearCanvas(), false) } finally { window.confirm = realConfirm }
    assert.eq(asked, 0, 'no confirm')
    assert.eq(getUndoHistory().length, 0, 'no undo step that would make the next Cmd+Z do nothing')
    reset()
  })

  it('the confirm names undo the way this platform spells it', () => {
    assert.eq(undoKeyLabel('MacIntel'), 'Cmd+Z')
    assert.eq(undoKeyLabel('macOS'), 'Cmd+Z')
    assert.eq(undoKeyLabel('iPhone'), 'Cmd+Z')
    assert.eq(undoKeyLabel('Win32'), 'Ctrl+Z')
    assert.eq(undoKeyLabel('Linux x86_64'), 'Ctrl+Z')
    reset()
    block('a')
    let msg = ''
    const realConfirm = window.confirm
    window.confirm = m => { msg = m; return false }
    try { clearCanvas() } finally { window.confirm = realConfirm }
    assert.includes(msg, undoKeyLabel())
    assert.eq(/Cmd\+Z/.test(msg), undoKeyLabel() === 'Cmd+Z', 'Cmd+Z only where it is the key')
    reset()
  })
})

// ── Tidy split button ────────────────────────────────────────

describe('chrome -- Tidy direction', () => {
  it('offers both directions with the current one checked, and remembers the pick', () => withStorage(() => {
    const was = getLayoutDir()
    try {
      setLayoutDir('LR')
      let items = tidyMenuItems()
      assert.deepEq(labels(items), ['Arrange left to right', 'Arrange top to bottom'])
      assert.ok(items[0].radio && items[0].checked && !items[1].checked)
      reset()   // fewer than two blocks: Tidy only explains itself
      items[1].action()
      assert.eq(getLayoutDir(), 'TB')
      assert.eq(localStorage.getItem('pathfinder-layout-dir'), 'TB')
      items = tidyMenuItems()
      assert.ok(items[1].checked && !items[0].checked)
      assert.eq(setLayoutDir('diagonal'), false, 'an unknown direction is refused')
    } finally { setLayoutDir(was) }
  }))
})

// ── Help menu ────────────────────────────────────────────────

describe('chrome -- Help menu', () => {
  it('has the shortcuts, the walkthrough, the examples and Trace', () => {
    assert.deepEq(labels(helpMenuItems()),
      ['Keyboard shortcuts', 'Walkthrough', 'Examples', 'Trace: diagrams as text'])
  })
})

// ── View menu ────────────────────────────────────────────────

describe('chrome -- View menu', () => {
  it('has two headed scopes, this browser and this map', () => {
    reset()
    const items = viewMenuItems()
    const heads = items.filter(i => i.type === 'heading').map(i => i.label)
    assert.eq(heads.length, 2)
    assert.match(heads[0], /this browser/i)
    assert.match(heads[1], /this map/i)
    ;['Dark theme', 'Light theme', 'Snap to grid', 'Pin connections to the port you drag from',
      'Always show connection notes', 'Animate highlights', 'High contrast',
      'Hide header and footer', 'Zen: hide panels', 'Dot voting', 'Card style',
      'Spotlight: fade unhighlighted'].forEach(l => assert.ok(find(items, l), `View has "${l}"`))
    assert.ok(!items.some(i => /tint/i.test(i.label || '')), 'no separate tint toggle')
  })

  it('check marks reflect the current state', () => withStorage(() => {
    reset()
    const saved = { snap: ui.snapToGrid, pin: ui.pinPorts, text: ui.showArrowText, light: ui.lightMode }
    try {
      ui.snapToGrid = true; ui.pinPorts = false; ui.showArrowText = true; ui.lightMode = false
      let items = viewMenuItems()
      assert.eq(find(items, 'Snap to grid').checked, true)
      assert.eq(find(items, 'Pin connections to the port you drag from').checked, false)
      assert.eq(find(items, 'Always show connection notes').checked, true)
      assert.eq(find(items, 'Dark theme').checked, true)
      assert.eq(find(items, 'Light theme').checked, false)
      assert.ok(find(items, 'Dark theme').radio && find(items, 'Light theme').radio)
      assert.eq(find(items, 'Animate highlights').checked, !!getPref('motion'))
      ui.snapToGrid = false; ui.pinPorts = true
      items = viewMenuItems()
      assert.eq(find(items, 'Snap to grid').checked, false)
      assert.eq(find(items, 'Pin connections to the port you drag from').checked, true)
    } finally {
      ui.snapToGrid = saved.snap; ui.pinPorts = saved.pin
      setArrowText(saved.text); setLightMode(saved.light)
    }
  }))

  it('Animate highlights is off by default, persists, and sets body.motion-on', () => withStorage(() => {
    reset()
    localStorage.removeItem('pathfinder-prefs')
    applyPrefs()
    assert.ok(!document.body.classList.contains('motion-on'), 'off by default')
    const btn = document.createElement('button')
    btn.textContent = 'View'
    btn.style.cssText = 'position:fixed;left:20px;top:20px'
    document.body.appendChild(btn)
    try {
      const menu = openViewMenu(btn)
      assert.eq(btn.getAttribute('aria-expanded'), 'true')
      const row = [...menu.el.querySelectorAll('.pf-menu-item')]
        .find(r => r.querySelector('.pf-menu-label').textContent === 'Animate highlights')
      assert.eq(row.getAttribute('role'), 'menuitemcheckbox')
      assert.eq(row.getAttribute('aria-checked'), 'false')
      row.click()
      assert.ok(document.body.classList.contains('motion-on'), 'on: body.motion-on')
      assert.eq(JSON.parse(localStorage.getItem('pathfinder-prefs')).motion, true, 'persisted')
      assert.ok(isMenuOpen(), 'a toggle keeps the menu open')
      assert.eq(row.getAttribute('aria-checked'), 'true')
      row.click()
      assert.ok(!document.body.classList.contains('motion-on'))
      assert.eq(JSON.parse(localStorage.getItem('pathfinder-prefs')).motion, false)
    } finally { closeMenus(); btn.remove() }
  }))

  it('an embed never writes the preference to storage', () => withStorage(() => {
    reset()
    localStorage.removeItem('pathfinder-prefs')
    ui.embed = true; ui.readOnly = true
    try {
      // An embed keeps its own in-memory value, which an earlier test may
      // have set: assert the flip, not a starting state.
      const was = !!getPref('motion')
      find(viewMenuItems(), 'Animate highlights').action()
      assert.eq(document.body.classList.contains('motion-on'), !was, 'it still applies to the page')
      assert.eq(localStorage.getItem('pathfinder-prefs'), null, 'nothing written')
      find(viewMenuItems(), 'Animate highlights').action()
      assert.eq(document.body.classList.contains('motion-on'), was)
      assert.eq(localStorage.getItem('pathfinder-prefs'), null)
    } finally { ui.embed = false; ui.readOnly = false }
  }))

  it('Dot voting turns the session-only mode on and off', () => {
    reset()
    try {
      assert.eq(find(viewMenuItems(), 'Dot voting').checked, false)
      find(viewMenuItems(), 'Dot voting').action()
      assert.ok(isVotingMode())
      assert.eq(find(viewMenuItems(), 'Dot voting').checked, true)
      find(viewMenuItems(), 'Dot voting').action()
      assert.ok(!isVotingMode())
    } finally { setVotingMode(false) }
  })

  it('a view-only link gets no authoring settings and no map section', () => {
    reset()
    ui.readOnly = true
    try {
      const items = viewMenuItems()
      ;['Snap to grid', 'Pin connections to the port you drag from', 'Card style',
        'Spotlight: fade unhighlighted', 'Dot voting'].forEach(l =>
        assert.ok(!find(items, l), `no "${l}" on a view-only link`))
      assert.eq(items.filter(i => i.type === 'heading').length, 1)
      ;['Dark theme', 'Animate highlights', 'High contrast', 'Hide header and footer'].forEach(l =>
        assert.ok(find(items, l), `view-only keeps "${l}"`))
    } finally { ui.readOnly = false }
  })

  it('Snap to grid moves off-grid blocks onto it as one undo step, and none when nothing moves', () => withStorage(() => {
    reset()
    const was = ui.snapToGrid
    try {
      block('a', { x: 41, y: 57 })
      setSnapToGrid(true)
      assert.eq(localStorage.getItem('pathfinder-snap'), '1')
      assert.ok(document.body.classList.contains('snap-grid'))
      assert.eq(getUndoHistory().length, 1, 'one undo step for the move')
      assert.eq(state.blocks.a.x % GRID, 0)
      assert.eq(state.blocks.a.y % GRID, 0)
      setSnapToGrid(false)
      setSnapToGrid(true)
      assert.eq(getUndoHistory().length, 1, 'already on the grid: no new step')
      undo()
      assert.eq(state.blocks.a.x, 41)
      assert.eq(state.blocks.a.y, 57)
    } finally {
      setSnapToGrid(false)
      ui.snapToGrid = was
      document.body.classList.toggle('snap-grid', was)
      reset()
    }
  }))

  it('Spotlight is disabled until something is highlighted', () => {
    reset()
    assert.ok(find(viewMenuItems(), 'Spotlight: fade unhighlighted').disabled)
    block('a', { highlight: 'alert' })
    assert.ok(!find(viewMenuItems(), 'Spotlight: fade unhighlighted').disabled)
    reset()
  })

  it('Card style lists every preset, checks the current one and sets it on the map', () => withStorage(() => {
    reset()
    block('a')
    const items = cardStyleItems()
    assert.deepEq(items.map(i => i.label), Object.values(CARD_STYLES).map(v => v.label))
    assert.ok(items.every(i => i.radio))
    assert.deepEq(items.filter(i => i.checked).map(i => i.label), [CARD_STYLES[DEFAULT_CARD_STYLE].label])
    // A browser still on the retired tint toggle lets it go on the next pick.
    localStorage.setItem('pathfinder-tint', '1')
    ui.tintedBlocks = true
    document.body.classList.add('tinted-blocks')
    items.find(i => i.label === CARD_STYLES.tint.label).action()
    assert.eq(canvasMeta.cardStyle, 'tint')
    assert.eq($.canvasRoot().querySelector('.block').dataset.card, 'tint')
    assert.ok(!document.body.classList.contains('tinted-blocks'), 'the old tint is retired')
    assert.eq(localStorage.getItem('pathfinder-tint'), null)
    reset()
  }))

  it('a browser still on the old tint sees it named beside the card style', () => withStorage(() => {
    reset()
    localStorage.setItem('pathfinder-tint', '1')
    const label = CARD_STYLES[DEFAULT_CARD_STYLE].label
    assert.eq(find(viewMenuItems(), 'Card style').hint, `${label}, tinted (old setting)`)
    localStorage.removeItem('pathfinder-tint')
    assert.eq(find(viewMenuItems(), 'Card style').hint, label)
  }))
})

// ── Motion policy ────────────────────────────────────────────

// Test frames sit on screen, invisible and inert: WebKit never runs
// requestAnimationFrame in a frame parked off screen, and the suite hung.
const ONSCREEN = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;border:0'

// A live document with the real stylesheet, so animations actually run and
// document.getAnimations() sees them. The canvas is rendered by the app's own
// renderer and gap detector, then copied in.
async function motionFrame() {
  const frame = document.createElement('iframe')
  frame.style.cssText = `${ONSCREEN};width:1200px;height:600px`
  frame.srcdoc = '<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css"></head>' +
    '<body><div class="canvas-root" id="canvasRoot" style="position:relative;width:1200px;height:600px"></div></body></html>'
  const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
  document.body.appendChild(frame)
  await loaded
  return frame
}

function seedMotionCanvas() {
  reset()
  // goal -> problem (no resolve, no way out), goal -> risk (no mitigation),
  // an assumption wired to nothing it could be checked against, and two
  // highlights, one of each animated kind.
  block('g', { type: 'goal', x: 40, highlight: 'alert' })
  block('p', { type: 'problem', x: 320 })
  block('r', { type: 'risk', x: 600, highlight: 'festive' })
  block('s', { type: 'assumption', x: 880, y: 300 })
  block('d', { type: 'decision', x: 40, y: 300, highlight: 'focus' })
  state.arrows = [
    { id: 'a1', from: 'g', to: 'p', style: 'routed' },
    { id: 'a2', from: 'g', to: 'r', style: 'routed' },
    { id: 'a3', from: 's', to: 'p', style: 'routed' },
  ]
  renderAllBlocks()
  runGapDetection()
  return $.canvasRoot().innerHTML
}

const infinite = doc => doc.getAnimations()
  .filter(a => a.playState !== 'idle' && a.effect?.getTiming().iterations === Infinity)

const nextFrame = win => new Promise(res => win.requestAnimationFrame(() => win.requestAnimationFrame(res)))

describe('chrome -- motion policy', () => {
  it('nothing animates at rest; with the opt-in only the card in focus moves', async () => {
    const html = seedMotionCanvas()
    const frame = await motionFrame()
    try {
      const doc = frame.contentDocument, win = frame.contentWindow
      doc.getElementById('canvasRoot').innerHTML = html
      const gapped = doc.querySelectorAll('.block[class*=" gap-"]:not(.gap-isolated)')
      assert.gte(gapped.length, 2, 'the canvas has gap states to test with')
      assert.ok(doc.querySelector('.block[data-highlight="alert"]'), 'and an alert highlight')
      assert.ok(doc.querySelector('.block[data-highlight="festive"]'), 'and a festive one')
      await nextFrame(win)

      assert.eq(infinite(doc).length, 0, 'motion off: no infinite animation at rest')

      doc.body.classList.add('motion-on')
      await nextFrame(win)
      assert.eq(infinite(doc).length, 0, 'motion on, nothing hovered or selected: still nothing')

      const alert = doc.querySelector('.block[data-highlight="alert"]')
      const other = [...gapped].find(el => el !== alert)
      alert.classList.add('selected')
      other.classList.add('selected')
      await nextFrame(win)
      const running = infinite(doc)
      assert.ok(running.some(a => a.effect.target === alert && a.effect.pseudoElement === '::before'),
        'the selected highlight ring pulses')
      assert.ok(running.some(a => a.effect.target === other && a.effect.pseudoElement === '::after'),
        'the selected gap\'s ring breathes')
      assert.ok(running.every(a => a.effect.target === alert || a.effect.target === other),
        'and nothing else moves')

      doc.body.classList.remove('motion-on')
      await nextFrame(win)
      assert.eq(infinite(doc).length, 0, 'turning motion off stops it again')
    } finally { frame.remove(); reset() }
  })

  it('gap states and highlights keep a static ring at rest, in both themes', async () => {
    const html = seedMotionCanvas()
    const frame = await motionFrame()
    try {
      const doc = frame.contentDocument, win = frame.contentWindow
      doc.getElementById('canvasRoot').innerHTML = html
      await nextFrame(win)
      const gap = doc.querySelector('.block[class*=" gap-"]:not(.gap-isolated)')
      const lone = doc.querySelector('.block.gap-isolated')
      const hl = doc.querySelector('.block[data-highlight="alert"]')
      const ring = el => win.getComputedStyle(el, '::after')
      const attention = () => {
        const probe = doc.createElement('span')
        probe.style.color = 'var(--attention)'
        doc.body.appendChild(probe)
        const c = win.getComputedStyle(probe).color
        probe.remove()
        return c
      }
      // The ring is the ::after box: 1.5px dashed in --attention, 3px out
      // (Chrome snaps the 1.5px border to 1px at 1x).
      for (const el of [gap, lone]) {
        const r = ring(el)
        assert.neq(r.content, 'none', 'a gap is drawn at rest')
        assert.eq(r.borderTopStyle, 'dashed', 'as a dashed ring')
        assert.match(r.borderTopWidth, /^1(\.5)?px$/, 'of 1.5px')
        assert.eq(r.top, `${-(1.5 + 3 + 1.5)}px`, '3px outside the card')
        assert.eq(r.borderTopColor, attention(), 'in the attention hue, never the type colour')
        assert.eq(r.animationName, 'none', 'and still')
      }
      const before = win.getComputedStyle(hl, '::before')
      assert.neq(before.content, 'none', 'the highlight ring is drawn')
      assert.ok(before.borderTopStyle !== 'none' || before.boxShadow !== 'none', 'as a visible ring')
      const dark = ring(gap).borderTopColor
      doc.body.classList.add('light-mode')
      await nextFrame(win)
      assert.eq(ring(gap).borderTopStyle, 'dashed', 'light mode keeps the ring')
      assert.neq(ring(gap).borderTopColor, dark, 'in the light attention twin')
      assert.eq(ring(gap).borderTopColor, attention())
    } finally { frame.remove(); reset() }
  })

  it('a view-only link or embed keeps a selected card still; only hover moves there', async () => {
    const html = seedMotionCanvas()
    const frame = await motionFrame()
    try {
      const doc = frame.contentDocument, win = frame.contentWindow
      doc.getElementById('canvasRoot').innerHTML = html
      doc.body.classList.add('motion-on', 'readonly-mode')
      const alert = doc.querySelector('.block[data-highlight="alert"]')
      const gap = [...doc.querySelectorAll('.block[class*=" gap-"]:not(.gap-isolated)')].find(el => el !== alert)
      alert.classList.add('selected')
      gap.classList.add('selected')
      gap.tabIndex = 0
      gap.focus()
      await nextFrame(win)
      assert.eq(infinite(doc).length, 0, 'read-only: a selected card does not move')
      doc.body.classList.remove('readonly-mode')
      await nextFrame(win)
      assert.gte(infinite(doc).length, 2, 'the same selection moves in the editor')
      // The hover rule has no read-only exception, so a reader can still see it.
      const hoverRules = []
      const walk = rules => {
        for (const r of rules) {
          if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue }
          if (r.selectorText && /motion-on/.test(r.selectorText) && /var\(--(gap|hl)-anim/.test(r.style.animation || r.style.animationName || '')) {
            r.selectorText.split(/,(?![^(]*\))/).forEach(sel => hoverRules.push(sel.trim()))
          }
        }
      }
      for (const sheet of doc.styleSheets) walk(sheet.cssRules)
      const hover = hoverRules.filter(sel => /:hover/.test(sel))
      assert.eq(hover.length, 2, 'one hover rule each for gaps and highlights')
      assert.ok(hover.every(sel => !/readonly-mode/.test(sel)), 'hover animates in read-only too')
      assert.ok(hoverRules.filter(sel => /\.selected/.test(sel)).every(sel => /:not\(\.readonly-mode\)/.test(sel)),
        'selection and focus animate only in the editor')
    } finally { frame.remove(); reset() }
  })

  it('a selected, focused or dragged gap card keeps its ring, and its state adds its own channel, in both themes', async () => {
    const html = seedMotionCanvas()
    const frame = await motionFrame()
    try {
      const doc = frame.contentDocument, win = frame.contentWindow
      doc.getElementById('canvasRoot').innerHTML = html
      const gap = [...doc.querySelectorAll('.block[class*=" gap-"]:not(.gap-isolated)')]
        .find(el => !el.dataset.highlight)
      gap.style.transition = 'none'   // read end states, not a shadow mid-transition
      const shadow = () => win.getComputedStyle(gap).boxShadow
      const ringStays = () => win.getComputedStyle(gap, '::after').borderTopStyle === 'dashed'
      gap.classList.add('selected')
      await nextFrame(win)
      // Selection's channel is the outline on the card's edge plus a halo
      // (the [cards] section); the gap's is the ring 3px out, so both show.
      assert.ok(ringStays(), 'dark, selected: the ring stays')
      assert.eq(win.getComputedStyle(gap).outlineOffset, '0px', 'dark, selected: the outline sits inside the ring')
      assert.neq(win.getComputedStyle(gap).outlineStyle, 'none', 'dark, selected: the outline marks it')
      assert.match(shadow(), /0px 0px 0px 4px/, 'dark, selected: with the halo')
      doc.body.classList.add('light-mode')
      await nextFrame(win)
      assert.ok(ringStays(), 'light, selected: the ring stays')
      assert.neq(win.getComputedStyle(gap).outlineStyle, 'none', 'light, selected: the outline marks it')
      doc.body.classList.remove('light-mode')
      gap.classList.remove('selected')
      gap.classList.add('dragging')
      await nextFrame(win)
      assert.ok(ringStays(), 'dragging: the ring stays')
      assert.match(shadow(), /0px 10px 36px/, 'dragging: and the lift')
      gap.classList.add('selected')
      await nextFrame(win)
      assert.match(shadow(), /0px 10px 36px/, 'dragging a selection: the lift')
      assert.match(shadow(), /0px 0px 0px 4px/, 'dragging a selection: and the halo')
      gap.classList.remove('dragging', 'selected')
      gap.tabIndex = 0
      gap.focus({ focusVisible: true })
      await nextFrame(win)
      if (gap.matches(':focus-visible')) {
        assert.ok(ringStays(), 'focused: the ring stays')
        assert.match(shadow(), /0px 0px 0px 4px/, 'focused: with the focus halo')
        assert.eq(win.getComputedStyle(gap).outlineOffset, '0px', 'focused: the outline on the edge, clear of the ring')
      }
    } finally { frame.remove(); reset() }
  })

  it('the stylesheet only runs an infinite block animation under body.motion-on', async () => {
    const frame = await motionFrame()
    try {
      const offenders = []
      const walk = (rules, media) => {
        for (const r of rules) {
          if (r.cssRules && !r.selectorText) { walk(r.cssRules, r.conditionText || media); continue }
          if (!r.style || !r.selectorText || !/\.block\b/.test(r.selectorText)) continue
          const count = r.style.animationIterationCount || ''
          const shorthand = r.style.animation || ''
          // A var() can hide an infinite animation, so it counts as one too.
          if (/infinite|var\(/.test(count + ' ' + shorthand) && !/motion-on/.test(r.selectorText)) {
            offenders.push(r.selectorText)
          }
        }
      }
      for (const sheet of frame.contentDocument.styleSheets) walk(sheet.cssRules, '')
      assert.deepEq(offenders, [], 'infinite animations on blocks outside the opt-in')
    } finally { frame.remove() }
  })

  it('reduced motion switches every animation off, whatever the preference', async () => {
    const frame = await motionFrame()
    try {
      let found = false
      const walk = rules => {
        for (const r of rules) {
          if (r.media && /prefers-reduced-motion:\s*reduce/.test(r.conditionText || r.media.mediaText)) {
            for (const inner of r.cssRules) {
              if (inner.selectorText && /(^|,\s*)\*(,|$)/.test(inner.selectorText) &&
                  inner.style.getPropertyValue('animation-name') === 'none' &&
                  inner.style.getPropertyPriority('animation-name') === 'important') found = true
            }
          } else if (r.cssRules) walk(r.cssRules)
        }
      }
      for (const sheet of frame.contentDocument.styleSheets) walk(sheet.cssRules)
      assert.ok(found, 'a reduce rule sets animation: none !important on everything')
      const css = await (await fetch('../css/style.css')).text()
      assert.notIncludes(css, 'animation-duration: 0.01ms', 'no more 0.01ms infinite loops')
    } finally { frame.remove() }
  })
})

// ── The header as laid out ───────────────────────────────────

// The real header markup under the real stylesheets, in the order the page
// loads them, at a given window width. The kit's script does not run here,
// so at 700px and under the controls stay where the markup puts them.
async function headerFrame(width, { light = false, extra = '' } = {}) {
  const doc = await page()
  const frame = document.createElement('iframe')
  frame.style.cssText = `${ONSCREEN};width:${width}px;height:700px`
  frame.srcdoc = '<!DOCTYPE html><html><head>' +
    '<link rel="stylesheet" href="../css/style.css">' +
    '<link rel="stylesheet" href="../css/neorgon-header.css">' +
    '<link rel="stylesheet" href="../css/neorgon-themes.css">' +
    `</head><body${light ? ' class="light-mode"' : ''}>` +
    doc.querySelector('header.header-bar').outerHTML + extra + '</body></html>'
  const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
  document.body.appendChild(frame)
  await loaded
  await nextFrame(frame.contentWindow)
  return frame
}

describe('chrome -- header layout', () => {
  it('the Tidy caret is at least a 24px target', async () => {
    for (const width of [1440, 800]) {
      const frame = await headerFrame(width)
      try {
        const r = frame.contentDocument.getElementById('tidyMenuBtn').getBoundingClientRect()
        assert.gte(r.width, 24, `caret width at ${width}px`)
        assert.gte(r.height, 24, `caret height at ${width}px`)
      } finally { frame.remove() }
    }
  })

  it('GitHub stays in the bar above the kit breakpoint, and the bar still fits', async () => {
    for (const width of [701, 720, 768, 800]) {
      const frame = await headerFrame(width)
      try {
        const doc = frame.contentDocument, win = frame.contentWindow
        const gh = doc.querySelector('.header-github')
        assert.neq(win.getComputedStyle(gh).display, 'none', `GitHub shown at ${width}px`)
        const right = Math.max(...[...doc.querySelectorAll('.header-actions > *, .header-home')]
          .filter(el => win.getComputedStyle(el).display !== 'none')
          .map(el => el.getBoundingClientRect().right))
        assert.ok(right <= width, `every control fits at ${width}px (rightmost ${Math.round(right)})`)
        assert.ok(doc.documentElement.scrollWidth <= width, `no horizontal scroll at ${width}px`)
      } finally { frame.remove() }
    }
  })

  it('toasts sit under the bar, let clicks through, and an open header menu stays above them', async () => {
    const frame = await headerFrame(1200, {
      extra: '<div class="toast-notification toast-success" role="status">Done</div>' +
             '<div class="pf-menu pf-header-menu" role="menu" style="position:fixed;top:60px;right:20px">View</div>',
    })
    try {
      const doc = frame.contentDocument, win = frame.contentWindow
      const toast = doc.querySelector('.toast-notification')
      const menu = doc.querySelector('.pf-header-menu')
      const bar = doc.querySelector('.header-bar').getBoundingClientRect()
      assert.eq(win.getComputedStyle(toast).pointerEvents, 'none', 'a toast never swallows a click')
      assert.gte(toast.getBoundingClientRect().top, bar.bottom, 'below the header, clear of its controls')
      assert.gt(+win.getComputedStyle(menu).zIndex, +win.getComputedStyle(toast).zIndex, 'header menus above toasts')
      doc.body.dataset.chrome = 'off'
      assert.eq(win.getComputedStyle(toast).top, '24px', 'back to the corner when the header is hidden')
    } finally { frame.remove() }
  })

  it('on phones the in-place menus take the panel colours, in light mode too', async () => {
    const frame = await headerFrame(375, { light: true })
    try {
      const doc = frame.contentDocument, win = frame.contentWindow
      // What the kit builds on a phone: its panel inside .header-actions,
      // holding the controls that were not kept in the bar.
      const actions = doc.querySelector('.header-actions')
      const panel = doc.createElement('div')
      panel.className = 'header-menu header-overflow-menu open'
      const wrap = doc.createElement('div')
      wrap.className = 'header-overflow'
      wrap.appendChild(panel)
      actions.appendChild(wrap)
      panel.appendChild(doc.getElementById('mapsWrapper'))
      panel.appendChild(doc.getElementById('viewBtn'))
      const list = doc.createElement('div')
      list.className = 'hdr-inline-menu'
      list.innerHTML = '<button type="button" class="hdr-inline-item"><span class="hdr-inline-text">' +
        '<span class="hdr-inline-label">Snap to grid</span></span></button>'
      panel.appendChild(list)
      const stray = doc.createElement('div')
      stray.className = 'hdr-inline-menu'
      actions.insertBefore(stray, actions.firstChild)
      await nextFrame(win)

      assert.eq(win.getComputedStyle(list).display, 'block', 'an in-place menu shows in the panel')
      // The panel follows the header skin (light with the page in light
      // mode): the rows take the header's own ink and read on the panel.
      const ink = rgbOf(win.getComputedStyle(list.querySelector('button')).color)
      assert.deepEq(ink.slice(0, 3), rgbOf(win.getComputedStyle(doc.querySelector('.header-bar')).color).slice(0, 3), 'the header text colour')
      const panelBg = rgbOf(win.getComputedStyle(panel).backgroundColor)
      if ((panelBg[3] ?? 1) > 0.5) assert.ok(ratioOf(ink, panelBg) >= 4.5, `rows read on the panel: ${ratioOf(ink, panelBg).toFixed(2)}:1`)
      // offsetHeight, not the box: the kit's panel scales in as it opens.
      assert.gte(list.querySelector('button').offsetHeight, 44, 'with the kit touch height')
      assert.eq(win.getComputedStyle(stray).display, 'none', 'and never in the bar')
    } finally { frame.remove() }
  })
})

// ── Maps (a menu.js list like the other header menus) ────────

describe('chrome -- Maps menu', () => {
  it('lists the maps with the open one checked, then the map actions, and deleting last in its own list', () => {
    const items = mapsMenuItems()
    assert.eq(items[0].type, 'heading')
    const maps = items.filter(i => i.radio)
    assert.eq(maps.filter(i => i.checked).length, maps.length ? 1 : 0, 'the open map is the checked one')
    const labels = items.filter(i => !i.type).map(i => i.label)
    ;['New map', 'Duplicate this map', 'Snapshot this map', 'Export all maps (JSON)', 'Import maps (JSON)']
      .forEach(l => assert.includes(labels, l))
    if (maps.length) {
      const del = items[items.length - 1]
      assert.eq(del.label, 'Delete a map')
      assert.ok(del.danger && typeof del.submenu === 'function', 'a danger submenu, never a row beside the map you meant to open')
      assert.eq(del.submenu().length, maps.length)
    }
    assert.ok(!document.getElementById('mapsDropdown'), 'the old div list is gone')
  })
})

// ── Menus in the phone overflow panel ────────────────────────

describe('chrome -- menus in the overflow panel', () => {
  function panelWithButton() {
    const panel = document.createElement('div')
    panel.className = 'header-menu header-overflow-menu open'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = 'View'
    panel.appendChild(btn)
    document.body.appendChild(panel)
    return { panel, btn }
  }

  it('open in place under their button instead of floating over the panel', () => {
    const { panel, btn } = panelWithButton()
    let panelClicks = 0
    panel.addEventListener('click', () => { panelClicks++ })
    let flag = false, ran = 0
    const itemsFn = () => [
      { type: 'heading', label: 'This browser' },
      { label: 'Toggle', checked: flag, keepOpen: true, action: () => { flag = !flag } },
      { type: 'divider' },
      { label: 'Run', hint: 'Does the thing', action: () => { ran++ } },
      { label: 'Style', submenu: () => [{ label: 'Inner', radio: true, checked: true, action: () => { ran += 10 } }] },
    ]
    try {
      openHeaderMenu(btn, itemsFn, 'View')
      assert.ok(!isMenuOpen(), 'no floating menu.js menu')
      const list = btn.nextElementSibling
      assert.ok(list && list.classList.contains('hdr-inline-menu'), 'a list right after the button')
      assert.eq(list.getAttribute('aria-label'), 'View')
      assert.eq(btn.getAttribute('aria-expanded'), 'true')
      const rows = () => [...list.querySelectorAll(':scope > .hdr-inline-item')]
      assert.deepEq(rows().map(r => r.querySelector('.hdr-inline-label').textContent), ['Toggle', 'Run', 'Style'])
      assert.ok(rows().every(r => r.tagName === 'BUTTON' && r.type === 'button'), 'real buttons')
      assert.ok(list.querySelector('.hdr-inline-heading') && list.querySelector('.hdr-inline-divider'))
      assert.eq(document.activeElement, rows()[0], 'focus moves into the list')

      rows()[0].click()
      assert.eq(flag, true, 'a toggle runs')
      assert.eq(panelClicks, 0, 'and the kit never sees the click, so its panel stays open')
      assert.ok(list.isConnected, 'the list stays open')
      assert.eq(rows()[0].getAttribute('aria-pressed'), 'true', 'rebuilt with the new mark')
      assert.eq(document.activeElement, rows()[0], 'focus stays on the row')

      rows()[2].click()
      const sub = rows()[2].nextElementSibling
      assert.ok(sub && sub.classList.contains('hdr-inline-sub'), 'a submenu opens in place too')
      assert.eq(rows()[2].getAttribute('aria-expanded'), 'true')
      sub.querySelector('.hdr-inline-item').click()
      assert.eq(ran, 10, 'a submenu row runs')
      assert.ok(!document.querySelector('.hdr-inline-menu'), 'and folds the list away')
      assert.eq(btn.getAttribute('aria-expanded'), 'false')

      openHeaderMenu(btn, itemsFn, 'View')
      btn.nextElementSibling.querySelector('.hdr-inline-item').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      assert.ok(!document.querySelector('.hdr-inline-menu'), 'Escape folds the list')
      assert.eq(document.activeElement, btn, 'back to its button, with the panel still open')

      openHeaderMenu(btn, itemsFn, 'View')
      btn.nextElementSibling.querySelectorAll('.hdr-inline-item')[1].click()
      assert.eq(ran, 11, 'an action runs')
      assert.ok(!document.querySelector('.hdr-inline-menu'), 'and closes the list')

      openHeaderMenu(btn, itemsFn, 'View')
      openHeaderMenu(btn, itemsFn, 'View')
      assert.ok(!document.querySelector('.hdr-inline-menu'), 'the button toggles it')
    } finally { closeInlineMenus(); closeMenus(); panel.remove() }
  })

  it('a press outside the panel folds the list away', () => {
    setupViewMenu()   // wires the dismissal; the header ids are not on this page
    const { panel, btn } = panelWithButton()
    try {
      openHeaderMenu(btn, [{ label: 'Only', action: () => {} }], 'Help')
      assert.ok(btn.nextElementSibling.classList.contains('hdr-inline-menu'))
      document.body.click()
      assert.ok(!document.querySelector('.hdr-inline-menu'))
      assert.eq(btn.getAttribute('aria-expanded'), 'false')
    } finally { closeInlineMenus(); panel.remove() }
  })

  it('outside the panel the same call opens the floating menu', () => {
    const btn = document.createElement('button')
    btn.textContent = 'Share'
    btn.style.cssText = 'position:fixed;left:20px;top:20px'
    document.body.appendChild(btn)
    try {
      const src = document.createElement('div')
      src.innerHTML = '<button type="button" id="chromeShareRow" data-menu-group="share">Copy link</button>'
      let clicks = 0
      src.querySelector('button').addEventListener('click', () => { clicks++ })
      const menu = openHeaderMenu(btn, () => shareMenuItems(src), 'Share')
      assert.ok(isMenuOpen())
      assert.ok(menu.el.classList.contains('pf-header-menu'))
      const row = menu.el.querySelector('.pf-menu-item')
      assert.eq(row.tagName, 'BUTTON')
      row.click()
      assert.eq(clicks, 1, 'picking a Share entry clicks its row')
      assert.ok(!isMenuOpen())
    } finally { closeMenus(); btn.remove() }
  })
})

// ── H and Z inside an embed ──────────────────────────────────

describe('chrome -- H and Z in an embed', () => {
  it("never write the visitor's layout, and an embed ignores the saved one", () => {
    const KEY = 'pathfinder-chrome'
    const saved = localStorage.getItem(KEY)
    const was = { frame: chrome.frame, panels: chrome.panels }
    ui.embed = true; ui.readOnly = true
    try {
      localStorage.removeItem(KEY)
      chrome.frame = true; chrome.panels = true
      toggleZen(); toggleZen()
      toggleChrome(); toggleChrome()
      assert.eq(localStorage.getItem(KEY), null, 'nothing written')
      localStorage.setItem(KEY, '')   // the full app was left in Zen
      setupChrome()
      assert.ok(chrome.frame && chrome.panels, 'the embed still shows its diagram with its frame')
    } finally {
      ui.embed = false; ui.readOnly = false
      chrome.frame = was.frame; chrome.panels = was.panels
      if (saved === null) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, saved)
    }
  })
})

// ── QA round ─────────────────────────────────────────────────

// A page with the real stylesheet and some markup, at a given size.
async function cssFrame(html, { width = 1200, height = 800, bodyClass = '', head = '' } = {}) {
  const frame = document.createElement('iframe')
  frame.style.cssText = `${ONSCREEN};width:${width}px;height:${height}px`
  frame.srcdoc = '<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css">' + head +
    `</head><body class="${bodyClass}">${html}</body></html>`
  const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
  document.body.appendChild(frame)
  await loaded
  await nextFrame(frame.contentWindow)
  return frame
}
const rgbOf = s => cssRgba(s) || []
const lumOf = ([r, g, b]) => {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const overOf = (fg, bg) => { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)) }
const ratioOf = (a, b) => { const [x, y] = [lumOf(a), lumOf(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

let templatesWired = false
describe('chrome -- QA round', () => {
  it('a large template, added and arranged, is one undo step', async () => {
    reset()
    block('seed')
    if (!templatesWired) { setupTemplates(); templatesWired = true }
    const i = TEMPLATES.findIndex(t => t.name === 'Recurring Reporting Flow')
    assert.ok(i >= 0 && TEMPLATES[i].large, 'the template exists and is arranged on apply')
    const hist = getUndoHistory().length
    $.templatesList().querySelector(`.template-item[data-tpl="${i}"]`).click()
    assert.gt(Object.keys(state.blocks).length, 10, 'the template landed')
    assert.eq(getUndoHistory().length, hist + 1, 'one click, one step (Tidy took none of its own)')
    await new Promise(r => setTimeout(r, 560))   // the arrange animation
    undo()
    assert.deepEq(Object.keys(state.blocks), ['seed'], 'one Cmd+Z takes the whole template away')
    reset()
  })

  it('light mode: the keyboard focus ring reads at 3:1 or better on the panel', async () => {
    // A frame that is not focused never matches :focus-visible, so the
    // cascade is replayed with the pseudo-class spelled as a class: same
    // specificity, same winner.
    const css = (await (await fetch('../css/style.css', { cache: 'no-store' })).text()).replace(/:focus-visible/g, '.fv-probe')
    const html = '<div class="right-panel" style="width:320px;height:200px">' +
      '<input id="field" class="insp-input fv-probe" value="Key Results">' +
      '<button id="chip" class="insp-chip fv-probe" type="button">Status</button></div>' +
      '<a class="skip-link" href="#x">Skip</a>'
    const frame = await cssFrame(html, { bodyClass: 'light-mode', head: `<style>${css.replace(/<\/style/gi, '')}</style>` })
    try {
      const doc = frame.contentDocument, win = frame.contentWindow
      const page = rgbOf(win.getComputedStyle(doc.body).backgroundColor)
      const panel = overOf(rgbOf(win.getComputedStyle(doc.querySelector('.right-panel')).backgroundColor), page)
      for (const id of ['field', 'chip']) {
        const cs = win.getComputedStyle(doc.getElementById(id))
        const r = ratioOf(overOf(rgbOf(cs.outlineColor), panel), panel)
        assert.ok(r >= 3, `#${id} ring ${cs.outlineColor} on the panel: ${r.toFixed(2)}:1`)
      }
      const skipBg = rgbOf(win.getComputedStyle(doc.querySelector('.skip-link')).backgroundColor)
      assert.ok(ratioOf(skipBg, page) >= 3, 'the skip link stands out from the page')
    } finally { frame.remove() }
  })

  it('light mode: muted text and every toast kind read at 4.5:1', async () => {
    const kinds = ['success', 'info', 'warning', 'error']
    const frame = await cssFrame('<span id="muted" style="color:var(--text-muted)">Backed up: never</span>' +
      kinds.map(k => `<div class="toast-notification toast-${k}" style="position:static;animation:none">${k}</div>`).join(''),
      { bodyClass: 'light-mode' })
    try {
      const doc = frame.contentDocument, win = frame.contentWindow
      const page = rgbOf(win.getComputedStyle(doc.body).backgroundColor)
      const muted = ratioOf(rgbOf(win.getComputedStyle(doc.getElementById('muted')).color), page)
      assert.ok(muted >= 4.5, `--text-muted on --bg: ${muted.toFixed(2)}:1`)
      doc.querySelectorAll('.toast-notification').forEach(t => {
        const bg = overOf(rgbOf(win.getComputedStyle(t).backgroundColor), page)
        const r = ratioOf(rgbOf(win.getComputedStyle(t).color), bg)
        assert.ok(r >= 4.5, `${t.textContent} toast: ${r.toFixed(2)}:1`)
      })
    } finally { frame.remove() }
  })

  it('a toast lands over the canvas, above its status bar, clear of the side panel', () => {
    const bar = document.createElement('div')
    bar.className = 'canvas-statusbar'
    bar.style.cssText = 'position:fixed;left:300px;top:700px;width:800px;height:44px'
    document.body.appendChild(bar)
    try {
      showToast('Arranged 12 blocks left to right', 'success', 50)
      const t = document.querySelector('.toast-notification')
      const tr = t.getBoundingClientRect(), br = bar.getBoundingClientRect()
      assert.ok(tr.bottom <= br.top - 8, `above the status bar (${Math.round(tr.bottom)} vs ${Math.round(br.top)})`)
      assert.ok(tr.left >= br.left && tr.right <= br.right, 'within the canvas width, so never over the inspector')
      assert.ok(Math.abs((tr.left + tr.right) / 2 - (br.left + br.right) / 2) <= 1, 'centred on it')
      t.remove()
    } finally { bar.remove() }
    // With no canvas on screen the stylesheet places it, as before.
    const lone = document.createElement('div')
    assert.eq(placeToast(lone), false)
    assert.eq(lone.style.left, '')
  })

  it('a long map title ellipsizes instead of growing the header, and keeps its full text as a tooltip', async () => {
    const long = 'Quarterly reporting, delivery lifecycle and every status note across the portfolio'
    for (const width of [800, 1024]) {
      const short = await headerFrame(width)
      const tall = await headerFrame(width)
      try {
        tall.contentDocument.getElementById('canvasTitle').textContent = long
        await nextFrame(tall.contentWindow)
        const h = f => f.contentDocument.querySelector('.header-bar').getBoundingClientRect().height
        assert.ok(h(tall) <= h(short) + 1, `${width}px: ${Math.round(h(tall))}px with the long title, ${Math.round(h(short))}px without`)
        const t = tall.contentDocument.getElementById('canvasTitle')
        assert.ok(t.scrollWidth > t.clientWidth, 'the title is cut with an ellipsis')
      } finally { short.remove(); tall.remove() }
    }
    const saved = canvasMeta.title
    try {
      canvasMeta.title = long
      updateCanvasTitle()
      assert.eq($.canvasTitle().title, long, 'the full title is one hover away')
    } finally { canvasMeta.title = saved; updateCanvasTitle() }
  })

  it('on a phone the overflow panel uses the height it has, not 320px', async () => {
    const frame = await headerFrame(375)
    try {
      const doc = frame.contentDocument, win = frame.contentWindow
      const wrap = doc.createElement('div'); wrap.className = 'header-overflow'
      const panel = doc.createElement('div'); panel.className = 'header-menu header-overflow-menu open'
      panel.innerHTML = '<div style="height:1036px"></div>'
      wrap.appendChild(panel); doc.querySelector('.header-actions').appendChild(wrap)
      const max = parseFloat(win.getComputedStyle(panel).maxHeight)
      assert.gt(max, 320, `max-height ${max}px`)
      assert.ok(max <= win.innerHeight, 'and never taller than the window')
    } finally { frame.remove() }
  })
})
