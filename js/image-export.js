// ════════════════════════════════════════════════════════════
//  image-export.js: render the canvas to a crisp SVG / PNG
//
//  The diagram is redrawn as a self-contained, native SVG (vector, so
//  it stays sharp at any size) rather than screenshotting the DOM. Blocks
//  follow the card spec (a neutral type label beside a type dot, 14px
//  titles, 12px descriptions clamped to three lines, 10px badges, the
//  highlight ring with its word); arrows reuse the same routing math as
//  the live canvas. PNG output rasterizes that SVG at 2x.
// ════════════════════════════════════════════════════════════

import { state, ui, canvasMeta } from './state.js'
import { TYPES, PRIORITY_DEFS, STATUS_DEFS, DEFAULT_CARD_STYLE, HIGHLIGHTS, getBlockDims, escHtml, showToast } from './utils.js'
import { paintColorFor, highlightTabLabel } from './cards.js'
import { resolveRoutes, pathFor, placeLabels, arrowRoute, arrowPattern, arrowWeight, dashArrayFor,
         headLength, headTrim, colorKey } from './canvas.js'

const PAD = 48          // outer margin; also covers the 8px highlight ring and its tab
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

// The design tokens (style.css, DESIGN.md) as sRGB literals, because an
// exported file carries no stylesheet: --canvas, --card, --border, the
// --text-* tokens, --surface-2 for badges, and the [lines] --edge tokens.
function themeColors() {
  return ui.lightMode
    ? { bg: '#f1f1f7', card: '#fdfdff', cardBorder: '#d6d7de',
        title: '#1a1a20', type: '#47474e', desc: '#62626a', meta: '#47474e', badge: '#eaeaf0',
        arrow: '#73737d', label: '#47474e', pill: '#fdfdff', pillBorder: '#d6d7de',
        frame: '#d6d7de', frameLabel: '#62626a', hlInk: '#f9fafe', inkOnColor: 'rgba(26,26,32,.82)', onContext: '#f1f1f7' }
    : { bg: '#0e0e13', card: '#14141a', cardBorder: '#2d2d33',
        title: '#f1f1f7', type: '#bdbdc4', desc: '#919198', meta: '#bdbdc4', badge: '#1b1b21',
        arrow: '#848592', label: '#bdbdc4', pill: '#14141a', pillBorder: '#2d2d33',
        frame: '#2d2d33', frameLabel: '#919198', hlInk: '#0e0e13', inkOnColor: 'rgba(26,26,32,.82)', onContext: '#f1f1f7' }
}

// The type dot, in the shape the card draws (TYPES shape, style.css
// [data-shape]): 8px across, centred on (cx, cy).
function dotShapeSvg(shape, cx, cy, fill) {
  const f = escHtml(fill), x = cx.toFixed(1), y = cy.toFixed(1)
  const tag = `class="type-dot" data-shape="${shape}"`
  if (shape === 'ring') return `<circle ${tag} cx="${x}" cy="${y}" r="3.1" fill="none" stroke="${f}" stroke-width="1.8"/>`
  if (shape === 'square') return `<rect ${tag} x="${(cx - 3.5).toFixed(1)}" y="${(cy - 3.5).toFixed(1)}" width="7" height="7" rx="1.5" fill="${f}"/>`
  if (shape === 'diamond') return `<path ${tag} d="M ${x} ${(cy - 4.5).toFixed(1)} L ${(cx + 4.5).toFixed(1)} ${y} L ${x} ${(cy + 4.5).toFixed(1)} L ${(cx - 4.5).toFixed(1)} ${y} Z" fill="${f}"/>`
  return `<circle ${tag} cx="${x}" cy="${y}" r="4" fill="${f}"/>`
}

// The card box model (style.css .block, .block-header, .block-title,
// .block-desc): padding, the header row, and the text sizes.
const CARD = { padX: 12, padTop: 10, header: 20, headerGap: 4, title: 14, titleLine: 19,
  desc: 12, descLine: 17, descGap: 4, descLines: 3, badge: 11 }

// The first `max` wrapped lines, the last one ending in an ellipsis when
// text was cut, as -webkit-line-clamp draws it.
function clampLines(lines, max) {
  if (lines.length <= max) return lines
  const out = lines.slice(0, max)
  out[max - 1] = out[max - 1].replace(/\s*\S*$/, '').trimEnd() + '…'
  return out
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
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${C.bg}"/>`)
  parts.push(`<g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)})">`)

  // 1. Group frames (behind everything)
  groups.forEach(g => {
    const f = frameBox[g.id]; if (!f) return
    parts.push(`<rect x="${f.x.toFixed(1)}" y="${f.y.toFixed(1)}" width="${f.w.toFixed(1)}" height="${f.h.toFixed(1)}" rx="14" fill="none" stroke="${C.frame}" stroke-width="2"/>`)
    if (f.label) parts.push(`<text x="${(f.x + 14).toFixed(1)}" y="${(f.y + 22).toFixed(1)}" font-size="12" font-weight="600" fill="${C.frameLabel}">${escHtml(f.label)}</text>`)
  })

  // 2. Arrows (under blocks): every line, then every label over the lines,
  // exactly as the canvas paints them. Geometry, lanes, heads, dashes and
  // label placement all come from the same functions the canvas uses.
  const routes = resolveRoutes()
  const labels = placeLabels(routes)
  const heads = new Map()
  const headRef = (color, weight) => {
    const L = headLength(weight)
    const id = 'ah-' + colorKey(color) + '-' + Math.round(L * 10)
    if (!heads.has(id)) {
      heads.set(id, `<marker id="${id}" viewBox="0 0 10 10" markerUnits="userSpaceOnUse" markerWidth="${L}" markerHeight="${Math.round(L * 72) / 100}" preserveAspectRatio="none" refX="6" refY="5" orient="auto-start-reverse"><polygon points="0,0 10,5 0,10 2.5,5" fill="${escHtml(color)}"/></marker>`)
    }
    return `url(#${id})`
  }
  const lines = [], tags = []
  state.arrows.forEach(a => {
    const f = state.blocks[a.from], t = state.blocks[a.to]; if (!f || !t) return
    const pts = routes.get(a.id); if (!pts) return
    const style = arrowRoute(a)
    const weight = arrowWeight(a)
    const trim = headTrim(weight)
    const d = pathFor(pts, style, { start: a.bidirectional ? trim : 0, end: trim })
    const color = paintColorFor(a.color).color || C.arrow
    const head = headRef(color, weight)
    const dashes = dashArrayFor(arrowPattern(a), weight)
    const dash = dashes ? ` stroke-dasharray="${dashes}"` : ''
    const back = a.bidirectional ? ` marker-start="${head}"` : ''
    lines.push(`<path d="${d}" fill="none" stroke="${escHtml(color)}" stroke-width="${weight}"${dash} marker-end="${head}"${back}/>`)
    const lp = labels.get(a.id); if (!lp) return
    if (lp.text && lp.leader) {
      const L = lp.leader
      tags.push(`<line x1="${L.x1}" y1="${L.y1}" x2="${L.x2}" y2="${L.y2}" stroke="${escHtml(color)}" stroke-width="1" stroke-dasharray="2 2"/>`)
    }
    if (lp.text) {
      tags.push(`<rect x="${lp.x - lp.w / 2}" y="${lp.y - lp.h / 2}" width="${lp.w}" height="${lp.h}" rx="9" fill="${C.pill}" stroke="${C.pillBorder}" stroke-width="1"/>`)
      tags.push(`<text x="${lp.x}" y="${lp.y}" font-size="11" font-weight="500" text-anchor="middle" dominant-baseline="central" fill="${C.label}">${escHtml(lp.text)}</text>`)
    }
    if (a.note?.trim()) {
      const noteLines = wrapText(a.note.trim(), 170, 6).slice(0, 4)
      const startY = lp.y + (lp.text ? lp.h / 2 + 4 : 4)
      const tspans = noteLines.map((ln, i) => `<tspan x="${lp.x}" dy="${i === 0 ? 0 : 13}">${escHtml(ln)}</tspan>`).join('')
      tags.push(`<text x="${lp.x}" y="${startY}" font-size="11" text-anchor="middle" dominant-baseline="hanging" fill="${C.desc}" stroke="${C.bg}" stroke-width="4" paint-order="stroke" stroke-linejoin="round">${tspans}</text>`)
    }
  })
  // Spotlight fades every line and label, as on the canvas at rest.
  const spotlit = !!canvasMeta.spotlight && ids.some(id => state.blocks[id].highlight)
  if (spotlit) parts.push('<g opacity="0.35">', ...lines, ...tags, '</g>')
  else parts.push(...lines, ...tags)

  // 3. Blocks
  ids.forEach(id => {
    const b = state.blocks[id], { w, h } = dims[id]
    const x = b.x, y = b.y
    const type = TYPES[b.type] || TYPES.custom
    const typeColour = ui.lightMode ? type.light : type.color
    const paint = paintColorFor(b.color)
    const accent = paint.color ? ((ui.lightMode && paint.light) || paint.color) : typeColour
    const label = type === TYPES[b.type] ? type.label : String(b.type || type.label)
    const rx = b.type === 'terminator' ? 22 : 10
    // The canvas preset. The default outline is a quiet edge in the type
    // colour; the colour's loud part is the dot beside the label.
    const card = b.cardStyle || canvasMeta.cardStyle || DEFAULT_CARD_STYLE
    const bw = b.borderWidth || (card === 'bar' ? 1 : 1.5)
    const edge = card === 'plain' || card === 'header' ? C.cardBorder : accent
    const edgeOpacity = card === 'bar' ? 0.28 : card === 'plain' || card === 'header' ? 1 : 0.5
    parts.push(`<g${spotlit && !b.highlight ? ' opacity="0.3"' : ''}>`)
    // Highlight ring first, so the card sits on top of it exactly as on
    // screen: 6 to 8.5px out (the stroke centred 7.25px out), with its word
    // on a tab at the top left (the gap badge owns the top right on screen).
    // The festive border marches in the browser only when asked to, and
    // exports as its still candy-cane dash.
    if (b.highlight && HIGHLIGHTS[b.highlight]) {
      const hc = HIGHLIGHTS[b.highlight][ui.lightMode ? 'light' : 'color']
      const ring = `x="${(x - 7.25).toFixed(2)}" y="${(y - 7.25).toFixed(2)}" width="${w + 14.5}" height="${h + 14.5}" rx="${b.type === 'terminator' ? 30 : rx + 7.25}" fill="none" stroke-width="2.5"`
      parts.push(`<rect ${ring} stroke="${hc}"${b.highlight === 'festive' ? ' stroke-dasharray="9 9"' : ''}/>`)
      if (b.highlight === 'festive') parts.push(`<rect ${ring} stroke="${HIGHLIGHTS.go[ui.lightMode ? 'light' : 'color']}" stroke-dasharray="9 9" stroke-dashoffset="9"/>`)
      const word = highlightTabLabel(b.highlight)
      if (word) {
        const tw = Math.ceil(word.length * 6.4 + 10), tx = x + 14, ty = y - 7.25 - 7
        parts.push(`<rect x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" width="${tw}" height="14" rx="4" fill="${hc}"/>`)
        parts.push(`<text x="${(tx + tw / 2).toFixed(1)}" y="${(ty + 7).toFixed(1)}" font-size="11" font-weight="700" letter-spacing="0.5" text-anchor="middle" dominant-baseline="central" fill="${C.hlInk}">${escHtml(word.toUpperCase())}</text>`)
      }
    }
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${h}" rx="${rx}" fill="${C.card}" stroke="${escHtml(edge)}" stroke-opacity="${edgeOpacity}" stroke-width="${bw}"/>`)
    if (card === 'tint') {
      // An overlay rather than a computed blend: the card fill is a theme
      // token that is not always a parseable hex.
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${h}" rx="${rx}" fill="${escHtml(accent)}" opacity="0.14"/>`)
    } else if (card === 'bar') {
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="3" height="${h}" rx="1.5" fill="${escHtml(accent)}"/>`)
    }
    // The header row. On the header preset it is a strip in the type colour
    // (tinted in light mode, where the label stays neutral); elsewhere the
    // label sits beside an 8px dot.
    let top = y + CARD.padTop
    let labelInk = C.type, dot = true
    if (card === 'header') {
      const sh = CARD.header + 10
      parts.push(`<path d="M ${x} ${(y + rx).toFixed(1)} a ${rx} ${rx} 0 0 1 ${rx} ${-rx} h ${(w - rx * 2).toFixed(1)} a ${rx} ${rx} 0 0 1 ${rx} ${rx} v ${sh - rx} h ${-w} Z" fill="${escHtml(accent)}"${ui.lightMode ? ' fill-opacity="0.22"' : ''}/>`)
      top = y + 5
      if (!ui.lightMode) { labelInk = b.type === 'context' && !b.color ? C.onContext : C.inkOnColor; dot = false }
    }
    const midY = top + CARD.header / 2
    let lx = x + CARD.padX
    if (dot) {
      parts.push(dotShapeSvg(type.shape || 'dot', lx + 4, midY, accent))
      lx += 14
    }
    parts.push(`<text x="${lx.toFixed(1)}" y="${midY.toFixed(1)}" font-size="11" font-weight="600" letter-spacing="0.4" dominant-baseline="central" fill="${labelInk}">${escHtml(label.toUpperCase())}</text>`)
    let cy = top + CARD.header + (card === 'header' ? 8 : CARD.headerGap)
    // Title: 14px/600, every line, as on the card.
    const inner = w - CARD.padX * 2
    const titleLines = b.title ? wrapText(b.title, inner, 7.4) : []
    titleLines.forEach((ln, i) => {
      parts.push(`<text x="${(x + CARD.padX).toFixed(1)}" y="${(cy + i * CARD.titleLine + 14).toFixed(1)}" font-size="${CARD.title}" font-weight="600" fill="${C.title}">${escHtml(ln)}</text>`)
    })
    cy += titleLines.length * CARD.titleLine
    if (!b.collapsed) {
      // Description: 12px, muted, clamped to three lines like the card.
      if (b.description) {
        cy += CARD.descGap
        clampLines(wrapText(b.description, inner, 6.2), CARD.descLines).forEach((ln, i) => {
          parts.push(`<text x="${(x + CARD.padX).toFixed(1)}" y="${(cy + i * CARD.descLine + 12).toFixed(1)}" font-size="${CARD.desc}" fill="${C.desc}">${escHtml(ln)}</text>`)
        })
        cy += Math.min(CARD.descLines, wrapText(b.description, inner, 6.2).length) * CARD.descLine
      }
      // Priority and status: neutral 11px/600 badges under the text, in
      // sentence case, as on the card.
      const badges = []
      if (b.priority) badges.push(PRIORITY_DEFS[b.priority]?.label || b.priority)
      if (b.status && b.status !== 'not-started') badges.push(STATUS_DEFS[b.status]?.label || b.status)
      if (badges.length) {
        cy += 5
        let bx = x + CARD.padX
        badges.forEach(text => {
          const bwid = Math.ceil(text.length * 6.2 + 12)
          parts.push(`<rect x="${bx.toFixed(1)}" y="${cy.toFixed(1)}" width="${bwid}" height="16" rx="3" fill="${C.badge}"/>`)
          parts.push(`<text x="${(bx + bwid / 2).toFixed(1)}" y="${(cy + 8).toFixed(1)}" font-size="${CARD.badge}" font-weight="600" text-anchor="middle" dominant-baseline="central" fill="${C.meta}">${escHtml(text)}</text>`)
          bx += bwid + 4
        })
      }
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
  // The heads are known only once every arrow is drawn; defs may follow the
  // opening tag anywhere, so they go in second.
  parts.splice(1, 0, '<defs>' + [...heads.values()].join('') + '</defs>')
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
      if (!blob) { showToast('PNG export failed: try SVG instead', 'warning'); return }
      download(blob, 'pathfinder-diagram.png')
      showToast('Diagram exported as PNG (2×)', 'success')
    }, 'image/png')
  }
  img.onerror = () => showToast('PNG export failed: try SVG instead', 'warning')
  img.src = url
}
