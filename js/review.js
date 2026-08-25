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
// ════════════════════════════════════════════════════════════

import { state, ui, selection } from './state.js'
import { showToast, copyText } from './utils.js'

const notes = []

function refreshBar() {
  const count = document.getElementById('reviewCount')
  const copyBtn = document.getElementById('reviewCopyBtn')
  if (count) count.textContent = notes.length ? String(notes.length) : ''
  if (copyBtn) copyBtn.style.display = notes.length ? '' : 'none'
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
    'Prompt → Bring the answer back.\n\n' +
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

  const add = () => {
    const text = input.value.trim()
    if (!text) { showToast('Write the note first', 'warning', 1500); return }
    const id = selection.blockId
    if (!id || !state.blocks[id]) { showToast('Select the block the note is about first', 'warning', 2200); return }
    notes.push({ block: id, title: state.blocks[id].title, text })
    input.value = ''
    refreshBar()
    showToast(`Noted on "${(state.blocks[id].title || '(untitled)').slice(0, 40)}"`, 'success', 1600)
  }
  addBtn.addEventListener('click', add)
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add() } })

  copyBtn.addEventListener('click', () => {
    copyText(buildReviewReply(notes)).then(ok => {
      showToast(ok
        ? 'Review patch copied. Send it to the canvas owner; it applies with a preview'
        : 'Copy failed. Try again', ok ? 'success' : 'warning', 3000)
    })
  })

  refreshBar()
}
