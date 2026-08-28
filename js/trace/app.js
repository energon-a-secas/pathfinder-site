// ════════════════════════════════════════════════════════════
//  trace/app.js: The trace page
//
//  Text in, diagram out. The whole loop is: read the textarea, parse,
//  build a scene, render one SVG string, put it in the stage. Everything
//  the page can hand you (file, link, iframe) is that same string, which
//  is why there is no export module here.
// ════════════════════════════════════════════════════════════

import { parseTraceText, errorsOf, warningsOf } from './parse.js'
import { buildScene } from './layout-trace.js'
import { renderSvg } from './render-svg.js'
import { suggestFor } from './suggest.js'
import { EXAMPLES, loadExample } from './examples.js'
import { showToast, escHtml, debounce } from '../utils.js'
import { buildTracePrompt } from './prompt-trace.js'

const $ = id => document.getElementById(id)
const STORE = 'pathfinder-trace-v1'
const MAX_SRC = 1024 * 1024

const els = {}
const state = { text: '', trace: null, scene: null, svg: '', zoom: 1, panX: 0, panY: 0, embed: false }

// ── render loop ──────────────────────────────────────────────
function rebuild() {
  const t = parseTraceText(state.text, window.jsyaml.load)
  state.trace = t
  const errs = errorsOf(t), warns = warningsOf(t)

  if (t.nodes.length) {
    state.scene = buildScene(t)
    state.svg = renderSvg(state.scene)
    els.stage.innerHTML = state.svg
    els.empty.hidden = true
  } else {
    state.scene = null; state.svg = ''
    els.stage.innerHTML = ''
    els.empty.hidden = false
  }

  els.counts.textContent = t.nodes.length
    ? `${t.nodes.length} node${t.nodes.length === 1 ? '' : 's'}, ${t.edges.length} link${t.edges.length === 1 ? '' : 's'}`
    : ''
  if (els.title && t.meta.title) els.title.textContent = t.meta.title

  renderDiagnostics(errs, warns, t)
  renderSuggestions(t)
  save()
}
const rebuildSoon = debounce(rebuild, 220)

function renderDiagnostics(errs, warns, t) {
  const rows = [...errs, ...warns]
  if (!rows.length && t.nodes.length) {
    els.diags.innerHTML = `<div class="trace-diag" data-level="ok"><span class="tag">OK</span>`
      + `<span class="msg">Parses clean. ${t.nodes.length} nodes, ${t.edges.length} links.</span></div>`
    return
  }
  els.diags.innerHTML = rows.map(d =>
    `<div class="trace-diag" data-level="${d.level}">`
    + `<span class="tag">${d.level === 'error' ? 'ERR' : 'WARN'}</span>`
    + `<span class="msg">${escHtml(d.msg)}${d.at ? ` <span class="at">${escHtml(d.at)}</span>` : ''}</span></div>`
  ).join('')
}

function renderSuggestions(t) {
  const items = suggestFor(t)
  if (!items.length) { els.suggest.innerHTML = ''; return }
  els.suggest.innerHTML = `<div class="trace-suggest-head">Worth trying (${items.length})</div>`
    + items.map(s => `<div class="trace-sugg">
        <h4>${escHtml(s.title)}</h4>
        ${s.body ? `<p>${escHtml(s.body)}</p>` : ''}
        ${(s.probes || []).map(p => `<code>${escHtml(p)}</code>`).join('')}
        ${s.why ? `<div class="why">${escHtml(s.why)}</div>` : ''}
      </div>`).join('')
}

// ── camera ───────────────────────────────────────────────────
function applyTransform() {
  els.stage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`
  els.zoomLabel.textContent = Math.round(state.zoom * 100) + '%'
}
function setZoom(z, cx, cy) {
  const next = Math.min(3, Math.max(0.08, z))
  const r = els.view.getBoundingClientRect()
  const ax = cx == null ? r.width / 2 : cx, ay = cy == null ? r.height / 2 : cy
  state.panX = ax - (ax - state.panX) * (next / state.zoom)
  state.panY = ay - (ay - state.panY) * (next / state.zoom)
  state.zoom = next
  applyTransform()
}
function fit() {
  if (!state.scene) return
  const r = els.view.getBoundingClientRect()
  const z = Math.min(r.width / state.scene.width, r.height / state.scene.height, 1.6) * 0.94
  state.zoom = Math.max(0.08, z)
  state.panX = (r.width - state.scene.width * state.zoom) / 2
  state.panY = (r.height - state.scene.height * state.zoom) / 2
  applyTransform()
}

function initCamera() {
  let down = false, sx = 0, sy = 0, ox = 0, oy = 0
  els.view.addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    down = true; sx = e.clientX; sy = e.clientY; ox = state.panX; oy = state.panY
    els.view.classList.add('panning'); els.view.setPointerCapture(e.pointerId)
  })
  els.view.addEventListener('pointermove', e => {
    if (!down) return
    state.panX = ox + (e.clientX - sx); state.panY = oy + (e.clientY - sy); applyTransform()
  })
  const up = e => { down = false; els.view.classList.remove('panning'); try { els.view.releasePointerCapture(e.pointerId) } catch (_) {} }
  els.view.addEventListener('pointerup', up)
  els.view.addEventListener('pointercancel', up)
  els.view.addEventListener('wheel', e => {
    e.preventDefault()
    const r = els.view.getBoundingClientRect()
    setZoom(state.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top)
  }, { passive: false })

  $('trZoomIn').onclick  = () => setZoom(state.zoom * 1.2)
  $('trZoomOut').onclick = () => setZoom(state.zoom / 1.2)
  $('trFitBtn').onclick  = fit
  if ($('traceFit')) $('traceFit').onclick = fit
}

// ── persistence and links ────────────────────────────────────
/**
 * Autosave, except when embedded.
 *
 * An embedded trace is somebody else's document on somebody else's page.
 * Writing it to localStorage would silently overwrite whatever the visitor
 * had been working on, the first time they scrolled past a blog post with
 * an iframe in it.
 */
const save = debounce(() => {
  if (state.embed) return
  try { localStorage.setItem(STORE, state.text) } catch (_) {}
}, 400)

/**
 * base64url over the UTF-8 bytes, matching what slides-site's `#d=` and
 * proctor's `#t=` already document.
 *
 * The canvas's `#s=` uses btoa(encodeURIComponent(json)), which percent-
 * escapes before encoding and costs about 2.6x the source (measured: 3488
 * bytes of YAML became 9128). Proper UTF-8 base64 is 1.33x. A trace is a
 * document people paste into chat windows, so halving the link matters,
 * and `#t=` is new so there is nothing to stay compatible with.
 */
const b64 = s => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64 = s => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
}

function shareUrl(embed = false) {
  const base = location.origin + location.pathname
  return base + (embed ? '?embed&readonly' : '') + '#t=' + b64(state.text)
}

async function loadFromUrl() {
  const params = new URLSearchParams(location.search)
  state.embed = params.has('embed')
  if (state.embed) document.body.classList.add('trace-embed')

  const hash = location.hash.match(/[#&]t=([^&]+)/)
  if (hash) {
    try { return unb64(hash[1]) } catch (_) { showToast('That share link is corrupt.', 'error') }
  }
  const src = params.get('src')
  if (src) {
    try {
      const u = new URL(src, location.origin)
      if (u.protocol !== 'https:' && u.origin !== location.origin) throw new Error('https only')
      const res = await fetch(u.href)
      if (!res.ok) throw new Error(res.status)
      const text = await res.text()
      if (text.length > MAX_SRC) throw new Error('too large')
      return text
    } catch (e) { showToast(`Could not load ?src=: ${e.message}`, 'error') }
  }
  if (state.embed) return ''
  try { return localStorage.getItem(STORE) || '' } catch (_) { return '' }
}

// ── export ───────────────────────────────────────────────────
function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
const slugTitle = () => (state.trace?.meta.title || 'trace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'trace'

function haveDiagram() {
  if (state.svg) return true
  showToast('There is no diagram to export yet.', 'error'); return false
}

async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); showToast(label, 'success') }
  catch (_) { showToast('Clipboard refused. Copy it from the source pane instead.', 'error') }
}

function initExport() {
  $('trDownloadSvg').onclick = () => haveDiagram() && download(new Blob([state.svg], { type: 'image/svg+xml' }), `${slugTitle()}.svg`)

  $('trDownloadPng').onclick = () => {
    if (!haveDiagram()) return
    const scale = 2, { width: w, height: h } = state.scene
    const img = new Image()
    const url = URL.createObjectURL(new Blob([state.svg], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = Math.round(w * scale); c.height = Math.round(h * scale)
      const ctx = c.getContext('2d')
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      c.toBlob(b => b ? download(b, `${slugTitle()}.png`) : showToast('The browser refused to rasterize it.', 'error'), 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); showToast('The browser could not rasterize this SVG.', 'error') }
    img.src = url
  }

  $('trDownloadYaml').onclick = () => state.text.trim()
    ? download(new Blob([state.text], { type: 'text/yaml' }), `${slugTitle()}.yaml`)
    : showToast('Nothing to download yet.', 'error')

  $('trCopyShare').onclick = () => state.text.trim() && copy(shareUrl(false), 'Share link copied. The trace travels in the link.')
  $('trCopyEmbed').onclick = () => state.text.trim() && copy(
    `<iframe src="${shareUrl(true)}" width="100%" height="620" style="border:1px solid rgba(255,255,255,.14);border-radius:12px" title="${escHtml(state.trace?.meta.title || 'Trace')}" loading="lazy"></iframe>`,
    'Embed code copied.')
  $('trCopyPrompt').onclick = () => copy(buildTracePrompt(state.trace), 'Prompt copied. Paste it to an assistant.')
}

function initMenus() {
  document.querySelectorAll('.export-wrapper').forEach(w => {
    const btn = w.querySelector('.header-btn')
    if (!btn) return
    btn.onclick = e => {
      e.stopPropagation()
      const open = w.classList.contains('open')
      document.querySelectorAll('.export-wrapper.open').forEach(o => { o.classList.remove('open'); o.querySelector('.header-btn')?.setAttribute('aria-expanded', 'false') })
      w.classList.toggle('open', !open)
      btn.setAttribute('aria-expanded', String(!open))
    }
  })
  document.addEventListener('click', () => document.querySelectorAll('.export-wrapper.open').forEach(o => {
    o.classList.remove('open'); o.querySelector('.header-btn')?.setAttribute('aria-expanded', 'false')
  }))
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.export-wrapper.open').forEach(o => o.classList.remove('open'))
  })

  els.examplesMenu.innerHTML = EXAMPLES.map(e =>
    `<div class="export-item" data-ex="${e.id}"><div><div>${escHtml(e.name)}</div>
     <div style="font-size:11px;opacity:.6;margin-top:2px">${escHtml(e.blurb)}</div></div></div>`).join('')
  els.examplesMenu.querySelectorAll('[data-ex]').forEach(item => {
    item.onclick = async () => {
      try {
        const text = await loadExample(item.dataset.ex)
        els.source.value = state.text = text
        // Called directly, not through requestAnimationFrame: fit reads the
        // viewport rect and the scene's own numbers, never a painted frame,
        // and rAF is throttled to nothing in a background tab.
        rebuild(); fit()
      } catch (e) { showToast(e.message, 'error') }
    }
  })
}

// ── boot ─────────────────────────────────────────────────────
async function init() {
  Object.assign(els, {
    source: $('traceSource'), stage: $('traceStage'), view: $('traceView'),
    empty: $('traceEmpty'), diags: $('traceDiags'), counts: $('traceCounts'),
    suggest: $('traceSuggest'), zoomLabel: $('trZoomLabel'),
    title: $('traceTitle'), examplesMenu: $('traceExamplesMenu'),
  })

  initCamera(); initExport(); initMenus()

  els.source.addEventListener('input', () => { state.text = els.source.value; rebuildSoon() })

  const initial = await loadFromUrl()
  if (initial) { els.source.value = state.text = initial }
  rebuild()
  fit()

  // A share link's payload is now in the textarea; drop it from the URL so a
  // reload does not silently reinstate an older copy over your edits. Not in
  // an embed: there the hash is the only copy of the document, and stripping
  // it means the iframe comes back empty the first time it reloads itself.
  if (!state.embed && location.hash.includes('t=')) {
    history.replaceState(null, '', location.pathname + location.search)
  }

  window.addEventListener('resize', debounce(fit, 200))
}

init()
