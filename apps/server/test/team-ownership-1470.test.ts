// #1470：#1466 之后剩下的团队归属缺口。单团队部署下不可触发；本文件直插
// 第二个团队造出触发面（project-team-guard.test.ts 同法）。
// 失败方式（先于实现固化）：
//  U1 MCP run_builds：本队任务指向他队项目——build 建在他队项目上，claim 载荷
//     带他队仓库 + 本队 GitHub 凭证。混合列表里排在前面的本队任务先被派出。
//  U2 MCP schedule_todo：同一种行建出一条指向他队项目的定时。
//  U3 MCP conversation：任意 build id / chief thread id 都读得到全文。
//  U4 chief usage：读到全部 token_usage 行（他队 build、他队 chief 回合）。
//  U5 chief / worker save_memory：projectId / sourceTodoId 指向他队或不存在的
//     行照样落库。
//  U6 clone URL：存量 githubRepo 不合法（`../user`）时仍拼出
//     `https://github.com/../user.git`，claim 载荷与项目记录都带它。
//  U7 同团队路径不变。
//  U8 MCP run_builds：assignment 指派他队 Agent——他队机器领到本队仓库与凭证。
//  U9 chief 信封 context.tokens：累加全部 `chief-%` 行（他队 chief 回合也算）。

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  agentMemory,
  agent as agentTable,
  build as buildTable,
  chiefMessage,
  chiefThread,
  message as messageTable,
  project as projectTable,
  schedule as scheduleTable,
  team as teamTable,
  todo as todoTable,
  tokenUsage,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { getChiefEnvelope } from '../src/services/chief.js';
import { executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import { hasRepoBinding, projectRepoRef, toProjectRecord } from '../src/services/git.js';
import { executeMcpTool } from '../src/services/mcp-face.js';
import { AGENT_ID, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';

registerChiefHarness();

const TEAM_B = 'team-b-1470';
const PROJ_B = 'proj-b-1470';
const TASK_B = 'todo-b-1470';
const BUILD_B = 'build-b-1470';
const THREAD_B = 'chief-b-1470';
const MISSING = 'missing-1470';
/** 本队任务、他队项目（#1466 前 create_todo 可造的存量异常行）。 */
const CROSS = 'todo-cross-1470';
const OWN_TASK = 'todo-own-1470';
const OWN_BUILD = 'build-own-1470';

function insertTodo(id: string, teamId: string, projectId: string, seqNum: number): void {
  H.s.db
    .insert(todoTable)
    .values({ id, teamId, projectId, title: id, spec: '', phase: 'todo', phaseAt: nowMs(), seqNum })
    .run();
}

function insertBuild(id: string, todoId: string): void {
  H.s.db
    .insert(buildTable)
    .values({ id, todoId, withPlan: false, triggerSource: 'user', createdAt: nowMs() })
    .run();
}

function insertUsage(buildId: string, input: number): void {
  H.s.db.insert(tokenUsage).values({ buildId, model: 'stub/m', input }).run();
}

beforeEach(() => {
  const now = nowMs();
  H.s.db.insert(teamTable).values({ id: TEAM_B, name: 'B', createdAt: now }).run();
  H.s.db
    .insert(projectTable)
    .values({ id: PROJ_B, name: 'beta', teamId: TEAM_B, repoKind: 'github', githubRepo: 'b/beta' })
    .run();
  insertTodo(TASK_B, TEAM_B, PROJ_B, 1);
  insertTodo(CROSS, H.teamId, PROJ_B, 900);
  insertTodo(OWN_TASK, H.teamId, H.projectId, 901);
  insertBuild(BUILD_B, TASK_B);
  insertBuild(OWN_BUILD, OWN_TASK);
  H.s.db
    .insert(messageTable)
    .values({
      id: 'msg-b',
      conversationId: BUILD_B,
      role: 'user',
      content: '他队对话',
      createdAt: now,
    })
    .run();
  H.s.db
    .insert(messageTable)
    .values({
      id: 'msg-a',
      conversationId: OWN_BUILD,
      role: 'user',
      content: '本队对话',
      createdAt: now,
    })
    .run();
  H.s.db
    .insert(chiefThread)
    .values({
      id: THREAD_B,
      chiefId: `chief-u-${TEAM_B}`,
      userId: H.userId,
      teamId: TEAM_B,
      title: '他队 chief',
      createdAt: now,
      updatedAt: now,
      sessionId: '',
      sessionOpenedAt: now,
    })
    .run();
  H.s.db
    .insert(chiefMessage)
    .values({
      id: 'cmsg-b',
      threadId: THREAD_B,
      role: 'user',
      content: '他队 chief 对话',
      createdAt: now,
    })
    .run();
  H.s.db
    .insert(chiefMessage)
    .values({
      id: 'cmsg-a',
      threadId: H.threadId,
      role: 'user',
      content: '本队 chief 对话',
      createdAt: now,
    })
    .run();
  insertUsage(OWN_BUILD, 1);
  insertUsage(H.threadId, 2);
  insertUsage(BUILD_B, 100);
  insertUsage(THREAD_B, 200);
});

const ALL_GRANTS = new Set(['Run Builds', 'Schedule Todo', 'Conversation']);

async function mcp(name: string, args: Record<string, unknown>): Promise<unknown> {
  return JSON.parse(
    await executeMcpTool(
      toolDeps(),
      { teamId: H.teamId, user: H.s.user, grants: ALL_GRANTS },
      name,
      args,
    ),
  );
}

async function rejection(p: Promise<unknown>): Promise<HttpError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

/** schedules 只收整刻钟分钟位（0/15/30/45）。 */
function nextQuarter(): number {
  return Math.ceil((nowMs() + 3_600_000) / 900_000) * 900_000;
}

function buildsOf(todoId: string): number {
  return H.s.db.select().from(buildTable).where(eq(buildTable.todoId, todoId)).all().length;
}

function schedulesOf(todoId: string): number {
  return H.s.db.select().from(scheduleTable).where(eq(scheduleTable.todoId, todoId)).all().length;
}

function memoryCount(): number {
  return H.s.db.select().from(agentMemory).all().length;
}

describe('#1470 MCP run_builds / schedule_todo：任务所指项目也核团队', () => {
  const assignment = { build: { agentId: AGENT_ID } };

  test('U1 run_builds：本队任务指向他队项目 → 404 project，一个 build 都不建', async () => {
    const err = await rejection(mcp('run_builds', { todoIds: [CROSS], assignment }));
    expect(err.status).toBe(404);
    expect(err.message).toBe(`project ${PROJ_B}`);
    expect(buildsOf(CROSS)).toBe(0);
  });

  test('U1 run_builds 混合列表：排在前面的本队任务也不先派出', async () => {
    const own = H.s.db.select().from(todoTable).where(eq(todoTable.id, OWN_TASK)).get();
    const before = buildsOf(OWN_TASK);
    const err = await rejection(mcp('run_builds', { todoIds: [OWN_TASK, CROSS], assignment }));
    expect(err.status).toBe(404);
    expect(buildsOf(OWN_TASK)).toBe(before);
    expect(H.s.db.select().from(todoTable).where(eq(todoTable.id, OWN_TASK)).get()?.phase).toBe(
      own?.phase,
    );
  });

  test('U8 run_builds：指派他队 Agent → 404 agent，一个 build 都不建', async () => {
    H.s.db
      .insert(agentTable)
      .values({ id: 'agent-b-1470', teamId: TEAM_B, displayName: 'b', provider: 'p', modelId: 'm' })
      .run();
    const before = buildsOf(OWN_TASK);
    const err = await rejection(
      mcp('run_builds', {
        todoIds: [OWN_TASK],
        assignment: { build: { agentId: 'agent-b-1470' } },
      }),
    );
    expect(err.status).toBe(404);
    expect(err.message).toBe('agent agent-b-1470');
    expect(buildsOf(OWN_TASK)).toBe(before);
  });

  test('U2 schedule_todo：本队任务指向他队项目 → 404 project，不建定时', async () => {
    const err = await rejection(
      mcp('schedule_todo', { todoId: CROSS, kind: 'once', at: nextQuarter() }),
    );
    expect(err.status).toBe(404);
    expect(err.message).toBe(`project ${PROJ_B}`);
    expect(schedulesOf(CROSS)).toBe(0);
  });

  test('U7 同团队路径不变：run_builds 与 schedule_todo 照常', async () => {
    const res = (await mcp('run_builds', { todoIds: [OWN_TASK], assignment })) as {
      builds: unknown[];
    };
    expect(res.builds.length).toBe(1);
    await mcp('schedule_todo', { todoId: OWN_TASK, kind: 'once', at: nextQuarter() });
    expect(schedulesOf(OWN_TASK)).toBe(1);
  });
});

describe('#1470 MCP conversation：跨团队与不存在同 404', () => {
  test.each([
    ['build 对话', BUILD_B],
    ['chief 对话', THREAD_B],
  ])('U3 %s：他队 id 404，文案与不存在 id 同形', async (_label, id) => {
    const cross = await rejection(mcp('conversation', { conversationId: id }));
    const missingId = id.startsWith('chief-') ? `chief-${MISSING}` : MISSING;
    const missing = await rejection(mcp('conversation', { conversationId: missingId }));
    expect(cross.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(cross.message).toBe(missing.message.replace(missingId, id));
  });

  test('U7 本队 build / chief 对话照常读', async () => {
    const own = (await mcp('conversation', { conversationId: OWN_BUILD })) as { content: string }[];
    expect(own.map((m) => m.content)).toEqual(['本队对话']);
    const chief = (await mcp('conversation', { conversationId: H.threadId })) as {
      content: string;
    }[];
    expect(chief.map((m) => m.content)).toEqual(['本队 chief 对话']);
  });
});

describe('#1470 chief usage：只回本队 build 与本队 chief 回合的行', () => {
  test('U4 全量：不含他队 build / 他队 chief 回合', async () => {
    const rows = (await relay('usage', {})) as { buildId: string }[];
    expect(rows.map((r) => r.buildId).sort()).toEqual([OWN_BUILD, H.threadId].sort());
  });

  test('U4 按 buildId：他队 build 回 []，本队 build 照回', async () => {
    expect(await relay('usage', { buildId: BUILD_B })).toEqual([]);
    expect(await relay('usage', { buildId: THREAD_B })).toEqual([]);
    const own = (await relay('usage', { buildId: OWN_BUILD })) as { input: number }[];
    expect(own.map((r) => r.input)).toEqual([1]);
  });
});

describe('#1470 chief 信封 context.tokens：只计本 chief 的 thread', () => {
  test('U9 他队 chief 回合不进读数', () => {
    const svc = { db: H.s.db, hub: H.s.hub, machineHub: H.s.machineHub, user: H.s.user };
    expect(getChiefEnvelope(svc, H.teamId).context?.tokens).toBe(2);
  });
});

describe('#1470 save_memory：projectId / sourceTodoId 核团队', () => {
  test.each([
    ['projectId 他队', { projectId: PROJ_B }, `project ${PROJ_B}`],
    ['projectId 不存在', { projectId: MISSING }, `project ${MISSING}`],
    ['sourceTodoId 他队', { sourceTodoId: TASK_B }, `todo ${TASK_B}`],
  ])('U5 chief %s → 404，不落库', async (_label, extra, message) => {
    const before = memoryCount();
    const err = await rejection(relay('save_memory', { title: 't', content: 'c', ...extra }));
    expect(err.status).toBe(404);
    expect(err.message).toBe(message);
    expect(memoryCount()).toBe(before);
  });

  const workerCtx = () => ({
    teamId: H.teamId,
    agentId: AGENT_ID,
    todoId: OWN_TASK,
    projectId: H.projectId,
    buildId: OWN_BUILD,
    attachmentsDir: H.s.attachmentsDir,
  });

  test.each([
    ['projectId 他队', { projectId: PROJ_B }, `project ${PROJ_B}`],
    ['sourceTodoId 他队', { sourceTodoId: TASK_B }, `todo ${TASK_B}`],
  ])('U5 worker %s → 404，不落库', async (_label, extra, message) => {
    const before = memoryCount();
    const err = await rejection(
      executeWorkerMemoryTool(H.s.db, workerCtx(), 'save_memory', {
        title: 't',
        content: 'c',
        ...extra,
      }),
    );
    expect(err.status).toBe(404);
    expect(err.message).toBe(message);
    expect(memoryCount()).toBe(before);
  });

  test('U7 本队项目照常落库（chief 显式 projectId、worker 缺省上下文）', async () => {
    const chief = (await relay('save_memory', {
      title: 't',
      content: 'c',
      projectId: H.projectId,
      sourceTodoId: OWN_TASK,
    })) as { projectId: string };
    expect(chief.projectId).toBe(H.projectId);
    const worker = JSON.parse(
      await executeWorkerMemoryTool(H.s.db, workerCtx(), 'save_memory', {
        title: 'w',
        content: 'c',
      }),
    ) as { projectId: string; sourceTodoId: string };
    expect(worker).toMatchObject({ projectId: H.projectId, sourceTodoId: OWN_TASK });
  });
});

describe('#1470 clone URL：存量 githubRepo 经 githubRepoOfProject 同一道闸', () => {
  function githubRow(githubRepo: string) {
    return {
      id: `proj-${newUuidv7()}`,
      name: 'g',
      teamId: H.teamId,
      description: null,
      repoKind: 'github' as const,
      repoName: null,
      githubRepo,
      localPath: '/abs/checkout',
    };
  }

  test.each(['../user', 'a/..', 'no-slash'])('U6 %s：无 clone URL、无 repo 绑定', (value) => {
    const row = githubRow(value) as Parameters<typeof projectRepoRef>[0] & object;
    expect(projectRepoRef(row, 'http://h')).toBeNull();
    expect(hasRepoBinding(row)).toBe(false);
    expect(toProjectRecord(row, 'http://h').cloneUrl).toBeUndefined();
    // 存量值仍原样回显（设置页能看见并改掉它）。
    expect(toProjectRecord(row, 'http://h').githubRepo).toBe(value);
  });

  test('U7 合法 owner/repo：clone URL 与加速位不变', () => {
    const row = githubRow('octo/alpha') as Parameters<typeof projectRepoRef>[0] & object;
    expect(projectRepoRef(row, 'http://h')).toEqual({
      kind: 'github',
      cloneUrl: 'https://github.com/octo/alpha.git',
      localPath: '/abs/checkout',
    });
    expect(toProjectRecord(row, 'http://h').cloneUrl).toBe('https://github.com/octo/alpha.git');
  });
});
