// ============================================================
//  events.test.js -- Tests for the Brain Dump / paste pipeline
//  (parseOutline, categorizeLine, createBlocksFromText)
// ============================================================

import { describe, it, assert, cleanupMockEls } from './test-utils.js'
import { state, ui } from '../js/state.js'
import { parseOutline, categorizeLine, createBlocksFromText } from '../js/events.js'

function reset() {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
}

// ── parseOutline: nesting bullets/indents into descriptions ──

describe('parseOutline()', () => {
  it('keeps flat top-level lines as separate items', () => {
    const items = parseOutline('Ship the demo\nUsers will pay\nAPI is slow')
    assert.eq(items.length, 3)
    assert.deepEq(items.map(i => i.description.length), [0, 0, 0])
  })

  it('folds indented lines into the item above', () => {
    const items = parseOutline('Build the PRD\n  Overview\n  Scope\nShip the demo')
    assert.eq(items.length, 2)
    assert.eq(items[0].line, 'Build the PRD')
    assert.deepEq(items[0].description, ['Overview', 'Scope'])
    assert.eq(items[1].line, 'Ship the demo')
  })

  it('folds bulleted lines into the item above even without indentation', () => {
    const items = parseOutline('Build the PRD\n- Overview\n- Scope')
    assert.eq(items.length, 1)
    assert.deepEq(items[0].description, ['• Overview', '• Scope'])
  })

  it('treats tabs as one indent unit', () => {
    const items = parseOutline('Parent\n\tchild line')
    assert.eq(items.length, 1)
    assert.deepEq(items[0].description, ['child line'])
  })

  it('supports numbered list markers as children', () => {
    const items = parseOutline('Steps\n1. First\n2. Second')
    assert.eq(items.length, 1)
    assert.eq(items[0].description.length, 2)
  })

  it('ignores blank lines', () => {
    const items = parseOutline('A\n\n\nB')
    assert.eq(items.length, 2)
  })

  it('a bullet with no preceding parent becomes its own item', () => {
    const items = parseOutline('- Orphan bullet')
    assert.eq(items.length, 1)
    assert.eq(items[0].line, 'Orphan bullet')
  })
})

// ── categorizeLine: flow-node classification ─────────────────

describe('categorizeLine() -- flow nodes', () => {
  it('classifies an "action:" prefix as process', () => {
    assert.eq(categorizeLine('action: Update the status').type, 'process')
  })

  it('classifies a "start:" prefix as terminator', () => {
    assert.eq(categorizeLine('start: Submission received').type, 'terminator')
  })

  it('scores an imperative verb line as process', () => {
    assert.eq(categorizeLine('Update status to Ready for Review').type, 'process')
  })

  it('scores a "Done" line as terminator', () => {
    assert.eq(categorizeLine('Done').type, 'terminator')
  })

  it('still classifies goals and problems correctly', () => {
    assert.eq(categorizeLine('goal: Launch MVP').type, 'goal')
    assert.eq(categorizeLine('The API latency exceeds our SLA').type, 'problem')
  })
})

// ── createBlocksFromText: end-to-end with nesting ────────────

describe('createBlocksFromText() -- nesting', () => {
  it('creates one block per top-level line and folds children into descriptions', () => {
    reset()
    const ids = createBlocksFromText('Build the PRD\n  Overview\n  Scope\nShip the demo', true)
    assert.eq(ids.length, 2)
    const first = state.blocks[ids[0]]
    assert.eq(first.title, 'Build the PRD')
    assert.includes(first.description, 'Overview')
    assert.includes(first.description, 'Scope')
    assert.match(first.description, /\n/)
  })

  it('with nesting off, every line becomes its own block', () => {
    reset()
    const ids = createBlocksFromText('Build the PRD\n  Overview\n  Scope', false)
    assert.eq(ids.length, 3)
  })

  it('assigns flow types to workflow-style lines', () => {
    reset()
    const ids = createBlocksFromText('Update status to Ready\nDone', true)
    const types = ids.map(id => state.blocks[id].type)
    assert.includes(types, 'process')
    assert.includes(types, 'terminator')
  })
})
