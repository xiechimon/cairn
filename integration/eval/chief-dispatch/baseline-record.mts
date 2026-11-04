import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WILSON_Z = 1.96;

export interface BaselineRow {
  grade?: Record<string, number>;
  cost_usd?: number;
  model?: string;
}

export interface MetricScore {
  id: string;
  successes: number;
  total: number;
  low: number | null;
  high: number | null;
}

export interface BaselineSummary {
  metrics: MetricScore[];
  costUsd: number;
  chainFailures: number;
  ceiling: boolean;
  harnessSha: string;
  model: string;
  recordedOn: string;
}

export interface WeeklyRow {
  recordedOn: string;
  flow: string;
  model: string;
  decisionOk: string;
  wilson: string;
  costUsd: string;
  chainFailures: string;
  harnessSha: string;
  ceiling: string;
}

type RecordVerdict =
  | { record: true }
  | { record: false; reason: 'harness_mismatch' | 'unknown_harness' };

type HarnessVerdict =
  | { record: true; harnessSha: string }
  | {
      record: false;
      reason: 'harness_mismatch' | 'unknown_harness';
      harnessSha: string;
      mainHarnessSha: string | null;
    };

function clampUnit(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function wilsonInterval(
  successes: number,
  total: number,
  z = WILSON_Z,
): { low: number; high: number } | null {
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(total) ||
    successes < 0 ||
    total < 0 ||
    successes > total
  ) {
    throw new Error(`invalid Wilson counts ${successes}/${total}`);
  }
  if (total === 0) return null;
  const ratio = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (ratio + z2 / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((ratio * (1 - ratio)) / total + z2 / (4 * total * total))) / denominator;
  return { low: clampUnit(center - margin), high: clampUnit(center + margin) };
}

export function harnessDigest(files: { path: string; bytes: Uint8Array }[]): string {
  const hash = createHash('sha256');
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of ordered) {
    hash.update(file.path).update('\0').update(file.bytes).update('\0');
  }
  return hash.digest('hex');
}

export function summarizeBaseline(input: {
  metricIds: string[];
  rows: BaselineRow[];
  chainFailures: number;
  harnessSha: string;
  model: string;
  recordedOn: string;
}): BaselineSummary {
  if (input.rows.length === 0) throw new Error('cannot record an empty baseline');
  if (input.rows.some((row) => row.model !== undefined && row.model !== input.model)) {
    throw new Error('result model does not match requested model');
  }
  const metrics = input.metricIds.map((id) => {
    let successes = 0;
    let total = 0;
    for (const row of input.rows) {
      const value = row.grade?.[id];
      if (value !== 0 && value !== 1) continue;
      total += 1;
      if (value === 1) successes += 1;
    }
    const interval = wilsonInterval(successes, total);
    return {
      id,
      successes,
      total,
      low: interval?.low ?? null,
      high: interval?.high ?? null,
    };
  });
  let costUsd = 0;
  for (const row of input.rows) {
    if (typeof row.cost_usd === 'number' && Number.isFinite(row.cost_usd)) costUsd += row.cost_usd;
  }
  const decision = metrics.find((metric) => metric.id === 'decision_ok');
  const ceiling =
    decision !== undefined && decision.total > 0 && decision.successes === decision.total;
  return {
    metrics,
    costUsd,
    chainFailures: input.chainFailures,
    ceiling,
    harnessSha: input.harnessSha,
    model: input.model,
    recordedOn: input.recordedOn,
  };
}

export function formatBaselineSection(summary: BaselineSummary): string {
  const lines = [
    `### Baseline (${summary.model}, ${summary.recordedOn})`,
    '',
    '| metric | score | 95% Wilson |',
    '|---|---|---|',
  ];
  for (const metric of summary.metrics) {
    const score =
      metric.total === 0
        ? 'n/a'
        : `${metric.successes}/${metric.total} = ${percent(metric.successes / metric.total)}`;
    const interval =
      metric.low === null || metric.high === null
        ? 'n/a'
        : `[${percent(metric.low)}, ${percent(metric.high)}]`;
    lines.push(`| \`${metric.id}\` | ${score} | ${interval} |`);
  }
  lines.push(
    '',
    `cost $${summary.costUsd.toFixed(2)}`,
    `chain failures ${summary.chainFailures} (excluded from the score)`,
    `harness_sha \`${summary.harnessSha}\``,
    `model \`${summary.model}\``,
    `date ${summary.recordedOn}`,
  );
  if (summary.ceiling) {
    lines.push(
      '`decision_ok` is at ceiling (every scored row passed). Harder families are tracked in #1773.',
    );
  }
  return lines.join('\n');
}

export function refuseBaselineRecord(input: {
  variant: string;
  harnessSha: string;
  mainHarnessSha: string | null;
}): RecordVerdict {
  if (input.variant !== 'baseline') return { record: true };
  if (input.mainHarnessSha === null || input.mainHarnessSha === '') {
    return { record: false, reason: 'unknown_harness' };
  }
  if (input.harnessSha !== input.mainHarnessSha) {
    return { record: false, reason: 'harness_mismatch' };
  }
  return { record: true };
}

export function judgeBaselineHarness(input: {
  variant: string;
  files: { path: string; worktree: Uint8Array; main: Uint8Array | null }[];
}): HarnessVerdict {
  const harnessSha = harnessDigest(
    input.files.map((file) => ({ path: file.path, bytes: file.worktree })),
  );
  const mainFiles: { path: string; bytes: Uint8Array }[] = [];
  for (const file of input.files) {
    if (file.main === null) {
      const decision = refuseBaselineRecord({
        variant: input.variant,
        harnessSha,
        mainHarnessSha: null,
      });
      if (!decision.record) return { ...decision, harnessSha, mainHarnessSha: null };
      return { record: true, harnessSha };
    }
    mainFiles.push({ path: file.path, bytes: file.main });
  }
  const mainHarnessSha = harnessDigest(mainFiles);
  const decision = refuseBaselineRecord({
    variant: input.variant,
    harnessSha,
    mainHarnessSha,
  });
  if (!decision.record) return { ...decision, harnessSha, mainHarnessSha };
  return { record: true, harnessSha };
}

export function upsertResultsSection(markdown: string, sectionBody: string): string {
  const heading = '## Results';
  const block = `${heading}\n\n${sectionBody.trim()}\n`;
  const source = markdown.endsWith('\n') ? markdown : `${markdown}\n`;
  const start = source.indexOf(`${heading}\n`);
  if (start === -1) {
    const separator = source.endsWith('\n\n') ? '' : '\n';
    return `${source}${separator}${block}`;
  }
  const after = source.slice(start + heading.length + 1);
  const next = after.search(/\n## /);
  const tail = next === -1 ? '' : after.slice(next + 1);
  return `${source.slice(0, start)}${block}${tail}`;
}

const WEEKLY_HEADER =
  '| date | flow | model | decision_ok | 95% Wilson | cost | chain failures | harness_sha | ceiling |\n|---|---|---|---|---|---|---|---|---|\n';

export function appendWeeklyRow(existing: string, row: WeeklyRow): string {
  const line = `| ${row.recordedOn} | ${row.flow} | ${row.model} | ${row.decisionOk} | ${row.wilson} | $${row.costUsd} | ${row.chainFailures} | \`${row.harnessSha}\` | ${row.ceiling} |\n`;
  const body =
    existing.trim().length === 0
      ? WEEKLY_HEADER
      : existing.endsWith('\n')
        ? existing
        : `${existing}\n`;
  return `${body}${line}`;
}

export function weeklyRowFromSummary(flow: string, summary: BaselineSummary): WeeklyRow {
  const decision = summary.metrics.find((metric) => metric.id === 'decision_ok');
  const decisionOk =
    decision === undefined || decision.total === 0
      ? 'n/a'
      : `${decision.successes}/${decision.total}`;
  const wilson =
    decision === undefined || decision.low === null || decision.high === null
      ? 'n/a'
      : `[${percent(decision.low)}, ${percent(decision.high)}]`;
  return {
    recordedOn: summary.recordedOn,
    flow,
    model: summary.model,
    decisionOk,
    wilson,
    costUsd: summary.costUsd.toFixed(2),
    chainFailures: String(summary.chainFailures),
    harnessSha: summary.harnessSha,
    ceiling: summary.ceiling ? 'ceiling' : '',
  };
}

export function countJsonlRows(text: string): number {
  let count = 0;
  for (const line of text.split('\n')) {
    if (line.trim()) count += 1;
  }
  return count;
}

export function parseResultRows(text: string): BaselineRow[] {
  const rows: BaselineRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as BaselineRow);
  }
  return rows;
}

function readOptional(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export function recordWeekly(options: {
  flow: string;
  resultsPath: string;
  errorsPath: string;
  statePath: string;
  tablePath: string;
  model: string;
  recordedOn: string;
  metricsPath?: string;
  repoRoot?: string;
}): BaselineSummary {
  const state = JSON.parse(readFileSync(options.statePath, 'utf8')) as {
    metrics?: { id: string }[];
    harness_sha?: string;
    harness_paths?: string[];
  };
  if (!state.harness_paths?.length) throw new Error('missing harness provenance');
  const repoRoot = options.repoRoot ?? process.cwd();
  const paths = [
    ...new Set(['integration/eval/chief-dispatch/run-eval.mts', ...state.harness_paths]),
  ];
  const files = paths.map((path) => ({
    path,
    worktree: readFileSync(resolve(repoRoot, path)),
    main: execFileSync('git', ['show', `origin/main:${path}`], { cwd: repoRoot }),
  }));
  const verdict = judgeBaselineHarness({ variant: 'baseline', files });
  if (!verdict.record || verdict.harnessSha !== state.harness_sha) {
    throw new Error('harness provenance does not match main and the recorded run');
  }
  const summary = summarizeBaseline({
    metricIds: (state.metrics ?? []).map((metric) => metric.id),
    rows: parseResultRows(readFileSync(options.resultsPath, 'utf8')),
    chainFailures: countJsonlRows(readOptional(options.errorsPath)),
    harnessSha: typeof state.harness_sha === 'string' ? state.harness_sha : '',
    model: options.model,
    recordedOn: options.recordedOn,
  });
  const table = existsSync(options.tablePath) ? readFileSync(options.tablePath, 'utf8') : '';
  writeFileSync(
    options.tablePath,
    appendWeeklyRow(table, weeklyRowFromSummary(options.flow, summary)),
  );
  if (options.metricsPath) {
    const current = existsSync(options.metricsPath)
      ? readFileSync(options.metricsPath, 'utf8')
      : '';
    writeFileSync(
      options.metricsPath,
      upsertResultsSection(current, formatBaselineSection(summary)),
    );
  }
  return summary;
}

function optionValue(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

function recordFromArgv(argv: string[]): void {
  const summary = recordWeekly({
    flow: optionValue(argv, '--flow'),
    resultsPath: optionValue(argv, '--results'),
    errorsPath: optionValue(argv, '--errors'),
    statePath: optionValue(argv, '--state'),
    tablePath: optionValue(argv, '--table'),
    model: optionValue(argv, '--model'),
    recordedOn: optionValue(argv, '--date'),
    ...(argv.includes('--metrics') ? { metricsPath: optionValue(argv, '--metrics') } : {}),
  });
  process.stdout.write(`${formatBaselineSection(summary)}\n`);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const command = process.argv[2];
  if (command !== 'record') {
    process.stderr.write(
      'usage: baseline-record.mts record --flow ID --results PATH --errors PATH --state PATH --table PATH --model ID --date YYYY-MM-DD [--metrics PATH]\n',
    );
    process.exit(2);
  }
  try {
    recordFromArgv(process.argv.slice(3));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
