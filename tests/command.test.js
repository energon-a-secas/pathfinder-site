// ============================================================
//  command.test.js: the COMMAND stream (design round, wave 2).
//  The command palette (js/command-palette.js, command-items.js),
//  N-then-a-letter (js/type-keys.js), Connect to (context-menu.js
//  and menu.js search), templates as buttons and the regrouped
//  shortcut sheet (ui-panels.js).
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui, selection, getUndoHistory, getRedoFuture, resetSnapshotToken } from '../js/state.js'
import { $, TYPES } from '../js/utils.js'
import { renderBlock, undo, deselectAll, selectBlock, setSelection } from '../js/render.js'
import { isInlineEditing, commitInlineEdit } from '../js/inline-edit.js'
import { setupKeyboardShortcuts } from '../js/events.js'
import { openMenu, closeMenus, isMenuOpen } from '../js/menu.js'
import { connectToItems, connectRank, selectionMenuItems } from '../js/context-menu.js'
import { viewMenuItems, helpMenuItems, fileMenuItems } from '../js/view-menu.js'
import { SHORTCUTS, TYPE_KEYS, topShortcuts, buildShortcutGrid, setupTemplates, templateName } from '../js/ui-panels.js'
import { TEMPLATES, listUserTemplates, saveCurrentAsTemplate, deleteUserTemplate } from '../js/templates.js'
import { setupCommandPalette, openCommandPalette, closeCommandPalette, isCommandPaletteOpen,
         commandPaletteMenuItem } from '../js/command-palette.js'
import { matchScore, commandGroups, menuRows, IS_MAC } from '../js/command-items.js'
import { mapsMenuItems } from '../js/library.js'
import { rowEl, markedLabel } from '../js/command-rows.js'
import { typeForKey, isTypeKeyArmed, disarmTypeKeys } from '../js/type-keys.js'

// ── Helpers ─────────────────────────────────────────────────
function inspectorStubs() {
  if (document.getElementById('multiCount')) return
  const span = document.createElement('span')
  span.id = 'multiCount'
  ;(document.getElementById('inspectorMulti') || document.body).appendChild(span)
}

function reset() {
  inspectorStubs()
  closeCommandPalette({ restoreFocus: false })
  disarmTypeKeys()
  closeMenus()
  if (isInlineEditing()) commitInlineEdit()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'goal', title: id, description: '', notes: '',
    x: 40, y: 40, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, highlight: null, ...extra }
  renderBlock(id)
}

const key = (k, extra = {}, target = document.activeElement || document.body) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })
  target.dispatchEvent(ev)
  return ev
}

// The keys are wired for one test at a time and unwired after, so the test
// files that run later get the keyboard they expect.
async function withKeys(fn) {
  const off = setupCommandPalette()
  try { return await fn() } finally { off(); reset() }
}

// The palette's chord: Cmd+K on a Mac, Ctrl+K elsewhere (the runner is
// whichever machine it runs on).
const MOD_K = IS_MAC ? { metaKey: true } : { ctrlKey: true }
const OTHER_K = IS_MAC ? { ctrlKey: true } : { metaKey: true }

const field = () => document.getElementById('cmdkInput')
const dialog = () => document.getElementById('commandPalette')
function type(text) {
  const input = field()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const press = (k, extra = {}) => key(k, extra, field())
const rowEls = () => [...document.querySelectorAll('#cmdkList .cmdk-row')]
const rowLabels = () => rowEls().map(r => r.querySelector('.cmdk-label').textContent)
const headings = () => [...document.querySelectorAll('#cmdkList .cmdk-heading')].map(h => h.textContent)
const activeRow = () => {
  const id = field().getAttribute('aria-activedescendant')
  return id ? document.getElementById(id) : null
}
const activeLabel = () => activeRow()?.querySelector('.cmdk-label').textContent ?? null
const chip = () => { const c = document.getElementById('cmdkScope'); return c.hidden ? '' : c.textContent }
const findable = label => { type(label); return rowLabels().includes(label) }
// The rows under one heading, as rendered.
const rowsUnder = heading => {
  const h = [...document.querySelectorAll('#cmdkList .cmdk-heading')].find(x => x.textContent === heading)
  return h ? [...h.parentElement.querySelectorAll('.cmdk-row .cmdk-label')].map(l => l.textContent) : []
}

// The real stylesheet, for checks that need it: the runner does not load
// style.css, so a check renders into a shadow root that does (:root becomes
// :host so the tokens apply there).
let styleText = null
async function styledHost(html = '') {
  styleText ??= (await (await fetch('../css/style.css', { cache: 'no-store' })).text()).replace(/:root\b/g, ':host')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>${styleText}</style>${html}`
  return { shadow, done: () => host.remove() }
}

// Run `fn` with the live palette (its dialog, field and list, so the real
// handlers run) inside a styled shadow root, then put it back.
async function withStyledPalette(fn) {
  openCommandPalette(); closeCommandPalette({ restoreFocus: false })   // built once
  const dlg = dialog()
  const { shadow, done } = await styledHost()
  shadow.appendChild(dlg)
  try { return await fn(shadow, dlg) } finally {
    closeCommandPalette({ restoreFocus: false })
    document.body.appendChild(dlg)
    done()
  }
}

// ── Matching ────────────────────────────────────────────────
describe('command: matching titles and names', () => {
  it('ranks the start of the text, then a word start, then anywhere, then every word, then a fuzzy run', () => {
    const s = t => matchScore('risk', t)?.score ?? -1
    assert.gt(s('Risk register'), s('Open risk'), 'the start beats a word start')
    assert.gt(s('Open risk'), s('Brisket'), 'a word start beats the middle of a word')
    assert.gt(s('Brisket'), 0)
    assert.gt(matchScore('new risk', 'New block: risk')?.score ?? -1, 999, 'every word, any order')
    assert.ok(matchScore('ct', 'Change type'), 'word starts: "ct" finds Change type')
    assert.ok(matchScore('rsk', 'Risk'), 'a run with one letter skipped')
    assert.eq(matchScore('aeo', 'Remove local password hashes'), null, 'scattered letters do not count')
    assert.eq(matchScore('zzz', 'Risk'), null)
  })

  it('folds accents and case, and reports the matched letters of the original text', () => {
    const m = matchScore('decision', 'Decisión técnica')
    assert.ok(m, 'an accented title matches its plain spelling')
    assert.deepEq(m.hits, [0, 1, 2, 3, 4, 5, 6, 7])
    const e = matchScore('tecn', 'Decisión técnica')
    assert.deepEq(e.hits, [9, 10, 11, 12], 'indices land on the original characters')
  })
})

// ── Opening, closing, focus ─────────────────────────────────
describe('command: the palette opens, closes and gives focus back', () => {
  it('Cmd/Ctrl+K opens a modal combobox over a listbox; again closes it; focus returns', async () => {
    reset()
    await withKeys(() => {
      const btn = document.createElement('button')
      btn.textContent = 'Somewhere'
      document.body.appendChild(btn)
      try {
        btn.focus()
        const ev = key('k', MOD_K)
        assert.ok(ev.defaultPrevented, 'the browser shortcut is taken')
        assert.ok(isCommandPaletteOpen())
        assert.ok(dialog().matches(':modal'), 'a real modal dialog: the page behind is inert')
        assert.eq(document.activeElement, field(), 'the field has focus')
        assert.eq(field().getAttribute('role'), 'combobox')
        assert.eq(field().getAttribute('aria-controls'), 'cmdkList')
        assert.eq(document.getElementById('cmdkList').getAttribute('role'), 'listbox')
        assert.ok(rowEls().every(r => r.getAttribute('role') === 'option'))
        assert.ok(activeRow(), 'the first row is active')
        key('k', MOD_K, field())
        assert.ok(!isCommandPaletteOpen(), 'the same key closes it')
        assert.eq(document.activeElement, btn, 'focus is back where it was')
        btn.focus(); key('k', MOD_K)
        press('Escape')
        assert.ok(!isCommandPaletteOpen(), 'Escape closes it')
        assert.eq(document.activeElement, btn)
      } finally { btn.remove() }
    })
  })

  it('opens while typing in a field too, but never over another modal dialog', async () => {
    reset()
    await withKeys(() => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      const other = document.createElement('dialog')
      document.body.appendChild(other)
      try {
        input.focus()
        key('k', MOD_K, input)
        assert.ok(isCommandPaletteOpen(), 'from a text field')
        closeCommandPalette()
        assert.eq(document.activeElement, input)
        other.showModal()
        key('k', MOD_K)
        assert.ok(!isCommandPaletteOpen(), 'the other dialog keeps the keyboard')
      } finally { other.close(); other.remove(); input.remove() }
    })
  })

  it('a key the palette handles never reaches the canvas: Escape keeps the selection, Enter opens no title', async () => {
    reset()
    setupKeyboardShortcuts()   // the canvas keys, as in the app (wired once)
    block('a', { title: 'Alpha', x: 0, y: 0 }); block('b', { title: 'Beta', x: 400, y: 0 })
    await withKeys(() => {
      selectBlock('a')
      openCommandPalette()
      press('Escape')
      assert.ok(!isCommandPaletteOpen())
      assert.eq(selection.blockId, 'a', 'closing the palette is not a deselect')
      openCommandPalette()
      type('beta'); press('Enter')
      assert.eq(selection.blockId, 'b')
      assert.ok(!isInlineEditing(), 'the Enter that jumped did not also open the title')
    })
  })

  it('with nothing typed, rows that cannot run yet wait until searched for', async () => {
    reset()
    await withKeys(() => {
      openCommandPalette()
      assert.ok(!rowLabels().includes('Undo'), 'Undo with nothing to undo is not listed')
      assert.ok(rowEls().every(r => r.getAttribute('aria-disabled') !== 'true'))
      type('undo')
      assert.ok(rowLabels().includes('Undo'), 'but it is found, dimmed, when searched')
    })
  })

  it('a list of values opens on the current one', async () => {
    reset()
    block('a', { type: 'decision', status: 'in-progress' })
    selectBlock('a')
    await withKeys(() => {
      openCommandPalette()
      type('change type'); press('Enter')
      assert.eq(activeLabel(), TYPES.decision.label, 'Change type opens on Decision')
      // Laid out (the runner hides nothing in the dialog): the current row is scrolled into view.
      const list = document.getElementById('cmdkList')
      const r = activeRow().getBoundingClientRect(), box = list.getBoundingClientRect()
      assert.ok(r.top >= box.top - 1 && r.bottom <= box.bottom + 1, 'and it is in view')
      press('Escape')
      type('status'); press('Enter')
      assert.eq(activeRow()?.querySelector('.cmdk-state') ? true : false, true, 'Status opens on the current status')
    })
  })

  it('Up and Down move the active row and skip disabled rows; a click runs a row', async () => {
    reset()
    block('a', { x: 0, y: 0 }); block('b', { x: 400, y: 0 })
    await withKeys(() => {
      openCommandPalette()
      type('undo')
      const undoRow = rowEls().find(r => r.querySelector('.cmdk-label').textContent === 'Undo')
      assert.eq(undoRow?.getAttribute('aria-disabled'), 'true', 'nothing to undo yet: shown, dimmed')
      assert.neq(activeRow(), undoRow, 'and never the active row')
      type('zoom')
      const first = activeLabel()
      press('ArrowDown')
      assert.neq(activeLabel(), first, 'Down moves')
      press('ArrowUp')
      assert.eq(activeLabel(), first, 'Up moves back')
      type('select all blocks')
      const row = rowEls().find(r => r.querySelector('.cmdk-label').textContent === 'Select all blocks')
      row.click()
      assert.ok(!isCommandPaletteOpen(), 'running a row closes the palette')
      assert.eq(selection.ids.size, 2, 'and it ran')
    })
  })
})

// ── What it can reach ───────────────────────────────────────
describe('command: every menu action is reachable by name', () => {
  it('every File, View and Help row, and every action on the selected block', async () => {
    reset()
    block('a', { type: 'goal', x: 0, y: 0 }); block('b', { type: 'metric', x: 400, y: 0 })
    // A File menu like index.html's: rows read from hidden buttons.
    const src = document.createElement('div')
    src.id = 'fileActions'; src.hidden = true
    src.innerHTML = '<button type="button" id="cxImport" data-file-group="import">Import a map</button>' +
      '<button type="button" id="cxJson" data-file-group="data">Download JSON</button>' +
      '<button type="button" id="cxMd" data-file-group="data" data-readonly="ok">Download Markdown</button>'
    document.body.appendChild(src)
    let clicked = 0
    src.querySelector('#cxJson').addEventListener('click', () => clicked++)
    try {
      selectBlock('a')
      await withKeys(() => {
        openCommandPalette()
        const rowsOf = list => list.filter(i => i && !i.type)
        const want = [
          ...rowsOf(fileMenuItems()), ...rowsOf(viewMenuItems()),
          // Help's own row for the palette is the one row it does not list.
          ...rowsOf(helpMenuItems()).filter(i => i.rowId !== 'command-palette'),
          ...rowsOf(selectionMenuItems().items),
        ]
        assert.gt(want.length, 25)
        for (const item of want) assert.ok(findable(item.label), `${JSON.stringify(item)} is in the palette`)
        type('download json')
        press('Enter')
        assert.eq(clicked, 1, 'a File row runs its menu twin')
      })
    } finally { src.remove() }
  })

  it('rows show their shortcuts', async () => {
    reset()
    block('a')
    selectBlock('a')
    await withKeys(() => {
      openCommandPalette()
      type('edit title')
      assert.includes(activeRow().querySelector('.cmdk-keys')?.textContent || '', 'Enter')
      type('fit all blocks')
      assert.eq(activeRow().querySelector('.cmdk-keys')?.textContent, 'Shift+1')
      type('new risk at centre')
      assert.deepEq([...activeRow().querySelectorAll('.cmdk-kbd')].map(k => k.textContent), ['N', 'K'], 'a chord shows as two keys')
    })
  })

  // Review (design round): the row existed but no menu listed it, so on a
  // phone or with a mouse there was no way in.
  it('the Help menu opens the palette, and the palette does not list itself', async () => {
    reset()
    await withKeys(() => {
      const row = helpMenuItems().find(i => i && i.label === 'Command palette')
      assert.ok(row, 'Help lists Command palette')
      assert.match(row.shortcut, /K$/, 'with its key')
      assert.eq(helpMenuItems()[0].label, 'Command palette', 'first in Help')
      row.action()
      assert.ok(isCommandPaletteOpen(), 'picking it opens the palette')
      type('command palette')
      assert.ok(!rowLabels().includes('Command palette'), 'no row that reopens itself')
      type('keyboard shortcuts')
      assert.ok(rowLabels().includes('Keyboard shortcuts'), 'the rest of Help is there')
    })
    assert.eq(commandPaletteMenuItem().label, 'Command palette')
  })

  it('matches titles and names only, never a hint, a description or a type', async () => {
    reset()
    block('a', { type: 'requirement', title: 'Login works', description: 'risk of lockout' })
    block('b', { type: 'goal', title: 'Requirement doc', x: 400 })
    await withKeys(() => {
      openCommandPalette({ scope: 'blocks' })
      assert.eq(chip(), 'Blocks')
      type('requirement')
      assert.deepEq(rowLabels(), ['Requirement doc'], 'the title, not the other block’s type')
      type('lockout')
      assert.deepEq(rowLabels(), [], 'not the description')
      assert.ok(document.querySelector('#cmdkList .cmdk-empty'), 'an empty list says so')
    })
  })
})

// ── Running ─────────────────────────────────────────────────
describe('command: running rows', () => {
  it('a block row selects that block and zooms to it', async () => {
    reset()
    block('a', { title: 'Checkout fails', x: 0, y: 0 }); block('b', { title: 'Pay later', x: 900, y: 600 })
    await withKeys(() => {
      openCommandPalette()
      type('pay later')
      assert.eq(activeLabel(), 'Pay later')
      press('Enter')
      assert.eq(selection.blockId, 'b')
      assert.eq(getUndoHistory().length, 0, 'jumping is not an edit')
    })
  })

  it('New <type> at centre adds it in title editing, one undo step', async () => {
    reset()
    await withKeys(() => {
      openCommandPalette()
      type('new risk')
      assert.eq(activeLabel(), 'New risk at centre')
      press('Enter')
      const made = Object.values(state.blocks)
      assert.eq(made.length, 1)
      assert.eq(made[0].type, 'risk')
      assert.ok(isInlineEditing(), 'the title is open for typing')
      commitInlineEdit()
      assert.eq(getUndoHistory().length, 1)
      undo()
      assert.eq(Object.keys(state.blocks).length, 0)
    })
  })

  it('New <type> connected to the selection points the way its verb reads', async () => {
    reset()
    block('g', { type: 'goal', title: 'Faster checkout' })
    selectBlock('g')
    await withKeys(() => {
      openCommandPalette()
      type('new metric connected')
      assert.eq(activeLabel(), 'New metric connected to Faster checkout')
      press('Enter')
      if (isInlineEditing()) commitInlineEdit()
      const m = Object.values(state.blocks).find(b => b.type === 'metric')
      assert.ok(m)
      assert.eq(state.arrows.length, 1)
      assert.eq(state.arrows[0].from, m.id, 'metric -> goal ("measures")')
      assert.eq(getUndoHistory().length, 1)
    })
  })

  it('a row with more behind it opens in place; Backspace and Escape go back up; the pick is one undo step', async () => {
    reset()
    block('a', { type: 'goal' })
    selectBlock('a')
    await withKeys(() => {
      openCommandPalette()
      type('change type')
      assert.eq(activeLabel(), 'Change type')
      assert.ok(activeRow().querySelector('.cmdk-caret'), 'it shows there is more')
      press('Enter')
      assert.ok(isCommandPaletteOpen())
      assert.eq(chip(), 'Change type')
      assert.ok(headings().includes('Why') && headings().includes('Doubt'), 'the type list keeps its steps')
      press('Backspace')
      assert.eq(chip(), '', 'Backspace on an empty field goes back up')
      type('change type'); press('Enter')
      press('Escape')
      assert.ok(isCommandPaletteOpen(), 'Escape goes back up a level first')
      assert.eq(chip(), '')
      type('change type'); press('Enter')
      type('risk')
      assert.eq(activeLabel(), 'Risk')
      press('Enter')
      assert.ok(!isCommandPaletteOpen())
      assert.eq(state.blocks.a.type, 'risk')
      assert.eq(getUndoHistory().length, 1)
    })
  })

  it('"to risk" retypes the selection in one step, and the type rows wait for a search', async () => {
    reset()
    block('a', { type: 'goal', x: 0, y: 0 }); block('b', { type: 'goal', x: 400, y: 0 })
    setSelection(['a', 'b'])
    await withKeys(() => {
      openCommandPalette()
      assert.ok(!rowLabels().some(l => l.startsWith('Change type to')), 'not in the unfiltered list')
      type('to risk')
      assert.eq(activeLabel(), 'Change type to risk')
      press('Enter')
      assert.deepEq([state.blocks.a.type, state.blocks.b.type], ['risk', 'risk'])
      assert.eq(getUndoHistory().length, 1, 'both blocks, one undo step')
      openCommandPalette()
      type('change type to')
      assert.ok(!rowLabels().includes('Change type to risk'), 'no row for the type they already have')
    })
  })

  it('Recent lists what was run last, first, under what the selection offers', async () => {
    reset()
    block('a'); block('b', { x: 400 })
    await withKeys(() => {
      openCommandPalette()
      type('select all blocks'); press('Enter')
      openCommandPalette()
      assert.match(headings()[0], /^Selected/, 'the selection now has two blocks: its actions lead')
      assert.eq(headings()[1], 'Recent')
      assert.eq(rowsUnder('Recent')[0], 'Select all blocks')
      closeCommandPalette()
      deselectAll()
      openCommandPalette()
      assert.eq(headings()[0], 'Recent', 'with nothing selected, Recent leads')
      assert.eq(activeLabel(), 'Select all blocks')
    })
  })

  // Review (design round): after a template, Cmd+K then Enter applied it a
  // second time (13 blocks became 26), and after Delete, the next palette
  // opened with Delete as the row Enter runs.
  it('Recent never holds a delete, a template or a row that waits for a search', async () => {
    reset()
    setupTemplates()
    const tpl = TEMPLATES.find(t => !t.large)
    await withKeys(() => {
      // Something harmless first, so Recent has a row to lead with.
      openCommandPalette()
      type('zoom to 100%'); press('Enter')
      openCommandPalette()
      type(tpl.name); press('Enter')
      const n = Object.keys(state.blocks).length
      assert.eq(n, tpl.blocks.length)
      deselectAll()
      openCommandPalette()
      assert.ok(!rowsUnder('Recent').includes(tpl.name), 'the template is not in Recent')
      assert.eq(activeLabel(), 'Zoom to 100%', 'Enter runs the harmless row')
      press('Enter')
      assert.eq(Object.keys(state.blocks).length, n, 'Enter on a fresh palette did not apply the template again')

      const [first, second, third] = Object.keys(state.blocks)
      state.blocks[second].type = 'goal'; state.blocks[third].type = 'goal'
      selectBlock(first)
      openCommandPalette()
      type('delete'); press('Enter')
      assert.ok(!state.blocks[first], 'deleted from the palette')
      selectBlock(second)
      openCommandPalette()
      assert.ok(!rowsUnder('Recent').includes('Delete'), 'Delete is not in Recent')
      assert.ok(!rowEls().some(r => r.classList.contains('cmdk-danger') && r.classList.contains('is-active')),
        'no destructive row is the one Enter runs')
      type('to risk'); press('Enter')
      assert.eq(state.blocks[second].type, 'risk')
      selectBlock(third)
      openCommandPalette()
      assert.ok(!rowLabels().some(l => l.startsWith('Change type to')), 'a search-only row stays out of Recent')
      type('to risk')
      assert.ok(rowLabels().includes('Change type to risk'), 'and is still a search away')
    })
  })

  it('a Recent list stored by an older build cannot bring a delete or a template back', async () => {
    reset()
    block('a')
    selectBlock('a')
    const prev = localStorage.getItem('pathfinder-palette-recent')
    localStorage.setItem('pathfinder-palette-recent', JSON.stringify(['sel:delete', 'tpl:' + TEMPLATES[0].name, 'retype:risk', 'cmd:find']))
    try {
      await withKeys(() => {
        openCommandPalette()
        assert.deepEq(rowsUnder('Recent'), ['Find blocks'])
        assert.neq(activeLabel(), 'Delete')
        assert.ok(!rowEls().some(r => r.classList.contains('cmdk-danger') && r.classList.contains('is-active')))
      })
    } finally {
      if (prev === null) localStorage.removeItem('pathfinder-palette-recent')
      else localStorage.setItem('pathfinder-palette-recent', prev)
    }
  })

  it('every template is in the palette, and running one applies it as one undo step', async () => {
    reset()
    setupTemplates()
    const i = TEMPLATES.findIndex(t => !t.large)
    await withKeys(() => {
      openCommandPalette()
      for (const t of TEMPLATES) assert.ok(findable(t.name), `${t.name}`)
      type(TEMPLATES[i].name)
      press('Enter')
      assert.eq(Object.keys(state.blocks).length, TEMPLATES[i].blocks.length)
      assert.eq(getUndoHistory().length, 1)
    })
  })
})

// ── Scopes and modes ────────────────────────────────────────
describe('command: Create mode and scopes', () => {
  it('/ on the canvas opens straight at Create; Backspace widens to everything', async () => {
    reset()
    block('a')
    selectBlock('a')
    await withKeys(() => {
      const ev = key('/')
      assert.ok(ev.defaultPrevented)
      assert.ok(isCommandPaletteOpen())
      assert.eq(chip(), 'Create')
      assert.ok(rowLabels().every(l => l.startsWith('New ')), 'only rows that add a block')
      assert.eq(rowLabels().filter(l => l.endsWith(' at centre')).length, Object.keys(TYPES).length, 'every type')
      press('Backspace')
      assert.eq(chip(), '')
      assert.ok(headings().includes('Actions'))
    })
  })

  it('typed first, > # and @ narrow the list; elsewhere they are just characters', async () => {
    reset()
    block('a', { title: 'Alpha' })
    await withKeys(() => {
      openCommandPalette()
      type('>')
      assert.eq(chip(), 'Actions')
      assert.eq(field().value, '', 'the character becomes the chip')
      press('Backspace')
      type('#al')
      assert.eq(chip(), 'Blocks')
      assert.deepEq(rowLabels(), ['Alpha'])
    })
  })
})

describe('command: a view-only link', () => {
  it('gets view actions and block jumps, nothing that edits or creates', async () => {
    reset()
    block('a')
    ui.readOnly = true
    await withKeys(() => {
      assert.ok(!key('/').defaultPrevented, '/ does nothing there')
      assert.ok(!isCommandPaletteOpen())
      key('k', MOD_K)
      assert.ok(isCommandPaletteOpen(), 'the palette itself works')
      const groups = commandGroups().map(g => g.key)
      assert.ok(!groups.includes('create') && !groups.includes('templates') && !groups.includes('maps'), groups.join(','))
      assert.ok(findable('Light theme'), 'view actions')
      assert.ok(findable('Find blocks'))
      assert.ok(!findable('Undo'), 'no editing')
      type('#a')
      assert.deepEq(rowLabels(), ['a'], 'jumping to blocks')
    })
  })
})

// ── N, then a letter ────────────────────────────────────────
describe('command: N then a letter adds a block of that type', () => {
  it('one letter per type, none shared, every type covered', () => {
    const ids = Object.keys(TYPES)
    assert.deepEq(Object.keys(TYPE_KEYS).sort(), ids.slice().sort(), 'every type has a letter')
    const letters = Object.values(TYPE_KEYS)
    assert.eq(new Set(letters).size, letters.length, 'no letter is shared')
    assert.ok(letters.every(l => /^[a-z]$/.test(l)))
    assert.ok(!letters.includes('n'), 'N itself is not a type')
    ids.forEach(t => assert.eq(typeForKey(TYPE_KEYS[t]), t))
    assert.eq(TYPE_KEYS.risk, 'k'); assert.eq(TYPE_KEYS.goal, 'g'); assert.eq(TYPE_KEYS.question, 'q')
  })

  it('N then K adds a risk and opens its title, one undo step, and the hint lists every letter', async () => {
    reset()
    await withKeys(() => {
      key('n')
      assert.ok(isTypeKeyArmed())
      const hint = $.canvasViewport().querySelector('.typekeys-hint')
      assert.ok(hint && !hint.hidden, 'the letters are shown')
      assert.eq(hint.querySelectorAll('li').length, Object.keys(TYPES).length)
      assert.eq(hint.getAttribute('aria-hidden'), 'true', 'announced instead of read twice')
      const ev = key('k')
      assert.ok(ev.defaultPrevented)
      assert.ok(!isTypeKeyArmed())
      assert.ok(hint.hidden)
      const made = Object.values(state.blocks)
      assert.eq(made.length, 1)
      assert.eq(made[0].type, 'risk')
      assert.ok(isInlineEditing())
      commitInlineEdit()
      assert.eq(getUndoHistory().length, 1)
    })
  })

  it('the key after N is N’s: L does not Tidy, T is not the type check, Escape keeps the selection', async () => {
    reset()
    block('a', { x: 0, y: 0 }); block('b', { x: 900, y: 500 })
    await withKeys(() => {
      selectBlock('a')
      key('n'); key('l')
      assert.deepEq([state.blocks.a.x, state.blocks.b.x], [0, 900], 'nothing moved')
      assert.eq(Object.keys(state.blocks).length, 2, 'L is no type, so nothing was added')
      assert.eq(getUndoHistory().length, 0)
      key('n'); key('Escape')
      assert.eq(selection.blockId, 'a', 'Escape cancelled N without deselecting')
      key('n'); key('Shift')
      assert.ok(isTypeKeyArmed(), 'a modifier alone does not cancel')
      key('t', { shiftKey: true })
      assert.eq(Object.values(state.blocks).filter(b => b.type === 'terminator').length, 1, 'Shift+T is still T: Trigger / End')
      commitInlineEdit()
    })
  })

  it('N does nothing while typing, in a menu, or on a view-only link', async () => {
    reset()
    await withKeys(() => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      try {
        input.focus()
        key('n', {}, input)
        assert.ok(!isTypeKeyArmed(), 'typing an n')
      } finally { input.remove() }
      openMenu([{ label: 'Alpha', action() {} }], { x: 10, y: 10 })
      key('n', {}, document.body)
      assert.ok(!isTypeKeyArmed(), 'a menu is open')
      closeMenus()
      ui.readOnly = true
      key('n', {}, document.body)
      assert.ok(!isTypeKeyArmed(), 'view-only')
    })
  })
})

// ── Connect to ──────────────────────────────────────────────
describe('command: Connect to', () => {
  it('ranks by what the source usually connects to, and says which are suggested', () => {
    reset()
    block('m', { type: 'metric', title: 'Login rate' })
    block('a', { type: 'implementation', title: 'Add the client', x: 300 })
    block('z', { type: 'goal', title: 'Zero lockouts', x: 600 })
    block('c', { type: 'context', title: 'Background', x: 900 })
    assert.ok(connectRank('m', 'z') < connectRank('m', 'a'), 'a metric measures a goal: the goal first')
    const items = connectToItems('m')
    const search = items[0]
    assert.eq(search.type, 'search')
    assert.eq(search.matchHints, false, 'the filter reads titles only')
    assert.eq(search.pickOnEmpty, false, 'Enter with nothing typed picks nothing')
    const rows = items.filter(i => !i.type).map(i => i.label)
    assert.deepEq(rows, ['Zero lockouts', 'Add the client', 'Background'])
    assert.deepEq(items.filter(i => i.type === 'heading').map(i => i.label), ['Suggested', 'Other blocks'])
  })

  it('in the menu: titles only, the row Enter will pick is marked, and Enter never picks blindly', () => {
    reset()
    block('m', { type: 'metric', title: 'Login rate' })
    block('g', { type: 'goal', title: 'Move sign-in', x: 300 })
    block('i', { type: 'implementation', title: 'Add the client', x: 600 })
    const m = openMenu(connectToItems('m'), { x: 10, y: 10 })
    const input = m.el.querySelector('.pf-menu-search-input')
    const visible = () => [...m.el.querySelectorAll('.pf-menu-item')].filter(r => !r.hidden).map(r => r.querySelector('.pf-menu-label').textContent)
    const marked = () => [...m.el.querySelectorAll('.pf-menu-match')].map(r => r.querySelector('.pf-menu-label').textContent)
    assert.deepEq(marked(), [], 'nothing typed, nothing marked')
    key('Enter', {}, input)
    assert.eq(state.arrows.length, 0, 'Enter on an empty filter connects nothing')
    assert.ok(isMenuOpen())
    assert.eq(document.activeElement.querySelector?.('.pf-menu-label')?.textContent, 'Move sign-in', 'it steps into the list instead')
    input.focus()
    // "move" is in the implementation's hint ("it should move...") only
    // when hints are searched; the filter reads titles.
    input.value = 'implementation'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    assert.deepEq(visible(), [], 'a type name in the hint does not match')
    key('Enter', {}, input)
    assert.eq(state.arrows.length, 0, 'no match, nothing connects')
    input.value = 'add'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    assert.deepEq(marked(), ['Add the client'])
    key('Enter', {}, input)
    assert.eq(state.arrows.length, 1)
    assert.ok(state.arrows.some(a => (a.from === 'i' && a.to === 'm') || (a.from === 'm' && a.to === 'i')))
    closeMenus()
  })

  it('the mark prefers a word that starts with what was typed', () => {
    reset()
    let picked = ''
    const m = openMenu([
      { type: 'search', placeholder: 'Find', matchHints: false },
      { label: 'A test that fails before the fix', action: () => { picked = 'test' } },
      { label: 'Report received', action: () => { picked = 'report' } },
    ], { x: 10, y: 10 })
    const input = m.el.querySelector('.pf-menu-search-input')
    input.value = 're'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    assert.eq([...m.el.querySelectorAll('.pf-menu-item')].filter(r => !r.hidden).length, 2, 'both still show')
    assert.includes(m.el.querySelector('.pf-menu-match')?.textContent || '', 'Report received')
    key('Enter', {}, input)
    assert.eq(picked, 'report', 'Enter picks the marked row')
  })

  it('a menu search without those flags still marks and picks its first row (the quick-add picker)', () => {
    reset()
    let picked = ''
    const m = openMenu([
      { type: 'search', placeholder: 'Find' },
      { label: 'Goal', hint: 'an outcome', action: () => { picked = 'goal' } },
      { label: 'Metric', hint: 'measurable', action: () => { picked = 'metric' } },
    ], { x: 10, y: 10 })
    const input = m.el.querySelector('.pf-menu-search-input')
    assert.ok(m.el.querySelector('.pf-menu-match'), 'the first row is marked')
    input.value = 'measur'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    assert.eq(m.el.querySelector('.pf-menu-match')?.textContent.includes('Metric'), true, 'hints still match here')
    key('Enter', {}, input)
    assert.eq(picked, 'metric')
  })

  it('in the palette, Connect to waits for a choice, then connects to the match', async () => {
    reset()
    block('m', { type: 'metric', title: 'Login rate' })
    block('g', { type: 'goal', title: 'Ship it', x: 300 })
    selectBlock('m')
    await withKeys(() => {
      openCommandPalette()
      type('connect to')
      press('Enter')
      assert.eq(chip(), 'Connect to…')
      assert.eq(field().placeholder, 'Find a block by title')
      assert.eq(activeRow(), null, 'nothing is picked before a choice')
      type('ship')
      assert.eq(activeLabel(), 'Ship it')
      press('Enter')
      assert.eq(state.arrows.length, 1)
      assert.eq(state.arrows[0].from, 'm', 'metric -> goal')
    })
  })
})

// ── Templates are buttons ───────────────────────────────────
describe('command: templates are buttons', () => {
  it('each template is a named button, its description a description; a saved one has a sibling delete', () => {
    reset()
    setupTemplates()
    const list = $.templatesList()
    const buttons = [...list.querySelectorAll('button.template-item[data-tpl]')]
    assert.eq(buttons.length, TEMPLATES.length)
    buttons.forEach((b, i) => {
      assert.eq(b.type, 'button')
      assert.eq(b.tabIndex, 0, 'a Tab stop')
      assert.eq(b.getAttribute('aria-label'), templateName(TEMPLATES[i]))
      const desc = document.getElementById(b.getAttribute('aria-describedby'))
      assert.eq(desc?.textContent, TEMPLATES[i].desc)
    })
    const large = TEMPLATES.find(t => t.large)
    if (large) assert.eq(templateName(large), `${large.name}, ${large.blocks.length} blocks`)

    block('a', { title: 'Seed' })
    const before = listUserTemplates().length
    const tpl = saveCurrentAsTemplate('Weekly review', { state, canvasMeta: { title: 'Weekly review' }, mode: 'plan' })
    // The runner hides the list; focus needs it laid out, as in the app.
    const prevDisplay = list.style.display
    list.style.display = 'block'
    try {
      setupTemplates()
      const row = list.querySelector(`button.template-item[data-utpl="${tpl.id}"]`)
      assert.ok(row, 'the saved template is a button')
      const del = row.parentElement.querySelector(':scope > .utpl-del')
      assert.ok(del && !row.contains(del), 'delete is a sibling, not nested in the button')
      assert.eq(del.getAttribute('aria-label'), 'Delete template Weekly review')
      del.click()
      assert.eq(listUserTemplates().length, before, 'deleted')
      assert.ok(list.contains(document.activeElement), 'focus stays in the list')
    } finally {
      list.style.display = prevDisplay
      if (listUserTemplates().some(t => t.id === tpl.id)) deleteUserTemplate(tpl.id)
      setupTemplates()
    }
  })
})

// ── The shortcut sheet ──────────────────────────────────────
describe('command: the shortcut sheet', () => {
  it('opens on the most used dozen, the palette first, and the letters after N', () => {
    reset()
    const top = topShortcuts()
    assert.eq(top.length, 12)
    assert.eq(top[0].key, '⌘/Ctrl + K')
    assert.eq(top[1].key, 'N, then a letter')
    assert.ok(top.every(r => r.desc.length <= 40), 'short lines')
    const ro = topShortcuts({ readOnly: true })
    assert.ok(ro.length > 0 && ro.every(r => r.group === 'Navigation' || r.group === 'View'), 'view-only: keys that work there')
    buildShortcutGrid()
    const grid = $.shortcutGrid()
    const letters = [...grid.querySelectorAll('.shortcut-typekey .shortcut-key')].map(k => k.textContent)
    assert.eq(letters.length, Object.keys(TYPES).length)
    assert.deepEq(letters, Object.keys(TYPES).map(t => TYPE_KEYS[t].toUpperCase()))
    const all = grid.querySelector('details.shortcut-all')
    assert.ok(all && !all.open, 'the rest wait behind All shortcuts')
    assert.match(all.querySelector('summary').textContent, /^All shortcuts \(\d+\)$/)
    const text = JSON.stringify(SHORTCUTS) + grid.textContent
    assert.ok(!text.includes(String.fromCharCode(0x2014)), 'no em dash')
  })
})

describe('command: a row says its state in words', () => {
  it('a toggle reads on or off, a value reads current, matched letters are bold, and a title keeps its direction', () => {
    const on = rowEl({ label: 'Snap to grid', checked: true }, [], 1)
    const off = rowEl({ label: 'Snap to grid', checked: false }, [], 2)
    const cur = rowEl({ label: 'Dark theme', checked: true, radio: true }, [], 3)
    const other = rowEl({ label: 'Light theme', checked: false, radio: true }, [], 4)
    assert.includes(on.textContent, ', on')
    assert.includes(off.textContent, ', off')
    assert.includes(cur.textContent, ', current')
    assert.notIncludes(other.textContent, ', off', 'a value that is not chosen says nothing')
    assert.ok(on.querySelector('.cmdk-state svg') && !off.querySelector('.cmdk-state'), 'the check mark only where it is true')
    assert.eq(on.getAttribute('role'), 'option')
    const hit = rowEl({ label: 'Change type' }, matchScore('ct', 'Change type').hits, 5)
    assert.deepEq([...hit.querySelectorAll('.cmdk-hit')].map(b => b.textContent), ['C', 't'])
    assert.eq(hit.querySelector('.cmdk-label').getAttribute('dir'), 'auto')
    assert.eq(markedLabel('<b>', [0]), '<b class="cmdk-hit">&lt;</b>b&gt;', 'a title is text, never markup')
  })
})

describe('command: rows from menu items', () => {
  it('headings label rows, swatches become rows, submenus drill, a search box carries its flags', () => {
    let picked = null
    const rows = menuRows([
      { type: 'heading', label: 'Why' },
      { label: 'Goal', action: () => {} },
      { type: 'divider' },
      { type: 'swatches', label: 'Highlight', options: [{ value: 'go', label: 'Go', color: 'var(--hl-go)', active: true }], onPick: v => { picked = v } },
      { label: 'Status', submenu: () => [{ type: 'search', pickOnEmpty: false, placeholder: 'Find' }, { label: 'Done', action() {} }] },
      { type: 'custom', render() {} },
    ], { idPrefix: 'x:' })
    assert.deepEq(rows.map(r => r.label), ['Goal', 'Go', 'Status'])
    assert.eq(rows[0].heading, 'Why')
    assert.eq(rows[1].checked, true)
    rows[1].run()
    assert.eq(picked, 'go')
    const sub = rows[2].children()
    assert.deepEq(sub.map(r => r.label), ['Done'])
    assert.eq(sub.noDefault, true)
    assert.eq(sub.placeholder, 'Find')
    assert.eq(sub[0].id, 'x:Status/Done')
  })
})

// ── Review fixes (design round) ─────────────────────────────
describe('command: review fixes', () => {
  // The query "change type" listed goal, risk, other, metric... by label
  // length, which reads as random; equal matches keep the order they were
  // built in.
  it('matches of equal quality keep their order: Change type to lists the types in step order', async () => {
    reset()
    block('a', { type: 'context' })
    selectBlock('a')
    await withKeys(() => {
      openCommandPalette()
      type('change type to')
      const want = Object.keys(TYPES).filter(t => t !== 'context')
        .map(t => `Change type to ${t === 'custom' ? 'other' : TYPES[t].label.toLowerCase()}`)
      assert.deepEq(rowLabels().filter(l => l.startsWith('Change type to')), want)
    })
    assert.gt(matchScore('risk', 'Risk')?.score, matchScore('risk', 'Risk register')?.score, 'the whole text still leads')
    assert.eq(matchScore('zoom', 'Zoom to selection')?.score, matchScore('zoom', 'Zoom in')?.score, 'length does not rank')
  })

  // Every new map is "Untitled map": keyed by name, two of them were one row.
  it('map rows are keyed by the map, not its name', () => {
    reset()
    const prev = localStorage.getItem('pathfinder-maps')
    localStorage.setItem('pathfinder-maps', JSON.stringify([
      { id: 'cmdk-m1', name: '', blocks: 1, arrows: 0, updated: 2 },
      { id: 'cmdk-m2', name: '', blocks: 2, arrows: 0, updated: 1 },
    ]))
    try {
      const radios = mapsMenuItems().filter(i => i && i.radio)
      assert.deepEq(radios.map(i => i.rowId), ['cmdk-m1', 'cmdk-m2'])
      const maps = commandGroups().find(g => g.key === 'maps')
      assert.ok(maps, 'the Maps group')
      assert.deepEq(maps.items.map(r => r.id), ['map:cmdk-m1', 'map:cmdk-m2'], 'two rows, two ids')
      assert.deepEq(maps.items.map(r => r.label), ['Untitled map', 'Untitled map'])
    } finally {
      if (prev === null) localStorage.removeItem('pathfinder-maps')
      else localStorage.setItem('pathfinder-maps', prev)
    }
  })

  it('after N, / and Cmd/Ctrl+K are N’s too, and N held down stays armed', async () => {
    reset()
    await withKeys(() => {
      key('n'); key('/')
      assert.ok(!isCommandPaletteOpen(), 'N then / does not open Create')
      assert.ok(!isTypeKeyArmed(), 'it cancelled N')
      key('n'); key('k', MOD_K)
      assert.ok(!isCommandPaletteOpen(), 'N then Cmd/Ctrl+K does not open the palette')
      assert.eq(Object.keys(state.blocks).length, 0, 'and adds nothing')
      key('n'); key('n', { repeat: true }); key('n', { repeat: true })
      assert.ok(isTypeKeyArmed(), 'the auto-repeat of a held N is not the letter after it')
      key('g')
      assert.eq(Object.values(state.blocks).filter(b => b.type === 'goal').length, 1, 'the letter after it still counts')
      commitInlineEdit()
    })
  })

  it('the palette chord is Cmd+K on a Mac and Ctrl+K elsewhere, never the other one', async () => {
    reset()
    await withKeys(() => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      try {
        input.focus()
        const ev = key('k', OTHER_K, input)
        assert.ok(!isCommandPaletteOpen(), IS_MAC ? 'Ctrl+K on a Mac stays the field’s delete to end of line' : 'Meta+K does not open it')
        assert.ok(!ev.defaultPrevented, 'and the field keeps the key')
        key('k', MOD_K, input)
        assert.ok(isCommandPaletteOpen())
      } finally { input.remove() }
    })
  })

  it('a row with a list behind it says so in words, not with an attribute an option may not have', () => {
    const el = rowEl({ label: 'Change type', children: () => [] }, [], 9)
    assert.eq(el.getAttribute('role'), 'option')
    assert.ok(!el.hasAttribute('aria-haspopup'), 'ARIA allows no aria-haspopup on an option')
    assert.includes(el.querySelector('.sr-only:last-child')?.textContent || '', 'opens a list')
    assert.ok(!rowEl({ label: 'Undo' }, [], 10).textContent.includes('opens a list'))
  })

  it('with nothing typed the list is short: the selection, Recent, then a few actions and "N more"', async () => {
    reset()
    for (let i = 0; i < 4; i++) block('b' + i, { x: i * 300 })
    selectBlock('b0')
    await withKeys(() => {
      openCommandPalette()
      assert.match(headings()[0], /^Selected/, 'what the selection offers comes first')
      assert.eq(activeLabel(), 'Edit title', 'and Enter on it is the safe default')
      assert.ok(rowsUnder(headings()[0]).length <= 8)
      assert.ok(!rowsUnder(headings()[0]).includes('Delete'), 'Delete is a word away, not in the first view')
      const actions = rowsUnder('Actions')
      assert.ok(actions.length > 0 && actions.length <= 6, `Actions shows a few (${actions.length})`)
      assert.eq(actions[0], 'Find blocks')
      const more = [...document.querySelectorAll('#cmdkList .cmdk-more')].map(m => m.textContent)
      assert.ok(more.some(t => /^\d+ more: keep typing/.test(t)), 'the rest are a search away')
      assert.ok(rowEls().length <= 45, `${rowEls().length} rows`)
      type('light theme')
      assert.ok(rowLabels().includes('Light theme'), 'a search still reaches every action')
    })
  })

  it('a destructive row keeps its colour on the letters that matched', async () => {
    reset()
    block('a', { title: 'Alpha' })
    selectBlock('a')
    await withKeys(() => withStyledPalette((shadow) => {
      openCommandPalette()
      const input = shadow.getElementById('cmdkInput')
      input.value = 'delete'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const row = [...shadow.querySelectorAll('.cmdk-row.cmdk-danger')].find(r => r.querySelector('.cmdk-label').textContent === 'Delete')
      assert.ok(row, 'the Delete row')
      const label = row.querySelector('.cmdk-label'), hit = row.querySelector('.cmdk-hit')
      assert.ok(hit, 'its letters matched')
      assert.eq(getComputedStyle(hit).color, getComputedStyle(label).color, 'the matched letters are danger too')
      assert.eq(getComputedStyle(hit).fontWeight, '600', 'and still bold')
    }))
  })

  // Review: Change type opened with the current value at the bottom and the
  // "Why" heading cut in half at the top edge. Whatever the value, it opens
  // on a whole heading, the value in view below it.
  it('a drilled list opens on its current value with its heading whole at the top', async () => {
    reset()
    block('a', { type: 'goal' })
    selectBlock('a')
    await withKeys(() => withStyledPalette((shadow) => {
      for (const t of ['context', 'process', 'metric', 'assumption', 'output', 'goal']) {
        state.blocks.a.type = t
        openCommandPalette()
        const input = shadow.getElementById('cmdkInput')
        input.value = 'change type'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        key('Enter', {}, input)
        const list = shadow.getElementById('cmdkList')
        assert.gt(list.scrollHeight, list.clientHeight + 40, 'the list scrolls (the check needs it to)')
        const box = list.getBoundingClientRect()
        const heads = [...shadow.querySelectorAll('.cmdk-heading')]
        heads.forEach(h => {
          const r = h.getBoundingClientRect()
          assert.ok(!(r.top < box.top - 0.5 && r.bottom > box.top + 0.5), `${t}: "${h.textContent}" is not cut by the top edge`)
        })
        const heading = heads.find(h => Math.abs(h.getBoundingClientRect().top - box.top) < 1)
        assert.ok(heading, `${t}: a whole heading holds the top edge`)
        assert.eq(getComputedStyle(heading).position, 'sticky')
        const cur = shadow.getElementById(input.getAttribute('aria-activedescendant'))
        assert.eq(cur.querySelector('.cmdk-label').textContent, TYPES[t].label, `${t}: it opens on the current value`)
        const r = cur.getBoundingClientRect()
        assert.ok(r.top >= heading.getBoundingClientRect().bottom - 0.5 && r.bottom <= box.bottom + 0.5,
          `${t}: the current value is in view, below the heading`)
        closeCommandPalette({ restoreFocus: false })
      }
    }))
  })

  it('one key cap everywhere: the palette, the N hint and the shortcut sheet, in mono', async () => {
    const { shadow, done } = await styledHost(
      '<kbd class="cmdk-kbd">K</kbd><kbd class="typekeys-key">G</kbd>' +
      '<dl class="shortcut-list"><div class="shortcut-row"><dt class="shortcut-key">?</dt><dd class="shortcut-desc">x</dd></div></dl>')
    try {
      const caps = ['.cmdk-kbd', '.typekeys-key', '.shortcut-key'].map(sel => getComputedStyle(shadow.querySelector(sel)))
      for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'color', 'backgroundColor', 'borderTopColor', 'borderTopLeftRadius']) {
        assert.eq(new Set(caps.map(c => c[prop])).size, 1, `${prop}: ${caps.map(c => c[prop]).join(' / ')}`)
      }
      assert.match(caps[0].fontFamily, /mono/i, 'mono, as DESIGN.md says shortcut keys are')
    } finally { done() }
  })

  it('in the sheet, every Most used key sits on one line', async () => {
    buildShortcutGrid()
    const { shadow, done } = await styledHost(`
      <div class="shortcut-overlay" style="visibility:hidden;display:flex"><div class="shortcut-modal">
        <div class="shortcut-grid"></div></div></div>`)
    try {
      const grid = shadow.querySelector('.shortcut-grid')
      grid.append(...[...$.shortcutGrid().childNodes].map(n => n.cloneNode(true)))
      const keys = [...shadow.querySelectorAll('.shortcut-top .shortcut-key')]
      assert.eq(keys.length, 12)
      const heights = keys.map(k => Math.round(k.getBoundingClientRect().height))
      const one = Math.min(...heights)
      keys.forEach((k, i) => assert.ok(heights[i] <= one + 1, `"${k.textContent}" wraps (${heights[i]}px against ${one}px)`))
      assert.ok(topShortcuts().some(r => r.key === 'Shift + F10'), 'the short form of a long key')
    } finally { done() }
  })
})
