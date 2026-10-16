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
  it('the floor sits under the sample map\'s phone Fit (about 16%), with room for bigger maps', () => {
    assert.ok(MIN_ZOOM <= 0.1, `MIN_ZOOM is ${MIN_ZOOM}`)
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

// The app's stylesheet in a shadow root, for computed styles on markup.
let sheetP = null
const realSheet = () => sheetP || (sheetP = fetch('../css/style.css', { cache: 'no-store' }).then(r => r.text()).then(css => {
  const s = new CSSStyleSheet(); s.replaceSync(css); return s
}))
async function shadow(markup) {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-3000px;top:0;width:600px;height:300px'
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  root.adoptedStyleSheets = [await realSheet()]
  root.innerHTML = markup
  return { root, done: () => host.remove() }
}

describe('decisions: the dot band stays usable at the 10% floor', () => {
  it('only the selected card\'s ports take a press, so a press on a card selects or drags it', async () => {
    const { root, done } = await shadow(
      '<div class="canvas-root lod-dot">' +
      '<div class="block" id="a"><div class="port port-top"></div><div class="port port-right"></div></div>' +
      '<div class="block selected" id="b"><div class="port port-top"></div></div></div>')
    try {
      root.querySelectorAll('#a .port').forEach(p => assert.eq(getComputedStyle(p).pointerEvents, 'none'))
      assert.ok(getComputedStyle(root.querySelector('#b .port')).pointerEvents !== 'none', 'the selected card still connects')
    } finally { done() }
    const full = await shadow('<div class="canvas-root lod-full"><div class="block"><div class="port port-top"></div></div></div>')
    try { assert.ok(getComputedStyle(full.root.querySelector('.port')).pointerEvents !== 'none', 'at full detail every port works') }
    finally { full.done() }
  })

  it('every card keeps its shape, inside its own box', async () => {
    // A 220 by 65 card at 10%: the face is laid out in screen pixels
    // (22 by 6.5, --lodk 10) and scaled back up, as lod.js does.
    const { root, done } = await shadow('<div class="canvas-root lod-dot" style="--lodk:10">' +
      '<div class="block" style="position:absolute;width:220px;height:65px;min-height:0"><div class="block-lod">' +
      '<div class="block-lod-face" data-nodot="1"><div class="block-lod-head"><span class="block-type-dot"></span></div></div></div></div></div>')
    try {
      const head = root.querySelector('.block-lod-head'), dot = root.querySelector('.block-type-dot')
      assert.eq(getComputedStyle(head).display, 'flex', 'a face laid out without its dot still shows the shape')
      const face = root.querySelector('.block-lod').clientHeight, h = dot.offsetHeight
      assert.ok(face >= 6 && face <= 7, `the face is laid out at the card's screen height (${face}px)`)
      assert.ok(h > 0 && h <= face * 0.7 + 0.5, `the shape is ${h}px on a ${face}px card`)
    } finally { done() }
  })

  it('the dot grid keeps a pitch of 5px or more, so it never turns to a moire', () => {
    const prev = { ...view }
    try {
      for (const z of [0.1, 0.14, 0.18, 0.25, 1]) {
        view.zoom = z; applyTransform()
        const pitch = parseFloat($.canvasViewport().style.backgroundSize)
        assert.ok(pitch >= 5, `zoom ${z}: pitch ${pitch.toFixed(2)}px`)
      }
      view.zoom = 1; applyTransform()
      assert.eq(parseFloat($.canvasViewport().style.backgroundSize), 28, '100% keeps the 28px grid')
    } finally { Object.assign(view, prev); applyTransform() }
  })
})

describe('decisions: Framing on every window', () => {
  const paneFrame = async (height, pane) => {
    const frame = document.createElement('iframe')
    frame.style.cssText = `position:fixed;left:-5000px;top:0;width:400px;height:${height}px;border:0`
    frame.srcdoc = `<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css"></head><body><aside class="right-panel" style="height:${height}px"><div class="panel-content">${pane}</div></aside></body></html>`
    const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
    document.body.appendChild(frame)
    await loaded
    const d = frame.contentDocument
    d.getElementById('promptPane').classList.add('active', 'framing-open')
    d.getElementById('briefFraming').hidden = false
    return frame
  }
  it('an empty Boundaries field keeps room for its three-line example', async () => {
    const pane = (await docOf('index.html')).getElementById('promptPane').outerHTML
    const frame = await paneFrame(900, pane)
    try {
      const w = frame.contentWindow, f = frame.contentDocument.getElementById('situationConstraints')
      assert.eq(w.getComputedStyle(f).minHeight, '68px')
    } finally { frame.remove() }
  })
  it('on a short window Framing takes the brief\'s place; on a tall one the brief stays below it', async () => {
    const pane = (await docOf('index.html')).getElementById('promptPane').outerHTML
    for (const [height, shown] of [[600, false], [900, true]]) {
      const frame = await paneFrame(height, pane)
      try {
        const w = frame.contentWindow, doc = frame.contentDocument.getElementById('briefDoc')
        assert.eq(w.getComputedStyle(doc).display !== 'none', shown, `${height}px window: the brief ${shown ? 'shows' : 'waits'}`)
      } finally { frame.remove() }
    }
  })
})
