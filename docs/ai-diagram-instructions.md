# Building Pathfinder diagrams with AI

Two ready-to-copy prompts. **Prompt A** asks an AI to hand you a finished canvas
you can paste straight into Pathfinder (via Export ▾ → Import JSON, or by pasting
the JSON into a file and importing it). **Prompt B** is the reverse — it primes an
AI with how Pathfinder thinks so it asks *you* the right questions first.

---

## Prompt A — "Generate a Pathfinder canvas as JSON"

Copy everything in the block below, then replace the last line with your topic.

```
You are generating a diagram for Pathfinder, a visual strategy/workflow canvas.
Return ONLY a single valid JSON object (no prose, no markdown fences) in exactly
this shape:

{
  "blocks": [
    {
      "id": "b1",
      "type": "goal",
      "title": "Short label (a few words)",
      "description": "1-4 lines of detail. Use \n for line breaks.",
      "x": 0,
      "y": 0
    }
  ],
  "arrows": [
    { "from": "b1", "to": "b2", "label": "requires", "note": "optional longer explanation" }
  ],
  "meta": { "title": "Diagram name", "contextBrief": "One line of framing" }
}

RULES
- Every block needs a unique "id", a "type", and a "title". "description" is optional.
- Allowed "type" values ONLY:
  goal        — an objective to achieve
  problem     — a blocker or issue
  requirement — a hard constraint that must be met
  assumption  — a belief treated as true but not yet validated
  risk        — something that could go wrong
  decision    — a choice made or to be made
  question    — a genuine open unknown
  resource    — an available asset, tool, team, link
  output      — an expected deliverable or result
  process     — a step/action in a workflow (e.g. "Update status to Ready")
  terminator  — the start or end of a workflow (e.g. "Submission received", "Approved")
  context     — background information that frames things
  custom       — only if nothing above fits
- Use process + terminator for end-to-end workflows (Start → step → step → End).
  Use goal/requirement/risk/etc. for strategy maps. Don't mix a flow node in where
  a requirement is meant, or vice-versa.
- Lay blocks out left-to-right in reading/flow order. Space them ~320px apart on x
  and ~140px apart on y so they don't overlap. Give x/y as plain numbers.
- Arrows point from cause → effect (or step → next step). "label" is 1-3 words
  ("requires", "blocks", "enables", "yes", "no", "approved"). Put any longer
  reasoning in "note".
- Keep titles short; put detail in "description" using \n between lines.
- Aim for 6-14 blocks unless I ask for more.

Now build the canvas for: <DESCRIBE YOUR DIAGRAM HERE>
```

**To use the result:** save the AI's JSON to a `.json` file and in Pathfinder use
**Export ▾ → Import JSON** (choose *Replace* or *Merge*). Anything malformed is
skipped safely rather than breaking the canvas.

---

## Prompt B — "Interview me, then draft the canvas"

Use this when you're not sure what the diagram should contain yet.

```
Act as a planning facilitator using the Pathfinder canvas model. Its block types
are: goal, problem, requirement, assumption, risk, decision, question, resource,
output, process (a workflow step), terminator (workflow start/end), context.

First ask me 3-6 sharp questions to surface: the goal, the hard requirements, the
riskiest assumptions, and — if this is a workflow — the start, the ordered steps,
and the end state. Ask about gaps and unknowns, not just what I already know.

After I answer, output the canvas as a JSON object with this shape:
{ "blocks":[{ "id","type","title","description","x","y" }],
  "arrows":[{ "from","to","label","note" }],
  "meta":{ "title","contextBrief" } }
using only the allowed types above, laid out left-to-right (~320px apart on x,
~140px on y), arrows pointing cause → effect / step → next step.
```

---

## Going the other way: canvas → AI prompt

Once you've built or refined a canvas in Pathfinder, the **Copy AI-ready prompt**
pill (bottom-right) exports the whole thing as a structured prompt. Pick the mode
in the Prompt tab first:

- **Explore** — surfaces gaps, assumptions, and missing links; asks questions.
- **Plan** — turns the canvas into a phased implementation plan.
- **Build** — treats requirements/outputs as a task checklist and asks for code.
- **Clarify** — returns a prioritized list of clarifying questions, each tied to a
  block. Best when you want gaps and useful questions before committing.

Workflows (process + terminator blocks) are exported as a `## Workflow
(end-to-end)` section, walked in arrow order.
```
