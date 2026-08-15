// ════════════════════════════════════════════════════════════
//  layout.js — Layered ("Sugiyama") auto-layout for the canvas.
//
//  Four stages, the standard ones: break cycles, assign layers,
//  order within each layer to minimise crossings, then assign
//  coordinates. Written out longhand because the project ships no
//  dependencies, and because a flow graph of goals and decisions
//  is exactly the shape this algorithm was designed for. A
//  force-directed layout would give clusters, which is the wrong
//  answer for a diagram people read left to right.
//
//  `layoutGraph` is pure: sizes in, positions out. `tidyCanvas`
//  is the thin app-facing wrapper that reads state and writes
//  block positions.
// ════════════════════════════════════════════════════════════

import { state, snapshot } from './state.js'
import { getBlockDims } from './utils.js'

export const LAYOUT_DEFAULTS = {
  direction: 'LR',   // 'LR' left to right, 'TB' top to bottom
  layerGap:  120,    // clearance between one layer and the next
  nodeGap:   38,     // clearance between siblings inside a layer
  sweeps:    6,      // crossing-reduction passes
}

// ── 1. Cycle breaking ────────────────────────────────────────

/**
 * Reverse the edges that close a cycle, so the rest of the pipeline
 * can assume a DAG. Returns the acyclic edge list plus the set of
 * edges that were flipped, which the caller needs in order to draw
 * them back the right way round.
 */
export function breakCycles(nodeIds, edges) {
  const out = new Map(nodeIds.map(id => [id, []]))
  edges.forEach((e, i) => { if (out.has(e.from)) out.get(e.from).push(i) })

  const WHITE = 0, GREY = 1, BLACK = 2
  const color = new Map(nodeIds.map(id => [id, WHITE]))
  const reversed = new Set()

  // Iterative DFS. A canvas is small, but recursion here would be one
  // more thing that can blow up on a pathological import.
  for (const root of nodeIds) {
    if (color.get(root) !== WHITE) continue
    const stack = [{ id: root, next: 0 }]
    color.set(root, GREY)
    while (stack.length) {
      const frame = stack[stack.length - 1]
      const list = out.get(frame.id) || []
      if (frame.next >= list.length) { color.set(frame.id, BLACK); stack.pop(); continue }
      const ei = list[frame.next++]
      const target = edges[ei].to
      if (!color.has(target)) continue
      const c = color.get(target)
      if (c === GREY) { reversed.add(ei) }
      else if (c === WHITE) { color.set(target, GREY); stack.push({ id: target, next: 0 }) }
    }
  }

  const acyclic = edges.map((e, i) => reversed.has(i)
    ? { from: e.to, to: e.from, index: i, reversed: true }
    : { from: e.from, to: e.to, index: i, reversed: false })
  return { acyclic, reversed }
}

// ── 2. Layer assignment ──────────────────────────────────────

export function assignLayers(nodeIds, acyclic) {
  const incoming = new Map(nodeIds.map(id => [id, []]))
  const outgoing = new Map(nodeIds.map(id => [id, []]))
  acyclic.forEach(e => {
    if (!incoming.has(e.to) || !outgoing.has(e.from)) return
    incoming.get(e.to).push(e.from)
    outgoing.get(e.from).push(e.to)
  })

  // Longest path from the sources. Kahn's ordering keeps it linear and
  // gives a topological order we reuse for the tightening pass.
  const indeg = new Map(nodeIds.map(id => [id, incoming.get(id).length]))
  const queue = nodeIds.filter(id => indeg.get(id) === 0)
  const layer = new Map(nodeIds.map(id => [id, 0]))
  const topo = []
  const q = [...queue]
  while (q.length) {
    const id = q.shift()
    topo.push(id)
    outgoing.get(id).forEach(t => {
      layer.set(t, Math.max(layer.get(t), layer.get(id) + 1))
      indeg.set(t, indeg.get(t) - 1)
      if (indeg.get(t) === 0) q.push(t)
    })
  }
  // Anything left is inside a cycle the breaker missed (parallel back
  // edges can do it). Park it after its deepest known predecessor.
  nodeIds.forEach(id => { if (!topo.includes(id)) topo.push(id) })

  // Tighten: a node with successors sits as late as it can. This pulls
  // dangling inputs next to the thing they feed instead of stranding
  // them in the first column.
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i]
    const succ = outgoing.get(id)
    if (!succ.length) continue
    const earliest = Math.min(...succ.map(s => layer.get(s)))
    if (earliest - 1 > layer.get(id)) layer.set(id, earliest - 1)
  }

  return { layer, incoming, outgoing }
}

// ── 3. Crossing reduction ────────────────────────────────────

function countCrossings(upper, lower, neighborsOf) {
  const posUpper = new Map(upper.map((id, i) => [id, i]))
  const pairs = []
  lower.forEach((id, li) => {
    neighborsOf(id).forEach(n => {
      if (posUpper.has(n)) pairs.push([li, posUpper.get(n)])
    })
  })
  let crossings = 0
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a1, b1] = pairs[i], [a2, b2] = pairs[j]
      if ((a1 - a2) * (b1 - b2) < 0) crossings++
    }
  }
  return crossings
}

function medianOf(values) {
  if (!values.length) return -1
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Order nodes inside each layer so edges cross as little as possible.
 * The median heuristic with alternating sweeps, keeping the best
 * ordering seen rather than the last one, which can be worse.
 */
export function orderLayers(layers, incoming, outgoing, groupOf, sweeps) {
  let best = layers.map(l => [...l])
  let bestScore = totalCrossings(best, incoming)
  let current = layers.map(l => [...l])

  for (let pass = 0; pass < sweeps; pass++) {
    const down = pass % 2 === 0
    const range = down ? [...current.keys()] : [...current.keys()].reverse()
    for (const li of range) {
      const ref = down ? current[li - 1] : current[li + 1]
      if (!ref) continue
      const refPos = new Map(ref.map((id, i) => [id, i]))
      const src = down ? incoming : outgoing
      const keyed = current[li].map((id, i) => {
        const ns = (src.get(id) || []).map(n => refPos.get(n)).filter(v => v != null)
        return { id, i, med: medianOf(ns) }
      })
      keyed.sort((a, b) => {
        // A node with no neighbour in the reference layer has no opinion;
        // leave it where it was rather than dragging it to one end.
        if (a.med < 0 && b.med < 0) return a.i - b.i
        if (a.med < 0) return a.i - b.i
        if (b.med < 0) return a.i - b.i
        if (a.med !== b.med) return a.med - b.med
        // Same median: keep frame members together, then stay stable.
        const ga = groupOf(a.id) || '', gb = groupOf(b.id) || ''
        if (ga !== gb) return ga < gb ? -1 : 1
        return a.i - b.i
      })
      current[li] = keyed.map(k => k.id)
    }
    const score = totalCrossings(current, incoming)
    if (score < bestScore) { bestScore = score; best = current.map(l => [...l]) }
  }
  return { layers: best, crossings: bestScore }
}

function totalCrossings(layers, incoming) {
  let n = 0
  for (let i = 1; i < layers.length; i++) {
    n += countCrossings(layers[i - 1], layers[i], id => incoming.get(id) || [])
  }
  return n
}

// ── 4. Coordinates ───────────────────────────────────────────

/**
 * Lay out a graph.
 *
 * @param {Array<{id,w,h,groupId?}>} nodes
 * @param {Array<{from,to}>} edges
 * @param {object} [opts]
 * @returns {{positions: Map<string,{x,y}>, layerOf: Map<string,number>, crossings: number, reversed: Set<number>}}
 */
export function layoutGraph(nodes, edges, opts = {}) {
  const O = { ...LAYOUT_DEFAULTS, ...opts }
  const horiz = O.direction !== 'TB'
  const byId = new Map(nodes.map(n => [n.id, n]))
  const allIds = nodes.map(n => n.id)
  const valid = edges.filter(e => byId.has(e.from) && byId.has(e.to) && e.from !== e.to)

  // Blocks with no connections say nothing about the flow. Lay the graph
  // out without them and park them in a trailing lane, so one stray note
  // cannot stretch the whole diagram.
  const connected = new Set()
  valid.forEach(e => { connected.add(e.from); connected.add(e.to) })
  const graphIds = allIds.filter(id => connected.has(id))
  const loose = allIds.filter(id => !connected.has(id))

  const { acyclic, reversed } = breakCycles(graphIds, valid)
  const { layer, incoming, outgoing } = assignLayers(graphIds, acyclic)

  const maxLayer = graphIds.length ? Math.max(...graphIds.map(id => layer.get(id))) : -1
  const layers = []
  for (let i = 0; i <= maxLayer; i++) layers.push([])
  graphIds.forEach(id => layers[layer.get(id)].push(id))

  const groupOf = id => byId.get(id)?.groupId || null
  const ordered = layers.length
    ? orderLayers(layers, incoming, outgoing, groupOf, O.sweeps)
    : { layers: [], crossings: 0 }

  // Loose blocks become one more lane at the end.
  const finalLayers = ordered.layers.map(l => [...l])
  if (loose.length) finalLayers.push(loose)

  // Along-axis: each layer starts after the widest node of the last.
  const mainStart = []
  let cursor = 0
  finalLayers.forEach(l => {
    mainStart.push(cursor)
    const extent = Math.max(0, ...l.map(id => horiz ? byId.get(id).w : byId.get(id).h))
    cursor += extent + O.layerGap
  })

  // Cross-axis: stack, then straighten toward the neighbours' centres.
  const cross = new Map()
  finalLayers.forEach(l => {
    let c = 0
    l.forEach(id => {
      const n = byId.get(id)
      cross.set(id, c)
      c += (horiz ? n.h : n.w) + O.nodeGap
    })
  })

  const sizeOf = id => { const n = byId.get(id); return horiz ? n.h : n.w }
  const centerOf = id => cross.get(id) + sizeOf(id) / 2

  for (let pass = 0; pass < 4; pass++) {
    const down = pass % 2 === 0
    const range = down ? [...finalLayers.keys()] : [...finalLayers.keys()].reverse()
    for (const li of range) {
      const l = finalLayers[li]
      const src = down ? incoming : outgoing
      // Desired centre = median of whatever this node is wired to.
      const want = new Map()
      l.forEach(id => {
        const ns = (src.get(id) || []).filter(n => cross.has(n)).map(centerOf)
        if (ns.length) want.set(id, medianOf(ns))
      })
      // Apply in order, never letting a node pass its neighbour.
      let floor = -Infinity
      l.forEach(id => {
        const size = sizeOf(id)
        const target = want.has(id) ? want.get(id) - size / 2 : cross.get(id)
        const placed = Math.max(target, floor)
        cross.set(id, placed)
        floor = placed + size + O.nodeGap
      })
    }
  }

  // Normalise so the diagram starts at the origin.
  let minCross = Infinity
  finalLayers.flat().forEach(id => { minCross = Math.min(minCross, cross.get(id)) })
  if (!Number.isFinite(minCross)) minCross = 0

  const positions = new Map()
  finalLayers.forEach((l, li) => {
    l.forEach(id => {
      const main = mainStart[li]
      const c = cross.get(id) - minCross
      positions.set(id, horiz ? { x: main, y: c } : { x: c, y: main })
    })
  })

  return { positions, layerOf: layer, crossings: ordered.crossings, reversed }
}

// ── App-facing wrapper ───────────────────────────────────────

/**
 * Re-lay the whole canvas. Takes exactly one undo snapshot, so a single
 * Cmd+Z puts every block back where it was: an auto-layout you cannot
 * cleanly reverse is one nobody dares press.
 *
 * Block positions are written directly; the caller is responsible for
 * re-rendering and for any animation.
 */
export function tidyCanvas({ direction = 'LR' } = {}) {
  const ids = Object.keys(state.blocks)
  if (ids.length < 2) return { moved: 0, crossings: 0 }

  const nodes = ids.map(id => {
    const { w, h } = getBlockDims(id)
    return { id, w, h, groupId: state.blocks[id].groupId }
  })
  const edges = state.arrows
    .filter(a => state.blocks[a.from] && state.blocks[a.to])
    .map(a => ({ from: a.from, to: a.to, id: a.id }))

  const { positions, layerOf, crossings } = layoutGraph(nodes, edges, { direction })

  // Keep the diagram where the user left it rather than teleporting it to
  // the origin: anchor the new layout on the old bounding box's top-left.
  const anchorX = Math.min(...ids.map(id => state.blocks[id].x))
  const anchorY = Math.min(...ids.map(id => state.blocks[id].y))

  snapshot()
  let moved = 0
  ids.forEach(id => {
    const p = positions.get(id); if (!p) return
    const b = state.blocks[id]
    const nx = Math.round(p.x + anchorX), ny = Math.round(p.y + anchorY)
    if (nx !== b.x || ny !== b.y) moved++
    b.x = nx; b.y = ny
  })

  // Point every connection along the flow. Edges that run backwards or
  // stay inside a layer leave from the perpendicular sides instead, so
  // they read as returns rather than fighting the forward traffic.
  const horiz = direction !== 'TB'
  const fwd  = horiz ? ['right', 'left']   : ['bottom', 'top']
  const back = horiz ? ['bottom', 'bottom'] : ['right', 'right']
  state.arrows.forEach(a => {
    if (!state.blocks[a.from] || !state.blocks[a.to]) return
    const lf = layerOf.get(a.from), lt = layerOf.get(a.to)
    const forward = lf != null && lt != null && lt > lf
    ;[a.fromPort, a.toPort] = forward ? fwd : back
  })

  return { moved, crossings }
}
