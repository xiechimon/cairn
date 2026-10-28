import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { CAIRN_BENCH_TASKS } from '../eval/routing/bench.mts';
import { runRoutingRun } from '../eval/routing/driver.mts';
import { gradeBoundedRun } from '../eval/routing/grade.mts';
import { REFERENCE_FILES } from './routing-reference.js';
import { type StubLlm, type StubResponse, startStubLlm } from './stub-llm.js';

const nativeToolchain =
  process.platform === 'linux' &&
  process.arch === 'x64' &&
  spawnSync('gcc', ['--version'], { encoding: 'utf8', timeout: 10_000 }).status === 0 &&
  spawnSync('ldd', ['--version'], { encoding: 'utf8', timeout: 10_000 }).status === 0;

let root: string;
let stub: StubLlm | undefined;

afterEach(async () => {
  await stub?.close();
  stub = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
});

test.skipIf(!nativeToolchain)(
  'planner programmatic shell writes are denied before execution',
  async () => {
    root = mkdtempSync(join(tmpdir(), 'routing-sessions-'));
    writeFileSync(join(root, 'sentinel'), 'private-sentinel-1986');
    const task = CAIRN_BENCH_TASKS.find((entry) => entry.id === 'slugify');
    if (!task) throw new Error('Missing slugify task');
    const reference = REFERENCE_FILES.slugify!['lib/slug.mjs']!;
    const command = `node -e 'require("fs").writeFileSync("lib/slug.mjs", "planner changed this")'`;
    stub = await startStubLlm([
      { toolCall: { name: 'bash', arguments: { command } } },
      { content: 'Implement slugify independently.' },
      { toolCall: { name: 'write', arguments: { path: 'lib/slug.mjs', content: reference } } },
      { content: 'done' },
    ]);
    const row = await runRoutingRun({
      task,
      arm: 'handoff',
      modelId: 'stub-model',
      plannerModelId: 'stub-model',
      rep: 0,
      endpoint: { baseUrl: stub.url, apiKey: 'bench-key' },
      models: ['stub-model'],
      workdir: join(root, 'run'),
      agentDir: join(root, 'agent'),
      sessionDir: join(root, 'sessions'),
      timeoutMs: 20_000,
    });
    expect(readFileSync(join(root, 'run/planner/lib/slug.mjs'), 'utf8')).toBe(
      task.seedFiles['lib/slug.mjs'],
    );
    expect(row.oracle_pass).toBe(true);
    expect(row.status).toBe('fail');
    expect(row.planner_violations.join('\n')).toContain(command);
    const plannerFeedback = JSON.stringify(stub.requests[1]?.messages);
    expect(plannerFeedback).not.toContain('planner changed this\n');
  },
);

async function runSessionCase(options: {
  planner?: StubResponse[];
  executor: StubResponse[];
  modelId?: string;
  plannerModelId?: string;
  timeoutMs?: number;
  onResponse?: () => void;
}) {
  root = mkdtempSync(join(tmpdir(), 'routing-sessions-'));
  writeFileSync(join(root, 'sentinel'), 'private-sentinel-1986');
  const task = CAIRN_BENCH_TASKS.find((entry) => entry.id === 'slugify');
  if (!task) throw new Error('Missing slugify task');
  stub = await startStubLlm([...(options.planner ?? []), ...options.executor], {
    onConsumed: options.onResponse,
  });
  return runRoutingRun({
    task,
    arm: options.planner ? 'handoff' : 'single',
    modelId: options.modelId ?? 'stub-model',
    plannerModelId: options.plannerModelId ?? 'stub-model',
    rep: 0,
    endpoint: { baseUrl: stub.url, apiKey: 'bench-key' },
    models: ['stub-model'],
    workdir: join(root, 'run'),
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
    timeoutMs: options.timeoutMs ?? 20_000,
  });
}

test('session creation errors produce attributable failed rows', async () => {
  const row = await runSessionCase({
    planner: [{ content: 'Implement slugify.' }],
    executor: [],
    modelId: 'missing-model',
  });
  expect(row.status).toBe('error');
  expect(row.error).toContain('executor session error');
  expect(row.planner_usage?.output).toBeGreaterThan(0);
  expect(row.wall_ms).toBeGreaterThanOrEqual(0);
});

const solution: StubResponse = {
  toolCall: {
    name: 'write',
    arguments: { path: 'lib/slug.mjs', content: REFERENCE_FILES.slugify!['lib/slug.mjs']! },
  },
};
const plan = 'Implement slugify with lowercase, dash collapsing, and trimming.';

test.skipIf(!nativeToolchain)(
  'single arm: a stub-relay session edits the workspace and the real oracle passes',
  async () => {
    const row = await runSessionCase({ executor: [solution, { content: 'done' }] });
    expect(row.status).toBe('pass');
    expect(row.oracle_pass).toBe(true);
    expect(row.planner_usage).toBeNull();
    expect(row.planner_wall_ms).toBeNull();
  },
);

test.skipIf(!nativeToolchain)(
  'handoff arm: a fresh executor receives the original task, only plan text, and seeded files',
  async () => {
    const row = await runSessionCase({
      planner: [
        {
          toolCall: {
            id: 'planner-private-history-1986',
            name: 'read',
            arguments: { path: 'lib/slug.mjs' },
          },
        },
        { content: plan, usage: { prompt: 41, completion: 17 } },
      ],
      executor: [
        { toolCall: { name: 'read', arguments: { path: 'lib/slug.mjs' } } },
        solution,
        { content: 'done', usage: { prompt: 73, completion: 29 } },
      ],
    });
    expect(row.status).toBe('pass');
    const task = CAIRN_BENCH_TASKS.find((entry) => entry.id === 'slugify');
    if (!task) throw new Error('Missing slugify task');
    const executorRequest = stub?.requests[2];
    expect(executorRequest?.messages.filter((message) => message.role === 'user')).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${task.prompt}\n\n## Implementation plan (written by the planner model)\n\n${plan}\n\nImplement the plan above. The task statement and the plan together are the full requirement.`,
          },
        ],
      },
    ]);
    const content = JSON.stringify(executorRequest?.messages);
    expect(content).toContain(plan);
    expect(content).not.toContain('planner-private-history-1986');
    expect(executorRequest?.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(executorRequest?.messages).toHaveLength(2);
    expect(stub?.requests[3]?.messages.filter((message) => message.role === 'tool')).toEqual([
      expect.objectContaining({ content: task.seedFiles['lib/slug.mjs'] }),
    ]);
    expect(row.planner_boundary.executions).toEqual([
      expect.objectContaining({
        enforced: true,
        exitCode: 0,
        stdout: task.seedFiles['lib/slug.mjs'],
        violations: [],
        runtimeDenials: expect.any(Array),
      }),
    ]);
    expect(row.planner_usage?.output).toBe(997);
    expect(row.usage?.output).toBe(1989);
    expect(row.planner_wall_ms).toBeGreaterThan(0);
    expect(row.wall_ms).toBeGreaterThan(0);
  },
);

test.each(['write', 'edit', 'bash'])(
  'planner %s attempts cannot implement for a no-op executor',
  async (name) => {
    const row = await runSessionCase({
      planner: [
        {
          toolCall: {
            name,
            arguments:
              name === 'bash'
                ? { command: 'echo implemented > lib/slug.mjs' }
                : name === 'edit'
                  ? {
                      path: 'lib/slug.mjs',
                      oldText: "throw new Error('not implemented');",
                      newText: 'return value;',
                    }
                  : solution.toolCall!.arguments,
          },
        },
        { content: plan },
      ],
      executor: [{ content: 'done' }],
    });
    expect(row.status).toBe('fail');
    expect(row.oracle_pass).toBe(false);
    expect(row.planner_violations.length).toBeGreaterThan(0);
    const task = CAIRN_BENCH_TASKS.find((entry) => entry.id === 'slugify')!;
    for (const role of ['planner', 'executor']) {
      expect(readFileSync(join(root, `run/${role}/lib/slug.mjs`), 'utf8')).toBe(
        task.seedFiles['lib/slug.mjs'],
      );
    }
  },
);

test.skipIf(!nativeToolchain).each(['planner', 'executor'] as const)(
  '%s forbidden reads never reach the relay and fail despite a passing oracle',
  async (role) => {
    const forbidden: StubResponse = {
      toolCall: { name: 'read', arguments: { path: '../../sentinel' } },
    };
    const row = await runSessionCase({
      planner: role === 'planner' ? [forbidden, { content: plan }] : [{ content: plan }],
      executor:
        role === 'executor'
          ? [forbidden, solution, { content: 'done' }]
          : [solution, { content: 'done' }],
    });
    expect(row.oracle_pass).toBe(true);
    expect(row.status).toBe('fail');
    expect((role === 'planner' ? row.planner_violations : row.violations).join('\n')).toContain(
      'sentinel',
    );
    const feedback = JSON.stringify(stub?.requests[role === 'planner' ? 1 : 2]?.messages);
    expect(feedback).toContain('EACCES');
    expect(feedback).not.toContain('private-sentinel-1986');
  },
);

test.skipIf(!nativeToolchain)(
  'planner executor-directory reads are denied before returning task data',
  async () => {
    let planted = false;
    const row = await runSessionCase({
      onResponse: () => {
        if (planted) return;
        mkdirSync(join(root, 'run/executor/lib'), { recursive: true });
        writeFileSync(join(root, 'run/executor/lib/slug.mjs'), 'executor-private-payload-1986');
        planted = true;
      },
      planner: [
        { toolCall: { name: 'read', arguments: { path: '../executor/lib/slug.mjs' } } },
        { content: plan },
      ],
      executor: [solution, { content: 'done' }],
    });
    expect(row.oracle_pass).toBe(true);
    expect(row.status).toBe('fail');
    expect(row.planner_violations.join('\n')).toContain('executor/lib/slug.mjs');
    const feedback = JSON.stringify(stub?.requests[1]?.messages);
    expect(feedback).toContain('EACCES');
    expect(planted).toBe(true);
    expect(feedback).not.toContain('executor-private-payload-1986');
    expect(stub?.requests[1]?.messages.filter((message) => message.role === 'tool')).toEqual([
      expect.objectContaining({
        content: 'Denied: EACCES read tool: outside workspace: ../executor/lib/slug.mjs',
      }),
    ]);
    expect(row.planner_boundary.executions[0]?.violations).toEqual(row.planner_violations);
    expect(row.violations).toEqual(expect.arrayContaining(row.planner_violations));
  },
);

test.each(['planner', 'executor'] as const)(
  '%s session errors preserve role attribution',
  async (role) => {
    const row = await runSessionCase({
      planner: role === 'planner' ? [{ status: 400 }] : [{ content: plan }],
      executor: role === 'executor' ? [{ status: 400 }] : [],
    });
    expect(row.status).toBe('error');
    expect(row.error).toContain(`${role} session error`);
    expect(row.stop_reason).toBe('error');
    expect(row.planner_wall_ms).toBeGreaterThanOrEqual(0);
    if (role === 'planner') expect(row.usage).toBeNull();
  },
);

test.each(['planner', 'executor'] as const)(
  '%s timeouts cannot become successful runs',
  async (role) => {
    const slow: StubResponse = { content: 'late result', delayMs: 1500 };
    const row = await runSessionCase({
      planner: role === 'planner' ? [slow] : [{ content: plan }],
      executor: role === 'executor' ? [slow] : [],
      timeoutMs: 500,
    });
    expect(row.status).toBe('error');
    expect(row.stop_reason).toBe('timeout');
    expect(row.error).toContain(`${role} session error`);
  },
);

test('empty plans stop before executor creation', async () => {
  const row = await runSessionCase({ planner: [{ content: '  ' }], executor: [solution] });
  expect(row.status).toBe('error');
  expect(row.plan_chars).toBe(0);
  expect(row.usage).toBeNull();
  expect(stub?.requests).toHaveLength(1);
  expect(existsSync(join(root, 'run/executor'))).toBe(false);
});

test.skipIf(!nativeToolchain)(
  'executor symlinks cannot bypass the live read boundary',
  async () => {
    const row = await runSessionCase({
      executor: [
        {
          toolCall: {
            name: 'bash',
            arguments: {
              command: `node -e 'require("fs").symlinkSync("../../sentinel", "linked")'`,
            },
          },
        },
        { toolCall: { name: 'read', arguments: { path: 'linked' } } },
        solution,
        { content: 'done' },
      ],
    });
    expect(row.oracle_pass).toBe(true);
    expect(row.status).toBe('fail');
    expect(row.violations.join('\n')).toContain('linked');
    const feedback = JSON.stringify(stub?.requests[2]?.messages);
    expect(feedback).toContain('EACCES');
    expect(feedback).not.toContain('private-sentinel-1986');
  },
);

test.skipIf(!nativeToolchain)(
  'explicit file reads cannot use runtime resource allowances as task data',
  async () => {
    const row = await runSessionCase({
      executor: [
        { toolCall: { name: 'read', arguments: { path: '/etc/passwd' } } },
        solution,
        { content: 'done' },
      ],
    });
    expect(row.oracle_pass).toBe(true);
    expect(row.status).toBe('fail');
    expect(row.violations.join('\n')).toContain('/etc/passwd');
    expect(JSON.stringify(stub?.requests[1]?.messages)).not.toContain('root:x:');
  },
);

test.skipIf(!nativeToolchain).each(['/etc/passwd', '/dev/null'])(
  'planner explicit runtime-resource read %s is blocked and graded',
  async (path) => {
    const row = await runSessionCase({
      planner: [{ toolCall: { name: 'read', arguments: { path } } }, { content: plan }],
      executor: [solution, { content: 'done' }],
    });
    expect(row.oracle_pass).toBe(true);
    expect(row.status).toBe('fail');
    expect(stub?.requests[1]?.messages.filter((message) => message.role === 'tool')).toEqual([
      expect.objectContaining({ content: `Denied: EACCES read tool: outside workspace: ${path}` }),
    ]);
    expect(row.planner_boundary.executions[0]).toMatchObject({
      enforced: true,
      exitCode: 1,
      stdout: '',
      violations: [`read tool: outside workspace: ${path}`],
    });
    expect(row.violations).toContain(`read tool: outside workspace: ${path}`);
    expect(
      gradeBoundedRun(
        { seedFiles: {} },
        {
          oraclePass: true,
          executions: row.planner_boundary.executions,
          changed: [],
        },
      ).status,
    ).toBe('fail');
  },
);
