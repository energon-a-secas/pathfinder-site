#!/usr/bin/env node
// Validate a Pathfinder trace without opening the app.
//
// A thin CLI over the app's own js/trace/parse.js, so the rules cannot fork:
// what this accepts is exactly what the page accepts, because it is the same
// module. parse.js takes its YAML loader as an argument precisely so this can
// hand it the npm js-yaml while the browser hands it the CDN one.
//
// Usage:
//   node validate-trace.mjs trace.yaml       # one file
//   node validate-trace.mjs traces/          # every .yaml in a directory
//   node validate-trace.mjs -                # read YAML from stdin
//   node validate-trace.mjs '#t=...'         # a share hash, or a full share URL
//
// From any other repo the published copy works standalone:
//   curl -sO https://pathfinder.neorgon.com/validate-trace.mjs
//   npm install js-yaml && node validate-trace.mjs trace.yaml
// When js/trace/ is not next to this file, the app's copy is fetched from the
// live site, so a standalone run validates against the live rules.
//
// Exit codes: 0 clean · 1 warnings only (it renders, something is off) ·
// 2 errors, or unreadable input.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SITE = 'https://pathfinder.neorgon.com';
const here = dirname(fileURLToPath(import.meta.url));

const target = process.argv[2];
if (!target || target === '--help' || target === '-h') {
  console.error("usage: node validate-trace.mjs <trace.yaml | dir | - | '#t=...' | share-url>");
  process.exit(target ? 0 : 2);
}

// ── js-yaml ─────────────────────────────────────────────────────────────────
let yaml;
try { yaml = (await import('js-yaml')).default; }
catch {
  console.error('This needs js-yaml, the same parser the page loads.\n  npm install js-yaml');
  process.exit(2);
}

// ── the app's parser: beside this file in a checkout, else the live site ─────
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

let parse;
try {
  parse = await import(pathToFileURL(join(here, 'js', 'trace', 'parse.js')).href);
} catch {
  console.error(`js/trace/parse.js not found locally, fetching the app's copy from ${SITE}`);
  const cache = join(tmpdir(), 'pathfinder-trace-validate', 'trace');
  mkdirSync(cache, { recursive: true });
  for (const f of ['parse.js', 'model.js']) {
    writeFileSync(join(cache, f), await fetchText(`${SITE}/js/trace/${f}`));
  }
  parse = await import(pathToFileURL(join(cache, 'parse.js')).href);
}

// ── gather inputs ───────────────────────────────────────────────────────────
function decodeHash(s) {
  const m = s.match(/[#&]t=([^&]+)/);
  if (!m) return null;
  const bin = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return new TextDecoder().decode(bin);
}

const inputs = [];
if (target === '-') {
  inputs.push({ name: 'stdin', text: readFileSync(0, 'utf8') });
} else if (target.includes('t=')) {
  const text = decodeHash(target);
  if (text == null) { console.error('That does not look like a #t= share link.'); process.exit(2); }
  inputs.push({ name: 'share link', text });
} else {
  let st;
  try { st = statSync(target); }
  catch { console.error(`Cannot read ${target}`); process.exit(2); }
  if (st.isDirectory()) {
    readdirSync(target)
      .filter(f => ['.yaml', '.yml'].includes(extname(f)))
      .sort()
      .forEach(f => inputs.push({ name: join(target, f), text: readFileSync(join(target, f), 'utf8') }));
    if (!inputs.length) { console.error(`No .yaml files in ${target}`); process.exit(2); }
  } else {
    inputs.push({ name: target, text: readFileSync(target, 'utf8') });
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
let worst = 0;
for (const input of inputs) {
  const t = parse.parseTraceText(input.text, yaml.load);
  const errs = parse.errorsOf(t);
  const warns = parse.warningsOf(t);

  if (inputs.length > 1) console.log(`\n── ${input.name}`);
  [...errs, ...warns].forEach(d =>
    console.log(`${(d.level === 'error' ? 'ERROR' : 'WARN').padEnd(6)} ${d.msg}${d.at ? `  [${d.at}]` : ''}`));

  const counts = `${t.nodes.length} node${t.nodes.length === 1 ? '' : 's'}, `
    + `${t.edges.length} link${t.edges.length === 1 ? '' : 's'}`;
  if (errs.length) console.log(`${counts}: ${errs.length} error${errs.length === 1 ? '' : 's'}, will not render as written`);
  else if (warns.length) console.log(`${counts}: renders, ${warns.length} warning${warns.length === 1 ? '' : 's'}`);
  else console.log(`${counts}: clean`);

  worst = Math.max(worst, errs.length ? 2 : warns.length ? 1 : 0);
}

process.exit(worst);
