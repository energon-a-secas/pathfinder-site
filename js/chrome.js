// ════════════════════════════════════════════════════════════
//  chrome.js — Give the canvas the whole window.
//
//  `H` hides the site frame (header + footer). `Z` goes further and
//  hides the panels too, leaving nothing but the diagram.
//
//  Lifted from the pattern proposed in the monorepo's SHORTCUTS.md,
//  which names Pathfinder as one of the tools where this earns its
//  place, and confirms bare H collides with nothing across the fleet
//  (Pathfinder's own Alt+H high-contrast toggle stays as it is).
//  Kept local for now so it ships without re-vendoring the shared
//  header kit into 50 other sites.
// ════════════════════════════════════════════════════════════

import { showToast } from './utils.js'

const KEY = 'pathfinder-chrome'
const FRAME  = ['.header-bar', '.neo-footer']
const PANELS = ['#palette', '#rightPanel']

// Inline styles rather than a class: the header kit owns .header-hidden
// through its own scroll handler and would put the bar back on the next
// scroll up. An inline display beats that and touches none of its rules.
function setHidden(selectors, hidden) {
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => { el.style.display = hidden ? 'none' : '' })
  })
}

export const chrome = { frame: true, panels: true }

function persist() {
  try {
    localStorage.setItem(KEY, (chrome.frame ? 'f' : '') + (chrome.panels ? 'p' : ''))
  } catch (_) {}
}

function apply() {
  setHidden(FRAME, !chrome.frame)
  setHidden(PANELS, !chrome.panels)
  document.body.dataset.chrome = chrome.frame ? 'on' : 'off'
  document.body.dataset.zen = chrome.panels ? 'off' : 'on'
  // The canvas sizes itself off the viewport, so it has to be told the
  // window effectively just changed shape.
  window.dispatchEvent(new Event('resize'))
}

/** Hide or show the header and footer. */
export function toggleChrome() {
  chrome.frame = !chrome.frame
  apply(); persist()
  // Only on the way out: once the header is gone the key is the only way
  // back, so the message has to arrive at the moment it becomes the only way.
  if (!chrome.frame) showToast('Header hidden. Press H to bring it back', 'info', 2600)
}

/** Hide or show everything that is not the canvas. */
export function toggleZen() {
  const goingZen = chrome.frame || chrome.panels
  chrome.frame = chrome.panels = !goingZen
  apply(); persist()
  if (goingZen) showToast('Zen mode. Press Z to bring the panels back', 'info', 2600)
}

export function setupChrome() {
  let saved = null
  try { saved = localStorage.getItem(KEY) } catch (_) {}
  if (saved !== null) {
    chrome.frame  = saved.includes('f')
    chrome.panels = saved.includes('p')
  }
  if (!chrome.frame || !chrome.panels) apply()
}
