// ════════════════════════════════════════════════════════════
//  command-rows.js: one row of the command palette, as markup.
//
//  [lead: type dot, swatch or line icon] [label, matched letters
//  in bold] [hint] [state] [where it lives] [shortcut] [more >]
//
//  A row is an ARIA option; the palette's field points at the
//  active one. State reads as words too (", on", ", current"),
//  never as the check mark alone, and so does a row with a list
//  behind it (", opens a list"): ARIA allows no aria-haspopup on an
//  option, so the caret's meaning is spoken instead.
// ════════════════════════════════════════════════════════════

import { escHtml } from './utils.js'

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
const CARET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'

/** The label with its matched letters in bold. `hits` are character indices. */
export function markedLabel(text, hits) {
  if (!hits?.length) return escHtml(text)
  const on = new Set(hits)
  let html = '', run = ''
  let i = 0
  const flush = () => { if (run) { html += `<b class="cmdk-hit">${escHtml(run)}</b>`; run = '' } }
  for (const ch of String(text)) {
    if (on.has(i)) run += ch
    else { flush(); html += escHtml(ch) }
    i += ch.length
  }
  flush()
  return html
}

function keysHtml(shortcut) {
  if (!shortcut) return ''
  // A chord ("N G") is two keys; anything else is one.
  const parts = /^\S{1,3} \S{1,3}$/.test(shortcut) ? shortcut.split(' ') : [shortcut]
  return `<span class="cmdk-keys">${parts.map(p => `<kbd class="cmdk-kbd">${escHtml(p)}</kbd>`).join('')}</span>`
}

function leadHtml(row) {
  if (row.dot) return `<span class="cmdk-lead"><span class="pf-menu-dot cmdk-dot"${row.dotShape ? ` data-shape="${escHtml(row.dotShape)}"` : ''} style="background:${escHtml(row.dot)}"></span></span>`
  if (row.swatch) return `<span class="cmdk-lead"><span class="cmdk-swatch" style="background:${escHtml(row.swatch)}"></span></span>`
  if (row.icon) return `<span class="cmdk-lead cmdk-icon">${row.icon}</span>`
  return '<span class="cmdk-lead"></span>'
}

// A toggle says on or off; one of a set of values says which is current.
function stateHtml(row) {
  if (row.checked === undefined) return ''
  if (row.radio) return row.checked ? `<span class="cmdk-state">${CHECK}</span><span class="sr-only">, current</span>` : ''
  return row.checked ? `<span class="cmdk-state">${CHECK}</span><span class="sr-only">, on</span>` : '<span class="sr-only">, off</span>'
}

/** The option element for `row`, numbered `n` in the list. */
export function rowEl(row, hits, n) {
  const el = document.createElement('div')
  el.className = 'cmdk-row' + (row.danger ? ' cmdk-danger' : '')
  el.id = `cmdk-opt-${n}`
  el.setAttribute('role', 'option')
  el.setAttribute('aria-selected', 'false')
  if (row.disabled) el.setAttribute('aria-disabled', 'true')
  el.innerHTML =
    leadHtml(row) +
    // dir=auto: a title written right to left reads right to left.
    `<span class="cmdk-text"><span class="cmdk-label" dir="auto">${markedLabel(row.label, hits)}</span>` +
    (row.hint ? `<span class="cmdk-hint">${escHtml(row.hint)}</span>` : '') + '</span>' +
    stateHtml(row) +
    (row.meta ? `<span class="cmdk-meta">${escHtml(row.meta)}</span>` : '') +
    keysHtml(row.shortcut) +
    (row.children ? `<span class="cmdk-caret" aria-hidden="true">${CARET}</span><span class="sr-only">, opens a list</span>` : '')
  return el
}
