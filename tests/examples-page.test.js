// ============================================================
//  examples-page.test.js -- The gallery's template conversion
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { templateToPayload } from '../js/examples-page.js'
import { TEMPLATES } from '../js/templates.js'
import { normalizeCanvas } from '../js/normalize.js'

describe('templateToPayload()', () => {
  it('converts Migrate a system into a loadable canvas with its framing', () => {
    const tpl = TEMPLATES.find(t => t.name === 'Migrate a system')
    const p = templateToPayload(tpl)
    assert.eq(Object.keys(p.blocks).length, 15)
    assert.eq(p.arrows.length, tpl.arrows.length)
    assert.eq(p.meta.title, 'Migrate a system')
    assert.eq(p.meta.prompt.mode, 'plan')
    assert.eq(p.meta.situation.codebase, 'current')
    // every arrow endpoint resolves to a real block id
    p.arrows.forEach(a => {
      assert.ok(p.blocks[a.from], 'from resolves')
      assert.ok(p.blocks[a.to], 'to resolves')
    })
  })
  it('survives the app importer without losses', () => {
    const tpl = TEMPLATES.find(t => t.name === 'Inherit a codebase')
    const clean = normalizeCanvas(templateToPayload(tpl))
    assert.eq(clean.dropped.blocks + clean.dropped.arrows, 0)
    assert.eq(Object.keys(clean.blocks).length, tpl.blocks.length)
    assert.eq(clean.meta.prompt.mode, 'investigate')
  })
})

describe('the Examples gallery', () => {
  it('every Load button names an example that exists, the recurring report included', async () => {
    const html = await (await fetch('../examples.html', { cache: 'no-store' })).text()
    const keys = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('[data-example]')]
      .map(b => b.dataset.example)
    assert.includes(keys, 'Plan a recurring report')
    keys.filter(k => k !== 'checkout').forEach(k =>
      assert.ok(TEMPLATES.some(t => t.name === k), `"${k}" is a built-in template`))
    const p = templateToPayload(TEMPLATES.find(t => t.name === 'Plan a recurring report'))
    assert.eq(Object.keys(p.blocks).length, 16)
    assert.eq(p.meta.prompt.mode, 'plan')
    const clean = normalizeCanvas(p)
    assert.eq(clean.dropped.blocks + clean.dropped.arrows, 0, 'loads without losses')
  })
})
