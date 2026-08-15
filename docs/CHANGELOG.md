# Changelog

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
