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
| `js/ui-panels.js` | ~306 | Export, share, search, panel tabs, dev options, header buttons, panel collapse, mode descriptions |
| `js/context-menu.js` | ~150 | Right-click block quick menu (duplicate/type/color/collapse/delete) |
| `js/image-export.js` | ~230 | High-quality diagram export — native SVG + 2× PNG |
| `js/doc-panel.js` | ~230 | Living documentation — docRef resolution, doc-preview popup, `See:` detection, grounded question prompts |

**JS modules:** `app.js` · `state.js` · `utils.js` · `canvas.js` · `render.js` · `events.js` · `gaps.js` · `prompt.js` · `ui-panels.js` · `export.js` · `templates.js` · `context-menu.js` · `image-export.js` · `normalize.js` · `doc-panel.js`

**Key interactions added 2026-07-01:**
- Multi-line descriptions render with `escHtmlMultiline` + `white-space: pre-wrap` (newlines preserved on the card and in exports).
- Right-click any block for a quick-action menu (`context-menu.js`); also `Shift+F10`/ContextMenu key on the selected block.
- Arrows carry an optional `note` (richer than `label`), hidden until hover/selection, or always shown via the header **Arrow text** toggle (`ui.showArrowText`, persisted `pathfinder-arrowtext`, body class `show-arrow-text`).
- Right panel collapses via a chevron (persisted `pathfinder-panel-collapsed`).
- Export ▾ → **Download Image (PNG 2×)** / **Download Vector (SVG)** redraws the canvas as a self-contained SVG (`image-export.js`) — no DOM screenshot.
- Brain Dump folds indented/bulleted lines into the parent block's description (toggle in the card); `parseOutline()` in `events.js`.
- Prompt pane shows a one-line description of the selected mode (`refreshModeDesc` in `ui-panels.js`).
- **Dark theme is the default** (no OS-preference opt-in); light mode only when explicitly saved.

**Required assets:** `index.html` · `css/style.css` · `js/*.js` · `favicon.ico` · `energon-classic-logo.png` · `og-preview.jpg` · `CNAME`

**📖 Read `docs/references/internals.md` before changing code in** `doc-panel.js` (Living Documentation — docRef, fetch gating/CSP, "See:" promotion, live questions), `canvas.js` (pan/zoom, ports, Bézier routing), or `prompt.js` (per-mode prompt generation, Brain Dump classifier, dev options). It also holds the full **Key Functions Reference** (per-module function lookup).

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
      docRef: null                   // { href, label, anchor } | null — see Living Documentation
    }
  },
  arrows: [{ id, from: blockId, to: blockId }]
}

view = { panX, panY, zoom }          // zoom range: 0.18–2.6
```

Auto-saved via `debouncedSave()` (300ms) on every change.

**Backward compatibility:** `normalize.js` is the single choke point for load/import/share. It coerces legacy `questions` (plain `string[]`) into `[{text}]` objects and tolerates a missing `docRef` (→ `null`). Per the "don't silently mutate on load" rule, the normalized shape only persists on the next real edit.

---

## Block Types

13 types defined in the `TYPES` constant. Each has a unique left-border color. The palette surfaces a **Core 6** by default; the rest live behind an "Advanced types" expander (`#advancedBlocks`) — but all 13 are fully usable and no type is ever removed (deleting a type would drop existing blocks via `normalize.js`).

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

`runGapDetection()` runs automatically on every canvas change. Gap branches are **mutually exclusive** — a block reports exactly ONE gap (isolation wins outright; type-specific gaps only apply to *connected* blocks wired wrongly):

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
| Copy Prompt | Clipboard — markdown AI prompt |
| Download JSON | `pathfinder.json` — full canvas (blocks + arrows + timestamp) |
| Download Markdown | `pathfinder.md` — formatted with headings, tables, connections |
| Import JSON | File picker; replace or merge with existing canvas |

**Merge behavior:** existing blocks preserved; imported blocks get new IDs, arrow refs remapped.

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
