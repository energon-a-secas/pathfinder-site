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
| `index.html` | ~820 | HTML shell + OG meta; `#fileActions` / `#shareActions` are hidden rows the header menus render |
| `css/style.css` | ~4020 | All CSS. Ends with one marked section per area (`[menu]`, `[inspector]`, `[menus]`, `[lines]`, `[chrome]`, `[navigation]`, `[types]`, `[cards]`, `[insights]`, `[sharing]`) |
| `js/app.js` | ~150 | Entry point: imports all modules, calls `init()` |
| `js/state.js` | ~405 | State shape, `loadState()`/`saveState()`, undo entries (`undoEntry`, `snapshot`, `snapshotOnce`), camera persistence, share-link encoding (`#s=`, `#z=`) |
| `js/utils.js` | ~700 | `TYPES` registry (16 types, `TYPE_STEPS`, `typesByStep()`), `CARD_STYLES`, `DEFAULT_ARROW_WEIGHT`, `askedQuestions()`, `$` element getters, helpers |
| `js/normalize.js` | ~285 | The one choke point for load, import and share: coerces legacy shapes, keeps unknown types as `custom` + `typeHint` |
| `js/render.js` | ~450 | `renderBlock()`, the mutation layer (`mutateBlock(s)`, `mutateArrow`), `addArrow`, undo/redo, `blockDecorators` |
| `js/cards.js` | ~40 | Card painting helpers `renderBlock` uses (light-theme accent twin, highlight tab word) |
| `js/create.js` | ~205 | `createBlockAt`, `createConnected`, `insertOnArrow`, `suggestedNextTypes`, `applyGapFix` |
| `js/inline-edit.js` | ~170 | Title and description editing on the card |
| `js/type-menu.js` | ~155 | The one type picker (`typeMenuItems`) and the one retype rule (`retypeBlock`) every menu shares |
| `js/menu.js` | ~525 | The one menu component (`openMenu`, `openDropdown`): context menus, header menus and inspector pickers |
| `js/context-menu.js` | ~890 | Right-click menus for a block, a selection, a connection and the canvas, plus the quick-add picker `openCanvasAddMenu` |
| `js/inspector.js` | ~1255 | The right panel: one block, a selection, or a connection; `focusQuestion` |
| `js/palette.js` | ~240 | Palette grouped by step, the six-step starter |
| `js/classify.js` | ~330 | Line classifier, outline parser, paste and Brain Dump, the card's type check |
| `js/events.js` | ~1010 | Canvas pointer and wheel handlers, keyboard shortcuts, Tab traversal |
| `js/navigation.js` | ~370 | Reading order, nearest block by direction, nudge, announcements, quick create from a port |
| `js/zoom-controls.js` | ~250 | The camera: zoom cluster, zoom steps, `zoomToBlocks`/`zoomToSelection`, wheel clamp, Back to content |
| `js/canvas.js` | ~435 | `renderArrows()`, `resolveRoutes()`, `pathFor()`, `fitView()`; re-exports the `arrow-*.js` modules |
| `js/arrow-geometry.js` / `arrow-routes.js` / `arrow-labels.js` / `arrow-hover.js` | ~210 / 330 / 170 / 115 | Heads, weights and dashes; lanes and route separation; label placement; hover rings |
| `js/arrow-edit.js` | ~270 | The inline connection label editor |
| `js/route.js` | ~655 | Orthogonal router: A* over a lattice of block edges. Pure, no DOM |
| `js/layout.js` | ~425 | Layered auto-layout (`tidyCanvas`), `releaseTidyPins` |
| `js/align.js` | ~195 | Drag guides; `arrangeSelection` (align and distribute) for the inspector and the context menu |
| `js/gaps.js` | ~555 | Pure `detectGaps()`, the DOM writer `runGapDetection()`, `GAP_META`, `gapIconFor`, `acceptGap` |
| `js/attention.js` | ~240 | The Attention tab |
| `js/relations.js` | ~85 | Connection meanings, `relationOf`, `impliedVerb` |
| `js/prompt.js` | ~650 | `generatePrompt()`, `refreshPrompt()`, `computeHealthScore()` |
| `js/export.js` | ~445 | JSON / Markdown export, `applyImport`, meeting summary, Presentation Sage |
| `js/interop.js` | ~570 | JSON Canvas in and out, Mermaid in and out (`toMermaid`, which the Markdown export uses too) |
| `js/image-export.js` | ~315 | Diagram export: native SVG + 2x PNG, drawn to the card and line specs |
| `js/view-menu.js` | ~445 | Header menus: Maps, File, Share, Tidy direction, View, Help; in place inside the phone overflow panel |
| `js/ui-panels.js` | ~1390 | Search, shortcut sheet (`SHORTCUTS`), panel tabs, dev options, File and Share actions, Tidy, share-link arrival |
| `js/library.js` | ~545 | Maps library: per-map slots, write-through autosave, snapshots + diff, the Maps menu items |
| `js/sharing.js` | ~400 | Incoming links and files (open as a new map by default), other-tab warning, backup status |
| `js/chrome.js` | ~90 | `H` / `Z` expanded view |
| `js/voting.js` | ~70 | Dot voting as an explicit mode (View ▾ → Dot voting): `setVotingMode`, the banner; a plain click never votes |
| `js/doc-panel.js` | ~217 | Living documentation: docRef resolution, doc-preview popup, `See:` detection, grounded question prompts |
| `tutorial.html` + `js/tutorial-example.js` | none | Worked walkthrough; the example loads via the share hash |

**Key interactions added 2026-09-28 (UI overhaul):**
- **Types**: 16 in the `TYPES` registry (`utils.js`), grouped by `TYPE_STEPS` (Why, Who, Proof, What, How, Doubt, Other; `typesByStep()`). New: `stakeholder`, `metric`, `implementation`; `terminator` reads Trigger / End. Every exporter iterates the registry, and `tests/types-registry.test.js` fails when one leaves a type out. Ids never change.
- **One type picker, one retype rule** (`type-menu.js`): the inspector's Type dropdown, Change type, the quick-add picker and the card's type check build from `typeMenuItems`; every pick goes through `retypeBlock` (clears `typeCheck` and `typeHint`, drops a colour that was only the old type's). Do not write a second picker.
- **One menu component** (`menu.js`): right-click menus for a block, a selection, a connection and the canvas (`context-menu.js`, also `Shift+F10`); header menus Maps, File, Share, Tidy direction, View, Help (`view-menu.js`), rendered in place inside the kit's overflow panel on phones. Only the trace page still uses the old `.export-dropdown` markup.
- **Editing on the card** (`inline-edit.js`): double-click, `Enter`/`F2`, `Shift+Enter` for the description; Escape commits. Double-click a line, or `Enter`/`F2` on a selected one, edits its label (`arrow-edit.js`). Double-click empty canvas opens the quick-add picker; Fit moved to `Shift+1` and the status bar.
- **Quick create**: click a port, drop a port's line on empty canvas (the same quick-add picker, `suggestedNextTypes` first), `Alt+Arrow`, `Cmd/Ctrl+Enter`.
- **Lines**: `arrow.style` is the route (`routed`, `curved`, `straight`, `elbow`) and `arrow.pattern` the dash (`solid`, `dashed`, `dotted`); a legacy `dashed`/`dotted` style loads as curved + pattern. New connections draw at `DEFAULT_ARROW_WEIGHT` (1.5); a saved arrow without a weight keeps drawing at 2 (`arrowWeight`). Labels are pills placed off bends and cards. `portsBy: 'import'` marks sides an imported file chose; Tidy and a drag release them like `tidy` pins, and a drag lands on whole pixels.
- **Motion is off by default** (`prefs.js` `motion`, View ▾ → Animate highlights): gap states and highlights are static rings at rest; with `body.motion-on` they animate only on the hovered, selected or focused card; `prefers-reduced-motion` stops everything. A gap class names its colour in `--gap` and its motion in `--gap-anim`, never `animation` itself. Selection is an outline and never a shadow.
- **Gaps** (`gaps.js`): a pure `detectGaps()` plus the DOM writer `runGapDetection()`, the only writer of a card's `gi-` icon slot; one gap per block. `gapAck` accepts a gap (the inspector's Suggestions, the Attention tab) and the prompt lists it under Accepted gaps.
- **Undo carries the map settings**: every undo entry holds `cardStyle` and `spotlight` (their setters snapshot), and a replace's entry (`snapshot({ framing: true })`) holds the whole framing: title, brief, situation, prompt options. Title and brief edits take no snapshot of their own, which is why an ordinary entry leaves them alone.
- **Sharing**: new links are `#z=` (deflate-raw, base64url) carrying `?via=share`; `#s=` still decodes. A link, `?src=` or an imported file opens as a new map by default, in a real dialog; Replace keeps a named snapshot first. A modal dialog owns the keyboard: the global key handler bails on `dialog:modal`.
- **JSON Canvas and Mermaid round-trip every type**: `toMermaid` (File ▾ → Copy Mermaid, and the Markdown export's graph) writes a shape and a `class` line per type; JSON Canvas export writes each type's exact hex and `pathfinderType`. Import reads those before any guessing.

**Key interactions added 2026-08-24 (async review):**
- **Review on the view-only link** (`js/review.js`, `#reviewBar`, readonly only, never embed): select a block, leave a note, repeat; "Copy review patch" emits a standard `pathfinder-patch` with the new `notes` op. The author pastes it into Paste a reply or a review; notes land appended to `block.notes` prefixed `Review:`, previewed and one-undo like every patch. No server, deliberately: this is the alternative to realtime multiplayer, not a step toward it.

**Key interactions added 2026-08-24 (user templates):**
- **Save canvas as template** (foot of the Templates palette section): captures the live canvas into `pathfinder-templates` (max 12) in the exact shape built-ins use, positions normalised, arrows re-indexed, criteria/questions/situation/mode riding along; `applyTemplate` now carries `criteria`, `rationale`, `status` and `questions` for any template that has them. User templates render after the built-ins with a delete ×. Templates travel between browsers as canvases (export the canvas, import, save as template).

**Key interactions added 2026-08-24 (snapshots, per-map camera):**
- **Map snapshots** (`library.js`): Maps ▾ → "Snapshot this map" keeps a full copy under `pathfinder-snaps-<mapId>` (max 8, oldest dropped); the Snapshots submenu lists each with `fmtWhen` and a since-then diff (`diffPayloads`: ±blocks, changed, ±arrows); restoring auto-snapshots the pre-restore state first. Applying a patch auto-snapshots as "Before the patch": Cmd+Z covers the session, the snapshot covers next week.
- **Per-map camera**: the view persists under `pathfinder-view:<mapId>`, the map this tab has open (`mapIdHooks` in `state.js`, answered by `library.js` `currentId`) (legacy `pathfinder-view` is a read fallback); switching maps restores the target's camera and skips the fit (`applyImport(data, mode, { fit })`).
- **The test suite no longer clobbers the live canvas**: `run-tests.html` snapshots every `pathfinder-*` localStorage key before importing test modules and restores them after the run (and on pagehide).

**Key interactions added 2026-08-24 (interop):**
- **JSON Canvas in and out, Mermaid in** (`js/interop.js`). The Import picker detects the format; a node with no type signal goes through the Brain Dump classifier, and a low-confidence call is marked `typeCheck` for the card's type check (the `pf:show-type-chips` event still carries them; `applyImport` returns `idMap` so they survive a merge remap). Mermaid positions come from `layoutGraph`, not a guess.

**Key interactions added 2026-08-24 (the round trip):**
- **`pathfinder-patch`** (`js/patch.js`, spec in `llms.txt`): every prompt now ends with `## When you reply` plus a block-id map, asking the assistant to close with a fenced patch: answers into questions, assumptions verified/refuted **into decisions in place** (same id, arrows survive, evidence lands in `rationale`), status, criteria, new wired blocks. Prompt tab → "Paste a reply or a review" takes the whole reply, previews every operation (fuzzy title matches labeled, ambiguity refused), applies as **one undo step**.

**Key interactions added 2026-08-24 (agent channel):**
- **`validate.mjs`**: Node CLI over the app's own `normalize.js` (fetched from the live site when run standalone), naming every dropped or coerced item. Exit 0 clean / 1 items dropped or coerced / 2 unreadable. The write-back contract's proof step; documented in `llms.txt`.
- **`?src=<https url>`** loads canvas JSON from a URL (proctor's pattern): https or same-origin only, 1 MB cap, GitHub raw/gist whitelisted in the CSP `connect-src`, the same new-map, replace or merge dialog as `#s=`, URL cleaned via `replaceState` either way (`checkSrcUrl` in `ui-panels.js`).
- **Arrival counting** is kit-owned: the header kit's `shareArrivalLabel` pattern covers `#s=` since 2026-08-24 (the site-local `js/arrival.js` stopgap was retired the same day to avoid double counting). It does not match `#z=`, so the app's links also carry `?via=share` (embeds `?via=embed`), which the kit counts; the canonical fix is the kit's regex in `packages/neorgon-ui/header`.
- **`pathfinder` skill** lives in `neorgon-forge` (`skills/before/pathfinder`): reads a canvas or brief, writes back a validated canvas or share link.

**Key interactions added 2026-08-24 (tidy pins, pill, maps):**
- **Tidy port pins carry provenance** (`portsBy: 'tidy'`). Tidy never overwrites a hand-pinned side; a same-layer edge gets perpendicular geometry ports (not bottom→bottom); a backward edge keeps the under-detour only when `routed`, other styles go back to auto; dragging a block releases tidy pins on its arrows (`releaseTidyPins` in `layout.js`, called from the drag pointerup). Pins matching the pre-provenance scheme are adopted and healed on the next Tidy.
- **Copy prompt** lives in the bottom canvas utility bar alongside zoom and save status. It uses a standard copy icon with inline confirmation. Zen (`Z`) hides the bar. The older floating pill and its `pathfinder-pill` setting have been retired.
- **Maps** (header, `library.js`): several canvases per browser. Active map stays in `pathfinder-v1`; switching flushes, loads through `applyImport('replace')` and clears the undo stack. New / duplicate / delete / export-all / import-all. Hidden in readonly and embed.
- `portPos` returns whole pixels, killing half-pixel jogs in routed paths.
- **Acceptance criteria + decision rationale + Spec bundle**: `block.criteria[]` (requirement/goal/output) and `block.rationale` (decision) edit in the inspector, feed the prompt (Build's `[NEEDS INPUT]` placeholder only appears when criteria are missing), the Markdown export, and **File ▾ → Download Spec bundle (zip)**: spec/plan/tasks/EARS-requirements built by `spec-export.js`, zipped by `zip.js`.
- **Prompt options travel with the canvas** (`meta.prompt`). `serializeCanvas()` in `state.js` is the single serializer (autosave, share, Maps, JSON export); `applyPromptOpts()` applies a load back into `devOpts`; the `pf:prompt-opts-changed` event resyncs the Prompt tab (`syncPromptOptControls`). Preset chips (Claude Code, Cursor + TS, PM clarify) set the bundle in one click. The tutorial example carries `mode: investigate`. `flowSection()` orders workflow steps by whole-graph layering and numbers only process steps.

**Key interactions added 2026-08-14 (presentation highlights):**
- **`block.highlight`** (`alert` / `focus` / `go` / `hold` / `festive`) draws a ring *outside* the card, so it never disturbs the card border or the layout. `festive` is a candy-cane border built with the two-layer mask recipe, since a plain border cannot carry a repeating gradient and `border-image` cannot be animated; it marches only with Animate highlights on. Alert, Focus, Go and Hold carry their word on a tab (`highlightTabLabel` in `cards.js`), so the ring never relies on colour alone. Registry: `HIGHLIGHTS` in `utils.js`.
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
- **`tutorial.html`** is a worked walkthrough; `js/tutorial-example.js` loads the finished example (`example-canvas.js`) through the share hash.
- **`llms.txt` is hand-authored**: the generator marker was removed deliberately. It is the format spec: canvas JSON, every enum, and how to consume an export from a terminal session or a skill.

**Key interactions added 2026-08-14 (connections, layout, card styling):**
- **Connections do not stack.** `resolveRoutes()` in `canvas.js` is the single source of arrow geometry for both the canvas and the SVG/PNG export. It buckets every endpoint by the side it lands on and gives each one its own lane, so six arrows into one block arrive on six points instead of fusing into one line.
- **`routed` is the default arrow style** for new connections: an orthogonal path that steers around other blocks (`route.js`, A* over a lattice built from block edges, turn-penalised so it prefers few bends). The router declines above a node budget and falls back to `elbow`. Routing is skipped while a pointer is down and run once on release.
- **Connection points are pickable.** The arrow inspector has From/To side pickers writing `fromPort`/`toPort`, and a selected arrow shows draggable endpoint handles that re-pin or re-target it.
- **Tidy** (`layout.js`, header button + `L`) re-lays the canvas with a layered/Sugiyama layout and points every connection along the flow. It takes exactly one `snapshot()`, so one Cmd+Z restores the whole arrangement.
- **Alignment aids** (`align.js`): snap guides while dragging (suppressed when grid snapping is on), plus align/distribute for a multi-selection.
- **Card presets** replace the fixed left stripe: `outline` (default), `bar` (the old look), `header`, `tint`, `plain`. Per block via the inspector, canvas-wide via **View ▾ → Card style** (`canvasMeta.cardStyle`, so it travels through share links and JSON export, and one undo step).
- **`H` hides the header and footer, `Z` hides the panels too** (`chrome.js`, persisted). Both stay live in read-only and embed views. `Alt+H` is still high contrast.

**Key interactions added 2026-07-01:**
- Multi-line descriptions render with `escHtmlMultiline` + `white-space: pre-wrap` (newlines preserved on the card and in exports).
- Right-click any block for a quick-action menu (`context-menu.js`); also `Shift+F10`/ContextMenu key on the selected block.
- Arrows carry an optional `note` (richer than `label`), hidden until hover/selection, or always shown via **View ▾ → Always show connection notes** (`ui.showArrowText`, persisted `pathfinder-arrowtext`, body class `show-arrow-text`).
- Right panel collapses via a chevron (persisted `pathfinder-panel-collapsed`).
- File ▾ → **Download Image (PNG 2×)** / **Download Vector (SVG)** redraws the canvas as a self-contained SVG (`image-export.js`) to the card and line specs. No DOM screenshot.
- Brain Dump folds indented/bulleted lines into the parent block's description (toggle in the card); `parseOutline()` in `classify.js`.
- Prompt pane shows a one-line description of the selected mode (`refreshModeDesc` in `ui-panels.js`).
- **Dark theme is the default** (no OS-preference opt-in); light mode only when explicitly saved.

## Traces: the second document type (added 2026-08-25)

`trace.html` is a **different tool in the same repo**, not a canvas mode. The canvas
is free-position typed cards you drag toward a shared decision. A trace is a YAML
document you write during an incident, and the diagram is computed from it.

| File | Role |
|---|---|
| `trace.html` | Page shell: source pane, diagram pane, export menu |
| `css/trace.css` | Page layout. Deliberately separate from `style.css` |
| `js/trace/model.js` | Registries: node kinds, link states, box metrics. Data only |
| `js/trace/parse.js` | YAML object to a normalized trace, plus diagnostics. Pure |
| `js/trace/measure.js` | Box sizes computed from text. No DOM |
| `js/trace/layout-trace.js` | Scene builder: containment, lanes, routing, label placement |
| `js/trace/render-svg.js` | Scene to SVG. The only renderer |
| `js/trace/suggest.js` | Rule engine over the trace's shape and words |
| `js/trace/packs/aws.js` | AWS connectivity knowledge, as data. Extend this |
| `js/trace/prompt-trace.js` | The AI trace-builder prompt, generated from the registries |
| `js/trace/app.js` | Page wiring: parse loop, camera, export, examples |
| `validate-trace.mjs` | CLI over `parse.js`. Exit 0 clean / 1 warnings / 2 errors |
| `traces/*.yaml` | Worked examples, fetched by the page rather than inlined |

**Things that will bite you here:**

- **There is one renderer.** The screen, the SVG download and the iframe are the
  same string from `renderSvg()`. This works only because nothing measures the
  DOM: box sizes come from `measure.js`. Do not add a DOM measure pass. The canvas
  needs `image-export.js` as a parallel exporter precisely because it does measure,
  and the two can disagree.
- **Paint order is load-bearing**: containers, then edge paths, then boxes, then
  edge labels. Move labels back in with their edges and any label landing over a
  box vanishes behind it.
- **`branch` is not `unknown`.** A tree's edges default to `branch`, which makes no
  claim. A topology's default to `unknown`, which asserts nobody checked. Sharing
  one default drew 46 meaningless dashed lines.
- **Prose folds, probes do not.** `wrap()` joins single newlines (Markdown's rule)
  because YAML `|` preserves them and authors wrap the source file for width, not
  for meaning. `fold: false` is passed for probe strings, which are line-per-command.
- **Embed mode must never touch `localStorage`.** An embedded trace is someone
  else's document on someone else's page; autosaving it overwrites the visitor's
  own work. It also keeps its `#t=` hash, which is its only copy.
- **`#t=` is base64url over UTF-8 bytes**, not the canvas's
  `btoa(encodeURIComponent(...))`. About 45% shorter for the same document.
- **`parse.js` takes the YAML loader as an argument.** That is what lets the browser
  (CDN js-yaml) and `validate-trace.mjs` (npm js-yaml) run identical acceptance code.
- Do not call `fit()` through `requestAnimationFrame`: rAF is throttled to nothing
  in a background tab, and `fit()` never reads a painted frame.

Format spec for agents lives in `llms.txt`, hand-authored like the canvas section.
Tests: `tests/trace.test.js` (39), registered in `tests/run-tests.html`, which now
loads js-yaml for them.

**Embedding:** `?embed&readonly` is a supported mode (`buildEmbedUrl()`), so the CSP meta
deliberately carries **no** `frame-ancestors`. It was there and did nothing: the directive is
ignored when delivered via `<meta>`, and the browser logged an error on every page load. If
this ever moves to a host that can set real headers, note that `frame-ancestors 'none'` would
break embedding.

**Required assets:** `index.html` · `css/style.css` · `js/*.js` · `favicon.ico` · `energon-classic-logo.png` · `og-preview.jpg` · `CNAME`

**Pages:** `index.html` (the app) · `tutorial.html` (walkthrough; example loads via `js/tutorial-example.js`) · `examples.html` (gallery: the checkout example plus the four large templates, converted by `js/examples-page.js` `templateToPayload()` and loaded through the share hash, so gallery content can never drift from the app's own).

**📖 Read `docs/references/internals.md` before changing code in** `doc-panel.js` (Living Documentation, docRef, fetch gating/CSP, "See:" promotion, live questions), `canvas.js` (pan/zoom, ports, Bézier routing), or `prompt.js` (per-mode prompt generation, Brain Dump classifier, dev options). It also holds the full **Key Functions Reference** (per-module function lookup).

---

## State

**localStorage key:** `'pathfinder-v1'` (the **active** map). The canvas library keeps
`'pathfinder-maps'` (index), `'pathfinder-map-<id>'` (one payload per map) and
`'pathfinder-map-current'` (active id), `'pathfinder-snaps-<id>'` (snapshots, max 8)
and `'pathfinder-view:<id>'` (per-map camera); `saveState()` write-through hooks
(`saveHooks` in `state.js`, registered by `library.js`) mirror every autosave into
the active map's slot. The legacy `'pathfinder-pill'` setting is no longer used.

**Storage migration gotcha:** a pre-library browser (canvas under `'pathfinder-v1'`,
no `'pathfinder-map-current'`) is adopted on first load: `ensureLibrary()` in
`library.js` mints an id and mirrors the in-memory canvas (already loaded from
`'pathfinder-v1'` by `loadState()`) into its slot via `writeThrough()`. So
`setupLibrary()` must run **after** `loadState()`, or the migration captures an
empty canvas. `'pathfinder-v1'` is never renamed or removed: it stays the live
pointer every autosave writes first, which is what keeps share links, old sessions
and the test harness working. Deleting a map also deletes its
`'pathfinder-snaps-<id>'` and `'pathfinder-view:<id>'` keys.

```js
state = {
  blocks: {
    [id]: {
      id, type, title, description, notes,
      x, y,                          // pixel position in canvas world
      actions: [],                   // 'resolve' | 'prepare' | 'recollect' | 'reinforce' | 'validate'
      questions: [],                 // [{ text, answer?, askedAt? }]: see Living Documentation
      docRef: null,                  // { href, label, anchor } | null: see Living Documentation
      cardStyle: null,               // preset key | null = follow canvasMeta.cardStyle
      criteria: [],                  // acceptance criteria (requirement/goal/output); feeds prompt, tasks.md, EARS
      rationale: '',                 // why a decision was made (decision blocks)
      borderWidth: null,             // 1 | 1.5 | 2 | 3 | null = preset default
      highlight: null,               // presentation emphasis | null. Never semantics
      typeCheck,                     // true: typed automatically with low confidence, not confirmed yet
      gapAck,                        // gap ids the author accepted: ['gap-no-criteria', ...]
      typeHint                       // the original type when this build did not know it (kept as custom)
    }
  },
  arrows: [{
    id, from: blockId, to: blockId,
    style,                           // route: 'routed' (default) | 'curved' | 'straight' | 'elbow'
    pattern,                         // 'solid' (default) | 'dashed' | 'dotted'
    weight,                          // new: DEFAULT_ARROW_WEIGHT (1.5); missing = 2 (older maps)
    relation,                        // 'precedes' | 'depends-on' | 'blocks' | 'informs' | 'related' | null
    fromPort, toPort,                // 'left'|'right'|'top'|'bottom' | null = auto
    portsBy                          // 'tidy' (auto-layout) | 'import' (an imported file); released when a block moves; absent = user/auto
  }]
}

canvasMeta = {
  title, contextBrief, cardStyle,
  spotlight,                         // fade everything unhighlighted
  situation: { codebase, runtime, firstMove, repoHint, constraints },
  prompt: { mode, tone, detail, pre: [] }  // serialized from devOpts by serializeCanvas(); applied back on load/import/switch
}                                    // travels through save, share and import
view = { panX, panY, zoom }          // zoom range: 0.18–2.6
```

Auto-saved via `debouncedSave()` (300ms) on every change. The camera is saved
separately under `'pathfinder-view'`, deliberately not inside the canvas payload:
a share link should carry the diagram, not the sender's pan and zoom.

**Backward compatibility:** `normalize.js` is the single choke point for load/import/share. It coerces legacy `questions` (plain `string[]`) into `[{text}]` objects, tolerates a missing `docRef` (→ `null`), reads a legacy `dashed`/`dotted` style as `curved` plus that pattern, a label written where a type id belongs ("Start / End") as its type, and keeps an unknown type as `custom` with `typeHint`. Per the "don't silently mutate on load" rule, the normalized shape only persists on the next real edit.

**Rollback and older builds (added 2026-09-29):** builds before the 16-type registry drop every block of a type they do not know on load, and their next autosave keeps the loss. So `normalize.js` forward compatibility (an unknown type stays `custom` + `typeHint`) must never be reverted, and a rollback reverts UI modules only: it keeps `normalize.js` and the `TYPES` registry, and users are told to run Maps ▾ → Export all maps first. The safety net lives in `library.js`: local saves carry `meta.schema`, each map keeps one last-good copy (`'pathfinder-lastgood-<id>'`, the size of its slot), and an unstamped save missing new-type blocks raises the Restore banner (`checkOlderVersionLoss`), worded as a possibility when the save cannot show which build wrote it. A copy holding an offer is never deleted. Each tab reopens its own map on reload (sessionStorage `'pathfinder-tab-map'`).

**Undo:** every entry holds blocks, arrows, groups and the map settings `cardStyle` and `spotlight`; a replace's entry holds the whole framing (`undoEntry` in `state.js`). Text fields coalesce a typing burst into one entry with `snapshotOnce`.

---

## Block Types

16 types in the `TYPES` registry (`utils.js`), in the order the palette, the pickers and every exporter read them: grouped by the question each answers (`TYPE_STEPS`, `typesByStep()`). Each has a colour for each theme; the card shows it as an 8px dot beside a neutral label and a quiet edge, never as label text. The palette shows all 16 grouped by step; `tier` (core / more) decides what the canvas menu's Add here lists before **More types**. No type is ever removed (deleting a type would drop existing blocks via `normalize.js`), and ids never change, only labels. The README's table is the reader's copy; this is the shape:

| Step | Types |
|------|-------|
| Why | goal, problem |
| Who | stakeholder |
| Proof | metric (its `criteria` are Targets) |
| What | requirement, output |
| How | implementation, process, terminator ("Trigger / End", pill-shaped), decision, resource ("Resource / System") |
| Doubt | assumption, risk, question ("Open Question") |
| Other | context, custom ("Other": untyped, checks skip it) |

The confusable pairs (`TYPE_DISAMBIGUATION`): every time a flow runs is a Process, once to build or change something is an Implementation; a moment in time is a Trigger / End, a thing someone can hold is an Output; a number with a target is a Metric.

**Flow node types (`process`, `terminator`):** for end-to-end workflows. `process` is a step/action, `terminator` bookends a flow (rendered pill-shaped). The prompt export adds a `## Workflow (end-to-end)` section that walks these in arrow order (light topological sort from arrow-less roots, terminators first). See `flowSection()` in `prompt.js`.

**assumption vs question:** an Assumption is a belief treated as true without validation (default `validate` action; feeds an "Assumptions (validate before building)" prompt section the AI is told to pressure-test). A Question is a genuine unknown. A question's inspector shows a "Promote to Assumption" button.

---

## Gap Detection

`detectGaps(blocks, arrows)` in `gaps.js` is pure (no DOM); `runGapDetection()` runs it on every canvas change and paints the result: one gap class per card and a line icon (`gapIconFor`) with its name in the card's `gi-<id>` slot. Gap branches are **mutually exclusive**: a block reports exactly ONE gap, isolation first, then the rules in this order (a type rule applies only to a *connected* block):

| Class | Meaning | Trigger |
|-------|---------|---------|
| `gap-isolated` | No connections at all | 0 incoming + 0 outgoing arrows (short-circuits) |
| `gap-assumption` | Dangling assumption | Assumption not linked to a Goal/Requirement and without `validate` |
| `gap-no-req` | Goal with nothing under it | Goal linked to no requirement, metric or implementation |
| `gap-unaddressed` | Ignored problem | Problem without `resolve` and no outgoing arrows |
| `gap-no-mitigation` | Unmitigated risk | Risk with no outgoing arrows and no `prepare` |
| `gap-no-basis` | Decision without basis | Decision with no incoming arrows and no `rationale` |
| `gap-no-producer` | Output nothing produces | Output with no incoming arrows |
| `gap-no-consumer` | Output nobody receives | Output with no way out and no stakeholder, once the map has a stakeholder or metric |
| `gap-no-criteria` | Done is undefined | Requirement with empty `criteria` |
| `gap-loose-step` | Step outside any flow | Process whose component holds no other flow node |
| `gap-no-purpose` | Work with no reason | Implementation linked to no goal, requirement, problem, metric, output or stakeholder |
| `gap-metric-no-goal` | Metric measuring no goal | Metric linked to no goal |
| `gap-no-target` | Metric without a target | Metric with empty `criteria` |
| `gap-unserved` | Stakeholder nothing serves | Stakeholder nothing is delivered to or asked of |

`GAP_META` is the single label source for the prompt, the card tooltip, the Attention tab and the Prompt tab's breakdown (`#gapBreakdown`). `getGapFixes(b)` offers the fixes (each carries the `gap` it answers; `create: { type, dir }` fixes go through `applyGapFix`). **Accepting a gap** (`acceptGap`, the inspector's Suggestions or the Attention tab) adds it to `block.gapAck`: it stops being reported, and the prompt lists it under "Accepted gaps" while its rule still holds.

Canvas findings (`findings`, per canvas rather than per block, in the Attention tab and the prompt): dependency cycles, empty groups, untyped blocks, no Goal or Problem, goals with no metric, metrics no work moves, likely duplicates, a question hidden in a description, types awaiting a check. The last four named can be accepted per block (`acceptFinding`).

Gap states are a static ring at rest; they animate only with View ▾ → Animate highlights on, and only on the card in front of you (see the motion note above).

---

## Export / Import

From **File ▾** in the header (the rows are hidden buttons in `#fileActions`; `view-menu.js` renders them through menu.js, and `data-readonly="ok"` keeps a row on view-only links):

| Action | Output |
|--------|--------|
| Import JSON / Canvas / Mermaid | One picker, format-detected (`detectFormat`): pathfinder JSON, JSON Canvas, or a Mermaid flowchart. Opens as a new map by default; Replace (after a named snapshot) and Merge are the dialog's other choices (`sharing.js`) |
| Copy Prompt | Clipboard: markdown AI prompt |
| Copy AI diagram-builder prompt | Clipboard: `DIAGRAM_BUILDER_PROMPT`, generated from the registry |
| Download JSON | `pathfinder.json`: full canvas (blocks + arrows + meta + timestamp) |
| Download Markdown | `pathfinder.md`: a section per block type (**every** type: leaving one out of the order silently drops those blocks), labelled connections, and the Mermaid graph |
| Copy Mermaid | Clipboard: `toMermaid()`, the same graph: every block declared, a shape and a `class` line per type, groups as subgraphs |
| Download JSON Canvas | `<title>.canvas` (jsoncanvas.org): each node in its type's exact hex plus `pathfinderType`, criteria as checklists, groups as group nodes, edge sides from pinned ports |
| Download Spec bundle | `pathfinder-spec.zip` (`js/spec-export.js` + the zero-dependency STORE zip writer `js/zip.js`): README, spec.md, plan.md, tasks.md (dependency-ordered), requirements.md (EARS). Missing inputs emit `[NEEDS INPUT]`, never guesses |
| Download Image / Vector | PNG 2x / SVG from `image-export.js` |
| Export Meeting Summary / Open in Presentation Sage | Hand-offs |
| Clear this map… | Danger; one undo step |

Import reads a type before it guesses: `pathfinderType`, an exact type hex, a Mermaid `class` line, then the shape, and only then the classifier (`categorizeLine`), whose low-confidence calls are marked `typeCheck`.

**Merge behavior:** existing blocks preserved; imported blocks get new IDs, arrow refs remapped.

---

## Keyboard Shortcuts

`SHORTCUTS` in `ui-panels.js` is the canonical list (the `?` sheet renders it, grouped Editing, Navigation, Creating, View). It is a hand-kept array, not derived from the handlers, so a binding added anywhere (`events.js`, `inline-edit.js`, `arrow-edit.js`, `context-menu.js`, `classify.js`) has to be added there too; `tests/integration.test.js` checks the ones bound outside `events.js`.

How the handler is layered (`setupKeyboardShortcuts` in `events.js`): a modal dialog bails everything; `Cmd/Ctrl+F` works anywhere; nothing below fires while typing; `?`, `Alt+H` and the View keys (`H`, `Z`, zoom, `Shift+1/2/0`) work in read-only and embed; single-letter keys act only while the canvas (or nothing) has focus, and `Cmd/Ctrl + = - 0` zoom the canvas only then, leaving page zoom alone elsewhere; editing keys stop at the read-only bail.

---

## CSS Class Patterns

- `.block[data-type=goal]`: type-specific styling; `--bc` is the type colour
- `.block.selected` (an outline that wins over every state) · `.block.dragging`
- `.block.gap-*`: one per block (see Gap Detection); `.gap-isolated` is a dashed edge, the rest a ring from `--gap` / `--gap-anim`
- `.block.type-check` · `.block-type-check`: a type awaiting confirmation (the label is a button, `T` opens it)
- `.block[data-card=outline|bar|header|tint|plain]`: card preset
- `.block[data-highlight=alert|focus|go|hold|festive]` + `.block-hl-tab`: presentation ring and its word
- `body.motion-on`: View ▾ → Animate highlights; `body.spotlight`: fade every block without a highlight
- `.port-left` · `.port-right` · `.port-top` · `.port-bottom` · `.arrow-handle`
- `body.tidying`: transient, animates blocks to their new positions
- `body[data-chrome=off]` · `body[data-zen=on]`: expanded view
- `.pf-menu` (+ `.pf-submenu`, `.pf-header-menu`, `.ctx-*-menu`, `.insp-type-menu`, `.type-check-menu`): menu.js menus; `.type-menu-notes` / `.type-menu-note` the type lists' foot
- `.panel-tab.active` · `.tab-pane.active` · `.action-toggle.active`
- Each stream's rules sit in its marked section at the end of `style.css`

---

## Design Tokens

Follows the standard Neorgon dark theme (see `PROJECTS.md §4`). Block type colors use a distinct palette separate from brand accent colors. Header gradient: `135deg, #B015B0 0%, #3D0080 45%, #080010 100%`.
