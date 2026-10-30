import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
  pricesDigest,
  promptsDigest,
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
  const directory = mkdtempSync(join(tmpdir(), 'cairn-routing-cli-'));
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

function snapshotTree(root: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = prefix === '' ? name : `${prefix}/${name}`;
      if (statSync(path).isDirectory()) walk(path, rel);
      else out.set(rel, readFileSync(path));
    }
  };
  walk(root, '');
  return out;
}

function expectByteIdentical(before: Map<string, Buffer>, root: string): void {
  const after = snapshotTree(root);
  expect([...after.keys()]).toEqual([...before.keys()]);
  for (const [path, bytes] of before) {
    expect(after.get(path)?.equals(bytes), path).toBe(true);
  }
}

const ratesA = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 };
const ratesB = { input: 100, output: 200, cacheRead: 0, cacheWrite: 0 };

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

  test('pricesDigest hashes complete nested rates so pricing changes conflict', () => {
    const low = { exec: ratesA };
    const high = { exec: ratesB };
    expect(JSON.stringify(low, Object.keys(low).sort())).toBe(
      JSON.stringify(high, Object.keys(high).sort()),
    );
    expect(pricesDigest(low)).not.toBe(pricesDigest(high));
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
      prices: low,
    });
    const next = buildExperimentIdentity({
      arms: ['handoff'],
      planner: 'planner-a',
      executors: ['exec'],
      singleModels: [],
      tasks,
      reps: 1,
      timeoutS: 30,
      thinking: null,
      prices: high,
    });
    expect(identityConflicts(base, next).join('\n')).toMatch(/prices/);
  });

  test('promptsDigest rejects a prompt-text change for the same task id', () => {
    const [task] = selectTasks(['slugify']);
    if (task === undefined) throw new Error('missing slugify');
    const altered = { ...task, prompt: `${task.prompt}\nchanged prompt body` };
    expect(promptsDigest([task])).not.toBe(promptsDigest([altered]));
    const base = buildExperimentIdentity({
      arms: ['handoff'],
      planner: 'planner-a',
      executors: ['exec'],
      singleModels: [],
      tasks: [task],
      reps: 1,
      timeoutS: 30,
      thinking: null,
      prices: null,
    });
    const next = buildExperimentIdentity({
      arms: ['handoff'],
      planner: 'planner-a',
      executors: ['exec'],
      singleModels: [],
      tasks: [altered],
      reps: 1,
      timeoutS: 30,
      thinking: null,
      prices: null,
    });
    expect(next.taskIds).toEqual(base.taskIds);
    expect(next.taskDigest).toBe(base.taskDigest);
    const reasons = identityConflicts(base, next).join('\n');
    expect(reasons).toMatch(/prompts/);
    expect(reasons).not.toMatch(/task set/);
  });

  test('rows without planner_model identity are rejected with a message that names the fix', () => {
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

  test('results without a manifest are rejected with an actionable recovery diagnostic', () => {
    const directory = outDir();
    writeFileSync(join(directory, RESULTS_JSONL), `${JSON.stringify(sampleRow())}\n`);
    const before = snapshotTree(directory);
    const next = prepareExperiment(
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
    ).identity;
    expect(() => assertResumeAllowed(directory, next)).toThrow(
      /results\.jsonl exists without manifest\.json; delete the output directory or restore a compatible manifest/,
    );
    expectByteIdentical(before, directory);
  });
});

describe('#1987 reports from persisted configuration', () => {
  test('wilson interval for 8 of 10 matches the known bounds', () => {
    const ci = wilsonInterval(8, 10);
    expect(ci).not.toBeNull();
    expect(ci![0]).toBeCloseTo(0.4902, 3);
    expect(ci![1]).toBeCloseTo(0.9433, 3);
  });

  test('unknown prices print as unknown, not 0', () => {
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
    expect(report).not.toMatch(/cost USD mean \(95% CI\) \| 0(\.0+)? /);
    expect(report).toContain('Planner overhead');
    expect(report).toContain('planner-a');
    expect(report).toContain('slugify');
  });

  test('flagged error rows count as failures in the pass-rate denominator', () => {
    const rows = [
      sampleRow({ status: 'pass', rep: 0 }),
      sampleRow({
        status: 'error',
        oracle_pass: null,
        violations: ['/etc/hostname'],
        error: 'executor session error: boom',
        usage: null,
        wall_ms: null,
        rep: 1,
      }),
    ];
    const [agg] = aggregateByModel(rows, null);
    expect(agg?.passes).toBe(1);
    expect(agg?.errors).toBe(1);
    expect(agg?.flagged).toBe(1);
    expect(agg?.passRate).toBe(0.5);
    expect(agg?.passRateCI).not.toBeNull();
  });

  test('non-flagged errors stay out of the pass-rate denominator', () => {
    const rows = [
      sampleRow({ status: 'pass', rep: 0 }),
      sampleRow({
        status: 'error',
        oracle_pass: null,
        error: 'timeout',
        usage: null,
        wall_ms: null,
        rep: 1,
      }),
    ];
    const [agg] = aggregateByModel(rows, null);
    expect(agg?.passRate).toBe(1);
    expect(agg?.errors).toBe(1);
    expect(agg?.flagged).toBe(0);
  });

  test('--report-only with a different --planner argument still reports the recorded planner and task set', async () => {
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

  test('forbidden reads and wrapped implementations count as failures in rows and report', () => {
    const rows = [
      sampleRow({ status: 'fail', violations: ['/etc/hostname'], oracle_pass: true }),
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
    const report = renderReport(
      rows,
      { planner: 'planner-a', taskIds: ['slugify'], prices: null },
      { generatedAt: '2026-10-28T00:00:00.000Z' },
    );
    expect(report).toContain('/etc/hostname');
    expect(report).toContain('lib/slug.mjs');
    expect(report).toMatch(/\| 0\.000 \[/);
  });
});

const onLinuxX64 = test.runIf(process.platform === 'linux' && process.arch === 'x64');

describe('#1987 deterministic CLI integration', () => {
  onLinuxX64(
    'an interrupted run resumes only the missing (task, arm, executor, rep) rows',
    async () => {
      const directory = outDir();
      const stub = await startStubLlm([
        writeSlug(),
        done(),
        plan(),
        writeSlug(),
        done(),
        plan(),
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
          promptsDigest: string;
          pricesDigest: string | null;
        };
        expect(manifest.planner).toBe('stub-planner');
        expect(typeof manifest.promptsDigest).toBe('string');
        expect(manifest.promptsDigest.length).toBe(64);

        writeFileSync(join(directory, RESULTS_JSONL), `${rowsAfterFirst.slice(0, 2).join('\n')}\n`);
        const requestsBeforeResume = stub.requests.length;
        const second = await runExperiment(parseArgs(baseArgs));
        expect(second.ran).toBe(1);
        expect(stub.requests.length).toBeGreaterThan(requestsBeforeResume);
        const finalRows = readFileSync(join(directory, RESULTS_JSONL), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as RoutingRunRow);
        expect(finalRows).toHaveLength(3);
        expect(finalRows.every((row) => row.status === 'pass')).toBe(true);
        expect(finalRows.every((row) => row.oracle_pass === true)).toBe(true);
        expect(
          finalRows
            .filter((row) => row.arm === 'handoff')
            .every((row) => row.planner_model === 'stub-planner'),
        ).toBe(true);
        const report = readFileSync(join(directory, 'report.md'), 'utf8');
        expect(report).toContain('stub-planner');
        expect(report).toMatch(/pass rate \(95% CI\)/);
        expect(report).toMatch(/cost USD mean \(95% CI\)/);
        expect(report).toMatch(/wall s mean \(95% CI\)/);
        expect(report).toContain('Planner overhead');
        expect(report).toContain('flagged');
        expect(report).toMatch(/single/);
        expect(report).toMatch(/handoff/);
        writeRoutingReport(directory, prepareExperiment(parseArgs(baseArgs)).identity);
      } finally {
        await stub.close();
      }
    },
    180_000,
  );

  onLinuxX64(
    'a deterministic two-arm, two-executor run reports per-model pass rate, cost, wall time, intervals, flagged failures, errors and planner overhead',
    async () => {
      const directory = outDir();
      const pricesPath = join(directory, 'prices.json');
      writeFileSync(
        pricesPath,
        `${JSON.stringify({
          'stub-single': ratesA,
          'stub-exec-a': ratesA,
          'stub-exec-b': ratesA,
          'stub-planner': ratesA,
        })}\n`,
      );
      const stub = await startStubLlm([
        writeSlug(),
        done(),
        plan(),
        writeSlug(),
        done(),
        plan(),
        writeSlug(),
        done(),
      ]);
      try {
        const result = await runExperiment(
          parseArgs([
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
            '--prices',
            pricesPath,
            '--relay-url',
            stub.url,
            '--relay-key',
            'bench-key',
          ]),
        );
        expect(result.ran).toBe(3);
        const rows = readFileSync(join(directory, RESULTS_JSONL), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as RoutingRunRow);
        expect(rows.every((row) => row.status === 'pass' && row.oracle_pass === true)).toBe(true);
        const report = readFileSync(join(directory, 'report.md'), 'utf8');
        expect(report).toMatch(/\| 1\.000 \[/);
        expect(report).toMatch(/\| 0\.\d{4} \[/);
        expect(report).toMatch(/wall s mean \(95% CI\)/);
        expect(report).toContain('Planner overhead');
        expect(report).toContain('flagged');
        expect(report).toContain('## Errors');
        const manifest = JSON.parse(readFileSync(join(directory, EXPERIMENT_MANIFEST), 'utf8')) as {
          pricesDigest: string;
        };
        expect(manifest.pricesDigest).toBe(
          pricesDigest({
            'stub-single': ratesA,
            'stub-exec-a': ratesA,
            'stub-exec-b': ratesA,
            'stub-planner': ratesA,
          }),
        );
      } finally {
        await stub.close();
      }
    },
    180_000,
  );

  test('compatible resume with nothing missing is byte-identical and makes zero relay requests', async () => {
    const directory = outDir();
    const stub = await startStubLlm([writeSlug(), done()]);
    try {
      const args = [
        '--arms',
        'single',
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
      const first = await runExperiment(parseArgs(args));
      expect(first.ran).toBe(1);
      const before = snapshotTree(directory);
      const requestsBefore = stub.requests.length;
      const second = await runExperiment(parseArgs(args));
      expect(second.ran).toBe(0);
      expect(stub.requests.length).toBe(requestsBefore);
      expectByteIdentical(before, directory);
    } finally {
      await stub.close();
    }
  }, 180_000);

  onLinuxX64(
    'a real flagged run fails grading and appears in the report flagged section',
    async () => {
      const directory = outDir();
      const stub = await startStubLlm([
        {
          toolCall: { name: 'read', arguments: { path: '/etc/hostname' } },
        },
        writeSlug(),
        done(),
      ]);
      try {
        const result = await runExperiment(
          parseArgs([
            '--arms',
            'single',
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
          ]),
        );
        expect(result.ran).toBe(1);
        const [row] = readFileSync(join(directory, RESULTS_JSONL), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as RoutingRunRow);
        expect(row?.status).toBe('fail');
        expect(row?.oracle_pass).toBe(true);
        expect(
          row?.violations.some(
            (entry) => entry.includes('/etc/hostname') || entry.includes('outside workspace'),
          ),
        ).toBe(true);
        const report = readFileSync(join(directory, 'report.md'), 'utf8');
        expect(report).toContain('## Flagged runs');
        expect(report.toLowerCase()).toMatch(/hostname|outside workspace/);
        expect(report).toMatch(/\| 0\.000 \[/);
        const [agg] = aggregateByModel([row!], null);
        expect(agg?.passes).toBe(0);
        expect(agg?.flagged).toBe(1);
      } finally {
        await stub.close();
      }
    },
    180_000,
  );

  test.each([
    {
      label: 'planner',
      mutate: (args: string[], _directory: string, _scratch: string) => {
        const i = args.indexOf('--planner');
        args[i + 1] = 'other-planner';
      },
      pattern: /planner/,
    },
    {
      label: 'executors',
      mutate: (args: string[], _directory: string, _scratch: string) => {
        const i = args.indexOf('--executors');
        args[i + 1] = 'other-exec';
      },
      pattern: /executors/,
    },
    {
      label: 'timeout',
      mutate: (args: string[], _directory: string, _scratch: string) => {
        const i = args.indexOf('--timeout-s');
        args[i + 1] = '99';
      },
      pattern: /timeout/,
    },
    {
      label: 'pricing',
      mutate: (args: string[], _directory: string, scratch: string) => {
        const nextPrices = join(scratch, 'prices-b.json');
        writeFileSync(nextPrices, `${JSON.stringify({ 'stub-exec-a': ratesB })}\n`);
        const i = args.indexOf('--prices');
        args[i + 1] = nextPrices;
      },
      pattern: /prices/,
    },
  ] as const)(
    'changing $label on resume exits nonzero before any relay request and leaves out/ byte-identical',
    async ({ mutate, pattern }) => {
      const directory = outDir();
      const scratch = outDir();
      const pricesPath = join(scratch, 'prices-a.json');
      writeFileSync(pricesPath, `${JSON.stringify({ 'stub-exec-a': ratesA })}\n`);
      const stub = await startStubLlm([plan(), writeSlug(), done()]);
      try {
        const baseArgs = [
          '--arms',
          'handoff',
          '--planner',
          'stub-planner',
          '--executors',
          'stub-exec-a',
          '--tasks',
          'slugify',
          '--reps',
          '1',
          '--timeout-s',
          '45',
          '--out',
          directory,
          '--prices',
          pricesPath,
          '--relay-url',
          stub.url,
          '--relay-key',
          'bench-key',
        ];
        await runExperiment(parseArgs(baseArgs));
        const before = snapshotTree(directory);
        const requestsBefore = stub.requests.length;
        const nextArgs = [...baseArgs];
        mutate(nextArgs, directory, scratch);
        const next = prepareExperiment(parseArgs(nextArgs)).identity;
        expect(() => assertResumeAllowed(directory, next)).toThrow(pattern);
        expect(stub.requests.length).toBe(requestsBefore);
        expectByteIdentical(before, directory);
        await expect(runExperiment(parseArgs(nextArgs))).rejects.toThrow(pattern);
        expect(stub.requests.length).toBe(requestsBefore);
        expectByteIdentical(before, directory);
      } finally {
        await stub.close();
      }
    },
    180_000,
  );

  test('changing prompts for the same task rejects resume before any relay request and leaves out/ byte-identical', async () => {
    const directory = outDir();
    const stub = await startStubLlm([plan(), writeSlug(), done()]);
    try {
      const baseArgs = [
        '--arms',
        'handoff',
        '--planner',
        'stub-planner',
        '--executors',
        'stub-exec-a',
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
      await runExperiment(parseArgs(baseArgs));
      const before = snapshotTree(directory);
      const requestsBefore = stub.requests.length;
      const recorded = prepareExperiment(parseArgs(baseArgs)).identity;
      expect(recorded.taskIds).toEqual(['slugify']);
      const next = {
        ...recorded,
        promptsDigest: 'f'.repeat(64),
      };
      expect(next.taskIds).toEqual(recorded.taskIds);
      expect(next.taskDigest).toBe(recorded.taskDigest);
      expect(() => assertResumeAllowed(directory, next)).toThrow(/prompts/);
      expect(stub.requests.length).toBe(requestsBefore);
      expectByteIdentical(before, directory);
      await expect(runExperiment(parseArgs(baseArgs))).resolves.toMatchObject({ ran: 0 });
      expect(stub.requests.length).toBe(requestsBefore);
    } finally {
      await stub.close();
    }
  }, 180_000);

  test('results without a manifest reject resume before any relay request with recovery guidance', async () => {
    const directory = outDir();
    const stub = await startStubLlm([plan(), writeSlug(), done()]);
    try {
      writeFileSync(
        join(directory, RESULTS_JSONL),
        `${JSON.stringify(sampleRow({ planner_model: 'stub-planner', model: 'stub-exec-a' }))}\n`,
      );
      const before = snapshotTree(directory);
      const args = [
        '--arms',
        'handoff',
        '--planner',
        'stub-planner',
        '--executors',
        'stub-exec-a',
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
      await expect(runExperiment(parseArgs(args))).rejects.toThrow(
        /results\.jsonl exists without manifest\.json; delete the output directory or restore a compatible manifest/,
      );
      expect(stub.requests.length).toBe(0);
      expectByteIdentical(before, directory);
    } finally {
      await stub.close();
    }
  }, 180_000);
});

describe('#1987 evidence helpers', () => {
  test('manifest.json is the persisted experiment identity filename', () => {
    expect(EXPERIMENT_MANIFEST).toBe('manifest.json');
    const directory = outDir();
    const identity = buildExperimentIdentity({
      arms: ['handoff'],
      planner: 'planner-a',
      executors: ['exec'],
      singleModels: [],
      tasks: selectTasks(['slugify']),
      reps: 1,
      timeoutS: 30,
      thinking: null,
      prices: { exec: ratesA },
    });
    saveManifest(directory, identity);
    const raw = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as {
      promptsDigest: string;
      pricesDigest: string;
      harnessDigest: string;
      taskDigest: string;
    };
    expect(raw.promptsDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(raw.pricesDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(raw.harnessDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(raw.taskDigest).toMatch(/^[a-f0-9]{64}$/);
    cpSync(join(directory, 'manifest.json'), join(directory, 'manifest-copy.json'));
    expect(readFileSync(join(directory, 'manifest-copy.json'))).toEqual(
      readFileSync(join(directory, 'manifest.json')),
    );
  });
});
