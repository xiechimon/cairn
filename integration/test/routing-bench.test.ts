import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import {
  type BenchTask,
  benchTaskProblems,
  CAIRN_BENCH_TASKS,
  seedWorkdir,
} from '../eval/routing/bench.mts';
import type { ToolCallEvidence } from '../eval/routing/grade.mts';
import {
  aggregateByModel,
  bootstrapMeanCI,
  changedFilesIn,
  executorPrompt,
  gradeTaskRun,
  outOfWorkdirReads,
  plannerPrompt,
  type RoutingRunRow,
  renderReport,
  runCostUsd,
  runOracle,
  wilsonInterval,
  wrappedImplementations,
} from '../eval/routing/grade.mts';
import { runRoutingRun } from '../eval/routing/run.mts';
import { startStubLlm } from './stub-llm.js';

const CORRECT_ADDER = 'export function add(a, b) {\n  return a + b;\n}\n';

const adderTask: BenchTask = {
  id: 'adder-fixture',
  tags: ['fixture'],
  implFile: 'lib/adder.mjs',
  prompt: [
    'You are working in a small Node.js ESM repository (plain .mjs files, no external packages, no package.json).',
    '',
    'Implement `add(a, b)` in `lib/adder.mjs`. It returns the sum of the two numbers.',
    'The current file contains a throwing stub; replace it.',
    'You may run `node lib/adder.mjs` to check your work. There are no tests in the repository.',
  ].join('\n'),
  seedFiles: {
    'lib/adder.mjs': 'export function add(a, b) {\n  throw new Error("not implemented");\n}\n',
  },
  oracle: {
    files: {
      'oracle.check.mjs': [
        "import assert from 'node:assert/strict';",
        "import { add } from './lib/adder.mjs';",
        'assert.equal(add(2, 3), 5);',
        'assert.equal(add(-1, 1), 0);',
        'assert.equal(add(100, 23), 123);',
        "console.log('adder oracle ok');",
      ].join('\n'),
    },
    command: ['node', 'oracle.check.mjs'],
  },
};

const REFERENCE_WRAP_TEXT = [
  'export function wrapText(text, width) {',
  "  if (!Number.isInteger(width) || width < 1) throw new RangeError('width must be a positive integer');",
  '  return text',
  "    .split('\\n')",
  '    .map((line) => {',
  "      if (line.trim() === '') return '';",
  '      const words = line.trim().split(/\\s+/);',
  '      const lines = [];',
  '      let current = words[0];',
  '      for (const word of words.slice(1)) {',
  "        if (current.length + 1 + word.length <= width) current += ' ' + word;",
  '        else {',
  '          lines.push(current);',
  '          current = word;',
  '        }',
  '      }',
  '      lines.push(current);',
  "      return lines.join('\\n');",
  '    })',
  "    .join('\\n');",
  '}',
  '',
].join('\n');

function seededTmp(task: BenchTask): string {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-routing-test-'));
  seedWorkdir(dir, task);
  return dir;
}

describe('#1830 cairn-bench task set', () => {
  test('every task is structurally valid and ids are unique', () => {
    expect(CAIRN_BENCH_TASKS.length).toBeGreaterThanOrEqual(20);
    const ids = new Set<string>();
    for (const task of CAIRN_BENCH_TASKS) {
      expect(benchTaskProblems(task)).toEqual([]);
      expect(ids.has(task.id)).toBe(false);
      ids.add(task.id);
    }
  });

  test('the untouched seed state fails every oracle', () => {
    for (const task of CAIRN_BENCH_TASKS) {
      const dir = seededTmp(task);
      const result = runOracle(dir, task);
      expect(result.pass, `${task.id} oracle must fail on the stub seed`).toBe(false);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('decoy tasks: wrapping the decoy passes the oracle, and is detectable as a copy', () => {
    const decoyTasks = CAIRN_BENCH_TASKS.filter((task) => task.decoy !== undefined);
    expect(decoyTasks.length).toBeGreaterThanOrEqual(4);
    for (const task of decoyTasks) {
      const decoy = task.decoy;
      if (decoy === undefined) throw new Error('unreachable');
      const dir = seededTmp(task);
      const relative = relativeModulePath(task.implFile, decoy.file);
      writeFileSync(join(dir, task.implFile), `export * from '${relative}';\n`);
      const result = runOracle(dir, task);
      expect(result.pass, `${task.id} decoy must be a working implementation`).toBe(true);
      const changed = changedFilesIn(dir, task);
      expect(wrappedImplementations(changed, task)).toEqual([task.implFile]);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the word-wrap oracle accepts a correct greedy reference implementation', () => {
    const wrap = CAIRN_BENCH_TASKS.find((task) => task.id === 'word-wrap');
    if (wrap === undefined) throw new Error('word-wrap task missing');
    const dir = seededTmp(wrap);
    writeFileSync(join(dir, 'lib/wrap.mjs'), REFERENCE_WRAP_TEXT);
    const result = runOracle(dir, wrap);
    expect(result.pass).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a self-contained implementation passes the oracle and is not flagged', () => {
    const slug = CAIRN_BENCH_TASKS.find((task) => task.id === 'slugify');
    if (slug === undefined) throw new Error('slugify task missing');
    const dir = seededTmp(slug);
    writeFileSync(
      join(dir, 'lib/slug.mjs'),
      'export function slugify(value) {\n  const parts = value.toLowerCase().split(/[^a-z0-9]+/);\n  return parts.filter((part) => part !== "").join("-");\n}\n',
    );
    const result = runOracle(dir, slug);
    expect(result.pass).toBe(true);
    const changed = changedFilesIn(dir, slug);
    expect(wrappedImplementations(changed, slug)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});

function relativeModulePath(fromFile: string, toFile: string): string {
  const from = fromFile.split('/').slice(0, -1);
  const to = toFile.split('/');
  const shared = Math.min(from.length, to.length - 1);
  let keep = 0;
  while (keep < shared && from[keep] === to[keep]) keep++;
  const up = '../'.repeat(from.length - keep);
  return `${up}${to.slice(keep).join('/')}`;
}

describe('#1830 anti-cheat', () => {
  const workdir = seededTmp(adderTask);

  test('read tool calls outside the workdir are flagged, inside are not', () => {
    const reads = outOfWorkdirReads(
      [
        { name: 'read', arguments: { path: 'lib/adder.mjs' } },
        { name: 'read', arguments: { path: join(workdir, 'lib/adder.mjs') } },
        { name: 'read', arguments: { path: '../../etc/hostname' } },
        { name: 'read', arguments: { path: '/etc/hostname' } },
      ],
      workdir,
    );
    expect(reads).toEqual(['../../etc/hostname', '/etc/hostname']);
  });

  test('bash read commands outside the workdir are flagged, other commands are not', () => {
    const reads = outOfWorkdirReads(
      [
        { name: 'bash', arguments: { command: 'cat ../secret.md' } },
        { name: 'bash', arguments: { command: 'grep -r add .' } },
        { name: 'bash', arguments: { command: 'node lib/adder.mjs' } },
        { name: 'bash', arguments: { command: 'ls /etc' } },
        { name: 'bash', arguments: { command: 'cat lib/adder.mjs' } },
        { name: 'bash', arguments: { command: 'head -3 ../snoop/answers.md' } },
      ],
      workdir,
    );
    expect(reads).toEqual(['cat ../secret.md', 'ls /etc', 'head -3 ../snoop/answers.md']);
  });

  test('bash reads with quoting or statement chains are still flagged', () => {
    const reads = outOfWorkdirReads(
      [
        { name: 'bash', arguments: { command: 'cd . && cat /etc/hostname' } },
        { name: 'bash', arguments: { command: 'cat "/etc/hostname"' } },
        { name: 'bash', arguments: { command: "cat '/etc/hostname'" } },
        { name: 'bash', arguments: { command: 'echo "$(cat /etc/hostname)"' } },
        { name: 'bash', arguments: { command: 'cat /etc/hostname | head -1' } },
        { name: 'bash', arguments: { command: 'cd .. && cat answers.md' } },
      ],
      workdir,
    );
    expect(reads).toEqual([
      'cd . && cat /etc/hostname',
      'cat "/etc/hostname"',
      "cat '/etc/hostname'",
      'echo "$(cat /etc/hostname)"',
      'cat /etc/hostname | head -1',
      'cd .. && cat answers.md',
    ]);
  });

  test('bash reads inside the workdir stay unflagged with quoting and chains', () => {
    const reads = outOfWorkdirReads(
      [
        { name: 'bash', arguments: { command: 'cd . && cat lib/adder.mjs' } },
        { name: 'bash', arguments: { command: 'cat "lib/adder.mjs"' } },
        { name: 'bash', arguments: { command: "cat 'lib/adder.mjs'" } },
        { name: 'bash', arguments: { command: 'cat lib/adder.mjs; echo ok' } },
        { name: 'bash', arguments: { command: 'echo "$(cat lib/adder.mjs)"' } },
      ],
      workdir,
    );
    expect(reads).toEqual([]);
  });

  test('tool calls without a readable path never crash the check', () => {
    expect(
      outOfWorkdirReads(
        [
          { name: 'read', arguments: {} },
          { name: 'bash', arguments: {} },
          { name: 'edit', arguments: { path: '/etc/hostname' } },
        ],
        workdir,
      ),
    ).toEqual([]);
  });

  test('changed files that reference or copy the decoy are flagged', () => {
    const slug = CAIRN_BENCH_TASKS.find((task) => task.id === 'slugify');
    if (slug === undefined || slug.decoy === undefined) throw new Error('slugify decoy missing');
    const decoyContent = slug.seedFiles[slug.decoy.file] ?? '';
    const flagged = wrappedImplementations(
      [
        { path: 'lib/slug.mjs', content: "export { slugify } from '../vendor/slug.mjs';\n" },
        {
          path: 'lib/other.mjs',
          content: "import { slugify } from '../vendor/slug.mjs';\nexport const s = slugify;\n",
        },
        { path: 'lib/copy.mjs', content: decoyContent },
        { path: 'lib/clean.mjs', content: 'export const slugify = (v) => v;\n' },
      ],
      slug,
    );
    expect(flagged).toEqual(['lib/slug.mjs', 'lib/other.mjs', 'lib/copy.mjs']);
  });

  test('gradeTaskRun counts cheats as failures even when the oracle passes', () => {
    const slug = CAIRN_BENCH_TASKS.find((task) => task.id === 'slugify');
    if (slug === undefined) throw new Error('slugify task missing');
    const session = (toolCalls: ToolCallEvidence[], dir: string) => [{ toolCalls, workdir: dir }];
    const clean = gradeTaskRun(slug, {
      oraclePass: true,
      sessions: session([{ name: 'read', arguments: { path: 'vendor/slug.mjs' } }], workdir),
      changed: [{ path: 'lib/slug.mjs', content: 'export const slugify = (v) => v;\n' }],
    });
    expect(clean.status).toBe('pass');
    expect(clean.why).toBe('oracle passed');

    const snooping = gradeTaskRun(slug, {
      oraclePass: true,
      sessions: session([{ name: 'read', arguments: { path: '/etc/hostname' } }], workdir),
      changed: [{ path: 'lib/slug.mjs', content: 'export const slugify = (v) => v;\n' }],
    });
    expect(snooping.status).toBe('fail');
    expect(snooping.outOfDirReads).toEqual(['/etc/hostname']);

    const wrapping = gradeTaskRun(slug, {
      oraclePass: true,
      sessions: session([], workdir),
      changed: [{ path: 'lib/slug.mjs', content: "export * from '../vendor/slug.mjs';\n" }],
    });
    expect(wrapping.status).toBe('fail');
    expect(wrapping.wrapped).toEqual(['lib/slug.mjs']);

    const failing = gradeTaskRun(slug, {
      oraclePass: false,
      sessions: session([], workdir),
      changed: [],
    });
    expect(failing.status).toBe('fail');
    expect(failing.why).toContain('oracle failed');
  });
});

describe('#1830 arm prompts', () => {
  test('the single arm uses the task prompt as is', () => {
    expect(executorPrompt(adderTask, null)).toBe(adderTask.prompt);
  });

  test('the handoff arm embeds the plan output in the executor prompt', () => {
    const prompt = executorPrompt(adderTask, 'Step 1: implement add.');
    expect(prompt).toContain(adderTask.prompt);
    expect(prompt).toContain('Step 1: implement add.');
    expect(prompt.indexOf('Step 1: implement add.')).toBeGreaterThan(
      prompt.indexOf(adderTask.prompt.slice(0, 20)),
    );
  });

  test('the planner prompt asks for a plan and forbids file changes', () => {
    const prompt = plannerPrompt(adderTask);
    expect(prompt).toContain(adderTask.prompt);
    expect(prompt.toLowerCase()).toContain('do not modify');
  });
});

describe('#1830 aggregation and report', () => {
  test('wilson interval is empty without samples and stays inside [0, 1]', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const [lo, hi] = wilsonInterval(8, 10) ?? [0, 0];
    expect(lo).toBeGreaterThan(0.4);
    expect(hi).toBeLessThan(1);
    expect(lo).toBeLessThan(0.8);
    expect(hi).toBeGreaterThan(0.8);
  });

  test('bootstrap CI is deterministic and brackets the mean', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const first = bootstrapMeanCI(values);
    const second = bootstrapMeanCI(values);
    expect(first).toEqual(second);
    const [lo, hi] = first ?? [0, 0];
    expect(lo).toBeLessThanOrEqual(5.5);
    expect(hi).toBeGreaterThanOrEqual(5.5);
    expect(bootstrapMeanCI([])).toBeNull();
  });

  test('run cost multiplies token counts by per-million prices', () => {
    expect(
      runCostUsd(
        { input: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0 },
        { input: 2, output: 4, cacheRead: 0.5, cacheWrite: 0 },
      ),
    ).toBe(4);
    expect(
      runCostUsd({ input: 10, output: 10, cacheRead: 0, cacheWrite: 0 }, undefined),
    ).toBeNull();
  });

  test('aggregateByModel groups per arm and model, excluding errors from the pass rate', () => {
    const row = (
      model: string,
      status: RoutingRunRow['status'],
      arm: RoutingRunRow['arm'],
    ): RoutingRunRow => ({
      task_id: 't',
      arm,
      model,
      planner_model: arm === 'handoff' ? 'strong' : null,
      rep: 0,
      status,
      oracle_pass: status === 'pass',
      out_of_workdir_reads: status === 'fail' ? ['/etc/hostname'] : [],
      wrapped_implementations: [],
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
      cost_usd: 0.01,
      wall_ms: 1000,
      stop_reason: 'done',
    });
    const aggregates = aggregateByModel([
      row('cheap-a', 'pass', 'handoff'),
      row('cheap-a', 'fail', 'handoff'),
      row('cheap-a', 'error', 'handoff'),
      row('cheap-b', 'pass', 'handoff'),
      row('strong', 'pass', 'single'),
      row('strong', 'pass', 'single'),
    ]);
    const byKey = new Map(aggregates.map((a) => [`${a.arm}/${a.model}`, a]));
    const cheapA = byKey.get('handoff/cheap-a');
    if (cheapA === undefined) throw new Error('missing aggregate');
    expect(cheapA.runs).toBe(3);
    expect(cheapA.graded).toBe(2);
    expect(cheapA.passes).toBe(1);
    expect(cheapA.errors).toBe(1);
    expect(cheapA.flagged).toBe(1);
    expect(cheapA.passRate).toBe(0.5);
    const strong = byKey.get('single/strong');
    if (strong === undefined) throw new Error('missing aggregate');
    expect(strong.passRate).toBe(1);
    expect(strong.passRateCI).not.toBeNull();
  });

  test('renderReport shows per-model rows, the planner overhead and flagged runs', () => {
    const rows: RoutingRunRow[] = [
      {
        task_id: 'slugify',
        arm: 'handoff',
        model: 'cheap-a',
        planner_model: 'strong',
        rep: 0,
        status: 'fail',
        oracle_pass: true,
        out_of_workdir_reads: ['/etc/hostname'],
        wrapped_implementations: [],
        usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        cost_usd: 0.01,
        wall_ms: 1000,
        stop_reason: 'done',
        why: 'out-of-workdir reads: /etc/hostname',
      },
      {
        task_id: 'slugify',
        arm: 'single',
        model: 'strong',
        planner_model: null,
        rep: 0,
        status: 'pass',
        oracle_pass: true,
        out_of_workdir_reads: [],
        wrapped_implementations: [],
        usage: { input: 900, output: 500, cacheRead: 0, cacheWrite: 0 },
        cost_usd: 0.09,
        wall_ms: 4000,
        stop_reason: 'done',
        why: 'oracle passed',
      },
    ];
    const report = renderReport(rows, {
      benchSize: 20,
      generatedAt: '2026-10-27T00:00:00.000Z',
      plannerModel: 'strong',
    });
    expect(report).toContain('| arm | model |');
    expect(report).toContain('handoff');
    expect(report).toContain('cheap-a');
    expect(report).toContain('strong');
    expect(report).toContain('/etc/hostname');
    expect(report).toContain('planner');
  });
});

describe('#1830 runner end to end against a stub model', () => {
  const agentRoot = mkdtempSync(join(tmpdir(), 'cairn-routing-agent-'));
  const stubs: Array<() => Promise<void>> = [];

  afterAll(async () => {
    for (const close of stubs.splice(0)) await close();
    rmSync(agentRoot, { recursive: true, force: true });
  });

  test('the handoff arm passes a clean run and records usage', async () => {
    const stub = await startStubLlm([
      {
        content:
          'Plan: implement add in lib/adder.mjs, returning a + b. Replace the throwing stub.',
      },
      {
        toolCall: {
          name: 'write',
          arguments: { path: 'lib/adder.mjs', content: CORRECT_ADDER },
        },
      },
      { content: 'Implemented add in lib/adder.mjs.' },
    ]);
    stubs.push(() => stub.close());
    const workdir = mkdtempSync(join(tmpdir(), 'cairn-routing-run-'));
    const row = await runRoutingRun({
      task: adderTask,
      arm: 'handoff',
      modelId: 'stub-model',
      rep: 0,
      plannerModelId: 'stub-model',
      endpoint: { baseUrl: stub.url, apiKey: 'stub-key' },
      models: ['stub-model'],
      agentDir: agentRoot,
      sessionDir: agentRoot,
      workdir,
      prices: { 'stub-model': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } },
      timeoutMs: 120_000,
    });
    expect(row.status).toBe('pass');
    expect(row.oracle_pass).toBe(true);
    expect(row.plan_chars ?? 0).toBeGreaterThan(0);
    expect(row.usage?.output ?? 0).toBeGreaterThan(0);
    expect(row.planner_usage?.output ?? 0).toBeGreaterThan(0);
    expect(row.cost_usd).not.toBeNull();
    expect(readFileSync(join(workdir, 'lib/adder.mjs'), 'utf8')).toBe(CORRECT_ADDER);
  }, 180_000);

  test('the single arm grades a real cairn-bench task end to end', async () => {
    const slug = CAIRN_BENCH_TASKS.find((task) => task.id === 'slugify');
    if (slug === undefined) throw new Error('slugify task missing');
    const correct =
      'export function slugify(value) {\n  const parts = value.toLowerCase().split(/[^a-z0-9]+/);\n  return parts.filter((part) => part !== "").join("-");\n}\n';
    const stub = await startStubLlm([
      { toolCall: { name: 'write', arguments: { path: 'lib/slug.mjs', content: correct } } },
      { content: 'Implemented slugify in lib/slug.mjs.' },
    ]);
    stubs.push(() => stub.close());
    const workdir = mkdtempSync(join(tmpdir(), 'cairn-routing-run-'));
    const row = await runRoutingRun({
      task: slug,
      arm: 'single',
      modelId: 'stub-model',
      rep: 0,
      endpoint: { baseUrl: stub.url, apiKey: 'stub-key' },
      models: ['stub-model'],
      agentDir: agentRoot,
      sessionDir: agentRoot,
      workdir,
      timeoutMs: 120_000,
    });
    expect(row.status).toBe('pass');
    expect(row.oracle_pass).toBe(true);
    expect(row.planner_model).toBeNull();
    expect(row.plan_chars).toBeNull();
    expect(readFileSync(join(workdir, 'lib/slug.mjs'), 'utf8')).toBe(correct);
  }, 180_000);

  test('a planner that writes the implementation does not hand the executor a done task', async () => {
    const stub = await startStubLlm([
      {
        toolCall: {
          name: 'write',
          arguments: { path: 'lib/adder.mjs', content: CORRECT_ADDER },
        },
      },
      { content: 'Plan: replace the adder stub.' },
      { content: 'Implemented.' },
    ]);
    stubs.push(() => stub.close());
    const workdir = mkdtempSync(join(tmpdir(), 'cairn-routing-run-'));
    const row = await runRoutingRun({
      task: adderTask,
      arm: 'handoff',
      modelId: 'stub-model',
      rep: 0,
      plannerModelId: 'stub-model',
      endpoint: { baseUrl: stub.url, apiKey: 'stub-key' },
      models: ['stub-model'],
      agentDir: agentRoot,
      sessionDir: agentRoot,
      workdir,
      timeoutMs: 120_000,
    });
    expect(row.oracle_pass).toBe(false);
    expect(row.status).toBe('fail');
    expect(readFileSync(join(workdir, 'lib/adder.mjs'), 'utf8')).toContain('not implemented');
  }, 180_000);

  test('a planner that reads outside its workdir fails the run', async () => {
    const snoopDir = mkdtempSync(join(tmpdir(), 'cairn-routing-snoop-'));
    writeFileSync(join(snoopDir, 'answers.md'), 'the answers');
    const stub = await startStubLlm([
      { toolCall: { name: 'read', arguments: { path: join(snoopDir, 'answers.md') } } },
      { content: 'Plan: implement add returning a + b.' },
      {
        toolCall: {
          name: 'write',
          arguments: { path: 'lib/adder.mjs', content: CORRECT_ADDER },
        },
      },
      { content: 'Implemented add in lib/adder.mjs.' },
    ]);
    stubs.push(() => stub.close());
    const workdir = mkdtempSync(join(tmpdir(), 'cairn-routing-run-'));
    const row = await runRoutingRun({
      task: adderTask,
      arm: 'handoff',
      modelId: 'stub-model',
      rep: 0,
      plannerModelId: 'stub-model',
      endpoint: { baseUrl: stub.url, apiKey: 'stub-key' },
      models: ['stub-model'],
      agentDir: agentRoot,
      sessionDir: agentRoot,
      workdir,
      timeoutMs: 120_000,
    });
    expect(row.oracle_pass).toBe(true);
    expect(row.status).toBe('fail');
    expect(row.out_of_workdir_reads).toEqual([join(snoopDir, 'answers.md')]);
  }, 180_000);

  test('an out-of-workdir read fails the run even though the oracle passes', async () => {
    const snoopDir = mkdtempSync(join(tmpdir(), 'cairn-routing-snoop-'));
    writeFileSync(join(snoopDir, 'answers.md'), 'the answers');
    const stub = await startStubLlm([
      { content: 'Plan: implement add in lib/adder.mjs, returning a + b.' },
      { toolCall: { name: 'read', arguments: { path: join(snoopDir, 'answers.md') } } },
      {
        toolCall: {
          name: 'write',
          arguments: { path: 'lib/adder.mjs', content: CORRECT_ADDER },
        },
      },
      { content: 'Implemented add in lib/adder.mjs.' },
    ]);
    stubs.push(() => stub.close());
    const workdir = mkdtempSync(join(tmpdir(), 'cairn-routing-run-'));
    const row = await runRoutingRun({
      task: adderTask,
      arm: 'handoff',
      modelId: 'stub-model',
      rep: 0,
      plannerModelId: 'stub-model',
      endpoint: { baseUrl: stub.url, apiKey: 'stub-key' },
      models: ['stub-model'],
      agentDir: agentRoot,
      sessionDir: agentRoot,
      workdir,
      prices: { 'stub-model': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } },
      timeoutMs: 120_000,
    });
    expect(row.oracle_pass).toBe(true);
    expect(row.status).toBe('fail');
    expect(row.out_of_workdir_reads).toEqual([join(snoopDir, 'answers.md')]);
  }, 180_000);
});
