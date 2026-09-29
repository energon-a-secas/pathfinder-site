// ════════════════════════════════════════════════════════════
//  classify.js: text to typed blocks. The line classifier, outline
//  parser, paste handler, Brain Dump card and the type check that
//  follows an import (a button on the card's type label).
// ════════════════════════════════════════════════════════════

import { state, ui, view, selection, snapshot, debouncedSave } from './state.js'
import { $, genId, getBlockEl, showToast, TYPES, DEFAULT_WIDTH } from './utils.js'
import { renderArrows, updateHint } from './canvas.js'
import { renderAllBlocks, mutateBlocks, renderInspector } from './render.js'
import { runGapDetection } from './gaps.js'
import { openDropdown, isMenuOpen } from './menu.js'
import { modalDialogOpen } from './navigation.js'
import { typeMenuItems, retypeBlocks } from './type-menu.js'

// ── Text → blocks classification ─────────────────────────────
//
// Explicit "goal:"-style prefixes still win outright. Otherwise we strip a
// leading first-person/article ("we need…", "the API…") and SCORE the whole
// line against weighted keyword sets so natural prose lands on a real type
// instead of dumping into the gray 'custom' bucket.
const PREFIX_PATTERNS = [
  { re: /^(goal|objective|aim|target|vision)[:.]\s*/i,         type: 'goal' },
  { re: /^(problem|issue|blocker|bug|pain|challenge)[:.]\s*/i, type: 'problem' },
  { re: /^(risk|concern|danger|threat)[:.]\s*/i,               type: 'risk' },
  { re: /^(assum(e|ption)|belief|hypothesis)[:.]\s*/i,         type: 'assumption' },
  { re: /^(need|req(uirement)?|must|should|shall)[:.]\s*/i,    type: 'requirement' },
  { re: /^(decision|decided|chose|choice)[:.]\s*/i,            type: 'decision' },
  { re: /^(resource|system|team|tool|asset|budget)[:.]\s*/i,   type: 'resource' },
  { re: /^(output|deliverable|result|outcome)[:.]\s*/i,        type: 'output' },
  { re: /^(context|background|note|info|status)[:.]\s*/i,      type: 'context' },
  { re: /^(question)[:.]\s*/i,                                 type: 'question' },
  { re: /^(action|step|process|task|do)[:.]\s*/i,             type: 'process' },
  { re: /^(start|end|begin|finish|done|trigger)[:.]\s*/i,     type: 'terminator' },
  { re: /^(metric|kpi|okr|kr|key result|measure)[:.]\s*/i,     type: 'metric' },
  { re: /^(stakeholder|audience|sponsor|who)[:.]\s*/i,         type: 'stakeholder' },
  { re: /^(implementation|implement|build|work|epic|initiative)[:.]\s*/i, type: 'implementation' },
]

const UNITS = '(day|week|month|quarter|year|sprint|release|morning|evening|monday|tuesday|wednesday|thursday|friday)'
const CADENCE_ANYWHERE = new RegExp(`\\b(every|each)\\s+(end|${UNITS})\\b|\\bend of (the )?${UNITS}\\b|\\b${UNITS}['’]?s end\\b`, 'i')
const CADENCE_WHOLE = new RegExp(`^((on|at)\\s+)?((every|each)\\s+(end of (the )?)?${UNITS}(\\s+end)?|(the\\s+)?(end of (the )?${UNITS}|${UNITS}['’]?s end))$`, 'i')
const AUDIENCE_WORDS = '(executives?|stakeholders?|customers?|leadership|owners?|team leads?|sponsors?)'
const AUDIENCE = new RegExp(`\\b${AUDIENCE_WORDS}\\b`, 'i')
const AUDIENCE_WHOLE = new RegExp(`^${AUDIENCE_WORDS}(\\s+(team|group|committee|board|council))?$`, 'i')

// Weighted keyword cues. Each entry: [regex, points]. Highest-scoring type wins.
// On a tie the earlier type wins, which is why the three newer types come
// last: a line that already classified one way keeps doing so, and they only
// take lines nothing else claimed or claimed weakly. Nouns are plural-safe
// ("Reports", "Key Results"): the singular-only cues sent both to Other.
const SCORE_RULES = {
  requirement: [[/\b(need|needs|must|should|shall|require[sd]?|has to|have to)\b/i, 3], [/\b(support|enable|provide|allow)\b/i, 1]],
  assumption:  [[/\b(assume|assuming|assumption|expect|expects|presumably|likely|probably|i think|we think|believe)\b/i, 3], [/\bwill\s+\w+/i, 2], [/\b(should be fine|hopefully)\b/i, 2]],
  risk:        [[/\b(risks?|concerns?|danger|threats?|worried|might fail|could fail|fragile|breaks?|vulnerab)\b/i, 3], [/\b(if .* fails|single point of failure)\b/i, 2]],
  goal:        [[/\b(goals?|objectives?|aim|vision|want to|increase|reduce|improve|grow|launch|ship|achieve|reach)\b/i, 3]],
  problem:     [[/\b(problems?|issues?|blockers?|bugs?|broken|pain|can't|cannot|doesn't work|failing|slow|outage)\b/i, 3], [/\b(latency|exceeds?|over (our )?sla|breach(es|ing)?|too slow|error rate|downtime)\b/i, 3],
                // "Build fails on main" is a red pipeline, not work to do.
                [/^(build|pipeline|ci|deploy(ment)?|tests?)\s+(is\s+|are\s+|was\s+|keeps\s+)?(fail(s|ed|ing)?|broken|red|flaky)\b/i, 3]],
  decision:    [[/\b(decided|decision|chose|choose|chosen|go with|pick(ed)?|settle[d]? on|opt(ed)? for)\b/i, 3]],
  // Named systems ("Data Central", "Partner Portal") are resources too.
  resource:    [[/\b(teams?|budgets?|tools?|assets?|librar(y|ies)|apis?|services?|credits?|headcount|engineers?|designers?|systems?|platforms?|databases?|data sources?|warehouses?|central|hubs?|portals?)\b/i, 1]],
  output:      [[/\b(deliverables?|outputs?|results?|outcomes?|artifacts?|reports?|doc(s|umentation)?|deploy|releases?)\b/i, 2]],
  context:     [[/\b(background|context|currently|today|historically|note that|fyi|for reference)\b/i, 2]],
  // `set up` is building something, not a step: leave it to implementation.
  process:     [[/^(update|create|add|send|generate|assign|review|submit|move|set(?!\s+up\b)|mark|run|trigger|notify)\b/i, 3], [/\b(step \d|then\b)/i, 1]],
  // A cadence ("every end of sprint", "on quarter's end") is what starts a
  // flow. A bare "weekly" is not: "Weekly reports" are an output. Only a
  // title that IS the cadence is a confident trigger: "Every week we lose
  // two customers" mentions one, and a mention alone is a hint (1 point).
  terminator:  [[/^(start|begin|end|finish|done|complete[d]?)\b/i, 3],
                [CADENCE_ANYWHERE, 1],
                [CADENCE_WHOLE, 2]],
  metric:      [[/\b(kpis?|okrs?|metrics?|key results?|slas?|slos?|nps)\b/i, 3], [/%|\b(rates?|targets?|baselines?|percent(age)?)\b/i, 2]],
  // A leading "build" is work unless the build is the subject ("Build
  // fails on main") or its object is not a thing ("Build trust with ...").
  implementation: [[/^(implement|integrate|migrate|automate|set up|(build|develop)(?!\s+(fails?|failed|failing|broke|broken|breaks|is|was|keeps|still|red|trust|relationships?|rapport|confidence|consensus|momentum|awareness|credibility|loyalty|reputation|culture)\b))\b/i, 3],
                   [/\b(implement(s|ed|ing|ation)?|integrat(e|es|ed|ing|ion|ions)|migrat(e|es|ed|ing|ion)|automat(e|es|ed|ing|ion))\b/i, 2]],
  // An audience word anywhere is a weak cue (2): "Customers will pay for
  // this" is a belief and "Customer churn above 5%" a metric, and both tie
  // back to the earlier type. Only a title that names the audience outright
  // ("Customers", "Leadership team") is a confident stakeholder.
  stakeholder: [[AUDIENCE, 2], [AUDIENCE_WHOLE, 1]],
}

const LEADING_FILLER = /^(we|i|the|our|they|it|this|that|there)\s+/i

/**
 * Classify one raw line into { type, title, confidence }.
 * confidence: 'high' (explicit prefix or strong score) | 'low' (weak/none).
 * A title alone cannot always carry its type: of the eleven reporting-flow
 * titles in tests/types-registry.test.js, two still land on Other and one
 * reads as a trigger where its author meant a report, which is why
 * low-confidence calls ask to be checked.
 */
export function categorizeLine(raw) {
  const line = raw.replace(/^\s*[-*•]\s+/, '').replace(/^\s*\d+\.\s+/, '').trim()

  // 1. Explicit prefix: authoritative.
  for (const { re, type } of PREFIX_PATTERNS) {
    const m = line.match(re)
    if (m) return { type, title: line.slice(m[0].length).trim() || line, confidence: 'high' }
  }

  // 2. A trailing "?" is a genuine question unless it reads as a belief.
  const looksAssumed = /\b(assume|assuming|expect|believe|will work|should be|probably|likely)\b/i.test(line)
  if (line.endsWith('?') && !looksAssumed) {
    return { type: 'question', title: line, confidence: 'high' }
  }

  // 3. Score the whole line (filler-stripped) against keyword cues.
  const probe = line.replace(LEADING_FILLER, '')
  let best = { type: 'custom', score: 0 }
  for (const [type, rules] of Object.entries(SCORE_RULES)) {
    let score = 0
    for (const [re, pts] of rules) if (re.test(probe)) score += pts
    if (score > best.score) best = { type, score }
  }

  if (best.score >= 3) return { type: best.type, title: line, confidence: 'high' }
  if (best.score >= 1) return { type: best.type, title: line, confidence: 'low' }
  return { type: 'custom', title: line, confidence: 'low' }
}

/**
 * Parse freeform text into an outline: top-level lines become blocks, while
 * more-indented or bulleted lines beneath them fold into that block's
 * description. A line is a child only when it is "deeper" than the current
 * block, so a flat bullet list (all same depth) still becomes sibling blocks.
 *
 * Depth = indentUnits*10 + (isBullet ? 1 : 0), where two spaces or one tab is
 * one indent unit. This lets "Header / - bullet / - bullet" nest without
 * requiring the bullets to be spatially indented.
 */
export function parseOutline(text) {
  const MARKER = /^(\s*)([-*•]|\d+[.)])?\s*/
  const items = []          // { line, description: [lines] }
  let current = null, currentDepth = 0
  text.split(/\r?\n/).forEach(raw => {
    if (!raw.trim()) return
    const m = raw.match(MARKER)
    const ws = (m[1] || '').replace(/\t/g, '  ')
    const isBullet = !!m[2]
    const depth = Math.floor(ws.length / 2) * 10 + (isBullet ? 1 : 0)
    const content = raw.slice(m[0].length).trim()
    if (!content) return
    if (current && depth > currentDepth) {
      current.description.push(isBullet ? '• ' + content : content)
    } else {
      current = { line: content, description: [] }
      currentDepth = depth
      items.push(current)
    }
  })
  return items
}

/**
 * Turn freeform text into a column of typed blocks. Shared by the paste
 * handler and the Brain Dump card. Returns the array of created block ids.
 * When `nest` is true (default), indented/bulleted lines fold into the
 * description of the block above them.
 */
export function createBlocksFromText(text, nest = true) {
  const items = nest
    ? parseOutline(text)
    : text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => ({ line, description: [] }))
  if (!items.length) return []

  const vp = $.canvasViewport()
  const r  = vp.getBoundingClientRect()
  const cx = (r.width  / 2 - view.panX) / view.zoom - DEFAULT_WIDTH / 2
  const cy = (r.height / 2 - view.panY) / view.zoom - (items.length * 90) / 2

  snapshot()
  const created = []
  items.forEach((item, i) => {
    const { type, title, confidence } = categorizeLine(item.line)
    const id = genId()
    state.blocks[id] = {
      id, type, title, description: item.description.join('\n'), notes: '',
      x: cx, y: cy + i * 90,
      actions: [], questions: [],
      docRef: null,
      width: null, color: null, collapsed: false, groupId: null,
      status: null, priority: null,
    }
    // A guess the classifier was not sure of waits for a person to confirm
    // it, and says so on the card, instead of passing as a real type.
    if (confidence === 'low') state.blocks[id].typeCheck = true
    created.push({ id, confidence })
  })

  renderAllBlocks()
  renderArrows()
  runGapDetection()
  updateHint()
  debouncedSave()
  ui.promptDirty = true
  showTypeChips(created)
  showToast(`Created ${created.length} block${created.length > 1 ? 's' : ''}`)
  return created.map(c => c.id)
}

let pasteWired = false
export function setupPasteHandler() {
  if (pasteWired) return
  pasteWired = true
  document.addEventListener('paste', e => {
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.contentEditable === 'true') return
    if (ui.readOnly) return
    // A modal dialog (the incoming-link chooser), an open menu or the
    // shortcut sheet owns the keyboard: nothing lands on the map behind it.
    if (modalDialogOpen() || isMenuOpen() || e.target?.closest?.('dialog, .pf-menu, #shortcutOverlay')) return
    const sheet = document.getElementById('shortcutOverlay')
    if (sheet && sheet.style.display !== 'none' && sheet.getAttribute('aria-modal') === 'true') return
    const text = e.clipboardData?.getData('text/plain')
    if (!text?.trim()) return
    e.preventDefault()
    createBlocksFromText(text)
  })
}

// ── Type check on the card ───────────────────────────────────
//
// A type the classifier was unsure of is marked `typeCheck` on the block, and
// the card's type label becomes a button (renderBlock). Clicking it opens the
// type menu with "Looks right" first; either choice clears the mark in one
// undo step. This replaced chips floated above the cards, which covered their
// neighbours, never dimmed, vanished on the next press anywhere and lost
// their clicks to the viewport.

/**
 * Mark the low-confidence blocks among `created` ([{ id, confidence }]) as
 * awaiting a type check. Metadata only, so no undo step of its own: the
 * import or Brain Dump that created them already took one. The name is the
 * old one because the importers and the `pf:show-type-chips` event use it.
 */
export function showTypeChips(created) {
  if (ui.readOnly) return 0
  const ids = (Array.isArray(created) ? created : [])
    .filter(c => c && c.confidence === 'low' && state.blocks[c.id] && !state.blocks[c.id].typeCheck)
    .map(c => c.id)
  if (ids.length) mutateBlocks(ids, { typeCheck: true }, { undo: false })
  return ids.length
}

/**
 * Settle a block's type check: confirm the type it has (no `type`), or change
 * it. Either way the mark goes, as one undo step, by the rule every type
 * picker shares (retypeBlock). Returns false when there was nothing to do.
 */
export function resolveTypeCheck(id, type = null) {
  const b = state.blocks[id]
  if (!b || ui.readOnly) return false
  if (type && !Object.hasOwn(TYPES, type)) return false
  if (!b.typeCheck && (!type || type === b.type)) return false
  retypeBlocks([id], type)
  // The inspector shows the type too; the retype leaves it to the caller.
  if (selection.ids.has(id)) renderInspector()
  return true
}

// The card re-renders, so the button that had focus is gone: hand focus to
// the card rather than dropping it on the page.
function refocusCard(id) {
  const ae = document.activeElement
  if (!ae || ae === document.body) getBlockEl(id)?.focus({ preventScroll: true })
}

// The compact form of the shared type list: "Looks right", then one row per
// step opening its types, so the menu hung off a small label never covers
// its own card (all sixteen under headings stood about 790px tall).
function typeCheckItems(id) {
  const b = state.blocks[id]
  return typeMenuItems(b.type, type => { resolveTypeCheck(id, type); refocusCard(id) },
    { unconfirmed: true, steps: true, typeHint: b.typeHint || '' })
}

/** Open the type menu under a card's type-check button. */
export function openTypeChipMenu(anchor) {
  const id = anchor?.dataset?.typeCheck
  if (!id || !state.blocks[id] || ui.readOnly) return null
  return openDropdown(anchor, typeCheckItems(id), { label: 'Block type', className: 'type-check-menu' })
}

// ── Brain Dump empty state ───────────────────────────────────
export function setupBrainDump() {
  const btn   = document.getElementById('brainDumpBtn')
  const input = document.getElementById('brainDumpInput')
  if (!btn || !input) return
  const nestToggle = document.getElementById('brainDumpNest')
  const run = () => {
    const text = input.value.trim()
    if (!text) { input.focus(); return }
    createBlocksFromText(text, nestToggle ? nestToggle.checked : true)
    input.value = ''
  }
  btn.addEventListener('click', run)
  // Cmd/Ctrl+Enter submits; plain Enter keeps adding lines.
  input.addEventListener('keydown', e => {
    e.stopPropagation()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run() }
  })
}

let typeChecksWired = false
export function setupTypeChips() {
  if (typeChecksWired) return
  typeChecksWired = true
  // Importers (Brain Dump lives here, interop does not) report their
  // low-confidence blocks via an event, so no module has to import this one.
  window.addEventListener('pf:show-type-chips', e => showTypeChips(Array.isArray(e.detail) ? e.detail : []))
  // The button carries data-canvas-ui, so a press on it neither selects nor
  // drags the card; its click opens the menu.
  $.canvasRoot().addEventListener('click', e => {
    const btn = e.target.closest('.block-type-check'); if (!btn) return
    e.stopPropagation()
    openTypeChipMenu(btn)
  })
  // Tab steps from card to card and never lands on the button, so T opens
  // the check for the focused card (or the one selected card when focus is
  // on the page). Never while typing.
  document.addEventListener('keydown', e => {
    if ((e.key || '').toLowerCase() !== 't' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
    if (ui.readOnly) return
    const ae = document.activeElement
    if (ae?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae?.tagName || '')) return
    const onPage = !ae || ae === document.body
    const card = (!onPage && ae.closest?.('.block')) ||
      (onPage && selection.ids.size === 1 ? getBlockEl(selection.blockId) : null)
    const btn = card && $.canvasRoot().contains(card) ? card.querySelector('.block-type-check') : null
    if (!btn) return
    e.preventDefault()
    openTypeChipMenu(btn)
  })
}
