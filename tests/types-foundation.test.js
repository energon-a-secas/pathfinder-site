// ============================================================
//  types-foundation.test.js -- the type registry (16 types, steps),
//  normalize forward compatibility (typeHint, typeCheck, gapAck),
//  and the arrow route/pattern split, from the foundation wave.
// ============================================================

import { describe, it, assert, mockBlockEl, mockGapIconEl, cleanupMockEls, cssRgba } from './test-utils.js'
import { state, devOpts, ui, selection, pointer, canvasMeta, serializeCanvas,
         getUndoHistory, getRedoFuture } from '../js/state.js'
import { TYPES, TYPE_STEPS, TYPE_DISAMBIGUATION, typesByStep, ACTION_DEFS, PROMPT_MODES } from '../js/utils.js'
import { normalizeBlock, normalizeArrow, normalizeCanvas } from '../js/normalize.js'
import { renderArrows, dashArrayFor, arrowRoute, arrowPattern } from '../js/canvas.js'
import { buildSvg } from '../js/image-export.js'
import { tidyCanvas } from '../js/layout.js'
import { generatePrompt } from '../js/prompt.js'
import { exportMarkdown, exportToPresentationSage } from '../js/export.js'
import { buildSpecFiles } from '../js/spec-export.js'
import { buildTaskPlan } from '../js/task-plan.js'

// The spec table, verbatim. Order is the registry's key order. The colours
// are the 2026-10 palette (DESIGN.md "Type palette"); the last two hexes are
// the palette before it, which an import must still read as the type.
const TABLE = [
  ['goal', 'Goal', '#9edaff', '#046eb6', 'core', 'why', 'ring', '#a78bfa', '#7c5fd4'],
  ['problem', 'Problem', '#dd7573', '#9a2a20', 'core', 'why', 'ring', '#f87171', '#d94444'],
  ['stakeholder', 'Stakeholder', '#ffb1c8', '#c15681', 'more', 'who', 'ring', '#fda4af', '#be185d'],
  ['metric', 'Metric', '#57cbd8', '#11839f', 'core', 'proof', 'square', '#67e8f9', '#0e7490'],
  ['requirement', 'Requirement', '#5aae69', '#268536', 'core', 'what', 'square', '#fbbf24', '#c49008'],
  ['output', 'Output', '#d1925a', '#935417', 'more', 'what', 'square', '#818cf8', '#5558cc'],
  ['implementation', 'Implementation', '#9ea044', '#7a8409', 'core', 'how', 'dot', '#a3e635', '#4d7c0f'],
  ['process', 'Process', '#6cb3fd', '#5181c7', 'more', 'how', 'dot', '#60a5fa', '#2563eb'],
  ['terminator', 'Trigger / End', '#cd7ab2', '#933a76', 'more', 'how', 'dot', '#f0abfc', '#c026a8'],
  ['decision', 'Decision', '#73dea4', '#20683c', 'core', 'how', 'dot', '#34d399', '#18a872'],
  ['resource', 'Resource / System', '#1aa7a0', '#469177', 'more', 'how', 'dot', '#2dd4bf', '#14a894'],
  ['assumption', 'Assumption', '#d09aea', '#9b54ad', 'core', 'doubt', 'diamond', '#eab308', '#b07d06'],
  ['risk', 'Risk', '#f89d79', '#c85030', 'core', 'doubt', 'diamond', '#fb923c', '#d46e14'],
  ['question', 'Open Question', '#2fa5d8', '#0a5e89', 'more', 'doubt', 'diamond', '#38bdf8', '#1490c8'],
  ['context', 'Context', '#b7bcc6', '#646975', 'more', 'other', 'dot', '#64748b', '#4b5563'],
  ['custom', 'Other', '#837a73', '#50453d', 'more', 'other', 'dot', '#d8b4fe', '#8b3fc4'],
]
const TEXT_FIELDS = ['label', 'short', 'tip', 'example', 'legend', 'section']
const HEX6 = /^#[0-9a-f]{6}$/i
const EM_DASH = String.fromCharCode(0x2014)

// ── Registry integrity ──────────────────────────────────────

describe('types registry -- shape', () => {
  it('matches the spec table exactly, in key order', () => {
    assert.deepEq(Object.keys(TYPES), TABLE.map(r => r[0]))
    TABLE.forEach(([id, label, color, light, tier, step, shape, oldDark, oldLight]) => {
      const t = TYPES[id]
      assert.eq(t.label, label, `${id} label`)
      assert.eq(t.color, color, `${id} color`)
      assert.eq(t.light, light, `${id} light`)
      assert.eq(t.tier, tier, `${id} tier`)
      assert.eq(t.step, step, `${id} step`)
      assert.eq(t.shape, shape, `${id} shape`)
      assert.deepEq(t.legacyColors, [oldDark, oldLight], `${id} keeps the pre-2026-10 hexes`)
    })
  })

  it('gives every entry every field, with the right kind of value', () => {
    const steps = TYPE_STEPS.map(s => s.id)
    Object.entries(TYPES).forEach(([id, t]) => {
      TEXT_FIELDS.forEach(f => assert.ok(typeof t[f] === 'string' && t[f].trim(), `${id}.${f} is non-empty text`))
      assert.match(t.color, HEX6, `${id}.color is a 6-digit hex`)
      assert.match(t.light, HEX6, `${id}.light is a 6-digit hex`)
      assert.ok(['dot', 'ring', 'square', 'diamond'].includes(t.shape), `${id}.shape`)
      assert.ok(Array.isArray(t.legacyColors) && t.legacyColors.length % 2 === 0, `${id}.legacyColors holds dark, light pairs`)
      t.legacyColors.forEach(h => assert.match(h, HEX6, `${id} legacy ${h} is a 6-digit hex`))
      assert.ok(['core', 'more'].includes(t.tier), `${id}.tier`)
      assert.ok(steps.includes(t.step), `${id}.step`)
      assert.ok(t.criteria === false || ['Acceptance criteria', 'Targets'].includes(t.criteria), `${id}.criteria`)
      assert.eq(typeof t.task, 'boolean', `${id}.task`)
      assert.ok(Array.isArray(t.actions), `${id}.actions`)
      t.actions.forEach(a => assert.ok(ACTION_DEFS[a], `${id} action ${a} is a real action`))
    })
  })

  it('uses distinct colours in each theme', () => {
    const dark = Object.values(TYPES).map(t => t.color.toLowerCase())
    const light = Object.values(TYPES).map(t => t.light.toLowerCase())
    assert.eq(new Set(dark).size, dark.length, 'dark colours are unique')
    assert.eq(new Set(light).size, light.length, 'light colours are unique')
  })

  it('carries criteria labels, task flags and default actions per the spec', () => {
    const criteria = Object.fromEntries(Object.entries(TYPES).filter(([, t]) => t.criteria).map(([id, t]) => [id, t.criteria]))
    assert.deepEq(criteria, { goal: 'Acceptance criteria', metric: 'Targets', requirement: 'Acceptance criteria',
      output: 'Acceptance criteria', implementation: 'Acceptance criteria' })
    // output stays a task: it was one in task-plan.js before the registry.
    assert.deepEq(Object.keys(TYPES).filter(id => TYPES[id].task), ['requirement', 'output', 'implementation'])
    const actions = Object.fromEntries(Object.entries(TYPES).filter(([, t]) => t.actions.length).map(([id, t]) => [id, t.actions]))
    assert.deepEq(actions, { problem: ['resolve'], assumption: ['validate'], risk: ['prepare'] })
  })

  it('writes no em dash in any registry, step or hint text', () => {
    const text = JSON.stringify([TYPES, TYPE_STEPS, TYPE_DISAMBIGUATION])
    assert.notIncludes(text, EM_DASH)
  })

  it('ships the three disambiguation lines', () => {
    assert.eq(TYPE_DISAMBIGUATION.length, 3)
    assert.includes(TYPE_DISAMBIGUATION.join(' '), 'Implementation')
    assert.includes(TYPE_DISAMBIGUATION.join(' '), 'Trigger / End')
    assert.includes(TYPE_DISAMBIGUATION.join(' '), 'Metric')
  })
})

describe('types registry -- steps', () => {
  it('lists the seven steps in flow order', () => {
    assert.deepEq(TYPE_STEPS.map(s => s.id), ['why', 'who', 'proof', 'what', 'how', 'doubt', 'other'])
    TYPE_STEPS.forEach(s => {
      assert.ok(s.label && s.hint, `${s.id} has a label and a hint`)
    })
  })

  it('typesByStep covers every type exactly once, in step order', () => {
    const groups = typesByStep()
    assert.deepEq(groups.map(g => g.step), TYPE_STEPS.map(s => s.id))
    const flat = groups.flatMap(g => g.types)
    assert.eq(flat.length, Object.keys(TYPES).length)
    assert.eq(new Set(flat).size, flat.length, 'no type twice')
    // The registry is written in step order, so flattening reproduces it.
    assert.deepEq(flat, Object.keys(TYPES))
    groups.forEach(g => {
      assert.ok(g.label && g.hint, `${g.step} group carries its label and hint`)
      g.types.forEach(t => assert.eq(TYPES[t].step, g.step))
    })
    assert.deepEq(groups.find(g => g.step === 'how').types,
      ['implementation', 'process', 'terminator', 'decision', 'resource'])
  })
})

describe('types registry -- CSS', () => {
  it('defines a --c- variable for every type in both themes, and a card accent rule', async () => {
    const css = await (await fetch('../css/style.css')).text()
    // The :root block that holds the type colours (the design tokens come
    // first, in a block of their own).
    const rootStart = css.lastIndexOf(':root', css.indexOf('--c-goal'))
    const rootBlock = css.slice(rootStart, css.indexOf('}', rootStart))
    const lightStart = css.search(/body\.light-mode \{\s*--c-goal/)
    assert.ok(lightStart > 0, 'the light-mode type colour block exists')
    const lightBlock = css.slice(lightStart, css.indexOf('}', lightStart))
    // OKLCH in the stylesheet, hex in the registry: the registry's hex is the
    // sRGB the OKLCH value renders as, channel for channel.
    const hex = c => '#' + cssRgba(c).slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')
    Object.entries(TYPES).forEach(([id, t]) => {
      const dark = rootBlock.match(new RegExp(`--c-${id}:\\s*(oklch\\([^)]*\\))`))
      const light = lightBlock.match(new RegExp(`--c-${id}:\\s*(oklch\\([^)]*\\))`))
      assert.ok(dark, `--c-${id} in :root, in OKLCH`)
      assert.ok(light, `--c-${id} in body.light-mode, in OKLCH`)
      assert.eq(hex(dark[1]), t.color, `--c-${id} dark matches the registry`)
      assert.eq(hex(light[1]), t.light, `--c-${id} light matches the registry`)
      assert.ok(new RegExp(`\\.block\\[data-type=${id}\\]\\s*\\{\\s*--bc:\\s*var\\(--c-${id}\\)`).test(css), `.block[data-type=${id}] accent rule`)
    })
  })
})

// ── Normalize: forward compatibility and new fields ─────────

describe('normalizeBlock() -- forward compatibility', () => {
  it('keeps an unknown type as custom and remembers it in typeHint', () => {
    const b = normalizeBlock({ id: 'x', type: 'roadmap-item', title: 'Q3 bet', description: 'kept' })
    assert.eq(b.type, 'custom')
    assert.eq(b.typeHint, 'roadmap-item')
    assert.eq(b.description, 'kept')
  })

  it('writes no typeHint on an ordinary block', () => {
    const b = normalizeBlock({ id: 'x', type: 'goal' })
    assert.ok(!('typeHint' in b))
    assert.ok(!('typeCheck' in b))
    assert.ok(!('gapAck' in b))
  })

  it('keeps an unknown hint across another save and load', () => {
    const once = normalizeBlock({ id: 'x', type: 'roadmap-item' })
    const twice = normalizeBlock(JSON.parse(JSON.stringify(once)))
    assert.eq(twice.type, 'custom')
    assert.eq(twice.typeHint, 'roadmap-item')
  })

  it('restores the real type once a build knows it', () => {
    // A stale tab saved an implementation as custom + typeHint.
    const b = normalizeBlock({ id: 'x', type: 'custom', typeHint: 'implementation' })
    assert.eq(b.type, 'implementation')
    assert.ok(!('typeHint' in b))
  })

  it('does not treat inherited object names as known types', () => {
    const b = normalizeBlock({ id: 'x', type: 'constructor' })
    assert.eq(b.type, 'custom')
    assert.eq(b.typeHint, 'constructor')
  })

  it('caps a very long type hint', () => {
    assert.eq(normalizeBlock({ id: 'x', type: 'y'.repeat(200) }).typeHint.length, 40)
  })

  it('a whole canvas with a newer type loses no block', () => {
    const r = normalizeCanvas({ blocks: [{ id: 'a', type: 'goal' }, { id: 'b', type: 'hypothesis' }],
      arrows: [{ from: 'a', to: 'b' }] })
    assert.eq(Object.keys(r.blocks).length, 2)
    assert.eq(r.dropped.blocks, 0)
    assert.eq(r.arrows.length, 1, 'the arrow to it survives too')
  })
})

describe('normalizeBlock() -- typeCheck and gapAck', () => {
  it('keeps typeCheck only when it is exactly true', () => {
    assert.eq(normalizeBlock({ id: 'x', type: 'goal', typeCheck: true }).typeCheck, true)
    assert.ok(!('typeCheck' in normalizeBlock({ id: 'x', type: 'goal', typeCheck: 'yes' })))
    assert.ok(!('typeCheck' in normalizeBlock({ id: 'x', type: 'goal', typeCheck: false })))
  })

  it('keeps gap ids, drops everything else, dedupes and caps at 20', () => {
    const b = normalizeBlock({ id: 'x', type: 'goal',
      gapAck: ['gap-no-req', 'gap-no-req', 'no-prefix', 7, null, 'gap-', 'gap-Upper', 'gap-future-rule'] })
    assert.deepEq(b.gapAck, ['gap-no-req', 'gap-future-rule'])
    const many = Array.from({ length: 30 }, (_, i) => 'gap-rule-' + i)
    assert.eq(normalizeBlock({ id: 'x', type: 'goal', gapAck: many }).gapAck.length, 20)
    assert.ok(!('gapAck' in normalizeBlock({ id: 'x', type: 'goal', gapAck: 'gap-no-req' })))
  })

  it('round-trips typeCheck, gapAck and typeHint through serialize and normalize', () => {
    state.blocks = {
      a: normalizeBlock({ id: 'a', type: 'metric', title: 'KR', typeCheck: true, gapAck: ['gap-no-target'] }),
      b: normalizeBlock({ id: 'b', type: 'newer-type', title: 'From the future' }),
    }
    state.arrows = []
    state.groups = {}
    const back = normalizeCanvas(JSON.parse(JSON.stringify(serializeCanvas())))
    assert.eq(back.blocks.a.typeCheck, true)
    assert.deepEq(back.blocks.a.gapAck, ['gap-no-target'])
    assert.eq(back.blocks.b.type, 'custom')
    assert.eq(back.blocks.b.typeHint, 'newer-type')
    state.blocks = {}
  })
})

// ── Arrows: route vs pattern ─────────────────────────────────

describe('normalizeArrow() -- route and pattern', () => {
  it('migrates legacy dashed and dotted styles into curved + pattern', () => {
    const d = normalizeArrow({ from: 'a', to: 'b', style: 'dashed' })
    assert.eq(d.style, 'curved')
    assert.eq(d.pattern, 'dashed')
    const t = normalizeArrow({ from: 'a', to: 'b', style: 'dotted' })
    assert.eq(t.style, 'curved')
    assert.eq(t.pattern, 'dotted')
  })

  it('defaults the pattern to solid and rejects unknown ones', () => {
    assert.eq(normalizeArrow({ from: 'a', to: 'b' }).pattern, 'solid')
    assert.eq(normalizeArrow({ from: 'a', to: 'b', pattern: 'wavy' }).pattern, 'solid')
  })

  it('keeps an explicit pattern on a routed line', () => {
    const a = normalizeArrow({ from: 'a', to: 'b', style: 'routed', pattern: 'dotted' })
    assert.eq(a.style, 'routed')
    assert.eq(a.pattern, 'dotted')
  })

  it('keeps unknown legacy styles curved, not routed', () => {
    assert.eq(normalizeArrow({ from: 'a', to: 'b', style: 'zigzag' }).style, 'curved')
  })

  it('keeps tidy and import pin provenance, drops anything else', () => {
    assert.eq(normalizeArrow({ from: 'a', to: 'b', portsBy: 'import' }).portsBy, 'import')
    assert.eq(normalizeArrow({ from: 'a', to: 'b', portsBy: 'tidy' }).portsBy, 'tidy')
    assert.eq(normalizeArrow({ from: 'a', to: 'b', portsBy: 'user' }).portsBy, undefined)
  })

  it('survives a serialize and normalize round trip', () => {
    state.blocks = { a: normalizeBlock({ id: 'a', type: 'goal' }), b: normalizeBlock({ id: 'b', type: 'goal' }) }
    state.arrows = [
      normalizeArrow({ id: 'x', from: 'a', to: 'b', style: 'routed', pattern: 'dashed' }),
      normalizeArrow({ id: 'y', from: 'b', to: 'a', style: 'dotted' }),
    ]
    state.groups = {}
    const back = normalizeCanvas(JSON.parse(JSON.stringify(serializeCanvas())))
    const x = back.arrows.find(a => a.id === 'x'), y = back.arrows.find(a => a.id === 'y')
    assert.eq(x.style, 'routed')
    assert.eq(x.pattern, 'dashed')
    assert.eq(y.style, 'curved')
    assert.eq(y.pattern, 'dotted')
    state.blocks = {}; state.arrows = []
  })

  it('reads legacy in-memory arrows the same way the normalizer does', () => {
    assert.eq(arrowRoute({ style: 'dashed' }), 'curved')
    assert.eq(arrowPattern({ style: 'dashed' }), 'dashed')
    assert.eq(arrowRoute({ style: 'routed', pattern: 'dotted' }), 'routed')
    assert.eq(arrowPattern({ style: 'routed' }), 'solid')
  })
})

// ── Arrows: drawing the pattern ──────────────────────────────

function seedTwo(arrow) {
  cleanupMockEls()
  state.blocks = {
    a: { id: 'a', type: 'goal', title: 'A', x: 0, y: 0 },
    b: { id: 'b', type: 'requirement', title: 'B', x: 400, y: 0 },
  }
  mockBlockEl('a', { width: 220, height: 100 })
  mockBlockEl('b', { width: 220, height: 100 })
  state.arrows = [{ id: 'arr', from: 'a', to: 'b', weight: 2, bidirectional: false, color: null,
    fromPort: null, toPort: null, ...arrow }]
  state.groups = {}
  selection.arrowId = null
  pointer.ix = null
}

function clearArrows() {
  document.getElementById('arrowsGroup').innerHTML = ''
  state.blocks = {}; state.arrows = []
  cleanupMockEls()
}

describe('renderArrows() -- line pattern', () => {
  it('dash lengths come from one helper, scaled mildly with weight', () => {
    assert.eq(dashArrayFor('dashed', 2), '8 6')
    assert.eq(dashArrayFor('dotted', 2), '2 5')
    assert.eq(dashArrayFor('solid', 2), '')
    const heavy = dashArrayFor('dashed', 5).split(' ').map(Number)
    assert.gt(heavy[0], 8)
  })

  it('a dashed arrow gets a non-zero computed stroke-dasharray, set inline', () => {
    seedTwo({ style: 'routed', pattern: 'dashed' })
    renderArrows({ cheap: true })
    const vis = document.querySelector('#arrowsGroup [data-aid="arr"] .arrow-path')
    assert.ok(vis, 'the arrow rendered')
    assert.ok(vis.style.strokeDasharray, 'inline dasharray set')
    assert.ok(!vis.hasAttribute('stroke-dasharray'), 'no presentation attribute for CSS to beat')
    const computed = getComputedStyle(vis).strokeDasharray
    assert.ok(computed && computed !== 'none', `computed dasharray is ${computed}`)
    assert.ok(computed.split(/[ ,]+/).map(parseFloat).some(n => n > 0), 'a real dash, not 20 0')
    clearArrows()
  })

  it('a solid arrow has no dasharray, and switching back clears it', () => {
    seedTwo({ style: 'curved', pattern: 'dotted' })
    renderArrows({ cheap: true })
    state.arrows[0].pattern = 'solid'
    renderArrows({ cheap: true })
    const vis = document.querySelector('#arrowsGroup [data-aid="arr"] .arrow-path')
    assert.eq(vis.style.strokeDasharray, '')
    assert.eq(getComputedStyle(vis).strokeDasharray, 'none')
    clearArrows()
  })

  it('a legacy style: dashed arrow still draws dashed', () => {
    seedTwo({ style: 'dashed' })
    renderArrows({ cheap: true })
    const vis = document.querySelector('#arrowsGroup [data-aid="arr"] .arrow-path')
    assert.deepEq(vis.style.strokeDasharray.split(/[ ,]+/).map(parseFloat), [8, 6])
    clearArrows()
  })

  it('the real stylesheet neither overrides the dash nor animates a line at rest', async () => {
    // Load style.css into a shadow root so its rules apply to a test path
    // without restyling the test report.
    const css = await (await fetch('../css/style.css')).text()
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-2000px;top:0;width:200px;height:100px'
    document.body.appendChild(host)
    const root = host.attachShadow({ mode: 'open' })
    root.adoptedStyleSheets = [sheet]
    root.innerHTML = '<svg width="200" height="100"><g data-aid="t" class="related"><path class="arrow-path" d="M 0 50 L 200 50"></path>' +
      '<path class="arrow-path related" d="M 0 60 L 200 60"></path></g></svg>'
    const [plain, related] = root.querySelectorAll('.arrow-path')
    try {
      assert.eq(getComputedStyle(plain).strokeDasharray, 'none', 'a solid line has no stylesheet dash')
      assert.eq(plain.getAnimations().length, 0, 'no animation on a line at rest')
      assert.eq(related.getAnimations().length, 0, 'no marching ants on a related line')
      assert.eq(getComputedStyle(related).strokeDasharray, 'none', 'a related line stays solid')
      plain.style.strokeDasharray = dashArrayFor('dashed', 2)
      related.style.strokeDasharray = dashArrayFor('dotted', 2)
      assert.match(getComputedStyle(plain).strokeDasharray, /^8(px)?,? 6(px)?$/)
      assert.match(getComputedStyle(related).strokeDasharray, /^2(px)?,? 5(px)?$/, 'hover keeps the pattern')
    } finally {
      host.remove()
    }
  })
})

describe('buildSvg() -- line pattern', () => {
  it('exports the same dashes the canvas draws, and none for solid', () => {
    seedTwo({ style: 'routed', pattern: 'dotted' })
    ui.lightMode = false
    const { svg } = buildSvg()
    assert.includes(svg, 'stroke-dasharray="2 5"')
    state.arrows[0].pattern = 'solid'
    const { svg: solid } = buildSvg()
    // The highlight ring can dash too; no highlight here, so no dash at all.
    assert.notIncludes(solid, 'stroke-dasharray')
    clearArrows()
  })
})

describe('tidyCanvas() -- import pins', () => {
  it('restamps pins that came from an import, like its own', () => {
    seedTwo({ style: 'routed', fromPort: 'top', toPort: 'top', portsBy: 'import' })
    getUndoHistory().length = 0; getRedoFuture().length = 0
    tidyCanvas({ direction: 'LR' })
    const a = state.arrows[0]
    assert.eq(a.fromPort, 'right')
    assert.eq(a.toPort, 'left')
    assert.eq(a.portsBy, 'tidy')
    clearArrows()
  })

  it('still leaves a hand pin alone', () => {
    seedTwo({ style: 'routed', fromPort: 'top', toPort: 'top' })
    tidyCanvas({ direction: 'LR' })
    assert.eq(state.arrows[0].fromPort, 'top')
    assert.eq(state.arrows[0].toPort, 'top')
    clearArrows()
  })
})

// ── Every type through every exporter ────────────────────────

function seedEveryType() {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  canvasMeta.title = 'Every type'
  canvasMeta.contextBrief = ''
  Object.keys(TYPES).forEach((t, i) => {
    state.blocks['b-' + t] = {
      id: 'b-' + t, type: t, title: `Title of ${t}`, description: '', notes: '',
      x: i * 300, y: 0, actions: [], questions: [], criteria: t === 'metric' ? ['80% by Q4'] : [],
      width: null, color: null, collapsed: false, groupId: null,
    }
    mockBlockEl('b-' + t)
    mockGapIconEl('b-' + t)
  })
  // Connect them in a chain so the Markdown export has connections too.
  const ids = Object.keys(state.blocks)
  ids.slice(1).forEach((id, i) => state.arrows.push({ id: 'c' + i, from: ids[i], to: id }))
  devOpts.tone = 'auto'
  devOpts.detail = 'standard'
  devOpts.prePrompts = new Set()
}

// Run an exporter that downloads a Blob, and return the Blob's text instead.
async function captureDownload(fn) {
  const origCreate = URL.createObjectURL, origClick = HTMLAnchorElement.prototype.click
  let blob = null
  URL.createObjectURL = b => { blob = b; return 'blob:captured' }
  HTMLAnchorElement.prototype.click = function () {}
  try { fn() } finally {
    URL.createObjectURL = origCreate
    HTMLAnchorElement.prototype.click = origClick
  }
  return blob ? blob.text() : ''
}

describe('exporters -- every type survives', () => {
  it('every prompt mode prints every block and never "undefined"', () => {
    seedEveryType()
    PROMPT_MODES.forEach(mode => {
      devOpts.mode = mode
      const prompt = generatePrompt()
      Object.keys(TYPES).forEach(t => assert.includes(prompt, `Title of ${t}`, `${mode} prompt carries the ${t} block`))
      // One gap message says, in words, that "done" is undefined; that is
      // copy, not a missing value, so it is masked before the check.
      const at = prompt.replace(/"done" is undefined/g, '').indexOf('undefined')
      assert.eq(at, -1, `${mode} prompt prints no undefined: ...${prompt.slice(Math.max(0, at - 80), at + 20)}`)
    })
    devOpts.mode = 'plan'
  })

  it('the plan prompt heads each new type with its registry section', () => {
    seedEveryType()
    devOpts.mode = 'plan'
    const prompt = generatePrompt()
    ;['stakeholder', 'metric', 'implementation'].forEach(t => assert.includes(prompt, `## ${TYPES[t].section}`))
    assert.includes(prompt, `**${TYPES.metric.label}**: ${TYPES.metric.legend}`, 'legend line from the registry')
    assert.includes(prompt, 'Targets:', 'a metric lists its targets under its own label')
  })

  it('the Build checklist treats implementation as a task', () => {
    seedEveryType()
    const tasks = buildTaskPlan(state.blocks, state.arrows).tasks.map(b => b.type)
    assert.deepEq([...tasks].sort(), ['implementation', 'output', 'requirement'])
  })

  it('the Markdown export has a section for every type, and no undefined heading', async () => {
    seedEveryType()
    const md = await captureDownload(() => exportMarkdown())
    assert.ok(md.length > 0, 'captured the download')
    Object.keys(TYPES).forEach(t => assert.includes(md, `Title of ${t}`, `markdown carries the ${t} block`))
    assert.notIncludes(md, 'undefined')
    ;['stakeholder', 'metric', 'implementation'].forEach(t => assert.includes(md, `## ${TYPES[t].section}`))
  })

  it('the Spec bundle carries every type, and no undefined', () => {
    seedEveryType()
    const all = buildSpecFiles().map(f => f.data).join('\n')
    Object.keys(TYPES).forEach(t => assert.includes(all, `Title of ${t}`, `spec bundle carries the ${t} block`))
    assert.notIncludes(all, 'undefined')
  })

  it('the image export draws every type, and no undefined', () => {
    seedEveryType()
    ui.lightMode = false
    const { svg } = buildSvg()
    Object.keys(TYPES).forEach(t => {
      assert.includes(svg, `Title of ${t}`, `image carries the ${t} block`)
      assert.includes(svg, TYPES[t].label.toUpperCase(), `image labels the ${t} badge`)
    })
    assert.notIncludes(svg, 'undefined')
  })

  it('the Presentation Sage deck carries every type, and no undefined', () => {
    seedEveryType()
    const orig = window.open
    let url = ''
    window.open = u => { url = u; return null }
    try { exportToPresentationSage() } finally { window.open = orig }
    const b64 = url.split('#d=')[1].replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4))
    const yaml = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
    Object.keys(TYPES).forEach(t => assert.includes(yaml, `Title of ${t}`, `deck carries the ${t} block`))
    assert.notIncludes(yaml, 'undefined')
    state.blocks = {}; state.arrows = []
    cleanupMockEls()
  })
})
