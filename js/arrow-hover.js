// ════════════════════════════════════════════════════════════
//  arrow-hover.js: what a hovered connection shows.
//
//  Hovering a line brightens it and its label and rings the two
//  cards it joins; hovering a card (events.js marks its lines
//  .related) is mirrored onto the labels, which live in their
//  own layer. canvas.js re-exports all of it.
// ════════════════════════════════════════════════════════════

import { state } from './state.js'
import { $, getBlockDims } from './utils.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Mirror each line's hover state onto its label. The card-hover code marks
 * the line's group `.related`; the label lives in another layer, so it
 * needs the same class to fade and show its note in step.
 */
export function syncArrowStates() {
  const group = $.arrowsGroup(); if (!group) return
  let layer = null
  const related = new Set(), hovered = new Set()
  for (const el of group.children) {
    if (el.classList?.contains('arrow-labels')) { layer = el; continue }
    const aid = el.dataset?.aid; if (!aid) continue
    if (el.classList.contains('related')) related.add(aid)
    if (el.classList.contains('hover')) hovered.add(aid)
  }
  if (!layer) return
  for (const t of layer.children) {
    const aid = t.dataset?.aid; if (!aid) continue
    t.classList.toggle('related', related.has(aid))
    t.classList.toggle('hover', hovered.has(aid))
  }
}

/** Drop labels whose connection is gone (deleteArrow removes only the line). */
export function pruneArrowLabels() {
  const group = $.arrowsGroup(); if (!group) return
  const live = new Set(state.arrows.map(a => a.id))
  group.querySelectorAll('.arrow-labels > [data-aid], .arrow-hits > [data-aid]').forEach(t => {
    if (!live.has(t.dataset.aid)) t.remove()
  })
}

// Hovering a connection brightens it (and its label) and marks the two
// cards it joins, so you can see what it connects before you click it.
let hoverWired = false
export function setupArrowHover() {
  const layer = $.arrowsLayer(), root = $.canvasRoot()
  if (!layer || !root || hoverWired) return
  hoverWired = true
  let current = null, ends = []
  const clear = () => {
    if (!current) return
    $.arrowsGroup()?.querySelectorAll('.hover').forEach(el => el.classList.remove('hover'))
    $.arrowsGroup()?.querySelector(':scope > .arrow-rings')?.replaceChildren()
    root.classList.remove('edge-hover')
    ends.forEach(el => el.classList.remove('edge-end'))
    current = null; ends = []
  }
  const show = aid => {
    const a = state.arrows.find(x => x.id === aid)
    if (!a) return
    current = aid
    for (const el of $.arrowsGroup().querySelectorAll('[data-aid]')) {
      if (el.dataset.aid === aid && !el.classList.contains('arrow-handle')) el.classList.add('hover')
    }
    root.classList.add('edge-hover')
    ends = [a.from, a.to].map(id => document.getElementById('b-' + id)).filter(Boolean)
    ends.forEach(el => el.classList.add('edge-end'))
    drawEndRings([a.from, a.to])
  }
  layer.addEventListener('pointerover', e => {
    const g = e.target.closest?.('[data-aid]')
    const aid = g?.dataset.aid || null
    if (aid === current) return
    clear()
    if (aid) show(aid)
  })
  layer.addEventListener('pointerout', e => {
    const to = e.relatedTarget?.closest?.('[data-aid]')
    if (to && to.dataset.aid === current) return
    clear()
  })
  // The card-hover handler rewrites `.related` on lines; mirror it onto the
  // labels once it has run, whatever order the listeners were added in.
  const sync = () => queueMicrotask(syncArrowStates)
  root.addEventListener('pointerover', sync)
  root.addEventListener('pointerout', sync)
}

// A ring around each card a hovered line joins. Drawn in the arrows layer,
// which sits under the cards, so it shows as an outline just outside the
// card and leaves the card's own styles (selection, highlight) alone.
function drawEndRings(ids) {
  const group = $.arrowsGroup(); if (!group) return
  let rings = group.querySelector(':scope > .arrow-rings')
  if (!rings) {
    rings = document.createElementNS(SVG_NS, 'g')
    rings.setAttribute('class', 'arrow-rings')
    group.prepend(rings)
  }
  rings.replaceChildren(...[...new Set(ids)].filter(id => state.blocks[id]).map(id => {
    const b = state.blocks[id], { w, h } = getBlockDims(id)
    const r = document.createElementNS(SVG_NS, 'rect')
    r.setAttribute('class', 'arrow-end-ring')
    r.setAttribute('x', b.x - 4); r.setAttribute('y', b.y - 4)
    r.setAttribute('width', w + 8); r.setAttribute('height', h + 8)
    r.setAttribute('rx', b.type === 'terminator' ? 26 : 14)
    r.dataset.bid = id
    return r
  }))
}
