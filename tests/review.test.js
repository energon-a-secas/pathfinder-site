// ============================================================
//  review.test.js -- The review bar's outgoing patch
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { buildReviewReply } from '../js/review.js'
import { extractPatch } from '../js/patch.js'

describe('buildReviewReply()', () => {
  it('emits a reply whose embedded patch parses with the notes intact', () => {
    const reply = buildReviewReply([
      { block: 'b1', title: 'A', text: 'tighten this' },
      { block: 'b2', title: 'B', text: 'wrong owner?' },
    ])
    assert.includes(reply, 'Bring the answer back')
    const { patch, error } = extractPatch(reply)
    assert.eq(error, undefined)
    assert.eq(patch.format, 'pathfinder-patch')
    assert.eq(patch.notes.length, 2)
    assert.eq(patch.notes[1].note, 'wrong owner?')
  })
})
