import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { redactSecrets, STOP_MESSAGE } from '@cairn/shared';
import { afterEach, expect, test } from 'vitest';
import { type Db, openDbWithHandle, openMemoryDb } from '../src/db/client.js';
import { build, message, project, step, team, todo } from '../src/db/schema.js';
import {
  type BUILD_CAUSES,
  buildReliabilityReport,
  classifyBuildCause,
  openReliabilityReportDb,
  renderReliabilityMarkdown,
  STUCK_THRESHOLD_MS,
  wilsonInterval,
} from '../src/reliability-report.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WINDOW_SINCE = Date.UTC(2026, 10, 2);
const WINDOW_UNTIL = WINDOW_SINCE + 7 * DAY;

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function seedWorld(db: Db): void {
  db.insert(team).values({ id: 'team-1', name: 'Test', createdAt: 1 }).run();
  db.insert(project).values({ id: 'project-1', teamId: 'team-1', name: 'Sample ufo' }).run();
  db.insert(project).values({ id: 'project-2', teamId: 'team-1', name: 'Other project' }).run();
}

interface SeedBuildInput {
  id: string;
  projectId?: string;
  todoId?: string;
  title?: string;
  createdAt: number;
  prNumber?: number | null;
  errorMessage?: string | null;
  stepStatuses?: Array<'pending' | 'claimed' | 'done' | 'failed' | 'stopped' | 'waiting_quota'>;
}

function seedBuild(db: Db, input: SeedBuildInput): void {
  const todoId = input.todoId ?? `todo-${input.id}`;
  if (input.todoId === undefined) {
    db.insert(todo)
      .values({
        id: todoId,
        teamId: 'team-1',
        projectId: input.projectId ?? 'project-1',
        title: input.title ?? `Task ${input.id}`,
        phaseAt: input.createdAt,
        seqNum: 1,
      })
      .run();
  }
  db.insert(build)
    .values({
      id: input.id,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: input.createdAt,
      ...(input.prNumber !== undefined ? { prNumber: input.prNumber } : {}),
      ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
    })
    .run();
  for (const [index, status] of (input.stepStatuses ?? ['done']).entries()) {
    db.insert(step)
      .values({
        id: `step-${input.id}-${index}`,
        buildId: input.id,
        kind: 'build',
        status,
        createdAt: input.createdAt + index,
      })
      .run();
  }
}

function report(db: Db) {
  return buildReliabilityReport(db, {
    projectId: 'project-1',
    since: WINDOW_SINCE,
    until: WINDOW_UNTIL,
  });
}

test('counts only builds of the given project inside the window', () => {
  const db = openMemoryDb();
  seedWorld(db);
  seedBuild(db, { id: 'in-window', createdAt: WINDOW_SINCE + DAY, prNumber: 4 });
  seedBuild(db, { id: 'before-window', createdAt: WINDOW_SINCE - 1, prNumber: 5 });
  seedBuild(db, { id: 'after-window', createdAt: WINDOW_UNTIL + 1, prNumber: 6 });
  seedBuild(db, {
    id: 'other-project',
    projectId: 'project-2',
    createdAt: WINDOW_SINCE + DAY,
    prNumber: 7,
  });
  const result = report(db);
  expect(result.buildsStarted).toBe(1);
  expect(result.builds.map((b) => b.id)).toEqual(['in-window']);
});

test('a build with prNumber counts as reached-PR even if its todo later failed', () => {
  const db = openMemoryDb();
  seedWorld(db);
  seedBuild(db, {
    id: 'pr-then-failure',
    createdAt: WINDOW_SINCE + HOUR,
    prNumber: 12,
    errorMessage: 'merge conflict against refs/heads/main (aborted; manual rerun required)',
    stepStatuses: ['done', 'failed'],
  });
  const result = report(db);
  expect(result.reachedPr).toBe(1);
  expect(result.builds[0]?.outcome).toBe('reached-pr');
  expect(result.causes).toEqual({
    'provider-network': 0,
    quota: 0,
    timeout: 0,
    git: 0,
    unstaffed: 0,
    unclaimed: 0,
    'session-lost': 0,
    'agent-gave-up': 0,
    'gate-or-phase-bug': 0,
    'stuck-waiting': 0,
    other: 0,
  });
});

test('rate and Wilson interval for 8 of 15 are 0.533 and the expected bounds', () => {
  const db = openMemoryDb();
  seedWorld(db);
  const failures = [
    'git push failed (1): error: failed to push some refs',
    'Your credit balance is too low to access the API. Please add funds.',
    'stream timeout (arm=idle, 300000ms)',
    'connection reset by peer',
    'agent session ended with zero progress and no terminal outcome (silent no-op round)',
    'OOMKilled (exit code 137)',
    '方案结构不合格：plan must cite at least one prior art',
  ];
  for (let index = 0; index < 8; index += 1) {
    seedBuild(db, {
      id: `reached-${index}`,
      createdAt: WINDOW_SINCE + index * HOUR,
      prNumber: index + 1,
    });
  }
  for (const [index, message] of failures.entries()) {
    seedBuild(db, {
      id: `failed-${index}`,
      createdAt: WINDOW_SINCE + (index + 8) * HOUR,
      errorMessage: message,
      stepStatuses: ['failed'],
    });
  }
  const result = report(db);
  expect(result.buildsStarted).toBe(15);
  expect(result.reachedPr).toBe(8);
  expect(result.rate).toBeCloseTo(8 / 15, 10);
  expect(result.wilson95?.[0]).toBeCloseTo(0.3011663015105079, 10);
  expect(result.wilson95?.[1]).toBeCloseTo(0.7519077474025356, 10);
  expect(wilsonInterval(8, 15)).toEqual(result.wilson95);
});

test('each fixture errorMessage maps to its cause', () => {
  const fixtures: Array<{ message: string; cause: (typeof BUILD_CAUSES)[number] }> = [
    {
      message:
        'Error sending request: error sending request for url (https://api.example.com/v1/messages): connection closed',
      cause: 'provider-network',
    },
    {
      message: "402 - You've hit your usage limit. Visit https://console.example.com/billing",
      cause: 'quota',
    },
    { message: 'stream timeout (arm=idle, 900000ms)；根因: connection closed', cause: 'timeout' },
    {
      message: "git push failed (128): fatal: Authentication failed for 'https://example.com/repo'",
      cause: 'git',
    },
    {
      message:
        'agent session ended with zero progress and no terminal outcome (silent no-op round)',
      cause: 'agent-gave-up',
    },
    {
      message: '方案结构不合格：cited prior art is missing from the plan',
      cause: 'gate-or-phase-bug',
    },
    { message: 'container exited before reporting (OOMKilled)', cause: 'other' },
  ];
  for (const { message, cause } of fixtures) {
    expect(classifyBuildCause({ errorMessage: message, prNumber: null, ageMs: 0 }), message).toBe(
      cause,
    );
  }
});

test('a build with no terminal state after 6h is stuck-waiting, not other', () => {
  const db = openMemoryDb();
  seedWorld(db);
  seedBuild(db, {
    id: 'stuck',
    createdAt: WINDOW_UNTIL - STUCK_THRESHOLD_MS - HOUR,
    stepStatuses: ['pending'],
  });
  seedBuild(db, {
    id: 'fresh',
    createdAt: WINDOW_UNTIL - HOUR,
    stepStatuses: ['claimed'],
  });
  const result = report(db);
  const outcomes = Object.fromEntries(result.builds.map((b) => [b.id, b.outcome]));
  expect(outcomes.stuck).toBe('stuck-waiting');
  expect(outcomes.fresh).toBe('active');
  expect(result.causes['stuck-waiting']).toBe(1);
  expect(result.active).toBe(1);
});

test('operator-cancelled builds are counted separately, not as causes', () => {
  const db = openMemoryDb();
  seedWorld(db);
  seedBuild(db, {
    id: 'cancelled',
    createdAt: WINDOW_SINCE + HOUR,
    errorMessage: STOP_MESSAGE,
    stepStatuses: ['stopped'],
  });
  seedBuild(db, { id: 'reached', createdAt: WINDOW_SINCE + 2 * HOUR, prNumber: 3 });
  const result = report(db);
  expect(result.cancelled).toBe(1);
  expect(result.buildsStarted).toBe(2);
  expect(result.reachedPr).toBe(1);
  expect(result.rate).toBeCloseTo(0.5, 10);
  expect(result.builds.find((b) => b.id === 'cancelled')?.outcome).toBe('cancelled');
});

test('per-day rates list every day with builds and its rate', () => {
  const db = openMemoryDb();
  seedWorld(db);
  seedBuild(db, { id: 'd1a', createdAt: WINDOW_SINCE + HOUR, prNumber: 1 });
  seedBuild(db, { id: 'd1b', createdAt: WINDOW_SINCE + 2 * HOUR, errorMessage: 'boom' });
  seedBuild(db, { id: 'd3', createdAt: WINDOW_SINCE + 2 * DAY + HOUR, prNumber: 2 });
  const result = report(db);
  expect(result.perDay).toEqual([
    { day: '2026-11-02', started: 2, reachedPr: 1, rate: 0.5 },
    { day: '2026-11-04', started: 1, reachedPr: 1, rate: 1 },
  ]);
});

test('the report never contains a token-shaped string', () => {
  const db = openMemoryDb();
  seedWorld(db);
  seedBuild(db, {
    id: 'leaky',
    createdAt: WINDOW_SINCE + HOUR,
    errorMessage: 'push failed, credential was ghp_0123456789abcdefghijklmnopqrstuv',
    stepStatuses: ['failed'],
  });
  const result = report(db);
  const row = result.builds.find((b) => b.id === 'leaky');
  expect(row?.outcome).toBe('other');
  expect(row?.message).toBe(
    `push failed, credential was ${redactSecrets('ghp_0123456789abcdefghijklmnopqrstuv').value}`,
  );
  const json = JSON.stringify(result);
  expect(json).not.toContain('ghp_0123456789');
  expect(json).toContain('[REDACTED]');
  expect(renderReliabilityMarkdown(result)).not.toContain('ghp_0123456789');
});

test('a failure recorded only on a failed step gets its cause, not active or stuck', () => {
  const db = openMemoryDb();
  seedWorld(db);
  db.insert(todo)
    .values({
      id: 'todo-step-only',
      teamId: 'team-1',
      projectId: 'project-1',
      title: 'Step-only failure',
      phaseAt: WINDOW_SINCE + HOUR,
      seqNum: 1,
    })
    .run();
  db.insert(build)
    .values({
      id: 'step-only',
      todoId: 'todo-step-only',
      withPlan: false,
      triggerSource: 'user',
      createdAt: WINDOW_SINCE + HOUR,
    })
    .run();
  db.insert(step)
    .values({
      id: 'step-1',
      buildId: 'step-only',
      kind: 'build',
      status: 'failed',
      createdAt: WINDOW_SINCE + HOUR,
    })
    .run();
  db.insert(message)
    .values({
      id: 'plan-residual-step-1',
      conversationId: 'step-only',
      role: 'system',
      content:
        "Plan step step-1 reported a failure after the plan was delivered and the confirm gate was parked: git push failed (128): fatal: Authentication failed for 'https://example.com/repo'. The delivered plan and the confirm gate are unchanged.",
      createdAt: WINDOW_SINCE + HOUR,
    })
    .run();
  const result = report(db);
  const row = result.builds.find((b) => b.id === 'step-only');
  expect(row?.outcome).toBe('git');
  expect(row?.steps.failed).toBe(1);
  expect(result.causes.git).toBe(1);
  expect(result.active).toBe(0);
});

test('opening the db is read-only: a write through the same handle throws', () => {
  const home = mkdtempSync(join(tmpdir(), 'cairn-rel-report-'));
  homes.push(home);
  const dbPath = join(home, 'server.db');
  const opened = openDbWithHandle(dbPath);
  opened.close();
  const handle = openReliabilityReportDb(dbPath);
  try {
    expect(() =>
      handle.db.insert(team).values({ id: 'team-x', name: 'Nope', createdAt: 1 }).run(),
    ).toThrow();
  } finally {
    handle.close();
  }
});

function runCli(home: string, args: string[]) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/reliability-report-cli.ts', ...args],
    {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, CAIRN_HOME: home },
      encoding: 'utf8',
    },
  );
}

function cliFixtureDb(): string {
  const home = mkdtempSync(join(tmpdir(), 'cairn-rel-cli-'));
  homes.push(home);
  const dbPath = join(home, 'server', 'server.db');
  const opened = openDbWithHandle(dbPath);
  const db = opened.db;
  seedWorld(db);
  seedBuild(db, { id: 'reached', createdAt: WINDOW_SINCE + HOUR, prNumber: 1 });
  seedBuild(db, {
    id: 'failed',
    createdAt: WINDOW_SINCE + 2 * HOUR,
    errorMessage: 'quota exhausted',
  });
  opened.close();
  return home;
}

test('the CLI refuses a missing --project or an inverted window with exit code 2', {
  timeout: 60_000,
}, () => {
  const home = cliFixtureDb();
  const missingProject = runCli(home, [
    '--since',
    new Date(WINDOW_SINCE).toISOString(),
    '--until',
    new Date(WINDOW_UNTIL).toISOString(),
  ]);
  expect(missingProject.status).toBe(2);
  const inverted = runCli(home, [
    '--project',
    'project-1',
    '--since',
    new Date(WINDOW_UNTIL).toISOString(),
    '--until',
    new Date(WINDOW_SINCE).toISOString(),
  ]);
  expect(inverted.status).toBe(2);
});

test('the CLI reports the checked-in sample when --replay is given, ignoring project builds', {
  timeout: 60_000,
}, () => {
  const home = cliFixtureDb();
  const dir = mkdtempSync(join(tmpdir(), 'cairn-rel-cli-replay-'));
  homes.push(dir);
  const replayPath = join(dir, 'replay.json');
  writeFileSync(
    replayPath,
    JSON.stringify([
      {
        task: 'ufo-08',
        buildId: 'sample-build-1',
        todoId: 'sample-todo-1',
        createdAt: new Date(WINDOW_SINCE + HOUR).toISOString(),
        prNumber: 7,
        errorMessage: null,
      },
      {
        task: 'ufo-09',
        buildId: 'sample-build-2',
        todoId: 'sample-todo-2',
        createdAt: new Date(WINDOW_SINCE + 2 * HOUR).toISOString(),
        prNumber: null,
        errorMessage: 'stream timeout (arm=idle, 300000ms)',
      },
    ]),
  );
  const result = runCli(home, [
    '--replay',
    replayPath,
    '--repo',
    'xiechimon/cairn-sample-ufo',
    '--base',
    'f06c800d0c59f2a4a1b9ba65eb6cb61a84419be6',
    '--since',
    new Date(WINDOW_SINCE).toISOString(),
    '--until',
    new Date(WINDOW_UNTIL).toISOString(),
  ]);
  expect(result.status, result.stderr).toBe(0);
  const parsed = JSON.parse(result.stdout.split('\n---\n')[0] ?? '') as {
    buildsStarted: number;
    reachedPr: number;
    rate: number;
    project: string;
  };
  expect(parsed.project).toBe('xiechimon/cairn-sample-ufo');
  expect(parsed.buildsStarted).toBe(2);
  expect(parsed.reachedPr).toBe(1);
  expect(parsed.rate).toBeCloseTo(0.5, 10);
  expect(result.stdout).toContain('ufo-08');
  expect(result.stdout).toContain('ufo-09');
});

test('the CLI prints a JSON report and a markdown table from the real db path', {
  timeout: 60_000,
}, () => {
  const home = cliFixtureDb();
  const result = runCli(home, [
    '--project',
    'project-1',
    '--since',
    new Date(WINDOW_SINCE).toISOString(),
    '--until',
    new Date(WINDOW_UNTIL).toISOString(),
  ]);
  expect(result.status, result.stderr).toBe(0);
  const parsed = JSON.parse(result.stdout.split('\n---\n')[0] ?? '') as {
    buildsStarted: number;
    reachedPr: number;
    rate: number;
  };
  expect(parsed.buildsStarted).toBe(2);
  expect(parsed.reachedPr).toBe(1);
  expect(parsed.rate).toBeCloseTo(0.5, 10);
  expect(result.stdout).toContain('| cause | builds |');
  expect(readFileSync(join(home, 'server', 'server.db'), 'utf8')).toBeTruthy();
});
