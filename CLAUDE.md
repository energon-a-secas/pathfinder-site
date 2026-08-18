# CLAUDE.md: Pathfinder

Visual strategy canvas for planning, gap detection, and AI prompt export.

**Live:** pathfinder.neorgon.com
**Run:** `make dev` (caching off, use this while editing) or `make serve` from `pathfinder-site/`.

> `make serve` is python's `http.server`, which sends `Last-Modified` and nothing else. A
> browser will hold an ES module for the rest of the session, so you end up debugging a file
> you already fixed. `make dev` is the same server with `Cache-Control: no-store`.

---

## Architecture

Multi-file layout. No build step, no dependencies. Uses native ES modules (`<script type="module">`).

| File | Lines | Role |
|------|-------|------|
| `index.html` | ~703 | HTML shell + OG meta |
| `css/style.css` | ~2544 | All CSS, variables, animations |
| `js/app.js` | ~115 | Entry point: imports all modules, calls `init()` |
| `js/state.js` | ~136 | State shape, `loadState()`/`saveState()`, camera persistence, `snapTo()` |
| `js/utils.js` | ~378 | `TYPES`, `CARD_STYLES`, `genId()`, `escHtml()`, `clamp()`, `debounce()` |
| `js/canvas.js` | ~538 | Pan/zoom, `resolveRoutes()` (lanes + routing), `pathFor()`, `renderArrows()` |
| `js/gaps.js` | ~74 | `runGapDetection()`: appends gap CSS classes |
| `js/prompt.js` | ~447 | `generatePrompt()`, `refreshPrompt()` |
| `js/render.js` | ~580 | `renderBlock()`, `renderAllBlocks()`, `renderInspector()` |
| `js/events.js` | ~1228 | Canvas pointer, keyboard shortcuts, palette, inspector events |
| `js/ui-panels.js` | ~972 | Export, share, search, panel tabs, dev options, header buttons, Tidy, card-style default |
| `js/context-menu.js` | ~203 | Right-click block quick menu (duplicate/type/color/collapse/delete) |
| `js/image-export.js` | ~241 | High-quality diagram export: native SVG + 2× PNG, mirrors the canvas exactly |
| `js/doc-panel.js` | ~217 | Living documentation: docRef resolution, doc-preview popup, `See:` detection, grounded question prompts |
| `js/route.js` | ~261 | Orthogonal router: A* over a lattice of block edges. Pure, no DOM |
| `js/layout.js` | ~349 | Layered auto-layout (`tidyCanvas`). Pure `layoutGraph` + app wrapper |
| `js/align.js` | ~138 | Drag guides, align, distribute |
| `js/chrome.js` | ~73 | `H` / `Z` expanded view |
| `tutorial.html` + `js/tutorial-example.js` | none | Worked walkthrough; the example loads via the share hash |

**JS modules:** `app.js` · `state.js` · `utils.js` · `canvas.js` · `route.js` · `layout.js` · `align.js` · `chrome.js` · `render.js` · `events.js` · `gaps.js` · `prompt.js` · `ui-panels.js` · `export.js` · `templates.js` · `context-menu.js` · `image-export.js` · `normalize.js` · `doc-panel.js`

**Key interactions added 2026-08-14 (presentation highlights):**
- **`block.highlight`** (`alert` / `focus` / `go` / `hold` / `festive`) draws a ring *outside* the card, so it never disturbs the card border or the layout. `festive` is an animated candy-cane border built with the two-layer mask recipe, since a plain border cannot carry a repeating gradient and `border-image` cannot be animated. Registry: `HIGHLIGHTS` in `utils.js`.
- **`canvasMeta.spotlight`** fades every block *without* a highlight. The emphasis is the contrast, which is why this exists as a mode rather than as a stronger colour. It is ignored when nothing is highlighted, on canvas and in the exporter, so turning it on with an empty selection cannot fade the whole diagram to nothing.
- **Highlights are presentation, not semantics.** They are deliberately absent from the exported prompt: `type` says what a block is, `priority`/`status` say where it stands, and a highlight only says somebody wanted it looked at. Overloading colour with a second meaning is how a diagram stops being readable.
- Applied from the multi-select inspector (the main path), the block inspector's Appearance section, or the right-click menu. Right-click also offers **Select all \<Type\>**, which is what makes "highlight the five problems" one action instead of five shift-clicks.
- The multi-select header reports a tally (`5 problems, 3 requirements, 1 goal`) when the selection spans types.
- Both survive share/import and are mirrored in the SVG/PNG export; the animated border exports as a static candy-cane dash, because a raster cannot animate. `prefers-reduced-motion` drops the animation and keeps the ring.

**Key interactions added 2026-08-14 (handover framing, templates, palette):**
- **`canvasMeta.situation`** is the engagement setup: `codebase` (none / current / other / greenfield), `runtime` (chat / code / ide), `firstMove` (read / ask / plan / act), plus `repoHint` and `constraints`. `situationSection()` in `prompt.js` emits it as the **first** section of every prompt, ahead of the task, because a plan read without its situation gets acted on wrongly. Each option owns the sentence it contributes (`SITUATION_FIELDS` in `utils.js`), so the control and the copy cannot drift.
- The **assumptions directive adapts**: with the repository reachable it tells the reader to settle assumptions from the code rather than ask; otherwise it says none of them can be treated as established.
- New **`investigate` prompt mode**: establish what is true, evidence per finding, unknowns stay marked, canvas-versus-reality disagreements get reported rather than reconciled.
- Three **large templates** (`Investigate a Bug`, `Inherit a Codebase`, `Migrate a System`, 13-15 blocks) carry a `situation` + `mode` and auto-run Tidy on apply. A template's framing lands **only on a canvas that was empty**, on a merge the existing situation is somebody's deliberate choice.
- **Palette**: the collapse control moved into a sticky `.palette-head` at the top. Templates folds itself away once the canvas has content (`collapseTemplatesAfterUse` in `ui-panels.js`) unless the user pinned it open. Palette and section state persist.
- **`applyImport` now carries the whole meta** on replace (title, contextBrief, cardStyle, situation) and does it *before* blocks render, since `renderBlock` resolves each card against `canvasMeta.cardStyle`. A merge leaves the framing alone.
- **`tutorial.html`** is a worked walkthrough; `js/tutorial-example.js` is a plain script (not a module) that loads the finished example through the share hash.
- **`llms.txt` is hand-authored**: the generator marker was removed deliberately. It is the format spec: canvas JSON, every enum, and how to consume an export from a terminal session or a skill.

**Key interactions added 2026-08-14 (connections, layout, card styling):**
- **Connections do not stack.** `resolveRoutes()` in `canvas.js` is the single source of arrow geometry for both the canvas and the SVG/PNG export. It buckets every endpoint by the side it lands on and gives each one its own lane, so six arrows into one block arrive on six points instead of fusing into one line.
- **`routed` is the default arrow style** for new connections: an orthogonal path that steers around other blocks (`route.js`, A* over a lattice built from block edges, turn-penalised so it prefers few bends). The router declines above a node budget and falls back to `elbow`. Routing is skipped while a pointer is down and run once on release.
- **Connection points are pickable.** The arrow inspector has From/To side pickers writing `fromPort`/`toPort`, and a selected arrow shows draggable endpoint handles that re-pin or re-target it.
- **Tidy** (`layout.js`, header button + `L`) re-lays the canvas with a layered/Sugiyama layout and points every connection along the flow. It takes exactly one `snapshot()`, so one Cmd+Z restores the whole arrangement.
- **Alignment aids** (`align.js`): snap guides while dragging (suppressed when grid snapping is on), plus align/distribute for a multi-selection.
- **Card presets** replace the fixed left stripe: `outline` (default), `bar` (the old look), `header`, `tint`, `plain`. Per block via the inspector, canvas-wide via the header **Cards ▾** menu (`canvasMeta.cardStyle`, so it travels through share links and JSON export).
- **`H` hides the header and footer, `Z` hides the panels too** (`chrome.js`, persisted). Both stay live in read-only and embed views. `Alt+H` is still high contrast.

**Key interactions added 2026-07-01:**
- Multi-line descriptions render with `escHtmlMultiline` + `white-space: pre-wrap` (newlines preserved on the card and in exports).
- Right-click any block for a quick-action menu (`context-menu.js`); also `Shift+F10`/ContextMenu key on the selected block.
- Arrows carry an optional `note` (richer than `label`), hidden until hover/selection, or always shown via the header **Arrow text** toggle (`ui.showArrowText`, persisted `pathfinder-arrowtext`, body class `show-arrow-text`).
- Right panel collapses via a chevron (persisted `pathfinder-panel-collapsed`).
- Export ▾ → **Download Image (PNG 2×)** / **Download Vector (SVG)** redraws the canvas as a self-contained SVG (`image-export.js`). No DOM screenshot.
- Brain Dump folds indented/bulleted lines into the parent block's description (toggle in the card); `parseOutline()` in `events.js`.
- Prompt pane shows a one-line description of the selected mode (`refreshModeDesc` in `ui-panels.js`).
- **Dark theme is the default** (no OS-preference opt-in); light mode only when explicitly saved.

**Embedding:** `?embed&readonly` is a supported mode (`buildEmbedUrl()`), so the CSP meta
deliberately carries **no** `frame-ancestors`. It was there and did nothing: the directive is
ignored when delivered via `<meta>`, and the browser logged an error on every page load. If
this ever moves to a host that can set real headers, note that `frame-ancestors 'none'` would
break embedding.

**Required assets:** `index.html` · `css/style.css` · `js/*.js` · `favicon.ico` · `energon-classic-logo.png` · `og-preview.jpg` · `CNAME`

**📖 Read `docs/references/internals.md` before changing code in** `doc-panel.js` (Living Documentation, docRef, fetch gating/CSP, "See:" promotion, live questions), `canvas.js` (pan/zoom, ports, Bézier routing), or `prompt.js` (per-mode prompt generation, Brain Dump classifier, dev options). It also holds the full **Key Functions Reference** (per-module function lookup).

---

## State

**localStorage key:** `'pathfinder-v1'`

```js
state = {
  blocks: {
    [id]: {
      id, type, title, description, notes,
      x, y,                          // pixel position in canvas world
      actions: [],                   // 'resolve' | 'prepare' | 'recollect' | 'reinforce' | 'validate'
      questions: [],                 // [{ text, answer?, askedAt? }] — see Living Documentation
      docRef: null,                  // { href, label, anchor } | null — see Living Documentation
      cardStyle: null,               // preset key | null = follow canvasMeta.cardStyle
      borderWidth: null,             // 1 | 1.5 | 2 | 3 | null = preset default
      highlight: null                // presentation emphasis | null. Never semantics
    }
  },
  arrows: [{
    id, from: blockId, to: blockId,
    style,                           // 'routed' (default) | 'curved' | 'straight' | 'elbow' | 'dashed' | 'dotted'
    fromPort, toPort                 // 'left'|'right'|'top'|'bottom' | null = auto
  }]
}

canvasMeta = {
  title, contextBrief, cardStyle,
  spotlight,                         // fade everything unhighlighted
  situation: { codebase, runtime, firstMove, repoHint, constraints }
}                                    // travels through save, share and import
view = { panX, panY, zoom }          // zoom range: 0.18–2.6
```

Auto-saved via `debouncedSave()` (300ms) on every change. The camera is saved
separately under `'pathfinder-view'`, deliberately not inside the canvas payload:
a share link should carry the diagram, not the sender's pan and zoom.

**Backward compatibility:** `normalize.js` is the single choke point for load/import/share. It coerces legacy `questions` (plain `string[]`) into `[{text}]` objects and tolerates a missing `docRef` (→ `null`). Per the "don't silently mutate on load" rule, the normalized shape only persists on the next real edit.

---

## Block Types

13 types defined in the `TYPES` constant. Each has a unique accent colour, which the card preset renders as a full border, a left stripe, a header strip, or a tint (see **Card presets** above). The palette surfaces a **Core 6** by default; the rest live behind an "Advanced types" expander (`#advancedBlocks`), but all 13 are fully usable and no type is ever removed (deleting a type would drop existing blocks via `normalize.js`).

| Type | Color | CSS Var | Palette |
|------|-------|---------|---------|
| goal | #a78bfa (violet) | --c-goal | Core |
| problem | #f87171 (red) | --c-problem | Core |
| requirement | #fbbf24 (amber) | --c-requirement | Core |
| assumption | #eab308 (gold) | --c-assumption | Core |
| risk | #fb923c (orange) | --c-risk | Core |
| decision | #34d399 (emerald) | --c-decision | Core |
| question ("Open Question") | #38bdf8 (sky) | --c-question | Advanced |
| resource | #2dd4bf (teal) | --c-resource | Advanced |
| output | #818cf8 (indigo) | --c-output | Advanced |
| process | #60a5fa (blue) | --c-process | Advanced |
| terminator ("Start / End") | #f0abfc (pink, pill-shaped) | --c-terminator | Advanced |
| context | #64748b (slate) | --c-context | Advanced |
| custom | #d8b4fe (bright fuchsia) | --c-custom | Advanced |

**Flow node types (`process`, `terminator`):** for end-to-end workflows. `process` is a step/action, `terminator` bookends a flow (rendered pill-shaped). The prompt export adds a `## Workflow (end-to-end)` section that walks these in arrow order (light topological sort from arrow-less roots, terminators first). See `flowSection()` in `prompt.js`.

**assumption vs question:** an Assumption is a belief treated as true without validation (default `validate` action; feeds an "Assumptions (validate before building)" prompt section the AI is told to pressure-test). A Question is a genuine unknown. A question's inspector shows a "Promote to Assumption" button.

---

## Gap Detection

`runGapDetection()` runs automatically on every canvas change. Gap branches are **mutually exclusive**. A block reports exactly ONE gap (isolation wins outright; type-specific gaps only apply to *connected* blocks wired wrongly):

| Class | Meaning | Trigger |
|-------|---------|---------|
| `gap-isolated` | No connections at all | Block has 0 incoming + 0 outgoing arrows (checked first; short-circuits) |
| `gap-assumption` | Unvalidated assumption | **Connected** assumption-type block not linked to a Goal/Requirement and without a `validate` action |
| `gap-no-req` | Goal without requirements | Connected Goal block has no arrow to a Requirement |
| `gap-unaddressed` | Ignored problem | Connected Problem block lacks "resolve" action and has no outgoing arrows |

Gap icons pulse (1.8–2.5s animation) in the block header.

---

## Export / Import

Accessed via "Export ▾" dropdown in the header:

| Action | Output |
|--------|--------|
| Copy Prompt | Clipboard: markdown AI prompt |
| Download JSON | `pathfinder.json`: full canvas (blocks + arrows + timestamp) |
| Download Markdown | `pathfinder.md`: a section per block type (**every** type: leaving one out of `order` silently drops those blocks), labelled connections, and a Mermaid graph of the same topology |
| Import JSON | File picker; replace or merge with existing canvas |

**Merge behavior:** existing blocks preserved; imported blocks get new IDs, arrow refs remapped.

---

## Keyboard Shortcuts

The displayed list is a **separate hardcoded array** (`SHORTCUTS` in `ui-panels.js`),
not derived from the handler, so a new binding has to be added in both places or
users never learn it exists.

| Shortcut | Action |
|----------|--------|
| `L` | Tidy: auto-arrange the canvas |
| `H` | Hide the header and footer |
| `Z` | Zen: hide every panel too |
| `Alt + H` | Toggle high-contrast mode |
| `?` | Shortcut overlay |
| Delete / Backspace | Delete selected block or arrow |
| Cmd/Ctrl + D | Duplicate selected block |
| Double-click title | Inline edit |
| Enter (in title edit) | Commit |
| Double-click empty canvas | Fit view |

`H`, `Z`, `?` and `Alt+H` sit above the read-only bail so they work in `?readonly`
and `?embed`, and below the typing bail so they never fire inside an input.

---

## CSS Class Patterns

- `.block[data-type=goal]`: type-specific styling
- `.block.selected` · `.block.dragging`
- `.block.gap-isolated` · `.block.gap-assumption` · `.block.gap-no-req` · `.block.gap-unaddressed`
- `.block[data-card=outline|bar|header|tint|plain]`: card preset
- `.block[data-highlight=alert|focus|go|hold|festive]`: presentation ring
- `body.spotlight`: fade every block without a highlight
- `.port-left` · `.port-right` · `.port-top` · `.port-bottom` · `.arrow-handle`
- `body.tidying`: transient, animates blocks to their new positions
- `body[data-chrome=off]` · `body[data-zen=on]`: expanded view
- `.panel-tab.active` · `.tab-pane.active`
- `.type-pill.active` · `.action-toggle.active`
- `.export-wrapper.open`

---

## Design Tokens

Follows the standard Neorgon dark theme (see `PROJECTS.md §4`). Block type colors use a distinct palette separate from brand accent colors. Header gradient: `135deg, #B015B0 0%, #3D0080 45%, #080010 100%`.
