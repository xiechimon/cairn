// #1403 人工合并在 GitHub 形态项目上真合 PR：「完成 + 合并」此前让 daemon 把
// main 合进 conv 分支再推，todo 记 done 而 PR 没合（machines.ts applyMergeLanding
// 对 github 形态直接返回，「PR 面归后票」）。改为 server 经 REST merge 合 PR，带
// PR 当前 head 的 sha。失败方式先于实现固化：
//   ① PR 可合 → 请求带 head sha、squash；todo done；不入队 merge 步
//   ② GitHub 405（检查未绿/分支落后）→ 409 带 GitHub 原话；todo 留 review；不落宣告行
//   ③ GitHub 409（head 已变）→ 409；todo 留 review
//   ④ 未连 GitHub → 409 点名连接；零写请求
//   ⑤ PR 已在 GitHub 合并 → 直接收尾，不再调 merge
//   ⑥ 仓库不许 squash → merge_method = merge
//   ⑦ build 槽 Agent 缺「合并分支」开关 → 仍合并（执行合并的是 server，不是 agent）
//   ⑧ github 形态但本 build 无 PR → 既有 merge 步路径不变
//   ⑨ squash 标题是 GitHub 按提交数自选的（单提交取提交 message，daemon 的
//      `<kind>: <title>` 就此进 main）→ 传 commit_title = PR 标题 + (#n)
//   ⑩ 从 GitHub issue 导入的任务合并后 issue 仍开着 → commit_message 带
//      closes（同仓 #N，跨仓 owner/repo#N）；无来源不带

import { MERGE_ANNOUNCEMENT } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { bootServer, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

const HEAD = 'a'.repeat(40);
const MERGE_SHA = 'b'.repeat(40);

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

interface GithubState {
  pull?: { state: 'open' | 'closed'; merged: boolean; mergeCommitSha?: string | null };
  allowSquash?: boolean;
  mergeStatus?: number;
  mergeMessage?: string;
}

class GithubMock {
  calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  constructor(private readonly state: GithubState) {}

  readonly fetch = (
    input: string | URL,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    this.calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : null });
    if (method === 'PUT' && url.endsWith('/pulls/301/merge')) {
      const status = this.state.mergeStatus ?? 200;
      if (status !== 200)
        return Promise.resolve(res(status, { message: this.state.mergeMessage ?? 'no' }));
      return Promise.resolve(
        res(200, { merged: true, sha: MERGE_SHA, message: 'Pull Request successfully merged' }),
      );
    }
    if (method === 'GET' && url.endsWith('/pulls/301')) {
      const p = this.state.pull ?? { state: 'open', merged: false };
      return Promise.resolve(
        res(200, {
          number: 301,
          title: 'Fix the thing',
          state: p.state,
          merged: p.merged,
          merge_commit_sha: p.mergeCommitSha ?? null,
          head: { sha: HEAD },
        }),
      );
    }
    if (method === 'GET' && url.endsWith('/repos/octo/demo')) {
      return Promise.resolve(
        res(200, {
          full_name: 'octo/demo',
          allow_squash_merge: this.state.allowSquash ?? true,
          allow_merge_commit: true,
          allow_rebase_merge: false,
        }),
      );
    }
    return Promise.resolve(res(404, { message: 'Not Found' }));
  };
}

interface World {
  s: TestServer;
  todoId: string;
  buildId: string;
  mock: GithubMock;
  phase(): string;
  rows(): string[];
  mergeSteps(): number;
  puts(): { method: string; url: string; body: Record<string, unknown> | null }[];
}

function makeWorld(
  state: GithubState,
  opts: {
    connected?: boolean;
    prNumber?: number | null;
    agentTools?: string[];
    sourceRef?: string;
  } = {},
): World {
  const mock = new GithubMock(state);
  const s = bootServer({ githubFetch: mock.fetch });
  disposables.push(() => s.dispose());
  const rnd = Math.random().toString(36).slice(2, 8);
  const projectId = `proj-hm-${rnd}`;
  const todoId = `todo-hm-${rnd}`;
  const buildId = `build-hm-${rnd}`;
  const agentId = `agent-hm-${rnd}`;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `demo-${rnd}`,
      teamId: s.team.id,
      repoKind: 'github',
      githubRepo: 'octo/demo',
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: agentId,
      teamId: s.team.id,
      displayName: 'Builder',
      status: 'active',
      tools: opts.agentTools ?? ['推送分支'],
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'human merge target',
      spec: 'do it',
      phase: 'review',
      phaseAt: Date.now(),
      seqNum: 1,
      hasChanges: true,
      latestBuildId: buildId,
      assignment: { plan: null, build: { agentId } },
      ...(opts.sourceRef !== undefined
        ? { sourceKind: 'github-issue' as const, sourceRef: opts.sourceRef }
        : {}),
    })
    .run();
  const prNumber = opts.prNumber === undefined ? 301 : opts.prNumber;
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: Date.now() - 60_000,
      prUrl: prNumber === null ? null : `https://github.com/octo/demo/pull/${prNumber}`,
      prNumber,
    })
    .run();
  if (opts.connected !== false) {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: 'gho_test', scope: 'read:user repo' },
    );
  }
  return {
    s,
    todoId,
    buildId,
    mock,
    phase: () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!.phase,
    rows: () =>
      s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.conversationId, buildId))
        .all()
        .map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))),
    mergeSteps: () =>
      s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, buildId))
        .all()
        .filter((r) => r.kind === 'merge').length,
    puts: () => mock.calls.filter((c) => c.method === 'PUT'),
  };
}

async function merge(w: World) {
  const r = await req(w.s.app, 'POST', `/api/builds/${w.buildId}/merge`);
  return { status: r.status, text: await r.text() };
}

describe('#1403 human merge on a GitHub-form project merges the PR', () => {
  test('① mergeable → PUT merge with the head sha and squash; todo done; no merge step', async () => {
    const w = makeWorld({});
    const r = await merge(w);
    expect(r.status).toBe(202);
    expect(w.puts()).toHaveLength(1);
    expect(w.puts()[0]?.body).toMatchObject({ sha: HEAD, merge_method: 'squash' });
    expect(w.phase()).toBe('done');
    expect(w.mergeSteps()).toBe(0);
    expect(w.rows()).toContain(MERGE_ANNOUNCEMENT);
    expect(w.rows().some((c) => c.includes('#301') && c.includes(MERGE_SHA.slice(0, 7)))).toBe(
      true,
    );
  });

  test('② GitHub 405 → 409 with the GitHub message; todo stays in review; no announcement', async () => {
    const w = makeWorld({
      mergeStatus: 405,
      mergeMessage: 'Required status check "check" is expected.',
    });
    const r = await merge(w);
    expect(r.status).toBe(409);
    expect(r.text).toContain('Required status check');
    expect(w.phase()).toBe('review');
    expect(w.rows()).not.toContain(MERGE_ANNOUNCEMENT);
    expect(w.mergeSteps()).toBe(0);
  });

  test('③ GitHub 409 (head moved) → 409; todo stays in review', async () => {
    const w = makeWorld({
      mergeStatus: 409,
      mergeMessage: 'Head branch was modified. Review and try the merge again.',
    });
    const r = await merge(w);
    expect(r.status).toBe(409);
    expect(r.text).toContain('Head branch was modified');
    expect(w.phase()).toBe('review');
  });

  test('④ no GitHub connection → 409 naming the connection; no write request', async () => {
    const w = makeWorld({}, { connected: false });
    const r = await merge(w);
    expect(r.status).toBe(409);
    expect(r.text).toContain('GitHub');
    expect(w.puts()).toHaveLength(0);
    expect(w.phase()).toBe('review');
  });

  test('⑤ already merged on GitHub → todo done without calling merge', async () => {
    const w = makeWorld({ pull: { state: 'closed', merged: true, mergeCommitSha: MERGE_SHA } });
    const r = await merge(w);
    expect(r.status).toBe(202);
    expect(w.puts()).toHaveLength(0);
    expect(w.phase()).toBe('done');
  });

  test('⑥ repository does not allow squash → merge_method merge', async () => {
    const w = makeWorld({ allowSquash: false });
    await merge(w);
    expect(w.puts()[0]?.body).toMatchObject({ sha: HEAD, merge_method: 'merge' });
  });

  test('⑦ build agent without the merge switch → still merges (the server merges, not the agent)', async () => {
    const w = makeWorld({}, { agentTools: [] });
    const r = await merge(w);
    expect(r.status).toBe(202);
    expect(w.phase()).toBe('done');
  });

  test('⑨ commit_title is the PR title with the PR number', async () => {
    const w = makeWorld({});
    await merge(w);
    expect(w.puts()[0]?.body).toMatchObject({ commit_title: 'Fix the thing (#301)' });
    expect(w.puts()[0]?.body).not.toHaveProperty('commit_message');
  });

  test.each([
    ['github:octo/demo#55', 'closes #55'],
    ['github:other/repo#7', 'closes other/repo#7'],
  ])('⑩ source issue %s → commit_message %s', async (sourceRef, closing) => {
    const w = makeWorld({}, { sourceRef });
    await merge(w);
    expect(w.puts()[0]?.body).toMatchObject({ commit_message: closing });
  });

  test('⑧ GitHub-form build without a PR → existing merge-step path', async () => {
    const w = makeWorld({}, { prNumber: null, agentTools: ['推送分支', '合并分支'] });
    const r = await merge(w);
    expect(r.status).toBe(202);
    expect(w.mergeSteps()).toBe(1);
    expect(w.puts()).toHaveLength(0);
    expect(w.phase()).toBe('review');
  });
});
