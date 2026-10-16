// ============================================================
//  canvas.test.js -- Tests for js/canvas.js (geometry functions)
// ============================================================

import { describe, it, assert, mockBlockEl, cleanupMockEls } from './test-utils.js'
import { state } from '../js/state.js'
import { portPos, bestPorts, buildPath, pathFor, cpOffset, blockAtWorld, blocksInRect,
         resolveRoutes } from '../js/canvas.js'
import { DEFAULT_WIDTH } from '../js/utils.js'
// Wave 4 (CANVAS), at the end of this file.
import { ui, view, selection, getUndoHistory, getRedoFuture, resetSnapshotToken } from '../js/state.js'
import { $ } from '../js/utils.js'
import { renderBlock, deselectAll, selectBlock, setSelection } from '../js/render.js'
import { applyTransform, renderFrames } from '../js/canvas.js'
import { runGapDetection, isolationSummary } from '../js/gaps.js'
import { attentionModel, attentionBreakdown, attentionRowsHtml, isolationWords } from '../js/attention.js'
import { setupMinimap, setMinimap, placeMinimap, minimapSpot } from '../js/minimap.js'
import { closeMenus } from '../js/menu.js'
import { setupKeyboardShortcuts, setupTabNavigation } from '../js/events.js'
import { setupZoomControls, arriveIfLost, contentInView } from '../js/zoom-controls.js'
import { applyLod, fitTitle, faceLayout, faceMetrics, titlePieces, nearView, FACE_METRICS, FIT_NOW_MAX, ELLIPSIS } from '../js/lod.js'

// Default block dims when no DOM element: { w: 220, h: 100 }
const DW = DEFAULT_WIDTH  // 220
const DH = 100

function resetCanvas() {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
}

function addBlock(id, x, y) {
  state.blocks[id] = {
    id, type: 'goal', title: 'Test',
    description: '', notes: '',
    x, y,
    actions: [], questions: [],
    width: null, color: null, collapsed: false, groupId: null,
  }
}

// ── portPos ──────────────────────────────────────────────────

describe('portPos()', () => {
  it('returns null for nonexistent block', () => {
    resetCanvas()
    assert.eq(portPos('nope', 'left'), null)
  })

  it('returns correct position for left port', () => {
    resetCanvas()
    addBlock('b1', 100, 200)
    const p = portPos('b1', 'left')
    assert.eq(p.x, 100)          // b.x
    assert.eq(p.y, 200 + DH/2)   // b.y + h/2
    assert.eq(p.dir, 'left')
  })

  it('returns correct position for right port', () => {
    resetCanvas()
    addBlock('b1', 100, 200)
    const p = portPos('b1', 'right')
    assert.eq(p.x, 100 + DW)     // b.x + w
    assert.eq(p.y, 200 + DH/2)   // b.y + h/2
    assert.eq(p.dir, 'right')
  })

  it('returns correct position for top port', () => {
    resetCanvas()
    addBlock('b1', 100, 200)
    const p = portPos('b1', 'top')
    assert.eq(p.x, 100 + DW/2)   // b.x + w/2
    assert.eq(p.y, 200)          // b.y
    assert.eq(p.dir, 'top')
  })

  it('returns correct position for bottom port', () => {
    resetCanvas()
    addBlock('b1', 100, 200)
    const p = portPos('b1', 'bottom')
    assert.eq(p.x, 100 + DW/2)   // b.x + w/2
    assert.eq(p.y, 200 + DH)     // b.y + h
    assert.eq(p.dir, 'bottom')
  })

  it('returns null for invalid port name', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    assert.eq(portPos('b1', 'invalid'), null)
  })
})

// ── bestPorts ────────────────────────────────────────────────

describe('bestPorts()', () => {
  it('returns null when source block does not exist', () => {
    resetCanvas()
    addBlock('b2', 500, 100)
    assert.eq(bestPorts('nope', 'b2'), null)
  })

  it('returns null when target block does not exist', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    assert.eq(bestPorts('b1', 'nope'), null)
  })

  it('selects right->left when target is to the right', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    addBlock('b2', 500, 0)
    const pts = bestPorts('b1', 'b2')
    assert.eq(pts.d1, 'right')
    assert.eq(pts.d2, 'left')
    assert.eq(pts.x1, 0 + DW)    // right edge of b1
    assert.eq(pts.x2, 500)        // left edge of b2
  })

  it('selects left->right when target is to the left', () => {
    resetCanvas()
    addBlock('b1', 500, 0)
    addBlock('b2', 0, 0)
    const pts = bestPorts('b1', 'b2')
    assert.eq(pts.d1, 'left')
    assert.eq(pts.d2, 'right')
  })

  it('selects bottom->top when target is below', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    addBlock('b2', 0, 400)
    const pts = bestPorts('b1', 'b2')
    assert.eq(pts.d1, 'bottom')
    assert.eq(pts.d2, 'top')
  })

  it('selects top->bottom when target is above', () => {
    resetCanvas()
    addBlock('b1', 0, 400)
    addBlock('b2', 0, 0)
    const pts = bestPorts('b1', 'b2')
    assert.eq(pts.d1, 'top')
    assert.eq(pts.d2, 'bottom')
  })

  it('prefers horizontal when dx == dy (equal offset)', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    // Place b2 so dx == dy after centering (dx >= dy -> horizontal)
    addBlock('b2', 300, 300)
    const pts = bestPorts('b1', 'b2')
    // dx = (300 + DW/2) - (0 + DW/2) = 300
    // dy = (300 + DH/2) - (0 + DH/2) = 300
    // abs(dx) >= abs(dy) -> horizontal
    assert.ok(pts.d1 === 'right' || pts.d1 === 'left')
  })
})

// ── cpOffset ─────────────────────────────────────────────────

describe('cpOffset()', () => {
  it('offsets right (+x)', () => {
    const c = cpOffset(100, 200, 'right', 50)
    assert.eq(c.x, 150)
    assert.eq(c.y, 200)
  })

  it('offsets left (-x)', () => {
    const c = cpOffset(100, 200, 'left', 50)
    assert.eq(c.x, 50)
    assert.eq(c.y, 200)
  })

  it('offsets bottom (+y)', () => {
    const c = cpOffset(100, 200, 'bottom', 50)
    assert.eq(c.x, 100)
    assert.eq(c.y, 250)
  })

  it('offsets top (-y)', () => {
    const c = cpOffset(100, 200, 'top', 50)
    assert.eq(c.x, 100)
    assert.eq(c.y, 150)
  })

  it('handles zero offset', () => {
    const c = cpOffset(100, 200, 'right', 0)
    assert.eq(c.x, 100)
    assert.eq(c.y, 200)
  })
})

// ── buildPath ────────────────────────────────────────────────

describe('buildPath()', () => {
  it('straight style produces M...L path', () => {
    const d = buildPath(0, 0, 'right', 100, 100, 'left', 'straight')
    assert.match(d, /^M\s/)
    assert.includes(d, 'L')
    assert.notIncludes(d, 'C')
    assert.notIncludes(d, 'H')
  })

  it('elbow style with horizontal start produces M...H...V...H path', () => {
    const d = buildPath(0, 0, 'right', 200, 100, 'left', 'elbow')
    assert.match(d, /^M\s/)
    assert.includes(d, 'H')
    assert.includes(d, 'V')
  })

  it('elbow style with vertical start produces M...V...H...V path', () => {
    const d = buildPath(0, 0, 'bottom', 100, 200, 'top', 'elbow')
    assert.match(d, /^M\s/)
    assert.includes(d, 'V')
    assert.includes(d, 'H')
  })

  it('curved (default) style produces M...C path', () => {
    const d = buildPath(0, 0, 'right', 300, 200, 'left')
    assert.match(d, /^M\s/)
    assert.includes(d, 'C')
  })

  it('curved path starts and ends at specified coordinates', () => {
    const d = buildPath(10, 20, 'right', 300, 400, 'left')
    assert.match(d, /^M 10 20/)
    assert.match(d, /300 400$/)
  })

  it('straight path starts and ends at specified coordinates', () => {
    const d = buildPath(10, 20, 'right', 300, 400, 'left', 'straight')
    assert.match(d, /^M 10 20/)
    assert.match(d, /300 400$/)
  })
})

// ── blockAtWorld ─────────────────────────────────────────────

describe('blockAtWorld()', () => {
  it('returns null when no blocks exist', () => {
    resetCanvas()
    assert.eq(blockAtWorld(50, 50), null)
  })

  it('returns block ID when point is inside a block', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    // Block occupies x:[100, 100+220], y:[100, 100+100]
    const hit = blockAtWorld(150, 150)
    assert.eq(hit, 'b1')
  })

  it('returns null when point is outside all blocks', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    assert.eq(blockAtWorld(50, 50), null)   // before block
    assert.eq(blockAtWorld(400, 400), null)  // after block
  })

  it('detects hit at block edges', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    // Exactly on left-top corner
    assert.eq(blockAtWorld(100, 100), 'b1')
    // Exactly on right-bottom corner
    assert.eq(blockAtWorld(100 + DW, 100 + DH), 'b1')
  })

  it('returns first matching block when blocks overlap', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    addBlock('b2', 110, 110) // overlapping b1
    const hit = blockAtWorld(150, 150)
    assert.ok(hit === 'b1' || hit === 'b2', 'Should match one of the overlapping blocks')
  })
})

// ── blocksInRect ─────────────────────────────────────────────

describe('blocksInRect()', () => {
  it('returns empty array when no blocks exist', () => {
    resetCanvas()
    assert.deepEq(blocksInRect(0, 0, 500, 500), [])
  })

  it('returns blocks fully inside the rect', () => {
    resetCanvas()
    addBlock('b1', 100, 100)  // occupies [100,320] x [100,200]
    const found = blocksInRect(0, 0, 500, 500)
    assert.includes(found, 'b1')
  })

  it('returns blocks partially overlapping the rect', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    // Rect that just clips the corner of b1
    const found = blocksInRect(0, 0, 110, 110)
    assert.includes(found, 'b1')
  })

  it('excludes blocks fully outside the rect', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    addBlock('b2', 800, 800)
    const found = blocksInRect(0, 0, 400, 400)
    assert.includes(found, 'b1')
    assert.ok(!found.includes('b2'))
  })

  it('handles inverted rect coordinates (normalizes min/max)', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    // Pass coords in reverse order
    const found = blocksInRect(500, 500, 0, 0)
    assert.includes(found, 'b1')
  })

  it('returns empty when rect does not overlap any block', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    const found = blocksInRect(0, 0, 50, 50) // too small to reach b1
    assert.eq(found.length, 0)
  })

  it('selects multiple blocks', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    addBlock('b2', 200, 200)
    addBlock('b3', 300, 300)
    const found = blocksInRect(0, 0, 600, 600)
    assert.eq(found.length, 3)
  })
})

// ── Port lanes ───────────────────────────────────────────────

describe('portPos() -- lanes', () => {
  it('returns the exact midpoint for a single connection', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    const solo = portPos('b1', 'right')
    const explicit = portPos('b1', 'right', 0, 1)
    assert.eq(solo.y, DH / 2)
    assert.eq(explicit.y, solo.y)
  })

  it('spreads several connections along the side in order', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    const ys = [0, 1, 2].map(i => portPos('b1', 'right', i, 3).y)
    assert.ok(ys[0] < ys[1], 'lane 0 should sit above lane 1')
    assert.ok(ys[1] < ys[2], 'lane 1 should sit above lane 2')
  })

  it('keeps every lane inside the block', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    for (let i = 0; i < 6; i++) {
      const p = portPos('b1', 'right', i, 6)
      assert.ok(p.y > 0 && p.y < DH, `lane ${i} should be inside the block, got ${p.y}`)
    }
  })

  it('spreads horizontally on the top and bottom sides', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    const xs = [0, 1].map(i => portPos('b1', 'top', i, 2).x)
    assert.ok(xs[0] < xs[1])
    assert.ok(xs[0] > 0 && xs[1] < DW)
  })

  it('centres the middle lane of an odd fan', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    assert.eq(portPos('b1', 'right', 1, 3).y, DH / 2)
  })
})

describe('resolveRoutes()', () => {
  it('gives every arrow its own lane on a shared side', () => {
    resetCanvas()
    addBlock('hub', 400, 200)
    addBlock('s1', 0, 0)
    addBlock('s2', 0, 200)
    addBlock('s3', 0, 400)
    state.arrows = ['s1', 's2', 's3'].map((id, i) => ({
      id: 'a' + i, from: id, to: 'hub', style: 'curved',
      weight: 2, bidirectional: false, color: null, fromPort: null, toPort: null,
    }))
    const routes = resolveRoutes({ cheap: true })
    const ys = ['a0', 'a1', 'a2'].map(id => routes.get(id).y2)
    assert.eq(new Set(ys).size, 3, 'three arrows into one side should land on three points')
    assert.eq(routes.get('a0').toLaneCount, 3, 'the crowded end should report its fan size')
    assert.eq(routes.get('a0').fromLaneCount, 1, 'the source side carries one arrow each')
    assert.eq(routes.get('a0').laneCount, 3, 'label spread should follow the crowded end')
  })

  it('skips arrows whose endpoints are gone', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    state.arrows = [{ id: 'a1', from: 'b1', to: 'ghost', style: 'curved', weight: 2,
                      bidirectional: false, color: null, fromPort: null, toPort: null }]
    assert.eq(resolveRoutes({ cheap: true }).size, 0)
  })
})

describe('buildPath() -- elbow entry side', () => {
  it('uses one bend when the two ends face different axes', () => {
    // Leaving right and arriving from above needs a single corner. Using only
    // the start direction produced a path that approached from the wrong side.
    const d = buildPath(0, 0, 'right', 200, 100, 'top', 'elbow')
    assert.eq(d, 'M 0 0 H 200 V 100')
  })

  it('still uses two bends when both ends are horizontal', () => {
    const d = buildPath(0, 0, 'right', 200, 100, 'left', 'elbow')
    assert.eq(d, 'M 0 0 H 100 V 100 H 200')
  })
})

// ============================================================
//  CANVAS (design round, wave 4): legible and quiet at every zoom.
//  Face titles that break between words, faces centred in their
//  card, the 11px floor from 92%, the canvas focus chip, Escape
//  after a pointer selection, isolation as one finding, the
//  minimap and the camera on load.
// ============================================================

function reset4() {
  closeMenus()
  cleanupMockEls()
  state.blocks = {}; state.arrows = []; state.groups = {}
  ui.readOnly = false; ui.embed = false
  getUndoHistory().length = 0; getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
  $.canvasRoot().querySelectorAll('.block').forEach(el => el.remove())
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
}

function card(id, extra = {}) {
  state.blocks[id] = { id, type: 'process', title: id, description: '', notes: '', x: 0, y: 0, actions: [], questions: [],
    docRef: null, width: null, color: null, collapsed: false, groupId: null, status: null, priority: null, highlight: null, ...extra }
  renderBlock(id)
  return state.blocks[id]
}

let sheet4 = null
async function appSheet() {
  if (!sheet4) {
    const css = await (await fetch('../css/style.css')).text()
    sheet4 = new CSSStyleSheet(); sheet4.replaceSync(css)
  }
  return sheet4
}

// The app's stylesheet on the test page and the viewport laid out (the stub
// hides it), invisible, for anything that measures.
async function withCanvas(fn, { w = 1000, h = 700 } = {}) {
  const s = await appSheet()
  const vp = $.canvasViewport(), root = $.canvasRoot()
  const prev = { css: vp.style.cssText, tab: vp.getAttribute('tabindex'), sheets: [...document.adoptedStyleSheets], view: { ...view },
    cls: root.classList.contains('canvas-root'), vcls: vp.classList.contains('canvas-viewport') }
  document.adoptedStyleSheets = [...prev.sheets, s]
  vp.classList.add('canvas-viewport')
  vp.style.cssText = `display:block;position:fixed;left:24px;top:24px;width:${w}px;height:${h}px;overflow:hidden;z-index:2147483646;opacity:0;pointer-events:auto`
  vp.tabIndex = 0
  root.classList.add('canvas-root')
  try { return await fn(vp, root) } finally {
    if (!prev.cls) root.classList.remove('canvas-root')
    if (!prev.vcls) vp.classList.remove('canvas-viewport')
    vp.style.cssText = prev.css
    if (prev.tab == null) vp.removeAttribute('tabindex'); else vp.setAttribute('tabindex', prev.tab)
    document.adoptedStyleSheets = prev.sheets
    Object.assign(view, prev.view)
    applyTransform()
  }
}
const zoomTo4 = z => { view.zoom = z; applyLod({ exact: true }) }
const lineTexts = el => [...el.querySelectorAll('.block-lod-title .block-lod-line')].map(l => l.textContent)

// ── 1. Titles break between words ───────────────────────────
describe('canvas4: a face title breaks between words, with an ellipsis only at its end', () => {
  const mono = s => s.length * 6   // 6px a character

  it('fitTitle never cuts a word: the last line ends on a whole word and an ellipsis', () => {
    // 72px holds "Every End of" (12 characters) but not "Every End of..." (13).
    assert.deepEq(fitTitle('Every End of Sprint', 72, 1, mono), { lines: ['Every End' + ELLIPSIS], cut: true })
    assert.deepEq(fitTitle('Every End of Sprint', 72, 2, mono), { lines: ['Every End of', 'Sprint'], cut: false })
    assert.deepEq(fitTitle('Draft release summary', 80, 2, mono), { lines: ['Draft release', 'summary'], cut: false })
    assert.deepEq(fitTitle('Draft release summary', 60, 2, mono), { lines: ['Draft', 'release' + ELLIPSIS], cut: true })
    assert.deepEq(fitTitle('  spaced   out  ', 200, 2, mono), { lines: ['spaced out'], cut: false })
    assert.deepEq(fitTitle('', 100, 2, mono), { lines: [], cut: false })
  })

  it('a word wider than its whole line keeps its letters for the line\'s own ellipsis; a cut title never shows a bare word', () => {
    assert.deepEq(fitTitle('Internationalization', 60, 2, mono), { lines: ['Internationalization'], cut: false })
    // "Digest" is 36px, "Digest..." 42px: a bare "Digest" read as a whole
    // one-word title, so the word gives a letter to the ellipsis.
    assert.deepEq(fitTitle('Digest read rate', 36, 1, mono), { lines: ['Diges' + ELLIPSIS], cut: true })
    // A first word wider than the line, with more after it: cut to what fits.
    assert.deepEq(fitTitle('Internationalization rollout', 60, 1, mono), { lines: ['Internati' + ELLIPSIS], cut: true })
  })

  it('a closing ellipsis may hang into the padding; a lone word that cannot take one gives way to the line before', () => {
    // 42px holds "Collect" (7 characters) but not "Collect..." (48px): with
    // 6px of hang the whole word takes the ellipsis; without, it gives a letter.
    assert.deepEq(fitTitle('Collect status notes', 42, 1, mono), { lines: ['Collec' + ELLIPSIS], cut: true })
    assert.deepEq(fitTitle('Collect status notes', 42, 1, mono, 6), { lines: ['Collect' + ELLIPSIS], cut: true })
    // Line 2's only word fits bare but not with the ellipsis: line 1 ends
    // the title, rather than a second line that reads as whole.
    assert.deepEq(fitTitle('Two teams publishing conflicts', 60, 2, mono), { lines: ['Two teams' + ELLIPSIS], cut: true })
    // The hang is for the closing ellipsis only: "Draft release" (78px) does not share a 76px line.
    assert.deepEq(fitTitle('Draft release summary', 76, 2, mono, 6), { lines: ['Draft', 'release' + ELLIPSIS], cut: true })
  })

  it('every fitted line is whole words of the title in order, within its width, over many titles and widths', () => {
    const words = ['End', 'of', 'Sprint', 'release', 'summary', 'a', 'Reconciliation', 'quarterly', 'vendor', 'Q3', 'review', 'notes']
    let seed = 7
    const rand = n => { seed = (seed * 16807) % 2147483647; return seed % n }
    for (let t = 0; t < 300; t++) {
      const title = Array.from({ length: 1 + rand(7) }, () => words[rand(words.length)]).join(' ')
      const width = 24 + rand(160), max = 1 + rand(3), hang = rand(2) * 4
      const { lines, cut } = fitTitle(title, width, max, mono, hang)
      assert.ok(lines.length >= 1 && lines.length <= max, `${title} @${width}x${max}`)
      lines.slice(0, -1).forEach(l => assert.ok(!l.includes(ELLIPSIS), 'only the last line ends in an ellipsis'))
      const flat = lines.join(' ').replace(new RegExp(ELLIPSIS + '$'), '').split(' ')
      const want = title.split(' ')
      // Whole words in order; only a last line of one word may be that word
      // cut short, where no line could end on a whole word and an ellipsis.
      const last0 = lines[lines.length - 1]
      const lastLone = cut && last0.endsWith(ELLIPSIS) && !last0.includes(' ')
      const lw = flat[flat.length - 1], tw = want[flat.length - 1]
      assert.deepEq(flat.slice(0, -1), want.slice(0, flat.length - 1), `whole words in order: ${title} -> ${JSON.stringify(lines)}`)
      assert.ok(lw === tw || (lastLone && tw.startsWith(lw) && lw.length >= 1), `the last word whole, or a lone word cut to take the ellipsis: ${title} -> ${JSON.stringify(lines)}`)
      lines.forEach(l => assert.ok(mono(l) <= width + (l.endsWith(ELLIPSIS) ? hang : 0) || !l.replace(ELLIPSIS, '').includes(' '), `"${l}" fits ${width}, or is one word too long for any line`))
      assert.eq(cut, flat.length < want.length || lw !== tw, 'cut says whether the title is shown short')
      // A cut title always ends in an ellipsis: its own, or the CSS one of a word wider than the line.
      const last = lines[lines.length - 1]
      if (cut) assert.ok(last.endsWith(ELLIPSIS) || mono(last) > width, `cut, so "${last}" ends in an ellipsis`)
    }
  })

  it('a title in a script without spaces breaks between its words, or its characters, never as one cut line', () => {
    const wide = s => [...s].length * 12   // 12px a character
    const title = '週次ステータスのダイジェストを自動化する'
    for (const words of [undefined, null]) {   // the browser's segmenter, then none (per character)
      const pieces = titlePieces(title, words)
      assert.ok(pieces.length > 1, `${words === null ? 'characters' : 'words'}: break opportunities`)
      assert.eq(pieces.map((p, i) => (i ? p.sep : '') + p.t).join(''), title, 'joined without spaces')
      // 108px holds nine characters a line: two lines are not enough for twenty.
      const { lines, cut } = fitTitle(title, 108, 2, wide, 0, words)
      assert.eq(lines.length, 2, JSON.stringify(lines))
      lines.forEach(l => assert.ok(wide(l) <= 108, `"${l}" fits its line`))
      assert.ok(cut && lines[1].endsWith(ELLIPSIS))
      assert.ok(!lines.join('').includes(' '), 'no space is added between the words')
      assert.ok(title.startsWith(lines.join('').slice(0, -1)), 'in order')
      // Whole on enough lines.
      assert.deepEq(fitTitle(title, 108, 5, wide, 0, words).cut, false)
    }
    // Punctuation stays with the word before it: no line starts on it.
    const p = titlePieces('週次、ダイジェスト', null)
    assert.ok(p.every(x => !/^[、。]/.test(x.t)), JSON.stringify(p))
    assert.ok(p.some(x => x.t.endsWith('、')))
    // Latin words keep their spaces, a mixed title breaks at both.
    assert.deepEq(titlePieces('Draft the 週次 digest', null).map(x => x.sep), ['', ' ', ' ', '', ' '])
  })

  it('faceLayout: from the card\'s size alone; the pill\'s face where a card holds two 11px lines and not two 12px ones', () => {
    const p = FACE_METRICS.pill, t = FACE_METRICS.title
    // A card with no description, at 44%: 63px inside its border over a face scale of 2.28.
    assert.eq(faceLayout('pill', 96, 63 / 2.2776).lines, 2, 'two lines at 44%')
    assert.eq(faceLayout('pill', 96, 2 * p.lh - 0.5).lines, 1, 'one line when two do not fit')
    assert.eq(faceLayout('pill', 96, 40).width, 96 - 2 * p.padX - p.dot - p.dotGap)
    const tall = faceLayout('title', 150, 80)
    assert.eq(tall.layout, 'col'); assert.ok(tall.lines >= 2)
    assert.eq(faceLayout('title', 150, t.colBelow - 1).layout, 'row', 'under the type row and two lines: a row')
    assert.eq(faceLayout('title', 150, 50).lines, 2)
    assert.eq(faceLayout('title', 150, 80, { typeFits: () => false }).layout, 'row', 'a type name that would be cut is left off')
    // From 45% to 59% a card with no description is 27 to 37 face pixels:
    // one 12px line, so the pill's face and two 11px lines.
    for (const h of [63 / 2.2776, 30, 34, 35.9]) {
      const f = faceLayout('title', 96, h)
      assert.deepEq([f.layout, f.lines, f.width], ['tight', 2, 96 - 2 * p.padX - p.dot - p.dotGap], `${h.toFixed(1)}px tall`)
      assert.eq(faceMetrics('title', f.layout), p)
    }
    assert.deepEq([faceLayout('title', 96, 37.5).layout, faceLayout('title', 96, 37.5).lines], ['row', 2], 'two 12px lines: the title face again')
    assert.eq(faceMetrics('title', 'row'), t)
    // Two cards of one size wear the same face: no input but the size.
    assert.eq(faceLayout.length, 3)
  })

  it('the stylesheet lays faces out with lod.js\'s numbers', async () => {
    // On the document, not in a shadow root: the type scale is :root tokens.
    await withCanvas(async () => {
      const host = document.createElement('div')
      host.className = 'mock-el'
      host.style.cssText = 'position:fixed;left:-3000px;top:0;width:400px;height:300px'
      const face = (band, layout) => `<div class="canvas-root ${band}"><div class="block"><div class="block-lod"><div class="block-lod-face" data-layout="${layout}">` +
        '<div class="block-lod-head"><span class="block-type-dot"></span><span class="block-lod-type">Process</span></div><div class="block-lod-title"><span class="block-lod-line">x</span></div></div></div></div></div>'
      host.innerHTML = face('lod-title', 'col') + face('lod-title', 'row') + face('lod-pill', 'row') + face('lod-title', 'tight')
      document.body.appendChild(host)
      try {
        const [col, row, pill, tight] = host.querySelectorAll('.block-lod-face')
        const t = FACE_METRICS.title, p = FACE_METRICS.pill
        const px = v => parseFloat(v)
        assert.deepEq([px(getComputedStyle(col).paddingTop), px(getComputedStyle(col).paddingLeft)], [t.padY, t.padX])
        assert.eq(getComputedStyle(col).justifyContent, 'center', 'a column sits in the middle of its card')
        assert.eq(px(getComputedStyle(col).rowGap), t.gap)
        assert.deepEq([px(getComputedStyle(row).paddingTop), getComputedStyle(row).flexDirection], [t.rowPadY, 'row'])
        assert.deepEq([px(getComputedStyle(pill).paddingTop), px(getComputedStyle(pill).paddingLeft), px(getComputedStyle(pill).columnGap)], [p.padY, p.padX, p.dotGap])
        const ct = getComputedStyle(col.querySelector('.block-lod-title')), pt = getComputedStyle(pill.querySelector('.block-lod-title'))
        assert.deepEq([px(ct.fontSize), px(ct.lineHeight)], [t.font, t.lh])
        assert.deepEq([px(pt.fontSize), px(pt.lineHeight)], [p.font, p.lh])
        const head = getComputedStyle(col.querySelector('.block-lod-head'))
        assert.deepEq([px(head.lineHeight), px(head.fontSize), px(head.columnGap)], [t.head, t.typeFont, t.dotGap])
        assert.eq(px(getComputedStyle(row).columnGap), t.dotGap)
        // The hang: the title reaches into the padding by it and pads it back.
        const ctitle = getComputedStyle(col.querySelector('.block-lod-title')), ptitle = getComputedStyle(pill.querySelector('.block-lod-title'))
        assert.deepEq([-px(ctitle.marginRight), px(ctitle.paddingRight)], [t.hang, t.hang])
        assert.deepEq([-px(ptitle.marginRight), px(ptitle.paddingRight)], [p.hang, p.hang])
        assert.ok(t.hang <= t.padX && p.hang < p.padX, 'the hang stays inside the face')
        // The title band's tight face is the pill's, number for number.
        const tt = getComputedStyle(tight.querySelector('.block-lod-title'))
        assert.deepEq([px(getComputedStyle(tight).paddingTop), px(getComputedStyle(tight).paddingLeft), px(getComputedStyle(tight).columnGap), getComputedStyle(tight).flexDirection],
          [p.padY, p.padX, p.dotGap, 'row'])
        assert.deepEq([px(tt.fontSize), px(tt.lineHeight), -px(tt.marginRight)], [p.font, p.lh, p.hang])
        assert.eq(getComputedStyle(tight.querySelector('.block-lod-type')).display, 'none')
      } finally { host.remove() }
    })
  })

  it('the user-shaped map from 44% to 60%: two-to-four-word titles read whole, broken between words, never at 11px less', async () => {
    reset4(); setupZoomControls()
    await withCanvas(async () => {
      const titles = ['Every End of Sprint', 'Collect status notes', 'Draft release summary', 'Notes arrive late', 'Weekly status digest',
        'Engineering leads', 'Digest read rate', 'Fewer status meetings', 'Who owns the template?', 'Post in the team channel', 'Automate the note export']
      titles.forEach((title, i) => card('u' + i, { title, x: (i % 4) * 300, y: Math.floor(i / 4) * 240, type: i ? 'process' : 'terminator' }))
      zoomTo4(0.44)
      assert.ok($.canvasRoot().classList.contains('lod-pill'))
      assert.deepEq(lineTexts(document.getElementById('b-u0')), ['Every End of', 'Sprint'])
      // Through the bottom of the title band, where one 12px line cut every
      // title to a word or two ("Collect...", 0 of 11 whole at 50% and 55%).
      for (let z = 0.44; z <= 0.6001; z += 0.01) {
        zoomTo4(+z.toFixed(2)); applyTransform()
        titles.forEach((title, i) => {
          const el = document.getElementById('b-u' + i)
          const lines = lineTexts(el)
          assert.ok(lines.length <= 2, `${title} at ${z.toFixed(2)}: two lines at most`)
          assert.eq(lines.join(' '), title, `${title} reads whole at ${z.toFixed(2)} (${JSON.stringify(lines)})`)
          const line = el.querySelector('.block-lod-line')
          assert.ok(screenPx(line) >= 11 - 0.01, `${title} at ${z.toFixed(2)}: ${screenPx(line).toFixed(2)}px on screen`)
        })
        // No line is wider than its room: the browser never adds an ellipsis of its own.
        $.canvasRoot().querySelectorAll('.block-lod-line').forEach(l => assert.ok(l.scrollWidth <= l.clientWidth + 0.5, `"${l.textContent}" fits its line at ${z.toFixed(2)}`))
      }
    })
  })

  it('every cut title on the canvas ends in an ellipsis, down to the bottom of the pill band', async () => {
    reset4(); setupZoomControls()
    await withCanvas(async () => {
      const titles = ['Every End of Sprint', 'Collect status notes', 'Draft release summary', 'Notes arrive late', 'Weekly status digest',
        'Engineering leads', 'Digest read rate', 'Fewer status meetings', 'Who owns the template?', 'Post in the team channel', 'Automate the note export']
      titles.forEach((title, i) => card('v' + i, { title, x: (i % 4) * 300, y: Math.floor(i / 4) * 240 }))
      for (const z of [0.26, 0.3, 0.35, 0.4, 0.43]) {
        zoomTo4(z)
        titles.forEach((title, i) => {
          const el = document.getElementById('b-v' + i)
          const lines = [...el.querySelectorAll('.block-lod-line')]
          const shown = lines.map(l => l.textContent).join(' ')
          if (shown === title && lines.every(l => l.scrollWidth <= l.clientWidth + 0.5)) return
          const last = lines[lines.length - 1]
          assert.ok(last.textContent.endsWith(ELLIPSIS) || last.scrollWidth > last.clientWidth + 0.5,
            `${title} at ${z}: cut, so it ends in an ellipsis (${JSON.stringify(lines.map(l => l.textContent))})`)
          assert.ok(el.querySelector('.block-lod').dataset.cut === '1', 'and the face says it is cut, for the tip')
        })
      }
    })
  })

  it('a long title ends on a whole word and an ellipsis at every band below full detail; zooming refits it', async () => {
    reset4(); setupZoomControls()
    await withCanvas(async () => {
      const title = 'Two teams publish conflicting numbers in the same week for the review'
      card('long', { title })
      const words = title.split(' ')
      for (const z of [0.8, 0.6, 0.46, 0.4, 0.3]) {
        zoomTo4(z)
        const lines = lineTexts(document.getElementById('b-long'))
        assert.ok(lines.length >= 1, `${z}`)
        const last = lines[lines.length - 1]
        assert.ok(last.endsWith(ELLIPSIS), `${z}: cut with an ellipsis (${JSON.stringify(lines)})`)
        const flat = lines.join(' ').slice(0, -1).split(' ')
        assert.deepEq(flat, words.slice(0, flat.length), `${z}: whole words`)
      }
    })
  })
})

describe('canvas4: a large map refits the faces in view first and the rest in idle time', () => {
  it('nearView sorts cards by the camera and their kept sizes', () => {
    const els = ['n', 'f'].map(id => ({ dataset: { id } }))
    state.blocks = { n: { id: 'n', x: 100, y: 100 }, f: { id: 'f', x: 50000, y: 0 } }
    try {
      // No kept sizes: every card counts as near (fitted at once), as before.
      assert.deepEq(nearView(els, { zoom: 1, panX: 0, panY: 0 }, { w: 1000, h: 700 }).far, [])
      assert.deepEq(nearView(els, { zoom: 1, panX: 0, panY: 0 }, null).near.length, 2, 'no viewport size: all near')
    } finally { state.blocks = {} }
  })

  it(`over ${FIT_NOW_MAX} cards: the ones in view are fitted in the frame, the others before long`, async () => {
    reset4(); setupZoomControls()
    await withCanvas(async () => {
      const n = FIT_NOW_MAX + 20
      for (let i = 0; i < n; i++) card('r' + i, { title: 'Collect status notes for the review', x: i < 4 ? i * 300 : 40000 + (i % 10) * 300, y: i < 4 ? 0 : Math.floor(i / 10) * 200 })
      Object.assign(view, { zoom: 1, panX: 0, panY: 0 }); applyTransform()
      await new Promise(r => setTimeout(r, 50))   // the idle read of the sizes at full detail
      zoomTo4(0.5)
      const fitted = id => !!document.querySelector(`#b-${id} .block-lod-line`)
      for (let i = 0; i < 4; i++) assert.ok(fitted('r' + i), `r${i}, in view, is fitted at once`)
      const later = Array.from({ length: n - 4 }, (_, i) => 'r' + (i + 4))
      assert.ok(later.some(id => !fitted(id)), 'the far cards wait')
      for (let t = 0; t < 40 && !later.every(fitted); t++) await new Promise(r => setTimeout(r, 25))
      assert.ok(later.every(fitted), 'and are fitted soon after')
      // Going back to full detail before they run leaves nothing half done.
      zoomTo4(1); zoomTo4(0.3); zoomTo4(1)
      await new Promise(r => setTimeout(r, 300))
      assert.ok($.canvasRoot().classList.contains('lod-full'))
    })
    reset4()
  })
})

// ── 2. No hollow boxes ──────────────────────────────────────
describe('canvas4: a card whose description steps back is not an empty box', () => {
  it('in the title band the type and title sit in the middle of a tall card', async () => {
    reset4(); setupZoomControls()
    await withCanvas(async () => {
      card('tall', { title: 'Collect status notes', description: 'Collect every team note before Friday noon, tag each with its epic, and flag anything that slipped or changed scope since the last review.' })
      card('short', { title: 'Draft release summary', x: 400 })
      for (const z of [0.85, 0.7, 0.6]) {
        zoomTo4(z)
        for (const id of ['tall', 'short']) {
          const el = document.getElementById('b-' + id), face = el.querySelector('.block-lod-face')
          const kids = [...face.children].filter(k => getComputedStyle(k).display !== 'none')
          const top = Math.min(...kids.map(k => k.getBoundingClientRect().top)), bottom = Math.max(...kids.map(k => k.getBoundingClientRect().bottom))
          const r = el.getBoundingClientRect()
          assert.ok(Math.abs((top - r.top) - (r.bottom - bottom)) <= 3, `${id} at ${z}: centred (${(top - r.top).toFixed(1)} above, ${(r.bottom - bottom).toFixed(1)} below)`)
        }
      }
      // The card itself keeps its size: no line moves.
      const h = document.getElementById('b-tall').offsetHeight
      zoomTo4(1); assert.eq(document.getElementById('b-tall').offsetHeight, h)
    })
  })

  it('two cards of one size wear the same face whatever their titles; a taller card shows its type over the title', async () => {
    reset4(); setupZoomControls()
    await withCanvas(async () => {
      card('fits', { title: 'Ship', type: 'goal' })
      card('needs', { title: 'Who owns the template?', type: 'question', x: 400 })
      card('tall', { title: 'Collect status notes', x: 800, description: 'Collect every team note before Friday noon, tag each with its epic, and flag anything that slipped.' })
      const layout = id => document.querySelector(`#b-${id} .block-lod-face`).dataset.layout
      for (const z of [0.85, 0.8, 0.7, 0.6, 0.5, 0.46]) {
        zoomTo4(z)
        assert.eq(layout('fits'), layout('needs'), `at ${z}: one size, one face`)
        assert.eq(lineTexts(document.getElementById('b-needs')).join(' '), 'Who owns the template?', `at ${z}: the long title still reads whole`)
      }
      zoomTo4(0.8)
      assert.eq(layout('tall'), 'col')
      assert.neq(getComputedStyle(document.querySelector('#b-tall .block-lod-type')).display, 'none', 'the type reads on a card with the room')
      zoomTo4(0.5)
      assert.eq(layout('fits'), 'tight', 'the pill face at 50%')
    })
  })
})

// ── 5. Escape after a pointer selection lets go of the canvas ─
describe('canvas4: Escape after a pointer selection, then Tab, leaves the canvas', () => {
  it('the card the pointer selected lets go of focus, and the next Tab goes past the canvas', async () => {
    reset4()
    setupKeyboardShortcuts(); setupTabNavigation()
    const after = document.createElement('button')
    after.className = 'mock-el'; after.textContent = 'after the canvas'
    document.body.appendChild(after)
    try {
      await withCanvas(async () => {
        card('a'); card('b', { x: 400 }); card('c', { x: 800 })
        const el = document.getElementById('b-b')
        // A press, then focus inside its grace period: focus from the pointer.
        $.canvasRoot().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        el.focus({ preventScroll: true })
        if (document.activeElement === el && !document.hasFocus()) el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
        selectBlock('b')
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        assert.eq(selection.ids.size, 0, 'the selection is cleared')
        assert.ok(!$.canvasViewport().contains(document.activeElement), 'and the card lets go')
        const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
        document.body.dispatchEvent(tab)
        assert.ok(tab.defaultPrevented, 'the app moved focus itself')
        assert.ok(!$.canvasRoot().contains(document.activeElement), 'not back into a card')
        assert.eq(selection.ids.size, 0, 'and nothing was selected on the way')
      })
    } finally { after.remove(); reset4() }
  })

  // A box drawn with Shift, or a clicked connection, leaves the canvas
  // itself focused from the press: Escape let go of the selection and kept
  // the canvas, and the next Tab went to Find blocks and back into the map.
  for (const [what, select] of [
    ['a box selection', () => setSelection(['a', 'b'])],
    ['a connection', () => { state.arrows = [{ id: 'x1', from: 'a', to: 'b' }]; selection.arrowId = 'x1' }],
  ]) {
    it(`after ${what} made with the pointer, Escape lets go of the canvas and the next Tab goes past it`, async () => {
      reset4(); setupZoomControls()
      setupKeyboardShortcuts(); setupTabNavigation()
      const after = document.createElement('button')
      after.className = 'mock-el'; after.textContent = 'after the canvas'
      document.body.appendChild(after)
      try {
        await withCanvas(async vp => {
          card('a'); card('b', { x: 400 })
          // The press that drew the box, or clicked the line, on the canvas.
          vp.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
          vp.focus({ preventScroll: true })
          document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
          select()
          assert.eq(vp.dataset.input, 'pointer', 'the canvas holds focus from a press')
          vp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
          assert.ok(!selection.ids.size && !selection.arrowId, 'the selection is cleared')
          assert.ok(!vp.contains(document.activeElement) && document.activeElement !== vp, 'and the canvas lets go')
          const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
          document.body.dispatchEvent(tab)
          assert.ok(tab.defaultPrevented, 'the app moved focus itself')
          assert.ok(!vp.contains(document.activeElement), 'past the canvas, not back into it')
        })
      } finally { after.remove(); state.arrows = []; reset4() }
    })
  }

  it('a selection made on a canvas the keyboard reached keeps the canvas on the first Escape', async () => {
    reset4(); setupZoomControls()
    setupKeyboardShortcuts(); setupTabNavigation()
    try {
      await withCanvas(async vp => {
        card('a'); card('b', { x: 400 })
        vp.blur()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        vp.focus({ preventScroll: true })
        assert.eq(vp.dataset.input, 'key')
        setSelection(['a', 'b'])   // Cmd+A
        vp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        assert.eq(selection.ids.size, 0)
        assert.eq(document.activeElement, vp, 'the keyboard keeps its place; a second Escape lets go')
        vp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        assert.neq(document.activeElement, vp)
      })
    } finally { reset4() }
  })

  it('a card the keyboard reached keeps its focus on the first Escape, as before', async () => {
    reset4()
    setupKeyboardShortcuts(); setupTabNavigation()
    try {
      await withCanvas(async () => {
        card('k')
        const el = document.getElementById('b-k')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))   // ends any press grace
        el.focus({ preventScroll: true })
        selectBlock('k')
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        assert.eq(document.activeElement, el)
      })
    } finally { reset4() }
  })
})

// ── 3. The 11px floor from 92% up ───────────────────────────
// Size on screen: the font size times every transform's scale up to the page.
function screenPx(el) {
  let scale = 1
  for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
    const t = getComputedStyle(a).transform
    if (t && t !== 'none') { const m = new DOMMatrixReadOnly(t); scale *= Math.hypot(m.a, m.b) }
  }
  return parseFloat(getComputedStyle(el).fontSize) * scale
}

describe('canvas4: highlight words, frame names and gap names hold 11px from 92% up', () => {
  it('measured on screen at 92%, 96%, 100% and 125%, and in the title band', async () => {
    reset4(); setupZoomControls()
    await withCanvas(async (vp, root) => {
      const layer = $.framesLayer()
      const home = { parent: layer.parentNode, next: layer.nextSibling, css: layer.style.cssText, cls: layer.className }
      root.appendChild(layer); layer.style.cssText = ''; layer.classList.add('frames-layer')
      try {
        card('h', { title: 'Collect status notes', highlight: 'alert', groupId: 'g1' })
        card('f', { title: 'Notes arrive late', highlight: 'focus', y: 240, groupId: 'g1' })
        card('lone', { title: 'Lonely goal', type: 'goal', x: 600 })
        state.groups = { g1: { id: 'g1', label: 'Collect and draft' } }
        renderFrames(); runGapDetection()
        const name = document.querySelector('#b-lone .gap-name')
        assert.ok(name, 'the lone card wears a gap badge with its name')
        name.style.display = 'block'   // as on hover
        const strings = () => [
          ['highlight word', document.querySelector('#b-h .block-hl-tab')],
          ['highlight word', document.querySelector('#b-f .block-hl-tab')],
          ['frame name', layer.querySelector('.frame-label')],
          ['gap name', name],
        ]
        for (const z of [0.92, 0.96, 1, 1.25, 0.8, 0.6, 0.46]) {
          zoomTo4(z); applyTransform()
          for (const [what, el] of strings()) {
            assert.ok(el, what)
            const px = screenPx(el)
            assert.ok(px >= 11 - 0.01, `${what} is ${px.toFixed(2)}px on screen at ${z}`)
          }
        }
        zoomTo4(1); applyTransform()
        for (const [what, el] of strings()) assert.ok(Math.abs(screenPx(el) - 11) < 0.01, `${what} is exactly 11px at 100%`)
        // The frame's name never runs into a highlight's word: below full
        // detail it sits above the frame, and the band inside is the words'.
        // At 50% the 11px ALERT ran into "Collect and draft".
        const label = layer.querySelector('.frame-label')
        for (const z of [1, 0.92, 0.8, 0.6, 0.55, 0.5, 0.46, 0.44, 0.35, 0.3, 0.26]) {
          zoomTo4(z); applyTransform()
          const r = document.createRange(); r.selectNodeContents(label)
          const text = r.getBoundingClientRect()
          for (const id of ['h', 'f']) {
            const tab = document.querySelector(`#b-${id} .block-hl-tab`).getBoundingClientRect()
            assert.ok(overlap4(text, tab) <= 0.5, `the frame's name and ${id}'s word overlap by ${overlap4(text, tab).toFixed(1)}px² at ${z}`)
          }
          assert.ok(screenPx(label) >= 11 - 0.01, `the frame's name holds 11px at ${z}`)
        }
      } finally {
        state.groups = {}
        layer.replaceChildren()
        layer.style.cssText = home.css; layer.className = home.cls
        home.parent.insertBefore(layer, home.next)
        reset4()
      }
    })
  })
})

const overlap4 = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

describe('canvas4: a gap badge never sits on the face\'s title', () => {
  it('below full detail the badge sits on the ring, clear of the first line, in both bands', async () => {
    reset4(); setupZoomControls()
    await withCanvas(async () => {
      card('g', { type: 'goal', title: 'Automate the note export' })
      card('m', { type: 'metric', title: 'Digest read rate', x: 400 })
      card('p', { title: 'Collect status notes', x: 0, y: 240 })
      state.arrows = [{ id: 'a1', from: 'g', to: 'p' }, { id: 'a2', from: 'm', to: 'p' }]
      runGapDetection()
      for (const id of ['g', 'm']) assert.ok(document.querySelector(`#b-${id} .block-gap-icons .gap-icon`), `${id} wears a badge`)
      for (const z of [0.9, 0.8, 0.7, 0.6, 0.5, 0.46, 0.44, 0.4, 0.35, 0.3, 0.26]) {
        zoomTo4(z); applyTransform()
        for (const id of ['g', 'm']) {
          const icon = document.querySelector(`#b-${id} .block-gap-icons .gap-icon`).getBoundingClientRect()
          const card = document.getElementById('b-' + id).getBoundingClientRect()
          assert.ok(icon.bottom <= card.top + 0.5, `${id}'s badge is above the card at ${z} (${(icon.bottom - card.top).toFixed(1)}px into it)`)
          document.querySelectorAll(`#b-${id} .block-lod-line`).forEach(l => {
            const r = document.createRange(); r.selectNodeContents(l)
            assert.eq(overlap4(icon, r.getBoundingClientRect()), 0, `"${l.textContent}" is clear of the badge at ${z}`)
          })
        }
      }
    })
    state.arrows = []
    reset4()
  })
})

// ── 4. The canvas's keyboard focus is a chip, not a frame ────
describe('canvas4: the canvas focus indicator is a compact chip, keyboard only', () => {
  it('no frame round the map: a chip ringed with the one focus outline, and none after a press', async () => {
    reset4(); setupZoomControls()
    await withCanvas(async vp => {
      card('a')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      vp.blur()
      vp.focus({ preventScroll: true })
      assert.eq(vp.dataset.input, 'key', 'focus that follows a key is keyboard focus')
      assert.eq(getComputedStyle(vp).outlineStyle, 'none', 'no frame round the whole canvas')
      if (vp.matches(':focus-visible')) {
        const chip = getComputedStyle(vp, '::after')
        // Only what stays true: Tab goes to Find blocks first, and on a
        // view-only link to the review field, never straight to the blocks.
        assert.eq(chip.content, '"Canvas: arrows pan, ? lists the keys"')
        assert.ok(!chip.content.includes('Tab'))
        assert.eq(chip.outlineStyle, 'solid')
        assert.ok(parseFloat(chip.outlineWidth) >= 2, 'at least 2px, as the spec asks (WCAG 2.4.7; 2.4.13 is not claimed)')
        // With blocks selected the arrows move them, so the chip says so;
        // a view-only link pans either way.
        selectBlock('a')
        assert.eq(getComputedStyle(vp, '::after').content, '"Canvas: arrows move the selection, ? lists the keys"')
        document.body.classList.add('readonly-mode')
        try { assert.eq(getComputedStyle(vp, '::after').content, '"Canvas: arrows pan, ? lists the keys"') } finally { document.body.classList.remove('readonly-mode') }
        deselectAll()
        const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim()
        const probe = document.createElement('span'); probe.style.color = accent; document.body.appendChild(probe)
        assert.eq(chip.outlineColor, getComputedStyle(probe).color, 'in the accent (6.4:1 dark, 5.2:1 light on the canvas)')
        probe.remove()
        const r = vp.getBoundingClientRect()
        assert.ok(parseFloat(chip.height) <= 32 && parseFloat(chip.top) <= 16, 'compact, at the top left')
        assert.ok(r.width > 400, 'on a canvas far larger than the chip')
        // A press anywhere hides it, even with focus left where it was.
        document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        assert.eq(vp.dataset.input, 'pointer')
        assert.eq(getComputedStyle(vp, '::after').content, 'none', 'pointer focus never shows it')
        // A key after the press is not focus arriving: the chip stays away
        // (Chrome turns :focus-visible on for a clicked canvas at any key).
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
        assert.eq(getComputedStyle(vp, '::after').content, 'none', 'a key after a press does not bring it back')
        // Focus arriving by keyboard again does.
        vp.blur()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
        vp.focus({ preventScroll: true })
        assert.eq(vp.dataset.input, 'key')
        if (vp.matches(':focus-visible')) assert.neq(getComputedStyle(vp, '::after').content, 'none', 'focus from the keyboard brings it back')
        // A card holding focus has its own ring; the canvas chip is not drawn.
        document.getElementById('b-a').focus({ preventScroll: true })
        assert.eq(getComputedStyle(vp, '::after').content, 'none')
      }
      vp.blur()
    })
    reset4()
  })

  it('an empty map says how to add a block; a view-only empty map says only where focus is', async () => {
    reset4(); setupZoomControls()
    await withCanvas(async vp => {
      vp.blur()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      vp.focus({ preventScroll: true })
      if (vp.matches(':focus-visible')) {
        assert.includes(getComputedStyle(vp, '::after').content, 'press N to add a block')
        document.body.classList.add('readonly-mode')
        try { assert.eq(getComputedStyle(vp, '::after').content, '"Canvas"') } finally { document.body.classList.remove('readonly-mode') }
      }
      vp.blur()
    })
  })

  it('forced colours ring the chip in Highlight', async () => {
    const css = (await (await fetch('../css/style.css')).text()).replace(/\/\*[\s\S]*?\*\//g, '')
    assert.match(css, /@media \(forced-colors: active\)\s*\{\s*\.canvas-viewport:focus-visible:not\(\[data-input="pointer"\]\)::after\s*\{[^}]*outline:\s*2px solid Highlight/)
    assert.ok(!/\.canvas-viewport:focus-visible\s*\{[^}]*outline:\s*var\(--focus-outline\)/.test(css), 'the full-canvas frame is gone')
  })
})

// ── 6. A mostly unconnected map says so once ─────────────────
describe('canvas4: isolation on a mostly unconnected map is one finding and a quiet marker', () => {
  const blocksOf = (n, extra = {}) => Object.fromEntries(Array.from({ length: n }, (_, i) =>
    ['n' + i, { id: 'n' + i, type: ['goal', 'risk', 'process', 'metric'][i % 4], title: 'Note ' + i, x: i * 300, y: 0, ...extra }]))

  it('isolationSummary: more than a third of the blocks, a first block included', () => {
    const d = ids => ids.map(id => ({ id, gaps: ['gap-isolated'] }))
    assert.deepEq(isolationSummary(d(['a', 'b', 'c']), 3), { ids: ['a', 'b', 'c'], quiet: true })
    assert.eq(isolationSummary(d(['a']), 1).quiet, true, 'a first block is a map in progress, not a gap to fix')
    assert.eq(isolationSummary(d(['a', 'b']), 2).quiet, true)
    assert.eq(isolationSummary(d(['a', 'b', 'c']), 6).quiet, true, 'half is still a map in progress')
    assert.eq(isolationSummary(d(['a', 'b']), 6).quiet, false, 'a third is not')
    assert.eq(isolationSummary(d(['a']), 3).quiet, false, 'a lone card on a connected map keeps its ring')
    assert.eq(isolationSummary(d(['a', 'b', 'c', 'd']), 7).quiet, true)
    assert.eq(isolationSummary([{ id: 'x', gaps: ['gap-no-req'] }, ...d(['a'])], 3).quiet, false, 'only isolation counts')
    assert.deepEq(isolationSummary([], 0), { ids: [], quiet: false }, 'an empty map has nothing to say')
  })

  it('connecting one more block never brings back half the map\'s rings at once', () => {
    // Twelve notes, linked one by one in a chain: the rings (and the rows
    // in Attention) come back only once two thirds of the map is linked,
    // for the four cards still alone. At half, the sixth link brought six
    // rings and six rows back at once.
    const blocks = blocksOf(12)
    const chain = n => Array.from({ length: n - 1 }, (_, i) => ({ id: 'c' + i, from: 'n' + i, to: 'n' + (i + 1) }))
    const rows = arrows => attentionModel(blocks, arrows).items.filter(i => i.gap === 'gap-isolated').length
    const quiet = arrows => attentionModel(blocks, arrows).items.some(i => i.finding === 'isolated')
    assert.ok(quiet(chain(5)), '7 of 12 alone: quiet')
    assert.ok(quiet(chain(6)) && rows(chain(6)) === 0, '6 of 12 alone: still quiet, no rows')
    assert.ok(quiet(chain(7)), '5 of 12 alone: quiet')
    assert.ok(!quiet(chain(8)) && rows(chain(8)) === 4, '4 of 12 alone, two thirds linked: their rings and rows are back')
    // The count never jumps by more than the cards still alone.
    let prev = null
    for (let n = 2; n <= 12; n++) {
      const count = attentionModel(blocks, chain(n)).items.filter(i => i.gap === 'gap-isolated' || i.finding === 'isolated').length
      if (prev !== null) assert.ok(count - prev <= 4, `linking block ${n} adds ${count - prev}`)
      prev = count
    }
  })

  it('twelve pasted notes: one Attention item for the twelve, none per card, and the words match the map', () => {
    const blocks = blocksOf(12)
    const { items } = attentionModel(blocks, [])
    const iso = items.filter(i => i.finding === 'isolated')
    assert.eq(iso.length, 1, 'one canvas finding')
    assert.eq(iso[0].kind, 'canvas')
    assert.eq(iso[0].ids.length, 12)
    assert.includes(iso[0].detail, '12 blocks are not connected yet')
    assert.eq(items.filter(i => i.gap === 'gap-isolated').length, 0, 'no row per card')
    const words = attentionBreakdown(items)
    assert.includes(words, '1 item for the 12 blocks not connected yet')
    // The phrase any count of open items can use (the Brief's readiness line).
    assert.eq(isolationWords(items), '12 blocks not connected yet')
    assert.eq(isolationWords([]), '')
    assert.ok(!/gaps? marked on the map/.test(words), 'no card wears the amber ring, so none is counted as one')
    // The row opens the first of them and offers nothing to accept.
    const ul = document.createElement('ul'); ul.innerHTML = attentionRowsHtml(iso)
    assert.eq(ul.querySelectorAll('[data-attention-act]').length, 0)
    assert.includes(ul.textContent, 'Not connected yet')
  })

  it('the per-card ring and row come back once the map has its connections', () => {
    const blocks = blocksOf(5)
    const arrows = [{ id: 'a1', from: 'n0', to: 'n1' }, { id: 'a2', from: 'n1', to: 'n2' }, { id: 'a3', from: 'n2', to: 'n3' }]
    const { items } = attentionModel(blocks, arrows)
    assert.eq(items.filter(i => i.finding === 'isolated').length, 0)
    assert.deepEq(items.filter(i => i.gap === 'gap-isolated').map(i => i.id), ['n4'], 'the one lone card has its own row')
    // A lone card on a map that is otherwise connected keeps its row.
    assert.eq(attentionModel(blocksOf(3), [{ id: 'a1', from: 'n0', to: 'n1' }]).items.filter(i => i.gap === 'gap-isolated').length, 1)
  })

  it('a first block says so in the singular, and counts as one item', () => {
    const { items } = attentionModel(blocksOf(1), [])
    const iso = items.filter(i => i.finding === 'isolated')
    assert.eq(iso.length, 1)
    assert.includes(iso[0].detail, '1 block is not connected yet.')
    assert.includes(attentionBreakdown(items), '1 item for the block not connected yet')
    assert.eq(items.filter(i => i.gap === 'gap-isolated').length, 0)
  })

  it('on the canvas: no ring, a neutral badge named "Not connected yet", and the counts agree with Attention', async () => {
    reset4(); setupZoomControls()
    await withCanvas(async () => {
      for (let i = 0; i < 6; i++) card('q' + i, { type: ['goal', 'risk', 'process'][i % 3], title: 'Note ' + i, x: (i % 3) * 300, y: Math.floor(i / 3) * 200 })
      runGapDetection()
      const cards = [...$.canvasRoot().querySelectorAll(':scope > .block')]
      const quiet = cards.filter(el => el.classList.contains('iso-quiet'))
      assert.eq(quiet.length, 6, 'every lone card is quiet')
      quiet.forEach(el => {
        assert.eq(getComputedStyle(el, '::after').content, 'none', 'no amber ring')
        const icon = el.querySelector('.gap-icon')
        assert.ok(icon.classList.contains('is-quiet'))
        assert.eq(icon.getAttribute('aria-label'), 'Not connected yet')
        assert.eq(icon.querySelector('.gap-name').textContent, 'Not connected yet')
        const cs = getComputedStyle(icon)
        assert.eq(cs.borderTopWidth, '1px')
        const probe = document.createElement('span'); probe.style.color = 'var(--text-3)'; el.appendChild(probe)
        assert.eq(cs.color, getComputedStyle(probe).color, 'neutral ink (--text-3), never the attention amber')
        probe.remove()
      })
      const att = attentionModel(state.blocks, state.arrows).items
      assert.eq(att.find(i => i.finding === 'isolated').ids.length, quiet.length, 'Attention counts the cards that wear the marker')
      // Connect four of them: the two left alone wear the ring again.
      state.arrows = [{ id: 'a1', from: 'q0', to: 'q1' }, { id: 'a2', from: 'q1', to: 'q2' }, { id: 'a3', from: 'q2', to: 'q3' }]
      runGapDetection()
      const lone = ['q4', 'q5'].map(id => document.getElementById('b-' + id))
      lone.forEach(el => {
        assert.ok(el.classList.contains('gap-isolated') && !el.classList.contains('iso-quiet'))
        assert.neq(getComputedStyle(el, '::after').content, 'none', 'the ring is back')
        assert.ok(!el.querySelector('.gap-icon').classList.contains('is-quiet'))
      })
      // Every card with the amber ring is a gap row in Attention, and back.
      const ringed = [...$.canvasRoot().querySelectorAll(':scope > .block')].filter(el => getComputedStyle(el, '::after').content !== 'none' && [...el.classList].some(c => c.startsWith('gap-')))
      const rows = attentionModel(state.blocks, state.arrows).items.filter(i => i.kind === 'gap' || i.kind === 'criteria')
      assert.deepEq(ringed.map(el => el.dataset.id).sort(), [...new Set(rows.map(r => r.id))].sort())
    })
    reset4()
  })
})

// ── 7. The minimap marks the selection, follows a drag, keeps out of the way ─
const frame4 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))

describe('canvas4: the minimap marks the selection, follows a drag and never sits over the work', () => {
  it('minimapSpot: home unless the work is under it, then the other corner, then out of sight', () => {
    const c = (left, top) => ({ left, top, right: left + 160, bottom: top + 100 })
    const corners = { right: c(800, 500), left: c(12, 500) }
    const at = (x, y) => ({ left: x, top: y, right: x + 10, bottom: y + 10 })
    assert.eq(minimapSpot(corners, []), 'right')
    assert.eq(minimapSpot(corners, [at(300, 100)]), 'right', 'work elsewhere')
    assert.eq(minimapSpot(corners, [at(850, 550)]), 'left', 'work under the home corner')
    assert.eq(minimapSpot(corners, [at(850, 550), at(50, 550)]), 'faded', 'both corners taken')
    assert.eq(minimapSpot({ right: corners.right, left: null }, [at(850, 550)]), 'faded', 'no room for a second corner')
    // The other corner has to be clear of every card, not only of the work.
    assert.eq(minimapSpot(corners, [at(850, 550)], [at(40, 560)]), 'faded', 'a card under the other corner: out of sight, not over it')
    assert.eq(minimapSpot(corners, [at(850, 550)], [at(300, 100)]), 'left', 'cards elsewhere do not matter')
    assert.eq(minimapSpot(corners, [], [at(820, 520)]), 'right', 'a card under the home corner that nobody is working on: home')
  })

  it('a card selected under the home corner sends the minimap to the other corner; it comes back when the work moves on', async () => {
    reset4(); setupZoomControls(); setupMinimap()
    await withCanvas(async (vp) => {
      view.zoom = 1; view.panX = 0; view.panY = 0; applyTransform()
      card('far', { x: 40, y: 40 })
      card('corner', { x: 800, y: 560, type: 'decision', title: 'Post in the team channel' })
      setMinimap(true)
      const mm = document.getElementById('minimap')
      const overlaps = id => {
        const a = mm.getBoundingClientRect(), b = document.getElementById('b-' + id).getBoundingClientRect()
        return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      }
      assert.ok(overlaps('corner'), 'the fixture puts the card under the minimap')
      selectBlock('corner'); await frame4()
      assert.ok(mm.classList.contains('is-aside'), 'stepped aside')
      assert.ok(!overlaps('corner'), 'and no longer over the card')
      assert.ok(!mm.classList.contains('is-faded'))
      selectBlock('far'); await frame4()
      assert.ok(!mm.classList.contains('is-aside'), 'home again once the work is elsewhere')
      // A card under the other corner, even one nobody is working on: it
      // fades out rather than cover it, and takes no clicks while it is out.
      card('left', { x: 30, y: 560 })
      selectBlock('corner'); placeMinimap()
      assert.ok(mm.classList.contains('is-faded'), 'not aside onto the card in the other corner')
      assert.ok(!mm.classList.contains('is-aside'))
      assert.eq(getComputedStyle(mm).pointerEvents, 'none')
      const hit = document.elementFromPoint(...(r => [r.left + r.width / 2, r.top + r.height / 2])(document.getElementById('b-left').getBoundingClientRect()))
      assert.ok(!mm.contains(hit), 'a click aimed at that card is not taken by the minimap')
      // Both corners taken by the work: out of sight too.
      selection.ids.add('left'); placeMinimap()
      assert.ok(mm.classList.contains('is-faded'))
      deselectAll(); placeMinimap()
      assert.ok(!mm.classList.contains('is-faded') && !mm.classList.contains('is-aside'))
      setMinimap(false)
    })
    reset4()
  })

  it('the pointer held under its corner during a press on the canvas moves it aside; a press on the minimap itself never does', async () => {
    reset4(); setupZoomControls(); setupMinimap()
    await withCanvas(async () => {
      view.zoom = 1; view.panX = 0; view.panY = 0; applyTransform()
      card('a', { x: 40, y: 40 })
      setMinimap(true)
      const mm = document.getElementById('minimap'), home = mm.getBoundingClientRect()
      const root = $.canvasRoot()
      const ev = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 31, button: 0,
        buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, isPrimary: true, pointerType: 'mouse' }))
      ev(root, 'pointerdown', 300, 200)
      ev(root, 'pointermove', home.left + 40, home.top + 40)
      await frame4()
      assert.ok(mm.classList.contains('is-aside'), 'out of the way of a drop')
      ev(root, 'pointerup', home.left + 40, home.top + 40)
      await frame4()
      assert.ok(!mm.classList.contains('is-aside'), 'back once the press ends')
      ev(mm.querySelector('svg'), 'pointerdown', home.left + 80, home.top + 50)
      ev(mm.querySelector('svg'), 'pointerup', home.left + 80, home.top + 50)
      await frame4()
      assert.ok(!mm.classList.contains('is-aside'), 'its own frame drag keeps it where it is')
      setMinimap(false)
    })
    reset4()
  })

  it('the selection is marked in the accent, and a dragged card moves its rectangle before the drag is saved', async () => {
    reset4(); setupZoomControls(); setupMinimap()
    await withCanvas(async () => {
      view.zoom = 1; view.panX = 0; view.panY = 0; applyTransform()
      card('a', { x: 40, y: 40 }); card('b', { x: 500, y: 300 })
      setMinimap(true)
      const rect = id => [...document.querySelectorAll('#minimap .minimap-b')][Object.keys(state.blocks).indexOf(id)]
      selectBlock('a'); await frame4()
      assert.ok(rect('a').classList.contains('is-sel'), 'the selected block is marked')
      assert.ok(!rect('b').classList.contains('is-sel'))
      const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; document.body.appendChild(probe)
      assert.eq(getComputedStyle(rect('a')).stroke, getComputedStyle(probe).color, 'in the accent')
      probe.remove()
      // What the drag handler does on each move: the state and the card's left and top.
      const el = document.getElementById('b-a')
      state.blocks.a.x = 260; state.blocks.a.y = 180
      el.style.left = '260px'; el.style.top = '180px'
      await frame4()
      assert.deepEq([rect('a').getAttribute('x'), rect('a').getAttribute('y')], ['260', '180'], 'the rectangle followed, with no save')
      deselectAll(); await frame4()
      assert.ok(!rect('a').classList.contains('is-sel'))
      setMinimap(false)
    })
    reset4()
  })
})

// ── 8. A restored camera that shows nothing arrives on the map ─
describe('canvas4: on load, a restored camera that shows no block arrives on content', () => {
  it('a camera pointing at empty canvas arrives on the entry layer; one that shows a block stays put', async () => {
    reset4(); setupZoomControls()
    await withCanvas(async () => {
      card('t', { type: 'terminator', title: 'Every End of Sprint', x: 0, y: 100 })
      card('p', { title: 'Collect status notes', x: 300, y: 100 })
      state.arrows = [{ id: 'a1', from: 't', to: 'p' }]
      // A desktop camera reopened in a window that is narrower: the map is off to the right.
      Object.assign(view, { panX: 1400, panY: 0, zoom: 1 }); applyTransform()
      assert.ok(!contentInView(), 'the fixture shows nothing')
      const r = arriveIfLost()
      assert.ok(r && r.moved, 'it arrived')
      assert.ok(contentInView(), 'and the map is on screen')
      assert.eq(view.zoom, 1, 'at a readable zoom')
      // A camera that shows any block is the person's own view: left alone.
      Object.assign(view, { panX: 700, panY: 20, zoom: 0.8 }); applyTransform()
      assert.ok(contentInView())
      assert.eq(arriveIfLost(), null)
      assert.deepEq([view.panX, view.panY, view.zoom], [700, 20, 0.8])
      // An empty map has nothing to arrive on.
      reset4()
      Object.assign(view, { panX: 5000, panY: 0, zoom: 1 })
      assert.eq(arriveIfLost(), null)
    })
    reset4()
  })

  it('setupZoomControls checks the restored camera once, after the camera modules are ready', async () => {
    const src = await (await fetch('../js/zoom-controls.js')).text()
    const setup = src.slice(src.indexOf('export function setupZoomControls'), src.indexOf('// ── A restored camera'))
    assert.ok(setup.indexOf('arriveIfLost()') > setup.indexOf('setupMinimap()'), 'after lod and the minimap are set up')
    const app = await (await fetch('../js/app.js')).text()
    assert.ok(app.indexOf('loadView()') < app.indexOf('setupZoomControls()'), 'the camera is restored before the check runs')
  })
})
