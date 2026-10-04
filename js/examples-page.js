// ════════════════════════════════════════════════════════════
//  examples-page.js: the Examples gallery's loaders.
//
//  Every example travels the same route a Share link takes, so
//  the app's importer handles it and an existing canvas still
//  gets the new-map, replace or merge choice. Four of the five
//  ARE the large built-in templates: the gallery reuses the
//  content the app already ships instead of maintaining a second
//  copy that would drift. Their pictures and brief excerpts are
//  drawn from these same payloads by tools/render-assets.mjs.
// ════════════════════════════════════════════════════════════

import { EXAMPLE_CANVAS } from './example-canvas.js'
import { TEMPLATES } from './templates.js'
import { DEFAULT_ARROW_WEIGHT } from './utils.js'

/**
 * The gallery, in the order of the job each map does. `key` is what a
 * page's data-example names; `slug` names the generated files
 * (examples/<slug>.svg, -light.svg) and the brief markers. `picture`
 * marks the maps the page shows with a picture and an excerpt; the
 * blank bug template is a plain link under the first.
 */
export const EXAMPLES = [
  { key: 'checkout', slug: 'checkout', picture: true },
  { key: 'Investigate a Bug', slug: 'investigate-a-bug', picture: false },
  { key: 'Inherit a Codebase', slug: 'inherit-a-codebase', picture: true },
  { key: 'Migrate a System', slug: 'migrate-a-system', picture: true },
  { key: 'Recurring Reporting Flow', slug: 'recurring-reporting-flow', picture: true },
]

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
  const arrows = tpl.arrows.map(([fi, ti, label, relation], i) => {
    const a = { id: 'ea' + i, from: ids[fi], to: ids[ti], style: 'routed', weight: DEFAULT_ARROW_WEIGHT }
    if (label) a.label = label
    if (relation) a.relation = relation
    return a
  })
  const meta = { title: tpl.name }
  if (tpl.situation) meta.situation = { ...tpl.situation }
  if (tpl.mode) meta.prompt = { mode: tpl.mode }
  return { blocks, arrows, groups: {}, meta }
}

function checkoutPayload() {
  const copy = JSON.parse(JSON.stringify(EXAMPLE_CANVAS))
  return {
    blocks: Object.fromEntries(copy.blocks.map(b => [b.id, b])),
    arrows: copy.arrows,
    groups: {},
    meta: copy.meta,
  }
}

/** The canvas payload an example opens, or null for an unknown key. */
export function payloadFor(key) {
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
