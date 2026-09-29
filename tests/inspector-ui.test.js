// ============================================================
//  inspector-ui.test.js -- the rebuilt right panel.
//
//  The harness page only carries id stubs, so these tests mount the
//  real inspector markup from index.html (and the real stylesheet,
//  for the layout checks), wire it once, and put the stubs back at
//  the end. Everything runs through the same click and change events
//  a person would fire.
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, selection, ui, view, canvasMeta, getUndoHistory, getRedoFuture, resetSnapshotToken } from '../js/state.js'
import { TYPES, TYPE_STEPS, getBlockEl } from '../js/utils.js'
import { renderBlock, selectBlock, setSelection, selectArrow, deselectAll, undo, mutateBlock, duplicateBlock } from '../js/render.js'
import { renderArrows, applyTransform } from '../js/canvas.js'
import { runGapDetection } from '../js/gaps.js'
import { setupInspectorEvents, typeMenuItems, typeCount, sheet, setSheet, sheetState, focusQuestion } from '../js/inspector.js'
import { openDocPopup } from '../js/doc-panel.js'
import { startInlineEdit, isInlineEditing } from '../js/inline-edit.js'
import { setupTimer } from '../js/ui-panels.js'
import { GAP_META } from '../js/gaps.js'
import { closeMenus } from '../js/menu.js'

const OPEN_KEY = 'pathfinder-insp-open'
const host = { el: null, placeholders: [], link: null, savedOpen: null, mounted: false }
const byId = id => document.getElementById(id)
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const history = () => getUndoHistory().length
const isBefore = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

// Mount the real #inspectorPane. Stubs with the same ids would shadow the real
// controls in getElementById, so each is swapped for a placeholder comment
// and swapped back afterwards.
async function mount() {
  if (host.mounted) return
  const html = await (await fetch('../index.html', { cache: 'no-store' })).text()
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const pane = document.importNode(doc.getElementById('inspectorPane'), true)
  pane.querySelectorAll('[id]').forEach(n => {
    const stub = document.getElementById(n.id)
    if (!stub) return
    const mark = document.createComment('stub ' + n.id)
    stub.replaceWith(mark)
    host.placeholders.push({ mark, stub })
  })
  host.link = document.createElement('link')
  host.link.rel = 'stylesheet'
  host.link.href = '../css/style.css'
  await new Promise(resolve => { host.link.onload = resolve; host.link.onerror = resolve; document.head.appendChild(host.link) })
  // The panel at 1280x800: 320px wide, 610px of it visible under the tabs.
  host.el = document.createElement('div')
  host.el.className = 'panel-content'
  host.el.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:610px;overflow:auto;z-index:5'
  host.el.appendChild(pane)
  document.body.appendChild(host.el)
  try { host.savedOpen = localStorage.getItem(OPEN_KEY) } catch (_) {}
  setupInspectorEvents()
  host.mounted = true
}

function unmount() {
  closeMenus()
  host.el?.remove()
  host.link?.remove()
  host.placeholders.forEach(({ mark, stub }) => mark.replaceWith(stub))
  host.placeholders = []
  try {
    if (host.savedOpen === null) localStorage.removeItem(OPEN_KEY)
    else localStorage.setItem(OPEN_KEY, host.savedOpen)
  } catch (_) {}
  host.mounted = false
}

function reset() {
  closeMenus()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  document.body.classList.remove('readonly-mode', 'light-mode')
  canvasMeta.spotlight = false
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  try { localStorage.removeItem(OPEN_KEY) } catch (_) {}
  deselectAll()
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '', x: 40, y: 40,
    actions: [], questions: [], docRef: null, width: null, color: null, collapsed: false,
    groupId: null, status: null, priority: null, cardStyle: null, borderWidth: null,
    highlight: null, criteria: [], ...extra }
  renderBlock(id)
  return state.blocks[id]
}

function arrow(id, from, to, extra = {}) {
  const a = { id, from, to, style: 'routed', pattern: 'solid', bidirectional: false, color: null,
    weight: 1.5, fromPort: null, toPort: null, ...extra }
  state.arrows.push(a)
  return a
}

function refresh() { renderArrows(); runGapDetection() }

// The open menu's rows, and a way to pick one by its label.
const menu = () => document.querySelector('.pf-menu')
const rows = () => [...(menu()?.querySelectorAll('.pf-menu-item') || [])]
const rowLabel = r => r.querySelector('.pf-menu-label')?.textContent || ''
function pick(label) {
  const row = rows().find(r => rowLabel(r) === label)
  assert.ok(row, `menu row "${label}" exists`)
  row.click()
}
function open(id) {
  closeMenus()
  byId(id).click()
  assert.ok(menu(), `#${id} opened a menu`)
  return menu()
}

// Everything in the panel a person can operate, shown and inside the fold.
function controlsInFold(root, foldPx) {
  const top = host.el.getBoundingClientRect().top
  return [...root.querySelectorAll('button, input, textarea, select, summary')].filter(el => {
    const r = el.getBoundingClientRect()
    return el.checkVisibility() && r.width > 0 && r.height > 0 && r.bottom - top <= foldPx
  })
}

// rgb(), rgba() and the color(srgb ...) form color-mix() computes to.
function channels(c) {
  let m = /^rgba?\(([^)]+)\)/.exec(c)
  if (m) {
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return { r, g, b, a }
  }
  m = /^color\(srgb ([^)]+)\)/.exec(c)
  if (m) {
    const [r, g, b, a = 1] = m[1].split(/[\s/]+/).filter(Boolean).map(Number)
    return { r: r * 255, g: g * 255, b: b * 255, a }
  }
  return null
}
function saturated(c) {
  const ch = channels(c)
  return !!ch && ch.a > 0.5 && Math.max(ch.r, ch.g, ch.b) - Math.min(ch.r, ch.g, ch.b) > 40
}
function colouredInFold(root, foldPx) {
  const top = host.el.getBoundingClientRect().top
  return [...root.querySelectorAll('*')].filter(el => {
    if (!el.checkVisibility()) return false
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height || r.bottom - top > foldPx) return false
    const cs = getComputedStyle(el)
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
    const border = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && saturated(cs.borderTopColor)
    return saturated(cs.backgroundColor) || border || (ownText && saturated(cs.color))
  })
}

describe('Inspector: one block', () => {
  it('mounts the real panel markup', async () => {
    await mount()
    assert.ok(byId('inspTypeBtn'), 'the type button is the real one')
    assert.ok(byId('inspectorPane').closest('.panel-content'), 'mounted in the test host')
  })

  it('reads in order: header row, Title, Description, type fields, Suggestions, then the disclosures', () => {
    reset()
    block('g')
    block('r', { type: 'requirement', title: 'Key Results' })
    arrow('a1', 'g', 'r')
    refresh()
    selectBlock('r')
    const order = ['inspTypeBtn', 'inspStatusBtn', 'inspMoreBtn', 'inspTitle', 'inspDesc', 'criteriaSection',
      'gapFixesSection', 'questionsDetails', 'notesDetails', 'docsDetails', 'planningDetails', 'appearanceDetails'].map(byId)
    order.forEach((el, i) => assert.ok(el, `element ${i} exists`))
    for (let i = 1; i < order.length; i++) {
      assert.ok(isBefore(order[i - 1], order[i]), `${order[i - 1].id} comes before ${order[i].id}`)
    }
    assert.ok(!byId('gapFixesSection').hidden, 'Suggestions shows for a block with a gap')
    assert.eq(byId('gapFixesCount').textContent, '1')
    ;['questionsDetails', 'notesDetails', 'docsDetails', 'planningDetails', 'appearanceDetails']
      .forEach(id => assert.eq(byId(id).open, false, `${id} starts closed`))
  })

  it('puts only the three header controls before the Title', () => {
    reset()
    block('r', { type: 'requirement' })
    selectBlock('r')
    const title = byId('inspTitle')
    const before = [...byId('inspectorContent').querySelectorAll('button, input, select, textarea, summary')]
      .filter(el => el.checkVisibility() && isBefore(el, title))
    assert.deepEq(before.map(el => el.id), ['inspTypeBtn', 'inspStatusBtn', 'inspMoreBtn'])
  })

  it('keeps Title near the top and about a dozen controls above the fold at 1280x800', () => {
    reset()
    block('g')
    block('r', { type: 'requirement', title: 'Key Results', description: 'Every lead sees it on Monday.' })
    arrow('a1', 'g', 'r')
    refresh()
    selectBlock('r')
    host.el.scrollTop = 0
    const titleTop = byId('inspTitle').getBoundingClientRect().top - host.el.getBoundingClientRect().top
    assert.lt(titleTop, 120, `Title starts ${Math.round(titleTop)}px down, not 534px`)
    const n = controlsInFold(byId('inspectorContent'), 610).length
    assert.gte(n, 6, 'the fold holds the working fields')
    assert.lt(n, 15, `${n} controls above the fold (was 43 before the Title alone)`)
  })

  it('shows no colour wall at rest: at most the type dot, status glyph and highlight dot', () => {
    reset()
    block('g')
    block('r', { type: 'requirement', status: 'done', highlight: 'alert', color: '#f472b6', priority: 'high',
      criteria: ['Works'] })
    arrow('a1', 'g', 'r')
    refresh()
    selectBlock('r')
    host.el.scrollTop = 0
    const coloured = colouredInFold(byId('inspectorContent'), 610)
    assert.lt(coloured.length, 4, `coloured: ${coloured.map(el => el.id || el.className).join(', ')}`)
    // The same holds in light mode, where the type tokens are darker.
    document.body.classList.add('light-mode')
    try {
      const light = colouredInFold(byId('inspectorContent'), 610)
      assert.lt(light.length, 4, `light: ${light.map(el => el.id || el.className).join(', ')}`)
    } finally { document.body.classList.remove('light-mode') }
  })

  it('selects keep a single caret in both themes', () => {
    reset()
    block('a'); block('b')
    arrow('x', 'a', 'b')
    refresh()
    selectArrow('x')
    const sel = byId('arrowPatternSelect')
    assert.eq(getComputedStyle(sel).backgroundRepeat, 'no-repeat')
    document.body.classList.add('light-mode')
    try { assert.eq(getComputedStyle(sel).backgroundRepeat, 'no-repeat', 'the light shorthand does not tile it') }
    finally { document.body.classList.remove('light-mode') }
  })

  it('the type dropdown lists all 16 types grouped by step, current one checked', () => {
    reset()
    block('r', { type: 'requirement' })
    selectBlock('r')
    const m = open('inspTypeBtn')
    assert.eq(byId('inspTypeBtn').getAttribute('aria-expanded'), 'true')
    const headings = [...m.querySelectorAll('.pf-menu-heading')].map(h => h.textContent)
    assert.deepEq(headings, TYPE_STEPS.map(s => s.label), 'one heading per step, in step order')
    const radios = [...m.querySelectorAll('[role=menuitemradio]')]
    assert.eq(radios.length, Object.keys(TYPES).length)
    assert.eq(radios.length, 16)
    const checked = radios.filter(r => r.getAttribute('aria-checked') === 'true')
    assert.eq(checked.length, 1)
    assert.eq(rowLabel(checked[0]), TYPES.requirement.label)
    assert.includes(checked[0].textContent, TYPES.requirement.short, 'each row carries its one-line meaning')
    assert.includes(m.querySelector('.type-menu-notes')?.textContent || '', 'Implementation')
    // Rows follow their step heading: Implementation sits under How.
    const how = [...m.querySelectorAll('.pf-menu-heading')].find(h => h.textContent === 'How')
    const impl = radios.find(r => rowLabel(r) === TYPES.implementation.label)
    assert.ok(isBefore(how, impl))
    closeMenus()
  })

  it('first-letter typeahead moves through the type list', () => {
    reset()
    block('r', { type: 'requirement' })
    selectBlock('r')
    const m = open('inspTypeBtn')
    m.querySelector('.pf-menu-item').focus()
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))
    assert.eq(rowLabel(document.activeElement), TYPES.decision.label)
    closeMenus()
  })

  it('picking a type is one undo step', () => {
    reset()
    block('r', { type: 'requirement' })
    selectBlock('r')
    open('inspTypeBtn')
    pick(TYPES.implementation.label)
    assert.eq(state.blocks.r.type, 'implementation')
    assert.eq(history(), 1)
    assert.eq(byId('inspTypeLabel').textContent, TYPES.implementation.label)
    undo()
    assert.eq(state.blocks.r.type, 'requirement')
  })

  it('an automatically typed block offers "Looks right" first and clears typeCheck', () => {
    reset()
    block('c', { type: 'process', typeCheck: true })
    selectBlock('c')
    assert.ok(byId('inspTypeBtn').classList.contains('is-unconfirmed'))
    open('inspTypeBtn')
    const first = rows()[0]
    assert.match(rowLabel(first), /^Looks right/)
    first.click()
    assert.eq(state.blocks.c.type, 'process')
    assert.ok(!('typeCheck' in state.blocks.c), 'the type check is settled')
    assert.eq(history(), 1)
    assert.ok(!byId('inspTypeBtn').classList.contains('is-unconfirmed'))
  })

  it('a picked type supersedes the type a newer version wrote (typeHint)', () => {
    reset()
    block('c', { type: 'custom', typeHint: 'hypothesis' })
    selectBlock('c')
    const m = open('inspTypeBtn')
    assert.includes(m.querySelector('.type-menu-notes')?.textContent || '', 'hypothesis', 'says what it was imported as')
    pick(TYPES.assumption.label)
    assert.eq(state.blocks.c.type, 'assumption')
    assert.ok(!state.blocks.c.typeHint, 'the hint no longer overrides the choice')
    assert.eq(JSON.stringify(state.blocks.c).includes('typeHint'), false)
  })

  it('status and priority are menus, one undo step each', () => {
    reset()
    block('r', { type: 'requirement' })
    selectBlock('r')
    open('inspStatusBtn')
    pick('Done')
    assert.eq(state.blocks.r.status, 'done')
    assert.eq(byId('inspStatusLabel').textContent, 'Done')
    assert.eq(byId('statusPicker').querySelector('button'), byId('inspStatusBtn'), 'the attention tab can still focus it')
    open('inspPriorityBtn')
    pick('High')
    assert.eq(state.blocks.r.priority, 'high')
    assert.eq(history(), 2)
    open('inspStatusBtn')
    pick('No status')
    assert.eq(state.blocks.r.status, null)
    assert.eq(byId('inspStatusLabel').textContent, 'Status')
    assert.eq(byId('inspStatusBtn').getAttribute('aria-label'), 'Status: No status')
  })

  it('the ⋯ menu duplicates and deletes', () => {
    reset()
    block('r', { type: 'requirement' })
    selectBlock('r')
    open('inspMoreBtn')
    assert.deepEq(rows().map(rowLabel), ['Duplicate', 'Delete block'])
    pick('Duplicate')
    const ids = Object.keys(state.blocks)
    assert.eq(ids.length, 2)
    assert.neq(selection.blockId, 'r', 'the copy is selected')
    assert.eq(history(), 1)
    open('inspMoreBtn')
    pick('Delete block')
    assert.eq(Object.keys(state.blocks).length, 1)
  })

  it('shows the type\'s own action as a real toggle button', () => {
    reset()
    block('p', { type: 'problem' })
    selectBlock('p')
    let btn = byId('typeActions').querySelector('[data-action=resolve]')
    assert.ok(btn, 'Resolve for a problem')
    assert.eq(btn.tagName, 'BUTTON')
    assert.eq(btn.getAttribute('aria-pressed'), 'false')
    btn.click()
    assert.ok(state.blocks.p.actions.includes('resolve'))
    assert.eq(history(), 1)
    btn = byId('typeActions').querySelector('[data-action=resolve]')
    assert.eq(btn.getAttribute('aria-pressed'), 'true')

    block('s', { type: 'assumption' })
    selectBlock('s')
    assert.ok(byId('typeActions').querySelector('[data-action=validate]'), 'Validate for an assumption, which had no control')
    block('d', { type: 'decision' })
    selectBlock('d')
    assert.ok(byId('typeActionsSection').hidden, 'no empty toggle row for a type with no actions')
    assert.eq(byId('rationaleSection').style.display, '', 'a decision asks for its rationale')
  })

  it('names the done-list from the registry: Targets on a metric', () => {
    reset()
    block('m', { type: 'metric' })
    selectBlock('m')
    assert.eq(byId('criteriaSection').style.display, '')
    assert.eq(byId('criteriaLabelText').textContent, 'Targets')
    const el = byId('inspCriteria')
    el.value = 'Adoption: 40 teams\n\nReady by 9am'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    assert.deepEq(state.blocks.m.criteria, ['Adoption: 40 teams', 'Ready by 9am'])
    assert.eq(history(), 1)
    block('x', { type: 'context' })
    selectBlock('x')
    assert.eq(byId('criteriaSection').style.display, 'none')
  })

  it('promotes a question to an assumption in one step', () => {
    reset()
    block('q', { type: 'question' })
    selectBlock('q')
    assert.ok(!byId('promoteAssumption').hidden)
    byId('promoteAssumption').click()
    assert.eq(state.blocks.q.type, 'assumption')
    assert.ok(state.blocks.q.actions.includes('validate'))
    assert.eq(history(), 1)
    assert.ok(byId('promoteAssumption').hidden)
  })

  it('a suggestion applies its fix', () => {
    reset()
    block('g')
    block('r', { type: 'requirement' })
    arrow('a1', 'g', 'r')
    refresh()
    selectBlock('r')
    const btn = byId('gapFixes').querySelector('.gap-fix-btn')
    assert.ok(btn, 'a fix button')
    btn.click()
    assert.eq(document.activeElement, byId('inspCriteria'), 'Add criteria goes to the criteria field')
  })

  it('Accept keeps the gap on purpose, and Reopen brings it back, one undo step each', () => {
    reset()
    block('g')
    block('r', { type: 'requirement' })
    arrow('a1', 'g', 'r')
    refresh()
    selectBlock('r')
    const accept = byId('gapFixes').querySelector('.gap-fix-accept')
    assert.ok(accept, 'Accept is offered for the gap')
    assert.eq(accept.dataset.accept, 'gap-no-criteria', 'it accepts the gap the fixes answer')
    accept.click()
    assert.deepEq(state.blocks.r.gapAck, ['gap-no-criteria'])
    assert.eq(history(), 1)
    assert.ok(byId('gapFixesSection').hidden, 'an accepted gap has no suggestions left')
    const reopen = byId('gapAccepted').querySelector('[data-reopen]')
    assert.ok(reopen, 'the accepted gap is listed with a way back')
    reopen.click()
    assert.ok(!('gapAck' in state.blocks.r), 'reopening the last one drops the list')
    assert.eq(history(), 2)
    assert.ok(byId('gapFixes').querySelector('.gap-fix-accept'), 'the gap is offered again')
  })

  it('the Colour menu starts with the type colour, and each pick is one undo step', () => {
    reset()
    block('r', { type: 'requirement' })
    selectBlock('r')
    const m = open('inspColourBtn')
    const swatches = [...m.querySelectorAll('.pf-menu-swatch')]
    assert.eq(swatches[0].getAttribute('aria-label'), 'Type colour (default)')
    assert.eq(swatches[0].getAttribute('aria-checked'), 'true')
    swatches[1].click()
    assert.ok(state.blocks.r.color, 'a colour was set')
    assert.eq(history(), 1)
    open('inspColourBtn').querySelector('.pf-menu-swatch').click()
    assert.eq(state.blocks.r.color, null)
    assert.eq(history(), 2)
  })

  it('card style, border and highlight are menus too', () => {
    reset()
    block('r', { type: 'requirement' })
    selectBlock('r')
    open('inspCardBtn')
    assert.eq(rowLabel(rows()[0]), 'Map default')
    pick('Tinted')
    assert.eq(state.blocks.r.cardStyle, 'tint')
    open('inspBorderBtn')
    pick('3px')
    assert.eq(state.blocks.r.borderWidth, 3)
    open('inspHighlightBtn')
    pick('Focus')
    assert.eq(state.blocks.r.highlight, 'focus')
    assert.eq(history(), 3)
    assert.eq(byId('inspHighlightText').textContent, 'Focus')
  })

  it('Appearance is one row of four named menu buttons in a 320px panel', () => {
    reset()
    block('r', { type: 'requirement', color: '#34d399', highlight: 'go' })
    selectBlock('r')
    byId('appearanceDetails').open = true
    const ids = ['inspColourBtn', 'inspCardBtn', 'inspBorderBtn', 'inspHighlightBtn']
    const tops = ids.map(id => Math.round(byId(id).getBoundingClientRect().top))
    assert.eq(new Set(tops).size, 1, `one row: ${tops.join(', ')}`)
    assert.eq(byId('inspColourBtn').getAttribute('aria-label'), 'Colour: Emerald')
    assert.eq(byId('inspHighlightBtn').getAttribute('aria-label'), 'Highlight: Go')
    assert.eq(byId('inspCardBtn').getAttribute('aria-label'), 'Card style: map default')
    ids.forEach(id => assert.eq(byId(id).getAttribute('aria-haspopup'), 'menu', id))
    byId('appearanceDetails').open = false
  })

  it('remembers which disclosures were left open, per browser', () => {
    reset()
    block('a')
    block('b')
    selectBlock('a')
    const notes = byId('notesDetails')
    notes.querySelector('summary').click()
    assert.eq(notes.open, true)
    assert.eq(JSON.parse(localStorage.getItem(OPEN_KEY)).notes, true)
    selectBlock('b')
    assert.eq(byId('notesDetails').open, true, 'still open on the next block')
    notes.querySelector('summary').click()
    assert.eq(JSON.parse(localStorage.getItem(OPEN_KEY)).notes, false)
  })

  it('Links and docs opens itself when the block has a doc or a See: line', () => {
    reset()
    block('a', { docRef: { href: 'https://example.com/spec', label: 'Spec', anchor: '' } })
    block('b', { description: 'See: https://example.com/runbook' })
    block('c')
    selectBlock('a')
    assert.eq(byId('docsDetails').open, true)
    assert.eq(byId('docsHint').textContent, 'Spec')
    selectBlock('c')
    assert.eq(byId('docsDetails').open, false)
    selectBlock('b')
    assert.eq(byId('docsDetails').open, true)
    assert.ok(!byId('promoteSeeRef').hidden, 'offers to promote the See: line')
  })

  it('a field inside a closed disclosure opens it when something focuses it', () => {
    reset()
    block('a', { type: 'problem' })
    selectBlock('a')
    assert.eq(byId('notesDetails').open, false)
    byId('inspNotes').focus()
    assert.eq(byId('notesDetails').open, true)
    assert.eq(document.activeElement, byId('inspNotes'))
  })

  it('questions: add, type and delete, each an undo step', () => {
    reset()
    block('a')
    selectBlock('a')
    byId('addQuestionBtn').click()
    assert.eq(state.blocks.a.questions.length, 1)
    assert.eq(byId('questionsDetails').open, true)
    assert.eq(byId('questionsCount').textContent, '1')
    const input = byId('questionsList').querySelector('input[data-qi]')
    input.value = 'Who signs off?'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.value = 'Who signs off the report?'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    assert.eq(state.blocks.a.questions[0].text, 'Who signs off the report?')
    assert.eq(history(), 2, 'add, then one typing burst')
    byId('questionsList').querySelector('.q-del').click()
    assert.eq(state.blocks.a.questions.length, 0)
    assert.eq(history(), 3)
  })

  it('read-only: fields read, controls do not', () => {
    reset()
    block('g')
    block('r', { type: 'requirement', notes: 'kept', status: 'done' })
    arrow('a1', 'g', 'r')
    refresh()
    ui.readOnly = true
    document.body.classList.add('readonly-mode')
    try {
      selectBlock('r')
      ;['inspTitle', 'inspDesc', 'inspCriteria', 'inspNotes'].forEach(id => assert.eq(byId(id).readOnly, true, id))
      assert.eq(byId('inspTypeBtn').disabled, true)
      assert.eq(byId('inspStatusBtn').disabled, true)
      assert.eq(byId('inspMoreBtn').hidden, true, 'no Duplicate or Delete')
      assert.eq(byId('appearanceDetails').hidden, true, 'no Appearance')
      assert.eq(byId('questionsDetails').hidden, true, 'no empty Questions to add to')
      assert.eq(byId('notesDetails').hidden, false, 'notes with content still show')
      assert.eq(byId('gapFixes').querySelector('.gap-fix-btn'), null, 'no fix buttons')
      assert.eq(byId('criteriaSection').checkVisibility(), false, 'an empty field is not shown as its placeholder')
      assert.eq(byId('inspDesc').checkVisibility(), false)
      assert.eq(byId('inspTitle').placeholder, '')
      byId('inspTypeBtn').click()
      assert.eq(menu(), null, 'a disabled chip opens nothing')
      // Still readable: the chip keeps full contrast.
      assert.eq(getComputedStyle(byId('inspTitle')).opacity, '1')
      assert.eq(getComputedStyle(byId('inspTitle')).pointerEvents, 'auto')
    } finally {
      ui.readOnly = false
      document.body.classList.remove('readonly-mode')
    }
    selectBlock('g')
    selectBlock('r')
    assert.eq(byId('criteriaSection').checkVisibility(), true, 'editing again shows the field')
    assert.includes(byId('inspCriteria').placeholder, '200ms')
  })
})

describe('Inspector: several blocks', () => {
  it('reports a tally without an em dash', () => {
    reset()
    block('a'); block('b', { type: 'problem' }); block('c', { type: 'problem' })
    setSelection(['a', 'b', 'c'])
    const text = byId('multiCount').textContent
    assert.eq(text, '3 blocks selected: 2 problems, 1 goal')
    assert.notIncludes(text, '\u2014', 'no em dash in the tally')
    assert.eq(byId('multiTypeText').textContent, 'Mixed types')
  })

  it('a bulk type change is one undo step', () => {
    reset()
    block('a'); block('b', { type: 'problem' }); block('c', { type: 'custom', typeCheck: true })
    setSelection(['a', 'b', 'c'])
    const m = open('multiTypeBtn')
    assert.eq(m.querySelectorAll('[role=menuitemradio]').length, 16)
    pick(TYPES.risk.label)
    assert.deepEq(['a', 'b', 'c'].map(id => state.blocks[id].type), ['risk', 'risk', 'risk'])
    assert.ok(!('typeCheck' in state.blocks.c), 'choosing confirms an automatic type')
    assert.eq(history(), 1)
    assert.eq(byId('multiTypeText').textContent, TYPES.risk.label)
    undo()
    assert.deepEq(['a', 'b', 'c'].map(id => state.blocks[id].type), ['goal', 'problem', 'custom'])
  })

  it('bulk status, priority and highlight are one step each', () => {
    reset()
    block('a'); block('b')
    setSelection(['a', 'b'])
    open('multiStatusBtn')
    pick('Blocked')
    open('multiPriorityBtn')
    pick('Low')
    byId('multiHighlightRow').querySelector('[data-hl=alert]').click()
    assert.deepEq(['a', 'b'].map(id => state.blocks[id].status), ['blocked', 'blocked'])
    assert.deepEq(['a', 'b'].map(id => state.blocks[id].priority), ['low', 'low'])
    assert.deepEq(['a', 'b'].map(id => state.blocks[id].highlight), ['alert', 'alert'])
    assert.eq(history(), 3)
  })

  it('Distribute needs three blocks; read-only hides the editing rows', () => {
    reset()
    block('a'); block('b')
    setSelection(['a', 'b'])
    assert.eq(byId('multiDistributeBtn').disabled, true)
    ui.readOnly = true
    try {
      setSelection(['a', 'b'])
      assert.eq(byId('multiArrangeRow').hidden, true)
      assert.eq(byId('deleteMultiBtn').hidden, true)
      assert.eq(byId('multiTypeBtn').disabled, true)
    } finally { ui.readOnly = false }
  })
})

describe('Inspector: one connection', () => {
  it('the pattern select writes arrow.pattern, one undo step per change', () => {
    reset()
    block('a'); block('b', { type: 'requirement' })
    arrow('x', 'a', 'b')
    refresh()
    selectArrow('x')
    const sel = byId('arrowPatternSelect')
    assert.eq(sel.value, 'solid')
    sel.value = 'dashed'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    assert.eq(state.arrows[0].pattern, 'dashed')
    assert.eq(state.arrows[0].style, 'routed', 'the route is untouched')
    sel.value = 'dotted'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    assert.eq(state.arrows[0].pattern, 'dotted')
    assert.eq(history(), 2)
    undo()
    assert.eq(state.arrows[0].pattern, 'dashed')
  })

  it('a legacy dashed style keeps its dash when the route changes', () => {
    reset()
    block('a'); block('b')
    arrow('x', 'a', 'b', { style: 'dashed', pattern: undefined })
    delete state.arrows[0].pattern
    refresh()
    selectArrow('x')
    assert.eq(byId('arrowRouteSelect').value, 'curved')
    assert.eq(byId('arrowPatternSelect').value, 'dashed')
    const route = byId('arrowRouteSelect')
    route.value = 'elbow'
    route.dispatchEvent(new Event('change', { bubbles: true }))
    assert.eq(state.arrows[0].style, 'elbow')
    assert.eq(state.arrows[0].pattern, 'dashed')
  })

  it('route, heads and weight are selects that write the arrow', () => {
    reset()
    block('a'); block('b')
    arrow('x', 'a', 'b', { weight: 2 })
    refresh()
    selectArrow('x')
    const weight = byId('arrowWeightSelect')
    assert.eq(weight.value, '2', 'an older weight shows as itself, not snapped')
    weight.value = '3.5'
    weight.dispatchEvent(new Event('change', { bubbles: true }))
    assert.eq(state.arrows[0].weight, 3.5)
    const heads = byId('arrowHeadsSelect')
    heads.value = 'both'
    heads.dispatchEvent(new Event('change', { bubbles: true }))
    assert.eq(state.arrows[0].bidirectional, true)
    const route = byId('arrowRouteSelect')
    route.value = 'straight'
    route.dispatchEvent(new Event('change', { bubbles: true }))
    assert.eq(state.arrows[0].style, 'straight')
    assert.eq(history(), 3)
  })

  it('the label suggests the implied verb first; typing is one undo step', () => {
    reset()
    block('i', { type: 'implementation' }); block('r', { type: 'requirement' })
    arrow('x', 'i', 'r')
    refresh()
    selectArrow('x')
    const options = [...byId('arrowLabelSuggestions').querySelectorAll('option')].map(o => o.value)
    assert.eq(options[0], 'satisfies')
    assert.includes(options, 'depends on')
    assert.includes(byId('arrowLabelInput').placeholder, 'satisfies')
    const input = byId('arrowLabelInput')
    input.value = 'sat'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.value = 'satisfies'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    assert.eq(state.arrows[0].label, 'satisfies')
    assert.eq(history(), 1)
  })

  it('meaning, reverse and connection points are one step each', () => {
    reset()
    block('a'); block('b')
    arrow('x', 'a', 'b', { fromPort: 'right', toPort: 'left', portsBy: 'tidy' })
    refresh()
    selectArrow('x')
    const rel = byId('arrowRelation')
    rel.value = 'depends-on'
    rel.dispatchEvent(new Event('change', { bubbles: true }))
    assert.eq(state.arrows[0].relation, 'depends-on')
    byId('arrowReverse').click()
    assert.eq(state.arrows[0].from, 'b')
    assert.eq(state.arrows[0].fromPort, 'left')
    assert.eq(state.arrows[0].portsBy, 'tidy', 'reversing is not the user choosing a side')
    byId('arrowAutoRoute').click()
    assert.eq(state.arrows[0].fromPort, null)
    assert.eq(state.arrows[0].portsBy, undefined)
    assert.eq(history(), 3)
  })

  it('both ends are buttons that select that block', async () => {
    reset()
    block('a', { title: 'Source' }); block('b', { title: 'Target' })
    arrow('x', 'a', 'b')
    refresh()
    selectArrow('x')
    const ends = [...byId('arrowInfo').querySelectorAll('button[data-select-block]')]
    assert.eq(ends.length, 2)
    assert.includes(ends[0].getAttribute('aria-label'), 'Source')
    // focusBlock pans the camera too; put it back for the suites after this.
    const camera = { ...view }
    try {
      ends[1].click()
      for (let i = 0; i < 20 && selection.blockId !== 'b'; i++) await tick(20)
      assert.eq(selection.blockId, 'b')
    } finally {
      await tick(320)
      Object.assign(view, camera)
      applyTransform()
    }
  })

  it('the colour menu writes the arrow colour; read-only disables every control', () => {
    reset()
    block('a'); block('b')
    arrow('x', 'a', 'b')
    refresh()
    selectArrow('x')
    const swatches = [...open('arrowColourBtn').querySelectorAll('.pf-menu-swatch')]
    swatches[2].click()
    assert.ok(state.arrows[0].color)
    ui.readOnly = true
    try {
      selectArrow('x')
      ;['arrowPatternSelect', 'arrowRouteSelect', 'arrowHeadsSelect', 'arrowWeightSelect', 'arrowRelation']
        .forEach(id => assert.eq(byId(id).disabled, true, id))
      assert.eq(byId('arrowLabelInput').readOnly, true)
      assert.eq(byId('arrowLabelInput').checkVisibility(), false, 'no label, nothing to read')
      assert.eq(byId('deleteArrowBtn').hidden, true)
      assert.eq(byId('arrowAdvanced').hidden, true)
      assert.eq(byId('arrowColourRow').hidden, true)
      assert.eq(byId('arrowColourRow').checkVisibility(), false, 'a flex row still hides')
      assert.eq(byId('arrowReverse').checkVisibility(), false)
    } finally { ui.readOnly = false }
  })
})

// Each test here reproduces a defect a review found in the rebuilt panel,
// through the same events a person fires, and fails on the code it fixed.
describe('Inspector: review fixes', () => {
  const atMost = (a, b, msg) => assert.ok(a <= b, `${msg} (${a} is over ${b})`)
  // Contrast of a text colour over whatever is painted behind an element.
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a),
    b: top.b * top.a + bot.b * (1 - top.a), a: 1 })
  function backdrop(el) {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const c = channels(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0) layers.push(c)
    }
    let base = channels(getComputedStyle(document.documentElement).backgroundColor)
    base = base && base.a > 0 ? over(base, { r: 255, g: 255, b: 255, a: 1 }) : { r: 255, g: 255, b: 255, a: 1 }
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base)
    return base
  }
  const contrast = (fg, bg) => {
    const c = over(fg, bg), x = lum(c), y = lum(bg)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }

  it('the tally pluralises every type label, slashes and all', () => {
    reset()
    block('a', { type: 'process' }); block('b', { type: 'process' }); block('c')
    setSelection(['a', 'b', 'c'])
    assert.eq(byId('multiCount').textContent, '3 blocks selected: 2 processes, 1 goal')
    assert.eq(typeCount('resource', 2), '2 resources / systems')
    assert.eq(typeCount('terminator', 3), '3 triggers / ends')
    assert.eq(typeCount('question', 2), '2 open questions')
    assert.eq(typeCount('custom', 2), '2 other blocks')
    assert.eq(typeCount('custom', 1), '1 other block')
    assert.eq(typeCount('goal', 1), '1 goal')
  })

  it('switching connections while the Label field has focus shows the new one, and typing writes only there', () => {
    reset()
    block('a'); block('b'); block('c')
    arrow('x', 'a', 'b', { label: 'alpha label', note: 'alpha note' })
    arrow('y', 'b', 'c')
    refresh()
    selectArrow('x')
    const input = byId('arrowLabelInput')
    input.focus()
    selectArrow('y')
    assert.eq(input.value, '', 'the field shows y, which has no label')
    input.value += '!'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    assert.eq(state.arrows[1].label, '!', 'y gets the one character typed')
    assert.eq(state.arrows[0].label, 'alpha label', 'x is untouched')
    input.blur()
  })

  it('switching connections while the Note field has focus shows the new note', () => {
    reset()
    block('a'); block('b'); block('c')
    arrow('x', 'a', 'b', { note: 'alpha note' })
    arrow('y', 'b', 'c', { note: 'beta note' })
    refresh()
    selectArrow('x')
    byId('arrowNoteInput').focus()
    selectArrow('y')
    assert.eq(byId('arrowNoteInput').value, 'beta note')
    byId('arrowNoteInput').blur()
  })

  it('Mark Resolved and Mark Prepare leave the toggle above them pressed, so pressing it again is not a trap', () => {
    reset()
    block('g'); block('p', { type: 'problem' }); block('k', { type: 'risk' })
    arrow('a1', 'g', 'p'); arrow('a2', 'g', 'k')
    refresh()
    for (const [id, fix] of [['p', 'resolve'], ['k', 'prepare']]) {
      selectBlock(id)
      const btn = byId('gapFixes').querySelector(`.gap-fix-btn[data-fix="${fix}"]`)
      assert.ok(btn, `${fix} offered`)
      btn.focus()
      btn.click()
      assert.deepEq(state.blocks[id].actions, [fix])
      const toggle = byId('typeActions').querySelector(`[data-action="${fix}"]`)
      assert.eq(toggle.getAttribute('aria-pressed'), 'true', `the ${fix} toggle reflects the model`)
      assert.eq(document.activeElement, toggle, 'focus lands on the toggle the fix set, not the page')
    }
  })

  it('a change made outside the panel (context menu, type check) refreshes its header and fields', () => {
    reset()
    block('g')
    selectBlock('g')
    assert.eq(byId('criteriaSection').style.display, '', 'a goal has criteria')
    mutateBlock('g', { type: 'risk', status: 'blocked' }, { undo: true })
    assert.eq(byId('inspTypeLabel').textContent, TYPES.risk.label, 'the chip follows the model')
    assert.eq(byId('inspStatusBtn').getAttribute('aria-label'), 'Status: Blocked')
    assert.eq(byId('criteriaSection').style.display, 'none', 'a risk has no criteria field')
    assert.ok(byId('typeActions').querySelector('[data-action="prepare"]'), 'and gets its own action')
  })

  it('several blocks changed outside the panel refresh the multi-select summary', () => {
    reset()
    block('a'); block('b', { type: 'problem' })
    setSelection(['a', 'b'])
    assert.eq(byId('multiTypeText').textContent, 'Mixed types')
    mutateBlock('b', { type: 'goal' }, { undo: true })
    assert.eq(byId('multiTypeText').textContent, TYPES.goal.label)
  })

  it('refreshing from the canvas never eats what is being typed', () => {
    reset()
    block('r', { type: 'requirement', questions: [{ text: 'Who?' }] })
    selectBlock('r')
    const crit = byId('inspCriteria')
    crit.focus()
    crit.value = 'Works offline\n'
    crit.dispatchEvent(new Event('input', { bubbles: true }))
    assert.deepEq(state.blocks.r.criteria, ['Works offline'])
    assert.eq(crit.value, 'Works offline\n', 'the new line survives its own save')
    mutateBlock('r', { status: 'done' }, { undo: true })
    assert.eq(crit.value, 'Works offline\n', 'and an outside change')
    crit.blur()
    // A question being typed keeps its input, caret and all.
    byId('questionsDetails').open = true
    const q = byId('questionsList').querySelector('input[data-qi="0"]')
    q.focus()
    mutateBlock('r', { priority: 'high' }, { undo: true })
    assert.eq(document.activeElement, q, 'the question input was not rebuilt under the caret')
    q.blur()
    byId('questionsDetails').open = false
  })

  it('the header keeps the type name whole: a set status drops to its glyph when there is no room', () => {
    reset()
    block('i', { type: 'implementation', status: 'in-progress' })
    block('g', { status: 'in-progress' })
    const label = byId('inspTypeLabel'), head = label.closest('.insp-head')
    selectBlock('i')
    atMost(label.scrollWidth, label.clientWidth + 0.5, `Implementation is whole (${label.clientWidth} of ${label.scrollWidth}px)`)
    assert.ok(head.classList.contains('is-tight'), 'the status word gave way')
    assert.eq(byId('inspStatusLabel').checkVisibility(), false)
    assert.eq(byId('inspStatusBtn').getAttribute('aria-label'), 'Status: In Progress', 'the status is still named')
    assert.eq(byId('inspStatusBtn').title, 'Status: In Progress')
    selectBlock('g')
    assert.ok(!head.classList.contains('is-tight'), 'a short type keeps the status word')
    assert.eq(byId('inspStatusLabel').checkVisibility(), true)
    // Every type, with the longest status, in the 320px panel and the 280px one.
    const width = host.el.style.width
    try {
      for (const w of ['320px', '280px']) {
        host.el.style.width = w
        for (const t of Object.keys(TYPES)) {
          mutateBlock('g', { type: t, status: 'in-progress' })
          atMost(label.scrollWidth, label.clientWidth + 0.5, `${t} at ${w}: ${label.clientWidth} of ${label.scrollWidth}px`)
        }
      }
    } finally { host.el.style.width = width }
  })

  it('read-only Suggestions name the gap instead of giving editing instructions', () => {
    reset()
    block('a')
    refresh()
    ui.readOnly = true
    document.body.classList.add('readonly-mode')
    try {
      selectBlock('a')
      assert.ok(!byId('gapFixesSection').hidden, 'the gap is still shown')
      assert.eq(byId('gapFixesTitle').textContent, 'Gaps')
      assert.eq(byId('gapFixes').textContent.trim(), GAP_META['gap-isolated'].short)
      assert.notIncludes(byId('gapFixes').textContent, 'drag')
      assert.eq(byId('gapFixesCount').textContent, '1')
    } finally {
      ui.readOnly = false
      document.body.classList.remove('readonly-mode')
    }
    selectBlock('a')
    assert.eq(byId('gapFixesTitle').textContent, 'Suggestions')
    assert.includes(byId('gapFixes').textContent, 'drag from a port')
  })

  it('keyboard focus stays in the panel after promote, and goes to the canvas after Delete', () => {
    reset()
    block('q', { type: 'question' })
    selectBlock('q')
    const promote = byId('promoteAssumption')
    promote.focus()
    promote.click()
    assert.eq(state.blocks.q.type, 'assumption')
    assert.eq(document.activeElement, byId('inspTypeBtn'), 'promote lands on the type chip')
    // The harness canvas is a hidden stub: make it a real focus target.
    const vp = byId('canvasViewport'), display = vp.style.display
    vp.style.display = ''
    vp.tabIndex = 0
    try {
      byId('inspMoreBtn').focus()
      open('inspMoreBtn')
      pick('Delete block')
      assert.eq(state.blocks.q, undefined)
      assert.eq(document.activeElement, vp, 'Delete block hands focus to the canvas')
    } finally {
      vp.style.display = display
      vp.removeAttribute('tabindex')
      vp.blur()
    }
  })

  it('a connection end pressed from the keyboard lands on the block\'s type chip', async () => {
    reset()
    block('a', { title: 'Source' }); block('b', { title: 'Target' })
    arrow('x', 'a', 'b')
    refresh()
    selectArrow('x')
    const camera = { ...view }
    try {
      const from = byId('arrowInfo').querySelector('button[data-select-block="a"]')
      from.focus()
      from.click()
      for (let i = 0; i < 20 && document.activeElement !== byId('inspTypeBtn'); i++) await tick(20)
      assert.eq(selection.blockId, 'a')
      assert.eq(document.activeElement, byId('inspTypeBtn'))
    } finally {
      await tick(320)
      Object.assign(view, camera)
      applyTransform()
    }
  })

  it('canvas keys stop at the panel: Backspace on a summary deletes nothing, Escape keeps the selection', () => {
    reset()
    block('g')
    selectBlock('g')
    const reached = []
    const spy = e => reached.push(e.key + (e.metaKey ? '+meta' : ''))
    document.addEventListener('keydown', spy)
    const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))
    try {
      const summary = byId('notesDetails').querySelector('summary')
      key(summary, 'Backspace')
      key(summary, 'Delete')
      key(byId('inspTypeBtn'), 'l')
      key(byId('inspTypeBtn'), 'ArrowRight')
      key(byId('inspTypeBtn'), 'Escape')
      assert.deepEq(reached, [], 'none of them reached the canvas shortcuts')
      assert.eq(selection.blockId, 'g', 'Escape did not deselect')
      key(byId('inspTypeBtn'), 'z', { metaKey: true })
      assert.deepEq(reached, ['z+meta'], 'undo still works from the panel')
      key(byId('inspTitle'), 'Backspace')
      assert.eq(reached.length, 2, 'a text field is left to the shortcuts\' own typing check')
    } finally { document.removeEventListener('keydown', spy) }
  })

  it('a connection on the previous weight scale reads by its old name', () => {
    reset()
    block('a'); block('b'); block('c')
    arrow('x', 'a', 'b', { weight: 2 })
    arrow('y', 'b', 'c', { weight: 5 })
    refresh()
    selectArrow('x')
    const sel = byId('arrowWeightSelect')
    assert.eq(sel.value, '2')
    assert.eq(sel.selectedOptions[0].textContent, 'Normal (2px)')
    selectArrow('y')
    assert.eq(sel.selectedOptions[0].textContent, 'Bold (5px)')
    assert.eq(sel.querySelectorAll('option[data-current]').length, 1, 'one off-scale option at a time')
  })

  it('placeholders reach 4.5:1 in both themes', () => {
    reset()
    block('a')
    selectBlock('a')
    byId('docsDetails').open = true
    const check = theme => ['inspDesc', 'docRefHref'].forEach(id => {
      const el = byId(id)
      const fg = channels(getComputedStyle(el, '::placeholder').color)
      const r = contrast(fg, backdrop(el))
      assert.gte(r, 4.5, `${theme} ${id} placeholder at ${r.toFixed(2)}:1`)
    })
    check('dark')
    document.body.classList.add('light-mode')
    try { check('light') } finally { document.body.classList.remove('light-mode') }
    byId('docsDetails').open = false
  })

  it('the type menu opens under its button with every type and the notes in view, no scrolling', () => {
    reset()
    block('c', { type: 'custom', typeCheck: true, typeHint: 'widget' })
    selectBlock('c')
    host.el.scrollTop = 0
    const m = open('inspTypeBtn')
    const r = m.getBoundingClientRect()
    atMost(r.height, 640, `${Math.round(r.height)}px tall`)
    atMost(m.scrollHeight, m.clientHeight + 1, 'nothing below the fold of the menu')
    const notes = m.querySelector('.type-menu-notes')
    atMost(notes.getBoundingClientRect().bottom, r.bottom + 0.5, 'the notes that tell types apart are visible')
    assert.gte(r.top, byId('inspTypeBtn').getBoundingClientRect().bottom - 0.5, 'it does not cover its own button')
    closeMenus()
  })

  it('Appearance stays one row with its longest values, in the 320px and the 280px panel', () => {
    reset()
    block('r', { cardStyle: 'bar', borderWidth: 1.5, highlight: 'alert', color: '#34d399' })
    selectBlock('r')
    byId('appearanceDetails').open = true
    const width = host.el.style.width
    try {
      for (const w of ['320px', '280px']) {
        host.el.style.width = w
        const tops = ['inspColourBtn', 'inspCardBtn', 'inspBorderBtn', 'inspHighlightBtn']
          .map(id => Math.round(byId(id).getBoundingClientRect().top))
        assert.eq(new Set(tops).size, 1, `${w}: ${tops.join(', ')}`)
        const text = byId('inspCardText')
        atMost(text.scrollWidth, text.clientWidth + 0.5, `${w}: "Accent bar" is whole`)
      }
    } finally {
      host.el.style.width = width
      byId('appearanceDetails').open = false
    }
  })
})

describe('Inspector: QA round', () => {
  it('undo keeps the block selected, the panel on it and focus on the control used', async () => {
    await mount(); reset()
    block('r', { title: 'Key Results' })
    selectBlock('r')
    open('inspTypeBtn')
    pick('Metric')
    assert.eq(state.blocks.r.type, 'metric')
    byId('inspTypeBtn').focus()
    undo()
    assert.eq(state.blocks.r.type, 'goal', 'the type is restored')
    assert.eq(selection.blockId, 'r', 'still selected')
    assert.ok(getBlockEl('r').classList.contains('selected'), 'the card still shows it')
    assert.ok(byId('inspectorContent').style.display !== 'none', 'the panel stays on the block')
    assert.eq(document.activeElement, byId('inspTypeBtn'), 'focus stays on the type button')
    open('inspTypeBtn'); pick('Metric')
    assert.eq(state.blocks.r.type, 'metric', 'change again with no reselect')
  })

  it('undo drops only what no longer exists from the selection', async () => {
    await mount(); reset()
    block('a')
    const c = duplicateBlock('a')
    setSelection(['a', c])
    undo()
    assert.ok(!state.blocks[c], 'the duplicate is gone')
    assert.deepEq([...selection.ids], ['a'], 'the block that is still there stays selected')
    assert.eq(selection.blockId, 'a')
    reset()
  })

  it('Reverse is refused when a connection already runs the other way, as in the right-click menu', async () => {
    await mount(); reset()
    block('a'); block('b', { x: 400 })
    arrow('fw', 'a', 'b', { label: 'forward note' })
    arrow('bk', 'b', 'a', { label: 'back' })
    refresh()
    selectArrow('fw')
    const hist = history()
    byId('arrowReverse').click()
    assert.deepEq(state.arrows.map(a => a.from + '>' + a.to + ':' + a.label), ['a>b:forward note', 'b>a:back'],
      'no second b>a drawn on top of the first')
    assert.eq(history(), hist, 'no undo step for a refusal')
    // Without the opposite connection, Reverse still works as one step.
    state.arrows = state.arrows.filter(a => a.id !== 'bk')
    refresh(); selectArrow('fw')
    byId('arrowReverse').click()
    assert.eq(state.arrows[0].from + '>' + state.arrows[0].to, 'b>a')
    assert.eq(history(), hist + 1)
    reset()
  })

  it('opening Appearance scrolls the panel so its controls are in view', async () => {
    await mount(); reset()
    block('r', { type: 'requirement', title: 'Key Results',
      description: Array.from({ length: 14 }, (_, i) => 'Line ' + i).join('\n'), criteria: ['One', 'Two', 'Three'] })
    selectBlock('r')
    host.el.scrollTop = 0
    const d = byId('appearanceDetails')
    assert.eq(d.open, false)
    // Measured in the frame after the toggle, when the reveal has run. WebKit
    // later resets this fixed test host's scroll on its own (the real panel
    // keeps it), so a timer-based wait there read the chip back at the top.
    const toggled = new Promise(r => d.addEventListener('toggle', r, { once: true }))
    d.querySelector('summary').click()
    await Promise.race([toggled, tick(200)])
    await new Promise(r => requestAnimationFrame(r))
    assert.ok(d.open, 'the section opened')
    const box = host.el.getBoundingClientRect(), chip = byId('inspColourBtn').getBoundingClientRect()
    assert.ok(chip.bottom <= box.bottom + 0.5 && chip.top >= box.top - 0.5,
      `the Colour chip (${Math.round(chip.top)}-${Math.round(chip.bottom)}) is inside the panel (${Math.round(box.top)}-${Math.round(box.bottom)})`)
    assert.ok(d.querySelector('summary').getBoundingClientRect().top >= box.top - 0.5, 'the summary stays on screen')
    d.open = false
    reset()
  })
})

describe('Inspector: shared pieces', () => {
  it('typeMenuItems is reusable by other menus and marks nothing checked for a mixed selection', () => {
    const items = typeMenuItems(null, () => {})
    const radios = items.filter(i => i.radio)
    assert.eq(radios.length, 16)
    assert.eq(radios.filter(i => i.checked).length, 0)
    assert.eq(items.filter(i => i.type === 'heading').length, TYPE_STEPS.length)
  })

  it('puts the harness back the way it found it', () => {
    reset()
    unmount()
    assert.eq(document.querySelector('.panel-content #inspectorPane'), null)
    assert.ok(byId('inspTitle'), 'the stub is back')
    assert.eq(byId('inspTitle').style.display, 'none')
    assert.eq(getBlockEl('r'), null)
  })
})

// ── Phone: the right panel as a bottom sheet ─────────────────
//
// Behaviour runs here with phone mode pinned on (sheet.force) and the real
// #rightPanel mounted in place of the harness stubs. Layout runs in an
// iframe at phone sizes with the real stylesheets and the page's own
// markup, since the sheet only exists under the 700px media query.

const phone = { el: null, placeholders: [], mounted: false }
const SHEET_VARS = { '--sheet-peek': '56px', '--sheet-half': '420px', '--sheet-full': '690px' }
let pageHtml = null
const pageMarkup = async () => pageHtml || (pageHtml = await (await fetch('../index.html', { cache: 'no-store' })).text())

async function mountSheet() {
  if (phone.mounted) return
  const doc = new DOMParser().parseFromString(await pageMarkup(), 'text/html')
  const panel = document.importNode(doc.getElementById('rightPanel'), true)
  panel.querySelectorAll('[id]').forEach(n => {
    const stub = document.getElementById(n.id)
    if (!stub) return
    const mark = document.createComment('stub ' + n.id)
    stub.replaceWith(mark)
    phone.placeholders.push({ mark, stub })
  })
  phone.el = document.createElement('div')
  phone.el.style.cssText = 'position:fixed;left:0;top:0;width:375px;height:812px;display:flex;flex-direction:column;overflow:hidden;z-index:5;background:#040714'
  phone.el.appendChild(panel)
  document.body.appendChild(phone.el)
  // The sheet heights are CSS variables set under the phone media query;
  // the harness is wider, so they are set by hand for the drag maths.
  Object.entries(SHEET_VARS).forEach(([k, v]) => document.documentElement.style.setProperty(k, v))
  sheet.force = true
  sheet.openDelay = 0
  setupInspectorEvents()
  phone.mounted = true
}

function unmountSheet() {
  closeMenus()
  phone.el?.remove()
  phone.placeholders.forEach(({ mark, stub }) => mark.replaceWith(stub))
  phone.placeholders = []
  Object.keys(SHEET_VARS).forEach(k => document.documentElement.style.removeProperty(k))
  sheet.force = null
  sheet.short = null
  sheet.openDelay = 300
  sheet.state = 'peek'
  document.body.classList.remove('comparing-snapshot')
  ui.activeTab = 'inspector'
  phone.mounted = false
}

async function phoneReset() {
  await mountSheet()
  reset()
  sheet.force = true
  sheet.short = null
  ui.votingMode = false
  ui.activeTab = 'inspector'
  setSheet('peek')
  byId('rightPanel').style.height = ''
}

const handleEl = () => byId('sheetHandle')
const handleTitle = () => byId('sheetTitle').textContent
const pointer = (target, type, x, y, id = 41) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }))
// A tap on a card: the press selects it, as the canvas does, then lifts.
async function tapCard(id, { moveBy = 0, select = true } = {}) {
  const el = getBlockEl(id)
  pointer(el, 'pointerdown', 20, 20)
  if (select) selectBlock(id)
  if (moveBy) state.blocks[id].x += moveBy
  pointer(el, 'pointerup', 20 + moveBy, 20)
  await tick(20)
}
const escapeOn = target => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  target.dispatchEvent(e)
  return e
}
// A drag on the handle, one step per entry of `ys`, `gap` ms apart. A
// touch stays with the element it went down on, so every event targets
// the handle (and bubbles to the window, where the sheet follows it).
async function dragHandle(ys, gap = 30) {
  const h = handleEl()
  pointer(h, 'pointerdown', 180, ys[0], 42)
  for (const y of ys.slice(1)) { await tick(gap); pointer(h, 'pointermove', 180, y, 42) }
  pointer(h, 'pointerup', 180, ys[ys.length - 1], 42)
  await tick(10)
}

describe('Inspector: phone sheet', () => {
  it('the handle names the selection: type dot and title, or Nothing selected', async () => {
    await phoneReset()
    block('a', { type: 'requirement', title: 'Weekly numbers in one place' })
    block('b', { type: 'output', title: 'Status notes pack', x: 400 })
    arrow('ab', 'a', 'b'); refresh()
    assert.eq(handleTitle(), 'Nothing selected')
    assert.ok(byId('sheetDot').classList.contains('is-empty'), 'an empty ring, not a colour')
    selectBlock('a')
    assert.eq(handleTitle(), 'Weekly numbers in one place')
    assert.eq(byId('sheetKind').textContent, 'Requirement: ', 'the type is read out before the title')
    assert.ok(!byId('sheetDot').hidden && !byId('sheetDot').classList.contains('is-empty'))
    assert.eq(byId('sheetDot').style.background, 'var(--c-requirement)')
    mutateBlock('a', { title: 'Weekly numbers, one place' })
    assert.eq(handleTitle(), 'Weekly numbers, one place', 'follows an edit to the title')
    setSelection(['a', 'b'])
    assert.eq(handleTitle(), '2 blocks selected')
    assert.ok(byId('sheetDot').hidden)
    selectArrow('ab')
    assert.eq(handleTitle(), 'Weekly numbers, one place \u2192 Status notes pack')
    assert.eq(byId('sheetKind').textContent, 'Connection: ')
    deselectAll()
    assert.eq(handleTitle(), 'Nothing selected')
  })

  it('a tap on a card opens a collapsed sheet at half, once the finger lifts', async () => {
    await phoneReset()
    block('a', { type: 'goal', title: 'Faster status notes' })
    const el = getBlockEl('a')
    pointer(el, 'pointerdown', 20, 20)
    selectBlock('a')
    await tick(20)
    assert.eq(sheetState(), 'peek', 'not while the finger is still down: it may be a drag')
    pointer(el, 'pointerup', 20, 20)
    await tick(20)
    assert.eq(sheetState(), 'half')
    assert.eq(byId('rightPanel').dataset.sheet, 'half')
    assert.eq(handleEl().getAttribute('aria-expanded'), 'true')
    assert.eq(byId('panelContent').scrollTop, 0, 'the panel starts at its top, where the Title is')
  })

  it('a press that moved the card is a drag and leaves the sheet down', async () => {
    await phoneReset()
    block('a')
    await tapCard('a', { moveBy: 40 })
    assert.eq(sheetState(), 'peek')
    assert.eq(selection.blockId, 'a')
  })

  it('a tap on the card already selected brings the sheet back up', async () => {
    await phoneReset()
    block('a')
    await tapCard('a')
    assert.eq(sheetState(), 'half')
    setSheet('peek')
    await tapCard('a', { select: false })
    assert.eq(sheetState(), 'half', 'the selection did not change, the tap still asks for the details')
  })

  it('a double-tap that edits the title on the card keeps the sheet down', async () => {
    await phoneReset()
    block('a')
    const title = getBlockEl('a').querySelector('.block-title')
    pointer(getBlockEl('a'), 'pointerdown', 20, 20)
    selectBlock('a')
    pointer(getBlockEl('a'), 'pointerup', 20, 20)
    title.contentEditable = 'true'          // the second tap's dblclick started the edit
    await tick(20)
    assert.eq(sheetState(), 'peek')
    title.contentEditable = 'false'
  })

  it('opening on a tap brings the Inspector tab forward', async () => {
    await phoneReset()
    block('a')
    ui.activeTab = 'prompt'
    let clicked = 0
    const tab = document.querySelector('#rightPanel .panel-tab[data-tab="inspector"]')
    const count = () => clicked++
    tab.addEventListener('click', count)
    await tapCard('a')
    tab.removeEventListener('click', count)
    assert.eq(clicked, 1)
    assert.eq(sheetState(), 'half')
    ui.activeTab = 'inspector'
  })

  it('selecting several blocks names them on the handle without opening the sheet', async () => {
    await phoneReset()
    block('a'); block('b', { x: 400 })
    setSelection(['a', 'b'])
    await tick(20)
    assert.eq(sheetState(), 'peek')
  })

  it('deselecting puts a half sheet away; a sheet pulled to full stays', async () => {
    await phoneReset()
    block('a')
    await tapCard('a')
    assert.eq(sheetState(), 'half')
    deselectAll()
    assert.eq(sheetState(), 'peek')
    selectBlock('a')
    setSheet('full')
    deselectAll()
    assert.eq(sheetState(), 'full', 'a full sheet was asked for; deselecting does not take it away')
  })

  it('the handle: a tap expands to full or collapses; Up and Down step through the states', async () => {
    await phoneReset()
    const h = handleEl()
    h.click()
    assert.eq(sheetState(), 'full')
    assert.match(h.textContent, /Collapse details/)
    h.click()
    assert.eq(sheetState(), 'peek')
    assert.match(h.textContent, /Expand details/)
    assert.eq(h.getAttribute('aria-expanded'), 'false')
    const key = k => h.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    key('ArrowUp'); assert.eq(sheetState(), 'half')
    key('ArrowUp'); assert.eq(sheetState(), 'full')
    key('ArrowUp'); assert.eq(sheetState(), 'full', 'no state past full')
    key('ArrowDown'); assert.eq(sheetState(), 'half')
    key('ArrowDown'); key('ArrowDown'); assert.eq(sheetState(), 'peek')
  })

  it('a drag on the handle settles on the nearest state, a flick goes further', async () => {
    await phoneReset()
    const panel = byId('rightPanel')
    // Slow, from collapsed (56px) up to about 390px: half (420px).
    panel.style.height = '56px'
    await dragHandle([760, 752, 600, 450, 400, 395, 392, 390, 388])
    assert.eq(sheetState(), 'half')
    assert.eq(panel.style.height, '', 'the drag height is handed back to the stylesheet')
    assert.ok(!panel.classList.contains('sheet-dragging'))
    // The click a drag leaves behind does not toggle the sheet as well.
    handleEl().click()
    assert.eq(sheetState(), 'half')
    await tick(420)
    // Slow, from half down to about 90px: collapsed.
    panel.style.height = '420px'
    await dragHandle([400, 410, 600, 700, 720, 725, 728, 730])
    assert.eq(sheetState(), 'peek')
    await tick(420)
    // A quick flick up from collapsed goes past half to full.
    panel.style.height = '56px'
    await dragHandle([760, 740, 690], 16)
    assert.eq(sheetState(), 'full')
    await tick(420)
    // Under 6px is a tap, not a drag: the state is the click's to change.
    panel.style.height = ''
    setSheet('half')
    await dragHandle([500, 503])
    assert.eq(sheetState(), 'half')
    // A drag whose release never came does not jam the handle: the next
    // press starts over.
    pointer(handleEl(), 'pointerdown', 180, 500, 50)
    pointer(handleEl(), 'pointermove', 180, 420, 50)
    assert.ok(panel.classList.contains('sheet-dragging'))
    await tick(420)
    await dragHandle([400, 410, 600, 700, 720, 725, 728, 730])
    assert.eq(sheetState(), 'peek')
    assert.ok(!panel.classList.contains('sheet-dragging'))
    assert.eq(panel.style.height, '')
  })

  it('Escape collapses the sheet, keeps the selection and hands focus to the handle', async () => {
    await phoneReset()
    block('a', { title: 'Faster status notes' })
    await tapCard('a')
    assert.eq(sheetState(), 'half')
    const input = byId('inspTitle')
    input.focus()
    assert.eq(document.activeElement, input)
    const e = escapeOn(input)
    assert.eq(sheetState(), 'peek')
    assert.ok(e.defaultPrevented, 'the canvas does not also deselect on the same key')
    assert.eq(selection.blockId, 'a')
    assert.eq(document.activeElement, handleEl())
  })

  it('Escape is left to an open menu first', async () => {
    await phoneReset()
    block('a')
    await tapCard('a')
    byId('inspTypeBtn').click()
    assert.ok(menu(), 'the type menu opened')
    escapeOn(document.activeElement)
    assert.eq(sheetState(), 'half', 'the menu takes the Escape, the sheet stays')
    closeMenus()
  })

  it('a menu the tap opened (the quick-add picker from a port) keeps the screen', async () => {
    await phoneReset()
    block('a')
    const el = getBlockEl('a')
    pointer(el, 'pointerdown', 20, 20)
    selectBlock('a')
    pointer(el, 'pointerup', 20, 20)
    byId('inspTypeBtn').click()               // any menu.js menu will do
    assert.ok(menu())
    await tick(20)
    assert.eq(sheetState(), 'peek')
    closeMenus()
  })

  it('Escape is left to a dialog, the search and dot voting', async () => {
    await phoneReset()
    block('a')
    await tapCard('a')
    const dialog = document.createElement('dialog')
    document.body.appendChild(dialog)
    dialog.showModal()                          // as the incoming-link chooser is
    try {
      assert.ok(!escapeOn(document.body).defaultPrevented)
      assert.eq(sheetState(), 'half')
    } finally { dialog.close(); dialog.remove() }
    for (const flag of ['searchOpen', 'votingMode']) {
      ui[flag] = true
      try {
        assert.ok(!escapeOn(document.body).defaultPrevented, flag)
        assert.eq(sheetState(), 'half', flag)
      } finally { ui[flag] = false }
    }
    assert.ok(escapeOn(document.body).defaultPrevented, 'with nothing else open, Escape is the sheet\'s')
    assert.eq(sheetState(), 'peek')
  })

  it('a pointer whose release never arrived does not hold the sheet down', async () => {
    await phoneReset()
    block('a')
    pointer(document.body, 'pointerdown', 5, 5, 77)   // no pointerup follows
    await tapCard('a')
    assert.eq(sheetState(), 'half')
  })

  it('above 700px nothing moves: no opening on select, no Escape taken', async () => {
    await phoneReset()
    block('a')
    sheet.force = false
    await tapCard('a')
    assert.eq(sheetState(), 'peek')
    sheet.state = 'half'
    const e = escapeOn(document.body)
    assert.ok(!e.defaultPrevented)
    assert.eq(sheetState(), 'half')
    sheet.force = true
  })

  it('a text field in a half sheet takes the full sheet, where a phone keyboard leaves it room', async () => {
    await phoneReset()
    block('a')
    await tapCard('a')
    // The headless window never has system focus, so focus() moves the
    // caret without firing focusin; the event a person's tap fires is sent
    // by hand (the CDP phone probe covers the real tap).
    const focusIn = el => el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    focusIn(byId('inspTypeBtn'))
    assert.eq(sheetState(), 'half', 'a button is not typing')
    focusIn(byId('inspDesc'))
    assert.eq(sheetState(), 'full')
  })

  it('Add question from a menu opens the full sheet on the question', async () => {
    await phoneReset()
    block('a', { questions: [{ text: 'Who reads the notes?' }] })
    focusQuestion('a', 0)
    assert.eq(sheetState(), 'full')
    assert.eq(document.activeElement?.dataset.qi, '0')
  })

  it('a snapshot comparison brings the sheet up, and puts it away when it closes', async () => {
    await phoneReset()
    document.body.classList.add('comparing-snapshot')
    await tick(0)
    assert.eq(sheetState(), 'half')
    assert.eq(handleTitle(), 'Snapshot comparison')
    document.body.classList.remove('comparing-snapshot')
    await tick(0)
    assert.eq(sheetState(), 'peek')
    assert.eq(handleTitle(), 'Nothing selected')
  })

  it('on a view-only link a tap leaves the sheet down, so the review bar stays in view', async () => {
    await phoneReset()
    block('a')
    const bar = document.createElement('div')
    bar.id = 'reviewBar'
    bar.textContent = 'review'
    document.body.appendChild(bar)
    try {
      await tapCard('a')
      assert.eq(sheetState(), 'peek')
      assert.eq(handleTitle(), 'a', 'the handle still names the card')
    } finally { bar.remove() }
  })

  it('a started Session timer shows its time on the collapsed handle', async () => {
    await phoneReset()
    setupTimer()
    const mirror = byId('sheetTimer')
    assert.ok(mirror.hidden, 'nothing on the handle until the timer runs')
    assert.eq(mirror.getAttribute('aria-hidden'), 'true', 'the timer row is what a screen reader reads')
    byId('timerMinutes').value = '2'
    byId('timerMinutes').dispatchEvent(new Event('input', { bubbles: true }))
    byId('timerStartBtn').click()
    try {
      assert.ok(!mirror.hidden)
      assert.eq(mirror.textContent, byId('timerDisplay').textContent)
      assert.match(mirror.textContent, /^\d\d:\d\d$/)
      assert.ok(mirror.classList.contains('warning'), 'the warning colour comes along')
    } finally {
      byId('timerResetBtn').click()
    }
    assert.ok(mirror.hidden)
  })

  // ── Review round: taps against gestures, and the guards ──
  // A second finger is not the primary pointer, which is how the page
  // tells a pinch from two taps.
  const touch = (target, type, x, y, id, primary) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: x, clientY: y }))

  it('a pinch that starts on a card zooms and leaves the sheet down', async () => {
    await phoneReset()
    block('a')
    const el = getBlockEl('a'), saved = { ...view }
    try {
      touch(el, 'pointerdown', 20, 20, 41, true)
      selectBlock('a')                              // the first finger selects it, as the canvas does
      touch(el, 'pointerdown', 60, 20, 43, false)   // the second finger: a pinch
      touch(el, 'pointermove', 90, 20, 43, false)
      touch(el, 'pointerup', 90, 20, 43, false)
      touch(el, 'pointerup', 20, 20, 41, true)
      await tick(20)
      assert.eq(sheetState(), 'peek', 'the card never moved, but the gesture was not a tap')
      assert.eq(state.blocks.a.x, 40)
      // Two fingers that never move are still not a tap.
      touch(el, 'pointerdown', 20, 20, 41, true)
      touch(el, 'pointerdown', 60, 20, 43, false)
      touch(el, 'pointerup', 60, 20, 43, false)
      touch(el, 'pointerup', 20, 20, 41, true)
      await tick(20)
      assert.eq(sheetState(), 'peek', 'a two-finger press')
      // The next plain tap is a tap again.
      await tapCard('a', { select: false })
      assert.eq(sheetState(), 'half')
    } finally { Object.assign(view, saved); applyTransform() }
  })

  it('a pan that starts on a line leaves the sheet down, even when it comes back to where it began', async () => {
    await phoneReset()
    block('a', { type: 'requirement' }); block('b', { type: 'output', x: 400 })
    arrow('ab', 'a', 'b'); refresh()
    const line = document.querySelector('#arrowsGroup [data-aid="ab"]') || document.body
    // Control: a plain tap on the line opens the sheet.
    pointer(line, 'pointerdown', 200, 60)
    selectArrow('ab')
    pointer(line, 'pointerup', 200, 60)
    await tick(20)
    assert.eq(sheetState(), 'half', 'the control: a tap on a line inspects it')
    deselectAll(); setSheet('peek')
    // A pan out and back: the release lands on the press, only the moves tell.
    pointer(line, 'pointerdown', 200, 60)
    selectArrow('ab')
    pointer(line, 'pointermove', 200, 130)
    pointer(line, 'pointermove', 201, 62)
    pointer(line, 'pointerup', 201, 62)
    await tick(20)
    assert.eq(sheetState(), 'peek', 'a pan on a line')
    assert.eq(selection.arrowId, 'ab')
    // A swipe that ends away from where it began.
    deselectAll()
    pointer(line, 'pointerdown', 200, 60)
    selectArrow('ab')
    pointer(line, 'pointerup', 200, 160)
    await tick(20)
    assert.eq(sheetState(), 'peek', 'a swipe on a line')
  })

  it('a pointer the browser cancels (it took the gesture) leaves the sheet down', async () => {
    await phoneReset()
    block('a')
    const el = getBlockEl('a')
    pointer(el, 'pointerdown', 20, 20)
    selectBlock('a')
    pointer(el, 'pointercancel', 20, 20)
    await tick(20)
    assert.eq(sheetState(), 'peek')
  })

  it('in dot voting a tap is a vote: the sheet stays down', async () => {
    await phoneReset()
    block('a'); block('b', { x: 400 })
    ui.votingMode = true
    try {
      await tapCard('a')
      assert.eq(sheetState(), 'peek', 'a new selection')
      await tapCard('a', { select: false })
      assert.eq(sheetState(), 'peek', 'the card already selected')
      await tapCard('b')
      assert.eq(sheetState(), 'peek', 'the next vote')
      assert.eq(handleTitle(), 'b', 'the handle still names the card')
    } finally { ui.votingMode = false }
    await tapCard('a')
    assert.eq(sheetState(), 'half', 'out of voting, a tap inspects again')
  })

  it('Escape closes the doc preview first, then collapses the sheet', async () => {
    await phoneReset()
    block('a', { docRef: { label: 'Status notes guide', href: '', anchor: '' } })
    await tapCard('a')
    assert.eq(sheetState(), 'half')
    const input = byId('inspTitle')
    input.focus()
    // In a page with system focus, focusing the Title field opens the sheet
    // to full (the phone keyboard rule); the headless runner fires no focus
    // event, so it stays at half. Either way the preview's Escape must leave
    // the sheet where it is.
    const before = sheetState()
    openDocPopup('a', input)
    assert.ok(document.querySelector('.doc-popup'), 'the preview is open')
    const e = escapeOn(input)
    assert.eq(document.querySelector('.doc-popup'), null, 'the preview took the Escape')
    assert.ok(!e.defaultPrevented)
    assert.eq(sheetState(), before, 'the sheet stays up')
    assert.ok(escapeOn(input).defaultPrevented)
    assert.eq(sheetState(), 'peek', 'the next Escape is the sheet\'s')
  })

  it('Escape is left to the shortcut sheet and to an edit on the canvas', async () => {
    await phoneReset()
    block('a')
    await tapCard('a')
    const help = byId('shortcutOverlay'), was = help.style.display
    help.style.display = 'flex'
    try {
      assert.ok(!escapeOn(document.body).defaultPrevented, 'the shortcut sheet')
      assert.eq(sheetState(), 'half', 'the shortcut sheet')
    } finally { help.style.display = was }
    // The real editor on the card: its Escape commits the title.
    startInlineEdit('a', 'title')
    assert.ok(isInlineEditing(), 'editing the title on the card')
    escapeOn(getBlockEl('a').querySelector('.block-title'))
    assert.ok(!isInlineEditing(), 'the edit took the Escape and committed')
    assert.eq(sheetState(), 'half', 'the title')
    // The line label editor: its field takes Escape to commit, as
    // arrow-edit.js does.
    const edit = document.createElement('div')
    edit.className = 'arrow-edit'
    const field = document.createElement('input')
    let committed = 0
    field.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); committed++ } })
    edit.appendChild(field)
    getBlockEl('a').parentElement.appendChild(edit)
    try {
      escapeOn(field)
      assert.eq(committed, 1, 'the line label editor got the key')
      assert.eq(sheetState(), 'half', 'the line label')
    } finally { edit.remove() }
    assert.ok(escapeOn(document.body).defaultPrevented)
    assert.eq(sheetState(), 'peek')
  })

  it('a snapshot comparison lands focus on its Close button, and Escape there is the comparison\'s', async () => {
    await phoneReset()
    const header = byId('comparisonHeader'), close = byId('comparisonClose')
    header.hidden = false
    try {
      // openComparison focuses Close while the sheet is still collapsed,
      // which hides it on a phone, so that focus goes nowhere.
      document.activeElement?.blur()
      document.body.classList.add('comparing-snapshot')
      await tick(0)
      assert.eq(sheetState(), 'half')
      assert.eq(document.activeElement, close, 'focus is where openComparison meant it to be')
      const e = escapeOn(close)
      assert.ok(!e.defaultPrevented, 'comparison-ui.js closes the comparison on this key')
      assert.eq(sheetState(), 'half', 'the sheet does not take it')
    } finally {
      header.hidden = true
      document.body.classList.remove('comparing-snapshot')
      await tick(0)
    }
    assert.eq(sheetState(), 'peek')
    // A comparison opened on a full sheet keeps it full.
    setSheet('full')
    document.body.classList.add('comparing-snapshot')
    await tick(0)
    assert.eq(sheetState(), 'full')
    document.body.classList.remove('comparing-snapshot')
    await tick(0)
  })

  it('a tap on the handle right after a drag is a tap; only the drag\'s own click is eaten', async () => {
    await phoneReset()
    const panel = byId('rightPanel'), h = handleEl()
    panel.style.height = '420px'
    setSheet('half')
    await dragHandle([400, 410, 600, 700, 720, 725, 728, 730])
    assert.eq(sheetState(), 'peek')
    // A touch drag sends no click. The next tap, at once, still toggles.
    pointer(h, 'pointerdown', 180, 790)
    pointer(h, 'pointerup', 180, 790)
    h.click()
    assert.eq(sheetState(), 'full', 'no time window swallows it')
    // A mouse drag's click is still eaten; a key on the handle clears that.
    panel.style.height = '690px'
    await dragHandle([130, 140, 300, 420, 430, 432, 434, 435])
    const settled = sheetState()
    h.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    h.click()
    assert.eq(sheetState(), settled === 'full' ? 'peek' : 'full', 'Enter on the handle is never eaten')
    panel.style.height = ''
  })

  it('on a phone on its side a tap leaves the sheet down; the handle still opens it', async () => {
    await phoneReset()
    block('a')
    sheet.short = true
    try {
      await tapCard('a')
      assert.eq(sheetState(), 'peek')
      handleEl().click()
      assert.eq(sheetState(), 'full')
    } finally { sheet.short = null }
  })

  it('opening on a tap moves the camera so the card sits above the sheet', async () => {
    await phoneReset()
    const vp = byId('canvasViewport'), prev = vp.getAttribute('style'), saved = { ...view }
    vp.setAttribute('style', 'display:block;position:fixed;left:-4000px;top:0;width:375px;height:812px;overflow:hidden')
    Object.assign(view, { panX: 0, panY: 0, zoom: 1 })
    try {
      block('a')
      const el = getBlockEl('a'), v = vp.getBoundingClientRect()
      // The harness has no card layout: the card's box follows the camera.
      el.getBoundingClientRect = () => new DOMRect(v.left + 40 + view.panX, v.top + 700 + view.panY, 200, 80)
      const before = el.getBoundingClientRect()
      const floor = Math.min(v.bottom, window.innerHeight - 420)   // the top of the half sheet
      assert.gt(before.bottom, floor, 'the card starts under where the sheet will be')
      await tapCard('a')
      assert.eq(sheetState(), 'half')
      for (let i = 0; i < 40; i++) { await tick(25); if (el.getBoundingClientRect().bottom <= floor) break }
      await tick(40)
      const r = el.getBoundingClientRect()
      assert.ok(r.bottom <= floor - 11 && r.top >= v.top + 11, `card ${Math.round(r.top)}-${Math.round(r.bottom)}, sheet from ${Math.round(floor)}`)
      assert.eq(view.zoom, 1, 'only the camera position moves')
      assert.eq(state.blocks.a.y, 40, 'the map does not change')
    } finally {
      Object.assign(view, saved)
      applyTransform()
      if (prev === null) vp.removeAttribute('style'); else vp.setAttribute('style', prev)
    }
  })

  it('crossing 700px either way starts the sheet collapsed', async () => {
    await phoneReset()
    assert.ok(sheet.media, 'the phone query is kept')
    setSheet('full')
    sheet.media.dispatchEvent(new Event('change'))
    assert.eq(sheetState(), 'peek')
    assert.eq(byId('rightPanel').dataset.sheet, 'peek')
  })

  it('puts the harness back the way it found it', () => {
    reset()
    unmountSheet()
    assert.eq(byId('rightPanel'), null)
    assert.ok(byId('inspTitle') && byId('inspTitle').style.display === 'none', 'the stub is back')
    assert.eq(sheet.force, null)
  })
})

// A phone-sized page: the stylesheets and the page's own markup, no scripts.
async function phoneFrame(width, height, { bodyClass = '', state: st = 'peek', selected = true, timerOpen = false, zen = false } = {}) {
  const doc = new DOMParser().parseFromString(await pageMarkup(), 'text/html')
  doc.querySelectorAll('script, img').forEach(n => n.remove())
  doc.getElementById('rightPanel').dataset.sheet = st
  if (selected) {
    doc.getElementById('inspectorEmpty').style.display = 'none'
    doc.getElementById('inspectorContent').style.display = ''
    doc.getElementById('inspTitle').setAttribute('value', 'One place for the numbers')
  }
  if (timerOpen) doc.getElementById('timerControls').style.display = 'flex'
  const frame = document.createElement('iframe')
  frame.style.cssText = `position:fixed;left:-6000px;top:0;width:${width}px;height:${height}px;border:0`
  // The sheet's height transition is off: Firefox gives a srcdoc frame a
  // few pixels of viewport at first, and a quarter of the frames were
  // measured mid-transition from 52dvh of that. These tests are about the
  // layout at rest.
  frame.srcdoc = '<!DOCTYPE html><html><head>' +
    ['style', 'neorgon-header', 'neorgon-footer', 'neorgon-themes'].map(n => `<link rel="stylesheet" href="../css/${n}.css">`).join('') +
    '<style>#rightPanel { transition: none !important; }</style>' +
    `</head><body class="${bodyClass}"${zen ? ' data-zen="on"' : ''}>${doc.body.innerHTML}</body></html>`
  const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
  document.body.appendChild(frame)
  await loaded
  frame.contentDocument.getAnimations().forEach(a => a.finish())
  return frame
}
const boxIn = (frame, sel) => frame.contentDocument.querySelector(sel).getBoundingClientRect()
const styleIn = (frame, sel, pseudo) => frame.contentWindow.getComputedStyle(pseudo ? frame.contentDocument.querySelector(sel) : frame.contentDocument.querySelector(sel), pseudo || null)
// Every sampled point of the Title field is the field, it sits inside the
// panel's scroll box, and above the timer row.
function titleClear(frame) {
  const doc = frame.contentDocument
  const r = boxIn(frame, '#inspTitle'), box = boxIn(frame, '#panelContent'), timer = boxIn(frame, '#timerWidget')
  const hits = []
  for (const fx of [0.05, 0.5, 0.95]) for (const fy of [0.1, 0.5, 0.9]) hits.push(doc.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy)?.id || '?')
  return { ok: r.height > 20 && hits.every(h => h === 'inspTitle') && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5 && r.bottom <= timer.top + 0.5,
    detail: `title ${Math.round(r.top)}-${Math.round(r.bottom)}, box ${Math.round(box.top)}-${Math.round(box.bottom)}, timer at ${Math.round(timer.top)}, hits ${[...new Set(hits)]}` }
}

describe('Inspector: phone sheet layout', () => {
  for (const [W, H] of [[375, 812], [390, 844]]) {
    it(`${W}x${H}: collapsed, the sheet is its 56px handle at the foot of the screen`, async () => {
      const f = await phoneFrame(W, H, { selected: false })
      try {
        const p = boxIn(f, '#rightPanel')
        assert.eq(styleIn(f, '#rightPanel').position, 'fixed')
        assert.eq(Math.round(p.height), 56)
        assert.eq(Math.round(p.bottom), H)
        assert.eq(styleIn(f, '#sheetHandle').display, 'flex')
        for (const sel of ['.panel-tabs', '#panelContent', '#timerWidget']) {
          assert.eq(styleIn(f, sel).visibility, 'hidden', `${sel} is out of reach while collapsed`)
        }
        // The page keeps the handle's row free: the status bar ends above it.
        assert.ok(boxIn(f, '#canvasStatusbar').bottom <= p.top + 0.5, 'the status bar is above the sheet')
        assert.eq(styleIn(f, 'body', '::after').content, '""')
      } finally { f.remove() }
    })

    it(`${W}x${H}: half shows the Title whole, with the Session timer below it`, async () => {
      const f = await phoneFrame(W, H, { state: 'half' })
      try {
        const p = boxIn(f, '#rightPanel')
        assert.ok(Math.abs(p.height - Math.max(300, H * 0.52)) <= 1, `about half: ${Math.round(p.height)}px`)
        assert.eq(styleIn(f, '#panelContent').visibility, 'visible')
        const t = titleClear(f)
        assert.ok(t.ok, t.detail)
        // The canvas above the sheet is still there to use.
        assert.gt(p.top - boxIn(f, '#canvasViewport').top, 200)
      } finally { f.remove() }
    })

    it(`${W}x${H}: half with the timer's controls open still clears the Title`, async () => {
      const f = await phoneFrame(W, H, { state: 'half', timerOpen: true })
      try {
        const t = titleClear(f)
        assert.ok(t.ok, t.detail)
      } finally { f.remove() }
    })

    it(`${W}x${H}: full is about 85% of the screen`, async () => {
      const f = await phoneFrame(W, H, { state: 'full' })
      try {
        const p = boxIn(f, '#rightPanel')
        assert.ok(Math.abs(p.height - H * 0.85) <= 1, `${Math.round(p.height)}px`)
        assert.ok(titleClear(f).ok)
      } finally { f.remove() }
    })
  }

  it('light mode: the sheet is opaque and light', async () => {
    const f = await phoneFrame(375, 812, { state: 'half', bodyClass: 'light-mode' })
    try {
      assert.eq(styleIn(f, '#rightPanel').backgroundColor, 'rgb(251, 252, 254)')
    } finally { f.remove() }
  })

  it('embed and Zen: no sheet and no reserved row', async () => {
    for (const opts of [{ bodyClass: 'embed-mode readonly-mode' }, { zen: true }]) {
      const f = await phoneFrame(375, 812, opts)
      try {
        assert.eq(styleIn(f, 'body', '::after').content, 'none', JSON.stringify(opts))
        if (opts.bodyClass) assert.eq(styleIn(f, '#rightPanel').display, 'none')
      } finally { f.remove() }
    }
  })

  it('on a phone on its side half is plainly half: under full, with canvas above it', async () => {
    for (const [W, H] of [[667, 375], [700, 400], [640, 340]]) {
      const half = await phoneFrame(W, H, { state: 'half' })
      const full = await phoneFrame(W, H, { state: 'full' })
      try {
        const ph = boxIn(half, '#rightPanel'), pf = boxIn(full, '#rightPanel')
        assert.ok(Math.abs(ph.height - H * 0.52) <= 1, `${W}x${H}: half ${Math.round(ph.height)}px`)
        assert.gt(pf.height - ph.height, 40, `${W}x${H}: full ${Math.round(pf.height)}px is taller than half`)
        assert.gt(ph.top, boxIn(half, '#canvasViewport').top, `${W}x${H}: the half sheet starts below the canvas top`)
      } finally { half.remove(); full.remove() }
    }
    // A portrait phone keeps the floor that shows the Title whole.
    const tall = await phoneFrame(375, 560, { state: 'half' })
    try { assert.eq(Math.round(boxIn(tall, '#rightPanel').height), 300) } finally { tall.remove() }
  })

  it('the Session timer on the handle reaches 4.5:1 in both themes, warning and critical', async () => {
    const lum = ({ r, g, b }) => {
      const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    for (const bodyClass of ['', 'light-mode']) {
      const f = await phoneFrame(375, 812, { bodyClass })
      try {
        const t = f.contentDocument.getElementById('sheetTimer')
        t.hidden = false
        t.textContent = '01:59'
        const bg = channels(styleIn(f, '#rightPanel').backgroundColor)
        assert.eq(bg.a, 1, 'the sheet is opaque, so its colour is the backdrop')
        for (const level of ['warning', 'critical']) {
          t.className = 'sheet-timer ' + level
          const r = ratio(channels(styleIn(f, '#sheetTimer').color), bg)
          assert.gte(r, 4.5, `${bodyClass || 'dark'} ${level} at ${r.toFixed(2)}:1`)
        }
      } finally { f.remove() }
    }
  })

  it('above 700px the panel is a column again and the sheet state changes nothing', async () => {
    for (const [W, H] of [[1280, 800], [768, 1024], [701, 900]]) {
      const a = await phoneFrame(W, H, { state: 'peek' })
      const b = await phoneFrame(W, H, { state: 'full' })
      try {
        assert.eq(styleIn(a, '#sheetHandle').display, 'none', `${W}: no handle`)
        assert.neq(styleIn(a, '#rightPanel').position, 'fixed', `${W}: not a sheet`)
        assert.eq(styleIn(a, 'body', '::after').content, 'none', `${W}: no reserved row`)
        const pa = boxIn(a, '#rightPanel'), pb = boxIn(b, '#rightPanel')
        assert.deepEq([pa.x, pa.y, pa.width, pa.height].map(Math.round), [pb.x, pb.y, pb.width, pb.height].map(Math.round), `${W}: data-sheet is ignored`)
        assert.eq(styleIn(a, '.panel-tabs').visibility, 'visible')
      } finally { a.remove(); b.remove() }
    }
  })
})

// ── Phone sheet: second review round ─────────────────────────
// A sheet nobody can see, cards chosen while the sheet is already up, the
// scroll a new card starts at, a card's own controls, a full sheet the app
// chose, the handle's timer, and the pages that share the stylesheet.

// The canvas at 375x812 with each card's box following the camera (the
// harness has no card layout), so a camera move shows in the card's rect.
function phoneCamera(boxes) {
  const vp = byId('canvasViewport'), prev = vp.getAttribute('style'), saved = { ...view }
  vp.setAttribute('style', 'display:block;position:fixed;left:-4000px;top:0;width:375px;height:812px;overflow:hidden')
  Object.assign(view, { panX: 0, panY: 0, zoom: 1 })
  const v = vp.getBoundingClientRect()
  for (const [id, y] of Object.entries(boxes)) {
    getBlockEl(id).getBoundingClientRect = () => new DOMRect(v.left + 40 + view.panX, v.top + y + view.panY, 200, 60)
  }
  return {
    v,
    floor: Math.min(v.bottom, window.innerHeight - 420),     // the top of the half sheet
    restore() {
      Object.assign(view, saved)
      applyTransform()
      if (prev === null) vp.removeAttribute('style'); else vp.setAttribute('style', prev)
    },
  }
}
async function settleCamera(el, floor) {
  for (let i = 0; i < 40; i++) { await tick(25); if (el.getBoundingClientRect().bottom <= floor) break }
  await tick(40)
}

describe('Inspector: phone sheet, second review', () => {
  it('in Zen a tap on a card leaves the camera alone and Escape reaches the canvas', async () => {
    await phoneReset()
    block('a', { title: 'Status notes' })
    const cam = phoneCamera({ a: 700 })                 // under where a half sheet would be
    const panel = byId('rightPanel')
    let reached = 0
    const onKey = e => { if (e.key === 'Escape') reached++ }
    document.addEventListener('keydown', onKey)
    try {
      // What chrome.js does for Z: the panel is not drawn at all.
      panel.style.display = 'none'
      document.body.dataset.zen = 'on'
      await tapCard('a')
      await tick(320)
      assert.eq(sheetState(), 'peek', 'no sheet comes up where nobody can see it')
      assert.eq(panel.dataset.sheet, 'peek')
      assert.deepEq([view.panX, view.panY], [0, 0], 'the camera did not move')
      const e = escapeOn(document.body)
      assert.ok(!e.defaultPrevented, 'Escape is not taken by a hidden sheet')
      assert.eq(reached, 1, 'Escape reaches the canvas handlers, which deselect')
      // A sheet left up before Z does not take the key either.
      panel.style.display = ''
      setSheet('half')
      panel.style.display = 'none'
      assert.ok(!escapeOn(document.body).defaultPrevented, 'a half sheet hidden by Zen')
      assert.eq(reached, 2)
    } finally {
      document.removeEventListener('keydown', onKey)
      panel.style.display = ''
      delete document.body.dataset.zen
      cam.restore()
    }
  })

  it('in an embed a tap on a card leaves the camera alone and Escape reaches the canvas', async () => {
    await phoneReset()
    block('a')
    const cam = phoneCamera({ a: 700 })
    let reached = 0
    const onKey = e => { if (e.key === 'Escape') reached++ }
    document.addEventListener('keydown', onKey)
    ui.embed = true
    document.body.classList.add('embed-mode')
    try {
      await tapCard('a')
      await tick(320)
      assert.eq(sheetState(), 'peek')
      assert.deepEq([view.panX, view.panY], [0, 0], 'someone else\'s page keeps its view')
      assert.ok(!escapeOn(document.body).defaultPrevented)
      assert.eq(reached, 1)
    } finally {
      document.removeEventListener('keydown', onKey)
      ui.embed = false
      document.body.classList.remove('embed-mode')
      cam.restore()
    }
    // Control: drawn and not embedded, the same tap opens the sheet.
    await tapCard('a', { select: false })
    assert.eq(sheetState(), 'half')
  })

  it('a card chosen while the sheet is up (Tab, a search, a gap row) moves above the sheet', async () => {
    await phoneReset()
    block('a', { title: 'Visible one' }); block('m', { title: 'Under the sheet', y: 700 })
    const cam = phoneCamera({ a: 200, m: 700 })
    try {
      await tapCard('a')
      assert.eq(sheetState(), 'half')
      await tick(320)
      assert.deepEq([view.panX, view.panY], [0, 0], 'a card already in view does not move the camera')
      const el = getBlockEl('m')
      assert.gt(el.getBoundingClientRect().top, cam.floor, 'the card starts wholly under the sheet')
      selectBlock('m')                              // no pointer: the keyboard's path
      await settleCamera(el, cam.floor)
      const r = el.getBoundingClientRect()
      assert.ok(r.bottom <= cam.floor - 11 && r.top >= cam.v.top + 11, `card ${Math.round(r.top)}-${Math.round(r.bottom)}, sheet from ${Math.round(cam.floor)}`)
      assert.eq(sheetState(), 'half', 'the sheet stays where it was')
      assert.eq(view.zoom, 1, 'only the camera position moves')
    } finally { cam.restore() }
  })

  it('a card dragged while the sheet is up is not chased by the camera', async () => {
    await phoneReset()
    block('a'); block('m', { y: 700 })
    const cam = phoneCamera({ a: 200, m: 700 })
    try {
      await tapCard('a')
      assert.eq(sheetState(), 'half')
      await tick(320)
      const before = [view.panX, view.panY]
      await tapCard('m', { moveBy: 40 })
      await tick(320)
      assert.deepEq([view.panX, view.panY], before, 'a drag is not a request to look at the card')
      assert.eq(selection.blockId, 'm')
    } finally { cam.restore() }
  })

  it('switching cards on a half sheet starts the new one at its Title', async () => {
    await phoneReset()
    block('g', { title: 'Faster status notes' })
    block('r', { type: 'requirement', title: 'One place for the numbers', x: 400 })
    const content = byId('panelContent'), prev = content.getAttribute('style')
    content.setAttribute('style', 'display:block;overflow:auto;height:160px')
    try {
      await tapCard('g')
      assert.eq(sheetState(), 'half')
      content.scrollTop = 120
      assert.gt(content.scrollTop, 0, 'the inspector scrolls in this box')
      await tapCard('r')
      assert.eq(byId('inspTitle').value, 'One place for the numbers')
      assert.eq(content.scrollTop, 0, 'the second card starts at the top')
      // Opening again on the card already selected starts at the top too.
      setSheet('peek')
      content.scrollTop = 120
      await tapCard('r', { select: false })
      assert.eq(sheetState(), 'half')
      assert.eq(content.scrollTop, 0, 'the open resets the scroll')
      // Another tab keeps its own place: the reset is the Inspector's.
      ui.activeTab = 'prompt'
      content.scrollTop = 120
      const kept = content.scrollTop
      selectBlock('g')
      assert.eq(content.scrollTop, kept)
    } finally {
      ui.activeTab = 'inspector'
      if (prev === null) content.removeAttribute('style'); else content.setAttribute('style', prev)
    }
  })

  it('a tap that lands on a card\'s collapse button or doc badge leaves the sheet down', async () => {
    await phoneReset()
    block('a', { docRef: { label: 'Status notes guide', href: '', anchor: '' } })
    block('b', { x: 400 })
    // Touch adjustment: the press and release go to the card, the click to
    // the button under the finger.
    for (const sel of ['.block-collapse-btn', '.block-doc-badge']) {
      deselectAll(); setSheet('peek')
      const el = getBlockEl('a'), btn = el.querySelector(sel)
      assert.ok(btn, `${sel} is on the card`)
      pointer(el, 'pointerdown', 20, 20)
      selectBlock('a')
      pointer(el, 'pointerup', 20, 20)
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await tick(20)
      assert.eq(sheetState(), 'peek', sel)
      assert.eq(selection.blockId, 'a', `${sel}: the card is still selected`)
      document.querySelector('.doc-popup')?.remove()
    }
    // Control: the same tap whose click lands on the card itself opens it.
    const el = getBlockEl('b')
    pointer(el, 'pointerdown', 20, 20)
    selectBlock('b')
    pointer(el, 'pointerup', 20, 20)
    el.querySelector('.block-title').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await tick(20)
    assert.eq(sheetState(), 'half')
  })

  it('a full sheet a text field chose goes away on deselect; one the person pulled up stays', async () => {
    await phoneReset()
    block('a')
    const focusIn = el => el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await tapCard('a')
    focusIn(byId('inspTitle'))
    assert.eq(sheetState(), 'full')
    assert.ok(sheet.auto, 'the app chose full')
    deselectAll()
    assert.eq(sheetState(), 'peek', 'deselecting does not leave 85% of the screen saying Nothing selected')
    // Pulled up by the person after the field took it: theirs now.
    await tapCard('a')
    focusIn(byId('inspTitle'))
    handleEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    handleEl().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    assert.eq(sheetState(), 'full')
    assert.ok(!sheet.auto)
    deselectAll()
    assert.eq(sheetState(), 'full', 'a sheet the person put at full stays')
    // Add question chose full too.
    setSheet('peek')
    block('q', { questions: [{ text: 'Who reads the notes?' }] })
    focusQuestion('q', 0)
    assert.eq(sheetState(), 'full')
    deselectAll()
    assert.eq(sheetState(), 'peek')
  })

  it('the handle shows the Session timer only while it counts down', async () => {
    await phoneReset()
    setupTimer()
    const mirror = byId('sheetTimer'), display = byId('timerDisplay')
    const realInterval = window.setInterval, realTimeout = window.setTimeout
    let step = null, later = null
    // The countdown's own clock, run by hand.
    window.setInterval = fn => { step = fn; return 987654 }    // an id, as a real timer returns
    window.setTimeout = (fn, ms, ...rest) => ms === 3000 ? (later = fn, 0) : realTimeout(fn, ms, ...rest)
    try {
      byId('timerMinutes').value = '1'
      byId('timerMinutes').dispatchEvent(new Event('input', { bubbles: true }))
      byId('timerStartBtn').click()
      assert.ok(!mirror.hidden, 'running')
      step()
      assert.eq(mirror.textContent, '00:59')
      byId('timerPauseBtn').click()
      assert.ok(mirror.hidden, 'paused: a frozen time is not a countdown')
      byId('timerStartBtn').click()
      assert.ok(!mirror.hidden, 'resumed')
      for (let i = 0; i < 59; i++) step()
      assert.eq(display.textContent, '00:00')
      assert.ok(mirror.hidden, 'the end')
      assert.ok(later, 'the full time is put back after a moment')
      later()
      assert.eq(display.textContent, '01:00')
      assert.ok(mirror.hidden, 'the time put back is not running')
    } finally {
      window.setInterval = realInterval
      window.setTimeout = realTimeout
      byId('timerResetBtn').click()
    }
    assert.ok(mirror.hidden)
  })

  it('puts the harness back the way it found it', () => {
    reset()
    unmountSheet()
    assert.eq(byId('rightPanel'), null)
    assert.eq(sheet.force, null)
  })
})

// Another page that links style.css, at phone size: its own stylesheets and
// markup, no scripts.
async function pageFrame(file, width, height) {
  const doc = new DOMParser().parseFromString(await (await fetch('../' + file, { cache: 'no-store' })).text(), 'text/html')
  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href')).filter(h => h && !/^[a-z]+:/i.test(h))
  doc.querySelectorAll('script, img, iframe').forEach(n => n.remove())
  const frame = document.createElement('iframe')
  frame.style.cssText = `position:fixed;left:-6000px;top:0;width:${width}px;height:${height}px;border:0`
  frame.srcdoc = '<!DOCTYPE html><html><head>' + links.map(h => `<link rel="stylesheet" href="../${h}">`).join('') +
    `</head><body class="${doc.body.className}">${doc.body.innerHTML}</body></html>`
  const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
  document.body.appendChild(frame)
  await loaded
  return frame
}

describe('Inspector: phone sheet rules stay on the app page', () => {
  for (const file of ['trace.html', 'examples.html', 'tutorial.html']) {
    it(`${file} at 375x812: no reserved row and no page height meant for the sheet`, async () => {
      const f = await pageFrame(file, 375, 812)
      try {
        const d = f.contentDocument
        assert.ok(d.querySelector('link[href="../css/style.css"]'), 'the page links style.css')
        assert.eq(d.getElementById('rightPanel'), null)
        const after = f.contentWindow.getComputedStyle(d.body, '::after')
        assert.eq(after.content, 'none', 'no empty band under the footer')
        // An iframe has no browser toolbar, so 100dvh and 100vh measure the
        // same here: read the rule itself and check it does not reach the page.
        const dvh = []
        const walk = list => { for (const r of list) { if (r.cssRules) walk(r.cssRules); if (r.style?.height === '100dvh' && /^body\b/.test(r.selectorText || '')) dvh.push(r.selectorText) } }
        for (const sh of d.styleSheets) { try { walk(sh.cssRules) } catch (_) {} }
        assert.ok(dvh.length, 'the phone page-height rule is there to check')
        for (const sel of dvh) assert.ok(!d.body.matches(sel), `${sel} does not reach ${file}`)
      } finally { f.remove() }
    })
  }
})
