// ============================================================
//  qa4b.test.js: regression tests for the second pass over wave
//  4's QA (an independent verifier's findings, 2026-10-16). Each
//  block names the defect it holds closed.
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, view, selection, getUndoHistory, getRedoFuture, resetSnapshotToken, snapshot } from '../js/state.js'
import { $, showToast, showCopyFallback, copyText, getBlockDims } from '../js/utils.js'
import { renderBlock, renderAllBlocks, deselectAll, selectBlock, undo, mutateBlock } from '../js/render.js'
import { applyTransform, settleDescCaption } from '../js/canvas.js'
import { arrivalView, arriveAt, mapInView, ARRIVAL_HINT, ARRIVAL_HINT_TOUCH } from '../js/zoom-controls.js'
import { TEMPLATES, applyTemplate } from '../js/templates.js'
import { CARD_GAP, LAYOUT_DEFAULTS, tidySummary } from '../js/layout.js'
import { setupTemplates, importMessage, srcMessage } from '../js/ui-panels.js'
import { detectGaps, findingLine, gapLine } from '../js/gaps.js'
import { generatePrompt } from '../js/prompt.js'
import { blockMenuItems, openBlockMenu } from '../js/context-menu.js'
import { closeMenus, openMenu } from '../js/menu.js'
import { arrangeSelection } from '../js/align.js'
import { backupNagText, LINK_ERRORS, incomingMessage } from '../js/sharing.js'
import { dumpSummary } from '../js/classify.js'
import { IMPORT_ERRORS } from '../js/interop.js'
import { syncBriefGutter, readPref, resumeReading, setReading, pressRead, READ_PREF_KEY } from '../js/brief.js'
import { isWidthBorrowed, resetPanelWidth, setPanelWidth, PANEL_WIDTH_KEY } from '../js/panel-resize.js'

const byId = id => document.getElementById(id)
const frame = () => new Promise(r => requestAnimationFrame(() => r()))
const tick = () => new Promise(r => setTimeout(r, 0))
const fetchText = async path => (await fetch(path, { cache: 'no-store' })).text()

function reset() {
  closeMenus()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  ui.embed = false
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
  selection.ids.clear(); selection.blockId = null; selection.arrowId = null
  $.canvasRoot().querySelectorAll('.block').forEach(el => el.remove())
  view.panX = 0; view.panY = 0; view.zoom = 1
  document.querySelectorAll('.toast-notification').forEach(t => t.remove())
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '',
    x: 0, y: 0, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, highlight: null, ...extra }
  renderBlock(id)
  return state.blocks[id]
}

let sheetPromise = null
function realSheet() {
  sheetPromise = sheetPromise || fetchText('../css/style.css').then(css => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    return sheet
  })
  return sheetPromise
}

// The app's stylesheet on the test page and the canvas viewport laid out at
// w by h (the stub hides it), for anything that measures a card.
async function withApp(fn, { w = 900, h = 600 } = {}) {
  const sheet = await realSheet()
  const vp = $.canvasViewport()
  const prev = { css: vp.style.cssText, sheets: [...document.adoptedStyleSheets], view: { ...view } }
  document.adoptedStyleSheets = [...prev.sheets, sheet]
  vp.style.cssText = `display:block;position:fixed;left:24px;top:24px;width:${w}px;height:${h}px;overflow:hidden;z-index:2147483646;opacity:0;pointer-events:none`
  const root = $.canvasRoot(), hadClass = root.classList.contains('canvas-root')
  root.classList.add('canvas-root')
  try { return await fn(vp) } finally {
    if (!hadClass) root.classList.remove('canvas-root')
    vp.style.cssText = prev.css
    document.adoptedStyleSheets = prev.sheets
    Object.assign(view, prev.view)
    applyTransform()
  }
}

const toastText = () => document.querySelector('.toast-notification .toast-msg')?.textContent || ''
const hinted = t => t.includes(ARRIVAL_HINT) || t.includes(ARRIVAL_HINT_TOUCH)

// The least clear space between any two of `ids` (negative when two overlap).
function minGap(ids) {
  const rs = ids.map(id => ({ id, x: state.blocks[id].x, y: state.blocks[id].y, ...getBlockDims(id) }))
  let min = Infinity, pair = null
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j]
    const g = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h))
    if (g < min) { min = g; pair = [state.blocks[a.id].title, state.blocks[b.id].title] }
  }
  return { min, pair }
}

// ── R1: the hint only when some of the map is off screen ─────
describe('qa4b: "Shift+1 shows all of it." only when part of the map is off screen', () => {
  it('a row that fits the view but not its margins arrives whole, with no hint', async () => {
    reset()
    await withApp(async () => {
      // 820px of cards in a 900px view: too wide for the 80px margins, all on screen.
      ;['a', 'b', 'c'].forEach((id, i) => block(id, { x: i * 300, y: 0 }))
      const v = arrivalView(['a', 'b', 'c'])
      assert.ok(v.whole, 'every card is on screen, so the arrival is whole')
      const r = arriveAt(null, { lead: 'Imported 3 blocks.' })
      assert.ok(r.whole)
      assert.ok(mapInView())
      assert.eq(toastText(), 'Imported 3 blocks.')
    }, { w: 900, h: 600 })
    reset()
  })

  it('a map that does not fit says the hint, and so does a merge that leaves the person\'s cards off screen', async () => {
    reset()
    await withApp(async () => {
      for (let i = 0; i < 6; i++) block('m' + i, { x: i * 300, y: 0 })
      arriveAt(null, { lead: 'Map opened.' })
      assert.ok(!mapInView())
      assert.ok(hinted(toastText()), toastText())
      // Arrived blocks all on screen, the rest of the map not: the map is "it".
      arriveAt(['m5'], { lead: 'Added beside your map.' })
      assert.ok(hinted(toastText()), toastText())
    }, { w: 900, h: 600 })
    reset()
  })
})

// ── R2 and R10: small templates arrive arranged, and say nothing of Tidy ─
describe('qa4b: templates arrive arranged, CARD_GAP apart, and never suggest Tidy', () => {
  it('Tidy keeps siblings CARD_GAP apart, like every other placement', () => {
    assert.eq(LAYOUT_DEFAULTS.nodeGap, CARD_GAP)
  })

  it('no built-in template\'s cards overlap or sit closer than CARD_GAP on an empty map, as written', async () => {
    reset()
    await withApp(async () => {
      for (const tpl of TEMPLATES) {
        reset()
        const ids = applyTemplate(tpl)
        renderAllBlocks()
        const { min, pair } = minGap(ids)
        assert.ok(min >= CARD_GAP - 0.5, `${tpl.name}: "${pair?.[0]}" and "${pair?.[1]}" are ${Math.round(min)}px apart`)
      }
    }, { w: 1200, h: 800 })
    reset()
  })

  it('or as the palette applies them to an empty map', async () => {
    reset()
    if (!document.querySelector('#templatesList .template-item')) setupTemplates()
    await withApp(async () => {
      for (let i = 0; i < TEMPLATES.length; i++) {
        reset()
        $.templatesList().querySelector(`.template-item[data-tpl="${i}"]`).click()
        await new Promise(r => setTimeout(r, 30))
        const { min, pair } = minGap(Object.keys(state.blocks))
        assert.ok(min >= CARD_GAP - 0.5, `${TEMPLATES[i].name}: "${pair?.[0]}" and "${pair?.[1]}" are ${Math.round(min)}px apart`)
        assert.ok(!/\bTidy\b|\bL to\b/.test(toastText()), `${TEMPLATES[i].name}: ${toastText()}`)
      }
    }, { w: 1200, h: 800 })
    reset()
  })

  // qa4c: Sprint planning and Risk review were four columns (1240px) in
  // Tidy's arrangement, wider than the canvas at 1280 by 800, so two or
  // three of their cards arrived off screen.
  it('every small template arrives with every card on screen at 1280 by 800 (a 912 by 651 canvas)', async () => {
    reset()
    if (!document.querySelector('#templatesList .template-item')) setupTemplates()
    const W = 912, H = 651
    await withApp(async () => {
      TEMPLATES.forEach((tpl, i) => {
        if (tpl.large) return
        reset()
        $.templatesList().querySelector(`.template-item[data-tpl="${i}"]`).click()
        const ids = Object.keys(state.blocks)
        assert.eq(ids.length, tpl.blocks.length)
        const off = ids.filter(id => {
          const b = state.blocks[id], { w, h } = getBlockDims(id), z = view.zoom
          const x1 = b.x * z + view.panX, y1 = b.y * z + view.panY
          return x1 < -0.5 || y1 < -0.5 || x1 + w * z > W + 0.5 || y1 + h * z > H + 0.5
        }).map(id => state.blocks[id].title)
        assert.eq(view.zoom, 1, `${tpl.name} arrives at 100%`)
        assert.deepEq(off, [], `${tpl.name}: off screen`)
        assert.ok(!hinted(toastText()), `${tpl.name}: ${toastText()}`)
      })
    }, { w: W, h: H })
    reset()
  })

  it('a small template merged into a map with cards never suggests Tidy (L would move every card)', () => {
    reset()
    if (!document.querySelector('#templatesList .template-item')) setupTemplates()
    block('seed', { title: 'Token exchange endpoint', type: 'implementation', x: -110, y: -40 })
    const i = TEMPLATES.findIndex(t => !t.large)
    $.templatesList().querySelector(`.template-item[data-tpl="${i}"]`).click()
    const t = toastText()
    assert.includes(t, 'beside your map.')
    assert.ok(!/\bTidy\b|\bL to\b|arrange it/.test(t), t)
    reset()
  })
})

// ── R3: Undo of a merge hands the camera back ────────────────
describe('qa4b: undo of a template merge puts the camera back where it was', () => {
  it('even while some of the person\'s cards are still in view', async () => {
    reset()
    if (!document.querySelector('#templatesList .template-item')) setupTemplates()
    await withApp(async () => {
      block('s1', { x: 0, y: 0 }); block('s2', { x: 300, y: 0 })
      Object.assign(view, { panX: 120, panY: 200, zoom: 0.9 }); applyTransform()
      const before = { ...view }
      const i = TEMPLATES.findIndex(t => !t.large)
      $.templatesList().querySelector(`.template-item[data-tpl="${i}"]`).click()
      assert.ok(view.panX !== before.panX || view.panY !== before.panY || view.zoom !== before.zoom, 'the arrival moved the camera')
      // A later step undone first leaves the camera alone.
      mutateBlock('s1', { title: 'Renamed' }, { undo: true })
      const arrived = { ...view }
      undo()
      assert.deepEq({ ...view }, arrived, 'undoing the rename is not the merge')
      undo()
      assert.deepEq(Object.keys(state.blocks).sort(), ['s1', 's2'], 'the merge is undone')
      assert.deepEq({ panX: view.panX, panY: view.panY, zoom: view.zoom }, { panX: before.panX, panY: before.panY, zoom: before.zoom })
    }, { w: 1100, h: 700 })
    reset()
  })
})

// ── R4: the copy fallback's Dismiss and Escape give focus back ─
describe('qa4b: a refused copy\'s toast closes with Dismiss or Escape, focus back on the control', () => {
  function control() {
    const b = document.createElement('button')
    b.textContent = 'Copy link'
    b.style.cssText = 'position:fixed;left:0;top:0;opacity:0'
    document.body.appendChild(b)
    b.focus()
    return b
  }

  it('Escape closes it and the control that copied has focus again', () => {
    reset()
    const b = control()
    try {
      showCopyFallback('https://example.test/#z=abc', 'the link')
      const t = document.querySelector('.toast-notification'), field = t.querySelector('.toast-field')
      assert.eq(document.activeElement, field, 'the text is focused, selected')
      const dismiss = t.querySelector('.toast-action')
      assert.ok(field.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING, 'Tab from the field reaches Dismiss')
      const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      field.dispatchEvent(ev)
      assert.ok(!document.querySelector('.toast-notification'), 'closed')
      assert.ok(ev.defaultPrevented, 'and the Escape goes no further')
      assert.eq(document.activeElement, b)
    } finally { b.remove(); reset() }
  })

  it('Dismiss closes it and gives focus back too', () => {
    reset()
    const b = control()
    try {
      showCopyFallback('some text', 'the text')
      const dismiss = document.querySelector('.toast-notification .toast-action')
      dismiss.focus()
      dismiss.click()
      assert.ok(!document.querySelector('.toast-notification'))
      assert.eq(document.activeElement, b)
    } finally { b.remove(); reset() }
  })

  it('the copy\'s own hidden field hands focus back before the toast opens', async () => {
    const b = control()
    const clip = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const exec = document.execCommand
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('no')) } })
    document.execCommand = () => false
    try {
      assert.eq(await copyText('x'), false)
      assert.eq(document.activeElement, b)
    } finally {
      document.execCommand = exec
      if (clip) Object.defineProperty(navigator, 'clipboard', clip); else delete navigator.clipboard
      b.remove()
    }
  })
})

// ── R5: one name for isolation in Tidy's toast ───────────────
describe('qa4b: Tidy names blocks with no connection "not connected yet"', () => {
  it('in the flow summary and the step-column one', () => {
    const flow = tidySummary({ moved: 9, crossings: 1, loose: 3 }, 12, 'LR', 'Cmd+Z')
    const one = tidySummary({ moved: 9, crossings: 1, loose: 1 }, 12, 'LR', 'Cmd+Z')
    const steps = tidySummary({ moved: 4, crossings: 0, mode: 'steps' }, 6, 'LR', 'Cmd+Z')
    ;[flow, one, steps].forEach(t => {
      assert.ok(!/unconnected/i.test(t), t)
      assert.includes(t, 'connected yet')
      assert.ok(t.endsWith('.'), t)
    })
    assert.includes(flow, 'The 3 blocks not connected yet are in step columns below.')
    assert.includes(one, 'The block not connected yet is in step columns below.')
  })
})

// ── R6: canvas findings are sentences in the brief ───────────
describe('qa4b: every canvas finding in the brief is one sentence, like a gap line', () => {
  const B = (id, type, title, extra = {}) => ({ id, type, title, description: '', notes: '', x: 0, y: 0, actions: [], questions: [],
    criteria: [], rationale: '', docRef: null, status: null, priority: null, ...extra })

  it('one colon at most, a capital first, a full stop last, no second sentence', () => {
    reset()
    state.blocks = {
      g1: B('g1', 'goal', 'Faster close'),
      m1: B('m1', 'metric', 'Close time'),
      i1: B('i1', 'implementation', 'Build the job'),
      r1: B('r1', 'requirement', 'Export to CSV'),
      r2: B('r2', 'requirement', 'Export to CSV'),
      c1: B('c1', 'custom', 'Thing one'), c2: B('c2', 'custom', 'Thing two'), c3: B('c3', 'custom', 'Thing three'),
      h1: B('h1', 'process', 'Run it', { description: 'Who owns this?' }),
      t1: B('t1', 'risk', 'Data drift', { typeCheck: true }),
      p1: B('p1', 'process', 'Step A'), p2: B('p2', 'process', 'Step B'),
    }
    state.arrows = [{ id: 'x1', from: 'p1', to: 'p2' }, { id: 'x2', from: 'p2', to: 'p1' }, { id: 'x3', from: 'g1', to: 'r1' }]
    state.groups = { gr: { id: 'gr', label: 'Empty frame' } }
    try {
      const r = detectGaps(state.blocks, state.arrows, { groups: state.groups })
      const kinds = new Set(r.findings.map(f => f.kind))
      ;['cycle', 'empty-group', 'untyped', 'goal-no-metric', 'metric-unmoved', 'duplicate', 'hidden-question', 'type-check']
        .forEach(k => assert.ok(kinds.has(k), `the map raises ${k}`))
      r.findings.forEach(f => {
        // Titles are the author's words; the finding's own words are judged.
        const words = f.text.replace(/"[^"]*"/g, '"T"')
        const line = findingLine(words)
        assert.ok(/^• [A-Z0-9]/.test(line), line)
        assert.ok(line.endsWith('.') && !line.endsWith('..'), line)
        assert.ok((line.match(/: /g) || []).length <= 1, `one colon at most: ${line}`)
        assert.ok(!/[.?!] [A-Za-z]/.test(line.slice(2, -1)), `one sentence: ${line}`)
      })
      ui.promptDirty = true
      const brief = generatePrompt()
      assert.notIncludes(brief, 'Canvas: ')
      assert.includes(brief, '• Possible duplicate ("Export to CSV" and "Export to CSV"): merge them or make the difference explicit.')
    } finally { reset() }
  })

  it('reads like the block lines beside it', () => {
    assert.eq(findingLine('group "Ops" has a name and no members'), '• Group "Ops" has a name and no members.')
    assert.ok(gapLine('Goal', 'Ship it', 'gap-no-req').startsWith('• Goal'))
  })

  // qa4c: "1 connection close a cycle" printed in the brief.
  it('a count agrees with its verb, one or many', () => {
    const line = blocks => {
      const arrows = []
      for (let i = 0; i < blocks.length; i += 2) arrows.push({ id: 'f' + i, from: blocks[i], to: blocks[i + 1] }, { id: 'b' + i, from: blocks[i + 1], to: blocks[i] })
      const map = Object.fromEntries(blocks.map(id => [id, B(id, 'process', 'Step ' + id)]))
      const f = detectGaps(map, arrows).findings.find(x => x.kind === 'cycle')
      return f && findingLine(f.text)
    }
    assert.eq(line(['p1', 'p2']), '• 1 connection closes a cycle: the dependency order is circular somewhere.')
    assert.eq(line(['p1', 'p2', 'p3', 'p4']), '• 2 connections close a cycle: the dependency order is circular somewhere.')
    const one = { h1: B('h1', 'process', 'Run it', { description: 'Who owns this?' }), t1: B('t1', 'risk', 'Drift', { typeCheck: true }) }
    const texts = detectGaps(one, []).findings.map(f => findingLine(f.text))
    assert.ok(texts.some(t => t.startsWith('• 1 block keeps a question')), texts.join(' | '))
    assert.ok(texts.some(t => t.startsWith('• 1 block was typed automatically and awaits a check')), texts.join(' | '))
  })

  // qa4c: findingLine was inserted between gapLine and gapLine's own doc
  // comment, so two doc blocks sat back to back and gapLine had none.
  it('every doc comment in js/ sits on the code it describes, never two back to back', async () => {
    const files = [...await jsFiles('../js/'), ...await jsFiles('../js/trace/')]
    for (const f of files) {
      const src = await fetchText(f)
      assert.ok(!/\*\/[ \t]*\r?\n[ \t]*\/\*\*/.test(src), `${f.replace('../', '')}: a doc comment with no code under it`)
    }
    const gaps = await fetchText('../js/gaps.js')
    assert.match(gaps, /One line of the brief for a gap on a block[\s\S]{0,200}\*\/\s*export function gapLine/)
    assert.match(gaps, /A canvas finding[\s\S]{0,250}\*\/\s*export function findingLine/)
  })
})

// ── R7: Connect to shows its key ─────────────────────────────
describe('qa4b: the block menu\'s Connect to row shows its key, C', () => {
  it('in the row and on screen', () => {
    reset()
    block('a', { x: 0 }); block('b', { x: 300 })
    try {
      const row = blockMenuItems('a').find(i => i.ctx === 'connect')
      assert.eq(row?.shortcut, 'C')
      const menu = openBlockMenu('a', 100, 100)
      const el = [...document.querySelectorAll('.pf-menu .pf-menu-item')].find(e => /Connect to/.test(e.textContent))
      assert.ok(el, 'the row is in the menu')
      assert.eq(el.querySelector('.pf-menu-shortcut')?.textContent.trim(), 'C')
      void menu
    } finally { closeMenus(); reset() }
  })

  // qa4c: C ended 30px left of Enter, Cmd+D and Del, before its chevron.
  it('its key cap ends on the same edge as every other key in the menu', async () => {
    reset()
    await withApp(async () => {
      block('a', { x: 0 }); block('b', { x: 300 })
      try {
        openBlockMenu('a', 100, 100)
        const menu = document.querySelector('.pf-menu.ctx-block-menu')
        const rows = [...menu.querySelectorAll(':scope > .pf-menu-item')]
        const keyed = rows.filter(r => r.querySelector('.pf-menu-shortcut'))
        assert.gt(keyed.length, 3, 'Enter, Shift+Enter, C, Cmd+D, Del')
        assert.ok(keyed.some(r => r.getAttribute('aria-haspopup') === 'menu'), 'one of them opens a submenu (Connect to)')
        const edges = keyed.map(r => Math.round(r.querySelector('.pf-menu-shortcut').getBoundingClientRect().right))
        assert.eq(new Set(edges).size, 1, `key caps end at ${edges.join(', ')}`)
        // The reserved slot is the chevron's own box, empty and hidden from assistive tech.
        const slot = keyed.find(r => !r.getAttribute('aria-haspopup')).querySelector('.pf-menu-caret-slot')
        assert.ok(slot && !slot.children.length && slot.getAttribute('aria-hidden') === 'true')
        assert.eq(Math.round(slot.getBoundingClientRect().right), Math.round(rowWith(rows, 'Connect to').querySelector('.pf-menu-caret').getBoundingClientRect().right))
      } finally { closeMenus() }
    }, { w: 900, h: 600 })
    reset()
  })

  it('a menu with no submenu keeps no slot (File-style lists stay as they were)', () => {
    reset()
    block('a', { x: 0 })
    try {
      openMenu([{ label: 'One', shortcut: 'A', action: () => {} }, { label: 'Two', action: () => {} }], { x: 10, y: 10 })
      assert.eq(document.querySelectorAll('.pf-menu .pf-menu-caret-slot').length, 0)
    } finally { closeMenus(); reset() }
  })
})
const rowWith = (rows, text) => rows.find(r => r.textContent.includes(text))

// ── R8: an arrival keeps every card on screen clear of Find blocks ─
describe('qa4b: an arrival keeps the person\'s own cards clear of the floating controls too', () => {
  it('a card that did not arrive, under the control, moves out from under it with the arrived ones still whole', async () => {
    reset()
    await withApp(async () => {
      const W = 1000, H = 700
      block('t1', { x: 0, y: 0 }); block('t2', { x: 300, y: 0 })   // the arrival
      block('own', { x: 640, y: -200 })                               // the person's card, up and to the right
      const plain = arrivalView(['t1', 't2'], { w: W, h: H })
      const o = state.blocks.own, s = getBlockDims('own')
      const at = { x1: o.x * plain.zoom + plain.panX, y1: o.y * plain.zoom + plain.panY }
      assert.ok(at.y1 >= 0 && at.y1 < H && at.x1 < W, `the card shows at ${Math.round(at.x1)}, ${Math.round(at.y1)}`)
      // A control over where that card lands.
      const avoid = [{ x1: at.x1, y1: at.y1, x2: at.x1 + 60, y2: at.y1 + 30 }]
      const v = arrivalView(['t1', 't2'], { w: W, h: H }, { avoid })
      const y1 = o.y * v.zoom + v.panY, x1 = o.x * v.zoom + v.panX
      const meets = x1 < avoid[0].x2 && x1 + s.w * v.zoom > avoid[0].x1 && y1 < avoid[0].y2 && y1 + s.h * v.zoom > avoid[0].y1
      assert.ok(!meets, 'the person\'s card is clear of the control')
      assert.ok(v.whole, 'and the arrived cards still all show')
    }, { w: 1000, h: 700 })
    reset()
  })
})

// ── An arrival that shows whole stays whole while it clears a control ─
describe('qa4b: clearing a control never trades an arrived card for one of yours', () => {
  it('every arrived card stays on screen when moving the person\'s card clear would push one off', async () => {
    reset()
    await withApp(async () => {
      block('t1', { x: 0, y: 0 }); block('t2', { x: 340, y: 0 }); block('t3', { x: 680, y: 0 }); block('t4', { x: 0, y: 420 })
      block('own', { x: 0, y: 200 })                                  // the person's card, between the arrival's rows
      const ids = ['t1', 't2', 't3', 't4']
      // A view the arrival fits with almost no room to spare: any move big
      // enough to clear the person's card pushes an arrived card off.
      const W = 680 + getBlockDims('t3').w + 12, H = 420 + getBlockDims('t4').h + 100
      const plain = arrivalView(ids, { w: W, h: H })
      assert.ok(plain.whole, 'with nothing in the way, every arrived card shows')
      const o = state.blocks.own, s = getBlockDims('own'), z = plain.zoom
      const x1 = o.x * z + plain.panX, y1 = o.y * z + plain.panY
      const avoid = [{ x1: x1 - 4, y1: y1 - 4, x2: x1 + s.w * z + 4, y2: y1 + s.h * z + 4 }]
      const v = arrivalView(ids, { w: W, h: H }, { avoid })
      assert.ok(v.whole, 'every arrived card still shows with the control over the person\'s card')
    }, { w: 1000, h: 700 })
    reset()
  })
})

// ── R9: the empty description's caption never sits on a label ─
describe('qa4b: the selected card\'s caption steps out of a connection label\'s way', () => {
  it('hidden while it meets a label, shown again when it does not', async () => {
    reset()
    const layer = byId('arrowsLayer'), prevCss = layer.style.cssText
    await withApp(async () => {
      block('a', { x: 40, y: 40, title: 'Top card' })
      selectBlock('a')
      const desc = byId('b-a').querySelector('.block-desc')
      const c = desc.getBoundingClientRect()
      assert.ok(c.width > 0 && c.height > 0, 'the caption shows under the selected card')
      layer.style.cssText = 'display:block;position:fixed;left:0;top:0;width:1px;height:1px;overflow:visible;opacity:0;pointer-events:none'
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      g.setAttribute('class', 'arrow-label-g')
      const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      pill.setAttribute('class', 'arrow-label-bg')
      pill.setAttribute('x', c.left + 20); pill.setAttribute('y', c.top); pill.setAttribute('width', 60); pill.setAttribute('height', 18)
      g.appendChild(pill); $.arrowsGroup().appendChild(g)
      try {
        assert.ok(settleDescCaption(), 'it meets the label, so it steps out')
        assert.ok(byId('b-a').classList.contains('desc-caption-off'))
        assert.eq(getComputedStyle(desc).display, 'none')
        pill.setAttribute('y', c.bottom + 200)
        assert.ok(!settleDescCaption(), 'clear of it, it shows')
        assert.ok(!byId('b-a').classList.contains('desc-caption-off'))
      } finally { g.remove(); layer.style.cssText = prevCss }
    }, { w: 900, h: 600 })
    reset()
  })
})

// ── T1: every toast is a plain statement ending in a full stop ─
// A scan of the source: every showToast call's string and template
// literals that end the message (not a condition, not a piece that a +
// continues). A template ending in ${arrivalHint()} ends in its sentence.
export function toastLiterals(src) {
  const out = []
  const re = /(?<![\w.])showToast\(/g
  let m
  while ((m = re.exec(src))) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue
    let i = m.index + m[0].length
    const lits = []
    let depth = 0
    const readString = (at, q) => {
      let j = at + 1, text = ''
      if (q !== '`') {
        while (j < src.length && src[j] !== q) { if (src[j] === '\\') { text += src[j + 1]; j += 2; continue } text += src[j++] }
        return { text, end: j + 1 }
      }
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { text += src[j + 1]; j += 2; continue }
        if (src[j] === '$' && src[j + 1] === '{') {
          let d = 1, k = j + 2, expr = ''
          while (k < src.length && d) {
            const c = src[k]
            if (c === '`' || c === '"' || c === "'") { const s = readString(k, c); expr += src.slice(k, s.end); k = s.end; continue }
            if (c === '{') d++
            else if (c === '}') { d--; if (!d) break }
            expr += c; k++
          }
          text += '${' + expr + '}'
          j = k + 1; continue
        }
        text += src[j++]
      }
      return { text, end: j + 1 }
    }
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
      if (c === "'" || c === '"' || c === '`') {
        const s = readString(i, c)
        if (depth === 0) lits.push({ text: s.text, start: i, end: s.end })
        i = s.end - 1; continue
      }
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth-- }
      else if (c === ',' && depth === 0) break
    }
    const line = src.slice(0, m.index).split('\n').length
    lits.forEach(l => {
      if (/^\s*(\+|\?|===|!==|==|!=|&&)/.test(src.slice(l.end))) return
      if (/(===|!==|==|!=)\s*$/.test(src.slice(0, l.start))) return
      out.push({ line, text: l.text })
    })
  }
  return out
}
const endsSentence = t => /[.?]["”)]?$/.test(t.trim()) || /\$\{(arrivalHint\(\)|ARRIVAL_HINT|ARRIVAL_HINT_TOUCH)\}$/.test(t.trim())

async function jsFiles(dir) {
  const html = await fetchText(dir)
  return [...html.matchAll(/href="([^"?#]+\.js)"/g)].map(m => dir + decodeURIComponent(m[1]))
}

describe('qa4b: every toast is a plain statement that ends in a full stop', () => {
  it('the scanner reads what it should', () => {
    const src = "showToast('Done', 'x'); showToast(a ? 'One.' : `Two ${n}`, 'y'); showToast(source === 'file' ? 'A.' : 'B.'); showToast('Part ' + n + ' end.')"
    assert.deepEq(toastLiterals(src).map(l => l.text), ['Done', 'One.', 'Two ${n}', 'A.', 'B.', ' end.'])
  })

  it('every showToast literal in js/ and js/trace/', async () => {
    const files = [...await jsFiles('../js/'), ...await jsFiles('../js/trace/')]
    assert.gt(files.length, 40, 'the listing names the modules')
    let seen = 0
    for (const f of files) {
      const lits = toastLiterals(await fetchText(f))
      seen += lits.length
      lits.forEach(l => assert.ok(endsSentence(l.text), `${f.replace('../', '')}:${l.line} "${l.text}"`))
    }
    assert.gt(seen, 90, `${seen} messages read`)
  })

  it('no module appends a full stop at runtime to a message that lacks one (qa4c)', async () => {
    const files = [...await jsFiles('../js/'), ...await jsFiles('../js/trace/')]
    // A regex literal testing a string's last character for a stop, the
    // way landIncoming did: /[.?]$/.test(msg) ? msg : msg + '.'
    const append = /\/\[[.?!]+\]\$\/\.test\([^)]*\)\s*\?[^:]*:\s*[\w.]+\s*\+\s*['"`]\./
    for (const f of files) assert.ok(!append.test(await fetchText(f)), `${f.replace('../', '')} appends a full stop at runtime`)
    assert.ok(append.test("const lead = msg ? (/[.?]$/.test(msg) ? msg : msg + '.') : x"), 'the scan reads the pattern')
  })

  it('and the messages built elsewhere', () => {
    reset()
    const all = [
      tidySummary({ moved: 0, crossings: 0 }, 3, 'LR', 'Cmd+Z'),
      tidySummary({ moved: 2, crossings: 0, underCards: 1 }, 3, 'TB', 'Cmd+Z'),
      backupNagText(null, false), backupNagText(3, true),
      dumpSummary(4, 1, false, 'Shift+1'),
      importMessage(3, { blocks: 1, arrows: 0, groups: 0 }, 'merge'),
      ...Object.values(IMPORT_ERRORS).map(f => f()),
      ...Object.values(LINK_ERRORS).map(f => f(404)),
    ]
    all.forEach(t => assert.ok(endsSentence(t), t))
    // qa4c: what a link, a file or ?src= says once it lands, every branch,
    // each ending in its own full stop (landIncoming appends nothing).
    const none = { blocks: 0, arrows: 0, groups: 0 }, two = { blocks: 1, arrows: 1, groups: 0 }
    const landed = []
    ;[none, two].forEach(dropped => {
      ;[{ mode: 'new' }, { mode: 'new', reused: true }, { mode: 'merge', imported: 3 }, { mode: 'merge', imported: 1 },
        { mode: 'replace', replacedContent: true }, { mode: 'replace', replacedContent: true, keptDropped: 2 },
        { mode: 'replace' }].forEach(r => {
        const m = incomingMessage({ ...r, dropped }, 'shared map')
        if (m !== null) landed.push(m)
        landed.push(srcMessage({ imported: 3, ...r, dropped }))
      })
    })
    assert.gt(landed.length, 20)
    landed.forEach(t => {
      assert.ok(t.endsWith('.') && !t.endsWith('..'), t)
      assert.ok(!/\. [a-z]/.test(t), `each sentence starts with a capital: ${t}`)
    })
    assert.eq(incomingMessage({ mode: 'new', dropped: none }, 'shared map'), 'Opened the shared map as a new map. Yours is under Maps.')
    assert.eq(srcMessage({ mode: 'new', imported: 1, dropped: two }),
      'Loaded 1 block from the link as a new map, skipped 2 invalid items. Yours is under Maps.')
    block('x', { x: 0 })
    arrangeSelection('align', ['x'], 'left')
    assert.eq(toastText(), 'Select two or more blocks to align.')
    reset()
  })
})

// ── T2: doc prose holds 65 to 75 characters a line ───────────
describe('qa4b: doc pages hold prose at 65 to 75 characters a line', () => {
  it('the tutorial\'s paragraphs, laid out with the real stylesheet in a 720px column', async () => {
    const sheet = await realSheet()
    const doc = new DOMParser().parseFromString(await fetchText('../tutorial.html'), 'text/html')
    const paras = [...doc.querySelectorAll('main.doc > p:not([class]), main.doc section > p:not([class])')]
      .filter(p => p.textContent.trim().length > 200).slice(0, 12)
    assert.gt(paras.length, 4, 'enough prose to measure')
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:0;top:0;width:1440px;opacity:0;pointer-events:none'
    document.body.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    root.adoptedStyleSheets = [sheet]
    root.innerHTML = `<main class="doc">${paras.map(p => p.outerHTML).join('')}</main>`
    try {
      const lens = []
      root.querySelectorAll('p').forEach(p => {
        const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
        let n, cur = 0, prevLeft = -1e9
        const lines = []
        while ((n = w.nextNode())) {
          for (let i = 0; i < n.textContent.length; i++) {
            const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1)
            const rc = r.getClientRects()[0]; if (!rc) continue
            if (rc.left < prevLeft - 30) { lines.push(cur); cur = 0 }
            cur++; prevLeft = rc.left
          }
        }
        lens.push(...lines)   // a paragraph's last line is short by nature
      })
      lens.sort((a, b) => a - b)
      const median = lens[Math.floor(lens.length / 2)]
      assert.ok(median >= 65 && median <= 75, `median ${median} characters a line over ${lens.length} lines`)
    } finally { host.remove() }
  })
})

// ── T3 and P1: the Brief's right edge, and Read remembered ───
// The right panel from index.html (as reading.test.js mounts it), with the
// real stylesheet, the runner's stub ids stepping aside while it is mounted.
const host = { el: null, marks: [], sheets: null }
async function mountPanel(width = 400) {
  const doc = new DOMParser().parseFromString(await fetchText('../index.html'), 'text/html')
  const parts = ['panelResizer', 'promptPane'].map(id => document.importNode(doc.getElementById(id), true))
  parts.forEach(p => [p, ...p.querySelectorAll('[id]')].forEach(n => {
    const stub = n.id && document.getElementById(n.id)
    if (!stub) return
    const mark = document.createComment('stub ' + n.id)
    stub.replaceWith(mark)
    host.marks.push({ mark, stub })
  }))
  const sheet = await realSheet()
  host.sheets = [...document.adoptedStyleSheets]
  const extra = new CSSStyleSheet()
  // A scrollbar that takes room, as Safari's and desktop Chrome's do.
  extra.replaceSync('#briefDoc::-webkit-scrollbar { width: 8px; } #briefDoc::-webkit-scrollbar-thumb { background: gray; }')
  document.adoptedStyleSheets = [...host.sheets, sheet, extra]
  const row = document.createElement('div')
  row.style.cssText = 'position:fixed;right:0;top:0;height:600px;display:flex;opacity:0;pointer-events:none;z-index:-1'
  const aside = document.createElement('aside')
  aside.id = 'rightPanel'
  aside.className = 'right-panel'
  aside.style.cssText = `height:600px;width:var(--panel-w, ${width}px);display:flex;flex-direction:column`
  const [sep, pane] = parts
  aside.append(pane)
  row.append(sep, aside)
  document.body.appendChild(row)
  host.el = row
  return pane
}
function unmountPanel() {
  setReading(false)
  host.el?.remove(); host.el = null
  host.marks.forEach(({ mark, stub }) => mark.replaceWith(stub)); host.marks = []
  if (host.sheets) document.adoptedStyleSheets = host.sheets
  host.sheets = null
  try { localStorage.removeItem(READ_PREF_KEY); localStorage.removeItem(PANEL_WIDTH_KEY) } catch (_) {}
}
const longBrief = () => Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i} of the brief, with enough words to wrap across the column and make it scroll in its own box.</p>`).join('')

describe('qa4b: the Brief\'s rows end where its text does, scrollbar or not', () => {
  it('the reply row and the head keep to the text column on a panel narrower than it', async () => {
    const pane = await mountPanel(400)
    try {
      pane.classList.add('active')
      byId('promptOutput').innerHTML = longBrief()
      await frame()
      const g = syncBriefGutter()
      const doc = byId('briefDoc')
      assert.eq(g, doc.offsetWidth - doc.clientWidth - (parseFloat(getComputedStyle(doc).borderLeftWidth) || 0) - (parseFloat(getComputedStyle(doc).borderRightWidth) || 0))
      await frame()
      const md = byId('promptOutput'), cs = getComputedStyle(md)
      const text = md.getBoundingClientRect().left + md.clientLeft + md.clientWidth - parseFloat(cs.paddingRight)
      const reply = document.querySelector('.brief-reply-head').getBoundingClientRect().right
      assert.ok(Math.abs(reply - text) <= 1, `the reply row ends at ${reply.toFixed(1)}, the text at ${text.toFixed(1)} (scrollbar ${g}px)`)
      const head = document.querySelector('.brief-head'), hs = getComputedStyle(head)
      const headRight = head.getBoundingClientRect().right - parseFloat(hs.paddingRight)
      assert.ok(Math.abs(headRight - text) <= 1, `the head's content ends at ${headRight.toFixed(1)}`)
    } finally { unmountPanel() }
  })
})

describe('qa4b: Read, once left on, is how the Brief opens next time', () => {
  // The tab's observers (setupReading) call resumeReading as the Brief tab
  // comes into view and setReading(false) as it goes; they are wired once,
  // to the page's own panel, so this drives the same calls.
  async function ready() {
    const pane = await mountPanel(320)
    pane.classList.add('active')
    byId('promptOutput').innerHTML = longBrief()
    pane.classList.remove('is-empty')
    resetPanelWidth()
    await frame()
    return pane
  }

  it('someone who never pressed Read never gets the panel widened', async () => {
    await ready()
    try {
      try { localStorage.removeItem(READ_PREF_KEY) } catch (_) {}
      assert.eq(resumeReading(), false)
      assert.ok(!isWidthBorrowed())
      assert.eq(readPref(), false)
    } finally { unmountPanel() }
  })

  it('a press on stores it, the tab opening again reads, a press off forgets', async () => {
    const pane = await ready()
    try {
      assert.ok(pressRead(), 'Read widened the panel')
      assert.ok(readPref(), 'and is remembered')
      setReading(false)   // the tab changed: the width goes back
      assert.ok(!isWidthBorrowed())
      assert.ok(readPref(), 'but Read stays remembered')
      assert.ok(resumeReading(), 'the tab opens reading again')
      assert.ok(isWidthBorrowed())
      assert.eq(pressRead(), false)
      assert.ok(!readPref(), 'pressed off, it is forgotten')
      assert.eq(resumeReading(), false)
      pane.classList.remove('active')
      try { localStorage.setItem(READ_PREF_KEY, '1') } catch (_) {}
      assert.eq(resumeReading(), false, 'and never while another tab is open')
    } finally { unmountPanel() }
  })

  it('a width of the person\'s own while reading ends it for next time too', async () => {
    await ready()
    try {
      assert.ok(pressRead())
      assert.ok(readPref())
      setPanelWidth(500)
      assert.ok(!isWidthBorrowed())
      assert.ok(!readPref())
    } finally { resetPanelWidth(); unmountPanel() }
  })

  it('storage that throws is a preference not kept, never an error', () => {
    const orig = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('blocked') }
    try { assert.eq(readPref(), false) } finally { Storage.prototype.getItem = orig }
  })
})
