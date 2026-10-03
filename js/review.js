// ════════════════════════════════════════════════════════════
//  review.js: async review for a shared, read-only canvas.
//
//  The honest version of "teams": no server, no presence, no
//  cursors. A reviewer opens the view-only link, selects a
//  block, leaves a note; the collected notes copy out as a
//  standard pathfinder-patch the author pastes into "Bring the
//  answer back". Notes land in the block's freeform notes,
//  prefixed "Review:", one undo step, previewed before apply,
//  like every other patch.
//
//  Notes survive a reload: they live in sessionStorage under a
//  key derived from the link, and closing the tab with notes not
//  yet copied asks first. Each reviewed block carries a small
//  count badge (a blockDecorators painter), so the reviewer can
//  see what they already covered.
// ════════════════════════════════════════════════════════════

import { state, ui, selection } from './state.js'
import { showToast, copyText } from './utils.js'
import { blockDecorators, renderBlock } from './render.js'

/** The live review: notes taken, and how many of them were already copied. */
export const review = { notes: [], sent: 0, key: null }

// FNV-1a, base 36: a short stable key, since a #z= hash can be kilobytes.
function hash32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** The sessionStorage key for the notes on the link this page was opened from. */
export function reviewKey(loc = location) {
  const src = new URLSearchParams(loc.search).get('src')
  const basis = loc.hash || (src ? 'src:' + src : loc.pathname)
  return 'pathfinder-review:' + hash32(basis)
}

export function loadReviewNotes(key) {
  try {
    const raw = JSON.parse(sessionStorage.getItem(key) || 'null')
    const notes = Array.isArray(raw?.notes)
      ? raw.notes.filter(n => n && typeof n.block === 'string' && typeof n.text === 'string')
          .map(n => ({ block: n.block, title: String(n.title || ''), text: n.text }))
      : []
    const sent = Math.min(notes.length, Math.max(0, Number.isInteger(raw?.sent) ? raw.sent : 0))
    return { notes, sent }
  } catch (_) { return { notes: [], sent: 0 } }
}

export function saveReviewNotes(key = review.key, notes = review.notes, sent = review.sent) {
  if (!key) return false
  try {
    if (notes.length) sessionStorage.setItem(key, JSON.stringify({ notes, sent }))
    else sessionStorage.removeItem(key)
    return true
  } catch (_) { return false }
}

/** Notes written since the last successful copy. */
export function hasUnsentNotes() { return review.notes.length > review.sent }

/** blockDecorators painter: a count badge on every block with a note. */
export function paintReviewDot(block, el) {
  el.querySelector(':scope > .review-dot')?.remove()
  const mine = review.notes.filter(n => n.block === block.id)
  if (!mine.length) return
  const dot = document.createElement('span')
  dot.className = 'review-dot'
  dot.setAttribute('role', 'img')
  dot.setAttribute('aria-label', mine.length === 1 ? '1 review note' : `${mine.length} review notes`)
  dot.title = mine.map(n => n.text).join('\n')
  dot.textContent = String(mine.length)
  el.appendChild(dot)
}

function repaint(blockId) {
  if (blockId && state.blocks[blockId]) renderBlock(blockId)
}

function refreshBar() {
  const count = document.getElementById('reviewCount')
  const copyBtn = document.getElementById('reviewCopyBtn')
  const undoBtn = document.getElementById('reviewUndoBtn')
  if (count) count.textContent = review.notes.length ? String(review.notes.length) : ''
  if (copyBtn) copyBtn.style.display = review.notes.length ? '' : 'none'
  if (undoBtn) undoBtn.hidden = !review.notes.length
}

/** Add a note to a block. Returns the note, or null when refused. */
export function addReviewNote(blockId, text) {
  const t = String(text || '').trim()
  if (!t || !blockId || !state.blocks[blockId]) return null
  const note = { block: blockId, title: state.blocks[blockId].title || '', text: t }
  review.notes.push(note)
  saveReviewNotes()
  repaint(blockId)
  refreshBar()
  return note
}

/** Take back the most recent note. */
export function removeLastReviewNote() {
  const note = review.notes.pop()
  if (!note) return null
  review.sent = Math.min(review.sent, review.notes.length)
  saveReviewNotes()
  repaint(note.block)
  refreshBar()
  return note
}

/** The reply the reviewer sends back. Exported for the tests. */
export function buildReviewReply(list) {
  const patch = {
    format: 'pathfinder-patch',
    version: 1,
    note: `Review notes from a shared link (${list.length})`,
    notes: list.map(n => ({ block: n.block, note: n.text })),
  }
  return 'Review notes on your canvas. Paste this whole message into ' +
    'Prompt → Paste a reply or a review.\n\n' +
    '```pathfinder-patch\n' + JSON.stringify(patch, null, 1) + '\n```\n'
}

export function setupReview() {
  const bar = document.getElementById('reviewBar')
  if (!bar) return
  // Review is for the shared view-only link. The embed is a preview inside
  // someone else's page; a review bar there would be furniture in a photo.
  if (!ui.readOnly || ui.embed) { bar.remove(); return }

  const input = document.getElementById('reviewInput')
  const addBtn = document.getElementById('reviewAddBtn')
  const copyBtn = document.getElementById('reviewCopyBtn')
  input.setAttribute('aria-label', 'Review note for the selected block')

  let undoBtn = document.getElementById('reviewUndoBtn')
  if (!undoBtn) {
    undoBtn = document.createElement('button')
    undoBtn.type = 'button'
    undoBtn.id = 'reviewUndoBtn'
    undoBtn.className = 'btn btn-secondary btn-sm review-btn review-undo'
    undoBtn.title = 'Remove last note'
    // The label is the accessible name at every width; narrow screens hide
    // it visually and keep the icon.
    undoBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/>' +
      '<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg><span class="review-undo-label">Remove last note</span>'
    undoBtn.hidden = true
    copyBtn.before(undoBtn)
  }

  review.key = reviewKey()
  const saved = loadReviewNotes(review.key)
  // Not filtered against state.blocks: a #z= link inflates after this runs,
  // and the decorator paints each badge whenever its block renders.
  review.notes = saved.notes
  review.sent = saved.sent
  if (!blockDecorators.includes(paintReviewDot)) blockDecorators.push(paintReviewDot)
  if (review.notes.length) {
    new Set(review.notes.map(n => n.block)).forEach(repaint)
    showToast(`${review.notes.length} review note${review.notes.length === 1 ? '' : 's'} restored from this tab`, 'info', 2600)
  }

  const add = () => {
    const text = input.value.trim()
    if (!text) { showToast('Write the note first', 'warning', 1500); return }
    const id = selection.blockId
    if (!id || !state.blocks[id]) { showToast('Select the block the note is about first', 'warning', 2200); return }
    addReviewNote(id, text)
    input.value = ''
    showToast(`Noted on "${(state.blocks[id].title || '(untitled)').slice(0, 40)}"`, 'success', 1600)
  }
  addBtn.addEventListener('click', add)
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add() } })
  undoBtn.addEventListener('click', () => {
    const gone = removeLastReviewNote()
    if (gone) showToast(`Removed the note on "${(gone.title || '(untitled)').slice(0, 40)}"`, 'info', 1800)
  })

  copyBtn.addEventListener('click', () => {
    const count = review.notes.length
    copyText(buildReviewReply(review.notes)).then(ok => {
      if (ok) { review.sent = Math.max(review.sent, count); saveReviewNotes() }
      showToast(ok
        ? 'Review patch copied. Send it to the canvas owner; it applies with a preview'
        : 'Copy failed. Try again', ok ? 'success' : 'warning', 3000)
    })
  })

  // Notes live in this tab only until they are copied out. A read-only view
  // has no autosave, so this is the only guard between them and a closed tab.
  window.addEventListener('beforeunload', e => {
    if (!hasUnsentNotes()) return
    e.preventDefault()
    e.returnValue = ''
  })

  refreshBar()
}
