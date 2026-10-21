// #1403 PR 对账（ci-loop 第二候选集）：review 关口上的 GitHub 形态 build，PR
// 在 GitHub 上的终态回写 pacman。失败方式先于实现固化（AGENTS.md 测试规则）：
//   ① PR 已在 GitHub 合并（不论谁合的）→ todo 停在 review 永不收尾
//   ② PR 关闭未合并 → todo 仍挂 review，看不出这张 PR 已经没了
//   ③ PR 仍 open → 对账不得改任何东西
//   ④ 读不到（限流/404/网络）→ 不得据此推进或打回（fail-open，下轮重试）
//   ⑤ 网络窗口内人工改了相位 → 对账不得回写
//   ⑥ 同一 todo 更旧的 PR build 已关闭（spec 23 被取代分支）而最新 PR 仍 open
//      → 不得把 todo 打成 failed
//   ⑦ 已 done 之后再扫 → 不再是候选，不重复收尾
// pr-gate 第一轮（#1414）补的失败方式：
//   ⑧ todo 的当前 build 没有 PR（#1217 守卫下不开新 PR / 探针失败），更旧
//      build 的 PR 已合并或已关闭 → 不得替当前 build 收尾或打回
//   ⑨ 两个 build 指向同一个 PR（#1217）→ 只按当前 build 读一次、写在它上面
//   ⑩ merge 步在飞（agent 正在合并）→ 对账不插手；先后两次收尾只落一条完成行
//   ⑪ 未连接 GitHub（匿名 60 次/小时）→ 每个候选 5 分钟内最多读一次
//   ⑫ 条件读 304 → 复用上轮状态；网络抛错 → 不动，下轮重读
//   ⑬ 合并行写明是谁合并的
// pr-gate 第二轮（#1414）补的：
//   ⑭ PR 合并之后同分支又推了提交（修复轮）→ 那个提交没进 main，不得收尾；
//      GitHub 的 update-branch 合并提交盖在 checkpoint 之上 → 仍算已合并
//   ⑮ 在飞步口径：waiting_quota 的 merge 步算在飞；没人领的 verify / review
//      步不挡对账（离线的 Verifier 不能让卡永远停在 review）
//   ⑯ 网络窗口里 todo 换了当前 build → 不写
//   ⑰ 错误状态码带着 PR 形的响应体 → 仍按读不到处理
// pr-gate 第三轮（#1414）补的：
//   ⑱ 人在对账收尾之后把卡拖回 review（done→review 重开、closed→review、
//      failed→review 恢复）→ 下一轮不得再收尾一次（重复的合并行与完成行）、
//      不得覆盖 errorMessage；判据 = PR 的合并/关闭时刻早于卡进入 review 的
//      时刻（GitHub 时间戳到秒，按秒比较）
//   ⑲ PR 合并进了非默认分支 → 改动不在 main，不收尾，提示一次
//   ⑳ 收尾时还排着没人领的 verify / review 步 → 停掉，不让它们之后在已收尾
//      的卡上跑（blocking 审核会把 done 往 planning 推而抛错）
//   ㉑ 提示路径每轮重复 compare → compare 结果按 (checkpoint, head) 缓存，
//      提示只落一次
//   ㉒ compare 读不到（429 / 5xx / 网络）→ 不动，下轮重读
//   ㉓ compare 网络窗内相位被人改 → 不写
//   ㉔ 多个执行步：按最后完成的那一步的 checkpoint 判
//   ㉕ checkpoint 不是 40 位十六进制 SHA → 不拼进请求 URL，留在 review 并提示
//   ㉖ 合并与审核两个人手动作在 await 窗内被对账收尾抢先 → 不再入队合并步 /
//      审核步（requestMerge 与 applyBuildStepAction review 在 await 后重读相位）
// pr-gate 第四轮（#1414）补的：
//   ⑱ 的时间判据把「CI 一绿就合并」（含 GitHub auto-merge）挡在门外——卡在
//      合并之后才进 review，就永远停在 review 且没有任何一行说明。改判据：每个
//      build 每种结局只收一次尾（merged 看本 build 是否已有完成行，closed 看
//      是否已有对账的关闭行），不看时钟
//   ㉗ 响应里缺 base 或 default_branch → 不当成合进默认分支
//   ㉘ pulls 读或 compare 读的网络窗里有步开始在飞（人点了合并）→ 不写
//   ㉙ 提示行里的分支名按数据引出，执行步回报的 checkpoint 原文不进提示
// /code-review（#1414，AGENTS.md #1422 起开 PR 前后各跑一次）补的：
//   ⑱ 人手拖到「已完成」（落「标记为已完成」行）再拖回 review → 不再按已合并
//      收尾；人手关掉再拖回 review、或 PR 在卡进入 review 之前就关了 → 不打成
//      failed，提示一行交给人（关闭时刻按秒与 todo.phaseAt 比）
//   ⑮ 等额度挂起的 verify / review 步同样不挡对账，收尾时一并停掉
//   ㉚ 合并响应缺 head sha 而本 build 有 checkpoint → 无法核对，不收尾
//   ㉛ compare 404 不永久缓存，但同一对提交 10 分钟内只重读一次
//   ㉜ 离开 review 的 PR 不再留缓存行（进程常驻）：回到 review 后第一次读不带 etag
// 第二遍 /code-review 之后改判据：对账对每个结局每一轮只报告一次（轮界 = 本
// build 最近一个 build / plan 步）。标记只认本轮里的完成行（合并步或对账写
// 的）和对账自己的关闭行；人手完成不算标记，关闭不比时钟。
//   ㉝ #931 返工复用同一个 build：上一轮的标记不挡这一轮
//   ㉞ 人手「标记为已完成」后又拖回 review，之后 PR 才合并 → 照样收尾
//   ㉟ 合并步在人手 done 之后完成 → 补完成行、推进拆卡波次（与改动前一致）
//   ㊱ 上一轮 sweep 没跑完时下一轮不进来（共享缓存与匿名额度）
//   ㊲ 离开磨绿的 PR 不再留 check-runs 缓存行
//   ㊳ githubRepo 不是 owner/repo 形 → 不出站
// 第三遍 /code-review 补的：
//   ㊴ 未连接 GitHub 时匿名额度按进程算（每小时上限），不只按 PR 算
//   ㊵ 最新的完成执行步没回报 checkpoint → 用最近一个有 checkpoint 的步核对
//   ㊶ 磨绿候选因有步在飞被跳过时，check-runs 缓存行留着
//   ㊷ 提示按轮去重：#931 返工复用同一 build 时，新一轮同样的情况再提示一次
//   ㊸ compare 读不到 → 10 分钟内不重读；连续两次读不到才提示一次
// 第四遍 /code-review 补的：
//   ㊹ 匿名额度轮着用：最久没读的 PR 先读，后面的卡不会永远轮不到
//   ㊺ 合并步收尾（不经对账）也停掉没人领的 verify / review 步
//   ㊻ 磨绿的匿名 check-runs 读同样记进进程级额度
//   ㊼ compare 只取一页（per_page=1），不拉整份提交与补丁
// 合并 SHA 落 system 行；收尾复用 merge 步同一条 done 漏斗（完成行 + 拆卡波次）。

import type { Phase } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  message as messageTable,
  project as projectTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { applyBuildStepAction, finishTodoDone, requestMerge } from '../src/services/builds.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { updateTodo } from '../src/services/todos.js';
import { bootServer, type TestServer } from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

function res(status: number, etag: string, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(''),
  };
}

interface PullSpec {
  state: 'open' | 'closed';
  merged: boolean;
  mergeCommitSha?: string | null;
  mergedBy?: string;
  headSha?: string;
  /** compare/{checkpoint}...{head} 的 status（缺省 identical）；数字 = HTTP 错误码；
   * 'throw' = 网络错。 */
  compare?: string | number | 'throw';
  /** merged_at / closed_at（缺省 = 响应时刻，晚于卡进入 review）。 */
  mergedAt?: string | null;
  closedAt?: string | null;
  /** base.ref 与 base.repo.default_branch（缺省都是 main）；noBase = 响应里没有 base。 */
  baseRef?: string;
  defaultBranch?: string;
  noBase?: boolean;
  /** 响应里没有 head（head 仓被删之类）。 */
  noHead?: boolean;
  /** compare 的 status 按 base（checkpoint）区分；缺省回落 compare。 */
  compareByBase?: Record<string, string>;
}

/** pulls/{n} 端点 mock：按 PR 号回应；compare 按 spec 回应；其它 URL
 * （check-runs）一律 404，证明 review 候选不走磨绿面。 */
class PullsMock {
  requests: string[] = [];
  headers: Record<string, string>[] = [];
  /** 下一次请求抛网络错（undici 的 TypeError 形）。 */
  throwNext = false;
  /** compare 请求到达时调用（网络窗竞态注入位）。 */
  onCompare: (() => void) | null = null;
  /** check-runs 端点答一条在跑的 check（默认 404）。 */
  checkRuns = false;
  /** false = 带 etag 也答全量（模拟 GitHub 上状态变了）。 */
  status304 = true;
  /** 每个请求在应答前等这么久（毫秒）。 */
  delayMs = 0;
  compareRequests = () => this.requests.filter((u) => u.includes('/compare/'));
  constructor(
    readonly pulls: Record<number, PullSpec>,
    private readonly status = 200,
  ) {}

  readonly fetch = (
    input: string | URL,
    init?: { headers?: Record<string, string> },
  ): Promise<ReturnType<typeof res>> => {
    if (this.delayMs > 0) {
      const wait = this.delayMs;
      this.delayMs = 0;
      return new Promise<void>((r) => setTimeout(r, wait)).then(() => this.fetch(input, init));
    }
    const url = String(input);
    this.requests.push(url);
    this.headers.push({ ...(init?.headers ?? {}) });
    if (this.throwNext) {
      this.throwNext = false;
      return Promise.reject(new TypeError('fetch failed'));
    }
    if (this.status304 && (init?.headers?.['if-none-match'] ?? '') === '"x"') {
      return Promise.resolve(res(304, '"x"', {}));
    }
    const cmp = url.match(/\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)(?:\?.*)?$/);
    if (cmp !== null) {
      this.onCompare?.();
      const spec = Object.values(this.pulls).find((p) => (p.headSha ?? 'f'.repeat(40)) === cmp[2]);
      const status = spec?.compareByBase?.[cmp[1] ?? ''] ?? spec?.compare ?? 'identical';
      if (status === 'throw') return Promise.reject(new TypeError('fetch failed'));
      if (typeof status === 'number') return Promise.resolve(res(status, '"c"', {}));
      return Promise.resolve(res(200, '"c"', { status }));
    }
    if (url.includes('/check-runs')) {
      if (!this.checkRuns) return Promise.resolve(res(404, '"x"', {}));
      return Promise.resolve(
        res(200, '"x"', {
          total_count: 1,
          check_runs: [{ name: 'ci', status: 'in_progress', conclusion: null }],
        }),
      );
    }
    const m = url.match(/\/pulls\/(\d+)$/);
    if (m === null) return Promise.resolve(res(404, '"x"', {}));
    const spec = this.pulls[Number(m[1])];
    if (spec === undefined) return Promise.resolve(res(404, '"x"', {}));
    // error statuses still carry a PR-shaped body: the status code alone must decide
    const at = new Date().toISOString();
    return Promise.resolve(
      res(this.status, '"x"', {
        number: Number(m[1]),
        state: spec.state,
        merged: spec.merged,
        merge_commit_sha: spec.mergeCommitSha ?? null,
        merged_by: spec.mergedBy === undefined ? null : { login: spec.mergedBy },
        head: spec.noHead ? null : { sha: spec.headSha ?? 'f'.repeat(40) },
        merged_at: spec.merged ? (spec.mergedAt === undefined ? at : spec.mergedAt) : null,
        closed_at:
          spec.state === 'closed' ? (spec.closedAt === undefined ? at : spec.closedAt) : null,
        base: spec.noBase
          ? undefined
          : { ref: spec.baseRef ?? 'main', repo: { default_branch: spec.defaultBranch ?? 'main' } },
      }),
    );
  };
}

interface World {
  s: TestServer;
  projectId: string;
  todoId: string;
  buildId: string;
  prNumber: number;
  todoRow(): { phase: string; phaseAt: number };
  buildRow(): { errorMessage: string | null };
  systemRows(): string[];
  stepRows(): { kind: string; status: string }[];
}

function makeWorld(
  opts: {
    phase?: Phase;
    prNumber?: number;
    olderClosedPr?: number;
    /** a newer build of the same todo becomes todo.latestBuildId (null = no PR). */
    newerBuildPr?: number | null;
    /** a step of the PR build still in flight (the merge step by default). */
    inflight?: 'pending' | 'claimed' | 'waiting_quota';
    inflightKind?: 'merge' | 'verify' | 'review';
    /** the build step's checkpointCommit (branch HEAD at step end). */
    checkpoint?: string;
    /** several done build steps, oldest first (their checkpointCommits). */
    checkpoints?: string[];
    /** todo.phaseAt (when the card entered its phase); default now. */
    phaseAt?: number;
    /** GitHub connected (token present); default anonymous. */
    connected?: boolean;
    /** project.githubRepo（默认 octo/demo）。 */
    githubRepo?: string;
  } = {},
): World {
  const s = bootServer();
  disposables.push(() => s.dispose());
  const rnd = Math.random().toString(36).slice(2, 8);
  const base = Date.now();
  const projectId = `proj-rec-${rnd}`;
  const todoId = `todo-rec-${rnd}`;
  const buildId = `build-rec-${rnd}`;
  const prNumber = opts.prNumber ?? 201;
  s.db
    .insert(projectTable)
    .values({
      id: projectId,
      name: `demo-${rnd}`,
      teamId: s.team.id,
      repoKind: 'github',
      githubRepo: opts.githubRepo ?? 'octo/demo',
    })
    .run();
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      title: 'reconcile target',
      spec: 'do it',
      phase: opts.phase ?? 'review',
      phaseAt: opts.phaseAt ?? base,
      seqNum: 1,
      assignment: { plan: null, build: { agentId: `agent-rec-${rnd}` } },
    })
    .run();
  if (opts.olderClosedPr !== undefined) {
    s.db
      .insert(buildTable)
      .values({
        id: `build-old-${rnd}`,
        todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: base - 600_000,
        prUrl: `https://github.com/octo/demo/pull/${opts.olderClosedPr}`,
        prNumber: opts.olderClosedPr,
      })
      .run();
  }
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      createdAt: base - 60_000,
      prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
      prNumber,
    })
    .run();
  let latestBuildId = buildId;
  if (opts.newerBuildPr !== undefined) {
    latestBuildId = `build-new-${rnd}`;
    s.db
      .insert(buildTable)
      .values({
        id: latestBuildId,
        todoId,
        withPlan: false,
        triggerSource: 'user',
        createdAt: base - 1_000,
        prUrl:
          opts.newerBuildPr === null
            ? null
            : `https://github.com/octo/demo/pull/${opts.newerBuildPr}`,
        prNumber: opts.newerBuildPr,
      })
      .run();
  }
  s.db.update(todoTable).set({ latestBuildId }).where(eq(todoTable.id, todoId)).run();
  if (opts.inflight !== undefined) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-merge-${rnd}`,
        buildId,
        kind: opts.inflightKind ?? 'merge',
        status: opts.inflight,
        createdAt: base,
      })
      .run();
  }
  if (opts.checkpoint !== undefined) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-build-${rnd}`,
        buildId,
        kind: 'build',
        status: 'done',
        checkpointCommit: opts.checkpoint,
        createdAt: base - 30_000,
      })
      .run();
  }
  for (const [k, commit] of (opts.checkpoints ?? []).entries()) {
    s.db
      .insert(stepTable)
      .values({
        id: `step-build-${k}-${rnd}`,
        buildId,
        kind: 'build',
        status: 'done',
        checkpointCommit: commit,
        createdAt: base - 50_000 + k * 10_000,
      })
      .run();
  }
  if (opts.connected === true) {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'octo', accessToken: 'gho_test', scope: 'read:user repo' },
    );
  }
  return {
    s,
    projectId,
    todoId,
    buildId,
    prNumber,
    todoRow: () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!,
    buildRow: () => s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!,
    systemRows: () =>
      s.db
        .select()
        .from(messageTable)
        .where(eq(messageTable.conversationId, buildId))
        .all()
        .filter((r) => r.role === 'system')
        .map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content))),
    stepRows: () =>
      s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, buildId))
        .all()
        .map((r) => ({ kind: r.kind, status: r.status })),
  };
}

function pollerFor(w: World, mock: PullsMock, opts: { anonReadsPerHour?: number } = {}) {
  return createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch: mock.fetch, ...opts });
}

/** Another review-phase todo with its own PR build in the same project. */
function addReviewCard(w: World, prNumber: number): void {
  const id = `${w.todoId}-${prNumber}`;
  w.s.db
    .insert(todoTable)
    .values({
      id,
      teamId: w.s.team.id,
      projectId: w.projectId,
      title: `card ${prNumber}`,
      spec: 'do it',
      phase: 'review',
      phaseAt: Date.now(),
      seqNum: prNumber,
      assignment: { plan: null, build: null },
    })
    .run();
  w.s.db
    .insert(buildTable)
    .values({
      id: `b-${id}`,
      todoId: id,
      withPlan: false,
      triggerSource: 'user',
      createdAt: Date.now(),
      prUrl: `https://github.com/octo/demo/pull/${prNumber}`,
      prNumber,
    })
    .run();
  w.s.db
    .update(todoTable)
    .set({ latestBuildId: `b-${id}` })
    .where(eq(todoTable.id, id))
    .run();
}

describe('#1403 PR reconcile for review-phase builds', () => {
  test('① merged on GitHub → todo done, merge sha in a system row, celebration row', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234def5678' },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    const rows = w.systemRows();
    expect(rows.some((c) => c.includes(`#${w.prNumber}`) && c.includes('abc1234'))).toBe(true);
    expect(rows).toContain('🎉 任务已完成');
    expect(mock.requests.some((u) => u.endsWith(`/repos/octo/demo/pulls/${w.prNumber}`))).toBe(
      true,
    );
  });

  test('② closed without merge → todo failed with the cause on the build', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().errorMessage ?? '').toContain(`#${w.prNumber}`);
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`)),
    ).toHaveLength(1);
  });

  test('③ still open → nothing changes', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
    expect(w.systemRows()).toEqual([]);
  });

  test.each([429, 404, 502])('④ unreadable (%i) → nothing changes', async (status) => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } }, status);
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('⑤ phase moved by a person during the network window → no write', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const racing = (input: string | URL) => {
      w.s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, w.todoId)).run();
      return mock.fetch(input);
    };
    await createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch: racing }).sweep();
    expect(w.todoRow().phase).toBe('closed');
    expect(w.systemRows()).toEqual([]);
  });

  test('⑥ an older PR build of the same todo is closed, the latest PR is open → nothing changes', async () => {
    const w = makeWorld({ olderClosedPr: 150 });
    const mock = new PullsMock({
      150: { state: 'closed', merged: false },
      [w.prNumber]: { state: 'open', merged: false },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.requests.some((u) => u.endsWith('/pulls/150'))).toBe(false);
  });

  test('⑦ after done, a second sweep does not touch the todo again', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    const requestsAfterFirst = mock.requests.length;
    const rowsAfterFirst = w.systemRows().length;
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
    expect(mock.requests.length).toBe(requestsAfterFirst);
    expect(w.systemRows().length).toBe(rowsAfterFirst);
  });

  test("⑧a the todo's current build has no PR; an older build's PR merged → nothing changes", async () => {
    const w = makeWorld({ newerBuildPr: null });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.requests).toEqual([]);
  });

  test("⑧b the todo's current build has no PR; an older build's PR closed → not failed", async () => {
    const w = makeWorld({ newerBuildPr: null });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
  });

  test('⑨ two builds point at the same PR (#1217) → one read, written on the current build', async () => {
    const w = makeWorld({ newerBuildPr: 201 });
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    await pollerFor(w, mock).sweep();
    expect(mock.requests.filter((u) => u.endsWith('/pulls/201'))).toHaveLength(1);
    expect(w.todoRow().phase).toBe('done');
    expect(w.systemRows()).toEqual([]); // the older build's conversation is untouched
    const current = w.s.db
      .select()
      .from(messageTable)
      .all()
      .filter((r) => r.role === 'system' && r.conversationId !== w.buildId)
      .map((r) => String(r.content));
    expect(current.some((c) => c.startsWith('PR #201 已在 GitHub 合并'))).toBe(true);
  });

  test('⑩a a merge step in flight → reconcile does not step in', async () => {
    const w = makeWorld({ inflight: 'claimed' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.requests).toEqual([]);
  });

  test('⑩b finishing twice leaves one completion row', () => {
    const w = makeWorld();
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    expect(w.systemRows().filter((c) => c.includes('任务已完成'))).toHaveLength(1);
  });

  test('⑪ anonymous: a candidate is read at most once per five minutes', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    expect(mock.requests).toHaveLength(1);
    await poller.sweep(t0 + 300_001);
    expect(mock.requests).toHaveLength(2);
  });

  test('⑫a connected: the second read is conditional and a 304 changes nothing', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    await poller.sweep();
    expect(mock.requests).toHaveLength(2);
    expect(mock.headers[1]?.['if-none-match']).toBe('"x"');
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('⑫b a thrown network error → nothing changes; the next sweep reads again', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    mock.throwNext = true;
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
  });

  test('⑬ the merge row names who merged', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        mergedBy: 'octocat',
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.systemRows().some((c) => c.includes('abc1234') && c.includes('octocat'))).toBe(true);
  });

  test('⑭a merged, but the branch has a later commit the merge does not contain → stays in review with a hint', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        compare: 'diverged',
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().some((c) => c.includes('aaaaaaa') && c.includes(`#${w.prNumber}`))).toBe(
      true,
    );
    // restart is refused from review, and #1217 keeps a todo to one merged PR
    expect(w.systemRows().some((c) => c.includes('重启任务'))).toBe(false);
  });

  test('⑭b merged at a head built on top of the checkpoint (update-branch) → done', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234', compare: 'ahead' },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
  });

  test('⑭c the checkpoint commit is unknown to GitHub (never pushed) → stays in review with a hint; once it is there, done', async () => {
    const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 404 },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    const hints = w.systemRows().filter((c) => c.includes('aaaaaaa'));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('GitHub 上找不到');
    const spec = mock.pulls[w.prNumber];
    if (spec !== undefined) spec.compare = 'ahead'; // the commit became visible
    const t0 = Date.now();
    await poller.sweep(t0 + 60_000); // a 404 is re-read at most every ten minutes
    expect(mock.compareRequests()).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(t0 + 600_001);
    expect(mock.compareRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('done');
  });

  test('⑮a a merge step waiting for quota counts as in flight', async () => {
    const w = makeWorld({ inflight: 'waiting_quota' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
  });

  test.each(['verify', 'review'] as const)(
    '⑮c a %s step waiting for quota does not hold the reconcile and is stopped on finish',
    async (inflightKind) => {
      const w = makeWorld({ inflight: 'waiting_quota', inflightKind });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
      await pollerFor(w, mock).sweep();
      expect(w.todoRow().phase).toBe('done');
      expect(w.stepRows().filter((r) => r.kind === inflightKind)).toEqual([
        { kind: inflightKind, status: 'stopped' },
      ]);
    },
  );

  test.each(['verify', 'review'] as const)(
    '⑮b an unclaimed %s step does not hold the reconcile',
    async (inflightKind) => {
      const w = makeWorld({ inflight: 'pending', inflightKind });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
      await pollerFor(w, mock).sweep();
      expect(w.todoRow().phase).toBe('done');
    },
  );

  test.each([
    ['merged', true],
    ['closed', false],
  ] as const)(
    '⑳ %s: unclaimed verify / review steps are stopped when the reconcile finishes',
    async (_label, merged) => {
      const w = makeWorld({ inflight: 'pending', inflightKind: 'review' });
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-verify-${w.buildId}`,
          buildId: w.buildId,
          kind: 'verify',
          status: 'pending',
          createdAt: Date.now(),
        })
        .run();
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged } });
      await pollerFor(w, mock).sweep();
      expect(w.todoRow().phase).toBe(merged ? 'done' : 'failed');
      expect(w.stepRows().filter((r) => r.kind === 'review' || r.kind === 'verify')).toEqual([
        { kind: 'review', status: 'stopped' },
        { kind: 'verify', status: 'stopped' },
      ]);
      if (merged) expect(w.buildRow().errorMessage).toBeNull();
    },
  );

  test('⑯ the todo gets a new current build during the network window → no write', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const racing = (input: string | URL, init?: { headers?: Record<string, string> }) => {
      w.s.db
        .update(todoTable)
        .set({ latestBuildId: 'build-elsewhere' })
        .where(eq(todoTable.id, w.todoId))
        .run();
      return mock.fetch(input, init);
    };
    await createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch: racing }).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('⑱a reopened done→review after the reconcile finished it → not finished again', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        mergedAt: new Date(Date.now() - 5_000).toISOString(),
      },
    });
    // the card entered review before the merge; a PR build leaves hasChanges set
    w.s.db
      .update(todoTable)
      .set({ phaseAt: Date.now() - 60_000, hasChanges: true })
      .where(eq(todoTable.id, w.todoId))
      .run();
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(); // 304, the cached merged pull
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    const rows = w.systemRows();
    expect(rows.filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`))).toHaveLength(1);
    expect(rows.filter((c) => c === '🎉 任务已完成')).toHaveLength(1);
  });

  test('⑱b merged before the card reached review (auto-merge the moment CI went green) → done', async () => {
    const w = makeWorld({ phaseAt: Date.now() });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        mergedAt: new Date(Date.now() - 120_000).toISOString(),
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`)),
    ).toHaveLength(1);
  });

  test('⑱c reopened done→review after the merge step finished it → not finished again', async () => {
    const w = makeWorld({ connected: true });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    finishTodoDone(w.s.svc, w.todoId, w.buildId); // the merge step's finish, no reconcile row
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c === '🎉 任务已完成')).toHaveLength(1);
    expect(w.systemRows().some((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`))).toBe(
      false,
    );
  });

  test('⑱d closed→review drag after the reconcile failed it → stays in review, errorMessage kept', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: false,
        closedAt: new Date(Date.now() - 5_000).toISOString(),
      },
    });
    w.s.db
      .update(todoTable)
      .set({ phaseAt: Date.now() - 60_000 })
      .where(eq(todoTable.id, w.todoId))
      .run();
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('failed');
    updateTodo(w.s.svc, w.todoId, { phase: 'closed' }, { manualPhase: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    w.s.db
      .update(buildTable)
      .set({ errorMessage: 'person note' })
      .where(eq(buildTable.id, w.buildId))
      .run();
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBe('person note');
  });

  test('⑲ merged into a branch other than the default branch → stays in review, one hint', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, baseRef: 'feature-x', defaultBranch: 'main' },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    const hints = w.systemRows().filter((c) => c.includes('feature-x'));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('「feature-x」');
    expect(hints[0]).toContain('main');
  });

  test('㉑ the hint path reads compare once per (checkpoint, head) and writes the hint once', async () => {
    const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 'diverged' },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    await poller.sweep();
    await poller.sweep();
    expect(mock.compareRequests()).toHaveLength(1);
    expect(w.systemRows().filter((c) => c.includes('aaaaaaa'))).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
  });

  test.each([429, 502, 'throw'] as const)(
    '㉒ compare unreadable (%s) → not finished; a later sweep reads compare again',
    async (compare) => {
      const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, compare } });
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      expect(w.todoRow().phase).toBe('review');
      expect(w.systemRows().some((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并（`))).toBe(
        false,
      );
      const spec = mock.pulls[w.prNumber];
      if (spec !== undefined) spec.compare = 'ahead';
      await poller.sweep(t0 + 600_001);
      expect(mock.compareRequests()).toHaveLength(2);
      expect(w.todoRow().phase).toBe('done');
    },
  );

  test('㉓ phase moved by a person while compare is in flight → no write', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 'ahead' },
    });
    mock.onCompare = () => {
      w.s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, w.todoId)).run();
    };
    await pollerFor(w, mock).sweep();
    expect(mock.compareRequests()).toHaveLength(1);
    expect(w.todoRow().phase).toBe('closed');
    expect(w.systemRows()).toEqual([]);
  });

  test('㉔ several build steps: the last one to finish decides', async () => {
    const older = 'a'.repeat(40);
    const newer = 'b'.repeat(40);
    const w = makeWorld({ checkpoints: [older, newer] });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        compareByBase: { [older]: 'identical', [newer]: 'diverged' },
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.compareRequests()[0]).toContain(`/compare/${newer}...`);
    expect(w.systemRows().some((c) => c.includes('bbbbbbb'))).toBe(true);
  });

  test('㉕ a checkpoint that is not a 40-hex sha is not put into a request URL', async () => {
    const w = makeWorld({ checkpoint: '../../user' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(mock.requests.some((u) => u.includes('/compare/'))).toBe(false);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toHaveLength(1);
    expect(w.systemRows()[0]).not.toContain('../../user');
  });

  test('㉖ requestMerge: the reconcile finishes the card during the PR probe → no merge step', async () => {
    const w = makeWorld({ olderClosedPr: 150 });
    const probe = (input: string | URL) => {
      // the sweep finished the card while requestMerge awaited the older PR's state
      w.s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, w.todoId)).run();
      const url = String(input);
      return Promise.resolve(
        res(200, '"p"', { number: Number(url.split('/').at(-1)), state: 'open', merged: false }),
      );
    };
    await expect(requestMerge({ ...w.s.svc, githubFetch: probe }, w.buildId)).rejects.toThrow(
      'illegal phase transition: done -> done',
    );
    expect(w.stepRows().filter((r) => r.kind === 'merge')).toEqual([]);
  });

  test('㉖b AI review: the reconcile finishes the card while the changes are read → no review step', async () => {
    const w = makeWorld();
    const pending = applyBuildStepAction({ ...w.s.svc, reposDir: '/nonexistent' }, w.buildId, {
      action: 'review',
      agentId: 'agent-x',
    });
    // runs inside the first await of the review action (readBuildChanges)
    w.s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, w.todoId)).run();
    await expect(pending).rejects.toThrow('读取变更期间任务相位已变为 done');
    expect(w.stepRows().filter((r) => r.kind === 'review')).toEqual([]);
    const announced = w.s.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.conversationId, w.buildId))
      .all()
      .filter((r) => r.role === 'user');
    expect(announced).toEqual([]);
  });

  test('⑱e dragged to done by hand before the reconcile saw the merge, then back to review → the merge is reported once', async () => {
    const w = makeWorld({ connected: true });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    updateTodo(w.s.svc, w.todoId, { phase: 'done' }, { manualPhase: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`)),
    ).toHaveLength(1);
    expect(w.systemRows().filter((c) => c === '🎉 任务已完成')).toHaveLength(1);
  });

  test('⑱f closed by hand, then back to review → the close is reported once', async () => {
    const w = makeWorld({ connected: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'closed' }, { manualPhase: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('failed');
    updateTodo(w.s.svc, w.todoId, { phase: 'closed' }, { manualPhase: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`)),
    ).toHaveLength(1);
  });

  test('㉚ merged, the response has no head sha, the build has a checkpoint → not finished', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, noHead: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.compareRequests()).toEqual([]);
    expect(w.systemRows()).toEqual([]);
  });

  test('㉗ a merged response without base or default_branch is not taken as a merge into the default branch', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, noBase: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test.each(['pulls', 'compare'] as const)(
    '㉘ a merge step starts while the %s read is in flight → no write',
    async (at) => {
      // without a checkpoint there is no compare read, so the pulls case stands alone
      const w = makeWorld(at === 'compare' ? { checkpoint: 'a'.repeat(40) } : {});
      const mock = new PullsMock({
        [w.prNumber]: { state: 'closed', merged: true, compare: 'ahead' },
      });
      const startMerge = () =>
        w.s.db
          .insert(stepTable)
          .values({
            id: `step-m-${at}-${w.buildId}`,
            buildId: w.buildId,
            kind: 'merge',
            status: 'pending',
            createdAt: Date.now(),
          })
          .run();
      const racing = (input: string | URL, init?: { headers?: Record<string, string> }) => {
        if (at === 'pulls' && String(input).includes('/pulls/')) startMerge();
        return mock.fetch(input, init);
      };
      if (at === 'compare') mock.onCompare = startMerge;
      await createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch: racing }).sweep();
      expect(w.todoRow().phase).toBe('review');
      expect(w.systemRows()).toEqual([]);
    },
  );

  test('㉘c while compare is in flight the merge step finishes the card and a person reopens it → not finished again', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 'ahead' },
    });
    mock.onCompare = () => {
      finishTodoDone(w.s.svc, w.todoId, w.buildId);
      updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    };
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c === '🎉 任务已完成')).toHaveLength(1);
    expect(w.systemRows().some((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`))).toBe(
      false,
    );
  });

  test('㉜ a PR that leaves review drops its cache rows; back in review, the first read has no etag', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    w.s.db.update(todoTable).set({ phase: 'confirm' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep();
    w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep();
    expect(mock.requests).toHaveLength(2);
    expect(mock.headers[1]?.['if-none-match']).toBeUndefined();
  });

  test("㉝ a #931 rework round on the same build: the last round's close does not hide this round's", async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('failed');
    // restart reused the build (PR reopened, fix round ran), then the PR closed again
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-rework-${w.buildId}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'done',
        createdAt: Date.now() + 1,
      })
      .run();
    w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
    await new Promise((r) => setTimeout(r, 5));
    await poller.sweep();
    expect(w.todoRow().phase).toBe('failed');
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`)),
    ).toHaveLength(2);
  });

  test('㉞ marked done by hand while the PR was open, reopened, then merged → finished', async () => {
    const w = makeWorld({ connected: true });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    updateTodo(w.s.svc, w.todoId, { phase: 'done' }, { manualPhase: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    const spec = mock.pulls[w.prNumber];
    if (spec !== undefined) {
      spec.state = 'closed';
      spec.merged = true;
    }
    mock.status304 = false;
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
  });

  test('㉟ the merge step completes after a manual done: completion row written, once', () => {
    const w = makeWorld();
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    updateTodo(w.s.svc, w.todoId, { phase: 'done' }, { manualPhase: true });
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    expect(w.todoRow().phase).toBe('done');
    expect(w.systemRows().filter((c) => c === '🎉 任务已完成')).toHaveLength(1);
  });

  test('㊱ a sweep that starts while the last one runs does nothing', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    mock.delayMs = 30;
    const poller = pollerFor(w, mock);
    await Promise.all([poller.sweep(), poller.sweep()]);
    expect(mock.requests.filter((u) => u.includes('/pulls/'))).toHaveLength(1);
  });

  test('㊲ a PR that leaves the grind drops its check-runs cache row', async () => {
    const w = makeWorld({ connected: true, phase: 'building' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    mock.checkRuns = true;
    const poller = pollerFor(w, mock);
    await poller.sweep();
    w.s.db.update(todoTable).set({ phase: 'confirm' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep();
    w.s.db.update(todoTable).set({ phase: 'building' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep();
    const reads = mock.headers.filter((_, i) => mock.requests[i]?.includes('/check-runs'));
    expect(reads).toHaveLength(2);
    expect(reads[1]?.['if-none-match']).toBeUndefined();
  });

  test('㊳ a githubRepo that is not owner/repo → no request', async () => {
    const w = makeWorld({ githubRepo: 'nodash' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(mock.requests).toEqual([]);
    expect(w.todoRow().phase).toBe('review');
  });

  test('㊴ anonymous: reads across all PRs stay under a per-hour budget', async () => {
    const w = makeWorld();
    addReviewCard(w, 301);
    addReviewCard(w, 302);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'open', merged: false },
      301: { state: 'open', merged: false },
      302: { state: 'open', merged: false },
    });
    const poller = pollerFor(w, mock, { anonReadsPerHour: 2 });
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(mock.requests).toHaveLength(2);
    await poller.sweep(t0 + 300_001); // per-PR interval passed, the hour's budget has not
    expect(mock.requests).toHaveLength(2);
    await poller.sweep(t0 + 3_600_001);
    expect(mock.requests.length).toBeGreaterThan(2);
  });

  test('㊵ the newest done build step reported no checkpoint → the last reported one is checked', async () => {
    const pushed = 'c'.repeat(40);
    const w = makeWorld({ checkpoints: [pushed] });
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-nocp-${w.buildId}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'done',
        checkpointCommit: null,
        createdAt: Date.now(),
      })
      .run();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compareByBase: { [pushed]: 'diverged' } },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.compareRequests()[0]).toContain(`/compare/${pushed}...`);
    expect(w.systemRows().some((c) => c.includes('ccccccc'))).toBe(true);
  });

  test('㊶ a grind candidate skipped for an in-flight step keeps its check-runs cache row', async () => {
    const w = makeWorld({ connected: true, phase: 'building' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    mock.checkRuns = true;
    const poller = pollerFor(w, mock);
    await poller.sweep();
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-fix-${w.buildId}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'claimed',
        createdAt: Date.now(),
      })
      .run();
    await poller.sweep(); // skipped: a fix step is in flight
    w.s.db
      .update(stepTable)
      .set({ status: 'done' })
      .where(eq(stepTable.id, `step-fix-${w.buildId}`))
      .run();
    await poller.sweep();
    const reads = mock.headers.filter((_, i) => mock.requests[i]?.includes('/check-runs'));
    expect(reads).toHaveLength(2);
    expect(reads[1]?.['if-none-match']).toBe('"x"');
  });

  test('㊷ a #931 rework round gets the same hint again', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, baseRef: 'release-x', defaultBranch: 'main' },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    await poller.sweep(); // the hint is known now
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-rework-${w.buildId}`,
        buildId: w.buildId,
        kind: 'build',
        status: 'done',
        createdAt: Date.now() + 1,
      })
      .run();
    await new Promise((r) => setTimeout(r, 5));
    await poller.sweep();
    expect(w.systemRows().filter((c) => c.includes('「release-x」'))).toHaveLength(2);
  });

  test('㊸ compare unreadable: not read again within ten minutes; a hint after the second failure', async () => {
    const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, compare: 502 } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(w.systemRows().filter((c) => c.includes('compare'))).toHaveLength(0);
    await poller.sweep(t0 + 60_000);
    expect(mock.compareRequests()).toHaveLength(1);
    await poller.sweep(t0 + 600_001);
    expect(mock.compareRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c.includes('compare'))).toHaveLength(1);
  });

  test('㊹ anonymous: the budget goes to the PR read longest ago, so every card gets its turn', async () => {
    const w = makeWorld();
    addReviewCard(w, 301);
    addReviewCard(w, 302);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'open', merged: false },
      301: { state: 'open', merged: false },
      302: { state: 'open', merged: false },
    });
    const poller = pollerFor(w, mock, { anonReadsPerHour: 2 });
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 3_600_001);
    const read = new Set(mock.requests.map((u) => u.split('/').at(-1)));
    expect(read).toEqual(new Set([String(w.prNumber), '301', '302']));
  });

  test('㊺ the merge step finishing the card stops unclaimed verify / review steps too', () => {
    const w = makeWorld({ inflight: 'pending', inflightKind: 'review' });
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    expect(w.stepRows().filter((r) => r.kind === 'review')).toEqual([
      { kind: 'review', status: 'stopped' },
    ]);
  });

  test("㊻ anonymous: the grind's check-runs reads count against the same budget", async () => {
    const w = makeWorld({ phase: 'building' });
    addReviewCard(w, 401);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'open', merged: false },
      401: { state: 'closed', merged: true },
    });
    mock.checkRuns = true;
    await pollerFor(w, mock, { anonReadsPerHour: 1 }).sweep();
    expect(mock.requests.filter((u) => u.includes('/check-runs'))).toHaveLength(1);
    expect(mock.requests.filter((u) => u.includes('/pulls/'))).toHaveLength(0);
  });

  test('㊼ compare asks for one page', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, compare: 'ahead' },
    });
    await pollerFor(w, mock).sweep();
    expect(mock.compareRequests()[0]).toMatch(/\?per_page=1$/);
    expect(w.todoRow().phase).toBe('done');
  });

  test('building-phase builds stay with the CI grind path (no pulls read for them)', async () => {
    const w = makeWorld({ phase: 'building' });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(mock.requests.some((u) => u.includes('/pulls/'))).toBe(false);
  });
});
