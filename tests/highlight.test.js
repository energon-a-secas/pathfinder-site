// ============================================================
//  highlight.test.js -- Presentation highlights and Spotlight.
//
//  These are emphasis, not meaning: the rules that matter are
//  that they survive a share and that they reach the exported
//  image, since sharing is the only reason to set one.
// ============================================================

import { describe, it, assert, mockBlockEl, cleanupMockEls } from './test-utils.js'
import { state, canvasMeta } from '../js/state.js'
import { normalizeBlock, normalizeCanvas } from '../js/normalize.js'
import { selectionHighlight, highlightRowHtml } from '../js/render.js'
import { buildSvg } from '../js/image-export.js'
import { HIGHLIGHTS } from '../js/utils.js'

function reset() {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  canvasMeta.cardStyle = 'outline'
  canvasMeta.spotlight = false
}

function addBlock(id, opts = {}) {
  state.blocks[id] = {
    id, type: opts.type || 'goal', title: opts.title || id,
    description: '', notes: '', x: opts.x || 0, y: opts.y || 0,
    actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null,
    cardStyle: null, borderWidth: null, highlight: opts.highlight || null,
  }
  mockBlockEl(id, { width: 220, height: 100 })
}

describe('normalizeBlock() -- highlight', () => {
  it('defaults to no highlight', () => {
    assert.eq(normalizeBlock({ id: 'a', type: 'goal' }).highlight, null)
  })

  it('keeps a known highlight', () => {
    assert.eq(normalizeBlock({ id: 'a', type: 'goal', highlight: 'alert' }).highlight, 'alert')
  })

  it('keeps the festive one', () => {
    assert.eq(normalizeBlock({ id: 'a', type: 'goal', highlight: 'festive' }).highlight, 'festive')
  })

  it('drops an unknown highlight', () => {
    assert.eq(normalizeBlock({ id: 'a', type: 'goal', highlight: 'neon' }).highlight, null)
  })
})

describe('normalizeCanvas() -- spotlight', () => {
  it('is off by default', () => {
    assert.eq(normalizeCanvas({ blocks: [], arrows: [] }).meta.spotlight, false)
  })

  it('round-trips when on', () => {
    assert.eq(normalizeCanvas({ blocks: [], arrows: [], meta: { spotlight: true } }).meta.spotlight, true)
  })

  it('coerces a junk value to a boolean', () => {
    assert.eq(normalizeCanvas({ blocks: [], arrows: [], meta: { spotlight: 'yes' } }).meta.spotlight, true)
  })

  it('survives a full share round-trip with highlights intact', () => {
    // The whole point of a highlight is the moment somebody else opens the
    // link, so this is the test that actually matters.
    const payload = {
      blocks: [{ id: 'a', type: 'problem', highlight: 'alert', x: 0, y: 0 }],
      arrows: [],
      meta: { spotlight: true },
    }
    const round = normalizeCanvas(JSON.parse(JSON.stringify(payload)))
    assert.eq(round.blocks.a.highlight, 'alert')
    assert.eq(round.meta.spotlight, true)
  })
})

describe('selectionHighlight()', () => {
  it('reports null when nothing in the selection is highlighted', () => {
    reset(); addBlock('a'); addBlock('b')
    assert.eq(selectionHighlight(['a', 'b']), null)
  })

  it('reports the shared value when the selection agrees', () => {
    reset(); addBlock('a', { highlight: 'go' }); addBlock('b', { highlight: 'go' })
    assert.eq(selectionHighlight(['a', 'b']), 'go')
  })

  it('reports mixed rather than picking one', () => {
    reset(); addBlock('a', { highlight: 'go' }); addBlock('b', { highlight: 'alert' })
    assert.eq(selectionHighlight(['a', 'b']), 'mixed')
  })

  it('counts "some highlighted" as mixed', () => {
    reset(); addBlock('a', { highlight: 'go' }); addBlock('b')
    assert.eq(selectionHighlight(['a', 'b']), 'mixed')
  })
})

describe('highlightRowHtml()', () => {
  it('offers every highlight plus a way to clear', () => {
    const html = highlightRowHtml(null)
    Object.keys(HIGHLIGHTS).forEach(k => assert.includes(html, `data-hl="${k}"`))
    assert.includes(html, 'data-hl=""')
  })

  it('marks the active one, and only it', () => {
    const html = highlightRowHtml('alert')
    assert.eq((html.match(/class="hl-swatch[^"]*active/g) || []).length, 1)
    assert.match(html, /data-hl="alert"[^>]*/)
  })
})

describe('buildSvg() -- highlights reach the export', () => {
  it('draws a ring for a highlighted block', () => {
    reset()
    addBlock('a', { type: 'problem', highlight: 'alert' })
    const { svg } = buildSvg()
    assert.includes(svg, HIGHLIGHTS.alert.color)
  })

  it('draws nothing extra for an unhighlighted block', () => {
    reset()
    addBlock('a', { type: 'problem' })
    const plain = new DOMParser().parseFromString(buildSvg().svg, 'image/svg+xml')
      .querySelectorAll('rect').length
    addBlock('b', { type: 'problem', highlight: 'focus', y: 400 })
    const withRing = new DOMParser().parseFromString(buildSvg().svg, 'image/svg+xml')
      .querySelectorAll('rect').length
    // One more card, plus its ring.
    assert.eq(withRing, plain + 2)
  })

  it('exports the festive border as a static dash, since a raster cannot animate', () => {
    reset()
    addBlock('a', { highlight: 'festive' })
    assert.includes(buildSvg().svg, 'stroke-dasharray="9 9"')
  })

  it('fades unhighlighted blocks when Spotlight is on', () => {
    reset()
    addBlock('a', { highlight: 'alert' })
    addBlock('b', { y: 400 })
    canvasMeta.spotlight = true
    const { svg } = buildSvg()
    canvasMeta.spotlight = false
    assert.includes(svg, 'opacity="0.3"')
  })

  it('ignores Spotlight when nothing is highlighted', () => {
    // Otherwise turning it on with an empty selection would fade the entire
    // diagram to nothing, which is never what anyone meant.
    reset()
    addBlock('a'); addBlock('b', { y: 400 })
    canvasMeta.spotlight = true
    const { svg } = buildSvg()
    canvasMeta.spotlight = false
    assert.notIncludes(svg, 'opacity="0.3"')
  })
})
