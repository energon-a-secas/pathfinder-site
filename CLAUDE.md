# CLAUDE.md — Pathfinder

Visual strategy canvas for planning, gap detection, and AI prompt export.

**Live:** pathfinder.neorgon.com
**Run:** `python3 -m http.server` from `pathfinder-site/`, or open `index.html` directly.

---

## Architecture

Single-file app: `index.html` (~1910 lines, inline CSS + JS). No build step, no dependencies.

**Required assets:** `index.html` · `favicon.ico` · `energon-classic-logo.png` · `CNAME`

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

10 types defined in the `TYPES` constant. Each has a unique left-border color:

| Type | Color | CSS Var |
|------|-------|---------|
| goal | #a78bfa (violet) | --c-goal |
| problem | #f87171 (red) | --c-problem |
| requirement | #fbbf24 (amber) | --c-requirement |
| risk | #fb923c (orange) | --c-risk |
| question | #38bdf8 (sky) | --c-question |
| decision | #34d399 (emerald) | --c-decision |
| resource | #2dd4bf (teal) | --c-resource |
| output | #818cf8 (indigo) | --c-output |
| context | #64748b (slate) | --c-context |
| custom | #c084fc (fuchsia) | --c-custom |

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
- `bestPorts(fromId, toId)` — selects optimal left/right/top/bottom port pair
- `buildPath(x1,y1,d1,x2,y2,d2)` — builds SVG cubic Bézier; control offset 55–130px

---

## Gap Detection

`runGapDetection()` runs automatically on every canvas change. It appends CSS classes to blocks:

| Class | Meaning | Trigger |
|-------|---------|---------|
| `gap-isolated` | No connections at all | Block has 0 incoming + 0 outgoing arrows |
| `gap-assumption` | Unlinked question | Question block not connected to a Goal or Requirement |
| `gap-no-req` | Goal without requirements | Goal block has no arrow to a Requirement |
| `gap-unaddressed` | Ignored problem | Problem block lacks "resolve" action and has no outgoing arrows |

Gap icons pulse (1.8–2.5s animation) in the block header.

---

## AI Prompt Generation

`generatePrompt()` builds a structured markdown prompt from canvas state.

**Sections (in order):** Context → Goals → Problems → Requirements → Risks → Questions → Decisions → Resources → Outputs → Custom → Connections → Gap summary → Dev options

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

**State:**
- `genId()` · `saveState()` · `loadState()`
- `mutateBlock(id, changes)` — update + re-render
- `createBlock(type, wx, wy)` · `deleteBlock(id)` · `duplicateBlock(id)`

**Rendering:**
- `renderBlock(id)` · `renderAllBlocks()` · `renderArrows()`
- `renderInspector()` · `runGapDetection()` · `updateHint()`

**Selection:**
- `selectBlock(id)` · `selectArrow(id)` · `deselectAll()`

**Utilities:**
- `escHtml(s)` · `clamp(v, lo, hi)` · `debounce(fn, ms)`
- `getBlockEl(id)` · `getBlockDims(id)`

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
