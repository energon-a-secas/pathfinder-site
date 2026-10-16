// ════════════════════════════════════════════════════════════
//  face-text.js: a small-zoom face's title, as lines. Pure: no
//  DOM, no state. lod.js measures with the face's own font and
//  writes the lines; it re-exports this module, so callers and
//  tests import from either.
// ════════════════════════════════════════════════════════════

// ── Titles that break between words ─────────────────────────
// Below full detail a face title gets the lines its card holds (two at
// most in the pill band), broken between words; when the words outrun the
// lines, the last line ends on a whole word and an ellipsis. CSS cannot do
// that: line-clamp puts its ellipsis wherever the last line runs out of
// room, which cut "Every End of Sprint" to "Every End o..." and "Draft
// release summary" to "Draft releas...". So the lines are measured here,
// with the face's own font, and written one element per line; a cut title
// always closes on an ellipsis (fitTitle). Only where a lone first word
// cannot take one is the word itself cut, "Collec...": a bare "Collect"
// read as a whole one-word title. A single word longer than a whole line
// ends in the line's own ellipsis. Never hyphenated.
//
// A title in a script written without spaces (Chinese, Japanese, Thai)
// breaks between its words as Intl.Segmenter finds them, or between
// characters where there is no segmenter: split on spaces alone, it was
// one word, cut on one line at every zoom.
//
// The face is laid out in face pixels (the card's size divided by --lodk),
// so the room is the card's padding box over k, less the face's padding
// and its dot. These numbers are the [zoom] section's; the tests hold the
// two to each other.

export const ELLIPSIS = '…'
export const FACE_METRICS = {
  // Title band: 12px titles on 16px lines. A column (the type's name over
  // the title) when the card holds the name and two lines, from its height
  // alone, so two cards of one size always show the same face; otherwise
  // a row (the dot beside the title), which gives the title the height.
  title: { font: 12, lh: 16, padX: 8, padY: 6, head: 14, gap: 2, dot: 8, dotGap: 6, rowPadY: 2, colBelow: 60, maxLines: 5, typeFont: 11, hang: 4 },
  // Pill band: 11px on 13px lines, a row, one line or two. No padding top
  // and bottom: a card with no description is 63px inside its border, 27.7
  // face pixels at 44%, and two lines are 26. The title band uses the same
  // face (layout "tight") on a card too short for two 12px lines that holds
  // two of these: from 45% to 59% a card with no description is 27 to 37
  // face pixels tall, one 12px line, and every title of three words was cut
  // to one.
  pill: { font: 11, lh: 13, padX: 4, padY: 0, dot: 8, dotGap: 4, maxLines: 2, hang: 3 },
}
// `hang`: how far a cut title's closing ellipsis may reach into the face's
// right padding (the [zoom] section's --lod-hang). At 30% a pill line holds
// 46px, and "Collect" fitted where "Collect..." did not.

// Scripts written without spaces between words.
const NO_SPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u
const OPENING = /^[\p{Ps}\p{Pi}]+$/u
const segmenters = {}
function segmenter(granularity) {
  if (!(granularity in segmenters)) {
    try { segmenters[granularity] = new Intl.Segmenter(undefined, { granularity }) } catch (_) { segmenters[granularity] = null }
  }
  return segmenters[granularity]
}
/** A run of spaceless script as segments: words where there is a segmenter, characters otherwise. */
function spacelessSegments(s, words = segmenter('word')) {
  if (words) return [...words.segment(s)].map(x => ({ t: x.segment, word: x.isWordLike }))
  return Array.from(s, ch => ({ t: ch, word: !/[\p{P}\p{S}]/u.test(ch) }))
}
const graphemes = s => {
  const g = segmenter('grapheme')
  return g ? [...g.segment(s)].map(x => x.segment) : Array.from(s)
}

/**
 * A title's break opportunities, in order: { t, sep } pieces, where sep is
 * what joins a piece to the one before it on a line (a space, or nothing
 * inside a spaceless run). Punctuation stays with the word before it (an
 * opening bracket with the word after), so no line starts on "、". Pure;
 * `words` stands in for Intl.Segmenter in the tests (null: no segmenter).
 */
export function titlePieces(text, words = undefined) {
  const out = []
  for (const token of String(text ?? '').trim().split(/\s+/).filter(Boolean)) {
    if (!NO_SPACE.test(token)) { out.push({ t: token, sep: ' ' }); continue }
    let first = true, pending = ''
    for (const seg of spacelessSegments(token, words === undefined ? segmenter('word') : words)) {
      // Closing punctuation stays with the word before it; leading or
      // opening punctuation goes with the word after.
      if (!seg.word && !first && !OPENING.test(seg.t)) { out[out.length - 1].t += seg.t; continue }
      if (!seg.word) { pending += seg.t; continue }
      out.push({ t: pending + seg.t, sep: first ? ' ' : '' })
      pending = ''; first = false
    }
    if (pending) {
      if (!first && out.length) out[out.length - 1].t += pending
      else out.push({ t: pending, sep: ' ' })
    }
  }
  if (out.length) out[0].sep = ''
  return out
}
const joinPieces = ps => ps.map((p, i) => (i ? p.sep : '') + p.t).join('')

/**
 * Break `text` into at most `maxLines` lines no wider than `width`, between
 * words. Returns { lines, cut }. When words were left over, the last line
 * ends on a whole word and an ellipsis, which may reach `hang` px past the
 * width; a line whose one word cannot take the ellipsis gives way, and the
 * line before it ends the title instead. When no line can, the last line's
 * word is cut to the letters that take one: a cut title always ends in an
 * ellipsis. A word wider than the whole line, with nothing after it, keeps
 * its letters for the line's own CSS ellipsis.
 * `measure` is the width of a string in the face's font. Pure, for the
 * tests.
 */
export function fitTitle(text, width, maxLines, measure, hang = 0, words = undefined) {
  const pieces = titlePieces(text, words)
  const max = Math.max(1, Math.floor(maxLines) || 1)
  const fits = s => measure(s) <= width + 0.01
  const lines = []
  let cur = [], i = 0
  while (i < pieces.length) {
    const next = cur.concat(pieces[i])
    // A line's first word always lands, even one wider than the line.
    if (cur.length && !fits(joinPieces(next))) {
      lines.push(cur); cur = []
      if (lines.length === max) break
      continue
    }
    cur = next; i++
  }
  if (cur.length) lines.push(cur)
  if (i >= pieces.length) return { lines: lines.map(joinPieces), cut: false }
  const fitsEnd = s => measure(s) <= width + hang + 0.01
  for (let li = lines.length - 1; li >= 0; li--) {
    const kept = lines[li].slice()
    while (kept.length > 1 && !fitsEnd(joinPieces(kept) + ELLIPSIS)) kept.pop()
    const end = joinPieces(kept)
    if (fitsEnd(end + ELLIPSIS)) return { lines: [...lines.slice(0, li).map(joinPieces), end + ELLIPSIS], cut: true }
  }
  // No line can end on a whole word and an ellipsis (each holds one word
  // that cannot take one): the last line's word gives letters to it.
  const li = lines.length - 1
  const chars = graphemes(lines[li][0].t)
  let n = chars.length - 1
  while (n > 1 && !fitsEnd(chars.slice(0, n).join('') + ELLIPSIS)) n--
  return { lines: [...lines.slice(0, li).map(joinPieces), chars.slice(0, Math.max(1, n)).join('') + ELLIPSIS], cut: true }
}

/**
 * A face's title with the dot beside it (every layout but 'col'): when a
 * single word is wider than its whole line ("Reconciliation" on a 220px
 * card at 44%, cut to "Reconciliati…"), the face gives the title the room
 * its dot and the dot's gap take, and the closing hang, before any word is
 * cut. { lines, cut, dot, hangs }: `dot` false when the face goes without
 * its dot, `hangs[i]` true for a line that reaches into the hang. Pure.
 */
export function fitFaceTitle(text, spec, m, measure, words = undefined) {
  const fit = fitTitle(text, spec.width, spec.lines, measure, m.hang, words)
  const within = (l, w) => measure(l) <= w + 0.01
  const keep = { ...fit, dot: true, hangs: fit.lines.map((l, i) => fit.cut && i === fit.lines.length - 1) }
  if (spec.layout === 'col' || !m.dot) return keep
  if (fit.lines.every(l => within(l, spec.width + (fit.cut ? m.hang : 0)))) return keep
  const wide = spec.width + m.dot + m.dotGap
  const alt = fitTitle(text, wide, spec.lines, measure, m.hang, words)
  if (!alt.lines.every(l => within(l, wide + m.hang))) return keep
  return { ...alt, dot: false, hangs: alt.lines.map((l, i) => !within(l, wide) || (alt.cut && i === alt.lines.length - 1)) }
}

/**
 * How a face is laid out for a card of `w` by `h` face pixels in `band`:
 * { layout: 'col' | 'row' | 'tight', width, lines } where width is the
 * title's room and lines its line budget. From the card's size alone
 * (`typeFits(width)` says whether the type's name fits beside its dot,
 * which a narrow card may not), so cards of one size share a face. 'tight'
 * is the pill band's face, used in the title band where a card holds two
 * 11px lines and not two 12px ones. Pure.
 */
export function faceLayout(band, w, h, { typeFits = () => true } = {}) {
  const p = FACE_METRICS.pill
  const pillLines = h - 2 * p.padY >= 2 * p.lh ? 2 : 1
  const pillWidth = w - 2 * p.padX - p.dot - p.dotGap
  if (band === 'pill') return { layout: 'row', width: pillWidth, lines: pillLines }
  const m = FACE_METRICS.title
  const colW = w - 2 * m.padX
  if (h >= m.colBelow && typeFits(colW - m.dot - m.dotGap)) {
    return { layout: 'col', width: colW, lines: Math.min(m.maxLines, Math.floor((h - 2 * m.padY - m.head - m.gap) / m.lh)) }
  }
  const rowLines = Math.max(1, Math.min(m.maxLines, Math.floor((h - 2 * m.rowPadY) / m.lh)))
  if (rowLines < 2 && pillLines > rowLines) return { layout: 'tight', width: pillWidth, lines: pillLines }
  return { layout: 'row', width: colW - m.dot - m.dotGap, lines: rowLines }
}

/** The metrics a face's title is measured with: the pill's for the pill band and the tight face. */
export const faceMetrics = (band, layout) => band === 'pill' || layout === 'tight' ? FACE_METRICS.pill : FACE_METRICS.title
