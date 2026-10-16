#!/usr/bin/env node
// ════════════════════════════════════════════════════════════
//  tools/render-assets.mjs: draw the site's pictures from the app
//  itself, so none of them can show a UI that no longer exists.
//
//    make assets                      (or: node tools/render-assets.mjs [port] [--pages])
//
//  Writes, in the repository:
//    examples/<slug>.svg, examples/<slug>-light.svg
//        each example map, drawn by the app's own SVG exporter
//        (image-export.js buildSvg), in both themes. The examples page
//        shows each whole, fitted to its column, and again as a detail at
//        PIC_SCALE of its own size (a card title at 11px or more): where
//        the flow starts, whole cards only. This writes the <img> sizes
//        and the detail's place (writeDetail) into the page
//    examples/checkout-strip.svg, -strip-light.svg
//        the walkthrough strip's picture: the checkout map's entry row,
//        cut from the same SVG
//    the brief excerpts between <!-- brief:<slug> --> and <!-- /brief -->
//        in examples.html and tutorial.html, cut from generatePrompt()
//    og-preview.jpg
//        the share card: 1200x630, the checkout example and one line
//    docs/screenshot-dark.png, docs/screenshot-light.png
//        the README's picture of the app
//  --pages writes the first three only (the pages' own pictures and
//  excerpts), leaving the share card and the README's screenshots alone.
//
//  It serves the repository on 127.0.0.1:<port> (default 9850) and
//  drives headless Chrome on <port + 1> (tools/cdp.mjs). Run it again
//  whenever the canvas, the exporter, the brief or the examples change.
// ════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve, launch, sleep } from './cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = +(process.argv.slice(2).find(a => /^\d+$/.test(a)) || process.env.ASSETS_PORT || 9850)
/** --pages: the example pictures and the excerpts only, not the share card or the README's screenshots. */
const PAGES_ONLY = process.argv.includes('--pages')
const OG_LINE = 'Plan the work before an agent builds it'
/** The pages draw a map at this share of its own size: 14px titles at 11.2px. */
const PIC_SCALE = 0.8
/** The reading column's width (.doc: 720px less its 24px sides): the widest detail. */
const DETAIL_COLUMN = 672
/** A 360px phone's column (less the page's sides and the detail's border): the phone's detail. */
const PHONE_COLUMN = 310

const log = (...a) => console.log('  ' + a.join(' '))
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Replace what sits between <!-- brief:<slug> --> and <!-- /brief --> in a page. */
function writeExcerpt(file, slug, lines) {
  const path = join(ROOT, file)
  const html = readFileSync(path, 'utf8')
  const re = new RegExp(`(<!-- brief:${slug} -->)[\\s\\S]*?(<!-- /brief -->)`)
  if (!re.test(html)) throw new Error(`${file} has no <!-- brief:${slug} --> marker`)
  writeFileSync(path, html.replace(re, `$1${lines.map(esc).join('\n')}$2`))
}

const svgSize = (svg, slug) => {
  const m = svg.match(/<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/)
  if (!m) throw new Error(`${slug}: the SVG has no size`)
  return [+m[1], +m[2]]
}

/**
 * Give every <img data-pic="<slug>"> in a page the size it is drawn at
 * (PIC_SCALE of the picture's own), so it reserves its space and reads. Its
 * detail (data-detail-pic) takes the same size: Firefox never loads a lazy
 * image whose box is 0px tall, and without it the detail's box was.
 */
function writeSize(file, slug, svg) {
  const path = join(ROOT, file)
  const [w, h] = svgSize(svg, slug).map(n => Math.round(n * PIC_SCALE))
  const html = readFileSync(path, 'utf8')
  const re = new RegExp(`<img\\b[^>]*\\bdata-(?:detail-)?pic="${slug}"[^>]*>`, 'g')
  writeFileSync(path, html.replace(re, tag => tag.replace(/\swidth="\d+"/, ` width="${w}"`).replace(/\sheight="\d+"/, ` height="${h}"`)))
}

/**
 * Where an example's detail sits on its picture, as the custom properties
 * the page's figure reads (css [recognition]): --fx, --fy, --fw and --fh
 * (the entry row), --fx1, --ff, --fy1 and --fh1 (the entry card alone, for
 * a phone) as fractions of the picture, --pw and --ph its drawn size. One
 * file serves the whole map and the detail; nothing to keep in step by hand.
 */
function writeDetail(file, slug, svg, { wide, phone }) {
  const path = join(ROOT, file)
  const [W, H] = svgSize(svg, slug)
  const f = n => String(Math.round(n * 10000) / 10000)
  const style = `--fx:${f(wide.x1 / W)};--fy:${f(wide.y1 / H)};--fw:${f((wide.x2 - wide.x1) / W)};--fh:${f((wide.y2 - wide.y1) / H)};` +
    `--fx1:${f(phone.x1 / W)};--ff:${f((phone.x2 - phone.x1) / W)};--fy1:${f(phone.y1 / H)};--fh1:${f((phone.y2 - phone.y1) / H)};` +
    `--pw:${Math.round(W * PIC_SCALE)};--ph:${Math.round(H * PIC_SCALE)}`
  const html = readFileSync(path, 'utf8')
  const re = new RegExp(`(<figure\\b[^>]*\\bdata-detail="${slug}"[^>]*\\bstyle=")[^"]*(")`)
  if (!re.test(html)) throw new Error(`${file} has no <figure data-detail="${slug}" style=""> to write into`)
  writeFileSync(path, html.replace(re, `$1${style}$2`))
}

/**
 * The same picture cut to the band [y, y + h] (in its own coordinates), at
 * its full width: the root element's viewBox and size are all that change.
 */
function cropBand(svg, y, h, slug) {
  const [w] = svgSize(svg, slug)
  return svg.replace(/<svg\b[^>]*>/, tag => tag
    .replace(/\swidth="[\d.]+"/, ` width="${Math.round(w)}"`)
    .replace(/\sheight="[\d.]+"/, ` height="${Math.round(h)}"`)
    .replace(/\sviewBox="[^"]*"/, ` viewBox="0 ${Math.round(y)} ${Math.round(w)} ${Math.round(h)}"`))
}

const srv = await serve(ROOT, PORT)
const page = await launch({ debugPort: PORT + 1 })

// A clean first visit in the given theme, then `path`.
async function fresh(path, { theme = 'dark', wait = 900 } = {}) {
  await page.go(srv.url + '/robots.txt', 50)
  await page.evalJS(`localStorage.clear(); sessionStorage.clear();` +
    (theme === 'light' ? `localStorage.setItem('pathfinder-theme', 'light')` : ''))
  await page.go(srv.url + path, wait)
}

// Wait for two frames: applyImport draws lines and gaps in one.
const frames = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`

try {
  // ── Example maps and their briefs ──────────────────────────
  await page.size(1440, 900)
  await fresh('/')
  const examples = await page.evalJS(`(async () => {
    const { EXAMPLES, payloadFor } = await import('/js/examples-page.js')
    const { applyImport } = await import('/js/export.js')
    const { buildSvg } = await import('/js/image-export.js')
    const { generatePrompt } = await import('/js/prompt.js')
    const { ui, state } = await import('/js/state.js')
    const { getBlockDims } = await import('/js/utils.js')
    // The entry row, in the exporter's coordinates (its 48px margin from the
    // top block): the blocks level with where the flow starts, the trigger
    // or the first root.
    const entryBand = () => {
      const ids = Object.keys(state.blocks)
      const into = new Set(state.arrows.map(a => a.to)), out = new Set(state.arrows.map(a => a.from))
      const roots = ids.filter(id => out.has(id) && !into.has(id))
      const entry = roots.find(id => state.blocks[id].type === 'terminator') || roots[0] || ids[0]
      const box = id => { const b = state.blocks[id], d = getBlockDims(id); return { y1: b.y, y2: b.y + d.h } }
      const e = box(entry)
      const row = ids.map(box).filter(b => b.y1 < e.y2 && b.y2 > e.y1)
      const minY = Math.min(...ids.map(id => state.blocks[id].y))
      const pad = 28
      const y1 = Math.min(...row.map(b => b.y1)) - pad, y2 = Math.max(...row.map(b => b.y2)) + pad
      return { y: y1 - minY + 48, h: y2 - y1 }
    }
    // The examples page's detail: where the flow starts, at reading size.
    // The entry card and the cards level with it to its right, as many as
    // fit the reading column at PIC_SCALE (three at most), whole cards only;
    // the phone's crop is the entry card alone. Both are in the exporter's
    // coordinates, with the cards each must keep whole.
    const detailBox = (column, scale) => {
      const ids = Object.keys(state.blocks)
      const into = new Set(state.arrows.map(a => a.to)), out = new Set(state.arrows.map(a => a.from))
      const roots = ids.filter(id => out.has(id) && !into.has(id))
      const entry = roots.find(id => state.blocks[id].type === 'terminator') || roots[0] || ids[0]
      const minX = Math.min(...ids.map(id => state.blocks[id].x)), minY = Math.min(...ids.map(id => state.blocks[id].y))
      const box = id => { const b = state.blocks[id], d = getBlockDims(id); const x = b.x - minX + 48, y = b.y - minY + 48; return { x1: x, x2: x + d.w, y1: y, y2: y + d.h } }
      const e = box(entry)
      const pad = 28
      // The entry and what it leads to: its direct successors to its right,
      // as many as fit the column and a crop no taller than maxH on screen
      // (the farthest from the entry's middle go first).
      const width = t => Math.max(...t.map(b => b.x2)) - e.x1 + pad * 2
      const band = t => ({ y1: Math.min(...t.map(b => b.y1)) - pad, y2: Math.max(...t.map(b => b.y2)) + pad })
      const mid = b => (b.y1 + b.y2) / 2
      const next = [...new Set(state.arrows.filter(a => a.from === entry).map(a => a.to))].map(box)
        .filter(b => b.x1 >= e.x2 && width([e, b]) * scale <= column)
        .sort((a, b) => Math.abs(mid(a) - mid(e)) - Math.abs(mid(b) - mid(e)))
      let take = [e, ...next]
      const maxH = 360
      while (take.length > 1 && (band(take).y2 - band(take).y1) * scale > maxH) take = take.slice(0, -1)
      const crop = t => ({ x1: e.x1 - pad, x2: e.x1 - pad + width(t), ...band(t) })
      return { take, crop }
    }
    // Every card, label and line of text the exporter drew, as boxes in its
    // own coordinates: the picture laid out at its own size, off screen.
    // Frames and the background are left out (a crop may cut a frame's edge).
    const drawnBoxes = svg => {
      const host = document.createElement('div')
      host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none'
      host.innerHTML = svg
      document.body.appendChild(host)
      const root = host.querySelector('svg'), o = root.getBoundingClientRect()
      const boxes = [...root.querySelectorAll('rect, text')].map(el => {
        const r = el.getBoundingClientRect()
        return { x1: r.left - o.left, y1: r.top - o.top, x2: r.right - o.left, y2: r.bottom - o.top }
      }).filter(b => b.x2 - b.x1 > 0.5 && b.y2 - b.y1 > 0.5 && b.x2 - b.x1 < 600 && b.y2 - b.y1 < 600)
      host.remove()
      return { boxes, W: o.width, H: o.height }
    }
    // Move a crop's edges until nothing drawn is cut in two: a card or a
    // label it touches is either taken whole or left out. Each edge goes to
    // the nearest place that falls in no drawn thing (a gutter), never into
    // the cards the crop is for and never past maxW x maxH (the column, the
    // height a detail may take); the four settle together, a few rounds.
    const settle = (c, keep, { boxes, W, H }, maxW, maxH, gap = 6) => {
      const hull = { x1: Math.min(...keep.map(b => b.x1)), x2: Math.max(...keep.map(b => b.x2)), y1: Math.min(...keep.map(b => b.y1)), y2: Math.max(...keep.map(b => b.y2)) }
      const place = (cur, lo, hi, spans) => {
        const bad = v => spans.some(([a, b]) => v > a && v < b)
        const ok = v => v >= lo && v <= hi && !bad(v)
        if (ok(cur)) return cur
        const cands = [lo, hi, ...spans.flat()].filter(ok).sort((p, q) => Math.abs(p - cur) - Math.abs(q - cur))
        return cands.length ? cands[0] : cur
      }
      const across = (t, axis) => boxes
        .filter(b => axis === 'x' ? b.y1 < t.y2 && b.y2 > t.y1 : b.x1 < t.x2 && b.x2 > t.x1)
        .map(b => axis === 'x' ? [b.x1 - gap, b.x2 + gap] : [b.y1 - gap, b.y2 + gap])
      c = { x1: c.x1, x2: c.x2, y1: c.y1, y2: c.y2 }
      for (let round = 0; round < 8; round++) {
        const was = JSON.stringify(c)
        c.x2 = place(c.x2, hull.x2 + 8, Math.min(W, c.x1 + maxW), across(c, 'x'))
        c.x1 = place(c.x1, Math.max(0, c.x2 - maxW), hull.x1 - 8, across(c, 'x'))
        c.y2 = place(c.y2, hull.y2 + 8, Math.min(H, c.y1 + maxH), across(c, 'y'))
        c.y1 = place(c.y1, Math.max(0, c.y2 - maxH), hull.y1 - 8, across(c, 'y'))
        if (JSON.stringify(c) === was) break
      }
      const inside = b => b.x1 >= c.x1 - 0.5 && b.x2 <= c.x2 + 0.5 && b.y1 >= c.y1 - 0.5 && b.y2 <= c.y2 + 0.5
      const touches = b => b.x1 < c.x2 && b.x2 > c.x1 && b.y1 < c.y2 && b.y2 > c.y1
      return { ...c, clean: !boxes.some(b => touches(b) && !inside(b)) }
    }
    const out = []
    for (const ex of EXAMPLES.filter(e => e.picture)) {
      ui.lightMode = false
      applyImport(payloadFor(ex.key), 'replace', { fit: false })
      await ${frames}
      const dark = buildSvg().svg
      ui.lightMode = true
      const light = buildSvg().svg
      ui.lightMode = false
      const { take, crop } = detailBox(${DETAIL_COLUMN}, ${PIC_SCALE}), drawn = drawnBoxes(dark)
      // The first crop that settles clean: the most cards first, then with
      // tighter gutters, then one card fewer. Failing all, the widest one
      // (and a warning below).
      const clean = (cards, column) => {
        let first = null
        for (let k = cards.length; k >= 1; k--) {
          for (const gap of [6, 3, 1.5]) {
            const c = settle(crop(cards.slice(0, k)), cards.slice(0, k), drawn, column / ${PIC_SCALE}, 360 / ${PIC_SCALE}, gap)
            first ??= c
            if (c.clean) return { ...c, cards: k }
          }
        }
        return first
      }
      const wide = clean(take, ${DETAIL_COLUMN}), phone = clean(take.slice(0, 1), ${PHONE_COLUMN})
      out.push({ slug: ex.slug, dark, light, band: entryBand(), detail: { wide, phone }, prompt: generatePrompt() })
    }
    return out
  })()`)

  mkdirSync(join(ROOT, 'examples'), { recursive: true })
  const lines = p => p.split('\n')
  const section = (prompt, name) => {
    const all = lines(prompt)
    const i = all.findIndex(l => l.startsWith('## ' + name))
    if (i < 0) return null
    const body = []
    for (let j = i + 1; j < all.length && !all[j].startsWith('#'); j++) if (all[j].trim()) body.push(all[j])
    return { head: all[i], body }
  }
  // The first whole sentence of at least 20 characters ("Investigate." alone says little).
  const sentence = s => (String(s).match(/^.{20,}?[.?](?=\s|$)/) || [s])[0]
  const doubt = prompt => section(prompt, 'Planning gaps') || section(prompt, 'Open questions') ||
    section(prompt, 'Assumptions') || section(prompt, 'Risks')
  // A "### " part of a section (the Situation's boundaries), to the next heading.
  const part = (prompt, name) => {
    const all = lines(prompt)
    const i = all.findIndex(l => l.startsWith('### ' + name))
    if (i < 0) return null
    const body = []
    for (let j = i + 1; j < all.length && !all[j].startsWith('#'); j++) if (all[j].trim()) body.push(all[j])
    return body.length ? { head: all[i], body } : null
  }

  for (const ex of examples) {
    writeFileSync(join(ROOT, 'examples', `${ex.slug}.svg`), ex.dark + '\n')
    writeFileSync(join(ROOT, 'examples', `${ex.slug}-light.svg`), ex.light + '\n')
    // Four lines, all of them this map's own: the first boundary it sets
    // (else what its brief asks for), and the first thing the brief says is
    // missing or unknown. The Task's opening is one of five mode sentences,
    // the same for every map in that mode, so it is only the fallback.
    const task = section(ex.prompt, 'Task'), open = doubt(ex.prompt)
    if (!task || !open) throw new Error(`${ex.slug}: the brief has no Task or no gap, question, assumption or risk section`)
    const own = part(ex.prompt, 'Constraints') || { head: task.head, body: [sentence(task.body[0])] }
    writeExcerpt('examples.html', ex.slug, [own.head, own.body[0], open.head, open.body[0]])
    writeSize('examples.html', ex.slug, ex.dark)
    writeDetail('examples.html', ex.slug, ex.dark, ex.detail)
    // A crop that could not settle cuts a card or a label in two: say so.
    for (const k of ['wide', 'phone']) if (!ex.detail[k].clean) log(`warning: ${ex.slug}'s ${k} detail cuts a card or a label`)
    log(`examples/${ex.slug}.svg, -light.svg, and its brief excerpt`)
    if (ex.slug === 'checkout') {
      // The walkthrough's picture: the entry row of the same drawing.
      writeFileSync(join(ROOT, 'examples', 'checkout-strip.svg'), cropBand(ex.dark, ex.band.y, ex.band.h, 'checkout') + '\n')
      writeFileSync(join(ROOT, 'examples', 'checkout-strip-light.svg'), cropBand(ex.light, ex.band.y, ex.band.h, 'checkout') + '\n')
      writeSize('tutorial.html', 'checkout-strip', cropBand(ex.dark, ex.band.y, ex.band.h, 'checkout'))
      log('examples/checkout-strip.svg, -strip-light.svg')
      // The walkthrough's strip: the opening of the brief this map produces.
      const sit = section(ex.prompt, 'Situation'), asm = section(ex.prompt, 'Assumptions')
      const repo = sit.body.find(l => /repository is open/i.test(l)) || sit.body[0]
      writeExcerpt('tutorial.html', 'checkout', [sit.head, sentence(repo), task.head, sentence(task.body[0]), asm.head, asm.body[0]])
      log('tutorial.html brief strip')
    }
  }

  if (!PAGES_ONLY) await shareCardAndReadme()
  if (page.errors.length) { console.log('Page errors:\n' + page.errors.join('\n')); process.exitCode = 1 }
} catch (e) {
  console.log('render-assets: ' + e.message)
  process.exitCode = 1
} finally {
  await page.close()
  await srv.stop()
}

async function shareCardAndReadme() {
  // ── The share card ─────────────────────────────────────────
  const checkout = await page.evalJS(`(async () => {
    const { payloadFor } = await import('/js/examples-page.js')
    return JSON.stringify(payloadFor('checkout'))
  })()`)
  const hash = '#s=' + Buffer.from(encodeURIComponent(checkout)).toString('base64')
  await page.size(1200, 630)
  await fresh('/?embed&readonly' + hash, { wait: 1200 })
  await page.evalJS(`(async () => {
    const style = document.createElement('style')
    style.textContent = \`
      .neo-footer, .toast-notification, .readonly-badge, .review-bar, .canvas-search-toggle { display: none !important; }
      body.embed-mode .app-body { height: 100vh; padding-top: 150px; box-sizing: border-box; }
      .og-line { position: fixed; top: 56px; left: 64px; right: 64px; margin: 0;
        font: 600 46px/1.15 var(--font); letter-spacing: -0.01em; color: var(--text-1); }\`
    document.head.appendChild(style)
    const line = document.createElement('p')
    line.className = 'og-line'
    line.textContent = ${JSON.stringify(OG_LINE)}
    document.body.appendChild(line)
    const { view, state } = await import('/js/state.js')
    const { applyTransform } = await import('/js/canvas.js')
    await ${frames}
    // Closer than a whole-map fit, so the cards read: the start of the
    // investigation from its top row down, cut off at the right edge.
    const blocks = Object.values(state.blocks)
    const minX = Math.min(...blocks.map(b => b.x)), minY = Math.min(...blocks.map(b => b.y))
    view.zoom = 0.62
    view.panX = 64 - minX * view.zoom
    view.panY = 8 - minY * view.zoom
    applyTransform()
    await ${frames}
  })()`)
  await sleep(300)
  writeFileSync(join(ROOT, 'og-preview.jpg'), await page.shot({ format: 'jpeg', quality: 86 }))
  log('og-preview.jpg')

  // ── The README's picture of the app ────────────────────────
  mkdirSync(join(ROOT, 'docs'), { recursive: true })
  for (const theme of ['dark', 'light']) {
    await page.size(1440, 900)
    await fresh('/' + hash, { theme, wait: 1400 })
    await page.evalJS(`(async () => {
      document.querySelectorAll('.toast-notification').forEach(t => t.remove())
      document.querySelector('.panel-tab[data-tab="prompt"]')?.click()
      // Readable cards beat the whole map: the investigation from its first
      // card, at the zoom someone works at, the brief beside it. Full detail
      // (lod.js FULL_DETAIL_ZOOM), so the descriptions and the connections'
      // labels show, as they do on arrival.
      const { view, state } = await import('/js/state.js')
      const { applyTransform } = await import('/js/canvas.js')
      const { FULL_DETAIL_ZOOM } = await import('/js/lod.js')
      const blocks = Object.values(state.blocks)
      const minX = Math.min(...blocks.map(b => b.x)), minY = Math.min(...blocks.map(b => b.y))
      view.zoom = FULL_DETAIL_ZOOM
      view.panX = 32 - minX * view.zoom
      view.panY = 96 - minY * view.zoom
      applyTransform()
      await ${frames}
    })()`)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1439, y: 899 })
    await sleep(400)
    writeFileSync(join(ROOT, 'docs', `screenshot-${theme}.png`), await page.shot())
    log(`docs/screenshot-${theme}.png`)
  }
}
