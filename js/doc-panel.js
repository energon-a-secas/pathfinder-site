// ════════════════════════════════════════════════════════════
//  doc-panel.js — Living documentation: wire a block to an
//  external doc, preview it in a floating popup, and turn a
//  block's questions into grounded, ready-to-paste AI prompts.
//
//  Security posture (deliberately conservative):
//   • Fetch is attempted ONLY for same-origin URLs or ones under
//     a single user-configured docs base (localStorage
//     `pathfinder-docs-base`). Every other href degrades to an
//     "Open in new tab" link — no request is made.
//   • Fetched Markdown/text is HTML-escaped BEFORE the tiny
//     renderer runs, so doc content can never inject markup.
//   • No secrets, no proxy, no third-party calls. The live-AI
//     path is intentionally scaffolded-but-disabled below.
// ════════════════════════════════════════════════════════════

import { state, canvasMeta } from './state.js'
import { $, TYPES, escHtml, showToast, copyText } from './utils.js'
import { buildQuestionPrompt } from './prompt.js'

const DOCS_BASE_KEY = 'pathfinder-docs-base'

// ── Docs base URL config ─────────────────────────────────────
export function getDocsBase() {
  try { return (localStorage.getItem(DOCS_BASE_KEY) || '').trim() } catch (_) { return '' }
}
export function setDocsBase(url) {
  try {
    const clean = (url || '').trim()
    if (clean) localStorage.setItem(DOCS_BASE_KEY, clean)
    else localStorage.removeItem(DOCS_BASE_KEY)
  } catch (_) {}
}

// ── Reachability gate ────────────────────────────────────────
// A doc is fetchable only when it resolves to the same origin or sits under
// the configured docs base. Anything else is "link-only" (opened in a tab).
export function resolveDocRef(docRef) {
  if (!docRef || !docRef.href) return null
  let url
  try { url = new URL(docRef.href, location.href) } catch (_) { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const anchor = docRef.anchor ? `#${docRef.anchor}` : (url.hash || '')
  const full = url.origin + url.pathname + url.search + anchor

  const base = getDocsBase()
  const sameOrigin = url.origin === location.origin
  const underBase = base && full.startsWith(base)
  return { url: full, anchor: docRef.anchor || url.hash.replace(/^#/, ''), fetchable: !!(sameOrigin || underBase) }
}

// ── "See: X" detection ───────────────────────────────────────
// Recognizes a trailing `See: <target>` line in a description. If the target
// looks like a URL or a root-relative path it becomes an href, otherwise it is
// treated as a human label the user can attach an href to later.
const SEE_RE = /(?:^|\n)\s*See:\s*(.+?)\s*$/i
export function detectSeeReference(description) {
  const m = SEE_RE.exec(description || '')
  if (!m) return null
  const target = m[1].trim()
  if (!target) return null
  const isUrl = /^https?:\/\//i.test(target) || target.startsWith('/')
  return isUrl ? { href: target, label: '', anchor: '' } : { href: '', label: target, anchor: '' }
}

// ── Tiny Markdown renderer ───────────────────────────────────
// Input is HTML-escaped first, so this only ever promotes safe text to safe
// markup. Covers the constructs a docs page realistically uses; anything else
// falls through as an escaped paragraph.
function renderMarkdown(src) {
  const esc = escHtml(src)
  const lines = esc.split(/\r?\n/)
  const out = []
  let inList = false, inCode = false, para = []

  const flushPara = () => {
    if (!para.length) return
    out.push('<p>' + inline(para.join(' ')) + '</p>')
    para = []
  }
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false } }

  const inline = s => s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    // [text](href) — only http(s), rendered as a safe new-tab link
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  for (const line of lines) {
    const fence = /^```/.test(line)
    if (fence) {
      flushPara(); closeList()
      if (!inCode) { out.push('<pre><code>'); inCode = true }
      else { out.push('</code></pre>'); inCode = false }
      continue
    }
    if (inCode) { out.push(line + '\n'); continue }

    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { flushPara(); closeList(); const l = h[1].length; out.push(`<h${l}>${inline(h[2])}</h${l}>`); continue }

    const li = /^\s*[-*]\s+(.*)$/.exec(line)
    if (li) { flushPara(); if (!inList) { out.push('<ul>'); inList = true } out.push(`<li>${inline(li[1])}</li>`); continue }

    if (!line.trim()) { flushPara(); closeList(); continue }
    para.push(line.trim())
  }
  flushPara(); closeList()
  if (inCode) out.push('</code></pre>')
  return out.join('\n')
}

// ── Floating doc popup ───────────────────────────────────────
let popupEl = null

function closeDocPopup() {
  popupEl?.remove()
  popupEl = null
  document.removeEventListener('keydown', onPopupKey, true)
  document.removeEventListener('pointerdown', onPopupOutside, true)
}
function onPopupKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closeDocPopup() } }
function onPopupOutside(e) { if (popupEl && !popupEl.contains(e.target)) closeDocPopup() }

export function openDocPopup(blockId, anchorEl) {
  const b = state.blocks[blockId]; if (!b || !b.docRef) return
  closeDocPopup()

  const label = b.docRef.label || b.docRef.href || 'Documentation'
  const resolved = resolveDocRef(b.docRef)

  popupEl = document.createElement('div')
  popupEl.className = 'doc-popup'
  popupEl.setAttribute('role', 'dialog')
  popupEl.setAttribute('aria-label', 'Documentation preview')
  popupEl.innerHTML = `
    <div class="doc-popup-head">
      <span class="doc-popup-title">${escHtml(label)}</span>
      <div class="doc-popup-actions">
        ${resolved ? `<a class="doc-popup-open" href="${escHtml(resolved.url)}" target="_blank" rel="noopener noreferrer" title="Open in new tab">Open ↗</a>` : ''}
        <button class="doc-popup-close" aria-label="Close">×</button>
      </div>
    </div>
    <div class="doc-popup-body" id="docPopupBody"></div>`

  document.body.appendChild(popupEl)
  positionPopup(anchorEl)

  popupEl.querySelector('.doc-popup-close').addEventListener('click', closeDocPopup)
  document.addEventListener('keydown', onPopupKey, true)
  // Defer the outside-click listener so the opening click doesn't close it.
  setTimeout(() => document.addEventListener('pointerdown', onPopupOutside, true), 0)

  const body = popupEl.querySelector('#docPopupBody')
  if (!resolved) {
    body.innerHTML = `<div class="doc-popup-note">This block has a documentation label but no fetchable URL. Add a link in the inspector to preview it here.</div>`
    return
  }
  if (!resolved.fetchable) {
    body.innerHTML = `<div class="doc-popup-note">This page is outside the configured docs base, so it can't be previewed inline (browser security).<br><a href="${escHtml(resolved.url)}" target="_blank" rel="noopener noreferrer">Open it in a new tab ↗</a><br><span class="doc-popup-hint">Set a docs base URL under Prompt → Dev Options to preview same-site pages.</span></div>`
    return
  }

  body.innerHTML = `<div class="doc-popup-note">Loading…</div>`
  fetchDoc(resolved.url).then(({ ok, text, contentType }) => {
    if (!popupEl) return
    if (!ok) {
      body.innerHTML = `<div class="doc-popup-note">Couldn't load this page (it may block cross-site requests).<br><a href="${escHtml(resolved.url)}" target="_blank" rel="noopener noreferrer">Open it in a new tab ↗</a></div>`
      return
    }
    body.innerHTML = /html/.test(contentType)
      ? `<div class="doc-popup-note">This is an HTML page — preview shows a link instead.<br><a href="${escHtml(resolved.url)}" target="_blank" rel="noopener noreferrer">Open it in a new tab ↗</a></div>`
      : `<div class="doc-md">${renderMarkdown(text)}</div>`
  })
}

function positionPopup(anchorEl) {
  if (!popupEl) return
  const pad = 12
  const r = anchorEl?.getBoundingClientRect?.()
  const w = Math.min(440, window.innerWidth - pad * 2)
  popupEl.style.width = w + 'px'
  let left = r ? r.left : (window.innerWidth - w) / 2
  let top = r ? r.bottom + 8 : 80
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad))
  top = Math.max(pad, Math.min(top, window.innerHeight - 120))
  popupEl.style.left = left + 'px'
  popupEl.style.top = top + 'px'
}

async function fetchDoc(url) {
  try {
    const res = await fetch(url, { credentials: 'omit', redirect: 'follow' })
    const contentType = res.headers.get('content-type') || ''
    const text = await res.text()
    return { ok: res.ok, text, contentType }
  } catch (_) {
    return { ok: false, text: '', contentType: '' }
  }
}

// ── Ask a live question ──────────────────────────────────────
// Builds a focused, grounded prompt for one question and copies it. The
// no-provider path is the product; a live call would slot in here behind an
// explicit, user-configured key (intentionally not shipped — see module head).
export function askQuestion(block, qIndex) {
  const q = block.questions?.[qIndex]
  if (!q || !q.text.trim()) { showToast('Write the question first', 'warning'); return }
  const prompt = buildQuestionPrompt(block, q)
  copyText(prompt).then(ok => {
    showToast(ok
      ? 'Grounded question prompt copied — paste it into your assistant, then drop the answer back in'
      : 'Copy failed — try again', ok ? 'success' : 'warning')
  })
}
