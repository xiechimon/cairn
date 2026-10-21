// #1403 PR 对账（ci-loop 第二候选集）：review 关口上的 GitHub 形态 build，PR
// 在 GitHub 上的终态回写 pacman。失败方式先于实现列出（AGENTS.md 测试规则）：
//   ① PR 已在 GitHub 合并（不论谁合的）→ todo 停在 review 永不收尾
//   ② PR 关闭未合并 → todo 仍挂 review，看不出这张 PR 已经没了
//   ③ PR 仍 open → 对账不得改任何东西
//   ④ 读不到（限流/404/网络）→ 不得据此推进或打回（fail-open，下轮重试）
//   ⑤ 网络窗口内人工改了相位 → 对账不得回写
//   ⑥ 同一 todo 更旧的 PR build 已关闭（spec 23 被取代分支）而最新 PR 仍 open
//      → 不得把 todo 打成 failed
//   ⑦ 已 done 之后再扫 → 不是候选，不重复收尾
//   ⑧ todo 的当前 build 没有 PR（#1217 守卫下不开新 PR / 探针失败），更旧
//      build 的 PR 已合并或已关闭 → 不得替当前 build 收尾或打回
//   ⑨ 两个 build 指向同一个 PR（#1217）→ 只按当前 build 读一次、写在它上面
//   ⑩ merge 步在飞（agent 正在合并）→ 对账不插手（同一轮第二个合并步见 [54]）
//   ⑪ 未连接 GitHub（匿名 60 次/小时）→ 每个候选 5 分钟内最多读一次
//   ⑫ 条件读 304 → 复用上轮状态；网络抛错 → 不动，下轮重读
//   ⑬ 合并行写明是谁合并的
//   ⑭ PR 合并之后同分支又推了提交（修复轮：compare 答 behind）或分支被改写
//      （diverged）→ 那个提交没进 main，不得收尾；GitHub 的 update-branch 合并
//      提交盖在 checkpoint 之上（ahead）→ 算已合并
//   ⑮ 在飞步口径：waiting_quota 的 merge 步算在飞；没人领（排队中或等额度）的
//      verify / review 步不挡对账（离线的 Verifier 不能让卡永远停在 review），
//      收尾时一并停掉
//   ⑯ 网络窗口里 todo 换了当前 build → 不写
//   ⑰ 错误状态码带着 PR 形的响应体 → 仍按读不到处理
//   ⑱ 每个结局每一轮只报告一次（轮界 = 本 build 最近一个 build / plan 步）：本轮
//      已有完成行（合并步或对账写的）就不按已合并收尾，已有对账的关闭行就不按
//      已关闭打回。人在报告之后把卡拖回 review（done→review、closed→review、
//      failed→review 恢复）→ 下一轮不再收尾一次、不覆盖 errorMessage。人手完成
//      不算标记；人手关掉再拖回 review → 关闭照样报告一次。不看时钟：CI 一绿就
//      合并（含 GitHub auto-merge）时卡在合并之后才进 review，照样收尾
//   ⑲ PR 合并进了非默认分支 → 改动不在 main，不收尾，提示一次
//   ⑳ 收尾时还排着没人领的 verify / review 步 → 停掉，不让它们之后在已收尾
//      的卡上跑（blocking 审核会把 done 往 planning 推而抛错）
//   ㉑ 提示路径每轮重复 compare → compare 结果按 (checkpoint, head) 缓存，
//      提示只落一次
//   ㉒ compare 读不到（429 / 5xx / 网络）→ 不动，下轮重读
//   ㉓ compare 网络窗内相位被人改 → 不写
//   ㉔ 多个执行步：按最后完成的那一步的 checkpoint 判
//   ㉕ checkpoint 不是 40 位十六进制 SHA → 不拼进请求 URL，留在 review 并提示
//   ㉖ 合并与审核两个人手动作在 await 窗内被对账收尾抢先 → 不入队合并步 /
//      审核步（requestMerge 与 applyBuildStepAction review 在 await 后重读相位）
//   ㉗ 响应里缺 base 或 default_branch → 不当成合进默认分支
//   ㉘ pulls 读或 compare 读的网络窗里有步开始在飞（人点了合并）→ 不写
//   ㉙ 提示行里的分支名按数据引出，执行步回报的 checkpoint 原文不进提示
//   ㉚ 合并响应缺 head sha 而本 build 有 checkpoint → 无法核对，不收尾
//   ㉛ compare 404 不永久缓存，但同一对提交 10 分钟内只重读一次
//   ㉜ 离开 review 的 PR 不留缓存行（进程常驻）：回到 review 后第一次读不带 etag
//   ㉝ #931 返工复用同一个 build：上一轮的标记不挡这一轮
//   ㉞ 人手「标记为已完成」后又拖回 review，之后 PR 才合并 → 照样收尾
//   ㉟ 合并步在人手 done 之后完成 → 落完成行
//   ㊱ 上一轮 sweep 没跑完时下一轮不进来（共享缓存与匿名额度）
//   ㊲ 离开磨绿的 PR 不留 check-runs 缓存行
//   ㊳ githubRepo 不是 owner/repo 形 → 不出站
//   ㊴ 未连接 GitHub 时匿名额度按进程算（每小时上限），不只按 PR 算
//   ㊵ 最新的完成执行步没回报 checkpoint → 用最近一个有 checkpoint 的步核对
//   ㊶ 磨绿候选因有步在飞被跳过时，check-runs 缓存行留着
//   ㊷ 提示按轮去重：#931 返工复用同一 build 时，新一轮同样的情况再提示一次
//   ㊸ compare 读不到 → 10 分钟内不重读；连续两次读不到才提示一次
//   ㊹ 匿名额度轮着用：最久没读的 PR 先读，后面的卡不会永远轮不到
//   ㊺ 合并步收尾（不经对账）也停掉没人领的 verify / review 步
//   ㊻ 磨绿的匿名 check-runs 读同样记进进程级额度
//   ㊼ compare 带 per_page=1：提交只取一条（GitHub 在第一页照样给出改动文件列表）
//   ㊽ 第二次读不到 compare 的网络窗内卡离开 review → 不写提示
//   [49] 收尾时停掉的等额度 verify 步，在发出的 done 文档里不留等额度投影
//        （卡本来就是 done 时也要补发一次）
//   [50] 匿名额度：pulls 读要等额度里也留得出它可能需要的那次 compare
//   [51] 关闭后立刻重开（为重跑 CI）→ 不打成 failed：关闭要两次读都还在才算
//   [52] 响应里没有 merged 字段 → 读不到，不当成关闭未合并
//   [53] 第二次读不到 compare 的网络窗里合并步开始 → 不写提示
//   [54] 同一轮里第二个合并步完成 → 再落一行完成行（对账在本轮已有完成行时不收尾，
//        finishTodoDone 自己不去重）
//   [55] sweep 日志把对账与磨绿分开计数
//   [56] 磨绿的匿名读算进按 IP 的总额度，不占对账自己的那份
//   [57] 关闭确认按两次读真正发生的时刻算，不按 sweep 开始的时刻（慢的一轮之后
//        紧跟快的一轮，两次读可能只隔十几秒）
//   [58] 已合并的 PR 不会再变：卡留在 review（提示、人拖回）时不重读
//   [59] 合并步收尾时相位已被人改成不能到 done 的（closed）→ 先抛非法相位转移错，
//        不停任何步
//   [60] checkpoint 不是 40 位 SHA 时 compare 不发请求，也不占匿名额度
//   [61] 已合并的响应缺对账要的字段（head、base、base 仓 id，有 checkpoint 时的
//        head sha）→ 不当终态缓存，之后照常节流重读（不带那次响应的 etag）
//   [62] PR 号是 daemon 按分支名查到的（gh pr list --head 只比分支名）：公开仓里
//        别人 fork 的同名分支开的 PR 也会被读成本 build 的。head 仓与 base 仓是同一个
//        仓（同一份响应里按仓库 id 比：仓库改名或转移后照样对得上）、head 分支是本
//        build 的工作分支才写；对不上（含 fork 已删、head 仓为 null）→ 不收尾、不打回，
//        每轮提示一次，按 etag 缓存；缺 head 分支或 base 仓 id → 读不到
//   [63] 合并步经 completeStep 收尾（不是直接调 finishTodoDone）同样停掉没人领的 verify 步
//   [64] 对账把拆卡子项收尾成 done → 推进拆卡波次：阻塞已解的兄弟卡开跑
//   [65] system 行里引用的 GitHub 文本（分支名、合并者、合并提交）去掉控制字符，
//        截到 100 个字符
//   [66] 真实 GitHub 响应（test/fixtures/github，docs/verify/1403 同存）按对账用到的
//        字段解析
// 合并 SHA 落 system 行；收尾复用 merge 步同一条 done 漏斗（完成行 + 拆卡波次）。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { conversationBranch, type Phase } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  build as buildTable,
  message as messageTable,
  project as projectTable,
  type QuotaWaitRow,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { githubCompareStatus, githubPull } from '../src/lib/github.js';
import {
  applyBuildStepAction,
  completeStep,
  DONE_ROW,
  finishTodoDone,
  requestMerge,
} from '../src/services/builds.js';
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
  /** 响应里没有 head。 */
  noHead?: boolean;
  /** head 里没有 sha（ref 与 repo 照常）。 */
  noHeadSha?: boolean;
  /** head.ref（缺省 = 世界里指向这张 PR 的 build 的工作分支，见 headRefs）。 */
  headRef?: string;
  /** head.repo.full_name（缺省 octo/demo）；null = head.repo 为 null（fork 被删）。 */
  headRepo?: string | null;
  /** head.repo.id（缺省 = base 仓的 id，REPO_ID）。 */
  headRepoId?: number;
  /** base.repo.full_name（缺省 octo/demo）。 */
  baseRepo?: string;
  /** base.repo 里没有 id。 */
  noBaseRepoId?: boolean;
  /** 响应里没有 merged 字段（被裁掉的响应体）。 */
  noMerged?: boolean;
  /** compare 的 status 按 base（checkpoint）区分；缺省回落 compare。 */
  compareByBase?: Record<string, string>;
}

/** 目标仓在 GitHub 上的仓库 id（mock 的 base.repo.id，head.repo.id 缺省同它）。 */
const REPO_ID = 4242;

/** PR 号 → 它的 head 分支（指向它的当前 build 的工作分支）：makeWorld 与 addReviewCard
 * 登记，mock 缺省按它回 head.ref（[62] 前的测试读到的都是本 build 自己的 PR）。 */
const headRefs = new Map<number, string>();

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
        ...(spec.noMerged ? {} : { merged: spec.merged }),
        merge_commit_sha: spec.mergeCommitSha ?? null,
        merged_by: spec.mergedBy === undefined ? null : { login: spec.mergedBy },
        head: spec.noHead
          ? null
          : {
              ...(spec.noHeadSha ? {} : { sha: spec.headSha ?? 'f'.repeat(40) }),
              ref: spec.headRef ?? headRefs.get(Number(m[1])) ?? '',
              repo:
                spec.headRepo === null
                  ? null
                  : { id: spec.headRepoId ?? REPO_ID, full_name: spec.headRepo ?? 'octo/demo' },
            },
        merged_at: spec.merged ? (spec.mergedAt === undefined ? at : spec.mergedAt) : null,
        closed_at:
          spec.state === 'closed' ? (spec.closedAt === undefined ? at : spec.closedAt) : null,
        base: spec.noBase
          ? undefined
          : {
              ref: spec.baseRef ?? 'main',
              repo: {
                ...(spec.noBaseRepoId ? {} : { id: REPO_ID }),
                full_name: spec.baseRepo ?? 'octo/demo',
                default_branch: spec.defaultBranch ?? 'main',
              },
            },
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
  headRefs.clear();
  if (opts.olderClosedPr !== undefined) {
    headRefs.set(opts.olderClosedPr, conversationBranch(`build-old-${rnd}`));
  }
  headRefs.set(prNumber, conversationBranch(buildId));
  if (typeof opts.newerBuildPr === 'number') {
    headRefs.set(opts.newerBuildPr, conversationBranch(`build-new-${rnd}`));
  }
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

function pollerFor(
  w: World,
  mock: PullsMock,
  opts: { anonReadsPerHour?: number; anonIpReadsPerHour?: number } = {},
) {
  return createCiPoller({ ...w.s.svc, box: w.s.secretBox }, { githubFetch: mock.fetch, ...opts });
}

/** A close counts at the second read that still sees it (a close and reopen to rerun CI is
 * common), five minutes apart so an anonymous world reads again too. */
async function sweepTwice(poller: ReturnType<typeof pollerFor>, t0 = Date.now()): Promise<void> {
  await poller.sweep(t0);
  await poller.sweep(t0 + 300_000);
}

const QUOTA_BLOCK: QuotaWaitRow = {
  kind: 'quota',
  providerId: 'relay',
  label: 'Relay',
  reason: '402: quota exceeded',
  retryAfterMs: null,
  firstSeenAt: 0,
  lastAt: 0,
  attempts: 1,
  probeAt: 0,
};

/** Another review-phase todo with its own PR build in the same project. */
function addReviewCard(w: World, prNumber: number): void {
  const id = `${w.todoId}-${prNumber}`;
  headRefs.set(prNumber, conversationBranch(`b-${id}`));
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
    expect(rows).toContain(DONE_ROW);
    expect(mock.requests.some((u) => u.endsWith(`/repos/octo/demo/pulls/${w.prNumber}`))).toBe(
      true,
    );
  });

  test('② closed without merge → todo failed with the cause on the build', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(w.todoRow().phase).toBe('review'); // one read is not enough ([51])
    expect(w.systemRows()).toEqual([]);
    await poller.sweep(t0 + 300_000);
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

  test.each([
    // a fix commit pushed on top of the merged head: the checkpoint descends from it
    ['behind'],
    // the branch was rewritten after the merge
    ['diverged'],
  ] as const)(
    '⑭a merged, but compare says %s: the checkpoint is not in the merged head → stays in review with a hint',
    async (compare) => {
      const w = makeWorld({ checkpoint: 'a'.repeat(40) });
      const mock = new PullsMock({
        [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234', compare },
      });
      await pollerFor(w, mock).sweep();
      expect(w.todoRow().phase).toBe('review');
      expect(
        w.systemRows().some((c) => c.includes('aaaaaaa') && c.includes(`#${w.prNumber}`)),
      ).toBe(true);
      expect(w.systemRows()).not.toContain(DONE_ROW);
      // restart is refused from review, and #1217 keeps a todo to one merged PR
      expect(w.systemRows().some((c) => c.includes('重启任务'))).toBe(false);
    },
  );

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
      await sweepTwice(pollerFor(w, mock));
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
    expect(rows.filter((c) => c === DONE_ROW)).toHaveLength(1);
  });

  test('⑱b merged before the card reached review (auto-merge the moment CI went green) → done', async () => {
    // The merge lands two minutes before the card's phaseAt. The reconcile does not compare
    // the two times, so the card is finished.
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
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
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
    await sweepTwice(poller);
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
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
  });

  test('⑱f closed by hand, then back to review → the close is reported once', async () => {
    const w = makeWorld({ connected: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'closed' }, { manualPhase: true });
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const poller = pollerFor(w, mock);
    await sweepTwice(poller);
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
    // head.ref and head.repo are there, so the ownership check passes and the head-sha guard decides
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, noHeadSha: true },
    });
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
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
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
    await sweepTwice(poller);
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
    await sweepTwice(poller, Date.now() + 600_000);
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

  test('㉟ the merge step completes after a manual done: completion row written', () => {
    const w = makeWorld();
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    updateTodo(w.s.svc, w.todoId, { phase: 'done' }, { manualPhase: true });
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    expect(w.todoRow().phase).toBe('done');
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
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
    // A read starts with room for one compare after it ([50]): of 3, two cards read.
    const poller = pollerFor(w, mock, { anonReadsPerHour: 3 });
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
    const poller = pollerFor(w, mock, { anonReadsPerHour: 3 });
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
    await pollerFor(w, mock, { anonIpReadsPerHour: 2 }).sweep();
    expect(mock.requests.filter((u) => u.includes('/check-runs'))).toHaveLength(1);
    expect(mock.requests.filter((u) => u.includes('/pulls/'))).toHaveLength(0);
  });

  test('㊽ the card leaves review during the second unreadable compare → no hint', async () => {
    const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, compare: 502 } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    mock.onCompare = () => {
      w.s.db.update(todoTable).set({ phase: 'closed' }).where(eq(todoTable.id, w.todoId)).run();
    };
    await poller.sweep(t0 + 600_001);
    expect(mock.compareRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('closed');
    expect(w.systemRows()).toEqual([]);
  });

  test.each([
    ['the reconcile finishes the card', false],
    ['the merge step finishes a card a person already marked done', true],
  ] as const)(
    '[49] %s: the done card is published without the quota wait of the verify step it stopped',
    async (_label, doneFirst) => {
      const w = makeWorld({ connected: true, inflight: 'waiting_quota', inflightKind: 'verify' });
      w.s.db
        .update(stepTable)
        .set({ quotaBlock: QUOTA_BLOCK })
        .where(eq(stepTable.buildId, w.buildId))
        .run();
      w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
      if (doneFirst) updateTodo(w.s.svc, w.todoId, { phase: 'done' }, { manualPhase: true });
      const hub = w.s.svc.hub;
      const docs: Parameters<typeof hub.publishTodoDoc>[1][] = [];
      const publish = hub.publishTodoDoc.bind(hub);
      hub.publishTodoDoc = (teamId, doc) => {
        docs.push(doc);
        publish(teamId, doc);
      };
      if (doneFirst) finishTodoDone(w.s.svc, w.todoId, w.buildId);
      else {
        const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
        await pollerFor(w, mock).sweep();
      }
      expect(w.todoRow().phase).toBe('done');
      expect(docs.at(-1)?.phase).toBe('done');
      expect(docs.at(-1)?.quotaWait).toBeNull();
    },
  );

  test('[50] anonymous: a pulls read waits until the budget also has room for the compare it may need', async () => {
    const w = makeWorld({ checkpoint: 'a'.repeat(40) });
    addReviewCard(w, 301);
    const mine: PullSpec = { state: 'open', merged: false, compare: 'ahead' };
    const mock = new PullsMock({ [w.prNumber]: mine, 301: { state: 'open', merged: false } });
    const poller = pollerFor(w, mock, { anonReadsPerHour: 3 });
    const t0 = Date.now();
    await poller.sweep(t0); // both read: 2 of 3 used
    mine.state = 'closed';
    mine.merged = true;
    mock.status304 = false;
    await poller.sweep(t0 + 300_001); // 1 left: no pulls read that its compare could not follow
    expect(mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`))).toHaveLength(1);
    await poller.sweep(t0 + 3_600_001);
    expect(w.todoRow().phase).toBe('done');
    expect(mock.compareRequests()).toHaveLength(1);
  });

  test('[51] closed, then reopened before the next read (a close and reopen to rerun CI) → not failed', async () => {
    const w = makeWorld({ connected: true, inflight: 'pending', inflightKind: 'verify' });
    const spec: PullSpec = { state: 'closed', merged: false };
    const mock = new PullsMock({ [w.prNumber]: spec });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
    spec.state = 'open';
    mock.status304 = false;
    await poller.sweep(t0 + 60_000);
    spec.state = 'closed';
    await poller.sweep(t0 + 120_000); // closed again: the count starts over
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
    expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('pending');
  });

  test('[52] a closed response without a merged field is unreadable, not a close', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: false, noMerged: true },
    });
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test.each([
    ['a merge step starts', false],
    ['the merge step finishes the card and a person reopens it', true],
  ] as const)(
    '[53] %s during the second unreadable compare → no hint',
    async (_label, finished) => {
      const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
      w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, compare: 502 } });
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      mock.onCompare = () => {
        if (finished) {
          finishTodoDone(w.s.svc, w.todoId, w.buildId);
          updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
          return;
        }
        w.s.db
          .insert(stepTable)
          .values({
            id: `step-merge-late-${w.buildId}`,
            buildId: w.buildId,
            kind: 'merge',
            status: 'pending',
            createdAt: Date.now(),
          })
          .run();
      };
      await poller.sweep(t0 + 600_001);
      expect(mock.compareRequests()).toHaveLength(2);
      expect(w.systemRows().filter((c) => c.includes('compare'))).toEqual([]);
    },
  );

  test('[54] a second merge step in the same round writes its completion row again', () => {
    const w = makeWorld();
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(2);
  });

  test('[55] the sweep log counts the reconcile apart from the grind', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'open', merged: false } });
    const info = vi.fn();
    await createCiPoller(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: mock.fetch, logger: { info } },
    ).sweep();
    const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
    expect(tally.pending).toBe(0);
    expect(tally.reviewPending).toBe(1);
  });

  test("[56] anonymous: the grind's reads count toward the per-IP total, not the reconcile's own share", async () => {
    const w = makeWorld({ phase: 'building' });
    addReviewCard(w, 402);
    w.s.db
      .update(todoTable)
      .set({ phase: 'building' })
      .where(eq(todoTable.id, `${w.todoId}-402`))
      .run();
    addReviewCard(w, 401);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'open', merged: false },
      401: { state: 'open', merged: false },
      402: { state: 'open', merged: false },
    });
    mock.checkRuns = true;
    // two grind reads would fill a shared budget of 2; the reconcile's own share is untouched
    await pollerFor(w, mock, { anonReadsPerHour: 2 }).sweep();
    expect(mock.requests.filter((u) => u.includes('/check-runs'))).toHaveLength(2);
    expect(mock.requests.filter((u) => u.endsWith('/pulls/401'))).toHaveLength(1);
  });

  test('[57] a close counts when the two reads happened 50 s apart, not the two sweep starts', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const t0 = Date.now();
    // a slow first sweep: the pulls read lands 45 s after the sweep started
    const fetch = mock.fetch;
    let slow = true;
    const timed = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox },
      {
        githubFetch: (input, init) => {
          if (slow) {
            slow = false;
            vi.setSystemTime(Date.now() + 45_000);
          }
          return fetch(input, init);
        },
      },
    );
    try {
      await timed.sweep(t0);
      vi.setSystemTime(t0 + 60_000);
      await timed.sweep(t0 + 60_000); // 15 s after the first read
      expect(w.todoRow().phase).toBe('review');
      vi.setSystemTime(t0 + 120_000);
      await timed.sweep(t0 + 120_000);
      expect(w.todoRow().phase).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  test('[58] a merged PR is not read again while its card stays in review', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, baseRef: 'release-x', defaultBranch: 'main' },
    });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 300_001);
    await poller.sweep(t0 + 600_002);
    expect(mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`))).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c.includes('release-x'))).toHaveLength(1);
  });

  test('[59] the merge step finishing a card a person closed meanwhile throws before it stops anything', () => {
    const w = makeWorld({ inflight: 'pending', inflightKind: 'verify' });
    updateTodo(w.s.svc, w.todoId, { phase: 'closed' }, { manualPhase: true });
    expect(() => finishTodoDone(w.s.svc, w.todoId, w.buildId)).toThrow(
      'illegal phase transition: closed -> done',
    );
    expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('pending');
    expect(w.systemRows()).toEqual([]);
  });

  test('[60] anonymous: a compare that sends no request (checkpoint not a sha) takes no budget', async () => {
    const w = makeWorld({ checkpoint: 'not-a-sha' });
    addReviewCard(w, 301);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true },
      301: { state: 'open', merged: false },
    });
    await pollerFor(w, mock, { anonReadsPerHour: 3 }).sweep();
    expect(mock.compareRequests()).toHaveLength(0);
    expect(mock.requests.filter((u) => u.endsWith('/pulls/301'))).toHaveLength(1);
  });

  test.each([
    ['base', {}, { noBase: true }],
    ['the base repo id', {}, { noBaseRepoId: true }],
    ['head', {}, { noHead: true }],
    ['head sha (the build has a checkpoint)', { checkpoint: 'a'.repeat(40) }, { noHeadSha: true }],
  ] as const)(
    '[61] a merged response without %s is read again on a later sweep; the complete one finishes the card',
    async (_label, world, missing) => {
      const w = makeWorld(world);
      const spec: PullSpec = {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234def5678',
        ...missing,
      };
      const mock = new PullsMock({ [w.prNumber]: spec });
      const poller = pollerFor(w, mock);
      const pullReads = () => mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`));
      const t0 = Date.now();
      await poller.sweep(t0);
      expect(w.todoRow().phase).toBe('review');
      Object.assign(spec, { noBase: false, noBaseRepoId: false, noHead: false, noHeadSha: false });
      await poller.sweep(t0 + 60_000); // anonymous: five minutes between reads of one PR
      expect(pullReads()).toHaveLength(1);
      await poller.sweep(t0 + 300_000);
      expect(pullReads()).toHaveLength(2);
      // no etag of the incomplete response: a 304 would hand the same body back
      expect(mock.headers.at(-1)?.['if-none-match']).toBeUndefined();
      expect(w.todoRow().phase).toBe('done');
      const rows = w.systemRows();
      expect(
        rows.some((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并（合并提交 abc1234`)),
      ).toBe(true);
      expect(rows).toContain(DONE_ROW);
    },
  );

  test.each([
    ['closed', false],
    ['merged', true],
  ] as const)(
    '[62a] a fork PR with the same branch name, %s → the card is neither failed nor finished; one hint',
    async (_label, merged) => {
      const w = makeWorld({ connected: true, inflight: 'pending', inflightKind: 'verify' });
      const mock = new PullsMock({
        [w.prNumber]: {
          state: 'closed',
          merged,
          mergeCommitSha: 'abc1234',
          headRepo: 'mallory/demo',
          headRepoId: REPO_ID + 1,
        },
      });
      const info = vi.fn();
      const poller = createCiPoller(
        { ...w.s.svc, box: w.s.secretBox },
        { githubFetch: mock.fetch, logger: { info } },
      );
      await sweepTwice(poller);
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow().errorMessage).toBeNull();
      expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('pending');
      const rows = w.systemRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(`PR #${w.prNumber}`);
      expect(rows[0]).toContain(conversationBranch(w.buildId));
      expect(rows[0]).not.toContain('mallory');
      const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
      expect(tally.reviewForeign).toBe(1);
    },
  );

  test('[62b] a PR from another branch of the target repo → not finished', async () => {
    const w = makeWorld();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, headRef: 'someone-elses-branch' },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toEqual([]);
  });

  test.each([
    ['renamed', 'octo/demo2'],
    ['transferred', 'neworg/demo'],
  ] as const)(
    '[62c] the repo was %s on GitHub (head and base both %s, the project still says octo/demo) → done',
    async (_label, name) => {
      const w = makeWorld();
      const mock = new PullsMock({
        [w.prNumber]: { state: 'closed', merged: true, headRepo: name, baseRepo: name },
      });
      await pollerFor(w, mock).sweep();
      expect(w.todoRow().phase).toBe('done');
      expect(w.systemRows()).toContain(DONE_ROW);
    },
  );

  test.each([
    ['closed', false],
    ['merged', true],
  ] as const)(
    '[62d] a %s PR whose head repo is null (fork deleted) is foreign: one hint per round, counted, kept in the cache',
    async (_label, merged) => {
      const w = makeWorld({ connected: true });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged, headRepo: null } });
      const info = vi.fn();
      const poller = createCiPoller(
        { ...w.s.svc, box: w.s.secretBox },
        { githubFetch: mock.fetch, logger: { info } },
      );
      await poller.sweep();
      await poller.sweep();
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow().errorMessage).toBeNull();
      const rows = w.systemRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(`PR #${w.prNumber}`);
      expect(rows[0]).toContain(conversationBranch(w.buildId));
      const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
      expect(tally.reviewForeign).toBe(1);
      expect(tally.reviewUnreadable).toBe(0);
      const reads = mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`));
      if (merged) {
        expect(reads).toHaveLength(1); // a merged pull is final: not read again
      } else {
        expect(reads).toHaveLength(2);
        expect(mock.headers.at(-1)?.['if-none-match']).toBe('"x"'); // conditional: a 304
      }
    },
  );

  test('[63] a merge step completing through completeStep stops an unclaimed verify step', () => {
    const w = makeWorld({ inflight: 'pending', inflightKind: 'verify' });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    const mergeStepId = `step-merge-done-${w.buildId}`;
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
    completeStep(w.s.svc, mergeStepId);
    expect(w.todoRow().phase).toBe('done');
    expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('stopped');
    expect(w.systemRows()).toContain(DONE_ROW);
  });

  test('[64] the reconcile finishing a split child advances the waves: the unblocked sibling starts', async () => {
    const w = makeWorld();
    const parentId = `${w.todoId}-parent`;
    const siblingId = `${w.todoId}-sibling`;
    const card = (id: string, phase: Phase, seqNum: number) => ({
      id,
      teamId: w.s.team.id,
      projectId: w.projectId,
      title: id,
      spec: 'do it',
      phase,
      phaseAt: Date.now(),
      seqNum,
    });
    w.s.db
      .insert(todoTable)
      .values({ ...card(parentId, 'building', 10), assignment: { plan: null, build: null } })
      .run();
    w.s.db.update(todoTable).set({ sourceTodo: parentId }).where(eq(todoTable.id, w.todoId)).run();
    w.s.db
      .insert(todoTable)
      .values({
        ...card(siblingId, 'todo', 11),
        sourceTodo: parentId,
        blockedBy: [w.todoId],
        assignment: { plan: null, build: { agentId: 'agent-split-next' } },
      })
      .run();
    const phaseOf = (id: string) =>
      w.s.db.select().from(todoTable).where(eq(todoTable.id, id)).get()?.phase;
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    expect(phaseOf(siblingId)).toBe('queued');
    expect(
      w.s.db.select().from(buildTable).where(eq(buildTable.todoId, siblingId)).all(),
    ).toHaveLength(1);
    expect(phaseOf(parentId)).toBe('building'); // one child is still open
  });

  test('[65a] an over-long base branch name with control characters is cut to 100 characters in the hint', async () => {
    const w = makeWorld({ connected: true });
    const long = `release-${'x'.repeat(300)}`;
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        baseRef: `${long}\u0007\u001b[2J`,
        defaultBranch: 'ma\u0000in\n',
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    const hints = w.systemRows().filter((c) => c.includes('release-'));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain(`「${long.slice(0, 100)}…」`);
    expect(hints[0]).toContain('「main」');
    expect(hints[0]).not.toMatch(/\p{Cc}/u);
    expect(hints[0]?.length).toBeLessThan(250);
  });

  test('[65b] the merger login and the merge commit in the merge row lose control characters and are bounded', async () => {
    const w = makeWorld({ connected: true });
    const login = `octocat${'y'.repeat(200)}`;
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: '\u001babc1234def5678',
        mergedBy: `oct\nocat${'y'.repeat(200)}`,
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    const row = w.systemRows().find((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 合并`));
    expect(row).toContain('合并提交 abc1234，');
    expect(row).toContain(`由 ${login.slice(0, 100)}… 合并`);
    expect(row).not.toMatch(/\p{Cc}/u);
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

describe('#1403 [66] live GitHub response shapes (captured over REST, see docs/verify/1403)', () => {
  /** Two consecutive commits on main: 66d5022 is the parent of 23a39da. */
  const MAIN_OLDER = '66d5022e374da641ed37ca59ec4fa1c089cb1fac';
  const MAIN_NEWER = '23a39da9f7dc929fa8e1e271e2dd73d4bbdb0458';
  const fixture = (name: string): unknown =>
    JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/github', name), 'utf8'));
  /** The response stub serving one captured body; records the URLs asked for. */
  function serve(body: unknown) {
    const urls: string[] = [];
    const fetch = (input: string | URL) => {
      urls.push(String(input));
      return Promise.resolve(res(200, '"live"', body));
    };
    return { urls, fetch };
  }

  test('[66a] an open PR (pulls/1414): no merge commit, even though GitHub sends its test-merge sha', async () => {
    const body = fixture('pull-1414-open.json') as { merge_commit_sha?: unknown };
    expect(typeof body.merge_commit_sha).toBe('string');
    const { fetch, urls } = serve(body);
    const page = await githubPull(fetch, null, 'xiechimon', 'pacman', 1414);
    expect(urls).toEqual(['https://api.github.com/repos/xiechimon/pacman/pulls/1414']);
    expect(page?.etag).toBe('"live"');
    expect(page?.pull).toEqual({
      state: 'open',
      merged: false,
      mergeCommitSha: null,
      mergedBy: null,
      headSha: '9fa4ed90fa76bc7d7a82c7ffe20ab3782dc2cddd',
      headRef: 'claude/bootstrap-p2',
      headRepoId: 1361226985,
      baseRef: 'main',
      baseRepoId: 1361226985,
      defaultBranch: 'main',
    });
  });

  test('[66b] a merged PR (pulls/1454): merge commit, merger login, head repo id = base repo id', async () => {
    const { fetch } = serve(fixture('pull-1454-merged.json'));
    const page = await githubPull(fetch, null, 'xiechimon', 'pacman', 1454);
    expect(page?.pull).toEqual({
      state: 'closed',
      merged: true,
      mergeCommitSha: MAIN_NEWER,
      mergedBy: 'xiechimon',
      headSha: '815d5b73f70829d44d6895e1a7a51e13bc6a0555',
      headRef: 'claude/optimistic-albattani-r5pmfn',
      headRepoId: 1361226985,
      baseRef: 'main',
      baseRepoId: 1361226985,
      defaultBranch: 'main',
    });
  });

  test.each([
    ['ahead', 'compare-ahead.json', MAIN_OLDER, MAIN_NEWER],
    ['behind', 'compare-behind.json', MAIN_NEWER, MAIN_OLDER],
  ] as const)(
    '[66c] compare between two commits on main reads %s',
    async (status, file, base, head) => {
      const { fetch, urls } = serve(fixture(file));
      expect(await githubCompareStatus(fetch, null, 'xiechimon', 'pacman', base, head)).toBe(
        status,
      );
      expect(urls).toEqual([
        `https://api.github.com/repos/xiechimon/pacman/compare/${base}...${head}?per_page=1`,
      ]);
    },
  );
});
