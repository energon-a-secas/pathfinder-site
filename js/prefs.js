// ════════════════════════════════════════════════════════════
//  prefs.js: per-browser preferences.
//
//  These belong to the person, not the map, so they live in
//  localStorage and never in canvasMeta (which travels in share
//  links and would override every recipient's own choice). The
//  older single-purpose keys (pathfinder-theme, -pinports,
//  -arrowtext, -snap, -tint) keep working where they are.
// ════════════════════════════════════════════════════════════

import { ui } from './state.js'

const PREFS_KEY = 'pathfinder-prefs'

export const PREF_DEFAULTS = {
  motion: false,   // animate highlights and gap hints (on hover or selection only)
}

function readAll() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (_) { return {} }
}

// An embedded canvas is someone else's page: it may read the visitor's
// preferences but never writes them, so this in-memory layer carries the
// embed's own changes for the life of the page.
const session = {}

export function getPref(key) {
  if (ui.embed && Object.hasOwn(session, key)) return session[key]
  const all = readAll()
  if (Object.hasOwn(all, key)) return all[key]
  return PREF_DEFAULTS[key]
}

export function setPref(key, value) {
  if (ui.embed) session[key] = value
  else {
    try {
      const all = readAll()
      all[key] = value
      localStorage.setItem(PREFS_KEY, JSON.stringify(all))
    } catch (_) {}
  }
  if (key === 'motion') applyPrefs()
  window.dispatchEvent(new CustomEvent('pf:pref-changed', { detail: { key, value } }))
}

/** Reflect the preferences that are body classes. Safe to call repeatedly. */
export function applyPrefs() {
  document.body.classList.toggle('motion-on', !!getPref('motion'))
}
