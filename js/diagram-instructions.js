// ════════════════════════════════════════════════════════════
//  diagram-instructions.js — Copy-paste prompt for asking an AI
//  (Claude or any model) to generate a Pathfinder canvas as JSON.
//  Kept in one place so the Export menu and the docs stay in sync.
// ════════════════════════════════════════════════════════════

export const DIAGRAM_BUILDER_PROMPT = `You are generating a diagram for Pathfinder, a visual strategy / workflow canvas.
Return ONLY a single valid JSON object (no prose, no markdown fences) in exactly this shape:

{
  "blocks": [
    { "id": "b1", "type": "goal", "title": "Short label", "description": "1-4 lines. Use \\n for line breaks.", "x": 0, "y": 0 }
  ],
  "arrows": [
    { "from": "b1", "to": "b2", "label": "requires", "note": "optional longer explanation" }
  ],
  "meta": { "title": "Diagram name", "contextBrief": "One line of framing" }
}

RULES
- Every block needs a unique "id", a "type", and a "title". "description" is optional.
- Allowed "type" values ONLY:
  goal        - an objective to achieve
  problem     - a blocker or issue
  requirement - a hard constraint that must be met
  assumption  - a belief treated as true but not yet validated
  risk        - something that could go wrong
  decision    - a choice made or to be made
  question    - a genuine open unknown
  resource    - an available asset, tool, team, or link
  output      - an expected deliverable or result
  process     - a step / action in a workflow (e.g. "Update status to Ready")
  terminator  - the start or end of a workflow (e.g. "Submission received", "Approved")
  context     - background information that frames things
  custom      - only if nothing above fits
- Use process + terminator for end-to-end workflows (Start -> step -> step -> End).
  Use goal / requirement / risk / etc. for strategy maps. Do not put a flow node where a
  requirement is meant, or vice-versa.
- Lay blocks out left-to-right in reading / flow order. Space them ~320px apart on x and
  ~140px apart on y so they do not overlap. Give x / y as plain numbers.
- Arrows point from cause -> effect (or step -> next step). "label" is 1-3 words
  ("requires", "blocks", "enables", "yes", "no", "approved"). Put any longer reasoning in "note".
- Keep titles short; put detail in "description" using \\n between lines.
- Aim for 6-14 blocks unless I ask for more.

After you return the JSON, I will import it into Pathfinder via Export -> Import JSON.

Now build the canvas for: <DESCRIBE YOUR DIAGRAM HERE>`
