// ============================================================
//  interop.test.js -- JSON Canvas in/out, Mermaid in
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { state, canvasMeta } from '../js/state.js'
import { detectFormat, fromJsonCanvas, toJsonCanvas, parseMermaid } from '../js/interop.js'

describe('detectFormat()', () => {
  it('tells the three formats apart', () => {
    assert.eq(detectFormat('{"nodes":[],"edges":[]}'), 'canvas')
    assert.eq(detectFormat('{"blocks":{},"arrows":[]}'), 'pathfinder')
    assert.eq(detectFormat('flowchart LR\n  a --> b'), 'mermaid')
    assert.eq(detectFormat('Notes\n```mermaid\ngraph TD\na-->b\n```'), 'mermaid')
    assert.eq(detectFormat('plain prose'), null)
  })
})

describe('fromJsonCanvas()', () => {
  const CANVAS = {
    nodes: [
      { id: 'n1', type: 'text', x: 0, y: 0, width: 250, height: 60, color: '1',
        text: 'Problem: checkout breaks\n\nIntermittent 500s.' },
      { id: 'n2', type: 'text', x: 400, y: 0, text: 'We must respond fast' },
      { id: 'n3', type: 'file', x: 0, y: 200, file: 'notes/postmortem.md' },
      { id: 'g1', type: 'group', x: -50, y: -50, width: 400, height: 200, label: 'Phase 1' },
    ],
    edges: [
      { id: 'e1', fromNode: 'n1', toNode: 'n2', fromSide: 'right', toSide: 'left', label: 'drives' },
    ],
  }
  it('classifies text nodes and splits title from description', () => {
    const { payload } = fromJsonCanvas(CANVAS)
    const n1 = payload.blocks.find(b => b.id === 'n1')
    assert.eq(n1.type, 'problem')
    assert.eq(n1.title, 'checkout breaks')
    assert.includes(n1.description, 'Intermittent')
    assert.eq(n1.color, '#f87171', 'preset color 1 maps to the red accent')
    const n2 = payload.blocks.find(b => b.id === 'n2')
    assert.eq(n2.type, 'requirement')
  })
  it('files become resources with a docRef; groups claim members by geometry', () => {
    const { payload } = fromJsonCanvas(CANVAS)
    const n3 = payload.blocks.find(b => b.id === 'n3')
    assert.eq(n3.type, 'resource')
    assert.eq(n3.docRef.href, 'notes/postmortem.md')
    const n1 = payload.blocks.find(b => b.id === 'n1')
    assert.eq(n1.groupId, 'g1', 'inside the Phase 1 rect')
    assert.eq(payload.blocks.find(b => b.id === 'n2').groupId ?? null, null, 'outside it')
  })
  it('edges carry sides as pinned ports and labels', () => {
    const { payload } = fromJsonCanvas(CANVAS)
    const e = payload.arrows[0]
    assert.eq(e.fromPort, 'right'); assert.eq(e.toPort, 'left'); assert.eq(e.label, 'drives')
  })
})

describe('toJsonCanvas()', () => {
  it('emits text nodes with type colors and edges with sides', () => {
    state.blocks = {
      p1: { id: 'p1', type: 'problem', title: 'It breaks', description: 'badly', x: 10, y: 20,
            actions: [], questions: [], criteria: [], rationale: '', color: null, width: null },
      d1: { id: 'd1', type: 'decision', title: 'Fix it', description: '', x: 400, y: 20,
            actions: [], questions: [], criteria: [], rationale: 'cheapest', color: null, width: null },
    }
    state.arrows = [{ id: 'a1', from: 'p1', to: 'd1', label: 'led to', fromPort: 'right', toPort: null }]
    state.groups = {}
    const out = toJsonCanvas()
    assert.eq(out.nodes.length, 2)
    const p = out.nodes.find(n => n.id === 'p1')
    assert.eq(p.type, 'text')
    assert.eq(p.color, '1', 'problem maps to preset red')
    assert.includes(p.text, '#### It breaks')
    const d = out.nodes.find(n => n.id === 'd1')
    assert.includes(d.text, 'Rationale: cheapest')
    const e = out.edges[0]
    assert.eq(e.fromSide, 'right')
    assert.eq(e.toSide, undefined, 'auto stays unspecified')
    assert.eq(e.label, 'led to')
  })
})

describe('parseMermaid()', () => {
  it('parses chains, labels, shapes and dashed links', () => {
    const { payload } = parseMermaid(
      'flowchart LR\n' +
      '  start([Kickoff]) --> a[Collect the logs]\n' +
      '  a -->|then| d{Ship it?}\n' +
      '  d -.-> b[Roll back]\n'
    )
    const byId = Object.fromEntries(payload.blocks.map(b => [b.id, b]))
    assert.eq(byId.start.type, 'terminator')
    assert.eq(byId.d.type, 'decision')
    assert.eq(byId.d.title, 'Ship it?')
    assert.eq(payload.arrows.length, 3)
    assert.eq(payload.arrows.find(a => a.from === 'a').label, 'then')
    assert.eq(payload.arrows.find(a => a.to === 'b').style, 'dashed')
  })
  it('lays nodes out without stacking them', () => {
    const { payload } = parseMermaid('graph TD\n a --> b\n a --> c\n b --> d\n c --> d')
    const seen = new Set(payload.blocks.map(b => `${b.x},${b.y}`))
    assert.eq(seen.size, payload.blocks.length, 'every node gets its own position')
  })
  it('subgraphs become groups with membership', () => {
    const { payload } = parseMermaid(
      'flowchart LR\n' +
      'subgraph Phase 1\n  a[Do a thing] --> b[Another]\nend\n' +
      'b --> c[Outside]\n'
    )
    assert.eq(payload.groups.length, 1)
    const gid = payload.groups[0].id
    const byId = Object.fromEntries(payload.blocks.map(b => [b.id, b]))
    assert.eq(byId.a.groupId, gid)
    assert.eq(byId.c.groupId ?? null, null)
  })
})
