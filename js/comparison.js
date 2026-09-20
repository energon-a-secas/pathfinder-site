import { normalizeCanvas } from './normalize.js'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const diff = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(id => {
  const a = before[id], b = after[id]
  if (same(a, b)) return []
  return [{ id, kind: !a ? 'added' : !b ? 'removed' : 'changed', before: a || null, after: b || null,
    fields: a && b ? Object.keys(b).filter(key => !same(a[key], b[key])) : [] }]
})

/** Compare normalized copies. Drawing IDs alone do not make an edge change. */
export function compareCanvases(before, after) {
  const oldCanvas = normalizeCanvas(before), newCanvas = normalizeCanvas(after)
  const edges = canvas => Object.fromEntries(canvas.arrows.map(({ id, ...arrow }) => [JSON.stringify([arrow.from, arrow.to]), arrow]))
  return {
    before: oldCanvas, after: newCanvas,
    blocks: diff(oldCanvas.blocks, newCanvas.blocks),
    arrows: diff(edges(oldCanvas), edges(newCanvas)),
    groups: diff(oldCanvas.groups, newCanvas.groups),
    meta: diff(oldCanvas.meta, newCanvas.meta),
  }
}
