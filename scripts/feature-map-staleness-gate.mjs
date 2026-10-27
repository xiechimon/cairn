#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { daysBetween, loadRepoEvalCoverage, staleScoredFlows } from './eval-coverage.mjs';

const ROOT = process.cwd();
const FEATURES_DIR_DEFAULT = '.claude/skills/verify-cairn/features';
const SRC_DIR = 'apps/web/src';
const BASELINE_PATH = 'scripts/feature-map-staleness-baseline.json';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.herdr-project',
  'test-results',
  'playwright-report',
  'coverage',
  '.turbo',
  'worktrees',
]);
const PATH_EXT_RE = /^[\w@.\-/]+\.(tsx|ts|mts|cts|mjs|cjs|js|jsx|css|md|py|sh|svg)$/;
const CLASS_RE = /^\.[A-Za-z][\w-]*$/;
const ATTR_RE = /^\[(data-[\w-]+)(?:=([^\]]*))?\]$/;
const DECL_RE = /^([a-z-]+):([a-z0-9-]+)$/;
const CSS_PROPS = new Set(['display', 'visibility', 'overflow', 'position']);
const TW_EQUIV = {
  display: { contents: 'contents', none: 'hidden', flex: 'flex' },
  visibility: { hidden: 'invisible', visible: 'visible' },
};
const SRC_EXT_RE = /\.(tsx|ts|jsx|js|css)$/;

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walk(dir, rel, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (
        e.name.startsWith('.') &&
        e.name !== '.claude' &&
        e.name !== '.github' &&
        e.name !== '.cursor'
      )
        continue;
      walk(join(dir, e.name), `${rel}${e.name}/`, out);
    } else {
      out.push(`${rel}${e.name}`);
    }
  }
}

function stripComments(text, isCss) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (!isCss) t = t.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return t;
}

function parseArgs(argv) {
  const args = { noBaseline: false, writeBaseline: false, dir: null, today: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-baseline') args.noBaseline = true;
    else if (a === '--write-baseline') args.writeBaseline = true;
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--today') args.today = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`feature-map-gate: unknown arg ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'usage: node scripts/feature-map-staleness-gate.mjs [--no-baseline] [--write-baseline] [--dir <features-dir>] [--today YYYY-MM-DD]',
    );
    return 0;
  }

  const files = [];
  walk(ROOT, '', files);
  const fileSet = new Set(files);

  let src = '';
  const srcFiles = new Map();
  for (const f of files) {
    if (!f.startsWith(`${SRC_DIR}/`) || !SRC_EXT_RE.test(f)) continue;
    const text = stripComments(readFileSync(join(ROOT, f), 'utf8'), f.endsWith('.css'));
    srcFiles.set(f, text);
    src += `${text}\n`;
  }
  const hasWordIn = (corpus, w) => new RegExp(`\\b${esc(w)}\\b`).test(corpus);
  const hasWord = (w) => hasWordIn(src, w);

  const resolvePathTok = (tok) => {
    const t = tok.replace(/^\//, '');
    if (fileSet.has(t)) return t;
    const suffix = files.find((f) => f.endsWith(`/${t}`));
    if (suffix) return suffix;
    if (!t.includes('/')) {
      const lower = basename(t).toLowerCase();
      const hit = files.find((f) => basename(f).toLowerCase() === lower);
      if (hit) return hit;
    }
    return null;
  };

  const featuresDir = args.dir ?? join(ROOT, FEATURES_DIR_DEFAULT);
  const mdFiles = readdirSync(featuresDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const violations = new Map();
  let refsChecked = 0;

  const addViolation = (file, line, kind, symbol, reason) => {
    const key = `${file}\u0000${kind}\u0000${symbol}`;
    if (!violations.has(key)) violations.set(key, { file, line, kind, symbol, reason });
  };

  for (const md of mdFiles) {
    const lines = readFileSync(join(featuresDir, md), 'utf8').split('\n');
    lines.forEach((ln, idx) => {
      const spans = [...ln.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
      const line = idx + 1;

      let scope = null;
      for (const tok of spans) {
        if (!PATH_EXT_RE.test(tok) || tok.includes('<') || tok.includes('>')) continue;
        const r = resolvePathTok(tok);
        if (r && srcFiles.has(r)) scope = (scope ?? '') + srcFiles.get(r);
      }

      for (const tok of spans) {
        if (PATH_EXT_RE.test(tok) && !tok.includes('<') && !tok.includes('>')) {
          refsChecked++;
          if (resolvePathTok(tok) == null)
            addViolation(
              md,
              line,
              'path',
              tok,
              'no such file in repo (exact / path-suffix / basename all miss)',
            );
          continue;
        }

        if (CLASS_RE.test(tok)) {
          refsChecked++;
          if (!hasWord(tok.slice(1)))
            addViolation(
              md,
              line,
              'class',
              tok,
              'zero word-boundary hits in apps/web/src (comments stripped)',
            );
          continue;
        }

        const attr = tok.match(ATTR_RE);
        if (attr) {
          refsChecked++;
          const [, name, rawValue] = attr;
          if (!src.includes(`${name}=`)) {
            addViolation(
              md,
              line,
              'data-attr',
              tok,
              `attribute handle ${name}= not in apps/web/src`,
            );
            continue;
          }
          if (rawValue != null && rawValue !== '') {
            const variants = rawValue
              .split('|')
              .map((v) => v.trim().replace(/^["']|["']$/g, ''))
              .filter(Boolean);
            const dynamic = src.includes(`${name}={`);
            const ok = variants.some(
              (v) =>
                src.includes(`${name}="${v}"`) ||
                src.includes(`${name}='${v}'`) ||
                (dynamic && hasWord(v)),
            );
            if (!ok)
              addViolation(
                md,
                line,
                'data-attr',
                tok,
                `handle exists but value(s) ${variants.join(' / ')} neither literal nor dynamic-bound in apps/web/src`,
              );
          }
          continue;
        }

        const decl = tok.match(DECL_RE);
        if (decl && CSS_PROPS.has(decl[1])) {
          refsChecked++;
          const [, prop, value] = decl;
          const corpus = scope ?? src;
          const where = scope
            ? 'component-scoped apps/web/src files named on the same line'
            : 'apps/web/src';
          const declHit = new RegExp(`${prop}:\\s*['"]?${esc(value)}\\b`).test(corpus);
          const eq = TW_EQUIV[prop]?.[value];
          if (!declHit && !(eq && hasWordIn(corpus, eq)))
            addViolation(
              md,
              line,
              'css-decl',
              tok,
              `declaration zero-hit in ${where}${eq ? ` and tailwind equivalent .${eq} zero-hit` : ' (no tailwind equivalent known)'}`,
            );
        }
      }
    });
  }

  const all = [...violations.values()];
  const today = args.today ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    console.error('feature-map-gate: --today must be YYYY-MM-DD');
    return 2;
  }
  let evalFailed = false;
  try {
    const coverage = loadRepoEvalCoverage(ROOT);
    if (coverage.unlisted.length > 0) {
      evalFailed = true;
      const listed = coverage.unlisted.map((name) => `"${name}"`).join(', ');
      console.log(`feature-map-gate: hillclimb flow ${listed} has no capability row`);
    }
    for (const row of staleScoredFlows(coverage.rows, today)) {
      evalFailed = true;
      const age = daysBetween(row.date, today);
      console.log(
        `feature-map-gate: eval score for ${row.flow} is ${age} days old (${row.date}); re-run the flow`,
      );
    }
  } catch (error) {
    console.error(`feature-map-gate: ${error instanceof Error ? error.message : error}`);
    return 1;
  }
  if (args.writeBaseline) {
    let prev = { entries: [] };
    if (existsSync(join(ROOT, BASELINE_PATH)))
      prev = JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), 'utf8'));
    const notes = new Map(
      prev.entries.map((e) => [`${e.file}\u0000${e.kind}\u0000${e.symbol}`, e.note]),
    );
    const entries = all.map((v) => ({
      file: v.file,
      kind: v.kind,
      symbol: v.symbol,
      line: v.line,
      ...(notes.has(`${v.file}\u0000${v.kind}\u0000${v.symbol}`)
        ? { note: notes.get(`${v.file}\u0000${v.kind}\u0000${v.symbol}`) }
        : {}),
    }));
    writeFileSync(
      join(ROOT, BASELINE_PATH),
      `${JSON.stringify({ $comment: 'feature-map staleness gate (#1160) frozen stock: entry = file+kind+symbol (line is a hint only; map line numbers drift); a new entry is new debt, and the PR must justify it; an entry turning green makes the gate red and asks for removal.', entries }, null, 2)}\n`,
    );
    console.log(
      `feature-map-gate: baseline written — ${entries.length} entries (${mdFiles.length} md files, ${refsChecked} refs checked)`,
    );
    return evalFailed ? 1 : 0;
  }

  let baseline = { entries: [] };
  if (!args.noBaseline && existsSync(join(ROOT, BASELINE_PATH)))
    baseline = JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), 'utf8'));
  const baseKeys = new Set(
    baseline.entries.map((e) => `${e.file}\u0000${e.kind}\u0000${e.symbol}`),
  );
  const fresh = args.noBaseline
    ? all
    : all.filter((v) => !baseKeys.has(`${v.file}\u0000${v.kind}\u0000${v.symbol}`));
  const allKeys = new Set(all.map((v) => `${v.file}\u0000${v.kind}\u0000${v.symbol}`));
  const staleBaseline = args.noBaseline
    ? []
    : baseline.entries.filter((e) => !allKeys.has(`${e.file}\u0000${e.kind}\u0000${e.symbol}`));

  if (fresh.length === 0 && staleBaseline.length === 0 && !evalFailed) {
    console.log(
      `feature-map-gate: OK (${mdFiles.length} md files, ${refsChecked} refs checked, ${baseKeys.size} frozen in baseline)`,
    );
    return 0;
  }

  if (fresh.length > 0) {
    console.log(
      `feature-map-gate: ${fresh.length} stale reference(s) beyond baseline (${mdFiles.length} md files, ${refsChecked} refs checked):`,
    );
    for (const v of fresh.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line))
      console.log(`  features/${v.file}:${v.line}: [${v.kind}] \`${v.symbol}\` — ${v.reason}`);
  }
  if (staleBaseline.length > 0) {
    console.log(
      `feature-map-gate: ${staleBaseline.length} baseline entry(ies) now green — remove from ${BASELINE_PATH}:`,
    );
    for (const e of staleBaseline) console.log(`  ${e.file} [${e.kind}] \`${e.symbol}\``);
  }
  return 1;
}

process.exit(main());
