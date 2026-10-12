// 交付面回填 + 变更投影（#704，B-C1/B-C16 的 server 半）：
// daemon done 通道携带的 prUrl/prNumber/changesDiff → build 行落库 →
// readBuildChanges 非 hosted 分支消费。失败方式枚举先于实现固化
// （AGENTS.md 测试规则 3；票面五种失败方式的 server 侧投影）：
//   1. done 带 prUrl/prNumber → build 行回填（github 形态 agent 开的 PR
//      服务端可见——「分支与 PR」面板数据源）
//   2. done 不带 PR 字段（无 PR / 探测失败）→ 行保持 null，不造空数据
//   3. done 带 changesDiff → GET /changes 返回解析后的真 diff 文件集
//      （手动项目投影非空——与 daemon 侧真 diff 一致）
//   4. changesDiff 超上限 → 丢弃（done 仍 200，步照常收尾；投影回落 null，
//      不存半截假象）
//   5. hosted 形态投影仍读 bare repo（真值源不漂移——daemon 不上报该形态，
//      空 diff 语义同旧）
//   6. 无 repo 项目 / 未上报 build → {files:[]}（null ≠ 空数组的旧形）

import type { ClaimedStep } from '@pacman/shared';
import { CHANGES_DIFF_MAX_BYTES, claimedStepSchema } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { agent as agentTable, build as buildTable, todo as todoTable } from '../src/db/schema.js';
import { bindAllAgents, bootServer, issueApiKey, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-704-1';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

interface World {
  s: TestServer;
  token: string;
  githubProjectId: string;
  plainProjectId: string;
  startBuild(projectId: string): Promise<string>;
  claim(): Promise<ClaimedStep>;
  done(stepId: string, body: Record<string, unknown>): Promise<Response>;
}

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

/** github（手动 owner/repo，无 connection）+ 无 repo 双项目世界。 */
async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'm704', cliVersion: '0.1.0' },
  });
  const machineJson = (await enrollRes.json()) as { token: string };
  s.db
    .insert(agentTable)
    .values({ id: AGENT_ID, teamId: s.team.id, displayName: 'b704', modelId: 'm' })
    .run();
  bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

  // B-C1 形态：手动输入 owner/repo 不连 GitHub。
  const ghRes = await call(s.app, 'POST', '/api/projects', {
    body: { name: 'probe-704', kind: 'github', githubRepo: 'octocat/Hello-World' },
  });
  expect(ghRes.status).toBe(201);
  const ghProject = (await ghRes.json()) as { id: string };
  const plainRes = await call(s.app, 'POST', '/api/projects', { body: { name: 'plain-704' } });
  const plainProject = (await plainRes.json()) as { id: string };
  const todoRes = await call(s.app, 'POST', `/api/projects/${ghProject.id}/todos`, {
    body: { title: '704 探针', spec: '改一行' },
  });
  const todoBody = (await todoRes.json()) as { id: string };
  const plainTodoRes = await call(s.app, 'POST', `/api/projects/${plainProject.id}/todos`, {
    body: { title: 'plain', spec: 's' },
  });
  const plainTodo = (await plainTodoRes.json()) as { id: string };
  return {
    s,
    token: machineJson.token,
    githubProjectId: ghProject.id,
    plainProjectId: plainProject.id,
    async startBuild(projectId) {
      const todoId = projectId === ghProject.id ? todoBody.id : plainTodo.id;
      const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: {
          todoIds: [todoId],
          assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
          withPlan: false,
        },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { builds: { id: string }[] };
      return body.builds[0]!.id;
    },
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: machineJson.token,
        body: {},
      });
      const body = (await res.json()) as { step: ClaimedStep | null };
      if (!body.step) throw new Error('claim returned no step');
      return claimedStepSchema.parse(body.step);
    },
    async done(stepId, body) {
      return call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: machineJson.token,
        body,
      });
    },
  };
}

const SAMPLE_DIFF = [
  'diff --git a/README.md b/README.md',
  'index 1111111..2222222 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,2 @@',
  ' hello',
  '+probe 704',
  '',
].join('\n');

describe('done 通道交付面回填（#704 / B-C16）', () => {
  test('失败方式 1：done 带 prUrl/prNumber → build 行回填', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    const claimed = await w.claim();
    const res = await w.done(claimed.step.id, {
      status: 'success',
      prUrl: 'https://github.com/octocat/Hello-World/pull/606',
      prNumber: 606,
    });
    expect(res.status).toBe(200);
    const row = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
    expect(row?.prUrl).toBe('https://github.com/octocat/Hello-World/pull/606');
    expect(row?.prNumber).toBe(606);
  });

  test('失败方式 2：done 不带 PR 字段 → 行保持 null（不造空数据）', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    const claimed = await w.claim();
    await w.done(claimed.step.id, { status: 'success' });
    const row = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
    expect(row?.prUrl).toBeNull();
    expect(row?.prNumber).toBeNull();
  });

  test('失败方式 3：done 带 changesDiff → changes 端点返回真 diff 文件集', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    const claimed = await w.claim();
    await w.done(claimed.step.id, { status: 'success', changesDiff: SAMPLE_DIFF });
    const res = await call(w.s.app, 'GET', `/api/builds/${buildId}/changes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      files: { path: string; additions: number; deletions: number }[];
    };
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toMatchObject({ path: 'README.md', additions: 1, deletions: 0 });
  });

  test('失败方式 4：changesDiff 超上限 → 丢弃（done 仍 200，行不落半截）', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    const claimed = await w.claim();
    const oversized = `${'x'.repeat(CHANGES_DIFF_MAX_BYTES + 1)}`;
    const res = await w.done(claimed.step.id, {
      status: 'success',
      changesDiff: oversized,
    });
    expect(res.status).toBe(200); // 上限闸不打爆 done 通道
    const row = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
    expect(row?.changes).toBeNull();
  });

  test('失败方式 6：未上报 build / 无 repo 项目 → {files:[]}（null ≠ 空数组）', async () => {
    const w = await setupWorld();
    const buildId = await w.startBuild(w.githubProjectId);
    // 未上报（done 无 changesDiff）→ 空集不造假
    const claimed = await w.claim();
    await w.done(claimed.step.id, { status: 'success' });
    const res = await call(w.s.app, 'GET', `/api/builds/${buildId}/changes`);
    const body = (await res.json()) as { files: unknown[] };
    expect(body.files).toEqual([]);
    // 无 repo 项目（kind 缺省，daemon 无 worktree 可上报）同形
    const plainBuildId = await w.startBuild(w.plainProjectId);
    const plainClaimed = await w.claim();
    await w.done(plainClaimed.step.id, { status: 'success' });
    const plainRes = await call(w.s.app, 'GET', `/api/builds/${plainBuildId}/changes`);
    const plainBody = (await plainRes.json()) as { files: unknown[] };
    expect(plainBody.files).toEqual([]);
  });
});

describe('hosted 形态真值源不漂移（#704：bare repo 仍是唯一真值）', () => {
  test('失败方式 5：hosted build 上报 changesDiff 也不改变投影来源（bare repo 读面）', async () => {
    const w = await setupWorld();
    // hosted 项目走 POST /api/projects kind=hosted（provision bare repo）。
    const projRes = await call(w.s.app, 'POST', '/api/projects', {
      body: { name: 'hosted-704', repoKind: 'hosted' },
    });
    const project = (await projRes.json()) as { id: string };
    const todoRes = await call(w.s.app, 'POST', `/api/projects/${project.id}/todos`, {
      body: { title: 'hosted 探针', spec: 's' },
    });
    const todoRow = (await todoRes.json()) as { id: string };
    await call(w.s.app, 'POST', `/api/projects/${project.id}/builds`, {
      body: {
        todoIds: [todoRow.id],
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
        withPlan: false,
      },
    });
    const claimed = await w.claim();
    // 越权上报（现实中 daemon 对 hosted 不发 changesDiff——本测试钉 server 侧
    // 读面优先级：bare repo 无 conv 分支 = 空集，落库的 changes 列不参读）。
    await w.done(claimed.step.id, { status: 'success', changesDiff: SAMPLE_DIFF });
    const buildRow = w.s.db
      .select()
      .from(buildTable)
      .where(eq(buildTable.id, claimed.step.buildId))
      .get();
    const todoDb = w.s.db.select().from(todoTable).where(eq(todoTable.id, buildRow!.todoId)).get();
    expect(todoDb?.projectId).toBe(project.id);
    const res = await call(w.s.app, 'GET', `/api/builds/${claimed.step.buildId}/changes`);
    const body = (await res.json()) as { files: unknown[] };
    expect(body.files).toEqual([]);
  });
});
