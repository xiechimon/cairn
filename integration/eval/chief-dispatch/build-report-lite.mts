#!/usr/bin/env node
// Lite report builder for the build-eval / hillclimb loop: a single static
// report.html with no vendored runtime, fonts, or markdown engine.
//
//   node build-report-lite.mts .claude/hillclimb/<flow>/
//
// Reads the same on-disk layout as build-report.mjs (baseline/, v<N>/,
// results.jsonl, errors.jsonl, change.md, summary.json, traces/, _state.json)
// and derives the same numbers: per-variant mean of the primary metric over
// status-ok rows, per-case means, split (train/val/test) from _state.json,
// failed-attempt counts from errors.jsonl. It also writes
// trajectory/scores.tsv exactly as the full builder does, so hillclimb's
// per-round bookkeeping is identical whichever builder ran.
//
// What it deliberately does not do: render markdown, inline transcripts or
// attachments, or execute anything from the data. Every string from disk is
// HTML-escaped; traces are linked by relative path, not embedded. Sorting is
// a few lines of inline script over the rendered table only.
//
// Runs under node or bun. Node builtins only.

import {
  closeSync,
  constants as FS,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Everything read from disk is untrusted JSON, so fields are typed wide
// (optional / unknown) and narrowed at use. Internal shapes (rows, agg,
// cases) are exact so the compiler catches wiring mistakes.
type ResultRow = {
  prompt_id?: unknown;
  id?: unknown;
  case_id?: unknown;
  rep?: unknown;
  model?: unknown;
  status?: unknown;
  tags?: unknown;
  prompt?: unknown;
  grade?: unknown;
  explanation?: unknown;
};

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
// readText/readJSON refuse symlinks, like the full builder's lib/adapter.mjs:
// the flow dir is model-influenced, and a prompt-injected agent could plant
// `summary.json -> ~/.ssh/id_rsa`; the user later runs this builder (outside
// any sandbox) and the target lands in the shareable report.html. Open
// O_NOFOLLOW and fstat the fd (not lstat-then-read) so a concurrent writer
// can't swap in a symlink between the check and the read.
const readText = (p: string): string => {
  let fd: number | undefined;
  try {
    fd = openSync(p, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
    if (!fstatSync(fd).isFile()) return '';
    return readFileSync(fd, 'utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};
function readJSON<T>(p: string, dflt: T): T {
  try {
    return JSON.parse(readText(p)) as T;
  } catch {
    return dflt;
  }
}
const esc = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
const fmt = (x: number | null): string => (x == null ? '' : x.toFixed(3));
// TSV id cells come from untrusted results.jsonl: strip the separators that
// would forge rows/columns in trajectory/scores.tsv, and neutralize a leading
// formula trigger so spreadsheet apps don't execute '=WEBSERVICE(...)' on
// open. Mirrored in the full builder's lib/adapter.mjs so both emit
// byte-identical scores.tsv.
const tsvCell = (s: string): string => {
  const flat = s.replace(/[\t\n\r]/g, ' ');
  return /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
};

// Variant directories: exactly `baseline` or `v<N>`, numeric order.
function discoverVariants(flow: string): string[] {
  const names = readdirSync(flow, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^(baseline|v\d+)$/.test(e.name))
    .map((e) => e.name);
  const rank = (n: string) => (n === 'baseline' ? -1 : +n.slice(1));
  return names.sort((a, b) => rank(a) - rank(b));
}

// Mirrors the full adapter: an object of numeric/boolean grades, a bare
// boolean, or a bare number (-> {score}).
function coerceScores(g: unknown): Record<string, number> {
  if (g && typeof g === 'object' && !Array.isArray(g)) {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(g)) if (isNum(v) || typeof v === 'boolean') out[k] = +v;
    return out;
  }
  if (typeof g === 'boolean') return { score: g ? 1 : 0 };
  if (isNum(g)) return { score: g };
  return {};
}

/** results.jsonl rows for one variant, keyed by the data-supplied prompt id. */
type RowsById = Record<string, ResultRow[]>;
/** Variant dir name -> its rows. Every entry of `variants` gets one. */
type Rows = Record<string, RowsById>;
/** Stand-in for a variant with no rows entry. Never mutated. */
const NO_ROWS: RowsById = {};

function loadRows(p: string, warnings: string[], dir: string): RowsById {
  // Keyed by data-supplied ids: null-prototype so '__proto__' is a key, not a crash.
  const byId: RowsById = Object.create(null);
  readText(p)
    .split('\n')
    .forEach((line, i) => {
      line = line.trim();
      if (!line) return;
      let r: ResultRow;
      try {
        r = JSON.parse(line) as ResultRow;
      } catch {
        warnings.push(`${dir}/results.jsonl:${i + 1}: malformed JSON, skipped`);
        return;
      }
      const pid = String(r.prompt_id ?? r.id ?? r.case_id ?? '');
      if (!pid) {
        warnings.push(`${dir}/results.jsonl:${i + 1}: no prompt_id, skipped`);
        return;
      }
      if (byId[pid] === undefined) byId[pid] = [];
      byId[pid].push(r);
    });
  return byId;
}

type ErrorCounts = { total: number; byClass: Record<string, number> };
function countErrors(vdir: string): ErrorCounts {
  let total = 0;
  const byClass: Record<string, number> = Object.create(null);
  for (const line of readText(join(vdir, 'errors.jsonl')).split('\n')) {
    if (!line.trim()) continue;
    let e: { failure_class?: unknown };
    try {
      e = JSON.parse(line) as { failure_class?: unknown };
    } catch {
      continue;
    }
    total++;
    const c = String(e?.failure_class ?? 'error');
    byClass[c] = (byClass[c] || 0) + 1;
  }
  return { total, byClass };
}

// Inferred metrics, mirroring the full builder's inferMetrics: any
// explanation for a key -> judge, all-0/1 values -> binary, else float;
// first-seen order.
type MetricKind = 'judge' | 'binary' | 'float';
function inferMetrics(rows: Rows, variants: string[]): { id: string; kind: MetricKind }[] {
  const seen = new Map<string, { binary: boolean; judge: boolean }>();
  for (const v of variants)
    for (const reps of Object.values(rows[v] ?? NO_ROWS))
      for (const r of reps) {
        const expl = r.explanation && typeof r.explanation === 'object' ? r.explanation : {};
        for (const [k, val] of Object.entries(coerceScores(r.grade))) {
          const m = seen.get(k) ?? { binary: true, judge: false };
          if (val !== 0 && val !== 1) m.binary = false;
          if (k in expl) m.judge = true;
          seen.set(k, m);
        }
      }
  return [...seen.entries()].map(([id, s]) => ({
    id,
    kind: s.judge ? ('judge' as const) : s.binary ? ('binary' as const) : ('float' as const),
  }));
}

// _state.json drives the split, the declared metrics and the `best` marker.
// Read as untrusted JSON: every field optional/unknown, narrowed at use.
type FlowState = {
  metrics?: unknown;
  criteria?: unknown;
  best?: { round?: unknown };
  [key: string]: unknown;
};

/** A metric id, plus the kind declared alongside it in _state.json if any. */
type Metric = { id: string; kind?: unknown };

/** summary.json, written by the loop; only `model` is read out of it. */
type Summary = { model?: unknown };

/** One row of the variants table. `model` is whatever summary.json held. */
type Header = { change: string; model: unknown; errors: ErrorCounts };

/** A trace link under a case cell. `rep` is whatever results.jsonl held. */
type Trace = { rep: unknown; rel: string };

/** One variant's numbers for one case. */
type CasePer = { mean: number | null; reps: number; truncated: number; traces: Trace[] };

/** One row of the cases table; `per` is keyed by variant dir name. */
type CaseRow = {
  id: string;
  split: string;
  tags: string[];
  prompt: string;
  per: Record<string, CasePer>;
};

/** One row of the variants table's aggregates. */
type Agg = {
  all: number | null;
  n: number;
  test: number | null;
  nTest: number;
  truncated: number;
};

function build(flowArg: string) {
  const flow = resolve(flowArg);
  if (!statSync(flow, { throwIfNoEntry: false })?.isDirectory())
    throw new Error(`not a directory: ${flow}`);
  const variants = discoverVariants(flow);
  if (!variants.length)
    throw new Error(`no variant directories (baseline/, v1/, ...) under ${flow}`);
  const warnings: string[] = [];
  // Same warning the full builder gives: a mis-named variant dir is the usual
  // reason the header shows one variant fewer than expected.
  const nonVariant = new Set([
    'trajectory',
    'attachments',
    'refs',
    'ref',
    'inputs',
    'out',
    '__pycache__',
  ]);
  for (const e of readdirSync(flow, { withFileTypes: true }))
    if (
      e.isDirectory() &&
      !variants.includes(e.name) &&
      !nonVariant.has(e.name) &&
      !e.name.startsWith('.') &&
      !e.name.startsWith('_')
    )
      warnings.push(
        "ignored directory '" +
          e.name +
          "/' - variant dirs must be named 'baseline' or 'v<N>'; put the descriptive name in change.md's first line instead",
      );
  const state: FlowState = readJSON<FlowState>(join(flow, '_state.json'), {}) || {};

  const splitOf: Record<string, string> = Object.create(null);
  for (const sp of ['train', 'val', 'test']) {
    const ids = state[`${sp}_ids`];
    for (const pid of Array.isArray(ids) ? ids : []) splitOf[String(pid)] = sp;
  }

  const rows: Rows = Object.create(null);
  for (const v of variants) rows[v] = loadRows(join(flow, v, 'results.jsonl'), warnings, v);

  // Same as the full builder: drop non-baseline variants with zero result
  // rows (a vN/ holding only change.md while the run warms up would render a
  // blank column), and refuse to build when the first variant itself has none
  // rather than overwrite a good trajectory/scores.tsv with a header-only file.
  for (let i = variants.length - 1; i > 0; i--) {
    const v = variants[i] as string;
    if (Object.keys(rows[v] ?? NO_ROWS).length) continue;
    warnings.push(
      `${v}: zero result rows - dropping (run not started or results.jsonl missing/empty)`,
    );
    variants.splice(i, 1);
  }
  const firstVariant = variants[0] as string;
  if (!Object.keys(rows[firstVariant] ?? NO_ROWS).length)
    throw new Error(`${firstVariant}/ has no result rows under ${flow} - nothing to report`);

  const header: Record<string, Header> = Object.create(null);
  for (const v of variants) {
    const vdir = join(flow, v);
    const change =
      readText(join(vdir, 'change.md'))
        .split('\n')
        .find((l) => l.trim()) || '';
    const summary: Summary = readJSON<Summary>(join(vdir, 'summary.json'), {}) || {};
    // Model: summary.json wins, else the most common row.model (what the app called).
    const tally: Record<string, number> = Object.create(null);
    for (const reps of Object.values(rows[v] ?? NO_ROWS))
      for (const r of reps)
        if (typeof r.model === 'string') tally[r.model] = (tally[r.model] || 0) + 1;
    const rowModel = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    header[v] = {
      change: change.replace(/^#+\s*/, ''),
      model: summary.model || rowModel,
      errors: countErrors(vdir),
    };
  }

  // Metrics: _state.json `metrics` (or the legacy `criteria` key) wins,
  // keeping each declared `kind`; else inferred from grade keys. Primary is
  // the first declared-or-inferred binary metric, else the first - the same
  // selection the full builder's lib/adapter.mjs makes, so both builders
  // report the same metric's numbers on the same flow.
  // Declared entries are bare ids or {id, kind}: the id is only ever used as a
  // property key or a label, so it is normalized to a string here.
  const metricsCfg = state.metrics || state.criteria;
  const declared: Metric[] = (Array.isArray(metricsCfg) ? metricsCfg : [])
    .map((m: unknown): Metric => {
      if (typeof m === 'string') return { id: m };
      const { id, kind } = (m ?? {}) as { id?: unknown; kind?: unknown };
      return { id: String(id ?? ''), kind };
    })
    .filter((m) => m.id);
  const metrics: Metric[] = declared.length ? declared : inferMetrics(rows, variants);
  if (!metrics.length) metrics.push({ id: 'score', kind: 'float' });
  const primary = (metrics.find((m) => m.kind === 'binary') || metrics[0])?.id ?? '';

  // Cases: union of ids across variants, in first-seen order.
  const ids: string[] = [];
  const seenId = new Set<string>();
  for (const v of variants)
    for (const pid of Object.keys(rows[v] ?? NO_ROWS))
      if (!seenId.has(pid)) {
        seenId.add(pid);
        ids.push(pid);
      }

  const okReps = (reps: ResultRow[]) => reps.filter((r) => r.status == null || r.status === 'ok');
  const caseMean = (reps: ResultRow[], m: string): number | null => {
    const vals = okReps(reps)
      .map((r) => coerceScores(r.grade)[m])
      .filter(isNum);
    return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  };
  const cases: CaseRow[] = ids.map((pid) => {
    const first: ResultRow =
      variants.map((v) => (rows[v] ?? NO_ROWS)[pid]?.[0]).find(Boolean) || {};
    const tags = Array.isArray(first.tags) ? first.tags.map(String) : [];
    const per: Record<string, CasePer> = {};
    for (const v of variants) {
      const reps = (rows[v] ?? NO_ROWS)[pid] ?? [];
      per[v] = {
        mean: caseMean(reps, primary),
        reps: reps.length,
        truncated: reps.filter((r) => r.status === 'truncated').length,
        traces: reps
          .map((r, k): Trace | null => {
            // Link only to files directly inside this variant's traces/ dir:
            // ids and reps come from results.jsonl (data, not trusted), so the
            // composed path must not resolve anywhere else, and a symlinked
            // trace must not become a link out of the tree. Keep the rep
            // number so the link label matches the file it points at even when
            // earlier reps have no trace. For rep 0 also accept the flat
            // traces/<id>.json a single-rep runner may write (the full builder
            // reads it as rep 0 too).
            const rep = r.rep ?? k;
            const repStem = `${pid}_rep${String(rep)}`;
            const stems = Number(rep) === 0 ? [repStem, pid] : [repStem];
            for (const stem of stems) {
              const rel = `${v}/traces/${stem}.json`;
              const abs = resolve(flow, rel);
              if (dirname(abs) !== join(flow, v, 'traces')) return null;
              if (lstatSync(abs, { throwIfNoEntry: false })?.isFile()) return { rep, rel };
            }
            return null;
          })
          .filter((t): t is Trace => t !== null),
      };
    }
    return { id: pid, split: splitOf[pid] || '', tags, prompt: String(first.prompt ?? ''), per };
  });

  // Per-variant aggregate: mean over cases that have a value, per split.
  const agg: Record<string, Agg> = {};
  for (const v of variants) {
    const all = cases.map((c) => c.per[v]?.mean).filter(isNum);
    const test = cases
      .filter((c) => c.split === 'test')
      .map((c) => c.per[v]?.mean)
      .filter(isNum);
    const m = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    agg[v] = {
      all: m(all),
      n: all.length,
      test: m(test),
      nTest: test.length,
      truncated: cases.reduce((s, c) => s + (c.per[v]?.truncated ?? 0), 0),
    };
  }

  // trajectory/scores.tsv - same shape as the full builder.
  mkdirSync(join(flow, 'trajectory'), { recursive: true });
  const tsv: string[] = [['id', 'split', ...variants].join('\t')];
  for (const c of cases)
    tsv.push(
      [
        tsvCell(c.id),
        tsvCell(c.split || 'all'),
        ...variants.map((v) => fmt(c.per[v]?.mean ?? null)),
      ].join('\t'),
    );
  writeFileSync(join(flow, 'trajectory', 'scores.tsv'), `${tsv.join('\n')}\n`);

  // _state.json's `best` is {round, test_score}; map the round to a variant
  // name the way the full builder does (0 = baseline), and drop it when the
  // named variant isn't on disk.
  let best: string | null = null;
  const bestRound = state.best?.round;
  if (typeof bestRound === 'number' && Number.isInteger(bestRound)) {
    best = bestRound === 0 ? 'baseline' : `v${bestRound}`;
    if (!variants.includes(best)) best = null;
  }

  const html = render({
    flow,
    variants,
    header,
    agg,
    cases,
    primary,
    metrics: metrics.map((m) => m.id),
    warnings,
    best,
  });
  writeFileSync(join(flow, 'report.html'), html);
  return { variants: variants.length, cases: cases.length, warnings };
}

/** Everything render() needs; all of it is built above in build(). */
type RenderInput = {
  flow: string;
  variants: string[];
  header: Record<string, Header>;
  agg: Record<string, Agg>;
  cases: CaseRow[];
  primary: string;
  metrics: string[];
  warnings: string[];
  best: string | null;
};

function render({
  flow,
  variants,
  header,
  agg,
  cases,
  primary,
  metrics,
  warnings,
  best,
}: RenderInput) {
  const hasSplit = cases.some((c) => c.split);
  const hasTest = variants.some((v) => (agg[v]?.nTest ?? 0) > 0);
  const th = (label: string, key: string) => `<th data-k="${esc(key)}">${esc(label)}</th>`;

  const variantRows = variants
    .map((v) => {
      // build() fills both records for every entry of `variants`.
      const h = header[v] as Header,
        a = agg[v] as Agg;
      const err = h.errors.total
        ? h.errors.total +
          ' (' +
          Object.entries(h.errors.byClass)
            .map(([k, n]) => `${esc(k)} ${n}`)
            .join(', ') +
          ')'
        : '0';
      return (
        '<tr' +
        (best === v ? ' class="best"' : '') +
        '><td>' +
        esc(v) +
        (best === v ? ' <span class="pill">best</span>' : '') +
        '</td>' +
        '<td>' +
        esc(h.change) +
        '</td><td>' +
        esc(h.model) +
        '</td>' +
        '<td class="num">' +
        fmt(a.all) +
        '</td><td class="num">' +
        a.n +
        '</td>' +
        (hasTest ? `<td class="num">${fmt(a.test)}</td><td class="num">${a.nTest}</td>` : '') +
        '<td class="num">' +
        a.truncated +
        '</td><td>' +
        err +
        '</td></tr>'
      );
    })
    .join('\n');

  const caseRows = cases
    .map((c) => {
      const cells = variants
        .map((v) => {
          // build() fills c.per for every entry of `variants`.
          const p = c.per[v] as CasePer;
          const links = p.traces
            .map((t) => `<a href="${esc(t.rel)}">rep${esc(t.rep)}</a>`)
            .join(' ');
          return (
            '<td class="num" data-v="' +
            fmt(p.mean) +
            '">' +
            fmt(p.mean) +
            (p.truncated ? ` <span class="pill warn">${p.truncated} truncated</span>` : '') +
            (links ? `<div class="links">${links}</div>` : '') +
            '</td>'
          );
        })
        .join('');
      const prompt = c.prompt.length > 600 ? `${c.prompt.slice(0, 600)}...` : c.prompt;
      return (
        '<tr><td class="id">' +
        esc(c.id) +
        '</td>' +
        (hasSplit ? `<td>${esc(c.split)}</td>` : '') +
        '<td>' +
        c.tags.map((t) => `<span class="pill">${esc(t)}</span>`).join(' ') +
        '</td>' +
        cells +
        '<td class="prompt"><details><summary>' +
        esc(prompt.split('\n')[0]?.slice(0, 80)) +
        '</summary><pre>' +
        esc(prompt) +
        '</pre></details></td></tr>'
      );
    })
    .join('\n');

  const warn = warnings.length
    ? '<section class="warnings"><h2>Warnings</h2><ul>' +
      warnings.map((w) => `<li>${esc(w)}</li>`).join('') +
      '</ul></section>'
    : '';

  return (
    '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' +
    esc(flow.split(/[\\/]/).pop()) +
    ' - eval report</title>' +
    '<style>' +
    CSS +
    '</style></head><body>' +
    '<header><h1>' +
    esc(flow.split(/[\\/]/).pop()) +
    '</h1>' +
    '<p class="meta">' +
    variants.length +
    ' variant' +
    (variants.length === 1 ? '' : 's') +
    ' &middot; ' +
    cases.length +
    ' cases' +
    ' &middot; primary metric <code>' +
    esc(primary) +
    '</code>' +
    (metrics.length > 1
      ? ' (also: ' +
        metrics
          .filter((m) => m !== primary)
          .map(esc)
          .join(', ') +
        ')'
      : '') +
    ' &middot; generated ' +
    new Date().toISOString().slice(0, 19).replace('T', ' ') +
    ' UTC' +
    ' &middot; lite report (no transcripts inlined; click rep links)</p></header>' +
    '<section><h2>Variants</h2><table><thead><tr>' +
    th('variant', 's') +
    th('change', 's') +
    th('model', 's') +
    th(`mean ${primary}`, 'n') +
    th('cases', 'n') +
    (hasTest ? th('test mean', 'n') + th('test cases', 'n') : '') +
    th('truncated', 'n') +
    th('failed attempts', 's') +
    '</tr></thead><tbody>' +
    variantRows +
    '</tbody></table></section>' +
    '<section><h2>Cases</h2><p class="hint">Click a column header to sort. Per-case values are the mean of <code>' +
    esc(primary) +
    '</code> over status-ok reps.</p>' +
    '<table id="cases"><thead><tr>' +
    th('id', 's') +
    (hasSplit ? th('split', 's') : '') +
    th('tags', 's') +
    variants.map((v) => th(v, 'n')).join('') +
    th('prompt', 's') +
    '</tr></thead><tbody>' +
    caseRows +
    '</tbody></table></section>' +
    warn +
    '<script>' +
    SORT_JS +
    '</script></body></html>\n'
  );
}

const CSS = [
  ':root{color-scheme:light dark;--fg:#1a1a1a;--bg:#fff;--muted:#666;--line:#ddd;--pill:#eee;--warn:#b45309;--best:#ecfdf5}',
  '@media(prefers-color-scheme:dark){:root{--fg:#e6e6e6;--bg:#121212;--muted:#9a9a9a;--line:#333;--pill:#2a2a2a;--warn:#f59e0b;--best:#0f2a1f}}',
  'body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg);margin:0;padding:24px;max-width:1400px}',
  'h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}.meta,.hint{color:var(--muted);margin:0 0 8px}',
  'table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}',
  'th{cursor:pointer;user-select:none;white-space:nowrap}th.asc:after{content:" \\25B4"}th.desc:after{content:" \\25BE"}',
  'td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}',
  '.pill{display:inline-block;background:var(--pill);border-radius:10px;padding:0 8px;font-size:12px}.pill.warn{color:var(--warn)}',
  'tr.best td{background:var(--best)}.links{font-size:12px}.links a{margin-right:6px}',
  'td.prompt{max-width:520px}details summary{cursor:pointer;color:var(--muted)}pre{white-space:pre-wrap;font-size:12px;margin:6px 0 0}',
  '.warnings{color:var(--warn)}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
].join('');

const SORT_JS = [
  'document.querySelectorAll("th[data-k]").forEach(function(th){th.addEventListener("click",function(){',
  'var t=th.closest("table"),tb=t.tBodies[0],i=Array.prototype.indexOf.call(th.parentNode.children,th);',
  'var asc=!th.classList.contains("asc");t.querySelectorAll("th").forEach(function(h){h.classList.remove("asc","desc")});',
  'th.classList.add(asc?"asc":"desc");var num=th.dataset.k==="n";',
  'var rows=Array.prototype.slice.call(tb.rows);rows.sort(function(a,b){var x=a.cells[i],y=b.cells[i];',
  'var u=num?parseFloat(x.dataset.v||x.textContent):x.textContent.trim().toLowerCase();',
  'var w=num?parseFloat(y.dataset.v||y.textContent):y.textContent.trim().toLowerCase();',
  'if(num){if(isNaN(u))u=-Infinity;if(isNaN(w))w=-Infinity}return (u<w?-1:u>w?1:0)*(asc?1:-1)});',
  'rows.forEach(function(r){tb.appendChild(r)})})});',
].join('');

const arg = process.argv[2];
if (!arg || arg === '-h' || arg === '--help') {
  console.error('usage: node build-report-lite.mts <flow-dir>   (e.g. .claude/hillclimb/<flow>/)');
  process.exit(arg ? 0 : 2);
}
try {
  const { variants, cases, warnings } = build(arg);
  for (const w of warnings) console.error(`warning: ${w}`);
  console.error(
    'wrote ' +
      join(resolve(arg), 'report.html') +
      ' (' +
      variants +
      ' variants, ' +
      cases +
      ' cases) and trajectory/scores.tsv',
  );
} catch (e) {
  // A thrown value is untrusted too: prefer its `message`, else stringify it.
  const msg = (e as { message?: unknown })?.message;
  console.error(`build-report-lite: ${String(msg || e)}`);
  process.exit(1);
}
