// ============================================================
//  image-export.test.js -- Tests for js/image-export.js
//  Validates the diagram SVG builder (buildSvg).
// ============================================================

import { describe, it, assert, mockBlockEl, cleanupMockEls } from './test-utils.js'
import { state, ui } from '../js/state.js'
import { buildSvg } from '../js/image-export.js'

function reset() {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.lightMode = false
}

function addBlock(id, type, title, opts = {}) {
  state.blocks[id] = {
    id, type, title,
    description: opts.description || '', notes: '',
    x: opts.x ?? 0, y: opts.y ?? 0,
    actions: [], questions: [],
    width: opts.width || null, color: opts.color || null,
    collapsed: !!opts.collapsed, groupId: opts.groupId || null,
    status: opts.status || null, priority: opts.priority || null,
  }
  mockBlockEl(id, { width: opts.width || 220, height: opts.height || 100 })
}

describe('buildSvg() -- empty canvas', () => {
  it('returns null when there are no blocks', () => {
    reset()
    assert.eq(buildSvg(), null)
  })
})

describe('buildSvg() -- structure', () => {
  it('produces a well-formed <svg> with width and height', () => {
    reset()
    addBlock('g1', 'goal', 'Ship v2')
    const { svg, width, height } = buildSvg()
    assert.match(svg, /^<svg /)
    assert.match(svg, /<\/svg>$/)
    assert.gt(width, 0)
    assert.gt(height, 0)
    // Parses without error in a real DOM parser
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    assert.ok(!doc.querySelector('parsererror'), 'SVG should parse without error')
  })

  it('includes a rect + title text for each block', () => {
    reset()
    addBlock('g1', 'goal', 'Alpha')
    addBlock('r1', 'requirement', 'Beta')
    const { svg } = buildSvg()
    assert.includes(svg, 'Alpha')
    assert.includes(svg, 'Beta')
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    // background rect + 2 card rects + 2 accent bars = 5 rects minimum
    assert.gte(doc.querySelectorAll('rect').length, 5)
  })

  it('renders one path per valid arrow', () => {
    reset()
    addBlock('g1', 'goal', 'A', { x: 0, y: 0 })
    addBlock('r1', 'requirement', 'B', { x: 400, y: 0 })
    state.arrows.push({ id: 'a1', from: 'g1', to: 'r1', style: 'curved', weight: 2, fromPort: null, toPort: null })
    const doc = new DOMParser().parseFromString(buildSvg().svg, 'image/svg+xml')
    assert.eq(doc.querySelectorAll('path').length, 1)
  })

  it('escapes HTML-special characters in titles', () => {
    reset()
    addBlock('g1', 'goal', 'A & B <danger>')
    const { svg } = buildSvg()
    assert.includes(svg, 'A &amp; B &lt;danger&gt;')
    assert.notIncludes(svg, '<danger>')
  })

  it('splits multi-line descriptions across separate text lines', () => {
    reset()
    addBlock('r1', 'requirement', 'Definition', { description: 'Overview\nScope\nTimeline', width: 200, height: 140 })
    const { svg } = buildSvg()
    assert.includes(svg, 'Overview')
    assert.includes(svg, 'Scope')
    assert.includes(svg, 'Timeline')
  })

  it('renders arrow labels and notes when present', () => {
    reset()
    addBlock('g1', 'goal', 'A', { x: 0, y: 0 })
    addBlock('r1', 'requirement', 'B', { x: 400, y: 0 })
    state.arrows.push({ id: 'a1', from: 'g1', to: 'r1', style: 'curved', weight: 2, label: 'yes', note: 'only if approved', fromPort: null, toPort: null })
    const { svg } = buildSvg()
    assert.includes(svg, 'yes')
    assert.includes(svg, 'only if approved')
  })

  it('skips arrows that reference a missing block without throwing', () => {
    reset()
    addBlock('g1', 'goal', 'A')
    state.arrows.push({ id: 'a1', from: 'g1', to: 'ghost', style: 'curved', weight: 2, fromPort: null, toPort: null })
    const doc = new DOMParser().parseFromString(buildSvg().svg, 'image/svg+xml')
    assert.eq(doc.querySelectorAll('path').length, 0)
  })

  it('includes the canvas title watermark', () => {
    reset()
    addBlock('g1', 'goal', 'A')
    // canvasMeta is module state; import lazily to set it
    return import('../js/state.js').then(({ canvasMeta }) => {
      canvasMeta.title = 'My Diagram'
      assert.includes(buildSvg().svg, 'My Diagram')
      canvasMeta.title = ''
    })
  })
})
