#!/usr/bin/env node
// Validate a Pathfinder canvas without opening the app.
//
// A thin CLI over the app's own js/normalize.js, so the rules cannot fork:
// what this script accepts is exactly what the canvas accepts, because they
// are the same code. Made for the write-back loop: an agent that emits a
// canvas (see llms.txt) can prove the file loads before handing it over.
//
// Usage:
//   node validate.mjs canvas.json        # a canvas JSON file
//   node validate.mjs -                  # read JSON from stdin
//   node validate.mjs '#s=...'           # a share hash, or a full share URL
//
// From any other repo, the published copy works standalone:
//   curl -sO https://pathfinder.neorgon.com/validate.mjs && node validate.mjs canvas.json
// When js/normalize.js is not next to this file, the app's copy is fetched
// from the live site, so a standalone run validates against the live rules.
//
// Exit codes: 0 clean · 1 items dropped or coerced (the canvas still loads,
// minus those items) · 2 unreadable input.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SITE = 'https://pathfinder.neorgon.com';
const here = dirname(fileURLToPath(import.meta.url));

const target = process.argv[2];
if (!target) {
  console.error("usage: node validate.mjs <canvas.json | - | '#s=...' | share-url>");
  process.exit(2);
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

// ── the app's normalizer: beside this file in a checkout, else the live site ─
let normalize;
try {
  normalize = await import(pathToFileURL(join(here, 'js', 'normalize.js')).href);
} catch {
  console.error(`js/normalize.js not found locally, fetching the app's copy from ${SITE}`);
  const cache = join(tmpdir(), 'pathfinder-validate', 'js');
  mkdirSync(cache, { recursive: true });
  for (const f of ['normalize.js', 'utils.js', 'neorgon-dom.js']) {
    writeFileSync(join(cache, f), await fetchText(`${SITE}/js/${f}`));
  }
  normalize = await import(pathToFileURL(join(cache, 'normalize.js')).href);
}

// ── read the input: file, stdin, share hash, or share URL ───────────────────
function decodeShare(hashOrUrl) {
  const m = hashOrUrl.match(/#s=(.+)$/);
  if (!m) return null;
  // The app encodes as btoa(encodeURIComponent(JSON)).
  return decodeURIComponent(Buffer.from(m[1], 'base64').toString('binary'));
}

let raw;
try {
  if (target === '-') raw = readFileSync(0, 'utf8');
  else if (target.includes('#s=')) raw = decodeShare(target);
  else raw = readFileSync(target, 'utf8');
  if (raw == null) throw new Error('no #s= payload in that argument');
} catch (e) {
  console.error(`could not read input: ${e.message}`);
  process.exit(2);
}

let data;
try { data = JSON.parse(raw); }
catch (e) {
  console.error(`not JSON: ${e.message}`);
  process.exit(2);
}

// ── validate: normalize, then explain everything that changed ───────────────
const clean = normalize.normalizeCanvas(data);
const problems = [];
const note = (level, msg) => problems.push({ level, msg });

const rawBlocks = Array.isArray(data.blocks)
  ? data.blocks
  : (data.blocks && typeof data.blocks === 'object' ? Object.values(data.blocks) : []);

rawBlocks.forEach((rb, i) => {
  const label = rb && (rb.title || rb.id) ? `"${rb.title || rb.id}"` : `#${i}`;
  const kept = rb && rb.id != null && clean.blocks[String(rb.id).trim()];
  if (!kept) {
    if (!rb || typeof rb !== 'object') note('DROP', `block ${label}: not an object`);
    else if (!String(rb.id ?? '').trim()) note('DROP', `block ${label}: missing id`);
    else note('DROP', `block ${label}: unknown type "${rb.type}"`);
    return;
  }
  const checks = [
    ['status', kept.status], ['priority', kept.priority], ['highlight', kept.highlight],
    ['cardStyle', kept.cardStyle],
  ];
  checks.forEach(([field, val]) => {
    if (rb[field] != null && val == null) note('COERCE', `block ${label}: ${field} "${rb[field]}" is not a known value, dropped`);
  });
  if (Array.isArray(rb.actions)) {
    rb.actions.forEach(a => { if (!kept.actions.includes(a)) note('COERCE', `block ${label}: action "${a}" is not a known value, dropped`); });
  }
  if (Array.isArray(rb.criteria) && rb.criteria.filter(c => String(c ?? '').trim()).length > kept.criteria.length) {
    note('COERCE', `block ${label}: some acceptance criteria were trimmed (max 30, 300 chars each)`);
  }
});

const rawArrows = Array.isArray(data.arrows) ? data.arrows : [];
rawArrows.forEach((ra, i) => {
  if (!ra || typeof ra !== 'object') { note('DROP', `arrow #${i}: not an object`); return; }
  const from = String(ra.from ?? '').trim(), to = String(ra.to ?? '').trim();
  if (!from || !to) { note('DROP', `arrow #${i}: missing from/to`); return; }
  if (from === to) { note('DROP', `arrow #${i}: from and to are the same block`); return; }
  const ids = new Set(Object.keys(clean.blocks));
  if (!ids.has(from) || !ids.has(to)) note('WARN', `arrow ${from} -> ${to}: endpoint not on this canvas (the app tolerates it, nothing renders)`);
  if (ra.style != null && !['curved','straight','elbow','routed','dashed','dotted'].includes(ra.style)) {
    note('COERCE', `arrow ${from} -> ${to}: style "${ra.style}" is not known, falls back to curved`);
  }
});

if (data.meta && typeof data.meta === 'object') {
  const p = data.meta.prompt;
  if (p && typeof p === 'object') {
    const cp = clean.meta.prompt;
    if (p.mode != null && p.mode !== cp.mode) note('COERCE', `meta.prompt.mode "${p.mode}" is not known, falls back to "${cp.mode}"`);
    if (p.tone != null && p.tone !== cp.tone) note('COERCE', `meta.prompt.tone "${p.tone}" is not known, falls back to "${cp.tone}"`);
    if (p.detail != null && p.detail !== cp.detail) note('COERCE', `meta.prompt.detail "${p.detail}" is not known, falls back to "${cp.detail}"`);
    if (Array.isArray(p.pre)) p.pre.forEach(v => { if (!cp.pre.includes(v)) note('COERCE', `meta.prompt.pre "${v}" is not known, dropped`); });
  }
}

// ── report ──────────────────────────────────────────────────────────────────
problems.forEach(p => console.log(`${p.level.padEnd(6)} ${p.msg}`));

const nb = Object.keys(clean.blocks).length;
const na = clean.arrows.length;
const drops = clean.dropped.blocks + clean.dropped.arrows + clean.dropped.groups;
console.log(`${nb} block${nb === 1 ? '' : 's'}, ${na} arrow${na === 1 ? '' : 's'}, ${Object.keys(clean.groups).length} group(s) load cleanly` +
  (drops ? `; ${drops} item${drops === 1 ? '' : 's'} dropped` : ''));

process.exit(problems.length ? 1 : 0);
