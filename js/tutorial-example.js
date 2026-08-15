// ════════════════════════════════════════════════════════════
//  tutorial-example.js — Load the worked example into the canvas.
//
//  The canvas travels in the URL hash, the same route a Share link
//  takes, so the app's existing importer handles it and an existing
//  canvas still gets a replace-or-merge prompt first.
// ════════════════════════════════════════════════════════════

import { EXAMPLE_CANVAS } from './example-canvas.js'

const btn = document.getElementById('loadExample')
if (btn) {
  btn.addEventListener('click', () => {
    try {
      const payload = {
        blocks: Object.fromEntries(EXAMPLE_CANVAS.blocks.map(b => [b.id, b])),
        arrows: EXAMPLE_CANVAS.arrows,
        groups: {},
        meta: EXAMPLE_CANVAS.meta,
      }
      location.href = './#s=' + btoa(encodeURIComponent(JSON.stringify(payload)))
    } catch (_) {
      btn.textContent = 'Could not build the link. Open the canvas and use a template instead.'
      btn.disabled = true
    }
  })
}
