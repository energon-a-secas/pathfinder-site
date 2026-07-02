# Changelog

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
