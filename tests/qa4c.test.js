// ============================================================
//  qa4c.test.js: regression tests for the third pass over wave
//  4's QA (two verifiers' findings after fix(qa4b), 2026-10-16).
//  The items that extend a qa4b check live in qa4b.test.js beside
//  it (small templates whole at 1280 by 800, toast full stops, the
//  cycle finding's verb, doc comments, Connect to's key cap); these
//  are the pill band's titles and the phone's focus chip.
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, view, getUndoHistory, getRedoFuture, resetSnapshotToken } from '../js/state.js'
import { $ } from '../js/utils.js'
import { renderBlock, deselectAll } from '../js/render.js'
import { applyTransform } from '../js/canvas.js'
import { setupZoomControls } from '../js/zoom-controls.js'
import { applyLod, fitTitle, fitFaceTitle, faceLayout, FACE_METRICS, ELLIPSIS } from '../js/lod.js'
import { closeMenus } from '../js/menu.js'

function reset() {
  closeMenus()
  cleanupMockEls()
  state.blocks = {}; state.arrows = []; state.groups = {}
  ui.readOnly = false; ui.embed = false
  getUndoHistory().length = 0; getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
  $.canvasRoot().querySelectorAll('.block').forEach(el => el.remove())
}

// A card shaped like the sample map's: a title and a two-line description,
// so it holds two pill lines at 33%.
function card(id, title, extra = {}) {
  state.blocks[id] = { id, type: 'assumption', title, description: 'Says what the evidence shows and where it came from, in a sentence or two.',
    notes: '', x: 0, y: 0, actions: [], questions: [], docRef: null, width: null, color: null, collapsed: false, groupId: null,
    status: null, priority: null, highlight: null, ...extra }
  renderBlock(id)
  return state.blocks[id]
}

let sheet = null
async function appSheet() {
  if (!sheet) {
    const css = await (await fetch('../css/style.css', { cache: 'no-store' })).text()
    sheet = new CSSStyleSheet(); sheet.replaceSync(css)
  }
  return sheet
}

// The app's stylesheet and the canvas viewport laid out, invisible.
async function withCanvas(fn, { w = 1000, h = 700 } = {}) {
  const s = await appSheet()
  const vp = $.canvasViewport(), root = $.canvasRoot()
  const prev = { css: vp.style.cssText, sheets: [...document.adoptedStyleSheets], view: { ...view },
    cls: root.classList.contains('canvas-root'), vcls: vp.classList.contains('canvas-viewport') }
  document.adoptedStyleSheets = [...prev.sheets, s]
  vp.classList.add('canvas-viewport')
  vp.style.cssText = `display:block;position:fixed;left:24px;top:24px;width:${w}px;height:${h}px;overflow:hidden;z-index:2147483646;opacity:0;pointer-events:none`
  root.classList.add('canvas-root')
  try { return await fn(vp, root) } finally {
    if (!prev.cls) root.classList.remove('canvas-root')
    if (!prev.vcls) vp.classList.remove('canvas-viewport')
    vp.style.cssText = prev.css
    document.adoptedStyleSheets = prev.sheets
    Object.assign(view, prev.view)
    applyTransform()
    applyLod({ exact: true })
  }
}
const zoomTo = z => { view.zoom = z; applyLod({ exact: true }) }
const lines = el => [...el.querySelectorAll('.block-lod-title .block-lod-line')]

// ── The pill band's titles use both lines ────────────────────
describe('qa4c: at 33% a cut title fills its second line before it ends', () => {
  const mono = w => s => s.length * w
  const pill = FACE_METRICS.pill
  // A 218px card at 33% (face scale 3.08): 50.7 face pixels of title room.
  const spec = { layout: 'row', width: 50.68, lines: 2 }

  it('line 1 never ends the title over an empty line 2: the closing word gives letters to the ellipsis', () => {
    // 7px a character: "payment" fits line 2, "payment…" does not.
    assert.deepEq(fitTitle('The payment service is at fault', spec.width, 2, mono(7), pill.hang), { lines: ['The', 'paymen' + ELLIPSIS], cut: true })
    assert.deepEq(fitTitle('What changed in the last week', spec.width, 2, mono(7), pill.hang), { lines: ['What', 'change' + ELLIPSIS], cut: true })
    // The face keeps its dot for it: the type is what the pill shows first.
    const f = fitFaceTitle('The payment service is at fault', spec, pill, mono(7))
    assert.eq(f.dot, true)
    assert.deepEq(f.hangs, [false, true])
    // A whole closing word that takes the ellipsis is still preferred.
    assert.deepEq(fitTitle('The paying rate is at fault', spec.width, 2, mono(7), pill.hang), { lines: ['The', 'paying' + ELLIPSIS], cut: true })
  })

  it('a lone word over its line by no more than the hang takes the hang, so it never draws as "Check…"', () => {
    // "Checkout" is 52px: over the 50.7px line, within its 3px hang.
    const f = fitFaceTitle('Checkout returns 500 on some card payments', spec, pill, mono(6.5))
    assert.deepEq(f.lines, ['Checkout', 'returns' + ELLIPSIS])
    assert.eq(f.dot, true, 'it keeps the dot')
    assert.eq(f.hangs[0], true, 'line 1 reaches into the hang (CSS .is-end), so its letters are not clipped')
  })

  it('every cut title over many widths uses every line it has, its words whole but the closing one', () => {
    const words = ['The', 'payment', 'service', 'is', 'at', 'fault', 'What', 'changed', 'Reconciliation', 'a', 'of']
    let seed = 11
    const rand = n => { seed = (seed * 16807) % 2147483647; return seed % n }
    for (let t = 0; t < 400; t++) {
      const title = Array.from({ length: 2 + rand(6) }, () => words[rand(words.length)]).join(' ')
      const width = 30 + rand(90), max = 1 + rand(3)
      const { lines: ls, cut } = fitTitle(title, width, max, mono(6.5), 3)
      if (!cut) continue
      // Enough room for one letter and the ellipsis: every line is used.
      if (6.5 * 2 <= width + 3) assert.eq(ls.length, max, `${title} @${width}x${max}: ${JSON.stringify(ls)}`)
      ls.slice(0, -1).forEach(l => assert.ok(!l.endsWith(ELLIPSIS), `only the last line ends in an ellipsis: ${JSON.stringify(ls)}`))
    }
  })

  it('on the canvas at 33%, with the app\'s stylesheet: two lines, the ellipsis at the end of the second, nothing clipped', async () => {
    reset(); setupZoomControls()
    await withCanvas(async (vp, root) => {
      const titles = ['The payment service is at fault', 'What changed in the last week', 'Checkout returns 500 on some card payments',
        'No test covers the payment retry path', 'Smallest experiment to run next']
      titles.forEach((t, i) => card('p' + i, t, { x: (i % 3) * 300, y: Math.floor(i / 3) * 260 }))
      zoomTo(0.33)
      assert.ok(root.classList.contains('lod-pill'), root.className)
      const k = parseFloat(getComputedStyle(root).getPropertyValue('--lodk'))
      titles.forEach((title, i) => {
        const el = document.getElementById('b-p' + i)
        const budget = faceLayout('pill', el.clientWidth / k, el.clientHeight / k).lines
        assert.eq(budget, 2, `${title}: the card holds two lines at 33%`)
        const ls = lines(el), text = ls.map(l => l.textContent)
        if (text.join(' ') === title) return
        assert.eq(ls.length, 2, `${title}: two lines, not ${JSON.stringify(text)}`)
        assert.ok(!text[0].endsWith(ELLIPSIS) && text[1].endsWith(ELLIPSIS), `${title}: the ellipsis ends line 2 (${JSON.stringify(text)})`)
        assert.ok(title.startsWith(text.join(' ').slice(0, -1)), `${title}: in order (${JSON.stringify(text)})`)
        ls.forEach(l => assert.ok(l.scrollWidth <= l.clientWidth + 0.5, `${title}: "${l.textContent}" is not clipped (${l.scrollWidth} > ${l.clientWidth})`))
      })
      // The two the verifier named, whatever the test page's font.
      ;[0, 1].forEach(i => assert.eq(lines(document.getElementById('b-p' + i)).length, 2, titles[i]))
    })
    reset()
  })
})

// ── The phone's focus chip clears the map's name ─────────────
describe('qa4c: on a phone the canvas focus chip sits under the map\'s name, not behind it', () => {
  const px = v => parseFloat(v)
  function phoneRules(css) {
    const s = new CSSStyleSheet(); s.replaceSync(css)
    const out = []
    for (const r of s.cssRules) {
      if (!(r instanceof CSSMediaRule) || !/max-width:\s*432px/.test(r.conditionText)) continue
      for (const x of r.cssRules) if (x.selectorText) out.push(x)
    }
    return out
  }

  it('wherever the name shows, the chip starts 8px below it, on its left edge', async () => {
    const css = await (await fetch('../css/style.css', { cache: 'no-store' })).text()
    const rules = phoneRules(css)
    const name = rules.find(r => r.selectorText.trim() === '.canvas-map-name' && r.style.top)
    assert.ok(name, 'the name\'s phone rule')
    const chip = rules.find(r => /canvas-viewport.*::after/.test(r.selectorText) && r.style.top)
    assert.ok(chip, 'the chip\'s phone rule')
    assert.ok(px(chip.style.top) >= px(name.style.top) + px(name.style.height) + 8, `chip top ${chip.style.top}, name ${name.style.top} + ${name.style.height}`)
    assert.eq(chip.style.left, name.style.left, 'the two share a left edge')
    // The chip moves only where the name shows: a map with blocks, and not
    // an embed, dot voting or zen (each hides the name).
    assert.includes(chip.selectorText, ':has(#canvasRoot .block)')
    ;['embed-mode', 'voting-mode', 'data-zen'].forEach(k => assert.includes(chip.selectorText, k))
    const hides = rules.find(r => /canvas-map-name/.test(r.selectorText) && r.style.display === 'none' && /voting-mode/.test(r.selectorText))
    assert.ok(hides && ['embed-mode', 'voting-mode', 'data-zen', ':not(:has(#canvasRoot .block))'].every(k => hides.selectorText.includes(k)),
      'the name hides in exactly those cases')
  })

  it('the arrival keeps cards clear of the chip where it now sits (it reads the chip\'s box)', async () => {
    const src = await (await fetch('../js/zoom-controls.js', { cache: 'no-store' })).text()
    assert.match(src, /getComputedStyle\(vp, '::after'\)[\s\S]{0,200}parseFloat\(cs\.top\)[\s\S]{0,80}parseFloat\(cs\.left\)/)
  })
})
