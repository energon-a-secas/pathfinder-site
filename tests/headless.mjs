#!/usr/bin/env node
// Run tests/run-tests.html in headless Chrome and print the result.
//
//   node tests/headless.mjs [dir] [port]      (or: make test)
//
// The suite is browser-only, so this serves the site with python's
// http.server and drives Chrome over the DevTools protocol (Node's global
// WebSocket, no dependencies). It polls #report instead of using
// --dump-dom: the suite rewrites the URL with history.replaceState, and
// --virtual-time-budget never settles on that.
//
// Exit 0 when every test passes, 1 on failures, 2 when the runner did not
// finish (a module failed to load, or Chrome is missing). Set CHROME to a
// Chrome or Chromium binary when it is not in a standard place.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] || '.')
const port = +(process.argv[3] || (9100 + Math.floor(Math.random() * 800)))
const debugPort = port + 1000

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean)
const chromePath = CANDIDATES.find(p => existsSync(p))
if (!chromePath) { console.log('Chrome not found; set CHROME=/path/to/chrome'); process.exit(2) }

const profile = mkdtempSync(join(tmpdir(), 'pf-chrome-'))
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' })
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, '--window-size=1440,900', 'about:blank',
], { stdio: 'ignore' })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const cleanup = () => {
  try { chrome.kill() } catch {}
  try { server.kill() } catch {}
  try { rmSync(profile, { recursive: true, force: true }) } catch {}
}
process.on('exit', cleanup)

let code = 2
try {
  let target
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200)
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
      target = list.find(t => t.type === 'page')
    } catch {}
  }
  if (!target) throw new Error('Chrome did not start')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map(), pageErrors = []
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      pageErrors.push('exception: ' + (d.exception?.description || d.text))
    }
  }
  const send = (method, params = {}) => new Promise(r => {
    const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }))
  })
  await send('Runtime.enable')
  await send('Page.enable')
  for (let i = 0; i < 30; i++) {
    try { await fetch(`http://127.0.0.1:${port}/`); break } catch { await sleep(200) }
  }
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/tests/run-tests.html` })

  const deadline = Date.now() + 180000
  let text = ''
  while (Date.now() < deadline) {
    await sleep(500)
    const r = await send('Runtime.evaluate', {
      expression: `(document.getElementById('report') || document.body).innerText`, returnByValue: true,
    })
    text = r.result?.result?.value || ''
    if (/\d+\/\d+ passed/.test(text)) break
  }

  const total = text.match(/(\d+)\/(\d+) passed/)
  if (!total) {
    console.log('No result: the suite did not finish. Report so far:\n' + text.slice(0, 1500))
  } else {
    console.log(total[0])
    // A failing suite shows "k/n" with k < n; each failing test is a FAIL
    // line followed by its name and message.
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean)
    const bad = []
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i].match(/^(\d+)\/(\d+)$/)
      if (s && s[1] !== s[2]) bad.push(`${lines[i - 1]}  ${lines[i]}`)
      if (lines[i] === 'FAIL') bad.push(`  FAIL ${lines[i + 1] || ''} :: ${(lines[i + 2] || '').slice(0, 400)}`)
    }
    if (bad.length) console.log(bad.slice(0, 150).join('\n'))
    code = total[1] === total[2] ? 0 : 1
  }
  if (pageErrors.length) console.log('--- page errors ---\n' + pageErrors.slice(0, 30).join('\n'))
  ws.close()
} catch (e) {
  console.log('Runner error: ' + e.message)
}
cleanup()
process.exit(code)
