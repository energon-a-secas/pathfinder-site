# CLAUDE.md: Pathfinder

Plan the work before an agent builds it: a canvas of typed blocks, gap detection, and a brief to hand an AI agent.

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
| `index.html` | ~930 | HTML shell + OG meta; `#fileActions` / `#shareActions` are hidden rows the header menus render |
| `css/style.css` | ~5245 | All CSS. Ends with one marked section per area (`[menu]`, `[inspector]`, `[menus]`, `[lines]`, `[chrome]`, `[navigation]`, `[types]`, `[cards]`, `[insights]`, `[sharing]`, then the design round's `[frontdoor]`, `[zoom]`, `[command]`, `[brief]`, `[braindump]`, `[consistency]`). Tokens only between `tokens:start` / `tokens:end` |
| `js/app.js` | ~150 | Entry point: imports all modules, calls `init()` |
| `js/state.js` | ~460 | State shape, `loadState()`/`saveState()`, undo entries (`undoEntry`, `snapshot`, `snapshotOnce`), camera persistence, share-link encoding (`#s=`, `#z=`) |
| `js/utils.js` | ~805 | `TYPES` registry (16 types, `TYPE_STEPS`, `typesByStep()`), `CARD_STYLES`, `DEFAULT_ARROW_WEIGHT`, `askedQuestions()`, `$` element getters, helpers |
| `js/normalize.js` | ~320 | The one choke point for load, import and share: coerces legacy shapes, keeps unknown types as `custom` + `typeHint` |
| `js/render.js` | ~515 | `renderBlock()`, the mutation layer (`mutateBlock(s)`, `mutateArrow`), `addArrow`, undo/redo, `blockDecorators` |
| `js/cards.js` | ~140 | Card painting helpers `renderBlock` uses (light-theme accent twin, highlight tab word) |
| `js/create.js` | ~345 | `createBlockAt`, `createConnected`, `insertOnArrow`, `suggestedNextTypes`, `applyGapFix`; `nearestFreeSpot` / `placeFree` / `placeNewBlocks`: every creation path takes the nearest free slot, `CARD_GAP` (40px) clear of every card |
| `js/inline-edit.js` | ~205 | Title and description editing on the card |
| `js/type-menu.js` | ~200 | The one type picker (`typeMenuItems`) and the one retype rule (`retypeBlock`) every menu shares; a retype to a type with no criteria moves them into the description |
| `js/menu.js` | ~580 | The one menu component (`openMenu`, `openDropdown`): context menus, header menus and inspector pickers |
| `js/context-menu.js` | ~925 | Right-click menus for a block, a selection, a connection and the canvas, plus the quick-add picker `openCanvasAddMenu`; Connect to ranks by `connectRank`; `selectionMenuItems()` hands the selection's rows to the palette |
| `js/command-palette.js` / `command-items.js` / `command-rows.js` | ~540 / 390 / 75 | The command palette (Cmd/Ctrl+K): the dialog and its keys; the rows (from the menus' own builders) and `matchScore`; one row's markup |
| `js/type-keys.js` | ~160 | N, then a letter (`TYPE_KEYS` in `ui-panels.js`): a block of that type at the pointer or centre |
| `js/inspector.js` | ~1865 | The right panel: one block, a selection, or a connection; `focusQuestion` |
| `js/palette.js` | ~210 | Palette grouped by step; `addTypeAtCenter` (the start panel's pills use it too) |
| `js/start-panel.js` | ~375 | The empty map's start panel: paste your notes (the prefix helper is written from `PREFIXES`), a template, the sample map as its own map (`openSampleMap`), the first-block pills; keys 1, 2, 3; the right panel's empty-state names |
| `js/classify.js` | ~850 | `PREFIXES` (authoritative prefixes as data), headings, `readDump`, the step-column dump (`layoutDump`, `settleDump`), the line classifier, outline parser, paste handler and the card's type check. Only a prefix, a heading or a trailing `?` is certain; every other type is `typeCheck` |
| `js/events.js` | ~1165 | Canvas pointer and wheel handlers, keyboard shortcuts, Tab traversal |
| `js/navigation.js` | ~380 | Reading order, nearest block by direction, nudge, announcements, quick create from a port |
| `js/zoom-controls.js` | ~510 | The camera: zoom cluster, zoom steps, `zoomToBlocks`/`zoomToSelection`, wheel clamp, Back to content; `arriveAt` (where a template, the sample, an example or a share link lands) and `animateTidy`; sets up and re-exports `lod.js` |
| `js/lod.js` | ~220 | Level of detail: the `lod-*` band on `#canvasRoot` (an `applyTransform` hook), the card's small-zoom face (`paintLodFace`, a `blockDecorators` painter), the hover fade's pointer kind |
| `js/minimap.js` | ~250 | The minimap (`M`): type-coloured rects, a draggable frame, click to jump; `aria-hidden`, never on phones or in embeds |
| `js/canvas.js` | ~470 | `renderArrows()`, `resolveRoutes()`, `pathFor()`, `fitView()`; re-exports the `arrow-*.js` modules |
| `js/arrow-geometry.js` / `arrow-routes.js` / `arrow-labels.js` / `arrow-hover.js` | ~210 / 570 / 245 / 115 | Heads, weights and dashes; lanes and route separation; label placement; hover rings |
| `js/arrow-edit.js` | ~270 | The inline connection label editor |
| `js/route.js` | ~1175 | Orthogonal router: A* over a lattice of block edges. Pure, no DOM |
| `js/layout.js` | ~595 | Layered auto-layout (`tidyCanvas`), `releaseTidyPins`; `layoutByStep` (step columns), and Tidy lays blocks no line touches out by step below the flow (all of a map with no connections) |
| `js/align.js` | ~195 | Drag guides; `arrangeSelection` (align and distribute) for the inspector and the context menu |
| `js/gaps.js` | ~590 | Pure `detectGaps()`, the DOM writer `runGapDetection()`, `GAP_META`, `gapIconFor`, `acceptGap` |
| `js/attention.js` | ~285 | The Attention tab |
| `js/relations.js` | ~175 | Connection meanings, `relationOf` (a label, else the endpoint types), `impliedVerb`, `mitigationPairs` |
| `js/patch.js` | ~525 | The `pathfinder-patch` round trip: parse, preview, apply as one undo step; new blocks placed beside what they connect to |
| `js/task-plan.js` | ~170 | The dependency-ordered task checklist (Build mode, `tasks.md`); `cardAnswer` |
| `js/prompt.js` | ~850 | `generatePrompt()`, `refreshPrompt()` (delegates to the Brief tab's renderer), `generateScopedPrompt()`, `estimateTokens()`, `briefOutline()`, `computeHealthScore()` (no longer drawn) |
| `js/brief.js` / `js/brief-md.js` | ~535 / 170 | The Brief tab: the readiness line (`readiness`, from `attentionModel`), scope, Copy and Cmd/Ctrl+Shift+C; `brief-md.js` is its pure Markdown renderer (`briefHtml`). `brief.js` is imported by `app.js` only |
| `js/export.js` | ~465 | JSON / Markdown export, `applyImport`, meeting summary, Presentation Sage |
| `js/interop.js` | ~630 | JSON Canvas in and out, Mermaid in and out (`toMermaid`, which the Markdown export uses too) |
| `js/image-export.js` | ~330 | Diagram export: native SVG + 2x PNG, drawn to the card and line specs |
| `js/view-menu.js` | ~540 | Header menus: Maps (with Rename this map), File, Share, Tidy direction, View (Facilitation: the Session timer, dot voting), Help (GitHub when the bar's icon is hidden); in place inside the phone overflow panel |
| `js/filter-menu.js` | ~68 | The one filter control: Attention's category and Find blocks' type, status and scope are chips that open a menu.js list (`setupFilter`, `filterValue`) |
| `js/ui-panels.js` | ~1675 | Search, shortcut sheet (`SHORTCUTS`, `TYPE_KEYS`), panel tabs, prompt options and Framing (`setupSituation`, `PRESETS`), File and Share actions, templates, Tidy (`runTidy`), share-link arrival (`landIncoming`) |
| `js/library.js` | ~1055 | Maps library: per-map slots, write-through autosave, snapshots + diff, the Maps menu items |
| `js/sharing.js` | ~550 | Incoming links and files (open as a new map by default), other-tab warning, backup status |
| `js/chrome.js` | ~88 | `H` / `Z` expanded view |
| `js/voting.js` | ~67 | Dot voting as an explicit mode (View ▾ → Facilitation → Dot voting): `setVotingMode`, the banner; a plain click never votes |
| `js/doc-panel.js` | ~215 | Living documentation: docRef resolution, doc-preview popup, `See:` detection, grounded question prompts |
| `tutorial.html` + `js/tutorial-example.js` | none | Worked walkthrough; the example loads via the share hash |
| `tools/render-assets.mjs` + `tools/cdp.mjs` | ~260 / 215 | `make assets`: the app draws its own pictures in headless Chrome (examples/*.svg, the brief excerpts in examples.html and tutorial.html, og-preview.jpg, docs/screenshot-*.png). `make test-tools` checks the port, the served root and Chrome's cleanup. Excluded from the site by `_config.yml` |

**Key interactions added 2026-10-03 (design round: the front door and pasted notes):**
- **The start panel** (`start-panel.js`, `#brainDump` markup, CSS `[frontdoor]`) is the empty, editable map: "Plan the work before an agent builds it", then three keyed options (`1` paste your notes, `2` a template through the palette's own `[data-tpl]` button, `3` the sample map opened as its own map, "Sample: Checkout 500s", through `openAsNewMap` and `arriveAfterLoad`), the first-block pills and the storage line. It goes once a block exists (`updateHint`). Read-only and embed never show it, and the keys stand down while typing, in a menu or a dialog.
- **Pasted notes** (`classify.js`): a line prefix or a heading is certain (`PREFIXES`, each entry's `show` words are what the panel teaches, `sure` the spellings read as certain, `keys` every accepted word); any other word or a scored guess is `typeCheck`, so the card asks for a check. `- ` lines under a prefixed requirement or metric become its criteria (`CRITERIA_FROM_BULLETS`), under anything else its description. A dump lands in step columns that wrap to fit the view (`layoutDump`; step rows on a tall view), in the nearest free space, and the camera arrives through `arriveAt(ids, { stay: true })`. The canvas menu's Paste as blocks passes `{ at }` to `createBlocksFromText`; `settleDump` moves a dump clear of a card a caller moved it onto.
- **No creation lands on a card**: `createBlockAt` (palette, pills, quick-add, N then a letter, the palette's Create rows), `createConnected`, `insertOnArrow`, a port's line dropped on empty canvas (`createFromDrop` calls `placeFree`), the dump and a patch's new blocks (`placeNewBlocks`, beside what they connect to) all keep `CARD_GAP` from every card.
- **Assets the app draws itself** (`make assets`, `tools/`): `examples/*.svg` (dark and light, at 0.8 scale so titles read, plus the walkthrough strip), the brief excerpts between `<!-- brief:* -->` markers in examples.html and tutorial.html, `og-preview.jpg` and `docs/screenshot-*.png`. Rerun it after a change to the canvas, the exporter, the brief or the examples; it is idempotent.

**Key interactions added 2026-10-03 (design round: the Brief tab):**
- **The Prompt tab is the Brief tab** (`js/brief.js`; the tab's internal id is still `prompt`, so `ui.activeTab === 'prompt'` and `#promptPane` callers keep working). Top to bottom: the mode as a segmented control, the primary Copy brief (`Cmd/Ctrl+Shift+C`, confirms "Copied: about N tokens, M sections") beside a Whole map / Selection control, one readiness line, a Framing row that folds the Situation, context, presets and Prompt options into one line (it always opens closed), the brief rendered as Markdown under a sticky bar (current section, the outline menu, the size), and "Bring the reply back" last, a single row until it is used.
- **Readiness is the Attention count, in words**: `readiness(attentionModel(...))`, so the Brief and the Attention badge always agree. The health score is no longer drawn (`computeHealthScore` stays as an API).
- **Size is an estimate, said as one**: `estimateTokens` divides by 2.99 characters per token (Markdown, measured on Claude in `tokenizer.json`; half of estimates land within 21%). Past 25k tokens one line suggests briefing a part.
- **Brief for the selection**: `generateScopedPrompt` briefs the selected blocks plus their direct neighbours: it swaps `state.blocks`/`state.arrows` to the part for one `generatePrompt()` call and restores them, adds a `## Scope` section naming the selection as the subject and the neighbours as context only, keeps only the selection's tasks in the Build checklist, lists only those block ids for the patch, and takes the gap sections from the whole map (`scopedGapText`), so a risk mitigated outside the part is never called unmitigated. The status bar's copy button and File ▾ → Copy brief are always the whole map. Other modules copy through the `pf:copy-brief` window event (`{ scope: 'map' | 'selection' }`) rather than importing `brief.js` (the palette's "Copy brief for the selection" does).
- **The renderer is registered, not imported**: `prompt.js` `refreshPrompt()` calls whatever `setBriefRenderer()` registered (`renderBrief`); `brief.js` is imported by `app.js` alone, because it reads `attention.js`, which must not load inside `gaps.js`'s own evaluation (a TDZ on `CRITERIA_GAPS` otherwise).
- **A preset sets Running in too**: "Build in Claude Code" picks Claude Code under Running in, so the two controls can never disagree; a preset shows as pressed only while every option matches it (`presetMatches`). On a view-only link the framing reads as values; the mode still switches, since it is a way of reading the map.

**Key interactions added 2026-10-03 (design round: the hand-off never writes falsehoods):**
- **Open Question cards hold their answer** (`block.answer`): the inspector's Answer field (writing one, then leaving the field by any route, marks the card done in the same undo step) or a patch `answers` entry addressed to the card. Every exporter carries it (`cardAnswer` in `task-plan.js`): the brief's "## Answered Questions", the spec bundle, Markdown, the meeting summary, JSON Canvas (`pathfinderAnswer`) and Find blocks. Attention drops an answered card and points an open one at `#inspAnswer`.
- **A refuted assumption never titles a decision**: the card becomes a decision titled with the patch's `decision` text, else "Not true: <claim>", the evidence and the old claim in `rationale` (no length cap); a verified one keeps its claim.
- **Unlabelled arrows take their meaning from the endpoint types** (`relationOf(arrow, blocks)`): one touching a goal, stakeholder, metric, risk, resource or context sets no order (`related` at a risk, `informs` otherwise); flow types, tasks and decisions keep the drawn order. The connection menus call this "Auto (label or types)". Risks print what mitigates them; a pair only an unlabelled arrow implies says "(implied by an unlabelled arrow)". Tasks nothing orders sit last, under "Not ordered by the map". Refusals name cards by title.

**Key interactions added 2026-10-03 (legibility at any zoom):**
- **Level of detail** (`lod.js`, CSS `[zoom]`): below 92% (`FULL_DETAIL_ZOOM`, where the 12px description is 11px on screen; it was 75%, which drew the type label at 8px) a card's own content goes `visibility: hidden` (never `display`: `getBlockDims` reads `offsetHeight`, and the lines are routed to it) and its face shows the type and title at screen size. The face is laid out in screen pixels (`width: calc(100% / var(--lodk))` plus `scale(var(--lodk))`) and is a size container, so its container queries measure the card on screen. Each new `--lodk` re-lays out every face (most of a frame at 300 cards), so a zooming gesture takes quarter-octave steps and settles on the 1/16-octave step once it rests (`LOD_GESTURE_STEPS`, `LOD_SETTLE_MS`). Face titles break between words only, a word too long for its line ending in an ellipsis. A card being edited keeps its content (`:has([contenteditable="true"])`). The image export draws from the state, so no band reaches it. The minimap redraws on every save (a `saveHooks` entry), since a drag ends with a save and no `pf:canvas-changed`.
- **Arrival** (`arriveAt`, `arriveAfterLoad` in `zoom-controls.js`, the one arrival): templates (`setupTemplates`, through `runTidy({ arrive })` for the large ones), anything arriving by link (`landIncoming` in `ui-panels.js`: share links, examples, the tutorial, `?src=`), the sample map, a dump of pasted notes (`{ stay: true }` keeps the camera when it is all on screen already) and a Tidy that fell back to step columns land at 100% (`ARRIVAL_ZOOM`, the 11px floor) on the entry layer instead of a whole-map fit; Shift+1 still fits everything. The margin (`ARRIVAL_PAD`) is in world pixels, and `layoutDump` sizes a dump with the same numbers. A path that loads through `applyImport` calls `arriveAfterLoad`, which runs after the import's own fit frame. The hint names `Shift+1`, or the Fit button on a touch-only device or a phone (`fitKeyName`); a toast centres in the room left of the minimap while it shows (`placeToast`).
- **Tidy** no longer animates `left`/`top`: `animateTidy` slides cards on `translate` (motion on only) while lines and frames step aside. **Focus handed back does not pan**: a card that gets focus back from a menu, the shortcut sheet, Find or a dialog, with the camera where it was when focus left it, is a return, not an arrival, so the focus-pan handler in `events.js` (`returning`) leaves the camera alone; a Tab still pans.

**Key interactions added 2026-10-04 (design round QA3):**
- **Panel tabs by key**: Alt+1/2/3 (and palette rows) show Inspector, Brief, Attention with focus on the tab (`PANEL_TABS`, `showPanelTab` in `ui-panels.js`). The Tab after an Escape that let go of the canvas goes past it (`leftCanvasByEscape` in `events.js`) instead of re-entering at the first card.
- **View-only links**: `#editCopyBtn` (Edit a copy) reopens the same link without `?readonly`, so it arrives as any share link does; an edit attempt says "View only" (`sayViewOnly`).
- **Undo instead of confirm**: `showToast(msg, type, ms, { action })` renders one action button; deleting blocks, Clear this map and Delete a map (`deleteMapWithUndo` in `library.js`) say what went and offer Undo. No native `confirm()` is left.
- **Risks hang off their source**: `defaultConnectDirection` returns `'out'` toward a risk, so a risk added from a block is not recorded as mitigated by it. Connect to ranks rows by `matchTier` (`menu.js`): label start, word start, anywhere.
- **Notes are placed with their label** (`placeLabels` tests the label plus its note box against cards; `wrapNote` lives in `arrow-labels.js`).

**Key interactions added 2026-09-28 (UI overhaul):**
- **Types**: 16 in the `TYPES` registry (`utils.js`), grouped by `TYPE_STEPS` (Why, Who, Proof, What, How, Doubt, Other; `typesByStep()`). New: `stakeholder`, `metric`, `implementation`; `terminator` reads Trigger / End. Every exporter iterates the registry, and `tests/types-registry.test.js` fails when one leaves a type out. Ids never change.
- **One type picker, one retype rule** (`type-menu.js`): the inspector's Type dropdown, Change type, the quick-add picker and the card's type check build from `typeMenuItems`; every pick goes through `retypeBlock` (clears `typeCheck` and `typeHint`, drops a colour that was only the old type's). Do not write a second picker.
- **One menu component** (`menu.js`): right-click menus for a block, a selection, a connection and the canvas (`context-menu.js`, also `Shift+F10`); header menus Maps (the breadcrumb), File, Share, Tidy direction, View, Help (`view-menu.js`), rendered in place inside the kit's overflow panel on phones. Only the trace page still uses the old `.export-dropdown` markup.
- **Editing on the card** (`inline-edit.js`): double-click, `Enter`/`F2`, `Shift+Enter` for the description; Escape commits. Double-click a line, or `Enter`/`F2` on a selected one, edits its label (`arrow-edit.js`). Double-click empty canvas opens the quick-add picker; Fit moved to `Shift+1` and the status bar.
- **Quick create**: click a port, drop a port's line on empty canvas (the same quick-add picker, `suggestedNextTypes` first), `Alt+Arrow`, `Cmd/Ctrl+Enter`.
- **Lines**: `arrow.style` is the route (`routed`, `curved`, `straight`, `elbow`) and `arrow.pattern` the dash (`solid`, `dashed`, `dotted`); a legacy `dashed`/`dotted` style loads as curved + pattern. New connections draw at `DEFAULT_ARROW_WEIGHT` (1.5); a saved arrow without a weight keeps drawing at 2 (`arrowWeight`). Labels are pills placed off bends and cards. `portsBy: 'import'` marks sides an imported file chose; Tidy and a drag release them like `tidy` pins, and a drag lands on whole pixels.
- **Motion is off by default** (`prefs.js` `motion`, View ▾ → Animate highlights): gap states and highlights are static rings at rest; with `body.motion-on` they animate only on the hovered, selected or focused card; `prefers-reduced-motion` stops everything. A gap class names its motion in `--gap-anim`, never `animation` itself; its colour is always `--attention`. Selection is the heaviest card state: a 2px accent outline on the card's edge, an `--accent-subtle` halo and an `--accent-wash` fill (shadows that hover and drag stack under); keyboard focus alone is the outline only, and Escape after a pointer selection blurs the card (`blockFocusFromPointer` in `events.js`). A selected connection is the accent too (`--edge-sel`). The gap marker draws in `--attention` and never writes: its name is `--text-1`. Card states keep their screen size zoomed out: `applyTransform` sets `--px`/`--pxn` on `#canvasRoot`, and the markers size from `--sp`/`--mk`. A stored colour near amber paints as the nearest swatch (`paintColorFor` in `cards.js`), so no card reads as a gap.
- **Gaps** (`gaps.js`): a pure `detectGaps()` plus the DOM writer `runGapDetection()`, the only writer of a card's `gi-` icon slot; one gap per block. `gapAck` accepts a gap (the inspector's Suggestions, the Attention tab) and the prompt lists it under Accepted gaps.
- **Undo carries the map settings**: every undo entry holds `cardStyle` and `spotlight` (their setters snapshot), and a replace's entry (`snapshot({ framing: true })`) holds the whole framing: title, brief, situation, prompt options. Title and brief edits take no snapshot of their own, which is why an ordinary entry leaves them alone.
- **Sharing**: new links are `#z=` (deflate-raw, base64url) carrying `?via=share`; `#s=` still decodes. A link, `?src=` or an imported file opens as a new map by default, in a real dialog; Replace keeps a named snapshot first. A modal dialog owns the keyboard: the global key handler bails on `dialog:modal`.
- **JSON Canvas and Mermaid round-trip every type**: `toMermaid` (File ▾ → Copy Mermaid, and the Markdown export's graph) writes a shape and a `class` line per type; JSON Canvas export writes each type's exact hex and `pathfinderType`. Import reads those before any guessing.

**Key interactions added 2026-10-03 (design round, one vocabulary):**
- **The header names the open map**: `Maps ▾ / <title>` sits beside the product name (`.map-crumb` in `.header-logo`); the title is 14px/600, "Untitled map" muted when empty, and renames on click, `Enter`/`F2` or Maps → Rename this map (`renameMap` in `events.js`); a keyboard commit keeps focus on it. The kit's logo block never shrinks, so `--crumb-title-max` (style.css `[consistency]`) is the only thing keeping the bar on one row: GitHub moves into Help under 1100px, Maps is its icon under 860px, and on phones under 433px the title waits until Rename opens it. Never hide or restyle the kit's `h1`: site header changes are skin tokens only. `tests/consistency.test.js` sweeps the widths.
- **Header buttons are ghosts on the app page only** (`[data-pf-bar="app"]` on index.html's `<header>`): trace.html and the doc pages keep their boxed buttons until they move to the same vocabulary.
- **One filter control** (`filter-menu.js`), **neutral toasts** (a status icon, the text in `--text-1`), **the Session timer** hidden until View → Facilitation shows it (prefs `sessionTimer`), **the palette rail** once a map has content (until the person picks), and **the inspector as a property sheet**: multi-line content full width with its label above, short values in an 88px label column; per-type example placeholders led by "e.g.", never an ellipsis.
- **One icon set**: stroked, a 16px grid, a 1.5px stroke, in menus (`menu.js` check and chevron), the header and the inspector.

**Key interactions added 2026-08-24 (async review):**
- **Review on the view-only link** (`js/review.js`, `#reviewBar`, readonly only, never embed): select a block, leave a note, repeat; "Copy review patch" emits a standard `pathfinder-patch` with the new `notes` op. The author pastes it into the Brief tab's Bring the reply back; notes land appended to `block.notes` prefixed `Review:`, previewed and one-undo like every patch. No server, deliberately: this is the alternative to realtime multiplayer, not a step toward it.

**Key interactions added 2026-08-24 (user templates):**
- **Save canvas as template** (foot of the Templates palette section): captures the live canvas into `pathfinder-templates` (max 12) in the exact shape built-ins use, positions normalised, arrows re-indexed, criteria/questions/situation/mode riding along; `applyTemplate` now carries `criteria`, `rationale`, `status` and `questions` for any template that has them. User templates render after the built-ins with a delete ×. Templates travel between browsers as canvases (export the canvas, import, save as template).

**Key interactions added 2026-08-24 (snapshots, per-map camera):**
- **Map snapshots** (`library.js`): Maps ▾ → "Snapshot this map" keeps a full copy under `pathfinder-snaps-<mapId>` (max 8, oldest dropped); the Snapshots submenu lists each with `fmtWhen` and a since-then diff (`diffPayloads`: ±blocks, changed, ±arrows); restoring auto-snapshots the pre-restore state first. Applying a patch auto-snapshots as "Before the patch": Cmd+Z covers the session, the snapshot covers next week.
- **Per-map camera**: the view persists under `pathfinder-view:<mapId>`, the map this tab has open (`mapIdHooks` in `state.js`, answered by `library.js` `currentId`) (legacy `pathfinder-view` is a read fallback); switching maps restores the target's camera and skips the fit (`applyImport(data, mode, { fit })`).
- **The test suite no longer clobbers the live canvas**: `run-tests.html` snapshots every `pathfinder-*` localStorage key before importing test modules and restores them after the run (and on pagehide).

**Key interactions added 2026-08-24 (interop):**
- **JSON Canvas in and out, Mermaid in** (`js/interop.js`). The Import picker detects the format; a node with no type signal goes through the line classifier, and a low-confidence call is marked `typeCheck` for the card's type check (the `pf:show-type-chips` event still carries them; `applyImport` returns `idMap` so they survive a merge remap). Mermaid positions come from `layoutGraph`, not a guess.

**Key interactions added 2026-08-24 (the round trip):**
- **`pathfinder-patch`** (`js/patch.js`, spec in `llms.txt`): every prompt now ends with `## When you reply` plus a block-id map, asking the assistant to close with a fenced patch: answers into questions, assumptions verified/refuted **into decisions in place** (same id, arrows survive, evidence lands in `rationale`), status, criteria, new wired blocks. Brief tab → "Bring the reply back" (Paste a reply) takes the whole reply, previews every operation (fuzzy title matches labeled, ambiguity refused), applies as **one undo step**.

**Key interactions added 2026-08-24 (agent channel):**
- **`validate.mjs`**: Node CLI over the app's own `normalize.js` (fetched from the live site when run standalone), naming every dropped or coerced item. Exit 0 clean / 1 items dropped or coerced / 2 unreadable. The write-back contract's proof step; documented in `llms.txt`.
- **`?src=<https url>`** loads canvas JSON from a URL (proctor's pattern): https or same-origin only, 1 MB cap, GitHub raw/gist whitelisted in the CSP `connect-src`, the same new-map, replace or merge dialog as `#s=`, URL cleaned via `replaceState` either way (`checkSrcUrl` in `ui-panels.js`).
- **Arrival counting** is kit-owned: the header kit's `shareArrivalLabel` pattern covers `#s=` since 2026-08-24 (the site-local `js/arrival.js` stopgap was retired the same day to avoid double counting). It does not match `#z=`, so the app's links also carry `?via=share` (embeds `?via=embed`), which the kit counts; the canonical fix is the kit's regex in `packages/neorgon-ui/header`.
- **`pathfinder` skill** lives in `neorgon-forge` (`skills/before/pathfinder`): reads a canvas or brief, writes back a validated canvas or share link.

**Key interactions added 2026-08-24 (tidy pins, pill, maps):**
- **Tidy port pins carry provenance** (`portsBy: 'tidy'`). Tidy never overwrites a hand-pinned side; a same-layer edge gets perpendicular geometry ports (not bottom→bottom); a backward edge keeps the under-detour only when `routed`, other styles go back to auto; dragging a block releases tidy pins on its arrows (`releaseTidyPins` in `layout.js`, called from the drag pointerup). Pins matching the pre-provenance scheme are adopted and healed on the next Tidy.
- **Copy brief** lives in the bottom canvas utility bar alongside zoom and save status. It uses a standard copy icon with inline confirmation. Zen (`Z`) hides the bar. The older floating pill and its `pathfinder-pill` setting have been retired.
- **Maps** (the header breadcrumb `Maps ▾ / <title>`, `library.js`): several canvases per browser. Active map stays in `pathfinder-v1`; switching flushes, loads through `applyImport('replace')` and clears the undo stack. New / duplicate / delete / export-all / import-all. Hidden in readonly and embed.
- `portPos` returns whole pixels, killing half-pixel jogs in routed paths.
- **Acceptance criteria + decision rationale + Spec bundle**: `block.criteria[]` (requirement/goal/output) and `block.rationale` (decision) edit in the inspector, feed the prompt (Build's `[NEEDS INPUT]` placeholder only appears when criteria are missing), the Markdown export, and **File ▾ → Download Spec bundle (zip)**: spec/plan/tasks/EARS-requirements built by `spec-export.js`, zipped by `zip.js`.
- **Prompt options travel with the canvas** (`meta.prompt`). `serializeCanvas()` in `state.js` is the single serializer (autosave, share, Maps, JSON export); `applyPromptOpts()` applies a load back into `devOpts`; the `pf:prompt-opts-changed` event resyncs the Brief tab (`syncPromptOptControls`). Presets (Build in Claude Code, Build in Cursor, TypeScript, Clarify in a chat) set the bundle in one click, Running in included (`PRESETS`, `applyPreset` in `ui-panels.js`). The tutorial example carries `mode: investigate`. `flowSection()` orders workflow steps by whole-graph layering and numbers only process steps.

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
- **Card presets** replace the fixed left stripe: `outline` (default), `header`, `tint`, `plain`. `bar` (the old 3px side stripe) is retired (`retired: true` in `CARD_STYLES`): no menu offers it, `drawnCardStyle` draws it as `outline`, and `normalize.js` still accepts it so old maps round-trip. Per block via the inspector, canvas-wide via **View ▾ → Card style** (`canvasMeta.cardStyle`, so it travels through share links and JSON export, and one undo step).
- **`H` hides the header and footer, `Z` hides the panels too** (`chrome.js`, persisted). Both stay live in read-only and embed views. `Alt+H` is still high contrast.

**Key interactions added 2026-07-01:**
- Multi-line descriptions render with `escHtmlMultiline` + `white-space: pre-wrap` (newlines preserved on the card and in exports).
- Right-click any block for a quick-action menu (`context-menu.js`); also `Shift+F10`/ContextMenu key on the selected block.
- Arrows carry an optional `note` (richer than `label`), hidden until hover/selection, or always shown via **View ▾ → Always show connection notes** (`ui.showArrowText`, persisted `pathfinder-arrowtext`, body class `show-arrow-text`).
- Right panel collapses via a chevron (persisted `pathfinder-panel-collapsed`).
- File ▾ → **Download image (PNG 2×)** / **Download vector (SVG)** redraws the canvas as a self-contained SVG (`image-export.js`) to the card and line specs. No DOM screenshot.
- Pasted notes fold indented/bulleted lines into the parent block's description (the notes field's toggle), or its criteria under a prefixed requirement or metric; `parseOutline()` in `classify.js`.
- The Brief tab shows a one-line description of the selected mode (`refreshModeDesc` in `ui-panels.js`).
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

**Pages:** `index.html` (the app) · `tutorial.html` (walkthrough; example loads via `js/tutorial-example.js`; a notes, map, brief strip drawn by `make assets`) · `examples.html` (one column by job: the checkout example, Inherit a Codebase, Migrate a System and Recurring Reporting Flow, with the blank Investigate a Bug template as a link; each with its picture and brief excerpt from `make assets`, converted by `js/examples-page.js` (`EXAMPLES`, `payloadFor`, `templateToPayload()`) and loaded through the share hash, so gallery content can never drift from the app's own) · `404.html` (on tokens, three ways on).

**📖 Read `docs/references/internals.md` before changing code in** `doc-panel.js` (Living Documentation, docRef, fetch gating/CSP, "See:" promotion, live questions), `canvas.js` (pan/zoom, ports, Bézier routing), or `prompt.js` (per-mode prompt generation, the pasted-notes classifier, prompt options). It also holds the full **Key Functions Reference** (per-module function lookup).

---

## State

**localStorage key:** `'pathfinder-v1'` (the **active** map). The canvas library keeps
`'pathfinder-maps'` (index), `'pathfinder-map-<id>'` (one payload per map) and
`'pathfinder-map-current'` (active id), `'pathfinder-snaps-<id>'` (snapshots, max 8)
and `'pathfinder-view:<id>'` (per-map camera); `saveState()` write-through hooks
(`saveHooks` in `state.js`, registered by `library.js`) mirror every autosave into
the active map's slot. The legacy `'pathfinder-pill'` setting is no longer used.

Per-browser view settings: `'pathfinder-minimap'` (the minimap on or off),
`'pathfinder-palette-recent'` (the command palette's Recent, never a danger,
template or search-only row), `'pathfinder-palette-collapsed'` (absent means
automatic: the palette folds to its rail once a map has content until the person
picks), and `'pathfinder-prefs'` (`motion`, `sessionTimer` for View ▾ →
Facilitation, among others). The Brief tab's Framing is never persisted: it always
opens closed.

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
      actions: [],                   // 'resolve' | 'prepare' | 'recollect' | 'reinforce' | 'validate' (the UI says Look back and Strengthen for the middle two: ACTION_LABELS)
      questions: [],                 // [{ text, answer?, askedAt? }]: see Living Documentation
      docRef: null,                  // { href, label, anchor } | null: see Living Documentation
      cardStyle: null,               // preset key | null = follow canvasMeta.cardStyle
      criteria: [],                  // acceptance criteria (requirement/goal/output); feeds prompt, tasks.md, EARS
      rationale: '',                 // why a decision was made (decision blocks); no length cap
      answer,                        // an Open Question card's own answer (written only with text); marks it done
      borderWidth: null,             // 1 | 1.5 | 2 | 3 | null = preset default
      highlight: null,               // presentation emphasis | null. Never semantics
      typeCheck,                     // true: a guessed type (pasted notes without a prefix, a low-confidence import), not confirmed yet
      gapAck,                        // gap ids the author accepted: ['gap-no-criteria', ...]
      typeHint                       // the original type when this build did not know it (kept as custom)
    }
  },
  arrows: [{
    id, from: blockId, to: blockId,
    style,                           // route: 'routed' (default) | 'curved' | 'straight' | 'elbow'
    pattern,                         // 'solid' (default) | 'dashed' | 'dotted'
    weight,                          // new: DEFAULT_ARROW_WEIGHT (1.5); missing = 2 (older maps)
    relation,                        // 'precedes' | 'depends-on' | 'blocks' | 'informs' | 'related' | null = Auto (a known label, else the endpoint types)
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

16 types in the `TYPES` registry (`utils.js`), in the order the palette, the pickers and every exporter read them: grouped by the question each answers (`TYPE_STEPS`, `typesByStep()`). Each has a colour for each theme (OKLCH `--c-<id>` in `style.css`, the same as hex in `TYPES`, plus `legacyColors` that `interop.js` still reads) and a dot `shape` by the step's role (ring Why/Who, square What/Proof, dot How/Other, diamond Doubt); the card shows it as an 8px dot beside a neutral label and a quiet edge, never as label text or a state. DESIGN.md "Type palette" has the values and the distances. The palette shows all 16 grouped by step; `tier` (core / more) decides what the canvas menu's Add here lists before **More types**. No type is ever removed (deleting a type would drop existing blocks via `normalize.js`), and ids never change, only labels. The README's table is the reader's copy; this is the shape:

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

`detectGaps(blocks, arrows)` in `gaps.js` is pure (no DOM); `runGapDetection()` runs it on every canvas change and paints the result: one gap class per card (a dashed `--attention` ring 3px out, the card's `::after`) and a corner badge with the line icon (`gapIconFor`) and its name in the card's `gi-<id>` slot. Gap branches are **mutually exclusive**: a block reports exactly ONE gap, isolation first, then the rules in this order (a type rule applies only to a *connected* block):

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

`GAP_META` is the single label source for the prompt, the card tooltip and the Attention tab (the Brief tab's readiness line counts the Attention tab's own items). `getGapFixes(b)` offers the fixes (each carries the `gap` it answers; `create: { type, dir }` fixes go through `applyGapFix`). **Accepting a gap** (`acceptGap`, the inspector's Suggestions or the Attention tab) adds it to `block.gapAck`: it stops being reported, and the prompt lists it under "Accepted gaps" while its rule still holds.

Canvas findings (`findings`, per canvas rather than per block, in the Attention tab and the prompt): dependency cycles, empty groups, untyped blocks, no Goal or Problem, goals with no metric, metrics no work moves, likely duplicates, a question hidden in a description, types awaiting a check. The last four named can be accepted per block (`acceptFinding`).

Gap states are a static ring at rest; they animate only with View ▾ → Animate highlights on, and only on the card in front of you (see the motion note above).

---

## Export / Import

From **File ▾** in the header (the rows are hidden buttons in `#fileActions`; `view-menu.js` renders them through menu.js, and `data-readonly="ok"` keeps a row on view-only links):

| Action | Output |
|--------|--------|
| Import JSON / Canvas / Mermaid | One picker, format-detected (`detectFormat`): pathfinder JSON, JSON Canvas, or a Mermaid flowchart. Opens as a new map by default; Replace (after a named snapshot) and Merge are the dialog's other choices (`sharing.js`) |
| Copy brief | Clipboard: the whole map's brief, through the Brief tab's own Copy (`pf:copy-brief`), with its "Copied: about N tokens, M sections" confirmation; `Cmd/Ctrl+Shift+C` |
| Copy AI diagram-builder prompt | Clipboard: `DIAGRAM_BUILDER_PROMPT`, generated from the registry |
| Download JSON | `pathfinder.json`: full canvas (blocks + arrows + meta + timestamp) |
| Download Markdown | `pathfinder.md`: a section per block type (**every** type: leaving one out of the order silently drops those blocks), labelled connections, and the Mermaid graph |
| Copy Mermaid | Clipboard: `toMermaid()`, the same graph: every block declared, a shape and a `class` line per type, groups as subgraphs |
| Download JSON Canvas | `<title>.canvas` (jsoncanvas.org): each node in its type's exact hex plus `pathfinderType` (and `pathfinderAnswer` for an answered question card), criteria as checklists, groups as group nodes, edge sides from pinned ports |
| Download spec bundle (zip) | `pathfinder-spec.zip` (`js/spec-export.js` + the zero-dependency STORE zip writer `js/zip.js`): README, spec.md, plan.md, tasks.md (dependency-ordered), requirements.md (EARS). Missing inputs emit `[NEEDS INPUT]`, never guesses |
| Download image / vector | PNG 2x / SVG from `image-export.js` |
| Export meeting summary / Open in Presentation Sage | Hand-offs; both write an action by its word (Look back, Strengthen), the prompt by its id |
| Clear this map… | Danger; one undo step |

Import reads a type before it guesses: `pathfinderType`, an exact type hex, a Mermaid `class` line, then the shape, and only then the classifier (`categorizeLine`), whose low-confidence calls are marked `typeCheck`.

**Merge behavior:** existing blocks preserved; imported blocks get new IDs, arrow refs remapped.

---

## Keyboard Shortcuts

`SHORTCUTS` in `ui-panels.js` is the canonical list (the `?` sheet renders it, grouped Creating, Editing, Navigation, View). It is a hand-kept array, not derived from the handlers, so a binding added anywhere (`events.js`, `inline-edit.js`, `arrow-edit.js`, `context-menu.js`, `classify.js`, `command-palette.js`, `type-keys.js`, `start-panel.js` (1, 2, 3), `minimap.js` (M), `brief.js` (Cmd/Ctrl+Shift+C)) has to be added there too; `tests/integration.test.js` checks the ones bound outside `events.js`. A row's optional third element `{ top, short, key? }` puts it in the sheet's "Most used" dozen (`topShortcuts()`; `key` is a shorter key text where the full one would wrap there); the sheet opens on those and the type letters, the rest behind "All shortcuts". `TYPE_KEYS` (same file) is the letter after N for each type: one per type, none shared, and every new type needs one (`tests/command.test.js`).

**Command palette** (`command-palette.js`, rows from `command-items.js`, one row's markup in `command-rows.js`): `Cmd/Ctrl+K` anywhere (while typing too, never over another modal dialog), `/` on the canvas opens it at Create, and `/ > # @` typed first narrow it to Create, Actions, Blocks or Maps. Every row comes from a builder the menus already use (`fileMenuItems`, `viewMenuItems`, `helpMenuItems`, `mapsMenuItems`, `selectionMenuItems` in `context-menu.js`, the templates list), so a new menu row is in the palette with no extra work; a submenu becomes a row you drill into. Its own rows add Find, Undo, Tidy, the zoom keys, "Copy brief for the selection" (with a selection) and "Open the sample map". It matches labels only, never hints; equal matches keep their built order. Recent never stores a danger row, a template (`noRecent`) or a search-only row, and the Selected group sits above it, so Enter on a fresh palette never deletes or re-applies. The chord is Cmd+K on a Mac and Ctrl+K elsewhere (Ctrl+K on a Mac is a text field's delete to end of line). Help ▾ → Command palette is the way in without a keyboard. It is a modal `<dialog>`, so `events.js` bails while it is open, and its field stops every key it handles from reaching the canvas: the Escape that closes it must not also deselect. **N, then a letter** (`type-keys.js`) adds that type at the pointer or the centre; the key after N is N's (a capture listener wired before the palette's), so after N, T is not the type check, L is not Tidy and neither / nor Cmd/Ctrl+K opens the palette; a held N's auto-repeat keeps it armed. In Connect to, the menu search is titles only (`matchHints: false`) and Enter with nothing typed picks nothing (`pickOnEmpty: false`); menu.js marks the row Enter will pick (`.pf-menu-match`).

How the handler is layered (`setupKeyboardShortcuts` in `events.js`): a modal dialog bails everything; `Cmd/Ctrl+F` works anywhere; nothing below fires while typing; `?`, `Alt+H` and the View keys (`H`, `Z`, zoom, `Shift+1/2/0`) work in read-only and embed; single-letter keys act only while the canvas (or nothing) has focus, and `Cmd/Ctrl + = - 0` zoom the canvas only then, leaving page zoom alone elsewhere; editing keys stop at the read-only bail.

---

## CSS Class Patterns

- `.block[data-type=goal]`: type-specific styling; `--bc` is the type colour
- `.block.selected` (an accent outline on the edge plus a halo, over every state) · `.block.dragging`
- `.block.gap-*`: one per block (see Gap Detection); every gap, isolation included, is the `::after` dashed ring in `--attention` plus the `.block-gap-icons` corner badge; motion from `--gap-anim`
- `[data-shape=ring|square|diamond]` on any type dot (`.block-type-dot`, `.palette-dot`, `.pf-menu-dot`, `.insp-dot`, `.sheet-dot`) · `.chip` (neutral priority, status and action chips)
- `.block.type-check` · `.block-type-check`: a type awaiting confirmation (the label is a button, `T` opens it)
- `.block[data-card=outline|bar|header|tint|plain]`: card preset
- `.block[data-highlight=alert|focus|go|hold|festive]` + `.block-hl-tab`: presentation ring and its word
- `body.motion-on`: View ▾ → Animate highlights; `body.spotlight`: fade every block without a highlight
- `.port-left` · `.port-right` · `.port-top` · `.port-bottom` · `.arrow-handle`
- `.canvas-root.tidy-glide`: transient, slides cards on `translate` to their Tidy positions (Animate highlights only)
- `.canvas-root.lod-full|lod-title|lod-pill|lod-dot` (+ `lod-quiet-labels` under 92%, `--lodk` the face scale) · `.block-lod`: the card's small-zoom face
- `body[data-chrome=off]` · `body[data-zen=on]`: expanded view
- `.pf-menu` (+ `.pf-submenu`, `.pf-header-menu`, `.ctx-*-menu`, `.insp-type-menu`, `.type-check-menu`): menu.js menus; `.type-menu-notes` / `.type-menu-note` the type lists' foot
- `.panel-tab.active` · `.tab-pane.active` · `.action-toggle.active`
- `.brain-dump` / `.start-*` (the start panel, `.start-pill` its first-block pills) · `.brief-*` (the Brief tab) · `.cmdk-*` (the command palette) · `.minimap` · `.map-crumb*` (the header's `Maps / <title>`) · `.toast-in-canvas` (a toast placed over the canvas)
- Each stream's rules sit in its marked section at the end of `style.css`; a later section overrides an earlier base rule on the same selector, and no two stream sections style the same selector

---

## Design Tokens

`DESIGN.md` is the visual system (added 2026-10-03, design round): OKLCH tokens for both themes with measured contrast, one violet accent, `--attention` for gaps only, the type scale (11px floor), the `.btn` / `.input` controls. The values live in `css/style.css` blocks marked `tokens:start` / `tokens:end`; no hex or `rgb()` outside them (`tests/design-tokens.test.js` fails on one). Derived tokens are declared on `body`, not `:root`, or they freeze at the dark values. Legacy names (`--text-primary`, `--border-subtle`, `--accent-bright`) map onto the new ones. The header uses the kit's `custom` skin (tokens only): near-black in dark mode, light in light mode.
