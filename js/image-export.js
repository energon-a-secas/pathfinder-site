// ════════════════════════════════════════════════════════════
//  image-export.js — Render the canvas to a crisp SVG / PNG
//
//  The diagram is redrawn as a self-contained, native SVG (vector — so
//  it stays sharp at any size) rather than screenshotting the DOM. Blocks
//  become rounded rects with a type badge, title, and description; arrows
//  reuse the same routing math as the live canvas. PNG output rasterizes
//  that SVG at 2× for a high-resolution bitmap.
// ════════════════════════════════════════════════════════════

import { state, ui, canvasMeta } from './state.js'
import { TYPES, PRIORITY_DEFS, STATUS_DEFS, getBlockDims, DEFAULT_WIDTH, escHtml, showToast } from './utils.js'
import { bestPorts, buildPath, arrowMidpoint } from './canvas.js'

const PAD = 48          // outer margin around the diagram
const BADGE_H = 14

// Rough per-character width for the sans title/desc, used to wrap text
// without a DOM measure pass. Tuned to slightly over-estimate so text
// never clips its box.
function wrapText(text, maxWidth, charW) {
  const perLine = Math.max(4, Math.floor(maxWidth / charW))
  const out = []
  String(text).split(/\r?\n/).forEach(para => {
    if (!para) { out.push(''); return }
    let line = ''
    para.split(/\s+/).forEach(word => {
      if (!line) line = word
      else if ((line + ' ' + word).length <= perLine) line += ' ' + word
      else { out.push(line); line = word }
    })
    if (line) out.push(line)
  })
  return out
}

function themeColors() {
  return ui.lightMode
    ? { bg: '#f0f1f5', card: '#ffffff', cardBorder: 'rgba(0,0,0,.14)',
        title: '#1a1a2e', desc: 'rgba(0,0,0,.62)', meta: 'rgba(0,0,0,.55)',
        arrow: 'rgba(0,0,0,.4)', label: 'rgba(0,0,0,.72)', frame: 'rgba(0,0,0,.12)', frameLabel: 'rgba(0,0,0,.5)' }
    : { bg: '#040714', card: '#0a0a1a', cardBorder: 'rgba(255,255,255,.14)',
        title: '#f9f9f9', desc: 'rgba(255,255,255,.6)', meta: 'rgba(255,255,255,.5)',
        arrow: 'rgba(255,255,255,.5)', label: 'rgba(255,255,255,.82)', frame: 'rgba(255,255,255,.1)', frameLabel: 'rgba(255,255,255,.5)' }
}

// Build the diagram SVG string plus its intrinsic pixel size.
// Exported for tests; UI code goes through exportSVG/exportPNG.
export function buildSvg() {
  const ids = Object.keys(state.blocks)
  if (!ids.length) return null
  const C = themeColors()

  // Measure real block heights from the live DOM (falls back to a default).
  const dims = {}
  ids.forEach(id => { dims[id] = getBlockDims(id) })

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  ids.forEach(id => {
    const b = state.blocks[id], { w, h } = dims[id]
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + w); maxY = Math.max(maxY, b.y + h)
  })
  // Include group frames in the bounds too.
  const groups = Object.values(state.groups || {})
  const frameBox = {}
  groups.forEach(g => {
    const members = ids.map(id => state.blocks[id]).filter(b => b.groupId === g.id)
    if (!members.length) return
    let fx1 = Infinity, fy1 = Infinity, fx2 = -Infinity, fy2 = -Infinity
    members.forEach(b => {
      const { w, h } = dims[b.id]
      fx1 = Math.min(fx1, b.x); fy1 = Math.min(fy1, b.y)
      fx2 = Math.max(fx2, b.x + w); fy2 = Math.max(fy2, b.y + h)
    })
    fx1 -= 28; fy1 -= 58; fx2 += 28; fy2 += 28
    frameBox[g.id] = { x: fx1, y: fy1, w: fx2 - fx1, h: fy2 - fy1, label: g.label }
    minX = Math.min(minX, fx1); minY = Math.min(minY, fy1)
    maxX = Math.max(maxX, fx2); maxY = Math.max(maxY, fy2)
  })

  // Everything is drawn in world coordinates inside a translated <g>, so no
  // per-coordinate offsetting (which would mangle elbow H/V path commands).
  const ox = PAD - minX, oy = PAD - minY
  const W = Math.ceil(maxX - minX + PAD * 2)
  const H = Math.ceil(maxY - minY + PAD * 2)

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Avenir Next, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif">`)
  parts.push(`<defs><marker id="ah" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="${C.arrow}"/></marker></defs>`)
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${C.bg}"/>`)
  parts.push(`<g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)})">`)

  // 1. Group frames (behind everything)
  groups.forEach(g => {
    const f = frameBox[g.id]; if (!f) return
    parts.push(`<rect x="${f.x.toFixed(1)}" y="${f.y.toFixed(1)}" width="${f.w.toFixed(1)}" height="${f.h.toFixed(1)}" rx="14" fill="none" stroke="${C.frame}" stroke-width="2"/>`)
    if (f.label) parts.push(`<text x="${(f.x + 14).toFixed(1)}" y="${(f.y + 22).toFixed(1)}" font-size="12" font-weight="600" fill="${C.frameLabel}">${escHtml(f.label)}</text>`)
  })

  // 2. Arrows (under blocks), with labels + notes
  state.arrows.forEach(a => {
    const f = state.blocks[a.from], t = state.blocks[a.to]; if (!f || !t) return
    const pts = bestPorts(a.from, a.to, a.fromPort, a.toPort); if (!pts) return
    const style = a.style || 'curved'
    const d = buildPath(pts.x1, pts.y1, pts.d1, pts.x2, pts.y2, pts.d2, style)
    const color = a.color || C.arrow
    const dash = style === 'dashed' ? ' stroke-dasharray="10 6"' : style === 'dotted' ? ' stroke-dasharray="3 5"' : ''
    parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${a.weight || 2}"${dash} marker-end="url(#ah)"/>`)
    const mid = arrowMidpoint(pts, style)
    const mx = mid.x, my = mid.y
    if (a.label) {
      parts.push(`<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" font-size="11" font-weight="600" text-anchor="middle" dominant-baseline="middle" fill="${C.label}" stroke="${C.bg}" stroke-width="5" paint-order="stroke" stroke-linejoin="round">${escHtml(a.label)}</text>`)
    }
    if (a.note?.trim()) {
      const lines = wrapText(a.note.trim(), 170, 6).slice(0, 4)
      const startY = my + (a.label ? 15 : 4)
      const tspans = lines.map((ln, i) => `<tspan x="${mx.toFixed(1)}" dy="${i === 0 ? 0 : 13}">${escHtml(ln)}</tspan>`).join('')
      parts.push(`<text x="${mx.toFixed(1)}" y="${startY.toFixed(1)}" font-size="10" text-anchor="middle" dominant-baseline="hanging" fill="${C.desc}" stroke="${C.bg}" stroke-width="4" paint-order="stroke" stroke-linejoin="round">${tspans}</text>`)
    }
  })

  // 3. Blocks
  ids.forEach(id => {
    const b = state.blocks[id], { w, h } = dims[id]
    const x = b.x, y = b.y
    const accent = b.color || TYPES[b.type]?.color || '#888'
    const label = TYPES[b.type]?.label || b.type
    const rx = b.type === 'terminator' ? 22 : 10
    parts.push(`<g>`)
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${h}" rx="${rx}" fill="${C.card}" stroke="${C.cardBorder}" stroke-width="1"/>`)
    // Left accent bar
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="3" height="${h}" rx="1.5" fill="${accent}"/>`)
    // Type badge
    parts.push(`<text x="${(x + 12).toFixed(1)}" y="${(y + 18).toFixed(1)}" font-size="9" font-weight="700" letter-spacing="0.7" fill="${accent}">${escHtml(label.toUpperCase())}</text>`)
    // Title (wrapped)
    let ty = y + 38
    if (b.title) {
      wrapText(b.title, w - 26, 6.6).slice(0, 3).forEach((ln, i) => {
        parts.push(`<text x="${(x + 12).toFixed(1)}" y="${(ty + i * 15).toFixed(1)}" font-size="13" font-weight="600" fill="${C.title}">${escHtml(ln)}</text>`)
      })
      ty += Math.min(3, wrapText(b.title, w - 26, 6.6).length) * 15
    }
    // Meta (priority / status)
    const meta = []
    if (b.priority) meta.push((PRIORITY_DEFS[b.priority]?.label || b.priority).toUpperCase())
    if (b.status && b.status !== 'not-started') meta.push(STATUS_DEFS[b.status]?.label || b.status)
    if (meta.length && !b.collapsed) {
      ty += 4
      parts.push(`<text x="${(x + 12).toFixed(1)}" y="${(ty + 8).toFixed(1)}" font-size="9" font-weight="700" fill="${C.meta}">${escHtml(meta.join('  •  '))}</text>`)
      ty += 14
    }
    // Description (wrapped, multi-line) — skip when the block is collapsed
    if (b.description && !b.collapsed) {
      ty += 6
      wrapText(b.description, w - 26, 5.6).slice(0, 8).forEach((ln, i) => {
        parts.push(`<text x="${(x + 12).toFixed(1)}" y="${(ty + i * 13).toFixed(1)}" font-size="11" fill="${C.desc}">${escHtml(ln)}</text>`)
      })
    }
    parts.push(`</g>`)
  })

  parts.push(`</g>`)   // close world-translate group

  // 4. Title watermark (screen coords, bottom-left)
  const title = (canvasMeta.title || '').trim()
  if (title) {
    parts.push(`<text x="${PAD}" y="${(H - 16)}" font-size="12" font-weight="600" fill="${C.meta}">${escHtml(title)}</text>`)
  }

  parts.push(`</svg>`)
  return { svg: parts.join(''), width: W, height: H }
}

function download(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function exportSVG() {
  const built = buildSvg()
  if (!built) { showToast('Add a block first', 'warning'); return }
  download(new Blob([built.svg], { type: 'image/svg+xml' }), 'pathfinder-diagram.svg')
  showToast('Diagram exported as SVG', 'success')
}

export function exportPNG(scale = 2) {
  const built = buildSvg()
  if (!built) { showToast('Add a block first', 'warning'); return }
  const { svg, width, height } = built
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.drawImage(img, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) { showToast('PNG export failed — try SVG instead', 'warning'); return }
      download(blob, 'pathfinder-diagram.png')
      showToast('Diagram exported as PNG (2×)', 'success')
    }, 'image/png')
  }
  img.onerror = () => showToast('PNG export failed — try SVG instead', 'warning')
  img.src = url
}
