// NAVIGATION stream: fills the status bar zoom cluster. Foundation only
// wires the Fit button so Fit stays reachable now that double-click on
// empty canvas adds a block.
import { fitView } from './canvas.js'

export function setupZoomControls() {
  document.getElementById('fitViewBtn')?.addEventListener('click', () => fitView())
}
