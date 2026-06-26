# Pathfinder — Engagement & Canvas→AI Iteration Spec

**Date:** 2026-06-26
**Method:** 17-agent orchestrated workflow — 5 user personas → 3 design lenses (UX/UI/Strategy) → 3-engineer dev iteration (Frontend/AI/Tech Lead) → persona re-validation → Head-of-Product synthesis.
**Constraint:** zero-backend (static + localStorage/URL state, no build, no framework, no dependencies).
**Vision:** fastest path from the drawing board to an AI-ready, adjustable plan — the killer output is a high-quality AI prompt, not a diagram.

---

## Headline insight

The highest-leverage wins are **honesty fixes to features that already claim to exist**, not new surface area. Three defects were verified in the actual code and recurred across every persona and dev review:

1. **Prompt modes are theater** — `prompt.js:53-72` emits a byte-identical body for Explore/Plan/Build/Clarify; only the `## Task` header line changes.
2. **Canvas title never reaches the prompt** — `prompt.js:117` hardcodes `# Project Canvas` and never imports `canvasMeta`.
3. **Assumptions are a backwards CSS-class afterthought** — crammed into the `question` type, surfaced only via `gap-assumption`, which double-counts an isolated question as two gaps (`gaps.js:22-39`).

Persona re-validation: **4/5 personas said "yes, I'd switch"** after the refined plan; the consultant stayed "promising" pending save-your-own templates (deferred, with reason).

---

## Final block taxonomy decision

**ADD a first-class `assumption` type and RE-TIER the palette. Do NOT delete or merge any existing type.**

Deletion is a verified data-loss regression: `normalize.js` drops any block whose `type` is not in the `TYPES` registry (`if (!TYPES[raw.type]) return null`) from every saved/imported/shared canvas. So the model stays at **11 defined types, 6 surfaced by default.**

| Type | Label | Color | Status | Palette |
|------|-------|-------|--------|---------|
| goal | Goal | `#a78bfa` | existing | Core |
| problem | Problem | `#f87171` | existing | Core |
| requirement | Requirement | `#fbbf24` | existing | Core |
| **assumption** | **Assumption** | **`#eab308`** | **NEW** | **Core** |
| risk | Risk | `#fb923c` | existing | Core |
| decision | Decision | `#34d399` | existing | Core |
| question | **Open Question** | `#38bdf8` | label-renamed (key unchanged) | Advanced |
| resource | Resource | `#2dd4bf` | existing | Advanced |
| output | Output | `#818cf8` | existing | Advanced |
| context | Context | `#64748b` | existing | Advanced |
| custom | Custom | `#c084fc` | existing (demoted) | Advanced |

**Assumption vs Open Question:** assumption = *believed-true-until-disproven* (an untested bet); question = a genuine unknown. The Assumption block defaults to a `validate` action and feeds a dedicated prompt section.

**Gap-detection changes (`gaps.js`):**
- De-dupe: gap branches become mutually exclusive — an isolated block reports exactly ONE gap (kills the `gap-isolated` + `gap-assumption` double-count).
- Repoint `gap-assumption` to fire on an unlinked/unvalidated **assumption-type** block, not an unlinked question.
- Remove the brittle DOM-class read in `prompt.js` (the gap section already lists gaps from `runGapDetection()` return data).
- Coaching copy in `getGapFixes()` ("This goal has no requirements yet — add one?").

**Prompt impact (`prompt.js`):**
- New `## Assumptions (validate before building)` section between Risks and Open Questions.
- Standing directive: "Treat each Assumption as believed-true-until-disproven; explicitly confirm or challenge each one before relying on it."
- `assumption` legend entry; `validate` added to `ACTION_DEFS` (auto-flows into `normalize.js` VALID_ACTIONS).

---

## Ship this session

### 1. Inject canvas title + Engagement Context into every prompt `[S]`
**Why:** verified blocker; highest leverage-to-effort ratio in the batch. Every persona's framing reaches the AI.
**Files:** `js/prompt.js`, `js/state.js`, `js/normalize.js`, `js/events.js`, `js/render.js`, `index.html`
**Acceptance:**
- Prompt H1 emits `# ${canvasMeta.title || 'Project Canvas'}`.
- New `contextBrief` field on `canvasMeta` (default `''`); when non-empty, opens an `## Engagement Context` section before the type sections.
- `normalize.js` meta handling extended to preserve `contextBrief` across load/import/share-decode.
- A one-line context input near `#canvasTitle`, wired to `canvasMeta.contextBrief` + `debouncedSave` + `ui.promptDirty = true`.
- `contextBrief` persists across reload and round-trips through a share link unchanged.

### 2. First-class Assumption block + gap de-dupe + palette tiering `[M]`
**Why:** unanimous persona ask + owner's explicit request; fixes two verified bugs; zero-migration (add-only).
**Files:** `js/utils.js`, `js/gaps.js`, `js/prompt.js`, `js/render.js`, `js/events.js`, `index.html`, `css/style.css`
**Acceptance:**
- `assumption:{label:'Assumption',color:'#eab308'}` in `TYPES`; auto-appears in inspector type-picker, search dots, prompt legend.
- `validate` in `ACTION_DEFS`; `--c-assumption` CSS var + `.block[data-type=assumption]` rule; visually distinct.
- Dedicated `## Assumptions (validate before building)` prompt section + directive.
- Gap branches mutually exclusive: isolated block reports exactly ONE gap.
- `gap-assumption` fires on unlinked assumption-type blocks; dead DOM read removed from `prompt.js`.
- "Promote to Assumption" one-click control on question-block inspectors via `mutateBlock(id,{type:'assumption'})`.
- `question` label renders as "Open Question"; existing saved canvases reload without dropping blocks.

### 3. Make the four prompt modes reshape the body `[M]`
**Why:** verified theater; named a must-have by founder, lead, PM ("a buried-but-real mode beats a prominent-but-fake one").
**Files:** `js/prompt.js`
**Acceptance:**
- Clarify suppresses implementation dev-modules + Resources/Outputs/Custom; leads with Questions + Assumptions + Gaps.
- Build emits a `- [ ]` task row per requirement/output; requirements lacking acceptance criteria emit `[NEEDS INPUT: acceptance criteria]` + "do not invent — ask first".
- Explore front-loads gap + assumption sections.
- Plan keeps phased-prose framing.
- Switching modes produces a visibly different body, not just a different header line; `generatePrompt()` still returns a string (all export paths intact).
- Build ordering: requirements by priority then incoming-arrow count (no topo sort this round).

### 4. Always-visible "Copy AI-ready prompt" pill + readiness verdict + health rebalance `[S]`
**Why:** killer output is buried behind a tab; `computeHealthScore` scores a title-only skeleton ~80/Healthy. Build the readiness gate ONCE (it recurred in 3 proposals).
**Files:** `js/prompt.js`, `js/ui-panels.js`, `index.html`, `css/style.css`
**Acceptance:**
- Persistent canvas-corner pill copies via the SAME path as `setupCopyPrompt` (incl. `markExported()` + `refreshPrompt()` so the diff tracker stays in sync).
- `computeHealthScore` rebalanced: remove the `n>3` gate on the no-description penalty, raise per-empty penalty for goal/requirement/output, exclude empty-description blocks from the connectedness bonus set.
- The four built-in templates land amber (50–79) on first apply — not red, not green.
- Plain-language verdict: ≥80 "Looks solid — your AI has enough to plan"; 50–79 amber + top missing item; <50 "Add a goal and one requirement first" (friendly next-step, never a failing grade).
- Non-green copy shows a non-blocking "Copy anyway?" confirm; verdict is a pure function of score + gap count with no new persisted state.

### 5. Sentence-level scoring classifier + Brain Dump empty state + type-fix chips `[M]`
**Why:** verified prefix-only `PASTE_PATTERNS` (`events.js:445-465`) dumps natural prose into gray `custom`; the fast on-ramp dies here. Brain Dump is the screenshot-worthy hook.
**Files:** `js/events.js`, `js/canvas.js`, `js/render.js`, `index.html`, `css/style.css`
**Acceptance:**
- `categorizeLine` strips a leading first-person/article prefix then SCORES the whole line against weighted keyword sets (need/must/should/ship→requirement; will work/assume/expect→assumption; risk/concern→risk; goal/increase/launch→goal; decided/chose→decision; trailing `?`→question); highest score wins; falls to `custom` only with no signal; existing `goal:` prefixes still win.
- `createBlocksFromText(text)` extracted, called by BOTH the paste handler and the Brain Dump button.
- A centered Brain Dump card shows only when the canvas is empty; respects `ui.readOnly`/`ui.embed`.
- After import, each new block shows a type-correction chip rendered as a SIBLING in `canvasRoot` (not inside block innerHTML, which `renderBlock` rebuilds wholesale); clicking opens a compact type menu via `mutateBlock(id,{type})` + re-runs gap detection.
- Low-confidence/custom blocks get an amber dashed-outline flag; chips auto-dismiss on next `canvasRoot` pointerdown.

---

## Next batch (committed, with reasons)

- **Acceptance-criteria[] sub-field** on requirement/goal/output + rationale on decision (model on the existing `questions[]` array; add to `normalizeBlock` or it's stripped on load). Replaces the Build `[NEEDS INPUT]` placeholder — eng-lead's committed item.
- **Persisted devOpts + one-click presets** (Cursor/TypeScript, Claude Code, PM Clarify, Consultant Proposal). MUST serialize `devOpts.prePrompts` (a Set) as `[...set]`. Promote the mode selector to a segmented control at the top of the prompt pane.
- **Round-trip "Paste AI response" importer** — parse AI markdown (`## Questions`→question, `## Assumptions`→assumption, `- [ ]`→requirement) into linked blocks with a mandatory preview-and-confirm. Closes the "adjust the plan as usable" loop (founder + PM game-changer).
- **Save-current-canvas-as-template** (localStorage) + template JSON export/import. Store positions normalized to `(0,0)`-relative. Consultant's blocker.
- **Content-bearing + audience-shaped templates** (Validate an Idea, Build an MVP, Client Discovery). Change `applyTemplate` `description: ''` → `description: bd.description || ''` or new copy is ignored. (Guiding-text half is cheap; may pull forward.)
- **Coaching gap callout bubbles** anchored on-canvas with one-click fix buttons.

## Deferred (with reasons)

- **BYO-key in-browser AI fetch** — founder's dream one-button round-trip; large, depends on the paste-back importer.
- **Folding Context/Output into sub-fields** — larger refactor with import/back-compat cost (`export.js` section ordering depends on Output; Context drives prompt framing).
- **Gradient source→target arrows / type glyphs** — gradient arrows regenerate `linearGradient` defs every rAF frame and would jank a 30+ arrow canvas; needs a profiled spike.
- **Structured "Copy as Jira/Linear task list" export** — only valuable after `acceptanceCriteria[]` + arrow-derived dependencies land.
- **True topological Build ordering** — dumb priority+incoming-arrow ordering is enough to make modes feel real this round.
- **Guided "first 60 seconds" walkthrough** — Brain Dump empty state covers most of the cold-start need.

## Success metrics

- **TTFP** for a non-curated paste drops from ~7 min (manual reclassify) to <60 sec: paste prose → ≥80% land on a non-custom type → copy via the pill.
- **Mode honesty:** Clarify vs Build produce a byte-different body, not a 1-line header diff.
- **Framing carry-through:** 100% of prompts include the canvas title as H1; non-empty Engagement Context appears as the opening section; survives reload + share round-trip.
- **Readiness honesty:** title-only skeleton scores red/amber (not ≥80 green); the four templates land amber on first apply.
- **Gap correctness:** an isolated question reports exactly ONE gap; assumption-type blocks trigger `gap-assumption`.
- **Zero regressions:** existing saved canvases & shared links load with all blocks intact after the TYPES add and `normalize.js` meta change.
