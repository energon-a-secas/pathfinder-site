// ============================================================
//  zip.test.js -- Tests for js/zip.js (STORE zip writer)
// ============================================================

import { describe, it, assert } from './test-utils.js'
import { crc32, buildZip } from '../js/zip.js'

describe('crc32()', () => {
  it('matches the published value for "abc"', () => {
    assert.eq(crc32(new TextEncoder().encode('abc')), 0x352441C2)
  })
  it('empty input is zero', () => {
    assert.eq(crc32(new Uint8Array(0)), 0)
  })
})

describe('buildZip()', () => {
  const sig = (z, o) => (z[o] | (z[o+1] << 8) | (z[o+2] << 16) | (z[o+3] << 24)) >>> 0

  it('opens with a local file header and ends with the end record', () => {
    const z = buildZip([{ name: 'a.md', data: 'hello' }, { name: 'b.md', data: 'world' }])
    assert.eq(sig(z, 0), 0x04034B50)
    const e = z.length - 22
    assert.eq(sig(z, e), 0x06054B50)
    assert.eq(z[e+10] | (z[e+11] << 8), 2, 'entry count in end record')
  })

  it('central directory size and offset are consistent', () => {
    const files = [{ name: 'x.txt', data: 'PLAN' }]
    const z = buildZip(files)
    const e = z.length - 22
    const cdSize   = sig(z, e + 12)
    const cdOffset = sig(z, e + 16)
    assert.eq(sig(z, cdOffset), 0x02014B50, 'central directory starts where the end record says')
    assert.eq(cdOffset + cdSize, e, 'central directory runs up to the end record')
  })

  it('stores data uncompressed and readable', () => {
    const z = buildZip([{ name: 'x.txt', data: 'PLAN CONTENT' }])
    const s = new TextDecoder().decode(z)
    assert.includes(s, 'x.txt')
    assert.includes(s, 'PLAN CONTENT')
  })
})
