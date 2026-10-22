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
//   ⑨ 两个 build 指向同一个 PR（#1217）→ 只按当前 build 读一次、写在它上面（⑨a）；
//      真实形态里第二个 build 是经 daemon 探测记下更旧 build 开的 PR（#1195 偏离与产物
//      分支），PR 的 head 是更旧 build 的分支 → 对不上当前 build 的工作分支，按别人的
//      PR 处理：留在 review、提示一次、不收尾（⑨b）
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
//   ㉔ 多个执行步：按最后收尾的那一步的 checkpoint 判，不按建步先后：上一轮建的 verify
//      步（Verifier 离线或等额度）在下一轮的 build 步之后才跑完并推送 → 核对它的提交（㉔b）
//   ㉕ checkpoint 不是 40 位十六进制 SHA → 不拼进请求 URL，留在 review 并提示
//   ㉖ 合并与审核两个人手动作在 await 窗内被对账收尾抢先 → 不入队合并步 /
//      审核步（requestMerge 与 applyBuildStepAction review 在 await 后重读相位）
//   ㉗ 响应里缺 base、base.ref 或 default_branch → 不当成合进默认分支
//   ㉘ pulls 读或 compare 读的网络窗里有步开始在飞（人点了合并）→ 不写
//   ㉙ 提示行里的分支名按数据引出，执行步回报的 checkpoint 原文不进提示
//   ㉚ 合并响应缺 head sha 而本 build 有 checkpoint → 无法核对，不收尾
//   ㉛ compare 404 不永久缓存，但同一对提交 10 分钟内只重读一次
//   ㉜ 离开 review 的 PR 不留缓存行（进程常驻）：回到 review 后第一次读不带 etag
//   ㉝ #931 返工复用同一个 build：上一轮的标记不挡这一轮
//   ㉞ 人手「标记为已完成」后又拖回 review，之后 PR 才合并 → 照样收尾
//   ㉟ 合并步在人手 done 之后才回报完成 → 只记步（#1453），不落完成行
//   ㊱ 上一轮 sweep 没跑完时下一轮不进来（共享缓存与匿名额度）
//   ㊲ 离开磨绿的 PR 不留 check-runs 缓存行
//   ㊳ githubRepo 不是 owner/repo 形 → 不出站
//   ㊳b githubRepo 有 `.` / `..` 段（#1466）→ 不出站（githubTarget 走 githubRepoOfProject）
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
//   [59] done 收尾漏斗遇上到不了 done 的相位（人关掉的 closed，或已经是 done）→ 先抛
//        非法相位转移错，不停任何步
//   [60] checkpoint 不是 40 位 SHA 时 compare 不发请求，也不占匿名额度
//   [61] 已合并的响应缺对账要的字段（head、base.ref、default_branch、base 仓 id，有
//        checkpoint 时的 head sha）→ 不当终态缓存，之后照常节流重读（不带那次响应的 etag）
//   [62] PR 号是 daemon 按分支名查到的（gh pr list --head 只比分支名）：公开仓里
//        别人 fork 的同名分支开的 PR 也会被读成本 build 的。head 仓与 base 仓是同一个
//        仓（同一份响应里按仓库 id 比：仓库改名或转移后照样对得上）、head 分支是本
//        build 的工作分支才写；对不上（含 fork 已删、head 仓为 null）→ 不收尾、不打回，
//        每轮提示一次，按 etag 缓存；缺 head 分支或 base 仓 id → 读不到
//   [63] 合并步经 completeStep 收尾（不是直接调 finishTodoDone）同样停掉没人领的 verify 步
//        （本地仓形态；GitHub 形态有 PR 的 build 由 pacman 经 GitHub 合并，合并步完成不收尾，
//        见 pr-merge-api.test.ts [2b-D25]）
//   [64] 对账把拆卡子项收尾成 done → 推进拆卡波次：阻塞已解的兄弟卡开跑
//   [65] system 行里引用的 GitHub 文本（分支名、合并者、合并提交）去掉控制字符与格式
//        字符（双向覆盖、零宽字符，[65c]），截到 100 个字符
//   [66] 真实 GitHub 响应（test/fixtures/github，docs/verify/1403 同存）按对账用到的
//        字段解析（段 2b 起含 PR 标题：经 API 合并的提交标题取它）
//   [67] 关闭要两次紧挨着的读都看到才算：两次读之间有一段没读（有步在飞而跳过，含读的
//        网络窗里步开始）或有一次读不到 → 之前那次关闭不算数，从下一次读重新数（中间
//        可能重开又关过）；未连接 GitHub 时每 5 分钟一次的节流不算空档
//   [68] 合并之后 verify 步又推了提交（daemon 除审核步外每一步收尾都提交并推送）→ 那个
//        提交不在这次合并里，不收尾，提示一次
//   [69] sweep 日志里每个对账候选恰好落进一个计数（提示已落之后的各轮同样计数）
//   [70] 关闭未合并的 PR 目标不是默认分支（从工作分支往别的分支开的另一张 PR，如协作者
//        的 backport；daemon 探测取编号最大的 open PR 记在 build 上，本 build 真正的 PR
//        可能还开着）→ 不打回：确认之后提示一行，不写关闭行、不落 errorMessage、不停步、
//        相位不变（与合并进非默认分支同一条规则）；目标是默认分支（不论叫什么）→ 照常
//        打回；关闭的响应缺 base 分支或默认分支 → 读不到，从下一次完整的读重新数
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
import { githubBranchPulls, githubCompareStatus, githubPull } from '../src/lib/github.js';
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
  /** base 里没有 ref（base.repo 与它的 id 照常）。 */
  noBaseRef?: boolean;
  /** base.repo 里没有 default_branch（id 照常）。 */
  noDefaultBranch?: boolean;
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
  /** base.repo.owner.login（缺省不带 owner）。 */
  baseOwner?: string;
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

/** 工作分支 PR 列表（`pulls?state=all&head=&base=`，段 2 的 PR 身份收养读）里的一项。
 * 缺省：本仓（REPO_ID）、head 分支 = 世界里那个 build 的工作分支（headRefs 按号查，
 * 查不到为空串）、base main、open。 */
interface BranchPullSpec {
  number: number;
  state?: 'open' | 'closed';
  merged?: boolean;
  headRef?: string;
  headRepoId?: number | null;
  baseRef?: string;
  baseRepoId?: number;
  htmlUrl?: string;
  /** author_association（缺省 OWNER）；null = 响应里没有这个字段。 */
  authorAssociation?: string | null;
}

/** pulls/{n} 端点 mock：按 PR 号回应；compare 按 spec 回应；工作分支 PR 列表按
 * branchPulls 回应；其它 URL（check-runs）一律 404，证明 review 候选不走磨绿面。 */
class PullsMock {
  requests: string[] = [];
  headers: Record<string, string>[] = [];
  /** 下一次请求抛网络错（undici 的 TypeError 形）。 */
  throwNext = false;
  /** compare 请求到达时调用（网络窗竞态注入位）。 */
  onCompare: (() => void) | null = null;
  /** 工作分支 PR 列表的应答：数组 = 200 体；数字 = HTTP 错误码；'throw' = 网络错。 */
  branchPulls: BranchPullSpec[] | number | 'throw' = [];
  /** 工作分支 PR 列表请求到达时调用（网络窗竞态注入位）。 */
  onList: (() => void) | null = null;
  listRequests = () => this.requests.filter((u) => /\/pulls\?/.test(u));
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
    if (/\/pulls\?/.test(url)) {
      this.onList?.();
      const list = this.branchPulls;
      if (list === 'throw') return Promise.reject(new TypeError('fetch failed'));
      if (typeof list === 'number') return Promise.resolve(res(list, '"l"', []));
      const listedAt = new Date().toISOString();
      return Promise.resolve(
        res(
          200,
          '"l"',
          list.map((p) => ({
            number: p.number,
            state: p.state ?? 'open',
            merged_at: p.merged === true ? listedAt : null,
            html_url: p.htmlUrl ?? `https://github.com/octo/demo/pull/${p.number}`,
            ...(p.authorAssociation === null
              ? {}
              : { author_association: p.authorAssociation ?? 'OWNER' }),
            head: {
              ref: p.headRef ?? headRefs.get(p.number) ?? '',
              repo: p.headRepoId === null ? null : { id: p.headRepoId ?? REPO_ID },
            },
            base: { ref: p.baseRef ?? 'main', repo: { id: p.baseRepoId ?? REPO_ID } },
          })),
        ),
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
              ...(spec.noBaseRef ? {} : { ref: spec.baseRef ?? 'main' }),
              repo: {
                ...(spec.noBaseRepoId ? {} : { id: REPO_ID }),
                full_name: spec.baseRepo ?? 'octo/demo',
                ...(spec.baseOwner === undefined ? {} : { owner: { login: spec.baseOwner } }),
                ...(spec.noDefaultBranch ? {} : { default_branch: spec.defaultBranch ?? 'main' }),
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
  buildRow(): { errorMessage: string | null; prNumber: number | null; prUrl: string | null };
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
    /** project.repoKind（默认 github；local 时 githubRepo 为 null）。 */
    repoKind?: 'github' | 'local';
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
      repoKind: opts.repoKind ?? 'github',
      githubRepo: opts.repoKind === 'local' ? null : (opts.githubRepo ?? 'octo/demo'),
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
    // two reads, five minutes apart: a close counts only at the second (pr-gate run 11 on #1414)
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
  });

  test("⑨a two builds record one PR whose head is the current build's branch → read once, through the current build; rows land on it only", async () => {
    // makeWorld maps PR 201 to the newer (current) build's branch, so the ownership check
    // passes; what this pins is that the superseded build is neither read nor written.
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

  test("⑨b a second build records the PR the older build opened (its head is the older build's branch, #1217 / #1195) → foreign: stays in review, one hint, no merged row", async () => {
    const w = makeWorld({ newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId)); // the older build opened it from its branch
    const currentBuildId = w.s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, w.todoId))
      .get()?.latestBuildId;
    expect(currentBuildId).not.toBe(w.buildId);
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const info = vi.fn();
    const poller = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: mock.fetch, logger: { info } },
    );
    await poller.sweep();
    await poller.sweep(Date.now() + 300_000);
    expect(mock.requests.filter((u) => u.endsWith('/pulls/201'))).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]); // the older build's conversation is untouched
    const current = w.s.db
      .select()
      .from(messageTable)
      .all()
      .filter((r) => r.role === 'system' && r.conversationId === currentBuildId)
      .map((r) => String(r.content));
    expect(current).toHaveLength(1);
    expect(current[0]).toContain('PR #201');
    expect(current[0]).toContain(conversationBranch(String(currentBuildId)));
    expect(current.some((c) => c.startsWith('PR #201 已在 GitHub 合并'))).toBe(false);
    expect(current).not.toContain(DONE_ROW);
    const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
    expect(tally).toMatchObject({ reviewForeign: 1, merged: 0 });
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
    const listsBefore = mock.listRequests().length;
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBe('person note');
    // T1: a second read, 50 s or more later, is where a close would be confirmed; the close
    // was already reported this round, so it is not confirmed and reported again
    await poller.sweep(Date.now() + 600_000);
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBe('person note');
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`)),
    ).toHaveLength(1);
    expect(mock.listRequests()).toHaveLength(listsBefore);
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

  test("㉔b a verify step created in an earlier round finishes after this round's build step → its pushed commit is the one checked", async () => {
    const c1 = 'a'.repeat(40);
    const c2 = 'b'.repeat(40);
    const c3 = 'c'.repeat(40);
    const w = makeWorld();
    const t = Date.now();
    // round 1: build step B1 pushes C1; the card reaches review and verify step V is queued, but
    // the Verifier machine is offline. Round 2: changes requested, plan step P and build step B2
    // run; B2 pushes C2 and the PR is merged at C2. Then V is claimed, commits evidence on top
    // of C2 and pushes C3. Claim sets lastHeartbeatAt, heartbeats move it until the step ends.
    const steps = [
      { id: 'b1', kind: 'build', commit: c1, createdAt: t - 50_000, beat: t - 45_000 },
      { id: 'v', kind: 'verify', commit: c3, createdAt: t - 40_000, beat: t - 2_000 },
      { id: 'p', kind: 'plan', commit: null, createdAt: t - 30_000, beat: t - 25_000 },
      { id: 'b2', kind: 'build', commit: c2, createdAt: t - 20_000, beat: t - 10_000 },
    ] as const;
    for (const s of steps) {
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-${s.id}-${w.buildId}`,
          buildId: w.buildId,
          kind: s.kind,
          status: 'done',
          checkpointCommit: s.commit,
          createdAt: s.createdAt,
          claimedAt: s.beat - 3_000,
          lastHeartbeatAt: s.beat,
        })
        .run();
    }
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        headSha: c2,
        compareByBase: { [c3]: 'behind' },
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.compareRequests()).toHaveLength(1);
    expect(mock.compareRequests()[0]).toContain(`/compare/${c3}...${c2}`);
    expect(w.systemRows().some((c) => c.includes('ccccccc') && c.includes(`#${w.prNumber}`))).toBe(
      true,
    );
    expect(w.systemRows()).not.toContain(DONE_ROW);
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
    // T1: the second read after the reopen does not confirm the close again
    await poller.sweep(Date.now() + 600_000);
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

  test.each([
    ['base', { noBase: true }],
    // base.repo.id is there: only the base branch name or the default branch name is missing
    ['base.ref', { noBaseRef: true }],
    ['default_branch', { noDefaultBranch: true }],
  ] as const)(
    '㉗ a merged response without %s is not taken as a merge into the default branch',
    async (_label, missing) => {
      const w = makeWorld();
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true, ...missing } });
      const info = vi.fn();
      await createCiPoller(
        { ...w.s.svc, box: w.s.secretBox },
        { githubFetch: mock.fetch, logger: { info } },
      ).sweep();
      expect(w.todoRow().phase).toBe('review');
      expect(w.systemRows()).toEqual([]);
      const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
      expect(tally.reviewUnreadable).toBe(1);
    },
  );

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

  test('㉟ the merge step reports done after a person marked the card done: only the step is recorded, no completion row', () => {
    const w = makeWorld();
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    const mergeStepId = `step-merge-late-${w.buildId}`;
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
    updateTodo(w.s.svc, w.todoId, { phase: 'done' }, { manualPhase: true });
    // the production path: the machine's done report goes through completeStep (#1453)
    completeStep(w.s.svc, mergeStepId);
    expect(w.todoRow().phase).toBe('done');
    expect(w.stepRows().find((r) => r.kind === 'merge')?.status).toBe('done');
    expect(w.systemRows()).toEqual([]);
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

  test.each(['../user', 'octo/..', './demo'])(
    '㊳b githubRepo %s with a dot segment (#1466) → no request',
    async (githubRepo) => {
      const w = makeWorld({ githubRepo });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
      await pollerFor(w, mock).sweep();
      expect(mock.requests).toEqual([]);
      expect(w.todoRow().phase).toBe('review');
    },
  );

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

  test('[49] the reconcile finishes the card: the done card is published without the quota wait of the verify step it stopped', async () => {
    const w = makeWorld({ connected: true, inflight: 'waiting_quota', inflightKind: 'verify' });
    w.s.db
      .update(stepTable)
      .set({ quotaBlock: QUOTA_BLOCK })
      .where(eq(stepTable.buildId, w.buildId))
      .run();
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    const hub = w.s.svc.hub;
    const docs: Parameters<typeof hub.publishTodoDoc>[1][] = [];
    const publish = hub.publishTodoDoc.bind(hub);
    hub.publishTodoDoc = (teamId, doc) => {
      docs.push(doc);
      publish(teamId, doc);
    };
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: true } });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('done');
    expect(docs.at(-1)?.phase).toBe('done');
    expect(docs.at(-1)?.quotaWait).toBeNull();
  });

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

  test.each(['closed', 'done'] as const)(
    '[59] the done funnel on a card a person moved to %s throws before it stops anything',
    (phase) => {
      const w = makeWorld({ inflight: 'pending', inflightKind: 'verify' });
      w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
      updateTodo(w.s.svc, w.todoId, { phase }, { manualPhase: true });
      expect(() => finishTodoDone(w.s.svc, w.todoId, w.buildId)).toThrow(
        `illegal phase transition: ${phase} -> done`,
      );
      expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('pending');
      expect(w.systemRows()).toEqual([]);
    },
  );

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
    ['base.ref', {}, { noBaseRef: true }],
    ['default_branch', {}, { noDefaultBranch: true }],
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
      Object.assign(spec, {
        noBaseRef: false,
        noDefaultBranch: false,
        noBaseRepoId: false,
        noHead: false,
        noHeadSha: false,
      });
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
    // local form: on a GitHub build with a PR the merge step no longer finishes the card
    // (#1403 segment 2b, pr-merge-api.test.ts [2b-D25])
    const w = makeWorld({ inflight: 'pending', inflightKind: 'verify', repoKind: 'local' });
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

  test('[65c] format characters in a branch name (a bidi override, zero-width characters) are stripped from the hint', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        baseRef: 'rel‮ease​-x',
        defaultBranch: 'ma‍in⁦',
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    const hints = w.systemRows().filter((c) => c.includes(`PR #${w.prNumber}`));
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('「release-x」');
    expect(hints[0]).toContain('「main」');
    expect(hints[0]).not.toMatch(/\p{Cf}/u);
  });

  test.each([
    ['the sweep skips the read', 'before'],
    ['it starts during the read, the sweep drops what it read', 'during'],
  ] as const)(
    '[67a] a step runs after the first closed read (%s): the first read after it does not confirm the close',
    async (_label, at) => {
      const w = makeWorld({ connected: true });
      const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
      const stepId = `step-verify-run-${w.buildId}`;
      const claimVerify = () =>
        w.s.db
          .insert(stepTable)
          .values({
            id: stepId,
            buildId: w.buildId,
            kind: 'verify',
            status: 'claimed',
            createdAt: Date.now(),
          })
          .run();
      let raceNext = false;
      const poller = createCiPoller(
        { ...w.s.svc, box: w.s.secretBox },
        {
          githubFetch: (input, init) => {
            if (raceNext) {
              raceNext = false;
              claimVerify();
            }
            return mock.fetch(input, init);
          },
        },
      );
      const t0 = Date.now();
      await poller.sweep(t0); // the first sighting of the close
      if (at === 'before') claimVerify();
      else raceNext = true;
      // the step runs for a while; the PR may have been reopened and closed again unseen
      await poller.sweep(t0 + 60_000);
      w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, stepId)).run();
      await poller.sweep(t0 + 900_000);
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow().errorMessage).toBeNull();
      await poller.sweep(t0 + 960_000); // the read right after still sees it closed
      expect(w.todoRow().phase).toBe('failed');
    },
  );

  test.each([
    ['a network error', 'throw'],
    ['a response without head', 'noHead'],
  ] as const)(
    '[67b] a read that gets nothing (%s) between two closed reads: the count starts over',
    async (_label, failure) => {
      const w = makeWorld({ connected: true });
      const spec: PullSpec = { state: 'closed', merged: false };
      const mock = new PullsMock({ [w.prNumber]: spec });
      mock.status304 = false; // every read gets a full body
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      if (failure === 'throw') mock.throwNext = true;
      else spec.noHead = true;
      await poller.sweep(t0 + 60_000);
      spec.noHead = false;
      await poller.sweep(t0 + 120_000);
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow().errorMessage).toBeNull();
      await poller.sweep(t0 + 180_000);
      expect(w.todoRow().phase).toBe('failed');
    },
  );

  test('[67c] anonymous: the sweeps that skip a PR for the five-minute interval do not reset its close', async () => {
    const w = makeWorld();
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    for (let k = 0; k < 5; k += 1) await poller.sweep(t0 + k * 60_000);
    expect(mock.requests).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(t0 + 300_000);
    // the confirming read is followed by the branch PR list read (segment 2, A3)
    expect(mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`))).toHaveLength(2);
    expect(w.todoRow().phase).toBe('failed');
  });

  test('[68] merged at the last build checkpoint, then a verify step pushed a commit → stays in review with a hint', async () => {
    const built = 'a'.repeat(40);
    const verified = 'b'.repeat(40);
    const w = makeWorld({ checkpoint: built });
    // the daemon commits and pushes at the end of every step but review
    w.s.db
      .insert(stepTable)
      .values({
        id: `step-verify-pushed-${w.buildId}`,
        buildId: w.buildId,
        kind: 'verify',
        status: 'done',
        checkpointCommit: verified,
        createdAt: Date.now(),
      })
      .run();
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: true,
        mergeCommitSha: 'abc1234',
        headSha: built,
        compareByBase: { [verified]: 'behind' },
      },
    });
    await pollerFor(w, mock).sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(mock.compareRequests()[0]).toContain(`/compare/${verified}...${built}`);
    expect(w.systemRows().some((c) => c.includes('bbbbbbb') && c.includes(`#${w.prNumber}`))).toBe(
      true,
    );
    expect(w.systemRows()).not.toContain(DONE_ROW);
  });

  test('[69] every review candidate lands in exactly one bucket of the sweep log, also after its hint is written', async () => {
    const w = makeWorld({ connected: true, checkpoint: 'a'.repeat(40) });
    addReviewCard(w, 301);
    addReviewCard(w, 302);
    addReviewCard(w, 303);
    const mock = new PullsMock({
      // merged, but the checkpoint is not in the merged head: a hint
      [w.prNumber]: { state: 'closed', merged: true, compare: 'diverged' },
      // merged into another branch: a hint
      301: { state: 'closed', merged: true, baseRef: 'release-x', defaultBranch: 'main' },
      // a fork PR with the same branch name: foreign, with its own hint
      302: { state: 'closed', merged: false, headRepo: 'mallory/demo', headRepoId: REPO_ID + 1 },
      303: { state: 'open', merged: false },
    });
    const info = vi.fn();
    const poller = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: mock.fetch, logger: { info } },
    );
    const buckets = [
      'reviewPending',
      'reviewSkipped',
      'reviewUnreadable',
      'reviewForeign',
      'merged',
      'closedUnmerged',
      'hinted',
      'settledBefore',
      'adopted',
    ] as const;
    for (const t of [0, 60_000]) {
      await poller.sweep(Date.now() + t);
      const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
      expect(tally.reviewCandidates).toBe(4);
      expect(buckets.reduce((n, k) => n + (tally[k] ?? 0), 0)).toBe(4);
      expect(tally).toMatchObject({ hinted: 2, reviewForeign: 1, reviewPending: 1, errors: 0 });
    }
    // each hint was written once
    const all = w.s.db
      .select()
      .from(messageTable)
      .all()
      .filter((r) => r.role === 'system');
    expect(all).toHaveLength(3);
  });

  test('[70a] a PR from the work branch into another branch (a backport) closed without merge → after the confirming read, one hint and nothing else', async () => {
    const w = makeWorld({ connected: true, inflight: 'pending', inflightKind: 'verify' });
    const mock = new PullsMock({
      [w.prNumber]: {
        state: 'closed',
        merged: false,
        baseRef: 'release-1.2',
        defaultBranch: 'main',
      },
    });
    const info = vi.fn();
    const poller = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: mock.fetch, logger: { info } },
    );
    const tallyOf = () => info.mock.calls.at(-1)?.[0] as Record<string, number>;
    const t0 = Date.now();
    await poller.sweep(t0); // first sighting of the close: a close and reopen leaves nothing
    expect(w.systemRows()).toEqual([]);
    expect(tallyOf().reviewPending).toBe(1);
    await poller.sweep(t0 + 60_000); // the confirming read
    await poller.sweep(t0 + 120_000);
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().errorMessage).toBeNull();
    expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('pending');
    const rows = w.systemRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(`PR #${w.prNumber}`);
    expect(rows[0]).toContain('「release-1.2」');
    expect(rows[0]).toContain('「main」');
    expect(rows.some((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`))).toBe(
      false,
    );
    expect(tallyOf()).toMatchObject({ hinted: 1, closedUnmerged: 0 });
  });

  test('[70b] closed without merge into the default branch, whatever it is called → failed as before', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: false, baseRef: 'trunk', defaultBranch: 'trunk' },
    });
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().errorMessage ?? '').toContain(`#${w.prNumber}`);
    expect(
      w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`)),
    ).toHaveLength(1);
  });

  test.each([
    ['base.ref', { noBaseRef: true }],
    ['default_branch', { noDefaultBranch: true }],
  ] as const)(
    '[70c] a closed response without %s is unreadable: not failed; the close counts again from the next complete read',
    async (_label, missing) => {
      const w = makeWorld({ connected: true });
      const spec: PullSpec = { state: 'closed', merged: false, ...missing };
      const mock = new PullsMock({ [w.prNumber]: spec });
      const info = vi.fn();
      const poller = createCiPoller(
        { ...w.s.svc, box: w.s.secretBox },
        { githubFetch: mock.fetch, logger: { info } },
      );
      const t0 = Date.now();
      await poller.sweep(t0);
      await poller.sweep(t0 + 60_000);
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow().errorMessage).toBeNull();
      expect(w.systemRows()).toEqual([]);
      const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
      expect(tally.reviewUnreadable).toBe(1);
      Object.assign(spec, { noBaseRef: false, noDefaultBranch: false });
      await poller.sweep(t0 + 120_000);
      expect(w.todoRow().phase).toBe('review');
      await poller.sweep(t0 + 180_000);
      expect(w.todoRow().phase).toBe('failed');
    },
  );

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
      baseOwner: 'xiechimon',
      title: 'server(1403): reconcile review-phase PRs merged or closed on GitHub',
      authorAssociation: 'OWNER',
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
      baseOwner: 'xiechimon',
      title: 'server(1453): a step that finishes before its stop lands leaves an exited card alone',
      authorAssociation: 'OWNER',
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

// —— #1403 段 2：PR 身份（工作分支上的 PR 收养）与无测试的规则钉 ——————————————
// 失败方式正本 = docs/verify/1403/seg2-failure-modes.txt（A1-A14 = PR 身份，T1-T6 =
// 测试钉；T1 写在 ⑱d / ⑱f 里）。build 上记的 PR 号只在非审核步收尾时由 daemon 探测刷新：
// 人在 review 期间关掉 #N、从同一工作分支开 #M，对账确认关闭时按 #N 打回，之后 #M 合并也
// 看不到。确认关闭之后（以及每轮第一次读到别人的 PR 时）先列本 build 工作分支上的 PR。

describe('#1403 segment 2: the PR the build tracks', () => {
  /** 关闭未合并的已记 PR + 同分支上的另一张 PR（号 202，head = 本 build 的工作分支）。 */
  function closedWithSibling(opts: { connected?: boolean; sibling?: PullSpec } = {}) {
    const w = makeWorld({
      connected: opts.connected ?? true,
      inflight: 'pending',
      inflightKind: 'verify',
    });
    const branch = conversationBranch(w.buildId);
    headRefs.set(202, branch);
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: false },
      202: opts.sibling ?? { state: 'open', merged: false },
    });
    return { w, branch, mock };
  }

  const closedRows = (w: World) =>
    w.systemRows().filter((c) => c.startsWith(`PR #${w.prNumber} 已在 GitHub 关闭且未合并`));

  test("[s2-A1] closed and confirmed, an open PR from the build's own branch → that PR is recorded, nothing fails", async () => {
    const { w, branch, mock } = closedWithSibling();
    mock.branchPulls = [{ number: 202 }, { number: w.prNumber, state: 'closed' }];
    const info = vi.fn();
    const published = vi.spyOn(w.s.hub, 'publishBuildDoc');
    const poller = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: mock.fetch, logger: { info } },
    );
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(mock.listRequests()).toEqual([]); // A6: not on the first sighting
    await poller.sweep(t0 + 60_000);
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow()).toMatchObject({
      prNumber: 202,
      prUrl: 'https://github.com/octo/demo/pull/202',
      errorMessage: null,
    });
    // the board and the PR panel learn the new number
    expect(published.mock.calls.some(([, record]) => record.prNumber === 202)).toBe(true);
    expect(closedRows(w)).toEqual([]);
    const adopted = w
      .systemRows()
      .filter((c) => c.includes(`#${w.prNumber}`) && c.includes('#202'));
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toContain(`「${branch}」`);
    // the unclaimed verify step stays queued: nothing was settled
    expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('pending');
    expect(mock.listRequests()).toHaveLength(1);
    const listed = decodeURIComponent(mock.listRequests()[0] ?? '');
    expect(listed).toContain('https://api.github.com/repos/octo/demo/pulls?');
    for (const part of ['state=all', `head=octo:${branch}`, 'base=main', 'per_page=10']) {
      expect(listed).toContain(part);
    }
    // A12: counted as adopted, every candidate in exactly one bucket
    const tally = info.mock.calls.at(-1)?.[0] as Record<string, number>;
    expect(tally).toMatchObject({ adopted: 1, closedUnmerged: 0, reviewCandidates: 1 });
    const buckets = [
      'reviewPending',
      'reviewSkipped',
      'reviewUnreadable',
      'reviewForeign',
      'merged',
      'closedUnmerged',
      'hinted',
      'settledBefore',
      'adopted',
    ];
    expect(buckets.reduce((n, k) => n + (tally[k] ?? 0), 0)).toBe(1);
    // the next sweep reads the adopted PR; A10: the old number is not read again
    await poller.sweep(t0 + 120_000);
    expect(mock.requests.filter((u) => u.endsWith('/pulls/202'))).toHaveLength(1);
    expect(mock.requests.filter((u) => u.endsWith(`/pulls/${w.prNumber}`))).toHaveLength(2);
    expect(w.todoRow().phase).toBe('review');
  });

  test('[s2-A2] the PR on the same branch is already merged → it is recorded, then the merged path finishes the card', async () => {
    const { w, mock } = closedWithSibling({
      sibling: { state: 'closed', merged: true, mergeCommitSha: 'abc1234def' },
    });
    mock.branchPulls = [{ number: 202, state: 'closed', merged: true }];
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    expect(w.buildRow().prNumber).toBe(202);
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(t0 + 120_000);
    expect(w.todoRow().phase).toBe('done');
    expect(w.systemRows().some((c) => c.startsWith('PR #202 已在 GitHub 合并'))).toBe(true);
    expect(closedRows(w)).toEqual([]);
  });

  test('[s2-A3] no other PR on the branch → failed as before, after one list read', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: w.prNumber, state: 'closed' }];
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().prNumber).toBe(w.prNumber);
    expect(closedRows(w)).toHaveLength(1);
    expect(mock.listRequests()).toHaveLength(1);
  });

  test.each([
    ['a fork PR with the same branch name', { number: 202, headRepoId: REPO_ID + 1 }],
    ['a fork that was deleted (head repo null)', { number: 202, headRepoId: null }],
    ['a PR from another branch', { number: 202, headRef: 'feature-x' }],
    ['a PR into another base', { number: 202, baseRef: 'release-x' }],
    ['a PR whose base is another repository', { number: 202, baseRepoId: REPO_ID + 5 }],
    ['another closed PR that was not merged', { number: 202, state: 'closed' as const }],
  ])('[s2-A4] the list holds only %s → not recorded, failed as before', async (_label, entry) => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [entry];
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().prNumber).toBe(w.prNumber);
  });

  test.each([502, 429, 'throw'] as const)(
    '[s2-A5] the list read fails (%s) → nothing written; the next sweep confirms again and acts',
    async (failure) => {
      const { w, mock } = closedWithSibling();
      mock.branchPulls = failure;
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      await poller.sweep(t0 + 60_000);
      expect(mock.listRequests()).toHaveLength(1);
      expect(w.todoRow().phase).toBe('review');
      expect(w.buildRow()).toMatchObject({ prNumber: w.prNumber, errorMessage: null });
      expect(w.systemRows()).toEqual([]);
      mock.branchPulls = [];
      await poller.sweep(t0 + 120_000);
      expect(mock.listRequests()).toHaveLength(2);
      expect(w.todoRow().phase).toBe('failed');
    },
  );

  test('[s2-A6] no list read for a close and reopen, or for a closed PR into another base', async () => {
    const reopened = closedWithSibling();
    const poller = pollerFor(reopened.w, reopened.mock);
    const spec = reopened.mock.pulls[reopened.w.prNumber];
    const t0 = Date.now();
    await poller.sweep(t0);
    if (spec !== undefined) spec.state = 'open';
    reopened.mock.status304 = false;
    await poller.sweep(t0 + 60_000);
    expect(reopened.mock.listRequests()).toEqual([]);
    expect(reopened.w.todoRow().phase).toBe('review');

    const other = makeWorld({ connected: true });
    const mock = new PullsMock({
      [other.prNumber]: { state: 'closed', merged: false, baseRef: 'release-x' },
    });
    await sweepTwice(pollerFor(other, mock));
    expect(mock.listRequests()).toEqual([]);
    expect(other.todoRow().phase).toBe('review');
  });

  test.each(['the card leaves review', 'a step starts'] as const)(
    '[s2-A7] %s while the list read is in flight → no write',
    async (race) => {
      const { w, mock } = closedWithSibling();
      mock.branchPulls = [{ number: 202 }];
      mock.onList = () => {
        if (race === 'the card leaves review') {
          w.s.db
            .update(todoTable)
            .set({ phase: 'planning' })
            .where(eq(todoTable.id, w.todoId))
            .run();
        } else {
          w.s.db
            .insert(stepTable)
            .values({
              id: `step-merge-race-${w.buildId}`,
              buildId: w.buildId,
              kind: 'merge',
              status: 'claimed',
              createdAt: Date.now(),
            })
            .run();
        }
      };
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      await poller.sweep(t0 + 60_000);
      expect(mock.listRequests()).toHaveLength(1);
      expect(w.buildRow().prNumber).toBe(w.prNumber);
      expect(w.systemRows()).toEqual([]);
      expect(w.todoRow().phase).toBe(race === 'the card leaves review' ? 'planning' : 'review');
    },
  );

  test("[s2-A8] anonymous: the list read takes the slot the pulls read kept for it, within the reconcile's own budget", async () => {
    const { w, mock } = closedWithSibling({ connected: false });
    mock.branchPulls = [{ number: 202 }];
    const poller = pollerFor(w, mock, { anonReadsPerHour: 4 });
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 300_000);
    expect(mock.requests).toHaveLength(3);
    expect(mock.listRequests()).toHaveLength(1);
    expect(w.buildRow().prNumber).toBe(202);
    // the list read counted: one of four left, and a pulls read needs room for two
    await poller.sweep(t0 + 360_000);
    expect(mock.requests.filter((u) => u.endsWith('/pulls/202'))).toEqual([]);
  });

  test('[s2-A15] the recorded PR shows up open in the list (reopened between the two reads) → not failed, nothing written', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: w.prNumber }];
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    expect(mock.listRequests()).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow()).toMatchObject({ prNumber: w.prNumber, errorMessage: null });
    expect(w.systemRows()).toEqual([]);
    // the next closed read is a first sighting again, not a confirmation
    mock.branchPulls = [];
    await poller.sweep(t0 + 120_000);
    expect(w.todoRow().phase).toBe('review');
  });

  test("[s2-A9] the recorded PR is another build's (9b shape) and this build has its own PR → its own PR is recorded, no foreign hint", async () => {
    const w = makeWorld({ connected: true, newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId)); // the older build opened it from its branch
    const currentBuildId = String(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
    );
    const own = conversationBranch(currentBuildId);
    headRefs.set(305, own);
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
      305: { state: 'open', merged: false },
    });
    mock.branchPulls = [{ number: 305 }];
    const info = vi.fn();
    const poller = createCiPoller(
      { ...w.s.svc, box: w.s.secretBox },
      { githubFetch: mock.fetch, logger: { info } },
    );
    await poller.sweep();
    const current = w.s.db.select().from(buildTable).where(eq(buildTable.id, currentBuildId)).get();
    expect(current?.prNumber).toBe(305);
    const rows = w.s.db
      .select()
      .from(messageTable)
      .all()
      .filter((r) => r.role === 'system' && r.conversationId === currentBuildId)
      .map((r) => String(r.content));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('#201');
    expect(rows[0]).toContain('#305');
    expect(rows[0]).toContain(`「${own}」`);
    expect(w.todoRow().phase).toBe('review');
    expect(info.mock.calls.at(-1)?.[0]).toMatchObject({ adopted: 1, reviewForeign: 0 });
    expect(decodeURIComponent(mock.listRequests()[0] ?? '')).toContain(`head=octo:${own}`);
  });

  test('[s2-A7b] the recorded PR is foreign and a step starts while the list read is in flight → no write', async () => {
    const w = makeWorld({ connected: true, newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId));
    const currentBuildId = String(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
    );
    headRefs.set(305, conversationBranch(currentBuildId));
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    mock.branchPulls = [{ number: 305 }];
    mock.onList = () => {
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-merge-race-${currentBuildId}`,
          buildId: currentBuildId,
          kind: 'merge',
          status: 'claimed',
          createdAt: Date.now(),
        })
        .run();
    };
    await pollerFor(w, mock).sweep();
    expect(mock.listRequests()).toHaveLength(1);
    const current = w.s.db.select().from(buildTable).where(eq(buildTable.id, currentBuildId)).get();
    expect(current?.prNumber).toBe(201);
    const rows = w.s.db
      .select()
      .from(messageTable)
      .all()
      .filter((r) => r.role === 'system');
    expect(rows).toEqual([]);
  });

  test('[s2-A9b] the recorded PR is foreign and the build has no PR of its own → one hint per round; the branch is listed again after ten minutes and a PR of its own found then is recorded', async () => {
    const w = makeWorld({ connected: true, newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId));
    const currentBuildId = String(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
    );
    headRefs.set(305, conversationBranch(currentBuildId));
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    await poller.sweep(t0 + 120_000);
    expect(mock.listRequests()).toHaveLength(1);
    const hints = () =>
      w.s.db
        .select()
        .from(messageTable)
        .all()
        .filter((r) => r.role === 'system' && String(r.content).includes('#201'));
    expect(hints()).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    // meanwhile the build's own PR was opened and merged on GitHub
    mock.branchPulls = [{ number: 305, state: 'closed', merged: true }];
    await poller.sweep(t0 + 600_000);
    expect(mock.listRequests()).toHaveLength(2);
    const current = w.s.db.select().from(buildTable).where(eq(buildTable.id, currentBuildId)).get();
    expect(current?.prNumber).toBe(305);
    expect(hints().filter((r) => String(r.content).includes('#305'))).toHaveLength(1);
  });

  test.each([
    ['an open PR and merged ones → the open one', [205, 204, 203], 204],
    ['only merged ones → the highest number', [203, 205], 205],
  ] as const)('[s2-A11] %s', async (_label, numbers, expected) => {
    const { w, mock } = closedWithSibling();
    for (const n of numbers) headRefs.set(n, conversationBranch(w.buildId));
    mock.branchPulls = numbers.map((n) =>
      n === 204 ? { number: n } : { number: n, state: 'closed' as const, merged: true },
    );
    await sweepTwice(pollerFor(w, mock));
    expect(w.buildRow().prNumber).toBe(expected);
  });

  test('[s2-A15b] the recorded PR is open again and the list also has a higher open PR of the branch → still a reopen, nothing recorded', async () => {
    const { w, mock } = closedWithSibling();
    headRefs.set(221, conversationBranch(w.buildId));
    mock.branchPulls = [{ number: 221 }, { number: w.prNumber }];
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('review');
    expect(w.buildRow().prNumber).toBe(w.prNumber);
    expect(w.systemRows()).toEqual([]);
  });

  test('[s2-A16] only a merged PR older than the recorded one is on the branch → not recorded; the close of the newer one stands', async () => {
    const { w, mock } = closedWithSibling();
    headRefs.set(150, conversationBranch(w.buildId));
    mock.branchPulls = [{ number: 150, state: 'closed', merged: true }];
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().prNumber).toBe(w.prNumber);
    expect(closedRows(w)).toHaveLength(1);
  });

  test('[s2-A17] the list asks for the owner the PR response names, not the stored one (renamed or transferred repository)', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: false, baseOwner: 'octo-moved' },
    });
    await sweepTwice(pollerFor(w, mock));
    const listed = decodeURIComponent(mock.listRequests()[0] ?? '');
    expect(listed).toContain(`head=octo-moved:${conversationBranch(w.buildId)}`);
  });

  test.each([502, 'throw'] as const)(
    '[s2-A9c] the recorded PR is foreign and the list read fails (%s) → the hint as before; the branch is listed again after ten minutes',
    async (failure) => {
      const w = makeWorld({ connected: true, newerBuildPr: 201 });
      headRefs.set(201, conversationBranch(w.buildId));
      const currentBuildId = String(
        w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
      );
      headRefs.set(305, conversationBranch(currentBuildId));
      const mock = new PullsMock({
        201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
      });
      mock.branchPulls = failure;
      const poller = pollerFor(w, mock);
      const t0 = Date.now();
      await poller.sweep(t0);
      const hints = w.s.db
        .select()
        .from(messageTable)
        .all()
        .filter((r) => r.role === 'system' && r.conversationId === currentBuildId);
      expect(hints).toHaveLength(1);
      expect(String(hints[0]?.content)).toContain('PR #201 的 head');
      mock.branchPulls = [{ number: 305 }];
      await poller.sweep(t0 + 60_000);
      expect(mock.listRequests()).toHaveLength(1);
      await poller.sweep(t0 + 600_000);
      expect(mock.listRequests()).toHaveLength(2);
      const current = w.s.db
        .select()
        .from(buildTable)
        .where(eq(buildTable.id, currentBuildId))
        .get();
      expect(current?.prNumber).toBe(305);
    },
  );

  test("[s2-A9e] the recorded PR is foreign and the build's own merged PR has a lower number → recorded (the recorded number is someone else's)", async () => {
    const w = makeWorld({ connected: true, newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId));
    const currentBuildId = String(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
    );
    headRefs.set(150, conversationBranch(currentBuildId));
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    mock.branchPulls = [{ number: 150, state: 'closed', merged: true }];
    await pollerFor(w, mock).sweep();
    const current = w.s.db.select().from(buildTable).where(eq(buildTable.id, currentBuildId)).get();
    expect(current?.prNumber).toBe(150);
  });

  test("[s2-A9d] the recorded PR is open but not the build's own → it is not left pending: the build's own PR is recorded, or one hint per round", async () => {
    const adopt = makeWorld({ connected: true });
    headRefs.set(adopt.prNumber, 'someone-else/feature'); // the daemon recorded a PR from another branch
    headRefs.set(202, conversationBranch(adopt.buildId));
    const mock = new PullsMock({ [adopt.prNumber]: { state: 'open', merged: false } });
    mock.branchPulls = [{ number: 202 }];
    await pollerFor(adopt, mock).sweep();
    expect(adopt.buildRow().prNumber).toBe(202);
    expect(adopt.todoRow().phase).toBe('review');

    const hint = makeWorld({ connected: true });
    headRefs.set(hint.prNumber, 'someone-else/feature');
    const mock2 = new PullsMock({ [hint.prNumber]: { state: 'open', merged: false } });
    const poller = pollerFor(hint, mock2);
    await poller.sweep();
    await poller.sweep(Date.now() + 60_000);
    expect(mock2.listRequests()).toHaveLength(1);
    const hints = hint.systemRows().filter((c) => c.includes(`PR #${hint.prNumber} 的 head`));
    expect(hints).toHaveLength(1);
    expect(hint.buildRow().prNumber).toBe(hint.prNumber);
  });

  /** 9b 形：较早的 build 开的 PR（号 201，head 是那个 build 的分支）记在当前 build 上。 */
  function foreignWorld(opts: { connected?: boolean } = {}) {
    const w = makeWorld({ connected: opts.connected ?? true, newerBuildPr: 201 });
    headRefs.set(201, conversationBranch(w.buildId));
    const currentBuildId = String(
      w.s.db.select().from(todoTable).where(eq(todoTable.id, w.todoId)).get()?.latestBuildId,
    );
    const own = conversationBranch(currentBuildId);
    const mock = new PullsMock({
      201: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const currentPr = () =>
      w.s.db.select().from(buildTable).where(eq(buildTable.id, currentBuildId)).get()?.prNumber;
    const currentRows = () =>
      w.s.db
        .select()
        .from(messageTable)
        .all()
        .filter((r) => r.role === 'system' && r.conversationId === currentBuildId)
        .map((r) => String(r.content));
    return { w, mock, currentBuildId, own, currentPr, currentRows };
  }

  test('[s2-A18] a merged PR of the build is not taken when a newer PR of the build was closed without merge (the person rejected the newer work)', async () => {
    // foreign path: own #150 merged, own #160 closed unmerged → nothing to adopt, the hint
    const f = foreignWorld();
    headRefs.set(150, f.own);
    headRefs.set(160, f.own);
    f.mock.branchPulls = [
      { number: 160, state: 'closed' },
      { number: 150, state: 'closed', merged: true },
    ];
    await pollerFor(f.w, f.mock).sweep();
    expect(f.currentPr()).toBe(201);
    expect(f.currentRows().some((c) => c.includes('PR #201 的 head'))).toBe(true);

    // closed path: own #205 merged, own #210 closed unmerged, the recorded #201 closed → failed
    const { w, mock } = closedWithSibling();
    headRefs.set(205, conversationBranch(w.buildId));
    headRefs.set(210, conversationBranch(w.buildId));
    mock.branchPulls = [
      { number: 210, state: 'closed' },
      { number: 205, state: 'closed', merged: true },
    ];
    await sweepTwice(pollerFor(w, mock));
    expect(w.todoRow().phase).toBe('failed');
    expect(w.buildRow().prNumber).toBe(w.prNumber);
  });

  test('[s2-A19] the build records another PR while the list read is in flight (the daemon probe) → that value is kept, nothing written', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: 202 }];
    mock.onList = () => {
      w.s.db.update(buildTable).set({ prNumber: 555 }).where(eq(buildTable.id, w.buildId)).run();
    };
    await sweepTwice(pollerFor(w, mock));
    expect(w.buildRow().prNumber).toBe(555);
    expect(w.systemRows()).toEqual([]);
    expect(w.todoRow().phase).toBe('review');
  });

  test('[s2-A20] the daemon probe records the foreign PR again and the reconcile adopts again → the adoption row is written once per round', async () => {
    const f = foreignWorld();
    headRefs.set(305, f.own);
    f.mock.pulls[305] = { state: 'open', merged: false };
    f.mock.branchPulls = [{ number: 305 }];
    const poller = pollerFor(f.w, f.mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(f.currentPr()).toBe(305);
    await poller.sweep(t0 + 60_000);
    f.w.s.db
      .update(buildTable)
      .set({ prNumber: 201 })
      .where(eq(buildTable.id, f.currentBuildId))
      .run();
    await poller.sweep(t0 + 600_000);
    expect(f.currentPr()).toBe(305);
    expect(f.currentRows().filter((c) => c.includes('改记'))).toHaveLength(1);
  });

  test('[s2-A21] anonymous: the foreign path lists the branch at most once an hour', async () => {
    const f = foreignWorld({ connected: false });
    const poller = pollerFor(f.w, f.mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    expect(f.mock.listRequests()).toHaveLength(1);
    await poller.sweep(t0 + 600_000);
    expect(f.mock.listRequests()).toHaveLength(1);
    await poller.sweep(t0 + 3_600_000);
    expect(f.mock.listRequests()).toHaveLength(2);
  });

  test('[s2-A22] the recorded PR changes: the ten-minute wait starts again for the new one', async () => {
    const f = foreignWorld();
    const poller = pollerFor(f.w, f.mock);
    const t0 = Date.now();
    await poller.sweep(t0); // lists for #201, nothing of its own yet
    // the daemon probe records another foreign PR; meanwhile the build's own PR was opened
    headRefs.set(202, conversationBranch(f.w.buildId));
    f.mock.pulls[202] = { state: 'closed', merged: true, mergeCommitSha: 'def5678' };
    headRefs.set(305, f.own);
    f.mock.branchPulls = [{ number: 305 }];
    f.w.s.db
      .update(buildTable)
      .set({ prNumber: 202 })
      .where(eq(buildTable.id, f.currentBuildId))
      .run();
    await poller.sweep(t0 + 120_000);
    expect(f.mock.listRequests()).toHaveLength(2);
    expect(f.currentPr()).toBe(305);
  });

  test('[s2-A5b] the list read fails at two confirming reads in a row → the close is reported as in segment 1', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = 502;
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(t0 + 120_000);
    expect(mock.listRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('failed');
    expect(closedRows(w)).toHaveLength(1);
  });

  test('[s2-A5c] a failed list read during an earlier close does not count toward a later close', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = 502;
    const poller = pollerFor(w, mock);
    const spec = mock.pulls[w.prNumber];
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000); // confirmed, the list read fails once
    mock.status304 = false;
    if (spec !== undefined) spec.state = 'open';
    await poller.sweep(t0 + 120_000); // reopened to rerun CI
    if (spec !== undefined) spec.state = 'closed';
    await poller.sweep(t0 + 180_000);
    await poller.sweep(t0 + 240_000); // confirmed again, the list read fails once more
    expect(mock.listRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('[s2-A15c] the recorded PR shows up merged in the list (merged between the two reads) → nothing written; the next read finishes the card', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: w.prNumber, state: 'closed', merged: true }];
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
    const spec = mock.pulls[w.prNumber];
    if (spec !== undefined) spec.merged = true;
    mock.status304 = false;
    await poller.sweep(t0 + 120_000);
    expect(w.todoRow().phase).toBe('done');
    expect(closedRows(w)).toEqual([]);
  });

  test('[s2-A22b] the build goes back to a PR it recorded before: the old listing time is gone, the branch is listed at once', async () => {
    const f = foreignWorld();
    headRefs.set(202, conversationBranch(f.w.buildId));
    f.mock.pulls[202] = { state: 'closed', merged: true, mergeCommitSha: 'def5678' };
    const poller = pollerFor(f.w, f.mock);
    const setRecorded = (n: number) =>
      f.w.s.db
        .update(buildTable)
        .set({ prNumber: n })
        .where(eq(buildTable.id, f.currentBuildId))
        .run();
    const t0 = Date.now();
    await poller.sweep(t0); // lists for #201
    setRecorded(202);
    await poller.sweep(t0 + 60_000); // lists for #202
    setRecorded(201);
    headRefs.set(305, f.own);
    f.mock.pulls[305] = { state: 'open', merged: false };
    f.mock.branchPulls = [{ number: 305 }];
    await poller.sweep(t0 + 120_000); // #201 again: listed at once
    expect(f.mock.listRequests()).toHaveLength(3);
    expect(f.currentPr()).toBe(305);
  });

  test('[s2-A13] the recorded URL is built from the repository and number, not taken from the response', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: 202, htmlUrl: 'https://evil.example/pull/202‮' }];
    await sweepTwice(pollerFor(w, mock));
    expect(w.buildRow().prUrl).toBe('https://github.com/octo/demo/pull/202');
    expect(w.systemRows().join('\n')).not.toContain('evil');
  });

  test('[s2-A14] the branch PR list parser: live captures, and unreadable answers', async () => {
    const fixture = (name: string): unknown =>
      JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/github', name), 'utf8'));
    const urls: string[] = [];
    const serve = (status: number, body: unknown) => (input: string | URL) => {
      urls.push(String(input));
      return Promise.resolve(res(status, '"live"', body));
    };
    const open = await githubBranchPulls(
      serve(200, fixture('branch-pulls-open.json')),
      null,
      'xiechimon',
      'pacman',
      { head: 'xiechimon:claude/bootstrap-p2', base: 'main' },
    );
    expect(urls).toEqual([
      'https://api.github.com/repos/xiechimon/pacman/pulls?state=all&head=xiechimon%3Aclaude%2Fbootstrap-p2&base=main&per_page=10',
    ]);
    expect(open).toEqual([
      {
        number: 1414,
        state: 'open',
        merged: false,
        headRef: 'claude/bootstrap-p2',
        headRepoId: 1361226985,
        baseRef: 'main',
        baseRepoId: 1361226985,
        // the segment 2 captures were trimmed without author_association ([2b-P7e] reads it)
        authorAssociation: null,
      },
    ]);
    const merged = await githubBranchPulls(
      serve(200, fixture('branch-pulls-merged.json')),
      null,
      'xiechimon',
      'pacman',
      { head: 'xiechimon:claude/optimistic-albattani-r5pmfn', base: 'main' },
    );
    expect(merged?.map((p) => [p.number, p.state, p.merged])).toEqual([
      [1474, 'closed', true],
      [1456, 'closed', true],
      [1454, 'closed', true],
      [1452, 'closed', true],
      [1449, 'closed', true],
      [1436, 'closed', true],
      [1425, 'closed', true],
    ]);
    const args = ['o', 'r', { head: 'o:b', base: 'main' }] as const;
    expect(await githubBranchPulls(serve(200, { message: 'x' }), null, ...args)).toBeNull();
    expect(await githubBranchPulls(serve(404, []), null, ...args)).toBeNull();
    expect(
      await githubBranchPulls(() => Promise.reject(new TypeError('fetch failed')), null, ...args),
    ).toBeNull();
  });

  // —— #1403 段 2b：段 2 合并前 pr-gate（#1489 run 1）的建议 4-7 ————————————————————

  test('[2b-P4] the recorded PR is foreign and the card leaves review while the list read is in flight → no write', async () => {
    const f = foreignWorld();
    headRefs.set(305, f.own);
    f.mock.pulls[305] = { state: 'open', merged: false };
    f.mock.branchPulls = [{ number: 305 }];
    f.mock.onList = () => {
      f.w.s.db
        .update(todoTable)
        .set({ phase: 'planning' })
        .where(eq(todoTable.id, f.w.todoId))
        .run();
    };
    await pollerFor(f.w, f.mock).sweep();
    expect(f.mock.listRequests()).toHaveLength(1);
    expect(f.currentPr()).toBe(201);
    expect(f.currentRows()).toEqual([]);
  });

  test('[2b-P5] a failed list read counts within one close only: the card leaving review and coming back starts again', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = 502;
    const poller = pollerFor(w, mock);
    const setPhase = (phase: Phase) =>
      w.s.db.update(todoTable).set({ phase }).where(eq(todoTable.id, w.todoId)).run();
    const t0 = Date.now();
    await poller.sweep(t0);
    await poller.sweep(t0 + 60_000); // confirmed, the list read fails once
    setPhase('planning');
    await poller.sweep(t0 + 120_000); // not a candidate: its close count and list failures go
    setPhase('review');
    await poller.sweep(t0 + 180_000);
    await poller.sweep(t0 + 240_000); // confirmed again, the list read fails once more
    expect(mock.listRequests()).toHaveLength(2);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('[2b-P6] anonymous: a foreign list read skipped for lack of budget does not count as a listing', async () => {
    const f = foreignWorld({ connected: false });
    const poller = pollerFor(f.w, f.mock, { anonIpReadsPerHour: 2 });
    const t0 = Date.now();
    await poller.sweep(t0); // reads pulls/201 (merged, cached from now on) and lists the branch
    expect(f.mock.listRequests()).toHaveLength(1);
    // a building card's anonymous check-runs reads use up the hour's budget before the relist
    addReviewCard(f.w, 401);
    const grind = `${f.w.todoId}-401`;
    const setGrind = (phase: Phase) =>
      f.w.s.db.update(todoTable).set({ phase }).where(eq(todoTable.id, grind)).run();
    setGrind('building');
    await poller.sweep(t0 + 3_000_000);
    await poller.sweep(t0 + 3_300_000);
    setGrind('closed');
    await poller.sweep(t0 + 3_600_001); // the relist is due, the budget is not there: skipped
    expect(f.mock.listRequests()).toHaveLength(1);
    await poller.sweep(t0 + 6_900_001); // the budget is back: lists now, not an hour after the skip
    expect(f.mock.listRequests()).toHaveLength(2);
  });

  test.each([
    'NONE',
    'CONTRIBUTOR',
    'FIRST_TIME_CONTRIBUTOR',
    'FIRST_TIMER',
    'MANNEQUIN',
    null,
  ] as const)(
    '[2b-P7a] closed path: an open PR from the build’s branch whose author has no write access (%s) is not adopted → failed as in segment 1',
    async (association) => {
      const { w, mock } = closedWithSibling();
      mock.branchPulls = [{ number: 202, authorAssociation: association }];
      await sweepTwice(pollerFor(w, mock));
      expect(mock.listRequests()).toHaveLength(1);
      expect(w.buildRow().prNumber).toBe(w.prNumber);
      expect(w.todoRow().phase).toBe('failed');
      expect(closedRows(w)).toHaveLength(1);
    },
  );

  test.each(['OWNER', 'MEMBER', 'COLLABORATOR'] as const)(
    '[2b-P7b] closed path: an open PR from the build’s branch by %s is adopted',
    async (association) => {
      const { w, mock } = closedWithSibling();
      mock.branchPulls = [{ number: 202, authorAssociation: association }];
      await sweepTwice(pollerFor(w, mock));
      expect(w.buildRow().prNumber).toBe(202);
      expect(w.todoRow().phase).toBe('review');
      expect(closedRows(w)).toEqual([]);
    },
  );

  test('[2b-P7c] foreign path: an open PR from the build’s own branch by an author without write access is not adopted; the hint', async () => {
    const f = foreignWorld();
    headRefs.set(305, f.own);
    f.mock.pulls[305] = { state: 'open', merged: false };
    f.mock.branchPulls = [{ number: 305, authorAssociation: 'NONE' }];
    await pollerFor(f.w, f.mock).sweep();
    expect(f.mock.listRequests()).toHaveLength(1);
    expect(f.currentPr()).toBe(201);
    expect(f.currentRows().some((c) => c.includes('PR #201 的 head'))).toBe(true);
  });

  test('[2b-P7d] closed path: a merged PR from the build’s branch whose author has no write access is not adopted', async () => {
    const { w, mock } = closedWithSibling({ sibling: { state: 'closed', merged: true } });
    mock.branchPulls = [
      { number: 202, state: 'closed', merged: true, authorAssociation: 'CONTRIBUTOR' },
    ];
    await sweepTwice(pollerFor(w, mock));
    expect(w.buildRow().prNumber).toBe(w.prNumber);
    expect(w.todoRow().phase).toBe('failed');
  });

  test('[2b-P7g] closed path: a newer PR closed unmerged sets the rejection floor whoever authored it (the close is the maintainer’s act) → the older merged PR is not adopted', async () => {
    const { w, mock } = closedWithSibling({ sibling: { state: 'closed', merged: true } });
    headRefs.set(203, conversationBranch(w.buildId));
    mock.branchPulls = [
      { number: 203, state: 'closed', authorAssociation: 'NONE' },
      { number: 202, state: 'closed', merged: true, authorAssociation: 'OWNER' },
    ];
    await sweepTwice(pollerFor(w, mock));
    expect(w.buildRow().prNumber).toBe(w.prNumber);
    expect(w.todoRow().phase).toBe('failed');
  });

  test.each(['NONE', 'CONTRIBUTOR', null] as const)(
    '[2b-P7h] foreign path: own #150 merged by OWNER, own #160 by %s closed unmerged → nothing adopted (pr-gate 1509 run 2, correctness)',
    async (association) => {
      const f = foreignWorld();
      headRefs.set(150, f.own);
      headRefs.set(160, f.own);
      f.mock.branchPulls = [
        { number: 160, state: 'closed', authorAssociation: association },
        { number: 150, state: 'closed', merged: true, authorAssociation: 'OWNER' },
      ];
      await pollerFor(f.w, f.mock).sweep();
      expect(f.currentPr()).toBe(201);
      expect(f.currentRows().some((c) => c.includes('改记为本任务的 PR'))).toBe(false);
      expect(f.currentRows().some((c) => c.includes('PR #201 的 head'))).toBe(true);
    },
  );

  test('[2b-P7f] the recorded PR itself shows up open again in the list → no write, whoever opened it', async () => {
    const { w, mock } = closedWithSibling();
    mock.branchPulls = [{ number: w.prNumber, authorAssociation: 'NONE' }];
    await sweepTwice(pollerFor(w, mock));
    expect(mock.listRequests()).toHaveLength(1);
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows()).toEqual([]);
  });

  test('[2b-P7e] the list parser reads author_association (live capture, docs/verify/1403/live-branch-pulls-assoc.json)', async () => {
    const body: unknown = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, 'fixtures/github', 'branch-pulls-assoc.json'),
        'utf8',
      ),
    );
    const list = await githubBranchPulls(
      () => Promise.resolve(res(200, '"live"', body)),
      null,
      'xiechimon',
      'pacman',
      { head: 'xiechimon:claude/bootstrap-p2-seg2', base: 'main' },
    );
    expect(list).toEqual([
      {
        number: 1489,
        state: 'closed',
        merged: true,
        headRef: 'claude/bootstrap-p2-seg2',
        headRepoId: 1361226985,
        baseRef: 'main',
        baseRepoId: 1361226985,
        authorAssociation: 'OWNER',
      },
    ]);
  });

  // —— T2-T6：pin rules that had no test at f8ab21b（T1 is in ⑱d / ⑱f）————————————

  test('[s2-T2] a verify or review step created after the completion row does not start a new round', async () => {
    const w = makeWorld({ connected: true });
    w.s.db.update(todoTable).set({ hasChanges: true }).where(eq(todoTable.id, w.todoId)).run();
    const mock = new PullsMock({
      [w.prNumber]: { state: 'closed', merged: true, mergeCommitSha: 'abc1234' },
    });
    const poller = pollerFor(w, mock);
    await poller.sweep();
    expect(w.todoRow().phase).toBe('done');
    updateTodo(w.s.svc, w.todoId, { phase: 'review' }, { manualPhase: true });
    const later = Date.now() + 1_000;
    for (const kind of ['verify', 'review'] as const) {
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-${kind}-late-${w.buildId}`,
          buildId: w.buildId,
          kind,
          status: 'done',
          createdAt: later,
        })
        .run();
    }
    await poller.sweep();
    expect(w.todoRow().phase).toBe('review');
    expect(w.systemRows().filter((c) => c === DONE_ROW)).toHaveLength(1);
  });

  test('[s2-T3] the first closed sighting is dropped when the card leaves review', async () => {
    const w = makeWorld({ connected: true });
    const mock = new PullsMock({ [w.prNumber]: { state: 'closed', merged: false } });
    const poller = pollerFor(w, mock);
    const t0 = Date.now();
    await poller.sweep(t0); // first sighting
    w.s.db.update(todoTable).set({ phase: 'planning' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep(t0 + 60_000); // not a review candidate this sweep
    w.s.db.update(todoTable).set({ phase: 'review' }).where(eq(todoTable.id, w.todoId)).run();
    await poller.sweep(t0 + 120_000); // a first sighting again, not a confirmation
    expect(w.todoRow().phase).toBe('review');
    await poller.sweep(t0 + 180_000);
    expect(w.todoRow().phase).toBe('failed');
  });

  test.each([
    ['T4', 'failed'],
    ['T5', 'stopped'],
  ] as const)(
    '[s2-%s] a %s build step that pushed a commit does not decide containment',
    async (_id, status) => {
      const built = 'a'.repeat(40);
      const other = 'b'.repeat(40);
      const w = makeWorld({ connected: true, checkpoint: built });
      w.s.db
        .insert(stepTable)
        .values({
          id: `step-${status}-${w.buildId}`,
          buildId: w.buildId,
          kind: 'build',
          status,
          checkpointCommit: other,
          createdAt: Date.now(),
          lastHeartbeatAt: Date.now(),
        })
        .run();
      const mock = new PullsMock({
        [w.prNumber]: {
          state: 'closed',
          merged: true,
          headSha: built,
          compareByBase: { [other]: 'diverged' },
        },
      });
      await pollerFor(w, mock).sweep();
      expect(mock.compareRequests()).toEqual([]);
      expect(w.todoRow().phase).toBe('done');
    },
  );

  test('[s2-T6] finishing the card stops queued gate steps only: a claimed verify step is left alone', () => {
    const w = makeWorld({ inflight: 'claimed', inflightKind: 'verify' });
    finishTodoDone(w.s.svc, w.todoId, w.buildId);
    expect(w.todoRow().phase).toBe('done');
    expect(w.stepRows().find((r) => r.kind === 'verify')?.status).toBe('claimed');
  });
});
