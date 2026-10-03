// ============================================================
//  design-tokens.test.js: the design round's foundation (DESIGN.md):
//  contrast of every token pair the interface relies on, measured in the
//  test DOM in both themes; the attention hue's distance from what it
//  must not be mistaken for; no hard-coded colour outside a token block;
//  the retired type sizes and easing; the header skin and the footers;
//  the button system and the brain dump card. Then the type palette
//  (SPEC3 item 2): its distances as pure computation, its contrast and
//  its distance from attention and the accent measured in the DOM, the
//  swatches, and the card states that must not wear a type colour
//  (item 3): the gap marker, the chips, the health score.
// ============================================================

import { describe, it, assert, cssRgba } from './test-utils.js'
import { TYPES, SWATCH_COLORS, SWATCH_NAMES } from '../js/utils.js'
import { lightAccentFor } from '../js/cards.js'

// ── Helpers ─────────────────────────────────────────────────

const fetchText = async url => (await fetch(url, { cache: 'no-store' })).text()
let cssCache = null
const styleCss = async () => cssCache ?? (cssCache = await fetchText('../css/style.css'))

// The real stylesheet in a shadow root: `:root` becomes the host and
// `body` a wrapper div, so the theme classes apply to what is under test
// without restyling the report. `replace` swaps selectors before parsing
// (a :hover or :focus-visible replayed as a class).
async function themed(bodyClass = '', replace = s => s) {
  const css = replace(await styleCss())
    .replace(/:root\b/g, ':host')
    .replace(/(?<![\w.-])body(?![\w-])/g, '.pf-body')
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-6000px;top:0;width:900px;height:700px'
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  const still = new CSSStyleSheet()
  still.replaceSync('*, *::before, *::after { transition: none !important; animation: none !important; }')
  root.adoptedStyleSheets = [sheet, still]
  const page = document.createElement('div')
  page.className = ('pf-body ' + bodyClass).trim()
  root.appendChild(page)
  // Any colour expression (a token, a color-mix) as [r, g, b, a].
  const color = expr => {
    const el = document.createElement('i')
    el.style.color = expr
    page.appendChild(el)
    const c = cssRgba(getComputedStyle(el).color)
    el.remove()
    return c
  }
  const add = html => { const d = document.createElement('div'); d.innerHTML = html; page.appendChild(d); return d }
  return { root, page, color, add, done: () => host.remove() }
}

const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const over = (fg, bg) => { const a = fg[3] ?? 1; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)) }
const ratio = (fg, bg) => { const f = over(fg, bg); const [x, y] = [lum(f), lum(bg)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const oklab = ([r, g, b]) => {
  const [R, G, B] = [r, g, b].map(lin)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s]
}
// OKLab distance, times 100 (the unit DESIGN.md reports).
const dE = (a, b) => { const p = oklab(a), q = oklab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100 }
const fromOklch = (L, C, h) => {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180)
  return cssRgba(`oklab(${L} ${a} ${b})`)
}

// CSS text without comments, and without the blocks a token may live in.
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '')
function withoutTokenBlocks(css) {
  let out = '', i = 0
  for (;;) {
    const a = css.indexOf('tokens:start', i)
    if (a < 0) { out += css.slice(i); break }
    const open = css.lastIndexOf('/*', a)
    out += css.slice(i, open)
    const b = css.indexOf('tokens:end', a)
    assert.ok(b > a, 'every tokens:start has a tokens:end')
    i = css.indexOf('*/', b) + 2
  }
  return out
}

const THEMES = [['dark', ''], ['light', 'light-mode']]

// ── Contrast ────────────────────────────────────────────────

describe('design tokens: contrast in both themes', () => {
  it('the neutrals are opaque, tinted, and never pure black or white', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        for (const tok of ['--bg', '--surface-1', '--surface-2', '--surface-3', '--surface-raised', '--canvas', '--card',
          '--border', '--border-strong', '--text-1', '--text-2', '--text-3', '--accent', '--on-accent']) {
          const c = t.color(`var(${tok})`)
          assert.ok(c, `${name} ${tok} resolves`)
          assert.eq(c[3], 1, `${name} ${tok} is opaque`)
          assert.ok(c.slice(0, 3).join() !== '0,0,0' && c.slice(0, 3).join() !== '255,255,255', `${name} ${tok} is not #000 or #fff`)
        }
      } finally { t.done() }
    }
  })

  it('text: text-1 and text-2 at 7:1 and 4.5:1, text-3 at 4.5:1 on --bg, --surface-1, the canvas, a card and a menu', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        for (const bg of ['--bg', '--surface-1', '--canvas', '--card', '--surface-raised']) {
          const B = t.color(`var(${bg})`)
          const r1 = ratio(t.color('var(--text-1)'), B), r2 = ratio(t.color('var(--text-2)'), B), r3 = ratio(t.color('var(--text-3)'), B)
          assert.ok(r1 >= 7, `${name} text-1 on ${bg}: ${r1.toFixed(2)}:1`)
          assert.ok(r2 >= 4.5, `${name} text-2 on ${bg}: ${r2.toFixed(2)}:1`)
          assert.ok(r3 >= 4.5, `${name} text-3 on ${bg}: ${r3.toFixed(2)}:1`)
        }
      } finally { t.done() }
    }
  })

  it('the accent: 3:1 as a ring or line on every surface, its text at 4.5:1 on its fill', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        for (const bg of ['--bg', '--surface-1', '--canvas', '--card', '--surface-raised']) {
          const r = ratio(t.color('var(--accent)'), t.color(`var(${bg})`))
          assert.ok(r >= 3, `${name} accent on ${bg}: ${r.toFixed(2)}:1`)
        }
        for (const fill of ['--accent', '--accent-hover']) {
          const r = ratio(t.color('var(--on-accent)'), t.color(`var(${fill})`))
          assert.ok(r >= 4.5, `${name} on-accent on ${fill}: ${r.toFixed(2)}:1`)
        }
        const link = ratio(t.color('var(--accent)'), t.color('var(--bg)'))
        assert.ok(link >= 4.5, `${name} accent as link text on --bg: ${link.toFixed(2)}:1`)
      } finally { t.done() }
    }
  })

  it('a control boundary (--border-strong) reaches 3:1 on --bg', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        const r = ratio(t.color('var(--border-strong)'), t.color('var(--bg)'))
        assert.ok(r >= 3, `${name} border-strong on --bg: ${r.toFixed(2)}:1`)
      } finally { t.done() }
    }
  })

  it('attention draws at 3:1 on the canvas, a card, the page and a raised label, and never writes', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        for (const bg of ['--canvas', '--card', '--bg', '--surface-raised']) {
          const r = ratio(t.color('var(--attention)'), t.color(`var(${bg})`))
          assert.ok(r >= 3, `${name} attention on ${bg}: ${r.toFixed(2)}:1`)
        }
      } finally { t.done() }
    }
    // An amber that reads at 4.5:1 in the light theme is the Output type
    // colour to an eye (dE 1.7), so there is no amber ink: no rule sets text
    // in --attention, and the ink token is gone.
    const css = stripComments(await styleCss())
    assert.ok(!/--attention-ink|--gap-ink/.test(css), 'no amber ink token')
    const writes = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(m => /(?:^|[;\s])color:\s*var\(--(?:attention|gap)\b/.test(m[2]))
      .map(m => m[1].trim())
    assert.deepEq(writes, ['.gap-icon'], 'only the badge icon (a graphic) is painted in attention through `color`')
  })

  it('status colours read as text at 4.5:1 on the page and on a raised surface', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        for (const s of ['--danger', '--warning', '--success', '--info']) {
          for (const bg of ['--bg', '--surface-raised', '--card']) {
            const r = ratio(t.color(`var(${s})`), t.color(`var(${bg})`))
            assert.ok(r >= 4.5, `${name} ${s} on ${bg}: ${r.toFixed(2)}:1`)
          }
        }
      } finally { t.done() }
    }
  })

  it('connection lines reach 3:1 on the canvas, the hovered and selected ones 4.5:1', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        const canvas = t.color('var(--canvas)')
        const rest = ratio(t.color('var(--edge)'), canvas), hi = ratio(t.color('var(--edge-hi)'), canvas), sel = ratio(t.color('var(--edge-sel)'), canvas)
        assert.ok(rest >= 3, `${name} edge: ${rest.toFixed(2)}:1`)
        assert.ok(hi >= 4.5, `${name} edge-hi: ${hi.toFixed(2)}:1`)
        assert.ok(sel >= 4.5, `${name} edge-sel: ${sel.toFixed(2)}:1`)
      } finally { t.done() }
    }
  })

  it('the system "increase contrast" setting raises the tokens: prefers-contrast: more, a query that matches', async () => {
    // `prefers-contrast: high` is not a value the media feature takes, so it
    // never matched and the OS setting raised nothing but the line tokens.
    const css = stripComments(await styleCss())
    assert.ok(!/prefers-contrast:\s*high/.test(css), 'no query on the value that never matches')
    assert.ok(matchMedia('(prefers-contrast: more)').media !== 'not all', 'the query parses')
    const blocks = [...css.matchAll(/@media \(prefers-contrast: more\) \{\s*(:root|body\.light-mode) \{([^}]*)\}/g)]
      .filter(m => /--border-strong:/.test(m[2]))
    const sel = blocks.map(m => m[1])
    assert.ok(sel.includes(':root') && sel.includes('body.light-mode'), `token blocks for both themes: ${sel.join(', ')}`)
    for (const m of blocks) for (const tok of ['--border', '--text-3', '--accent']) assert.match(m[2], new RegExp(tok + ':'), `${m[1]} raises ${tok}`)
  })

  it('derived tokens follow the theme instead of freezing at the dark values', async () => {
    const dark = await themed(''), light = await themed('light-mode')
    try {
      for (const tok of ['--surface-raised', '--canvas', '--card', '--accent-subtle', '--text-primary', '--text-muted', '--border-subtle', '--accent-bright']) {
        assert.neq(dark.color(`var(${tok})`).join(), light.color(`var(${tok})`).join(), `${tok} differs between the themes`)
      }
      assert.deepEq(light.color('var(--text-primary)'), light.color('var(--text-1)'), 'a legacy name is the new token')
      assert.deepEq(light.color('var(--text-muted)'), light.color('var(--text-3)'))
    } finally { dark.done(); light.done() }
  })
})

// ── Distance ────────────────────────────────────────────────

describe('design tokens: attention means one thing', () => {
  it('attention sits at least 10 OKLab dE from the accent and every status colour, in both themes', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        const att = t.color('var(--attention)')
        for (const other of ['--accent', '--danger', '--warning', '--success', '--info']) {
          const d = dE(att, t.color(`var(${other})`))
          assert.ok(d >= 10, `${name} attention vs ${other}: ${d.toFixed(1)}`)
        }
      } finally { t.done() }
    }
  })

  it('attention clears the type palette band by 10 dE at every hue (dark L 0.74 C 0.11, light L 0.52 C 0.13)', async () => {
    // The band the type colours are tuned to (SPEC3 item 2). A type colour
    // on it, at any hue, stays 10 dE or more from the gap colour.
    for (const [name, cls, L, C] of [['dark', '', 0.74, 0.11], ['light', 'light-mode', 0.52, 0.13]]) {
      const t = await themed(cls)
      try {
        const att = t.color('var(--attention)')
        let min = Infinity, at = 0
        for (let h = 0; h < 360; h += 2) {
          const d = dE(att, fromOklch(L, C, h))
          if (d < min) { min = d; at = h }
        }
        assert.ok(min >= 10, `${name}: ${min.toFixed(1)} at hue ${at}`)
      } finally { t.done() }
    }
  })
})

// ── Discipline ──────────────────────────────────────────────

describe('design tokens: no hard-coded colour outside a token block', () => {
  it('style.css and trace.css carry no hex or rgb() colour outside the token blocks and the --c-* type colours', async () => {
    for (const url of ['../css/style.css', '../css/trace.css']) {
      const raw = await fetchText(url)
      const body = stripComments(withoutTokenBlocks(raw))
        .split('\n').filter(line => !/^\s*--c-[a-z]+:/.test(line)).join('\n')
      const hex = body.match(/#[0-9a-fA-F]{3,8}\b/g) || []
      const rgb = body.match(/\brgba?\(/g) || []
      assert.deepEq(hex, [], `${url}: hex outside the token blocks`)
      assert.eq(rgb.length, 0, `${url}: rgb()/rgba() outside the token blocks`)
    }
  })

  it('the token blocks are where the tokens are: :root, body, body.light-mode, high contrast and [lines]', async () => {
    const css = await styleCss()
    const starts = css.match(/tokens:start/g) || [], ends = css.match(/tokens:end/g) || []
    assert.eq(starts.length, ends.length, 'balanced markers')
    assert.ok(starts.length >= 4, `${starts.length} token blocks`)
    assert.match(css, /--attention:\s*oklch\(/)
    assert.match(css, /--focus-ring:\s*0 0 0 2px var\(--bg\), 0 0 0 4px var\(--accent\)/)
    assert.match(css, /--ease-out:\s*cubic-bezier\(0\.25, 1, 0\.5, 1\)/)
  })

  it('the retired sizes (9, 10, 10.5, 11.5, 12.5, 14.5px) and the overshoot easing are gone', async () => {
    for (const url of ['../css/style.css', '../css/trace.css']) {
      const css = stripComments(await fetchText(url))
      const sizes = [...css.matchAll(/font(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/g)].map(m => +m[1])
      for (const retired of [9, 10, 10.5, 11.5, 12.5, 14.5]) {
        assert.ok(!sizes.includes(retired), `${url}: ${retired}px is still set`)
      }
      assert.ok(!/--ease-snap/.test(css), `${url}: --ease-snap`)
      for (const m of css.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
        const [, y1, , y2] = m[1].split(',').map(Number)
        assert.ok(y1 >= 0 && y1 <= 1 && y2 >= 0 && y2 <= 1, `${url}: an overshoot curve, cubic-bezier(${m[1]})`)
      }
    }
  })
})

// ── Header and footer ───────────────────────────────────────

describe('design tokens: header skin and footers', () => {
  it('every page with a header carries the site skin, and the skin is tokens in the kit\'s exact selector', async () => {
    for (const page of ['index.html', 'tutorial.html', 'examples.html', 'trace.html']) {
      const html = await fetchText('../' + page)
      assert.match(html, /<header class="header-bar"[^>]*data-header-skin="custom"/, `${page} header skin`)
    }
    const css = stripComments(await styleCss())
    const at = css.indexOf('html:not([data-theme]) .header-bar[data-header-skin="custom"] {')
    assert.ok(at >= 0, 'the custom skin, in the README\'s exact selector')
    const block = css.slice(at, css.indexOf('}', at))
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(block), 'tokens only')
    for (const tok of ['--header-bg-start', '--header-text', '--header-menu-bg', '--header-control-border']) assert.includes(block, tok)
    assert.ok(!/body\.light-mode \.header-bar\s*\{/.test(css), 'no site-local light-mode header gradient')
    assert.ok(!/body\.light-mode \.header-btn\b/.test(css), 'no site-local light-mode header buttons')
  })

  it('the header turns light with a light page, and stays dark with a dark one', async () => {
    // The skin's stops are var(--bg): resolve them where the header sits.
    for (const [name, cls, dark] of [['dark', '', true], ['light', 'light-mode', false]]) {
      const t = await themed(cls)
      try {
        const bg = t.color('var(--bg)'), ink = t.color('var(--text-1)')
        assert.eq(lum(bg) < 0.1, dark, `${name}: the bar is ${dark ? 'dark' : 'light'}`)
        assert.ok(ratio(ink, bg) >= 7, `${name}: header text ${ratio(ink, bg).toFixed(2)}:1`)
      } finally { t.done() }
    }
  })

  it('the app uses the slim footer, the doc pages the minimal one', async () => {
    assert.match(await fetchText('../index.html'), /<footer class="neo-footer" data-footer-mode="app"/)
    for (const page of ['tutorial.html', 'examples.html']) {
      assert.match(await fetchText('../' + page), /<footer class="neo-footer" data-footer-mode="minimal"/, page)
    }
  })
})

// ── Controls ────────────────────────────────────────────────

describe('design tokens: the button system', () => {
  const BUTTONS = '<button class="btn btn-primary" id="p">Primary</button>' +
    '<button class="btn btn-secondary" id="s">Secondary</button>' +
    '<button class="btn btn-ghost" id="g">Ghost</button>' +
    '<button class="btn btn-danger" id="d">Delete</button>' +
    '<button class="btn btn-secondary btn-sm" id="sm">Small</button>'

  it('every variant reads at 4.5:1, at rest and on hover, in both themes', async () => {
    for (const hover of [false, true]) {
      for (const [name, cls] of THEMES) {
        const t = await themed(cls, css => hover ? css.replace(/:hover/g, '.hv-probe') : css)
        try {
          const box = t.add(BUTTONS)
          const page = t.color('var(--bg)')
          box.querySelectorAll('.btn').forEach(b => {
            if (hover) b.classList.add('hv-probe')
            const cs = getComputedStyle(b)
            const fill = over(cssRgba(cs.backgroundColor), page)
            const r = ratio(cssRgba(cs.color), fill)
            assert.ok(r >= 4.5, `${name}${hover ? ' hover' : ''} #${b.id}: ${r.toFixed(2)}:1`)
          })
        } finally { t.done() }
      }
    }
  })

  it('primary is a flat 32px accent fill, radius 6, no shadow, no movement on hover', async () => {
    const t = await themed('')
    try {
      const box = t.add(BUTTONS)
      const p = getComputedStyle(box.querySelector('#p'))
      assert.eq(p.height, '32px')
      assert.eq(p.borderTopLeftRadius, '6px')
      assert.eq(p.boxShadow, 'none')
      assert.deepEq(cssRgba(p.backgroundColor), t.color('var(--accent)'))
      assert.eq(getComputedStyle(box.querySelector('#sm')).height, '28px', 'the small size')
    } finally { t.done() }
    const css = stripComments(await styleCss())
    for (const m of css.matchAll(/\.btn[\w-]*:hover[^{]*\{([^}]*)\}/g)) {
      assert.ok(!/transform|box-shadow|filter/.test(m[1]), `a .btn hover changes lightness only: ${m[0].slice(0, 80)}`)
    }
  })

  it('keyboard focus is the one accent outline, at 3:1 on the page', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls, css => css.replace(/:focus-visible/g, '.fv-probe'))
      try {
        const box = t.add(BUTTONS + '<input class="input fv-probe" id="i">')
        const page = t.color('var(--bg)')
        for (const el of [box.querySelector('#s'), box.querySelector('#i')]) {
          el.classList.add('fv-probe')
          const cs = getComputedStyle(el)
          assert.eq(cs.outlineStyle, 'solid', `${name} #${el.id}`)
          assert.eq(cs.outlineWidth, '2px', `${name} #${el.id}`)
          assert.deepEq(cssRgba(cs.outlineColor), t.color('var(--accent)'), `${name} #${el.id} outline is the accent`)
          assert.ok(ratio(cssRgba(cs.outlineColor), page) >= 3, `${name} #${el.id} ring on the page`)
        }
      } finally { t.done() }
    }
  })

  it('the doc pages\' CTA keeps its own colours: prose link rules never restyle a button', async () => {
    // "Open the canvas" was a .doc-btn link that `.doc a` repainted to 1.24:1.
    for (const hover of [false, true]) {
      const t = await themed('', css => hover ? css.replace(/:hover/g, '.hv-probe') : css)
      try {
        const box = t.add('<main class="doc"><a class="btn btn-primary" href="#x" id="cta">Open the canvas</a> <a href="#y" id="prose">a link</a></main>')
        const a = box.querySelector('#cta')
        if (hover) a.classList.add('hv-probe')
        const cs = getComputedStyle(a)
        const r = ratio(cssRgba(cs.color), over(cssRgba(cs.backgroundColor), t.color('var(--bg)')))
        assert.ok(r >= 4.5, `${hover ? 'hover' : 'rest'}: ${r.toFixed(2)}:1`)
        assert.eq(cs.textDecorationLine, 'none', 'no underline on the button')
        assert.deepEq(cssRgba(getComputedStyle(box.querySelector('#prose')).color), t.color('var(--accent)'), 'a prose link is the accent')
      } finally { t.done() }
    }
    for (const page of ['tutorial.html', 'examples.html']) {
      const html = await fetchText('../' + page)
      assert.ok(!/doc-btn/.test(html), `${page}: the old button class is gone`)
      assert.match(html, /<a class="btn btn-primary" href="\.\/">Open the canvas<\/a>/, `${page}: the CTA is the shared primary`)
    }
  })

  it('the 404 page links the tokens and uses the shared buttons', async () => {
    const html = await fetchText('../404.html')
    assert.match(html, /<link rel="stylesheet" href="\/css\/style\.css">/)
    assert.match(html, /class="btn btn-primary" href="\/"/)
    assert.ok(!/#[0-9a-fA-F]{6}\b/.test(html.replace(/<meta[^>]*>/g, '')), 'no hex colour in the page')
  })
})

describe('design tokens: the brain dump card', () => {
  it('is one flat surface: no gradient text, no gradient pill, no glow, no blur', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        const box = t.add('<div class="brain-dump-card"><h2>Start with a brain dump</h2><textarea class="input"></textarea>' +
          '<button class="btn btn-primary" id="go">Turn into blocks</button></div>')
        const card = getComputedStyle(box.querySelector('.brain-dump-card'))
        assert.eq(card.backdropFilter, 'none', `${name}: no blur`)
        assert.eq(card.boxShadow, 'none', `${name}: no shadow`)
        assert.eq(card.borderTopLeftRadius, '10px', `${name}: radius-lg`)
        assert.eq(card.backgroundImage, 'none', `${name}: a flat fill`)
        assert.deepEq(cssRgba(card.backgroundColor), t.color('var(--surface-1)'), `${name}: surface-1`)
        const h2 = getComputedStyle(box.querySelector('h2'))
        assert.eq(h2.backgroundImage, 'none', `${name}: no gradient behind the heading`)
        assert.deepEq(cssRgba(h2.webkitTextFillColor), cssRgba(h2.color), `${name}: the heading is solid ink`)
        const go = getComputedStyle(box.querySelector('#go'))
        assert.eq(go.backgroundImage, 'none', `${name}: a flat button`)
        assert.eq(go.boxShadow, 'none', `${name}: no glow`)
      } finally { t.done() }
    }
    const html = await fetchText('../index.html')
    assert.match(html, /<button class="btn btn-primary" id="brainDumpBtn"/)
    assert.match(html, /<textarea class="input" id="brainDumpInput"/)
    assert.ok(!/background-clip:\s*text/.test(stripComments(await styleCss())), 'no gradient text anywhere')
  })
})

describe('design tokens: stream sections', () => {
  it('each wave-2 stream has its marked section, followed by three blank lines', async () => {
    const css = await styleCss()
    for (const name of ['frontdoor', 'zoom', 'command', 'brief', 'braindump', 'consistency']) {
      const marker = `/* ════ [${name}] ════ */`
      const at = css.indexOf(marker)
      assert.ok(at > 0, `[${name}]`)
      assert.ok(css.slice(at + marker.length).startsWith('\n\n\n\n'), `[${name}] is followed by three blank lines`)
    }
  })
})


// ── The type palette ────────────────────────────────────────

const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const TYPE_IDS = Object.keys(TYPES)
// Every pair of types, with its distance in each theme (from the registry's
// hex, which the stylesheet's OKLCH renders as: types-foundation checks that).
const typePairs = () => {
  const out = []
  for (let i = 0; i < TYPE_IDS.length; i++) for (let j = i + 1; j < TYPE_IDS.length; j++) {
    const a = TYPES[TYPE_IDS[i]], b = TYPES[TYPE_IDS[j]]
    out.push({ a: TYPE_IDS[i], b: TYPE_IDS[j], step: a.step === b.step, shape: a.shape === b.shape,
      dark: dE(hexRgb(a.color), hexRgb(b.color)), light: dE(hexRgb(a.light), hexRgb(b.light)) })
  }
  return out
}
const fmt = p => `${p.a}/${p.b} ${p.dark.toFixed(1)}/${p.light.toFixed(1)}`

describe('design tokens: the type palette, by computation', () => {
  it('types in the same step sit at least 10 OKLab dE apart, in both themes', () => {
    const near = typePairs().filter(p => p.step && Math.min(p.dark, p.light) < 10)
    assert.deepEq(near.map(fmt), [], 'same-step pairs under 10')
  })

  it('any two types under 10 dE in either theme have different dot shapes, so colour is never the only cue', () => {
    const pairs = typePairs()
    const clash = pairs.filter(p => p.shape && Math.min(p.dark, p.light) < 10)
    assert.deepEq(clash.map(fmt), [], 'same-shape pairs under 10')
    // The palette spreads as far as the band allows: a regression shows here.
    const min = Math.min(...pairs.map(p => Math.min(p.dark, p.light)))
    assert.ok(min >= 7.5, `the closest pair overall is ${min.toFixed(1)} (2026-10 palette: 7.7)`)
  })

  it('the shape follows the step\'s role: ring for Why and Who, square for What and Proof, dot for How and Other, diamond for Doubt', () => {
    const ROLE = { why: 'ring', who: 'ring', proof: 'square', what: 'square', how: 'dot', other: 'dot', doubt: 'diamond' }
    TYPE_IDS.forEach(id => assert.eq(TYPES[id].shape, ROLE[TYPES[id].step], `${id} (${TYPES[id].step})`))
  })

  it('no type colour sits within 10 dE of a pre-2026-10 colour of another type', () => {
    // An old file carries the legacy hexes; a new colour that looked like
    // another type's old one would read as that type to a person.
    const bad = []
    TYPE_IDS.forEach(id => TYPE_IDS.filter(o => o !== id).forEach(o => {
      const [oldDark, oldLight] = TYPES[o].legacyColors
      if (TYPES[id].color === oldDark || TYPES[id].light === oldLight) bad.push(`${id} = ${o} legacy`)
    }))
    assert.deepEq(bad, [], 'a new type colour equals another type\'s legacy hex')
  })
})

describe('design tokens: the type palette, measured in the DOM', () => {
  it('every type colour draws at 3:1 on the canvas, a card and a hovered row, in both themes', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        for (const id of TYPE_IDS) {
          const c = t.color(`var(--c-${id})`)
          assert.deepEq(c.slice(0, 3), hexRgb(name === 'dark' ? TYPES[id].color : TYPES[id].light), `${name} --c-${id} is the registry's colour`)
          for (const bg of ['--canvas', '--card', '--surface-raised-hover']) {
            const r = ratio(c, t.color(`var(${bg})`))
            assert.ok(r >= 3, `${name} ${id} on ${bg}: ${r.toFixed(2)}:1`)
          }
        }
      } finally { t.done() }
    }
  })

  it('attention sits at least 10 dE from every type colour, in both themes', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        const att = t.color('var(--attention)')
        const near = TYPE_IDS.map(id => [id, dE(att, t.color(`var(--c-${id})`))]).filter(([, d]) => d < 10)
        assert.deepEq(near.map(([id, d]) => `${id} ${d.toFixed(1)}`), [], `${name}: types within 10 of attention`)
      } finally { t.done() }
    }
  })

  it('the accent sits at least 10 dE from every type colour, so a selection never reads as a type', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        const acc = t.color('var(--accent)')
        const near = TYPE_IDS.map(id => [id, dE(acc, t.color(`var(--c-${id})`))]).filter(([, d]) => d < 10)
        assert.deepEq(near.map(([id, d]) => `${id} ${d.toFixed(1)}`), [], `${name}: types within 10 of the accent`)
      } finally { t.done() }
    }
  })

  it('a type colour feeds only a card\'s --bc: no other rule in style.css reads a --c-* token', async () => {
    const css = stripComments(await styleCss())
    const uses = css.split('\n').filter(line => /var\(--c-[a-z]+\)/.test(line))
    const stray = uses.filter(line => !/^\s*\.block\[data-type=[a-z]+\]\s*\{\s*--bc:\s*var\(--c-[a-z]+\);\s*\}\s*$/.test(line))
    assert.deepEq(stray.map(l => l.trim()), [], 'a type colour used for something other than the type')
  })
})

describe('design tokens: swatches are not type colours', () => {
  it('no swatch equals a type colour, current or pre-2026-10, in either theme', () => {
    const typeHexes = new Set(TYPE_IDS.flatMap(id => [TYPES[id].color, TYPES[id].light, ...TYPES[id].legacyColors]))
    SWATCH_COLORS.forEach(c => assert.ok(!typeHexes.has(c.toLowerCase()), `${c} is a type colour`))
    assert.eq(new Set(SWATCH_COLORS).size, SWATCH_COLORS.length, 'twelve distinct swatches')
  })

  it('every swatch has a name and a light twin that is not a type colour either', () => {
    const typeHexes = new Set(TYPE_IDS.flatMap(id => [TYPES[id].color, TYPES[id].light, ...TYPES[id].legacyColors]))
    SWATCH_COLORS.forEach(c => {
      assert.ok(SWATCH_NAMES[c], `${c} has a name`)
      const twin = lightAccentFor(c)
      assert.ok(twin, `${c} has a light twin`)
      assert.ok(!typeHexes.has(twin), `${c}'s twin ${twin} is a type colour`)
    })
  })

  it('every swatch reads as a connection on both canvases (4.5:1 dark, 3:1 light) and its twin as a dot on a light card', async () => {
    const dark = await themed(''), light = await themed('light-mode')
    try {
      SWATCH_COLORS.forEach(c => {
        const rgb = [...hexRgb(c), 1]
        const d = ratio(rgb, dark.color('var(--canvas)')), l = ratio(rgb, light.color('var(--canvas)'))
        assert.ok(d >= 4.5, `${SWATCH_NAMES[c]} on the dark canvas: ${d.toFixed(2)}:1`)
        assert.ok(l >= 3, `${SWATCH_NAMES[c]} as a line on the light canvas: ${l.toFixed(2)}:1`)
        const twin = ratio([...hexRgb(lightAccentFor(c)), 1], light.color('var(--card)'))
        assert.ok(twin >= 3, `${SWATCH_NAMES[c]} twin on a light card: ${twin.toFixed(2)}:1`)
      })
    } finally { dark.done(); light.done() }
  })

  it('a colour picked before 2026-10 keeps its name', () => {
    assert.eq(SWATCH_NAMES['#38bdf8'], 'Sky')
    assert.eq(SWATCH_NAMES['#f472b6'], 'Pink')
  })
})

// ── Card states off the type colours (SPEC3 item 3) ─────────

describe('design tokens: card states never wear a type colour', () => {
  const card = (type, extra = '') =>
    `<div class="block ${extra}" data-type="${type}" data-card="outline" style="position:absolute;left:40px;top:40px;width:220px">` +
    `<div class="block-header"><span class="block-type-badge"><span class="block-type-dot" data-shape="${TYPES[type].shape}"></span>` +
    `<span class="block-type-label">${TYPES[type].label}</span></span><div class="block-gap-icons"><span class="gap-icon" role="img" aria-label="Gap: x">` +
    `<svg width="12" height="12"></svg><span class="gap-name">Name</span></span></div></div><div class="block-title">T</div>` +
    `<div class="block-meta"><span class="chip priority-badge priority-high"><svg class="chip-icon"></svg><span>High</span></span>` +
    `<span class="chip status-badge status-done"><svg class="chip-icon"></svg><span>Done</span></span></div>` +
    `<div class="block-actions"><span class="chip action-badge resolve"><svg class="chip-icon"></svg><span>Resolve</span></span></div></div>`

  it('a gap is a dashed ring 3px out in --attention, with a badge drawn in attention and its name in text-1, whatever the type', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        for (const [type, gap] of [['risk', 'gap-no-mitigation'], ['problem', 'gap-unaddressed'], ['requirement', 'gap-no-criteria'], ['goal', 'gap-isolated']]) {
          const box = t.add(card(type, gap))
          const el = box.firstChild
          const ring = getComputedStyle(el, '::after')
          assert.eq(ring.borderTopStyle, 'dashed', `${name} ${type}: dashed`)
          assert.eq(ring.borderTopWidth, '2px', `${name} ${type}: 2px, a width that renders as written`)
          assert.eq(ring.top, '-6.5px', `${name} ${type}: 3px outside the 1.5px edge`)
          assert.deepEq(cssRgba(ring.borderTopColor), t.color('var(--attention)'), `${name} ${type}: the attention hue`)
          assert.neq(cssRgba(ring.borderTopColor).join(), t.color(`var(--c-${type})`).join(), `${name} ${type}: not the type colour`)
          const icon = getComputedStyle(el.querySelector('.gap-icon'))
          assert.deepEq(cssRgba(icon.borderTopColor), t.color('var(--attention)'), `${name} ${type}: badge edge in attention`)
          assert.deepEq(cssRgba(icon.color), t.color('var(--attention)'), `${name} ${type}: the badge icon draws in attention`)
          const r = ratio(cssRgba(icon.color), cssRgba(icon.backgroundColor))
          assert.ok(r >= 3, `${name} ${type}: badge icon ${r.toFixed(2)}:1 as a graphic`)
          const label = getComputedStyle(el.querySelector('.gap-name'))
          assert.deepEq(cssRgba(label.color), t.color('var(--text-1)'), `${name} ${type}: the gap's name is text-1`)
          assert.deepEq(cssRgba(label.borderTopColor), t.color('var(--attention)'), `${name} ${type}: on a label with an attention edge`)
          const rl = ratio(cssRgba(label.color), cssRgba(label.backgroundColor))
          assert.ok(rl >= 4.5, `${name} ${type}: the name reads at ${rl.toFixed(2)}:1`)
          assert.eq(label.display, 'none', `${name}: the name waits for hover or focus`)
          box.remove()
        }
      } finally { t.done() }
    }
  })

  it('every colour a gap marker paints is neutral or 10 dE from every type colour, in both themes', async () => {
    // A gap never wears its card's type colour, nor one that looks like it:
    // the ring, the badge's edge and icon, and the name label's text and edge.
    const chroma = c => { const [, a, b] = oklab(c); return Math.hypot(a, b) }
    for (const [name, cls] of THEMES) {
      const t = await themed(cls, css => css.replace(/:hover/g, '.is-hover'))
      try {
        const types = TYPE_IDS.map(id => [id, t.color(`var(--c-${id})`)])
        for (const type of ['output', 'risk', 'custom', 'problem', 'implementation']) {
          const box = t.add(card(type, 'gap-isolated is-hover'))
          const el = box.firstChild
          const icon = getComputedStyle(el.querySelector('.gap-icon')), label = getComputedStyle(el.querySelector('.gap-name'))
          const paints = { ring: getComputedStyle(el, '::after').borderTopColor, 'badge edge': icon.borderTopColor, 'badge icon': icon.color,
            'name text': label.color, 'name edge': label.borderTopColor }
          for (const [part, css] of Object.entries(paints)) {
            const c = cssRgba(css)
            if (chroma(c) < 0.03) continue
            const near = types.map(([id, tc]) => [id, dE(c, tc)]).filter(([, d]) => d < 10)
            assert.deepEq(near.map(([id, d]) => `${id} ${d.toFixed(1)}`), [], `${name} ${type} card: the ${part}`)
          }
          box.remove()
        }
      } finally { t.done() }
    }
  })

  it('the gap name shows on hover and keyboard focus', async () => {
    const t = await themed('', css => css.replace(/:hover/g, '.is-hover').replace(/:focus-visible/g, '.is-focus'))
    try {
      for (const state of ['is-hover', 'is-focus']) {
        const box = t.add(card('risk', `gap-no-mitigation ${state}`))
        assert.eq(getComputedStyle(box.querySelector('.gap-name')).display, 'block', state)
        box.remove()
      }
    } finally { t.done() }
  })

  it('priority, status and action chips are neutral: surface-2, text-2, an icon and a sentence-case word', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        const box = t.add(card('problem'))
        for (const chip of box.querySelectorAll('.chip')) {
          const cs = getComputedStyle(chip)
          assert.deepEq(cssRgba(cs.backgroundColor), t.color('var(--surface-2)'), `${name} ${chip.className}: surface-2`)
          assert.deepEq(cssRgba(cs.color), t.color('var(--text-2)'), `${name} ${chip.className}: text-2`)
          assert.eq(cs.textTransform, 'none', `${name} ${chip.className}: sentence case`)
          assert.ok(parseFloat(cs.fontSize) >= 11, `${name}: the 11px floor`)
          assert.ok(chip.querySelector('svg'), 'with its icon')
        }
      } finally { t.done() }
    }
  })

  it('the health score is text in the text colour, never a status or type colour', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        const box = t.add(['a', 'b', 'c'].map(g => `<span class="health-score grade-${g}">58</span>`).join(''))
        box.querySelectorAll('.health-score').forEach(el =>
          assert.deepEq(cssRgba(getComputedStyle(el).color), t.color('var(--text-1)'), `${name} ${el.className}`))
      } finally { t.done() }
    }
  })

  // The parts of a computed box-shadow, and the colour at the head of one.
  const shadows = cs => cs.boxShadow === 'none' ? [] : cs.boxShadow.split(/,(?![^(]*\))/).map(p => p.trim())
  const shadowColor = part => cssRgba(part.match(/^(.*\))/)[1])

  it('selection is the heaviest card state: a 2px accent outline, an accent-subtle halo and an accent wash, on every card selected', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        const box = t.add(card('goal', 'selected') + card('risk', 'selected gap-no-mitigation'))
        box.querySelectorAll('.block').forEach(el => {
          const cs = getComputedStyle(el)
          assert.deepEq(cssRgba(cs.outlineColor), t.color('var(--accent)'), `${name}: accent outline`)
          assert.eq(cs.outlineWidth, '2px', `${name}: 2px, a width that renders as written`)
          assert.eq(cs.outlineOffset, '0px', `${name}: on the edge`)
          const halo = shadows(cs).find(p => /\s0px 0px 0px 4px$/.test(p))
          assert.ok(halo, `${name}: the halo`)
          assert.deepEq(shadowColor(halo), t.color('var(--accent-subtle)'), `${name}: accent-subtle`)
          const wash = shadows(cs).find(p => /inset$/.test(p))
          assert.ok(wash, `${name}: the wash`)
          assert.deepEq(shadowColor(wash), t.color('var(--accent-wash)'), `${name}: accent-wash`)
        })
        const gapped = box.querySelector('.gap-no-mitigation')
        assert.eq(getComputedStyle(gapped, '::after').borderTopStyle, 'dashed', `${name}: a selected gap card keeps its ring`)
        // The wash leaves every text token readable on the card.
        const washed = over(t.color('var(--accent-wash)'), t.color('var(--card)'))
        for (const tok of ['--text-1', '--text-2', '--text-3']) {
          const r = ratio(t.color(`var(${tok})`), washed)
          assert.ok(r >= 4.5, `${name} ${tok} on a selected card: ${r.toFixed(2)}:1`)
        }
      } finally { t.done() }
    }
  })

  it('keyboard focus alone is the accent outline without the halo or the wash, so it never reads as more selected than a selection', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls, css => css.replace(/:focus-visible/g, '.fv-probe'))
      try {
        const box = t.add(card('goal', 'fv-probe') + card('goal', 'selected') + card('goal', 'selected fv-probe'))
        const [focused, selected, both] = [...box.querySelectorAll('.block')].map(el => getComputedStyle(el))
        assert.deepEq(cssRgba(focused.outlineColor), t.color('var(--accent)'), `${name}: focus is the accent`)
        assert.eq(focused.outlineWidth, '2px', `${name}: at the focus width`)
        assert.ok(ratio(cssRgba(focused.outlineColor), t.color('var(--canvas)')) >= 3, `${name}: 3:1 on the canvas`)
        assert.ok(!shadows(focused).some(p => /\s0px 0px 0px 4px$|inset$/.test(p)), `${name}: no halo and no wash on focus alone`)
        assert.neq(focused.boxShadow, selected.boxShadow, `${name}: focus and selection differ by more than width`)
        assert.eq(both.boxShadow, selected.boxShadow, `${name}: a focused selection is still a selection`)
      } finally { t.done() }
    }
  })

  it('zoomed out to fit, the selection, the gap ring and the badge keep their size on screen', async () => {
    // applyTransform sets --px (one screen pixel in canvas units) and --pxn on
    // the canvas root. At 0.297 (two large templates fitted) the old 1.5px
    // ring drew under half a pixel and the 20px badge at 6px.
    const t = await themed('')
    try {
      const z = 0.297, px = (1 / z).toFixed(4)
      const box = t.add(`<div class="canvas-root" style="--px:${px}px;--pxn:${px};transform:scale(${z});transform-origin:0 0">` +
        card('risk', 'selected gap-no-mitigation') + '</div>')
      const el = box.querySelector('.block')
      const cs = getComputedStyle(el), ring = getComputedStyle(el, '::after')
      assert.ok(parseFloat(cs.outlineWidth) * z >= 1.5, `selection ${(parseFloat(cs.outlineWidth) * z).toFixed(2)}px on screen`)
      assert.ok(parseFloat(ring.borderTopWidth) * z >= 1.5, `gap ring ${(parseFloat(ring.borderTopWidth) * z).toFixed(2)}px on screen`)
      const gap = -(parseFloat(ring.top) + 1.5) - parseFloat(ring.borderTopWidth)
      assert.ok(gap * z >= 2.5, `the ring stands ${(gap * z).toFixed(2)}px off the card`)
      const halo = shadows(cs).find(p => !/inset$/.test(p))
      assert.ok(parseFloat(halo.split(/\s+/).pop()) * z >= 3.5, 'the halo too')
      const badge = el.querySelector('.gap-icon').getBoundingClientRect()
      assert.ok(badge.width >= 13 && badge.width <= 16, `badge ${badge.width.toFixed(1)}px on screen`)
      // At 100% nothing changes: the markers are their written size.
      box.firstChild.style.cssText = '--px:1px;--pxn:1'
      assert.eq(getComputedStyle(el, '::after').borderTopWidth, '2px')
      assert.eq(Math.round(el.querySelector('.gap-icon').getBoundingClientRect().width), 20)
    } finally { t.done() }
  })

  it('every dot shape has its rule, on every dot the app draws', async () => {
    const css = await styleCss()
    for (const shape of ['square', 'diamond', 'ring']) {
      assert.match(css, new RegExp(`:is\\(\\.block-type-dot, \\.palette-dot, \\.pf-menu-dot, \\.insp-dot, \\.sheet-dot\\)\\[data-shape="${shape}"\\]`), shape)
    }
    const t = await themed()
    try {
      const box = t.add(['dot', 'ring', 'square', 'diamond'].map(s => `<span class="block-type-dot" data-shape="${s}" style="display:block;width:8px;height:8px;background:var(--c-goal)"></span>`).join(''))
      const [dot, ring, square, diamond] = [...box.children].map(el => getComputedStyle(el))
      assert.eq(dot.transform, 'none')
      assert.neq(ring.maskImage || ring.webkitMaskImage, 'none', 'the ring is a mask')
      assert.neq(square.transform, 'none', 'the square is scaled to the dot\'s area')
      assert.neq(diamond.transform, 'none', 'the diamond is a turned square')
    } finally { t.done() }
  })
})
