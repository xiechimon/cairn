// #1403 段 2b（设计 D，2026-10-22 用户裁决）：GitHub 形态、build 记着 PR 的任务，人在
// pacman 里点合并 = server 经 GitHub REST 合并这张 PR（PUT pulls/{n}/merge，sha 绑本 build
// 最后推送的提交、squash、标题取 PR 标题、同仓 issue 来源带 closes 行），不再派机器合并步。
// GitHub 形态没有 PR、托管仓与本地仓照旧派合并步。失败方式先于实现列出（AGENTS.md 测试
// 规则），编号同 docs/verify/1403/seg2b-failure-modes.txt：
//   D1 合并成功 → 一次 PUT（请求体逐字段）、宣告行 + 合并行 + 完成行、done、停掉没人领的
//      verify 步、不建合并步、应答 {delegated:true}
//   D2 closes 行只给本仓 issue 来源（大小写不敏感）；别的仓、编排来源、无来源、畸形不带
//   D3 未连接 GitHub / 连接解不开 → 409 请连接，零出站、零行、零步
//   D4 PR head 不是最后推送的提交 → 409 点名两个短 SHA，不 PUT
//   D5 没有 checkpoint / 不是 40 位 SHA → 409，零出站
//   D6 PR 已合并 → 409 说对账会收尾，不 PUT；下一轮对账收尾
//   D7 PR 关闭未合并 → 409，不 PUT
//   D8 不是本 build 的 PR（head 仓不同 / head 仓为 null / head 分支不是工作分支）→ 409，不 PUT
//   D9 目标不是默认分支 → 409，不 PUT
//   D10 PUT 405/409/422/404/403（无限流信号）→ 409 带 GitHub 的 message（清洗、截断），
//       零行、相位不变；再点一次再发一次 PUT
//   D11 PUT 401 → 409 请重新连接
//   D12 PUT 200 但 merged=false → 按拒绝
//   D13 PUT 超时 / 网络错 / 5xx / 429 / 403 限流 → 202、宣告行 + 一行「没有明确答复」、
//       留在 review；之后对账读到已合并 → 收尾一次；读到 open → 不动
//   D14 PUT 200 应答体读不出 → 同 D13
//   D15 同一 build 两次并发点合并 → 一次 GET、一次 PUT，另一次 409
//   D16 PUT 在飞时对账 sweep（PR 已合并）→ 对账不读不写；只有 pacman 的合并行与一行完成行
//   D17 GET 在飞时人关卡 → 重读 409、不 PUT；PUT 在飞时人关卡、GitHub 合并成功 → 落两行、
//       不抛、相位留 closed
//   D18 failed 可恢复：合并 → 恢复后 done；拒绝 → 仍 failed、零行；无明确答复 → 恢复到
//       review 并落行
//   D19 failed 不可恢复 → 既有 409，零出站
//   D20 权限闸先于任何出站（#1217 守卫见 second-pr-guard.test.ts）
//   D21 building 等相位 → 409，零出站；done → 非法相位转移
//   D22 githubRepo 带 `.` / `..` 段 → 照旧合并步，零出站
//   D23 本地仓（托管同路）→ 照旧合并步，步完成即 done
//   D24 GitHub 形态无 PR → 照旧合并步，步完成即 done
//   D25 合并步在 GitHub 形态、有 PR 的 build 上完成 → 留 review、不落完成行、一行点名
//       PR；之后 GitHub 上合并 → 对账收尾
//   D26 token 只进 Authorization 头：不进 URL、错误文案、会话行
//   D27 REST 线形不变：202 {delegated:true}；拒绝 = 409 {error}
//   D28 合并请求在飞时对账把它当在飞步：不读不写
//   D29 GitHub 文本（合并提交、拒绝 message）进行与文案前按对账同一规则清洗
//   D30 build 不是任务的当前 build（重跑之后旧 build 的 PR 还开着）→ 409，零出站
//   D31 本 build 有步在跑（已领取的 verify 步之后还会推提交）→ 409，零出站；没人领的
//       verify / review 步不挡（收尾时停掉，D1）
//   D32 failed 卡上的拒绝文案不说「对账会收尾」（对账只读 review 卡）：指向看板拖到已完成
//   D33 连接在但解不开 → 请重新连接 GitHub
//   D34 合并步在到不了 done 的相位完成（#931 返工复用同一 build）→ 照旧抛非法相位转移、
//       不落行
//   D35 遗留合并步在 PR 已于 GitHub 合并之后推了「默认分支并进工作分支」的提交 → 那不是
//       本 build 的交付提交（合并步不算最后推送的工作），对账照常收尾
//   S1  列表读的失败分类：404 / 429 不读应答体，没带限流头的 403 才读（二级限流写在 message）

import { conversationBranch, MERGE_ANNOUNCEMENT, type Phase } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  githubConnection as githubConnectionTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { type FetchLike, githubListPulls } from '../src/lib/github.js';
import { type BuildDeps, completeStep, DONE_ROW, requestMerge } from '../src/services/builds.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { bootServer, req, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

/** 本 build 最后推送的提交（build 步回报的 checkpointCommit）。 */
const CP = '1a2b3c4d'.repeat(5);
/** GitHub 合并成功时落在 base 上的提交。 */
const MERGE_SHA = '9f8e7d6c'.repeat(5);
const TOKEN = 'gho_merge_test_token';
const REPO_ID = 4242;
const PR_TITLE = 'Add the reconcile hint';

type Answer =
  | { status: number; body?: unknown; raw?: string; headers?: Record<string, string> }
  | 'timeout'
  | 'network';

interface PullFake {
  state: 'open' | 'closed';
  merged: boolean;
  /** null = 响应里没有 title。 */
  title?: string | null;
  headSha?: string;
  headRef?: string;
  /** null = head.repo 为 null（fork 已删）。 */
  headRepoId?: number | null;
  baseRef?: string;
  defaultBranch?: string;
  mergeCommitSha?: string | null;
  mergedBy?: string | null;
}

interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function reply(status: number, text: string, headers: Record<string, string> = {}) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null },
    json: () => Promise.resolve().then(() => JSON.parse(text) as unknown),
    text: () => Promise.resolve(text),
  };
}

/** 假 GitHub：pulls/{n} 读、pulls/{n}/merge 写；对账要的 compare / 分支 PR 列表 /
 * check-runs 给最小应答。合并成功（200 + merged:true）时把 PR 翻成已合并，同 GitHub。 */
class GithubFake {
  requests: Recorded[] = [];
  mergeAnswer: Answer = {
    status: 200,
    body: { sha: MERGE_SHA, merged: true, message: 'Pull Request successfully merged' },
  };
  /** pulls/{n} 读到达、应答之前调用（网络窗竞态注入位）。 */
  onGet: (() => Promise<void> | void) | null = null;
  /** merge 写到达、应答之前调用。 */
  onPut: (() => Promise<void> | void) | null = null;
  /** compare 的 status（对账核对 checkpoint 是否在合并里；缺省 identical）。 */
  compareStatus = 'identical';
  constructor(
    readonly pulls: Record<number, PullFake>,
    readonly branchOf: (n: number) => string,
  ) {}

  gets = () => this.requests.filter((r) => r.method === 'GET' && /\/pulls\/\d+$/.test(r.url));
  puts = () => this.requests.filter((r) => r.method === 'PUT');

  readonly fetch: FetchLike = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    this.requests.push({ method, url, headers: { ...(init?.headers ?? {}) }, body: init?.body });
    const merge = url.match(/\/pulls\/(\d+)\/merge$/);
    if (merge !== null && method === 'PUT') {
      await this.onPut?.();
      const a = this.mergeAnswer;
      if (a === 'timeout') {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      if (a === 'network') throw new TypeError('fetch failed');
      const pull = this.pulls[Number(merge[1])];
      const body = a.body as { merged?: unknown; sha?: unknown } | undefined;
      if (a.status === 200 && body?.merged === true && pull !== undefined) {
        pull.state = 'closed';
        pull.merged = true;
        pull.mergeCommitSha = typeof body.sha === 'string' ? body.sha : null;
        pull.mergedBy = 'octo';
      }
      return reply(a.status, a.raw ?? JSON.stringify(a.body ?? {}), a.headers);
    }
    if (url.includes('/compare/')) {
      return reply(200, JSON.stringify({ status: this.compareStatus }));
    }
    if (/\/pulls\?/.test(url)) return reply(200, '[]');
    if (url.includes('/check-runs')) return reply(404, '{}');
    const m = url.match(/\/pulls\/(\d+)$/);
    if (m === null || method !== 'GET') return reply(404, '{}');
    await this.onGet?.();
    const n = Number(m[1]);
    const p = this.pulls[n];
    if (p === undefined) return reply(404, JSON.stringify({ message: 'Not Found' }));
    return reply(
      200,
      JSON.stringify({
        number: n,
        state: p.state,
        merged: p.merged,
        ...(p.title === null ? {} : { title: p.title ?? PR_TITLE }),
        merge_commit_sha: p.merged ? (p.mergeCommitSha ?? MERGE_SHA) : 'e'.repeat(40),
        merged_by: p.merged && p.mergedBy != null ? { login: p.mergedBy } : null,
        merged_at: p.merged ? new Date().toISOString() : null,
        closed_at: p.state === 'closed' ? new Date().toISOString() : null,
        head: {
          sha: p.headSha ?? CP,
          ref: p.headRef ?? this.branchOf(n),
          repo: p.headRepoId === null ? null : { id: p.headRepoId ?? REPO_ID },
        },
        base: {
          ref: p.baseRef ?? 'main',
          repo: { id: REPO_ID, default_branch: p.defaultBranch ?? 'main' },
        },
      }),
      { etag: '"p"' },
    );
  };
}

interface WorldOpts {
  phase?: Phase;
  repoKind?: 'github' | 'local';
  githubRepo?: string;
  /** null = build 上没有 PR。 */
  prNumber?: number | null;
  /** 本 build 执行步回报的 checkpointCommit；null = 执行步没回报。 */
  checkpoint?: string | null;
  /** 执行步的状态（缺省 done）。 */
  buildStepStatus?: 'done' | 'failed';
  /** 缺省 true：团队连着 GitHub。 */
  connected?: boolean;
  /** build 槽 Agent 的工具开关（缺省两开关齐备）。 */
  tools?: string[];
  source?: { kind: 'github-issue' | 'github-issue-self' | 'orchestration'; ref: string } | null;
  /** 本 build 有一条没人领的 verify 步。 */
  pendingVerify?: boolean;
  pull?: Partial<PullFake>;
}

interface World {
  s: TestServer;
  fake: GithubFake;
  deps: BuildDeps;
  todoId: string;
  buildId: string;
  prNumber: number;
  phase(): Phase;
  systemRows(): string[];
  userRows(): { content: string; actor: string | null }[];
  steps(): { kind: string; status: string }[];
  sweep(): Promise<void>;
}

let seq = 0;

function makeWorld(opts: WorldOpts = {}): World {
  seq += 1;
  const rnd = `${seq}-${Math.random().toString(36).slice(2, 8)}`;
  const base = Date.now();
  const projectId = `proj-mapi-${rnd}`;
  const todoId = `todo-mapi-${rnd}`;
  const buildId = `build-mapi-${rnd}`;
  const agentId = `agent-mapi-${rnd}`;
  const prNumber = opts.prNumber === undefined ? 201 : opts.prNumber;
  const repoKind = opts.repoKind ?? 'github';
  const fake = new GithubFake(
    prNumber === null ? {} : { [prNumber]: { state: 'open', merged: false, ...opts.pull } },
    () => conversationBranch(buildId),
  );
  const s = bootServer({ githubFetch: fake.fetch });
  disposables.push(() => s.dispose());
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `mapi-${rnd}`,
      teamId: s.team.id,
      repoKind,
      githubRepo: repoKind === 'github' ? (opts.githubRepo ?? 'octo/demo') : null,
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: agentId,
      teamId: s.team.id,
      displayName: 'merge-api-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
      tools: opts.tools ?? ['合并分支', '推送分支'],
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'merge through the API',
      spec: 'do it',
      phase: opts.phase ?? 'review',
      phaseAt: base,
      seqNum: 1,
      hasChanges: true,
      assignment: { plan: null, build: { agentId } },
      sourceKind: opts.source?.kind ?? null,
      sourceRef: opts.source?.ref ?? null,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base - 60_000,
      prUrl: prNumber === null ? null : `https://github.com/octo/demo/pull/${prNumber}`,
      prNumber,
    })
    .run();
  s.db.update(todoTable).set({ latestBuildId: buildId }).where(eq(todoTable.id, todoId)).run();
  const checkpoint = opts.checkpoint === undefined ? CP : opts.checkpoint;
  s.db
    .insert(stepTable)
    .values({
      id: `step-build-${rnd}`,
      buildId,
      kind: 'build',
      status: opts.buildStepStatus ?? 'done',
      checkpointCommit: checkpoint,
      createdAt: base - 30_000,
    })
    .run();
  if (opts.pendingVerify === true) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-verify-${rnd}`,
        buildId,
        kind: 'verify',
        status: 'pending',
        createdAt: base - 10_000,
      })
      .run();
  }
  if (opts.connected !== false) {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: TOKEN, scope: 'read:user repo' },
    );
  }
  const deps: BuildDeps = { ...s.svc, box: s.secretBox, githubFetch: fake.fetch };
  const poller = createCiPoller({ ...s.svc, box: s.secretBox }, { githubFetch: fake.fetch });
  const messages = () =>
    s.db.select().from(messageTable).where(eq(messageTable.conversationId, buildId)).all();
  return {
    s,
    fake,
    deps,
    todoId,
    buildId,
    prNumber: prNumber ?? 0,
    phase: () =>
      s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.phase as Phase,
    systemRows: () =>
      messages()
        .filter((r) => r.role === 'system')
        .map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))),
    userRows: () =>
      messages()
        .filter((r) => r.role === 'user')
        .map((r) => ({ content: String(r.content), actor: r.actor ?? null })),
    steps: () =>
      s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, buildId))
        .all()
        .map((r) => ({ kind: r.kind, status: r.status })),
    sweep: () => poller.sweep(),
  };
}

async function refusal(p: Promise<unknown>): Promise<HttpError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected requestMerge to refuse');
}

const MERGED_ROW = `PR #201 已由 pacman 经 GitHub 合并（squash，合并提交 ${MERGE_SHA.slice(0, 7)}）`;

/** 拒绝之后的世界：零行、零合并步、相位不变。 */
function expectUntouched(w: World, phase: Phase = 'review'): void {
  expect(w.systemRows()).toEqual([]);
  expect(w.userRows()).toEqual([]);
  expect(w.steps().filter((r) => r.kind === 'merge')).toEqual([]);
  expect(w.phase()).toBe(phase);
}

describe('#1403 segment 2b: the server merges the PR through the GitHub API', () => {
  test('[2b-D1] review card, own open PR at the last checkpoint → one PUT with sha, squash and the PR title; rows; done', async () => {
    const w = makeWorld({ pendingVerify: true });
    const result = await requestMerge(w.deps, w.buildId, 'Xmon');
    expect(result).toEqual({ delegated: true });
    expect(w.fake.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'GET https://api.github.com/repos/octo/demo/pulls/201',
      'PUT https://api.github.com/repos/octo/demo/pulls/201/merge',
    ]);
    const put = w.fake.puts()[0] as Recorded;
    expect(JSON.parse(put.body ?? 'null')).toEqual({
      sha: CP,
      merge_method: 'squash',
      commit_title: `${PR_TITLE} (#201)`,
    });
    expect(put.headers['content-type']).toBe('application/json');
    expect(w.userRows()).toEqual([{ content: MERGE_ANNOUNCEMENT, actor: 'Xmon' }]);
    expect(w.systemRows()).toEqual([MERGED_ROW, DONE_ROW]);
    expect(w.phase()).toBe('done');
    expect(w.steps().find((r) => r.kind === 'verify')?.status).toBe('stopped');
    expect(w.steps().filter((r) => r.kind === 'merge')).toEqual([]);
  });

  test.each([
    [
      'an issue of the same repository',
      { kind: 'github-issue', ref: 'github:octo/demo#77' },
      'closes #77',
    ],
    [
      'a self-created issue, owner and repo in another case',
      { kind: 'github-issue-self', ref: 'github:Octo/DEMO#78' },
      'closes #78',
    ],
    ['an issue of another repository', { kind: 'github-issue', ref: 'github:other/demo#77' }, null],
    [
      'an orchestration source',
      { kind: 'orchestration', ref: 'chief:0190f0f0-0000-7000-8000-000000000000' },
      null,
    ],
    [
      'an orchestration source holding an issue-shaped ref',
      { kind: 'orchestration', ref: 'github:octo/demo#79' },
      null,
    ],
    ['a malformed issue ref', { kind: 'github-issue', ref: 'github:octo/demo#x' }, null],
    ['no source', null, null],
  ] as const)('[2b-D2] closing line for %s', async (_name, source, line) => {
    const w = makeWorld({ source });
    await requestMerge(w.deps, w.buildId);
    const body = JSON.parse((w.fake.puts()[0] as Recorded).body ?? 'null') as Record<
      string,
      unknown
    >;
    if (line === null) expect(body).not.toHaveProperty('commit_message');
    else expect(body.commit_message).toBe(line);
  });

  test('[2b-D3] no GitHub connection → 409 asking to connect GitHub; no request, no row, no step', async () => {
    const w = makeWorld({ connected: false });
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(err.message).toContain('连接 GitHub');
    expect(err.message).toContain('PR #201');
    expect(w.fake.requests).toEqual([]);
    expectUntouched(w);
  });

  test('[2b-D3b] a connection the box cannot decrypt → the same 409; no request', async () => {
    const w = makeWorld();
    w.s.db
      .update(githubConnectionTable)
      .set({ accessTokenCipher: 'not-a-sealed-token' })
      .where(eq(githubConnectionTable.teamId, w.s.team.id))
      .run();
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(err.message).toContain('重新连接 GitHub');
    expect(w.fake.requests).toEqual([]);
    expectUntouched(w);
  });

  test('[2b-D30] the build is not the todo’s current build → 409; no request', async () => {
    const w = makeWorld();
    const newer = `${w.buildId}-newer`;
    w.s.db
      .insert(buildTable)
      .values({
        id: newer,
        todoId: w.todoId,
        withPlan: false,
        triggerSource: 'schedule',
        createdAt: Date.now(),
      })
      .run();
    w.s.db.update(todoTable).set({ latestBuildId: newer }).where(eq(todoTable.id, w.todoId)).run();
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(w.fake.requests).toEqual([]);
    expectUntouched(w);
  });

  test.each([
    ['a claimed verify step', 'verify', 'claimed'],
    ['a claimed review step', 'review', 'claimed'],
    ['a pending build step', 'build', 'pending'],
  ] as const)('[2b-D31] %s on the build → 409; no request', async (_name, kind, status) => {
    const w = makeWorld();
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-busy-${w.buildId}`,
        buildId: w.buildId,
        kind,
        status,
        createdAt: Date.now(),
      })
      .run();
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(w.fake.requests).toEqual([]);
    expect(w.systemRows()).toEqual([]);
    expect(w.userRows()).toEqual([]);
    expect(w.phase()).toBe('review');
  });

  test('[2b-D31b] a step claimed while the PR read is in flight → 409; no PUT', async () => {
    const w = makeWorld();
    w.fake.onGet = () => {
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-late-${w.buildId}`,
          buildId: w.buildId,
          kind: 'verify',
          status: 'claimed',
          createdAt: Date.now(),
        })
        .run();
    };
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(w.fake.puts()).toEqual([]);
    expectUntouched(w);
  });

  test.each([
    ['the PR is already merged', { pull: { state: 'closed', merged: true, mergedBy: 'octo' } }],
    ['no GitHub connection', { connected: false }],
    ['the PR head moved', { pull: { headSha: 'abcdef01'.repeat(5) } }],
    ['no checkpoint', { checkpoint: null }],
  ] as const)(
    '[2b-D32] failed card, %s → the refusal points to the board, not the reconcile',
    async (_name, o) => {
      // restorable (the PR is recorded on the build) even without a checkpoint
      const w = makeWorld({ phase: 'failed', ...o });
      const err = await refusal(requestMerge(w.deps, w.buildId));
      expect(err.status).toBe(409);
      expect(err.message).toContain('拖到已完成');
      expect(err.message).not.toContain('对账');
      expectUntouched(w, 'failed');
    },
  );

  test('[2b-D4] the PR head is not the last pushed commit → 409 naming both short shas; no PUT', async () => {
    const head = 'abcdef01'.repeat(5);
    const w = makeWorld({ pull: { headSha: head } });
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(err.message).toContain(head.slice(0, 7));
    expect(err.message).toContain(CP.slice(0, 7));
    expect(w.fake.gets()).toHaveLength(1);
    expect(w.fake.puts()).toEqual([]);
    expectUntouched(w);
    // the refusal leaves nothing behind: a second press reads the PR again
    await refusal(requestMerge(w.deps, w.buildId));
    expect(w.fake.gets()).toHaveLength(2);
  });

  test.each([
    ['no checkpoint', null],
    ['a short sha', 'abc1234'],
    ['upper-case hex', CP.toUpperCase()],
    ['a ref-like value', `${'a'.repeat(39)}/`],
  ] as const)('[2b-D5] %s → 409; no request carries it', async (_name, checkpoint) => {
    const w = makeWorld({ checkpoint });
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(w.fake.requests).toEqual([]);
    expectUntouched(w);
  });

  test('[2b-D6] the PR is already merged → 409 saying the reconcile finishes it; no PUT; the next sweep does', async () => {
    const w = makeWorld({ pull: { state: 'closed', merged: true, mergedBy: 'octo' } });
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(err.message).toContain('已在 GitHub 合并');
    // the reconcile checks before it finishes (own PR, default branch, last pushed commit)
    expect(err.message).toContain('核对不上');
    expect(w.fake.puts()).toEqual([]);
    expectUntouched(w);
    await w.sweep();
    expect(w.phase()).toBe('done');
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
  });

  test('[2b-D7] the PR is closed and not merged → 409; no PUT', async () => {
    const w = makeWorld({ pull: { state: 'closed', merged: false } });
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(err.message).toContain('关闭');
    expect(w.fake.puts()).toEqual([]);
    expectUntouched(w);
  });

  test.each([
    ['the head repository is another one (a fork)', { headRepoId: 9999 }],
    ['the head repository is gone (null)', { headRepoId: null }],
    ['the head branch is not the build’s conversation branch', { headRef: 'feature/other' }],
  ] as const)('[2b-D8] %s → 409; no PUT', async (_name, pull) => {
    const w = makeWorld({ pull });
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(err.message).toContain('工作分支');
    expect(w.fake.puts()).toEqual([]);
    expectUntouched(w);
  });

  test('[2b-D9] the PR targets a branch other than the default → 409; no PUT', async () => {
    const w = makeWorld({ pull: { baseRef: 'release' } });
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(err.message).toContain('默认分支');
    expect(w.fake.puts()).toEqual([]);
    expectUntouched(w);
  });

  test('[2b-D9b] the read lacks the title → 409 (unreadable); no PUT', async () => {
    const w = makeWorld({ pull: { title: null } });
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(w.fake.puts()).toEqual([]);
    expectUntouched(w);
  });

  test.each([
    [405, 'Required status check "check" is expected.'],
    [409, 'Head branch was modified. Review and try the merge again.'],
    [422, 'Validation Failed'],
    [404, 'Not Found'],
    [403, 'Resource not accessible by integration'],
  ] as const)(
    '[2b-D10] PUT answers %i → 409 with GitHub’s message; nothing written; a second press tries again',
    async (status, message) => {
      const w = makeWorld();
      w.fake.mergeAnswer = {
        status,
        body: { message, documentation_url: 'https://docs.github.com' },
      };
      const err = await refusal(requestMerge(w.deps, w.buildId));
      expect(err.status).toBe(409);
      expect(err.message).toContain('GitHub 拒绝合并 PR #201');
      expect(err.message).toContain(`HTTP ${status}`);
      expect(err.message).toContain(message);
      expect(err.message).toContain('直接在那里合并');
      expectUntouched(w);
      await refusal(requestMerge(w.deps, w.buildId));
      expect(w.fake.puts()).toHaveLength(2);
      expectUntouched(w);
    },
  );

  test('[2b-D10b/D29] the refusal text is cleaned: format characters removed, 100 characters at most', async () => {
    const w = makeWorld();
    const message = `Required‮ review​ missing ${'x'.repeat(300)}`;
    w.fake.mergeAnswer = { status: 405, body: { message } };
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.message).toContain('Required review missing');
    expect(err.message).not.toMatch(/[‮​]/);
    expect(err.message).not.toContain('x'.repeat(120));
    expect(err.message).toContain('…');
  });

  test('[2b-D11] PUT answers 401 → 409 asking to reconnect GitHub; nothing written', async () => {
    const w = makeWorld();
    w.fake.mergeAnswer = { status: 401, body: { message: 'Bad credentials' } };
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(err.message).toContain('重新连接 GitHub');
    expectUntouched(w);
  });

  test('[2b-D12] PUT answers 200 with merged false → a refusal; nothing written', async () => {
    const w = makeWorld();
    w.fake.mergeAnswer = {
      status: 200,
      body: { sha: null, merged: false, message: 'Merge conflict' },
    };
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(err.message).toContain('Merge conflict');
    expectUntouched(w);
  });

  test.each([
    ['a timeout', 'timeout'],
    ['a network error', 'network'],
    ['500', { status: 500, body: { message: 'Server Error' } }],
    ['502', { status: 502, raw: '<html>bad gateway</html>' }],
    ['503', { status: 503, body: { message: 'Service Unavailable' } }],
    ['429', { status: 429, body: { message: 'Too Many Requests' } }],
    [
      '403 with x-ratelimit-remaining 0',
      {
        status: 403,
        body: { message: 'API rate limit exceeded' },
        headers: { 'x-ratelimit-remaining': '0' },
      },
    ],
    [
      '403 with retry-after',
      { status: 403, body: { message: 'slow down' }, headers: { 'retry-after': '60' } },
    ],
    [
      '403 naming a secondary rate limit',
      { status: 403, body: { message: 'You have exceeded a secondary rate limit.' } },
    ],
    ['200 that is not JSON', { status: 200, raw: 'not json' }],
    ['200 without merged', { status: 200, body: { sha: MERGE_SHA } }],
    ['200 merged without sha', { status: 200, body: { merged: true } }],
  ] as const)(
    '[2b-D13/D14] PUT gives no clear answer (%s) → 202, the announcement and one row; review stays',
    async (_name, answer) => {
      const w = makeWorld();
      w.fake.mergeAnswer = answer as Answer;
      expect(await requestMerge(w.deps, w.buildId, 'Xmon')).toEqual({ delegated: true });
      expect(w.userRows()).toEqual([{ content: MERGE_ANNOUNCEMENT, actor: 'Xmon' }]);
      expect(w.systemRows()).toHaveLength(1);
      expect(w.systemRows()[0]).toContain('PR #201');
      expect(w.systemRows()[0]).toContain('没有明确答复');
      expect(w.phase()).toBe('review');
      expect(w.steps().filter((r) => r.kind === 'merge')).toEqual([]);
    },
  );

  test('[2b-D13b] after no clear answer, a sweep that reads the PR merged finishes the card once', async () => {
    const w = makeWorld();
    w.fake.mergeAnswer = 'timeout';
    await requestMerge(w.deps, w.buildId);
    const pull = w.fake.pulls[201] as PullFake;
    pull.state = 'closed';
    pull.merged = true;
    pull.mergedBy = 'octo';
    await w.sweep();
    expect(w.phase()).toBe('done');
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
    expect(w.systemRows().filter((c) => c.startsWith('PR #201 已在 GitHub 合并'))).toHaveLength(1);
    await w.sweep();
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
  });

  test('[2b-D13c] after no clear answer, a sweep that reads the PR open changes nothing', async () => {
    const w = makeWorld();
    w.fake.mergeAnswer = { status: 502, raw: '' };
    await requestMerge(w.deps, w.buildId);
    const before = w.systemRows();
    await w.sweep();
    expect(w.phase()).toBe('review');
    expect(w.systemRows()).toEqual(before);
  });

  test('[2b-D15] two presses at once → one GET, one PUT; the other press gets 409', async () => {
    const w = makeWorld();
    w.fake.onGet = () => new Promise((r) => setTimeout(r, 20));
    const outcomes = await Promise.allSettled([
      requestMerge(w.deps, w.buildId),
      requestMerge(w.deps, w.buildId),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(HttpError);
    expect((rejected.reason as HttpError).status).toBe(409);
    expect(w.fake.gets()).toHaveLength(1);
    expect(w.fake.puts()).toHaveLength(1);
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
  });

  test('[2b-D16] the reconcile sweeps while the PUT is in flight and the PR reads merged → it neither reads nor writes', async () => {
    const w = makeWorld();
    let swept = 0;
    w.fake.onPut = async () => {
      w.fake.onPut = null;
      const pull = w.fake.pulls[201] as PullFake;
      pull.state = 'closed';
      pull.merged = true;
      pull.mergedBy = 'octo';
      const before = w.fake.requests.length;
      await w.sweep();
      swept = w.fake.requests.length - before;
    };
    await requestMerge(w.deps, w.buildId);
    expect(swept).toBe(0);
    expect(w.systemRows()).toEqual([MERGED_ROW, DONE_ROW]);
    expect(w.phase()).toBe('done');
  });

  test('[2b-D28] the reconcile sweeps while the PR read is in flight → it neither reads nor writes', async () => {
    const w = makeWorld();
    let swept = -1;
    w.fake.onGet = async () => {
      w.fake.onGet = null;
      const before = w.fake.requests.length;
      await w.sweep();
      swept = w.fake.requests.length - before;
    };
    await requestMerge(w.deps, w.buildId);
    expect(swept).toBe(0);
    expect(w.fake.gets()).toHaveLength(1);
  });

  test('[2b-D17a] the card is closed while the PR read is in flight → refused at the re-read; no PUT', async () => {
    const w = makeWorld();
    w.fake.onGet = () => {
      w.s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, w.todoId)).run();
    };
    await expect(requestMerge(w.deps, w.buildId)).rejects.toThrow(
      'illegal phase transition: closed -> done',
    );
    expect(w.fake.puts()).toEqual([]);
    expectUntouched(w, 'closed');
  });

  test('[2b-D17b] the card is closed while the PUT is in flight and GitHub merges → the rows, no throw, phase stays closed', async () => {
    const w = makeWorld();
    w.fake.onPut = () => {
      w.s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, w.todoId)).run();
    };
    expect(await requestMerge(w.deps, w.buildId, 'Xmon')).toEqual({ delegated: true });
    expect(w.userRows()).toEqual([{ content: MERGE_ANNOUNCEMENT, actor: 'Xmon' }]);
    expect(w.systemRows()).toEqual([MERGED_ROW]);
    expect(w.phase()).toBe('closed');
  });

  test('[2b-D18a] failed card that can be restored, GitHub merges → restored, then done', async () => {
    const w = makeWorld({ phase: 'failed' });
    expect(await requestMerge(w.deps, w.buildId)).toEqual({ delegated: true });
    expect(w.phase()).toBe('done');
    expect(w.systemRows()).toEqual([MERGED_ROW, DONE_ROW]);
  });

  test('[2b-D18b] failed card that can be restored, GitHub refuses → stays failed, no row', async () => {
    const w = makeWorld({ phase: 'failed' });
    w.fake.mergeAnswer = { status: 405, body: { message: 'Pull Request is not mergeable' } };
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expectUntouched(w, 'failed');
  });

  test('[2b-D18c] failed card that can be restored, no clear answer → restored to review with the row', async () => {
    const w = makeWorld({ phase: 'failed' });
    w.fake.mergeAnswer = 'network';
    expect(await requestMerge(w.deps, w.buildId)).toEqual({ delegated: true });
    expect(w.phase()).toBe('review');
    expect(w.systemRows()).toHaveLength(1);
    expect(w.systemRows()[0]).toContain('没有明确答复');
  });

  test('[2b-D19] failed card whose build leg did not finish → the existing 409; no request', async () => {
    const w = makeWorld({ phase: 'failed', buildStepStatus: 'failed' });
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(err.message).toContain('审核关口恢复仅对本轮已交付的 build 开放');
    expect(w.fake.requests).toEqual([]);
    expectUntouched(w, 'failed');
  });

  test('[2b-D20] the permission gate refuses before any request', async () => {
    const w = makeWorld({ tools: ['推送分支'] });
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(403);
    expect(err.message).toContain('合并分支');
    expect(w.fake.requests).toEqual([]);
    expectUntouched(w);
  });

  test('[2b-D21] a building card → 409; no request, no row', async () => {
    const w = makeWorld({ phase: 'building' });
    const err = await refusal(requestMerge(w.deps, w.buildId));
    expect(err.status).toBe(409);
    expect(w.fake.requests).toEqual([]);
    expectUntouched(w, 'building');
  });

  test('[2b-D21b] a done card → illegal phase transition; no request', async () => {
    const w = makeWorld({ phase: 'done' });
    await expect(requestMerge(w.deps, w.buildId)).rejects.toThrow(
      'illegal phase transition: done -> done',
    );
    expect(w.fake.requests).toEqual([]);
  });

  test('[2b-D22] githubRepo with a ".." segment → the merge step as before; no request', async () => {
    const w = makeWorld({ githubRepo: 'octo/..' });
    expect(await requestMerge(w.deps, w.buildId)).toEqual({ delegated: true });
    expect(w.steps().filter((r) => r.kind === 'merge')).toEqual([
      { kind: 'merge', status: 'pending' },
    ]);
    expect(w.fake.requests).toEqual([]);
  });

  test('[2b-D23] local repository → the merge step as before; its done finishes the card', async () => {
    const w = makeWorld({ repoKind: 'local', prNumber: null });
    expect(await requestMerge(w.deps, w.buildId)).toEqual({ delegated: true });
    expect(w.fake.requests).toEqual([]);
    const mergeStep = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, w.buildId))
      .all()
      .find((r) => r.kind === 'merge');
    expect(mergeStep).toBeDefined();
    completeStep(w.deps, mergeStep?.id as string);
    expect(w.phase()).toBe('done');
    expect(w.systemRows()).toEqual([DONE_ROW]);
  });

  test('[2b-D24] GitHub form without a recorded PR → the merge step as before; its done finishes the card', async () => {
    const w = makeWorld({ prNumber: null });
    expect(await requestMerge(w.deps, w.buildId)).toEqual({ delegated: true });
    expect(w.fake.requests).toEqual([]);
    const mergeStep = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, w.buildId))
      .all()
      .find((r) => r.kind === 'merge');
    completeStep(w.deps, mergeStep?.id as string);
    expect(w.phase()).toBe('done');
    expect(w.systemRows()).toEqual([DONE_ROW]);
  });

  test('[2b-D25] a merge step completes on a GitHub build with a PR → stays in review, one row naming the PR; a later GitHub merge is finished by the reconcile', async () => {
    const w = makeWorld();
    const mergeStepId = `step-merge-old-${w.buildId}`;
    w.s.db
      .insert(stepTable)
      .values({
        id: mergeStepId,
        buildId: w.buildId,
        kind: 'merge',
        status: 'claimed',
        createdAt: Date.now(),
      })
      .run();
    completeStep(w.deps, mergeStepId);
    expect(w.phase()).toBe('review');
    expect(w.systemRows()).toHaveLength(1);
    expect(w.systemRows()[0]).toContain('PR #201');
    expect(w.systemRows()).not.toContain(DONE_ROW);
    const pull = w.fake.pulls[201] as PullFake;
    pull.state = 'closed';
    pull.merged = true;
    pull.mergedBy = 'octo';
    await w.sweep();
    expect(w.phase()).toBe('done');
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
  });

  test('[2b-D34] a merge step completes while the card cannot reach done (planning) → illegal phase transition, no row', () => {
    const w = makeWorld({ phase: 'planning' });
    const mergeStepId = `step-merge-planning-${w.buildId}`;
    w.s.db
      .insert(stepTable)
      .values({
        id: mergeStepId,
        buildId: w.buildId,
        kind: 'merge',
        status: 'claimed',
        createdAt: Date.now(),
      })
      .run();
    expect(() => completeStep(w.deps, mergeStepId)).toThrow(
      'illegal phase transition: planning -> done',
    );
    expect(w.systemRows()).toEqual([]);
    expect(w.phase()).toBe('planning');
  });

  test('[2b-D35] a leftover merge step pushes a merge of the default branch after the PR merged on GitHub → that commit is not the build’s last pushed work; the sweep finishes the card', async () => {
    const w = makeWorld({ pull: { state: 'closed', merged: true, mergedBy: 'octo' } });
    w.fake.compareStatus = 'behind'; // the merge step's commit is not in the merged head
    const mergeStepId = `step-merge-left-${w.buildId}`;
    w.s.db
      .insert(stepTable)
      .values({
        id: mergeStepId,
        buildId: w.buildId,
        kind: 'merge',
        status: 'claimed',
        // its done report carries the commit it pushed (finishStep writes it before completeStep)
        checkpointCommit: 'cafe0123'.repeat(5),
        lastHeartbeatAt: Date.now(),
        createdAt: Date.now(),
      })
      .run();
    completeStep(w.deps, mergeStepId);
    expect(w.phase()).toBe('review');
    await w.sweep();
    expect(w.phase()).toBe('done');
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
  });

  test('[2b-S1] a list answer of 404 or 429 is classified without reading its body; a 403 without rate-limit headers reads it', async () => {
    const text = vi.fn(() => Promise.resolve('{"message":"API rate limit exceeded"}'));
    const answer = (status: number) => () =>
      Promise.resolve({
        ok: false,
        status,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
        text,
      });
    const opts = { state: 'open', page: 1, perPage: 10, timeoutMs: 1_000 } as const;
    expect(await githubListPulls(answer(404), 't', 'o', 'r', opts)).toEqual({
      ok: false,
      failure: { kind: 'status', status: 404 },
    });
    expect(await githubListPulls(answer(429), 't', 'o', 'r', opts)).toEqual({
      ok: false,
      failure: { kind: 'rate-limited', status: 429 },
    });
    expect(text).not.toHaveBeenCalled();
    expect(await githubListPulls(answer(403), 't', 'o', 'r', opts)).toEqual({
      ok: false,
      failure: { kind: 'rate-limited', status: 403 },
    });
    expect(text).toHaveBeenCalledTimes(1);
  });

  test('[2b-D26] the token travels only in the Authorization header', async () => {
    const merged = makeWorld();
    await requestMerge(merged.deps, merged.buildId);
    const refused = makeWorld();
    refused.fake.mergeAnswer = { status: 422, body: { message: 'Validation Failed' } };
    const err = await refusal(requestMerge(refused.deps, refused.buildId));
    for (const w of [merged, refused]) {
      expect(w.fake.requests.length).toBeGreaterThanOrEqual(2);
      for (const r of w.fake.requests) {
        expect(r.url).not.toContain(TOKEN);
        expect(r.body ?? '').not.toContain(TOKEN);
        expect(r.headers.authorization).toBe(`Bearer ${TOKEN}`);
      }
      for (const row of [...w.systemRows(), ...w.userRows().map((u) => u.content)]) {
        expect(row).not.toContain(TOKEN);
      }
    }
    expect(err.message).not.toContain(TOKEN);
  });

  test('[2b-D27] REST: 202 {delegated:true} when GitHub merges; 409 {error} when it refuses', async () => {
    const ok = makeWorld();
    const res = await req(ok.s.app, 'POST', `/api/builds/${ok.buildId}/merge`);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ delegated: true });
    expect(ok.phase()).toBe('done');
    const no = makeWorld();
    no.fake.mergeAnswer = { status: 405, body: { message: 'Pull Request is not mergeable' } };
    const res2 = await req(no.s.app, 'POST', `/api/builds/${no.buildId}/merge`);
    expect(res2.status).toBe(409);
    const body = (await res2.json()) as { error: string };
    expect(body.error).toContain('Pull Request is not mergeable');
    expectUntouched(no);
  });
});
