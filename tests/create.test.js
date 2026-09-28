// ============================================================
//  create.test.js -- creation helpers (js/create.js) and the
//  implied-verb table they use (js/relations.js impliedVerb)
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, selection, getUndoHistory, getRedoFuture } from '../js/state.js'
import { TYPES, DEFAULT_WIDTH } from '../js/utils.js'
import { undo, deselectAll } from '../js/render.js'
import { createBlockAt, createConnected, insertOnArrow, suggestedNextTypes,
         defaultConnectDirection, applyGapFix } from '../js/create.js'
import { impliedVerb } from '../js/relations.js'
import { commitInlineEdit, isInlineEditing } from '../js/inline-edit.js'

// Blocks in the test page are not laid out, so creation falls back to the
// default card size. Overlap is checked against the same numbers.
const W = DEFAULT_WIDTH, H = 100

function reset() {
  if (isInlineEditing()) commitInlineEdit()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  deselectAll()
}

function block(id, type, x, y, extra = {}) {
  state.blocks[id] = { id, type, title: id, description: '', notes: '', x, y,
    actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, ...extra }
}

const dump = () => JSON.stringify({ blocks: state.blocks, arrows: state.arrows, groups: state.groups })

function overlaps(a, b) {
  return a.x < b.x + W && a.x + W > b.x && a.y < b.y + H && a.y + H > b.y
}

describe('impliedVerb()', () => {
  it('names the verb for every pair in the methodology table', () => {
    assert.eq(impliedVerb('implementation', 'requirement'), 'satisfies')
    assert.eq(impliedVerb('implementation', 'output'), 'produces')
    assert.eq(impliedVerb('implementation', 'metric'), 'should move')
    assert.eq(impliedVerb('resource', 'metric'), 'source of')
    assert.eq(impliedVerb('terminator', 'process'), 'triggers')
    assert.eq(impliedVerb('terminator', 'implementation'), 'triggers')
    assert.eq(impliedVerb('metric', 'goal'), 'measures')
    assert.eq(impliedVerb('output', 'stakeholder'), 'delivered to')
    assert.eq(impliedVerb('stakeholder', 'goal'), 'owns')
    assert.eq(impliedVerb('risk', 'decision'), 'mitigated by')
  })

  it('returns an empty string for reversed or unknown pairs', () => {
    assert.eq(impliedVerb('goal', 'metric'), '')
    assert.eq(impliedVerb('decision', 'risk'), '')
    assert.eq(impliedVerb('goal', 'goal'), '')
    assert.eq(impliedVerb(undefined, 'goal'), '')
  })
})

describe('suggestedNextTypes() and defaultConnectDirection()', () => {
  it('only suggests types that exist, in table order', () => {
    const s = suggestedNextTypes('goal')
    assert.ok(s.length > 0)
    s.forEach(t => assert.ok(Object.hasOwn(TYPES, t), t + ' is a real type'))
    assert.ok(s.indexOf('requirement') < s.indexOf('problem'))
    assert.deepEq(suggestedNextTypes('no-such-type'), [])
  })

  it('points the new connection the way the implied verb reads', () => {
    assert.eq(defaultConnectDirection('goal', 'metric'), 'in', 'metric -> goal: measures')
    assert.eq(defaultConnectDirection('decision', 'risk'), 'in', 'risk -> decision: mitigated by')
    assert.eq(defaultConnectDirection('implementation', 'output'), 'out', 'implementation -> output: produces')
    assert.eq(defaultConnectDirection('goal', 'requirement'), 'out', 'no verb either way')
  })
})

describe('createBlockAt()', () => {
  it('centres the block on the world point, selects it, and is one undo step', () => {
    reset()
    const before = dump()
    const id = createBlockAt('goal', 500, 300, { edit: false })
    const b = state.blocks[id]
    assert.eq(b.type, 'goal')
    assert.eq(b.x, 500 - W / 2)
    assert.eq(b.y, 300 - H / 2)
    assert.eq(selection.blockId, id)
    assert.eq(getUndoHistory().length, 1)
    undo()
    assert.eq(dump(), before)
  })

  it('centres on the selected card, which can be taller than an unselected one', () => {
    reset()
    // Stand in for the app's CSS: a selected card with an empty description
    // shows a hint line and grows. Measured before selecting, the new card
    // landed 12px low.
    const vp = document.getElementById('canvasViewport')
    const prev = vp.style.display
    const css = document.createElement('style')
    css.textContent = '#canvasRoot .block { height: 100px } #canvasRoot .block.selected { height: 124px }'
    document.head.appendChild(css)
    vp.style.display = 'block'
    try {
      const id = createBlockAt('risk', 500, 500, { edit: false })
      const b = state.blocks[id]
      assert.eq(selection.blockId, id)
      assert.eq(b.y + 124 / 2, 500, 'vertical centre on the pointer')
      assert.eq(b.x + W / 2, 500, 'horizontal centre on the pointer')
    } finally {
      vp.style.display = prev
      css.remove()
    }
  })

  it('refuses in read-only and for unknown types', () => {
    reset()
    ui.readOnly = true
    assert.eq(createBlockAt('goal', 0, 0, { edit: false }), null)
    ui.readOnly = false
    assert.eq(createBlockAt('not-a-type', 0, 0, { edit: false }), null)
    assert.eq(Object.keys(state.blocks).length, 0)
  })
})

describe('createConnected()', () => {
  it('places the block 80px beyond the side and connects from -> new', () => {
    reset()
    block('a', 'goal', 0, 0)
    const id = createConnected('a', 'requirement', { edit: false })
    const b = state.blocks[id]
    assert.eq(b.x, W + 80)
    assert.eq(b.y, 0)
    assert.eq(state.arrows.length, 1)
    assert.eq(state.arrows[0].from, 'a')
    assert.eq(state.arrows[0].to, id)
  })

  it('slides along the side until it overlaps no existing block', () => {
    reset()
    block('a', 'goal', 0, 0)
    block('c', 'problem', W + 80, 0)        // sits exactly where the new block wants to go
    block('d', 'problem', W + 80, 110)      // and the next slot down too
    const id = createConnected('a', 'requirement', { edit: false })
    const b = state.blocks[id]
    assert.eq(b.x, W + 80, 'stays on the right side')
    Object.values(state.blocks).forEach(o => {
      if (o.id !== id) assert.ok(!overlaps(b, o), 'overlaps ' + o.id)
    })
  })

  it('stacks repeated creations instead of piling them up', () => {
    reset()
    block('a', 'goal', 0, 0)
    const one = createConnected('a', 'requirement', { edit: false })
    const two = createConnected('a', 'requirement', { edit: false })
    assert.ok(!overlaps(state.blocks[one], state.blocks[two]))
  })

  it('honours up, down and left', () => {
    reset()
    block('a', 'goal', 1000, 1000)
    const up = createConnected('a', 'requirement', { dir: 'up', edit: false })
    const down = createConnected('a', 'requirement', { dir: 'down', edit: false })
    const left = createConnected('a', 'requirement', { dir: 'left', edit: false })
    assert.eq(state.blocks[up].y, 1000 - 80 - H)
    assert.eq(state.blocks[down].y, 1000 + H + 80)
    assert.eq(state.blocks[left].x, 1000 - 80 - W)
  })

  it('is one undo step that restores the canvas exactly', () => {
    reset()
    block('a', 'goal', 0, 0)
    block('b', 'problem', 400, 0)
    state.arrows.push({ id: 'x', from: 'b', to: 'a', style: 'routed', bidirectional: false, color: null, weight: 2, fromPort: null, toPort: null })
    const before = dump()
    createConnected('a', 'requirement', { edit: false })
    assert.eq(getUndoHistory().length, 1, 'one snapshot for block + arrow')
    undo()
    assert.eq(dump(), before)
  })

  it('defaults to from -> new as the contract says (incoming = false)', () => {
    reset()
    block('d', 'decision', 0, 0)
    const id = createConnected('d', 'risk', { edit: false })
    assert.eq(state.arrows[0].from, 'd', 'decision -> risk, no inference unless asked')
    assert.eq(state.arrows[0].to, id)
    reset()
    block('g', 'goal', 0, 0)
    const m = createConnected('g', 'metric', { edit: false })
    assert.eq(state.arrows[0].from, 'g')
    assert.eq(state.arrows[0].to, m)
  })

  it("infers the direction from the implied verb with incoming: 'auto'", () => {
    reset()
    block('d', 'decision', 0, 0)
    const id = createConnected('d', 'risk', { incoming: 'auto', edit: false })
    assert.eq(state.arrows[0].from, id, 'risk -> decision')
    assert.eq(state.arrows[0].to, 'd')
    reset()
    block('i', 'implementation', 0, 0)
    const o = createConnected('i', 'output', { incoming: 'auto', edit: false })
    assert.eq(state.arrows[0].from, 'i', 'implementation -> output: produces')
    assert.eq(state.arrows[0].to, o)
  })

  it('an explicit incoming wins over the inference', () => {
    reset()
    block('d', 'decision', 0, 0)
    const id = createConnected('d', 'risk', { incoming: false, edit: false })
    assert.eq(state.arrows[0].from, 'd')
    assert.eq(state.arrows[0].to, id)
  })

  it('carries a relation onto the new arrow', () => {
    reset()
    block('a', 'goal', 0, 0)
    createConnected('a', 'requirement', { relation: 'informs', edit: false })
    assert.eq(state.arrows[0].relation, 'informs')
  })
})

describe('insertOnArrow()', () => {
  it('splits A -> B into A -> new -> B, keeping the relation on both halves', () => {
    reset()
    block('a', 'goal', 0, 0)
    block('b', 'output', 600, 0)
    state.arrows.push({ id: 'ab', from: 'a', to: 'b', style: 'curved', bidirectional: false,
      color: '#f87171', weight: 3, fromPort: 'right', toPort: 'left', relation: 'depends-on', label: 'needs' })
    const id = insertOnArrow('ab', 'process')
    if (isInlineEditing()) commitInlineEdit()
    assert.ok(id)
    assert.eq(state.arrows.length, 2)
    const first = state.arrows.find(x => x.from === 'a')
    const second = state.arrows.find(x => x.to === 'b')
    assert.eq(first.to, id)
    assert.eq(second.from, id)
    assert.eq(first.relation, 'depends-on')
    assert.eq(second.relation, 'depends-on')
    assert.eq(first.fromPort, 'right', 'the kept end keeps its pin')
    assert.eq(second.toPort, 'left')
    assert.eq(second.color, '#f87171')
    assert.eq(first.label, 'needs')
    assert.eq(second.label, '')
    const nb = state.blocks[id]
    assert.ok(nb.x > 0 && nb.x < 600, 'new block sits between the two')
  })

  it('is one undo step', () => {
    reset()
    block('a', 'goal', 0, 0)
    block('b', 'output', 600, 0)
    state.arrows.push({ id: 'ab', from: 'a', to: 'b', style: 'routed', bidirectional: false, color: null, weight: 2, fromPort: null, toPort: null })
    const before = dump()
    insertOnArrow('ab', 'process')
    if (isInlineEditing()) commitInlineEdit()
    assert.eq(getUndoHistory().length, 1)
    undo()
    assert.eq(dump(), before)
  })
})

describe('applyGapFix()', () => {
  it('a generic create fix links in the requested direction', () => {
    reset()
    block('p', 'problem', 0, 0)
    const out = applyGapFix({ id: 'x', create: { type: 'decision', dir: 'out' } }, 'p')
    if (isInlineEditing()) commitInlineEdit()
    assert.eq(state.blocks[out].type, 'decision')
    assert.ok(state.arrows.some(a => a.from === 'p' && a.to === out))
    const inc = applyGapFix({ id: 'y', create: { type: 'requirement', dir: 'in' } }, 'p')
    if (isInlineEditing()) commitInlineEdit()
    assert.ok(state.arrows.some(a => a.from === inc && a.to === 'p'))
  })

  it('legacy ids still work: add-req links requirement -> goal', () => {
    reset()
    block('g', 'goal', 0, 0)
    const id = applyGapFix('add-req', 'g')
    if (isInlineEditing()) commitInlineEdit()
    assert.eq(state.blocks[id].type, 'requirement')
    assert.ok(state.arrows.some(a => a.from === id && a.to === 'g'))
    assert.eq(getUndoHistory().length, 1)
  })

  it('resolve adds the action as one undo step', () => {
    reset()
    block('p', 'problem', 0, 0)
    applyGapFix({ id: 'resolve' }, 'p')
    assert.deepEq(state.blocks.p.actions, ['resolve'])
    assert.eq(getUndoHistory().length, 1)
    undo()
    assert.deepEq(state.blocks.p.actions, [])
  })
})
