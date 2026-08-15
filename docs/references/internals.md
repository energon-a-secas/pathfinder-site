# Pathfinder Internals (Level 2 reference)

> Moved verbatim from `CLAUDE.md` during a progressive-disclosure pass. These are the deep
> per-subsystem details you only need when editing that specific module. Read the relevant
> section **before changing code** in `doc-panel.js`, `canvas.js`, or `prompt.js`, or when you
> need the full function-name lookup.

## Living Documentation

Wire a block to an external doc, preview it inline, and turn its questions into grounded AI prompts. Lives in **`js/doc-panel.js`**.

**`docRef` = `{ href, label, anchor }`** — editable in the inspector's **Documentation** section. `href` may be a full URL or a root-relative path; `anchor` is a fragment (stored without `#`). A block with a docRef shows a 🔗 badge in its header (click → doc preview popup).

**Inline doc preview** (`openDocPopup`): a floating popup fetches and renders the referenced doc read-only. **Fetch is gated for security** — `resolveDocRef()` only marks a doc *fetchable* when it's same-origin **or** under the user-configured **docs base URL** (Prompt → Dev Options, localStorage `pathfinder-docs-base`). Anything else degrades to an "Open in new tab ↗" link, no request made. Fetched Markdown is HTML-escaped before a tiny inline renderer (`renderMarkdown`) promotes it — doc content can never inject markup. HTML pages degrade to a link. **CSP note:** an external docs base must also be added to `connect-src` in `index.html`'s CSP meta (same-origin works out of the box).

**"See: X" promotion** (`detectSeeReference`): a trailing `See: <target>` line in a description is detected; the inspector offers a one-click button to promote it into a real `docRef` (URL/`/path` → `href`, otherwise → `label`). Existing canvases upgrade cleanly with no auto-mutation.

**Live questions:** per-block questions carry an optional `answer`. Each question row has an **Ask** button (`askQuestion` → `buildQuestionPrompt` in `prompt.js`) that copies a focused, grounded prompt (the question + block + its docRef + 1-hop arrow neighbors + `canvasMeta.contextBrief`). Paste the answer back into the answer field; a ✓ badge appears on the block and the answer flows into the main prompt export as Q/A. **The no-provider path is the product** — a live-AI call is intentionally scaffolded-but-disabled (no secrets, no third-party calls shipped).

---

## Canvas System

- `.canvas-viewport` → overflow-hidden, captures pointer events for pan/zoom
- `.canvas-root` → transformed child (CSS translate + scale), holds blocks and arrows
- Dot grid: radial gradient at 28px spacing, follows pan and zoom
- Arrows: SVG layer (`.arrows-layer`) behind blocks. Default style is `routed` (orthogonal, obstacle-avoiding); several arrows on one side get separate lanes
- `MIN_ZOOM = 0.18`, `MAX_ZOOM = 2.6`

**Key canvas functions:**
- `applyTransform()` — applies pan + zoom CSS transform, and debounce-saves the camera
- `fitView()` — auto-centers and scales to show all blocks
- `toWorld(vx, vy)` — converts viewport coords to world coords
- `portPos(id, port, index = 0, count = 1)` — `{x, y, dir}` for a port. With the default index/count it is the exact side midpoint; with `count > 1` it is that lane's slot along the side, inset 14px from the corners.
- `bestPorts(fromId, toId, fromPort, toPort)` — resolves *which sides* an arrow uses. Pinned ports stay put, unpinned sides auto-route by box position (`autoPorts` is the position-based fallback). The header "Pin ports" toggle (`ui.pinPorts`, default ON, persisted) controls whether new connections pin the port the user drew from.
- **`resolveRoutes({ cheap })` — the single source of arrow geometry.** Both `renderArrows()` and the SVG exporter call it, which is what keeps an exported diagram identical to the one on screen. It resolves sides, buckets endpoints by `(block, side)`, orders each bucket by where its far end sits (so lanes fan out without crossing), assigns lane coordinates, and routes `routed` arrows. `cheap: true` skips the router; `renderArrows` passes it automatically while `pointer.ix` is set, and `events.js` re-renders once on pointerup.
- `pathFor(pts, style)` — the path string for one resolved arrow. `routed` uses the router's polyline; everything else falls through to `buildPath`.
- `buildPath(x1,y1,d1,x2,y2,d2,style)` — the primitive shapes. `curved` is a cubic Bézier with a 55–130px control offset. `elbow` reads **both** end directions: two bends when the ends share an axis, one when they do not.
- `colorMarker(color, back)` — mints an arrowhead marker per colour on demand. The ten markers in `index.html` bake their fill in, so a recoloured arrow used to keep a white head.

**Routing (`route.js`).** Pure geometry, no DOM, no app state. `routeOrtho(pts, obstacles, opts)` stubs 22px off each port, builds a lattice from every obstacle's inflated edges plus the stub coordinates, and runs A* over it. Cost is length plus a 45px penalty per direction change, so it buys straightness rather than the shortest path. State is `(node, incoming direction)` because the turn penalty makes cost path-dependent.

Three behaviours worth knowing before changing it:
- **It excludes obstacles that already contain a stub.** Such a block cannot be routed around; every edge in or out of that endpoint would be impassable and the search would fail outright, leaving the arrow undrawn.
- **It declines rather than churning.** Past `maxNodes` it returns `null` and the caller falls back to `elbow`.
- **Routes are cached** against a fingerprint of every block's box, so panning and selecting recompute nothing.

**Auto-layout (`layout.js`).** `layoutGraph(nodes, edges, opts)` is pure: sizes in, positions out. Four stages — break cycles (DFS, reverse back edges), assign layers (longest path, then a tightening pass that pulls dangling inputs next to what they feed), order within layers (median heuristic, alternating sweeps, keeping the best ordering rather than the last), assign coordinates (stack by measured size, then straighten toward neighbour medians). Unconnected blocks are parked in a trailing lane. `tidyCanvas()` is the app wrapper: it takes **exactly one `snapshot()`**, so one Cmd+Z restores the whole arrangement.

Two constraints the layout has to live with: **block heights are never stored** (`getBlockDims` measures the live DOM), so layout cannot run headlessly; and pinned `fromPort`/`toPort` values would fight a new arrangement, so `tidyCanvas` rewrites them along the flow.

---

## AI Prompt Generation

`generatePrompt()` builds a structured markdown prompt from canvas state.

**Prompt H1 is the canvas title** (`canvasMeta.title`), and an optional **`## Engagement Context`** section (`canvasMeta.contextBrief`, edited at the top of the Prompt pane) opens the body — both round-trip through save/import/share.

**Section order is per-mode** (`ORDERS` in `prompt.js`). The four modes now produce genuinely different bodies:
- **Plan** — Context → Goals → Problems → Requirements → Assumptions → Risks → Questions → Decisions → Resources → Outputs → Custom
- **Explore** — front-loads Assumptions + Questions before everything else
- **Build** — renders Requirements and Outputs as `- [ ]` task checklists (priority then incoming-arrow ordering); requirements without acceptance criteria emit `[NEEDS INPUT: acceptance criteria]` + a "do not invent — ask first" rule; drops framing-only types
- **Clarify** — leads with Questions + Assumptions; suppresses the implementation dev-option modules

An **Assumptions** section ("validate before building") carries a standing directive telling the AI to treat each assumption as believed-true-until-disproven. Trailing: Connections → Groups → Action Labels → Gap summary.

**Always-visible pill:** a "Copy AI-ready prompt" pill + plain-language readiness verdict sit in the canvas bottom-right (`#copyPillWrap`). The verdict is a pure function of `computeHealthScore()` + gap count; non-green copies prompt "Copy anyway?". The pill copies via the same `markExported()` path as the panel button so the diff tracker stays in sync, and refreshes on the `pf:canvas-changed` event.

**Brain Dump empty state:** when the canvas is empty (and not read-only/embed), a Brain Dump card replaces the text hint. `createBlocksFromText()` (shared by paste + Brain Dump) runs a sentence-level scoring classifier (`categorizeLine` in `events.js`) that strips a leading first-person/article prefix and scores against weighted keyword sets, so natural prose lands on a real type. Each imported block gets a sibling type-correction chip in `canvasRoot` (low-confidence blocks flagged with an amber dashed outline); chips dismiss on the next canvas pointerdown.

**Dev options** (right panel "Prompt" tab):
- Tone: Auto / Formal / Casual / Technical
- Detail: Brief / Standard / Detailed
- Pre-prompt modules: tasks + acceptance criteria, edge cases, error handling, docs, security, TypeScript types

Prompt is cached; `promptDirty` flag triggers re-generation only when canvas changes.

---

## Key Functions Reference

**`js/state.js`:** `genId()` · `saveState()` · `loadState()` · `mutateBlock(id, changes)` · `createBlock(type, wx, wy)` · `deleteBlock(id)` · `duplicateBlock(id)`

**`js/canvas.js`:** `applyTransform()` · `fitView()` · `toWorld(vx, vy)` · `portPos(id, port, index, count)` · `bestPorts(fromId, toId)` · `resolveRoutes(opts)` · `pathFor(pts, style)` · `buildPath(...)` · `colorMarker(...)` · `renderArrows(opts)` · `updateHint()`

**`js/route.js`:** `routeOrtho(pts, obstacles, opts)` · `polyToPath(points, r)` · `polyMidpoint(points)` · `simplify(points)`

**`js/layout.js`:** `layoutGraph(nodes, edges, opts)` · `tidyCanvas({ direction })` · `breakCycles()` · `assignLayers()` · `orderLayers()`

**`js/align.js`:** `findGuides(moving, statics, tol)` · `guidesForDrag(ids)` · `alignSelection(ids, mode)` · `distributeSelection(ids, axis)`

**`js/chrome.js`:** `toggleChrome()` · `toggleZen()` · `setupChrome()`

**`js/render.js`:** `renderBlock(id)` · `renderAllBlocks()` · `renderInspector()` · `updateCanvasTitle()` · `selectBlock(id)` · `selectArrow(id)` · `deselectAll()`

**`js/gaps.js`:** `runGapDetection()`

**`js/prompt.js`:** `generatePrompt()` · `refreshPrompt()`

**`js/utils.js`:** `escHtml(s)` · `clamp(v, lo, hi)` · `debounce(fn, ms)` · `getBlockEl(id)` · `getBlockDims(id)` · `CARD_STYLES` · `BORDER_WIDTHS`

**`js/state.js`:** `snapTo(v, grid)` rounds half **away from zero**, so the grid behaves the same above and below the origin (`Math.round` breaks halves toward +Infinity, which made -14 and +14 snap differently).
