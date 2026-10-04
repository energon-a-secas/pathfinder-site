---
name: Pathfinder
description: A strategy canvas for planning work before an agent builds it. Quiet chrome, typed cards, one violet accent, amber only for gaps.
colors:
  # OKLCH is canonical (the project is OKLCH-only; a Stitch linter will warn,
  # which is accepted). Dark is the default theme; the light twins follow.
  bg: "oklch(0.165 0.012 285)"
  surface-1: "oklch(0.195 0.012 285)"
  surface-2: "oklch(0.225 0.012 285)"
  surface-3: "oklch(0.26 0.012 285)"
  border: "oklch(0.30 0.010 285)"
  border-strong: "oklch(0.50 0.012 285)"
  surface-raised-active: "oklch(0.30 0.010 285)"
  text-1: "oklch(0.96 0.008 285)"
  text-2: "oklch(0.80 0.010 285)"
  text-3: "oklch(0.66 0.010 285)"
  accent: "oklch(0.68 0.16 285)"
  accent-hover: "oklch(0.72 0.14 285)"
  on-accent: "oklch(0.17 0.02 285)"
  attention: "oklch(0.86 0.15 85)"
  danger: "oklch(0.70 0.17 25)"
  warning: "oklch(0.72 0.16 45)"
  success: "oklch(0.745 0.16 162)"
  info: "oklch(0.635 0.165 253)"
  edge: "oklch(0.62 0.02 285)"
  edge-hi: "oklch(0.84 0.012 285)"
  hl-alert: "oklch(0.74 0.105 14)"
  hl-focus: "oklch(0.80 0.12 233)"
  hl-go: "oklch(0.82 0.16 140)"
  hl-hold: "oklch(0.67 0.03 211)"
  hl-festive: "oklch(0.82 0.15 331)"
  light-bg: "oklch(0.985 0.006 285)"
  light-surface-1: "oklch(0.97 0.008 285)"
  light-surface-2: "oklch(0.94 0.008 285)"
  light-surface-3: "oklch(0.91 0.010 285)"
  light-surface-raised: "oklch(0.995 0.002 285)"
  light-surface-raised-active: "oklch(0.88 0.010 285)"
  light-canvas: "oklch(0.96 0.008 285)"
  light-border: "oklch(0.88 0.010 285)"
  light-border-strong: "oklch(0.62 0.012 285)"
  light-text-1: "oklch(0.22 0.012 285)"
  light-text-2: "oklch(0.40 0.012 285)"
  light-text-3: "oklch(0.50 0.012 285)"
  light-accent: "oklch(0.52 0.18 285)"
  light-accent-hover: "oklch(0.47 0.18 285)"
  light-on-accent: "oklch(0.985 0.006 285)"
  light-attention: "oklch(0.64 0.138 70)"
  light-danger: "oklch(0.50 0.19 27)"
  light-warning: "oklch(0.50 0.15 42)"
  light-success: "oklch(0.385 0.12 145)"
  light-info: "oklch(0.45 0.17 262)"
  light-edge: "oklch(0.56 0.015 285)"
  light-edge-hi: "oklch(0.38 0.015 285)"
  light-hl-alert: "oklch(0.535 0.12 14)"
  light-hl-focus: "oklch(0.555 0.155 250)"
  light-hl-go: "oklch(0.53 0.17 140)"
  light-hl-hold: "oklch(0.455 0.035 193)"
  light-hl-festive: "oklch(0.53 0.18 333)"
  # The sixteen type colours (--c-<id>; TYPES in js/utils.js carries the
  # same values as sRGB hex for JSON Canvas and Mermaid).
  type-goal: "oklch(0.86 0.08 236)"
  type-problem: "oklch(0.68 0.13 22)"
  type-stakeholder: "oklch(0.84 0.095 0)"
  type-metric: "oklch(0.78 0.105 206)"
  type-requirement: "oklch(0.68 0.13 148)"
  type-output: "oklch(0.71 0.105 61)"
  type-implementation: "oklch(0.685 0.115 110)"
  type-process: "oklch(0.75 0.13 251)"
  type-terminator: "oklch(0.685 0.125 340)"
  type-decision: "oklch(0.82 0.13 158)"
  type-resource: "oklch(0.66 0.11 189)"
  type-assumption: "oklch(0.765 0.125 314)"
  type-risk: "oklch(0.78 0.12 42)"
  type-question: "oklch(0.68 0.125 232)"
  type-context: "oklch(0.795 0.015 262)"
  type-custom: "oklch(0.585 0.015 60)"
  light-type-goal: "oklch(0.525 0.14 248)"
  light-type-problem: "oklch(0.46 0.15 29)"
  light-type-stakeholder: "oklch(0.6 0.145 357)"
  light-type-metric: "oklch(0.565 0.1 221)"
  light-type-requirement: "oklch(0.545 0.145 146)"
  light-type-output: "oklch(0.51 0.11 59)"
  light-type-implementation: "oklch(0.585 0.13 115)"
  light-type-process: "oklch(0.6 0.12 258)"
  light-type-terminator: "oklch(0.49 0.14 342)"
  light-type-decision: "oklch(0.46 0.1 153)"
  light-type-resource: "oklch(0.6 0.085 169)"
  light-type-assumption: "oklch(0.565 0.15 319)"
  light-type-risk: "oklch(0.585 0.16 36)"
  light-type-question: "oklch(0.46 0.1 239)"
  light-type-context: "oklch(0.52 0.02 270)"
  light-type-custom: "oklch(0.4 0.02 60)"
typography:
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
  mono:
    fontFamily: "ui-monospace, SF Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
  xl: "14px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "32px"
  "8": "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.on-accent}"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-3}"
  button-ghost:
    textColor: "{colors.text-2}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-1}"
  button-danger:
    textColor: "{colors.danger}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-sm:
    height: "28px"
    padding: "0 10px"
  input:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "6px 12px"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.lg}"
    width: "220px"
    padding: "10px 12px"
  menu:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.lg}"
    padding: "4px"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    height: "18px"
    padding: "0 6px"
    typography: "{typography.caption}"
  gap-badge:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.attention}"
    rounded: "10px"
    size: "20px"
    border: "2px"
  type-dot:
    size: "8px"
---

# Design System: Pathfinder

The tokens live in `css/style.css`, in blocks marked `tokens:start` and `tokens:end` (dark on `:root` and `body`, light on `body.light-mode`, high contrast, and the connection tokens in `[lines]`). This file describes them; the stylesheet is what renders. `tests/design-tokens.test.js` measures every pair below in the browser, in both themes.

## 1. Overview

**Creative North Star: "The night-shift drafting table"**

A tech lead at a 27-inch monitor in a dim room late in the day, alone and focused, mapping next week's work before handing it to an agent. That scene decides the theme: dark first, so the typed cards are the brightest things in the room and the chrome falls back into the dark around them. The same lead in a bright office at noon switches to light, and light is a first-class theme, not a filter: every token is redefined for it and measured on its own surfaces.

The interface is an instrument in the lineage of Linear: quiet at rest, fast under the keyboard, dense where density helps. Colour carries meaning and nothing else: a block's type (the dot and the quiet edge on a card), a gap (amber, and only amber means a gap), and the current selection, focus or primary action (the one violet). Every other surface is a neutral leaning faintly toward the accent's hue, 285, at a chroma of 0.008 to 0.012; only near white, where the sRGB gamut at that hue runs out, is it less (0.006 on the light page, 0.002 on a light raised surface). The map is the hero; in dark mode the header, palette, inspector and status bar sit on the same ground as the canvas, separated by single hairlines, and in light mode the map takes its own ground a step under the panels, so it reads as a place and a card lifts off it.

It rejects, by name, the four anti-references in PRODUCT.md: the whiteboard toy, enterprise diagram clutter, the generic SaaS template, and neon dark mode.

**Layout and spacing.** A 4px base: `--space-1` to `--space-8` are 4, 8, 12, 16, 20, 24, 32 and 40px. Controls are 32px tall (`--control-h`), 28px in dense rows (`--control-h-sm`), and stay at least 24px as targets (WCAG 2.5.8). Panels keep their widths (palette 200px, inspector 320px); the canvas takes the rest. Vary the rhythm: 12px between rows of a property sheet, 20px between its sections. One radius per kind of thing: `--radius-sm` (4px) for chips, badges, tabs and labels; `--radius` (6px) for every control (buttons, fields, pickers, toggles, the zoom cluster, icon buttons) and the boxes inside a panel; `--radius-lg` (10px) for cards, menus, popovers, toasts and floating bars; `--radius-xl` (14px) for dialogs and frames.

**Motion.** Two durations, `--dur-1` (120ms) and `--dur-2` (200ms), one curve, `--ease-out` (`cubic-bezier(0.25, 1, 0.5, 1)`): fast start, long settle, no overshoot. Motion conveys state only. Decorative motion is off by default (View, Animate highlights) and `prefers-reduced-motion` stops all of it. Animate `transform` and `opacity`, never layout properties: every transition names the properties it moves (never `all`) and runs on `--ease-out`; the skip link slides on a transform, the phone sheet snaps between heights, and Tidy slides each card on a `translate` in `--dur-2` (only with Animate highlights on; instant otherwise). Hover is not a state change, so nothing wiggles on hover; the hover fade (unrelated cards to 60%, lines to 30%) waits for a 150ms dwell and never follows a finger.

**Iconography.** One set: stroked line icons, 16px, 1.5px stroke, round caps and joins, `currentColor`. A filled glyph beside a stroked one is a bug. Icons always sit beside a word or carry an accessible name.

**Key characteristics:**
- Dark first, tinted neutrals (hue 285), never `#000` or `#fff`.
- One accent, violet `oklch(0.68 0.16 285)`, for selection, focus and the primary action only.
- One attention hue, amber, for gaps only, at least 10 OKLab dE (times 100) from everything it must not be mistaken for.
- One sans (Inter when installed, else the system face, no webfont download), 13px UI base, 11px floor.
- Flat at rest; two shadows for things that float.
- One focus treatment, one button system, one field vocabulary, one menu component.

## 2. Colors: the instrument palette

Restrained: tinted neutrals, one accent under ten percent of any screen, one attention hue, and the sixteen type colours on the cards' dots and edges.

### Primary
- **Instrument violet** (`--accent`, oklch(0.68 0.16 285) dark, oklch(0.52 0.18 285) light): the current selection, the keyboard focus ring, the primary button, prose links and the marquee. `--accent-hover` is the hover twin (lighter in dark mode, darker in light). `--accent-subtle` (18% of the accent) is the selection halo, `--accent-wash` (8%) the selected card's fill. Text on an accent fill is `--on-accent`: near-black in dark mode, near-white in light, chosen by measurement (6.35:1 and 5.65:1).

### Secondary
- **Signal amber** (`--attention`, oklch(0.86 0.15 85) dark, oklch(0.64 0.138 70) light): a gap on a card and in the Attention tab's gap rows, nothing else. The presentation highlight Hold is a grey, not amber, for the same reason. It draws (the ring, the badge's edge and icon, a row's ring marker) at 3:1 or better on the canvas, a card, the page and a raised label, and it never writes: text beside a gap is a text token. An amber that reads at 4.5:1 on the light theme sits on the Output type colour (dE 1.7), so there is no amber ink.

### Status (UI only)
- **Danger** (`--danger`), **warning** (`--warning`), **success** (`--success`) and **info** (`--info`): toasts, destructive actions, diff text and comparison lines, save errors. Always next to an icon or a word, never alone. `--danger-subtle` is the destructive hover wash. They never mark a type or a gap, and never paint a card: a snapshot comparison marks a card in neutral ink with its word (added solid, changed dashed, a removed card a grey ghost). Green and blue are type families too, so success and info sit 8 dE or more from every type colour (nearest: Requirement and Decision 8.0, Open Question 8.1 and 8.8); danger and warning keep their hues, 4.5 to 6.7 dE from Problem and Output, as text only.

### Neutral

| Token | Role | Dark | sRGB | Light | sRGB |
|---|---|---|---|---|---|
| `--bg` | the page, the panels, the header | `oklch(0.165 0.012 285)` | #0e0e13 | `oklch(0.985 0.006 285)` | #f9fafe |
| `--surface-1` | fields, a card in dark mode, quiet fills | `oklch(0.195 0.012 285)` | #14141a | `oklch(0.97 0.008 285)` | #f4f4fa |
| `--surface-2` | hover, chips, secondary buttons, menus (dark) | `oklch(0.225 0.012 285)` | #1b1b21 | `oklch(0.94 0.008 285)` | #eaeaf0 |
| `--surface-3` | pressed, hover on surface-2 | `oklch(0.26 0.012 285)` | #23232a | `oklch(0.91 0.010 285)` | #e0e0e8 |
| `--surface-raised` | menus, popovers, dialogs, toasts | surface-2 | #1b1b21 | `oklch(0.995 0.002 285)` | #fdfdff |
| `--canvas` | the map's ground (`.canvas-viewport` paints it) | bg | #0e0e13 | `oklch(0.96 0.008 285)` | #f1f1f7 |
| `--card` | a block | surface-1 | #14141a | surface-raised | #fdfdff |
| `--border` | separators, card edges (decorative, 1.4:1) | `oklch(0.30 0.010 285)` | #2d2d33 | `oklch(0.88 0.010 285)` | #d6d7de |
| `--border-strong` | a control's boundary (3:1) | `oklch(0.50 0.012 285)` | #62626a | `oklch(0.62 0.012 285)` | #85858d |
| `--text-1` | titles, values, primary text | `oklch(0.96 0.008 285)` | #f1f1f7 | `oklch(0.22 0.012 285)` | #1a1a20 |
| `--text-2` | body, labels | `oklch(0.80 0.010 285)` | #bdbdc4 | `oklch(0.40 0.012 285)` | #47474e |
| `--text-3` | hints, placeholders, meta | `oklch(0.66 0.010 285)` | #919198 | `oklch(0.50 0.012 285)` | #62626a |
| `--edge` | a connection at rest | `oklch(0.62 0.02 285)` | #848592 | `oklch(0.56 0.015 285)` | #73737d |
| `--edge-hi` | a connection hovered or related | `oklch(0.84 0.012 285)` | #c9cad2 | `oklch(0.38 0.015 285)` | #41414a |
| `--edge-sel` | a connection selected: the accent, like a selected card | accent | #9087f6 | accent | #6351ca |

Measured contrast (WCAG 2, foreground on background; read from the rendered page in both themes, and re-measured in the test DOM by `tests/design-tokens.test.js`):

| Pair | Need | Dark | Light |
|---|---|---|---|
| `--text-1` on `--bg` / `--canvas` / `--card` / `--surface-raised` | 7:1 | 17.11 / 17.11 / 16.31 / 15.23 | 16.60 / 15.39 / 17.05 / 17.05 |
| `--text-2` on `--bg` / `--canvas` / `--card` / `--surface-raised` | 4.5:1 | 10.30 / 10.30 / 9.82 / 9.17 | 8.83 / 8.19 / 9.07 / 9.07 |
| `--text-3` on `--bg` / `--surface-1` / `--canvas` | 4.5:1 | 6.15 / 5.86 / 6.15 | 5.79 / 5.52 / 5.37 |
| `--text-3` on `--card` / `--surface-raised` | 4.5:1 | 5.86 / 5.47 | 5.95 / 5.95 |
| `--text-3` on a selected card (the wash) | 4.5:1 | 5.38 | 5.34 |
| `--accent` on `--bg` (link text) | 4.5:1 | 6.40 | 5.65 |
| `--accent` on `--canvas` / `--card` (ring) | 3:1 | 6.40 / 6.10 | 5.24 / 5.81 |
| `--accent` on `--surface-raised` / a hovered row (menu focus) | 3:1 | 5.70 / 5.19 | 5.81 / 4.92 |
| `--on-accent` on `--accent` / `--accent-hover` | 4.5:1 | 6.38 / 7.43 | 5.65 / 7.06 |
| `--border-strong` on `--bg` | 3:1 | 3.19 | 3.51 |
| `--border` on `--bg` | decorative | 1.41 | 1.38 |
| `--card` on `--canvas` (lift) | none | 1.05 | 1.11 |
| `--attention` on `--canvas` / `--card` / `--bg` / `--surface-raised` | 3:1 | 12.45 / 11.86 / 12.45 / 11.08 | 3.07 / 3.40 / 3.31 / 3.40 |
| `--danger` on `--bg` / raised / card | 4.5:1 | 6.69 / 5.96 / 6.38 | 6.35 / 6.52 / 6.52 |
| `--warning` on `--bg` / raised / card | 4.5:1 | 7.31 / 6.50 / 6.96 | 6.12 / 6.28 / 6.28 |
| `--success` on `--bg` / raised / card | 4.5:1 | 9.13 / 8.13 / 8.70 | 8.95 / 9.19 / 9.19 |
| `--info` on `--bg` / raised / card | 4.5:1 | 5.58 / 4.97 / 5.32 | 7.43 / 7.63 / 7.63 |
| `--edge` on `--canvas` | 3:1 | 5.27 | 4.17 |
| `--edge-hi` / `--edge-sel` on `--canvas` | 4.5:1 | 11.79 / 6.40 | 8.97 / 5.24 |

Attention's distance (OKLab, dE times 100) from what it must not be mistaken for:

| Attention vs | Dark | Light |
|---|---|---|
| `--accent` | 35.4 | 32.6 |
| `--danger` | 22.6 | 19.2 |
| `--warning` | 17.6 | 15.6 |
| `--success` | 22.5 | 30.0 |
| `--info` | 38.6 | 36.1 |
| the nearest type colour | 12.9 (Risk) | 10.7 (Risk) |
| the type band, any hue (dark L 0.74 C 0.11, light L 0.52 C 0.13) | 12.6 at hue 85 | 12.0 at hue 74 |

High contrast (`body.high-contrast`, or the system setting through `prefers-contrast: more`, the value that query takes; `high` never matched) raises `--border`, makes `--border-strong` and `--text-2` the primary text colour, lifts `--text-3`, and moves the accent further from the background, in both themes:

| Token (high contrast) | Dark | Light |
|---|---|---|
| `--border` | `oklch(0.70 0.010 285)` | `oklch(0.55 0.012 285)` |
| `--border-strong`, `--text-2` | `--text-1` | `--text-1` |
| `--text-3` | `oklch(0.84 0.008 285)` | `oklch(0.32 0.012 285)` |
| `--accent` | `oklch(0.80 0.12 285)` | `oklch(0.42 0.18 285)` |

A border token is never a fill: high contrast lifts `--border` to a mid grey, and a hovered button on a floating surface that used it as its fill fell to 2.4:1 (dark) and 3.6:1 (light) under `--text-1`. The pressed and hovered fill there is `--surface-raised-active` (`oklch(0.30 0.010 285)` dark, `oklch(0.88 0.010 285)` light, untouched by high contrast), measured at 4.5:1 or better with `--text-1` in all four modes by `tests/design-tokens.test.js`.

### Type palette

Sixteen type colours, one per block type, and the only colours a card wears for what it *is*. They live in `css/style.css` as `--c-<id>` (OKLCH, dark on `:root`, light on `body.light-mode`) and in `TYPES` in `js/utils.js` as the sRGB hex those values render to, because JSON Canvas and Mermaid carry hex and an import reads a type back from it. `tests/types-foundation.test.js` holds the two to the same values, channel for channel.

**How they were chosen.** On the dark canvas near L 0.74, C 0.11 (lightness 0.66 to 0.86, chroma 0.08 to 0.13); in the light theme near L 0.52, C 0.13 (0.46 to 0.60, 0.085 to 0.16) so each draws at 3:1 or better on every light surface. Each type has a hue family that keeps the meanings people already bring (Problem red, Risk orange, Decision green, Open Question sky, Process blue), spread around the wheel and kept clear of the two hues that mean something else: the accent violet (285) and the attention amber (85). Lightness and chroma were then tuned by script (a constrained search, in gamut, measured on the rendered hex) to push every pair apart, and every value sits 2 dE or more off any stock palette shade (Tailwind 300 to 700), so no type colour is somebody else's default.

**Shape follows the step's role.** Sixteen colours in one lightness band cannot all sit 10 dE apart: the best spread found for this band puts the closest pair near 8. So the dot's shape carries part of the type, by the question it answers: a **ring** for Why and Who (the ends the work serves), a **square** for What and Proof (what can be checked), a **dot** for How and Other (the work, the most common cards), a **diamond** for Doubt. Every pair under 10 dE differs in shape, so colour is never the only cue. The shape is on every dot the app draws (card, palette, menus, inspector, the phone sheet, the image export), as a mask or a transform on the same 8px element (`[data-shape]`), never a layout change. In forced-colors mode the dot keeps its shape in `CanvasText`, since that is exactly where colour is gone.

| Type | Step | Shape | Dark | Light | Contrast, worst surface (dark / light) | dE from attention | dE from accent |
|---|---|---|---|---|---|---|---|
| Goal | Why | ring | `oklch(0.86 0.08 236)` #9edaff | `oklch(0.525 0.14 248)` #046eb6 | 10.35 / 4.48 | 22.3 / 30.0 | 21.8 / 10.9 |
| Problem | Why | ring | `oklch(0.68 0.13 22)` #dd7573 | `oklch(0.46 0.15 29)` #9a2a20 | 5.10 / 6.43 | 23.2 / 20.7 | 21.9 / 26.8 |
| Stakeholder | Who | ring | `oklch(0.84 0.095 0)` #ffb1c8 | `oklch(0.6 0.145 357)` #c15681 | 9.20 / 3.57 | 17.1 / 17.3 | 22.9 / 20.9 |
| Metric | Proof | square | `oklch(0.78 0.105 206)` #57cbd8 | `oklch(0.565 0.1 221)` #11839f | 8.13 / 3.67 | 23.6 / 24.2 | 20.2 / 17.0 |
| Requirement | What | square | `oklch(0.68 0.13 148)` #5aae69 | `oklch(0.545 0.145 146)` #268536 | 5.72 / 3.90 | 23.2 / 19.8 | 27.0 / 30.6 |
| Output | What | square | `oklch(0.71 0.105 61)` #d1925a | `oklch(0.51 0.11 59)` #935417 | 5.92 / 4.98 | 16.4 / 13.6 | 24.9 / 26.8 |
| Implementation | How | dot | `oklch(0.685 0.115 110)` #9ea044 | `oklch(0.585 0.13 115)` #7a8409 | 5.62 / 3.42 | 18.7 / 11.6 | 27.5 / 31.6 |
| Process | How | dot | `oklch(0.75 0.13 251)` #6cb3fd | `oklch(0.6 0.12 258)` #5181c7 | 7.06 / 3.30 | 29.8 / 26.0 | 11.4 / 12.2 |
| Trigger / End | How | dot | `oklch(0.685 0.125 340)` #cd7ab2 | `oklch(0.49 0.14 342)` #933a76 | 5.22 / 5.64 | 27.8 / 24.4 | 13.6 / 16.0 |
| Decision | How | dot | `oklch(0.82 0.13 158)` #73dea4 | `oklch(0.46 0.1 153)` #20683c | 9.45 / 5.64 | 17.2 / 24.0 | 29.6 / 26.5 |
| Resource / System | How | dot | `oklch(0.66 0.11 189)` #1aa7a0 | `oklch(0.6 0.085 169)` #469177 | 5.26 / 3.14 | 28.8 / 17.6 | 20.4 / 24.5 |
| Assumption | Doubt | diamond | `oklch(0.765 0.125 314)` #d09aea | `oklch(0.565 0.15 319)` #9b54ad | 7.06 / 4.11 | 26.7 / 25.0 | 11.6 / 11.1 |
| Risk | Doubt | diamond | `oklch(0.78 0.12 42)` #f89d79 | `oklch(0.585 0.16 36)` #c85030 | 7.50 / 3.77 | 12.9 / 10.7 | 26.0 / 28.8 |
| Open Question | Doubt | diamond | `oklch(0.68 0.125 232)` #2fa5d8 | `oklch(0.46 0.1 239)` #0a5e89 | 5.57 / 5.89 | 31.9 / 29.8 | 13.1 / 14.5 |
| Context | Other | dot | `oklch(0.795 0.015 262)` #b7bcc6 | `oklch(0.52 0.02 270)` #646975 | 8.19 / 4.59 | 17.7 / 19.7 | 18.5 / 16.1 |
| Other | Other | dot | `oklch(0.585 0.015 60)` #837a73 | `oklch(0.4 0.02 60)` #50453d | 3.71 / 7.76 | 30.6 / 26.9 | 19.6 / 22.9 |

Contrast is the type colour as a graphic against the worst of `--canvas`, `--card` and `--surface-raised-hover` (a hovered menu row), in its theme; the need is 3:1. Context and Other are near-neutral on purpose: background and untyped are the two types that should not compete.

**Distances** (OKLab dE times 100, on the rendered hex; the full 16 by 16 matrices are computed by `tests/design-tokens.test.js` on every run):

| Measure | Dark | Light | Before (2026-09 palette, dark / light) |
|---|---|---|---|
| Closest pair, any two types | 8.1 (Requirement / Implementation, Output / Risk, Process / Open Question) | 7.9 (Goal / Open Question) | 4.0 (Trigger / Other) / 4.9 (Decision / Resource) |
| Closest pair in the same step | 14.6 (Implementation / Resource) | 10.6 (Implementation / Resource) | 5.2 / 4.9 (Decision / Resource) |
| Closest pair with the same shape | 12.3 (Process / Context) | 10.6 (Implementation / Resource) | 4.0 / 4.9 (all were dots) |
| Closest type to `--attention` | 12.9 (Risk) | 10.7 (Risk) | 2.7 (Requirement) / 2.8 |
| Closest type to `--accent` | 11.4 (Process) | 10.9 (Goal) | 2.2 (Output) / 2.5 |
| Pairs under 10 | 13, none sharing a shape | 11, none sharing a shape | 8, all dots |

The pairs under 10 in either theme, each with its two shapes: Goal (ring) with Metric (square), Process (dot), Open Question (diamond) and Context (dot); Problem (ring) with Output (square) and Trigger / End (dot); Metric (square) with Process, Resource and Context (dots); Requirement (square) with Implementation, Decision and Resource (dots); Output (square) with Implementation (dot) and Risk (diamond); Process (dot) with Open Question (diamond); Resource (dot) with Open Question (diamond); Trigger / End (dot) with Assumption (diamond). The narrower band is why more pairs sit between 7.9 and 10 than before; none sits below 7.9, where four sat between 4 and 5.4.

**Older files.** Each `TYPES` entry keeps `legacyColors`: the dark and light hex it drew before this palette. `js/interop.js` reads them exactly like the current ones, so a JSON Canvas exported before 2026-10 (with or without `pathfinderType`, either theme's hex) still imports typed with no colour override, and the card takes the new palette. A block whose own colour was picked when it equalled its type's colour keeps it: the export marks it in `pathfinderColor`, and the import keeps it. A stored block colour equal to an old type colour keeps its old light twin (`js/cards.js` `lightAccentFor`). One exception, at paint time only: a stored colour within 10 dE of the attention hue (the old Amber swatch `#fbbf24`, old Requirement and Assumption, a JSON Canvas "3") would read as a gap, so the card and its connections draw the nearest current swatch instead (`paintColorFor`, also in the image export). The stored hex is never touched.

**Swatches** (`SWATCH_COLORS`, a person's own colour for a block or a connection): twelve named hues near OKLCH L 0.62 (Pink 0.64), none equal to any current or legacy type colour. As a card draws them (the hex in dark mode, the twin in light) they sit 11 dE or more from the attention amber and 8.5 or more from the accent violet (Blue's light twin is the nearest). Each reads at 4.5:1 or better on the dark canvas and 3:1 as a line on the light canvas; on a light card the dot and edge take a darker twin (`SWATCH_LIGHT` in `js/cards.js`). A swatch changes a card's colour, never its shape, so the shape still says the type: that matters, because several sit 3.5 to 6 dE from a type colour (Magenta's light twin and Trigger / End, Orange's twin and Risk, Pink and Problem). Colours picked before 2026-10 keep their names.

**Where a type colour may appear.** The card's 8px dot and its quiet edge (and the header preset's strip and the tint preset's wash, which mix it into the card), the palette, the pickers and the inspector's type dot. Nothing else: `tests/design-tokens.test.js` fails if any rule in `style.css` reads a `--c-*` token outside a card's `--bc`.

### Presentation highlights
Emphasis for a shared map, never meaning (`--hl-*`, and `HIGHLIGHTS` in `js/utils.js` as hex for the image export): a ring 6 to 8.5px outside the card with its word on a tab. Each theme has its own set, retuned in OKLCH off the stock palette they used to sit on exactly.

| Highlight | Dark | Light | Ring on canvas / card (dark; light) | Word on its tab | Nearest type (dark; light) |
|---|---|---|---|---|---|
| Alert | `oklch(0.74 0.105 14)` #e58f97 | `oklch(0.535 0.12 14)` #a74c58 | 7.98 / 7.61; 4.89 / 5.41 | 7.98; 5.27 | Problem 6.8; Stakeholder 7.9 |
| Focus | `oklch(0.80 0.12 233)` #64cbfe | `oklch(0.555 0.155 250)` #0675c9 | 10.56 / 10.06; 4.25 / 4.70 | 10.56; 4.58 | Metric 5.8; Goal 3.3 |
| Go | `oklch(0.82 0.16 140)` #89dd76 | `oklch(0.53 0.17 140)` #258101 | 11.61 / 11.07; 4.42 / 4.90 | 11.61; 4.77 | Decision 5.4; Requirement 3.3 |
| Hold | `oklch(0.67 0.03 211)` #819ba0 | `oklch(0.455 0.035 193)` #3f5d5c | 6.54 / 6.23; 6.37 / 7.05 | 6.54; 6.87 | Resource 8.3; Context 7.5 |
| Festive | `oklch(0.82 0.15 331)` #fb9ef1 | `oklch(0.53 0.18 333)` #a43897 | 10.32 / 9.84; 5.20 / 5.76 | 10.32; 5.61 | Assumption 7.2; Assumption 6.0 |

Every highlight sits 10 dE or more from attention and the accent, 8 or more from danger, success and info, and 11 or more from the other highlights (Alert and Festive are the nearest, 13.0 and 11.9). The word on a tab is `--hl-ink`: the page's near-black in dark mode, its near-white in light, where the rings are dark enough to draw at 3:1 on the light canvas. Sixteen type colours leave no hue free, so Focus and Go sit close to a type colour of their family in light mode (3.3); a highlight is a ring outside the card with its word, never a dot, so the two do not share a channel.

### Named rules
**The one voice rule.** The violet is for selection, focus and the primary action. If it appears anywhere else, it is decoration and it goes.

**The amber means missing rule.** `--attention` marks a gap and nothing else: not a warning, not a priority, not a type. A gap never wears its card's type colour, nor one within 10 dE of a type colour, and amber never writes: every colour a gap marker paints is the attention hue or a neutral, in both themes. A stored colour near amber paints as a swatch.

**The type lives on the dot rule.** A block's type is its 8px dot (in its step's shape) and a quiet edge. Type colours never colour text, chips, statuses, gaps, selection or health.

**The no stray colour rule.** No hex (not even `%23` inside a data URI), no colour function (`rgb()`, `hsl()`, `oklch()`, `oklab()`, `lab()`, `lch()`, `color()`) and no named colour outside a token block. A new colour is a new token, defined for both themes and measured.

## 3. Typography

**UI font:** Inter, when it is installed; otherwise the platform's system face (`-apple-system`, `Segoe UI`, `system-ui`). No webfont is downloaded.
**Mono font:** `ui-monospace`, SF Mono, Menlo, Consolas: shortcut keys, code and the trace source.

**Character:** one workmanlike sans carries headings, labels, cards and data; hierarchy comes from size steps and weight, not from a second family.

### Hierarchy
- **Headline** (600, `--fs-20` 20px, 1.25): panel and dialog headings, the start panel's title.
- **Title** (600, `--fs-14` 14px, 1.35): a card's title, a menu's selected value.
- **Body** (400, `--fs-13` 13px, 1.4 for UI and 1.55 for prose): the UI base: menus, fields, buttons, the inspector, the brief. Prose holds a 65 to 75 character measure.
- **Label** (500 or 600, `--fs-12` 12px, 1.4): field labels, secondary buttons, hints, a card's description.
- **Caption** (600, `--fs-11` 11px, 0.04em): the card's type label (the one uppercase string), badges, counts, line labels. 11px is the floor: nothing is set smaller.
- **Document** (`--fs-16` 16px): body text on the doc pages.

Scale tokens: `--fs-11`, `--fs-12`, `--fs-13`, `--fs-14`, `--fs-16`, `--fs-20` (rem, so they follow the user's font size). Retired: 9, 10, 10.5, 11.5, 12.5 and 14.5px. Line heights: `--lh-tight` 1.25, `--lh-ui` 1.4, `--lh-body` 1.55. Weights: `--fw-regular` 400, `--fw-medium` 500, `--fw-semibold` 600, `--fw-bold` 700.

### Named rules
**The sentence case rule.** Every label, button and menu item is written in sentence case. Uppercase belongs to the card's type label alone.

**The 11px floor rule.** No text below 11px, on the canvas or off it.

## 4. Elevation

Flat by default, layered by tone. Surfaces separate by lightness steps and 1px hairlines (`--border`); a shadow means a thing floats above the page.

### Shadow vocabulary
- **Popover** (`--shadow-1`): menus, popovers, the palette tip, toasts, the back-to-content pill, the review bar.
- **Dialog** (`--shadow-2`): modal dialogs, the shortcut sheet, the phone bottom sheet.
- **Card hover** (`--shadow-card`) and **drag** (`--shadow-drag`): a card under the pointer or in the hand. Hover changes the shadow only, never the size or position.
- **Card at rest** (`--shadow-rest`): none in dark mode; a soft lift in light mode, where a near-white card sits on a slightly darker canvas.

All shadows are neutral (a near-black at hue 285 with alpha), never coloured, never a glow.

### Named rules
**The flat at rest rule.** Nothing glows and nothing blurs. If an element has a coloured shadow or a `backdrop-filter`, it is the neon dark mode PRODUCT.md rejects.

## 5. Components

### Buttons
Refined and plain: one shape, four variants, two sizes.
- **Shape:** a 6px radius (`--radius`), 32px tall (`.btn`), 28px for dense rows (`.btn-sm`), `.btn-block` for full width. 13px, weight 500 (600 on primary).
- **Primary** (`.btn-primary`): the accent fill with `--on-accent` text. One per view: the action the view exists for (Turn into blocks, Copy brief, Open as a new map, Restore).
- **Secondary** (`.btn-secondary`): `--surface-2` with a 1px `--border`; hover `--surface-3` and `--border-strong`. On a floating surface the fill steps up one level (`--btn-fill`, `--surface-raised-hover`) and its hover one more (`--btn-fill-hover`, `--surface-raised-active`), never a border token.
- **Ghost** (`.btn-ghost`): no fill at rest, `--text-2`; hover takes the secondary fill. For Cancel, Close, Dismiss.
- **Danger** (`.btn-danger`): `--danger` text on a neutral bordered button; hover `--danger-subtle`. Destructive actions keep an undo.
- **States:** hover changes lightness only (no translate, no shadow); focus is the one outline; active steps down; disabled is 50% and inert; loading is `aria-busy="true"`, which adds a small spinner and blocks repeat clicks.

### Inputs and fields
- **Style:** `.input` (and `textarea.input`, `.select`): `--surface-1` fill (`--input-bg` lets a field sit inset on a surface-1 panel), a 1px `--border-strong` boundary at 3:1, `--text-3` on hover, 6px radius, 13px text, `--text-3` placeholders. The inspector's fields (`.insp-input`, `.insp-textarea`, the question fields) speak the same vocabulary; a read-only field on a view-only link drops to `--border`, since it is a value, not a control.
- **Focus:** the border turns accent and the focus outline draws around it.
- **Error / disabled:** `aria-invalid="true"` takes a `--danger` border with a message beside it; disabled is 50%.
- The select's caret is drawn from two gradient strokes in `--text-3`, so it follows the theme.

### Focus
One treatment everywhere: `--focus-outline` (2px solid accent) at `--focus-offset` (2px), or `--focus-ring` (a 2px `--bg` gap and a 2px accent ring) where an outline would be clipped. A menu row and a field inside the search overlay take the outline inset (-2px), where the surface would clip it; it reads at 4.9:1 or better on a hovered row. No grey focus rings. Forced-colors mode swaps it for `Highlight`.

### Menus
- `js/menu.js` builds every menu (context menus, header menus, pickers): `--surface-raised`, 1px `--border`, `--radius-lg`, `--shadow-1`, 4px padding, 30px rows, 13px text, a right-aligned shortcut in `--text-3`. The hovered row is `--surface-raised-hover`; a danger row is `--danger` text with the `--danger-subtle` wash. The Attention and Find blocks filters are menu.js lists behind chips (`filter-menu.js`); native `<select>` elements remain only in the connection inspector.
- A search box in a menu marks the row Enter will pick with the hovered fill while the box has focus, preferring a word that starts with what was typed. Enter never picks a row nobody could see it pick.

### Command palette
- `Cmd/Ctrl+K`: a modal dialog in the upper third, 560px wide (16px gutters on a phone), `--surface-raised`, `--radius-xl`, `--shadow-2`, the `--scrim` backdrop. A 44px field (14px text, a 16px search icon, a `--radius-sm` chip naming the scope or the list drilled into, an Esc key cap) over 36px rows in groups headed 12px/500 `--text-3`, sentence case.
- A row: a 16px lead (the type dot in its shape, a swatch, or a stroked line icon), the label with its matched letters in 600 `--text-1` (a danger row keeps `--danger` on them), a hint in 12px `--text-3`, where the action lives (File, View, Zoom) in 12px `--text-3`, and its shortcut as key caps. A chord shows as two caps (`N` `K`).
- **Key caps** are one component wherever a key is shown (the palette, the N hint, the shortcut sheet): mono 11px/500, `--text-2` on `--tint`, 1px `--border`, `--radius-sm`; a single key is a 20px square.
- With nothing typed the list is short: the selection's first eight actions, then Recent (never a destructive row or a template), then a few of each group with "N more: keep typing". Headings stick to the top of the list; a list of values opens on its current value under a whole heading.
- The active row is the hovered fill; when the keyboard put it there, the one focus outline too (inset 2px accent). Disabled rows are 50% and never active; they show only when searched for. Nothing animates.

### Type keys
- N arms a floating panel at the bottom of the canvas (`--surface-raised`, `--radius-lg`, `--shadow-1`): "New block", then the sixteen letters as caps beside their type dots, four columns (two on a phone). Hidden from screen readers, which hear the same list announced.

### Cards (blocks)
- **Corner:** 10px (`--radius-lg`); terminators are pills.
- **Fill:** `--card`; a 1.5px edge mixing the type colour into `--border` (the preset decides how much). Presets: Outline (the default), Header, Tinted and Plain. The old Accent bar (a 3px side stripe) is retired: a map that stored it still loads and keeps the value, and draws as Outline.
- **Structure:** the header row (the 8px type dot in its shape, the 11px uppercase type label, markers), the 14px/600 title, the 12px description clamped to three lines, then chips.
- **States:** each state has its own channel, and they nest without touching, measured outward from the card's edge: selection or keyboard focus on the edge (0 to 2px), selection's halo to 4px; a gap's dashed ring from 3 to 5px; a presentation highlight's ring from 6 to 8.5px, its word on a tab at the top left. Hover is a shadow, drag a deeper one. The gap badge owns the top right corner. Widths are whole pixels (Chrome draws a 1.5px border or outline 1px wide at 1x).
- **Zoomed out:** these markers keep their size on screen. `applyTransform` sets `--px` (one screen pixel in canvas units) and `--pxn` on `#canvasRoot`; `--sp` is `--px` but never under one canvas pixel, and `--mk` scales the gap badge and the highlight's word to hold about 14px below 70%. At a two-template fit (0.297) the selection and the ring draw 1.78px, the badge 14px; at 100% nothing changes.
- **Level of detail** (`js/lod.js`, the `[zoom]` section): the canvas root carries one band, and below full detail a face over the card (never a change to its size, so no line moves) shows what reads. `lod-full` (92% and up, where the 12px description is 11px on screen) the whole card, its 11px strings (the type label, chips, a line's label and note) drawn up to 11px on screen between 92% and 100% by a transform that moves nothing; `lod-title` (45 to 92%) the type label at 11px (in sentence case: the uppercase label does not fit a card 100px wide) and the title at 12px/600 on screen, as many lines as the card holds, the dot beside the title when it is short; `lod-pill` (25 to 45%) the dot and the title at 11px, a line or two; `lod-dot` (under 25%) the card filled with its type colour (72% into `--card`) and its shape in the middle (`CanvasText` in forced colours), the title on a raised tip under the card on hover or focus, opening left or above near the canvas's edge. Titles break between words, never inside one and never hyphenated: a word longer than its line ends in an ellipsis. Connection labels rest below full detail (92%) and come back, at their screen size, for a hovered or selected line, or between 45 and 92% for a hovered card's lines. A label is placed together with its note (the note's lines under the pill), so neither runs under a card. A frame's name holds 11px and stays inside its frame's width; a line holds one screen pixel at any zoom. The hover fade leaves Spotlight's own fade alone.
- **Arrival:** a template, the sample, an example, a share link, pasted notes or a Tidy into step columns lands at 100% (whole when all of it fits there) on the entry layer (its triggers, else its roots; pasted notes already on screen at a readable zoom stay put); the toast adds "Shift+1 shows all of it." when part is off screen ("Fit shows all of it." on a phone or a touch-only device). An embed keeps the whole-map fit.
- **Minimap** (`M`, View, the zoom menu; off until asked for): 160 by 100 in the canvas's bottom right corner, flat on `--surface-1` with a 1px `--border`, blocks in their type colour at 80%, the view as a `--text-2` frame over an 8% wash. A toast centres in the room to its left while it shows. `aria-hidden`: Fit and zoom to selection are its keys. Not on phones or in embeds.

### Chips
- Priority, status and action chips are neutral: 18px tall, `--surface-2`, `--text-2`, `--radius-sm`, an 11px stroked icon and the word in sentence case, 11px/600. The icon tells them apart: signal bars for priority (three, two or one at full strength), a circle that fills, checks or strikes for status, and a wrench, shield, clock, double chevron or magnifier for Resolve, Prepare, Recollect, Reinforce and Validate (`js/cards.js` `chipIcon`). Never a type, status or attention colour. The inspector and the menus draw priority with the same bars.

### Gap marker
- `--attention` only, never the card's type colour: a 2px dashed ring 3px outside the card (the `::after` box), and the gap's icon in a 20px round badge on the card's top right edge (`--card` fill, a 2px `--attention` edge, the icon in `--attention` as a graphic at 3:1). While the card is hovered or keyboard focused, the gap's name floats above the badge on a raised label (`--text-1` on `--surface-raised`, an `--attention` edge), clear of the card's top port. Every gap wears the same marker, isolation included, and every colour it paints is the attention hue or a neutral (tested against all sixteen type colours in both themes). Static at rest; with Animate highlights on, the ring's opacity breathes on the card in front of you only (the `--gap-anim` contract), and `prefers-reduced-motion` stops it. A snapshot comparison writes its label into `::after`, so a compared card shows its badge without the ring.
- Lists mark a gap row with a 7px `--attention` ring before its words (the Attention tab); an accepted gap takes the same ring in grey, a whole-canvas finding the neutral ring. No side stripes. The Brief tab counts open items in words and links to the Attention tab; it draws no gap marker of its own.

### Selection
- The heaviest card state: a 2px `--accent` outline on the card's edge (offset 0), a 4px `--accent-subtle` halo and an 8% `--accent-wash` in the fill, the same on every card of a multi-selection. Keyboard focus alone is the outline without the halo or the wash, so a focused card never reads as more selected than a selected one. Escape after a pointer selection lets go of the card's focus too (nothing is left ringed); after a keyboard selection the card keeps its focus, so Tab carries on from there. It sits inside the gap ring, so a selected gap card shows both. The marquee is a 1px accent line over an 8% accent fill. Forced colors draws it in `Highlight`; high contrast in `--text-1` at 3px.

### Connections
- `--edge` at rest, `--edge-hi` (a neutral) when a related card is hovered, `--edge-sel` (the accent, one selection colour for cards and lines) when selected: the line, its endpoint handles and its label pill's edge. Labels are pills on `--card` with a `--border` edge and 11px text.

### Toasts
- A `--surface-raised` panel with a 1px border and `--shadow-1`, a status icon in its status colour, and the message in `--text-1`. They sit under the header and never catch a click meant for what is below, except their own action: a delete (a block, a map) and Clear say what went and offer Undo as a text button in the accent, instead of asking first in a native confirm.

### Dialogs
- A real `<dialog>`: `--surface-raised`, `--radius-xl`, `--shadow-2`, `--scrim` backdrop, one primary button first and Cancel as a ghost. Inline and progressive alternatives come before a modal.

### Header and footer
- The Neorgon header kit with the site's `custom` skin (tokens only, in the kit README's exact selector): the ink skin's quiet near-black in dark mode, built from `--bg`, and a light bar in light mode. A visitor's `?theme=` still replaces it. The app page uses the slim `app` footer; the doc pages use `minimal`.

## 6. Do's and Don'ts

### Do:
- **Do** use the tokens: `var(--text-2)`, `var(--surface-2)`, `var(--accent)`. A colour that is not a token is a bug.
- **Do** keep the violet for selection, focus and the primary action, under ten percent of any screen.
- **Do** keep amber for gaps: a 2px dashed `--attention` ring at 3px, plus the badge's icon and the gap's name in text.
- **Do** pair every status colour with an icon or a word.
- **Do** write sentence case, at 11px or larger, with 4.5:1 for text and 3:1 for lines, icons and focus, in both themes.
- **Do** keep chrome quiet at rest: ghost header buttons, hairline separators, one primary button per view.
- **Do** keep motion between 120 and 200ms on `--ease-out`, name the properties a transition moves, keep it off by default for anything decorative, and let `prefers-reduced-motion` stop it.
- **Do** measure a new token pair with a script and add it to `tests/design-tokens.test.js`.

### Don't:
- **Don't** build a whiteboard toy: no sticky notes, freehand doodles, or untyped shapes the gap checks and the prompt cannot reason about.
- **Don't** drift into enterprise diagram clutter: no Visio or Lucid style ribbons, toolbars on every edge, or property grids that show every field at once.
- **Don't** reach for the generic SaaS template: no hero metrics, identical card grids, gradient accents, or a dashboard look with nothing to say.
- **Don't** ship neon dark mode: no glowing UI, no saturated colour on inactive states, no glow standing in for hierarchy.
- **Don't** use `border-left` or `border-right` wider than 1px as a coloured accent on a card, row, callout or alert.
- **Don't** use gradient text (`background-clip: text`), glassmorphism (`backdrop-filter`) or coloured shadows.
- **Don't** use bounce or elastic easing, or animate `left`, `top`, `width` or `height`.
- **Don't** put a type colour on text, a chip, a status, a gap or a health score, and don't put a status colour on a card.
- **Don't** use `#000`, `#fff`, a colour literal outside a token block, a width of 1.5px where it must render as written, or a font size below 11px.
- **Don't** reach for a modal first.
