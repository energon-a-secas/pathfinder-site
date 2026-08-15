// ============================================================
//  situation.test.js -- The engagement framing that opens the
//  prompt, and the templates that set it.
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { state, canvasMeta, devOpts } from '../js/state.js'
import { situationSection } from '../js/prompt.js'
import { SITUATION_FIELDS, SITUATION_DEFAULT, TYPES } from '../js/utils.js'
import { normalizeCanvas } from '../js/normalize.js'
import { EXAMPLE_CANVAS } from '../js/example-canvas.js'
import { TEMPLATES, applyTemplateSituation } from '../js/templates.js'

function withSituation(sit, fn) {
  const before = canvasMeta.situation
  canvasMeta.situation = { ...SITUATION_DEFAULT, ...sit }
  try { return fn() } finally { canvasMeta.situation = before }
}

describe('situationSection()', () => {
  it('always says what kind of document this is', () => {
    const out = withSituation({}, situationSection)
    assert.includes(out, '## Situation')
    assert.includes(out, 'It is a plan, not a codebase')
  })

  it('tells a reader with no codebase that nothing is verified', () => {
    const out = withSituation({ codebase: 'none' }, situationSection)
    assert.includes(out, 'There is no codebase yet')
    assert.includes(out, 'unverified')
  })

  it('tells a reader with the repo open to go and read it', () => {
    const out = withSituation({ codebase: 'current' }, situationSection)
    assert.includes(out, 'Read it before trusting this canvas')
    assert.includes(out, 'the repository wins')
  })

  it('names the repo when one was given', () => {
    const out = withSituation({ codebase: 'current', repoHint: 'org/checkout' }, situationSection)
    assert.includes(out, 'org/checkout')
  })

  it('does not invent a repo line when none was given', () => {
    const out = withSituation({ codebase: 'current' }, situationSection)
    assert.notIncludes(out, 'The code in question:')
  })

  it('tells a chat reader not to claim things about unseen code', () => {
    const out = withSituation({ runtime: 'chat' }, situationSection)
    assert.includes(out, 'no file or shell access')
  })

  it('tells a Claude Code reader to cite file paths', () => {
    const out = withSituation({ runtime: 'code' }, situationSection)
    assert.includes(out, 'cite file paths')
  })

  it('carries the first move', () => {
    const out = withSituation({ firstMove: 'ask' }, situationSection)
    assert.includes(out, 'Start by asking')
  })

  it('renders boundaries one per line', () => {
    const out = withSituation({ constraints: 'No new deps\nShip behind a flag' }, situationSection)
    assert.includes(out, '### Constraints and boundaries')
    assert.includes(out, '- No new deps')
    assert.includes(out, '- Ship behind a flag')
  })

  it('omits the boundaries heading when there are none', () => {
    const out = withSituation({ constraints: '   ' }, situationSection)
    assert.notIncludes(out, 'Constraints and boundaries')
  })

  it('every option contributes a real sentence', () => {
    // The copy lives beside the choice; an option with no line would silently
    // drop that whole axis from the prompt.
    Object.values(SITUATION_FIELDS).forEach(field => {
      Object.entries(field.options).forEach(([key, opt]) => {
        assert.ok(opt.line && opt.line.length > 20, `${key} needs a line`)
        assert.ok(opt.label, `${key} needs a label`)
      })
    })
  })
})

describe('templates', () => {
  it('every arrow points at a block that exists', () => {
    TEMPLATES.forEach(tpl => {
      tpl.arrows.forEach(([f, t]) => {
        assert.ok(f >= 0 && f < tpl.blocks.length, `${tpl.name}: bad from index ${f}`)
        assert.ok(t >= 0 && t < tpl.blocks.length, `${tpl.name}: bad to index ${t}`)
        assert.ok(f !== t, `${tpl.name}: self-referencing arrow`)
      })
    })
  })

  it('every block carries a description worth reading', () => {
    // An empty template produces an empty prompt, which is the failure mode
    // these were rewritten to avoid.
    TEMPLATES.forEach(tpl => {
      tpl.blocks.forEach(b => {
        assert.ok(b.description && b.description.length > 25, `${tpl.name}: "${b.title}" needs a description`)
      })
    })
  })

  it('the large templates are actually large', () => {
    const large = TEMPLATES.filter(t => t.large)
    assert.ok(large.length >= 3, 'expected at least three large templates')
    large.forEach(t => assert.ok(t.blocks.length >= 10, `${t.name} should have 10+ blocks`))
  })

  it('the large templates carry a situation and a mode', () => {
    TEMPLATES.filter(t => t.large).forEach(t => {
      assert.ok(t.situation, `${t.name} should set a situation`)
      assert.ok(t.mode, `${t.name} should set a mode`)
    })
  })

  it('applyTemplateSituation merges rather than replacing wholesale', () => {
    const meta = { situation: { ...SITUATION_DEFAULT, repoHint: 'keep-me' } }
    const opts = { mode: 'plan' }
    const tpl = TEMPLATES.find(t => t.large)
    assert.eq(applyTemplateSituation(tpl, meta, opts), true)
    assert.eq(meta.situation.repoHint, 'keep-me')
    assert.eq(meta.situation.codebase, tpl.situation.codebase)
    assert.eq(opts.mode, tpl.mode)
  })

  it('reports false for a template that carries no framing', () => {
    const plain = TEMPLATES.find(t => !t.situation && !t.mode)
    if (!plain) return
    assert.eq(applyTemplateSituation(plain, { situation: {} }, { mode: 'plan' }), false)
  })
})

// ── The worked example on tutorial.html ──────────────────────

describe('example canvas (tutorial.html)', () => {
  // Assumed card size. Real heights are DOM-measured, which a headless test
  // cannot do, so this uses a height generous enough for the descriptions the
  // example actually carries.
  const W = 220, H = 175

  it('every arrow points at a block that exists', () => {
    const ids = new Set(EXAMPLE_CANVAS.blocks.map(b => b.id))
    EXAMPLE_CANVAS.arrows.forEach(a => {
      assert.ok(ids.has(a.from), `missing from-block ${a.from}`)
      assert.ok(ids.has(a.to), `missing to-block ${a.to}`)
      assert.ok(a.from !== a.to, 'self-referencing arrow')
    })
  })

  it('has no duplicate block ids', () => {
    const ids = EXAMPLE_CANVAS.blocks.map(b => b.id)
    assert.eq(new Set(ids).size, ids.length)
  })

  it('lays its blocks out without overlaps', () => {
    // The example is hand-placed rather than tidied, so it can drift into an
    // overlap the moment a description grows. A worked example that looks like
    // a mess teaches the wrong lesson.
    const boxes = EXAMPLE_CANVAS.blocks.map(b => ({ id: b.id, l: b.x, t: b.y, r: b.x + W, b: b.y + H }))
    const hits = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j]
        if (a.l < c.r && a.r > c.l && a.t < c.b && a.b > c.t) hits.push(a.id + '/' + c.id)
      }
    }
    assert.deepEq(hits, [])
  })

  it('uses only block types the app knows', () => {
    EXAMPLE_CANVAS.blocks.forEach(b => assert.ok(TYPES[b.type], `unknown type ${b.type}`))
  })

  it('carries a situation the prompt can actually use', () => {
    const sit = EXAMPLE_CANVAS.meta.situation
    assert.ok(SITUATION_FIELDS.codebase.options[sit.codebase], 'bad codebase')
    assert.ok(SITUATION_FIELDS.runtime.options[sit.runtime], 'bad runtime')
    assert.ok(SITUATION_FIELDS.firstMove.options[sit.firstMove], 'bad firstMove')
  })

  it('survives normalizeCanvas without losing anything', () => {
    const payload = {
      blocks: EXAMPLE_CANVAS.blocks,
      arrows: EXAMPLE_CANVAS.arrows,
      groups: [],
      meta: EXAMPLE_CANVAS.meta,
    }
    const clean = normalizeCanvas(payload)
    assert.eq(clean.dropped.blocks, 0)
    assert.eq(clean.dropped.arrows, 0)
    assert.eq(Object.keys(clean.blocks).length, EXAMPLE_CANVAS.blocks.length)
    assert.eq(clean.meta.situation.codebase, EXAMPLE_CANVAS.meta.situation.codebase)
  })

  it('demonstrates the block types the walkthrough talks about', () => {
    const types = new Set(EXAMPLE_CANVAS.blocks.map(b => b.type))
    ;['problem', 'assumption', 'question'].forEach(t =>
      assert.ok(types.has(t), `the walkthrough explains ${t}, so the example should show one`))
  })
})
