// ════════════════════════════════════════════════════════════
//  trace/suggest.js: What to try next
//
//  The engine is generic and the knowledge is data. A rule looks at the
//  shape of the trace (which kinds are present, which hops are broken,
//  whether anything crosses an account boundary) and at its words, and
//  returns things to go and check.
//
//  Two rules it follows, both learned the hard way from tools that ignore
//  them. A suggestion names a command you can run, not a topic you could
//  read about. And it fires on structure wherever possible, because a rule
//  that fires on a keyword alone fires on the word appearing in a sentence
//  saying that thing is fine.
// ════════════════════════════════════════════════════════════

import { AWS_PACK } from './packs/aws.js'
import { TOPO_KINDS } from './model.js'

export const PACKS = [AWS_PACK]

/** Everything a rule is allowed to look at, computed once. */
function context(trace) {
  const kinds = new Set(trace.nodes.map(n => n.kind))
  const text = trace.nodes
    .map(n => [n.title, n.detail, n.why, ...(n.probes || []), ...(n.tags || [])].join(' '))
    .join(' ')
    .toLowerCase()

  const containerOf = id => {
    let cur = trace.byId.get(id), chain = []
    while (cur && cur.parent) { chain.push(cur.parent); cur = trace.byId.get(cur.parent) }
    return chain
  }
  const accountOf = id => containerOf(id).find(c => trace.byId.get(c)?.kind === 'account') || null

  const broken = trace.edges.filter(e => e.state === 'broken')
  const crossAccount = trace.edges.filter(e => {
    const a = accountOf(e.from), b = accountOf(e.to)
    return a && b && a !== b
  })

  return {
    trace, kinds, text,
    isTopology: trace.meta.kind === 'topology',
    isTree: trace.meta.kind === 'tree',
    broken, crossAccount,
    brokenCrossAccount: broken.filter(e => crossAccount.includes(e)),
    has: k => kinds.has(k),
    says: (...words) => words.some(w => text.includes(w)),
    containerKinds: new Set(trace.nodes.filter(n => TOPO_KINDS[n.kind]?.container).map(n => n.kind)),
  }
}

/**
 * Rules are evaluated in pack order and capped, because a panel of twenty
 * suggestions is a panel nobody reads. Ranking is by the rule's own weight,
 * so a pack author decides what matters rather than the order they typed.
 */
export function suggestFor(trace, { limit = 6 } = {}) {
  if (!trace || !trace.nodes.length) return []
  const ctx = context(trace)
  const out = []

  for (const pack of PACKS) {
    for (const rule of pack.rules) {
      let hit
      try { hit = rule.when(ctx) } catch (_) { hit = false }
      if (!hit) continue
      // Any field may be a function of the context, so a rule can report a
      // count rather than a generic sentence. Unwrapping only some of them
      // is how a function ends up rendered as its own source.
      const val = f => (typeof f === 'function' ? f(ctx) : f)
      out.push({
        id: rule.id,
        title: val(rule.title),
        body: val(rule.body),
        why: val(rule.why),
        probes: val(rule.probes) || [],
        weight: rule.weight ?? 50,
      })
    }
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, limit)
}
