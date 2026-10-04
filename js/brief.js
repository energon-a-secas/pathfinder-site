// ════════════════════════════════════════════════════════════
//  brief.js: the Brief tab. The prompt read as a document, not
//  a form: mode and Copy on top, one readiness line counted the
//  way the Attention tab counts, the framing folded into one
//  row, the brief rendered as Markdown with a section outline
//  and a size estimate, and the way back (a pasted reply) last.
//
//  The tab keeps its internal id, "prompt" (ui.activeTab, the
//  #promptPane element), so every caller that refreshes it
//  still does.
// ════════════════════════════════════════════════════════════

import { state, selection, ui } from './state.js'
import { escHtml, showToast, copyText, TYPES } from './utils.js'
import { generatePrompt, generateScopedPrompt, briefScope, estimateTokens, roundTokens, formatTokens,
         briefSectionCount, markExported, getPromptDiff, setBriefRenderer, refreshPrompt,
         CHARS_PER_TOKEN, TOKEN_ERROR, TOKEN_ERROR_P75 } from './prompt.js'
import { attentionModel } from './attention.js'
import { openDropdown } from './menu.js'
import { briefHtml } from './brief-md.js'
import { refreshFramingSummary } from './ui-panels.js'

// ── The readiness line ──────────────────────────────────────
// One sentence instead of a grade: what is still open, counted exactly as
// the Attention tab counts it (the same model, so the two numbers agree),
// broken down by what is open ("2 risks, 1 decision"), and a way to go and
// look.

const nOf = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

// A type's noun in a tally, where its label is not one ("Trigger / End").
const TYPE_NOUNS = {
  implementation: ['work item', 'work items'], process: ['process step', 'process steps'],
  terminator: ['trigger or end', 'triggers or ends'], resource: ['resource', 'resources'],
  question: ['open question', 'open questions'], context: ['context block', 'context blocks'],
  custom: ['other block', 'other blocks'],
}
function typeNoun(type, n) {
  const own = TYPE_NOUNS[type]
  if (own) return own[n === 1 ? 0 : 1]
  const t = TYPES[type]
  if (!t) return n === 1 ? 'gap' : 'gaps'
  return (n === 1 ? t.label : (t.plural || t.label + 's')).toLowerCase()
}

// What a missing criteria list is called on each type that has one.
const CRITERIA_WORDS = {
  requirement: n => `${nOf(n, 'requirement')} without criteria`,
  metric: n => `${nOf(n, 'metric')} without ${n === 1 ? 'a target' : 'targets'}`,
}

/** Count items by a key, in first-seen order unless `rank` orders the keys. */
function tally(items, key, rank = null) {
  const m = new Map()
  items.forEach(i => { const k = key(i); m.set(k, (m.get(k) || 0) + 1) })
  const keys = [...m.keys()]
  if (rank) keys.sort((a, b) => rank(a) - rank(b))
  return keys.map(k => [k, m.get(k)])
}

const TYPE_ORDER = Object.keys(TYPES)
const typeRank = t => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? TYPE_ORDER.length : i }

/** From an attentionModel result: the open count, its parts and the sentence. */
export function readiness(model) {
  const items = model?.items || []
  const accepted = (model?.accepted || []).filter(a => a.live !== false).length
  const of = kind => items.filter(i => i.kind === kind)
  const parts = []
  const blocked = of('blocked').length
  if (blocked) parts.push(`${blocked} blocked`)
  const questions = of('question').length
  if (questions) parts.push(nOf(questions, 'question'))
  const assumptions = of('assumption').length
  if (assumptions) parts.push(nOf(assumptions, 'assumption'))
  // Criteria: said per type, since a metric's list is its targets.
  tally(of('criteria'), i => CRITERIA_WORDS[i.type] ? i.type : '', typeRank).forEach(([type, n]) =>
    parts.push(CRITERIA_WORDS[type] ? CRITERIA_WORDS[type](n) : `${n} without criteria`))
  // Gaps: what is open, by type ("2 risks, 1 decision"); isolation is
  // about a block's connections, whatever its type, so it is said apart.
  const gaps = of('gap')
  tally(gaps.filter(i => i.gap !== 'gap-isolated'), i => i.type || '', typeRank).forEach(([type, n]) =>
    parts.push(type ? nOf(n, typeNoun(type, 1), typeNoun(type, 2)) : nOf(n, 'gap')))
  const isolated = gaps.filter(i => i.gap === 'gap-isolated').length
  if (isolated) parts.push(nOf(isolated, 'unconnected block'))
  const canvas = of('canvas').length
  if (canvas) parts.push(nOf(canvas, 'canvas check'))

  const open = items.length
  const acc = accepted ? nOf(accepted, 'accepted gap') : ''
  const lead = open ? nOf(open, 'open item') : 'No open items'
  const text = open
    ? `${lead}: ${parts.join(', ')}.${acc ? ` ${acc[0].toUpperCase()}${acc.slice(1)}.` : ''}`
    : `${lead}${acc ? `; ${acc}` : ''}.`
  return { open, accepted, parts, lead, text }
}

// ── Scope: the whole map, or the selection and its neighbours ─

let scope = 'map'
const selectedIds = () => [...selection.ids].filter(id => state.blocks[id])

/** 'selection' only while that is the choice and something is selected. */
export function briefScopeNow() {
  if (scope === 'selection' && !selectedIds().length) scope = 'map'
  return scope
}

export function setBriefScope(next) {
  scope = next === 'selection' && selectedIds().length ? 'selection' : 'map'
  ui.promptDirty = true
  if (ui.activeTab === 'prompt') refreshPrompt()
  return scope
}

/** The brief the tab shows and Copy copies: whole map, or the scoped one. */
export function currentBriefText() {
  if (!Object.keys(state.blocks).length) return ''
  return briefScopeNow() === 'selection' ? generateScopedPrompt(selectedIds()) : generatePrompt()
}

// ── Copy ────────────────────────────────────────────────────

const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>'
const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'

/** "about 2,400 tokens, 12 sections": what a copy handed over. */
export function copiedSummary(text) {
  const tokens = roundTokens(estimateTokens(text)).toLocaleString('en-US')
  const n = briefSectionCount(text)
  return `about ${tokens} tokens, ${n} section${n === 1 ? '' : 's'}`
}

let copyReset = null
function flashCopied() {
  const btn = document.getElementById('copyPromptBtn'); if (!btn) return
  const label = btn.querySelector('.brief-copy-label')
  clearTimeout(copyReset)
  btn.classList.add('copied')
  btn.querySelector('svg')?.replaceWith(document.createRange().createContextualFragment(CHECK_ICON))
  if (label) label.textContent = 'Copied'
  copyReset = setTimeout(() => {
    btn.classList.remove('copied')
    btn.querySelector('svg')?.replaceWith(document.createRange().createContextualFragment(COPY_ICON))
    if (label) label.textContent = 'Copy brief'
  }, 1800)
}

/**
 * Copy the brief: by default what the Brief tab shows (its scope), or the
 * whole map with { scope: 'map' }. Says what went: its size and sections.
 * A whole-map copy is the one later changes are counted from.
 */
export async function copyBrief({ scope: which } = {}) {
  if (!Object.keys(state.blocks).length) { showToast('Add a block first: the brief is written from the map', 'warning'); return false }
  const partial = (which || briefScopeNow()) === 'selection' && selectedIds().length > 0
  const text = partial ? generateScopedPrompt(selectedIds()) : generatePrompt()
  const back = document.activeElement
  const ok = await copyText(text)
  // The clipboard fallback borrows focus for a moment: give it back.
  if (back && back.isConnected && document.activeElement !== back && typeof back.focus === 'function') back.focus({ preventScroll: true })
  if (!ok) { showToast('Copy failed: select the text in the Brief tab and copy it from there', 'warning'); return false }
  if (!partial) markExported()
  ui.promptDirty = true
  if (ui.activeTab === 'prompt') refreshPrompt()
  flashCopied()
  showToast(`Copied${partial ? ' the brief for the selection' : ''}: ${copiedSummary(text)}`, 'success', 2600)
  return true
}

// ── The pane ────────────────────────────────────────────────

const byId = id => document.getElementById(id)
let lastText = null, lastSections = [], lastScopeKey = '', lastOut = null

// ── Framing ─────────────────────────────────────────────────
// Open, the framing takes the space it needs and scrolls on its own, and
// the brief keeps a floor below it showing where the framing writes, so a
// change is seen where it lands. It always starts closed: it is set once
// per map, and a panel that reopens on it hides the brief on every visit.

export function setFraming(open) {
  const btn = byId('briefFramingBtn'), body = byId('briefFraming')
  if (!btn || !body) return
  const was = btn.getAttribute('aria-expanded') === 'true'
  btn.setAttribute('aria-expanded', String(open))
  body.hidden = !open
  byId('promptPane')?.classList.toggle('framing-open', open)
  // Opening it shows the brief from the top: the Situation, which the
  // framing writes, is its first section.
  if (open && !was) { const doc = byId('briefDoc'); if (doc) doc.scrollTop = 0 }
}

/**
 * After a change made while the framing is open, mark the part of the brief
 * that changed and bring it into view under the bar. Compares the top-level
 * blocks, and the items of a changed list, of the old and the new render.
 */
function showChange(out, oldNodes) {
  const doc = byId('briefDoc'); if (!doc || !oldNodes) return
  const sameAs = (a, b) => a && b && a.outerHTML === b.outerHTML
  const nodes = [...out.children]
  let i = 0
  while (i < nodes.length && sameAs(nodes[i], oldNodes[i])) i++
  let hit = nodes[i]
  if (!hit) return
  const before = oldNodes[i]
  if (hit.matches('.md-list') && before?.matches('.md-list')) {
    const li = [...hit.children], was = [...before.children]
    let j = 0
    while (j < li.length && sameAs(li[j], was[j])) j++
    if (li[j]) hit = li[j]
  }
  hit.classList.add('md-changed')
  const shown = belowBar(doc, hit)
  const room = doc.clientHeight - (doc.querySelector('.brief-docbar')?.offsetHeight || 0)
  if (shown < 4 || shown + Math.min(hit.offsetHeight, room / 2) > room) doc.scrollTop = Math.max(0, doc.scrollTop + shown - 8)
}

// ── The reply ───────────────────────────────────────────────
// Pasting a reply is its own step: while the panel is open it takes the
// brief's place and scrolls on its own, with Apply kept in view at its foot.
// patch.js opens and closes the panel; this follows it.

const followed = new WeakSet()
export function followReplyPanel() {
  const panel = byId('patchPanel'), pane = byId('promptPane')
  if (!panel || !pane || followed.has(panel)) return
  followed.add(panel)
  const sync = () => {
    const open = panel.style.display !== 'none' && byId('patchSection')?.style.display !== 'none'
    if (open && byId('briefFramingBtn')?.getAttribute('aria-expanded') === 'true') setFraming(false)
    pane.classList.toggle('reply-open', open)
    byId('patchOpenBtn')?.setAttribute('aria-expanded', String(open))
  }
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['style'] })
  sync()
  // A preview that appears below the box is brought into view.
  const preview = byId('patchPreview'), reply = byId('patchSection')
  if (preview && reply) new MutationObserver(() => {
    if (!pane.classList.contains('reply-open') || !preview.childElementCount) return
    const top = preview.getBoundingClientRect().top - reply.getBoundingClientRect().top
    const actions = reply.querySelector('.patch-actions')?.offsetHeight || 0
    if (top > reply.clientHeight - actions - 48) reply.scrollTop += top - 96
  }).observe(preview, { childList: true })
}

/** How far a heading sits below the sticky bar's bottom edge, in pixels. */
function belowBar(doc, h) {
  const bar = doc.querySelector('.brief-docbar')
  const edge = (bar || doc).getBoundingClientRect()[bar ? 'bottom' : 'top']
  return h.getBoundingClientRect().top - edge
}

/**
 * The section the reader is in: the last heading that has reached the bar,
 * or none while the first is still in view below it (the bar then says
 * "Sections" rather than repeat the heading under it).
 */
function currentSectionId() {
  const doc = byId('briefDoc'); if (!doc || !lastSections.length) return null
  if (!doc.offsetParent) return null
  let at = null
  for (const s of lastSections) {
    const h = byId(s.id); if (!h) continue
    if (belowBar(doc, h) <= 8) at = s.id; else break
  }
  return at
}

function syncSectionName() {
  const name = byId('briefSectionName'); if (!name) return
  const id = currentSectionId()
  const s = lastSections.find(x => x.id === id)
  name.textContent = s ? s.title : 'Sections'
}

function goToSection(id) {
  const doc = byId('briefDoc'), h = byId(id)
  if (!doc || !h) return
  doc.scrollTop = Math.max(0, doc.scrollTop + belowBar(doc, h) - 4)
  h.focus({ preventScroll: true })
  syncSectionName()
}

function outlineItems() {
  const here = currentSectionId()
  return lastSections.map(s => s.level === 1
    ? { type: 'heading', label: s.title }
    : { label: s.title, shortcut: s.items ? String(s.items) : '', radio: true, checked: s.id === here, action: () => goToSection(s.id) })
}

// ── Scope: Whole map | Selection, beside Copy ───────────────

function renderScope(has, now) {
  const group = byId('briefScope'); if (!group) return
  group.hidden = !has
  const ids = selectedIds()
  const { scope: covered, total } = briefScope(ids)
  group.querySelectorAll('[data-scope]').forEach(b => {
    const on = b.dataset.scope === now
    b.setAttribute('aria-pressed', String(on))
    if (b.dataset.scope !== 'selection') { b.title = `The whole map, ${nOf(total, 'block')}`; return }
    const can = ids.length > 0
    b.setAttribute('aria-disabled', String(!can))
    b.title = can
      ? `${nOf(ids.length, 'selected block')} and the blocks connected to ${ids.length === 1 ? 'it' : 'them'}: ${covered.size} of ${total}`
      : 'Select blocks on the map first'
  })
  const count = byId('briefScopeCount')
  if (count) count.textContent = ids.length ? String(ids.length) : ''
}

/** Past this size a whole-map brief says how to hand over less. */
export const LONG_BRIEF_TOKENS = 25000

function renderDiff() {
  const el = byId('promptDiff'); if (!el) return
  const diff = briefScopeNow() === 'map' ? getPromptDiff() : null
  if (!diff) { el.hidden = true; el.textContent = ''; return }
  const parts = []
  const n = (k, one, many = one + 's') => `${k} ${k === 1 ? one : many}`
  if (diff.added.length) parts.push(`${n(diff.added.length, 'block')} added`)
  if (diff.removed.length) parts.push(`${n(diff.removed.length, 'block')} removed`)
  if (diff.modified.length) parts.push(`${n(diff.modified.length, 'block')} changed`)
  if (diff.addedArrows) parts.push(`${n(diff.addedArrows, 'connection')} added`)
  if (diff.removedArrows) parts.push(`${n(diff.removedArrows, 'connection')} removed`)
  if (diff.modifiedArrows) parts.push(`${n(diff.modifiedArrows, 'connection')} changed`)
  if (diff.framingChanged) parts.push('framing or options changed')
  if (diff.groupsChanged) parts.push('groups changed')
  el.hidden = false
  el.textContent = `Since your last copy: ${parts.join(', ')}.`
}

/** The size note: what the estimate is and how far it can be off. */
export function sizeNote(text) {
  const est = estimateTokens(text)
  const pct = x => `${Math.round(x * 100)}%`
  return `${String(text || '').length.toLocaleString('en-US')} characters, about ${roundTokens(est).toLocaleString('en-US')} tokens. ` +
    `Estimated at ${CHARS_PER_TOKEN} characters per token, the ratio measured for Markdown on Claude: ` +
    `half of estimates land within ${pct(TOKEN_ERROR)} of the real count, three in four within ${pct(TOKEN_ERROR_P75)}.`
}

/**
 * The size is a disclosure: a click, Enter or Space shows the note under
 * the bar, Escape hides it, so it reaches a keyboard and a touch, not only
 * a pointer that hovers.
 */
const sizeWired = new WeakSet()
export function wireSizeNote() {
  const tokens = byId('briefTokens'), note = byId('briefTokensNote')
  if (!tokens || !note || sizeWired.has(tokens)) return
  sizeWired.add(tokens)
  const show = open => { tokens.setAttribute('aria-expanded', String(open)); note.hidden = !open }
  tokens.addEventListener('click', () => show(tokens.getAttribute('aria-expanded') !== 'true'))
  tokens.addEventListener('keydown', e => {
    if (e.key === 'Escape' && tokens.getAttribute('aria-expanded') === 'true') { e.stopPropagation(); show(false) }
  })
}

/** Draw the Brief tab from the map. Registered as prompt.js's renderer. */
export function renderBrief() {
  const pane = byId('promptPane'); if (!pane) return
  const has = Object.keys(state.blocks).length > 0
  const now = briefScopeNow()
  const text = currentBriefText()
  // An empty map has no brief to read, size or answer: the tab shows the
  // mode, the framing (worth setting first) and what will appear.
  pane.classList.toggle('is-empty', !has)

  // Copy, scope and size.
  const copyBtn = byId('copyPromptBtn')
  if (copyBtn) copyBtn.disabled = !has
  renderScope(has, now)
  const tokens = byId('briefTokens'), note = byId('briefTokensNote')
  if (tokens) {
    tokens.hidden = !has
    tokens.textContent = has ? `About ${formatTokens(estimateTokens(text))}` : ''
    tokens.title = has ? sizeNote(text) : ''
    if (!has) { tokens.setAttribute('aria-expanded', 'false'); if (note) note.hidden = true }
  }
  if (note && has) note.textContent = sizeNote(text)

  // The readiness line, from the Attention tab's own model.
  const ready = byId('briefReady')
  if (ready) {
    ready.hidden = !has
    if (has) {
      const r = readiness(attentionModel(state.blocks, state.arrows, { groups: state.groups }))
      const line = byId('briefReadyText')
      const html = `<strong>${escHtml(r.lead)}</strong>${escHtml(r.text.slice(r.lead.length))}`
      // Written only when it changed: a rebuild on every keystroke is noise.
      if (line && line.innerHTML !== html) line.innerHTML = html
      const review = byId('briefReviewBtn')
      if (review) review.hidden = !r.open && !r.accepted
    }
  }
  renderDiff()
  refreshFramingSummary()

  // A very long brief: one plain line, and no invented limit.
  const long = byId('briefLong')
  if (long) {
    const big = has && now === 'map' && estimateTokens(text) > LONG_BRIEF_TOKENS
    long.hidden = !big
    long.textContent = big ? `A long brief, ${formatTokens(estimateTokens(text))}. To hand over one part, select it on the map and choose Selection beside Copy brief.` : ''
  }

  // The document. Rebuilt only when its text changed, so a refresh that
  // changes nothing keeps the reader's place and any text they selected.
  const out = byId('promptOutput')
  const key = `${now}|${text}`
  // A new element (the pane mounted again) is drawn whatever the cache says.
  const fresh = out !== lastOut
  if (out && (key !== lastScopeKey || fresh)) {
    lastScopeKey = key; lastOut = out
    if (!has) {
      lastText = ''; lastSections = []
      out.innerHTML = '<p class="brief-empty">The brief is written from the map. Add a block, or start from a template, and it appears here, ready to copy.</p>'
    } else if (text !== lastText || fresh) {
      const { html, sections } = briefHtml(text)
      const framing = !fresh && pane.classList.contains('framing-open') && lastText
      out.querySelectorAll('.md-changed').forEach(el => el.classList.remove('md-changed'))
      const oldNodes = framing ? [...out.children] : null
      lastText = text; lastSections = sections
      out.innerHTML = html
      if (framing) showChange(out, oldNodes)
    }
  }
  const outlineBtn = byId('briefOutlineBtn')
  if (outlineBtn) outlineBtn.hidden = !lastSections.length
  syncSectionName()
}

// ── Keyboard: Cmd/Ctrl+Shift+C copies the brief ─────────────
function modalOpen() {
  try { if (document.querySelector('dialog[open]:modal')) return true } catch (_) {}
  const sheet = byId('shortcutOverlay')
  return !!(sheet && sheet.style.display !== 'none' && sheet.getAttribute('aria-modal') === 'true')
}

export function isCopyBriefKey(e) {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && (e.code === 'KeyC' || (e.key || '').toLowerCase() === 'c')
}

let wired = false
/** Wire the Brief tab once: renderer, controls, the copy shortcut. */
export function setupBrief() {
  if (wired) return
  wired = true
  setBriefRenderer(renderBrief)

  setFraming(false)
  byId('briefFramingBtn')?.addEventListener('click', () =>
    setFraming(byId('briefFramingBtn').getAttribute('aria-expanded') !== 'true'))
  followReplyPanel()

  byId('copyPromptBtn')?.addEventListener('click', () => copyBrief())

  // The status bar's copy button (named in ui-panels.js setupQuickCopy):
  // always the whole map, since only the Brief tab shows a scope.
  const pill = byId('copyPromptPill'), pillLabel = byId('copyPillLabel')
  let pillReset
  pill?.addEventListener('click', async () => {
    if (ui.readOnly || ui.embed || !Object.keys(state.blocks).length) return
    if (!await copyBrief({ scope: 'map' })) return
    clearTimeout(pillReset)
    if (pillLabel) pillLabel.textContent = 'Copied'
    pill.setAttribute('aria-label', 'Brief copied')
    pillReset = setTimeout(() => {
      if (pillLabel) pillLabel.textContent = 'Copy brief'
      pill.setAttribute('aria-label', 'Copy brief')
    }, 1800)
  })

  byId('briefScope')?.addEventListener('click', e => {
    const b = e.target.closest('[data-scope]'); if (!b) return
    if (b.dataset.scope === 'selection' && !selectedIds().length) {
      showToast('Select blocks on the map first: the brief then covers them and the blocks connected to them', 'info', 2600)
      return
    }
    setBriefScope(b.dataset.scope)
  })

  const outlineBtn = byId('briefOutlineBtn')
  outlineBtn?.addEventListener('click', () => openDropdown(outlineBtn, outlineItems(), { label: 'Sections of the brief' }))

  wireSizeNote()

  byId('briefReviewBtn')?.addEventListener('click', () => {
    const tab = document.querySelector('.panel-tab[data-tab="attention"]')
    tab?.click()
    tab?.focus({ preventScroll: true })
  })

  const doc = byId('briefDoc')
  if (doc) {
    let raf = 0
    doc.addEventListener('scroll', () => {
      if (raf) return
      raf = requestAnimationFrame(() => { raf = 0; syncSectionName() })
    }, { passive: true })
  }

  // The scope follows the selection while the tab is open. Selection has no
  // event of its own; every way of changing it ends in a pointer release or
  // a key, so check after those.
  let selKey = ''
  const checkSelection = () => setTimeout(() => {
    const key = [...selection.ids].join(',')
    if (key === selKey) return
    selKey = key
    if (ui.activeTab !== 'prompt') return
    ui.promptDirty = true
    refreshPrompt()
  }, 0)
  document.addEventListener('pointerup', checkSelection, true)
  document.addEventListener('keyup', checkSelection, true)
  window.addEventListener('pf:canvas-changed', checkSelection)

  document.addEventListener('keydown', e => {
    if (!isCopyBriefKey(e) || ui.embed || modalOpen()) return
    e.preventDefault()
    copyBrief()
  })

  // The way in for other menus (the command palette, a selection's context
  // menu, File): dispatch `pf:copy-brief` with { scope: 'map' | 'selection' }
  // rather than importing this module, which app.js alone may load.
  window.addEventListener('pf:copy-brief', e => {
    if (ui.embed) return
    copyBrief({ scope: e.detail?.scope })
  })
}
