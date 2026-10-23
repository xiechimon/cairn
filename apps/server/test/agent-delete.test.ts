// DELETE /api/teams/{id}/agents/{aid} 语义（XMON-19 / B2）。路由 = REST 同名
// DELETE（02 §6.1 规则族 + shared DELETE_FACE 'teams/{id}/agents/{aid}'），
// wire 未采——登记 wire.test.ts INFERRED_ROUTES。
//
// canon 出处（本票实测，非转述）：原版二次确认文案直读参考产品产线 bundle
// （i18n 四语语料 agent_modal.remove/remove_title/remove_confirm/
// remove_over_quota + 通用 ConfirmProvider 行为）；删除语义直读 todos.dev 官方
// docs（/docs/agents「Removing an agent」、/docs/memory「A removed agent's
// entries stay stored but stop being used」、/docs/team「Removing an agent is
// done from the same tab」）。
//
// 关联面取舍（实现注记同文在 routes.ts）：
// · memories 本体留存（不级联）——docs 原文「Its memory is kept but no longer
//   used」+ 仓内 project 删除保记忆本体的先例；
// · todo.assignment 指向该 Agent 的槽摘除——活引用悬空会让
//   resolveStepCredentials 静默降级为空 provider/secrets（services/credentials.ts
//   agentRow null 分支），回既有「未指派」态 = 原版提示「请为该 todo 指派其他
//   Agent 后重新运行」同向；
// · chief.agentId 绑定该 Agent → null——否则 chief 步凭证解析硬 404
//   （services/credentials.ts resolveChiefStepCredentials）。
//
// 每例钉一个失败方式：
// 1. 复删不 404 —— DELETE_FACE 族律（memories/projects 同口径：204 后复删 404）。
// 2. 跨团队越权 —— 用 B 团队路径删 A 团队 Agent 成功（teamId 未参与 where）。
// 3. 读面不随行 404 —— 删后 GET 单条仍 200 说明行没删干净。
// 4. 记忆被级联删 —— 违反 docs 保留语义（数据不可恢复）。
// 5. assignment 死指针留存 —— 下次运行静默降级，用户看不到原因。
// 6. chief 绑定悬空 —— 该团队 chief 回合硬 404。
// 7. 误伤邻 Agent —— 同团队邻 Agent 的授权面被波及。

import { todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  agentMemory,
  agent as agentTable,
  chief as chiefTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { bootServer, postProject, req } from './helpers.js';

const AGENT_A = 'agent-del-a';
const AGENT_B = 'agent-del-b';

async function expectErrorShape(res: Response, status: number): Promise<void> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(['error']);
}

function seedAgent(s: ReturnType<typeof bootServer>, id: string, displayName: string): void {
  s.db.insert(agentTable).values({ id, teamId: s.team.id, displayName, modelId: 'm' }).run();
}

/** 建 todo 并以 assignment 双槽指向 agentId（走 POST builds = 真写入路径，
 * services/builds.ts setTodoPhase({assignment})）。 */
async function todoAssignedTo(
  s: ReturnType<typeof bootServer>,
  projectId: string,
  agentId: string,
): Promise<string> {
  const todo = todoRecordSchema.parse(
    await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'x', spec: '' })
    ).json(),
  );
  const started = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todo.id],
    assignment: { plan: { agentId }, build: { agentId } },
    withPlan: true,
  });
  expect(started.status).toBe(201);
  return todo.id;
}

describe('DELETE /api/teams/{id}/agents/{aid}（XMON-19）', () => {
  test('未知 agent → 404 {error}；204 后复删 → 404', async () => {
    const s = bootServer();
    await expectErrorShape(await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/nope`), 404);
    seedAgent(s, AGENT_A, 'a');
    const url = `/api/teams/${s.team.id}/agents/${AGENT_A}`;
    expect((await req(s.app, 'DELETE', url)).status).toBe(204);
    await expectErrorShape(await req(s.app, 'DELETE', url), 404);
    s.dispose();
  });

  test('删后读面 404：单条 GET 与 memories 读面同路径断', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      204,
    );
    await expectErrorShape(
      await req(s.app, 'GET', `/api/teams/${s.team.id}/agents/${AGENT_A}`),
      404,
    );
    expect(s.db.select().from(agentTable).all()).toHaveLength(0);
    s.dispose();
  });

  test('跨团队隔离：他团队路径删本团队 Agent → 404，行留存', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    await expectErrorShape(
      await req(s.app, 'DELETE', '/api/teams/other-team/agents/agent-del-a'),
      404,
    );
    expect(s.db.select().from(agentTable).all()).toHaveLength(1);
    s.dispose();
  });

  test('关联面：memories 本体留存（docs「memory is kept」），作用域列不动', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    const projectId = await postProject(s.app);
    s.db
      .insert(agentMemory)
      .values({
        id: 'mem-keep-1',
        agentId: AGENT_A,
        teamId: s.team.id,
        title: 'm',
        content: 'c',
        projectId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();

    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      204,
    );

    const mem = s.db.select().from(agentMemory).all();
    expect(mem).toHaveLength(1);
    expect(mem[0]?.agentId).toBe(AGENT_A);
    expect(mem[0]?.projectId).toBe(projectId);
    s.dispose();
  });

  test('关联面：todo.assignment 指向该 Agent 的槽摘除，人和邻 Agent 的槽不动', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    seedAgent(s, AGENT_B, 'b');
    const projectId = await postProject(s.app);
    const todoA = await todoAssignedTo(s, projectId, AGENT_A);
    const todoB = await todoAssignedTo(s, projectId, AGENT_B);

    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      204,
    );

    const rows = s.db.select().from(todoTable).all();
    const rowA = rows.find((r) => r.id === todoA);
    const rowB = rows.find((r) => r.id === todoB);
    expect(rowA?.assignment).toEqual({ plan: null, build: null });
    expect(rowB?.assignment).toEqual({ plan: { agentId: AGENT_B }, build: { agentId: AGENT_B } });
    // 任务本体与相位不动（删除 Agent 不删任务）
    expect(rowA?.phase).toBe('queued');
    expect((await req(s.app, 'GET', `/api/todos/${todoA}`)).status).toBe(200);
    s.dispose();
  });

  test('关联面：chief 绑定被删 Agent → 置 null；绑定别的 Agent 不动', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    seedAgent(s, AGENT_B, 'b');
    const chiefId = `chief-${s.user.id}-${s.team.id}`;
    s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: s.user.id,
        teamId: s.team.id,
        agentId: AGENT_A,
        createdAt: Date.now(),
      })
      .run();

    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      204,
    );
    expect(s.db.select().from(chiefTable).all()[0]?.agentId).toBeNull();

    // 反向钉点：绑定存活 Agent 时删除别的 Agent 不清绑定。
    s.db.update(chiefTable).set({ agentId: AGENT_B }).where(eq(chiefTable.id, chiefId)).run();
    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      404, // A 已删，这是 404 不是重复清绑定
    );
    expect(s.db.select().from(chiefTable).all()[0]?.agentId).toBe(AGENT_B);
    s.dispose();
  });

  test('隔离：删 A 不伤 B（邻 Agent 行与授权面原样）', async () => {
    const s = bootServer();
    seedAgent(s, AGENT_A, 'a');
    seedAgent(s, AGENT_B, 'b');
    s.db
      .update(agentTable)
      .set({ tools: ['推送分支'], secrets: ['sec-1'], mcpServers: ['mcp-1'] })
      .where(eq(agentTable.id, AGENT_B))
      .run();

    expect((await req(s.app, 'DELETE', `/api/teams/${s.team.id}/agents/${AGENT_A}`)).status).toBe(
      204,
    );

    const rows = s.db.select().from(agentTable).all();
    expect(rows.map((r) => r.id)).toEqual([AGENT_B]);
    expect(rows[0]?.tools).toEqual(['推送分支']);
    expect(rows[0]?.secrets).toEqual(['sec-1']);
    expect(rows[0]?.mcpServers).toEqual(['mcp-1']);
    s.dispose();
  });
});
