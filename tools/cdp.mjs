// ════════════════════════════════════════════════════════════
//  tools/cdp.mjs: a static server plus headless Chrome over the
//  DevTools protocol, with no dependencies (Node's global
//  WebSocket and fetch). tools/render-assets.mjs drives the app
//  with it; tests/headless.mjs is the same pattern for the suite.
//
//    const srv = await serve(dir, 9850)
//    const page = await launch({ debugPort: 9851 })
//    await page.go(srv.url + '/')
//    ...
//    await page.close(); await srv.stop()
//
//  Both refuse a port something else already listens on, rather than
//  talking to whatever is there (another worktree's server, another
//  Chrome), and serve() checks the files it serves are `dir`'s. close()
//  waits for Chrome to exit before removing its throwaway profile.
//  Tests: node --test tools/cdp.test.mjs (make test-tools).
//
//  Set CHROME=/path/to/chrome when Chrome is not in a standard place.
// ════════════════════════════════════════════════════════════

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Resolve when nothing listens on host:port; reject, naming the port, when something does. */
export function portFree(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', err => reject(err.code === 'EADDRINUSE'
      ? new Error(`port ${port} is already in use; pick another port`)
      : err))
    probe.listen(port, host, () => probe.close(() => resolve()))
  })
}

/** Wait for a child process to exit (at most `ms`); true when it has. */
async function exited(proc, ms = 5000) {
  if (proc.exitCode !== null || proc.signalCode !== null) return true
  return Promise.race([once(proc, 'exit').then(() => true), sleep(ms).then(() => false)])
}

/** Kill a child process and wait for it to go. */
async function stopProcess(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  try { proc.kill() } catch {}
  if (!(await exited(proc, 3000))) { try { proc.kill('SIGKILL') } catch {}; await exited(proc, 2000) }
}

/** Remove a directory, retrying while a process that just exited lets go of it. */
async function removeDir(dir) {
  for (let i = 0; i < 20 && existsSync(dir); i++) {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
    if (existsSync(dir)) await sleep(100)
  }
}

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean)

/**
 * Serve `dir` with python's http.server on 127.0.0.1:port. Refuses a port
 * that is taken, fails when python exits, and checks the server answers
 * with `dir`'s own copy of `marker` (when `dir` has one), so it can never
 * hand back another directory's files.
 */
export async function serve(dir, port, { marker = 'index.html' } = {}) {
  await portFree(port)
  const proc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' })
  const url = `http://127.0.0.1:${port}`
  const stop = () => stopProcess(proc)
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(`the server on port ${port} exited before it answered (is the port taken?)`)
    }
    let same
    try { same = await servesDir(url, dir, marker) } catch { await sleep(150); continue }
    if (same === false) {
      await stop()
      throw new Error(`port ${port} serves something other than ${dir}`)
    }
    return { url, stop, proc }
  }
  await stop()
  throw new Error(`the server on port ${port} did not start`)
}

/**
 * Whether the server at `url` serves `dir`: its `marker` file, byte for
 * byte. Null when `dir` has no such file to compare; throws when nothing
 * answers.
 */
export async function servesDir(url, dir, marker = 'index.html') {
  const path = join(dir, marker)
  if (!existsSync(path)) { await fetch(url + '/', { cache: 'no-store' }); return null }
  const res = await fetch(url + '/' + marker, { cache: 'no-store' })
  return res.ok && (await res.text()) === readFileSync(path, 'utf8')
}

/**
 * Launch headless Chrome with a private, throwaway profile and connect to
 * its first page. Returns small helpers over the protocol.
 */
export async function launch({ debugPort = 9851, width = 1440, height = 900 } = {}) {
  const chromePath = CANDIDATES.find(p => existsSync(p))
  if (!chromePath) throw new Error('Chrome not found; set CHROME=/path/to/chrome')
  // Another Chrome on this port would answer in place of ours.
  await portFree(debugPort)
  const profile = mkdtempSync(join(tmpdir(), 'pf-tools-'))
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore' })
  const quit = async () => { await stopProcess(chrome); await removeDir(profile) }

  let target
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(200)
    if (chrome.exitCode !== null || chrome.signalCode !== null) break
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page') } catch {}
  }
  if (!target) { await quit(); throw new Error('Chrome did not start') }

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  const listeners = new Set()
  const errors = []
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    else if (m.method) {
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails
        errors.push(d.exception?.description || d.text)
      }
      listeners.forEach(l => l(m))
    }
  }
  const send = (method, params = {}) => new Promise(r => {
    const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }))
  })
  await send('Runtime.enable')
  await send('Page.enable')

  /** Evaluate an expression (awaiting a promise); throws on a page exception. */
  const evalJS = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    const ex = r.result?.exceptionDetails
    if (ex) throw new Error(ex.exception?.description || ex.text)
    return r.result?.result?.value
  }
  const size = async (w, h, { mobile = false, scale = 1 } = {}) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile })
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
  }
  const scheme = value => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] })
  const go = async (url, wait = 600) => {
    const loaded = new Promise(r => {
      const l = m => { if (m.method === 'Page.loadEventFired') { listeners.delete(l); r() } }
      listeners.add(l)
    })
    await send('Page.navigate', { url })
    await Promise.race([loaded, sleep(15000)])
    await sleep(wait)
  }
  /** A screenshot as a Buffer: { format: 'png' | 'jpeg', quality, clip }. */
  const shot = async (opts = {}) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...opts })
    return Buffer.from(r.result.data, 'base64')
  }
  const mouse = (type, x, y, opts = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...opts })
  const click = async (x, y) => {
    await mouse('mouseMoved', x, y, { button: 'none' })
    await mouse('mousePressed', x, y)
    await mouse('mouseReleased', x, y)
  }
  const rect = sel => evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
    const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 } })()`)
  const clickSel = async sel => {
    const r = await rect(sel)
    if (!r) throw new Error('nothing matches ' + sel)
    await click(r.cx, r.cy)
    return r
  }
  // modifiers: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift
  const key = async (k, { code = k, keyCode, text, modifiers = 0 } = {}) => {
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: keyCode, text, modifiers })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode, modifiers })
  }
  const type = async s => {
    for (const ch of s) {
      if (ch === '\n') await key('Enter', { code: 'Enter', keyCode: 13, text: '\r' })
      else await send('Input.insertText', { text: ch })
    }
  }
  /** Close the page, wait for Chrome to exit, then remove its profile. */
  const close = async () => {
    try { ws.close() } catch {}
    await quit()
  }
  return { send, evalJS, size, scheme, go, shot, mouse, click, rect, clickSel, key, type, close, errors, profile }
}
