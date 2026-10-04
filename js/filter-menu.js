// ════════════════════════════════════════════════════════════
//  filter-menu.js: the one filter control. Attention's category
//  and Find blocks' type, status and scope are a chip that opens a
//  menu.js list of choices, like every other picker in the app,
//  instead of native selects that looked and behaved like nothing
//  else here (PRODUCT.md: one picker per concept).
//
//  setupFilter(button, { name, options, onChange })
//  filterValue(button) / setFilterValue(button, value)
//
//  The value lives on the button (data-value; the first option is the
//  default, '' for "all"), so the modules that read a filter keep one line
//  to read it.
// ════════════════════════════════════════════════════════════

import { openDropdown } from './menu.js'

const CARET = '<svg class="insp-caret" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6.5L8 10l3.5-3.5"/></svg>'

/** The filter's current value ('' when it shows everything). */
export function filterValue(button) { return button?.dataset.value || '' }

/** Set the value and redraw the chip; does not call onChange. */
export function setFilterValue(button, value) {
  if (!button) return
  button.dataset.value = value || ''
  button._pfFilterRender?.()
}

/**
 * Wire `button` as a filter. `options()` returns the choices, the "all"
 * one first: [{ value, label, dot?, dotShape?, count? }]. A pick sets the
 * value, redraws the chip (its text and its accessible name, "Type: Risk")
 * and calls onChange(value); focus goes back to the chip, as from any menu.
 */
export function setupFilter(button, { name, options, onChange }) {
  if (!button || button._pfFilterRender) return
  if (button.tagName === 'BUTTON') button.type = 'button'
  button.classList.add('filter-chip')
  if (!button.querySelector('.insp-chip-text')) button.innerHTML = '<span class="insp-chip-text"></span>'
  if (!button.querySelector('.insp-caret')) button.insertAdjacentHTML('beforeend', CARET)
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')
  const render = () => {
    const list = options()
    const opt = list.find(o => o.value === filterValue(button)) || list[0]
    if (!opt) return
    button.querySelector('.insp-chip-text').textContent = opt.label
    button.setAttribute('aria-label', `${name}: ${opt.label}`)
    button.title = `${name}: ${opt.label}`
    // A narrowed list says so on its chip, without a colour. The default is
    // the first choice, whatever its value: Find blocks' scope starts at
    // "This map" ('current'), which narrows nothing.
    button.classList.toggle('is-filtered', opt !== list[0])
  }
  button._pfFilterRender = render
  button.addEventListener('click', () => {
    const value = filterValue(button)
    openDropdown(button, options().map(o => ({
      label: o.label, radio: true, checked: o.value === value,
      dot: o.dot, dotShape: o.dotShape,
      shortcut: o.count != null ? String(o.count) : undefined,
      action: () => { setFilterValue(button, o.value); onChange?.(o.value) },
    })), { label: name, className: 'filter-menu' })
  })
  render()
}
