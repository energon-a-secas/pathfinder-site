# Product

## Register

product

## Users

Tech leads and engineering managers planning work before anyone builds it, increasingly work that an AI coding agent (Claude Code, Cursor) will carry out. They sit at a laptop or a large monitor, usually alone and focused, sometimes sharing a view-only link with a teammate or presenting a map in a meeting. The job: turn a fuzzy initiative into a typed map of goals, stakeholders, metrics, requirements, work, risks and open questions; see the gaps the plan has not addressed; then hand the whole picture to an assistant as a structured brief, and fold the assistant's answers back into the map. Secondary users (product managers, facilitators) are welcome but never win a trade-off against the lead's daily flow.

## Product Purpose

Pathfinder is a strategy canvas that thinks with you. Typed blocks and meaningful connections make implicit plan structure explicit; gap detection names what is missing; one click collapses the diagram into a prompt that front-loads everything an AI needs, and a patch brings the answers back. It runs entirely in the browser with no account and no backend, and it speaks JSON Canvas and Mermaid so plans can live in a vault or a README. Success looks like a lead reaching a credible, gap-checked plan and a usable brief in minutes, trusting the tool enough to use it every week, and sharing maps that colleagues can read without a tour.

## Brand Personality

Precise, calm, capable. The voice is plain and exact, written by someone who has run projects: it names the gap ("this metric measures no goal") rather than cheering. The interface should feel like a well-made instrument in the lineage of Linear: quiet at rest, fast under the keyboard, dense where density helps, with color reserved for meaning (a block's type, a gap, a selection). Dark-first, inside the Neorgon fleet's identity, refined rather than loud; light mode is a first-class option, not an afterthought. Delight comes from things working exactly right, not from decoration.

## Anti-references

- A whiteboard toy: sticky notes, freehand doodles, untyped shapes the gap checks and the prompt cannot reason about.
- Enterprise diagram clutter: Visio or Lucid style ribbons, toolbars on every edge, property grids that show every field at once.
- The generic SaaS template: hero metrics, identical card grids, gradient accents, a dashboard look with nothing to say.
- Neon dark mode: glowing cyberpunk UI where everything shines, saturated color on inactive states, glows standing in for hierarchy.

## Design Principles

1. **Meaning before decoration.** Color, shape and motion encode type, state and gaps; anything that does not carry meaning is quiet or absent.
2. **The plan is the interface.** The canvas and the cards are the hero; chrome recedes, panels appear when asked, and nothing competes with the map.
3. **Expert speed, beginner safety.** Every frequent action has a keyboard path and a direct manipulation; every destructive one has undo; a first-timer can still build a useful map without reading anything.
4. **Show the reasoning.** Gaps, implied relations and prompt sections are explained in plain words at the point of use, so the tool teaches the method by being used.
5. **Practice what it preaches.** A tool for clear plans must itself be clear: one component per job, one picker per concept, consistent states everywhere.

## Accessibility & Inclusion

WCAG 2.2 AA as the floor: 4.5:1 text contrast and 3:1 for lines, icons and focus indicators in both themes; full keyboard operation including connections and menus, with no traps; visible focus everywhere; `prefers-reduced-motion` stops all motion and motion is off by default; never color alone (type labels, gap icons and highlight words accompany color); forced-colors mode stays usable; screen-reader names and announcements for selection, menus and dialogs.
