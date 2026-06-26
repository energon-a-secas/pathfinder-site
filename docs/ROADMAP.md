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

### Next batch (committed)

- Acceptance-criteria[] sub-field on requirement/goal/output + decision rationale (replaces Build `[NEEDS INPUT]`)
- Persisted devOpts + one-click presets (Cursor/TS, Claude Code, PM Clarify); promote mode selector to a segmented control
- Round-trip "Paste AI response" importer (AI markdown → linked Question/Assumption/task blocks, with preview-confirm)
- Save-current-canvas-as-template (localStorage) + template JSON export/import
- Content-bearing, audience-shaped templates (Validate an Idea, Build an MVP, Client Discovery)
- On-canvas coaching gap-callout bubbles with one-click fixes
