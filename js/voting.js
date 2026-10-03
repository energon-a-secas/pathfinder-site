// ════════════════════════════════════════════════════════════
//  voting.js: dot voting as an explicit mode.
//
//  A click on a card used to add a vote at any time, which rewrote
//  the URL and toasted on ordinary selection clicks. Voting now only
//  happens while this mode is on. Session only, never persisted, and
//  refused in read-only and embed views.
// ════════════════════════════════════════════════════════════

import { ui } from './state.js'
import { $, getAllVotes } from './utils.js'

// Mirrors MAX_DOTS_PER_USER in utils.js, which is not exported.
const MAX_DOTS = 5

function myUserId() {
  try { return JSON.parse(localStorage.getItem('pathfinder-user') || '{}').userId || null }
  catch (_) { return null }
}

/** Dots the current visitor has left to place. */
export function dotsLeft() {
  const me = myUserId()
  if (!me) return MAX_DOTS
  const used = Object.values(getAllVotes()).reduce((sum, votes) => {
    const mine = Array.isArray(votes) ? votes.find(v => v.userId === me) : null
    return sum + (mine ? mine.dots : 0)
  }, 0)
  return Math.max(0, MAX_DOTS - used)
}

export function isVotingMode() { return !!ui.votingMode }

function banner() { return document.getElementById('votingBanner') }

export function refreshVotingBanner() {
  const el = banner(); if (!el) return
  const n = dotsLeft()
  el.querySelector('.voting-left').textContent = `${n} left`
}

function showBanner() {
  let el = banner()
  if (!el) {
    el = document.createElement('div')
    el.id = 'votingBanner'
    el.className = 'voting-banner'
    el.setAttribute('data-canvas-ui', '')
    el.setAttribute('role', 'status')
    el.innerHTML = '<span>Dot voting: click a card to add a dot. <strong class="voting-left"></strong>.</span>' +
      '<button type="button" class="btn btn-secondary btn-sm voting-done">Done</button>'
    el.querySelector('.voting-done').addEventListener('click', () => setVotingMode(false))
    ;($.canvasViewport() || document.body).appendChild(el)
  }
  refreshVotingBanner()
}

/** Turn dot voting on or off. Returns the resulting state. */
export function setVotingMode(on) {
  const want = !!on && !ui.readOnly && !ui.embed
  ui.votingMode = want
  document.body.classList.toggle('voting-mode', want)
  if (want) showBanner()
  else banner()?.remove()
  window.dispatchEvent(new CustomEvent('pf:voting-mode', { detail: { on: want } }))
  return want
}
