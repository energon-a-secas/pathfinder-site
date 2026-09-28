// ============================================================
//  menu.test.js -- the shared menu component (js/menu.js)
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { openMenu, openDropdown, closeMenus, isMenuOpen } from '../js/menu.js'

const key = (el, k, extra = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))
const menus = () => [...document.querySelectorAll('.pf-menu')]
const labelOf = el => el?.querySelector?.('.pf-menu-label')?.textContent

function fresh() { closeMenus() }

describe('menu.js -- open and close', () => {
  it('opens a fixed menu on the body with role=menu and data-canvas-ui', () => {
    fresh()
    const m = openMenu([{ label: 'One', action() {} }, { label: 'Two', action() {} }], { x: 40, y: 40 })
    assert.ok(isMenuOpen())
    assert.eq(menus().length, 1)
    assert.eq(m.el.getAttribute('role'), 'menu')
    assert.ok(m.el.hasAttribute('data-canvas-ui'))
    assert.eq(m.el.parentElement, document.body)
    assert.eq(getComputedStyle(m.el).position, 'fixed')
    m.close()
    assert.ok(!isMenuOpen())
    assert.eq(menus().length, 0)
  })

  it('only one root menu is open at a time', () => {
    fresh()
    openMenu([{ label: 'A' }], { x: 10, y: 10 })
    openMenu([{ label: 'B' }], { x: 20, y: 20 })
    assert.eq(menus().length, 1)
    assert.eq(labelOf(menus()[0].querySelector('.pf-menu-item')), 'B')
    closeMenus()
  })

  it('activating an item runs its action and closes the menu', () => {
    fresh()
    let ran = 0
    const m = openMenu([{ label: 'Run', action: () => ran++ }], { x: 10, y: 10 })
    m.el.querySelector('.pf-menu-item').click()
    assert.eq(ran, 1)
    assert.ok(!isMenuOpen())
  })

  it('keepOpen items run without closing and toggle their check', () => {
    fresh()
    let ran = 0
    const m = openMenu([{ label: 'Snap', checked: false, keepOpen: true, action: () => ran++ }], { x: 10, y: 10 })
    const item = m.el.querySelector('.pf-menu-item')
    item.click()
    assert.eq(ran, 1)
    assert.ok(isMenuOpen())
    assert.eq(item.getAttribute('aria-checked'), 'true')
    closeMenus()
  })

  it('an outside pointerdown closes it', () => {
    fresh()
    openMenu([{ label: 'A' }], { x: 10, y: 10 })
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    assert.ok(!isMenuOpen())
  })

  it('a pointerdown inside the menu keeps it open', () => {
    fresh()
    const m = openMenu([{ label: 'A' }], { x: 10, y: 10 })
    m.el.querySelector('.pf-menu-item').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    assert.ok(isMenuOpen())
    closeMenus()
  })

  it('stays inside the viewport near the bottom-right corner', () => {
    fresh()
    const items = Array.from({ length: 6 }, (_, i) => ({ label: 'Item ' + i }))
    const m = openMenu(items, { x: window.innerWidth - 4, y: window.innerHeight - 4 })
    const r = m.el.getBoundingClientRect()
    assert.ok(r.right <= window.innerWidth, 'right edge inside')
    assert.ok(r.bottom <= window.innerHeight, 'bottom edge inside')
    assert.ok(r.left >= 0 && r.top >= 0)
    closeMenus()
  })
})

describe('menu.js -- keyboard', () => {
  it('focuses the first item and ArrowDown/ArrowUp move focus, skipping disabled rows', () => {
    fresh()
    const m = openMenu([
      { label: 'First' }, { type: 'divider' }, { label: 'Off', disabled: true }, { label: 'Third' },
    ], { x: 10, y: 10 })
    assert.eq(labelOf(document.activeElement), 'First')
    key(document.activeElement, 'ArrowDown')
    assert.eq(labelOf(document.activeElement), 'Third')
    key(document.activeElement, 'ArrowDown')
    assert.eq(labelOf(document.activeElement), 'First', 'wraps around')
    key(document.activeElement, 'ArrowUp')
    assert.eq(labelOf(document.activeElement), 'Third')
    key(document.activeElement, 'Home')
    assert.eq(labelOf(document.activeElement), 'First')
    m.close()
  })

  it('Enter activates the focused item', () => {
    fresh()
    let got = ''
    openMenu([{ label: 'Alpha', action: () => { got = 'a' } }, { label: 'Beta', action: () => { got = 'b' } }], { x: 10, y: 10 })
    key(document.activeElement, 'ArrowDown')
    key(document.activeElement, 'Enter')
    assert.eq(got, 'b')
    assert.ok(!isMenuOpen())
  })

  it('Escape closes and restores focus to the element focused before', () => {
    fresh()
    const btn = document.createElement('button')
    btn.textContent = 'opener'
    document.body.appendChild(btn)
    btn.focus()
    openMenu([{ label: 'A' }, { label: 'B' }], { x: 10, y: 10 })
    assert.neq(document.activeElement, btn)
    key(document.activeElement, 'Escape')
    assert.ok(!isMenuOpen())
    assert.eq(document.activeElement, btn)
    btn.remove()
  })

  it('keys pressed in a menu never reach document shortcuts', () => {
    fresh()
    let leaked = 0
    const spy = () => leaked++
    document.addEventListener('keydown', spy)
    openMenu([{ label: 'A' }], { x: 10, y: 10 })
    key(document.activeElement, 'l')
    key(document.activeElement, 'Delete')
    document.removeEventListener('keydown', spy)
    closeMenus()
    assert.eq(leaked, 0)
  })

  it('ArrowRight opens a submenu and focuses its first item; ArrowLeft closes it', () => {
    fresh()
    let picked = ''
    openMenu([
      { label: 'Plain' },
      { label: 'More', submenu: [{ label: 'Inner one', action: () => { picked = 'inner' } }, { label: 'Inner two' }] },
    ], { x: 10, y: 10 })
    key(document.activeElement, 'ArrowDown')
    const parent = document.activeElement
    assert.eq(labelOf(parent), 'More')
    assert.eq(parent.getAttribute('aria-haspopup'), 'menu')
    key(parent, 'ArrowRight')
    assert.eq(menus().length, 2)
    assert.eq(parent.getAttribute('aria-expanded'), 'true')
    assert.eq(labelOf(document.activeElement), 'Inner one')
    key(document.activeElement, 'ArrowLeft')
    assert.eq(menus().length, 1)
    assert.eq(document.activeElement, parent)
    key(parent, 'ArrowRight')
    key(document.activeElement, 'Enter')
    assert.eq(picked, 'inner')
    assert.ok(!isMenuOpen())
  })

  it('Escape in a submenu closes only the submenu', () => {
    fresh()
    openMenu([{ label: 'More', submenu: () => [{ label: 'Inner' }] }], { x: 10, y: 10 })
    key(document.activeElement, 'ArrowRight')
    assert.eq(menus().length, 2)
    key(document.activeElement, 'Escape')
    assert.eq(menus().length, 1)
    assert.ok(isMenuOpen())
    closeMenus()
  })

  it('first-letter typeahead jumps to the next matching row', () => {
    fresh()
    openMenu([{ label: 'Goal' }, { label: 'Problem' }, { label: 'Process' }], { x: 10, y: 10 })
    key(document.activeElement, 'p')
    assert.eq(labelOf(document.activeElement), 'Problem')
    key(document.activeElement, 'p')
    assert.eq(labelOf(document.activeElement), 'Process')
    closeMenus()
  })
})

describe('menu.js -- item shapes', () => {
  it('checked items expose menuitemcheckbox and aria-checked; radio items menuitemradio', () => {
    fresh()
    const m = openMenu([
      { label: 'On', checked: true }, { label: 'Off', checked: false },
      { label: 'Dark', checked: true, radio: true }, { label: 'Plain' },
    ], { x: 10, y: 10 })
    const rows = [...m.el.querySelectorAll('.pf-menu-item')]
    assert.eq(rows[0].getAttribute('role'), 'menuitemcheckbox')
    assert.eq(rows[0].getAttribute('aria-checked'), 'true')
    assert.eq(rows[1].getAttribute('aria-checked'), 'false')
    assert.eq(rows[2].getAttribute('role'), 'menuitemradio')
    assert.eq(rows[3].getAttribute('role'), 'menuitem')
    assert.ok(!rows[3].hasAttribute('aria-checked'))
    closeMenus()
  })

  it('renders headings, dividers, hints, shortcuts, dots and danger rows', () => {
    fresh()
    const m = openMenu([
      { type: 'heading', label: 'Add here' },
      { label: 'Goal', dot: '#a78bfa', hint: 'What you want', shortcut: 'G' },
      { type: 'divider' },
      { label: 'Delete', danger: true },
    ], { x: 10, y: 10 })
    assert.eq(m.el.querySelector('.pf-menu-heading').textContent, 'Add here')
    assert.ok(m.el.querySelector('.pf-menu-divider[role=separator]'))
    assert.eq(m.el.querySelector('.pf-menu-hint').textContent, 'What you want')
    assert.eq(m.el.querySelector('.pf-menu-shortcut').textContent, 'G')
    assert.ok(m.el.querySelector('.pf-menu-dot'))
    assert.ok(m.el.querySelector('.pf-menu-danger'))
    closeMenus()
  })

  it('a swatches item calls onPick with the value and closes', () => {
    fresh()
    let picked = null
    const m = openMenu([{ type: 'swatches', label: 'Colour', onPick: v => { picked = v }, options: [
      { value: null, color: 'transparent', label: 'Default', active: true },
      { value: '#f87171', color: '#f87171', label: 'Red' },
    ] }], { x: 10, y: 10 })
    const sw = m.el.querySelectorAll('.pf-menu-swatch')
    assert.eq(sw.length, 2)
    assert.eq(sw[0].getAttribute('aria-checked'), 'true')
    assert.eq(sw[1].getAttribute('aria-label'), 'Red')
    sw[1].click()
    assert.eq(picked, '#f87171')
    assert.ok(!isMenuOpen())
  })

  it('a search item filters the rows after it and Enter picks the first match', () => {
    fresh()
    let picked = ''
    const m = openMenu([
      { type: 'search', placeholder: 'Find a type', filter: true },
      { label: 'Goal', action: () => { picked = 'goal' } },
      { label: 'Problem', action: () => { picked = 'problem' } },
      { label: 'Process', action: () => { picked = 'process' } },
    ], { x: 10, y: 10 })
    const input = m.el.querySelector('.pf-menu-search-input')
    assert.eq(document.activeElement, input, 'search takes focus')
    input.value = 'pro'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const visible = [...m.el.querySelectorAll('.pf-menu-item')].filter(r => !r.hidden).map(labelOf)
    assert.deepEq(visible, ['Problem', 'Process'])
    key(input, 'Enter')
    assert.eq(picked, 'problem')
    assert.ok(!isMenuOpen())
  })

  it('a custom item renders into its container', () => {
    fresh()
    const m = openMenu([{ type: 'custom', render: c => { c.innerHTML = '<p class="x-custom">hi</p>' } }], { x: 10, y: 10 })
    assert.ok(m.el.querySelector('.pf-menu-custom .x-custom'))
    closeMenus()
  })

  it('a field inside a custom item keeps its keys; Escape still closes the menu', () => {
    fresh()
    let input = null
    openMenu([
      { label: 'Alpha', action() {} },
      { type: 'custom', render: c => { input = document.createElement('input'); c.appendChild(input) } },
    ], { x: 10, y: 10 })
    input.focus()
    let leaked = 0
    const spy = () => leaked++
    document.addEventListener('keydown', spy)
    try {
      for (const k of ['x', 'a', ' ', 'ArrowDown', 'Home', 'End', 'Enter']) {
        const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
        input.dispatchEvent(ev)
        assert.ok(!ev.defaultPrevented, `${JSON.stringify(k)} is left to the field`)
      }
    } finally { document.removeEventListener('keydown', spy) }
    assert.eq(leaked, 0, 'nothing reached the canvas shortcuts')
    assert.eq(document.activeElement, input, 'focus stayed in the field')
    assert.ok(isMenuOpen())
    key(input, 'Escape')
    assert.ok(!isMenuOpen())
  })

  it('search: Enter never picks a row above the box, and picks nothing without a match', () => {
    const items = log => [
      { label: 'Before', action: () => log.push('before') },
      { type: 'search', placeholder: 'Find', filter: true },
      { label: 'Apple', action: () => log.push('apple') },
      { label: 'Cherry', action: () => log.push('cherry') },
    ]
    const search = (q, log) => {
      fresh()
      const m = openMenu(items(log), { x: 10, y: 10 })
      const input = m.el.querySelector('.pf-menu-search-input')
      input.value = q
      input.dispatchEvent(new Event('input', { bubbles: true }))
      key(input, 'Enter')
    }
    const a = []; search('che', a)
    assert.deepEq(a, ['cherry'])
    const b = []; search('zzz', b)
    assert.deepEq(b, [], 'no match runs nothing')
    closeMenus()
  })
})

describe('menu.js -- openDropdown', () => {
  it('anchors below the button, sets aria-expanded, and toggles closed on a second call', () => {
    fresh()
    const btn = document.createElement('button')
    btn.textContent = 'View'
    btn.style.cssText = 'position:fixed;left:30px;top:30px'
    document.body.appendChild(btn)
    const m = openDropdown(btn, [{ label: 'Theme' }])
    assert.ok(m)
    assert.eq(btn.getAttribute('aria-expanded'), 'true')
    assert.ok(m.el.getBoundingClientRect().top >= btn.getBoundingClientRect().bottom)
    const again = openDropdown(btn, [{ label: 'Theme' }])
    assert.eq(again, null)
    assert.ok(!isMenuOpen())
    assert.eq(btn.getAttribute('aria-expanded'), 'false')
    btn.remove()
  })

  it('a pointerdown on its own anchor does not close it (the click toggles)', () => {
    fresh()
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    openDropdown(btn, [{ label: 'A' }])
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    assert.ok(isMenuOpen())
    closeMenus()
    btn.remove()
  })
})
