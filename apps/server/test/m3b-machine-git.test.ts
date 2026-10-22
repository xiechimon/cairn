// M3b server 半对拍（02 §4.2/§5.4/§8）：claim 载荷 repo 绑定位、per-step
// 一次性 git 凭证（发行/回收）、plan.md 产物版本落库、done 回传 commit =
// per-step checkpoint、合并步落地 = bare repo 默认分支 fast-forward（非快进
// 拒绝 → failed，人工重跑 02/A6）、时间线「发起了合并」/「🎉 任务已完成」。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaimedStep } from '@pacman/shared';
import { claimedStepSchema, machineTokenResponseSchema } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  agent as agentTable,
  apiKey as apiKeyTable,
  build as buildTable,
  message as messageTable,
  plan as planTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { systemGitOps } from '../src/lib/git.js';
import { MERGE_NOT_LANDED_NOTE } from '../src/services/machines.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  type TestServer,
  withVerification,
} from './helpers.js';

const AGENT_ID = 'agent-m3b-1';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown; text?: string; contentType?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.contentType !== undefined) headers['content-type'] = opts.contentType;
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : (opts.text as string | undefined),
    }),
  );
}

interface GitWorld {
  s: TestServer;
  token: string;
  projectId: string;
  todoId: string;
  repoDir: string;
  startBuild(): Promise<string>;
  claim(): Promise<ClaimedStep>;
  done(stepId: string, body: Record<string, unknown>): Promise<Response>;
  /** plan.md 产物回传（plan 关交接物，#113：无产物规划步不算成、不进 confirm）。 */
  uploadPlan(stepId: string, content: string): Promise<void>;
}

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

async function setupGitWorld(): Promise<GitWorld> {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'm3b-mbp', cliVersion: '0.1.0' },
  });
  const machineJson = (await enrollRes.json()) as { token: string };
  // agent（provider 面不必要——token 响应的 provider 槽为 null 亦可断言 git 面）。
  // XMON-77：本世界走 merge 全链（/merge 202 + 合并步 claim），合并闸要求
  // build 槽 Agent 持两开关——先行授权。
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'm3b-builder',
      modelId: 'm',
      tools: ['合并分支', '推送分支'],
    })
    .run();
  bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）
  // 托管 repo 项目（provision = init bare + 种子提交立 main，services/git.ts）。
  const projRes = await call(s.app, 'POST', '/api/projects', {
    body: { name: 'm3b-lifecycle', repoKind: 'hosted' },
  });
  expect(projRes.status).toBe(201);
  const project = (await projRes.json()) as { id: string; repoName: string; cloneUrl: string };
  const todoRes = await call(s.app, 'POST', `/api/projects/${project.id}/todos`, {
    body: { title: 'M3b 探针', spec: '写一行探针到 README.md' },
  });
  const todoBody = (await todoRes.json()) as { id: string };
  const repoDir = join(s.reposDir, s.team.id, `${project.repoName}.git`);
  return {
    s,
    token: machineJson.token,
    projectId: project.id,
    todoId: todoBody.id,
    repoDir,
    async startBuild() {
      const res = await call(s.app, 'POST', `/api/projects/${project.id}/builds`, {
        body: {
          todoIds: [todoBody.id],
          assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
          withPlan: true,
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
    async uploadPlan(stepId, content) {
      const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
        cred: machineJson.token,
        body: { files: [{ name: 'plan.md', size: content.length }] },
      });
      const urls = (await urlsRes.json()) as { uploads: { url: string }[] };
      const put = await call(s.app, 'PUT', urls.uploads[0]!.url.replace(/^https?:\/\/[^/]+/, ''), {
        cred: machineJson.token,
        text: content,
        contentType: 'text/markdown',
      });
      expect(put.status).toBe(200);
    },
  };
}

/** bare repo 内直造分支提交（模拟 daemon push 后状态）：以现 main tip 为父
 * （conv 分支 = main 后代 → fast-forward 合法）；branch='main' 时即推进 main
 * （非快进窗口用）。 */
async function fakePushConvBranch(repoDir: string, branch: string): Promise<string> {
  const { runGit } = await import('../src/lib/git.js');
  const parent = await systemGitOps.resolveCommit(repoDir, 'refs/heads/main');
  if (parent === null) throw new Error('main missing');
  const treeRes = await runGit(['rev-parse', `${parent}^{tree}`], { cwd: repoDir });
  const tree = treeRes.stdout.toString('utf8').trim();
  // 消息带唯一位：同树同父同秒的 commit-tree 会产出同 sha（对象内容寻址）。
  const r = await runGit(
    ['commit-tree', tree, '-p', parent, '-m', `probe ${branch} ${Math.random()}`],
    {
      cwd: repoDir,
      env: {
        GIT_AUTHOR_NAME: 'it',
        GIT_AUTHOR_EMAIL: 'it@local',
        GIT_COMMITTER_NAME: 'it',
        GIT_COMMITTER_EMAIL: 'it@local',
      },
    },
  );
  if (r.code !== 0) throw new Error(`commit-tree failed: ${r.stderr}`);
  const sha = r.stdout.toString('utf8').trim();
  await systemGitOps.updateBranchRef(repoDir, branch, sha);
  return sha;
}

describe('claim 载荷 repo 绑定位（M3b worktree 契约接线，02 §3/§5.5）', () => {
  test('托管项目 → project.repo {kind:hosted, cloneUrl=/git/<teamId>/<repoName>}', async () => {
    const w = await setupGitWorld();
    await w.startBuild();
    const claimed = await w.claim();
    expect(claimed.project!.repo?.kind).toBe('hosted');
    const url = new URL(claimed.project!.repo!.cloneUrl);
    expect(url.pathname).toBe(`/git/${w.s.team.id}/m3b-lifecycle`);
    // 托管 provision 即种子提交：main 在位（worktree base 前提）。
    const main = await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main');
    expect(main).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('per-step 一次性 git 凭证（02 §5.4/§8；relay 工具名对照 push_credential r5 §3.1）', () => {
  test('token/{stepId} → git {username,password}；done 后回收（撤销 = 行删除）', async () => {
    const w = await setupGitWorld();
    await w.startBuild();
    const claimed = await w.claim();
    const tokenRes = await call(w.s.app, 'GET', `/api/machine/token/${claimed.step.id}`, {
      cred: w.token,
    });
    const token = machineTokenResponseSchema.parse(await tokenRes.json());
    expect(token.git).not.toBeNull();
    expect(token.git?.username).toBe('git');
    expect(token.git?.password).toMatch(/^pacman_[0-9a-f]{48}$/);
    // 发行面 = apiKey 行（gitAccess=true，服务端只存哈希）。
    const rows = w.s.db
      .select()
      .from(apiKeyTable)
      .where(eq(apiKeyTable.name, `git-step-${claimed.step.id}`))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.gitAccess).toBe(true);
    expect(rows[0]!.keyHash).not.toContain(token.git!.password);
    // 幂等重取（recover 二次 token）：同行换新，不叠加。
    const again = machineTokenResponseSchema.parse(
      await (
        await call(w.s.app, 'GET', `/api/machine/token/${claimed.step.id}`, { cred: w.token })
      ).json(),
    );
    expect(again.git?.password).not.toBe(token.git?.password);
    const rows2 = w.s.db
      .select()
      .from(apiKeyTable)
      .where(eq(apiKeyTable.name, `git-step-${claimed.step.id}`))
      .all();
    expect(rows2).toHaveLength(1);
    // done → 回收。
    await w.done(claimed.step.id, { status: 'success', sessionId: 'pi-1' });
    const rows3 = w.s.db
      .select()
      .from(apiKeyTable)
      .where(eq(apiKeyTable.name, `git-step-${claimed.step.id}`))
      .all();
    expect(rows3).toHaveLength(0);
  });

  test('未绑 repo 项目 → git null（M3a 兼容形状）', async () => {
    const s = bootServer({ claimHoldMs: 200 });
    disposables.push(() => s.dispose());
    const key = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: key,
      body: { teamId: s.team.id, name: 'm3b-plain' },
    });
    const { token } = (await enroll.json()) as { token: string };
    s.db
      .insert(agentTable)
      .values({ id: AGENT_ID, teamId: s.team.id, displayName: 'b', modelId: 'm' })
      .run();
    bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

    const projRes = await call(s.app, 'POST', '/api/projects', { body: { name: 'plain' } });
    const project = (await projRes.json()) as { id: string };
    const todoRes = await call(s.app, 'POST', `/api/projects/${project.id}/todos`, {
      body: { title: 't', spec: 's' },
    });
    const todoBody = (await todoRes.json()) as { id: string };
    await call(s.app, 'POST', `/api/projects/${project.id}/builds`, {
      body: {
        todoIds: [todoBody.id],
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
        withPlan: true,
      },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep };
    expect(claimedStepSchema.parse(step).project!.repo).toBeNull();
    const tokenRes = await call(s.app, 'GET', `/api/machine/token/${step.step.id}`, {
      cred: token,
    });
    const parsed = machineTokenResponseSchema.parse(await tokenRes.json());
    expect(parsed.git).toBeNull();
  });
});

describe('plan.md 产物上传（02 §4.2/r5 §4：plan 即文件，版本 = 文件版本）', () => {
  test('upload-urls plan.md → plan v1 + build.planDocId；重规划轮 → v2', async () => {
    const w = await setupGitWorld();
    const buildId = await w.startBuild();
    const claimed = await w.claim();
    const stepId = claimed.step.id;

    const put = async (name: string, text: string) => {
      const urlsRes = await call(w.s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
        cred: w.token,
        body: { files: [{ name, size: text.length }] },
      });
      const urls = (await urlsRes.json()) as {
        uploads: { name: string; url: string }[];
      };
      const upload = urls.uploads[0]!;
      const res = await call(w.s.app, 'PUT', upload.url.replace(/^https?:\/\/[^/]+/, ''), {
        cred: w.token,
        text,
        contentType: 'text/markdown',
      });
      expect(res.status).toBe(200);
    };

    await put('plan.md', withVerification('# Context\n方案 v1\n'));
    const plans = w.s.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
    expect(plans).toHaveLength(1);
    expect(plans[0]!.version).toBe(1);
    expect(plans[0]!.content).toContain('方案 v1');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.planDocId).toBe(plans[0]!.id);

    // 驳回重规划轮：同 build 第二版（v2，r5 §4）。
    await put('plan.md', '# Context\n方案 v2\n');
    const plans2 = w.s.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
    expect(plans2).toHaveLength(2);
    expect(plans2.map((p) => p.version).sort()).toEqual([1, 2]);
    const buildRow2 = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow2.planDocId).toBe(plans2.find((p) => p.version === 2)!.id);
  });
});

describe('done 回传 commit = per-step checkpoint（r3 §3.5「恢复到此处」数据面）', () => {
  test('step.checkpointCommit 落库', async () => {
    const w = await setupGitWorld();
    await w.startBuild();
    const claimed = await w.claim();
    const sha = 'a'.repeat(40);
    await w.done(claimed.step.id, { status: 'success', sessionId: 'pi-1', commit: sha });
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, claimed.step.id)).get()!;
    expect(row.checkpointCommit).toBe(sha);
  });
});

describe('merge 202 delegated → 合并步落地（02 §4.2/A6；r3 §3.6 服务端 main 验证）', () => {
  test('合并步 done(commit) → bare repo main fast-forward + 时间线 🎉', async () => {
    const w = await setupGitWorld();
    const buildId = await w.startBuild();
    // plan → confirm → build → review → merge 步（server 面驱动，daemon 面归
    // integration m3b-demo）。plan 步带 plan.md 交接物（#113：无产物不进 confirm）。
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, withVerification('# Context\n方案 v1\n'));
    await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { body: { action: 'confirm' } });
    const buildStep = await w.claim();
    const convSha = await fakePushConvBranch(w.repoDir, `pacman/conv-${buildId}`);
    await w.done(buildStep.step.id, {
      status: 'success',
      sessionId: 'pi-1',
      hasChanges: true,
      commit: convSha,
    });
    const todoNow = () => w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoNow().phase).toBe('review');

    const mergeRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(mergeRes.status).toBe(202);
    expect(await mergeRes.json()).toEqual({ delegated: true });
    // 时间线「发起了合并」（r3 §3.6）。
    const msgsAfterRequest = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(msgsAfterRequest.some((m) => m.content === '发起了合并')).toBe(true);

    const mergeStep = await w.claim();
    expect(mergeStep.step.kind).toBe('merge');
    expect(mergeStep.session.action).toBe('continue');
    await w.done(mergeStep.step.id, {
      status: 'success',
      sessionId: 'pi-1',
      commit: convSha,
    });
    expect(todoNow().phase).toBe('done');
    // bare repo main 已 fast-forward 到 conv 分支 HEAD（r3 §3.6「83 号验证」同语义）。
    const main = await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main');
    expect(main).toBe(convSha);
    // 时间线 🎉（r3 §3.6）。
    const msgs = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, buildId))
      .all();
    expect(msgs.some((m) => m.content === '🎉 任务已完成')).toBe(true);
  });

  test('非快进（main 在合并窗口被推进）→ 步 failed + todo failed（失败仅人工重跑，02/A6）', async () => {
    const w = await setupGitWorld();
    const buildId = await w.startBuild();
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, withVerification('# Context\n方案 v1\n')); // 交接物（#113）
    await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { body: { action: 'confirm' } });
    const buildStep = await w.claim();
    const convSha = await fakePushConvBranch(w.repoDir, `pacman/conv-${buildId}`);
    await w.done(buildStep.step.id, { status: 'success', sessionId: 'pi-1', commit: convSha });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    const mergeStep = await w.claim();
    // 合并窗口内 main 前进（分叉提交）→ convSha 不再是 main 的后代。
    await fakePushConvBranch(w.repoDir, 'main');
    await w.done(mergeStep.step.id, { status: 'success', sessionId: 'pi-1', commit: convSha });

    const stepRow = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, mergeStep.step.id))
      .get()!;
    expect(stepRow.status).toBe('failed');
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!;
    expect(todoRow.phase).toBe('failed');
    const buildRow = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
    expect(buildRow.errorMessage).toContain('non-fast-forward');
  });
});

describe('#1487 合并步在跑时卡离开审核：成功回报不落地；重复合并请求 409', () => {
  // 2026-10-22 裁决方案 a：卡已关闭或已挪回待开始时，合并步的成功回报不再把
  // 托管仓默认分支快进；卡保持原相位，时间线落一行说明合并没有落地。
  /** 走到「合并步已被领走」：返回 world、buildId、conv 分支 sha、合并步 id、main 原 tip。 */
  async function mergeInFlight() {
    const w = await setupGitWorld();
    const buildId = await w.startBuild();
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, withVerification('# Context\n方案 v1\n'));
    await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { body: { action: 'confirm' } });
    const buildStep = await w.claim();
    const convSha = await fakePushConvBranch(w.repoDir, `pacman/conv-${buildId}`);
    await w.done(buildStep.step.id, {
      status: 'success',
      sessionId: 'pi-1',
      hasChanges: true,
      commit: convSha,
    });
    const mainBefore = await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main');
    expect((await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} })).status).toBe(
      202,
    );
    const mergeStep = await w.claim();
    expect(mergeStep.step.kind).toBe('merge');
    return { w, buildId, convSha, mergeStepId: mergeStep.step.id, mainBefore };
  }
  const phaseOf = (w: Awaited<ReturnType<typeof setupGitWorld>>) =>
    w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()!.phase;
  const timeline = (w: Awaited<ReturnType<typeof setupGitWorld>>, buildId: string) =>
    w.s.db.select().from(messageTable).where(eq(messageTable.conversationId, buildId)).all();

  test('失败方式 1：合并步在跑时关闭 → 成功回报不快进 main，卡仍 closed，时间线说明', async () => {
    const { w, buildId, convSha, mergeStepId, mainBefore } = await mergeInFlight();
    expect(
      (await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { body: { phase: 'closed' } }))
        .status,
    ).toBe(200);
    await w.done(mergeStepId, { status: 'success', sessionId: 'pi-1', commit: convSha });
    expect(await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main')).toBe(mainBefore);
    expect(phaseOf(w)).toBe('closed');
    expect(timeline(w, buildId).some((m) => m.content === MERGE_NOT_LANDED_NOTE)).toBe(true);
    expect(timeline(w, buildId).some((m) => m.content === '🎉 任务已完成')).toBe(false);
  });

  test('失败方式 1b：回报进来时卡还在审核、落地的 git 检查期间被关闭 → 仍不快进', async () => {
    const { w, buildId, convSha, mergeStepId, mainBefore } = await mergeInFlight();
    // 在 applyMergeLanding 的第一个 git await（listBranches）期间关卡。
    const real = systemGitOps.listBranches.bind(systemGitOps);
    let closedInWindow = false;
    const spy = vi.spyOn(systemGitOps, 'listBranches').mockImplementation(async (...args) => {
      closedInWindow = true;
      await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { body: { phase: 'closed' } });
      return real(...args);
    });
    try {
      await w.done(mergeStepId, { status: 'success', sessionId: 'pi-1', commit: convSha });
    } finally {
      spy.mockRestore();
    }
    expect(closedInWindow).toBe(true);
    expect(await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main')).toBe(mainBefore);
    expect(phaseOf(w)).toBe('closed');
    expect(timeline(w, buildId).some((m) => m.content === MERGE_NOT_LANDED_NOTE)).toBe(true);
  });

  test('失败方式 2：关闭后重新打开回待开始 → 同样不落地，卡仍 todo', async () => {
    const { w, buildId, convSha, mergeStepId, mainBefore } = await mergeInFlight();
    expect(
      (await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { body: { phase: 'closed' } }))
        .status,
    ).toBe(200);
    expect(
      (await call(w.s.app, 'PATCH', `/api/todos/${w.todoId}`, { body: { phase: 'todo' } })).status,
    ).toBe(200);
    await w.done(mergeStepId, { status: 'success', sessionId: 'pi-1', commit: convSha });
    expect(await systemGitOps.resolveCommit(w.repoDir, 'refs/heads/main')).toBe(mainBefore);
    expect(phaseOf(w)).toBe('todo');
    expect(timeline(w, buildId).some((m) => m.content === MERGE_NOT_LANDED_NOTE)).toBe(true);
  });

  test('失败方式 3：同一 build 已有在途合并步（pending 或已领走）→ 再请求合并 409，不多排一个', async () => {
    const w = await setupGitWorld();
    const buildId = await w.startBuild();
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, withVerification('# Context\n方案 v1\n'));
    await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
    await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, { body: { action: 'confirm' } });
    const buildStep = await w.claim();
    const convSha = await fakePushConvBranch(w.repoDir, `pacman/conv-${buildId}`);
    await w.done(buildStep.step.id, {
      status: 'success',
      sessionId: 'pi-1',
      hasChanges: true,
      commit: convSha,
    });
    expect((await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} })).status).toBe(
      202,
    );
    expect((await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} })).status).toBe(
      409,
    );
    await w.claim();
    expect((await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} })).status).toBe(
      409,
    );
    const mergeSteps = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .all()
      .filter((r) => r.kind === 'merge');
    expect(mergeSteps).toHaveLength(1);
  });
});

describe('托管 repo provision 种子提交（M3b [设计]：空库不能 worktree）', () => {
  test('init bare 即立 refs/heads/main（空树种子）', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'pacman-seed-')), 'x.git');
    disposables.push(() => rmSync(dir, { recursive: true, force: true }));
    await systemGitOps.initBareRepo(dir);
    expect(await systemGitOps.resolveCommit(dir, 'refs/heads/main')).toBeNull();
    const sha = await systemGitOps.seedInitialCommit(dir, 'init x');
    expect(await systemGitOps.resolveCommit(dir, 'refs/heads/main')).toBe(sha);
    expect(await systemGitOps.isAncestor(dir, sha, sha)).toBe(true);
  });
});
