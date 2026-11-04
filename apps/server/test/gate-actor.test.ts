import { CONFIRM_ANNOUNCEMENT, DONE_ANNOUNCEMENT, MERGE_ANNOUNCEMENT } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  message as messageTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { startBuilds } from '../src/services/builds.js';
import { executeChiefTool, transitionTodos } from '../src/services/chief-tools.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

async function withConfirmTodo(): Promise<TestServer & { todoId: string; buildId: string }> {
  const s = bootServer();
  const projectId = await postProject(s.app);
  const todoDoc = (await (
    await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: '写周报', spec: '' })
  ).json()) as { id: string };
  startBuilds(s.svc, {
    projectId,
    todoIds: [todoDoc.id],
    assignment: { plan: null, build: null },
    withPlan: true,
  });
  setTodoPhase(s.svc, todoDoc.id, 'planning');
  setTodoPhase(s.svc, todoDoc.id, 'confirm');
  const row = s.db.select().from(todoTable).where(eq(todoTable.id, todoDoc.id)).get()!;
  return { ...s, todoId: todoDoc.id, buildId: row.latestBuildId! };
}

async function withReviewTodo(): Promise<TestServer & { todoId: string; buildId: string }> {
  const s = await withConfirmTodo();
  s.db
    .update(todoTable)
    .set({ phase: 'review', hasChanges: true })
    .where(eq(todoTable.id, s.todoId))
    .run();
  return s;
}

function seedChiefAgent(s: TestServer, displayName = '总管'): string {
  const id = 'agent-chief-1';
  s.db.insert(agentTable).values({ id, teamId: s.team.id, displayName, status: 'active' }).run();
  return id;
}

function rowsOf(s: TestServer, conversationId: string) {
  return s.db
    .select()
    .from(messageTable)
    .where(eq(messageTable.conversationId, conversationId))
    .all();
}

function chiefCtx(s: TestServer, chiefAgentId: string | null) {
  return {
    teamId: s.team.id,
    userId: s.user.id,
    chiefId: 'chief-x',
    threadId: 'thread-x',
    chiefAgentId,
    conversationId: 'conv-x',
  };
}

function chiefDeps(s: TestServer) {
  return {
    db: s.db,
    hub: s.hub,
    machineHub: s.machineHub,
    box: s.secretBox,
    user: s.user,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    skillsDir: s.skillsDir,
  };
}

async function runChiefTool(
  s: TestServer,
  chiefAgentId: string | null,
  name: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const text = await executeChiefTool(chiefDeps(s), chiefCtx(s, chiefAgentId), name, params);
  return JSON.parse(text);
}

describe('#902 gate-passing action records the actor (announcement row)', () => {
  test('failure modes 1/2: steps confirm -> transcript lands the confirm row, actor = user displayName', async () => {
    const s = await withConfirmTodo();
    try {
      const res = await req(s.app, 'POST', `/api/builds/${s.buildId}/steps`, {
        action: 'confirm',
      });
      expect(res.status).toBe(202);
      const row = rowsOf(s, s.buildId).find((m) => m.content === CONFIRM_ANNOUNCEMENT);
      expect(row, 'confirm row must exist').toBeDefined();
      expect(row?.role).toBe('user');
      expect(row?.actor).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('failure mode 3: chief confirm_builds -> confirm row actor = chief Agent displayName (not recorded as the user name)', async () => {
    const s = await withConfirmTodo();
    try {
      const agentId = seedChiefAgent(s, '总管甲');
      const out = (await runChiefTool(s, agentId, 'confirm_builds', {
        buildIds: [s.buildId],
      })) as Record<string, unknown>;
      expect(out).toBeDefined();
      const row = rowsOf(s, s.buildId).find((m) => m.content === CONFIRM_ANNOUNCEMENT);
      expect(row, 'confirm row must exist').toBeDefined();
      expect(row?.actor).toBe('总管甲');
      expect(row?.actor).not.toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('failure mode 2: REST merge -> merge announcement row carries the actor (existing row family filled in)', async () => {
    const s = await withReviewTodo();
    try {
      const res = await req(s.app, 'POST', `/api/builds/${s.buildId}/merge`);
      expect(res.status).toBe(202);
      const row = rowsOf(s, s.buildId).find((m) => m.content === MERGE_ANNOUNCEMENT);
      expect(row, 'merge announcement row must exist').toBeDefined();
      expect(row?.actor).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('failure modes 4/5: GET messages wire exposes the actor; old rows (actor NULL) compatible as null', async () => {
    const s = await withConfirmTodo();
    try {
      s.db
        .insert(messageTable)
        .values({
          id: 'msg-legacy-1',
          conversationId: s.buildId,
          role: 'user',
          content: '旧行',
          createdAt: 1,
        })
        .run();
      await req(s.app, 'POST', `/api/builds/${s.buildId}/steps`, { action: 'confirm' });
      const res = await req(s.app, 'GET', `/api/conversations/${s.buildId}/messages`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        messages: { content: unknown; actor?: string | null }[];
      };
      const legacy = body.messages.find((m) => m.content === '旧行');
      const confirmRow = body.messages.find((m) => m.content === CONFIRM_ANNOUNCEMENT);
      expect(legacy?.actor ?? null).toBeNull();
      expect(confirmRow?.actor).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });
});

describe('#900 chief may not self-pass the review gate (complete_todos)', () => {
  test('failure modes 6/7: chief complete_todos review->done refused -- phase unchanged, receipt carries the refusal reason', async () => {
    const s = await withReviewTodo();
    try {
      const agentId = seedChiefAgent(s);
      const out = (await runChiefTool(s, agentId, 'complete_todos', {
        todoIds: [s.todoId],
      })) as { transitioned: string[]; skipped: string[]; reasons?: Record<string, string> };
      expect(out.transitioned).not.toContain(s.todoId);
      expect(out.skipped).toContain(s.todoId);
      expect(
        out.reasons?.[s.todoId],
        'refusal reason must be readable (the chief uses it to wake a human)',
      ).toBeTruthy();
      const row = s.db.select().from(todoTable).where(eq(todoTable.id, s.todoId)).get()!;
      expect(row.phase).toBe('review');
      expect(rowsOf(s, s.buildId).find((m) => m.content === DONE_ANNOUNCEMENT)).toBeUndefined();
    } finally {
      s.dispose();
    }
  });

  test('failure mode 8: user identity (same semantics as MCP key owner) complete_todos review->done allowed + actor row landed', async () => {
    const s = await withReviewTodo();
    try {
      const out = transitionTodos(chiefDeps(s), s.team.id, [s.todoId], 'done', {
        kind: 'user',
        name: s.user.displayName,
      });
      expect(out.transitioned).toContain(s.todoId);
      const row = s.db.select().from(todoTable).where(eq(todoTable.id, s.todoId)).get()!;
      expect(row.phase).toBe('done');
      const doneRow = rowsOf(s, s.buildId).find((m) => m.content === DONE_ANNOUNCEMENT);
      expect(doneRow, 'done audit row must exist').toBeDefined();
      expect(doneRow?.actor).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('failure mode 9: chief close_todos allowed as usual (the gate only bites done; close takes the legal funnel edge todo->closed)', async () => {
    const s = await withConfirmTodo();
    try {
      s.db.update(todoTable).set({ phase: 'todo' }).where(eq(todoTable.id, s.todoId)).run();
      const agentId = seedChiefAgent(s);
      const out = (await runChiefTool(s, agentId, 'close_todos', {
        todoIds: [s.todoId],
      })) as { transitioned: string[]; skipped: string[] };
      expect(out.transitioned).toContain(s.todoId);
      const row = s.db.select().from(todoTable).where(eq(todoTable.id, s.todoId)).get()!;
      expect(row.phase).toBe('closed');
    } finally {
      s.dispose();
    }
  });

  test('chief complete_todos with a cross-team id still records skipped (existing defense-in-depth does not drift with the gate)', async () => {
    const s = await withReviewTodo();
    try {
      const agentId = seedChiefAgent(s);
      const out = (await runChiefTool(s, agentId, 'complete_todos', {
        todoIds: ['todo-other-team'],
      })) as { transitioned: string[]; skipped: string[] };
      expect(out.skipped).toContain('todo-other-team');
      expect(out.transitioned).toHaveLength(0);
    } finally {
      s.dispose();
    }
  });
});

describe('#901 manual phase change confirm/review->done audit rows (server surface)', () => {
  test('failure mode 10: PATCH review->done -> 200 + done row carries the actor (raw PATCH also has a trace)', async () => {
    const s = await withReviewTodo();
    try {
      const res = await req(s.app, 'PATCH', `/api/todos/${s.todoId}`, { phase: 'done' });
      expect(res.status).toBe(200);
      const row = rowsOf(s, s.buildId).find((m) => m.content === DONE_ANNOUNCEMENT);
      expect(row, 'done audit row must exist').toBeDefined();
      expect(row?.actor).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('failure mode 10: PATCH confirm->done also lands a row (both gates bite)', async () => {
    const s = await withConfirmTodo();
    try {
      const res = await req(s.app, 'PATCH', `/api/todos/${s.todoId}`, { phase: 'done' });
      expect(res.status).toBe(200);
      const row = rowsOf(s, s.buildId).find((m) => m.content === DONE_ANNOUNCEMENT);
      expect(row, 'done audit row must exist').toBeDefined();
      expect(row?.actor).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('failure mode 11: PATCH todo->done (non-gate phase cleanup) lands no row -- other drags unchanged', async () => {
    const s = await withConfirmTodo();
    try {
      s.db.update(todoTable).set({ phase: 'todo' }).where(eq(todoTable.id, s.todoId)).run();
      const res = await req(s.app, 'PATCH', `/api/todos/${s.todoId}`, { phase: 'done' });
      expect(res.status).toBe(200);
      expect(rowsOf(s, s.buildId).find((m) => m.content === DONE_ANNOUNCEMENT)).toBeUndefined();
    } finally {
      s.dispose();
    }
  });

  test('failure mode 12: review card without latestBuildId -> PATCH done succeeds, no row, no 500', async () => {
    const s = await withReviewTodo();
    try {
      s.db.update(todoTable).set({ latestBuildId: null }).where(eq(todoTable.id, s.todoId)).run();
      const res = await req(s.app, 'PATCH', `/api/todos/${s.todoId}`, { phase: 'done' });
      expect(res.status).toBe(200);
      const body = s.db.select().from(buildTable).where(eq(buildTable.todoId, s.todoId)).all();
      for (const b of body) {
        expect(rowsOf(s, b.id).find((m) => m.content === DONE_ANNOUNCEMENT)).toBeUndefined();
      }
    } finally {
      s.dispose();
    }
  });
});

describe('#1403 G9 confirm on a build that is not at the confirm gate', () => {
  test('G4 chief confirm_builds on a review build -> refused, no passed-confirm row, phase unchanged', async () => {
    const s = await withReviewTodo();
    try {
      const agentId = seedChiefAgent(s);
      await expect(
        runChiefTool(s, agentId, 'confirm_builds', { buildIds: [s.buildId] }),
      ).rejects.toThrow(/待确认（confirm）关口，当前相位 review/);
      expect(rowsOf(s, s.buildId).some((m) => m.content === CONFIRM_ANNOUNCEMENT)).toBe(false);
      const row = s.db.select().from(todoTable).where(eq(todoTable.id, s.todoId)).get();
      expect(row?.phase).toBe('review');
    } finally {
      s.dispose();
    }
  });

  test('G6 a second confirm on a todo already in building → 409, no second row, no second build step', async () => {
    const s = await withConfirmTodo();
    try {
      const first = await req(s.app, 'POST', `/api/builds/${s.buildId}/steps`, {
        action: 'confirm',
      });
      expect(first.status).toBe(202);
      const second = await req(s.app, 'POST', `/api/builds/${s.buildId}/steps`, {
        action: 'confirm',
      });
      expect(second.status).toBe(409);
      const rows = rowsOf(s, s.buildId).filter((m) => m.content === CONFIRM_ANNOUNCEMENT);
      expect(rows).toHaveLength(1);
      const buildSteps = s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, s.buildId))
        .all()
        .filter((st) => st.kind === 'build');
      expect(buildSteps).toHaveLength(1);
    } finally {
      s.dispose();
    }
  });

  test('G7 confirm on a queued todo (direct execution, no confirm gate) → 409, no row, no build step', async () => {
    const s = await withConfirmTodo();
    try {
      s.db.update(todoTable).set({ phase: 'queued' }).where(eq(todoTable.id, s.todoId)).run();
      const res = await req(s.app, 'POST', `/api/builds/${s.buildId}/steps`, {
        action: 'confirm',
      });
      expect(res.status).toBe(409);
      expect(rowsOf(s, s.buildId).some((m) => m.content === CONFIRM_ANNOUNCEMENT)).toBe(false);
      const buildSteps = s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, s.buildId))
        .all()
        .filter((st) => st.kind === 'build');
      expect(buildSteps).toEqual([]);
      expect(s.db.select().from(todoTable).where(eq(todoTable.id, s.todoId)).get()?.phase).toBe(
        'queued',
      );
    } finally {
      s.dispose();
    }
  });

  test('G4 REST steps confirm on a review build -> 409, no passed-confirm row', async () => {
    const s = await withReviewTodo();
    try {
      const res = await req(s.app, 'POST', `/api/builds/${s.buildId}/steps`, {
        action: 'confirm',
      });
      expect(res.status).toBe(409);
      expect(rowsOf(s, s.buildId).some((m) => m.content === CONFIRM_ANNOUNCEMENT)).toBe(false);
    } finally {
      s.dispose();
    }
  });
});
