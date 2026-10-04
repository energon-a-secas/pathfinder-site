// ════════════════════════════════════════════════════════════
//  brief-md.js: the brief's Markdown, rendered for the Brief tab.
//  Pure: text in, HTML and an outline out, no DOM and no state,
//  so it can be tested on its own and never reads the map.
// ════════════════════════════════════════════════════════════

import { escHtml } from './utils.js'

// ── Markdown, the brief's own dialect ───────────────────────
// The generator writes a small, regular Markdown: headings, bullets
// (•, -, numbers, ◆) whose indented lines continue them, task boxes,
// a rule, a quote, **bold** and `code`. This renders exactly that, and
// escapes everything else: block titles are the author's text.

const BULLET = /^(\s*)(•|-|\*|\d+\.|◆)\s+(.*)$/
const FENCE = /^\s*```[\w-]*\s*$/
const LINK_OR_CODE = /```([^`\n]+?)```|`([^`\n]+?)`|(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]])/g

function plainInline(s) {
  return escHtml(s).replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
}

/** One line of text to HTML: escaped, with bold, code spans and https links. */
export function briefInline(raw) {
  const text = String(raw ?? '')
  let html = '', last = 0
  for (const m of text.matchAll(LINK_OR_CODE)) {
    html += plainInline(text.slice(last, m.index))
    html += m[3]
      ? `<a href="${escHtml(m[3])}" target="_blank" rel="noopener noreferrer">${escHtml(m[3])}</a>`
      : `<code>${escHtml(m[1] ?? m[2])}</code>`
    last = m.index + m[0].length
  }
  return html + plainInline(text.slice(last))
}

const leading = line => line.match(/^\s*/)[0].replace(/\t/g, '    ').length

/**
 * Parse the brief into a small tree: headings, paragraphs, rules, quotes,
 * code and lists whose items hold text lines and nested lists in order.
 */
function parseBrief(text) {
  const nodes = []
  let para = null, quote = null, fence = null
  let stack = []          // open lists, outermost first: { indent, list }
  let lastText = null     // the text part the previous line went into
  const closeInline = () => { para = null; quote = null }
  const closeAll = () => { closeInline(); stack = []; lastText = null }

  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(line => {
    if (fence) {
      if (FENCE.test(line)) { fence = null } else fence.lines.push(line)
      return
    }
    if (FENCE.test(line)) { closeAll(); fence = { t: 'pre', lines: [] }; nodes.push(fence); return }
    if (!line.trim()) { closeAll(); return }

    const indent = leading(line)
    const h = indent === 0 && line.match(/^(#{1,3}) (\S.*)$/)
    if (h) { closeAll(); nodes.push({ t: 'h', level: h[1].length, text: h[2].trim() }); return }
    if (indent === 0 && /^-{3,}\s*$/.test(line)) { closeAll(); nodes.push({ t: 'hr' }); return }
    const q = indent === 0 && line.match(/^>\s?(.*)$/)
    if (q) {
      stack = []; lastText = null; para = null
      if (!quote) { quote = { t: 'quote', lines: [] }; nodes.push(quote) }
      quote.lines.push(q[1]); return
    }

    const b = line.match(BULLET)
    if (b) {
      closeInline()
      while (stack.length && stack[stack.length - 1].indent > indent) stack.pop()
      let top = stack[stack.length - 1]
      if (!top) {
        top = { indent, list: { t: 'list', items: [] } }
        nodes.push(top.list); stack.push(top)
      } else if (top.indent < indent) {
        const parent = top.list.items[top.list.items.length - 1]
        const list = { t: 'list', items: [] }
        parent.parts.push(list)
        top = { indent, list }; stack.push(top)
      }
      lastText = { t: 'text', lines: [b[3]] }
      top.list.items.push({ marker: b[2], parts: [lastText] })
      return
    }

    // A line under a bullet continues the item it is indented under; an
    // unindented line straight after one is a lazy continuation.
    if (stack.length) {
      if (indent > 0) {
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
        const items = stack[stack.length - 1].list.items
        const item = items[items.length - 1]
        const tail = item.parts[item.parts.length - 1]
        if (tail === lastText && tail.t === 'text') tail.lines.push(line.trim())
        else { lastText = { t: 'text', lines: [line.trim()] }; item.parts.push(lastText) }
        return
      }
      if (lastText) { lastText.lines.push(line.trim()); return }
    }
    if (!para) { para = { t: 'p', lines: [] }; nodes.push(para) }
    para.lines.push(line.trim())
  })
  return nodes
}

const MARK_HIDDEN = new Set(['•', '-', '*'])

const TASK_BOX = /^\[( |x)\]\s*/i

function itemHtml(item) {
  // A task box at the head of an item reads as a box, not as "[ ]", and it
  // takes the bullet's place: one mark per item, never a dot and a box.
  let box = ''
  const parts = item.parts.map((p, i) => {
    if (p.t === 'list') return listHtml(p)
    let lines = p.lines.map(briefInline)
    if (i === 0) {
      lines[0] = lines[0].replace(TASK_BOX, (_, x) => {
        const check = x.trim()
          ? '<span class="md-check done" role="img" aria-label="Done"></span>'
          : '<span class="md-check" role="img" aria-label="To do"></span>'
        // A numbered item keeps its number; the box follows it.
        if (!MARK_HIDDEN.has(item.marker)) return check
        box = check
        return ''
      })
    }
    return `<div class="md-text">${lines.join('<br>')}</div>`
  }).join('')
  const hidden = MARK_HIDDEN.has(item.marker)
  const mark = box
    ? `<span class="md-mark md-mark-box">${box}</span>`
    : `<span class="md-mark${hidden ? '' : ' md-num'}"${hidden ? ' aria-hidden="true"' : ''}>${hidden ? '•' : escHtml(item.marker)}</span>`
  return `<li${box ? ' class="md-task"' : ''}>${mark}<div class="md-item">${parts}</div></li>`
}

function listHtml(list) {
  return `<ul class="md-list">${list.items.map(itemHtml).join('')}</ul>`
}

/**
 * The brief as HTML, and its outline: one entry per heading (`#` the
 * map's title, `##` a section) with the id it renders under and the
 * number of top-level items it lists.
 */
export function briefHtml(text) {
  const nodes = parseBrief(text)
  const sections = []
  let cur = null
  const html = nodes.map(n => {
    if (n.t === 'h') {
      const id = `brief-s${sections.length + 1}`
      const cls = n.level === 1 ? 'md-h1' : n.level === 2 ? 'md-h2' : 'md-h3'
      if (n.level <= 2) { cur = { id, level: n.level, title: n.text, items: 0 }; sections.push(cur) }
      const tag = n.level === 3 ? 'h4' : 'h3'
      return `<${tag} class="${cls}"${n.level <= 2 ? ` id="${id}" tabindex="-1"` : ''}>${briefInline(n.text)}</${tag}>`
    }
    if (n.t === 'list') { if (cur) cur.items += n.items.length; return listHtml(n) }
    if (n.t === 'p') return `<p>${n.lines.map(briefInline).join('<br>')}</p>`
    if (n.t === 'quote') return `<blockquote>${n.lines.map(briefInline).join('<br>')}</blockquote>`
    if (n.t === 'pre') return `<pre><code>${escHtml(n.lines.join('\n'))}</code></pre>`
    if (n.t === 'hr') return '<hr>'
    return ''
  }).join('')
  return { html, sections }
}
