// ============================================================
//  canvas.test.js -- Tests for js/canvas.js (geometry functions)
// ============================================================

import { describe, it, assert, mockBlockEl, cleanupMockEls } from './test-utils.js'
import { state } from '../js/state.js'
import { portPos, bestPorts, buildPath, cpOffset, blockAtWorld, blocksInRect } from '../js/canvas.js'
import { DEFAULT_WIDTH } from '../js/utils.js'

// Default block dims when no DOM element: { w: 220, h: 100 }
const DW = DEFAULT_WIDTH  // 220
const DH = 100

function resetCanvas() {
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
}

function addBlock(id, x, y) {
  state.blocks[id] = {
    id, type: 'goal', title: 'Test',
    description: '', notes: '',
    x, y,
    actions: [], questions: [],
    width: null, color: null, collapsed: false, groupId: null,
  }
}

// ── portPos ──────────────────────────────────────────────────

describe('portPos()', () => {
  it('returns null for nonexistent block', () => {
    resetCanvas()
    assert.eq(portPos('nope', 'left'), null)
  })

  it('returns correct position for left port', () => {
    resetCanvas()
    addBlock('b1', 100, 200)
    const p = portPos('b1', 'left')
    assert.eq(p.x, 100)          // b.x
    assert.eq(p.y, 200 + DH/2)   // b.y + h/2
    assert.eq(p.dir, 'left')
  })

  it('returns correct position for right port', () => {
    resetCanvas()
    addBlock('b1', 100, 200)
    const p = portPos('b1', 'right')
    assert.eq(p.x, 100 + DW)     // b.x + w
    assert.eq(p.y, 200 + DH/2)   // b.y + h/2
    assert.eq(p.dir, 'right')
  })

  it('returns correct position for top port', () => {
    resetCanvas()
    addBlock('b1', 100, 200)
    const p = portPos('b1', 'top')
    assert.eq(p.x, 100 + DW/2)   // b.x + w/2
    assert.eq(p.y, 200)          // b.y
    assert.eq(p.dir, 'top')
  })

  it('returns correct position for bottom port', () => {
    resetCanvas()
    addBlock('b1', 100, 200)
    const p = portPos('b1', 'bottom')
    assert.eq(p.x, 100 + DW/2)   // b.x + w/2
    assert.eq(p.y, 200 + DH)     // b.y + h
    assert.eq(p.dir, 'bottom')
  })

  it('returns null for invalid port name', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    assert.eq(portPos('b1', 'invalid'), null)
  })
})

// ── bestPorts ────────────────────────────────────────────────

describe('bestPorts()', () => {
  it('returns null when source block does not exist', () => {
    resetCanvas()
    addBlock('b2', 500, 100)
    assert.eq(bestPorts('nope', 'b2'), null)
  })

  it('returns null when target block does not exist', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    assert.eq(bestPorts('b1', 'nope'), null)
  })

  it('selects right->left when target is to the right', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    addBlock('b2', 500, 0)
    const pts = bestPorts('b1', 'b2')
    assert.eq(pts.d1, 'right')
    assert.eq(pts.d2, 'left')
    assert.eq(pts.x1, 0 + DW)    // right edge of b1
    assert.eq(pts.x2, 500)        // left edge of b2
  })

  it('selects left->right when target is to the left', () => {
    resetCanvas()
    addBlock('b1', 500, 0)
    addBlock('b2', 0, 0)
    const pts = bestPorts('b1', 'b2')
    assert.eq(pts.d1, 'left')
    assert.eq(pts.d2, 'right')
  })

  it('selects bottom->top when target is below', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    addBlock('b2', 0, 400)
    const pts = bestPorts('b1', 'b2')
    assert.eq(pts.d1, 'bottom')
    assert.eq(pts.d2, 'top')
  })

  it('selects top->bottom when target is above', () => {
    resetCanvas()
    addBlock('b1', 0, 400)
    addBlock('b2', 0, 0)
    const pts = bestPorts('b1', 'b2')
    assert.eq(pts.d1, 'top')
    assert.eq(pts.d2, 'bottom')
  })

  it('prefers horizontal when dx == dy (equal offset)', () => {
    resetCanvas()
    addBlock('b1', 0, 0)
    // Place b2 so dx == dy after centering (dx >= dy -> horizontal)
    addBlock('b2', 300, 300)
    const pts = bestPorts('b1', 'b2')
    // dx = (300 + DW/2) - (0 + DW/2) = 300
    // dy = (300 + DH/2) - (0 + DH/2) = 300
    // abs(dx) >= abs(dy) -> horizontal
    assert.ok(pts.d1 === 'right' || pts.d1 === 'left')
  })
})

// ── cpOffset ─────────────────────────────────────────────────

describe('cpOffset()', () => {
  it('offsets right (+x)', () => {
    const c = cpOffset(100, 200, 'right', 50)
    assert.eq(c.x, 150)
    assert.eq(c.y, 200)
  })

  it('offsets left (-x)', () => {
    const c = cpOffset(100, 200, 'left', 50)
    assert.eq(c.x, 50)
    assert.eq(c.y, 200)
  })

  it('offsets bottom (+y)', () => {
    const c = cpOffset(100, 200, 'bottom', 50)
    assert.eq(c.x, 100)
    assert.eq(c.y, 250)
  })

  it('offsets top (-y)', () => {
    const c = cpOffset(100, 200, 'top', 50)
    assert.eq(c.x, 100)
    assert.eq(c.y, 150)
  })

  it('handles zero offset', () => {
    const c = cpOffset(100, 200, 'right', 0)
    assert.eq(c.x, 100)
    assert.eq(c.y, 200)
  })
})

// ── buildPath ────────────────────────────────────────────────

describe('buildPath()', () => {
  it('straight style produces M...L path', () => {
    const d = buildPath(0, 0, 'right', 100, 100, 'left', 'straight')
    assert.match(d, /^M\s/)
    assert.includes(d, 'L')
    assert.notIncludes(d, 'C')
    assert.notIncludes(d, 'H')
  })

  it('elbow style with horizontal start produces M...H...V...H path', () => {
    const d = buildPath(0, 0, 'right', 200, 100, 'left', 'elbow')
    assert.match(d, /^M\s/)
    assert.includes(d, 'H')
    assert.includes(d, 'V')
  })

  it('elbow style with vertical start produces M...V...H...V path', () => {
    const d = buildPath(0, 0, 'bottom', 100, 200, 'top', 'elbow')
    assert.match(d, /^M\s/)
    assert.includes(d, 'V')
    assert.includes(d, 'H')
  })

  it('curved (default) style produces M...C path', () => {
    const d = buildPath(0, 0, 'right', 300, 200, 'left')
    assert.match(d, /^M\s/)
    assert.includes(d, 'C')
  })

  it('curved path starts and ends at specified coordinates', () => {
    const d = buildPath(10, 20, 'right', 300, 400, 'left')
    assert.match(d, /^M 10 20/)
    assert.match(d, /300 400$/)
  })

  it('straight path starts and ends at specified coordinates', () => {
    const d = buildPath(10, 20, 'right', 300, 400, 'left', 'straight')
    assert.match(d, /^M 10 20/)
    assert.match(d, /300 400$/)
  })
})

// ── blockAtWorld ─────────────────────────────────────────────

describe('blockAtWorld()', () => {
  it('returns null when no blocks exist', () => {
    resetCanvas()
    assert.eq(blockAtWorld(50, 50), null)
  })

  it('returns block ID when point is inside a block', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    // Block occupies x:[100, 100+220], y:[100, 100+100]
    const hit = blockAtWorld(150, 150)
    assert.eq(hit, 'b1')
  })

  it('returns null when point is outside all blocks', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    assert.eq(blockAtWorld(50, 50), null)   // before block
    assert.eq(blockAtWorld(400, 400), null)  // after block
  })

  it('detects hit at block edges', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    // Exactly on left-top corner
    assert.eq(blockAtWorld(100, 100), 'b1')
    // Exactly on right-bottom corner
    assert.eq(blockAtWorld(100 + DW, 100 + DH), 'b1')
  })

  it('returns first matching block when blocks overlap', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    addBlock('b2', 110, 110) // overlapping b1
    const hit = blockAtWorld(150, 150)
    assert.ok(hit === 'b1' || hit === 'b2', 'Should match one of the overlapping blocks')
  })
})

// ── blocksInRect ─────────────────────────────────────────────

describe('blocksInRect()', () => {
  it('returns empty array when no blocks exist', () => {
    resetCanvas()
    assert.deepEq(blocksInRect(0, 0, 500, 500), [])
  })

  it('returns blocks fully inside the rect', () => {
    resetCanvas()
    addBlock('b1', 100, 100)  // occupies [100,320] x [100,200]
    const found = blocksInRect(0, 0, 500, 500)
    assert.includes(found, 'b1')
  })

  it('returns blocks partially overlapping the rect', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    // Rect that just clips the corner of b1
    const found = blocksInRect(0, 0, 110, 110)
    assert.includes(found, 'b1')
  })

  it('excludes blocks fully outside the rect', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    addBlock('b2', 800, 800)
    const found = blocksInRect(0, 0, 400, 400)
    assert.includes(found, 'b1')
    assert.ok(!found.includes('b2'))
  })

  it('handles inverted rect coordinates (normalizes min/max)', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    // Pass coords in reverse order
    const found = blocksInRect(500, 500, 0, 0)
    assert.includes(found, 'b1')
  })

  it('returns empty when rect does not overlap any block', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    const found = blocksInRect(0, 0, 50, 50) // too small to reach b1
    assert.eq(found.length, 0)
  })

  it('selects multiple blocks', () => {
    resetCanvas()
    addBlock('b1', 100, 100)
    addBlock('b2', 200, 200)
    addBlock('b3', 300, 300)
    const found = blocksInRect(0, 0, 600, 600)
    assert.eq(found.length, 3)
  })
})
