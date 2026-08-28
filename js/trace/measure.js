// ════════════════════════════════════════════════════════════
//  trace/measure.js: Box sizes computed from content
//
//  A trace never measures the DOM. That is the whole reason one renderer
//  can serve the screen, the SVG file and the iframe: the canvas has to
//  measure live cards (getBlockDims) and therefore needs a second,
//  parallel exporter that re-derives everything, and the two can drift.
//  Here the size of a box is a pure function of its text, so the picture
//  is identical everywhere and identical between runs.
//
//  The cost is that widths are approximated rather than measured. The
//  table below deliberately rounds up, so a box is occasionally a few
//  pixels roomier than it needs to be and never clips.
// ════════════════════════════════════════════════════════════

import { BOX } from './model.js'

// Per-character advance as a fraction of font size, for the UI sans stack.
// Grouped rather than per-glyph: the error that matters is a box too small,
// and grouping errs wide.
const NARROW = "iljtIf.,;:'\"!|`()[]{}-"
const WIDE   = 'mwMW@%'
const CAPS   = 'ABCDEFGHJKLNOPQRSTUVXYZ'

export function textWidth(s, size) {
  let u = 0
  for (const ch of String(s)) {
    if (ch === ' ') u += 0.27
    else if (NARROW.includes(ch)) u += 0.30
    else if (WIDE.includes(ch)) u += 0.88
    else if (CAPS.includes(ch)) u += 0.67
    else u += 0.545
  }
  return u * size
}

// Monospace is exact, which is why probe commands get their own metric
// instead of going through the table above.
export const MONO_RATIO = 0.601
export const monoWidth = (s, size) => String(s).length * size * MONO_RATIO

/**
 * Wrap to a pixel width.
 *
 * Single newlines are folded, blank lines are paragraph breaks: Markdown's
 * rule, and what authors actually mean. YAML's own `|` preserves every
 * newline, so prose written in a `|` block came out broken at whatever
 * column the author happened to wrap the source file at, which looked like
 * a renderer bug and was really a format trap. `fold: false` keeps every
 * line, which is what a list of shell commands needs.
 */
export function wrap(text, maxW, size, widthOf = textWidth, fold = true) {
  const out = []
  const paras = fold
    ? String(text ?? '').split(/\r?\n\s*\r?\n/).map(p => p.replace(/\s*\r?\n\s*/g, ' '))
    : String(text ?? '').split(/\r?\n/)
  paras.forEach(para => {
    if (!para.trim()) { if (out.length) out.push(''); return }
    let line = ''
    para.trim().split(/\s+/).forEach(word => {
      const probe = line ? line + ' ' + word : word
      if (widthOf(probe, size) <= maxW) { line = probe; return }
      if (line) out.push(line)
      if (widthOf(word, size) <= maxW) { line = word; return }
      // A URL or a long flag: hard-break it.
      let chunk = ''
      for (const ch of word) {
        if (widthOf(chunk + ch, size) > maxW && chunk) { out.push(chunk); chunk = ch }
        else chunk += ch
      }
      line = chunk
    })
    if (line) out.push(line)
  })
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

/**
 * Choose a box width, then lay the text out inside it.
 *
 * Width is picked before wrapping: try the widest allowed, and if every
 * line comes back comfortably shorter, pull the box in to the longest
 * line. Without that pass a three-word node gets a 300px box and the
 * diagram reads as mostly empty rectangles.
 */
export function measureNode(node, opts = {}) {
  const B = { ...BOX, ...opts }
  const inner = B.maxW - B.padX * 2

  let titleLines = wrap(node.title, inner, B.titleSize)
  let detailLines = node.detail ? wrap(node.detail, inner, B.bodySize) : []
  let probeLines = []
  for (const p of node.probes || []) probeLines.push(...wrap(p, inner, B.probeSize, monoWidth, false))

  const widest = Math.max(
    0,
    ...titleLines.map(l => textWidth(l, B.titleSize)),
    ...detailLines.map(l => textWidth(l, B.bodySize)),
    ...probeLines.map(l => monoWidth(l, B.probeSize)),
  )
  const w = Math.round(Math.min(B.maxW, Math.max(B.minW, widest + B.padX * 2)))

  // Re-wrap at the chosen width. Shrinking can change the break points, and
  // a box sized against the old wrap is the classic off-by-one-line clip.
  if (w < B.maxW) {
    const inner2 = w - B.padX * 2
    titleLines = wrap(node.title, inner2, B.titleSize)
    detailLines = node.detail ? wrap(node.detail, inner2, B.bodySize) : []
    probeLines = []
    for (const p of node.probes || []) probeLines.push(...wrap(p, inner2, B.probeSize, monoWidth, false))
  }

  let h = B.padY
  h += B.badgeH + 4
  h += titleLines.length * B.titleLead
  if (detailLines.length) h += B.gapAfterTitle + detailLines.length * B.bodyLead
  if (probeLines.length)  h += B.gapAfterTitle + 6 + probeLines.length * B.probeLead + 6
  if (node.ref) h += 14
  h += B.padY

  return { w, h: Math.round(h), titleLines, detailLines, probeLines }
}

/** Measure every node once. Returns a Map id -> box. */
export function measureAll(nodes, opts) {
  const m = new Map()
  nodes.forEach(n => m.set(n.id, measureNode(n, opts)))
  return m
}
