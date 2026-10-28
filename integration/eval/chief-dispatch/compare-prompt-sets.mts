#!/usr/bin/env -S pnpm exec tsx
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { wilsonInterval } from './baseline-record.mts';
import { parseResultsJsonl } from './harness-eval-result.mts';
import { REPO_ROOT, resolveFromRoot } from './stack.mts';

const Z_95 = 1.96;
const UNAVAILABLE = 'unavailable';

export type EvalRowProvenance = {
  prompt_set: string;
  prompt_set_identity: string;
  harness_sha: string;
  model: string;
  thinking: string | null;
  timeout_s: number;
  arm: string;
  context_window: number | null;
  flow_digest: string;
};

export type PromptSetResultRow = {
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
  provenance?: EvalRowProvenance | null;
};

export class CompareValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompareValidationError';
  }
}

export function meanWithInterval(values: number[]): {
  mean: number | null;
  halfWidth: number | null;
  n: number;
} {
  const n = values.length;
  if (n === 0) return { mean: null, halfWidth: null, n: 0 };
  const mean = values.reduce((s, x) => s + x, 0) / n;
  if (n < 2) return { mean, halfWidth: null, n };
  const variance = values.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  return { mean, halfWidth: Z_95 * Math.sqrt(variance / n), n };
}

export function formatCostDifference(cutMean: number, currentMean: number): string {
  const delta = cutMean - currentMean;
  const abs = `${delta.toFixed(4)} $/task`;
  if (currentMean === 0) return `${abs} (${UNAVAILABLE})`;
  const rel = ((delta / currentMean) * 100).toFixed(1);
  return `${abs} (${rel}%)`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numOrZero(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function isPass(row: PromptSetResultRow): boolean {
  if (row.status === 'truncated') return false;
  return row.grade?.decision_ok === 1;
}

function isReceipt(row: PromptSetResultRow): boolean {
  if (row.status === 'truncated') return false;
  return row.grade?.receipt_ok === 1;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRate(passes: number, total: number): string {
  if (total === 0) return UNAVAILABLE;
  const interval = wilsonInterval(passes, total);
  if (interval === null) return UNAVAILABLE;
  return `${pct(passes / total)} [${pct(interval.low)}, ${pct(interval.high)}]`;
}

function formatMean(
  stat: { mean: number | null; halfWidth: number | null; n: number },
  digits = 0,
): string {
  if (stat.mean === null || stat.n === 0) return UNAVAILABLE;
  const mean = digits === 0 ? String(Math.round(stat.mean)) : stat.mean.toFixed(digits);
  if (stat.halfWidth === null) {
    return `${mean} (CI unavailable, n=1)`;
  }
  const half = digits === 0 ? String(Math.round(stat.halfWidth)) : stat.halfWidth.toFixed(digits);
  return `${mean} ± ${half}`;
}

function provenanceComplete(
  p: Partial<EvalRowProvenance> | null | undefined,
): p is EvalRowProvenance {
  return (
    p != null &&
    typeof p.prompt_set === 'string' &&
    p.prompt_set.length > 0 &&
    typeof p.prompt_set_identity === 'string' &&
    p.prompt_set_identity.length > 0 &&
    typeof p.harness_sha === 'string' &&
    p.harness_sha.length > 0 &&
    typeof p.model === 'string' &&
    p.model.length > 0 &&
    'thinking' in p &&
    (p.thinking === null || typeof p.thinking === 'string') &&
    typeof p.timeout_s === 'number' &&
    Number.isFinite(p.timeout_s) &&
    typeof p.arm === 'string' &&
    p.arm.length > 0 &&
    'context_window' in p &&
    (p.context_window === null ||
      (typeof p.context_window === 'number' && Number.isFinite(p.context_window))) &&
    typeof p.flow_digest === 'string' &&
    p.flow_digest.length > 0
  );
}

function missingProvenanceField(p: Partial<EvalRowProvenance> | null | undefined): string {
  if (p == null) return 'provenance';
  if (typeof p.prompt_set !== 'string' || p.prompt_set.length === 0) return 'prompt_set';
  if (typeof p.prompt_set_identity !== 'string' || p.prompt_set_identity.length === 0) {
    return 'prompt_set_identity';
  }
  if (typeof p.harness_sha !== 'string' || p.harness_sha.length === 0) return 'harness_sha';
  if (typeof p.model !== 'string' || p.model.length === 0) return 'model';
  if (!('thinking' in p) || !(p.thinking === null || typeof p.thinking === 'string')) {
    return 'thinking';
  }
  if (typeof p.timeout_s !== 'number' || !Number.isFinite(p.timeout_s)) return 'timeout_s';
  if (typeof p.arm !== 'string' || p.arm.length === 0) return 'arm';
  if (
    !('context_window' in p) ||
    !(
      p.context_window === null ||
      (typeof p.context_window === 'number' && Number.isFinite(p.context_window))
    )
  ) {
    return 'context_window';
  }
  if (typeof p.flow_digest !== 'string' || p.flow_digest.length === 0) return 'flow_digest';
  return 'provenance';
}

function sameRunnerConfig(left: EvalRowProvenance, right: EvalRowProvenance): boolean {
  return (
    left.harness_sha === right.harness_sha &&
    left.model === right.model &&
    (left.thinking ?? null) === (right.thinking ?? null) &&
    left.timeout_s === right.timeout_s &&
    left.arm === right.arm &&
    left.context_window === right.context_window &&
    left.flow_digest === right.flow_digest
  );
}

function sameArmProvenance(left: EvalRowProvenance, right: EvalRowProvenance): boolean {
  return (
    sameRunnerConfig(left, right) &&
    left.prompt_set === right.prompt_set &&
    left.prompt_set_identity === right.prompt_set_identity
  );
}

function rejectDuplicateReps(rows: PromptSetResultRow[], label: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.prompt_id}\0${row.rep}`;
    if (seen.has(key)) {
      throw new CompareValidationError(
        `${label} arm has duplicate (prompt_id, rep)=(${row.prompt_id}, ${row.rep})`,
      );
    }
    seen.add(key);
  }
}

function armIdentity(rows: PromptSetResultRow[], label: string): EvalRowProvenance {
  if (rows.length === 0) {
    throw new CompareValidationError(`${label} arm has no result rows to validate`);
  }
  rejectDuplicateReps(rows, label);
  const identities: EvalRowProvenance[] = [];
  for (const row of rows) {
    const p = row.provenance;
    if (!provenanceComplete(p)) {
      throw new CompareValidationError(
        `${label} arm: row ${row.prompt_id} rep${row.rep} lacks provenance field ${missingProvenanceField(p)}; cannot compare`,
      );
    }
    identities.push(p);
  }
  const first = identities[0];
  if (first === undefined) {
    throw new CompareValidationError(`${label} arm has no result rows to validate`);
  }
  for (const p of identities) {
    if (!sameArmProvenance(first, p)) {
      throw new CompareValidationError(
        `${label} arm has mixed provenance (prompt_set/prompt_set_identity/harness_sha/model/thinking/timeout_s/arm/context_window/flow_digest)`,
      );
    }
  }
  return first;
}

export function validateArms(input: {
  currentRows: PromptSetResultRow[];
  cutRows: PromptSetResultRow[];
}): { current: EvalRowProvenance | null; cut: EvalRowProvenance | null } {
  const current = input.currentRows.length === 0 ? null : armIdentity(input.currentRows, 'current');
  const cut = input.cutRows.length === 0 ? null : armIdentity(input.cutRows, 'cut');
  if (current !== null && cut !== null) {
    if (!sameRunnerConfig(current, cut)) {
      const mismatches: string[] = [];
      if (current.harness_sha !== cut.harness_sha) mismatches.push('harness_sha');
      if (current.model !== cut.model) mismatches.push('model');
      if ((current.thinking ?? null) !== (cut.thinking ?? null)) mismatches.push('thinking');
      if (current.timeout_s !== cut.timeout_s) mismatches.push('timeout_s');
      if (current.arm !== cut.arm) mismatches.push('arm');
      if (current.context_window !== cut.context_window) mismatches.push('context_window');
      if (current.flow_digest !== cut.flow_digest) mismatches.push('flow_digest');
      throw new CompareValidationError(
        `arms disagree on runner contract (${mismatches.join(', ')})`,
      );
    }
    if (current.prompt_set === cut.prompt_set) {
      throw new CompareValidationError(
        `arms share the same prompt_set=${current.prompt_set}; refuse to compare identical arms`,
      );
    }
    if (current.prompt_set_identity === cut.prompt_set_identity) {
      throw new CompareValidationError(
        `arms share the same prompt_set_identity=${current.prompt_set_identity}; refuse to compare identical arms`,
      );
    }
  }
  return { current, cut };
}

function byCase(rows: PromptSetResultRow[]): Map<string, PromptSetResultRow[]> {
  const map = new Map<string, PromptSetResultRow[]>();
  for (const row of rows) {
    const list = map.get(row.prompt_id);
    if (list === undefined) map.set(row.prompt_id, [row]);
    else list.push(row);
  }
  return map;
}

function caseCoverage(rows: PromptSetResultRow[] | undefined): string {
  if (rows === undefined || rows.length === 0) return '0/0 missing';
  const passes = rows.filter(isPass).length;
  return `${passes}/${rows.length}`;
}

function caseTokens(rows: PromptSetResultRow[] | undefined): string {
  if (rows === undefined || rows.length === 0) return UNAVAILABLE;
  const mean = meanWithInterval(
    rows.map((row) => numOrZero(row.in_tokens) + numOrZero(row.out_tokens)),
  );
  return formatMean(mean, 0);
}

function tokenField(
  rows: PromptSetResultRow[],
  field: 'in_tokens' | 'out_tokens' | 'cache_read_tokens' | 'cost_usd' | 'total',
): ReturnType<typeof meanWithInterval> {
  return meanWithInterval(
    rows.map((row) => {
      if (field === 'total') return numOrZero(row.in_tokens) + numOrZero(row.out_tokens);
      return numOrZero(row[field]);
    }),
  );
}

function formatRepSet(rows: PromptSetResultRow[]): string {
  const reps = [...new Set(rows.map((row) => row.rep))].sort((a, b) => a - b);
  return `[${reps.join(', ')}]`;
}

function sameRepSet(left: PromptSetResultRow[], right: PromptSetResultRow[]): boolean {
  const leftReps = new Set(left.map((row) => row.rep));
  const rightReps = new Set(right.map((row) => row.rep));
  if (leftReps.size !== rightReps.size) return false;
  for (const rep of leftReps) {
    if (!rightReps.has(rep)) return false;
  }
  return true;
}

export function coverageWarnings(
  currentRows: PromptSetResultRow[],
  cutRows: PromptSetResultRow[],
): string[] {
  const warnings: string[] = [];
  if (currentRows.length === 0)
    warnings.push('current arm: empty results (statistics unavailable)');
  if (cutRows.length === 0) warnings.push('cut arm: empty results (statistics unavailable)');
  const currentBy = byCase(currentRows);
  const cutBy = byCase(cutRows);
  const ids = [...new Set([...currentBy.keys(), ...cutBy.keys()])].sort();
  for (const id of ids) {
    const c = currentBy.get(id) ?? [];
    const k = cutBy.get(id) ?? [];
    if (!sameRepSet(c, k)) {
      warnings.push(
        `unequal coverage for ${id}: current reps=${formatRepSet(c)}, cut reps=${formatRepSet(k)}`,
      );
    }
  }
  return warnings;
}

export function buildComparisonMarkdown(input: {
  flow: string;
  currentLabel: string;
  cutLabel: string;
  currentRows: PromptSetResultRow[];
  cutRows: PromptSetResultRow[];
  currentInfraErrors: number;
  cutInfraErrors: number;
}): string {
  const { flow, currentLabel, cutLabel, currentRows, cutRows, currentInfraErrors, cutInfraErrors } =
    input;

  const warnings = coverageWarnings(currentRows, cutRows);
  if (currentInfraErrors > 0) {
    warnings.push(`current arm: infrastructure errors: ${currentInfraErrors}`);
  }
  if (cutInfraErrors > 0) {
    warnings.push(`cut arm: infrastructure errors: ${cutInfraErrors}`);
  }

  const currentPass = currentRows.filter(isPass).length;
  const cutPass = cutRows.filter(isPass).length;
  const currentReceipt = currentRows.filter(isReceipt).length;
  const cutReceipt = cutRows.filter(isReceipt).length;

  const currentIn = tokenField(currentRows, 'in_tokens');
  const cutIn = tokenField(cutRows, 'in_tokens');
  const currentOut = tokenField(currentRows, 'out_tokens');
  const cutOut = tokenField(cutRows, 'out_tokens');
  const currentCache = tokenField(currentRows, 'cache_read_tokens');
  const cutCache = tokenField(cutRows, 'cache_read_tokens');
  const currentTotal = tokenField(currentRows, 'total');
  const cutTotal = tokenField(cutRows, 'total');
  const currentCost = tokenField(currentRows, 'cost_usd');
  const cutCost = tokenField(cutRows, 'cost_usd');

  const armRow = (
    label: string,
    rows: PromptSetResultRow[],
    passN: number,
    receiptN: number,
    inStat: ReturnType<typeof meanWithInterval>,
    outStat: ReturnType<typeof meanWithInterval>,
    cacheStat: ReturnType<typeof meanWithInterval>,
    totalStat: ReturnType<typeof meanWithInterval>,
    costStat: ReturnType<typeof meanWithInterval>,
    infra: number,
  ): string =>
    `| ${label} | ${rows.length} | ${byCase(rows).size} | ` +
    `${formatRate(passN, rows.length)} | ${formatRate(receiptN, rows.length)} | ` +
    `${formatMean(inStat)} | ${formatMean(outStat)} | ${formatMean(cacheStat)} | ` +
    `${formatMean(totalStat)} | ${formatMean(costStat, 4)} | ${infra} |`;

  const diffLine = (
    name: string,
    cutStat: ReturnType<typeof meanWithInterval>,
    currentStat: ReturnType<typeof meanWithInterval>,
    kind: 'tokens' | 'cost',
  ): string => {
    if (cutStat.mean === null || currentStat.mean === null) {
      return `- ${name}: ${UNAVAILABLE}`;
    }
    if (kind === 'cost') {
      return `- ${name}: ${formatCostDifference(cutStat.mean, currentStat.mean)}`;
    }
    const delta = cutStat.mean - currentStat.mean;
    const rel =
      currentStat.mean === 0
        ? UNAVAILABLE
        : `${(((cutStat.mean - currentStat.mean) / currentStat.mean) * 100).toFixed(1)}%`;
    return `- ${name}: ${Math.round(delta)} (${rel})`;
  };

  const passDiff =
    currentRows.length === 0 || cutRows.length === 0
      ? UNAVAILABLE
      : `${((cutPass / cutRows.length - currentPass / currentRows.length) * 100).toFixed(1)} pp`;

  const currentBy = byCase(currentRows);
  const cutBy = byCase(cutRows);
  const ids = [...new Set([...currentBy.keys(), ...cutBy.keys()])].sort();
  const tagsOf = (id: string): string => {
    const first = currentBy.get(id)?.[0] ?? cutBy.get(id)?.[0];
    return (first?.tags ?? []).join(', ');
  };
  const caseRows = ids
    .map((id) => {
      const c = currentBy.get(id);
      const k = cutBy.get(id);
      const coverageNote =
        (c?.length ?? 0) === (k?.length ?? 0)
          ? ''
          : ` unequal coverage current=${c?.length ?? 0} cut=${k?.length ?? 0}`;
      return (
        `| ${id} | ${tagsOf(id)}${coverageNote} | ` +
        `${caseCoverage(c)} | ${caseCoverage(k)} | ${caseTokens(c)} | ${caseTokens(k)} |`
      );
    })
    .join('\n');

  return [
    `# Prompt-set comparison: current vs cut (${basename(flow)})`,
    '',
    `- generated: ${new Date().toISOString()}`,
    `- pass metric: decision_ok; truncated rows count as failures and keep their usage/cost`,
    `- current arm: ${currentLabel} — ${currentRows.length} result rows, ${byCase(currentRows).size} cases; infrastructure errors: ${currentInfraErrors}`,
    `- cut arm: ${cutLabel} — ${cutRows.length} result rows, ${byCase(cutRows).size} cases; infrastructure errors: ${cutInfraErrors}`,
    `- warnings: ${warnings.length === 0 ? 'none' : warnings.join('; ')}`,
    '',
    '## Summary',
    '',
    '| arm | rows | cases | pass rate (95% Wilson) | receipt rate (95% Wilson) | in tok/task | out tok/task | cache-read tok/task | total tok/task | cost $/task | infra errors |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    armRow(
      'current',
      currentRows,
      currentPass,
      currentReceipt,
      currentIn,
      currentOut,
      currentCache,
      currentTotal,
      currentCost,
      currentInfraErrors,
    ),
    armRow(
      'cut',
      cutRows,
      cutPass,
      cutReceipt,
      cutIn,
      cutOut,
      cutCache,
      cutTotal,
      cutCost,
      cutInfraErrors,
    ),
    '',
    'Token and cost columns are mean ± 95% CI half-width across result rows (including truncated). Singleton samples report the mean with CI unavailable. Empty arms report unavailable.',
    '',
    '## Difference (cut − current)',
    '',
    `- pass rate: ${passDiff} (per-arm Wilson intervals above; not a paired significance test)`,
    diffLine('in tokens', cutIn, currentIn, 'tokens'),
    diffLine('out tokens', cutOut, currentOut, 'tokens'),
    diffLine('total tokens', cutTotal, currentTotal, 'tokens'),
    diffLine('cost', cutCost, currentCost, 'cost'),
    '',
    '## Per-case',
    '',
    '| id | tags | current pass | cut pass | current in+out tok | cut in+out tok |',
    '| --- | --- | --- | --- | --- | --- |',
    caseRows,
    '',
  ].join('\n');
}

function countInfraErrors(path: string): number {
  if (!existsSync(path)) return 0;
  let n = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim()) n += 1;
  }
  return n;
}

function loadArmRows(resultsPath: string): PromptSetResultRow[] {
  if (!existsSync(resultsPath)) return [];
  const parsed = parseResultsJsonl(readFileSync(resultsPath, 'utf8'));
  return parsed.map((raw, index) => {
    const row = raw as PromptSetResultRow;
    if (typeof row.prompt_id !== 'string' || row.prompt_id.length === 0) {
      throw new CompareValidationError(`${resultsPath}:${index + 1}: missing prompt_id`);
    }
    if (!Number.isInteger(row.rep)) {
      throw new CompareValidationError(
        `${resultsPath}:${index + 1}: missing integer rep for ${row.prompt_id}`,
      );
    }
    return row;
  });
}

function usage(): never {
  console.error(
    'usage: compare-prompt-sets.mts <flow-dir> [--current VARIANT] [--cut VARIANT] [--out PATH]',
  );
  console.error(`repository root: ${REPO_ROOT}`);
  process.exit(2);
}

function main(argv: string[]): void {
  const flowArg = argv[0];
  let currentVariant = 'current';
  let cutVariant = 'cut';
  let out: string | undefined;
  if (flowArg === undefined || flowArg.startsWith('--')) usage();
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--current') currentVariant = argv[++i] ?? usage();
    else if (argv[i] === '--cut') cutVariant = argv[++i] ?? usage();
    else if (argv[i] === '--out') out = argv[++i] ?? usage();
    else usage();
  }

  const flow = resolveFromRoot(flowArg);
  const currentDir = join(flow, currentVariant);
  const cutDir = join(flow, cutVariant);
  const currentRows = loadArmRows(join(currentDir, 'results.jsonl'));
  const cutRows = loadArmRows(join(cutDir, 'results.jsonl'));
  const currentInfraErrors = countInfraErrors(join(currentDir, 'errors.jsonl'));
  const cutInfraErrors = countInfraErrors(join(cutDir, 'errors.jsonl'));

  try {
    validateArms({ currentRows, cutRows });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(message);
    process.exit(1);
  }

  const markdown = buildComparisonMarkdown({
    flow,
    currentLabel: currentVariant,
    cutLabel: cutVariant,
    currentRows,
    cutRows,
    currentInfraErrors,
    cutInfraErrors,
  });
  if (out === undefined) {
    process.stdout.write(markdown);
  } else {
    const outPath = resolveFromRoot(out);
    writeFileSync(outPath, markdown);
    console.error(`wrote ${outPath}`);
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2));
}
