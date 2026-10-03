// ════════════════════════════════════════════════════════════
//  type-menu.js: the one type picker. The inspector's Type
//  dropdown, the context menus (Change type, Add connected, the
//  quick-add picker) and the card's type check build their rows
//  here, and every retype goes through retypeBlock, so the lists
//  and the rule for what a pick settles cannot drift apart.
//
//  typeRow(t, extra)                 one row: dot, label, meaning
//  typeMenuItems(current, onPick, opts)  the grouped list
//  typeNotesItem(typeHint) / typeNoteItem(initialType)  the foot
//  retypeBlock(b, t)                 the changes a pick makes
//  retypeBlocks(ids, t)              applies it as one undo step
// ════════════════════════════════════════════════════════════

import { state, ui } from './state.js'
import { TYPES, typesByStep, TYPE_DISAMBIGUATION } from './utils.js'
import { mutateBlocks } from './render.js'

/** The type's colour for the current theme, for a menu row's dot. */
export const typeDot = t =>
  (ui.lightMode ? TYPES[t]?.light : TYPES[t]?.color) || TYPES.custom?.color || '#94a3b8'

/**
 * What a type is for, in one line: the sentence that separates it from the
 * type people confuse it with when there is one, else its short text.
 */
export function typeNote(t) {
  const label = TYPES[t]?.label
  if (!label) return ''
  return TYPE_DISAMBIGUATION.find(s => s.includes(label)) || `${label}: ${TYPES[t].short}`
}

/**
 * One type row. `short` rides along as the hint, so a filter finds a type by
 * what it means ("deliverable", "measurable") and the row carries it as its
 * description.
 */
export function typeRow(t, extra = {}) {
  return { label: TYPES[t].label, dot: typeDot(t), dotShape: TYPES[t].shape, hint: TYPES[t].short, ...extra }
}

/**
 * The words for n blocks of a type: "risk" / "risks", "open questions",
 * "triggers / ends". Labels come from the registry and change, so this
 * pluralises words rather than keeping a table. Other reads as "other
 * block(s)": "2 others" says nothing.
 */
export function typeNoun(type, n = 1) {
  if (!Object.hasOwn(TYPES, type) || type === 'custom') return n === 1 ? 'other block' : 'other blocks'
  const label = TYPES[type].label.toLowerCase()
  if (n === 1) return label
  const plural = w => /(s|x|z|ch|sh)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's'
  return label.split(' / ').map(part => part.replace(/(\S+)$/, plural)).join(' / ')
}

// ── What a pick settles ──────────────────────────────────────

/**
 * A colour that is exactly the type's own (an import often sets one) is not
 * a choice anybody made: left in place, it would paint a retyped block in
 * the colour of the type it no longer is.
 */
export function isTypeColour(color, type) {
  const c = typeof color === 'string' ? color.trim().toLowerCase() : ''
  const t = TYPES[type]
  return !!c && !!t && (c === t.color.toLowerCase() || c === t.light.toLowerCase())
}

/** True when choosing `t` would change `b`: a new type, or a guess confirmed. */
export const retypeChanges = (b, t) => !!b && Object.hasOwn(TYPES, t) && (b.type !== t || !!b.typeCheck || !!b.typeHint)

/**
 * What choosing type `t` (or null: "keep the type it has") does to block `b`,
 * shaped for mutateBlocks(ids, fn). A pick is a decision, so the pending type
 * check goes, and so does the type a newer version wrote (typeHint), which
 * would otherwise come back on the next load. Those two keys are removed in
 * place (mutateBlocks has already taken the snapshot); the rest comes back as
 * changes, dropping a colour that was only the old type's colour.
 */
export function retypeBlock(b, t = null) {
  delete b.typeCheck
  delete b.typeHint
  if (!t || t === b.type || !Object.hasOwn(TYPES, t)) return null
  return isTypeColour(b.color, b.type) ? { type: t, color: null } : { type: t }
}

/**
 * Retype blocks (`t` null keeps each block's type and only settles its
 * check) as one undo step. Blocks the pick would not change are left out,
 * and when none is left no step is taken. Returns how many changed; the
 * caller refreshes the inspector.
 */
export function retypeBlocks(ids, t = null) {
  const live = (ids || []).filter(id => {
    const b = state.blocks[id]
    return !!b && (t ? retypeChanges(b, t) : !!(b.typeCheck || b.typeHint))
  })
  if (!live.length) return 0
  mutateBlocks(live, b => retypeBlock(b, t))
  return live.length
}

// ── The foot of a type list ──────────────────────────────────

const NOTE_PROMPT = 'Point at a type to see when to use it.'

/**
 * Every line that tells confusable types apart, plus what a newer version
 * called the block when it wrote a type this one does not know. For menus
 * wide enough to show them all at once.
 */
export function typeNotesItem(typeHint = '') {
  return { type: 'custom', render: c => {
    c.classList.add('type-menu-notes')
    const lines = [...(typeHint ? [`Imported as “${typeHint}”: pick the closest type.`] : []), ...TYPE_DISAMBIGUATION]
    lines.forEach(line => {
      const p = document.createElement('p')
      p.textContent = line
      c.appendChild(p)
    })
  } }
}

/**
 * One line at the foot that describes the row under the pointer or focus,
 * for the narrower context menus, where every line at once would double
 * the list's height.
 */
export function typeNoteItem(initialType = null) {
  return { type: 'custom', render: c => {
    c.classList.add('type-menu-note-wrap')
    const p = document.createElement('p')
    p.className = 'type-menu-note'
    p.textContent = (initialType && typeNote(initialType)) || NOTE_PROMPT
    c.appendChild(p)
    const byLabel = new Map(Object.keys(TYPES).map(t => [TYPES[t].label, t]))
    const show = node => {
      const row = node?.closest?.('.pf-menu-item')
      const t = row && byLabel.get(row.querySelector('.pf-menu-label')?.textContent)
      if (t) p.textContent = typeNote(t)
    }
    // menu.js appends this node to its menu once render returns.
    queueMicrotask(() => {
      const menu = c.parentElement
      if (!menu) return
      menu.addEventListener('mouseover', e => show(e.target))
      menu.addEventListener('focusin', e => show(e.target))
      if (menu.contains(document.activeElement)) show(document.activeElement)
    })
  } }
}

// ── The list ─────────────────────────────────────────────────

/**
 * Every type grouped by the step it answers, the current one checked (none
 * for a mixed selection, `current` null). Options:
 *   unconfirmed  "Looks right" first, so confirming a guess costs one click
 *   typeHint     the type a newer version wrote, named in the notes
 *   steps        one row per step, each opening its types: the compact form
 *                for a menu hung off a small control (the card's type check),
 *                where sixteen rows under seven headings stood 790px tall
 *   notes        'lines' (every disambiguation line), 'pointer' (one line
 *                for the row pointed at) or false
 *   row          extra fields for every type row
 */
export function typeMenuItems(current, onPick, { unconfirmed = false, typeHint = '', steps = false, notes = 'lines', row = {} } = {}) {
  const items = []
  const pickRow = t => typeRow(t, { radio: true, checked: t === current, ...row, action: () => onPick(t) })
  if (unconfirmed && current && TYPES[current]) {
    items.push({ label: 'Looks right', hint: `Keep it as ${TYPES[current].label}`, confirm: true,
      action: () => onPick(current) }, { type: 'divider' })
  }
  typesByStep().forEach(group => {
    if (!group.types.length) return
    if (steps) {
      items.push({ label: group.label, hint: group.types.map(t => TYPES[t].label).join(', '),
        submenu: () => group.types.map(pickRow) })
      return
    }
    items.push({ type: 'heading', label: group.label })
    group.types.forEach(t => items.push(pickRow(t)))
  })
  if (notes === 'lines') items.push({ type: 'divider' }, typeNotesItem(typeHint))
  else if (notes === 'pointer') items.push(typeNoteItem(current))
  return items
}
