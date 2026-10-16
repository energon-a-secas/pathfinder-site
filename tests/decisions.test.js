// ============================================================
//  decisions.test.js -- the calls settled on 2026-10-16
//  Fit fits on a phone (the 10% zoom floor), the Brief's Framing
//  fields grow instead of scrolling, the app page's footer drops the
//  kit's end mark and tightens the kit's own padding on a phone.
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, view } from '../js/state.js'
import { $, MIN_ZOOM, getBlockDims } from '../js/utils.js'
import { renderBlock } from '../js/render.js'
import { applyTransform, fitView } from '../js/canvas.js'

function reset() {
  cleanupMockEls()
  Object.keys(state.blocks).forEach(k => delete state.blocks[k])
  state.arrows.length = 0
  $.canvasRoot().querySelectorAll('.block').forEach(el => el.remove())
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '',
    x: 0, y: 0, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, ...extra }
  renderBlock(id)
  return state.blocks[id]
}

const pageDocs = {}
const docOf = async page => pageDocs[page] || (pageDocs[page] =
  new DOMParser().parseFromString(await (await fetch(`../${page}`, { cache: 'no-store' })).text(), 'text/html'))

describe('decisions: Fit shows a large map whole on a phone', () => {
  it('a map 2,600px wide fits a 340px canvas, every card on screen', () => {
    reset()
    const vp = $.canvasViewport(), prevCss = vp.style.cssText, prevView = { ...view }
    vp.style.cssText = 'display:block;position:fixed;left:-4000px;top:0;width:340px;height:560px;overflow:hidden'
    try {
      for (let i = 0; i < 9; i++) block(`c${i}`, { x: i * 300, y: (i % 3) * 180 })
      fitView()
      assert.ok(view.zoom >= MIN_ZOOM, `zoom ${view.zoom.toFixed(3)} stays at or above the floor`)
      const W = vp.offsetWidth, H = vp.offsetHeight
      Object.keys(state.blocks).forEach(id => {
        const b = state.blocks[id], { w, h } = getBlockDims(id), z = view.zoom
        const x1 = b.x * z + view.panX, y1 = b.y * z + view.panY
        assert.ok(x1 >= -0.5 && y1 >= -0.5 && x1 + w * z <= W + 0.5 && y1 + h * z <= H + 0.5,
          `${id} on screen at zoom ${z.toFixed(3)}`)
      })
    } finally {
      vp.style.cssText = prevCss
      Object.assign(view, prevView)
      applyTransform()
      reset()
    }
  })
  it('the floor is low enough for the sample map on a 390px phone (about 12%)', () => {
    assert.ok(MIN_ZOOM <= 0.12, `MIN_ZOOM is ${MIN_ZOOM}`)
  })
})

describe('decisions: Framing grows instead of scrolling inside the Brief', () => {
  it('both Framing text fields grow with their text', async () => {
    const d = await docOf('index.html')
    for (const id of ['situationConstraints', 'contextBrief']) {
      assert.ok(d.getElementById(id)?.classList.contains('insp-autogrow'), `#${id} grows with its text`)
    }
  })
})

describe('decisions: the app page footer', () => {
  it('the app page drops the kit\'s end mark; the doc pages keep it', async () => {
    const app = (await docOf('index.html')).querySelector('footer.neo-footer')
    assert.eq(app?.getAttribute('data-fin'), 'off', 'an app is not read to its end')
    for (const page of ['tutorial.html', 'examples.html', '404.html']) {
      const f = (await docOf(page)).querySelector('footer.neo-footer')
      assert.ok(f && f.getAttribute('data-fin') !== 'off', `${page} keeps "Fin."`)
    }
  })

  it('on a phone the app footer tightens only the kit\'s own padding token', async () => {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;left:-5000px;top:0;width:375px;height:300px;border:0'
    frame.srcdoc = '<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/neorgon-footer.css"><link rel="stylesheet" href="../css/style.css"></head>' +
      '<body><footer class="neo-footer" data-footer-mode="app" data-stick="off" data-fin="off"></footer>' +
      '<footer class="neo-footer" id="docFooter" data-footer-mode="minimal"></footer></body></html>'
    const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
    document.body.appendChild(frame)
    await loaded
    try {
      const w = frame.contentWindow, d = frame.contentDocument
      const app = d.querySelector('footer[data-footer-mode="app"]')
      assert.eq(w.getComputedStyle(app).getPropertyValue('--footer-pad-block-app').trim(), '6px')
      assert.eq(w.getComputedStyle(app).paddingTop, '6px')
      // Nothing else about the kit changes: the doc footer keeps its token.
      assert.eq(w.getComputedStyle(d.getElementById('docFooter')).getPropertyValue('--footer-pad-block').trim(), '24px')
      frame.style.width = '1200px'
      await new Promise(r => w.requestAnimationFrame(() => r()))
      assert.eq(w.getComputedStyle(app).paddingTop, '14px', 'a desktop keeps the kit\'s padding')
    } finally { frame.remove() }
  })
})
