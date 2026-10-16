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
  it('ports by band: none under 25%, only the selected card\'s from 25 to 45% and outside it, all from 45% up', async () => {
    const markup = band => `<div class="canvas-root ${band}">` +
      '<div class="block" id="a"><div class="port port-top"></div><div class="port port-right"></div>' +
      '<div class="block-gap-icons"><span class="gap-icon"></span></div></div>' +
      '<div class="block selected" id="b"><div class="port port-top"></div></div></div>'
    const pe = el => getComputedStyle(el).pointerEvents
    const dot = await shadow(markup('lod-dot'))
    try {
      dot.root.querySelectorAll('.port').forEach(p => assert.eq(pe(p), 'none', 'dot band: no port takes a press'))
      assert.eq(pe(dot.root.querySelector('.block-gap-icons')), 'none', 'dot band: the gap badge is a mark, not a target')
    } finally { dot.done() }
    const pill = await shadow(markup('lod-pill'))
    try {
      pill.root.querySelectorAll('#a .port').forEach(p => assert.eq(pe(p), 'none', 'pill band: an unselected card\'s ports take no press'))
      const sel = pill.root.querySelector('#b .port')
      assert.eq(pe(sel), 'none', 'pill band: the selected card\'s dot itself takes no press (it straddles the edge)')
      assert.eq(getComputedStyle(sel, '::before').pointerEvents, 'auto', 'its outside strip does: the selected card still connects')
      assert.eq(parseFloat(getComputedStyle(sel).getPropertyValue('--port-in')), 0, 'the strip starts at the card\'s edge')
      assert.ok(/\b8\s*\*/.test(getComputedStyle(sel).getPropertyValue('--port-hit')), 'and reaches 8px, under the 10px Tidy leaves at 25%')
      assert.eq(pe(pill.root.querySelector('.block-gap-icons')), 'none', 'pill band: the gap badge is a mark')
    } finally { pill.done() }
    for (const band of ['lod-title', 'lod-full']) {
      const t = await shadow(markup(band))
      try {
        t.root.querySelectorAll('.port').forEach(p => assert.ok(pe(p) !== 'none', `${band}: every port works`))
        const reach = getComputedStyle(t.root.querySelector('#a .port')).getPropertyValue('--port-in').trim()
        assert.ok(reach && reach !== '0px', `${band}: targets keep their reach into the card (${reach})`)
      } finally { t.done() }
    }
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

describe('decisions: a frame\'s name stays on top below full detail', () => {
  it('draws above the cards and their ports, on the canvas colour, from the title band down', async () => {
    for (const band of ['lod-title', 'lod-pill', 'lod-dot']) {
      const { root, done } = await shadow(`<div class="canvas-root ${band}"><div class="frame" style="left:0;top:40px;width:200px;height:100px"><div class="frame-label">Risk frame</div></div></div>`)
      try {
        const cs = getComputedStyle(root.querySelector('.frame-label'))
        assert.ok(parseInt(cs.zIndex, 10) > 20, `${band}: z-index ${cs.zIndex}, over a port's 20`)
        assert.ok(cs.backgroundColor !== 'rgba(0, 0, 0, 0)', `${band}: a backdrop, so a card under it does not show through`)
      } finally { done() }
    }
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
  it('on a short window the closed brief\'s floor drops (120px under 700px of height, 64px under 600px)', async () => {
    const pane = (await docOf('index.html')).getElementById('promptPane').outerHTML
    for (const [height, want] of [[650, '120px'], [580, '64px'], [900, null]]) {
      const frame = await paneFrame(height, pane)
      try {
        const d = frame.contentDocument
        d.getElementById('promptPane').classList.remove('framing-open')
        d.getElementById('briefFraming').hidden = true
        const floor = frame.contentWindow.getComputedStyle(d.getElementById('briefDoc')).minHeight
        if (want) assert.eq(floor, want, `${height}px window`)
        else assert.ok(!['120px', '64px'].includes(floor), `${height}px window keeps the tall floor (${floor})`)
      } finally { frame.remove() }
    }
  })
  it('a 1024 by 560 window: with Framing closed the panel does not overflow', async () => {
    const pane = (await docOf('index.html')).getElementById('promptPane').outerHTML
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;left:-5000px;top:0;width:1024px;height:560px;border:0'
    // The right panel as a 1024 by 560 window lays it out: 274px wide, 411px for its content.
    frame.srcdoc = `<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css"></head><body>` +
      `<aside class="right-panel" style="position:absolute;right:0;top:0;width:274px;height:411px;display:flex;flex-direction:column">` +
      `<div class="panel-content" id="pc" style="flex:1;min-height:0;overflow-y:auto">${pane}</div></aside></body></html>`
    const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
    document.body.appendChild(frame)
    await loaded
    try {
      const d = frame.contentDocument
      d.getElementById('promptPane').classList.add('active')
      d.getElementById('modeDesc').textContent = 'Establish what is true first: evidence for each finding, unknowns left marked as unknown.'
      d.getElementById('briefReady').hidden = false
      d.getElementById('briefReadyText').innerHTML = '<strong>4 open items</strong>: 2 unanswered questions, 2 unverified assumptions.'
      d.getElementById('briefFramingSummary').textContent = 'This repo, in Claude Code, read the code first; 3 boundaries, context'
      await new Promise(r => frame.contentWindow.requestAnimationFrame(() => r()))
      const pc = d.getElementById('pc')
      assert.ok(pc.scrollHeight <= pc.clientHeight + 1, `content ${pc.scrollHeight}px in ${pc.clientHeight}px`)
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
