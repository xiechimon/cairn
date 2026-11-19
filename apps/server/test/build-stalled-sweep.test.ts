import type { Phase } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vitest';
import {
  build as buildTable,
  project as projectTable,
  queuedMessage as queuedMessageTable,
  step as stepTable,
  todo as todoTable,
  todoTransition as todoTransitionTable,
} from '../src/db/schema.js';
import {
  STALLED_RUN_MESSAGE,
  sweepStalledRunningTodos,
} from '../src/services/build-stalled-sweep.js';
import { bootServer, type TestServer } from './helpers.js';

let s: TestServer;
afterEach(() => s.dispose());

const MINUTE = 60_000;

function seed(
  suffix: string,
  phase: Phase,
  steps: {
    kind: 'session' | 'review';
    status: 'done' | 'failed' | 'pending';
    finishedAt: number | null;
  }[],
  at: number,
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
      phase,
      phaseAt: at,
      seqNum: 1,
      latestBuildId: buildId,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({ id: buildId, todoId, withPlan: false, triggerSource: 'user', createdAt: at })
    .run();
  steps.forEach((row, index) => {
    s.db
      .insert(stepTable)
      .values({
        id: `step-${suffix}-${index}`,
        buildId,
        kind: row.kind,
        status: row.status,
        createdAt: at + index,
        finishedAt: row.finishedAt,
      })
      .run();
  });
  return { todoId, buildId };
}

function phaseOf(todoId: string): Phase {
  return s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!.phase;
}

test('a running task whose run ended without a result is settled as failed with its reason, and live or recent work is left alone', () => {
  s = bootServer();
  s.db.insert(projectTable).values({ id: 'proj', name: 'stalled', teamId: s.team.id }).run();
  const now = Date.now();
  const old = now - 30 * MINUTE;
  const reviewedBuild = seed(
    'reviewed',
    'building',
    [
      { kind: 'session', status: 'done', finishedAt: old },
      { kind: 'review', status: 'done', finishedAt: old + 1 },
    ],
    old,
  );
  const failedPlan = seed(
    'planning',
    'planning',
    [{ kind: 'session', status: 'failed', finishedAt: old }],
    old,
  );
  const answered = seed(
    'answered',
    'needs_input',
    [{ kind: 'session', status: 'done', finishedAt: old }],
    old,
  );
  const running = seed(
    'running',
    'building',
    [{ kind: 'session', status: 'pending', finishedAt: null }],
    old,
  );
  const recent = seed(
    'recent',
    'building',
    [{ kind: 'session', status: 'done', finishedAt: now - 10_000 }],
    old,
  );
  const queued = seed(
    'queued',
    'building',
    [{ kind: 'session', status: 'done', finishedAt: old }],
    old,
  );
  s.db
    .insert(queuedMessageTable)
    .values({ id: 'queued-1', conversationId: queued.buildId, content: 'next', createdAt: old })
    .run();

  expect(sweepStalledRunningTodos(s.svc, now)).toBe(3);

  for (const settled of [reviewedBuild, failedPlan, answered]) {
    expect(phaseOf(settled.todoId)).toBe('failed');
    expect(
      s.db.select().from(buildTable).where(eq(buildTable.id, settled.buildId)).get()?.errorMessage,
    ).toBe(STALLED_RUN_MESSAGE);
  }
  expect(
    s.db
      .select()
      .from(todoTransitionTable)
      .where(eq(todoTransitionTable.todoId, reviewedBuild.todoId))
      .all()
      .map((t) => [t.fromPhase, t.toPhase]),
  ).toEqual([['building', 'failed']]);
  expect(phaseOf(running.todoId)).toBe('building');
  expect(phaseOf(recent.todoId)).toBe('building');
  expect(phaseOf(queued.todoId)).toBe('building');
  expect(sweepStalledRunningTodos(s.svc, now)).toBe(0);
});
