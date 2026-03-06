# Changelog

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
