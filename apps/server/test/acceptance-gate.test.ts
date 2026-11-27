import { ASK_USER_QUESTION_KIND, type DocumentDiffFile } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { attachment, build, message, project, schedule, step, todo } from '../src/db/schema.js';
import { markDelivered } from '../src/services/answer-delivery.js';
import { sendBuildSteer } from '../src/services/build-steer.js';
import { completeStep, startBuilds } from '../src/services/builds.js';
import { finishStep } from '../src/services/machines.js';
import { ownershipOf } from '../src/services/owner.js';
import { answerTaskQuestion, messageThreadAsUser } from '../src/services/thread-message.js';
import { getTodo } from '../src/services/todos.js';
import { pendingWorkerQuestions } from '../src/services/worker-question-store.js';
import {
  bootServer,
  claimedGeneration,
  insertMachine,
  postProject,
  req,
  seedSessionRoute,
} from './helpers.js';

function depsOf(s: ReturnType<typeof bootServer>) {
  return {
    db: s.db,
    hub: s.hub,
    convHub: s.convHub,
    machineHub: s.machineHub,
    user: s.user,
    attachmentsDir: s.attachmentsDir,
    box: s.secretBox,
    reposDir: s.reposDir,
    skillsDir: s.skillsDir,
  };
}

function diffFile(path: string): DocumentDiffFile {
  return { path, additions: 2, deletions: 0, hunks: [] };
}

async function createWorld(s: ReturnType<typeof bootServer>) {
  const machineId = insertMachine(s);
  seedSessionRoute(s, { provider: 'p', modelId: 'm', machineId });
  return machineId;
}

async function createTaskIn(
  s: ReturnType<typeof bootServer>,
  opts: {
    repoKind?: 'hosted' | 'github';
    output?: 'code' | 'info' | 'report';
    changes?: DocumentDiffFile[] | null;
    machineId: string;
  },
) {
  const projectId = await postProject(s.app, `Proj-${Math.random().toString(36).slice(2, 7)}`);
  if (opts.repoKind === 'github') {
    s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'org/repo' })
      .where(eq(project.id, projectId))
      .run();
  }
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Acceptance test task',
    spec: 'Verify real acceptance behavior',
    ...(opts.output ? { output: opts.output } : {}),
  });
  const { id: todoId } = (await res.json()) as { id: string };
  const [started] = startBuilds(depsOf(s), { projectId, todoIds: [todoId] });
  const buildId = started!.id;
  const stepRow = s.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  s.db
    .update(step)
    .set({ status: 'claimed', machineId: opts.machineId, claimedAt: 1_000 })
    .where(eq(step.id, stepRow.id))
    .run();
  s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
  if (opts.changes !== undefined) {
    s.db.update(build).set({ changes: opts.changes }).where(eq(build.id, buildId)).run();
  }
  return { projectId, todoId, buildId, stepId: stepRow.id };
}

function pushToolMsg(
  s: ReturnType<typeof bootServer>,
  buildId: string,
  id: string,
  name: string,
  args: Record<string, unknown>,
  createdAt: number,
  opts: { result?: unknown; isError?: boolean } = {},
) {
  s.db
    .insert(message)
    .values({
      id,
      conversationId: buildId,
      role: 'assistant',
      createdAt,
      content: {
        kind: 'toolcall',
        call: {
          id,
          name,
          arguments: args,
          result: opts.result ?? 'ok',
          isError: opts.isError ?? false,
          startedAt: createdAt,
          endedAt: createdAt,
        },
      },
    })
    .run();
}

function pushTextMsg(
  s: ReturnType<typeof bootServer>,
  buildId: string,
  id: string,
  text: string,
  createdAt: number,
) {
  s.db
    .insert(message)
    .values({
      id,
      conversationId: buildId,
      role: 'assistant',
      createdAt,
      content: [{ type: 'text', text }],
    })
    .run();
}

function pushStepImage(
  s: ReturnType<typeof bootServer>,
  todoId: string,
  stepId: string,
  id: string,
  createdAt: number,
  status: 'ready' | 'pending' | 'failed' = 'ready',
) {
  s.db
    .insert(attachment)
    .values({
      id,
      todoId,
      teamId: s.team.id,
      createdBy: `step:${stepId}`,
      fileName: 'live-screen.png',
      mimeType: 'image/png',
      sizeBytes: 128,
      storageKey: `${s.team.id}/${id}.png`,
      grantId: `grant-${id}`,
      scope: 'message',
      status,
      createdAt,
    })
    .run();
}

describe('server acceptance gate on completeStep (Slice 2)', () => {
  test('normal UI delivery settles done with 0 retries while #18 missing shot retries once then opens per-step QuestionCard', async () => {
    const s = bootServer();
    const machineId = await createWorld(s);

    const okTask = await createTaskIn(s, {
      machineId,
      changes: [diffFile('apps/web/src/App.tsx')],
    });
    pushToolMsg(s, okTask.buildId, 'm1', 'edit', { path: 'apps/web/src/App.tsx' }, 100);
    pushToolMsg(
      s,
      okTask.buildId,
      'm2',
      'attach_file',
      { path: 'live-screen.png', caption: 'Live app' },
      200,
    );
    pushStepImage(s, okTask.todoId, okTask.stepId, 'att-live', 200, 'ready');
    completeStep(depsOf(s), okTask.stepId, { hasChanges: true });
    expect(getTodo(depsOf(s), okTask.todoId)?.phase).toBe('done');
    expect(s.db.select().from(step).where(eq(step.buildId, okTask.buildId)).all()).toHaveLength(1);

    const noShot = await createTaskIn(s, {
      machineId,
      changes: [diffFile('apps/web/src/App.tsx')],
    });
    pushToolMsg(s, noShot.buildId, 'n1', 'edit', { path: 'apps/web/src/App.tsx' }, 100);
    pushToolMsg(s, noShot.buildId, 'n2', 'bash', { command: 'pnpm exec playwright test' }, 200, {
      result: 'passed',
    });
    completeStep(depsOf(s), noShot.stepId, { hasChanges: true });
    expect(getTodo(depsOf(s), noShot.todoId)?.phase).toBe('building');
    const stepsAfter1 = s.db.select().from(step).where(eq(step.buildId, noShot.buildId)).all();
    expect(stepsAfter1).toHaveLength(2);
    const step2 = stepsAfter1.find((row) => row.id !== noShot.stepId)!;
    expect(step2.prompt).toContain('[cairn acceptance check]');

    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: 2_000 })
      .where(eq(step.id, step2.id))
      .run();
    completeStep(depsOf(s), step2.id, { hasChanges: true });
    expect(getTodo(depsOf(s), noShot.todoId)?.phase).toBe('needs_input');
    const questions = pendingWorkerQuestions(s.db, noShot.buildId);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.requestId).toBe(`acceptance-blocked-${step2.id}`);
  });

  test('#38 spawn EPERM before commit and #53/#54 unpushed GitHub states open needs_input while legacy daemon stays compatible', async () => {
    const s = bootServer();
    const machineId = await createWorld(s);

    const eperm = await createTaskIn(s, { machineId, changes: null });
    pushToolMsg(s, eperm.buildId, 'e1', 'edit', { path: 'apps/server/src/app.ts' }, 100);
    pushToolMsg(s, eperm.buildId, 'e2', 'bash', { command: 'vitest run' }, 200, {
      result: 'Error: spawn EPERM',
      isError: true,
    });
    pushTextMsg(s, eperm.buildId, 'e3', 'Blocked on spawn EPERM locally; deferred to CI.', 250);
    completeStep(depsOf(s), eperm.stepId, { hasChanges: false });
    expect(getTodo(depsOf(s), eperm.todoId)?.phase).toBe('needs_input');
    const epermQs = pendingWorkerQuestions(s.db, eperm.buildId);
    expect(epermQs[0]?.requestId).toBe(`acceptance-blocked-${eperm.stepId}`);
    expect(epermQs[0]?.questions[0]?.header).not.toBe('Not delivered');

    const blocked = await createTaskIn(s, {
      machineId,
      repoKind: 'github',
      changes: [diffFile('scripts/check.mjs')],
    });
    pushToolMsg(s, blocked.buildId, 'b1', 'edit', { path: 'scripts/check.mjs' }, 100);
    pushToolMsg(s, blocked.buildId, 'b2', 'bash', { command: 'node scripts/check.mjs' }, 200);
    pushToolMsg(s, blocked.buildId, 'b3', 'bash', { command: 'git push' }, 300, {
      result: 'fatal: Authentication failed',
      isError: true,
    });
    completeStep(depsOf(s), blocked.stepId, { hasChanges: true, unpushedCommits: 2 });
    expect(getTodo(depsOf(s), blocked.todoId)?.phase).toBe('needs_input');

    const unknown = await createTaskIn(s, {
      machineId,
      repoKind: 'github',
      changes: [diffFile('scripts/check.mjs')],
    });
    pushToolMsg(s, unknown.buildId, 'u1', 'edit', { path: 'scripts/check.mjs' }, 100);
    pushToolMsg(s, unknown.buildId, 'u2', 'bash', { command: 'node scripts/check.mjs' }, 200);
    completeStep(depsOf(s), unknown.stepId, { hasChanges: true, unpushedCommits: null });
    expect(getTodo(depsOf(s), unknown.todoId)?.phase).toBe('needs_input');

    const legacy = await createTaskIn(s, {
      machineId,
      repoKind: 'github',
      changes: [diffFile('scripts/check.mjs')],
    });
    pushToolMsg(s, legacy.buildId, 'l1', 'edit', { path: 'scripts/check.mjs' }, 100);
    pushToolMsg(s, legacy.buildId, 'l2', 'bash', { command: 'node scripts/check.mjs' }, 200);
    completeStep(depsOf(s), legacy.stepId, { hasChanges: true, unpushedCommits: undefined });
    expect(getTodo(depsOf(s), legacy.todoId)?.phase).toBe('done');
  });

  test('per-step recovery loop opens a fresh QuestionCard when user answers without unblocking, then settles done once unblocked', async () => {
    const s = bootServer();
    const machineId = await createWorld(s);
    const { todoId, buildId, stepId } = await createTaskIn(s, {
      machineId,
      repoKind: 'github',
      changes: [diffFile('scripts/check.mjs')],
    });
    pushToolMsg(s, buildId, 'm1', 'edit', { path: 'scripts/check.mjs' }, 100);
    pushToolMsg(s, buildId, 'm2', 'bash', { command: 'git push' }, 200, {
      result: 'Permission denied',
      isError: true,
    });
    completeStep(depsOf(s), stepId, { hasChanges: true, unpushedCommits: 1 });
    expect(getTodo(depsOf(s), todoId)?.phase).toBe('needs_input');
    expect(pendingWorkerQuestions(s.db, buildId)[0]?.requestId).toBe(
      `acceptance-blocked-${stepId}`,
    );

    await messageThreadAsUser(depsOf(s), s.team.id, todoId, {
      content: 'Try pushing again now',
      clientMessageId: 'ans-1',
    });
    const step2 = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((r) => r.id !== stepId && r.status === 'pending')!;
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: 2_000 })
      .where(eq(step.id, step2.id))
      .run();
    s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    markDelivered(depsOf(s), buildId, [`acceptance-blocked-${stepId}`], 'session-start', step2.id);

    completeStep(depsOf(s), step2.id, { hasChanges: true, unpushedCommits: 1 });
    expect(getTodo(depsOf(s), todoId)?.phase).toBe('needs_input');
    const secondQuestions = pendingWorkerQuestions(s.db, buildId);
    expect(secondQuestions).toHaveLength(1);
    expect(secondQuestions[0]?.requestId).toBe(`acceptance-blocked-${step2.id}`);

    await messageThreadAsUser(depsOf(s), s.team.id, todoId, {
      content: 'Credentials refreshed',
      clientMessageId: 'ans-2',
    });
    const step3 = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, buildId))
      .all()
      .find((r) => r.id !== stepId && r.id !== step2.id)!;
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: 3_000 })
      .where(eq(step.id, step3.id))
      .run();
    s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
    markDelivered(
      depsOf(s),
      buildId,
      [`acceptance-blocked-${step2.id}`],
      'session-start',
      step3.id,
    );
    pushToolMsg(s, buildId, 'm3', 'bash', { command: 'node scripts/check.mjs' }, 400, {
      result: 'OK',
    });
    completeStep(depsOf(s), step3.id, { hasChanges: true, unpushedCommits: 0 });
    expect(getTodo(depsOf(s), todoId)?.phase).toBe('done');
  });

  test('info deliverable gate, bypass guards, null-changes fallback, and idempotent replay all behave safely', async () => {
    const s = bootServer();
    const machineId = await createWorld(s);

    const unchecked = await createTaskIn(s, { machineId, output: 'info' });
    pushToolMsg(s, unchecked.buildId, 'i1', 'write_file', { path: 'report.md' }, 100);
    pushToolMsg(s, unchecked.buildId, 'i2', 'submit_report', { path: 'report.md' }, 200);
    completeStep(depsOf(s), unchecked.stepId, { hasChanges: false, report: '# Draft' });
    expect(getTodo(depsOf(s), unchecked.todoId)?.phase).toBe('building');

    const checked = await createTaskIn(s, { machineId, output: 'info' });
    pushToolMsg(s, checked.buildId, 'c1', 'write_file', { path: 'report.md' }, 100);
    pushToolMsg(s, checked.buildId, 'c2', 'read_file', { path: 'report.md' }, 150, {
      result: '# Report (gap: external paywall unavailable)',
    });
    pushToolMsg(s, checked.buildId, 'c3', 'submit_report', { path: 'report.md' }, 200);
    completeStep(depsOf(s), checked.stepId, {
      hasChanges: false,
      report: '# Report (gap: external paywall unavailable)',
    });
    expect(getTodo(depsOf(s), checked.todoId)?.phase).toBe('review');

    const withPending = await createTaskIn(s, {
      machineId,
      changes: [diffFile('apps/web/src/App.tsx')],
    });
    pushToolMsg(s, withPending.buildId, 'p1', 'edit', { path: 'apps/web/src/App.tsx' }, 100);
    s.db
      .insert(message)
      .values({
        id: 'pending-q',
        conversationId: withPending.buildId,
        role: 'assistant',
        createdAt: 150,
        content: {
          kind: ASK_USER_QUESTION_KIND,
          requestId: 'pending-q',
          status: 'pending',
          questions: [{ header: 'Q', question: 'Confirm?', options: [] }],
          answers: null,
        },
      })
      .run();
    completeStep(depsOf(s), withPending.stepId, { hasChanges: true });
    expect(getTodo(depsOf(s), withPending.todoId)?.phase).toBe('needs_input');

    const nullChanges = await createTaskIn(s, { machineId, changes: null });
    pushToolMsg(
      s,
      nullChanges.buildId,
      'nc1',
      'edit_file',
      { path: 'apps/web/src/Panel.tsx' },
      100,
    );
    completeStep(depsOf(s), nullChanges.stepId, { hasChanges: true });
    expect(getTodo(depsOf(s), nullChanges.todoId)?.phase).toBe('building');

    const replay = await createTaskIn(s, {
      machineId,
      changes: [diffFile('apps/web/src/App.tsx')],
    });
    pushToolMsg(s, replay.buildId, 'r1', 'edit', { path: 'apps/web/src/App.tsx' }, 100);
    await finishStep(depsOf(s), machineId, replay.stepId, {
      status: 'success',
      hasChanges: true,
      usage: [{ model: 'p/m', input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }],
      generation: claimedGeneration(s.db, replay.stepId),
    });
    const stepsAfterFirst = s.db.select().from(step).where(eq(step.buildId, replay.buildId)).all();
    expect(stepsAfterFirst).toHaveLength(2);
    expect(stepsAfterFirst.some((r) => r.prompt?.includes('[cairn acceptance check]'))).toBe(true);
    expect(pendingWorkerQuestions(s.db, replay.buildId)).toHaveLength(0);
    await finishStep(depsOf(s), machineId, replay.stepId, {
      status: 'success',
      hasChanges: true,
      usage: [{ model: 'p/m', input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }],
      generation: claimedGeneration(s.db, replay.stepId),
    });
    expect(s.db.select().from(step).where(eq(step.buildId, replay.buildId)).all()).toHaveLength(2);
    expect(pendingWorkerQuestions(s.db, replay.buildId)).toHaveLength(0);
  });

  test('report task stating sandbox blocker finishes in review without acceptance-blocked QuestionCard', async () => {
    const s = bootServer();
    const machineId = await createWorld(s);
    const task = await createTaskIn(s, {
      machineId,
      repoKind: 'github',
      output: 'report',
      changes: [],
    });
    pushToolMsg(
      s,
      task.buildId,
      'r1',
      'run_command',
      { CommandLine: 'git fetch origin main' },
      100,
      { result: 'Operation not permitted', isError: true },
    );
    pushToolMsg(
      s,
      task.buildId,
      'r2',
      'write_file',
      { Path: '/home/agent/.gemini/scratch/ci_runs.json' },
      150,
    );
    pushTextMsg(
      s,
      task.buildId,
      'r3',
      '# Weekly Health Check\n\n## 0. Sandbox Blocker\nOperation not permitted in worktree sandbox.',
      200,
    );
    completeStep(depsOf(s), task.stepId, {
      hasChanges: false,
      unpushedCommits: null,
      report: '# Weekly Health Check\nOperation not permitted',
    });
    expect(getTodo(depsOf(s), task.todoId)?.phase).toBe('review');
    expect(pendingWorkerQuestions(s.db, task.buildId)).toHaveLength(0);
    const todoRow = s.db.select().from(todo).where(eq(todo.id, task.todoId)).get()!;
    expect(ownershipOf(s.db, todoRow)).toMatchObject({ owner: 'coordinator', reason: 'review' });
  });

  test('Coordinator answer-path hands off to owner and refuses re-answering when acceptance-blocked repeats on code task', async () => {
    const s = bootServer();
    const machineId = await createWorld(s);
    const task = await createTaskIn(s, {
      machineId,
      repoKind: 'github',
      output: 'code',
      changes: null,
    });
    pushToolMsg(s, task.buildId, 'c1', 'edit', { path: 'apps/server/src/app.ts' }, 100);
    pushToolMsg(s, task.buildId, 'c2', 'bash', { command: 'vitest run' }, 200, {
      result: 'Error: spawn EPERM',
      isError: true,
    });
    completeStep(depsOf(s), task.stepId, { hasChanges: false });
    expect(getTodo(depsOf(s), task.todoId)?.phase).toBe('needs_input');

    const firstReqId = `acceptance-blocked-${task.stepId}`;
    expect(pendingWorkerQuestions(s.db, task.buildId)[0]?.requestId).toBe(firstReqId);
    const todoRow1 = s.db.select().from(todo).where(eq(todo.id, task.todoId)).get()!;
    expect(ownershipOf(s.db, todoRow1)).toMatchObject({ owner: 'coordinator', reason: 'question' });

    await answerTaskQuestion(
      depsOf(s),
      s.team.id,
      { todoId: task.todoId, requestId: firstReqId, answer: 'Re-run check' },
      'coordinator',
    );
    const step2 = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, task.buildId))
      .all()
      .find((r) => r.id !== task.stepId)!;
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: 2_000 })
      .where(eq(step.id, step2.id))
      .run();
    s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, task.todoId)).run();
    markDelivered(depsOf(s), task.buildId, [firstReqId], 'session-start', step2.id);

    const wakesBeforeSecond = s.db
      .select()
      .from(step)
      .where(eq(step.kind, 'chief'))
      .all()
      .filter((r) => r.prompt?.includes(task.todoId)).length;

    completeStep(depsOf(s), step2.id, { hasChanges: false });
    expect(getTodo(depsOf(s), task.todoId)?.phase).toBe('needs_input');
    const secondReqId = `acceptance-blocked-${step2.id}`;
    expect(pendingWorkerQuestions(s.db, task.buildId)[0]?.requestId).toBe(secondReqId);

    const todoRow2 = s.db.select().from(todo).where(eq(todo.id, task.todoId)).get()!;
    expect(ownershipOf(s.db, todoRow2)).toMatchObject({
      owner: 'owner',
      reason: 'handoff',
      from: 'question',
    });
    const wakesAfterSecond = s.db
      .select()
      .from(step)
      .where(eq(step.kind, 'chief'))
      .all()
      .filter((r) => r.prompt?.includes(task.todoId)).length;
    expect(wakesAfterSecond).toBe(wakesBeforeSecond);

    await expect(
      answerTaskQuestion(
        depsOf(s),
        s.team.id,
        { todoId: task.todoId, requestId: secondReqId, answer: 'Try again' },
        'coordinator',
      ),
    ).rejects.toMatchObject({ status: 409 });

    await messageThreadAsUser(depsOf(s), s.team.id, task.todoId, {
      content: 'Unblocked now, try again',
      clientMessageId: 'human-unblock-1',
    });
    const step3 = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, task.buildId))
      .all()
      .find((r) => r.id !== task.stepId && r.id !== step2.id)!;
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: 3_000 })
      .where(eq(step.id, step3.id))
      .run();
    s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, task.todoId)).run();
    markDelivered(depsOf(s), task.buildId, [secondReqId], 'session-start', step3.id);
    pushToolMsg(s, task.buildId, 'c3', 'bash', { command: 'vitest run' }, 400, {
      result: '1 passed',
    });
    completeStep(depsOf(s), step3.id, { hasChanges: true });
    expect(getTodo(depsOf(s), task.todoId)?.phase).toBe('done');
  });

  test('new scheduled run cancels stale pending acceptance-blocked question so report finishes in review', async () => {
    const s = bootServer();
    const machineId = await createWorld(s);
    const task = await createTaskIn(s, {
      machineId,
      repoKind: 'github',
      output: 'report',
      changes: [],
    });
    const staleReqId = `acceptance-blocked-${task.stepId}`;
    s.db
      .update(step)
      .set({ status: 'done', finishedAt: 1_500 })
      .where(eq(step.id, task.stepId))
      .run();
    s.db
      .insert(message)
      .values({
        id: staleReqId,
        conversationId: task.buildId,
        role: 'assistant',
        createdAt: 1_500,
        content: {
          kind: ASK_USER_QUESTION_KIND,
          requestId: staleReqId,
          status: 'pending',
          questions: [{ header: 'Acceptance needed', question: 'Stale blocker', options: [] }],
          answers: null,
        },
      })
      .run();
    s.db.update(todo).set({ phase: 'needs_input' }).where(eq(todo.id, task.todoId)).run();
    const schedId = 'sched-weekly-health';
    const now = Date.now();
    s.db
      .insert(schedule)
      .values({
        id: schedId,
        teamId: s.team.id,
        projectId: task.projectId,
        todoId: task.todoId,
        chiefThreadId: null,
        kind: 'weekly',
        cron: '0 9 * * 1',
        prompt: 'Run weekly check',
        enabled: true,
        at: null,
        tz: 'UTC',
        nextRunAt: now,
        createdAt: now,
        createdBy: 'owner',
      })
      .run();

    await sendBuildSteer(
      depsOf(s),
      task.buildId,
      { content: 'Run weekly check' },
      {
        afterTurn: true,
        human: false,
        schedule: {
          id: schedId,
          createdBy: 'owner',
          at: now,
          expected: now,
          next: now + 7 * 86_400_000,
          triggered: false,
        },
      },
    );
    expect(pendingWorkerQuestions(s.db, task.buildId)).toHaveLength(0);

    const step2 = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, task.buildId))
      .all()
      .find((r) => r.id !== task.stepId)!;
    s.db
      .update(step)
      .set({ status: 'claimed', claimedAt: now + 100 })
      .where(eq(step.id, step2.id))
      .run();
    s.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, task.todoId)).run();
    pushTextMsg(
      s,
      task.buildId,
      'sched-report',
      '# Weekly Report\nSandbox Operation not permitted noted.',
      now + 200,
    );
    completeStep(depsOf(s), step2.id, {
      hasChanges: false,
      unpushedCommits: null,
      report: '# Weekly Report\nSandbox Operation not permitted noted.',
    });
    expect(getTodo(depsOf(s), task.todoId)?.phase).toBe('review');
    expect(pendingWorkerQuestions(s.db, task.buildId)).toHaveLength(0);
  });
});
