// ════════════════════════════════════════════════════════════
//  trace/prompt-trace.js: Ask an assistant for a trace
//
//  The schema is generated from the registries rather than restated here,
//  so a kind added to model.js appears in the prompt without anybody
//  remembering to update a second copy. That drift is the usual reason a
//  hand-written "here is our format" prompt starts producing documents the
//  parser rejects.
// ════════════════════════════════════════════════════════════

import { NODE_KINDS, TOPO_KINDS, LINK_STATES } from './model.js'

const rows = reg => Object.entries(reg).map(([k, v]) => `- \`${k}\`: ${v.hint || v.label}`).join('\n')

export function buildTracePrompt(trace) {
  const kind = trace?.meta?.kind || 'tree'
  const has = trace && trace.nodes.length

  return `You are writing a **Pathfinder trace**: a YAML document that renders as a
troubleshooting decision tree or an architecture map. Reply with one fenced
\`\`\`yaml block and nothing else.

## The shape

\`\`\`yaml
trace:
  title: One line naming the failure, not the topic
  kind: ${kind}            # tree | topology
  intent: What this document is for
  root: <node id>       # trees only: where a reader starts
  nodes:
    - id: short-stable-id
      kind: check
      ask: The question, phrased so it can be answered by observation
      detail: |
        Why it matters and what the answer means. Prose folds, so wrap the
        source file wherever you like; leave a blank line for a paragraph.
      probe: the exact command that answers it
      branches:
        - when: the observable outcome
          to: another-node-id
  links:                # topology only
    - from: a
      to: b
      label: "TCP 443"
      state: broken
      evidence: how you know
\`\`\`

## Tree node kinds

${rows(NODE_KINDS)}

## Topology node kinds

${rows(TOPO_KINDS)}

Containment is flat: put \`in: <container-id>\` on a node. Containers nest,
so an account holds a VPC which holds a subnet.

## Link state

${rows(LINK_STATES)}

## Rules that make a trace worth reading

1. **Branch on what can be observed**, never on what has to be inferred.
   "hangs, then times out" is a branch. "the network is misconfigured" is not.
2. **Every check carries a \`probe:\`.** A check nobody can run is a check
   they will guess at.
3. **Order branches by what they cost to check.** The cheapest discriminating
   test goes first, at the root.
4. **Only \`check\` makes decisions.** Anything else gets one \`next:\`.
5. **Do not mark a hop \`ok\` you have not verified.** \`unknown\` is the
   honest default and the map is worth more for keeping it.
6. Say \`deadend\` when a path leaves your control, and say who owns it.

${has ? `## The current trace

It has ${trace.nodes.length} nodes and ${trace.edges.length} links, titled
"${trace.meta.title}". Extend it rather than replacing it, keeping every
existing id stable so the links survive.

Existing ids: ${trace.nodes.map(n => n.id).join(', ')}
` : ''}Return the complete document, not a patch.`
}
