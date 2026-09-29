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
import { renderBlock, selectBlock, setSelection, selectArrow, deselectAll, undo, mutateBlock } from '../js/render.js'
import { renderArrows, applyTransform } from '../js/canvas.js'
import { runGapDetection } from '../js/gaps.js'
import { setupInspectorEvents, typeMenuItems, typeCount } from '../js/inspector.js'
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
