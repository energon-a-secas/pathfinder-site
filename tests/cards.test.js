// ============================================================
//  cards.test.js -- cards stream: what a card shows (neutral type
//  label, gap icon, highlight tab, caret), the type check that
//  replaced the floating chips, the palette grouped by step, and
//  the empty state's six-step starter.
// ============================================================

import { describe, it, assert, cleanupMockEls, cssRgba } from './test-utils.js'
import { state, ui, selection, pointer, view, getUndoHistory, getRedoFuture,
         resetSnapshotToken } from '../js/state.js'
import { $, TYPES, TYPE_STEPS, typesByStep, SWATCH_COLORS, HIGHLIGHTS } from '../js/utils.js'
import { renderBlock, undo, deselectAll, selectBlock } from '../js/render.js'
import { setupCanvasPointerEvents } from '../js/events.js'
import { runGapDetection, gapIconFor, GAP_META } from '../js/gaps.js'
import { setupTypeChips, showTypeChips, resolveTypeCheck, openTypeChipMenu } from '../js/classify.js'
import { renderPaletteTypes, setupPalette, addTypeAtCenter } from '../js/palette.js'
import { firstBlockPillsHtml, FIRST_BLOCK_TYPES } from '../js/start-panel.js'
import { lightAccentFor, highlightTabLabel, paintColorFor, colorDistance, ATTENTION_HEX } from '../js/cards.js'
import { closeMenus, isMenuOpen } from '../js/menu.js'
import { isInlineEditing, commitInlineEdit } from '../js/inline-edit.js'

// ── Helpers ─────────────────────────────────────────────────

function reset() {
  if (isInlineEditing()) commitInlineEdit()
  closeMenus()
  cleanupMockEls()
  state.blocks = {}
  state.arrows = []
  state.groups = {}
  ui.readOnly = false
  pointer.ix = null
  getUndoHistory().length = 0
  getRedoFuture().length = 0
  resetSnapshotToken()
  deselectAll()
}

function block(id, extra = {}) {
  state.blocks[id] = { id, type: 'requirement', title: id, description: '', notes: '',
    x: 40, y: 40, actions: [], questions: [], docRef: null, width: null, color: null,
    collapsed: false, groupId: null, status: null, priority: null, ...extra }
  renderBlock(id)
  return document.getElementById('b-' + id)
}

// The app's real stylesheet, applied inside a shadow root so it styles the
// cards under test without restyling the test report. `:root` becomes the
// host and `body` a wrapper div, so theme and mode classes still apply.
let cssText = null
async function stylesheetText() {
  if (cssText == null) cssText = await (await fetch('../css/style.css')).text()
  return cssText
}
async function styled(bodyClass = '') {
  const css = (await stylesheetText())
    .replace(/:root\b/g, ':host')
    .replace(/(?<![\w.-])body(?![\w-])/g, '.pf-body')
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-4000px;top:0;width:900px;height:700px'
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  // A transition would report the value it starts from, not the end state.
  const still = new CSSStyleSheet()
  still.replaceSync('*, *::before, *::after { transition: none !important; }')
  root.adoptedStyleSheets = [sheet, still]
  const page = document.createElement('div')
  page.className = ('pf-body ' + bodyClass).trim()
  page.innerHTML = '<div class="canvas-root" style="position:relative;width:900px;height:700px"></div>'
  root.appendChild(page)
  const canvas = page.firstChild
  // A card rendered by the app, cloned into the styled tree.
  const place = (el, x = 60, y = 60) => {
    const c = el.cloneNode(true)
    c.removeAttribute('id')
    c.style.left = x + 'px'; c.style.top = y + 'px'
    canvas.appendChild(c)
    return c
  }
  return { sheet, root, page, canvas, place, done: () => host.remove() }
}

// Every computed form (rgb, oklch, oklab, color(srgb)), as [r, g, b, a].
const rgb = s => cssRgba(s) || []
const lum = ([r, g, b]) => {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const over = (fg, bg) => { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)) }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// ── Card markup ─────────────────────────────────────────────

describe('cards -- the type label', () => {
  it('is a neutral label beside a type dot, with no colour written inline', () => {
    reset()
    const el = block('a', { type: 'metric' })
    const badge = el.querySelector('.block-type-badge')
    assert.ok(badge, 'the card has a type badge')
    assert.eq(badge.tagName, 'SPAN', 'a confirmed type is plain text, not a control')
    assert.ok(badge.querySelector('.block-type-dot'), 'the badge carries a dot')
    assert.eq(badge.querySelector('.block-type-label').textContent, TYPES.metric.label)
    assert.eq(badge.getAttribute('style'), null, 'no inline colour on the badge')
    assert.ok(!el.style.getPropertyValue('--bc'), 'the accent is not written inline')
  })

  it('renders the label in the neutral text colour, in both themes, with the type colour in the dot', async () => {
    reset()
    const el = block('a', { type: 'requirement' })
    // --text-2 in each theme: oklch(0.80 0.010 285) and oklch(0.40 0.012 285).
    const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
    for (const [theme, text, dot] of [['', cssRgba('oklch(0.80 0.010 285)').slice(0, 3), hexRgb(TYPES.requirement.color)],
                                      ['light-mode', cssRgba('oklch(0.40 0.012 285)').slice(0, 3), hexRgb(TYPES.requirement.light)]]) {
      const s = await styled(theme)
      try {
        const card = s.place(el)
        const label = card.querySelector('.block-type-label')
        assert.deepEq(rgb(getComputedStyle(label).color).slice(0, 3), text, `${theme || 'dark'}: label is --text-secondary`)
        assert.deepEq(rgb(getComputedStyle(card.querySelector('.block-type-dot')).backgroundColor).slice(0, 3), dot,
          `${theme || 'dark'}: the dot carries the type colour`)
        assert.eq(getComputedStyle(label).fontSize, '11px', 'the 11px floor')
        assert.eq(getComputedStyle(label).fontWeight, '600')
        assert.eq(getComputedStyle(card.querySelector('.block-title')).fontSize, '14px')
        assert.eq(getComputedStyle(card.querySelector('.block-desc')).fontSize, '12px')
      } finally { s.done() }
    }
  })

  it('keeps every piece of card text at 4.5:1 or better in both themes', async () => {
    reset()
    const el = block('a', { type: 'resource', description: 'A description', status: 'in-progress', priority: 'medium' })
    for (const theme of ['', 'light-mode']) {
      const s = await styled(theme)
      try {
        const card = s.place(el)
        // The card fill over the page background (--bg), as it is painted.
        const page = over(rgb(getComputedStyle(s.page).backgroundColor), [255, 255, 255])
        const fill = over(rgb(getComputedStyle(card).backgroundColor), page)
        for (const sel of ['.block-type-label', '.block-title', '.block-desc', '.status-badge', '.priority-badge']) {
          const node = card.querySelector(sel)
          const cs = getComputedStyle(node)
          const own = rgb(cs.backgroundColor)
          const bg = (own[3] ?? 1) > 0 ? over(own, fill) : fill
          const ratio = contrast(over(rgb(cs.color), bg), bg)
          assert.ok(ratio >= 4.5, `${theme || 'dark'} ${sel}: ${ratio.toFixed(2)}:1`)
        }
      } finally { s.done() }
    }
  })

  it('an old amber colour paints as the nearest swatch, so a card never reads as a gap; the stored colour stays', () => {
    reset()
    // #fbbf24: the old Amber swatch, old Requirement and JSON Canvas "3";
    // #eab308: old Assumption. Both sit within 10 dE of the gap colour.
    for (const old of ['#fbbf24', '#eab308', '#FACC15']) {
      const p = paintColorFor(old)
      assert.ok(SWATCH_COLORS.includes(p.color), `${old} paints as a current swatch (${p.color})`)
      assert.ok(colorDistance(p.color, ATTENTION_HEX.dark) >= 10, `${old}: ${p.color} clears the dark attention`)
      assert.ok(p.light && colorDistance(p.light, ATTENTION_HEX.light) >= 10, `${old}: its twin ${p.light} clears the light attention`)
      const el = block('o', { color: old })
      assert.eq(el.style.getPropertyValue('--bc-custom'), p.color, `${old}: the card paints the swatch`)
      assert.eq(el.style.getPropertyValue('--bc-custom-light'), p.light)
      assert.eq(state.blocks.o.color, old, 'the stored colour is untouched')
    }
    // Everything else paints as stored.
    assert.deepEq(paintColorFor('#f472b6'), { color: '#f472b6', light: '#db2777' })
    for (const c of SWATCH_COLORS) assert.eq(paintColorFor(c).color, c, `${c} is a swatch and paints as itself`)
    assert.deepEq(paintColorFor(null), { color: null, light: null })
  })

  it('a custom colour feeds the accent through a class, with a darker twin for the light theme', async () => {
    reset()
    const el = block('a', { color: '#f472b6' })
    assert.ok(el.classList.contains('has-color'))
    assert.eq(el.style.getPropertyValue('--bc-custom'), '#f472b6')
    assert.eq(el.style.getPropertyValue('--bc-custom-light'), '#db2777')
    const s = await styled('light-mode')
    try {
      const card = s.place(el)
      assert.deepEq(rgb(getComputedStyle(card.querySelector('.block-type-dot')).backgroundColor).slice(0, 3), [219, 39, 119])
    } finally { s.done() }
    assert.eq(lightAccentFor(TYPES.requirement.color.toUpperCase()), TYPES.requirement.light, 'a type colour maps to its light twin')
    assert.eq(lightAccentFor('#FBBF24'), '#c49008', 'a pre-2026-10 type colour keeps its old twin')
    assert.eq(lightAccentFor('#123456'), null)
    SWATCH_COLORS.forEach(c => assert.ok(lightAccentFor(c), `swatch ${c} has a light twin`))
  })
})

describe('cards -- states keep their own channels', () => {
  it('the selected outline wins over the gap, comparison and focus states', async () => {
    reset()
    const el = block('a')
    const s = await styled('comparing-snapshot')
    try {
      const card = s.place(el)
      card.classList.add('selected', 'gap-isolated')
      card.dataset.comparison = 'changed'
      const cs = getComputedStyle(card)
      assert.eq(cs.outlineStyle, 'solid')
      // 2px: whole pixels render as written (a 1.5px outline drew 1px at 1x).
      assert.eq(cs.outlineWidth, '2px')
      assert.eq(cs.outlineOffset, '0px', 'on the card\'s edge, inside the gap ring')
      assert.deepEq(rgb(cs.outlineColor).slice(0, 3), cssRgba('oklch(0.68 0.16 285)').slice(0, 3), 'the outline is the accent')
      assert.match(cs.boxShadow, /0px 0px 0px 4px/, 'with the accent-subtle halo')
      assert.ok(!/\.low-confidence/.test(await stylesheetText()), 'the old low-confidence outline is gone')
    } finally { s.done() }
  })

  it('selection never changes a card height, and no hover rule touches layout', async () => {
    reset()
    const el = block('a', { description: '' })
    const s = await styled()
    try {
      const card = s.place(el)
      const h = card.offsetHeight
      card.classList.add('selected')
      assert.eq(card.offsetHeight, h, 'selecting a card with no description keeps its height')
      const desc = card.querySelector('.block-desc')
      assert.eq(getComputedStyle(desc).position, 'absolute', 'the add-description hint is an overlay')
      assert.match(getComputedStyle(desc, '::before').content, /add a description/)
      card.classList.remove('selected')
      assert.eq(getComputedStyle(desc).display, 'none', 'no hint on an unselected card')

      const layoutProps = /^(display|position|width|height|min-height|max-height|margin|padding|border-width|font-size|line-height)/
      const hovered = /\.block(\.[\w-]+|\[[^\]]*\]|:not\([^)]*\))*:hover/
      const walk = rules => [...rules].forEach(r => {
        if (r.cssRules && !r.selectorText) return walk(r.cssRules)
        if (!r.selectorText || !hovered.test(r.selectorText)) return
        for (const prop of r.style) {
          assert.ok(!layoutProps.test(prop), `${r.selectorText} sets ${prop} on hover`)
        }
      })
      walk(s.sheet.cssRules)
    } finally { s.done() }
  })

  it('a view-only card offers no description hint, ports or resize grip', async () => {
    reset()
    ui.readOnly = true
    const el = block('a')
    ui.readOnly = false
    const s = await styled('readonly-mode')
    try {
      const card = s.place(el)
      card.classList.add('selected')
      assert.eq(getComputedStyle(card.querySelector('.block-desc')).display, 'none')
      assert.eq(getComputedStyle(card.querySelector('.port')).display, 'none')
      assert.eq(getComputedStyle(card.querySelector('.block-resize-handle')).display, 'none')
    } finally { s.done() }
  })

  it('the caret and the ports show on selection, not at rest; a collapsed card keeps its caret', async () => {
    reset()
    const el = block('a')
    const s = await styled()
    try {
      const card = s.place(el)
      const caret = card.querySelector('.block-collapse-btn')
      const port = card.querySelector('.port')
      assert.eq(getComputedStyle(caret).opacity, '0')
      assert.eq(getComputedStyle(port).opacity, '0')
      card.classList.add('selected')
      assert.eq(getComputedStyle(caret).opacity, '1')
      assert.eq(getComputedStyle(port).opacity, '1')
      card.classList.remove('selected')
      card.classList.add('collapsed')
      assert.eq(getComputedStyle(caret).opacity, '1')
    } finally { s.done() }
  })

  it('the collapse caret is a labelled button, and a view-only card has none', () => {
    reset()
    let el = block('a', { collapsed: true })
    const btn = el.querySelector('button.block-collapse-btn')
    assert.ok(btn, 'a real button')
    assert.eq(btn.getAttribute('aria-label'), 'Expand block')
    assert.eq(btn.getAttribute('aria-expanded'), 'false')
    ui.readOnly = true
    try {
      el = block('b')
      assert.eq(el.querySelector('.block-collapse-btn'), null, 'nothing to toggle on a view-only link')
    } finally { ui.readOnly = false }
  })

  it('a highlight is a static ring outside the card with a word on it', async () => {
    reset()
    const el = block('a', { highlight: 'hold' })
    assert.eq(el.querySelector('.block-hl-tab').textContent, 'Hold')
    assert.includes(el.getAttribute('aria-label'), 'highlighted Hold')
    assert.eq(highlightTabLabel('festive'), '', 'festive is a pattern, not a colour: no word')
    assert.eq(block('b', { highlight: 'festive' }).querySelector('.block-hl-tab'), null)
    const s = await styled()
    try {
      const card = s.place(el)
      const ring = getComputedStyle(card, '::before')
      assert.eq(ring.top, '-10px', 'outside the gap ring (3 to 4.5px out)')
      assert.eq(ring.boxShadow, 'none', 'no glow')
      // Chrome snaps border widths to device pixels: 2.5px reads 2px at 1x.
      assert.match(ring.borderTopWidth, /^2(\.5)?px$/)
      const tab = getComputedStyle(card.querySelector('.block-hl-tab'))
      assert.eq(tab.position, 'absolute')
      assert.eq(tab.textTransform, 'uppercase')
    } finally { s.done() }
  })
})

describe('cards -- review fixes: touch, view-only, multi-selection', () => {
  // Every style rule inside a media block whose condition matches `media`.
  function mediaRules(sheet, media) {
    const out = []
    const walk = rules => [...rules].forEach(r => {
      if (r.media && r.cssRules) {
        if (media.test(r.media.mediaText)) [...r.cssRules].forEach(x => x.selectorText && out.push(x))
        else walk(r.cssRules)
      } else if (r.cssRules && !r.selectorText) walk(r.cssRules)
    })
    walk(sheet.cssRules)
    return out
  }

  it('on a touch screen the hidden caret of an unselected card takes no taps', async () => {
    const s = await styled()
    try {
      const rules = mediaRules(s.sheet, /pointer:\s*coarse/)
      const caret = rules.filter(r => /:not\(\.selected\)/.test(r.selectorText) && /\.block-collapse-btn/.test(r.selectorText))
      assert.ok(caret.length > 0, 'the coarse-pointer block hides the caret of an unselected card')
      caret.forEach(r => {
        assert.eq(r.style.opacity, '0', r.selectorText)
        assert.eq(r.style.pointerEvents, 'none', `${r.selectorText}: invisible and still tappable`)
      })
    } finally { s.done() }
  })

  it('a collapsed card on a view-only link shows a mark, not a control', async () => {
    reset()
    ui.readOnly = true
    let folded, open
    try {
      folded = block('a', { collapsed: true })
      open = block('b')
    } finally { ui.readOnly = false }
    const mark = folded.querySelector('.block-collapsed-mark')
    assert.ok(mark, 'something says the body is folded away')
    assert.eq(mark.tagName, 'SPAN', 'not a control: nothing to press')
    assert.eq(mark.getAttribute('aria-hidden'), 'true')
    assert.eq(folded.querySelector('button.block-collapse-btn'), null)
    assert.includes(folded.getAttribute('aria-label'), 'collapsed', 'and says so to a screen reader')
    assert.eq(open.querySelector('.block-collapsed-mark'), null, 'an open card has no mark')
    assert.eq(block('c', { collapsed: true }).querySelector('.block-collapsed-mark'), null, 'an editor gets the real caret')
    const s = await styled('readonly-mode')
    try {
      const card = s.place(folded)
      const cs = getComputedStyle(card.querySelector('.block-collapsed-mark'))
      // A flex item: inline-flex is blockified to flex.
      assert.ok(cs.display !== 'none', `shown (${cs.display})`)
      assert.eq(cs.opacity, '1')
      assert.ok(getComputedStyle(card.querySelector('.block-collapsed-mark svg')).transform !== 'none', 'the caret is turned, as on a collapsed card')
    } finally { s.done() }
  })

  it('on a light Context header strip the caret and the mark are not white on near-white', async () => {
    reset()
    const edit = block('a', { type: 'context', cardStyle: 'header', collapsed: true })
    ui.readOnly = true
    let view
    try { view = block('b', { type: 'context', cardStyle: 'header', collapsed: true }) } finally { ui.readOnly = false }
    const s = await styled('light-mode')
    try {
      const white = [255, 255, 255]
      const caret = s.place(edit).querySelector('.block-collapse-btn')
      const mark = s.place(view, 400, 60).querySelector('.block-collapsed-mark')
      assert.neq(rgb(getComputedStyle(caret).color).slice(0, 3).join(), white.join(), 'caret')
      assert.neq(rgb(getComputedStyle(mark).color).slice(0, 3).join(), white.join(), 'mark')
      // The harness turns `body` into a class, which lifts every light-mode
      // rule by a class's weight and hides the real page's cascade, where the
      // white Context rule outranks `body.light-mode .block[...] .caret`. So
      // also require a light-mode Context rule of its own for both.
      const own = []
      const walk = rs => [...rs].forEach(r => {
        if (r.cssRules && !r.selectorText) return walk(r.cssRules)
        if (/light-mode/.test(r.selectorText || '') && /data-type="?context/.test(r.selectorText) && r.style.color) own.push(r)
      })
      walk(s.sheet.cssRules)
      for (const el of [caret, mark]) {
        const r = own.find(x => el.matches(x.selectorText.replace(/:host/g, '*')))
        assert.ok(r && !/#fff|255, 255, 255/.test(r.style.color), `${el.className}: a light-mode Context colour`)
      }
    } finally { s.done() }
  })

  it('the add-description caption shows for one selected card, not for each card of a multi-selection', async () => {
    reset()
    const a = block('a', { description: '' })
    const b = block('b', { description: '' })
    const s = await styled()
    try {
      const ca = s.place(a, 60, 60), cb = s.place(b, 400, 60)
      ca.classList.add('selected')
      assert.eq(getComputedStyle(ca.querySelector('.block-desc')).display, 'block', 'one selected card: the caption')
      cb.classList.add('selected')
      assert.eq(getComputedStyle(ca.querySelector('.block-desc')).display, 'none', 'two selected: no caption')
      assert.eq(getComputedStyle(cb.querySelector('.block-desc')).display, 'none')
      ca.classList.remove('selected')
      assert.eq(getComputedStyle(cb.querySelector('.block-desc')).display, 'block', 'back to one: the caption returns')
    } finally { s.done() }
  })
})

// ── Gap icons ───────────────────────────────────────────────

describe('cards -- gap icon slot', () => {
  // A goal wired only to a problem: connected, but with no requirement.
  function goalWithGap() {
    reset()
    block('g', { type: 'goal' }); block('r', { type: 'problem' })
    state.arrows = [{ id: 'x1', from: 'g', to: 'r', style: 'routed' }]
    runGapDetection()
    return document.getElementById('b-g')
  }
  const settle = () => new Promise(r => setTimeout(r, 0))

  it('has one writer: nothing on the card side repaints what gap detection wrote', async () => {
    const el = goalWithGap()
    assert.ok(el.classList.contains('gap-no-req'))
    const slot = el.querySelector('.block-gap-icons')
    assert.eq(slot.id, 'gi-g', 'renderBlock keeps the gi- slot gaps.js paints')
    // What gaps.js writes (its own title, its own aria text) must survive the
    // class and content churn that follows a gap run.
    slot.innerHTML = '<span class="gap-icon" title="written by gaps.js"><svg></svg></span>'
    el.classList.add('related'); el.classList.remove('related')
    el.querySelector('.block-title').append(document.createTextNode(''))
    await Promise.resolve(); await settle()
    assert.eq(slot.querySelector('.gap-icon')?.getAttribute('title'), 'written by gaps.js',
      'no second writer rewrites or clears the slot')
  })

  it('is filled by gap detection from gapIconFor, named from GAP_META', async () => {
    const el = goalWithGap()
    const slot = el.querySelector('.block-gap-icons')
    const painted = slot.innerHTML
    await Promise.resolve(); await settle()
    assert.eq(slot.innerHTML, painted, 'the slot holds what detection wrote, a task later too')
    const icon = slot.querySelector('.gap-icon')
    assert.ok(icon?.querySelector('svg'), 'the icon arrives with detection')
    const expected = document.createElement('template')
    expected.innerHTML = gapIconFor('gap-no-req', 12)
    assert.eq(icon.querySelector('svg').outerHTML, expected.content.firstElementChild.outerHTML, 'the icon is gapIconFor\'s, at the badge\'s 12px')
    assert.eq(icon.querySelector('.gap-name')?.textContent, GAP_META['gap-no-req'].short, 'the badge carries the gap\'s name')
    assert.ok((icon.getAttribute('title') || '').startsWith(GAP_META['gap-no-req'].short),
      'its name comes from GAP_META')
  })
})

// ── Type check ──────────────────────────────────────────────

describe('cards -- the type check replaces the floating chips', () => {
  it('a block awaiting a check shows its type badge as a button', () => {
    reset()
    const el = block('a', { type: 'custom', typeCheck: true })
    const btn = el.querySelector('.block-type-badge')
    assert.eq(btn.tagName, 'BUTTON')
    assert.ok(btn.classList.contains('block-type-check'))
    assert.ok(btn.hasAttribute('data-canvas-ui'), 'a press on it neither selects nor drags the card')
    assert.eq(btn.getAttribute('aria-haspopup'), 'menu')
    assert.includes(btn.getAttribute('aria-label'), TYPES.custom.label)
    assert.ok(btn.querySelector('.block-type-caret'))
    ui.readOnly = true
    try {
      assert.eq(block('b', { typeCheck: true }).querySelector('.block-type-badge').tagName, 'SPAN',
        'a view-only link cannot confirm a type')
    } finally { ui.readOnly = false }
  })

  it('"Looks right" is the first item and clears the check in one undo step', () => {
    reset(); setupTypeChips(); setupCanvasPointerEvents()
    const el = block('a', { type: 'process', typeCheck: true })
    const btn = el.querySelector('.block-type-check')
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerId: 3 }))
    assert.eq(selection.blockId, null, 'pressing the label does not select the card')
    btn.click()
    assert.ok(isMenuOpen(), 'the type menu opens')
    const items = [...document.querySelectorAll('.pf-menu.type-check-menu .pf-menu-item')]
    assert.includes(items[0].textContent, 'Looks right')
    // Every type is one step row away, and the current one is checked there.
    const labels = []
    let checked = null
    items.filter(i => i.getAttribute('aria-haspopup') === 'menu').forEach(row => {
      row.click()
      const sub = [...document.querySelectorAll('.pf-menu.pf-submenu .pf-menu-item')]
      sub.forEach(i => labels.push(i.querySelector('.pf-menu-label')?.textContent))
      checked = sub.find(i => i.getAttribute('aria-checked') === 'true') || checked
    })
    Object.values(TYPES).forEach(t => assert.includes(labels, t.label))
    assert.eq(labels.length, Object.keys(TYPES).length, 'each type once')
    assert.eq(checked?.querySelector('.pf-menu-label').textContent, TYPES.process.label, 'the current type is checked')
    items[0].click()
    assert.ok(!isMenuOpen())
    assert.ok(!('typeCheck' in state.blocks.a), 'the check is cleared')
    assert.eq(state.blocks.a.type, 'process', 'the type is kept')
    assert.eq(getUndoHistory().length, 1, 'one undo step')
    assert.eq(document.querySelector('#b-a .block-type-badge').tagName, 'SPAN', 'the badge is plain again')
    undo()
    assert.eq(state.blocks.a.typeCheck, true, 'undo brings the check back')
  })

  it('choosing a type changes it, clears the check, and drops a colour that was the old type\'s', () => {
    reset(); setupTypeChips()
    block('a', { type: 'custom', typeCheck: true, color: TYPES.custom.color })
    block('b', { type: 'custom', typeCheck: true, color: '#f472b6' })
    document.querySelector('#b-a .block-type-check').click()
    const how = [...document.querySelectorAll('.pf-menu.type-check-menu .pf-menu-item')]
      .find(i => i.querySelector('.pf-menu-label')?.textContent === 'How')
    how.click()
    const pick = [...document.querySelectorAll('.pf-menu.pf-submenu .pf-menu-item')]
      .find(i => i.querySelector('.pf-menu-label')?.textContent === TYPES.implementation.label)
    pick.click()
    assert.eq(state.blocks.a.type, 'implementation')
    assert.ok(!('typeCheck' in state.blocks.a))
    assert.eq(state.blocks.a.color, null, 'the old type colour no longer applies')
    assert.eq(getUndoHistory().length, 1)
    assert.ok(resolveTypeCheck('b', 'metric'))
    assert.eq(state.blocks.b.color, '#f472b6', 'a colour somebody chose stays')
    assert.eq(resolveTypeCheck('b'), false, 'nothing left to settle')
  })

  it('the pf:show-type-chips event marks only low-confidence blocks, adds no undo step and floats nothing', () => {
    reset(); setupTypeChips()
    block('lo', { type: 'custom' }); block('hi', { type: 'goal' })
    window.dispatchEvent(new CustomEvent('pf:show-type-chips', {
      detail: [{ id: 'lo', confidence: 'low' }, { id: 'hi', confidence: 'high' }, { id: 'gone', confidence: 'low' }],
    }))
    assert.eq(state.blocks.lo.typeCheck, true)
    assert.ok(!('typeCheck' in state.blocks.hi))
    assert.eq(getUndoHistory().length, 0, 'metadata only: the import took the undo step')
    assert.eq(document.querySelectorAll('.type-chip').length, 0, 'no chips above the cards')
    assert.ok(document.querySelector('#b-lo .block-type-check'))
    ui.readOnly = true
    try { assert.eq(showTypeChips([{ id: 'hi', confidence: 'low' }]), 0, 'read-only marks nothing') }
    finally { ui.readOnly = false }
  })
})

describe('cards -- the type check fits and is reachable', () => {
  it('the menu is one row per step, each naming its types, with the help lines still in it', () => {
    reset(); setupTypeChips()
    const el = block('a', { type: 'custom', typeCheck: true })
    openTypeChipMenu(el.querySelector('.block-type-check'))
    const menu = document.querySelector('.pf-menu.type-check-menu')
    const rows = [...menu.querySelectorAll(':scope > .pf-menu-item')]
    const steps = typesByStep().filter(g => g.types.length)
    assert.eq(rows.length, 1 + steps.length, 'Looks right plus one row per step, not sixteen')
    assert.eq(menu.querySelectorAll(':scope > .pf-menu-heading').length, 0, 'no stack of headings')
    steps.forEach((g, i) => {
      const row = rows[i + 1]
      assert.eq(row.querySelector('.pf-menu-label').textContent, g.label)
      assert.eq(row.getAttribute('aria-haspopup'), 'menu')
      g.types.forEach(t => assert.includes(row.querySelector('.pf-menu-hint').textContent, TYPES[t].label))
    })
    assert.ok(menu.querySelectorAll('.type-menu-notes p').length > 0, 'the lines that separate confusable types stay')
    closeMenus()
  })

  it('T on a focused card awaiting a check opens its menu; never elsewhere', () => {
    reset(); setupTypeChips()
    const vp = $.canvasViewport()
    const prev = vp.getAttribute('style')
    const saved = { ...view }
    vp.setAttribute('style', 'display:block;position:fixed;left:-4000px;top:0;width:400px;height:300px')
    const press = (target, key = 't') => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    try {
      const el = block('a', { type: 'custom', typeCheck: true })
      const plain = block('b', { type: 'goal' })
      assert.eq(el.getAttribute('aria-keyshortcuts'), 'T', 'the card announces the key')
      assert.eq(plain.getAttribute('aria-keyshortcuts'), null)

      el.focus()
      assert.eq(document.activeElement, el)
      press(el)
      assert.ok(isMenuOpen(), 'T opens the type check')
      assert.includes(document.querySelector('.pf-menu.type-check-menu .pf-menu-item').textContent, 'Looks right')
      closeMenus()

      plain.focus(); press(plain)
      assert.ok(!isMenuOpen(), 'a confirmed card has nothing to check')

      // Focus on the page, one card selected: that card.
      selectBlock('a'); document.activeElement?.blur()
      press(document.body, 'T')
      assert.ok(isMenuOpen(), 'the selected card when focus is on the page')
      closeMenus()

      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus(); press(input)
      input.remove()
      assert.ok(!isMenuOpen(), 'never while typing')

      ui.readOnly = true
      el.focus(); press(el)
      assert.ok(!isMenuOpen(), 'a view-only link cannot confirm a type')
    } finally {
      ui.readOnly = false
      closeMenus()
      document.activeElement?.blur()
      if (prev == null) vp.removeAttribute('style'); else vp.setAttribute('style', prev)
      Object.assign(view, saved)
      reset()
    }
  })

  it('the dashed mark under an unconfirmed type is drawn, not clipped, and moves nothing', async () => {
    reset()
    const checked = block('a', { type: 'custom', typeCheck: true })
    const plain = block('b', { type: 'custom' })
    for (const theme of ['', 'light-mode']) {
      const s = await styled(theme)
      try {
        const card = s.place(checked, 60, 60)
        const other = s.place(plain, 400, 60)
        const label = card.querySelector('.block-type-label')
        const cs = getComputedStyle(label)
        assert.eq(cs.borderBottomStyle, 'dashed', `${theme || 'dark'}: a dashed edge under the label`)
        assert.eq(cs.borderBottomWidth, '1px')
        assert.eq(cs.textDecorationLine, 'none', 'no underline for overflow:hidden to clip')
        const btn = card.querySelector('.block-type-check').getBoundingClientRect()
        assert.ok(label.getBoundingClientRect().bottom <= btn.bottom + 0.5, 'the dash sits inside the button')
        assert.eq(card.offsetHeight, other.offsetHeight, 'the check does not change the card height')
      } finally { s.done() }
    }
  })
})

// ── Palette ─────────────────────────────────────────────────

describe('cards -- palette grouped by step', () => {
  it('lists all types once, grouped in step order, as real buttons', () => {
    const list = document.createElement('div')
    renderPaletteTypes(list)
    const groups = [...list.querySelectorAll('.palette-step')]
    const expected = typesByStep().filter(g => g.types.length)
    assert.deepEq(groups.map(g => g.dataset.step), expected.map(g => g.step))
    assert.deepEq(groups.map(g => g.querySelector('.palette-step-head').textContent),
      expected.map(g => TYPE_STEPS.find(s => s.id === g.step).label))
    assert.deepEq(groups.map(g => g.dataset.step).slice(0, 6), ['why', 'who', 'proof', 'what', 'how', 'doubt'])
    groups.forEach(g => assert.includes(g.querySelector('.palette-step-head').title, TYPE_STEPS.find(s => s.id === g.dataset.step).hint))
    const rows = [...list.querySelectorAll('.palette-item')]
    assert.eq(rows.length, Object.keys(TYPES).length)
    assert.eq(Object.keys(TYPES).length, 16)
    assert.deepEq(rows.map(r => r.dataset.type).sort(), Object.keys(TYPES).sort(), 'each type exactly once')
    rows.forEach(r => {
      assert.eq(r.tagName, 'BUTTON')
      assert.eq(r.getAttribute('aria-label'), `Add ${TYPES[r.dataset.type].label} block`)
      assert.eq(list.querySelector('#' + r.getAttribute('aria-describedby')).textContent, TYPES[r.dataset.type].short)
    })
  })

  // One palette for the rest of this file, wired the way app.js wires it.
  let pal = null
  function palette() {
    if (pal) return pal
    pal = document.createElement('aside')
    pal.id = 'palette'; pal.className = 'palette'; pal.style.display = 'none'
    pal.innerHTML = '<div id="blocksList"></div>'
    document.body.append(pal)
    setupPalette()
    setupPalette()   // a second setup must not wire anything twice
    return pal
  }

  it('Enter on a row adds exactly one block of that type, in title edit', () => {
    reset()
    const row = palette().querySelector('.palette-item[data-type="risk"]')
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    const ids = Object.keys(state.blocks)
    assert.eq(ids.length, 1)
    assert.eq(state.blocks[ids[0]].type, 'risk')
    assert.ok(isInlineEditing(), 'the new card opens in title edit')
    assert.eq(getUndoHistory().length, 1, 'one undo step')
    reset()
  })

  it('dragging a row onto the canvas drops that type where it was released', () => {
    reset()
    const row = palette().querySelector('.palette-item[data-type="stakeholder"]')
    const vp = $.canvasViewport()
    const prev = vp.getAttribute('style')
    const saved = { ...view }
    row.setPointerCapture = () => {}
    vp.setAttribute('style', 'display:block;position:fixed;left:0;top:0;width:400px;height:300px')
    Object.assign(view, { panX: 0, panY: 0, zoom: 1 })
    const ev = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 5, pointerType: 'mouse', button: 0, clientX: x, clientY: y }))
    try {
      ev(row, 'pointerdown', 500, 500)
      ev(row, 'pointermove', 480, 480)
      ev(row, 'pointermove', 200, 150)
      assert.ok(document.querySelector('.palette-drag-ghost'), 'a ghost follows the pointer')
      ev(document, 'pointerup', 200, 150)
      const ids = Object.keys(state.blocks)
      assert.eq(ids.length, 1, 'one block')
      const b = state.blocks[ids[0]]
      assert.eq(b.type, 'stakeholder')
      assert.ok(Math.abs(b.x + 110 - 200) < 2, 'centred on the drop point')
      assert.eq(document.querySelector('.palette-drag-ghost'), null)
    } finally {
      delete row.setPointerCapture
      if (prev == null) vp.removeAttribute('style'); else vp.setAttribute('style', prev)
      Object.assign(view, saved)
      reset()
    }
  })

  it('hovering a row shows one tip with the type\'s guidance', () => {
    const row = palette().querySelector('.palette-item[data-type="metric"]')
    row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
    const tip = document.querySelector('.palette-tip')
    assert.ok(tip && !tip.hidden, 'the tip shows')
    assert.includes(tip.textContent, TYPES.metric.label)
    assert.includes(tip.textContent, TYPES.metric.tip)
    row.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }))
    assert.ok(tip.hidden, 'and hides again')
    row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' }))
    assert.ok(tip.hidden, 'touch has no hover, so no tip')
  })

  it('the tip never says the short line twice', () => {
    const p = palette()
    Object.entries(TYPES).forEach(([t, cfg]) => {
      p.querySelector(`.palette-item[data-type="${t}"]`)
        .dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      const text = document.querySelector('.palette-tip').textContent.toLowerCase()
      assert.eq(text.split(cfg.short.toLowerCase()).length - 1, 1, `${t}: "${cfg.short}" once`)
      assert.includes(text, cfg.tip.toLowerCase(), `${t}: the tip itself is kept`)
    })
    p.dispatchEvent(new FocusEvent('focusout'))
  })

  it('a keyboard user keeps the tip when the palette scrolls to the focused row', () => {
    const p = palette()
    const prev = p.getAttribute('style')
    p.setAttribute('style', 'display:block;position:fixed;left:-4000px;top:0;width:200px;height:80px;overflow:auto')
    const tip = () => document.querySelector('.palette-tip')
    const rows = [...p.querySelectorAll('.palette-item')]
    try {
      const row = rows[rows.length - 3]
      row.focus({ preventScroll: true })
      row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      assert.ok(!tip().hidden)
      p.scrollTop = 40
      p.dispatchEvent(new Event('scroll'))
      assert.ok(!tip().hidden, 'the focused row\'s tip follows it through the scroll')
      assert.includes(tip().textContent, TYPES[row.dataset.type].label)

      // A hover tip for a row that is not focused goes when the rows move.
      rows[1].dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
      assert.ok(!tip().hidden)
      p.dispatchEvent(new Event('scroll'))
      assert.ok(tip().hidden, 'a wheel scroll hides a hover tip')
    } finally {
      document.activeElement?.blur()
      if (prev == null) p.removeAttribute('style'); else p.setAttribute('style', prev)
    }
  })

  it('small palette and starter text stays readable: 11px step heads, 4.5:1 step labels', async () => {
    const s = await styled('light-mode')
    try {
      // The collapsed palette, and the 48px palette under 1024px.
      s.page.innerHTML = '<aside class="palette collapsed"><div id="pl"></div></aside>'
      renderPaletteTypes(s.page.querySelector('#pl'))
      assert.ok(parseFloat(getComputedStyle(s.page.querySelector('.palette-step-head')).fontSize) >= 11, 'collapsed palette')
      const narrow = []
      const walk = rules => [...rules].forEach(r => {
        if (r.media && /max-width:\s*1024px/.test(r.media.mediaText)) {
          [...r.cssRules].forEach(x => /\.palette-step-head/.test(x.selectorText || '') && x.style.fontSize && narrow.push(x.style.fontSize))
        } else if (r.cssRules && !r.selectorText) walk(r.cssRules)
      })
      walk(s.sheet.cssRules)
      assert.ok(narrow.length > 0)
      // A declared size may be a token (var(--fs-11)): resolve it in the tree.
      const px = v => { const p = document.createElement('span'); p.style.fontSize = v; s.page.appendChild(p); const r = parseFloat(getComputedStyle(p).fontSize); p.remove(); return r }
      narrow.forEach(f => assert.ok(px(f) >= 11, `tablet palette head ${f} (${px(f)}px)`))

      for (const theme of ['light-mode', '']) {
        s.page.className = ('pf-body ' + theme).trim()
        // The start panel's first-block pills, on the panel's own surface.
        s.page.innerHTML = `<div class="brain-dump-card"><div class="start-pills">${firstBlockPillsHtml()}</div></div>`
        const page = over(rgb(getComputedStyle(s.page).backgroundColor), [255, 255, 255])
        const card = over(rgb(getComputedStyle(s.page.firstChild).backgroundColor), page)
        for (const btn of s.page.querySelectorAll('.start-pill')) {
          const fill = over(rgb(getComputedStyle(btn).backgroundColor), card)
          const ratio = contrast(over(rgb(getComputedStyle(btn).color), fill), fill)
          assert.ok(ratio >= 4.5, `${theme || 'dark'} ${btn.dataset.type} pill: ${ratio.toFixed(2)}:1`)
        }
      }
    } finally { s.done() }
  })

  it('the first-block pills name their type as their whole name, and each adds that type', () => {
    const row = document.createElement('div')
    row.innerHTML = firstBlockPillsHtml()
    const btns = [...row.querySelectorAll('button.start-pill')]
    assert.deepEq(btns.map(b => b.dataset.type), FIRST_BLOCK_TYPES)
    btns.forEach(b => {
      assert.ok(!b.hasAttribute('aria-label'), 'the visible words are the accessible name (WCAG 2.5.3)')
      assert.eq(b.textContent, TYPES[b.dataset.type].label)
    })

    palette()
    for (const type of ['goal', 'metric', 'question']) {
      reset()
      addTypeAtCenter(row.querySelector(`.start-pill[data-type="${type}"]`).dataset.type)
      const ids = Object.keys(state.blocks)
      assert.eq(ids.length, 1, `${type}: one block`)
      assert.eq(state.blocks[ids[0]].type, type)
      assert.ok(isInlineEditing(), `${type}: opens in title edit`)
    }
    reset()
  })
})

// ── Empty state copy ────────────────────────────────────────

describe('cards -- empty state', () => {
  it('the hint says only what each view can do', async () => {
    const html = await (await fetch('../index.html')).text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const hint = doc.getElementById('canvasHint')
    assert.includes(hint.querySelector('.canvas-hint-edit').textContent, 'Double-click empty canvas to add a block')
    assert.includes(hint.querySelector('.canvas-hint-edit').textContent, 'Double-click a card to edit it')
    assert.ok(!/arrow keys|Fit view/i.test(hint.textContent), 'no promise the app does not keep')
    assert.ok(doc.querySelector('#brainDump #startFirstBlocks .start-pill'), 'the first-block pills sit in the start panel')
    assert.eq(doc.querySelectorAll('#blocksList .palette-item').length, 0, 'the palette rows come from the registry')

    const s = await styled('readonly-mode')
    try {
      s.page.innerHTML = hint.outerHTML
      assert.eq(getComputedStyle(s.page.querySelector('.canvas-hint-view')).display, 'block')
      assert.eq(getComputedStyle(s.page.querySelector('.canvas-hint-edit')).display, 'none')
      s.page.classList.remove('readonly-mode')
      assert.eq(getComputedStyle(s.page.querySelector('.canvas-hint-view')).display, 'none')
    } finally { s.done() }
  })
})

// ── QA round ────────────────────────────────────────────────
describe('cards -- QA round', () => {
  const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))

  it('the gap badge reads on its own surface on every preset, in both themes', async () => {
    reset()
    const types = ['requirement', 'metric', 'assumption', 'decision', 'question', 'context', 'goal']
    const presets = ['header', 'outline', 'tint', 'bar', 'plain']
    const els = types.map((t, i) => block('h' + i, { type: t, cardStyle: presets[i % presets.length], x: 40 + i * 20 }))
    runGapDetection()
    for (const theme of ['', 'light-mode']) {
      const s = await styled(theme)
      try {
        els.forEach((el, i) => {
          const card = s.place(el)
          const icon = card.querySelector('.block-gap-icons .gap-icon')
          assert.ok(icon, `${types[i]}: an isolated card shows its gap badge`)
          const page = over(rgb(getComputedStyle(s.page).backgroundColor), [255, 255, 255])
          const cs = getComputedStyle(icon)
          const surface = over(rgb(cs.backgroundColor), page)
          // The icon is a graphic (3:1, WCAG 1.4.11) in the attention hue; the
          // gap's name, the text, is text-1 on its own label at 4.5:1.
          const r = contrast(over(rgb(cs.color), surface), surface)
          assert.ok(r >= 3, `${theme || 'dark'} ${types[i]}: gap icon ${r.toFixed(2)}:1 on its badge`)
          const name = getComputedStyle(card.querySelector('.gap-name'))
          const label = over(rgb(name.backgroundColor), page)
          const rn = contrast(over(rgb(name.color), label), label)
          assert.ok(rn >= 4.5, `${theme || 'dark'} ${types[i]}: gap name ${rn.toFixed(2)}:1 on its label`)
          const edge = contrast(over(rgb(cs.borderTopColor), surface), surface)
          assert.ok(edge >= 3, `${theme || 'dark'} ${types[i]}: badge edge ${edge.toFixed(2)}:1`)
          assert.eq(getComputedStyle(card.querySelector('.block-gap-icons')).position, 'absolute', 'a corner badge, out of the header row')
        })
      } finally { s.done() }
    }
    reset()
  })

  it('tinted cards keep their description at 4.5:1 on the lightest and darkest tints', async () => {
    reset()
    const el = block('t', { type: 'requirement', cardStyle: 'tint', description: 'Every lead sees it on Monday.' })
    const s = await styled('light-mode')
    try {
      const card = s.place(el)
      const ink = rgb(getComputedStyle(card.querySelector('.block-desc')).color)
      // The light tint is the type colour at 14% over white, at its strongest.
      Object.entries(TYPES).forEach(([id, t]) => {
        const fill = hexRgb(t.light).map(c => c * 0.14 + 255 * 0.86)
        const r = contrast(over(ink, fill), fill)
        assert.ok(r >= 4.5, `light ${id} tint: description ${r.toFixed(2)}:1`)
      })
    } finally { s.done() }
    reset()
  })

  it('the palette rail captions its section toggles, so + and - do not read as zoom', async () => {
    const html = await (await fetch('../index.html')).text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const toggles = [...doc.querySelectorAll('.palette-section-toggle')]
    assert.deepEq(toggles.map(t => t.dataset.rail), ['Tpl', 'Types'])
    const s = await styled()
    try {
      s.page.innerHTML = '<aside class="palette collapsed">' + toggles.map(t => t.outerHTML).join('') + '</aside>'
      s.page.querySelectorAll('.palette-section-toggle').forEach(t => {
        const content = getComputedStyle(t, '::after').content
        assert.ok(content && content !== 'none' && content !== 'normal', `the rail shows a caption (${content})`)
      })
      s.page.firstChild.classList.remove('collapsed')
      if (window.innerWidth > 1024) {
        const content = getComputedStyle(s.page.querySelector('.palette-section-toggle'), '::after').content
        assert.ok(content === 'none' || content === 'normal', 'the full palette keeps its words and no caption')
      }
    } finally { s.done() }
  })

  it('highlight hints describe what is drawn at rest, and name the toggle that animates it', () => {
    assert.ok(!/pulsing|moving/i.test(HIGHLIGHTS.alert.hint + HIGHLIGHTS.festive.hint), 'no motion promised at rest')
    assert.includes(HIGHLIGHTS.alert.hint, 'Animate highlights')
    assert.includes(HIGHLIGHTS.festive.hint, 'Animate highlights')
  })
})
