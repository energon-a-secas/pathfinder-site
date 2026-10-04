// ════════════════════════════════════════════════════════════
//  inspector.js: the right panel, for one block, several blocks
//  or one connection.
//
//  The panel used to open on 43 coloured pickers before the Title
//  field. It now opens on what the block says: a header row of
//  dropdowns (type, status, more), then Title and Description, then
//  only the fields the block's type reads, then Suggestions. How a
//  block looks, and the rarer fields, sit in disclosures that stay
//  closed until someone opens them (and remember that per browser).
//
//  Every edit is one undo step: menus and toggles pass
//  { undo: true }, text fields coalesce a typing burst with
//  snapshotOnce.
// ════════════════════════════════════════════════════════════

import { relationHint, impliedVerb, RELATIONS } from './relations.js'
import { state, selection, ui, view, canvasMeta, debouncedSave,
         snapshotOnce, resetSnapshotToken } from './state.js'
import { $, TYPES, SWATCH_COLORS, SWATCH_NAMES,
         STATUS_DEFS, PRIORITY_DEFS, ACTION_DEFS, ACTION_LABELS, ARROW_LABEL_PRESETS, CARD_STYLES, drawnCardStyle, pickableCardStyles,
         DEFAULT_CARD_STYLE, BORDER_WIDTHS, HIGHLIGHTS, escHtml, showToast, getBlockEl } from './utils.js'
import { renderFrames, arrowRoute, arrowPattern } from './canvas.js'
import { renderBlock, selectBlock, mutateBlock, mutateBlocks, mutateArrow,
         deleteBlock, deleteArrow, duplicateBlock, deleteBlocksBatch, createGroup, deleteGroup } from './render.js'
import { applyGapFix } from './create.js'
import { GAP_META, getGapFixes, acceptGap, unacceptGap } from './gaps.js'
import { askQuestion, openDocPopup, detectSeeReference } from './doc-panel.js'
import { arrangeSelection } from './align.js'
import { openDropdown, isMenuOpen } from './menu.js'
import { typeMenuItems, retypeBlock, retypeBlocks, typeNoun } from './type-menu.js'
import { typeShape, chipIcon } from './cards.js'
import { showPanels } from './chrome.js'
import { setSpotlight } from './view-menu.js'
import { animateView } from './zoom-controls.js'

// The type picker lives in type-menu.js; the inspector was its first home.
export { typeMenuItems }

// ── Small helpers ────────────────────────────────────────────
const byId = id => document.getElementById(id)
const setText = (id, text) => { const el = byId(id); if (el) el.textContent = text }
const setHidden = (el, hidden) => { if (el) el.hidden = !!hidden }
const setValue = (el, v) => { if (el && el.value !== v) el.value = v }
// A field someone is typing in keeps its text: the model already holds what
// they typed, and some fields read it back normalised (criteria drops blank
// lines, a link is trimmed), so writing it back would eat the character just
// typed. `force` is for a different block or connection coming up, which must
// never inherit the last one's text just because the field kept focus.
const setField = (el, v, force = false) => {
  if (el && (force || document.activeElement !== el)) setValue(el, v)
}
const hasFocusIn = el => !!el && el.contains(document.activeElement)

// Read-only: a field is something to read, so an empty one would only show
// its placeholder, which reads like content ("Returns within 200ms"). Empty
// fields hide and placeholders go blank.
function viewOnly(el, ro, { empty = false, placeholder } = {}) {
  if (!el) return
  if (el.dataset.ph === undefined) el.dataset.ph = el.placeholder || ''
  if (placeholder !== undefined) el.dataset.ph = placeholder
  el.placeholder = ro ? '' : el.dataset.ph
  el.readOnly = ro
  const section = el.closest('.insp-section')
  if (section) section.hidden = ro && empty
}
const typeKey = t => (TYPES[t] ? t : 'custom')
const typeColor = t => `var(--c-${typeKey(t)})`
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || '')

// Priority dots read the theme's type tokens, so light mode gets its own
// darker values instead of the dark palette's hex. Status glyphs are coloured
// the same way, in CSS, by their data-status.
// Priority is drawn as signal bars, never a colour: the type colours mean
// types (cards.js chipIcon).

// Read by no check: they only reach the prompt as badges, so they live in
// Planning rather than next to the type's own action.
const PLANNING_ACTIONS = ['recollect', 'reinforce']

// Placeholders, written per type and set in the muted italic (CSS), so an
// empty field reads as a prompt to fill it, never as content. The title's is
// an example name of that type (what a card of it is called, not what the
// type means: the type's definition is the type menu's job); the done-list's
// are examples of that type's criteria. Both are led by "e.g.", and an
// Output's name an output, not a cart. None ends in an ellipsis.
const TITLE_PLACEHOLDERS = {
  goal: 'e.g. Halve checkout support calls',
  problem: 'e.g. 1 in 50 orders fails at payment',
  stakeholder: 'e.g. Support team leads',
  metric: 'e.g. Weekly checkout failure rate',
  requirement: 'e.g. Orders survive a payment retry',
  output: 'e.g. Weekly reliability report',
  implementation: 'e.g. Add retries to the payment client',
  process: 'e.g. Triage new incidents',
  terminator: 'e.g. Order placed',
  decision: 'e.g. Retry payments from a queue',
  resource: 'e.g. Payments service',
  assumption: 'e.g. Most failures are timeouts',
  risk: 'e.g. A retry charges a card twice',
  question: 'e.g. Which failures are safe to retry?',
  context: 'e.g. Peak season starts in November',
  custom: 'Name this block',
}
const DESC_PLACEHOLDER = 'Add the detail someone needs to act on this'
const CRITERIA_PLACEHOLDERS = {
  goal: 'e.g. Support calls about checkout halve by June\nNo new step for returning customers',
  requirement: 'e.g. Responds within 200ms at peak load\nWorks for signed-out visitors',
  output: 'e.g. Reviewed by the support lead\nPublished where the team looks for it',
  implementation: 'e.g. Tests cover the failure paths\nShipped behind a flag',
  metric: 'e.g. 40 teams on the report by March\nReady by 9am every Monday',
}
export function placeholdersFor(type) {
  const cfg = TYPES[type] || TYPES.custom
  return {
    title: TITLE_PLACEHOLDERS[type] || TITLE_PLACEHOLDERS.custom,
    desc: DESC_PLACEHOLDER,
    criteria: CRITERIA_PLACEHOLDERS[type] || (cfg.criteria === 'Targets' ? CRITERIA_PLACEHOLDERS.metric : CRITERIA_PLACEHOLDERS.requirement),
  }
}

const WEIGHTS = [1, 1.5, 2.5, 3.5]

// A weight from the previous scale (Normal 2, Bold 5) keeps its old name, so
// a connection drawn before the rescale reads "Normal (2px)", not a bare size.
const LEGACY_WEIGHT_NAMES = { 2: 'Normal', 5: 'Bold' }

/** "2 processes", "1 goal", "2 other blocks" (typeNoun, type-menu.js). */
export function typeCount(t, n) {
  return `${n} ${typeNoun(t, n)}`
}

const statusKey = b => (b && b.status && b.status !== 'not-started' && STATUS_DEFS[b.status]) ? b.status : ''
const statusLabel = k => (k ? STATUS_DEFS[k].label : 'No status')
const statusGlyph = k => (k ? STATUS_DEFS[k].icon : STATUS_DEFS['not-started']?.icon || '○')

/**
 * The highlight picker. One markup helper for both places it appears, so the
 * single-block and multi-select versions cannot drift.
 *
 * `active` is the currently applied key, or `'mixed'` when a selection carries
 * more than one, which is worth showing rather than silently picking the first.
 */
export function highlightRowHtml(active) {
  return `<button type="button" class="hl-swatch hl-swatch-none${!active ? ' active' : ''}" data-hl=""
            aria-pressed="${!active}" title="No highlight" aria-label="No highlight"></button>` +
    Object.entries(HIGHLIGHTS).map(([key, h]) =>
      `<button type="button" class="hl-swatch${key === 'festive' ? ' hl-swatch-festive' : ''}${active === key ? ' active' : ''}"
               data-hl="${key}" style="--sw:var(--hl-${key})" aria-pressed="${active === key}"
               title="${escHtml(h.label)}: ${escHtml(h.hint)}" aria-label="${escHtml(h.label)}"></button>`
    ).join('')
}

/** What a whole selection is set to: one key, null, or 'mixed'. */
export function selectionHighlight(ids) {
  const seen = new Set(ids.map(id => state.blocks[id]?.highlight || null))
  if (seen.size > 1) return 'mixed'
  return [...seen][0] || null
}

/** One value shared by every id, or undefined when they differ. */
function commonValue(ids, read) {
  const seen = new Set(ids.map(id => (state.blocks[id] ? read(state.blocks[id]) : undefined)))
  return seen.size === 1 ? [...seen][0] : undefined
}

// ── Disclosures ──────────────────────────────────────────────
// Open state is a per-browser preference, never part of the map. An embed is
// someone else's page, so it reads the preference and never writes it.
const OPEN_KEY = 'pathfinder-insp-open'

function readOpenState() {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch (_) { return {} }
}

function rememberOpen(name, open) {
  if (ui.embed) return
  try {
    const all = readOpenState()
    all[name] = !!open
    localStorage.setItem(OPEN_KEY, JSON.stringify(all))
  } catch (_) {}
}

/**
 * Scroll the panel so a section just opened shows its controls: its bottom
 * comes into view, but never at the cost of pushing its summary off the top.
 * Only the panel's own scroller moves (not the page), and instantly: the
 * panel is not a place for motion.
 */
export function revealDisclosure(d) {
  let sc = d.parentElement
  while (sc && sc !== document.body) {
    const oy = getComputedStyle(sc).overflowY
    if ((oy === 'auto' || oy === 'scroll') && sc.scrollHeight > sc.clientHeight) break
    sc = sc.parentElement
  }
  if (!sc || sc === document.body) return
  const box = sc.getBoundingClientRect(), r = d.getBoundingClientRect()
  const delta = Math.min(r.bottom - box.bottom, r.top - box.top)
  if (delta > 0) sc.scrollTop += Math.ceil(delta)
}

// Applied only when a different block or arrow comes up, so re-rendering the
// same one (after a status change, say) never slams a section shut.
function applyDisclosures(root, auto = {}) {
  if (!root) return
  const saved = readOpenState()
  root.querySelectorAll('details[data-disclosure]').forEach(d => {
    const name = d.dataset.disclosure
    d.open = !!saved[name] || !!auto[name]
  })
}

// attention.js and create.js focus a field by id. Inside a closed
// disclosure that focus silently does nothing, so a field in one opens its
// disclosure before it takes focus.
function revealOnFocus(el) {
  if (!el || el._pfReveal) return
  el._pfReveal = true
  const focus = el.focus
  el.focus = function (...args) {
    const d = this.closest('details')
    if (d && !d.open) d.open = true
    return focus.apply(this, args)
  }
}
function revealFieldsIn(root) {
  root?.querySelectorAll('details input, details textarea, details select, details button')
    .forEach(revealOnFocus)
}

// Description, criteria and notes grow with their text. Chromium does it
// natively with field-sizing; elsewhere, measure on input.
const NATIVE_AUTOGROW = typeof CSS !== 'undefined' && !!CSS.supports?.('field-sizing', 'content')
function autogrow(el) {
  if (NATIVE_AUTOGROW || !el || !el.offsetParent) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight + 2, 320) + 'px'
}

// ── Inspector ────────────────────────────────────────────────
let lastBlockId = null
let lastArrowId = null
let lastGroupId = null

export function renderInspector() {
  renderInspectorPane()
  syncSheet()
}

function renderInspectorPane() {
  const inspectorEmpty   = $.inspectorEmpty()
  const inspectorContent = $.inspectorContent()
  const inspectorMulti   = $.inspectorMulti()
  const inspectorArrow   = $.inspectorArrow()
  const showOnly = which => {
    if (inspectorEmpty)   inspectorEmpty.style.display   = which === 'empty' ? '' : 'none'
    if (inspectorContent) inspectorContent.style.display = which === 'block' ? '' : 'none'
    if (inspectorMulti)   inspectorMulti.style.display   = which === 'multi' ? '' : 'none'
    if (inspectorArrow)   inspectorArrow.style.display   = which === 'arrow' ? '' : 'none'
    if (which !== 'block') lastBlockId = null
    if (which !== 'arrow') lastArrowId = null
    if (which !== 'multi') lastGroupId = null
  }

  if (selection.ids.size > 1) {
    showOnly('multi')
    renderMultiInspector([...selection.ids])
    return
  }
  if (selection.arrowId) {
    showOnly('arrow')
    const a = state.arrows.find(arr => arr.id === selection.arrowId)
    if (a) renderArrowInspector(a)
    return
  }
  const b = selection.blockId && state.blocks[selection.blockId]
  if (!b) { showOnly('empty'); return }
  showOnly('block')
  renderBlockInspector(b)
}

// ── One block ────────────────────────────────────────────────
function typeActionsFor(b) {
  const own = TYPES[b.type]?.actions || []
  const carried = (b.actions || []).filter(a => !PLANNING_ACTIONS.includes(a))
  return [...new Set([...own, ...carried])]
}

function renderBlockInspector(b) {
  const isNew = lastBlockId !== b.id
  lastBlockId = b.id
  const ro = ui.readOnly
  const cfg = TYPES[b.type] || TYPES.custom
  const root = $.inspectorContent()

  // Header row: type, status, more.
  const typeBtn = byId('inspTypeBtn')
  if (typeBtn) {
    const dot = byId('inspTypeDot')
    if (dot) { dot.style.background = typeColor(b.type); dot.dataset.shape = typeShape(b.type) }
    setText('inspTypeLabel', cfg.label)
    typeBtn.disabled = ro
    typeBtn.classList.toggle('is-unconfirmed', !!b.typeCheck)
    typeBtn.setAttribute('aria-label', `Type: ${cfg.label}${b.typeCheck ? ', not confirmed yet' : ''}`)
    typeBtn.title = b.typeCheck ? 'Typed automatically: confirm or change it' : (cfg.tip || cfg.short || '')
  }
  const statusBtn = byId('inspStatusBtn')
  if (statusBtn) {
    const k = statusKey(b)
    const glyph = byId('inspStatusGlyph')
    if (glyph) { glyph.textContent = statusGlyph(k); glyph.dataset.status = k }
    // An unset status reads as the control's name, which is shorter than
    // "No status" and leaves the type's name room in a 320px panel.
    setText('inspStatusLabel', k ? statusLabel(k) : 'Status')
    statusBtn.disabled = ro
    statusBtn.setAttribute('aria-label', `Status: ${statusLabel(k)}`)
    statusBtn.title = `Status: ${statusLabel(k)}`
  }
  setHidden(byId('inspMoreBtn'), ro)
  fitHead()

  // Title and description.
  const inspTitle = $.inspTitle(), inspDesc = $.inspDesc(), inspNotes = $.inspNotes()
  setField(inspTitle, b.title || '', isNew)
  setField(inspDesc, b.description || '', isNew)
  setField(inspNotes, b.notes || '', isNew)
  const ph = placeholdersFor(b.type)
  viewOnly(inspTitle, ro, { placeholder: ph.title })
  viewOnly(inspDesc, ro, { empty: !(b.description || '').trim(), placeholder: ph.desc })
  viewOnly(inspNotes, ro)

  // Fields the type reads. The registry names the done-list: "Acceptance
  // criteria", or "Targets" on a metric.
  const criteriaSection = byId('criteriaSection')
  if (criteriaSection) {
    const wants = cfg.criteria
    criteriaSection.style.display = wants ? '' : 'none'
    if (wants) {
      const targets = wants === 'Targets'
      setText('criteriaLabelText', wants)
      setText('criteriaHint', targets ? 'one per line, each with a number' : 'one per line')
      const el = $.inspCriteria()
      setField(el, (b.criteria || []).join('\n'), isNew)
      viewOnly(el, ro, { empty: !(b.criteria || []).length, placeholder: ph.criteria })
    }
  }
  const rationaleSection = byId('rationaleSection')
  if (rationaleSection) {
    rationaleSection.style.display = b.type === 'decision' ? '' : 'none'
    const el = $.inspRationale()
    if (b.type === 'decision') setField(el, b.rationale || '', isNew)
    viewOnly(el, ro, { empty: !(b.rationale || '').trim() })
  }
  renderAnswer(b, isNew, ro)

  // The type's own actions, as real toggles. An action the block carries
  // from an earlier type stays visible so it can be switched off. The same
  // set of toggles is updated in place, so a toggle keeps keyboard focus when
  // something else (a suggestion, the canvas) changes the block.
  const actsBox = byId('typeActions')
  if (actsBox) {
    const acts = typeActionsFor(b)
    setHidden(byId('typeActionsSection'), !acts.length)
    const shown = [...actsBox.querySelectorAll('.action-toggle[data-action]')]
    if (shown.length === acts.length && shown.every((btn, i) => btn.dataset.action === acts[i])) {
      shown.forEach(btn => {
        btn.setAttribute('aria-pressed', (b.actions || []).includes(btn.dataset.action) ? 'true' : 'false')
        btn.disabled = ro
      })
    } else actsBox.innerHTML = acts.map(a => {
      const on = (b.actions || []).includes(a)
      return `<button type="button" class="action-toggle" data-action="${escHtml(a)}" aria-pressed="${on}"
        title="${escHtml(ACTION_DEFS[a] || a)}"${ro ? ' disabled' : ''}><span class="action-tick" aria-hidden="true"></span>${escHtml(ACTION_LABELS[a] || a)}</button>`
    }).join('')
  }
  // A question stated as a belief should become an Assumption, so the AI is
  // told to pressure-test it rather than just answer it.
  setHidden(byId('promoteAssumption'), ro || b.type !== 'question')

  renderSuggestions(b)

  // Questions
  const qCount = (b.questions || []).length
  setText('questionsCount', qCount ? String(qCount) : '')
  // Rebuilding the list would drop the caret of someone typing a question.
  if (isNew || !hasFocusIn($.questionsList())) renderQuestions(b)
  setHidden(byId('addQuestionBtn'), ro)

  // Notes
  const noteLine = (b.notes || '').trim().split(/\r?\n/)[0] || ''
  setText('notesHint', noteLine.length > 34 ? noteLine.slice(0, 33) + '…' : noteLine)

  // Links and docs
  const docHref = byId('docRefHref'), docLabel = byId('docRefLabel'), docAnchor = byId('docRefAnchor')
  ;[[docHref, 'href'], [docLabel, 'label'], [docAnchor, 'anchor']].forEach(([el, key]) => {
    setField(el, b.docRef?.[key] || '', isNew)
    viewOnly(el, ro)
  })
  setHidden(byId('docRefPreviewBtn'), !b.docRef?.href)
  const seeRef = detectSeeReference(b.description)
  const promoteSee = byId('promoteSeeRef')
  if (promoteSee) {
    const offer = !!seeRef && !b.docRef && !ro
    promoteSee.hidden = !offer
    if (offer) promoteSee.textContent = `Use "See: ${seeRef.label || seeRef.href}" as this block's doc`
  }
  const hasDoc = !!(b.docRef && (b.docRef.href || b.docRef.label))
  setText('docsHint', hasDoc ? (b.docRef.label || b.docRef.href) : seeRef ? 'See: line found' : '')

  // Planning
  const pr = PRIORITY_DEFS[b.priority] ? b.priority : ''
  const prBtn = byId('inspPriorityBtn')
  if (prBtn) {
    const dot = byId('inspPriorityDot')
    if (dot) {
      dot.style.background = ''
      dot.innerHTML = pr ? chipIcon('priority', pr) : ''
      dot.classList.toggle('is-icon', !!pr)
      dot.classList.toggle('is-empty', !pr)
    }
    setText('inspPriorityText', pr ? PRIORITY_DEFS[pr].label : 'None')
    prBtn.disabled = ro
    prBtn.setAttribute('aria-label', `Priority: ${pr ? PRIORITY_DEFS[pr].label : 'None'}`)
  }
  root?.querySelectorAll('#planningDetails .action-toggle').forEach(btn => {
    const on = (b.actions || []).includes(btn.dataset.action)
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    btn.disabled = ro
  })
  const planParts = [pr ? `${PRIORITY_DEFS[pr].label} priority` : '',
    ...PLANNING_ACTIONS.filter(a => (b.actions || []).includes(a)).map(a => ACTION_LABELS[a])].filter(Boolean)
  setText('planningHint', planParts.join(', '))

  renderAppearance(b)

  // Read-only: nothing to add, so empty sections are noise rather than
  // invitations. Appearance is authoring only.
  setHidden(byId('questionsDetails'), ro && !qCount)
  setHidden(byId('notesDetails'), ro && !(b.notes || '').trim())
  setHidden(byId('docsDetails'), ro && !hasDoc)
  setHidden(byId('planningDetails'), ro && !planParts.length)
  setHidden(byId('appearanceDetails'), ro)

  if (isNew) {
    applyDisclosures(root, {
      questions: b.type === 'question' || (b.questions || []).some(q => (q.text || '').trim() && !(q.answer || '').trim()),
      docs: hasDoc || !!seeRef,
    })
  }
  revealFieldsIn(root)
  ;[inspDesc, $.inspCriteria(), $.inspRationale(), inspNotes].forEach(autogrow)
  // Again now the body is in: a body tall enough for a classic scrollbar
  // narrows the head, and the observer's re-fit waits a frame.
  fitHead()
}

// ── An Open Question's answer ────────────────────────────────
// The card is the question, so its answer is a field of its own
// (block.answer), not a questions[] entry. The section is built here, right
// after the type's other fields, so it stays one unit. Writing an answer into
// an empty field marks the question done when the field is left, inside the
// same typing burst (one undo step), exactly as a patch answer does; the
// label's hint says so before it happens. A block retyped from a question
// keeps the field while it holds an answer, so what the prompt prints can
// still be read and cleared.
function answerSection() {
  const anchor = byId('rationaleSection') || byId('criteriaSection')
  if (!anchor) return null
  if (anchor.nextElementSibling?.id === 'answerSection') return anchor.nextElementSibling
  const section = document.createElement('div')
  section.className = 'insp-section'
  section.id = 'answerSection'
  section.style.display = 'none'
  section.innerHTML =
    // The hint is a sentence of its own under the field: inside the label it
    // read as one phrase ("Answer writing one marks the question done").
    '<label class="insp-label" for="inspAnswer">Answer</label>' +
    '<textarea class="insp-textarea insp-autogrow" id="inspAnswer" rows="2" placeholder="What you found, and how you know it" aria-describedby="answerHint"></textarea>' +
    '<p class="insp-help" id="answerHint"></p>'
  anchor.after(section)
  wireAnswerField(section.querySelector('textarea'))
  return section
}

function renderAnswer(b, isNew, ro) {
  // Another block coming up ends the burst on the one before. A click on a
  // card selects it on pointerdown, before the field blurs, and the field
  // then shows the new block's answer, so no change event follows: the
  // answer typed into the last question still settles its status here,
  // inside its own undo entry.
  if (answerBurst && answerBurst.id !== b.id) settleAnswer()
  const section = answerSection()
  if (!section) return
  const has = !!String(b.answer || '').trim()
  const show = b.type === 'question' || has
  section.style.display = show ? '' : 'none'
  const el = section.querySelector('textarea')
  setField(el, show ? (b.answer || '') : '', isNew)
  const hint = section.querySelector('#answerHint')
  hint.textContent = ro ? ''
    : b.type !== 'question' ? 'Kept from when this was an open question.'
    : b.status === 'done' ? '' : 'Writing one marks the question done.'
  hint.hidden = !hint.textContent
  viewOnly(el, ro, { empty: !has })
  autogrow(el)
}

let answerBurst = null // { id, wasEmpty }: the typing burst in progress

// End the burst: an answer written into an empty field marks its question
// done. Read from the model, never from the field, which may already show
// another block. Still inside the burst's undo entry, so the answer and the
// status it settles are one step. `refresh` redraws the inspector for the
// status; a caller already drawing it passes false.
function settleAnswer({ refresh = false } = {}) {
  const burst = answerBurst
  answerBurst = null
  const b = burst && state.blocks[burst.id]
  if (b && !ui.readOnly && b.type === 'question' && burst.wasEmpty &&
      String(b.answer || '').trim() && b.status !== 'done') {
    mutateBlock(burst.id, { status: 'done' })
    if (refresh) renderInspector()
  }
  if (burst) resetSnapshotToken()
}

function wireAnswerField(el) {
  if (!el || el._pfAnswer) return
  el._pfAnswer = true
  el.addEventListener('input', () => {
    autogrow(el)
    const id = selection.blockId
    const b = id && state.blocks[id]
    if (!b || ui.readOnly) return
    if (answerBurst?.id !== id) answerBurst = { id, wasEmpty: !String(b.answer || '').trim() }
    snapshotOnce('insp-answer:' + id)
    mutateBlock(id, { answer: el.value.trim() ? el.value : undefined })
  })
  // Leaving the field ends the burst however focus goes: Tab, a click in the
  // panel, a click on the canvas.
  el.addEventListener('change', () => settleAnswer({ refresh: true }))
  el.addEventListener('blur', () => settleAnswer({ refresh: true }))
}

// ── Header fit ───────────────────────────────────────────────
// The type's name is what the header row is for. When it would lose letters
// next to a status word ("Implementation" beside "In progress" in a 320px
// panel), the status drops to its glyph, which keeps its colour, tooltip and
// accessible name. Measured rather than guessed: labels come from the
// registry and panels come in more than one width. The observer re-fits when
// the panel changes width or first becomes visible.
let headObserver = null, observedHead = null
function fitHead() {
  const label = byId('inspTypeLabel')
  const head = label?.closest('.insp-head')
  if (!head) return
  if (observedHead !== head && typeof ResizeObserver === 'function') {
    headObserver = headObserver || new ResizeObserver(() => fitHead())
    if (observedHead) headObserver.unobserve(observedHead)
    headObserver.observe(head)
    observedHead = head
  }
  head.classList.remove('is-tight')
  if (label.scrollWidth > label.clientWidth + 0.5) head.classList.add('is-tight')
}

// One row of four menu buttons. Colour and Highlight show only their dot;
// every button says its full value to assistive tech and on hover.
function renderAppearance(b) {
  const face = (id, label) => { const el = byId(id); if (el) { el.setAttribute('aria-label', label); el.title = label } }
  const colourDot = byId('inspColourDot')
  if (colourDot) colourDot.style.background = b.color || typeColor(b.type)
  const colourName = b.color ? (SWATCH_NAMES[b.color] || 'Custom') : 'Type colour'
  setText('inspColourText', colourName)
  face('inspColourBtn', `Colour: ${b.color ? colourName : 'type colour'}`)

  const card = CARD_STYLES[b.cardStyle] ? CARD_STYLES[drawnCardStyle(b.cardStyle)].label : 'Default'
  setText('inspCardText', card)
  face('inspCardBtn', `Card style: ${b.cardStyle && CARD_STYLES[b.cardStyle] ? card : 'map default'}`)

  const border = b.borderWidth ? `${b.borderWidth}px` : 'Auto'
  setText('inspBorderText', border)
  face('inspBorderBtn', `Border: ${border}`)

  const h = HIGHLIGHTS[b.highlight]
  const hlDot = byId('inspHighlightDot')
  if (hlDot) { hlDot.style.background = h ? `var(--hl-${b.highlight})` : ''; hlDot.classList.toggle('is-empty', !h) }
  setText('inspHighlightText', h ? h.label : 'None')
  face('inspHighlightBtn', `Highlight: ${h ? h.label : 'none'}`)

  const parts = [b.color ? `${colourName} colour` : '', b.cardStyle && CARD_STYLES[b.cardStyle] ? card : '',
    b.borderWidth ? border + ' border' : '', h ? h.label : ''].filter(Boolean)
  setText('appearanceHint', parts.join(', '))
}

// ── Suggestions ──────────────────────────────────────────────
function gapShort(gid) {
  return GAP_META[gid]?.short || gid.replace(/^gap-/, '').replace(/-/g, ' ')
}

function renderSuggestions(b) {
  const section = byId('gapFixesSection'), list = byId('gapFixes')
  if (!section || !list) return
  const ro = ui.readOnly
  const fixes = getGapFixes(b)
  section.hidden = !fixes.length
  // One block reports one gap, so the fixes usually share it. Accept is
  // offered once per gap rather than once per fix: two buttons doing the
  // same thing on one card would read as two different choices. Every fix
  // names the gap it answers (getGapFixes), so that is what gets accepted.
  const canAccept = !ro
  const groups = new Map()
  fixes.forEach(f => {
    const g = f.gap || ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(f)
  })
  // A read-only viewer cannot drag a port or add a requirement, so the fixes'
  // instructions would only be orders they cannot follow. They get what the
  // check found, by name.
  setText('gapFixesTitle', ro ? 'Gaps' : 'Suggestions')
  if (ro) {
    setText('gapFixesCount', groups.size ? String(groups.size) : '')
    list.innerHTML = [...groups].map(([g, fs]) => `
      <div class="gap-fix-item">
        <span class="gap-fix-icon" aria-hidden="true">${fs[0]?.icon || ''}</span>
        <div class="gap-fix-text">${escHtml(g ? gapShort(g) : 'Flagged by the checks')}</div>
      </div>`).join('')
  } else {
    setText('gapFixesCount', fixes.length ? String(fixes.length) : '')
    list.innerHTML = [...groups].map(([g, fs]) =>
      fs.map(f => `
        <div class="gap-fix-item">
          <span class="gap-fix-icon" aria-hidden="true">${f.icon || ''}</span>
          <div class="gap-fix-text">${escHtml(f.text || '')}</div>
          ${f.action ? `<button type="button" class="btn btn-secondary btn-sm gap-fix-btn" data-fix="${escHtml(f.id)}" data-bid="${escHtml(b.id)}">${escHtml(f.action)}</button>` : ''}
        </div>`).join('') +
      (canAccept && g ? `
        <div class="gap-fix-accept-row">
          <span>Deliberate here?</span>
          <button type="button" class="btn btn-ghost btn-sm gap-fix-accept" data-accept="${escHtml(g)}" data-bid="${escHtml(b.id)}"
            aria-label="Accept this gap: ${escHtml(gapShort(g))}">Accept</button>
        </div>` : '')
    ).join('')
  }

  // Gaps the author accepted stay listed, with a way back.
  const acc = byId('gapAccepted')
  if (acc) {
    const acks = Array.isArray(b.gapAck) ? b.gapAck.filter(Boolean) : []
    acc.hidden = !acks.length
    acc.innerHTML = acks.length
      ? '<span class="insp-accepted-label">Accepted:</span> ' + acks.map(g =>
          `<span class="insp-accepted-item">${escHtml(gapShort(g))}${ro ? '' :
            ` <button type="button" class="insp-accepted-reopen" data-reopen="${escHtml(g)}" aria-label="Reopen: ${escHtml(gapShort(g))}">Reopen</button>`}</span>`
        ).join(' ')
      : ''
  }
}

// ── Questions ────────────────────────────────────────────────
export function renderQuestions(b) {
  const questionsList = $.questionsList()
  if (!questionsList || !b) return
  const ro = ui.readOnly
  const id = b.id
  questionsList.innerHTML = (b.questions || []).map((q, i) => `
    <div class="question-item${q.answer ? ' answered' : ''}">
      <div class="question-row">
        <input type="text" value="${escHtml(q.text)}" placeholder="Ask a question" data-qi="${i}" aria-label="Question ${i + 1}"${ro ? ' readonly' : ''}>
        <button type="button" class="q-ask" data-qi="${i}" title="Copy a grounded prompt for this question">Ask</button>
        ${ro ? '' : `<button type="button" class="q-del" data-qi="${i}" title="Delete" aria-label="Delete question ${i + 1}">×</button>`}
      </div>
      <textarea class="question-answer" data-qi="${i}" rows="2" aria-label="Answer to question ${i + 1}"
        placeholder="Paste the assistant's answer"${ro ? ' readonly' : ''}>${escHtml(q.answer || '')}</textarea>
    </div>`).join('')

  const live = () => state.blocks[id]
  questionsList.querySelectorAll('input[data-qi]').forEach(inp => {
    inp.addEventListener('input', () => {
      const b2 = live(); if (!b2 || ui.readOnly) return
      const q = b2.questions[+inp.dataset.qi]; if (!q) return
      snapshotOnce(`insp-q:${id}:${inp.dataset.qi}`)
      q.text = inp.value
      debouncedSave(); ui.promptDirty = true
    })
    inp.addEventListener('change', resetSnapshotToken)
  })
  questionsList.querySelectorAll('.question-answer').forEach(ta => {
    ta.addEventListener('input', () => {
      const b2 = live(); if (!b2 || ui.readOnly) return
      const q = b2.questions[+ta.dataset.qi]; if (!q) return
      snapshotOnce(`insp-qa:${id}:${ta.dataset.qi}`)
      const was = !!q.answer
      if (ta.value.trim()) q.answer = ta.value; else delete q.answer
      ta.closest('.question-item')?.classList.toggle('answered', !!q.answer)
      // The card's answered badge only changes when this flips.
      if (was !== !!q.answer) renderBlock(id)
      debouncedSave(); ui.promptDirty = true
    })
    ta.addEventListener('change', resetSnapshotToken)
  })
  questionsList.querySelectorAll('.q-ask').forEach(btn =>
    btn.addEventListener('click', () => { const b2 = live(); if (b2) askQuestion(b2, +btn.dataset.qi) }))
  questionsList.querySelectorAll('.q-del').forEach(btn =>
    btn.addEventListener('click', () => {
      const b2 = live(); if (!b2 || ui.readOnly) return
      const i = +btn.dataset.qi
      mutateBlock(id, { questions: b2.questions.filter((_, j) => j !== i) }, { undo: true })
      renderQuestions(state.blocks[id])
      const n = (state.blocks[id]?.questions || []).length
      setText('questionsCount', n ? String(n) : '')
    }))
  revealFieldsIn(questionsList.closest('details'))
}

// ── Several blocks ───────────────────────────────────────────
function renderMultiInspector(ids) {
  const ro = ui.readOnly
  // A count by type, because "5 problems, 3 requirements, 1 goal" is what
  // people actually want to say out loud when they present a canvas.
  const tally = {}
  ids.forEach(id => { const t = state.blocks[id]?.type; if (t) tally[t] = (tally[t] || 0) + 1 })
  const parts = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => typeCount(t, n))
  setText('multiCount', `${ids.length} blocks selected` + (parts.length > 1 ? `: ${parts.join(', ')}` : ''))

  const type = commonValue(ids, b => b.type)
  const typeDot = byId('multiTypeDot')
  if (typeDot) { typeDot.style.background = type ? typeColor(type) : ''; typeDot.dataset.shape = type ? typeShape(type) : 'dot'; typeDot.hidden = !type }
  setText('multiTypeText', type ? TYPES[typeKey(type)].label : 'Mixed types')
  const status = commonValue(ids, b => statusKey(b))
  setText('multiStatusText', status === undefined ? 'Mixed status' : status ? statusLabel(status) : 'No status')
  const prio = commonValue(ids, b => (PRIORITY_DEFS[b.priority] ? b.priority : ''))
  setText('multiPriorityText', prio === undefined ? 'Mixed priority' : prio ? `${PRIORITY_DEFS[prio].label} priority` : 'No priority')
  ;['multiTypeBtn', 'multiStatusBtn', 'multiPriorityBtn'].forEach(id => { const el = byId(id); if (el) el.disabled = ro })

  const multiHl = byId('multiHighlightRow')
  if (multiHl) {
    const active = selectionHighlight(ids)
    multiHl.innerHTML = highlightRowHtml(active === 'mixed' ? null : active)
    multiHl.dataset.mixed = active === 'mixed' ? '1' : ''
    multiHl.closest('.insp-section')?.toggleAttribute('hidden', ro)
  }
  const spotBtn = byId('spotlightBtn')
  if (spotBtn) {
    spotBtn.classList.toggle('active', !!canvasMeta.spotlight)
    spotBtn.setAttribute('aria-pressed', canvasMeta.spotlight ? 'true' : 'false')
  }
  setHidden(byId('multiArrangeRow'), ro)
  setHidden(byId('deleteMultiBtn'), ro)
  const distribute = byId('multiDistributeBtn')
  if (distribute) distribute.disabled = ids.length < 3
  if (distribute) distribute.title = ids.length < 3 ? 'Needs three or more blocks' : ''

  const frameSection = byId('frameSection')
  const groupBlocksBtn = byId('groupBlocksBtn')
  if (frameSection && groupBlocksBtn) {
    const hasGroup = selection.groupId && state.groups[selection.groupId]
    frameSection.style.display = hasGroup && !ro ? '' : 'none'
    groupBlocksBtn.hidden = !!hasGroup
    if (hasGroup) setField(byId('frameLabelInput'), state.groups[selection.groupId].label || '', lastGroupId !== selection.groupId)
    lastGroupId = hasGroup ? selection.groupId : null
  }
}

// ── One connection ───────────────────────────────────────────
function endpointHtml(b, id, role) {
  if (!b) return `<span class="insp-endpoint is-missing">${role}: missing block</span>`
  const t = typeKey(b.type)
  const title = b.title || 'Untitled'
  return `<button type="button" class="insp-endpoint" data-select-block="${escHtml(id)}"
      aria-label="${role}: ${escHtml(TYPES[t].label)}, ${escHtml(title)}. Select it" title="Select this block">
    <span class="insp-dot" data-shape="${typeShape(t)}" style="background:${typeColor(t)}" aria-hidden="true"></span>
    <span class="insp-endpoint-text"><span class="insp-endpoint-type">${escHtml(TYPES[t].label)}</span><span class="insp-endpoint-title">${escHtml(title)}</span></span>
  </button>`
}

function renderArrowInspector(a) {
  const isNew = lastArrowId !== a.id
  lastArrowId = a.id
  const ro = ui.readOnly
  const f = state.blocks[a.from], t = state.blocks[a.to]

  const info = byId('arrowInfo')
  if (info) {
    info.innerHTML = endpointHtml(f, a.from, 'From') +
      '<span class="insp-arrow-sep" aria-hidden="true">↓</span>' + endpointHtml(t, a.to, 'To')
  }
  setHidden(byId('arrowReverse'), ro)

  // Label: free text with suggestions. The verb the two types imply comes
  // first, then the meanings, then the old preset chips.
  const verb = impliedVerb(f?.type, t?.type)
  const labelInput = byId('arrowLabelInput')
  if (labelInput) {
    setField(labelInput, a.label || '', isNew)
    viewOnly(labelInput, ro, { empty: !(a.label || '').trim(),
      placeholder: verb ? `Implied: ${verb}` : 'e.g. depends on, produces' })
  }
  const list = byId('arrowLabelSuggestions')
  if (list) {
    const opts = [...new Set([verb, ...Object.values(RELATIONS).map(s => s.toLowerCase()), ...ARROW_LABEL_PRESETS]
      .filter(Boolean))]
    list.innerHTML = opts.map(o => `<option value="${escHtml(o)}"></option>`).join('')
  }
  const relation = byId('arrowRelation')
  if (relation) { relation.value = a.relation || ''; relation.disabled = ro }
  setText('arrowRelationHint', relationHint(a, state.blocks))
  const note = byId('arrowNoteInput')
  if (note) {
    setField(note, a.note || '', isNew)
    viewOnly(note, ro, { empty: !(a.note || '').trim() })
    autogrow(note)
  }

  // Line: geometry and dashes are separate fields, so a dashed line can
  // still be routed.
  const route = byId('arrowRouteSelect')
  if (route) { route.value = arrowRoute(a); route.disabled = ro }
  const pattern = byId('arrowPatternSelect')
  if (pattern) { pattern.value = arrowPattern(a); pattern.disabled = ro }
  const heads = byId('arrowHeadsSelect')
  if (heads) { heads.value = a.bidirectional ? 'both' : 'end'; heads.disabled = ro }
  const weight = byId('arrowWeightSelect')
  if (weight) {
    // Older arrows carry weights from the previous scale (2, 5). Show the
    // real value rather than silently snapping it to the nearest option.
    const w = Number(a.weight) || 2
    weight.querySelectorAll('option[data-current]').forEach(o => o.remove())
    if (!WEIGHTS.includes(w)) {
      const o = new Option(LEGACY_WEIGHT_NAMES[w] ? `${LEGACY_WEIGHT_NAMES[w]} (${w}px)` : `${w}px`, String(w))
      o.dataset.current = '1'
      weight.add(o)
    }
    weight.value = String(w)
    weight.disabled = ro
  }
  const colourDot = byId('arrowColourDot')
  if (colourDot) { colourDot.style.background = a.color || ''; colourDot.classList.toggle('is-empty', !a.color) }
  const colourName = a.color ? (SWATCH_NAMES[a.color] || 'Custom') : 'Default'
  setText('arrowColourText', colourName)
  byId('arrowColourBtn')?.setAttribute('aria-label', `Colour: ${colourName}`)
  setHidden(byId('arrowColourRow'), ro)

  // Connection points. An unpinned end reads as Auto; the canvas still picks
  // a side for it, but nobody has committed to one.
  document.querySelectorAll('#inspectorArrow .port-pick').forEach(group => {
    const pinned = (group.dataset.portEnd === 'from' ? a.fromPort : a.toPort) || ''
    group.querySelectorAll('[data-port-side]').forEach(btn => {
      const on = btn.dataset.portSide === pinned
      btn.classList.toggle('active', on)
      btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    })
  })
  const pins = [a.fromPort && `from ${a.fromPort}`, a.toPort && `to ${a.toPort}`].filter(Boolean)
  setText('arrowPortsHint', pins.length ? pins.join(', ') + (a.portsBy ? ` (${a.portsBy})` : '') : 'connection points: auto')
  setHidden(byId('arrowAdvanced'), ro)
  setHidden(byId('deleteArrowBtn'), ro)

  if (isNew) {
    const root = $.inspectorArrow()
    applyDisclosures(root, { 'arrow-advanced': !!((a.fromPort || a.toPort) && !a.portsBy) })
    revealFieldsIn(root)
  }
}

// ── Revealing a question ─────────────────────────────────────
/**
 * Select the block, bring the inspector into view (panels, the right panel
 * and its tab) and put the caret in question `index` (the last one when the
 * index is out of range). The context menu's Add question and the panel's
 * own + button both land here.
 */
export function focusQuestion(blockId, index = -1) {
  if (!state.blocks[blockId]) return false
  if (selection.blockId !== blockId || selection.ids.size !== 1) selectBlock(blockId)
  showPanels()
  if (byId('rightPanel')?.classList.contains('collapsed')) byId('panelReopenBtn')?.click()
  document.querySelector('.panel-tab[data-tab="inspector"]')?.click()
  // On a phone the questions sit below the fold of a half sheet. The app
  // chose full here, not the person, so deselecting puts it away.
  if (isPhoneSheet()) setSheet('full', { auto: true })
  const b = state.blocks[blockId]
  renderQuestions(b)
  setText('questionsCount', String((b.questions || []).length))
  const details = byId('questionsDetails')
  if (details && !details.open) details.open = true
  const inputs = [...($.questionsList()?.querySelectorAll('input[data-qi]') || [])]
  const target = inputs[index] || inputs[inputs.length - 1]
  if (!target) { showToast('Question added. Type it in the inspector', 'info', 2000); return false }
  target.focus()
  return true
}

// ── Menus ────────────────────────────────────────────────────
function statusMenuItems(current, onPick) {
  return [['', 'No status'], ...Object.entries(STATUS_DEFS).filter(([k]) => k !== 'not-started').map(([k, v]) => [k, v.label])]
    .map(([k, label]) => ({
      label, radio: true, checked: current === k,
      icon: `<span class="insp-menu-glyph" data-status="${k}">${escHtml(statusGlyph(k))}</span>`,
      action: () => onPick(k),
    }))
}

function priorityMenuItems(current, onPick) {
  return [{ label: 'None', radio: true, checked: current === '', action: () => onPick('') },
    ...Object.entries(PRIORITY_DEFS).map(([k, v]) => ({
      label: v.label, icon: chipIcon('priority', k), radio: true, checked: current === k, action: () => onPick(k),
    }))]
}

function highlightMenuItems(current, onPick) {
  return [{ label: 'None', radio: true, checked: !current, action: () => onPick(null) },
    ...Object.entries(HIGHLIGHTS).map(([k, h]) => ({
      label: h.label, hint: h.hint, dot: `var(--hl-${k})`, radio: true, checked: current === k, action: () => onPick(k),
    }))]
}

function colourSwatchItems(current, defaultColor, defaultLabel, onPick) {
  return [{ type: 'heading', label: 'Colour' }, {
    type: 'swatches', label: 'Colour',
    options: [{ value: 'reset', color: defaultColor, label: defaultLabel, active: !current, className: 'insp-swatch-default' },
      ...SWATCH_COLORS.map(c => ({ value: c, color: c, label: SWATCH_NAMES[c] || c, active: current === c }))],
    onPick: v => onPick(v === 'reset' ? null : v),
  }]
}

// ── Mutations ────────────────────────────────────────────────
const selectedBlock = () => (selection.blockId && state.blocks[selection.blockId]) || null
const selectedArrow = () => state.arrows.find(arr => arr.id === selection.arrowId) || null

function editBlock(changes) {
  const b = selectedBlock(); if (!b || ui.readOnly) return
  mutateBlock(b.id, changes, { undo: true })
  renderInspector()
}

// A picked type is a decision: retypeBlock (type-menu.js) clears the type
// check and a newer version's typeHint, and drops a colour that was only
// the old type's colour. Picking the same type still counts when it was a
// guess.
function setBlockType(t) {
  const b = selectedBlock(); if (!b || ui.readOnly || !TYPES[t]) return
  if (retypeBlocks([b.id], t)) renderInspector()
}

function toggleBlockAction(action) {
  const b = selectedBlock(); if (!b || ui.readOnly) return
  const actions = (b.actions || []).includes(action)
    ? b.actions.filter(a => a !== action)
    : [...(b.actions || []), action]
  editBlock({ actions })
}

function bulkEdit(changesOrFn, message) {
  const ids = [...selection.ids]
  if (!ids.length || ui.readOnly) return 0
  const n = mutateBlocks(ids, changesOrFn)
  renderInspector()
  if (n && message) showToast(message(n), 'success', 1500)
  return n
}

const plural = (n, word) => `${n} block${n === 1 ? '' : 's'}${word ? ' ' + word : ''}`

// ── Block text fields ────────────────────────────────────────
// Title, description, notes, criteria and rationale. Each typing burst in
// one field is one undo step (snapshotOnce with a per-field token), and
// leaving the field ends the burst.
const TEXT_FIELDS = [
  ['inspTitle', 'title', 'insp-title', el => el.value],
  ['inspDesc', 'description', 'insp-desc', el => el.value],
  ['inspNotes', 'notes', 'insp-notes', el => el.value],
  ['inspCriteria', 'criteria', 'insp-criteria', el => el.value.split(/\r?\n/).map(l => l.trim()).filter(Boolean)],
  ['inspRationale', 'rationale', 'insp-rationale', el => el.value],
]
const wiredTextFields = new WeakSet()
export function wireBlockTextInputs() {
  TEXT_FIELDS.forEach(([getter, key, token, read]) => {
    const el = $[getter]?.()
    if (!el || wiredTextFields.has(el)) return
    wiredTextFields.add(el)
    el.addEventListener('input', () => {
      const id = selection.blockId
      if (!id || !state.blocks[id] || ui.readOnly) return
      snapshotOnce(token + ':' + id)
      mutateBlock(id, { [key]: read(el) })
      if (key === 'notes') {
        const line = (el.value || '').trim().split(/\r?\n/)[0] || ''
        setText('notesHint', line.length > 34 ? line.slice(0, 33) + '…' : line)
      }
    })
    el.addEventListener('change', resetSnapshotToken)
  })
}

// ── Inspector panel events ───────────────────────────────────
let globalWired = false

export function setupInspectorEvents() {
  const on = (id, type, fn) => byId(id)?.addEventListener(type, fn)
  // `focusChecked`: open on the current choice, the way a native select
  // does, so a long list (the 16 types) starts scrolled to where you are.
  const dropdown = (id, build, label, { className = '', focusChecked = false } = {}) => on(id, 'click', e => {
    const btn = e.currentTarget
    if (btn.disabled) return
    const items = build()
    if (!items) return
    const menu = openDropdown(btn, items, { label, className: ('insp-menu ' + className).trim() })
    if (menu && focusChecked && !items.some(it => it.confirm)) {
      menu.el.querySelector('.pf-menu-item[aria-checked="true"]')?.focus()
    }
  })

  wireBlockTextInputs()
  document.querySelectorAll('#inspectorPane .insp-autogrow').forEach(el =>
    el.addEventListener('input', () => autogrow(el)))

  // Disclosures remember whether they were left open. The click fires before
  // the summary toggles its <details>, so the new state is the opposite.
  // Opening one also brings its controls into view: Appearance sits last, and
  // used to open below the fold, so the chips asked for were off screen.
  document.querySelectorAll('#inspectorPane details[data-disclosure] > summary').forEach(summary =>
    summary.addEventListener('click', () => {
      const d = summary.parentElement
      rememberOpen(d.dataset.disclosure, !d.open)
      if (!d.open) d.addEventListener('toggle', () => { if (d.open) revealDisclosure(d) }, { once: true })
    }))

  // ── One block: header row ──
  dropdown('inspTypeBtn', () => {
    const b = selectedBlock(); if (!b || ui.readOnly) return null
    return typeMenuItems(b.type, setBlockType, { unconfirmed: !!b.typeCheck, typeHint: b.typeHint || '' })
  }, 'Block type', { className: 'insp-type-menu', focusChecked: true })
  dropdown('inspStatusBtn', () => {
    const b = selectedBlock(); if (!b || ui.readOnly) return null
    return statusMenuItems(statusKey(b), k => editBlock({ status: k || null }))
  }, 'Status')
  dropdown('inspMoreBtn', () => {
    const b = selectedBlock(); if (!b || ui.readOnly) return null
    return [
      { label: 'Duplicate', shortcut: isMac() ? '⌘D' : 'Ctrl+D', action: () => {
        const newId = duplicateBlock(b.id)
        if (newId) selectBlock(newId)
      } },
      { type: 'divider' },
      // The panel empties, taking the focused button with it, so focus goes
      // to the canvas the block was on rather than falling to the page.
      { label: 'Delete block', shortcut: 'Del', danger: true, action: () => { deleteBlock(b.id); focusCanvas() } },
    ]
  }, 'Block actions')

  // The button hides once the block is an Assumption, so focus moves to the
  // type chip, which now says so.
  on('promoteAssumption', 'click', e => {
    const b = selectedBlock(); if (!b || ui.readOnly) return
    const hadFocus = document.activeElement === e.currentTarget
    const actions = b.actions.includes('validate') ? b.actions : [...b.actions, 'validate']
    mutateBlocks([b.id], blk => ({ ...retypeBlock(blk, 'assumption'), actions }))
    renderInspector()
    if (hadFocus) byId('inspTypeBtn')?.focus()
  })

  // The type's actions are re-rendered with the block; delegate.
  // Re-rendering replaces the buttons, so a keyboard user's focus is put
  // back on the one they pressed.
  on('typeActions', 'click', e => {
    const btn = e.target.closest('.action-toggle[data-action]')
    if (!btn || btn.disabled) return
    const action = btn.dataset.action, hadFocus = document.activeElement === btn
    toggleBlockAction(action)
    if (hadFocus) byId('typeActions')?.querySelector(`[data-action="${action}"]`)?.focus()
  })
  document.querySelectorAll('#planningDetails .action-toggle[data-action]').forEach(btn =>
    btn.addEventListener('click', () => { if (!btn.disabled) toggleBlockAction(btn.dataset.action) }))

  dropdown('inspPriorityBtn', () => {
    const b = selectedBlock(); if (!b || ui.readOnly) return null
    return priorityMenuItems(PRIORITY_DEFS[b.priority] ? b.priority : '', k => editBlock({ priority: k || null }))
  }, 'Priority')

  // ── Appearance ──
  dropdown('inspColourBtn', () => {
    const b = selectedBlock(); if (!b || ui.readOnly) return null
    return colourSwatchItems(b.color, typeColor(b.type), 'Type colour (default)', color => editBlock({ color }))
  }, 'Colour')
  dropdown('inspCardBtn', () => {
    const b = selectedBlock(); if (!b || ui.readOnly) return null
    // "Default" is a real choice, not an absent one: the block follows the
    // map, so changing the map's card style still moves it.
    const mapDefault = CARD_STYLES[canvasMeta.cardStyle]?.label || CARD_STYLES[DEFAULT_CARD_STYLE]?.label || 'Outline'
    return [
      { label: 'Map default', hint: `Follows the map (${mapDefault})`, radio: true, checked: !b.cardStyle,
        action: () => editBlock({ cardStyle: null }) },
      { type: 'divider' },
      ...pickableCardStyles().map(([k, v]) => ({ label: v.label, hint: v.hint, radio: true,
        checked: !!b.cardStyle && drawnCardStyle(b.cardStyle) === k, action: () => editBlock({ cardStyle: k }) })),
    ]
  }, 'Card style')
  dropdown('inspBorderBtn', () => {
    const b = selectedBlock(); if (!b || ui.readOnly) return null
    return [
      { label: 'Auto', hint: 'The card style decides', radio: true, checked: !b.borderWidth,
        action: () => editBlock({ borderWidth: null }) },
      ...BORDER_WIDTHS.map(w => ({ label: `${w}px`, radio: true, checked: b.borderWidth === w,
        action: () => editBlock({ borderWidth: w }) })),
    ]
  }, 'Border')
  dropdown('inspHighlightBtn', () => {
    const b = selectedBlock(); if (!b || ui.readOnly) return null
    return highlightMenuItems(b.highlight, key => editBlock({ highlight: key }))
  }, 'Highlight')

  // ── Suggestions ──
  // The button carries the fix id; the fix object (with any generic
  // `create: { type, dir }`) comes from the same getGapFixes that rendered it,
  // and applyGapFix does the work in one undo step.
  on('gapFixes', 'click', e => {
    const accept = e.target.closest('.gap-fix-accept')
    if (accept) {
      if (ui.readOnly) return
      const hadFocus = document.activeElement === accept
      acceptGap(accept.dataset.bid, accept.dataset.accept)
      renderInspector()
      // The accepted gap's row is gone: go on to the next fix, else the
      // Reopen of what was just accepted, else the top of the panel.
      if (hadFocus && !accept.isConnected) {
        (byId('gapFixes')?.querySelector('button') || byId('gapAccepted')?.querySelector('[data-reopen]') ||
          byId('inspTypeBtn'))?.focus({ preventScroll: true })
      }
      return
    }
    const btn = e.target.closest('.gap-fix-btn'); if (!btn) return
    const blockId = btn.dataset.bid; const b = state.blocks[blockId]; if (!b) return
    const fix = getGapFixes(b).find(f => f.id === btn.dataset.fix) || { id: btn.dataset.fix }
    const hadFocus = document.activeElement === btn
    applyGapFix(fix, blockId)
    // A fix that closes the gap removes its own button. When the block is
    // still the one in the panel, focus goes to the toggle the fix just set
    // (Resolve, Prepare) or back to the top of the panel. A fix that focused
    // a field, or created a block and started editing it, keeps that.
    if (hadFocus && !btn.isConnected && selection.blockId === blockId &&
        (!document.activeElement || document.activeElement === document.body)) {
      (byId('typeActions')?.querySelector(`[data-action="${CSS.escape(fix.id || '')}"]`) || byId('inspTypeBtn'))?.focus()
    }
  })
  on('gapAccepted', 'click', e => {
    const btn = e.target.closest('[data-reopen]')
    const b = selectedBlock()
    if (!btn || !b || ui.readOnly) return
    // unacceptGap drops the key once the list is empty, as normalize would.
    const hadFocus = document.activeElement === btn
    unacceptGap(b.id, btn.dataset.reopen)
    renderInspector()
    if (hadFocus && !btn.isConnected) {
      (byId('gapFixes')?.querySelector('.gap-fix-accept') || byId('gapFixes')?.querySelector('button') ||
        byId('inspTypeBtn'))?.focus({ preventScroll: true })
    }
  })

  // ── Questions ──
  on('addQuestionBtn', 'click', () => {
    const b = selectedBlock(); if (!b || ui.readOnly) return
    mutateBlock(b.id, { questions: [...(b.questions || []), { text: '' }] }, { undo: true })
    focusQuestion(b.id)
  })

  // ── Links and docs ──
  // Three inputs write one docRef object. An empty href and label clear it
  // back to null so no stray marker lingers on the card.
  const docHref = byId('docRefHref'), docLabel = byId('docRefLabel'), docAnchor = byId('docRefAnchor')
  const commitDocRef = () => {
    const b = selectedBlock(); if (!b || ui.readOnly || !docHref) return
    snapshotOnce('insp-docref:' + b.id)
    const href = docHref.value.trim()
    const label = docLabel?.value.trim() || ''
    const anchor = (docAnchor?.value.trim() || '').replace(/^#/, '')
    mutateBlock(b.id, { docRef: (href || label) ? { href, label, anchor } : null })
    setHidden(byId('docRefPreviewBtn'), !href)
    setText('docsHint', label || href)
  }
  ;[docHref, docLabel, docAnchor].forEach(el => {
    el?.addEventListener('input', commitDocRef)
    el?.addEventListener('change', resetSnapshotToken)
  })
  on('docRefPreviewBtn', 'click', e => {
    if (selection.blockId) openDocPopup(selection.blockId, e.currentTarget)
  })
  on('promoteSeeRef', 'click', () => {
    const b = selectedBlock(); if (!b || ui.readOnly) return
    const ref = detectSeeReference(b.description)
    if (ref) editBlock({ docRef: ref })
  })

  // ── Several blocks ──
  dropdown('multiTypeBtn', () => {
    if (ui.readOnly) return null
    const ids = [...selection.ids]
    const common = commonValue(ids, b => b.type) || null
    return typeMenuItems(common, t => {
      if (ui.readOnly) return
      const n = retypeBlocks([...selection.ids], t)
      renderInspector()
      if (n) showToast(`${plural(n)} set to ${TYPES[t].label}`, 'success', 1500)
    })
  }, 'Type for every selected block', { className: 'insp-type-menu', focusChecked: true })
  dropdown('multiStatusBtn', () => {
    if (ui.readOnly) return null
    const common = commonValue([...selection.ids], b => statusKey(b))
    return statusMenuItems(common === undefined ? null : common,
      k => bulkEdit({ status: k || null }, n => `${plural(n)}: ${statusLabel(k)}`))
  }, 'Status for every selected block')
  dropdown('multiPriorityBtn', () => {
    if (ui.readOnly) return null
    const common = commonValue([...selection.ids], b => (PRIORITY_DEFS[b.priority] ? b.priority : ''))
    return priorityMenuItems(common === undefined ? null : common,
      k => bulkEdit({ priority: k || null }, n => `${plural(n)}: ${k ? PRIORITY_DEFS[k].label + ' priority' : 'no priority'}`))
  }, 'Priority for every selected block')

  // Highlights: presentation emphasis, applied to the whole selection.
  on('multiHighlightRow', 'click', e => {
    const sw = e.target.closest('[data-hl]'); if (!sw || ui.readOnly) return
    const key = sw.dataset.hl || null, hadFocus = document.activeElement === sw
    bulkEdit({ highlight: key }, n => key ? `Highlighted ${plural(n)}` : `Cleared the highlight on ${plural(n)}`)
    if (hadFocus) byId('multiHighlightRow')?.querySelector(`[data-hl="${key || ''}"]`)?.focus()
  })

  // Spotlight: the emphasis is the contrast, so fade everything unmarked.
  // The same setter as View > Spotlight, so it is one undo step here too.
  on('spotlightBtn', 'click', () => {
    if (ui.readOnly) return
    const any = Object.values(state.blocks).some(b => b.highlight)
    if (!any && !canvasMeta.spotlight) {
      showToast('Highlight something first, then Spotlight fades the rest', 'info', 2400)
      return
    }
    setSpotlight(!canvasMeta.spotlight)
  })

  // The context menu's Align and Distribute run the same function.
  dropdown('multiAlignBtn', () => {
    if (ui.readOnly) return null
    const few = selection.ids.size < 2
    return [['left', 'Left edges'], ['hcenter', 'Centres (horizontal)'], ['right', 'Right edges'],
      ['top', 'Top edges'], ['vcenter', 'Middles (vertical)'], ['bottom', 'Bottom edges']].map(([mode, label]) => ({
      label, disabled: few, action: () => arrangeSelection('align', [...selection.ids], mode),
    }))
  }, 'Align')
  dropdown('multiDistributeBtn', () => {
    if (ui.readOnly) return null
    const few = selection.ids.size < 3
    return [['h', 'Horizontally', 'Even horizontal gaps'], ['v', 'Vertically', 'Even vertical gaps']].map(([axis, label, hint]) => ({
      label, hint, disabled: few, action: () => arrangeSelection('distribute', [...selection.ids], axis),
    }))
  }, 'Distribute')

  on('groupBlocksBtn', 'click', () => {
    if (selection.ids.size < 2 || ui.readOnly) return
    createGroup([...selection.ids])
  })
  on('ungroupBtn', 'click', () => {
    if (selection.groupId && !ui.readOnly) deleteGroup(selection.groupId)
  })
  on('frameLabelInput', 'input', e => {
    const gid = selection.groupId
    if (!gid || !state.groups[gid] || ui.readOnly) return
    snapshotOnce('insp-frame:' + gid)
    state.groups[gid].label = e.target.value
    renderFrames()
    debouncedSave()
  })
  on('frameLabelInput', 'change', resetSnapshotToken)
  on('deleteMultiBtn', 'click', () => {
    if (ui.readOnly) return
    const hadFocus = document.activeElement === byId('deleteMultiBtn')
    deleteBlocksBatch([...selection.ids])
    // The button went with the selection: the canvas keeps the keyboard.
    if (hadFocus) $.canvasViewport()?.focus({ preventScroll: true })
  })

  // ── One connection ──
  // Arrow edits go through mutateArrow, so each one is an undo step. Text
  // fields coalesce a typing burst with snapshotOnce and skip the inspector
  // re-render that would move the caret.
  on('arrowInfo', 'click', e => {
    const btn = e.target.closest('[data-select-block]')
    const id = btn?.dataset.selectBlock
    if (!id || !state.blocks[id]) return
    // The arrow panel gives way to the block's, taking the pressed button
    // with it: a keyboard user lands on the block's type chip instead of the
    // top of the page.
    const hadFocus = document.activeElement === btn
    const land = () => {
      const ae = document.activeElement
      if (hadFocus && selection.blockId === id && (!ae || ae === btn || ae === document.body)) byId('inspTypeBtn')?.focus()
    }
    // focusBlock pans to the block too. Loaded lazily: ui-panels imports
    // render.js, which imports this module.
    import('./ui-panels.js').then(m => { m.focusBlock(id); land() }, () => { selectBlock(id); land() })
  })
  on('arrowRelation', 'change', e => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    mutateArrow(a.id, { relation: e.target.value || null })
  })
  const arrowLabelInput = byId('arrowLabelInput')
  arrowLabelInput?.addEventListener('input', () => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    snapshotOnce('arrow-label:' + a.id)
    mutateArrow(a.id, { label: arrowLabelInput.value.trim() }, { undo: false, refreshInspector: false })
    setText('arrowRelationHint', relationHint(a, state.blocks))
  })
  arrowLabelInput?.addEventListener('change', resetSnapshotToken)
  const arrowNoteInput = byId('arrowNoteInput')
  arrowNoteInput?.addEventListener('input', () => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    snapshotOnce('arrow-note:' + a.id)
    mutateArrow(a.id, { note: arrowNoteInput.value }, { undo: false, refreshInspector: false })
  })
  arrowNoteInput?.addEventListener('change', resetSnapshotToken)

  on('arrowRouteSelect', 'change', e => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    const changes = { style: e.target.value }
    // A legacy in-memory style of 'dashed' keeps its dash as the pattern.
    if (a.style !== arrowRoute(a) && !a.pattern) changes.pattern = arrowPattern(a)
    mutateArrow(a.id, changes)
  })
  on('arrowPatternSelect', 'change', e => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    const changes = { pattern: e.target.value }
    if (a.style !== arrowRoute(a)) changes.style = arrowRoute(a)
    mutateArrow(a.id, changes)
  })
  on('arrowHeadsSelect', 'change', e => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    mutateArrow(a.id, { bidirectional: e.target.value === 'both' })
  })
  on('arrowWeightSelect', 'change', e => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    const w = parseFloat(e.target.value)
    if (Number.isFinite(w)) mutateArrow(a.id, { weight: w })
  })
  dropdown('arrowColourBtn', () => {
    const a = selectedArrow(); if (!a || ui.readOnly) return null
    return colourSwatchItems(a.color, 'var(--text-muted)', 'Default colour', color => mutateArrow(a.id, { color }))
  }, 'Connection colour')

  // Reverse (swap pinned ports too, so routing follows). The pins keep their
  // provenance: reversing is not the user choosing a side.
  on('arrowReverse', 'click', () => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    // The same refusal as the right-click menu's Reverse: a connection that
    // already runs the other way would become a second identical one, drawn
    // on top of it, and a share link or import would keep only one.
    if (state.arrows.some(x => x.id !== a.id && x.from === a.to && x.to === a.from)) {
      showToast('A connection already runs the other way. Turn on Two-way instead', 'info', 2400)
      return
    }
    const changes = { from: a.to, to: a.from, fromPort: a.toPort, toPort: a.fromPort }
    if (a.portsBy) changes.portsBy = a.portsBy
    mutateArrow(a.id, changes)
  })
  document.querySelectorAll('#inspectorArrow .port-pick').forEach(group => {
    group.querySelectorAll('[data-port-side]').forEach(btn =>
      btn.addEventListener('click', () => {
        const a = selectedArrow(); if (!a || ui.readOnly) return
        const side = btn.dataset.portSide || null
        mutateArrow(a.id, group.dataset.portEnd === 'from' ? { fromPort: side } : { toPort: side })
      }))
  })
  on('arrowAutoRoute', 'click', () => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    mutateArrow(a.id, { fromPort: null, toPort: null })
  })
  on('deleteArrowBtn', 'click', () => {
    if (!selection.arrowId || ui.readOnly) return
    const hadFocus = document.activeElement === byId('deleteArrowBtn')
    deleteArrow(selection.arrowId)
    if (hadFocus) $.canvasViewport()?.focus({ preventScroll: true })
  })

  // The panel follows the canvas. The context menu, the type check on a
  // card, a suggestion, a patch or a connection drawn to the block all change
  // it without going through here, and a stale panel is worse than a slow
  // one: a Resolve toggle left unpressed after Mark Resolved gets pressed
  // again, and that removes the action. Fields someone is typing in keep
  // their text (setField), so this is safe on every keystroke too.
  if (!globalWired) {
    globalWired = true
    window.addEventListener('pf:canvas-changed', refreshFromCanvas)
  }

  wirePaneKeys()
  setupSheet()
}

function refreshFromCanvas() {
  // mutateArrow re-renders the arrow panel itself.
  if (selection.arrowId) return
  if (selection.ids.size > 1) {
    const multi = $.inspectorMulti()
    if (multi && multi.style.display !== 'none') renderMultiInspector([...selection.ids])
    return
  }
  const b = selectedBlock()
  const content = $.inspectorContent()
  if (b && content && content.style.display !== 'none' && lastBlockId === b.id) renderBlockInspector(b)
}

function focusCanvas() {
  const vp = $.canvasViewport()
  if (vp && vp.offsetParent !== null) vp.focus({ preventScroll: true })
}

// The canvas's shortcuts listen on the document, and the panel is mostly
// buttons and disclosures now, which the shortcuts' typing check does not
// cover. Backspace on the Notes summary deleted the block; Escape on the type
// chip emptied the panel. Keys that act on the canvas stop at the panel's
// edge. Escape instead hands focus back to the canvas, keeping the selection,
// so leaving the panel from the keyboard is one key. Modified keys (undo,
// redo, duplicate) still reach the document.
function wirePaneKeys() {
  const pane = byId('inspectorPane')
  if (!pane || pane._pfKeys) return
  pane._pfKeys = true
  pane.addEventListener('keydown', e => {
    const t = e.target
    if (!t || t.closest('input, textarea, select, [contenteditable="true"]')) return
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey
    const arrow = /^Arrow/.test(e.key)
    // Space included: a canvas that pans on Space must not swallow the key
    // that presses a panel button.
    const printable = plain && e.key.length === 1
    if (e.key === 'Escape' && plain) {
      e.stopPropagation()
      focusCanvas()
      return
    }
    if (((e.key === 'Delete' || e.key === 'Backspace') && plain) || arrow || printable) e.stopPropagation()
  })
}

// ── Phone sheet ──────────────────────────────────────────────
// At 700px and under the right panel is a bottom sheet (its rules close
// the [inspector] section of style.css). #rightPanel[data-sheet] holds one
// of three states: 'peek' is the handle row alone, 'half' comes up when a
// card is selected, with its Title in view, 'full' is about 85% of the
// screen. The handle names the selection; a tap on it expands to full or
// collapses, a drag resizes it, Escape collapses it. Above 700px the
// attribute is still kept, but no rule reads it, so desktop and tablet are
// unchanged.

export const SHEET_STATES = ['peek', 'half', 'full']
// `force` pins phone mode on or off (the suite runs at desktop width).
// `openDelay` is how long a tap on a card waits before the sheet comes up,
// so the second tap of a double-tap (edit the title on the card) still
// lands on the card rather than on a sheet or a moved camera.
// `short` pins the short-screen check the same way. `media` is the phone
// query's MediaQueryList once the sheet is wired. `auto` is true while the
// sheet is full because the app put it there (a text field took focus, Add
// question) rather than the person pulling it up: deselecting then puts it
// away, as it does a half sheet.
export const sheet = { state: 'peek', force: null, short: null, openDelay: 300, media: null, auto: false }
const PHONE_QUERY = '(max-width: 700px)'
// A phone on its side: a half sheet tall enough to show the Title leaves no
// canvas above it, so a tap does not bring the sheet up there (the handle
// still does). The CSS drops the half sheet's floor under the same query.
const SHORT_QUERY = '(max-width: 700px) and (max-height: 500px)'
const TAP_SLOP = 8         // px a finger may wander and still be a tap

/**
 * True when the right panel is a bottom sheet on screen now: 700px and
 * under, and the panel is drawn. Zen hides it (chrome.js) and an embed
 * never shows it; a sheet nobody can see must not move the camera or take
 * Escape from the canvas.
 */
export function isPhoneSheet() {
  const phone = sheet.force !== null ? sheet.force : !!window.matchMedia?.(PHONE_QUERY).matches
  if (!phone || ui.embed) return false
  const panel = byId('rightPanel')
  return !!panel && panel.getClientRects().length > 0
}

function isShortSheet() {
  if (sheet.short !== null) return sheet.short
  return !!window.matchMedia?.(SHORT_QUERY).matches
}

let sheetKey = ''          // the selection the sheet last reacted to
let pendingOpen = null     // a selection waiting for its tap to finish
let openTimer = 0
let eatClick = false       // the click a handle drag leaves behind
let comparing = false
let sheetWired = false
const pointersDown = new Map()   // pointerId -> where and on what it went down
// The pointers down now are a pan, a pinch or a drag rather than a tap: one
// of them moved past the slop, or a second came down while one was held.
let gesture = false

function selectionKey() {
  if (selection.ids.size > 1) return 'multi:' + selection.ids.size
  if (selection.arrowId) return 'arrow:' + selection.arrowId
  if (selection.blockId && state.blocks[selection.blockId]) return 'block:' + selection.blockId
  return ''
}

// The heights live in CSS (--sheet-peek, --sheet-half, --sheet-full). A
// probe reads what they come to on this screen, so they are never restated.
function sheetHeight(which) {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;height:var(--sheet-' + which + ')'
  document.body.appendChild(probe)
  const h = probe.getBoundingClientRect().height
  probe.remove()
  return h
}

// The handle row: the selected card's type dot and title, or what else is
// selected, or "Nothing selected".
function paintHandle() {
  const title = byId('sheetTitle')
  if (!title) return
  const dot = byId('sheetDot'), kind = byId('sheetKind')
  let text = 'Nothing selected', kindText = '', color = '', mark = 'empty', shape = 'dot'
  const b = selection.ids.size === 1 && selection.blockId ? state.blocks[selection.blockId] : null
  if (document.body.classList.contains('comparing-snapshot')) { text = 'Snapshot comparison'; mark = 'none' }
  else if (selection.ids.size > 1) { text = selection.ids.size + ' blocks selected'; mark = 'none' }
  else if (selection.arrowId) {
    const a = selectedArrow()
    const end = id => state.blocks[id]?.title || 'Untitled'
    text = a ? end(a.from) + ' → ' + end(a.to) : 'Connection'
    kindText = 'Connection: '; mark = 'none'
  } else if (b) {
    text = b.title || 'Untitled'
    kindText = (TYPES[b.type] || TYPES.custom).label + ': '
    color = typeColor(b.type); mark = 'type'; shape = typeShape(b.type)
  }
  if (title.textContent !== text) title.textContent = text
  title.classList.toggle('is-empty', mark === 'empty')
  if (kind && kind.textContent !== kindText) kind.textContent = kindText
  if (dot) {
    dot.hidden = mark === 'none'
    dot.classList.toggle('is-empty', mark === 'empty')
    dot.style.background = color
    dot.dataset.shape = shape
  }
}

/**
 * Put the sheet in `next` ('peek', 'half' or 'full'). `reveal` moves the
 * camera so the selected card is not under it. `auto` marks a full sheet
 * the app chose rather than the person (see `sheet.auto`).
 */
export function setSheet(next, { reveal = false, auto = false } = {}) {
  const panel = byId('rightPanel')
  if (!panel || !SHEET_STATES.includes(next)) return false
  const handle = byId('sheetHandle')
  // Collapsing hides whatever had focus in the sheet: hand it to the
  // handle rather than drop it on the page.
  if (next === 'peek' && handle && isPhoneSheet() &&
      panel.contains(document.activeElement) && document.activeElement !== handle) {
    handle.focus({ preventScroll: true })
  }
  sheet.state = next
  sheet.auto = auto && next === 'full'
  panel.dataset.sheet = next
  handle?.setAttribute('aria-expanded', String(next !== 'peek'))
  setText('sheetAction', next === 'full' ? '. Collapse details' : '. Expand details')
  if (reveal && next !== 'peek') revealSelection(next)
  return true
}

/** Where the sheet is: 'peek', 'half' or 'full'. */
export function sheetState() { return sheet.state }

// A card the sheet is about to cover moves into the strip of canvas left
// above it. Only the camera moves; the map does not change.
function revealSelection(which) {
  if (!selection.blockId || selection.ids.size !== 1) return
  const el = getBlockEl(selection.blockId), vp = $.canvasViewport()
  if (!el || !vp) return
  const r = el.getBoundingClientRect(), v = vp.getBoundingClientRect()
  const top = v.top + 12, left = v.left + 12, right = v.right - 12
  const bottom = Math.min(v.bottom, window.innerHeight - sheetHeight(which)) - 12
  if (bottom - top < 48 || right - left < 48) return
  let dx = 0, dy = 0
  // Centred in the strip when it fits, otherwise its head in view.
  if (r.top < top || r.bottom > bottom) dy = r.height <= bottom - top ? (top + bottom - r.top - r.bottom) / 2 : top - r.top
  if (r.left < left || r.right > right) dx = r.width <= right - left ? (left + right - r.left - r.right) / 2 : left - r.left
  if (dx || dy) animateView(view.panX + dx, view.panY + dy, view.zoom)
}

const editingOnCanvas = () => !!document.querySelector('.block [contenteditable="true"], .arrow-edit')

function scheduleOpen() {
  clearTimeout(openTimer)
  if (pendingOpen) openTimer = setTimeout(tryOpen, sheet.openDelay)
}

// A tap on a card or a line (not on one of its controls) asks to inspect
// it, even when it was selected already: the sheet may have been put away.
const CARD_CONTROLS = '[data-canvas-ui], button, a[href], .port, .block-resize-handle'
function noteTap(target) {
  if (!isPhoneSheet() || sheet.state !== 'peek' || !(target instanceof Element)) return
  if (!target.closest('#canvasViewport') || !target.closest('.block, [data-aid]')) return
  if (target.closest(CARD_CONTROLS + ', [contenteditable="true"]')) return
  const key = selectionKey()
  if (!key || key.startsWith('multi:')) return
  const b = selection.blockId ? state.blocks[selection.blockId] : null
  pendingOpen = { key, blockId: b ? b.id : null, x: b?.x, y: b?.y }
}

// What a selection asks of the sheet once its tap (if any) is over: a
// collapsed sheet comes up to half; a sheet already up moves the camera so
// the new card is not under it (keyboard focus included, WCAG 2.4.11).
function tryOpen() {
  const p = pendingOpen
  if (!p || pointersDown.size) return          // the pointerup schedules it again
  pendingOpen = null
  if (!isPhoneSheet() || p.key !== selectionKey()) return
  // Whatever the tap started (a title edit, the quick-add picker from a
  // port) keeps the screen.
  if (editingOnCanvas() || isMenuOpen()) return
  // A press that moved the card was a drag, not a request to inspect it.
  const b = p.blockId ? state.blocks[p.blockId] : null
  if (b && (b.x !== p.x || b.y !== p.y)) return
  if (sheet.state !== 'peek') { if (p.reveal) revealSelection(sheet.state); return }
  // In dot voting a tap is a vote: the voter wants the canvas, not details.
  if (ui.votingMode) return
  // On a phone on its side the half sheet would cover the whole canvas.
  if (isShortSheet()) return
  // On a view-only link, selecting a card is how a reviewer aims the review
  // bar at the foot of the canvas, which a half sheet would cover. The
  // handle names the card; a tap on it shows the details.
  const reviewBar = byId('reviewBar')
  if (reviewBar && reviewBar.offsetParent !== null) return
  if (ui.activeTab !== 'inspector' && !document.body.classList.contains('comparing-snapshot')) {
    document.querySelector('.panel-tab[data-tab="inspector"]')?.click()
  }
  const content = byId('panelContent')
  if (content) content.scrollTop = 0
  setSheet('half', { reveal: true })
}

/**
 * Keep the sheet in step with the selection (renderInspector calls this).
 * Selecting a card or a line brings a collapsed sheet up to half, once the
 * tap is over, and a sheet already up brings the new card into view above
 * it; deselecting puts a half sheet on the Inspector away again, and a full
 * one the app chose.
 */
export function syncSheet() {
  if (!byId('rightPanel')) return
  paintHandle()
  const key = selectionKey()
  if (key === sheetKey) return
  sheetKey = key
  if (!key) {
    pendingOpen = null
    clearTimeout(openTimer)
    const away = sheet.state === 'half' || (sheet.state === 'full' && sheet.auto)
    if (away && isPhoneSheet() && ui.activeTab === 'inspector') setSheet('peek')
    return
  }
  if (!isPhoneSheet() || key.startsWith('multi:')) { pendingOpen = null; return }
  // Another card on the Inspector starts at its top, where the Title is,
  // not at the scroll position the last one was left at.
  const content = byId('panelContent')
  if (content && ui.activeTab === 'inspector') content.scrollTop = 0
  const b = selection.blockId ? state.blocks[selection.blockId] : null
  pendingOpen = { key, blockId: b ? b.id : null, x: b?.x, y: b?.y, reveal: sheet.state !== 'peek' }
  scheduleOpen()
}

// Escape collapses an open sheet before it does anything else, as long as
// nothing more on top has a claim on it: a menu, a dialog, the doc preview,
// the search, the shortcut sheet, dot voting, a card or line being edited,
// or a snapshot comparison being worked in. This listener runs on the
// window in the capture phase, ahead of every other Escape handler, so
// each of those has to be named here or it never sees the key.
const COMPARISON_PARTS = '#comparisonHeader, #comparisonBar, #comparisonPane'
function onSheetEscape(e) {
  if (e.key !== 'Escape' || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
  if (!isPhoneSheet() || sheet.state === 'peek') return
  const panel = byId('rightPanel')
  if (!panel) return
  const t = e.target
  const inPanel = t instanceof Node && panel.contains(t)
  const onPage = t === document.body || t === document.documentElement || !!t?.closest?.('#canvasViewport')
  if (!inPanel && !onPage) return
  if (isMenuOpen() || ui.searchOpen || ui.votingMode || editingOnCanvas()) return
  if (document.querySelector('dialog[open], .doc-popup')) return
  // The comparison's own controls close it on Escape (comparison-ui.js).
  if (document.body.classList.contains('comparing-snapshot') && t?.closest?.(COMPARISON_PARTS)) return
  const help = byId('shortcutOverlay')
  if (help && help.style.display !== 'none') return
  e.preventDefault()
  e.stopPropagation()
  setSheet('peek')
}

// Drag the handle to resize. On release a quick flick goes all the way it
// was thrown (up to full, down to collapsed) and a slower drag settles on
// the nearest state. The move and release are followed on the window
// rather than through pointer capture: a touch is already captured by
// whichever span of the handle it landed on, and moving that capture to
// the button fired lostpointercapture from the span one move into every
// drag.
const FLICK = 0.6   // px per ms: faster than this at release is a flick
function wireSheetDrag(panel, handle) {
  let drag = null
  // Let go of a drag without settling anywhere new (its release never came).
  const drop = () => {
    drag = null
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    panel.classList.remove('sheet-dragging')
    panel.style.height = ''
  }
  const move = e => {
    if (!drag || e.pointerId !== drag.id) return
    const dy = e.clientY - drag.y0
    if (!drag.moved) {
      if (Math.abs(dy) < 6) return
      drag.moved = true
      panel.classList.add('sheet-dragging')
    }
    panel.style.height = Math.max(drag.min, Math.min(drag.max, drag.h0 - dy)) + 'px'
    drag.trail.push({ y: e.clientY, t: e.timeStamp })
    if (drag.trail.length > 6) drag.trail.shift()
  }
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return
    const d = drag
    const h = panel.getBoundingClientRect().height
    drop()
    if (!d.moved) return                        // a tap: the click toggles
    // The click a mouse sends after its drag must not toggle the sheet as
    // well. A touch drag sends none, so this is not a time window (that ate
    // a real tap made soon after): the next press or key on the handle
    // clears it.
    eatClick = true
    const a = d.trail[0], z = d.trail[d.trail.length - 1]
    const speed = (z.y - a.y) / Math.max(16, z.t - a.t)   // px per ms over the last few moves, down is positive
    const heights = { peek: d.min, half: sheetHeight('half'), full: d.max }
    const best = speed < -FLICK ? 'full' : speed > FLICK ? 'peek'
      : SHEET_STATES.reduce((m, k) => Math.abs(heights[k] - h) < Math.abs(heights[m] - h) ? k : m)
    setSheet(best)
  }
  window.addEventListener('blur', () => { if (drag) drop() })
  handle.addEventListener('pointerdown', e => {
    eatClick = false
    if (drag && e.isPrimary) drop()
    if (drag || !isPhoneSheet() || (e.pointerType === 'mouse' && e.button !== 0)) return
    drag = { id: e.pointerId, y0: e.clientY, h0: panel.getBoundingClientRect().height, moved: false,
             min: sheetHeight('peek'), max: sheetHeight('full'), trail: [{ y: e.clientY, t: e.timeStamp }] }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  })
}

function onBodyClass() {
  const now = document.body.classList.contains('comparing-snapshot')
  if (now === comparing) return
  comparing = now
  paintHandle()
  if (!isPhoneSheet()) return
  // A snapshot comparison lives in the panel: bring it up, put it away after.
  if (!now) { setSheet('peek'); return }
  if (sheet.state === 'peek') setSheet('half')
  // openComparison focused its Close button while the sheet was still
  // collapsed, which hides it, so the focus never landed and its Escape
  // could not close the comparison. Now it is in view, finish that move.
  const panel = byId('rightPanel'), close = byId('comparisonClose')
  if (close && panel && !panel.contains(document.activeElement)) close.focus({ preventScroll: true })
}

/** Wire the phone sheet. Safe to call again; a panel is wired once. */
export function setupSheet() {
  const panel = byId('rightPanel'), handle = byId('sheetHandle')
  if (!panel || !handle || panel._pfSheet) return
  panel._pfSheet = true
  setSheet(SHEET_STATES.includes(panel.dataset.sheet) ? panel.dataset.sheet : 'peek')
  sheetKey = selectionKey()
  comparing = document.body.classList.contains('comparing-snapshot')

  handle.addEventListener('click', () => {
    if (eatClick) { eatClick = false; return }
    setSheet(sheet.state === 'full' ? 'peek' : 'full')
  })
  // From the keyboard, Up and Down step through the three states.
  handle.addEventListener('keydown', e => {
    eatClick = false                  // Enter and Space click: never eaten
    const step = { ArrowUp: 1, ArrowDown: -1 }[e.key]
    if (!step || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault(); e.stopPropagation()
    const i = SHEET_STATES.indexOf(sheet.state) + step
    setSheet(SHEET_STATES[Math.max(0, Math.min(SHEET_STATES.length - 1, i))])
  })
  wireSheetDrag(panel, handle)
  // A text field low in a half sheet is where a phone keyboard comes up:
  // typing gets the full sheet, with the field near the top.
  panel.addEventListener('focusin', e => {
    if (!isPhoneSheet() || sheet.state !== 'half') return
    const field = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]), textarea, [contenteditable="true"]'
    if (e.target.matches?.(field)) setSheet('full', { auto: true })
  })
  paintHandle()

  if (sheetWired) return
  sheetWired = true
  window.addEventListener('keydown', onSheetEscape, true)
  // The press on a card or a line selects it (events.js), which queues the
  // open; what the pointers do before they all lift decides whether it was
  // a tap. A pinch or a pan that starts on a card never moves the card, so
  // the card's position alone cannot tell.
  const far = (e, down) => Math.hypot(e.clientX - down.x, e.clientY - down.y) >= TAP_SLOP
  document.addEventListener('pointerdown', e => {
    // A new primary pointer means every earlier one has ended, even one
    // whose pointerup never came: a stale entry would hold the sheet down.
    if (e.isPrimary) { pointersDown.clear(); gesture = false }
    if (pointersDown.size) gesture = true       // a second finger: a pinch
    pointersDown.set(e.pointerId, { x: e.clientX, y: e.clientY, target: e.target })
  }, true)
  document.addEventListener('pointermove', e => {
    const down = !gesture && pointersDown.get(e.pointerId)
    if (down && far(e, down)) gesture = true
  }, true)
  // The last pointer up: a tap opens what it selected, anything else drops it.
  const settle = () => {
    if (!gesture) { scheduleOpen(); return }
    gesture = false
    pendingOpen = null
    clearTimeout(openTimer)
  }
  const up = e => {
    const down = pointersDown.get(e.pointerId)
    if (!pointersDown.delete(e.pointerId)) return
    // Cancelled means the browser took the gesture over.
    if (e.type === 'pointercancel' || far(e, down)) gesture = true
    if (!gesture) noteTap(down.target)
    if (!pointersDown.size) settle()
  }
  document.addEventListener('pointerup', up, true)
  document.addEventListener('pointercancel', up, true)
  // A tap meant for a card's own control (collapse, the doc badge, a port)
  // is not a request to inspect the card. Touch adjustment can send the
  // press and release to the card's header while the click lands on the
  // control, so the click, not the pointerup, is where that shows.
  document.addEventListener('click', e => {
    const t = e.target
    if (!pendingOpen || !(t instanceof Element) || !t.closest('#canvasViewport')) return
    if (!t.closest(CARD_CONTROLS)) return
    pendingOpen = null
    clearTimeout(openTimer)
  }, true)
  window.addEventListener('blur', () => { pointersDown.clear(); settle() })
  window.addEventListener('pf:canvas-changed', paintHandle)
  // Crossing 700px either way starts the sheet collapsed.
  sheet.media = window.matchMedia?.(PHONE_QUERY) || null
  sheet.media?.addEventListener?.('change', () => setSheet('peek'))
  new MutationObserver(onBodyClass).observe(document.body, { attributes: true, attributeFilter: ['class'] })
}
