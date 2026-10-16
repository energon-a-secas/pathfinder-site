// ============================================================
//  recognition.test.js: the RECOGNITION stream (design round,
//  wave 4). Recognise, do not recall: the palette rail names its
//  dots and heads, carries the letter after N beside each dot and
//  opens a flyout of names over the canvas; arrows move along it.
//  A phone keeps three quarters of its height for the map (one Add
//  control for the palette strip, a one-row status bar) and shows
//  the map's name. The start panel fits a laptop and a phone, the
//  walkthrough has a step index, the examples show whole maps, and
//  the 404 wears the doc pages' header.
// ============================================================

import { describe, it, assert, ONSCREEN, fromSiteRoot } from './test-utils.js'
import { state, ui, canvasMeta } from '../js/state.js'
import { TYPES, typesByStep } from '../js/utils.js'
import { TYPE_KEYS } from '../js/ui-panels.js'
import { TEMPLATES } from '../js/templates.js'
import { closeMenus, isMenuOpen } from '../js/menu.js'
import {
  renderPaletteTypes, setupPalette, chordKey, typeTipHtml, typeListItems, templateListItems,
  openRailFlyout, openPhoneAdd, onPaletteArrow, paletteStops, isRail, syncMapName,
  wireRailControls, syncRailSections, typeKeysLine,
} from '../js/palette.js'
import { commandGroups } from '../js/command-items.js'

const fetchText = async url => (await fetch(url, { cache: 'no-store' })).text()
const parse = html => new DOMParser().parseFromString(html, 'text/html')
const EM_DASH = String.fromCharCode(0x2014)
const nextFrame = w => new Promise(r => (w || window).requestAnimationFrame(() => r()))

// The app page's markup and stylesheets in a frame at a size, with the two
// kits' scripts (the footer builds its bar, so it is as tall as it is on the
// page) and none of the app's. `prep(doc)` edits the markup first.
async function appFrame(width, height, { bodyClass = '', bodyAttrs = '', prep = null, kits = true } = {}) {
  const doc = parse(await fetchText('../index.html'))
  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href')).filter(h => h && !/^[a-z]+:/i.test(h))
  doc.querySelectorAll('script').forEach(n => n.remove())
  prep?.(doc)
  const frame = document.createElement('iframe')
  frame.style.cssText = `${ONSCREEN};width:${width}px;height:${height}px`
  frame.srcdoc = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
    links.map(h => `<link rel="stylesheet" href="../${h}">`).join('') +
    '<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>' +
    (kits ? '<script src="../js/neorgon-footer.js"></script>' : '') +
    `</head><body class="${bodyClass}" ${bodyAttrs}>${fromSiteRoot(doc.body.innerHTML)}</body></html>`
  const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
  document.body.appendChild(frame)
  await loaded
  await new Promise(r => setTimeout(r, 60))
  await nextFrame(frame.contentWindow)
  return frame
}
const rectIn = (f, sel) => f.contentDocument.querySelector(sel)?.getBoundingClientRect()
const shownIn = (f, sel) => { const e = f.contentDocument.querySelector(sel); return !!e && e.getClientRects().length > 0 }

// A card on the canvas, so the map counts as having content.
const withCard = doc => {
  doc.getElementById('canvasRoot').insertAdjacentHTML('beforeend', '<div class="block" data-type="goal" style="position:absolute;left:40px;top:40px;width:220px;height:90px"></div>')
  doc.getElementById('canvasTitle').textContent = 'Quarterly reporting'
  doc.getElementById('canvasTitle').classList.remove('is-untitled')
  doc.getElementById('canvasMapName').textContent = 'Quarterly reporting'
}

// ── The rail: letters, tips, heads ──────────────────────────

describe('recognition: the rail names what it shows', () => {
  it('every type row carries the letter that follows N, from TYPE_KEYS, once each', () => {
    const list = document.createElement('div')
    renderPaletteTypes(list)
    const rows = [...list.querySelectorAll('.palette-item')]
    assert.eq(rows.length, Object.keys(TYPES).length)
    const letters = rows.map(r => r.querySelector('.palette-key')?.textContent)
    rows.forEach((r, i) => {
      const t = r.dataset.type
      assert.eq(letters[i], TYPE_KEYS[t].toUpperCase(), `${t}: its N letter`)
      assert.eq(r.querySelector('.palette-key').getAttribute('aria-hidden'), 'true', `${t}: drawn for the eye, not read twice`)
      assert.eq(chordKey(t), letters[i])
    })
    assert.eq(new Set(letters).size, letters.length, 'no letter shared')
    // The critique's own example: G, P, S beside the first three dots.
    assert.deepEq(letters.slice(0, 3), ['G', 'P', 'S'])
  })

  it('the tip names the type and its keys as caps, then what it is for', () => {
    for (const t of Object.keys(TYPES)) {
      const box = document.createElement('div')
      box.innerHTML = typeTipHtml(t)
      assert.eq(box.querySelector('.palette-tip-title').textContent, TYPES[t].label)
      const caps = [...box.querySelectorAll('.palette-tip-keys kbd.typekeys-key')].map(k => k.textContent)
      assert.deepEq(caps, ['N', TYPE_KEYS[t].toUpperCase()], `${t}: N then its letter, as key caps`)
      assert.includes(box.textContent, TYPES[t].tip)
      assert.ok(!box.textContent.includes(EM_DASH))
    }
    assert.eq(typeTipHtml('nope'), '')
  })

  it('the page has two rail heads: a labelled icon for Templates and the word Blocks, each opening a menu', async () => {
    const doc = parse(await fetchText('../index.html'))
    const tpl = doc.getElementById('railTemplatesBtn'), blk = doc.getElementById('railBlocksBtn')
    assert.ok(tpl && blk, 'both heads exist')
    assert.ok(tpl.closest('#templatesSection') && blk.closest('#blocksSection'), 'each heads its own section')
    assert.eq(tpl.getAttribute('aria-label'), 'Templates')
    assert.ok(tpl.querySelector('svg[aria-hidden="true"]'), 'an icon, hidden from screen readers')
    assert.eq(blk.textContent.trim(), 'Blocks')
    assert.ok(!blk.hasAttribute('aria-label') || blk.getAttribute('aria-label').includes('Blocks'), 'the visible word is in its name (WCAG 2.5.3)')
    for (const h of [tpl, blk]) {
      assert.eq(h.tagName, 'BUTTON')
      assert.eq(h.getAttribute('type'), 'button')
      assert.eq(h.getAttribute('aria-haspopup'), 'menu')
      assert.eq(h.getAttribute('aria-expanded'), 'false')
      assert.ok(h.dataset.tip, 'a tip names it on hover and focus')
      assert.ok(!h.hasAttribute('title'), 'the styled tip, not a title attribute as well')
    }
    assert.ok(!/\bTpl\b/.test(doc.getElementById('palette').outerHTML), 'no "Tpl" anywhere in the palette')
  })

  it('in the rail the dot and its letter share a row inside 48px; the whole palette puts the letter at the end', async () => {
    const doc = parse(await fetchText('../index.html'))
    for (const collapsed of [true, false]) {
      const f = await appFrame(1440, 900, { kits: false, prep: d => {
        if (collapsed) d.getElementById('palette').classList.add('collapsed')
      } })
      try {
        const d = f.contentDocument
        renderPaletteTypes(d.getElementById('blocksList'))
        await nextFrame(f.contentWindow)
        const p = d.getElementById('palette').getBoundingClientRect()
        assert.eq(Math.round(p.width), collapsed ? 48 : 200)
        for (const row of d.querySelectorAll('.palette-item')) {
          const dot = row.querySelector('.palette-dot').getBoundingClientRect()
          const key = row.querySelector('.palette-key').getBoundingClientRect()
          assert.ok(Math.abs((dot.top + dot.bottom) / 2 - (key.top + key.bottom) / 2) <= 2, `${row.dataset.type}: same row`)
          assert.ok(key.left >= dot.right, `${row.dataset.type}: the letter after the dot`)
          assert.ok(key.right <= p.right - 2, `${row.dataset.type}: inside the palette`)
          if (!collapsed) assert.ok(key.right >= p.right - 24, `${row.dataset.type}: at the end of the row`)
          assert.ok(parseFloat(f.contentWindow.getComputedStyle(row.querySelector('.palette-key')).fontSize) >= 11, 'never under 11px')
        }
        const heads = [...d.querySelectorAll('.palette-rail-head')].filter(h => h.getClientRects().length)
        assert.eq(heads.length, collapsed ? 2 : 0)
        assert.eq([...d.querySelectorAll('.palette-section-toggle')].filter(h => h.getClientRects().length).length, collapsed ? 0 : 2)
        // In the rail the templates live in their flyout, by name.
        if (collapsed) assert.ok(!shownIn(f, '#templatesList'), 'no row of unnamed template icons')
      } finally { f.remove() }
    }
    void doc
  })

  it('the rail still fits a 900px window with its heads, and each dot stays a 24px target', async () => {
    const f = await appFrame(1440, 900, { kits: true, prep: d => d.getElementById('palette').classList.add('collapsed') })
    try {
      const d = f.contentDocument
      renderPaletteTypes(d.getElementById('blocksList'))
      await nextFrame(f.contentWindow)
      const p = d.getElementById('palette')
      assert.ok(p.scrollHeight <= p.clientHeight + 1, `the rail fits (${p.scrollHeight} / ${p.clientHeight})`)
      const r = d.querySelector('.palette-item').getBoundingClientRect()
      assert.ok(r.height >= 24 && r.width >= 24)
      for (const h of d.querySelectorAll('.palette-rail-head')) {
        const hr = h.getBoundingClientRect()
        assert.ok(hr.height >= 24 && hr.width >= 24, 'a head is a 24px target too')
      }
    } finally { f.remove() }
  })
})

// ── The flyouts ─────────────────────────────────────────────

describe('recognition: the rail opens a flyout of names, over the canvas', () => {
  it('the types list: every type once, by step, with N and its letter, and a pick adds that type', () => {
    const picked = []
    const items = typeListItems({ onPick: t => picked.push(t) })
    const rows = items.filter(i => i.dot)
    assert.deepEq(rows.map(r => r.label), typesByStep().flatMap(g => g.types).map(t => TYPES[t].label))
    rows.forEach(r => {
      const t = Object.keys(TYPES).find(k => TYPES[k].label === r.label)
      assert.eq(r.shortcut, `N ${TYPE_KEYS[t].toUpperCase()}`, `${t}: its keys in the shortcut column`)
    })
    assert.deepEq(items.filter(i => i.type === 'heading').map(h => h.label), typesByStep().filter(g => g.types.length).map(g => g.label))
    rows.find(r => r.label === TYPES.risk.label).action()
    assert.deepEq(picked, ['risk'])
    // On a phone: no keys to show, no pointer to follow.
    const phone = typeListItems({ keys: false, note: false })
    assert.ok(phone.filter(i => i.dot).every(r => !r.shortcut))
    assert.ok(!phone.some(i => i.type === 'custom'), 'no "point at a type" note on a touch screen')
  })

  it('the templates list: the worked maps, the starters and what this browser saved, each by name', () => {
    const KEY = 'pathfinder-templates'
    const prev = localStorage.getItem(KEY)
    localStorage.setItem(KEY, JSON.stringify([{ id: 'u1', name: 'Our release train', blocks: [{}, {}, {}], arrows: [] }]))
    try {
      const items = templateListItems()
      const labels = items.filter(i => i.label && !i.type).map(i => i.label)
      for (const t of TEMPLATES.filter(t => t.large)) assert.ok(labels.some(l => l.toLowerCase() === t.name.toLowerCase()), `${t.name} is listed`)
      assert.ok(items.some(i => i.submenu && i.label === 'Smaller starters'))
      assert.ok(items.some(i => i.type === 'heading' && /saved/i.test(i.label)))
      const mine = items.find(i => i.label === 'Our release train')
      assert.ok(mine, 'a saved template by its own name')
      assert.eq(mine.hint, '3 blocks')
      // Saving and deleting live here too: at 769 to 1024px the rail is the
      // only palette there is, and its Templates menu is the way to them.
      const save = items.find(i => i.label === 'Save this map as a template')
      assert.ok(save && typeof save.action === 'function', 'save this map as a template')
      const del = items.find(i => i.label === 'Delete a saved template')
      assert.deepEq(del?.submenu?.map(r => [r.label, !!r.danger]), [['Our release train', true]], 'delete one, by name, as a danger row')
    } finally {
      if (prev === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, prev)
    }
  })

  it('a head opens its flyout beside the rail, names it, and a second press or Escape closes it back onto the head', () => {
    closeMenus()
    const host = document.createElement('div')
    host.style.cssText = ONSCREEN + ';width:600px;height:600px;display:flex'
    host.innerHTML = '<aside id="palette-rail-probe" style="width:48px;height:600px"><button type="button" class="palette-rail-head" data-flyout="types" aria-expanded="false" style="display:block;width:48px;height:32px">Blocks</button></aside><div id="probe-canvas" style="flex:1"></div>'
    document.body.appendChild(host)
    const head = host.querySelector('.palette-rail-head')
    const canvasBefore = host.querySelector('#probe-canvas').getBoundingClientRect()
    try {
      head.focus()
      const m = openRailFlyout(head)
      assert.ok(m && isMenuOpen(), 'a menu opened')
      assert.ok(m.el.classList.contains('palette-flyout'))
      assert.eq(m.el.getAttribute('aria-label'), 'Block types')
      assert.eq(head.getAttribute('aria-expanded'), 'true')
      assert.eq(m.el.querySelectorAll('.pf-menu-item').length, Object.keys(TYPES).length)
      assert.ok(m.el.contains(document.activeElement), 'focus moves into the list')
      const canvasAfter = host.querySelector('#probe-canvas').getBoundingClientRect()
      assert.deepEq([canvasAfter.left, canvasAfter.width], [canvasBefore.left, canvasBefore.width], 'the canvas does not move')
      assert.eq(openRailFlyout(head), null, 'the second press closes it')
      assert.ok(!isMenuOpen())
      assert.eq(head.getAttribute('aria-expanded'), 'false')
      assert.eq(document.activeElement, head, 'focus is back on the head')
      // Escape, the menu's own key.
      openRailFlyout(head)
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      assert.ok(!isMenuOpen(), 'Escape closes it')
      assert.eq(document.activeElement, head)
    } finally { closeMenus(); host.remove() }
  })

  it('a view-only link opens neither flyout nor the phone list', () => {
    const was = ui.readOnly
    ui.readOnly = true
    const b = document.createElement('button')
    document.body.appendChild(b)
    try {
      assert.eq(openRailFlyout(b), null)
      assert.eq(openPhoneAdd(b), null)
      assert.ok(!isMenuOpen())
    } finally { ui.readOnly = was; b.remove() }
  })
})

// ── Keys ────────────────────────────────────────────────────

describe('recognition: Up and Down move along the palette', () => {
  it('Down and Up step through the controls on screen, Home and End jump, and nothing else is taken', () => {
    const host = document.createElement('aside')
    host.style.cssText = ONSCREEN + ';width:48px;height:400px'
    host.innerHTML = '<button type="button" id="k0">a</button><button type="button" id="k1" hidden>hidden</button>' +
      '<div inert><button type="button" id="k2">inert</button></div><button type="button" id="k3">b</button><button type="button" id="k4" disabled>off</button><button type="button" id="k5">c</button>'
    document.body.appendChild(host)
    host.addEventListener('keydown', e => onPaletteArrow(e, host))
    const press = (key, extra = {}) => {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
      document.activeElement.dispatchEvent(e)
      return e.defaultPrevented
    }
    try {
      assert.deepEq(paletteStops(host).map(b => b.id), ['k0', 'k3', 'k5'], 'only what is shown and enabled')
      host.querySelector('#k0').focus()
      assert.ok(press('ArrowDown')); assert.eq(document.activeElement.id, 'k3')
      press('ArrowDown'); assert.eq(document.activeElement.id, 'k5')
      press('ArrowDown'); assert.eq(document.activeElement.id, 'k5', 'stops at the end')
      press('ArrowUp'); assert.eq(document.activeElement.id, 'k3')
      press('Home'); assert.eq(document.activeElement.id, 'k0')
      press('End'); assert.eq(document.activeElement.id, 'k5')
      assert.ok(!press('ArrowDown', { shiftKey: true }), 'a modified arrow is not the palette\'s')
      assert.ok(!press('a'), 'a letter is not the palette\'s')
    } finally { host.remove() }
  })

  it('Right on a rail head opens its flyout, as a click does', () => {
    closeMenus()
    const host = document.createElement('aside')
    host.style.cssText = ONSCREEN + ';width:48px;height:200px'
    host.innerHTML = '<button type="button" class="palette-rail-head" data-flyout="templates" aria-expanded="false" style="display:block;width:48px;height:32px">T</button>'
    document.body.appendChild(host)
    host.addEventListener('keydown', e => onPaletteArrow(e, host))
    try {
      const head = host.firstChild
      head.focus()
      head.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
      assert.ok(isMenuOpen(), 'the templates flyout opened')
      assert.eq(document.querySelector('.pf-menu.palette-flyout')?.getAttribute('aria-label'), 'Templates')
      assert.eq(head.getAttribute('aria-expanded'), 'true')
    } finally { closeMenus(); host.remove() }
  })

  it('isRail reads the collapsed class on a wide window', () => {
    const p = document.createElement('aside')
    p.className = 'palette collapsed'
    if (window.innerWidth > 1024) assert.ok(isRail(p))
    p.classList.remove('collapsed')
    if (window.innerWidth > 1024) assert.ok(!isRail(p))
    assert.ok(!isRail(null))
  })
})

// ── A phone ─────────────────────────────────────────────────

describe('recognition: a phone gives the map three quarters of its height', () => {
  // 390x844 is the brief's phone: 75% or more. A 375x812 phone has the same
  // fixed rows (header 56, bar 35, the footer kit's 63, the sheet's 56) in
  // 32px less height, so it reaches 74%; the rest is the footer's to give.
  for (const [W, H, share] of [[390, 844, 0.75], [375, 812, 0.74]]) {
    it(`${W}x${H}: no palette strip, one Add control, a one-row status bar, and the canvas at ${share * 100}% or more`, async () => {
      for (const theme of ['', 'light-mode']) {
        const f = await appFrame(W, H, { bodyClass: theme, prep: withCard })
        try {
          assert.ok(!shownIn(f, '#palette'), 'the strip is gone')
          assert.ok(shownIn(f, '#paletteAddBtn'), 'Add is there')
          const add = rectIn(f, '#paletteAddBtn'), bar = rectIn(f, '#canvasStatusbar')
          assert.ok(add.top >= bar.top && add.bottom <= bar.bottom, 'in the status bar')
          assert.ok(add.height >= 24 && add.width >= 44, `a real target (${Math.round(add.width)} x ${Math.round(add.height)})`)
          assert.ok(bar.height <= 36, `one row: ${Math.round(bar.height)}px`)
          const d = f.contentDocument
          assert.ok(d.getElementById('canvasStatusbar').scrollWidth <= W, 'nothing in the bar runs off the side')
          const canvas = rectIn(f, '#canvasViewport')
          assert.ok(canvas.height / H >= share, `${theme || 'dark'}: the canvas is ${Math.round(canvas.height)}px of ${H} (${(canvas.height / H * 100).toFixed(1)}%)`)
          // The save status is still read, and comes back on screen on an error.
          const text = d.getElementById('saveStatusText')
          assert.eq(text.getAttribute('role'), 'status')
          d.getElementById('saveStatusBar').dataset.phase = 'error'
          assert.ok(text.getBoundingClientRect().width > 4, 'an error shows')
        } finally { f.remove() }
      }
    })
  }

  it('the map\'s name shows at the top of the canvas where the header hides it, and never over an empty map', async () => {
    const f = await appFrame(390, 844, { prep: withCard })
    try {
      assert.ok(shownIn(f, '#canvasMapName'))
      const name = rectIn(f, '#canvasMapName'), find = rectIn(f, '#searchBtn'), vp = rectIn(f, '#canvasViewport')
      assert.eq(f.contentDocument.getElementById('canvasMapName').textContent, 'Quarterly reporting')
      assert.ok(name.top >= vp.top && name.right <= find.left - 4, 'beside Find blocks, never under it')
      assert.ok(Math.abs(name.top - find.top) <= 1 && Math.abs(name.height - find.height) <= 1, 'the same row')
      assert.ok(parseFloat(f.contentWindow.getComputedStyle(f.contentDocument.getElementById('canvasMapName')).fontSize) >= 14)
      assert.eq(f.contentWindow.getComputedStyle(f.contentDocument.getElementById('canvasMapName')).pointerEvents, 'none', 'a touch goes through to the canvas')
    } finally { f.remove() }
    const empty = await appFrame(390, 844)
    try { assert.ok(!shownIn(empty, '#canvasMapName'), 'the start panel has the top of an empty map') } finally { empty.remove() }
    const wide = await appFrame(1280, 800, { prep: withCard })
    try { assert.ok(!shownIn(wide, '#canvasMapName'), 'the header names it on a laptop') } finally { wide.remove() }
  })

  it('a view-only link has no Add (nothing to add), keeps the name, and Zen or an embed show neither', async () => {
    const ro = await appFrame(390, 844, { bodyClass: 'readonly-mode', prep: withCard })
    try {
      assert.ok(!shownIn(ro, '#paletteAddBtn'), 'no Add on a view-only link')
      assert.ok(shownIn(ro, '#canvasMapName'), 'the name still shows')
    } finally { ro.remove() }
    const zen = await appFrame(390, 844, { bodyAttrs: 'data-zen="on"', prep: withCard })
    try { assert.ok(!shownIn(zen, '#canvasMapName') && !shownIn(zen, '#paletteAddBtn'), 'Zen hides both') } finally { zen.remove() }
    const embed = await appFrame(390, 844, { bodyClass: 'embed-mode readonly-mode', prep: withCard })
    try { assert.ok(!shownIn(embed, '#canvasMapName') && !shownIn(embed, '#paletteAddBtn'), 'an embed shows neither') } finally { embed.remove() }
  })

  it('the name follows the header title, untitled included', () => {
    const label = document.createElement('p'); label.id = 'canvasMapName'
    const title = document.getElementById('canvasTitle')
    const saved = { text: title?.textContent, cls: title?.className, meta: canvasMeta.title }
    document.body.appendChild(label)
    try {
      title.className = 'map-crumb-title'
      title.textContent = 'Inherit the billing service'
      syncMapName(label)
      assert.eq(label.textContent, 'Inherit the billing service')
      assert.ok(!label.classList.contains('is-untitled'))
      title.className = 'map-crumb-title is-untitled'
      title.textContent = 'Untitled map'
      canvasMeta.title = ''
      syncMapName(label)
      assert.eq(label.textContent, 'Untitled map')
      assert.ok(label.classList.contains('is-untitled'))
    } finally {
      label.remove()
      title.textContent = saved.text; title.className = saved.cls; canvasMeta.title = saved.meta
    }
  })

  it('the name is drawn as chrome (a raised surface and a hairline), and gives way to the dot-voting banner', async () => {
    for (const theme of ['', 'light-mode']) {
      const f = await appFrame(390, 844, { bodyClass: theme, prep: withCard })
      try {
        const w = f.contentWindow, el = f.contentDocument.getElementById('canvasMapName')
        const cs = w.getComputedStyle(el), vp = w.getComputedStyle(f.contentDocument.getElementById('canvasViewport'))
        assert.eq(cs.borderTopWidth, '1px', `${theme || 'dark'}: a hairline`)
        assert.ok(cs.backgroundColor !== vp.backgroundColor, `${theme || 'dark'}: not a hole the colour of the canvas`)
        assert.eq(Math.round(el.getBoundingClientRect().height), Math.round(rectIn(f, '#searchBtn').height), 'Find blocks\' height')
      } finally { f.remove() }
    }
    const voting = await appFrame(390, 844, { bodyClass: 'voting-mode', prep: withCard })
    try { assert.ok(!shownIn(voting, '#canvasMapName'), 'the voting banner\'s instructions sit where the name was') } finally { voting.remove() }
  })

  it('on a phone a submenu opens in place: the templates, then the smaller starters, one list at a time', () => {
    closeMenus()
    const btn = document.createElement('button')
    btn.style.cssText = 'position:fixed;left:8px;top:700px;width:64px;height:28px;opacity:0'
    document.body.appendChild(btn)
    const row = text => [...document.querySelectorAll('.pf-menu-item')].find(b => b.textContent.includes(text))
    try {
      openPhoneAdd(btn)
      assert.ok(!document.querySelector('.pf-menu-item[aria-haspopup]'), 'no row opens a menu beside this one')
      row('From a template').click()
      assert.eq(document.querySelectorAll('.pf-menu').length, 1)
      assert.eq(document.querySelector('.pf-menu').getAttribute('aria-label'), 'From a template')
      assert.ok(!document.querySelector('.pf-menu-item[aria-haspopup]'), 'Smaller starters is a plain row too')
      row('Smaller starters').click()
      const menus = document.querySelectorAll('.pf-menu')
      assert.eq(menus.length, 1, 'the starters replace the list; nothing stacks on its parent')
      assert.eq(menus[0].getAttribute('aria-label'), 'Smaller starters')
      assert.ok(menus[0].getBoundingClientRect().bottom <= btn.getBoundingClientRect().top + 0.5, 'still standing above Add')
      assert.eq(btn.getAttribute('aria-expanded'), 'true')
    } finally { closeMenus(); btn.remove() }
  })

  it('Add lists every type with what it means, then the templates, standing above the button', () => {
    closeMenus()
    const btn = document.createElement('button')
    btn.style.cssText = 'position:fixed;left:8px;bottom:120px;width:64px;height:28px;opacity:0'
    document.body.appendChild(btn)
    const blocksBefore = Object.keys(state.blocks).length
    try {
      const m = openPhoneAdd(btn)
      assert.ok(m && m.el.classList.contains('palette-add-menu'))
      assert.eq(btn.getAttribute('aria-expanded'), 'true')
      const rows = [...m.el.querySelectorAll('.pf-menu-item')]
      assert.eq(rows.filter(r => r.querySelector('.pf-menu-dot')).length, Object.keys(TYPES).length)
      assert.ok(rows.every(r => !r.querySelector('.pf-menu-shortcut')), 'no keys on a phone')
      assert.ok(rows.some(r => r.textContent.includes('From a template')))
      assert.ok(m.el.getBoundingClientRect().bottom <= btn.getBoundingClientRect().top + 0.5, 'never over the button')
      assert.eq(openPhoneAdd(btn), null, 'a second press closes it')
      assert.eq(btn.getAttribute('aria-expanded'), 'false')
      assert.eq(Object.keys(state.blocks).length, blocksBefore, 'opening it adds nothing')
    } finally { closeMenus(); btn.remove() }
  })

  it('setupPalette and wireRailControls wire each control once: one press opens one menu', () => {
    closeMenus()
    const host = document.createElement('div')
    host.style.cssText = ONSCREEN + ';width:600px;height:600px'
    host.innerHTML = '<aside class="palette"><button type="button" class="palette-rail-head" data-flyout="types" aria-expanded="false" style="display:block;width:48px;height:32px">Blocks</button></aside>' +
      '<button type="button" class="palette-add-btn" style="position:fixed;left:8px;bottom:120px;width:64px;height:28px">Add</button>'
    document.body.appendChild(host)
    const pal = host.querySelector('aside'), head = pal.querySelector('.palette-rail-head'), add = host.querySelector('.palette-add-btn')
    try {
      wireRailControls(pal, add); wireRailControls(pal, add)
      setupPalette()   // the page's own palette, whatever this document has
      head.click()
      assert.eq(document.querySelectorAll('.pf-menu').length, 1, 'one click, one menu (wired twice, it would open and close)')
      head.click()
      assert.ok(!isMenuOpen())
      add.click()
      assert.eq(document.querySelectorAll('.pf-menu').length, 1)
      add.click()
      assert.ok(!isMenuOpen())
    } finally { closeMenus(); host.remove() }
  })
})

// ── Real presses: a second press on what opened a list closes it ──

describe('recognition: a second press closes what the first opened', () => {
  // A press is pointerdown then click. menu.js closes an open menu on a
  // pointerdown outside it; unless the control is the menu's anchor, the
  // click that follows then opened the list again.
  const press = (el, pointerType = 'mouse') => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType, isPrimary: true, button: 0 }))
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType, isPrimary: true, button: 0 }))
    el.click()
  }
  function rig() {
    closeMenus()
    const host = document.createElement('div')
    host.style.cssText = ONSCREEN + ';width:600px;height:700px'
    host.innerHTML = '<aside class="palette" style="width:48px;height:400px">' +
      '<button type="button" class="palette-rail-head" data-flyout="types" aria-expanded="false" style="display:block;width:48px;height:32px">Blocks</button>' +
      '<button type="button" class="palette-rail-head" data-flyout="templates" aria-expanded="false" style="display:block;width:48px;height:32px">T</button></aside>' +
      '<button type="button" class="palette-add-btn" aria-expanded="false" style="position:fixed;left:8px;top:600px;width:64px;height:28px">Add</button>'
    document.body.appendChild(host)
    const pal = host.querySelector('aside')
    wireRailControls(pal, host.querySelector('.palette-add-btn'))
    return { host, heads: [...pal.querySelectorAll('.palette-rail-head')], add: host.querySelector('.palette-add-btn') }
  }

  it('each rail head: press opens its flyout, a second press closes it and leaves focus on the head', () => {
    const { host, heads } = rig()
    try {
      for (const head of heads) {
        head.focus()
        press(head)
        assert.ok(isMenuOpen(), `${head.dataset.flyout}: open`)
        assert.eq(head.getAttribute('aria-expanded'), 'true')
        press(head)
        assert.ok(!isMenuOpen(), `${head.dataset.flyout}: the second press closes it`)
        assert.eq(head.getAttribute('aria-expanded'), 'false')
        assert.eq(document.querySelectorAll('.pf-menu').length, 0)
      }
      // A press on the other head moves to its flyout, one menu at a time.
      press(heads[0]); press(heads[1])
      assert.eq(document.querySelectorAll('.pf-menu').length, 1)
      assert.eq(document.querySelector('.pf-menu').getAttribute('aria-label'), 'Templates')
      assert.eq(heads[0].getAttribute('aria-expanded'), 'false')
    } finally { closeMenus(); host.remove() }
  })

  it('a press anywhere else still closes a flyout', () => {
    const { host, heads } = rig()
    try {
      press(heads[0])
      assert.ok(isMenuOpen())
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
      assert.ok(!isMenuOpen())
    } finally { closeMenus(); host.remove() }
  })

  it('the phone\'s Add: a tap opens the list, a second tap closes it; the same after the list became the templates', () => {
    const { host, add } = rig()
    try {
      press(add, 'touch')
      assert.ok(isMenuOpen()); assert.eq(add.getAttribute('aria-expanded'), 'true')
      press(add, 'touch')
      assert.ok(!isMenuOpen(), 'the second tap closes it')
      assert.eq(add.getAttribute('aria-expanded'), 'false')
      press(add, 'touch')
      ;[...document.querySelectorAll('.pf-menu-item')].find(b => b.textContent.includes('From a template')).click()
      assert.ok(isMenuOpen(), 'the templates, in place')
      assert.eq(add.getAttribute('aria-expanded'), 'true')
      press(add, 'touch')
      assert.ok(!isMenuOpen(), 'a tap on Add closes the templates too')
    } finally { closeMenus(); host.remove() }
  })

  it('Left closes the flyout Right opened, and focus goes back to the head', () => {
    const { host, heads } = rig()
    host.querySelector('aside').addEventListener('keydown', e => onPaletteArrow(e, host.querySelector('aside')))
    const key = (k, el = document.activeElement) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    try {
      heads[0].focus()
      key('ArrowRight')
      assert.ok(isMenuOpen())
      key('ArrowDown')
      assert.ok(document.querySelector('.pf-menu').contains(document.activeElement))
      key('ArrowLeft')
      assert.ok(!isMenuOpen(), 'Left, back toward the rail, closes it')
      assert.eq(document.activeElement, heads[0])
      assert.eq(heads[0].getAttribute('aria-expanded'), 'false')
    } finally { closeMenus(); host.remove() }
  })
})

// ── The rail at 769 to 1024px, and with Blocks folded ───────

describe('recognition: the rail keeps every palette action, whatever was folded', () => {
  it('at 1000x800 (the rail is the only palette) the Templates menu saves this map and deletes a saved template; Cmd+K has both', async () => {
    const KEY = 'pathfinder-templates'
    const prev = localStorage.getItem(KEY)
    localStorage.setItem(KEY, JSON.stringify([{ id: 'u9', name: 'Weekly ops review', blocks: [{}], arrows: [] }]))
    const f = await appFrame(1000, 800, { kits: false, prep: withCard })
    // The whole palette's own controls, which the rows click.
    const list = document.getElementById('templatesList')
    const was = list.innerHTML
    const clicked = []
    list.innerHTML = '<button type="button" id="saveTemplateBtn"></button><button type="button" data-utpl-del="u9"></button>'
    // Caught on the way down, before the list's own handler saves or deletes.
    const spy = e => {
      const b = e.target.closest('#saveTemplateBtn, [data-utpl-del]'); if (!b) return
      clicked.push(b.id ? 'save' : 'delete'); e.stopPropagation()
    }
    list.addEventListener('click', spy, true)
    const key = 'probe-rail-block'
    const blocksWere = { ...state.blocks }
    Object.keys(state.blocks).forEach(id => delete state.blocks[id])
    state.blocks[key] = { id: key, type: 'goal', title: 'x', x: 0, y: 0 }
    try {
      const d = f.contentDocument
      // The layout: the rail, its Templates head a real target, no toggles,
      // and nothing else of the templates section on screen.
      assert.ok(shownIn(f, '#railTemplatesBtn'), 'the Templates head is in the rail')
      const r = rectIn(f, '#railTemplatesBtn')
      assert.ok(r.width >= 24 && r.height >= 24)
      assert.ok(!shownIn(f, '#templatesToggle') && !shownIn(f, '#paletteCollapseBtn') && !shownIn(f, '#saveTemplateBtn'), 'the whole palette is not reachable here')
      assert.eq(Math.round(d.getElementById('palette').getBoundingClientRect().width), 48)
      // So the head's menu carries both.
      const items = templateListItems()
      items.find(i => i.label === 'Save this map as a template').action()
      items.find(i => i.label === 'Delete a saved template').submenu[0].action()
      assert.deepEq(clicked, ['save', 'delete'], 'each row takes the whole palette\'s own path')
      const rows = commandGroups().find(g => g.key === 'templates').items
      assert.ok(rows.some(r => r.id === 'tpl-save' && r.label === 'Save this map as a template' && !r.disabled), 'Cmd+K saves this map')
      assert.ok(rows.some(r => r.id === 'utpl-del:u9' && r.danger && r.noRecent), 'and deletes, as a danger row Recent never keeps')
      delete state.blocks[key]
      assert.ok(templateListItems().find(i => i.label === 'Save this map as a template').disabled, 'an empty map has nothing to save')
    } finally {
      delete state.blocks[key]
      Object.assign(state.blocks, blocksWere)
      list.removeEventListener('click', spy, true)
      list.innerHTML = was
      f.remove()
      if (prev === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, prev)
    }
  })

  // pathfinder-pal-blocksSection = 0: Blocks folded in the whole palette.
  const folded = d => {
    const section = d.getElementById('blocksSection')
    section.classList.add('collapsed')
    section.querySelector('.palette-section-body').inert = true
  }
  for (const [W, H, collapsed] of [[1000, 800, false], [1440, 900, true]]) {
    it(`${W}x${H}${collapsed ? ', the palette collapsed' : ''}: a folded Blocks still shows every dot and its letter in the rail`, async () => {
      const f = await appFrame(W, H, { kits: false, prep: d => { if (collapsed) d.getElementById('palette').classList.add('collapsed'); folded(d) } })
      try {
        const d = f.contentDocument
        const pal = d.getElementById('palette')
        renderPaletteTypes(d.getElementById('blocksList'))
        wireRailControls(pal, null)
        await nextFrame(f.contentWindow)
        const body = d.querySelector('#blocksSection > .palette-section-body')
        assert.ok(!body.inert, 'the rail lifts the fold\'s inert')
        assert.ok(body.getBoundingClientRect().height > 300, `the dots are drawn (${Math.round(body.getBoundingClientRect().height)}px)`)
        const letters = [...d.querySelectorAll('.palette-key')].filter(k => k.getBoundingClientRect().height > 0)
        assert.eq(letters.length, Object.keys(TYPES).length)
        assert.ok(d.getElementById('blocksSection').classList.contains('collapsed'), 'the person\'s fold is kept')
        // Out of the rail (a wide window, the palette whole) the fold returns.
        if (collapsed) {
          pal.classList.remove('collapsed')
          await new Promise(r => setTimeout(r, 0))   // the observer runs after this task
          assert.ok(body.inert, 'the whole palette keeps the section folded')
          assert.eq(Math.round(body.getBoundingClientRect().height), 0)
          pal.classList.add('collapsed')
          await new Promise(r => setTimeout(r, 0))
          assert.ok(!body.inert, 'and the rail lifts it again')
        }
        // A fold made while in the rail (setPaletteSection writes inert) is lifted too.
        body.inert = true
        await new Promise(r => setTimeout(r, 0))
        assert.ok(!body.inert)
      } finally { f.remove() }
    })
  }

  it('syncRailSections leaves a palette that is not a rail alone', () => {
    const p = document.createElement('aside')
    p.innerHTML = '<div id="blocksSection" class="palette-section collapsed"><div class="palette-section-body"></div></div>'
    p.querySelector('.palette-section-body').inert = true
    syncRailSections(p)
    if (window.innerWidth > 1024) assert.ok(p.querySelector('.palette-section-body').inert, 'whole palette: still folded')
  })
})

// ── What a screen reader hears ──────────────────────────────

describe('recognition: the keys and the heads are said, not only drawn', () => {
  it('each type row\'s description ends with its keys in words; the rail heads are described by their tips', async () => {
    for (const t of Object.keys(TYPES)) {
      assert.eq(typeKeysLine(t), `${TYPES[t].short}. Keys: N, then ${TYPE_KEYS[t].toUpperCase()}`)
    }
    const list = document.createElement('div')
    renderPaletteTypes(list)
    const risk = list.querySelector('.palette-item[data-type="risk"]')
    assert.includes(list.querySelector('#' + risk.getAttribute('aria-describedby')).textContent, 'Keys: N, then K')
    const doc = parse(await fetchText('../index.html'))
    for (const id of ['railTemplatesBtn', 'railBlocksBtn']) {
      const head = doc.getElementById(id)
      const desc = doc.getElementById(head.getAttribute('aria-describedby') || '')
      assert.ok(desc, `${id}: described`)
      assert.eq(desc.textContent, head.dataset.tipSub, `${id}: by the tip's own second line`)
      assert.ok(desc.hidden, `${id}: hidden, read only as the head's description`)
    }
  })
})

// ── The start panel ─────────────────────────────────────────

describe('recognition: the start panel fits a laptop and a phone, its helper reads in one pass', () => {
  for (const [W, H] of [[1280, 800], [390, 844]]) {
    it(`${W}x${H}: the first-block pills are in view with no scroll inside the canvas, and each option says what it is in one line`, async () => {
      for (const theme of ['', 'light-mode']) {
        const f = await appFrame(W, H, { bodyClass: theme })
        try {
          const d = f.contentDocument
          const bd = d.getElementById('brainDump')
          assert.ok(shownIn(f, '#startPanel'), 'the start panel is up on an empty map')
          assert.ok(bd.scrollHeight <= bd.clientHeight + 1, `${theme || 'dark'}: no inner scroll (${bd.scrollHeight} / ${bd.clientHeight})`)
          const pills = rectIn(f, '#startFirstBlocks'), room = bd.getBoundingClientRect()
          assert.ok(pills.bottom <= room.bottom + 0.5, `${theme || 'dark'}: the pills end at ${Math.round(pills.bottom)}, the room at ${Math.round(room.bottom)}`)
          assert.ok(rectIn(f, '.start-foot').bottom <= room.bottom + 0.5, 'the storage line too')
          for (const desc of d.querySelectorAll('.start-opt-desc')) {
            const lh = parseFloat(f.contentWindow.getComputedStyle(desc).lineHeight)
            assert.ok(desc.getBoundingClientRect().height <= lh * 1.5, `"${desc.textContent}" fits one line`)
          }
        } finally { f.remove() }
      }
    })
  }

  it('the prefix line names four prefixes and the question mark; More prefixes lists the rest by type, and what indents do', async () => {
    const { prefixHelpHtml, PREFIX_WORDS, PRIMARY_PREFIX_TYPES, prefixSaysType } = await import('../js/start-panel.js')
    assert.ok(PRIMARY_PREFIX_TYPES.length <= 4, `${PRIMARY_PREFIX_TYPES.length} prefixes in the line`)
    const box = document.createElement('div')
    box.innerHTML = prefixHelpHtml(PREFIX_WORDS)
    const line = box.querySelector('#startPrefixLine')
    assert.ok(line.textContent.length <= 100, `a short line: ${line.textContent.length} characters`)
    assert.deepEq([...line.querySelectorAll('code')].map(c => c.textContent), [...PRIMARY_PREFIX_TYPES.map(t => PREFIX_WORDS[t] + ':'), '?'])
    assert.ok(!line.querySelector('#startIndentLine'), 'the indent rule is not in the line')
    const more = box.querySelector('details.start-prefixes')
    assert.ok(!more.open, 'closed until asked for')
    assert.ok(more.querySelector('.start-indent'), 'what indented lines do sits under More prefixes')
    // The notes field's description names a copy outside the disclosure: a
    // closed <details> is left out of the description Chrome computes.
    const described = box.querySelector('#startIndentLine')
    assert.ok(described && !described.closest('details'), 'the described sentence is outside More prefixes')
    assert.ok(described.hidden, 'hidden, so a screen reader reading the page does not hear it twice')
    assert.eq(described.textContent, more.querySelector('.start-indent').textContent)
    const items = [...more.querySelectorAll('.start-prefix-list > span')].map(s => s.textContent)
    assert.includes(items, 'Req: Requirement', 'an abbreviation names its type')
    assert.includes(items, 'Who: Stakeholder')
    assert.includes(items, 'Decision:', 'a word that is the type is not said twice')
    assert.ok(prefixSaysType('terminator', 'Trigger') && !prefixSaysType('requirement', 'Req'))
    // The page's static helper is the generated one, true before any script runs.
    const page = parse(await fetchText('../index.html'))
    const { prefixWords } = await import('../js/start-panel.js')
    const generated = document.createElement('div')
    generated.innerHTML = prefixHelpHtml(prefixWords(), { nest: true })
    assert.eq(page.getElementById('startPrefixHelp').innerHTML.replace(/>\s+</g, '><').trim(), generated.innerHTML,
      'index.html matches prefixHelpHtml(prefixWords()) (paste its output)')
  })

  it('More prefixes lays the list out in two columns at the 11px floor or more', async () => {
    const { prefixHelpHtml, PREFIX_WORDS } = await import('../js/start-panel.js')
    const f = await appFrame(1280, 800, { kits: false, prep: d => {
      d.getElementById('startNotes').hidden = false
      d.getElementById('startPrefixHelp').innerHTML = prefixHelpHtml(PREFIX_WORDS)
      d.querySelector('.start-prefixes').setAttribute('open', '')
    } })
    try {
      const d = f.contentDocument, w = f.contentWindow
      const spans = [...d.querySelectorAll('.start-prefix-list > span')]
      const lefts = new Set(spans.map(s => Math.round(s.getBoundingClientRect().left)))
      assert.eq(lefts.size, 2, 'two columns')
      spans.forEach(s => assert.ok(parseFloat(w.getComputedStyle(s.querySelector('code')).fontSize) >= 11))
    } finally { f.remove() }
  })
})

// ── The reading pages ───────────────────────────────────────

// A doc page's own markup and stylesheets at a size, no scripts, images on.
async function docFrame(file, width, height, bodyClass = 'doc-page') {
  const doc = parse(await fetchText('../' + file))
  const links = [...doc.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href')).filter(h => h && !/^[a-z]+:/i.test(h))
  doc.querySelectorAll('script').forEach(n => n.remove())
  const frame = document.createElement('iframe')
  frame.style.cssText = `${ONSCREEN};width:${width}px;height:${height}px`
  frame.srcdoc = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
    links.map(h => `<link rel="stylesheet" href="../${h.replace(/^\//, '')}">`).join('') +
    `</head><body class="${bodyClass}">${fromSiteRoot(doc.body.innerHTML).replace(/\b(src|href)="\/(?!\/)/g, '$1="../')}</body></html>`
  const loaded = new Promise(res => frame.addEventListener('load', res, { once: true }))
  document.body.appendChild(frame)
  await loaded
  // Pictures load lazily: make them eager and wait for them.
  const imgs = [...frame.contentDocument.images]
  imgs.forEach(i => { i.loading = 'eager' })
  await Promise.all(imgs.map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 3000) })))
  await nextFrame(frame.contentWindow)
  return frame
}

describe('recognition: the walkthrough has a step index', () => {
  it('ten steps, each with an id the index links to, in order; plus the formats and the keys', async () => {
    const doc = parse(await fetchText('../tutorial.html'))
    const steps = [...doc.querySelectorAll('main h2')].filter(h => /^Step \d+\./.test(h.textContent))
    assert.eq(steps.length, 10)
    steps.forEach((h, i) => assert.eq(h.id, `step-${i + 1}`))
    const nav = doc.getElementById('docToc')
    assert.eq(nav.tagName, 'NAV')
    assert.ok(nav.getAttribute('aria-labelledby') && doc.getElementById(nav.getAttribute('aria-labelledby')))
    const links = [...nav.querySelectorAll('ol a')]
    assert.deepEq(links.map(a => a.getAttribute('href')), steps.map(h => '#' + h.id))
    links.forEach(a => assert.ok(a.textContent.replace(/^\d+/, '').trim().length >= 4, 'a short name for each step'))
    for (const id of ['formats', 'keyboard']) assert.ok(doc.getElementById(id) && nav.querySelector(`a[href="#${id}"]`), id)
    // After the strip and the first action, before the first step.
    assert.ok(doc.querySelector('.doc-cta').compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING)
    assert.ok(nav.compareDocumentPosition(steps[0]) & Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('it says what the app does now: Cmd+K, N then a letter, the minimap, Copy brief and Bring the reply back', async () => {
    const doc = parse(await fetchText('../tutorial.html'))
    const text = doc.querySelector('main').textContent.replace(/\s+/g, ' ').replace(/\s*\+\s*/g, ' + ')
    for (const now of ['⌘/Ctrl + K', 'N then a letter', 'minimap', 'Copy brief', 'Bring the reply back', 'Paste a reply', 'Brief tab', 'Framing']) {
      assert.includes(text, now, `"${now}"`)
    }
    // No row label that is being renamed; no section that only repeats the lede.
    assert.ok(!/diagram-builder/i.test(text))
    assert.ok([...doc.querySelectorAll('main h2')].every(h => h.textContent.trim() !== 'The situation'))
    // The long brief quotes are cut to what each step is about.
    doc.querySelectorAll('main .doc-pre').forEach(p => assert.ok(p.textContent.split('\n').length <= 8, `a quote of ${p.textContent.split('\n').length} lines`))
    assert.ok(!text.includes(EM_DASH))
  })

  it('at 1440 the index stays beside the steps; at 1024 and on a phone it is a list in the column', async () => {
    for (const [W, sticky] of [[1440, true], [1280, true], [1024, false], [390, false]]) {
      const f = await docFrame('tutorial.html', W, 900)
      try {
        const d = f.contentDocument, w = f.contentWindow
        const nav = d.getElementById('docToc'), main = d.querySelector('main').getBoundingClientRect()
        assert.eq(w.getComputedStyle(nav).position, sticky ? 'sticky' : 'static', `${W}px`)
        const list = nav.querySelector('ol').getBoundingClientRect()
        if (sticky) {
          assert.ok(list.right <= d.querySelector('main h2').getBoundingClientRect().left - 16, `${W}: in the margin, clear of the text`)
          assert.ok(list.left >= 0)
          assert.eq(Math.round(nav.getBoundingClientRect().height), 0, 'it takes no room in the column')
        } else {
          assert.ok(list.left >= main.left && list.right <= main.right + 0.5, `${W}: in the column`)
        }
        for (const a of nav.querySelectorAll('a')) {
          const r = a.getBoundingClientRect()
          assert.ok(r.height >= 24, `${a.textContent}: a 24px target`)
          assert.ok(parseFloat(w.getComputedStyle(a).fontSize) >= 13)
        }
        assert.ok(d.documentElement.scrollWidth <= W, `${W}: no sideways scroll`)
      } finally { f.remove() }
    }
  })

  it('the key table writes a chord as one press with a hidden plus, as the sheet does; a sequence stays words', async () => {
    const doc = parse(await fetchText('../tutorial.html'))
    const rows = [...doc.querySelectorAll('.doc-keys-caps')]
    assert.ok(rows.length >= 6)
    for (const caps of rows) {
      const kbds = caps.querySelectorAll('kbd')
      if (kbds.length < 2) continue
      // Every gap between two caps of a chord is a plus.
      for (let i = 1; i < kbds.length; i++) {
        let between = '', n = kbds[i - 1].nextSibling
        while (n && n !== kbds[i]) { between += n.textContent; n = n.nextSibling }
        assert.eq(between.trim(), '+', `${caps.textContent}: a chord`)
        assert.ok(kbds[i].closest('.kbd-press'), `${caps.textContent}: the caps of a chord sit together`)
      }
    }
    const text = rows.map(c => c.textContent.replace(/\s+/g, ' ').trim())
    assert.includes(text, '⌘/Ctrl+K'); assert.includes(text, 'Shift+1'); assert.includes(text, 'N then a letter')
  })

  it('Step 1 quotes every line the Situation writes, each cut marked, none dropped', async () => {
    const doc = parse(await fetchText('../tutorial.html'))
    const step = doc.getElementById('step-1')
    let n = step.nextElementSibling, pre = null
    while (n && n.tagName !== 'H2') { if (n.matches('pre')) { pre = n; break } n = n.nextElementSibling }
    const lines = pre.textContent.split('\n')
    assert.eq(lines[0], '## Situation')
    const bullets = lines.filter(l => l.startsWith('- ')).slice(0, 4)
    // The brief's own opening line and one line per choice made in the step.
    for (const start of ['This is a planning canvas exported from Pathfinder', 'The relevant repository is open to you', 'You are running in Claude Code', 'Start by reading the code']) {
      assert.ok(bullets.some(b => b.startsWith('- ' + start)), `"${start}" is quoted`)
    }
    bullets.forEach(b => assert.ok(b.endsWith('...'), `a cut is marked: ${b}`))
    assert.includes(pre.textContent, '### Constraints and boundaries')
    assert.includes(pre.previousElementSibling.textContent, 'cut short')
  })

  it('the step on screen is marked, and nothing is above the first step', async () => {
    const { currentSection } = await import('../js/doc-toc.js')
    assert.eq(currentSection([400, 900, 1500], 300), -1, 'the intro is no step')
    assert.eq(currentSection([100, 900, 1500], 300), 0)
    assert.eq(currentSection([-800, -100, 250], 300), 2)
    assert.eq(currentSection([], 300), -1)
  })
})

describe('recognition: the examples show whole maps, and read', () => {
  it('the count in the heading is the number of maps shown', async () => {
    const doc = parse(await fetchText('../examples.html'))
    const words = { two: 2, three: 3, four: 4, five: 5, six: 6 }
    const said = words[doc.querySelector('main h1').textContent.trim().split(/\s+/)[0].toLowerCase()]
    assert.eq(said, doc.querySelectorAll('section.ex').length)
    assert.eq(words[doc.querySelector('meta[name="description"]').content.split(/\s+/)[0].toLowerCase()], said)
  })

  for (const W of [1440, 390]) {
    it(`${W}px: each map fits the column whole, its detail reads at 11px or more on whole cards, and nothing scrolls sideways`, async () => {
      for (const theme of ['doc-page', 'doc-page light-mode']) {
        const f = await docFrame('examples.html', W, 900, theme)
        try {
          const d = f.contentDocument, w = f.contentWindow
          const col = d.querySelector('main section.ex p').getBoundingClientRect()
          const figs = [...d.querySelectorAll('figure.ex-figure')]
          assert.eq(figs.length, 4)
          for (const fig of figs) {
            const whole = [...fig.querySelectorAll('.ex-whole img')].find(i => i.getClientRects().length)
            const r = whole.getBoundingClientRect()
            assert.ok(r.width <= col.width + 0.5 && r.width >= col.width - 4, `${fig.dataset.detail}: the whole map is the column's width (${Math.round(r.width)} of ${Math.round(col.width)})`)
            assert.eq(/-light\.svg$/.test(whole.getAttribute('src')), theme.includes('light'))
            // The frame on the whole map is where the detail is.
            const mark = fig.querySelector('.ex-mark').getBoundingClientRect()
            assert.ok(mark.left >= r.left - 0.5 && mark.right <= r.right + 0.5 && mark.top >= r.top - 0.5 && mark.bottom <= r.bottom + 0.5, 'the frame sits on the map')
            assert.ok(mark.width > 8 && mark.height > 8, 'and is big enough to see')
            // The detail: the same picture at reading size, cut on its frame.
            const box = fig.querySelector('.ex-detail'), b = box.getBoundingClientRect()
            const img = [...box.querySelectorAll('img')].find(i => i.getClientRects().length)
            const own = img.naturalWidth || 1
            const title = 14 * img.getBoundingClientRect().width / own
            assert.ok(title >= 11, `${fig.dataset.detail}: card titles at ${title.toFixed(1)}px`)
            assert.ok(b.right <= col.right + 0.5, `${fig.dataset.detail}: the detail stays in the column`)
            assert.ok(b.height >= 60 && b.width >= 120, `${fig.dataset.detail}: a real detail (${Math.round(b.width)} x ${Math.round(b.height)})`)
            assert.ok(['hidden', 'clip'].includes(w.getComputedStyle(box).overflowX))
            // Its window over the picture matches the frame drawn on the whole map.
            const k = img.getBoundingClientRect().width / r.width
            assert.ok(Math.abs((b.width - 2) / k - mark.width) <= 3, `${fig.dataset.detail}: the frame is the detail's width`)
          }
          assert.ok(d.documentElement.scrollWidth <= W, `${W}: ${d.documentElement.scrollWidth}px wide`)
          // Document size on a phone too.
          assert.eq(w.getComputedStyle(d.querySelector('main section.ex p')).fontSize, '16px')
          assert.ok(d.querySelectorAll('.ex-actions .btn-primary').length === 4)
        } finally { f.remove() }
      }
    })
  }
})

describe('recognition: the example details cut nothing in two', () => {
  // Every card, label and line of text the exporter drew, in the picture's
  // own coordinates: the SVG laid out at its own size.
  async function drawn(src) {
    const host = document.createElement('div')
    host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none'
    host.innerHTML = await fetchText('../' + src)
    document.body.appendChild(host)
    const root = host.querySelector('svg'), o = root.getBoundingClientRect()
    const boxes = [...root.querySelectorAll('rect, text')].map(el => {
      const r = el.getBoundingClientRect()
      return { x1: r.left - o.left, y1: r.top - o.top, x2: r.right - o.left, y2: r.bottom - o.top, what: el.tagName + ' ' + (el.textContent || '').slice(0, 24) }
    }).filter(b => b.x2 - b.x1 > 0.5 && b.y2 - b.y1 > 0.5 && b.x2 - b.x1 < 600 && b.y2 - b.y1 < 600)
    const size = { W: o.width, H: o.height }
    host.remove()
    return { boxes, ...size }
  }
  it('the wide detail and the phone\'s each take a card or a label whole, or leave it out', async () => {
    const doc = parse(await fetchText('../examples.html'))
    const figs = [...doc.querySelectorAll('figure.ex-figure')]
    assert.eq(figs.length, 4)
    for (const fig of figs) {
      const v = name => +(fig.getAttribute('style').match(new RegExp(`${name}:([\\d.]+)`)) || [])[1]
      const { boxes, W, H } = await drawn(fig.querySelector('.ex-whole img').getAttribute('src'))
      for (const [kind, x, y, w, h] of [['wide', v('--fx'), v('--fy'), v('--fw'), v('--fh')], ['phone', v('--fx1'), v('--fy1'), v('--ff'), v('--fh1')]]) {
        const c = { x1: x * W, y1: y * H, x2: (x + w) * W, y2: (y + h) * H }
        // The style rounds to 4 places: about a fifth of a pixel on these.
        const tol = 0.75
        const cut = boxes.filter(b => b.x1 < c.x2 - tol && b.x2 > c.x1 + tol && b.y1 < c.y2 - tol && b.y2 > c.y1 + tol &&
          !(b.x1 >= c.x1 - tol && b.x2 <= c.x2 + tol && b.y1 >= c.y1 - tol && b.y2 <= c.y2 + tol))
        assert.eq(cut.map(b => b.what).join(', '), '', `${fig.dataset.detail} (${kind}): nothing cut`)
        assert.ok(boxes.some(b => b.x1 >= c.x1 && b.x2 <= c.x2 && b.y1 >= c.y1 && b.y2 <= c.y2 && b.what.startsWith('text')), `${fig.dataset.detail} (${kind}): it shows some text`)
      }
    }
  })
})

describe('recognition: the 404 wears the doc pages\' header', () => {
  it('the same header bar, skin, brand mark and home link as the walkthrough, at root paths', async () => {
    const nf = parse(await fetchText('../404.html')), tut = parse(await fetchText('../tutorial.html'))
    const a = nf.querySelector('header.header-bar'), b = tut.querySelector('header.header-bar')
    assert.ok(a, 'a header')
    for (const attr of ['data-header-mode', 'data-header-skin']) assert.eq(a.getAttribute(attr), b.getAttribute(attr), attr)
    assert.eq(a.querySelector('.header-logo-img').getAttribute('src'), '/energon-classic-logo.png', 'root-absolute, for a 404 at any depth')
    assert.eq(a.querySelector('.header-title-wrap h1').textContent.trim(), 'Pathfinder')
    assert.ok(a.querySelector('.header-home[href="https://neorgon.com/"] svg.nh-hub-icon'), 'the Neorgon mark')
    for (const href of ['/css/neorgon-header.css', '/css/neorgon-themes.css', '/css/neorgon-footer.css']) {
      assert.ok(nf.querySelector(`link[href="${href}"]`), href)
    }
    assert.ok(nf.querySelector('script[src="/js/neorgon-header.js"]') && nf.querySelector('script[src="/js/neorgon-footer.js"]'))
    assert.ok(nf.querySelector('footer.neo-footer[data-footer-mode="minimal"]'), 'and the doc pages\' footer')
    assert.eq(nf.querySelectorAll('main h1').length, 1, 'one page heading')
  })

  it('at 1440 and 390 the header is the walkthrough\'s height and the message sits in the room below it', async () => {
    for (const W of [1440, 390]) {
      const f = await docFrame('404.html', W, 800, 'doc-page nf-page')
      const t = await docFrame('tutorial.html', W, 800)
      try {
        const h = f.contentDocument.querySelector('.header-bar').getBoundingClientRect()
        const ht = t.contentDocument.querySelector('.header-bar').getBoundingClientRect()
        assert.ok(Math.abs(h.height - ht.height) <= 1, `${W}: ${Math.round(h.height)} vs ${Math.round(ht.height)}`)
        const m = f.contentDocument.querySelector('main.nf').getBoundingClientRect()
        assert.ok(m.top >= h.bottom, 'below the header')
        assert.ok(f.contentDocument.documentElement.scrollWidth <= W)
      } finally { f.remove(); t.remove() }
    }
  })
})
