// ============================================================
//  design-tokens.test.js: the design round's foundation (DESIGN.md):
//  contrast of every token pair the interface relies on, measured in the
//  test DOM in both themes; the attention hue's distance from what it
//  must not be mistaken for; no hard-coded colour outside a token block;
//  the retired type sizes and easing; the header skin and the footers;
//  the button system and the brain dump card.
// ============================================================

import { describe, it, assert, cssRgba } from './test-utils.js'

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

  it('attention draws at 3:1 on the canvas and a card, and writes at 4.5:1', async () => {
    for (const [name, cls] of THEMES) {
      const t = await themed(cls)
      try {
        for (const bg of ['--canvas', '--card', '--bg']) {
          const r = ratio(t.color('var(--attention)'), t.color(`var(${bg})`))
          assert.ok(r >= 3, `${name} attention on ${bg}: ${r.toFixed(2)}:1`)
        }
        for (const bg of ['--bg', '--card', '--surface-raised']) {
          const r = ratio(t.color('var(--attention-ink)'), t.color(`var(${bg})`))
          assert.ok(r >= 4.5, `${name} attention-ink on ${bg}: ${r.toFixed(2)}:1`)
        }
      } finally { t.done() }
    }
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
