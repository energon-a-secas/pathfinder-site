// ============================================================
//  consistency.test.js: the CONSISTENCY stream (design round,
//  wave 2). One vocabulary everywhere: sentence case, one stroked
//  icon set, the open map's name in the header, quiet header
//  buttons, neutral toasts, one picker for every filter, the
//  Session timer under View, Facilitation, the palette rail, and
//  the inspector as a property sheet with per-type placeholders.
// ============================================================

import { describe, it, assert, cssRgba } from './test-utils.js'
import { state, ui, canvasMeta, selection } from '../js/state.js'
import { $, TYPES, STATUS_DEFS, ACTION_LABELS, showToast, toastIcon } from '../js/utils.js'
import { renderBlock, updateCanvasTitle } from '../js/render.js'
import { setupCanvasTitle, renameMap } from '../js/events.js'
import { closeMenus, isMenuOpen, openDropdown } from '../js/menu.js'
import { setupFilter, filterValue, setFilterValue } from '../js/filter-menu.js'
import { setupAttention } from '../js/attention.js'
import { placeholdersFor } from '../js/inspector.js'
import { getPref, setPref } from '../js/prefs.js'
import { setVotingMode } from '../js/voting.js'
import { viewMenuItems, fileMenuItems, shareMenuItems, helpMenuItems, tidyMenuItems, mapsMenuWithRename,
         facilitationItems, setSessionTimer, sessionTimerShown, applySessionTimer } from '../js/view-menu.js'
import { mapsMenuItems } from '../js/library.js'
import { setPaletteRail, collapseTemplatesAfterUse } from '../js/ui-panels.js'
import { buildMarkdown, buildMeetingSummary } from '../js/export.js'
import { renderPaletteTypes } from '../js/palette.js'

// ── Helpers ──────────────────────────────────────────────────

let pageDoc = null
async function page() {
  if (!pageDoc) pageDoc = new DOMParser().parseFromString(await (await fetch('../index.html')).text(), 'text/html')
  return pageDoc
}

// The stylesheet in a frame of its own, so media and container queries,
// :has() and the theme tokens resolve as they do on the page.
async function frame(html, { width = 1200, height = 800, bodyClass = '', kit = false } = {}) {
  const f = document.createElement('iframe')
  f.style.cssText = `position:fixed;left:-7000px;top:0;width:${width}px;height:${height}px;border:0`
  f.srcdoc = '<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css">' +
    (kit ? '<link rel="stylesheet" href="../css/neorgon-header.css">' : '') +
    '<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>' +
    `</head><body class="${bodyClass}">${html}</body></html>`
  const loaded = new Promise(res => f.addEventListener('load', res, { once: true }))
  document.body.appendChild(f)
  await loaded
  await new Promise(res => f.contentWindow.requestAnimationFrame(() => res()))
  return f
}
const rgb = s => cssRgba(s) || []
const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const over = (fg, bg) => { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)) }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const tokenColor = (win, doc, expr) => {
  const i = doc.createElement('i'); i.style.color = expr; doc.body.appendChild(i)
  const c = rgb(win.getComputedStyle(i).color); i.remove(); return c
}

// Sentence case: the first word capitalised, every later word lower case,
// except names (formats, products) and single-letter keys.
const PROPER = new Set(['JSON', 'Canvas', 'Mermaid', 'Markdown', 'PNG', 'SVG', 'AI', 'Presentation', 'Sage',
  'Trace', 'H', 'Z', 'Alt+H', 'Pathfinder', 'GitHub', 'Neorgon', 'I'])
function sentenceCase(label) {
  const words = String(label).replace(/[()…:,]/g, ' ').split(/\s+/).filter(Boolean)
  return words.every((w, i) => {
    if (i === 0) return !/^[a-z]/.test(w)
    if (PROPER.has(w) || /^[^A-Za-z]/.test(w) || /\d/.test(w)) return true
    return !/^[A-Z][a-z]/.test(w)
  })
}
const rowLabels = items => (items || []).filter(i => i && !i.type).map(i => i.label)

// ── The open map's name ──────────────────────────────────────

describe('consistency: the header names the open map', () => {
  it('the breadcrumb sits beside the mark: Maps, a separator, the title, with no tagline left', async () => {
    const doc = await page()
    const crumb = doc.querySelector('.header-logo .map-crumb')
    assert.ok(crumb, 'a breadcrumb in the logo block')
    assert.ok(crumb.querySelector('#mapsBtn'), 'Maps opens the map list from the breadcrumb')
    assert.ok(crumb.querySelector('.map-crumb-sep'), 'a separator')
    const title = crumb.querySelector('#canvasTitle')
    assert.ok(title && !title.closest('a'), 'the title is not inside the home link any more')
    assert.eq(title.dataset.placeholder, 'Untitled map')
    assert.ok(!doc.querySelector('.header-bar .header-subtitle'), 'no "Strategy canvas" subtitle on the app page')
    assert.notIncludes(doc.querySelector('.header-bar').textContent, 'Strategy canvas')
  })

  it('an untitled map reads "Untitled map" in the muted style, and a named one its name', () => {
    const saved = { title: canvasMeta.title, ro: ui.readOnly }
    try {
      ui.readOnly = false
      canvasMeta.title = ''
      updateCanvasTitle()
      const el = $.canvasTitle()
      assert.eq(el.textContent, 'Untitled map')
      assert.ok(el.classList.contains('is-untitled'))
      assert.eq(el.getAttribute('aria-label'), 'Rename map, Untitled map')
      canvasMeta.title = 'Checkout reliability plan'
      updateCanvasTitle()
      assert.eq(el.textContent, 'Checkout reliability plan')
      assert.ok(!el.classList.contains('is-untitled'))
      assert.eq(document.title, 'Checkout reliability plan | Pathfinder')
    } finally { canvasMeta.title = saved.title; ui.readOnly = saved.ro; updateCanvasTitle() }
  })

  it('renaming an untitled map starts empty, so "Untitled map" is never saved as its name', () => {
    // A fresh element under the id, so these listeners are the only ones.
    const original = $.canvasTitle()
    const el = document.createElement('div')
    el.id = 'canvasTitle'
    el.dataset.placeholder = 'Untitled map'
    original.replaceWith(el)
    const saved = { title: canvasMeta.title, ro: ui.readOnly }
    try {
      ui.readOnly = false
      canvasMeta.title = ''
      updateCanvasTitle()
      setupCanvasTitle()
      // A page without system focus fires no blur on its own (as in qa2).
      const settle = () => { if (el.contentEditable === 'true') el.dispatchEvent(new FocusEvent('blur')) }
      const key = k => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
      key('Enter')
      assert.eq(el.contentEditable, 'true', 'Enter renames')
      assert.eq(el.textContent, '', 'the field opens empty, its placeholder shown by CSS')
      key('Enter'); settle()
      assert.eq(canvasMeta.title, '', 'committing nothing keeps the map untitled')
      assert.eq(el.textContent, 'Untitled map')
      // A real name, then Escape on a second rename puts it back.
      el.click()
      el.textContent = 'Launch readiness'
      key('Enter'); settle()
      assert.eq(canvasMeta.title, 'Launch readiness')
      el.click()
      el.textContent = 'Discarded'
      key('Escape'); settle()
      assert.eq(canvasMeta.title, 'Launch readiness', 'Escape keeps the old name')
    } finally {
      el.replaceWith(original)
      canvasMeta.title = saved.title; ui.readOnly = saved.ro
      updateCanvasTitle()
    }
  })

  it('the title is 14px/600 in the header ink, muted when untitled, and ellipsizes in one row', async () => {
    const doc = await page()
    const f = await frame(doc.querySelector('header.header-bar').outerHTML, { width: 1280, kit: true })
    try {
      const d = f.contentDocument, w = f.contentWindow
      const t = d.getElementById('canvasTitle')
      const cs = w.getComputedStyle(t)
      assert.eq(cs.fontSize, '14px')
      assert.eq(cs.fontWeight, '500', 'the untitled state is the medium weight')
      t.classList.remove('is-untitled')
      t.textContent = 'Quarterly reporting, delivery lifecycle and every status note across the portfolio'
      await new Promise(res => w.requestAnimationFrame(() => res()))
      assert.eq(w.getComputedStyle(t).fontWeight, '600')
      assert.ok(t.scrollWidth > t.clientWidth, 'a long name is cut with an ellipsis')
      assert.ok(d.querySelector('.header-bar').getBoundingClientRect().height <= 57, 'the bar stays one row')
    } finally { f.remove() }
  })

  it('view-only links drop the separator with Maps, and keep the name', async () => {
    const doc = await page()
    const f = await frame(doc.querySelector('header.header-bar').outerHTML, { width: 1280, kit: true, bodyClass: 'readonly-mode' })
    try {
      const w = f.contentWindow, d = f.contentDocument
      assert.eq(w.getComputedStyle(d.querySelector('.map-crumb-sep')).display, 'none')
      assert.neq(w.getComputedStyle(d.getElementById('canvasTitle')).display, 'none')
    } finally { f.remove() }
  })

  it('on a phone the breadcrumb, Share, the kit menu and home fit the bar', async () => {
    const doc = await page()
    for (const width of [375, 390]) {
      const f = await frame(doc.querySelector('header.header-bar').outerHTML, { width, kit: true })
      try {
        const d = f.contentDocument, w = f.contentWindow
        // What the kit's script does on a phone: every action but Share
        // moves into its overflow menu, behind a 36px toggle.
        const actions = d.querySelector('.header-actions')
        const parked = d.createElement('div'); parked.hidden = true
        ;[...actions.children].filter(el => !el.hasAttribute('data-keep-mobile')).forEach(el => parked.appendChild(el))
        d.body.appendChild(parked)
        actions.insertAdjacentHTML('beforeend', '<div class="header-overflow"><button class="header-overflow-toggle" type="button">...</button></div>')
        await new Promise(res => w.requestAnimationFrame(() => res()))
        assert.eq(w.getComputedStyle(d.querySelector('.map-crumb-word')).display, 'none', 'Maps is its icon')
        assert.neq(w.getComputedStyle(d.querySelector('.map-crumb-icon')).display, 'none')
        const t = d.getElementById('canvasTitle').getBoundingClientRect()
        const share = d.getElementById('shareWrapper').getBoundingClientRect()
        const home = d.querySelector('.header-home').getBoundingClientRect()
        const more = d.querySelector('.header-overflow').getBoundingClientRect()
        assert.ok(t.right <= share.left, `${width}px: the title ends before Share (${Math.round(t.right)} / ${Math.round(share.left)})`)
        assert.ok(more.right <= home.left, `${width}px: the kit menu clears home (${Math.round(more.right)} / ${Math.round(home.left)})`)
        assert.ok(home.right <= width, `${width}px: home is on screen`)
      } finally { f.remove() }
    }
  })
})

// ── Quiet header, one caret ──────────────────────────────────

describe('consistency: header buttons are quiet ghosts with one caret', () => {
  it('every menu button carries the stroked chevron and its label in a span, no ▾ glyph', async () => {
    const doc = await page()
    const head = doc.querySelector('header.header-bar')
    for (const id of ['mapsBtn', 'exportBtn', 'shareBtn', 'tidyMenuBtn', 'viewBtn', 'helpBtn']) {
      const b = doc.getElementById(id)
      const caret = b.querySelector('svg.hdr-caret')
      assert.ok(caret, `#${id} has the svg caret`)
      assert.eq(caret.getAttribute('stroke-width'), '1.5')
      assert.eq(caret.getAttribute('aria-hidden'), 'true')
      assert.ok([...b.childNodes].every(n => n.nodeType !== 3 || !n.textContent.trim()), `#${id}: no bare text beside the svg`)
    }
    assert.notIncludes(head.textContent, '▾')
  })

  it('at rest a header button has no fill and no edge; hover and an open menu light it', async () => {
    const doc = await page()
    for (const cls of ['', 'light-mode']) {
      const f = await frame(doc.querySelector('header.header-bar').outerHTML, { width: 1280, kit: true, bodyClass: cls })
      try {
        const d = f.contentDocument, w = f.contentWindow
        const b = d.getElementById('exportBtn')
        const cs = w.getComputedStyle(b)
        assert.eq(rgb(cs.backgroundColor)[3], 0, `${cls || 'dark'}: transparent at rest`)
        assert.eq(rgb(cs.borderTopColor)[3], 0, `${cls || 'dark'}: no edge at rest`)
        assert.eq(cs.height, '32px', 'the 32px control row')
        b.setAttribute('aria-expanded', 'true')
        assert.ok((rgb(w.getComputedStyle(b).backgroundColor)[3] ?? 1) > 0, 'an open menu keeps its button lit')
        // The custom skin paints the bar in the page's own ground (its
        // gradient stops are all --bg).
        const bar = tokenColor(w, d, 'var(--bg)')
        const ink = rgb(w.getComputedStyle(d.getElementById('viewBtn')).color)
        assert.ok(ratio(ink, bar) >= 4.5, `${cls || 'dark'}: the ghost label reads at ${ratio(ink, bar).toFixed(2)}:1`)
      } finally { f.remove() }
    }
  })
})

// ── One icon set, sentence case ──────────────────────────────

describe('consistency: one stroked icon set and sentence case in the menus', () => {
  it('every File and Share row has a stroked 16px icon at 1.5px, never a filled glyph', async () => {
    const doc = await page()
    const rows = [...doc.querySelectorAll('#fileActions > button, #shareActions > button')]
    assert.eq(rows.length, 16)
    rows.forEach(r => {
      const svg = r.querySelector('svg')
      assert.ok(svg, `${r.id} has an icon`)
      assert.eq(svg.getAttribute('viewBox'), '0 0 16 16', `${r.id}: the 16px grid`)
      assert.eq(svg.getAttribute('fill'), 'none', `${r.id}: stroked, not filled`)
      assert.eq(svg.getAttribute('stroke-width'), '1.5', `${r.id}: 1.5px`)
      assert.eq(svg.getAttribute('stroke-linecap'), 'round')
      assert.ok(!svg.querySelector('[fill="currentColor"]'), `${r.id}: no filled shape inside`)
    })
  })

  it('File, Share, View, Facilitation, Tidy, Help and Maps read in sentence case', async () => {
    const doc = await page()
    const lists = {
      File: rowLabels(fileMenuItems(doc.getElementById('fileActions'), { readOnly: false })),
      Share: rowLabels(shareMenuItems(doc.getElementById('shareActions'))),
      View: rowLabels(viewMenuItems()),
      Facilitation: rowLabels(facilitationItems()),
      Tidy: rowLabels(tidyMenuItems()),
      Help: rowLabels(helpMenuItems()),
      Maps: rowLabels(mapsMenuItems()).slice(1),
    }
    for (const [menu, labels] of Object.entries(lists)) {
      assert.ok(labels.length, `${menu} has rows`)
      labels.forEach(l => assert.ok(sentenceCase(l), `${menu}: "${l}" is in sentence case`))
    }
    assert.includes(lists.File, 'Copy brief')
    assert.includes(lists.File, 'Export meeting summary')
    assert.includes(lists.File, 'Download spec bundle (zip)')
  })

  it('statuses and the planning actions use plain sentence-case words', () => {
    assert.eq(STATUS_DEFS['not-started'].label, 'Not started')
    assert.eq(STATUS_DEFS['in-progress'].label, 'In progress')
    Object.values(STATUS_DEFS).forEach(s => assert.ok(sentenceCase(s.label), s.label))
    assert.eq(ACTION_LABELS.recollect, 'Look back')
    assert.eq(ACTION_LABELS.reinforce, 'Strengthen')
  })

  it('a card chip and the inspector toggle name an action the same way', async () => {
    state.blocks = { cx: { id: 'cx', type: 'problem', title: 'Late notes', description: '', notes: '', x: 0, y: 0,
      actions: ['recollect', 'reinforce'], questions: [], docRef: null } }
    try {
      renderBlock('cx')
      const words = [...document.querySelectorAll('#b-cx .action-badge span')].map(s => s.textContent)
      assert.deepEq(words, ['Look back', 'Strengthen'])
      const doc = await page()
      const toggles = [...doc.querySelectorAll('#planningDetails .action-toggle')].map(b => b.textContent.trim())
      assert.deepEq(toggles, ['Look back', 'Strengthen'])
    } finally { document.getElementById('b-cx')?.remove(); state.blocks = {} }
  })

  it('the connection meaning reads Auto (label or types) in the inspector and the context menu', async () => {
    const doc = await page()
    assert.eq(doc.querySelector('#arrowRelation option[value=""]').textContent, 'Auto (label or types)')
    const src = await (await fetch('../js/context-menu.js')).text()
    assert.includes(src, "label: 'Auto (label or types)'")
    assert.notIncludes(src, 'From label or direction')
  })

  it('labels, menu headings, palette heads and the view-only badge are not set in capitals', async () => {
    const f = await frame('<div class="insp-label" id="l">Title</div><div class="pf-menu"><div class="pf-menu-heading" id="h">This browser</div></div>' +
      '<aside class="palette"><span class="palette-head-title" id="p">Palette</span><button class="palette-section-toggle" id="s">Blocks</button>' +
      '<div class="palette-step-head" id="st">Why</div></aside><div class="readonly-badge" id="r">View only</div>' +
      '<div class="insp-endpoint-type" id="e">Goal</div><span class="insp-sublabel" id="sl">Link</span>')
    try {
      const w = f.contentWindow, d = f.contentDocument
      for (const id of ['l', 'h', 'p', 's', 'st', 'r', 'e', 'sl']) {
        assert.eq(w.getComputedStyle(d.getElementById(id)).textTransform, 'none', `#${id}`)
      }
      assert.eq(w.getComputedStyle(d.getElementById('l')).fontSize, '12px')
      assert.eq(w.getComputedStyle(d.getElementById('l')).fontWeight, '500')
    } finally { f.remove() }
  })
})

// ── Toasts ───────────────────────────────────────────────────

describe('consistency: toasts are neutral, the status is an icon', () => {
  it('a toast is an icon and the message; an unknown kind reads as info', () => {
    showToast('Snapshot kept', 'success', 50)
    const t = document.querySelector('.toast-notification')
    try {
      assert.ok(t.classList.contains('toast-success'))
      const svg = t.querySelector('svg.toast-icon')
      assert.ok(svg && svg.getAttribute('fill') === 'none' && svg.getAttribute('stroke-width') === '1.5', 'a stroked icon')
      assert.eq(svg.getAttribute('aria-hidden'), 'true', 'the words carry the meaning')
      assert.eq(t.querySelector('.toast-msg').textContent, 'Snapshot kept')
      assert.eq(t.textContent, 'Snapshot kept', 'nothing else is read')
    } finally { t.remove() }
    showToast('<b>not markup</b>', 'odd', 50)
    const u = document.querySelector('.toast-notification')
    try {
      assert.ok(u.classList.contains('toast-info'))
      assert.ok(!u.querySelector('b'), 'the message is text, never markup')
    } finally { u.remove() }
    assert.ok(toastIcon('warning').startsWith('<svg class="toast-icon"'))
  })

  it('every kind writes in the primary ink at 4.5:1, its icon in its status colour at 3:1, in both themes', async () => {
    const kinds = { success: '--success', info: '--info', warning: '--warning', error: '--danger' }
    for (const cls of ['', 'light-mode']) {
      const f = await frame(Object.keys(kinds).map(k =>
        `<div class="toast-notification toast-${k}" style="position:static">${toastIcon(k)}<span class="toast-msg">${k}</span></div>`).join(''), { bodyClass: cls })
      try {
        const d = f.contentDocument, w = f.contentWindow
        const page = rgb(w.getComputedStyle(d.body).backgroundColor)
        const text1 = tokenColor(w, d, 'var(--text-1)')
        d.querySelectorAll('.toast-notification').forEach(t => {
          const k = t.querySelector('.toast-msg').textContent
          const bg = over(rgb(w.getComputedStyle(t).backgroundColor), page)
          const ink = rgb(w.getComputedStyle(t).color)
          assert.deepEq(ink.slice(0, 3), text1.slice(0, 3), `${cls || 'dark'} ${k}: the primary ink, not a status colour`)
          assert.ok(ratio(ink, bg) >= 4.5, `${cls || 'dark'} ${k}: text ${ratio(ink, bg).toFixed(2)}:1`)
          const icon = rgb(w.getComputedStyle(t.querySelector('.toast-icon')).color)
          assert.deepEq(icon.slice(0, 3), tokenColor(w, d, `var(${kinds[k]})`).slice(0, 3), `${cls || 'dark'} ${k}: the icon in its status colour`)
          assert.ok(ratio(icon, bg) >= 3, `${cls || 'dark'} ${k}: icon ${ratio(icon, bg).toFixed(2)}:1`)
        })
      } finally { f.remove() }
    }
  })
})

// ── Filters ──────────────────────────────────────────────────

describe('consistency: every filter is the one picker', () => {
  it('no native select is left in Find blocks or the Attention tab', async () => {
    const doc = await page()
    assert.ok(!doc.querySelector('#searchOverlay select'), 'Find blocks')
    assert.ok(!doc.querySelector('#attentionPane select'), 'Attention')
    for (const id of ['searchType', 'searchStatus', 'searchScope', 'attentionFilter']) {
      assert.eq(doc.getElementById(id).tagName, 'BUTTON', `#${id} is a button`)
    }
  })

  it('a filter chip opens a menu of choices, and a pick sets the value, the label and the name', () => {
    const b = document.createElement('button')
    document.body.appendChild(b)
    const picks = []
    try {
      setupFilter(b, { name: 'Type', onChange: v => picks.push(v), options: () => [
        { value: '', label: 'All types' }, { value: 'risk', label: 'Risk', dot: '#888', dotShape: 'diamond' }, { value: 'goal', label: 'Goal' }] })
      assert.eq(b.getAttribute('aria-label'), 'Type: All types')
      assert.eq(b.getAttribute('aria-haspopup'), 'menu')
      assert.ok(b.querySelector('svg.insp-caret'), 'a caret')
      b.click()
      assert.ok(isMenuOpen(), 'a menu opens')
      const menu = document.querySelector('.pf-menu.filter-menu')
      const rows = [...menu.querySelectorAll('[role="menuitemradio"]')]
      assert.eq(rows.length, 3)
      assert.eq(rows[0].getAttribute('aria-checked'), 'true', 'the current choice is checked')
      assert.ok(rows[1].querySelector('.pf-menu-dot[data-shape="diamond"]'), 'a type keeps its dot shape')
      rows[1].click()
      assert.ok(!isMenuOpen())
      assert.eq(filterValue(b), 'risk')
      assert.deepEq(picks, ['risk'])
      assert.eq(b.textContent.trim(), 'Risk')
      assert.eq(b.getAttribute('aria-label'), 'Type: Risk')
      assert.ok(b.classList.contains('is-filtered'), 'a narrowed filter says so')
      assert.eq(document.activeElement, b, 'focus returns to the chip')
      setFilterValue(b, '')
      assert.eq(b.textContent.trim(), 'All types')
      assert.ok(!b.classList.contains('is-filtered'))
      assert.deepEq(picks, ['risk'], 'setting the value in code does not call onChange')
    } finally { closeMenus(); b.remove() }
  })

  it('the Attention filter narrows the list by category and shows each category with its count', () => {
    const host = document.createElement('div')
    host.innerHTML = '<span id="attentionCount" hidden></span><button type="button" id="attentionFilter" data-value=""></button>' +
      '<p id="attentionSummary"></p><ul id="attentionList"></ul>'
    document.body.appendChild(host)
    const full = (id, extra) => ({ id, type: 'goal', title: id, description: '', notes: '', x: 0, y: 0, actions: [], questions: [], docRef: null, ...extra })
    try {
      state.blocks = {
        g: full('g'), a: full('a', { type: 'assumption', title: 'Users pay' }),
        q: full('q', { questions: [{ text: 'Who reads it?' }] }),
      }
      state.arrows = []; state.groups = {}
      setupAttention()
      const list = document.getElementById('attentionList'), filter = document.getElementById('attentionFilter')
      const all = list.children.length
      assert.gt(all, 2)
      filter.click()
      const menu = document.querySelector('.pf-menu.filter-menu')
      const row = [...menu.querySelectorAll('.pf-menu-item')].find(r => r.querySelector('.pf-menu-label').textContent === 'Unanswered questions')
      assert.eq(row.querySelector('.pf-menu-shortcut').textContent, '1', 'its count')
      row.click()
      assert.eq(list.children.length, 1)
      assert.includes(list.textContent, 'Who reads it?')
      assert.eq(filter.getAttribute('aria-label'), 'Show: Unanswered questions')
    } finally { closeMenus(); host.remove(); state.blocks = {}; state.arrows = [] }
  })

  it('Find blocks waits for the first card, and stays while search is open', async () => {
    const html = '<div class="canvas-viewport" id="canvasViewport"><button class="canvas-search-toggle" id="searchBtn" aria-expanded="false">Find blocks</button>' +
      '<div class="canvas-root" id="canvasRoot"></div></div>'
    const f = await frame(html)
    try {
      const d = f.contentDocument, w = f.contentWindow
      const btn = d.getElementById('searchBtn')
      assert.eq(w.getComputedStyle(btn).display, 'none', 'an empty map: nothing to find')
      btn.setAttribute('aria-expanded', 'true')
      assert.neq(w.getComputedStyle(btn).display, 'none', 'open search keeps its button')
      btn.setAttribute('aria-expanded', 'false')
      const card = d.createElement('div'); card.className = 'block'; d.getElementById('canvasRoot').appendChild(card)
      assert.neq(w.getComputedStyle(btn).display, 'none', 'the first card brings it')
    } finally { f.remove() }
  })
})

// ── Facilitation ─────────────────────────────────────────────

describe('consistency: the Session timer lives under View, Facilitation', () => {
  const TIMER_IDS = ['timerWidget', 'timerToggleBtn', 'timerControls', 'timerStartBtn', 'timerPauseBtn', 'timerResetBtn']
  function mountTimer() {
    // Another suite may have left the page's timer mounted: step its ids
    // aside while this one is up (host.remove() below puts them back).
    const aside = TIMER_IDS.map(id => document.getElementById(id)).filter(Boolean)
    aside.forEach(el => { el.dataset.consistencyId = el.id; el.removeAttribute('id') })
    const host = document.createElement('div')
    host.innerHTML = '<div id="timerWidget" hidden><button id="timerToggleBtn">Session timer</button>' +
      '<div id="timerControls" style="display:none"><button id="timerStartBtn">Start</button>' +
      '<button id="timerPauseBtn" style="display:none">Pause</button><button id="timerResetBtn">Reset</button></div></div>'
    document.body.appendChild(host)
    const toggle = document.getElementById('timerToggleBtn'), controls = document.getElementById('timerControls')
    toggle.addEventListener('click', () => { controls.style.display = controls.style.display === 'flex' ? 'none' : 'flex' })
    document.getElementById('timerResetBtn').addEventListener('click', () => document.getElementById('timerWidget').classList.remove('active'))
    const remove = host.remove.bind(host)
    host.remove = () => { remove(); aside.forEach(el => { el.id = el.dataset.consistencyId; delete el.dataset.consistencyId }) }
    return host
  }
  function withTimerPref(fn) {
    const saved = localStorage.getItem('pathfinder-prefs')
    try { return fn() } finally {
      saved === null ? localStorage.removeItem('pathfinder-prefs') : localStorage.setItem('pathfinder-prefs', saved)
    }
  }

  it('View has one Facilitation entry; the timer and dot voting sit in it, and no row of their own', () => {
    ui.readOnly = false; ui.embed = false
    const items = viewMenuItems()
    const fac = items.find(i => i.label === 'Facilitation')
    assert.ok(fac && typeof fac.submenu === 'function')
    assert.ok(!items.some(i => i.label === 'Dot voting' || i.label === 'Session timer'), 'not at the top level')
    assert.deepEq(rowLabels(fac.submenu()), ['Session timer', 'Dot voting'])
    ui.readOnly = true
    try { assert.deepEq(rowLabels(facilitationItems()), ['Session timer'], 'a presenter can time a view-only session') }
    finally { ui.readOnly = false }
    ui.embed = true
    try { assert.ok(!viewMenuItems().some(i => i.label === 'Facilitation'), 'never in an embed') }
    finally { ui.embed = false }
  })

  it('the timer row is hidden until asked for, then shown open with focus on Start', () => withTimerPref(() => {
    const host = mountTimer()
    try {
      setPref('sessionTimer', false)
      applySessionTimer()
      assert.ok(document.getElementById('timerWidget').hidden, 'hidden by default')
      assert.eq(sessionTimerShown(), false)
      facilitationItems().find(i => i.label === 'Session timer').action()
      assert.ok(!document.getElementById('timerWidget').hidden, 'shown')
      assert.eq(document.getElementById('timerControls').style.display, 'flex', 'opened')
      assert.eq(document.activeElement.id, 'timerStartBtn', 'focus on Start')
      assert.eq(getPref('sessionTimer'), true, 'remembered for this browser')
      assert.eq(facilitationItems()[0].checked, true)
    } finally { host.remove() }
  }))

  it('hiding a running timer stops it, so nothing counts down out of sight', () => withTimerPref(() => {
    const host = mountTimer()
    try {
      setSessionTimer(true)
      document.getElementById('timerWidget').classList.add('active')
      assert.match(facilitationItems()[0].hint, /Hiding it stops it/)
      setSessionTimer(false)
      assert.ok(document.getElementById('timerWidget').hidden)
      assert.ok(!document.getElementById('timerWidget').classList.contains('active'), 'reset')
    } finally { host.remove() }
  }))

  it('the Facilitation row names what is on', () => withTimerPref(() => {
    const host = mountTimer()
    try {
      setPref('sessionTimer', false)
      assert.eq(viewMenuItems().find(i => i.label === 'Facilitation').hint, 'Session timer, dot voting')
      setVotingMode(true)
      setPref('sessionTimer', true)
      assert.eq(viewMenuItems().find(i => i.label === 'Facilitation').hint, 'Timer shown, dot voting on')
    } finally { setVotingMode(false); host.remove() }
  }))

  it('the page ships the row hidden, and the phone sheet does not bring it back', async () => {
    const doc = await page()
    assert.ok(doc.getElementById('timerWidget').hasAttribute('hidden'))
    const f = await frame('<aside id="rightPanel" class="right-panel collapsed" data-sheet="half"><div class="timer-widget" id="timerWidget" hidden>Session timer</div></aside>', { width: 390 })
    try { assert.eq(f.contentWindow.getComputedStyle(f.contentDocument.getElementById('timerWidget')).display, 'none') }
    finally { f.remove() }
  })
})

// ── Palette rail ─────────────────────────────────────────────

describe('consistency: the palette folds to its rail once a map has content', () => {
  const KEYS = ['pathfinder-palette-collapsed', 'pathfinder-pal-templatesSection']
  function withPalette(fn) {
    const saved = KEYS.map(k => [k, localStorage.getItem(k)])
    // Another suite may have left the page's palette mounted: step its ids
    // aside, so the app's lookups find this one, and put them back after.
    const aside = ['palette', 'paletteCollapseBtn', 'templatesSection'].map(id => document.getElementById(id)).filter(Boolean)
    aside.forEach(el => { el.dataset.consistencyId = el.id; el.removeAttribute('id') })
    const host = document.createElement('div')
    host.innerHTML = '<aside id="palette" class="palette"><button id="paletteCollapseBtn"></button>' +
      '<div class="palette-section" id="templatesSection"><button class="palette-section-toggle"></button><div class="palette-section-body"></div></div></aside>'
    document.body.appendChild(host)
    try { return fn(document.getElementById('palette')) } finally {
      host.remove(); state.blocks = {}
      aside.forEach(el => { el.id = el.dataset.consistencyId; delete el.dataset.consistencyId })
      saved.forEach(([k, v]) => v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v))
    }
  }
  const blockOf = id => ({ id, type: 'goal', title: id, x: 0, y: 0, actions: [], questions: [] })

  it('with no choice of its own, content arriving folds it; the button says what it does', () => withPalette(palette => {
    localStorage.removeItem('pathfinder-palette-collapsed')
    state.blocks = { a: blockOf('a') }
    collapseTemplatesAfterUse()
    if (window.matchMedia('(min-width: 1025px)').matches) {
      assert.ok(palette.classList.contains('collapsed'), 'the rail')
      assert.eq(document.getElementById('paletteCollapseBtn').getAttribute('aria-label'), 'Show palette')
      assert.eq(document.getElementById('paletteCollapseBtn').getAttribute('aria-expanded'), 'false')
    }
    assert.eq(localStorage.getItem('pathfinder-palette-collapsed'), null, 'nothing is recorded for the person')
  }))

  it('a choice the person made always wins', () => withPalette(palette => {
    localStorage.setItem('pathfinder-palette-collapsed', '0')
    state.blocks = { a: blockOf('a') }
    collapseTemplatesAfterUse()
    assert.ok(!palette.classList.contains('collapsed'), 'opened by hand stays open')
    setPaletteRail(true, { remember: true })
    assert.eq(localStorage.getItem('pathfinder-palette-collapsed'), '1')
    assert.ok(palette.classList.contains('collapsed'))
  }))
})

// ── Inspector as a property sheet ────────────────────────────

describe('consistency: the inspector is a property sheet with per-type placeholders', () => {
  it('placeholders are written per type, and an Output names an output, not a cart', () => {
    Object.keys(TYPES).forEach(t => {
      const ph = placeholdersFor(t)
      assert.ok(ph.title && ph.desc && ph.criteria, `${t} has placeholders`)
      // Review: the title's placeholder was the type's definition ("Untyped:
      // checks skip it"). It is an example name now, never the definition.
      assert.neq(ph.title, TYPES[t].short, `${t}: the title prompt names a card, it does not define the type`)
      if (t !== 'custom') assert.match(ph.title, /^e\.g\. /, `${t}: an example says it is one`)
      assert.ok(ph.title.length <= 40, `${t}: fits the field (${ph.title.length})`)
      for (const v of Object.values(ph)) assert.notIncludes(v, '…', `${t}: no ellipsis`)
    })
    assert.eq(placeholdersFor('custom').title, 'Name this block')
    assert.eq(new Set(Object.keys(TYPES).map(t => placeholdersFor(t).title)).size, Object.keys(TYPES).length, 'one per type')
    const out = placeholdersFor('output').criteria
    assert.notIncludes(out.toLowerCase(), 'cart')
    assert.match(out, /^e\.g\. /, 'an example says it is one')
    assert.neq(placeholdersFor('metric').criteria, placeholdersFor('requirement').criteria, 'targets differ from criteria')
    ;['goal', 'requirement', 'output', 'implementation', 'metric'].forEach(t =>
      assert.match(placeholdersFor(t).criteria, /^e\.g\. /, `${t}: led by e.g.`))
  })

  it('no placeholder in the inspector or Find blocks ends in an ellipsis, and Link fits its field', async () => {
    const doc = await page()
    const fields = [...doc.querySelectorAll('#inspectorPane [placeholder], #searchOverlay [placeholder]')]
    assert.ok(fields.length >= 8)
    fields.forEach(f => assert.ok(!/…\s*$/.test(f.placeholder), `#${f.id}: "${f.placeholder}"`))
    assert.ok(doc.getElementById('docRefHref').placeholder.length <= 20, 'the Link placeholder is short enough to show whole')
    const src = await (await fetch('../js/inspector.js')).text()
    assert.ok(!/placeholder[=:]\s*["'`][^"'`]*…["'`]/.test(src), 'inspector.js writes no ellipsis placeholder')
  })

  it('content is full width with its label above; a short value sits beside its 88px label', async () => {
    const doc = await page()
    const panel = doc.getElementById('inspectorPane').outerHTML
    for (const [width, sheet] of [[320, true], [280, false]]) {
      const f = await frame(`<aside class="right-panel" style="width:${width}px"><div class="panel-content">${panel}</div></aside>`, { width: 1200, height: 1600 })
      try {
        const d = f.contentDocument, w = f.contentWindow
        d.getElementById('inspectorEmpty').style.display = 'none'
        d.getElementById('inspectorContent').style.display = ''
        d.getElementById('criteriaSection').style.display = ''
        d.getElementById('rationaleSection').style.display = ''
        d.getElementById('docsDetails').open = true
        d.getElementById('appearanceDetails').open = true
        await new Promise(res => w.requestAnimationFrame(() => res()))
        const box = s => d.querySelector(s).getBoundingClientRect()
        const title = box('label[for="inspTitle"]'), titleField = box('#inspTitle')
        assert.ok(titleField.top > title.bottom - 1, `${width}px: the title's label is above it`)
        // Review: criteria were folded into a 180px column beside an 88px
        // label. Every multi-line field is content: label above, full width.
        for (const id of ['inspCriteria', 'inspRationale']) {
          const l = box(`label[for="${id}"]`), fld = box('#' + id)
          assert.ok(fld.top > l.bottom - 1, `${width}px: #${id}'s label is above it`)
          assert.ok(Math.abs(fld.width - titleField.width) < 2, `${width}px: #${id} is as wide as the title (${Math.round(fld.width)})`)
        }
        const link = box('label[for="docRefHref"]'), linkField = box('#docRefHref')
        const colour = box('#inspColourBtn'), card = box('#inspCardBtn')
        if (sheet) {
          assert.eq(Math.round(link.width), 88, 'an 88px label column')
          assert.ok(Math.abs(linkField.top - link.top) < 10 && linkField.left >= link.right + 11, 'a short value beside its label')
          assert.ok(card.top > colour.bottom - 1, 'Appearance: a row per property')
          assert.ok(Math.abs(card.left - linkField.left) < 2, 'on the same column as every other property')
        } else {
          assert.ok(linkField.top > link.bottom - 1, `${width}px: a narrow panel stacks`)
          assert.ok(Math.abs(card.top - colour.top) < 2, `${width}px: Appearance stays one row`)
        }
        const ph = w.getComputedStyle(d.getElementById('inspCriteria'), '::placeholder')
        assert.eq(ph.fontStyle, 'italic', 'placeholders are set in italic')
      } finally { f.remove() }
    }
  })
})

// ── Review fixes ─────────────────────────────────────────────

const LONG_TITLE = 'Checkout reliability plan for the quarter, with every team and every deadline'
const nextFrame = w => new Promise(res => w.requestAnimationFrame(() => res()))

describe('consistency: the header stays one row with the product name in view', () => {
  it('one row at every width from 701px, titled, untitled and view-only, and "Pathfinder" always shows', async () => {
    const doc = await page()
    const f = await frame(doc.querySelector('header.header-bar').outerHTML, { width: 1440, kit: true })
    try {
      const d = f.contentDocument, w = f.contentWindow
      const t = d.getElementById('canvasTitle'), bar = d.querySelector('.header-bar'), h1 = d.querySelector('.header-logo h1')
      for (const ro of [false, true]) {
        d.body.classList.toggle('readonly-mode', ro)
        // The page hides Maps and its readonly-only rows in script; do the same.
        d.getElementById('mapsWrapper').style.display = ro ? 'none' : ''
        for (const name of ['', 'Checkout reliability plan', LONG_TITLE]) {
          t.textContent = name || 'Untitled map'
          t.classList.toggle('is-untitled', !name)
          for (const width of [701, 720, 744, 768, 800, 820, 834, 860, 861, 900, 1024, 1100, 1101, 1180, 1280, 1440]) {
            f.style.width = width + 'px'
            await nextFrame(w)
            const at = `${ro ? 'view-only ' : ''}${width}px, ${name ? name.length + ' chars' : 'untitled'}`
            assert.ok(bar.getBoundingClientRect().height <= 57, `${at}: one row (${Math.round(bar.getBoundingClientRect().height)}px)`)
            assert.ok(d.documentElement.scrollWidth <= width, `${at}: no horizontal scroll`)
            const right = Math.max(...[...d.querySelectorAll('.header-actions > *, .header-home')]
              .filter(el => w.getComputedStyle(el).display !== 'none').map(el => el.getBoundingClientRect().right))
            assert.ok(right <= width - 16, `${at}: every control on screen (${Math.round(right)})`)
            assert.ok(t.getBoundingClientRect().right <= d.querySelector('.header-right').getBoundingClientRect().left, `${at}: the title ends before the controls`)
            // Review: the site hid the kit's h1 under 1100px. It never does now.
            assert.eq(w.getComputedStyle(h1).position, 'static', `${at}: the product name is not hidden`)
            assert.ok(h1.getBoundingClientRect().width > 60, `${at}: "Pathfinder" shows whole`)
            if (width >= 768 && !name) assert.ok(t.scrollWidth <= t.clientWidth + 1, `${at}: "Untitled map" whole from 768px`)
          }
        }
      }
    } finally { f.remove() }
  })

  it('renaming on a narrow tablet gives the field the room of Maps and Share, still on one row', async () => {
    const doc = await page()
    const f = await frame(doc.querySelector('header.header-bar').outerHTML, { width: 701, kit: true })
    try {
      const d = f.contentDocument, w = f.contentWindow
      const t = d.getElementById('canvasTitle'), bar = d.querySelector('.header-bar')
      t.textContent = LONG_TITLE; t.classList.remove('is-untitled'); t.contentEditable = 'true'
      for (const width of [701, 744, 768, 820, 860, 861, 1024]) {
        f.style.width = width + 'px'
        await nextFrame(w)
        assert.ok(bar.getBoundingClientRect().height <= 57, `${width}px: one row while renaming`)
        assert.ok(d.documentElement.scrollWidth <= width, `${width}px: no horizontal scroll while renaming`)
        assert.ok(t.getBoundingClientRect().width >= 140, `${width}px: a field you can type in (${Math.round(t.getBoundingClientRect().width)}px)`)
        assert.eq(w.getComputedStyle(d.getElementById('shareWrapper')).display === 'none', width <= 860, `${width}px: Share ${width <= 860 ? 'steps aside' : 'stays'}`)
      }
    } finally { f.remove() }
  })

  it('on a phone the name waits under 433px, and Rename gives it the room of Maps and Share', async () => {
    const doc = await page()
    for (const [width, shown] of [[375, false], [390, false], [430, false], [480, true], [600, true]]) {
      const f = await frame(doc.querySelector('header.header-bar').outerHTML, { width, kit: true })
      try {
        const d = f.contentDocument, w = f.contentWindow
        const actions = d.querySelector('.header-actions')
        const parked = d.createElement('div'); parked.hidden = true
        ;[...actions.children].filter(el => !el.hasAttribute('data-keep-mobile')).forEach(el => parked.appendChild(el))
        d.body.appendChild(parked)
        actions.insertAdjacentHTML('beforeend', '<div class="header-overflow"><button class="header-overflow-toggle" type="button">...</button></div>')
        const t = d.getElementById('canvasTitle')
        t.textContent = LONG_TITLE; t.classList.remove('is-untitled')
        await nextFrame(w)
        const h1 = d.querySelector('.header-logo h1')
        assert.ok(h1.getBoundingClientRect().width > 50, `${width}px: "Pathfinder" shows`)
        assert.eq(t.getClientRects().length > 0, shown, `${width}px: the title ${shown ? 'shows' : 'waits'}`)
        assert.ok(d.querySelector('.header-home').getBoundingClientRect().right <= width, `${width}px: home on screen`)
        assert.ok(d.documentElement.scrollWidth <= width, `${width}px: no horizontal scroll`)
        if (shown) assert.ok(t.getBoundingClientRect().right <= d.getElementById('shareWrapper').getBoundingClientRect().left, `${width}px: before Share`)
        // Renaming: Maps and Share step aside and the field has a usable width.
        t.contentEditable = 'true'
        await nextFrame(w)
        assert.eq(w.getComputedStyle(d.getElementById('shareWrapper')).display, 'none', `${width}px: Share steps aside`)
        assert.eq(w.getComputedStyle(d.getElementById('mapsWrapper')).display, 'none', `${width}px: Maps steps aside`)
        assert.ok(t.getBoundingClientRect().width >= 100, `${width}px: the field is ${Math.round(t.getBoundingClientRect().width)}px`)
        assert.ok(d.documentElement.scrollWidth <= width, `${width}px: still no horizontal scroll while renaming`)
      } finally { f.remove() }
    }
  })

  it('the consistency section adds no rule on the kit\'s logo markup (skin tokens only)', async () => {
    const css = await (await fetch('../css/style.css')).text()
    const at = css.indexOf('/* ════ [consistency] ════ */')
    assert.ok(at > 0)
    const own = css.slice(at).replace(/\/\*[\s\S]*?\*\//g, '')
    for (const sel of ['.header-title-wrap', '.header-title-link', '.header-logo h1', '.header-logo {', '.header-subtitle'])
      assert.notIncludes(own, sel, `no site rule on ${sel}`)
  })

  it('Maps offers Rename this map beside the other this-map actions, and it opens the title', () => {
    const original = $.canvasTitle()
    const el = document.createElement('div'); el.id = 'canvasTitle'
    original.replaceWith(el)
    const saved = { title: canvasMeta.title, ro: ui.readOnly }
    try {
      ui.readOnly = false; canvasMeta.title = 'Launch readiness'
      updateCanvasTitle(); setupCanvasTitle()
      const items = mapsMenuWithRename()
      const labels = items.map(i => i.label)
      const at = labels.indexOf('Rename this map')
      assert.ok(at > 0, 'listed')
      assert.eq(labels[at + 1], 'Duplicate this map', 'beside the other this-map actions')
      items[at].action()
      assert.eq(el.contentEditable, 'true', 'the title is open for a new name')
      assert.eq(document.activeElement, el)
      el.dispatchEvent(new FocusEvent('blur'))
      ui.readOnly = true
      assert.ok(!mapsMenuWithRename().some(i => i.label === 'Rename this map'), 'never on a view-only link')
    } finally {
      el.replaceWith(original)
      canvasMeta.title = saved.title; ui.readOnly = saved.ro
      setupCanvasTitle(); updateCanvasTitle()
    }
  })

  it('Enter and Escape leave focus on the title, not on the page', () => {
    const original = $.canvasTitle()
    const el = document.createElement('div'); el.id = 'canvasTitle'
    original.replaceWith(el)
    const saved = { title: canvasMeta.title, ro: ui.readOnly }
    try {
      ui.readOnly = false; canvasMeta.title = 'Plan'
      updateCanvasTitle(); setupCanvasTitle()
      const key = k => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
      el.focus()
      key('Enter'); el.textContent = 'Plan B'; key('Enter')
      assert.eq(canvasMeta.title, 'Plan B')
      assert.eq(el.contentEditable, 'false')
      assert.eq(document.activeElement, el, 'Enter commits and keeps focus on the title')
      assert.eq(el.getAttribute('role'), 'button', 'a button again')
      key('Enter'); el.textContent = 'Discarded'; key('Escape')
      assert.eq(canvasMeta.title, 'Plan B', 'Escape keeps the old name')
      assert.eq(document.activeElement, el, 'Escape keeps focus on the title too')
      assert.eq(el.scrollLeft, 0, 'the name shows from its start')
    } finally {
      el.replaceWith(original)
      canvasMeta.title = saved.title; ui.readOnly = saved.ro
      setupCanvasTitle(); updateCanvasTitle()
    }
  })

  it('Help lists GitHub whenever the bar\'s icon is not on screen', () => {
    const a = document.createElement('a')
    a.className = 'header-github'; a.href = 'https://github.com/example/pathfinder-site'
    a.style.display = 'none'
    document.body.appendChild(a)
    try {
      const row = () => helpMenuItems().find(i => i.label === 'Source on GitHub')
      assert.ok(row(), 'hidden icon: a Help row')
      a.style.display = 'inline-block'; a.textContent = 'GitHub'
      assert.ok(!row(), 'icon on screen: no second way in')
    } finally { a.remove() }
  })
})

describe('consistency: the ghost header is the app page\'s alone', () => {
  it('trace and the doc pages keep their boxed buttons and the kit\'s 40px row', async () => {
    for (const p of ['trace.html', 'tutorial.html']) {
      const d0 = new DOMParser().parseFromString(await (await fetch('../' + p)).text(), 'text/html')
      const head = d0.querySelector('header.header-bar')
      assert.ok(!head.hasAttribute('data-pf-bar'), `${p}: not the app's bar`)
      const f = await frame(head.outerHTML, { width: 1280, kit: true })
      try {
        const d = f.contentDocument, w = f.contentWindow
        const b = d.querySelector('.header-actions .header-btn')
        const cs = w.getComputedStyle(b)
        assert.ok((rgb(cs.borderTopColor)[3] ?? 1) > 0, `${p}: a boxed button keeps its edge`)
        assert.ok((rgb(cs.backgroundColor)[3] ?? 1) > 0, `${p}: and its fill`)
        assert.eq(w.getComputedStyle(d.querySelector('.header-bar')).getPropertyValue('--header-control-h').trim(), '40px', `${p}: the kit's row height`)
      } finally { f.remove() }
    }
  })

  it('on a phone the kit\'s menu toggle is a ghost beside the ghost Share, on the app page only', async () => {
    const doc = await page()
    const trace = new DOMParser().parseFromString(await (await fetch('../trace.html')).text(), 'text/html')
    for (const [html, ghost] of [[doc.querySelector('header.header-bar').outerHTML, true], [trace.querySelector('header.header-bar').outerHTML, false]]) {
      const f = await frame(html, { width: 390, kit: true })
      try {
        const d = f.contentDocument, w = f.contentWindow
        d.querySelector('.header-actions').insertAdjacentHTML('beforeend', '<div class="header-overflow"><button class="header-overflow-toggle" type="button">...</button></div>')
        await nextFrame(w)
        const edge = rgb(w.getComputedStyle(d.querySelector('.header-overflow-toggle')).borderTopColor)[3] ?? 1
        assert.eq(edge === 0, ghost, ghost ? 'app: no edge on the toggle' : 'trace: the kit\'s boxed toggle')
      } finally { f.remove() }
    }
  })
})

describe('consistency: review fixes elsewhere', () => {
  it('a filter at its first choice is not marked as narrowed, whatever that choice\'s value', () => {
    const b = document.createElement('button')
    document.body.appendChild(b)
    try {
      setupFilter(b, { name: 'Search in', options: () => [{ value: 'current', label: 'This map' }, { value: 'all', label: 'All saved maps' }] })
      setFilterValue(b, 'current')
      assert.ok(!b.classList.contains('is-filtered'), '"This map" is the default, not a narrowing')
      setFilterValue(b, 'all')
      assert.ok(b.classList.contains('is-filtered'), 'any other choice is marked')
    } finally { b.remove() }
  })

  it('the page ships Find blocks\' scope at its default, unmarked', async () => {
    const doc = await page()
    const scope = doc.getElementById('searchScope')
    assert.eq(scope.dataset.value, 'current')
    assert.ok(!scope.classList.contains('is-filtered'))
  })

  it('the Markdown export and the meeting summary write an action by the word the app shows', () => {
    const saved = { blocks: state.blocks, arrows: state.arrows, groups: state.groups }
    try {
      state.blocks = { a: { id: 'a', type: 'requirement', title: 'Weekly report reaches readers', description: '', notes: '', x: 0, y: 0,
        actions: ['recollect', 'reinforce'], questions: [], criteria: [], docRef: null } }
      state.arrows = []; state.groups = {}
      const md = buildMarkdown()
      assert.includes(md, '**Actions:** Look back, Strengthen')
      assert.notIncludes(md, 'recollect')
      const summary = buildMeetingSummary()
      assert.includes(summary, '**Weekly report reaches readers** (Look back)')
      assert.includes(summary, '(Strengthen)')
      assert.notIncludes(summary, '(recollect)')
    } finally { Object.assign(state, saved) }
  })

  it('the Planning help says the brief keeps the ids, so the two words are tied together', async () => {
    const doc = await page()
    const help = doc.querySelector('#planningDetails .insp-help').textContent
    assert.includes(help, 'Look back'); assert.includes(help, 'Strengthen')
    assert.includes(help, 'recollect'); assert.includes(help, 'reinforce')
  })

  it('menus, the phone panel lists, the timer, search and the inspector draw the one 16px icon set', async () => {
    // menu.js: a checked row and a submenu row.
    const anchor = document.createElement('button'); document.body.appendChild(anchor)
    try {
      openDropdown(anchor, [{ label: 'On', checked: true, action() {} }, { label: 'More', submenu: () => [{ label: 'x', action() {} }] }])
      for (const svg of document.querySelectorAll('.pf-menu .pf-menu-check svg, .pf-menu .pf-menu-caret svg')) {
        assert.eq(svg.getAttribute('viewBox'), '0 0 16 16')
        assert.eq(svg.getAttribute('stroke-width'), '1.5')
      }
      assert.ok(document.querySelector('.pf-menu .pf-menu-check svg'), 'a check was drawn')
    } finally { closeMenus(); anchor.remove() }
    for (const file of ['../js/view-menu.js', '../js/menu.js'])
      assert.notIncludes(await (await fetch(file)).text(), 'viewBox="0 0 24 24"', `${file}: no 24px-grid glyph`)
    const doc = await page()
    const svgs = [...doc.querySelectorAll('#inspectorContent svg, #inspectorMulti svg, #inspectorArrow svg, #timerToggleBtn svg, #searchBtn svg, #paletteCollapseBtn svg, #panelCollapseBtn svg, #panelReopenBtn svg, .sheet-chevron')]
    assert.ok(svgs.length >= 16)
    svgs.forEach(svg => {
      const where = svg.closest('[id]')?.id
      assert.eq(svg.getAttribute('viewBox'), '0 0 16 16', `${where}: the 16px grid`)
      assert.eq(svg.getAttribute('stroke-width'), '1.5', `${where}: 1.5px`)
      assert.ok(svg.getAttribute('fill') === 'none' && !svg.querySelector('[fill="currentColor"]'), `${where}: stroked, never filled`)
    })
  })

  it('the palette rail fits an 800px window with no scrollbar drawn beside its dots', async () => {
    const doc = await page()
    const palette = doc.getElementById('palette').outerHTML.replace('class="palette"', 'class="palette collapsed"')
    // The app's height: an 800px window less the 56px header and the footer.
    const f = await frame(`<div style="display:flex;height:695px">${palette}</div>`, { width: 1280, height: 800 })
    try {
      const d = f.contentDocument, w = f.contentWindow
      renderPaletteTypes(d.getElementById('blocksList'))
      d.getElementById('templatesSection').classList.add('collapsed')
      await nextFrame(w)
      const p = d.getElementById('palette')
      assert.ok(p.scrollHeight <= p.clientHeight + 1, `the rail fits (${p.scrollHeight} / ${p.clientHeight})`)
      assert.eq(w.getComputedStyle(p).scrollbarWidth, 'none', 'no track in the 48px column')
      const item = d.querySelector('.palette-item').getBoundingClientRect()
      assert.ok(item.height >= 24 && item.width >= 24, `each dot is still a 24px target (${Math.round(item.width)} x ${Math.round(item.height)})`)
    } finally { f.remove() }
  })

  it('CLAUDE.md names the places these controls moved to', async () => {
    const md = await (await fetch('../CLAUDE.md')).text()
    assert.includes(md, '`js/filter-menu.js`')
    assert.includes(md, 'Facilitation')
    assert.notIncludes(md, '(View ▾ → Dot voting)')
    assert.includes(md, 'Maps ▾ / <title>')
  })
})
