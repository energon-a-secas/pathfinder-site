// ════════════════════════════════════════════════════════════
//  keycaps.js: one key cap, wherever a key is shown.
//
//  The command palette, the menus, the shortcut sheet and the N
//  panel all draw keys through here, and the doc pages use the
//  same recipe in CSS ([vocab] in style.css: mono 11px/500,
//  --text-2 on --tint, a 1px --border, --radius-sm, 20px tall,
//  0 5px of padding). One rule for what a cap holds:
//
//    - one key per cap: Shift+1 is [Shift][1], ⇧⌘Z is [⇧][⌘][Z]
//    - keys pressed together sit side by side; a screen reader
//      and a copy still read "Shift+1" (a hidden plus)
//    - keys pressed one after the other say so: N K is [N] then [K]
//    - anything that is not a key (click, drag, "a letter") is
//      plain text beside the caps, never inside one
// ════════════════════════════════════════════════════════════

import { escHtml } from './utils.js'

// What can sit in a cap: modifiers, named keys, one character.
const KEY = /^(⌘\/Ctrl|Cmd\/Ctrl|⌘|⇧|⌥|⌃|Ctrl|Cmd|Shift|Alt|Option|Tab|Enter|Return|Escape|Esc|Space|Delete|Del|Backspace|Home|End|PageUp|PageDown|Menu key|Arrow keys|Arrow|F\d{1,2}|[↑↓←→]|[A-Za-z0-9]|[=\-?/.,;'`[\]\\])$/
const MAC_MODS = /^[⌘⇧⌥⌃]+/

/** Whether a word is a key a cap can hold ("Shift", "K", "="), not an action ("click"). */
export function isKey(word) {
  return KEY.test(String(word || '').trim())
}

const cap = (k, cls) => `<kbd class="kbd${cls ? ' ' + cls : ''}">${escHtml(k)}</kbd>`
const plus = '<span class="sr-only">+</span>'

/**
 * The keys of one press: "Shift+1" → ['Shift', '1'], "⇧⌘Z" → ['⇧', '⌘', 'Z'],
 * "⌘K" → ['⌘', 'K']. A lone "+" or "-" is the key itself.
 */
export function pressKeys(press) {
  const s = String(press || '').trim()
  if (!s) return []
  if (s.length > 1 && s.includes('+')) {
    const parts = s.split('+').map(p => p.trim())
    if (parts.every(Boolean)) return parts
  }
  const mods = s.match(MAC_MODS)?.[0] || ''
  if (mods && s.length > mods.length) return [...mods, s.slice(mods.length)]
  return [s]
}

/** One press as caps side by side, with a hidden plus between them. */
function pressHtml(press, cls) {
  return pressKeys(press).map(k => cap(k, cls)).join(plus)
}

/**
 * A shortcut as caps, for a menu row or a palette row: "Shift+1", "⌘K",
 * "Del", or a chord "N K" (two presses, said as [N] then [K]). `cls` adds
 * the surface's own class to each cap.
 */
export function keyCapsHtml(shortcut, { cls = '', wrap = 'kbd-keys' } = {}) {
  const s = String(shortcut || '').trim()
  if (!s) return ''
  const presses = /^\S{1,3} \S{1,3}$/.test(s) ? s.split(' ') : [s]
  const inner = presses.map(p => pressHtml(p, cls)).join('<span class="kbd-then"> then </span>')
  return wrap ? `<span class="${wrap}">${inner}</span>` : inner
}

// A sheet word without the note after it: "Tab (editing)" is the key Tab.
const bare = part => String(part || '').replace(/\s+\(.*\)$/, '')

/**
 * A shortcut sheet phrase as caps and words: "⌘/Ctrl + K" is [⌘/Ctrl][K],
 * "Tab / Shift + Tab" is [Tab] / [Shift][Tab], "N, then a letter" is [N]
 * then a letter, "Shift + click" is [Shift] + click. Keys pressed together
 * (" + " between two keys) sit side by side in one unbreakable press, so a
 * narrow column wraps between presses, never inside one; every other
 * separator, and every word that is not a key, stays as written.
 */
export function phraseCapsHtml(phrase, { cls = '' } = {}) {
  const parts = String(phrase || '').split(/( \+ | \/ |, then | or )/)
  let html = '', press = []
  const flush = () => {
    if (press.length) html += press.length > 1 ? `<span class="kbd-press">${press.join(plus)}</span>` : press[0]
    press = []
  }
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      // A plus between two keys keeps the press open; anything else ends it.
      if (part === ' + ' && isKey(bare(parts[i - 1])) && isKey(bare(parts[i + 1]))) return
      flush()
      // ", then" is a chord, said the way a chord is everywhere: [N] then.
      html += `<span class="kbd-sep">${escHtml(part === ', then ' ? ' then ' : part)}</span>`
      return
    }
    // A key may carry words after it: "Tab / Shift + Tab (editing)".
    const m = part.match(/^(.*?)(\s+\(.*\))$/)
    const word = m ? m[1] : part
    if (isKey(word)) press.push(cap(word, cls))
    else { flush(); html += `<span class="kbd-word">${escHtml(word)}</span>` }
    if (m) { flush(); html += `<span class="kbd-word">${escHtml(m[2])}</span>` }
  })
  flush()
  return html
}
