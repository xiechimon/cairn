// spec 12 / #362 G2-T2 server 半：claim 载荷 repo 绑定位扩 local 形态 +
// github 执行凭证 per-step 下发（github_connection token → GitCredentials
// {username:'x-access-token'}）。失败方式枚举先于实现固化（仓测试纪律）：
//   1. local 项目 claim → repo {kind:'local', cloneUrl = 规范化 localPath}；
//      token 响应 git 槽 = null（本地路径 clone/push 无需凭证）
//   2. github 项目（connection 行在位）→ token git = {x-access-token, token}；
//      claim repo {kind:'github', cloneUrl = https 派生}；不发行 hosted 族
//      一次性 gitAccess apiKey（凭证生命周期 = 连接行，非 per-step key）
//   3. github 项目无 connection 行 → git null（匿名面自然失败归 daemon 步
//      reason，不在 token 端点造错）
//   4. token 明文不进 wire 其它位（响应 JSON 全文 token 仅现于 git.password）

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaimedStep } from '@pacman/shared';
import {
  claimedStepSchema,
  GITHUB_ACCESS_TOKEN_USERNAME,
  machineTokenResponseSchema,
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { agent as agentTable, apiKey as apiKeyTable } from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { bindAllAgents, bootServer, issueApiKey, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-g2t2-1';
const GH_TOKEN = 'ghp_connection_row_token_probe';

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

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface WireWorld {
  s: TestServer;
  machineToken: string;
  claim(): Promise<ClaimedStep>;
  tokenOf(
    stepId: string,
  ): Promise<{ raw: string; git: { username: string; password: string } | null }>;
}

async function setupWorld(projectBody: Record<string, unknown>): Promise<WireWorld> {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'g2t2-mbp', cliVersion: '0.1.0' },
  });
  const machineToken = ((await enrollRes.json()) as { token: string }).token;
  s.db
    .insert(agentTable)
    .values({ id: AGENT_ID, teamId: s.team.id, displayName: 'g2t2-builder', modelId: 'm' })
    .run();
  bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

  const projRes = await call(s.app, 'POST', '/api/projects', { body: projectBody });
  expect(projRes.status).toBe(201);
  const project = (await projRes.json()) as { id: string };
  const todoRes = await call(s.app, 'POST', `/api/projects/${project.id}/todos`, {
    body: { title: 'G2-T2 探针', spec: '写一行探针' },
  });
  const todoBody = (await todoRes.json()) as { id: string };
  const buildRes = await call(s.app, 'POST', `/api/projects/${project.id}/builds`, {
    body: {
      todoIds: [todoBody.id],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: false, // build 步直达（claim/token 面断言不需 plan 关）
    },
  });
  expect(buildRes.status).toBe(201);
  return {
    s,
    machineToken,
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: machineToken,
        body: {},
      });
      const body = (await res.json()) as { step: ClaimedStep | null };
      if (!body.step) throw new Error('claim returned no step');
      return claimedStepSchema.parse(body.step);
    },
    async tokenOf(stepId) {
      const res = await call(s.app, 'GET', `/api/machine/token/${stepId}`, { cred: machineToken });
      expect(res.status).toBe(200);
      const raw = await res.text();
      const parsed = machineTokenResponseSchema.parse(JSON.parse(raw));
      return { raw, git: parsed.git };
    },
  };
}

/** 真 git 工作树仓（validateLocalRepoPath 的 isGitRepo 闸要真仓）。 */
async function seedUserRepo(): Promise<string> {
  const dir = join(mkdtempSync(join(tmpdir(), 'pacman-g2t2-user-')), 'repo');
  await runGit(['init', '-b', 'main', dir]);
  return dir;
}

describe('G2-T2 claim/token 执行面接线（spec 12）', () => {
  test('失败方式 1：local 项目 → claim repo {kind:local, cloneUrl=localPath}；token git null', async () => {
    const userRepo = await seedUserRepo();
    const w = await setupWorld({ name: 'g2t2-local', kind: 'local', localPath: userRepo });
    const claimed = await w.claim();
    expect(claimed.project?.repo).toEqual({ kind: 'local', cloneUrl: userRepo });
    const { git } = await w.tokenOf(claimed.step.id);
    expect(git).toBeNull();
  });

  test('失败方式 2：github 项目 + connection 行 → token git {x-access-token, token}；不发 gitAccess key', async () => {
    const w = await setupWorld({ name: 'g2t2-gh', kind: 'github', githubRepo: 'octo/alpha' });
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.s.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
    );
    const claimed = await w.claim();
    expect(claimed.project?.repo).toEqual({
      kind: 'github',
      cloneUrl: 'https://github.com/octo/alpha.git',
    });
    const { git } = await w.tokenOf(claimed.step.id);
    expect(git).toEqual({ username: GITHUB_ACCESS_TOKEN_USERNAME, password: GH_TOKEN });
    // hosted 族一次性凭证不发行（github 凭证生命周期 = connection 行）。
    const gitKeys = w.s.db.select().from(apiKeyTable).where(eq(apiKeyTable.gitAccess, true)).all();
    expect(gitKeys).toHaveLength(0);
  });

  test('失败方式 3：github 项目无 connection 行 → token git null', async () => {
    const w = await setupWorld({ name: 'g2t2-gh-anon', kind: 'github', githubRepo: 'octo/beta' });
    const claimed = await w.claim();
    const { git } = await w.tokenOf(claimed.step.id);
    expect(git).toBeNull();
  });

  test('失败方式 4：token 明文仅现于 git.password 位（wire 其它位不泄漏）', async () => {
    const w = await setupWorld({ name: 'g2t2-gh-leak', kind: 'github', githubRepo: 'octo/gamma' });
    upsertGithubConnection(
      { db: w.s.db, box: w.s.secretBox },
      { teamId: w.s.team.id, login: 'octo', accessToken: GH_TOKEN, scope: 'repo' },
    );
    const claimed = await w.claim();
    const { raw } = await w.tokenOf(claimed.step.id);
    expect(raw.split(GH_TOKEN)).toHaveLength(2); // 恰好一次
    // claim 载荷不携凭证（凭证只走 token 端点，02 §5.4）。
    expect(JSON.stringify(claimed)).not.toContain(GH_TOKEN);
  });
});
