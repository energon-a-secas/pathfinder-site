// ============================================================
//  trace.test.js -- Tests for the trace document type
//
//  The parser, the measurement pass and the scene builder are all
//  pure, so these exercise the real thing rather than a mock. The
//  YAML loader is injected, which is what lets a browser test and
//  validate-trace.mjs run the same acceptance code.
//
//  Every diagnostic asserted here is one that fired wrongly, or
//  failed to fire, at some point during the build.
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { normalizeTrace, parseTraceText, errorsOf, warningsOf } from '../js/trace/parse.js'
import { measureNode, wrap, textWidth } from '../js/trace/measure.js'
import { buildScene } from '../js/trace/layout-trace.js'
import { renderSvg } from '../js/trace/render-svg.js'
import { suggestFor } from '../js/trace/suggest.js'
import { NODE_KINDS, TOPO_KINDS, LINK_STATES } from '../js/trace/model.js'

const tree = (nodes, extra = {}) => normalizeTrace({ title: 't', kind: 'tree', nodes, ...extra })
const topo = (nodes, links = [], extra = {}) => normalizeTrace({ title: 'm', kind: 'topology', nodes, links, ...extra })
const msgs = t => t.diagnostics.map(d => d.msg).join(' | ')

describe('normalizeTrace() structure', () => {
  it('accepts a document wrapped in trace: or bare', () => {
    const a = normalizeTrace({ trace: { title: 'x', nodes: [{ id: 'a', title: 'A' }] } })
    const b = normalizeTrace({ title: 'x', nodes: [{ id: 'a', title: 'A' }] })
    assert.eq(a.nodes.length, 1)
    assert.eq(b.nodes.length, 1)
    assert.eq(a.meta.title, b.meta.title)
  })

  it('accepts nodes as a mapping of id to body', () => {
    const t = normalizeTrace({ title: 'x', nodes: { a: { title: 'A', next: 'b' }, b: { title: 'B' } } })
    assert.eq(t.nodes.length, 2)
    assert.eq(t.edges.length, 1)
  })

  it('turns branches into edges, whatever form they were written in', () => {
    const list = tree([{ id: 'a', kind: 'check', branches: [{ when: 'y', to: 'b' }, { when: 'n', to: 'c' }] },
                       { id: 'b' }, { id: 'c' }])
    const map = tree([{ id: 'a', kind: 'check', branches: { y: 'b', n: 'c' } }, { id: 'b' }, { id: 'c' }])
    const yn = tree([{ id: 'a', kind: 'check', yes: 'b', no: 'c' }, { id: 'b' }, { id: 'c' }])
    ;[list, map, yn].forEach(t => assert.eq(t.edges.length, 2))
    assert.eq(list.edges[0].label, 'y')
    assert.eq(yn.edges[0].label, 'yes')
  })

  it('drops a duplicate id and says so', () => {
    const t = tree([{ id: 'a', title: 'first' }, { id: 'a', title: 'second' }])
    assert.eq(t.nodes.length, 1)
    assert.eq(t.nodes[0].title, 'first')
    assert.ok(/Duplicate node id/.test(msgs(t)))
  })

  it('reports an edge pointing at a node that does not exist', () => {
    const t = tree([{ id: 'a', kind: 'check', branches: [{ when: 'y', to: 'ghost' }] }], { root: 'a' })
    assert.eq(errorsOf(t).length, 1)
    assert.ok(/does not exist/.test(msgs(t)))
    assert.eq(t.edges.length, 0)
  })

  it('drops a self-link', () => {
    const t = tree([{ id: 'a', next: 'a' }])
    assert.eq(t.edges.length, 0)
    assert.ok(/links to itself/.test(msgs(t)))
  })
})

describe('normalizeTrace() tree rules', () => {
  // This rule first fired on every `action` that had a single `next:`,
  // which is a continuation and not a decision at all.
  it('stays silent when a non-check node has one continuation', () => {
    const t = tree([{ id: 'a', kind: 'action', next: 'b' }, { id: 'b', kind: 'fix' }], { root: 'a' })
    assert.ok(!/makes a .*decision/.test(msgs(t)), msgs(t))
  })

  it('still reports a non-check node making a real decision', () => {
    const t = tree([{ id: 'a', kind: 'cause', branches: [{ when: 'x', to: 'b' }, { when: 'y', to: 'c' }] },
                    { id: 'b' }, { id: 'c' }], { root: 'a' })
    assert.ok(/makes a 2-way decision/.test(msgs(t)), msgs(t))
  })

  it('reports an unlabelled branch', () => {
    const t = tree([{ id: 'a', kind: 'check', branches: [{ to: 'b' }, { to: 'c' }] }, { id: 'b' }, { id: 'c' }], { root: 'a' })
    assert.ok(/no `when:`/.test(msgs(t)))
  })

  it('reports a check with only one way out', () => {
    const t = tree([{ id: 'a', kind: 'check', branches: [{ when: 'y', to: 'b' }] }, { id: 'b' }], { root: 'a' })
    assert.ok(/not a decision/.test(msgs(t)))
  })

  it('reports a node unreachable from the root', () => {
    const t = tree([{ id: 'a', next: 'b' }, { id: 'b' }, { id: 'stray' }], { root: 'a' })
    assert.ok(/unreachable from the root/.test(msgs(t)))
  })

  it('infers a single root and complains about several', () => {
    const one = tree([{ id: 'a', next: 'b' }, { id: 'b' }])
    assert.eq(one.root, 'a')
    const many = tree([{ id: 'a', next: 'c' }, { id: 'b', next: 'c' }, { id: 'c' }])
    assert.ok(/No `root` set/.test(msgs(many)))
  })
})

describe('link state defaults per document kind', () => {
  // A branch is not an unverified hop. Borrowing `unknown` for trees drew
  // every edge as a faint dashed line that meant nothing.
  it('defaults a tree branch to `branch`', () => {
    const t = tree([{ id: 'a', next: 'b' }, { id: 'b' }], { root: 'a' })
    assert.eq(t.edges[0].state, 'branch')
  })

  it('defaults a topology link to `unknown`', () => {
    const t = topo([{ id: 'a', kind: 'compute' }, { id: 'b', kind: 'service' }], [{ from: 'a', to: 'b' }])
    assert.eq(t.edges[0].state, 'unknown')
  })

  it('keeps an explicit state and coerces an unknown one', () => {
    const t = topo([{ id: 'a', kind: 'compute' }, { id: 'b', kind: 'service' }],
      [{ from: 'a', to: 'b', state: 'broken' }, { from: 'b', to: 'a', state: 'purple' }])
    assert.eq(t.edges[0].state, 'broken')
    assert.eq(t.edges[1].state, 'unknown')
    assert.ok(/Unknown link state/.test(msgs(t)))
  })
})

describe('containment', () => {
  it('reports a parent that does not exist and clears it', () => {
    const t = topo([{ id: 'a', kind: 'compute', in: 'ghost' }])
    assert.eq(t.nodes[0].parent, null)
    assert.ok(/which does not exist/.test(msgs(t)))
  })

  it('breaks a containment loop rather than hanging', () => {
    const t = topo([{ id: 'x', kind: 'account', in: 'y' }, { id: 'y', kind: 'vpc', in: 'x' }])
    assert.ok(/Containment loop/.test(msgs(t)))
    assert.ok(t.nodes.some(n => n.parent === null))
  })

  it('draws every child inside its declared container', () => {
    const t = topo([
      { id: 'acct', kind: 'account', label: 'A' },
      { id: 'vpc', kind: 'vpc', label: 'V', in: 'acct' },
      { id: 'sub', kind: 'subnet', label: 'S', in: 'vpc' },
      { id: 'c1', kind: 'compute', label: 'one', in: 'sub' },
      { id: 'c2', kind: 'service', label: 'two', in: 'sub' },
    ], [{ from: 'c1', to: 'c2' }])
    const scene = buildScene(t)
    const rect = {}
    scene.nodes.forEach(n => { rect[n.id] = n.rect })
    scene.containers.forEach(c => { rect[c.id] = c.rect })
    const inside = (k, p) => k.x >= p.x && k.y >= p.y && k.x + k.w <= p.x + p.w && k.y + k.h <= p.y + p.h
    t.nodes.filter(n => n.parent).forEach(n => {
      assert.ok(inside(rect[n.id], rect[n.parent]), `${n.id} escaped ${n.parent}`)
    })
  })
})

describe('parseTraceText()', () => {
  const load = text => window.jsyaml.load(text)

  it('reports a YAML syntax error with its line, and does not throw', () => {
    const t = parseTraceText('trace:\n  title: x\n   kind: tree\n', load)
    assert.eq(errorsOf(t).length, 1)
    assert.ok(/line 3/.test(msgs(t)), msgs(t))
    assert.eq(t.nodes.length, 0)
  })

  it('reports an empty document rather than rendering nothing silently', () => {
    assert.ok(/Nothing to parse/.test(msgs(parseTraceText('', load))))
  })
})

describe('measure', () => {
  it('never returns a box narrower than a short title needs', () => {
    const box = measureNode({ title: 'Hi', detail: '', probes: [] })
    assert.ok(box.w >= 180 && box.w <= 300, `width ${box.w}`)
  })

  it('grows taller for detail and probes, not wider than the cap', () => {
    const bare = measureNode({ title: 'Check the thing', detail: '', probes: [] })
    const full = measureNode({ title: 'Check the thing', detail: 'A '.repeat(60), probes: ['dig +short example.com'] })
    assert.ok(full.h > bare.h)
    assert.ok(full.w <= 300)
  })

  // Prose written in a YAML `|` block used to break at whatever column the
  // author happened to wrap the source file at.
  it('folds a single newline and keeps a blank line as a paragraph break', () => {
    const folded = wrap('one two\nthree four', 4000, 12)
    assert.eq(folded.length, 1)
    assert.eq(folded[0], 'one two three four')
    const paras = wrap('one\n\ntwo', 4000, 12)
    assert.ok(paras.length >= 2)
  })

  it('keeps every line when folding is off, which is what a command list needs', () => {
    assert.eq(wrap('aws a\naws b', 4000, 11, textWidth, false).length, 2)
  })

  it('hard-breaks a word too long to fit rather than overhanging', () => {
    const lines = wrap('https://docs.example.com/a/very/long/path/that/cannot/fit', 120, 12)
    assert.ok(lines.length > 1)
    lines.forEach(l => assert.ok(textWidth(l, 12) <= 120 + 1, `"${l}" overhangs`))
  })
})

describe('buildScene()', () => {
  const sample = () => tree([
    { id: 'a', kind: 'check', ask: 'Which way?', branches: [{ when: 'left', to: 'b' }, { when: 'right', to: 'c' }] },
    { id: 'b', kind: 'fix', title: 'Left fix' },
    { id: 'c', kind: 'cause', title: 'Right cause' },
  ], { root: 'a' })

  it('places no two boxes on top of each other', () => {
    const s = buildScene(sample())
    for (let i = 0; i < s.nodes.length; i++) {
      for (let j = i + 1; j < s.nodes.length; j++) {
        const a = s.nodes[i].rect, b = s.nodes[j].rect
        assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h),
          `${s.nodes[i].id} overlaps ${s.nodes[j].id}`)
      }
    }
  })

  it('gives every edge a usable path and a finite label anchor', () => {
    const s = buildScene(sample())
    assert.eq(s.edges.length, 2)
    s.edges.forEach(e => {
      assert.ok(e.path && e.path.length > 4, 'empty path')
      assert.ok(Number.isFinite(e.mid.x) && Number.isFinite(e.mid.y), 'label anchor not finite')
    })
  })

  it('gives two edges out of one node different exit points', () => {
    const s = buildScene(sample())
    const [p, q] = s.edges.map(e => e.points[0])
    assert.ok(p.x !== q.x || p.y !== q.y, 'both branches leave from the same pixel')
  })

  it('reports bounds that contain everything it drew', () => {
    const s = buildScene(sample())
    s.nodes.forEach(n => {
      assert.ok(n.rect.x + n.rect.w <= s.width, `${n.id} past the right edge`)
      assert.ok(n.rect.y + n.rect.h <= s.height, `${n.id} past the bottom edge`)
    })
  })
})

describe('renderSvg()', () => {
  const svgOf = t => renderSvg(buildScene(t))

  it('escapes markup in author text', () => {
    const t = tree([{ id: 'a', title: '<script>alert(1)</script> & "quoted"' }])
    const svg = svgOf(t)
    assert.ok(!/<script>/.test(svg), 'raw script tag survived')
    assert.ok(/&lt;script&gt;/.test(svg))
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(svg), 'stray unescaped ampersand')
  })

  it('defines an arrow marker for every link state', () => {
    const svg = svgOf(tree([{ id: 'a', next: 'b' }, { id: 'b' }], { root: 'a' }))
    Object.keys(LINK_STATES).forEach(k => assert.ok(svg.includes(`id="ah-${k}"`), `no marker for ${k}`))
  })

  // Labels are painted after the boxes. Drawn with their edges, any label
  // landing over a box disappeared behind it.
  it('paints branch labels after the node boxes', () => {
    const t = tree([{ id: 'a', kind: 'check', branches: [{ when: 'LABELTEXT', to: 'b' }, { when: 'other', to: 'c' }] },
                    { id: 'b' }, { id: 'c' }], { root: 'a' })
    const svg = svgOf(t)
    assert.ok(svg.lastIndexOf('LABELTEXT') > svg.indexOf('<rect x='), 'label drawn before the boxes')
  })

  it('renders both themes without leaving a colour undefined', () => {
    const t = tree([{ id: 'a', kind: 'check', branches: [{ when: 'y', to: 'b' }] }, { id: 'b' }], { root: 'a' })
    ;['dark', 'light'].forEach(theme => {
      const svg = renderSvg(buildScene(t), { theme })
      assert.ok(!/undefined|NaN|null/.test(svg), `${theme} emitted undefined/NaN`)
    })
  })
})

describe('suggestFor()', () => {
  it('returns nothing for an empty trace', () => {
    assert.eq(suggestFor({ nodes: [], edges: [] }).length, 0)
  })

  it('fires a structural rule on a cross-account topology', () => {
    const t = topo([
      { id: 'a1', kind: 'account', label: 'A' }, { id: 'a2', kind: 'account', label: 'B' },
      { id: 'c', kind: 'compute', label: 'app', in: 'a1' }, { id: 's', kind: 'service', label: 'svc', in: 'a2' },
    ], [{ from: 'c', to: 's', state: 'broken' }])
    assert.ok(suggestFor(t).some(s => s.id === 'reachability-analyzer'))
  })

  // Two rules build their headline from the trace. Only body and probes were
  // unwrapped at first, so those titles rendered as a function's own source.
  it('resolves a function-valued title to a string', () => {
    const t = tree([
      { id: 'a', kind: 'check', ask: 'one?', branches: [{ when: 'y', to: 'c' }, { when: 'n', to: 'c' }] },
      { id: 'b', kind: 'check', ask: 'two?', branches: [{ when: 'y', to: 'c' }, { when: 'n', to: 'c' }] },
      { id: 'c', kind: 'fix', title: 'done' },
    ], { root: 'a' })
    const hit = suggestFor(t).find(s => s.id === 'checks-without-probes')
    assert.ok(hit, 'rule did not fire')
    assert.eq(typeof hit.title, 'string')
    assert.ok(/2 checks/.test(hit.title), hit.title)
  })

  it('never returns more than the cap', () => {
    const t = tree([{ id: 'a', kind: 'check', ask: 'dns resolve timeout security group nacl 403 vpc endpoint hosted zone transit gateway sg- ssh', branches: [{ when: 'y', to: 'b' }, { when: 'n', to: 'b' }] }, { id: 'b' }], { root: 'a' })
    assert.ok(suggestFor(t, { limit: 3 }).length <= 3)
  })
})

describe('registries stay consistent', () => {
  it('gives every node kind a label and a colour', () => {
    Object.entries({ ...NODE_KINDS, ...TOPO_KINDS }).forEach(([k, v]) => {
      assert.ok(v.label, `${k} has no label`)
      assert.ok(/^#[0-9a-f]{6}$/i.test(v.color), `${k} colour is not a hex triplet`)
    })
  })

  it('gives every link state a label, and a colour unless it is neutral', () => {
    Object.entries(LINK_STATES).forEach(([k, v]) => {
      assert.ok(v.label, `${k} has no label`)
      assert.ok(v.color === null || /^#[0-9a-f]{6}$/i.test(v.color), `${k} colour is neither null nor hex`)
    })
  })
})
