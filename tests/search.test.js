import { describe, it, assert } from './test-utils.js'
import { searchBlocks } from '../js/search.js'

const block = (id, extra = {}) => ({ id, type: 'requirement', title: 'Build checkout', ...extra })
const ids = results => results.map(result => result.block.id)

describe('Block search', () => {
  it('searches descriptions, notes, criteria, rationale, questions and answers', () => {
    for (const fields of [
      { description: 'Use idempotency keys' }, { notes: 'Use idempotency keys' },
      { criteria: ['Use idempotency keys'] }, { rationale: 'Use idempotency keys' },
      { questions: [{ text: 'Use idempotency keys?' }] },
      { questions: [{ text: 'How?', answer: 'Use idempotency keys' }] },
      { questions: ['Use idempotency keys?'] },
    ]) {
      const result = searchBlocks({ a: block('a', fields) }, 'idempotency')
      assert.eq(result.length, 1)
      assert.includes(result[0].excerpt, 'idempotency')
    }
  })
  it('combines query words across fields regardless of case or accents', () => {
    const blocks = { a: block('a', { title: 'Café checkout', notes: 'Retries are safe' }), b: block('b') }
    assert.deepEq(ids(searchBlocks(blocks, '  SAFE cafe  ')), ['a'])
    assert.eq(searchBlocks(blocks, 'safe missing').length, 0)
  })
  it('ranks an exact title ahead of title and description matches', () => {
    const blocks = {
      a: block('a', { description: 'Checkout timeout' }),
      b: block('b', { title: 'Checkout timeout retry' }),
      c: block('c', { title: 'Checkout timeout' }),
    }
    assert.deepEq(ids(searchBlocks(blocks, 'checkout timeout')), ['c', 'b', 'a'])
  })
  it('combines type and status filters with content queries', () => {
    const blocks = {
      a: block('a', { type: 'risk', status: 'blocked', notes: 'API outage' }),
      b: block('b', { type: 'risk', status: 'done', notes: 'API outage' }),
      c: block('c', { status: 'blocked', notes: 'API outage' }),
    }
    assert.deepEq(ids(searchBlocks(blocks, 'api', { type: 'risk', status: 'blocked' })), ['a'])
  })
  it('treats unset status as Not Started', () => {
    const blocks = { a: block('a'), b: block('b', { status: 'not-started' }), c: block('c', { status: 'done' }) }
    assert.deepEq(ids(searchBlocks(blocks, '', { status: 'not-started' })), ['a', 'b'])
  })
  it('searches the visible type labels, including Open Question and Start / End', () => {
    assert.eq(searchBlocks({ a: block('a', { type: 'question' }) }, 'open question').length, 1)
    assert.eq(searchBlocks({ a: block('a', { type: 'terminator' }) }, 'start end').length, 1)
  })
  it('returns every result instead of silently dropping matches after eight', () => {
    const blocks = Array.from({ length: 20 }, (_, i) => block(String(i)))
    assert.eq(searchBlocks(blocks, 'checkout').length, 20)
    assert.eq(searchBlocks(blocks, '').length, 20)
    assert.eq(searchBlocks({}, '').length, 0)
  })
  it('shows a relevant excerpt for a match deep in a long note', () => {
    const result = searchBlocks({ a: block('a', { notes: 'Context. '.repeat(70) + 'idempotency matters' }) }, 'idempotency')[0]
    assert.eq(result.source, 'Notes')
    assert.includes(result.excerpt, 'idempotency')
    assert.lt(result.excerpt.length, 155)
  })
  it('does not modify block content while searching', () => {
    const blocks = { a: block('a', { notes: '<script>literal text</script>' }) }
    const before = JSON.stringify(blocks)
    searchBlocks(blocks, 'script')
    assert.eq(JSON.stringify(blocks), before)
  })
})
