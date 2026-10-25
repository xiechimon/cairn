#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { stripCodeComments } from './ui-normalize.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const WEB_SRC = join(REPO_ROOT, 'apps/web/src');
const LEDGER_PATH = join(REPO_ROOT, 'scripts/ui-consumer-registry.json');
const rel = (p) => relative(REPO_ROOT, p);

const failures = [];
const fatal = (msg) => {
  console.error(`[ui-consumer-shape-gate] FATAL: ${msg}`);
  process.exit(2);
};

let ledger;
try {
  ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
} catch (err) {
  fatal(`cannot read/parse ${rel(LEDGER_PATH)}: ${err.message}`);
}
const KINDS = new Set(['deviation', 'rides-primitive', 'state-surface']);
const boxEntries = ledger.squareBoxes;
if (!Array.isArray(boxEntries)) fatal('squareBoxes must be an array');
const seenKeys = new Set();
for (const entry of boxEntries) {
  for (const field of ['file', 'anchor', 'kind', 'reason']) {
    if (typeof entry[field] !== 'string' || entry[field] === '') {
      fatal(`squareBoxes entry ${JSON.stringify(entry).slice(0, 120)}: missing ${field}`);
    }
  }
  if (!KINDS.has(entry.kind)) fatal(`unknown kind ${entry.kind}`);
  if (entry.kind === 'rides-primitive' && !(typeof entry.basis === 'string' && entry.basis)) {
    fatal(`rides-primitive entry ${entry.file} (${entry.anchor}): basis required`);
  }
  const key = `${entry.file}\u0000${entry.anchor}`;
  if (seenKeys.has(key)) fatal(`duplicate entry ${entry.file} (${entry.anchor})`);
  seenKeys.add(key);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path.endsWith('components/ui')) continue;
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(path) && !path.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

const files = walk(WEB_SRC);
if (files.length === 0) fatal(`no source files under ${rel(WEB_SRC)}`);

const tokensOf = (line) => line.split(/[\s"'`]+/).filter(Boolean);
const isBare = (tok) => !tok.includes(':');

const BG_NONE = new Set(['bg-transparent', 'bg-none']);
const isBgPaint = (tok) =>
  tok.startsWith('bg-') && !BG_NONE.has(tok) && !tok.startsWith('bg-clip-');

const isBorderPaint = (tok) =>
  tok === 'border' || /^border-\d/.test(tok) || /^border-\[\d/.test(tok);

const isShadowPaint = (tok) =>
  (tok.startsWith('shadow-') && tok !== 'shadow-none') || tok.startsWith('[box-shadow:');

const isRingPaint = (tok) =>
  tok === 'ring' || (tok.startsWith('ring-') && !/^ring-(0|inset|offset)/.test(tok));

const isRounded = (tok) => tok.startsWith('rounded-') || tok.startsWith('rounded[');

function classifyLine(line) {
  const tokens = tokensOf(line);
  const bare = tokens.filter(isBare);
  const paint =
    bare.some(isBgPaint) ||
    bare.some(isBorderPaint) ||
    bare.some(isShadowPaint) ||
    bare.some(isRingPaint);
  if (bare.includes('rounded-none') && paint) return 'R1';
  const declaresRadius = bare.some(isRounded);
  if (!declaresRadius && bare.some(isBorderPaint) && bare.some(isBgPaint)) return 'R2';
  return null;
}

const hits = [];
const linesByFile = new Map();
for (const path of files) {
  const stripped = stripCodeComments(readFileSync(path, 'utf8'));
  const lines = stripped.split('\n');
  linesByFile.set(path, lines);
  for (let i = 0; i < lines.length; i++) {
    const rule = classifyLine(lines[i]);
    if (rule) hits.push({ path, lineNo: i + 1, rule, text: lines[i] });
  }
}

const hitKeys = new Set();
for (const hit of hits) {
  const covering = boxEntries.filter(
    (entry) => entry.file === rel(hit.path) && hit.text.includes(entry.anchor),
  );
  if (covering.length === 0) {
    failures.push(
      `[ui-consumer-shape-gate] ${hit.rule} ${rel(hit.path)}:${hit.lineNo}: square box with no registry basis and no ledger entry — point it at a registry component, ride the registry default radius, or register a deviation with a reason in scripts/ui-consumer-registry.json (#1054, ADR 0012 D1).\n    ${hit.text.trim().slice(0, 160)}`,
    );
  } else {
    for (const entry of covering) hitKeys.add(`${entry.file}\u0000${entry.anchor}`);
  }
}

for (const entry of boxEntries) {
  const key = `${entry.file}\u0000${entry.anchor}`;
  if (!hitKeys.has(key)) {
    failures.push(
      `[ui-consumer-shape-gate] STALE ${entry.file} (${entry.anchor}): ledger entry matches no flagged line — the site was fixed, deleted, or reworded; drop or re-anchor the entry in the same PR.`,
    );
  }
  const target = join(REPO_ROOT, entry.file);
  if (!linesByFile.has(target)) {
    failures.push(
      `[ui-consumer-shape-gate] STALE ${entry.file}: file is not in the scanned consumer territory.`,
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.log(failure);
  console.log(
    `[ui-consumer-shape-gate] FAIL: ${hits.length} flagged line(s), ${failures.length} violation(s). Caliber + inventory: docs/spec/27-消费点形状与品牌墨台账.md.`,
  );
  process.exit(1);
}

const byKind = boxEntries.reduce((acc, entry) => {
  acc[entry.kind] = (acc[entry.kind] ?? 0) + 1;
  return acc;
}, {});
console.log(
  `[ui-consumer-shape-gate] PASS: ${hits.length} flagged line(s) across ${files.length} consumer file(s), all registered (${boxEntries.length} entries = ${Object.entries(
    byKind,
  )
    .map(([k, n]) => `${n} ${k}`)
    .join(' / ')}).`,
);
