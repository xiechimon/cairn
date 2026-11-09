import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_AUTONOMY_SETTINGS, type Phase, type TodoOwner } from '@cairn/shared';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  build as buildTable,
  gateState,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import type { BuildDeps } from '../src/services/builds.js';
import { transitionTodos } from '../src/services/chief-tools.js';
import { reconcileOwners } from '../src/services/owner.js';
import { parkFailedBuild } from '../src/services/retry-parking.js';
import { getTodo, setTodoArchived, setTodoPhase } from '../src/services/todos.js';
import { askWorkerQuestion } from '../src/services/worker-questions.js';
import { bootServer, seedSessionRoute, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const dispose of disposables) dispose();
});

type Policy = 'human' | 'autonomous';
type Failure = 'owed-retry' | 'repeated' | 'parked';

interface World {
  s: TestServer;
  deps: BuildDeps;
  projectId: string;
  todoId: string;
  buildId: string;
  stepId: string;
  notified: () => number;
}

function openWorld(
  opts: {
    phase?: Phase;
    policy?: Policy;
    output?: 'code' | 'info';
    failure?: Failure;
    prNumber?: number;
  } = {},
): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  seedSessionRoute(s);
  const suffix = newRecordId(8);
  const projectId = `proj-${suffix}`;
  const todoId = `todo-${suffix}`;
  const buildId = newUuidv7();
  const stepId = newRecordId();
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `owner-${suffix}`,
      teamId: s.team.id,
      autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy: opts.policy ?? 'autonomous' },
      ...(opts.prNumber !== undefined ? { repoKind: 'github', githubRepo: 'acme/app' } : {}),
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: `Task ${suffix}`,
      spec: 'Do the work.',
      phase: opts.phase ?? 'building',
      phaseAt: nowMs(),
      seqNum: 1,
      latestBuildId: buildId,
      output: opts.output ?? 'code',
    })
    .run();
  const failure = opts.failure ?? 'owed-retry';
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      prevPhase: failure === 'repeated' ? 'failed' : 'todo',
      triggerSource: 'user',
      createdAt: nowMs() - 60_000,
      errorMessage:
        opts.phase === 'failed'
          ? failure === 'parked'
            ? 'Task parked: 4 failed builds in one hour (limit 3). Last error: boom'
            : 'boom'
          : null,
      prNumber: opts.prNumber ?? null,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({ id: stepId, buildId, kind: 'session', status: 'claimed', createdAt: nowMs() - 1 })
    .run();
  const deps: BuildDeps = { ...s.svc, reposDir: s.reposDir, box: s.secretBox };
  const spy = vi.spyOn(s.svc.hub, 'publishNotification');
  return { s, deps, projectId, todoId, buildId, stepId, notified: () => spy.mock.calls.length };
}

function wakes(w: World): string[] {
  return w.s.db
    .select({ prompt: stepTable.prompt })
    .from(stepTable)
    .where(and(eq(stepTable.kind, 'chief'), like(stepTable.prompt, `%watch:${w.todoId}%`)))
    .all()
    .map((row) => row.prompt ?? '');
}

async function ask(w: World, requestId: string): Promise<void> {
  const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
  await askWorkerQuestion(
    w.deps,
    row,
    {
      requestId,
      questions: [
        {
          header: 'Scope',
          question: `Which scope for ${requestId}?`,
          options: [{ label: 'Small' }, { label: 'Large' }],
        },
      ],
    },
    { holdMs: 0 },
  );
}

function ownerNow(w: World): TodoOwner | undefined {
  return getTodo(w.deps, w.todoId)?.owner;
}

describe('ownerOf (#3512)', () => {
  const cases: {
    name: string;
    phase: Phase;
    policy?: Policy;
    output?: 'code' | 'info';
    failure?: Failure;
    question?: boolean;
    gate?: 'transient' | 'human' | 'ready' | 'stale';
    prNumber?: number;
    archived?: boolean;
    owner: TodoOwner;
  }[] = [
    { name: 'todo', phase: 'todo', owner: null },
    { name: 'planning', phase: 'planning', owner: null },
    { name: 'building', phase: 'building', owner: null },
    { name: 'done', phase: 'done', owner: null },
    { name: 'closed', phase: 'closed', owner: null },
    { name: 'confirm', phase: 'confirm', owner: 'owner' },
    { name: 'confirm, human policy', phase: 'confirm', policy: 'human', owner: 'owner' },
    { name: 'archived confirm', phase: 'confirm', archived: true, owner: null },
    { name: 'code review, autonomous', phase: 'review', owner: null },
    { name: 'code review, human', phase: 'review', policy: 'human', owner: 'owner' },
    {
      name: 'code review, autonomous, human blocker',
      phase: 'review',
      gate: 'human',
      prNumber: 7,
      owner: 'owner',
    },
    {
      name: 'code review, human, PR not evaluated yet',
      phase: 'review',
      policy: 'human',
      prNumber: 7,
      owner: null,
    },
    {
      name: 'code review, human, checks still running',
      phase: 'review',
      policy: 'human',
      prNumber: 7,
      gate: 'transient',
      owner: null,
    },
    {
      name: 'code review, human, evaluated',
      phase: 'review',
      policy: 'human',
      prNumber: 7,
      gate: 'ready',
      owner: 'owner',
    },
    {
      name: 'code review, human, evaluated before this review entry',
      phase: 'review',
      policy: 'human',
      prNumber: 7,
      gate: 'stale',
      owner: null,
    },
    {
      name: 'info review, human',
      phase: 'review',
      policy: 'human',
      output: 'info',
      owner: 'coordinator',
    },
    { name: 'info review, autonomous', phase: 'review', output: 'info', owner: null },
    { name: 'failure owed a retry', phase: 'failed', failure: 'owed-retry', owner: null },
    { name: 'repeated failure', phase: 'failed', failure: 'repeated', owner: 'coordinator' },
    { name: 'parked failure', phase: 'failed', failure: 'parked', owner: 'coordinator' },
    {
      name: 'parked failure, human policy',
      phase: 'failed',
      policy: 'human',
      failure: 'parked',
      owner: 'coordinator',
    },
    { name: 'question while building', phase: 'building', question: true, owner: 'coordinator' },
    { name: 'question while planning', phase: 'planning', question: true, owner: 'coordinator' },
    {
      name: 'question in human review',
      phase: 'review',
      policy: 'human',
      question: true,
      owner: 'coordinator',
    },
  ];

  test.each(cases)('$name -> $owner', async (c) => {
    const w = openWorld({
      phase: c.question ? 'building' : c.phase,
      ...(c.policy !== undefined ? { policy: c.policy } : {}),
      ...(c.output !== undefined ? { output: c.output } : {}),
      ...(c.failure !== undefined ? { failure: c.failure } : {}),
      ...(c.prNumber !== undefined ? { prNumber: c.prNumber } : {}),
    });
    if (c.question) {
      await ask(w, 'ask-0000000a');
      if (c.phase !== 'building') {
        w.s.db.update(todoTable).set({ phase: c.phase }).where(eq(todoTable.id, w.todoId)).run();
      }
    }
    if (c.gate !== undefined) {
      w.s.db
        .insert(gateState)
        .values({
          buildId: w.buildId,
          ready: c.gate === 'ready' || c.gate === 'stale',
          policy: c.policy === 'human' ? 'human' : 'autonomous',
          blockers:
            c.gate === 'ready' || c.gate === 'stale'
              ? []
              : [{ code: c.gate === 'human' ? 'conflict' : 'checks-pending', class: c.gate }],
          evaluatedAt: c.gate === 'stale' ? 0 : nowMs(),
        } as typeof gateState.$inferInsert)
        .run();
    }
    if (c.archived) setTodoArchived(w.deps, w.todoId, true);
    const record = getTodo(w.deps, w.todoId);
    expect(record?.owner).toBe(c.owner);
  });
});

describe('reconcileOwners (#3512)', () => {
  test('a failure enqueues exactly one Coordinator wake and no owner notification', () => {
    const w = openWorld({ phase: 'building', failure: 'repeated' });
    w.s.db
      .update(buildTable)
      .set({ errorMessage: 'boom' })
      .where(eq(buildTable.id, w.buildId))
      .run();
    const before = w.notified();
    setTodoPhase(w.deps, w.todoId, 'failed');
    reconcileOwners(w.deps);
    reconcileOwners(w.deps, [w.todoId]);
    expect(ownerNow(w)).toBe('coordinator');
    expect(wakes(w)).toHaveLength(1);
    expect(wakes(w)[0]).toMatch(/^\[wake:failed\]/);
    expect(w.notified()).toBe(before);
  });

  test('a parked failure with no watch still enqueues exactly one wake', () => {
    const w = openWorld({ phase: 'building' });
    for (let i = 0; i < 4; i += 1) {
      const id = newUuidv7();
      w.s.db
        .insert(buildTable)
        .values({
          id,
          todoId: w.todoId,
          withPlan: false,
          prevPhase: 'todo',
          triggerSource: 'user',
          createdAt: nowMs() - 1000,
          errorMessage: 'boom',
        })
        .run();
      w.s.db
        .insert(stepTable)
        .values({
          id: newRecordId(),
          buildId: id,
          kind: 'session',
          status: 'failed',
          createdAt: nowMs() - 1000,
          finishedAt: nowMs() - 500,
        })
        .run();
    }
    w.s.db
      .update(buildTable)
      .set({ errorMessage: 'boom' })
      .where(eq(buildTable.id, w.buildId))
      .run();
    w.s.db
      .update(stepTable)
      .set({ status: 'failed', finishedAt: nowMs() })
      .where(eq(stepTable.id, w.stepId))
      .run();
    expect(parkFailedBuild(w.deps, w.buildId)).toBe(true);
    setTodoPhase(w.deps, w.todoId, 'failed');
    reconcileOwners(w.deps);
    expect(ownerNow(w)).toBe('coordinator');
    expect(wakes(w).filter((prompt) => prompt.startsWith('[wake:failed]'))).toHaveLength(1);
  });

  test('a change to owner sends one notification and no wake; an unchanged owner sends nothing', () => {
    const w = openWorld({ phase: 'planning' });
    const before = w.notified();
    setTodoPhase(w.deps, w.todoId, 'confirm');
    reconcileOwners(w.deps);
    reconcileOwners(w.deps, [w.todoId]);
    expect(ownerNow(w)).toBe('owner');
    expect(w.notified() - before).toBe(1);
    expect(wakes(w)).toHaveLength(0);
  });

  test('a second pending question under the same Coordinator ownership wakes once more', async () => {
    const w = openWorld({ phase: 'building' });
    const before = w.notified();
    await ask(w, 'ask-0000000b');
    reconcileOwners(w.deps);
    expect(wakes(w)).toHaveLength(1);
    await ask(w, 'ask-0000000c');
    reconcileOwners(w.deps);
    reconcileOwners(w.deps, [w.todoId]);
    expect(ownerNow(w)).toBe('coordinator');
    expect(wakes(w)).toHaveLength(2);
    expect(wakes(w)[1]).toContain('ask-0000000c');
    expect(w.notified()).toBe(before);
  });

  test('a write that skips the reconciler is caught by the sweep', () => {
    const w = openWorld({ phase: 'building', failure: 'repeated' });
    w.s.db
      .update(buildTable)
      .set({ errorMessage: 'boom' })
      .where(eq(buildTable.id, w.buildId))
      .run();
    w.s.db.update(todoTable).set({ phase: 'failed' }).where(eq(todoTable.id, w.todoId)).run();
    expect(wakes(w)).toHaveLength(0);
    reconcileOwners(w.deps);
    expect(wakes(w)).toHaveLength(1);
    w.s.db.update(todoTable).set({ phase: 'confirm' }).where(eq(todoTable.id, w.todoId)).run();
    const before = w.notified();
    reconcileOwners(w.deps);
    expect(w.notified() - before).toBe(1);
  });

  test('the first sweep after the migration seeds checkpoints without waking anyone', () => {
    const w = openWorld({ phase: 'failed', failure: 'parked' });
    const other = newRecordId(8);
    w.s.db
      .insert(todoTable)
      .values({
        id: other,
        teamId: w.s.team.id,
        projectId: w.projectId,
        title: 'Existing confirm',
        phase: 'confirm',
        phaseAt: nowMs(),
        seqNum: 2,
      })
      .run();
    w.s.db.update(todoTable).set({ lastNotifiedOwner: null, lastNotifiedWork: null }).run();
    const before = w.notified();
    reconcileOwners(w.deps);
    reconcileOwners(w.deps);
    expect(wakes(w)).toHaveLength(0);
    expect(w.notified()).toBe(before);
    const seeded = w.s.db.select().from(todoTable).all();
    expect(seeded.every((row) => row.lastNotifiedOwner !== null)).toBe(true);
  });
});

describe('the Coordinator can act on what it owns (#3512)', () => {
  const coordinator = {
    kind: 'agent' as const,
    name: 'Coordinator',
    stopActor: 'coordinator' as const,
  };

  test.each([
    { output: 'info' as const, owner: 'coordinator', done: true },
    { output: 'code' as const, owner: 'owner', done: false },
  ])('a human-policy $output review owned by $owner: complete_todos done=$done', (c) => {
    const w = openWorld({ phase: 'review', policy: 'human', output: c.output });
    expect(ownerNow(w)).toBe(c.owner);
    const out = transitionTodos(w.deps, w.s.team.id, [w.todoId], 'done', coordinator);
    expect(out.transitioned.includes(w.todoId)).toBe(c.done);
    expect(getTodo(w.deps, w.todoId)?.phase).toBe(c.done ? 'done' : 'review');
  });
});

describe('ownership is derived in one place (#3512)', () => {
  const root = join(import.meta.dirname, '../src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
    });
  const OWNERSHIP_DERIVATIONS: { pattern: RegExp; home: string }[] = [
    { pattern: /\[\s*'confirm',\s*'review',\s*'failed'\s*\]/, home: 'services/owner.ts' },
    { pattern: /\bfailureAwaitsAutomaticRetry\(/, home: 'services/owner.ts' },
    { pattern: /\benqueueOwnershipWake\(/, home: 'services/owner.ts' },
    { pattern: /\bnotifyOwnership\(/, home: 'services/owner.ts' },
    { pattern: /\bendSnoozeOn\([^)]*'needs-you'/, home: 'services/owner.ts' },
  ];

  test('no server file outside owner.ts derives ownership or sends ownership wakes', () => {
    const offenders = files(root).flatMap((path) => {
      const rel = relative(root, path);
      if (rel.startsWith('legacy/')) return [];
      return readFileSync(path, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          OWNERSHIP_DERIVATIONS.some(
            ({ pattern, home }) =>
              rel !== home && pattern.test(line) && !/^export function /.test(line),
          )
            ? [`${rel}:${index + 1}: ${line.trim()}`]
            : [],
        );
    });
    expect(offenders).toEqual([]);
  });
});
