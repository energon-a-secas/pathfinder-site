// ============================================================
//  inline-edit.test.js -- editing a card's title and description
//  in place (js/inline-edit.js) and the keys that start it
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, getUndoHistory, getRedoFuture } from '../js/state.js'
import { $ } from '../js/utils.js'
import { renderBlock, undo, selectBlock, deselectAll } from '../js/render.js'
import { startInlineEdit, isInlineEditing, commitInlineEdit, editorText } from '../js/inline-edit.js'
import { createBlockAt } from '../js/create.js'
import { setupKeyboardShortcuts } from '../js/events.js'

function reset() {
  if (isInlineEditing()) commitInlineEdit()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  deselectAll()
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: 'Old title', description: 'Old description', notes: '',
    x: 40, y: 40, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, ...extra }
  renderBlock(id)
}

// The test page hides the canvas; focus and selection need it on screen.
function visible(fn) {
  const vp = $.canvasViewport()
  const prev = vp.style.display
  vp.style.display = 'block'
  try { return fn() } finally {
    if (isInlineEditing()) commitInlineEdit()
    vp.style.display = prev
  }
}

const titleEl = id => document.querySelector(`#b-${id} .block-title`)
const descEl  = id => document.querySelector(`#b-${id} .block-desc`)
const key = (el, k, extra = {}) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))

describe('startInlineEdit() -- title', () => {
  it('makes the title editable with its text selected', () => visible(() => {
    reset(); block('a')
    assert.ok(startInlineEdit('a', 'title'))
    assert.ok(isInlineEditing())
    const el = titleEl('a')
    assert.eq(el.contentEditable, 'true')
    assert.eq(document.activeElement, el)
    assert.eq(window.getSelection().toString(), 'Old title')
  }))

  it('Enter commits the new title, and one undo restores it', () => visible(() => {
    reset(); block('a')
    startInlineEdit('a', 'title')
    const el = titleEl('a')
    el.textContent = 'New title'
    key(el, 'Enter')
    assert.ok(!isInlineEditing())
    assert.eq(state.blocks.a.title, 'New title')
    assert.neq(titleEl('a').contentEditable, 'true')
    assert.eq(getUndoHistory().length, 1)
    undo()
    assert.eq(state.blocks.a.title, 'Old title')
  }))

  it('Escape commits rather than discarding', () => visible(() => {
    reset(); block('a')
    startInlineEdit('a', 'title')
    titleEl('a').textContent = 'Kept on Escape'
    key(titleEl('a'), 'Escape')
    assert.ok(!isInlineEditing())
    assert.eq(state.blocks.a.title, 'Kept on Escape')
  }))

  it('blur commits', () => visible(() => {
    reset(); block('a')
    startInlineEdit('a', 'title')
    titleEl('a').textContent = 'Blurred'
    // A headless page without system focus fires no real blur; send one.
    titleEl('a').dispatchEvent(new FocusEvent('blur'))
    assert.ok(!isInlineEditing())
    assert.eq(state.blocks.a.title, 'Blurred')
  }))

  it('Tab commits the title and moves on to the description', () => visible(() => {
    reset(); block('a')
    startInlineEdit('a', 'title')
    titleEl('a').textContent = 'Tabbed'
    key(titleEl('a'), 'Tab')
    assert.eq(state.blocks.a.title, 'Tabbed')
    assert.ok(isInlineEditing())
    assert.eq(descEl('a').contentEditable, 'true')
    assert.eq(document.activeElement, descEl('a'))
  }))

  it('Tab in the title of a collapsed card finishes on the card instead of trapping focus', () => visible(() => {
    reset(); block('a', { collapsed: true })
    startInlineEdit('a', 'title')
    titleEl('a').textContent = 'Folded'
    key(titleEl('a'), 'Tab')
    assert.eq(state.blocks.a.title, 'Folded')
    assert.ok(!isInlineEditing(), 'editing ended')
    assert.eq(document.activeElement, document.getElementById('b-a'), 'focus is on the card')
  }))

  // Reading the field normalises it (collapsed spaces, joined lines, trimmed
  // ends). Comparing that with the stored text made a no-op open and close
  // rewrite the block and push an undo step.
  it('opening and closing the editor without typing rewrites nothing', () => visible(() => {
    const cases = [
      ['title', 'Two  spaces'], ['title', 'Line\nbreak title'], ['title', ' padded '],
      ['description', 'trailing space '], ['description', 'x\n\n\n\ny'],
      ['description', 'ends with newline\n'], ['description', 'a\r\nb'], ['description', 'nbsp\u00a0here'],
    ]
    for (const [field, text] of cases) {
      reset(); block('a', { [field]: text })
      startInlineEdit('a', field)
      key(field === 'title' ? titleEl('a') : descEl('a'), 'Escape')
      assert.eq(state.blocks.a[field], text, `${field} ${JSON.stringify(text)} kept`)
      assert.eq(getUndoHistory().length, 0, `${field} ${JSON.stringify(text)}: no undo step`)
    }
  }))

  it('takes no snapshot when nothing changed', () => visible(() => {
    reset(); block('a')
    startInlineEdit('a', 'title')
    key(titleEl('a'), 'Enter')
    assert.eq(getUndoHistory().length, 0)
    assert.eq(state.blocks.a.title, 'Old title')
  }))

  it('keys typed while editing never reach the canvas shortcuts', () => visible(() => {
    reset(); block('a')
    let leaked = 0
    const spy = () => leaked++
    document.addEventListener('keydown', spy)
    startInlineEdit('a', 'title')
    key(titleEl('a'), 'Backspace')
    key(titleEl('a'), ' ')
    document.removeEventListener('keydown', spy)
    assert.eq(leaked, 0)
    assert.ok(state.blocks.a, 'the block survived Backspace')
  }))

  it('an empty title edits as empty text, not the Untitled placeholder', () => visible(() => {
    reset(); block('a', { title: '' })
    startInlineEdit('a', 'title')
    assert.eq(titleEl('a').textContent, '')
    key(titleEl('a'), 'Enter')
    assert.eq(state.blocks.a.title, '')
    assert.eq(getUndoHistory().length, 0)
  }))
})

describe('startInlineEdit() -- description and paste', () => {
  it('Cmd/Ctrl+Enter commits the description; plain Enter does not', () => visible(() => {
    reset(); block('a')
    startInlineEdit('a', 'description')
    const el = descEl('a')
    el.textContent = 'Line one'
    key(el, 'Enter')
    assert.ok(isInlineEditing(), 'Enter is a newline in the description')
    key(el, 'Enter', { ctrlKey: true })
    assert.ok(!isInlineEditing())
    assert.eq(state.blocks.a.description, 'Line one')
  }))

  it('Shift+Tab moves from the description back to the title', () => visible(() => {
    reset(); block('a')
    startInlineEdit('a', 'description')
    key(descEl('a'), 'Tab', { shiftKey: true })
    assert.ok(isInlineEditing())
    assert.eq(document.activeElement, titleEl('a'))
  }))

  it('an empty description can be edited on the card', () => visible(() => {
    reset(); block('a', { description: '' })
    assert.ok(startInlineEdit('a', 'description'))
    assert.eq(document.activeElement, descEl('a'))
    descEl('a').textContent = 'Now it has one'
    key(descEl('a'), 'Escape')
    assert.eq(state.blocks.a.description, 'Now it has one')
  }))

  it('paste inserts plain text only, on one line in a title', () => visible(() => {
    reset(); block('a')
    startInlineEdit('a', 'title')
    const dt = new DataTransfer()
    dt.setData('text/plain', 'Pasted one\nPasted two')
    dt.setData('text/html', '<b>Pasted</b> <i>rich</i>')
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    titleEl('a').dispatchEvent(ev)
    assert.ok(ev.defaultPrevented, 'the browser paste was replaced')
    assert.eq(titleEl('a').querySelector('b, i'), null, 'no markup came in')
    key(titleEl('a'), 'Enter')
    assert.eq(state.blocks.a.title, 'Pasted one Pasted two')
  }))
})

describe('startInlineEdit() -- refusals', () => {
  it('refuses in read-only views', () => visible(() => {
    reset(); block('a')
    ui.readOnly = true
    try {
      assert.eq(startInlineEdit('a', 'title'), false)
      assert.ok(!isInlineEditing())
      assert.notIncludes(titleEl('a').contentEditable, 'true')
    } finally { ui.readOnly = false }
  }))

  it('refuses a missing block', () => {
    reset()
    assert.eq(startInlineEdit('nope', 'title'), false)
  })
})

describe('Creation opens title editing', () => {
  it('createBlockAt starts editing the new title with the text selected', () => visible(() => {
    reset()
    const id = createBlockAt('goal', 200, 200)
    assert.ok(isInlineEditing())
    assert.eq(document.activeElement, titleEl(id))
    assert.match(window.getSelection().toString(), /^Untitled \d+$/)
  }))
})

describe('Keyboard: Enter, F2 and Shift+Enter on the selected card', () => {
  const press = (k, extra = {}) =>
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))

  it('Enter and F2 edit the title, Shift+Enter the description', () => visible(() => {
    setupKeyboardShortcuts()
    reset(); block('a')
    selectBlock('a')
    document.activeElement?.blur?.()
    press('Enter')
    assert.ok(isInlineEditing())
    assert.eq(document.activeElement, titleEl('a'))
    key(titleEl('a'), 'Escape')

    document.activeElement?.blur?.()
    press('F2')
    assert.eq(document.activeElement, titleEl('a'))
    key(titleEl('a'), 'Escape')

    document.activeElement?.blur?.()
    press('Enter', { shiftKey: true })
    assert.eq(document.activeElement, descEl('a'))
  }))

  it('does nothing in read-only or with nothing selected', () => visible(() => {
    setupKeyboardShortcuts()
    reset(); block('a')
    press('Enter')
    assert.ok(!isInlineEditing(), 'nothing selected')
    selectBlock('a')
    document.activeElement?.blur?.()
    ui.readOnly = true
    try {
      press('F2')
      assert.ok(!isInlineEditing(), 'read-only')
    } finally { ui.readOnly = false }
  }))
})

// ── QA round ────────────────────────────────────────────────
describe('Description editing keeps what the editor shows (QA)', () => {
  const press = (k, extra = {}) =>
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }))

  it('Shift+Enter opens the description with the caret at the end, not everything selected', () => visible(() => {
    setupKeyboardShortcuts()
    reset(); block('a', { description: '(Check if still used)' })
    selectBlock('a')
    document.activeElement?.blur?.()
    press('Enter', { shiftKey: true })
    assert.eq(document.activeElement, descEl('a'))
    const sel = window.getSelection()
    assert.ok(sel.isCollapsed, 'nothing is selected, so the next Enter adds a line')
    assert.eq(sel.toString(), '')
  }))

  it('a <br> followed by a block line reads as one line break, as the editor shows it', () => {
    const el = document.createElement('div')
    const read = html => { el.innerHTML = html; return editorText(el).trimEnd() }
    assert.eq(read('<br><div>after</div>'), '\nafter')
    assert.eq(read('one<div>two</div><div><br></div><div>four</div>'), 'one\ntwo\n\nfour')
    assert.eq(read('one<br>two<br><br>four'), 'one\ntwo\n\nfour')
    assert.eq(read('<div>a<br></div><div>b</div>'), 'a\nb', 'a trailing <br> in a line is not a line of its own')
  })

  it('Enter over a selected description and typing stores one break, not two', () => visible(() => {
    reset(); block('a', { description: 'old' })
    startInlineEdit('a', 'description', { selectAll: false })
    // What Chrome leaves after Enter replaced the whole selection and a word was typed.
    descEl('a').innerHTML = '<br><div>after</div>'
    key(descEl('a'), 'Escape')
    assert.eq(state.blocks.a.description, '\nafter'.trimEnd())
  }))
})
