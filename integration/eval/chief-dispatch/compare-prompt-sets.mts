#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const Z_95 = 1.96;
const PASS_METRIC = 'decision_ok';
const SECONDARY_METRIC = 'receipt_ok';

export interface PromptSetResultRow {
  prompt_id: string;
  rep: number;
  status?: string;
  model?: string | null;
  in_tokens?: number;
  out_tokens?: number;
  cache_read_tokens?: number;
  cost_usd?: number;
  grade?: { decision_ok?: number; receipt_ok?: number };
  tags?: string[];
  meta?: { prompt_set?: string } | null;
}

export interface ArmInput {
  label: string;
  rows: PromptSetResultRow[];
  errorRows: number;
}

export function parsePromptSetRows(text: string): PromptSetResultRow[] {
  const rows: PromptSetResultRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as PromptSetResultRow);
  }
  return rows;
}

export function wilsonInterval(passes: number, n: number): { lo: number; hi: number } {
  if (!Number.isInteger(n) || n <= 0) throw new Error('wilsonInterval requires an integer n > 0');
  if (!Number.isInteger(passes) || passes < 0 || passes > n) {
    throw new Error('wilsonInterval passes out of range');
  }
  const p = passes / n;
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export function meanInterval(values: number[]): {
  mean: number;
  halfWidth: number;
  n: number;
} {
  const n = values.length;
  if (n === 0) throw new Error('meanInterval requires at least one value');
  const mean = values.reduce((s, x) => s + x, 0) / n;
  if (n === 1) return { mean, halfWidth: 0, n };
  const variance = values.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  return { mean, halfWidth: Z_95 * Math.sqrt(variance / n), n };
}

const isOkRow = (row: PromptSetResultRow): boolean =>
  row.status === undefined || row.status === 'ok';

const num = (x: number): string => String(Math.round(x));
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

interface MetricStat {
  passes: number;
  rate: number;
  wilson: { lo: number; hi: number };
}

function metricStat(rows: PromptSetResultRow[], metric: 'decision_ok' | 'receipt_ok'): MetricStat {
  const values = rows.map((row) => row.grade?.[metric]);
  const graded = values.filter((v): v is number => typeof v === 'number');
  const passes = graded.filter((v) => v === 1).length;
  return {
    passes,
    rate: graded.length === 0 ? 0 : passes / graded.length,
    wilson: graded.length === 0 ? { lo: 0, hi: 1 } : wilsonInterval(passes, graded.length),
  };
}

interface TokenStat {
  field: 'in_tokens' | 'out_tokens' | 'cache_read_tokens' | 'cost_usd' | 'total';
  mean: number;
  halfWidth: number;
}

function tokenStats(rows: PromptSetResultRow[]): TokenStat[] {
  const pick = (row: PromptSetResultRow, field: TokenStat['field']): number => {
    if (field === 'total') return (row.in_tokens ?? 0) + (row.out_tokens ?? 0);
    return row[field] ?? 0;
  };
  return (['in_tokens', 'out_tokens', 'cache_read_tokens', 'total', 'cost_usd'] as const).map(
    (field) => {
      const { mean, halfWidth } = meanInterval(rows.map((row) => pick(row, field)));
      return { field, mean, halfWidth };
    },
  );
}

function armMismatchWarnings(arm: ArmInput, expected: 'current' | 'cut'): string[] {
  return arm.rows
    .filter((row) => row.meta?.prompt_set !== undefined && row.meta.prompt_set !== expected)
    .map((row) => `row ${row.prompt_id} rep${row.rep} ran with prompt_set=${row.meta?.prompt_set}`);
}

function caseKey(rows: PromptSetResultRow[]): Map<string, PromptSetResultRow[]> {
  const byId = new Map<string, PromptSetResultRow[]>();
  for (const row of rows) {
    const list = byId.get(row.prompt_id);
    if (list === undefined) byId.set(row.prompt_id, [row]);
    else list.push(row);
  }
  return byId;
}

function casePassFraction(rows: PromptSetResultRow[] | undefined): string {
  if (rows === undefined || rows.length === 0) return '-';
  const graded = rows.map((row) => row.grade?.[PASS_METRIC]).filter((v) => v === 0 || v === 1);
  const passes = graded.filter((v) => v === 1).length;
  return `${passes}/${graded.length}`;
}

function caseTokens(rows: PromptSetResultRow[] | undefined): string {
  if (rows === undefined || rows.length === 0) return '-';
  const mean = meanInterval(rows.map((row) => (row.in_tokens ?? 0) + (row.out_tokens ?? 0)));
  return num(mean.mean);
}

export function buildComparisonMarkdown(input: {
  flow: string;
  current: ArmInput;
  cut: ArmInput;
}): string {
  const { flow, current, cut } = input;
  const currentOk = current.rows.filter(isOkRow);
  const cutOk = cut.rows.filter(isOkRow);
  const warnings = [
    ...(currentOk.length === 0 ? [`${current.label}: zero ok rows`] : []),
    ...(cutOk.length === 0 ? [`${cut.label}: zero ok rows`] : []),
    ...armMismatchWarnings(current, 'current'),
    ...armMismatchWarnings(cut, 'cut'),
  ];

  const pass = (rows: PromptSetResultRow[]): MetricStat => metricStat(rows, PASS_METRIC);
  const receipt = (rows: PromptSetResultRow[]): MetricStat => metricStat(rows, SECONDARY_METRIC);
  const tokens = (rows: PromptSetResultRow[]): TokenStat[] => tokenStats(rows);
  const stat = (list: TokenStat[], field: TokenStat['field']): TokenStat => {
    const hit = list.find((s) => s.field === field);
    if (hit === undefined) throw new Error(`token stat missing for ${field}`);
    return hit;
  };

  const currentPass = pass(currentOk);
  const cutPass = pass(cutOk);
  const currentTokens = tokens(currentOk);
  const cutTokens = tokens(cutOk);

  const armRow = (
    label: 'current' | 'cut',
    okRows: PromptSetResultRow[],
    passStat: MetricStat,
    receiptStat: MetricStat,
    stats: TokenStat[],
    errorRows: number,
  ): string =>
    `| ${label} | ${okRows.length} | ${caseKey(okRows).size} | ` +
    `${pct(passStat.rate)} [${pct(passStat.wilson.lo)}, ${pct(passStat.wilson.hi)}] | ` +
    `${pct(receiptStat.rate)} [${pct(receiptStat.wilson.lo)}, ${pct(receiptStat.wilson.hi)}] | ` +
    `${num(stat(stats, 'in_tokens').mean)} ± ${num(stat(stats, 'in_tokens').halfWidth)} | ` +
    `${num(stat(stats, 'out_tokens').mean)} ± ${num(stat(stats, 'out_tokens').halfWidth)} | ` +
    `${num(stat(stats, 'cache_read_tokens').mean)} | ` +
    `${num(stat(stats, 'total').mean)} ± ${num(stat(stats, 'total').halfWidth)} | ` +
    `${stat(stats, 'cost_usd').mean.toFixed(4)} | ${errorRows} |`;

  const diffPct = (a: number, b: number): string => `${((a - b) * 100).toFixed(1)} pp`;
  const diffAbs = (a: number, b: number): string => num(a - b);
  const diffRel = (a: number, b: number): string =>
    b === 0 ? 'n/a' : `${(((a - b) / b) * 100).toFixed(1)}%`;

  const ids = [...new Set([...caseKey(currentOk).keys(), ...caseKey(cutOk).keys()])].sort();
  const currentById = caseKey(currentOk);
  const cutById = caseKey(cutOk);
  const tagsOf = (rows: Map<string, PromptSetResultRow[]>, id: string): string => {
    const first = rows.get(id)?.[0];
    return (first?.tags ?? []).join(', ');
  };
  const caseRows = ids
    .map((id) => {
      const c = currentById.get(id);
      const k = cutById.get(id);
      return (
        `| ${id} | ${tagsOf(currentById, id) || tagsOf(cutById, id)} | ` +
        `${casePassFraction(c)} | ${casePassFraction(k)} | ${caseTokens(c)} | ${caseTokens(k)} |`
      );
    })
    .join('\n');

  return [
    `# Prompt-set ablation: current vs cut (${basename(flow)})`,
    '',
    `- generated: ${new Date().toISOString()}`,
    `- pass metric: ${PASS_METRIC} (${SECONDARY_METRIC} shown as the secondary rate); truncated rows excluded`,
    `- current arm: ${current.label} — ${currentOk.length} ok rows, ${caseKey(currentOk).size} cases; error attempts: ${current.errorRows}`,
    `- cut arm: ${cut.label} — ${cutOk.length} ok rows, ${caseKey(cutOk).size} cases; error attempts: ${cut.errorRows}`,
    `- warnings: ${warnings.length === 0 ? 'none' : warnings.join('; ')}`,
    '',
    '## Summary',
    '',
    '| arm | rows | cases | pass rate (95% Wilson) | receipt rate (95% Wilson) | in tok/task | out tok/task | cache-read tok/task | total tok/task | cost $/task | error attempts |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    armRow('current', currentOk, currentPass, receipt(currentOk), currentTokens, current.errorRows),
    armRow('cut', cutOk, cutPass, receipt(cutOk), cutTokens, cut.errorRows),
    '',
    'Token columns are mean ± 95% CI half-width across ok rows; total = in + out.',
    '',
    '## Difference (cut − current)',
    '',
    `- pass rate: ${diffPct(cutPass.rate, currentPass.rate)} (per-arm Wilson intervals above; not a paired significance test)`,
    `- in tokens: ${diffAbs(stat(cutTokens, 'in_tokens').mean, stat(currentTokens, 'in_tokens').mean)} (${diffRel(stat(cutTokens, 'in_tokens').mean, stat(currentTokens, 'in_tokens').mean)})`,
    `- out tokens: ${diffAbs(stat(cutTokens, 'out_tokens').mean, stat(currentTokens, 'out_tokens').mean)} (${diffRel(stat(cutTokens, 'out_tokens').mean, stat(currentTokens, 'out_tokens').mean)})`,
    `- total tokens: ${diffAbs(stat(cutTokens, 'total').mean, stat(currentTokens, 'total').mean)} (${diffRel(stat(cutTokens, 'total').mean, stat(currentTokens, 'total').mean)})`,
    `- cost: ${diffAbs(stat(cutTokens, 'cost_usd').mean, stat(currentTokens, 'cost_usd').mean)} $/task (${diffRel(stat(cutTokens, 'cost_usd').mean, stat(currentTokens, 'cost_usd').mean)})`,
    '',
    '## Per-case',
    '',
    '| id | tags | current pass | cut pass | current in+out tok | cut in+out tok |',
    '| --- | --- | --- | --- | --- | --- |',
    caseRows,
    '',
  ].join('\n');
}

function readArm(flow: string, variant: string): ArmInput {
  const resultsPath = resolve(flow, variant, 'results.jsonl');
  if (!existsSync(resultsPath)) {
    throw new Error(`missing ${resultsPath} - run the arm first`);
  }
  const rows = parsePromptSetRows(readFileSync(resultsPath, 'utf8'));
  let errorRows = 0;
  const errorsPath = resolve(flow, variant, 'errors.jsonl');
  if (existsSync(errorsPath)) {
    errorRows = readFileSync(errorsPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim()).length;
  }
  return { label: variant, rows, errorRows };
}

function usage(): never {
  console.error(
    'usage: compare-prompt-sets.mts <flow-dir> [--current baseline] [--cut v1] [--out PATH]',
  );
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flow = argv[0];
  let current = 'baseline';
  let cut = 'v1';
  let out: string | undefined;
  if (flow === undefined || flow.startsWith('--')) usage();
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--current') current = argv[++i] ?? usage();
    else if (argv[i] === '--cut') cut = argv[++i] ?? usage();
    else if (argv[i] === '--out') out = argv[++i] ?? usage();
    else usage();
  }
  const markdown = buildComparisonMarkdown({
    flow,
    current: readArm(flow, current),
    cut: readArm(flow, cut),
  });
  if (out === undefined) {
    process.stdout.write(markdown);
  } else {
    writeFileSync(out, markdown);
    console.error(`wrote ${resolve(out)}`);
  }
}
