// #1497：#1470 之后剩下的团队归属缺口——startBuilds、claim 与 chief
// delete_memory。单团队部署下不可触发；本文件直插第二个团队造出触发面。
// 失败方式（先于实现固化）：
//  V1 startBuilds：本队任务指向他队项目（#1466 前 create_todo 可造）照样建
//     build、推相位——REST / 定时 / 其它调用方不经 chief / MCP 的入口校验。
//  V2 定时触发同一种行：tick 不得抛出（tick 在启动时同步跑，抛出会拖垮
//     启动），也不建 build。
//  V3 已存在的 build 在这种行上被领取：claim 载荷带他队仓库，凭证端点发
//     本队的 git 凭证。
//  V4 chief delete_memory：按 id 删掉别的 Agent / 他队的记忆。
//  V5 同团队路径不变。
//  V6 startBuilds 同一 id 出现两次：第二次照旧 409，不建第二个 build。
//  V7 build 变更读面（readBuildChangeFile）：任务指向他队 hosted 项目时读到
//     他队 bare 仓。

import type { ClaimedStep } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import {
  agentMemory,
  agent as agentTable,
  build as buildTable,
  project as projectTable,
  schedule as scheduleTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { newRecordId, nowMs } from '../src/lib/ids.js';
import { NotFoundError, startBuilds } from '../src/services/builds.js';
import { executeChiefTool, executeWorkerMemoryTool } from '../src/services/chief-tools.js';
import { readBuildChangeFile } from '../src/services/git.js';
import { PhaseTransitionError } from '../src/services/phase.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSchedule } from '../src/services/schedules.js';
import { bindAllAgents, bootServer, issueApiKey, type TestServer } from './helpers.js';

const TEAM_B = 'team-b-1497';
const PROJ_B = 'proj-b-1497';
const AGENT_ID = 'agent-1497';

const servers: TestServer[] = [];
afterEach(() => {
  while (servers.length > 0) servers.pop()?.dispose();
});

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return app.request(path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/** 本队、他队各一个 hosted 项目（claim 时会派生出 clone URL）+ 本队任务。 */
async function world() {
  const s = bootServer({ claimHoldMs: 250 });
  servers.push(s);
  s.db.insert(teamTable).values({ id: TEAM_B, name: 'B', createdAt: nowMs() }).run();
  s.db
    .insert(projectTable)
    .values({ id: PROJ_B, name: 'beta', teamId: TEAM_B, repoKind: 'hosted', repoName: 'beta' })
    .run();
  const plain = await issueApiKey(s);
  const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: plain,
    body: { teamId: s.team.id, name: 'm-1497', cliVersion: '0.1.0' },
  });
  const { token } = (await enroll.json()) as { token: string };
  s.db
    .insert(agentTable)
    .values({ id: AGENT_ID, teamId: s.team.id, displayName: 'a', provider: 'p', modelId: 'm' })
    .run();
  bindAllAgents(s);
  const projectId = 'proj-a-1497';
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: 'alpha',
      teamId: s.team.id,
      repoKind: 'hosted',
      repoName: 'alpha',
    })
    .run();
  const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '本队任务', spec: 's' },
  });
  const { id: todoId } = (await res.json()) as { id: string };
  return { s, projectId, todoId, token };
}

/** 把任务改指他队项目（存量异常行的形状）。 */
function pointAtTeamB(s: TestServer, todoId: string): void {
  s.db.update(todoTable).set({ projectId: PROJ_B }).where(eq(todoTable.id, todoId)).run();
}

function stateOf(s: TestServer, todoId: string) {
  const row = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
  const builds = s.db.select().from(buildTable).where(eq(buildTable.todoId, todoId)).all();
  return { phase: row?.phase, builds: builds.length };
}

const assignment = { plan: null, build: { agentId: AGENT_ID } };

describe('#1497 startBuilds：项目须与任务同队', () => {
  test('V1 本队任务指向他队项目 → NotFound project，不建 build、相位不动', async () => {
    const { s, todoId } = await world();
    pointAtTeamB(s, todoId);
    const before = stateOf(s, todoId);
    expect(() =>
      startBuilds(s.svc, { projectId: PROJ_B, todoIds: [todoId], assignment, withPlan: false }),
    ).toThrow(new NotFoundError(`project ${PROJ_B}`));
    expect(stateOf(s, todoId)).toEqual(before);
  });

  test('V1 REST 入口同样 404', async () => {
    const { s, todoId } = await world();
    pointAtTeamB(s, todoId);
    const res = await call(s.app, 'POST', `/api/projects/${PROJ_B}/builds`, {
      body: { todoIds: [todoId], assignment, withPlan: false },
    });
    expect(res.status).toBe(404);
    expect(stateOf(s, todoId).builds).toBe(0);
  });

  test('V2 定时触发：tick 不抛出，不建 build', async () => {
    const { s, todoId } = await world();
    pointAtTeamB(s, todoId);
    const at = Math.ceil((nowMs() + 3_600_000) / 900_000) * 900_000;
    createSchedule(
      { db: s.db, hub: s.hub },
      {
        teamId: s.team.id,
        projectId: PROJ_B,
        todoId,
        kind: 'once',
        at,
        tz: 'UTC',
        createdBy: s.user.id,
      },
    );
    const scheduler = createScheduler(s.svc, { tickMs: 60_000 });
    expect(() => scheduler.tick(at + 1_000)).not.toThrow();
    expect(stateOf(s, todoId).builds).toBe(0);
    // 这条定时再也触发不了：出队，不在每个 tick 上重试。
    expect(s.db.select().from(scheduleTable).where(eq(scheduleTable.todoId, todoId)).all()).toEqual(
      [],
    );
  });

  test('V6 同一 id 出现两次：第二次 409，只有一个 build', async () => {
    const { s, projectId, todoId } = await world();
    expect(() =>
      startBuilds(s.svc, { projectId, todoIds: [todoId, todoId], assignment, withPlan: false }),
    ).toThrow(PhaseTransitionError);
    expect(stateOf(s, todoId).builds).toBe(1);
  });

  test('V7 变更读面：任务指向他队 hosted 项目 → 404，不读他队仓库', async () => {
    const { s, projectId, todoId } = await world();
    const [created] = startBuilds(s.svc, {
      projectId,
      todoIds: [todoId],
      assignment,
      withPlan: false,
    });
    pointAtTeamB(s, todoId);
    const err = await readBuildChangeFile(
      { db: s.db, reposDir: s.reposDir },
      created?.id ?? '',
      'README.md',
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
  });

  test('V5 本队项目照常建 build', async () => {
    const { s, projectId, todoId } = await world();
    const created = startBuilds(s.svc, {
      projectId,
      todoIds: [todoId],
      assignment,
      withPlan: false,
    });
    expect(created).toHaveLength(1);
    expect(stateOf(s, todoId)).toEqual({ phase: 'queued', builds: 1 });
  });
});

describe('#1497 claim：他队项目不进载荷，不发凭证', () => {
  async function claimed(cross: boolean) {
    const { s, projectId, todoId, token } = await world();
    startBuilds(s.svc, { projectId, todoIds: [todoId], assignment, withPlan: false });
    // build 已在跑之后，任务才指到他队项目（存量行在 claim 时的形状）。
    if (cross) pointAtTeamB(s, todoId);
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no step claimed');
    const tokenRes = await call(s.app, 'GET', `/api/machine/token/${step.step.id}`, {
      cred: token,
    });
    const creds = (await tokenRes.json()) as { git: unknown };
    return { step, creds };
  }

  test('V3 任务指向他队 hosted 项目：载荷无 repo，凭证 git = null', async () => {
    const { step, creds } = await claimed(true);
    expect(step.project?.repo ?? null).toBeNull();
    expect(JSON.stringify(step)).not.toContain(`/${TEAM_B}/`);
    expect(creds.git).toBeNull();
  });

  test('V5 本队 hosted 项目：载荷带 repo，凭证照发', async () => {
    const { step, creds } = await claimed(false);
    expect(step.project?.repo?.kind).toBe('hosted');
    expect(creds.git).not.toBeNull();
  });
});

describe('#1497 chief delete_memory：只删本 Agent 本团队条目', () => {
  function insertMemory(s: TestServer, agentId: string, teamId: string): string {
    const id = newRecordId();
    s.db
      .insert(agentMemory)
      .values({
        id,
        agentId,
        teamId,
        title: 't',
        content: 'c',
        projectId: null,
        sourceTodoId: null,
        sourceBuildId: null,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      })
      .run();
    return id;
  }

  async function chiefDelete(s: TestServer, memoryId: string): Promise<unknown> {
    return executeChiefTool(
      { ...s.svc, box: s.secretBox, reposDir: s.reposDir, attachmentsDir: s.attachmentsDir },
      {
        teamId: s.team.id,
        userId: s.user.id,
        chiefId: `chief-${s.user.id}-${s.team.id}`,
        threadId: 'chief-1497',
        chiefAgentId: AGENT_ID,
        conversationId: 'chief-1497',
      },
      'delete_memory',
      { memoryId },
    );
  }

  function exists(s: TestServer, id: string): boolean {
    return s.db.select().from(agentMemory).where(eq(agentMemory.id, id)).get() !== undefined;
  }

  test('V4 别的 Agent / 他队的记忆不被删', async () => {
    const { s } = await world();
    const otherAgent = insertMemory(s, 'agent-other-1497', s.team.id);
    const otherTeam = insertMemory(s, AGENT_ID, TEAM_B);
    for (const id of [otherAgent, otherTeam]) {
      const err = await chiefDelete(s, id).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(404);
    }
    expect(exists(s, otherAgent)).toBe(true);
    expect(exists(s, otherTeam)).toBe(true);
  });

  test('V4 worker delete_memory：别的 Agent 的记忆 → 404，不删', async () => {
    const { s, todoId } = await world();
    const otherAgent = insertMemory(s, 'agent-other-1497', s.team.id);
    const err = await executeWorkerMemoryTool(
      s.db,
      {
        teamId: s.team.id,
        agentId: AGENT_ID,
        todoId,
        projectId: null,
        buildId: 'build-1497',
        attachmentsDir: s.attachmentsDir,
      },
      'delete_memory',
      { memoryId: otherAgent },
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect((err as HttpError).status).toBe(404);
    expect(exists(s, otherAgent)).toBe(true);
  });

  test('V5 本 Agent 本团队的记忆照删', async () => {
    const { s } = await world();
    const own = insertMemory(s, AGENT_ID, s.team.id);
    await chiefDelete(s, own);
    expect(exists(s, own)).toBe(false);
  });
});
