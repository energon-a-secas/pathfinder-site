// ============================================================
//  examples-page.test.js -- The gallery's template conversion
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { templateToPayload } from '../js/examples-page.js'
import { TEMPLATES } from '../js/templates.js'
import { normalizeCanvas } from '../js/normalize.js'

describe('templateToPayload()', () => {
  it('converts Migrate a System into a loadable canvas with its framing', () => {
    const tpl = TEMPLATES.find(t => t.name === 'Migrate a System')
    const p = templateToPayload(tpl)
    assert.eq(Object.keys(p.blocks).length, 15)
    assert.eq(p.arrows.length, tpl.arrows.length)
    assert.eq(p.meta.title, 'Migrate a System')
    assert.eq(p.meta.prompt.mode, 'plan')
    assert.eq(p.meta.situation.codebase, 'current')
    // every arrow endpoint resolves to a real block id
    p.arrows.forEach(a => {
      assert.ok(p.blocks[a.from], 'from resolves')
      assert.ok(p.blocks[a.to], 'to resolves')
    })
  })
  it('survives the app importer without losses', () => {
    const tpl = TEMPLATES.find(t => t.name === 'Inherit a Codebase')
    const clean = normalizeCanvas(templateToPayload(tpl))
    assert.eq(clean.dropped.blocks + clean.dropped.arrows, 0)
    assert.eq(Object.keys(clean.blocks).length, tpl.blocks.length)
    assert.eq(clean.meta.prompt.mode, 'investigate')
  })
})
