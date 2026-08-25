// ============================================================
//  arrival.test.js -- #s= share-arrival counting decision
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { shareHashArrival } from '../js/arrival.js'

describe('shareHashArrival()', () => {
  it('counts a bare #s= payload', () => {
    assert.eq(shareHashArrival('', '#s=abc'), 'hash-payload')
  })
  it('stays silent when the kit already counts the URL', () => {
    assert.eq(shareHashArrival('?via=claude', '#s=abc'), null)
    assert.eq(shareHashArrival('?src=https://x', '#s=abc'), null)
    assert.eq(shareHashArrival('?yaml=1', '#s=abc'), null)
  })
  it('stays silent with no payload', () => {
    assert.eq(shareHashArrival('', ''), null)
    assert.eq(shareHashArrival('', '#s='), null)
    assert.eq(shareHashArrival('', '#other=1'), null)
  })
})
