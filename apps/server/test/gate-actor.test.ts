// #902/#900/#901 过闸 actor 审计 + chief 闸禁 + 手动 done 落地审计行。
// 失败方式清单（先固化，代码是让场景通过的手段）：
//  #902（过闸动作记 actor）：
//   1. steps {action:'confirm'} 后 transcript 无确认行——闸被按过零痕迹，
//      「人强制在场」只能是推断；
//   2. 行在但 actor 空/不可读——库里答不出「在场的是谁」；
//   3. chief 发起的过闸动作记成用户名——审计撒谎（chief confirm_builds /
//      complete_todos 与人的动作在库里不可分 = #892 实证 #14 的病灶）；
//   4. GET messages wire 丢 actor——落了库但呈现层拿不到（路由显式列映射）；
//   5. 旧行（actor 列 NULL）过 wire 校验崩——nullish 兼容，存量部署可读。
//  #900（chief 不得自过 review 闸）：
//   6. chief complete_todos 把 review 卡直接推 done——无 merge 步、无人到场，
//      8 秒自过闸（#892 #14 铁证）必须拒；
//   7. 拒了但 chief 拿不到原因——LLM 无法转而唤醒人（拒因要进 tool 回执）；
//   8. MCP 面（key 属主 = 用户身份）complete_todos review→done 被误拒——
//      合法写面收窄（身份语义差：chief = agent，MCP key = user）；
//   9. close_todos / reopen_todos 被闸误伤——闸只咬 done 落地，closed/todo
//      不是过闸动作。
//  #901（手动 confirm/review→done 审计行，server 面；弹层在 web e2e）：
//   10. PATCH phase confirm/review→done 零审计行——88% done 落地通道
//       （#892 15/17）继续无痕（raw PATCH 绕过弹层也必须有行）；
//   11. 非闸相位拖 done（todo→done 测试卡清理）也落行——「其余拖拽不变」，
//       行只挂闸相位来源；
//   12. 闸相位卡无 latestBuildId——行无处落但不得 500（改相本身要成功）。

import { CONFIRM_ANNOUNCEMENT, DONE_ANNOUNCEMENT, MERGE_ANNOUNCEMENT } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  message as messageTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { startBuilds } from '../src/services/builds.js';
import { executeChiefTool, transitionTodos } from '../src/services/chief-tools.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

/** 服务面直驱到 confirm（phase-funnel.test 同款）：startBuilds → planning →
 *  confirm；返回带 todoId/buildId 的栈。 */
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

/** 直驱到 review 关口（db 直改相位 + hasChanges——漏斗无 confirm→review 边，
 *  manual-drop-matrix.test 同款手法）；build 会话在（startBuilds 已建）。 */
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

describe('#902 过闸动作记 actor（announcement 行）', () => {
  test('失败方式 1/2：steps confirm → transcript 落确认行，actor = 用户 displayName', async () => {
    const s = await withConfirmTodo();
    try {
      const res = await req(s.app, 'POST', `/api/builds/${s.buildId}/steps`, {
        action: 'confirm',
      });
      expect(res.status).toBe(202);
      const row = rowsOf(s, s.buildId).find((m) => m.content === CONFIRM_ANNOUNCEMENT);
      expect(row, '确认行必须存在').toBeDefined();
      expect(row?.role).toBe('user');
      expect(row?.actor).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('失败方式 3：chief confirm_builds → 确认行 actor = chief Agent displayName（不记成用户名）', async () => {
    const s = await withConfirmTodo();
    try {
      const agentId = seedChiefAgent(s, '总管甲');
      const out = (await runChiefTool(s, agentId, 'confirm_builds', {
        buildIds: [s.buildId],
      })) as Record<string, unknown>;
      expect(out).toBeDefined();
      const row = rowsOf(s, s.buildId).find((m) => m.content === CONFIRM_ANNOUNCEMENT);
      expect(row, '确认行必须存在').toBeDefined();
      expect(row?.actor).toBe('总管甲');
      expect(row?.actor).not.toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('失败方式 2：REST merge → 合并宣告行带 actor（既有行族补齐）', async () => {
    const s = await withReviewTodo();
    try {
      const res = await req(s.app, 'POST', `/api/builds/${s.buildId}/merge`);
      expect(res.status).toBe(202);
      const row = rowsOf(s, s.buildId).find((m) => m.content === MERGE_ANNOUNCEMENT);
      expect(row, '合并宣告行必须存在').toBeDefined();
      expect(row?.actor).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('失败方式 4/5：GET messages wire 透出 actor；旧行（actor NULL）兼容为 null', async () => {
    const s = await withConfirmTodo();
    try {
      // 造一条无 actor 的存量行（迁移前的旧数据形态）。
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

describe('#900 chief 不得自过 review 闸（complete_todos）', () => {
  test('失败方式 6/7：chief complete_todos review→done 被拒——相位不动、回执带拒因', async () => {
    const s = await withReviewTodo();
    try {
      const agentId = seedChiefAgent(s);
      const out = (await runChiefTool(s, agentId, 'complete_todos', {
        todoIds: [s.todoId],
      })) as { transitioned: string[]; skipped: string[]; reasons?: Record<string, string> };
      expect(out.transitioned).not.toContain(s.todoId);
      expect(out.skipped).toContain(s.todoId);
      expect(out.reasons?.[s.todoId], '拒因必须可读（chief 据此唤醒人）').toBeTruthy();
      const row = s.db.select().from(todoTable).where(eq(todoTable.id, s.todoId)).get()!;
      expect(row.phase).toBe('review');
      // 被拒的落地不得留审计行（没有发生的事不进时间线）。
      expect(rowsOf(s, s.buildId).find((m) => m.content === DONE_ANNOUNCEMENT)).toBeUndefined();
    } finally {
      s.dispose();
    }
  });

  test('失败方式 8：用户身份（MCP key 属主同语义）complete_todos review→done 放行 + 落 actor 行', async () => {
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
      expect(doneRow, 'done 落地审计行必须存在').toBeDefined();
      expect(doneRow?.actor).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('失败方式 9：chief close_todos 照常放行（闸只咬 done；close 走漏斗合法边 todo→closed）', async () => {
    const s = await withConfirmTodo();
    try {
      // 漏斗里 closed 只从 todo/failed 可达（PHASE_TRANSITIONS），先落回 todo。
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

  test('chief complete_todos 跨团队 id 仍记 skipped（既有纵深防御不因闸漂移）', async () => {
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

describe('#901 手动改相 confirm/review→done 审计行（server 面）', () => {
  test('失败方式 10：PATCH review→done → 200 + done 行带 actor（raw PATCH 同样有痕）', async () => {
    const s = await withReviewTodo();
    try {
      const res = await req(s.app, 'PATCH', `/api/todos/${s.todoId}`, { phase: 'done' });
      expect(res.status).toBe(200);
      const row = rowsOf(s, s.buildId).find((m) => m.content === DONE_ANNOUNCEMENT);
      expect(row, 'done 审计行必须存在').toBeDefined();
      expect(row?.actor).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('失败方式 10：PATCH confirm→done 同样落行（两道闸都咬）', async () => {
    const s = await withConfirmTodo();
    try {
      // confirm→done 是手动矩阵合法边（canBoardDrop），漏斗非法但 PATCH 面放行。
      const res = await req(s.app, 'PATCH', `/api/todos/${s.todoId}`, { phase: 'done' });
      expect(res.status).toBe(200);
      const row = rowsOf(s, s.buildId).find((m) => m.content === DONE_ANNOUNCEMENT);
      expect(row, 'done 审计行必须存在').toBeDefined();
      expect(row?.actor).toBe(s.user.displayName);
    } finally {
      s.dispose();
    }
  });

  test('失败方式 11：PATCH todo→done（非闸相位清理）不落行——其余拖拽不变', async () => {
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

  test('失败方式 12：review 卡无 latestBuildId → PATCH done 成功、无行、不 500', async () => {
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

describe('#1403 G9 review 关口误调 confirm', () => {
  test('steps confirm at review → 409，transcript 不落确认行', async () => {
    const s = await withReviewTodo();
    try {
      const res = await req(s.app, 'POST', `/api/builds/${s.buildId}/steps`, {
        action: 'confirm',
      });
      expect(res.status).toBe(409);
      const row = rowsOf(s, s.buildId).find((m) => m.content === CONFIRM_ANNOUNCEMENT);
      expect(row, '相位不对时不得留下确认行').toBeUndefined();
      const todoRow = s.db.select().from(todoTable).where(eq(todoTable.id, s.todoId)).get()!;
      expect(todoRow.phase).toBe('review');
    } finally {
      s.dispose();
    }
  });
});
