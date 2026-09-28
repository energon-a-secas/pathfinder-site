import { relationHint } from './relations.js'
// ════════════════════════════════════════════════════════════
//  inspector.js: the right panel. Renders the block, multi-select
//  and arrow inspectors and wires their controls. Moved out of
//  render.js (rendering) and events.js (listeners).
// ════════════════════════════════════════════════════════════

import { state, selection, ui, canvasMeta, debouncedSave, saveState, snapshot,
         snapshotOnce, resetSnapshotToken } from './state.js'
import { $, TYPES, SWATCH_COLORS, SWATCH_NAMES, STATUS_DEFS, PRIORITY_DEFS,
         ARROW_LABEL_PRESETS, CARD_STYLES, BORDER_WIDTHS, HIGHLIGHTS,
         escHtml, showToast } from './utils.js'
import { renderArrows, renderFrames, arrowRoute, arrowPattern } from './canvas.js'
import { renderBlock, renderAllBlocks, selectBlock, mutateBlock, mutateArrow, deleteBlock,
         deleteArrow, duplicateBlock, deleteBlocksBatch, createGroup, deleteGroup } from './render.js'
import { applyGapFix } from './create.js'
import { runGapDetection, getGapFixes } from './gaps.js'
import { askQuestion, openDocPopup, detectSeeReference } from './doc-panel.js'
import { alignSelection, distributeSelection } from './align.js'

// Line patterns the Dashed/Dotted buttons write to arrow.pattern.
const ARROW_PATTERNS = ['dashed', 'dotted']

/**
 * The highlight picker. One markup helper for both places it appears, so the
 * single-block and multi-select versions cannot drift.
 *
 * `active` is the currently applied key, or `'mixed'` when a selection carries
 * more than one, which is worth showing rather than silently picking the first.
 */
export function highlightRowHtml(active) {
  return `<button class="hl-swatch hl-swatch-none${!active ? ' active' : ''}" data-hl=""
            title="No highlight" aria-label="No highlight"></button>` +
    Object.entries(HIGHLIGHTS).map(([key, h]) =>
      `<button class="hl-swatch${key === 'festive' ? ' hl-swatch-festive' : ''}${active === key ? ' active' : ''}"
               data-hl="${key}" style="--sw:${h.color}"
               title="${escHtml(h.label)}: ${escHtml(h.hint)}" aria-label="${escHtml(h.label)}"></button>`
    ).join('')
}

/** What a whole selection is set to: one key, null, or 'mixed'. */
export function selectionHighlight(ids) {
  const seen = new Set(ids.map(id => state.blocks[id]?.highlight || null))
  if (seen.size > 1) return 'mixed'
  return [...seen][0] || null
}

// ── Inspector ────────────────────────────────────────────────
export function renderInspector() {
  const inspectorEmpty   = $.inspectorEmpty()
  const inspectorContent = $.inspectorContent()
  const inspectorMulti   = $.inspectorMulti()
  const inspectorArrow   = $.inspectorArrow()
  const inspTitle        = $.inspTitle()
  const inspDesc         = $.inspDesc()
  const inspNotes        = $.inspNotes()

  if (selection.ids.size > 1) {
    inspectorEmpty.style.display = 'none'
    inspectorContent.style.display = 'none'
    inspectorMulti.style.display = ''
    inspectorArrow.style.display = 'none'
    // A count by type, because "5 problems, 3 requirements, 1 goal" is what
    // people actually want to say out loud when they present a canvas.
    const tally = {}
    selection.ids.forEach(id => { const t = state.blocks[id]?.type; if (t) tally[t] = (tally[t] || 0) + 1 })
    const parts = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${n} ${(TYPES[t]?.label || t).toLowerCase()}${n === 1 ? '' : 's'}`)
    document.getElementById('multiCount').textContent =
      `${selection.ids.size} blocks selected` + (parts.length > 1 ? `: ${parts.join(', ')}` : '')

    const multiHl = document.getElementById('multiHighlightRow')
    if (multiHl) {
      const active = selectionHighlight([...selection.ids])
      multiHl.innerHTML = highlightRowHtml(active === 'mixed' ? null : active)
      multiHl.dataset.mixed = active === 'mixed' ? '1' : ''
    }
    const spotBtn = document.getElementById('spotlightBtn')
    if (spotBtn) {
      spotBtn.classList.toggle('active', !!canvasMeta.spotlight)
      spotBtn.textContent = canvasMeta.spotlight ? 'Spotlight: on' : 'Spotlight: off'
    }

    const frameSection = document.getElementById('frameSection')
    const ungroupBtn = document.getElementById('ungroupBtn')
    const groupBlocksBtn = document.getElementById('groupBlocksBtn')
    if (frameSection && ungroupBtn && groupBlocksBtn) {
      const hasGroup = selection.groupId && state.groups[selection.groupId]
      frameSection.style.display = hasGroup ? '' : 'none'
      groupBlocksBtn.style.display = hasGroup ? 'none' : ''
      if (hasGroup) {
        const lbl = document.getElementById('frameLabelInput')
        if (lbl) lbl.value = state.groups[selection.groupId].label
      }
    }
    return
  }
  inspectorMulti.style.display = 'none'
  if (selection.arrowId) {
    const a = state.arrows.find(arr => arr.id === selection.arrowId)
    inspectorEmpty.style.display = 'none'
    inspectorContent.style.display = 'none'
    inspectorArrow.style.display = ''
    if (a) {
      const f = state.blocks[a.from], t = state.blocks[a.to]
      document.getElementById('arrowInfo').textContent =
        `${TYPES[f?.type]?.label||'?'} "${f?.title||'?'}" \u2192 ${TYPES[t?.type]?.label||'?'} "${t?.title||'?'}"`
      document.getElementById('arrowLabelInput').value = a.label || ''
      const relationInput = document.getElementById('arrowRelation')
      if (relationInput) relationInput.value = a.relation || ''
      const hint = document.getElementById('arrowRelationHint')
      if (hint) hint.textContent = relationHint(a, state.blocks)
      const arrowNoteEl = document.getElementById('arrowNoteInput')
      if (arrowNoteEl) arrowNoteEl.value = a.note || ''
      // Label presets
      const presetsEl = document.getElementById('arrowLabelPresets')
      if (presetsEl) {
        presetsEl.innerHTML = ARROW_LABEL_PRESETS.map(p =>
          `<button class="arrow-preset-chip${a.label === p ? ' active' : ''}" data-preset="${p}">${p}</button>`
        ).join('')
      }
      // Style buttons. Route (geometry) and pattern (dashes) are separate
      // fields now, so a dashed line can still be routed; the Dashed and
      // Dotted buttons light up from pattern, the rest from style.
      document.querySelectorAll('[data-arrow-style]').forEach(btn => {
        const v = btn.dataset.arrowStyle
        btn.classList.toggle('active', ARROW_PATTERNS.includes(v)
          ? arrowPattern(a) === v
          : arrowRoute(a) === v)
      })
      // Bidirectional toggle
      document.getElementById('arrowBidir').classList.toggle('active', !!a.bidirectional)
      // Color swatches
      const arrowSwatches = $.arrowColorSwatches()
      if (arrowSwatches) {
        arrowSwatches.innerHTML =
          `<div class="color-swatch swatch-reset${!a.color ? ' active' : ''}" data-color="reset" role="button" aria-label="Default color" title="Default"></div>` +
          SWATCH_COLORS.map(c =>
            `<div class="color-swatch${a.color === c ? ' active' : ''}" data-color="${c}" style="background:${c}" role="button" aria-label="${SWATCH_NAMES[c] || c}" title="${SWATCH_NAMES[c] || c}"></div>`
          ).join('')
      }
      // Weight buttons
      document.querySelectorAll('[data-arrow-weight]').forEach(btn =>
        btn.classList.toggle('active', (a.weight || 2) === +btn.dataset.arrowWeight))
      // Connection points. An unpinned end reads as Auto; the canvas still picks
      // a side for it, but the user has not committed to one.
      document.querySelectorAll('.port-pick').forEach(group => {
        const pinned = (group.dataset.portEnd === 'from' ? a.fromPort : a.toPort) || ''
        group.querySelectorAll('[data-port-side]').forEach(btn =>
          btn.classList.toggle('active', btn.dataset.portSide === pinned))
      })
    }
    return
  }
  inspectorArrow.style.display = 'none'
  if (!selection.blockId) {
    inspectorEmpty.style.display = ''
    inspectorContent.style.display = 'none'
    return
  }
  const b = state.blocks[selection.blockId]
  if (!b) { inspectorEmpty.style.display = ''; inspectorContent.style.display = 'none'; return }

  inspectorEmpty.style.display = 'none'
  inspectorContent.style.display = ''

  // type picker
  $.typePicker().innerHTML = Object.entries(TYPES).map(([t, cfg]) =>
    `<span class="type-pill${t===b.type?' active':''}" data-type="${t}" style="color:${cfg.color}" title="${escHtml(cfg.tip || cfg.short || t)}">${escHtml(cfg.label)}</span>`
  ).join('')

  // Contextual nudge: a question stated as a belief should become an Assumption
  // so the AI is told to pressure-test it rather than just answer it.
  const promoteEl = document.getElementById('promoteAssumption')
  if (promoteEl) {
    if (b.type === 'question') {
      promoteEl.style.display = ''
      promoteEl.dataset.bid = b.id
    } else {
      promoteEl.style.display = 'none'
    }
  }

  // Status picker
  const statusPicker = document.getElementById('statusPicker')
  if (statusPicker) {
    statusPicker.innerHTML = `<button class="status-opt${!b.status || b.status === 'not-started' ? ' active' : ''}" data-status="">None</button>` +
      Object.entries(STATUS_DEFS).filter(([k]) => k !== 'not-started').map(([k, v]) =>
        `<button class="status-opt${b.status === k ? ' active' : ''}" data-status="${k}">${v.icon} ${v.label}</button>`
      ).join('')
  }

  // Priority picker
  const priorityPicker = document.getElementById('priorityPicker')
  if (priorityPicker) {
    priorityPicker.innerHTML = `<button class="priority-opt${!b.priority ? ' active' : ''}" data-priority="">None</button>` +
      Object.entries(PRIORITY_DEFS).map(([k, v]) =>
        `<button class="priority-opt${b.priority === k ? ' active' : ''}" data-priority="${k}" style="--pc:${v.color}">${v.label}</button>`
      ).join('')
  }

  inspTitle.value = b.title
  inspDesc.value  = b.description
  inspNotes.value = b.notes || ''

  // Acceptance criteria for the block types that can be "done"; rationale for
  // decisions. Hidden everywhere else so the inspector stays short.
  const criteriaSection = document.getElementById('criteriaSection')
  if (criteriaSection) {
    // The registry names the list: "Acceptance criteria", or "Targets" on a
    // metric. The label's leading text node carries it; the hint span stays.
    const wants = TYPES[b.type]?.criteria
    criteriaSection.style.display = wants ? '' : 'none'
    if (wants) {
      $.inspCriteria().value = (b.criteria || []).join('\n')
      const lbl = criteriaSection.querySelector('.insp-label')
      if (lbl?.firstChild?.nodeType === Node.TEXT_NODE) lbl.firstChild.nodeValue = wants + ' '
    }
  }
  const rationaleSection = document.getElementById('rationaleSection')
  if (rationaleSection) {
    rationaleSection.style.display = b.type === 'decision' ? '' : 'none'
    if (b.type === 'decision') $.inspRationale().value = b.rationale || ''
  }

  // Documentation reference fields + "promote See:" nudge
  const docHref = document.getElementById('docRefHref')
  const docLabel = document.getElementById('docRefLabel')
  const docAnchor = document.getElementById('docRefAnchor')
  if (docHref && docLabel && docAnchor) {
    docHref.value = b.docRef?.href || ''
    docLabel.value = b.docRef?.label || ''
    docAnchor.value = b.docRef?.anchor || ''
    const previewBtn = document.getElementById('docRefPreviewBtn')
    if (previewBtn) previewBtn.style.display = b.docRef?.href ? '' : 'none'
  }
  const promoteSee = document.getElementById('promoteSeeRef')
  if (promoteSee) {
    const seeRef = detectSeeReference(b.description)
    if (seeRef && !b.docRef) {
      promoteSee.style.display = ''
      promoteSee.textContent = `↳ Use "See: ${seeRef.label || seeRef.href}" as this block's doc`
    } else {
      promoteSee.style.display = 'none'
    }
  }

  document.querySelectorAll('.action-toggle').forEach(btn => {
    const isActive = b.actions.includes(btn.dataset.action)
    btn.classList.toggle('active', isActive)
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false')
  })

  // Color swatches
  const swatchesEl = $.colorSwatches()
  if (swatchesEl) {
    swatchesEl.innerHTML =
      `<div class="color-swatch swatch-reset${!b.color ? ' active' : ''}" data-color="reset" role="button" aria-label="Reset to type color" title="Reset to type color"></div>` +
      SWATCH_COLORS.map(c =>
        `<div class="color-swatch${b.color === c ? ' active' : ''}" data-color="${c}" style="background:${c}" role="button" aria-label="${SWATCH_NAMES[c] || c}" title="${SWATCH_NAMES[c] || c}"></div>`
      ).join('')
  }

  // Appearance. "Default" is a real choice, not an absent one: it means this
  // block follows the canvas, so changing the canvas default still moves it.
  const cardPicker = document.getElementById('cardStylePicker')
  if (cardPicker) {
    const canvasDefault = CARD_STYLES[canvasMeta.cardStyle]?.label || 'Outline'
    cardPicker.innerHTML =
      `<button class="radio-opt${!b.cardStyle ? ' active' : ''}" data-card-style="" title="Follow the canvas default (${escHtml(canvasDefault)})">Default</button>` +
      Object.entries(CARD_STYLES).map(([k, v]) =>
        `<button class="radio-opt${b.cardStyle === k ? ' active' : ''}" data-card-style="${k}" title="${escHtml(v.hint)}">${escHtml(v.label)}</button>`
      ).join('')
  }
  const borderPicker = document.getElementById('borderWidthPicker')
  if (borderPicker) {
    borderPicker.innerHTML =
      `<button class="radio-opt${!b.borderWidth ? ' active' : ''}" data-border-width="" style="flex:1">Default</button>` +
      BORDER_WIDTHS.map(w =>
        `<button class="radio-opt${b.borderWidth === w ? ' active' : ''}" data-border-width="${w}" style="flex:1">${w}px</button>`
      ).join('')
  }

  const hlRow = document.getElementById('blockHighlightRow')
  if (hlRow) hlRow.innerHTML = highlightRowHtml(b.highlight)

  renderQuestions(b)

  // Gap fix suggestions
  const gapFixesEl = document.getElementById('gapFixes')
  if (gapFixesEl) {
    const fixes = getGapFixes(b)
    if (fixes.length) {
      gapFixesEl.style.display = ''
      gapFixesEl.innerHTML =
        '<div class="insp-label" style="margin-bottom:8px">Suggestions</div>' +
        fixes.map(f => `
          <div class="gap-fix-item">
            <span class="gap-fix-icon">${f.icon}</span>
            <div class="gap-fix-text">${escHtml(f.text)}</div>
            ${f.action ? `<button class="gap-fix-btn" data-fix="${f.id}" data-bid="${b.id}">${escHtml(f.action)}</button>` : ''}
          </div>`).join('')
    } else {
      gapFixesEl.style.display = 'none'
    }
  }
}

export function renderQuestions(b) {
  const questionsList = $.questionsList()
  questionsList.innerHTML = (b.questions||[]).map((q, i) => `
    <div class="question-item${q.answer ? ' answered' : ''}">
      <div class="question-row">
        <input type="text" value="${escHtml(q.text)}" placeholder="Enter question\u2026" data-qi="${i}">
        <button class="q-ask" data-qi="${i}" title="Copy a grounded prompt for this question">Ask</button>
        <button class="q-del" data-qi="${i}" title="Delete">\u00D7</button>
      </div>
      <textarea class="question-answer" data-qi="${i}" rows="2"
        placeholder="Paste the assistant's answer here\u2026">${escHtml(q.answer || '')}</textarea>
    </div>`).join('')

  questionsList.querySelectorAll('input[data-qi]').forEach(inp =>
    inp.addEventListener('input', () => {
      const b2 = state.blocks[selection.blockId]; if (!b2) return
      const q = b2.questions[+inp.dataset.qi]; if (!q) return
      q.text = inp.value
      debouncedSave(); ui.promptDirty = true
    })
  )
  questionsList.querySelectorAll('.question-answer').forEach(ta =>
    ta.addEventListener('input', () => {
      const b2 = state.blocks[selection.blockId]; if (!b2) return
      const q = b2.questions[+ta.dataset.qi]; if (!q) return
      if (ta.value.trim()) q.answer = ta.value; else delete q.answer
      ta.closest('.question-item')?.classList.toggle('answered', !!ta.value.trim())
      debouncedSave(); ui.promptDirty = true
    })
  )
  questionsList.querySelectorAll('.q-ask').forEach(btn =>
    btn.addEventListener('click', () => {
      const b2 = state.blocks[selection.blockId]; if (!b2) return
      askQuestion(b2, +btn.dataset.qi)
    })
  )
  questionsList.querySelectorAll('.q-del').forEach(btn =>
    btn.addEventListener('click', () => {
      const b2 = state.blocks[selection.blockId]; if (!b2) return
      b2.questions.splice(+btn.dataset.qi, 1)
      renderQuestions(b2); debouncedSave(); ui.promptDirty = true
    })
  )
}

// ── Block text fields ────────────────────────────────────────
// Title, description, notes, criteria and rationale. Each typing burst in
// one field is one undo step (snapshotOnce with a per-field token), and
// leaving the field ends the burst. Before this they wrote with no snapshot
// at all, so Cmd+Z skipped the typing and undid the action before it.
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
    })
    el.addEventListener('change', resetSnapshotToken)
  })
}

// ── Inspector panel events ───────────────────────────────────
export function setupInspectorEvents() {
  // Type picker
  $.typePicker().addEventListener('click', e => {
    const pill = e.target.closest('.type-pill'); if (!pill || !selection.blockId) return
    mutateBlock(selection.blockId, { type: pill.dataset.type })
    renderInspector()
  })

  // One-click: promote a Question into an Assumption (defaults to a validate action)
  document.getElementById('promoteAssumption')?.addEventListener('click', () => {
    const id = selection.blockId; if (!id) return
    const b = state.blocks[id]; if (!b) return
    const actions = b.actions.includes('validate') ? b.actions : [...b.actions, 'validate']
    mutateBlock(id, { type: 'assumption', actions })
    renderInspector()
  })

  wireBlockTextInputs()

  // Documentation reference: three inputs write one docRef object. An empty
  // href + empty label clears it back to null so no stray marker lingers.
  const docHref   = document.getElementById('docRefHref')
  const docLabel  = document.getElementById('docRefLabel')
  const docAnchor = document.getElementById('docRefAnchor')
  const commitDocRef = () => {
    if (!selection.blockId || ui.readOnly) return
    snapshotOnce('insp-docref:' + selection.blockId)
    const href = docHref.value.trim()
    const label = docLabel.value.trim()
    const anchor = docAnchor.value.trim().replace(/^#/, '')
    const docRef = (href || label) ? { href, label, anchor } : null
    mutateBlock(selection.blockId, { docRef })
    const previewBtn = document.getElementById('docRefPreviewBtn')
    if (previewBtn) previewBtn.style.display = href ? '' : 'none'
  }
  ;[docHref, docLabel, docAnchor].forEach(el => {
    el?.addEventListener('input', commitDocRef)
    el?.addEventListener('change', resetSnapshotToken)
  })

  document.getElementById('docRefPreviewBtn')?.addEventListener('click', () => {
    if (selection.blockId) openDocPopup(selection.blockId, document.getElementById('docRefPreviewBtn'))
  })

  // Promote a "See: X" line in the description into a real docRef
  document.getElementById('promoteSeeRef')?.addEventListener('click', () => {
    const id = selection.blockId; if (!id) return
    const b = state.blocks[id]; if (!b) return
    const ref = detectSeeReference(b.description)
    if (!ref) return
    mutateBlock(id, { docRef: ref })
    renderInspector()
  })

  document.querySelectorAll('.action-toggle').forEach(btn =>
    btn.addEventListener('click', () => {
      if (!selection.blockId) return
      const b = state.blocks[selection.blockId]; if (!b) return
      const a = btn.dataset.action, i = b.actions.indexOf(a)
      if (i >= 0) b.actions.splice(i,1); else b.actions.push(a)
      const isActive = b.actions.includes(a)
      btn.classList.toggle('active', isActive)
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false')
      renderBlock(selection.blockId); runGapDetection(); debouncedSave()
      ui.promptDirty = true
    })
  )

  // Status picker
  document.getElementById('statusPicker').addEventListener('click', e => {
    const btn = e.target.closest('.status-opt'); if (!btn || !selection.blockId) return
    mutateBlock(selection.blockId, { status: btn.dataset.status || null })
    renderInspector()
  })

  // Priority picker
  document.getElementById('priorityPicker').addEventListener('click', e => {
    const btn = e.target.closest('.priority-opt'); if (!btn || !selection.blockId) return
    mutateBlock(selection.blockId, { priority: btn.dataset.priority || null })
    renderInspector()
  })

  // Actions info toggle
  document.getElementById('actionsInfoBtn').addEventListener('click', () => {
    const panel = document.getElementById('actionsInfoPanel')
    panel.style.display = panel.style.display === 'none' ? '' : 'none'
  })

  document.getElementById('addQuestionBtn').addEventListener('click', () => {
    const b = state.blocks[selection.blockId]; if (!b) return
    b.questions.push({ text: '' }); renderQuestions(b); debouncedSave(); ui.promptDirty = true
    setTimeout(() => { const ins = $.questionsList().querySelectorAll('input[data-qi]'); ins[ins.length-1]?.focus() }, 30)
  })

  document.getElementById('dupeBlockBtn').addEventListener('click', () => {
    if (!selection.blockId) return
    const newId = duplicateBlock(selection.blockId)
    if (newId) selectBlock(newId)
  })

  document.getElementById('deleteBlockBtn').addEventListener('click', () => {
    if (selection.blockId) deleteBlock(selection.blockId)
  })

  document.getElementById('deleteMultiBtn').addEventListener('click', () =>
    deleteBlocksBatch([...selection.ids])
  )

  // Arrow edits go through mutateArrow, so each one is an undo step. Text
  // fields coalesce a typing burst into one step with snapshotOnce and skip
  // the inspector re-render that would move the caret.
  const selectedArrow = () => state.arrows.find(arr => arr.id === selection.arrowId)
  document.getElementById('arrowRelation')?.addEventListener('change', e => {
    const a = selectedArrow()
    if (!a || ui.readOnly) return
    mutateArrow(a.id, { relation: e.target.value || null })
  })

  const arrowLabelInput = document.getElementById('arrowLabelInput')
  arrowLabelInput.addEventListener('input', () => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    snapshotOnce('arrow-label:' + a.id)
    mutateArrow(a.id, { label: arrowLabelInput.value.trim() }, { undo: false, refreshInspector: false })
    document.getElementById('arrowRelationHint').textContent = relationHint(a, state.blocks)
  })
  arrowLabelInput.addEventListener('change', resetSnapshotToken)

  const arrowNoteInput = document.getElementById('arrowNoteInput')
  arrowNoteInput?.addEventListener('input', () => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    snapshotOnce('arrow-note:' + a.id)
    mutateArrow(a.id, { note: arrowNoteInput.value }, { undo: false, refreshInspector: false })
  })
  arrowNoteInput?.addEventListener('change', resetSnapshotToken)

  // Arrow label presets
  document.getElementById('arrowLabelPresets').addEventListener('click', e => {
    const chip = e.target.closest('.arrow-preset-chip'); if (!chip) return
    const a = selectedArrow(); if (!a || ui.readOnly) return
    const preset = chip.dataset.preset
    mutateArrow(a.id, { label: a.label === preset ? '' : preset })
  })

  // Card style + border width. Delegated, because renderInspector rebuilds
  // these buttons every time the selection changes.
  document.getElementById('cardStylePicker')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-card-style]'); if (!btn || !selection.blockId) return
    mutateBlock(selection.blockId, { cardStyle: btn.dataset.cardStyle || null })
    renderInspector()
  })
  document.getElementById('borderWidthPicker')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-border-width]'); if (!btn || !selection.blockId) return
    const w = btn.dataset.borderWidth ? parseFloat(btn.dataset.borderWidth) : null
    mutateBlock(selection.blockId, { borderWidth: w })
    renderInspector()
  })

  // Highlights. Presentation emphasis, applied to whatever is selected.
  const applyHighlight = (ids, key) => {
    if (!ids.length) return
    snapshot()
    ids.forEach(id => { if (state.blocks[id]) state.blocks[id].highlight = key })
    ids.forEach(renderBlock)
    debouncedSave()
    renderInspector()
  }
  document.getElementById('blockHighlightRow')?.addEventListener('click', e => {
    const sw = e.target.closest('[data-hl]'); if (!sw || !selection.blockId) return
    applyHighlight([selection.blockId], sw.dataset.hl || null)
  })
  document.getElementById('multiHighlightRow')?.addEventListener('click', e => {
    const sw = e.target.closest('[data-hl]'); if (!sw) return
    applyHighlight([...selection.ids], sw.dataset.hl || null)
    const n = selection.ids.size
    showToast(sw.dataset.hl
      ? `Highlighted ${n} block${n === 1 ? '' : 's'}`
      : `Cleared the highlight on ${n} block${n === 1 ? '' : 's'}`, 'success', 1500)
  })

  // Spotlight: the emphasis is the contrast, so fade everything unmarked.
  document.getElementById('spotlightBtn')?.addEventListener('click', () => {
    const any = Object.values(state.blocks).some(b => b.highlight)
    if (!any && !canvasMeta.spotlight) {
      showToast('Highlight something first, then Spotlight fades the rest', 'info', 2400)
      return
    }
    canvasMeta.spotlight = !canvasMeta.spotlight
    document.body.classList.toggle('spotlight', canvasMeta.spotlight)
    saveState()
    renderInspector()
  })

  // Align and distribute for a multi-selection
  document.querySelectorAll('[data-align]').forEach(btn =>
    btn.addEventListener('click', () => {
      const ids = [...selection.ids]
      const n = alignSelection(ids, btn.dataset.align)
      if (!n) { showToast('Select two or more blocks to align', 'info', 1600); return }
      renderAllBlocks(); renderArrows({ cheap: false }); renderFrames()
      showToast(`Aligned ${n} blocks`, 'success', 1400)
    })
  )
  document.querySelectorAll('[data-distribute]').forEach(btn =>
    btn.addEventListener('click', () => {
      const ids = [...selection.ids]
      const n = distributeSelection(ids, btn.dataset.distribute)
      if (!n) { showToast('Select three or more blocks to distribute', 'info', 1600); return }
      renderAllBlocks(); renderArrows({ cheap: false }); renderFrames()
      showToast(`Spaced ${n} blocks evenly`, 'success', 1400)
    })
  )

  document.getElementById('deleteArrowBtn').addEventListener('click', () => {
    if (selection.arrowId) deleteArrow(selection.arrowId)
  })

  // Arrow style. Geometry buttons set style; Dashed and Dotted set pattern,
  // and clicking the active one again goes back to solid.
  document.querySelectorAll('[data-arrow-style]').forEach(btn =>
    btn.addEventListener('click', () => {
      const a = selectedArrow(); if (!a || ui.readOnly) return
      const v = btn.dataset.arrowStyle
      if (ARROW_PATTERNS.includes(v)) {
        const changes = { pattern: arrowPattern(a) === v ? 'solid' : v }
        // A legacy in-memory style of 'dashed' becomes its geometry too.
        if (a.style !== arrowRoute(a)) changes.style = arrowRoute(a)
        mutateArrow(a.id, changes)
      } else {
        const changes = { style: v }
        if (a.style !== arrowRoute(a) && !a.pattern) changes.pattern = arrowPattern(a)
        mutateArrow(a.id, changes)
      }
    })
  )

  // Arrow reverse direction (swap pinned ports too, so routing follows). The
  // pins keep their provenance: reversing is not the user choosing a side.
  document.getElementById('arrowReverse').addEventListener('click', () => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    const changes = { from: a.to, to: a.from, fromPort: a.toPort, toPort: a.fromPort }
    if (a.portsBy) changes.portsBy = a.portsBy
    mutateArrow(a.id, changes)
  })

  // Connection points: pin either end to a chosen side, or hand it back to auto
  document.querySelectorAll('.port-pick').forEach(group => {
    group.querySelectorAll('[data-port-side]').forEach(btn =>
      btn.addEventListener('click', () => {
        const a = selectedArrow(); if (!a || ui.readOnly) return
        const side = btn.dataset.portSide || null
        mutateArrow(a.id, group.dataset.portEnd === 'from' ? { fromPort: side } : { toPort: side })
      })
    )
  })

  // Arrow auto-route: clear pinned ports so it routes by box position
  document.getElementById('arrowAutoRoute').addEventListener('click', () => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    mutateArrow(a.id, { fromPort: null, toPort: null })
  })

  // Arrow bidirectional
  document.getElementById('arrowBidir').addEventListener('click', () => {
    const a = selectedArrow(); if (!a || ui.readOnly) return
    mutateArrow(a.id, { bidirectional: !a.bidirectional })
  })

  // Arrow color
  document.getElementById('arrowColorSwatches').addEventListener('click', e => {
    const sw = e.target.closest('.color-swatch'); if (!sw) return
    const a = selectedArrow(); if (!a || ui.readOnly) return
    mutateArrow(a.id, { color: sw.dataset.color === 'reset' ? null : sw.dataset.color })
  })

  // Arrow weight
  document.querySelectorAll('[data-arrow-weight]').forEach(btn =>
    btn.addEventListener('click', () => {
      const a = selectedArrow(); if (!a || ui.readOnly) return
      mutateArrow(a.id, { weight: +btn.dataset.arrowWeight })
    })
  )

  // Color swatches
  document.getElementById('colorSwatches').addEventListener('click', e => {
    const sw = e.target.closest('.color-swatch'); if (!sw || !selection.blockId) return
    const color = sw.dataset.color === 'reset' ? null : sw.dataset.color
    mutateBlock(selection.blockId, { color })
    renderInspector()
  })

  // Group / ungroup buttons
  document.getElementById('groupBlocksBtn').addEventListener('click', () => {
    if (selection.ids.size < 2) return
    createGroup([...selection.ids])
  })
  document.getElementById('ungroupBtn').addEventListener('click', () => {
    if (selection.groupId) deleteGroup(selection.groupId)
  })
  document.getElementById('frameLabelInput').addEventListener('input', e => {
    if (!selection.groupId || !state.groups[selection.groupId]) return
    state.groups[selection.groupId].label = e.target.value
    renderFrames()
    debouncedSave()
  })

  // Gap fix suggestions. The button carries the fix id; the fix object (with
  // any generic `create: { type, dir }`) comes from the same getGapFixes that
  // rendered it, and applyGapFix does the work in one undo step.
  document.getElementById('gapFixes').addEventListener('click', e => {
    const btn = e.target.closest('.gap-fix-btn'); if (!btn) return
    const blockId = btn.dataset.bid; const b = state.blocks[blockId]; if (!b) return
    const fix = getGapFixes(b).find(f => f.id === btn.dataset.fix) || { id: btn.dataset.fix }
    applyGapFix(fix, blockId)
  })
}
