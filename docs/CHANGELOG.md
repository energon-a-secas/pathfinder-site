# Changelog

## 2026-08-24 (tenth pass)

### The examples gallery

examples.html: four finished maps, each loadable with one click through the
same share-hash route a link takes. Three of the four ARE the large built-in
templates (Investigate a Bug, Inherit a Codebase, Migrate a System),
converted on the fly by templateToPayload(), so the gallery can never drift
from what the app ships; the fourth is the walkthrough's checkout
investigation. Each entry says who it is for and arrives framed: situation
set, mode set, brief readable on the first export. Cross-linked from the
walkthrough, llms.txt and the sitemap.

## 2026-08-24 (ninth pass)

### Your canvas, as a template

Teams reuse their own structures more than anyone else's. The Templates
section gains **Save canvas as template**: the live canvas is captured in
the same shape the built-ins use (positions normalised, arrows re-indexed,
acceptance criteria, questions, the situation and the prompt mode all riding
along), listed after the built-ins with a delete control, capped at twelve.
Applying one works exactly like applying a built-in, framing included.

The roadmap also wanted template JSON export/import; a template already
travels as a canvas (export the canvas, import it elsewhere, save it as a
template there), so no second file format was added.

## 2026-08-24 (eighth pass)

### Snapshots, and a camera per map

Undo covers the session; snapshots cover next week. Maps ▾ gains "Snapshot
this map" (full copies, eight per map, oldest dropped) and a Snapshots list
showing, for each one, when it was taken and what has changed since: added,
removed and edited blocks, and the arrow delta. Restoring first snapshots
the state being replaced, so a restore is never a loss. Applying a patch
takes an automatic "Before the patch" snapshot.

Each map now remembers its own camera (`pathfinder-view:<mapId>`): switching
maps returns you to where you were looking, not to a re-fit.

### Housekeeping

- The test suite preserves and restores every `pathfinder-*` localStorage
  key, so running it no longer overwrites the canvas you were working on.
- The site-local `#s=` arrival counter is retired: the header kit's pattern
  now covers `#s=` fleet-wide, and counting it twice would be worse than
  not counting it at all.

## 2026-08-24 (seventh pass)

### Interop: JSON Canvas both ways, Mermaid in

Tools get adopted when they read what people already have. The Import picker
now takes three formats and tells them apart itself: pathfinder JSON as
before, **JSON Canvas** (`.canvas`, the Obsidian format), and **Mermaid
flowcharts** (fenced or bare). Canvas text nodes and Mermaid rectangles go
through the same classifier Brain Dump uses, and its uncertain calls surface
as the existing correction chips; Mermaid shapes that carry meaning keep it
(rhombus becomes a decision, stadium and circle become start/end), subgraphs
become groups, and positions come from the app's own layered layout rather
than a guess.

The way out too: **Export ▾ → Download JSON Canvas** writes the map as a
`.canvas` file that opens in Obsidian and friends, with block types carried
as preset colors, criteria as checklists, rationale inline, groups as group
nodes, and pinned connection sides preserved. The plan can live in the
user's own vault, which is a retention mechanism nobody has to run.

## 2026-08-24 (sixth pass)

### Plan lint: gap detection grows up

Four rules covered 4 of 13 types; the hub card promised more than that. Five
new rules, same mutually-exclusive discipline (one gap per block, isolation
still wins): an unmitigated **risk** (nothing downstream, no prepare), a
**decision without basis** (nothing leads to it and no rationale), an
**output nothing produces**, a **requirement with no acceptance criteria**
("done" is undefined), and a workflow **step wired into no flow**. Two
canvas-level findings join them: circular dependency orders and named groups
with no members.

Every rule carries inspector suggestions, several with a one-click fix (Mark
Prepare, Create Decision, focus the criteria or rationale field). The Prompt
tab gains a per-rule breakdown under the health score; clicking a row jumps
to the first offender. One label source (`GAP_META`) feeds the breakdown and
the prompt's gap section, so they cannot drift.

Health scores get stricter on old canvases, deliberately: the new rules are
real gaps that were always there, unreported.

## 2026-08-24 (fifth pass)

### The round trip

An investigation that ends in a chat log gets run again in three weeks, so
the canvas now asks for its answers back. Every exported prompt ends with a
`## When you reply` section and a map of block ids, asking the assistant to
close with a fenced `pathfinder-patch` JSON block (spec in llms.txt): answers
keyed to questions, each assumption marked verified or refuted **with
evidence**, status changes, new acceptance criteria, and new blocks wired to
existing ids.

The Prompt tab's **Bring the answer back** takes the whole pasted reply,
finds the patch, and previews every operation before anything happens: id
matches are trusted, exact titles too, a unique fuzzy match is applied but
labeled, and anything ambiguous is refused rather than guessed. Apply is one
undo step. A verified assumption becomes a decision **in place**, keeping its
id so every arrow survives; the evidence lands in the decision's rationale,
which is exactly what the walkthrough's step 10 asked people to do by hand.

## 2026-08-24 (fourth pass)

### The agent channel

Three small pieces that make the canvas contract usable by something other
than a human with a clipboard:

- **`validate.mjs`**: prove an emitted canvas loads before handing it over.
  A thin Node CLI over the app's own `js/normalize.js` (fetched from the live
  site when run standalone), so what it accepts is exactly what the canvas
  accepts. Names every dropped or coerced item; exit 0 / 1 / 2.
- **`?src=<https url>`** loads canvas JSON from a link, for canvases too big
  for a `#s=` hash: https or same-origin only, 1 MB cap, GitHub raw and gist
  whitelisted in the CSP, and the same replace-or-merge confirmation a share
  link gets.
- **`#s=` arrivals are finally counted.** The fleet beacon counts `?via=`,
  `?src=` and `#d=`/`#t=` payloads but its pattern misses this app's `#s=`;
  a site-local counter fires the same anonymous `share/<host>/hash-payload`
  event for exactly that gap, with the same privacy guards and no double
  counting. No canvas content is ever sent.

llms.txt documents all three, plus the `?via=` convention for links other
tools emit toward Pathfinder. The `pathfinder` skill (in neorgon-forge)
closes the loop: read a canvas, do the work, hand back a validated one.

## 2026-08-24 (third pass)

### Criteria, rationale, and the Spec bundle

Requirements, goals and outputs gain **acceptance criteria** (one per line in
the inspector), and decisions gain a **rationale**. Both feed the prompt (the
Build checklist's `[NEEDS INPUT]` placeholder now only appears when criteria
are genuinely missing), the Markdown export, and a new export:

**Export ▾ → Download Spec bundle (zip)**: five Markdown files in the shape
spec-driven development tools expect. `spec.md` (goals, requirements with
criteria, `[NEEDS CLARIFICATION]` questions, assumptions, risks), `plan.md`
(situation, decisions with rationale, resources, the Mermaid graph),
`tasks.md` (dependency-ordered checklist, sequenced by the same layering Tidy
uses), `requirements.md` (EARS form, "THE SYSTEM SHALL", for Kiro-style
tooling), and a README saying what the bundle is. The zip is written by a
zero-dependency STORE writer (`js/zip.js`); missing inputs are marked, never
invented.

## 2026-08-24 (second pass)

### The mode travels with the canvas

Prompt mode, tone, detail and the include-in-prompt extras are now part of the
canvas (`meta.prompt`), so a reload, a share link, an import or a Maps switch
keeps how the plan was meant to be read, not just what it says. One shared
serializer feeds autosave, share links, the Maps library and the JSON file, so
the copies cannot drift. The walkthrough example finally loads in Investigate,
which is what the walkthrough teaches; old canvases without the field read as
Plan with nothing extra, which is what they always were.

Three preset chips in the Prompt tab (Claude Code, Cursor + TS, PM clarify)
set the whole bundle in one click.

The Workflow section now orders steps by the whole graph rather than only by
arrows between flow nodes, so a step linked through a Problem in the middle
stops printing after the ending. Only process steps carry numbers; start and
end markers stay unnumbered.

## 2026-08-24

### Tidy stops vandalising arrows

Auto-layout used to stamp fixed ports onto every arrow: forward edges got
right→left, and anything backward or inside a layer got bottom→bottom, whose
curved and elbow paths loop under the row or cut through blocks. The pins were
permanent, so one Tidy meant arrows never self-routed again and stayed glued to
stale sides after every later drag. Reported 2026-08-24 ("arrows get other
format after autolayout and are not aligned correctly").

- Pins written by Tidy now carry provenance (`portsBy: 'tidy'`), and a side the
  user pinned by hand is never overwritten.
- Same-layer edges get perpendicular ports picked from where the target
  actually sits. Backward edges keep the under-the-row detour only when the
  style is `routed` (the router steers around blocks); curved and straight
  back edges return to auto instead of drawing a giant U.
- Dragging a block releases the tidy pins on its arrows, so they self-route
  again for the new position. Hand pins stay.
- Canvases tidied before provenance existed are healed on their next Tidy:
  pins matching the old scheme are adopted and re-evaluated.
- Port lane offsets are rounded to whole pixels, removing half-pixel jogs in
  routed paths.

### The pill learns to get out of the way

The floating "Copy AI-ready prompt" pill and its readiness verdict can be
hidden: an × appears on hover and collapses both to a small chip, persisted
(`pathfinder-pill`). Zen (`Z`) now hides the whole cluster, so presenting shows
the diagram and nothing else.

### Collapsed palette, coherent

The 48px palette rail used to leave the "Advanced types" label at full width,
overflowing the rail. It now collapses to its chevron like every other section.

### Maps: several canvases per browser

Storage was one slot: starting a second plan destroyed the first. A Maps menu
in the header now lists every canvas in this browser with switch, new,
duplicate, delete, export-all and import-all. The active map still lives in
`pathfinder-v1`, so share links, undo, autosave and existing canvases work
unchanged; every autosave writes through to the active map's own slot.
Switching maps clears the undo stack, deliberately: undo must not cross
canvases.

### Tests

New coverage for tidy port provenance, pin release on drag, and `portsBy`
normalization.

## 2026-08-14 (third pass)

### Highlights, for when a canvas is being presented

A shared canvas has thirty boxes and five of them are the point. Select blocks
and mark them: **Alert** (pulsing red), **Focus** (blue), **Go** (green),
**Hold** (amber), or **Festive**, an animated candy-cane border.

- **Spotlight** fades every block without a highlight. The emphasis is the
  contrast, which is why this is a mode rather than a louder colour. It is
  ignored when nothing is marked, so switching it on with an empty selection
  cannot fade the diagram to nothing.
- Right-click gives **Select all \<Type\>**, so "highlight the five problems"
  is two clicks rather than five shift-clicks across a canvas you have to hunt
  through. The multi-select header reports the tally while you are there:
  `5 problems, 3 requirements, 1 goal`.
- Both survive share links and imports, and both reach the SVG and PNG export.
  The animated border exports as a static candy-cane dash, because a raster
  cannot animate.
- `prefers-reduced-motion` drops the animation and keeps the ring. The ring
  carries the whole message; the movement is decoration.

Highlights are deliberately **not** in the exported prompt. `type` says what a
block is, `priority` and `status` say where it stands, and a highlight only says
somebody wanted it looked at. Overloading colour with a second meaning is how a
diagram stops being readable.

### Housekeeping

- **`make dev`** is the dev server with caching off. `make serve` sends
  `Last-Modified` and nothing else, so a browser holds an ES module for the rest
  of the session and you end up debugging a file you already fixed.
- Fixed the Makefile's `PORT`, which carried its own trailing comment into the
  value. Harmless where a shell swallowed it, fatal anywhere else.
- Removed `frame-ancestors` from the CSP meta tag. It is ignored when delivered
  that way, so it enforced nothing and logged an error on every page load, and
  it contradicted the shipped `?embed` mode.

### Tests

**334/334.**

## 2026-08-14 (second pass)

### Say where the tool is standing, before the plan

A canvas handed to an assistant is a plan, and a plan read without its situation
gets acted on wrongly. The prompt now opens with a **Situation** section: what
code exists, whether the reader can reach it, what to do first, and what is out
of bounds. Four controls in the Prompt tab, with a live preview of the exact
lines they produce, because being able to read what you are about to hand over
is the entire point.

- `canvasMeta.situation` travels through save, share and export. Each option
  owns the sentence it contributes, so the control and the copy cannot drift.
- **The assumptions directive adapts.** With the repository reachable it tells
  the reader to settle assumptions by reading the code and label each one
  verified or still open, rather than asking about something it could have read.
  Without it, it says plainly that none of them can be treated as established.
- New **Investigate** mode: establish what is true, state the evidence for each
  finding, leave unknowns marked as unknown, and report where the canvas and
  reality disagree instead of quietly reconciling them.

### Templates worth applying

- Three large templates: **Investigate a Bug** (13), **Inherit a Codebase** (13),
  **Migrate a System** (15). Each carries a situation and a mode, and runs Tidy
  on apply, so one click produces an arranged diagram already framed for the
  work. Block counts are shown in the palette so nobody drops fifteen blocks
  onto a working canvas by accident.
- A template's framing only lands on a canvas that was empty. Merging onto an
  existing canvas leaves the situation alone: it was somebody's deliberate choice.
- Every template block now carries a real description, and template arrows are
  routed rather than curved.

### Palette

- The collapse control moved out of the foot of the list into a sticky header at
  the top, matching every other panel control.
- **Templates folds itself away** once the canvas has something on it. It is the
  on-ramp, not the workspace, and the block list is what you reach for next. If
  you open it by hand it stays open.
- Palette width and section state now persist.

### Walkthrough and format spec

- **`tutorial.html`**: one worked example end to end, from "checkout is broken
  for some people" to a brief a coding assistant can act on. It includes a
  button that loads the finished canvas.
- **`llms.txt` is now hand-authored** rather than generated. It documents the
  canvas JSON, every enum, and both directions of the exchange: how to read an
  exported prompt, and how to write a canvas back after doing the work.

### Fixes

- **Import dropped canvas-level settings.** `applyImport` only ever copied the
  title and context brief, so a shared canvas lost its card style and its
  situation. It now carries the whole meta, and does it before blocks render,
  since each card resolves its preset against the canvas default.
- The tutorial's worked example moved into its own module so the test suite
  reads the same object the page does. It is checked for overlapping blocks,
  dangling arrow endpoints, and a valid situation, because a broken example on
  the page that teaches the tool is worse than no example.

### Tests

**308/308.** New coverage for the situation (every option contributes a real
sentence, free text is capped, unknown values fall back rather than vanishing),
the template registry (arrow indices in range, every block described, large
templates carry framing), and situation round-tripping through `normalize.js`.

## 2026-08-14

### Connections that do not fight the reader

The reason a canvas needed hand-arranging was not the side-picking, it was that
`portPos` returned the exact midpoint of a side. Every arrow touching a side
landed on the same pixel, so six arrows into one block fused into what looked
like one thick line.

- **Lanes.** `resolveRoutes()` in `canvas.js` is now the single source of arrow
  geometry for both the canvas and the SVG/PNG export, so an exported diagram
  cannot drift from the one on screen. It buckets every endpoint by the side it
  lands on, orders each bucket by where its far end sits (which is what keeps
  lanes from crossing on the way out), and gives each arrow its own slot.
- **Routed arrows, now the default for new connections.** An orthogonal path
  that steers around other blocks: A* over a lattice built from block edges,
  with a turn penalty so it buys straightness rather than the shortest route
  (`route.js`). It declines above a node budget and falls back to an elbow, and
  it is skipped entirely while a pointer is down so dragging stays smooth.
  Existing arrows keep whatever style they were saved with.
- **Connection points are pickable.** The arrow inspector has From/To side
  pickers, and a selected arrow shows draggable endpoint handles that re-pin or
  re-target it. Previously the model carried `fromPort`/`toPort` but the only
  control was a reset button.
- **Elbow reads both ends.** It used to look only at the start direction, so an
  arrow leaving horizontally and arriving from above approached the wrong side.
- **Labels spread along their lane** instead of stacking on a shared midpoint.

### Tidy, and alignment

- **Tidy** (header button, or `L`) re-lays the canvas with a layered layout:
  break cycles, assign layers, minimise crossings, place coordinates, then point
  every connection along the flow (`layout.js`). Left-to-right by default,
  top-to-bottom via the toggle beside it. It takes **exactly one undo
  snapshot**, so one Cmd+Z puts every block back.
- **Snap guides while dragging**, plus **align and distribute** for a
  multi-selection (`align.js`). Grid snapping still wins when it is on.

### Card styling

The block's identity came from a 3px left border with the other three sides at
28% alpha. That asymmetry was the whole look, and it was duplicated across six
CSS rules plus the SVG exporter, so it could not be changed in one place.

- Five presets: **Outline** (the new default, a full accent border), **Accent
  bar** (the old look, kept so existing canvases can stay on it), **Header**,
  **Tinted**, **Plain**. Canvas-wide from **Cards** in the header, per block
  from the inspector, plus a border-width override.
- The canvas default lives on `canvasMeta`, so it travels through share links
  and JSON export.
- The SVG exporter mirrors each preset. It previously drew every card with a
  neutral border and an accent bar, which matched nothing on screen.

### Expanded view

- **`H` hides the header and footer. `Z` hides the side panels too.** Both
  persist, and both stay live in `?readonly` and `?embed` views. `Alt+H` is
  still high contrast. Follows the design in the monorepo's `SHORTCUTS.md`,
  kept local rather than re-vendoring the shared header kit.

### Fixes

- **Markdown export silently dropped blocks.** `assumption`, `context` and
  `custom` were missing from the exporter's type list, so those blocks did not
  reach `pathfinder.md` at all. Assumption is a core palette type with its own
  gap rule and its own prompt section.
- **Markdown export threw away arrow labels and notes**, so the connection list
  said what linked to what and never why. It now carries both, and appends a
  Mermaid graph of the same topology.
- **A recoloured arrow kept a white arrowhead.** The markers baked their fill
  in; they are now minted per colour on demand, on the canvas and in the export.
- **`?` fired while typing.** A question mark in a description opened the
  shortcut overlay, because that binding sat above the typing guard.
- **Snapping was asymmetric.** `Math.round` breaks exact halves toward
  +Infinity, so a block at y = -14 snapped to 0 while the same block at +14
  snapped to 28. `snapTo` now rounds half away from zero.
- **Pan and zoom survive a reload**, stored separately from the canvas so a
  share link does not carry the sender's camera.

### Tests

Suite is green at **284/284**, up from 212/218. Four of the six failures were
stale tests written against the pre-Batch-9 question model and the old snapping
behaviour; the other two were the documented `snap()` pair. New coverage for the
router (never crosses a block, declines past its budget), the layout (layers
respect direction, nothing overlaps, cycles terminate), alignment, port lanes,
and the card-style round-trip through `normalize.js`.

## 2026-07-02

### Navigation (trackpad-first)
- Two-finger scroll now **pans** the canvas (previously any wheel event zoomed) — you can move around without holding a drag
- **Pinch / Cmd+Ctrl+scroll zooms** toward the cursor
- Dragging empty canvas still pans; shortcuts overlay documents all three

### Fixes
- Fixed the right-click **Change type / Accent color** submenus rendering expanded/flat by default — they were built as `<button>`-inside-`<button>` (invalid HTML), so the parser hoisted the options out as flat menu items. Rebuilt those parents as focusable `<div role="menuitem">`; submenus now collapse and open on hover/focus as intended (menu height 589px → 196px)
- **Grid** button now has a visible effect: it immediately snaps all existing blocks to the 28px grid (with a toast) and the preference persists, instead of only affecting future drags
- **Grid** and **Arrow text** toggles now persist across reloads

### New
- Export ▾ → **Copy AI diagram-builder prompt** copies a ready-to-paste prompt for generating a Pathfinder canvas with Claude (or any AI); paste it, add your topic, and Import the JSON it returns. Shared source in `js/diagram-instructions.js`

## 2026-07-01

### Editing & block interactions
- Block descriptions now respect newlines (rendered with `<br>` + `white-space: pre-wrap`) on the card and in exports
- Descriptions are directly editable on the card — double-click to edit inline; empty ones show an "Add description…" hint on hover/selection (Enter adds a line, Esc / Cmd+Enter commit)
- Right-click any block for a quick-actions menu: Duplicate, Change type, Accent color, Collapse/Expand, Delete (also `Shift+F10` / ContextMenu key)
- Right-click blank canvas to add a block where you click (Goal, Problem, Requirement, Decision, Process, Start/End)

### Workflow / flow node types
- Added two block types: **Process** (workflow step/action, blue) and **Start / End** (terminator, pink, pill-shaped)
- Brain Dump / paste classifier recognizes workflow lines (imperative verbs, start/end keywords)
- Prompt export gains a `## Workflow (end-to-end)` section that walks process + terminator nodes in arrow order
- Brightened the **Custom** block accent so it's clearly visible

### Connections
- Arrows now carry an optional **note** (richer than the short label), hidden until you hover/select the connection; header **Arrow text** toggle shows all notes at once (persisted)
- Notes flow into the exported prompt's Connections section

### Brain Dump
- Indented or bulleted lines now fold into the description of the item above them (toggle in the card); flat lists still become sibling blocks

### Prompt pane
- Each mode (Explore / Plan / Build / Clarify) now shows a one-line description of what it does

### Export
- New **Download Image (PNG 2×)** and **Download Vector (SVG)** options render the whole diagram as a crisp, self-contained image (native SVG, not a DOM screenshot)

### Layout & theme
- **Dark theme is now the default** (no longer follows the OS light preference; light mode only when explicitly chosen)
- Reworked the light scheme: proper card elevation, clearer colored borders, softer slate-tinted canvas
- Right panel (Inspector + Prompt) collapses via a chevron to reclaim space (persisted)
- Removed the bulky bottom footer; **Back to Neorgon** and **Star on GitHub** now live as icons in the header (a new GitHub icon with a spring hover), freeing the full canvas height. Links kept crawlable via an sr-only nav

### Docs
- Added `docs/ai-diagram-instructions.md` — copy-paste prompts for generating Pathfinder canvases with AI (JSON output + interview mode)

### Tests
- New `tests/events.test.js` and `tests/image-export.test.js`; extended normalize + utils suites for the new types, arrow notes, and flow nodes (216/218 passing; the 2 failures are pre-existing `snap()` tests)

## 2026-03-05

### Arrow Animation
- Smoother continuous flow: duration increased from 0.6s to 1.8s
- Seamless loop: dash offset now matches dash pattern total (20px), eliminating visible jump per cycle
- Smooth transition in/out: `stroke-dasharray` uses compatible 2-value format (`20 0` solid to `8 12` dashed) so CSS can interpolate
- Added stroke-width transition (0.3s) for smoother thickness change on hover

### Light Mode
- Polished white theme across all UI surfaces
- Canvas background adjusted to `#f0f1f5` for better contrast
- Palette and inspector panels use solid white backgrounds with border separators
- Header gradient stays rich dark purple (no washed-out fade to white)
- Blocks render pure white with subtle box-shadows for depth
- Selected block outline uses the block's own type color
- Inputs, textareas, buttons, modals, toast, scrollbars all properly themed
- Block type colors darkened for readability on light backgrounds
- Dot grid opacity increased for visibility
- Tinted block variant tuned for light backgrounds

### Palette Restructure
- Templates section moved to top of palette, Blocks section below
- Both sections are independently collapsible with animated chevron toggles
- New palette collapse button (bottom) shrinks the sidebar to 48px, showing only colored dots
- Collapsed state hides labels and descriptions; dots enlarge slightly for easier clicking
- Chevron flips to indicate expand/collapse direction

### Template Icons
- Replaced emoji icons with monochrome SVG icons (target, magnifying glass, globe, graduation cap)
- Icons follow theme color and brighten on hover
- Cleaner, more professional appearance in both light and dark modes
