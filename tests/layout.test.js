// ============================================================
//  layout.test.js -- Tests for js/layout.js (layered layout)
//
//  layoutGraph is pure, so these check the algorithm itself:
//  layers respect edge direction, cycles do not hang it, and
//  nothing lands on top of anything else.
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { breakCycles, assignLayers, layoutGraph } from '../js/layout.js'

const node = (id, w = 220, h = 100, groupId = null) => ({ id, w, h, groupId })
const edge = (from, to) => ({ from, to })

function overlaps(positions, nodes) {
  const boxes = nodes.map(n => {
    const p = positions.get(n.id)
    return p && { id: n.id, l: p.x, t: p.y, r: p.x + n.w, b: p.y + n.h }
  }).filter(Boolean)
  const hits = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      if (a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t) hits.push(a.id + '/' + b.id)
    }
  }
  return hits
}

describe('breakCycles()', () => {
  it('leaves an acyclic graph untouched', () => {
    const { reversed } = breakCycles(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c')])
    assert.eq(reversed.size, 0)
  })

  it('reverses exactly one edge of a simple cycle', () => {
    const { reversed } = breakCycles(['a', 'b', 'c'],
      [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')])
    assert.eq(reversed.size, 1)
  })

  it('reverses a self-referencing pair', () => {
    const { reversed } = breakCycles(['a', 'b'], [edge('a', 'b'), edge('b', 'a')])
    assert.eq(reversed.size, 1)
  })
})

describe('assignLayers()', () => {
  it('puts a chain in consecutive layers', () => {
    const ids = ['a', 'b', 'c']
    const { acyclic } = breakCycles(ids, [edge('a', 'b'), edge('b', 'c')])
    const { layer } = assignLayers(ids, acyclic)
    assert.eq(layer.get('a'), 0)
    assert.eq(layer.get('b'), 1)
    assert.eq(layer.get('c'), 2)
  })

  it('places a node after its deepest predecessor', () => {
    // a -> b -> d and a -> d. d must clear b, not merely clear a.
    const ids = ['a', 'b', 'd']
    const { acyclic } = breakCycles(ids, [edge('a', 'b'), edge('b', 'd'), edge('a', 'd')])
    const { layer } = assignLayers(ids, acyclic)
    assert.ok(layer.get('d') > layer.get('b'), 'd should sit after b')
  })

  it('pulls a dangling input next to what it feeds', () => {
    // s feeds c, which is three layers deep. s should sit just before c
    // rather than being stranded in the first column.
    const ids = ['a', 'b', 'c', 's']
    const { acyclic } = breakCycles(ids, [edge('a', 'b'), edge('b', 'c'), edge('s', 'c')])
    const { layer } = assignLayers(ids, acyclic)
    assert.eq(layer.get('s'), layer.get('c') - 1)
  })
})

describe('layoutGraph() -- placement', () => {
  it('orders a chain left to right', () => {
    const nodes = ['a', 'b', 'c'].map(id => node(id))
    const { positions } = layoutGraph(nodes, [edge('a', 'b'), edge('b', 'c')], { direction: 'LR' })
    assert.ok(positions.get('a').x < positions.get('b').x)
    assert.ok(positions.get('b').x < positions.get('c').x)
  })

  it('orders a chain top to bottom when asked', () => {
    const nodes = ['a', 'b', 'c'].map(id => node(id))
    const { positions } = layoutGraph(nodes, [edge('a', 'b'), edge('b', 'c')], { direction: 'TB' })
    assert.ok(positions.get('a').y < positions.get('b').y)
    assert.ok(positions.get('b').y < positions.get('c').y)
  })

  it('never overlaps two blocks', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => node(id, 220, 80 + i * 12))
    const edges = [
      edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd'),
      edge('d', 'e'), edge('e', 'f'), edge('f', 'g'), edge('c', 'g'), edge('g', 'h'),
    ]
    const { positions } = layoutGraph(nodes, edges)
    assert.deepEq(overlaps(positions, nodes), [])
  })

  it('respects measured heights when stacking a layer', () => {
    const nodes = [node('root'), node('tall', 220, 300), node('short', 220, 60)]
    const { positions } = layoutGraph(nodes, [edge('root', 'tall'), edge('root', 'short')])
    assert.deepEq(overlaps(positions, nodes), [])
  })

  it('parks unconnected blocks in a trailing lane', () => {
    const nodes = ['a', 'b', 'lonely'].map(id => node(id))
    const { positions } = layoutGraph(nodes, [edge('a', 'b')], { direction: 'LR' })
    assert.ok(positions.get('lonely').x > positions.get('b').x,
      'an unconnected block should not sit inside the flow')
  })

  it('terminates on a cyclic graph', () => {
    const nodes = ['a', 'b', 'c'].map(id => node(id))
    const { positions } = layoutGraph(nodes, [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')])
    assert.eq(positions.size, 3)
  })

  it('places every node exactly once', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => node(id))
    const { positions } = layoutGraph(nodes, [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')])
    assert.eq(positions.size, 4)
    ;['a', 'b', 'c', 'd'].forEach(id => {
      const p = positions.get(id)
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), id + ' should have finite coordinates')
    })
  })

  it('ignores edges pointing at blocks that are not there', () => {
    const nodes = [node('a'), node('b')]
    const { positions } = layoutGraph(nodes, [edge('a', 'b'), edge('a', 'ghost')])
    assert.eq(positions.size, 2)
  })

  it('reports zero crossings for a plain chain', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(id => node(id))
    const { crossings } = layoutGraph(nodes, [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')])
    assert.eq(crossings, 0)
  })

  it('untangles a deliberately crossed graph', () => {
    // Two parallel chains wired so the naive order crosses; the median
    // heuristic should be able to swap them apart.
    const nodes = ['a1', 'a2', 'b1', 'b2'].map(id => node(id))
    const { crossings } = layoutGraph(nodes, [edge('a1', 'b2'), edge('a2', 'b1')])
    assert.eq(crossings, 0)
  })
})
