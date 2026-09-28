// ════════════════════════════════════════════════════════════
//  classify.js: text to typed blocks. The line classifier, outline
//  parser, paste handler, Brain Dump card and the type-correction
//  chips that follow an import. Moved out of events.js unchanged.
// ════════════════════════════════════════════════════════════

import { state, ui, view, snapshot, debouncedSave } from './state.js'
import { $, genId, getBlockEl, showToast, TYPES, DEFAULT_WIDTH } from './utils.js'
import { renderArrows, updateHint } from './canvas.js'
import { renderAllBlocks, mutateBlock } from './render.js'
import { runGapDetection } from './gaps.js'

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
  { re: /^(resource|team|tool|asset|budget)[:.]\s*/i,          type: 'resource' },
  { re: /^(output|deliverable|result|outcome)[:.]\s*/i,        type: 'output' },
  { re: /^(context|background|note|info|status)[:.]\s*/i,      type: 'context' },
  { re: /^(question)[:.]\s*/i,                                 type: 'question' },
  { re: /^(action|step|process|task|do)[:.]\s*/i,             type: 'process' },
  { re: /^(start|end|begin|finish|done|trigger)[:.]\s*/i,     type: 'terminator' },
]

// Weighted keyword cues. Each entry: [regex, points]. Highest-scoring type wins.
const SCORE_RULES = {
  requirement: [[/\b(need|needs|must|should|shall|require[sd]?|has to|have to)\b/i, 3], [/\b(support|enable|provide|allow)\b/i, 1]],
  assumption:  [[/\b(assume|assuming|assumption|expect|expects|presumably|likely|probably|i think|we think|believe)\b/i, 3], [/\bwill\s+\w+/i, 2], [/\b(should be fine|hopefully)\b/i, 2]],
  risk:        [[/\b(risk|concern|danger|threat|worried|might fail|could fail|fragile|breaks?|vulnerab)\b/i, 3], [/\b(if .* fails|single point of failure)\b/i, 2]],
  goal:        [[/\b(goal|objective|aim|vision|want to|increase|reduce|improve|grow|launch|ship|achieve|reach)\b/i, 3]],
  problem:     [[/\b(problem|issue|blocker|bug|broken|pain|can't|cannot|doesn't work|failing|slow|outage)\b/i, 3], [/\b(latency|exceeds?|over (our )?sla|breach(es|ing)?|too slow|error rate|downtime)\b/i, 3]],
  decision:    [[/\b(decided|decision|chose|choose|chosen|go with|pick(ed)?|settle[d]? on|opt(ed)? for)\b/i, 3]],
  resource:    [[/\b(team|budget|tool|asset|library|api|service|credits?|headcount|engineers?|designers?)\b/i, 1]],
  output:      [[/\b(deliverable|output|result|outcome|artifact|report|doc(s|umentation)?|deploy|release)\b/i, 2]],
  context:     [[/\b(background|context|currently|today|historically|note that|fyi|for reference)\b/i, 2]],
  process:     [[/^(update|create|add|send|generate|assign|review|submit|move|set|mark|run|trigger|notify)\b/i, 3], [/\b(step \d|then\b)/i, 1]],
  terminator:  [[/^(start|begin|end|finish|done|complete[d]?)\b/i, 3]],
}

const LEADING_FILLER = /^(we|i|the|our|they|it|this|that|there)\s+/i

/**
 * Classify one raw line into { type, title, confidence }.
 * confidence: 'high' (explicit prefix or strong score) | 'low' (weak/none).
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

export function setupPasteHandler() {
  document.addEventListener('paste', e => {
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.contentEditable === 'true') return
    if (ui.readOnly) return
    const text = e.clipboardData?.getData('text/plain')
    if (!text?.trim()) return
    e.preventDefault()
    createBlocksFromText(text)
  })
}

// ── Type-correction chips ────────────────────────────────────
//
// After an import, each fresh block gets a small chip floated above it so the
// 1-2 mis-categorized lines are one click from fixed. Chips are SIBLINGS in
// canvasRoot (never inside block innerHTML: renderBlock rebuilds that wholesale
// and would wipe them). They dismiss on the next canvas pointerdown.
function clearTypeChips() {
  document.querySelectorAll('.type-chip').forEach(el => el.remove())
}

function showTypeChips(created) {
  clearTypeChips()
  if (ui.readOnly) return
  const root = $.canvasRoot()
  created.forEach(({ id, confidence }) => {
    const b = state.blocks[id]; if (!b) return
    const chip = document.createElement('div')
    chip.className = 'type-chip' + (confidence === 'low' ? ' low-confidence' : '')
    chip.dataset.bid = id
    // Overlay UI: the canvas pointer handlers leave it alone.
    chip.setAttribute('data-canvas-ui', '')
    chip.style.left = b.x + 'px'
    chip.style.top  = (b.y - 26) + 'px'
    chip.innerHTML =
      `<span class="type-chip-dot" style="background:${TYPES[b.type]?.color || '#fff'}"></span>` +
      `<span class="type-chip-label">${TYPES[b.type]?.label || b.type}</span>` +
      `<svg class="type-chip-caret" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>`
    root.appendChild(chip)
    // Mark low-confidence blocks so the misses are visually obvious.
    if (confidence === 'low') getBlockEl(id)?.classList.add('low-confidence')
  })
}

function openTypeChipMenu(chip) {
  const id = chip.dataset.bid
  document.querySelectorAll('.type-chip-menu').forEach(m => m.remove())
  const menu = document.createElement('div')
  menu.className = 'type-chip-menu'
  menu.setAttribute('data-canvas-ui', '')
  menu.innerHTML = Object.entries(TYPES).map(([t, cfg]) =>
    `<button class="type-chip-opt" data-type="${t}">` +
    `<span class="type-chip-dot" style="background:${cfg.color}"></span>${cfg.label}</button>`
  ).join('')
  chip.appendChild(menu)
  menu.addEventListener('click', e => {
    const opt = e.target.closest('.type-chip-opt'); if (!opt) return
    e.stopPropagation()
    mutateBlock(id, { type: opt.dataset.type })
    getBlockEl(id)?.classList.remove('low-confidence')
    const b = state.blocks[id]
    chip.classList.remove('low-confidence')
    chip.querySelector('.type-chip-dot').style.background = TYPES[b.type]?.color || '#fff'
    chip.querySelector('.type-chip-label').textContent = TYPES[b.type]?.label || b.type
    menu.remove()
  })
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

export function setupTypeChips() {
  // Importers (Brain Dump lives here, interop does not) request chips via an
  // event, so no module has to import this one just to show them.
  window.addEventListener('pf:show-type-chips', e => showTypeChips(Array.isArray(e.detail) ? e.detail : []))
  const root = $.canvasRoot()
  // Open a chip's menu on click; dismiss all chips on any other canvas press.
  root.addEventListener('pointerdown', e => {
    const chip = e.target.closest('.type-chip')
    if (chip) {
      if (e.target.closest('.type-chip-menu')) return
      e.stopPropagation()
      const existing = chip.querySelector('.type-chip-menu')
      document.querySelectorAll('.type-chip-menu').forEach(m => m.remove())
      if (!existing) openTypeChipMenu(chip)
      return
    }
    clearTypeChips()
  }, true)
}
