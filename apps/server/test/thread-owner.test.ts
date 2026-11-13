import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_AUTONOMY_SETTINGS, type Phase, type TodoOwner } from '@cairn/shared';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  build as buildTable,
  chiefThread,
  dueEvent,
  gateState,
  notification,
  plan as planTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import type { BuildDeps } from '../src/services/builds.js';
import { executeChiefTool, transitionTodos } from '../src/services/chief-tools.js';
import { listNeedsYou } from '../src/services/needs-you.js';
import {
  COORDINATOR_TURN_DEADLINE_MS,
  handoffUnclaimedOwnershipWake,
  ownershipHandoffEventId,
  ownershipOf,
  reconcileOwners,
  seedOwnerCheckpoints,
} from '../src/services/owner.js';
import { parkFailedBuild } from '../src/services/retry-parking.js';
import { getTodo, setTodoArchived, setTodoPhase } from '../src/services/todos.js';
import { askWorkerQuestion } from '../src/services/worker-questions.js';
import { bootServer, seedSessionRoute, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const dispose of disposables) dispose();
});

type Policy = 'human' | 'autonomous';

const AUTO_PLAN =
  'Kind: fix\n## Context\nA task\n## Changes\nA change\n## Edge cases\nNone\n## Verification\n- `pnpm test` passes\n';
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
    repo?: 'github' | 'local' | 'hosted';
    hasChanges?: boolean;
    shipRoute?: 'merge-gate' | 'local-merge' | 'custom';
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
      autonomy: {
        ...DEFAULT_AUTONOMY_SETTINGS,
        mergePolicy: opts.policy ?? 'autonomous',
        ...(opts.shipRoute !== undefined ? { shipRoute: opts.shipRoute } : {}),
      },
      ...(opts.prNumber !== undefined || opts.repo === 'github'
        ? { repoKind: 'github', githubRepo: 'acme/app' }
        : {}),
      ...(opts.repo === 'local' ? { repoKind: 'local', localPath: '/srv/app' } : {}),
      ...(opts.repo === 'hosted' ? { repoKind: 'hosted', repoName: 'app' } : {}),
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
      hasChanges: opts.hasChanges ?? false,
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

function handoffEvent(w: World, stepId: string) {
  return w.s.db
    .select()
    .from(dueEvent)
    .where(eq(dueEvent.id, ownershipHandoffEventId(stepId)))
    .get();
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
    repo?: 'github' | 'local' | 'hosted';
    hasChanges?: boolean;
    shipRoute?: 'merge-gate' | 'local-merge' | 'custom';
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
    { name: 'code review, autonomous, no repository', phase: 'review', owner: 'coordinator' },
    {
      name: 'code review, autonomous, GitHub project without a PR',
      phase: 'review',
      repo: 'github',
      hasChanges: true,
      owner: 'coordinator',
    },
    {
      name: 'code review, human, GitHub project without a PR',
      phase: 'review',
      policy: 'human',
      repo: 'github',
      hasChanges: true,
      owner: 'owner',
    },
    {
      name: 'code review, autonomous, local repository with changes: a person lands it',
      phase: 'review',
      repo: 'local',
      hasChanges: true,
      owner: 'owner',
    },
    {
      name: 'code review, autonomous, hosted repository with changes: a person lands it',
      phase: 'review',
      repo: 'hosted',
      hasChanges: true,
      owner: 'owner',
    },
    {
      name: 'code review, autonomous, local repository, custom ship route without a PR',
      phase: 'review',
      repo: 'local',
      hasChanges: true,
      shipRoute: 'custom',
      owner: 'coordinator',
    },
    {
      name: 'code review, autonomous, local repository without changes',
      phase: 'review',
      repo: 'local',
      owner: 'coordinator',
    },
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
    { name: 'info review, autonomous', phase: 'review', output: 'info', owner: 'coordinator' },
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
      ...(c.repo !== undefined ? { repo: c.repo } : {}),
      ...(c.hasChanges !== undefined ? { hasChanges: c.hasChanges } : {}),
      ...(c.shipRoute !== undefined ? { shipRoute: c.shipRoute } : {}),
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

describe('pending questions and the inbox read ownerOf (#3512)', () => {
  test('a question the worker is still long-polling is Coordinator-owned before the phase flips', async () => {
    const w = openWorld({ phase: 'building' });
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, w.stepId)).get()!;
    const polling = askWorkerQuestion(
      w.deps,
      row,
      {
        requestId: 'ask-0000000e',
        questions: [{ header: 'Scope', question: 'Which scope?', options: [{ label: 'Small' }] }],
      },
      { holdMs: 1_500 },
    );
    await vi.waitFor(() => expect(ownerNow(w)).toBe('coordinator'));
    expect(getTodo(w.deps, w.todoId)?.phase).toBe('building');
    expect(wakes(w).filter((prompt) => prompt.includes('ask-0000000e'))).toHaveLength(1);
    await polling;
  });

  test('/api/needs-you takes each reason from ownerOf, not from the phase', async () => {
    const confirm = openWorld({ phase: 'confirm' });
    const review = openWorld({ phase: 'review', policy: 'human' });
    const asking = openWorld({ phase: 'building', policy: 'human' });
    await ask(asking, 'ask-0000000f');
    asking.s.db
      .update(todoTable)
      .set({ phase: 'needs_input' })
      .where(eq(todoTable.id, asking.todoId))
      .run();
    const reasons = [confirm, review, asking].map((w) =>
      listNeedsYou(w.deps, w.s.team.id).current.map((entry) => [entry.todo.owner, entry.reason]),
    );
    expect(reasons).toEqual([[['owner', 'confirm']], [['owner', 'review']], []]);
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
    const turn = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get();
    const queued = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, turn?.coordinatorTurn?.stepId ?? ''))
      .get();
    expect(handoffEvent(w, queued?.id ?? '')?.dueAt).toBe(
      (queued?.createdAt ?? 0) + COORDINATOR_TURN_DEADLINE_MS,
    );
  });

  test('an unclaimed Coordinator wake hands the task back when its deadline event fires', () => {
    const w = openWorld({ phase: 'building', failure: 'repeated' });
    w.s.db
      .update(buildTable)
      .set({ errorMessage: 'PR Auto-fix needs you: review round cap (3) reached' })
      .where(eq(buildTable.id, w.buildId))
      .run();
    setTodoPhase(w.deps, w.todoId, 'failed');
    reconcileOwners(w.deps, [w.todoId]);
    const turn = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get();
    const stepId = turn?.coordinatorTurn?.stepId ?? '';
    const queued = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
    const before = w.notified();
    handoffUnclaimedOwnershipWake(w.deps, stepId, (queued?.createdAt ?? 0) + 60_000);
    expect(ownerNow(w)).toBe('coordinator');
    expect(w.notified()).toBe(before);
    const due = (queued?.createdAt ?? 0) + COORDINATOR_TURN_DEADLINE_MS;
    handoffUnclaimedOwnershipWake(w.deps, stepId, due);
    const fresh = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get();
    expect(ownershipOf(w.s.db, fresh!, due)).toMatchObject({ owner: 'owner', reason: 'handoff' });
    expect(w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()?.status).toBe(
      'stopped',
    );
    expect(w.notified() - before).toBe(1);
  });

  test('a claimed Coordinator wake is not handed back when its deadline event fires', () => {
    const w = openWorld({ phase: 'building', failure: 'repeated' });
    w.s.db
      .update(buildTable)
      .set({ errorMessage: 'PR Auto-fix needs you: review round cap (3) reached' })
      .where(eq(buildTable.id, w.buildId))
      .run();
    setTodoPhase(w.deps, w.todoId, 'failed');
    reconcileOwners(w.deps, [w.todoId]);
    const turn = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get();
    const stepId = turn?.coordinatorTurn?.stepId ?? '';
    const queued = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
    w.s.db
      .update(stepTable)
      .set({ status: 'claimed', claimedAt: nowMs() })
      .where(eq(stepTable.id, stepId))
      .run();
    const before = w.notified();
    handoffUnclaimedOwnershipWake(
      w.deps,
      stepId,
      (queued?.createdAt ?? 0) + COORDINATOR_TURN_DEADLINE_MS,
    );
    expect(ownerNow(w)).toBe('coordinator');
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

  test('a plan the policy will auto-confirm notifies nobody until a person is really needed', () => {
    const w = openWorld({ phase: 'planning' });
    w.s.db
      .update(stepTable)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(stepTable.id, w.stepId))
      .run();
    w.s.db
      .insert(planTable)
      .values({ id: 'plan-auto', buildId: w.buildId, version: 1, content: AUTO_PLAN, createdAt: 1 })
      .run();
    const before = w.notified();
    setTodoPhase(w.deps, w.todoId, 'confirm', { hasPlan: true });
    reconcileOwners(w.deps);
    expect(ownerNow(w)).toBeNull();
    expect(w.notified()).toBe(before);
    expect(wakes(w)).toHaveLength(0);
    w.s.db
      .update(planTable)
      .set({ autoApprovePausedAt: nowMs() })
      .where(eq(planTable.id, 'plan-auto'))
      .run();
    reconcileOwners(w.deps);
    expect(ownerNow(w)).toBe('owner');
    expect(w.notified() - before).toBe(1);
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

  test('a migrated task that fails right after boot still wakes the Coordinator once', () => {
    const w = openWorld({ phase: 'building', failure: 'repeated' });
    w.s.db.update(todoTable).set({ lastNotifiedOwner: null, lastNotifiedWork: null }).run();
    seedOwnerCheckpoints(w.s.db);
    w.s.db
      .update(buildTable)
      .set({ errorMessage: 'boom' })
      .where(eq(buildTable.id, w.buildId))
      .run();
    setTodoPhase(w.deps, w.todoId, 'failed');
    reconcileOwners(w.deps);
    expect(wakes(w).filter((prompt) => prompt.startsWith('[wake:failed]'))).toHaveLength(1);
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
    seedOwnerCheckpoints(w.s.db);
    reconcileOwners(w.deps);
    reconcileOwners(w.deps);
    expect(wakes(w)).toHaveLength(0);
    expect(w.notified()).toBe(before);
    const seeded = w.s.db.select().from(todoTable).all();
    expect(seeded.every((row) => row.lastNotifiedOwner !== null)).toBe(true);
  });
});

describe('a Coordinator turn that changes nothing hands the task to the owner (task stall class 4)', () => {
  const coordinatorActor = {
    kind: 'agent' as const,
    name: 'Coordinator',
    stopActor: 'coordinator' as const,
  };

  function failedWorld(): World {
    const w = openWorld({ phase: 'building', failure: 'repeated' });
    w.s.db
      .update(buildTable)
      .set({ errorMessage: 'PR Auto-fix needs you: review round cap (3) reached' })
      .where(eq(buildTable.id, w.buildId))
      .run();
    setTodoPhase(w.deps, w.todoId, 'failed');
    reconcileOwners(w.deps);
    return w;
  }

  function wakeStep(w: World) {
    return w.s.db
      .select()
      .from(stepTable)
      .where(and(eq(stepTable.kind, 'chief'), like(stepTable.prompt, `%watch:${w.todoId}%`)))
      .all();
  }

  function endTurn(w: World, status: 'done' | 'failed' | 'stopped' = 'done'): void {
    for (const row of wakeStep(w)) {
      w.s.db
        .update(stepTable)
        .set({ status, finishedAt: nowMs() })
        .where(eq(stepTable.id, row.id))
        .run();
    }
  }

  test.each(['done', 'failed', 'stopped'] as const)(
    'a wake turn that ends %s with the failure unchanged hands it to the owner once',
    (status) => {
      const w = failedWorld();
      expect(ownerNow(w)).toBe('coordinator');
      expect(wakes(w)).toHaveLength(1);
      const before = w.notified();
      endTurn(w, status);
      reconcileOwners(w.deps);
      reconcileOwners(w.deps);
      expect(ownerNow(w)).toBe('owner');
      expect(w.notified()).toBe(before + 1);
      expect(
        w.s.db.select().from(notification).where(eq(notification.entityId, w.todoId)).get()?.type,
      ).toBe('coordinator_handoff');
      expect(wakes(w)).toHaveLength(1);
      const inbox = listNeedsYou(w.deps, w.s.team.id).current;
      expect(inbox.map((entry) => [entry.todo.id, entry.reason])).toEqual([[w.todoId, 'handoff']]);
    },
  );

  test('a wake turn still running stays with the Coordinator', () => {
    const w = failedWorld();
    reconcileOwners(w.deps);
    expect(ownerNow(w)).toBe('coordinator');
  });

  test('a wake never claimed after 30 minutes hands the task to the owner and cancels the wake', () => {
    const w = failedWorld();
    for (const row of wakeStep(w)) {
      w.s.db
        .update(stepTable)
        .set({ createdAt: nowMs() - 31 * 60_000 })
        .where(eq(stepTable.id, row.id))
        .run();
    }
    reconcileOwners(w.deps);
    expect(ownerNow(w)).toBe('owner');
    expect(wakeStep(w).map((row) => row.status)).toEqual(['stopped']);
  });

  test.each(['pending', 'waiting_quota'] as const)(
    'cancelling the last %s wake clears busy state and publishes the stopped step',
    (status) => {
      const w = failedWorld();
      const wake = wakeStep(w)[0]!;
      w.s.db
        .update(stepTable)
        .set({ status, createdAt: nowMs() - 31 * 60_000 })
        .where(eq(stepTable.id, wake.id))
        .run();
      const publish = vi.spyOn(w.s.convHub, 'publishStep');
      reconcileOwners(w.deps);
      expect(
        w.s.db.select().from(chiefThread).where(eq(chiefThread.id, wake.buildId)).get()?.activeRun,
      ).toBeNull();
      expect(publish).toHaveBeenCalledWith(
        wake.buildId,
        expect.objectContaining({ id: wake.id, status: 'stopped' }),
      );
    },
  );

  test('cancelling a stale wake keeps an active sibling busy', () => {
    const w = failedWorld();
    const wake = wakeStep(w)[0]!;
    w.s.db
      .update(stepTable)
      .set({ createdAt: nowMs() - 31 * 60_000 })
      .where(eq(stepTable.id, wake.id))
      .run();
    w.s.db
      .insert(stepTable)
      .values({
        id: newRecordId(),
        buildId: wake.buildId,
        kind: 'chief',
        status: 'claimed',
        createdAt: nowMs(),
        claimedAt: nowMs(),
      })
      .run();
    reconcileOwners(w.deps);
    expect(
      w.s.db.select().from(chiefThread).where(eq(chiefThread.id, wake.buildId)).get()?.activeRun,
    ).not.toBeNull();
    expect(wakeStep(w)[0]?.status).toBe('stopped');
  });

  test.each(['done', 'failed', 'stopped'] as const)(
    'needs_you preserves answer arguments after a question turn ends %s',
    async (status) => {
      const w = openWorld({ phase: 'building' });
      const requestId = 'ask-handoff-answer';
      await ask(w, requestId);
      endTurn(w, status);
      reconcileOwners(w.deps);
      const wake = wakeStep(w)[0]!;
      const thread = w.s.db
        .select()
        .from(chiefThread)
        .where(eq(chiefThread.id, wake.buildId))
        .get()!;
      const deps = {
        ...w.deps,
        box: w.s.secretBox,
        reposDir: w.s.reposDir,
        attachmentsDir: w.s.attachmentsDir,
        skillsDir: w.s.skillsDir,
      };
      const ctx = {
        teamId: w.s.team.id,
        userId: w.s.user.id,
        chiefId: thread.chiefId,
        threadId: thread.id,
        chiefAgentId: null,
        conversationId: thread.id,
      };
      const out = JSON.parse(await executeChiefTool(deps, ctx, 'needs_you', {}));
      expect(out.items).toEqual([
        expect.objectContaining({
          todoId: w.todoId,
          owner: 'owner',
          kind: 'handoff',
          questions: [
            expect.objectContaining({
              requestId,
              items: [expect.objectContaining({ question: `Which scope for ${requestId}?` })],
            }),
          ],
        }),
      ]);
      const answered = JSON.parse(
        await executeChiefTool(deps, ctx, 'answer_question', {
          todoId: w.todoId,
          requestId,
          answer: 'Small',
        }),
      );
      expect(answered).toMatchObject({ todoId: w.todoId, requestId });
    },
  );

  test('a wake the Coordinator is still running keeps the task, however long it runs', () => {
    const w = failedWorld();
    for (const row of wakeStep(w)) {
      w.s.db
        .update(stepTable)
        .set({
          status: 'claimed',
          createdAt: nowMs() - 60 * 60_000,
          claimedAt: nowMs() - 45 * 60_000,
        })
        .where(eq(stepTable.id, row.id))
        .run();
    }
    reconcileOwners(w.deps);
    expect(ownerNow(w)).toBe('coordinator');
  });

  test('a turn that acts on the failure changes the work and hands nothing over', () => {
    const w = failedWorld();
    setTodoPhase(w.deps, w.todoId, 'queued');
    endTurn(w);
    reconcileOwners(w.deps);
    expect(ownerNow(w)).toBe(null);
  });

  test('new work after a handoff wakes the Coordinator again', async () => {
    const w = failedWorld();
    endTurn(w);
    reconcileOwners(w.deps);
    expect(ownerNow(w)).toBe('owner');
    setTodoPhase(w.deps, w.todoId, 'queued');
    setTodoPhase(w.deps, w.todoId, 'building');
    await ask(w, 'ask-00000c4a');
    reconcileOwners(w.deps);
    expect(ownerNow(w)).toBe('coordinator');
    expect(wakes(w)).toHaveLength(2);
  });

  test('the Coordinator can still accept a review it handed over', () => {
    const w = openWorld({ phase: 'building', policy: 'human', output: 'info' });
    setTodoPhase(w.deps, w.todoId, 'review');
    reconcileOwners(w.deps);
    endTurn(w);
    reconcileOwners(w.deps);
    expect(ownerNow(w)).toBe('owner');
    const out = transitionTodos(w.deps, w.s.team.id, [w.todoId], 'done', coordinatorActor);
    expect(out.transitioned).toEqual([w.todoId]);
  });

  test('the failed wake names the settling actions and no longer allows a silent end', () => {
    const w = failedWorld();
    const [prompt] = wakes(w);
    for (const tool of ['message_thread', 'close_todos', 'update_todo', 'blockedBy']) {
      expect(prompt).toContain(tool);
    }
    expect(prompt).toMatch(/update_todo.*blockedBy.*message_thread/);
    expect(prompt).not.toContain('否则不发消息');
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

  test.each([
    { name: 'an autonomous research report', output: 'info' as const },
    {
      name: 'an autonomous GitHub review without a PR',
      output: 'code' as const,
      repo: 'github' as const,
    },
  ])('$name wakes the Coordinator once, and complete_todos accepts it', (c) => {
    const w = openWorld({
      phase: 'building',
      output: c.output,
      ...(c.repo ? { repo: c.repo } : {}),
    });
    setTodoPhase(w.deps, w.todoId, 'review');
    reconcileOwners(w.deps);
    reconcileOwners(w.deps, [w.todoId]);
    expect(ownerNow(w)).toBe('coordinator');
    expect(wakes(w)).toHaveLength(1);
    expect(wakes(w)[0]).toMatch(/^\[wake:gate\]/);
    expect(wakes(w)[0]).toContain('complete_todos');
    const out = transitionTodos(w.deps, w.s.team.id, [w.todoId], 'done', coordinator);
    expect(out.transitioned).toEqual([w.todoId]);
  });

  test('a code review that is Coordinator-owned only through a question still needs the person', async () => {
    const w = openWorld({ phase: 'building', policy: 'human' });
    await ask(w, 'ask-0000000d');
    w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
    expect(ownerNow(w)).toBe('coordinator');
    const out = transitionTodos(w.deps, w.s.team.id, [w.todoId], 'done', coordinator);
    expect(out.transitioned).toEqual([]);
    expect(getTodo(w.deps, w.todoId)?.phase).toBe('review');
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
