// ════════════════════════════════════════════════════════════
//  inline-edit.js: edit a card's title or description in place.
//
//  Keys follow the canvas-tool convention: in the title Enter
//  commits, Tab commits and moves to the description, Escape
//  commits (Escape leaves editing, it does not discard). In the
//  description Enter is a newline, Cmd/Ctrl+Enter or Escape
//  commits, Shift+Tab goes back to the title. Blur commits.
//  A commit is one undo step, and none at all when nothing changed.
// ════════════════════════════════════════════════════════════

import { state, selection, ui } from './state.js'
import { $, getBlockEl } from './utils.js'
import { renderBlock, mutateBlock } from './render.js'

let cur = null   // { id, field, el, onKey, onBlur, onPaste }

export function isInlineEditing() { return !!cur }

function fieldEl(blockEl, field) {
  return blockEl.querySelector(field === 'description' ? '.block-desc' : '.block-title')
}

function placeCaret(el, { selectAll, caretPoint }) {
  const sel = window.getSelection()
  if (!sel) return
  let range = null
  if (caretPoint) {
    const { x, y } = caretPoint
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y)
      if (pos && el.contains(pos.offsetNode)) {
        range = document.createRange()
        range.setStart(pos.offsetNode, pos.offset)
        range.collapse(true)
      }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y)
      if (r && el.contains(r.startContainer)) range = r
    }
  }
  if (!range) {
    range = document.createRange()
    range.selectNodeContents(el)
    if (!selectAll) range.collapse(false)
  }
  sel.removeAllRanges()
  sel.addRange(range)
}

/**
 * Start editing a block's title or description on the card. Returns false
 * when it cannot (read-only view, missing block, field not on screen).
 */
export function startInlineEdit(blockId, field = 'title', { selectAll = true, caretPoint = null } = {}) {
  if (ui.readOnly) return false
  const b = state.blocks[blockId]
  const blockEl = getBlockEl(blockId)
  if (!b || !blockEl) return false
  if (cur) commit({ refocus: false })
  // A collapsed card hides its description, so edit what is visible.
  if (field === 'description' && b.collapsed) field = 'title'
  // Rebuild the card if a previous edit left it stale.
  let el = fieldEl(blockEl, field)
  if (!el) { renderBlock(blockId); el = fieldEl(getBlockEl(blockId), field) }
  if (!el) return false

  // The title shows an "Untitled" placeholder span when empty; edit the raw
  // text instead so the placeholder never becomes part of the value.
  if (field === 'title') el.textContent = b.title || ''
  el.contentEditable = 'true'
  el.spellcheck = true
  el.setAttribute('role', 'textbox')
  el.setAttribute('aria-label', field === 'title' ? 'Block title' : 'Block description')
  if (field === 'description') el.setAttribute('aria-multiline', 'true')

  const onKey = e => onKeydown(e)
  const onBlur = () => { if (cur && cur.el === el) commit({ refocus: false }) }
  const onPaste = e => onPasteEvent(e)
  el.addEventListener('keydown', onKey)
  el.addEventListener('blur', onBlur)
  el.addEventListener('paste', onPaste)
  // What the field reads as before any typing. Commit compares against this,
  // not the stored text: reading normalises (collapsed spaces, line breaks),
  // and opening and closing the editor must never rewrite the block.
  const initial = readValue(el, field)
  cur = { id: blockId, field, el, onKey, onBlur, onPaste, initial }

  el.focus({ preventScroll: true })
  placeCaret(el, { selectAll: caretPoint ? false : selectAll, caretPoint })
  return true
}

function readValue(el, field) {
  if (field === 'title') return el.textContent.replace(/\s+/g, ' ').trim()
  // innerText keeps the line breaks the user typed; store them as \n.
  return el.innerText.replace(/ /g, ' ').replace(/\n{3,}/g, '\n\n').trimEnd()
}

/** Commit the edit in progress. `refocus` hands focus back to the card. */
export function commitInlineEdit() { commit({ refocus: true }) }

function commit({ refocus = true, next = null } = {}) {
  if (!cur) return
  const { id, field, el, onKey, onBlur, onPaste, initial } = cur
  cur = null
  el.removeEventListener('keydown', onKey)
  el.removeEventListener('blur', onBlur)
  el.removeEventListener('paste', onPaste)
  el.contentEditable = 'false'
  el.removeAttribute('role'); el.removeAttribute('aria-label'); el.removeAttribute('aria-multiline')
  const b = state.blocks[id]
  if (!b) return
  // A collapsed card has no description to move on to; Tab would reopen the
  // title forever. Finish on the card instead.
  if (next === 'description' && b.collapsed) next = null
  // Hand focus to the card before it re-renders, so focus moves within the
  // card rather than dropping to the page and arriving back from nowhere.
  if (refocus && !next) getBlockEl(id)?.focus({ preventScroll: true })
  const key = field === 'title' ? 'title' : 'description'
  const value = readValue(el, field)
  if (value !== initial) mutateBlock(id, { [key]: value }, { undo: true })
  else renderBlock(id)   // restores the placeholder and the <br> formatting
  if (selection.blockId === id) {
    const input = key === 'title' ? $.inspTitle() : $.inspDesc()
    if (input) input.value = b[key] || ''
  }
  if (next) { startInlineEdit(id, next, { selectAll: false }); return }
  if (refocus) getBlockEl(id)?.focus({ preventScroll: true })
}

function onKeydown(e) {
  if (!cur) return
  // Every key belongs to the editor: nothing may reach the canvas shortcuts
  // (Backspace would delete the block, Space would re-select it).
  e.stopPropagation()
  const { field } = cur
  if (e.isComposing) return
  if (field === 'title') {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); commit(); return }
    if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); commit({ next: 'description' }); return }
  } else {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); commit(); return }
    if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); commit({ next: 'title' }); return }
  }
}

// Paste lands as plain text, and a title stays on one line.
function onPasteEvent(e) {
  if (!cur) return
  e.preventDefault()
  let text = e.clipboardData?.getData('text/plain') || ''
  if (cur.field === 'title') text = text.replace(/\s*[\r\n]+\s*/g, ' ')
  if (!text) return
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !cur.el.contains(sel.anchorNode)) {
    cur.el.append(document.createTextNode(text))
    return
  }
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}
