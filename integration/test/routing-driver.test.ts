import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { builtinToolNames } from '../../apps/daemon/src/backend/pi.js';
import { CAIRN_BENCH_TASKS } from '../eval/routing/bench.mts';
import { type RoutingRunRow, runRoutingRun } from '../eval/routing/driver.mts';
import { type RoleBoundary, sessionTools } from '../eval/routing/session-tools.mts';
import { REFERENCE_FILES } from './routing-reference.js';
import { type StubLlm, type StubResponse, startStubLlm } from './stub-llm.js';

const nativeToolchain =
  process.platform === 'linux' &&
  process.arch === 'x64' &&
  spawnSync('gcc', ['--version'], { encoding: 'utf8', timeout: 10_000 }).status === 0 &&
  spawnSync('ldd', ['--version'], { encoding: 'utf8', timeout: 10_000 }).status === 0;

const slugify = () => CAIRN_BENCH_TASKS.find((task) => task.id === 'slugify');
const slugReference = REFERENCE_FILES.slugify!['lib/slug.mjs']!;

const writeSlug = (): StubResponse => ({
  toolCall: { name: 'write', arguments: { path: 'lib/slug.mjs', content: slugReference } },
});
const done = (): StubResponse => ({ content: 'done' });
const planText =
  'Lowercase the input, collapse runs of non-alphanumeric characters to a single dash, then trim leading and trailing dashes.';

let root: string;
let stub: StubLlm | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'routing-driver-'));
});

afterEach(async () => {
  await stub?.close();
  stub = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function runOnce(opts: {
  arm: 'single' | 'handoff';
  planner?: StubResponse[];
  executor: StubResponse[];
  timeoutMs?: number;
}): Promise<RoutingRunRow> {
  const task = slugify();
  if (!task) throw new Error('Missing slugify task');
  stub = await startStubLlm([...(opts.planner ?? []), ...opts.executor]);
  return runRoutingRun({
    task,
    arm: opts.arm,
    modelId: 'stub-model',
    plannerModelId: opts.arm === 'handoff' ? 'stub-model' : undefined,
    rep: 0,
    endpoint: { baseUrl: stub.url, apiKey: 'bench-key' },
    models: ['stub-model'],
    workdir: join(root, 'run'),
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
    timeoutMs: opts.timeoutMs ?? 20_000,
  });
}

describe('#1986 planner read-only role invariants outside the runner', () => {
  test('the backend read-only tool set carries no mutating builtin', () => {
    expect(builtinToolNames(true)).not.toContain('write');
    expect(builtinToolNames(true)).not.toContain('edit');
  });

  test('every non-read local tool is denied for the planner role', async () => {
    const evidence: RoleBoundary = { executions: [], violations: [] };
    root = mkdtempSync(join(tmpdir(), 'routing-tools-'));
    const tools = sessionTools(root, true, evidence, 20_000);
    expect(tools.map((tool) => tool.name).sort()).toEqual(['bash', 'edit', 'read', 'write']);
    for (const tool of tools) {
      if (tool.name === 'read') continue;
      const result = await tool.execute(
        tool.name === 'bash'
          ? { command: 'echo mutated > probe.txt' }
          : tool.name === 'write'
            ? { path: 'probe.txt', content: 'mutated' }
            : { path: 'probe.txt', oldText: 'a', newText: 'b' },
      );
      expect(String(result)).toContain('Denied');
    }
    expect(evidence.violations).toHaveLength(3);
    expect(existsSync(join(root, 'probe.txt'))).toBe(false);
    expect(evidence.executions.every((execution) => execution.violations.length === 1)).toBe(true);
  });
});

describe('#1986 programmatic routing runner failures that need no sandbox', () => {
  test('an empty plan can never become a successful run', async () => {
    const row = await runOnce({ arm: 'handoff', planner: [{ content: '' }], executor: [] });
    expect(row.status).toBe('error');
    expect(row.stop_reason).toBe('done');
    expect(row.error).toContain('plan');
    expect(stub?.requests.length).toBe(1);
  });

  test('a planner session error is attributable and cannot pass', async () => {
    const row = await runOnce({
      arm: 'handoff',
      planner: [{ status: 400 }],
      executor: [writeSlug(), done()],
    });
    expect(row.status).toBe('error');
    expect(row.stop_reason).toBe('error');
    expect(row.error).toContain('planner session error');
    expect(row.planner_wall_ms).toBeGreaterThanOrEqual(0);
    expect(row.usage).toBeNull();
  });

  test('an executor session error is attributable and cannot pass', async () => {
    const row = await runOnce({
      arm: 'handoff',
      planner: [{ content: planText }],
      executor: [{ status: 400 }],
    });
    expect(row.status).toBe('error');
    expect(row.stop_reason).toBe('error');
    expect(row.error).toContain('executor session error');
    expect(row.planner_usage).not.toBeNull();
  });

  test('a planner timeout cannot pass and stays attributable', async () => {
    const row = await runOnce({
      arm: 'handoff',
      planner: [{ content: 'slow', delayMs: 8_000 }],
      executor: [writeSlug(), done()],
      timeoutMs: 1_500,
    });
    expect(row.status).toBe('error');
    expect(row.stop_reason).toBe('timeout');
    expect(row.error).toContain('planner session error');
  });

  test('an executor timeout cannot pass', async () => {
    const row = await runOnce({
      arm: 'handoff',
      planner: [{ content: planText }],
      executor: [{ content: 'slow', delayMs: 8_000 }],
      timeoutMs: 1_500,
    });
    expect(row.status).toBe('error');
    expect(row.stop_reason).toBe('timeout');
    expect(row.error).toContain('executor session error');
  });
});

describe.skipIf(!nativeToolchain)(
  '#1986 programmatic routing runner through the real backend and oracle',
  () => {
    test('the single arm passes through the real backend and oracle', async () => {
      const row = await runOnce({ arm: 'single', executor: [writeSlug(), done()] });
      expect(row.status).toBe('pass');
      expect(row.oracle_pass).toBe(true);
      expect(row.planner_model).toBeNull();
      expect(row.plan_chars).toBeNull();
      expect(row.violations).toEqual([]);
      expect(row.wrapped_implementations).toEqual([]);
      expect(row.planner_violations).toEqual([]);
      expect(row.stop_reason).toBe('done');
      expect(row.usage?.output).toBeGreaterThan(0);
      expect(row.wall_ms).toBeGreaterThanOrEqual(0);
    });

    test('the handoff arm transfers only plan text into a freshly seeded executor', async () => {
      const row = await runOnce({
        arm: 'handoff',
        planner: [{ content: planText }],
        executor: [writeSlug(), done()],
      });
      expect(row.status).toBe('pass');
      expect(row.oracle_pass).toBe(true);
      expect(row.planner_model).toBe('stub-model');
      expect(row.plan_chars).toBe(planText.length);
      expect(row.planner_usage?.output).toBeGreaterThan(0);
      expect(row.planner_wall_ms).toBeGreaterThanOrEqual(0);
      expect(row.planner_violations).toEqual([]);

      const executorRequest = stub?.requests[1];
      if (!executorRequest) throw new Error('Missing executor request');
      const messages = JSON.stringify(executorRequest.messages);
      expect(messages).toContain(planText);
      expect(messages).toContain('slugify(value)');
      expect(executorRequest.model).toBe('stub-model');

      const executorWorkdir = join(root, 'run', 'executor');
      expect(existsSync(join(executorWorkdir, 'lib', 'slug.mjs'))).toBe(true);
      expect(readdirSync(executorWorkdir).sort()).toEqual(['lib', 'oracle.check.mjs', 'vendor']);

      const plannerWorkdir = join(root, 'run', 'planner');
      expect(existsSync(join(plannerWorkdir, 'lib', 'slug.mjs'))).toBe(true);
      expect(existsSync(join(plannerWorkdir, 'vendor', 'slug.mjs'))).toBe(false);
    });

    test('a planner write tool attempt fails the run even when the executor passes', async () => {
      const row = await runOnce({
        arm: 'handoff',
        planner: [
          {
            toolCall: {
              name: 'write',
              arguments: { path: 'lib/slug.mjs', content: slugReference },
            },
          },
          { content: planText },
        ],
        executor: [writeSlug(), done()],
      });
      expect(row.oracle_pass).toBe(true);
      expect(row.status).toBe('fail');
      expect(row.planner_violations.some((entry) => entry.includes('write tool attempt'))).toBe(
        true,
      );
      expect(row.planner_violations).not.toBe(row.planner_boundary.violations);
      expect(row.planner_violations).toEqual(row.planner_boundary.violations);
      const slugSeed = slugify()?.seedFiles['lib/slug.mjs'];
      if (!slugSeed) throw new Error('Missing slug seed');
      expect(readFileSync(join(root, 'run', 'planner', 'lib', 'slug.mjs'), 'utf8')).toBe(slugSeed);
    });

    test('a planner implementing the task cannot make a no-op executor pass', async () => {
      const row = await runOnce({
        arm: 'handoff',
        planner: [
          {
            toolCall: {
              name: 'write',
              arguments: { path: 'lib/slug.mjs', content: slugReference },
            },
          },
          { content: planText },
        ],
        executor: [done()],
      });
      expect(row.status).toBe('fail');
      expect(row.oracle_pass).toBe(false);
      expect(row.planner_violations.some((entry) => entry.includes('write tool attempt'))).toBe(
        true,
      );
    });

    test('a planner shell write attempt is denied and recorded', async () => {
      const row = await runOnce({
        arm: 'handoff',
        planner: [
          { toolCall: { name: 'bash', arguments: { command: 'echo "x" > lib/slug.mjs' } } },
          { content: planText },
        ],
        executor: [writeSlug(), done()],
      });
      expect(row.status).toBe('fail');
      expect(row.planner_violations.some((entry) => entry.includes('shell write attempt'))).toBe(
        true,
      );
      const slugSeed = slugify()?.seedFiles['lib/slug.mjs'];
      if (!slugSeed) throw new Error('Missing slug seed');
      expect(readFileSync(join(root, 'run', 'planner', 'lib', 'slug.mjs'), 'utf8')).toBe(slugSeed);
    });

    test('a planner external read is recorded from the sandbox and fails the run', async () => {
      const row = await runOnce({
        arm: 'handoff',
        planner: [
          { toolCall: { name: 'bash', arguments: { command: 'cat /etc/hostname' } } },
          { content: planText },
        ],
        executor: [writeSlug(), done()],
      });
      expect(row.oracle_pass).toBe(true);
      expect(row.status).toBe('fail');
      expect(row.planner_violations.some((entry) => entry.includes('/etc/hostname'))).toBe(true);
    });

    test('an executor external read is recorded despite a passing oracle', async () => {
      const row = await runOnce({
        arm: 'handoff',
        planner: [{ content: planText }],
        executor: [
          { toolCall: { name: 'bash', arguments: { command: 'cat /etc/hostname' } } },
          writeSlug(),
          done(),
        ],
      });
      expect(row.oracle_pass).toBe(true);
      expect(row.status).toBe('fail');
      expect(row.violations.some((entry) => entry.includes('/etc/hostname'))).toBe(true);
    });

    test('a planner read-tool external read is recorded and fails the run', async () => {
      const row = await runOnce({
        arm: 'handoff',
        planner: [
          { toolCall: { name: 'read', arguments: { path: '/etc/hostname' } } },
          { content: planText },
        ],
        executor: [writeSlug(), done()],
      });
      expect(row.oracle_pass).toBe(true);
      expect(row.status).toBe('fail');
      expect(row.planner_violations.some((entry) => entry.includes('read tool'))).toBe(true);
    });

    test('a planner attempt to touch executor data is blocked and recorded', async () => {
      const executorPath = join(root, 'run', 'executor', 'lib', 'slug.mjs');
      const row = await runOnce({
        arm: 'handoff',
        planner: [
          { toolCall: { name: 'bash', arguments: { command: `cat '${executorPath}'` } } },
          { content: planText },
        ],
        executor: [writeSlug(), done()],
      });
      expect(row.oracle_pass).toBe(true);
      expect(row.status).toBe('fail');
      expect(row.planner_violations.some((entry) => entry.includes('executor'))).toBe(true);
    });
  },
);
