#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeBase } from './diff-base.mjs';
import { renamesSince } from './doc-retired-terms-gate.mjs';
import { isRecordDoc } from './living-docs.mjs';

const root = resolve(import.meta.dirname, '..');
const BASELINE_REL = 'scripts/doc-refs-baseline.json';

const SKIP_DIRS = /^(node_modules|\.git)\//;
// Dated snapshots and vendored docs: references to since-removed files are
// historical fact there, not dangling pointers.
const SNAPSHOT_DOC =
  /(^|\/)(archive|changelog|upstream|vendor)\/|^(docs\/(research|verify|lessons)\/|docs\/adr\/)/;
const GENERATED_DOCS = new Set([
  'docs/feature-map.md',
  '.claude/skills/verify-cairn/feature-map.md',
  'docs/CANON.md',
  'scripts/test-tmpdir-inventory.md',
]);
const TOP_LEVEL =
  /^(apps|packages|docs|scripts|integration|eval|ops|\.github|\.claude|\.devin|\.cursor|\.codex|\.agents|site)\//;
const MD_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const CODE_SPAN = /`([^`\n]+)`/g;
const FENCE = /^(```|~~~)/;
const RANGE_SUFFIX = /:\d+(?:[-,/]\d+)*$/;
const GLOB_CHARS = /[{}*?[\]<>]/;

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

export function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, '-');
}

export function anchorsOf(text) {
  const seen = new Map();
  const anchors = new Set();
  let fence = null;
  for (const line of text.split('\n')) {
    const mark = line.trim().match(FENCE);
    if (mark) {
      fence = fence ? null : mark[1];
      continue;
    }
    if (fence) continue;
    const heading = /^#{1,6}\s+(.*)/.exec(line);
    if (!heading) continue;
    let slug = slugify(heading[1]);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    if (count > 0) slug = `${slug}-${count}`;
    anchors.add(slug);
  }
  return anchors;
}

function pathExists(tracked, sorted, path, allowScopePrefix = false) {
  const clean = path.replace(/\/$/, '');
  if (tracked.has(clean)) return true;
  const prefix = allowScopePrefix && !path.endsWith('/') ? clean : `${clean}/`;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo].startsWith(prefix);
}

export function collectViolations({ tracked, docs, readFile }) {
  const sorted = [...tracked].sort();
  const rows = [];
  for (const doc of docs) {
    const dir = dirname(doc);
    const skillRoot = /^\.claude\/skills\/[^/]+/.exec(doc)?.[0] ?? null;
    const text = readFile(doc);
    if (text === null) continue;
    const anchors = anchorsOf(text);
    let fence = null;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const mark = line.trim().match(FENCE);
      if (mark) {
        fence = fence ? null : mark[1];
        continue;
      }
      if (fence) continue;
      for (const m of line.matchAll(MD_LINK)) {
        const raw = m[1];
        if (URI_SCHEME.test(raw)) continue;
        if (raw.startsWith('#')) {
          if (!anchors.has(decodeURIComponent(raw.slice(1)))) {
            rows.push({ doc, line: i + 1, ref: raw, kind: 'anchor' });
          }
          continue;
        }
        const [target, anchor] = raw.split('#');
        const resolved = target.startsWith('/')
          ? target.slice(1)
          : resolve(`/${dir}`, target).slice(1);
        if (!tracked.has(resolved.replace(/\/$/, ''))) {
          rows.push({ doc, line: i + 1, ref: raw, kind: 'link', missing: resolved });
          continue;
        }
        if (anchor && resolved.endsWith('.md')) {
          const targetText = readFile(resolved);
          if (targetText !== null && !anchorsOf(targetText).has(decodeURIComponent(anchor))) {
            rows.push({ doc, line: i + 1, ref: raw, kind: 'anchor' });
          }
        }
      }
      for (const m of line.matchAll(CODE_SPAN)) {
        const span = m[1].trim();
        if (!span || /:\/\/|\$\{|^\$/.test(span)) continue;
        const token = span.split(/\s+/)[0].replace(RANGE_SUFFIX, '');
        const rooted = TOP_LEVEL.test(token);
        const explicitRelative = /^\.\.?\//.test(token);
        if (!rooted && !explicitRelative) continue;
        if (GLOB_CHARS.test(token)) continue;
        const path = token.replace(/[.,;:)'"`]+$/, '');
        const [pathPart, spanAnchor] = path.split('#');
        const relative = resolve(`/${dir}`, pathPart).slice(1);
        const underSkill = skillRoot ? `${skillRoot}/${pathPart}` : null;
        const allowScopePrefix = !spanAnchor && line.startsWith('Scope: ');
        const targetPath = [pathPart, relative, underSkill].find(
          (candidate) =>
            candidate !== null && pathExists(tracked, sorted, candidate, allowScopePrefix),
        );
        if (targetPath === undefined) {
          rows.push({
            doc,
            line: i + 1,
            ref: `\`${span}\``,
            kind: 'path',
            missing: explicitRelative ? relative : pathPart,
          });
          continue;
        }
        if (spanAnchor) {
          const targetText = targetPath.endsWith('.md') ? readFile(targetPath) : null;
          if (targetText !== null && !anchorsOf(targetText).has(decodeURIComponent(spanAnchor))) {
            rows.push({ doc, line: i + 1, ref: `\`${span}\``, kind: 'anchor' });
          }
        }
      }
    }
  }
  rows.sort((a, b) => a.doc.localeCompare(b.doc) || a.line - b.line);
  return rows;
}

export function filterIgnored(rows) {
  const candidates = [...new Set(rows.map((r) => r.missing).filter(Boolean))];
  if (candidates.length === 0) return rows;
  const run = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
    cwd: root,
    encoding: 'utf8',
    input: `${candidates.join('\0')}\0`,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0 && run.status !== 1) throw new Error(run.stderr);
  const ignored = new Set(
    (run.stdout ?? '')
      .split('\0')
      .filter(Boolean)
      .map((p) => p.replace(/\/$/, '')),
  );
  return rows.filter((r) => !r.missing || !ignored.has(r.missing.replace(/\/$/, '')));
}

export function gather(carried = new Set(), rev = null) {
  const listing = rev ? ['ls-tree', '-r', '--name-only', rev] : ['ls-files'];
  const files = git(listing).split('\n').filter(Boolean);
  const tracked = new Set(files.map((p) => p.replace(/\/$/, '')));
  for (const p of files) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) tracked.add(parts.slice(0, i).join('/'));
  }
  for (const ignored of git([
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '-z',
  ])
    .split('\0')
    .filter(Boolean)) {
    tracked.add(ignored.replace(/\/$/, ''));
  }
  const docs = files
    .filter(
      (p) =>
        p.endsWith('.md') &&
        !SKIP_DIRS.test(p) &&
        (carried.has(p) || !SNAPSHOT_DOC.test(p)) &&
        !GENERATED_DOCS.has(p),
    )
    .sort();
  const readFile = (path) => {
    try {
      if (rev) return files.includes(path) ? git(['show', `${rev}:${path}`]) : null;
      return readFileSync(join(root, path), 'utf8');
    } catch {
      return null;
    }
  };
  return { tracked, docs, readFile };
}

export const rowKey = (row) => `${row.doc}|${row.kind}|${row.ref}`;

const keyBefore = (key, renames) => {
  const at = key.indexOf('|');
  const doc = key.slice(0, at);
  return `${renames.get(doc) ?? doc}${key.slice(at)}`;
};

export function judge({ rows, baseline, baseBaseline, renames }) {
  const known = (key) => !baseBaseline || baseBaseline.has(keyBefore(key, renames));
  const fresh = rows.filter((row) => !baseline.has(rowKey(row)) || !known(rowKey(row)));
  const current = new Set(rows.map(rowKey));
  const grown = [...baseline].filter((key) => !known(key));
  const stale = [...baseline].filter((key) => !current.has(key)).length;
  return { fresh, grown, stale };
}

export function nextBaseline(rows, previous, renames) {
  const keys = [...new Set(rows.map(rowKey))];
  const added = previous
    ? keys.filter((key) => !previous.has(key) && !previous.has(keyBefore(key, renames)))
    : [];
  if (added.length > 0)
    throw new Error(
      `--write-baseline refuses to grow the baseline; fix these references:\n${added.join('\n')}`,
    );
  return keys;
}

export const judgedRows = (rows, demoted = new Set()) =>
  rows.filter((row) => demoted.has(row.doc) || !isRecordDoc(row.doc));

const isUnjudged = (path) => SNAPSHOT_DOC.test(path) || isRecordDoc(path);

export const demotedBy = (renames) =>
  new Set(
    [...renames]
      .filter(([target, origin]) => !isUnjudged(origin) && isUnjudged(target))
      .map(([target]) => target),
  );

const latestMove = (base, path) =>
  git([
    'log',
    '--first-parent',
    '--no-renames',
    '--diff-filter=A',
    '--format=%H',
    `${base}..HEAD`,
    '--',
    path,
  ]).split('\n')[0];

function brokenWhenMoved(demoted, moves) {
  const broken = new Set();
  for (const commit of new Set([...moves.values()].filter(Boolean))) {
    const snapshot = gather(demoted, commit);
    const docs = snapshot.docs.filter((doc) => moves.get(doc) === commit);
    for (const row of filterIgnored(collectViolations({ ...snapshot, docs })))
      broken.add(rowKey(row));
  }
  return broken;
}

export function brokenByTheMove(rows, demoted, base) {
  const moved = new Set(rows.filter((row) => demoted.has(row.doc)).map((row) => row.doc));
  const moves = new Map([...moved].map((doc) => [doc, latestMove(base, doc)]));
  const broken = brokenWhenMoved(demoted, moves);
  return rows.filter((row) => !moves.get(row.doc) || broken.has(rowKey(row)));
}

const baselineKeys = (text) => new Set(JSON.parse(text).rows);

function baselineAt(rev) {
  if (!git(['ls-tree', '--name-only', rev, '--', BASELINE_REL]).trim()) return null;
  return baselineKeys(git(['show', `${rev}:${BASELINE_REL}`]));
}

function resolveBase() {
  const configured = process.env.PREPUSH_BASE_SHA ?? 'origin/main';
  if (/^0{40}$/.test(configured)) return null;
  const base = mergeBase(root, configured);
  if (!base) throw new Error(`no merge-base between HEAD and ${configured}`);
  return base;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = process.argv.includes('--report');
  const base = resolveBase();
  const renames = base ? renamesSince(root, base, undefined, () => true) : new Map();
  const demoted = demotedBy(renames);
  const { tracked, docs, readFile } = gather(demoted);
  const rows = filterIgnored(collectViolations({ tracked, docs, readFile }));
  const judged = brokenByTheMove(judgedRows(rows, demoted), demoted, base);
  if (report) {
    const blocking = new Set(judged);
    for (const row of rows)
      process.stdout.write(
        `${row.doc}:${row.line} ${row.kind} ${row.ref}${blocking.has(row) ? '' : ' (record, leave it)'}\n`,
      );
    process.exit(0);
  }
  const baselinePath = join(root, BASELINE_REL);
  const committed = existsSync(baselinePath)
    ? baselineKeys(readFileSync(baselinePath, 'utf8'))
    : null;
  if (process.argv.includes('--write-baseline')) {
    const keys = nextBaseline(judged, committed, renames);
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ scope: 'doc|kind|ref keys allowed to stay broken', rows: keys }, null, 2)}\n`,
    );
    console.log(`[doc-refs-gate] wrote ${keys.length} baseline entries`);
    process.exit(0);
  }
  const { fresh, grown, stale } = judge({
    rows: judged,
    baseline: committed ?? new Set(),
    baseBaseline: base ? baselineAt(base) : null,
    renames,
  });
  if (fresh.length === 0 && grown.length === 0) {
    console.log(
      `[doc-refs-gate] ${docs.length} docs: ${judged.length} known stale references, no new broken ones; ` +
        `${rows.length - judged.length} in records (report only)` +
        (stale > 0
          ? `; ${stale} baseline entries resolved — re-run with --write-baseline to shrink`
          : ''),
    );
    process.exit(0);
  }
  for (const row of fresh)
    console.error(`${row.doc}:${row.line} ${row.kind} does not resolve: ${row.ref}`);
  for (const key of grown) console.error(`${BASELINE_REL}: baseline grew: ${key}`);
  console.error(
    `[doc-refs-gate] ${fresh.length} new broken doc references; fix the reference, the baseline only shrinks`,
  );
  process.exit(1);
}
