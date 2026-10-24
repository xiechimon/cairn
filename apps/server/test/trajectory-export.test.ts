import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CONFIRM_ANNOUNCEMENT, MERGE_ANNOUNCEMENT, trajectoryPackSchema } from '@cairn/shared';
import { afterEach, expect, test } from 'vitest';
import { openDbWithHandle } from '../src/db/client.js';
import {
  agent,
  build,
  buildFeedback,
  gateVerdict,
  message,
  plan,
  project,
  step,
  team,
  todo,
  tokenUsage,
} from '../src/db/schema.js';

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function fixture(spec = 'Implement export') {
  const home = mkdtempSync(join(tmpdir(), 'cairn-traj-'));
  homes.push(home);
  const dbPath = join(home, 'server/server.db');
  const opened = openDbWithHandle(dbPath);
  const db = opened.db;
  db.insert(team).values({ id: 'team-1', name: 'Test', createdAt: 1 }).run();
  db.insert(project).values({ id: 'project-1', teamId: 'team-1', name: 'Test' }).run();
  db.insert(agent)
    .values({
      id: 'agent-1',
      teamId: 'team-1',
      displayName: 'Builder',
      provider: 'test',
      modelId: 'model',
    })
    .run();
  db.insert(todo)
    .values({
      id: 'todo-1',
      teamId: 'team-1',
      projectId: 'project-1',
      title: 'Export',
      spec,
      phaseAt: 1,
      seqNum: 1,
      assignment: { plan: null, build: { agentId: 'agent-1' } },
    })
    .run();
  db.insert(build)
    .values({
      id: 'build-1',
      todoId: 'todo-1',
      withPlan: false,
      triggerSource: 'user',
      createdAt: 1000,
      baseSha: 'base-sha',
      harnessHash: 'harness-hash',
    })
    .run();
  db.insert(step)
    .values({
      id: 'step-1',
      buildId: 'build-1',
      kind: 'build',
      createdAt: 1001,
      checkpointCommit: 'head-sha',
      skillInjection: { hits: [] },
    })
    .run();
  db.insert(plan)
    .values({ id: 'plan-1', buildId: 'build-1', createdAt: 1002, content: 'Run verification' })
    .run();
  db.insert(tokenUsage)
    .values({ buildId: 'build-1', model: 'test/model', input: 10, output: 20, costTotal: 0.5 })
    .run();
  opened.close();
  const sessions = join(home, 'server/attachments/step-sessions');
  mkdirSync(sessions, { recursive: true });
  writeFileSync(
    join(sessions, 'step-1.jsonl'),
    `${JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: spec }], stopReason: 'stop', rawStopReason: 'end_turn', responseModel: 'model' } })}\n`,
  );
  return { home, dbPath };
}

const CLI_TIMEOUT_MS = 30_000;

function run(home: string, args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/trajectory-export-cli.ts', ...args], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env, CAIRN_HOME: home },
    encoding: 'utf8',
  });
}

test(
  'exports a complete validated pack from a readonly sqlite snapshot',
  () => {
    const { home, dbPath } = fixture();
    const before = readFileSync(dbPath);
    const out = join(home, 'pack.jsonl');
    const result = run(home, ['--build', 'build-1', '--out', out]);
    expect(result.status, result.stderr).toBe(0);
    const lines = readFileSync(out, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const pack = trajectoryPackSchema.parse(JSON.parse(lines[0] ?? ''));
    expect(pack.input).toEqual({
      spec: 'Implement export',
      sourceRef: null,
      baseSha: 'base-sha',
      harnessHash: 'harness-hash',
      agentId: 'agent-1',
      persona: null,
      model: 'test/model',
      skillInjection: { hits: [] },
    });
    expect(pack.process.steps).toEqual([
      {
        stepId: 'step-1',
        kind: 'build',
        checkpointCommit: 'head-sha',
        transcript: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Implement export' }],
            stopReason: 'stop',
            rawStopReason: 'end_turn',
            responseModel: 'model',
          },
        ],
      },
    ]);
    expect(pack.process.plans).toEqual([
      {
        id: 'plan-1',
        buildId: 'build-1',
        version: 1,
        content: 'Run verification',
        createdAt: 1002,
      },
    ]);
    expect(pack.process.token_usage[0]).toMatchObject({ input: 10, output: 20, costTotal: 0.5 });
    expect(pack.outcome).toEqual({
      merged: null,
      revertedWithin7d: null,
      fixedByLaterPr: null,
      costTotal: 0.5,
    });
    expect(result.stdout).toContain('exported=1');
    expect(readFileSync(dbPath)).toEqual(before);
  },
  CLI_TIMEOUT_MS,
);

test('selects builds by creation time and writes defaults under the instance', () => {
  const { home } = fixture();
  const result = run(home, [
    '--since',
    '1970-01-01T00:00:01.000Z',
    '--until',
    '1970-01-01T00:00:01.000Z',
  ]);
  expect(result.status, result.stderr).toBe(0);
  const path = result.stdout.trim().split('out=')[1] ?? '';
  expect(path.startsWith(join(home, 'server/trajectory-exports/'))).toBe(true);
  expect(trajectoryPackSchema.parse(JSON.parse(readFileSync(path, 'utf8').trim())).buildId).toBe(
    'build-1',
  );
  const out = join(home, 'empty.jsonl');
  const empty = run(home, ['--since', '1970-01-01T00:00:01.001Z', '--out', out]);
  expect(empty.status, empty.stderr).toBe(0);
  expect(readFileSync(out, 'utf8')).toBe('');
  expect(empty.stdout).toContain('exported=0');
});

test.each([
  [],
  ['--build', ''],
  ['--build', 'build-1', '--since', '2026-01-01'],
  ['--since', 'invalid'],
  ['--since', '2026-01-02', '--until', '2026-01-01'],
  ['--build', 'missing'],
  ['--unknown'],
])(
  'rejects invalid selectors %j without replacing output',
  (...args) => {
    const { home } = fixture();
    const out = join(home, 'keep.jsonl');
    writeFileSync(out, 'keep');
    expect(run(home, [...args, '--out', out]).status).not.toBe(0);
    expect(readFileSync(out, 'utf8')).toBe('keep');
  },
  CLI_TIMEOUT_MS,
);

test(
  'missing database fails without creating a database',
  () => {
    const home = mkdtempSync(join(tmpdir(), 'cairn-traj-missing-'));
    homes.push(home);
    expect(run(home, ['--build', 'build-1']).status).not.toBe(0);
  },
  CLI_TIMEOUT_MS,
);

test(
  'invalid schema fails without replacing output or leaking invalid values',
  () => {
    const { home, dbPath } = fixture();
    const opened = openDbWithHandle(dbPath);
    opened.db.update(build).set({ baseSha: null }).run();
    opened.close();
    const out = join(home, 'keep.jsonl');
    writeFileSync(out, 'keep');
    const result = run(home, ['--build', 'build-1', '--out', out]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('input.baseSha');
    expect(readFileSync(out, 'utf8')).toBe('keep');
  },
  CLI_TIMEOUT_MS,
);

test(
  'refuses to overwrite the source database',
  () => {
    const { home, dbPath } = fixture();
    const before = readFileSync(dbPath);
    expect(run(home, ['--build', 'build-1', '--out', dbPath]).status).not.toBe(0);
    expect(readFileSync(dbPath)).toEqual(before);
  },
  CLI_TIMEOUT_MS,
);

test(
  'reports output errors without successful summary',
  () => {
    const { home } = fixture();
    const result = run(home, ['--build', 'build-1', '--out', home]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('exported=');
  },
  CLI_TIMEOUT_MS,
);

test(
  'redacts a token throughout nested exported values and counts replacements',
  () => {
    const token = `ghp_${'A'.repeat(36)}`;
    const { home } = fixture(`Use ${token}`);
    const out = join(home, 'redacted.jsonl');
    const result = run(home, ['--build', 'build-1', '--out', out]);
    expect(result.status, result.stderr).toBe(0);
    const text = readFileSync(out, 'utf8');
    expect(text).not.toContain(token);
    expect(text).toContain('[REDACTED]');
    expect(result.stdout).toContain('redacted=2');
    expect(trajectoryPackSchema.safeParse(JSON.parse(text.trim())).success).toBe(true);
  },
  CLI_TIMEOUT_MS,
);

test(
  'refuses database output through a symlinked parent',
  () => {
    const { home, dbPath } = fixture();
    const before = readFileSync(dbPath);
    symlinkSync(join(home, 'server'), join(home, 'alias'));
    expect(
      run(home, ['--build', 'build-1', '--out', join(home, 'alias/server.db')]).status,
    ).not.toBe(0);
    expect(readFileSync(dbPath)).toEqual(before);
  },
  CLI_TIMEOUT_MS,
);

test(
  'exports structured rejections, recorded approvals and gate verdicts',
  () => {
    const { home, dbPath } = fixture();
    const opened = openDbWithHandle(dbPath);
    opened.db
      .insert(buildFeedback)
      .values([
        {
          id: 'feedback-1',
          buildId: 'build-1',
          kind: 'revision',
          side: 'plan',
          feedback: 'Explain verification',
          actor: 'Reviewer',
          createdAt: 1003,
        },
        {
          id: 'feedback-2',
          buildId: 'build-1',
          kind: 'restart',
          side: 'build',
          feedback: 'Fix failure',
          actor: 'Reviewer',
          createdAt: 1004,
        },
      ])
      .run();
    opened.db
      .insert(message)
      .values([
        {
          id: 'message-1',
          conversationId: 'build-1',
          role: 'user',
          content: CONFIRM_ANNOUNCEMENT,
          actor: 'Reviewer',
          createdAt: 1005,
        },
        {
          id: 'message-2',
          conversationId: 'build-1',
          role: 'user',
          content: MERGE_ANNOUNCEMENT,
          actor: 'Reviewer',
          createdAt: 1006,
        },
      ])
      .run();
    opened.db
      .insert(gateVerdict)
      .values({
        stepId: 'review-1',
        buildId: 'build-1',
        kind: 'review',
        outcome: 'pass',
        expectedHeadSha: 'head-sha',
        createdAt: 1007,
      })
      .run();
    opened.close();
    const out = join(home, 'judgments.jsonl');
    const result = run(home, ['--build', 'build-1', '--out', out]);
    expect(result.status, result.stderr).toBe(0);
    const pack = trajectoryPackSchema.parse(JSON.parse(readFileSync(out, 'utf8').trim()));
    expect(pack.judgments.plan).toEqual([
      { action: 'revision', reason: 'Explain verification' },
      { action: 'confirm', reason: null },
    ]);
    expect(pack.judgments.diff).toEqual([
      { action: 'restart', reason: 'Fix failure' },
      { action: 'approve', reason: null },
    ]);
    expect(pack.judgments.gate_verdict).toEqual([
      {
        stepId: 'review-1',
        buildId: 'build-1',
        kind: 'review',
        perspective: null,
        outcome: 'pass',
        patchDigest: null,
        headSha: null,
        expectedHeadSha: 'head-sha',
        createdAt: 1007,
      },
    ]);
  },
  CLI_TIMEOUT_MS,
);

test(
  'exports pi tool results and Claude session envelopes without dropping messages',
  () => {
    const { home } = fixture();
    writeFileSync(
      join(home, 'server/attachments/step-sessions/step-1.jsonl'),
      [
        {
          type: 'message',
          message: {
            role: 'toolResult',
            toolCallId: 'call-1',
            toolName: 'bash',
            content: [{ type: 'text', text: 'done' }],
          },
        },
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Claude reply' }],
            stop_reason: 'end_turn',
            model: 'claude-model',
          },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n'),
    );
    const out = join(home, 'sessions.jsonl');
    const result = run(home, ['--build', 'build-1', '--out', out]);
    expect(result.status, result.stderr).toBe(0);
    const pack = trajectoryPackSchema.parse(JSON.parse(readFileSync(out, 'utf8').trim()));
    expect(pack.process.steps[0]?.transcript).toEqual([
      {
        role: 'system',
        toolCallId: 'call-1',
        toolName: 'bash',
        content: [{ type: 'text', text: 'done' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Claude reply' }],
        stop_reason: 'end_turn',
        model: 'claude-model',
      },
    ]);
  },
  CLI_TIMEOUT_MS,
);

test(
  'uses the first step runtime model when a build has multiple billed models',
  () => {
    const { home, dbPath } = fixture();
    const opened = openDbWithHandle(dbPath);
    opened.db
      .insert(tokenUsage)
      .values({ buildId: 'build-1', model: 'review/other', input: 1 })
      .run();
    opened.close();
    writeFileSync(
      join(home, 'server/attachments/step-sessions/step-1.jsonl'),
      `${JSON.stringify({ type: 'message', message: { role: 'assistant', provider: 'runtime', model: 'actual-model', content: 'done' } })}\n`,
    );
    const out = join(home, 'models.jsonl');
    const result = run(home, ['--build', 'build-1', '--out', out]);
    expect(result.status, result.stderr).toBe(0);
    expect(
      trajectoryPackSchema.parse(JSON.parse(readFileSync(out, 'utf8').trim())).input.model,
    ).toBe('runtime/actual-model');
  },
  CLI_TIMEOUT_MS,
);
