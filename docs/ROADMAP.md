# Pathfinder — Feature Roadmap

## Batch 1: Core Foundation ✅

- ✅ 10 block types with color-coded left borders
- ✅ Drag-and-drop canvas with pan + zoom
- ✅ Arrow connections with auto-routed Bézier paths
- ✅ Right-panel inspector (title, description, actions, questions, notes)
- ✅ AI prompt generation (structured markdown export)
- ✅ Gap detection (isolated, assumption, no-req, unaddressed)
- ✅ Undo / redo (up to 50 steps)
- ✅ localStorage persistence
- ✅ Export: JSON, Markdown, Copy Prompt
- ✅ Import JSON (replace or merge)

## Batch 2: Power UX ✅

- ✅ Cmd/Ctrl+D duplicate block
- ✅ Cmd/Ctrl+A select all
- ✅ Shift+click multi-select
- ✅ Shift+drag rubber-band select
- ✅ Multi-block delete
- ✅ Cmd/Ctrl+F block search with keyboard navigation
- ✅ Animated focus-block pan/zoom
- ✅ Prompt mode selector (Explore / Plan / Build / Clarify)
- ✅ Arrow label editing in inspector
- ✅ Dev options: tone, detail, pre-prompt modules

## Batch 3: Canvas Polish ✅

- ✅ Snap-to-grid toggle (Grid button in header, 28px grid)
- ✅ Zoom indicator (bottom-left pill showing current zoom %)
- ✅ Block hover → relationship highlight (connected arrows glow, unrelated blocks dim)
- ✅ Keyboard shortcut overlay (`?` key, modal with all shortcuts)

## Batch 4: Collaboration & Sharing ✅

- ✅ Canvas share via URL (base64-encoded state in hash)
- ✅ Read-only view mode
- ✅ Embedded canvas preview (iframe-safe)
- ✅ Canvas title / metadata field

## Batch 5: Block Enhancements ✅

- ✅ Block resize (drag handle)
- ✅ Block color override (per-block accent)
- ✅ Block collapse / expand
- ✅ Block grouping / frames
- ✅ Block templates (pre-filled common patterns)

## Batch 6: Arrow Enhancements ✅

- ✅ Arrow style: straight / curved / elbow
- ✅ Arrow direction: bidirectional
- ✅ Arrow color coding by relationship type
- ✅ Arrow weight / thickness control

## Batch 7: AI & Analysis ✅

- ✅ Gap auto-fix suggestions
- ✅ Prompt diff (show what changed since last export)
- ✅ Block auto-categorization on paste
- ✅ Canvas health score

## Batch 8: Accessibility & Mobile ✅

- ✅ Full keyboard navigation (Tab between blocks)
- ✅ Touch pan / pinch-zoom on mobile
- ✅ High-contrast mode
- ✅ Screen-reader labels on all interactive elements

## Batch 9: Canvas→AI Engagement ✅ (2026-06-26)

Driven by a 17-agent persona→design→dev→re-validation workflow. See `docs/2026-06-26-engagement-iteration-spec.md`.

- ✅ Canvas title injected as prompt H1 + optional `## Engagement Context` framing (round-trips through save/import/share)
- ✅ First-class **Assumption** block type (gold, `validate` action, dedicated pressure-test prompt section); palette re-tiered to Core 6 + Advanced expander; "Question" → "Open Question"; one-click "Promote to Assumption"
- ✅ Gap engine de-duped (mutually exclusive — one gap per block) and `gap-assumption` repointed onto assumption-type blocks; coaching copy
- ✅ Prompt modes genuinely reshape the body (Clarify drops impl modules; Build emits `- [ ]` task checklists with `[NEEDS INPUT]` acceptance criteria; Explore front-loads gaps/assumptions)
- ✅ Always-visible "Copy AI-ready prompt" pill + honest readiness verdict; health score rebalanced so hollow/title-only canvases no longer read "Healthy" (built-in templates now land amber)
- ✅ Brain Dump empty state + sentence-level scoring classifier + post-import type-correction chips (fast on-ramp from messy prose → typed blocks)

## Batch 10: Readable connections + auto-layout ✅ (2026-08-14)

See `docs/CHANGELOG.md` for the full entry.

- ✅ Port lanes: several arrows on one side get separate slots instead of stacking on the midpoint
- ✅ `routed` arrow style (orthogonal, obstacle-avoiding A* router), default for new connections
- ✅ Connection-point pickers + draggable arrow endpoint handles
- ✅ **Tidy**: layered auto-layout, one undo step, LR/TB direction
- ✅ Snap guides while dragging; align + distribute for a multi-selection
- ✅ Card presets (outline / bar / header / tint / plain), per block and canvas-wide, mirrored in the SVG export
- ✅ `H` hides the header and footer, `Z` hides the panels too
- ✅ Fixes: markdown export dropped assumption/context/custom blocks and all arrow labels; arrowheads ignored a custom arrow colour; `?` fired while typing; asymmetric grid snapping; pan/zoom lost on reload
- ✅ Test suite green at 284/284 (was 212/218)

## Batch 11: Handover framing ✅ (2026-08-14)

- ✅ `canvasMeta.situation`: codebase / runtime / first move / boundaries, emitted as the first section of every prompt
- ✅ Assumptions directive adapts to whether the code is reachable
- ✅ New **Investigate** prompt mode
- ✅ Three large templates carrying a situation + mode, auto-tidied on apply
- ✅ Palette header with the collapse control at the top; Templates auto-folds once the canvas has content
- ✅ `tutorial.html` walkthrough with a loadable worked example
- ✅ Hand-authored `llms.txt` format spec
- ✅ Fix: import dropped card style and situation from a shared canvas

## Batch 12: Presentation highlights ✅ (2026-08-14)

- ✅ `block.highlight` (alert / focus / go / hold / festive marching border), applied to a selection
- ✅ `canvasMeta.spotlight` fades everything unmarked
- ✅ Right-click → Select all \<Type\>; multi-select tally by type
- ✅ Survives share/import, mirrored in the SVG and PNG export, respects `prefers-reduced-motion`
- ✅ Housekeeping: `make dev` (no-cache server), Makefile PORT fix, dead `frame-ancestors` removed

### Next batch (committed)

- Acceptance-criteria[] sub-field on requirement/goal/output + decision rationale (replaces Build `[NEEDS INPUT]`)
- Persisted devOpts + one-click presets (Cursor/TS, Claude Code, PM Clarify); promote mode selector to a segmented control
- Round-trip "Paste AI response" importer (AI markdown → linked Question/Assumption/task blocks, with preview-confirm)
- Save-current-canvas-as-template (localStorage) + template JSON export/import
- Content-bearing, audience-shaped templates (Validate an Idea, Build an MVP, Client Discovery)
- On-canvas coaching gap-callout bubbles with one-click fixes

### Deferred, with reasons

- **Arrow waypoints** (drag a path to add a manual bend). The standard escape hatch in draw.io and Miro, but the router should remove most of the need for one. Worth revisiting only if real canvases still need manual bends.
- **Lifting `H`/`Z` into the shared header kit** as `SHORTCUTS.md` proposes. Pathfinder is now the second working reference implementation; the kit version is a separate, fleet-wide change.
- **Force-directed layout.** Wrong tool for these canvases: they are flow graphs, not clusters.
