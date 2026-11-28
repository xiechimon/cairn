import {
  type DocumentDiffFile,
  LEGACY_SESSION_BRIEFS,
  LEGACY_SESSION_REWORK_BRIEFS,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { attachment, build, message, step, todo } from '../src/db/schema.js';
import { attachWorkerFile } from '../src/services/agent-attachments.js';
import { markDelivered } from '../src/services/answer-delivery.js';
import { completeStep, startBuilds } from '../src/services/builds.js';
import { sweepStallMonitor } from '../src/services/stall-monitor.js';
import { writeQuota } from '../src/services/step-groups/quota.js';
import { getTodo } from '../src/services/todos.js';
import { backfillTranscriptOrigins } from '../src/services/transcript-origin-backfill.js';
import { pendingWorkerQuestions } from '../src/services/worker-question-store.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedSessionRoute,
  type TestServer,
} from './helpers.js';

let s: TestServer;
afterEach(() => s?.dispose());

function depsOf(server: TestServer) {
  return {
    db: server.db,
    hub: server.hub,
    convHub: server.convHub,
    machineHub: server.machineHub,
    user: server.user,
    attachmentsDir: server.attachmentsDir,
    box: server.secretBox,
    reposDir: server.reposDir,
    skillsDir: server.skillsDir,
  };
}

function diffFile(path: string): DocumentDiffFile {
  return { path, additions: 2, deletions: 0, hunks: [] };
}

async function seedTask(
  server: TestServer,
  opts: { machineId: string; changes?: DocumentDiffFile[] | null },
) {
  const projectId = await postProject(server.app, `Prod-${Math.random().toString(36).slice(2, 7)}`);
  const res = await req(server.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: 'Verify done in prod',
    spec: 'Update API handler and verify with proof',
  });
  const { id: todoId } = (await res.json()) as { id: string };
  const [started] = startBuilds(depsOf(server), { projectId, todoIds: [todoId] });
  const buildId = started!.id;
  const stepRow = server.db.select().from(step).where(eq(step.buildId, buildId)).get()!;
  server.db
    .update(step)
    .set({ status: 'claimed', machineId: opts.machineId, claimedAt: 1_000 })
    .where(eq(step.id, stepRow.id))
    .run();
  server.db.update(todo).set({ phase: 'building' }).where(eq(todo.id, todoId)).run();
  if (opts.changes !== undefined) {
    server.db.update(build).set({ changes: opts.changes }).where(eq(build.id, buildId)).run();
  }
  return { projectId, todoId, buildId, stepId: stepRow.id };
}

function pushToolMsg(
  server: TestServer,
  buildId: string,
  id: string,
  name: string,
  args: Record<string, unknown>,
  createdAt: number,
  result = 'ok',
) {
  server.db
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
          result,
          isError: false,
          startedAt: createdAt,
          endedAt: createdAt,
        },
      },
    })
    .run();
}

describe('done-in-prod server lifecycle & stall-monitor integration', () => {
  test('enforces single-harness attached evidence, emits live SSE missingEvidence, preserves reportLine, and clears on done', async () => {
    s = bootServer();
    const machineId = insertMachine(s);
    seedSessionRoute(s, { provider: 'p', modelId: 'm', machineId });

    const task = await seedTask(s, {
      machineId,
      changes: [diffFile('apps/server/src/routes/probe.ts')],
    });
    const ssePayloads: {
      type?: string;
      doc?: { id?: string; phase?: string; missingEvidence?: string | null };
    }[] = [];
    const unsubscribe = s.hub.subscribe(s.team.id, {
      async send(payload) {
        ssePayloads.push(payload as (typeof ssePayloads)[number]);
      },
    });
    try {
      pushToolMsg(s, task.buildId, 't1', 'edit', { path: 'apps/server/src/routes/probe.ts' }, 100);
      pushToolMsg(
        s,
        task.buildId,
        't2',
        'bash',
        { command: 'curl -fsS http://127.0.0.1:8787/api/probe' },
        200,
        '{"ok":true}',
      );

      completeStep(depsOf(s), task.stepId, { hasChanges: true });
      expect(getTodo(depsOf(s), task.todoId)?.phase).toBe('building');
      expect(
        s.db
          .select()
          .from(step)
          .where(eq(step.buildId, task.buildId))
          .all()
          .some((r) => r.kind === 'verify'),
      ).toBe(false);

      const sseRetry = ssePayloads.findLast((p) => p.type === 'todo' && p.doc?.id === task.todoId);
      expect(sseRetry?.doc?.missingEvidence).toBeTruthy();

      const todosRes1 = await req(s.app, 'GET', '/api/todos');
      const todos1 = (await todosRes1.json()) as { id: string; missingEvidence?: string | null }[];
      expect(todos1.find((t) => t.id === task.todoId)?.missingEvidence).toBeTruthy();

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

      completeStep(depsOf(s), step2.id, { hasChanges: true });
      expect(getTodo(depsOf(s), task.todoId)?.phase).toBe('needs_input');
      expect(
        s.db.select().from(build).where(eq(build.id, task.buildId)).get()?.reportLine,
      ).toBeNull();
      expect(pendingWorkerQuestions(s.db, task.buildId)[0]?.requestId).toBe(
        `acceptance-blocked-${step2.id}`,
      );

      const tasksRes = await req(s.app, 'GET', '/api/tasks');
      const tasksBody = (await tasksRes.json()) as {
        entries: { kind: string; id?: string; missingEvidence?: string | null }[];
      };
      const taskEntry = tasksBody.entries.find((e) => e.kind === 'todo' && e.id === task.todoId);
      expect(taskEntry?.missingEvidence).toBeTruthy();

      await req(s.app, 'POST', `/api/todos/${task.todoId}/messages`, {
        content: 'Attach the probe JSON',
        clientMessageId: 'msg-attach-now',
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
      markDelivered(
        depsOf(s),
        task.buildId,
        [`acceptance-blocked-${step2.id}`],
        'session-start',
        step3.id,
      );

      const todoRow = s.db.select().from(todo).where(eq(todo.id, task.todoId)).get()!;
      const currentStep3 = s.db.select().from(step).where(eq(step.id, step3.id)).get()!;
      const attached = JSON.parse(
        attachWorkerFile(depsOf(s), currentStep3, todoRow, {
          fileName: 'probe-response.json',
          caption: 'Live probe response',
          contentBase64: Buffer.from('{"ok":true}\n').toString('base64'),
        }),
      ) as { id: string };
      expect(attached.id).toBeTruthy();
      pushToolMsg(s, task.buildId, 't3', 'attach_file', { path: 'probe-response.json' }, 4_000);

      completeStep(depsOf(s), step3.id, { hasChanges: true });
      expect(getTodo(depsOf(s), task.todoId)?.phase).toBe('done');
      expect(getTodo(depsOf(s), task.todoId)?.missingEvidence).toBeUndefined();
    } finally {
      unsubscribe();
    }
  });

  test('isolates evidence to current attempt (rejects plan-step, deliverable-scope, other-todo, and 0-byte attachments)', async () => {
    s = bootServer();
    const machineId = insertMachine(s);
    seedSessionRoute(s, { provider: 'p', modelId: 'm', machineId });

    const other = await seedTask(s, { machineId, changes: null });
    const task = await seedTask(s, {
      machineId,
      changes: [diffFile('scripts/deploy-check.mjs')],
    });
    s.db
      .insert(step)
      .values({
        id: 'plan-step-old',
        buildId: task.buildId,
        kind: 'plan',
        machineId,
        status: 'done',
        createdAt: 50,
        finishedAt: 80,
      })
      .run();

    s.db
      .insert(attachment)
      .values([
        {
          id: 'att-plan',
          teamId: s.team.id,
          todoId: task.todoId,
          sha256: 'a'.repeat(64),
          createdBy: 'step:plan-step-old',
          fileName: 'plan.txt',
          mimeType: 'text/plain',
          sizeBytes: 64,
          storageKey: `${s.team.id}/att-plan.txt`,
          grantId: 'g-plan',
          scope: 'message',
          status: 'ready',
          createdAt: 500,
        },
        {
          id: 'att-deliv',
          teamId: s.team.id,
          todoId: task.todoId,
          sha256: 'b'.repeat(64),
          createdBy: `step:${task.stepId}`,
          fileName: 'report.md',
          mimeType: 'text/plain',
          sizeBytes: 64,
          storageKey: `${s.team.id}/att-deliv.md`,
          grantId: `deliverable:${task.stepId}:1`,
          scope: 'deliverable',
          status: 'ready',
          createdAt: 500,
        },
        {
          id: 'att-other-todo',
          teamId: s.team.id,
          todoId: other.todoId,
          sha256: 'c'.repeat(64),
          createdBy: `step:${task.stepId}`,
          fileName: 'other.json',
          mimeType: 'application/json',
          sizeBytes: 64,
          storageKey: `${s.team.id}/att-other.json`,
          grantId: 'g-other',
          scope: 'message',
          status: 'ready',
          createdAt: 500,
        },
        {
          id: 'att-empty',
          teamId: s.team.id,
          todoId: task.todoId,
          sha256: 'd'.repeat(64),
          createdBy: `step:${task.stepId}`,
          fileName: 'empty.json',
          mimeType: 'application/json',
          sizeBytes: 0,
          storageKey: `${s.team.id}/att-empty.json`,
          grantId: 'g-empty',
          scope: 'message',
          status: 'ready',
          createdAt: 500,
        },
      ])
      .run();

    pushToolMsg(s, task.buildId, 'i1', 'edit', { path: 'scripts/deploy-check.mjs' }, 100);
    pushToolMsg(
      s,
      task.buildId,
      'i2',
      'bash',
      { command: 'node scripts/deploy-check.mjs' },
      200,
      'OK',
    );

    completeStep(depsOf(s), task.stepId, { hasChanges: true });
    expect(getTodo(depsOf(s), task.todoId)?.phase).toBe('building');
  });

  test('stall-monitor appends missingEvidence on stalled acceptance retries and legacy briefs backfill synthetic', async () => {
    s = bootServer();
    const machineId = insertMachine(s);
    seedSessionRoute(s, { provider: 'antigravity', modelId: 'm', machineId });
    const task = await seedTask(s, {
      machineId,
      changes: [diffFile('scripts/probe.mjs')],
    });
    pushToolMsg(s, task.buildId, 's1', 'edit', { path: 'scripts/probe.mjs' }, 100);
    pushToolMsg(s, task.buildId, 's2', 'bash', { command: 'node scripts/probe.mjs' }, 200, 'OK');
    completeStep(depsOf(s), task.stepId, { hasChanges: true });

    const nudgeStep = s.db
      .select()
      .from(step)
      .where(eq(step.buildId, task.buildId))
      .all()
      .find((r) => r.id !== task.stepId)!;
    const claimedAt = 10_000_000;
    s.db
      .update(step)
      .set({
        status: 'claimed',
        machineId,
        claimedAt,
        lastProgressAt: claimedAt,
      })
      .where(eq(step.id, nudgeStep.id))
      .run();
    s.db.transaction((tx) =>
      writeQuota(tx, nudgeStep.id, { ranModel: { provider: 'antigravity', modelId: 'm' } }),
    );

    sweepStallMonitor(depsOf(s), claimedAt + 7 * 60_000);
    const note1 = s.db
      .select()
      .from(message)
      .where(eq(message.id, `stall-recover-${nudgeStep.id}-1`))
      .get();
    expect(typeof note1?.content === 'string' ? note1.content : '').toContain('还缺：');

    s.db
      .update(step)
      .set({
        status: 'claimed',
        machineId,
        claimedAt: claimedAt + 8 * 60_000,
        lastProgressAt: claimedAt + 8 * 60_000,
      })
      .where(eq(step.id, nudgeStep.id))
      .run();
    s.db.transaction((tx) =>
      writeQuota(tx, nudgeStep.id, { ranModel: { provider: 'antigravity', modelId: 'm' } }),
    );
    sweepStallMonitor(depsOf(s), claimedAt + 16 * 60_000);
    const updatedNudge = s.db.select().from(step).where(eq(step.id, nudgeStep.id)).get()!;
    expect(updatedNudge.status).toBe('claimed');
    const msgs = s.db.select().from(message).where(eq(message.conversationId, task.buildId)).all();
    const alert2 = msgs.find((m) => m.id.startsWith(`stall-report-${nudgeStep.id}-silent_turn-`));
    expect(typeof alert2?.content === 'string' ? alert2.content : '').toContain('还缺：');

    const prevBrief = LEGACY_SESSION_BRIEFS.at(-1)!;
    const prevRework = LEGACY_SESSION_REWORK_BRIEFS[0]!;
    s.db
      .insert(message)
      .values([
        {
          id: 'legacy-brief-msg',
          conversationId: task.buildId,
          role: 'user',
          content: prevBrief,
          createdAt: 9_000,
          origin: null,
        },
        {
          id: 'legacy-rework-msg',
          conversationId: task.buildId,
          role: 'user',
          content: prevRework,
          createdAt: 9_001,
          origin: null,
        },
      ])
      .run();
    backfillTranscriptOrigins(s.db);
    expect(
      s.db.select().from(message).where(eq(message.id, 'legacy-brief-msg')).get()?.origin,
    ).toBe('synthetic');
    expect(
      s.db.select().from(message).where(eq(message.id, 'legacy-rework-msg')).get()?.origin,
    ).toBe('synthetic');
  });
});
