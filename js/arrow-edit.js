// ════════════════════════════════════════════════════════════
//  arrow-edit.js: edit a connection's label.
//
//  Foundation fallback: select the arrow, show the Inspector tab
//  and focus its label field. The LINES stream replaces this with
//  a real inline editor at the label anchor.
// ════════════════════════════════════════════════════════════

import { state, ui } from './state.js'
import { selectArrow } from './render.js'
import { showPanels } from './chrome.js'

export function startArrowLabelEdit(aid, { clientX, clientY } = {}) {
  if (ui.readOnly || !state.arrows.some(a => a.id === aid)) return false
  void clientX; void clientY
  selectArrow(aid)
  // The field lives in the right panel. Focusing it inside a hidden panel
  // does nothing visible, so bring the panel back first: out of Zen, and
  // un-collapsed.
  showPanels()
  const panel = document.getElementById('rightPanel')
  if (panel?.classList.contains('collapsed')) document.getElementById('panelReopenBtn')?.click()
  document.querySelector('.panel-tab[data-tab="inspector"]')?.click()
  const input = document.getElementById('arrowLabelInput')
  if (!input) return false
  input.focus()
  input.select?.()
  return true
}

// LINES stream: wires Enter/F2 on a selected arrow and the inline editor.
export function setupArrowEdit() {}
