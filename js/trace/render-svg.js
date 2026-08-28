// ════════════════════════════════════════════════════════════
//  trace/render-svg.js: A scene to SVG
//
//  The only renderer. What you see on screen is this string; the file
//  download is this string; the iframe is this string. There is no second
//  code path to keep in sync, which is the deliberate difference from the
//  canvas (index.html draws DOM cards and image-export.js re-derives an
//  SVG from a DOM measure pass, and the two can disagree).
//
//  Kind is carried by border colour, a badge, and an accent bar, not by
//  silhouette. A diamond wastes most of its area on a question long
//  enough to be worth asking, which is why real troubleshooting trees
//  drawn in Mermaid end up unreadable.
// ════════════════════════════════════════════════════════════

import { NODE_KINDS, TOPO_KINDS, LINK_STATES, BOX } from './model.js'
import { textWidth, monoWidth } from './measure.js'

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export const THEMES = {
  dark: {
    bg: '#070b16', surface: '#0d1220', surfaceAlt: '#131a2c', probeBg: '#05080f',
    title: '#f2f5fb', body: 'rgba(232,238,250,.68)', meta: 'rgba(232,238,250,.5)',
    edge: 'rgba(210,222,245,.58)', label: '#e8eefa', labelBg: '#0d1220',
    container: 'rgba(255,255,255,.16)', containerFill: 'rgba(255,255,255,.022)',
  },
  light: {
    bg: '#f5f6fa', surface: '#ffffff', surfaceAlt: '#f0f2f8', probeBg: '#eef1f7',
    title: '#12172a', body: 'rgba(18,23,42,.7)', meta: 'rgba(18,23,42,.55)',
    edge: 'rgba(18,23,42,.5)', label: '#12172a', labelBg: '#ffffff',
    container: 'rgba(18,23,42,.2)', containerFill: 'rgba(18,23,42,.02)',
  },
}

const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

/** Blend a hex colour toward a target, for tints that read on both themes. */
function mix(hex, alpha) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function nodeMeta(node, traceKind) {
  const set = traceKind === 'topology' ? TOPO_KINDS : NODE_KINDS
  return set[node.kind] || { label: node.kind, color: '#94a3b8' }
}

// ── one box ──────────────────────────────────────────────────
function drawNode(n, traceKind, T) {
  const { rect: r, box } = n
  const km = nodeMeta(n, traceKind)
  const c = km.color
  const dashed = n.kind === 'deadend'
  const bare = n.kind === 'note'
  const out = []

  const fill = bare ? mix(c, 0.07) : T.surface
  const stroke = bare ? mix(c, 0.3) : c
  out.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10" `
    + `fill="${fill}" stroke="${stroke}" stroke-width="${bare ? 1 : 1.5}"`
    + `${dashed ? ' stroke-dasharray="6 4"' : ''}/>`)

  // Accent bar. A cause or a fix is the answer somebody came for, so it
  // gets the loud one; everything else gets a hairline.
  const loud = n.kind === 'cause' || n.kind === 'fix'
  if (!bare) out.push(`<rect x="${r.x + 1}" y="${r.y + 1}" width="${loud ? 5 : 3}" height="${r.h - 2}" `
    + `fill="${c}" opacity="${loud ? 0.95 : 0.55}" clip-path="inset(0 round 9px 0 0 9px)"/>`)

  let y = r.y + BOX.padY
  const x = r.x + BOX.padX

  // badge
  const bw = Math.round(textWidth(km.label.toUpperCase(), 9) + 14)
  out.push(`<rect x="${x}" y="${y}" width="${bw}" height="${BOX.badgeH}" rx="${BOX.badgeH / 2}" fill="${mix(c, 0.18)}" stroke="${mix(c, 0.4)}" stroke-width="0.75"/>`)
  out.push(`<text x="${x + 7}" y="${y + BOX.badgeH - 4.5}" font-family="${FONT}" font-size="9" font-weight="700" letter-spacing="0.6" fill="${c}">${esc(km.label.toUpperCase())}</text>`)
  y += BOX.badgeH + 4

  // title
  box.titleLines.forEach(line => {
    y += BOX.titleLead
    out.push(`<text x="${x}" y="${y - 5}" font-family="${FONT}" font-size="${BOX.titleSize}" font-weight="650" fill="${T.title}">${esc(line)}</text>`)
  })

  // detail
  if (box.detailLines.length) {
    y += BOX.gapAfterTitle
    box.detailLines.forEach(line => {
      y += BOX.bodyLead
      out.push(`<text x="${x}" y="${y - 4}" font-family="${FONT}" font-size="${BOX.bodySize}" fill="${T.body}">${esc(line)}</text>`)
    })
  }

  // probe strip
  if (box.probeLines.length) {
    y += BOX.gapAfterTitle
    const ph = box.probeLines.length * BOX.probeLead + 12
    out.push(`<rect x="${x - 5}" y="${y}" width="${r.w - BOX.padX * 2 + 10}" height="${ph}" rx="5" fill="${T.probeBg}" stroke="${mix(c, 0.22)}" stroke-width="0.75"/>`)
    let py = y + 6
    box.probeLines.forEach(line => {
      py += BOX.probeLead
      const comment = line.trim().startsWith('#')
      out.push(`<text x="${x}" y="${py - 4}" font-family="${MONO}" font-size="${BOX.probeSize}" fill="${comment ? T.meta : mix(c, 0.95)}">${esc(line)}</text>`)
    })
    y += ph
  }

  if (n.ref) {
    y += 13
    out.push(`<text x="${x}" y="${y - 3}" font-family="${FONT}" font-size="10" fill="${T.meta}">${esc(shortRef(n.ref))}</text>`)
  }

  return out.join('\n')
}

function shortRef(ref) {
  try { const u = new URL(ref); return u.hostname.replace(/^www\./, '') + ' ↗' }
  catch (_) { return ref.length > 40 ? ref.slice(0, 38) + '…' : ref }
}

// ── containers ───────────────────────────────────────────────
function drawContainer(c, T) {
  const r = c.rect
  const km = TOPO_KINDS[c.kind] || { label: c.kind, color: '#94a3b8' }
  const out = []
  out.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="12" `
    + `fill="${mix(km.color, 0.035)}" stroke="${mix(km.color, 0.45)}" stroke-width="1.25" stroke-dasharray="9 5"/>`)
  const label = c.title
  out.push(`<text x="${r.x + 14}" y="${r.y + 17}" font-family="${FONT}" font-size="11.5" font-weight="700" letter-spacing="0.4" fill="${km.color}">${esc(label)}</text>`)
  return out.join('\n')
}

// ── edges ────────────────────────────────────────────────────
const edgeColor = (e, T) => (LINK_STATES[e.state] || LINK_STATES.branch).color || T.edge

function drawEdgePath(e, T) {
  const st = LINK_STATES[e.state] || LINK_STATES.branch
  return `<path d="${e.path}" fill="none" stroke="${edgeColor(e, T)}" stroke-width="1.75"`
    + `${st.dash ? ` stroke-dasharray="${st.dash}"` : ''} marker-end="url(#ah-${e.state})" stroke-linejoin="round"/>`
}

/**
 * A label sits in its own plate, and the plates are drawn in a pass after
 * the boxes. Mermaid prints branch text straight onto the line, which is
 * why two branches out of one decision routinely overprint each other;
 * drawing labels before the boxes just moves the problem, because a label
 * landing over a box then disappears behind it.
 */
function drawEdgeLabel(e, T) {
  if (!e.label) return ''
  const color = edgeColor(e, T)
  const w = Math.round(textWidth(e.label, 11) + 14)
  const h = 18
  const mx = Math.round(e.mid.x - w / 2), my = Math.round(e.mid.y - h / 2)
  return `<rect x="${mx}" y="${my}" width="${w}" height="${h}" rx="9" fill="${T.labelBg}" `
    + `stroke="${mix(color.startsWith('#') ? color : '#94a3b8', 0.5)}" stroke-width="0.9"/>\n`
    + `<text x="${mx + w / 2}" y="${my + h - 5.5}" text-anchor="middle" font-family="${FONT}" `
    + `font-size="11" font-weight="550" fill="${T.label}">${esc(e.label)}</text>`
}

// ── document ─────────────────────────────────────────────────
export function renderSvg(scene, opts = {}) {
  const T = THEMES[opts.theme === 'light' ? 'light' : 'dark']
  const traceKind = scene.meta.kind
  const showBg = opts.background !== false

  const markers = Object.entries(LINK_STATES).map(([k, v]) => {
    const color = v.color || T.edge
    return `<marker id="ah-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">`
      + `<path d="M 0 1 L 10 5 L 0 9 z" fill="${color}"/></marker>`
  }).join('\n')

  // Paint order is the whole trick: boundaries, then wires, then boxes,
  // then the wires' labels on top of everything.
  const body = [
    scene.containers.map(c => drawContainer(c, T)).join('\n'),
    scene.edges.map(e => drawEdgePath(e, T)).join('\n'),
    scene.nodes.map(n => drawNode(n, traceKind, T)).join('\n'),
    scene.edges.map(e => drawEdgeLabel(e, T)).filter(Boolean).join('\n'),
  ].join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" `
    + `viewBox="0 0 ${scene.width} ${scene.height}" font-family="${FONT}">\n`
    + `<defs>\n${markers}\n</defs>\n`
    + (showBg ? `<rect width="${scene.width}" height="${scene.height}" fill="${T.bg}"/>\n` : '')
    + body + `\n</svg>`
}
