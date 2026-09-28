<div align="center">

# Pathfinder

Map your project visually. Export a structured prompt that front-loads everything an AI needs to build it right.

[![Live][badge-site]][url-site]
[![HTML5][badge-html]][url-html]
[![CSS3][badge-css]][url-css]
[![JavaScript][badge-js]][url-js]
[![Claude Code][badge-claude]][url-claude]
[![License][badge-license]](LICENSE)

[badge-site]:    https://img.shields.io/badge/live_site-0063e5?style=for-the-badge&logo=googlechrome&logoColor=white
[badge-html]:    https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white
[badge-css]:     https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white
[badge-js]:      https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black
[badge-claude]:  https://img.shields.io/badge/Claude_Code-CC785C?style=for-the-badge&logo=anthropic&logoColor=white
[badge-license]: https://img.shields.io/badge/license-MIT-404040?style=for-the-badge

[url-site]:   https://pathfinder.neorgon.com/
[url-html]:   #
[url-css]:    #
[url-js]:     #
[url-claude]: https://claude.ai/code

</div>

---

Pathfinder is a strategy canvas for planning work before anyone builds it. You place typed blocks (goals, stakeholders, metrics, requirements, implementation work, risks, questions, decisions, and more) on an infinite canvas, connect them with arrows, and watch the tool flag the gaps your plan hasn't addressed yet. When the picture looks right, one click collapses the whole diagram into a structured AI prompt that front-loads all that context, so the assistant can reason about your project rather than assume through it.

It speaks other tools' formats too: JSON Canvas (Obsidian) imports and exports,
and Mermaid flowcharts import, so a plan can arrive from a vault or a README
and the result can live back in it.

The core loop is: **diagram first, then generate a brief**. The canvas makes implicit relationships explicit. The prompt builder turns those relationships into a planning document you can hand to any AI.

---

**New here?** [Take the walkthrough](https://pathfinder.neorgon.com/tutorial.html). One worked example from a vague bug report to a brief a coding assistant can act on.

## Usage

No install or build step required.

```bash
python3 -m http.server 8778
# open http://localhost:8778
```

Or open `index.html` directly in a browser.

---

## Workflow

### Phase 1: Build the map

Add blocks from the palette on the left, or double-click empty canvas to add one where you clicked. Each block type carries a specific meaning (see the table below). Draw connections by dragging from the small port circles that appear on block edges when you hover.

The gap detection layer runs automatically and flags structural problems:

- A **goal** with no requirements linked (how will you get there?)
- A **problem** with no outgoing arrow and no "Resolve" action (what are you doing about it?)
- An **assumption** not anchored to a goal or requirement (unanchored assumptions compound)
- A **risk** with nothing downstream and no "Prepare" action (what mitigates it?)
- A **decision** with nothing leading to it and no rationale (why was this chosen?)
- An **output** nothing produces, and a **requirement** with no acceptance criteria ("done" is undefined)
- A workflow **step** wired into no flow, and any block with zero connections at all
- Canvas-wide: circular dependency orders and named groups with no members

Each flagged block gets plain-language suggestions in the inspector, several with
a one-click fix, and the Prompt tab lists every firing rule with a jump to the
first offender.

The gap icons are not mandatory warnings. They are conversation starters: the canvas asking you to articulate things you might otherwise assume.

### Phase 2: Generate the brief

Switch to the **Prompt** tab in the right panel. The generated prompt assembles all blocks in a structured hierarchy, appends the connection graph, flags any remaining gaps, and applies any dev options you set (tone, detail level, acceptance criteria, security, TypeScript, etc.).

Paste the prompt as the first message to any AI. You get focused output because the assistant doesn't have to guess at your constraints.

---

## Block types

Sixteen types, grouped by the question each one answers. A map reads best
built in this order: **Why → Who → Proof → What → How → Doubt**. Proof comes
before How because the measure is set with the objective, and the work is
chosen after it.

| Step | Type | Colour | Use for |
|---|---|---|---|
| Why | **Goal** | violet `#a78bfa` | What you want to achieve |
| Why | **Problem** | rose `#f87171` | An issue happening now |
| Who | **Stakeholder** | pink `#fda4af` | Who receives, approves or is affected |
| Proof | **Metric** | cyan `#67e8f9` | A measurable signal with a target |
| What | **Requirement** | amber `#fbbf24` | Must be true when done |
| What | **Output** | indigo `#818cf8` | A deliverable someone can hold: report, doc, release |
| How | **Implementation** | lime `#a3e635` | Work done once to build or change something |
| How | **Process** | blue `#60a5fa` | A recurring step in a workflow |
| How | **Trigger / End** | orchid `#f0abfc` | What starts or ends a flow: an event, a cadence, a finish |
| How | **Decision** | emerald `#34d399` | A choice made, or one to make |
| How | **Resource / System** | teal `#2dd4bf` | An existing team, tool, system or data source |
| Doubt | **Assumption** | gold `#eab308` | A belief you are treating as true |
| Doubt | **Risk** | orange `#fb923c` | Something that might go wrong |
| Doubt | **Open Question** | sky `#38bdf8` | A genuine unknown |
| Other | **Context** | slate `#64748b` | Background that frames the work |
| Other | **Other** | fuchsia `#d8b4fe` | Untyped: checks skip it |

Three pairs get confused, so the type picker says it outright: every time a
flow runs is a Process, once to build or change something is an
Implementation; a moment in time is a Trigger / End, a thing someone can hold
is an Output; a number with a target is a Metric (its targets go in
**Targets**).

All of this lives in one registry (`TYPES` in `js/utils.js`): the palette,
pickers, prompt, Markdown, Spec bundle, deck and meeting summary all read it,
and a test fails if any of them leaves a type out. Every type stays usable and
none is ever removed, because dropping a type would drop the blocks that use
it. A canvas from a newer build keeps a type this one does not know as Other,
with the original remembered, and an older label such as "Start / End" still
loads as its type.

**Card style.** The accent colour renders as a full border by default. Pick a
different look for the whole canvas from **View ▾ → Card style**, or override
one block from its inspector: Outline, Accent bar, Header, Tinted, or Plain.

**Action badges** (set in the Inspector) attach intent to any block:

| Badge | Color | Meaning |
|---|---|---|
| `resolve` | red | You are actively working to fix this |
| `prepare` | amber | You need to set something up before proceeding |
| `recollect` | sky | You need to retrieve or recall information |
| `reinforce` | green | You are strengthening or validating this point |
| `validate` | gold | You need to test this before relying on it |

---

## Canvas interactions

| Action | How |
|---|---|
| Add block | Click any item in the palette |
| Move block | Drag the block body |
| Select block | Click once |
| Find a block | **Find blocks** on the canvas, or `Cmd/Ctrl + F`. Search content, then narrow by type or status |
| Add a block where you are | Double-click empty canvas and pick a type |
| Edit title | Double-click the card, or select it and press `Enter` (or `F2`). `Shift + Enter` edits the description |
| Draw arrow | Drag from a port circle on a block edge |
| Label a connection | Double-click it |
| Change where an arrow attaches | Select it, then pick a side under **Connection points**, or drag either endpoint handle |
| Auto-arrange everything | **Tidy** in the header, or `L`. One `Cmd/Ctrl+Z` undoes the whole arrangement |
| Change layout direction | Tidy's menu: arrange left to right, or top to bottom |
| Align a selection | Select two or more blocks, then use Align / Distribute in the inspector |
| Highlight for a presentation | Select blocks, pick a colour in the inspector. Spotlight fades the rest |
| Select every block of one type | Right-click a block, "Select all Problems" |
| Hide the header and footer | `H`. `Z` hides the side panels too |
| Delete selected | `Delete` or `Backspace` key |
| Duplicate block | `Cmd/Ctrl + D`, or "Duplicate Block" in the Inspector |
| Pan canvas | Drag on empty canvas area, or scroll |
| Zoom | `Ctrl/Cmd` + scroll, or pinch. Scroll alone pans |
| Fit all blocks | `Shift + 1`, or **Fit** in the bar under the canvas |
| Deselect | Click empty canvas |

Search includes descriptions, notes, acceptance criteria, decision rationale,
questions, answers, and documentation labels. It shows matching excerpts, ranks
title matches first, and keeps every result available in a scrollable list.
Use the arrow keys and Enter to jump to a block, or Escape to close search.

---

## Inspector panel

Selecting a block opens its properties in the right panel:

- **Type**: a dropdown grouped by the six steps; the colour and badge update immediately
- **Title**: edit inline or in the inspector input
- **Description**: a longer note shown on the canvas block
- **Accent Color** and **Card style**: per-block overrides of the type colour and the canvas-wide card look
- **Actions**: the toggles that fit the type: Resolve on a problem, Prepare on a risk, Validate on an assumption (Recollect and Reinforce sit under Planning)
- **Acceptance criteria**, or **Targets** on a metric: the block's definition of done
- **Open Questions**: a list of specific unknowns attached to this block; each appears in the generated prompt
- **Notes**: freeform annotation (not shown on the canvas block, for your reference only)

Delete and Duplicate buttons are at the bottom of the inspector.

---

## Highlights

For the moment you share a canvas and five of its thirty boxes are the point.

Select some blocks, pick a colour: **Alert** (pulsing red), **Focus** (blue),
**Go** (green), **Hold** (amber), or **Festive** (a moving candy-cane border
that nobody can ignore). Right-click a block and choose **Select all Problems**
to mark a whole type in one action.

**Spotlight** fades everything that is not highlighted, which is where the drama
comes from: the contrast does the work, not the colour. Both travel with the
canvas through share links and the image export.

A highlight says "look here" and nothing more. The block type carries what a
block is, and priority and status carry where it stands, so highlights stay out
of the exported prompt on purpose.

## Situation

Before the goals, the prompt says where the tool is standing. Four choices in the
Prompt tab, and the panel shows you the exact lines they produce:

| Field | Options | Why it matters |
|---|---|---|
| Codebase | None yet, This repo, Elsewhere, Greenfield | With no code, every technical claim in the canvas is unverified and the prompt says so. With the repo open, the reader is told to read it and report where it disagrees with the canvas. |
| Running in | Chat, Claude Code, IDE | Whether the reader can actually reach files, and whether it may claim to have read them. |
| Start by | Reading the code, Asking questions, Proposing a plan, Getting to work | The first move, stated before the plan implies a different one. |
| Boundaries | Free text, one per line | What is out of bounds. |

This is the difference between a plan an assistant guesses at and one it acts on
correctly. It travels with the canvas through save, share, and export.

## Prompt builder

The **Prompt** tab generates a structured brief from the canvas state. It updates in real time as you edit blocks and connections.

**Dev Options** (collapsible):

| Option | Values |
|---|---|
| Tone | Auto, Formal, Casual, Technical |
| Detail level | Brief, Standard, Detailed |
| Pre-prompt flags | Tasks + acceptance criteria, Edge case handling, Error handling, Document key functions, Security implications, TypeScript types |

The generated prompt follows this structure (the section order depends on the
mode; every mode carries every block type):

```
## Situation
## Task
[selected dev options: tone, detail level, pre-prompt flags]
## Block Type Legend            (one line per type used, in step order)
---
# <canvas title>
## Engagement Context
## Context / Background
## Stakeholders (who this is for)
## Project Goals
## Success Metrics (how we will know)
## Problems / Blockers
## Requirements
## Work Items (implementation)
## Assumptions (validate before building)
## Risks
## Open Questions (Review Before Assuming)
## Decisions
## Resources Available
## Expected Outputs
## Workflow (end-to-end)
## Custom / Other
## Connections
• Implementation "Build the scheduler" [implied: produces] → Output "Weekly report"
## Planning Gaps Detected
## Accepted gaps
## When you reply
```

An unlabelled connection between two types that imply a verb prints it as
`[implied: ...]` (an Implementation satisfies a Requirement, a Metric measures
a Goal, an Output is delivered to a Stakeholder), marked so the reader knows
the tool inferred it. Gaps the author accepted are listed apart from the open
ones, so the assistant does not raise them again.

**Build mode** combines requirements, outputs and implementation work into one
dependency-ordered checklist, including connections through other block types. Priority chooses
between tasks whose prerequisites are already listed. Completed tasks remain
checked, blocked tasks remain labeled, and each task carries its notes,
questions and answers, criteria, and documentation reference. The spec bundle's
`tasks.md` uses the same checklist. A work item wired to a requirement lists
it as `satisfies:` with that requirement's acceptance criteria, instead of
asking for criteria of its own. Circular connections are flagged for review.

**Bring the answer back.** Paste an assistant's reply into the Prompt tab to
preview its `pathfinder-patch`. Expand full before/after details and choose each
operation independently. Accepting a connection includes its new endpoint blocks;
excluding a new block excludes its connections. Apply the selection as one undo step.
Duplicate new block IDs and ambiguous references are rejected; repeated arrows
and criteria are deduplicated. If the canvas or active map changes after the
preview, review the refreshed preview before applying. The prompt's change
summary tracks answers, notes, criteria, status, connection text, and framing
since the last copy.

---

## Export and import

| Action | How |
|---|---|
| Copy prompt | Prompt tab → **Copy Prompt**, **Copy prompt** under the canvas, or File → Copy Prompt |
| Download JSON | File → **Download JSON**: full canvas state including block positions |
| Download Markdown | File → **Download Markdown**: one section per type, labelled connections, and a Mermaid graph that keeps every block and its type |
| Download Spec bundle | File → **Download Spec bundle**: spec.md (stakeholders, goals, metrics, requirements), plan.md, tasks.md (work items included), EARS requirements |
| Meeting summary | File → **Export Meeting Summary**: decisions, votes, actions, open questions, then every other type on the canvas |
| Import | File → **Import JSON / Canvas / Mermaid**: choose Replace or Merge |

The JSON export preserves everything: block positions, connections, actions, questions, notes. Use it to save snapshots, share canvases with a team, or resume planning sessions.

View-only links and embeds load separately from your saved maps. They retain
their shared URL on reload, and viewing or panning them does not overwrite your
canvas or its saved camera.

The **Maps** menu keeps separate canvases and remembers each map's view. In
**Find blocks**, choose **All saved maps** to search across the library. Results
show their map name and open the matching block; the current map's unsaved edits
are included. Shared views search only the shared map.

**Attention** lists unanswered questions, unverified assumptions, blocked work,
and missing acceptance criteria. Filter by issue and open a block to resolve it.

Select a connection and set its **Meaning**: comes before, depends on, blocks,
informs, or related. Task checklists and cycle detection use this meaning.
“Depends on” orders the target first; informational links do not impose an order.
Older labeled connections infer their meaning; other older arrows retain their
drawn order. An explicit meaning takes precedence over a custom label.

**Maps → Snapshots → Compare** highlights added and changed blocks and draws
removed blocks as dashed outlines. The Changes list includes full before/after
content, connections, groups, and map settings. Comparison does not edit the map.
Restoring first saves a backup snapshot of the current work.

Zoom, save status, and **Copy prompt** share a compact bar below the canvas.
The copy action uses a standard copy icon and copies immediately. If browser
storage fails, the current
work stays open with **Retry save** and **Download backup** controls. Switching
maps waits for a successful save; the backup downloads the live content. The
backup control appears when saving fails; JSON export remains in File.

Both sidebars use matching panel controls. Sections use plus/minus buttons
with keyboard support. The optional session timer lives at the bottom of the
details panel, and its countdown appears after you start it.

---

## Architecture

![Architecture](docs/architecture.svg)

```
pathfinder-site/
├── index.html              # App shell
├── css/
│   └── style.css           # All styles, variables, animations
├── js/
│   ├── app.js              # Entry point
│   ├── state.js            # State, localStorage, block mutations
│   ├── canvas.js           # Pan/zoom, ports, Bézier arrows
│   ├── render.js           # Block + inspector DOM rendering
│   ├── events.js           # Canvas pointer, keyboard shortcuts
│   ├── gaps.js             # Automatic gap detection
│   ├── prompt.js           # AI prompt builder
│   ├── ui-panels.js        # Export, search, dev options
│   └── utils.js            # Helpers
├── favicon.ico
└── CNAME                   # pathfinder.neorgon.com
```

State autosaves to `localStorage` key `pathfinder-v1` on every change (debounced 300 ms), with a copy in the active map's library slot. Each map's pan and zoom are saved separately and restored on reload or when switching maps. Shared links fit to their own content.

To run the browser test suite, start the local server and open
`/tests/run-tests.html`. The runner restores the browser's existing Pathfinder
storage after the tests finish.

---

<div align="center">
  <sub>Part of <a href="https://neorgon.com">Neorgon</a></sub>
</div>
