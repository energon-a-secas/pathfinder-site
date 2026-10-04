// ════════════════════════════════════════════════════════════
//  start-panel.js: the first-run start panel, shown on an empty
//  map (the #brainDump markup in index.html; canvas.js updateHint
//  shows and hides it, so it goes the moment a first block exists).
//
//  Three keyed ways in: paste notes (1), start from a template (2),
//  open the sample map as a map of its own (3). Under them, a row
//  of first-block pills (#startFirstBlocks), and a line on where the
//  map is kept. The text-to-blocks work itself is classify.js
//  createBlocksFromText, and a pill adds its block through palette.js
//  addTypeAtCenter; this module only wires them.
// ════════════════════════════════════════════════════════════

import { state, ui } from './state.js'
import { $, TYPES, showToast, escHtml } from './utils.js'
import * as classify from './classify.js'
import * as zoom from './zoom-controls.js'
import { TEMPLATES } from './templates.js'
import { EXAMPLE_CANVAS } from './example-canvas.js'
import { normalizeCanvas } from './normalize.js'
import { detectGaps } from './gaps.js'
import { openDropdown, isMenuOpen } from './menu.js'
import { openAsNewMap } from './library.js'
import { addTypeAtCenter } from './palette.js'
import { openShortcuts } from './ui-panels.js'
import { modalDialogOpen } from './navigation.js'

export const SAMPLE_TITLE = 'Sample: Checkout 500s'

// ── The sample map ───────────────────────────────────────────

/**
 * The walkthrough's finished bug investigation as a canvas payload, named
 * for the Maps menu. A deep copy: the map that opens is the person's to
 * edit, and editing it must never reach the shared example object.
 */
export function samplePayload() {
  const copy = JSON.parse(JSON.stringify(EXAMPLE_CANVAS))
  return {
    blocks: Object.fromEntries(copy.blocks.map(b => [b.id, b])),
    arrows: copy.arrows,
    groups: {},
    meta: { ...copy.meta, title: SAMPLE_TITLE },
  }
}

/**
 * "12 blocks" (and its open gaps, when it has any): counted from the
 * example, so the line on the panel cannot drift from the map it opens.
 */
export function sampleSummary(payload = samplePayload()) {
  const clean = normalizeCanvas(payload)
  const n = Object.keys(clean.blocks).length
  const gaps = detectGaps(clean.blocks, clean.arrows).count || 0
  return `${n} blocks` + (gaps === 1 ? ', one open gap' : gaps > 1 ? `, ${gaps} open gaps` : '')
}

/**
 * Open the sample as a map of its own, so the person's own map stays as it
 * was (empty, on a first visit). Returns openAsNewMap's result, or false.
 */
export function openSampleMap() {
  if (ui.readOnly || ui.embed) return false
  const r = openAsNewMap(samplePayload())
  if (!r) return false
  announceArrival(SAMPLE_ARRIVAL)
  return r
}

/** What the sample's arrival says: it opened, and the person's own map is kept. */
export const SAMPLE_ARRIVAL = `${SAMPLE_TITLE} opened. Your own map is under Maps.`

/**
 * Land on the map that just loaded and say `lead`. The camera belongs to
 * zoom-controls.js: arriveAfterLoad runs arriveAt after the frame the load
 * scheduled its fit in, so the view lands once, at a readable zoom on the
 * entry layer, and the toast is `lead` plus "Shift+1 shows all of it." when
 * part of the map is off screen. Opening as a new map is not one of the
 * camera's own arrival paths, so this is the only arrival it gets. `api` is
 * the zoom module (a test passes its own).
 */
export function announceArrival(lead, api = zoom) {
  Promise.resolve(api.arriveAfterLoad(null, { lead })).catch(err => console.error(err))
}

// ── Templates ────────────────────────────────────────────────

const sentenceCase = s => {
  const t = String(s || '').trim()
  return t ? t.charAt(0) + t.slice(1).toLowerCase() : t
}

/**
 * Apply a built-in template through the palette's own row, so the start
 * panel takes exactly the path a palette click takes: one undo step, the
 * Situation set on an empty map, Tidy for the large ones, the arrival.
 * Returns false when the row is not there to click.
 */
export function applyTemplateFromPalette(tpl) {
  const i = TEMPLATES.indexOf(tpl)
  const row = i >= 0 ? $.templatesList()?.querySelector(`[data-tpl="${i}"]`) : null
  if (!row) { showToast('Templates are in the palette on the left', 'info', 2600); return false }
  row.click()
  return true
}

/**
 * The template menu: the four worked maps, by the job they do, then the
 * smaller starters one level down.
 */
export function templateMenuItems(onPick = applyTemplateFromPalette) {
  const item = tpl => ({
    label: sentenceCase(tpl.name),
    hint: `${tpl.desc}. ${tpl.blocks.length} blocks`,
    action: () => { onPick(tpl); focusCanvas() },
  })
  const large = TEMPLATES.filter(t => t.large)
  const small = TEMPLATES.filter(t => !t.large)
  const items = [{ type: 'heading', label: 'Worked maps' }, ...large.map(item)]
  if (small.length) {
    items.push({ type: 'divider' }, { label: 'Smaller starters', submenu: small.map(item) })
  }
  return items
}

// ── The prefix helper ────────────────────────────────────────
//
// classify.js decides what a prefix means; this only says so. The helper is
// written from its prefix table (PREFIXES, each entry's `show` words), so
// the words on the panel are the words the classifier reads, and from
// CRITERIA_FROM_BULLETS (the types whose "- " lines become criteria) for the
// indent sentence. The test suite runs every shown word through
// categorizeLine.

/** The word shown for each type, first in this order. */
export const PREFIX_WORDS = {
  goal: 'Goal', problem: 'Problem', stakeholder: 'Who', metric: 'Metric',
  requirement: 'Req', implementation: 'Build', risk: 'Risk', assumption: 'Assume',
  decision: 'Decision', output: 'Output', process: 'Step', terminator: 'Trigger',
  resource: 'Resource', context: 'Context', question: 'Question',
}
/** The types the helper line names; the rest sit under "More prefixes". */
export const PRIMARY_PREFIX_TYPES = ['goal', 'problem', 'stakeholder', 'metric', 'requirement', 'implementation', 'risk', 'assumption']

const cleanWord = w => String(w || '').replace(/[:.\s]+$/, '').trim()

/** classify.js's prefix table as Map(type -> [the words it shows]), or null. */
export function prefixTable(raw) {
  const table = new Map()
  ;(Array.isArray(raw) ? raw : []).forEach(e => {
    if (!e || !Object.hasOwn(TYPES, e.type) || !Array.isArray(e.show)) return
    const list = e.show.map(cleanWord).filter(w => /^[a-z][a-z ]*$/i.test(w))
    if (list.length) table.set(e.type, [...(table.get(e.type) || []), ...list])
  })
  return table.size ? table : null
}

/** One word per type: ours when the table has it, else the table's first. */
export function prefixWords(raw = classify.PREFIXES) {
  const table = prefixTable(raw)
  const out = {}
  Object.keys(PREFIX_WORDS).forEach(type => {
    if (!table) { out[type] = PREFIX_WORDS[type]; return }
    const words = table.get(type)
    if (!words) return
    const ours = words.find(w => w.toLowerCase() === PREFIX_WORDS[type].toLowerCase())
    const w = ours || words[0]
    out[type] = w.charAt(0).toUpperCase() + w.slice(1)
  })
  return out
}

const code = w => `<code>${escHtml(w)}:</code>`
const list = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`

/**
 * What indented lines do, as the notes field will do it: folded into the
 * line above (and, where the classifier makes them criteria, said so), or,
 * with folding off, each its own block. Markup (it carries <code>).
 */
export function indentSentence(nest = true, words = prefixWords(), criteria = classify.CRITERIA_FROM_BULLETS) {
  if (!nest) return 'Every line becomes a block of its own, indented or not.'
  const types = criteria ? [...criteria].filter(t => words[t]) : []
  return 'Indented lines add detail to the line above' + (types.length
    ? `; under a ${list(types.map(t => code(words[t])))} line, <code>-</code> lines become its criteria.`
    : '.')
}

/**
 * A prefix under "More prefixes", with its type named only when the word
 * does not already say it ("Step: Process", but never "Decision: Decision").
 */
function morePrefix(type, word) {
  const label = TYPES[type].label
  const says = label.toLowerCase().includes(word.toLowerCase())
  return `<span>${code(word)}${says ? '' : ` ${escHtml(label)}`}</span>`
}

/** The helper's markup: the line, then every other prefix on demand. */
export function prefixHelpHtml(words = prefixWords(), { nest = true, criteria = classify.CRITERIA_FROM_BULLETS } = {}) {
  const primary = PRIMARY_PREFIX_TYPES.filter(t => words[t]).map(t => code(words[t]))
  const rest = Object.keys(words).filter(t => !PRIMARY_PREFIX_TYPES.includes(t))
  return `<p id="startPrefixLine">Start a line with ${list(primary)} to set its type, and end a question with <code>?</code>. ` +
    `<span id="startIndentLine">${indentSentence(nest, words, criteria)}</span></p>` +
    (rest.length
      ? `<details class="start-prefixes"><summary>More prefixes</summary><span class="start-prefix-list">` +
        rest.map(t => morePrefix(t, words[t])).join('') +
        `</span></details>`
      : '')
}

// ── First-block pills ────────────────────────────────────────

/** The types an empty map offers as a first block, in this order. */
export const FIRST_BLOCK_TYPES = ['goal', 'problem', 'stakeholder', 'metric', 'requirement', 'risk', 'question']

/**
 * One pill per type: its dot (colour and shape, both from the registry)
 * and its name, which is the button's whole accessible name. index.html
 * carries this markup so the row is there on first paint; the test suite
 * holds the two equal.
 */
export function firstBlockPillsHtml(types = FIRST_BLOCK_TYPES) {
  return types.filter(t => Object.hasOwn(TYPES, t)).map(t =>
    `<button type="button" class="start-pill" data-type="${t}" title="${escHtml(TYPES[t].short)}">` +
    `<span class="palette-dot" data-shape="${TYPES[t].shape || 'dot'}" style="background:var(--c-${t})" aria-hidden="true"></span>` +
    `${escHtml(TYPES[t].label)}</button>`).join('')
}

// ── Wiring ───────────────────────────────────────────────────

/** Whether the start panel is on screen (an empty map that can be edited). */
export function startPanelVisible() {
  const el = document.getElementById('brainDump')
  return !!el && el.style.display !== 'none' && !ui.readOnly && !ui.embed && Object.keys(state.blocks).length === 0
}

const isApple = () => /Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '')

function focusCanvas() {
  $.canvasViewport()?.focus({ preventScroll: true })
}

function setNotesOpen(open, { focus = true } = {}) {
  const btn = document.getElementById('startNotesBtn')
  const region = document.getElementById('startNotes')
  if (!btn || !region) return
  btn.setAttribute('aria-expanded', open ? 'true' : 'false')
  region.hidden = !open
  btn.closest('.start-option')?.classList.toggle('is-open', open)
  if (!focus) return
  if (open) document.getElementById('brainDumpInput')?.focus()
  else btn.focus()
}

function openTemplateMenu() {
  const btn = document.getElementById('startTemplateBtn')
  if (btn) openDropdown(btn, templateMenuItems(), { label: 'Templates', className: 'start-template-menu' })
}

/** A panel tab's visible name, without its count or screen-reader extras. */
export function tabName(tab) {
  if (!tab) return ''
  const c = tab.cloneNode(true)
  c.querySelectorAll('.tab-count, .sr-only, [aria-hidden="true"]').forEach(n => n.remove())
  return c.textContent.replace(/\s+/g, ' ').trim()
}

// The right panel's empty state names the other tabs by their live labels,
// and each name opens its tab. Its sentences hold for any label ("Prompt is
// what you hand to an agent", "Brief is ..."), and the names follow the tabs:
// a rename after setup, or a count arriving, re-reads them.
export function syncInspectorEmptyNames(box = document.getElementById('inspectorEmpty')) {
  if (!box) return
  box.querySelectorAll('[data-goto-tab]').forEach(btn => {
    const name = tabName(document.querySelector(`.panel-tab[data-tab="${btn.dataset.gotoTab}"]`))
    if (name && btn.textContent !== name) btn.textContent = name
  })
}

const watchedTabLists = new WeakSet()
function setupInspectorEmpty() {
  const box = document.getElementById('inspectorEmpty')
  if (!box) return
  syncInspectorEmptyNames(box)
  box.querySelectorAll('[data-goto-tab]').forEach(btn => {
    if (btn.dataset.wired) return
    btn.dataset.wired = '1'
    btn.addEventListener('click', () => {
      const t = document.querySelector(`.panel-tab[data-tab="${btn.dataset.gotoTab}"]`)
      if (t) { t.click(); t.focus() }
    })
  })
  const tabs = document.querySelector('.panel-tablist') || document.querySelector('.panel-tab')?.parentElement
  if (tabs && !watchedTabLists.has(tabs) && typeof MutationObserver === 'function') {
    watchedTabLists.add(tabs)
    new MutationObserver(() => syncInspectorEmptyNames()).observe(tabs, { childList: true, characterData: true, subtree: true })
  }
}

// Setup can run again (a test, a re-render): each panel is wired once, and
// the keys once for the page.
const wiredPanels = new WeakSet()
let keysWired = false

export function setupStartPanel() {
  setupInspectorEmpty()
  const panel = document.getElementById('startPanel')
  if (!panel) return
  const $in = id => panel.querySelector('#' + id)

  const help = $in('startPrefixHelp')
  const nest = $in('brainDumpNest')
  if (help) help.innerHTML = prefixHelpHtml(prefixWords(), { nest: nest ? nest.checked : true })
  const sampleDesc = $in('startSampleDesc')
  if (sampleDesc) sampleDesc.textContent = `A finished bug investigation (${sampleSummary()}) and the brief it produces`
  const submit = $in('startSubmitHint')
  if (submit && isApple()) submit.innerHTML = '<kbd>⌘</kbd> + <kbd>Enter</kbd>'

  if (!wiredPanels.has(panel)) {
    wiredPanels.add(panel)
    const input = $in('brainDumpInput')
    const run = () => {
      const text = input.value.trim()
      if (!text) { input.focus(); return }
      classify.createBlocksFromText(text, nest ? nest.checked : true)
      input.value = ''
      setNotesOpen(false, { focus: false })
      focusCanvas()
    }
    $in('startNotesBtn')?.addEventListener('click', e => {
      setNotesOpen(e.currentTarget.getAttribute('aria-expanded') !== 'true')
    })
    $in('brainDumpBtn')?.addEventListener('click', run)
    input?.addEventListener('keydown', e => {
      // Typing here never reaches the canvas shortcuts.
      e.stopPropagation()
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run() }
      else if (e.key === 'Escape') { e.preventDefault(); setNotesOpen(false) }
    })
    // Escape anywhere in the open notes (the checkbox, More prefixes, the
    // button) folds them back onto their option, as it does in the field.
    $in('startNotes')?.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault(); e.stopPropagation()
      setNotesOpen(false)
    })
    // The indent sentence says what the checkbox will do.
    nest?.addEventListener('change', () => {
      const line = panel.querySelector('#startIndentLine')
      if (line) line.innerHTML = indentSentence(nest.checked)
    })
    $in('startTemplateBtn')?.addEventListener('click', openTemplateMenu)
    $in('startFirstBlocks')?.addEventListener('click', e => {
      const pill = e.target.closest('.start-pill[data-type]')
      if (pill) addTypeAtCenter(pill.dataset.type)
    })
    $in('startSampleBtn')?.addEventListener('click', () => { if (openSampleMap()) focusCanvas() })
    $in('startShortcutsBtn')?.addEventListener('click', () => openShortcuts())
  }

  if (keysWired) return
  keysWired = true
  // 1, 2 and 3 pick an option while the panel is up and nothing is being
  // typed, a menu or a dialog has the keys, or a modifier is held.
  document.addEventListener('keydown', e => {
    if (!/^[123]$/.test(e.key) || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return
    if (!startPanelVisible() || isMenuOpen() || modalDialogOpen()) return
    const ae = document.activeElement
    if (ae?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae?.tagName || '')) return
    if (ae?.closest?.('[role="dialog"], .shortcut-modal')) return
    e.preventDefault()
    if (e.key === '1') setNotesOpen(true)
    else if (e.key === '2') openTemplateMenu()
    else if (openSampleMap()) focusCanvas()
  })
}
