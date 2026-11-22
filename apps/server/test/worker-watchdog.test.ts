import type { Phase } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import {
  build as buildTable,
  gateVerdict,
  notification as notificationTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { sweepWorkerWatchdog, WATCHDOG_STUCK_MS } from '../src/services/worker-watchdog.js';
import { bootServer, type TestServer } from './helpers.js';

let s: TestServer;
afterEach(() => s.dispose());

const MINUTE = 60_000;
const SHA = (n: number) => `${n}`.padStart(40, 'a');

function seed(
  suffix: string,
  opts: {
    phase: Phase;
    steps?: {
      kind: 'session' | 'merge' | 'review';
      status: 'pending' | 'claimed' | 'done' | 'failed';
      claimedAt?: number | null;
      lastProgressAt?: number | null;
      finishedAt?: number | null;
    }[];
    blockHeads?: string[];
    errors?: string[];
    archived?: boolean;
  },
) {
  const todoId = `todo-${suffix}`;
  const buildId = `build-${suffix}`;
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId: 'proj',
      title: suffix,
      phase: opts.phase,
      phaseAt: Date.now(),
      seqNum: 1,
      latestBuildId: buildId,
      ...(opts.archived === true ? { archivedAt: Date.now() } : {}),
    })
    .run();
  s.db
    .insert(buildTable)
    .values({ id: buildId, todoId, withPlan: false, triggerSource: 'user', createdAt: Date.now() })
    .run();
  for (const [index, row] of (opts.steps ?? []).entries()) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-${suffix}-${index}`,
        buildId,
        kind: row.kind,
        status: row.status,
        createdAt: Date.now() - 2 * WATCHDOG_STUCK_MS,
        ...(row.claimedAt !== undefined ? { claimedAt: row.claimedAt } : {}),
        ...(row.lastProgressAt !== undefined ? { lastProgressAt: row.lastProgressAt } : {}),
        ...(row.finishedAt !== undefined ? { finishedAt: row.finishedAt } : {}),
      })
      .run();
  }
  for (const [index, head] of (opts.blockHeads ?? []).entries()) {
    s.db
      .insert(gateVerdict)
      .values({
        stepId: `verdict-step-${suffix}-${index}`,
        buildId,
        kind: 'review',
        outcome: 'block',
        expectedHeadSha: head,
        createdAt: Date.now() - index * MINUTE,
      })
      .run();
  }
  for (const [index, error] of (opts.errors ?? []).entries()) {
    s.db
      .insert(buildTable)
      .values({
        id: `build-${suffix}-old-${index}`,
        todoId,
        withPlan: false,
        triggerSource: 'user',
        errorMessage: error,
        createdAt: Date.now() - (index + 1) * 10 * MINUTE,
      })
      .run();
  }
  return { todoId, buildId };
}

function flags() {
  return s.db
    .select()
    .from(notificationTable)
    .where(eq(notificationTable.type, 'watchdog_flag'))
    .all();
}

test('stuck and looping threads each produce one flag with evidence, healthy stays silent', () => {
  s = bootServer();
  s.db.insert(projectTable).values({ id: 'proj', name: 'demo', teamId: s.team.id }).run();
  const now = Date.now();
  const stuck = seed('stuck', {
    phase: 'building',
    steps: [{ kind: 'session', status: 'claimed', claimedAt: now - WATCHDOG_STUCK_MS - MINUTE }],
  });
  const looping = seed('looping', {
    phase: 'building',
    steps: [{ kind: 'session', status: 'claimed', lastProgressAt: now }],
    blockHeads: [SHA(1), SHA(2), SHA(3)],
  });
  seed('healthy', {
    phase: 'building',
    steps: [{ kind: 'session', status: 'claimed', lastProgressAt: now }],
  });

  expect(sweepWorkerWatchdog(s.svc, now)).toBe(2);

  const rows = flags();
  expect(rows.map((row) => row.entityId).sort()).toEqual([stuck.todoId, looping.todoId].sort());
  const stuckRow = rows.find((row) => row.entityId === stuck.todoId)!;
  const loopRow = rows.find((row) => row.entityId === looping.todoId)!;
  expect(stuckRow.entityRef).toMatchObject({ title: 'stuck' });
  expect(stuckRow.snippet).toMatch(/进展|卡住/);
  expect(loopRow.snippet).toMatch(/3|BLOCK|打转|循环/);
  expect(rows.every((row) => row.readAt === null)).toBe(true);

  expect(sweepWorkerWatchdog(s.svc, now)).toBe(0);
  expect(flags()).toHaveLength(2);
});

test('a flag fires once per distinct evidence and re-pings when the evidence moves', () => {
  s = bootServer();
  s.db.insert(projectTable).values({ id: 'proj', name: 'demo', teamId: s.team.id }).run();
  const now = Date.now();
  const looping = seed('looping', {
    phase: 'building',
    blockHeads: [SHA(1), SHA(2), SHA(3)],
  });
  expect(sweepWorkerWatchdog(s.svc, now)).toBe(1);
  const first = flags()[0]!;
  const firstSnippet = first.snippet;

  s.db
    .update(notificationTable)
    .set({ readAt: now + 1 })
    .where(eq(notificationTable.id, first.id))
    .run();
  expect(sweepWorkerWatchdog(s.svc, now + MINUTE)).toBe(0);

  s.db
    .insert(gateVerdict)
    .values({
      stepId: 'verdict-step-looping-3',
      buildId: looping.buildId,
      kind: 'review',
      outcome: 'block',
      expectedHeadSha: SHA(4),
      createdAt: now + MINUTE,
    })
    .run();
  expect(sweepWorkerWatchdog(s.svc, now + 2 * MINUTE)).toBe(1);
  const moved = flags()[0]!;
  expect(moved.snippet).not.toBe(firstSnippet);
  expect(moved.snippet).toMatch(/4/);
  expect(moved.readAt).toBeNull();
});

test('a claimed step silent exactly at the threshold is already stuck; just below is not', () => {
  s = bootServer();
  s.db.insert(projectTable).values({ id: 'proj', name: 'demo', teamId: s.team.id }).run();
  const now = Date.now();
  seed('boundary', {
    phase: 'building',
    steps: [
      {
        kind: 'merge',
        status: 'claimed',
        claimedAt: now - WATCHDOG_STUCK_MS,
        lastProgressAt: null,
      },
      {
        kind: 'session',
        status: 'claimed',
        claimedAt: now - WATCHDOG_STUCK_MS - 10 * MINUTE,
        lastProgressAt: now - WATCHDOG_STUCK_MS + MINUTE,
      },
    ],
  });
  seed('fresh', {
    phase: 'building',
    steps: [
      {
        kind: 'session',
        status: 'claimed',
        claimedAt: now - WATCHDOG_STUCK_MS - 10 * MINUTE,
        lastProgressAt: now - WATCHDOG_STUCK_MS + 60_000,
      },
    ],
  });
  expect(sweepWorkerWatchdog(s.svc, now)).toBe(1);
  const row = flags()[0]!;
  expect(row.entityId).toBe('todo-boundary');
});

test('waiting phases, ended phases, archived threads and pending steps stay silent', () => {
  s = bootServer();
  s.db.insert(projectTable).values({ id: 'proj', name: 'demo', teamId: s.team.id }).run();
  const now = Date.now();
  const stale = now - WATCHDOG_STUCK_MS - MINUTE;
  seed('needs-input', {
    phase: 'needs_input',
    steps: [{ kind: 'session', status: 'claimed', claimedAt: stale }],
  });
  seed('confirm', {
    phase: 'confirm',
    steps: [{ kind: 'session', status: 'claimed', claimedAt: stale }],
  });
  seed('failed', { phase: 'failed', blockHeads: [SHA(1), SHA(2), SHA(3)] });
  seed('closed', { phase: 'closed', blockHeads: [SHA(1), SHA(2), SHA(3)] });
  seed('archived', { phase: 'building', blockHeads: [SHA(1), SHA(2), SHA(3)], archived: true });
  seed('pending', {
    phase: 'queued',
    steps: [{ kind: 'session', status: 'pending' }],
  });
  expect(sweepWorkerWatchdog(s.svc, now)).toBe(0);
  expect(flags()).toHaveLength(0);
});

test('a recovered loop stays silent once the newest verdict is a pass', () => {
  s = bootServer();
  s.db.insert(projectTable).values({ id: 'proj', name: 'demo', teamId: s.team.id }).run();
  const now = Date.now();
  const recovered = seed('recovered', {
    phase: 'building',
    steps: [{ kind: 'session', status: 'claimed', lastProgressAt: now }],
    blockHeads: [SHA(1), SHA(2), SHA(3)],
  });
  s.db
    .insert(gateVerdict)
    .values({
      stepId: 'verdict-recovered-pass',
      buildId: recovered.buildId,
      kind: 'review',
      outcome: 'pass',
      expectedHeadSha: SHA(4),
      createdAt: now + MINUTE,
    })
    .run();
  expect(sweepWorkerWatchdog(s.svc, now + MINUTE)).toBe(0);
  expect(flags()).toHaveLength(0);
});

test('a tampered or unbound verdict flags drift; ordinary outcomes stay silent', () => {
  s = bootServer();
  s.db.insert(projectTable).values({ id: 'proj', name: 'demo', teamId: s.team.id }).run();
  const now = Date.now();
  const clean = seed('clean-verdicts', {
    phase: 'building',
    steps: [{ kind: 'session', status: 'claimed', lastProgressAt: now }],
  });
  const quietOutcomes = ['pass', 'step_failed', 'extraction_failed'] as const;
  for (const [index, outcome] of quietOutcomes.entries()) {
    s.db
      .insert(gateVerdict)
      .values({
        stepId: `verdict-clean-${index}`,
        buildId: clean.buildId,
        kind: 'review',
        outcome,
        expectedHeadSha: SHA(10 + index),
        createdAt: now - index * MINUTE,
      })
      .run();
  }
  const drifting = seed('drifting', {
    phase: 'building',
    steps: [{ kind: 'session', status: 'claimed', lastProgressAt: now }],
  });
  s.db
    .insert(gateVerdict)
    .values({
      stepId: 'verdict-drift-0',
      buildId: drifting.buildId,
      kind: 'verify',
      outcome: 'unbound',
      expectedHeadSha: SHA(20),
      createdAt: now,
    })
    .run();
  expect(sweepWorkerWatchdog(s.svc, now)).toBe(1);
  const row = flags()[0]!;
  expect(row.entityId).toBe(drifting.todoId);
  expect(row.snippet).toMatch(/不一致|偏离/);
});

test('the same error repeated across builds flags as looping', () => {
  s = bootServer();
  s.db.insert(projectTable).values({ id: 'proj', name: 'demo', teamId: s.team.id }).run();
  const now = Date.now();
  seed('flaky', {
    phase: 'building',
    steps: [{ kind: 'session', status: 'claimed', lastProgressAt: now }],
    errors: ['pnpm build failed: OOM', 'pnpm build failed: OOM'],
  });
  expect(sweepWorkerWatchdog(s.svc, now)).toBe(0);
  seed('repeated', {
    phase: 'building',
    steps: [{ kind: 'session', status: 'claimed', lastProgressAt: now }],
    errors: ['pnpm build failed: OOM', 'pnpm build failed: OOM', 'pnpm build failed: OOM'],
  });
  expect(sweepWorkerWatchdog(s.svc, now)).toBe(1);
  const row = flags().find((r) => r.entityId === 'todo-repeated')!;
  expect(row.snippet).toMatch(/OOM/);
});
