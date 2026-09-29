# Building Pathfinder diagrams with AI

Two prompts. **Prompt A** asks an AI to hand you a finished canvas you can import
into Pathfinder. **Prompt B** is the reverse: it primes an AI with how Pathfinder
thinks, so it asks *you* the right questions first.

---

## Prompt A: "Generate a Pathfinder canvas as JSON"

Get it from the app: **File ▾ → Copy AI diagram-builder prompt**. It is generated
from the type registry (`js/diagram-instructions.js`), so it always lists the
block types this build accepts, what each one means, the order worth mapping them
in (Why, Who, Proof, What, How, Doubt), the pairs people confuse, and the arrow
`relation` values. A copy pasted into this file would drift the first time a type
changed, which is why there is none here.

Paste it into any assistant, replace the last line with your topic, and save the
JSON it returns to a `.json` file.

**To use the result:** **File ▾ → Import JSON / Canvas / Mermaid**. It opens as a
new map by default; Replace and Merge are the other choices in the same dialog.
Anything malformed is skipped safely rather than breaking the canvas, and
`validate.mjs` (see `llms.txt`) names what would be dropped before you import.

---

## Prompt B: "Interview me, then draft the canvas"

Use this when you are not sure what the diagram should contain yet.

```
Act as a planning facilitator using the Pathfinder canvas model. A map answers
six questions in order, each with its block types:
  1. Why: what outcome, or what hurts (goal, problem)
  2. Who: who wants it, receives it, or signs it off (stakeholder)
  3. Proof: how we will know it worked (metric, with targets)
  4. What: what must be true or delivered (requirement, output)
  5. How: the work, steps and systems (implementation, process, terminator,
     decision, resource)
  6. Doubt: imagine it failed, why? (assumption, risk, question)
"context" frames any step; "custom" is for what fits nowhere.

First ask me 3 to 6 sharp questions to surface: the outcome, who it is for, how
we will measure it, the hard requirements, the riskiest assumptions, and, if this
is a workflow, what starts it, the ordered steps, and how it ends. Ask about gaps
and unknowns, not only what I already know.

After I answer, output the canvas as a JSON object with this shape:
{ "blocks":[{ "id","type","title","description","x","y","criteria" }],
  "arrows":[{ "from","to","relation","label","note" }],
  "meta":{ "title","contextBrief" } }
using only the types above, laid out left to right (about 320px apart on x and
140px on y), arrows pointing cause to effect or step to next step.
```

For the full format (every field, every enum), read `llms.txt`.

---

## Going the other way: canvas to AI prompt

Once you have built or refined a canvas in Pathfinder, **Copy prompt** in the bar
under the canvas exports the whole thing as a structured prompt (File ▾ → Copy
Prompt does the same). Pick the mode in the Prompt tab first:

- **Investigate**: establish what is true, with evidence for every finding.
- **Explore**: surfaces gaps, assumptions and missing links; asks questions.
- **Plan**: turns the canvas into a phased implementation plan.
- **Build**: treats requirements and implementation work as a task checklist.
- **Clarify**: returns a prioritized list of clarifying questions, each tied to a
  block.

Workflows (process and Trigger / End blocks) are exported as a `## Workflow
(end-to-end)` section, walked in arrow order. Every prompt ends by asking for a
`pathfinder-patch`; paste the whole reply into the Prompt tab's **Paste a reply
or a review** to bring the answers back as one undo step.
