// ============================================================
//  interop.test.js -- JSON Canvas in/out, Mermaid in
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { state, canvasMeta } from '../js/state.js'
import { detectFormat, fromJsonCanvas, toJsonCanvas, parseMermaid, typeForHex, exportColorFor } from '../js/interop.js'
import { TYPES } from '../js/utils.js'

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
    // A preset is a type hint (preset 1 was problem's), spent on the type:
    // no colour override is kept, so the card follows the theme.
    assert.eq(n1.color, null, 'preset color 1 resolves to the problem type, not an override')
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
    // The type's own hex (lossless) replaced the shared presets in 2026-09.
    assert.eq(p.color, TYPES.problem.color, 'problem exports its own hex, which maps back to one type')
    assert.eq(p.pathfinderType, 'problem')
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
    // Route and pattern are separate fields: a dotted link stays routed.
    assert.eq(payload.arrows.find(a => a.to === 'b').pattern, 'dashed')
    assert.eq(payload.arrows.find(a => a.to === 'b').style, 'routed')
    assert.eq(payload.arrows.find(a => a.from === 'a').pattern, 'solid')
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

// ── Legacy type colours (the palette before 2026-10) ────────

describe('JSON Canvas: files written before the 2026-10 palette still import typed', () => {
  const ids = Object.keys(TYPES)
  const node = (id, color, extra = {}) =>
    ({ id, type: 'text', x: 0, y: 0, width: 260, height: 100, color, text: '#### zz qq xx', ...extra })

  it('typeForHex reads every legacy hex, dark and light, as its type', () => {
    ids.forEach(id => {
      const [dark, light] = TYPES[id].legacyColors
      assert.eq(typeForHex(dark), id, `${id} legacy dark ${dark}`)
      assert.eq(typeForHex(light.toUpperCase()), id, `${id} legacy light ${light}, any case`)
      assert.eq(typeForHex(TYPES[id].color), id, `${id} current dark`)
      assert.eq(typeForHex(TYPES[id].light), id, `${id} current light`)
    })
  })

  it('a 2026-09 export (pathfinderType plus the old hex) imports every type with no override and nothing to check', () => {
    const { payload, lowConfidence } = fromJsonCanvas({ nodes: ids.map(id => node(id, TYPES[id].legacyColors[0], { pathfinderType: id })), edges: [] })
    assert.eq(lowConfidence.length, 0)
    payload.blocks.forEach(b => {
      assert.eq(b.type, b.id, `${b.id} keeps its type`)
      assert.eq(b.color, null, `${b.id}: the old type hex is not an override, so the card takes the new palette`)
    })
  })

  it('the same file with pathfinderType stripped by another tool still imports typed, from either theme\'s old hex', () => {
    for (const k of [0, 1]) {
      const { payload, lowConfidence } = fromJsonCanvas({ nodes: ids.map(id => node(id, TYPES[id].legacyColors[k])), edges: [] })
      assert.eq(lowConfidence.length, 0, `${k ? 'light' : 'dark'}: nothing needs a check`)
      payload.blocks.forEach(b => {
        assert.eq(b.type, b.id, `${k ? 'light' : 'dark'} ${b.id}`)
        assert.eq(b.color, null)
      })
    }
  })

  it('a pre-2026-09 export (presets) still reads an old process, terminator, context or custom hex as that type', () => {
    const old = { nodes: [
      node('process', TYPES.process.legacyColors[0]), node('terminator', TYPES.terminator.legacyColors[0]),
      node('context', TYPES.context.legacyColors[0]), node('custom', TYPES.custom.legacyColors[0]),
      node('g', '6'),
    ], edges: [] }
    const byId = Object.fromEntries(fromJsonCanvas(old).payload.blocks.map(b => [b.id, b]))
    ;['process', 'terminator', 'context', 'custom'].forEach(id => {
      assert.eq(byId[id].type, id, id)
      assert.ok(!byId[id].typeCheck, `${id} needs no check`)
    })
  })

  it('a colour picked on a card when it was its own type\'s colour survives our round trip as a real override', () => {
    const before = { blocks: state.blocks, arrows: state.arrows, groups: state.groups }
    try {
      const old = TYPES.problem.legacyColors[0]
      assert.deepEq(exportColorFor(old, 'problem'), [old, old], 'written as is, and marked exact')
      assert.deepEq(exportColorFor(TYPES.problem.color, 'problem'), [TYPES.problem.color, null], 'the current colour is no override')
      state.blocks = { p: { id: 'p', type: 'problem', title: 'Old red', description: '', x: 0, y: 0, color: old,
        actions: [], questions: [], criteria: [], rationale: '', width: null } }
      state.arrows = []; state.groups = {}
      const out = JSON.parse(JSON.stringify(toJsonCanvas()))
      assert.eq(out.nodes[0].pathfinderColor, old)
      const back = fromJsonCanvas(out).payload.blocks[0]
      assert.eq(back.type, 'problem')
      assert.eq(back.color, old, 'the override the person chose stays')
    } finally { Object.assign(state, before) }
  })
})
