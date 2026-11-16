import {
  CHIEF_NOTICE_KIND,
  newChiefThreadId,
  orchestrationSourceRef,
  REPORT_ACK_KIND,
} from '@cairn/shared';
import { and, eq, like } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  attachment as attachmentTable,
  chiefMessage,
  chiefThread,
  project as projectTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newRecordId, newUuidv7, nowMs } from '../src/lib/ids.js';
import { ATTACHMENT_ORPHAN_GRACE_MS, sweepAttachments } from '../src/services/attachment-gc.js';
import { coordinatorThreadRow, ensureChief, removeChiefWatches } from '../src/services/chief.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { storeInfoReport } from '../src/services/info-handoff.js';
import { reconcileOwners } from '../src/services/owner.js';
import { deleteProject } from '../src/services/projects.js';
import { getTodo, setTodoPhase } from '../src/services/todos.js';
import { ctx, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { seedOwnerMessage } from './owner-message.js';

registerChiefHarness();

const deps = () => ({ ...H.s.svc, reposDir: H.s.reposDir, box: H.s.secretBox });
const researchId = () => `research-${H.teamId}`;
const researchRow = () =>
  H.s.db.select().from(projectTable).where(eq(projectTable.id, researchId())).get();
const todos = () => H.s.db.select().from(todoTable).all();
const quiet = { warn: () => {}, info: () => {}, debug: () => {} };

function openSource(): string {
  const main = coordinatorThreadRow(deps(), ensureChief(deps(), H.teamId));
  const id = newChiefThreadId(newUuidv7());
  H.s.db
    .insert(chiefThread)
    .values({ ...main, id, projectId: H.projectId, title: 'demo channel' })
    .run();
  return id;
}

async function ask(threadId: string, params: Record<string, unknown> = { output: 'info' }) {
  const messageId = seedOwnerMessage(H.s.db, threadId, '查一下 SQLite WAL 文件能涨到多大');
  return (await relay(
    'create_todo',
    { ...params, messageIds: [messageId] },
    { threadId, conversationId: threadId },
  )) as { id: string; projectId: string; buildId: string };
}

function settleSteps(buildId: string) {
  H.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.buildId, buildId)).run();
}

function deliver(task: { id: string; buildId: string }) {
  settleSteps(task.buildId);
  const attachmentId = storeInfoReport(
    { db: H.s.db, attachmentsDir: H.s.attachmentsDir },
    { buildId: task.buildId, teamId: H.teamId, createdBy: H.userId, report: '# WAL\n没有硬上限' },
  );
  setTodoPhase(deps(), task.id, 'building');
  setTodoPhase(deps(), task.id, 'review');
  reconcileOwners(deps());
  return attachmentId;
}

const reportWakes = (todoId: string) =>
  H.s.db
    .select()
    .from(stepTable)
    .where(and(eq(stepTable.kind, 'chief'), like(stepTable.prompt, `%report:${todoId}%`)))
    .all();

const rowsOf = (kind: string) =>
  H.s.db
    .select()
    .from(chiefMessage)
    .all()
    .filter((row) => typeof row.content === 'string' && row.content.includes(`"${kind}"`));

const turnCall = (turn: typeof stepTable.$inferSelect, name: string, params: object) =>
  executeChiefTool(
    toolDeps(),
    ctx({ threadId: turn.buildId, conversationId: turn.buildId, turnPrompt: turn.prompt ?? '' }),
    name,
    params as Record<string, unknown>,
  );

describe('info work that belongs to no project lands in the research project', () => {
  test('the first info todo without a project creates the research project and watches the asking conversation', async () => {
    const src = openSource();
    const task = await ask(src);
    expect(task.projectId).toBe(researchId());
    expect(researchRow()).toMatchObject({
      name: '调研',
      teamId: H.teamId,
      repoKind: null,
      githubRepo: null,
      localPath: null,
      archivedAt: null,
    });
    expect(getTodo(deps(), task.id)).toMatchObject({
      projectId: researchId(),
      output: 'info',
      sourceKind: 'orchestration',
      sourceRef: orchestrationSourceRef(src),
    });
    expect(
      ensureChief(deps(), H.teamId)
        .watches.filter((w) => w.todoId === task.id)
        .map((w) => w.threadId),
    ).toEqual([src]);
  });

  test('two first calls in parallel share one research project', async () => {
    const src = openSource();
    const [a, b] = await Promise.all([ask(src), ask(src)]);
    expect(
      H.s.db.select().from(projectTable).where(like(projectTable.id, 'research-%')).all(),
    ).toHaveLength(1);
    expect([a.projectId, b.projectId]).toEqual([researchId(), researchId()]);
  });

  test.each([
    ['belongs to another team', 'other'],
    ['holds a repository', 'repo'],
    ['is archived', 'archived'],
  ] as const)('a research project row that %s refuses the todo with 409', async (_, state) => {
    if (state === 'other') {
      H.s.db
        .insert(teamTable)
        .values({ id: 'team-other', name: 'other', createdAt: nowMs() })
        .run();
    }
    H.s.db
      .insert(projectTable)
      .values({
        id: researchId(),
        name: 'kept name',
        teamId: state === 'other' ? 'team-other' : H.teamId,
        ...(state === 'repo' ? { repoKind: 'github' as const, githubRepo: 'o/r' } : {}),
        ...(state === 'archived' ? { archivedAt: nowMs() } : {}),
      })
      .run();
    await expect(ask(openSource())).rejects.toMatchObject({
      status: 409,
      reason: 'research-project-unavailable',
    });
    expect(todos()).toEqual([]);
    expect(researchRow()?.name).toBe('kept name');
  });

  test.each([
    ['no output', {}],
    ['output code', { output: 'code' }],
  ])('a todo without a project and with %s is refused with 400', async (_, params) => {
    await expect(ask(openSource(), params)).rejects.toMatchObject({ status: 400 });
    expect(todos()).toEqual([]);
    expect(researchRow()).toBeUndefined();
  });

  test('a deleted research project takes its todos with it and comes back empty', async () => {
    const src = openSource();
    const first = await ask(src);
    settleSteps(first.buildId);
    expect(deleteProject(deps(), researchId())).toBe(true);
    expect(getTodo(deps(), first.id)).toBeNull();
    const again = await ask(src);
    expect(again.projectId).toBe(researchId());
    expect(todos().map((row) => row.id)).toEqual([again.id]);
  });
});

describe('a research report goes back to the conversation that asked', () => {
  test('the report wake targets the asking conversation', async () => {
    const src = openSource();
    const task = await ask(src);
    deliver(task);
    expect(reportWakes(task.id).map((row) => row.buildId)).toEqual([src]);
  });

  test('the asking conversation stays the target after its watch is gone', async () => {
    const src = openSource();
    const task = await ask(src);
    removeChiefWatches(deps(), H.teamId, [task.id]);
    deliver(task);
    expect(reportWakes(task.id).map((row) => row.buildId)).toEqual([src]);
  });

  test.each(['archived', 'deleted'] as const)(
    'an asking conversation %s before delivery gets nothing, and nothing falls back to the main conversation',
    async (state) => {
      const src = openSource();
      const task = await ask(src);
      removeChiefWatches(deps(), H.teamId, [task.id]);
      if (state === 'archived') {
        H.s.db
          .update(chiefThread)
          .set({ archivedAt: nowMs() })
          .where(eq(chiefThread.id, src))
          .run();
      } else {
        H.s.db.delete(chiefThread).where(eq(chiefThread.id, src)).run();
      }
      deliver(task);
      expect(reportWakes(task.id)).toEqual([]);
      expect(
        rowsOf('thread-report').filter((row) => String(row.content).includes(task.id)),
      ).toEqual([]);
      expect(getTodo(deps(), task.id)?.phase).toBe('review');
    },
  );

  test('accepting the report in its own turn starts no second turn in that conversation', async () => {
    const src = openSource();
    const task = await ask(src);
    deliver(task);
    const [turn] = reportWakes(task.id);
    await turnCall(turn!, 'notify_user', {
      message: 'WAL 没有硬上限',
      provenance: `report:${task.id}`,
    });
    await turnCall(turn!, 'complete_todos', { todoIds: [task.id] });
    expect(getTodo(deps(), task.id)?.phase).toBe('done');
    const after = H.s.db
      .select()
      .from(stepTable)
      .where(and(eq(stepTable.kind, 'chief'), eq(stepTable.buildId, src)))
      .all();
    expect(after.map((row) => row.id)).toEqual([turn!.id]);
  });

  test('chat rows never keep the report file alive; only the read of it does, until that conversation goes', async () => {
    const src = openSource();
    const task = await ask(src);
    const attachmentId = deliver(task);
    const [turn] = reportWakes(task.id);
    await turnCall(turn!, 'attachment', { attachmentId });
    H.s.db
      .insert(chiefMessage)
      .values({
        id: newRecordId(),
        threadId: src,
        role: 'assistant',
        content: JSON.stringify({
          kind: 'toolcall',
          name: 'attachment',
          arguments: { attachmentId },
          result: '# WAL',
        }),
        createdAt: nowMs(),
      })
      .run();
    await turnCall(turn!, 'notify_user', {
      message: `结论见 ${attachmentId}`,
      provenance: `report:${task.id}`,
    });
    await turnCall(turn!, 'complete_todos', { todoIds: [task.id] });
    for (const row of [...rowsOf(CHIEF_NOTICE_KIND), ...rowsOf(REPORT_ACK_KIND)]) {
      expect(row.content).not.toContain(attachmentId);
    }
    expect(deleteProject(deps(), researchId())).toBe(true);
    const later = nowMs() + ATTACHMENT_ORPHAN_GRACE_MS + 1;
    const gc = { db: H.s.db, attachmentsDir: H.s.attachmentsDir, logger: quiet };
    const alive = () =>
      H.s.db.select().from(attachmentTable).where(eq(attachmentTable.id, attachmentId)).get();
    sweepAttachments(gc, later);
    expect(alive()).toBeDefined();
    H.s.db.delete(chiefThread).where(eq(chiefThread.id, src)).run();
    sweepAttachments(gc, later);
    expect(alive()).toBeUndefined();
  });
});
