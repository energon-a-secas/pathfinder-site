// ════════════════════════════════════════════════════════════
//  doc-toc.js: the walkthrough's step index marks where you are.
//
//  The index (#docToc in tutorial.html) is plain links and works
//  without this. With it, the link for the section at the top of
//  the screen carries aria-current="location", which the stylesheet
//  draws in the primary ink, so a reader who scrolled knows which
//  step they are on. Nothing moves and nothing animates.
// ════════════════════════════════════════════════════════════

/**
 * The section a reader is in: the last heading whose top has passed `line`
 * (pixels from the top of the window), or -1 above the first (the intro is
 * no step). Pure, for the tests.
 */
export function currentSection(tops, line) {
  let at = -1
  tops.forEach((top, i) => { if (top <= line) at = i })
  return at
}

/** Wire an index: its links' targets are the sections. Returns a teardown. */
export function setupDocToc(nav = document.getElementById('docToc')) {
  if (!nav) return () => {}
  const links = [...nav.querySelectorAll('a[href^="#"]')]
  const targets = links.map(a => document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))))
  if (!targets.length || targets.some(t => !t)) return () => {}
  let raf = 0
  const mark = () => {
    raf = 0
    // A third of the way down the window: the heading being read, not the
    // one just scrolled past.
    const line = Math.max(96, window.innerHeight / 3)
    const at = currentSection(targets.map(t => t.getBoundingClientRect().top), line)
    links.forEach((a, i) => {
      if (i === at) a.setAttribute('aria-current', 'location')
      else a.removeAttribute('aria-current')
    })
  }
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(mark) }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  mark()
  return () => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onScroll)
    if (raf) cancelAnimationFrame(raf)
  }
}

if (document.getElementById('docToc')) setupDocToc()
