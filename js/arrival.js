// ════════════════════════════════════════════════════════════
//  arrival.js: count share-link arrivals the header kit misses.
//
//  The kit's fleet-wide beacon already counts ?via=, ?src= and
//  #d= / #t= hash payloads as GoatCounter events at
//  share/<host>/<label>. Pathfinder's share hash is #s=, which
//  the kit's pattern does not match, so those arrivals were
//  invisible. This fires the SAME event shape for exactly that
//  one gap, and only when the kit would not have counted the
//  page itself (a ?via= or ?src= on the URL already counted).
//
//  Same guards as the kit: *.neorgon.com only, respect Do Not
//  Track and Global Privacy Control, honour the site opt-out
//  meta. No canvas content ever leaves the page; the event is
//  the label 'hash-payload' and nothing else.
// ════════════════════════════════════════════════════════════

/**
 * Pure decision: should this page load count a #s= share arrival?
 * Null when not, else the label to count. The kit's own labels win:
 * a URL it already counts (via / src / yaml / #d= / #t=) returns null.
 */
export function shareHashArrival(search, hash) {
  if (!/^#s=./.test(hash || '')) return null
  const q = new URLSearchParams(search || '')
  if (q.get('via') || q.get('src') || q.get('yaml')) return null
  return 'hash-payload'
}

function allowedHere() {
  if (!/(^|\.)neorgon\.com$/.test(location.hostname)) return false
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl ||
      window.globalPrivacyControl) return false
  const meta = document.querySelector('meta[name="neo-analytics"]')
  if (meta && meta.content === 'off') return false
  return true
}

/**
 * Call once at init, before anything cleans the URL with replaceState.
 * The GoatCounter script loads async from the header kit, so the actual
 * count retries briefly and then gives up in silence.
 */
export function countShareHashArrival() {
  let label
  try { label = shareHashArrival(location.search, location.hash) } catch (_) { return }
  if (!label || !allowedHere()) return
  const path = 'share/' + location.host + '/' + label
  let tries = 0
  const fire = () => {
    if (window.goatcounter?.count) {
      try { window.goatcounter.count({ path, title: 'share arrival', event: true }) } catch (_) {}
      return
    }
    if (++tries < 10) setTimeout(fire, 500)
  }
  fire()
}
