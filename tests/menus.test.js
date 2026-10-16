// ============================================================
//  menus.test.js: the MENUS stream (design round, wave 4).
//  Menus a person can scan. menu.js groupItems shows one flat list
//  of rows (what the command palette searches) chunked into named
//  submenus with headed sections; the block, selection and
//  connection menus hold ten rows at most in groups of four at
//  most, File and View nine; the inspector's More (⋯) holds the
//  selection's own actions and the panel has no Delete button of
//  its own; a click on a port opens the type picker beside it, never
//  over the port, under the line drop's name, and a double-click keeps
//  the keyboard in it (a tap puts it on the marked row); a press on
//  the port that travels closes the picker; a submenu with no room
//  beside its menu stacks over it, inside a phone's window and cutting
//  no label; every menu sits above a toast.
// ============================================================

import { describe, it, assert, cleanupMockEls, ONSCREEN } from './test-utils.js'
import { state, ui, view, pointer, getUndoHistory, getRedoFuture, resetSnapshotToken } from '../js/state.js'
import { $, showToast, TYPES } from '../js/utils.js'
import { renderBlock, undo, deselectAll, selectBlock, setSelection, selectArrow } from '../js/render.js'
import { openMenu, closeMenus, isMenuOpen, groupItems, tidyDividers } from '../js/menu.js'
import { blockMenu, blockMenuItems, multiMenu, multiMenuItems, arrowMenu, arrowMenuItems,
         openBlockMenu, openPortMenu, moreMenuItems, setupContextMenu, selectionMenuItems } from '../js/context-menu.js'
import { fileMenu, fileMenuItems, viewMenu, viewMenuItems, openHeaderMenu, closeInlineMenus, setLightMode } from '../js/view-menu.js'
import { commandGroups } from '../js/command-items.js'
import { setupCanvasPointerEvents } from '../js/events.js'
import { setupInspectorEvents } from '../js/inspector.js'
import { suggestedNextTypes } from '../js/create.js'
import { applyTransform } from '../js/canvas.js'
import { isInlineEditing, commitInlineEdit } from '../js/inline-edit.js'
import { openQuickCreate } from '../js/navigation.js'

// ── Helpers ──────────────────────────────────────────────────
const history = () => getUndoHistory().length
const byId = id => document.getElementById(id)

function inspectorStubs() {
  if (byId('multiCount')) return
  const span = document.createElement('span')
  span.id = 'multiCount'
  ;(byId('inspectorMulti') || document.body).appendChild(span)
}

function reset() {
  inspectorStubs()
  closeMenus()
  closeInlineMenus()
  if (isInlineEditing()) commitInlineEdit()
  cleanupMockEls()
  pointer.ix = null
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  ui.embed = false
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
  setupContextMenu()
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '',
    x: 40, y: 40, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, highlight: null, cardStyle: null, ...extra }
  renderBlock(id)
}
function arrow(id, from, to, extra = {}) {
  const a = { id, from, to, style: 'routed', pattern: 'solid', bidirectional: false, color: null, weight: 1.5,
    fromPort: null, toPort: null, ...extra }
  state.arrows.push(a)
  return a
}

// A map where a block has everything a menu can offer: connections both
// ways (upstream, downstream, a connection to select), a sibling of its
// type, and a block it can still connect to.
function fullMap() {
  block('a', { type: 'goal', x: 0, y: 0 })
  block('b', { type: 'metric', x: 400, y: 0 })
  block('c', { type: 'requirement', x: 800, y: 0 })
  block('d', { type: 'goal', x: 0, y: 400 })
  block('e', { type: 'risk', x: 400, y: 400 })
  arrow('ba', 'b', 'a'); arrow('ac', 'a', 'c')
}

const rowsOf = list => list.filter(i => i && !i.type)
const isRow = i => i && (!i.type || i.type === 'swatches')
const labelsOf = list => list.filter(isRow).map(i => i.label)

// The rows of a chunked menu as data: its top level split at dividers.
function chunks(list) {
  const out = [[]]
  for (const i of list) {
    if (i.type === 'divider') out.push([])
    else if (isRow(i)) out[out.length - 1].push(i)
  }
  return out.filter(c => c.length)
}

// Every action a person can reach in a chunked menu, by label: its rows,
// and inside each named group its plain rows and its sections (an inline
// row shows as its heading, its choices under it). Regular submenus
// (Change type, Add connected) are not walked: their own row reaches them.
function reachable(list, groupLabels) {
  const out = new Set()
  for (const i of rowsOf(list)) {
    out.add(i.label)
    if (!groupLabels.includes(i.label) || !i.submenu) continue
    let inSection = false
    for (const j of i.submenu()) {
      if (j.type === 'heading') { out.add(j.label); inSection = true }
      else if (j.type === 'divider') inSection = false
      else if (isRow(j) && !inSection) out.add(j.label)
    }
  }
  return out
}

const BLOCK_GROUPS = ['Planning', 'Appearance', 'Select and zoom', 'Arrange', 'Line']

// The DOM menus that are open.
const menus = () => [...document.querySelectorAll('.pf-menu')]
const lastMenu = () => { const all = menus(); return all[all.length - 1] }
const labelOf = row => row.querySelector('.pf-menu-label')?.textContent
const domRows = m => [...m.children].filter(n => n.classList.contains('pf-menu-item') && !n.hidden)
const domLabels = m => domRows(m).map(labelOf)
function openRow(label, m = lastMenu()) {
  const row = domRows(m).find(r => labelOf(r) === label)
  assert.ok(row, `row "${label}" (have: ${domLabels(m).join(', ')})`)
  row.click()
  return lastMenu()
}

// The real stylesheet in this page, for the checks that measure.
async function withStyles(fn) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = '../css/style.css'
  await new Promise(res => { link.onload = res; link.onerror = res; document.head.appendChild(link) })
  try { return await fn() } finally { link.remove() }
}

// ── groupItems ───────────────────────────────────────────────
describe('menus: groupItems chunks a flat list', () => {
  it('gathers tagged rows into one named submenu where the first stood, and keeps the rest in place', () => {
    const flat = [
      { label: 'One' },
      { label: 'Status', group: 'g', submenu: () => [{ label: 'Done' }] },
      { label: 'Two' },
      { label: 'Priority', group: 'g', submenu: () => [{ label: 'High' }] },
      { type: 'divider' },
      { label: 'Three' },
    ]
    const out = groupItems(flat, { g: { label: 'Planning', ctx: 'planning' } })
    assert.deepEq(out.map(i => i.type || i.label), ['One', 'Planning', 'Two', 'divider', 'Three'])
    assert.eq(out[1].ctx, 'planning', 'the group row carries its config')
    assert.deepEq(labelsOf(out[1].submenu()), ['Status', 'Priority'], 'not inline: the rows keep their submenus')
    assert.ok(out[1].submenu()[0].submenu, 'Status is still a submenu inside the group')
  })

  it('a group of one row shows that row, an empty group nothing, and an unknown group key is left alone', () => {
    const only = { label: 'Zoom', group: 'g' }
    const out = groupItems([{ label: 'A' }, { type: 'divider', group: 'g' }, only, { label: 'B', group: 'nope' }],
      { g: { label: 'Select' }, h: { label: 'Never' } })
    assert.deepEq(out.map(i => i.label || i.type), ['A', 'Zoom', 'B'])
    assert.eq(out[1], only, 'the row itself, not a submenu of one')
  })

  it('an inline row becomes a headed section; a plain row after a section gets a divider; tagged dividers stay inside', () => {
    const flat = [
      { label: 'Status', group: 'g', inline: true, submenu: () => [{ label: 'Done', radio: true }, { label: 'Blocked', radio: true }] },
      { label: 'Priority', group: 'g', inline: true, submenu: () => [{ label: 'High', radio: true }] },
      { label: 'Add question', group: 'g' },
      { type: 'divider', group: 'g' },
      { label: 'Zoom', group: 'g' },
    ]
    const sub = groupItems(flat, { g: { label: 'Planning' } })[0].submenu()
    assert.deepEq(sub.map(i => (i.type === 'heading' ? '# ' + i.label : i.type || i.label)),
      ['# Status', 'Done', 'Blocked', 'divider', '# Priority', 'High', 'divider', 'Add question', 'divider', 'Zoom'])
  })

  it('a group built from a function reads fresh rows each time it opens', () => {
    let on = false
    const build = () => [{ label: 'Light', group: 'g', checked: on, keepOpen: true }, { label: 'Dark', group: 'g', checked: !on }]
    const [row] = groupItems(build, { g: { label: 'Theme', liveHint: () => (on ? 'Light' : 'Dark') } })
    assert.eq(row.hint, 'Dark', 'the hint is read when the menu is built')
    assert.eq(row.submenu()[0].checked, false)
    on = true
    assert.eq(row.submenu()[0].checked, true, 'opened again, the mark is current')
  })

  it('tidyDividers drops leading, trailing and doubled dividers', () => {
    const D = { type: 'divider' }
    assert.deepEq(tidyDividers([D, { label: 'a' }, D, D, { label: 'b' }, D]).map(i => i.type || i.label), ['a', 'divider', 'b'])
    assert.deepEq(tidyDividers([D, null, D]), [])
  })
})

// ── Sections in a menu ───────────────────────────────────────
describe('menus: sections inside one menu', () => {
  it('a heading describes the rows under it, up to the next divider', () => {
    reset()
    const m = openMenu([
      { type: 'heading', label: 'Status' }, { label: 'Done', radio: true, checked: false, action() {} },
      { type: 'divider' }, { label: 'Plain', action() {} },
    ], { x: 20, y: 20 })
    try {
      const [heading] = m.el.querySelectorAll('.pf-menu-heading')
      const [done, plain] = domRows(m.el)
      assert.ok(heading.id, 'the heading has an id')
      assert.eq(done.getAttribute('aria-describedby'), heading.id, 'Done is described by Status')
      assert.ok(!plain.hasAttribute('aria-describedby'), 'a row past the divider is not')
    } finally { closeMenus() }
  })

  it('a kept-open radio unchecks only the radios of its own section', () => {
    reset()
    const picked = []
    const radio = (label, checked) => ({ label, radio: true, checked, keepOpen: true, action: () => picked.push(label) })
    const m = openMenu([
      { type: 'heading', label: 'Theme' }, radio('Dark', true), radio('Light', false),
      { type: 'heading', label: 'Size' }, radio('Small', true), radio('Large', false),
    ], { x: 20, y: 20 })
    try {
      domRows(m.el).find(r => labelOf(r) === 'Light').click()
      const checked = domRows(m.el).filter(r => r.getAttribute('aria-checked') === 'true').map(labelOf)
      assert.deepEq(checked, ['Light', 'Small'], 'Size keeps its choice')
      assert.deepEq(picked, ['Light'])
      assert.ok(isMenuOpen())
    } finally { closeMenus() }
  })

  it('a submenu row with a liveHint says what a kept-open pick inside it changed, at once', () => {
    reset()
    let theme = 'Dark'
    const m = openMenu(groupItems(() => [
      { label: 'Dark theme', radio: true, checked: theme === 'Dark', keepOpen: true, group: 't', action: () => { theme = 'Dark' } },
      { label: 'Light theme', radio: true, checked: theme === 'Light', keepOpen: true, group: 't', action: () => { theme = 'Light' } },
    ], { t: { label: 'Theme', liveHint: () => theme } }), { x: 20, y: 20 })
    try {
      const row = domRows(m.el)[0]
      assert.eq(row.querySelector('.pf-menu-hint').textContent, 'Dark')
      row.click()
      domRows(lastMenu()).find(r => labelOf(r) === 'Light theme').click()
      assert.eq(theme, 'Light')
      assert.eq(row.querySelector('.pf-menu-hint').textContent, 'Light', 'the row says Light without reopening')
      assert.eq(menus().length, 2, 'the submenu stays open')
    } finally { closeMenus() }
  })
})

// ── The block menu ───────────────────────────────────────────
describe('menus: the block menu', () => {
  it('ten rows at most, in groups of four at most, Delete alone and last, for a block with everything to offer', () => {
    reset(); fullMap()
    const before = blockMenuItems('a').filter(i => !i.type).length
    assert.gte(before, 17, `the flat list still has every action (${before})`)
    const list = blockMenu('a')
    const top = rowsOf(list)
    assert.ok(top.length <= 10, `${top.length} rows: ${labelsOf(list).join(', ')}`)
    chunks(list).forEach(c => assert.ok(c.length <= 4, `a group of ${c.length}: ${c.map(i => i.label).join(', ')}`))
    assert.deepEq(labelsOf(list), ['Edit title', 'Edit description', 'Change type', 'Add connected', 'Connect to…',
      'Duplicate', 'Planning', 'Appearance', 'Select and zoom', 'Delete'])
    const last = chunks(list).pop()
    assert.deepEq(last.map(i => i.label), ['Delete'], 'the destructive row stands alone at the foot')
    assert.ok(last[0].danger)
  })

  it('every action in the flat list is in the menu, and the menu adds only the group names', () => {
    reset(); fullMap()
    const flat = new Set(labelsOf(blockMenuItems('a')))
    const seen = reachable(blockMenu('a'), BLOCK_GROUPS)
    flat.forEach(l => assert.ok(seen.has(l), `"${l}" is reachable`))
    seen.forEach(l => assert.ok(flat.has(l) || BLOCK_GROUPS.includes(l), `"${l}" comes from the flat list`))
  })

  it('the command palette reads the flat list, so a row moved into a group is still found by name', () => {
    reset(); fullMap()
    selectBlock('a')
    const rows = commandGroups().find(g => g.key === 'selection').items.map(r => r.label)
    ;['Select upstream', 'Select downstream', 'Select all 2 goals', 'Status', 'Priority', 'Add question',
      'Highlight', 'Colour', 'Card style', 'Collapse', 'Zoom to block', 'Delete'].forEach(l => assert.includes(rows, l))
    assert.eq(selectionMenuItems().items.length, blockMenuItems('a').length, 'the palette gets the flat rows')
  })

  it('Planning holds Status and Priority as sections: picking one leaves the other alone, one undo step each', () => {
    reset(); block('a', { priority: 'high' })
    openBlockMenu('a', 40, 40)
    let sub = openRow('Planning')
    const headings = [...sub.querySelectorAll('.pf-menu-heading')].map(h => h.textContent)
    assert.deepEq(headings, ['Status', 'Priority'])
    domRows(sub).find(r => labelOf(r) === 'Done').click()
    assert.eq(state.blocks.a.status, 'done')
    assert.eq(state.blocks.a.priority, 'high', 'Priority untouched')
    openBlockMenu('a', 40, 40)
    sub = openRow('Planning')
    const checked = domRows(sub).filter(r => r.getAttribute('aria-checked') === 'true').map(labelOf)
    assert.deepEq(checked, ['Done', 'High'])
    assert.eq(history(), 1)
    closeMenus()
  })

  it('Appearance sets a block\'s own card style in one undo step; Map default gives it back to the map', () => {
    reset(); block('a')
    openBlockMenu('a', 40, 40)
    let sub = openRow('Appearance')
    domRows(sub).find(r => labelOf(r) === 'Tinted').click()
    assert.eq(state.blocks.a.cardStyle, 'tint')
    assert.eq(history(), 1)
    openBlockMenu('a', 40, 40)
    sub = openRow('Appearance')
    assert.eq(domRows(sub).find(r => labelOf(r) === 'Tinted').getAttribute('aria-checked'), 'true')
    domRows(sub).find(r => labelOf(r) === 'Map default').click()
    assert.eq(state.blocks.a.cardStyle, null)
    undo()
    assert.eq(state.blocks.a.cardStyle, 'tint', 'one undo step each')
  })

  it('Zoom to block is in Select and zoom whatever the block has around it, never a row that moves', () => {
    reset(); fullMap()
    const zoomIn = list => {
      const top = rowsOf(list)
      assert.ok(!top.some(i => i.label === 'Zoom to block'), 'not on the top level')
      const group = top.find(i => i.label === 'Select and zoom')
      assert.ok(group && group.submenu, 'Select and zoom is a submenu')
      return labelsOf(group.submenu())
    }
    const busy = zoomIn(blockMenu('a'))
    assert.ok(busy.includes('Select upstream') && busy.includes('Zoom to block'), busy.join(', '))
    assert.eq(busy[busy.length - 1], 'Zoom to block', 'the camera last, after the selections')
    // A block with nothing around it: the group holds the camera row alone,
    // and stays a submenu, so the row is where it always is.
    assert.deepEq(zoomIn(blockMenu('e')), ['Zoom to block'])
  })

  it('a view-only link gets the camera row and nothing else', () => {
    reset(); fullMap()
    ui.readOnly = true
    try { assert.deepEq(labelsOf(blockMenu('a')), ['Zoom to block']) } finally { ui.readOnly = false }
  })
})

// ── Selection and connection menus ───────────────────────────
describe('menus: the selection and connection menus', () => {
  it('a selection: ten rows at most, groups of four at most, every action reachable', () => {
    reset(); fullMap()
    const ids = ['a', 'b', 'c']
    const list = multiMenu(ids)
    assert.ok(rowsOf(list).length <= 10)
    chunks(list).forEach(c => assert.ok(c.length <= 4, c.map(i => i.label).join(', ')))
    assert.deepEq(labelsOf(list), ['Change type', 'Planning', 'Appearance', 'Arrange', 'Duplicate all', 'Zoom to selection', 'Delete 3 blocks'])
    const seen = reachable(list, BLOCK_GROUPS)
    labelsOf(multiMenuItems(ids)).forEach(l => assert.ok(seen.has(l), `"${l}" is reachable`))
  })

  it('a selection takes a colour and a priority in one undo step each', () => {
    reset(); block('a'); block('b', { x: 400, type: 'risk' })
    setSelection(['a', 'b'])
    const list = multiMenu(['a', 'b'])
    const appearance = rowsOf(list).find(i => i.label === 'Appearance').submenu()
    const colours = appearance.find(i => i.type === 'swatches' && i.label === 'Colour')
    assert.ok(colours, 'Colour for several blocks')
    colours.onPick('#1794b5')
    assert.deepEq(['a', 'b'].map(id => state.blocks[id].color), ['#1794b5', '#1794b5'])
    assert.eq(history(), 1)
    const planning = rowsOf(multiMenu(['a', 'b'])).find(i => i.label === 'Planning').submenu()
    planning.find(i => i.label === 'Low').action()
    assert.deepEq(['a', 'b'].map(id => state.blocks[id].priority), ['low', 'low'])
    assert.eq(history(), 2)
  })

  it('a connection: ten rows at most, its look in one Line submenu, every action reachable', () => {
    reset(); fullMap()
    state.arrows[0].fromPort = 'right'
    const list = arrowMenu('ba', { clientX: 0, clientY: 0 })
    assert.ok(rowsOf(list).length <= 10, labelsOf(list).join(', '))
    chunks(list).forEach(c => assert.ok(c.length <= 4, c.map(i => i.label).join(', ')))
    assert.deepEq(labelsOf(list), ['Edit label', 'Meaning', 'Reverse direction', 'Two-way', 'Line', 'Insert block',
      'Reset ends to auto', 'Go to source', 'Go to target', 'Delete'])
    const line = rowsOf(list).find(i => i.label === 'Line').submenu()
    assert.deepEq(line.filter(i => i.type === 'heading').map(i => i.label), ['Route', 'Pattern', 'Weight', 'Colour'])
    const seen = reachable(list, BLOCK_GROUPS)
    labelsOf(arrowMenuItems('ba', {})).forEach(l => assert.ok(seen.has(l), `"${l}" is reachable`))
  })
})

// ── File and View ────────────────────────────────────────────
let pageDoc = null
async function indexDoc() {
  if (!pageDoc) pageDoc = new DOMParser().parseFromString(await (await fetch('../index.html', { cache: 'no-store' })).text(), 'text/html')
  return pageDoc
}

describe('menus: File and View', () => {
  it('File: Import and Export, Copy and Hand off, then Clear; every File row inside', async () => {
    const src = (await indexDoc()).getElementById('fileActions')
    const list = fileMenu(src, { readOnly: false })
    assert.deepEq(list.map(i => i.type || i.label), ['Import JSON / Canvas / Mermaid…', 'Export', 'divider', 'Copy', 'Hand off', 'divider', 'Clear this map'])
    assert.ok(rowsOf(list).length <= 9)
    assert.ok(rowsOf(list).every(i => i.icon && i.icon.startsWith('<svg')), 'every row has its icon')
    const sub = label => rowsOf(list).find(i => i.label === label).submenu()
    assert.deepEq(labelsOf(sub('Export')), ['Download JSON', 'Download Markdown', 'Download JSON Canvas', 'Download spec bundle (zip)',
      'Download image (PNG 2×)', 'Download vector (SVG)'])
    assert.deepEq(sub('Export').map(i => i.type || 'row'), ['row', 'row', 'row', 'row', 'divider', 'row', 'row'], 'the pictures apart')
    assert.includes(labelsOf(sub('Copy')), 'Copy brief')
    assert.eq(labelsOf(sub('Hand off')).length, 2)
    const seen = reachable(list, ['Export', 'Copy', 'Hand off'])
    fileMenuItems(src, { readOnly: false }).filter(i => !i.type).forEach(i => assert.ok(seen.has(i.label), `"${i.label}" is reachable`))
    assert.ok(rowsOf(sub('Copy')).find(i => i.rowId === 'exportCopyPrompt').shortcut, 'Copy brief keeps its key')
  })

  it('File on a view-only link: Export, and Copy Mermaid on its own (a group of one is its row)', async () => {
    const src = (await indexDoc()).getElementById('fileActions')
    const list = fileMenu(src, { readOnly: true })
    assert.deepEq(labelsOf(list), ['Export', 'Copy Mermaid'])
    assert.deepEq(labelsOf(rowsOf(list)[0].submenu()), ['Download Markdown', 'Download image (PNG 2×)', 'Download vector (SVG)'])
  })

  it('View: Theme, Display, Lines, Snap to grid, Facilitation, then the map\'s own; every View row inside', () => {
    reset()
    const list = viewMenu()
    assert.ok(rowsOf(list).length <= 9, labelsOf(list).join(', '))
    assert.deepEq(list.map(i => (i.type === 'heading' ? '#' : i.type === 'divider' ? '-' : i.label)),
      ['#', 'Theme', 'Display', 'Lines', '-', 'Snap to grid', 'Facilitation', '#', 'Card style', 'Spotlight: fade unhighlighted'])
    // DESIGN.md: groups of three or four at most, between dividers or headings.
    const runs = [[]]
    list.forEach(i => (i.type === 'divider' || i.type === 'heading' ? runs.push([]) : runs[runs.length - 1].push(i.label)))
    runs.forEach(r => assert.ok(r.length <= 4, `a group of ${r.length}: ${r.join(', ')}`))
    const seen = reachable(list, ['Theme', 'Display', 'Lines'])
    labelsOf(viewMenuItems()).forEach(l => assert.ok(seen.has(l), `"${l}" is reachable`))
    assert.eq(rowsOf(list).find(i => i.label === 'Theme').hint, ui.lightMode ? 'Light' : 'Dark', 'Theme says which')
  })

  it('View on a view-only link and in an embed keeps only what works there', () => {
    reset()
    ui.readOnly = true
    try {
      assert.deepEq(labelsOf(viewMenu()), ['Theme', 'Display', 'Always show connection notes', 'Facilitation'],
        'Lines has one row there, so it is that row')
      ui.embed = true
      assert.deepEq(labelsOf(viewMenu()), ['Theme', 'Display', 'Always show connection notes'], 'no Facilitation in an embed')
    } finally { ui.readOnly = false; ui.embed = false }
  })

  it('in the phone\'s overflow panel a group opens in place, and a toggle inside it keeps it open with its summary current', () => {
    reset()
    const wasLight = ui.lightMode
    setLightMode(false)
    const panel = document.createElement('div')
    panel.className = 'header-overflow-menu'
    const btn = document.createElement('button')
    btn.textContent = 'View'
    panel.appendChild(btn)
    document.body.appendChild(panel)
    try {
      openHeaderMenu(btn, viewMenu, 'View')
      const list = panel.querySelector('.hdr-inline-menu')
      assert.ok(list, 'the list opens under its button')
      const row = label => [...panel.querySelectorAll('.hdr-inline-item')].find(b => b.querySelector('.hdr-inline-label').textContent === label)
      assert.eq(row('Theme').querySelector('.hdr-inline-hint').textContent, 'Dark')
      row('Theme').click()
      assert.eq(row('Theme').getAttribute('aria-expanded'), 'true')
      row('Light theme').click()
      assert.ok(ui.lightMode, 'the pick ran')
      const sub = panel.querySelector('.hdr-inline-sub')
      assert.ok(sub, 'the submenu is still open')
      assert.eq(row('Light theme').getAttribute('aria-pressed'), 'true', 'its mark is current')
      assert.eq(document.activeElement, row('Light theme'), 'focus stays on the row')
      assert.eq(row('Theme').querySelector('.hdr-inline-hint').textContent, 'Light', 'and Theme says Light')
      // Escape folds one level at a time: the submenu to its row, then the list.
      const esc = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      esc()
      assert.ok(!panel.querySelector('.hdr-inline-sub'), 'the submenu folds')
      assert.ok(panel.querySelector('.hdr-inline-menu'), 'the list stays')
      assert.eq(document.activeElement, row('Theme'))
      assert.eq(row('Theme').getAttribute('aria-expanded'), 'false')
      esc()
      assert.ok(!panel.querySelector('.hdr-inline-menu'), 'then the list folds')
      assert.eq(document.activeElement, btn)
    } finally {
      closeInlineMenus(); panel.remove(); setLightMode(wasLight)
    }
  })
})

// ── The inspector's More ─────────────────────────────────────
const host = { el: null, placeholders: [], mounted: false }
async function mount() {
  if (host.mounted) return
  const doc = await indexDoc()
  const pane = document.importNode(doc.getElementById('inspectorPane'), true)
  pane.querySelectorAll('[id]').forEach(n => {
    const stub = byId(n.id)
    if (!stub) return
    const mark = document.createComment('stub ' + n.id)
    stub.replaceWith(mark)
    host.placeholders.push({ mark, stub })
  })
  host.el = document.createElement('div')
  host.el.className = 'panel-content'
  host.el.style.cssText = 'position:fixed;right:0;top:0;width:320px;height:600px;overflow:auto;z-index:5'
  host.el.appendChild(pane)
  document.body.appendChild(host.el)
  setupInspectorEvents()
  host.mounted = true
}
function unmount() {
  closeMenus()
  deselectAll()
  host.el?.remove()
  host.placeholders.forEach(({ mark, stub }) => mark.replaceWith(stub))
  host.placeholders = []
  host.mounted = false
}
function openMore(id) {
  closeMenus()
  byId(id).click()
  const m = lastMenu()
  assert.ok(m?.classList.contains('insp-more-menu'), `#${id} opened More`)
  return m
}

describe('menus: the inspector\'s More', () => {
  it('the panel has no Delete button of its own: one block, several and a connection each have More in the header', async () => {
    const doc = await indexDoc()
    assert.eq(doc.querySelectorAll('.insp-delete-btn').length, 0)
    assert.ok(doc.querySelector('#inspectorContent .insp-head #inspMoreBtn'))
    assert.ok(doc.querySelector('#inspectorMulti .insp-head #multiMoreBtn'))
    assert.ok(doc.querySelector('#inspectorArrow .insp-arrow-head #arrowMoreBtn'))
    ;['inspMoreBtn', 'multiMoreBtn', 'arrowMoreBtn'].forEach(id => {
      const b = doc.getElementById(id)
      assert.eq(b.tagName, 'BUTTON')
      assert.eq(b.getAttribute('aria-haspopup'), 'menu')
      assert.ok(b.getAttribute('aria-label'), `${id} has a name`)
    })
  })

  it('one block: Change type, Duplicate, Delete and the rest of its menu, without the fields the panel shows', async () => {
    reset(); await mount()
    try {
      fullMap()
      selectBlock('a')
      const m = openMore('inspMoreBtn')
      assert.deepEq(domLabels(m), ['Change type', 'Add connected', 'Connect to…', 'Duplicate', 'Planning', 'Appearance', 'Select and zoom', 'Delete'])
      assert.ok(m.querySelector('[data-ctx="delete"]'), 'rows carry their action names')
      assert.eq(moreMenuItems().kind, 'block')
      openRow('Duplicate', m)
      assert.eq(Object.keys(state.blocks).length, 6)
      assert.eq(history(), 1)
    } finally { unmount() }
  })

  it('several blocks: Delete in More removes them in one undo step and gives the keyboard to the canvas', async () => {
    reset(); await mount()
    const vp = $.canvasViewport(), display = vp.style.display
    vp.style.display = ''; vp.tabIndex = 0
    try {
      block('a'); block('b', { x: 400 })
      setSelection(['a', 'b'])
      const m = openMore('multiMoreBtn')
      assert.deepEq(domLabels(m), ['Change type', 'Planning', 'Appearance', 'Arrange', 'Duplicate all', 'Zoom to selection', 'Delete 2 blocks'])
      openRow('Delete 2 blocks', m)
      assert.eq(Object.keys(state.blocks).length, 0)
      assert.eq(history(), 1)
      assert.eq(document.activeElement, vp, 'not the hidden button')
      undo()
      assert.eq(Object.keys(state.blocks).length, 2)
    } finally { vp.style.display = display; vp.removeAttribute('tabindex'); unmount() }
  })

  it('a connection: More holds what the panel cannot do (none of its fields again), and Delete removes it', async () => {
    reset(); await mount()
    try {
      block('a'); block('b', { x: 400 }); arrow('ab', 'a', 'b', { fromPort: 'right' })
      selectArrow('ab')
      const m = openMore('arrowMoreBtn')
      // The panel shows the label, Meaning, the line's route, pattern, heads
      // (Two-way), weight and colour, Reverse beside More, and Reset ends to
      // auto; More used to list most of them a second time.
      assert.deepEq(domLabels(m), ['Insert block', 'Go to source', 'Go to target', 'Delete'])
      openRow('Delete', m)
      assert.eq(state.arrows.length, 0)
      assert.eq(history(), 1)
    } finally { unmount() }
  })

  it('a view-only link: More shows what works there, and a second press closes it', async () => {
    reset(); await mount()
    ui.readOnly = true
    try {
      block('a'); block('b', { x: 400 }); arrow('ab', 'a', 'b')
      selectBlock('a')
      assert.ok(!byId('inspMoreBtn').hidden)
      assert.deepEq(domLabels(openMore('inspMoreBtn')), ['Zoom to block'])
      byId('inspMoreBtn').click()
      assert.ok(!isMenuOpen(), 'a dropdown toggles')
      setSelection(['a', 'b'])
      assert.deepEq(domLabels(openMore('multiMoreBtn')), ['Zoom to selection'])
      selectArrow('ab')
      assert.deepEq(domLabels(openMore('arrowMoreBtn')), ['Go to source', 'Go to target'])
    } finally { ui.readOnly = false; unmount() }
  })
})

// ── A click on a port ────────────────────────────────────────
const ptr = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: 9, button: 0, buttons: type === 'pointerup' ? 0 : 1,
  clientX: x, clientY: y, isPrimary: true, pointerType: 'mouse', ...extra }))
const key = (k, target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
const clickPort = (id, side, x = 100, y = 100) => {
  const port = document.querySelector(`#b-${id} .port-${side}`)
  ptr(port, 'pointerdown', x, y); ptr(port, 'pointerup', x, y)
  return port
}
const picker = () => document.querySelector('.pf-menu.ctx-port-menu')

describe('menus: a click on a port', () => {
  it('opens the picker with the usual next type marked, and creates nothing until one is picked', () => {
    reset(); setupCanvasPointerEvents()
    block('p1', { type: 'risk' })
    clickPort('p1', 'right')
    const m = picker()
    assert.ok(m, 'the picker is open')
    assert.ok(m.classList.contains('ctx-add-menu'), 'the same picker as a dropped line')
    assert.eq(m.querySelector('.pf-menu-heading').textContent, `Add after ${TYPES.risk.label}`)
    assert.eq(document.activeElement, m.querySelector('.pf-menu-search-input'), 'typing filters at once')
    const suggested = suggestedNextTypes('risk')
    const firstRows = domRows(m).slice(0, suggested.length).map(r => r.dataset.addType)
    assert.deepEq(firstRows, suggested, 'suggestions first')
    assert.eq(m.querySelector('.pf-menu-match')?.dataset.addType, suggested[0], 'the first is the row Enter picks')
    assert.eq(Object.keys(state.blocks).length, 1)
    assert.eq(history(), 0)
    closeMenus()
  })

  it('Escape creates nothing and takes no undo step', () => {
    reset(); setupCanvasPointerEvents()
    block('p2')
    clickPort('p2', 'right')
    key('Escape', picker().querySelector('.pf-menu-search-input'))
    assert.ok(!picker(), 'closed')
    assert.eq(Object.keys(state.blocks).length, 1)
    assert.eq(state.arrows.length, 0)
    assert.eq(history(), 0)
  })

  it('a pick grows the block out of the side that was clicked, connected, in one undo step', () => {
    reset(); setupCanvasPointerEvents()
    const sides = { left: (n, s) => n.x < s.x, top: (n, s) => n.y < s.y, bottom: (n, s) => n.y > s.y, right: (n, s) => n.x > s.x }
    Object.entries(sides).forEach(([side, ok], i) => {
      const id = 'p3' + side
      block(id, { x: 2000 * (i + 1), y: 2000 })
      clickPort(id, side)
      const input = picker().querySelector('.pf-menu-search-input')
      input.value = 'Risk'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      key('Enter', input)
      if (isInlineEditing()) commitInlineEdit()
      const fresh = Object.values(state.blocks).find(b => b.type === 'risk' && state.arrows.some(a => a.from === id && a.to === b.id))
      assert.ok(fresh, `${side}: a risk connected from ${id}`)
      assert.ok(ok(fresh, state.blocks[id]), `${side}: on that side`)
    })
    assert.eq(history(), 4, 'one undo step each')
  })

  it('a tap puts the keyboard on the marked row, not the filter (which raises a phone\'s keyboard over the rows)', () => {
    reset(); setupCanvasPointerEvents()
    block('p7')
    const port = document.querySelector('#b-p7 .port-right')
    const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 11, button: 0, buttons: 1,
      clientX: 100, clientY: 100, isPrimary: true, pointerType: 'touch' })
    port.dispatchEvent(down)
    assert.ok(down.defaultPrevented, 'a touch press on a port is cancelled, so its mousedown cannot move focus to the card')
    ptr(port, 'pointerup', 100, 100, { pointerId: 11, pointerType: 'touch' })
    const m = picker()
    assert.ok(m, 'and the tap still opens the picker')
    const marked = m.querySelector('.pf-menu-match')
    assert.ok(marked, 'a row is marked')
    assert.eq(document.activeElement, marked, 'the marked row has the keyboard')
    assert.ok(document.activeElement !== m.querySelector('.pf-menu-search-input'), 'the filter waits for a tap of its own')
    // A double tap's second press hands focus back to that row, not to the filter.
    const stray = document.createElement('button')
    document.body.appendChild(stray); stray.focus()
    port.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 11, button: 0, buttons: 1,
      clientX: 100, clientY: 100, isPrimary: true, pointerType: 'touch' }))
    ptr(port, 'pointerup', 100, 100, { pointerId: 11, pointerType: 'touch' })
    stray.remove()
    assert.eq(document.querySelectorAll('.pf-menu.ctx-port-menu').length, 1, 'one picker')
    assert.eq(document.activeElement, marked, 'the row again')
    key('Enter', marked)
    if (isInlineEditing()) commitInlineEdit()
    assert.eq(Object.keys(state.blocks).length, 2, 'Enter on it adds that type')
    assert.eq(history(), 1)
    closeMenus()
    pointer.ix = null
    const mouse = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 12, button: 0, buttons: 1,
      clientX: 100, clientY: 100, isPrimary: true, pointerType: 'mouse' })
    const left = document.querySelector('#b-p7 .port-left')
    left.dispatchEvent(mouse)
    assert.ok(!mouse.defaultPrevented, 'a mouse press is left alone')
    // Let go of that press, so the next test's press is not a second finger.
    left.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 12, pointerType: 'mouse' }))
    assert.eq(pointer.ix, null)
  })

  it('a double-click keeps the keyboard in the picker: the second press took focus to the card, its release gives it back', () => {
    reset(); setupCanvasPointerEvents()
    block('p8', { type: 'goal' })
    const port = document.querySelector('#b-p8 .port-right')
    ptr(port, 'pointerdown', 100, 100, { detail: 1 }); ptr(port, 'pointerup', 100, 100, { detail: 1 })
    const input = picker().querySelector('.pf-menu-search-input')
    assert.eq(document.activeElement, input)
    // The browser's own default for the second mousedown: focus what is
    // under it (the card, or a row of a picker that covered the port).
    ptr(port, 'pointerdown', 100, 100, { detail: 2 })
    // (The canvas is not laid out on this page, so a button stands in for
    // whatever the press focused.)
    const stray = document.createElement('button')
    document.body.appendChild(stray)
    stray.focus()
    assert.eq(document.activeElement, stray, 'focus left the picker, as the browser moves it')
    ptr(port, 'pointerup', 100, 100, { detail: 2 })
    stray.remove()
    assert.eq(document.querySelectorAll('.pf-menu.ctx-port-menu').length, 1, 'one picker')
    assert.eq(document.activeElement, input, 'the filter has the keyboard again')
    key('Enter', input)
    if (isInlineEditing()) commitInlineEdit()
    assert.eq(Object.keys(state.blocks).length, 2, 'Enter took the marked type')
    assert.eq(state.blocks.p8.title, 'p8', 'and did not edit the source card')
    assert.eq(history(), 1)
  })

  it('a view-only link: a click on a port opens nothing', () => {
    reset(); setupCanvasPointerEvents()
    block('p4')
    ui.readOnly = true
    try {
      renderBlock('p4')
      clickPort('p4', 'right')
      assert.ok(!picker())
      assert.eq(openPortMenu('p4', 'right', document.querySelector('#b-p4 .port-right')), null)
    } finally { ui.readOnly = false }
  })

  it('opens beside the port, off the card, never over the port itself', async () => {
    reset(); setupCanvasPointerEvents()
    await withStyles(async () => {
      const vp = $.canvasViewport(), root = $.canvasRoot()
      const prev = [vp.style.cssText, root.style.cssText]
      const saved = { ...view }
      vp.style.cssText = 'display:block;position:fixed;left:0;top:0;width:1000px;height:700px;overflow:hidden'
      Object.assign(view, { panX: 0, panY: 0, zoom: 1 })
      applyTransform()
      try {
        block('p5', { x: 420, y: 250 })
        for (const side of ['right', 'left', 'bottom']) {
          closeMenus()
          const port = document.querySelector(`#b-p5 .port-${side}`)
          const r = port.getBoundingClientRect()
          ptr(port, 'pointerdown', r.x + 2, r.y + 2); ptr(port, 'pointerup', r.x + 2, r.y + 2)
          const m = picker()
          assert.ok(m, `${side}: open`)
          const mr = m.getBoundingClientRect(), card = document.getElementById('b-p5').getBoundingClientRect()
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2
          assert.ok(!(cx >= mr.left && cx <= mr.right && cy >= mr.top && cy <= mr.bottom), `${side}: the port stays clear`)
          if (side === 'right') assert.ok(mr.left >= card.right, 'right: past the card')
          if (side === 'left') assert.ok(mr.right <= card.left, 'left: before the card')
          if (side === 'bottom') assert.ok(mr.top >= card.bottom, 'bottom: under the card')
          await new Promise(res => setTimeout(res, 520))   // the next click is a gesture of its own
        }
        // A card at the window's right edge: no room past its right port, so
        // the picker opens on the card's far side rather than over it.
        closeMenus()
        vp.style.width = window.innerWidth + 'px'
        block('p6', { x: window.innerWidth - 240, y: 250 })
        const port = document.querySelector('#b-p6 .port-right')
        const r = port.getBoundingClientRect()
        ptr(port, 'pointerdown', r.x + 2, r.y + 2); ptr(port, 'pointerup', r.x + 2, r.y + 2)
        const mr = picker().getBoundingClientRect(), card = document.getElementById('b-p6').getBoundingClientRect()
        assert.ok(mr.right <= card.left, `the far side of the card: menu ${Math.round(mr.left)}..${Math.round(mr.right)}, card from ${Math.round(card.left)}`)
        assert.ok(mr.right <= window.innerWidth && mr.left >= 0, 'inside the window')
      } finally {
        closeMenus()
        vp.style.cssText = prev[0]; root.style.cssText = prev[1]
        Object.assign(view, saved)
        applyTransform()
      }
    })
  })
})

describe('menus: a port\'s picker never covers its port', () => {
  // A card in the middle of a window too short for the picker above or
  // below it. Held into the window, the picker used to sit over the port,
  // so a double-click's second press landed on a row.
  async function at(id, extra, side, fn) {
    await withStyles(async () => {
      const vp = $.canvasViewport(), root = $.canvasRoot()
      const prev = [vp.style.cssText, root.style.cssText]
      const saved = { ...view }
      vp.style.cssText = `display:block;position:fixed;left:0;top:0;width:${window.innerWidth}px;height:${window.innerHeight}px;overflow:hidden`
      Object.assign(view, { panX: 0, panY: 0, zoom: 1 })
      applyTransform()
      try {
        block(id, extra)
        const port = document.querySelector(`#b-${id} .port-${side}`)
        const r = port.getBoundingClientRect()
        ptr(port, 'pointerdown', r.x + 2, r.y + 2); ptr(port, 'pointerup', r.x + 2, r.y + 2)
        const m = picker()
        assert.ok(m, 'open')
        const mr = m.getBoundingClientRect(), card = document.getElementById('b-' + id).getBoundingClientRect()
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2
        assert.ok(!(cx >= mr.left && cx <= mr.right && cy >= mr.top && cy <= mr.bottom),
          `the port (${Math.round(cx)}, ${Math.round(cy)}) stays clear of the picker ${Math.round(mr.left)}..${Math.round(mr.right)} x ${Math.round(mr.top)}..${Math.round(mr.bottom)}`)
        assert.ok(mr.left >= 0 && mr.top >= 0 && mr.right <= window.innerWidth && mr.bottom <= window.innerHeight, 'inside the window')
        fn(m, mr, card)
      } finally {
        closeMenus()
        vp.style.cssText = prev[0]; root.style.cssText = prev[1]
        Object.assign(view, saved)
        applyTransform()
      }
    })
  }

  it('no room above or below a bottom port: it opens beside the card', async () => {
    reset(); setupCanvasPointerEvents()
    await at('pv1', { x: 300, y: Math.round(window.innerHeight / 2 - 60) }, 'bottom', (m, mr, card) => {
      assert.ok(mr.left >= card.right || mr.right <= card.left, `beside the card: ${Math.round(mr.left)}..${Math.round(mr.right)}, card ${Math.round(card.left)}..${Math.round(card.right)}`)
      assert.ok(!(m.scrollHeight > m.clientHeight + 1), 'whole, no scrolling')
    })
  })

  it('no room on any side of a card as wide as the window: the roomier of under and over, scrolling inside', async () => {
    reset(); setupCanvasPointerEvents()
    await at('pv2', { x: 20, y: Math.round(window.innerHeight / 2 - 60), width: window.innerWidth - 40 }, 'bottom', (m, mr, card) => {
      assert.ok(mr.top >= card.bottom || mr.bottom <= card.top, `off the card: ${Math.round(mr.top)}..${Math.round(mr.bottom)}, card ${Math.round(card.top)}..${Math.round(card.bottom)}`)
      // Enter still reaches the marked row: it is the first suggestion, at the top.
      assert.ok(m.querySelector('.pf-menu-match'), 'a row is marked')
    })
  })
})

// ── A submenu with no room beside its menu ───────────────────
describe('menus: a submenu with no room on either side stacks over its menu', () => {
  it('beside its menu when there is room; stacked one step in, covering whole rows, when there is none', async () => {
    reset()
    await withStyles(async () => {
      const items = [
        { label: 'First', action() {} },
        { label: 'Second', action() {} },
        { label: 'Planning', submenu: () => [{ type: 'heading', label: 'Status' }, { label: 'Not started', radio: true, checked: true, action() {} },
          { label: 'In progress', radio: true, checked: false, action() {} }] },
        { label: 'Delete', danger: true, action() {} },
      ]
      try {
        // Room on the right: the submenu opens beside its menu, as it always has.
        let m = openMenu(items, { x: 20, y: 20 })
        let p = m.el.getBoundingClientRect()
        let sub = openRow('Planning', m.el)
        let s = sub.getBoundingClientRect()
        assert.ok(s.left >= p.right, `beside: ${Math.round(s.left)} from ${Math.round(p.right)}`)
        assert.ok(!sub.classList.contains('pf-submenu-stacked'))
        closeMenus()

        // A menu as wide as a phone leaves no room either side.
        m = openMenu(items, { x: 20, y: 20 })
        m.el.style.minWidth = (window.innerWidth - 60) + 'px'
        p = m.el.getBoundingClientRect()
        sub = openRow('Planning', m.el)
        s = sub.getBoundingClientRect()
        assert.ok(sub.classList.contains('pf-submenu-stacked'), 'stacked')
        assert.ok(Math.abs(s.left - (p.left + 12)) <= 1, `one step in from the menu's edge: ${Math.round(s.left)} vs ${Math.round(p.left)}`)
        assert.ok(s.right >= p.right - 1, `covers the menu to its right edge, so no label shows cut: ${Math.round(s.right)} vs ${Math.round(p.right)}`)
        assert.ok(s.right <= window.innerWidth - 8 + 0.5 && s.left >= 8, 'inside the window')
        const [first, second] = domRows(m.el)
        assert.ok(second.getBoundingClientRect().bottom <= s.top + 1, 'the rows above the one that opened it still show')
        assert.ok(first.getBoundingClientRect().bottom <= s.top + 1)
        assert.ok(!(sub.scrollHeight > sub.clientHeight + 1), 'and it does not scroll')
      } finally { closeMenus() }
    })
  })
})

// ── Above a toast ────────────────────────────────────────────
describe('menus: a menu is never under a toast', () => {
  it('a context menu, its submenu and a header menu each cover a toast they overlap', async () => {
    reset()
    await withStyles(async () => {
      showToast('Sample opened. Your own map is under Maps.', 'info', 5000)
      const toast = document.querySelector('.toast-notification')
      // A toast lets clicks through; for this check it takes them, so the
      // hit test reads what is painted on top.
      toast.style.pointerEvents = 'auto'
      try {
        const t = toast.getBoundingClientRect()
        assert.ok(toast.contains(document.elementFromPoint(t.left + 12, t.top + 12)), 'the toast is hit where nothing covers it')
        const probe = { x: t.left + 12, y: t.top + 12 }
        const on = el => { el.style.left = (probe.x - 6) + 'px'; el.style.top = (probe.y - 6) + 'px'; return document.elementFromPoint(probe.x, probe.y) }
        const items = [{ label: 'Zoom to block', action() {} }, { label: 'Planning', submenu: () => [{ label: 'Done', action() {} }] }]
        const m = openMenu(items, { x: 20, y: 20, className: 'ctx-block-menu' })
        assert.ok(m.el.contains(on(m.el)), 'the context menu is on top')
        const sub = openRow('Planning', m.el)
        assert.ok(sub.contains(on(sub)), 'its submenu is on top')
        closeMenus()
        const btn = document.createElement('button')
        btn.textContent = 'File'
        btn.style.cssText = 'position:fixed;left:20px;top:20px'
        document.body.appendChild(btn)
        try {
          const h = openHeaderMenu(btn, () => items, 'File')
          const el = h?.el || lastMenu()
          assert.ok(el.contains(on(el)), 'a header menu is on top')
          const hs = openRow('Planning', el)
          assert.ok(hs.contains(on(hs)), 'and so is its submenu')
        } finally { closeMenus(); btn.remove() }
      } finally { toast.remove() }
    })
  })
})

// ── Everything fits ──────────────────────────────────────────
describe('menus: every menu fits a laptop and a phone without scrolling', () => {
  it('the block, selection and connection menus and each of their submenus, and File and View with theirs', async () => {
    reset(); fullMap()
    await withStyles(async () => {
      const LAPTOP = 900 - 16, PHONE = 844 - 16
      const check = (m, what) => {
        const h = m.scrollHeight
        assert.ok(h <= LAPTOP && h <= PHONE, `${what}: ${h}px tall`)
        assert.ok(m.scrollHeight <= m.clientHeight + 1, `${what}: does not scroll`)
      }
      const walk = (items, name) => {
        closeMenus()
        const root = openMenu(items, { x: 20, y: 20 })
        check(root.el, name)
        const subs = domRows(root.el).filter(r => r.getAttribute('aria-haspopup') === 'menu').map(labelOf)
        for (const label of subs) {
          closeMenus()
          const r2 = openMenu(items, { x: 20, y: 20 })
          openRow(label, r2.el)
          check(lastMenu(), `${name} > ${label}`)
        }
        closeMenus()
      }
      walk(blockMenu('a'), 'block')
      walk(multiMenu(['a', 'b', 'c']), 'selection')
      walk(arrowMenu('ba', {}), 'connection')
      walk(fileMenu((await indexDoc()).getElementById('fileActions'), { readOnly: false }), 'File')
      walk(viewMenu(), 'View')
    })
  })
})

// ── A phone ──────────────────────────────────────────────────
// The suite's own window is a laptop's, so a phone is a 390x844 frame with
// the stylesheet and its own menu.js: what that menu.js measures is a phone's
// window. The rows are the app's own (built here, opened there).
async function phoneFrame() {
  const f = document.createElement('iframe')
  f.style.cssText = `${ONSCREEN};width:390px;height:844px`
  f.srcdoc = '<!DOCTYPE html><html><head><link rel="stylesheet" href="../css/style.css">' +
    '<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style></head><body>' +
    '<script type="module">import * as M from "../js/menu.js"; window.M = M<\/script></body></html>'
  const loaded = new Promise(res => f.addEventListener('load', res, { once: true }))
  document.body.appendChild(f)
  await loaded
  for (let i = 0; i < 100 && !f.contentWindow.M; i++) await new Promise(res => setTimeout(res, 20))
  assert.ok(f.contentWindow.M, 'menu.js loaded in the frame')
  return f
}
const frames = (win, n = 2) => new Promise(res => {
  const step = k => (k ? win.requestAnimationFrame(() => step(k - 1)) : res())
  step(n)
})
const menusIn = doc => [...doc.querySelectorAll('.pf-menu')]
const rowIn = (menuEl, label) => [...menuEl.children].find(n => n.classList.contains('pf-menu-item') && !n.hidden && labelOf(n) === label)
// Every label of a menu under another that the upper one cuts: across its
// top or bottom edge, or across its left edge.
function cutLabels(doc) {
  const ms = menusIn(doc), out = []
  ms.forEach((upper, i) => {
    const s = upper.getBoundingClientRect()
    ms.slice(0, i).forEach(lower => {
      for (const row of lower.children) {
        const label = row.querySelector?.('.pf-menu-label'); if (!label || row.hidden) continue
        const l = label.getBoundingClientRect()
        const across = l.bottom > s.top + 0.5 && l.top < s.bottom - 0.5
        const underH = l.left >= s.left - 0.5 && l.right <= s.right + 0.5
        if (underH && ((l.top < s.top - 0.5 && l.bottom > s.top + 0.5) || (l.top < s.bottom - 0.5 && l.bottom > s.bottom + 0.5))) out.push(label.textContent)
        else if (across && l.left < s.left - 0.5 && l.right > s.left + 0.5) out.push(label.textContent)
      }
    })
  })
  return out
}
function insidePhone(el, what) {
  const r = el.getBoundingClientRect()
  assert.ok(r.left >= 8 - 0.5 && r.top >= 8 - 0.5 && r.right <= 382 + 0.5 && r.bottom <= 836 + 0.5,
    `${what}: ${Math.round(r.left)}..${Math.round(r.right)} x ${Math.round(r.top)}..${Math.round(r.bottom)} in 8..382 x 8..836`)
  assert.ok(el.scrollHeight <= el.clientHeight + 1, `${what}: does not scroll`)
}

describe('menus: on a phone every submenu stays in the window and cuts no label', () => {
  it('Add connected from a Trigger / End card, from its menu and from More, while each row\'s note comes in', async () => {
    reset()
    const f = await phoneFrame()
    const W = f.contentWindow, D = W.document
    try {
      block('t', { type: 'terminator', title: 'Report received' }); block('u', { type: 'process', x: 400, title: 'Reproduce it' })
      arrow('tu', 't', 'u')
      selectBlock('t')
      const check = async what => {
        const sub = menusIn(D).pop()
        assert.ok(sub.classList.contains('pf-submenu'), `${what}: open`)
        await frames(W)
        insidePhone(sub, what)
        // The note under the rows takes the meaning of the row in focus; the
        // longest ones used to widen the submenu past the window's edge and
        // push its foot under the window's bottom.
        for (const t of ['process', 'implementation', 'output', 'terminator', 'question']) {
          const row = [...sub.querySelectorAll('.pf-menu-item')].find(n => labelOf(n) === TYPES[t].label)
          row.dispatchEvent(new W.FocusEvent('focusin', { bubbles: true }))
          await frames(W)
          insidePhone(sub, `${what}, the note for ${TYPES[t].label}`)
        }
        assert.deepEq(cutLabels(D), [], `${what}: no label of the menu under it shows cut`)
      }
      W.M.openMenu(blockMenu('t'), { x: 60, y: 300, className: 'ctx-block-menu' })
      rowIn(menusIn(D)[0], 'Add connected').click()
      await check('the block menu > Add connected')
      W.M.closeMenus()

      // More sits at the panel's right edge, as on a phone.
      const btn = D.createElement('button')
      btn.style.cssText = 'position:fixed;left:338px;top:522px;width:30px;height:32px'
      D.body.appendChild(btn)
      W.M.openDropdown(btn, moreMenuItems().items, { placement: 'bottom-end', className: 'insp-menu insp-more-menu' })
      insidePhone(menusIn(D)[0], 'More')
      rowIn(menusIn(D)[0], 'Add connected').click()
      await check('More > Add connected')
    } finally { f.contentWindow?.M?.closeMenus(); f.remove(); closeMenus() }
  })

  it('a third level stacks one step in from its own menu, and one that must move up lands on a row\'s top', async () => {
    reset()
    const f = await phoneFrame()
    const W = f.contentWindow, D = W.document
    try {
      block('t', { type: 'problem', title: 'Checkout returns 500 on some card payments' })
      ;['Report received from the payments team', 'What changed in the last week of deploys', 'No test covers the payment retry path']
        .forEach((title, i) => { block('n' + i, { type: 'context', title, x: 400 * (i + 1) }); arrow('a' + i, 'n' + i, 't') })
      block('o', { type: 'problem', x: 0, y: 600 })
      selectBlock('t')
      for (const y of [300, 520]) {
        W.M.closeMenus()
        W.M.openMenu(blockMenu('t'), { x: 60, y, className: 'ctx-block-menu' })
        rowIn(menusIn(D)[0], 'Select and zoom').click()
        await frames(W)
        const second = menusIn(D)[1]
        insidePhone(second, `Select and zoom (menu at ${y})`)
        assert.deepEq(cutLabels(D), [], `Select and zoom (menu at ${y}): no label cut`)
        rowIn(second, 'Select connection').click()
        await frames(W)
        const third = menusIn(D)[2]
        insidePhone(third, `Select connection (menu at ${y})`)
        const p = second.getBoundingClientRect(), r = third.getBoundingClientRect()
        assert.ok(r.left >= p.left + 12 - 0.5, `one step in from its own menu: ${Math.round(r.left)} vs ${Math.round(p.left)}`)
        assert.deepEq(cutLabels(D), [], `Select connection (menu at ${y}): no label cut`)
      }
    } finally { f.contentWindow?.M?.closeMenus(); f.remove(); closeMenus() }
  })
})

// ── A drag from a port with its picker open ──────────────────
describe('menus: a press on a port that becomes a drag', () => {
  it('closes the picker the click on that port opened, and draws the connection', async () => {
    reset(); setupCanvasPointerEvents()
    await withStyles(async () => {
      const vp = $.canvasViewport(), root = $.canvasRoot()
      const prev = [vp.style.cssText, root.style.cssText]
      const saved = { ...view }
      vp.style.cssText = `display:block;position:fixed;left:0;top:0;width:${window.innerWidth}px;height:${window.innerHeight}px;overflow:hidden`
      Object.assign(view, { panX: 0, panY: 0, zoom: 1 })
      applyTransform()
      try {
        block('d1', { x: 200, y: 250 }); block('d2', { type: 'requirement', x: 800, y: 250 })
        const port = document.querySelector('#b-d1 .port-right')
        const r = port.getBoundingClientRect()
        const x = r.x + r.width / 2, y = r.y + r.height / 2
        ptr(port, 'pointerdown', x, y); ptr(port, 'pointerup', x, y)
        assert.ok(picker(), 'a click opened the picker')
        await new Promise(res => setTimeout(res, 520))   // the press below is a gesture of its own
        ptr(port, 'pointerdown', x, y)
        assert.ok(picker(), 'a press on the port leaves it (the second press of a double-click must)')
        const t = document.getElementById('b-d2').getBoundingClientRect()
        const tx = t.left + t.width / 2, ty = t.top + t.height / 2
        for (let i = 1; i <= 5; i++) ptr(vp, 'pointermove', x + (tx - x) * i / 5, y + (ty - y) * i / 5)
        assert.ok(!picker(), 'once the press travels it is a connection being drawn, and the picker goes')
        ptr(vp, 'pointerup', tx, ty)
        assert.ok(state.arrows.some(a => a.from === 'd1' && a.to === 'd2'), 'the connection is drawn')
        assert.ok(!picker(), 'and no picker is left over it')
        assert.eq(Object.keys(state.blocks).length, 2, 'no block added')
      } finally {
        closeMenus(); pointer.ix = null
        vp.style.cssText = prev[0]; root.style.cssText = prev[1]
        Object.assign(view, saved)
        applyTransform()
      }
    })
  })
})

// ── One picker, one name ─────────────────────────────────────
describe('menus: a port\'s picker and a dropped line\'s are one picker', () => {
  it('the same heading and the same name, whichever opened it', () => {
    reset(); setupCanvasPointerEvents()
    block('q1', { type: 'problem' })
    clickPort('q1', 'right')
    const port = picker()
    const fromPort = [port.querySelector('.pf-menu-heading').textContent, port.getAttribute('aria-label')]
    closeMenus()
    openQuickCreate({ fromId: 'q1', fromPort: 'right', clientX: 300, clientY: 300, wx: 300, wy: 300 })
    const drop = document.querySelector('.pf-menu.pf-quick-create')
    assert.ok(drop, 'the line-drop picker')
    assert.deepEq([drop.querySelector('.pf-menu-heading').textContent, drop.getAttribute('aria-label')], fromPort)
    assert.eq(fromPort[0], `Add after ${TYPES.problem.label}`)
    closeMenus()
    assert.eq(Object.keys(state.blocks).length, 1)
  })
})

// ── One icon column ──────────────────────────────────────────
describe('menus: Planning\'s glyphs take the 16px icon column', () => {
  it('status circles and priority bars draw at 16px, as the rest of the menu\'s icons do', async () => {
    reset(); block('g')
    await withStyles(async () => {
      try {
        openBlockMenu('g', 40, 40)
        const sub = openRow('Planning')
        const icons = [...sub.querySelectorAll('.pf-menu-icon')].filter(i => i.querySelector('svg'))
        assert.gte(icons.length, 8, 'four statuses, three priorities and Add question')
        icons.forEach(i => {
          const r = i.querySelector('svg').getBoundingClientRect()
          assert.eq(Math.round(r.width), 16, `${labelOf(i.closest('.pf-menu-item'))}: ${r.width}px wide`)
          assert.eq(Math.round(r.height), 16, `${labelOf(i.closest('.pf-menu-item'))}: ${r.height}px tall`)
        })
      } finally { closeMenus() }
    })
  })
})
