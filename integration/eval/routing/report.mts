import type { RoutingArm, RoutingRunRow, TokenCounts } from './driver.mts';
import type { ExperimentIdentity, PriceRates } from './experiment.mts';

export function runCostUsd(usage: TokenCounts, rates: PriceRates | undefined): number | null {
  if (rates === undefined) return null;
  return (
    (usage.input * rates.input +
      usage.output * rates.output +
      usage.cacheRead * rates.cacheRead +
      usage.cacheWrite * rates.cacheWrite) /
    1_000_000
  );
}

export function wilsonInterval(passes: number, n: number): [number, number] | null {
  if (n <= 0) return null;
  const z = 1.96;
  const p = passes / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const spread = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, center - spread), Math.min(1, center + spread)];
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapMeanCI(
  values: readonly number[],
  opts: { samples?: number; seed?: number } = {},
): [number, number] | null {
  if (values.length === 0) return null;
  const samples = opts.samples ?? 2000;
  const random = mulberry32(opts.seed ?? 0x1830);
  const data = [...values];
  const means: number[] = [];
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let j = 0; j < data.length; j++) {
      sum += data[Math.floor(random() * data.length)] ?? 0;
    }
    means.push(sum / data.length);
  }
  means.sort((a, b) => a - b);
  const pick = (q: number): number => {
    const index = Math.min(means.length - 1, Math.max(0, Math.round(q * (means.length - 1))));
    return means[index] ?? 0;
  };
  return [pick(0.025), pick(0.975)];
}

export interface ModelAggregate {
  arm: RoutingArm;
  model: string;
  runs: number;
  graded: number;
  passes: number;
  errors: number;
  flagged: number;
  passRate: number | null;
  passRateCI: [number, number] | null;
  costMeanUsd: number | null;
  costCI: [number, number] | null;
  wallMeanMs: number | null;
  wallCI: [number, number] | null;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function rowCost(row: RoutingRunRow, prices: Record<string, PriceRates> | null): number | null {
  if (row.usage === null) return null;
  return runCostUsd(row.usage, prices?.[row.model]);
}

function plannerCost(row: RoutingRunRow, prices: Record<string, PriceRates> | null): number | null {
  if (row.planner_usage === null || row.planner_model === null) return null;
  return runCostUsd(row.planner_usage, prices?.[row.planner_model]);
}

function isFlagged(row: RoutingRunRow): boolean {
  return row.violations.length + row.wrapped_implementations.length > 0;
}

export function aggregateByModel(
  rows: readonly RoutingRunRow[],
  prices: Record<string, PriceRates> | null = null,
): ModelAggregate[] {
  const groups = new Map<string, RoutingRunRow[]>();
  for (const row of rows) {
    const key = `${row.arm}\0${row.model}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }
  const aggregates: ModelAggregate[] = [];
  for (const [key, bucket] of groups) {
    const [arm, model] = key.split('\0') as [RoutingArm, string];
    const gradedRows = bucket.filter((row) => row.status !== 'error');
    const passes = gradedRows.filter((row) => row.status === 'pass').length;
    const costs = bucket
      .map((row) => rowCost(row, prices))
      .filter((cost): cost is number => cost !== null);
    const walls = bucket
      .map((row) => row.wall_ms)
      .filter((wall): wall is number => wall !== null && wall !== undefined);
    aggregates.push({
      arm,
      model,
      runs: bucket.length,
      graded: gradedRows.length,
      passes,
      errors: bucket.length - gradedRows.length,
      flagged: bucket.filter(isFlagged).length,
      passRate: gradedRows.length > 0 ? passes / gradedRows.length : null,
      passRateCI: wilsonInterval(passes, gradedRows.length),
      costMeanUsd: costs.length > 0 ? mean(costs) : null,
      costCI: bootstrapMeanCI(costs),
      wallMeanMs: walls.length > 0 ? mean(walls) : null,
      wallCI: bootstrapMeanCI(walls),
    });
  }
  return aggregates.sort((a, b) =>
    a.arm === b.arm ? (a.model < b.model ? -1 : a.model > b.model ? 1 : 0) : a.arm < b.arm ? -1 : 1,
  );
}

function formatRate(ratio: number | null, ci: [number, number] | null): string {
  if (ratio === null) return '-';
  const base = ratio.toFixed(3);
  if (ci === null) return base;
  return `${base} [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}]`;
}

function formatUsd(value: number | null, ci: [number, number] | null): string {
  if (value === null) return 'unknown';
  const base = value.toFixed(4);
  if (ci === null) return base;
  return `${base} [${ci[0].toFixed(4)}, ${ci[1].toFixed(4)}]`;
}

function formatSeconds(ms: number | null, ci: [number, number] | null): string {
  if (ms === null) return '-';
  const base = (ms / 1000).toFixed(1);
  if (ci === null) return base;
  return `${base} [${(ci[0] / 1000).toFixed(1)}, ${(ci[1] / 1000).toFixed(1)}]`;
}

export function renderReport(
  rows: readonly RoutingRunRow[],
  identity: Pick<ExperimentIdentity, 'planner' | 'taskIds' | 'prices'>,
  meta: { generatedAt: string },
): string {
  const lines: string[] = [
    '# Routing eval report',
    '',
    `- Tasks: ${identity.taskIds.join(', ') || '(none)'} (${identity.taskIds.length})`,
    `- Planner model for the handoff arm: ${identity.planner ?? '-'}`,
    `- Generated: ${meta.generatedAt}`,
    '',
    'Pass rate counts only graded runs (errors excluded); flagged runs count as failures.',
    'Cost cells show `unknown` when the persisted prices map has no rate for that model.',
    '',
    '## Per model',
    '',
    '| arm | model | runs | graded | pass | pass rate (95% CI) | cost USD mean (95% CI) | wall s mean (95% CI) | flagged | errors |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const agg of aggregateByModel(rows, identity.prices)) {
    lines.push(
      `| ${agg.arm} | ${agg.model} | ${agg.runs} | ${agg.graded} | ${agg.passes} | ${formatRate(agg.passRate, agg.passRateCI)} | ${formatUsd(agg.costMeanUsd, agg.costCI)} | ${formatSeconds(agg.wallMeanMs, agg.wallCI)} | ${agg.flagged} | ${agg.errors} |`,
    );
  }
  const plannerRows = rows.filter((row) => row.arm === 'handoff');
  if (plannerRows.length > 0) {
    const plannerCosts = plannerRows
      .map((row) => plannerCost(row, identity.prices))
      .filter((cost): cost is number => cost !== null);
    const plannerWall = plannerRows
      .map((row) => row.planner_wall_ms)
      .filter((wall): wall is number => wall !== null && wall !== undefined);
    lines.push(
      '',
      '## Planner overhead (handoff arm)',
      '',
      `- planner model: ${identity.planner ?? '-'}`,
      `- runs: ${plannerRows.length}`,
      `- cost USD total: ${plannerCosts.length > 0 ? plannerCosts.reduce((a, b) => a + b, 0).toFixed(4) : 'unknown'}`,
      `- wall s total: ${plannerWall.length > 0 ? (plannerWall.reduce((a, b) => a + b, 0) / 1000).toFixed(1) : '-'}`,
    );
  }
  const flaggedRuns = rows.filter(isFlagged);
  lines.push('', '## Flagged runs', '');
  if (flaggedRuns.length === 0) {
    lines.push('- none');
  } else {
    for (const row of flaggedRuns) {
      const flags = [...row.violations, ...row.wrapped_implementations];
      lines.push(`- ${row.task_id} / ${row.arm} / ${row.model}: ${flags.join(', ')}`);
    }
  }
  const errors = rows.filter((row) => row.status === 'error');
  lines.push('', '## Errors', '');
  if (errors.length === 0) {
    lines.push('- none');
  } else {
    for (const row of errors) {
      lines.push(
        `- ${row.task_id} / ${row.arm} / ${row.model}: ${(row.error ?? 'error').replace(/\|/g, '/')}`,
      );
    }
  }
  lines.push(
    '',
    '## Runs',
    '',
    '| task | arm | model | planner | status | why |',
    '|---|---|---|---|---|---|',
  );
  for (const row of rows) {
    const why = (row.why ?? row.error ?? '-').replace(/\|/g, '/');
    lines.push(
      `| ${row.task_id} | ${row.arm} | ${row.model} | ${row.planner_model ?? '-'} | ${row.status} | ${why} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
