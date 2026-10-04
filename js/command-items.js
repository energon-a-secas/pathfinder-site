// ════════════════════════════════════════════════════════════
//  command-items.js: what the command palette can run, and how a
//  query finds it.
//
//  Every row comes from a builder the app already has: the header
//  menus (view-menu.js), the selection's right-click menu
//  (context-menu.js selectionMenuItems), the Maps menu (library.js),
//  the templates list and the type registry. A row runs exactly what
//  its menu twin runs, so the palette and the menus cannot drift.
//
//  matchScore(query, text)  { score, hits } or null. Titles and
//                           action names only; never hints
//  menuRows(items, opts)    palette rows from menu.js item shapes
//  commandGroups()          the groups, built when the palette opens
//  jumpToBlock(id)          select a block and bring it into view
// ════════════════════════════════════════════════════════════

import { state, selection, ui, view, toWorld, getUndoHistory, getRedoFuture } from './state.js'
import { $, TYPES, getBlockEl } from './utils.js'
import { fitView } from './canvas.js'
import { undo, redo, setSelection, selectBlock, renderInspector } from './render.js'
import { createBlockAt, createConnected, suggestedNextTypes } from './create.js'
import { typeDot, typeNoun, retypeBlocks } from './type-menu.js'
import { selectionMenuItems } from './context-menu.js'
import { fileMenuItems, shareMenuItems, tidyMenuItems, viewMenuItems, helpMenuItems, mapsMenuWithRename } from './view-menu.js'
import { TEMPLATES, listUserTemplates } from './templates.js'
import { openSearch, runTidy, TYPE_KEYS, PANEL_TABS, showPanelTab } from './ui-panels.js'
import { zoomIn, zoomOut, zoomTo, zoomToBlocks, zoomToSelection, hasSelectionTarget, animateView, FULL_DETAIL_ZOOM } from './zoom-controls.js'
import { readingOrder, describeBlock, announce, withCameraHeld } from './navigation.js'
import { openSampleMap, SAMPLE_TITLE } from './start-panel.js'

export const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')
export const MOD = IS_MAC ? '⌘' : 'Ctrl+'

// ── Matching ─────────────────────────────────────────────────
// Lower case with accents folded away ("decisión" finds "Decision"), keeping
// for every UTF-16 unit of the folded text the index of the character it came
// from, so the matched letters can be marked in the original label.
function fold(text) {
  let s = ''
  const map = []
  let i = 0
  for (const ch of String(text ?? '')) {
    const f = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    for (let k = 0; k < f.length; k++) map.push(i)
    s += f
    i += ch.length
  }
  return { s, map }
}

const WORDY = /[\p{L}\p{N}]/u
const wordStart = (s, j) => j === 0 || !WORDY.test(s[j - 1])
const span = (from, n) => Array.from({ length: n }, (_, k) => from + k)

// A subsequence alignment that rewards word starts and runs and charges for
// each gap, so "ct" finds "Change type" but three letters scattered across a
// long title do not count. Dynamic programming over (query letter, position).
function fuzzy(q, s) {
  const m = q.length, n = s.length
  if (!m || m > n) return null
  const NEG = -Infinity
  let prev = null
  const back = []
  for (let i = 0; i < m; i++) {
    const cur = new Array(n).fill(NEG), bk = new Array(n).fill(-1)
    let best = NEG, bestK = -1
    for (let j = 0; j < n; j++) {
      if (i > 0 && j >= 2 && prev[j - 2] > best) { best = prev[j - 2]; bestK = j - 2 }
      if (s[j] !== q[i]) continue
      const gain = 1 + (wordStart(s, j) ? 8 : 0)
      if (i === 0) { cur[j] = gain + (j === 0 ? 3 : 0); continue }
      let v = NEG, k = -1
      if (j >= 1 && prev[j - 1] > NEG) { v = prev[j - 1] + gain + 5; k = j - 1 }
      if (best > NEG && best + gain - 3 > v) { v = best + gain - 3; k = bestK }
      cur[j] = v; bk[j] = k
    }
    back.push(bk)
    prev = cur
  }
  let end = -1, top = NEG
  prev.forEach((v, j) => { if (v > top) { top = v; end = j } })
  if (end < 0) return null
  const hits = [end]
  for (let i = m - 1; i > 0; i--) hits.unshift(back[i][hits[0]])
  return { score: top, hits }
}

/**
 * How well `query` matches `text`, higher first, or null for no match. Tiers:
 * the start of the text (the whole text first), the start of a word (an
 * earlier word first), anywhere, every word of the query somewhere, then a
 * fuzzy subsequence of word starts and runs. Length never ranks: rows that
 * match equally well keep the order they were built in ("change type" lists
 * the types in step order, not shortest first). `hits` are the matched
 * character indices in the original text.
 */
export function matchScore(query, text) {
  const q = fold(query).s.trim().replace(/\s+/g, ' ')
  if (!q) return { score: 0, hits: [] }
  const { s, map } = fold(text)
  const hitsOf = idx => [...new Set(idx.filter(k => k >= 0 && k < map.length).map(k => map[k]))]
  const at = s.indexOf(q)
  if (at === 0) return { score: s.length === q.length ? 4500 : 4000, hits: hitsOf(span(0, q.length)) }
  if (at > 0) {
    for (let k = at; k >= 0; k = s.indexOf(q, k + 1)) {
      if (wordStart(s, k)) return { score: 3000 - Math.min(k, 500), hits: hitsOf(span(k, q.length)) }
    }
    return { score: 2000 - Math.min(at, 999), hits: hitsOf(span(at, q.length)) }
  }
  const words = q.split(' ')
  if (words.length > 1) {
    let total = 0
    const hits = []
    for (const w of words) {
      let k = s.indexOf(w), found = -1
      for (; k >= 0; k = s.indexOf(w, k + 1)) { if (wordStart(s, k)) { found = k; break } }
      if (found < 0) found = s.indexOf(w)
      if (found < 0) { total = -1; break }
      total += wordStart(s, found) ? 10 : 5
      hits.push(...span(found, w.length))
    }
    if (total >= 0) return { score: 1000 + Math.min(total * 10, 899), hits: hitsOf(hits) }
  }
  const compact = q.replace(/ /g, '')
  const f = fuzzy(compact, s.slice(0, 160))
  if (!f || f.score < compact.length * 3) return null
  // Scattered letters count only where a person would type them: from the
  // start of a word, and past a skip of more than one letter only onto the
  // start of another word ("ct" is Change type, "rsk" is Risk; "png" is not
  // Sprint Planning).
  const h = f.hits
  if (!wordStart(s, h[0])) return null
  for (let i = 1; i < h.length; i++) if (h[i] - h[i - 1] > 2 && !wordStart(s, h[i])) return null
  return { score: Math.min(f.score, 999), hits: hitsOf(f.hits) }
}

// The words people type for an action that is named otherwise: "export
// png" for Download image (PNG 2×), "rename" for the map's title. A row is
// also found by its label with a word swapped for one of these, scored a
// step under the label itself and with no letters to bold.
export const SYNONYMS = {
  download: ['export', 'save'],
  copy: ['export'],
  image: ['picture', 'png'],
  vector: ['svg'],
  rename: ['title', 'name'],
  delete: ['remove'],
  clear: ['erase', 'empty'],
}
export function aliasesOf(label) {
  const words = String(label || '').split(/\s+/)
  const out = []
  words.forEach((w, i) => {
    const alt = SYNONYMS[w.toLowerCase().replace(/[^a-z]/g, '')]
    if (alt) alt.forEach(a => out.push([...words.slice(0, i), a, ...words.slice(i + 1)].join(' ')))
  })
  return out
}

/** matchScore against the label, else against its synonyms (a step lower, nothing bold). */
export function rowMatch(query, label) {
  const m = matchScore(query, label)
  if (m) return m
  let best = null
  for (const alias of aliasesOf(label)) {
    const a = matchScore(query, alias)
    if (a && (!best || a.score - 1 > best.score)) best = { score: a.score - 1, hits: [] }
  }
  return best
}

// ── Icons: one stroked 16px line set ─────────────────────────
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
export const ICONS = {
  find:     svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  undo:     svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo:     svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  all:      svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  tidy:     svg('<rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="4" width="6" height="5" rx="1"/><rect x="9" y="15" width="6" height="5" rx="1"/><path d="M6 9v3h12V9M12 12v3"/>'),
  fit:      svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  zoomIn:   svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/>'),
  zoomOut:  svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5"/>'),
  actual:   svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
  map:      svg('<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z"/><path d="M9 4v14M15 6v14"/>'),
  template: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 9v11"/>'),
  palette:  svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10l3 2-3 2M12 14h5"/>'),
  copy:     svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
  panel:    svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'),
}

// ── Rows from menu.js items ──────────────────────────────────
/**
 * Palette rows from menu.js item shapes. Headings label the rows under
 * them, swatch rows become one row per swatch, a submenu becomes a row you
 * drill into, and the search box of a menu becomes the palette's own query
 * (its pickOnEmpty: false carries over as `noDefault` on the list).
 */
export function menuRows(items, { idPrefix = '', meta = '' } = {}) {
  const list = (typeof items === 'function' ? items() : items) || []
  const out = []
  let heading = null
  for (const it of list) {
    if (!it) continue
    const kind = it.type || 'item'
    if (kind === 'divider' || kind === 'custom') continue
    if (kind === 'search') {
      if (it.pickOnEmpty === false) out.noDefault = true
      if (it.placeholder) out.placeholder = it.placeholder
      continue
    }
    if (kind === 'heading') { heading = it.label || null; continue }
    if (kind === 'swatches') {
      for (const o of it.options || []) {
        out.push({ id: `${idPrefix}${it.label || 'swatch'}:${o.value}`, label: o.label || String(o.value),
          swatch: o.color || null, checked: !!o.active, radio: true, heading: it.label || heading, meta,
          run: () => it.onPick?.(o.value) })
      }
      continue
    }
    if (it.filterOnly) continue
    const key = it.ctx || it.rowId || it.label
    const sub = it.submenu
    out.push({
      id: idPrefix + key, label: it.label || '', hint: it.hint, icon: it.icon, dot: it.dot, dotShape: it.dotShape,
      shortcut: it.shortcut, checked: it.checked, radio: !!it.radio, danger: !!it.danger, disabled: !!it.disabled, heading, meta,
      run: sub ? null : it.action,
      children: sub ? () => menuRows(sub, { idPrefix: `${idPrefix}${key}/`, meta }) : null,
    })
  }
  return out
}

// ── Blocks ───────────────────────────────────────────────────
/**
 * Select a block and bring it into view. A card already whole on screen at
 * full detail stays where it is (the camera does not move); one off screen
 * at full detail is panned to at the same zoom; below full detail it comes
 * to 100%, as Find does. Every jump used to zoom to 100% and recentre, so a
 * run of jumps lost the connection just made off the edge.
 */
export function jumpToBlock(id) {
  if (!state.blocks[id]) return false
  const full = view.zoom >= FULL_DETAIL_ZOOM
  if (full && wholeInView(id)) selectBlock(id)
  else if (full) { panToBlock(id); selectBlock(id) }
  else zoomToBlocks([id])
  // The camera is already on its way; focusing the card must not pan it too.
  withCameraHeld(() => getBlockEl(id)?.focus({ preventScroll: true }))
  announce(describeBlock(id))
  return true
}

function wholeInView(id) {
  const vp = $.canvasViewport(), b = state.blocks[id], el = getBlockEl(id)
  const W = vp?.clientWidth || 0, H = vp?.clientHeight || 0
  if (!b || !(W > 0) || !(H > 0)) return false
  const w = el?.offsetWidth || b.width || 220, h = el?.offsetHeight || 100
  const x1 = b.x * view.zoom + view.panX, y1 = b.y * view.zoom + view.panY
  return x1 >= 0 && y1 >= 0 && x1 + w * view.zoom <= W && y1 + h * view.zoom <= H
}

function panToBlock(id) {
  const vp = $.canvasViewport(), b = state.blocks[id], el = getBlockEl(id)
  const W = vp?.clientWidth || 0, H = vp?.clientHeight || 0
  if (!b || !(W > 0) || !(H > 0)) return
  const w = el?.offsetWidth || b.width || 220, h = el?.offsetHeight || 100
  animateView(W / 2 - (b.x + w / 2) * view.zoom, H / 2 - (b.y + h / 2) * view.zoom, view.zoom)
}

const titleOf = b => (b?.title || '').trim() || 'Untitled'
const typeIds = () => Object.keys(TYPES)

function blockRows() {
  return readingOrder().filter(id => state.blocks[id]).map(id => {
    const b = state.blocks[id]
    return { id: 'block:' + id, label: titleOf(b), dot: typeDot(b.type), dotShape: TYPES[b.type]?.shape,
      meta: TYPES[b.type]?.label || '', run: () => jumpToBlock(id) }
  })
}

// ── Create ───────────────────────────────────────────────────
/** World point at the centre of the visible canvas. */
export function centreWorld() {
  const r = $.canvasViewport()?.getBoundingClientRect()
  if (!r || !(r.width && r.height)) return { x: (-view.panX + 400) / view.zoom, y: (-view.panY + 300) / view.zoom }
  return toWorld(r.width / 2, r.height / 2)
}

/** A block of type `t` centred in view, in title editing. One undo step. */
export function createAtCentre(t) {
  const w = centreWorld()
  return withCameraHeld(() => createBlockAt(t, w.x, w.y))
}

const keyLabel = t => TYPE_KEYS[t] ? `N ${TYPE_KEYS[t].toUpperCase()}` : undefined

function createRows() {
  const rows = []
  const sel = selection.ids.size === 1 && state.blocks[selection.blockId] ? selection.blockId : null
  if (sel) {
    const src = state.blocks[sel]
    const suggested = suggestedNextTypes(src.type)
    ;[...suggested, ...typeIds().filter(t => !suggested.includes(t))].forEach(t => rows.push({
      id: 'new-connected:' + t, label: `New ${typeNoun(t)} connected to ${titleOf(src)}`,
      dot: typeDot(t), dotShape: TYPES[t].shape, heading: `Connected to ${titleOf(src)}`,
      suggested: suggested.includes(t), run: () => createConnected(sel, t, { incoming: 'auto' }),
    }))
  }
  typeIds().forEach(t => rows.push({
    id: 'new:' + t, label: `New ${typeNoun(t)} at centre`, dot: typeDot(t), dotShape: TYPES[t].shape,
    shortcut: keyLabel(t), heading: 'At the centre of the canvas', core: TYPES[t].tier === 'core',
    run: () => createAtCentre(t),
  }))
  return rows
}

// With nothing typed, Create shows a handful: what usually follows the
// selected block, then the core types at the centre.
function createPreview(rows) {
  return [...rows.filter(r => r.suggested).slice(0, 3), ...rows.filter(r => r.core)].slice(0, 6)
}

// ── Maps and templates ───────────────────────────────────────
function mapGroups() {
  // The header's Maps menu, Rename this map included.
  const items = mapsMenuWithRename()
  // Keyed by the map's id: every new map is "Untitled map", and Recent must
  // not send two of them to the same one.
  const maps = items.filter(it => it && !it.type && it.radio).map(it => ({
    id: 'map:' + (it.rowId || it.label), label: it.label, hint: it.hint, icon: ICONS.map,
    meta: it.checked ? 'Open now' : '', run: it.action,
  }))
  const actions = menuRows(items.filter(it => it && !it.radio && it.type !== 'heading'), { idPrefix: 'maps:', meta: 'Maps' })
  return { maps, actions }
}

function clickTemplate(selector) {
  const btn = $.templatesList()?.querySelector(`.template-item${selector}`)
  if (btn) btn.click()
}

// A template adds a dozen blocks (and Tidies a large one): never a Recent
// row, so an Enter on a fresh palette cannot apply it a second time.
function templateRows() {
  const rows = TEMPLATES.map((tpl, i) => ({
    id: 'tpl:' + tpl.name, label: tpl.name, hint: tpl.desc, icon: ICONS.template, noRecent: true,
    meta: tpl.large ? `${tpl.blocks.length} blocks` : '', run: () => clickTemplate(`[data-tpl="${i}"]`),
  }))
  listUserTemplates().forEach(tpl => rows.push({
    id: 'utpl:' + tpl.id, label: tpl.name, hint: tpl.desc, icon: ICONS.template, meta: 'Saved', noRecent: true,
    run: () => clickTemplate(`[data-utpl="${CSS.escape(tpl.id)}"]`),
  }))
  return rows
}

// ── Actions ──────────────────────────────────────────────────
function actionRows(mapActions) {
  const ro = ui.readOnly
  const n = Object.keys(state.blocks).length
  const rows = [
    { id: 'cmd:find', label: 'Find blocks', icon: ICONS.find, shortcut: MOD + 'F', meta: 'Canvas', run: () => openSearch() },
  ]
  if (!ro) rows.push(
    { id: 'cmd:undo', label: 'Undo', icon: ICONS.undo, shortcut: MOD + 'Z', meta: 'Edit', disabled: !getUndoHistory().length, run: () => undo() },
    { id: 'cmd:redo', label: 'Redo', icon: ICONS.redo, shortcut: IS_MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z', meta: 'Edit', disabled: !getRedoFuture().length, run: () => redo() },
  )
  rows.push({ id: 'cmd:select-all', label: 'Select all blocks', icon: ICONS.all, shortcut: MOD + 'A', meta: 'Canvas',
    disabled: !n, run: () => { const ids = Object.keys(state.blocks); setSelection(ids); announce(`${ids.length} ${ids.length === 1 ? 'block' : 'blocks'} selected`) } })
  if (!ro) {
    rows.push({ id: 'cmd:tidy', label: 'Tidy the map', icon: ICONS.tidy, shortcut: 'L', meta: 'Tidy',
      disabled: n < 2, hint: n < 2 ? 'Add at least two blocks first' : undefined, run: () => runTidy() })
    rows.push(...menuRows(tidyMenuItems(), { idPrefix: 'tidy:', meta: 'Tidy' }))
  }
  rows.push(
    { id: 'cmd:fit', label: 'Fit all blocks', icon: ICONS.fit, shortcut: 'Shift+1', meta: 'Zoom', run: () => fitView() },
    hasSelectionTarget() && { id: 'cmd:zoom-selection', label: 'Zoom to selection', icon: ICONS.zoomIn, shortcut: 'Shift+2', meta: 'Zoom', run: () => zoomToSelection() },
    { id: 'cmd:zoom-100', label: 'Zoom to 100%', icon: ICONS.actual, shortcut: 'Shift+0', meta: 'Zoom', run: () => zoomTo(1) },
    { id: 'cmd:zoom-in', label: 'Zoom in', icon: ICONS.zoomIn, shortcut: '=', meta: 'Zoom', run: () => zoomIn() },
    { id: 'cmd:zoom-out', label: 'Zoom out', icon: ICONS.zoomOut, shortcut: '-', meta: 'Zoom', run: () => zoomOut() },
  )
  // The right panel's tabs, so the keyboard reaches the Brief and Attention
  // without walking every card (Alt+1, 2, 3).
  if (!ui.embed) {
    rows.push(...PANEL_TABS.map(t => ({ id: 'panel:' + t.tab, label: t.label, icon: ICONS.panel,
      shortcut: (IS_MAC ? '⌥' : 'Alt+') + t.key, meta: 'Panel', run: () => showPanelTab(t.tab) })))
  }
  rows.push(...menuRows(fileMenuItems(), { idPrefix: 'file:', meta: 'File' }))
  // The Brief tab owns Copy (js/brief.js, loaded by app.js alone): ask it.
  if (!ui.embed && [...selection.ids].some(id => state.blocks[id])) {
    rows.push({ id: 'cmd:copy-brief-selection', label: 'Copy brief for the selection', icon: ICONS.copy, meta: 'Brief',
      hint: 'The selected blocks and the blocks connected to them', noRecent: true,
      run: () => window.dispatchEvent(new CustomEvent('pf:copy-brief', { detail: { scope: 'selection' } })) })
  }
  if (!ro) rows.push(...menuRows(shareMenuItems(), { idPrefix: 'share:', meta: 'Share' }))
  rows.push(...mapActions)
  if (!ro && !ui.embed) {
    rows.push({ id: 'cmd:sample', label: 'Open the sample map', hint: `${SAMPLE_TITLE}, as a map of its own`, icon: ICONS.map,
      meta: 'Maps', noRecent: true, run: () => openSampleMap() })
  }
  rows.push(...menuRows(viewMenuItems(), { idPrefix: 'view:', meta: 'View' }))
  // The Help menu's own row for the palette is the one place it is not.
  rows.push(...menuRows(helpMenuItems(), { idPrefix: 'help:', meta: 'Help' }).filter(r => r.id !== 'help:' + PALETTE_ROW_ID))
  return rows.filter(Boolean)
}

/** The rowId of the Help menu's "Command palette" row (command-palette.js). */
export const PALETTE_ROW_ID = 'command-palette'

// With nothing typed, Actions shows these few, in this order (those that can
// run now); the other forty wait for a search.
const ACTION_PREVIEW = ['cmd:find', 'file:exportCopyPrompt', 'cmd:tidy', 'cmd:fit', 'share:shareCopyLink', 'cmd:undo']
function actionPreview(rows) {
  return ACTION_PREVIEW.map(id => rows.find(r => r.id === id)).filter(r => r && !r.disabled && !r.searchOnly)
}

// ── The groups ───────────────────────────────────────────────
function selectionLabel(sel) {
  return sel.kind === 'connection' ? 'Selected connection' : `Selected: ${sel.title}`
}

// "Change type to risk" for the selected blocks: retyping by name in one
// step, where Change type takes a drill and a pick. Found by a search only;
// the unfiltered list keeps the menu's own rows. One undo step, through the
// one retype rule (type-menu.js).
function retypeRows() {
  const ids = [...selection.ids].filter(id => state.blocks[id])
  if (!ids.length) return []
  const types = new Set(ids.map(id => state.blocks[id].type))
  const word = t => t === 'custom' ? 'other' : TYPES[t].label.toLowerCase()
  return typeIds().filter(t => !(types.size === 1 && types.has(t))).map(t => ({
    id: 'retype:' + t, label: `Change type to ${word(t)}`, dot: typeDot(t), dotShape: TYPES[t].shape,
    searchOnly: true, run: () => { if (retypeBlocks(ids, t)) renderInspector() },
  }))
}

/**
 * Every group the palette can show, built from live state when it opens:
 * [{ key, label, items, preview?, cap? }]. `preview` (or the first `cap`
 * items) is what shows with nothing typed, followed by "N more: keep
 * typing"; a query searches all of them.
 * A view-only link gets what works there: view actions, the selection's
 * read-only rows, and jumping to blocks.
 */
export function commandGroups() {
  const ro = ui.readOnly
  const groups = []
  const sel = selectionMenuItems()
  if (sel) {
    const items = menuRows(sel.items, { idPrefix: 'sel:' })
    if (!ro && sel.kind !== 'connection') items.push(...retypeRows())
    // The context menu's first eight (editing and connecting before Delete);
    // the rest are a word away.
    groups.push({ key: 'selection', label: selectionLabel(sel), items, cap: 8 })
  }
  const { maps, actions } = ro || ui.embed ? { maps: [], actions: [] } : mapGroups()
  const acts = actionRows(actions)
  groups.push({ key: 'actions', label: 'Actions', items: acts, preview: actionPreview(acts) })
  groups.push({ key: 'blocks', label: 'Blocks', items: blockRows(), cap: 8 })
  if (!ro) {
    const create = createRows()
    groups.push({ key: 'create', label: 'Create', items: create, preview: createPreview(create) })
  }
  if (maps.length) groups.push({ key: 'maps', label: 'Maps', items: maps, cap: 6 })
  if (!ro) groups.push({ key: 'templates', label: 'Templates', items: templateRows(), cap: 5 })
  return groups
}
