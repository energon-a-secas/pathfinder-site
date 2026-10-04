// ============================================================
//  zoom.test.js: the ZOOM stream (design round, wave 2).
//  Legibility at any zoom: the level-of-detail bands and the
//  card's small-zoom face, where a map lands when it arrives,
//  the minimap, Tidy's move, the hover fade, and Escape after a
//  context menu leaving the camera alone (js/zoom-controls.js,
//  js/minimap.js and their CSS in the [zoom] section).
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, view, pointer, getUndoHistory, getRedoFuture, resetSnapshotToken, saveState } from '../js/state.js'
import { $, MIN_ZOOM, getBlockDims } from '../js/utils.js'
import { renderBlock, renderAllBlocks, deselectAll, blockDecorators } from '../js/render.js'
import { applyTransform, transformHooks, renderFrames } from '../js/canvas.js'
import { closeMenus, isMenuOpen } from '../js/menu.js'
import { setupTabNavigation, setupKeyboardShortcuts, setupCanvasPointerEvents } from '../js/events.js'
import { withCameraHeld } from '../js/navigation.js'
import { openBlockMenu } from '../js/context-menu.js'
import { SHORTCUTS, runTidy, setupTemplates, openShortcuts, closeShortcuts, openSearch, closeSearch } from '../js/ui-panels.js'
import { viewMenuItems } from '../js/view-menu.js'
import { TEMPLATES } from '../js/templates.js'
import { buildSvg } from '../js/image-export.js'
import {
  LOD_BANDS, LABELS_MIN_ZOOM, LOD_MARGIN, lodBand, labelsAtRest, applyLod, paintLodFace, currentLod,
  lodScale, LOD_STEPS_PER_OCTAVE, LOD_GESTURE_STEPS, LOD_SETTLE_MS,
  ARRIVAL_ZOOM, ARRIVAL_HINT, ARRIVAL_HINT_TOUCH, arrivalHint,
  entryBlocks, arrivalView, arriveAt, arriveAfterLoad, arrivalLead,
  TIDY_MS, animateTidy, positionsNow, fitTarget, setupZoomControls, openZoomMenu, easeOut,
} from '../js/zoom-controls.js'
import { tipSides, placeTip, TIP_ROOM } from '../js/lod.js'
import {
  MINIMAP_SIZE, contentBounds, visibleWorld, minimapBounds, panForWorldOrigin,
  setMinimap, isMinimapOn, toggleMinimap, minimapAvailable, refreshMinimap, setupMinimap,
} from '../js/minimap.js'

// ── Helpers ─────────────────────────────────────────────────
function reset() {
  closeMenus()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  ui.embed = false
  pointer.ix = null
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
  $.canvasRoot().querySelectorAll('.block').forEach(el => el.remove())
  document.querySelector('.toast-notification')?.remove()
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '',
    x: 0, y: 0, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, ...extra }
  renderBlock(id)
  return state.blocks[id]
}

const link = (from, to, extra = {}) => state.arrows.push({ id: `a-${from}-${to}`, from, to, ...extra })

let sheetPromise = null
function realSheet() {
  sheetPromise = sheetPromise || fetch('../css/style.css').then(r => r.text()).then(css => {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    return { sheet, css }
  })
  return sheetPromise
}

// The app's stylesheet on the test page, and the viewport laid out and on
// screen (the stub hides it), for anything that measures.
async function withApp(fn, { w = 800, h = 600 } = {}) {
  const { sheet } = await realSheet()
  const vp = $.canvasViewport()
  // A copy: document.adoptedStyleSheets is a live array, so keeping it kept
  // every sheet added after, and nothing was ever taken off again.
  const prev = { css: vp.style.cssText, tab: vp.getAttribute('tabindex'), sheets: [...document.adoptedStyleSheets], view: { ...view } }
  document.adoptedStyleSheets = [...prev.sheets, sheet]
  // Off the page's top left corner, where the real pointer rests, so no card is hovered.
  vp.style.cssText = `display:block;position:fixed;left:24px;top:24px;width:${w}px;height:${h}px;overflow:hidden;z-index:2147483646;opacity:0;pointer-events:auto`
  vp.tabIndex = 0
  // The stub root has the id but not the class the stylesheet keys on.
  const root = $.canvasRoot(), hadClass = root.classList.contains('canvas-root')
  root.classList.add('canvas-root')
  const done = () => {
    if (!hadClass) root.classList.remove('canvas-root')
    vp.style.cssText = prev.css
    if (prev.tab == null) vp.removeAttribute('tabindex'); else vp.setAttribute('tabindex', prev.tab)
    document.adoptedStyleSheets = prev.sheets
    Object.assign(view, prev.view)
    applyTransform()
  }
  try { return await fn(vp) } finally { done() }
}

// The app's stylesheet in a shadow root, for computed-style checks on markup.
async function shadow(markup) {
  const { sheet } = await realSheet()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-3000px;top:0;width:400px;height:300px'
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  root.adoptedStyleSheets = [sheet]
  root.innerHTML = markup
  return { root, done: () => host.remove() }
}

// The headless page has no system focus, so element.focus() moves focus
// without firing focus events. Fire the focusin a focused page would (the
// same shim as navigation.test.js), so the camera handlers run.
async function withFocusEvents(fn) {
  const orig = HTMLElement.prototype.focus
  HTMLElement.prototype.focus = function (opts) {
    const prev = document.activeElement
    orig.call(this, opts)
    if (document.activeElement === this && prev !== this && !document.hasFocus()) {
      const from = prev === document.body ? null : prev
      // The element losing focus hears it first, as on a focused page.
      if (from?.isConnected) from.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: this }))
      this.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: from }))
    }
  }
  try { return await fn() } finally { HTMLElement.prototype.focus = orig }
}

const setZoom = z => { view.zoom = z; applyLod({ exact: true }) }
const rootClasses = () => [...$.canvasRoot().classList].filter(c => c.startsWith('lod-')).sort()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const frame = () => new Promise(r => requestAnimationFrame(() => r()))

// ── Level of detail: the bands ──────────────────────────────
describe('zoom: level-of-detail bands', () => {
  it('each zoom falls in one band: full from 75%, title from 45%, pill from 25%, dot below', () => {
    assert.deepEq(LOD_BANDS.map(b => [b.band, b.min]), [['full', 0.75], ['title', 0.45], ['pill', 0.25], ['dot', 0]])
    const cases = [[2.6, 'full'], [1, 'full'], [0.75, 'full'], [0.7499, 'title'], [0.6, 'title'], [0.45, 'title'],
      [0.4499, 'pill'], [0.3, 'pill'], [0.25, 'pill'], [0.2499, 'dot'], [MIN_ZOOM, 'dot']]
    for (const [z, band] of cases) assert.eq(lodBand(z), band, `${z}`)
  })

  it('a gesture resting on an edge keeps its band; a jump lands exactly', () => {
    // Pinching out across 75%: still full until the zoom is LOD_MARGIN past the edge.
    assert.eq(lodBand(0.745, 'full', 0.752), 'full')
    assert.eq(lodBand(0.75 - LOD_MARGIN - 0.001, 'full', 0.735), 'title')
    // And back in: the title band holds just above the edge.
    assert.eq(lodBand(0.755, 'title', 0.748), 'title')
    assert.eq(lodBand(0.775, 'title', 0.765), 'full')
    // A jump (a zoom stop, Fit, an arrival) is never held back.
    assert.eq(lodBand(0.745, 'full', 1), 'title')
    assert.eq(lodBand(0.755, 'title', 0.5), 'full')
    // Only a neighbouring band holds: from dot, 70% is title at once.
    assert.eq(lodBand(0.7, 'dot', 0.69), 'title')
  })

  it('connection labels rest below 60%, with the same hysteresis', () => {
    assert.eq(LABELS_MIN_ZOOM, 0.6)
    assert.eq(labelsAtRest(0.6), true)
    assert.eq(labelsAtRest(0.59), false)
    assert.eq(labelsAtRest(0.595, true, 0.605), true, 'a gesture step keeps them')
    assert.eq(labelsAtRest(0.595, true, 1), false, 'a jump does not')
  })

  it('the canvas root carries exactly one band class, and the quiet-labels class under 60%', () => {
    reset()
    const saved = view.zoom
    try {
      setZoom(1);    assert.deepEq(rootClasses(), ['lod-full'])
      setZoom(0.6);  assert.deepEq(rootClasses(), ['lod-title'])
      setZoom(0.5);  assert.deepEq(rootClasses(), ['lod-quiet-labels', 'lod-title'])
      setZoom(0.3);  assert.deepEq(rootClasses(), ['lod-pill', 'lod-quiet-labels'])
      setZoom(0.2);  assert.deepEq(rootClasses(), ['lod-dot', 'lod-quiet-labels'])
      setZoom(0.8);  assert.deepEq(rootClasses(), ['lod-full'])
      assert.eq(currentLod(), 'full')
    } finally { view.zoom = saved; applyLod({ exact: true }) }
  })

  it('the face scale never puts text under its size and moves in steps, so a pinch rarely re-lays it out', () => {
    for (let z = 0.18; z < 0.75; z += 0.0037) {
      const k = lodScale(z)
      assert.ok(k * z >= 1 - 1e-9, `at ${z.toFixed(3)} text is at its size or above`)
      assert.ok(k * z < Math.pow(2, 1 / LOD_STEPS_PER_OCTAVE) + 1e-9, `and at most one step above (${(k * z).toFixed(3)})`)
    }
    assert.eq(lodScale(1), 1); assert.eq(lodScale(2), 1)
    const ks = new Set()
    for (let z = 0.6; z >= 0.55; z -= 0.0025) ks.add(lodScale(z))
    assert.ok(ks.size <= 3, `${ks.size} layouts over 21 pinch frames`)
    reset()
    const saved = view.zoom
    try {
      setZoom(0.5)
      assert.eq(+$.canvasRoot().style.getPropertyValue('--lodk'), +lodScale(0.5).toFixed(5))
      setZoom(1)
      assert.eq($.canvasRoot().style.getPropertyValue('--lodk'), '1', 'full detail: no scale')
    } finally { view.zoom = saved; applyLod({ exact: true }) }
  })

  it('applyTransform drives it: the band follows every pan and zoom once the controls are set up', () => {
    reset()
    setupZoomControls()
    assert.ok(transformHooks.has(applyLod), 'registered as a transform hook')
    assert.ok(blockDecorators.includes(paintLodFace), 'and the face as a card decorator')
    const saved = { ...view }
    try {
      view.zoom = 0.3; applyTransform()
      assert.ok($.canvasRoot().classList.contains('lod-pill'))
      view.zoom = 1; applyTransform()
      assert.ok($.canvasRoot().classList.contains('lod-full'))
    } finally { Object.assign(view, saved); applyTransform() }
  })
})

// ── Level of detail: the card's face ────────────────────────
describe('zoom: the card\'s small-zoom face', () => {
  it('every card carries one aria-hidden face with its type, title and the whole title as a tip', () => {
    reset()
    setupZoomControls()
    const b = block('f1', { type: 'risk', title: 'Silent <divergence> between the two' })
    const el = $.canvasRoot().querySelector('#b-f1')
    const faces = el.querySelectorAll(':scope > .block-lod')
    assert.eq(faces.length, 1)
    const face = faces[0]
    assert.eq(face.getAttribute('aria-hidden'), 'true', 'the card\'s own name already says it')
    assert.eq(face.querySelector('.block-lod-type').textContent, 'Risk')
    assert.eq(face.querySelector('.block-lod-title').textContent, 'Silent <divergence> between the two', 'escaped, not markup')
    assert.eq(face.querySelector('.block-type-dot').dataset.shape, 'diamond', 'the type\'s shape, so colour is not the only cue')
    assert.includes(face.querySelector('.block-lod-tip').textContent, 'Silent <divergence> between the two')
    assert.eq(face.querySelectorAll('[tabindex], button, a').length, 0, 'nothing in it takes focus')
    b.title = ''
    renderBlock('f1')
    assert.eq(el.querySelectorAll(':scope > .block-lod').length, 1, 'a re-render replaces it')
    assert.ok(el.querySelector('.block-lod-title').classList.contains('is-empty'))
    assert.eq(el.querySelector('.block-lod-title').textContent, 'Untitled')
  })

  it('a card keeps its size in every band, so no line moves when the zoom crosses one', async () => {
    reset()
    setupZoomControls()
    await withApp(async () => {
      block('tall', { type: 'requirement', title: 'Reversible at every step',
        description: 'Each phase can be rolled back without a data migration in the other direction.',
        priority: 'high', actions: ['resolve'] })
      block('short', { type: 'terminator', title: 'Report received', x: 400 })
      const sizes = {}
      for (const z of [1, 0.6, 0.3, 0.2]) {
        setZoom(z); applyTransform()
        sizes[z] = ['tall', 'short'].map(id => JSON.stringify(getBlockDims(id)))
      }
      assert.deepEq(sizes[0.6], sizes[1]); assert.deepEq(sizes[0.3], sizes[1]); assert.deepEq(sizes[0.2], sizes[1])
    })
  })

  it('full detail shows the card; below it the face shows instead, at 11px or more on screen', async () => {
    reset()
    setupZoomControls()
    await withApp(async () => {
      block('c', { type: 'goal', title: 'Everything on the new system', description: 'With a date and a definition of done.' })
      const el = document.getElementById('b-c')
      const face = el.querySelector('.block-lod')
      setZoom(1); applyTransform()
      assert.eq(getComputedStyle(face).display, 'none', 'no face at full detail')
      assert.eq(getComputedStyle(el.querySelector('.block-title')).visibility, 'visible')
      for (const z of [0.7, 0.5, 0.46]) {
        setZoom(z); applyTransform()
        assert.neq(getComputedStyle(face).display, 'none', `face at ${z}`)
        assert.eq(getComputedStyle(el.querySelector('.block-title')).visibility, 'hidden', 'the card\'s own text steps back')
        assert.eq(getComputedStyle(el.querySelector('.block-desc')).visibility, 'hidden')
        // On screen: the face is the card's size, and a line of the title is 16px tall at 12px.
        const fr = face.getBoundingClientRect(), cr = el.getBoundingClientRect()
        assert.ok(Math.abs(fr.width - cr.width) < 4 && fr.height <= cr.height + 1, `the face sits on the card at ${z}`)
        const title = el.querySelector('.block-lod-title')
        const line = parseFloat(getComputedStyle(title).lineHeight)
        assert.ok(title.getBoundingClientRect().height >= line - 0.5, 'at least one line')
        assert.ok(Math.abs(title.getBoundingClientRect().height / Math.round(title.getBoundingClientRect().height / line) - line) < 1,
          'lines are 16px on screen: the face undoes the zoom')
        assert.ok(parseFloat(getComputedStyle(title).fontSize) >= 11, 'never under the 11px floor')
      }
      setZoom(0.3); applyTransform()
      const pillTitle = el.querySelector('.block-lod-title')
      assert.eq(parseFloat(getComputedStyle(pillTitle).fontSize), 11, 'the pill is 11px')
      assert.ok(pillTitle.getBoundingClientRect().height <= 26 + 0.5, 'two lines at most')
    })
  })

  it('the dot band fills the card with its type and shows the title only on hover or focus', async () => {
    reset()
    setupZoomControls()
    await withApp(async () => {
      block('d', { type: 'process', title: 'Shadow-write to both' })
      const el = document.getElementById('b-d')
      setZoom(0.2); applyTransform()
      const tip = el.querySelector('.block-lod-tip')
      assert.eq(getComputedStyle(tip).display, 'none', 'no text at rest')
      assert.eq(getComputedStyle(el.querySelector('.block-lod-title')).display, 'none')
      assert.notIncludes(getComputedStyle(el).backgroundColor, 'rgba(0, 0, 0, 0)', 'the card is filled')
      assert.neq(getComputedStyle(el.querySelector('.block-lod .block-type-dot')).display, 'none', 'the shape stays')
      el.focus({ preventScroll: true })
      if (el.matches(':focus-visible')) assert.neq(getComputedStyle(tip).display, 'none', 'keyboard focus shows the title')
      el.blur()
    })
  })

  it('the image export is the same in every band: it draws from the state, not the faces', async () => {
    reset()
    setupZoomControls()
    await withApp(async () => {
      block('x', { type: 'decision', title: 'Per-tenant, not big bang', description: 'Slower, and survivable.' })
      block('y', { type: 'risk', title: 'Silent divergence', x: 400 })
      link('x', 'y', { label: 'risks' })
      const svgAt = z => { setZoom(z); applyTransform(); return JSON.stringify(buildSvg()) }
      const full = svgAt(1)
      assert.ok(full && full.includes('<svg') && full.length > 200, 'an export')
      assert.notIncludes(full, 'block-lod')
      for (const z of [0.6, 0.3, 0.2]) assert.eq(svgAt(z), full, `same at ${z}`)
    })
  })

  it('a card being edited keeps its own content at any band', async () => {
    reset()
    setupZoomControls()
    await withApp(async () => {
      block('e', { title: 'Edit me' })
      const el = document.getElementById('b-e')
      setZoom(0.5); applyTransform()
      const t = el.querySelector('.block-title')
      t.contentEditable = 'true'
      try {
        assert.eq(getComputedStyle(el.querySelector('.block-lod')).display, 'none')
        assert.eq(getComputedStyle(t).visibility, 'visible')
        assert.eq(getComputedStyle(el.querySelector('.block-gap-icons') || t).visibility, 'visible')
      } finally { t.contentEditable = 'false' }
    })
  })

  it('the gap badge, the selection ring and a frame\'s name still read below full detail', async () => {
    const { root, done } = await shadow(
      '<div class="canvas-root lod-pill" style="--pxn:3;--px:3px">' +
      '<div class="block selected"><div class="block-header"><div class="block-gap-icons"><span class="gap-icon"></span></div></div></div>' +
      '<div class="frame"><div class="frame-label">Phase one</div></div></div>')
    try {
      assert.eq(getComputedStyle(root.querySelector('.block-gap-icons')).visibility, 'visible')
      assert.eq(getComputedStyle(root.querySelector('.block-header')).visibility, 'hidden')
      assert.match(getComputedStyle(root.querySelector('.block')).outlineStyle, /solid/)
      assert.match(getComputedStyle(root.querySelector('.frame-label')).transform, /matrix\(3, 0, 0, 3/)
    } finally { done() }
  })
})

// ── Connection labels under 60% ─────────────────────────────
describe('zoom: connection labels step aside when small', () => {
  const labels = cls => '<div class="canvas-root ' + cls + '" style="--pxn:4"><svg width="300" height="100"><g class="arrow-labels">' +
    '<g class="arrow-label-g"><rect class="arrow-label-bg"></rect><text class="arrow-label">rest</text></g>' +
    '<g class="arrow-label-g related"><rect class="arrow-label-bg"></rect><text class="arrow-label">related</text></g>' +
    '<g class="arrow-label-g hover"><rect class="arrow-label-bg"></rect><text class="arrow-label">hover</text></g>' +
    '<g class="arrow-label-g sel"><rect class="arrow-label-bg"></rect><text class="arrow-label">sel</text></g>' +
    '</g></svg></div>'
  it('at rest they hide; a hovered or selected line, or a hovered card\'s lines, show theirs at screen size', async () => {
    const { root, done } = await shadow(labels('lod-title lod-quiet-labels'))
    try {
      const [rest, related, hover, sel] = root.querySelectorAll('.arrow-label-g')
      assert.eq(getComputedStyle(rest).display, 'none')
      for (const g of [related, hover, sel]) assert.neq(getComputedStyle(g).display, 'none')
      assert.match(getComputedStyle(sel.querySelector('.arrow-label')).transform, /matrix\(4, 0, 0, 4/, 'scaled by the zoom\'s inverse')
    } finally { done() }
  })
  it('below 45% (pill and dot) only the line itself shows its label, not a hovered card\'s lines', async () => {
    for (const band of ['lod-pill', 'lod-dot']) {
      const { root, done } = await shadow(labels(band + ' lod-quiet-labels'))
      try {
        const [rest, related, hover, sel] = root.querySelectorAll('.arrow-label-g')
        assert.eq(getComputedStyle(rest).display, 'none')
        assert.eq(getComputedStyle(related).display, 'none', `${band}: a card's labels sat under its neighbours and on each other`)
        assert.neq(getComputedStyle(hover).display, 'none')
        assert.neq(getComputedStyle(sel).display, 'none')
      } finally { done() }
    }
  })
  it('at 60% and above every label shows as before', async () => {
    const { root, done } = await shadow(labels('lod-title'))
    try {
      for (const g of root.querySelectorAll('.arrow-label-g')) assert.neq(getComputedStyle(g).display, 'none')
    } finally { done() }
  })
})

// ── Review fixes ────────────────────────────────────────────
describe('zoom: titles, frames, lines and tips at small zoom', () => {
  it('a face title breaks between words, never inside one: a word too long for its line ends in an ellipsis', async () => {
    reset()
    setupZoomControls()
    await withApp(async () => {
      block('w', { type: 'context', title: 'Observable reconciliation everything between environments' })
      const el = document.getElementById('b-w')
      for (const z of [0.6, 0.46, 0.3]) {
        setZoom(z); applyTransform()
        const title = el.querySelector('.block-lod-title'), cs = getComputedStyle(title)
        assert.eq(cs.overflowWrap, 'normal', `${z}`); assert.eq(cs.wordBreak, 'normal'); assert.eq(cs.hyphens, 'manual')
        assert.eq(cs.textOverflow, 'ellipsis', 'a cut word says so')
        // A word split across two lines has glyphs on two lines.
        const text = title.firstChild, words = text.textContent.split(' ')
        let at = 0
        for (const w of words) {
          const r = document.createRange()
          r.setStart(text, at); r.setEnd(text, at + w.length); at += w.length + 1
          const tops = new Set([...r.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top)))
          assert.ok(tops.size <= 1, `"${w}" stays on one line at ${z} (${[...tops]})`)
        }
      }
    })
  })

  it('in the title band the type reads whole: sentence case, no tracking', async () => {
    reset()
    setupZoomControls()
    await withApp(async () => {
      block('q', { type: 'requirement', title: 'Reversible at every step', priority: 'high', actions: ['resolve'],
        description: 'Each phase can be rolled back without a data migration in the other direction, on any tenant.' })
      setZoom(0.46); applyTransform()
      const head = document.querySelector('#b-q .block-lod-head'), type = head.querySelector('.block-lod-type')
      assert.eq(getComputedStyle(head).textTransform, 'none')
      assert.eq(getComputedStyle(head).letterSpacing, 'normal')
      assert.neq(getComputedStyle(type).display, 'none', 'a tall card shows the type row')
      assert.ok(type.scrollWidth <= type.clientWidth + 0.5, `"Requirement" fits at 46% (${type.scrollWidth} of ${type.clientWidth})`)
    })
  })

  it('forced colours: the dot band\'s shapes take CanvasText, after the band\'s own colour', async () => {
    const { css } = await realSheet()
    // Every forced-colours rule applied in its place in the cascade.
    const forced = new CSSStyleSheet()
    forced.replaceSync(css.replaceAll('(forced-colors: active)', 'all'))
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-3000px;top:0;width:400px;height:300px'
    document.body.appendChild(host)
    try {
      const root = host.attachShadow({ mode: 'open' })
      root.adoptedStyleSheets = [forced]
      root.innerHTML = '<span class="probe" style="color: CanvasText"></span>' +
        '<div class="canvas-root lod-dot"><div class="block" data-type="goal" style="width:120px;height:60px">' +
        '<div class="block-lod"><div class="block-lod-face"><div class="block-lod-head">' +
        '<span class="block-type-dot" data-shape="ring"></span></div></div></div></div></div>'
      const dot = root.querySelector('.block-type-dot')
      assert.eq(getComputedStyle(dot).backgroundColor, getComputedStyle(root.querySelector('.probe')).color)
    } finally { host.remove() }
  })

  it('in Spotlight the hover fade leaves the cards alone', async () => {
    reset()
    const calm = new CSSStyleSheet()
    calm.replaceSync('.canvas-root .block { transition: none !important; }')
    await withApp(async () => {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, calm]
      const root = $.canvasRoot()
      block('h', { title: 'Hovered' }); block('r', { title: 'Related', x: 300 })
      block('u', { title: 'Unrelated', x: 600 }); block('s', { title: 'Spotlit', x: 900, highlight: 'focus' })
      document.getElementById('b-r').classList.add('related')
      root.classList.add('has-hover'); root.dataset.pointer = 'mouse'
      const op = id => +getComputedStyle(document.getElementById('b-' + id)).opacity
      try {
        assert.eq(op('u'), 0.6, 'without Spotlight, the hover fade')
        document.body.classList.add('spotlight')
        assert.ok(op('u') <= op('r') + 1e-6, `an unrelated card never rises above a related one (${op('u')} vs ${op('r')})`)
        assert.eq(op('s'), 1, 'the card Spotlight shows stays at full strength')
      } finally {
        document.body.classList.remove('spotlight'); root.classList.remove('has-hover'); delete root.dataset.pointer
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(x => x !== calm)
      }
    })
  })

  it('a frame\'s name stays inside its frame, and above its first row when the map is small', async () => {
    reset()
    setupZoomControls()
    await withApp(async () => {
      const root = $.canvasRoot(), layer = $.framesLayer()
      const home = { parent: layer.parentNode, next: layer.nextSibling, css: layer.style.cssText, cls: layer.className }
      root.appendChild(layer); layer.style.cssText = ''; layer.classList.add('frames-layer')
      try {
        block('f1', { x: 0, y: 0, groupId: 'g1' }); block('f2', { x: 0, y: 220, groupId: 'g1' })
        state.groups = { g1: { id: 'g1', label: 'Why and what we believe about the old system and every tenant on it' } }
        renderFrames()
        const label = layer.querySelector('.frame-label'), frameEl = layer.querySelector('.frame')
        for (const z of [0.5, 0.3, 0.2]) {
          setZoom(z); applyTransform()
          const fr = frameEl.getBoundingClientRect(), lr = label.getBoundingClientRect()
          const first = document.getElementById('b-f1').getBoundingClientRect()
          assert.ok(lr.right <= fr.right + 0.5, `inside its frame at ${z} (${lr.right.toFixed(1)} vs ${fr.right.toFixed(1)})`)
          assert.ok(lr.bottom <= first.top + 1.5, `off the first row at ${z} (${lr.bottom.toFixed(1)} vs ${first.top.toFixed(1)})`)
          assert.eq(getComputedStyle(label).textOverflow, 'ellipsis')
        }
      } finally {
        state.groups = {}
        layer.replaceChildren()
        layer.style.cssText = home.css; layer.className = home.cls
        home.parent.insertBefore(layer, home.next)
      }
    })
  })

  it('a line holds one screen pixel at any zoom, and hover and selection stay heavier on screen', async () => {
    const lines = (px) => `<div class="canvas-root" style="--px:${px}px;--pxn:${px}"><svg width="10" height="10">` +
      '<g class="arrow-g"><path class="arrow-path" d="M0 0L9 9"/></g><g class="arrow-g hover"><path class="arrow-path" d="M0 0L9 9"/></g>' +
      '<g class="arrow-g sel"><path class="arrow-path" d="M0 0L9 9"/></g></svg></div>'
    for (const z of [1, 0.7, 0.5, 0.46, 0.3]) {
      const { root, done } = await shadow(lines(+(1 / z).toFixed(4)))
      try {
        const [rest, hover, sel] = [...root.querySelectorAll('.arrow-path')].map(p => parseFloat(getComputedStyle(p).strokeWidth) * z)
        assert.ok(rest >= 1 - 1e-3, `rest ${rest.toFixed(2)} screen px at ${z}`)
        assert.ok(hover > rest && sel > hover, `hover ${hover.toFixed(2)} and selection ${sel.toFixed(2)} above rest at ${z}`)
        if (z === 1) assert.deepEq([rest, hover, sel], [1.5, 2, 2.5], 'full size unchanged')
      } finally { done() }
    }
  })

  it('the tip opens toward the canvas: left near the right edge, above near the bottom', async () => {
    const vp = { left: 0, top: 0, right: 800, bottom: 600 }
    const card = (x, y) => ({ left: x, top: y, right: x + 66, bottom: y + 36 })
    assert.deepEq(tipSides(card(100, 100), vp), { x: '', y: '' })
    assert.deepEq(tipSides(card(700, 100), vp), { x: 'end', y: '' }, 'right edge')
    assert.deepEq(tipSides(card(100, 540), vp), { x: '', y: 'above' }, 'bottom edge')
    assert.deepEq(tipSides(card(20, 100), { ...vp, right: 120 }), { x: '', y: '' }, 'no better side: it stays')
    assert.eq(TIP_ROOM.w, 280, 'the CSS cap')
    reset()
    setupZoomControls()
    await withApp(async () => {
      block('near', { x: 0, y: 0 }); block('far', { x: 2400, y: 0 })
      setZoom(0.3); view.panX = 0; view.panY = 40; applyTransform()
      for (const id of ['near', 'far']) placeTip(document.getElementById('b-' + id))
      assert.eq(document.getElementById('b-near').dataset.tipX, undefined)
      assert.eq(document.getElementById('b-far').dataset.tipX, 'end', 'a card at the right edge opens its tip to the left')
      const far = document.getElementById('b-far')
      delete far.dataset.tipX
      // Held, as for a card focused where it is: the focus pan is not what this is about.
      withCameraHeld(() => far.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
      assert.eq(far.dataset.tipX, 'end', 'set as focus arrives')
    }, { w: 800, h: 600 })
  })

  it('the arrival hint names Fit where there is no key to press', () => {
    const orig = window.matchMedia
    const media = ({ fine, narrow }) => q => ({ matches: q.includes('any-pointer: fine') ? fine : q.includes('max-width') ? narrow : false,
      media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    try {
      window.matchMedia = media({ fine: true, narrow: false })
      assert.eq(arrivalHint(), ARRIVAL_HINT)
      assert.eq(ARRIVAL_HINT, 'Shift+1 shows all of it.')
      window.matchMedia = media({ fine: false, narrow: false })
      assert.eq(arrivalHint(), ARRIVAL_HINT_TOUCH, 'touch only')
      window.matchMedia = media({ fine: true, narrow: true })
      assert.eq(arrivalHint(), ARRIVAL_HINT_TOUCH, 'a phone')
      assert.eq(ARRIVAL_HINT_TOUCH, 'Fit shows all of it.')
    } finally { window.matchMedia = orig }
  })

  it('a zooming gesture lays faces out in quarter octaves and settles on the fine step when it rests', async () => {
    reset()
    setupZoomControls()
    const saved = { ...view }
    try {
      view.zoom = 0.7; applyLod({ exact: true })
      const ks = new Set()
      for (let i = 0; i < 40; i++) {
        view.zoom *= 0.98; applyTransform()
        const k = +$.canvasRoot().style.getPropertyValue('--lodk')
        ks.add(k)
        assert.ok(k * view.zoom >= 1 - 1e-6, `text never under its size (${(k * view.zoom).toFixed(3)})`)
        assert.ok(k * view.zoom < Math.pow(2, 1 / LOD_GESTURE_STEPS) + 1e-6, 'and at most a quarter octave over')
      }
      // 0.7 down to 0.31 is over an octave: about 19 fine steps, 5 coarse ones.
      assert.ok(ks.size <= 7, `${ks.size} layouts over 40 frames`)
      await sleep(LOD_SETTLE_MS + 80)
      assert.eq(+$.canvasRoot().style.getPropertyValue('--lodk'), +lodScale(view.zoom).toFixed(5), 'it settles on the fine step')
      view.zoom = 0.5; applyLod({ exact: true })
      assert.eq(+$.canvasRoot().style.getPropertyValue('--lodk'), +lodScale(0.5).toFixed(5), 'a jump lands on the fine step at once')
    } finally { Object.assign(view, saved); applyLod({ exact: true }) }
  })
})

// ── Arrival ─────────────────────────────────────────────────
describe('zoom: where a map lands', () => {
  it('the entry layer is the triggers, else the roots, else the first block in reading order', () => {
    reset()
    block('t', { type: 'terminator', x: 0 }); block('p', { type: 'problem', x: 300 }); block('c', { type: 'context', x: 0, y: 300 })
    block('end', { type: 'terminator', x: 900 })
    link('t', 'p'); link('c', 'p'); link('p', 'end')
    assert.deepEq(entryBlocks(['t', 'p', 'c', 'end']), ['t'], 'a trigger wins over another root')
    state.blocks.t.type = 'process'
    assert.deepEq(entryBlocks(['t', 'p', 'c', 'end']).sort(), ['c', 't'], 'every root')
    assert.deepEq(entryBlocks(['p', 'end']), ['p'], 'only arrows inside the set count')
    state.arrows = []
    assert.deepEq(entryBlocks(['p', 'c', 't']), ['t'], 'no arrows: the first in reading order')
    assert.deepEq(entryBlocks([]), [])
  })

  it('a map that reads whole lands whole, never past 100%', () => {
    reset()
    block('a', { x: 0, y: 0 }); block('b', { x: 300, y: 0 })
    const v = arrivalView(['a', 'b'], { w: 1200, h: 800 })
    assert.ok(v.whole)
    assert.ok(v.zoom <= 1 && v.zoom >= ARRIVAL_ZOOM, `${v.zoom}`)
  })

  it('a large map lands at 75% on its entry layer, inside the map', () => {
    reset()
    // A long left-to-right flow with its trigger at the far left.
    const ids = []
    for (let i = 0; i < 12; i++) { block('n' + i, { type: i ? 'process' : 'terminator', x: i * 320, y: (i % 3) * 160 }); ids.push('n' + i) }
    for (let i = 0; i < 11; i++) link('n' + i, 'n' + (i + 1))
    const W = 900, H = 700
    const v = arrivalView(ids, { w: W, h: H })
    assert.eq(v.zoom, ARRIVAL_ZOOM)
    assert.eq(v.whole, false)
    const { w, h } = getBlockDims('n0')
    const sx = state.blocks.n0.x * v.zoom + v.panX, sy = state.blocks.n0.y * v.zoom + v.panY
    assert.ok(sx >= 0 && sx + w * v.zoom <= W && sy >= 0 && sy + h * v.zoom <= H, 'the trigger is in view')
    assert.ok(sx <= 80 * v.zoom + 1, 'and the view starts at the map, not at empty canvas to its left')
    assert.ok(v.panY - (-0) <= H, 'sane')
  })

  it('arriveAt applies it and says Shift+1 shows the rest only when part of the map is off screen', async () => {
    reset()
    await withApp(async () => {
      for (let i = 0; i < 10; i++) block('m' + i, { x: i * 340 })
      const r = arriveAt(null, { lead: 'Big map added.' })
      assert.deepEq(r, { whole: false })
      assert.eq(view.zoom, ARRIVAL_ZOOM)
      assert.eq(currentLod(), 'full', 'arrival lands in the full band, whatever came before')
      assert.eq(document.querySelector('.toast-notification')?.textContent, `Big map added. ${ARRIVAL_HINT}`)
      reset()
      block('s', { x: 0 })
      arriveAt(['s'], { lead: 'Small map added.' })
      assert.eq(document.querySelector('.toast-notification')?.textContent, 'Small map added.')
      assert.ok(view.zoom <= 1)
      assert.eq(arrivalLead('Checkout 500s'), 'Checkout 500s added.')
      assert.eq(arrivalLead('Shared map', 'opened'), 'Shared map opened.')
    })
  })

  it('an embed keeps the whole-map fit: it is a figure on someone else\'s page', async () => {
    reset()
    await withApp(async () => {
      for (let i = 0; i < 10; i++) block('m' + i, { x: i * 340 })
      ui.embed = true
      try {
        const r = arriveAt()
        assert.deepEq(r, { whole: true })
        assert.ok(view.zoom < ARRIVAL_ZOOM, 'fitted, not landed')
      } finally { ui.embed = false }
    })
  })

  it('arriveAfterLoad runs after the frame an import scheduled', async () => {
    reset()
    await withApp(async () => {
      for (let i = 0; i < 10; i++) block('m' + i, { x: i * 340 })
      let fitted = false
      requestAnimationFrame(() => { view.zoom = 0.2; fitted = true })   // an import's own fit
      const r = await arriveAfterLoad(null)
      assert.ok(fitted)
      assert.eq(view.zoom, ARRIVAL_ZOOM, 'the arrival wins over the fit before it')
      assert.eq(r.whole, false)
    })
  })

  it('a large template lands readable on its trigger, arranged, with the hint', async () => {
    reset()
    // chrome.test.js may have wired the list already; a second listener would apply it twice.
    if (!document.querySelector('#templatesList .template-item')) setupTemplates()
    const tpl = TEMPLATES.find(t => t.large)
    await withApp(async () => {
      view.zoom = 0.4; view.panX = 0; view.panY = 0; applyTransform()
      const item = [...document.querySelectorAll('#templatesList .template-item')].find(el => el.textContent.includes(tpl.name))
      assert.ok(item, 'the template is listed')
      item.click()
      await sleep(TIDY_MS + 80)
      assert.eq(Object.keys(state.blocks).length, tpl.blocks.length)
      assert.eq(view.zoom, ARRIVAL_ZOOM, 'not the old whole-map fit')
      assert.eq(currentLod(), 'full')
      const toast = document.querySelector('.toast-notification')?.textContent || ''
      assert.includes(toast, tpl.name)
      assert.includes(toast, ARRIVAL_HINT)
      const trig = entryBlocks(Object.keys(state.blocks))[0]
      const b = state.blocks[trig], { w } = getBlockDims(trig)
      const sx = b.x * view.zoom + view.panX
      assert.ok(sx >= 0 && sx + w * view.zoom <= 800, 'its entry is on screen')
      assert.eq(getUndoHistory().length, 1, 'one click, one undo step')
    })
    reset()
  })
})

// ── Tidy's move ─────────────────────────────────────────────
describe('zoom: Tidy moves on a transform, and only with motion on', () => {
  it('with motion off (the default) it is instant: no transform, done at once', () => {
    reset()
    document.body.classList.remove('motion-on')
    block('a', { x: 0 })
    const before = positionsNow()
    state.blocks.a.x = 500; renderBlock('a')
    let done = false
    assert.eq(animateTidy(before, () => { done = true }), 0)
    assert.ok(done)
    assert.eq(document.getElementById('b-a').style.translate, '')
    assert.ok(!$.canvasRoot().classList.contains('tidy-glide'))
  })

  it('with motion on each card slides from where it was, on the house curve, and lands without overshoot', async () => {
    reset()
    await withApp(async () => {
      document.body.classList.add('motion-on')
      try {
        block('a', { x: 0 }); block('b', { x: 0, y: 200 })
        const before = positionsNow()
        state.blocks.a.x = 500; state.blocks.b.y = 0; renderAllBlocks()
        let done = false
        const ms = animateTidy(before, () => { done = true })
        if (!ms) return   // the system asks for reduced motion here: instant is right
        assert.eq(ms, TIDY_MS)
        assert.ok($.canvasRoot().classList.contains('tidy-glide'))
        const anims = document.getElementById('b-a').getAnimations()
        assert.ok(anims.some(a => a.transitionProperty === 'translate'), 'a translate transition, not left/top')
        const t = getComputedStyle(document.getElementById('b-a')).transition
        assert.includes(t, 'translate')
        assert.includes(t, 'cubic-bezier(0.25, 1, 0.5, 1)')
        assert.ok(!done)
        await sleep(TIDY_MS + 60)
        assert.ok(done, 'done once they arrived')
        assert.ok(!$.canvasRoot().classList.contains('tidy-glide'))
        assert.eq(document.getElementById('b-a').style.translate, '')
      } finally { document.body.classList.remove('motion-on') }
    })
  })

  it('the camera curve eases out with no overshoot', () => {
    let prev = 0
    for (let i = 1; i <= 20; i++) {
      const v = easeOut(i / 20)
      assert.ok(v >= prev && v <= 1, `monotonic at ${i}`)
      prev = v
    }
    assert.eq(easeOut(1), 1)
    assert.ok(easeOut(0.25) > 0.6, 'fast start, long settle')
  })

  it('runTidy is still one undo step and still fits the map when nothing asks it to land', async () => {
    reset()
    await withApp(async () => {
      document.body.classList.remove('motion-on')
      for (let i = 0; i < 6; i++) block('t' + i, { type: 'process', x: (i % 2) * 40, y: i * 30 })
      for (let i = 0; i < 5; i++) link('t' + i, 't' + (i + 1))
      view.zoom = 2; applyTransform()
      runTidy()
      assert.eq(getUndoHistory().length, 1)
      const fit = fitTarget()
      assert.ok(Math.abs(view.zoom - fit.zoom) < 1e-6, 'whole-map fit, as before')
    })
  })

  it('the stylesheet transitions no layout property for Tidy', async () => {
    const { css } = await realSheet()
    assert.ok(!/body\.tidying/.test(css), 'the left/top transition is gone')
    assert.match(css, /\.canvas-root\.tidy-glide > \.block \{ transition: translate var\(--dur-2\) var\(--ease-out\); \}/)
  })
})

// ── Hover fade ──────────────────────────────────────────────
describe('zoom: the hover fade', () => {
  it('fades unrelated cards to 60% and lines to 30%, after a 150ms dwell, and comes back at once', async () => {
    const { root, done } = await shadow(
      '<div class="canvas-root has-hover"><div class="block a"></div><div class="block related b"></div>' +
      '<svg><g class="arrow-g"></g><g class="arrow-g related"></g></svg></div>')
    try {
      const [plain, rel] = root.querySelectorAll('.block')
      const [line, relLine] = root.querySelectorAll('.arrow-g')
      assert.eq(getComputedStyle(plain).opacity, '0.6')
      assert.eq(getComputedStyle(rel).opacity, '1')
      assert.eq(getComputedStyle(line).opacity, '0.3')
      assert.eq(getComputedStyle(relLine).opacity, '1')
      assert.eq(getComputedStyle(plain).transitionDelay, '0.15s', 'the dwell')
      assert.eq(getComputedStyle(line).transitionDelay, '0.15s')
      root.querySelector('.canvas-root').classList.remove('has-hover')
      assert.eq(getComputedStyle(plain).transitionDelay, '0s', 'no wait to come back')
    } finally { done() }
  })

  it('never for a finger: a touch press turns the fade off', async () => {
    const { root, done } = await shadow(
      '<div class="canvas-root has-hover" data-pointer="touch"><div class="block"></div><svg><g class="arrow-g"></g></svg></div>')
    try {
      assert.eq(getComputedStyle(root.querySelector('.block')).opacity, '1')
      assert.eq(getComputedStyle(root.querySelector('.arrow-g')).opacity, '1')
    } finally { done() }
  })

  it('the canvas root records the kind of pointer that pressed last', () => {
    reset()
    setupZoomControls()
    const r = $.canvasRoot()
    r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    assert.eq(r.dataset.pointer, 'touch')
    // Lift it, or the canvas counts a finger still down and the next press is a pinch.
    r.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))
    r.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
    assert.eq(r.dataset.pointer, 'mouse')
  })
})

// ── Focus handed back ───────────────────────────────────────
describe('zoom: focus handed back leaves the camera alone', () => {
  // A card hanging off the right edge of an 800px viewport, focused without
  // a pan (as a click does), then something outside the canvas takes focus
  // and gives it back.
  async function scene(fn) {
    reset()
    setupTabNavigation()
    setupKeyboardShortcuts()
    await withFocusEvents(() => withApp(async () => {
      block('edge', { x: 760, y: 200 })
      view.zoom = 1; view.panX = 0; view.panY = 0; applyTransform()
      const el = document.getElementById('b-edge')
      withCameraHeld(() => el.focus({ preventScroll: true }))
      assert.eq(document.activeElement, el)
      assert.eq(view.panX, 0, 'held: no pan yet')
      await fn(el)
    }))
    reset()
  }
  const escape = target => (target || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  // Longer than the 100ms in which focus coming back counts as moving
  // within its card (a title editor closing): a person reads the menu first.
  const linger = () => sleep(150)

  it('Escape from a context menu puts focus back on the card without moving the camera', () => scene(async el => {
    const menu = openBlockMenu('edge', 790, 210)
    assert.ok(menu && isMenuOpen())
    await linger()
    const before = JSON.stringify(view)
    escape(document.activeElement || menu.el)
    assert.ok(!isMenuOpen(), 'Escape closed it')
    assert.eq(document.activeElement, el, 'focus went back to the card')
    assert.eq(JSON.stringify(view), before, 'and the camera did not move')
  }))

  it('so does closing the shortcut sheet', () => scene(async el => {
    openShortcuts()
    const close = document.createElement('button')
    $.shortcutOverlay().appendChild(close)
    try {
      close.focus()
      assert.eq(document.activeElement, close, 'the sheet has focus')
      await linger()
      const before = JSON.stringify(view)
      closeShortcuts()   // what its Escape and close button run
      assert.eq(document.activeElement, el, 'focus went back to the card')
      assert.eq(JSON.stringify(view), before, 'and the camera did not move')
    } finally { closeShortcuts(); close.remove() }
  }))

  it('and closing Find', () => scene(async el => {
    const input = $.searchInput(), was = input.style.cssText
    input.style.cssText = 'position:fixed;left:-500px;top:0'
    try {
      openSearch()
      assert.eq(document.activeElement, input, 'Find has focus')
      await linger()
      const before = JSON.stringify(view)
      closeSearch()   // what its Escape runs
      assert.eq(document.activeElement, el, 'focus went back to the card')
      assert.eq(JSON.stringify(view), before, 'and the camera did not move')
    } finally { closeSearch({ restoreFocus: false }); input.style.cssText = was }
  }))

  it('focus coming back after the camera moved, or by Tab, is an arrival and still pans', () => scene(async el => {
    const other = document.createElement('button')
    document.body.appendChild(other)
    try {
      other.focus()
      view.panX = 20; applyTransform()
      await linger()
      el.focus({ preventScroll: true })
      assert.ok(view.panX < 20, 'the camera moved while it was away: it pans the card into view')
      // Focused where it hangs off the edge (as a click leaves it), then away
      // and back with the camera untouched: a return.
      other.focus()
      view.panX = 0; applyTransform()
      withCameraHeld(() => el.focus({ preventScroll: true }))
      other.focus()
      await linger()
      el.focus({ preventScroll: true })
      assert.eq(view.panX, 0, 'unmoved, it is a return')
      other.focus()
      await linger()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      el.focus({ preventScroll: true })
      assert.ok(view.panX < 0, 'a Tab onto it is an arrival')
    } finally { other.remove() }
  }))
})

// ── Minimap ─────────────────────────────────────────────────
describe('zoom: the minimap', () => {
  it('frames the map and the visible part together, with a margin', () => {
    reset()
    const blocks = { a: { x: 0, y: 0 }, b: { x: 900, y: 400 } }
    const size = () => ({ w: 100, h: 50 })
    assert.deepEq(contentBounds(blocks, size), { x: 0, y: 0, w: 1000, h: 450 })
    assert.eq(contentBounds({}, size), null)
    const vis = visibleWorld({ zoom: 0.5, panX: -100, panY: 50 }, { w: 800, h: 600 })
    assert.deepEq(vis, { x: 200, y: -100, w: 1600, h: 1200 })
    const box = minimapBounds({ x: 0, y: 0, w: 1000, h: 450 }, vis)
    assert.deepEq(box, { x: -60, y: -160, w: 1920, h: 1320 })
    assert.deepEq(panForWorldOrigin(200, -100, 0.5), { panX: -100, panY: 50 }, 'the inverse of visibleWorld')
  })

  it('is off until asked for, then draws one rectangle per block and a frame for the view', async () => {
    reset()
    setupMinimap()
    await withApp(async () => {
      block('a', { x: 0, y: 0, type: 'goal' }); block('b', { x: 600, y: 300, type: 'risk', color: '#c026d3' })
      setMinimap(false)
      const el = document.getElementById('minimap')
      assert.ok(el, 'mounted in the canvas')
      assert.ok(el.hidden, 'off by default')
      setMinimap(true)
      assert.ok(isMinimapOn())
      assert.ok(!el.hidden)
      assert.eq(el.getAttribute('aria-hidden'), 'true', 'a pointer aid: Fit and zoom to selection are its keys')
      assert.ok(el.hasAttribute('data-canvas-ui'))
      const r = el.getBoundingClientRect()
      assert.eq(Math.round(r.width), MINIMAP_SIZE.w); assert.eq(Math.round(r.height), MINIMAP_SIZE.h)
      const rects = el.querySelectorAll('.minimap-b')
      assert.eq(rects.length, 2)
      assert.eq(rects[0].style.getPropertyValue('--mm-type'), 'var(--c-goal)', 'the type colour')
      assert.ok(rects[1].classList.contains('has-color'), 'or the card\'s own colour')
      const vis = visibleWorld()
      const frameRect = el.querySelector('.minimap-frame')
      const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} vs ${b}`)
      near(+frameRect.getAttribute('x'), vis.x); near(+frameRect.getAttribute('width'), vis.w)
      view.panX -= 100; applyTransform()
      near(+frameRect.getAttribute('x'), visibleWorld().x, 'the frame follows every pan')
      assert.eq(localStorage.getItem('pathfinder-minimap'), '1', 'remembered in this browser')
      toggleMinimap()
      assert.ok(el.hidden)
      assert.eq(localStorage.getItem('pathfinder-minimap'), '0')
    })
  })

  it('dragging the frame pans the canvas, and a click elsewhere jumps there', async () => {
    reset()
    setupMinimap()
    await withApp(async () => {
      for (let i = 0; i < 6; i++) block('m' + i, { x: i * 400, y: (i % 2) * 300 })
      view.zoom = 0.5; view.panX = 0; view.panY = 0; applyTransform()
      setMinimap(true)
      const svg = document.querySelector('#minimap svg')
      const m = svg.getScreenCTM()
      const toScreen = (x, y) => new DOMPoint(x, y).matrixTransform(m)
      const vis = visibleWorld()
      const start = toScreen(vis.x + vis.w / 2, vis.y + vis.h / 2)
      const end = toScreen(vis.x + vis.w / 2 + 200, vis.y + vis.h / 2)
      const ev = (type, p) => svg.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, button: 0,
        buttons: type === 'pointerup' ? 0 : 1, clientX: p.x, clientY: p.y, pointerType: 'mouse', isPrimary: true }))
      ev('pointerdown', start); ev('pointermove', end); ev('pointerup', end)
      assert.ok(Math.abs(visibleWorld().x - (vis.x + 200)) < 1, `the view moved 200 world px (${visibleWorld().x - vis.x})`)
      assert.eq(view.zoom, 0.5, 'a drag pans, it never zooms')
      // Click far right: that point becomes the middle of the view.
      const target = { x: 2000, y: 100 }
      const p = toScreen(target.x, target.y)
      const m2 = svg.getScreenCTM()
      const p2 = new DOMPoint(target.x, target.y).matrixTransform(m2)
      ev('pointerdown', p2); ev('pointerup', p2)
      const v2 = visibleWorld()
      assert.ok(Math.abs(v2.x + v2.w / 2 - target.x) < 2 && Math.abs(v2.y + v2.h / 2 - target.y) < 2, 'centred on the click')
      assert.ok(p, 'mapped')
      setMinimap(false)
    })
  })

  it('follows a drag: a card dragged on the canvas moves its rectangle once the drag is saved', async () => {
    reset()
    setupMinimap()
    setupCanvasPointerEvents()
    await withApp(async () => {
      block('a', { x: 40, y: 40 }); block('b', { x: 500, y: 300 })
      view.zoom = 1; view.panX = 0; view.panY = 0; applyTransform()
      setMinimap(true)
      const rects = () => [...document.querySelectorAll('#minimap .minimap-b')].map(r => r.getAttribute('x') + ',' + r.getAttribute('y')).sort()
      const blocks = () => Object.values(state.blocks).map(b => b.x + ',' + b.y).sort()
      assert.deepEq(rects(), blocks())
      const t = document.querySelector('#b-a .block-title'), r = t.getBoundingClientRect()
      const ptr = (type, x, y) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 21, button: 0,
        buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, isPrimary: true, pointerType: 'mouse' }))
      ptr('pointerdown', r.x + 6, r.y + 4); ptr('pointermove', r.x + 16, r.y + 10); ptr('pointermove', r.x + 86, r.y + 54); ptr('pointerup', r.x + 86, r.y + 54)
      assert.ok(state.blocks.a.x !== 40, 'it moved')
      await sleep(450); await frame()
      assert.deepEq(rects(), blocks(), 'the minimap followed the drag')
      // The contract underneath: any saved change, announced or not, with
      // nothing added to or taken off the canvas.
      state.blocks.b.x = 900; state.blocks.b.y = 20
      saveState()
      await frame()
      assert.deepEq(rects(), blocks(), 'a save alone redraws it')
      setMinimap(false)
    })
  })

  it('M toggles it from the canvas, never while typing; View and the zoom menu offer it with its key', async () => {
    reset()
    setupMinimap()
    await withApp(async () => {
      block('a', { x: 0 })
      setMinimap(false)
      const press = (target = document.body) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true }))
      press()
      assert.ok(isMinimapOn(), 'M with the canvas (or nothing) focused')
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      press(input)
      assert.ok(isMinimapOn(), 'typing an m is typing')
      input.remove()
      press()
      assert.ok(!isMinimapOn())
      const item = viewMenuItems().find(i => i.label === 'Minimap')
      assert.ok(item, 'View lists it')
      assert.eq(item.shortcut, 'M')
      const anchor = document.createElement('button'); document.body.appendChild(anchor)
      try {
        openZoomMenu(anchor)
        const row = [...document.querySelectorAll('.pf-menu.zoom-menu .pf-menu-item')].find(r => r.textContent.includes('Minimap'))
        assert.ok(row, 'the zoom menu lists it')
      } finally { closeMenus(); anchor.remove() }
      assert.ok(SHORTCUTS.flatMap(g => g.keys).some(([k, d]) => k === 'M' && /minimap/i.test(d)), 'the shortcut sheet lists M')
    })
  })

  it('never in an embed, and not offered there', () => {
    reset()
    ui.embed = true
    try {
      assert.eq(minimapAvailable(), false)
      assert.ok(!viewMenuItems().some(i => i.label === 'Minimap'))
      setMinimap(true); refreshMinimap()
      assert.ok(document.getElementById('minimap').hidden)
    } finally { ui.embed = false; setMinimap(false) }
  })

  it('the stylesheet keeps it flat, in the corner, hidden on phones and in embeds', async () => {
    const { css } = await realSheet()
    const zoom = css.slice(css.indexOf('/* ════ [zoom] ════ */'), css.indexOf('/* ════ [command] ════ */'))
    assert.match(zoom, /\.minimap \{[^}]*background: var\(--surface-1\);[^}]*border: 1px solid var\(--border\);/)
    assert.ok(!/\.minimap \{[^}]*box-shadow/.test(zoom), 'flat: no shadow')
    assert.match(zoom, /@media \(max-width: 700px\) \{ \.minimap \{ display: none; \} \}/)
    assert.match(zoom, /\.embed-mode \.minimap \{ display: none; \}/)
    assert.ok(!/var\(--c-[a-z]+\)/.test(zoom), 'type colours arrive inline from the registry, never from a rule')
  })
})
