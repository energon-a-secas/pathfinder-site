import { state, ui, view, serializeCanvas } from './state.js'
import { $, escHtml, DEFAULT_WIDTH, getBlockDims, clamp, MIN_ZOOM, MAX_ZOOM } from './utils.js'
import { currentId, restoreSnapshot, diffPayloads } from './library.js'
import { compareCanvases } from './comparison.js'
import { blockDetails } from './change-details.js'
import { connectionLabel } from './relations.js'
import { applyTransform } from './canvas.js'
import { focusBlock } from './ui-panels.js'

let active = null, changes = null, previousTab = 'inspector', wasCollapsed = false, signature = ''
const name = change => (change.after || change.before).title || '(untitled)'
const pretty = value => value == null ? 'Not present' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
const detail = (before, after) => `<details class="change-detail"><summary>Before and after</summary><strong>Before</strong><pre>${escHtml(before)}</pre><strong>After</strong><pre>${escHtml(after)}</pre></details>`

function clearMarks() {
  document.querySelectorAll('[data-comparison]').forEach(el => delete el.dataset.comparison)
  document.getElementById('comparisonGhosts')?.remove()
}

export function closeComparison() {
  if (!active) return
  active = null; changes = null; signature = ''
  document.body.classList.remove('comparing-snapshot')
  clearMarks()
  document.getElementById('comparisonBar').hidden = true
  document.getElementById('comparisonHeader').hidden = true
  document.querySelector('.panel-tabs').hidden = false
  document.querySelector(`[data-tab="${previousTab}"]`)?.click()
  if (wasCollapsed) document.getElementById('rightPanel').classList.add('collapsed')
}

function markCanvas() {
  clearMarks()
  const ghosts = document.createElement('div')
  ghosts.id = 'comparisonGhosts'; ghosts.setAttribute('aria-hidden', 'true')
  changes.blocks.forEach(change => {
    if (change.after) {
      const el = document.getElementById('b-' + change.id)
      if (el) el.dataset.comparison = change.kind
    } else {
      const block = change.before, el = document.createElement('div')
      el.className = 'snapshot-ghost'; el.dataset.comparison = 'removed'
      Object.assign(el.style, { left: block.x + 'px', top: block.y + 'px', width: (block.width || DEFAULT_WIDTH) + 'px' })
      el.innerHTML = `<span>Removed</span><strong>${escHtml(name(change))}</strong>`
      ghosts.appendChild(el)
    }
  })
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg')
  svg.classList.add('comparison-edges')
  changes.arrows.forEach(change => {
    const arrow = change.after || change.before
    if (change.after) {
      const current = state.arrows.find(a => a.from === arrow.from && a.to === arrow.to)
      const group = [...document.querySelectorAll('#arrowsGroup [data-aid]')].find(el => el.dataset.aid === current?.id)
      if (group) group.dataset.comparison = change.kind
    } else {
      const from = changes.before.blocks[arrow.from], to = changes.before.blocks[arrow.to]
      if (!from || !to) return
      const line = document.createElementNS(ns, 'line')
      line.setAttribute('x1', from.x + (from.width || DEFAULT_WIDTH) / 2)
      line.setAttribute('y1', from.y + 40)
      line.setAttribute('x2', to.x + (to.width || DEFAULT_WIDTH) / 2)
      line.setAttribute('y2', to.y + 40)
      svg.appendChild(line)
    }
  })
  ghosts.prepend(svg)
  $.canvasRoot().appendChild(ghosts)
}

function renderChanges() {
  const edgeText = (arrow, canvas) => arrow ? `${canvas.blocks[arrow.from]?.title || arrow.from} → ${canvas.blocks[arrow.to]?.title || arrow.to}\n${connectionLabel(arrow)}${arrow.note ? '\n' + arrow.note : ''}\nStyle: ${arrow.style}, weight: ${arrow.weight}, color: ${arrow.color || 'default'}\nDirection: ${arrow.bidirectional ? 'both ways' : 'one way'}\nConnection sides: ${arrow.fromPort || 'automatic'} → ${arrow.toPort || 'automatic'}${arrow.portsBy ? '\nSides placed by Tidy' : ''}` : 'Not connected'
  const blockRows = changes.blocks.map((change, i) => `<li class="comparison-change">
    <button class="comparison-jump" data-change="${i}"><span class="comparison-kind ${change.kind}">${change.kind}</span><strong>${escHtml(name(change))}</strong><span>Show on canvas →</span></button>
    ${change.fields.length ? `<p class="comparison-fields">Changed: ${escHtml(change.fields.join(', '))}</p>` : ''}
    ${detail(blockDetails(change.before), blockDetails(change.after))}
  </li>`).join('')
  const edgeRows = changes.arrows.map(change => `<li class="comparison-change"><p class="comparison-fields">Connection ${change.kind}</p>${detail(edgeText(change.before, changes.before), edgeText(change.after, changes.after))}</li>`).join('')
  const otherRows = [...changes.groups.map(change => ({ ...change, category: 'Group' })), ...changes.meta.map(change => ({ ...change, category: 'Map setting' }))]
    .map(change => `<li class="comparison-change"><p class="comparison-fields">${change.category}: ${escHtml(change.id)}</p>${detail(pretty(change.before), pretty(change.after))}</li>`).join('')
  document.getElementById('comparisonList').innerHTML = blockRows + edgeRows + otherRows
  document.getElementById('comparisonSummary').textContent = diffPayloads(active.snapshot.payload, serializeCanvas())
}

function fitChanges() {
  if (!changes) return
  const blocks = changes.blocks.length ? changes.blocks.map(change => change.after || change.before) : Object.values(state.blocks)
  if (!blocks.length) return
  const boxes = blocks.map(block => {
    const dims = state.blocks[block.id] ? getBlockDims(block.id) : { w: block.width || DEFAULT_WIDTH, h: 80 }
    return { x: block.x, y: block.y, ...dims }
  })
  const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y))
  const right = Math.max(...boxes.map(b => b.x + b.w)), bottom = Math.max(...boxes.map(b => b.y + b.h))
  const viewport = $.canvasViewport()
  view.zoom = clamp(Math.min(1, (viewport.clientWidth - 80) / Math.max(right - left, 1), (viewport.clientHeight - 160) / Math.max(bottom - top, 1)), MIN_ZOOM, MAX_ZOOM)
  view.panX = viewport.clientWidth / 2 - (left + right) / 2 * view.zoom
  view.panY = viewport.clientHeight / 2 - (top + bottom) / 2 * view.zoom
  applyTransform()
}

function refresh() {
  if (!active) return
  if (currentId() !== active.mapId) { closeComparison(); return }
  const payload = serializeCanvas(), next = JSON.stringify(payload)
  if (next !== signature) {
    signature = next
    changes = compareCanvases(active.snapshot.payload, payload)
    renderChanges()
  }
  // Rendering a block can replace its classes without changing its contents.
  markCanvas()
}

export function openComparison(snapshot) {
  if (ui.readOnly || ui.embed || !snapshot?.payload) return false
  if (active) closeComparison()
  previousTab = ui.activeTab
  const panel = document.getElementById('rightPanel')
  wasCollapsed = panel.classList.contains('collapsed')
  panel.classList.remove('collapsed')
  active = { snapshot, mapId: currentId() }
  document.body.classList.add('comparing-snapshot')
  ui.activeTab = 'comparison'
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.toggle('active', el.id === 'comparisonPane'))
  document.querySelector('.panel-tabs').hidden = true
  document.getElementById('comparisonHeader').hidden = false
  document.getElementById('comparisonBar').hidden = false
  document.getElementById('comparisonName').textContent = snapshot.name
  document.getElementById('comparisonDate').textContent = new Date(snapshot.at).toLocaleString()
  refresh()
  document.querySelector('.panel-content').scrollTop = 0
  requestAnimationFrame(fitChanges)
  document.getElementById('comparisonClose').focus()
  return true
}

export function setupComparison() {
  document.getElementById('comparisonFit')?.addEventListener('click', fitChanges)
  document.getElementById('comparisonClose')?.addEventListener('click', () => { closeComparison(); document.getElementById('mapsBtn')?.focus() })
  document.getElementById('comparisonBarClose')?.addEventListener('click', closeComparison)
  document.getElementById('comparisonRestore')?.addEventListener('click', () => {
    if (active && restoreSnapshot(active.snapshot.id)) closeComparison()
  })
  document.getElementById('comparisonList')?.addEventListener('click', e => {
    const button = e.target.closest('[data-change]')
    if (!button || !changes) return
    const change = changes.blocks[Number(button.dataset.change)]
    if (change.after) focusBlock(change.id)
    else {
      const block = change.before, viewport = $.canvasViewport()
      view.zoom = clamp(Math.max(view.zoom, 1), MIN_ZOOM, MAX_ZOOM)
      view.panX = viewport.clientWidth / 2 - (block.x + (block.width || DEFAULT_WIDTH) / 2) * view.zoom
      view.panY = viewport.clientHeight / 2 - (block.y + 40) * view.zoom
      applyTransform()
    }
  })
  for (const id of ['comparisonBar', 'comparisonHeader', 'comparisonPane']) {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeComparison(); document.getElementById('mapsBtn')?.focus() }
      e.stopPropagation()
    })
  }
  window.addEventListener('pf:compare-snapshot', e => openComparison(e.detail))
  let queued = false
  const queue = () => {
    if (!active || queued) return
    queued = true
    requestAnimationFrame(() => { queued = false; refresh() })
  }
  window.addEventListener('pf:canvas-changed', queue)
  window.addEventListener('pf:save-status', queue)
}
