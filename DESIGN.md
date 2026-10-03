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
  text-1: "oklch(0.96 0.006 285)"
  text-2: "oklch(0.80 0.010 285)"
  text-3: "oklch(0.66 0.010 285)"
  accent: "oklch(0.68 0.16 285)"
  accent-hover: "oklch(0.72 0.14 285)"
  on-accent: "oklch(0.17 0.02 285)"
  attention: "oklch(0.86 0.15 85)"
  danger: "oklch(0.70 0.17 25)"
  warning: "oklch(0.72 0.16 45)"
  success: "oklch(0.75 0.14 155)"
  info: "oklch(0.72 0.12 240)"
  edge: "oklch(0.62 0.02 285)"
  edge-hi: "oklch(0.84 0.012 285)"
  light-bg: "oklch(0.985 0.004 285)"
  light-surface-1: "oklch(0.97 0.006 285)"
  light-surface-2: "oklch(0.94 0.008 285)"
  light-surface-3: "oklch(0.91 0.010 285)"
  light-surface-raised: "oklch(0.995 0.002 285)"
  light-border: "oklch(0.88 0.010 285)"
  light-border-strong: "oklch(0.62 0.012 285)"
  light-text-1: "oklch(0.22 0.012 285)"
  light-text-2: "oklch(0.40 0.012 285)"
  light-text-3: "oklch(0.50 0.012 285)"
  light-accent: "oklch(0.52 0.18 285)"
  light-accent-hover: "oklch(0.47 0.18 285)"
  light-on-accent: "oklch(0.985 0.004 285)"
  light-attention: "oklch(0.64 0.138 70)"
  light-attention-ink: "oklch(0.52 0.11 66)"
  light-danger: "oklch(0.50 0.19 27)"
  light-warning: "oklch(0.50 0.15 42)"
  light-success: "oklch(0.48 0.11 155)"
  light-info: "oklch(0.48 0.12 245)"
  light-edge: "oklch(0.56 0.015 285)"
  light-edge-hi: "oklch(0.38 0.015 285)"
  # The sixteen type colours (--c-<id>; TYPES in js/utils.js carries the
  # same values as sRGB hex for JSON Canvas and Mermaid).
  type-goal: "oklch(0.82 0.09 248)"
  type-problem: "oklch(0.68 0.13 22)"
  type-stakeholder: "oklch(0.82 0.11 356)"
  type-metric: "oklch(0.78 0.13 215)"
  type-requirement: "oklch(0.68 0.13 148)"
  type-output: "oklch(0.71 0.105 61)"
  type-implementation: "oklch(0.685 0.115 110)"
  type-process: "oklch(0.75 0.13 251)"
  type-terminator: "oklch(0.685 0.125 340)"
  type-decision: "oklch(0.82 0.13 158)"
  type-resource: "oklch(0.695 0.12 184)"
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
  light-type-resource: "oklch(0.6 0.105 181)"
  light-type-assumption: "oklch(0.565 0.15 319)"
  light-type-risk: "oklch(0.565 0.16 39)"
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
  type-dot:
    size: "8px"
---

# Design System: Pathfinder

The tokens live in `css/style.css`, in blocks marked `tokens:start` and `tokens:end` (dark on `:root` and `body`, light on `body.light-mode`, high contrast, and the connection tokens in `[lines]`). This file describes them; the stylesheet is what renders. `tests/design-tokens.test.js` measures every pair below in the browser, in both themes.

## 1. Overview

**Creative North Star: "The night-shift drafting table"**

A tech lead at a 27-inch monitor in a dim room late in the day, alone and focused, mapping next week's work before handing it to an agent. That scene decides the theme: dark first, so the typed cards are the brightest things in the room and the chrome falls back into the dark around them. The same lead in a bright office at noon switches to light, and light is a first-class theme, not a filter: every token is redefined for it and measured on its own surfaces.

The interface is an instrument in the lineage of Linear: quiet at rest, fast under the keyboard, dense where density helps. Colour carries meaning and nothing else: a block's type (the dot and the quiet edge on a card), a gap (amber, and only amber means a gap), and the current selection, focus or primary action (the one violet). Every other surface is a neutral leaning faintly toward the accent's hue, 285, at a chroma of 0.010 to 0.012. The map is the hero; the header, palette, inspector and status bar sit on the same ground as the canvas in dark mode, separated by single hairlines.

It rejects, by name, the four anti-references in PRODUCT.md: the whiteboard toy, enterprise diagram clutter, the generic SaaS template, and neon dark mode.

**Layout and spacing.** A 4px base: `--space-1` to `--space-8` are 4, 8, 12, 16, 20, 24, 32 and 40px. Controls are 32px tall (`--control-h`), 28px in dense rows (`--control-h-sm`), and stay at least 24px as targets (WCAG 2.5.8). Panels keep their widths (palette 200px, inspector 320px); the canvas takes the rest. Vary the rhythm: 12px between rows of a property sheet, 20px between its sections.

**Motion.** Two durations, `--dur-1` (120ms) and `--dur-2` (200ms), one curve, `--ease-out` (`cubic-bezier(0.25, 1, 0.5, 1)`): fast start, long settle, no overshoot. Motion conveys state only. Decorative motion is off by default (View, Animate highlights) and `prefers-reduced-motion` stops all of it. Animate `transform` and `opacity`, never layout properties.

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
- **Instrument violet** (`--accent`, oklch(0.68 0.16 285) dark, oklch(0.52 0.18 285) light): the current selection, the keyboard focus ring, the primary button, prose links and the marquee. `--accent-hover` is the hover twin (lighter in dark mode, darker in light). `--accent-subtle` (18% of the accent) is the selection halo and fill. Text on an accent fill is `--on-accent`: near-black in dark mode, near-white in light, chosen by measurement (6.35:1 and 5.65:1).

### Secondary
- **Signal amber** (`--attention`, oklch(0.86 0.15 85) dark, oklch(0.64 0.138 70) light): a gap on a card and in the Attention tab, nothing else. The presentation highlight Hold is a grey (`--hl-hold`, oklch(0.74 0.015 285)), not amber, for the same reason. It draws (rings, the gap badge, icons) at 3:1 or better on the canvas and on a card; `--attention-ink` (the same amber in dark, oklch(0.52 0.11 66) in light) is for amber text, at 4.5:1.

### Status (UI only)
- **Danger** (`--danger`), **warning** (`--warning`), **success** (`--success`) and **info** (`--info`): toasts, destructive actions, diff and comparison marks, save errors. Always next to an icon or a word, never alone. `--danger-subtle` is the destructive hover wash. They never mark a type or a gap.

### Neutral

| Token | Role | Dark | sRGB | Light | sRGB |
|---|---|---|---|---|---|
| `--bg` | the page, the panels, the header | `oklch(0.165 0.012 285)` | #0e0e13 | `oklch(0.985 0.004 285)` | #fafafd |
| `--surface-1` | fields, a card in dark mode, quiet fills | `oklch(0.195 0.012 285)` | #14141a | `oklch(0.97 0.006 285)` | #f4f5f9 |
| `--surface-2` | hover, chips, secondary buttons, menus (dark) | `oklch(0.225 0.012 285)` | #1b1b21 | `oklch(0.94 0.008 285)` | #eaeaf0 |
| `--surface-3` | pressed, hover on surface-2 | `oklch(0.26 0.012 285)` | #23232a | `oklch(0.91 0.010 285)` | #e0e0e8 |
| `--surface-raised` | menus, popovers, dialogs, toasts | surface-2 | #1b1b21 | `oklch(0.995 0.002 285)` | #fdfdff |
| `--canvas` | the map's ground | bg | #0e0e13 | surface-1 | #f4f5f9 |
| `--card` | a block | surface-1 | #14141a | surface-raised | #fdfdff |
| `--border` | separators, card edges (decorative, 1.4:1) | `oklch(0.30 0.010 285)` | #2d2d33 | `oklch(0.88 0.010 285)` | #d6d7de |
| `--border-strong` | a control's boundary (3:1) | `oklch(0.50 0.012 285)` | #62626a | `oklch(0.62 0.012 285)` | #85858d |
| `--text-1` | titles, values, primary text | `oklch(0.96 0.006 285)` | #f1f1f6 | `oklch(0.22 0.012 285)` | #1a1a20 |
| `--text-2` | body, labels | `oklch(0.80 0.010 285)` | #bdbdc4 | `oklch(0.40 0.012 285)` | #47474e |
| `--text-3` | hints, placeholders, meta | `oklch(0.66 0.010 285)` | #919198 | `oklch(0.50 0.012 285)` | #62626a |
| `--edge` | a connection at rest | `oklch(0.62 0.02 285)` | #848592 | `oklch(0.56 0.015 285)` | #73737d |
| `--edge-hi` | a connection hovered or related | `oklch(0.84 0.012 285)` | #c9cad2 | `oklch(0.38 0.015 285)` | #41414a |

Measured contrast (WCAG 2, foreground on background; computed from the tokens, and re-measured in the test DOM by `tests/design-tokens.test.js`):

| Pair | Need | Dark | Light |
|---|---|---|---|
| `--text-1` on `--bg` | 4.5:1 | 17.16 | 16.60 |
| `--text-1` on `--surface-raised` | 4.5:1 | 15.24 | 17.09 |
| `--text-2` on `--bg` | 4.5:1 | 10.31 | 8.84 |
| `--text-2` on `--card` | 4.5:1 | 9.78 | 9.10 |
| `--text-3` on `--bg` | 4.5:1 | 6.19 | 5.76 |
| `--text-3` on `--surface-1` | 4.5:1 | 5.87 | 5.51 |
| `--text-3` on `--canvas` | 4.5:1 | 6.19 | 5.51 |
| `--text-3` on `--card` | 4.5:1 | 5.87 | 5.93 |
| `--text-3` on `--surface-raised` | 4.5:1 | 5.50 | 5.93 |
| `--accent` on `--bg` (link text) | 4.5:1 | 6.40 | 5.65 |
| `--accent` on `--canvas` (ring) | 3:1 | 6.40 | 5.41 |
| `--accent` on `--card` (ring) | 3:1 | 6.07 | 5.82 |
| `--accent` on `--surface-raised` | 3:1 | 5.68 | 5.82 |
| `--on-accent` on `--accent` | 4.5:1 | 6.35 | 5.65 |
| `--on-accent` on `--accent-hover` | 4.5:1 | 7.45 | 7.04 |
| `--border-strong` on `--bg` | 3:1 | 3.21 | 3.49 |
| `--border` on `--bg` | decorative | 1.41 | 1.38 |
| `--attention` on `--canvas` | 3:1 | 12.50 | 3.17 |
| `--attention` on `--card` | 3:1 | 11.86 | 3.41 |
| `--attention-ink` on `--bg` | 4.5:1 | 12.50 | 5.42 |
| `--attention-ink` on `--card` | 4.5:1 | 11.86 | 5.58 |
| `--danger` on `--bg` / raised | 4.5:1 | 6.69 / 5.94 | 6.34 / 6.53 |
| `--warning` on `--bg` / raised | 4.5:1 | 7.35 / 6.53 | 6.14 / 6.32 |
| `--success` on `--bg` / raised | 4.5:1 | 9.18 / 8.15 | 5.93 / 6.10 |
| `--info` on `--bg` / raised | 4.5:1 | 7.90 / 7.02 | 6.21 / 6.39 |
| `--edge` on `--canvas` | 3:1 | 5.28 | 4.28 |
| `--edge-hi` on `--canvas` | 4.5:1 | 11.78 | 9.20 |

Attention's distance (OKLab, dE times 100) from what it must not be mistaken for:

| Attention vs | Dark | Light |
|---|---|---|
| `--accent` | 35.4 | 32.6 |
| `--danger` | 22.7 | 19.1 |
| `--warning` | 17.6 | 15.7 |
| `--success` | 20.0 | 23.3 |
| `--info` | 29.9 | 30.3 |
| the type band, any hue (dark L 0.74 C 0.11, light L 0.52 C 0.13) | 12.6 at hue 85 | 12.0 at hue 74 |

High contrast (`body.high-contrast`, or `prefers-contrast: more`) raises `--border`, makes `--border-strong` and `--text-2` the primary text colour, lifts `--text-3`, and moves the accent further from the background, in both themes.

### Type palette

Sixteen type colours, one per block type, and the only colours a card wears for what it *is*. They live in `css/style.css` as `--c-<id>` (OKLCH, dark on `:root`, light on `body.light-mode`) and in `TYPES` in `js/utils.js` as the sRGB hex those values render to, because JSON Canvas and Mermaid carry hex and an import reads a type back from it. `tests/types-foundation.test.js` holds the two to the same values, channel for channel.

**How they were chosen.** On the dark canvas near L 0.74, C 0.11 (lightness 0.68 to 0.82, chroma 0.09 to 0.13); in the light theme near L 0.52, C 0.13 (0.46 to 0.60, 0.10 to 0.16) so each draws at 3:1 or better on every light surface. Each type has a hue family that keeps the meanings people already bring (Problem red, Risk orange, Decision green, Open Question sky, Process blue), spread around the wheel and kept clear of the two hues that mean something else: the accent violet (285) and the attention amber (85). Lightness and chroma were then tuned by script (a constrained search, in gamut, measured on the rendered hex) to push every pair apart.

**Shape follows the step's role.** Sixteen colours in one lightness band cannot all sit 10 dE apart: the best spread found for this band puts the closest pair near 8. So the dot's shape carries part of the type, by the question it answers: a **ring** for Why and Who (the ends the work serves), a **square** for What and Proof (what can be checked), a **dot** for How and Other (the work, the most common cards), a **diamond** for Doubt. Every pair under 10 dE differs in shape, so colour is never the only cue. The shape is on every dot the app draws (card, palette, menus, inspector, the phone sheet, the image export), as a mask or a transform on the same 8px element (`[data-shape]`), never a layout change.

| Type | Step | Shape | Dark | Light | Contrast, worst surface (dark / light) | dE from attention | dE from accent |
|---|---|---|---|---|---|---|---|
| Goal | Why | ring | `oklch(0.82 0.09 248)` #95cafc | `oklch(0.525 0.14 248)` #046eb6 | 9.02 / 4.48 | 24.1 / 30.0 | 17.4 / 10.9 |
| Problem | Why | ring | `oklch(0.68 0.13 22)` #dd7573 | `oklch(0.46 0.15 29)` #9a2a20 | 5.10 / 6.43 | 23.2 / 20.7 | 21.9 / 26.8 |
| Stakeholder | Who | ring | `oklch(0.82 0.11 356)` #fda6c6 | `oklch(0.6 0.145 357)` #c15681 | 8.51 / 3.57 | 18.8 / 17.3 | 21.3 / 20.9 |
| Metric | Proof | square | `oklch(0.78 0.13 215)` #2ccceb | `oklch(0.565 0.1 221)` #11839f | 8.13 / 3.67 | 26.6 / 24.2 | 19.6 / 17.0 |
| Requirement | What | square | `oklch(0.68 0.13 148)` #5aae69 | `oklch(0.545 0.145 146)` #268536 | 5.72 / 3.90 | 23.2 / 19.8 | 27.0 / 30.6 |
| Output | What | square | `oklch(0.71 0.105 61)` #d1925a | `oklch(0.51 0.11 59)` #935417 | 5.92 / 4.98 | 16.4 / 13.6 | 24.9 / 26.8 |
| Implementation | How | dot | `oklch(0.685 0.115 110)` #9ea044 | `oklch(0.585 0.13 115)` #7a8409 | 5.62 / 3.42 | 18.7 / 11.6 | 27.5 / 31.6 |
| Process | How | dot | `oklch(0.75 0.13 251)` #6cb3fd | `oklch(0.6 0.12 258)` #5181c7 | 7.06 / 3.30 | 29.8 / 26.0 | 11.4 / 12.2 |
| Trigger / End | How | dot | `oklch(0.685 0.125 340)` #cd7ab2 | `oklch(0.49 0.14 342)` #933a76 | 5.22 / 5.64 | 27.8 / 24.4 | 13.6 / 16.0 |
| Decision | How | dot | `oklch(0.82 0.13 158)` #73dea4 | `oklch(0.46 0.1 153)` #20683c | 9.45 / 5.64 | 17.2 / 24.0 | 29.6 / 26.5 |
| Resource / System | How | dot | `oklch(0.695 0.12 184)` #16b5a5 | `oklch(0.6 0.105 181)` #129484 | 6.09 / 3.13 | 26.3 / 20.5 | 21.9 / 24.2 |
| Assumption | Doubt | diamond | `oklch(0.765 0.125 314)` #d09aea | `oklch(0.565 0.15 319)` #9b54ad | 7.06 / 4.11 | 26.7 / 25.0 | 11.6 / 11.1 |
| Risk | Doubt | diamond | `oklch(0.78 0.12 42)` #f89d79 | `oklch(0.565 0.16 39)` #c04b20 | 7.50 / 4.11 | 12.9 / 11.3 | 26.0 / 28.9 |
| Open Question | Doubt | diamond | `oklch(0.68 0.125 232)` #2fa5d8 | `oklch(0.46 0.1 239)` #0a5e89 | 5.57 / 5.89 | 31.9 / 29.8 | 13.1 / 14.5 |
| Context | Other | dot | `oklch(0.795 0.015 262)` #b7bcc6 | `oklch(0.52 0.02 270)` #646975 | 8.19 / 4.59 | 17.7 / 19.7 | 18.5 / 16.1 |
| Other | Other | dot | `oklch(0.585 0.015 60)` #837a73 | `oklch(0.4 0.02 60)` #50453d | 3.71 / 7.76 | 30.6 / 26.9 | 19.6 / 22.9 |

Contrast is the type colour as a graphic against the worst of `--canvas`, `--card` and `--surface-raised-hover` (a hovered menu row), in its theme; the need is 3:1. Context and Other are near-neutral on purpose: background and untyped are the two types that should not compete.

**Distances** (OKLab dE times 100, on the rendered hex; the full 16 by 16 matrices are computed by `tests/design-tokens.test.js` on every run):

| Measure | Dark | Light | Before (2026-09 palette, dark / light) |
|---|---|---|---|
| Closest pair, any two types | 7.9 (Requirement / Resource) | 7.7 (Metric / Resource) | 4.0 (Trigger / Other) / 4.9 (Decision / Resource) |
| Closest pair in the same step | 13.7 (Decision / Resource) | 12.8 (Context / Other) | 5.2 / 4.9 (Decision / Resource) |
| Closest pair with the same shape | 12.3 (Process / Context) | 12.1 (Decision / Other) | 4.0 / 4.9 (all were dots) |
| Closest type to `--attention` | 12.9 (Risk) | 11.3 (Risk) | 2.7 (Requirement) / 2.8 |
| Closest type to `--accent` | 11.4 (Process) | 10.9 (Goal) | 2.2 (Output) / 2.5 |
| Pairs under 10 | 13, none sharing a shape | 11, none sharing a shape | 8, all dots |

The seventeen pairs under 10 in either theme, each with its two shapes: Goal (ring) with Metric (square), Process (dot), Open Question (diamond) and Context (dot); Problem (ring) with Output (square) and Trigger / End (dot); Stakeholder (ring) with Risk (diamond); Metric (square) with Process, Resource and Context (dots); Requirement (square) with Implementation, Decision and Resource (dots); Output (square) with Implementation (dot) and Risk (diamond); Process (dot) with Open Question (diamond); Trigger / End (dot) with Assumption (diamond). The narrower band is why more pairs sit between 7.7 and 10 than before; none sits below 7.7, where four sat between 4 and 5.4.

**Older files.** Each `TYPES` entry keeps `legacyColors`: the dark and light hex it drew before this palette. `js/interop.js` reads them exactly like the current ones, so a JSON Canvas exported before 2026-10 (with or without `pathfinderType`, either theme's hex) still imports typed with no colour override, and the card takes the new palette. A block whose own colour was picked when it equalled its type's colour keeps it: the export marks it in `pathfinderColor`, and the import keeps it. A stored block colour equal to an old type colour keeps its old light twin (`js/cards.js` `lightAccentFor`).

**Swatches** (`SWATCH_COLORS`, a person's own colour for a block or a connection): twelve named hues at OKLCH L 0.62, none equal to any current or legacy type colour, none on the accent violet or the attention amber. Each reads at 4.5:1 or better on the dark canvas and 3:1 as a line on the light one; on a light card the dot and edge take a darker twin (`SWATCH_LIGHT` in `js/cards.js`). A swatch changes a card's colour, never its shape, so the shape still says the type. Colours picked before 2026-10 keep their names.

**Where a type colour may appear.** The card's 8px dot and its quiet edge (and the header preset's strip and the tint preset's wash, which mix it into the card), the palette, the pickers and the inspector's type dot. Nothing else: `tests/design-tokens.test.js` fails if any rule in `style.css` reads a `--c-*` token outside a card's `--bc`.

### Named rules
**The one voice rule.** The violet is for selection, focus and the primary action. If it appears anywhere else, it is decoration and it goes.

**The amber means missing rule.** `--attention` marks a gap and nothing else: not a warning, not a priority, not a type. A gap never wears its card's type colour.

**The type lives on the dot rule.** A block's type is its 8px dot (in its step's shape) and a quiet edge. Type colours never colour text, chips, statuses, gaps, selection or health.

**The no stray colour rule.** No hex, `rgb()` or named colour outside a token block. A new colour is a new token, defined for both themes and measured.

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
- **Primary** (`.btn-primary`): the accent fill with `--on-accent` text. One per view: the action the view exists for (Turn into blocks, Copy prompt, Open as a new map, Restore).
- **Secondary** (`.btn-secondary`): `--surface-2` with a 1px `--border`; hover `--surface-3` and `--border-strong`. On a floating surface the fill steps up one level (`--btn-fill`).
- **Ghost** (`.btn-ghost`): no fill at rest, `--text-2`; hover takes the secondary fill. For Cancel, Close, Dismiss.
- **Danger** (`.btn-danger`): `--danger` text on a neutral bordered button; hover `--danger-subtle`. Destructive actions keep an undo.
- **States:** hover changes lightness only (no translate, no shadow); focus is the one outline; active steps down; disabled is 50% and inert; loading is `aria-busy="true"`, which adds a small spinner and blocks repeat clicks.

### Inputs and fields
- **Style:** `.input` (and `textarea.input`, `.select`): `--surface-1` fill (`--input-bg` lets a field sit inset on a surface-1 panel), a 1px `--border-strong` boundary at 3:1, 6px radius, 13px text, `--text-3` placeholders.
- **Focus:** the border turns accent and the focus outline draws around it.
- **Error / disabled:** `aria-invalid="true"` takes a `--danger` border with a message beside it; disabled is 50%.
- The select's caret is drawn from two gradient strokes in `--text-3`, so it follows the theme.

### Focus
One treatment everywhere: `--focus-outline` (2px solid accent) at `--focus-offset` (2px), or `--focus-ring` (a 2px `--bg` gap and a 2px accent ring) where an outline would be clipped. Forced-colors mode swaps it for `Highlight`.

### Menus
- `js/menu.js` builds every menu (context menus, header menus, pickers): `--surface-raised`, 1px `--border`, `--radius-lg`, `--shadow-1`, 4px padding, 30px rows, 13px text, a right-aligned shortcut in `--text-3`. The hovered row is `--surface-raised-hover`; a danger row is `--danger` text with the `--danger-subtle` wash. Native `<select>` elements are being replaced by this component.

### Cards (blocks)
- **Corner:** 10px (`--radius-lg`); terminators are pills.
- **Fill:** `--card`; a 1.5px edge mixing the type colour into `--border` (the preset decides how much).
- **Structure:** the header row (the 8px type dot in its shape, the 11px uppercase type label, markers), the 14px/600 title, the 12px description clamped to three lines, then chips.
- **States:** each state has its own channel, and they nest without touching, measured outward from the card's edge: selection or keyboard focus on the edge (0 to 1.5px) with its halo to 4px; a gap's dashed ring from 3 to 4.5px; a presentation highlight's ring from 6 to 8.5px, its word on a tab at the top left. Hover is a shadow, drag a deeper one. The gap badge owns the top right corner.

### Chips
- Priority, status and action chips are neutral: 18px tall, `--surface-2`, `--text-2`, `--radius-sm`, an 11px stroked icon and the word in sentence case, 11px/600. The icon tells them apart: signal bars for priority (three, two or one at full strength), a circle that fills, checks or strikes for status, and a wrench, shield, clock, double chevron or magnifier for Resolve, Prepare, Recollect, Reinforce and Validate (`js/cards.js` `chipIcon`). Never a type, status or attention colour. The inspector and the menus draw priority with the same bars.

### Gap marker
- `--attention` only, never the card's type colour: a 1.5px dashed ring 3px outside the card (the `::after` box), and the gap's icon in a 20px round badge on the card's top right edge (`--card` fill, 1.5px `--attention` edge, `--attention-ink` icon at 4.5:1). While the card is hovered or keyboard focused, the gap's name floats above the badge on a raised label, clear of the card's top port. Every gap wears the same marker, isolation included. Static at rest; with Animate highlights on, the ring's opacity breathes on the card in front of you only (the `--gap-anim` contract), and `prefers-reduced-motion` stops it. A snapshot comparison writes its label into `::after`, so a compared card shows its badge without the ring.

### Selection
- A 1.5px `--accent` outline on the card's edge (offset 0) with a 4px `--accent-subtle` halo; a multi-selection shows the same on every card. Keyboard focus on a selected card takes the 2px focus width. It sits inside the gap ring, so a selected gap card shows both. The marquee is a 1px accent line over an 8% accent fill. Forced colors draws it in `Highlight`.

### Connections
- `--edge` at rest, `--edge-hi` when a related card is hovered, `--edge-sel` (text-1) when selected. Labels are pills on `--card` with a `--border` edge and 11px text.

### Toasts
- A `--surface-raised` panel with a 1px border and `--shadow-1`, a status icon in its status colour, and the message in `--text-1`. They sit under the header and never catch a click meant for what is below.

### Dialogs
- A real `<dialog>`: `--surface-raised`, `--radius-xl`, `--shadow-2`, `--scrim` backdrop, one primary button first and Cancel as a ghost. Inline and progressive alternatives come before a modal.

### Header and footer
- The Neorgon header kit with the site's `custom` skin (tokens only, in the kit README's exact selector): the ink skin's quiet near-black in dark mode, built from `--bg`, and a light bar in light mode. A visitor's `?theme=` still replaces it. The app page uses the slim `app` footer; the doc pages use `minimal`.

## 6. Do's and Don'ts

### Do:
- **Do** use the tokens: `var(--text-2)`, `var(--surface-2)`, `var(--accent)`. A colour that is not a token is a bug.
- **Do** keep the violet for selection, focus and the primary action, under ten percent of any screen.
- **Do** keep amber for gaps: a 1.5px dashed `--attention` outline at 3px, plus an icon and its name.
- **Do** pair every status colour with an icon or a word.
- **Do** write sentence case, at 11px or larger, with 4.5:1 for text and 3:1 for lines, icons and focus, in both themes.
- **Do** keep chrome quiet at rest: ghost header buttons, hairline separators, one primary button per view.
- **Do** keep motion between 120 and 200ms on `--ease-out`, off by default for anything decorative, and stopped by `prefers-reduced-motion`.
- **Do** measure a new token pair with a script and add it to `tests/design-tokens.test.js`.

### Don't:
- **Don't** build a whiteboard toy: no sticky notes, freehand doodles, or untyped shapes the gap checks and the prompt cannot reason about.
- **Don't** drift into enterprise diagram clutter: no Visio or Lucid style ribbons, toolbars on every edge, or property grids that show every field at once.
- **Don't** reach for the generic SaaS template: no hero metrics, identical card grids, gradient accents, or a dashboard look with nothing to say.
- **Don't** ship neon dark mode: no glowing UI, no saturated colour on inactive states, no glow standing in for hierarchy.
- **Don't** use `border-left` or `border-right` wider than 1px as a coloured accent on a card, row, callout or alert.
- **Don't** use gradient text (`background-clip: text`), glassmorphism (`backdrop-filter`) or coloured shadows.
- **Don't** use bounce or elastic easing, or animate `left`, `top`, `width` or `height`.
- **Don't** put a type colour on text, a chip, a status, a gap or a health score.
- **Don't** use `#000`, `#fff`, a hex outside a token block, or a font size below 11px.
- **Don't** reach for a modal first.
