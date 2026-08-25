// ════════════════════════════════════════════════════════════
//  zip.js: a minimal ZIP writer. Pure, no DOM, no dependencies.
//
//  Emits STORE (uncompressed) entries only, which is the whole
//  of the ZIP format this app needs: the spec bundle is a few
//  kilobytes of Markdown, and shipping a compression library to
//  save two of them would be backwards. Every field below is
//  from the PKWARE APPNOTE structure for the classic (non-64)
//  format: local file headers, a central directory, one end
//  record.
// ════════════════════════════════════════════════════════════

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** CRC-32 of a Uint8Array, as an unsigned 32-bit value. */
export function crc32(bytes) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

// MS-DOS date and time, the format ZIP timestamps use.
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/**
 * Build a ZIP archive from `files`: an array of { name, data }, where data is
 * a string (encoded as UTF-8) or a Uint8Array. Returns the archive bytes.
 */
export function buildZip(files, now = new Date()) {
  const enc = new TextEncoder()
  const { time, date } = dosDateTime(now)
  const entries = files.map(f => {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    return { name: enc.encode(f.name), data, crc: crc32(data) }
  })

  const localSize = entries.reduce((n, e) => n + 30 + e.name.length + e.data.length, 0)
  const centralSize = entries.reduce((n, e) => n + 46 + e.name.length, 0)
  const out = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(out.buffer)
  let off = 0
  const u16 = v => { view.setUint16(off, v, true); off += 2 }
  const u32 = v => { view.setUint32(off, v >>> 0, true); off += 4 }
  const put = bytes => { out.set(bytes, off); off += bytes.length }

  // Local file headers followed by the stored data.
  const offsets = []
  entries.forEach(e => {
    offsets.push(off)
    u32(0x04034B50); u16(20); u16(0x0800 /* UTF-8 names */); u16(0 /* STORE */)
    u16(time); u16(date); u32(e.crc); u32(e.data.length); u32(e.data.length)
    u16(e.name.length); u16(0)
    put(e.name); put(e.data)
  })

  // Central directory.
  const cdStart = off
  entries.forEach((e, i) => {
    u32(0x02014B50); u16(20); u16(20); u16(0x0800); u16(0)
    u16(time); u16(date); u32(e.crc); u32(e.data.length); u32(e.data.length)
    u16(e.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(offsets[i])
    put(e.name)
  })

  // End of central directory.
  const cdSize = off - cdStart
  u32(0x06054B50)
  u16(0); u16(0)                       // disk numbers
  u16(entries.length); u16(entries.length)
  u32(cdSize)
  u32(cdStart)
  u16(0)                               // comment length
  return out
}
