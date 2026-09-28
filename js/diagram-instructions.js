// ════════════════════════════════════════════════════════════
//  diagram-instructions.js: copy-paste prompt for asking an AI
//  (Claude or any model) to generate a Pathfinder canvas as JSON.
//  Kept in one place so the Export menu and the docs stay in sync,
//  and built from the type registry so the allowed types, their
//  meanings and the order worth mapping them in cannot drift from
//  what the app actually accepts.
// ════════════════════════════════════════════════════════════

import { TYPES, TYPE_STEPS, TYPE_DISAMBIGUATION, typesByStep } from './utils.js'

// The first quoted example in a registry entry, for the one-line list.
const firstExample = t => (TYPES[t].example.match(/"[^"]+"/) || [''])[0]

const WIDTH = Math.max(...Object.keys(TYPES).map(t => t.length)) + 1

/** One line per type, in registry order: id, label, meaning, an example. */
export function allowedTypeLines() {
  return Object.keys(TYPES).map(t => {
    const ex = firstExample(t)
    const label = TYPES[t].label.toLowerCase() === t ? '' : `(${TYPES[t].label}) `
    return `  ${t.padEnd(WIDTH)}- ${label}${TYPES[t].short}${ex ? ` (e.g. ${ex})` : ''}`
  }).join('\n')
}

/** The six questions a map answers, with the types that answer each. */
export function stepLines() {
  return typesByStep()
    .filter(g => g.step !== 'other' && g.types.length)
    .map((g, i) => `  ${i + 1}. ${g.label}: ${TYPE_STEPS.find(s => s.id === g.step).hint} (${g.types.join(', ')})`)
    .join('\n')
}

export const DIAGRAM_BUILDER_PROMPT = `You are generating a diagram for Pathfinder, a visual strategy / workflow canvas.
Return ONLY a single valid JSON object (no prose, no markdown fences) in exactly this shape:

{
  "blocks": [
    { "id": "b1", "type": "goal", "title": "Short label", "description": "1-4 lines. Use \\n for line breaks.", "x": 0, "y": 0 }
  ],
  "arrows": [
    { "from": "b1", "to": "b2", "relation": "depends-on", "label": "requires", "note": "optional longer explanation" }
  ],
  "meta": { "title": "Diagram name", "contextBrief": "One line of framing" }
}

RULES
- Every block needs a unique "id", a "type", and a "title". "description" is optional.
- Allowed "type" values ONLY:
${allowedTypeLines()}
- Map in this order, and skip a step only when it truly does not apply:
${stepLines()}
  "context" frames any step; use "custom" only when nothing above fits.
- Pairs that get confused:
${TYPE_DISAMBIGUATION.map(l => `  ${l}`).join('\n')}
- Put targets for a metric in "criteria" (a list of short strings, e.g. ["At or above 80% by Q4"]),
  and the definition of done for a requirement there too.
- Use process + terminator for end-to-end workflows (trigger -> step -> step -> end).
  Use goal / requirement / risk / etc. for strategy maps. Do not put a flow node where a
  requirement is meant, or vice-versa.
- Lay blocks out left-to-right in reading / flow order. Space them ~320px apart on x and
  ~140px apart on y so they do not overlap. Give x / y as plain numbers.
- Set arrow "relation" to "precedes" (step -> next step), "depends-on" (source needs target first),
  "blocks" (source must finish before target), "informs", or "related" (context, no task ordering).
  "label" is optional, 1-3 words
  ("requires", "satisfies", "measures", "delivered to", "yes", "no"). Put any longer reasoning in "note".
- Keep titles short; put detail in "description" using \\n between lines.
- Aim for 6-14 blocks unless I ask for more.

After you return the JSON, I will import it into Pathfinder via File -> Import JSON / Canvas / Mermaid.

Now build the canvas for: <DESCRIBE YOUR DIAGRAM HERE>`
