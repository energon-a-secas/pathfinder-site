# CLAUDE.md — Pathfinder

Visual strategy canvas for planning, gap detection, and AI prompt export.

**Live:** pathfinder.neorgon.com
**Run:** `python3 -m http.server` from `pathfinder-site/`, or open `index.html` directly.

---

## Architecture

Multi-file layout. No build step, no dependencies. Uses native ES modules (`<script type="module">`).

| File | Lines | Role |
|------|-------|------|
| `index.html` | ~328 | HTML shell + OG meta |
| `css/style.css` | ~941 | All CSS, variables, animations |
| `js/app.js` | ~65 | Entry point — imports all modules, calls `init()` |
| `js/state.js` | ~78 | State shape, `loadState()`, `saveState()`, `mutateBlock()` |
| `js/utils.js` | ~78 | `genId()`, `escHtml()`, `clamp()`, `debounce()` |
| `js/canvas.js` | ~165 | Pan/zoom, `applyTransform()`, `fitView()`, `toWorld()`, port/path logic |
| `js/gaps.js` | ~59 | `runGapDetection()` — appends gap CSS classes |
| `js/prompt.js` | ~137 | `generatePrompt()`, `refreshPrompt()` |
| `js/render.js` | ~317 | `renderBlock()`, `renderAllBlocks()`, `renderInspector()` |
| `js/events.js` | ~367 | Canvas pointer, keyboard shortcuts, palette, inspector events |
| `js/ui-panels.js` | ~306 | Export, share, search, panel tabs, dev options, header buttons |

**JS modules:** `app.js` · `state.js` · `utils.js` · `canvas.js` · `render.js` · `events.js` · `gaps.js` · `prompt.js` · `ui-panels.js` · `export.js` · `templates.js`

**Required assets:** `index.html` · `css/style.css` · `js/*.js` · `favicon.ico` · `energon-classic-logo.png` · `og-preview.jpg` · `CNAME`

---

## State

**localStorage key:** `'pathfinder-v1'`

```js
state = {
  blocks: {
    [id]: {
      id, type, title, description, notes,
      x, y,                          // pixel position in canvas world
      actions: [],                   // 'resolve' | 'prepare' | 'recollect' | 'reinforce'
      questions: []                  // open question strings
    }
  },
  arrows: [{ id, from: blockId, to: blockId }]
}

view = { panX, panY, zoom }          // zoom range: 0.18–2.6
```

Auto-saved via `debouncedSave()` (300ms) on every change.

---

## Block Types

11 types defined in the `TYPES` constant. Each has a unique left-border color. The palette surfaces a **Core 6** by default; the rest live behind an "Advanced types" expander (`#advancedBlocks`) — but all 11 are fully usable and no type is ever removed (deleting a type would drop existing blocks via `normalize.js`).

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
| context | #64748b (slate) | --c-context | Advanced |
| custom | #c084fc (fuchsia) | --c-custom | Advanced |

**assumption vs question:** an Assumption is a belief treated as true without validation (default `validate` action; feeds an "Assumptions (validate before building)" prompt section the AI is told to pressure-test). A Question is a genuine unknown. A question's inspector shows a "Promote to Assumption" button.

---

## Canvas System

- `.canvas-viewport` → overflow-hidden, captures pointer events for pan/zoom
- `.canvas-root` → transformed child (CSS translate + scale), holds blocks and arrows
- Dot grid: radial gradient at 28px spacing, follows pan and zoom
- Arrows: SVG layer (`.arrows-layer`) behind blocks; cubic Bézier paths with smart port selection
- `MIN_ZOOM = 0.18`, `MAX_ZOOM = 2.6`

**Key canvas functions:**
- `applyTransform()` — applies pan + zoom CSS transform
- `fitView()` — auto-centers and scales to show all blocks
- `toWorld(vx, vy)` — converts viewport coords to world coords
- `portPos(id, port)` — returns `{x, y, dir}` for a port on a block
- `bestPorts(fromId, toId, fromPort, toPort)` — resolves endpoints; **pinned ports stay put, unpinned sides auto-route** by box position (`autoPorts` is the position-based fallback). Arrows store `fromPort`/`toPort` (null = auto). The header "Pin ports" toggle (`ui.pinPorts`, default ON, persisted) controls whether new connections pin the port the user drew from; the arrow inspector has an "Auto-route this connection" reset.
- `buildPath(x1,y1,d1,x2,y2,d2)` — builds SVG cubic Bézier; control offset 55–130px

---

## Gap Detection

`runGapDetection()` runs automatically on every canvas change. Gap branches are **mutually exclusive** — a block reports exactly ONE gap (isolation wins outright; type-specific gaps only apply to *connected* blocks wired wrongly):

| Class | Meaning | Trigger |
|-------|---------|---------|
| `gap-isolated` | No connections at all | Block has 0 incoming + 0 outgoing arrows (checked first; short-circuits) |
| `gap-assumption` | Unvalidated assumption | **Connected** assumption-type block not linked to a Goal/Requirement and without a `validate` action |
| `gap-no-req` | Goal without requirements | Connected Goal block has no arrow to a Requirement |
| `gap-unaddressed` | Ignored problem | Connected Problem block lacks "resolve" action and has no outgoing arrows |

Gap icons pulse (1.8–2.5s animation) in the block header.

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

## Export / Import

Accessed via "Export ▾" dropdown in the header:

| Action | Output |
|--------|--------|
| Copy Prompt | Clipboard — markdown AI prompt |
| Download JSON | `pathfinder.json` — full canvas (blocks + arrows + timestamp) |
| Download Markdown | `pathfinder.md` — formatted with headings, tables, connections |
| Import JSON | File picker; replace or merge with existing canvas |

**Merge behavior:** existing blocks preserved; imported blocks get new IDs, arrow refs remapped.

---

## Key Functions Reference

**`js/state.js`:** `genId()` · `saveState()` · `loadState()` · `mutateBlock(id, changes)` · `createBlock(type, wx, wy)` · `deleteBlock(id)` · `duplicateBlock(id)`

**`js/canvas.js`:** `applyTransform()` · `fitView()` · `toWorld(vx, vy)` · `portPos(id, port)` · `bestPorts(fromId, toId)` · `buildPath(...)` · `renderArrows()` · `updateHint()`

**`js/render.js`:** `renderBlock(id)` · `renderAllBlocks()` · `renderInspector()` · `updateCanvasTitle()` · `selectBlock(id)` · `selectArrow(id)` · `deselectAll()`

**`js/gaps.js`:** `runGapDetection()`

**`js/prompt.js`:** `generatePrompt()` · `refreshPrompt()`

**`js/utils.js`:** `escHtml(s)` · `clamp(v, lo, hi)` · `debounce(fn, ms)` · `getBlockEl(id)` · `getBlockDims(id)`

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Delete / Backspace | Delete selected block or arrow |
| Cmd/Ctrl + D | Duplicate selected block |
| Double-click title | Inline edit |
| Enter (in title edit) | Commit |
| Double-click empty canvas | Fit view |

---

## CSS Class Patterns

- `.block[data-type=goal]` — type-specific styling
- `.block.selected` · `.block.dragging`
- `.block.gap-isolated` · `.block.gap-assumption` · `.block.gap-no-req` · `.block.gap-unaddressed`
- `.port-left` · `.port-right` · `.port-top` · `.port-bottom`
- `.panel-tab.active` · `.tab-pane.active`
- `.type-pill.active` · `.action-toggle.active`
- `.export-wrapper.open`

---

## Design Tokens

Follows the standard Neorgon dark theme (see `PROJECTS.md §4`). Block type colors use a distinct palette separate from brand accent colors. Header gradient: `135deg, #B015B0 0%, #3D0080 45%, #080010 100%`.
