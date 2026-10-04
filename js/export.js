// ════════════════════════════════════════════════════════════
//  export.js: JSON/Markdown export/import
// ════════════════════════════════════════════════════════════

import { state, selection, ui, canvasMeta, saveState, serializeCanvas, applyPromptOpts,
         buildShareUrlAsync } from './state.js'
import { mermaidShapeFor, toMermaid } from './interop.js'
import { $, TYPES, DEFAULT_CARD_STYLE, SITUATION_DEFAULT, ACTION_LABELS, genId, getAllVotes, typeInfo, showToast, askedQuestions } from './utils.js'
import { normalizeCanvas } from './normalize.js'
import { renderArrows, renderFrames, updateHint, fitView } from './canvas.js'
import { renderBlock, renderInspector } from './render.js'
import { runGapDetection } from './gaps.js'
import { generatePrompt, refreshPrompt, situationSection, connectionReading } from './prompt.js'
import { cardAnswer } from './task-plan.js'

/** An action as a person reads it: "Look back", not the id "recollect". */
const actionWord = a => ACTION_LABELS[a] || a

// ── Import JSON ───────────────────────────────────────────────
/**
 * Apply an imported/shared canvas payload after sanitizing it.
 * mode: 'replace' | 'merge'. Returns { imported, dropped } so the
 * caller can report how many items were added vs skipped.
 */
export function applyImport(data, mode, opts = {}) {
  const fit = opts.fit !== false
  const clean = normalizeCanvas(data)
  const cleanBlocks = Object.values(clean.blocks)

  if (mode === 'replace') {
    state.blocks = {}; state.arrows = []; state.groups = {}
    $.canvasRoot().querySelectorAll('.block').forEach(el => el.remove())
    $.arrowsGroup().innerHTML = ''
    $.framesLayer()?.querySelectorAll('.frame').forEach(el => el.remove())
    selection.ids.clear(); selection.blockId = null; selection.arrowId = null; selection.groupId = null

    // Canvas-level settings land before any block renders, because renderBlock
    // resolves each card against canvasMeta.cardStyle. A merge deliberately
    // keeps the existing framing: the canvas being merged into is the one
    // somebody set up.
    canvasMeta.title = clean.meta.title || ''
    canvasMeta.contextBrief = clean.meta.contextBrief || ''
    canvasMeta.cardStyle = clean.meta.cardStyle || DEFAULT_CARD_STYLE
    canvasMeta.spotlight = !!clean.meta.spotlight
    canvasMeta.situation = { ...SITUATION_DEFAULT, ...(clean.meta.situation || {}) }
    // The prompt options are part of how a canvas is meant to be read, so a
    // replace carries them. A merge leaves the existing framing alone, same
    // rule as the situation. The event lets the Prompt tab controls resync.
    applyPromptOpts(clean.meta.prompt)
    window.dispatchEvent(new CustomEvent('pf:prompt-opts-changed'))
  }

  // Build ID remap (merge needs fresh IDs to avoid collisions)
  const idMap = {}
  cleanBlocks.forEach(b => {
    const newId = (mode === 'replace') ? b.id : genId()
    idMap[b.id] = newId
    state.blocks[newId] = { ...b, id: newId }
    renderBlock(newId)
  })

  // Import groups first, remapping IDs on merge, so block groupIds resolve
  const groupIdMap = {}
  Object.values(clean.groups).forEach(g => {
    const newGid = (mode === 'replace') ? g.id : genId()
    groupIdMap[g.id] = newGid
    state.groups[newGid] = { ...g, id: newGid }
  })
  cleanBlocks.forEach(b => {
    const newId = idMap[b.id]
    if (b.groupId && state.blocks[newId]) {
      state.blocks[newId].groupId = groupIdMap[b.groupId] || null
    }
  })

  clean.arrows.forEach(a => {
    const fId = idMap[a.from] || a.from
    const tId = idMap[a.to]   || a.to
    if (state.blocks[fId] && state.blocks[tId] && fId !== tId &&
        !state.arrows.some(x => x.from === fId && x.to === tId)) {
      const extra = {}
      if (a.relation) extra.relation = a.relation
      if (a.label) extra.label = a.label
      if (a.note) extra.note = a.note
      if (a.style && a.style !== 'curved') extra.style = a.style
      if (a.pattern && a.pattern !== 'solid') extra.pattern = a.pattern
      if (a.weight && a.weight !== 2) extra.weight = a.weight
      if (a.bidirectional) extra.bidirectional = a.bidirectional
      if (a.color) extra.color = a.color
      if (a.fromPort) extra.fromPort = a.fromPort
      if (a.toPort) extra.toPort = a.toPort
      if (a.portsBy) extra.portsBy = a.portsBy
      const id = mode === 'replace' && a.id && !state.arrows.some(x => x.id === a.id) ? a.id : genId()
      state.arrows.push({ id, from: fId, to: tId, ...extra })
    }
  })

  updateHint()
  requestAnimationFrame(() => {
    renderArrows(); renderFrames(); runGapDetection()
    if (fit && Object.keys(state.blocks).length) fitView()
    renderInspector()
    ui.promptDirty = true; if (ui.activeTab === 'prompt') refreshPrompt()
  })
  saveState()

  return { imported: cleanBlocks.length, dropped: clean.dropped, idMap }
}

// ── Export JSON ───────────────────────────────────────────────
export function exportJSON() {
  // Blocks go out as an array (the shape llms.txt documents); meta comes from
  // the shared serializer so the file carries the prompt options too.
  const payload = { blocks: Object.values(state.blocks), arrows: state.arrows, groups: state.groups, meta: serializeCanvas().meta, exportedAt: new Date().toISOString() }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = 'pathfinder.json'; a.click(); URL.revokeObjectURL(a.href)
  // A full copy left the browser: the backup reminder listens for this.
  window.dispatchEvent(new CustomEvent('pf:exported', { detail: { kind: 'json' } }))
}

// ── Export Markdown ──────────────────────────────────────────

/**
 * Registry order, then any type id the registry does not know, so every
 * block on the canvas has a section and none can vanish from an export.
 */
export function exportTypeOrder(blocks = state.blocks) {
  const present = new Set(Object.values(blocks).map(b => b.type))
  return [...Object.keys(TYPES), ...[...present].filter(t => !Object.hasOwn(TYPES, t))]
}

/** One connection for a Markdown list: bold titles, label, implied verb. */
function markdownConnection(a) {
  const f = state.blocks[a.from], t = state.blocks[a.to]
  if (!f || !t) return ''
  // Labels and notes round-trip through JSON but used to be thrown away
  // here, so the exported list said what connected to what and never why.
  const { stated, implied } = connectionReading(a, f, t)
  const note  = (a.note  || '').trim().replace(/\s*\n\s*/g, ' ')
  const arrow = a.bidirectional ? '↔' : '→'
  let md = `- **${f.title}** ${arrow} **${t.title}**`
  if (stated) md += `: _${stated}_`
  if (implied) md += `${stated ? ' ' : ': '}_(implied: ${implied})_`
  md += '\n'
  if (note) md += `  - ${note}\n`
  return md
}

/**
 * The Markdown document: one section per type, headed by the registry's
 * `section`, in the registry's Why, Who, Proof, What, How, Doubt order.
 * Pure, so tests read it without a download.
 */
export function buildMarkdown() {
  const order = exportTypeOrder()
  const byType = {}
  Object.values(state.blocks).forEach(b => { (byType[b.type]??=[]).push(b) })
  const title = (canvasMeta.title || '').trim() || 'Pathfinder Canvas'
  let md = `# ${title}\n_${new Date().toLocaleDateString()}_\n\n`
  // The markdown export gets handed to sessions too, so it carries the same
  // framing the prompt does. A plan read without its situation is a plan that
  // gets acted on wrongly, whichever file format it arrived in.
  md += situationSection()
  const brief = (canvasMeta.contextBrief || '').trim()
  if (brief) md += `## Engagement Context\n${brief}\n\n`
  order.forEach(t => {
    const items = byType[t]; if (!items?.length) return
    md += `## ${typeInfo(t).section}\n\n`
    items.forEach(b => {
      const tags = []
      if (b.priority) tags.push(b.priority.toUpperCase())
      if (b.status && b.status !== 'not-started') tags.push(b.status)
      md += `### ${b.title}${tags.length ? ' [' + tags.join(', ') + ']' : ''}\n`
      if (b.description) md += `${b.description}\n\n`
      // A block's own answer (an Open Question card's, or one kept from when
      // a retyped block was a question), as the prompt prints it.
      if (String(b.answer ?? '').trim()) md += `**Answer:** ${String(b.answer).trim()}\n\n`
      if (b.criteria?.length) {
        md += `**${typeInfo(b.type).criteria || 'Acceptance criteria'}:**\n`
        b.criteria.forEach(c => { md += `- [ ] ${c}\n` })
        md += '\n'
      }
      if (b.rationale?.trim()) md += `**Rationale:** ${b.rationale.trim()}\n\n`
      // People read this file: the actions by the words the app shows (the
      // prompt keeps the ids, which its legend explains).
      if (b.actions?.length) md += `**Actions:** ${b.actions.map(actionWord).join(', ')}\n\n`
      if (b.docRef && (b.docRef.href || b.docRef.label)) {
        const ref = b.docRef.label || b.docRef.href
        const anchor = b.docRef.anchor ? `#${b.docRef.anchor}` : ''
        md += b.docRef.href ? `**Doc:** [${ref}](${b.docRef.href}${anchor})\n\n` : `**Doc:** ${ref}${anchor}\n\n`
      }
      const asked = askedQuestions(b)
      if (asked.length) {
        md += `**Open questions:**\n`
        asked.forEach(q => { md += `- ${q.text}${q.answer?.trim() ? `\n  - _Answer:_ ${q.answer.trim().replace(/\n/g, ' ')}` : ''}\n` })
        md += '\n'
      }
      if (b.notes) md += `**Notes:** ${b.notes}\n\n`
    })
  })
  if (state.arrows.length) {
    md += '## Connections\n\n'
    state.arrows.forEach(a => { md += markdownConnection(a) })
    md += '\n'
    md += mermaidBlock()
  }
  return md
}

export function exportMarkdown() {
  const md = buildMarkdown()
  const blob = new Blob([md], { type: 'text/markdown' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
  a.download = 'pathfinder.md'; a.click(); URL.revokeObjectURL(a.href)
}

/**
 * A Mermaid graph of the same connections, fenced for Markdown.
 *
 * The flat list above says what links to what, one pair at a time. A reader
 * (or an AI being handed this file) has to rebuild the shape in their head
 * from it. The graph states the shape directly, and Mermaid renders natively
 * in GitHub, Obsidian and most Markdown viewers.
 *
 * It is the interop exporter's graph (toMermaid), so the Markdown export and
 * Copy Mermaid cannot disagree: every block declared (isolated ones too),
 * each type in its conventional shape, a `class` line naming every node's
 * type, groups as subgraphs, and a round trip through the app's own
 * importer that keeps every type.
 */
export function mermaidShape(type) {
  return mermaidShapeFor(type)
}

export function mermaidBlock() {
  const graph = toMermaid()
  return graph ? '```mermaid\n' + graph + '```\n\n' : ''
}

// ── Export copy prompt ───────────────────────────────────────
export function exportCopyPrompt() {
  navigator.clipboard.writeText(generatePrompt())
}

// ── Export to Presentation Sage ──────────────────────────────

/**
 * The deck as YAML: a title slide, then one bullets slide per type present,
 * in registry order and headed by the registry's short plural, so every
 * block type reaches the deck (triggers, steps and context used to vanish).
 */
export function buildSageYaml() {
  const q = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ')
  const byType = {}
  Object.values(state.blocks).forEach(b => { (byType[b.type]??=[]).push(b) })
  const deckTitle = canvasMeta.title || 'Pathfinder Plan'

  let yaml = `presentation:\n  title: "${q(deckTitle)}"\n  subtitle: "Exported from Pathfinder"\n  author: "Neorgon"\n  slides:\n    - type: title\n      heading: "${q(deckTitle)}"\n      subtitle: "${Object.values(state.blocks).length} blocks, ${state.arrows.length} connections"\n`

  exportTypeOrder().forEach(t => {
    const items = byType[t]; if (!items?.length) return
    yaml += `    - type: bullets\n      heading: "${q(typeInfo(t).plural)}"\n      bullets:\n`
    items.forEach(b => {
      yaml += `        - "${q(b.title || '(untitled)')}"\n`
    })
  })
  return yaml
}

export function exportToPresentationSage() {
  const yaml = buildSageYaml()

  // Presentation Sage's share contract: the deck travels in the fragment as
  // base64url UTF-8, never hits a server, and ?via= lets the arrival be counted.
  // (?yaml= still works there, but raw YAML in a query string had no size guard.)
  const bytes = new TextEncoder().encode(yaml)
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b) })
  const payload = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  window.open('https://slides.neorgon.com/?via=pathfinder#d=' + payload, '_blank')
}


// ── Export Meeting Summary ───────────────────────────────────

// A link long enough to swamp the summary is left out: the canvas title and
// the app's own Share button do that job better than 40KB of hash.
const MAX_SUMMARY_LINK = 4000

/**
 * The view-only link for this canvas: { url } when it is short enough to
 * paste, { omitted: true } when it is not. The link format belongs to the
 * sharing code, so this only asks it, through the async builder: it waits
 * for the compressed form, where the synchronous one may answer with the
 * long form from a stale cache. `build` is a parameter so tests can pin it.
 */
export async function summaryShareLink(build = buildShareUrlAsync) {
  try {
    const url = await build(true)
    if (typeof url !== 'string' || !url) return { url: '' }
    return url.length <= MAX_SUMMARY_LINK ? { url } : { url: '', omitted: true }
  } catch (_) { return { url: '' } }
}

/**
 * The meeting summary as Markdown. Headings are plain text (they used to
 * carry raw SVG markup, which printed as tags in every Markdown viewer), and
 * after the meeting-shaped sections (decisions, votes, actions, questions)
 * every other type present gets a section from the registry, so nothing on
 * the canvas is missing from the record. `now` and `shareUrl` are parameters
 * so tests can pin them.
 */
export function buildMeetingSummary({ now = new Date(), shareUrl = '', shareOmitted = false } = {}) {
  const blocks = Object.values(state.blocks)
  const arrows = state.arrows
  const votes = getAllVotes()
  const canvasTitle = (canvasMeta.title || '').trim()
  const oneLine = s => String(s || '').trim().replace(/\s*\n\s*/g, ' ')
  const titleOf = b => b.title || '(untitled)'

  let md = `# Meeting Summary${canvasTitle ? `: ${canvasTitle}` : ''}\n_${now.toLocaleDateString()} at ${now.toLocaleTimeString()}_\n\n`

  // Votes come from the URL hash, so a hand-edited one may hold anything.
  const participants = new Set(Object.values(votes).flat().map(v => v?.userId).filter(Boolean)).size
  if (participants > 0) md += `**Participants:** ${participants}\n\n`
  if (shareUrl) md += `**Canvas (view-only link):** ${shareUrl}\n\n`
  else if (shareOmitted) md += `**Canvas:** too large for a link in this summary. In Pathfinder, use Share, then Copy view-only link.\n\n`

  // Decisions made
  const decisions = blocks.filter(b => b.type === 'decision')
  md += '## Decisions made\n\n'
  if (decisions.length) {
    decisions.forEach(b => {
      md += `- **${titleOf(b)}**${b.description ? `: ${oneLine(b.description)}` : ''}`
      if (b.rationale?.trim()) md += `\n  Rationale: ${oneLine(b.rationale)}`
      if (b.notes) md += `\n  *Notes: ${oneLine(b.notes)}*`
      md += '\n'
    })
    md += '\n'
  } else {
    md += `_No ${TYPES.decision.label} blocks yet. Add them to capture decisions here._\n\n`
  }

  // Voting results (if voting happened)
  const votingBlocks = Object.entries(votes)
    .map(([blockId, voteArray]) => {
      const block = state.blocks[blockId]
      if (!block || !Array.isArray(voteArray)) return null
      const totalDots = voteArray.reduce((sum, v) => sum + (Number(v?.dots) || 0), 0)
      return { title: titleOf(block), type: block.type, dots: totalDots }
    })
    .filter(Boolean)
    .sort((a, b) => b.dots - a.dots)
  if (votingBlocks.length) {
    md += '## Voting results\n\n| Rank | Item | Votes |\n|------|------|-------|\n'
    votingBlocks.forEach((item, i) => {
      md += `| ${i + 1} | ${item.title} (${typeInfo(item.type).label}) | ${item.dots} |\n`
    })
    md += '\n'
  }

  // Action items (blocks with resolve/prepare/... actions)
  const actionBlocks = blocks.filter(b => b.actions && b.actions.length)
  md += '## Action items\n\n'
  if (actionBlocks.length) {
    actionBlocks.forEach(b => {
      b.actions.forEach(action => {
        md += `- [ ] **${titleOf(b)}** (${actionWord(action)})`
        if (b.notes) md += `\n  *Context: ${oneLine(b.notes)}*`
        md += '\n'
      })
    })
    md += '\n'
  } else {
    md += '_No action items marked. Add actions to blocks (resolve, prepare, and so on) to list them here._\n\n'
  }

  // Open questions: question blocks, then unanswered questions raised on
  // any other block, which a meeting is exactly the place to settle. A
  // question card with its answer recorded is settled, so it moves to its
  // own list with the answer.
  const cards = blocks.filter(b => b.type === 'question')
  const questions = cards.filter(b => !cardAnswer(b)), answeredCards = cards.filter(b => cardAnswer(b))
  const raised = blocks.filter(b => b.type !== 'question')
    .flatMap(b => (b.questions || []).filter(q => q.text?.trim() && !q.answer?.trim()).map(q => ({ b, q })))
  const cardLine = b => {
    let line = `- ${titleOf(b)}${b.description ? `: ${oneLine(b.description)}` : ''}`
    askedQuestions(b).forEach(q => {
      line += `\n  - ${oneLine(q.text)}${q.answer?.trim() ? `: answered: ${oneLine(q.answer)}` : ''}`
    })
    return line
  }
  md += '## Open questions\n\n'
  if (questions.length || raised.length) {
    questions.forEach(b => { md += cardLine(b) + '\n' })
    raised.forEach(({ b, q }) => { md += `- ${oneLine(q.text)} (on "${titleOf(b)}")\n` })
    md += '\n'
  } else if (answeredCards.length) {
    md += '_None open: every question on the map has an answer recorded._\n\n'
  } else {
    md += `_No questions recorded. Add ${TYPES.question.label} blocks to track what needs answering._\n\n`
  }
  if (answeredCards.length) {
    md += '## Answered questions\n\n'
    answeredCards.forEach(b => { md += `${cardLine(b)}\n  - Answer: ${oneLine(cardAnswer(b))}\n` })
    md += '\n'
  }

  // Every other type on the canvas, in registry order, under its plural.
  const covered = new Set(['decision', 'question'])
  exportTypeOrder().forEach(t => {
    if (covered.has(t)) return
    const items = blocks.filter(b => b.type === t)
    if (!items.length) return
    md += `## ${typeInfo(t).plural}\n\n`
    items.forEach(b => { md += `- ${titleOf(b)}${b.description ? `: ${oneLine(b.description)}` : ''}\n` })
    md += '\n'
  })

  // Connection summary
  const isolatedCount = blocks.filter(b => !arrows.some(a => a.to === b.id || a.from === b.id)).length
  if (arrows.length > 0 || isolatedCount > 0) {
    md += '## Connection summary\n\n'
    md += `- Total connections made: ${arrows.length}\n`
    md += `- Isolated items (no connections): ${isolatedCount}\n`
    md += `- Connected items: ${blocks.length - isolatedCount}\n\n`
  }

  // Next steps
  const tips = []
  if (!decisions.length) tips.push(`- Add ${TYPES.decision.label} blocks to capture decisions clearly`)
  if (!actionBlocks.length) tips.push('- Use action badges (resolve, prepare, and so on) to mark tasks')
  if (!questions.length && !raised.length) tips.push(`- Add ${TYPES.question.label} blocks to track what needs answering`)
  if (tips.length) md += `## Recommendations\n\nTo improve future meeting summaries:\n${tips.join('\n')}\n\n`

  md += '---\n*Summary generated from a Pathfinder canvas*\n'
  return md
}

/**
 * Download the meeting summary. Not an async function on purpose: the
 * summary is built once up front, synchronously, so a canvas that cannot be
 * summarised throws to the caller before it shows "Exported!", as it did
 * before the link made this wait. The returned promise settles with the
 * Markdown once the file is handed over, and never rejects: a failure after
 * the wait is reported in a toast, not as an unhandled rejection.
 */
export function exportMeetingSummary() {
  const now = new Date()
  buildMeetingSummary({ now })
  return summaryShareLink().then(({ url, omitted }) => {
    const md = buildMeetingSummary({ now, shareUrl: url, shareOmitted: omitted })
    const blob = new Blob([md], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `meeting-summary-${now.toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(a.href)
    return md
  }).catch(err => {
    console.error('Meeting summary export failed', err)
    showToast('Could not export the meeting summary', 'error')
    return ''
  })
}
