// ════════════════════════════════════════════════════════════
//  tools/cdp.test.mjs: the asset tools never draw another app's
//  pictures and never leave a Chrome profile behind.
//
//    node --test tools/cdp.test.mjs      (or: make test-tools)
//
//  Needs python3 and Chrome, like make assets itself.
// ════════════════════════════════════════════════════════════

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve, servesDir, launch, portFree } from './cdp.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** A port nothing listens on right now. */
const freePort = () => new Promise((res, rej) => {
  const s = createServer()
  s.once('error', rej)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)) })
})

/** Something else listening on `port` until the returned function is called. */
async function occupy(port, handler = (req, res) => res.end('another app')) {
  const s = createHttpServer(handler)
  await new Promise((res, rej) => { s.once('error', rej); s.listen(port, '127.0.0.1', res) })
  return () => new Promise(res => s.close(res))
}

test('portFree names a port something already listens on', async () => {
  const port = await freePort()
  await portFree(port)
  const release = await occupy(port)
  try {
    await assert.rejects(portFree(port), /port \d+ is already in use/)
  } finally { await release() }
})

test('serve refuses a taken port instead of fetching whatever answers there', async () => {
  const port = await freePort()
  const release = await occupy(port)
  try {
    await assert.rejects(serve(ROOT, port), /already in use/)
  } finally { await release() }
})

test('serve answers with this directory\'s own files, and stop ends python', async () => {
  const port = await freePort()
  const srv = await serve(ROOT, port)
  try {
    const page = await (await fetch(srv.url + '/index.html')).text()
    assert.match(page, /id="startPanel"/, 'this repository\'s app')
  } finally { await srv.stop() }
  assert.ok(srv.proc.exitCode !== null || srv.proc.signalCode !== null, 'python exited')
  await portFree(port)
})

test('a server that is not this directory is told apart by its marker file', async () => {
  const port = await freePort()
  const release = await occupy(port)
  try {
    assert.equal(await servesDir(`http://127.0.0.1:${port}`, ROOT), false, 'another app')
  } finally { await release() }
  const dir = mkdtempSync(join(tmpdir(), 'pf-cdp-test-'))
  try {
    writeFileSync(join(dir, 'index.html'), 'marker ' + Math.random())
    const srv = await serve(dir, await freePort())
    try {
      assert.equal(await servesDir(srv.url, dir), true, 'its own directory')
      assert.equal(await servesDir(srv.url, ROOT), false, 'not this repository')
    } finally { await srv.stop() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('launch refuses a debug port another browser could be answering on', async () => {
  const port = await freePort()
  const release = await occupy(port, (req, res) => res.end('[]'))
  try {
    await assert.rejects(launch({ debugPort: port }), /already in use/)
  } finally { await release() }
})

test('close waits for Chrome to exit, then removes its profile', async () => {
  const page = await launch({ debugPort: await freePort() })
  const { profile } = page
  assert.ok(existsSync(profile), 'a profile while it runs')
  assert.equal(await page.evalJS('1 + 1'), 2)
  await page.close()
  assert.equal(existsSync(profile), false, `${profile} is gone`)
})
