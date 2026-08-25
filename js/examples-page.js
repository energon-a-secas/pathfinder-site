// ════════════════════════════════════════════════════════════
//  examples-page.js: the Examples gallery's loaders.
//
//  Every example travels the same route a Share link takes, so
//  the app's importer handles it and an existing canvas still
//  gets a replace-or-merge prompt. Three of the four ARE the
//  large built-in templates: the gallery reuses the content the
//  app already ships instead of maintaining a second copy that
//  would drift.
// ════════════════════════════════════════════════════════════

import { EXAMPLE_CANVAS } from './example-canvas.js'
import { TEMPLATES } from './templates.js'

/**
 * Convert a template (relative dx/dy blocks, index-based arrows) into a
 * shareable canvas payload. Pure; exported for the tests.
 */
export function templateToPayload(tpl) {
  const ids = tpl.blocks.map((_, i) => 'e' + i)
  const blocks = {}
  tpl.blocks.forEach((bd, i) => {
    blocks[ids[i]] = {
      id: ids[i], type: bd.type, title: bd.title,
      description: bd.description || '',
      x: bd.dx, y: bd.dy,
      actions: bd.actions ? [...bd.actions] : [],
      questions: bd.questions ? bd.questions.map(q => ({ text: q.text })) : [],
      criteria: bd.criteria ? [...bd.criteria] : [],
      priority: bd.priority || null,
      status: bd.status || null,
    }
  })
  const arrows = tpl.arrows.map(([fi, ti, label], i) => {
    const a = { id: 'ea' + i, from: ids[fi], to: ids[ti], style: 'routed' }
    if (label) a.label = label
    return a
  })
  const meta = { title: tpl.name }
  if (tpl.situation) meta.situation = { ...tpl.situation }
  if (tpl.mode) meta.prompt = { mode: tpl.mode }
  return { blocks, arrows, groups: {}, meta }
}

function checkoutPayload() {
  return {
    blocks: Object.fromEntries(EXAMPLE_CANVAS.blocks.map(b => [b.id, b])),
    arrows: EXAMPLE_CANVAS.arrows,
    groups: {},
    meta: EXAMPLE_CANVAS.meta,
  }
}

function payloadFor(key) {
  if (key === 'checkout') return checkoutPayload()
  const tpl = TEMPLATES.find(t => t.name === key)
  return tpl ? templateToPayload(tpl) : null
}

document.querySelectorAll('[data-example]').forEach(btn => {
  btn.addEventListener('click', () => {
    try {
      const payload = payloadFor(btn.dataset.example)
      if (!payload) throw new Error('unknown example')
      location.href = './#s=' + btoa(encodeURIComponent(JSON.stringify(payload)))
    } catch (_) {
      btn.textContent = 'Could not build the link. Open the canvas and use a template instead.'
      btn.disabled = true
    }
  })
})
