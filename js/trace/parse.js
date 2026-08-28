// ════════════════════════════════════════════════════════════
//  trace/parse.js: YAML text to a normalized trace
//
//  Pure. No DOM, no app state, and no YAML dependency: the caller passes
//  a loader in, so this same module runs in the browser against the global
//  js-yaml and in Node against the npm package, and validate.mjs proves
//  the browser's own acceptance rather than a reimplementation of it.
//
//  Nothing here throws on bad input. A trace is a document somebody is
//  typing, so it is malformed most of the time it is read. Every problem
//  becomes a diagnostic with the id it happened at, and whatever parsed
//  still renders. An editor that blanks the page on a missing comma is an
//  editor people stop typing in.
// ════════════════════════════════════════════════════════════

import { NODE_KINDS, TOPO_KINDS, LINK_STATES, defaultStateFor,
         TRACE_STATUS, DEFAULT_STATUS, KINDS, DEFAULT_KIND } from './model.js'

const str = v => (v == null ? '' : String(v)).trim()
const list = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v])

/** Slug an arbitrary label into a usable id, for nodes that omit one. */
function slug(s, taken) {
  let base = str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'n'
  let id = base, i = 2
  while (taken.has(id)) id = `${base}-${i++}`
  return id
}

/**
 * Normalize a parsed YAML object into the shape the renderer consumes.
 *
 * Accepts either a document wrapped in `trace:` or the bare body, because
 * both read naturally and rejecting one is a pointless thing to make
 * somebody remember.
 */
export function normalizeTrace(raw) {
  const D = []
  const diag = (level, msg, at) => D.push({ level, msg, at: at || null })

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    diag('error', 'The document is empty, or its top level is not a mapping.')
    return emptyTrace(D)
  }
  const doc = (raw.trace && typeof raw.trace === 'object' && !Array.isArray(raw.trace)) ? raw.trace : raw

  // ── meta ───────────────────────────────────────────────────
  let kind = str(doc.kind).toLowerCase() || DEFAULT_KIND
  if (!KINDS.includes(kind)) {
    diag('warn', `Unknown kind "${kind}". Falling back to "${DEFAULT_KIND}". Known: ${KINDS.join(', ')}.`)
    kind = DEFAULT_KIND
  }
  let status = str(doc.status).toLowerCase() || DEFAULT_STATUS
  if (!TRACE_STATUS[status]) {
    diag('warn', `Unknown status "${status}". Falling back to "${DEFAULT_STATUS}".`)
    status = DEFAULT_STATUS
  }
  const meta = {
    title:   str(doc.title) || 'Untitled trace',
    kind, status,
    intent:  str(doc.intent),
    updated: str(doc.updated),
    owner:   str(doc.owner),
    dir:     str(doc.direction).toUpperCase() === 'TB' ? 'TB' : 'LR',
  }

  const KINDSET = kind === 'topology' ? TOPO_KINDS : NODE_KINDS
  const defaultKind = kind === 'topology' ? 'service' : 'action'

  // ── nodes ──────────────────────────────────────────────────
  // Accept a list of mappings, or a mapping of id -> body. The second
  // reads better for a tree, where ids are referenced constantly.
  let rawNodes = []
  const src = doc.nodes ?? doc.steps ?? doc.parts
  if (Array.isArray(src)) rawNodes = src.filter(n => n && typeof n === 'object')
  else if (src && typeof src === 'object') rawNodes = Object.entries(src).map(([id, body]) =>
    (body && typeof body === 'object' && !Array.isArray(body)) ? { id, ...body } : { id, title: str(body) })
  else if (src != null) diag('error', '`nodes` must be a list or a mapping.')

  const taken = new Set()
  const nodes = []
  for (const n of rawNodes) {
    let id = str(n.id)
    if (!id) {
      id = slug(n.title ?? n.ask ?? n.do ?? n.label, taken)
      diag('warn', `A node had no id; using "${id}". Give it one so links stay stable.`, id)
    }
    if (taken.has(id)) { diag('error', `Duplicate node id "${id}". The later one is dropped.`, id); continue }
    taken.add(id)

    const branches = readBranches(n, id, diag)
    let k = str(n.kind).toLowerCase()
    if (!k) k = branches.length ? (kind === 'topology' ? defaultKind : 'check') : defaultKind
    if (!KINDSET[k]) {
      diag('warn', `Node "${id}" has unknown kind "${k}". Falling back to "${defaultKind}".`, id)
      k = defaultKind
    }
    // One `next:` is a continuation and is silent. Two or more outgoing
    // branches is a decision, and a node making a decision while calling
    // itself something else is the thing worth reporting.
    if (kind === 'tree' && branches.length > 1 && k !== 'check')
      diag('warn', `Node "${id}" is kind "${k}" but makes a ${branches.length}-way decision. Make it a "check", or give it one \`next:\` and move the decision to its own node.`, id)

    nodes.push({
      id, kind: k,
      title:  str(n.title ?? n.ask ?? n.do ?? n.label) || id,
      detail: str(n.detail ?? n.body ?? n.description),
      why:    str(n.why ?? n.rationale),
      probes: list(n.probe ?? n.probes).map(str).filter(Boolean),
      ref:    str(n.ref ?? n.link ?? n.doc),
      parent: str(n.in ?? n.parent) || null,
      tags:   list(n.tags).map(str).filter(Boolean),
      branches,
    })
  }
  if (!nodes.length) diag('error', 'The trace has no nodes.')

  const byId = new Map(nodes.map(n => [n.id, n]))

  // ── edges ──────────────────────────────────────────────────
  // One edge list feeds layout, routing and rendering, whether it came
  // from a tree's branches or a topology's links. The renderer never
  // learns which document kind it is drawing.
  const edges = []
  let seq = 0
  const addEdge = (from, to, e, at) => {
    if (!byId.has(from)) { diag('error', `Link from unknown node "${from}".`, at); return }
    if (!byId.has(to))   { diag('error', `Node "${from}" points at "${to}", which does not exist.`, at || from); return }
    if (from === to)     { diag('warn',  `Node "${from}" links to itself. Dropped.`, from); return }
    const fallback = defaultStateFor(kind)
    let state = str(e.state).toLowerCase() || fallback
    if (!LINK_STATES[state]) {
      diag('warn', `Unknown link state "${state}" on ${from} to ${to}. Using "${fallback}".`, from)
      state = fallback
    }
    edges.push({
      id: `e${++seq}`, from, to,
      label: str(e.label ?? e.when), state,
      evidence: str(e.evidence), note: str(e.note),
    })
  }

  nodes.forEach(n => n.branches.forEach(b => addEdge(n.id, b.to, b, n.id)))

  for (const l of list(doc.links ?? doc.edges)) {
    if (!l || typeof l !== 'object') { diag('warn', 'A link was not a mapping. Dropped.'); continue }
    addEdge(str(l.from), str(l.to), l, str(l.from))
  }
  if (kind === 'tree' && list(doc.links ?? doc.edges).length)
    diag('warn', 'A tree normally wires itself with `branches`. Explicit `links` also work, but mixing the two makes the flow hard to follow.')

  // ── containment ────────────────────────────────────────────
  nodes.forEach(n => {
    if (!n.parent) return
    if (!byId.has(n.parent)) { diag('error', `Node "${n.id}" sits in "${n.parent}", which does not exist.`, n.id); n.parent = null; return }
    const p = byId.get(n.parent)
    const pk = TOPO_KINDS[p.kind]
    if (kind === 'topology' && (!pk || !pk.container))
      diag('warn', `Node "${n.id}" sits in "${n.parent}", which is not a container kind.`, n.id)
  })
  breakContainmentCycles(nodes, byId, diag)

  // ── root ───────────────────────────────────────────────────
  let root = str(doc.root)
  if (root && !byId.has(root)) { diag('error', `root "${root}" is not a node.`); root = '' }
  if (kind === 'tree' && !root) {
    const targeted = new Set(edges.map(e => e.to))
    const roots = nodes.filter(n => !targeted.has(n.id))
    if (roots.length === 1) root = roots[0].id
    else if (roots.length > 1) diag('warn', `No \`root\` set and ${roots.length} nodes have nothing pointing at them (${roots.slice(0,4).map(n=>n.id).join(', ')}${roots.length>4?', …':''}). Set \`root\` so the entry point is not a guess.`)
    else if (nodes.length) diag('warn', 'Every node has something pointing at it, so the tree has no entry point. Set `root`.')
  }

  // ── reachability, trees only ───────────────────────────────
  if (kind === 'tree' && root) {
    const seen = new Set([root]), queue = [root]
    while (queue.length) {
      const cur = queue.shift()
      edges.filter(e => e.from === cur).forEach(e => { if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to) } })
    }
    const orphans = nodes.filter(n => !seen.has(n.id) && n.kind !== 'note')
    if (orphans.length)
      diag('warn', `${orphans.length} node${orphans.length>1?'s are':' is'} unreachable from the root: ${orphans.slice(0,5).map(n=>n.id).join(', ')}${orphans.length>5?', …':''}.`)

    nodes.forEach(n => {
      if (n.kind !== 'check') return
      if (n.branches.length === 0) diag('warn', `Check "${n.id}" asks a question and has no branches.`, n.id)
      else if (n.branches.length === 1) diag('warn', `Check "${n.id}" has one branch, so it is not a decision. Make it an action, or add the other outcome.`, n.id)
      if (n.branches.some(b => !b.label)) diag('warn', `A branch out of "${n.id}" has no \`when:\`. Unlabelled branches are the main reason a tree stops being followable.`, n.id)
    })
  }

  return { meta, nodes, edges, byId, root, diagnostics: D }
}

function readBranches(n, id, diag) {
  const out = []
  const push = (to, label, extra = {}) => { if (to) out.push({ to: str(to), label: str(label), ...extra }) }

  const raw = n.branches ?? n.then
  if (Array.isArray(raw)) {
    raw.forEach(b => {
      if (!b || typeof b !== 'object') { diag('warn', `A branch on "${id}" was not a mapping. Dropped.`, id); return }
      push(b.to ?? b.goto, b.when ?? b.label, { state: b.state, note: str(b.note), evidence: str(b.evidence) })
    })
  } else if (raw && typeof raw === 'object') {
    // `branches: { yes: node-a, no: node-b }`, the shortest readable form.
    Object.entries(raw).forEach(([when, to]) => push(to, when))
  } else if (raw != null) diag('warn', `\`branches\` on "${id}" must be a list or a mapping.`, id)

  // `yes:` / `no:` sit directly on the node, which is how most real
  // troubleshooting trees are written by hand.
  if (n.yes != null) push(n.yes, 'yes')
  if (n.no  != null) push(n.no,  'no')
  if (n.next != null) push(n.next, '')

  return out
}

/**
 * A container cannot contain itself, directly or through a chain. Left in
 * place it hangs the layout rather than producing a wrong picture, so it
 * is cut here and reported.
 */
function breakContainmentCycles(nodes, byId, diag) {
  nodes.forEach(n => {
    const seen = new Set([n.id])
    let cur = n
    while (cur.parent) {
      if (seen.has(cur.parent)) {
        diag('error', `Containment loop: "${cur.id}" ends up inside itself. The \`in:\` on "${cur.id}" is dropped.`, cur.id)
        cur.parent = null
        return
      }
      seen.add(cur.parent)
      cur = byId.get(cur.parent)
      if (!cur) return
    }
  })
}

function emptyTrace(D) {
  return { meta: { title: 'Untitled trace', kind: DEFAULT_KIND, status: DEFAULT_STATUS, intent: '', updated: '', owner: '', dir: 'LR' },
           nodes: [], edges: [], byId: new Map(), root: '', diagnostics: D }
}

/**
 * Parse YAML text. `load` is js-yaml's `load`, passed in by the caller.
 * A syntax error becomes a diagnostic carrying its line, not an exception.
 */
export function parseTraceText(text, load) {
  if (!str(text)) return emptyTrace([{ level: 'error', msg: 'Nothing to parse yet.', at: null }])
  let doc
  try { doc = load(text) }
  catch (e) {
    const line = e && e.mark && Number.isFinite(e.mark.line) ? e.mark.line + 1 : null
    const reason = str(e && e.reason) || str(e && e.message) || 'could not be parsed'
    return emptyTrace([{ level: 'error', msg: line ? `YAML error on line ${line}: ${reason}` : `YAML error: ${reason}`, at: null, line }])
  }
  return normalizeTrace(doc)
}

export const errorsOf = t => t.diagnostics.filter(d => d.level === 'error')
export const warningsOf = t => t.diagnostics.filter(d => d.level === 'warn')
