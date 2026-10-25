#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const SRC_DIR = join(REPO_ROOT, 'apps/web/src');
const DEFAULT_DIST = join(REPO_ROOT, 'apps/web/dist');

const TOKEN_RE =
  /\b(?:animate-(?:in|out)|fade-(?:in|out)-[A-Za-z0-9._-]+|zoom-(?:in|out)-[A-Za-z0-9._-]+|slide-(?:in|out)-[A-Za-z0-9._-]+)/g;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html']);

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '\n')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules') walk(path, out);
    } else if ([...SOURCE_EXTENSIONS].some((ext) => entry.endsWith(ext))) {
      out.push(path);
    }
  }
  return out;
}

function collectTokens() {
  const tokens = new Set();
  for (const file of walk(SRC_DIR)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    for (const match of text.matchAll(TOKEN_RE)) tokens.add(match[0]);
  }
  return [...tokens].sort();
}

function readBuiltCss(distDir) {
  let entries;
  try {
    entries = readdirSync(join(distDir, 'assets'));
  } catch {
    return null;
  }
  const cssFiles = entries.filter((f) => f.endsWith('.css'));
  if (cssFiles.length === 0) return null;
  return {
    files: cssFiles,
    css: cssFiles.map((f) => readFileSync(join(distDir, 'assets', f), 'utf8')).join('\n'),
  };
}

const argv = process.argv.slice(2);
const distFlag = argv.indexOf('--dist');
const distDir = distFlag === -1 ? DEFAULT_DIST : resolve(argv[distFlag + 1] ?? '');

const tokens = collectTokens();
console.log(`[css-mechanism-gate] ${tokens.length} tw-animate-css tokens claimed in apps/web/src/`);
for (const token of tokens) console.log(`  claimed: ${token}`);

if (tokens.length === 0) {
  console.log('[css-mechanism-gate] PASS: no animation tokens claimed, nothing to compile.');
  process.exit(0);
}

const built = readBuiltCss(distDir);
if (built === null) {
  console.log(
    `[css-mechanism-gate] FAIL: no built CSS under ${join(distDir, 'assets')} — ` +
      'build first (CI: the e2e job fixture-builds before this step; ' +
      'local: vite build --mode fixture), then re-run.',
  );
  process.exit(1);
}
console.log(
  `[css-mechanism-gate] checking against ${built.files.length} built file(s): ${built.files.join(', ')}`,
);

const missing = tokens.filter((token) => !built.css.includes(token));
const keyframes = ['@keyframes enter', '@keyframes exit'].filter((kf) => !built.css.includes(kf));

if (missing.length === 0 && keyframes.length === 0) {
  console.log(
    '[css-mechanism-gate] PASS: every claimed token and the enter/exit keyframes are compiled.',
  );
  process.exit(0);
}

for (const token of missing) console.log(`[css-mechanism-gate] MISSING in built CSS: ${token}`);
for (const kf of keyframes) console.log(`[css-mechanism-gate] MISSING in built CSS: ${kf}`);
console.log(
  `[css-mechanism-gate] FAIL: ${missing.length} token(s) + ${keyframes.length} keyframe(s) ` +
    'claimed in source but absent from the bundle. ' +
    'Recent cause (#656): `tw-animate-css` not `@import`ed from the stylesheet ' +
    'that carries `@import "tailwindcss"` (apps/web/src/styles/app.css).',
);
process.exit(1);
