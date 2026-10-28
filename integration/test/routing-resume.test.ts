import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { CAIRN_BENCH_TASKS } from '../eval/routing/bench.mts';
import type { RoutingRunRow } from '../eval/routing/driver.mts';
import {
  buildExperimentIdentity,
  diagnoseIncompatibleRows,
  EXPERIMENT_MANIFEST,
  identityConflicts,
  RESULTS_JSONL,
  resumeKey,
  saveManifest,
  selectTasks,
} from '../eval/routing/experiment.mts';
import {
  aggregateByModel,
  renderReport,
  runCostUsd,
  wilsonInterval,
} from '../eval/routing/report.mts';
import {
  assertResumeAllowed,
  parseArgs,
  prepareExperiment,
  runExperiment,
  writeRoutingReport,
} from '../eval/routing/run.mts';
import { REFERENCE_FILES } from './routing-reference.js';
import { type StubResponse, startStubLlm } from './stub-llm.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function outDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-routing-resume-'));
  directories.push(directory);
  return directory;
}

const slugify = CAIRN_BENCH_TASKS.find((task) => task.id === 'slugify');
if (slugify === undefined) throw new Error('missing slugify');
const slugReference = REFERENCE_FILES.slugify!['lib/slug.mjs']!;
const planText = 'Lowercase the input, collapse non-alphanumeric runs to a dash, trim edges.';
const writeSlug = (): StubResponse => ({
  toolCall: { name: 'write', arguments: { path: 'lib/slug.mjs', content: slugReference } },
});
const done = (): StubResponse => ({ content: 'done' });
const plan = (): StubResponse => ({ content: planText });

function emptyBoundary(): RoutingRunRow['planner_boundary'] {
  return { executions: [], violations: [] };
}

function sampleRow(overrides: Partial<RoutingRunRow> = {}): RoutingRunRow {
  return {
    task_id: 'slugify',
    arm: 'handoff',
    model: 'exec-a',
    planner_model: 'planner-a',
    rep: 0,
    status: 'pass',
    oracle_pass: true,
    planner_boundary: emptyBoundary(),
    executor_boundary: emptyBoundary(),
    planner_violations: [],
    violations: [],
    wrapped_implementations: [],
    usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
    wall_ms: 100,
    planner_usage: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 },
    planner_wall_ms: 50,
    plan_chars: 40,
    stop_reason: 'done',
    why: 'oracle passed',
    ...overrides,
  };
}

describe('#1987 experiment identity and resume keys', () => {
  test('resume keys include the planner model so handoff rows stay distinct across planners', () => {
    const a = resumeKey({
      task_id: 'slugify',
      arm: 'handoff',
      model: 'exec',
      planner_model: 'planner-a',
      rep: 0,
    });
    const b = resumeKey({
      task_id: 'slugify',
      arm: 'handoff',
      model: 'exec',
      planner_model: 'planner-b',
      rep: 0,
    });
    expect(a).not.toBe(b);
    expect(a).toContain('planner-a');
    expect(b).toContain('planner-b');
  });

  test('changing the planner conflicts before any model call', () => {
    const tasks = selectTasks(['slugify']);
    const base = buildExperimentIdentity({
      arms: ['handoff'],
      planner: 'planner-a',
      executors: ['exec'],
      singleModels: [],
      tasks,
      reps: 1,
      timeoutS: 30,
      thinking: null,
      prices: null,
    });
    const next = { ...base, planner: 'planner-b' };
    expect(identityConflicts(base, next).join('\n')).toMatch(/planner/);
  });

  test('results without planner_model identity are rejected with an actionable diagnostic', () => {
    const identity = buildExperimentIdentity({
      arms: ['handoff'],
      planner: 'planner-a',
      executors: ['exec'],
      singleModels: [],
      tasks: selectTasks(['slugify']),
      reps: 1,
      timeoutS: 30,
      thinking: null,
      prices: null,
    });
    const legacy = {
      task_id: 'slugify',
      arm: 'handoff' as const,
      model: 'exec',
      rep: 0,
    };
    const reasons = diagnoseIncompatibleRows([legacy as never], identity);
    expect(reasons.join('\n')).toMatch(/planner_model/);
  });

  test('assertResumeAllowed rejects a planner change without touching results.jsonl', () => {
    const directory = outDir();
    const { identity } = prepareExperiment(
      parseArgs([
        '--arms',
        'handoff',
        '--planner',
        'planner-a',
        '--executors',
        'exec',
        '--tasks',
        'slugify',
        '--out',
        directory,
        '--timeout-s',
        '30',
      ]),
    );
    saveManifest(directory, identity);
    writeFileSync(join(directory, RESULTS_JSONL), `${JSON.stringify(sampleRow())}\n`);
    const before = readFileSync(join(directory, RESULTS_JSONL));
    const next = prepareExperiment(
      parseArgs([
        '--arms',
        'handoff',
        '--planner',
        'planner-b',
        '--executors',
        'exec',
        '--tasks',
        'slugify',
        '--out',
        directory,
        '--timeout-s',
        '30',
      ]),
    ).identity;
    expect(() => assertResumeAllowed(directory, next)).toThrow(/planner/);
    expect(readFileSync(join(directory, RESULTS_JSONL))).toEqual(before);
  });
});

describe('#1987 reports from persisted configuration', () => {
  test('wilson interval for 8 of 10 matches the known bounds', () => {
    const ci = wilsonInterval(8, 10);
    expect(ci).not.toBeNull();
    expect(ci![0]).toBeCloseTo(0.4902, 3);
    expect(ci![1]).toBeCloseTo(0.9433, 3);
  });

  test('unknown prices stay visibly unknown and known rates produce a cost', () => {
    const usage = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(runCostUsd(usage, undefined)).toBeNull();
    expect(runCostUsd(usage, { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 })).toBe(1);
    const report = renderReport(
      [sampleRow()],
      { planner: 'planner-a', taskIds: ['slugify'], prices: null },
      {
        generatedAt: '2026-10-28T00:00:00.000Z',
      },
    );
    expect(report).toContain('unknown');
    expect(report).toContain('Planner overhead');
    expect(report).toContain('planner-a');
    expect(report).toContain('slugify');
  });

  test('report-only uses the persisted planner and task set, not new CLI labels', async () => {
    const directory = outDir();
    const identity = buildExperimentIdentity({
      arms: ['handoff'],
      planner: 'recorded-planner',
      executors: ['exec-a'],
      singleModels: [],
      tasks: selectTasks(['slugify']),
      reps: 1,
      timeoutS: 30,
      thinking: null,
      prices: null,
    });
    saveManifest(directory, identity);
    writeFileSync(
      join(directory, RESULTS_JSONL),
      `${JSON.stringify(sampleRow({ planner_model: 'recorded-planner' }))}\n`,
    );
    const got = await runExperiment(
      parseArgs([
        '--report-only',
        '--out',
        directory,
        '--planner',
        'cli-should-not-relabel',
        '--tasks',
        'iso8601-duration',
      ]),
    );
    const report = readFileSync(got.reportPath, 'utf8');
    expect(report).toContain('recorded-planner');
    expect(report).not.toContain('cli-should-not-relabel');
    expect(report).toContain('slugify');
    expect(report).not.toContain('iso8601-duration');
  });

  test('aggregate flags boundary violations and wrapped implementations as failures', () => {
    const rows = [
      sampleRow({ status: 'fail', violations: ['/etc/hostname'] }),
      sampleRow({
        task_id: 'slugify',
        model: 'exec-b',
        status: 'fail',
        wrapped_implementations: ['lib/slug.mjs'],
        rep: 0,
      }),
    ];
    const aggs = aggregateByModel(rows, null);
    expect(aggs.every((agg) => agg.flagged >= 1)).toBe(true);
    expect(aggs.every((agg) => agg.passes === 0)).toBe(true);
  });
});

describe('#1987 deterministic CLI integration', () => {
  test('both arms and multiple executors resume only missing runs and keep the prior planner', async () => {
    const directory = outDir();
    const stub = await startStubLlm([
      plan(),
      writeSlug(),
      done(),
      plan(),
      writeSlug(),
      done(),
      writeSlug(),
      done(),
      plan(),
      writeSlug(),
      done(),
    ]);
    try {
      const baseArgs = [
        '--arms',
        'single,handoff',
        '--planner',
        'stub-planner',
        '--executors',
        'stub-exec-a,stub-exec-b',
        '--single-models',
        'stub-single',
        '--tasks',
        'slugify',
        '--reps',
        '1',
        '--timeout-s',
        '45',
        '--out',
        directory,
        '--relay-url',
        stub.url,
        '--relay-key',
        'bench-key',
      ];
      const first = await runExperiment(parseArgs(baseArgs));
      expect(first.ran).toBe(3);
      const rowsAfterFirst = readFileSync(join(directory, RESULTS_JSONL), 'utf8')
        .trim()
        .split('\n');
      expect(rowsAfterFirst).toHaveLength(3);
      const manifest = JSON.parse(readFileSync(join(directory, EXPERIMENT_MANIFEST), 'utf8')) as {
        planner: string;
      };
      expect(manifest.planner).toBe('stub-planner');

      writeFileSync(join(directory, RESULTS_JSONL), `${rowsAfterFirst.slice(0, 2).join('\n')}\n`);
      const second = await runExperiment(parseArgs(baseArgs));
      expect(second.ran).toBe(1);
      const finalRows = readFileSync(join(directory, RESULTS_JSONL), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as RoutingRunRow);
      expect(finalRows).toHaveLength(3);
      expect(
        finalRows
          .filter((row) => row.arm === 'handoff')
          .every((row) => row.planner_model === 'stub-planner'),
      ).toBe(true);
      const report = readFileSync(join(directory, 'report.md'), 'utf8');
      expect(report).toContain('stub-planner');
      expect(report).toMatch(/single/);
      expect(report).toMatch(/handoff/);
      writeRoutingReport(directory, prepareExperiment(parseArgs(baseArgs)).identity);
    } finally {
      await stub.close();
    }
  }, 180_000);
});
