// ============================================================
//  sharing-safety.test.js -- the sharing stream: lossless interop,
//  compressed links, link and import safety, the other-tab
//  warning, backups, and durable review notes.
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { state, ui, canvasMeta, devOpts, selection, saveStatus, serializeCanvas, applyPromptOpts, saveState,
         getUndoHistory, getRedoFuture, snapshot, serializeForShare, compressText, decompressText, decodeShareHash, buildShareUrl, buildEmbedUrl,
         buildShareUrlAsync, primeShareLink, canCompressLinks, isShareHash, decodeLegacyShare, MAX_INFLATED } from '../js/state.js'
import { normalizeCanvas, normalizeBlock, normalizeArrow } from '../js/normalize.js'
import { TYPES } from '../js/utils.js'
import { categorizeLine } from '../js/classify.js'
import { fromJsonCanvas, toJsonCanvas, typeForHex, resolveNodeType, toMermaid, parseMermaid,
         mermaidShapeFor, exportColorFor, isLegacyPathfinderCanvas } from '../js/interop.js'
import { checkShareUrl, checkSrcUrl } from '../js/ui-panels.js'
import { openIncoming, incomingDialog, hasContent, incomingMessage, backupStatusText, backupStale,
         maybeNagBackup, resetBackupNag, requestPersistence, showOtherTabBanner, touchesThisMap,
         refreshBackupStatus, setupSharingSafety, backupNagText, withMapName } from '../js/sharing.js'
import { currentId, ensureLibrary, writeThrough, listSnapshots, readBackup, writeBackup,
         lastBackupAt, exportAllMaps, notePointerMove, forgetTabMap, pointAtThisMap } from '../js/library.js'
import { undo, redo } from '../js/render.js'
import { review, reviewKey, loadReviewNotes, saveReviewNotes, hasUnsentNotes, paintReviewDot,
         addReviewNote, removeLastReviewNote, setupReview } from '../js/review.js'
import { SWATCH_COLORS } from '../js/utils.js'
import { TEMPLATES } from '../js/templates.js'

const DAY = 86_400_000

// The user's own reporting canvas, as Pathfinder exported it before
// 2026-09: exact hexes on some nodes, the old shared presets on others.
const USER_CANVAS = {
  nodes: [
    { id: 'rptdemow1', type: 'text', x: 867, y: 367, width: 220, height: 62, color: '#f0abfc', text: '#### Multi Reports' },
    { id: 'rptdemow2', type: 'text', x: -153, y: 357, width: 220, height: 82, color: '3', text: '#### Status notes per Epic (Deliverable)\n\nPart of the delivery lifecycle.' },
    { id: 'rptdemow3', type: 'text', x: 527, y: 357, width: 220, height: 82, color: '3', text: '#### Weekly Reports\n\n(Check if still used)' },
    { id: 'rptdemow4', type: 'text', x: 187, y: 349, width: 220, height: 97, color: '4', text: '#### Schedule status notes\n\nIntegration with multiple tools to get a summary of the work needed.' },
    { id: 'rptdemow5', type: 'text', x: 527, y: 477, width: 220, height: 62, color: '3', text: '#### End of Sprint' },
    { id: 'rptdemow6', type: 'text', x: -833, y: 422, width: 220, height: 62, color: '#f0abfc', text: '#### Portfolio Reporting' },
    { id: 'rptdemow7', type: 'text', x: -833, y: 522, width: 220, height: 62, color: '#f0abfc', text: '#### Executive Reporting' },
    { id: 'rptdemow8', type: 'text', x: -493, y: 422, width: 220, height: 62, color: '#60a5fa', text: '#### Every End of Sprint' },
    { id: 'rptdemox9', type: 'text', x: 527, y: 577, width: 220, height: 62, color: '3', text: '#### Key Results' },
    { id: 'rptdemoxa', type: 'text', x: 187, y: 577, width: 220, height: 62, color: '#60a5fa', text: "#### On Quarter's end" },
    { id: 'rptdemoxb', type: 'text', x: 187, y: 677, width: 220, height: 82, color: '#64748b', text: '#### Data Hub\n\nIntegrated with the tracker and other sources' },
  ],
  edges: [
    { id: 'rptdemoxc', fromNode: 'rptdemow2', toNode: 'rptdemow4', fromSide: 'right' },
    { id: 'rptdemoxd', fromNode: 'rptdemow3', toNode: 'rptdemow1', fromSide: 'right' },
    { id: 'rptdemoxe', fromNode: 'rptdemow5', toNode: 'rptdemow1', fromSide: 'right' },
    { id: 'rptdemoxf', fromNode: 'rptdemow7', toNode: 'rptdemow8', fromSide: 'right', toSide: 'left' },
    { id: 'rptdemoxg', fromNode: 'rptdemow6', toNode: 'rptdemow8', fromSide: 'right' },
    { id: 'rptdemoxh', fromNode: 'rptdemow8', toNode: 'rptdemow2', fromSide: 'right' },
    { id: 'rptdemoxi', fromNode: 'rptdemow8', toNode: 'rptdemow5', fromSide: 'right' },
    { id: 'rptdemoxj', fromNode: 'rptdemoxa', toNode: 'rptdemox9', fromSide: 'right' },
    { id: 'rptdemoxk', fromNode: 'rptdemow7', toNode: 'rptdemoxa', fromSide: 'right' },
    { id: 'rptdemoxl', fromNode: 'rptdemow4', toNode: 'rptdemow3', fromSide: 'right' },
    { id: 'rptdemoxm', fromNode: 'rptdemoxb', toNode: 'rptdemox9', fromSide: 'top' },
    { id: 'rptdemoxn', fromNode: 'rptdemox9', toNode: 'rptdemow1', fromSide: 'right' },
  ],
}
// What the old export's presets meant (interop.js JC_PRESET_TYPES).
const PRESET_CANDIDATES = { 3: ['requirement', 'assumption'], 4: ['decision'] }

const SHARED = {
  blocks: {
    shared: { id: 'shared', type: 'goal', title: 'Shared goal' },
    task: { id: 'task', type: 'requirement', title: 'Shared requirement' },
  },
  arrows: [{ id: 'connection', from: 'shared', to: 'task' }],
  meta: { title: 'Teammate map' },
}

// ── Isolation ───────────────────────────────────────────────

function keepStorage() {
  const saved = new Map()
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith('pathfinder-')) saved.set(k, localStorage.getItem(k))
  }
  return () => {
    const now = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('pathfinder-')) now.push(k)
    }
    now.forEach(k => { if (!saved.has(k)) localStorage.removeItem(k) })
    saved.forEach((v, k) => localStorage.setItem(k, v))
  }
}

async function sandbox(fn) {
  const before = JSON.parse(JSON.stringify(serializeCanvas()))
  const flags = { readOnly: ui.readOnly, embed: ui.embed }
  const url = location.href
  const restoreStorage = keepStorage()
  const undoLen = getUndoHistory().length
  const fetchBefore = window.fetch
  try {
    ui.readOnly = false; ui.embed = false
    await fn()
    await new Promise(requestAnimationFrame)
  } finally {
    incomingDialog()?.querySelector('[data-choice="cancel"]')?.click()
    document.getElementById('otherTabBanner')?.remove()
    Object.assign(state, { blocks: before.blocks, arrows: before.arrows, groups: before.groups })
    Object.assign(canvasMeta, before.meta)
    delete canvasMeta.prompt
    applyPromptOpts(before.meta.prompt)
    Object.assign(ui, flags)
    window.fetch = fetchBefore
    history.replaceState(null, '', url)
    getUndoHistory().length = Math.min(getUndoHistory().length, undoLen)
    getRedoFuture().length = 0
    restoreStorage()
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

async function waitFor(check, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const v = check()
    if (v) return v
    await tick()
  }
  return null
}

function seedPrivate() {
  state.blocks = { private: normalizeBlock({ id: 'private', type: 'goal', title: 'Private goal', x: 0, y: 0 }) }
  state.arrows = []; state.groups = {}
  canvasMeta.title = 'Private map'; canvasMeta.contextBrief = ''
  saveState()
  ensureLibrary()
  writeThrough()
  return currentId()
}

function oneOfEachType() {
  const blocks = {}
  Object.keys(TYPES).forEach((t, i) => {
    blocks['t' + i] = normalizeBlock({ id: 't' + i, type: t, title: `The ${t} block`, x: i * 300, y: 0 })
  })
  return blocks
}

function templateCanvas(name) {
  const tpl = TEMPLATES.find(t => t.name === name)
  const ids = tpl.blocks.map((_, i) => 'e' + i)
  const blocks = {}
  tpl.blocks.forEach((bd, i) => {
    blocks[ids[i]] = { id: ids[i], type: bd.type, title: bd.title, description: bd.description || '',
      x: bd.dx, y: bd.dy, actions: bd.actions || [], criteria: bd.criteria || [] }
  })
  const arrows = tpl.arrows.map(([f, t, label, relation], i) => ({ id: 'ea' + i, from: ids[f], to: ids[t], style: 'routed', label, relation }))
  return normalizeCanvas({ blocks, arrows, meta: { title: tpl.name, situation: tpl.situation } })
}

// ── JSON Canvas ─────────────────────────────────────────────

describe('JSON Canvas import: types travel by colour', () => {
  it("the user's reporting canvas types every exact-hex node with high confidence", () => {
    const { payload, lowConfidence } = fromJsonCanvas(USER_CANVAS)
    const byTitle = Object.fromEntries(payload.blocks.map(b => [b.title, b]))
    const expected = {
      'Multi Reports': 'terminator', 'Portfolio Reporting': 'terminator', 'Executive Reporting': 'terminator',
      'Every End of Sprint': 'process', "On Quarter's end": 'process', 'Data Hub': 'context',
    }
    Object.entries(expected).forEach(([title, type]) => {
      const b = byTitle[title]
      assert.ok(b, title + ' imported')
      assert.eq(b.type, type, `${title} is a ${type}`)
      assert.ok(!lowConfidence.includes(b.id), `${title} needs no check`)
      assert.ok(!b.typeCheck, `${title} is not flagged`)
      assert.eq(b.color, null, `${title} keeps no colour override: the type colour is the colour`)
    })
    assert.eq(payload.blocks.length, 11)
    assert.eq(payload.blocks.filter(b => b.type === 'custom').length, 0, 'nothing falls through to Other')
  })

  it('presets are only a hint: they settle an unsure call, and every such call is flagged', () => {
    const { payload, lowConfidence } = fromJsonCanvas(USER_CANVAS)
    const byId = Object.fromEntries(payload.blocks.map(b => [b.id, b]))
    const presetNodes = USER_CANVAS.nodes.filter(n => !String(n.color).startsWith('#'))
    assert.eq(presetNodes.length, 5)
    presetNodes.forEach(n => {
      const b = byId[n.id]
      const cands = PRESET_CANDIDATES[n.color]
      const cat = categorizeLine(b.title)
      if (cat.confidence !== 'high' || cands.includes(cat.type)) {
        assert.includes(cands, b.type, `${b.title}: the preset decides between its candidates`)
      } else {
        assert.eq(b.type, cat.type, `${b.title}: a confident classifier keeps its call`)
      }
      if (!(cat.confidence === 'high' && cands.includes(cat.type))) {
        assert.eq(b.typeCheck, true, `${b.title} is flagged for a person to confirm`)
        assert.includes(lowConfidence, b.id)
      }
      assert.eq(b.color, null, `${b.title}: a preset is spent on the type, not kept as an override`)
    })
  })

  it('resolveNodeType: pathfinderType, then exact hex, then preset hint, then classifier', () => {
    assert.deepEq(resolveNodeType({ pathfinderType: 'metric', color: '#f87171' }, 'x').type, 'metric')
    assert.eq(resolveNodeType({ color: '#A3E635' }, 'zz qq').type, 'implementation', 'hex match ignores case')
    assert.eq(resolveNodeType({ color: '#4d7c0f' }, 'zz qq').type, 'implementation', 'light hex maps too')
    const hinted = resolveNodeType({ color: '5' }, 'zz qq xx')
    assert.eq(hinted.type, 'question')
    assert.eq(hinted.confidence, 'low')
    assert.eq(resolveNodeType({ color: '#123456' }, 'zz qq xx').type, categorizeLine('zz qq xx').type, 'other hex: classifier')
    assert.eq(typeForHex('#f0abfc'), 'terminator')
    assert.eq(typeForHex('3'), null)
    assert.eq(typeForHex('#22d3ee'), null, 'preset 5 cyan is no type')
  })

  it('a colour that is no type colour survives as an override', () => {
    const { payload } = fromJsonCanvas({ nodes: [{ id: 'a', type: 'text', x: 0, y: 0, color: '#123456', text: 'Goal: ship it' }], edges: [] })
    assert.eq(payload.blocks[0].type, 'goal')
    assert.eq(payload.blocks[0].color, '#123456')
  })

  it('imported connections are routed and their side pins are marked as imported', () => {
    const { payload } = fromJsonCanvas(USER_CANVAS)
    assert.eq(payload.arrows.length, 12)
    payload.arrows.forEach(a => {
      assert.eq(a.style, 'routed')
      if (a.fromPort || a.toPort) assert.eq(a.portsBy, 'import')
      assert.eq(normalizeArrow(a).portsBy, a.portsBy, 'normalize keeps the provenance')
    })
    const pinnedBoth = payload.arrows.find(a => a.id === 'rptdemoxf')
    assert.eq(pinnedBoth.fromPort, 'right'); assert.eq(pinnedBoth.toPort, 'left')
  })
})

describe('JSON Canvas export: lossless for every type', () => {
  const withTypes = fn => {
    const before = { blocks: state.blocks, arrows: state.arrows, groups: state.groups }
    try { state.blocks = oneOfEachType(); state.arrows = []; state.groups = {}; fn() }
    finally { Object.assign(state, before) }
  }
  it('writes each type its own hex plus pathfinderType', () => withTypes(() => {
    const out = toJsonCanvas()
    assert.eq(out.nodes.length, Object.keys(TYPES).length)
    out.nodes.forEach(n => {
      const b = state.blocks[n.id]
      assert.eq(n.color, TYPES[b.type].color)
      assert.eq(n.pathfinderType, b.type)
    })
    assert.eq(new Set(out.nodes.map(n => n.color)).size, out.nodes.length, 'no two types share a colour')
  }))

  it('all 16 types round-trip: with pathfinderType, without it, and from light hexes', () => withTypes(() => {
    const out = JSON.parse(JSON.stringify(toJsonCanvas()))
    const check = (canvas, label) => {
      const { payload, lowConfidence } = fromJsonCanvas(canvas)
      assert.eq(lowConfidence.length, 0, label + ': nothing needs a check')
      payload.blocks.forEach(b => {
        assert.eq(b.type, state.blocks[b.id].type, `${label}: ${b.id}`)
        assert.eq(b.title, state.blocks[b.id].title)
        assert.eq(b.color, null, `${label}: no override for a type colour`)
      })
    }
    check(out, 'as exported')
    check({ ...out, nodes: out.nodes.map(({ pathfinderType, ...n }) => n) }, 'field stripped')
    check({ ...out, nodes: out.nodes.map(({ pathfinderType, ...n }) => ({ ...n, color: TYPES[pathfinderType].light.toUpperCase() })) }, 'light hex')
  }))

  it('a type from a newer build travels as custom plus its hint', () => {
    const before = { blocks: state.blocks, arrows: state.arrows, groups: state.groups }
    try {
      state.blocks = { f: normalizeBlock({ id: 'f', type: 'roadmap', title: 'Future type' }) }
      state.arrows = []; state.groups = {}
      assert.eq(state.blocks.f.type, 'custom')
      const out = toJsonCanvas()
      assert.eq(out.nodes[0].pathfinderType, 'roadmap')
      const clean = normalizeCanvas(fromJsonCanvas(JSON.parse(JSON.stringify(out))).payload)
      assert.eq(clean.blocks.f.type, 'custom')
      assert.eq(clean.blocks.f.typeHint, 'roadmap')
    } finally { Object.assign(state, before) }
  })

  it('an empty title reads back empty, not "(untitled)"', () => {
    const { payload } = fromJsonCanvas({ nodes: [{ id: 'u', type: 'text', x: 0, y: 0, color: '#a78bfa', pathfinderType: 'goal', text: '#### (untitled)' }], edges: [] })
    assert.eq(payload.blocks[0].title, '')
  })
})

// ── Mermaid ─────────────────────────────────────────────────

describe('Mermaid: typed shapes and classes', () => {
  it('mermaidShapeFor gives conventional shapes, rectangles otherwise', () => {
    assert.deepEq(mermaidShapeFor('decision'), ['{', '}'])
    assert.deepEq(mermaidShapeFor('terminator'), ['([', '])'])
    assert.deepEq(mermaidShapeFor('resource'), ['[(', ')]'])
    assert.deepEq(mermaidShapeFor('goal'), ['[', ']'])
    assert.deepEq(mermaidShapeFor('nope'), ['[', ']'])
  })

  it('toMermaid declares every block, isolated ones too, and all 16 types read back', () => {
    const blocks = oneOfEachType()
    blocks.t0.title = 'Quote " and arrow --> and | pipe'
    const arrows = [{ id: 'a', from: 't0', to: 't1', label: 'feeds' }, { id: 'b', from: 't2', to: 't3', bidirectional: true, pattern: 'dashed' }]
    const text = toMermaid({ blocks, arrows, groups: {} })
    assert.match(text, /^flowchart LR\n/)
    Object.keys(blocks).forEach((_, i) => assert.match(text, new RegExp(`\\n  n${i + 1}[\\[({>]`), `node n${i + 1} is declared`))
    assert.includes(text, 'n1 -->|"feeds"| n2')
    assert.includes(text, 'n3 <-.-> n4')
    const { payload, lowConfidence } = parseMermaid(text)
    assert.eq(payload.blocks.length, Object.keys(TYPES).length, 'isolated blocks survive')
    assert.eq(lowConfidence.length, 0)
    const types = payload.blocks.map(b => b.type).sort()
    assert.deepEq(types, Object.keys(TYPES).sort())
    const first = payload.blocks.find(b => b.id === 'n1')
    assert.eq(first.title, 'Quote " and arrow --> and | pipe', 'quoted text holds arrows and pipes')
    const back = payload.arrows.find(a => a.from === 'n3')
    assert.eq(back.bidirectional, true)
    assert.eq(back.pattern, 'dashed')
  })

  it('groups become subgraphs and come back as groups', () => {
    const blocks = { a: normalizeBlock({ id: 'a', type: 'goal', title: 'In', groupId: 'g' }), b: normalizeBlock({ id: 'b', type: 'risk', title: 'Out' }) }
    const text = toMermaid({ blocks, arrows: [], groups: { g: { id: 'g', label: 'Phase 1' } } })
    const { payload } = parseMermaid(text)
    assert.eq(payload.groups.length, 1)
    assert.eq(payload.groups[0].label, 'Phase 1')
    assert.eq(payload.blocks.find(x => x.title === 'In').groupId, payload.groups[0].id)
    assert.eq(payload.blocks.find(x => x.title === 'Out').groupId, null)
  })

  it('a foreign class is ignored; shapes without a strong convention are flagged', () => {
    const { payload } = parseMermaid('flowchart TD\n  a[["Wire the scheduler"]]:::important --> b[(Warehouse)]\n  class a important')
    const a = payload.blocks.find(x => x.id === 'a'), b = payload.blocks.find(x => x.id === 'b')
    assert.eq(b.type, 'resource', 'a cylinder is a store')
    assert.ok(!b.typeCheck)
    if (categorizeLine('Wire the scheduler').confidence !== 'high') {
      assert.eq(a.type, 'implementation', 'a subroutine box hints implementation')
      assert.eq(a.typeCheck, true)
    }
  })
})

// ── Compressed links ────────────────────────────────────────

describe('Share links: #z= compressed, #s= still read', () => {
  it('the browser under test can compress links', () => {
    assert.ok(canCompressLinks())
    assert.ok(isShareHash('#z=abc') && isShareHash('#s=abc') && !isShareHash('#t=abc'))
  })

  it('a #z= link round-trips the canvas exactly', () => sandbox(async () => {
    const c = templateCanvas('Investigate a Bug')
    state.blocks = c.blocks; state.arrows = c.arrows; state.groups = c.groups
    canvasMeta.title = 'Round trip'
    const url = await buildShareUrlAsync()
    assert.includes(url, '#z=')
    const decoded = await decodeShareHash(url.slice(url.indexOf('#')))
    const a = normalizeCanvas(JSON.parse(JSON.stringify(serializeCanvas())))
    const b = normalizeCanvas(decoded)
    assert.deepEq(b.blocks, a.blocks)
    assert.deepEq(b.arrows, a.arrows)
    assert.deepEq(b.meta, a.meta)
  }))

  it('a #z= link is several times shorter than the #s= one', () => sandbox(async () => {
    const c = templateCanvas('Migrate a System')
    state.blocks = c.blocks; state.arrows = c.arrows; state.groups = c.groups
    const legacy = 's=' + btoa(encodeURIComponent(JSON.stringify(serializeCanvas())))
    const z = (await buildShareUrlAsync()).split('#')[1]
    assert.ok(z.startsWith('z='))
    assert.gt(legacy.length / z.length, 4, `expected at least 4x smaller, got ${legacy.length} vs ${z.length}`)
  }))

  it('the share serializer drops blank fields but normalizes to the same canvas', () => sandbox(() => {
    state.blocks = { a: normalizeBlock({ id: 'a', type: 'goal', title: 'A' }), b: normalizeBlock({ id: 'b', type: 'risk', title: 'B', color: '#123456' }) }
    state.arrows = [normalizeArrow({ id: 'x', from: 'a', to: 'b', label: '' })]
    state.groups = {}
    const shared = serializeForShare()
    assert.ok(!('color' in shared.blocks.a), 'null colour dropped')
    assert.ok(!('collapsed' in shared.blocks.a), 'false collapsed dropped')
    assert.ok(!('questions' in shared.blocks.a), 'empty list dropped')
    assert.eq(shared.blocks.b.color, '#123456', 'a real value stays')
    assert.eq(shared.arrows[0].label, '', "an empty label is kept, since '' and none normalize differently")
    const a = normalizeCanvas(JSON.parse(JSON.stringify(serializeCanvas())))
    const b = normalizeCanvas(JSON.parse(JSON.stringify(shared)))
    assert.deepEq(b.blocks, a.blocks)
    assert.deepEq(b.arrows, a.arrows)
    assert.deepEq(b.meta, a.meta)
  }))

  it('the synchronous link is #s= while the cache is stale and #z= once primed', () => sandbox(async () => {
    state.blocks = { a: normalizeBlock({ id: 'a', type: 'goal', title: 'Fresh ' + Math.random() }) }
    state.arrows = []; state.groups = {}
    const stale = buildShareUrl(false)
    assert.includes(stale, '#s=')
    const data = await decodeShareHash(stale.slice(stale.indexOf('#')))
    assert.eq(Object.values(data.blocks)[0].title, state.blocks.a.title, 'the fallback still carries the canvas')
    await primeShareLink()
    assert.includes(buildShareUrl(true), '?readonly&via=share#z=')
    assert.includes(buildEmbedUrl(), '?embed&readonly&via=embed#z=')
  }))

  it('a damaged or oversized #z= link is refused', async () => {
    let threw = false
    try { await decodeShareHash('#z=AAAA') } catch (_) { threw = true }
    assert.ok(threw, 'garbage does not decode')
    const bomb = await compressText('0'.repeat(8_100_000))
    assert.lt(bomb.length, 20_000)
    threw = false
    try { await decompressText(bomb) } catch (e) { threw = /too large/.test(e.message) }
    assert.ok(threw, 'inflating stops at the cap')
  })

  it('a view-only #z= link loads in memory, keeps its URL and saves nothing', () => sandbox(async () => {
    localStorage.setItem('pathfinder-v1', 'private document')
    ui.readOnly = true
    const hash = '#z=' + await compressText(JSON.stringify(SHARED))
    history.replaceState(null, '', '?readonly' + hash)
    const pending = checkShareUrl()
    assert.ok(pending && typeof pending.then === 'function', 'inflating is asynchronous')
    assert.eq(await pending, true)
    assert.ok(state.blocks.shared && state.blocks.task)
    assert.eq(location.hash, hash)
    assert.eq(localStorage.getItem('pathfinder-v1'), 'private document')
    assert.eq(incomingDialog(), null, 'a view-only link never asks')
  }))
})

// ── Link and import safety ─────────────────────────────────

describe('Incoming canvases open as a new map by default', () => {
  it('a link on a map with content asks first and overwrites nothing while it asks', () => sandbox(async () => {
    const mine = seedPrivate()
    const savedBefore = localStorage.getItem('pathfinder-v1')
    history.replaceState(null, '', '?theme=x#s=' + btoa(encodeURIComponent(JSON.stringify(SHARED))))
    assert.eq(checkShareUrl(), true)
    const dlg = incomingDialog()
    assert.ok(dlg && dlg.open, 'a dialog is open')
    assert.eq(dlg.tagName, 'DIALOG')
    assert.ok(dlg.hasAttribute('data-canvas-ui'))
    const buttons = [...dlg.querySelectorAll('[data-choice]')]
    assert.deepEq(buttons.map(b => b.dataset.choice), ['new', 'replace', 'merge', 'cancel'])
    assert.ok(buttons.every(b => b.tagName === 'BUTTON' && b.textContent.trim()), 'real, labelled buttons')
    assert.eq(buttons[0].textContent.trim(), 'Open as a new map')
    assert.eq(document.activeElement, buttons[0], 'the safe choice has focus')
    assert.includes(dlg.textContent, 'Teammate map')
    assert.includes(dlg.textContent, 'Private map')
    assert.ok(state.blocks.private && !state.blocks.shared, 'the open map is untouched while asking')
    assert.eq(localStorage.getItem('pathfinder-v1'), savedBefore)

    buttons[0].click()
    await tick()
    assert.neq(currentId(), mine, 'a new map is current')
    assert.ok(state.blocks.shared && !state.blocks.private)
    assert.ok(JSON.parse(localStorage.getItem('pathfinder-map-' + mine)).blocks.private, 'the old map kept its content')
    assert.eq(JSON.parse(localStorage.getItem('pathfinder-v1')).meta.title, 'Teammate map')
    assert.eq(location.hash, '', 'the link is spent')
    assert.eq(location.search, '?theme=x')
    assert.eq(getUndoHistory().length, 0, 'undo never crosses maps')
    assert.eq(incomingDialog(), null)
  }))

  it('Replace keeps a named snapshot first, and one undo brings the map back', () => sandbox(async () => {
    seedPrivate()
    history.replaceState(null, '', '#s=' + btoa(encodeURIComponent(JSON.stringify(SHARED))))
    checkShareUrl()
    incomingDialog().querySelector('[data-choice="replace"]').click()
    await tick()
    assert.ok(state.blocks.shared && !state.blocks.private)
    const snap = listSnapshots().at(-1)
    assert.eq(snap.name, 'Before loading shared link')
    assert.ok(snap.payload.blocks.private, 'the snapshot holds the replaced map')
    undo()
    assert.ok(state.blocks.private && !state.blocks.shared, 'one undo step')
  }))

  it('Merge adds the incoming blocks as one undo step', () => sandbox(async () => {
    seedPrivate()
    const pending = openIncoming(SHARED, { source: 'link' })
    incomingDialog().querySelector('[data-choice="merge"]').click()
    const r = await pending
    assert.eq(r.mode, 'merge')
    assert.eq(r.imported, 2)
    assert.eq(Object.keys(state.blocks).length, 3)
    assert.ok(state.blocks.private)
    undo()
    assert.deepEq(Object.keys(state.blocks), ['private'])
  }))

  it('Cancel and Escape change nothing and keep the link for a reload', () => sandbox(async () => {
    seedPrivate()
    const hash = '#s=' + btoa(encodeURIComponent(JSON.stringify(SHARED)))
    history.replaceState(null, '', hash)
    checkShareUrl()
    incomingDialog().querySelector('[data-choice="cancel"]').click()
    await tick()
    assert.ok(state.blocks.private && !state.blocks.shared)
    assert.eq(location.hash, hash)
    const pending = openIncoming(SHARED, { source: 'link' })
    incomingDialog().dispatchEvent(new Event('cancel', { cancelable: true }))
    assert.eq(await pending, null, 'Escape is Cancel')
    assert.ok(state.blocks.private && !state.blocks.shared)
  }))

  it('an empty map takes the canvas directly, with no dialog', () => sandbox(async () => {
    state.blocks = {}; state.arrows = []; state.groups = {}
    canvasMeta.title = ''; canvasMeta.contextBrief = ''
    assert.eq(hasContent(), false)
    const r = await openIncoming(SHARED, { source: 'link' })
    assert.eq(incomingDialog(), null)
    assert.eq(r.mode, 'replace')
    assert.ok(state.blocks.shared)
  }))

  it('a file import offers the same choice under its own name', () => sandbox(async () => {
    const mine = seedPrivate()
    const pending = openIncoming(SHARED, { source: 'file', name: 'plan.canvas' })
    assert.eq(incomingDialog().querySelector('.incoming-title').textContent, 'Import plan.canvas')
    incomingDialog().querySelector('[data-choice="new"]').click()
    const r = await pending
    assert.eq(r.mode, 'new')
    assert.neq(currentId(), mine)
    assert.includes(incomingMessage(r), 'as a new map')
  }))

  it('a file opened as a new map is named after the file, not "Untitled map" (QA)', () => sandbox(async () => {
    seedPrivate()
    const untitled = { ...SHARED, meta: {} }
    const pending = openIncoming(untitled, { source: 'file', name: 'synthetic.canvas' })
    incomingDialog().querySelector('[data-choice="new"]').click()
    const r = await pending
    assert.eq(r.mode, 'new')
    assert.eq(canvasMeta.title, 'synthetic', 'the new map carries the file name')
    const names = JSON.parse(localStorage.getItem('pathfinder-maps') || '[]').map(m => m.name)
    assert.includes(names, 'synthetic', 'and the Maps menu lists it by that name')
  }))

  it('an untitled link is a dated "Shared map"; a titled canvas keeps its own title (QA)', () => {
    const when = new Date(2026, 8, 28)
    const named = withMapName({ blocks: {} }, { source: 'link', now: when })
    assert.match(named.meta.title, /^Shared map, /)
    assert.eq(withMapName({ ...SHARED }, { source: 'file', name: 'x.json' }).meta.title, 'Teammate map')
    assert.eq(withMapName({ meta: { title: '  ' } }, { source: 'file', name: 'plan.v2.json' }).meta.title, 'plan.v2')
  })

  it('incoming titles are text, never markup', () => sandbox(async () => {
    seedPrivate()
    const evil = { ...SHARED, meta: { title: '<img src=x id=pwned>' } }
    const pending = openIncoming(evil, { source: 'link' })
    const dlg = incomingDialog()
    assert.includes(dlg.textContent, '<img src=x id=pwned>')
    assert.eq(dlg.querySelector('img'), null)
    dlg.querySelector('[data-choice="cancel"]').click()
    await pending
  }))

  it('?src= asks too, and keeps src in the URL until a choice is made', () => sandbox(async () => {
    seedPrivate()
    window.fetch = async () => ({ ok: true, text: async () => JSON.stringify(SHARED) })
    history.replaceState(null, '', '?src=%2Fshared.json&theme=x')
    const done = checkSrcUrl()
    const dlg = await waitFor(() => incomingDialog())
    assert.ok(dlg, 'the dialog opened')
    assert.eq(dlg.querySelector('.incoming-title').textContent, 'Open the linked map')
    assert.eq(new URLSearchParams(location.search).get('src'), '/shared.json')
    dlg.querySelector('[data-choice="new"]').click()
    await done
    assert.eq(new URLSearchParams(location.search).get('src'), null)
    assert.eq(new URLSearchParams(location.search).get('theme'), 'x')
    assert.ok(state.blocks.shared)
  }))

  it('a link pasted into an open tab is read through the same choice', () => sandbox(async () => {
    setupSharingSafety()
    seedPrivate()
    location.hash = '#s=' + btoa(encodeURIComponent(JSON.stringify(SHARED)))
    const dlg = await waitFor(() => incomingDialog())
    assert.ok(dlg, 'hashchange opened the dialog')
    assert.ok(state.blocks.private && !state.blocks.shared, 'nothing replaced while it asks')
  }))

  it('?src= can point at a JSON Canvas file', () => sandbox(async () => {
    state.blocks = {}; state.arrows = []; state.groups = {}
    canvasMeta.title = ''; canvasMeta.contextBrief = ''
    window.fetch = async () => ({ ok: true, text: async () => JSON.stringify(USER_CANVAS) })
    history.replaceState(null, '', '?src=%2Fuser.canvas')
    await checkSrcUrl()
    assert.eq(Object.keys(state.blocks).length, 11)
    assert.eq(state.blocks.rptdemow8.type, 'process')
  }))
})

// ── Another tab ─────────────────────────────────────────────

describe('Another tab changing the same map', () => {
  it("only storage events for this tab's map count", () => sandbox(() => {
    const mine = seedPrivate()
    const other = JSON.stringify({ blocks: {}, arrows: [], meta: { title: 'Other' } })
    assert.ok(touchesThisMap({ key: 'pathfinder-map-' + mine, storageArea: localStorage, newValue: other }))
    assert.ok(touchesThisMap({ key: 'pathfinder-map-' + mine, storageArea: localStorage, newValue: null }), 'deleted in another tab')
    assert.ok(touchesThisMap({ key: null, storageArea: localStorage }), 'storage cleared')
    assert.ok(!touchesThisMap({ key: 'pathfinder-map-someone-else', storageArea: localStorage, newValue: other }), "another map's slot")
    assert.ok(!touchesThisMap({ key: 'pathfinder-v1', storageArea: localStorage, newValue: other }),
      'every tab writes pathfinder-v1 for whichever map it has open')
    assert.ok(!touchesThisMap({ key: 'pathfinder-map-current', storageArea: localStorage, newValue: 'x' }),
      'the pointer moving is not this map changing')
    assert.ok(!touchesThisMap({ key: 'pathfinder-prefs', storageArea: localStorage }))
    assert.ok(!touchesThisMap({ key: 'pathfinder-map-' + mine, storageArea: sessionStorage, newValue: other }))
    // Without a library (no map id), pathfinder-v1 is the only copy.
    localStorage.removeItem('pathfinder-map-current')
    assert.eq(currentId(), null)
    assert.ok(touchesThisMap({ key: 'pathfinder-v1', storageArea: localStorage, newValue: other }))
  }))

  it('a second tab saving what this tab shows is not a change; a different title is', () => sandbox(() => {
    const mine = seedPrivate()
    const key = 'pathfinder-map-' + mine
    const same = JSON.stringify(serializeCanvas())
    assert.ok(!touchesThisMap({ key, storageArea: localStorage, newValue: same }))
    assert.ok(!touchesThisMap({ key, storageArea: localStorage, newValue: same + ' ' }), 'bytes differ, meaning does not')
    const edited = JSON.parse(same); edited.meta.title = 'Renamed elsewhere'
    assert.ok(touchesThisMap({ key, storageArea: localStorage, oldValue: same, newValue: JSON.stringify(edited) }))
  }))

  it('raises an alert banner with real buttons, and Keep editing dismisses it', () => sandbox(() => {
    const mine = seedPrivate()
    setupSharingSafety()
    window.dispatchEvent(new StorageEvent('storage', { key: 'pathfinder-prefs', storageArea: localStorage }))
    assert.eq(document.getElementById('otherTabBanner'), null, 'unrelated keys are ignored')
    window.dispatchEvent(new StorageEvent('storage', { key: 'pathfinder-map-' + mine, storageArea: localStorage, newValue: '{}' }))
    const el = document.getElementById('otherTabBanner')
    assert.ok(el, 'the banner is up')
    assert.eq(el.getAttribute('role'), 'alert')
    assert.ok(el.hasAttribute('data-canvas-ui'))
    const buttons = [...el.querySelectorAll('button')]
    assert.deepEq(buttons.map(b => b.textContent), ['Reload', 'Keep editing here'])
    buttons[1].click()
    assert.eq(document.getElementById('otherTabBanner'), null)
  }))

  it('never shows in a view-only or embedded page', () => sandbox(() => {
    ui.readOnly = true
    assert.eq(showOtherTabBanner(), null)
    window.dispatchEvent(new StorageEvent('storage', { key: 'pathfinder-v1', storageArea: localStorage }))
    assert.eq(document.getElementById('otherTabBanner'), null)
  }))
})

// ── Backups ─────────────────────────────────────────────────

describe('Backup status and the export reminder', () => {
  it('says never, today, or how many days ago', () => {
    const now = Date.UTC(2026, 8, 28, 12)
    assert.eq(backupStatusText(null, now), 'Backed up: never')
    assert.eq(backupStatusText(now - 3600_000, now), 'Backed up: today')
    assert.eq(backupStatusText(now - DAY - 1, now), 'Backed up: 1 day ago')
    assert.eq(backupStatusText(now - 12 * DAY, now), 'Backed up: 12 days ago')
  })

  it('Export all records a backup, and the status line reports it', () => sandbox(() => {
    seedPrivate()
    const click = HTMLAnchorElement.prototype.click
    const host = document.createElement('span')
    host.id = 'backupStatus'; host.hidden = true
    document.body.appendChild(host)
    try {
      writeBackup({ all: null, maps: {}, since: Date.now(), nagAt: null })
      refreshBackupStatus()
      assert.eq(host.hidden, false)
      assert.eq(host.querySelector('.backup-text').textContent, 'Backed up: never')
      const btn = host.querySelector('button')
      assert.eq(btn.textContent, 'Export all')
      HTMLAnchorElement.prototype.click = function () {}
      exportAllMaps()
      assert.ok(Date.now() - lastBackupAt() < 5000, 'recorded just now')
      assert.eq(readBackup().all, lastBackupAt(), 'stamped as an Export all too')
      refreshBackupStatus()
      assert.eq(host.querySelector('.backup-text').textContent, 'Backed up: today')
      ui.readOnly = true
      refreshBackupStatus()
      assert.eq(host.hidden, true, 'hidden in view-only pages')
    } finally {
      HTMLAnchorElement.prototype.click = click
      host.remove()
    }
  }))

  it('Download JSON counts as a backup of that map only', () => sandbox(() => {
    const mine = seedPrivate()
    setupSharingSafety()
    writeBackup({ all: null, maps: {}, since: Date.now(), nagAt: null })
    const btn = document.createElement('button')
    btn.id = 'exportJSON'
    document.body.appendChild(btn)
    try { btn.click() } finally { btn.remove() }
    const b = readBackup()
    assert.eq(b.all, null, 'the other maps are not backed up by it')
    assert.ok(Date.now() - b.maps[mine] < 5000)
    assert.eq(lastBackupAt(mine), b.maps[mine])
  }))

  it('a map changing after a week without an export nags once', () => sandbox(() => {
    seedPrivate()
    const now = Date.now()
    writeBackup({ all: now - 8 * DAY, maps: { [currentId()]: now - 8 * DAY }, since: now - 30 * DAY, nagAt: null })
    resetBackupNag()
    assert.ok(backupStale(now))
    assert.eq(maybeNagBackup(now), true)
    assert.eq(maybeNagBackup(now), false, 'once per session')
    resetBackupNag()
    assert.eq(maybeNagBackup(now + DAY), false, 'and not again within the week')
    assert.ok(readBackup().nagAt)
    writeBackup({ all: now - DAY, maps: { [currentId()]: now - DAY }, since: now - 30 * DAY, nagAt: null })
    resetBackupNag()
    assert.ok(!backupStale(now))
    assert.eq(maybeNagBackup(now), false, 'a recent export is enough')
    resetBackupNag()
  }))

  it('a map never exported is only nagged once tracking is a week old', () => sandbox(() => {
    seedPrivate()
    const now = Date.now()
    writeBackup({ all: null, maps: {}, since: now - 2 * DAY, nagAt: null })
    assert.ok(!backupStale(now))
    writeBackup({ all: null, maps: {}, since: now - 8 * DAY, nagAt: null })
    assert.ok(backupStale(now))
    writeBackup({ all: now - DAY, maps: { other: now - DAY }, since: now - 30 * DAY, nagAt: null })
    assert.ok(!backupStale(now), 'a map made after the last Export all counts from that export')
    assert.eq(lastBackupAt(), null, 'but it was never exported itself')
    ui.readOnly = true
    resetBackupNag()
    assert.eq(maybeNagBackup(now), false, 'never in a view-only page')
    resetBackupNag()
  }))

  it('asks for persistent storage, once, and copes without the API', async () => {
    let asked = 0
    assert.eq(await requestPersistence({ persisted: async () => false, persist: async () => { asked++; return true } }), true)
    assert.eq(asked, 1)
    assert.eq(await requestPersistence({ persisted: async () => true, persist: async () => { asked++; return true } }), true)
    assert.eq(asked, 1, 'already persistent: no second request')
    assert.eq(await requestPersistence({}), null)
    assert.eq(await requestPersistence({ persist: async () => { throw new Error('denied') } }), null)
  })
})

// ── Review ──────────────────────────────────────────────────

describe('Review notes are durable', () => {
  const withReview = async fn => {
    const saved = { notes: review.notes, sent: review.sent, key: review.key }
    const before = { blocks: state.blocks }
    try { review.notes = []; review.sent = 0; review.key = 'pathfinder-review:test-' + Math.random(); await fn() }
    finally {
      try { sessionStorage.removeItem(review.key) } catch (_) {}
      Object.assign(review, saved)
      state.blocks = before.blocks
    }
  }

  it('the key follows the link: same link, same notes; another link, other notes', () => {
    const a = reviewKey({ hash: '#z=abc', search: '?readonly', pathname: '/' })
    assert.eq(a, reviewKey({ hash: '#z=abc', search: '?readonly', pathname: '/' }))
    assert.neq(a, reviewKey({ hash: '#z=abd', search: '?readonly', pathname: '/' }))
    assert.neq(reviewKey({ hash: '', search: '?readonly&src=%2Fa.json', pathname: '/' }),
               reviewKey({ hash: '', search: '?readonly&src=%2Fb.json', pathname: '/' }))
    assert.ok(a.startsWith('pathfinder-review:') && a.length < 40)
  })

  it('notes written survive a reload of the same tab', () => withReview(() => {
    const notes = [{ block: 'b1', title: 'A', text: 'tighten this' }]
    assert.ok(saveReviewNotes(review.key, notes, 0))
    assert.deepEq(loadReviewNotes(review.key), { notes, sent: 0 })
    saveReviewNotes(review.key, [], 0)
    assert.eq(sessionStorage.getItem(review.key), null, 'no notes, no key')
  }))

  it('notes stay unsent until copied, and removing the last one is possible', () => withReview(() => {
    state.blocks = { b1: normalizeBlock({ id: 'b1', type: 'goal', title: 'A' }) }
    assert.eq(addReviewNote('missing', 'x'), null, 'a note needs a block')
    addReviewNote('b1', 'first'); addReviewNote('b1', 'second')
    assert.ok(hasUnsentNotes())
    assert.eq(loadReviewNotes(review.key).notes.length, 2, 'written through to the tab')
    review.sent = 2
    assert.ok(!hasUnsentNotes(), 'copied: nothing to warn about')
    assert.eq(removeLastReviewNote().text, 'second')
    assert.eq(review.sent, 1)
    assert.eq(loadReviewNotes(review.key).notes.length, 1)
  }))

  it('a reviewed block carries a count badge with an accessible name', () => withReview(() => {
    review.notes = [{ block: 'b1', title: 'A', text: 'one' }, { block: 'b1', title: 'A', text: 'two' }]
    const el = document.createElement('div')
    paintReviewDot({ id: 'b1' }, el)
    const dot = el.querySelector('.review-dot')
    assert.ok(dot)
    assert.eq(dot.textContent, '2')
    assert.eq(dot.getAttribute('role'), 'img')
    assert.eq(dot.getAttribute('aria-label'), '2 review notes')
    assert.includes(dot.title, 'one')
    paintReviewDot({ id: 'b2' }, el)
    assert.eq(el.querySelectorAll('.review-dot').length, 0, 'repainting a block without notes clears it')
  }))
})


// ── Review of the stream (2026-09-28): one test per confirmed defect ──

const slot = id => JSON.parse(localStorage.getItem('pathfinder-map-' + id) || 'null')
const pointerEvent = (oldValue, newValue) =>
  new StorageEvent('storage', { key: 'pathfinder-map-current', storageArea: localStorage, oldValue, newValue })

describe('Two tabs: no false alarm, and saves stay on their own map', () => {
  it('a second tab only opening this map (and saving it normalized) raises no banner', () => sandbox(() => {
    const mine = seedPrivate()
    // Blocks made through the app's creation paths lack the fields
    // normalize adds (criteria, rationale), so the other tab's load-time
    // save differs in bytes and nothing else.
    state.blocks.raw = { id: 'raw', type: 'goal', title: 'Made here', x: 300, y: 0 }
    saveState(); writeThrough()
    const oldValue = localStorage.getItem('pathfinder-map-' + mine)
    const { dropped, ...clean } = normalizeCanvas(JSON.parse(oldValue))
    const newValue = JSON.stringify(clean)
    assert.neq(newValue, oldValue, 'the fixture really differs in bytes')
    const key = 'pathfinder-map-' + mine
    assert.ok(!touchesThisMap({ key, storageArea: localStorage, oldValue, newValue }))
    assert.ok(!touchesThisMap({ key, storageArea: localStorage, newValue }), 'same meaning as this tab shows')
    setupSharingSafety()
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage, oldValue, newValue }))
    assert.eq(document.getElementById('otherTabBanner'), null)
  }))

  it("another tab opening a link as a new map leaves this tab's saves on this tab's map", () => sandbox(() => {
    forgetTabMap()
    const mine = seedPrivate()
    // Tab B opens a teammate's link as a new map: its slot, STORAGE_KEY and
    // the shared pointer now name the teammate map.
    localStorage.setItem('pathfinder-map-teammate', JSON.stringify(SHARED))
    localStorage.setItem('pathfinder-v1', JSON.stringify(SHARED))
    localStorage.setItem('pathfinder-map-current', 'teammate')
    try {
      assert.eq(notePointerMove(pointerEvent(mine, 'teammate')), true)
      assert.eq(currentId(), mine, 'this tab still has its own map open')
      assert.ok(!touchesThisMap({ key: 'pathfinder-map-teammate', storageArea: localStorage, newValue: JSON.stringify(SHARED) }),
        "B's map changing is not this map changing")
      // This tab keeps editing and saves.
      state.blocks.private.title = 'Edited in A'
      saveState(); writeThrough()
      assert.eq(slot(mine).blocks.private.title, 'Edited in A', 'the edit went to this map')
      assert.eq(slot('teammate').meta.title, 'Teammate map', "the teammate's map is untouched")
      assert.ok(!slot('teammate').blocks.private)
      // STORAGE_KEY now holds this map, so the pointer names it again: a
      // load anywhere pairs the canvas with its own slot.
      assert.eq(localStorage.getItem('pathfinder-map-current'), mine)
      assert.eq(JSON.parse(localStorage.getItem('pathfinder-v1')).blocks.private.title, 'Edited in A')
    } finally { forgetTabMap() }
  }))

  it("the pointer coming back to this tab's map, or a same-page write, is not a move", () => sandbox(() => {
    forgetTabMap()
    const mine = seedPrivate()
    try {
      assert.eq(notePointerMove(pointerEvent(mine, 'x')), true)
      assert.eq(notePointerMove(pointerEvent('x', mine)), false)
      assert.eq(currentId(), mine)
      assert.eq(notePointerMove({ key: 'pathfinder-prefs', storageArea: localStorage }), false)
      // A write in this page fires no storage event here, so it is followed.
      localStorage.setItem('pathfinder-map-current', 'written-here')
      assert.eq(currentId(), 'written-here')
    } finally { forgetTabMap() }
  }))

  it("Reload from the banner reopens this tab's map as the other tab left it", () => sandbox(() => {
    forgetTabMap()
    const mine = seedPrivate()
    try {
      const theirs = JSON.parse(JSON.stringify(serializeCanvas()))
      theirs.meta.title = 'Saved by the other tab'
      localStorage.setItem('pathfinder-map-' + mine, JSON.stringify(theirs))
      // ...which then moved on to a map of its own.
      localStorage.setItem('pathfinder-v1', JSON.stringify(SHARED))
      localStorage.setItem('pathfinder-map-current', 'elsewhere')
      notePointerMove(pointerEvent(mine, 'elsewhere'))
      assert.eq(pointAtThisMap(), true)
      assert.eq(localStorage.getItem('pathfinder-map-current'), mine)
      assert.eq(JSON.parse(localStorage.getItem('pathfinder-v1')).meta.title, 'Saved by the other tab')
    } finally { forgetTabMap() }
  }))
})

describe('The incoming dialog holds the keyboard', () => {
  it('keys pressed in the dialog never reach the canvas shortcuts', () => sandbox(async () => {
    seedPrivate()
    selection.ids.clear(); selection.ids.add('private'); selection.blockId = 'private'
    const pending = openIncoming(SHARED, { source: 'file', name: 'x.json' })
    const dlg = incomingDialog()
    const reached = []
    const spy = e => reached.push(e.key)
    document.addEventListener('keydown', spy)
    try {
      ;['Backspace', 'Delete', 'z', 'l'].forEach(key =>
        dlg.querySelector('.incoming-primary').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
      dlg.querySelector('.incoming-primary').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }))
    } finally { document.removeEventListener('keydown', spy) }
    assert.deepEq(reached, [], 'the document never saw them')
    assert.ok(state.blocks.private, 'the selected block is still there')
    assert.ok(incomingDialog(), 'the dialog is still asking')
    dlg.querySelector('[data-choice="cancel"]').click()
    await pending
    selection.ids.clear(); selection.blockId = null
  }))
})

describe('Undo of a replace restores the whole map', () => {
  const TEAM = { blocks: { shared: { id: 'shared', type: 'goal', title: 'Shared goal' } }, arrows: [],
    meta: { title: 'Teammate map', contextBrief: 'THEIR BRIEF', cardStyle: 'plain', situation: { codebase: 'greenfield' }, prompt: { mode: 'investigate' } } }
  const framing = () => ({ title: canvasMeta.title, brief: canvasMeta.contextBrief, card: canvasMeta.cardStyle,
    codebase: canvasMeta.situation?.codebase, mode: devOpts.mode })
  const replaceWith = async data => {
    const pending = openIncoming(data, { source: 'link' })
    incomingDialog().querySelector('[data-choice="replace"]').click()
    return pending
  }
  const mineFraming = () => {
    seedPrivate()
    canvasMeta.contextBrief = 'MY BRIEF'; canvasMeta.cardStyle = 'outline'
    canvasMeta.situation = { ...canvasMeta.situation, codebase: 'current' }
    devOpts.mode = 'plan'
    saveStatus.phase = 'idle'
    return framing()
  }

  it('one undo brings back the title, brief, card style, situation and prompt mode', () => sandbox(async () => {
    const mine = mineFraming()
    await replaceWith(TEAM)
    const theirs = framing()
    assert.deepEq(theirs, { title: 'Teammate map', brief: 'THEIR BRIEF', card: 'plain', codebase: 'greenfield', mode: 'investigate' })
    undo()
    assert.ok(state.blocks.private && !state.blocks.shared, 'blocks restored')
    assert.deepEq(framing(), mine, 'framing restored with the blocks')
    redo()
    assert.ok(state.blocks.shared && !state.blocks.private)
    assert.deepEq(framing(), theirs, 'redo brings the incoming framing back')
    undo()
    assert.deepEq(framing(), mine, 'and undo again')
  }))

  it('undoing a later edit first leaves the framing alone until the replace itself is undone', () => sandbox(async () => {
    const mine = mineFraming()
    await replaceWith(TEAM)
    snapshot(); state.blocks.shared.title = 'Edited after'; saveState()
    undo()
    assert.eq(state.blocks.shared.title, 'Shared goal')
    assert.eq(canvasMeta.title, 'Teammate map', 'still the replaced map')
    undo()
    assert.deepEq(framing(), mine)
  }))

  it('a new edit after the undo does not bring the incoming framing back', () => sandbox(async () => {
    const mine = mineFraming()
    await replaceWith(TEAM)
    undo()
    snapshot(); state.blocks.private.title = 'New work'; saveState()
    assert.deepEq(framing(), mine)
    assert.eq(getRedoFuture().length, 0)
  }))

  it('two replaces in a row each restore their own framing', () => sandbox(async () => {
    const mine = mineFraming()
    await replaceWith(TEAM)
    await replaceWith({ ...TEAM, blocks: { second: { id: 'second', type: 'risk', title: 'Second' } }, meta: { title: 'Second map', cardStyle: 'bar' } })
    assert.eq(canvasMeta.title, 'Second map')
    undo()
    assert.eq(canvasMeta.title, 'Teammate map')
    assert.eq(canvasMeta.cardStyle, 'plain')
    undo()
    assert.deepEq(framing(), mine)
  }))
})

describe('JSON Canvas: a recoloured block keeps its type', () => {
  const exportOne = block => {
    const saved = { blocks: state.blocks, arrows: state.arrows, groups: state.groups }
    state.blocks = { [block.id]: block }; state.arrows = []; state.groups = {}
    try { return JSON.parse(JSON.stringify(toJsonCanvas())) } finally { Object.assign(state, saved) }
  }

  it('an override equal to another type colour is written one step off it, exact copy alongside', () => {
    const risk = normalizeBlock({ id: 'r1', type: 'risk', title: 'Vendor lock-in', color: '#f87171', x: 0, y: 0 })
    const node = exportOne(risk).nodes[0]
    assert.eq(typeForHex(node.color), null, `the written colour ${node.color} is no type's`)
    assert.eq(node.color.slice(0, 5), '#f871', 'same red and green')
    assert.lt(Math.abs(parseInt(node.color.slice(5), 16) - 0x71), 4, 'blue moved by a step or two')
    assert.eq(node.pathfinderColor, '#f87171')
    // Our own round trip is exact.
    const back = fromJsonCanvas({ nodes: [node], edges: [] }).payload.blocks[0]
    assert.eq(back.type, 'risk')
    assert.eq(back.color, '#f87171')
  })

  it('a tool that keeps only spec fields never reads it as the colour-owning type', () => {
    const risk = normalizeBlock({ id: 'r1', type: 'risk', title: 'Vendor lock-in', color: '#f87171', x: 0, y: 0 })
    const { pathfinderType, pathfinderColor, ...node } = exportOne(risk).nodes[0]
    const back = fromJsonCanvas({ nodes: [node], edges: [] }).payload.blocks[0]
    assert.ok(!(back.type === 'problem' && !back.typeCheck), `not silently a Problem (got ${back.type}, typeCheck ${!!back.typeCheck})`)
    if (categorizeLine('Vendor lock-in').type === 'risk') assert.eq(back.type, 'risk')
    assert.eq(back.color, node.color, 'the colour survives as an override')
  })

  it('every swatch on every type: no written colour belongs to another type', () => {
    Object.keys(TYPES).forEach(type => SWATCH_COLORS.forEach(color => {
      const [written] = exportColorFor(color, type)
      const owner = typeForHex(written)
      assert.ok(!owner || owner === type, `${color} on ${type} was written as ${written}, ${owner}'s hex`)
    }))
    assert.deepEq(exportColorFor('#123456', 'goal'), ['#123456', null], 'a free colour is written as is')
    assert.deepEq(exportColorFor(null, 'goal'), [null, null])
  })
})

describe('Mermaid: what export writes, import reads back', () => {
  it('"#12;" and "%%" in titles and labels survive a round trip', () => {
    const blocks = {
      a: normalizeBlock({ id: 'a', type: 'goal', title: 'Close issue #12; then deploy', x: 0, y: 0 }),
      b: normalizeBlock({ id: 'b', type: 'metric', title: 'Error rate under 5%% of calls', x: 300, y: 0 }),
      c: normalizeBlock({ id: 'c', type: 'risk', title: 'Literal #quot; and #35; text', x: 600, y: 0 }),
    }
    const text = toMermaid({ blocks, arrows: [{ id: 'x', from: 'a', to: 'b', label: '50% #1' }], groups: {} })
    assert.notIncludes(text, '%%', 'no comment marker in the output')
    assert.notIncludes(text, '#12;', 'no accidental entity code')
    const r = parseMermaid(text)
    assert.deepEq(r.payload.blocks.map(x => x.title),
      ['Close issue #12; then deploy', 'Error rate under 5%% of calls', 'Literal #quot; and #35; text'])
    assert.eq(r.payload.arrows[0].label, '50% #1')
  })

  it('a %% comment is a line of its own (or trails the statement), never text inside a label', () => {
    const r = parseMermaid('flowchart LR\n  %% a whole-line comment\n  a["Under 5%% of calls"] --> b["Next"] %% trailing\n  %%{init: {"theme": "dark"}}%%')
    assert.deepEq(r.payload.blocks.map(x => x.title), ['Under 5%% of calls', 'Next'])
    assert.eq(r.payload.arrows.length, 1)
  })
})

describe('The backup reminder names a control you can see', () => {
  it('status bar on wide screens, the Maps menu on phones (where the status slot is hidden)', () => {
    assert.includes(backupNagText(9, false), 'Export all, in the status bar')
    assert.includes(backupNagText(9, false), '9 days ago')
    assert.includes(backupNagText(1, false), '1 day ago')
    assert.includes(backupNagText(null, true), 'never exported')
    assert.includes(backupNagText(null, true), 'Export all maps, in the Maps menu')
    assert.notIncludes(backupNagText(3, true), 'status bar')
  })
})

// Real layout: the app's stylesheet in a frame of a given width.
async function layoutFrame(width, bodyClass, html) {
  const frame = document.createElement('iframe')
  frame.style.cssText = `position:fixed;left:-5000px;top:0;width:${width}px;height:800px;border:0`
  frame.srcdoc = `<!doctype html><html><head><link rel="stylesheet" href="../css/style.css"></head>` +
    `<body class="${bodyClass}" style="margin:0"><div class="canvas-viewport" id="canvasViewport" style="position:relative;width:${width}px;height:800px">${html}</div></body></html>`
  const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }))
  document.body.appendChild(frame)
  await loaded
  return frame
}
const rectOf = el => el.getBoundingClientRect()
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

describe('Overlays keep out of each other', () => {
  const SEARCH = '<button class="canvas-search-toggle" id="searchBtn"><svg viewBox="0 0 24 24" width="16" height="16"></svg>Find blocks</button>'
  const BANNER = '<div id="otherTabBanner" class="other-tab-banner"><span class="other-tab-text">This map changed in another tab. Reload to see that version; editing here will overwrite it.</span><button type="button">Reload</button><button type="button">Keep editing here</button></div>'

  it('the other-tab banner never covers Find blocks, at desktop, laptop or phone width', async () => {
    for (const width of [1440, 1024, 390]) {
      const frame = await layoutFrame(width, '', SEARCH + BANNER)
      try {
        const doc = frame.contentDocument
        const banner = rectOf(doc.getElementById('otherTabBanner')), search = rectOf(doc.getElementById('searchBtn'))
        assert.gt(banner.width, 150, `${width}: the banner has room`)
        assert.ok(!overlaps(banner, search), `${width}: banner ${JSON.stringify([banner.left, banner.top, banner.right, banner.bottom])} overlaps search ${JSON.stringify([search.left, search.top, search.right, search.bottom])}`)
        assert.gte(banner.left, 0)
        assert.ok(banner.right <= width, `${width}: inside the viewport`)
      } finally { frame.remove() }
    }
  })

  it('the review bar is one surface: nothing floats loose over the cards on a phone', () => sandbox(async () => {
    // The real bar markup, with the undo button review.js adds.
    const saved = { notes: review.notes, sent: review.sent, key: review.key }
    const bar = '<div class="review-bar" id="reviewBar"><input class="review-input" id="reviewInput" placeholder="Select a block, note what you would change">' +
      '<button class="review-btn" id="reviewAddBtn">Add note</button>' +
      '<button class="review-btn review-copy" id="reviewCopyBtn">Copy review patch <span class="review-count">2</span></button></div>'
    for (const width of [390, 1440]) {
      const frame = await layoutFrame(width, 'readonly-mode', bar)
      try {
        const doc = frame.contentDocument
        // Build the undo control the way setupReview does, in that document.
        const host = doc.getElementById('reviewBar')
        const real = document.createElement('div')
        real.innerHTML = '<div id="reviewBar"><input id="reviewInput"><button id="reviewAddBtn"></button><button id="reviewCopyBtn"></button></div>'
        document.body.appendChild(real)
        const flags = { readOnly: ui.readOnly, embed: ui.embed }
        ui.readOnly = true; ui.embed = false
        try {
          review.key = 'pathfinder-review:layout-' + Math.random()
          setupReview()
        } finally { Object.assign(ui, flags) }
        const undoBtn = real.querySelector('#reviewUndoBtn')
        assert.ok(undoBtn, 'setupReview adds the undo control')
        assert.eq(undoBtn.textContent.trim(), 'Remove last note', 'its accessible name is the label')
        const clone = doc.importNode(undoBtn, true)
        clone.hidden = false
        host.querySelector('#reviewCopyBtn').before(clone)
        real.remove()

        const barRect = rectOf(host)
        const bg = frame.contentWindow.getComputedStyle(host).backgroundColor
        assert.ok(bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent', `${width}: the bar has a surface (${bg})`)
        const kids = [...host.children].map(rectOf)
        kids.forEach((k, i) => {
          assert.ok(k.left >= barRect.left - 0.5 && k.right <= barRect.right + 0.5 && k.top >= barRect.top - 0.5 && k.bottom <= barRect.bottom + 0.5,
            `${width}: control ${i} sits inside the bar`)
          kids.slice(i + 1).forEach((o, j) => assert.ok(!overlaps(k, o), `${width}: controls ${i} and ${i + j + 1} overlap`))
        })
        // Controls of different heights share a row when their middles line up.
        const rows = kids.map(k => (k.top + k.bottom) / 2).sort((a, b) => a - b)
          .reduce((n, mid, i, all) => n + (i && mid - all[i - 1] > 8 ? 1 : 0), 1)
        if (width === 390) {
          assert.ok(rows <= 2, `at most two rows on a phone (${rows})`)
          assert.ok(barRect.right <= width, 'inside the viewport')
        } else assert.eq(rows, 1, 'one row on a desktop')
      } finally { frame.remove() }
    }
    Object.assign(review, saved)
  }))
})

describe('Links carry an arrival marker and drop it once spent', () => {
  it('share and embed links name how they arrived; opening one removes the marker', () => sandbox(async () => {
    assert.includes(buildShareUrl(false), '?via=share#')
    assert.includes(buildShareUrl(true), '?readonly&via=share#')
    assert.includes(buildEmbedUrl(), '?embed&readonly&via=embed#')
    seedPrivate()
    history.replaceState(null, '', '?via=share&theme=x#s=' + btoa(encodeURIComponent(JSON.stringify(SHARED))))
    checkShareUrl()
    incomingDialog().querySelector('[data-choice="new"]').click()
    await tick()
    assert.eq(location.hash, '')
    assert.eq(location.search, '?theme=x', 'via is gone, other options stay')
  }))

  it('a view-only link keeps its whole address, marker included', () => sandbox(async () => {
    ui.readOnly = true
    history.replaceState(null, '', '?readonly&via=share#s=' + btoa(encodeURIComponent(JSON.stringify(SHARED))))
    checkShareUrl()
    await tick()
    assert.includes(location.search, 'via=share')
    assert.ok(location.hash.startsWith('#s='))
  }))
})

describe('A ?src= that cannot load leaves the address', () => {
  const cases = [
    ['an HTTP error', async () => ({ ok: false, status: 404, text: async () => '' })],
    ['a network or CORS failure', async () => { throw new TypeError('Failed to fetch') }],
    ['a file that is no canvas', async () => ({ ok: true, text: async () => 'not json at all' })],
  ]
  cases.forEach(([what, fetcher]) => {
    it(`after ${what}, a reload does not fetch it again`, () => sandbox(async () => {
      seedPrivate()
      window.fetch = fetcher
      history.replaceState(null, '', '?src=%2Fgone.json&via=share&theme=x')
      await checkSrcUrl()
      assert.eq(new URLSearchParams(location.search).get('src'), null)
      assert.eq(new URLSearchParams(location.search).get('via'), null)
      assert.eq(new URLSearchParams(location.search).get('theme'), 'x')
      assert.ok(state.blocks.private, 'nothing changed')
    }))
  })

  it('a refused scheme is dropped too; a view-only page keeps its source', () => sandbox(async () => {
    history.replaceState(null, '', '?src=http%3A%2F%2Fexample.com%2Fa.json')
    await checkSrcUrl()
    assert.eq(new URLSearchParams(location.search).get('src'), null)
    ui.readOnly = true
    window.fetch = async () => ({ ok: false, status: 500, text: async () => '' })
    history.replaceState(null, '', '?readonly&src=%2Fa.json')
    await checkSrcUrl()
    assert.eq(new URLSearchParams(location.search).get('src'), '/a.json')
  }))
})

// ── QA round ────────────────────────────────────────────────
describe('Sharing: QA round', () => {
  it('a link with a trailing &votes= segment still decodes, #s= and #z= alike', async () => {
    const canvas = { blocks: { a: { id: 'a', type: 'goal', title: 'Grow' } }, arrows: [] }
    const s1 = '#s=' + btoa(encodeURIComponent(JSON.stringify(canvas)))
    assert.eq(decodeLegacyShare(s1 + '&votes=%7B%7D').blocks.a.title, 'Grow')
    assert.eq((await decodeShareHash(s1 + '&votes=%7B%7D')).blocks.a.title, 'Grow')
    if (canCompressLinks()) {
      const z = '#z=' + await compressText(JSON.stringify(canvas))
      assert.eq((await decodeShareHash(z + '&votes=%7B%7D')).blocks.a.title, 'Grow')
    }
  })

  it('validate.mjs refuses what the app refuses: the same inflate cap, and the same segment rule', async () => {
    const src = await (await fetch('../validate.mjs', { cache: 'no-store' })).text()
    const m = /const MAX_INFLATED = ([\d_]+)/.exec(src)
    assert.ok(m, 'the CLI declares its cap')
    assert.eq(Number(m[1].replace(/_/g, '')), MAX_INFLATED, 'and it is the app\'s cap')
    assert.includes(src, 'maxOutputLength: MAX_INFLATED', 'the cap is applied to the inflate')
    assert.includes(src, '#z=([^&]+)', 'the payload stops at the first &')
  })

  it('an old export\'s recoloured card keeps its colour and is marked to check, not retyped', () => {
    const old = { nodes: [
      { id: 'r', type: 'text', x: 0, y: 0, width: 260, height: 100, color: '#f87171', text: '#### Deliverability to the mail provider' },
      { id: 'o', type: 'text', x: 400, y: 0, width: 260, height: 100, color: '#34d399', text: '#### Launch report' },
      { id: 'g', type: 'text', x: 800, y: 0, width: 260, height: 100, color: '6', text: '#### Ship onboarding v2' },
      { id: 'p', type: 'text', x: 0, y: 300, width: 260, height: 100, color: '#60a5fa', text: '#### Every Monday' },
    ], edges: [] }
    assert.ok(isLegacyPathfinderCanvas(old), 'a preset and no pathfinderType: the old exporter')
    const byId = Object.fromEntries(fromJsonCanvas(old).payload.blocks.map(b => [b.id, b]))
    assert.ok(byId.r.typeCheck, 'the Red card is not read as a confirmed Problem')
    assert.eq(byId.r.type === 'problem' ? null : byId.r.color, byId.r.type === 'problem' ? null : '#f87171', 'its colour stays unless the type already draws it')
    assert.ok(byId.o.typeCheck, 'the Emerald card is not read as a confirmed Decision')
    assert.eq(byId.p.type, 'process', 'a hex the old exporter wrote for a type still means that type')
    assert.ok(!byId.p.typeCheck)
    // A current export (it writes pathfinderType) keeps every hex exact.
    const fresh = { nodes: [{ id: 'x', type: 'text', x: 0, y: 0, color: '#f87171', text: 'Churn', pathfinderType: 'problem' },
      { id: 'y', type: 'text', x: 0, y: 0, color: '#fb923c', text: 'Vendor delay' }], edges: [] }
    assert.ok(!isLegacyPathfinderCanvas(fresh))
    const f = Object.fromEntries(fromJsonCanvas(fresh).payload.blocks.map(b => [b.id, b]))
    assert.eq(f.y.type, 'risk'); assert.ok(!f.y.typeCheck)
    // The user's own old export still imports typed where it wrote a type hex.
    const user = Object.fromEntries(fromJsonCanvas(USER_CANVAS).payload.blocks.map(b => [b.id, b]))
    assert.eq(user.rptdemow1.type, 'terminator')
    assert.eq(user.rptdemow8.type, 'process')
    assert.eq(user.rptdemoxb.type, 'context')
  })

  it('at 800px the status bar paints nothing under Copy prompt, and drops the backup status', async () => {
    const html = await (await fetch('../index.html', { cache: 'no-store' })).text()
    const bar = new DOMParser().parseFromString(html, 'text/html').getElementById('canvasStatusbar')
    bar.querySelector('#backupStatus').removeAttribute('hidden')
    bar.querySelector('#backupStatus').innerHTML = '<span class="backup-text">Backed up: never</span><button type="button" class="backup-export">Export all</button>'
    bar.querySelector('#saveStatusText').textContent = 'Saved locally'
    for (const [width, ws] of [[800, 472], [1024, 696]]) {
      const frame = document.createElement('iframe')
      frame.style.cssText = `position:fixed;left:-5000px;top:0;width:${width}px;height:400px;border:0`
      frame.srcdoc = '<!doctype html><html><head><link rel="stylesheet" href="../css/style.css"></head><body style="margin:0">' +
        `<section class="canvas-workspace" style="width:${ws}px;height:200px">${bar.outerHTML}</section></body></html>`
      const loaded = new Promise(r => frame.addEventListener('load', r, { once: true }))
      document.body.appendChild(frame)
      await loaded
      try {
        const doc = frame.contentDocument, win = frame.contentWindow
        const text = doc.getElementById('saveStatusText'), copy = doc.getElementById('copyPromptPill')
        assert.ok(rectOf(text).right <= rectOf(copy).left + 0.5, `${width}: the status text box ends before the button`)
        assert.eq(win.getComputedStyle(text).overflowX, 'hidden', `${width}: and clips what it cannot show`)
        const backup = doc.getElementById('backupStatus')
        if (width <= 900) assert.eq(win.getComputedStyle(backup).display, 'none', 'no room for it at 800px')
        else {
          const t = backup.querySelector('.backup-text')
          assert.ok(t.scrollWidth <= t.clientWidth + 1, `${width}: "Backed up: never" reads in full`)
        }
      } finally { frame.remove() }
    }
  })
})
